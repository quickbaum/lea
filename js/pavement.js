// Pavements for the crypt's grander floors, after real medieval ones. Each is a
// height field with colour, roughness and metal, like the rest of the stone
// (stone-tex.js), and tiles seamlessly. The compositions (a roundel, a quincunx)
// sit at the texture's centre, so under-view.js centres them on the room.
//
//   ceramic: lead-glazed earthenware, the English cathedral floors
//     encaustic   red tiles inlaid with white clay that the glaze turns yellow, in
//                 4- and 16-tile designs (a circle of fleurs-de-lis, a quatrefoil,
//                 a rose, interlocking circles, powdered fleurs), set on the
//                 diagonal in panels framed by strips of plain dark and yellow
//                 tiles: Westminster's chapter house and the Chertsey tiles
//     cistercian  tile mosaic: great roundels of curved tiles in rings, in
//                 diamond-set panels, with chequered corners: Byland, Rievaulx
//   marble (opus sectile and Cosmati work): Rome, Anagni, Westminster's sanctuary
//     cubes       a passage floor: hexagons cut into rhombi, white, grey and black
//     stars       a passage floor: eight-point stars in a white ground
//     quincunx    a porphyry roundel in a white band that weaves over and under
//                 the bands round four serpentine roundels at its corners
//     rotae       a chain of roundels down the middle, interlaced, between
//                 panels of geometric fields (as down the nave of San Clemente)
//     panels      a grid of square panels in white bands, each its own field, a
//                 roundel in the middle one and squares set on the point in the corners
//   The marble fields are the Cosmati's own: triangles, hexagons cut into
//   cubes, eight-point stars, squares within squares, chevrons, and Sierpinski
//   triangles (Anagni's floor has them, long before Sierpiński).
//
//   pavement(kind, seed) → { map, normalMap, orm, world }   world: the u it covers
//   and for laying them to a room: tileWall/tileLine/tileCorner/tileKnot, cosWall/... (below)

import { mulberry32 } from './rng.js';
import { tileNoise, fbm, smooth, MARBLE, pbr } from './stone-tex.js';

const hash = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 982451653) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const fract = v => v - Math.floor(v);
const R3 = Math.sqrt(3);

// ---- ceramic --------------------------------------------------------------------------
const CLAY = { red: [134, 60, 32], slip: [210, 162, 70], black: [40, 34, 24], green: [60, 70, 34], body: [158, 96, 66], mortar: [86, 78, 66] };

// a fleur-de-lis, upright in [-1, 1]²
function fleur(p, q){
  const a = Math.abs(p);
  if (Math.abs(q + 0.18) < 0.08 && a < 0.38) return true;                               // the band
  if (q > -0.18 && q < 0.9){ const t = (q + 0.18) / 1.08; if (a < 0.21 * Math.sin(Math.PI * Math.pow(t, 0.75))) return true; }   // the middle petal
  const d = Math.hypot(a - 0.42, q - 0.08);                                               // the side petals curl out and down
  if (d > 0.14 && d < 0.25 && !(a < 0.42 && q < 0.08)) return true;
  if (a < 0.07 && q < -0.18 && q > -0.6) return true;                                      // the foot
  return Math.hypot(a - 0.2, q + 0.44) < 0.1;
}
// the designs, in a group's own [-1, 1]² (n: tiles a side); true where it's inlaid
const sq = (X, Y) => [(Math.abs(X) - Math.abs(Y)) / Math.SQRT2, (Math.abs(X) + Math.abs(Y)) / Math.SQRT2];   // along the diagonal, out from the middle
const DESIGNS = {
  // a ring with a fleur-de-lis in each quarter pointing out, quarter-circles at the corners
  circle: { n: 2, f(X, Y){
    const r = Math.hypot(X, Y);
    if (r > 0.8 && r < 0.9) return true;
    if (r < 0.8){ const [p, q] = sq(X, Y); return r < 0.1 || fleur(p / 0.3, (q - 0.42) / 0.3); }
    const c = Math.hypot(Math.abs(X) - 1, Math.abs(Y) - 1); return (c > 0.22 && c < 0.3) || c < 0.1;
  } },
  // a quatrefoil outline round a six-petalled rose, a fleur in each corner pointing in
  quatrefoil: { n: 2, f(X, Y){
    const d = Math.min(Math.hypot(X - 0.4, Y), Math.hypot(X + 0.4, Y), Math.hypot(X, Y - 0.4), Math.hypot(X, Y + 0.4)) - 0.44;
    if (Math.abs(d) < 0.055) return true;
    const r = Math.hypot(X, Y), th = Math.atan2(Y, X);
    if (d < 0) return r < 0.07 || (r < 0.36 && r > 0.12 && Math.cos(6 * th) > 0.35 - r);
    const [p, q] = sq(X, Y); return q > 1.0 && fleur(p / 0.22, (1.3 - q) / 0.22);
  } },
  // sixteen tiles to a rose window: rings, a band of beads, an arcade of spokes, a rosette
  rose: { n: 4, f(X, Y){
    const r = Math.hypot(X, Y), th = Math.atan2(Y, X), seg = fract(th / (Math.PI * 2) * 16);
    if (r > 0.9 && r < 0.97) return true;
    if (r > 0.78 && r < 0.88){ const sb = fract(th / (Math.PI * 2) * 28); return Math.hypot((sb - 0.5) * r * 0.224, r - 0.83) < 0.042; }
    if (r > 0.71 && r < 0.75) return true;
    if (r > 0.3 && r < 0.71){
      if (Math.abs(seg - 0.5) * r * 0.39 > 0.083) return true;                             // a spoke between the sectors
      return Math.hypot((seg - 0.5) * r * 0.39, r - 0.6) > 0.075 && r > 0.6;               // an arched head on each
    }
    if (r > 0.26) return true;
    if (r < 0.26) return r < 0.05 || (r > 0.08 && Math.cos(8 * th) > (r - 0.08) * 3.6 - 0.2);
    return false;
  } },
  // circles struck from every corner and the middle, interlocking down the pavement
  arcs: { n: 2, f(X, Y){
    const c = Math.hypot(Math.abs(X) - 1, Math.abs(Y) - 1), r = Math.hypot(X, Y);
    return Math.abs(c - 1) < 0.07 || Math.abs(r - 0.5) < 0.06 || r < 0.12 || c < 0.14;
  } },
  // a fleur on every tile, turned a quarter each tile
  fleurs: { n: 2, f(X, Y){
    const tx = X < 0 ? X + 0.5 : X - 0.5, ty = Y < 0 ? Y + 0.5 : Y - 0.5, turn = (X < 0) !== (Y < 0);
    const [p, q] = turn ? [ty * 2, -tx * 2] : [tx * 2, ty * 2];
    return fleur(p * 1.15, q * 1.15) || (Math.abs(Math.abs(tx) - 0.5) < 0.03 && Math.abs(Math.abs(ty) - 0.5) < 0.03);
  } },
};

