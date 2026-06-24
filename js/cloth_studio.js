// Cloth Studio — live preview of a simulated skirt over the walk, before baking.
// The skirt is a lofted ring-grid; its top ring is pinned to the hips (the 'root'
// bone) and the rest is a Verlet position-based cloth: gravity + distance/shear/
// bend constraints + collision against leg capsules and a hip sphere. The legs
// swinging through the walk push the fabric, so it drapes and sways. Runs the same
// solver the baker will use, so what you tune here is what bakes. Shares the walk
// formula with the Walk Studio via walk_anim.js.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyWalk, applySit, loadParams, norm } from './walk_anim.js';

const $ = id => document.getElementById(id);
const status = m => { $('status').textContent = m; };
const MODEL = new URLSearchParams(location.search).get('model') || '/models/anny_proc.glb';

// ---- params ------------------------------------------------------------------
// live cloth params (no rebuild) and shape params (rebuild the skirt mesh)
const C = { GRAVITY: 9, DAMP: 0.92, ITERS: 11, STRETCH: 1.0, BEND: 0.3,
            LEG_R: 0.1, BODY_R: 0.14, ARM_R: 0.06, WIND: 0 };
const S = { WAIST: 0.80, HEM: 0.42, CINCH: 1.0, FLARE: 2.0, RINGS: 12, SEGS: 26 };
const GARMENT = new URLSearchParams(location.search).get('garment') || 'none';   // 'none' | 'cloak' | 'skirt'
const _q = new URLSearchParams(location.search);
const POSE_MODE = _q.get('pose') || 'walk';   // 'walk' | 'sit'
function applyPose(frac){ POSE_MODE === 'sit' ? applySit(bones, rest, P) : applyWalk(bones, rest, P, frac); }
const play = { speed: 1.0, paused: false,
  orbit: _q.get('orbit') !== '0', facing: +(_q.get('facing') || 0), tilt: +(_q.get('tilt') ?? 8) };

const CLOTH_SPEC = [   // key, label, min, max, step
  ['GRAVITY', 'gravity',   0, 30, 0.5],
  ['DAMP',    'damping',   0.5, 0.99, 0.01],
  ['ITERS',   'stiffness', 1, 20, 1],
  ['STRETCH', 'stretch',   0.2, 1, 0.05],
  ['BEND',    'bend keep', 0, 1, 0.05],
  ['LEG_R',   'leg radius',0.04, 0.2, 0.005],
  ['BODY_R',  'body radius',0.05, 0.3, 0.005],
  ['ARM_R',   'arm radius',0.03, 0.14, 0.005],
  ['WIND',    'wind',     -4, 4, 0.1],
];
const SHAPE_SPEC = [
  ['WAIST', 'attach height',0.40, 0.86, 0.01],
  ['HEM',   'hem height',   0.08, 0.55, 0.01],
  ['CINCH', 'top cinch',    0.45, 1.2, 0.02],
  ['FLARE', 'hem flare',    1.0, 3.5, 0.05],
  ['RINGS', 'rings',        4, 22, 1],
  ['SEGS',  'segments',     8, 40, 1],
];

// ---- scene -------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xeef2ff, 0x4a4636, 1.4));
const key = new THREE.DirectionalLight(0xfff4e6, 2.4); key.position.set(3, 5, 4); scene.add(key);
const fill = new THREE.DirectionalLight(0xcfe0ff, 1.1); fill.position.set(-3, 2, -2); scene.add(fill);
// ground reference line — visible in live preview, hidden during bake
const groundGrid = new THREE.GridHelper(3, 12, 0x00cc77, 0x006644);
scene.add(groundGrid);
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);

let P = {};                                       // walk params
let model = null, bones = new Map(), rest = new Map();
let center = new THREE.Vector3(), camDist = 6;
let ymin = 0, ymax = 1, bodyH = 1, axis = new THREE.Vector3();
// Amount to translate model down so sit-pose feet align with walk-pose floor level.
// Computed once after model+params load; applied every frame in sit preview + in bake.
let _sitOffset = 0;

// ---- cloth state -------------------------------------------------------------
let cloth = null;     // { pos, prev, pinned, top, offsets, cons, mesh, geo, Nu, Nv }

function boneW(name){ const b = bones.get(norm(name)); return b ? b.getWorldPosition(new THREE.Vector3()) : null; }

