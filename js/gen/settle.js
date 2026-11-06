// Settlements: the Lea's few permanent wooden buildings — one village round a
// green, a hamlet, a farmstead or two — and the dirt lanes that tie them to the
// Old Road. Laid out once at load from the seed; nobody raises them in the
// world (the folk's huts are the other kind of building, docs/camp.md).
//
// Where they go, from how real villages were sited (docs/settlements.md):
//   · dry ground, but water near — a spring line, a stream, a lake shore a
//     short walk off, never on the bank itself (25 ACCESS TO WATER)
//   · at the meeting of grazing, hay meadow and wood, so a household has all
//     three within reach
//   · on the valley side, not its floor: the floor is the best farmland and the
//     first to flood (4 AGRICULTURAL VALLEYS, 104 SITE REPAIR)
//   · on gentle ground, open to the south (105 SOUTH FACING OUTDOORS)
//   · near the road but off it: a lane, not the highway, runs to the green
//     (14 IDENTIFIABLE NEIGHBORHOOD), and meets the road at a T (50)
//
// How big: medieval English villages ran about 10–30 households, and Alexander's
// house cluster is 8–12 round common land (37). The Lea is about 2 km across at
// its largest, so it gets one village, a hamlet and a couple of farmsteads.
//
// How they are laid out: houses ring the green with their doors to it (61, 67,
// 106); each household's barn or shed stands behind, making a yard (95); the
// well is roughly in the middle (126). A farmstead is a yard closed on three
// sides and open to the south. Houses are long and thin (109).
//
// Pure (no three.js). land.js plans them on the land as graded for the road,
// then grades building pads and lanes, so everything reading height() or
// habitat() sees them.

import { mulberry32 } from '../rng.js';
import { UNITS_PER_M } from '../config.js';

const M = UNITS_PER_M;
export const LANE_W = 1.6;     // half-width of a lane: 3.2u ≈ 2.1 m, one cart
const GRID = 16;               // site-search grid (u)
const CELL = 8;                // lane-planning grid (u)
const STEP = 2;                // lane profile spacing (u)
const LANE_RULING = 0.09;      // a lane takes steeper ground than the road
const GAP = 2.4;               // clear ground kept between two buildings (u): room to walk between
const DWELLINGS = new Set(['house', 'cottage']);

// building kinds, in metres: gable-end width and length ranges, eaves height,
// roof pitch (degrees), walls and roof, and how high it stands on posts
export const KINDS = {
  house:   { w: [4.4, 5.4], l: [8, 12],    eaves: 2.1, pitch: 50, wall: 'logs',   roof: 'thatch' },
  cottage: { w: [3.8, 4.4], l: [5.5, 7],   eaves: 2.0, pitch: 50, wall: 'logs',   roof: 'thatch' },
  barn:    { w: [5.5, 7],   l: [9, 13],    eaves: 2.8, pitch: 45, wall: 'boards', roof: 'shingle' },
  shed:    { w: [2.8, 3.4], l: [3.6, 5],   eaves: 1.9, pitch: 40, wall: 'boards', roof: 'shingle' },
  granary: { w: [2.4, 2.8], l: [2.6, 3.2], eaves: 1.6, pitch: 45, wall: 'boards', roof: 'thatch', raised: 0.8 },
};

// how many of each a world gets, by its side
const PLAN = {
  3200: [['village', 1], ['hamlet', 1], ['farmstead', 2]],
  1600: [['hamlet', 1], ['farmstead', 1]],
  800:  [['farmstead', 1]],
};
// how far apart (u) a new settlement keeps from those already placed
const SPACING = { village: 0, hamlet: 520, farmstead: 380 };
// the flat ground each needs (radius, u)
const CORE = { village: 40, hamlet: 26, farmstead: 18 };

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const OPEN = new Set(['meadow', 'wetmeadow', 'heath']);
const WOOD = new Set(['woodland', 'grove', 'carr']);
const WET = new Set(['lake', 'marsh', 'fen', 'beach']);

