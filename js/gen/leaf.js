import * as THREE from 'three';
import { makeTexture, speckle } from '../textures.js';
import { rand, pick } from '../rng.js';
import { definePattern, SCALE } from './pattern.js';

// Pre-render leaf sprites into a small atlas. Each cell is one leaf, drawn as a
// lobed silhouette with veins and grain, in varied greens/autumn tones. The 3D
// tree pastes these onto leaf cards (quads), so the leaf shape is "real" art
// rendered once, then reused thousands of times. Two shapes so far: the pointy
// 5-lobe maple, and the elongated, round-lobed oak.

// Right-half outlines, normalized: nx in 0..1 (across), ny in 0..1 (base->tip).
// Mirrored to the left to form the full leaf.
const MAPLE_R = [
  [0.05, 0.02], [0.85, 0.12], [0.40, 0.30],
  [0.80, 0.50], [0.30, 0.62], [0.18, 0.97], [0.0, 1.0],
];
const MAPLE_TIPS = [[0.0,1.0],[0.80,0.50],[0.85,0.12]];

// oak: narrower, longer, with several rounded lobes and shallow sinuses
const OAK_R = [
  [0.06,0.0], [0.34,0.09], [0.18,0.17], [0.50,0.27], [0.22,0.36],
  [0.56,0.46], [0.24,0.55], [0.48,0.64], [0.20,0.73], [0.34,0.83], [0.14,0.91], [0.0,1.0],
];
const OAK_TIPS = [[0.0,1.0],[0.56,0.46],[0.50,0.27],[0.48,0.64]];

const GREENS  = ['#3f7a2e','#4a8a34','#356b28','#5a9a3c','#2f6024'];
const AUTUMN  = ['#b5642a','#c98a2e','#9c4422','#caa23a'];
// oaks read a touch deeper/duller green, and turn russet-brown in autumn
const OAK_GREENS = ['#3a6b2c','#46792f','#2f5a24','#527f34','#39682a'];
const OAK_AUTUMN = ['#8a5a2a','#7a4420','#9c6a2e','#6e3c1c'];
// conifers: deep blue-green, evergreen (no autumn)
const CONIFER_GREENS = ['#1a4226','#1e4a2a','#224e2e','#183c22','#265830'];

const SHAPES = {
  // maples stay green: an orange card in every fifth slot speckled every crown
  maple:   { R: MAPLE_R, tips: MAPLE_TIPS, greens: GREENS,        autumn: null,       vein: 'rgba(20,50,15,0.5)' },
  oak:     { R: OAK_R,   tips: OAK_TIPS,   greens: OAK_GREENS,    autumn: OAK_AUTUMN, vein: 'rgba(30,48,16,0.55)' },
  conifer: { greens: CONIFER_GREENS },
};

function leafPath(g, x0, y0, s, R){
  const p = 6, span = s - 2*p;
  const X = nx => x0 + p + (nx*0.5 + 0.5) * span;   // nx -1..1 -> cell width
  const Y = ny => y0 + (s - p) - ny * span;          // ny 0..1 -> bottom->top
  const pts = [[0,0]];
  for (const [nx,ny] of R) pts.push([nx,ny]);
  for (let i = R.length-2; i >= 0; i--) pts.push([-R[i][0], R[i][1]]);
  g.beginPath();
  g.moveTo(X(pts[0][0]), Y(pts[0][1]));
  for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]));
  g.closePath();
  return { X, Y };
}