// estimate the body's radius (x,z) at a given world height from the skin mesh verts
let skinMesh = null, skinPos = null;
function bodyRadiusAt(y, pct = 0.9){
  if (!skinPos) return [bodyH * 0.08, bodyH * 0.06];
  const xs = [], zs = []; const band = bodyH * 0.04;
  const v = new THREE.Vector3();
  for (let i = 0; i < skinPos.count; i += 3){           // sample every 3rd vert (speed)
    v.fromBufferAttribute(skinPos, i); v.applyMatrix4(skinMesh.matrixWorld);
    if (Math.abs(v.y - y) < band){ xs.push(Math.abs(v.x - axis.x)); zs.push(Math.abs(v.z - axis.z)); }
  }
  if (xs.length < 4) return [bodyH * 0.08, bodyH * 0.06];
  xs.sort((a, b) => a - b); zs.sort((a, b) => a - b);
  return [xs[Math.floor(xs.length * pct)], zs[Math.floor(zs.length * pct)]];
}

function buildSkirt(){
  if (cloth?.mesh){ scene.remove(cloth.mesh); cloth.geo.dispose(); }
  cloth = null;
  if (GARMENT === 'none'){ status('no cloth — skinned garments only'); return; }   // cape removed
  const Nu = S.SEGS, Nv = S.RINGS;
  const attachY = ymin + bodyH * S.WAIST, hemY = ymin + bodyH * S.HEM;
  // center + top radius + pin bone depend on the garment. Use bone positions (not the
  // mesh centroid, which the belly/breasts drag forward). cloak: hangs from the
  // shoulders, pinned to the upper spine. skirt: hangs from the hip sockets.
  let cx, cz, baseX, baseZ, pinName;
  if (GARMENT === 'cloak'){
    const sL = boneW('shoulder01.L') || boneW('clavicle.L'), sR = boneW('shoulder01.R') || boneW('clavicle.R');
    cx = sL && sR ? (sL.x + sR.x) / 2 : axis.x; cz = sL && sR ? (sL.z + sR.z) / 2 : axis.z;
    const half = sL && sR ? Math.max(Math.abs(sL.x - cx), Math.abs(sR.x - cx)) + bodyH * 0.025 : bodyH * 0.15;
    baseX = half; baseZ = half * 0.72; pinName = 'spine04';
  } else {
    const pl = boneW('upperleg01.L'), pr = boneW('upperleg01.R');
    cx = axis.x; cz = axis.z; let hipHalf = bodyH * 0.11;
    if (pl && pr){ hipHalf = Math.max(Math.abs(pl.x - axis.x), Math.abs(pr.x - axis.x)) + bodyH * 0.055;
                   cx = (pl.x + pr.x) / 2; cz = (pl.z + pr.z) / 2; }
    baseX = hipHalf; baseZ = hipHalf * 0.82; pinName = 'root';
  }
  // profile: top cinch -> widening (f^0.6) -> hem flare; a continuous lofted tube.
  const topRx = baseX * S.CINCH, topRz = baseZ * S.CINCH;
  const hemRx = baseX * S.FLARE, hemRz = baseZ * S.FLARE;
  const pos = new Float32Array(Nu * Nv * 3), prev = new Float32Array(Nu * Nv * 3);
  const pinned = new Uint8Array(Nu * Nv);
  for (let r = 0; r < Nv; r++){
    const f = r / (Nv - 1), k = Math.pow(f, 0.6);
    const y = attachY + (hemY - attachY) * f;
    const rx = topRx + (hemRx - topRx) * k, rz = topRz + (hemRz - topRz) * k;
    for (let u = 0; u < Nu; u++){
      const th = 2 * Math.PI * u / Nu, i = (r * Nu + u) * 3;
      pos[i] = cx + rx * Math.cos(th); pos[i + 1] = y; pos[i + 2] = cz + rz * Math.sin(th);
      prev[i] = pos[i]; prev[i + 1] = pos[i + 1]; prev[i + 2] = pos[i + 2];
      if (r === 0) pinned[r * Nu + u] = 1;
    }
  }
  // constraints: structural (around + down), shear (diagonals), bend (skip-one down)
  const cons = [];
  const dist = (a, b) => Math.hypot(pos[a*3]-pos[b*3], pos[a*3+1]-pos[b*3+1], pos[a*3+2]-pos[b*3+2]);
  const id = (r, u) => r * Nu + ((u + Nu) % Nu);
  for (let r = 0; r < Nv; r++) for (let u = 0; u < Nu; u++){
    const a = id(r, u);
    cons.push([a, id(r, u + 1), dist(a, id(r, u + 1)), 'stretch']);
    if (r < Nv - 1) cons.push([a, id(r + 1, u), dist(a, id(r + 1, u)), 'stretch']);
    if (r < Nv - 1){ cons.push([a, id(r + 1, u + 1), dist(a, id(r + 1, u + 1)), 'stretch']);
                     cons.push([id(r, u + 1), id(r + 1, u), dist(id(r, u + 1), id(r + 1, u)), 'stretch']); }
    if (r < Nv - 2) cons.push([a, id(r + 2, u), dist(a, id(r + 2, u)), 'bend']);
  }
  // faces
  const idx = [];
  for (let r = 0; r < Nv - 1; r++) for (let u = 0; u < Nu; u++){
    const a = id(r, u), b = id(r, u + 1), c = id(r + 1, u), e = id(r + 1, u + 1);
    idx.push(a, c, b, b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b5d44, roughness: 0.95, metalness: 0,
    side: THREE.DoubleSide, flatShading: false });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  // pin the top ring in the pin-bone's local space (cloak: spine; skirt: root)
  const pinBone = norm(pinName);
  const pinB = bones.get(pinBone) || bones.get(norm('root'));
  pinB.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(pinB.matrixWorld).invert();
  const top = [], offsets = [];
  const v = new THREE.Vector3();
  for (let u = 0; u < Nu; u++){
    const i = u; top.push(i);
    v.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(inv);
    offsets.push(v.clone());
  }
  cloth = { pos, prev, pinned, top, offsets, cons, mesh, geo, Nu, Nv, pinBone, cx, cz };
  status(`${GARMENT} ${Nu}×${Nv} = ${Nu*Nv} verts, ${cons.length} constraints`);
}

