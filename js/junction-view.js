// junction-view.js — the signpost and the mailbox where a lane meets the road, drawn. The plan is
// in js/gen/settle.js (planJunctions), the letters in js/mail.js.
//
// The sign is a plank pointing up the lane, so it reads head on from the road, with planks across it
// above, pointing on along the road to the other places on it. Names are seeded per world, so painted at
// run time, a pixel at a time in the lettering of the sign at the top of the window, and never blurry.
// The box's flag is its own mesh, up while there are letters in it.

import * as THREE from 'three';
import { POST_R } from './gen/settle.js';
import { Geo } from './settle-view.js';
import { UNITS_PER_M } from './config.js';

const M = UNITS_PER_M, SINK = 0.4;
const SIGN_H = 1.95 * M;   // the lane's plank, off the ground: above a walker's head, as the others stacked over it
const WOOD = [0.30, 0.22, 0.14], IRON = [0.28, 0.28, 0.30], BOX_WOOD = [0.40, 0.30, 0.19], DOOR = [0.30, 0.22, 0.14], RED = [0.78, 0.12, 0.08];
const BOX_Y = 0.92 * M, BOX_LEN = 0.78 * M, BOX_W = 0.38 * M, BOX_H = 0.25 * M;              // the box's floor; and its size to the eaves
const FLAG_S = 0.45;                 // s for the flag to go up or down
// the planks are painted a pixel at a time, at the size of the HUD sign's lettering's own grid, and drawn crisp
const PX = 16, ROW = 21, PX_PER_U = 24;       // the font's size in canvas pixels; a plank's height in them; canvas pixels to a world unit
const PLANK_U = ROW / PX_PER_U, TIP_U = PLANK_U * 0.55, THICK = 0.19, ROW_GAP = 0.5 * M;   // (a plank's real thickness: not cardboard)
const POST_OVER = 0.28 * M, EDGE = [0.86, 0.84, 0.8];
const GOLD = [255, 226, 120];     // no outline: at the game's chunky pixels an outline swallows the letter

