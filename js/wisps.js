// The Gentry's lights (gen/faerie.js palaceWisps, stairWisps): no torches in Faerie, but
// lights that float along paths through the columns, each trailing a fading tail. The
// nearest few carry real light, from a fixed pool, so the scene's light count never
// changes and nothing recompiles.
//
//   wisps(parent, paths, { lights, spacing, reach })  →  { update(dt, camera, t, music), fade(k) }
//
// Each winds round its path in a spiral as it goes: some alone, some in twos wound round each other,
// and some with a quicker light threading the middle of the spirals on its path.
//
// In a palace hall where the band plays, the lights dance to it (docs/music.md "Built: the
// Gentry's lights dance"): `music` is { x, y, z, reach, f }, where the band stands, how far its
// spell goes, and f, dance.js feel() at this moment. Each light near enough (more, the nearer)
//   · steps with the beat: it rushes on at each beat's head and all but stops before the next
//   · rises and falls with the tune's pitch, each a little behind the last, so it ripples
//   · flares on the drums' strokes (a dum the most), and swells a little on each beat
// and eases in when the music starts and out when it stops.
//
// Out in the Lea (faerie-view.js) the paths run for hundreds of units and no light may be
// added to the scene: `reach` shows each light only within that far of you, and `lights: 0`
// makes them glow without lighting anything.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';
import { crisp } from './textures.js';

const COLOURS = [0xcab8ff, 0x9fb8ff, 0xffe6b0, 0xe8c8ff, 0xb0f0ff];
const SPACING = 11;                  // u of path to each light
const TAIL = 5, TAIL_GAP = 0.32;     // the tail: how many motes, how far apart (u)
const SPEED = [1.6, 2.8];            // u/s
const NEAR = 70;                     // beyond this they aren't moved (the fog hides them)
const SURGE = 0.85;                  // dancing: how much of its going a light puts into each beat's head (1: stops dead between)
const LIFT = 1.0;                    // dancing: u between the tune's lowest note and its highest (no more than the path has room for)
const FLARE = 0.9, SWELL = 0.25;     // dancing: brighter on a stroke, and on a beat's head
// Each light winds round its path as it goes, in a spiral as wide as the path has room for
// (path.room, [across, up]: gen/faerie.js palaceWisps); a path with none given is out in the open
const SPIN = [1.4, 2.6];             // radians a second round the path, one way or the other
const OPEN_ROOM = [0.8, 0.6];
const PAIR = 0.35, THREAD = 0.2, THREAD_SPEED = 1.7;   // of the lights: wound in twos round each other; with a quicker one threading the spirals

