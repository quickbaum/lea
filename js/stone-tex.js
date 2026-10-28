// Worn stone, with depth: each texture is built from a HEIGHT FIELD first —
// blocks with chipped, rounded arrises, mortar eroded back into the joints,
// pitting, the odd crack — and both the colour and a normal map are read from
// that one field, so what looks worn is also shaped worn under a moving light
// (the torch underground, the sun on the ruins). Tileable; nearest-filtered
// colour like the rest of the world, a linear-filtered normal so the bevels
// stay smooth.
//
//   ashlar(seed, opts)  coursed blocks: walls, vaults, columns, the ruins
//   flags(seed)         worn floor slabs, dished where feet went, cracked
//   rock(seed)          cave rock: strata and fracture, no joints
//   cobble(seed, opts)  rounded stones packed in generations, big to small: rubble, causeways
//   hewn(seed)          cut out of the living rock: strata and tool marks
//   relief(pattern)     carved friezes and panels; reliefFromImage() for a Wagara sheet
//   marble(kind)        polished marble: paving, Cosmati mosaic, revetment, column shafts

import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// value noise that wraps every `P` lattice cells, so a tile repeats seamlessly
export function tileNoise(seed, P){
  const r = mulberry32(seed), L = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) L[i] = r();
  return (x, y) => {      // x, y in lattice units
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => L[(((b % P) + P) % P) * P + (((a % P) + P) % P)];
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}
// a few octaves of it over a w-pixel tile (each octave still wraps)
export function fbm(seed, w, base = 4, oct = 3){
  const ns = Array.from({ length: oct }, (_, o) => tileNoise(seed + o * 101, base << o));
  return (x, y) => { let s = 0, a = 1, n = 0; for (let o = 0; o < oct; o++){ s += ns[o](x / w * (base << o), y / w * (base << o)) * a; n += a; a *= 0.5; } return s / n; };
}

// colour (RGB 0..255 per pixel) and height (0..1) → the two textures
// colour (and a glow, for glass) and height → the textures; for js/glass.js
export function texturesFrom(w, h, rgb, H, strength, glow = null){
  const t = finish(w, h, rgb, H, strength);
  if (glow){
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), im = g.createImageData(w, h);
    for (let k = 0; k < w * h; k++){ im.data[k * 4] = clamp(glow[k * 3], 0, 255); im.data[k * 4 + 1] = clamp(glow[k * 3 + 1], 0, 255); im.data[k * 4 + 2] = clamp(glow[k * 3 + 2], 0, 255); im.data[k * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    t.emissiveMap = new THREE.CanvasTexture(cv);
    t.emissiveMap.magFilter = t.emissiveMap.minFilter = THREE.NearestFilter; t.emissiveMap.colorSpace = THREE.SRGBColorSpace; t.emissiveMap.generateMipmaps = false;
  }
  return t;
}
function finish(w, h, rgb, H, strength){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), im = g.createImageData(w, h);
  const nc = document.createElement('canvas'); nc.width = w; nc.height = h;
  const ng = nc.getContext('2d'), nm = ng.createImageData(w, h);
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, o = k * 4;
    im.data[o] = clamp(rgb[k * 3], 0, 255); im.data[o + 1] = clamp(rgb[k * 3 + 1], 0, 255); im.data[o + 2] = clamp(rgb[k * 3 + 2], 0, 255); im.data[o + 3] = 255;
    // canvas y runs down while texture v runs up (flipY), hence the signs
    let nx = -(at(x + 1, y) - at(x - 1, y)) * 0.5 * strength, ny = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    nm.data[o] = (nx * 0.5 + 0.5) * 255; nm.data[o + 1] = (ny * 0.5 + 0.5) * 255; nm.data[o + 2] = (nz * 0.5 + 0.5) * 255; nm.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0); ng.putImageData(nm, 0, 0);
  const map = new THREE.CanvasTexture(cv), normalMap = new THREE.CanvasTexture(nc);
  for (const t of [map, normalMap]){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = false; }
  map.magFilter = map.minFilter = THREE.NearestFilter; map.colorSpace = THREE.SRGBColorSpace;
  normalMap.magFilter = THREE.LinearFilter; normalMap.minFilter = THREE.LinearFilter; normalMap.colorSpace = THREE.NoColorSpace;
  return { map, normalMap, canvas: cv };
}

