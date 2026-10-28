// Under the Lea: caves and crypts, each its own map, entered by its mouth (E,
// then a prompt) the way Might and Magic 6–8 enter a dungeon. docs/under.md.
//
// Two kinds so far:
//   · cave   — a natural passage under the hills, opening in crags and steep
//              hillsides. A cave may have more than one mouth, far apart: the
//              first piece of an underdark, a way under the land from one place
//              to another. It runs where it really would: from mouth to mouth,
//              under the ground between them, so levels use world coordinates.
//   · crypt  — rooms and passages under a ruined chapel, down a stair in its
//              floor: vaulted halls, pillars, stone coffins.
//
// A level is a grid of CELL-sized cells, each open or solid, with a floor and a
// ceiling height at every cell corner; the view draws floors, walls and
// ceilings from it, and walking is a lookup in it. Both kinds share it: a cave
// is carved along wandering passages, a crypt laid out as rooms and corridors.
//
// planUnder() runs at load (cheap: it only chooses the mouths). buildLevel()
// runs the first time someone goes down, from the plan's seed, so the same
// world always has the same caves. Pure (no three.js).

import { mulberry32 } from '../rng.js';
import { distanceField } from './settle.js';

export const CELL = 2;              // level grid (u): about 1.3 m
const PAD = 0.35;                   // a body's radius, as walkable() in terrain.js

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

// value noise on the integer lattice, smoothed: deterministic per seed
function noise2(seed){
  const h = (i, j) => { let n = (i * 374761393 + j * 668265263 + seed * 1274126177) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    return lerp(lerp(h(i, j), h(i + 1, j), sx), lerp(h(i, j + 1), h(i + 1, j + 1), sx), sz);
  };
}

// ---- where the mouths are ----------------------------------------------------------
// ruins: from ruins.js (a crypt goes under the chapel, or failing that a hall);
// solidAt: so a mouth doesn't open into a wall
export function planUnder({ size, seed, height, habitat, water, road, settle, ruins, worldR, solidAt }){
  const r = mulberry32(seed >>> 0), levels = [], entrances = [];
  const slopeAt = (x, z) => Math.hypot(height(x + 2, z) - height(x - 2, z), height(x, z + 2) - height(x, z - 2)) / 4;
  const downhill = (x, z) => Math.atan2(-(height(x, z + 3) - height(x, z - 3)), -(height(x + 3, z) - height(x - 3, z)));
  const clearOf = (x, z) => road.nearest(x, z).d > 120
    && settle.places.every(p => Math.hypot(p.x - x, p.z - z) > 250)
    && ruins.every(u => Math.hypot(u.x - x, u.z - z) > u.rad + 80)
    && Math.hypot(x, z) > 200 && Math.hypot(x, z) < worldR * 0.85;

  // Crypts, each down a stair: under the chapel the deepest, six floors down to the
  // cathedral and the treasury; under the abbey five, its fourth a great basilica;
  // under each hall three or four; under each tower one or two; and a few tombs out in the country, a stair in open ground inside its
  // kerb, one or two floors. Each has its own seed, so its own rooms and its own
  // stone (buildCrypt). Their own random stream, so the caves stay where they were.
  const rc = mulberry32((seed ^ 0x7c0b5) >>> 0);
  // the stair's opening and the spot in front of it must both be clear of fallen stone
  const clearStair = (x, z, face) => [0, 1.5, 3, 4.5].every(u => !solidAt(x - Math.cos(face) * u, z - Math.sin(face) * u, 1.6)) && !solidAt(x + Math.cos(face) * 3.5, z + Math.sin(face) * 3.5, 1);
  // the stones dealt out like cards, so no two crypts share one till all have been used
  const rd = mulberry32((seed ^ 0x57013) >>> 0), deck = []; const deal = () => { if (!deck.length){ const d = Object.keys(STONES).slice(1); for (let i = d.length - 1; i > 0; i--){ const j = (rd() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; } deck.push(...d); } return deck.pop(); };
  const crypt = (site, x, z, face, floors, extra = {}) => {
    const id = levels.length, n = levels.filter(l => l.kind === 'crypt').length;
    levels.push({ id, kind: 'crypt', site, floors, stone: site === 'chapel' ? 'grey' : deal(), seed: (n ? seed ^ 0xc4997 ^ Math.imul(n, 0x9e3779b1) ^ Math.imul(Math.round(x) | 0, 0x85ebca6b) ^ Math.imul(Math.round(z) | 0, 0xc2b2ae35) : seed ^ 0xc4997) >>> 0, ...extra,
      mouths: [{ x, z, y: height(x, z), face }] });
    entrances.push({ level: id, mouth: 0, kind: 'stair', site, x, z, y: height(x, z), face, stand: [x + Math.cos(face) * 3.5, z + Math.sin(face) * 3.5] });
  };
  // the chapel's: a stair down in its floor, its foot toward the gable
  const over = ruins.find(u => u.kind === 'chapel') || ruins.find(u => u.kind === 'hall');
  if (over) crypt('chapel', over.x, over.z, over.a, 6, { ruin: ruins.indexOf(over) });
  for (const u of ruins){
    if (u === over || (u.kind !== 'hall' && u.kind !== 'tower' && u.kind !== 'abbey')) continue;
    // in the floor, along the building's own axis, where the rubble leaves room (the abbey's at its
    // crossing, a grange's in its hall range: ruins.js sets `stair` where it isn't the middle)
    const [cx, cz] = u.stair || [u.x, u.z];
    let spot = null;
    for (let q = 0; q < 120 && !spot; q++){
      const d = q ? 1 + rc() * (u.kind === 'tower' ? 3.5 : 7) : 0, t = rc() * Math.PI * 2, face = u.a + Math.round(rc() * 4) * Math.PI / 2;
      const x = cx + Math.cos(t) * d, z = cz + Math.sin(t) * d;
      if (clearStair(x, z, face)) spot = [x, z, face];
    }
    const floors = u.kind === 'abbey' ? 5 : u.kind === 'hall' ? 3 + (rc() < 0.5 ? 1 : 0) : 1 + (rc() < 0.5 ? 1 : 0);
    if (spot) crypt(u.kind, ...spot, floors, { ruin: ruins.indexOf(u) });
  }

  // a cave with two mouths: steep ground, a crag or hillside facing downhill,
  // with a level spot in front of it to stand on
  const cand = [], G = 12, half = size / 2;
  for (let z = -half + G; z < half - G; z += G) for (let x = -half + G; x < half - G; x += G){
    const s = slopeAt(x, z), dh = height(x, z) - water;
    if (s < 0.3 || s > 0.95 || dh < 3) continue;
    const h = habitat(x, z);
    if (h === 'lake' || h === 'road' || h === 'lane' || h === 'field' || h === 'yard') continue;
    if (!clearOf(x, z)) continue;
    const f = downhill(x, z), sx = x + Math.cos(f) * 5, sz = z + Math.sin(f) * 5;
    if (height(sx, sz) < water + 0.5 || slopeAt(sx, sz) > 0.4 || solidAt(sx, sz, 1)) continue;
    cand.push({ x, z, face: f, stand: [sx, sz], score: (h === 'rock' ? 0.6 : 0) - Math.abs(s - 0.55) + 0.02 * Math.min(dh, 30) + 0.3 * r() });
  }
  cand.sort((a, b) => b.score - a.score);
  const [lo, hi] = [size * 0.09, size * 0.17];               // 290–540u apart in the largest Lea
  let pair = null;
  for (const a of cand.slice(0, 40)){
    const b = cand.find(c => { const d = Math.hypot(c.x - a.x, c.z - a.z); return d > lo && d < hi; });
    if (b){ pair = [a, b]; break; }
  }
  if (pair){
    const id = levels.length;
    levels.push({ id, kind: 'cave', seed: (seed ^ 0xca7e) >>> 0, mouths: pair.map(m => ({ x: m.x, z: m.z, y: height(m.x, m.z), face: m.face })) });
    pair.forEach((m, k) => entrances.push({ level: id, mouth: k, kind: 'cave', x: m.x, z: m.z, y: height(m.x, m.z), face: m.face, stand: m.stand }));
  }

  // the country tombs: on level, dry ground off the roads and away from the villages,
  // the ruins and every other way down, and well apart from each other
  const want = Math.max(1, Math.round(size / 1100)), TG = 16, tc = [];
  for (let z = -half + TG; z < half - TG; z += TG) for (let x = -half + TG; x < half - TG; x += TG){
    if (slopeAt(x, z) > 0.12 || height(x, z) - water < 2) continue;
    const h = habitat(x, z);
    if (h === 'lake' || h === 'road' || h === 'lane' || h === 'field' || h === 'yard' || h === 'green') continue;
    if (!clearOf(x, z) || entrances.some(e => Math.hypot(e.x - x, e.z - z) < 300)) continue;
    tc.push({ x, z, score: rc() });
  }
  tc.sort((a, b) => b.score - a.score);
  let tombs = 0;
  for (const c of tc){
    if (tombs >= want) break;
    if (entrances.some(e => Math.hypot(e.x - c.x, e.z - c.z) < Math.max(300, size * 0.2))) continue;
    const face = Math.round(rc() * 4) * Math.PI / 2 + (rc() - 0.5) * 0.6;
    if (!clearStair(c.x, c.z, face) || slopeAt(c.x + Math.cos(face) * 3.5, c.z + Math.sin(face) * 3.5) > 0.2) continue;
    crypt('tomb', c.x, c.z, face, 1 + (rc() < 0.5 ? 1 : 0), { tomb: tombs++ });
  }
  return { levels, entrances };
}

// ---- the grid ----------------------------------------------------------------------
// A level's bounds in world units, and the arrays for its cells and corners.
export function grid(x0, z0, x1, z1){
  const W = Math.ceil((x1 - x0) / CELL), H = Math.ceil((z1 - z0) / CELL);
  return { x0, z0, W, H, open: new Uint8Array(W * H), floor: new Float32Array(W * H), ceil: new Float32Array(W * H),
    tag: new Uint8Array(W * H) };   // tag: 1 a passage, 2 a chamber, 3 the stair, 4 a room
}
const cellOf = (L, x, z) => [Math.floor((x - L.x0) / CELL), Math.floor((z - L.z0) / CELL)];
const centre = (L, i, j) => [L.x0 + (i + 0.5) * CELL, L.z0 + (j + 0.5) * CELL];
// open every cell within r of (x, z); `rough` roughens the edge
function carve(L, x, z, r, tag, rough = null){
  const R = r + 2;
  const [i0, j0] = cellOf(L, x - R, z - R), [i1, j1] = cellOf(L, x + R, z + R);
  for (let j = Math.max(1, j0); j <= Math.min(L.H - 2, j1); j++) for (let i = Math.max(1, i0); i <= Math.min(L.W - 2, i1); i++){
    const [cx, cz] = centre(L, i, j), d = Math.hypot(cx - x, cz - z);
    if (d < r + (rough ? (rough(cx * 0.25, cz * 0.25) - 0.5) * 2.4 : 0)){
      const k = j * L.W + i;
      L.open[k] = 1;
      if (L.tag[k] < tag) L.tag[k] = tag;
    }
  }
}

// After the cells: corner heights (each the mean of the open cells round it),
// the reveal mask, and the lookups the game walks on.
// open ground, the true shapes of shaped rooms included: the part of a shaped
// room's edge cell outside its wall is rock, unless that cell opens onto another
// region (the mouth of a doorway, where a passage meets the curve)
// Open ground, with the true shapes of shaped rooms: the part of a shaped room's
// edge cell outside its wall is rock, unless another region lies straight on out
// through the wall from it (the mouth of a doorway, where a passage meets the curve).
function openAtOf(L){
  const W = L.W, H = L.H;
  return (x, z) => {
    const [i, j] = cellOf(L, x, z);
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const k = j * W + i; if (L.open[k] !== 1) return false;
    const R = L.regions && L.regions[L.reg[k]];
    if (!R || R.type !== 'shaped' || R.shape.inside(x, z, 0)) return true;
    // out through the wall: away from whichever way the shape lies (an inner, concave
    // wall faces its centre, so this isn't simply away from the centre)
    let ox = 0, oz = 0;
    for (let q = 0; q < 8; q++){ const a = q * Math.PI / 4, cx = Math.cos(a), cz = Math.sin(a); if (R.shape.inside(x + cx * 1.2, z + cz * 1.2, 0)){ ox -= cx; oz -= cz; } }
    if (!ox && !oz){ ox = x - R.shape.cx; oz = z - R.shape.cz; }
    const ol = Math.hypot(ox, oz) || 1;
    for (const d of [0.7, 1.4]){
      const [a, b] = cellOf(L, x + ox / ol * d, z + oz / ol * d), q = b * W + a;
      if (a >= 0 && b >= 0 && a < W && b < H && L.open[q] && L.reg[q] !== L.reg[k]) return true;
    }
    return false;
  };
}

export function finish(L){
  const { W, H } = L, CW = W + 1;
  L.floorC = new Float32Array(CW * (H + 1)); L.ceilC = new Float32Array(CW * (H + 1));
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++){
    let f = 0, c = 0, n = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]){
      if (a < 0 || b < 0 || a >= W || b >= H || !L.open[b * W + a]) continue;
      f += L.floor[b * W + a]; c += L.ceil[b * W + a]; n++;
    }
    L.floorC[j * CW + i] = n ? f / n : 0; L.ceilC[j * CW + i] = n ? c / n : 0;
  }
  L.revealed = new Uint8Array(W * H);
  L.cell = CELL;
  L.isOpen = (x, z) => {
    const [i, j] = cellOf(L, x, z);
    return i >= 0 && j >= 0 && i < W && j < H && L.open[j * W + i] === 1;
  };
  // the floor under (x, z), smooth across the corners
  L.floorAt = (x, z) => {
    const gx = clamp((x - L.x0) / CELL, 0, W - 0.001), gz = clamp((z - L.z0) / CELL, 0, H - 0.001);
    const i = gx | 0, j = gz | 0, fx = gx - i, fz = gz - j, k = j * CW + i;
    return lerp(lerp(L.floorC[k], L.floorC[k + 1], fx), lerp(L.floorC[k + CW], L.floorC[k + CW + 1], fx), fz);
  };
  L.openAt = openAtOf(L);
  L.walkable = (x, z) => {
    for (const [dx, dz] of [[PAD, 0], [-PAD, 0], [0, PAD], [0, -PAD]]) if (!L.openAt(x + dx, z + dz)) return false;
    for (const p of L.props) if (p.solid && (p.r ? Math.hypot(x - p.x, z - p.z) < p.r + PAD : inBox(p, x, z, PAD))) return false;
    for (const w of L.waters) if (Math.hypot(x - w.x, z - w.z) < w.r && L.floorAt(x, z) < w.y - 0.7) return false;   // too deep to wade
    return true;
  };
  return L;
}
// ---- shapes: rooms that aren't rectangles --------------------------------------------
// The grid's walls fall on 2u cell edges, so a curve drawn on it is a staircase.
// A shaped room keeps its true outline: its walls are drawn along it and you
// walk inside it; the cells only say which ground is the room's. Each shape:
//   inside(x, z, pad)  within it, `pad` in from its walls
//   boundary(step)     its walls, as polylines of [x, z] about `step` apart
//                      (an apse's open side, where it meets its chapel, isn't a wall)
const arcPts = (cx, cz, R, a0, a1, step) => { const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * R / step)); return Array.from({ length: n + 1 }, (_, q) => { const a = a0 + (a1 - a0) * q / n; return [cx + Math.cos(a) * R, cz + Math.sin(a) * R]; }); };
const linePts = ([ax, az], [bx, bz], step) => { const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); return Array.from({ length: n + 1 }, (_, q) => [ax + (bx - ax) * q / n, az + (bz - az) * q / n]); };
export function circleShape(cx, cz, R){
  return { kind: 'circle', cx, cz, R, inside: (x, z, pad = 0) => Math.hypot(x - cx, z - cz) < R - pad,
    boundary: step => [arcPts(cx, cz, R, 0, Math.PI * 2, step)] };
}
// a semicircle on the side of (dx, dz) from its centre; the diameter is open, onto its chapel
export function apseShape(cx, cz, R, dx, dz){
  const a0 = Math.atan2(dz, dx);
  return { kind: 'apse', cx, cz, R, dx, dz, inside: (x, z, pad = 0) => Math.hypot(x - cx, z - cz) < R - pad && (x - cx) * dx + (z - cz) * dz > -0.01,
    boundary: step => [arcPts(cx, cz, R, a0 - Math.PI / 2, a0 + Math.PI / 2, step)] };
}
// a regular polygon of n sides, apothem a, its first side facing angle rot
export function polyShape(cx, cz, n, a, rot = 0){
  const nrm = Array.from({ length: n }, (_, k) => rot + k * Math.PI * 2 / n), Rc = a / Math.cos(Math.PI / n);
  const verts = Array.from({ length: n }, (_, k) => { const t = rot + (k + 0.5) * Math.PI * 2 / n; return [cx + Math.cos(t) * Rc, cz + Math.sin(t) * Rc]; });
  return { kind: 'poly', cx, cz, n, a, rot, verts,
    inside: (x, z, pad = 0) => nrm.every(t => (x - cx) * Math.cos(t) + (z - cz) * Math.sin(t) < a - pad),
    // how far the wall is from the centre, looking along angle th
    wallAt: th => a / Math.max(...nrm.map(t => Math.cos(th - t))),
    boundary: step => [verts.map((v, k) => linePts(v, verts[(k + 1) % verts.length], step)).flatMap((seg, k) => k ? seg.slice(1) : seg)] };
}
// a half-ring, radii ri..ro, on the side of (dx, dz): the U of an ambulatory
export function uShape(cx, cz, ri, ro, dx, dz){
  const a0 = Math.atan2(dz, dx), A = a0 - Math.PI / 2, B = a0 + Math.PI / 2;
  const P = (r, a) => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  return { kind: 'u', cx, cz, ri, ro, dx, dz,
    inside: (x, z, pad = 0) => { const r = Math.hypot(x - cx, z - cz); return r > ri + pad && r < ro - pad && (x - cx) * dx + (z - cz) * dz > pad; },
    boundary: step => [arcPts(cx, cz, ro, A, B, step), arcPts(cx, cz, ri, A, B, step), linePts(P(ri, A), P(ro, A), step), linePts(P(ri, B), P(ro, B), step)] };
}
export function inBox(b, x, z, pad = 0){
  const c = Math.cos(b.a), s = Math.sin(b.a), dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * c + dz * s) < b.hl + pad && Math.abs(-dx * s + dz * c) < b.hw + pad;
}
// where you come in at a mouth: a few steps inside, facing in
function arrival(L, m){
  for (let d = 4; d < 30; d += 1){
    const x = m.x - Math.cos(m.face) * d, z = m.z - Math.sin(m.face) * d;
    if (L.walkable(x, z)) return [x, z];
  }
  return [m.x, m.z];
}

