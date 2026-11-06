// A croft's plants and what stands round it (docs/farming.md). Each crop grows its own way: beans
// climb poles, peas scramble up twiggy sticks, cabbages head up, leeks fan, onions fall over when they're
// ready, turnips show their shoulders. What's drawn follows the Field in agents.js: its stage, how
// many supports are up, whether it's been sown, how weedy it's got. No three.js: it writes into a Geo.

import { mulberry32 } from './rng.js';
import { UNITS_PER_M as M } from './config.js';

const Z = [0, 0];
const POLE = [0.47, 0.39, 0.27], TWIG = [0.42, 0.35, 0.28];
const shade = (c, k) => c.map(v => v * k);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// a thin upright thing: two crossed quads, so it has width from any side
function stick(G, a, b, w, col){
  // a nearly level stick gets its width from above too, or it's edge-on from the side and breaks into dashes
  const level = Math.abs(b[1] - a[1]) < 0.3 * Math.hypot(b[0] - a[0], b[2] - a[2]);
  for (const [dx, dz, dy] of level ? [[w, 0, 0], [0, w, 0], [0, 0, w]] : [[w, 0, 0], [0, w, 0]]){
    G.quad([a[0] - dx, a[1] - dy, a[2] - dz], [a[0] + dx, a[1] + dy, a[2] + dz], [b[0] + dx, b[1] + dy, b[2] + dz], [b[0] - dx, b[1] - dy, b[2] - dz], Z, Z, Z, Z, [dz + 0.01, 0.2, dx + 0.01], col);
  }
}
// a leaf: one triangle from a stem point, out at angle `t`, lifted or drooping
function leaf(G, p, t, len, wide, rise, col){
  const c = Math.cos(t), s = Math.sin(t);
  const tip = [p[0] + c * len, p[1] + rise, p[2] + s * len];
  const mid = [p[0] + c * len * 0.42, p[1] + rise * 0.55, p[2] + s * len * 0.42];
  G.tri(p, [mid[0] - s * wide, mid[1], mid[2] + c * wide], tip, Z, Z, Z, [c * 0.3, 1, s * 0.3], col);
  G.tri(p, tip, [mid[0] + s * wide, mid[1], mid[2] - c * wide], Z, Z, Z, [c * 0.3, 1, s * 0.3], shade(col, 0.9));
}
// a blade standing up, narrow, leaning off by `lean`: a leek's leaf, an onion's tube
function blade(G, p, t, h, wide, lean, col, tipCol = col){
  const c = Math.cos(t), s = Math.sin(t), tip = [p[0] + c * lean, p[1] + h, p[2] + s * lean];
  const a = [p[0] - s * wide, p[1], p[2] + c * wide], b = [p[0] + s * wide, p[1], p[2] - c * wide];
  G.tri(a, b, tip, Z, Z, Z, [c, 0.4, s], tipCol === col ? col : shade(col, 0.5).map((v, i) => v + tipCol[i] * 0.5));
}

// ---- cards: pixel pictures on cut-out quads ------------------------------------------
// An upright card at p, its width along (dx, dz). Lit from above on both faces (settle-view's material).
function flat(C, p, dx, dz, w, h, R, tone, flip){
  const hw = w / 2, a = [p[0] - dx * hw, p[1] - 0.02, p[2] - dz * hw], b = [p[0] + dx * hw, p[1] - 0.02, p[2] + dz * hw];
  C.card(a, b, [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], R, tone, flip);
}
const crossed = (C, p, w, h, t, R, tone, flip) => {
  flat(C, p, Math.cos(t), Math.sin(t), w, h, R, tone, flip);
  flat(C, p, -Math.sin(t), Math.cos(t), w, h, R, tone * 0.93, !flip);
};
// a card lying flat, turned to t
function lying(C, p, D, t, R, tone, flip){
  const c = Math.cos(t) * D / 2, s = Math.sin(t) * D / 2;
  C.card([p[0] - c + s, p[1], p[2] - s - c], [p[0] + c + s, p[1], p[2] + s - c], [p[0] + c - s, p[1], p[2] + s + c], [p[0] - c - s, p[1], p[2] - s + c], R, tone, flip);
}