// Coursed ashlar. courses: rows per tile; len: block lengths (px); wear 0..1.5:
// how far the arrises have gone and the mortar washed out; tone: the stone's
// base colour; moss 0..1: green in the joints.
export function ashlar(seed = 1, { w = 64, h = 64, courses = 4, len = [12, 24], mortar = 1.1, wear = 1, tone = [128, 122, 110], moss = 0.3, strength = 3.2 } = {}){
  const r = mulberry32(seed), rows = [];
  const ch = h / courses;
  for (let c = 0; c < courses; c++){
    const cuts = [], off = (r() * w) | 0;
    let x = 0;
    while (x < w - len[0] * 0.6){ cuts.push((off + x) % w); x += len[0] + r() * (len[1] - len[0]); }
    cuts.sort((a, b) => a - b);
    rows.push({ y0: Math.round(c * ch), y1: Math.round((c + 1) * ch), cuts, tones: cuts.map(() => 0.8 + r() * 0.32), warm: cuts.map(() => (r() - 0.5) * 16),
      tilt: cuts.map(() => [(r() - 0.5) * 0.12, (r() - 0.5) * 0.12]) });
  }
  const nChip = fbm(seed + 7, w, 8, 3), nFace = fbm(seed + 13, w, 6, 3), nPit = tileNoise(seed + 19, 32), nStain = fbm(seed + 23, w, 3, 2), nMoss = fbm(seed + 29, w, 5, 2);
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++){
    const row = rows.find(o => y >= o.y0 && y < o.y1) || rows[rows.length - 1];
    for (let x = 0; x < w; x++){
      // which block: the last cut at or left of x (wrapping), and the distance to its ends
      let b = row.cuts.length - 1;
      for (let q = 0; q < row.cuts.length; q++) if (row.cuts[q] <= x) b = q;
      const left = row.cuts[b], right = row.cuts[(b + 1) % row.cuts.length];
      const dl = ((x - left) % w + w) % w, dr = ((right - x) % w + w) % w || w;
      const dx = Math.min(dl, dr), dy = Math.min(y - row.y0, row.y1 - 1 - y);
      // the arris chipped back by noise; corners go first
      const chip = (nChip(x, y) - 0.52) * 4.5 * wear, d = Math.min(dx, dy) - mortar / 2 - Math.max(0, chip) * (Math.min(dx, dy) < 4 ? 1 : 0);
      const k = y * w + x, m = d <= 0;
      if (m){
        H[k] = 0.1 + nFace(x * 2, y * 2) * 0.12 - (nChip(x + 31, y + 17) > 0.62 ? 0.1 * wear : 0);   // mortar, washed out in places
      } else {
        const [tx, ty] = row.tilt[b];
        H[k] = 0.45 + 0.55 * smooth(0, 2.6 + wear, d) + (nFace(x, y) - 0.5) * 0.14 + tx * (dl - dr) / 20 + ty * (y - (row.y0 + row.y1) / 2) / 8;
        if (nPit(x / 2, y / 2) > 0.83) H[k] -= 0.18 * wear;                                        // pitting
      }
      // colour: the block's own stone, darker down in the recesses, dirt in the joints,
      // water stains running down, green where it stays damp
      const t = m ? 0.5 + 0.35 * H[k] : row.tones[b] * (0.8 + 0.25 * H[k]), warm = m ? 0 : row.warm[b];
      let c0 = tone[0] * t + warm, c1 = tone[1] * t, c2 = tone[2] * t - warm;
      const stain = smooth(0.5, 0.75, nStain(x * 0.5, y * 0.08)) * 0.25;
      c0 *= 1 - stain; c1 *= 1 - stain; c2 *= 1 - stain * 0.9;
      const g = (m || H[k] < 0.5) ? smooth(0.55, 0.8, nMoss(x, y)) * moss : 0;
      c0 = c0 * (1 - g) + 70 * g; c1 = c1 * (1 - g) + 92 * g; c2 = c2 * (1 - g) + 50 * g;
      const n = (r() - 0.5) * 10;
      rgb[k * 3] = c0 + n; rgb[k * 3 + 1] = c1 + n; rgb[k * 3 + 2] = c2 + n;
    }
  }
  return finish(w, h, rgb, H, strength);
}

// Floor slabs: big flags in a running bond, worn hollow in the middle, cracked.
export function flags(seed = 2, { w = 64, h = 64, tone = [118, 112, 102], strength = 2.6 } = {}){
  const r = mulberry32(seed), rows = 2, ch = h / rows;
  const slabs = [];
  for (let c = 0; c < rows; c++){ const off = c % 2 ? w / 4 : 0; for (let q = 0; q < 2; q++) slabs.push({ c, x0: off + q * w / 2, tone: 0.78 + r() * 0.3 }); }
  const nF = fbm(seed + 3, w, 6, 3), nC = fbm(seed + 5, w, 4, 3), nS = fbm(seed + 9, w, 3, 2);
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const c = Math.min(rows - 1, Math.floor(y / ch)), off = c % 2 ? w / 4 : 0;
    const lx = ((x - off) % (w / 2) + w / 2) % (w / 2), ly = y - c * ch;
    const s = slabs[c * 2 + Math.floor((((x - off) % w) + w) % w / (w / 2))];
    const dx = Math.min(lx, w / 2 - 1 - lx), dy = Math.min(ly, ch - 1 - ly), d = Math.min(dx, dy) - 0.8 - Math.max(0, nC(x, y) - 0.6) * 4;
    const k = y * w + x, joint = d <= 0;
    // worn hollow toward the middle, and a crack where the noise runs in a thin ridge
    const mid = Math.min(lx / (w / 2), 1 - lx / (w / 2)) * Math.min(ly / ch, 1 - ly / ch);
    const crack = Math.abs(nC(x * 1.7 + 11, y * 1.7) - 0.5) < 0.012 && nF(x + 40, y) > 0.55 && !joint;
    H[k] = joint ? 0.15 : 0.6 + 0.4 * smooth(0, 2.4, d) - mid * 0.5 + (nF(x, y) - 0.5) * 0.1 - (crack ? 0.35 : 0);
    const t = joint ? 0.55 : s.tone * (0.85 + 0.2 * H[k]) * (crack ? 0.7 : 1), dirt = smooth(0.55, 0.8, nS(x, y)) * 0.18;
    const n = (r() - 0.5) * 9;
    rgb[k * 3] = tone[0] * t * (1 - dirt) + n; rgb[k * 3 + 1] = tone[1] * t * (1 - dirt) + n; rgb[k * 3 + 2] = tone[2] * t * (1 - dirt * 1.1) + n;
  }
  return finish(w, h, rgb, H, strength);
}