// The level for a plan entry: { id, kind, x0, z0, W, H, open, floorC, ceilC,
// mouths: [{ x, z, y, face, inX, inZ }], props, finds, water, glow, revealed,
// floorAt, walkable, isOpen }
export function buildLevel(spec){
  const L = spec.kind === 'cave' ? buildCave(spec) : buildCrypt(spec);
  L.id = spec.id; L.kind = spec.kind;
  finish(L);
  for (const m of L.mouths){ const [x, z] = arrival(L, m); m.inX = x; m.inZ = z; }
  if (L.cavern?.lake) launch(L);
  return L;
}
// The great lake's canoe and its eels: a canoe pulled up where the way down comes to the
// water, bow out; and the lake's deep water an eel ground, fished from the canoe.
// `L.floats(x, z)`: deep enough to paddle there (the hull draws about 0.15u; a little more,
// so it noses up to the shore and stops)
function launch(L){
  const lake = L.cavern.lake, [ex, ez] = L.cavern.entry;
  L.floats = (x, z) => Math.hypot(x - lake.x, z - lake.z) < lake.r && L.floorAt(x, z) < lake.y - 0.3 &&
    [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]].every(([dx, dz]) => L.openAt(x + dx, z + dz));
  L.eelsAt = (x, z) => L.floats(x, z) && L.floorAt(x, z) < lake.y - 2;    // eels lie in the deep, not the shallows
  const d = Math.hypot(lake.x - ex, lake.z - ez) || 1, ux = (lake.x - ex) / d, uz = (lake.z - ez) / d;
  for (let s = 0; s < d; s += 0.5){
    const x = ex + ux * s, z = ez + uz * s;
    if (!L.floats(x, z)) continue;
    L.canoe = { x: x + ux * 0.6, z: z + uz * 0.6, yaw: Math.atan2(-ux, -uz) };   // (forward is -Z at yaw 0)
    break;
  }
  L.eels = { kind: 'eels', stock: 1, boat: true };
}