// The atlas. Pure pixels, no canvas, so a node check can look at them; settle-view makes the texture.
// Cards are painted bottom-up: (0, 0) is the card's lower left. rectOf(name): [u0, v0, u1, v1].
const ATLAS = 256, RECTS = {};
export function paintAtlas(){
  const data = new Uint8ClampedArray(ATLAS * ATLAS * 4);
  let cx = 0, cy = 0, rowH = 0;
  const cell = (name, w, h, paint, seed = 1) => {
    if (cx + w > ATLAS){ cx = 0; cy += rowH; rowH = 0; }
    if (cy + h > ATLAS) throw new Error(`crop atlas is full at ${name}`);
    const ox = cx, oy = cy, rnd = mulberry32(seed * 7919 + w * 131 + h);
    const put = (x, y, rgb) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const o = ((ATLAS - 1 - (oy + y)) * ATLAS + ox + x) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    };
    paint(put, rnd, w, h);
    RECTS[name] = [(ox + 0.01) / ATLAS, (oy + 0.01) / ATLAS, (ox + w - 0.01) / ATLAS, (oy + h - 0.01) / ATLAS];
    cx += w; rowH = Math.max(rowH, h);
  };
  for (let v = 0; v < 2; v++){
    cell(`beans.low.${v}`, 16, 8, sprawl, 3 + v);
    for (const s of [1, 2, 3, 4]) cell(`beans.${s}.${v}`, 18, 34, vine(s), 10 + s * 3 + v);
    for (const s of [1, 2, 3, 4]){
      cell(`cabbages.${s}.${v}.top`, 24, 24, rosette(s), 40 + s * 3 + v);
      cell(`cabbages.${s}.${v}.side`, 24, 14, dome(s), 60 + s * 3 + v);
      if (s > 1) cell(`cabbages.${s}.${v}.cap`, 14, 14, cap, 80 + s * 3 + v);
      cell(`leeks.${s}.${v}`, 14, 20, leek(s), 100 + s * 3 + v);
      cell(`onions.${s}.${v}`, 16, 18, onion(s), 120 + s * 3 + v);
      cell(`turnips.${s}.${v}.top`, 18, 18, turnipTop(s), 140 + s * 3 + v);
      cell(`turnips.${s}.${v}.side`, 20, 14, turnipSide(s), 160 + s * 3 + v);
      cell(`parsnips.${s}.${v}`, 16, 18, parsnip(s), 180 + s * 3 + v);
    }
    for (const s of [0, 1, 2, 3, 4]) cell(`peas.${s}.${v}`, 24, 33, pea(s), 200 + s * 3 + v);
    cell(`peas.low.${v}`, 16, 8, sprawl, 220 + v);
    cell(`onions.fallen.${v}`, 14, 14, fallen, 230 + v);
  }
  return { w: ATLAS, h: ATLAS, data };
}
export const rectOf = name => {
  if (!RECTS[name]) paintAtlas();
  if (!RECTS[name]) throw new Error(`no card called ${name}`);
  return RECTS[name];
};
export const cardNames = () => { paintAtlas(); return Object.keys(RECTS); };

// a tapering stroke: starts w pixels wide, and from x0, y0 goes out by dx and up by h, sagging by droop at the end
function stroke(put, x0, y0, dx, h, droop, col, w = 1){
  const n = Math.max(2, Math.ceil(Math.hypot(dx, h) * 2));
  for (let i = 0; i <= n; i++){
    const t = i / n, x = x0 + dx * t, y = y0 + h * t - droop * t * t, wide = Math.max(1, Math.round(w * (1 - t * 0.7)));
    for (let q = 0; q < wide; q++) put(x + q - (wide - 1) / 2, y, col);
  }
}
// a blob, for bulbs and roots: lit up top, shaded under
function blob(put, cx, cy, rx, ry, top, under){
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++)
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(x, y, y >= cy ? top : under);
}

