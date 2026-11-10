// The rivers: where the rain that falls on the Lea goes. Pure (no three.js).
//
// Drainage, not drawing. Every cell of a coarse grid drains to the neighbour
// it spills into on the way to the map's edge (a priority flood from the edge
// inward — the standard way hydrologists route water over a heightfield with
// hollows in it), and the area each cell gathers is summed down that tree.
// Where enough land drains through one place, there is a river. So rivers lie
// in the valleys, link the lakes into chains (a lake fills, spills over its
// lowest rim, and the spill is the next river), and leave the Lea at its edge.
//
// Every river sits at the lakes' level. The Lea is lowland — a Biebrza of
// wetland and meres — and its rivers are the slow kind that barely fall; the
// channel is cut down to the water plane, a few units at most, so everything
// that already knows about water (walking, the folk's routes, canoes, fishing,
// the reeds, the minimap) knows the rivers too. land.js carves the channel and
// its banks; see carve() there for the bank's shape.
//
// The grid route is stair-stepped and runs ruler-straight over flats, so each
// reach is rounded and then set meandering, more where the ground is flat and
// the river big, never far onto higher ground.

import { mulberry32 } from '../rng.js';

const CELL = 8;
export const CATCH = 96000;     // u² of land draining through a place before it's a river (a square ~310u a side)
const MAXW = 9;                 // the widest a river gets (half-width, u): 18u ≈ 12 m
const D8 = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

// half-width from the area drained: a brook at the threshold, a broad river far down
export const widthOf = acc => Math.min(MAXW, 2.2 + 1.5 * Math.sqrt(acc / CATCH));

