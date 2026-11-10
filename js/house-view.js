// Draws what js/gen/house.js decided (docs/houses.md). Everything a building has is
// made of ranges: a range is one roof over the walls beneath it, so a house, its
// chamber wing, its porch and a barn's wagon porch are the same thing at different
// sizes (116 CASCADE OF ROOFS). No three.js here: it writes into the per-material
// Geo buffers settle-view.js hands it, so a node check can count what it draws.

import { KINDS } from './gen/settle.js';
import { UNITS_PER_M } from './config.js';
import { mulberry32 } from './rng.js';

const M = UNITS_PER_M;
const TILE = 2 * M;
const SINK = 0.4;                // walls run this far below the pad
const PART_SINK = 1.3;           // a part stands past the pad's level middle, on its feathered edge
const Z = [0, 0];
const TIMBER = [0.36, 0.27, 0.18], TIMBER_OLD = [0.25, 0.20, 0.15], SHUTTER = [0.27, 0.20, 0.13];
const STONE = [0.56, 0.54, 0.50], WIN_DARK = [0.035, 0.028, 0.022];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerp = (a, b, t) => a + (b - a) * t;
const shade = (c, k) => c.map(v => v * k);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A timber lying on a surface: its face stands `proud` out along `out`, and its two
// edges close back to the surface. Six triangles; the far side never shows.
function beam(G, a, b, w, proud, out, col){
  const dir = sub(b, a), len = Math.hypot(...dir);
  if (len < 1e-3) return;
  const n = norm(out), side = norm(cross(dir, n));
  const s = [side[0] * w / 2, side[1] * w / 2, side[2] * w / 2];
  const a0 = sub(a, s), a1 = add(a, s), b0 = sub(b, s), b1 = add(b, s);
  const a0p = add(a0, n, proud), a1p = add(a1, n, proud), b0p = add(b0, n, proud), b1p = add(b1, n, proud);
  const u1 = len / TILE, v1 = w / TILE;
  G.quad(a0p, b0p, b1p, a1p, [0, 0], [u1, 0], [u1, v1], [0, v1], n, col);
  const dark = shade(col, 0.78);
  G.quad(a0, b0, b0p, a0p, [0, 0], [u1, 0], [u1, v1], [0, v1], [-side[0], -side[1], -side[2]], dark);
  G.quad(a1, b1, b1p, a1p, [0, 0], [u1, 0], [u1, v1], [0, v1], side, dark);
}

// ---- a range ------------------------------------------------------------------------
// In its own frame: s along the ridge, w across, +w the front. spec:
//   U, V, turn       where it stands in the building's frame; turn 1 runs its ridge across the house
//   s0, s1, wf, wr   walls at s0 and s1, the front wall at +wf, the rear at -wr
//   E, Eo, pitch     wall-plate height, height of any aisle's plate, tan of the roof pitch
//   fOd, rOd         how much of the width is an aisle or outshot under a lower roof, front and rear
//   ends             [at s0, at s1]: 'gable', 'half', 'hip' or 'none' (runs into another roof)
//   over             how far the roof passes the walls
function makeRange(frame, spec){
  const c = spec.turn ? 0 : 1, sn = spec.turn ? 1 : 0;
  const L = (s, w, y) => frame.P(spec.U + c * s - sn * w, spec.V + sn * s + c * w, y);
  const O = (s, w, y = 0) => frame.out(c * s - sn * w, sn * s + c * w, y);
  const { wf, wr, E, pitch, fOd = 0, rOd = 0, Eo = E, over } = spec;
  const bodyF = wf - fOd, bodyR = -wr + rOd, wc = (bodyF + bodyR) / 2, bw = (bodyF - bodyR) / 2, Y = E + bw * pitch;
  // each slope as a polyline of (w, y) from lip to ridge
  const slope = (wall, body, dirn, od) => {
    const pts = [[wc, Y], [body, E]];
    if (od){ const k = (E - Eo) / od; pts.push([wall, Eo], [wall + dirn * over, Eo - over * Math.min(k, pitch)]); }
    else pts.push([wall + dirn * over, E - over * pitch]);
    return pts.reverse();
  };
  const polys = { 1: slope(wf, bodyF, 1, fOd), [-1]: slope(-wr, bodyR, -1, rOd) };
  const wAt = (side, y) => {
    const p = polys[side];
    if (y <= p[0][1]) return p[0][0];
    for (let i = 1; i < p.length; i++) if (y <= p[i][1]){ const t = (y - p[i - 1][1]) / (p[i][1] - p[i - 1][1] || 1); return lerp(p[i - 1][0], p[i][0], t); }
    return wc;
  };
  return { spec, L, O, wc, bw, Y, bodyF, bodyR, wAt, polys, c, sn };
}

// Height of the half-hip's or hip's foot at one end.
function hipFoot(R, kind){
  const { spec, Y } = R;
  if (kind === 'hip') return Math.max(R.polys[1][0][1], R.polys[-1][0][1]);
  if (kind === 'half') return lerp(spec.E, Y, 0.56);
  return Infinity;
}

// The roof: two slopes as smooth grids that sag and swell, hipped ends, a thick lip, a ridge.
function drawRoof(G, R, roofKey, opt){
  const { spec, L, O, wc, Y, wAt, polys } = R, RF = G[roofKey], thatch = roofKey === 'thatch';
  const { s0, s1, ends } = spec, ov = spec.overGable;
  const sm = (s0 + s1) / 2, sh = (s1 - s0) / 2 + ov;
  const footA = hipFoot(R, ends[0]), footB = hipFoot(R, ends[1]);
  const hipRun = foot => foot === Infinity ? 0 : (Y - foot) / (R.spec.pitch * 1.05);
  const runA = hipRun(footA), runB = hipRun(footB);
  const endA = ends[0] === 'none' ? s0 : s0 - ov, endB = ends[1] === 'none' ? s1 : s1 + ov;
  const sAt = (y, e) => e === 0
    ? (ends[0] === 'none' ? s0 : s0 - ov + (y > footA ? runA * (y - footA) / (Y - footA) : 0))
    : (ends[1] === 'none' ? s1 : s1 + ov - (y > footB ? runB * (y - footB) / (Y - footB) : 0));
  const y0 = Math.min(polys[1][0][1], polys[-1][0][1]);
  const swell = thatch ? 0.09 : 0.015;
  const eb = opt.eyebrow, sweep = opt.sweep;
  // how the surface leaves the plane: settling, the swell of straw, the lift over a door, an eyebrow
  const disp = (side, s, y) => {
    const t = Math.max(0, (y - y0) / (Y - y0)), q = (s - sm) / sh;
    let d = -(spec.sag || 0) * Math.pow(t, 0.7) * (1 - q * q);
    d += swell * Math.sin(Math.PI * Math.min(1, t * 1.05));
    if (side === 1 && sweep){
      const g = Math.exp(-Math.pow((s - sweep.u) / sweep.w, 2));
      d += sweep.lift * g * Math.pow(Math.max(0, 1 - (y - y0) / sweep.h), 1.4);
    }
    if (side === 1 && eb){
      const g = Math.exp(-Math.pow((s - eb.u) / eb.ws, 2)), dy = y - eb.y;
      d += eb.lift * g * Math.exp(-dy * dy / (dy < 0 ? eb.below : eb.above));
    }
    return d;
  };
  const rows = side => {
    const ys = new Set();
    const pts = polys[side];
    for (let i = 1; i < pts.length; i++){
      const a = pts[i - 1][1], b = pts[i][1], n = Math.max(1, Math.round((b - a) / 0.62));
      for (let k = 0; k < n; k++) ys.add(lerp(a, b, k / n));
    }
    ys.add(Y);
    if (footA !== Infinity && footA > pts[0][1]) ys.add(footA);
    if (footB !== Infinity && footB > pts[0][1]) ys.add(footB);
    if (side === 1 && eb) for (const d of [-0.5, -0.3, -0.12, 0, 0.3, 0.7, 1.1]) ys.add(eb.y + d);
    return [...ys].filter(y => y >= pts[0][1] && y <= Y).sort((a, b) => a - b);
  };
  const nS = Math.max(3, Math.round((endB - endA) / 1.05));
  const base = opt.color;
  const colorAt = (side, s, y) => {
    const t = (y - y0) / (Y - y0), n = Math.sin(s * 1.3 + side * 2.1 + opt.seed) * Math.sin(y * 2.3 + s * 0.4 + opt.seed * 2);
    let col = shade(base, 0.86 + 0.12 * Math.min(1, t * 2.4) - (t > 0.82 ? (t - 0.82) * 0.7 : 0));
    if (thatch){
      // north-facing thatch stays damp and goes green first; older roofs are greyer
      const m = opt.moss * (side === opt.coldSide ? 1 : 0.35) * Math.max(0, n * 0.8 + 0.35 + (0.55 - Math.min(1, t * 1.4)) * 0.45);
      col = mix(col, [0.34, 0.40, 0.20], Math.min(0.72, m));
    } else col = shade(col, 0.92 + n * 0.08);
    const p = opt.patch;
    if (p && p.side === side){
      const a = Math.max(0, 1 - Math.pow(Math.abs(s - p.u) / p.hu, 4)) * ((t > p.t0 && t < p.t1) ? 1 : 0);
      col = mix(col, [1.14, 1.02, 0.68], a * 0.9);
    }
    return col;
  };
  for (const side of [1, -1]){
    const ys = rows(side), pts = [], uv = [], col = [];
    let run = 0;
    ys.forEach((y, i) => {
      if (i){ const dw = wAt(side, y) - wAt(side, ys[i - 1]); run += Math.hypot(dw, y - ys[i - 1]); }
      const a = sAt(y, 0), b = sAt(y, 1), row = [], ru = [], rc = [];
      for (let j = 0; j <= nS; j++){
        const s = lerp(a, b, j / nS);
        row.push(L(s, wAt(side, y), y + disp(side, s, y)));
        ru.push([s / TILE, run / TILE]); rc.push(colorAt(side, s, y));
      }
      pts.push(row); uv.push(ru); col.push(rc);
    });
    RF.grid(pts, uv, col, O(0, side * spec.pitch, 1));
    // the thick lip of the straw (or the shingle's edge), along the eaves
    const th = (thatch ? 0.27 : 0.07) * M, lip = pts[0], lipCol = shade(base, thatch ? 0.5 : 0.55);
    for (let j = 0; j < nS; j++){
      const a = lip[j], b = lip[j + 1];
      RF.quad([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], b, a, [0, 0], [0.3, 0], [0.3, 0.12], [0, 0.12], O(0, side), lipCol);
    }
    // the verges, and the hip's two half-faces
    for (const e of [0, 1]){
      const kind = ends[e], foot = e ? footB : footA, dirn = e ? 1 : -1;
      if (kind === 'none') continue;
      const edgeJ = e ? nS : 0;
      for (let i = 0; i < ys.length - 1; i++){
        if (ys[i] >= foot) break;
        const a = pts[i][edgeJ], b = pts[i + 1][edgeJ];
        RF.quad([a[0], a[1] - th, a[2]], [b[0], b[1] - th, b[2]], b, a, [0, 0], [0.3, 0], [0.3, 0.12], [0, 0.12], O(dirn, 0), shade(base, thatch ? 0.52 : 0.6));
      }
      if (kind === 'gable' && !thatch) continue;
      if (foot === Infinity) continue;
      const fi = ys.findIndex(y => y >= foot - 1e-6);
      if (fi < 0) continue;
      const fp = [], fu = [], fc = [];
      for (let i = fi; i < ys.length; i++){
        const s = sAt(ys[i], e), y = ys[i], dy = disp(side, s, y);
        fp.push([L(s, wAt(side, y), y + dy), L(s, wc, y + dy)]);
        fu.push([[wAt(side, y) / TILE, y / TILE], [wc / TILE, y / TILE]]);
        const tone = colorAt(side, s, y);
        fc.push([tone, tone]);
      }
      if (fp.length > 1){
        RF.grid(fp, fu, fc, O(dirn * 0.7, side * 0.3, 1));
        // the hip's foot: the same thick lip
        const q0 = fp[0][0], q1 = fp[0][1];
        RF.quad([q0[0], q0[1] - th, q0[2]], [q1[0], q1[1] - th, q1[2]], q1, q0, [0, 0], [0.3, 0], [0.3, 0.12], [0, 0.12], O(dirn, 0), shade(base, thatch ? 0.5 : 0.6));
        // the roll over the hip's arris
        if (thatch) for (let i = 0; i < fp.length - 1; i++){
          const a = fp[i][0], b = fp[i + 1][0], rise = 0.09;
          const out = O(dirn * 0.5, side * 0.5, 1);
          RF.quad(add(a, [0, rise, 0]), add(b, [0, rise, 0]), add(b, O(-dirn, 0), 0.28), add(a, O(-dirn, 0), 0.28), [0, 0], [0.2, 0], [0.2, 0.1], [0, 0.1], out, shade(base, 1.04));
          RF.quad(add(a, [0, rise, 0]), add(b, [0, rise, 0]), add(b, O(0, -side), 0.28), add(a, O(0, -side), 0.28), [0, 0], [0.2, 0], [0.2, 0.1], [0, 0.1], out, shade(base, 1.04));
        }
      }
    }
  }
  // the ridge
  const ra = sAt(Y, 0), rb = sAt(Y, 1);
  if (rb - ra > 0.05){
    const crest = (s) => Y + disp(1, s, Y) + (thatch ? 0.13 : 0.05);
    const style = thatch ? opt.ridge : 'board';
    const per = 0.72, n = Math.max(2, Math.round((rb - ra) / per));
    const capCol = thatch ? shade(base, 1.14) : [0.42, 0.36, 0.30];
    const depth = thatch ? 0.62 * M : 0.14 * M;
    const low = (k) => style === 'point' ? (k % 2 ? 1 : 0.62) : style === 'scallop' ? (k % 2 ? 0.74 : 1) : 1;
    for (const side of [1, -1]){
      for (let k = 0; k < n; k++){
        const a = lerp(ra, rb, k / n), b = lerp(ra, rb, (k + 1) / n);
        const ya = Y - depth * low(k), yb = Y - depth * low(k + 1);
        const p = [L(a, wc, crest(a)), L(b, wc, crest(b)), L(b, wAt(side, yb), yb + disp(side, b, yb) + 0.08), L(a, wAt(side, ya), ya + disp(side, a, ya) + 0.08)];
        RF.quad(p[0], p[1], p[2], p[3], [a / TILE, 0.5], [b / TILE, 0.5], [b / TILE, 0.2], [a / TILE, 0.2], O(0, side * spec.pitch, 1), capCol);
      }
      if (thatch){
        // two lines of hazel spars pin the ridge down (liggers)
        const yl = Y - depth * 0.34;
        for (let k = 0; k < n; k++){
          const a = lerp(ra, rb, k / n), b = lerp(ra, rb, (k + 1) / n);
          const out = O(0, side * spec.pitch, 1), pa = L(a, wAt(side, yl), yl + disp(side, a, yl) + 0.12), pb = L(b, wAt(side, yl), yl + disp(side, b, yl) + 0.12);
          beam(G.timber, pa, pb, 0.045 * M, 0.015, out, [0.60, 0.50, 0.32]);
        }
      }
    }
  }
  return { ridge: [ra, rb], crest: s => Y + disp(1, s, Y) + (thatch ? 0.13 : 0.05) };
}