// ---- buildings ------------------------------------------------------------------
// A building is an oriented box: centre (x, z), long axis at angle a (its length
// runs along (cos a, sin a)), half-length hl and half-width hw in units, the
// door on side `door` (±1) of the long axis, the pad's height y.
// A DWELLING (house or cottage) is where a household lives: its door is at
// `du` along the door side, and it has a hearth (chimney and smoke, settle-view)
// and a field (fields below). The rest are barns, sheds and granaries.
function building(kind, x, z, a, r, door = 1){
  const k = KINDS[kind];
  const w = (k.w[0] + r() * (k.w[1] - k.w[0])) * M, l = (k.l[0] + r() * (k.l[1] - k.l[0])) * M;
  const b = { kind, x, z, a, hl: l / 2, hw: w / 2, door, y: 0, tint: r(), dwelling: DWELLINGS.has(kind) };
  // the door stands off to one side of the middle, where the hearth and chimney are
  if (b.dwelling) b.du = (r() < 0.5 ? -1 : 1) * b.hl * (0.3 + r() * 0.2);
  return b;
}
// a point in the building's own frame: u along its length, v across, + out of the door side
export function at(b, u, v){
  const c = Math.cos(b.a), s = Math.sin(b.a), w = v * b.door;
  return [b.x + c * u - s * w, b.z + s * u + c * w];
}
const axes = b => [Math.cos(b.a), Math.sin(b.a), -Math.sin(b.a), Math.cos(b.a)];   // long (lx, lz), across (cx, cz)

// is (x, z) within `pad` of the building's walls?
export function inBuilding(b, x, z, pad = 0){
  const [lx, lz, cx, cz] = axes(b), dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * lx + dz * lz) < b.hl + pad && Math.abs(dx * cx + dz * cz) < b.hw + pad;
}
// do two buildings come within `gap` of each other? (separating axes)
function overlaps(p, q, gap){
  for (const b of [p, q]){
    const [lx, lz, cx, cz] = axes(b);
    for (const [ux, uz] of [[lx, lz], [cx, cz]]){
      const proj = o => {
        const [ol, om, oc, on] = axes(o), c = o.x * ux + o.z * uz;
        const e = o.hl * Math.abs(ol * ux + om * uz) + o.hw * Math.abs(oc * ux + on * uz);
        return [c - e, c + e];
      };
      const [a0, a1] = proj(p), [b0, b1] = proj(q);
      if (a1 + gap <= b0 || b1 + gap <= a0) return false;
    }
  }
  return true;
}
// sample points over a building's footprint (corners, edge middles, centre)
function footprint(b, pad = 0){
  const [lx, lz, cx, cz] = axes(b), out = [];
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1])
    out.push([b.x + lx * u * (b.hl + pad) + cx * v * (b.hw + pad), b.z + lz * u * (b.hl + pad) + cz * v * (b.hw + pad)]);
  return out;
}