// ---- caves -------------------------------------------------------------------------
// A passage wanders from mouth to mouth under the hill, narrowing and opening
// out; side passages leave it and end in chambers, one of them holding a pool.
// The floor runs down from each mouth and rises again, the ceiling stands
// higher the further you are from a wall.
function buildCave(spec){
  const r = mulberry32(spec.seed), rough = noise2(spec.seed & 0xffff), wob = noise2((spec.seed >>> 8) & 0xffff);
  const [A, B] = spec.mouths;
  const M = 300;                                           // room round the mouths for the deep and its caverns
  const L = grid(Math.min(A.x, B.x) - M, Math.min(A.z, B.z) - M, Math.max(A.x, B.x) + M, Math.max(A.z, B.z) + M);
  L.mouths = spec.mouths.map(m => ({ ...m }));
  L.props = []; L.finds = []; L.glow = []; L.waters = [];
  // the main passage: in from each mouth along its own axis, then a wandering
  // line between, displaced from the straight by halving steps
  const ina = [A.x - Math.cos(A.face) * 14, A.z - Math.sin(A.face) * 14], inb = [B.x - Math.cos(B.face) * 14, B.z - Math.sin(B.face) * 14];
  let pts = [ina, inb];
  for (let amp = Math.hypot(inb[0] - ina[0], inb[1] - ina[1]) * 0.22; amp > 6; amp *= 0.5){
    const o = [pts[0]];
    for (let k = 0; k + 1 < pts.length; k++){
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1], l = Math.hypot(bx - ax, bz - az) || 1, d = (r() - 0.5) * 2 * amp;
      o.push([(ax + bx) / 2 - (bz - az) / l * d, (az + bz) / 2 + (bx - ax) / l * d], pts[k + 1]);
    }
    pts = o;
  }
  pts = [[A.x, A.z], ...pts, [B.x, B.z]];
  const path = [];                                         // every metre or so, with how far along
  let along = 0;
  for (let k = 0; k + 1 < pts.length; k++){
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], l = Math.hypot(bx - ax, bz - az);
    for (let s = 0; s < l; s += 1.2){ path.push([ax + (bx - ax) * s / l, az + (bz - az) * s / l, along + s]); }
    along += l;
  }
  const total = along;
  for (const [x, z, s] of path){
    const nearMouth = Math.min(s, total - s) < 10;
    carve(L, x, z, nearMouth ? 2.4 : 2.2 + 2.6 * wob(s * 0.05, 3.1), 1, nearMouth ? null : rough);
  }
  // chambers: two along the way, and one at the end of each side passage
  const chambers = [];
  const chamber = (x, z, R) => {
    for (let q = 0; q < 3; q++) carve(L, x + (r() - 0.5) * R * 0.8, z + (r() - 0.5) * R * 0.8, R * (0.55 + r() * 0.35), 2, rough);
    chambers.push({ x, z, R });
  };
  for (const f of [0.3 + r() * 0.1, 0.62 + r() * 0.1]){ const [x, z] = path[Math.floor(f * (path.length - 1))]; chamber(x, z, 11 + r() * 7); }
  // the ways you walk (the main passage, the way down): kept clear of dripstone
  const lane = new Uint8Array(L.W * L.H);
  const keepClear = (x, z, R = 2.6) => {
    const [i0, j0] = cellOf(L, x - R, z - R), [i1, j1] = cellOf(L, x + R, z + R);
    for (let j = Math.max(0, j0); j <= Math.min(L.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(L.W - 1, i1); i++){ const [cx, cz] = centre(L, i, j); if (Math.hypot(cx - x, cz - z) < R + 1) lane[j * L.W + i] = 1; }
  };
  for (const [x, z] of path) keepClear(x, z);
  // The deep (docs/under.md, "The deep"): a passage leaves the main one where no chamber
  // is near and winds down into a great cavern far under it, a lake in its low half.
  // Every cell it opens remembers how far down it lies (`deep`), so the floors below can
  // be laid from it: the cavern's all at the bottom, the rest as deep as the nearest
  // point of the way down (so the hall on the way slopes with it, and no ledge opens where
  // they meet); cells already open keep theirs, so no cliff opens in the passage.
  const deep = new Float32Array(L.W * L.H), was = L.open.slice(), zone = new Uint8Array(L.W * L.H), deepPts = [];
  const D = 30 + r() * 14;                                 // 20–30 m under the passage it leaves
  const carveDeep = (x, z, R, cavern = false, tag = 1) => {
    carve(L, x, z, R, tag, rough);
    const [i0, j0] = cellOf(L, x - R - 2, z - R - 2), [i1, j1] = cellOf(L, x + R + 2, z + R + 2);
    for (let j = Math.max(0, j0); j <= Math.min(L.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(L.W - 1, i1); i++){
      const k = j * L.W + i; if (L.open[k] && !was[k]) zone[k] = Math.max(zone[k], cavern ? 2 : 1);
    }
  };
  let cav = null; const halls = [];
  {
    let p = null;
    for (let q = 0; q < 24 && !p; q++){ const c = path[Math.floor((0.35 + 0.3 * r()) * (path.length - 1))]; if (chambers.every(h => Math.hypot(h.x - c[0], h.z - c[1]) > h.R + 22)) p = c; }
    p = p || path[path.length >> 1];
    const n = path[Math.min(path.length - 1, path.indexOf(p) + 3)], along = Math.atan2(n[1] - p[1], n[0] - p[0]);
    // off to whichever side has more room before the grid's edge
    const room = s => { const a = along + s * Math.PI / 2; let d = 0; for (; d < 400; d += 4){ const [i, j] = cellOf(L, p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d); if (i < 3 || j < 3 || i > L.W - 4 || j > L.H - 4) break; } return d; };
    const a0 = along + (room(1) >= room(-1) ? 1 : -1) * Math.PI / 2, BL = 125 + r() * 30;   // (long enough for a hall clear of the great cavern)
    const CR = 55 + r() * 12;                             // the great cavern's radius
    let a = a0, x = p[0], z = p[1];
    // down along an S-curve, level at the bottom for the last stretch: the cavern reaches back
    // over it, and its floor is all at the full depth
    const fall = s => { const t = clamp((s - 12) / (BL - 12 - CR * 0.5), 0, 1); return D * t * t * (3 - 2 * t); };
    for (let s = 0; s < BL; s += 1.2){
      a += (r() - 0.5) * 0.3 + (a0 - a) * 0.04; x += Math.cos(a) * 1.2; z += Math.sin(a) * 1.2;
      carveDeep(x, z, 2.6 + 1.4 * wob(s * 0.07, 9.1));
      deepPts.push([x, z, fall(s)]); keepClear(x, z);
    }
    const nB = deepPts.length, entry = [x, z];
    // the cavern, several times a chamber, and a great lake filling its far side
    const cx = x + Math.cos(a) * CR * 0.7, cz = z + Math.sin(a) * CR * 0.7;
    for (let s = 0; s < CR * 0.7; s += 1.2){ const px = x + Math.cos(a) * s, pz = z + Math.sin(a) * s; carveDeep(px, pz, 2.6); deepPts.push([px, pz, D]); keepClear(px, pz); }
    carveDeep(cx, cz, CR * 0.6, true, 2);
    for (let q = 0; q < 6; q++){ const t = r() * Math.PI * 2, d = r() * CR * 0.45; carveDeep(cx + Math.cos(t) * d, cz + Math.sin(t) * d, CR * (0.45 + r() * 0.25), true, 2); }
    const side = (r() - 0.5) * 0.8, LR = CR * (0.62 + r() * 0.1);
    cav = { x: cx, z: cz, R: CR, lx: cx + Math.cos(a + side) * CR * 0.3, lz: cz + Math.sin(a + side) * CR * 0.3, LR, H: 18 + r() * 10, entry };
    carveDeep(cav.lx, cav.lz, LR * 1.05, true, 2);          // the lake's whole bowl is open: its water never runs into the rock
    // partway down, a dry hall of dripstone, where it's well clear of the cavern and of the
    // passage it left (its floor slopes with the way down: touching either, it would end on a ledge)
    const HR = 14 + r() * 6, ok = deepPts.slice(0, nB).filter(([hx, hz]) => Math.hypot(hx - cx, hz - cz) > HR + CR * 1.2 + 14 && Math.hypot(hx - p[0], hz - p[1]) > HR + 16);
    if (ok.length){
      const [hx, hz] = ok[(ok.length * (0.3 + r() * 0.4)) | 0];
      for (let q = 0; q < 4; q++) carveDeep(hx + (r() - 0.5) * HR * 0.8, hz + (r() - 0.5) * HR * 0.8, HR * (0.55 + r() * 0.3), false, 2);
      halls.push({ x: hx, z: hz, R: HR });
    }
    for (let k = 0; k < L.W * L.H; k++){
      if (zone[k] === 2){ deep[k] = D; continue; }
      if (!zone[k]) continue;
      const [x, z] = centre(L, k % L.W, (k / L.W) | 0);
      let best = Infinity;
      for (const [px, pz, v] of deepPts){ const d = (px - x) ** 2 + (pz - z) ** 2; if (d < best){ best = d; deep[k] = v; } }
    }
  }
  L.deep = deep; L.cavern = cav; L.halls = halls;
  const nearDeep = (x, z) => (cav && Math.hypot(x - cav.x, z - cav.z) < cav.R + 12) || halls.some(h => Math.hypot(x - h.x, z - h.z) < h.R + 12) || deepPts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 10);
  const sides = 3 + Math.floor(total / 160);
  for (let b = 0; b < sides; b++){
    const p = path[Math.floor((0.15 + 0.7 * r()) * (path.length - 1))], [nx, nz] = path[Math.min(path.length - 1, path.indexOf(p) + 3)];
    let a = Math.atan2(nz - p[1], nx - p[0]) + (r() < 0.5 ? 1 : -1) * (0.7 + r() * 1.0);
    let x = p[0], z = p[1], cut = false;
    const len = 40 + r() * 80;
    for (let s = 0; s < len; s += 1.2){
      a += (r() - 0.5) * 0.25; x += Math.cos(a) * 1.2; z += Math.sin(a) * 1.2;
      if (nearDeep(x, z)){ cut = true; break; }            // a side passage never breaks into the deep: it would open on a cliff
      carve(L, x, z, 1.8 + 1.2 * wob(s * 0.07, b * 7.3), 1, rough);
    }
    if (!cut) chamber(x, z, 8 + r() * 8);
  }
  // floors: down from both mouths into the hill and up again, a little uneven;
  // the furthest chamber from either mouth holds a pool
  const depth = Math.min(16, total * 0.05);
  const pool = chambers.reduce((best, c) => {
    const d = Math.min(Math.hypot(c.x - A.x, c.z - A.z), Math.hypot(c.x - B.x, c.z - B.z));
    return !best || d > best.d ? { ...c, d } : best;
  }, null);
  const dx = B.x - A.x, dz = B.z - A.z, dl = dx * dx + dz * dz || 1;
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * L.W + i; if (!L.open[k]) continue;
    const [x, z] = centre(L, i, j), t = clamp(((x - A.x) * dx + (z - A.z) * dz) / dl, 0, 1);
    const toMouth = Math.min(Math.hypot(x - A.x, z - A.z), Math.hypot(x - B.x, z - B.z));
    let f = lerp(A.y, B.y, t) - depth * clamp(toMouth / 60, 0, 1) + (wob(x * 0.06, z * 0.06) - 0.5) * 3 - deep[k];
    if (pool){ const d = Math.hypot(x - pool.x, z - pool.z); if (d < pool.R) f -= 2.2 * (1 - d / pool.R) ** 0.7; }
    // the cavern's floor runs gently down to its lake, and the lake's bed falls away steeply
    if (cav && deep[k] > D * 0.9){
      const dc = Math.hypot(x - cav.lx, z - cav.lz);
      f -= 2 * clamp(1 - dc / (cav.R * 1.3), 0, 1);
      if (dc < cav.LR) f -= 5.5 * (1 - (dc / cav.LR) ** 2);
    }
    L.floor[k] = f;
  }
  smoothOpen(L, L.floor, 3);
  L.waters = [];
  if (pool){
    let rim = Infinity;
    for (let q = 0; q < 16; q++){ const a = q / 16 * Math.PI * 2, x = pool.x + Math.cos(a) * pool.R * 0.9, z = pool.z + Math.sin(a) * pool.R * 0.9, [i, j] = cellOf(L, x, z), k = j * L.W + i; if (L.open[k]) rim = Math.min(rim, L.floor[k]); }
    if (Number.isFinite(rim)) L.waters.push({ x: pool.x, z: pool.z, r: pool.R * 1.1, y: rim - 0.5 });
  }
  // the lake: its water stands at the middle of its rim, so it laps up onto the low side's shore
  if (cav){
    const rim = [];
    for (let q = 0; q < 32; q++){ const a = q / 32 * Math.PI * 2, [i, j] = cellOf(L, cav.lx + Math.cos(a) * cav.LR * 0.9, cav.lz + Math.sin(a) * cav.LR * 0.9), k = j * L.W + i; if (L.open[k]) rim.push(L.floor[k]); }
    rim.sort((a, b) => a - b);
    if (rim.length > 8) L.waters.push(cav.lake = { x: cav.lx, z: cav.lz, r: cav.LR * 1.25, y: rim[rim.length >> 1] + 0.3, lake: true });
    // the cavern's floor, for its vault: the mean of its dry cells
    let s = 0, n = 0;
    for (let k = 0; k < L.W * L.H; k++) if (L.open[k] && deep[k] > D * 0.9){ const [x, z] = centre(L, k % L.W, (k / L.W) | 0); if (Math.hypot(x - cav.lx, z - cav.lz) > cav.LR){ s += L.floor[k]; n++; } }
    cav.base = n ? s / n : L.floor[cellOf(L, cav.x, cav.z)[1] * L.W + cellOf(L, cav.x, cav.z)[0]];
  }
  // ceilings: higher away from the walls, so chambers vault and passages stoop; the cavern
  // vaults high over its floor (and its lake) from its own floor level, not the lake bed
  ceilings(L, (k, x, z) => {
    const c = L.floor[k] + 3.4 + Math.min(wallDist(L, k) * 0.8, 9) + (rough(x * 0.15, z * 0.15) - 0.5) * 1.6;
    return cav && deep[k] > D * 0.9 ? Math.max(c, cav.base + 4 + Math.min(wallDist(L, k) * 1.2, cav.H) + (rough(x * 0.08, z * 0.08) - 0.5) * 4) : c;
  });
  // finds: quartz in the chambers, mushrooms in the damp near the mouths;
  // a glow of fungus along the walls of a few chambers
  for (const c of chambers){
    if (r() < 0.75){ const p = openNear(L, c.x, c.z, c.R * 0.7, r); if (p) L.finds.push({ x: p[0], z: p[1], kind: 'quartz', n: 1 + ((r() * 2) | 0) }); }
    if (r() < 0.5) glowAround(L, c, r);
  }
  for (const m of spec.mouths){
    const p = openNear(L, m.x - Math.cos(m.face) * 22, m.z - Math.sin(m.face) * 22, 8, r);
    if (p) L.finds.push({ x: p[0], z: p[1], kind: 'mushrooms', n: 2 + ((r() * 3) | 0) });
  }
  if (cav){
    // the deep glows: the cavern's walls thick with it, up into the dark, and patches down the way
    glowAround(L, cav, r, 0.55, 5);
    for (let q = 10; q < deepPts.length; q += 18){ const [x, z] = deepPts[q]; glowAround(L, { x, z, R: 3 }, r, 0.4, 1.5); }
    for (const h of halls) glowAround(L, h, r, 0.3, 3);
  }
  dripstone(L, r, chambers, halls, cav, lane);
  if (cav) deepFinds(L, r, cav, deep, D);
  return L;
}
// Dripstone (docs/under.md, "The deep"): where water drips, a stalactite hangs and a
// stalagmite grows under it; where they've met, a column. Thick in the cavern, a few in
// each chamber, none over the ways you walk (`lane`). Stalagmites and columns are solid,
// spaced so you can always pass between them; over the lake only stalactites hang.
function dripstone(L, r, chambers, halls, cav, lane){
  L.drips = [];
  const solid = [];
  const place = (c, n, big) => {
    for (let q = 0, got = 0; q < n * 6 && got < n; q++){
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * c.R, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const [i, j] = cellOf(L, x, z), k = j * L.W + i;
      if (i < 1 || j < 1 || i >= L.W - 1 || j >= L.H - 1 || !L.open[k] || lane[k]) continue;
      if (![[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([dx, dz]) => openCell(L, x + dx, z + dz))) continue;
      const fy = L.floor[k], cy = L.ceil[k], wet = L.waters.find(w => Math.hypot(x - w.x, z - w.z) < w.r && fy < w.y + 0.2);
      const lt = Math.min((cy - fy) * 0.45, 0.4 + r() * r() * (big ? 5 : 2.4)), rt = 0.12 + lt * 0.11;
      let hm = wet || r() > 0.7 ? 0 : 0.3 + r() * r() * (big ? 4 : 2.2), rm = 0.18 + hm * 0.16;
      const column = hm > 0 && (fy + hm >= cy - lt - 0.4 || r() < (big ? 0.06 : 0.2));   // or long since met: a column up to the roof
      if (column){ hm = cy - fy; rm = Math.max(rm, rt) * 1.3; }
      if (hm > 0.6 && solid.some(s => Math.hypot(s.x - x, s.z - z) < s.r + rm + 1.0)) continue;   // a body's width between any two
      L.drips.push({ x, z, fy, cy, lt: column ? 0 : lt, rt, hm, rm, column });
      if (hm > 0.6){ const p = { kind: column ? 'dripcolumn' : 'stalagmite', x, z, r: rm, y: fy, h: hm, solid: true }; L.props.push(p); solid.push(p); }
      got++;
    }
  };
  for (const c of chambers) place(c, 4 + ((r() * 6) | 0), false);
  for (const h of halls) place(h, 25 + ((r() * 15) | 0), true);
  if (cav) place(cav, 70 + ((r() * 40) | 0), true);
}
// Books (docs/under.md, "Books"): shelves where the brothers kept them. The cellarer's
// kitchen books in the undercroft, a book cupboard in the cloister's outer wall, a shelf
// in the chapter house (standing clear of its bench); the abbey's crypt has more of each.
// Most have rotted; about one in three still holds a book you can read. Each readable book
// gets a deal number (`book`, the level's id plus its count), and stillroom.js shelfBook deals
// the book recipes round by it, so neighbouring crypts in the plan hold different ones. A
// mouldy shelf in the chapter house still holds its still-room book, kept dry in a case.
const SHELVES = { undercroft: 2, cloister: 2, chapterhouse: 1 };
function shelves(L, r, spec, runsOf, at, isOpen){
  L.shelves = [];
  const palace = L.site === 'palace', more = L.site === 'abbey' ? 1 : palace ? 2 : 0, W = 2.4, D = 0.5;
  for (const sp of L.special || []){
    const want = SHELVES[sp.kind]; if (!want) continue;
    let walls = sp.regions.flatMap(R => runsOf(R).map(run => ({ run, R })));
    if (sp.kind === 'cloister'){                           // the outer walls, not the garth's arcade
      const [gx, gz] = at((sp.st[0] + sp.st[1]) / 2, (sp.st[2] + sp.st[3]) / 2);
      walls = walls.filter(({ run }) => Math.sign(gx - (run.horiz ? (run.a0 + run.a1) / 2 : run.line)) * run.nx + Math.sign(gz - (run.horiz ? run.line : (run.a0 + run.a1) / 2)) * run.nz >= 0);
    }
    walls = walls.filter(({ run }) => run.len >= W + 2);
    for (let i = walls.length - 1; i > 0; i--){ const j = (r() * (i + 1)) | 0; [walls[i], walls[j]] = [walls[j], walls[i]]; }
    let got = 0;
    for (const { run, R } of walls){
      if (got >= want + more) break;
      const off = (sp.kind === 'chapterhouse' ? 0.8 + 0.1 : 0.05) + D / 2;   // out from the wall (past the chapter house's bench)
      for (let q = 0; q < 6; q++){
        const a = run.a0 + W / 2 + 1 + r() * (run.len - W - 2);
        const pt = o => run.horiz ? [a, run.line + run.nz * o] : [run.line + run.nx * o, a];
        const [x, z] = pt(off), [fx, fz] = pt(off + 1.3);
        const cell = (px, pz) => isOpen(Math.floor((px - L.x0) / CELL), Math.floor((pz - L.z0) / CELL));
        if (!cell(x, z) || !cell(fx, fz)) continue;
        if (L.props.some(p => p.solid && Math.hypot(p.x - x, p.z - z) < (p.r || Math.max(p.hl, p.hw)) + W / 2 + 0.6)) continue;
        if (L.sconces.some(s => Math.hypot(s.x - x, s.z - z) < W / 2 + 0.6) || L.shelves.some(s => Math.hypot(s.x - x, s.z - z) < W + 1)) continue;
        const v = r(), state = palace || v < 0.34 ? 'book' : v < 0.7 ? 'ruined' : 'rotted';   // nothing rots in Faerie
        const s = { x, z, face: Math.atan2(run.nz, run.nx), back: off, w: W, d: D, h: state === 'rotted' ? 1.6 : 2.2, y: R.y, state, seed: (r() * 1e9) | 0, room: sp.kind, ...(palace ? { palace: true } : {}) };
        // (a palace's id is a name: it deals by its door's number, seven books apart, so the
        // palaces between them hold every book in faerie-books.js)
        if (state === 'book') s.book = (palace ? spec.door * 7 : typeof spec.id === 'number' ? spec.id : spec.seed % 97) + L.shelves.filter(o => o.state === 'book').length;
        L.shelves.push(s);
        L.props.push({ kind: 'shelf', x, z, a: run.horiz ? 0 : Math.PI / 2, hl: W / 2, hw: D / 2, y: R.y, h: s.h, solid: true });
        got++; break;
      }
    }
  }
}
// what only the deep gives (docs/under.md, "The deep"; recipes.js RARE): foxfire from
// the glow on its walls, cave salt crusted on the lake shore, blindfish in its shallows
function deepFinds(L, r, cav, deep, D){
  const clear = (x, z) => !L.props.some(p => p.solid && Math.hypot(x - p.x, z - p.z) < p.r + 0.9);
  const pick = (cands, n, make) => { for (let got = 0; got < n && cands.length;){ const c = cands.splice((r() * cands.length) | 0, 1)[0]; if (clear(c[0], c[1])){ L.finds.push(make(c)); got++; } } };
  const glow = L.glow.filter(g => deep[g.k] > D * 0.5).map(g => centre(L, g.k % L.W, (g.k / L.W) | 0));
  pick(glow, 3, ([x, z]) => ({ x, z, kind: 'foxfire', n: 1 + ((r() * 2) | 0) }));
  const lake = cav.lake; if (!lake) return;
  const shore = [], shallow = [];
  for (let k = 0; k < L.W * L.H; k++){
    if (!L.open[k] || deep[k] < D * 0.9) continue;
    const [x, z] = centre(L, k % L.W, (k / L.W) | 0); if (Math.hypot(x - lake.x, z - lake.z) > lake.r) continue;
    const f = L.floor[k] - lake.y;
    if (f > 0.1 && f < 0.7) shore.push([x, z]); else if (f > -0.6 && f < -0.2) shallow.push([x, z]);
  }
  pick(shore, 2, ([x, z]) => ({ x, z, kind: 'cave salt', n: 1 + ((r() * 2) | 0) }));
  pick(shallow, 2, ([x, z]) => ({ x, z, y: lake.y - 0.15, kind: 'blindfish', n: 1 + ((r() * 2) | 0) }));
}

// ---- crypts ------------------------------------------------------------------------
// Three floors, each about 8u (5 m) under the last, joined by long stairs. The
// floors lie one after another under the land along the chapel's axis (snapped
// to the world's axes, so walls fall on the grid), not stacked: the same grid
// and walking serve every floor.
//
// Architecture rather than a height per cell: every room is barrel-vaulted
// along its length, every passage is a round tunnel vault, every stair a vault
// that falls with it. Where a passage meets a room, the room's wall above it is
// cut to the passage's curve, which is an arched doorway (trimmed with a ring
// of voussoirs in the view). Floor 2 has a great hall, a nave between two rows
// of round columns carrying arcades; floor 3 a columned crossing. Rooms hold
// coffins, torches on the walls, and tapestries.
// floors: their lengths along the way down, and the stairs between them (run,
// drop). The last floor holds the cathedral, at the foot of a great stair.
// Grander as you go down: the floors under the cathedral are longer and wider,
// their rooms bigger and higher (GRAND), gilded (from the cathedral down: gold
// bosses; the last two: gold ribs and capitals too, and gold mosaic vaults).
const LENS = [96, 96, 96, 176, 200, 220], RUNS = [32, 32, 60, 44, 52], DROPS = [8, 8, 20, 14, 16], FLOORS = LENS.length;
const HALFS = [46, 46, 46, 46, 62, 70], HALF_T = Math.max(...HALFS), GRAND = [1, 1, 1.1, 1.2, 1.5, 1.7];
const STARTS = LENS.reduce((a, l, k) => (a.push(k ? a[k - 1] + LENS[k - 1] + RUNS[k - 1] : 0), a), []);
// the same, for a crypt and for a Faerie palace (whose floors are twice the size, its rooms
// the grandest and grander yet: GRAND scales their spans and lifts their vaults)
const tables = (LENS, RUNS, DROPS, HALFS, GRAND) => ({ LENS, RUNS, DROPS, HALFS, GRAND, HALF_T: Math.max(...HALFS),
  STARTS: LENS.reduce((a, l, k) => (a.push(k ? a[k - 1] + LENS[k - 1] + RUNS[k - 1] : 0), a), []) });
const CRYPT_T = tables(LENS, RUNS, DROPS, HALFS, GRAND), PALACE_T = tables([200, 210], [56], [18], [76, 80], [2, 2.2]);
// Cathedral and hall-crypt vaults (docs/under.md, "Cathedrals"): a bay is a
// groin or rib vault, the union of two tunnels crossing, so its ceiling is the
// higher of the two arches over it. Gothic arches are pointed (equilateral,
// struck from the opposite springing), Romanesque round.
const pointed = t => Math.sqrt(Math.max(0, 4 - (t + 1) * (t + 1))) / Math.sqrt(3);   // 1 at the crown, 0 at the springing
const round = t => Math.sqrt(Math.max(0, 1 - t * t));
export const TAPESTRIES = ['tapestry-round-dance', 'tapestry-chaumont-youth', 'tapestry-chaumont-time', 'tapestry-mystical-grapes', 'tapestry-millefleurs'];
export const WAGARA = ['wagara-seigaiha', 'wagara-asanoha', 'wagara-kikko', 'wagara-shippo'];
// what a region's walls are: three bonds of ashlar, or cut from the living rock
// (deeper is rougher), and the carved patterns its reliefs may take
const FRIEZE = ['chevron', 'guilloche', 'billet', 'dogtooth', 'scroll'];
const PANEL = ['rosette', 'interlace', 'wagara-seigaiha', 'wagara-asanoha'];
// Each crypt its own: its stone (the view tints the walls by it), how much of it is cut
// from the rock, how often its rooms are painted, carved and hung, which carvings it
// favours, and which rooms each floor holds. The chapel's is the plain default, so it
// stays as it was; the others draw theirs from their seed.
export const STONES = { grey: [1, 1, 1], limestone: [1.1, 1.06, 0.95], sandstone: [1.12, 0.95, 0.76], redstone: [1.08, 0.8, 0.7], granite: [0.86, 0.89, 0.94], slate: [0.72, 0.73, 0.76], chalk: [1.2, 1.17, 1.1] };
// the rooms a floor may hold, by how deep it is; and the showpiece for a fourth floor (the abbey's is always the great basilica)
const ROOM_POOLS = [
  ['hallcrypt', 'chapel', 'hall', 'undercroft', 'rotunda', 'chapterhouse'],
  ['hall', 'basilica', 'chapterhouse', 'rotunda', 'crossing', 'undercroft', 'chapel', 'octagon'],
  ['crossing', 'cloister', 'undercroft', 'ambulatory', 'basilica', 'octagon', 'chapterhouse', 'rotunda'],
];
const SHOWPIECES = ['greatbasilica', 'grandrotunda'];
// A Faerie palace (gen/faerie.js palaceSpec) is a crypt in its own style: chalk and polished
// marble, never rock-cut, nothing rotted or buried; tall passages, every light burning, and
// shelves of whole books. Its floors are twice a crypt's (PALACE_T), and hold the grandest
// rooms: a cathedral, the gilded hall, the great rotunda or basilica, with a library on each.
const PALACE_FLOORS = [['cathedral', ['grandrotunda', 'octagon'], 'chapterhouse'], ['gilthall', ['greatbasilica', 'grandrotunda'], 'cloister']];
function cryptStyle(spec){
  const shuffle = (a, r) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--){ const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  if (spec.site === 'palace'){
    const r = mulberry32((spec.seed ^ 0xfa1ace) >>> 0), n = spec.floors || 2;
    const program = Array.from({ length: n }, (_, fl) => PALACE_FLOORS[fl % 2].map(k => Array.isArray(k) ? k[(r() * k.length) | 0] : k));
    return { palace: true, stone: 'chalk', hewn: 0, frescoP: 0.9, decor: 1.4, tapP: 0.9, medieval: 0.6, medieval0: 0.6, coffins: 0,
      friezes: shuffle(FRIEZE, r).slice(0, 2), panels: shuffle(PANEL, r).slice(0, 2), program, salt: 1 + ((r() * 1e9) | 0) };
  }
  if (!spec.site || spec.site === 'chapel') return { stone: 'grey', hewn: 0, frescoP: 0.25, decor: 1, tapP: 0.6, medieval: 0.75, medieval0: 0.35, friezes: FRIEZE, panels: PANEL, program: null, coffins: 0.7 };
  const r = mulberry32((spec.seed ^ 0x5717e) >>> 0), names = Object.keys(STONES).slice(1);
  const n = spec.floors || 1, used = new Set(), program = [];
  for (let fl = 0; fl < n; fl++){
    if (fl === 3){ const sp = SHOWPIECES[(r() * SHOWPIECES.length) | 0]; program.push([spec.site === 'abbey' ? 'greatbasilica' : sp, shuffle(['octagon', 'chapel', 'chapterhouse', 'ambulatory'], r)[0]]); continue; }
    const want = (spec.site === 'hall' || spec.site === 'abbey' ? 2 : 1) + (r() < 0.5 ? 1 : 0), pool = shuffle(ROOM_POOLS[Math.min(2, fl)], r);
    const pickd = [...pool.filter(k => !used.has(k)), ...pool.filter(k => used.has(k))].slice(0, want);
    pickd.forEach(k => used.add(k)); program.push(pickd);
  }
  return {
    stone: spec.stone || names[(r() * names.length) | 0],
    hewn: spec.site === 'tomb' ? 0.4 + r() * 0.5 : r() * 0.3,       // a country tomb is half a catacomb, cut from the rock
    frescoP: r() * 0.5, decor: 0.4 + r() * 1.0, tapP: r() * 0.9, medieval: r(), coffins: 0.5 + r() * 0.45,
    friezes: shuffle(FRIEZE, r).slice(0, 2), panels: shuffle(PANEL, r).slice(0, 2), program, salt: 1 + ((r() * 1e9) | 0),
  };
}
const FINISH_BY_FLOOR = [
  [['A', 0.45], ['B', 0.35], ['C', 0.1], ['hewn', 0.1]],
  [['A', 0.25], ['B', 0.25], ['C', 0.15], ['hewn', 0.35]],
  [['A', 0.1], ['B', 0.1], ['hewn', 0.8]],
  // the two deepest floors: mostly faced in polished marble ('M', bookmatched slabs)
  [['M', 0.6], ['C', 0.15], ['hewn', 0.25]],
];

// the vault over a region at (x, z), and its floor
function regionCeil(R, x, z){
  const a = R.axis === 'x' ? z : x;
  if (R.type === 'room'){ const v = (a - R.c) / R.hs; return R.spring + R.rise * Math.sqrt(Math.max(0, 1 - v * v)); }
  if (R.type === 'shaped') return R.ceilFn(x, z);
  if (R.type === 'vault'){
    // pu, pv: the springing inset, how far in from a bay line its arches start: a
    // pier carries its arches from the edges of its capital, so between two bays
    // there's a band as wide as the pier (the transverse arch's soffit), not a point
    const u = R.axis === 'x' ? x : z, [bu, bv] = bayAt(R, u, a), f = R.round ? round : pointed;
    const tu = Math.min(1, Math.abs(u - bu) / (R.bayU / 2 - (R.pu || 0))), tv = Math.min(1, Math.abs(a - bv) / (R.bayV / 2 - (R.pv || 0)));
    return R.spring + R.H * Math.max(f(tu), f(tv));
  }
  const d = a - R.c, arc = Math.sqrt(Math.max(0, R.rad * R.rad - d * d));
  return regionFloor(R, x, z) + R.head + arc;
}
// the centre of the bay over (u along, v across) a vault region
export function bayAt(R, u, v){
  const nu = Math.max(1, Math.round((R.u1 - R.u0) / R.bayU)), nv = Math.max(1, Math.round((R.v1 - R.v0) / R.bayV));
  const iu = clamp(Math.floor((u - R.u0) / R.bayU), 0, nu - 1), iv = clamp(Math.floor((v - R.v0) / R.bayV), 0, nv - 1);
  return [R.u0 + (iu + 0.5) * R.bayU, R.v0 + (iv + 0.5) * R.bayV];
}
function regionFloor(R, x, z){
  if (R.type !== 'stair') return R.y;
  const p = R.axis === 'x' ? x : z, f = clamp((p - R.sA) / (R.sB - R.sA), 0, 1);
  return R.yA + (R.yB - R.yA) * f;
}

function buildCrypt(spec){
  const r = mulberry32(spec.seed), [m0] = spec.mouths, nF = spec.floors || FLOORS, sty = cryptStyle(spec), T = sty.palace ? PALACE_T : CRYPT_T;
  // in along the chapel's axis, away from its door, snapped to the nearest world axis
  const din = Math.round(Math.atan2(-Math.sin(m0.face), -Math.cos(m0.face)) / (Math.PI / 2)) * (Math.PI / 2);
  const Dx = Math.round(Math.cos(din)), Dz = Math.round(Math.sin(din)), Tx = -Dz, Tz = Dx;
  const at = (s, t) => [m0.x + Dx * s + Tx * t, m0.z + Dz * s + Tz * t];
  const sEnd = T.STARTS[nF - 1] + T.LENS[nF - 1];
  const xs = [], zs = [];
  for (const [s, t] of [[-8, -T.HALF_T - 4], [sEnd + 4, -T.HALF_T - 4], [-8, T.HALF_T + 4], [sEnd + 4, T.HALF_T + 4]]){ const [x, z] = at(s, t); xs.push(x); zs.push(z); }
  // the grid's origin on the mouth's own corner, so every even s, t falls on a cell edge
  const x0 = m0.x - Math.ceil((m0.x - Math.min(...xs)) / CELL) * CELL, z0 = m0.z - Math.ceil((m0.z - Math.min(...zs)) / CELL) * CELL;
  const L = grid(x0, z0, Math.max(...xs), Math.max(...zs));
  const CW = L.W;
  L.mouths = [{ ...m0, face: din + Math.PI }];          // the way out: back up the stair
  L.style = sty; L.site = spec.site || 'chapel'; L.floors = nF;
  L.props = []; L.finds = []; L.glow = []; L.waters = [];
  L.regions = []; L.reg = new Int16Array(L.W * L.H).fill(-1); L.reg2 = new Int16Array(L.W * L.H).fill(-1);
  L.doorways = []; L.arcades = []; L.sconces = []; L.tapestries = []; L.rooms = []; L.friezes = []; L.panels = [];
  L.ceilAt = (x, z) => {
    const [i, j] = cellOf(L, x, z); if (i < 0 || j < 0 || i >= L.W || j >= L.H) return 0;
    const k = j * CW + i, a = L.reg[k], b = L.reg2[k];
    if (a < 0) return 0;
    const c = regionCeil(L.regions[a], x, z);
    return b >= 0 ? Math.max(c, regionCeil(L.regions[b], x, z)) : c;
  };
  L.regionCeil = regionCeil; L.regionFloor = regionFloor;
  const base0 = m0.y - (sty.palace ? 0.6 : 6.5), base = k => base0 - T.DROPS.slice(0, k).reduce((a, d) => a + d, 0);
  // a rectangle in (s, t) → the cells it covers
  const cells = (s0, s1, t0, t1) => {
    const [ax, az] = at(s0, t0), [bx, bz] = at(s1, t1);
    const i0 = Math.round((Math.min(ax, bx) - x0) / CELL), j0 = Math.round((Math.min(az, bz) - z0) / CELL);
    return { i: i0, j: j0, w: Math.round(Math.abs(bx - ax) / CELL), h: Math.round(Math.abs(bz - az) / CELL) };
  };
  const put = (k, tag, ri, y) => {
    if (L.tag[k] === 3 || L.tag[k] === 4){ return; }           // stairs and rooms keep what they are
    if (L.open[k] && L.tag[k] === 1 && L.reg[k] !== ri){ if (tag === 1 && L.reg2[k] < 0) L.reg2[k] = ri; return; }
    L.open[k] = 1; L.tag[k] = tag; L.reg[k] = ri; L.floor[k] = y;
  };
  // a stair from (s0 → s1) at t, falling from yA to yB, 2 cells wide
  const stair = (s0, s1, t, yA, yB) => {
    const q = cells(s0, s1, t - 2, t + 2), [ax, az] = at(s0, t), [bx, bz] = at(s1, t);
    const axis = Dx ? 'x' : 'z';
    const R = { type: 'stair', axis, c: axis === 'x' ? az : ax, sA: axis === 'x' ? ax : az, sB: axis === 'x' ? bx : bz, yA, yB, rad: CELL, head: sty.palace ? 7 : 2.8 };
    const ri = L.regions.push(R) - 1;
    for (let j = q.j; j < q.j + q.h; j++) for (let i = q.i; i < q.i + q.w; i++){
      const k = j * CW + i, [cx, cz] = centre(L, i, j);
      L.open[k] = 1; L.tag[k] = 3; L.reg[k] = ri; L.floor[k] = regionFloor(R, cx, cz);
    }
    return R;
  };
  // a room: kind 'room' | 'hall' | 'crossing' | 'landing' | 'head'
  const room = (fl, kind, s0, s1, t0, t1) => {
    const q = cells(s0, s1, t0, t1);
    const axis = q.w >= q.h ? 'x' : 'z', hs = (axis === 'x' ? q.h : q.w) * CELL / 2;
    const [cx, cz] = [x0 + (q.i + q.w / 2) * CELL, z0 + (q.j + q.h / 2) * CELL], big = kind === 'hall' || kind === 'crossing';
    const lift = (T.GRAND[fl] - 1) * 4, spring = base(fl) + (big ? 5.6 : 4.8) + lift, rise = Math.min(hs * 0.9, (big ? 6.5 : 3.4) + lift);
    const R = { type: 'room', kind, fl, ...q, axis, c: axis === 'x' ? cz : cx, hs, y: base(fl), spring, rise, cx, cz, st: [s0, s1, t0, t1] };
    const ri = L.regions.push(R) - 1;
    for (let j = q.j; j < q.j + q.h; j++) for (let i = q.i; i < q.i + q.w; i++){
      const k = j * CW + i;
      if (L.tag[k] === 3) continue;
      L.open[k] = 1; L.tag[k] = 4; L.reg[k] = ri; L.reg2[k] = -1; L.floor[k] = R.y;
    }
    L.rooms.push(R);
    return R;
  };
  // a vaulted region of bays: along s (or along t, for a transept arm), its own
  // springing and rise; `round` for Romanesque
  const vault = (fl, kind, s0, s1, t0, t1, { alongT = false, bayU, bayV, spring, H, round = false, pu = 0, pv = 0 }) => {
    const q = cells(s0, s1, t0, t1), [ax, az] = at(s0, t0), [bx, bz] = at(s1, t1);
    const sAxis = Dx ? 'x' : 'z', axis = alongT ? (sAxis === 'x' ? 'z' : 'x') : sAxis;
    const [ua, ub] = axis === 'x' ? [ax, bx] : [az, bz], [va, vb] = axis === 'x' ? [az, bz] : [ax, bx];
    const R = { type: 'vault', kind, fl, ...q, axis, u0: Math.min(ua, ub), u1: Math.max(ua, ub), v0: Math.min(va, vb), v1: Math.max(va, vb),
      bayU, bayV, spring: base(fl) + spring, H, round, pu, pv, y: base(fl), st: [s0, s1, t0, t1],
      cx: x0 + (q.i + q.w / 2) * CELL, cz: z0 + (q.j + q.h / 2) * CELL };
    R.c = (R.v0 + R.v1) / 2; R.hs = (R.v1 - R.v0) / 2; R.rise = H;
    const ri = L.regions.push(R) - 1;
    for (let j = q.j; j < q.j + q.h; j++) for (let i = q.i; i < q.i + q.w; i++){
      const k = j * CW + i; if (L.tag[k] === 3) continue;
      L.open[k] = 1; L.tag[k] = 4; L.reg[k] = ri; L.reg2[k] = -1; L.floor[k] = R.y;
    }
    return R;
  };
  L.basilicas = []; L.special = []; L.parts = [];
  // A basilica on the bay system: a nave of NB bays (each B long, NW wide between
  // the arcades), aisles half its width (the double-bay rule: square aisle bays,
  // oblong nave bays); with `ARM`, a transept crossing it and a choir of CB bays
  // beyond, the arms the nave's width; a square east end, as the English built.
  // Three storeys: the arcade into the aisles, a triforium of blind arcading
  // where there's height for one, and a blind clerestory under the high vault.
  // Underground, so its windows are tracery cut in the wall, not glass.
  // The cathedral is the big one; a basilica is a hall-sized one of the same parts.
  // Every size must be even: walls fall on the 2u cells, so an odd bay or half-nave
  // puts the piers a unit off the wall they carry and the ribs beside their shafts.
  const basilica = (fl, sW, tc, P) => {
    const { B, NB, NW, CB = 0, ARM = 0, aisleSpring, highSpring, k = 1, kind = 'basilica' } = P;
    for (const v of [B, NW / 2, ARM, sW, tc]) if (v % 2) throw new Error(`basilica: ${v} is odd; every bay edge must fall on a cell edge`);
    const cross = ARM > 0, sX = sW + NB * B, sC = cross ? sX + NW : sX, sE = cross ? sC + CB * B : sX;
    const high = { bayU: B, bayV: NW, spring: highSpring, H: 0.866 * NW }, low = { bayU: B, bayV: B / 1, spring: aisleSpring, H: 0.866 * B };
    const AW = NW / 2;                                   // aisle width: half the nave
    low.bayV = AW;
    const lowA = { ...low, H: 0.866 * AW };
    const T = t => tc + t;
    lowA.pu = 1.075 * k;                                 // the arcade springs from the piers' capitals, not their centres
    const aisles = [vault(fl, 'aisle', sW, sX, T(NW / 2), T(NW / 2 + AW), lowA), vault(fl, 'aisle', sW, sX, T(-NW / 2 - AW), T(-NW / 2), lowA)];
    const C = { kind, fl, sW, sX, sC, sE, B, NW, AW, ARM, tc, y: base(fl), high, low: lowA, at: (s2, t2) => at(s2, T(t2)), aisles, cross, P };
    C.nave = vault(fl, 'nave', sW, sX, T(-NW / 2), T(NW / 2), high);
    if (cross){
      C.choir = vault(fl, 'choir', sC, sE, T(-NW / 2), T(NW / 2), high);
      C.crossing = vault(fl, 'crossing', sX, sC, T(-NW / 2), T(NW / 2), { ...high, bayU: NW });
      C.armN = vault(fl, 'arm', sX, sC, T(NW / 2), T(ARM), { ...high, alongT: true });
      C.armS = vault(fl, 'arm', sX, sC, T(-ARM), T(-NW / 2), { ...high, alongT: true });
      aisles.push(vault(fl, 'aisle', sC, sE, T(NW / 2), T(NW / 2 + AW), lowA), vault(fl, 'aisle', sC, sE, T(-NW / 2 - AW), T(-NW / 2), lowA));
    }
    const y = C.y;
    C.parts = [C.nave, C.choir, C.crossing, C.armN, C.armS, ...aisles].filter(Boolean);
    L.parts.push(...C.parts);
    // compound piers along the arcades (four shafts round a core, as at Chartres),
    // bigger ones at the crossing; a vaulting shaft runs up from each to the high vault
    const piers = [];
    for (const side of [-1, 1]){
      for (let q = 1; q < NB; q++) piers.push({ s: sW + q * B, t: side * NW / 2, big: false });
      if (cross){
        for (let q = 1; q < CB; q++) piers.push({ s: sC + q * B, t: side * NW / 2, big: false });
        piers.push({ s: sX, t: side * NW / 2, big: true }, { s: sC, t: side * NW / 2, big: true });
      }
    }
    for (const p of piers){
      const [x, z] = C.at(p.s, p.t), [nx, nz] = C.at(p.s, 0), kk = k * (p.big ? 1.45 : 1);
      // r: the core and its shafts, as drawn (under-view's Gothic pier reaches 0.95 at k = 1)
      L.props.push({ kind: 'pier', style: 'gothic', x, z, k: kk, r: 0.95 * kk, big: p.big, y, h: aisleSpring, top: y + highSpring, solid: true,
        toNave: [Math.sign(nx - x), Math.sign(nz - z)] });
    }
    // an altar at the east end, braziers to light it: round the crossing, by the altar, at the west end
    const [axx, azz] = C.at(sE - 0.66 * B, 0);
    L.props.push({ kind: 'altar', x: axx, z: azz, a: Dx ? Math.PI / 2 : 0, hl: 1.0, hw: Math.min(2.4, NW / 7), y, h: 1.25, solid: true });
    const bz = NW / 3;
    const spots = [[sE - 0.66 * B, -bz * 0.8], [sE - 0.66 * B, bz * 0.8], [sW + 4, -bz], [sW + 4, bz]];
    if (cross) spots.push([sX + 3, -bz], [sX + 3, bz], [sC - 3, -bz], [sC - 3, bz]);
    for (const [bs, bt] of spots){
      const [x, z] = C.at(bs, bt);
      L.sconces.push({ kind: 'brazier', x, z, y, face: 0, lit: false });
      L.props.push({ kind: 'brazier', x, z, r: 0.55, y, solid: true });
    }
    L.basilicas.push(C);
    return C;
  };
  // ---- shaped rooms ----
  // A region with a true outline (see the shapes above). ceilFn(x, z) is its vault,
  // which must come down to its springing at the wall. ribs: plan lines its ribs
  // follow; springs: where they land on a wall ([x, z, inward nx, nz]), for shafts.
  const shaped = (fl, kind, shape, ceilFn, spring) => {
    const pts = shape.boundary(1).flat();
    const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), minZ = Math.min(...pts.map(p => p[1])), maxZ = Math.max(...pts.map(p => p[1]));
    const [i0, j0] = cellOf(L, minX, minZ), [i1, j1] = cellOf(L, maxX, maxZ);
    const R = { type: 'shaped', kind, fl, shape, ceilFn, spring: base(fl) + spring, y: base(fl), cx: shape.cx, cz: shape.cz,
      i: i0, j: j0, w: i1 - i0 + 1, h: j1 - j0 + 1, ribs: [], springs: [], bosses: [] };
    const ri = L.regions.push(R) - 1;
    for (let j = Math.max(0, j0); j <= Math.min(L.H - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(L.W - 1, i1); i++){
      const k = j * CW + i, [cx, cz] = centre(L, i, j);
      let touch = false;
      for (const fx of [0.05, 0.5, 0.95]) for (const fz of [0.05, 0.5, 0.95]) if (shape.inside(x0 + (i + fx) * CELL, z0 + (j + fz) * CELL, 0)) touch = true;
      if (!touch || L.tag[k] === 3) continue;
      if (L.open[k]){
        // an edge cell two shapes share goes to the one its middle is in; nothing else is taken over
        const O = L.regions[L.reg[k]];
        if (!(O && O.type === 'shaped' && !O.shape.inside(cx, cz, 0) && shape.inside(cx, cz, 0))) continue;
      }
      L.open[k] = 1; L.tag[k] = 4; L.reg[k] = ri; L.reg2[k] = -1; L.floor[k] = R.y;
    }
    L.parts.push(R);
    return R;
  };
  const dirTo = a => [Math.cos(a), Math.sin(a)];
  // the wall of a shaped room at angle th from its centre, at radius r, and the way in from it
  const wallPt = (S, th, r) => [S.cx + Math.cos(th) * r, S.cz + Math.sin(th) * r, -Math.cos(th), -Math.sin(th)];
  const torchAt = (fl, x, z, nx, nz, h) => L.sconces.push({ x: x + nx * 0.22, z: z + nz * 0.22, y: base(fl) + h, face: Math.atan2(nz, nx), lit: false });
  const panelAt = (x, z, nx, nz, w, h, cy, pattern) => L.panels.push({ x: x + nx * 0.16, z: z + nz * 0.16, face: Math.atan2(nz, nx), w, h, y: cy, pattern });
  const node = (x, z) => { const [i, j] = cellOf(L, x, z); return { cx: x, cz: z, i, j, w: 2, h: 2 }; };
  // A rotunda: a round church after the Holy Sepulchre's Anastasis (the English
  // round churches copied it): a ring of columns carrying arches under a ribbed
  // dome, a font in the middle, lancets round the wall.
  // The great rotunda below is the same, twice the size: sixteen gilded clustered
  // piers in its ring, a dome 30u high, glass all round. The treasury is a small one
  // with gold on plinths instead of a font.
  const rotunda = (fl, st, kind = 'rotunda') => {
    const G = { rotunda: { RR: 12, n: 8, ring: 7, sp: 5.5, H: 9, colH: 4.2 }, grandrotunda: { RR: 22, n: 16, ring: 14, sp: 9, H: 20, colH: 7 }, treasury: { RR: 11, n: 8, ring: 6.5, sp: 6, H: 10, colH: 4.6 } }[kind];
    const [cx, cz] = at((st[0] + st[1]) / 2, (st[2] + st[3]) / 2), RR = G.RR, y = base(fl), sp = G.sp, H = G.H;
    const S = shaped(fl, kind, circleShape(cx, cz, RR), (x, z) => y + sp + H * pointed(Math.min(1, Math.hypot(x - cx, z - cz) / RR)), sp);
    const ring = [];
    for (let k = 0; k < G.n; k++){
      const [dx, dz] = dirTo(k * Math.PI * 2 / G.n), x = cx + dx * G.ring, z = cz + dz * G.ring;
      const c = kind === 'grandrotunda' ? { kind: 'pier', style: 'gothic', free: true, x, z, k: 1.1, r: 0.95 * 1.1, y, h: G.colH, top: y + G.colH, solid: true, noShaft: true, toNave: [0, 0] }   // free: on a circle, not a bay's corner
        : { kind: 'column', x, z, r: 0.62, y, h: G.colH, solid: true };
      L.props.push(c); ring.push(c);
    }
    for (let k = 0; k < G.n; k++) L.arcades.push({ a: [ring[k].x, ring[k].z], b: [ring[(k + 1) % G.n].x, ring[(k + 1) % G.n].z], y: y + G.colH + 0.42, depth: kind === 'grandrotunda' ? 1.2 : 0.8 });
    for (let k = 0; k < G.n; k++){
      const th = (k + 0.5) * Math.PI * 2 / G.n, [wx, wz, nx, nz] = wallPt(S.shape, th, RR);
      S.ribs.push([cx - nx * 0.5, cz - nz * 0.5, wx + nx * 0.06, wz + nz * 0.06]); S.springs.push([wx, wz, nx, nz]);
      const [lx, lz, lnx, lnz] = wallPt(S.shape, k * Math.PI * 2 / G.n, RR);
      if (kind === 'grandrotunda') panelAt(lx, lz, lnx, lnz, 3.6, 6.4, y + 5.0, 'clerestory'); else panelAt(lx, lz, lnx, lnz, 2.4, 3.8, y + 3.0, 'lancet');
      const [tx, tz, tnx, tnz] = wallPt(S.shape, th - 0.25 * 12 / RR, RR); torchAt(fl, tx, tz, tnx, tnz, 2.6);
    }
    S.bosses.push([cx, cz]);
    if (kind === 'treasury'){
      // four plinths with gold on them
      for (let k = 0; k < 4; k++){
        const [dx, dz] = dirTo(k * Math.PI / 2 + Math.PI / 4), x = cx + dx * 3, z = cz + dz * 3;
        L.props.push({ kind: 'altar', x, z, a: k * Math.PI / 2 + Math.PI / 4, hl: 0.6, hw: 0.6, y, h: 1.1, solid: true });
        L.finds.push({ x, z, y: y + 1.15, kind: 'gold', n: 3 + ((r() * 3) | 0), onProp: true });
      }
    } else L.props.push({ kind: 'font', x: cx, z: cz, r: 1.1, y, solid: true });
    return node(cx + G.ring + (RR - G.ring) / 2, cz);
  };
  // An octagonal chapter house (Westminster, Salisbury): one central pier, its
  // ribs fanning out to every corner and the middle of every side, a ridge rib
  // round the crown, a bench along the eight walls, a lancet in each.
  const octagon = (fl, st) => {
    const [cx, cz] = at((st[0] + st[1]) / 2, (st[2] + st[3]) / 2), a = 11, y = base(fl), sp = 5.5, Rp = 1.6, H = 0.866 * (a - Rp);
    const shape = polyShape(cx, cz, 8, a, 0);
    const S = shaped(fl, 'octagon', shape, (x, z) => {
      const r = Math.hypot(x - cx, z - cz), Rw = shape.wallAt(Math.atan2(z - cz, x - cx)), hw = (Rw - Rp) / 2, Rm = Rp + hw;
      return y + sp + H * pointed(Math.min(1, Math.abs(r - Rm) / hw));
    }, sp);
    L.props.push({ kind: 'pier', style: 'gothic', x: cx, z: cz, k: 1.3, r: 0.95 * 1.3, big: false, y, h: sp, top: y + sp, solid: true, noShaft: true, toNave: [0, 0] });
    const ridge = [];
    for (let q = 0; q < 16; q++){
      const th = q * Math.PI / 8, Rw = shape.wallAt(th), [dx, dz] = dirTo(th);
      S.ribs.push([cx + dx * 1.3, cz + dz * 1.3, cx + dx * (Rw - 0.06), cz + dz * (Rw - 0.06)]); S.springs.push([cx + dx * Rw, cz + dz * Rw, -dx, -dz]);
      ridge.push([cx + dx * (Rp + (Rw - Rp) / 2), cz + dz * (Rp + (Rw - Rp) / 2)]);
    }
    for (let q = 0; q < 16; q++) S.ribs.push([...ridge[q], ...ridge[(q + 1) % 16], 0.3, 0.26]);
    // each side: the bench, a lancet over it, a torch to one side
    L.benchesR = L.benchesR || [];
    for (let k = 0; k < 8; k++){
      const t = k * Math.PI / 4, [nx, nz] = dirTo(t), side = 2 * a * Math.tan(Math.PI / 8), mx = cx + nx * a, mz = cz + nz * a;
      L.benchesR.push({ x: mx - nx * 0.4, z: mz - nz * 0.4, a: t, len: side - 1.4, d: 0.8, h: 0.55, y });
      panelAt(mx, mz, -nx, -nz, 2.2, 3.6, y + 3.3, 'lancet');
      const sd = k % 2 ? 1 : -1, tx = mx - nz * 2.6 * sd, tz = mz + nx * 2.6 * sd; torchAt(fl, tx, tz, -nx, -nz, 2.6);
    }
    return node(cx + 8, cz);
  };
  // An ambulatory crypt, after the U of Fulbert's crypt at Chartres: a vaulted
  // gallery curving round a solid core, with small round chapels radiating off it,
  // each with its altar.
  const ambulatory = (fl, st) => {
    const dir = [Dx, Dz], [cx, cz] = at(st[0] + 1, (st[2] + st[3]) / 2), y = base(fl), ri = 8, ro = 15, sp = 3.5, Rm = (ri + ro) / 2, hw = (ro - ri) / 2, H = 0.866 * (ro - ri);
    const S = shaped(fl, 'ambulatory', uShape(cx, cz, ri, ro, ...dir), (x, z) => y + sp + H * pointed(Math.min(1, Math.abs(Math.hypot(x - cx, z - cz) - Rm) / hw)), sp);
    S.probe = [cx + dir[0] * Rm, cz + dir[1] * Rm];                      // a point inside it (its centre is the solid core)
    const a0 = Math.atan2(dir[1], dir[0]);
    for (let q = -4; q <= 4; q++){
      const th = a0 + q * Math.PI / 8, [dx, dz] = dirTo(th);
      S.ribs.push([cx + dx * (ri + 0.06), cz + dz * (ri + 0.06), cx + dx * (ro - 0.06), cz + dz * (ro - 0.06), 0.4, 0.34]);
      S.springs.push([cx + dx * ri, cz + dz * ri, dx, dz], [cx + dx * ro, cz + dz * ro, -dx, -dz]);
      if (q < 4){ const [ex, ez] = dirTo(th + Math.PI / 8); S.ribs.push([cx + dx * Rm, cz + dz * Rm, cx + ex * Rm, cz + ez * Rm, 0.3, 0.26]); }
      // blind lancets on the core, torches on the outer wall between the chapels
      if (q % 2 === 0 && Math.abs(q) < 4) panelAt(cx + dx * ri, cz + dz * ri, dx, dz, 2.0, 2.4, y + 1.9, 'lancet');
      if (Math.abs(q) % 2 === 1) torchAt(fl, cx + dx * ro, cz + dz * ro, -dx, -dz, 2.3);
    }
    for (const q of [-1, 0, 1]){
      const th = a0 + q * 0.96, [dx, dz] = dirTo(th), ccx = cx + dx * (ro + 1.6), ccz = cz + dz * (ro + 1.6), cr = 3.2;
      const C = shaped(fl, 'chapel-r', circleShape(ccx, ccz, cr), (x, z) => y + 3 + 3 * round(Math.min(1, Math.hypot(x - ccx, z - ccz) / cr)), 3);
      for (const d of [-0.9, 0, 0.9]){ const [ex, ez] = dirTo(th + d); C.ribs.push([ccx, ccz, ccx + ex * (cr - 0.06), ccz + ez * (cr - 0.06), 0.3, 0.26]); C.springs.push([ccx + ex * cr, ccz + ez * cr, -ex, -ez]); }
      C.bosses.push([ccx, ccz]);
      L.props.push({ kind: 'altar', x: ccx + dx * 1.5, z: ccz + dz * 1.5, a: th, hl: 0.45, hw: 0.9, y, h: 1.1, solid: true });
      panelAt(ccx + dx * cr, ccz + dz * cr, -dx, -dz, 1.3, 1.9, y + 1.95, 'lancet');
      if (q === 0) L.finds.push({ x: ccx + dx * 1.5, z: ccz + dz * 1.5, y: y + 1.15, kind: 'amber', n: 2, onProp: true });
    }
    // joined at the end of one arm of the U, as Chartres' crypt is entered from its ends
    const [ex, ez] = dirTo(a0 - Math.PI / 2);
    return node(cx + ex * Rm + dir[0] * 1.6, cz + ez * Rm + dir[1] * 1.6);
  };
  // the other rooms built from the same pieces: a single vaulted region, or four
  // (a cloister's walks), dressed after the general rooms (dressSpecial below)
  const special = (fl, kind, st) => {
    const [s0, s1, t0, t1] = st, sp = { kind, fl, st, y: base(fl), regions: [] };
    const add = R => { sp.regions.push(R); L.parts.push(R); return R; };
    if (kind === 'chapel'){
      // a Lady chapel: aisleless, rib-vaulted in bays of 6, lancets down its sides, an altar and a rose at its east end
      // and a round east end: an apse, its ribbed half-dome the same arch as the chapel's last bay
      const w = t1 - t0, len = Math.floor((s1 - s0 - w / 2) / 6) * 6, Hc = 0.866 * w, y = base(fl);   // whole bays of 6, on the cells
      add(vault(fl, 'chapel', s0, s0 + len, t0, t1, { bayU: 6, bayV: w, spring: 6, H: Hc }));
      const [ax, az] = at(s0 + len, (t0 + t1) / 2), Ra = w / 2;
      const A = shaped(fl, 'apse', apseShape(ax, az, Ra, Dx, Dz), (x, z) => y + 6 + Hc * pointed(Math.min(1, Math.hypot(x - ax, z - az) / Ra)), 6);
      const a0 = Math.atan2(Dz, Dx);
      for (const d of [-1.05, -0.52, 0, 0.52, 1.05]){
        const [ex, ez] = dirTo(a0 + d);
        A.ribs.push([ax + ex * 0.4, az + ez * 0.4, ax + ex * (Ra - 0.06), az + ez * (Ra - 0.06)]); A.springs.push([ax + ex * Ra, az + ez * Ra, -ex, -ez]);
        if (Math.abs(d) > 0.3 && Math.abs(d) < 0.8) panelAt(ax + ex * Ra, az + ez * Ra, -ex, -ez, 1.8, 3.8, y + 3.4, 'lancet');
      }
      sp.apse = { x: ax, z: az, R: Ra, A };
    } else if (kind === 'chapterhouse'){
      // a chapter house: square, four rib-vaulted bays on one central pier, a stone bench round the walls
      const half = (t1 - t0) / 2;
      const C = add(vault(fl, 'chapterhouse', s0, s1, t0, t1, { bayU: half, bayV: half, spring: 5, H: 0.866 * half }));
      C.pu = C.pv = 1.075 * 1.2;                         // off the central pier's capital
    } else if (kind === 'undercroft'){
      // an undercroft: two round-vaulted aisles on a row of columns down the middle
      const U = add(vault(fl, 'undercroft', s0, s1, t0, t1, { bayU: 6, bayV: (t1 - t0) / 2, spring: 3.4, H: (t1 - t0) / 4, round: true }));
      U.pu = U.pv = 0.95;                                // off the columns' abaci
    } else if (kind === 'gilthall'){
      // the gilded hall: rib-vaulted bays of 12 on tall clustered piers, all of one height
      const Hh = add(vault(fl, 'gilthall', s0, s1, t0, t1, { bayU: 12, bayV: 12, spring: 10, H: 0.866 * 12, pu: 1.075 * 1.6, pv: 1.075 * 1.6 }));
      void Hh;
    } else if (kind === 'cloister'){
      // a cloister: four rib-vaulted walks round the garth (solid here: rock, under the land)
      const w = 6;
      add(vault(fl, 'walk', s0, s1, t0, t0 + w, { bayU: 6, bayV: w, spring: 4, H: 0.866 * w }));
      add(vault(fl, 'walk', s0, s1, t1 - w, t1, { bayU: 6, bayV: w, spring: 4, H: 0.866 * w }));
      add(vault(fl, 'walk', s0, s0 + w, t0 + w, t1 - w, { bayU: 6, bayV: w, spring: 4, H: 0.866 * w, alongT: true }));
      add(vault(fl, 'walk', s1 - w, s1, t0 + w, t1 - w, { bayU: 6, bayV: w, spring: 4, H: 0.866 * w, alongT: true }));
    }
    L.special.push(sp);
    // where the passages join it: the middle of its first region (for a cloister, the west walk)
    const R0 = kind === 'cloister' ? sp.regions[2] : sp.regions[0];
    const [ci, cj] = cellOf(L, R0.cx, R0.cz);
    return { cx: R0.cx, cz: R0.cz, i: ci, j: cj, w: 2, h: 2, st };
  };
  const clash = (a, b, gap = 4) => a[0] - gap < b[1] && b[0] - gap < a[1] && a[2] - gap < b[3] && b[2] - gap < a[3];
  const even = v => 2 * Math.round(v / 2);

  // the way in: a stair from the chapel floor down to the first landing
  stair(0, 22, 0, m0.y - 0.6, base0).fl = -1;
  let tPrev = 0;
  for (let fl = 0; fl < nF; fl++){
    const S0 = T.STARTS[fl], rooms = [];
    const lo = fl === 0 ? 22 : S0 - 4, hi = S0 + T.LENS[fl];
    rooms.push(room(fl, 'landing', lo, lo + 14, tPrev - 7 + 1, tPrev + 7 - 1));
    let tNext = null;
    if (fl < nF - 1){
      tNext = even((r() - 0.5) * 50);
      rooms.push(room(fl, 'head', hi - 14, hi - 4, tNext - 4, tNext + 4));
      stair(hi - 4, hi - 4 + T.RUNS[fl], tNext, base(fl), base(fl + 1)).fl = fl + 1;
    }
    const HT = T.HALFS[fl];
    const fits = st => st[0] >= lo && st[1] <= hi - 2 && st[2] >= -HT && st[3] <= HT && !rooms.some(o => clash(o.st, st));
    // the hall crypt: Romanesque, as at Canterbury: square groin-vaulted bays on
    // squat columns, all one height, 7 bays by 5
    const tryHallCrypt = () => {
      for (let q = 0; q < 300; q++){
        const ls = 42, lt = 30, s0 = even(lo + r() * (hi - lo - ls)), t0 = even(-HT + r() * (2 * HT - lt)), st = [s0, s0 + ls, t0, t0 + lt];
        if (!fits(st)) continue;
        const R = vault(fl, 'hallcrypt', ...st, { bayU: 6, bayV: 6, spring: 3.2, H: 3, round: true });
        R.pu = R.pv = 1.7 * 0.85;                       // broad transverse arches both ways, off the massive piers
        R.spring0 = R.spring; L.rooms.push(R); rooms.push(R);
        return R;
      }
      return null;
    };
    const tryRoom = (kind, ls, lt, n = 60) => {
      for (let q = 0; q < n; q++){
        const s0 = even(lo + r() * (hi - lo - ls)), t0 = even(-HT + r() * (2 * HT - lt)), st = [s0, s0 + ls, t0, t0 + lt];
        if (fits(st)){ const R = room(fl, kind, ...st); rooms.push(R); return R; }
      }
      return null;
    };
    // a room of `kind`, `ls` × `lt`, where it fits; build(st) makes it and returns where passages join it
    const place = (ls, lt, build, n = 300) => {
      for (let q = 0; q < n; q++){
        const s0 = even(lo + r() * (hi - lo - ls)), t0 = even(-HT + r() * (2 * HT - lt)), st = [s0, s0 + ls, t0, t0 + lt];
        if (fits(st)){ const node = build(st); node.st = st; rooms.push(node); return node; }
      }
      return null;
    };
    const basilicaAt = st => { const C = basilica(fl, st[0], (st[2] + st[3]) / 2, { B: 6, NB: 5, NW: 12, aisleSpring: 4.5, highSpring: 11, k: 0.7 });
      const [x, z] = C.at(st[0] + 3, 0), [i, j] = cellOf(L, x, z); return { cx: x, cz: z, i, j, w: 2, h: 2 }; };
    // the rooms a crypt's own program gives this floor (the chapel's is the fixed one below)
    const ROOMS = {
      hallcrypt: () => tryHallCrypt(), chapel: () => place(30, 10, st => special(fl, 'chapel', st)), hall: () => tryRoom('hall', 40, 24, 200),
      basilica: () => place(30, 24, basilicaAt), chapterhouse: () => place(20, 20, st => special(fl, 'chapterhouse', st)), rotunda: () => place(26, 26, st => rotunda(fl, st)),
      crossing: () => tryRoom('crossing', 20, 20, 200), cloister: () => place(36, 36, st => special(fl, 'cloister', st)), undercroft: () => place(30, 12, st => special(fl, 'undercroft', st)),
      ambulatory: () => place(22, 42, st => ambulatory(fl, st)), octagon: () => place(24, 24, st => octagon(fl, st)),
      grandrotunda: () => place(48, 48, st => rotunda(fl, st, 'grandrotunda')),
      gilthall: () => place(72, 48, st => special(fl, 'gilthall', st)),
      cathedral: () => place(124, 84, st => { const sW = st[0] + 2, C = basilica(fl, sW, st[2] + 42, { kind: 'cathedral', B: 10, NB: 6, CB: 4, NW: 20, ARM: 40, aisleSpring: 7.5, highSpring: 24 });
        const [x, z] = C.at(sW + 3, 0), [i, j] = cellOf(L, x, z); return { cx: x, cz: z, i, j, w: 2, h: 2 }; }),
      greatbasilica: () => place(48, 32, st => { const C = basilica(fl, st[0], (st[2] + st[3]) / 2, { B: 8, NB: 6, NW: 16, aisleSpring: 6.5, highSpring: 16, k: 0.9 });
        const [x, z] = C.at(st[0] + 3, 0), [i, j] = cellOf(L, x, z); return { cx: x, cz: z, i, j, w: 2, h: 2 }; }),
    };
    if (sty.program){ for (const k of sty.program[fl]) ROOMS[k](); }
    else {
    if (fl === 0){ tryHallCrypt(); place(30, 10, st => special(fl, 'chapel', st)); }
    if (fl === 1){ tryRoom('hall', 40, 24, 200); place(30, 24, basilicaAt); place(20, 20, st => special(fl, 'chapterhouse', st)); place(26, 26, st => rotunda(fl, st)); }
    if (fl === 2){ tryRoom('crossing', 20, 20, 200); place(36, 36, st => special(fl, 'cloister', st)); place(30, 12, st => special(fl, 'undercroft', st)); place(22, 42, st => ambulatory(fl, st)); }
    if (fl === 4){
      // grander: the great rotunda, and a basilica half again the size of the first
      place(48, 48, st => rotunda(fl, st, 'grandrotunda'));
      place(48, 32, st => { const C = basilica(fl, st[0], (st[2] + st[3]) / 2, { B: 8, NB: 6, NW: 16, aisleSpring: 6.5, highSpring: 16, k: 0.9 });
        const [x, z] = C.at(st[0] + 3, 0), [i, j] = cellOf(L, x, z); return { cx: x, cz: z, i, j, w: 2, h: 2 }; });
      place(30, 10, st => special(fl, 'chapel', st));
    }
    if (fl === 5){
      // grandest, at the bottom: the gilded hall, and the treasury beside it
      place(72, 48, st => special(fl, 'gilthall', st));
      place(24, 24, st => rotunda(fl, st, 'treasury'));
      place(30, 10, st => special(fl, 'chapel', st));
    }
    if (fl === 3){
      // the cathedral fills most of its floor; it joins the passages at its west door,
      // and beside it stand a chapter house and a Lady chapel, as at a real one
      const sW = lo + 20, C = basilica(fl, sW, 0, { kind: 'cathedral', B: 10, NB: 6, CB: 4, NW: 20, ARM: 40, aisleSpring: 7.5, highSpring: 24 });   // even sizes: every bay corner on a cell edge
      const [wx, wz] = C.at(sW + 3, 0), [wi, wj] = cellOf(L, wx, wz);
      rooms.push({ cx: wx, cz: wz, i: wi, j: wj, w: 2, h: 2, st: [sW - 2, C.sE + 2, -C.ARM - 2, C.ARM + 2] });
      place(24, 24, st => octagon(fl, st));                // octagonal, as at Westminster and Salisbury
      place(30, 10, st => special(fl, 'chapel', st));
    }
    }
    const gs = T.GRAND[fl];
    for (let n = 0, want = 5 + ((r() * 3) | 0); n < 200 && rooms.length < want + 2; n++) tryRoom('room', even((8 + r() * 10) * gs), even((8 + r() * 8) * gs), 1);
    // passages: a spanning tree by distance, and a loop or two; each leg its own vault
    const links = [], inTree = [0];
    while (inTree.length < rooms.length){
      let best = null;
      for (const a of inTree) for (let b = 0; b < rooms.length; b++){
        if (inTree.includes(b)) continue;
        const d = Math.hypot(rooms[a].cx - rooms[b].cx, rooms[a].cz - rooms[b].cz);
        if (!best || d < best.d) best = { a, b, d };
      }
      links.push([best.a, best.b]); inTree.push(best.b);
    }
    for (let e = 0; e < 2; e++){ const a = (r() * rooms.length) | 0, b = (r() * rooms.length) | 0; if (a !== b) links.push([a, b]); }
    // Each passage finds its own way (A* over the cells, two wide): it may not
    // cross another room, it pays to run alongside one (so passages meet rooms at
    // doorways instead of merging with a wall), it pays to turn (so its legs stay
    // long and straight, each its own tunnel vault), and it runs cheaper along a
    // passage already dug, so they share.
    const ci = R => R.i + (R.w >> 1) - 1, cj = R => R.j + (R.h >> 1) - 1;
    const fb = cells(lo - 6, hi + 6, -HT - 4, HT + 4);
    // the search's tables, over this floor only: a state is a cell × the way you arrived
    const enc = (i, j, d) => (((j - fb.j) * fb.w + (i - fb.i)) << 2) + d, dec = k => { const c = k >> 2; return [fb.i + c % fb.w, fb.j + ((c / fb.w) | 0)]; };
    const g = new Float64Array(fb.w * fb.h * 4), came = new Int32Array(fb.w * fb.h * 4), memo = new Float64Array(fb.w * fb.h);
    const inRect = (q, i, j) => i >= q.i && i < q.i + q.w && j >= q.j && j < q.j + q.h;
    const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], HW = 1.2;
    for (const [a, b] of links){
      const ends = [rooms[a], rooms[b]].map(o => { const q = cells(...o.st); return { i: q.i - 1, j: q.j - 1, w: q.w + 2, h: q.h + 2 }; });
      const mine = (i, j) => ends.some(q => inRect(q, i, j));
      const si = ci(rooms[a]), sj = cj(rooms[a]), ti = ci(rooms[b]), tj = cj(rooms[b]);
      const regS = L.reg[sj * CW + si], regT = L.reg[tj * CW + ti];      // the rooms the two ends stand in
      // running alongside ANY room's wall costs, its own two included (a cathedral's
      // footprint is huge), except near where it joins them, or once it's inside one
      const stepCost = (i, j) => {
        let c = 0, hug = false, inside = false;
        for (const [p, q] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]){
          if (!inRect(fb, p, q)) return Infinity;
          const t = L.tag[q * CW + p];
          if (t === 3 || (t === 4 && !mine(p, q))) return Infinity;
          // a shaped room is entered only near where it's meant to be joined: never
          // through an apse, a chapel's back wall, the far side of a curve
          if (t === 4 && L.regions[L.reg[q * CW + p]].type === 'shaped'){
            const rg = L.reg[q * CW + p];
            if (!((rg === regS && Math.max(Math.abs(p - si), Math.abs(q - sj)) <= 3) || (rg === regT && Math.max(Math.abs(p - ti), Math.abs(q - tj)) <= 3))) return Infinity;
          }
          if (t === 4) inside = true;
          c += t === 1 ? 0.15 : 0.25;
        }
        const nearEnd = Math.max(Math.abs(i - si), Math.abs(j - sj)) <= 1 || Math.max(Math.abs(i - ti), Math.abs(j - tj)) <= 1;
        if (!inside && !nearEnd) for (let q = j - 1; q <= j + 2; q++) for (let p = i - 1; p <= i + 2; p++)
          if ((p < i || p > i + 1 || q < j || q > j + 1) && p >= 0 && q >= 0 && p < L.W && q < L.H && L.tag[q * CW + p] === 4) hug = true;
        return c + (hug ? 12 : 0);
      };
      if (si === ti && sj === tj) continue;
      // states are cell × the direction you arrived in
      // costs in doubles: the heap's priorities are, and a float32 cost rounds just enough to make a live entry look stale.
      // The search never leaves its floor, so its tables cover only the floor (fb), reused link to link.
      g.fill(Infinity); came.fill(-1); memo.fill(NaN);
      const heap = [];
      const push = (k, f) => { heap.push([f, k]); let n = heap.length - 1; while (n > 0){ const pn = (n - 1) >> 1; if (heap[pn][0] <= f) break; [heap[n], heap[pn]] = [heap[pn], heap[n]]; n = pn; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length){ heap[0] = last; let n = 0; for (;;){ let c = 2 * n + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[n][0]) break; [heap[n], heap[c]] = [heap[c], heap[n]]; n = c; } } return top; };
      for (let d = 0; d < 4; d++){ const k = enc(si, sj, d); g[k] = 0; push(k, 0); }
      let end = -1;
      while (heap.length){
        const [f, k] = pop(), d = k & 3, [i, j] = dec(k);
        if (f > g[k] + HW * (Math.abs(i - ti) + Math.abs(j - tj)) + 1e-6) continue;   // a stale entry
        if (i === ti && j === tj){ end = k; break; }
        for (let nd = 0; nd < 4; nd++){
          const ni = i + DIRS4[nd][0], nj = j + DIRS4[nd][1];
          if (ni < fb.i || nj < fb.j || ni >= fb.i + fb.w - 1 || nj >= fb.j + fb.h - 1 || ni >= L.W - 1 || nj >= L.H - 1) continue;
          const mk = (nj - fb.j) * fb.w + (ni - fb.i);
          let sc = memo[mk]; if (sc !== sc) sc = memo[mk] = stepCost(ni, nj);   // a cell's cost holds for the whole search: work it out once
          if (sc === Infinity) continue;
          const nk = enc(ni, nj, nd), ng = g[k] + sc + (nd !== d ? 3 : 0);
          // the heuristic, inflated (weighted A*): a passage needn't be the very cheapest, and an
          // admissible one (0.6, four dug cells a step) explores whole floors round the big rooms
          if (ng < g[nk]){ g[nk] = ng; came[nk] = k; push(nk, ng + HW * (Math.abs(ni - ti) + Math.abs(nj - tj))); }
        }
      }
      if (end < 0){ (L.unlinked = L.unlinked || []).push({ fl, a: [rooms[a].cx, rooms[a].cz], b: [rooms[b].cx, rooms[b].cz] }); continue; }   // no way found: check-under reports it
      const path = [];
      for (let k = end; k !== -1; k = came[k]) path.push(k);
      path.reverse();
      // straight runs → legs, each its own vault; a turn's corner cell belongs to both.
      // A leg is a run of steps in one direction: the cells from the one before its
      // first step to its last.
      for (let m = 1; m < path.length;){
        const d = path[m] & 3, alongX = d < 2;
        let e = m;
        while (e + 1 < path.length && (path[e + 1] & 3) === d) e++;
        const [i0, j0] = dec(path[m - 1]);
        const ri = L.regions.push({ type: 'corr', fl, axis: alongX ? 'x' : 'z', c: alongX ? z0 + (j0 + 1) * CELL : x0 + (i0 + 1) * CELL, y: base(fl), rad: CELL, head: sty.palace ? 7 : 2.6 }) - 1;   // a palace's passages as tall as its rooms
        for (let q = m - 1; q <= e; q++){
          const [i, j] = dec(path[q]);
          for (const [pp, qq] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) put(qq * CW + pp, 1, ri, base(fl));
        }
        m = e + 1;
      }
    }
    tPrev = tNext;
  }

  // ---- dressing ----
  // each region's finish: the hall is big blocks, the way in is the chapel's own
  // ashlar, and the rest is drawn by floor; each gets its own texture offset so
  // neighbouring walls don't line up
  // a crypt that's more cut from the rock than the rest: its share of hewn walls raised
  const hewnBy = list => sty.hewn ? list.map(([k, w]) => [k, k === 'hewn' ? w + sty.hewn * 2 : w]) : list;
  const pick = list => { let x = r() * list.reduce((a, [, w]) => a + w, 0); for (const [k, w] of list){ if ((x -= w) <= 0) return k; } return list[0][0]; };
  for (const R of L.regions){
    const cath = ['nave', 'choir', 'crossing', 'arm'].includes(R.kind);
    R.finish = sty.palace ? 'M' : R.kind === 'hall' || cath ? 'C' : R.kind === 'aisle' ? 'A' : R.kind === 'hallcrypt' ? 'B' : R.fl === -1 ? 'A' : R.type === 'stair' ? 'hewn' : pick(hewnBy(FINISH_BY_FLOOR[R.fl >= 4 ? 3 : Math.max(0, Math.min(2, R.fl))]));
    R.uo = r() * 40;
    // painted vaults: worn frescoes in the chapels and the great rooms, sometimes
    // elsewhere; gold mosaic on the deepest floors; never on rock-cut ceilings
    const FR = { chapel: 'stars', apse: 'stars', rotunda: 'stars', crossing: 'stars', nave: 'stars', choir: 'stars', arm: 'stars',
      chapterhouse: 'vines', octagon: 'vines', hall: 'joints' };
    // a palace's, every ceiling, passages too: gold mosaic or stars, fresh ('!': not worn, under-view frescoMat)
    if (sty.palace){ R.palace = true; R.fresco = (r() < 0.6 ? 'mosaic' : 'stars') + '!'; }
    else if (R.finish !== 'hewn' && (R.type === 'room' || R.type === 'vault' || R.type === 'shaped')){
      if (R.fl >= 4) R.fresco = r() < 0.75 ? 'mosaic' : 'stars';
      else if (FR[R.kind]) R.fresco = FR[R.kind];
      else if (R.kind === 'room' && r() < sty.frescoP) R.fresco = ['stars', 'vines', 'joints'][(r() * 3) | 0];
    }
    if (R.kind === 'hallcrypt') R.decor = 'panels';
    if (R.type === 'room'){
      const big = R.kind === 'hall' || R.kind === 'crossing', q = r();
      const d = sty.decor;
      R.decor = big ? 'both' : R.kind === 'room' ? (q < 0.3 * d ? 'frieze' : q < 0.55 * d ? 'panels' : q < 0.7 * d ? 'both' : null) : null;
      R.frieze = sty.friezes[(r() * sty.friezes.length) | 0];
      R.panel = sty.panels[(r() * sty.panels.length) | 0];
    }
  }
  const isOpen = (i, j) => i >= 0 && j >= 0 && i < L.W && j < L.H && L.open[j * CW + i] === 1;
  // a room's walls: runs of edge along each side with rock behind (doorways break them)
  const runsOf = R => {
    const runs = [];
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]){
      const horiz = dz !== 0, n = horiz ? R.w : R.h;
      let start = -1;
      for (let q = 0; q <= n; q++){
        const i = horiz ? R.i + q : (dx < 0 ? R.i : R.i + R.w - 1), j = horiz ? (dz < 0 ? R.j : R.j + R.h - 1) : R.j + q;
        const solid = q < n && !isOpen(i + dx, j + dz);
        if (solid && start < 0) start = q;
        if (!solid && start >= 0){
          // the wall line, from cell `start` to `q`, and the way into the room
          const wx = dx > 0 ? x0 + (R.i + R.w) * CELL : dx < 0 ? x0 + R.i * CELL : null, wz = dz > 0 ? z0 + (R.j + R.h) * CELL : dz < 0 ? z0 + R.j * CELL : null;
          const a0 = (horiz ? x0 + (R.i + start) * CELL : z0 + (R.j + start) * CELL), a1 = (horiz ? x0 + (R.i + q) * CELL : z0 + (R.j + q) * CELL);
          runs.push({ horiz, line: horiz ? wz : wx, a0, a1, nx: -dx, nz: -dz, len: a1 - a0 });
          start = -1;
        }
      }
    }
    return runs;
  };
  for (const R of L.rooms){
    const along = R.axis === 'x' ? [1, 0] : [0, 1], across = R.axis === 'x' ? [0, 1] : [1, 0];
    const len = (R.axis === 'x' ? R.w : R.h) * CELL, span = R.hs * 2;
    const P = (u, v) => [R.cx + along[0] * u + across[0] * v, R.cz + along[1] * u + across[1] * v];
    const capH = R.kind === 'hall' ? 4.2 : 3.6;
    const column = (u, v) => { const [x, z] = P(u, v), c = { kind: 'column', x, z, r: 0.62, y: R.y, h: capH, solid: true }; L.props.push(c); return c; };
    const arcade = (a, b) => L.arcades.push({ a: [a.x, a.z], b: [b.x, b.z], y: R.y + capH + 0.42, depth: 0.8, room: R });
    if (R.kind === 'hallcrypt'){
      // a massive Romanesque pier at every inner corner of the bays: a thick core
      // with four shafts, squat under the low groin vaults
      for (let u = R.u0 + R.bayU; u < R.u1 - 0.1; u += R.bayU) for (let v = R.v0 + R.bayV; v < R.v1 - 0.1; v += R.bayV){
        const [x, z] = R.axis === 'x' ? [u, v] : [v, u];
        L.props.push({ kind: 'pier', style: 'romanesque', x, z, k: 0.85, r: 1.42 * 0.85, y: R.y, h: R.spring - R.y, top: R.spring, solid: true, noShaft: true, toNave: [0, 0] });
      }
    } else if (R.kind === 'hall'){
      // the nave between two rows of columns, aisles 5u wide either side
      const n = Math.floor((len - 10) / 6) + 1, u0 = -(n - 1) * 3;
      for (const side of [-1, 1]){
        let prev = null;
        for (let q = 0; q < n; q++){ const c = column(u0 + q * 6, side * (R.hs - 5)); if (prev) arcade(prev, c); prev = c; }
      }
    } else if (R.kind === 'crossing'){
      const grid3 = [];
      for (const v of [-6, 0, 6]) for (const u of [-6, 0, 6]) grid3.push(column(u, v));
      for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++){ arcade(grid3[a * 3 + b], grid3[a * 3 + b + 1]); arcade(grid3[b * 3 + a], grid3[(b + 1) * 3 + a]); }
    } else if (R.kind === 'room' && r() < sty.coffins){
      // stone coffins down the middle, grave goods on some
      const n = Math.max(1, Math.min(3, Math.floor(len / 7)));
      for (let q = 0; q < n; q++){
        const u = (q - (n - 1) / 2) * (len / n), [x, z] = P(u, 0);
        const p = { kind: 'coffin', x, z, a: R.axis === 'x' ? 0 : Math.PI / 2, hl: 1.6, hw: 0.8, y: R.y, h: 1.3, solid: true };
        L.props.push(p);
        if (r() < 0.55) L.finds.push({ x, z, y: R.y + 1.35, kind: r() < 0.7 ? 'amber' : 'quartz', n: 1 + ((r() * 2) | 0), onProp: true });
      }
    }
    const runs = runsOf(R);
    // tapestries on the long runs, in the hall and the crossing always, elsewhere sometimes
    const hung = [];
    const wantTap = R.kind === 'hall' || R.kind === 'crossing' ? 8 : R.kind === 'room' && r() < sty.tapP ? 2 : 0;
    for (const run of runs.sort((a, b) => b.len - a.len)){
      if (hung.length >= wantTap || run.len < 7) continue;
      const w = Math.min(run.len - 2, R.kind === 'hall' ? 5.5 : 4.5), slots = Math.max(1, Math.floor((run.len - 1) / (w + 3)));
      for (let q = 0; q < slots && hung.length < wantTap; q++){
        const a = run.a0 + (q + 0.5) * run.len / slots;
        const x = run.horiz ? a : run.line + run.nx * 0.14, z = run.horiz ? run.line + run.nz * 0.14 : a;
        const h = Math.min(R.spring - R.y - 1.65, R.kind === 'hall' ? 4.2 : 3.2);
        const medieval = R.kind === 'hall' || R.fl > 0 ? r() < sty.medieval : r() < (sty.medieval0 ?? sty.medieval * 0.47);
        const set = medieval ? TAPESTRIES : WAGARA;
        const t = { x, z, face: Math.atan2(run.nz, run.nx), w, h, top: R.spring - 0.95, tex: set[(r() * set.length) | 0], seed: (r() * 1e9) | 0, run };   // hung under the frieze
        L.tapestries.push(t); hung.push(t);
      }
    }
    // torches on the walls, clear of the tapestries
    for (const run of runs){
      const step = R.kind === 'hall' ? 7 : 6;
      for (let a = run.a0 + 2; a <= run.a1 - 2; a += step){
        if (hung.some(t => t.run === run && Math.abs((run.horiz ? t.x : t.z) - a) < t.w / 2 + 1.2)) continue;
        const x = run.horiz ? a : run.line + run.nx * 0.22, z = run.horiz ? run.line + run.nz * 0.22 : a;
        if (L.sconces.some(o => Math.hypot(o.x - x, o.z - z) < 4)) continue;
        L.sconces.push({ x, z, y: R.y + (R.kind === 'hall' ? 3.0 : R.kind === 'hallcrypt' ? 1.9 : 2.6), face: Math.atan2(run.nz, run.nx), lit: false, run });
      }
    }
    // reliefs: a carved frieze along the top of every wall, under the springing,
    // and framed panels between the torches
    if (R.decor === 'frieze' || R.decor === 'both')
      for (const run of runs) L.friezes.push({ ...run, y: R.spring - 0.47, h: 0.5, pattern: R.frieze, finish: R.finish });
    if (R.decor === 'panels' || R.decor === 'both')
      for (const run of runs) for (let a = run.a0 + 1.6; a <= run.a1 - 1.6; a += 1.5){
        const clear = !L.sconces.some(o => o.run === run && Math.abs((run.horiz ? o.x : o.z) - a) < 2.2)
          && !hung.some(t => t.run === run && Math.abs((run.horiz ? t.x : t.z) - a) < t.w / 2 + 1.2)
          && !L.panels.some(o => o.run === run && Math.abs(o.a - a) < 2.6);
        if (!clear) continue;
        const x = run.horiz ? a : run.line + run.nx * 0.05, z = run.horiz ? run.line + run.nz * 0.05 : a;
        L.panels.push({ x, z, a, face: Math.atan2(run.nz, run.nx), s: 1.5, y: R.y + (R.kind === 'hallcrypt' ? 1.9 : 2.4), pattern: R.panel, run });
      }
  }
  // torches along the passages, every so often on alternate sides
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * CW + i; if (L.tag[k] !== 1) continue;
    const R = L.regions[L.reg[k]];
    for (const sd of [-1, 1]){
      const dx = R.axis === 'x' ? 0 : sd, dz = R.axis === 'x' ? sd : 0;
      if (isOpen(i + dx, j + dz) || ((i * 7 + j * 13 + (sd > 0 ? 3 : 0)) % 9) !== 0) continue;
      const [cx, cz] = centre(L, i, j), x = cx + dx * (CELL / 2 - 0.22), z = cz + dz * (CELL / 2 - 0.22);
      if (L.sconces.some(o => Math.hypot(o.x - x, o.z - z) < 9)) continue;
      L.sconces.push({ x, z, y: R.y + 2.0, face: Math.atan2(-dz, -dx), lit: false });
    }
    // now and then a carved panel in a passage wall
    for (const sd of [-1, 1]){
      const dx = R.axis === 'x' ? 0 : sd, dz = R.axis === 'x' ? sd : 0;
      if (isOpen(i + dx, j + dz) || ((i * 11 + j * 5 + (sd > 0 ? 7 : 0)) % 31) !== 0) continue;
      const [cx, cz] = centre(L, i, j), x = cx + dx * (CELL / 2 - 0.05), z = cz + dz * (CELL / 2 - 0.05);
      if (L.sconces.some(o => Math.hypot(o.x - x, o.z - z) < 2.5) || L.panels.some(o => Math.hypot(o.x - x, o.z - z) < 8)) continue;
      L.panels.push({ x, z, face: Math.atan2(-dz, -dx), s: 1.2, y: R.y + 1.5, pattern: PANEL[(i + j) % PANEL.length] });
    }
  }
  // The cathedral's walls: in each aisle bay a blind lancet under the lunette with
  // a dado of blind arcading below it and torches between; up the nave and choir,
  // a triforium of small arches and a clerestory of paired lancets over each bay;
  // a rose at the west and east ends and at each transept's end; tapestries on
  // the arms' walls; tombs in the choir aisles.
  function dressBasilica(C){
    const y = C.y, face = (nx, nz) => Math.atan2(nz, nx), sc = C.B / 9;    // its tracery scales with its bays
    for (const A of C.aisles) for (const run of runsOf(A)){
      if (run.len < 6) continue;
      L.friezes.push({ ...run, y: y + 1.3 * sc, h: 1.6 * sc, pattern: 'arcading', finish: A.finish });
      // one bay at a time: a lancet in the middle, a torch at each bay's edge
      for (let a = run.a0; a + C.B <= run.a1 + 0.1; a += C.B){
        const mid = a + C.B / 2, x = run.horiz ? mid : run.line + run.nx * 0.05, z = run.horiz ? run.line + run.nz * 0.05 : mid;
        L.panels.push({ x, z, face: face(run.nx, run.nz), w: 3.4 * sc, h: 6.2 * sc, y: C.low.spring + 0.4 * sc, pattern: 'lancet' });
        if (a > run.a0 + 0.1){
          const sx = run.horiz ? a : run.line + run.nx * 0.22, sz = run.horiz ? run.line + run.nz * 0.22 : a;
          L.sconces.push({ x: sx, z: sz, y: y + Math.min(3.4, C.P.aisleSpring - 1.2), face: face(run.nx, run.nz), lit: false });
        }
      }
    }
    // the elevation over each arcade bay, facing the nave or the choir
    const aisleTop = C.low.spring + C.low.H, gap = C.high.spring - aisleTop;
    for (const H of [C.nave, C.choir].filter(Boolean)) for (const side of [-1, 1]){
      for (let s0 = H.st[0]; s0 + C.B <= H.st[1] + 0.1; s0 += C.B){
        const [x, z] = C.at(s0 + C.B / 2, side * (C.NW / 2 - 0.04)), [cx, cz] = C.at(s0 + C.B / 2, 0), f = Math.atan2(Math.sign(cz - z), Math.sign(cx - x));
        if (gap > 3) L.panels.push({ x, z, face: f, w: 6.4 * sc, h: 2.6 * sc, y: aisleTop + 1.8 * sc, pattern: 'triforium' });   // where there's height for a gallery
        L.panels.push({ x, z, face: f, w: 4.4 * sc, h: 7 * sc, y: C.high.spring + 4.2 * sc, pattern: 'clerestory' });
      }
    }
    // roses: the west and east walls, and the end of each arm
    const ends = [[C.sW + 0.05, 0, 1, 0], [C.sE - 0.05, 0, -1, 0]];
    if (C.cross) ends.push([(C.sX + C.sC) / 2, C.ARM - 0.05, 0, -1], [(C.sX + C.sC) / 2, -C.ARM + 0.05, 0, 1]);
    for (const [s, t, ds, dt] of ends){
      const [x, z] = C.at(s, t), [x2, z2] = C.at(s + ds, t + dt), d = 0.61 * C.NW;
      L.panels.push({ x, z, face: Math.atan2(z2 - z, x2 - x), w: d, h: d, y: C.high.spring + 0.23 * C.high.H, pattern: 'rose' });
    }
    // tapestries on the arms' east and west walls, torches either side
    for (const A of [C.armN, C.armS].filter(Boolean)) for (const run of runsOf(A)){
      if (run.len < 10 || run.horiz === (A.axis === 'x')) continue;      // the long walls only, not the end
      const mid = (run.a0 + run.a1) / 2, x = run.horiz ? mid : run.line + run.nx * 0.14, z = run.horiz ? run.line + run.nz * 0.14 : mid;
      const set = r() < 0.75 ? TAPESTRIES : WAGARA;
      L.tapestries.push({ x, z, face: face(run.nx, run.nz), w: 6.5, h: 6, top: y + 10, tex: set[(r() * set.length) | 0], seed: (r() * 1e9) | 0, run });
      for (const d of [-5, 5]){
        const sx = run.horiz ? mid + d : run.line + run.nx * 0.22, sz = run.horiz ? run.line + run.nz * 0.22 : mid + d;
        L.sconces.push({ x: sx, z: sz, y: y + 3.4, face: face(run.nx, run.nz), lit: false });
      }
    }
    // tombs down the choir aisles, grave goods on some
    if (!sty.palace) for (const A of C.aisles.slice(2)) for (let k = 0; k < C.P.CB; k += 2){
      const s = A.st[0] + C.B * (k + 0.5), t = (A.st[2] + A.st[3]) / 2, [x, z] = C.at(s, t);
      L.props.push({ kind: 'coffin', x, z, a: Dx ? 0 : Math.PI / 2, hl: 1.6, hw: 0.8, y, h: 1.3, solid: true });
      if (r() < 0.6) L.finds.push({ x, z, y: y + 1.35, kind: r() < 0.6 ? 'amber' : 'quartz', n: 2, onProp: true });
    }
  }
  for (const C of L.basilicas) dressBasilica(C);
  // the rooms made of the same pieces
  function dressSpecial(sp){
    const y = sp.y, face = (nx, nz) => Math.atan2(nz, nx), at2 = (run, a, o) => run.horiz ? [a, run.line + run.nz * o] : [run.line + run.nx * o, a];
    const torch = (run, a, h) => { const [x, z] = at2(run, a, 0.22); L.sconces.push({ x, z, y: y + h, face: face(run.nx, run.nz), lit: false, run }); };
    const panel = (run, a, w, h, cy, pattern) => { const [x, z] = at2(run, a, 0.05); L.panels.push({ x, z, face: face(run.nx, run.nz), w, h, y: cy, pattern }); };
    const R = sp.regions[0];
    if (sp.kind === 'chapel'){
      const along = run => run.horiz === (R.axis === 'x');
      for (const run of runsOf(R)){
        if (along(run)){
          // the side walls: a dado of blind arcading, a lancet in each bay, torches between
          L.friezes.push({ ...run, y: y + 1.1, h: 1.4, pattern: 'arcading', finish: R.finish });
          for (let a = R.u0; a + R.bayU <= R.u1 + 0.1; a += R.bayU){
            if (a + R.bayU / 2 > run.a0 + 1.5 && a + R.bayU / 2 < run.a1 - 1.5) panel(run, a + R.bayU / 2, 2.4, 4.6, R.spring + 0.6, 'lancet');
            if (a > run.a0 + 1 && a < run.a1 - 1) torch(run, a, 3);
          }
        } else if (run.len > 6){
          // an end wall: a rose high under the vault
          panel(run, (run.a0 + run.a1) / 2, 0.55 * (R.v1 - R.v0), 0.55 * (R.v1 - R.v0), R.spring + 0.3 * R.H, 'rose');
        }
      }
      // the altar in the apse, with a brazier either side of it
      const ax = sp.apse.x, az = sp.apse.z;
      L.props.push({ kind: 'altar', x: ax + Dx * 2.0, z: az + Dz * 2.0, a: Dx ? Math.PI / 2 : 0, hl: 0.9, hw: 1.6, y, h: 1.2, solid: true });
      for (const d of [-3, 3]){ const x = ax + Dx * 0.6 - Dz * d, z = az + Dz * 0.6 + Dx * d; L.sconces.push({ kind: 'brazier', x, z, y, face: 0, lit: false }); L.props.push({ kind: 'brazier', x, z, r: 0.55, y, solid: true }); }
    } else if (sp.kind === 'chapterhouse'){
      // the central pier the four bays spring from, the bench round the walls, lancets over it
      L.props.push({ kind: 'pier', style: 'gothic', x: R.cx, z: R.cz, k: 1.2, r: 0.95 * 1.2, big: false, y, h: R.spring - y, top: R.spring, solid: true, noShaft: true, toNave: [0, 0] });
      for (const run of runsOf(R)){
        L.benches = L.benches || [];
        L.benches.push({ ...run, y, h: 0.55, d: 0.8 });
        L.friezes.push({ ...run, y: y + 1.6, h: 1.3, pattern: 'arcading', finish: R.finish });
        for (let a = run.a0; a < run.a1 - 0.1; a += R.bayU){
          const mid = a + R.bayU / 2;
          if (mid > run.a0 + 1.5 && mid < run.a1 - 1.5) panel(run, mid, 3.2, 5.2, R.spring + 0.8, 'clerestory');
          if (a > run.a0 + 1) torch(run, a, 3.4);
        }
      }
    } else if (sp.kind === 'gilthall'){
      // a clustered pier at every inner corner, braziers in alternate bays, tapestries
      // and glass along the walls, gold on its altar
      for (let u = R.u0 + R.bayU; u < R.u1 - 0.1; u += R.bayU) for (let v = R.v0 + R.bayV; v < R.v1 - 0.1; v += R.bayV){
        const [x, z] = R.axis === 'x' ? [u, v] : [v, u];
        L.props.push({ kind: 'pier', style: 'gothic', x, z, k: 1.6, r: 0.95 * 1.6, big: false, y, h: R.spring - y, top: R.spring, solid: true, noShaft: true, toNave: [0, 0] });
      }
      let n = 0;
      for (let u = R.u0 + R.bayU / 2; u < R.u1; u += R.bayU) for (let v = R.v0 + R.bayV / 2; v < R.v1; v += R.bayV){
        if (n++ % 2) continue;
        const [x, z] = R.axis === 'x' ? [u, v] : [v, u];
        L.sconces.push({ kind: 'brazier', x, z, y, face: 0, lit: false }); L.props.push({ kind: 'brazier', x, z, r: 0.55, y, solid: true });
      }
      for (const run of runsOf(R)){
        for (let a = run.a0; a + R.bayU <= run.a1 + 0.1; a += R.bayU){
          const mid = a + R.bayU / 2;
          if (mid < run.a0 + 3 || mid > run.a1 - 3) continue;
          const [x, z] = at2(run, mid, 0.14), set = r() < 0.7 ? TAPESTRIES : WAGARA;
          if (((mid / R.bayU) | 0) % 2) L.tapestries.push({ x, z, face: face(run.nx, run.nz), w: 7, h: 6.5, top: y + 8.5, tex: set[(r() * set.length) | 0], seed: (r() * 1e9) | 0, run });
          else panel(run, mid, 4.4, 7.5, y + 5.2, 'clerestory');
        }
      }
      const [ex, ez] = [R.cx, R.cz];
      void ex; void ez;
    } else if (sp.kind === 'undercroft'){
      // a column at each inner bay corner, down the middle
      for (let u = R.u0 + R.bayU; u < R.u1 - 0.1; u += R.bayU){ const [x, z] = R.axis === 'x' ? [u, R.c] : [R.c, u]; L.props.push({ kind: 'column', x, z, r: 0.62, y, h: R.spring - y, solid: true }); }
      for (const run of runsOf(R)) for (let a = run.a0 + 3; a < run.a1 - 1; a += 6) torch(run, a, 1.9);
    } else if (sp.kind === 'cloister'){
      // the walks: torches on the outer walls at each bay's edge, blind tracery on the garth side
      const [gx, gz] = at((sp.st[0] + sp.st[1]) / 2, (sp.st[2] + sp.st[3]) / 2);
      for (const W of sp.regions) for (const run of runsOf(W)){
        const toGarth = Math.sign(gx - (run.horiz ? (run.a0 + run.a1) / 2 : run.line)) * run.nx + Math.sign(gz - (run.horiz ? run.line : (run.a0 + run.a1) / 2)) * run.nz < 0;
        for (let a = run.a0; a + 6 <= run.a1 + 0.1; a += 6){
          if (toGarth) panel(run, a + 3, 3.4, 4.4, W.spring + 0.1, 'clerestory');   // the walk's own wall on the garth: an arcade, blind
          else if (a > run.a0 + 1) torch(run, a, 2.6);
        }
      }
    }
  }
  for (const sp of L.special) dressSpecial(sp);
  // How each room is lit. Chapels, chapter houses, round rooms: candles, on iron
  // stands before the walls and on the altars; the great halls: braziers on the
  // floor; the rest keep their torches. A wall's torch becomes a stand in front of it.
  const CANDLE = new Set(['chapel', 'apse', 'chapterhouse', 'octagon', 'rotunda', 'ambulatory', 'chapel-r']);
  const BRAZIER = new Set(['hall', 'crossing', 'hallcrypt', 'undercroft']);
  const regionAt = (x, z) => { const [i, j] = cellOf(L, x, z); const k = j * CW + i; return L.open[k] ? L.regions[L.reg[k]] : null; };
  let alt = 0;
  L.sconces = L.sconces.flatMap(sc => {
    if (sc.kind) return [sc];
    const R = regionAt(sc.x, sc.z), kind = R && R.kind, fx = Math.cos(sc.face), fz = Math.sin(sc.face);
    if (CANDLE.has(kind)) return [{ kind: 'candles', x: sc.x + fx * 0.9, z: sc.z + fz * 0.9, y: R.y, face: sc.face, lit: false }];
    if (BRAZIER.has(kind)) return alt++ % 2 ? [] : [{ kind: 'brazier', x: sc.x + fx * 1.6, z: sc.z + fz * 1.6, y: R.y, face: 0, lit: false }];
    return [sc];
  });
  for (const sc of L.sconces) if (sc.kind === 'candles' || (sc.kind === 'brazier' && !L.props.some(p => p.kind === 'brazier' && p.x === sc.x && p.z === sc.z)))
    L.props.push({ kind: sc.kind === 'candles' ? 'stand' : 'brazier', x: sc.x, z: sc.z, r: sc.kind === 'candles' ? 0.4 : 0.55, y: sc.y, solid: true });
  // a pair of candles on every altar
  for (const p of L.props.filter(q => q.kind === 'altar')){
    const c = Math.cos(p.a), sn = Math.sin(p.a);
    for (const d of [-1, 1]){ const u = d * (p.hw - 0.3); L.sconces.push({ kind: 'altarCandle', x: p.x - sn * u, z: p.z + c * u, y: p.y + p.h, face: 0, lit: false }); }
  }
  // wax run down from the altar candles, on about half the altars (ingredients.js beeswax,
  // for the fairy salve): by a hash of where the altar stands, not r(), so the levels'
  // random stream (and everything dealt after this) is unchanged
  for (const p of L.props.filter(q => q.kind === 'altar')){
    let h = 2166136261 >>> 0; for (const c of `${p.x.toFixed(2)},${p.z.toFixed(2)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    if (h % 100 < 50 && !L.finds.some(f => Math.hypot(f.x - p.x, f.z - p.z) < 0.8))
      L.finds.push({ x: p.x, z: p.z, y: p.y + p.h, kind: sty.palace ? 'amber' : 'beeswax', n: sty.palace ? 2 : 1, onProp: true });
  }
  shelves(L, r, spec, runsOf, at, isOpen);
  // where E aims at each light: a torch's head, a brazier's bowl, a stand's candles, an altar's
  if (sty.palace) for (const sc of L.sconces) sc.lit = true;
  for (const sc of L.sconces) sc.aimY = sc.y + ({ brazier: 1.5, candles: 1.45, altarCandle: 0.3 }[sc.kind] ?? 0.45);
  // torches and panels the passages left hanging over an opening (a passage can
  // still meet a curved wall where one was planned): off with them
  const openAt = openAtOf(L), backed = (x, z, face) => !openAt(x - Math.cos(face) * 0.5, z - Math.sin(face) * 0.5);
  L.sconces = L.sconces.filter(s => s.kind || (openAt(s.x, s.z) && backed(s.x, s.z, s.face)));   // braziers and candles stand free
  L.panels = L.panels.filter(p => backed(p.x, p.z, p.face));
  // doorways: where a passage runs into a room along its own axis
  const seen = new Set();
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * CW + i; if (L.tag[k] !== 1) continue;
    for (const ri of [L.reg[k], L.reg2[k]]){
      if (ri < 0) continue;
      const R = L.regions[ri];
      for (const sd of [-1, 1]){
        const ni = i + (R.axis === 'x' ? sd : 0), nj = j + (R.axis === 'z' ? sd : 0);
        if (!isOpen(ni, nj) || L.tag[nj * CW + ni] !== 4 || L.regions[L.reg[nj * CW + ni]].type === 'shaped') continue;   // a curved wall's doorway has no flat ring to stand in
        const line = R.axis === 'x' ? x0 + (sd > 0 ? i + 1 : i) * CELL : z0 + (sd > 0 ? j + 1 : j) * CELL;
        const key = `${ri}:${line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        L.doorways.push({ axis: R.axis, line, c: R.c, into: sd, y: R.y, spring: R.y + R.head, rad: R.rad });
      }
    }
  }
  return L;
}

