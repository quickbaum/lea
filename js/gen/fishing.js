// fishing.js — where you can fish in the Lea: places on the bank where deep
// water comes close in, found from the land itself (docs/fishing.md). Pure: no
// rendering, no sim. agents.js fishes them, main.js lets the player cast there,
// js/fishing-view.js draws the floats and the fish rising.
//
// A spot is { x, z } where you stand, { wx, wz } where the float sits, `face` the
// way you look (atan2(dx, dz), as headings are), and `kind`: 'eels' off muddy,
// reedy banks (marsh, fen, carr), 'fish' elsewhere. `stock` 0..1 is how many are
// about: each catch takes some, and it comes back over a day or so.

const DIRS = 16;
const NEAR = 2.5;      // water this close to the bank…
const OUT  = 6;        // …and deep this far out
const DEEP = 0.6;      // how far below the waterline "deep" is
const STEP = 6;        // survey grid
const SPACING = 22;    // spots no closer than this
const MAX_SPOTS = 90;
const MUDDY = new Set(['marsh', 'fen', 'carr', 'wetmeadow']);

export function fishingSpots({ height, walkable, water, radius, habitat = null, rng = Math.random }){
  const cands = [];
  for (let z = -radius; z <= radius; z += STEP) for (let x = -radius; x <= radius; x += STEP){
    if (Math.hypot(x, z) > radius * 0.95) continue;
    const h = height(x, z);
    if (h < water || h > water + 1.2) continue;                     // near the waterline…
    if (height(x + STEP, z) > water && height(x - STEP, z) > water
     && height(x, z + STEP) > water && height(x, z - STEP) > water) continue;   // …with water beside it (cheap test first)
    if (!walkable(x, z)) continue;                                   // on the bank
    let best = null;
    for (let k = 0; k < DIRS; k++){
      const a = k / DIRS * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      if (height(x + dx * NEAR, z + dz * NEAR) > water - 0.15) continue;
      const deep = water - height(x + dx * OUT, z + dz * OUT);
      if (deep < DEEP) continue;
      if (!best || deep > best.deep) best = { a, dx, dz, deep };
    }
    if (!best) continue;
    const kind = habitat && MUDDY.has(habitat(x, z)) ? 'eels' : 'fish';
    cands.push({ x, z, wx: x + best.dx * 4, wz: z + best.dz * 4, face: best.a, kind, deep: best.deep, r: rng() });
  }
  // the deepest water close in first (a little shuffled), spaced out along the shore
  cands.sort((p, q) => (q.deep + q.r) - (p.deep + p.r));
  const spots = [];
  for (const c of cands){
    if (spots.length >= MAX_SPOTS) break;
    if (spots.some(s => Math.hypot(s.x - c.x, s.z - c.z) < SPACING)) continue;
    spots.push({ x: c.x, z: c.z, wx: c.wx, wz: c.wz, face: c.face, kind: c.kind, stock: 1, taken: null });
  }
  return spots;
}

// Fishing grounds out on the open water, for a boat (docs/fishing.md "From a
// boat"): deep water well clear of the shore, where the bigger fish lie and no
// one fishes from the bank. { x, z } is the ground's middle (and wx, wz the same,
// so the view's rises find it), `kind` 'fish', `boat` true.
const GROUND_DEEP  = 2.0;   // this far below the waterline
const GROUND_CLEAR = 12;    // and no land within this
const GROUND_SPACE = 40;
const MAX_GROUNDS  = 40;

export function fishingGrounds({ height, water, radius, rng = Math.random }){
  const cands = [], step = 10;
  for (let z = -radius; z <= radius; z += step) for (let x = -radius; x <= radius; x += step){
    if (Math.hypot(x, z) > radius * 0.9) continue;
    const deep = water - height(x, z);
    if (deep < GROUND_DEEP) continue;
    let clear = true;
    for (let k = 0; k < 12 && clear; k++){
      const a = k / 12 * Math.PI * 2;
      if (height(x + Math.sin(a) * GROUND_CLEAR, z + Math.cos(a) * GROUND_CLEAR) > water) clear = false;
    }
    if (clear) cands.push({ x, z, deep, r: rng() });
  }
  cands.sort((p, q) => (q.deep + q.r) - (p.deep + p.r));
  const out = [];
  for (const c of cands){
    if (out.length >= MAX_GROUNDS) break;
    if (out.some(g => Math.hypot(g.x - c.x, g.z - c.z) < GROUND_SPACE)) continue;
    out.push({ x: c.x, z: c.z, wx: c.x, wz: c.z, face: 0, kind: 'fish', boat: true, stock: 1, taken: null });
  }
  return out;
}