// ---- planning -----------------------------------------------------------------
// size: the world's side; height / habitat: the land as graded for the road;
// water: the water plane; road: the Old Road (road.js); worldR: how far out
// things may stand
export function planSettlements({ size, seed, height, habitat, water, road, worldR }){
  const r = mulberry32(seed >>> 0);
  const half = size / 2;

  // the land on the site grid: height, habitat, and distance to water and to the road
  const G = Math.round(size / GRID) + 1, X = c => c * GRID - half;
  const Hg = new Float32Array(G * G), hab = new Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const x = X(i), z = X(j), k = j * G + i;
    Hg[k] = height(x, z); hab[k] = habitat(x, z, Hg[k]);
  }
  const wetD = distanceField(G, k => Hg[k] < water + 0.3, GRID);
  const roadSeed = new Uint8Array(G * G);
  for (let s = 0; s < road.xs.length; s++){
    const i = Math.round((road.xs[s] + half) / GRID), j = Math.round((road.zs[s] + half) / GRID);
    if (i >= 0 && j >= 0 && i < G && j < G) roadSeed[j * G + i] = 1;
  }
  const roadD = distanceField(G, k => roadSeed[k] === 1, GRID);
  const at = (x, z) => {
    const i = clamp(Math.round((x + half) / GRID), 0, G - 1), j = clamp(Math.round((z + half) / GRID), 0, G - 1);
    return j * G + i;
  };

  // how well a settlement of this kind would sit at (x, z), or -Infinity
  const score = (x, z, kind) => {
    const k = at(x, z), h = Hg[k], dh = h - water;
    if (Math.hypot(x, z) > worldR * 0.85 || Math.hypot(x, z) < 200) return -Infinity;   // not on the start's rise
    if (dh < 1.8 || dh > 13) return -Infinity;                                            // dry, not the highlands
    if (!(hab[k] === 'meadow' || hab[k] === 'heath' || hab[k] === 'woodland')) return -Infinity;
    // gentle ground across the whole core
    const R = CORE[kind];
    let lo = h, hi = h;
    for (let q = 0; q < 8; q++){
      const y = height(x + Math.cos(q * Math.PI / 4) * R, z + Math.sin(q * Math.PI / 4) * R);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    const flat = 1 - (hi - lo) / (R * 0.1);
    if (flat < 0) return -Infinity;
    // water a short walk off, never on the bank
    const wd = wetD[k];
    if (wd < 40) return -Infinity;
    const wet = wd <= 180 ? 1 : Math.max(0, 1 - (wd - 180) / 240);
    // the land round about: pasture and hay, some wood, not all bog
    let open = 0, wood = 0, bog = 0, n = 0, ring = 0;
    for (const rr of [80, 160, 240]) for (let q = 0; q < 12; q++){
      const sx = x + Math.cos(q * Math.PI / 6 + rr) * rr, sz = z + Math.sin(q * Math.PI / 6 + rr) * rr, kk = at(sx, sz);
      n++;
      if (OPEN.has(hab[kk])) open++; else if (WOOD.has(hab[kk])) wood++; else if (WET.has(hab[kk])) bog++;
      if (rr === 240) ring += Hg[kk];
    }
    open /= n; wood /= n; bog /= n;
    const mix = Math.min(open, 0.55) / 0.55 * 0.6 + Math.min(wood, 0.2) / 0.2 * 0.4 - Math.max(0, bog - 0.35);
    // on the valley side, above the low meadows
    const shoulder = clamp((h - ring / 12) / 3, -1, 1);
    // open to the south: the ground falls away toward +z
    const south = clamp(-(height(x, z + 24) - height(x, z - 24)) / 48 / 0.04, -1, 1);
    // near the road but off it
    const rd = roadD[k];
    if (rd < 50) return -Infinity;
    const near = kind === 'farmstead' ? 1 - Math.max(0, rd - 500) / 600 : rd <= 300 ? 1 : Math.max(0, 1 - (rd - 300) / 400);
    // a wood would have to be cleared first
    const clearing = hab[k] === 'woodland' ? -0.3 : 0;
    return flat + 1.2 * wet + 1.2 * mix + 0.5 * shoulder + 0.4 * south + 0.8 * near + clearing + 0.15 * r();
  };

  const places = [], all = [], fields = [];
  // a household's field: workable ground (it may slope, but not much), off the
  // road, clear of every building and the other fields, and not on a green
  const fieldFits = f => {
    if (Math.hypot(f.x, f.z) > worldR * 0.95) return false;
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of footprint(f)){
      const y = height(x, z), h = habitat(x, z, y);
      if (h === 'road' || WET.has(h) || h === 'rock') return false;
      if (roadD[at(x, z)] < 48 && road.nearest(x, z).d < 14) return false;
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (hi - lo > 3.5) return false;
    for (const o of all) if (overlaps(f, o, 2.5)) return false;
    for (const o of fields) if (overlaps(f, o, 1.5)) return false;
    for (const p of places) if (p.green && footprint(f).some(([x, z]) => inEllipse(p.green, x, z, 2))) return false;
    return true;
  };
  const fits = (b, place) => {
    if (Math.hypot(b.x, b.z) > worldR * 0.95) return false;
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const [x, z] of footprint(b, 1)){
      const y = height(x, z), h = habitat(x, z, y);
      if (h === 'road' || WET.has(h) || h === 'rock') return false;
      if (roadD[at(x, z)] < 48 && road.nearest(x, z).d < 16) return false;
      lo = Math.min(lo, y); hi = Math.max(hi, y); sum += y;
    }
    if (hi - lo > 1.8) return false;                     // too steep to level a floor for
    if (place.green && footprint(b).some(([x, z]) => inEllipse(place.green, x, z, 1.5))) return false;   // the green stays open
    for (const o of all) if (overlaps(b, o, GAP)) return false;
    for (const o of place.buildings) if (overlaps(b, o, GAP)) return false;
    b.y = sum / 9;
    return true;
  };

  for (const [kind, count] of PLAN[size] || PLAN[3200]){
    for (let c = 0; c < count; c++){
      // the best site far enough from the others
      let best = null, bs = -Infinity;
      for (let j = 2; j < G - 2; j++) for (let i = 2; i < G - 2; i++){
        const x = X(i), z = X(j);
        if (places.some(p => Math.hypot(p.x - x, p.z - z) < Math.max(SPACING[kind], SPACING[p.kind]))) continue;
        const s = score(x, z, kind);
        if (s > bs){ bs = s; best = [x, z]; }
      }
      if (!best) continue;
      const [x, z] = best;
      // toward the road: where the lane will leave from
      const { s } = road.nearest(x, z), ri = Math.min(road.xs.length - 1, Math.round(s / road.step));
      const toward = Math.atan2(road.zs[ri] - z, road.xs[ri] - x);
      const place = { kind, x, z, toward, green: null, yard: null, gate: null, buildings: [], well: null, score: bs };
      const pr = mulberry32((seed ^ (places.length + 1) * 0x9e37) >>> 0);
      if (kind === 'farmstead') layFarmstead(place, pr, height, fits);
      else layCluster(place, pr, height, fits, kind === 'village' ? 8 + ((pr() * 5) | 0) : 2 + ((pr() * 3) | 0));
      if (!place.buildings.length) continue;
      places.push(place);
      all.push(...place.buildings);
      place.fields = [];
      for (const b of place.buildings) if (b.dwelling){
        const f = layField(b, pr, fieldFits);
        if (f){ place.fields.push(f); fields.push(f); }
      }
    }
  }

  const lanes = planLanes({ size, places, buildings: all, fields, height, water, road });
  return { places, buildings: all, lanes, fields };
}

