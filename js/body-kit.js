// body-kit.js — a different body for every character, made in the browser.
//
// tools/anny_morphs.py bakes ANNY's shape axes (age, height, weight, muscle,
// proportions, cupsize) as deltas from a woman's and a man's base body — vertex
// moves and joint moves, 0.1 mm int16 (models/body_morphs.*). makeBody mixes them:
// for each axis, the delta toward its lo or hi sample, scaled by how far the
// character's value goes. ANNY is linear blendshapes with joints taken linearly
// from the mesh, so this is exact at the samples and close between them.
//
// GIRTH is one axis ANNY doesn't give: weight and muscle move the surface only
// 2-3.5 cm at their extremes, too little to read at sprite scale. Girth scales the
// body horizontally about its own axis (mesh and joints together); clothes are cut
// from the body afterwards, so they fit it.
//
// The skeleton is moved, not just the skin: each bone's rest position follows its
// joint, keeping the base rest ROTATIONS (they change by a degree or two across
// shapes), then the bind is recomputed. Walk clips fit per body (walk_anim.js), so
// they need nothing more.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const norm = n => n.replace(/[^a-z0-9]/gi, '').toLowerCase();

let _kit = null;
export function loadBodyKit(base = 'models/'){
  return _kit ??= (async () => {
    const loader = new GLTFLoader();
    const [index, bin, f, m] = await Promise.all([
      fetch(base + 'body_morphs.json').then(r => r.json()),
      fetch(base + 'body_morphs.bin').then(r => r.arrayBuffer()),
      loader.loadAsync(base + 'body_f.glb'), loader.loadAsync(base + 'body_m.glb')]);
    return { index, data: new Int16Array(bin), gltf: { f, m } };
  })();
}

// Body params for a character from a seed. Ranges keep everyone an adult and in
// proportion; height and girth carry most of the silhouette.
export function randomBody(seed, gender = 'f'){
  let st = (seed | 0) ^ 0x2545f491;
  const r = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => (r() + r()) / 2;                      // a soft bell: most near the middle, some far out
  const f = gender === 'f';
  return {
    gender: f ? 'f' : 'm',
    age: 0.62 + 0.33 * n() ** 1.4,                      // young adult .. old, skewed young
    height: (f ? 0.34 : 0.37) + (n() - 0.5) * 0.26,      // ~1.50-1.68 m women, 1.63-1.82 m men
    weight: 0.1 + 0.85 * n(), muscle: 0.1 + 0.85 * n(),
    proportions: 0.2 + 0.65 * r(),
    cupsize: f ? 0.2 + 0.7 * r() : 0,
    girth: 0.87 + 0.3 * n(),
  };
}

export function makeBody(kit, p){
  const g = p.gender === 'm' ? 'm' : 'f', E = kit.index[g], S = kit.index.scale;
  const root = cloneSkinned(kit.gltf[g].scene);
  let skin = null;
  root.traverse(o => { if (o.isSkinnedMesh && (!skin || o.material?.name === 'skin')) skin = o; });
  // SkeletonUtils.clone shares the template's boneInverses ARRAY; calculateInverses
  // below rewrites it, so without a copy every body was built on the last one's bones
  // (they drifted body by body: a giant with flung-out arms by the twentieth villager)
  skin.skeleton.boneInverses = skin.skeleton.boneInverses.map(m => m.clone());
  const nV = E.nVerts, nB = E.nBones, dv = new Float32Array(nV * 3), dj = new Float32Array(nB * 3);
  for (const [ax, s] of Object.entries(E.axes)){
    const v = p[ax]; if (v == null) continue;
    const b = E.base[ax], up = v >= b, side = up ? s.hi : s.lo;
    const t = Math.min(1.25, Math.max(0, up ? (v - b) / (s.hi.value - b) : (b - v) / (b - s.lo.value)));
    if (!t) continue;
    const off = side.offset / 2, k = S * t, D = kit.data;
    for (let i = 0; i < nV * 3; i++) dv[i] += D[off + i] * k;
    for (let i = 0; i < nB * 3; i++) dj[i] += D[off + nV * 3 + i] * k;
  }
  // the mesh (its own geometry; the template's stays untouched)
  skin.geometry = skin.geometry.clone();
  const P = skin.geometry.attributes.position, bones = skin.skeleton.bones;
  const base = bones.map((b, i) => new THREE.Matrix4().copy(skin.skeleton.boneInverses[i]).invert());
  const rootPos = new THREE.Vector3().setFromMatrixPosition(base[0]);
  const gi = p.girth ?? 1, cx = rootPos.x, cz = rootPos.z;
  const girth = (x, z) => [cx + (x - cx) * gi, cz + (z - cz) * gi];
  for (let i = 0; i < nV; i++){
    const [x, z] = girth(P.getX(i) + dv[i*3], P.getZ(i) + dv[i*3+2]);
    P.setXYZ(i, x, P.getY(i) + dv[i*3+1], z);
  }
  P.needsUpdate = true; skin.geometry.computeBoundingBox(); skin.geometry.computeBoundingSphere();
  // the skeleton: rest positions follow the joints, rest rotations stay
  const J = base.map((m, i) => { const q = new THREE.Vector3().setFromMatrixPosition(m);
    const [x, z] = girth(q.x + dj[i*3], q.z + dj[i*3+2]); return new THREE.Vector3(x, q.y + dj[i*3+1], z); });
  const index = new Map(bones.map((b, i) => [b, i]));
  const rotInv = base.map(m => new THREE.Quaternion().setFromRotationMatrix(m).invert());
  for (let i = 0; i < nB; i++){
    const pb = bones[i].parent, pi = pb && index.has(pb) ? index.get(pb) : -1;
    if (pi < 0){ bones[i].position.copy(J[i]); continue; }
    bones[i].position.copy(J[i]).sub(J[pi]).applyQuaternion(rotInv[pi]);
  }
  root.updateMatrixWorld(true);
  skin.skeleton.calculateInverses();
  skin.bind(skin.skeleton, skin.matrixWorld);
  const bmap = new Map(), rest = new Map();
  root.traverse(o => { if (o.isBone){ bmap.set(norm(o.name), o); rest.set(norm(o.name), o.quaternion.clone()); } });
  return { root, skin, bones: bmap, rest, params: { ...p, gender: g } };
}