// a mask of one line of lettering, thresholded so nothing's antialiased
function lettering(name, font){
  const cv = document.createElement('canvas'), g0 = cv.getContext('2d', { willReadFrequently: true });
  g0.font = `${PX}px ${font}`;
  const w = Math.ceil(g0.measureText(name).width) + 2;
  cv.width = w; cv.height = ROW;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.font = `${PX}px ${font}`; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  g.fillText(name, 1, ROW / 2 + 1);
  const d = g.getImageData(0, 0, w, ROW).data, on = new Uint8Array(w * ROW);
  for (let i = 0; i < on.length; i++) on[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  return { w, on };
}
// the wood, a pixel at a time: runs of grain along the plank
function wood(px, W, x0, y0, w, seed){
  for (let y = 0; y < ROW; y++){
    const run = 0.85 + 0.2 * Math.abs(Math.sin((y + seed) * 2.3));
    for (let x = 0; x < w; x++){
      const n = Math.sin((x + y * 37 + seed * 11) * 12.9898) * 43758.5453, r = n - Math.floor(n);
      const k = (y === 0 || y === ROW - 1 ? 0.72 : run) * (r < 0.06 ? 0.86 : r > 0.95 ? 1.08 : 1), o = ((y0 + y) * W + x0 + x) * 4;
      px[o] = 78 * k; px[o + 1] = 54 * k; px[o + 2] = 32 * k; px[o + 3] = 255;
    }
  }
}
function stamp(px, W, x0, y0, m){
  for (let y = 0; y < ROW; y++) for (let x = 0; x < m.w; x++){
    if (!m.on[y * m.w + x]) continue;
    const o = ((y0 + y) * W + x0 + x) * 4;
    px[o] = GOLD[0]; px[o + 1] = GOLD[1]; px[o + 2] = GOLD[2];
  }
}
// the planks of one post, painted into one crisp canvas: two rows each, for the two faces (the point's
// to the viewer's right on one, the left on the other). specs: [{ name }]; returns each plank's length and rows.
function paintPlanks(specs, font){
  const pad = 6, tipPx = Math.round(TIP_U * PX_PER_U);
  const masks = specs.map(q => lettering(q.name, font)), widths = masks.map(m => m.w + pad * 2 + tipPx);
  const W = Math.max(...widths), H = ROW * (specs.length * 2 + 1), cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), im = g.createImageData(W, H);
  const rows = specs.map((q, i) => {
    const r = i * 2 * ROW, w = widths[i];
    wood(im.data, W, 0, r, w, i * 2 + 1); stamp(im.data, W, pad, r, masks[i]);                    // point on the right
    wood(im.data, W, 0, r + ROW, w, i * 2 + 2); stamp(im.data, W, pad + tipPx, r + ROW, masks[i]);  // point on the left
    return { len: w / PX_PER_U, w, right: r, left: r + ROW };
  });
  wood(im.data, W, 0, H - ROW, W, 99);    // a row of plain wood, for the planks' edges
  g.putImageData(im, 0, 0);
  // crisp up close; further off, each of the game's big pixels averages what's under it, or strokes drop out and it's unreadable
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapNearestFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, rows, W, H };
}
// a solid plank: its root at (x, y, z), pointing along angle a. Pentagonal, with real edges.
function addPlank(g, x, y, z, a, spec, A){
  const c = Math.cos(a), s = Math.sin(a), P = (u, v, h) => [x + c * u - s * v, y + h, z + s * u + c * v];
  const L = spec.len, ht = PLANK_U / 2, th = THICK / 2, sq = L - TIP_U;
  const out = [[0, -ht], [sq, -ht], [L, 0], [sq, ht], [0, ht]];
  const uvOf = (u, h, row, flip) => [(flip ? L - u : u) / L * spec.w / A.W, 1 - (row + (ht - h) / PLANK_U * ROW) / A.H];
  const W = [1, 1, 1];
  const face = (v, row, flip, nrm) => {
    for (let i = 1; i + 1 < out.length; i++){
      const [a0, a1, a2] = [out[0], out[i], out[i + 1]];
      g.tri(P(a0[0], v, a0[1]), P(a1[0], v, a1[1]), P(a2[0], v, a2[1]), uvOf(a0[0], a0[1], row, flip), uvOf(a1[0], a1[1], row, flip), uvOf(a2[0], a2[1], row, flip), nrm, W);
    }
  };
  face(th, spec.right, false, [-s, 0, c]);        // from this side +u is on your right, and so is the point
  face(-th, spec.left, true, [s, 0, -c]);         // and from this side it's on your left
  const plain = [0.5, 0.5 * ROW / A.H];           // the edges take the plain wood, a little darker
  for (let i = 0; i < out.length; i++){
    const [u0, h0] = out[i], [u1, h1] = out[(i + 1) % out.length];
    const eu = u1 - u0, eh = h1 - h0, l = Math.hypot(eu, eh) || 1, nu = eh / l, nh = -eu / l;     // outward, for this winding
    g.quad(P(u0, -th, h0), P(u1, -th, h1), P(u1, th, h1), P(u0, th, h0), plain, plain, plain, plain, [c * nu, nh, s * nu], EDGE);
  }
}

function roofOver(D, x, z, y, a, len, wid, rise, col){    // a shallow barrel of iron over the box
  const c = Math.cos(a), s = Math.sin(a), P = (u, v, h) => [x + c * u - s * v, y + h, z + s * u + c * v], Z = [0, 0], N = 5;
  for (let i = 0; i < N; i++){
    const q0 = Math.PI * i / N, q1 = Math.PI * (i + 1) / N;
    const v0 = wid / 2 * Math.cos(q0), v1 = wid / 2 * Math.cos(q1), h0 = rise * Math.sin(q0), h1 = rise * Math.sin(q1);
    const qm = (q0 + q1) / 2, ov = Math.cos(qm), oh = Math.sin(qm);
    D.quad(P(-len / 2, v0, h0), P(len / 2, v0, h0), P(len / 2, v1, h1), P(-len / 2, v1, h1), Z, Z, Z, Z, [-s * ov, oh, c * ov], col);
    D.tri(P(len / 2, 0, 0), P(len / 2, v0, h0), P(len / 2, v1, h1), Z, Z, Z, [c, 0, s], DOOR);    // the door's arched top
    D.tri(P(-len / 2, 0, 0), P(-len / 2, v0, h0), P(-len / 2, v1, h1), Z, Z, Z, [-c, 0, -s], col);
  }
}

