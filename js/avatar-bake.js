// avatar-bake.js — render a character (character.js) into the game's sprite atlas: rows
// are facings front→back (the game mirrors them into 8 directions), columns are the
// stand frame then a 9-frame walk. Same layout as the Pi-side bakes in
// sprites/npc/, so an AnimNPC takes it as-is (AnimNPC.setAtlas).
//
// Runs on the player's machine: one shared WebGLRenderer, one environment for the
// metals (three's RoomEnvironment — no HDRI to download). The skirt's cloth is
// settled over four strides, then one snapshot is kept per walk frame.
//
// Exposure is FIXED, not auto: a village baked one by one with auto-exposure would
// lose its RELATIVE skin tones and dyes (each sprite pulled to the same brightness).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { sitPose, rotvecQuat, resetPose, norm, DEFAULTS, SPINE } from './walk_anim.js';

export function createBaker({ exposure = 1.35 } = {}){
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = exposure;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose();
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef2ff, 0x4a4636, 1.4));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(3, 5, 4); scene.add(key);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1); fill.position.set(-3, 2, -2); scene.add(fill);
  return { renderer, env, scene, bake: (avatar, clip, opts) => bakeAtlas({ renderer, scene }, avatar, clip, opts),
    portrait: (avatar, clip, size) => bakePortrait({ renderer, scene }, avatar, clip, size),
    sit: (avatar, walk) => bakeSitAtlas({ renderer, scene }, avatar, walk),
    dispose(){ env.dispose(); renderer.dispose(); } };
}

const _b = new THREE.Box3(), _v = new THREE.Vector3();
// the avatar's posed extent (skinned, precise), relative to its axis
function extent(av, cx, cz, acc){
  av.root.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const P = o.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
    for (let i = 0; i < P.count; i += step){
      if (o.isSkinnedMesh) o.getVertexPosition(i, _v); else _v.fromBufferAttribute(P, i);
      _v.applyMatrix4(o.matrixWorld);
      acc.r = Math.max(acc.r, Math.hypot(_v.x - cx, _v.z - cz)); acc.top = Math.max(acc.top, _v.y);
    }
  });
}

export function bakeAtlas({ renderer, scene }, av, clip, { cellH = 256, rows = 5, walkLen = 9, armOut = 8 } = {}){
  const cols = walkLen + 1;
  scene.add(av.root);
  try {
    // settle the cloth over four strides, then keep one snapshot per walk frame
    let snaps = null;
    if (av.sim){
      // measured on the Pi (tools: poke-through of trousers through the skirt per frame):
      // 4 substeps, 1 settling stride, 12 iterations is ~23x faster than 8/4/22 and pokes
      // through LESS (8-9% vs 10-13%): fewer iterations let a stepping leg move the cloth
      const SUB = 4; let ph = 0; av.sim.C.ITERS = 12; av.sim.normals = false;
      const simTo = nph => { for (let s = 1; s <= SUB; s++){ const f = ph + (nph - ph) * s / SUB; av.pose(clip, ((f % 1) + 1) % 1, armOut); av.sim.step(1 / 60); } ph = nph; };
      for (let i = 1; i <= walkLen; i++) simTo(i / walkLen);
      const base = Math.ceil(ph); snaps = [];
      for (let k = 0; k < walkLen; k++){ simTo(base + k / walkLen); snaps.push(av.sim.snapshot()); }
    }
    const setFrame = k => { av.pose(clip, k / walkLen, armOut); if (snaps) av.sim.show(snaps[k]); };
    // framing over the whole cycle: ground from the lowest foot, width and top from the posed mesh
    const root = av.bones.get('root'), cx = root.getWorldPosition(_v).x, cz = _v.z;
    let groundY = Infinity; const acc = { r: 0, top: -Infinity };
    for (let k = 0; k < walkLen; k++){
      setFrame(k);
      for (const n of ['footl', 'footr']) groundY = Math.min(groundY, av.bones.get(n).getWorldPosition(_v).y);
      extent(av, cx, cz, acc);
    }
    const bodyH = acc.top - groundY;
    groundY -= bodyH * 0.03;
    const PAD = 1.06, figH = (acc.top - groundY) * PAD, halfH = figH / 2, midY = (acc.top + groundY) / 2;
    const halfW = acc.r * 1.06, cellW = Math.max(48, Math.round(cellH * (2 * halfW) / figH));
    const center = new THREE.Vector3(cx, midY, cz);
    renderer.setSize(cellW, cellH, false);
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);
    // orbit −yaw: the turntable convention the game's facing rows expect (front→back)
    const camAt = yaw => { cam.position.set(center.x - Math.sin(yaw) * 20, center.y, center.z + Math.cos(yaw) * 20); cam.lookAt(center); };
    const atlas = document.createElement('canvas'); atlas.width = cols * cellW; atlas.height = rows * cellH;
    const ax = atlas.getContext('2d');
    for (let c = 0; c < cols; c++){
      setFrame(c === 0 ? 0 : c - 1);
      for (let r = 0; r < rows; r++){
        camAt(r * Math.PI / (rows - 1)); renderer.render(scene, cam);
        ax.drawImage(renderer.domElement, c * cellW, r * cellH, cellW, cellH);
      }
    }
    // frameM: the world height one frame spans (metres) — the billboard's height, so
    // a tall body is a tall sprite; feetM: where the feet sit above the frame's bottom
    return { canvas: atlas, m: { cols, rows, standCol: 0, walkStart: 1, walkLen, frameW: cellW, frameH: cellH, topPad: 0 },
      frameM: figH, feetM: (groundY + bodyH * 0.03) - (midY - halfH),
      frame: { cx, cz, halfH, cellH, rows, footToMid: midY - groundY } };     // for bakeSitAtlas
  } finally {
    scene.remove(av.root);
  }
}

