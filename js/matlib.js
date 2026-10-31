// matlib.js — the Lea's shared materials, so a door, a chest, a boat or a hut doesn't each
// invent its own oak. Each is built once (procedurally, from a height field, the way
// stone-tex.js builds stone), kept, and handed to anyone who asks:
//
//   material('oak boards')    boards three to the unit, grain running up them, dark joints,
//                             a knot here and there, worn and a little greyed with age
//   material('oak')           the same wood without joints: rails, frames, lids, small parts
//   material('wrought iron')  hammered, dark, with rust come up in patches
//
// Conventions, so they can be used anywhere:
//   · UVs in world units, 1 per u. A material's textures repeat at their own real size
//     (the boards' tile is 1u across and 4u up), so geometry only has to say where it is.
//     boxGeo() makes a box with UVs like that; ExtrudeGeometry's own front UVs (the shape's
//     x, y) already are.
//   · Grain runs along v. For wood laid the other way, boxGeo's `grain` says which of the
//     box's axes the grain follows.
//   · PBR: colour, a normal map, roughness and metalness (stone-tex.js pbr()); colour nearest-
//     filtered like the rest of the world, the normal linear so its bevels stay smooth.
//   · Shared: never dispose one (a view's dispose() only frees materials marked `own`).

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { pbr } from './stone-tex.js';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// value noise wrapping every px lattice cells across and py down: a tile with no seam
function noise2(seed, px, py){
  const r = mulberry32(seed), L = new Float32Array(px * py);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const at = (i, j) => L[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Oak, 96 × 384 px for 1u × 4u. `joints`: boards three to the unit with a dark gap between.
function oakTextures(seed, joints){
  const w = 96, h = 384, BW = 32, r = mulberry32(seed);
  const streak = noise2(seed + 1, 48, 6), fine = noise2(seed + 2, 96, 24), blot = noise2(seed + 3, 6, 12), age = noise2(seed + 4, 3, 6);
  const tone = Array.from({ length: 3 }, () => 0.85 + r() * 0.28), lift = Array.from({ length: 3 }, () => (r() - 0.5) * 0.08);
  const knots = Array.from({ length: 4 }, () => ({ x: r() * w, y: r() * h, rx: 3 + r() * 4, ry: 6 + r() * 8 }));
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, b = Math.floor(x / BW), lx = x % BW;
    // grain: long streaks up the board, bent round any knot near
    let gx = x, kn = 0;
    for (const q of knots){
      const dx = ((x - q.x + w * 1.5) % w) - w / 2, dy = ((y - q.y + h * 1.5) % h) - h / 2, d = Math.hypot(dx / q.rx, dy / q.ry);
      if (d < 3){ gx += dx / (d + 0.6) * 1.6; if (d < 1) kn = Math.max(kn, 1 - d); }
    }
    const s = streak(gx / w * 48, y / h * 6), f = fine(gx / w * 96, y / h * 24);
    const grain = Math.pow(Math.abs(Math.sin((s * 7 + f * 1.5) * Math.PI)), 3);   // the annual rings, cut along
    const t = (joints ? tone[b] : tone[0] * 0.5 + 0.5) * (0.82 + 0.3 * blot(x / w * 6, y / h * 12)) * (1 - 0.32 * grain) * (1 - 0.55 * kn);
    const grey = 0.18 * age(x / w * 3, y / h * 6);                                  // weathered toward grey in patches
    let R = 112 * t, G = 78 * t, B = 50 * t;
    R = R * (1 - grey) + 92 * grey; G = G * (1 - grey) + 86 * grey; B = B * (1 - grey) + 78 * grey;
    // height: the board's face, the grain raised where the soft wood wore away, the knot proud
    let hh = 0.6 + (joints ? lift[b] : 0) - 0.06 * grain + 0.05 * kn;
    let ro = 0.72 + 0.14 * grain - 0.1 * blot(x / w * 6 + 3, y / h * 12);
    if (joints){
      const e = Math.min(lx, BW - 1 - lx);                                          // the board's edge, rounded, then the gap
      if (e < 1.5){ hh = 0.05; R *= 0.18; G *= 0.16; B *= 0.15; ro = 0.98; }
      else if (e < 4){ hh -= (4 - e) * 0.07; const d = 1 - (4 - e) * 0.08; R *= d; G *= d; B *= d; }
    }
    rgb[k * 3] = R; rgb[k * 3 + 1] = G; rgb[k * 3 + 2] = B; H[k] = hh; rough[k] = clamp(ro, 0.35, 1); metal[k] = 0;
  }
  const tex = pbr(w, h, rgb, H, 3, rough, metal);
  for (const m of [tex.map, tex.normalMap, tex.orm]) m.repeat.set(1, 0.25);
  return tex;
}
// Wrought iron, 64 px to the unit: hammer dents, and rust coming up in patches
function ironTextures(seed){
  const w = 64, h = 64, dent = noise2(seed, 16, 16), rust = noise2(seed + 1, 4, 4), fleck = noise2(seed + 2, 32, 32);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, d = dent(x / w * 16, y / h * 16), ru = clamp((rust(x / w * 4, y / h * 4) * 0.7 + fleck(x / w * 32, y / h * 32) * 0.3 - 0.52) * 4, 0, 1);
    const t = 0.8 + 0.4 * d;
    rgb[k * 3] = 46 * t * (1 - ru) + 104 * ru; rgb[k * 3 + 1] = 44 * t * (1 - ru) + 58 * ru; rgb[k * 3 + 2] = 42 * t * (1 - ru) + 32 * ru;
    H[k] = 0.5 + 0.25 * d + 0.08 * ru; rough[k] = 0.42 + 0.2 * (1 - d) + 0.45 * ru; metal[k] = 0.85 * (1 - ru);
  }
  return pbr(w, h, rgb, H, 4, rough, metal);
}