// A household's field, behind its house: the croft beyond the toft, as an
// English village laid its plots out. Tried straight behind first, further back
// past the outbuildings, then off to either side, then turned square.
function layField(b, r, fits){
  const hl = (9 + r() * 4), hw = (6 + r() * 2.5);
  for (const turn of [0, Math.PI / 2])
    for (const back of [6, 12, 18, 26])
      for (const along of [0, b.hl, -b.hl, 2 * b.hl, -2 * b.hl]){
        const fhw = turn ? hl : hw;
        const [x, z] = at(b, along, -(b.hw + back + fhw));
        const f = { x, z, a: b.a + turn, hl, hw, house: b, door: 1 };
        if (fits(f)) return f;
      }
  return null;
}

const inEllipse = (e, x, z, pad = 0) => {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.a), s = Math.sin(e.a);
  const u = (dx * c + dz * s) / (e.rx + pad), v = (-dx * s + dz * c) / (e.rz + pad);
  return u * u + v * v < 1;
};

// A green with households round it, doors in, the lane's way out left open.
function layCluster(place, r, height, fits, households){
  const { x, z } = place;
  // the green's long axis follows the contour
  const gx = height(x + 20, z) - height(x - 20, z), gz = height(x, z + 20) - height(x, z - 20);
  const a = Math.hypot(gx, gz) > 0.3 ? Math.atan2(gz, gx) + Math.PI / 2 : r() * Math.PI;
  const big = place.kind === 'village';
  const g = place.green = { x, z, a, rx: big ? 26 + r() * 8 : 11 + r() * 3, rz: big ? 16 + r() * 6 : 8 + r() * 2 };
  const c = Math.cos(a), s = Math.sin(a);
  const onRim = t => [x + g.rx * Math.cos(t) * c - g.rz * Math.sin(t) * s, z + g.rx * Math.cos(t) * s + g.rz * Math.sin(t) * c];
  const normal = t => {
    const nu = Math.cos(t) / g.rx, nv = Math.sin(t) / g.rz, l = Math.hypot(nu, nv);
    return [(nu * c - nv * s) / l, (nu * s + nv * c) / l];
  };
  // the gate: the rim point facing the road
  let tg = 0, bd = -Infinity;
  for (let q = 0; q < 64; q++){
    const t = q / 64 * Math.PI * 2, [nx, nz] = normal(t), d = nx * Math.cos(place.toward) + nz * Math.sin(place.toward);
    if (d > bd){ bd = d; tg = t; }
  }
  place.gate = onRim(tg);
  const gap = big ? 0.9 : 1.1;
  for (let i = 0; i < households; i++){
    const t = tg + gap / 2 + (i + 0.5 + (r() - 0.5) * 0.5) * (Math.PI * 2 - gap) / households;
    const setback = big ? 3 + r() * 4 : 3 + r() * 2;
    for (const dt of [0, 0.1, -0.1]) if (household(place, r, onRim(t + dt), normal(t + dt), fits, setback, i % 3 === 1)) break;
  }
  // the well, roughly in the middle
  place.well = { x: x + (r() - 0.5) * g.rx * 0.4, z: z + (r() - 0.5) * g.rz * 0.4, r: 1.0 * M };
}

