// Where the wool goes on a sheep (docs/sheep.md): shared by the view, which draws it, and js/shear.js, which cuts it.
// No THREE here, so the shearing logic can be tested in node.
import { mulberry32 } from './rng.js';

// the shader's body parts that wool rides on (js/sheep-view.js has the legs too)
export const TORSO = 0, HEAD = 5;

// The fleece's outer shape as overlapping ellipsoids; puffs sit on their surfaces. [cx, cy, cz, rx, ry, rz, count, part, size]
const FLEECE = [
  [0, 0.53, -0.04, 0.28, 0.28, 0.50, 120, TORSO, 0.21],
  [0, 0.70, 0.36, 0.17, 0.18, 0.19, 34, HEAD, 0.15],
  [0, 0.90, 0.47, 0.10, 0.06, 0.09, 12, HEAD, 0.10],
];
export const FLEECE_DEPTH = 0.11;     // how far a puff sinks toward the skin as the wool shortens

// The skin under the wool, as sections along the sheep: [z, y, half width, half height]. The view builds the body from TORSO_RINGS.
export const TORSO_RINGS = [[-0.42, 0.50, 0.05, 0.06], [-0.34, 0.50, 0.13, 0.14], [-0.14, 0.50, 0.175, 0.18], [0.12, 0.51, 0.17, 0.18], [0.30, 0.54, 0.12, 0.15], [0.40, 0.58, 0.05, 0.07]];
const NECK_RINGS = [[0.34, 0.62, 0.065, 0.08], [0.50, 0.80, 0.085, 0.09], [0.69, 0.73, 0.052, 0.05]];
const REACH = 0.38;      // a puff's drawn ball is about this much of its size from the middle to the edge: stand further off than that and it floats

// the nearest point of one run of sections to p, and how far off it is (0 inside)
function toSection(p, rings){
  const z = Math.max(rings[0][0], Math.min(rings[rings.length - 1][0], p[2]));
  let i = 0; while (i + 2 < rings.length && z > rings[i + 1][0]) i++;
  const a = rings[i], b = rings[i + 1], t = (z - a[0]) / (b[0] - a[0]), y = a[1] + (b[1] - a[1]) * t, w = a[2] + (b[2] - a[2]) * t, h = a[3] + (b[3] - a[3]) * t;
  const rho = Math.hypot(p[0] / w, (p[1] - y) / h);
  const at = rho > 1 ? [p[0] / rho, y + (p[1] - y) / rho, z] : [p[0], p[1], z];
  return { at, gap: Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) };
}
// the skin nearest a puff: the body or the neck, whichever is closer
export function nearestSkin(p){
  const a = toSection(p, TORSO_RINGS), b = toSection(p, NECK_RINGS);
  return a.gap < b.gap ? a : b;
}

function inside(p, e, slack = 0.9){
  return ((p[0] - e[0]) / e[3]) ** 2 + ((p[1] - e[1]) / e[4]) ** 2 + ((p[2] - e[2]) / e[5]) ** 2 < slack;
}
// loose: as it was before each puff was brought in to touch the skin; tools/check-shear.mjs builds it to prove its test can fail
export function buildFleece({ loose = false } = {}){
  const r = mulberry32(21), puffs = [];
  FLEECE.forEach((e) => {
    const n = e[6], golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++){
      const y = 1 - 2 * (i + 0.5) / n, t = Math.sqrt(1 - y * y), a = i * golden + r() * 0.5;
      const dir = [Math.cos(a) * t, y, Math.sin(a) * t];
      const p = [e[0] + dir[0] * e[3], e[1] + dir[1] * e[4], e[2] + dir[2] * e[5]];
      if (FLEECE.some(o => o !== e && inside(p, o))) continue;    // buried in another lobe
      if (p[1] < 0.27) continue;                                  // leave the belly clear of the legs
      let nx = dir[0] / e[3], ny = dir[1] / e[4], nz = dir[2] / e[5];
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const size = e[8] * (0.85 + r() * 0.35);
      // the ellipsoids are the fleece's outline: with nothing under them, a puff can stand clear of the sheep, and shows it the moment its neighbours are cut
      if (!loose){
        const { at, gap } = nearestSkin(p), most = size * REACH;
        if (gap > most) for (let k = 0; k < 3; k++) p[k] = at[k] + (p[k] - at[k]) * most / gap;
      }
      puffs.push({ p, n: [nx, ny, nz], part: e[7], size, frame: r() < 0.14 ? 3 : r() * 3 | 0, noise: r() });
    }
  });
  return puffs;
}
