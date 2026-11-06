// Where a village keeps its sheep (docs/sheep.md). Read from the land the way docs/houses.md reads a house: each pattern
// answers a force that's really there. Run once the land, buildings and trees are all placed, from its own random stream,
// so it moves nothing else. Pure: everything it asks of the world is handed in.
//
//   74 ANIMALS            common land with grass, trees and water in it, within reach of the houses
//   67 COMMON LAND        the band's, so off the houses' own ground, behind nobody's house in particular
//   4, 104                poorer, higher ground, not the good low land the crofts have
//   178, the byre's rule  downwind of the houses, and not draining onto the well
//   127 INTIMACY GRADIENT road, green, houses, crofts, then fold, then open pasture
//   105, 106              the gap faces the sun, and the hurdles and the hut make a room
//   62 HIGH PLACES        a rise on the pasture, for sitting on
//
//   78, 79                a hut for the one who keeps them, on the north side, its door on the far side from the hurdles
//
//   planCommon(place, { height, open, solid(x,z,pad), trunks(x,z,r), soil(x,z), waterAt(x,z), road(x,z), built(x,z), fields, rng })
//     built: is this a lane, a yard, a green, or their margins (land.js builtBand)? Nothing here goes on any of those.
//     open: could sheep graze here? stand: could a fold stand here? Not the same: thin woodland is poor grazing, but a fold
//     needs only firm grass and no actual trunks, which `trunks` asks. Near a village, `open` alone rules out almost everything.
//     → { fold: { x, z, a, hl, hw, open }, hut: a building for house-view, home: { x, z }, watch: { x, z }, why } or null
import { UNITS_PER_M as M } from '../config.js';

export const FOLD = { HL: 6.5, HW: 5, GAP: 1.5 };
// the hut: about 2.4 m by 3.2, set back far enough from the north hurdles for a sheep to pass between
const HUT = { HL: 1.6 * M, HW: 1.2 * M, BACK: FOLD.HW + 4.5 };
export const HUT_E = 1.85;   // wall plate, in metres
const CLEAR = 3;      // beyond the margin land.js already marks round a lane or a yard

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