// The wall below one slope, seen end-on: a polygon of (w, y) under the roof, up to `top`.
function endPolygon(R, foot, y0){
  const { spec, wAt, polys, wc, Y } = R;
  const top = Math.min(Y, foot === Infinity ? Y : Math.max(foot, spec.E));
  const out = [[-spec.wr, y0]];
  const up = side => polys[side].slice(1).filter(p => p[1] <= top - 1e-4).map(p => [p[0], p[1]]);
  const rear = up(-1), front = up(1);
  out.push(...rear);
  if (top >= Y - 1e-4) out.push([wc, Y]);
  else out.push([wAt(-1, top), top], [wAt(1, top), top]);
  out.push(...front.reverse());
  out.push([spec.wf, y0]);
  return out;
}

// Walls and, for the framed dialect, the frame: 205, and its posts line up with the bays.
function drawWalls(G, R, form, opt){
  const { spec, L, O, wc, Y } = R, { s0, s1, wf, wr, E, Eo = E, fOd = 0, rOd = 0 } = spec;
  const key = opt.wall, W = G[key], T = G.timber, y0 = opt.y0, floor = opt.floor;
  const framed = key === 'daub', wash = opt.wash || [1, 1, 1], stain = shade(wash, 0.74);
  const tone = (k = 1) => key === 'daub' ? shade(wash, k) : [opt.tint * k, opt.tint * k, opt.tint * k];
  const timber = mix(TIMBER, TIMBER_OLD, form.age || 0);
  const proud = 0.055 * M, tw = 0.15 * M, r = opt.r;
  const lines = opt.lines && opt.lines.length ? opt.lines : [s0, s1];
  const yRail = floor + 1.02 * M, ySill = floor + 0.42 * M, yPlint = floor + 0.42 * M;

  const longWall = (side, w, top) => {
    const open = (opt.open && opt.open[side]) || [];
    const clipped = lines.filter(u => u >= s0 - 1e-6 && u <= s1 + 1e-6);
    if (clipped[0] > s0 + 1e-3) clipped.unshift(s0);
    if (clipped[clipped.length - 1] < s1 - 1e-3) clipped.push(s1);
    const out = O(0, side);
    for (let i = 0; i < clipped.length - 1; i++){
      const a = clipped[i], b = clipped[i + 1], k = 0.95 + r() * 0.08;
      const yS = Math.min(top, floor + (key === 'daub' ? 0.72 : 0.42) * M);
      const fine = key === 'stone' ? 1.6 : 1, uv = (s, y) => [s * fine / TILE, (y - y0) * fine / TILE];
      W.quad(L(a, w, y0), L(b, w, y0), L(b, w, yS), L(a, w, yS), uv(a, y0), uv(b, y0), uv(b, yS), uv(a, yS), out, key === 'daub' ? stain : tone(k * 0.82));
      W.quad(L(a, w, yS), L(b, w, yS), L(b, w, top - 0.12), L(a, w, top - 0.12), uv(a, yS), uv(b, yS), uv(b, top), uv(a, top), out, tone(k));
    }
    // the stone sill it stands on
    if (key !== 'stone' && !opt.noPlinth){
      const P = 0.07 * M, u0 = 0, top2 = key === 'boards' ? floor + 0.28 * M : yPlint;
      G.stone.quad(L(s0 - P, w + side * P, y0), L(s1 + P, w + side * P, y0), L(s1 + P, w + side * P, top2), L(s0 - P, w + side * P, top2), [s0 * 2 / TILE, u0], [s1 * 2 / TILE, u0], [s1 * 2 / TILE, 0.72], [s0 * 2 / TILE, 0.72], out, STONE);
      G.stone.quad(L(s0 - P, w + side * P, top2), L(s1 + P, w + side * P, top2), L(s1 + P, w, top2 + 0.02), L(s0 - P, w, top2 + 0.02), Z, Z, Z, Z, [0, 1, 0], shade(STONE, 1.1));
    }
    if (framed){
      const fw = w + side * 0.01;
      beam(T, L(s0, fw, ySill), L(s1, fw, ySill), tw * 1.2, proud, out, timber);
      beam(T, L(s0, fw, top - tw * 1.5), L(s1, fw, top - tw * 1.5), tw * 1.15, proud, out, timber);
      // a rail, broken at openings that come down through it
      const stops = open.filter(o => o.door).sort((p, q) => p.s0 - q.s0);
      let at = s0;
      for (const o of stops){ if (o.s0 > at) beam(T, L(at, fw, yRail), L(o.s0, fw, yRail), tw * 0.8, proud * 0.9, out, timber); at = Math.max(at, o.s1); }
      if (at < s1) beam(T, L(at, fw, yRail), L(s1, fw, yRail), tw * 0.8, proud * 0.9, out, timber);
      clipped.forEach(s => {
        const inOpen = open.some(o => o.door && s > o.s0 - 0.02 && s < o.s1 + 0.02);
        if (!inOpen) beam(T, L(s, fw, ySill), L(s, fw, top - tw), tw * 1.25, proud, out, timber);
      });
      // studs between, wherever nothing is cut through
      const st = opt.studs || 1.1 * M;
      for (let i = 0; i < clipped.length - 1; i++){
        const a = clipped[i], b = clipped[i + 1], n = Math.floor((b - a) / st);
        for (let k = 1; k <= n; k++){
          const s = a + (b - a) * k / (n + 1) + (r() - 0.5) * 0.04 * M;
          const hit = open.find(o => s > o.s0 - tw && s < o.s1 + tw);
          if (hit && hit.door) continue;
          if (hit){
            beam(T, L(s, fw, ySill), L(s, fw, yRail), tw * 0.65, proud * 0.8, out, timber);
            continue;
          }
          beam(T, L(s, fw, ySill), L(s, fw, top - tw), tw * 0.65, proud * 0.8, out, timber);
        }
      }
      // curved braces in the end panels, the frame's own ornament: they stiffen the corners
      for (const [a, b] of [[clipped[0], clipped[1]], [clipped[clipped.length - 1], clipped[clipped.length - 2]]]){
        if (open.some(o => (o.s0 < Math.max(a, b) && o.s1 > Math.min(a, b)) && o.door)) continue;
        const span = Math.min(Math.abs(b - a) * 0.6, 1.5 * M), dir = Math.sign(b - a);
        const pts = [0, 0.33, 0.66, 1].map(t => [a + dir * span * t, yRail + (top - tw * 1.5 - yRail) * (1 - Math.pow(1 - t, 1.6))]);
        const bend = pts.map(([s, y]) => L(s, fw, y));
        for (let i = 0; i < 3; i++) beam(T, bend[i], bend[i + 1], tw * 0.72, proud * 0.85, out, shade(timber, 0.94));
      }
    } else if (key === 'boards'){
      // a working building shows its posts and a plate; the boards do the rest
      beam(T, L(s0, w, top - tw * 1.4), L(s1, w, top - tw * 1.4), tw, proud * 0.8, out, shade(timber, 0.9));
      for (const s of clipped) beam(T, L(s, w, floor + 0.28 * M), L(s, w, top - tw), tw, proud * 0.8, out, shade(timber, 0.9));
    }
  };
  const endWall = (e, foot) => {
    if (spec.ends[e] === 'none' && !opt.closeNone) return;
    const s = e ? s1 : s0, dirn = e ? 1 : -1, out = O(dirn, 0);
    const poly = endPolygon(R, foot, y0), cw = (wf - wr) / 2;
    const fine = key === 'stone' ? 1.6 : 1, uv = p => [p[0] * fine / TILE, (p[1] - y0) * fine / TILE];
    const C = [cw, y0];
    for (let i = 0; i < poly.length - 1; i++){
      const a = poly[i], b = poly[i + 1];
      W.tri(L(s, C[0], C[1]), L(s, a[0], a[1]), L(s, b[0], b[1]), uv(C), uv(a), uv(b), out, tone(0.97));
    }
    if (key !== 'stone' && !opt.noPlinth){
      const P = 0.07 * M, top2 = key === 'boards' ? floor + 0.28 * M : yPlint, sP = s + dirn * P;
      G.stone.quad(L(sP, -wr - P, y0), L(sP, wf + P, y0), L(sP, wf + P, top2), L(sP, -wr - P, top2), [-wr * 2 / TILE, 0], [wf * 2 / TILE, 0], [wf * 2 / TILE, 0.72], [-wr * 2 / TILE, 0.72], out, STONE);
      G.stone.quad(L(sP, -wr - P, top2), L(sP, wf + P, top2), L(s, wf + P, top2 + 0.02), L(s, -wr - P, top2 + 0.02), Z, Z, Z, Z, [0, 1, 0], shade(STONE, 1.1));
    }
    if (framed){
      const fs = s + dirn * 0.01;
      const low = spec.rOd ? Eo : E;
      beam(T, L(fs, -wr, ySill), L(fs, wf, ySill), tw * 1.2, proud, out, timber);
      beam(T, L(fs, -wr, low - 0.05), L(fs, -wr, ySill), tw * 1.2, proud, out, timber);
      beam(T, L(fs, wf, E - 0.05), L(fs, wf, ySill), tw * 1.2, proud, out, timber);
      if (rOd) beam(T, L(fs, -wr, Eo), L(fs, R.bodyR, E), tw * 0.8, proud, out, timber);
      const yTie = E - tw * 0.3;
      beam(T, L(fs, R.bodyR, yTie), L(fs, wf, yTie), tw * 1.1, proud, out, timber);
      const top = foot === Infinity ? Y : Math.max(foot, E);
      // a cruck frame is two great curved blades, ground to ridge; a box frame a post and a collar
      if (opt.cruck && spec.ends[e] === 'gable'){
        for (const side of [-1, 1]){
          const foots = side < 0 ? R.bodyR : wf;
          const inset = tw * 1.9, p0 = [foots - side * 0.02, floor], p1 = [foots - side * inset * 1.4, E - inset], p2 = [wc + side * 0.03 * M, Y - inset * 2.2];
          const pts = [];
          for (let k = 0; k <= 6; k++){
            const t = k / 6, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
            pts.push(L(fs, a * p0[0] + b * p1[0] + d * p2[0], a * p0[1] + b * p1[1] + d * p2[1]));
          }
          for (let k = 0; k < 6; k++) beam(T, pts[k], pts[k + 1], tw * 1.7, proud * 1.2, out, TIMBER_OLD);
        }
        const yc = lerp(E, Y, 0.44), half = (Y - yc) / spec.pitch * 1.08;
        beam(T, L(fs, wc - half, yc), L(fs, wc + half, yc), tw, proud * 1.1, out, TIMBER_OLD);
      } else {
        beam(T, L(fs, wc, yTie), L(fs, wc, top - tw * 1.6), tw * 1.05, proud, out, timber);
        const yc = lerp(E, Math.min(top, Y), 0.52);
        const hc = (Y - yc) / spec.pitch;
        if (foot === Infinity) beam(T, L(fs, wc - hc, yc), L(fs, wc + hc, yc), tw * 0.8, proud, out, timber);
        // the raking studs between ties and rafters
        beam(T, L(fs, wc, yTie), L(fs, wc - bwAt(R, yTie) * 0.5, lerp(yTie, top, 0.5)), tw * 0.65, proud * 0.8, out, timber);
        beam(T, L(fs, wc, yTie), L(fs, wc + bwAt(R, yTie) * 0.5, lerp(yTie, top, 0.5)), tw * 0.65, proud * 0.8, out, timber);
      }
    }
  };
  if (!opt.noWalls){
    longWall(1, wf, fOd ? Eo : E);
    longWall(-1, -wr, rOd ? Eo : E);
    endWall(0, hipFoot(R, spec.ends[0]));
    endWall(1, hipFoot(R, spec.ends[1]));
    if (key === 'logs') logEnds(G, R, opt);
    if (key === 'stone') quoins(G, R, opt);
  }
}
const bwAt = (R, y) => Math.max(0, (R.Y - y) / R.spec.pitch);
// a log house's corners: the ends crossing past each other
function logEnds(G, R, opt){
  const { spec, L, O } = R, { s0, s1, wf, wr, E, Eo = E, rOd = 0, fOd = 0 } = spec, T = G.timber, st = 0.5 * M;
  for (const [s, w, ds, dw] of [[s0, wf, -1, 1], [s1, wf, 1, 1], [s0, -wr, -1, -1], [s1, -wr, 1, -1]])
    for (let y = opt.floor + 0.15 * M; y < ((dw > 0 ? fOd : rOd) ? Eo : E) - 0.1 * M; y += st){
      const q = 0.2 * M;
      beam(T, L(s, w, y), L(s + ds * q, w, y), st * 0.42, q * 0.4, O(0, dw), [0.42, 0.33, 0.22]);
      beam(T, L(s, w, y + st * 0.5), L(s, w + dw * q, y + st * 0.5), st * 0.42, q * 0.4, O(ds, 0), [0.42, 0.33, 0.22]);
    }
}
// a stone house's corners: larger blocks, turned long and short
function quoins(G, R, opt){
  const { spec, L, O } = R, { s0, s1, wf, wr, E, Eo = E, rOd = 0, fOd = 0 } = spec, T = G.detail, st = 0.33 * M;
  let k = 0;
  for (let y = opt.floor; y < E - 0.15 * M; y += st, k++){
    const l = (k % 2 ? 0.55 : 0.3) * M, m = (k % 2 ? 0.3 : 0.55) * M, col = shade([0.40, 0.385, 0.35], 1 + (k % 3) * 0.05);
    for (const [s, ds] of [[s0, 1], [s1, -1]]) for (const [w, dw] of [[wf, -1], [-wr, 1]]){
      if (y >= ((dw < 0 ? fOd : rOd) ? Eo : E) - 0.15 * M) continue;
      const hi = y + st * 0.84;
      T.quad(L(s, w - dw * 0.03, y), L(s + ds * l, w - dw * 0.03, y), L(s + ds * l, w - dw * 0.03, hi), L(s, w - dw * 0.03, hi), Z, Z, Z, Z, O(0, -dw), col);
      T.quad(L(s - ds * 0.03, w, y), L(s - ds * 0.03, w + dw * m, y), L(s - ds * 0.03, w + dw * m, hi), L(s - ds * 0.03, w, hi), Z, Z, Z, Z, O(-ds, 0), col);
    }
  }
}