// Cobbles: rounded stones packed in generations, the way rubble walls and old causeways are
// laid (and the bridge in a reference painting, docs/HVqvATMXIAEKeDJ.png): big stones
// first, then smaller ones fitted into the gaps between them, then smaller again, so the
// pattern repeats at every scale it has room for. Each stone a lumpy oval, domed, darker
// toward its edges; deep dark mortar between. levels: [rmin, rmax, tries] per generation (px):
// few tries for the biggest, so only a handful of boulders, and many for the smallest.
export function cobble(seed = 7, { w = 256, h = 256, tone = [124, 116, 112], accents = [[146, 124, 92], [120, 112, 132]], gap = 0.9,
  levels = [[44, 64, 6], [20, 30, 500], [10, 15, 1800], [4.5, 7.5, 10000], [2, 3.4, 28000], [1, 1.8, 30000]], strength = 3.6 } = {}){
  const r = mulberry32(seed), own = new Int32Array(w * h).fill(-1), dome = new Float32Array(w * h);
  const nE = fbm(seed + 2, w, 8, 2), nS = fbm(seed + 4, w, 16, 2), stones = [];
  const wrap = (x, y) => ((Math.round(y) % h + h) % h) * w + ((Math.round(x) % w + w) % w);
  for (const [r0, r1, tries] of levels) for (let t = 0; t < tries; t++){
    const cx = r() * w, cy = r() * h, a = r0 + r() * (r1 - r0), b = a * (0.65 + r() * 0.35), ang = r() * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // room for it? the centre, a ring halfway, and its rim plus the mortar gap, all free
    let free = own[wrap(cx, cy)] < 0;
    for (let q = 0; free && q < 16; q++){
      const th = q / 16 * Math.PI * 2, ex = Math.cos(th), ey = Math.sin(th);
      for (const f of [0.5, 1]){
        const u = ex * (a * f + gap * (f === 1)), v = ey * (b * f + gap * (f === 1));
        if (own[wrap(cx + u * ca - v * sa, cy + u * sa + v * ca)] >= 0){ free = false; break; }
      }
    }
    if (!free) continue;
    const id = stones.length, k = r(), acc = accents[(r() * accents.length) | 0];
    stones.push({ col: tone.map((c, q) => (c + (acc[q] - c) * k * 0.45) * (0.78 + r() * 0.32)), lift: r() * 0.15 });
    const R = Math.ceil(a + 2);
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++){
      const u = x * ca + y * sa, v = -x * sa + y * ca, px = cx + x, py = cy + y;
      const q = Math.hypot(u / a, v / b) + (nE(px, py) - 0.5) * 0.35;        // a lumpy edge
      if (q >= 1) continue;
      const i = wrap(px, py);
      if (own[i] >= 0) continue;
      own[i] = id; dome[i] = Math.pow(1 - q * q, 0.6);
    }
  }
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let k = 0; k < w * h; k++){
    const x = k % w, y = (k / w) | 0, id = own[k], n = (r() - 0.5) * 10, sp = nS(x, y);
    if (id < 0){                                                    // mortar, sunk and dark
      H[k] = 0.08 + sp * 0.06;
      for (let q = 0; q < 3; q++) rgb[k * 3 + q] = tone[q] * (0.28 + sp * 0.12) + n * 0.5;
      continue;
    }
    const S = stones[id], d = dome[k];
    H[k] = 0.3 + 0.55 * d + S.lift + (sp - 0.5) * 0.06;
    const t = (0.62 + 0.38 * d) * (0.92 + (sp - 0.5) * 0.25);
    for (let q = 0; q < 3; q++) rgb[k * 3 + q] = S.col[q] * t + n;
  }
  return finish(w, h, rgb, H, strength);
}

// Cave rock: banded strata broken by fracture, damp and dark in the hollows.
export function rock(seed = 3, { w = 64, h = 64, tone = [112, 102, 90], strength = 4 } = {}){
  const r = mulberry32(seed), nA = fbm(seed + 1, w, 4, 4), nB = fbm(seed + 2, w, 8, 3), nS = fbm(seed + 4, w, 2, 2);
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, band = Math.sin((y / h) * Math.PI * 2 * 3 + nS(x, y) * 5);
    const frac = Math.abs(nB(x, y) - 0.5) < 0.03 ? -0.3 : 0;
    H[k] = nA(x, y) * 0.75 + band * 0.08 + frac + (nB(x * 2, y * 2) - 0.5) * 0.12;
    const t = 0.62 + nA(x, y) * 0.6 + band * 0.08 + frac * 0.6, n = (r() - 0.5) * 10;
    rgb[k * 3] = tone[0] * t + n; rgb[k * 3 + 1] = tone[1] * t + n; rgb[k * 3 + 2] = tone[2] * t * 0.96 + n;
  }
  return finish(w, h, rgb, H, strength);
}

