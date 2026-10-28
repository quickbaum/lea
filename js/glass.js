// Windows without daylight: underground, glass that glows would say there was a
// sky behind the wall ("it makes it look like we are not underground"). So
// the tracery's openings are inlaid instead, and what they're inlaid with rises
// with the floors' grandeur (the tier):
//   lead    the upper floors: matte quarries of slate, sandstone, ochre and
//           brick, in lead cames; the tracery only two deep
//   marble  the middle floors: polished coloured marbles (porphyry, serpentine,
//           giallo antico, white and black), in bronze; three deep
//   gems    the deepest: domed cabochons of lapis, garnet, emerald, amethyst,
//           carnelian, topaz and pearl, set in gold; four deep
// Nothing glows; each shines only where a flame catches it (a roughness/metal
// map, for a standard material). The tracery is fractal, as Gothic tracery
// really is: a lancet holds two lancets and an oculus, each of those lancets two
// more and an oculus, and an oculus is a rosette of foils round a smaller one; a
// rose window is rings of such rosettes.
//
// Outside the window's outline the panel is cut away (an alpha map), so no flat
// slab of stone frames it: the view sets voussoirs round the outline instead,
// as round its arches (outlines() and outlinePath() give it the shape).
//
//   glass(kind, seed, { w, h, tier })   kind: lancet | clerestory | rose | triforium
//   → { map, normalMap, orm, alpha, glow }  (orm: G roughness, B metalness; glow: the glass alone,
//     for lighting from behind; the triforium is plain stone). gilt: the tracery in gold, not stone
//   jewels(kind, seed)                  kind: strip (an archivolt's band) | panel (an altar's frontal)
//   → { map, normalMap, orm }           gold, set with cabochons and pearls

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { texturesFrom } from './stone-tex.js';

const STONE = 1, BAR = 0.92, GEM = 0.1, SETTING = 0.32;
// pointed (equilateral) arch: opening half-width a, centre cx, springing sy, Y up
const inArch = (X, Y, cx, a, sy) => a > 0 && Math.abs(X - cx) < a && (Y < sy || (Math.hypot(X - (cx - a), Y - sy) < 2 * a && Math.hypot(X - (cx + a), Y - sy) < 2 * a));
const inCircle = (X, Y, cx, cy, r) => Math.hypot(X - cx, Y - cy) < r;
// the gems, deep-coloured as polished stones are: lapis and garnet above all
const GEMS = [[26, 44, 120], [26, 44, 120], [34, 62, 150], [112, 16, 30], [112, 16, 30], [20, 92, 56], [78, 34, 104], [168, 70, 30], [196, 146, 46], [214, 206, 186]];
const GOLD = [200, 156, 70], PEARL = [214, 206, 186];
const TIERS = {
  lead: { P: 8, depth: 2, mix: 0.5, came: [84, 86, 90], cameRough: 0.6, cameMetal: 0.6, rough: 0.85, dome: false,
    palette: [[62, 66, 72], [62, 66, 72], [78, 80, 84], [150, 128, 96], [140, 104, 52], [128, 70, 48], [88, 98, 80], [176, 170, 156]] },
  marble: { P: 10, depth: 3, mix: 0.35, came: [150, 106, 54], cameRough: 0.45, cameMetal: 1, rough: 0.25, dome: false,
    palette: [[110, 36, 40], [110, 36, 40], [44, 82, 58], [44, 82, 58], [196, 160, 90], [214, 208, 196], [40, 38, 40], [190, 170, 170]] },
  gems: { P: 5, depth: 4, mix: 0.25, came: GOLD, cameRough: 0.35, cameMetal: 1, rough: 0.12, dome: true, palette: GEMS },
};
const hash = n => { let x = (n * 2654435761) >>> 0; x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0; return ((x ^ (x >>> 13)) >>> 0) / 4294967296; };