function drawLeaf(g, x0, y0, s, rng, shape){
  const autumn = rng() < 0.22 && !!shape.autumn;    // rng drawn either way: the atlas's other cells stay put
  const base = autumn ? pick(rng, shape.autumn) : pick(rng, shape.greens);
  const { X, Y } = leafPath(g, x0, y0, s, shape.R);
  g.save(); g.clip();
  g.fillStyle = base; g.fillRect(x0, y0, s, s);
  // shading: darker toward base, lighter toward tip
  const grad = g.createLinearGradient(0, y0+s, 0, y0);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0.12)');
  g.fillStyle = grad; g.fillRect(x0, y0, s, s);
  // veins from base to each tip (and mirror)
  g.strokeStyle = autumn ? 'rgba(80,40,20,0.55)' : shape.vein;
  g.lineWidth = Math.max(1, s*0.02);
  for (const [tx,ty] of shape.tips){
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(tx), Y(ty)); g.stroke();
    if (tx > 0){ g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(-tx), Y(ty)); g.stroke(); }
  }
  speckle(g, x0, y0, s, s, {density: 0.35});
  g.restore();
  // stem
  g.strokeStyle = '#6a4a2a'; g.lineWidth = Math.max(1, s*0.03);
  g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(0), y0 + s); g.stroke();
}

// A conifer sprig: 5–8 needle lines radiating from a centre point, like a short
// branch end. No leaf silhouette — just painted lines on a transparent background.
// alphaTest on the material discards the transparent areas, leaving only the needles.
function drawConifer(g, x0, y0, s, rng, shape){
  const cx = x0 + s * 0.5, cy = y0 + s * 0.52;
  const nNeedles = 5 + (rng() * 4 | 0);
  const lw = Math.max(2, s * 0.055);
  for (let i = 0; i < nNeedles; i++){
    const angle = rng() * Math.PI * 2;
    const len = s * (0.28 + rng() * 0.18);
    g.strokeStyle = pick(rng, shape.greens);
    g.lineWidth = lw * (0.7 + rng() * 0.5);
    g.globalAlpha = 0.88 + rng() * 0.12;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    g.stroke();
  }
  // centre knot
  g.fillStyle = pick(rng, shape.greens);
  g.globalAlpha = 1;
  g.beginPath(); g.arc(cx, cy, lw * 0.8, 0, Math.PI * 2); g.fill();
}

// Build an atlas of varied leaves/sprigs. `kind` is 'maple', 'oak', or 'conifer'.
// Returns { texture, cols, rows, count }.
export function makeLeafAtlas(rng, { cols = 4, rows = 2, cell = 64, kind = 'maple' } = {}){
  const shape = SHAPES[kind] || SHAPES.maple;
  const draw = kind === 'conifer' ? drawConifer : drawLeaf;
  const texture = makeTexture(cols*cell, rows*cell, (g) => {
    g.clearRect(0, 0, cols*cell, rows*cell);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        draw(g, c*cell, r*cell, cell, rng, shape);
  });
  return { texture, cols, rows, count: cols*rows };
}

// Willow strands: tall cells, each a length of hanging twig set with narrow leaves
// angled down it. The twig enters and leaves at the middle of the cell's top and
// bottom, so cards chain into one strand (tree.js weepingCards). One row: u is all
// a card needs to pick a cell.
const WILLOW_GREENS = ['#6f9a3a', '#86ab45', '#5e8a34', '#9dbb55', '#b0c678'];
export function makeWillowAtlas(rng, { cols = 4, cw = 32, ch = 80 } = {}){
  const texture = makeTexture(cols*cw, ch, (g) => {
    g.clearRect(0, 0, cols*cw, ch);
    for (let c = 0; c < cols; c++){
      const cx = (c + 0.5) * cw, bend = rand(rng, 2, 4) * (rng() < 0.5 ? -1 : 1), phase = rand(rng, 1, 2);
      const twigX = y => cx + bend * Math.sin(y / ch * Math.PI * phase) * Math.sin(y / ch * Math.PI);   // 0 at both ends
      for (let y = 2; y < ch; y += 3){
        const side = y % 2 ? 1 : -1, len = rand(rng, 8, 13), lean = rand(rng, 0.45, 1.0);
        g.strokeStyle = pick(rng, WILLOW_GREENS);
        g.lineWidth = rng() < 0.6 ? 2 : 3;
        const x0 = twigX(y);
        const x1 = Math.min((c + 1) * cw - 1, Math.max(c * cw + 1, x0 + side * Math.sin(lean) * len));
        g.beginPath(); g.moveTo(x0, y);
        g.lineTo(x1, Math.min(ch - 1, y + Math.cos(lean) * len));
        g.stroke();
      }
      g.strokeStyle = '#a8913f'; g.lineWidth = 1.5;   // the yellow twig of a weeping willow
      g.beginPath(); g.moveTo(cx, 0);
      for (let y = 4; y <= ch; y += 4) g.lineTo(twigX(y), y);
      g.stroke();
    }
  });
  return { texture, cols, rows: 1, count: cols };
}

