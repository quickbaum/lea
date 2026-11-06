// Trails — the wear field (stigmergy substrate). Walkers deposit "wear" where
// they step; it decays (vegetation regrows); high wear paints the ground toward
// packed earth and removes grass tufts, so paths emerge as bare trodden strips.
// Design + research: docs/trails.md. Stage 1: wear + visuals, no routing change.

import * as THREE from 'three';
import { SIZE, SEG } from './config.js';

const STEP = SIZE / SEG;          // world units per grid cell (= ground vertex spacing)
const COLS = SEG + 1;             // vertices per side
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class TrailField {
  constructor(ground, {
    deposit = 0.5,        // wear added per second of walking over a cell
    decayGrass = 0.010,   // trodden grass springs back fast (dark -> light, ~tens of s)
    decaySoil  = 0.0012,  // bare soil revegetates slowly (~a full day/night cycle, 600s)
    cap     = 1.0,        // max wear
    clear   = 0.08,       // base wear at which tufts begin to thin (per-tuft, +hash)
    trailColor = [0.30, 0.23, 0.14],   // packed-earth colour
  } = {}){
    this.ground = ground;           // terrain.js Ground: shared colour grid, tiled meshes
    this.base = Uint8Array.from(ground.color);     // biome + duff, the un-trodden ground (0..255)
    this.wear = new Float32Array(COLS * COLS);
    this.active = new Set();        // cell indices with wear > 0
    this.opts = { deposit, decayGrass, decaySoil, cap, clear };
    this.trail = trailColor;
    this.grass = [];                // [{ inst, items, hidden:Uint8Array }]
    this._upT = 0; this._pending = false;
    this._grassT = 0;
    this.ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  // world (x,z) -> nearest ground-vertex index, or -1 if off the mesh
  idx(x, z){
    const col = Math.round((x + SIZE / 2) / STEP);
    const row = Math.round((z + SIZE / 2) / STEP);
    if (col < 0 || col > SEG || row < 0 || row > SEG) return -1;
    return row * COLS + col;
  }

  // register a grass group (from flora's scatterGrass) for trail suppression
  addGrass(g){ if (g && g.items) this.grass.push({ inst: g.inst, items: g.items, hidden: new Uint8Array(g.items.length) }); }

  // A permanent kept clearing (a glade the folk keep open around a great tree):
  // set lasting wear in a soft-edged disc so the ground bares and the existing
  // grass/reed/fern suppression empties it — reused wholesale rather than a new
  // system. Marked permanent so it never regrows. Call after addGrass(); flush()
  // to apply at once. `strength` peaks at the centre and fades to 0 at the rim.
  // Returns its cells, for release() if the clearing is one day given back.
  clearing(cx, cz, r, strength = 0.7){
    if (!this.permanent) this.permanent = new Map();   // cell -> how many clearings hold it
    const cells = [];
    const span = Math.ceil(r / STEP);
    const col0 = Math.round((cx + SIZE / 2) / STEP), row0 = Math.round((cz + SIZE / 2) / STEP);
    for (let row = row0 - span; row <= row0 + span; row++){
      for (let col = col0 - span; col <= col0 + span; col++){
        if (col < 0 || col > SEG || row < 0 || row > SEG) continue;
        const x = col * STEP - SIZE / 2, z = row * STEP - SIZE / 2;
        const d = Math.hypot(x - cx, z - cz);
        if (d > r) continue;
        // full across most of the disc (so reeds/ferns, thr up to ~0.30, all clear
        // and the core bares to soil), fading only near the rim
        const f = Math.min(1, (1 - d / r) / 0.3);
        const w = strength * f * f * (3 - 2 * f);
        const i = row * COLS + col;
        this.permanent.set(i, (this.permanent.get(i) || 0) + 1); cells.push(i);
        if (w > this.wear[i]){ this.wear[i] = w; this._paintCell(i); }
      }
    }
    this._pending = true;
    return cells;
  }

  // The same, for a rectangle (a sheepfold's floor): bare right up to the sides, fading over `edge` beyond them. a turns
  // it, as a building's a does.
  clearingBox(cx, cz, a, hl, hw, strength = 0.7, edge = 2){
    if (!this.permanent) this.permanent = new Map();
    const cells = [], c = Math.cos(a), s = Math.sin(a), span = Math.ceil((Math.hypot(hl, hw) + edge) / STEP);
    const col0 = Math.round((cx + SIZE / 2) / STEP), row0 = Math.round((cz + SIZE / 2) / STEP);
    for (let row = row0 - span; row <= row0 + span; row++){
      for (let col = col0 - span; col <= col0 + span; col++){
        if (col < 0 || col > SEG || row < 0 || row > SEG) continue;
        const dx = col * STEP - SIZE / 2 - cx, dz = row * STEP - SIZE / 2 - cz;
        const out = Math.max(Math.abs(dx * c + dz * s) - hl, Math.abs(dz * c - dx * s) - hw);
        if (out > edge) continue;
        const f = out <= 0 ? 1 : 1 - out / edge, w = strength * f * f * (3 - 2 * f), i = row * COLS + col;
        this.permanent.set(i, (this.permanent.get(i) || 0) + 1); cells.push(i);
        if (w > this.wear[i]){ this.wear[i] = w; this._paintCell(i); }
      }
    }
    this._pending = true;
    return cells;
  }

  // Give a clearing back: its cells start to regrow like any bare ground, slowly
  // (decaySoil). One a second clearing still holds stays kept.
  release(cells){
    for (const i of cells){
      const n = this.permanent.get(i) - 1;
      if (n > 0){ this.permanent.set(i, n); continue; }
      this.permanent.delete(i);
      this.active.add(i);
    }
  }

  // wear (0..1) at a world point; 0 off the mesh. Lets other systems (e.g. the
  // decorative grass) keep off trodden ground too.
  wearAt(x, z){ const i = this.idx(x, z); return i < 0 ? 0 : this.wear[i]; }

  // the same, as the blades read it. In a kept clearing it blends the four cells
  // round the point, or the clearing's edge is a staircase of 2u squares; a path
  // keeps its nearest-cell grain.
  bladeWearAt(x, z){
    const i = this.idx(x, z);
    if (i < 0) return 0;
    if (!this.permanent?.has(i)) return this.wear[i];
    const fc = (x + SIZE / 2) / STEP, fr = (z + SIZE / 2) / STEP;
    const c = Math.floor(fc), r = Math.floor(fr), ac = fc - c, ar = fr - r;
    if (c < 0 || c >= SEG || r < 0 || r >= SEG) return this.wear[i];
    const a = r * COLS + c, w = this.wear;
    return (w[a] * (1 - ac) + w[a + 1] * ac) * (1 - ar) + (w[a + COLS] * (1 - ac) + w[a + COLS + 1] * ac) * ar;
  }

  _add(row, col, amt){
    if (col < 0 || col > SEG || row < 0 || row > SEG) return;
    const i = row * COLS + col;
    this.wear[i] = Math.min(this.opts.cap, this.wear[i] + amt);
    this.active.add(i);
    this._paintCell(i);
  }

  // how closely grazed this ground is, 0..1. The array appears the first time anything's eaten
  setLawn(x, z, k){
    const i = this.idx(x, z);
    if (i < 0) return;
    if (!this.lawn) this.lawn = new Uint8Array(COLS * COLS);
    this.lawn[i] = k * 255;
    this._paintCell(i);
    this._pending = true;
  }

  // a walker treads (x,z) this frame. Narrow kernel: the centre line takes the
  // brunt, the two flanking cells only a little, so the path stays slim and its
  // edge forms a grainy fringe rather than a wide band.
  deposit(x, z, dt){
    const col = Math.round((x + SIZE / 2) / STEP), row = Math.round((z + SIZE / 2) / STEP);
    const a = this.opts.deposit * dt;
    this._add(row, col, a);
    this._add(row, col - 1, a*0.3); this._add(row, col + 1, a*0.3);
    this._add(row - 1, col, a*0.3); this._add(row + 1, col, a*0.3);
    this._pending = true;
  }

  // deterministic per-cell value, for a stable grainy threshold (no flicker)
  _hash(i){ const n = Math.sin(i * 12.9898) * 43758.5453; return n - Math.floor(n); }

  _paintCell(i){
    const w = this.wear[i];
    const b = this.base, t = this.trail;
    // Stage A — trodden grass: the ground darkens early & smoothly, keeping its
    // hue (flattened, bruised grass), giving the dark patch a path begins as.
    const dark = 1 - 0.5 * smooth(0.04, 0.22, w);              // down to 0.5 brightness
    let r = b[i*3] * dark, g = b[i*3+1] * dark, bl = b[i*3+2] * dark;     // 0..255, like ground.color
    // grazed short: paler and yellower, no earth in it (js/sward.js)
    const lawn = this.lawn ? this.lawn[i] / 255 : 0;
    if (lawn){ r *= 1 + 0.2 * lawn; g *= 1 + 0.16 * lawn; bl *= 1 + 0.03 * lawn; }
    // Stage B — soil chips through: only past this cell's OWN hashed threshold,
    // so bare earth emerges in a grainy, speckled way that grows with traffic.
    const soilThr = 0.32 + this._hash(i) * 0.46;               // 0.32..0.78 per cell
    const s = smooth(soilThr - 0.03, soilThr + 0.03, w);
    r = r * (1 - s) + t[0] * 255 * s; g = g * (1 - s) + t[1] * 255 * s; bl = bl * (1 - s) + t[2] * 255 * s;
    const arr = this.ground.color;
    arr[i*3] = r; arr[i*3+1] = g; arr[i*3+2] = bl;
    this.ground.touch(i);
  }

  // decay + throttled GPU upload + throttled grass suppression
  tick(dt){
    if (dt > 0 && this.active.size){
      const { decayGrass, decaySoil } = this.opts;
      for (const i of this.active){
        if (this.permanent && this.permanent.has(i)) continue;   // kept clearings never regrow
        // heal fast while it's just trodden grass, slowly once soil is bare
        const s = smooth(0.25, 0.45, this.wear[i]);     // 0 = trodden, 1 = bare soil
        this.wear[i] -= (decayGrass + (decaySoil - decayGrass) * s) * dt;
        if (this.wear[i] <= 0){ this.wear[i] = 0; this.active.delete(i); }
        this._paintCell(i);
      }
      this._pending = true;
    }
    this._upT += dt;
    if (this._upT >= 0.15){ this._upT = 0; if (this._pending){ this.ground.upload(); this._pending = false; } }

    this._grassT += dt;
    if (this._grassT >= 0.5){ this._grassT = 0; this._updateGrass(); }
  }

  // force the pending colour upload + grass pass (used after a warm-up burst)
  flush(){ this.ground.upload(); this._pending = false; this._updateGrass(); }

  // Thin grass tufts off trodden ground. Each tuft has its OWN hashed threshold
  // (in the trodden-grass band, before soil shows), so the path's grass wears
  // away grainily — some clumps linger while neighbours are already gone.
  _updateGrass(){
    for (const g of this.grass){
      let changed = false;
      for (let k = 0; k < g.items.length; k++){
        const it = g.items[k];
        const i = this.idx(it.x, it.z);
        const w = i < 0 ? 0 : this.wear[i];
        const thr = this.opts.clear + this._hash(k * 2 + 1) * 0.22;   // ~0.08..0.30
        if (!g.hidden[k] && w > thr){ g.inst.setMatrixAt(k, this.ZERO); g.hidden[k] = 1; changed = true; }
        else if (g.hidden[k] && w < thr * 0.7){ g.inst.setMatrixAt(k, it.m); g.hidden[k] = 0; changed = true; }
      }
      if (changed) g.inst.instanceMatrix.needsUpdate = true;
    }
  }
}
