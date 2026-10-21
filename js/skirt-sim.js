// skirt-sim.js — the cloth below the belt, for an outfit (js/outfit.js) skirt.
//
// A skirt can't be cut from a body that splits at the legs, so it is cloth: a
// lofted ring-grid pinned to the hips at the belt line, Verlet-integrated with
// stretch/shear/bend constraints. Its rest shape starts from the belt line's real
// outline, drapes over the body's own profile below it (hips, seat — a fixed
// ellipse stood proud and went boxy), flares toward the hem, and carries outward-
// only pleats (an inward valley let the shirt hem show).
//
// Collision: the body's profile (in the hips' rest frame) down to the crotch; below
// it, capsules round each leg bone as fat as the trousers there (a fixed 10 cm
// capsule sat inside a loose trouser leg). A tether keeps each vertex within reach
// of where it hangs at rest — ~2 cm at the waistband, ~15 cm at the hem — so a
// skirt can swing but not blow all the way back; it runs BEFORE the collisions, so
// a stepping leg still wins.
//
// Same code in the Cloth Studio's preview and the in-game baker (js/avatar-bake.js).

import * as THREE from 'three';

const norm = n => n.replace(/[^a-z0-9]/gi, '').toLowerCase();
export const SIM_DEFAULTS = { GRAVITY: 9, DAMP: 0.92, ITERS: 11, STRETCH: 1.0, BEND: 0.3, ARM_R: 0.06, WIND: 0 };

function profAt(P, ang, y){
  const fr = Math.min(P.ny - 1, Math.max(0, (P.ya - y) / (P.ya - P.yb) * (P.ny - 1)));
  const fc = ((ang / (2 * Math.PI) * P.nt) % P.nt + P.nt) % P.nt;
  const r0 = Math.floor(fr), r1 = Math.min(P.ny - 1, r0 + 1), c0 = Math.floor(fc) % P.nt, c1 = (c0 + 1) % P.nt;
  const u = fr - r0, v = fc - Math.floor(fc), R = P.r, n = P.nt;
  return (R[r0*n+c0] * (1-v) + R[r0*n+c1] * v) * (1-u) + (R[r1*n+c0] * (1-v) + R[r1*n+c1] * v) * u;
}

const _v = new THREE.Vector3(), _A = new THREE.Vector3(), _Pp = new THREE.Vector3(), _AB = new THREE.Vector3(),
      _N = new THREE.Vector3(), _M = new THREE.Matrix4(), _Mi = new THREE.Matrix4();