// Hewn rock: chambers cut out of the living rock rather than built. Strata run
// through it, and the surface is all tool marks: patches of short parallel
// pick grooves, each patch struck at its own angle, the way a mason works a
// face in passes. No joints anywhere.
export function hewn(seed = 4, { w = 128, h = 128, tone = [126, 116, 100], strength = 3.4 } = {}){
  const r = mulberry32(seed), nA = fbm(seed + 1, w, 4, 3), nS = fbm(seed + 2, w, 2, 2), nP = tileNoise(seed + 3, 8), nF = fbm(seed + 5, w, 16, 2), nC = fbm(seed + 7, w, 4, 3);
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x;
    // which patch of tooling, and the angle it was struck at
    const p = nP(x / w * 8, y / h * 8), ang = p * Math.PI, along = x * Math.cos(ang) + y * Math.sin(ang), across = -x * Math.sin(ang) + y * Math.cos(ang);
    const groove = Math.pow(Math.abs(Math.sin(across * 1.3)), 0.6) * (0.6 + 0.4 * Math.sin(along * 0.35 + p * 20));
    const band = Math.sin((y / h) * Math.PI * 2 * 4 + nS(x, y) * 4);
    const fine = nF(x, y) - 0.5, crack = Math.abs(nC(x, y) - 0.5) < 0.012 ? 1 : 0;
    H[k] = 0.5 + groove * 0.3 + (nA(x, y) - 0.5) * 0.3 + fine * 0.15 + band * 0.08 - crack * 0.4;
    const t = 0.7 + (nA(x, y) - 0.5) * 0.35 + fine * 0.2 + band * 0.1 + groove * 0.12 - crack * 0.3, n = (r() - 0.5) * 12;
    rgb[k * 3] = tone[0] * t + n; rgb[k * 3 + 1] = tone[1] * t + n; rgb[k * 3 + 2] = tone[2] * t + n;
  }
  return finish(w, h, rgb, H, strength);
}