// The window's outline(s), in the panel's units (X 0..k, Y 0..1, Y up, k its
// width over its height): one arch, a circle, or the triforium's four arches.
// Each leaves a margin inside the panel for the voussoirs round it.
export function outlines(kind, k){
  if (kind === 'rose') return [{ type: 'circle', cx: k / 2, cy: 0.5, r: 0.42, ring: 12 }];
  if (kind === 'clerestory') return [{ type: 'arch', cx: k / 2, a: k * 0.38, sy: 0.48 }];
  if (kind === 'triforium'){ const cw = k / 4; return [0, 1, 2, 3].map(i => ({ type: 'arch', cx: (i + 0.5) * cw, a: cw * 0.38, sy: 0.45 })); }
  return [{ type: 'arch', cx: k / 2, a: k * 0.38, sy: 0.6 }];
}
// An outline as a path of [X, Y]: an arch from the foot of its left jamb, up and
// over its point, down to the foot of its right; a circle all the way round.
export function outlinePath(s, n = 12){
  const out = [];
  if (s.type === 'circle'){
    for (let q = 0; q <= 4 * n; q++){ const t = Math.PI - q / (4 * n) * Math.PI * 2; out.push([s.cx + Math.cos(t) * s.r, s.cy + Math.sin(t) * s.r]); }
    return out;
  }
  const { cx, a, sy } = s;
  out.push([cx - a, 0]);
  for (let q = 0; q <= n; q++){ const t = Math.PI - q / n * Math.PI / 3; out.push([cx + a + Math.cos(t) * 2 * a, sy + Math.sin(t) * 2 * a]); }   // the left side: an arc round the far springing
  for (let q = 1; q <= n; q++){ const t = Math.PI / 3 - q / n * Math.PI / 3; out.push([cx - a + Math.cos(t) * 2 * a, sy + Math.sin(t) * 2 * a]); }
  out.push([cx + a, 0]);
  return out;
}

// What a point is: descend the tracery until it lands in a leaf opening (glass,
// numbered so each pane gets its own colours) or on stone (a bar round an
// opening). A bar is a fixed share of the opening it frames, so the tracery stays
// in proportion all the way down; it stops dividing when an opening would be too
// small to glaze (`minSize`, in the panel's units).
const size = s => s.type === 'arch' ? s.a : s.r;
function classify(X, Y, shape, depth, minSize, id){
  if (depth === 0 || size(shape) * 0.3 < minSize) return { glass: true, id };
  const kids = children(shape);
  for (let q = 0; q < kids.length; q++){
    const c = kids[q];
    if (inside(X, Y, c, 0)){
      if (!inside(X, Y, c, size(c) * 0.11)) return { glass: false, h: BAR };       // the moulded bar round it
      return classify(X, Y, c, depth - 1, minSize, id * 13 + q + 1);
    }
  }
  return { glass: true, id: id * 13 + 11 };                                       // the pierced spandrel between them
}
// an opening, `pad` in from its edge
function inside(X, Y, s, pad){
  if (s.type === 'arch') return inArch(X, Y, s.cx, s.a - pad, s.sy);
  return inCircle(X, Y, s.cx, s.cy, s.r - pad);
}
// the openings inside an opening: a lancet → two lancets and an oculus in its head;
// an oculus → a ring of foils round a centre
function children(s){
  if (s.type === 'arch'){
    const a = s.a * 0.44, sy = s.sy - s.a * 0.15, head = s.sy + s.a * 0.72;
    return [{ type: 'arch', cx: s.cx - s.a * 0.5, a, sy }, { type: 'arch', cx: s.cx + s.a * 0.5, a, sy }, { type: 'circle', cx: s.cx, cy: head, r: s.a * 0.4 }];
  }
  const n = s.ring || 6, out = [{ type: 'circle', cx: s.cx, cy: s.cy, r: s.r * 0.3, ring: 6 }];
  for (let k = 0; k < n; k++){ const t = k / n * Math.PI * 2 + (s.rot || 0); out.push({ type: 'circle', cx: s.cx + Math.cos(t) * s.r * 0.62, cy: s.cy + Math.sin(t) * s.r * 0.62, r: s.r * 0.3, ring: 6, rot: t }); }
  return out;
}

// occlusion, roughness, metal (glTF's channels, which three reads); and an alpha map (green)
function canvasTex(w, h, fill){
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), im = g.createImageData(w, h);
  for (let k = 0; k < w * h; k++) fill(im.data, k * 4, k);
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const ormTex = (w, h, rough, metal) => canvasTex(w, h, (d, o, k) => { d[o] = 255; d[o + 1] = rough[k] * 255; d[o + 2] = metal[k] * 255; d[o + 3] = 255; });

// A polished cabochon at (dx, dy) from its centre, radius rad: domed, a highlight
// up and to the left of its crown, darker toward its foot. Returns false off it.
function cabochon(rgb, H, rough, o, dx, dy, rad, base, v = 1){
  const d = Math.hypot(dx, dy) / rad; if (d >= 1) return false;
  const dome = Math.sqrt(1 - d * d), hl = Math.max(0, 1 - Math.hypot(dx / rad + 0.35, dy / rad + 0.35) / 0.45);
  for (let q = 0; q < 3; q++) rgb[o * 3 + q] = base[q] * v * (0.6 + 0.4 * dome) + hl * 80;
  H[o] = SETTING + 0.25 * dome; rough[o] = 0.12;
  return true;
}

