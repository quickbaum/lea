// The Old Road: one paved road laid across the Lea from corner to corner, and
// off the map at both ends — it comes from somewhere and goes somewhere, which
// is what the caravans and the trading posts along it will need.
//
// Laid the way old roads were: not ruled straight but walked out over the
// ground. Surveyors kept to ridges and dry high ground, wandered on hills to
// find a gentle grade, contoured round what was too steep, and went round
// lakes rather than through them. That is a least-cost path — how archaeologists
// reconstruct such roads, with a wheeled-vehicle cost on slope — so the route
// is an A* search over a coarse grid of the land, then pulled taut and rounded
// into curves. It is raised on an embankment (the agger) so it stays dry.
//
// Pure (no three.js). land.js plans it once on the ungraded heights, then
// grades the land to it, so everything that reads height() or habitat() —
// the ground mesh, the maps, flora, the nav grid — sees the road for free.

import { mulberry32 } from '../rng.js';

export const ROAD_W = 3.6;     // half-width of the paving: 7.2u ≈ 4.8 m, a main road two carts can pass on
export const VERGE  = 9;       // cleared either side of the paving: no trees or shrubs stand here
export const BANK   = 8;       // the embankment's skirt: how far out the land is graded back to its own height
const STEP = 2;                // profile sample spacing (the height grid's spacing)
const CELL = 8;                // the planning grid
const AGGER = 0.5;             // how far the road stands above the ground it smooths (~1/3 m)
const RULING = 0.06;           // the grade a loaded cart takes in its stride (1 in 16)

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// 16 directions: the 8 neighbours plus the knight's moves, so a route isn't
// stuck to 45° steps before it is smoothed
const DIRS = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1],
  [2,1],[1,2],[-1,2],[-2,1],[-2,-1],[-1,-2],[1,-2],[2,-1]];

