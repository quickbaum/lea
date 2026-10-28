// julia-tex.js — Julia-set panels, for the Turning Stair's ramps (faerie-places-view.js).
// Not the whole set: its beauty is at its edge, zoomed. Each panel is a view into one set,
// z → z² + c, found by tools/julia-views.mjs (which scores views at several depths for
// detail) and coloured its own way:
//   'bands'   the smooth escape count, in bands raised along their contours
//   'stripe'  stripe-average colouring: silky curves following the orbit's angle
//   'trap'    how near the orbit came to a point: eyes and pebbles
// Inside the set: enamel cells veined with gold (orbit traps). Rough and metal follow the
// same counts, so filaments and gold shine and the ground is duller. Each panel is framed in
// gold, end to end along the ramp (u) and down both long edges (v).
//
// The arithmetic is in julia-calc.js.
//
//   juliaWhen(name, cb)   cb({ map, normalMap, orm }) (stone-tex.js pbr) for a surface of
//                         JULIA_SURFACES: now if it's made, else when the worker has made it
//   juliaMaterial(name, colour, opts)   a physical material that takes them when they come
//   juliaWarm()           start the worker on all of them (main.js, on entering Faerie)

import * as THREE from 'three';
import { pbr } from './stone-tex.js';
import { juliaRaw, JULIA_SURFACES } from './julia-calc.js';

// the worker makes them in turn (below) and posts each as it's done. Without a worker (or if it fails) they're made here, when asked for
const raw = {}, tex = {}, waiting = {};
let ahead = null, failed = false;
export function juliaWarm(){
  if (ahead || failed || Object.keys(JULIA_SURFACES).every(n => raw[n] || tex[n])) return;
  if (typeof Worker === 'undefined'){ failed = true; return; }
  try { ahead = new Worker(new URL('./julia-worker.js', import.meta.url), { type: 'module' }); } catch { failed = true; return; }
  ahead.onmessage = ({ data: { name, R } }) => {
    raw[name] = R;
    for (const cb of waiting[name] || []) cb(make(name));
    delete waiting[name];
    if (Object.keys(JULIA_SURFACES).every(n => raw[n] || tex[n])){ ahead.terminate(); ahead = null; }
  };
  ahead.onerror = () => {
    ahead?.terminate(); ahead = null; failed = true;
    for (const name in waiting){ const cbs = waiting[name]; delete waiting[name]; for (const cb of cbs) cb(make(name)); }
  };
  // the slabs first: a palace, where Faerie starts, has them on every column; then the stair's
  const first = ['verdeSlab', 'porphyrySlab', 'wallSlab', 'vaultSlab'];
  ahead.postMessage([...first, ...Object.keys(JULIA_SURFACES).filter(n => !first.includes(n))].filter(n => !raw[n] && !tex[n]));
}

function make(name){
  if (tex[name]) return tex[name];
  const R = raw[name] || juliaRaw(name); delete raw[name];
  const t = pbr(R.w, R.h, R.rgb, R.H, 3, R.rough, R.metal);
  // the filigree is fine: mipmapped and smooth, or it shimmers on a ramp seen end-on
  const mirror = JULIA_SURFACES[name].mirror;
  for (const tx of [t.map, t.normalMap, t.orm]){
    if (mirror) tx.wrapS = tx.wrapT = THREE.MirroredRepeatWrapping;
    if (JULIA_SURFACES[name].repeat) tx.repeat.setScalar(JULIA_SURFACES[name].repeat);
    tx.generateMipmaps = true; tx.minFilter = THREE.LinearMipmapLinearFilter; tx.magFilter = THREE.LinearFilter; tx.anisotropy = 4; tx.needsUpdate = true;
  }
  return tex[name] = t;
}

// a material in a surface's panels: plain `colour` until they're made, then the panels
// (physical, so `opts` can add a clear coat, iridescence). Not disposed with a scene
// unless the caller marks it so
export function juliaMaterial(name, colour, opts = {}){
  const m = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.4, metalness: 0, ...opts });
  m.userData.julia = name;
  juliaWhen(name, t => {
    Object.assign(m, { map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1 });
    m.color.set(0xffffff); m.normalScale.set(1.4, 1.4); m.needsUpdate = true;
  });
  return m;
}

export function juliaWhen(name, cb){
  if (tex[name] || raw[name]) return cb(make(name));
  juliaWarm();
  if (!ahead) return cb(make(name));
  (waiting[name] ||= []).push(cb);
}
