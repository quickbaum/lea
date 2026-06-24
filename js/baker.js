// Avatar Baker (Phase 0) — composes a rigged 3D humanoid and bakes it to a sprite
// atlas in the exact format the game's npc.js already consumes:
//   - rows  = view sectors, front (row 0, facing camera) -> back (last row).
//             DIR_MAP in npc.js mirrors these into the 8 yaw directions, so we
//             only bake the 5 distinct facings (0,45,90,135,180 degrees).
//   - cols  = stand frame (col 0) + walk frames (cols 1..walkLen).
// The runtime is unchanged: drop the exported PNG into sprites/npc/ and add a
// manifest entry. See docs/avatars.md for the why (sprite sheet = render cache of
// a 3D paper-doll).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const TARGET_H = 2.0;        // model is normalised to this world height before framing
const PAD = 1.08;            // frustum padding so the silhouette doesn't touch the cell edge

const $ = id => document.getElementById(id);
const status = msg => { $('status').textContent = msg; };

// ---- three.js scene: soft, neutral, pre-rendered look, transparent background ----
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, preserveDrawingBuffer:true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;     // gentle highlight rolloff, no crushed blacks

const scene = new THREE.Scene();
const hemiLight = new THREE.HemisphereLight(0xeef2ff, 0x4a4636, 1.1);   // sky/ground fill
const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);             // warm key (front-upper)
const fillLight = new THREE.DirectionalLight(0xcfe0ff, 1.1);           // cool fill, opposite key
const rimLight = new THREE.DirectionalLight(0xbcd0ff, 0.5);            // back rim for separation
rimLight.position.set(2, 2, -3);
scene.add(hemiLight, keyLight, fillLight, rimLight);

// position the key/fill from the current azimuth so the face isn't flat or black
function placeLights(){
  const az = THREE.MathUtils.degToRad(+$('keyAz').value);
  keyLight.position.set(Math.sin(az) * 4, 4, Math.cos(az) * 4 + 1);
  fillLight.position.set(-Math.sin(az) * 4, 2, -Math.cos(az) * 2 + 2);
  keyLight.intensity = +$('keyInt').value;
  fillLight.intensity = +$('fillInt').value;
  renderer.toneMappingExposure = +$('exposure').value;
}

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

// the loaded model lives inside a turntable group we rotate about Y to pick a facing
const turntable = new THREE.Group();
scene.add(turntable);

let model = null;            // current normalised model root
let mixer = null;            // animation mixer (if the file had clips)
let clips = [];              // available AnimationClips
let bbox = new THREE.Box3(); // model bounds after normalisation (for framing)
let rootBone = null;         // the bone the walk clip translates (hips) — locked in place
const rootRest = new THREE.Vector3();   // its bind-pose position
const targetRest = new Map();           // model bone name -> rest local quaternion (retargeting)

// Keep the character planted: walk clips carry forward root motion, which would
// drift the body out of the cell (worse on side rows) and slice off the late
// frames. Pin the root bone's horizontal position to its bind pose each frame.
function lockRoot(){
  if (rootBone){ rootBone.position.x = rootRest.x; rootBone.position.z = rootRest.z; }
}

// ---- file loading -------------------------------------------------------------
const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

function clearModel(){
  if (model){ turntable.remove(model); model.traverse(o => { o.geometry?.dispose?.(); }); }
  model = null; mixer = null; clips = [];
}

// Normalise: scale to TARGET_H, drop feet to y=0, centre on x/z. Returns the root.
function normalise(root){
  root.updateWorldMatrix(true, true);
  const b = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); b.getSize(size);
  const s = size.y > 0 ? TARGET_H / size.y : 1;
  root.scale.multiplyScalar(s);
  root.updateWorldMatrix(true, true);
  const b2 = new THREE.Box3().setFromObject(root);
  const c = new THREE.Vector3(); b2.getCenter(c);
  root.position.x -= c.x; root.position.z -= c.z;
  root.position.y -= b2.min.y;                 // feet on the ground plane
  root.updateWorldMatrix(true, true);
  bbox = new THREE.Box3().setFromObject(root);
  return root;
}