const LEAF = { lit: [140, 180, 86], mid: [100, 146, 62], dark: [64, 104, 48], old: [150, 142, 62], oldDark: [104, 92, 44] };
// a bean leaf, heart-shaped: a lit shoulder, a shaded underside, a pale rib
function beanLeaf(put, x, y, rnd, old){
  const lit = old ? LEAF.old : LEAF.lit, mid = old ? [128, 122, 56] : LEAF.mid, dark = old ? LEAF.oldDark : LEAF.dark;
  const row = [[-1, 1], [-2, 2], [-2, 2], [-1, 1], [0, 0]];
  row.forEach(([a, b], i) => { for (let q = a; q <= b; q++) put(x + q, y + 1 - i, i >= 3 || q === b ? dark : i === 0 && q <= 0 ? lit : rnd() < 0.2 ? lit : mid); });
}
// the vine on a frame: stems climbing both legs of the A, as far as stage s has got
const vine = s => (put, rnd, w, h) => {
  const reach = [0, 0.26, 0.64, 1, 1][s], old = s === 4, cxx = (w - 1) / 2;
  for (const d of [-1, 1]) for (let y = 0; y < h * reach; y++){
    const t = y / h, x = cxx + d * (cxx - 1) * (1 - t) + Math.sin(y * 0.8 + d) * 0.9;
    put(x, y, old ? LEAF.oldDark : LEAF.dark);
    if (y % 4 === 1 || rnd() < 0.14) beanLeaf(put, x + (rnd() < 0.5 ? -2 : 2), y + 1, rnd, old && rnd() < 0.75);
    if (s === 3 && y > 6 && rnd() < 0.09){ const fx = x + (rnd() < 0.5 ? -3 : 3); put(fx, y, [236, 228, 208]); put(fx + 1, y, [214, 112, 92]); }   // the flowers
    if (s === 4 && y > 4 && rnd() < 0.34){ const px = x + (rnd() < 0.5 ? -3 : 3), L = 3 + (rnd() * 3 | 0); for (let q = 0; q < L; q++) put(px, y - q, q === L - 1 ? [58, 66, 30] : [92, 108, 44]); }   // pods, hanging
  }
};
// beans with nothing to climb: a low tangle on the ground
const sprawl = (put, rnd, w, h) => {
  for (let i = 0; i < 7; i++) beanLeaf(put, 3 + rnd() * (w - 6), 1 + rnd() * (h - 4), rnd, false);
};
const CAB = { rib: [176, 204, 158], lit: [132, 176, 128], mid: [92, 138, 104], dark: [58, 98, 82], head: [176, 202, 136], headDark: [130, 164, 104] };
// a cabbage from above: scalloped outer leaves with their ribs, a tight pale head as it hearts up
const rosette = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, head = [0, 0, 0.3, 0.5, 0.62][s] * c, leaves = s < 2 ? 4 : 6, off = rnd() * 6.28;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx) + off;
    const lobe = Math.abs(Math.cos(a * leaves / 2)), R = c * (0.72 + 0.28 * lobe) * (0.92 + 0.08 * Math.sin(a * 11));
    if (d > R) continue;
    if (d < head){
      const swirl = Math.sin(d * 1.5 + a * 2);
      put(x, y, swirl > 0.55 ? CAB.headDark : CAB.head);
      continue;
    }
    const rib = lobe > 0.96 || (Math.abs(Math.sin(a * leaves)) < 0.14 && d > head + 1);
    put(x, y, rib ? CAB.rib : d > R - 1.4 ? CAB.dark : lobe > 0.6 ? CAB.lit : CAB.mid);
  }
};
// a cabbage from the side: one low wide dome, leaves fanning out from the foot with their ribs, ruffled
// at the rim, and the pale head rising in the middle of them
const HEAD_R = [0, 0, 0.42, 0.56, 0.66], HEAD_H = [0, 0, 0.72, 0.88, 1];
const dome = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, top = h - 1, headR = HEAD_R[s] * c, headH = HEAD_H[s] * top, leafH = (s === 1 ? 0.85 : 0.66) * top, off = rnd() * 6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const dx = Math.abs(x - c);
    if (headH > 0 && (dx / headR) ** 2 + (y / headH) ** 2 < 1){
      put(x, y, Math.sin(dx * 0.7 + y * 1.2 + off) > 0.6 ? CAB.headDark : y > headH * 0.45 ? CAB.head : CAB.lit);
      continue;
    }
    const a = Math.atan2(y + 2, x - c), fan = a * 7 + off;
    const out = (dx / c) ** 2 + (y / leafH) ** 2, rim = 0.86 + 0.14 * Math.sin(x * 1.3 + off);
    if (out > rim) continue;
    if (s === 1 && Math.abs(Math.cos(fan)) < 0.2) continue;   // a seedling's leaves stand apart
    put(x, y, Math.abs(Math.sin(fan)) < 0.14 ? CAB.rib : Math.abs(Math.cos(fan)) < 0.14 ? CAB.dark : out > rim - 0.2 ? CAB.lit : CAB.mid);
  }
};
// the head from above: a pale ball, its leaves wrapping round in a swirl
const cap = (put, rnd, w) => {
  const c = (w - 1) / 2;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++){
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    if (d > c) continue;
    put(x, y, Math.sin(d * 1.5 + Math.atan2(dy, dx) * 2) > 0.5 ? CAB.headDark : d > c - 1.2 ? CAB.lit : CAB.head);
  }
};