// ---- openings -----------------------------------------------------------------------
// A window: an opening that glows from inside, with mullions, a frame and its shutters
// folded back. Vertices in G.windows are what settle-view's lamplight recolours.
function drawWindow(G, R, side, s, y, w, h, key, opts = {}){
  const { L, O } = R, ww = side > 0 ? R.spec.wf : -R.spec.wr;
  const v = ww + side * 0.1, out = O(0, side), T = G.timber;
  const seat = opts.at == null ? v : opts.at, col = opts.color || TIMBER_OLD;
  G.windows.quad(L(s - w / 2, seat, y), L(s + w / 2, seat, y), L(s + w / 2, seat, y + h), L(s - w / 2, seat, y + h), Z, Z, Z, Z, out, WIN_DARK);
  const P = 0.022, tw = 0.09 * M, at = seat + side * 0.002;
  beam(T, L(s - w / 2, at, y), L(s + w / 2, at, y), tw, P * 2, out, col);
  beam(T, L(s - w / 2, at, y + h), L(s + w / 2, at, y + h), tw * 1.3, P * 2, out, col);
  beam(T, L(s - w / 2, at, y), L(s - w / 2, at, y + h), tw, P * 2, out, col);
  beam(T, L(s + w / 2, at, y), L(s + w / 2, at, y + h), tw, P * 2, out, col);
  const n = Math.max(1, Math.floor(w / (0.27 * M)));         // 239 SMALL PANES, or a medieval house's wooden mullions
  for (let i = 1; i <= n; i++){ const x = s - w / 2 + w * i / (n + 1); beam(T, L(x, at, y), L(x, at, y + h), tw * 0.5, P, out, col); }
  if (opts.shutters !== false && key !== 'stone'){
    const ws = w / 2 - 0.02 * M;
    for (const d of [-1, 1]){
      const a = s + d * (w / 2 + 0.04 * M), b = a + d * ws;
      T.quad(L(a, at + side * 0.03, y), L(b, at + side * 0.09, y), L(b, at + side * 0.09, y + h), L(a, at + side * 0.03, y + h), [0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3], out, SHUTTER);
    }
  }
}
// The planks and ironwork of a door, and the frame it hangs in.
function drawDoor(G, R, s, floor, w, h, paint, opts = {}){
  const { L, O } = R, wall = R.spec.wf + 0.1, out = O(0, 1), T = G.timber, n = Math.max(3, Math.round(w / (0.24 * M)));
  for (let i = 0; i < n; i++){
    const a = s - w / 2 + w * i / n, b = s - w / 2 + w * (i + 1) / n, c = shade(paint, 0.88 + (i * 7 % 5) * 0.06);
    T.quad(L(a, wall, floor), L(b, wall, floor), L(b, wall, floor + h), L(a, wall, floor + h), [i * 0.1, 0], [i * 0.1, 0.08], [i * 0.1 + 0.6, 0.08], [i * 0.1 + 0.6, 0], out, c);
  }
  const col = TIMBER_OLD, tw = 0.14 * M;
  beam(T, L(s - w / 2, wall, floor), L(s - w / 2, wall, floor + h), tw, 0.06, out, col);
  beam(T, L(s + w / 2, wall, floor), L(s + w / 2, wall, floor + h), tw, 0.06, out, col);
  beam(T, L(s - w / 2 - tw / 2, wall, floor + h + 0.04), L(s + w / 2 + tw / 2, wall, floor + h + 0.04), tw * 1.5, 0.08, out, col);
  // the ledges across the planks and a ring to lift the latch
  for (const k of [0.22, 0.76]) beam(T, L(s - w / 2 + 0.03, wall, floor + h * k), L(s + w / 2 - 0.03, wall, floor + h * k), 0.07 * M, 0.02, out, shade(paint, 0.72));
  if (opts.brace !== false) for (const d of [-1, 1]){
    const a = L(s + d * w * 0.5, wall, floor + h - 0.22 * M), b = L(s + d * w * 0.5 - d * 0.22 * M, wall, floor + h);
    beam(T, a, b, 0.08 * M, 0.05, out, col);
  }
  const ring = L(s + w * 0.32, wall + 0.05, floor + h * 0.52);
  G.detail.box(ring[0], ring[2], ring[1] - 0.05, ring[1] + 0.05, 0.08, 0.08, opts.a || 0, [0.14, 0.13, 0.13]);
}
function stoneBox(G, x, z, y0, y1, sx, sz, a, col){ G.stone.tbox(x, z, y0, y1, sx, sz, a, col, TILE * 0.55); }