// Leaf clumps (shrubs): one card is a whole sprig, a dozen small pointed leaves
// fanned from a stem at the bottom of the cell, the outer ones painted first and
// darker, the middle ones last and lighter. Loose leaf cards each land at their own
// angle and read as confetti; on a clump the leaves already belong together, and
// tree.js stands every card the same way up. The palette is narrow on purpose:
// a cell differs from its neighbour by less than a leaf differs from a gap.
const CLUMP_GREENS = ['#3f7430', '#467e33', '#3a6d2d', '#4c8636'];
function drawClump(g, x0, y0, s, rng){
  const base = new THREE.Color(pick(rng, CLUMP_GREENS));
  const n = 12 + (rng() * 4 | 0), cx = x0 + s / 2, cy = y0 + s * 0.86;
  const leaves = [];
  for (let i = 0; i < n; i++){
    const k = (i + rng() * 0.8) / n * 2 - 1;     // -1..1 across the fan
    leaves.push({ k, ang: k * 1.75, len: s * rand(rng, 0.26, 0.36), wid: s * rand(rng, 0.075, 0.1),
                  from: s * rand(rng, 0.04, 0.34) });
  }
  leaves.sort((a, b) => Math.abs(b.k) - Math.abs(a.k));   // the sides first, the middle over them
  for (const L of leaves){
    const dx = Math.sin(L.ang), dy = -Math.cos(L.ang), nx = -dy, ny = dx;
    // each leaf starts up the stem, so the fan has a body rather than a point
    const bx = cx + dx * L.from * 0.6, by = cy - L.from + dy * L.from * 0.4;
    const P = (t, w) => [bx + dx * L.len * t + nx * L.wid * w, by + dy * L.len * t + ny * L.wid * w];
    g.fillStyle = '#' + base.clone().multiplyScalar(1.28 - Math.abs(L.k) * 0.5 + rand(rng, -0.05, 0.05)).getHexString();
    g.beginPath(); g.moveTo(...P(0, 0));
    g.lineTo(...P(0.35, 1)); g.lineTo(...P(0.7, 0.7)); g.lineTo(...P(1, 0));
    g.lineTo(...P(0.7, -0.7)); g.lineTo(...P(0.35, -1));
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(25,55,20,0.55)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(...P(0.1, 0)); g.lineTo(...P(0.85, 0)); g.stroke();
  }
  g.strokeStyle = '#5a4428'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, y0 + s); g.lineTo(cx, cy - s * 0.2); g.stroke();
}