export function glass(kind, seed = 1, { w = 96, h = 192, tier = 'gems', gilt = false } = {}){
  const T = TIERS[tier] || TIERS.gems, r = mulberry32(seed), k = w / h;   // coordinates: X 0..k, Y 0..1 (Y up)
  const shapes = outlines(kind, k);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h).fill(0.9), metal = new Float32Array(w * h), alpha = new Uint8Array(w * h);
  const lit = new Uint8Array(w * h);                                  // which pixels are glass (the glow map, for a window lit from behind)
  // a mosaic in every pane: jittered points, the nearest one's piece
  const P = T.P, cols = Math.ceil(w / P) + 2, rows = Math.ceil(h / P) + 2, pts = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) pts.push([(i - 1 + 0.2 + r() * 0.6) * P, (j - 1 + 0.2 + r() * 0.6) * P]);
  const piece = (x, y) => {
    const gi = Math.floor(x / P) + 1, gj = Math.floor(y / P) + 1; let b1 = Infinity, b2 = Infinity, id = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){ const q = (gj + dj) * cols + gi + di, p = pts[q]; if (!p) continue; const d = Math.hypot(p[0] - x, p[1] - y); if (d < b1){ b2 = b1; b1 = d; id = q; } else if (d < b2) b2 = d; }
    const p = pts[id];
    return { id, edge: b2 - b1 < 0.9, inner: (b2 - b1) / 2, dx: x - p[0], dy: y - p[1] };
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const X = (x + 0.5) / h, Y = 1 - (y + 0.5) / h, o = y * w + x;
    const shape = shapes.find(s => inside(X, Y, s, 0));
    if (!shape) continue;                                            // outside: cut away, the voussoirs go here
    alpha[o] = 255;
    let c;
    if (kind === 'triforium'){
      // four arches, each traceried two deep, cut blind into the stone
      c = inside(X, Y, shape, 0.035) ? classify(X, Y, shape, 2, 5 / h, shapes.indexOf(shape) + 1) : { glass: false, h: BAR };
      if (c.glass){ H[o] = 0.12; const t = 0.42 + hash(c.id) * 0.1; rgb[o * 3] = 138 * t; rgb[o * 3 + 1] = 130 * t; rgb[o * 3 + 2] = 116 * t; continue; }   // a recess, not glass
    } else if (!inside(X, Y, shape, 0.03)) c = { glass: false, h: STONE };
    else c = classify(X, Y, shape, T.depth, 3 / h, 1);              // nothing under about 10 px across gets divided again
    if (!c.glass){
      H[o] = c.h; const t = (0.62 + 0.38 * c.h) * (0.92 + r() * 0.08);
      if (gilt){ for (let q = 0; q < 3; q++) rgb[o * 3 + q] = GOLD[q] * (0.75 + 0.3 * t); rough[o] = 0.3; metal[o] = 1; }   // the tracery itself in gold
      else { rgb[o * 3] = 140 * t; rgb[o * 3 + 1] = 132 * t; rgb[o * 3 + 2] = 118 * t; }
      continue;
    }
    // a piece of the pane's own kind, in its came or setting
    const pc = piece(x, y);
    if (pc.edge){ H[o] = SETTING; for (let q = 0; q < 3; q++) rgb[o * 3 + q] = T.came[q]; rough[o] = T.cameRough; metal[o] = T.cameMetal; continue; }
    lit[o] = 1;
    const base = T.palette[Math.floor(hash(c.id * 7 + (hash(pc.id) < 1 - T.mix ? 0 : pc.id)) * T.palette.length)];
    const v = 0.8 + hash(pc.id * 31 + c.id) * 0.3;
    rough[o] = T.rough;
    if (T.dome){
      const dome = Math.sqrt(Math.min(1, pc.inner / 2.2)), hl = Math.max(0, 1 - Math.hypot(pc.dx + 0.9, pc.dy + 0.9) / 1.4), shade = 0.6 + 0.4 * dome;
      H[o] = GEM + 0.22 * dome;
      for (let q = 0; q < 3; q++) rgb[o * 3 + q] = base[q] * v * shade + hl * 70;
    } else {
      // flat: a little grain in the stone, veins in the marble
      const grain = tier === 'marble' ? 0.88 + 0.16 * Math.abs(Math.sin((x * 0.9 + y * 0.4) * 0.7 + hash(pc.id) * 9 + Math.sin(y * 0.5) * 1.6)) : 0.9 + r() * 0.12;
      H[o] = GEM + 0.14;
      for (let q = 0; q < 3; q++) rgb[o * 3 + q] = base[q] * v * grain;
    }
  }
  const t = texturesFrom(w, h, rgb, H, 5);
  t.orm = ormTex(w, h, rough, metal);
  t.alpha = canvasTex(w, h, (d, o, q) => { d[o] = d[o + 1] = d[o + 2] = alpha[q]; d[o + 3] = 255; });
  t.glow = canvasTex(w, h, (d, o, q) => { for (let i = 0; i < 3; i++) d[o + i] = lit[q] ? Math.min(255, rgb[q * 3 + i]) : 0; d[o + 3] = 255; });
  t.glow.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Gold set with stones, for the deepest floors' other places. A strip: a band of
