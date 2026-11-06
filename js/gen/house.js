// The houses' language: docs/houses.md. settle.js says where a building stands and
// how long it is; this says what it is, by applying patterns one after another,
// each to what the last one left (The Timeless Way, ch. 20 and 21). A pattern reads
// a force from the site (which way is south, which end is downhill, what the land
// round the settlement gives, how old the house is), so two houses differ for a
// reason, and the same language gives a different house on a different plot.
//
// Pure (no three.js), and it draws from its own seed stream, so it can't move
// anything the planner laid. js/house-view.js draws what this decides.

import { mulberry32 } from '../rng.js';
import { UNITS_PER_M } from '../config.js';
import { at, overlaps } from './settle.js';

const M = UNITS_PER_M;
const PART_GAP = 1.6;           // clear ground a wing or wagon porch leaves to the next building (u)
const PASSAGE = 0.85 * M;       // half the width of the cross-passage behind the door
const DOOR_W = 0.95 * M;

// limewash: earth colours only (250 WARM COLORS)
const WASHES = [
  [0.93, 0.89, 0.78],   // lime white
  [0.86, 0.72, 0.47],   // yellow ochre
  [0.84, 0.64, 0.55],   // limewash with ox blood
  [0.76, 0.69, 0.55],   // clay left near its own colour
];
const DOOR_PAINT = [[0.46, 0.30, 0.19], [0.56, 0.22, 0.15], [0.28, 0.34, 0.25], [0.36, 0.30, 0.26]];
const WOODS = new Set(['woodland', 'grove', 'carr']);
const ROUGH = new Set(['heath', 'highland', 'rock']);

// ---- one settlement's dialect -------------------------------------------------------
// 102 FAMILY OF ENTRANCES, and ch. 22: a group of buildings as if with a single
// mind. Neighbours share a way of walling, a way of making a door and a way of
// finishing a ridge. The walling comes from what the land round them gives.
function dialect(place, habitat, r){
  let wood = 0, rough = 0, n = 0;
  for (let q = 0; q < 48; q++){
    const t = q * 2.399963, d = 30 + q * 3;     // a spiral out to about 170u
    const h = habitat(place.x + Math.cos(t) * d, place.z + Math.sin(t) * d);
    if (WOODS.has(h)) wood++; else if (ROUGH.has(h)) rough++;
    n++;
  }
  wood /= n; rough /= n;
  const wall = rough > 0.3 ? 'stone' : wood > 0.4 && place.kind !== 'village' ? 'logs' : 'daub';
  const a = (r() * WASHES.length) | 0, b = (a + 1 + ((r() * (WASHES.length - 1)) | 0)) % WASHES.length;
  return {
    wall,
    washes: [WASHES[a], WASHES[a], WASHES[b]],   // most houses one colour, some the other
    studs: place.kind === 'village' ? 0.62 * M : 1.05 * M,
    porch: ['posted', 'sweep', 'hood'][place.kind === 'village' ? (r() < 0.7 ? 0 : 1) : (r() * 3) | 0],
    ridge: ['point', 'scallop', 'plain'][(r() * 3) | 0],
    paint: DOOR_PAINT[(r() * DOOR_PAINT.length) | 0],
  };
}

// ---- the forces on one plot ---------------------------------------------------------
function forces(b, height){
  const c = Math.cos(b.a), s = Math.sin(b.a);
  const nf = [-s * b.door, c * b.door];          // out of the front (+z is south)
  const drop = height(...at(b, b.hl, 0)) - height(...at(b, -b.hl, 0));
  return {
    sunFront: nf[1],                             // 1: the front faces south, -1: north
    drop,
    low: Math.abs(drop) > 0.3 ? (drop < 0 ? 1 : -1) : 0,   // the downhill end, if the ground has one
    west: [-c, c],                               // how far each end (-u, +u) faces west
    south: [-s, s],                              // how far each end (-u, +u) faces south
  };
}