// Encaustic tiles set on the diagonal: panels of 4×4 decorated tiles, framed by
// strips half a tile wide. A tile is about 0.47u; the texture covers 6u.
function encaustic(seed, designs, w){
  const Q = 4.5, m = 2, s = w / (Math.SQRT2 * m * Q), P = Q * s, J = 0.7 / s;
  return (x, y) => {
    const U = (x + y + 1) / Math.SQRT2, V = (x - y + w) / Math.SQRT2;
    const pu = Math.floor(U / P), pv = Math.floor(V / P), lu = U - pu * P, lv = V - pv * P;
    const bu = lu < s / 2, bv = lv < s / 2;
    if (bu || bv){
      // the strips: alternately dark and yellow plain tiles; a dark square where they cross
      const along = bu ? lv : lu, idx = bu && bv ? -1 : Math.floor((along - s / 2) / s), f = bu && bv ? 0.5 : fract((along - s / 2) / s), across = (bu ? lu : lv) / (s / 2);
      const joint = f < J || f > 1 - J || across < J * 2 || across > 1 - J * 2;
      const id = (pu * 31 + pv) * 64 + (bu ? 40 : 50) + idx;
      return { mat: joint ? 'mortar' : idx < 0 || idx % 2 ? 'black' : 'slip', joint, id, glazed: !joint };
    }
    const ti = Math.min(3, Math.floor((lu - s / 2) / s)), tj = Math.min(3, Math.floor((lv - s / 2) / s));
    const fu = (lu - s / 2) / s - ti, fv = (lv - s / 2) / s - tj, id = (pu * 31 + pv) * 64 + ti * 4 + tj;
    if (fu < J || fu > 1 - J || fv < J || fv > 1 - J) return { mat: 'mortar', joint: true, id };
    const d = designs[(((pu % 2) + 2) % 2) * 2 + (((pv % 2) + 2) % 2)], D = DESIGNS[d.name];
    const X = D.n === 2 ? (ti % 2) + fu - 1 : (ti + fu - 2) / 2, Y = D.n === 2 ? (tj % 2) + fv - 1 : (tj + fv - 2) / 2;
    const inlay = D.f(X, Y) !== !!d.inv;
    return { mat: inlay ? 'slip' : 'red', id, fu, fv, glazed: true, inlay };
  };
}