// Carved relief: a pattern standing out of a dressed ground, the way a frieze or
// a panel is cut. A frieze (wide, `w` ≫ `h`) repeats along its length; a panel
// (square) is framed. Recesses darken, worn high points lighten.
//   chevron, guilloche, billet, dogtooth, scroll   friezes
//   rosette, interlace                             panels
export const FRIEZES = ['chevron', 'guilloche', 'billet', 'dogtooth', 'scroll'];
export const PANELS = ['rosette', 'interlace'];
// Gothic tracery, cut blind into the wall (there is no daylight down there to
// glaze): heights for a recessed opening, the moulding round it, and the wall
const RECESS = 0.05, MOULD = 1, GROUND = 0.62;
// inside an equilateral pointed arch: opening half-width a, springing at sy (Y up)
const inArch = (X, Y, cx, a, sy) => Math.abs(X - cx) < a && (Y < sy || (Math.hypot(X - (cx - a), Y - sy) < 2 * a && Math.hypot(X - (cx + a), Y - sy) < 2 * a));
// an opening with its moulding: RECESS inside, MOULD in a band `m` round it, else null
const opening = (X, Y, cx, a, sy, m) => inArch(X, Y, cx, a, sy) ? RECESS : inArch(X, Y, cx, a + m, sy) ? MOULD : null;
const ring = (X, Y, cx, cy, r, m) => { const d = Math.hypot(X - cx, Y - cy); return d < r ? RECESS : d < r + m ? MOULD : null; };
const ridge = (d, wdt) => { const t = clamp(1 - Math.abs(d) / wdt, 0, 1); return Math.sqrt(t); };
const PATTERN = {
  // a zigzag band between two fillets (Romanesque chevron)
  chevron: (u, v) => { const tri = Math.abs(((u * 4) % 1 + 1) % 1 - 0.5) * 2; return Math.max(ridge(v - (0.25 + 0.5 * tri), 0.12), ridge(v - (0.25 + 0.5 * tri) + 0.28, 0.07) * 0.7); },
  // two strands plaited over and under, a boss in each eye
  guilloche: (u, v) => {
    const a = 0.5 + 0.3 * Math.sin(u * Math.PI * 2 * 3), b = 0.5 - 0.3 * Math.sin(u * Math.PI * 2 * 3), over = Math.cos(u * Math.PI * 2 * 3) > 0;
    const ra = ridge(v - a, 0.11), rb = ridge(v - b, 0.11), eye = ((u * 6) % 1 + 1) % 1;
    const boss = ridge(Math.hypot((eye - 0.5) * 0.6, v - 0.5), 0.07) * 0.8;
    return Math.max(over ? ra : ra * 0.7, over ? rb * 0.7 : rb, boss);
  },
  // two rows of short raised blocks, staggered
  billet: (u, v) => { const row = v < 0.5 ? 0 : 1, f = ((u * 8 + row * 0.5) % 1 + 1) % 1, vv = (v % 0.5) / 0.5; return f > 0.12 && f < 0.62 && vv > 0.18 && vv < 0.82 ? 0.85 + 0.15 * Math.sin(vv * Math.PI) : 0; },
  // four-petalled pyramids in a row
  dogtooth: (u, v) => { const f = ((u * 5) % 1 + 1) % 1 - 0.5, g = v - 0.5, pyr = clamp(1 - (Math.abs(f) + Math.abs(g)) / 0.42, 0, 1), cut = Math.min(Math.abs(Math.abs(f) - Math.abs(g)) / 0.04, 1); return pyr * (0.55 + 0.45 * cut); },
  // a vine stem waving along, a curl in each bay
  scroll: (u, v) => {
    const s = 0.5 + 0.22 * Math.sin(u * Math.PI * 2 * 3), stem = ridge(v - s, 0.07);
    const bay = ((u * 6) % 1 + 1) % 1, side = Math.floor(((u * 6) % 2 + 2) % 2) ? 1 : -1;
    const cx = 0.5, cy = 0.5 + side * 0.22, dx = (bay - cx) * 0.55, dy = v - cy, rr = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const curl = rr < 0.2 ? ridge(rr - (0.04 + 0.16 * (((th / (Math.PI * 2)) + 1) % 1)), 0.03) : 0;
    return Math.max(stem, curl * 0.9);
  },
  // an eight-petalled rose in a ring
  rosette: (u, v) => {
    const dx = u - 0.5, dy = v - 0.5, rr = Math.hypot(dx, dy) * 2, th = Math.atan2(dy, dx);
    const petal = rr < 0.7 * (0.55 + 0.45 * Math.abs(Math.cos(th * 4))) ? (1 - rr) * 0.9 + 0.2 : 0;
    return Math.max(petal, ridge(rr - 0.82, 0.06), rr < 0.14 ? 1 : 0);
  },
  // a dado of blind arcading: pointed arches on colonnettes, six to a repeat
  arcading: (u, v, k) => { const X = ((u * k) % (k / 6) + k / 6) % (k / 6), Y = 1 - v, cw = k / 6; return opening(X, Y, cw / 2, cw * 0.36, 0.55, 0.05) ?? GROUND; },
  // one tall lancet, with a cusped circle in its head
  lancet: (u, v, k) => { const X = u * k, Y = (1 - v); const c = ring(X, Y, k / 2, 0.78, 0.07, 0.03); if (c !== null && inArch(X, Y, k / 2, k * 0.36, 0.62)) return c === RECESS ? MOULD * 0.5 : MOULD; return opening(X, Y, k / 2, k * 0.36, 0.62, 0.035) ?? GROUND; },
  // plate tracery: two lancets and an oculus under one enclosing arch
  clerestory: (u, v, k) => {
    const X = u * k, Y = 1 - v, outer = opening(X, Y, k / 2, k * 0.44, 0.55, 0.04);
    if (outer === null) return GROUND;
    if (outer === MOULD) return MOULD;
    const l = opening(X, Y, k * 0.3, k * 0.16, 0.5, 0.025) ?? opening(X, Y, k * 0.7, k * 0.16, 0.5, 0.025) ?? ring(X, Y, k / 2, 0.8, 0.09, 0.025);
    return l ?? 0.5;                                                     // the plate between them
  },
  // a triforium: four small arches on colonnettes, a circle pierced over each
  triforium: (u, v, k) => {
    const cw = k / 4, X = ((u * k) % cw + cw) % cw, Y = 1 - v;
    return ring(X, Y, cw / 2, 0.8, 0.07, 0.025) ?? opening(X, Y, cw / 2, cw * 0.34, 0.45, 0.04) ?? GROUND;
  },
  // a rose: an outer ring, twelve spokes from a central oculus, a cusped circle in each petal
  rose: (u, v) => {
    const dx = u - 0.5, dy = v - 0.5, rr = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    if (rr > 0.5) return GROUND;
    if (rr > 0.45) return MOULD;
    if (rr < 0.07) return RECESS;
    if (rr < 0.1) return MOULD;
    const spoke = Math.abs(Math.sin(th * 6)) < 0.09 + 0.02 / rr;
    if (spoke) return MOULD;
    const pc = Math.round((th / (Math.PI * 2)) * 12 - 0.5) + 0.5, pa = pc / 12 * Math.PI * 2, cx = 0.5 + Math.cos(pa) * 0.33, cy = 0.5 + Math.sin(pa) * 0.33;
    const c = ring(u, v, cx, cy, 0.045, 0.018);
    return c ?? (rr > 0.42 ? MOULD : RECESS);
  },
  // two sets of strands crossing on the diagonals, over and under in turn
  interlace: (u, v) => {
    const a = Math.sin((u + v) * Math.PI * 2 * 2.5), b = Math.sin((u - v) * Math.PI * 2 * 2.5);
    const ra = ridge(a, 0.32), rb = ridge(b, 0.32), over = (Math.floor((u + v) * 5) + Math.floor((u - v + 4) * 5)) % 2 === 0;
    return Math.max(over ? ra : ra * 0.65, over ? rb * 0.65 : rb);
  },
};
export function relief(pattern, seed = 5, { w = 128, h = 32, tone = [140, 132, 118], strength = 5, frame = false, plain = false } = {}){
  const r = mulberry32(seed), nA = fbm(seed + 1, w, 4, 3), f = PATTERN[pattern] || PATTERN.chevron;
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, u = x / w, v = y / h;
    let p = f(u, v, w / h);
    // a frieze's fillets top and bottom, a panel's raised frame (tracery brings its own)
    if (!frame && !plain && (v < 0.08 || v > 0.92)) p = 0.9;
    if (frame){ const e = Math.min(u, v, 1 - u, 1 - v); if (e < 0.07) p = 1; else if (e < 0.1) p = 0; }
    const wear = (nA(x, y) - 0.5) * 0.16;
    H[k] = 0.15 + p * 0.8 + wear;
    const t = (0.6 + 0.45 * p) * (0.9 + wear), n = (r() - 0.5) * 8;
    rgb[k * 3] = tone[0] * t + n; rgb[k * 3 + 1] = tone[1] * t + n; rgb[k * 3 + 2] = tone[2] * t + n;
  }
  return finish(w, h, rgb, H, strength);
}
// a relief from a picture's light and dark: a Wagara sheet carved in stone,
// its figure standing out of the ground (whichever of the two is the lighter)
export function reliefFromImage(img, seed = 6, { w = 128, h = 128, tone = [140, 132, 118], strength = 5 } = {}){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0, Math.min(img.width, w * 2), Math.min(img.height, h * 2), 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, r = mulberry32(seed), nA = fbm(seed + 1, w, 4, 3);
  const H = new Float32Array(w * h), rgb = new Float32Array(w * h * 3);
  for (let k = 0; k < w * h; k++){
    const x = k % w, y = (k / w) | 0, p = (d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11) / 255;
    const e = Math.min(x, y, w - 1 - x, h - 1 - y) / w, fr = e < 0.07 ? 1 : e < 0.1 ? 0 : p;
    const wear = (nA(x, y) - 0.5) * 0.16;
    H[k] = 0.15 + fr * 0.8 + wear;
    const t = (0.6 + 0.45 * fr) * (0.9 + wear), n = (r() - 0.5) * 8;
    rgb[k * 3] = tone[0] * t + n; rgb[k * 3 + 1] = tone[1] * t + n; rgb[k * 3 + 2] = tone[2] * t + n;
  }
  // the sheet's own lines are 1px; soften the height a little so the normals read
  const Hs = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ let s = 0, c = 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++){ const X = x + a, Y = y + b; if (X >= 0 && Y >= 0 && X < w && Y < h){ s += H[Y * w + X]; c++; } } Hs[y * w + x] = s / c; }
  return finish(w, h, rgb, Hs, strength);
}