// ---- things at the edge of a building (160 BUILDING EDGE) ---------------------------
function drawEdge(G, b, f, frame, ground, r){
  const D = G.detail, T = G.timber, { hl, hw } = b, y = b.y, du = f.du;
  const P = frame.P, out = frame.out(0, 1);
  // the door stone, and the path worn from it
  const stone = P(du, hw + 0.25 * M, 0);
  stoneBox(G, stone[0], stone[2], y - 0.2, y + 0.1, 1.15 * M, 0.55 * M, b.a, shade(STONE, 1.08));
  const pathTo = hw + 3.4 * M;
  const c0 = [0.36, 0.29, 0.20];
  for (let i = 0; i < 6; i++){
    const v0 = hw + 0.5 * M + (pathTo - hw - 0.5 * M) * i / 6, v1 = hw + 0.5 * M + (pathTo - hw - 0.5 * M) * (i + 1) / 6;
    const wob = t => Math.sin(t * 0.5 + du) * 0.1, w0 = (0.48 - i * 0.02) * M, w1 = (0.48 - (i + 1) * 0.02) * M;
    const pt = (u, v) => { const q = P(u, v, 0); q[1] = ground(q[0], q[2]) + 0.035; return q; };
    D.quad(pt(du + wob(v0) - w0, v0), pt(du + wob(v1) - w1, v1), pt(du + wob(v1) + w1, v1), pt(du + wob(v0) + w0, v0), Z, Z, Z, Z, [0, 1, 0], shade(c0, 1 + (i % 2) * 0.06));
  }
  // the beds against the wall, edged in wattle: hollyhocks and herbs, low enough to step over
  for (const bed of f.beds){
    const rb = mulberry32(bed.seed), v0 = hw + 0.06 * M, v1 = hw + 0.72 * M, edge = 0.2 * M;
    const pt = (u, v, h = 0) => { const q = P(u, v, 0); q[1] = ground(q[0], q[2]) + 0.03 + h; return q; };
    D.quad(pt(bed.u0, v0), pt(bed.u1, v0), pt(bed.u1, v1), pt(bed.u0, v1), Z, Z, Z, Z, [0, 1, 0], [0.27, 0.20, 0.13]);
    beam(T, pt(bed.u0, v1, edge * 0.5), pt(bed.u1, v1, edge * 0.5), edge, 0.02, out, [0.38, 0.29, 0.18]);
    for (const u of [bed.u0, bed.u1]) beam(T, pt(u, v0, edge * 0.5), pt(u, v1, edge * 0.5), edge, 0.02, frame.out(u < du ? -1 : 1, 0), [0.38, 0.29, 0.18]);
    const n = Math.round((bed.u1 - bed.u0) / (0.32 * M));
    for (let i = 0; i < n; i++){
      const u = lerp(bed.u0 + 0.12 * M, bed.u1 - 0.12 * M, (i + rb()) / n), v = lerp(v0 + 0.1 * M, v1 - 0.1 * M, rb());
      const tall = rb() < 0.4, h = tall ? (1.1 + rb() * 0.5) * M : (0.2 + rb() * 0.25) * M, q = pt(u, v);
      const leaf = [0.25 + rb() * 0.1, 0.40 + rb() * 0.12, 0.17];
      D.quad([q[0] - 0.09, q[1], q[2]], [q[0] + 0.09, q[1], q[2]], [q[0] + 0.03, q[1] + h * (tall ? 0.72 : 1), q[2]], [q[0] - 0.03, q[1] + h * (tall ? 0.72 : 1), q[2]], Z, Z, Z, Z, out, leaf);
      D.quad([q[0], q[1], q[2] - 0.09], [q[0], q[1], q[2] + 0.09], [q[0], q[1] + h * (tall ? 0.72 : 1), q[2] + 0.03], [q[0], q[1] + h * (tall ? 0.72 : 1), q[2] - 0.03], Z, Z, Z, Z, out, shade(leaf, 0.86));
      if (tall){
        const fl = [[0.78, 0.30, 0.42], [0.86, 0.72, 0.68], [0.90, 0.74, 0.32], [0.50, 0.20, 0.34]][(rb() * 4) | 0];
        for (let k = 0; k < 4; k++){
          const fy = q[1] + h * (0.55 + k * 0.14), s = 0.085 - k * 0.012;
          D.box(q[0] + Math.sin(k * 2.2) * 0.04, q[2] + Math.cos(k * 2.2) * 0.04, fy, fy + s * 1.6, s * 2, s * 2, 0.5 * k, shade(fl, 0.9 + k * 0.04));
        }
      }
    }
  }
  // the bench: two blocks and a plank
  if (f.bench){
    const place = f.bench.end ? { u: f.bench.end * (hl + 0.34 * M), v: 0, along: 1 } : { u: f.bench.u, v: hw + 0.26 * M, along: 0 };
    const q = P(place.u, place.v, 0), a = place.along ? b.a + Math.PI / 2 : b.a, len = 1.25 * M, h = 0.44 * M, wide = 0.34 * M;
    D.box(q[0], q[2], y + h - 0.05 * M, y + h, len, wide, a, [0.40, 0.31, 0.20]);
    for (const k of [-0.38, 0.38]){
      const mx = q[0] + Math.cos(a) * k * len, mz = q[2] + Math.sin(a) * k * len;
      D.box(mx, mz, y - 0.1, y + h - 0.05 * M, 0.08 * M, wide * 0.9, a, [0.30, 0.23, 0.15]);
    }
    // a skep on the bench's sunny end: a dome of coiled straw
    if (f.skep){
      const kx = q[0] + Math.cos(a) * 0.3 * len, kz = q[2] + Math.sin(a) * 0.3 * len, base = y + h, c = [0.60, 0.48, 0.26];
      for (let k = 0; k < 4; k++) D.box(kx, kz, base + k * 0.1, base + (k + 1) * 0.1, 0.5 - k * 0.1, 0.5 - k * 0.1, a + k * 0.3, shade(c, 0.9 + k * 0.05));
    }
  }
  // a water butt under the eaves
  if (f.butt){
    const q = P(f.butt.u, hw + 0.26 * M, 0), R0 = 0.28 * M, n = 8, h = 0.82 * M;
    const pts = t => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * Math.PI * 2; return [q[0] + Math.cos(a) * R0 * t, q[2] + Math.sin(a) * R0 * t]; });
    const lo = pts(0.92), mi = pts(1.02), hi = pts(0.94);
    for (let i = 0; i < n; i++){
      const o = [Math.cos((i + 0.5) / n * Math.PI * 2), 0, Math.sin((i + 0.5) / n * Math.PI * 2)], c = shade([0.35, 0.27, 0.18], 0.88 + (i % 2) * 0.12);
      D.quad([lo[i][0], y - 0.1, lo[i][1]], [lo[i + 1][0], y - 0.1, lo[i + 1][1]], [mi[i + 1][0], y + h * 0.5, mi[i + 1][1]], [mi[i][0], y + h * 0.5, mi[i][1]], Z, Z, Z, Z, o, c);
      D.quad([mi[i][0], y + h * 0.5, mi[i][1]], [mi[i + 1][0], y + h * 0.5, mi[i + 1][1]], [hi[i + 1][0], y + h, hi[i + 1][1]], [hi[i][0], y + h, hi[i][1]], Z, Z, Z, Z, o, c);
      D.tri([q[0], y + h - 0.04, q[2]], [hi[i][0], y + h - 0.04, hi[i][1]], [hi[i + 1][0], y + h - 0.04, hi[i + 1][1]], Z, Z, Z, [0, 1, 0], [0.08, 0.10, 0.11]);
    }
  }
}