// Cistercian tile mosaic: a great roundel of curved tiles in a diamond-set panel;
// the corners between the diamonds chequered in small squares. Covers 8u.
function cistercian(seed, w){
  const h = w / 2;
  const RINGS = [   // [inner, outer, segments, colouring] in the panel's half-width; outermost first
    [0.62, 0.66, 40, () => 'black'],
    [0.52, 0.62, 28, s => s % 2 ? 'slip' : 'black'],
    [0.48, 0.52, 28, () => 'slip'],
    [0.40, 0.48, 16, s => s % 2 ? 'slip' : 'green'],
    [0.32, 0.40, 16, s => s % 2 ? 'green' : 'slip'],
    [0.28, 0.32, 16, () => 'black'],
  ];
  return (x, y) => {
    const X = (x + 0.5 - h) / h, Y = (y + 0.5 - h) / h, r = Math.hypot(X, Y), th = Math.atan2(Y, X), dm = Math.abs(X) + Math.abs(Y), px = 1 / h;
    if (dm > 1.12){
      // the chequer, in squares of 8px set square to the walls
      const cx = Math.floor(x / 8), cy = Math.floor(y / 8), lx = x % 8, ly = y % 8;
      if (lx === 0 || ly === 0) return { mat: 'mortar', joint: true, id: cx * 97 + cy };
      return { mat: (cx + cy) % 2 ? 'slip' : 'black', id: cx * 97 + cy, glazed: true };
    }
    if (dm > 1.0){
      // the border round each diamond: a dark strip and a yellow one, in short lengths
      const along = Math.floor((X - Y) * h / 10), f = fract((X - Y) * h / 10), dark = dm < 1.07;
      if (Math.abs(dm - 1.07) < px * 1.2 || dm < 1.0 + px * 1.4 || f < 0.06) return { mat: 'mortar', joint: true, id: along };
      return { mat: dark ? 'black' : 'slip', id: along * 2 + (dark ? 0 : 1) + 5000, glazed: true };
    }
    if (r >= 0.66){
      // inside the diamond, round the roundel: small circles, yellow and green, in black
      const S = 0.1, gx = Math.round(X / S), gy = Math.round(Y / S), dc = Math.hypot(X - gx * S, Y - gy * S);
      if (Math.abs(dc - 0.036) < px * 1.1 || r < 0.66 + px * 1.4) return { mat: 'mortar', joint: true, id: gx * 41 + gy };
      return dc < 0.036 ? { mat: (gx + gy) % 2 ? 'slip' : 'green', id: gx * 41 + gy + 9000, glazed: true } : { mat: 'black', id: 77, glazed: true };
    }
    for (const [a, b, n, col] of RINGS){
      if (r < a || r >= b) continue;
      const sg = fract(th / (Math.PI * 2) * n + (n === 28 ? 0.5 : 0)), si = Math.floor(fract(th / (Math.PI * 2)) * n);
      if (r - a < px * 1.2 || sg * r * Math.PI * 2 / n < px * 1.2) return { mat: 'mortar', joint: true, id: si };
      return { mat: col(si), id: Math.round(a * 100) * 100 + si, glazed: true };
    }
    // the middle: an eight-pointed star of yellow in black, a boss of green
    const star = r < 0.26 * (0.55 + 0.45 * Math.pow(Math.abs(Math.cos(4 * th)), 3));
    if (r < 0.05) return { mat: 'green', id: 1, glazed: true };
    if (r < 0.05 + px * 1.2) return { mat: 'mortar', joint: true, id: 1 };
    return { mat: star ? 'slip' : 'black', id: star ? 2 + Math.floor(fract((th + Math.PI / 8) / (Math.PI * 2)) * 8) : 20 + Math.floor(fract(th / (Math.PI * 2)) * 8), glazed: true };
  };
}

// ---- marble -------------------------------------------------------------------------------
// A marble's colour at a pixel (veins wander through turbulence and still tile); `ph`
// shifts the veins, so neighbouring pieces differ
function marbles(seed, w){
  const nT = fbm(seed + 1, w, 4, 3), nT2 = fbm(seed + 2, w, 3, 2), P = Math.round(w / 3), nS = tileNoise(seed + 5, P);
  return (name, x, y, ph = 0) => {
    const m = MARBLE[name];
    if (!m) return name === 'gold' ? [214, 172, 80] : [72, 66, 56];
    let c = m.base.slice();
    if (m.vein){
      const t = Math.abs(Math.sin(Math.PI * 2 * (x / w * m.f[0] + y / w * m.f[1]) + nT(x, y) * m.amp + ph)), v = 1 - smooth(0, m.wide || 0.12, t), cloud = (nT2(x + ph * 13, y) - 0.5) * 0.18;
      c = c.map((b, q) => (b + (m.vein[q] - b) * v * 0.85) * (1 + cloud));
    }
    if (m.speck && (nS(x / w * P + ph * 7, y / w * P) > 0.84 || hash(x, y, seed) < 0.012)) c = m.speck.slice();
    return c;
  };
}