// ---- solver ------------------------------------------------------------------
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _Pp = new THREE.Vector3(),
      _AB = new THREE.Vector3(), _N = new THREE.Vector3(), _v = new THREE.Vector3();
function collideCapsule(i, a, b, r){
  _Pp.set(cloth.pos[i*3], cloth.pos[i*3+1], cloth.pos[i*3+2]);
  _AB.copy(b).sub(a); const len2 = _AB.lengthSq() || 1e-6;
  let t = _v.copy(_Pp).sub(a).dot(_AB) / len2; t = Math.max(0, Math.min(1, t));
  _N.copy(a).addScaledVector(_AB, t);                 // closest point on segment
  _N.subVectors(_Pp, _N); const d = _N.length();
  if (d < r && d > 1e-6){ _N.multiplyScalar((r - d) / d);
    cloth.pos[i*3] += _N.x; cloth.pos[i*3+1] += _N.y; cloth.pos[i*3+2] += _N.z; }
}
function collideSphere(i, c, r){
  _N.set(cloth.pos[i*3]-c.x, cloth.pos[i*3+1]-c.y, cloth.pos[i*3+2]-c.z);
  const d = _N.length();
  if (d < r && d > 1e-6){ _N.multiplyScalar((r - d) / d);
    cloth.pos[i*3] += _N.x; cloth.pos[i*3+1] += _N.y; cloth.pos[i*3+2] += _N.z; }
}

