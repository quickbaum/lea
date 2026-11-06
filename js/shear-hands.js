// Shearing, in your hands (docs/sheep.md): the view comes down beside the sheep and the cursor comes free. Drag along the wool
// and it comes off; drag beside the sheep, or A and D, and you walk round it. Mouse and touch alike. The game and
// tools/probes/shear.html both use this, so what the probe shows is what the game does.
import * as THREE from 'three';
import { UNITS_PER_M } from './config.js';
import { Shearing } from './shear.js';

const DIST_M = 2.6, RISE = 0.5, EASE = 4, GATHER = 0.7, TURN = 0.008, KEY_TURN = 1.6;

export class ShearHands {
  // canvas, camera, view: js/sheep-view.js. onEnd({ share, fleece, sheep }) when it's over. snip(): a sound, if there is one
  constructor({ canvas, camera, view, ground = () => 0, onEnd = () => {}, snip = null }){
    Object.assign(this, { canvas, camera, view, ground, onEnd, snip });
    this.job = null; this.gather = -1;
    this._v = new THREE.Vector3();
    this._project = (x, y, z) => {
      const r = this.canvas.getBoundingClientRect();
      this._v.set(x, y, z).project(this.camera);
      return { x: r.left + (this._v.x + 1) / 2 * r.width, y: r.top + (1 - this._v.y) / 2 * r.height };
    };
    this._ctx = () => ({ project: this._project, cam: this.camera.position, now: this.view.shared.uTime.value });
    this.hint = Object.assign(document.createElement('div'), { textContent: 'Drag along the wool to shear. Drag beside the sheep, or use the arrow keys, to walk round it. E to let go.' });
    this.hint.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);max-width:92vw;text-align:center;font:14px Georgia,serif;color:#f4ecd8;text-shadow:0 1px 3px #000;pointer-events:none;display:none;z-index:30';
    this.ring = document.createElement('div');
    this.ring.style.cssText = 'position:fixed;border:1px solid #f4ecd8cc;border-radius:50%;pointer-events:none;display:none;z-index:30;box-shadow:0 0 1px #000';
    document.body.append(this.hint, this.ring);
    // (capture, on the window: the phone's look-and-walk controls also listen on the canvas, and this has to come first)
    addEventListener('pointerdown', e => this._down(e), true);
    addEventListener('pointermove', e => this._move(e), true);
    addEventListener('pointerup', e => this._up(e), true);
    addEventListener('pointercancel', e => this._up(e), true);
  }
  get on(){ return !!this.job; }
  get sheep(){ return this.job?.shearing.s ?? null; }

  begin(s, from = null){
    if (this.job) return;
    const y = this.ground(s.x, s.z);
    const shearing = new Shearing(s, y, this.view.cutData);
    const k = (s.scale ?? 1) * UNITS_PER_M;
    // from where you stand, if you stand somewhere, swinging you round to its side: a flank is the most wool
    let a = from ? Math.atan2(from.x - s.x, from.z - s.z) : (s.heading ?? 0) + Math.PI / 2;
    const c = this.camera.position;
    this.job = { shearing, a, r: DIST_M * k, h: RISE * k, look: { x: s.x, y: y + 0.5 * k, z: s.z }, drag: null, at: from ? { x: c.x, y: c.y, z: c.z } : null };
    s.held = true; s.mode = 'rest'; s.speed = 0; s.walk = 0;
    this.gather = -1;
    this.view.setGather(0); this.view.markCut();
    this.hint.style.display = '';
  }
  // E or Esc, or it's all off
  letGo(){
    if (!this.job || this.gather >= 0) return;
    this.gather = 0;
    this.hint.style.display = 'none'; this.ring.style.display = 'none';
  }
  _finish(){
    const { shearing, at } = this.job, out = shearing.release(), s = shearing.s;
    s.held = false; s.mode = 'run'; s.runT = 2; s.tx = s.x; s.tz = s.z;
    this.job = null; this.gather = -1;
    this.view.setGather(0); this.view.cutData.fill(0); this.view.markCut();
    this.onEnd({ ...out, sheep: s, at });
  }
  _isCanvas(e){ return e.target === this.canvas; }
  _down(e){
    if (!this.job || this.gather >= 0 || !this._isCanvas(e)) return;
    e.stopPropagation();
    this.job.drag = { x: e.clientX, y: e.clientY, cutting: this.job.shearing.woolAt(e.clientX, e.clientY, this._ctx()) };
    this.snipGap = 0;
  }
  _move(e){
    if (!this.job) return;
    const j = this.job;
    this._ringAt(e.clientX, e.clientY, e.pointerType);
    const d = j.drag;
    if (!d || this.gather >= 0) return;
    if (d.cutting){
      const got = j.shearing.stroke(d.x, d.y, e.clientX, e.clientY, this._ctx());
      if (got){ this.view.markCut(); this.snipGap -= got; if (this.snipGap <= 0){ this.snip?.(); this.snipGap = 3; } }
      if (j.shearing.done) this.letGo();
    } else j.a -= (e.clientX - d.x) * TURN;
    d.x = e.clientX; d.y = e.clientY;
  }
  _up(e){ if (this.job) this.job.drag = null; }
  _ringAt(x, y, type){
    const size = this.job.shearing.brushPx(this._project) * 2;
    Object.assign(this.ring.style, { display: type === 'touch' || this.gather >= 0 ? 'none' : '', left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  }
  // once a frame. keyTurn: -1, 0 or 1, for A and D. Puts the camera beside the sheep; returns { yaw, pitch } for a view that
  // turns by them, since the game sets its camera's rotation itself
  frame(dt, keyTurn = 0){
    const j = this.job;
    if (!j) return null;
    const s = j.shearing.s;
    // it stands quiet and lifts its head: stood still, it's where the cuts are measured from
    s.graze = Math.max(0, (s.graze ?? 0) - dt * 3); s.lie = Math.max(0, (s.lie ?? 0) - dt * 3);
    j.a += keyTurn * KEY_TURN * dt;
    const L = j.look, x = L.x + Math.sin(j.a) * j.r, z = L.z + Math.cos(j.a) * j.r, y = Math.max(L.y + j.h, this.ground(x, z) + 0.6 * UNITS_PER_M);
    // (the game puts the camera at your eye every frame, so where the view has got to is kept here)
    if (!j.at) j.at = { x, y, z };
    const e = Math.min(1, dt * EASE), c = j.at;
    c.x += (x - c.x) * e; c.y += (y - c.y) * e; c.z += (z - c.z) * e;
    this.camera.position.set(c.x, c.y, c.z);
    if (this.gather >= 0){
      this.gather += dt / GATHER;
      this.view.setGather(Math.min(1, this.gather));
      if (this.gather >= 1) this._finish();
    }
    const dx = L.x - c.x, dy = L.y - c.y, dz = L.z - c.z;   // (read before _finish could end it: c is still this job's)
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
  }
}