export class SkirtSim {
  // spec: outfit.skirt; bones: Map(norm name -> Bone), posed at REST when constructed
  constructor(spec, bones, params = {}){
    this.sp = spec; this.bones = bones; this.C = { ...SIM_DEFAULTS, ...params };
    const sp = spec, Nu = sp.segs, Nv = sp.rings;
    const pos = new Float32Array(Nu * Nv * 3), col = new Float32Array(Nu * Nv * 3), uv = new Float32Array(Nu * Nv * 2);
    const pinned = new Uint8Array(Nu * Nv);
    const n = sp.topR.length;
    for (let r = 0; r < Nv; r++){
      const f = r / (Nv - 1), k = f ** 1.5, y = sp.attachY + (sp.hemY - sp.attachY) * f;
      for (let u = 0; u < Nu; u++){
        const th = 2 * Math.PI * u / Nu, i = (r * Nu + u) * 3;
        const q = th / (2 * Math.PI) * n, k0 = Math.floor(q) % n, t = q - Math.floor(q);
        let rad = (sp.topR[k0] * (1 - t) + sp.topR[(k0 + 1) % n] * t) * (1 + (sp.flare - 1) * k);
        const need = profAt(sp.profile, th, y) + 0.012;
        if (rad < need) rad = need;
        const w = Math.abs(Math.sin(sp.pleats * th / 2)), m = 1 + sp.pleat * w;
        pos[i] = sp.cx + Math.cos(th) * rad * m; pos[i+1] = y; pos[i+2] = sp.cz + Math.sin(th) * rad * m;
        const a = (1 - 0.5 * (1 - w)) * (0.72 + 0.28 * Math.min(1, f * 3));
        col[i] = col[i+1] = col[i+2] = a;
        uv[(r * Nu + u) * 2] = u / Nu * 14; uv[(r * Nu + u) * 2 + 1] = y / 0.06;
        if (r === 0) pinned[r * Nu + u] = 1;
      }
    }
    const id = (r, u) => r * Nu + ((u + Nu) % Nu);
    const dist = (a, b) => Math.hypot(pos[a*3]-pos[b*3], pos[a*3+1]-pos[b*3+1], pos[a*3+2]-pos[b*3+2]);
    const cons = [];
    for (let r = 0; r < Nv; r++) for (let u = 0; u < Nu; u++){
      const a = id(r, u);
      cons.push([a, id(r, u + 1), dist(a, id(r, u + 1)), 0]);
      if (r < Nv - 1){
        cons.push([a, id(r + 1, u), dist(a, id(r + 1, u)), 0]);
        cons.push([a, id(r + 1, u + 1), dist(a, id(r + 1, u + 1)), 0]);
        cons.push([id(r, u + 1), id(r + 1, u), dist(id(r, u + 1), id(r + 1, u)), 0]);
      }
      if (r < Nv - 2) cons.push([a, id(r + 2, u), dist(a, id(r + 2, u)), 1]);
    }
    const idx = [];
    for (let r = 0; r < Nv - 1; r++) for (let u = 0; u < Nu; u++){
      const a = id(r, u), b = id(r, u + 1), c = id(r + 1, u), e = id(r + 1, u + 1);
      idx.push(a, c, b, b, c, e);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, sp.material); this.mesh.frustumCulled = false; this.mesh.name = 'skirt';
    const pinB = this.pin = bones.get('root');
    pinB.updateWorldMatrix(true, false);
    this.restInv = new THREE.Matrix4().copy(pinB.matrixWorld).invert();
    this.top = []; this.offsets = [];
    for (let u = 0; u < Nu; u++){ this.top.push(u); this.offsets.push(new THREE.Vector3(pos[u*3], pos[u*3+1], pos[u*3+2]).applyMatrix4(this.restInv)); }
    Object.assign(this, { geo, pos, prev: pos.slice(), restPos: pos.slice(), pinned, cons, Nu, Nv });
    this.floor = -Infinity;                                  // world y the cloth can't go below
    // Where the tether pulls: not the rest shape fixed to the hips, but that shape partly
    // CARRIED BY THE THIGHS — more toward the hem, and by the leg on that side (the front
    // and back middle share both). The sim alone let a stepping leg tear a hole in a long
    // skirt; guided like this the cloth goes with the leg and the sim adds the swing.
    // thighs, and shins for the lower skirt: a trailing shin kicks back and up behind
    this.legs = ['upperleg01l', 'upperleg01r', 'lowerleg01l', 'lowerleg01r'].map(n => bones.get(n));
    this.legRestInv = this.legs.map(b => b ? new THREE.Matrix4().copy(b.matrixWorld).invert() : null);
    this.shinW = new Float32Array(Nv).map((_, r) => 0.6 * Math.min(1, Math.max(0, (r / (Nv - 1) - 0.45) / 0.55)));
    const follow = sp.follow ?? 0;
    this.wL = new Float32Array(Nu * Nv); this.wR = new Float32Array(Nu * Nv);
    for (let r = 0; r < Nv; r++) for (let u = 0; u < Nu; u++){
      const i = r * Nu + u, f = r / (Nv - 1), side = Math.cos(2 * Math.PI * u / Nu);   // +x side = the left leg
      const w = follow * Math.min(1, f * 1.6) ** 1.2, l = Math.min(1, Math.max(0, 0.5 + side * 1.2));
      this.wL[i] = w * l; this.wR[i] = w * (1 - l);
    }
  }
  bone(n){ const b = this.bones.get(norm(n)); return b ? b.getWorldPosition(new THREE.Vector3()) : null; }