// ---- one building -------------------------------------------------------------------
// Fills the record settle-view.js needs for a dwelling: { b, win, flicker, top, pile }.
export function addDressed(G, b, r, ground){
  const k = KINDS[b.kind], f = b.form, { hl, hw } = b;
  const lx = Math.cos(b.a), lz = Math.sin(b.a), cx = -lz, cz = lx, dr = b.door;
  const frame = {
    P: (u, v, y) => [b.x + lx * u + cx * v * dr, y, b.z + lz * u + cz * v * dr],
    out: (u, v, y = 0) => [lx * u + cx * v * dr, y, lz * u + cz * v * dr],
  };
  const floor = b.y + (k.raised || 0) * M, y0 = k.raised ? floor : b.y - SINK;
  const E = floor + (f.E != null ? f.E : k.eaves) * M, pitch = Math.tan((f.pitch != null ? f.pitch : k.pitch) * Math.PI / 180);
  const t = 0.82 + b.tint * 0.24, tint = t;
  const roofBase = b.form.roof === 'thatch'
    ? mix([1.04, 1.0, 0.92], [0.70, 0.68, 0.62], f.age * 0.75)   // gold when new, grey with years
    : mix([0.98, 0.98, 0.96], [0.72, 0.72, 0.72], f.age * 0.6);
  const front = Math.cos(b.a) * dr;                              // +1: the front looks south
  const opt = { ridge: f.ridge || 'plain', seed: b.tint * 40, moss: 0.25 + f.age * 0.9, color: roofBase, coldSide: front > 0 ? -1 : 1 };

  const main = {
    U: 0, V: 0, turn: 0, s0: -hl, s1: hl, wf: hw, wr: hw, E, Eo: floor + f.Eo * M, pitch,
    fOd: f.frontOd, rOd: f.rearOd, ends: [...f.ends], over: 0.36 * M, overGable: 0.28 * M, sag: f.sag,
  };
  // a wing takes the main range back to its middle: the main roof runs into the wing's
  if (f.wing){
    if (f.wing.cut < 0) main.s0 = f.wing.cut; else main.s1 = f.wing.cut;
  }
  const R = makeRange(frame, main);
  const wallOpt = { wall: f.wall, wash: f.wash, y0, floor, r, tint, studs: f.studs, lines: f.lines, cruck: f.wall === 'daub' && f.age > 0.42 };

  // openings on the front wall, so the frame leaves them room
  const open = { 1: [], [-1]: [] };
  const yWin = floor + 1.02 * M;
  const door = f.door;
  if (door) open[1].push({ s0: f.du - door.w / 2 - 0.08 * M, s1: f.du + door.w / 2 + 0.08 * M, door: true });
  for (const w of f.windows || []) open[w.side].push({ s0: w.u - w.w / 2, s1: w.u + w.w / 2 });
  wallOpt.open = open;
  if (b.kind === 'barn' && !f.midstrey) open[1].push({ s0: -f.floorW, s1: f.floorW, door: true });
  if (b.kind === 'barn') open[-1].push({ s0: -f.floorW, s1: f.floorW, door: true });

  // 117: the thatch lifts over the door, so nobody ducks under the lip to reach it
  const sweep = door && f.wall && f.roof === 'thatch'
    ? { u: f.du, w: 1.3 * M, lift: E - floor > 2 * M ? 0.5 * M : 0.72 * M, h: 1.6 * M } : null;
  // an eyebrow over the loft window
  const yEb = E + 0.3 * M, eb = f.eyebrow ? { u: f.eyebrow.u, ws: 0.72 * M, y: yEb, lift: 0.78 * M, below: 0.09, above: 1.3 } : null;
  drawWalls(G, R, f, wallOpt);
  const roof = drawRoof(G, R, f.roof, { ...opt, eyebrow: eb, sweep, patch: f.patch });

  const winFrom = G.windows.p.length / 3;
  for (const w of f.windows || []) drawWindow(G, R, w.side, w.u, yWin, w.w, w.h, f.wall);
  if (eb){
    const wb = R.wAt(1, yEb) + 0.3, ww = 0.72 * M, wh = 0.38 * M, Y0 = yEb;
    drawWindow(G, R, 1, f.eyebrow.u, Y0 + 0.05, ww, wh, f.wall, { at: wb, shutters: false });
    // little cheeks of straw either side, under the eyebrow
    const dirs = [-1, 1];
    for (const d of dirs){
      const s = f.eyebrow.u + d * (ww / 2 + 0.06);
      G.thatch.tri(R.L(s, wb, Y0 + wh * 1.1), R.L(s, wb, Y0 - 0.1), R.L(s + d * 0.25, wb - 0.35, Y0 + wh * 1.2), [0, 0], [0.1, 0], [0.1, 0.1], R.O(d, 0.3, 0.3), shade(opt.color, 0.76));
    }
  }
  for (const v of f.vents || []) ventSlit(G, R, v.side, v.u, floor);

  // a loft window in the gable, up under the roof
  if (f.loft){
    const e = f.loft.end, s = (e < 0 ? main.s0 : main.s1) + e * 0.1, ww = 0.56 * M, wh = 0.46 * M, y = E + 0.32 * M, O = R.O(e, 0);
    const wc = R.wc, tw = 0.08 * M;
    G.windows.quad(R.L(s, wc - ww / 2, y), R.L(s, wc + ww / 2, y), R.L(s, wc + ww / 2, y + wh), R.L(s, wc - ww / 2, y + wh), Z, Z, Z, Z, O, WIN_DARK);
    for (const [a, c] of [[[wc - ww / 2, y], [wc + ww / 2, y]], [[wc - ww / 2, y + wh], [wc + ww / 2, y + wh]], [[wc - ww / 2, y], [wc - ww / 2, y + wh]], [[wc + ww / 2, y], [wc + ww / 2, y + wh]], [[wc, y], [wc, y + wh]]])
      beam(G.timber, R.L(s, a[0], a[1]), R.L(s, c[0], c[1]), tw, 0.05, O, TIMBER_OLD);
  }

  // the wing, its own range across the end of the house
  let wingR = null;
  if (f.wing){
    const w = f.wing, EW = floor + w.E * M, jet = w.jetty ? 0.42 * M : 0;
    const spec = {
      U: w.u, V: 0, turn: 1, s0: -hw, s1: hw + w.wp, wf: w.ww / 2, wr: w.ww / 2, E: EW, pitch: Math.tan(50 * Math.PI / 180),
      ends: ['half', 'gable'], over: 0.32 * M, overGable: 0.26 * M + jet, sag: f.sag * 0.6,
    };
    wingR = makeRange(frame, spec);
    const wingOpt = { ...wallOpt, y0: b.y - PART_SINK, lines: [-hw, -hw + (2 * hw + w.wp) * 0.5, hw + w.wp], open: {}, cruck: false, closeNone: true };
    drawWalls(G, wingR, f, wingOpt);
    drawRoof(G, wingR, f.roof, { ...opt, seed: opt.seed + 3, coldSide: 0 });
    // the windows in its gable, and the jetty: the upper floor standing out on its joists
    const gs = spec.s1 + 0.08, yUp = floor + 2.25 * M, O = wingR.O(1, 0), tw = 0.14 * M;
    const yGround = floor + 0.98 * M;
    gableWindow(G, wingR, gs, 0, yGround, 0.9 * M, 0.72 * M, O);
    if (jet){
      const js = spec.s1 + jet;
      // upper wall, out on the joists, with its own windows
      const col = shade(f.wash, 0.98), uv = (a, y) => [a / TILE, y / TILE];
      for (const [a, c] of [[-w.ww / 2, w.ww / 2]]){
        G[f.wall === 'daub' ? 'daub' : f.wall].quad(wingR.L(js, a, yUp), wingR.L(js, c, yUp), wingR.L(js, c, EW), wingR.L(js, a, EW), uv(a, yUp), uv(c, yUp), uv(c, EW), uv(a, EW), O, col);
      }
      const apex = endPolygon(wingR, Infinity, EW).filter(p => p[1] >= EW - 1e-3);
      for (let i = 1; i < apex.length - 1; i++) {
        G[f.wall === 'daub' ? 'daub' : f.wall].tri(wingR.L(js, 0, EW), wingR.L(js, apex[i][0], apex[i][1]), wingR.L(js, apex[i + 1][0], apex[i + 1][1]), [0, 0], [0.3, 0.3], [0.3, 0], O, col);
      }
      // close the sides of the overhang, its underside, and show the joist ends
      for (const d of [-1, 1]){
        const wd = d * w.ww / 2, o = wingR.O(0, d);
        G[f.wall === 'daub' ? 'daub' : f.wall].quad(wingR.L(spec.s1, wd, yUp), wingR.L(js, wd, yUp), wingR.L(js, wd, EW), wingR.L(spec.s1, wd, EW), [0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3], o, shade(col, 0.92));
      }
      G.timber.quad(wingR.L(spec.s1, -w.ww / 2, yUp), wingR.L(spec.s1, w.ww / 2, yUp), wingR.L(js, w.ww / 2, yUp), wingR.L(js, -w.ww / 2, yUp), Z, Z, Z, Z, [0, -1, 0], TIMBER_OLD);
      for (let i = 0; i <= 8; i++){
        const q = -w.ww / 2 + w.ww * i / 8;
        beam(G.timber, wingR.L(spec.s1, q, yUp - 0.04 * M), wingR.L(js + 0.05, q, yUp - 0.04 * M), 0.1 * M, 0.08, [0, -1, 0], shade(TIMBER_OLD, 0.9));
      }
      beam(G.timber, wingR.L(js, -w.ww / 2 - 0.05, yUp), wingR.L(js, w.ww / 2 + 0.05, yUp), tw * 1.5, 0.06, O, TIMBER_OLD);
      beam(G.timber, wingR.L(js, -w.ww / 2, EW - 0.05), wingR.L(js, w.ww / 2, EW - 0.05), tw * 1.1, 0.05, O, TIMBER_OLD);
      for (const q of [-1, -0.5, 0.5, 1]) beam(G.timber, wingR.L(js, q * w.ww / 2, yUp), wingR.L(js, q * w.ww / 2, EW), tw * (Math.abs(q) === 1 ? 1.1 : 0.7), 0.05, O, TIMBER_OLD);
      gableWindow(G, wingR, js + 0.04, 0, yUp + 0.28 * M, 1.05 * M, 0.56 * M, O);
      // the frame carries on up into the point of the gable
      const yc = lerp(EW, wingR.Y, 0.48), hc = (wingR.Y - yc) / spec.pitch - tw;
      beam(G.timber, wingR.L(js, -hc, yc), wingR.L(js, hc, yc), tw * 0.85, 0.05, O, TIMBER_OLD);
      beam(G.timber, wingR.L(js, 0, EW), wingR.L(js, 0, wingR.Y - tw * 2), tw * 0.9, 0.05, O, TIMBER_OLD);
      for (const d of [-1, 1]) beam(G.timber, wingR.L(js, d * (w.ww / 2 - tw * 1.8), EW), wingR.L(js, d * hc * 0.42, yc), tw * 0.65, 0.04, O, TIMBER_OLD);
    } else gableWindow(G, wingR, gs, 0, yUp + 0.22 * M, 0.85 * M, 0.5 * M, O);
    // a small window looking into the corner it makes
    const inner = f.wing.u > f.du ? 1 : -1;
    const sNear = hw + w.wp * 0.5, wNear = (inner > 0 ? -1 : 1) * (w.ww / 2 + 0.1);
    G.windows.quad(wingR.L(sNear - 0.24 * M, wNear, yGround), wingR.L(sNear + 0.24 * M, wNear, yGround), wingR.L(sNear + 0.24 * M, wNear, yGround + 0.55 * M), wingR.L(sNear - 0.24 * M, wNear, yGround + 0.55 * M), Z, Z, Z, Z, wingR.O(0, wNear > 0 ? 1 : -1), WIN_DARK);
    {
      const o = wingR.O(0, wNear > 0 ? 1 : -1), a = sNear - 0.24 * M, c = sNear + 0.24 * M, yt = yGround + 0.55 * M;
      for (const [p, q] of [[[a, yGround], [c, yGround]], [[a, yt], [c, yt]], [[a, yGround], [a, yt]], [[c, yGround], [c, yt]], [[sNear, yGround], [sNear, yt]]])
        beam(G.timber, wingR.L(p[0], wNear, p[1]), wingR.L(q[0], wNear, q[1]), 0.08 * M, 0.04, o, TIMBER_OLD);
    }
  }

  // ---- by kind -----------------------------------------------------------------------
  if (door) drawDoorway(G, R, f, b, floor, E, wallOpt, opt);
  if (b.kind === 'barn') drawBarnBits(G, R, f, b, floor, wallOpt, opt, frame);
  else if (b.kind === 'shed'){
    drawDoor(G, R, 0, floor, 0.95 * M, 1.6 * M, [0.28, 0.23, 0.16], { a: b.a, brace: false });
  } else if (b.kind === 'granary'){
    drawDoor(G, R, 0, floor + 0.05, 0.7 * M, 1.05 * M, [0.30, 0.24, 0.17], { a: b.a, brace: false });
    // staddle stones: the mushroom-headed posts rats can't climb
    for (const u of [-1, 0, 1]) for (const v of [-1, 1]){
      const q = frame.P(u * (hl - 0.18 * M), v * (hw - 0.18 * M), 0), h = floor - b.y;
      stoneBox(G, q[0], q[2], b.y - SINK, b.y + h * 0.78, 0.2 * M, 0.2 * M, b.a, STONE);
      stoneBox(G, q[0], q[2], b.y + h * 0.78, floor - 0.02, 0.46 * M, 0.46 * M, b.a, shade(STONE, 1.1));
    }
    const under = [frame.P(-hl, -hw, floor), frame.P(hl, -hw, floor), frame.P(hl, hw, floor), frame.P(-hl, hw, floor)];
    G.detail.quad(under[0], under[1], under[2], under[3], Z, Z, Z, Z, [0, -1, 0], TIMBER_OLD);
    // steps up to its door
    for (let i = 0; i < 2; i++){
      const q = frame.P(0, hw + (0.3 + (1 - i) * 0.28) * M, 0);
      G.detail.box(q[0], q[2], b.y - SINK, b.y + (floor - b.y) * (i + 1) / 2.4, 0.7 * M, 0.3 * M, b.a, [0.34, 0.26, 0.17]);
    }
  }
  if (!b.dwelling) return null;

  const rec = { b, win: [winFrom, G.windows.p.length / 3], flicker: r() * 10 };
  // the chimney: stone, stepped in as it climbs, with a cap to throw the wind
  const ch = f.chimney, cs = 0.82 * M;
  let topY, topP;
  if (ch.kind === 'ridge'){
    const q = R.L(ch.u, R.wc, 0), base = R.Y - 1.2;
    topY = R.Y + 1.15 * M;
    stoneBox(G, q[0], q[2], base, R.Y + 0.42 * M, cs, cs, b.a, STONE);
    stoneBox(G, q[0], q[2], R.Y + 0.42 * M, topY, cs * 0.78, cs * 0.78, b.a, shade(STONE, 0.96));
    stoneBox(G, q[0], q[2], topY, topY + 0.1 * M, cs * 0.96, cs * 0.96, b.a, shade(STONE, 1.08));
    topP = q;
  } else {
    const e = ch.end, wc = R.wc, q = R.L(e * (hl + 0.38 * M), wc, 0), yT = R.Y + 0.7 * M, wide = 1.7 * M, deep = 0.72 * M;
    stoneBox(G, q[0], q[2], b.y - SINK, E - 0.15 * M, deep, wide, b.a, STONE);
    // the shoulders, stepping in toward the flue
    stoneBox(G, q[0], q[2], E - 0.15 * M, E + 0.6 * M, deep, wide * 0.72, b.a, shade(STONE, 0.97));
    stoneBox(G, q[0], q[2], E + 0.6 * M, yT, deep * 0.9, wide * 0.42, b.a, shade(STONE, 0.94));
    stoneBox(G, q[0], q[2], yT, yT + 0.1 * M, deep * 1.1, wide * 0.5, b.a, shade(STONE, 1.08));
    topY = yT;
    topP = q;
  }
  rec.top = [topP[0], topY + 0.25, topP[2]];
  // where the woodpile stacks up: against the gable away from the door
  const ge = (f.du > 0 ? -1 : 1) * (hl + 0.45);
  const pp = frame.P(ge, 0, 0);
  rec.pile = { x: pp[0], z: pp[2], y: b.y, a: b.a, ge };

  drawEdge(G, b, f, frame, ground, r);
  // the straw bird on the ridge: a thatcher's name
  if (f.finial && R.spec.ends.some(e => e !== 'none')){
    const se = R.spec.ends[0] === 'none' ? roof.ridge[1] - 0.25 : roof.ridge[0] + 0.25;
    const q = R.L(se, R.wc, roof.crest(se) - 0.02);
    const c = shade(opt.color, 1.02), a = [q[0], q[1], q[2]], h = 0.2 * M;
    G.thatch.tri(a, [a[0] + lx * h, a[1] + h * 0.55, a[2] + lz * h], [a[0] - lx * h * 0.9, a[1] + h * 0.72, a[2] - lz * h * 0.9], [0, 0], [0.1, 0], [0.1, 0.1], [cx, 0.2, cz], c);
    G.thatch.tri(a, [a[0] + lx * h, a[1] + h * 0.55, a[2] + lz * h], [a[0] - lx * h * 0.9, a[1] + h * 0.72, a[2] - lz * h * 0.9], [0, 0], [0.1, 0], [0.1, 0.1], [-cx, 0.2, -cz], shade(c, 0.9));
  }
  // the ladder still against the patch
  if (f.patch && f.patch.ladder && !(Math.abs(f.patch.u) > (main.s1 - main.s0) / 2)){
    const u = f.patch.u, h0 = R.wAt(1, E);
    const topW = h0 - 0.1, topAt = E + 0.65 * M;
    const foot = R.L(u, hw + 1.05 * M, 0); foot[1] = ground(foot[0], foot[2]) + 0.02;
    const head = R.L(u, topW, topAt + 0.15);
    const col = [0.50, 0.38, 0.24], w = 0.36 * M, along = [lx * w / 2, 0, lz * w / 2];
    const rail = sub(head, foot), up = norm(add(rail, [0, 0, 0])), bk = norm(cross(along, up));
    const faces = (Math.sign(bk[0] * R.O(0, 1)[0] + bk[2] * R.O(0, 1)[2]) || 1);
    const n = [bk[0] * faces, bk[1] * faces, bk[2] * faces];
    for (const s of [-1, 1]) beam(G.timber, add(foot, along, s), add(head, along, s), 0.07 * M, 0.04, n, col);
    const rungs = Math.round(Math.hypot(...rail) / (0.3 * M));
    for (let i = 1; i < rungs; i++){
      const t = i / rungs, a = add(foot, rail, t);
      beam(G.timber, add(a, along, -1), add(a, along, 1), 0.05 * M, 0.04, n, shade(col, 0.92));
    }
  }
  return rec;
}