export function planCommon(place, { height, open, stand = open, solid, trunks, soil, waterAt, road, built, fields, rng }){
  // it mustn't stand on anybody's croft or house. What counts as near is the nearest house, not a ring round the
  // place: a village strung along a road has houses far off one way and none at all the other
  const spots = [...place.buildings, ...fields];
  const wellAt = place.well || place, wellH = height(wellAt.x, wellAt.z), homeH = height(place.x, place.z);
  const R = Math.hypot(FOLD.HL, FOLD.HW);
  let best = null, bs = -Infinity, why = null;
  const miss = place.commonMiss = { ground: 0, slope: 0, trees: 0, road: 0, built: 0, hut: 0, houses: 0, fine: 0 };

  // fine, because near a village the clear ground comes in narrow pieces, and a lane is often the widest of them
  for (let ring = 0; ring < 24; ring++) for (let k = 0; k < 48; k++){
    const a = (k + (ring % 2) * 0.5) / 48 * Math.PI * 2, r = 26 + ring * 6;
    const x = place.x + Math.cos(a) * r, z = place.z + Math.sin(a) * r;

    // 106: a real room needs clear, level ground to stand on. All or nothing
    let ok = stand(x, z), lo = Infinity, hi = -Infinity;
    for (let q = 0; ok && q < 8; q++){
      const px = x + Math.cos(q * 0.785) * R, pz = z + Math.sin(q * 0.785) * R, h = height(px, pz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (!stand(px, pz) || solid(px, pz, 3)) ok = false;
    }
    if (!ok){ miss.ground++; continue; }
    if (hi - lo > 2.5){ miss.slope++; continue; }
    if (road(x, z) < 12){ miss.road++; continue; }
    // 105: the gap (the fold's +v side, which is +z at a = 0) faces south, turned a little so it isn't drawn with a ruler
    const fa = (rng() - 0.5) * 0.5;
    if (onBuilt(x, z, fa, built)){ miss.built++; continue; }
    // a tree stops it. Scrub is cleared: they'd do that much for their sheep
    const scrub = [];
    if (!clearOfTrees(x, z, fa, FOLD.HL + 1, FOLD.HW + 1, trunks, scrub)){ miss.trees++; continue; }
    const hut = hutSite(x, z, fa, { height, stand, solid, trunks }, scrub);
    if (!hut){ miss.hut++; continue; }
    // 127: outside what's the houses' own
    if (spots.some(b => Math.hypot(b.x - x, b.z - z) < R + 10)){ miss.houses++; continue; }
    miss.fine++;

    const h = height(x, z);
    const downwind = 0.5 + 0.5 * Math.cos(a);                                  // the east side: the weather comes from the west
    const higher = clamp01((h - homeH) / 6);                                   // 4, 104
    const poor = 1 - soil(x, z);                                               // 104
    const dw = Math.hypot(x - wellAt.x, z - wellAt.z);
    const drains = clamp01((h - wellH) / 6) * clamp01(1 - dw / 90);            // the byre's rule: nothing draining on the well
    // 74: what's beyond it, looking outward from the houses
    let room = 0, trees = 0, wet = Infinity;
    for (let q = 0; q < 12; q++){
      const b = a + (q - 5.5) * 0.28;
      for (const d of [25, 45, 65]) if (open(x + Math.cos(b) * d, z + Math.sin(b) * d)) room++;
    }
    for (let q = 0; q < 12; q++){
      const b = q * 0.5236;
      for (const d of [40, 80, 120, 160]) if (d < wet && waterAt(x + Math.cos(b) * d, z + Math.sin(b) * d)) wet = d;
    }
    trees = trunks(x, z, 32).length;
    const pasture = room / 36, water = wet === Infinity ? 0 : 1 - wet / 200, shade = clamp01(trees / 6);
    const fromHouse = Math.min(...place.buildings.map(b => Math.hypot(b.x - x, b.z - z)));
    const near = 1 - clamp01((fromHouse - 25) / 60);                           // a walk, not a journey
    // 74 again: a fold with nothing to graze beyond it is no use however handy, and it isn't kept under a window
    const thin = Math.max(0, 0.5 - pasture), under = clamp01((30 - fromHouse) / 12);
    const s = -3 * thin - 2 * under + 1.2 * downwind + 0.7 * higher + 0.6 * poor - 1.4 * drains + 1.6 * pasture + 0.7 * water + 0.4 * shade + 1.2 * near + 0.1 * rng();
    if (s > bs){ bs = s; best = { x, z, a, r, fa, hut, scrub }; why = { downwind, higher, poor, drains, pasture, water, shade, ring }; }
  }
  if (!best) return null;

  const { x, z, a: out, fa: a, hut, scrub } = best, fold = { x, z, a, hl: FOLD.HL, hw: FOLD.HW, gap: FOLD.GAP, open: true };
  dressHut(hut, place.lang, rng);
  // the pasture proper lies beyond the fold from the houses. The rise is the highest open ground on it
  let home = null, hb = -1, watch = null, wh = -Infinity;
  for (let i = 0; i < 40; i++){
    const b = out + (rng() - 0.5) * 2.4, d = 26 + rng() * 46, px = x + Math.cos(b) * d, pz = z + Math.sin(b) * d;
    if (!open(px, pz)) continue;
    let n = 0; for (let q = 0; q < 8; q++) if (open(px + Math.cos(q * 0.785) * 14, pz + Math.sin(q * 0.785) * 14)) n++;
    if (n - d * 0.02 > hb){ hb = n - d * 0.02; home = { x: px, z: pz }; }
    const ph = height(px, pz);
    if (ph > wh){ wh = ph; watch = { x: px, z: pz }; }
  }
  if (!home) return null;
  return { fold, hut, home, watch, scrub, why };
}

// Scrub is whatever can be felled (it has chop(), flora.js), and goes on `scrub`. Not by thickness: a birch is thin, and stays.
// nothing with a trunk in this rectangle, padded by the trunk's own width
function clearOfTrees(x, z, a, hl, hw, trunks, scrub){
  const c = Math.cos(a), s = Math.sin(a);
  for (const o of trunks(x, z, Math.hypot(hl, hw))){
    if (o.alive === false) continue;
    const dx = o.x - x, dz = o.z - z, u = Math.abs(dx * c + dz * s), v = Math.abs(dz * c - dx * s);
    if (u >= hl + o.r || v >= hw + o.r) continue;
    if (!o.chop) return false;
    scrub.push(o);
  }
  return true;
}

// does the fold, its hut or the margin round them touch built ground? A grid fine enough not to step over a lane
function onBuilt(x, z, a, built){
  const c = Math.cos(a), s = Math.sin(a), U = FOLD.HL + CLEAR, V0 = -(HUT.BACK + HUT.HW + CLEAR), V1 = FOLD.HW + CLEAR;
  for (let u = -U; u <= U; u += 2.5) for (let v = V0; v <= V1; v += 2.5)
    if (built(x + c * u - s * v, z + s * u + c * v)) return true;
  return false;
}
// 78, 79: north of the fold, closing that side. Its door is on the side away from the hurdles (door -1)
function hutSite(x, z, a, { height, stand, solid, trunks }, scrub){
  const c = Math.cos(a), s = Math.sin(a);
  const hx = x + s * HUT.BACK, hz = z - c * HUT.BACK;
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]){
    const px = hx + c * u * HUT.HL - s * v * HUT.HW, pz = hz + s * u * HUT.HL + c * v * HUT.HW, y = height(px, pz);
    if (!stand(px, pz) || solid(px, pz, 1.5)) return null;
    lo = Math.min(lo, y); hi = Math.max(hi, y); sum += y;
  }
  if (hi - lo > 0.8 || !clearOfTrees(hx, hz, a, HUT.HL + 1, HUT.HW + 1, trunks, scrub)) return null;
  return { kind: 'hut', x: hx, z: hz, a, hl: HUT.HL, hw: HUT.HW, door: -1, y: sum / 9, tint: 0, dwelling: false };
}
// what house-view needs to draw it. In the place's own walling, but always thatched: one person's work, with what's to hand
function dressHut(b, lang, r){
  b.tint = r();
  b.form = {
    wall: lang?.wall === 'logs' ? 'logs' : 'boards', roof: 'thatch', age: 0.2 + r() * 0.6, parts: {}, studs: 1.5 * M,
    E: HUT_E, pitch: 52, sag: (0.03 + r() * 0.05) * M, rearOd: 0, frontOd: 0, Eo: 1.3,
    ends: ['gable', 'gable'], lines: [-b.hl, b.hl], bays: [], du: 0, ridge: 'plain', staddles: false,
    // the houses' own doorway, so the thatch lifts over it (house-view). It has to fit under the wall plate, lintel and all
    door: { w: 0.85 * M, h: 1.45 * M }, paint: [0.3, 0.25, 0.18],
  };
}
