// Ruins: what was standing in the Lea before anyone now living came — older
// than the folk, older than the villages, some older than the Old Road itself.
// Laid out once at load from the seed; nobody builds or mends them.
//
// Six kinds, each sited the way its builders sited it (docs/ruins.md):
//   · tower   — a stone watchtower, square or round, on a rise with a long view; the
//               road-builders put signal towers on hilltops in sight of each
//               other. One stands near the road (its own tower); the rest far off.
//   · circle  — a ring of standing stones on open upland heath or high meadow,
//               where such rings stand; older than everything else here
//   · hall    — the footings of a long stone hall on sheltered, gentle ground
//               with water a short walk off: a farm the land outlived. One in
//               the largest Lea is a grange: hall and barn round a walled yard.
//   · chapel  — a small stone chapel in a clearing in the woods, nave and
//               chancel, the arch between them still standing to the ridge
//   · abbey   — a great church on the cathedral's cruciform plan, on a level
//               valley floor with water near: carted off almost to nothing but
//               its west gable, an arch of its nave, and the stumps of its piers
//   · aqueduct — a line of arches straight across a valley, carrying water from
//               nowhere anyone remembers; a few runs of it still stand
//
// "Mostly far from the road": everything but the road tower scores for
// distance from the paving, and none stands near a settlement — the villagers'
// grandparents would have carted the stone off for their own walls.
//
// A ruin is a list of wall PIECES (short oriented boxes, each with its own
// broken height) and STONES (standing or fallen), so the view can draw them and
// land.js can make the tall ones solid. Anything under knee height (STEP_OVER)
// is stepped over: low footings, fallen stones, rubble. The abbey's arches and
// rose are RINGS (a ring of voussoirs, drawn only: they stand overhead). Pure (no three.js).

import { mulberry32 } from '../rng.js';
import { UNITS_PER_M } from '../config.js';
import { distanceField } from './settle.js';

const M = UNITS_PER_M;
const GRID = 16;                    // site-search grid (u)
export const STEP_OVER = 0.55 * M;  // a wall lower than this is stepped over, not walked round
const PIECE = 1.1 * M;              // length of one wall piece: how finely a wall breaks

// how many of each a world gets, by its side; `road` marks the one that stands by the road,
// `grange` the hall that is a grange. The abbey first: it wants the most level ground, and
// on the 1600 there's little. The aqueduct last: it is long, and threads between the rest.
const PLAN = {
  3200: [['abbey'], ['tower', 'road'], ['circle'], ['tower'], ['hall'], ['chapel'], ['circle'], ['hall', 'grange'], ['aqueduct']],
  1600: [['abbey'], ['tower', 'road'], ['circle'], ['hall'], ['chapel'], ['aqueduct']],
  800:  [['circle'], ['tower']],
};
const SPACING = 360;                // ruins keep this far apart (u)
const CLEAR_OF_SETTLED = 280;       // and this far from a settlement

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const OPEN = new Set(['meadow', 'heath']);

