// Shared procedural-walk formula — the single JS source of truth, used by the Walk
// Studio and the Cloth Studio so they animate identically. Mirrors the Python in
// tools/anny_walk.py (same axes/signs); both read the same walk_params.json.

import * as THREE from 'three';

export const SPINE = ['spine01', 'spine02', 'spine03', 'spine04', 'spine05'];
export const norm = n => n.replace(/[^a-z0-9]/gi, '').toLowerCase();

// fallback defaults (mirror tools/anny_walk.py DEFAULTS); walk_params.json overrides
export const DEFAULTS = {
  ARM_DOWN: 50, ARM_ADDUCT: 5, SHOULDER_IN: -8, ARM_PITCH: 0, ARM_PRON: 38, FOREARM_IN: 0,
  ARM_SWING: 28, ELBOW_BASE: 36, ELBOW_FOLLOW: 16,
  THIGH: 27, KNEE: 31, KNEE_BASE: 5, LEG_ADDUCT: 15, FOOT: 19,
  PELVIS_YAW: 13, PELVIS_SWAY: 0, SPINE_TWIST: 3.5, SPINE_LEAN: 4, CLAV: 6.5, HEAD_STAB: 1,
  // breathing (mirrors tools/anny_walk.py). Sprite frames are ~180 px for a 1.6 m
  // body — 9 mm PER PIXEL — so a real 5 mm breath is 0.6 px and invisible. Bakes
  // exaggerate via BREATH_GAIN (?breath=N); live 3D uses 1.
  BREATH_CHEST: 1.0, BREATH_CLAV: 0.8, BREATH_HEAD: 0.25, BREATH_SWAY: 0.4, BREATH_GAIN: 1,
  CLIP_ARM_OUT: 8,   // mocap clips: degrees to swing the arms out (applyClip armOut)
};

