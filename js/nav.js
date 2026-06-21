// nav.js — a walkability grid + A* pathfinder, so NPCs route AROUND water and
// tree clusters instead of just steering locally into them. The brain follows the
// returned waypoints; local steering (agents.moveTo) still handles fine avoidance
// (single trees, other people) between waypoints.
//
// The grid spans the world square [-SIZE/2, SIZE/2] at CELL resolution. A cell is
// walkable if its centre is on land, inside WORLD_R, and not stamped out by a
// (large/static) obstacle circle. Buffers are allocated once and reused across
// searches via a generation stamp, so a query allocates nothing.

import { SIZE, WORLD_R, WATER } from './config.js';
import { height } from './terrain.js';

const CELL = 2.5;
const SQRT2 = 1.41421356;

export class NavGrid {
  constructor(){
    this.cell = CELL;
    this.half = SIZE / 2;
    this.cols = Math.ceil(SIZE / CELL);
    const N = this.cols * this.cols;
    this.walk = new Uint8Array(N);
    this.came = new Int32Array(N);
    this.g    = new Float32Array(N);
    this.seen = new Int32Array(N);          // search id a cell's g/came belongs to
    this.searchId = 0;
    this.heap = new Int32Array(N * 4);      // min-heap of cell indices (lazy decrease-key)
    this.hf   = new Float32Array(N * 4);    // their f-scores
    this.hn = 0;
  }

  col(x){ return Math.floor((x + this.half) / this.cell); }
  row(z){ return Math.floor((z + this.half) / this.cell); }
  cxOf(c){ return -this.half + (c + 0.5) * this.cell; }
  czOf(r){ return -this.half + (r + 0.5) * this.cell; }
  inb(c, r){ return c >= 0 && r >= 0 && c < this.cols && r < this.cols; }
  walkAt(c, r){ return this.inb(c, r) && this.walk[r * this.cols + c] === 1; }

  // Build the walkable grid. `blockers` = obstacle circles {x,z,r}; only the large
  // static ones (trees) are stamped out — small choppable shrubs are left to local
  // steering so they don't wall off the grid.
  build(blockers){
    const { cols, cell, half, walk } = this;
    for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++){
      const x = -half + (c + 0.5) * cell, z = -half + (r + 0.5) * cell;
      walk[r * cols + c] = (height(x, z) > WATER + 0.25 && Math.hypot(x, z) < WORLD_R) ? 1 : 0;
    }
    for (const o of (blockers || [])){
      if (!o || o.r < 0.85) continue;            // skip shrubs / tiny things
      const rad = o.r + 0.3;
      const c0 = this.col(o.x - rad), c1 = this.col(o.x + rad);
      const r0 = this.row(o.z - rad), r1 = this.row(o.z + rad);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
        if (!this.inb(c, r)) continue;
        if (Math.hypot(this.cxOf(c) - o.x, this.czOf(r) - o.z) < rad) walk[r * cols + c] = 0;
      }
    }
  }

  // nearest walkable cell [c,r] to a world point, searching outward rings
  snap(x, z){
    let c = this.col(x), r = this.row(z);
    if (this.walkAt(c, r)) return [c, r];
    for (let rad = 1; rad <= 8; rad++){
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++){
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        if (this.walkAt(c + dc, r + dr)) return [c + dc, r + dr];
      }
    }
    return null;
  }

  // A* from (sx,sz) to (gx,gz). Returns an array of [x,z] world waypoints
  // (smoothed, last point is the exact goal), or null if unreachable.
  findPath(sx, sz, gx, gz, maxExpand = 6000){
    const s = this.snap(sx, sz), g = this.snap(gx, gz);
    if (!s || !g) return null;
    const cols = this.cols;
    const sIdx = s[1] * cols + s[0], gIdx = g[1] * cols + g[0];
    if (sIdx === gIdx) return [[gx, gz]];
    const gc = g[0], gr = g[1];
    const id = ++this.searchId;
    const came = this.came, gscore = this.g, seen = this.seen;

    this.hn = 0;
    gscore[sIdx] = 0; came[sIdx] = -1; seen[sIdx] = id;
    this._push(sIdx, this._h(s[0], s[1], gc, gr));

    let expand = 0, found = false;
    while (this.hn > 0 && expand < maxExpand){
      const cur = this._pop();
      if (cur === gIdx){ found = true; break; }
      expand++;
      const cc = cur % cols, cr = (cur / cols) | 0;
      const cg = gscore[cur];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++){
        if (!dc && !dr) continue;
        const nc = cc + dc, nr = cr + dr;
        if (!this.walkAt(nc, nr)) continue;
        if (dc && dr && (!this.walkAt(cc + dc, cr) || !this.walkAt(cc, cr + dr))) continue;  // no corner-cutting
        const ni = nr * cols + nc;
        const ng = cg + (dc && dr ? SQRT2 : 1);
        if (seen[ni] !== id || ng < gscore[ni]){
          gscore[ni] = ng; came[ni] = cur; seen[ni] = id;
          this._push(ni, ng + this._h(nc, nr, gc, gr));
        }
      }
    }
    if (!found) return null;

    // reconstruct cell path (start..goal), to world centres
    const cells = [];
    for (let i = gIdx; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => [this.cxOf(i % cols), this.czOf((i / cols) | 0)]);
    pts[pts.length - 1] = [gx, gz];          // end exactly at the target
    return this._smooth(pts);
  }

  // octile heuristic (in cell units)
  _h(c, r, gc, gr){
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  // drop waypoints that have clear line-of-sight from the previous kept one
  _smooth(pts){
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1){
      let j = pts.length - 1;
      for (; j > i + 1; j--) if (this._los(pts[i], pts[j])) break;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  _los(a, b){
    const dx = b[0] - a[0], dz = b[1] - a[1], dist = Math.hypot(dx, dz);
    const n = Math.ceil(dist / (this.cell * 0.5));
    for (let k = 1; k < n; k++){
      const t = k / n;
      if (!this.walkAt(this.col(a[0] + dx * t), this.row(a[1] + dz * t))) return false;
    }
    return true;
  }

  // --- binary min-heap (by f) -------------------------------------------------
  _push(idx, f){
    if (this.hn >= this.heap.length) return;     // safety; should not happen within maxExpand
    let n = this.hn++; this.heap[n] = idx; this.hf[n] = f;
    while (n > 0){ const p = (n - 1) >> 1; if (this.hf[p] <= this.hf[n]) break;
      this._swap(n, p); n = p; }
  }
  _pop(){
    const root = this.heap[0]; const last = --this.hn;
    this.heap[0] = this.heap[last]; this.hf[0] = this.hf[last];
    let n = 0; const N = this.hn;
    for (;;){
      const l = 2 * n + 1, r = l + 1; let m = n;
      if (l < N && this.hf[l] < this.hf[m]) m = l;
      if (r < N && this.hf[r] < this.hf[m]) m = r;
      if (m === n) break; this._swap(n, m); n = m;
    }
    return root;
  }
  _swap(a, b){
    const i = this.heap[a]; this.heap[a] = this.heap[b]; this.heap[b] = i;
    const f = this.hf[a]; this.hf[a] = this.hf[b]; this.hf[b] = f;
  }
}