// a framed window in an end wall
function gableWindow(G, R, s, w, y, ww, wh, O){
  G.windows.quad(R.L(s, w - ww / 2, y), R.L(s, w + ww / 2, y), R.L(s, w + ww / 2, y + wh), R.L(s, w - ww / 2, y + wh), Z, Z, Z, Z, O, WIN_DARK);
  const tw = 0.09 * M;
  for (const [a, c] of [[[w - ww / 2, y], [w + ww / 2, y]], [[w - ww / 2, y + wh], [w + ww / 2, y + wh]], [[w - ww / 2, y], [w - ww / 2, y + wh]], [[w + ww / 2, y], [w + ww / 2, y + wh]]])
    beam(G.timber, R.L(s, a[0], a[1]), R.L(s, c[0], c[1]), tw, 0.05, O, TIMBER_OLD);
  const n = Math.max(1, Math.floor(ww / (0.27 * M)));
  for (let i = 1; i <= n; i++){ const q = w - ww / 2 + ww * i / (n + 1); beam(G.timber, R.L(s, q, y), R.L(s, q, y + wh), tw * 0.5, 0.03, O, TIMBER_OLD); }
}
// a beast's vent: a slit with a dark throat and no lamp behind it
function ventSlit(G, R, side, s, floor){
  const w = (side > 0 ? R.spec.wf : -R.spec.wr) + side * 0.07, out = R.O(0, side), hw = 0.09 * M, y = floor + 1.1 * M, h = 0.55 * M;
  G.detail.quad(R.L(s - hw, w, y), R.L(s + hw, w, y), R.L(s + hw, w, y + h), R.L(s - hw, w, y + h), Z, Z, Z, Z, out, [0.08, 0.06, 0.05]);
}
function drawDoorway(G, R, f, b, floor, E, wallOpt, opt){
  const d = f.door, du = f.du, hw = b.hw;
  drawDoor(G, R, du, floor, d.w, d.h, f.paint, { a: b.a });
  const T = G.timber, out = R.O(0, 1), wall = R.spec.wf + 0.1;
  // rowan over the lintel, red-berried: an old charm against the Good Folk, and the Lea's own tree
  if (f.rowan){
    const yR = floor + d.h + 0.2 * M, q = R.L(du, wall + 0.07, yR), a = Math.atan2(out[2], out[0]) + Math.PI / 2;
    for (const k of [-1, 1]){
      const dx = Math.cos(a) * k * 0.3 * M, dz = Math.sin(a) * k * 0.3 * M;
      G.detail.quad([q[0], yR, q[2]], [q[0] + dx, yR + 0.07, q[2] + dz], [q[0] + dx, yR + 0.14, q[2] + dz], [q[0], yR + 0.1, q[2]], Z, Z, Z, Z, out, [0.22, 0.34, 0.15]);
    }
    for (let i = 0; i < 3; i++) G.detail.box(q[0] + Math.cos(a) * (i - 1) * 0.1, q[2] + Math.sin(a) * (i - 1) * 0.1, yR - 0.07, yR - 0.01, 0.07, 0.07, 0, [0.70, 0.13, 0.08]);
  }
  if (f.porch === 'posted'){
    const pd = 1.0 * M, pw = 0.9 * M;
    const spec = { U: du, V: hw, turn: 1, s0: 0, s1: pd, wf: pw, wr: pw, E: floor + 1.92 * M, pitch: Math.tan(46 * Math.PI / 180), ends: ['none', 'gable'], over: 0.25 * M, overGable: 0.18 * M, sag: 0.03 };
    const P = makeRange({ P: R.L, out: R.O }, spec);
    drawRoof(G, P, f.roof, { ...opt, seed: opt.seed + 7, coldSide: 0, ridge: 'plain' });
    // the two posts, a tie across their heads, and the rafters under the straw
    const col = TIMBER_OLD, o2 = P.O(1, 0), tw = 0.15 * M;
    for (const s of [-1, 1]){
      const a = P.L(pd - 0.1 * M, s * pw, b.y - 0.1);
      T.tbox(a[0], a[2], b.y - 0.15, spec.E, tw, tw, b.a, col, TILE);
      beam(T, P.L(pd - 0.1 * M, s * pw, spec.E - 0.48 * M), P.L(pd - 0.1 * M, s * 0.48 * pw, spec.E), 0.08 * M, 0.05, o2, col);
      beam(T, P.L(pd - 0.1 * M, s * pw * 0.96, spec.E - 0.03), P.L(pd - 0.1 * M, 0, P.Y - 0.3), 0.1 * M, 0.05, o2, col);
    }
    beam(T, P.L(pd - 0.1 * M, -pw, spec.E), P.L(pd - 0.1 * M, pw, spec.E), tw * 1.1, 0.06, o2, col);
    beam(T, P.L(pd - 0.1 * M, 0, spec.E), P.L(pd - 0.1 * M, 0, P.Y - 0.32), 0.08 * M, 0.05, o2, col);
  } else if (f.porch === 'hood'){
    // a pentice on two brackets: boards, a lifted edge
    const pw = 0.82 * M, y1 = floor + 2.0 * M, y2 = floor + 1.82 * M, pd = 0.72 * M, m = G.shingle, c = [0.92, 0.92, 0.9];
    m.quad(R.L(du - pw, wall, y1), R.L(du + pw, wall, y1), R.L(du + pw, wall + pd, y2), R.L(du - pw, wall + pd, y2), [0, 0], [0.8, 0], [0.8, 0.4], [0, 0.4], R.O(0, 1, 2), c);
    for (const s of [-1, 1]) beam(T, R.L(du + s * pw * 0.86, wall, floor + 1.45 * M), R.L(du + s * pw * 0.86, wall + pd * 0.86, y2 - 0.02), 0.09 * M, 0.04, R.O(s, 0), TIMBER_OLD);
  }
}
function drawBarnBits(G, R, f, b, floor, wallOpt, opt, frame){
  const { hw } = b, T = G.timber, col = [0.32, 0.26, 0.20];
  // the great doors: a threshing floor's draught runs between them
  // in the long wall the aisle's eaves come down to f.Eo, so door and lintel (h + 0.08, 0.21 M
  // thick) stop under them; a midstrey's doors are in its own gable and can stand taller
  const dw = 2 * f.floorW, dh = Math.min(2.5 * M, (f.Eo - 0.2) * M - 0.08);
  if (f.midstrey){
    const m = f.midstrey, spec = { U: 0, V: hw, turn: 1, s0: 0, s1: m.d, wf: f.floorW + 0.15 * M, wr: f.floorW + 0.15 * M, E: floor + m.E * M, pitch: Math.tan(44 * Math.PI / 180), ends: ['none', 'gable'], over: 0.24 * M, overGable: 0.18 * M, sag: 0.03 };
    const P = makeRange({ P: R.L, out: R.O }, spec);
    drawWalls(G, P, { age: f.age }, { wall: f.wall, wash: null, y0: b.y - PART_SINK, floor, r: wallOpt.r, tint: 0.95, lines: [0, m.d], closeNone: false, open: {} });
    drawRoof(G, P, f.roof, { ...opt, seed: opt.seed + 5, coldSide: 0 });
    // its front: double doors, one standing a little ajar on the dark of the floor
    bigDoors(G, P, m.d + 0.1, floor, dw * 0.92, Math.min(2.3 * M, (m.E - 0.3) * M), col, P.O(1, 0));
  } else {
    bigDoors(G, R, hw + 0.08, floor, dw, dh, col, R.O(0, 1), true);
  }
  bigDoors(G, R, -hw - 0.08, floor, dw * 0.9, dh * 0.86, col, R.O(0, -1), true);
  // narrow vents along its flanks, so the corn keeps dry
  const k = f.lines;
  for (let i = 0; i < k.length - 1; i++){
    const u = (k[i] + k[i + 1]) / 2;
    if (Math.abs(u) < f.floorW + 0.5 * M) continue;
    ventSlit(G, R, 1, u, floor - 0.25 * M);
    ventSlit(G, R, -1, u, floor - 0.25 * M);
  }
  // the owl hole, high in a gable, for the barn's mouser
  if (f.owl >= 0){
    const e = f.owl ? 1 : -1, s = (e < 0 ? -b.hl : b.hl) + e * 0.08, y = R.spec.E + 0.65 * M, o = R.O(e, 0), r0 = 0.2 * M;
    G.detail.quad(R.L(s, R.wc - r0, y), R.L(s, R.wc + r0, y), R.L(s, R.wc + r0, y + r0 * 1.8), R.L(s, R.wc - r0, y + r0 * 1.8), Z, Z, Z, Z, o, [0.07, 0.06, 0.05]);
    beam(T, R.L(s, R.wc - r0 * 1.3, y), R.L(s, R.wc + r0 * 1.3, y), 0.06 * M, 0.03, o, col);
  }
}
// Doors in the plane that faces `out`: at s or w according to the range's frame.
function bigDoors(G, R, plane, floor, w, h, col, out, onLong = false){
  const n = norm(out), T = G.timber;
  const at = (x, y, off = 0) => add(onLong ? R.L(x, plane, y) : R.L(plane, x, y), n, off);
  G.detail.quad(at(-w / 2, floor), at(w / 2, floor), at(w / 2, floor + h), at(-w / 2, floor + h), Z, Z, Z, Z, out, [0.03, 0.025, 0.02]);
  // the left leaf shut, the right stood a little open on the dark of the threshing floor
  for (const [a, b] of [[-w / 2, -0.02], [0.02 + w * 0.08, w / 2]]){
    for (let i = 0; i < 5; i++){
      const x0 = lerp(a, b, i / 5), x1 = lerp(a, b, (i + 1) / 5), c = shade(col, 1.15 + ((i * 3) % 4) * 0.08);
      T.quad(at(x0, floor, 0.03), at(x1, floor, 0.03), at(x1, floor + h, 0.03), at(x0, floor + h, 0.03), [i * 0.13, 0], [i * 0.13, 0.08], [i * 0.13 + 0.8, 0.08], [i * 0.13 + 0.8, 0], out, c);
    }
    for (const k of [0.12, 0.5, 0.86]) beam(T, at(a, floor + h * k, 0.03), at(b, floor + h * k, 0.03), 0.11 * M, 0.025, out, shade(col, 0.76));
    beam(T, at(a, floor + h * 0.12, 0.03), at(b, floor + h * 0.5, 0.03), 0.09 * M, 0.025, out, shade(col, 0.72));
  }
  beam(T, at(-w / 2 - 0.1, floor), at(-w / 2 - 0.1, floor + h), 0.17 * M, 0.06, out, TIMBER_OLD);
  beam(T, at(w / 2 + 0.1, floor), at(w / 2 + 0.1, floor + h), 0.17 * M, 0.06, out, TIMBER_OLD);
  beam(T, at(-w / 2 - 0.2, floor + h + 0.08), at(w / 2 + 0.2, floor + h + 0.08), 0.21 * M, 0.07, out, TIMBER_OLD);
}