function ingest(root, animations){
  clearModel();
  model = normalise(root);
  turntable.add(model);
  targetRest.clear();                         // capture rest local rotations for retargeting
  model.traverse(o => { if (o.isBone) targetRest.set(o.name, o.quaternion.clone()); });
  clips = animations || [];
  rootBone = null;
  if (clips.length){
    mixer = new THREE.AnimationMixer(model);
    // find the bone the clips translate (Mixamo: Hips) so we can lock it in place
    const posTrack = clips.flatMap(c => c.tracks).find(t => /\.position$/.test(t.name));
    if (posTrack){
      const nodeName = THREE.PropertyBinding.parseTrackName(posTrack.name).nodeName;
      rootBone = THREE.PropertyBinding.findNode(model, nodeName);
      if (rootBone) rootRest.copy(rootBone.position);   // bind pose, before any clip runs
    }
  }
  // populate the clip dropdown
  const sel = $('clip');
  sel.innerHTML = '<option value="-1">— none (static) —</option>';
  clips.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `${c.name || 'clip ' + i} (${c.duration.toFixed(2)}s)`;
    sel.appendChild(o);
  });
  // auto-pick a walk-ish clip if present
  const walkIdx = clips.findIndex(c => /walk|stroll|locomot/i.test(c.name || ''));
  sel.value = clips.length ? String(walkIdx >= 0 ? walkIdx : 0) : '-1';
  $('bake').disabled = false;
  $('addAnim').disabled = false;
  status(`Loaded: ${(root.name || 'model')} · ${clips.length} clip(s) · height normalised to ${TARGET_H}u`);
}

function loadFile(file){
  status(`Reading ${file.name}…`);
  const url = URL.createObjectURL(file);
  const ext = file.name.toLowerCase().split('.').pop();
  const done = () => URL.revokeObjectURL(url);
  if (ext === 'fbx'){
    fbxLoader.load(url, obj => { ingest(obj, obj.animations); done(); },
      undefined, e => { status('FBX load failed: ' + e.message); done(); });
  } else {
    gltfLoader.load(url, g => { ingest(g.scene, g.animations); done(); },
      undefined, e => { status('glTF load failed: ' + e.message); done(); });
  }
}

// ---- framing ------------------------------------------------------------------
// Orthographic camera looking along -Z at the model centre, with an optional
// downward tilt. Frustum sized to the model bounds × cell aspect.
function frame(cellAspect, tiltDeg){
  const size = new THREE.Vector3(); bbox.getSize(size);
  const ctr = new THREE.Vector3(); bbox.getCenter(ctr);
  const halfH = (size.y * 0.5) * PAD;
  const halfW = halfH * cellAspect;
  camera.left = -halfW; camera.right = halfW;
  camera.top = halfH; camera.bottom = -halfH;
  camera.near = 0.01; camera.far = 100;
  camera.updateProjectionMatrix();
  const dist = 20;
  const t = THREE.MathUtils.degToRad(tiltDeg);
  // place the camera in front of the model (+Z), raised/lowered by the tilt
  camera.position.set(ctr.x, ctr.y + Math.sin(t) * dist, ctr.z + Math.cos(t) * dist);
  camera.lookAt(ctr.x, ctr.y, ctr.z);
}

// auto cell width from the front-facing silhouette aspect (keeps in-world proportions)
function autoCellW(cellH){
  turntable.rotation.y = THREE.MathUtils.degToRad(+$('baseYaw').value);
  turntable.updateWorldMatrix(true, true);
  const b = new THREE.Box3().setFromObject(turntable);
  const size = new THREE.Vector3(); b.getSize(size);
  const aspect = size.y > 0 ? size.x / size.y : 0.5;
  return Math.max(32, Math.round(cellH * aspect));
}