// One household on the green's rim at `p`, `n` the outward normal: a house
// facing in, a barn or shed behind making the yard, sometimes a granary.
function household(place, r, [px, pz], [nx, nz], fits, setback, granary){
  const tx = -nz, tz = nx, a = Math.atan2(tz, tx);
  const kind = r() < 0.7 ? 'house' : 'cottage';
  for (let tries = 0; tries < 4; tries++){
    const h = building(kind, 0, 0, a + (r() - 0.5) * 0.25, r);
    const d = setback + h.hw + tries * 3;
    h.x = px + nx * d; h.z = pz + nz * d;
    // which long side faces the green
    h.door = (-nx * -Math.sin(h.a) + -nz * Math.cos(h.a)) > 0 ? 1 : -1;
    if (!fits(h, place)) continue;
    place.buildings.push(h);
    // behind it: a barn or shed, either parallel (a yard between) or end-on beside it (an L)
    const outK = place.kind === 'village' && r() < 0.4 ? 'barn' : 'shed';
    const side = r() < 0.5 ? 1 : -1;
    const tryOut = [];
    for (const parallel of r() < 0.5 ? [true, false] : [false, true]){
      const o = building(outK, 0, 0, parallel ? h.a : h.a + Math.PI / 2, r);
      if (parallel){
        const back = d + h.hw + 5 + r() * 3 + o.hw, along = side * (h.hl - o.hl) * r();
        o.x = px + nx * back + tx * along; o.z = pz + nz * back + tz * along;
      } else {
        const back = d + o.hl * 0.6, along = side * (h.hl + GAP + 1 + o.hw);
        o.x = px + nx * back + tx * along; o.z = pz + nz * back + tz * along;
      }
      o.door = parallel ? h.door : side;            // facing the house across the yard
      tryOut.push(o);
    }
    for (const o of tryOut) if (fits(o, place)){ place.buildings.push(o); break; }
    if (granary){
      const o = building('granary', 0, 0, h.a, r);
      const along = -side * (h.hl + GAP + o.hl + 1), back = d + h.hw * 0.5;
      o.x = px + nx * back + tx * along; o.z = pz + nz * back + tz * along;
      if (fits(o, place)) place.buildings.push(o);
    }
    return true;
  }
  return false;
}

