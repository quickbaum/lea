// The land: heightfield + habitats. Pure (no three.js), so node tools can map it.
//
// Everything is seeded noise (no sine waves, so nothing repeats) layered at
// three scales:
//   REGIONS  (~500u)  — basin vs. upland, wet vs. dry, sandy outwash vs. loam
//   LANDFORM (~150u)  — hills, hollows, the sandy ridges (eskers) of the outwash
//   DETAIL   (~30u)   — the ground's grain
// Height near the waterline is flattened, so low ground spreads into broad flat
// wetland instead of meeting the lakes at a steady slope.
//
// A habitat is decided by height above the water plus the region fields — the
// realistic mosaic you find around northern wetlands (think Biebrza):
//   lake → marsh (reeds at the open water) → fen (peat moss further back)
//   → wet meadow / alder carr (wet woodland) → meadow / woodland on loam,
//   heath (heather and pine) on the sandy ridges, beach where sand meets water,
//   bare rock on steep or rough high ground — and, rarely, an old-growth grove
//   of giant conifers (the redwoods) on moist upland loam.
// Each habitat names the SURFACE the rest of the game understands
// ('water' | 'sand' | 'mud' | 'grass' | 'rock'), so existing code keeps working
// while new code can ask for the habitat itself.
//
// Fields are sampled once onto grids (height at 2u, the rest at 8u) the first
// time anything asks, so height() stays as cheap as it was.

import { SIZE, WATER, WORLD_SEED, WORLD, WORLD_R } from '../config.js';
import { mulberry32 } from '../rng.js';
import { planRoad, gradeWeight, ROAD_W, VERGE, BANK, CROWN } from './road.js';
import { planSettlements, inBuilding, LANE_W, POST_R } from './settle.js';
import { dressSettlements } from './house.js';
import { planRuins, standing } from './ruins.js';
import { planUnder, mouthShape, halfWidth, mouthFloor } from './under.js';
import { arcadeField } from './arcade.js';
import { planRivers } from './river.js';

// ---- seeded 2D simplex noise (after Gustavson) ------------------------------
function makeSimplex(seed){
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--){ const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GZ = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (x, z) => {             // -1..1
    const s = (x + z) * F2, i = Math.floor(x + s), j = Math.floor(z + s);
    const t = (i + j) * G2, x0 = x - (i - t), z0 = z - (j - t);
    const i1 = x0 > z0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, z1 = z0 - j1 + G2, x2 = x0 - 1 + 2 * G2, z2 = z0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, a;
    if ((a = 0.5 - x0 * x0 - z0 * z0) > 0){ const g = perm[ii + perm[jj]] & 7; a *= a; n += a * a * (GX[g] * x0 + GZ[g] * z0); }
    if ((a = 0.5 - x1 * x1 - z1 * z1) > 0){ const g = perm[ii + i1 + perm[jj + j1]] & 7; a *= a; n += a * a * (GX[g] * x1 + GZ[g] * z1); }
    if ((a = 0.5 - x2 * x2 - z2 * z2) > 0){ const g = perm[ii + 1 + perm[jj + 1]] & 7; a *= a; n += a * a * (GX[g] * x2 + GZ[g] * z2); }
    return 70 * n;
  };
}

// one independent noise per field, all from the world seed
const seeds = mulberry32((WORLD_SEED ^ 0x1a2d) >>> 0);
const N = {};
for (const k of ['macro', 'mid', 'detail', 'ridge', 'sand', 'wet', 'wood', 'rough', 'peat', 'grove', 'high', 'shore'])
  N[k] = makeSimplex((seeds() * 2 ** 32) >>> 0);

// fractal sum, normalised to about -1..1
function fbm(n, x, z, scale, oct){
  let f = 1 / scale, a = 1, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++){ sum += a * n(x * f, z * f); norm += a; f *= 2.03; a *= 0.5; }
  return sum / norm;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---- region fields (0..1, slow) ----------------------------------------------
// sandy outwash: where the eskers run and heath grows; also sandier shores
function rawSand(x, z){ return smooth(0.05, 0.45, fbm(N.sand, x, z, 520, 2)); }
// groundwater: how far above the water the ground stays waterlogged
function rawWet(x, z){ return clamp01(0.5 + 0.75 * fbm(N.wet, x, z, 380, 3)); }
// woodland vs. open ground on the dry land
function rawWood(x, z){ return clamp01(0.5 + 0.9 * fbm(N.wood, x, z, 160, 3)); }
// rugged upland: rock and steeper hills
function rawRough(x, z){ return smooth(0.25, 0.6, fbm(N.rough, x, z, 600, 2)); }
// fen vs. wet meadow among the waterlogged ground
function rawPeat(x, z){ return clamp01(0.5 + 0.9 * fbm(N.peat, x, z, 120, 2)); }
// old-growth: the few stands nobody ever cleared, where the giant conifers live
function rawGrove(x, z){ return clamp01(0.5 + 0.9 * fbm(N.grove, x, z, 140, 2)); }

// highlands: a rare, very broad region that rises into real hills
function rawHigh(x, z){ return smooth(0.22, 0.65, fbm(N.high, x, z, 1100, 2)); }

// ---- the great lake -------------------------------------------------------------
// One deliberate feature rather than noise: a lake ~560u across with a ragged
// shoreline and a wooded island, placed by the seed somewhere out from home.
const LK = (() => {
  const r = mulberry32((WORLD_SEED ^ 0x1a4e) >>> 0);
  const a = r() * Math.PI * 2, d = SIZE * 0.47 * (0.4 + r() * 0.12);
  const R = SIZE * 0.0875;                      // 280u in the 3200u world; scales with it
  const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
  const ia = r() * Math.PI * 2;                 // the island sits off-centre
  return { cx, cz, R, ix: cx + Math.cos(ia) * R * 0.3, iz: cz + Math.sin(ia) * R * 0.3, IR: R * 0.29 };
})();
export const GREAT_LAKE = LK;   // for tools/debug: { cx, cz, R, ix, iz, IR }
// 0 outside the lake .. 1 in open water; the outline wobbles with angle
function lakeK(x, z){
  const dx = x - LK.cx, dz = z - LK.cz, d = Math.hypot(dx, dz);
  if (d > LK.R * 1.5) return 0;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.22 * N.shore(Math.cos(a) * 1.6, Math.sin(a) * 1.6) + 0.08 * N.shore(Math.cos(a) * 5 + 9, Math.sin(a) * 5);
  return smooth(1.0, 0.72, d / (LK.R * wob));
}
// island height above the water (≤ 0 off the island)
function islandH(x, z){
  const dx = x - LK.ix, dz = z - LK.iz, d = Math.hypot(dx, dz);
  if (d > LK.IR * 1.6) return -1;
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.2 * N.shore(Math.cos(a) * 1.2 + 40, Math.sin(a) * 1.2 - 40);
  const q = d / (LK.IR * wob);
  return q >= 1 ? -1 : 5.5 * Math.pow(1 - q * q, 0.6) + 0.4 * fbm(N.detail, x, z, 18, 2);
}

