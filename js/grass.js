// Decorative ground grass — thin single-pixel blades that carpet the ground
// *near the viewer* and sway in the wind. Purely cosmetic: they are NOT agents,
// not foraged, not tracked. A fixed pool of LineSegments (one line = one blade)
// follows the camera by wrapping toroidally within a radius, so only the patch
// underfoot is ever drawn. Blades take the colour of the grass terrain, grow
// only on actual grass (not on trodden paths), and fade out at the radius edge,
// so there's no hard pop as you walk.
//
// The sway and the edge fade run in the vertex shader. The blade buffers are
// rewritten only when a blade wraps to the far side or the trail under it wears;
// recomputing all 60k blades on the CPU and re-uploading ~5 MB every frame you
// walked was what made walking-while-looking-around stutter.
//
// It rides the world's low internal resolution (PIXEL in main.js): a 1px line
// in the render buffer upscales to a chunky pixel blade, matching the look.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, terrainType, biome } from './terrain.js';
import { makeGrassTexture } from './textures.js';

// Regional grass length: a smooth, low-frequency field over the world so some
// stretches are kept-short lawn and others are overgrown tall grass, with broad
// zones broken up by smaller patches. Biased toward the short end (t^1.5) so
// lawn is common and tall meadow rarer. Returns a base blade height in world
// units, before per-blade variance.
const GRASS_SHORT = 0.14;   // fresh, cropped lawn
const GRASS_TALL  = 1.10;   // overgrown meadow
function grassLength(x, z){
  let v = Math.sin(x * 0.025 + 2.0) * Math.cos(z * 0.022 - 1.0)        // broad regions (~250u)
        + 0.6 * Math.sin(x * 0.07 - 1.3) * Math.cos(z * 0.063 + 0.4);  // smaller patches (~90u)
  const t = Math.max(0, Math.min(1, 0.5 + 0.5 * (v / 1.6)));           // 0..1
  return GRASS_SHORT + (GRASS_TALL - GRASS_SHORT) * Math.pow(t, 1.5);
}

// Half-width of a blade quad in world units. At PIXEL=3 upscale, ~0.05 reads as
// 2–3 pixels wide up close, thinning naturally with distance.
const BLADE_HALF_W = 0.05;
// Blades that wrap to the far edge land where the fade has them invisible, so
// their upload can wait: flush at most every FLUSH_EVERY frames while walking.
const FLUSH_EVERY = 4;
// Trail wear (paths thinning the grass) changes slowly; refresh 1/TRAIL_FRAMES of
// the blades each frame, as one contiguous upload.
const TRAIL_FRAMES = 30;