// ---- live preview -------------------------------------------------------------
const previewCanvas = $('preview');
const pctx = previewCanvas.getContext('2d');
let spin = 0;
function previewTick(dt){
  if (model){
    spin += dt * 0.5;
    placeLights();
    renderer.setSize(previewCanvas.width, previewCanvas.height, false);
    frame(previewCanvas.width / previewCanvas.height, +$('tilt').value);
    turntable.rotation.y = THREE.MathUtils.degToRad(+$('baseYaw').value) + spin;
    if (mixer){ const i = +$('clip').value; if (i >= 0){ mixer.stopAllAction(); mixer.clipAction(clips[i]).play(); mixer.setTime((performance.now()/1000) % clips[i].duration); lockRoot(); } }
    renderer.render(scene, camera);
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    pctx.drawImage(renderer.domElement, 0, 0);
  }
}
let last = performance.now();
function loop(now){ const dt = (now - last) / 1000; last = now; previewTick(dt); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ---- baking -------------------------------------------------------------------
const atlasCanvas = $('atlas');
const actx = atlasCanvas.getContext('2d');

const retargets = {};   // clipIndex -> { srcRoot, srcMixer, clip, pairs } world-space retarget
const _qSRi = new THREE.Quaternion(), _qMRi = new THREE.Quaternion(), _qW = new THREE.Quaternion(),
      _sDelta = new THREE.Quaternion(), _tWorld = new THREE.Quaternion(), _pRel = new THREE.Quaternion();

function poseAt(clipIdx, frac){
  if (clipIdx < 0) return;
  const rt = retargets[clipIdx];
  if (rt){
    // pose the hidden source skeleton, then transfer each bone's world-space delta
    // from rest onto the target's rest orientation (localised against the live parent
    // so it survives the turntable yaw). Rotations only → the body stays planted.
    rt.srcMixer.stopAllAction(); rt.srcMixer.clipAction(rt.clip).play();
    rt.srcMixer.setTime(frac * rt.clip.duration);
    rt.srcRoot.updateMatrixWorld(true); model.updateMatrixWorld(true);
    rt.srcRoot.getWorldQuaternion(_qSRi).invert();
    model.getWorldQuaternion(_qMRi).invert();
    for (const p of rt.pairs){
      p.sb.getWorldQuaternion(_sDelta).premultiply(_qSRi);   // source bone rel src-root
      _sDelta.multiply(p.sRelRestInv);                       // world-space delta since rest
      _tWorld.copy(_sDelta).multiply(p.tRelRest);            // desired target orient (rel model-root)
      p.tb.parent.getWorldQuaternion(_qW); _pRel.copy(_qMRi).multiply(_qW);   // parent orient rel model-root
      p.tb.quaternion.copy(_pRel.invert()).multiply(_tWorld);                 // -> bone local
      p.tb.updateWorldMatrix(false, false);                 // refresh for child bones
    }
    lockRoot();
    return;
  }
  if (!mixer) return;
  const clip = clips[clipIdx];
  mixer.stopAllAction();
  mixer.clipAction(clip).play();
  mixer.setTime(frac * clip.duration);
  lockRoot();
}

function bake(){
  if (!model) return;
  const rows = Math.max(1, +$('rows').value | 0);
  const walkLen = Math.max(1, +$('walkLen').value | 0);
  const cols = walkLen + 1;                       // col 0 = stand, then walk frames
  const cellH = Math.max(48, +$('cellH').value | 0);
  let cellW = +$('cellW').value | 0;
  if (cellW <= 0) cellW = autoCellW(cellH);
  const clipIdx = +$('clip').value;
  const tilt = +$('tilt').value;
  const baseYaw = THREE.MathUtils.degToRad(+$('baseYaw').value);

  atlasCanvas.width = cols * cellW;
  atlasCanvas.height = rows * cellH;
  actx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  placeLights();
  renderer.setSize(cellW, cellH, false);
  frame(cellW / cellH, tilt);

  // Re-ground the posed figure. Clips (especially sit/idle) can place the whole
  // skeleton above the floor — lockRoot cancels only the root's XZ drift, not its
  // vertical offset — which makes the baked sprite float in-world. Find the clip's
  // lowest *skinned* point across the cycle and drop the model so it rests on the
  // ground. (Box3.setFromObject ignores skinning, so we transform vertices by the
  // skeleton ourselves via applyBoneTransform — sampling a stride of verts/frames.)
  const savedY = model.position.y;
  if (clipIdx >= 0 && mixer){
    const skinned = [];
    model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
    const ys = []; const v = new THREE.Vector3();
    for (let f = 0; f <= 8; f++){
      poseAt(clipIdx, f / 8); turntable.updateWorldMatrix(true, true);
      for (const sm of skinned){
        const pos = sm.geometry.attributes.position, step = Math.max(1, (pos.count / 1500) | 0);
        for (let i = 0; i < pos.count; i += step){
          v.fromBufferAttribute(pos, i); sm.applyBoneTransform(i, v); sm.localToWorld(v);
          ys.push(v.y);
        }
      }
    }
    if (ys.length){
      ys.sort((a, b) => a - b);
      // Ground to a robust low point, not the absolute minimum: skip a sparse low
      // tail (a dangling scabbard/strap/weapon tip) that would otherwise float the
      // body above the floor. The female sit (broad, dense contact, no outliers) is
      // unaffected; the male's dangling tip is ignored so he rests flush.
      const groundY = ys[Math.floor(ys.length * 0.03)];
      model.position.y -= groundY;
      console.log('AUTOBAKE grounded by', groundY.toFixed(3), '(p3 of', ys.length, ')');
    }
  }

  for (let r = 0; r < rows; r++){
    // front (r=0) faces the camera; each row turns the body another 180/(rows-1) deg
    const yaw = baseYaw + (rows > 1 ? r * (Math.PI / (rows - 1)) : 0);
    turntable.rotation.y = yaw;
    for (let c = 0; c < cols; c++){
      // col 0 = neutral stand (clip t=0 or static); cols 1.. = walk cycle samples
      const frac = c === 0 ? 0 : (c - 1) / walkLen;
      poseAt(clipIdx, frac);
      turntable.updateWorldMatrix(true, true);
      renderer.render(scene, camera);
      actx.drawImage(renderer.domElement, c * cellW, r * cellH, cellW, cellH);
    }
  }

  model.position.y = savedY;                       // restore after grounding the bake

  $('atlasCap').textContent =
    `Baked ${cols}×${rows} · cell ${cellW}×${cellH} · ${atlasCanvas.width}×${atlasCanvas.height}px`;
  $('dl').disabled = false; $('save').disabled = false;
  status('Baked. Name it and "Save into sprites/npc/".');
  // store the geometry for the manifest snippet
  bake.meta = { cols, rows, walkLen, cellW, cellH };
}

function downloadPNG(){
  atlasCanvas.toBlob(blob => {
    const a = $('dlink');
    a.href = URL.createObjectURL(blob);
    a.download = 'avatar.png';
    a.click();
  }, 'image/png');
}

async function saveToGame(){
  const m = bake.meta; if (!m) return;
  const slug = $('slug').value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)){
    status('Slug must be lowercase letters/digits/hyphens (e.g. forest-elf).'); return;
  }
  status('Saving…');
  const png = atlasCanvas.toDataURL('image/png');
  try {
    const res = await fetch('/api/save-sprite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, png, frameW: m.cellW, frameH: m.cellH,
        cols: m.cols, rows: m.rows, walkLen: m.walkLen })
    });
    const j = await res.json();
    if (j.ok){ status(`Saved → ${j.file}. Reload the game to see it.`); loadSlugs(); }
    else status('Save failed: ' + j.error);
  } catch (e){ status('Save failed: ' + e.message); }
}