// size: the world's side; height(x, z): the ungraded land; water: the water
// plane; fields(x, z): the region fields (land.js), for rugged ground
export function planRoad({ size, seed, height, water, fields }){
  const r = mulberry32(seed >>> 0);
  const half = size / 2;
  const G = Math.round(size / CELL) + 1;
  const X = c => c * CELL - half;

  // what one cell of ground costs to cross, per unit, before slope
  const H = new Float32Array(G * G), K = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const x = X(i), z = X(j), h = height(x, z), d = h - water, k = j * G + i;
    H[k] = h;
    let c = 1;
    if (d < 0.3) c = 400;                            // open water: go round it
    else if (d < 1.4) c = 4;                         // marsh and wet meadow: soft, keep off
    if (d > 12) c *= 1 + (d - 12) / 10;              // the highlands: a long haul up, keep low
    if (fields(x, z).rough > 0.6) c *= 2;            // crags and broken ground
    K[k] = c;
  }
  const stepCost = (a, b, len) => {
    const g = Math.abs(H[b] - H[a]) / len;
    const slope = 1 + (g / RULING) ** 2 + (g > 2.5 * RULING ? 40 : 0);
    return len * (K[a] + K[b]) * 0.5 * slope;
  };

  // the ends: near opposite corners of a seeded diagonal, on dry ground at the map's edge
  const flip = r() < 0.5;
  const endAt = (ci, cj) => {
    const along = r() < 0.5, di = ci === 0 ? 1 : -1, dj = cj === 0 ? 1 : -1;
    const o0 = Math.floor(r() * G * 0.15);
    for (let t = 0; t < G * 0.3; t++){                // walk in along one edge until it's dry
      const o = o0 + t, i = along ? ci + di * o : ci, j = along ? cj : cj + dj * o;
      if (H[j * G + i] - water > 1.4) return j * G + i;
    }
    return cj * G + ci;
  };
  const c0 = flip ? G - 1 : 0, c1 = flip ? 0 : G - 1;
  const A = endAt(c0, 0), B = endAt(c1, G - 1);

  // A* from A to B
  const g = new Float32Array(G * G).fill(Infinity), came = new Int32Array(G * G).fill(-1);
  const heap = [], hf = [];
  const push = (n, f) => {
    let k = heap.length; heap.push(n); hf.push(f);
    while (k > 0){ const p = (k - 1) >> 1; if (hf[p] <= f) break; heap[k] = heap[p]; hf[k] = hf[p]; k = p; }
    heap[k] = n; hf[k] = f;
  };
  const pop = () => {
    const top = heap[0], ln = heap.pop(), lf = hf.pop();
    if (heap.length){
      let k = 0;
      for (;;){
        let c = 2 * k + 1; if (c >= heap.length) break;
        if (c + 1 < heap.length && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        heap[k] = heap[c]; hf[k] = hf[c]; k = c;
      }
      heap[k] = ln; hf[k] = lf;
    }
    return top;
  };
  const bi = B % G, bj = (B / G) | 0;
  const est = n => Math.hypot(n % G - bi, ((n / G) | 0) - bj) * CELL;
  g[A] = 0; push(A, est(A));
  const done = new Uint8Array(G * G);
  while (heap.length){
    const n = pop();
    if (n === B) break;
    if (done[n]) continue;
    done[n] = 1;
    const i = n % G, j = (n / G) | 0;
    for (const [di, dj] of DIRS){
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
      const m = jj * G + ii;
      if (done[m]) continue;
      const len = Math.hypot(di, dj) * CELL;
      // a knight's move crosses the two cells beside it: charge their ground too
      let c = stepCost(n, m, len);
      if (Math.abs(di) + Math.abs(dj) === 3) c = Math.max(c, len * K[(j + Math.round(dj / 2)) * G + i + Math.round(di / 2)]);
      const ng = g[n] + c;
      if (ng < g[m]){ g[m] = ng; came[m] = n; push(m, ng + est(m)); }
    }
  }
  const cells = [];
  for (let n = B; n !== -1; n = came[n]) cells.push(n);
  cells.reverse();

  // pull it taut: skip ahead to the farthest cell the straight way costs no
  // more than the winding one, so the grid's stair-steps become long runs
  const segCost = (a, b) => {
    const ax = a % G, az = (a / G) | 0, bx = b % G, bz = (b / G) | 0;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
    let c = 0, prev = a;
    for (let s = 1; s <= n; s++){
      const k = Math.round(az + (bz - az) * s / n) * G + Math.round(ax + (bx - ax) * s / n);
      c += stepCost(prev, k, Math.hypot(ax - bx, az - bz) * CELL / n);
      prev = k;
    }
    return c;
  };
  const taut = [cells[0]];
  for (let a = 0; a < cells.length - 1;){
    let best = a + 1;
    for (let b = Math.min(cells.length - 1, a + 60); b > a + 1; b--){
      if (segCost(cells[a], cells[b]) <= (g[cells[b]] - g[cells[a]]) * 1.03){ best = b; break; }
    }
    taut.push(cells[best]); a = best;
  }
  // round the corners (Chaikin), keeping the ends where they are
  let pts = taut.map(n => [X(n % G), X((n / G) | 0)]);
  for (let it = 0; it < 4; it++){
    const o = [pts[0]];
    for (let k = 0; k + 1 < pts.length; k++){
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      if (k > 0) o.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      if (k + 2 < pts.length) o.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    o.push(pts[pts.length - 1]);
    pts = o;
  }

// the legs, each with where it starts along the road
  const legs = [];
  let s0 = 0;
  for (let i = 0; i + 1 < pts.length; i++){
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    legs.push({ ax, az, dx: (bx - ax) / len, dz: (bz - az) / len, len, s0 });
    s0 += len;
  }
  const length = s0;

  // the centre line every STEP, and its height: the land smoothed along the way
  // (the agger levels knolls and hollows), never lower than a dry causeway
  const n = Math.ceil(length / STEP) + 1;
  const xs = new Float32Array(n), zs = new Float32Array(n), base = new Float32Array(n);
  for (let k = 0; k < n; k++){
    const p = pointAt(legs, Math.min(length, k * STEP));
    xs[k] = p[0]; zs[k] = p[1]; base[k] = height(p[0], p[1]);
  }
  const prof = boxBlur(boxBlur(base, 12), 12);
  for (let k = 0; k < n; k++) prof[k] = Math.max(prof[k], water + 0.6) + AGGER;

  return {
    pts, legs, length, step: STEP, xs, zs, prof,
    // the road's height at distance s along it
    heightAt(s){
      const f = Math.max(0, Math.min(n - 1, s / STEP)), k = Math.min(n - 2, f | 0), t = f - k;
      return prof[k] + (prof[k + 1] - prof[k]) * t;
    },
    // nearest point of the centre line to (x, z): { d: distance, s: along the road }
    nearest(x, z){
      let d = Infinity, s = 0;
      for (const g of legs){
        const t = Math.max(0, Math.min(g.len, (x - g.ax) * g.dx + (z - g.az) * g.dz));
        const e = Math.hypot(x - g.ax - g.dx * t, z - g.az - g.dz * t);
        if (e < d){ d = e; s = g.s0 + t; }
      }
      return { d, s };
    },
  };
}

function pointAt(legs, s){
  let g = legs[legs.length - 1];
  for (const l of legs) if (s <= l.s0 + l.len){ g = l; break; }
  const t = s - g.s0;
  return [g.ax + g.dx * t, g.az + g.dz * t];
}

function boxBlur(a, r){
  const n = a.length, out = new Float32Array(n);
  for (let k = 0; k < n; k++){
    let sum = 0, c = 0;
    for (let j = Math.max(0, k - r); j <= Math.min(n - 1, k + r); j++){ sum += a[j]; c++; }
    out[k] = sum / c;
  }
  return out;
}

// how much of the land at distance d from the centre line is the road's:
// all of it across the paving, fading out over the embankment's skirt
export const gradeWeight = d => d <= ROAD_W + 1 ? 1 : smooth(ROAD_W + 1 + BANK, ROAD_W + 1, d);
