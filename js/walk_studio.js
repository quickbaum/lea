// Walk Studio — live tuner for the procedural walk. Loads the rigged ANNY model
// and applies walk_pose() directly to its bones each frame (no baking), so every
// slider change is visible immediately. The walk_pose port here MUST stay in sync
// with tools/anny_walk.py (same formula); "Copy params" emits a Python constants
// block to paste back into anny_walk.py once a look is dialed in.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyWalk, norm } from './walk_anim.js';

const $ = id => document.getElementById(id);
const status = m => { $('status').textContent = m; };
const MODEL = new URLSearchParams(location.search).get('model') || '/models/anny_proc.glb';

// ---- parameters (defaults mirror tools/anny_walk.py) -------------------------
// group, key, label, min, max, step, default
const SPEC = [
  ['arms', 'ARM_DOWN',     'arm down',    0, 100, 1, 80],
  ['arms', 'ARM_ADDUCT',   'arm tuck',  -20,  30, 1, 6],
  ['arms', 'SHOULDER_IN',  'shoulder in',-30, 40, 1, 0],
  ['arms', 'ARM_PITCH',    'arm fwd/back',-50,50, 1, 0],
  ['arms', 'ARM_PRON',     'palm roll', -90,  90, 1, 38],
  ['arms', 'FOREARM_IN',   'forearm twist',-90,90,1, 0],
  ['arms', 'ARM_SWING',    'arm swing',   0,  60, 1, 22],
  ['arms', 'ELBOW_BASE',   'elbow bend',  0,  60, 1, 16],
  ['arms', 'ELBOW_FOLLOW', 'elbow follow',0,  40, 1, 16],
  ['legs', 'THIGH',        'thigh swing', 0,  50, 1, 26],
  ['legs', 'KNEE',         'knee flex',   0,  80, 1, 46],
  ['legs', 'KNEE_BASE',    'knee base',   0,  30, 1, 7],
  ['legs', 'LEG_ADDUCT',   'stance in', -15,  15, 1, 3],
  ['legs', 'FOOT',         'ankle roll',  0,  40, 1, 16],
  ['body', 'PELVIS_YAW',   'pelvis yaw',  0,  20, 0.5, 3],
  ['body', 'PELVIS_SWAY',  'pelvis sway', 0,  15, 0.5, 1.5],
  ['body', 'SPINE_TWIST',  'spine twist', 0,  25, 0.5, 5],
  ['body', 'SPINE_LEAN',   'spine lean',-10,  20, 0.5, 0],
  ['body', 'CLAV',         'clavicle',    0,  15, 0.5, 3],
  ['body', 'HEAD_STAB',    'head steady',-10, 10, 0.5, 1],
];
const P = {};
SPEC.forEach(s => P[s[1]] = s[6]);
const play = { speed: 1.2, autorotate: true, facing: 0, tilt: 8, paused: false };

// ---- scene ------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
scene.background = null;
scene.add(new THREE.HemisphereLight(0xeef2ff, 0x4a4636, 1.4));
const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(3, 5, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1); fill.position.set(-3, 2, -2); scene.add(fill);

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const turntable = new THREE.Group(); scene.add(turntable);

let model = null, bones = new Map(), rest = new Map(), center = new THREE.Vector3(), camDist = 6;

new GLTFLoader().load(MODEL, g => {
  model = g.scene;
  turntable.add(model);
  model.traverse(o => { if (o.isBone){ bones.set(norm(o.name), o); rest.set(norm(o.name), o.quaternion.clone()); } });
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  box.getCenter(center);
  const size = box.getSize(new THREE.Vector3());
  camDist = size.y * 1.6;
  status(`loaded ${bones.size} bones — tune away`);
  resize();
}, undefined, e => status('load failed: ' + e.message));