export function planRuins({ size, seed, height, habitat, water, road, settle, worldR }){
  const r = mulberry32(seed >>> 0);
  const half = size / 2;
  const G = Math.round(size / GRID) + 1, X = c => c * GRID - half;
  const Hg = new Float32Array(G * G), hab = new Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const x = X(i), z = X(j), k = j * G + i;
    Hg[k] = height(x, z); hab[k] = habitat(x, z, Hg[k]);
  }
  const wetD = distanceField(G, k => Hg[k] < water + 0.3, GRID);
  const roadSeed = new Uint8Array(G * G);
  for (let s = 0; s < road.xs.length; s++){
    const i = Math.round((road.xs[s] + half) / GRID), j = Math.round((road.zs[s] + half) / GRID);
    if (i >= 0 && j >= 0 && i < G && j < G) roadSeed[j * G + i] = 1;
  }
  const roadD = distanceField(G, k => roadSeed[k] === 1, GRID);
  const at = (x, z) => clamp(Math.round((z + half) / GRID), 0, G - 1) * G + clamp(Math.round((x + half) / GRID), 0, G - 1);
  // the height spread over a ring of radius R: how level the site is
  const spread = (x, z, R) => {
    let lo = Infinity, hi = -Infinity;
    for (let q = 0; q < 8; q++){
      const y = height(x + Math.cos(q * Math.PI / 4) * R, z + Math.sin(q * Math.PI / 4) * R);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return hi - lo;
  };
  // how far the site stands above the land round it (a rise, a hilltop)
  const rise = (x, z, R) => {
    let sum = 0;
    for (let q = 0; q < 12; q++) sum += height(x + Math.cos(q * Math.PI / 6) * R, z + Math.sin(q * Math.PI / 6) * R);
    return height(x, z) - sum / 12;
  };
  const woodAround = (x, z, R) => {
    let n = 0;
    for (let q = 0; q < 12; q++){ const h = hab[at(x + Math.cos(q * Math.PI / 6) * R, z + Math.sin(q * Math.PI / 6) * R)]; if (h === 'woodland' || h === 'grove') n++; }
    return n / 12;
  };
  // settlements and their lanes are no place for a ruin
  const laneSeed = new Uint8Array(G * G);
  for (const l of settle.lanes) for (let s = 0; s < l.xs.length; s++) laneSeed[at(l.xs[s], l.zs[s])] = 1;
  const laneD = distanceField(G, k => laneSeed[k] === 1, GRID);
  const settled = (x, z, k) => laneD[k] < 60 || settle.places.some(p => Math.hypot(p.x - x, p.z - z) < CLEAR_OF_SETTLED);

  // how well a ruin of this kind would sit at (x, z), or -Infinity
  const score = (x, z, kind, byRoad) => {
    const k = at(x, z), h = Hg[k], dh = h - water, rd = roadD[k];
    const d0 = Math.hypot(x, z);
    if (d0 > worldR * 0.88 || d0 < 180) return -Infinity;            // not on the start's rise
    if (dh < 1.6 || wetD[k] < 24) return -Infinity;                  // dry ground, off the shore
    if (rd < (byRoad ? 34 : 90)) return -Infinity;                   // never on the road's verge
    if (!free[k]) return -Infinity;
    const hb = hab[k];
    // the road tower wants the road in sight; the rest want it far off
    const far = byRoad ? 1 - Math.abs(rd - 70) / 60 : clamp((rd - 120) / 420, 0, 1);
    const j = 0.2 * r();
    if (kind === 'tower'){
      if (!(OPEN.has(hb) || hb === 'rock' || hb === 'woodland')) return -Infinity;
      if (spread(x, z, 7) > 2.2) return -Infinity;
      return 1.4 * clamp(rise(x, z, 70) / 6, -1, 1.5) + 0.04 * Math.min(dh, 30) + 1.3 * far + j;
    }
    if (kind === 'abbey'){
      // a sheltered valley floor, level under the whole church, water a short walk off
      if (!(hb === 'meadow' || hb === 'woodland' || hb === 'heath') || rd < 160) return -Infinity;
      if (spread(x, z, 30) > 2 || spread(x, z, 55) > 3.5) return -Infinity;
      for (const R of [30, 55]) for (let q = 0; q < 12; q++){
        const kk = at(x + Math.cos(q * Math.PI / 6) * R, z + Math.sin(q * Math.PI / 6) * R);
        if (!free[kk] || Hg[kk] - water < 1.2 || wetD[kk] < 8) return -Infinity;
      }
      const wet = wetD[k] < 60 ? 0.5 : wetD[k] <= 300 ? 1 : Math.max(0, 1 - (wetD[k] - 300) / 300);
      return wet + 0.8 * clamp(-rise(x, z, 140) / 6, -1, 1) + 1.3 * far + j;
    }
    if (kind === 'circle'){
      if (!OPEN.has(hb)) return -Infinity;
      if (spread(x, z, 20) > 1.6) return -Infinity;
      return (hb === 'heath' ? 0.8 : 0) + 0.5 * clamp(rise(x, z, 60) / 4, -1, 1) + 0.03 * Math.min(dh, 25) + 1.3 * far - woodAround(x, z, 30) + j;
    }
    if (kind === 'hall'){
      if (!(hb === 'meadow' || hb === 'woodland')) return -Infinity;
      if (spread(x, z, 16) > 1.6 || dh > 16) return -Infinity;
      const wet = wetD[k] < 40 ? 0 : wetD[k] <= 200 ? 1 : Math.max(0, 1 - (wetD[k] - 200) / 300);
      const south = clamp(-(height(x, z + 24) - height(x, z - 24)) / 48 / 0.04, -1, 1);
      return wet + 0.3 * south + 0.4 * woodAround(x, z, 40) + 1.3 * far + j;
    }
    // chapel: a clearing in the woods
    if (!(hb === 'meadow' || hb === 'woodland' || hb === 'heath')) return -Infinity;
    if (spread(x, z, 10) > 1.4) return -Infinity;
    return 1.2 * woodAround(x, z, 24) + 0.5 * woodAround(x, z, 60) + 1.3 * far + j;
  };

  // ground no ruin may take whatever its kind: the built habitats, and near a settlement
  const free = new Uint8Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const k = j * G + i, hb = hab[k];
    free[k] = !(hb === 'road' || hb === 'lane' || hb === 'yard' || hb === 'green' || hb === 'field' || settled(X(i), X(j), k)) ? 1 : 0;
  }

  // An aqueduct's line: straight across a valley, its two ends on ground of a height
  // and the ground between falling away at least 10u; off the fields and lanes and
  // the road, clear of the other ruins, never over water. The deeper the better.
  const aqueductLine = () => {
    let best = null, bs = -Infinity;
    for (let z = -half + 96; z < half - 96; z += 32) for (let x = -half + 96; x < half - 96; x += 32)
      for (let q = 0; q < 8; q++) for (const L of [180, 240, 300]){
        const a = q * Math.PI / 8, dx = Math.cos(a), dz = Math.sin(a), bx = x + dx * L, bz = z + dz * L;
        if (Math.hypot(x, z) > worldR * 0.85 || Math.hypot(bx, bz) > worldR * 0.85) continue;
        const ya = Hg[at(x, z)], yb = Hg[at(bx, bz)];
        if (Math.abs(ya - yb) > 3) continue;
        let deep = 0, rdMin = Infinity, ok = true;
        for (let i = 0; i <= 24 && ok; i++){
          const px = x + dx * L * i / 24, pz = z + dz * L * i / 24, k = at(px, pz);
          if (!free[k] || Hg[k] - water < 1 || roadD[k] < 40 || Math.hypot(px, pz) < 180
            || ruins.some(o => Math.hypot(o.x - px, o.z - pz) < o.rad + 60)) ok = false;
          deep = Math.max(deep, Math.min(ya, yb) - Hg[k]); rdMin = Math.min(rdMin, roadD[k]);
        }
        if (!ok || deep < 10) continue;
        const s = Math.min(deep, 30) / 10 + 0.8 * clamp((rdMin - 60) / 300, 0, 1) + 0.3 * r();
        if (s > bs){ bs = s; best = { x: x + dx * L / 2, z: z + dz * L / 2, a, len: L }; }
      }
    return best && [best, bs];
  };

  const ruins = [];
  for (const [kind, opt] of PLAN[size] || PLAN[3200]){
    const byRoad = opt === 'road';
    let best = null, bs = -Infinity, line = null;
    if (kind === 'aqueduct'){
      const got = aqueductLine();
      if (got){ [line, bs] = got; best = [line.x, line.z]; }
    } else for (let j = 2; j < G - 2; j++) for (let i = 2; i < G - 2; i++){
      const x = X(i), z = X(j);
      if (ruins.some(o => Math.hypot(o.x - x, o.z - z) < SPACING)) continue;
      const s = score(x, z, kind, byRoad);
      if (s > bs){ bs = s; best = [x, z]; }
    }
    if (!best) continue;
    const [x, z] = best, pr = mulberry32((seed ^ (ruins.length + 1) * 0x51ed) >>> 0);
    const ruin = { kind, x, z, a: line ? line.a : pr() * Math.PI, pieces: [], stones: [], rings: [], byRoad, score: bs };
    if (line) ruin.len = line.len;
    // the plan it's laid on: a grange, or every other tower round (which first, by its own stream)
    const nth = ruins.filter(o => o.kind === kind).length;
    if (opt === 'grange') ruin.plan = 'grange';
    if (kind === 'tower' && (nth + (pr() < 0.5 ? 1 : 0)) % 2) ruin.plan = 'round';
    LAY[ruin.plan || kind](ruin, pr, height);
    ruin.rad = Math.max(8, ...ruin.pieces.map(p => Math.hypot(p.x - x, p.z - z) + p.hl),
      ...ruin.stones.map(s => Math.hypot(s.x - x, s.z - z) + s.hl));
    ruins.push(ruin);
  }
  return ruins;
}

