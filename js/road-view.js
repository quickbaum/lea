// The Old Road's paving, drawn: a ribbon of fitted polygonal stones between
// kerbs, laid along the centre line js/gen/road.js planned and land.js graded
// the ground to. The ground under it is already the road's colour and level,
// so the ribbon only has to carry the stones. Cut into chunks so three.js can
// frustum-cull the stretches behind you.

import * as THREE from 'three';
import { road, height } from './terrain.js';
import { ROAD_W } from './gen/road.js';
import { makeTexture } from './textures.js';
import { mulberry32 } from './rng.js';

const ACROSS = [-1, -0.6, -0.2, 0.2, 0.6, 1];   // vertices across, as fractions of the half-width
const LIFT = 0.07;                               // above the graded ground
const CROWN = 0.12;                              // the camber: the middle stands this much higher
const CHUNK = 64;                                // samples per mesh (128u of road)
const TEX_LEN = ROAD_W * 4;                      // road length one texture tile covers

// Basalt setts fitted like a jigsaw (a Voronoi of jittered points, wrapped
// along the road so the tile repeats), between rows of long kerb blocks.
function pavingTexture(){
  return makeTexture(64, 128, (g, w, h) => {
    const r = mulberry32(0x0a77a);
    const KERB = 5, ROWS = 14, COLS = 5;
    const cw = (w - 2 * KERB) / COLS, ch = h / ROWS;
    const seeds = [];
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++)
      seeds.push({ x: KERB + (i + 0.15 + r() * 0.7) * cw, y: (j + 0.15 + r() * 0.7) * ch, tone: 0.78 + r() * 0.3, warm: r() });
    const kerbCuts = [0, 0].map(() => { const c = []; for (let y = 0; y < h; y += 14 + (r() * 10 | 0)) c.push(y); return c; });
    const img = g.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const o = (y * w + x) * 4, grain = (r() - 0.5) * 14;
      let c;
      if (x < KERB || x >= w - KERB){
        const side = x < KERB ? 0 : 1, inner = side ? x === w - KERB : x === KERB - 1;
        const joint = inner || kerbCuts[side].includes(y);
        c = joint ? [56, 49, 40] : [138, 131, 116];
      } else {
        let d1 = Infinity, d2 = Infinity, s1 = null;
        for (const s of seeds){
          let dy = Math.abs(y + 0.5 - s.y); if (dy > h / 2) dy = h - dy;
          const e = Math.hypot(x + 0.5 - s.x, dy);
          if (e < d1){ d2 = d1; d1 = e; s1 = s; } else if (e < d2) d2 = e;
        }
        const edge = (d2 - d1) / 2;              // distance to the joint between two stones
        if (edge < 0.7) c = [52, 46, 37];        // packed earth in the joints
        else {
          const k = s1.tone * (0.84 + 0.16 * Math.min(1, edge / 3));
          c = [112 + s1.warm * 14, 109 + s1.warm * 6, 102].map(v => v * k);
        }
      }
      d[o] = Math.max(0, Math.min(255, c[0] + grain));
      d[o + 1] = Math.max(0, Math.min(255, c[1] + grain));
      d[o + 2] = Math.max(0, Math.min(255, c[2] + grain));
      d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

export function buildRoad(scene){
  const R = road(), n = R.xs.length, A = ACROSS.length;
  const map = pavingTexture();
  map.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshLambertMaterial({ map, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const group = new THREE.Group();
  for (let k0 = 0; k0 < n - 1; k0 += CHUNK){
    const k1 = Math.min(n - 1, k0 + CHUNK), rows = k1 - k0 + 1;
    const P = new Float32Array(rows * A * 3), U = new Float32Array(rows * A * 2), idx = [];
    for (let k = k0; k <= k1; k++){
      // across the road: perpendicular to the centre line here (a mitre at the bends)
      const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
      let tx = R.xs[b] - R.xs[a], tz = R.zs[b] - R.zs[a];
      const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      for (let q = 0; q < A; q++){
        const f = ACROSS[q], x = R.xs[k] - tz * f * ROAD_W, z = R.zs[k] + tx * f * ROAD_W;
        const v = ((k - k0) * A + q);
        P[v * 3] = x; P[v * 3 + 1] = height(x, z) + LIFT + CROWN * (1 - f * f); P[v * 3 + 2] = z;
        U[v * 2] = (f + 1) / 2; U[v * 2 + 1] = k * R.step / TEX_LEN;
      }
    }
    for (let k = 0; k < rows - 1; k++) for (let q = 0; q < A - 1; q++){
      const a = k * A + q, b = a + 1, c = a + A, d = c + 1;
      idx.push(a, b, c, b, d, c);             // wound to face up
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    group.add(new THREE.Mesh(geo, mat));
  }
  scene.add(group);
  return group;
}