// Worn frescoes for a vault: painted plaster over the stone, faded, water-stained,
// cracked, and fallen away in patches to show the ashlar under it. The plaster is
// smooth and stands a little proud; where it's gone, the stone's own relief shows.
//   stars    ultramarine with gold eight-point stars (Sainte-Chapelle, Assisi)
//   vines    a scrolling vine with leaves and flowers on ochre
//   joints   false jointing: red lines drawn on whitewash as ashlar, a rosette in each block
//   mosaic   gold tesserae, with crosses of blue and red: the deep floors (metal: see orm)
export const FRESCOES = ['stars', 'vines', 'joints'];
// `fresh`: just painted (a Faerie palace's): no plaster lost, no cracks, no damp, hardly faded
export function fresco(kind, seed = 9, { w = 128, h = 128, wear = 1, fresh = false } = {}){
  const r = mulberry32(seed), stone = ashlar(seed + 1, { w, h, courses: 10, len: [14, 30], wear: 0.9, tone: [124, 118, 106], moss: 0.05 });
  const sg = document.createElement('canvas').getContext('2d');
  sg.canvas.width = w; sg.canvas.height = h; sg.drawImage(stone.map.image, 0, 0);
  const base = sg.getImageData(0, 0, w, h).data;
  const nLoss = fbm(seed + 3, w, 4, 4), nFade = fbm(seed + 5, w, 3, 3), nStain = fbm(seed + 7, w, 2, 3), nCrack = fbm(seed + 11, w, 5, 3), nT = tileNoise(seed + 13, 32);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), metal = kind === 'mosaic' ? new Float32Array(w * h) : null, rough = new Float32Array(w * h);
  // the painting, at a pixel: [r, g, b] and whether it's gold
  const paint = (x, y) => {
    const u = x / w, v = y / h;
    if (kind === 'stars'){
      const cell = 16, cx = Math.floor(x / cell), cy = Math.floor(y / cell), j = (cx * 7 + cy * 13) % 5, ox = (cx + 0.5) * cell + (j - 2), oy = (cy + 0.5) * cell + ((j * 3) % 5 - 2);
      const dx = x - ox, dy = y - oy, rr = Math.hypot(dx, dy), th = Math.atan2(dy, dx), star = rr < 2.2 + 2.6 * Math.pow(Math.abs(Math.cos(th * 4)), 6);
      return star ? [218, 176, 74, true] : rr < 1.2 && (cx + cy) % 3 === 0 ? [180, 40, 40] : [34 + nT(u * 16, v * 16) * 12, 54 + nT(u * 16 + 5, v * 16) * 10, 118 + nT(u * 16, v * 16 + 9) * 20];
    }
    if (kind === 'vines'){
      const band = Math.sin(u * Math.PI * 2 * 2 + Math.sin(v * Math.PI * 2 * 2) * 1.4), stem = Math.abs(band - (v * 4 % 1 - 0.5) * 1.6) < 0.12;
      const leaf = Math.abs(Math.sin(u * Math.PI * 2 * 8) * Math.cos(v * Math.PI * 2 * 8)) > 0.86;
      const flower = Math.hypot((u * 8) % 1 - 0.5, (v * 8 + 0.25) % 1 - 0.5) < 0.12;
      return flower ? [190, 50, 44] : stem ? [70, 92, 40] : leaf ? [92, 120, 52] : [196, 160, 98];
    }
    if (kind === 'joints'){
      const row = Math.floor(y / 16), bx = (x + (row % 2) * 16) % 32, by = y % 16;
      const line = bx < 1.2 || by < 1.2 || (bx > 2.6 && bx < 3.4) || (by > 2.6 && by < 3.4);
      const ro = Math.hypot(bx - 17, by - 9) < 2.2;
      return line ? [158, 52, 40] : ro ? [170, 70, 48] : [226, 216, 192];
    }
    // mosaic: gold tesserae, a cross of colour in every eighth
    const tx = Math.floor(x / 4), ty = Math.floor(y / 4), lx = x % 4, ly = y % 4, grout = lx === 3 || ly === 3;
    if (grout) return [70, 58, 40, false, true];
    const cx = tx % 8, cy = ty % 8, cross = (cx === 4 && cy > 1 && cy < 7) || (cy === 4 && cx > 1 && cx < 7);
    const k = 0.85 + nT(tx * 0.5, ty * 0.5) * 0.3;
    return cross ? ((tx >> 3) + (ty >> 3)) % 2 ? [40 * k, 66 * k, 150 * k] : [160 * k, 34 * k, 40 * k] : [222 * k, 178 * k, 82 * k, true];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, b = [base[k * 4], base[k * 4 + 1], base[k * 4 + 2]], sl = (b[0] + b[1] + b[2]) / 765;
    // the plaster's lost where the noise says, more so where the wear is heavier
    const loss = nLoss(x, y) + (nT(x / 3, y / 3) - 0.5) * 0.08, lost = !fresh && loss > 0.72 - 0.12 * wear, edge = !fresh && !lost && loss > 0.69 - 0.12 * wear;
    if (lost){ rgb[k * 3] = b[0]; rgb[k * 3 + 1] = b[1]; rgb[k * 3 + 2] = b[2]; H[k] = sl * 0.6; rough[k] = 0.9; if (metal) metal[k] = 0; continue; }
    const p = paint(x, y), crack = !fresh && Math.abs(nCrack(x * 1.4, y * 1.4) - 0.5) < 0.008;
    // faded toward the plaster, stained with old damp, darker in the cracks; a pale rim at a loss
    const fade = fresh ? 0.03 : 0.2 + nFade(x, y) * 0.35 * wear, plaster = [214, 204, 182];
    let c = [0, 1, 2].map(q => p[q] + (plaster[q] - p[q]) * (p[3] ? fade * 0.5 : fade));
    const st = fresh ? 0 : Math.max(0, nStain(x * 0.6, y * 0.25) - 0.55) * 1.6;
    c = c.map((v, q) => v * (1 - st * 0.45) - (q === 2 ? st * 10 : 0));
    if (crack) c = c.map(v => v * 0.55);
    if (edge) c = c.map(v => v * 0.8 + 40);
    rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
    H[k] = p[4] ? 0.84 : edge ? 0.86 : 0.95 - (crack ? 0.12 : 0);
    rough[k] = p[3] ? 0.35 : 0.85;
    if (metal) metal[k] = p[3] ? 1 : 0;
  }
  const t = finish(w, h, rgb, H, 3);
  for (const m of [t.map, t.normalMap]) m.repeat.set(0.5, 0.5);
  if (metal){
    // occlusion, roughness, metal: glTF's channels, which three reads for these maps
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), im = g.createImageData(w, h);
    for (let k = 0; k < w * h; k++){ im.data[k * 4] = 255; im.data[k * 4 + 1] = rough[k] * 255; im.data[k * 4 + 2] = metal[k] * 255; im.data[k * 4 + 3] = 255; }
    g.putImageData(im, 0, 0);
    t.orm = new THREE.CanvasTexture(cv); t.orm.wrapS = t.orm.wrapT = THREE.RepeatWrapping; t.orm.magFilter = t.orm.minFilter = THREE.NearestFilter; t.orm.colorSpace = THREE.NoColorSpace; t.orm.generateMipmaps = false; t.orm.repeat.set(0.5, 0.5);
  }
  return t;
}