// The fields: small pieces in a pattern, at a pixel. t is the piece's size in px;
// cols the marbles it's cut from. → [marble, grout?, piece id]
const G = 0.6;    // half a grout line, px
const BIG = 1e9;  // piece ids from here up are bands and discs, which aren't lost like tesserae
const FIELDS = {
  // equilateral triangles in rows, pointing up and down by turns
  tri(x, y, t, [A, B, C]){
    const rh = t * R3 / 2, row = Math.floor(y / rh), fy = y / rh - row, u = x / t + (row % 2) / 2, ix = Math.floor(u), fx = u - ix;
    const up = fy > Math.abs(2 * fx - 1), id = up ? ix * 2 : fx < 0.5 ? ix * 2 - 1 : ix * 2 + 1;
    const d = Math.min(fy, 1 - fy) * rh, ds = Math.abs(fy - Math.abs(2 * fx - 1)) * rh / 2.2;
    return [up ? A : row % 3 === 2 && C ? C : B, d < G || ds < G, row * 1000 + id];
  },
  // hexagons, each cut into three rhombi: tumbling blocks, light on top
  cubes(x, y, t, [A, B, C], ty = t){
    const X = x / t, Y = y / ty;
    const q = (R3 / 3 * X - Y / 3), r = 2 / 3 * Y;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dz > dy) rz = -rx - ry;
    const cx = R3 * (rx + rz / 2), cy = 1.5 * rz, ox = X - cx, oy = Y - cy;
    const hd = Math.max(Math.abs(ox), Math.abs(ox / 2 + oy * R3 / 2), Math.abs(ox / 2 - oy * R3 / 2));
    const sec = Math.floor(((Math.atan2(oy, ox) * 180 / Math.PI - 90 + 720) % 360) / 120);
    const toLine = a => { const rad = a * Math.PI / 180; return Math.abs(ox * Math.sin(rad) - oy * Math.cos(rad)); };
    const onSpoke = [90, 210, 330].some(a => { const rad = a * Math.PI / 180; return ox * Math.cos(rad) + oy * Math.sin(rad) > 0 && toLine(a) * t < G; });
    return [[B, A, C][sec], (R3 / 2 - hd) * t < G || onSpoke, (rx * 131 + rz) * 3 + sec];
  },
  // eight-point stars (a square and the same turned an eighth) in a white ground, a small square in each
  star(x, y, t, [A, B, C]){
    const S = t * 4, i = Math.floor(x / S), j = Math.floor(y / S), ox = x - (i + 0.5) * S, oy = y - (j + 0.5) * S, a = S * 0.27;
    const sqd = Math.max(Math.abs(ox), Math.abs(oy)), rot = (Math.abs(ox) + Math.abs(oy)) / Math.SQRT2, inS = sqd < a || rot < a;
    const core = Math.max(Math.abs(ox), Math.abs(oy)) < a * 0.38;
    const edge = Math.abs(Math.min(sqd, rot) - a) < G || Math.abs(Math.max(Math.abs(ox), Math.abs(oy)) - a * 0.38) < G;
    const cx = Math.abs(fract(x / S) - 0.5) * S, cy = Math.abs(fract(y / S) - 0.5) * S, lz = (S / 2 - cx) + (S / 2 - cy) < S * 0.22;
    if (lz) return [C, Math.abs((S / 2 - cx) + (S / 2 - cy) - S * 0.22) < G, 7e5 + Math.round(x / S) * 300 + Math.round(y / S)];
    return [core ? C : inS ? ((i + j) % 2 ? A : B) : 'white', edge, (i * 300 + j) * 3 + (core ? 2 : inS ? 1 : 0)];
  },
  // squares set on the point, each holding a smaller square of another stone
  lozenge(x, y, t, [A, B, C]){
    const S = t * 2.5, U = (x + y) / S, V = (x - y) / S, i = Math.floor(U), j = Math.floor(V), fu = U - i, fv = V - j;
    const inner = Math.max(Math.abs(fu - 0.5), Math.abs(fv - 0.5)) < 0.22, sd = S / Math.SQRT2;
    const g = Math.min(fu, 1 - fu, fv, 1 - fv) * sd < G || Math.abs(Math.max(Math.abs(fu - 0.5), Math.abs(fv - 0.5)) - 0.22) * sd < G;
    return [inner ? C : (i + j) % 2 ? A : B, g, (i * 400 + j) * 2 + (inner ? 1 : 0)];
  },
  // chevrons: zigzag bands of three stones, each band cut into short lengths
  chevron(x, y, t, [A, B, C]){
    const zz = Math.abs(fract(x / (t * 4)) - 0.5) * t * 4, b = (y + zz) / t, band = Math.floor(b), piece = Math.floor(x / (t * 2));
    return [[A, B, C][((band % 3) + 3) % 3] || 'white', (b - band) * t < G * 1.2 || (1 - (b - band)) * t < G * 0.8 || fract(x / (t * 2)) * t * 2 < G, band * 500 + piece];
  },
  // Sierpinski triangles: big triangles in rows, each a triangle of triangles three deep
  sierp(x, y, t, [A, B, C]){
    const T = t * 8, rh = T * R3 / 2, row = Math.floor(y / rh), fy = 1 - (y / rh - row), u = x / T + (row % 2) / 2, ix = Math.floor(u), fx = u - ix;
    const up = fy < 1 - Math.abs(2 * fx - 1);
    // barycentric in the big triangle (an up one, or a down one flipped to look like it)
    let a, b; if (up){ a = fy; b = fx - fy / 2; } else { a = 1 - fy; b = (fx < 0.5 ? fx + 0.5 : fx - 0.5) - a / 2; }
    const N = 8, ia = Math.floor(a * N), ib = Math.floor(b * N), fa = a * N - ia, fb = b * N - ib, small = fa + fb < 1;
    const on = small && (ia & ib) === 0 && ia + ib < N;
    const g = Math.min(fa, fb, Math.abs(1 - fa - fb)) * (T / N) * 0.8 < G;
    return [on ? (up ? A : B) : up ? 'white' : C || 'white', g, row * 1e5 + ix * 300 + ia * 9 + ib * 2 + (small ? 1 : 0) + (up ? 0 : 5e4)];
  },
};
export const FIELD_NAMES = Object.keys(FIELDS);