// A yard closed on three sides — house at the back, barn and shed down the
// sides — and open to the south, where the lane leaves.
function layFarmstead(place, r, height, fits){
  const { x, z } = place;
  for (let tries = 0; tries < 6; tries++){
    const f = Math.PI / 2 + (r() - 0.5) * 0.9 + (tries ? (r() - 0.5) * 1.2 : 0);   // facing +z (south), more or less
    const fx = Math.cos(f), fz = Math.sin(f), sx = -fz, sz = fx;
    const depth = 12 + r() * 4, width = 12 + r() * 5;
    const yard = { x, z, a: f, depth, width };
    const placed = [];
    const h = building('house', 0, 0, f + Math.PI / 2, r);
    h.x = x - fx * (depth / 2 + h.hw); h.z = z - fz * (depth / 2 + h.hw);
    h.door = (fx * -Math.sin(h.a) + fz * Math.cos(h.a)) > 0 ? 1 : -1;
    placed.push(h);
    const side = r() < 0.5 ? 1 : -1;
    const b = building('barn', 0, 0, f, r);
    const bf = -depth / 2 + GAP + b.hl;            // its back end a step clear of the house
    b.x = x + sx * side * (width / 2 + b.hw) + fx * bf; b.z = z + sz * side * (width / 2 + b.hw) + fz * bf;
    b.door = (-sx * side * -Math.sin(b.a) + -sz * side * Math.cos(b.a)) > 0 ? 1 : -1;
    placed.push(b);
    const o = building('shed', 0, 0, f, r);
    const of = -depth / 2 + GAP + o.hl;
    o.x = x - sx * side * (width / 2 + o.hw) + fx * of; o.z = z - sz * side * (width / 2 + o.hw) + fz * of;
    o.door = (sx * side * -Math.sin(o.a) + sz * side * Math.cos(o.a)) > 0 ? 1 : -1;
    placed.push(o);
    if (!fits(h, place)) continue;
    place.buildings.push(h);
    if (fits(b, place)) place.buildings.push(b);
    if (fits(o, place)) place.buildings.push(o);
    place.yard = yard;
    place.gate = [x + fx * depth / 2, z + fz * depth / 2];
    return;
  }
  place.buildings.length = 0;
}