// Sprigs of a tree's own leaf: the same fan as a shrub's clump, with each leaf drawn
// to its species' outline. Birch: a pointed triangle. Alder: round, blunt at the tip.
// Apple: a plain oval. Rowan: long compound leaves, pairs of leaflets on a stalk.
const BIRCH_R = [[0.45,0.04],[0.72,0.2],[0.6,0.24],[0.58,0.4],[0.44,0.44],[0.4,0.6],[0.26,0.64],[0.16,0.84],[0,1]];
const ALDER_R = [[0.3,0.06],[0.62,0.26],[0.78,0.52],[0.72,0.78],[0.42,0.95],[0.14,0.98],[0,0.92]];
const APPLE_R = [[0.3,0.06],[0.56,0.26],[0.62,0.5],[0.48,0.76],[0.22,0.93],[0,1]];
const LEAFLET_R = [[0.5,0.2],[0.6,0.5],[0.34,0.82],[0,1]];
const NARROW = ['#3f7a2e', '#468331', '#3a7029'];
const SPRIGS = {
  maple: { R: MAPLE_R, tips: MAPLE_TIPS, n: 5,  len: [0.42, 0.5],  fan: 1.7, greens: NARROW },
  oak:   { R: OAK_R,   tips: OAK_TIPS,   n: 6,  len: [0.44, 0.54], fan: 1.5, greens: ['#3a6b2c', '#41722e', '#376729'], turned: OAK_AUTUMN },
  birch: { R: BIRCH_R, n: 11, len: [0.24, 0.3],  fan: 1.9, greens: NARROW },
  alder: { R: ALDER_R, n: 8,  len: [0.3, 0.36],  fan: 1.8, greens: NARROW },
  apple: { R: APPLE_R, n: 9,  len: [0.3, 0.36],  fan: 1.8, greens: NARROW },
  rowan: { R: LEAFLET_R, pairs: 5, n: 3, len: [0.66, 0.74], fan: 0.95, greens: NARROW },
  spruce: { bough: true, splay: [0.5, 1.0], needle: [0.075, 0.12], greens: ['#234f33', '#27583a', '#1f4830'], tips: ['#3c7349', '#447d50'] },
  // juniper: short, prickly, grey-green, with its dusky blue berries
  juniper: { bough: true, splay: [0.35, 0.8], needle: [0.06, 0.09], greens: ['#4a6f55', '#547b5d', '#42664f'], tips: ['#6f9470', '#7a9c78'], berry: '#39466e', berries: 5 },
  // yew: long flat needles in two ranks, nearly black, with its red arils
  yew: { bough: true, splay: [1.1, 1.4], needle: [0.09, 0.13], greens: ['#1a3d26', '#1d4329', '#173722'], tips: ['#2e6238', '#346b3e'], berry: '#b5302a', berries: 3 },
};
// A conifer bough (spruce, juniper, yew): a twig up the middle of the cell, side shoots shortening toward the
// tip, each thick with short needles, the new growth at the ends a little lighter.
function drawBough(g, x0, y0, s, rng, spec){
  g.save(); g.beginPath(); g.rect(x0, y0, s, s); g.clip();
  const cx = x0 + s / 2, foot = y0 + s;
  const shoot = (ox, oy, ang, len) => {
    const dx = Math.sin(ang), dy = -Math.cos(ang), n = Math.ceil(len / 2.2);
    for (let i = 0; i < n; i++){
      const t = i / n, px = ox + dx * len * t, py = oy + dy * len * t;
      g.strokeStyle = t > 0.72 ? pick(rng, spec.tips) : pick(rng, spec.greens);
      g.lineWidth = 3;
      for (const m of [-1, 1]){
        const a = ang + m * rand(rng, spec.splay[0], spec.splay[1]), nl = s * rand(rng, spec.needle[0], spec.needle[1]);
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(a) * nl, py - Math.cos(a) * nl); g.stroke();
      }
    }
  };
  const pairs = 7;
  for (let i = 0; i < pairs; i++){
    const t = (i + 0.4) / pairs, y = foot - s * 0.9 * t, side = s * 0.42 * (1 - t * 0.8);
    for (const m of [-1, 1]) shoot(cx, y, m * rand(rng, 0.75, 1.05), side * rand(rng, 0.85, 1.05));
  }
  shoot(cx, foot, rand(rng, -0.04, 0.04), s * 0.94);
  g.strokeStyle = '#4a3a26'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, foot); g.lineTo(cx, foot - s * 0.6); g.stroke();
  if (spec.berry){
    g.fillStyle = spec.berry;
    for (let i = 0; i < spec.berries; i++){
      const y = foot - s * rand(rng, 0.2, 0.85), x = cx + s * rand(rng, -0.26, 0.26);
      g.fillRect(Math.round(x), Math.round(y), 4, 4);
    }
  }
  g.restore();
}
function leafAt(g, R, tips, ox, oy, ang, len, fill){
  g.save(); g.translate(ox, oy); g.rotate(ang);
  const X = nx => nx * len * 0.5, Y = ny => -ny * len;
  g.fillStyle = fill; g.beginPath(); g.moveTo(0, 0);
  for (const [nx, ny] of R) g.lineTo(X(nx), Y(ny));
  for (let i = R.length - 2; i >= 0; i--) g.lineTo(X(-R[i][0]), Y(R[i][1]));
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(25,55,20,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, Y(0.9)); g.stroke();
  for (const [tx, ty] of tips || []) if (tx > 0) for (const m of [-1, 1]){
    g.beginPath(); g.moveTo(0, 0); g.lineTo(X(m * tx * 0.85), Y(ty * 0.85)); g.stroke();
  }
  g.restore();
}
function drawSprig(g, x0, y0, s, rng, spec){
  g.save(); g.beginPath(); g.rect(x0, y0, s, s); g.clip();
  const base = new THREE.Color(pick(rng, spec.greens));
  const cx = x0 + s / 2, cy = y0 + s * 0.88;
  const leaves = [];
  for (let i = 0; i < spec.n; i++){
    const k = (i + rng() * 0.8) / spec.n * 2 - 1;
    leaves.push({ k, ang: k * spec.fan, len: s * rand(rng, spec.len[0], spec.len[1]), from: s * rand(rng, 0.04, 0.3) });
  }
  leaves.sort((a, b) => Math.abs(b.k) - Math.abs(a.k));   // the sides first, the middle over them
  for (const L of leaves){
    const shade = 1.25 - Math.abs(L.k) * 0.45 + rand(rng, -0.05, 0.05);
    // a turned leaf here and there, never a whole card of them: that speckles a crown
    const c = spec.turned && rng() < 0.07 ? new THREE.Color(pick(rng, spec.turned)) : base.clone().multiplyScalar(shade);
    const fill = '#' + c.getHexString();
    const ox = cx + Math.sin(L.ang) * L.from * 0.6, oy = cy - L.from * 0.7;
    if (spec.pairs){
      const dx = Math.sin(L.ang), dy = -Math.cos(L.ang), lf = L.len * 0.3;
      g.strokeStyle = '#5a6a30'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(ox, oy); g.lineTo(ox + dx * L.len * 0.85, oy + dy * L.len * 0.85); g.stroke();
      for (let i = 0; i < spec.pairs; i++){
        const t = 0.2 + i / spec.pairs * 0.66, px = ox + dx * L.len * t, py = oy + dy * L.len * t;
        for (const m of [-1, 1]) leafAt(g, spec.R, null, px, py, L.ang + m * 1.05, lf, fill);
      }
      leafAt(g, spec.R, null, ox + dx * L.len * 0.82, oy + dy * L.len * 0.82, L.ang, lf, fill);
    } else leafAt(g, spec.R, spec.tips, ox, oy, L.ang, L.len, fill);
  }
  g.strokeStyle = '#5a4428'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, y0 + s); g.lineTo(cx, cy - s * 0.18); g.stroke();
  g.restore();
}
// `kind` is a tree in SPRIGS, or left out for a shrub's generic clump.
export function makeClumpAtlas(rng, { cols = 4, rows = 2, cell = null, kind = null } = {}){
  const spec = SPRIGS[kind];
  cell = cell || (spec ? 96 : 64);                 // a tree's card is bigger, and its leaf outlines want the pixels
  const texture = makeTexture(cols*cell, rows*cell, (g) => {
    g.clearRect(0, 0, cols*cell, rows*cell);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (spec) (spec.bough ? drawBough : drawSprig)(g, c*cell, r*cell, cell, rng, spec); else drawClump(g, c*cell, r*cell, cell, rng);
  });
  return { texture, cols, rows, count: cols*rows };
}

// Registered as a pattern so a tree can ask the language for "a leaf".
definePattern({
  name: 'leaf.maple', scale: SCALE.LEAF,
  generate: ({ rng }) => makeLeafAtlas(rng),
});
definePattern({
  name: 'leaf.clump', scale: SCALE.LEAF,
  generate: ({ rng }) => makeClumpAtlas(rng),
});
definePattern({
  name: 'leaf.oak', scale: SCALE.LEAF,
  generate: ({ rng }) => makeLeafAtlas(rng, { kind: 'oak' }),
});