// a roundel's toothed border: a ring of triangles, points in and out by turns
function teeth(r, th, r0, r1, n, [A, B]){
  const f = fract(th / (Math.PI * 2) * n), k = (r - r0) / (r1 - r0), inA = Math.abs(2 * f - 1) > k;
  return [inA ? A : B, null, Math.floor(fract(th / (Math.PI * 2)) * n) * 2 + (inA ? 0 : 1)];
}

// Cosmati compositions, in a module of w px (12u) centred on the texture.
// Each returns a sampler (x, y) → [marble, grout?, piece id]
function cosmatiOf(layout, seed, w){
  const rr = mulberry32(seed), h = w / 2, px = 1 / h;
  const pickF = () => FIELD_NAMES[(rr() * FIELD_NAMES.length) | 0];
  const PAL = [['porphyry', 'white', 'serpentine'], ['serpentine', 'giallo', 'porphyry'], ['nero', 'white', 'porphyry'], ['porphyry', 'giallo', 'white'], ['serpentine', 'white', 'giallo'], ['giallo', 'nero', 'porphyry']];
  const pal = () => PAL[(rr() * PAL.length) | 0];
  const field = (name, cols, t = 6) => (x, y) => FIELDS[name](x, y, t, cols);
  // a white band: radial joints every ~36px round a ring
  const bandRing = (r, th, r0, r1, id) => { const n = Math.max(8, Math.round(Math.PI * (r0 + r1) * h / 36)), f = fract(th / (Math.PI * 2) * n);
    return ['white', (r - r0) * h < G || (r1 - r) * h < G || f * Math.PI * 2 * r * h / n < G, BIG + id + Math.floor(fract(th / (Math.PI * 2)) * n)]; };
  // the frame round the module: a white fillet, a strip of triangles, white, then the neighbour's
  const frameF = field('tri', ['porphyry', 'white'], 6);
  const frame = (x, y, X, Y) => {
    const e = Math.max(Math.abs(X), Math.abs(Y));
    if (e < 0.885) return null;
    if (e < 0.91 || e > 0.975) return ['white', Math.abs(e - 0.885) * h < G || Math.abs(e - 0.91) * h < G || Math.abs(e - 0.975) * h < G, BIG + (Math.abs(X) > Math.abs(Y) ? 1 : 2) + (e > 0.975 ? 4 : 0)];
    return frameF(x, y);
  };
  // a roundel at (cx, cy) with outer band [b0, b1] and teeth inside: null if outside it
  const roundel = (X, Y, cx, cy, b0, b1, disc, tc, id) => {
    const dx = X - cx, dy = Y - cy, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx), t0 = b0 - 0.065;
    if (r >= b1) return null;
    if (r >= b0) return { band: true, v: bandRing(r, th, b0, b1, id * 1000), r };
    if (r >= t0) return { v: teeth(r, th, t0, b0, Math.round(Math.PI * 2 * b0 * h / 8), tc), r, joint: (r - t0) * h < G || (b0 - r) * h < G };
    // the disc, sawn from a column: one piece, perhaps cracked across
    const crack = Math.abs(dx * Math.cos(id * 1.7) + dy * Math.sin(id * 1.7) - t0 * 0.3 * Math.sin(dy * 9 + id)) * h < 0.5 && id % 3 === 0;
    return { v: [disc, (t0 - r) * h < G || crack, BIG + id * 7], r };
  };
  const pick = (...os) => { let over = null; for (const o of os) if (o && (!over || o.band && !over.band || o.band === over.band && o.top)) over = o; return over; };

  if (layout === 'quincunx'){
    const P = pal(), FA = field(pickF(), pal()), FB = field(pickF(), pal()), FC = field(pickF(), pal(), 5), TC = [P[1], P[0]], TK = ['white', P[2]];
    const [cDisc, kDisc] = rr() < 0.5 ? ['porphyry', 'serpentine'] : ['serpentine', 'porphyry'];
    return (x, y) => {
      const X = (x + 0.5 - h) / h, Y = (y + 0.5 - h) / h, fr = frame(x, y, X, Y);
      if (fr) return fr;
      const c = roundel(X, Y, 0, 0, 0.38, 0.44, cDisc, TC, 1);
      const qx = X < 0 ? -1 : 1, qy = Y < 0 ? -1 : 1, quad = (qx < 0 ? 0 : 1) + (qy < 0 ? 0 : 2);
      const k = roundel(X, Y, qx * 0.5, qy * 0.5, 0.29, 0.35, kDisc, TK, 2 + quad);
      if (c && k && c.band && k.band){
        // where the bands cross: over and under by turns, round the ring
        const side = (X * qy - Y * qx) > 0, top = side !== (quad === 1 || quad === 2);
        (top ? c : k).top = true;
      }
      const o = pick(c, k);
      if (o) return o.joint ? [o.v[0], true, o.v[2]] : o.v;
      // the fields: one pattern above and below the great roundel, another either side, a third in the corners
      if (Math.abs(X) + Math.abs(Y) > 1.35) return FC(x, y);
      return Math.abs(X) > Math.abs(Y) ? FA(x, y) : FB(x, y);
    };
  }
  if (layout === 'rotae'){
    // roundels at a half-module pitch down the middle (so the chain runs on through the next module)
    const FS = [0, 1, 2, 3].map(() => field(pickF(), pal())), FT = field('tri', pal(), 5), TC = ['white', 'porphyry'];
    return (x, y) => {
      const X = (x + 0.5 - h) / h, Y = (y + 0.5 - h) / h, ax = Math.abs(X);
      if (ax > 0.885){ const e = ax; return e < 0.91 || e > 0.975 ? ['white', Math.abs(e - 0.885) * h < G || Math.abs(e - 0.91) * h < G || Math.abs(e - 0.975) * h < G, BIG] : frameF(x, y); }
      if (ax < 0.62){
        const ks = [-1, 0, 1].map(k => roundel(X, Y, 0, k, 0.5, 0.58, k === 0 ? 'porphyry' : 'serpentine', TC, 10 + k));
        const [a, b, c] = ks;
        // neighbouring rings cross either side of the axis; over and under by turns
        for (const [p, q, n] of [[a, b, -1], [b, c, 0]]) if (p && q && p.band && q.band){ const left = X < 0; ((left !== (n === 0)) ? p : q).top = true; }
        const o = pick(a, b, c);
        if (o) return o.joint ? [o.v[0], true, o.v[2]] : o.v;
        return FT(x, y);
      }
      // the side panels: two a side in a module, each its own field, framed in white
      if (ax < 0.665) return ['white', Math.abs(ax - 0.62) * h < G || Math.abs(ax - 0.665) * h < G, BIG + 9];
      const ry = fract((Y + 1) / 1), band = Math.min(ry, 1 - ry) * h < 0.025 * h;
      if (band) return ['white', Math.abs(Math.min(ry, 1 - ry) * h - 0.025 * h) < G, BIG + 11];
      return FS[(X < 0 ? 0 : 2) + (ry < 0.5 ? 0 : 1)](x, y);
    };
  }
  // panels: a grid of 3×3 squares in white bands
  const F = Array.from({ length: 9 }, () => field(pickF(), pal())), FIN = Array.from({ length: 9 }, () => field(pickF(), pal(), 5));
  const P = pal();
  return (x, y) => {
    const X = (x + 0.5 - h) / h, Y = (y + 0.5 - h) / h, fr = frame(x, y, X, Y);
    if (fr) return fr;
    const c3 = 1.77 / 3, gi = Math.min(2, Math.floor((X + 0.885) / c3)), gj = Math.min(2, Math.floor((Y + 0.885) / c3));
    const lx = (X + 0.885) / c3 - gi - 0.5, ly = (Y + 0.885) / c3 - gj - 0.5, e = Math.max(Math.abs(lx), Math.abs(ly)), cell = gj * 3 + gi, ch = c3 * h;
    if (e > 0.45) return ['white', Math.abs(e - 0.45) * ch < G, BIG + 20 + cell];
    if (cell === 4){
      const o = roundel(lx * c3, ly * c3, 0, 0, 0.21, 0.255, P[0] === 'porphyry' ? 'serpentine' : 'porphyry', [P[1], P[0]], 40);
      if (o) return o.joint ? [o.v[0], true, o.v[2]] : o.v;
      return F[4](x, y);
    }
    if ((gi + gj) % 2 === 0){
      // the corners: a square on the point, banded in white, a field within and another without
      const d = Math.abs(lx) + Math.abs(ly);
      if (d < 0.38) return FIN[cell](x, y);
      if (d < 0.43) return ['white', Math.abs(d - 0.38) * ch / Math.SQRT2 < G || Math.abs(d - 0.43) * ch / Math.SQRT2 < G, BIG + 60 + cell];
    }
    return F[cell](x, y);
  };
}

