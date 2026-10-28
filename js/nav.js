// nav.js — a walkability grid + A* pathfinder, so NPCs route AROUND water and
// tree clusters instead of just steering locally into them. The brain follows the
// returned waypoints; local steering (agents.moveTo) still handles fine avoidance
// (single trees, other people) between waypoints.
//
// The grid spans the world square [-SIZE/2, SIZE/2] at CELL resolution. A cell is
// walkable if its centre is on land, inside WORLD_R, and not stamped out by a
// (large/static) obstacle circle. Buffers are allocated once and reused across
// searches via a generation stamp, so a query allocates nothing.
//
// Paths minimise walking TIME, not distance: a step costs its length over the
// pace there (terrain.js — the ground's own pace, and the slope by Tobler), so
// the folk go round a reedbed or a steep knoll when that's quicker, and take the
// road when it is. Ground pace is sampled per 2×2 block of cells (a habitat
// lookup for all 1.6M cells would add most of a second to loading); worn trails
// then re-price the cells they cross (refreshWear), so the folk take the paths.

import { SIZE, WORLD_R, WATER } from './config.js';
import { height, groundPace, slopePace, wornPace, builtAt } from './terrain.js';

const CELL = 2.5;
const SQRT2 = 1.41421356;
// The timed search's heuristic is a meadow walk scaled up by this: the land
// averages ~1.5–2× a meadow's cost, so an unscaled estimate leaves A* flooding.
// Inadmissible, so a route can come out a few percent slower than the quickest;
// the search is several times faster for it.
const HEUR_TIMED = 1.5;

export class NavGrid {
  constructor(){
    this.cell = CELL;
    this.half = SIZE / 2;
    this.cols = Math.ceil(SIZE / CELL);
    const N = this.cols * this.cols;
    this.walk = new Uint8Array(N);
    this.held = new Uint8Array(N);          // how many huts stand on each cell (block)
    this.came = new Int32Array(N);
    this.g    = new Float32Array(N);
    this.seen = new Int32Array(N);          // search id a cell's g/came belongs to
    this.searchId = 0;
    // min-heap of cell indices (lazy decrease-key) and their f-scores. A search
    // stops at maxExpand (12000) expansions, each pushing at most 8 neighbours,
    // so 128k entries is plenty — sizing it by the grid (4 per cell) was 52 MB
    // at 3200u. push() already refuses to overflow.
    this.heap = new Int32Array(131072);
    this.hf   = new Float32Array(131072);
    this.h = null;                          // cell heights, cm (Int16), filled by build()
    this.base = null;                       // 1 / ground pace ×32, per 2×2 block (Uint8)
    this.slow = null;                       // the same per cell, after trail wear (Uint8)
    this._worn = new Set();                 // cells a trail has re-priced
    this.bcols = Math.ceil(this.cols / 2);
    this.hn = 0;
  }

  col(x){ return Math.floor((x + this.half) / this.cell); }
  row(z){ return Math.floor((z + this.half) / this.cell); }
  cxOf(c){ return -this.half + (c + 0.5) * this.cell; }
  czOf(r){ return -this.half + (r + 0.5) * this.cell; }
  inb(c, r){ return c >= 0 && r >= 0 && c < this.cols && r < this.cols; }
  walkAt(c, r){ const i = r * this.cols + c; return this.inb(c, r) && this.walk[i] === 1 && this.held[i] === 0; }