// ---- shared ------------------------------------------------------------------------
// distance (u) from each open cell to the nearest solid one, for a W×H grid
function wallDist(L, k){
  if (!L._wd){
    // pad to a square so the chamfer transform (written for G×G) applies
    const G = Math.max(L.W, L.H), D = distanceField(G, q => { const i = q % G, j = (q / G) | 0; return i >= L.W || j >= L.H || !L.open[j * L.W + i]; }, CELL);
    L._wd = new Float32Array(L.W * L.H);
    for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++) L._wd[j * L.W + i] = D[j * G + i];
  }
  return L._wd[k];
}
function ceilings(L, f){
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * L.W + i; if (!L.open[k]) continue;
    const [x, z] = centre(L, i, j); L.ceil[k] = f(k, x, z);
  }
  smoothOpen(L, L.ceil, 1);
}
// blur a per-cell array over open cells only
function smoothOpen(L, a, passes){
  const { W, H } = L, t = new Float32Array(a.length);
  for (let p = 0; p < passes; p++){
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++){
      const k = j * W + i; if (!L.open[k]){ t[k] = a[k]; continue; }
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
        const a2 = i + di, b2 = j + dj; if (a2 < 0 || b2 < 0 || a2 >= W || b2 >= H) continue;
        const q = b2 * W + a2; if (L.open[q] && L.tag[q] !== 3){ s += a[q]; n++; }
      }
      t[k] = L.tag[k] === 3 || !n ? a[k] : s / n;
    }
    a.set(t);
  }
}
// an open spot within R of (x, z), clear of the walls by a body and more
function openNear(L, x, z, R, r){
  for (let q = 0; q < 30; q++){
    const a = r() * Math.PI * 2, d = r() * R, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if ([[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [0, 0]].every(([dx, dz]) => openCell(L, px + dx, pz + dz))) return [px, pz];
  }
  return null;
}
const openCell = (L, x, z) => { const [i, j] = cellOf(L, x, z); return i >= 0 && j >= 0 && i < L.W && j < L.H && L.open[j * L.W + i] === 1; };
// patches of glowing fungus low on a chamber's walls: open cells beside a solid one
function glowAround(L, c, r, p = 0.35, up = 1.2){
  const [i0, j0] = cellOf(L, c.x - c.R - 4, c.z - c.R - 4), [i1, j1] = cellOf(L, c.x + c.R + 4, c.z + c.R + 4);
  for (let j = Math.max(1, j0); j <= Math.min(L.H - 2, j1); j++) for (let i = Math.max(1, i0); i <= Math.min(L.W - 2, i1); i++){
    const k = j * L.W + i; if (!L.open[k] || r() > p) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      if (L.open[(j + dj) * L.W + i + di]) continue;
      const [x, z] = centre(L, i, j);
      L.glow.push({ x: x + di * CELL * 0.45, z: z + dj * CELL * 0.45, k, up: 0.2 + r() * up });
      break;
    }
  }
}