// ---- bands and corners ---------------------------------------------------------------------
// A paved room is a field inside bands (under-view.js lays them): a border along the
// walls, a narrower band down each bay line, and a piece where two bands meet. In a
// band's texture x runs along it and the bottom row (texture v = 0) lies on its line:
// against the wall, or on the bay line, where the far side's band mirrors it. A
// corner's motif is centred in its square; a knot's is a quarter round the texture's
// origin, so the four round a bay-line crossing make one whole.
const across = (y, h) => 1 - (y + 0.5) / h;

// plain tiles, half a unit long: a dark row against the wall and a yellow row offset
// inside it; on a bay line, yellow either side of the line with dark beyond
function tileBand(line, w, h){
  const Lt = w / 4, b = 0.5;
  return (x, y) => {
    const d = across(y, h), row = d < b ? 0 : 1, off = row ? Lt / 2 : 0, xi = Math.floor((x + off) / Lt) % 4, fx = (x + off) % Lt;
    const joint = fx < 0.7 || Math.abs(d - b) * h < 0.7 || (line && d * h < 0.6);
    return { mat: joint ? 'mortar' : (row === 0) === !line ? 'black' : 'slip', joint, id: 300 + row * 10 + xi, glazed: !joint };
  };
}
// a corner: one encaustic tile with the rose on it; a knot: a quarter of the ring of fleurs
function tileCorner(knot, w, h){
  return (x, y) => {
    const X = (x + 0.5) / w, Y = across(y, h);
    if (Math.min(X, 1 - X, Y, 1 - Y) * w < 0.8) return { mat: 'mortar', joint: true, id: 400 };
    const inlay = knot ? DESIGNS.circle.f(X, Y) : DESIGNS.rose.f(2 * X - 1, 2 * Y - 1);
    return { mat: inlay ? 'slip' : 'red', id: 401, fu: X, fv: Y, glazed: true, inlay };
  };
}
// marble: against a wall, white, a strip of triangles, a white fillet; on a bay line,
// a porphyry fillet down the line in a white band
function cosBand(line, w, h){
  return (x, y) => {
    const d = across(y, h), seg = Math.floor(x / 32), fx = x % 32, jo = fx < G;
    if (line) return d < 0.14 ? ['porphyry', jo || Math.abs(d - 0.14) * h < G, BIG + 500 + seg] : ['white', jo || Math.abs(d - 0.14) * h < G, BIG + 510 + seg];
    if (d < 0.25 || d >= 0.8) return ['white', jo || Math.abs(d - 0.25) * h < G || Math.abs(d - 0.8) * h < G, BIG + 520 + seg + (d < 0.25 ? 0 : 4)];
    return FIELDS.tri(x, y, 8, ['porphyry', 'white', 'serpentine']);
  };
}
// a corner: a porphyry roundel ringed in teeth and white on serpentine; a knot: the
// same round the crossing, smaller, so the bands' white runs into its ring
function cosCorner(knot, w, h){
  return (x, y) => {
    const X = (x + 0.5) / w, Y = across(y, h), [cx, cy, sc] = knot ? [0, 0, 1] : [0.5, 0.5, 0.5];
    const r = Math.hypot(X - cx, Y - cy) / sc, th = Math.atan2(Y - cy, X - cx);
    if (r < 0.55) return ['porphyry', Math.abs(r - 0.55) * w * sc < G, BIG + 600];
    if (r < 0.7){ const v = teeth(r, th, 0.55, 0.7, 16, ['white', 'serpentine']); return [v[0], Math.abs(r - 0.7) * w * sc < G, v[2]]; }
    if (r < 0.88 || knot) return ['white', Math.abs(r - 0.88) * w * sc < G, BIG + 610];
    return ['serpentine', Math.min(X, 1 - X, Y, 1 - Y) * w < G, BIG + 620 + (X > 0.5 ? 1 : 0) + (Y > 0.5 ? 2 : 0)];
  };
}