const PEA = { lit: [152, 192, 98], mid: [112, 158, 72], dark: [72, 112, 54], old: [168, 156, 72], oldDark: [128, 114, 54], twig: [146, 128, 104], twigDark: [112, 96, 78], pod: [136, 158, 68] };
// the brush bare, then the vine going up it: paler and rounder than a bean, flowers and then pods
const pea = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, reach = [0, 0.3, 0.62, 1, 1][s] * h, tips = [];
  for (const d of [-1, 0.1, 1]){
    const dx = d * (c - 3) + (rnd() - 0.5), top = h * (0.72 + rnd() * 0.26);
    stroke(put, c + d * 1.2, 0, dx, top, 0, d < 0 ? PEA.twigDark : PEA.twig);
    for (let y = 3; y < top; y += 3 + (rnd() * 3 | 0)){
      const x = c + d * 1.2 + dx * y / top, out = (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3);
      if (rnd() < 0.5) stroke(put, x, y, out, 2 + rnd() * 2, 0, PEA.twig);   // only some shoots: it's brush, not a hedge
      tips.push([x + out, y + 2], [x + out * 0.4, y + 1], [x, y]);
    }
  }
  for (const [x, y] of tips){
    if (y > reach) continue;
    const old = s === 4 && rnd() < 0.8;
    if (rnd() < 0.85){
      blob(put, x + (rnd() - 0.5) * 3, y, 2.2, 1.6, old ? PEA.old : rnd() < 0.4 ? PEA.lit : PEA.mid, old ? PEA.oldDark : PEA.dark);
    }
    if (s === 3 && rnd() < 0.22){ put(x + 1, y + 1, [240, 236, 222]); put(x, y + 1, [240, 236, 222]); }
    if (s === 4 && y > 5 && rnd() < 0.3) for (let q = 0; q < 4; q++){ put(x + 2, y - 1 - q, PEA.pod); put(x + 3, y - 1 - q, PEA.pod); }
  }
};
const LEEK = { lit: [112, 158, 130], mid: [76, 124, 106], dark: [46, 88, 80], shank: [228, 230, 192], shankDark: [190, 196, 150] };
const leek = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, len = [0, 0.36, 0.62, 0.88, 1][s] * (h - 1), shank = s >= 2 ? len * 0.3 : 0;
  // the outer leaves first, so the inner ones lie over them
  for (const [d, col] of [[-1, LEEK.dark], [1, LEEK.dark], [-0.62, LEEK.mid], [0.62, LEEK.mid], [-0.24, LEEK.lit], [0.24, LEEK.lit]]){
    const out = Math.abs(d);
    stroke(put, c + d, shank * 0.8, d * (c - 0.5) * (0.5 + len / h * 0.5), (len - shank) * (1.05 - out * 0.25), (len - shank) * out * 0.3, col, 3);
  }
  for (let y = 0; y < shank; y++){ put(c - 0.5, y, LEEK.shank); put(c + 0.5, y, LEEK.shankDark); }
};
const ONION = { lit: [108, 150, 128], mid: [76, 118, 104], dark: [50, 90, 82], straw: [170, 150, 74], strawDark: [130, 110, 54], skin: [178, 130, 76], skinDark: [130, 90, 52] };
const onion = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, len = [0, 0.4, 0.66, 1, 0][s] * (h - 1);
  if (s < 4) for (const [d, col] of [[-1, ONION.dark], [1, ONION.dark], [-0.45, ONION.mid], [0.45, ONION.mid], [0, ONION.lit]])
    stroke(put, c + d * 1.5, 0, d * (c - 3) + (rnd() - 0.5), len * (1 - Math.abs(d) * 0.18), Math.abs(d) * len * 0.12, col, 1);
  if (s === 4) for (const d of [-1, 1]) stroke(put, c + d, 4, d * (c - 0.5), 3, 6, d < 0 ? ONION.straw : ONION.strawDark, 1);
  if (s >= 3) blob(put, c, s === 4 ? 2.4 : 1.4, s === 4 ? 3.6 : 3, s === 4 ? 2.8 : 2, ONION.skin, ONION.skinDark);
};
// the fallen tops from above
const fallen = (put, rnd, w) => {
  const c = (w - 1) / 2;
  for (let i = 0; i < 6; i++){
    const a = i * 1.05 + rnd() * 0.7, L = c * (0.7 + rnd() * 0.3);
    stroke(put, c, c, Math.cos(a) * L, Math.sin(a) * L, 0, i % 2 ? ONION.straw : ONION.strawDark, 1);
  }
  blob(put, c, c, 2.2, 2.2, ONION.skin, ONION.skinDark);
};
const TURNIP = { lit: [126, 172, 72], mid: [84, 132, 56], dark: [52, 92, 44], old: [152, 150, 62], oldDark: [108, 104, 46], white: [226, 216, 216], purple: [150, 78, 142], purpleDark: [108, 56, 108] };
const turnipTones = (s, rnd) => s === 4 && rnd() < 0.7 ? [TURNIP.old, TURNIP.oldDark] : [rnd() < 0.5 ? TURNIP.lit : TURNIP.mid, TURNIP.dark];
const shoulder = (put, x, y, rx, ry) => { blob(put, x, y, rx, ry, TURNIP.white, TURNIP.white); blob(put, x, y + ry * 0.45, rx * 0.86, ry * 0.6, TURNIP.purple, TURNIP.purpleDark); };
// rough leaves radiating, a little ragged at the edges
const turnipTop = s => (put, rnd, w) => {
  const c = (w - 1) / 2, n = s < 2 ? 4 : 6, off = rnd() * 6;
  for (let i = 0; i < n; i++){
    const a = off + i * 6.28 / n, L = c * (0.8 + rnd() * 0.2), [lit, dark] = turnipTones(s, rnd);
    for (let q = 2; q < L; q++){
      const hw = 2.6 * Math.sin(q / L * 3.14) * (0.75 + rnd() * 0.45);
      for (let e = -hw; e <= hw; e += 0.5) put(c + Math.cos(a) * q - Math.sin(a) * e, c + Math.sin(a) * q + Math.cos(a) * e, e > 0 ? lit : dark);
    }
    stroke(put, c, c, Math.cos(a) * L * 0.85, Math.sin(a) * L * 0.85, 0, [168, 196, 120]);
  }
  if (s >= 3) blob(put, c, c, s === 4 ? 3 : 2.2, s === 4 ? 3 : 2.2, TURNIP.purple, TURNIP.purpleDark);
};
const turnipSide = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, n = s < 2 ? 4 : 7;
  for (let i = 0; i < n; i++){
    const d = n === 1 ? 0 : (i / (n - 1)) * 2 - 1, [lit, dark] = turnipTones(s, rnd), L = (h - 2) * (1 - Math.abs(d) * 0.3) * (0.82 + rnd() * 0.18);
    stroke(put, c + d, 1, d * (c - 1.5), L, Math.abs(d) * L * 0.4, Math.abs(d) > 0.6 ? dark : lit, 4);
  }
  if (s >= 3) shoulder(put, c, s === 4 ? 2 : 1.5, s === 4 ? 4.2 : 3.2, s === 4 ? 3 : 2.2);
};
const PARSNIP = { lit: [136, 180, 80], mid: [96, 146, 60], stem: [84, 124, 54], old: [164, 158, 66], oldStem: [122, 112, 52], crown: [214, 196, 146], crownDark: [170, 150, 104] };
// stems fanning from a crown, with cut leaflets in pairs up each
const parsnip = s => (put, rnd, w, h) => {
  const c = (w - 1) / 2, len = [0, 0.36, 0.62, 1, 0.92][s] * (h - 1);
  for (const d of [-1, -0.45, 0.1, 0.55, 1]){
    const old = s === 4 && rnd() < 0.75, out = d * (c - 2) * (0.5 + 0.5 * len / h), up = len * (1 - Math.abs(d) * 0.22), sag = Math.abs(d) * up * 0.22;
    stroke(put, c + d, 0, out, up, sag, old ? PARSNIP.oldStem : PARSNIP.stem);
    for (let t = 0.4; t <= 1; t += 4 / Math.max(5, up)){
      const x = c + d + out * t, y = up * t - sag * t * t, col = old ? PARSNIP.old : rnd() < 0.5 ? PARSNIP.lit : PARSNIP.mid;
      for (const e of [-1, 1]){ put(x + e, y, col); put(x + e * 2, y + 1, col); }
      put(x, y + 1, col);
    }
  }
  if (s === 4) blob(put, c, 1, 2.2, 1.4, PARSNIP.crown, PARSNIP.crownDark);
};

