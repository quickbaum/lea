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

const SHAPES = {
  maple: { R: MAPLE_R, tips: MAPLE_TIPS, greens: GREENS,     autumn: AUTUMN,     vein: 'rgba(20,50,15,0.5)' },
  oak:   { R: OAK_R,   tips: OAK_TIPS,   greens: OAK_GREENS, autumn: OAK_AUTUMN, vein: 'rgba(30,48,16,0.55)' },
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
  const autumn = rng() < 0.22;
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

// Build an atlas of varied leaves. `kind` is 'maple' or 'oak'.
// Returns { texture, cols, rows, count }.
export function makeLeafAtlas(rng, { cols = 4, rows = 2, cell = 64, kind = 'maple' } = {}){
  const shape = SHAPES[kind] || SHAPES.maple;
  const texture = makeTexture(cols*cell, rows*cell, (g) => {
    g.clearRect(0, 0, cols*cell, rows*cell);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        drawLeaf(g, c*cell, r*cell, cell, rng, shape);
  });
  return { texture, cols, rows, count: cols*rows };
}

// Registered as a pattern so a tree can ask the language for "a leaf".
definePattern({
  name: 'leaf.maple', scale: SCALE.LEAF,
  generate: ({ rng }) => makeLeafAtlas(rng),
});
definePattern({
  name: 'leaf.oak', scale: SCALE.LEAF,
  generate: ({ rng }) => makeLeafAtlas(rng, { kind: 'oak' }),
});
