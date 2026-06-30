import * as THREE from 'three';
import { WORLD_R } from './config.js';
import { height, walkable, randomLand } from './terrain.js';
import { makeLabel } from './label.js';

// Puck — a magical hopping creature. No walk animation: he *hops*, bobbing up
// and down. The sprite is drawn facing left, so we mirror it when he travels
// right; when he hops away from the player we show his back (puck_back.png).
// Pucks are skittish — they keep their distance and sometimes bolt.
//
// Pucks travel in *bands*. A whole band winks into the world together, roams as
// a group, then the whole band fades away together. Bands come and go on their
// own staggered timers, so the world is never empty and never all at once full.
// One persistent, named Puck (the leader) is always present so he can be talked
// to; the bands are ephemeral.
//
// Ancient Pucks are a rare variant: slightly larger, they glide instead of hop,
// and materialise alone or in company of a few regular pucks.

const FRONT = 'sprites/puck.png';
const BACK  = 'sprites/puck_back.png';
const ANCIENT_SPRITES = [
  'sprites/ancient_puck_red.png',
  'sprites/ancient_puck_blue.png',
  'sprites/ancient_puck_green.png',
];

function loadTex(loader, src){
  return new Promise((res) => loader.load(src, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    res(t);
  }));
}

// ------------------------------------------------------------------ Puck (regular)

class Puck {
  constructor(scene, texF, texB, { x, z, h, opacity = 1, label = null }){
    this.scene = scene; this.texF = texF; this.texB = texB;
    this.x = x; this.z = z; this.h = h; this.label = label;
    const aspect = (texF.image.width || 1) / (texF.image.height || 1);
    this.w = h * aspect;
    this.mat = new THREE.MeshBasicMaterial({
      map: texF, alphaTest: 0.5, transparent: true, fog: true,
      opacity, depthWrite: opacity >= 1,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, h), this.mat);
    scene.add(this.mesh);

    this.tx = x; this.tz = z;                 // current move target
    this.heading = Math.random() * Math.PI * 2;
    this.hop = Math.random() * Math.PI * 2;   // hop cycle phase
    this.hopSpeed = 7 + Math.random() * 2;    // radians/sec
    this.retarget = 0;                        // countdown to pick a new spot
    this.spooked = 0;                         // time left fleeing the player
    this._back = false;
  }

  dispose(){ this.scene.remove(this.mesh); this.mat.dispose(); }

  pickTarget(cx, cz, spread){
    for (let i = 0; i < 6; i++){
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const nx = cx + Math.cos(a) * r, nz = cz + Math.sin(a) * r;
      if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){ this.tx = nx; this.tz = nz; return; }
    }
  }

  update(cam, dt, player, cx, cz, spread, tint){
    if (tint) this.mat.color.copy(tint);
    let moving = false;
    if (!this.talking){
      const dPlayer = Math.hypot(this.x - player.x, this.z - player.z);
      if (dPlayer < 7) this.spooked = 0.8 + Math.random() * 0.7;
      if (this.spooked > 0){
        this.spooked -= dt;
        const a = Math.atan2(this.z - player.z, this.x - player.x) + (Math.random() - 0.5) * 0.6;
        this.tx = this.x + Math.cos(a) * 6; this.tz = this.z + Math.sin(a) * 6;
      } else {
        this.retarget -= dt;
        if (this.retarget <= 0){ this.pickTarget(cx, cz, spread); this.retarget = 1.5 + Math.random() * 3; }
      }

      this.hop += this.hopSpeed * dt;
      const air = Math.sin(this.hop);
      const dx = this.tx - this.x, dz = this.tz - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.4 && air > 0){
        const spd = (this.spooked > 0 ? 5.5 : 3.0) * dt;
        const step = Math.min(spd, dist);
        const nx = this.x + dx / dist * step, nz = this.z + dz / dist * step;
        if (walkable(nx, nz)){ this.heading = Math.atan2(dx, dz); this.x = nx; this.z = nz; moving = true; }
        else this.retarget = 0;
      }
    }

    const yOff = Math.max(0, Math.sin(this.hop)) * (0.45 * this.h * 0.6);
    const gy = height(this.x, this.z) + this.h / 2;
    this.mesh.position.set(this.x, gy + yOff, this.z);
    if (this.label) this.label.position.set(this.x, gy + this.h / 2 + 0.5, this.z);

    this.mesh.rotation.y = Math.atan2(cam.position.x - this.x, cam.position.z - this.z);

    const vx = Math.sin(this.heading), vz = Math.cos(this.heading);
    const awayDot = vx * (player.x - this.x) + vz * (player.z - this.z);
    const back = moving && awayDot < -0.05;
    if (back !== this._back){ this.mat.map = back ? this.texB : this.texF; this.mat.needsUpdate = true; this._back = back; }

    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const goingRight = (vx * right.x + vz * right.z) > 0;
    this.mesh.scale.x = (moving && goingRight) ? -1 : 1;
  }
}