// ---- walls ----------------------------------------------------------------------
// A wall from a to b, `thick` through, broken along its length: its standing
// height follows `profile(t)` (t 0..1 along it, in metres) roughened piece by
// piece; `gaps` are [t0, t1] stretches gone to the ground (a door, a breach).
// Each piece is an oriented box { x, z, a, hl, hw, y0, h } — y0 its foot (set a
// little into the lowest ground under it), h how high it stands above y0.
function wall(ruin, r, height, [ax, az], [bx, bz], thick, profile, gaps = []){
  const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / PIECE)), a = Math.atan2(bz - az, bx - ax);
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  let rough = 0;
  for (let i = 0; i < n; i++){
    const t = (i + 0.5) / n;
    if (gaps.some(([g0, g1]) => t > g0 && t < g1)) continue;
    rough = rough * 0.5 + (r() - 0.5) * 0.9;                     // neighbouring pieces break alike
    const hm = profile(t) + rough * Math.min(1, profile(t) * 0.5);
    if (hm < 0.12) continue;
    const s = (i + 0.5) * len / n, x = ax + dx * s, z = az + dz * s, hl = len / n / 2, hw = thick / 2;
    let lo = Infinity, hi = -Infinity;
    for (const e of [-1, 1]) for (const f of [-1, 1]){
      const y = height(x + dx * hl * e - dz * hw * f, z + dz * hl * e + dx * hw * f);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    ruin.pieces.push({ x, z, a, hl, hw, y0: lo - 0.35, h: hm * M + (hi - lo) * 0.5 + 0.35, up: hm * M });
  }
}
// the corners of a rectangle centred on the ruin, w across and l along its axis
function rect(ruin, l, w){
  const c = Math.cos(ruin.a), s = Math.sin(ruin.a);
  const P = (u, v) => [ruin.x + c * u - s * v, ruin.z + s * u + c * v];
  return [P(-l / 2, -w / 2), P(l / 2, -w / 2), P(l / 2, w / 2), P(-l / 2, w / 2)];
}
// a broken-down profile: tallest at `peak` (t), falling off either way, never above `hmax`
const broken = (r, hmax, lo = 0.2) => {
  const peak = r(), fall = 0.8 + r() * 2.2, ph = r() * 6.3;
  return t => Math.max(0, hmax * (lo + (1 - lo) * Math.max(0, 1 - Math.abs(t - peak) * fall)) * (0.8 + 0.2 * Math.sin(t * 9 + ph)));
};
// rubble: fallen blocks lying about the foot of the walls (round the ruin, or round `c`)
function rubble(ruin, r, height, n, R, [cx, cz] = [ruin.x, ruin.z]){
  for (let i = 0; i < n; i++){
    const t = r() * Math.PI * 2, d = R * (0.5 + r() * 0.7), x = cx + Math.cos(t) * d, z = cz + Math.sin(t) * d;
    const s = (0.35 + r() * 0.4) * M;
    ruin.stones.push({ x, z, a: r() * Math.PI, hl: s / 2 * (1 + r() * 0.6), hw: s / 2, y0: height(x, z) - 0.15, h: s * 0.7, up: s * 0.55, fallen: true, block: true });
  }
}

// One block of masonry standing from lo to hi metres above a common base yB (a
// gable, a pier), so the edges of a door or a rose cut through it line up. One
// from the ground is sunk into the lowest ground under it, as wall() sinks its
// pieces (and one wholly underground is left out); one with its foot in the air
// (over a door, round a rose) hangs from yB + lo.
function raised(ruin, height, [x, z], a, hl, hw, yB, lo, hi){
  const c = Math.cos(a), s = Math.sin(a);
  let gl = Infinity;
  for (const e of [-1, 1]) for (const f of [-1, 1]) gl = Math.min(gl, height(x + c * hl * e - s * hw * f, z + s * hl * e + c * hw * f));
  const y0 = lo > 0 ? yB + lo * M : gl - 0.35, y1 = yB + hi * M;
  if (y1 <= gl) return;
  ruin.pieces.push({ x, z, a, hl, hw, y0, h: y1 - y0, up: y1 - gl, lift: lo > 0 ? y0 - gl : 0 });
}
// A ring of voussoirs in a wall's plane: o the wall's point on the ground, a its
// direction along the wall, its centre cu along and cy up (m, from base yB), its
// inner radius rIn and width t (m), hw half its depth through the wall (u), from
// angle t0 to t1 (0 along a, PI/2 straight up).
const ring = ([x, z], a, yB, cu, cy, rIn, t, hw, t0, t1) => ({ x, z, a, y: yB, cu: cu * M, cy: cy * M, r: rIn * M, t: t * M, hw, t0, t1 });
// an equilateral pointed arch: each half struck from the opposite springing, rising 0.866 × the span
const pointed = (ruin, o, a, yB, span, spring, t, hw) => ruin.rings.push(
  ring(o, a, yB, span / 2, spring, span, t, hw, Math.PI * 2 / 3, Math.PI),
  ring(o, a, yB, -span / 2, spring, span, t, hw, 0, Math.PI / 3));