// ---- height -------------------------------------------------------------------
// The player starts near the origin: keep a dry rise there so the first view is
// land, not lake (a soft bump, invisible as such).
const HOME_R = 70;

function rawHeight(x, z){
  const macro  = fbm(N.macro,  x, z, 520, 3) * 7.5;     // basins and uplands
  const mid    = fbm(N.mid,    x, z, 150, 3) * 2.0;     // hollows and knolls
  const detail = fbm(N.detail, x, z, 28,  2) * 0.45;    // grain
  // eskers: long winding ridges of sand, only in the outwash
  const r = 1 - Math.abs(N.ridge(x / 190, z / 190));
  const esker = r * r * r * r * 4.2 * rawSand(x, z);
  // rugged upland: extra relief where the rough field is up
  const rough = rawRough(x, z);
  const hills = rough * (Math.abs(fbm(N.rough, x + 913, z - 377, 55, 3)) * 7 + 1.5);
  // highlands: a broad lift plus big ridged hills (up to ~45u)
  const lake = lakeK(x, z);
  // start-screen "hills" (0 flat .. 1 hilly .. 2 mountainous) scales them
  const hi = rawHigh(x, z) * (1 - smooth(0, 0.01, lake)) * WORLD.hills;   // never inside the lake
  let highland = 0;
  if (hi > 0){
    const rr = 1 - Math.abs(fbm(N.high, x + 501, z - 233, 170, 3));
    highland = hi * (6 + rr * rr * 30 + fbm(N.mid, x - 77, z + 51, 60, 2) * 3);
  }
  // start-screen "water" (0 dry .. 1 normal .. 2 wet) lifts or sinks the land
  // against the fixed water plane
  let h = 0.2 + (1 - WORLD.water) * 1.4 + macro + mid + detail + esker + hills + highland;
  // the great lake: shelve the land down to a deep bed, then raise the island
  if (lake > 0) h = h * (1 - lake) + (WATER - 7) * lake;
  const isl = islandH(x, z);
  if (isl > 0) h = Math.max(h, WATER + isl);
  // flatten near the waterline: slope shrinks to ~a third right at the water
  // and is back to full a few units away, so low ground spreads into flats
  const t = h - WATER;
  h = WATER + t * (0.32 + 0.68 * smooth(0, 3.2, Math.abs(t)));
  // home rise
  const d = Math.hypot(x, z);
  if (d < HOME_R){ const k = smooth(HOME_R, HOME_R * 0.4, d); h = Math.max(h, h + (WATER + 1.6 - h) * k); }
  return h;
}

// ---- grids --------------------------------------------------------------------
const HSTEP = 2, FSTEP = 8, PAD = 40;           // grid spacing (u) and margin past the world
const HALF = SIZE / 2 + PAD;
let H = null, HN = 0;                           // height grid
let F = null, FN = 0;                           // region fields: sand, wet, wood, rough, peat, grove
const NF = 6;
let ROAD = null, RB = null;                     // the Old Road (road.js), and its band per height cell
let SETTLE = null, SB = null;                   // settlements and their lanes (settle.js), and their band per height cell
let RUINS = null;                               // the old stone ruins (ruins.js)
let UNDER = null;                               // the caves' and crypts' mouths (under.js)
let RIVERS = null;                              // the rivers (river.js): { reaches }
let RV = null;                                  // per height cell: 1 the channel, 2 a bar on a bend's inside, 3 the floodplain
let HG = null;                                  // the ground itself, under the bridges (the mesh draws this; height() is the deck)
let BRIDGES = [];                               // [{ kind: 'stone'|'timber'|'foot', ax, az, bx, bz, len, hw, deck(u) }]
const DECK = new Map();                         // height cell -> deck height, laid over the ground at the end of build()
const WOOD = new Set();                         // height cells under a timber deck (habitat 'bridge')
const PAVED = new Set();                        // and under the Old Road's stone deck (band 2, the road)