function step(dt){
  if (!cloth) return;
  const { pos, prev, pinned, top, offsets, cons } = cloth;
  // pin the top ring to its bone (cloak: spine/shoulders; skirt: hips)
  const pinB = bones.get(cloth.pinBone) || bones.get(norm('root')); pinB.updateWorldMatrix(true, false);
  for (let k = 0; k < top.length; k++){
    const i = top[k]; _v.copy(offsets[k]).applyMatrix4(pinB.matrixWorld);
    pos[i*3] = prev[i*3] = _v.x; pos[i*3+1] = prev[i*3+1] = _v.y; pos[i*3+2] = prev[i*3+2] = _v.z;
  }
  // Verlet integrate free verts
  const g = -C.GRAVITY * dt * dt, w = C.WIND * dt * dt;
  for (let i = 0; i < pinned.length; i++){
    if (pinned[i]) continue;
    for (let c = 0; c < 3; c++){
      const j = i*3+c, p = pos[j], v = (p - prev[j]) * C.DAMP;
      prev[j] = p; pos[j] = p + v + (c === 1 ? g : 0) + (c === 0 ? w : 0);
    }
  }
  // collider geometry from the posed skeleton: legs, a torso capsule (so the cloak
  // drapes off the chest/back), and upper-arm capsules (swinging arms push the cloak)
  const hipL = boneW('upperleg01.L'), kneeL = boneW('lowerleg01.L'), ankL = boneW('foot.L');
  const hipR = boneW('upperleg01.R'), kneeR = boneW('lowerleg01.R'), ankR = boneW('foot.R');
  const torsoT = boneW('spine04') || boneW('neck01'), torsoB = boneW('root');
  const shL = boneW('upperarm01.L'), elL = boneW('lowerarm01.L');
  const shR = boneW('upperarm01.R'), elR = boneW('lowerarm01.R');
  for (let it = 0; it < C.ITERS; it++){
    for (const [a, b, restLen, kind] of cons){
      const k = kind === 'bend' ? C.BEND : C.STRETCH;
      if (k <= 0) continue;
      const dx = pos[b*3]-pos[a*3], dy = pos[b*3+1]-pos[a*3+1], dz = pos[b*3+2]-pos[a*3+2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, diff = (d - restLen) / d * k;
      const pa = pinned[a], pb = pinned[b];
      const wa = pa ? 0 : (pb ? 1 : 0.5), wb = pb ? 0 : (pa ? 1 : 0.5);
      pos[a*3] += dx*diff*wa; pos[a*3+1] += dy*diff*wa; pos[a*3+2] += dz*diff*wa;
      pos[b*3] -= dx*diff*wb; pos[b*3+1] -= dy*diff*wb; pos[b*3+2] -= dz*diff*wb;
    }
    for (let i = 0; i < pinned.length; i++){
      if (pinned[i]) continue;
      if (hipL && kneeL){ collideCapsule(i, hipL, kneeL, C.LEG_R); if (ankL) collideCapsule(i, kneeL, ankL, C.LEG_R*0.85); }
      if (hipR && kneeR){ collideCapsule(i, hipR, kneeR, C.LEG_R); if (ankR) collideCapsule(i, kneeR, ankR, C.LEG_R*0.85); }
      if (torsoT && torsoB) collideCapsule(i, torsoT, torsoB, C.BODY_R);
      if (shL && elL) collideCapsule(i, shL, elL, C.ARM_R);
      if (shR && elR) collideCapsule(i, shR, elR, C.ARM_R);
    }
  }
  cloth.geo.attributes.position.needsUpdate = true;
  cloth.geo.computeVertexNormals();
}

// ---- load --------------------------------------------------------------------
// Compute the downward offset so sit-pose feet align with walk-pose floor level.
// Called once after both the model and walk params are available.
function _updateSitOffset(){
  if (!model || !bones.size || P.THIGH === undefined) return;
  applyWalk(bones, rest, P, 0); model.updateWorldMatrix(true, true);
  let floorY = Infinity;
  for (const nm of ['foot.L', 'foot.R']){ const b = boneW(nm); if (b) floorY = Math.min(floorY, b.y); }
  applySit(bones, rest, P); model.updateWorldMatrix(true, true);
  let sitY = Infinity;
  for (const nm of ['foot.L', 'foot.R']){ const b = boneW(nm); if (b) sitY = Math.min(sitY, b.y); }
  _sitOffset = (isFinite(floorY) && isFinite(sitY) && sitY > floorY) ? sitY - floorY : 0;
  // Restore bind pose
  for (const [k, q] of rest){ const b = bones.get(k); if (b) b.quaternion.copy(q); }
  model.updateWorldMatrix(true, true);
}

loadParams().then(p => { P = p; _updateSitOffset(); });
new GLTFLoader().load(MODEL, g => {
  model = g.scene; scene.add(model);
  model.traverse(o => {
    if (o.isBone){ bones.set(norm(o.name), o); rest.set(norm(o.name), o.quaternion.clone()); }
    if (o.isMesh && o.material?.name === 'skin'){ skinMesh = o; skinPos = o.geometry.attributes.position; }
    // group the skinned garments (vest/leggings/hood/…) by material so each can take
    // its own wagara fabric; the body 'skin' material is left alone
    if (o.isMesh && o.material && FABRIC_MATS.has(o.material.name)){
      if (!garmentByMat.has(o.material.name)) garmentByMat.set(o.material.name, []);
      garmentByMat.get(o.material.name).push(o);
    }
  });
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  box.getCenter(center); const sz = box.getSize(new THREE.Vector3());
  ymin = box.min.y; ymax = box.max.y; bodyH = sz.y; camDist = sz.y * 1.7;
  const hip = boneW('root'); if (hip) axis.copy(hip); else axis.copy(center);
  // Position the ground grid at actual foot level (box.min.y in bind pose ≈ walk floor)
  groundGrid.position.y = box.min.y;
  _updateSitOffset();
  buildSkirt();
  const fabInit = initFabric();
  resize();
  if (BAKE) (async () => { await fabInit; bakeAndSave(BAKE); })();
}, undefined, e => status('load failed: ' + e.message));

// ---- wagara fabric -----------------------------------------------------------
// Pull a seamless tiling pattern from the wagara generator (proxied same-origin by
// server.py at /api/wagara) and print it onto the garments as a repeating texture.
// UVs are planar (world XY ÷ tile size), computed once from each garment's bind
// pose — so the print stays fixed to the fabric and deforms with the walk, like a
// real woven pattern. One fabric drives all garments for now.
const FABRIC_MATS = new Set(['vest', 'leggings', 'hood', 'dress', 'bodice', 'cloth']);
const FABRIC_ORDER = ['vest', 'leggings', 'hood', 'dress', 'bodice', 'cloth'];
const garmentByMat = new Map();             // material name -> [meshes]
// one fabric config per garment, so each part can wear a different wagara
const FAB_DEFAULTS = {
  vest:     { pattern: 'asanoha',  fg: '#2a2018', bg: '#b9a070', scale: 0.30 },
  leggings: { pattern: 'yagasuri', fg: '#241c14', bg: '#7a6a4e', scale: 0.24 },
  hood:     { pattern: 'seigaiha', fg: '#2a2018', bg: '#8a7656', scale: 0.34 },
};
const FAB = {};                             // material name -> active config
const fabFor = m => FAB[m] || (FAB[m] = { ...(FAB_DEFAULTS[m] || FAB_DEFAULTS.vest) });
let patMeta = {}; const fabTex = new Map(); let fabricReady = Promise.resolve();

function planarUV(geo, scale){              // world XY ÷ tile size; one period per `scale`
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++){ uv[2*i] = p.getX(i) / scale; uv[2*i+1] = p.getY(i) / scale; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.attributes.uv.needsUpdate = true;
}

function fabricURL(f){
  const m = patMeta[f.pattern] || { tw: 2, th: 2 };
  const s = 64;                              // px per pattern unit in the source SVG
  const q = new URLSearchParams({ pattern: f.pattern, fg: f.fg.replace('#', ''),
    bg: f.bg.replace('#', ''), s: String(s),
    w: String(Math.round(m.tw * s)), h: String(Math.round(m.th * s)) });
  return '/api/wagara?' + q.toString();
}

function meshesFor(mat){ const m = [...(garmentByMat.get(mat) || [])];
  if (mat === 'cloth' && cloth?.mesh) m.push(cloth.mesh); return m; }

function loadOne(mat){                       // load this garment's fabric + repaint it
  const f = fabFor(mat), meshes = meshesFor(mat);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4; tex.needsUpdate = true;
      if (fabTex.get(mat)) fabTex.get(mat).dispose(); fabTex.set(mat, tex);
      for (const o of meshes){
        planarUV(o.geometry, f.scale);
        o.material.map = tex; o.material.color.set(0xffffff); o.material.needsUpdate = true;
      }
      resolve();
    };
    img.onerror = () => { status('fabric load failed: ' + mat); resolve(); };
    img.src = fabricURL(f);
  });
}