// ---- loop -------------------------------------------------------------------
let t = 0, last = performance.now();
function frame(now){
  const dt = (now - last) / 1000; last = now;
  if (!play.paused) t += dt * play.speed;
  if (model) applyWalk(bones, rest, P, ((t % 1) + 1) % 1);
  if (play.autorotate) turntable.rotation.y += dt * 0.6;
  else turntable.rotation.y = THREE.MathUtils.degToRad(play.facing);
  const tilt = THREE.MathUtils.degToRad(play.tilt);
  camera.position.set(
    center.x + Math.sin(turntable.rotation.y) * 0,            // camera fixed; turntable spins the model
    center.y + Math.sin(tilt) * camDist,
    center.z + Math.cos(tilt) * camDist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function resize(){
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---- UI ---------------------------------------------------------------------
function slider(parent, key, label, min, max, step, get, set){
  const row = document.createElement('label');
  row.innerHTML = `<span class="nm">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="v"></span>`;
  const inp = row.querySelector('input'), val = row.querySelector('.v');
  const show = () => val.textContent = (+get()).toFixed(step < 1 ? 1 : 0);
  inp.value = get(); show();
  inp.oninput = () => { set(+inp.value); show(); };
  parent.appendChild(row);
  return inp;
}

// playback controls
slider($('grp-play'), 'speed', 'speed', 0, 3, 0.1, () => play.speed, v => play.speed = v);
const autoRow = document.createElement('label');
autoRow.innerHTML = `<span class="nm">auto-rotate</span><input type="checkbox" ${play.autorotate ? 'checked' : ''}><span class="v"></span>`;
const autoBox = autoRow.querySelector('input');
autoBox.onchange = e => play.autorotate = e.target.checked;
$('grp-play').appendChild(autoRow);
const facingInp = slider($('grp-play'), 'facing', 'facing', -180, 180, 5, () => play.facing, v => play.facing = v);
slider($('grp-play'), 'tilt', 'tilt', -20, 40, 1, () => play.tilt, v => play.tilt = v);

// drag on the model to rotate (sets facing, disables auto-rotate)
let dragging = false, lastX = 0;
canvas.style.cursor = 'grab';
canvas.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  play.autorotate = false; autoBox.checked = false;
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX; lastX = e.clientX;
  play.facing = (((play.facing + dx * 0.4) + 180) % 360 + 360) % 360 - 180;
  facingInp.value = play.facing; facingInp.dispatchEvent(new Event('input'));
});
const endDrag = () => { dragging = false; canvas.style.cursor = 'grab'; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// load saved params (the source of truth, shared with tools/anny_walk.py) so the
// studio opens on the current numbers instead of the hardcoded SPEC defaults
try {
  const saved = await fetch('walk_params.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
  Object.assign(P, saved);
  status('loaded saved params');
} catch { /* keep SPEC defaults */ }

// parameter sliders
const inputs = {};
for (const [grp, key, label, min, max, step] of SPEC){
  inputs[key] = slider($('grp-' + grp), key, label, min, max, step, () => P[key], v => P[key] = v);
}

$('pause').onclick = () => { play.paused = !play.paused; $('pause').textContent = play.paused ? 'Play' : 'Pause'; };
$('reset').onclick = () => {
  SPEC.forEach(s => { P[s[1]] = s[6]; inputs[s[1]].value = s[6]; inputs[s[1]].dispatchEvent(new Event('input')); });
};
$('save').onclick = async () => {
  status('saving…');
  try {
    const r = await fetch('/api/save-walk', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P) });
    const j = await r.json();
    status(j.ok ? `saved ${j.n} params → walk_params.json (used by the next bake)` : 'save failed: ' + j.error);
  } catch (e){ status('save failed: ' + e); }
};
$('copy').onclick = () => {
  const lines = SPEC.map(s => {
    const v = P[s[1]];
    return `${s[1].padEnd(11)} = ${Number.isInteger(v) ? v : v.toFixed(1)}`;
  });
  const txt = lines.join('\n');
  $('out').value = txt;
  navigator.clipboard?.writeText(txt).then(() => status('params copied to clipboard'), () => {});
};