// ---- the well -----------------------------------------------------------------------
// A shape turned round an upright axis. profile: [[r, y], ...]; a run going up faces out, going
// inward at the top faces up, coming down inside faces the middle. Round the axis the normals are
// smooth, so it reads as a true circle; along the profile each step keeps its edge. A whole number
// of tiles goes round, so the bond has no seam. col(segment, q): a colour per step and facet.
function lathe(G, x, z, profile, { n = 24, tile = 3, turns = null, a0 = 0, col = () => [1, 1, 1] } = {}){
  const R = Math.max(...profile.map(p => p[0]));
  const round = turns || Math.max(1, Math.round(2 * Math.PI * R / tile));
  let v = 0;
  for (let i = 0; i < profile.length - 1; i++){
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1], len = Math.hypot(r1 - r0, y1 - y0);
    const nr = (y1 - y0) / (len || 1), ny = (r0 - r1) / (len || 1), v1 = v + len / tile;
    for (let q = 0; q < n; q++){
      const a = a0 + q / n * Math.PI * 2, b = a0 + (q + 1) / n * Math.PI * 2, c = col(i, q);
      const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const A = [x + ca * r0, y0, z + sa * r0], B = [x + cb * r0, y0, z + sb * r0], C = [x + cb * r1, y1, z + sb * r1], D = [x + ca * r1, y1, z + sa * r1];
      const Na = [ca * nr, ny, sa * nr], Nb = [cb * nr, ny, sb * nr];
      const ua = q / n * round, ub = (q + 1) / n * round;
      for (const [p, m, u, w] of [[A, Na, ua, v], [C, Nb, ub, v1], [B, Nb, ub, v], [A, Na, ua, v], [D, Na, ua, v1], [C, Nb, ub, v1]]){
        G.p.push(...p); G.n.push(...m); G.uv.push(u, w); G.c.push(...c);
      }
    }
    v = v1;
  }
}