// ---- the textures -------------------------------------------------------------------------
const SPEC = {
  encausticA: { w: 256, world: 6, ceramic: true, make: (s, w) => encaustic(s, [{ name: 'circle' }, { name: 'rose' }, { name: 'quatrefoil' }, { name: 'fleurs', inv: true }], w) },
  encausticB: { w: 256, world: 6, ceramic: true, make: (s, w) => encaustic(s, [{ name: 'rose', inv: true }, { name: 'arcs' }, { name: 'quatrefoil', inv: true }, { name: 'circle' }], w) },
  cistercian: { w: 256, world: 8, ceramic: true, make: cistercian },
  // 12 hexagons across and 14 rows down, so the lattice wraps (a hair squashed to fit)
  cubes: { w: 256, world: 8, make: (s, w) => (x, y) => FIELDS.cubes(x, y, w / (12 * R3), ['white', 'grey', 'nero'], w / (14 * 1.5)) },
  stars: { w: 256, world: 8, make: (s, w) => (x, y) => FIELDS.star(x, y, w / 16, ['porphyry', 'serpentine', 'giallo']) },
  quincunx: { w: 384, world: 12, make: (s, w) => cosmatiOf('quincunx', s, w) },
  rotae: { w: 384, world: 12, make: (s, w) => cosmatiOf('rotae', s, w) },
  panels: { w: 384, world: 12, make: (s, w) => cosmatiOf('panels', s, w) },
  // the bands and corners (world: u per texture along a band, or a corner's side)
  tileWall: { w: 64, h: 24, world: 2, ceramic: true, make: (s, w, h) => tileBand(false, w, h) },
  tileLine: { w: 64, h: 16, world: 2, ceramic: true, make: (s, w, h) => tileBand(true, w, h) },
  tileCorner: { w: 32, h: 32, world: 1, ceramic: true, make: (s, w, h) => tileCorner(false, w, h) },
  tileKnot: { w: 32, h: 32, world: 1, ceramic: true, make: (s, w, h) => tileCorner(true, w, h) },
  cosWall: { w: 64, h: 24, world: 2, make: (s, w, h) => cosBand(false, w, h) },
  cosLine: { w: 64, h: 16, world: 2, make: (s, w, h) => cosBand(true, w, h) },
  cosCorner: { w: 32, h: 32, world: 1, make: (s, w, h) => cosCorner(false, w, h) },
  cosKnot: { w: 32, h: 32, world: 1, make: (s, w, h) => cosCorner(true, w, h) },
};
export const PAVEMENTS = Object.keys(SPEC);