function applyFabric(mat){                    // one garment, or all when mat is omitted
  const mats = mat ? [mat] : [...garmentByMat.keys()];
  fabricReady = Promise.all(mats.map(loadOne));
  return fabricReady;
}

async function initFabric(){
  try { patMeta = await (await fetch('/api/wagara?patterns')).json(); }
  catch { patMeta = { asanoha: { tw: 2, th: 2 } }; }
  // open on the authored outfit (outfit.json) so the studio reflects the saved look
  try {
    const o = await (await fetch('/outfit.json?_=' + Date.now())).json();
    for (const [mat, f] of Object.entries(o.fabric || {}))
      FAB[mat] = { ...(FAB_DEFAULTS[mat] || FAB_DEFAULTS.vest), ...f };
  } catch { /* no saved outfit yet — fall back to FAB_DEFAULTS */ }
  const host = $('grp-fabric');
  for (const mat of FABRIC_ORDER){
    if (!garmentByMat.has(mat)) continue;
    const f = fabFor(mat);
    const box = document.createElement('div');
    box.style.cssText = 'margin:6px 0;padding:6px 7px;border:1px solid var(--line);border-radius:5px';
    const h = document.createElement('div'); h.textContent = mat;
    h.style.cssText = 'color:var(--accent);font-size:11px;text-transform:capitalize;margin:0 0 4px';
    box.appendChild(h);
    const prow = document.createElement('label'); prow.innerHTML = `<span class="nm">pattern</span>`;
    const sel = document.createElement('select');
    sel.style.cssText = 'flex:1;min-width:0;background:#15151b;color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:3px';
    for (const [k, m] of Object.entries(patMeta)){ const o = document.createElement('option');
      o.value = k; o.textContent = m.label || k; if (k === f.pattern) o.selected = true; sel.appendChild(o); }
    sel.onchange = () => { f.pattern = sel.value; applyFabric(mat); };
    prow.appendChild(sel); box.appendChild(prow);
    const colorRow = (lbl, key) => { const row = document.createElement('label');
      row.innerHTML = `<span class="nm">${lbl}</span><input type="color" style="flex:1;min-width:0">`;
      const inp = row.querySelector('input'); inp.value = f[key];
      inp.oninput = () => { f[key] = inp.value; applyFabric(mat); }; box.appendChild(row); };
    colorRow('thread', 'fg'); colorRow('cloth', 'bg');
    host.appendChild(box);
    slider(box, 'size', 0.08, 1.0, 0.02, () => f.scale,
      v => { f.scale = v; for (const o of meshesFor(mat)) planarUV(o.geometry, v); });
  }
  // Save the authored outfit (garments present + their fabric) to outfit.json, so
  // the batch baker (tools/bake_leas.py) dresses every Lea the same way.
  const saveBtn = document.createElement('button'); saveBtn.className = 'sec';
  saveBtn.textContent = 'Save outfit → outfit.json';
  saveBtn.onclick = async () => {
    const garments = [...garmentByMat.keys()], fabric = {};
    for (const m of garments) fabric[m] = fabFor(m);
    try {
      const r = await fetch('/api/save-outfit', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ garments, fabric }) });
      const j = await r.json();
      status(j.ok ? `saved outfit (${j.garments} garments)` : 'save failed: ' + j.error);
    } catch (e){ status('save failed: ' + e); }
  };
  host.appendChild(saveBtn);
  await applyFabric();
}

