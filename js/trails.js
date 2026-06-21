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
    this.geo = ground.geometry;
    this.colorAttr = this.geo.attributes.color;
    this.base = Float32Array.from(this.colorAttr.array);   // biome + duff, the un-trodden ground
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

  // wear (0..1) at a world point; 0 off the mesh. Lets other systems (e.g. the
  // decorative grass) keep off trodden ground too.
  wearAt(x, z){ const i = this.idx(x, z); return i < 0 ? 0 : this.wear[i]; }

  _add(row, col, amt){
    if (col < 0 || col > SEG || row < 0 || row > SEG) return;
    const i = row * COLS + col;
    this.wear[i] = Math.min(this.opts.cap, this.wear[i] + amt);
    this.active.add(i);
    this._paintCell(i);
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
    let r = b[i*3] * dark, g = b[i*3+1] * dark, bl = b[i*3+2] * dark;
    // Stage B — soil chips through: only past this cell's OWN hashed threshold,
    // so bare earth emerges in a grainy, speckled way that grows with traffic.
    const soilThr = 0.32 + this._hash(i) * 0.46;               // 0.32..0.78 per cell
    const s = smooth(soilThr - 0.03, soilThr + 0.03, w);
    r = r * (1 - s) + t[0] * s; g = g * (1 - s) + t[1] * s; bl = bl * (1 - s) + t[2] * s;
    const arr = this.colorAttr.array;
    arr[i*3] = r; arr[i*3+1] = g; arr[i*3+2] = bl;
  }

  // decay + throttled GPU upload + throttled grass suppression
  tick(dt){
    if (dt > 0 && this.active.size){
      const { decayGrass, decaySoil } = this.opts;
      for (const i of this.active){
        // heal fast while it's just trodden grass, slowly once soil is bare
        const s = smooth(0.25, 0.45, this.wear[i]);     // 0 = trodden, 1 = bare soil
        this.wear[i] -= (decayGrass + (decaySoil - decayGrass) * s) * dt;
        if (this.wear[i] <= 0){ this.wear[i] = 0; this.active.delete(i); }
        this._paintCell(i);
      }
      this._pending = true;
    }
    this._upT += dt;
    if (this._upT >= 0.15){ this._upT = 0; if (this._pending){ this.colorAttr.needsUpdate = true; this._pending = false; } }

    this._grassT += dt;
    if (this._grassT >= 0.5){ this._grassT = 0; this._updateGrass(); }
  }

  // force the pending colour upload + grass pass (used after a warm-up burst)
  flush(){ this.colorAttr.needsUpdate = true; this._pending = false; this._updateGrass(); }

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