  // Huts come and go, unlike trees: stamp one in (+1) or lift it (-1). A counter,
  // not a flag, so lifting one hut never reopens ground another still stands on.
  // Only cells whose centre is inside the wall — the doorway and the walk round
  // are left to local steering.
  block(x, z, rad, delta){
    const c0 = this.col(x - rad), c1 = this.col(x + rad);
    const r0 = this.row(z - rad), r1 = this.row(z + rad);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++){
      if (!this.inb(c, r)) continue;
      if (Math.hypot(this.cxOf(c) - x, this.czOf(r) - z) >= rad) continue;
      const i = r * this.cols + c;
      this.held[i] = Math.max(0, this.held[i] + delta);
    }
  }

  // Build the walkable grid. `blockers` = obstacle circles {x,z,r}; only the large
  // static ones (trees) are stamped out — small choppable shrubs are left to local
  // steering so they don't wall off the grid.
  build(blockers){
    const { cols, cell, half, walk } = this;
    const hs = this.h = new Int16Array(cols * cols);
    for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++){
      const x = -half + (c + 0.5) * cell, z = -half + (r + 0.5) * cell, y = height(x, z);
      hs[r * cols + c] = Math.max(-32000, Math.min(32000, Math.round(y * 100)));
      walk[r * cols + c] = (y > WATER + 0.25 && Math.hypot(x, z) < WORLD_R && !builtAt(x, z, 0.9)) ? 1 : 0;   // clear of buildings, with room for a body
    }
    const bc = this.bcols, base = this.base = new Uint8Array(bc * bc);
    for (let r = 0; r < bc; r++) for (let c = 0; c < bc; c++){
      const x = -half + (c + 0.5) * cell * 2, z = -half + (r + 0.5) * cell * 2;
      base[r * bc + c] = Math.min(255, Math.round(32 / groundPace(x, z)));
    }
    const slow = this.slow = new Uint8Array(cols * cols);
    for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) slow[r * cols + c] = base[(r >> 1) * bc + (c >> 1)];
    this._worn.clear();
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

  // Re-price the cells worn trails cross (trails.js TrailField): a trodden path
  // is quicker going (terrain.js wornPace), so routes come to follow the paths.
  // Cheap enough to call every couple of seconds: it visits only the worn cells,
  // plus the ones it re-priced last time (so a path that has grown over goes
  // back to its ground's own pace).
  refreshWear(trail){
    if (!this.slow) return;
    const cols = this.cols, cell = this.cell, half = this.half, bc = this.bcols;
    const tcols = trail.ground.cols, tstep = trail.ground.step;
    const visit = new Set(this._worn);
    const add = i => {
      const c = this.col((i % tcols) * tstep - half), r = this.row(((i / tcols) | 0) * tstep - half);
      if (this.inb(c, r)) visit.add(r * cols + c);
    };
    for (const i of trail.active) add(i);
    if (trail.permanent) for (const i of trail.permanent) add(i);
    this._worn.clear();
    for (const i of visit){
      const c = i % cols, r = (i / cols) | 0;
      const w = trail.wearAt(-half + (c + 0.5) * cell, -half + (r + 0.5) * cell);
      const ground = 32 / this.base[(r >> 1) * bc + (c >> 1)];
      this.slow[i] = Math.min(255, Math.round(32 / wornPace(ground, w)));
      if (w > 0.08) this._worn.add(i);
    }
  }

  // seconds-per-unit (relative to a level meadow) of the ground in a cell, and
  // the cost of one step between neighbouring cells a and b, `len` cells long
  _slow(c, r){ return this.slow[r * this.cols + c] / 32; }
  _step(a, b, len){
    const cols = this.cols, grade = (this.h[b] - this.h[a]) / 100 / (len * this.cell);
    return len * 0.5 * (this._slow(a % cols, (a / cols) | 0) + this._slow(b % cols, (b / cols) | 0)) / slopePace(grade);
  }

  // Estimated walking time from one point to another, in meadow-units (a level
  // meadow walk of d units costs d): the straight line, priced by the ground and
  // slope along it. Cheap — a few samples, no search — so the folk can weigh it
  // for every place they might go (agents.js choose). Water on the way counts
  // as slow going: they'd have to find a way round.
  travelCost(x0, z0, x1, z1){
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (!this.h || d < this.cell) return d;
    const n = Math.min(12, Math.max(2, Math.ceil(d / 10)));
    let sum = 0, pc = this.col(x0), pr = this.row(z0);
    for (let k = 1; k <= n; k++){
      const c = this.col(x0 + (x1 - x0) * k / n), r = this.row(z0 + (z1 - z0) * k / n);
      if (!this.inb(c, r) || !this.inb(pc, pr)){ sum += d / n; pc = c; pr = r; continue; }
      const a = pr * this.cols + pc, b = r * this.cols + c;
      sum += this.walk[b] ? this._step(a, b, d / n / this.cell) * this.cell : 2.5 * d / n;
      pc = c; pr = r;
    }
    return sum;
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
  // The quickest route is searched first; in rugged country that search can run
  // out of budget (every step there is dear, so it floods), and then the plain
  // shortest route is taken instead — never worse off than before pace counted.
  findPath(sx, sz, gx, gz, maxExpand = 12000){
    return this._search(sx, sz, gx, gz, maxExpand, true) || this._search(sx, sz, gx, gz, 6000, false);
  }
  _search(sx, sz, gx, gz, maxExpand, timed){
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
    const hk = timed ? HEUR_TIMED : 1;
    this._push(sIdx, this._h(s[0], s[1], gc, gr) * hk);

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
        const ng = cg + (timed ? this._step(cur, ni, dc && dr ? SQRT2 : 1) : dc && dr ? SQRT2 : 1);
        if (seen[ni] !== id || ng < gscore[ni]){
          gscore[ni] = ng; came[ni] = cur; seen[ni] = id;
          this._push(ni, ng + this._h(nc, nr, gc, gr) * hk);
        }
      }
    }
    if (!found) return null;

    // reconstruct cell path (start..goal), to world centres
    const cells = [];
    for (let i = gIdx; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map(i => [this.cxOf(i % cols), this.czOf((i / cols) | 0)]);
    const gs = cells.map(i => gscore[i]);
    pts[pts.length - 1] = [gx, gz];          // end exactly at the target
    return this._smooth(pts, timed ? gs : null);
  }

  // octile heuristic (in cell units, a level meadow's cost); the timed search
  // scales it by HEUR_TIMED
  _h(c, r, gc, gr){
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
  }

  // drop waypoints that have clear line-of-sight from the previous kept one —
  // and, for a timed route, only where the straight walk is no slower than the
  // route the search found (gs: its cost so far at each point), or a shortcut
  // would cut straight back across the marsh it went round
  _smooth(pts, gs){
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1){
      let j = pts.length - 1;
      for (; j > i + 1; j--)
        if (this._los(pts[i], pts[j]) && (!gs || this._segCost(pts[i], pts[j]) <= (gs[j] - gs[i]) * 1.05 + 0.5)) break;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  _clampRow(i){ return Math.max(0, Math.min(this.cols - 1, i)); }
  // the walking cost of a straight segment, in cell units like the search's g
  _segCost(a, b){
    const dx = b[0] - a[0], dz = b[1] - a[1], dist = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(dist / this.cell)), len = dist / this.cell / n;
    const at = (x, z) => this._clampRow(this.row(z)) * this.cols + this._clampRow(this.col(x));
    let cost = 0, prev = at(a[0], a[1]);
    for (let k = 1; k <= n; k++){
      const cur = at(a[0] + dx * k / n, a[1] + dz * k / n);
      cost += this._step(prev, cur, len); prev = cur;
    }
    return cost;
  }
  _los(a, b){
    const dx = b[0] - a[0], dz = b[1] - a[1], dist = Math.hypot(dx, dz);
    const n = Math.ceil(dist / (this.cell * 0.5));
    for (let k = 1; k < n; k++){
      const t = k / n;
      if (!this.walkAt(this.col(a[0] + dx * t), this.row(a[1] + dz * t))) return false;
    }
    // ...and no shortcut past a building's corner: the cells are coarser than a
    // corner, so a straight run can clip one between their centres
    const m = Math.ceil(dist / 0.6);
    for (let k = 1; k < m; k++){
      const t = k / m;
      if (builtAt(a[0] + dx * t, a[1] + dz * t, 0.6)) return false;
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