// ---- bake --------------------------------------------------------------------
// Run the cloth sim over the gait cycle (settle, then capture the skirt geometry at
// each walk frame), then render the dressed figure (body + skinned bodice + the
// simulated skirt) into the 5×10 directional atlas and POST it to the game. Same
// solver as the live preview, with extra iterations/substeps for clean collision.
let baking = false;
const BAKE = _q.get('bake');
async function bakeAndSave(slug){
  if (!model){ status('not ready'); return; }
  if (P.THIGH === undefined) P = await loadParams();      // ensure the walk is loaded
  await fabricReady;                                       // textures painted before render
  baking = true; status('baking ' + slug + '…');
  await new Promise(r => setTimeout(r, 40));
  const rows = 5, walkLen = 9, cols = 10, cellH = 256;

  // if a simulated garment exists, settle it and capture a snapshot per walk frame
  let snaps = null;
  if (cloth){
    const savedIters = C.ITERS; C.ITERS = 22; const SUB = 8; let ph = 0;
    const simTo = nph => { for (let s = 1; s <= SUB; s++){
        const f = ph + (nph - ph) * s / SUB; applyPose(((f % 1) + 1) % 1);
        model.updateWorldMatrix(true, true); step(1 / 60); } ph = nph; };
    for (let i = 1; i <= walkLen * 4; i++) simTo(i / walkLen);
    const base = Math.ceil(ph); snaps = [];
    for (let k = 0; k < walkLen; k++){ simTo(base + k / walkLen); snaps.push(cloth.pos.slice()); }
    C.ITERS = savedIters;
  }

  const cx = cloth ? cloth.cx : axis.x, cz = cloth ? cloth.cz : axis.z;
  // framing: ground from the lowest foot over the cycle; width from cloth (or bone-derived)
  let groundY = Infinity, maxR = bodyH * 0.13;
  const savedYmax = ymax;
  const savedModelY = model.position.y;  // frame loop has already applied sit offset
  groundGrid.visible = false;   // hide grid from baked sprite
  if (POSE_MODE === 'sit') {
    // _sitOffset is pre-computed at load time; the frame loop set model.position.y = -_sitOffset
    // so sit feet are already at walk-floor level. Just apply sit pose to read bone positions.
    applyPose(0); model.updateWorldMatrix(true, true);
    // Use head bone Y for the top of frame (bind-pose ymax is standing height, too tall)
    const hb = boneW('head') || boneW('neck01');
    if (hb) ymax = hb.y + bodyH * 0.10;
    // Capture forward leg extent from bone positions (Box3 on a SkinnedMesh returns bind bounds)
    for (const nm of ['foot.L', 'foot.R', 'lowerleg01.L', 'lowerleg01.R']) {
      const b = boneW(nm); if (b) maxR = Math.max(maxR, Math.abs(b.x - cx), Math.abs(b.z - cz));
    }
  }
  if (!cloth && POSE_MODE !== 'sit'){
    applyPose(0); model.updateWorldMatrix(true, true);
    const bb = new THREE.Box3().setFromObject(model);
    maxR = Math.max(maxR, bb.max.x - cx, cx - bb.min.x, bb.max.z - cz, cz - bb.min.z);
  }
  for (let k = 0; k < walkLen; k++){
    applyPose(k / walkLen); model.updateWorldMatrix(true, true);
    for (const f of [boneW('foot.L'), boneW('foot.R')]) if (f) groundY = Math.min(groundY, f.y);
    if (cloth){ const sp = snaps[k];
      for (let i = 0; i < sp.length; i += 3) maxR = Math.max(maxR, Math.hypot(sp[i] - cx, sp[i + 2] - cz)); }
  }
  groundY -= bodyH * 0.03;
  const PAD = 1.08, figH = (ymax - groundY) * PAD, halfH = figH / 2, midY = (ymax + groundY) / 2;
  const halfW = maxR * 1.08, cellW = Math.max(48, Math.round(cellH * (2 * halfW) / figH));
  const center = new THREE.Vector3(cx, midY, cz);

  const br = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  br.setClearColor(0x000000, 0); br.outputColorSpace = THREE.SRGBColorSpace;
  br.toneMapping = THREE.ACESFilmicToneMapping; br.setSize(cellW, cellH, false);
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.01, 100);
  // orbit −yaw to match baker.html's turntable convention (front→back), else the
  // facing rows come out mirror-reversed and she reads as walking backwards
  const camAt = yaw => { cam.position.set(center.x - Math.sin(yaw) * 20, center.y, center.z + Math.cos(yaw) * 20); cam.lookAt(center); };
  const setFrame = cloth
    ? k => { cloth.geo.attributes.position.array.set(snaps[k]); cloth.geo.attributes.position.needsUpdate = true; cloth.geo.computeVertexNormals(); }
    : () => {};

  // auto-expose to ~lum 50 on the front mid-stride frame (matches the other sprites)
  const scratch = document.createElement('canvas'); scratch.width = cellW; scratch.height = cellH;
  const sc = scratch.getContext('2d');
  applyPose(4 / walkLen); model.updateWorldMatrix(true, true); setFrame(4); camAt(0);
  const probe = () => { br.render(scene, cam); sc.clearRect(0, 0, cellW, cellH); sc.drawImage(br.domElement, 0, 0);
    const d = sc.getImageData(0, 0, cellW, cellH).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 16){ s += 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; n++; }
    return n ? s / n : 0; };
  // ?exp=<n> fixes the exposure (so a clan baked together keeps true RELATIVE skin
  // tones); otherwise auto-expose each sprite to ~lum 50 like the other NPCs.
  const FIXED_EXP = parseFloat(_q.get('exp'));
  let e = 1.25;
  if (Number.isFinite(FIXED_EXP)){ e = FIXED_EXP; br.toneMappingExposure = e; }
  else for (let it = 0; it < 6; it++){ br.toneMappingExposure = e; const L = probe();
    if (!L || Math.abs(L - 50) < 2) break; e = Math.min(8, Math.max(0.1, e * Math.min(2, Math.max(0.5, 50 / L)))); }

  // render the atlas: rows = facings (front→back), cols = stand + walk frames
  const atlas = document.createElement('canvas'); atlas.width = cols * cellW; atlas.height = rows * cellH;
  const ax = atlas.getContext('2d');
  for (let r = 0; r < rows; r++){
    const yaw = r * Math.PI / (rows - 1);
    for (let c = 0; c < cols; c++){
      const k = c === 0 ? 0 : c - 1;
      applyPose(c === 0 ? 0 : (c - 1) / walkLen); model.updateWorldMatrix(true, true);
      setFrame(k); camAt(yaw); br.render(scene, cam);
      ax.drawImage(br.domElement, c * cellW, r * cellH, cellW, cellH);
    }
  }

  try {
    const res = await fetch('/api/save-sprite', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, png: atlas.toDataURL('image/png'), frameW: cellW, frameH: cellH, cols, rows, walkLen }) });
    const j = await res.json();
    status(j.ok ? 'saved → ' + j.file : 'save failed: ' + j.error);
    document.title = j.ok ? 'BAKE_OK ' + slug : 'BAKE_ERR ' + j.error;
  } catch (err){ status('save failed: ' + err); document.title = 'BAKE_ERR ' + err; }
  ymax = savedYmax;
  model.position.y = savedModelY;
  groundGrid.visible = true;
  br.dispose();
}