// ---- what each crop looks like ------------------------------------------------------
// plants(f, ctx): ctx.at(u, v) is a point on the ground; s the stage 0..4; `up` the fraction of
// supports standing; r the field's own random stream.
const GROW = {
  // Beans on pole frames: two poles crossed at the top and a ridge pole along them, in geometry so
  // they read as structure; the vine is a pair of crossed cards round each frame. A plant with no pole to
  // climb stays a low sprawl (the Field won't let it pass its shoots until the poles are in).
  beans({ f, at, s, up, r, C }, G){
    const H = 1.95 * M, rows = Math.max(1, Math.floor(2 * f.hw / (2.2 * M))), step = 1.4 * M, frames = [];
    for (let k = 0; k < rows; k++){
      const v = -f.hw + (k + 0.5) * 2 * f.hw / rows;
      for (let u = -f.hl + 1; u <= f.hl - 1; u += step) frames.push({ u, v, k });
    }
    const built = Math.ceil(up * frames.length), ridges = new Map();
    const lx = Math.cos(f.a), lz = Math.sin(f.a), cx = -lz, cz = lx;
    frames.forEach(({ u, v, k }, i) => {
      const standing = i < built, g = at(u, v);
      if (standing){
        for (const d of [-1, 1]) stick(G, at(u, v + d * 0.5 * M), add(at(u, v - d * 0.1 * M), [0, H, 0]), 0.035, shade(POLE, 0.92 + (i % 3) * 0.06));
        const rp = add(g, [0, H * 0.94, 0]);
        if (ridges.has(k)) stick(G, ridges.get(k), rp, 0.03, POLE);
        ridges.set(k, rp);
      }
      if (s < 1) return;
      const flip = r() < 0.5, tone = 0.9 + r() * 0.2, v2 = (r() * 2) | 0;
      if (!standing || s === 0){
        crossed(C, g, 0.75 * M, 0.36 * M, f.a + r(), rectOf(`beans.low.${v2}`), tone, flip);
        return;
      }
      const R = rectOf(`beans.${s}.${v2}`), w = 1.12 * M, h = H * 1.03;
      flat(C, g, cx, cz, w, h, R, tone, flip);                     // across the frame: the A of it
      flat(C, g, lx, lz, w * 0.7, h, R, tone * 0.94, !flip);       // along the row
    });
  },
  // Peas scrambling up twiggy brush pushed in along the row. The brush is in the picture with them: a
  // thin twig is under a pixel from any distance anyway, and there are a lot of these.
  peas({ f, at, s, up, r, C }, G){
    const rows = Math.max(1, Math.floor(2 * f.hw / (1.15 * M))), step = 1.0 * M, spots = [];
    for (let k = 0; k < rows; k++){
      const v = -f.hw + (k + 0.5) * 2 * f.hw / rows;
      for (let u = -f.hl + 0.8; u <= f.hl - 0.8; u += step) spots.push([u + (r() - 0.5) * 0.3, v + (r() - 0.5) * 0.25]);
    }
    const built = Math.ceil(up * spots.length), H = 1.2 * M, W = H * 24 / 33;
    spots.forEach(([u, v], i) => {
      const g = at(u, v), t = r() * 6.28, tone = 0.9 + r() * 0.2, v2 = (r() * 2) | 0, flip = r() < 0.5;
      if (i < built) crossed(C, g, W, H, t, rectOf(`peas.${s}.${v2}`), tone, flip);
      else if (s >= 1) crossed(C, g, 0.8 * M, 0.4 * M, t, rectOf(`peas.low.${v2}`), tone, flip);
    });
  },
  // Cabbages: a rosette lying flat, two crossed side views standing through it, and once it hearts a
  // cap lying at the height of the head, so from above the head stands clear of the leaves.
  cabbages({ f, at, s, r, C }, G){
    each(f, 1.2 * M, 1.1 * M, at, r, g => {
      if (s < 1) return;
      const k = [0, 0.55, 0.75, 0.9, 1][s], D = 1.2 * M * k, H = D * 14 / 24, tone = 0.9 + r() * 0.2, t = r() * 6.28, v2 = (r() * 2) | 0, flip = r() < 0.5;
      lying(C, add(g, [0, 0.07 + 0.05 * k, 0]), D, t, rectOf(`cabbages.${s}.${v2}.top`), tone, flip);
      crossed(C, g, D, H, t, rectOf(`cabbages.${s}.${v2}.side`), tone * 0.95, flip);
      if (s > 1) lying(C, add(g, [0, H * HEAD_H[s] * 0.75, 0]), D * HEAD_R[s] * 0.7, t + 1, rectOf(`cabbages.${s}.${v2}.cap`), tone, flip);
    });
  },
  // Leeks: flat fans of leaves, the shank whitened by the earth drawn up to it.
  leeks({ f, at, s, r, C }, G){
    each(f, 1.0 * M, 0.56 * M, at, r, g => {
      if (s >= 1) crossed(C, g, 0.66 * M, 0.95 * M, r() * 6.28, rectOf(`leeks.${s}.${(r() * 2) | 0}`), 0.9 + r() * 0.2, r() < 0.5);
    });
  },
  // Onions: thin blue-green tubes. When they're ready the tops fall over and yellow, and the bulb sits
  // proud; the fallen tops get a card lying on the earth, since that's where they are.
  onions({ f, at, s, r, C }, G){
    each(f, 0.9 * M, 0.62 * M, at, r, g => {
      if (s < 1) return;
      const t = r() * 6.28, tone = 0.9 + r() * 0.2, v2 = (r() * 2) | 0, flip = r() < 0.5;
      crossed(C, g, 0.55 * M, 0.62 * M, t, rectOf(`onions.${s}.${v2}`), tone, flip);
      if (s === 4) lying(C, add(g, [0, 0.05, 0]), 0.75 * M, t, rectOf(`onions.fallen.${v2}`), tone, flip);
    });
  },
  // Turnips: rough rosettes, and a purple-and-white shoulder pushing up as they fatten.
  turnips({ f, at, s, r, C }, G){
    each(f, 1.15 * M, 0.9 * M, at, r, g => {
      if (s < 1) return;
      const k = [0, 0.5, 0.72, 0.9, 1][s], D = 1.05 * M * k, t = r() * 6.28, tone = 0.9 + r() * 0.2, v2 = (r() * 2) | 0, flip = r() < 0.5;
      lying(C, add(g, [0, 0.07 + 0.05 * k, 0]), D, t, rectOf(`turnips.${s}.${v2}.top`), tone, flip);
      crossed(C, g, D, D * 0.7, t, rectOf(`turnips.${s}.${v2}.side`), tone * 0.95, flip);
    });
  },
  // Parsnips: taller, cut like celery. All below ground but a pale crown.
  parsnips({ f, at, s, r, C }, G){
    each(f, 1.1 * M, 0.85 * M, at, r, g => {
      if (s >= 1) crossed(C, g, 0.85 * M, 0.96 * M, r() * 6.28, rectOf(`parsnips.${s}.${(r() * 2) | 0}`), 0.9 + r() * 0.2, r() < 0.5);
    });
  },
};
function each(f, rowGap, gap, at, r, fn){
  const rows = Math.max(1, Math.floor(2 * f.hw / rowGap));
  for (let k = 0; k < rows; k++){
    const v = -f.hw + (k + 0.5) * 2 * f.hw / rows;
    for (let u = -f.hl + 0.7 + (k % 2) * gap / 2; u <= f.hl - 0.7; u += gap) fn(at(u + (r() - 0.5) * gap * 0.3, v + (r() - 0.5) * rowGap * 0.18));
  }
}

