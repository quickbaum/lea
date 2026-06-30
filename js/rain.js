// Lightweight rain system: falling line-segment streaks that toroidally wrap
// around the camera, plus an auto-weather cycle that occasionally pushes
// sky.cloudCover up (triggering rain) and lets it drain back.
//
// A single LineSegments draw call — 2 verts per drop, no textures. Fully
// camera-relative so position updates are just addition/modulo. Fog near/far
// are pulled in during rain so the world hazens out naturally.

import * as THREE from 'three';

const FALL_SPEED  = 16;     // world units per second downward
const DROP_LEN    = 1.1;    // streak length in world units
const RADIUS      = 22;     // horizontal half-width of the rain patch around camera
const V_TOP       =  15;    // highest drop, relative to camera Y
const V_BOT       =  -4;    // lowest  drop, relative to camera Y (below eye = still falling)
const V_SPAN      = V_TOP - V_BOT;

const CYCLE_INTERVAL = [80, 240];    // seconds between rain events
const CYCLE_DURATION = [30,  80];    // how long each rain event lasts

// Rain target cloud cover and the fill/drain speeds (cover per second)
const RAIN_COVER  = [0.92, 1.0];   // full overcast during rain
const FILL_RATE   = 0.06;          // clouds roll in faster than they clear
const DRAIN_RATE  = 0.018;

const DROP_COLOR  = new THREE.Color(0.55, 0.65, 0.82);
const R2 = RADIUS * 2;

export class Rain {
  constructor(scene, { count = 1400 } = {}) {
    this.scene   = scene;
    this.n       = count;
    this.intensity = 0;       // public: current smoothed 0..1 intensity
    this._sky    = null;

    // camera-relative offsets: rx, rz in [-RADIUS, RADIUS]; ry in [V_BOT, V_TOP]
    this._rx = new Float32Array(count);
    this._ry = new Float32Array(count);
    this._rz = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      this._rx[i] = (Math.random() * 2 - 1) * RADIUS;
      this._ry[i] = V_BOT + Math.random() * V_SPAN;
      this._rz[i] = (Math.random() * 2 - 1) * RADIUS;
    }

    // 2 verts per drop × 3 floats: [head, tail, head, tail, ...]
    const pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._pos = pos;
    this._geo = geo;

    this._mat = new THREE.LineBasicMaterial({
      color: DROP_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });

    this._mesh = new THREE.LineSegments(geo, this._mat);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    scene.add(this._mesh);

    // fog references — save base values once, restore when dry
    const fog = scene.fog;
    this._fog     = fog ?? null;
    this._fogN0   = fog?.near ?? 35;
    this._fogF0   = fog?.far  ?? 170;
    this._fogC0   = fog ? fog.color.clone() : new THREE.Color(0x9fc6e8);