// Is a part standing out of a building clear of everything else on the ground?
function partFits(p, owner, S, green){
  for (const o of S.buildings){
    if (o === owner) continue;
    if (overlaps(p, o, PART_GAP))return false;
    for (const q of o.parts || []) if (overlaps(p, q, PART_GAP)) return false;
  }
  for (const f of S.fields) if (overlaps(p, f, 0.5))return false;
  const c = Math.cos(p.a), s = Math.sin(p.a);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [p.x + c * u * p.hl - s * v * p.hw, p.z + s * u * p.hl + c * v * p.hw]);
  for (const l of S.lanes) for (const [x, z] of corners) if (l.nearest(x, z).d < 2.8)return false;
  if (green) for (const [x, z] of corners){
    const dx = x - green.x, dz = z - green.z, gc = Math.cos(green.a), gs = Math.sin(green.a);
    const gu = (dx * gc + dz * gs) / green.rx, gv = (-dx * gs + dz * gc) / green.rz;
    if (gu * gu + gv * gv < 1)return false;
  }
  return true;
}
// an oriented box in a building's frame (centre u, v; v + toward the door side)
function part(b, u, v, hu, hv){
  const [x, z] = at(b, u, v);
  return { x, z, a: b.a, hl: hu, hw: hv, part: true };
}