  // The hot loop. Constraints live in typed arrays and the colliders' endpoints and
  // matrices are fetched once a step, then everything is inline arithmetic: a bake
  // settles a long skirt over thousands of iterations (16 s on the Pi before this).
  step(dt = 1 / 60){
    const { pos, prev, pinned, C, Nu, Nv } = this, n = pinned.length;
    if (!this.ca){                                       // constraints -> typed arrays, once
      const m = this.cons.length; this.ca = new Int32Array(m); this.cb = new Int32Array(m); this.cr = new Float32Array(m); this.ck = new Uint8Array(m);
      this.cons.forEach(([a, b, r, k], i) => { this.ca[i] = a; this.cb[i] = b; this.cr[i] = r; this.ck[i] = k; });
    }
    const { ca, cb, cr, ck } = this, M = ca.length;
    this.pin.updateWorldMatrix(true, false);
    const PW = this.pin.matrixWorld;
    for (let k = 0; k < this.top.length; k++){
      const i = this.top[k]; _v.copy(this.offsets[k]).applyMatrix4(PW);
      pos[i*3] = prev[i*3] = _v.x; pos[i*3+1] = prev[i*3+1] = _v.y; pos[i*3+2] = prev[i*3+2] = _v.z;
    }
    const g = -C.GRAVITY * dt * dt, w = C.WIND * dt * dt, damp = C.DAMP;
    for (let i = 0; i < n; i++){
      if (pinned[i]) continue;
      for (let c = 0; c < 3; c++){ const j = i*3+c, p = pos[j], v = (p - prev[j]) * damp; prev[j] = p; pos[j] = p + v + (c === 1 ? g : 0) + (c === 0 ? w : 0); }
    }
    // colliders: [ax,ay,az, bx,by,bz, r] per capsule
    const pad = this.sp.legPad ?? 0, rT = (this.sp.legR?.thigh ?? 0.1) + pad, rS = (this.sp.legR?.shin ?? 0.085) + pad;
    const B = n => this.bone(n);
    const caps = [];
    for (const [a, b, r] of [['upperleg01.L', 'lowerleg01.L', rT], ['lowerleg01.L', 'foot.L', rS], ['upperleg01.R', 'lowerleg01.R', rT],
      ['lowerleg01.R', 'foot.R', rS], ['upperarm01.L', 'lowerarm01.L', C.ARM_R], ['upperarm01.R', 'lowerarm01.R', C.ARM_R]]){
      const A = B(a), Bp = B(b); if (A && Bp) caps.push(A.x, A.y, A.z, Bp.x, Bp.y, Bp.z, r);
    }
    const NC = caps.length / 7;
    // tether + profile frames: rest -> now (T), now -> rest (Ti)
    _M.multiplyMatrices(PW, this.restInv); _Mi.copy(_M).invert();
    const T = _M.elements, Ti = _Mi.elements, rest = this.restPos, swing = this.sp.swing ?? 0.13, P = this.sp.profile;
    const LM = this.legs.map((b, k) => b ? new THREE.Matrix4().multiplyMatrices(b.matrixWorld, this.legRestInv[k]).elements : T);
    const wL = this.wL, wR = this.wR, shinW = this.shinW;
    const blend = (A, Bm, t, out) => { for (let k = 0; k < 16; k++) out[k] = A[k] * (1 - t) + Bm[k] * t; return out; };
    const bufL = this._bL || (this._bL = new Float64Array(16)), bufR = this._bR || (this._bR = new Float64Array(16));
    // each vertex's guided target, once a step
    const tgt = this.tgt || (this.tgt = new Float32Array(n * 3));
    for (let i = 0; i < n; i++){
      if (i % Nu === 0){ const t = shinW[i / Nu]; blend(LM[0], LM[2], t, bufL); blend(LM[1], LM[3], t, bufR); }
      const LL = bufL, LR = bufR;
      const j = i * 3, rx = rest[j], ry = rest[j+1], rz = rest[j+2], a = wL[i], b = wR[i], h = 1 - a - b;
      for (let c = 0; c < 3; c++)
        tgt[j+c] = h * (T[c]*rx + T[4+c]*ry + T[8+c]*rz + T[12+c]) + a * (LL[c]*rx + LL[4+c]*ry + LL[8+c]*rz + LL[12+c]) + b * (LR[c]*rx + LR[4+c]*ry + LR[8+c]*rz + LR[12+c]);
    }
    const stretch = C.STRETCH, bend = C.BEND, floor = this.floor;
    for (let it = 0; it < C.ITERS; it++){
      for (let q = 0; q < M; q++){
        const k = ck[q] ? bend : stretch; if (k <= 0) continue;
        const a = ca[q] * 3, b = cb[q] * 3;
        const dx = pos[b]-pos[a], dy = pos[b+1]-pos[a+1], dz = pos[b+2]-pos[a+2];
        const d = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1e-6, diff = (d - cr[q]) / d * k;
        const pa = pinned[ca[q]], pb = pinned[cb[q]], wa = pa ? 0 : (pb ? 1 : 0.5), wb = pb ? 0 : (pa ? 1 : 0.5);
        pos[a] += dx*diff*wa; pos[a+1] += dy*diff*wa; pos[a+2] += dz*diff*wa;
        pos[b] -= dx*diff*wb; pos[b+1] -= dy*diff*wb; pos[b+2] -= dz*diff*wb;
      }
      for (let i = 0; i < n; i++){
        if (pinned[i]) continue;
        const j = i * 3;
        // tether: within reach of where it hangs at rest (before the colliders, so a leg wins)
        const tx = tgt[j], ty = tgt[j+1], tz = tgt[j+2];
        let ex = pos[j] - tx, ey = pos[j+1] - ty, ez = pos[j+2] - tz;
        const maxD = 0.02 + swing * Math.floor(i / Nu) / (Nv - 1), dd = Math.sqrt(ex*ex + ey*ey + ez*ez);
        if (dd > maxD){ const s = maxD / dd; pos[j] = tx + ex * s; pos[j+1] = ty + ey * s; pos[j+2] = tz + ez * s; }
        // capsules
        for (let c = 0; c < NC; c++){
          const o = c * 7, ax = caps[o], ay = caps[o+1], az = caps[o+2], bx = caps[o+3] - ax, by = caps[o+4] - ay, bz = caps[o+5] - az, r = caps[o+6];
          const px = pos[j] - ax, py = pos[j+1] - ay, pz = pos[j+2] - az;
          let t = (px*bx + py*by + pz*bz) / ((bx*bx + by*by + bz*bz) || 1e-6); t = t < 0 ? 0 : t > 1 ? 1 : t;
          const nx = px - bx*t, ny = py - by*t, nz = pz - bz*t, d = Math.sqrt(nx*nx + ny*ny + nz*nz);
          if (d < r && d > 1e-6){ const s = (r - d) / d; pos[j] += nx*s; pos[j+1] += ny*s; pos[j+2] += nz*s; }
        }
        // the body's profile, in the hips' rest frame, down to the crotch
        const X = pos[j], Y = pos[j+1], Z = pos[j+2];
        const lx = Ti[0]*X + Ti[4]*Y + Ti[8]*Z + Ti[12], ly = Ti[1]*X + Ti[5]*Y + Ti[9]*Z + Ti[13], lz = Ti[2]*X + Ti[6]*Y + Ti[10]*Z + Ti[14];
        if (pos[j+1] < floor) pos[j+1] = floor;            // seated: the hem rests on the ground
        if (ly < P.crotchY) continue;
        const dx = lx - P.cx, dz = lz - P.cz, rad = Math.sqrt(dx*dx + dz*dz) || 1e-6, need = profAt(P, Math.atan2(dz, dx), ly) + 0.006;
        if (rad >= need) continue;
        const nx = P.cx + dx * need / rad, nz = P.cz + dz * need / rad;
        pos[j] = T[0]*nx + T[4]*ly + T[8]*nz + T[12]; pos[j+1] = T[1]*nx + T[5]*ly + T[9]*nz + T[13]; pos[j+2] = T[2]*nx + T[6]*ly + T[10]*nz + T[14];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    if (this.normals !== false) this.geo.computeVertexNormals();
  }
  snapshot(){ return this.pos.slice(); }
  show(snap){ this.geo.attributes.position.array.set(snap); this.geo.attributes.position.needsUpdate = true; this.geo.computeVertexNormals(); }
  dispose(){ this.mesh.removeFromParent(); this.geo.dispose(); }
}