// ------------------------------------------------------------------ AncientPuck

class AncientPuck {
  constructor(scene, tex, { x, z, h = 1.7, opacity = 1 }){
    this.scene = scene; this.tex = tex;
    this.x = x; this.z = z; this.h = h;
    const aspect = (tex.image.width || 1) / (tex.image.height || 1);
    this.w = h * aspect;
    this.mat = new THREE.MeshBasicMaterial({
      map: tex, alphaTest: 0.5, transparent: true, fog: true,
      opacity, depthWrite: opacity >= 1,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.w, h), this.mat);
    scene.add(this.mesh);

    this.tx = x; this.tz = z;
    this.heading = Math.random() * Math.PI * 2;
    this.retarget = 0;
    this.spooked = 0;
    this._float = Math.random() * Math.PI * 2;  // gentle float phase
  }

  dispose(){ this.scene.remove(this.mesh); this.mat.dispose(); }

  pickTarget(cx, cz, spread){
    for (let i = 0; i < 6; i++){
      const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const nx = cx + Math.cos(a) * r, nz = cz + Math.sin(a) * r;
      if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){ this.tx = nx; this.tz = nz; return; }
    }
  }

  update(cam, dt, player, cx, cz, spread, tint){
    if (tint) this.mat.color.copy(tint);

    const dPlayer = Math.hypot(this.x - player.x, this.z - player.z);
    if (dPlayer < 8) this.spooked = 1.0 + Math.random() * 0.5;
    if (this.spooked > 0){
      this.spooked -= dt;
      const a = Math.atan2(this.z - player.z, this.x - player.x) + (Math.random() - 0.5) * 0.4;
      this.tx = this.x + Math.cos(a) * 8; this.tz = this.z + Math.sin(a) * 8;
    } else {
      this.retarget -= dt;
      if (this.retarget <= 0){ this.pickTarget(cx, cz, spread); this.retarget = 2 + Math.random() * 5; }
    }

    // smooth glide — no hop, continuous movement
    const dx = this.tx - this.x, dz = this.tz - this.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.3){
      const spd = (this.spooked > 0 ? 4.0 : 1.8) * dt;
      const step = Math.min(spd, dist);
      const nx = this.x + dx / dist * step, nz = this.z + dz / dist * step;
      if (walkable(nx, nz)){ this.heading = Math.atan2(dx, dz); this.x = nx; this.z = nz; }
      else this.retarget = 0;
    }

    this._float += dt * 1.1;
    const yOff = Math.sin(this._float) * this.h * 0.04;
    const gy = height(this.x, this.z) + this.h / 2;
    this.mesh.position.set(this.x, gy + yOff, this.z);
    this.mesh.rotation.y = Math.atan2(cam.position.x - this.x, cam.position.z - this.z);

    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const vx = Math.sin(this.heading), vz = Math.cos(this.heading);
    const goingRight = (vx * right.x + vz * right.z) > 0;
    this.mesh.scale.x = goingRight ? -1 : 1;
  }
}