export async function loadParams(){
  const P = { ...DEFAULTS };
  try {
    const saved = await fetch('walk_params.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {});
    Object.assign(P, saved);
  } catch { /* keep defaults */ }
  return P;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
export function rotvecQuat(rx, ry, rz){            // degrees -> quaternion (axis-angle)
  _v.set(rx, ry, rz).multiplyScalar(Math.PI / 180);
  const a = _v.length();
  return a < 1e-9 ? _q.identity() : _q.setFromAxisAngle(_v.normalize(), a);
}

// walk_pose(P, frac) -> { boneLabel: [rx,ry,rz] degrees }
export function walkPose(P, frac){
  const p = frac * 2 * Math.PI, s = Math.sin(p), s2 = Math.sin(2 * p), mx = Math.max;
  const L = s, R = -s;
  const d = {
    'upperleg01.L': [P.THIGH * L, -P.LEG_ADDUCT, 0],
    'upperleg01.R': [P.THIGH * R,  P.LEG_ADDUCT, 0],
    'lowerleg01.L': [P.KNEE_BASE + mx(0, -Math.sin(p - 0.6)) * P.KNEE, 0, 0],
    'lowerleg01.R': [P.KNEE_BASE + mx(0, -Math.sin(p + Math.PI - 0.6)) * P.KNEE, 0, 0],
    'foot.L': [-P.THIGH * L * 0.35 + mx(0, Math.sin(p - 0.3)) * P.FOOT, 0, 0],
    'foot.R': [-P.THIGH * R * 0.35 + mx(0, Math.sin(p + Math.PI - 0.3)) * P.FOOT, 0, 0],
    'upperarm01.L': [P.ARM_PITCH - P.ARM_SWING * L,  P.ARM_DOWN + P.ARM_ADDUCT, 0],
    'upperarm01.R': [P.ARM_PITCH - P.ARM_SWING * R, -P.ARM_DOWN - P.ARM_ADDUCT, 0],
    'lowerarm01.L': [P.ELBOW_BASE + mx(0, -L) * P.ELBOW_FOLLOW, -P.FOREARM_IN,  P.ARM_PRON],
    'lowerarm01.R': [P.ELBOW_BASE + mx(0, -R) * P.ELBOW_FOLLOW,  P.FOREARM_IN, -P.ARM_PRON],
    'shoulder01.L': [0, 0,  P.SHOULDER_IN],
    'shoulder01.R': [0, 0, -P.SHOULDER_IN],
    'clavicle.L': [0, 0, -P.CLAV * L],
    'clavicle.R': [0, 0,  P.CLAV * R],
    'root': [0, P.PELVIS_SWAY * s2, P.PELVIS_YAW * s],
    'neck01': [0, 0, P.HEAD_STAB * s],
  };
  for (const sp of SPINE) d[sp] = [P.SPINE_LEAN / 5, 0, -P.SPINE_TWIST / 5 * s];
  return d;
}

// apply the walk to a posed skeleton. `bones`/`rest` are Maps keyed by norm(name).
export function applyWalk(bones, rest, P, frac){
  const pose = walkPose(P, frac);
  for (const label in pose){
    const b = bones.get(norm(label)), r = rest.get(norm(label));
    if (b) b.quaternion.copy(r).multiply(rotvecQuat(...pose[label]));
  }
}

// ---- mocap clips (tools/cmu_retarget.py → clips/mocap/<name>.json) ----------
// A clip is a looping recorded stride in WORLD terms: per mapped bone, its world
// rotation since the source's T-pose, and for each limb the T-pose direction. The
// body is fitted here, against whatever model is loaded: each limb is first turned
// from its own rest direction onto the T-pose one (ANNY binds in an A-pose), then
// the recorded rotation is applied and localised to the bone's parent. Local deltas
// baked in Python did not survive a change of body — ANNY's bone axes shift with
// phenotype, and the hands swung across the pelvis. The clip also carries a root
// offset (bob + sway, travel removed), which the procedural walk never had.

export async function loadClipIndex(){
  try { return await fetch('clips/mocap/index.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : []); }
  catch { return []; }
}

export async function loadClip(name, base = 'clips/mocap/'){
  const r = await fetch(`${base}${encodeURIComponent(name)}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`clip ${name}: HTTP ${r.status}`);
  const c = await r.json();
  if (c.version !== 2) throw new Error(`clip ${name}: old format, re-run tools/cmu_retarget.py`);
  c.tracks = c.bones.map(t => ({ key: norm(t.bone), aim: t.aim && norm(t.aim),
    dir: t.dir && new THREE.Vector3(...t.dir), q: t.q.map(a => new THREE.Quaternion(a[0], a[1], a[2], a[3])) }));
  c.fits = new WeakMap();   // bones Map -> per-body alignment
  return c;
}

// Put every bone back to rest, root position included.
export function resetPose(bones, rest){
  for (const [k, b] of bones){ const r = rest.get(k); if (r) b.quaternion.copy(r); }
  const root = bones.get('root');
  if (root?.userData.restPos) root.position.copy(root.userData.restPos);
}

// Rotation of a bone relative to the skeleton's root space (the root's parent),
// composed from local quaternions, so a turntable or model offset doesn't enter.
function rootSpaceQ(b, out){
  out.copy(b.quaternion);
  for (let p = b.parent; p?.isBone; p = p.parent) out.premultiply(p.quaternion);
  return out;
}

function fitClip(bones, rest, clip){
  const root = bones.get('root');
  root.userData.restPos ??= root.position.clone();
  resetPose(bones, rest);
  root.updateWorldMatrix(true, true);
  const toRoot = new THREE.Matrix4().copy(root.parent.matrixWorld).invert();
  const pos = b => b.getWorldPosition(new THREE.Vector3()).applyMatrix4(toRoot);
  const fit = new Map();
  for (const t of clip.tracks){
    const b = bones.get(t.key);
    if (!b) continue;
    const base = rootSpaceQ(b, new THREE.Quaternion());          // rest, in root space
    const aim = t.aim && bones.get(t.aim);
    if (aim && t.dir){
      const d = pos(aim).sub(pos(b)).normalize();
      base.premultiply(new THREE.Quaternion().setFromUnitVectors(d, t.dir));
    }
    fit.set(t.key, base);
  }
  clip.fits.set(bones, fit);
  return fit;
}

// armOut (degrees): swing each whole arm out from the shoulder. The CMU walkers
// are narrow-hipped men; on a wider-hipped body their arm path runs the forearm
// through the hips, which reads from the front as arms crossing the body.
const ARM = { upperarm01l: 1, lowerarm01l: 1, upperarm01r: -1, lowerarm01r: -1 };
const _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qo = new THREE.Quaternion();
const _fwd = new THREE.Vector3(0, 0, 1);
export function applyClip(bones, rest, clip, frac, { armOut = 0 } = {}){
  const fit = clip.fits.get(bones) || fitClip(bones, rest, clip);
  const n = clip.frames, x = (((frac % 1) + 1) % 1) * n;
  const i = Math.floor(x) % n, j = (i + 1) % n, u = x - Math.floor(x);
  for (const t of clip.tracks){                                  // parents before children
    const b = bones.get(t.key), base = fit.get(t.key);
    if (!b || !base) continue;
    _qa.slerpQuaternions(t.q[i], t.q[j], u).multiply(base);      // target, root space
    if (armOut && ARM[t.key]) _qa.premultiply(_qo.setFromAxisAngle(_fwd, ARM[t.key] * armOut * Math.PI / 180));
    if (b.parent?.isBone) _qa.premultiply(rootSpaceQ(b.parent, _qp).invert());
    b.quaternion.copy(_qa);
  }
  const root = bones.get('root');
  if (root){
    const a = clip.root[i], c = clip.root[j];
    root.position.set(a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u)
      .add(root.userData.restPos);
  }
}

// Breathing, added onto any pose. Mirrors anny_walk.breathe_into(): the chest opens,
// the collarbones rise, the head settles, and a slow lateral drift at HALF the breath
// rate keeps it from being metronomic.
export function breatheInto(d, P, frac){
  const g = P.BREATH_GAIN ?? 1;
  const s = Math.sin(frac * 2 * Math.PI) * g, drift = Math.sin(frac * Math.PI + 0.7) * g;
  const add = (bone, rx = 0, ry = 0, rz = 0) => {
    const [x, y, z] = d[bone] || [0, 0, 0];
    d[bone] = [x + rx, y + ry, z + rz];
  };
  for (const sp of ['spine02', 'spine03', 'spine04']) add(sp, -P.BREATH_CHEST * s / 3);
  add('clavicle.L', 0, 0, -P.BREATH_CLAV * s);
  add('clavicle.R', 0, 0,  P.BREATH_CLAV * s);
  add('neck01', P.BREATH_HEAD * s * 0.5);
  add('root', P.BREATH_SWAY * 0.5 * drift, P.BREATH_SWAY * drift, 0);
  add('foot.L', -P.BREATH_SWAY * 0.4 * drift);
  add('foot.R', -P.BREATH_SWAY * 0.4 * drift);
  return d;
}

// Standing still, but breathing — what a baked *idle* sheet needs, since the game
// shows one frozen frame while an NPC is planted.
export function standPose(P){
  return {
    'upperarm01.L': [0,  P.ARM_DOWN, 0], 'upperarm01.R': [0, -P.ARM_DOWN, 0],
    'lowerarm01.L': [-P.ELBOW_BASE, 0, 0], 'lowerarm01.R': [-P.ELBOW_BASE, 0, 0],
    'lowerleg01.L': [P.KNEE_BASE, 0, 0], 'lowerleg01.R': [P.KNEE_BASE, 0, 0],
  };
}
export function idlePose(P, frac){ return breatheInto(standPose(P), P, frac); }
export function applyIdle(bones, rest, P, frac){
  const pose = idlePose(P, frac);
  for (const label in pose){
    const b = bones.get(norm(label)), r = rest.get(norm(label));
    if (b) b.quaternion.copy(r).multiply(rotvecQuat(...pose[label]));
  }
}

// Static seated rest pose — mirrors tools/anny_walk.py sit_pose().
export function sitPose(P){
  const d = {
    'upperleg01.L': [-82, -5, 0], 'upperleg01.R': [-138, -13, 0],
    'lowerleg01.L': [8,   0, 0],  'lowerleg01.R': [100,   0, 0],
    'foot.L': [14,  0, 0],        'foot.R': [12,    0, 0],
    'upperarm01.L': [-12,  P.ARM_DOWN, 0],
    'upperarm01.R': [-12, -P.ARM_DOWN, 0],
    'lowerarm01.L': [P.ELBOW_BASE * 0.5,  -4, 0],
    'lowerarm01.R': [P.ELBOW_BASE * 0.5,   4, 0],
    'root': [0, 0, 0],
  };
  for (const sp of SPINE) d[sp] = [-4.0, 0, 0];
  return d;
}

export function applySit(bones, rest, P){
  const pose = sitPose(P);
  for (const label in pose){
    const b = bones.get(norm(label)), r = rest.get(norm(label));
    if (b) b.quaternion.copy(r).multiply(rotvecQuat(...pose[label]));
  }
}