// ---- lanes ----------------------------------------------------------------------
// Each settlement's lane is a least-cost walk from its gate to the nearest of
// the Old Road or a lane already laid — so a farmstead's track joins the
// village lane where that is shorter, and the lanes branch like a lace (5).
// The village goes first. Cheaper along a lane already there, so they share.
function planLanes({ size, places, buildings, fields, height, water, road }){
  const half = size / 2, G = Math.round(size / CELL) + 1, X = c => c * CELL - half;
  const H = new Float32Array(G * G), K = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const x = X(i), z = X(j), k = j * G + i, d = (H[k] = height(x, z)) - water;
    K[k] = d < 0.3 ? 400 : d < 1.4 ? 5 : 1;
  }
  for (const b of buildings){                      // lanes go round buildings, not through
    const R = Math.hypot(b.hl, b.hw) + 3;
    for (let j = Math.max(0, Math.floor((b.z - R + half) / CELL)); j <= Math.min(G - 1, Math.ceil((b.z + R + half) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((b.x - R + half) / CELL)); i <= Math.min(G - 1, Math.ceil((b.x + R + half) / CELL)); i++)
        if (inBuilding(b, X(i), X(j), 3)) K[j * G + i] = Infinity;
  }
  for (const f of fields){                         // round the fields, not across the crops
    const R = Math.hypot(f.hl, f.hw);
    for (let j = Math.max(0, Math.floor((f.z - R + half) / CELL)); j <= Math.min(G - 1, Math.ceil((f.z + R + half) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((f.x - R + half) / CELL)); i <= Math.min(G - 1, Math.ceil((f.x + R + half) / CELL)); i++)
        if (inBuilding(f, X(i), X(j)) && K[j * G + i] !== Infinity) K[j * G + i] *= 3;
  }
  for (const p of places) if (p.well){
    const k = Math.round((p.well.z + half) / CELL) * G + Math.round((p.well.x + half) / CELL);
    K[k] = Infinity;
  }
  // the goal: the road's paving
  const goal = new Uint8Array(G * G);
  for (let s = 0; s < road.xs.length; s++){
    const i = Math.round((road.xs[s] + half) / CELL), j = Math.round((road.zs[s] + half) / CELL);
    if (i >= 0 && j >= 0 && i < G && j < G) goal[j * G + i] = 1;
  }
  const stepCost = (a, b, len) => {
    const gr = Math.abs(H[b] - H[a]) / len;
    return len * (K[a] + K[b]) * 0.5 * (1 + (gr / LANE_RULING) ** 2 + (gr > 2.5 * LANE_RULING ? 30 : 0));
  };
  const DIRS = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],[2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2],[1,-2],[2,-1]];
  const lanes = [];
  for (const p of places){
    if (!p.gate) continue;
    const goalD = distanceField(G, k => goal[k] === 1, CELL);
    const A = Math.round((p.gate[1] + half) / CELL) * G + Math.round((p.gate[0] + half) / CELL);
    const g = new Float32Array(G * G).fill(Infinity), came = new Int32Array(G * G).fill(-1), done = new Uint8Array(G * G);
    const heap = new Heap();
    g[A] = 0; heap.push(A, 0);
    let end = -1;
    while (heap.size){
      const n = heap.pop();
      if (done[n]) continue;
      done[n] = 1;
      if (goal[n] && n !== A){ end = n; break; }
      const i = n % G, j = (n / G) | 0;
      for (const [di, dj] of DIRS){
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
        const m = jj * G + ii;
        if (done[m] || K[m] === Infinity) continue;
        const ng = g[n] + stepCost(n, m, Math.hypot(di, dj) * CELL);
        if (ng < g[m]){ g[m] = ng; came[m] = n; heap.push(m, ng + goalD[m] * 0.5); }
      }
    }
    if (end < 0) continue;
    const cells = [];
    for (let n = end; n !== -1; n = came[n]) cells.push(n);
    cells.reverse();
    // pull it taut a little, then round it
    const taut = [cells[0]];
    for (let a = 0; a < cells.length - 1;){
      let best = a + 1;
      for (let b = Math.min(cells.length - 1, a + 24); b > a + 1; b--){
        const ax = cells[a] % G, az = (cells[a] / G) | 0, bx = cells[b] % G, bz = (cells[b] / G) | 0;
        const n = Math.ceil(Math.hypot(bx - ax, bz - az));
        let c = 0, prev = cells[a];
        for (let s = 1; s <= n; s++){
          const k = Math.round(az + (bz - az) * s / n) * G + Math.round(ax + (bx - ax) * s / n);
          c += stepCost(prev, k, Math.hypot(ax - bx, az - bz) * CELL / n); prev = k;
        }
        if (c <= (g[cells[b]] - g[cells[a]]) * 1.05){ best = b; break; }
      }
      taut.push(cells[best]); a = best;
    }
    let pts = taut.map(n => [X(n % G), X((n / G) | 0)]);
    pts[0] = [p.gate[0], p.gate[1]];
    // end on the paving or the lane it joins: its nearest point
    const [ex, ez] = pts[pts.length - 1];
    pts[pts.length - 1] = nearestOn(ex, ez, road, lanes);
    for (let it = 0; it < 3; it++){
      const o = [pts[0]];
      for (let k = 0; k + 1 < pts.length; k++){
        const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
        if (k > 0) o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
        if (k + 2 < pts.length) o.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    const lane = line(pts, height, water);
    lane.place = p;
    lanes.push(lane);
    // the next lane may end on this one, and runs cheaper along it
    for (const [x, z] of pts){
      const k = Math.round((z + half) / CELL) * G + Math.round((x + half) / CELL);
      if (k >= 0 && k < G * G && K[k] !== Infinity){ goal[k] = 1; K[k] = Math.min(K[k], 0.5); }
    }
  }
  return lanes;
}

function nearestOn(x, z, road, lanes){
  let best = null, bd = Infinity;
  const { d, s } = road.nearest(x, z);
  if (d < bd){ const k = Math.min(road.xs.length - 1, Math.round(s / road.step)); best = [road.xs[k], road.zs[k]]; bd = d; }
  for (const l of lanes){
    const q = l.nearest(x, z);
    if (q.d < bd){ const k = Math.min(l.xs.length - 1, Math.round(q.s / STEP)); best = [l.xs[k], l.zs[k]]; bd = q.d; }
  }
  return best;
}

// A polyline as legs with a height profile: the land under it, gently smoothed
// along the way, kept just above the water.
function line(pts, height, water){
  const legs = [];
  let s0 = 0;
  for (let i = 0; i + 1 < pts.length; i++){
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    legs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, s0 });
    s0 += len;
  }
  const length = s0, n = Math.max(2, Math.ceil(length / STEP) + 1);
  const xs = new Float32Array(n), zs = new Float32Array(n), base = new Float32Array(n);
  let li = 0;
  for (let k = 0; k < n; k++){
    const s = Math.min(length, k * STEP);
    while (li < legs.length - 1 && s > legs[li].s0 + legs[li].len) li++;
    const g = legs[li], t = s - g.s0;
    xs[k] = g.ax + g.dx * t; zs[k] = g.az + g.dz * t; base[k] = height(xs[k], zs[k]);
  }
  const prof = blur(base, 3);
  for (let k = 0; k < n; k++) prof[k] = Math.max(prof[k], water + 0.4);
  // the two ends meet ground that's already set (the road, a lane, a green): keep to it
  prof[0] = base[0]; prof[n - 1] = base[n - 1];
  return {
    pts, legs, length, xs, zs, prof,
    heightAt(s){
      const f = clamp(s / STEP, 0, n - 1), k = Math.min(n - 2, f | 0), t = f - k;
      return prof[k] + (prof[k + 1] - prof[k]) * t;
    },
    nearest(x, z){
      let d = Infinity, s = 0;
      for (const g of legs){
        const t = clamp((x - g.ax) * g.dx + (z - g.az) * g.dz, 0, g.len);
        const e = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t);
        if (e < d){ d = e; s = g.s0 + t; }
      }
      return { d, s };
    },
  };
}