// A wall cut through by its openings, built in slices `step` (u) wide from a common
// base yB, so the edge of a door, a window or an arch lines up from slice to slice.
// Along the wall it measures in metres: `len` long, at(m) the slice's centre and
// direction there, top(m) its height (m above yB; it may throw its own dice, once a
// slice), `rough` how much neighbouring slices break alike, as wall() roughens.
// `local`: heights from each slice's own ground instead of yB (a tower on a slope).
// Each opening is cut up to the outer edge of its ring of voussoirs, and the ring drawn:
//   { arch: 'pointed' | 'round', c, span, sill, spring, t }  sill -1: down to the ground
//   { circle: true, c, y, r, t }                               a rose, an oculus
//   { slot: true, c, w, sill, top }                            an arrow slit (no ring)
function wallCut(ruin, r, height, { len, at, T, yB, top, openings = [], step = 0.6, rough = 0, local = false }){
  const holes = m => {
    const out = [];
    for (const o of openings){
      const a = Math.abs(m - o.c);
      if (o.slot){ if (a < o.w / 2) out.push([o.sill, o.top]); continue; }
      if (o.circle){ const q = o.r + o.t; if (a < q){ const d = Math.sqrt(q * q - a * a); out.push([o.y - d, o.y + d]); } continue; }
      const h = o.span / 2;
      if (a >= h + o.t) continue;
      const ext = o.arch === 'pointed' ? Math.sqrt(Math.max(0, (o.span + o.t) ** 2 - (a + h) ** 2)) : Math.sqrt(Math.max(0, (h + o.t) ** 2 - a * a));
      out.push([a < h ? o.sill : o.spring, o.spring + ext]);
    }
    return out;
  };
  const n = Math.max(1, Math.round(len * M / step)), cw = len * M / n;
  let rg = 0;
  for (let i = 0; i < n; i++){
    const m = -len / 2 + (i + 0.5) * len / n, [x, z, a] = at(m);
    rg = rg * 0.5 + (r() - 0.5) * 0.9;
    const t = top(m);
    let segs = [[0, t + rough * rg * Math.min(1, t * 0.5)]];
    for (const [h0, h1] of holes(m)) segs = segs.flatMap(([lo, hi]) => [[lo, Math.min(hi, h0)], [Math.max(lo, h1), hi]]);
    const yb = local ? height(x, z) : yB;
    for (const [lo, hi] of segs) if (hi - lo > 0.15 && hi > 0.12) raised(ruin, height, [x, z], a, cw / 2, T / 2, yb, Math.max(0, lo), hi);
  }
  for (const o of openings){
    if (o.slot) continue;
    const [x, z, a] = at(o.c), hw = T / 2 + 0.1, yo = local ? height(x, z) : yB;
    if (o.circle) ruin.rings.push(ring([x, z], a, yo, 0, o.y, o.r, o.t, hw, 0, Math.PI * 2));
    else if (o.arch === 'round') ruin.rings.push(ring([x, z], a, yo, 0, o.spring, o.span / 2, o.t, hw, 0, Math.PI));
    else pointed(ruin, [x, z], a, yo, o.span, o.spring, o.t, hw);
  }
}
// a straight wall from p to q for wallCut: its length (m), and at() along it from its middle
const line = ([px, pz], [qx, qz]) => {
  const L = Math.hypot(qx - px, qz - pz), a = Math.atan2(qz - pz, qx - px), mx = (px + qx) / 2, mz = (pz + qz) / 2;
  return { len: L / M, at: m => [mx + Math.cos(a) * m * M, mz + Math.sin(a) * m * M, a], mid: [mx, mz] };
};
// a gable's outline: eaves at its sides, the ridge over its middle (m along it, half-width hw m)
const gableTop = (eaves, ridge, hw) => m => eaves + (ridge - eaves) * Math.max(0, 1 - Math.abs(m) / hw);