// ---- dwellings ----------------------------------------------------------------------
function dressDwelling(b, place, lang, S, height, r){
  const cottage = b.kind === 'cottage', { hl, hw } = b, F = forces(b, height);
  const form = b.form = {
    wall: lang.wall, roof: 'thatch', studs: lang.studs,
    wash: lang.washes[(r() * lang.washes.length) | 0].map(c => c * (0.96 + r() * 0.06)),
    age: r(), paint: lang.paint, ridge: lang.ridge, parts: {},
  };
  // 117 SHELTERING ROOF: the eaves come down low; the roof is most of what you see.
  form.E = (cottage ? 1.85 : 1.95) + r() * 0.2;
  form.pitch = 48 + r() * 7;
  form.sag = (0.05 + form.age * form.age * 0.32) * M;     // old frames settle

  // The downhill end: a longhouse keeps its beasts at the low end so the muck
  // drains away from the hearth. So the door, which stands at the head of the
  // byre, moves to that end. Only its side changes, never its distance.
  if (F.low) b.du = F.low * Math.abs(b.du);
  const low = Math.sign(b.du) || 1;
  form.lowEnd = F.low;
  const du = b.du;

  // 205 STRUCTURE FOLLOWS SOCIAL SPACES. A cross-passage behind the door, the
  // working end below it, the hall and perhaps a chamber above it, each in bays.
  const lines = new Set([-hl, hl, du - PASSAGE, du + PASSAGE]);
  const bays = [{ u0: du - PASSAGE, u1: du + PASSAGE, use: 'passage' }];
  const divide = (a, c, uses) => {
    const len = Math.abs(c - a), n = Math.max(1, Math.round(len / (3.7 * M)));
    let at0 = a;
    for (let i = 0; i < n; i++){
      const jit = i < n - 1 ? (r() - 0.5) * 0.14 * len / n : 0;
      const at1 = i === n - 1 ? c : a + (c - a) * (i + 1) / n + jit;
      bays.push({ u0: Math.min(at0, at1), u1: Math.max(at0, at1), use: uses(i, n) });
      lines.add(at1);
      at0 = at1;
    }
  };
  const lowLen = hl - Math.abs(du) - PASSAGE;
  const byre = !cottage && lowLen > 1.8 * M && 2 * hl >= 9.2 * M;
  divide(du + low * PASSAGE, low * hl, () => byre ? 'byre' : 'service');
  divide(du - low * PASSAGE, -low * hl, (i, n) => i === 0 ? 'hall' : 'chamber');
  form.bays = bays;
  form.lines = [...lines].sort((p, q) => p - q);
  form.du = du;

  // 116 CASCADE OF ROOFS. Lesser roofs fall from the great one. The cold side
  // gets a catslide over an outshot; a rear that faces the sun keeps its windows.
  const rearNorth = F.sunFront > 0.15;
  const wantsOutshot = rearNorth && (!cottage || r() < 0.6);
  form.rearOd = wantsOutshot ? Math.min(1.5 * M, hw * 0.55) : 0;
  form.frontOd = 0;
  form.Eo = 1.3 + r() * 0.15;

  // Ends turned to the weather are half-hipped; the byre end is hipped down low.
  // (West taken as the weather side, as in England.)
  const end = sign => {
    const i = sign < 0 ? 0 : 1;
    if (byre && sign === low) return r() < 0.75 ? 'hip' : 'half';
    if (F.west[i] > 0.35) return 'half';
    return r() < (cottage ? 0.45 : 0.25) ? 'half' : 'gable';
  };
  form.ends = [end(-1), end(1)];

  // The hearth: a lobby stack behind the passage wall, or on a cottage a stack
  // built up outside the gable where the fire is.
  const high = -low;
  if (cottage && r() < 0.5){
    form.ends[high < 0 ? 0 : 1] = 'gable';
    form.chimney = { kind: 'gable', end: high };
  } else form.chimney = { kind: 'ridge', u: du + high * (PASSAGE + 0.2 * M) };

  // 95 BUILDING COMPLEX, 161 SUNNY PLACE. A long house with a sunny or sideways
  // front may gain a chamber wing at its high end, standing forward: the corner
  // it makes is the sheltered place. Only where the plot has the room.
  if (!cottage && 2 * hl >= 9.2 * M && F.sunFront > -0.5 && r() < 0.8){
    const ww = 4.0 * M + r() * 0.6 * M, wp0 = (1.5 + r() * 0.8) * M, wE = 2.95 + r() * 0.25, jetty = r() < 0.7;
    const wu = high * (hl - ww / 2);
    if (Math.abs(du - wu) > ww / 2 + PASSAGE + DOOR_W){
      // fitted to the plot: a tight one gets a wing that stands less far forward
      for (const wp of [wp0, wp0 * 0.65, 0.8 * M]){
        const p = part(b, wu, hw + wp / 2, ww / 2, wp / 2);
        if (!partFits(p, b, S, place.green)) continue;
        form.wing = { u: wu, ww, wp, E: wE, jetty: jetty && place.kind === 'village', cut: wu };
        form.ends[high < 0 ? 0 : 1] = 'none';    // the main roof runs into the wing
        if (form.chimney.kind === 'ridge' && Math.abs(form.chimney.u - wu) < ww / 2) form.chimney.u = wu - high * (ww / 2 + 0.3 * M);
        b.parts = [...(b.parts || []), p];
        break;
      }
    }
  }

  // 110 MAIN ENTRANCE, 112 ENTRANCE TRANSITION, 224 LOW DOORWAY. The roof lifts
  // over the door, and the dialect says what else stands there.
  form.porch = lang.porch;
  form.door = { w: DOOR_W, h: (cottage ? 1.68 : 1.74) * M };

  // 192 WINDOWS OVERLOOKING LIFE. They go in the rooms that need them, and look
  // at something: the green, the field, the south. Beasts get vents.
  const wing = form.wing;
  const inWing = u => wing && Math.abs(u - wing.u) < wing.ww / 2 + 0.5 * M;
  const clearOfDoor = (u, w) => Math.abs(u - du) > DOOR_W / 2 + w / 2 + 0.25 * M + (lang.porch === 'posted' ? 0.4 * M : 0);
  const windows = form.windows = [], vents = form.vents = [];
  for (const bay of bays){
    const mid = (bay.u0 + bay.u1) / 2 + (r() - 0.5) * 0.3 * M, len = bay.u1 - bay.u0;
    if (bay.use === 'passage') continue;
    if (bay.use === 'byre'){ vents.push({ u: mid, side: 1 }); if (!form.rearOd) vents.push({ u: mid, side: -1 }); continue; }
    const big = bay.use === 'hall', w = Math.min(len * 0.45, (big ? (F.sunFront > 0.2 ? 1.25 : 0.95) : 0.7) * M);
    if (!inWing(mid) && clearOfDoor(mid, w) && Math.abs(mid) < hl - w / 2 - 0.35 * M) windows.push({ side: 1, u: mid, w, h: 0.55 * M });
    if (!form.rearOd && !inWing(mid) && bay.use !== 'service' && Math.abs(mid) < hl - 0.7 * M) windows.push({ side: -1, u: mid, w: 0.55 * M, h: 0.45 * M });
  }
  // somewhere to look out, whatever the bays allowed
  if (!windows.length){
    const u = high * Math.min(hl * 0.55, hl - 0.9 * M);
    if (!inWing(u) && clearOfDoor(u, 0.7 * M)) windows.push({ side: 1, u, w: 0.7 * M, h: 0.55 * M });
    else windows.push({ side: -1, u: du, w: 0.6 * M, h: 0.45 * M });
  }
  // the roof holds the top of the house: a loft window in a gable, or an eyebrow
  const gableEnd = [-1, 1].find(s => form.ends[s < 0 ? 0 : 1] !== 'none' && form.ends[s < 0 ? 0 : 1] !== 'hip' && !(form.chimney.kind === 'gable' && form.chimney.end === s));
  if (gableEnd) form.loft = { end: gableEnd };
  if (!wing || Math.abs(du - wing.u) > wing.ww){
    const hall = bays.find(q => q.use === 'hall');
    const eu = hall ? (hall.u0 + hall.u1) / 2 : -low * hl * 0.5;
    if ((!cottage || r() < 0.7) && !inWing(eu) && Math.abs(eu - du) > 1.8 * M && Math.abs(eu) < hl - 1.6 * M && r() < 0.65) form.eyebrow = { u: eu };
  }

  // 160 BUILDING EDGE, 242 FRONT DOOR BENCH. A bench where the sun is. The next
  // thing along from the door on the front, or if the front is cold, the gable
  // that gets the sun.
  const sunSide = high;
  const bu = du + sunSide * (DOOR_W / 2 + 1.15 * M + (lang.porch === 'posted' ? 0.4 * M : 0));
  if (F.sunFront > -0.3 && !inWing(bu) && Math.abs(bu) < hl - 0.8 * M) form.bench = { side: 1, u: bu };
  else {
    const e = F.south[1] > F.south[0] ? 1 : -1;
    if (form.ends[e < 0 ? 0 : 1] !== 'none' && !(form.chimney.kind === 'gable' && form.chimney.end === e)) form.bench = { end: e };
  }

  // 168 CONNECTION TO THE EARTH, 245 RAISED FLOWERS. The door has its stone and
  // its worn path; where the front is sunny, beds stand against the wall.
  form.beds = [];
  if (F.sunFront > -0.1) for (const s of [-1, 1]){
    const near = du + s * (DOOR_W / 2 + 0.35 * M + (lang.porch === 'posted' ? 0.5 * M : 0)), far = s * (hl - 0.3 * M);
    let a = Math.min(near, far), c = Math.max(near, far);
    if (wing){ const w0 = wing.u - wing.ww / 2 - 0.2 * M, w1 = wing.u + wing.ww / 2 + 0.2 * M; if (a < w1 && c > w0){ if (s === Math.sign(wing.u - du)) { if (s > 0) c = w0; else a = w1; } } }
    if (form.bench && form.bench.side === 1 && Math.sign(form.bench.u - du) === s){
      const edge = form.bench.u + s * 0.85 * M;
      if (s > 0) a = Math.max(a, edge); else c = Math.min(c, edge);
    }
    if (c - a > 1.4 * M) form.beds.push({ u0: a, u1: c, seed: (r() * 1e6) | 0 });
  }

  // 249 ORNAMENT, where things join: the lintel, the ridge. Rowan over the door
  // keeps the Good Folk out, and a straw bird on the ridge is the thatcher's name.
  form.rowan = r() < 0.55;
  form.finial = !cottage && r() < 0.5;

  // ch. 24, the process of repair. An old roof wears a newer patch, sometimes with
  // the ladder still against it; a house is a thing still being looked after.
  if (form.age > 0.45 && r() < 0.65){
    const side = form.rearOd || r() < 0.6 ? 1 : -1;
    const pu = -low * hl * (0.15 + r() * 0.5);        // the far side from the door and its lifted eaves
    if (!inWing(pu)) form.patch = { side, u: pu, hu: (0.9 + r() * 0.7) * M, t0: 0.15 + r() * 0.2, t1: 0.55 + r() * 0.3, ladder: side === 1 && r() < 0.6 };
  }
  form.butt = r() < 0.55 ? { u: low * (hl - 0.45 * M) } : null;
  form.skep = r() < 0.3;
  return form;
}