// ------------------------------------------------------------------ Band (regular)

class Band {
  constructor(scene, texF, texB, cx, cz, n){
    this.cx = cx; this.cz = cz;
    this.spread = 4 + Math.random() * 3;
    this.members = [];
    for (let i = 0; i < n; i++){
      const a = Math.random() * Math.PI * 2, r = Math.random() * this.spread;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!walkable(x, z)) continue;
      this.members.push(new Puck(scene, texF, texB, { x, z, h: 0.85 + Math.random() * 0.4, opacity: 0 }));
    }
    this.phase = 'in'; this.opacity = 0;
    this.life = 14 + Math.random() * 22;
    this.roam = 0;
    this.dead = this.members.length === 0;
  }

  update(cam, dt, player, tint){
    if (this.phase === 'in'){
      this.opacity = Math.min(1, this.opacity + dt * 1.2);
      if (this.opacity >= 1) this.phase = 'live';
    } else if (this.phase === 'live'){
      this.life -= dt;
      if (this.life <= 0) this.phase = 'out';
    } else if (this.phase === 'out'){
      this.opacity = Math.max(0, this.opacity - dt * 0.9);
      if (this.opacity <= 0){ for (const p of this.members) p.dispose(); this.members.length = 0; this.dead = true; return; }
    }

    this.roam -= dt;
    if (this.roam <= 0){
      const [tx, tz] = randomLand(Math.random, WORLD_R, new Set(['grass','mud','sand']));
      this._tx = tx; this._tz = tz; this.roam = 6 + Math.random() * 8;
    }
    if (this._tx !== undefined){
      this.cx += (this._tx - this.cx) * Math.min(1, dt * 0.15);
      this.cz += (this._tz - this.cz) * Math.min(1, dt * 0.15);
    }

    for (const p of this.members){
      p.update(cam, dt, player, this.cx, this.cz, this.spread, tint);
      p.mat.opacity = this.opacity;
    }
  }
}

// ------------------------------------------------------------------ AncientBand

class AncientBand {
  constructor(scene, ancientTex, texF, texB, cx, cz){
    this.cx = cx; this.cz = cz;
    this.spread = 3 + Math.random() * 2;
    this.ancients = [];
    this.companions = [];

    // one ancient puck, slightly larger than a regular
    if (walkable(cx, cz)){
      this.ancients.push(new AncientPuck(scene, ancientTex, {
        x: cx, z: cz, h: 1.6 + Math.random() * 0.3, opacity: 0,
      }));
    }

    // half the time he's accompanied by regular pucks
    if (Math.random() < 0.5){
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++){
        const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * this.spread;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (walkable(x, z))
          this.companions.push(new Puck(scene, texF, texB, { x, z, h: 0.85 + Math.random() * 0.4, opacity: 0 }));
      }
    }

    this.phase = 'in'; this.opacity = 0;
    this.life = 20 + Math.random() * 25;   // lingers a little longer than a regular band
    this.roam = 0;
    this.dead = this.ancients.length === 0;
  }

  get members(){ return [...this.ancients, ...this.companions]; }

  update(cam, dt, player, tint){
    if (this.phase === 'in'){
      this.opacity = Math.min(1, this.opacity + dt * 0.7);  // slower, more dramatic fade-in
      if (this.opacity >= 1) this.phase = 'live';
    } else if (this.phase === 'live'){
      this.life -= dt;
      if (this.life <= 0) this.phase = 'out';
    } else if (this.phase === 'out'){
      this.opacity = Math.max(0, this.opacity - dt * 0.5);
      if (this.opacity <= 0){
        for (const p of this.members) p.dispose();
        this.ancients.length = 0; this.companions.length = 0; this.dead = true; return;
      }
    }

    this.roam -= dt;
    if (this.roam <= 0){
      const [tx, tz] = randomLand(Math.random, WORLD_R, new Set(['grass','mud','sand']));
      this._tx = tx; this._tz = tz; this.roam = 8 + Math.random() * 12;
    }
    if (this._tx !== undefined){
      this.cx += (this._tx - this.cx) * Math.min(1, dt * 0.1);
      this.cz += (this._tz - this.cz) * Math.min(1, dt * 0.1);
    }

    for (const p of this.ancients){
      p.update(cam, dt, player, this.cx, this.cz, this.spread, tint);
      p.mat.opacity = this.opacity; p.mat.depthWrite = false;
    }
    for (const p of this.companions){
      p.update(cam, dt, player, this.cx, this.cz, this.spread + 1, tint);
      p.mat.opacity = this.opacity;
    }
  }
}

