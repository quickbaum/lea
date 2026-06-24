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
