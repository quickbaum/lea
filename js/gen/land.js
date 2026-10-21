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

import { SIZE, WATER, WORLD_SEED, WORLD } from '../config.js';
import { mulberry32 } from '../rng.js';

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
// color:   ground colour
export const HABITATS = {
  lake:      { surface: 'water', cover: 0,    soil: 0,    color: [0.30, 0.26, 0.18] },
  beach:     { surface: 'sand',  cover: 0.02, soil: 0.15, color: [0.79, 0.69, 0.47] },
  marsh:     { surface: 'mud',   cover: 0.03, soil: 0.7,  color: [0.36, 0.33, 0.19] },
  fen:       { surface: 'mud',   cover: 0.08, soil: 0.3,  color: [0.47, 0.49, 0.25] },   // sedge + sphagnum
  carr:      { surface: 'mud',   cover: 0.85, soil: 0.8,  color: [0.30, 0.31, 0.17] },
  wetmeadow: { surface: 'grass', cover: 0.08, soil: 0.85, color: [0.33, 0.50, 0.22] },
  meadow:    { surface: 'grass', cover: 0.10, soil: 0.6,  color: [0.47, 0.53, 0.25] },
  woodland:  { surface: 'grass', cover: 1.0,  soil: 0.65, color: [0.31, 0.39, 0.19] },
  // the redwoods' home; other trees are sparse under them (see flora's scatter)
  grove:     { surface: 'grass', cover: 0.25, soil: 0.75, color: [0.34, 0.27, 0.18] },   // needle duff
  heath:     { surface: 'grass', cover: 0.08,  soil: 0.2,  color: [0.40, 0.33, 0.31] },   // heather
  rock:      { surface: 'rock',  cover: 0.05, soil: 0.05, color: [0.49, 0.47, 0.44] },
};

const GROVE = 0.8;   // how rare the old-growth stands are (field threshold)

function hash(x, z){ const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); }

const _hf = { sand: 0, wet: 0, wood: 0, rough: 0, peat: 0, grove: 0 };
export function habitat(x, z, h = height(x, z)){
  // a little per-metre jitter so borders are grainy, not ruled lines
  const d = h - WATER + (hash(Math.floor(x), Math.floor(z)) - 0.5) * 0.35;
  if (d < 0) return 'lake';
  const f = fields(x, z, _hf);
  if (d < 0.55 && f.sand > 0.45) return 'beach';
  const sl = slope(x, z);
  if (sl > 0.75 || (f.rough > 0.6 && d > 6.5) || (d > 26 && sl > 0.4)) return 'rock';
  // high ground (the highlands): open upland heath with pine, woods on the
  // sheltered parts; bare rock above takes the steepest and highest
  if (d > 14) return f.wood > 0.6 ? 'woodland' : 'heath';
  const band = 0.7 + 1.9 * f.wet;                       // how high the ground stays waterlogged
  if (d < 0.5) return 'marsh';                          // reeds at the open water
  if (d < band){
    if (f.wood > 0.62) return 'carr';                   // wet woodland (alder, willow)
    return f.peat > 0.42 && f.sand < 0.6 ? 'fen' : (d < band * 0.6 ? 'marsh' : 'wetmeadow');
  }
  if (d < band + 1.1 && f.wood < 0.62) return 'wetmeadow';
  if (f.grove > GROVE && f.sand < 0.5 && f.rough < 0.6) return 'grove';  // old growth on moist loam
  if (f.sand > 0.5 && f.wood < 0.55 && d > band + 1.6) return 'heath';   // dry sandy rises
  return f.wood > 0.5 ? 'woodland' : 'meadow';
}
