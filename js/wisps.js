// The Gentry's lights (gen/faerie.js palaceWisps, stairWisps): no torches in Faerie, but
// lights that float along paths through the columns, each trailing a fading tail. The
// nearest few carry real light, from a fixed pool, so the scene's light count never
// changes and nothing recompiles.
//
//   wisps(scene, paths, { lights })  →  { update(dt, camera, t) }

import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const COLOURS = [0xcab8ff, 0x9fb8ff, 0xffe6b0, 0xe8c8ff, 0xb0f0ff];
const SPACING = 11;                  // u of path to each light
const TAIL = 5, TAIL_GAP = 0.32;     // the tail: how many motes, how far apart (u)
const SPEED = [1.6, 2.8];            // u/s
const NEAR = 70;                     // beyond this they aren't moved (the fog hides them)

let HALO = null;
export function haloTex(){
  if (HALO) return HALO;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return HALO = new THREE.CanvasTexture(cv);
}

// a path, measured: the point `s` along it (a loop wraps; otherwise there and back, easing
// to a stop at each end)
function measure(path){
  const P = path.pts, cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
  if (path.loop){ const a = P.at(-1), b = P[0]; cum.push(cum.at(-1) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])); }
  const len = cum.at(-1), n = path.loop ? P.length + 1 : P.length, pt = i => P[i % P.length];
  const at = (s, out) => {
    if (path.loop) s = ((s % len) + len) % len;
    else { const ph = ((s / len) % 2 + 2) % 2; s = len * (0.5 - 0.5 * Math.cos(Math.PI * ph)); }
    let lo = 1, hi = n - 1;
    while (lo < hi){ const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
    const a = pt(lo - 1), b = pt(lo), f = (s - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 1);
    return out.set(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
  };
  return { len, at, cx: P.reduce((s, p) => s + p[0], 0) / P.length, cz: P.reduce((s, p) => s + p[2], 0) / P.length,
    r: Math.max(...P.map(p => Math.hypot(p[0] - P[0][0], p[2] - P[0][2]))) };
}

export function wisps(scene, paths, { lights = 6 } = {}){
  const r = mulberry32(0x3157), tex = haloTex(), all = [];
  for (const path of paths){
    const M = measure(path), n = Math.max(1, Math.round(M.len / SPACING));
    for (let q = 0; q < n; q++) all.push({ M, s0: q * M.len / n + r() * 2, v: (SPEED[0] + r() * (SPEED[1] - SPEED[0])) * (r() < 0.5 ? 1 : -1),
      colour: new THREE.Color(COLOURS[(r() * COLOURS.length) | 0]), ph: r() * 6.28, pos: new THREE.Vector3(), near: true });
  }
  // two clouds, one draw each: the motes (each light and its tail, fading), and the soft glow round each light
  const cloud = (n, size, opacity) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);             // moved every frame: never culled
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }));
    pts.material.userData.own = true; pts.frustumCulled = false; scene.add(pts);
    return { pos, col, g };
  };
  const motes = cloud(all.length * (TAIL + 1), 0.42, 1), glows = cloud(all.length, 2.4, 0.55);
  all.forEach((w, i) => {
    for (let k = 0; k <= TAIL; k++){ const f = 1 - k / (TAIL + 1); motes.col.set([w.colour.r * f, w.colour.g * f, w.colour.b * f], (i * (TAIL + 1) + k) * 3); }
    glows.col.set([w.colour.r, w.colour.g, w.colour.b], i * 3);
  });
  const pool = [];
  for (let q = 0; q < lights; q++){ const l = new THREE.PointLight(0xffffff, 0, 12, 1.4); scene.add(l); pool.push(l); }
  const tmp = new THREE.Vector3(), FAR = -1e4;
  return {
    count: all.length,
    update(dt, camera, t){
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, live = [];
      all.forEach((w, i) => {
        const near = Math.hypot(w.M.cx - cx, w.M.cz - cz) - w.M.r < NEAR, base = i * (TAIL + 1) * 3;
        if (!near){
          if (w.near) for (let k = 0; k <= TAIL; k++){ motes.pos[base + k * 3 + 1] = FAR; glows.pos[i * 3 + 1] = FAR; }
          w.near = false; return;
        }
        w.near = true;
        const s = w.s0 + w.v * t, dir = Math.sign(w.v);
        w.M.at(s, w.pos);
        glows.pos.set([w.pos.x, w.pos.y, w.pos.z], i * 3);
        for (let k = 0; k <= TAIL; k++){ const p = k ? w.M.at(s - dir * k * TAIL_GAP, tmp) : w.pos; motes.pos.set([p.x, p.y, p.z], base + k * 3); }
        live.push(w);
      });
      motes.g.attributes.position.needsUpdate = true; glows.g.attributes.position.needsUpdate = true;
      live.sort((a, b) => a.pos.distanceToSquared(camera.position) - b.pos.distanceToSquared(camera.position));
      pool.forEach((l, q) => {
        const w = live[q];
        if (!w || Math.hypot(w.pos.x - cx, w.pos.y - cy, w.pos.z - cz) > 40){ l.intensity = 0; return; }
        l.position.copy(w.pos); l.color.copy(w.colour); l.intensity = 2.4 * (0.85 + 0.15 * Math.sin(t * 2.1 + w.ph));
      });
    },
  };
}