// The flag, in its own frame: pole up +y from the pivot, the plate at its top. Rotated down to lie along the box.
function flagMesh(mat){
  const g = new Geo(), L = 0.58 * M;
  g.box(0, 0, 0, L, 0.04 * M, 0.03 * M, 0, RED);
  g.box(0.13 * M, 0, L - 0.2 * M, L, 0.26 * M, 0.025 * M, 0, RED);
  return g.mesh(mat);
}

// junctions: from settle.js; nameOf(place): what a sign says; height(x, z): the ground
export function buildJunctions(scene, { junctions, nameOf, height }){
  const group = new THREE.Group(), list = [];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const planks = [];
  junctions.forEach(j => {
    const D = new Geo(), name = nameOf(j.place);
    const y = height(j.x, j.z), by = height(j.box.x, j.box.z);
    const rows = 1 + Math.max(0, ...j.along.map(q => q.row + 1));
    D.box(j.x, j.z, y - SINK, y + SIGN_H + (rows - 1) * ROW_GAP + POST_OVER, POST_R * 2, POST_R * 2, j.a, WOOD);
    D.box(j.box.x, j.box.z, by - SINK, by + BOX_Y, POST_R * 1.6, POST_R * 1.6, j.box.a, WOOD);
    // the box: walls, a roof that's a curve of iron, and a door toward the lane
    const b = j.box, f = by + BOX_Y, c = Math.cos(b.a), s = Math.sin(b.a);
    D.box(b.x, b.z, f, f + BOX_H, BOX_LEN, BOX_W, b.a, BOX_WOOD);
    D.box(b.x + c * (BOX_LEN / 2 + 0.008), b.z + s * (BOX_LEN / 2 + 0.008), f + 0.01, f + BOX_H - 0.01, 0.016, BOX_W * 0.92, b.a, DOOR);
    D.box(b.x + c * (BOX_LEN / 2 + 0.03), b.z + s * (BOX_LEN / 2 + 0.03), f + BOX_H * 0.5, f + BOX_H * 0.5 + 0.05, 0.05, 0.05, b.a, IRON);
    roofOver(D, b.x, b.z, f + BOX_H, b.a, BOX_LEN, BOX_W, BOX_W * 0.48, IRON);
    group.add(D.mesh(mat));
    planks.push({ j, y, specs: [{ name, a: j.a, h: SIGN_H }, ...j.along.map(q => ({ name: nameOf(q.place), a: q.a, h: SIGN_H + (q.row + 1) * ROW_GAP }))] });
    // the flag: a pivot on the box's side, toward the road
    const pivot = new THREE.Group(), side = b.flag * (BOX_W / 2 + 0.03), back = -BOX_LEN * 0.3;
    pivot.position.set(b.x + c * back - s * side, f + BOX_H * 0.55, b.z + s * back + c * side);
    pivot.rotation.y = -b.a;
    const flag = flagMesh(mat), arm = new THREE.Group();
    arm.add(flag); pivot.add(arm); group.add(pivot);
    arm.rotation.z = -Math.PI / 2;     // down: lying along the box, toward the door
    list.push({ j, arm, up: 0, want: 0, name });
  });
  // the planks wait for the lettering, since its width sets their length
  const paint = font => {
    for (const { j, y, specs } of planks){
      const A = paintPlanks(specs, font), G = new Geo();
      specs.forEach((q, i) => addPlank(G, j.x + Math.cos(q.a) * POST_R * 0.6, y + q.h, j.z + Math.sin(q.a) * POST_R * 0.6, q.a, A.rows[i], A));
      group.add(G.mesh(new THREE.MeshLambertMaterial({ map: A.tex, vertexColors: true })));
    }
  };
  const ready = (document.fonts?.load(`${PX}px Alagard`) || Promise.resolve([])).then(f => paint(f.length ? 'Alagard' : 'Georgia,serif'), () => paint('Georgia,serif'));
  scene.add(group);
  return {
    list, ready,
    // wants: for each junction, in order, whether its flag should be up
    update(dt, wants){
      for (let i = 0; i < list.length; i++){
        const q = list[i], w = wants[i] ? 1 : 0;
        if (q.up === w) continue;
        q.up = Math.abs(w - q.up) < dt / FLAG_S ? w : q.up + Math.sign(w - q.up) * dt / FLAG_S;
        const e = q.up * q.up * (3 - 2 * q.up);
        q.arm.rotation.z = -Math.PI / 2 * (1 - e);
      }
    },
  };
}