    // auto-cycle state
    this._nextRain  = CYCLE_INTERVAL[0] + Math.random() * (CYCLE_INTERVAL[1] - CYCLE_INTERVAL[0]);
    this._rainLeft  = 0;
    this._rainCover = 0;     // target cover during this rain event
    this._prevCover = 0.55;  // cloud cover to restore afterwards
    this._smoothI   = 0;
  }

  setSky(sky) { this._sky = sky; }

  update(camX, camY, camZ, dt, cloudCover, wind) {
    // ── auto rain cycle ──
    if (this._sky) {
      if (this._rainLeft > 0) {
        this._rainLeft -= dt;
        // fill cloud cover toward rain target while event is active
        const cur = this._sky.cloudCover;
        if (Math.abs(this._rainCover - cur) > 0.005)
          this._sky.setCloudCover(cur + Math.sign(this._rainCover - cur) * FILL_RATE * Math.min(dt, 0.1));
      } else {
        // drain cloud cover back to baseline first; only then count down to next event
        const cur = this._sky.cloudCover;
        if (cur > this._prevCover + 0.005) {
          this._sky.setCloudCover(cur - DRAIN_RATE * Math.min(dt, 0.1));
        } else {
          this._nextRain -= dt;
          if (this._nextRain <= 0) {
            this._nextRain  = CYCLE_INTERVAL[0] + Math.random() * (CYCLE_INTERVAL[1] - CYCLE_INTERVAL[0]);
            this._rainLeft  = CYCLE_DURATION[0] + Math.random() * (CYCLE_DURATION[1] - CYCLE_DURATION[0]);
            this._rainCover = RAIN_COVER[0] + Math.random() * (RAIN_COVER[1] - RAIN_COVER[0]);
            this._prevCover = cloudCover;
          }
        }
      }
    }

    // ── intensity from cloud cover ──
    // Rain only starts at heavy overcast (>0.70); default cover of 0.55 stays dry.
    const targetI = Math.max(0, Math.min(1, (cloudCover - 0.70) / 0.30));
    const lerpRate = targetI > this._smoothI ? 1.2 : 0.5;
    this._smoothI += (targetI - this._smoothI) * lerpRate * Math.min(dt, 0.1);
    const I = this.intensity = this._smoothI;

    const visible = I > 0.015;
    this._mesh.visible = visible;
    // scale drop opacity by ambient light — drops near the camera aren't fogged,
    // so without this they glow bright white against a dark night sky
    const skyDay  = this._sky ? this._sky.day : 1;
    const moonI   = this._sky ? this._sky.moonLight.intensity : 0;
    const ambient = Math.min(1, skyDay + moonI * 3);
    this._mat.opacity = (0.18 + I * 0.45) * (0.08 + 0.92 * ambient);

    // fog: tighten and darken when raining.
    // sky.update() already set fog.color correctly for current time-of-day;
    // we nudge it slightly toward storm grey rather than replacing it wholesale,
    // so the rain haze stays dark at night instead of glowing light-grey.
    if (this._fog) {
      const fi = visible ? I : 0;
      this._fog.near = this._fogN0 - fi * 14;
      this._fog.far  = this._fogF0 - fi * 70;
      // darken relative to whatever the sky computed — no fixed target, so this
      // works correctly at any time of day without brightening the fog.
      if (fi > 0) this._fog.color.multiplyScalar(1 - fi * 0.45);
    }

    if (!visible) return;

    // ── move drops ──
    const wx = wind ? wind.x * 0.28 : 0;   // horizontal drift from wind
    const wz = wind ? wind.y * 0.28 : 0;   // (wind.y = z-axis in sky.wind's Vector2)
    const moveY = FALL_SPEED * dt;
    const moveX = wx * dt;
    const moveZ = wz * dt;

    // streak tail direction (head is at ry, tail is one DROP_LEN lower + slanted)
    // precompute once per frame
    const tailDX = -wx * 0.07;
    const tailDY = -DROP_LEN;
    const tailDZ = -wz * 0.07;

    const pos = this._pos;

    for (let i = 0; i < this.n; i++) {
      // advance
      let rx = this._rx[i] + moveX;
      let ry = this._ry[i] - moveY;
      let rz = this._rz[i] + moveZ;

      // toroidal XZ wrap
      if (rx >  RADIUS) rx -= R2; else if (rx < -RADIUS) rx += R2;
      if (rz >  RADIUS) rz -= R2; else if (rz < -RADIUS) rz += R2;
      // Y: reset to top when drop passes the bottom
      if (ry < V_BOT) ry += V_SPAN;

      this._rx[i] = rx; this._ry[i] = ry; this._rz[i] = rz;

      const wx_ = camX + rx, wy_ = camY + ry, wz_ = camZ + rz;
      const o = i * 6;
      pos[o  ] = wx_;          pos[o+1] = wy_;          pos[o+2] = wz_;
      pos[o+3] = wx_ + tailDX; pos[o+4] = wy_ + tailDY; pos[o+5] = wz_ + tailDZ;
    }

    this._geo.attributes.position.needsUpdate = true;
  }

  // For Claude's weather actions: trigger/clear rain manually
  startRain() {
    if (!this._sky) return;
    this._rainLeft  = CYCLE_DURATION[0] + Math.random() * (CYCLE_DURATION[1] - CYCLE_DURATION[0]);
    this._rainCover = RAIN_COVER[0] + Math.random() * (RAIN_COVER[1] - RAIN_COVER[0]);
    this._prevCover = this._sky.cloudCover;
  }
  stopRain() {
    this._rainLeft = 0;   // jump straight to drain phase
  }
}
