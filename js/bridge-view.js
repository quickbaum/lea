// The bridges over the rivers, drawn: land.js lays their decks (so whoever
// crosses stands on them) and keeps the ground under them for the river; this
// draws what holds the deck up.
//   stone   the Old Road's: coursed ashlar on round arches, a parapet each side;
//           the road's own paving (road-view.js) runs over the top
//   timber  a lane's: a plank deck on stringers, driven piles in the water, a rail each side
//   foot    the folk's: the same, narrower, humped a little in the middle
// Each bridge is built in its own frame — u along it from bank to bank, y up,
// v across — as shapes extruded across it, then merged into one mesh per bridge.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bridges, groundHeight } from './terrain.js';
import { WATER } from './config.js';
import { ashlar } from './stone-tex.js';
import { makeTexture } from './textures.js';
import { mulberry32 } from './rng.js';

const STONE_TILE = 2.6;            // u of wall one ashlar tile covers
const WOOD_TILE = 2;

function stoneMaterial(){
  const t = ashlar(0xb41d6e, { courses: 4, len: [10, 22], wear: 1.2, tone: [140, 132, 116], moss: 0.45 });
  for (const m of [t.map, t.normalMap]) m.repeat.set(1 / STONE_TILE, 1 / STONE_TILE);
  return new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap });
}
// weathered boards: grey-brown, with the grain along them and dark gaps between
function woodMaterial(){
  const map = makeTexture(32, 32, (g, w, h) => {
    const r = mulberry32(0x900d51);
    for (let y = 0; y < h; y++){
      const board = Math.floor(y / 8), gap = y % 8 === 7;
      const tone = 0.85 + ((board * 37) % 5) * 0.05;
      for (let x = 0; x < w; x++){
        const grain = Math.sin(x * 0.7 + board * 3 + Math.sin(y * 1.3) * 0.8) * 8 + (r() - 0.5) * 14;
        const c = gap ? [44, 36, 28] : [118 * tone + grain, 100 * tone + grain, 78 * tone + grain * 0.8];
        g.fillStyle = `rgb(${c.map(v => Math.max(0, Math.min(255, v | 0))).join(',')})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  }, { repeat: [1 / WOOD_TILE, 1 / WOOD_TILE] });
  return new THREE.MeshLambertMaterial({ map });
}

// a band between bot(u) and top(u) over [u0, u1], extruded `depth` across from v0
function band(u0, u1, bot, top, v0, depth, step = 1){
  const s = new THREE.Shape();
  const n = Math.max(1, Math.ceil((u1 - u0) / step));
  s.moveTo(u0, bot(u0));
  for (let k = 0; k <= n; k++){ const u = u0 + (u1 - u0) * k / n; s.lineTo(u, top(u)); }
  for (let k = n; k >= 0; k--){ const u = u0 + (u1 - u0) * k / n; s.lineTo(u, bot(u)); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, v0);
  return g;
}
function box(u, v, y0, y1, su, sv){
  const g = new THREE.BoxGeometry(su, y1 - y0, sv);
  g.translate(u, (y0 + y1) / 2, v);
  return g.toNonIndexed();
}

// the body of a stone bridge: a wall the deck's width, with its arches cut out of the bottom
function stoneBody(b, W){
  const L = b.len, top = u => b.deck(u) - 0.02, bot = WATER - 3;
  let lo = Infinity; for (let u = 0; u <= L; u += 1) lo = Math.min(lo, top(u));
  const n = Math.max(1, Math.round((L - 2) / 13)), pier = 1.8;
  const a = (L - 2 - (n - 1) * pier) / n;
  const s = new THREE.Shape();
  s.moveTo(-3, bot);
  for (let u = -3; u <= L + 3 + 1e-6; u += 1) s.lineTo(u, top(u));
  s.lineTo(L + 3, bot);
  for (let j = n - 1; j >= 0; j--){
    const u0 = 1 + j * (a + pier), u1 = u0 + a, uc = (u0 + u1) / 2;
    const rise = Math.max(0.6, Math.min(a / 2, lo - 0.9 - (WATER + 0.1)));
    const ys = lo - 0.9 - rise;                                       // the springing line
    const R = (a * a / 4 + rise * rise) / (2 * rise), yc = ys + rise - R;
    const p0 = Math.atan2(ys - yc, u1 - uc), p1 = Math.PI - p0;
    s.lineTo(u1, bot); s.lineTo(u1, ys);
    for (let k = 1; k <= 12; k++){ const p = p0 + (p1 - p0) * k / 12; s.lineTo(uc + R * Math.cos(p), yc + R * Math.sin(p)); }
    s.lineTo(u0, bot);
  }
  s.lineTo(-3, bot);
  const g = new THREE.ExtrudeGeometry(s, { depth: 2 * W, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -W);
  return g;
}

function stoneBridge(b){
  const W = b.hw + 0.45, top = u => b.deck(u) - 0.02;
  const parts = [stoneBody(b, W)];
  for (const v0 of [b.hw, -b.hw - 0.45])                              // parapets, knee-high and a hand thick
    parts.push(band(-2.5, b.len + 2.5, top, u => top(u) + 0.95, v0, 0.45));
  return { stone: parts, wood: [] };
}

function timberBridge(b){
  const L = b.len, hw = b.hw, deck = u => b.deck(u);
  const wood = [band(-0.4, L + 0.4, u => deck(u) - 0.2, deck, -hw, 2 * hw, 0.5)];
  for (const v of [-hw + 0.35, hw - 0.65]) wood.push(band(-0.4, L + 0.4, u => deck(u) - 0.5, u => deck(u) - 0.2, v, 0.3, 0.5));
  // piles where the deck is over water or soft bank, in pairs
  const wet = u => groundHeight(b.ax + (b.bx - b.ax) * u / L, b.az + (b.bz - b.az) * u / L) < WATER + 0.4;
  const span = [];
  for (let u = 0.5; u < L - 0.5; u += 0.5) if (wet(u)) span.push(u);
  if (span.length){
    const u0 = span[0], u1 = span[span.length - 1], n = Math.max(1, Math.round((u1 - u0) / 4.5));
    for (let k = 0; k <= n; k++){
      const u = n ? u0 + (u1 - u0) * k / n : (u0 + u1) / 2;
      const g = groundHeight(b.ax + (b.bx - b.ax) * u / L, b.az + (b.bz - b.az) * u / L);
      for (const v of [-hw + 0.5, hw - 0.5]) wood.push(box(u, v, g - 0.6, deck(u) - 0.2, 0.28, 0.28));
    }
  }
  // posts and a rail each side
  const np = Math.max(2, Math.round(L / 2.5));
  for (let k = 0; k <= np; k++){
    const u = L * k / np;
    for (const v of [-hw + 0.08, hw - 0.08]) wood.push(box(u, v, deck(u) - 0.2, deck(u) + 1.0, 0.16, 0.16));
  }
  for (const v0 of [-hw, hw - 0.14]) wood.push(band(0, L, u => deck(u) + 0.86, u => deck(u) + 1.0, v0, 0.14, 0.5));
  return { stone: [], wood };
}

export function buildBridges(scene){
  const list = bridges();
  if (!list.length) return [];
  const mats = { stone: stoneMaterial(), wood: woodMaterial() };
  const meshes = [];
  for (const b of list){
    const parts = b.kind === 'stone' ? stoneBridge(b) : timberBridge(b);
    const dx = (b.bx - b.ax) / b.len, dz = (b.bz - b.az) / b.len;
    for (const k of ['stone', 'wood']){
      if (!parts[k].length) continue;
      const geo = mergeGeometries(parts[k].map(g => g.index ? g.toNonIndexed() : g), false);
      for (const g of parts[k]) g.dispose();
      // the frame: u along the bridge (local x), v across (local z), at its first bank
      const m = new THREE.Mesh(geo, mats[k]);
      m.rotation.y = Math.atan2(-dz, dx);
      m.position.set(b.ax, 0, b.az);
      geo.computeBoundingSphere();
      scene.add(m);
      meshes.push(m);
    }
  }
  return meshes;
}