// ---- marble ------------------------------------------------------------------------
// Polished marble for the grand floors: the stone's own colour and veining,
// smooth (a roughness map, so the torch slides across it) but worn duller where
// feet and hands went. Veins are a sine through a turbulent field, so they
// wander as marble's do, and still tile.
//
//   marble(kind, seed)   kind: (the floors' pavements are pavement.js)
//                              revet (wall revetment: slabs bookmatched in pairs,
//                                as in Hagia Sophia, over a band of porphyry)
//                              shaft (verde antico) | porphyry (for columns)
//   → { map, normalMap, orm }   orm: G roughness, B metal (only the gold tesserae)
export const MARBLE = {
  white: { base: [222, 218, 208], vein: [128, 132, 140], f: [1, 2], amp: 5 },
  grey: { base: [148, 150, 154], vein: [92, 94, 100], f: [2, 1], amp: 4 },
  pavonazzetto: { base: [228, 220, 206], vein: [124, 72, 92], f: [2, 2], amp: 8, wide: 0.28 },
  verde: { base: [46, 84, 62], vein: [196, 212, 196], f: [0, 3], amp: 7, speck: [18, 30, 22] },
  porphyry: { base: [118, 36, 44], speck: [214, 196, 190] },
  serpentine: { base: [40, 72, 48], speck: [150, 186, 132] },
  giallo: { base: [206, 166, 98], vein: [156, 108, 58], f: [2, 1], amp: 4 },
  nero: { base: [38, 36, 36], vein: [168, 164, 156], f: [1, 3], amp: 6 },
};
export function marble(kind, seed = 31){
  const w = kind === 'shaft' || kind === 'porphyry' ? 64 : 128, h = 128, r = mulberry32(seed);
  const nT = fbm(seed + 1, w, 4, 4), nT2 = fbm(seed + 2, w, 3, 3), nW = fbm(seed + 3, w, 3, 3), nS = tileNoise(seed + 5, 32);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  // a marble's colour at (x, y); `ph` shifts its veins, so neighbouring slabs differ
  const stone = (name, x, y, ph = 0) => {
    const m = MARBLE[name];
    let c = m.base.slice();
    if (m.vein){
      const t = Math.abs(Math.sin(Math.PI * 2 * (x / w * m.f[0] + y / h * m.f[1]) + nT(x, y) * m.amp + ph)), v = 1 - smooth(0.0, m.wide || 0.12, t), cloud = (nT2(x + ph * 13, y) - 0.5) * 0.18;
      c = c.map((b, q) => (b + (m.vein[q] - b) * v * 0.85) * (1 + cloud));
    }
    if (m.speck){ const s = nS(x * 0.9 + ph * 7, y * 0.9) > 0.86 || r() < 0.012; if (s) c = m.speck.slice(); }
    return c;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x;
    let c, hh = 0.7, ro = 0.22, me = 0;
    if (kind === 'revet'){
      // two slabs a tile, the second its neighbour's mirror image (sawn from one block and opened like a book)
      const band = y >= h - 12, fillet = y >= h - 14 && y < h - 12 || y < 2, lx = x % 64, mx = x < 64 ? lx : 63 - lx, joint = lx === 0;
      if (band) c = stone('porphyry', x, y);
      else if (fillet){ c = stone('white', x, y); hh = 0.8; }
      else c = stone('pavonazzetto', mx, y, 1.3);
      if (joint){ c = c.map(v => v * 0.6); hh = 0.6; }
    } else c = stone(kind === 'porphyry' ? 'porphyry' : 'verde', x, y);
    // worn: duller and a touch darker where the wear-noise is high
    const wear = smooth(0.5, 0.8, nW(x, y));
    ro = me ? ro : Math.max(ro, 0.18 + wear * 0.35);
    for (let q = 0; q < 3; q++) rgb[k * 3 + q] = c[q] * (1 - wear * 0.08);
    H[k] = hh; rough[k] = ro; metal[k] = me;
  }
  return pbr(w, h, rgb, H, 2, rough, metal);
}
// colour, height, roughness and metal → { map, normalMap, orm } (orm: glTF's channels, G roughness, B metal)
export function pbr(w, h, rgb, H, strength, rough, metal){
  const t = finish(w, h, rgb, H, strength);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), im = g.createImageData(w, h);
  for (let k = 0; k < w * h; k++){ im.data[k * 4] = 255; im.data[k * 4 + 1] = rough[k] * 255; im.data[k * 4 + 2] = metal[k] * 255; im.data[k * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  t.orm = new THREE.CanvasTexture(cv); t.orm.wrapS = t.orm.wrapT = THREE.RepeatWrapping; t.orm.magFilter = t.orm.minFilter = THREE.NearestFilter; t.orm.colorSpace = THREE.NoColorSpace; t.orm.generateMipmaps = false;
  return t;
}