// pull existing slugs so they can be reused (overwriting that sprite in-game)
async function loadSlugs(){
  try {
    const meta = await (await fetch('sprites/npc/manifest.json')).json();
    $('slugs').innerHTML = (meta.sprites || [])
      .map(s => `<option value="${s.slug}">`).join('');
  } catch {}
}
loadSlugs();

// ---- wiring -------------------------------------------------------------------
const drop = $('drop'), fileInput = $('file');
drop.onclick = () => fileInput.click();
fileInput.onchange = e => { if (e.target.files[0]) loadFile(e.target.files[0]); };
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

const bindV = (id, fmt) => { const el = $(id), out = $(id + 'V'); if (out) el.oninput = () => out.textContent = fmt(el.value); el.oninput?.(); };
bindV('baseYaw', v => v + '°');
bindV('tilt', v => v + '°');
bindV('exposure', v => (+v).toFixed(2));
bindV('keyInt', v => (+v).toFixed(1));
bindV('fillInt', v => (+v).toFixed(1));
bindV('keyAz', v => v + '°');

$('bake').onclick = bake;
$('dl').onclick = downloadPNG;
$('save').onclick = saveToGame;

// Add an animation from a separate file (e.g. a Mixamo walk .fbx) and bind its
// clips to the loaded model by WORLD-SPACE RETARGETING (see poseAt). For each bone
// shared by name, we record its rest orientation relative to each skeleton's root;
// at play time we take the source bone's world-space *delta from its rest* and apply
// it onto the target bone's rest — so differing rest orientations (incl. arm roll,
// e.g. Mixamo→ANNY) transfer correctly instead of exploding/leaning, and the bind
// pose is never distorted. The clip's tracks are left untouched (played on a hidden
// source skeleton); only rotations transfer, so the body stays planted.
function addClips(anims, label, srcRoot){
  if (!model){ status('Load a model first.'); return; }
  if (!anims || !anims.length){ status('No animation in ' + label); return; }
  if (!srcRoot){ status('No source skeleton for ' + label); return; }
  const start = clips.length;
  // match bones by normalised leaf name (mixamorig:Hips / mixamorig_Hips / Hips all
  // collapse the same), so FBX vs GLTF name-sanitisation doesn't break the mapping.
  const norm = n => n.replace(/^mixamorig[:_.]?/i, '').replace(/[:_.]/g, '').toLowerCase();
  const srcByName = new Map();
  srcRoot.traverse(o => { if (o.isBone) srcByName.set(norm(o.name), o); });
  // Reset model to bind pose before capturing tRelRest — if the model FBX had embedded
  // animations, the preview loop may have already posed it, making tRelRest wrong.
  if (mixer) mixer.stopAllAction();
  model.traverse(o => { if (o.isBone && targetRest.has(o.name)) o.quaternion.copy(targetRest.get(o.name)); });
  // rest (bind) orientations, relative to each armature root (turntable-independent)
  model.updateMatrixWorld(true); srcRoot.updateMatrixWorld(true);
  const qMRi = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  const qSRi = srcRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
  const tBones = []; model.traverse(o => { if (o.isBone) tBones.push(o); });   // parent-first
  const restPairs = [];
  for (const tb of tBones){
    const sb = srcByName.get(norm(tb.name));
    if (!sb) continue;
    const tRelRest = tb.getWorldQuaternion(new THREE.Quaternion()).premultiply(qMRi);
    const sRelRest = sb.getWorldQuaternion(new THREE.Quaternion()).premultiply(qSRi);
    restPairs.push({ tb, sb, tRelRest, sRelRestInv: sRelRest.invert() });
  }
  const unmatched = tBones.filter(tb => !srcByName.has(norm(tb.name))).map(tb => tb.name);
  console.log(`ADDCLIPS pairs=${restPairs.length}/${tBones.length}; unmatched: ${unmatched.join(', ') || 'none'}`);
  anims.forEach(c => {
    if (!c.name || /mixamo/i.test(c.name)) c.name = label;
    const idx = clips.length; clips.push(c);
    const srcMixer = new THREE.AnimationMixer(srcRoot);
    retargets[idx] = { srcRoot, srcMixer, clip: c, pairs: restPairs };
  });
  const sel = $('clip'); sel.innerHTML = '<option value="-1">— none (static) —</option>';
  clips.forEach((c, i) => { const o = document.createElement('option');
    o.value = i; o.textContent = `${c.name || 'clip ' + i} (${c.duration.toFixed(2)}s)`; sel.appendChild(o); });
  sel.value = String(start);
  status(`Added "${label}" · world-space retarget on ${restPairs.length} bones. Bake to use it.`);
}
function loadAnimFile(file){
  status('Reading ' + file.name + '…');
  const url = URL.createObjectURL(file), ext = file.name.toLowerCase().split('.').pop(), done = () => URL.revokeObjectURL(url);
  const label = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'fbx') fbxLoader.load(url, o => { addClips(o.animations, label, o); done(); }, undefined, e => { status('FBX load failed: ' + e.message); done(); });
  else gltfLoader.load(url, g => { addClips(g.animations, label, g.scene); done(); }, undefined, e => { status('load failed: ' + e.message); done(); });
}
$('addAnim').onclick = () => $('animFile').click();
$('animFile').onchange = e => { if (e.target.files[0]) loadAnimFile(e.target.files[0]); };

