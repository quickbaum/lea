// ornament.js — shapes the Lea's furniture and fittings share, as geometry: so a brazier's
// bowl and the Turning Stair's column flowers are one petal, not two. Materials are matlib.js's.
//
//   petal(len, open, wid, cup)      one petal, up and out from the stem, curling open, cupped across
//   petalRing(n, len, open, wid, cup, turn, lift)   n of them round the upright
//   brazierGeo()                    a standing iron brazier (its coals apart: brazierCoals())
//   lecternGeo()                    an oak choir lectern, its desk sloping to the reader (+z)
//
// Each is built at the origin, standing on y = 0, and cached: place it by matrix or instancing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { placedBox } from './matlib.js';

export function petal(len, open, wid, cup){
  const pos = [], uv = [], idx = [], NS = 10, NW = 6;
  for (let i = 0; i <= NS; i++) for (let j = 0; j <= NW; j++){
    const t = i / NS, w = (j / NW - 0.5) * 2, half = wid * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.35 * t);
    const rr = 0.1 + len * open * t * t + len * 0.25 * t, yy = len * (t - 0.45 * open * t * t) + cup * w * w * half;
    pos.push(rr, yy, w * half); uv.push(t, j / NW);
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NW; j++){ const a = i * (NW + 1) + j, b = a + NW + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
export const petalRing = (n, len, open, wid, cup, turn, lift) => Array.from({ length: n }, (_, q) => { const g = petal(len, open, wid, cup); g.rotateY(turn + q / n * Math.PI * 2); g.translate(0, lift, 0); return g; });

// a lathe from a profile [[r, y], …], its UVs in world units (u round, v up)
function lathe(profile, seg = 20){
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), uv = g.attributes.uv, p = g.attributes.position;
  for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * 2 * Math.PI * 0.12, p.getY(q));
  return g;
}
// a bead: a small round swelling at y, for a profile
const bead = (y, at, r = 0.035, w = 0.04) => r * Math.exp(-(((y - at) / w) ** 2));
const flat = g => { const q = g.index ? g.toNonIndexed() : g; if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2)); return q; };

// A standing brazier in wrought iron, 1.35u to its rim, about 1.1u across its feet: a turned
// stem, beaded and swelling to a knop, on three legs that curve out and end in scrolls,
// braced by a ring; at the top a collar, and the bowl, two rings of curled iron petals as the
// Turning Stair's column flowers are, cupping the coals. Petals are thin: draw it double-sided.
let BRAZIER = null;
export function brazierGeo(){
  if (BRAZIER) return BRAZIER;
  const parts = [];
  // the stem: from the legs' meeting (0.3) up to the bowl's foot (0.95)
  const prof = [];
  for (let q = 0; q <= 40; q++){
    const y = 0.28 + q / 40 * 0.72;
    prof.push([0.045 + 0.05 * Math.exp(-(((y - 0.62) / 0.07) ** 2)) + bead(y, 0.5) + bead(y, 0.74) + bead(y, 0.3, 0.05, 0.03) + 0.06 * Math.max(0, (y - 0.9) / 0.1) ** 2, y]);
  }
  parts.push(lathe([[0, 0.28], ...prof, [0, 1.0]]));
  // three legs: out from under the stem, down in a curve, a scroll turned up at each foot
  for (let k = 0; k < 3; k++){
    const a = k / 3 * Math.PI * 2, P = (r, y) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const pts = [P(0.04, 0.4), P(0.14, 0.32), P(0.32, 0.2), P(0.45, 0.08)];
    for (let q = 0; q <= 12; q++){ const t = q / 12 * Math.PI * 1.6, s = 0.08 * (1 - q / 16); pts.push(P(0.45 + 0.05 + Math.sin(t) * s, 0.08 + (1 - Math.cos(t)) * s * 0.9)); }   // the scroll
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.028, 6));
  }
  const brace = new THREE.TorusGeometry(0.2, 0.018, 6, 24); brace.rotateX(Math.PI / 2); brace.translate(0, 0.25, 0); parts.push(brace);
  const collar = new THREE.TorusGeometry(0.13, 0.03, 8, 24); collar.rotateX(Math.PI / 2); collar.translate(0, 1.0, 0); parts.push(collar);
  // the bowl: a shallow dish under the petals, then two rings of them, the inner one turned between the outer's
  parts.push(lathe([[0, 0.98], [0.2, 1.0], [0.34, 1.08], [0.38, 1.14], [0.36, 1.15], [0.32, 1.1], [0.18, 1.05], [0, 1.04]]));
  parts.push(...petalRing(8, 0.55, 0.75, 0.2, 0.35, 0, 0.98), ...petalRing(8, 0.38, 0.4, 0.14, 0.45, Math.PI / 8, 1.02));
  BRAZIER = mergeGeometries(parts.map(flat));
  BRAZIER.computeVertexNormals();
  return BRAZIER;
}
// the coals heaped in its bowl: a lumpy dome, lit from within when it burns
let COALS = null;
export function brazierCoals(){
  if (COALS) return COALS;
  const g = new THREE.IcosahedronGeometry(0.3, 2), p = g.attributes.position, v = new THREE.Vector3();
  for (let q = 0; q < p.count; q++){
    v.fromBufferAttribute(p, q);
    const n = 1 + 0.18 * Math.sin(v.x * 23 + v.z * 7) * Math.sin(v.z * 19 - v.y * 11);
    p.setXYZ(q, v.x * n, Math.max(-0.02, v.y * 0.42 * n), v.z * n);
  }
  g.computeVertexNormals(); g.translate(0, 1.12, 0);
  return (COALS = g);
}