// One field in one state: { crop, stage, up, sown, weeds }.
// `ground(x, z)` is the land. Geometry goes in G, cards in C.
export function fieldInto(G, f, ground, { crop, stage = 0, up = 1, sown = true, weeds = 0 }, C = G){
  const lx = Math.cos(f.a), lz = Math.sin(f.a), cx = -lz, cz = lx;
  const P = (u, v) => { const x = f.x + lx * u + cx * v, z = f.z + lz * u + cz * v; return [x, ground(x, z), z]; };
  const r = mulberry32(((f.x * 31) ^ (f.z * 17) ^ (crop ? crop.length * 977 : 0)) >>> 0);
  // the earth: ridges along the rows, fresh-turned dark when it's just been dug
  const rows = Math.max(2, Math.floor(2 * f.hw / 1.5)), gap = 2 * f.hw / rows, half = 0.42, h = sown ? 0.14 : 0.08;
  const earth = sown ? [0.17, 0.12, 0.08] : [0.12, 0.085, 0.06];
  for (let k = 0; k < rows; k++){
    const v = -f.hw + gap * (k + 0.5);
    for (let u = -f.hl + 0.6; u < f.hl - 0.6; u += 3){
      const u1 = Math.min(f.hl - 0.6, u + 3);
      const a0 = P(u, v - half), a1 = P(u1, v - half), b0 = P(u, v + half), b1 = P(u1, v + half);
      const r0 = P(u, v), r1 = P(u1, v); r0[1] += h; r1[1] += h;
      const tone = earth.map(x => x * (0.92 + 0.1 * Math.sin(u * 1.7 + k)));
      G.quad(a0, a1, r1, r0, Z, Z, Z, Z, [-cx, 1, -cz], tone);
      G.quad(b1, b0, r0, r1, Z, Z, Z, Z, [cx, 1, cz], shade(tone, 0.88));
    }
  }
  const at = (u, v) => { const q = P(u, v); q[1] += h * 0.8; return q; };
  // what's left of the old crop lies about until it's dug in
  if (!sown) for (let i = 0; i < 26; i++) blade(G, at((r() - 0.5) * 1.9 * f.hl, (r() - 0.5) * 1.9 * f.hw), r() * 6.28, 0.14, 0.05, 0.28, [0.46, 0.40, 0.22]);
  if (sown && crop && GROW[crop]) GROW[crop]({ f, at, s: stage, up, r, C }, G);
  // weeds come when the hoe stops
  const nw = weeds * 26;
  for (let i = 0; i < nw; i++){
    const p = at((r() - 0.5) * 1.9 * f.hl, (r() - 0.5) * 1.9 * f.hw), c = [0.34 + r() * 0.14, 0.58 + r() * 0.12, 0.2], t = r() * 6.28;
    for (const d of [0, 2.1, 4.2]) blade(G, p, t + d, 0.3 + r() * 0.4, 0.06, 0.12, c);
    if (r() < 0.3) leaf(G, add(p, [0, 0.42, 0]), t, 0.06, 0.05, 0.02, [0.92, 0.82, 0.20]);       // a dandelion, or as good as
  }
  return G;
}