function blur(a, r){
  const n = a.length, out = new Float32Array(n);
  for (let k = 0; k < n; k++){
    let sum = 0, c = 0;
    for (let j = Math.max(0, k - r); j <= Math.min(n - 1, k + r); j++){ sum += a[j]; c++; }
    out[k] = sum / c;
  }
  return out;
}

// distance (u) from every cell of a G×G grid to the nearest cell where seed(k)
// holds: a two-pass chamfer transform, near enough for siting
export function distanceField(G, seed, cell){
  const D = new Float32Array(G * G);
  for (let k = 0; k < G * G; k++) D[k] = seed(k) ? 0 : 1e9;
  const d1 = cell, d2 = cell * Math.SQRT2;
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const k = j * G + i;
    if (i > 0) D[k] = Math.min(D[k], D[k - 1] + d1);
    if (j > 0){
      D[k] = Math.min(D[k], D[k - G] + d1);
      if (i > 0) D[k] = Math.min(D[k], D[k - G - 1] + d2);
      if (i < G - 1) D[k] = Math.min(D[k], D[k - G + 1] + d2);
    }
  }
  for (let j = G - 1; j >= 0; j--) for (let i = G - 1; i >= 0; i--){
    const k = j * G + i;
    if (i < G - 1) D[k] = Math.min(D[k], D[k + 1] + d1);
    if (j < G - 1){
      D[k] = Math.min(D[k], D[k + G] + d1);
      if (i < G - 1) D[k] = Math.min(D[k], D[k + G + 1] + d2);
      if (i > 0) D[k] = Math.min(D[k], D[k + G - 1] + d2);
    }
  }
  return D;
}

class Heap {
  constructor(){ this.n = []; this.f = []; }
  get size(){ return this.n.length; }
  push(n, f){
    const N = this.n, F = this.f;
    let k = N.length; N.push(n); F.push(f);
    while (k > 0){ const p = (k - 1) >> 1; if (F[p] <= f) break; N[k] = N[p]; F[k] = F[p]; k = p; }
    N[k] = n; F[k] = f;
  }
  pop(){
    const N = this.n, F = this.f, top = N[0], ln = N.pop(), lf = F.pop();
    if (N.length){
      let k = 0;
      for (;;){
        let c = 2 * k + 1; if (c >= N.length) break;
        if (c + 1 < N.length && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        N[k] = N[c]; F[k] = F[c]; k = c;
      }
      N[k] = ln; F[k] = lf;
    }
    return top;
  }
}