let HALO = null;
export function haloTex(){
  if (HALO) return HALO;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return HALO = crisp(new THREE.CanvasTexture(cv));
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

export function wisps(scene, paths, { lights = 6, spacing = SPACING, reach = 0 } = {}){
  const r = mulberry32(0x3157), tex = haloTex(), all = [];
  for (const path of paths){
    const M = measure(path), n = Math.max(1, Math.round(M.len / spacing)), [ru, rv] = path.room ?? OPEN_ROOM;
    for (let q = 0; q < n; q++){
      const s0 = q * M.len / n + r() * 2, v = (SPEED[0] + r() * (SPEED[1] - SPEED[0])) * (r() < 0.5 ? 1 : -1);
      const turn = (SPIN[0] + r() * (SPIN[1] - SPIN[0])) * (r() < 0.5 ? 1 : -1), a0 = r() * 6.28, fill = 0.75 + r() * 0.2;
      const light = (o = {}) => all.push({ M, s0, v, turn, a0, ru: ru * fill, rv: rv * fill, room: rv,
        colour: new THREE.Color(COLOURS[(r() * COLOURS.length) | 0]), ph: r() * 6.28, pos: new THREE.Vector3(), near: true,
        k: 0, lift: 0, lag: 3 + r() * 5, bright: 1, ...o });   // dancing: how much it's taken by the music, how high it's lifted, how quickly it follows, how bright
      // a light alone; two wound round each other; or one with a quicker one threading the middle of
      // every spiral on its path (the slower lights', going its way or the other)
      const kind = r();
      light();
      if (kind < PAIR) light({ a0: a0 + Math.PI });
      else if (kind < PAIR + THREAD) light({ s0: s0 - 3, v: v * THREAD_SPEED, ru: 0.06, rv: 0.06 });
    }
  }
  // two clouds, one draw each: the motes (each light and its tail, fading), and the soft glow round each light
  const cloud = (n, size, opacity) => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);             // moved every frame: never culled
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: tex, size, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }));
    pts.material.userData.own = true; pts.frustumCulled = false; scene.add(pts);
    return { pos, col, g, mat: pts.material, opacity };
  };
  const motes = cloud(all.length * (TAIL + 1), 0.42, 1), glows = cloud(all.length, 2.4, 0.55);
  all.forEach((w, i) => {
    for (let k = 0; k <= TAIL; k++){ const f = 1 - k / (TAIL + 1); motes.col.set([w.colour.r * f, w.colour.g * f, w.colour.b * f], (i * (TAIL + 1) + k) * 3); }
    glows.col.set([w.colour.r, w.colour.g, w.colour.b], i * 3);
  });
  const pool = [];
  for (let q = 0; q < lights; q++){ const l = new THREE.PointLight(0xffffff, 0, 12, 1.4); scene.add(l); pool.push(l); }
  const tmp = new THREE.Vector3(), FAR = -1e4, A = new THREE.Vector3(), B = new THREE.Vector3();
  // the point `s` along a path, moved u across it (level) and v up from it (across its way: on a
  // climbing path, leaning with it)
  const wind = (M, s, u, v, out) => {
    M.at(s + 0.15, A); M.at(s - 0.15, B);
    let tx = A.x - B.x, ty = A.y - B.y, tz = A.z - B.z; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let nx = -tz, nz = tx; const nl = Math.hypot(nx, nz); if (nl < 1e-3){ nx = 1; nz = 0; } else { nx /= nl; nz /= nl; }
    M.at(s, out);
    return out.set(out.x + nx * u - ty * nz * v, out.y + (tx * nz - tz * nx) * v, out.z + nz * u + ty * nx * v);   // (up across it: the path's way crossed with level-across)
  };
  let recolour = false;
  return {
    count: all.length,
    update(dt, camera, t, music = null){
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, live = [], f = music?.f;
      const step = f?.on ? f.beatLen * Math.sin(2 * Math.PI * f.beat) / (2 * Math.PI) : 0;   // (its going, bunched onto the beats' heads)
      all.forEach((w, i) => {
        // how much the music has it: the nearer the band, the more, easing in and out
        const want = f?.on ? Math.max(0, 1 - Math.hypot(w.pos.x - music.x, (w.pos.y - music.y) * 3, w.pos.z - music.z) / music.reach) : 0;
        w.k += (want - w.k) * Math.min(1, dt / 1.2);
        const go = t + w.k * SURGE * step, s = w.s0 + w.v * go, dir = Math.sign(w.v), base = i * (TAIL + 1) * 3;
        if (reach) w.M.at(s, w.pos);
        const near = reach ? Math.hypot(w.pos.x - cx, w.pos.z - cz) < reach : Math.hypot(w.M.cx - cx, w.M.cz - cz) - w.M.r < NEAR;
        if (!near){
          if (w.near) for (let k = 0; k <= TAIL; k++){ motes.pos[base + k * 3 + 1] = FAR; glows.pos[i * 3 + 1] = FAR; }
          w.near = false; return;
        }
        w.near = true;
        // the tune's pitch lifts it (each at its own lag), the strokes and the beats brighten it
        w.lift += ((f?.on ? (f.rise - 0.5) * LIFT : 0) - w.lift) * Math.min(1, dt * w.lag);
        const up = Math.max(-w.room, Math.min(w.room, w.k * w.lift)), beat = f?.on ? FLARE * f.accent + SWELL * f.pulse : 0, bright = 1 + w.k * beat;
        // winding round its path: a spiral as it goes (wider on a stroke, and quicker round with the
        // beat, as it goes on with it), lifted with the pitch; never wider than the path has room for
        // (lifted, it winds a smaller oval round the lifted middle, so it stays inside the room's oval: the
        // lifted oval is the room's shrunk toward its top, or its bottom)
        const shrink = w.room ? 1 - Math.abs(up) / w.room : 1, wide = (0.8 + 0.2 * Math.min(1, w.k * beat)) * shrink, ru = w.ru * wide, rv = w.rv * wide;
        for (let k = 0; k <= TAIL; k++){                            // the light, then its tail where it was a moment ago
          const sk = s - dir * k * TAIL_GAP, a = w.a0 + w.turn * (go - k * TAIL_GAP / Math.abs(w.v));
          const p = wind(w.M, sk, Math.cos(a) * ru, Math.sin(a) * rv + up, k ? tmp : w.pos);
          motes.pos.set([p.x, p.y, p.z], base + k * 3);
        }
        glows.pos.set([w.pos.x, w.pos.y, w.pos.z], i * 3);
        if (Math.abs(bright - w.bright) > 0.01){
          w.bright = bright; recolour = true;
          for (let k = 0; k <= TAIL; k++){ const g = bright * (1 - k / (TAIL + 1)); motes.col.set([w.colour.r * g, w.colour.g * g, w.colour.b * g], (i * (TAIL + 1) + k) * 3); }
          glows.col.set([w.colour.r * bright, w.colour.g * bright, w.colour.b * bright], i * 3);
        }
        live.push(w);
      });
      motes.g.attributes.position.needsUpdate = true; glows.g.attributes.position.needsUpdate = true;
      if (recolour){ motes.g.attributes.color.needsUpdate = true; glows.g.attributes.color.needsUpdate = true; recolour = false; }
      if (!pool.length) return;
      live.sort((a, b) => a.pos.distanceToSquared(camera.position) - b.pos.distanceToSquared(camera.position));
      pool.forEach((l, q) => {
        const w = live[q];
        if (!w || Math.hypot(w.pos.x - cx, w.pos.y - cy, w.pos.z - cz) > 40){ l.intensity = 0; return; }
        l.position.copy(w.pos); l.color.copy(w.colour); l.intensity = 2.4 * (0.85 + 0.15 * Math.sin(t * 2.1 + w.ph)) * (1 + 0.6 * (w.bright - 1));
      });
    },
    fade(k){ motes.mat.opacity = motes.opacity * k; glows.mat.opacity = glows.opacity * k; },
  };
}