// A round brick well on the green, in the cathedrals' brick: a battered foot, a band below a coping
// of dressed stone, a dark shaft inside. Over it a windlass on two posts under its own little roof,
// with the rope down to a bucket. The ground round it is worn stone, as round any place people
// stop (126 SOMETHING ROUGHLY IN THE MIDDLE, 168). `a` lays the axle along the green.
export function addWell(G, w, ground, a = 0){
  const { x, z, y, r: R } = w, B = G.brick, T = G.timber;
  const r = mulberry32(((x * 13) ^ (z * 7)) >>> 0);
  const Ri = R - 0.3 * M, top = y + 0.86 * M, band = y + 0.66 * M;
  const damp = [0.62, 0.62, 0.58], wall = [1, 1, 1], tooth = [1.1, 1.06, 1.0];
  const wash = (i, q) => shade(i === 0 ? damp : i === 1 ? mix(damp, wall, 0.5) : i === 3 ? tooth : i === 6 ? [0.5, 0.5, 0.48] : wall, 1);
  lathe(B, x, z, [
    [R, y - SINK], [R, y + 0.14 * M], [R - 0.07 * M, y + 0.24 * M],      // the foot, stepping in
    [R - 0.07 * M, band], [R - 0.01 * M, band + 0.04 * M],               // the wall, and a band of brick set out
    [R - 0.01 * M, band + 0.1 * M], [R - 0.07 * M, band + 0.12 * M],
  ], { col: wash });
  // the coping: dressed stones, each its own colour, over the brick and down into the shaft
  const tones = Array.from({ length: 24 }, (_, q) => shade(STONE, (q % 3 === 0 ? 0.84 : 1) * (0.98 + r() * 0.2)));
  lathe(G.stone, x, z, [
    [R - 0.07 * M, band + 0.12 * M], [R + 0.02 * M, band + 0.12 * M], [R + 0.02 * M, top - 0.03 * M],
    [R - 0.04 * M, top], [Ri + 0.04 * M, top], [Ri, top - 0.03 * M],
  ], { tile: TILE * 0.7, col: (i, q) => tones[q] });
  // inside, brick going down into the dark: darker the further down you look
  const dim = [[0.62, 0.62, 0.62], [0.3, 0.3, 0.3], [0.13, 0.13, 0.13]];
  lathe(B, x, z, [[Ri, top - 0.03 * M], [Ri, y + 0.5 * M], [Ri, y + 0.3 * M], [Ri, y + 0.12 * M]], { col: i => dim[i] });
  // the water: nearly black, with a little sky in it
  lathe(G.detail, x, z, [[Ri, y + 0.12 * M], [Ri * 0.55, y + 0.12 * M], [0.001, y + 0.12 * M]], { n: 16, col: i => i ? [0.018, 0.024, 0.032] : [0.012, 0.016, 0.022] });
  // worn stones on the ground round it, ragged at their outer edge
  const n = 20, ragged = Array.from({ length: n }, () => R + (0.42 + r() * 0.5) * M);
  for (let q = 0; q < n; q++){
    const q1 = (q + 1) % n, a0 = q / n * Math.PI * 2, a1 = (q + 1) / n * Math.PI * 2;
    const pt = (rad, t) => { const px = x + Math.cos(t) * rad, pz = z + Math.sin(t) * rad; return [px, ground(px, pz) + 0.04, pz]; };
    const A = pt(R - 0.05, a0), B2 = pt(R - 0.05, a1), C = pt(ragged[q1], a1), D = pt(ragged[q], a0), u = q * 0.17;
    G.stone.quad(A, B2, C, D, [u, 0], [u + 0.17, 0], [u + 0.17, 0.28], [u, 0.28], [0, 1, 0], shade(STONE, 0.78 + (q % 4) * 0.05));
  }
  // the windlass: frame in the well's own turned frame, u along the axle
  const cx = Math.cos(a), sx = Math.sin(a), P = (u, v, h) => [x + cx * u - sx * v, h, z + sx * u + cx * v];
  const frame = { P, out: (u, v, h = 0) => [cx * u - sx * v, h, sx * u + cx * v] };
  const postAt = R - 0.14 * M, head = top + 1.34 * M, axle = top + 0.86 * M, col = TIMBER_OLD, tw = 0.15 * M;
  for (const s of [-1, 1]){
    const q = P(s * postAt, 0, 0);
    T.tbox(q[0], q[2], top - 0.1, head, tw, tw, a, col, TILE);
    // a stay down to the coping each way, so the posts don't rack
    for (const d of [-1, 1]) beam(T, P(s * postAt, d * 0.04, axle - 0.3 * M), P(s * postAt, d * (R - 0.2 * M), top + 0.02), 0.09 * M, 0.06, frame.out(s, 0), shade(col, 1.1));
  }
  // the axle, an eight-sided drum where the rope winds, and the crank at one end
  const axleR = 0.075 * M, sp = postAt + tw;
  for (let k = 0; k < 8; k++){
    const t0 = k / 8 * Math.PI * 2, t1 = (k + 1) / 8 * Math.PI * 2, tm = (t0 + t1) / 2;
    const pt = (u, t, rr) => P(u, Math.cos(t) * rr, axle + Math.sin(t) * rr);
    const o = frame.out(0, Math.cos(tm), Math.sin(tm));
    T.quad(pt(-sp, t0, axleR), pt(sp, t0, axleR), pt(sp, t1, axleR), pt(-sp, t1, axleR), [0, 0], [0.5, 0], [0.5, 0.1], [0, 0.1], o, shade(col, 1.2));
    G.detail.quad(pt(-0.28 * M, t0, axleR * 1.7), pt(0.28 * M, t0, axleR * 1.7), pt(0.28 * M, t1, axleR * 1.7), pt(-0.28 * M, t1, axleR * 1.7), Z, Z, Z, Z, o, shade([0.46, 0.38, 0.25], 0.86 + (k % 2) * 0.16));
  }
  beam(T, P(sp, -0.02, axle), P(sp + 0.14 * M, -0.02, axle), 0.08 * M, 0.04, frame.out(0, 1), shade(col, 1.2));
  beam(T, P(sp + 0.14 * M, -0.02, axle), P(sp + 0.14 * M, 0.34 * M, axle + 0.08), 0.07 * M, 0.04, frame.out(1, 0), shade(col, 1.2));
  beam(T, P(sp + 0.14 * M, 0.34 * M, axle + 0.08), P(sp + 0.32 * M, 0.34 * M, axle + 0.08), 0.07 * M, 0.04, frame.out(0, 1), [0.14, 0.13, 0.13]);
  // the rope, and a staved bucket hung in the throat of the well with its iron hoops
  const bucketTop = top + 0.32 * M, bR = 0.2 * M, bH = 0.32 * M, rope = [0.52, 0.44, 0.30];
  const rp = P(0.03 * M, axleR * 1.7, 0);
  G.detail.box(rp[0], rp[2], bucketTop + 0.09 * M, axle, 0.045, 0.045, a, rope);
  lathe(G.detail, rp[0], rp[2], [[bR * 0.78, bucketTop - bH], [bR, bucketTop], [bR * 0.9, bucketTop], [bR * 0.82, bucketTop - bH * 0.3]], { n: 10, col: i => i ? [0.09, 0.07, 0.05] : [0.38, 0.29, 0.18] });
  lathe(G.detail, rp[0], rp[2], [[bR * 0.84, bucketTop - bH * 0.74], [bR * 0.88, bucketTop - bH * 0.74], [bR * 0.92, bucketTop - bH * 0.62], [bR * 0.86, bucketTop - bH * 0.62]], { n: 10, col: () => [0.13, 0.12, 0.12] });
  beam(T, P(0.03 * M - bR, axleR * 1.7, bucketTop), P(0.03 * M, axleR * 1.7, bucketTop + 0.1 * M), 0.03 * M, 0.02, frame.out(0, 1), [0.14, 0.13, 0.13]);
  beam(T, P(0.03 * M + bR, axleR * 1.7, bucketTop), P(0.03 * M, axleR * 1.7, bucketTop + 0.1 * M), 0.03 * M, 0.02, frame.out(0, 1), [0.14, 0.13, 0.13]);
  // its roof: the same range as any house, in shingles; a tie and a king post hold it in the gable
  const spec = { U: 0, V: 0, turn: 0, s0: -postAt - tw / 2, s1: postAt + tw / 2, wf: 0.6 * M, wr: 0.6 * M, E: head, pitch: Math.tan(46 * Math.PI / 180), ends: ['gable', 'gable'], over: 0.24 * M, overGable: 0.2 * M, sag: 0.02 };
  const roof = makeRange(frame, spec);
  drawRoof(G, roof, 'shingle', { ridge: 'plain', seed: r() * 40, moss: 0, color: [0.86, 0.86, 0.84], coldSide: 0 });
  for (const s of [-1, 1]){
    const o = frame.out(s, 0), fs = s * postAt;
    beam(T, P(fs, -0.6 * M, head), P(fs, 0.6 * M, head), 0.11 * M, 0.08, o, col);
    beam(T, P(fs, 0, head), P(fs, 0, roof.Y - 0.32), 0.09 * M, 0.08, o, col);
  }
}