export function pavement(kind, seed = 61){
  const S = SPEC[kind], w = S.w, h = S.h || S.w, at = S.make(seed, w, h);
  const nW = fbm(seed + 3, w, 3, 3), nG = fbm(seed + 4, w, 12, 2), stone = S.ceramic ? null : marbles(seed, w);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const k = y * w + x, wear = smooth(0.48, 0.78, nW(x, y));   // where feet went most
    let c, hh, ro, me = 0;
    if (S.ceramic){
      const p = at(x, y), tr = hash(p.id, 7, seed), tk = 0.86 + tr * 0.24;
      if (p.joint){ c = CLAY.mortar; hh = 0.5; ro = 0.95; }
      else if (tr < 0.025){ c = CLAY.mortar.map(v => v * 0.7); hh = 0.42; ro = 1; }            // a tile lost, its bed showing
      else {
        // the glaze, mottled; worn through to the body where the traffic was, and the thin
        // inlay with it, so a worn tile's pattern goes faint and red
        const thru = wear * (0.7 + tr * 0.6), mott = (nG(x, y) - 0.5) * 0.16;
        let base = CLAY[p.mat];
        if (p.mat === 'slip' && p.inlay !== undefined && thru > 0.75) base = CLAY.body.map((v, q) => v + (CLAY.slip[q] - v) * 0.35);
        c = base.map(v => v * tk * (1 + mott));
        if (thru > 0.3) c = c.map((v, q) => v + (CLAY.body[q] * 0.9 - v) * (thru - 0.3) * 0.5);
        hh = 0.7 + (tr - 0.5) * 0.08 + (p.fu !== undefined ? (p.fu - 0.5) * (hash(p.id, 3, seed) - 0.5) * 0.06 : 0) - wear * 0.05;
        ro = 0.3 + thru * 0.55;
        if (tr > 0.93 && p.fu !== undefined && Math.abs(p.fu * 0.7 + p.fv * 0.4 - 0.55 - (tr - 0.93) * 3) < 0.025){ c = c.map(v => v * 0.45); hh -= 0.1; }   // cracked
      }
    } else {
      const [name, grout, id] = at(x, y), tr = hash(id | 0, 11, seed);
      if (grout){ c = [76, 70, 60]; hh = 0.55; ro = 0.7; }
      else if (tr < 0.012 && id < BIG){ c = [58, 52, 44]; hh = 0.45; ro = 0.95; }      // a tessera lost
      else {
        const gold = name === 'gold' || (name === 'giallo' && tr > 0.9);
        c = gold ? [214, 172, 80].map(v => v * (0.9 + tr * 0.1)) : stone(name, x, y, (id % 97) * 0.37);
        if (!gold) c = c.map(v => v * (0.94 + tr * 0.1));
        hh = 0.68 + tr * 0.05; ro = gold ? 0.35 : 0.2 + wear * 0.38; me = gold ? 1 : 0;
      }
      c = c.map(v => v * (1 - wear * 0.08));
    }
    rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2]; H[k] = hh; rough[k] = ro; metal[k] = me;
  }
  const t = pbr(w, h, rgb, H, 2, rough, metal);
  t.world = S.world;
  return t;
}