// ---- the working buildings ----------------------------------------------------------
// A barn is a threshing floor between two great doors, the bays either side for
// the corn, its roof carried on down over aisles: 116, and what a barn is for
// (The Timeless Way, ch. 10). The wagon porch stands out toward the yard if it fits.
function dressBarn(b, place, lang, S, height, r){
  const { hl, hw } = b, F = forces(b, height);
  const form = b.form = { wall: lang.wall === 'stone' ? 'stone' : 'boards', roof: 'shingle', age: r(), parts: {}, studs: 1.6 * M };
  form.E = 3.3 + r() * 0.4; form.pitch = 44 + r() * 5; form.sag = (0.05 + form.age * 0.16) * M;
  const aisle = Math.min(1.45 * M, hw * 0.42);
  form.rearOd = aisle; form.frontOd = aisle; form.Eo = 1.75 + r() * 0.2;
  form.ends = [-1, 1].map((s, i) => F.west[i] > 0.35 ? 'hip' : r() < 0.5 ? 'half' : 'gable');
  const n = Math.max(3, Math.round(2 * hl / (3.4 * M)) | 1);        // an odd number, so the floor is a middle bay
  form.lines = Array.from({ length: n + 1 }, (_, i) => -hl + 2 * hl * i / n);
  form.bays = [];
  form.du = 0;
  form.floorW = Math.min(1.7 * M, 2 * hl / n * 0.46);
  const pd = (1.6 + r() * 0.5) * M;
  const p = part(b, 0, hw + pd / 2, form.floorW + 0.15 * M, pd / 2);
  if (partFits(p, b, S, place.green)){ form.midstrey = { d: pd, E: 2.65 + r() * 0.2 }; b.parts = [...(b.parts || []), p]; }
  form.owl = form.ends.findIndex(e => e !== 'hip');
}
function dressPlain(b, lang, r){
  const shed = b.kind === 'shed';
  b.form = {
    wall: lang.wall === 'stone' && shed ? 'stone' : 'boards', roof: shed ? 'shingle' : 'thatch', age: r(), parts: {}, studs: 1.5 * M,
    E: null, pitch: null, sag: (0.03 + r() * 0.1) * M, rearOd: 0, frontOd: 0, Eo: 1.3,
    ends: shed ? ['gable', 'gable'] : ['hip', 'hip'], lines: [-b.hl, b.hl], bays: [], du: 0,
    ridge: 'plain', staddles: !shed,
  };
}

// Dress every building of the settlements. Draws from its own stream, per building,
// so that nothing the planner has placed can move. `height` and `habitat` are the
// land before the pads are graded, so the slope a house was built against still shows.
export function dressSettlements(S, { height, habitat, seed }){
  S.places.forEach((place, i) => {
    const rp = mulberry32((seed ^ 0x40a5e ^ (i * 0x9e3779b1)) >>> 0);
    const lang = place.lang = dialect(place, habitat, rp);
    place.buildings.forEach((b, j) => {
      const r = mulberry32((seed ^ 0xb1d6 ^ (i * 7919) ^ (j * 104729)) >>> 0);
      if (b.dwelling) dressDwelling(b, place, lang, S, height, r);
      else if (b.kind === 'barn') dressBarn(b, place, lang, S, height, r);
      else dressPlain(b, lang, r);
    });
  });
}