// Seated on the ground (walk_anim sitPose: one knee up, one leg out), for the game's
// pose atlas: one frame per facing. It shares the walk's vertical framing (the same
// halfH, so the same metres per pixel) with the seat where the walk has its feet, so
// the billboard swaps without a jump; only the width differs (the legs reach forward),
// which AnimNPC compensates. The skirt settles as the body lowers, onto a floor at the
// seat — the hem rests on the ground instead of hanging through it.
const _sq = new THREE.Quaternion();
function sitInto(av, t){
  resetPose(av.bones, av.rest);
  const pose = sitPose(DEFAULTS);
  // sitPose's spine leans back (its first use was a recline); on the ground the
  // villager sits up, a little forward, toward the fire
  for (const sp of SPINE) pose[sp] = [2, 0, 0];
  for (const label in pose){
    const b = av.bones.get(norm(label)), r = av.rest.get(norm(label)), [x, y, z] = pose[label];
    if (b && r) b.quaternion.copy(r).multiply(_sq.copy(rotvecQuat(x * t, y * t, z * t)));
  }
  av.root.updateMatrixWorld(true);
}
function lowest(av){
  let y = Infinity; const P = av.skin.geometry.attributes.position;
  for (let i = 0; i < P.count; i += 3){ av.skin.getVertexPosition(i, _v); _v.applyMatrix4(av.skin.matrixWorld); y = Math.min(y, _v.y); }
  return y;
}
export function bakeSitAtlas({ renderer, scene }, av, walk){
  const { cx, cz, halfH, cellH, rows, footToMid } = walk.frame;
  scene.add(av.root);
  try {
    sitInto(av, 1);
    const seatY = lowest(av);
    if (av.sim){                       // lower into the seat over ~1 s, then let the cloth come to rest
      av.sim.floor = seatY + 0.005; av.sim.normals = false;
      const N = 40;
      for (let k = 1; k <= N; k++){ sitInto(av, k / N); av.sim.step(1 / 60); }
      for (let k = 0; k < N; k++) av.sim.step(1 / 60);
      av.sim.normals = true; av.sim.step(1 / 60);
    }
    const acc = { r: 0, top: -Infinity }; extent(av, cx, cz, acc);
    const halfW = acc.r * 1.06, cellW = Math.max(48, Math.round(cellH * halfW / halfH));
    const center = new THREE.Vector3(cx, seatY + footToMid, cz);
    renderer.setSize(cellW, cellH, false);
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);
    const atlas = document.createElement('canvas'); atlas.width = cellW; atlas.height = rows * cellH;
    const ax = atlas.getContext('2d');
    for (let r = 0; r < rows; r++){
      const yaw = r * Math.PI / (rows - 1);
      cam.position.set(center.x - Math.sin(yaw) * 20, center.y, center.z + Math.cos(yaw) * 20); cam.lookAt(center);
      renderer.render(scene, cam);
      ax.drawImage(renderer.domElement, 0, r * cellH, cellW, cellH);
    }
    return { canvas: atlas, m: { cols: 1, rows, standCol: 0, walkStart: 0, walkLen: 1, frameW: cellW, frameH: cellH, topPad: 0 } };
  } finally { scene.remove(av.root); }
}

// A head-and-shoulders portrait for dialogs, in the sprite's own light: the same
// person the player sees walking, not a separately painted face.
export function bakePortrait({ renderer, scene }, av, clip, size = 256){
  scene.add(av.root);
  try {
    av.pose(clip, 0);
    // aim between the eyes (the 'head' bone is at the base of the skull), a little low for the chin
    const target = av.bones.get('eyel').getWorldPosition(new THREE.Vector3()).add(av.bones.get('eyer').getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    target.y -= 0.035; target.z -= 0.03;
    const cam = new THREE.PerspectiveCamera(20, 1, 0.05, 20), yaw = 0.38, d = 1.25;
    cam.position.set(target.x + Math.sin(yaw) * d, target.y + 0.04, target.z + Math.cos(yaw) * d); cam.lookAt(target);
    renderer.setSize(size, size, false); renderer.render(scene, cam);
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    cv.getContext('2d').drawImage(renderer.domElement, 0, 0, size, size);
    return cv;
  } finally { scene.remove(av.root); }
}