const LAY = {
  // A square tower, 6–7 m outside and walls a metre thick: two sides still
  // standing two storeys, one gone almost to the ground — the way in. Arrow
  // slits low in the standing sides, and a window up in the tallest where it's tall enough.
  tower(ruin, r, height){
    const s = (6 + r()) * M, t = 1.1 * M, [A, B, C, D] = rect(ruin, s - t, s - t);
    const tall = (3.5 + r() * 3);
    const sides = [[A, B], [B, C], [C, D], [D, A]], down = (r() * 4) | 0;
    sides.forEach(([p, q], k) => {
      if (k === down){ wall(ruin, r, height, p, q, t, t2 => 0.3 + 0.3 * Math.sin(t2 * 7), [[0.2, 0.8]]); return; }
      const prof = k === (down + 2) % 4 ? broken(r, tall, 0.55) : broken(r, tall * (0.5 + r() * 0.4), 0.3);
      const L = line(p, q), top = m => prof(m / L.len + 0.5), openings = [];
      const c = (r() - 0.5) * L.len * 0.4;
      if (top(c) > 2.6) openings.push({ slot: true, c, w: 0.2, sill: 1.1, top: 2.3 });
      const cw = (r() - 0.5) * L.len * 0.3;
      if (k === (down + 2) % 4 && top(cw) > 4.2) openings.push({ arch: 'round', c: cw, span: 0.8, sill: 2.6, spring: 3.4, t: 0.3 });
      wallCut(ruin, r, height, { ...L, T: t, yB: height(...L.mid), top, openings, step: 0.25, rough: 1, local: true });
    });
    rubble(ruin, r, height, 14, s * 0.9);
  },
  // A round tower, 10–11 m across outside (room for a crypt's stair inside): its door a storey up under a round arch,
  // small round-headed windows above it, and the side away from the door fallen
  // to the ground: the way in now. Its top slopes, highest over the door.
  round(ruin, r, height){
    const Ro = 5 + r() * 0.6, T = 1.4, Rm = Ro - T / 2, circ = 2 * Math.PI * Rm, half = circ / 2;
    const yB = height(ruin.x, ruin.z), t0 = r() * Math.PI * 2, tall = 9 + r() * 6, ph = r() * 6.3;
    const at = m => { const th = t0 + m / Rm; return [ruin.x + Math.cos(th) * Rm * M, ruin.z + Math.sin(th) * Rm * M, th + Math.PI / 2]; };
    const top = m => {
      const f = Math.abs(m) / half, gone = clamp((f - 0.55) / 0.3, 0, 1);       // 0 at the door … 1 opposite it
      return f > 0.93 ? 0 : tall * (0.8 + 0.2 * Math.cos(m / Rm)) * (0.92 + 0.08 * Math.sin(m * 1.3 + ph)) * (1 - 0.97 * gone);
    };
    const openings = [{ arch: 'round', c: 0, span: 1.0, sill: 2.8, spring: 4.6, t: 0.4 }];
    for (const side of [-1, 1]){
      const c = side * half * (0.15 + r() * 0.2), sill = 6 + r() * 3;
      if (top(c) > sill + 2) openings.push({ arch: 'round', c, span: 0.5, sill, spring: sill + 1, t: 0.25 });
    }
    wallCut(ruin, r, height, { len: circ, at, T: T * M, yB, top, openings, step: 0.25, rough: 0.6, local: true });
    rubble(ruin, r, height, 16, Ro * M * 1.4);
  },
  // Nine to thirteen stones on a ring 9–15 m across the radius, set facing
  // round it; a few have fallen. Sometimes an outlier stands off to the side.
  circle(ruin, r, height){
    const R = (9 + r() * 6) * M, n = 9 + ((r() * 5) | 0);
    for (let i = 0; i < n; i++){
      if (r() < 0.08) continue;                                   // one carted off
      const t = ruin.a + (i + (r() - 0.5) * 0.3) / n * Math.PI * 2;
      const x = ruin.x + Math.cos(t) * R, z = ruin.z + Math.sin(t) * R;
      const w = (0.8 + r() * 0.6) * M, d = (0.4 + r() * 0.25) * M, h = (1.3 + r() * 1.4) * M;
      const fallen = r() < 0.25;
      if (fallen){
        // lying where it fell, outward or in, its length along the fall
        const out = r() < 0.6 ? 1 : -1, fx = x + Math.cos(t) * out * h * 0.5, fz = z + Math.sin(t) * out * h * 0.5;
        ruin.stones.push({ x: fx, z: fz, a: t, hl: h / 2, hw: w / 2, y0: height(fx, fz) - 0.2, h: d, up: d - 0.2, fallen: true });
      } else {
        const lean = (r() - 0.5) * 0.12;
        ruin.stones.push({ x, z, a: t + Math.PI / 2 + lean, hl: w / 2, hw: d / 2, y0: height(x, z) - 0.4, h: h + 0.4, up: h });
      }
    }
    if (r() < 0.6){                                               // the outlier
      const t = ruin.a + r() * Math.PI * 2, x = ruin.x + Math.cos(t) * R * 1.7, z = ruin.z + Math.sin(t) * R * 1.7, h = (2.2 + r() * 0.8) * M;
      ruin.stones.push({ x, z, a: t, hl: 0.6 * M, hw: 0.45 * M, y0: height(x, z) - 0.4, h: h + 0.4, up: h });
    }
  },
  // A long hall, 12–15 m by 22–28 m, with a cross wall making an inner room:
  // nothing over head height left, most of it footings you step over.
  hall(ruin, r, height){
    const l = (22 + r() * 6) * M, w = (12 + r() * 3) * M, t = 0.8 * M, [A, B, C, D] = rect(ruin, l, w);
    const door = 0.3 + r() * 0.4;
    wall(ruin, r, height, A, B, t, broken(r, 1.6 + r() * 1.2, 0), [[door - 0.06, door + 0.06]]);
    wall(ruin, r, height, B, C, t, broken(r, 1.2 + r() * 1.4, 0));
    wall(ruin, r, height, C, D, t, broken(r, 0.8 + r() * 1.6, 0), [[0.4 + r() * 0.3, 0.6 + r() * 0.3]]);
    wall(ruin, r, height, D, A, t, broken(r, 1.4 + r() * 1.2, 0));
    // the cross wall a third of the way along, its doorway in the middle
    const k = 0.3 + r() * 0.08, P = (p, q) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    wall(ruin, r, height, P(A, B), P(D, C), t * 0.8, broken(r, 1.0 + r(), 0), [[0.38, 0.62]]);
    rubble(ruin, r, height, 22, Math.max(l, w) * 0.5);
  },
  // A grange: a walled yard 30–36 m by 24–28 m, the hall range along one side
  // and a barn along the next, the yard wall round the rest. All of it footings
  // but its gateway, still standing to 5–6 m round a round-headed cart arch.
  grange(ruin, r, height){
    const l = (30 + r() * 6) * M, w = (24 + r() * 4) * M, t = 0.8 * M, dh = 10 * M, db = 9 * M;
    const c = Math.cos(ruin.a), s = Math.sin(ruin.a), P = (u, v) => [ruin.x + c * u - s * v, ruin.z + s * u + c * v];
    const u0 = -l / 2, u1 = l / 2, v0 = -w / 2, v1 = w / 2, lh = (18 + r() * 4) * M;
    const low = hm => broken(r, hm, 0);
    // the hall range along the v0 side: its outer wall is the yard's, its door onto the yard
    wall(ruin, r, height, P(u0, v0), P(u1, v0), t, low(1.4 + r() * 1.2));
    wall(ruin, r, height, P(u0, v0 + dh), P(u0 + lh, v0 + dh), t, low(1.2 + r() * 1.2), [[0.45, 0.55]]);
    wall(ruin, r, height, P(u0 + lh, v0), P(u0 + lh, v0 + dh), t, low(1 + r() * 1.2));
    wall(ruin, r, height, P(u0 + lh * 0.35, v0), P(u0 + lh * 0.35, v0 + dh), t * 0.8, low(0.8 + r()), [[0.38, 0.62]]);
    ruin.stair = P(u0 + lh * 0.65, v0 + dh / 2);
    // the barn along the u1 side, a wide cart door onto the yard
    wall(ruin, r, height, P(u1, v0), P(u1, v1), t, low(1.6 + r() * 1.4));
    wall(ruin, r, height, P(u1 - db, v0 + dh), P(u1 - db, v1), t, low(1.2 + r() * 1.2), [[0.4, 0.62]]);
    wall(ruin, r, height, P(u1 - db, v0 + dh), P(u1, v0 + dh), t, low(1 + r()));
    // the yard wall round the rest, the gateway in its v1 side
    wall(ruin, r, height, P(u0, v0), P(u0, v1), t, low(0.8 + r() * 0.8), [[0.5 + r() * 0.2, 0.62 + r() * 0.2]]);
    const g = u0 + (u1 - db - u0) * (0.4 + r() * 0.2), gw = 3.2 * M;            // the gate, and its half-width of standing wall
    wall(ruin, r, height, P(u0, v1), P(g - gw, v1), t, low(0.7 + r() * 0.8));
    wall(ruin, r, height, P(g + gw, v1), P(u1, v1), t, low(0.7 + r() * 0.8));
    const L = line(P(g - gw, v1), P(g + gw, v1)), gt = 5 + r();
    wallCut(ruin, r, height, { ...L, T: t * 1.2, yB: height(...L.mid), top: m => gt * (1 - 0.35 * Math.abs(m) / L.len * 2), rough: 0.5,
      openings: [{ arch: 'round', c: 0, span: 3.4, sill: -1, spring: 2.8, t: 0.5 }], step: 0.4 });
    rubble(ruin, r, height, 30, Math.max(l, w) * 0.5);
  },
  // A chapel of nave and chancel: the nave 6–7 m by 8–10.5 m, the chancel narrower
  // and 4–5.5 m long. The wall between them stands to its peak round the chancel
  // arch; the chancel's east gable stands too, two lancets and an oculus cut in it;
  // the west door stands in its broken wall under a pointed arch. The side walls
  // are down to their footings and a bit.
  chapel(ruin, r, height){
    const ln = (8 + r() * 2.5) * M, w = (6 + r()) * M, lc = (4 + r() * 1.5) * M, wc = w * 0.68, t = 0.9 * M;
    const c = Math.cos(ruin.a), s = Math.sin(ruin.a), P = (u, v) => [ruin.x + c * u - s * v, ruin.z + s * u + c * v];
    const W = -ln / 2, J = ln / 2, E = ln / 2 + lc;
    wall(ruin, r, height, P(W, -w / 2), P(J, -w / 2), t, broken(r, 2.2, 0.25));
    wall(ruin, r, height, P(W, w / 2), P(J, w / 2), t, broken(r, 1.8, 0.25));
    wall(ruin, r, height, P(J, -wc / 2), P(E, -wc / 2), t, broken(r, 1.6, 0.2));
    wall(ruin, r, height, P(J, wc / 2), P(E, wc / 2), t, broken(r, 1.4, 0.2));
    const eaves = 3.6 + r() * 0.8;
    // the chancel arch, in the gable between nave and chancel
    const CA = line(P(J, -w / 2 - t / 2), P(J, w / 2 + t / 2)), span = wc / M - 1.2;
    wallCut(ruin, r, height, { ...CA, T: t, yB: height(...CA.mid), top: gableTop(eaves + 0.4, eaves + 0.4 + w / M * 0.55, CA.len / 2),
      openings: [{ arch: 'pointed', c: 0, span, sill: -1, spring: 3, t: 0.45 }], step: 0.3 });
    // the east gable: two lancets under an oculus
    const EG = line(P(E, -wc / 2 - t / 2), P(E, wc / 2 + t / 2));
    wallCut(ruin, r, height, { ...EG, T: t, yB: height(...EG.mid), top: gableTop(eaves, eaves + wc / M * 0.55, EG.len / 2), step: 0.25,
      openings: [-1, 1].map(sd => ({ arch: 'pointed', c: sd * 0.55, span: 0.6, sill: 1.6, spring: 3.2, t: 0.2 })).concat({ circle: true, c: 0, y: 4.7, r: 0.4, t: 0.22 }) });
    // the west wall, broken low but for the door standing in it
    const WW = line(P(W, -w / 2), P(W, w / 2)), low = broken(r, 1.4, 0.3);
    wallCut(ruin, r, height, { ...WW, T: t, yB: height(...WW.mid), rough: 0.6, step: 0.3,
      top: m => Math.max(low(m / WW.len + 0.5), Math.abs(m) < 1.6 ? 3.9 : 0),
      openings: [{ arch: 'pointed', c: 0, span: 1.4, sill: -1, spring: 2.3, t: 0.35 }] });
    rubble(ruin, r, height, 12, (ln + lc) * 0.5);
  },
  // An abbey church on the plan of the cathedral under the Lea (docs/under.md,
  // "Cathedrals"), in bays of 9: a nave of six and a square-ended choir of four,
  // aisled, 18 between the arcades and 36 across the aisle walls; a transept
  // crossing between them, its arms reaching 36 from the axis. 108u (72 m) long.
  // The villagers' forebears carted nearly all of it off: footings, arcade
  // plinths and pier stumps, fallen drums where a pier was, and three things
  // too big to take down: the west gable to its peak round an empty rose, the
  // crossing piers, and one arch of the nave still spanning two piers.
  abbey(ruin, r, height){
    ruin.a = (r() - 0.5) * 0.3;                                    // facing east (+x), near enough
    const B = 9, NH = 9, AO = 18, ARM = 36, W = -54, C0 = 0, C1 = 18, E = 54, T = 1.3 * M;
    const c = Math.cos(ruin.a), s = Math.sin(ruin.a), P = (u, v) => [ruin.x + c * u - s * v, ruin.z + s * u + c * v];
    ruin.stair = P((C0 + C1) / 2, 0);
    // the outer walls, down to their footings and breached where the stone was wanted
    const foot = (u0, v0, u1, v1, hmax) => {
      const gaps = [];
      for (let n = 1 + ((r() * 3) | 0); n > 0; n--){ const g = r(); gaps.push([g, g + 0.08 + r() * 0.2]); }
      wall(ruin, r, height, P(u0, v0), P(u1, v1), T, broken(r, hmax, 0), gaps);
    };
    for (const sd of [-1, 1]){
      foot(W, sd * AO, C0, sd * AO, 0.5 + r() * 1.0);            // the nave aisle
      foot(C0, sd * AO, C0, sd * ARM, 0.4 + r() * 0.8);          // the arm: its west wall,
      foot(C0, sd * ARM, C1, sd * ARM, 0.6 + r() * 1.2);         // its end,
      foot(C1, sd * ARM, C1, sd * AO, 0.4 + r() * 0.8);          // its east wall
      foot(C1, sd * AO, E, sd * AO, 0.5 + r() * 1.0);            // the choir aisle
      // the arcades' plinths, low enough to step over mostly
      wall(ruin, r, height, P(W, sd * NH), P(C0, sd * NH), 1.2 * M, broken(r, 0.3 + r() * 0.3, 0));
      wall(ruin, r, height, P(C1, sd * NH), P(E, sd * NH), 1.2 * M, broken(r, 0.3 + r() * 0.3, 0));
      // the west front's aisle ends, stepping down from the gable
      const hA = 4 + r() * 3;
      wall(ruin, r, height, P(W, sd * (NH + T / 2)), P(W, sd * AO), T, t => hA * (1 - 0.75 * t));
    }
    foot(E, -AO, E, AO, 1 + r() * 1.5);                           // the east end

    // The west gable, to its peak, one shoulder fallen: a door at its foot under
    // a pointed arch and the empty rose above
    const G = line(P(W, -NH - T / 2), P(W, NH + T / 2)), hw = G.len / 2;
    const eaves = 11 + r() * 2, ridge = eaves + 6, lost = r() < 0.5 ? -1 : 1;
    const ds = 2.8, dsp = 3.2, dt = 0.5, rr = 2.6, rt = 0.55, ry = dsp + ds * 0.866 + dt + 1 + rt + rr;
    const fallen = m => clamp((m * lost / hw - 0.35) / 0.4, 0, 1);                // 0 whole … 1 half gone
    wallCut(ruin, r, height, { ...G, T, yB: height(...G.mid),
      top: m => gableTop(eaves, ridge, hw)(m) * (1 - 0.5 * fallen(m)) + (fallen(m) > 0 ? (r() - 0.5) * 0.6 : 0),
      openings: [{ arch: 'pointed', c: 0, span: ds, sill: -1, spring: dsp, t: dt }, { circle: true, c: 0, y: ry, r: rr, t: rt }] });

    // the piers: a core with four shafts (compound), each shaft broken at its own height
    const drums = (o, dia) => {                                    // a pier gone over: its drums in a line where it fell
      const t = r() * Math.PI * 2;
      let d = dia * 0.8;
      for (let k = 2 + ((r() * 4) | 0); k > 0; k--){
        const len = (0.6 + r() * 0.3) * M, x = o[0] + Math.cos(t) * (d + len / 2), z = o[1] + Math.sin(t) * (d + len / 2);
        ruin.stones.push({ x, z, a: t + (r() - 0.5) * 0.5, hl: len / 2, hw: dia / 2, y0: height(x, z) - 0.25, h: dia, up: dia - 0.25, drum: true });
        d += len + (0.1 + r() * 0.6) * M;
      }
    };
    const pier = (u, v, big, h, even = false, yB = height(...P(u, v))) => {
      const o = P(u, v), cs = (big ? 2.2 : 1.5) * M / 2, ss = (big ? 0.8 : 0.55) * M / 2;
      raised(ruin, height, o, ruin.a, cs, cs, yB, 0, h);
      for (let q = 0; q < 4; q++){
        const t = ruin.a + q * Math.PI / 2, d = cs + ss * 0.8, hs = even ? h : h * (0.4 + r() * 0.8);
        if (hs > 0.2) raised(ruin, height, [o[0] + Math.cos(t) * d, o[1] + Math.sin(t) * d], ruin.a, ss, ss, yB, 0, hs);
      }
      return o;
    };
    // the one arch left standing: a bay of the nave, on one side, springing at 6.5 m
    const sa = r() < 0.5 ? -1 : 1, ka = 1 + ((r() * 3) | 0), spring = 6.5, cs = 0.75 * M;
    const AC = P(W + (ka + 0.5) * B, sa * NH), yA = height(...AC);
    for (const sd of [-1, 1]) for (const u of [W + B, W + 2 * B, W + 3 * B, W + 4 * B, W + 5 * B, C0, C1, C1 + B, C1 + 2 * B, C1 + 3 * B]){
      if (sd === sa && (u === W + ka * B || u === W + (ka + 1) * B)){ pier(u, sd * NH, false, spring, true, yA); continue; }
      if (u === C0 || u === C1){ const o = pier(u, sd * NH, true, 5 + r() * 2); if (r() < 0.5) drums(o, 1.4 * M); continue; }
      if (r() < 0.3){ if (r() < 0.75) drums(P(u, sd * NH), 1.1 * M); continue; }            // carted off, or fallen
      const o = pier(u, sd * NH, false, 0.3 + r() * r() * 1.8);
      if (r() < 0.25) drums(o, 1.1 * M);
    }
    pointed(ruin, AC, ruin.a, yA, (B - 2 * cs) / M, spring, 0.6, cs);

    // rubble at the foot of what stands, and a little everywhere
    for (let i = 0; i < 110; i++){ const p = ruin.pieces[(r() * ruin.pieces.length) | 0]; rubble(ruin, r, height, 1, 2.5 * M, [p.x, p.z]); }
  },
  // An aqueduct across a valley (aqueductLine() sites it), on round arches 2.2 m
  // piers apart, its channel 1.2 m above the lower of its two ends. Where the
  // valley is deep (over 14 m) it stands in two tiers of about half the height
  // each, the lower only where the ground falls far enough under it. Where the
  // ground rises toward the ends the arches go on, sinking into it. Two or three runs of it still stand, one
  // across the deepest part; of the rest, pier stumps and fallen stone.
  aqueduct(ruin, r, height){
    const c = Math.cos(ruin.a), s = Math.sin(ruin.a), P = m => [ruin.x + c * m * M, ruin.z + s * m * M];
    const Lm = ruin.len / M;
    let yB = Infinity;
    for (let m = -Lm / 2; m <= Lm / 2; m += 1) yB = Math.min(yB, height(...P(m)));
    const gm = m => (height(...P(m)) - yB) / M;                    // the ground at m along, m above the lowest
    const hD = Math.min(gm(-Lm / 2), gm(Lm / 2)) + 1.2, two = hD > 14, T = 2.4 * M;
    const sp = two ? 4.5 : clamp((hD - 1.4) * 0.5, 3.5, 6), pw = 2.2, bay = sp + pw;
    const T1 = hD * 0.5, s2 = hD - sp / 2 - 1.4, s1 = T1 - sp / 2 - 1.2;      // the lower tier's top; the springings
    const nb = Math.floor((Lm - pw) / bay), m0 = -nb * bay / 2;    // pier k stands at m0 + k * bay
    // which bays stand: a run across the deepest part, and one or two more
    const stand = new Uint8Array(nb);
    let dk = 0;
    for (let k = 1; k < nb; k++) if (gm(m0 + (k + 0.5) * bay) < gm(m0 + (dk + 0.5) * bay)) dk = k;
    const runs = [[dk - ((r() * 3) | 0), 3 + ((r() * 4) | 0)]];
    for (let n = 1 + ((r() * 2) | 0); n > 0; n--) runs.push([(r() * nb) | 0, 2 + ((r() * 4) | 0)]);
    for (const [k0, n] of runs) for (let k = Math.max(0, k0); k < Math.min(nb, k0 + n); k++) stand[k] = 1;
    for (let k = 0; k < nb; k++){
      if (!stand[k] || (k && stand[k - 1])) continue;
      let k1 = k; while (k1 + 1 < nb && stand[k1 + 1]) k1++;
      // bays k..k1 stand: one wall, its arches cut through it, its broken ends falling away
      const a0 = m0 + k * bay - pw / 2, a1 = m0 + (k1 + 1) * bay + pw / 2, mid = (a0 + a1) / 2, openings = [];
      for (let q = k; q <= k1; q++){
        const cm = m0 + (q + 0.5) * bay, gH = Math.max(gm(cm - sp / 2), gm(cm), gm(cm + sp / 2));
        const onLower = two && s1 + sp / 2 - gH > 1.5;                  // room for a lower arch: the upper stands on it
        if (onLower) openings.push({ arch: 'round', c: cm - mid, span: sp, sill: -1, spring: s1, t: 0.6 });
        if (s2 + sp / 2 - (onLower ? T1 : gH) > 1.5) openings.push({ arch: 'round', c: cm - mid, span: sp, sill: onLower ? T1 : -1, spring: s2, t: 0.6 });
      }
      const half = (a1 - a0) / 2, fall = 0.4 + r() * 0.5;
      const top = m => hD - (hD - s2) * fall * clamp(1 - (half - Math.abs(m)) / bay, 0, 1);
      wallCut(ruin, r, height, { len: a1 - a0, at: m => [...P(mid + m), ruin.a], T, yB, top, openings, step: 0.9, rough: 0.5 });
    }
    // the fallen stretches: their piers' stumps (a lone tall one now and then), and their stone
    for (let k = 0; k <= nb; k++){
      if (stand[k] || (k && stand[k - 1])) continue;
      const pm = m0 + k * bay, o = P(pm), g = gm(pm);
      if (r() < 0.25) continue;
      const h = two && g < T1 - 2.5 && r() < 0.3 ? s1 - g : 0.5 + r() * 3;
      raised(ruin, height, o, ruin.a, pw / 2 * M, T / 2, height(...o), 0, h);
      if (k < nb && !stand[k]) rubble(ruin, r, height, 4, 3 * M, P(pm + bay / 2));
    }
    ruin.labelR = 14;                                               // its name by its middle, not out past its ends
  },
};

// does a piece or stone stand too high to step over? (`up`: how high above the ground
// it stands). One hanging over a doorway (`lift`: its foot above the ground) is walked under.
const HEAD = 2.2 * M;
export const standing = o => !o.fallen && o.up >= STEP_OVER && !(o.lift > HEAD);