export function planRivers({ size, seed, height, water }){
  const half = size / 2, G = Math.round(size / CELL) + 1, X = c => c * CELL - half;
  const N = G * G, h = new Float32Array(N);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) h[j * G + i] = Math.max(height(X(i), X(j)), water);
  const lake = k => h[k] <= water;

  // priority flood from the edges: par = the cell each drains into
  const par = new Int32Array(N).fill(-1), seen = new Uint8Array(N), order = new Int32Array(N);
  const heap = new Int32Array(N + 8), hk = new Float64Array(N + 8);
  let hn = 0, on = 0, ctr = 0;
  const push = (n, f) => {
    f = f * 1e7 + (ctr++) * 1e-4;                  // ties go first-come, so flats drain in order
    let k = hn++;
    while (k > 0){ const p = (k - 1) >> 1; if (hk[p] <= f) break; heap[k] = heap[p]; hk[k] = hk[p]; k = p; }
    heap[k] = n; hk[k] = f;
  };
  const pop = () => {
    const top = heap[0], ln = heap[--hn], lf = hk[hn];
    let k = 0;
    for (;;){
      let c = 2 * k + 1; if (c >= hn) break;
      if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lf) break;
      heap[k] = heap[c]; hk[k] = hk[c]; k = c;
    }
    heap[k] = ln; hk[k] = lf;
    return top;
  };
  const fill = new Float32Array(N);
  for (let i = 0; i < G; i++) for (const k of [i, (G - 1) * G + i, i * G, i * G + G - 1])
    if (!seen[k]){ seen[k] = 1; fill[k] = h[k]; push(k, h[k]); }
  while (hn){
    const n = pop(); order[on++] = n;
    const i = n % G, j = (n / G) | 0;
    for (const [di, dj] of D8){
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= G || jj >= G) continue;
      const m = jj * G + ii;
      if (seen[m]) continue;
      seen[m] = 1; par[m] = n; fill[m] = Math.max(h[m], fill[n]); push(m, fill[m]);
    }
  }
  // the area each cell gathers, summed from the top of the tree down
  const acc = new Float32Array(N).fill(CELL * CELL);
  for (let q = on - 1; q >= 0; q--){ const n = order[q]; if (par[n] >= 0) acc[par[n]] += acc[n]; }
  const riv = k => acc[k] >= CATCH && !lake(k);

  // where reaches start: a spring (no river comes in) or a lake's outlet (a big lake cell drains in)
  const rivIn = new Uint8Array(N), lakeIn = new Int32Array(N).fill(-1);
  for (let k = 0; k < N; k++){
    const p = par[k];
    if (p < 0 || !riv(p)) continue;
    if (riv(k)) rivIn[p] = 1;
    else if (lake(k) && acc[k] >= CATCH && (lakeIn[p] < 0 || acc[k] > acc[lakeIn[p]])) lakeIn[p] = k;
  }
  const starts = [];
  for (let k = 0; k < N; k++) if (riv(k) && (!rivIn[k] || lakeIn[k] >= 0)) starts.push(k);
  starts.sort((a, b) => acc[b] - acc[a]);           // the outlets of big lakes first, so the main stems are whole

  const taken = new Int32Array(N).fill(-1), raw = [];
  for (const k0 of starts){
    if (taken[k0] >= 0) continue;
    const id = raw.length, cells = [];
    const spring = lakeIn[k0] < 0;
    if (!spring) cells.push(lakeIn[k0]);
    let k = k0, end = 'edge';
    for (;;){
      cells.push(k); taken[k] = id;
      const p = par[k];
      if (p < 0){ end = 'edge'; break; }
      if (lake(p)){ cells.push(p); end = 'lake'; break; }
      if (taken[p] >= 0){ cells.push(p); end = 'join'; break; }
      k = p;
    }
    raw.push({ cells, spring, end });
  }

  // round each reach, then let it meander
  const rng = mulberry32(seed >>> 0);
  const reaches = [];
  for (const r of raw){
    if (r.cells.length < 3) continue;
    let pts = r.cells.map(k => [X(k % G), X((k / G) | 0), acc[k]]);
    // carry the drained area through the rounding; a lake cell's own count is the whole lake's, so take the river's
    if (!r.spring) pts[0][2] = pts[1][2];
    pts[pts.length - 1][2] = pts[pts.length - 2][2];
    for (let it = 0; it < 3; it++){
      const o = [pts[0]];
      for (let q = 0; q + 1 < pts.length; q++){
        const a = pts[q], b = pts[q + 1];
        if (q > 0) o.push(a.map((v, j) => v * 0.75 + b[j] * 0.25));
        if (q + 2 < pts.length) o.push(a.map((v, j) => v * 0.25 + b[j] * 0.75));
      }
      o.push(pts[pts.length - 1]);
      pts = o;
    }
    pts = resample(pts, 4);
    // meander: a sideways wander along the reach, its wavelength ~14 widths, its reach ~1.3 widths,
    // fading out toward both ends so a reach still meets its lake or the river it joins
    const n = pts.length, L = (n - 1) * 4;
    const ph = [rng() * 6.283, rng() * 6.283, rng() * 6.283];
    const off = new Float32Array(n);
    for (let q = 0; q < n; q++){
      const s = q * 4, w = widthOf(pts[q][2]), lam = 14 * w;
      const env = Math.min(1, s / 40, (L - s) / 40);
      off[q] = env * 1.3 * w * (0.6 * Math.sin(s / lam * 6.283 + ph[0]) + 0.3 * Math.sin(s / lam * 2.7 * 6.283 + ph[1]) + 0.25 * Math.sin(s / lam * 0.43 * 6.283 + ph[2]));
    }
    const moved = pts.map((p, q) => {
      const a = pts[Math.max(0, q - 1)], b = pts[Math.min(n - 1, q + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
      // never wander onto ground more than a little higher than the valley floor
      let o = off[q];
      const h0 = height(p[0], p[1]);
      for (let t = 0; t < 4 && Math.abs(o) > 0.5; t++){ if (height(p[0] + nx * o, p[1] + nz * o) <= Math.max(h0, water) + 1.2) break; o *= 0.5; }
      return [p[0] + nx * o, p[1] + nz * o, p[2]];
    });
    pts = resample(smooth3(moved), 3);
    reaches.push(finish(pts, r));
  }
  return { reaches, catchment: CATCH };
}

// a polyline of [x, z, acc] resampled to even steps
function resample(pts, step){
  const out = [pts[0]];
  let carry = 0;
  for (let q = 0; q + 1 < pts.length; q++){
    const a = pts[q], b = pts[q + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - carry;
    while (s <= len){ const t = s / len; out.push(a.map((v, j) => v + (b[j] - v) * t)); s += step; }
    carry = len - (s - step);
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last); else out[out.length - 1] = last;
  return out;
}
function smooth3(p){
  return p.map((v, q) => q === 0 || q === p.length - 1 ? v
    : v.map((c, j) => (p[q - 1][j] + 2 * c + p[q + 1][j]) / 4));
}

// the reach as arrays: centre line, half-width, signed curvature (+ turning left), distance along
function finish(pts, r){
  const n = pts.length, xs = new Float32Array(n), zs = new Float32Array(n), ws = new Float32Array(n), ks = new Float32Array(n), ss = new Float32Array(n);
  for (let q = 0; q < n; q++){ xs[q] = pts[q][0]; zs[q] = pts[q][1]; if (q) ss[q] = ss[q - 1] + Math.hypot(xs[q] - xs[q - 1], zs[q] - zs[q - 1]); }
  const L = ss[n - 1];
  for (let q = 0; q < n; q++){
    let w = widthOf(pts[q][2]);
    if (r.spring) w *= 0.4 + 0.6 * Math.min(1, ss[q] / 90);      // a spring starts as a brook
    ws[q] = w;
    // turning angle over ±3 samples, per unit length
    const a = Math.max(0, q - 3), b = Math.min(n - 1, q + 3);
    if (b - a >= 2){
      const m = q === a ? a + 1 : q === b ? b - 1 : q;
      const h1 = Math.atan2(zs[m] - zs[a], xs[m] - xs[a]), h2 = Math.atan2(zs[b] - zs[m], xs[b] - xs[m]);
      let d = h2 - h1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      ks[q] = d / Math.max(1, ss[b] - ss[a]);
    }
  }
  // a little smoothing of the curvature, so bars and cut banks don't flicker
  const k2 = ks.map((v, q) => (ks[Math.max(0, q - 2)] + ks[Math.max(0, q - 1)] + v + ks[Math.min(n - 1, q + 1)] + ks[Math.min(n - 1, q + 2)]) / 5);
  return { xs, zs, ws, ks: k2, ss, length: L, spring: r.spring, end: r.end };
}