function build(){
  HN = Math.round(2 * HALF / HSTEP) + 1;
  H = new Float32Array(HN * HN);
  for (let r = 0; r < HN; r++) for (let c = 0; c < HN; c++)
    H[r * HN + c] = rawHeight(c * HSTEP - HALF, r * HSTEP - HALF);
  FN = Math.round(2 * HALF / FSTEP) + 1;
  F = new Float32Array(FN * FN * NF);
  for (let r = 0; r < FN; r++) for (let c = 0; c < FN; c++){
    const x = c * FSTEP - HALF, z = r * FSTEP - HALF, o = (r * FN + c) * NF;
    F[o] = rawSand(x, z); F[o + 1] = rawWet(x, z); F[o + 2] = rawWood(x, z);
    F[o + 3] = rawRough(x, z); F[o + 4] = rawPeat(x, z); F[o + 5] = rawGrove(x, z);
  }
  RIVERS = planRivers({ size: SIZE, seed: (WORLD_SEED ^ 0x7e7) >>> 0, height, water: WATER });
  carveRivers();
  ROAD = planRoad({ size: SIZE, seed: (WORLD_SEED ^ 0x70ad) >>> 0, height, water: WATER, fields, river: riverNear });
  ROAD.spans = bridgeSpans(ROAD, 'stone', ROAD_W + 0.3, 16);
  gradeRoad();
  SETTLE = planSettlements({ size: SIZE, seed: (WORLD_SEED ^ 0x5e771e) >>> 0, height, habitat, water: WATER, road: ROAD, worldR: WORLD_R, roadW: ROAD_W, river: riverNear });
  dressSettlements(SETTLE, { height, habitat, seed: WORLD_SEED });   // before grading: a house reads the slope it was built on
  for (const L of SETTLE.lanes) L.spans = bridgeSpans(L, 'timber', LANE_DECK, 8);
  gradeSettlements();
  RUINS = planRuins({ size: SIZE, seed: (WORLD_SEED ^ 0x7a1d5) >>> 0, height, habitat, water: WATER, road: ROAD, settle: SETTLE, worldR: WORLD_R });
  placeRuins();
  UNDER = planUnder({ size: SIZE, seed: (WORLD_SEED ^ 0x0ca5e) >>> 0, height, habitat, water: WATER, road: ROAD, settle: SETTLE, ruins: RUINS, worldR: WORLD_R, solidAt: builtAt });
  cutMouths();
  // no tree grows in a cave's mouth or on the crypt stair, nor where you stand before it
  for (const e of UNDER.entrances) for (const [x, z, R] of [[e.x, e.z, 5.5], [e.stand[0], e.stand[1], 3]]){
    const c0 = Math.max(0, Math.floor((x - R + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((x + R + HALF) / HSTEP));
    const r0 = Math.max(0, Math.floor((z - R + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((z + R + HALF) / HSTEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
      if (!SB[r * HN + c] && Math.hypot(c * HSTEP - HALF - x, r * HSTEP - HALF - z) < R) SB[r * HN + c] = 1;
  }
  planFootbridges();
  layDecks();
}

// ---- the rivers ------------------------------------------------------------------
// The channel is cut to just under the water plane and shelves to a deeper middle;
// beyond it the bank. A lowland river's banks are not the same both sides: on
// the inside of a bend it drops its gravel and sand as a bar, low and nearly flat,
// with a broad floodplain behind; on the outside it cuts into the land, a steep
// bank with little or no flat. The floodplain rises gently (wet meadow, sedge,
// alder and willow — the habitats' own bands by height above the water) and then
// the valley side climbs to meet the land. Only ever lowered: where the land is
// already low, it stays as it is.
const LANE_DECK = 2.2;      // half-width of a lane's timber bridge
const FOOT_DECK = 1.6;      // and of a footbridge
function bankAt(d, w, inside, bend){
  if (d < w) return [WATER - 0.25 - (0.5 + 0.2 * w) * (1 - (d / w) ** 2), 1];
  let e = d - w;
  const bar = inside ? (1.5 + 0.9 * w) * bend : 0;
  if (e < bar) return [WATER + 0.05 + e * 0.03, 2];
  e -= bar;
  const y0 = WATER + 0.17 + bar * 0.03;
  const fw = (6 + 1.2 * w) * (inside ? 1 + 0.6 * bend : 1 - 0.75 * bend);
  if (e < fw) return [y0 + e * 0.1, 3];
  return [y0 + fw * 0.1 + (e - fw) * (inside ? 0.25 : 0.3 + 0.5 * bend), 0];
}
function carveRivers(){
  RV = new Uint8Array(HN * HN);
  const T = new Float32Array(HN * HN).fill(Infinity), TB = new Uint8Array(HN * HN);
  for (const R of RIVERS.reaches){
    const { xs, zs, ws, ks } = R;
    for (let q = 0; q + 1 < xs.length; q++){
      const ax = xs[q], az = zs[q], len = Math.hypot(xs[q + 1] - ax, zs[q + 1] - az);
      if (len < 1e-6) continue;
      const dx = (xs[q + 1] - ax) / len, dz = (zs[q + 1] - az) / len;
      const reach = Math.max(ws[q], ws[q + 1]) + 40;
      const c0 = Math.max(0, Math.floor((Math.min(ax, xs[q + 1]) - reach + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((Math.max(ax, xs[q + 1]) + reach + HALF) / HSTEP));
      const r0 = Math.max(0, Math.floor((Math.min(az, zs[q + 1]) - reach + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((Math.max(az, zs[q + 1]) + reach + HALF) / HSTEP));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
        const x = c * HSTEP - HALF, z = r * HSTEP - HALF;
        const t = Math.max(0, Math.min(len, (x - ax) * dx + (z - az) * dz)), f = t / len;
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d > reach) continue;
        const w = ws[q] + (ws[q + 1] - ws[q]) * f, k = ks[q] + (ks[q + 1] - ks[q]) * f;
        const side = dx * (z - az) - dz * (x - ax);            // + on the side the river turns toward
        const [y, band] = bankAt(d, w, side * k > 0, Math.min(1, Math.abs(k) * 30));
        const i = r * HN + c;
        if (y < T[i]){ T[i] = y; TB[i] = band; }
      }
    }
  }
  for (let i = 0; i < T.length; i++){
    if (T[i] === Infinity) continue;
    const was = H[i];
    if (T[i] < was) H[i] = T[i];
    // the channel only where it cuts the land (a lake stays a lake); the rest where the bank shaped the ground
    if (TB[i] === 1 ? was > WATER - 0.1 : T[i] <= was + 0.3) RV[i] = TB[i];
  }
}
const rvAt = (x, z) => {
  if (!RV) return 0;
  const c = Math.round((x + HALF) / HSTEP), r = Math.round((z + HALF) / HSTEP);
  return c < 0 || r < 0 || c >= HN || r >= HN ? 0 : RV[r * HN + c];
};
// is a river's channel within a few units? (the planners' grids are 8u, coarser than a brook)
function riverNear(x, z){
  for (const [ox, oz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) if (rvAt(x + ox, z + oz) === 1) return true;
  return false;
}

// Where a road or lane crosses a river: walk its centre line for the water, out to
// dry bank either side, and that is the bridge. Its deck stands level at the
// higher bank or high enough over the water, whichever is more (a stone arch
// wants headroom for its arches, a timber bridge less), and the way rises to it
// over `ramp` units either side, on a built-up approach.
function bridgeSpans(line, kind, hw, ramp){
  const { xs, zs, prof } = line, n = xs.length, step = 2;      // both the road and the lanes sample their centre line every 2u
  const wet = k => height(xs[k], zs[k]) < WATER + 0.3 || rvAt(xs[k], zs[k]) === 1;
  const spans = [];
  for (let k = 0; k < n; k++){
    if (!wet(k)) continue;
    let e = k, channel = false;
    for (let gap = 0; e + 1 < n && gap <= 3; ){ e++; if (wet(e)) gap = 0; else gap++; }
    while (e > k && !wet(e)) e--;
    for (let j = k; j <= e; j++) if (rvAt(xs[j], zs[j]) === 1) channel = true;
    if (!channel){ k = e; continue; }
    let a = k, b = e;
    for (let t = 0; t < 6 && a > 0 && height(xs[a], zs[a]) < WATER + 0.7; t++) a--;
    for (let t = 0; t < 6 && b < n - 1 && height(xs[b], zs[b]) < WATER + 0.7; t++) b++;
    if (a === 0 || b === n - 1){ k = e; continue; }        // the line's end is in the water: leave it be
    const len = (b - a) * step;
    const clear = kind === 'stone' ? 1.6 + Math.min(2.4, len * 0.08) : 1.3;
    const top = Math.max(prof[a], prof[b], WATER + clear);
    // the approach rises at 1 in 12 at most (ramp is the least it runs)
    const rise = Math.max(0, top - Math.min(prof[a], prof[b]));
    const rk = Math.round(Math.max(ramp, rise * 12) / step), orig = Float32Array.from(prof);
    for (let j = a; j <= b; j++) prof[j] = top + (kind === 'stone' ? 0.3 * Math.sin(Math.PI * (j - a) / (b - a)) : 0);
    for (let j = 1; j <= rk; j++){
      const f = 1 - j / (rk + 1), w = f * f * (3 - 2 * f);
      if (a - j >= 0) prof[a - j] = Math.max(orig[a - j], orig[a - j] + (top - orig[a - j]) * w);
      if (b + j < n) prof[b + j] = Math.max(orig[b + j], orig[b + j] + (top - orig[b + j]) * w);
    }
    spans.push({ kind, s0: a * step, s1: b * step, hw, top });
    const br = { kind, ax: xs[a], az: zs[a], bx: xs[b], bz: zs[b], len: Math.hypot(xs[b] - xs[a], zs[b] - zs[a]), hw,
      deck: u => line.heightAt(a * step + (b - a) * step * Math.max(0, Math.min(1, u / Math.max(1e-6, br.len)))) };
    BRIDGES.push(br);
    stampDeck(br);                                   // the bridge runs straight bank to bank, whatever the way's curve
    k = b;
  }
  return spans;
}
const inSpan = (spans, s) => { if (spans) for (const p of spans) if (s > p.s0 && s < p.s1) return p; return null; };

// Footbridges: where the walk round is long. At points along each river, how far
// would you walk to reach the bank opposite (round its spring, or the lake it runs
// from, or over a bridge already there)? Where that is far, a plank bridge goes
// over at the narrowest place near by, between dry banks — the way the folk would
// have put one where they kept wanting to cross. Walked on a coarse 4u grid,
// four-ways so a diagonal brook still blocks it.
const ROUND = 480;            // a walk round longer than this wants a bridge
const WG = 4;
function planFootbridges(){
  const n = Math.round(SIZE / WG) + 1, half = SIZE / 2, X = c => c * WG - half;
  const open = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
    const x = X(i), z = X(j);
    open[j * n + i] = height(x, z) > WATER + 0.25 && Math.hypot(x, z) < WORLD_R && !builtAt(x, z, 0) ? 1 : 0;
  }
  const openDeck = b => {
    const dx = (b.bx - b.ax) / b.len, dz = (b.bz - b.az) / b.len;
    for (let u = -2; u <= b.len + 2; u += 1){
      const i = Math.round((b.ax + dx * u + half) / WG), j = Math.round((b.az + dz * u + half) / WG);
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (i + di < n && j + dj < n) open[(j + dj) * n + i + di] = 1;
    }
  };
  for (const b of BRIDGES) openDeck(b);
  const dist = new Int32Array(n * n), stamp = new Int32Array(n * n), queue = new Int32Array(n * n);
  let gen = 0;
  const walkRound = (ax, az, bx, bz) => {             // grid steps from a to b, or Infinity past the limit
    gen++;
    const a = Math.round((az + half) / WG) * n + Math.round((ax + half) / WG), b = Math.round((bz + half) / WG) * n + Math.round((bx + half) / WG);
    if (!open[a] || !open[b]) return Infinity;
    const lim = Math.ceil(ROUND * 1.2 / WG);
    let h = 0, t = 0; queue[t++] = a; stamp[a] = gen; dist[a] = 0;
    while (h < t){
      const k = queue[h++];
      if (k === b) return dist[k] * WG;
      if (dist[k] >= lim) continue;
      const i = k % n;
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]){
        if (m < 0 || m >= n * n || stamp[m] === gen || !open[m]) continue;
        stamp[m] = gen; dist[m] = dist[k] + 1; queue[t++] = m;
      }
    }
    return Infinity;
  };
  const reaches = [...RIVERS.reaches].sort((p, q) => q.length - p.length);
  for (const R of reaches){
    if (R.length < 60) continue;
    for (let s = 30; s < R.length - 30; s += 50){
      const q = Math.round(s / 3);
      if (q < 1 || q >= R.xs.length - 1) continue;
      const here = footAt(R, q);
      if (!here) continue;
      if (walkRound(here.ax, here.az, here.bx, here.bz) <= ROUND) continue;
      // wanted: the narrowest good place within 40u
      let best = here;
      for (let k = Math.max(1, q - 13); k <= Math.min(R.xs.length - 2, q + 13); k++){
        const c = footAt(R, k);
        if (c && c.score < best.score) best = c;
      }
      openDeck(addFootbridge(best));
    }
  }
}
function footAt(R, q){
  const { xs, zs, ws } = R;
  const dx = xs[q + 1] - xs[q - 1], dz = zs[q + 1] - zs[q - 1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
  // each end out over the low bank to where the ground is dry underfoot, 14u past the channel at most
  const reach = s => {
    for (let e = ws[q] + 1.5; e <= ws[q] + 14; e += 1){
      const x = xs[q] + nx * s * e, z = zs[q] + nz * s * e;
      if (height(x, z) >= WATER + 0.5) return e;
    }
    return null;
  };
  const ea = reach(-1), eb = reach(1);
  if (ea === null || eb === null) return null;
  const ax = xs[q] - nx * ea, az = zs[q] - nz * ea, bx = xs[q] + nx * eb, bz = zs[q] + nz * eb;
  for (const [x, z] of [[ax, az], [bx, bz]]){
    if (height(x, z) > WATER + 3.5 || Math.hypot(x, z) > WORLD_R - 30) return null;
    if (builtBand(x, z) || roadBand(x, z) || builtAt(x, z, 3)) return null;
  }
  // the banks beyond the ends are land you can walk on (not a reedy spit into a lake)
  if (height(ax - nx * 4, az - nz * 4) < WATER + 0.3 || height(bx + nx * 4, bz + nz * 4) < WATER + 0.3) return null;
  if (BRIDGES.some(b => Math.hypot((b.ax + b.bx) / 2 - xs[q], (b.az + b.bz) / 2 - zs[q]) < 90)) return null;
  return { ax, az, bx, bz, score: ea + eb + Math.abs(height(ax, az) - height(bx, bz)) };
}
function addFootbridge({ ax, az, bx, bz }){
  const len = Math.hypot(bx - ax, bz - az), eA = height(ax, az), eB = height(bx, bz);
  const hump = Math.max(0.3, WATER + 1.0 - Math.min(eA, eB));
  const deck = u => { const t = Math.max(0, Math.min(1, u / len)); return eA + (eB - eA) * t + hump * Math.sin(Math.PI * t); };
  const b = { kind: 'foot', ax, az, bx, bz, len, hw: FOOT_DECK, deck };
  BRIDGES.push(b);
  stampDeck(b);
  return b;
}
// a straight deck into DECK, over its whole footprint
function stampDeck(b){
  const dx = (b.bx - b.ax) / b.len, dz = (b.bz - b.az) / b.len;
  const c0 = Math.max(0, Math.floor((Math.min(b.ax, b.bx) - b.hw - 2 + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((Math.max(b.ax, b.bx) + b.hw + 2 + HALF) / HSTEP));
  const r0 = Math.max(0, Math.floor((Math.min(b.az, b.bz) - b.hw - 2 + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((Math.max(b.az, b.bz) + b.hw + 2 + HALF) / HSTEP));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
    const x = c * HSTEP - HALF, z = r * HSTEP - HALF, u = (x - b.ax) * dx + (z - b.az) * dz, v = -(x - b.ax) * dz + (z - b.az) * dx;
    if (u < -0.5 || u > b.len + 0.5 || Math.abs(v) > b.hw + 0.6) continue;
    const i = r * HN + c;
    DECK.set(i, Math.max(DECK.get(i) ?? -Infinity, b.deck(u)));
    if (b.kind !== 'stone') WOOD.add(i);
    else if (Math.abs(v) <= ROAD_W + 0.8) PAVED.add(i);               // the paving, wherever the straight deck runs past the road's curve
  }
}
// Lay the decks over the ground: height() is the deck, so whoever crosses stands
// on it; HG keeps the ground under it for the mesh, so the river still runs
// beneath. Each bridge's sides are solid (a parapet, a handrail), thin, so the
// folk's routes still fit between them.
function layDecks(){
  HG = Float32Array.from(H);
  for (const [i, y] of DECK) H[i] = Math.max(H[i], y);
  for (const i of WOOD) if (SB) SB[i] = 6;
  for (const i of PAVED) RB[i] = 2;
  for (const b of BRIDGES){
    const dx = (b.bx - b.ax) / b.len, dz = (b.bz - b.az) / b.len, a = Math.atan2(dz, dx);
    const mx = (b.ax + b.bx) / 2, mz = (b.az + b.bz) / 2;
    for (const s of [-1, 1]){
      const o = { x: mx - dz * s * (b.hw + 0.1), z: mz + dx * s * (b.hw + 0.1), a, hl: b.len / 2 + 0.3, hw: 0.12, thin: true };
      addSolid(o, o.hl + 1);
    }
  }
}

// The cave mouths (under.js mouthShape): the hill cut away behind each opening, down to just
// under the passage's floor and as far in as the hill is lower than the opening's top, so no
// grass shows through the dark (the passage is drawn in the cut, under-view.js caveMouth);
// the stone solid where it stands, the passage's sides and end solid too; no tree in any of it.
// Each cave entrance learns `floor` (the passage's floor) and `depth` (how far in it runs).
function cutMouths(){
  for (const e of UNDER.entrances){
    if (e.kind !== 'cave') continue;
    const M = mouthShape(e), { o, A, fx, fz, tx, tz, px, pz } = M, y0 = height(px, pz), top = o.y + o.bt;
    e.floor = y0 - 0.45;
    let depth = 8;                                       // till the hill stands over the opening's top (20 at most, 40 for the elder's: past a ridge it never will)
    while (depth < 20 * (e.scale || 1) && height(px - fx * depth, pz - fz * depth) < mouthFloor(e, depth) + top + 1.5) depth++;
    e.depth = depth;
    const W0 = halfWidth(o, 0) + 1.2, R = Math.max(A.half + 4, depth + 6);
    const c0 = Math.max(0, Math.floor((px - R + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((px + R + HALF) / HSTEP));
    const r0 = Math.max(0, Math.floor((pz - R + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((pz + R + HALF) / HSTEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
      const i = r * HN + c, x = c * HSTEP - HALF, z = r * HSTEP - HALF;
      const sa = (x - px) * tx + (z - pz) * tz, u = -((x - px) * fx + (z - pz) * fz);   // across; how far into the hill
      if (Math.abs(sa) < A.half + 3 && u > -6 && u < depth + 3 && !SB[i]) SB[i] = 1;   // no trees in the stone or the passage
      const ws = Math.abs(sa) < W0 ? 1 : Math.max(0, 1 - (Math.abs(sa) - W0) / 3), wu = u < 0 ? Math.max(0, 1 + u / 4) : u <= depth + 2 ? 1 : 0, w = ws * wu;
      const cut = mouthFloor(e, Math.max(0, u)) - 0.15;
      if (w > 0 && H[i] > cut) H[i] += (cut - H[i]) * w;
    }
    // solid: the stone at knee height, in 1u lengths along it; the passage's sides and its end
    const F = arcadeField(A), a = Math.atan2(tz, tx);
    for (let sa = -A.half - 1; sa <= A.half + 1; sa += 1){
      if (F.d(sa, 0.8) <= 0.05) continue;
      const b = { x: px + tx * sa, z: pz + tz * sa, a, hl: 0.55, hw: Math.max(0.6, F.h(sa, 0.8)) };
      addSolid(b, Math.hypot(b.hl, b.hw));
    }
    const W = halfWidth(o, 0) + 0.5;
    for (const side of [-1, 1]){
      const b = { x: px - fx * depth / 2 + tx * side * W, z: pz - fz * depth / 2 + tz * side * W, a: e.face, hl: depth / 2, hw: 0.5 };
      addSolid(b, Math.hypot(b.hl, b.hw));
    }
    const b = { x: px - fx * (depth - 0.5), z: pz - fz * (depth - 0.5), a: e.face, hl: 0.5, hw: W };
    addSolid(b, Math.hypot(b.hl, b.hw));
  }
}

// Grade the land to the road: across the paving it takes the road's height and
// camber (so height() is the top of the stones, and whoever stands there stands on them),
// over the embankment's skirt it eases back to its own. Each cell also learns
// its band — 2 paved (the shoulder just past the kerb included, so the ground's
// colour meets the stones), 1 the cleared verge, 0 off the road.
function gradeRoad(){
  const reach = ROAD_W + Math.max(VERGE, BANK + 1);
  const D = new Float32Array(HN * HN).fill(Infinity), S = new Float32Array(HN * HN);
  for (const g of ROAD.legs){
    const bx = g.ax + g.dx * g.len, bz = g.az + g.dz * g.len;
    const c0 = Math.max(0, Math.floor((Math.min(g.ax, bx) - reach + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((Math.max(g.ax, bx) + reach + HALF) / HSTEP));
    const r0 = Math.max(0, Math.floor((Math.min(g.az, bz) - reach + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((Math.max(g.az, bz) + reach + HALF) / HSTEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
      const x = c * HSTEP - HALF, z = r * HSTEP - HALF;
      const t = Math.max(0, Math.min(g.len, (x - g.ax) * g.dx + (z - g.az) * g.dz));
      const d = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t), i = r * HN + c;
      if (d < D[i]){ D[i] = d; S[i] = g.s0 + t; }
    }
  }
  RB = new Uint8Array(HN * HN);
  for (let i = 0; i < D.length; i++){
    const d = D[i];
    if (d > reach) continue;
    const w = gradeWeight(d);
    const camber = d < ROAD_W ? CROWN * (1 - (d / ROAD_W) ** 2) : 0;
    const span = inSpan(ROAD.spans, S[i]);
    if (span){                                       // over the river: the deck, and the river left to run under it
      if (d <= span.hw + 0.6) DECK.set(i, ROAD.heightAt(S[i]) + camber);
      RB[i] = d <= ROAD_W + 0.8 ? 2 : 0;
      continue;
    }
    if (w > 0) H[i] += (ROAD.heightAt(S[i]) + camber - H[i]) * w;
    RB[i] = d <= ROAD_W + 0.8 ? 2 : d <= ROAD_W + VERGE ? 1 : 0;
  }
}

// Grade the land to the settlements and mark their ground: lanes take their
// profile across their width and ease back over a few units; each building's
// pad is levelled to one height and feathered out. Bands, highest wins:
// 1 cleared (no trees or scrub), 2 the green, 3 a lane, 4 trodden yard.
function gradeSettlements(){
  SB = new Uint8Array(HN * HN);
  const visit = (x0, z0, x1, z1, fn) => {
    const c0 = Math.max(0, Math.floor((x0 + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((x1 + HALF) / HSTEP));
    const r0 = Math.max(0, Math.floor((z0 + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((z1 + HALF) / HSTEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * HN + c, c * HSTEP - HALF, r * HSTEP - HALF);
  };
  const mark = (i, b) => { if (SB[i] < b) SB[i] = b; };
  for (const p of SETTLE.places){
    const R = (p.green ? Math.max(p.green.rx, p.green.rz) : 8) + 34;
    visit(p.x - R, p.z - R, p.x + R, p.z + R, (i, x, z) => {
      if (Math.hypot(x - p.x, z - p.z) < R) mark(i, 1);
      if (p.green && inGreen(p.green, x, z)) mark(i, 2);
      if (p.yard && inBuilding({ x: p.x, z: p.z, a: p.yard.a, hl: p.yard.depth / 2, hw: p.yard.width / 2 }, x, z)) mark(i, 4);
    });
  }
  // the fields: ploughed ground, kept clear
  for (const f of SETTLE.fields){
    const R = Math.hypot(f.hl, f.hw) + 4;
    visit(f.x - R, f.z - R, f.x + R, f.z + R, (i, x, z) => {
      if (inBuilding(f, x, z)) mark(i, 5); else if (inBuilding(f, x, z, 4)) mark(i, 1);
    });
  }
  // lanes: the nearest lane to each cell, and how far along it
  const reach = LANE_W + 4, D = new Map();
  SETTLE.lanes.forEach((L, li) => {
    for (const g of L.legs){
      const bx = g.ax + g.dx * g.len, bz = g.az + g.dz * g.len;
      visit(Math.min(g.ax, bx) - reach, Math.min(g.az, bz) - reach, Math.max(g.ax, bx) + reach, Math.max(g.az, bz) + reach, (i, x, z) => {
        const t = Math.max(0, Math.min(g.len, (x - g.ax) * g.dx + (z - g.az) * g.dz));
        const d = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t);
        const o = D.get(i);
        if (d <= reach && (!o || d < o.d)) D.set(i, { d, s: g.s0 + t, li });
      });
    }
  });
  for (const [i, { d, s, li }] of D){
    if (RB[i] === 2) continue;                       // the road's paving stays as it is
    const span = inSpan(SETTLE.lanes[li].spans, s);
    if (span){                                       // a timber bridge: its deck, the river under it
      if (d <= span.hw + 0.6){ DECK.set(i, SETTLE.lanes[li].heightAt(s)); WOOD.add(i); }
      continue;
    }
    const w = d <= LANE_W + 0.5 ? 1 : smooth(LANE_W + 3, LANE_W + 0.5, d);
    if (w > 0) H[i] += (SETTLE.lanes[li].heightAt(s) - H[i]) * w;
    mark(i, d <= LANE_W + 0.3 ? 3 : 1);
  }
  // pads: level under each building and a little round it, feathered out
  const pad = (b, y) => {
    const R = Math.hypot(b.hl, b.hw) + 6;
    visit(b.x - R, b.z - R, b.x + R, b.z + R, (i, x, z) => {
      let w = 0;
      if (inBuilding(b, x, z, 1.5)) w = 1;
      else for (let e = 2; e <= 5; e++) if (inBuilding(b, x, z, 1.5 + e)){ w = 1 - e / 6; break; }
      if (w > 0) H[i] += (y - H[i]) * w;
      if (inBuilding(b, x, z, 3)) mark(i, 4);
    });
  };
  for (const b of SETTLE.buildings) pad(b, b.y);
  for (const p of SETTLE.places) if (p.well){
    const b = { x: p.well.x, z: p.well.z, a: 0, hl: p.well.r, hw: p.well.r };
    p.well.y = height(p.well.x, p.well.z);
    pad(b, p.well.y);
  }
  // what's solid, bucketed so solidAt() looks at a handful
  for (const b of SETTLE.buildings) for (const o of [b, ...(b.parts || [])]) addSolid(o, Math.hypot(o.hl, o.hw));   // a wing, a wagon porch (house.js)
  for (const p of SETTLE.places) if (p.well) addSolid({ x: p.well.x, z: p.well.z, a: 0, hl: p.well.r, hw: p.well.r, round: p.well.r }, p.well.r * 1.5);
  for (const j of SETTLE.junctions) for (const q of [j, j.box]) addSolid({ x: q.x, z: q.z, a: 0, hl: POST_R, hw: POST_R }, POST_R * 1.5);   // the signpost and the mailbox's post
}
// The ruins aren't graded: the ground has grown up round them. Their walls and
// standing stones are solid where they stand too high to step over, and no tree
// grows through a wall (band 1, cleared) — but trees may stand inside them.
function placeRuins(){
  for (const ru of RUINS) for (const o of [...ru.pieces, ...ru.stones]){
    if (standing(o)) addSolid(o, Math.hypot(o.hl, o.hw));
    const R = Math.hypot(o.hl, o.hw) + 2;
    const c0 = Math.max(0, Math.floor((o.x - R + HALF) / HSTEP)), c1 = Math.min(HN - 1, Math.ceil((o.x + R + HALF) / HSTEP));
    const r0 = Math.max(0, Math.floor((o.z - R + HALF) / HSTEP)), r1 = Math.min(HN - 1, Math.ceil((o.z + R + HALF) / HSTEP));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++)
      if (!SB[r * HN + c] && inBuilding(o, c * HSTEP - HALF, r * HSTEP - HALF, 1.2)) SB[r * HN + c] = 1;
  }
}
const inGreen = (e, x, z) => {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.a), s = Math.sin(e.a);
  const u = (dx * c + dz * s) / e.rx, v = (-dx * s + dz * c) / e.rz;
  return u * u + v * v < 1;
};
const SOLID = new Map(), SC = 32;
const skey = (i, j) => (i + 2048) * 4096 + (j + 2048);
export function addSolid(b, rad){
  for (let i = Math.floor((b.x - rad - 2) / SC); i <= Math.floor((b.x + rad + 2) / SC); i++)
    for (let j = Math.floor((b.z - rad - 2) / SC); j <= Math.floor((b.z + rad + 2) / SC); j++){
      const k = skey(i, j);
      (SOLID.get(k) || SOLID.set(k, []).get(k)).push(b);
    }
}

// the settlements: { places, buildings, lanes } (settle.js)
export function settlements(){ if (!H) build(); return SETTLE; }
// the ruins: [{ kind, x, z, a, rad, pieces, stones, byRoad }] (ruins.js)
export function ruins(){ if (!H) build(); return RUINS; }
// the ways underground: { levels: [plan], entrances: [{ level, mouth, kind, x, z, y, face, stand }] } (under.js)
export function under(){ if (!H) build(); return UNDER; }
// 0 wild, 1 cleared round a settlement, beside a lane or at a ruin's walls, 2 a green, 3 a lane, 4 a yard, 5 a field, 6 a timber bridge's deck
export function builtBand(x, z){
  if (!SB) return 0;
  const c = Math.round((x + HALF) / HSTEP), r = Math.round((z + HALF) / HSTEP);
  return c < 0 || r < 0 || c >= HN || r >= HN ? 0 : SB[r * HN + c];
}
// is (x, z) within `pad` of a building, the well, or a ruin's standing wall or
// stone? Buildings are solid: the villagers go in and out by their doors, out of
// sight (agents.js House)
export function builtAt(x, z, pad = 0){
  if (!H) build();
  const list = SOLID.get(skey(Math.floor(x / SC), Math.floor(z / SC)));
  if (!list) return false;
  for (const b of list) if (b.round ? Math.hypot(x - b.x, z - b.z) < b.round + pad : inBuilding(b, x, z, b.thin ? Math.min(pad, 0.35) : pad)) return true;
  return false;
}
export const solidAt = builtAt;

// the Old Road: { pts, legs, length, xs, zs, prof, heightAt(s), nearest(x, z) }
export function road(){ if (!H) build(); return ROAD; }
// 2 on the paving, 1 on the cleared verge beside it, 0 elsewhere
export function roadBand(x, z){
  if (!H) build();
  const c = Math.round((x + HALF) / HSTEP), r = Math.round((z + HALF) / HSTEP);
  return c < 0 || r < 0 || c >= HN || r >= HN ? 0 : RB[r * HN + c];
}

// the rivers: { reaches: [{ xs, zs, ws (half-width), ks (curvature), ss, length, spring, end }] } (river.js)
export function rivers(){ if (!H) build(); return RIVERS; }
// 1 in a river's channel, 2 on a bar on the inside of a bend, 3 on its floodplain, 0 elsewhere
export function riverBand(x, z){ if (!H) build(); return rvAt(x, z); }
// the bridges: [{ kind: 'stone' (the Old Road) | 'timber' (a lane) | 'foot', ax, az, bx, bz, len, hw, deck(u) }]
export function bridges(){ if (!H) build(); return BRIDGES; }
// the ground itself, ignoring bridge decks (the ground mesh; everything that stands uses height())
export function groundHeight(x, z){
  if (!H) build();
  const gx = (x + HALF) / HSTEP, gz = (z + HALF) / HSTEP;
  if (gx < 0 || gz < 0 || gx >= HN - 1 || gz >= HN - 1) return rawHeight(x, z);
  const c = gx | 0, r = gz | 0, fx = gx - c, fz = gz - r, i = r * HN + c;
  const a = HG[i] + (HG[i + 1] - HG[i]) * fx, b = HG[i + HN] + (HG[i + HN + 1] - HG[i + HN]) * fx;
  return a + (b - a) * fz;
}
// is (x, z) under a bridge's deck?
export function underDeck(x, z){
  if (!H) build();
  const c = Math.round((x + HALF) / HSTEP), r = Math.round((z + HALF) / HSTEP);
  return c >= 0 && r >= 0 && c < HN && r < HN && DECK.has(r * HN + c);
}

export function height(x, z){
  if (!H) build();
  const gx = (x + HALF) / HSTEP, gz = (z + HALF) / HSTEP;
  if (gx < 0 || gz < 0 || gx >= HN - 1 || gz >= HN - 1) return rawHeight(x, z);
  const c = gx | 0, r = gz | 0, fx = gx - c, fz = gz - r, i = r * HN + c;
  const a = H[i] + (H[i + 1] - H[i]) * fx, b = H[i + HN] + (H[i + HN + 1] - H[i + HN]) * fx;
  return a + (b - a) * fz;
}

// region fields at a point: { sand, wet, wood, rough, peat, grove }, each 0..1
const _f = { sand: 0, wet: 0, wood: 0, rough: 0, peat: 0, grove: 0 };
export function fields(x, z, out = _f){
  if (!H) build();
  const gx = Math.min(FN - 1.001, Math.max(0, (x + HALF) / FSTEP));
  const gz = Math.min(FN - 1.001, Math.max(0, (z + HALF) / FSTEP));
  const c = gx | 0, r = gz | 0, fx = gx - c, fz = gz - r;
  const o00 = (r * FN + c) * NF, o01 = o00 + NF, o10 = o00 + FN * NF, o11 = o10 + NF;
  const lerp2 = k => { const a = F[o00 + k] + (F[o01 + k] - F[o00 + k]) * fx, b = F[o10 + k] + (F[o11 + k] - F[o10 + k]) * fx; return a + (b - a) * fz; };
  out.sand = lerp2(0); out.wet = lerp2(1); out.wood = lerp2(2); out.rough = lerp2(3); out.peat = lerp2(4);
  out.grove = lerp2(5);
  return out;
}

// steepness: height change per unit, over ±1u
export function slope(x, z){
  const dx = (height(x + 1, z) - height(x - 1, z)) * 0.5, dz = (height(x, z + 1) - height(x, z - 1)) * 0.5;
  return Math.hypot(dx, dz);
}

// ---- habitats -----------------------------------------------------------------
// surface: what the rest of the game reads via terrainType()
// cover:   how readily trees take hold (0..1) — forests where it's high
// soil:    richness 0..1 (soilRichness)
// pace:    walking speed here relative to an open meadow (1): soft sand, heather
//          and undergrowth slow you, a bog or reedbed halves you, the road
//          is quickest. terrain.js pace() adds the slope (Tobler).
// color:   ground colour
export const HABITATS = {
  lake:      { surface: 'water', cover: 0,    soil: 0,    pace: 0.4,  color: [0.30, 0.26, 0.18] },
  beach:     { surface: 'sand',  cover: 0.02, soil: 0.15, pace: 0.7,  color: [0.79, 0.69, 0.47] },
  marsh:     { surface: 'mud',   cover: 0.03, soil: 0.7,  pace: 0.5,  color: [0.36, 0.33, 0.19] },
  fen:       { surface: 'mud',   cover: 0.08, soil: 0.3,  pace: 0.6,  color: [0.47, 0.49, 0.25] },   // sedge + sphagnum
  carr:      { surface: 'mud',   cover: 0.85, soil: 0.8,  pace: 0.55, color: [0.30, 0.31, 0.17] },
  wetmeadow: { surface: 'grass', cover: 0.08, soil: 0.85, pace: 0.85, color: [0.33, 0.50, 0.22] },
  meadow:    { surface: 'grass', cover: 0.10, soil: 0.6,  pace: 1.0,  color: [0.47, 0.53, 0.25] },
  woodland:  { surface: 'grass', cover: 1.0,  soil: 0.65, pace: 0.8,  color: [0.31, 0.39, 0.19] },
  // the redwoods' home; other trees are sparse under them (see flora's scatter)
  grove:     { surface: 'grass', cover: 0.25, soil: 0.75, pace: 0.9,  color: [0.34, 0.27, 0.18] },   // needle duff
  heath:     { surface: 'grass', cover: 0.08, soil: 0.2,  pace: 0.75, color: [0.40, 0.33, 0.31] },   // heather
  rock:      { surface: 'rock',  cover: 0.05, soil: 0.05, pace: 0.7,  color: [0.49, 0.47, 0.44] },
  // the Old Road's paving (road.js): stone underfoot, so it walks and sounds like rock
  road:      { surface: 'rock',  cover: 0,    soil: 0,    pace: 1.25, color: [0.62, 0.55, 0.42] },
  // the settlements (settle.js): packed-earth lanes, the trodden ground round
  // the buildings, and the grazed green
  lane:      { surface: 'grass', cover: 0,    soil: 0.3,  pace: 1.15, color: [0.36, 0.24, 0.15] },   // darker and redder than a worn trail, so lanes read
  yard:      { surface: 'grass', cover: 0,    soil: 0.4,  pace: 1.05, color: [0.42, 0.36, 0.26] },
  green:     { surface: 'grass', cover: 0,    soil: 0.6,  pace: 1.0,  color: [0.40, 0.52, 0.23] },
  field:     { surface: 'grass', cover: 0,    soil: 0.9,  pace: 0.85, color: [0.33, 0.25, 0.16] },   // ploughed earth, walked across the furrows
  // a timber bridge's deck (a lane's, a footbridge): boards underfoot
  bridge:    { surface: 'rock',  cover: 0,    soil: 0,    pace: 1.1,  color: [0.42, 0.33, 0.22] },
};

const GROVE = 0.8;   // how rare the old-growth stands are (field threshold)

function hash(x, z){ const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }

const _hf = { sand: 0, wet: 0, wood: 0, rough: 0, peat: 0, grove: 0 };
export function habitat(x, z, h = height(x, z)){
  if (roadBand(x, z) === 2) return 'road';
  const sb = builtBand(x, z);
  if (sb === 3) return 'lane';
  if (sb === 4) return 'yard';
  if (sb === 2) return 'green';
  if (sb === 5) return 'field';
  if (sb === 6) return 'bridge';
  // a little per-metre jitter so borders are grainy, not ruled lines
  const d = h - WATER + (hash(Math.floor(x), Math.floor(z)) - 0.5) * 0.35;
  if (d < 0) return 'lake';
  const rv = rvAt(x, z);
  if (rv === 2 && d < 0.8) return 'beach';             // a river's sand and gravel bar, on the inside of a bend
  const f = fields(x, z, _hf);
  if (d < 0.55 && f.sand > 0.45) return 'beach';
  const sl = slope(x, z);
  if (sl > 0.75 || (f.rough > 0.6 && d > 6.5) || (d > 26 && sl > 0.4)) return 'rock';
  // high ground (the highlands): open upland heath with pine, woods on the
  // sheltered parts; bare rock above takes the steepest and highest
  if (d > 14) return f.wood > 0.6 ? 'woodland' : 'heath';
  const band = 0.7 + 1.9 * f.wet;                       // how high the ground stays waterlogged
  if (d < 0.5) return 'marsh';                          // reeds at the open water
  const carrT = rv === 3 ? 0.45 : 0.62;                // a river's floodplain grows its gallery of alder and willow more readily
  if (d < band){
    if (f.wood > carrT) return 'carr';                  // wet woodland (alder, willow)
    return f.peat > 0.42 && f.sand < 0.6 ? 'fen' : (d < band * 0.6 ? 'marsh' : 'wetmeadow');
  }
  if (d < band + 1.1 && f.wood < carrT) return 'wetmeadow';
  if (f.grove > GROVE && f.sand < 0.5 && f.rough < 0.6) return 'grove';  // old growth on moist loam
  if (f.sand > 0.5 && f.wood < 0.55 && d > band + 1.6) return 'heath';   // dry sandy rises
  return f.wood > 0.5 ? 'woodland' : 'meadow';
}