export class GrassDetail {
  constructor(scene, { count = 14000, radius = 12, trail = null, fade = 'alpha' } = {}){
    this.R = radius;
    this.n = count;
    this.trail = trail;
    this.fadeMode = fade;
    this._lcx = Infinity; this._lcz = Infinity;
    this._frame = 0; this._lastFlush = 0; this._dirty = false; this._ti = 0;
    // per-blade state
    this.bx = new Float32Array(count);
    this.bz = new Float32Array(count);
    this.by = new Float32Array(count);
    this.bh = new Float32Array(count);
    this.hj = new Float32Array(count);
    this.lx = new Float32Array(count);
    this.lz = new Float32Array(count);
    this.ph = new Float32Array(count);
    this.br = new Float32Array(count);
    this.on = new Uint8Array(count);
    // perpendicular half-offset for quad width (computed once in _sample)
    this.pw = new Float32Array(count * 2);   // [px, pz] per blade

    // 3 verts per blade (base-left, base-right, tip) — one triangle
    this.pos = new Float32Array(count * 3 * 3);
    this.col = new Float32Array(count * 3 * 4);
    // per vertex (phase, sway height): the tip carries the blade height, the base 0
    this.sway = new Float32Array(count * 3 * 2);

    // static index buffer: 1 triangle per blade
    const idx = new Uint32Array(count * 3);
    for (let i = 0; i < count; i++){
      const base = i * 3;
      idx[base] = base; idx[base+1] = base+1; idx[base+2] = base+2;
    }

    for (let i = 0; i < count; i++){
      this.bx[i] = (Math.random() * 2 - 1) * radius;
      this.bz[i] = (Math.random() * 2 - 1) * radius;
      this.hj[i] = 0.5 + Math.random() * 0.95;
      const lean = 0.02 + Math.random() * 0.05, a = Math.random() * Math.PI * 2;
      this.lx[i] = Math.cos(a) * lean; this.lz[i] = Math.sin(a) * lean;
      this.ph[i] = Math.random() * Math.PI * 2;
      this.br[i] = 0.9 + Math.random() * 0.2;
      this._sample(i);
    }

    const geo = new THREE.BufferGeometry();
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('aSway',    new THREE.BufferAttribute(this.sway, 2));
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide });
    this._u = {
      uTime: { value: 0 }, uGust: { value: 1 }, uWind: { value: new THREE.Vector2(1, 0) },
      uCam: { value: new THREE.Vector2() }, uR: { value: radius },
      uFadeIn: { value: 1 / (radius * 0.35) }, uFadeOn: { value: fade ? 1 : 0 },
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this._u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aSway;
          uniform float uTime, uGust, uR, uFadeIn, uFadeOn;
          uniform vec2 uWind, uCam;
          varying float vFade;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // bend = (steady gust + flutter) * blade height * tip-exaggeration; only the tip moves
          float bend = (uGust * 0.03 + sin(uTime * 1.9 + aSway.x) * 0.013) * aSway.y * 4.0;
          transformed.xz += uWind * bend;
          float df = clamp((uR - distance(transformed.xz, uCam)) * uFadeIn, 0.0, 1.0);
          vFade = mix(1.0, df, uFadeOn);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vFade;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.a *= vFade;`);
    };
    mat.customProgramCacheKey = () => 'grass-detail-sway';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  _sample(i){
    const x = this.bx[i], z = this.bz[i];
    this.by[i] = height(x, z) + 0.02;
    this.bh[i] = grassLength(x, z) * this.hj[i];
    const grass = terrainType(x, z) === 'grass';
    this.on[i] = grass ? 1 : 0;
    // perpendicular to the lean direction (in XZ) for the quad width
    const lx = this.lx[i], lz = this.lz[i];
    const len = Math.hypot(lx, lz) || 1;
    this.pw[i*2]   = (-lz / len) * BLADE_HALF_W;
    this.pw[i*2+1] = ( lx / len) * BLADE_HALF_W;
    const c = biome(x, z), br = this.br[i] / 2, o = i * 12;
    const bR = c[0]*0.56*br, bG = c[1]*0.56*br, bB = c[2]*0.56*br;
    const tR = c[0]*0.76*br, tG = c[1]*0.76*br, tB = c[2]*0.76*br;
    // base-left, base-right (dark); tip (light, single point)
    this.col[o]   = bR; this.col[o+1] = bG; this.col[o+2] = bB;
    this.col[o+4] = bR; this.col[o+5] = bG; this.col[o+6] = bB;
    this.col[o+8] = tR; this.col[o+9] = tG; this.col[o+10] = tB;
    this._alpha(i);
    // static triangle — base-left, base-right, tip; the shader sways the tip
    const by = this.by[i], h = this.bh[i], px = this.pw[i*2], pz = this.pw[i*2+1];
    const pos = this.pos, o9 = i * 9;
    pos[o9]   = x - px;           pos[o9+1] = by;     pos[o9+2] = z - pz;
    pos[o9+3] = x + px;           pos[o9+4] = by;     pos[o9+5] = z + pz;
    pos[o9+6] = x + this.lx[i];   pos[o9+7] = by + h; pos[o9+8] = z + this.lz[i];
    const sw = this.sway, o6 = i * 6, ph = this.ph[i];
    sw[o6] = ph; sw[o6+1] = 0; sw[o6+2] = ph; sw[o6+3] = 0; sw[o6+4] = ph; sw[o6+5] = h;
  }

  // vertex alpha = grows here × not worn away by a trail (the edge fade is the shader's)
  _alpha(i){
    let a = this.on[i] ? 1 : 0;
    if (a && this.trail){
      const w = this.trail.wearAt(this.bx[i], this.bz[i]);
      if (w > 0.05){ const tf = 1 - (w - 0.05) / 0.18; a *= tf < 0 ? 0 : tf; }
    }
    const o12 = i * 12;
    this.col[o12+3] = this.col[o12+7] = this.col[o12+11] = a;
  }

  update(camX, camZ, t, tint){
    if (tint) this.mesh.material.color.copy(tint);
    const u = this._u, wAng = t * 0.13;
    if (this.swayOn !== false){                     // the settings panel can freeze the wind
      u.uTime.value = t; u.uGust.value = 0.6 + 0.4 * Math.sin(t * 0.7);
      u.uWind.value.set(Math.cos(wAng), Math.sin(wAng));
    }
    u.uCam.value.set(camX, camZ);

    // wrap blades that fell behind to the far side of the patch (toroidally)
    if (camX !== this._lcx || camZ !== this._lcz){
      this._lcx = camX; this._lcz = camZ;
      const R = this.R, R2 = R * 2;
      for (let i = 0; i < this.n; i++){
        let x = this.bx[i], z = this.bz[i], moved = false;
        if (x - camX >  R){ x -= R2; moved = true; } else if (x - camX < -R){ x += R2; moved = true; }
        if (z - camZ >  R){ z -= R2; moved = true; } else if (z - camZ < -R){ z += R2; moved = true; }
        if (moved){ this.bx[i] = x; this.bz[i] = z; this._sample(i); this._dirty = true; }
      }
    }

    const a = this.geo.attributes;
    this._frame++;
    if (this._dirty && this._frame - this._lastFlush >= FLUSH_EVERY){
      // wrapped blades are scattered through the buffers — send them whole
      this._dirty = false; this._lastFlush = this._frame;
      a.color.clearUpdateRanges();
      a.position.needsUpdate = a.color.needsUpdate = a.aSway.needsUpdate = true;
      return;
    }
    // otherwise refresh the trail wear on one slice, uploading just that slice
    if (!this.trail) return;
    const len = Math.ceil(this.n / TRAIL_FRAMES);
    for (let k = 0; k < len; k++){
      const i = this._ti; this._alpha(i);
      if (k === 0) this._sliceStart = i;
      this._ti = (i + 1) % this.n;
      if (this._ti === 0 || k === len - 1){        // close a contiguous range at wrap or end
        a.color.addUpdateRange(this._sliceStart * 12, (i - this._sliceStart + 1) * 12);
        this._sliceStart = this._ti;
      }
    }
    a.color.needsUpdate = true;
  }
}

// crossed-quad ("X" from above) card, base at y=0, unit-sized — scaled per clump
function clumpCard(){
  const a = new THREE.PlaneGeometry(1, 1); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  return mergeGeometries([a, b], false);
}

// Far-field grass: STATIC pre-rendered clump cards instead of individual blades,
// for cheap grass cover deep into the distance. An InstancedMesh of textured
// crossed quads that follows the camera (toroidal wrap), grows only on grass (not
// trodden), and scale-fades in where the blade field thins out and back out at a
// far draw distance. Lit by the scene lights via a Lambert material, so the
// clumps match the terrain. Instances are rebuilt only when the viewer moves —
// when you stand still it costs nothing.
export class GrassClumps {
  constructor(scene, { count = 8000, innerR = 16, outerR = 90, trail = null } = {}){
    this.n = count; this.inR = innerR; this.outR = outerR; this.trail = trail;
    this._lcx = Infinity; this._lcz = Infinity;
    this.bx = new Float32Array(count);   // base world x
    this.bz = new Float32Array(count);   // base world z
    this.by = new Float32Array(count);   // ground height
    this.cw = new Float32Array(count);   // clump card width
    this.ch = new Float32Array(count);   // clump card height
    this.yaw = new Float32Array(count);  // fixed facing
    this.hj = new Float32Array(count);   // per-clump size jitter
    this.on = new Uint8Array(count);     // 1 if its spot is grass

    for (let i = 0; i < count; i++){
      this.bx[i] = (Math.random() * 2 - 1) * outerR;
      this.bz[i] = (Math.random() * 2 - 1) * outerR;
      this.hj[i] = 0.7 + Math.random() * 0.7;
      this.yaw[i] = Math.random() * Math.PI;     // crossed quads → a half-turn covers every look
      this._sample(i);
    }

    const mat = new THREE.MeshLambertMaterial({
      map: makeGrassTexture({ blades: 11 }), alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(clumpCard(), mat, count);
    this.mesh.frustumCulled = false;                  // instances roam around the camera
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  _sample(i){
    const x = this.bx[i], z = this.bz[i];
    this.by[i] = height(x, z);
    this.on[i] = terrainType(x, z) === 'grass' ? 1 : 0;
    const h = grassLength(x, z) * 2.2 * this.hj[i];   // same regional length field as the blades, taller as a tuft
    this.ch[i] = h; this.cw[i] = h * 0.65;
  }

  // Call each frame with the viewer position. Rebuilds instances only on movement.
  update(camX, camZ){
    if (camX === this._lcx && camZ === this._lcz) return;   // static while the viewer is still
    this._lcx = camX; this._lcz = camZ;
    const R = this.outR, R2 = R * 2, inR = this.inR, trail = this.trail;
    const outBand = 22, inBand = 10;
    const m = this._m, q = this._q, p = this._p, s = this._s;
    for (let i = 0; i < this.n; i++){
      let x = this.bx[i], z = this.bz[i], moved = false;
      if (x - camX >  R){ x -= R2; moved = true; } else if (x - camX < -R){ x += R2; moved = true; }
      if (z - camZ >  R){ z -= R2; moved = true; } else if (z - camZ < -R){ z += R2; moved = true; }
      if (moved){ this.bx[i] = x; this.bz[i] = z; this._sample(i); }

      let f = 0;
      if (this.on[i]){
        const d = Math.hypot(x - camX, z - camZ);
        let fo = (R - d) / outBand; fo = fo < 0 ? 0 : fo > 1 ? 1 : fo;   // fade out at the far edge
        let fi = (d - inR) / inBand; fi = fi < 0 ? 0 : fi > 1 ? 1 : fi;  // fade in past the blade zone
        f = fo < fi ? fo : fi;
        if (f > 0 && trail){ const w = trail.wearAt(x, z); if (w > 0.05){ const tf = 1 - (w - 0.05) / 0.18; f *= tf < 0 ? 0 : tf; } }
      }
      if (f <= 0){ this.mesh.setMatrixAt(i, this._zero); continue; }
      q.setFromAxisAngle(this._up, this.yaw[i]);
      p.set(x, this.by[i], z);
      s.set(this.cw[i] * f, this.ch[i] * f, this.cw[i] * f);   // scale-fade (also hides at the edges)
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