// cabochons and pearls by turns between beaded rims, to run round an archivolt
// (its u along the band). A panel: an altar's frontal, as the golden altar of
// Sant'Ambrogio's or the Pala d'Oro: a border of stones and pearls round a grid
// of raised gold frames, a big stone in each and a pearl at each corner.
export function jewels(kind, seed = 1){
  const [w, h] = kind === 'strip' ? [128, 16] : [128, 128], r = mulberry32(seed);
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  const gem = n => GEMS[Math.floor(hash(n * 17 + seed) * (GEMS.length - 1))];          // any but the pearl
  // the frontal's border: eleven stone centres a side, round the middle of a 12 px band
  const ring = [], step = (w - 12) / 10;
  for (let q = 0; q <= 10; q++) ring.push([6 + q * step, 6, q % 2], [6 + q * step, h - 6, q % 2]);
  for (let q = 1; q < 10; q++) ring.push([6, 6 + q * step, q % 2], [w - 6, 6 + q * step, q % 2]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const o = y * w + x, cx = x + 0.5, cy = y + 0.5;
    let set = false;
    if (kind === 'strip'){
      const cell = Math.floor(x / 16), dx = cx - (cell * 16 + 8), dy = cy - 8;
      set = cell % 2 === 0 ? cabochon(rgb, H, rough, o, dx, dy, 5.5, gem(cell)) : cabochon(rgb, H, rough, o, dx, dy, 3, PEARL);
      if (!set && (y < 2 || y >= h - 2)){ H[o] = 0.45 + 0.1 * Math.cos(x * 1.6); }    // the beaded rims
      else if (!set) H[o] = 0.2;
    } else {
      const B = 12;
      if (x < B || y < B || x >= w - B || y >= h - B){
        // the border: stones and pearls by turns all round
        let i = 0, best = Infinity;
        ring.forEach(([px, py], q) => { const d = Math.hypot(cx - px, cy - py); if (d < best){ best = d; i = q; } });
        const [px, py, pearl] = ring[i];
        set = pearl ? cabochon(rgb, H, rough, o, cx - px, cy - py, 2.6, PEARL) : cabochon(rgb, H, rough, o, cx - px, cy - py, 4.6, gem(i + 40));
        if (!set) H[o] = 0.25;
      } else {
        const S = (w - 2 * B) / 3, fx = (cx - B) / S, fy = (cy - B) / S, i = Math.floor(fx), j = Math.floor(fy), u = (fx - i) * S, v = (fy - j) * S;
        const frame = u < 3 || v < 3 || u > S - 3 || v > S - 3;
        if (frame) H[o] = 0.5;                                            // the raised frame round each field
        else {
          set = cabochon(rgb, H, rough, o, u - S / 2, v - S / 2, 9, gem(j * 3 + i));
          for (const [px, py] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8]]) set = set || cabochon(rgb, H, rough, o, u - px, v - py, 3, PEARL);
          if (!set) H[o] = 0.15 + 0.06 * Math.sin(u * 0.8) * Math.sin(v * 0.8);   // chased gold between
        }
      }
    }
    if (set) continue;
    const t = 0.88 + r() * 0.12 + (H[o] - 0.3) * 0.4;
    for (let q = 0; q < 3; q++) rgb[o * 3 + q] = GOLD[q] * t;
    rough[o] = 0.35; metal[o] = 1;
  }
  const t = texturesFrom(w, h, rgb, H, 4);
  t.orm = ormTex(w, h, rough, metal);
  return t;
}