// load an animation from a same-origin URL onto the current model. `cb` (optional)
// fires once the clip is added — used by the headless autobake path to sequence.
function loadAnimURL(url, cb){
  status(`Loading anim ${url}…`);
  const ext = url.toLowerCase().split('?')[0].split('.').pop();
  const label = url.split('/').pop().replace(/\.[^.]+$/, '');
  if (ext === 'fbx') fbxLoader.load(url, o => { addClips(o.animations, label, o); cb && cb(); }, undefined, e => status('anim load failed: ' + e.message));
  else gltfLoader.load(url, g => { addClips(g.animations, label, g.scene); cb && cb(); }, undefined, e => status('anim load failed: ' + e.message));
}

// load a model (and optional anim) straight from URLs:
//   baker.html?model=/anny_base.glb&anim=/Walking.fbx
// Headless bake (driven by tools/headless_bake.py):
//   baker.html?model=/goblin.glb&anim=/Sitting%20Idle.fbx&autobake=female-peasant-goblin-sitting
// On finish it sets document.title to BAKE_OK/BAKE_ERR so the driver can detect it.
const _p = new URLSearchParams(location.search), modelURL = _p.get('model'),
      animURL = _p.get('anim'), autobakeSlug = _p.get('autobake');

// Probe the figure's mean luminance (0-255 over opaque pixels) for the current
// pose/lights, by rendering one small frame and reading it back.
const _probe = document.createElement('canvas');
function probeLum(clipIdx){
  const W = 128, H = 128;
  placeLights(); renderer.setSize(W, H, false); frame(W / H, +$('tilt').value);
  const base = THREE.MathUtils.degToRad(+$('baseYaw').value), c = _probe.getContext('2d');
  _probe.width = W; _probe.height = H;
  let sum = 0, n = 0;
  for (const deg of [0, 90, 180]){               // front/side/back — match the sheet average, not just the lit front
    turntable.rotation.y = base + THREE.MathUtils.degToRad(deg);
    poseAt(clipIdx, 0.3); turntable.updateWorldMatrix(true, true);
    renderer.render(scene, camera);
    c.clearRect(0, 0, W, H); c.drawImage(renderer.domElement, 0, 0);
    const d = c.getImageData(0, 0, W, H).data;
    for (let i = 0; i < d.length; i += 4){
      if (d[i + 3] > 16){ sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    }
  }
  return n ? sum / n : 0;
}

// Auto-expose: nudge exposure so the figure averages `target` luminance. Removes
// per-character light tuning — a dark model just gets more exposure. ACES is
// non-linear so we iterate a few clamped steps to converge.
function autoExpose(clipIdx, target = 50){
  let e = 1.25;
  for (let i = 0; i < 6; i++){
    $('exposure').value = e.toFixed(3);
    const lum = probeLum(clipIdx);
    if (!lum) break;
    if (Math.abs(lum - target) < 2) break;
    e *= Math.min(2, Math.max(0.5, target / lum));
    e = Math.min(8, Math.max(0.1, e));
  }
  console.log('AUTOBAKE exposure', $('exposure').value, '-> lum', probeLum(clipIdx).toFixed(1));
}

function runAutobake(){
  try {
    const sel = $('clip');
    console.log('AUTOBAKE clips:', clips.map(c => c.name + ' ' + c.duration.toFixed(2)).join(' | '));
    // prefer sit/idle by name; otherwise use the longest clip (the real anim, not a
    // short T-pose reference like "Take 001" which can appear first in the file)
    const sitIdx = clips.findIndex(c => /sit|idle|lie|lay/i.test(c.name || ''));
    if (sitIdx >= 0) {
      sel.value = String(sitIdx);
    } else {
      let best = +sel.value, bestLen = clips[best]?.duration ?? -1;
      clips.forEach((c, i) => { if (c.duration > bestLen) { bestLen = c.duration; best = i; } });
      sel.value = String(best);
    }
    const clipIdx = +sel.value;
    $('rows').value = 5; $('walkLen').value = 9; $('cellH').value = 256; $('cellW').value = 0;
    // Fixed ambient fill so shadowed sides aren't black; exposure is found
    // automatically to hit a target mean luminance (default 50, &lum= to override).
    $('fillInt').value = 1.6; hemiLight.intensity = 2.2;
    autoExpose(clipIdx, +(_p.get('lum') || 50));
    console.log('AUTOBAKE baking…');
    bake();
    console.log('AUTOBAKE baked', JSON.stringify(bake.meta));
    $('slug').value = autobakeSlug;
    saveToGame()
      .then(() => { console.log('AUTOBAKE saved'); document.title = 'BAKE_OK ' + autobakeSlug; })
      .catch(e => { console.log('AUTOBAKE save error', e); document.title = 'BAKE_ERR ' + (e && e.message || e); });
  } catch (e){ console.log('AUTOBAKE threw', e); document.title = 'BAKE_ERR ' + (e && e.message || e); }
}

function loadModelURL(url, cb){
  status(`Loading ${url}…`);
  console.log('MODEL loading', url);
  const ext = url.toLowerCase().split('?')[0].split('.').pop();
  const onErr = e => { console.log('MODEL load failed', e); status('URL load failed: ' + e.message); document.title = 'BAKE_ERR ' + e.message; };
  const ok = () => console.log('MODEL loaded, bones/clips ingested');
  if (ext === 'fbx') fbxLoader.load(url, o => { ingest(o, o.animations); ok(); cb && cb(); }, undefined, onErr);
  else gltfLoader.load(url, g => { ingest(g.scene, g.animations); ok(); cb && cb(); }, undefined, onErr);
}

// Clip extractor (?anim=…&dumpanim=<name>): sample a Mixamo clip's per-frame
// world-space bone orientations (relative to its armature root) + rest pose, and
// POST to /api/save-clip → clips/<name>.json. Used by tools/anny_retarget.py to
// drive ANNY's own rig math (pose_parameterization='world-orient') — see B-path.
const dumpName = _p.get('dumpanim');
function dumpAnim(url){
  const ext = url.toLowerCase().split('?')[0].split('.').pop();
  const loader = ext === 'fbx' ? fbxLoader : gltfLoader;
  loader.load(url, obj => { try {
    const root = obj.scene || obj;
    const clip = (obj.animations || (root.animations || []))[0];
    if (!clip) throw new Error('no clip in ' + url);
    const bones = []; root.traverse(o => { if (o.isBone) bones.push(o); });
    root.updateMatrixWorld(true);
    const qRi = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const mRiInv = root.matrixWorld.clone().invert();
    const q = new THREE.Quaternion(), v = new THREE.Vector3();
    const rest = {};                                   // bone -> {q:[xyzw], head:[xyz]} at bind
    for (const b of bones){
      b.getWorldQuaternion(q).premultiply(qRi);
      b.getWorldPosition(v).applyMatrix4(mRiInv);
      rest[b.name] = { q: [q.x, q.y, q.z, q.w], head: [v.x, v.y, v.z] };
    }
    const K = 32, frames = {}; for (const b of bones) frames[b.name] = [];
    const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
    for (let f = 0; f <= K; f++){
      mixer.setTime((f / K) * clip.duration * 0.999); root.updateMatrixWorld(true);
      const qf = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for (const b of bones){ b.getWorldQuaternion(q).premultiply(qf); frames[b.name].push([q.x, q.y, q.z, q.w]); }
    }
    const payload = { name: dumpName, clip: { duration: clip.duration, K, rest, frames } };
    fetch('/api/save-clip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(r => r.json()).then(j => { document.title = j.ok ? 'DUMP_OK ' + j.file : 'DUMP_ERR ' + j.error; })
      .catch(e => { document.title = 'DUMP_ERR ' + e; });
  } catch (e){ document.title = 'DUMP_ERR ' + (e && e.message || e); } },
  undefined, e => { document.title = 'DUMP_ERR ' + (e && e.message || e); });
}

if (dumpName && animURL){ dumpAnim(animURL); }
else if (modelURL){
  loadModelURL(modelURL, () => {
    if (animURL) loadAnimURL(animURL, autobakeSlug ? runAutobake : null);
    else if (autobakeSlug) runAutobake();
  });
}