const MAKE = {
  'oak boards': () => oakTextures(0x0a4, true),
  'oak': () => oakTextures(0x0a5, false),
  'wrought iron': () => ironTextures(0x1f0),
};
const CACHE = new Map();
export const MATERIALS = Object.keys(MAKE);
export function material(name){
  if (!CACHE.has(name)){
    if (!MAKE[name]) throw new Error(`matlib: no material '${name}' (have ${MATERIALS.join(', ')})`);
    const t = MAKE[name]();
    CACHE.set(name, new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1 }));
  }
  return CACHE.get(name);
}

// A box w × h × d (x, y, z), centred, with UVs in world units: on each face, v runs along
// `grain` ('x', 'y' or 'z') where that axis lies in the face, else along the face's other axis
export function boxGeo(w, h, d, grain = 'y'){
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, size = { x: w, y: h, z: d };
  // BoxGeometry's faces, in order: ±x (u along z, v along y), ±y (u along x, v along z), ±z (u along x, v along y)
  const axes = [['z', 'y'], ['z', 'y'], ['x', 'z'], ['x', 'z'], ['x', 'y'], ['x', 'y']];
  for (let f = 0; f < 6; f++){
    let [ua, va] = axes[f];
    const swap = ua === grain;
    if (swap) [ua, va] = [va, ua];
    for (let q = f * 4; q < f * 4 + 4; q++){
      let u = uv.getX(q), v = uv.getY(q);
      if (swap) [u, v] = [v, u];
      uv.setXY(q, u * size[ua], v * size[va]);
    }
  }
  return g;
}
// boxGeo moved to (x, y, z) and turned `a` about the upright: for merging many into one mesh
export function placedBox(x, y, z, w, h, d, a = 0, grain = 'y'){
  const g = boxGeo(w, h, d, grain);
  if (a) g.rotateY(a);
  return g.translate(x, y, z);
}