// ------------------------------------------------------------------ PuckFlock

export class PuckFlock {
  constructor(scene, { x = 0, z = 0 } = {}){
    this.scene = scene; this.cx = x; this.cz = z;
    this.bands = [];
    this.ancientBands = [];
    this.leader = null;
    this.bandTimer = 3 + Math.random() * 5;
    this.maxBands = 3;
    // ancient pucks are rare — one every 90–180 s, max 1 at a time
    this.ancientTimer = 90 + Math.random() * 90;
  }

  async load(){
    const loader = new THREE.TextureLoader();
    this.texF = await loadTex(loader, FRONT);
    this.texB = await loadTex(loader, BACK);
    this.ancientTextures = await Promise.all(ANCIENT_SPRITES.map(s => loadTex(loader, s)));
    const label = makeLabel('Puck', { color: '#e8c75a' });
    this.scene.add(label);
    this.leader = new Puck(this.scene, this.texF, this.texB,
      { x: this.cx, z: this.cz, h: 1.35, opacity: 1, label });
    this.leaderCx = this.cx; this.leaderCz = this.cz;
    this._spawnBand();
    return this;
  }

  _spawnBand(){
    const [x, z] = randomLand(Math.random, WORLD_R, new Set(['grass','mud','sand']));
    this.bands.push(new Band(this.scene, this.texF, this.texB, x, z, 3 + Math.floor(Math.random() * 4)));
  }

  _spawnAncientBand(){
    const [x, z] = randomLand(Math.random, WORLD_R, new Set(['grass','mud','sand']));
    const tex = this.ancientTextures[Math.floor(Math.random() * this.ancientTextures.length)];
    this.ancientBands.push(new AncientBand(this.scene, tex, this.texF, this.texB, x, z));
  }

  // every member currently in the world — for the minimap
  get members(){
    const all = this.leader ? [this.leader] : [];
    for (const b of this.bands) for (const p of b.members) all.push(p);
    for (const b of this.ancientBands) for (const p of b.members) all.push(p);
    return all;
  }

  update(cam, dt, player, tint){
    if (!this.leader) return;

    this.leader.update(cam, dt, player, this.leaderCx, this.leaderCz, 7, tint);
    this.leaderCx += (this.leader.x - this.leaderCx) * Math.min(1, dt * 0.4);
    this.leaderCz += (this.leader.z - this.leaderCz) * Math.min(1, dt * 0.4);

    this.bandTimer -= dt;
    if (this.bandTimer <= 0 && this.bands.length < this.maxBands){
      this._spawnBand();
      this.bandTimer = 10 + Math.random() * 16;
    }

    this.ancientTimer -= dt;
    if (this.ancientTimer <= 0 && this.ancientBands.length === 0){
      this._spawnAncientBand();
      this.ancientTimer = 90 + Math.random() * 90;
    }

    for (const b of this.bands) b.update(cam, dt, player, tint);
    this.bands = this.bands.filter(b => !b.dead);

    for (const b of this.ancientBands) b.update(cam, dt, player, tint);
    this.ancientBands = this.ancientBands.filter(b => !b.dead);
  }
}