// An oak choir lectern: a cross of feet, a turned post, and a desk sloping down toward the
// reader (+z) with a ledge for the book, 1.25u to its top edge. The open book is apart
// (lecternBook), being paper and leather.
const DESK = { w: 0.8, d: 0.6, tilt: 0.6, y: 1.08 };       // the desk: size, slope (rad), the height of its middle
let LECTERN = null;
export function lecternGeo(){
  if (LECTERN) return LECTERN;
  const parts = [placedBox(0, 0.05, 0, 0.9, 0.1, 0.12, 0, 'x'), placedBox(0, 0.05, 0, 0.12, 0.1, 0.9, 0, 'z'), placedBox(0, 0.14, 0, 0.24, 0.08, 0.24)];
  const prof = [];
  for (let q = 0; q <= 30; q++){ const y = 0.18 + q / 30 * 0.72; prof.push([0.06 + 0.035 * Math.exp(-(((y - 0.5) / 0.08) ** 2)) + bead(y, 0.32, 0.02, 0.03) + bead(y, 0.7, 0.02, 0.03) + 0.05 * Math.max(0, (y - 0.82) / 0.08) ** 2, y]); }
  parts.push(lathe([[0, 0.18], ...prof, [0, 0.9]], 16));
  // the desk: a board on a block, tilted so its low edge (with the ledge) faces the reader
  const desk = [placedBox(0, 0, 0, DESK.w, 0.05, DESK.d, 0, 'x'), placedBox(0, 0.04, DESK.d / 2 - 0.02, DESK.w, 0.05, 0.04, 0, 'x')];
  const d = mergeGeometries(desk.map(flat)); d.rotateX(DESK.tilt); d.translate(0, DESK.y, 0);
  const block = placedBox(0, 0.95, 0, 0.3, 0.14, 0.3);
  LECTERN = mergeGeometries([...parts, block].map(flat).concat([d]));
  LECTERN.computeVertexNormals();
  return LECTERN;
}
// the open book on it: two leaves of parchment bowed up from the spine, on its leather boards,
// lying on the desk's slope. Returns { boards, pages }, the pages UV'd 0..1 across both leaves
let BOOK = null;
export function lecternBook(){
  if (BOOK) return BOOK;
  const W = 0.62, D = 0.42, pos = [], uv = [], idx = [], N = 16, M = 2;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++){
    const u = i / N, x = (u - 0.5) * W, y = 0.035 + 0.03 * Math.sin(Math.PI * Math.abs(u - 0.5) * 2) ** 0.6, z = (j / M - 0.5) * D;
    pos.push(x, y, z); uv.push(u, 1 - j / M);
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++){ const a = i * (M + 1) + j, b = a + M + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const pages = new THREE.BufferGeometry(); pages.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pages.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); pages.setIndex(idx); pages.computeVertexNormals();
  const boards = flat(placedBox(0, 0.015, 0, W + 0.06, 0.03, D + 0.05, 0, 'x'));
  for (const g of [pages, boards]){ g.rotateX(DESK.tilt); g.translate(0, DESK.y + 0.03, 0); }
  return (BOOK = { boards, pages });
}