// ---- what stands round a croft: built once ------------------------------------------
// A low wattle hurdle with a gap on the side toward the house (the commonest fence there was, of
// hazel the same as the poles), low enough to step over. A midden by the gap, and on some a scarecrow.
export function croftInto(G, f, ground, house, r){
  const lx = Math.cos(f.a), lz = Math.sin(f.a), cx = -lz, cz = lx, H = 0.52 * M, step = 2.8;
  const P = (u, v, y = 0) => { const x = f.x + lx * u + cx * v, z = f.z + lz * u + cz * v; return [x, ground(x, z) + y, z]; };
  const dx = house.x - f.x, dz = house.z - f.z, hu = dx * lx + dz * lz, hv = dx * cx + dz * cz;
  const onV = Math.abs(hv) / f.hw > Math.abs(hu) / f.hl, sideV = Math.sign(hv) || 1, sideU = Math.sign(hu) || 1;
  const gate = onV ? Math.max(-f.hl + 2, Math.min(f.hl - 2, hu)) : Math.max(-f.hw + 2, Math.min(f.hw - 2, hv));
  const O = 0.55;
  const run = (from, to, pos, isGate, out) => {
    const n = Math.max(1, Math.round(Math.abs(to - from) / step));
    for (let i = 0; i < n; i++){
      const a = from + (to - from) * i / n, b = from + (to - from) * (i + 1) / n;
      if (isGate && Math.abs((a + b) / 2 - gate) < 1.7) continue;
      const pa = pos(a), pb = pos(b), L = Math.abs(b - a) / 2.8;
      G.wattle.quad(pa(0), pb(0), pb(H), pa(H), [0, 0], [L, 0], [L, 1], [0, 1], out, [0.9 + r() * 0.15, 0.9 + r() * 0.1, 0.84]);
      const top = pa(H + 0.14), foot = pa(-0.1);
      G.timber.tbox(foot[0], foot[2], foot[1], top[1], 0.13, 0.13, f.a, [0.34, 0.28, 0.2], 3);
    }
  };
  const U = f.hl + O, V = f.hw + O;
  for (const s of [-1, 1]){
    run(-U, U, u => y => P(u, s * V, y), onV && s === sideV, [cx * s, 0, cz * s]);
    run(-V, V, v => y => P(s * U, v, y), !onV && s === sideU, [lx * s, 0, lz * s]);
  }
  // the midden: dung and kitchen scraps, which is what feeds the soil
  const mu = onV ? gate + 3.6 * (gate < 0 ? 1 : -1) : sideU * (U + 1.5), mv = onV ? sideV * (V + 1.5) : gate + 3.6 * (gate < 0 ? 1 : -1);
  const hp = P(mu, mv), rad = 1.05, n = 7;
  const ringAt = (k, y) => Array.from({ length: n }, (_, i) => [hp[0] + Math.cos(i / n * 6.283) * rad * k, hp[1] + y, hp[2] + Math.sin(i / n * 6.283) * rad * k]);
  const rings = [ringAt(1, -0.1), ringAt(0.72, 0.34), ringAt(0.32, 0.62)], top = [hp[0], hp[1] + 0.72, hp[2]];
  const mud = [0.20, 0.15, 0.10];
  for (let q = 0; q < 2; q++) for (let i = 0; i < n; i++){
    const j = (i + 1) % n, a = rings[q], b = rings[q + 1];
    G.detail.quad(a[i], a[j], b[j], b[i], Z, Z, Z, Z, [a[i][0] - hp[0], 0.8, a[i][2] - hp[2]], shade(mud, 0.86 + ((i + q) % 3) * 0.13));
  }
  for (let i = 0; i < n; i++){ const j = (i + 1) % n; G.detail.tri(rings[2][i], rings[2][j], top, Z, Z, Z, [0, 1, 0], [0.28, 0.25, 0.16]); }
  // a scarecrow, where the birds would have the seed: a cross of hazel, a rag, a straw hat
  if (r() < 0.45){
    const s = P((r() - 0.5) * f.hl * 0.9, (r() - 0.5) * f.hw * 0.7), y = s[1], W = 0.68 * M, Hs = 1.72 * M, t = G.timber, a = f.a;
    t.tbox(s[0], s[2], y - 0.1, y + Hs, 0.1, 0.1, a, [0.38, 0.30, 0.2], 3);
    const c = Math.cos(a), n1 = Math.sin(a), arm = y + Hs * 0.72;
    G.detail.box(s[0], s[2], arm - 0.05, arm + 0.05, W * 2, 0.09, a, [0.38, 0.30, 0.2]);
    const rag = [[0.42, 0.32, 0.24], [0.30, 0.32, 0.36], [0.46, 0.22, 0.16]][(r() * 3) | 0];
    const fr = [-n1, 0, c], Pa = (u, yy, off = 0.08) => [s[0] + c * u + fr[0] * off, yy, s[2] + n1 * u + fr[2] * off];
    for (const off of [0.08, -0.08]) G.detail.quad(Pa(-W * 0.9, arm + 0.1, off), Pa(W * 0.9, arm + 0.1, off), Pa(W * 0.55, arm - 0.75, off), Pa(-W * 0.55, arm - 0.75, off), Z, Z, Z, Z, off > 0 ? fr : [-fr[0], 0, -fr[2]], rag);
    G.detail.box(s[0], s[2], y + Hs * 0.86, y + Hs * 1.02, 0.3, 0.3, a, [0.70, 0.60, 0.38]);
    G.detail.box(s[0], s[2], y + Hs * 1.0, y + Hs * 1.03, 0.62, 0.62, a + 0.5, [0.62, 0.50, 0.28]);
    G.detail.box(s[0], s[2], y + Hs * 1.03, y + Hs * 1.12, 0.3, 0.3, a + 0.5, [0.58, 0.46, 0.26]);
  }
}