// ---- loop --------------------------------------------------------------------
let t = 0, last = performance.now();
function frame(now){
  if (baking){ requestAnimationFrame(frame); return; }
  let dt = (now - last) / 1000; last = now; dt = Math.min(dt, 1 / 30);
  if (!play.paused){ t += dt * play.speed; }
  if (model){
    // Ground the model: sit pose floats the hips up, translate down to match walk floor
    model.position.y = POSE_MODE === 'sit' ? -_sitOffset : 0;
    applyPose(((t % 1) + 1) % 1);
    model.updateWorldMatrix(true, true);
  }
  if (!play.paused) step(1 / 60);
  if (play.orbit) play.facing = (play.facing + dt * 34) % 360;
  const yaw = THREE.MathUtils.degToRad(play.facing), tl = THREE.MathUtils.degToRad(play.tilt);
  camera.position.set(center.x + Math.sin(yaw) * Math.cos(tl) * camDist,
                      center.y + Math.sin(tl) * camDist,
                      center.z + Math.cos(yaw) * Math.cos(tl) * camDist);
  camera.lookAt(center);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function resize(){ const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

// ---- UI ----------------------------------------------------------------------
function slider(parent, label, min, max, step, get, set){
  const row = document.createElement('label');
  row.innerHTML = `<span class="nm">${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><span class="v"></span>`;
  const inp = row.querySelector('input'), val = row.querySelector('.v');
  const show = () => val.textContent = (+get()).toFixed(step < 1 ? 2 : 0);
  inp.value = get(); show();
  inp.oninput = () => { set(+inp.value); show(); };
  parent.appendChild(row); return inp;
}

slider($('grp-play'), 'speed', 0, 3, 0.1, () => play.speed, v => play.speed = v);
{ const row = document.createElement('label');
  row.innerHTML = `<span class="nm">auto-orbit</span><input type="checkbox" ${play.orbit ? 'checked' : ''}><span class="v"></span>`;
  row.querySelector('input').onchange = e => play.orbit = e.target.checked; $('grp-play').appendChild(row); }
const facingInp = slider($('grp-play'), 'facing', 0, 360, 5, () => play.facing, v => play.facing = v);
slider($('grp-play'), 'tilt', -20, 40, 1, () => play.tilt, v => play.tilt = v);
{ const b = document.createElement('button'); b.textContent = 'Bake to game (lea)';
  b.onclick = () => bakeAndSave('lea'); $('grp-play').appendChild(b); }

for (const [k, label, mn, mx, st] of CLOTH_SPEC)
  slider($('grp-cloth'), label, mn, mx, st, () => C[k], v => C[k] = v);
for (const [k, label, mn, mx, st] of SHAPE_SPEC)
  slider($('grp-shape'), label, mn, mx, st, () => S[k], v => { S[k] = v; if (model) buildSkirt(); });

$('pause').onclick = () => { play.paused = !play.paused; $('pause').textContent = play.paused ? 'Play' : 'Pause'; };
$('resim').onclick = () => { if (model) buildSkirt(); };

// drag to rotate
let drag = false, lastX = 0;
canvas.style.cursor = 'grab';
canvas.addEventListener('pointerdown', e => { drag = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; play.orbit = false; });
canvas.addEventListener('pointermove', e => { if (!drag) return; play.facing = (play.facing + (e.clientX - lastX) * 0.4 + 360) % 360; lastX = e.clientX; facingInp.value = play.facing; });
const end = () => { drag = false; canvas.style.cursor = 'grab'; };
canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
