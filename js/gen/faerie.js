// gen/faerie.js — where Faerie touches the Lea: the portals to its palaces, and the
// paths the Gentry walk between them (docs/magic.md "Faerie palaces"). Pure: the land
// only, and the thin places main.js hands in, so node can plan and check it.
//
//   planPortals(thin, opts)   4–6 portals, each beside a thin place (a stone circle, a
//                             sacred tree, a fairy ring), spread as far apart as they'll go
//   palaceSpec(p)             the level behind a portal: a crypt in the palace style
//                             (gen/under.js cryptStyle), entered level, two floors
//   portalPaths(portals, route)  the walks between them: each portal to its nearest two,
//                             by `route(x0, z0, x1, z1)` (guide.js planRoute, scenic)
//
// A portal is { id, x, z, y, face, stand, at, name, level, seed }: `face` is the way its
// front looks (away from the thin place, so you see the place behind it), `stand` the spot
// in front of it you step back out onto, `at` the kind of thin place it stands by.
//
// Behind the palaces, Faerie itself (docs/magic.md "The grounds and the Turning Stair"):
//   buildFaerie(spec)         any level of Faerie: a palace (with its door to the grounds),
//                             the grounds, or the stair
//   groundsSpec / stairSpec   the plans of the one shared grounds and the stair tower in them
//
// A level's mouth with `to: { level, mouth }` is a door into another level, not the way up.

import { mulberry32 } from '../rng.js';
import { buildLevel, grid, finish, CELL } from './under.js';
import { arcadeSpec, arcadeField, arcadeSolid } from './arcade.js';

export const PORTALS = [4, 6];          // how many, at least and at most
const NAMES = ['the Hollow Hall', 'the Glass Court', 'the Hall under the Hill', 'the Silver Court', 'the Bright Hall', 'the Court of the Thorn'];

// thin: [{ kind, x, z, r }] (r: how far out from its middle the place reaches); opts:
// { seed, size, walkable(x, z), height(x, z) }
export function planPortals(thin, { seed, size, walkable, height }){
  const r = mulberry32((seed ^ 0xfae7e) >>> 0);
  const want = Math.max(PORTALS[0], Math.min(PORTALS[1], Math.round(size / 600)));
  // a spot beside each candidate: just outside it, on walkable ground with room either side
  const spots = [];
  for (const t of thin){
    const a0 = r() * Math.PI * 2, out = (t.r || 4) + 3.5;
    for (let q = 0; q < 12; q++){
      const a = a0 + q * Math.PI / 6, x = t.x + Math.cos(a) * out, z = t.z + Math.sin(a) * out;
      const sx = x + Math.cos(a) * 3, sz = z + Math.sin(a) * 3, px = -Math.sin(a) * 1.5, pz = Math.cos(a) * 1.5;
      if (!walkable(x, z) || !walkable(sx, sz) || !walkable(x + px, z + pz) || !walkable(x - px, z - pz)) continue;
      spots.push({ x, z, face: a, stand: [sx, sz], at: t.kind });
      break;
    }
  }
  if (!spots.length) return [];
  // spread: first the one nearest the middle (so one is within reach of the start), then
  // each the one furthest from all those chosen (farthest-point sampling)
  const chosen = [spots.reduce((b, s) => Math.hypot(s.x, s.z) < Math.hypot(b.x, b.z) ? s : b)];
  while (chosen.length < Math.min(want, spots.length)){
    let best = null, bd = -1;
    for (const s of spots){
      const d = Math.min(...chosen.map(c => Math.hypot(c.x - s.x, c.z - s.z)));
      if (d > bd){ bd = d; best = s; }
    }
    if (bd < size * 0.08) break;                 // none left far enough apart to be worth it
    chosen.push(best);
  }
  return chosen.map((s, id) => ({ id, ...s, y: height(s.x, s.z), name: NAMES[id % NAMES.length], level: `palace:${id}`,
    seed: (seed ^ 0x9a1ace ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0 }));
}

// the level behind a portal: you step in through its front, so the palace runs on behind it
export function palaceSpec(p){
  return { id: p.level, kind: 'crypt', site: 'palace', floors: 2, stone: 'chalk', seed: p.seed, door: p.id,
    mouths: [{ x: p.x, z: p.z, y: p.y, face: p.face }] };
}

// the walks between portals: each to its two nearest, every pair once
export function portalPaths(portals, route){
  const pairs = new Set(), paths = [];
  for (const a of portals){
    const near = portals.filter(b => b !== a).sort((b, c) => Math.hypot(b.x - a.x, b.z - a.z) - Math.hypot(c.x - a.x, c.z - a.z)).slice(0, 2);
    for (const b of near){
      const key = [a.id, b.id].sort().join('-');
      if (pairs.has(key)) continue;
      pairs.add(key);
      const R = route(a.stand[0], a.stand[1], b.stand[0], b.stand[1]);
      if (!R || R.pts.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < R.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(R.pts[i][0] - R.pts[i - 1][0], R.pts[i][1] - R.pts[i - 1][1]));
      paths.push({ a: a.id, b: b.id, pts: R.pts, cum, len: cum.at(-1) });
    }
  }
  return paths;
}
// the point `s` along a path
export function alongPath(P, s){
  s = Math.max(0, Math.min(P.len, s));
  let lo = 1, hi = P.cum.length - 1;              // the first point at or past s
  while (lo < hi){ const m = (lo + hi) >> 1; if (P.cum[m] < s) lo = m + 1; else hi = m; }
  const i = lo;
  const f = (s - P.cum[i - 1]) / ((P.cum[i] - P.cum[i - 1]) || 1);
  return [P.pts[i - 1][0] + (P.pts[i][0] - P.pts[i - 1][0]) * f, P.pts[i - 1][1] + (P.pts[i][1] - P.pts[i - 1][1]) * f];
}

// ---- Faerie itself: the grounds, and the Turning Stair ------------------------------
// One grounds for every palace: each palace has a second door that opens onto it, so you
// can go in at one portal, cross the lawns and come out at another, far across the Lea.
// The stair tower stands among the palaces. Its plan, and the grounds' layout, are a
// first slice: I will lay the grounds out properly later (docs/magic.md).
export const GROUNDS = 'faerie:grounds', STAIR = 'faerie:stair';
const PAD = 0.35;                                   // a body's radius, as in gen/under.js
const TAU = Math.PI * 2, wrap = a => a - TAU * Math.round(a / TAU);

export function buildFaerie(spec){
  const L = spec.kind === 'grounds' ? buildGrounds(spec) : spec.kind === 'stair' ? buildStair(spec) : palace(spec);
  L.faerie = true;
  return L;
}
// a palace: no torches, braziers or candles (the Gentry's lights float instead), a door
// onto the grounds, and the lights' paths
function palace(spec){
  const L = buildLevel(spec);
  L.sconces = [];
  L.props = L.props.filter(p => p.kind !== 'brazier' && p.kind !== 'stand');
  groundsDoor(L, spec.door);
  L.wisps = palaceWisps(L);
  return L;
}
// first walkable spot going in from a door, as gen/under.js arrival()
function stepIn(L, m){
  for (let d = 3; d < 30; d += 0.5){
    const x = m.x - Math.cos(m.face) * d, z = m.z - Math.sin(m.face) * d;
    if (L.walkable(x, z)) return [x, z];
  }
  return null;
}

// A palace's door onto the grounds: where you'd look for the way on, in the landing you
// come into from the portal, in the wall that faces you as you come in if that wall's
// whole, else a side wall: a straight run of three cells, solid two deep behind, and no
// bookcase in front. Failing that, the nearest such wall on the first floor. Mouth 1 of the
// palace; what hung on that stretch of wall (a window, a tapestry) makes way for it.
export function groundsDoor(L, id){
  const { W, H } = L, at = (i, j) => i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1, op = k => k >= 0 && L.open[k] === 1;
  const m0 = L.mouths[0], inX = -Math.cos(m0.face), inZ = -Math.sin(m0.face);   // the way you walk in
  const near = (R, x, z) => Math.hypot(R.cx - x, R.cz - z);
  const landing = L.regions.filter(R => R.fl === 0 && R.kind === 'landing').sort((a, b) => near(a, m0.x, m0.z) - near(b, m0.x, m0.z))[0];
  let best = null;
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++){
    const k = j * W + i, R = op(k) && L.regions[L.reg[k]];
    if (!R || R.fl !== 0 || R.type === 'shaped' || R.type === 'corr' || R.type === 'stair') continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
      if (op(at(i + di, j + dj)) || op(at(i + 2 * di, j + 2 * dj))) continue;
      const li = -dj, lj = di;               // along the wall
      if (![-1, 1].every(s => { const a = at(i + s * li, j + s * lj); return op(a) && L.reg[a] === L.reg[k] && !op(at(i + s * li + di, j + s * lj + dj)); })) continue;
      const x = L.x0 + (i + 0.5 + di / 2) * CELL, z = L.z0 + (j + 0.5 + dj / 2) * CELL;
      if (L.shelves.some(sh => Math.hypot(sh.x - x, sh.z - z) < 3.5)) continue;
      const ahead = di * inX + dj * inZ;     // 1: the wall facing you as you come in
      const score = R === landing ? 1000 + ahead * 100 - near(R, x, z) : -Math.hypot(x - m0.x, z - m0.z);
      if (!best || score > best.score) best = { x, z, face: Math.atan2(dj, di), score };
    }
  }
  if (!best) return L;                         // (check-faerie fails a palace without one)
  const m = { x: best.x, z: best.z, y: L.floorAt(best.x, best.z), face: best.face, to: { level: GROUNDS, mouth: id }, grand: true,
    label: 'the door to the grounds', ask: "Tall doors, standing open. Beyond them, lawns under a sky that isn't the Lea's. Go out?", go: 'Go out.',
    desc: 'Tall doors, open on a starlit lawn.' };
  const p = stepIn(L, m);
  if (!p) return L;
  [m.inX, m.inZ] = p;
  L.mouths.push(m);
  L.panels = L.panels.filter(q => Math.hypot(q.x - m.x, q.z - m.z) > 4);
  L.tapestries = L.tapestries.filter(t => Math.hypot(t.x - m.x, t.z - m.z) > t.w / 2 + 3);
  return L;
}

// ---- the Gentry's lights: no torches in Faerie. Lights float instead, along paths that
// weave through the columns: braided round each row of piers, in and out of a ring of
// them, in a rose round a rotunda, in a figure across a hall without any; up the stair,
// in and out between its columns. A path is { pts: [[x, y, z], ...], loop } (loop: closed;
// otherwise there and back), its points no nearer a pier than its radius and a little,
// and under the vault. faerie-places-view.js wisps() draws them.
const WISP_CLEAR = 0.35;
export function palaceWisps(L){
  const piers = L.props.filter(p => p.kind === 'pier'), paths = [];
  const ceil = (x, z) => L.ceilAt ? L.ceilAt(x, z) : Infinity;
  const clear = ([x, y, z]) => L.isOpen(x, z) && y < ceil(x, z) - 0.6 && y > L.floorAt(x, z) + 1
    && piers.every(p => Math.hypot(p.x - x, p.z - z) > (p.r || 0.8) + WISP_CLEAR);
  const keep = path => { if (path.pts.length > 8 && path.pts.every(clear)) paths.push(path); };
  // how high a light may go at (x, z): from a little over the floor to a little under the vault
  const lo = (x, z) => L.floorAt(x, z) + 1.2, hi = (x, z) => Math.min(ceil(x, z) - 1, lo(x, z) + 40);
  const between = (x, z, f, cap = Infinity) => { const a = lo(x, z); return a + (Math.min(hi(x, z), cap) - a) * f; };   // f 0..1
  const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // rows of piers: in line along x or z, evenly a bay apart
  const used = new Set();
  for (const ax of ['x', 'z']){
    const other = ax === 'x' ? 'z' : 'x', lines = new Map();
    for (const p of piers){ const key = Math.round(p[other] * 2); if (!lines.has(key)) lines.set(key, []); lines.get(key).push(p); }
    for (const line of lines.values()){
      line.sort((a, b) => a[ax] - b[ax]);
      let run = [line[0]];
      const flush = () => {
        if (run.length >= 3){
          // up and down the whole height as they go: up to the vault beside a pier, ducking under
          // the capitals where they cross the row (the arches spring from there)
          const a = run[0], b = run.at(-1), n = run.length - 1, len = b[ax] - a[ax], A = (a.r || 0.95) + 1.1;
          const top = Math.min(...run.map(q => q.y + q.h)) - 0.6;
          for (const side of [1, -1]){                       // two strands, braided: each passes the piers on alternate sides
            const pts = [];
            for (let s = 0; s <= len; s += 0.5){
              const o = side * A * Math.cos(Math.PI * s / (len / n)), [x, z] = ax === 'x' ? [a.x + s, a.z + o] : [a.x + o, a.z + s];
              const f = 0.5 + 0.5 * Math.sin(Math.PI * s / (len / n) * 0.37 + (side > 0 ? 0 : 2.1)), free = smooth(0.45, 0.6, Math.abs(o) / A);
              pts.push([x, between(x, z, f, top + (hi(x, z) - top) * free), z]);
            }
            keep({ pts, loop: false });
          }
          run.forEach(q => used.add(q));
        }
      };
      for (let q = 1; q < line.length; q++){
        const gap = line[q][ax] - line[q - 1][ax];
        const mid = ax === 'x' ? [(line[q][ax] + line[q - 1][ax]) / 2, line[q].z] : [line[q].x, (line[q][ax] + line[q - 1][ax]) / 2];
        if (gap > 14 || !L.isOpen(...mid) || (run.length > 1 && Math.abs(gap - (run[1][ax] - run[0][ax])) > 0.5)){ flush(); run = []; }
        run.push(line[q]);
      }
      flush();
    }
  }
  // round rooms: in and out of their ring of piers, if they have one, else a rose
  for (const R of L.regions){
    if (R.type !== 'shaped' || !R.shape) continue;
    const { cx, cz } = R.shape;
    let Rr = 0; while (Rr < 80 && R.shape.inside(cx + Rr + 0.5, cz, 1.5)) Rr += 0.5;
    const ring = piers.filter(p => R.shape.inside(p.x, p.z, 0) && Math.hypot(p.x - cx, p.z - cz) > 2).sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
    const pts = [];
    if (ring.length >= 6){                     // in and out of the ring: outside one pier, inside the next
      const rr = ring.reduce((s, p) => s + Math.hypot(p.x - cx, p.z - cz), 0) / ring.length, A = (ring[0].r || 0.95) + 1.1, a0 = Math.atan2(ring[0].z - cz, ring[0].x - cx), top = Math.min(...ring.map(q => q.y + q.h)) - 0.6;
      for (let t = 0; t < Math.PI * 2; t += 0.02){
        const o = A * Math.cos(ring.length * t / 2), r = rr + o, x = cx + Math.cos(a0 + t) * r, z = cz + Math.sin(a0 + t) * r, free = smooth(0.45, 0.6, Math.abs(o) / A);
        pts.push([x, between(x, z, 0.5 + 0.5 * Math.sin(3 * t), top + (hi(x, z) - top) * free), z]);
      }
    } else {                                    // a rose, rising and falling through the dome
      for (let t = 0; t < Math.PI * 2; t += 0.01){ const r = Rr * (0.5 + 0.32 * Math.cos(5 * t)), x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r; pts.push([x, between(x, z, 0.5 + 0.5 * Math.sin(3 * t)), z]); }
    }
    keep({ pts, loop: true });
  }
  // into the great door to the grounds: a spiral, drawn into the dark and out again
  for (const m of L.mouths.filter(q => q.grand)){
    const fx = Math.cos(m.face), fz = Math.sin(m.face), tx = -fz, tz = fx, pts = [];
    for (let t = 0; t <= 1; t += 0.003){ const a = t * Math.PI * 2 * 4, r = 1.5 * (1 - t) + 0.1, d = 0.6 + 1.6 * (1 - t); pts.push([m.x - fx * d + tx * Math.cos(a) * r, m.y + 3.4 + Math.sin(a) * r, m.z - fz * d + tz * Math.cos(a) * r]); }
    keep({ pts, loop: false, door: true });
  }
  // halls with no piers: a figure across the floor, 3 to 2
  for (const R of L.regions){
    if (R.type !== 'vault' && R.type !== 'room') continue;
    const w = R.w * CELL, h = R.h * CELL;
    if (w * h < 150 || piers.some(p => !used.has(p) && Math.abs(p.x - R.cx) < w / 2 && Math.abs(p.z - R.cz) < h / 2)) continue;
    if (piers.some(p => Math.abs(p.x - R.cx) < w / 2 - 1 && Math.abs(p.z - R.cz) < h / 2 - 1)) continue;
    const ax = w / 2 - 2, az = h / 2 - 2, pts = [];
    for (let t = 0; t < Math.PI * 2; t += 0.01){ const x = R.cx + ax * Math.sin(3 * t), z = R.cz + az * Math.sin(2 * t + 0.5); pts.push([x, between(x, z, 0.5 + 0.5 * Math.sin(5 * t)), z]); }
    keep({ pts, loop: true });
  }
  return paths;
}
// the stair's: up ramp 0 in and out between its columns, over the well to ramp 1's top,
// down ramp 1 the same way, and back across the well at the foot; and a slow thread of
// them rising up the middle of the well
export function stairWisps(G){
  const cr = G.R0 + 0.09, A = 0.6, pts = [];
  // between the ramp and the one over it, rising and falling
  const weave = (k, th) => { const a = G.base(k) + th, r = cr + A * Math.cos(4 * (th - Math.PI / 8)); return [Math.cos(a) * r, G.y(th) + 1.3 + (G.P / 2 - 2.4) * (0.5 + 0.5 * Math.sin(3 * th + k)), Math.sin(a) * r]; };
  for (let th = 0; th <= G.thMax; th += 0.02) pts.push(weave(0, th));
  for (let th = G.thMax; th >= 0; th -= 0.02) pts.push(weave(1, th));
  const up = [];
  for (let t = 0; t <= 1; t += 0.002){ const a = t * Math.PI * 2 * 7; up.push([Math.cos(a) * 1.4, -0.5 + t * (G.top + 6), Math.sin(a) * 1.4]); }
  return [{ pts, loop: true }, { pts: up, loop: false }];
}

// ---- the Turning Stair: a double helix, after Bramante's in the Vatican (1505) and
// Giuseppe Momo's (1932). Two ramps wind round an open well, half a turn apart, so the
// one is always over the other and you never meet anyone on it: you can see the folk on
// the other ramp, across the well, but can't reach them. Both start at the foot, each by
// its own door onto the lawns, and both come up to a gallery under a dome, round the top
// of the shaft, where you look down into the whole helix.
//
// A level's floor is one height per cell, and a helix passes over itself, so the stair
// isn't laid on the grid: you're on a ramp, `th` (radians) along it, and each step adds
// the change of angle to `th`. The grid is only for the map.
export const HELIX = { R0: 3.2, R1: 9, R2: 13, P: 9, N: 3, LAND: 0.5, DOOR: 0.2 };
// R0 the well, R1 the shaft's wall, R2 the gallery's; P the rise of a ramp in a turn (so
// the other ramp is P/2 overhead); N turns; LAND radians of level landing at the top;
// DOOR how far along its ramp a foot door is (radians)
export function helixGeom(h = HELIX){
  const thMax = TAU * h.N, thL = thMax - h.LAND, top = h.P * thL / TAU;
  return { ...h, thMax, thL, top, base: k => k * Math.PI, y: th => h.P * Math.min(th, thL) / TAU };
}
export function stairSpec(halls){ return { id: STAIR, kind: 'stair', seed: 0x57a1, halls }; }
function buildStair(spec){
  const G = helixGeom(), { R0, R1, R2 } = G, n = spec.halls;
  const L = grid(-R2 - 2, -R2 - 2, R2 + 2, R2 + 2);
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const r = Math.hypot(L.x0 + (i + 0.5) * CELL, L.z0 + (j + 0.5) * CELL);
    if (r > R0 && r < R2) L.open[j * L.W + i] = 1;
  }
  L.props = []; L.finds = []; L.waters = []; L.kind = 'stair'; L.id = spec.id; L.helix = G; L.wisps = stairWisps(G);
  finish(L);
  // where you are: on ramp k (0 or 1) at th, or (k -1) in the gallery
  let at = { k: 0, th: G.DOOR };
  const yOf = q => q.k < 0 ? G.top : G.y(q.th);
  // where a step to (x, z) puts you, from where you are; null if you can't go there
  function resolve(x, z, s = at){
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    if (s.k >= 0){
      const th = s.th + wrap(a - (G.base(s.k) + s.th));
      if (th < 0 || th > G.thMax || r < R0 + PAD) return null;
      if (r > R1 - PAD){                                    // the shaft's wall, but at the top landing, where it's open
        if (th < G.thL + 0.12 || r > R2 - PAD) return null;
        if (r > R1) return { k: -1, th: 0 };
      }
      return { k: s.k, th };
    }
    if (r > R2 - PAD) return null;
    if (r >= R1 + PAD) return { k: -1, th: 0 };
    for (const k of [0, 1]){                              // back onto a ramp, through its landing's opening
      const th = G.thMax + wrap(a - (G.base(k) + G.thMax));
      if (th >= G.thL + 0.12 && th <= G.thMax && r > R0 + PAD) return r < R1 ? { k, th } : { k: -1, th: 0 };
    }
    return null;
  }
  L.walkable = (x, z) => !!resolve(x, z);
  L.floorAt = (x, z) => yOf(resolve(x, z) || at);
  L.openAt = L.isOpen = (x, z) => !!resolve(x, z);
  L.moved = (x, z) => { const q = resolve(x, z); if (q) at = q; };
  L.enter = k => { at = { k, th: G.DOOR }; };
  L.where = () => ({ ...at, y: yOf(at) });
  // the doors at the foot, each onto the lawns (the grounds' mouths n and n + 1)
  L.mouths = [0, 1].map(k => {
    const a = G.base(k) + G.DOOR, mid = (R0 + R1) / 2;
    return { x: Math.cos(a) * R1, z: Math.sin(a) * R1, y: 0, fy: G.y(G.DOOR), face: a, look: a + Math.PI / 2,
      inX: Math.cos(a) * mid, inZ: Math.sin(a) * mid, to: { level: GROUNDS, mouth: n + k },
      label: 'the door to the grounds', ask: 'A door at the foot of the stair, onto the lawns. Go out?', go: 'Go out.', desc: 'A door at the foot of the stair.' };
  });
  return L;
}

// ---- the grounds: a round lawn, the palaces' fronts in a ring round it, each facing in,
// with the stair tower among them, a pool in the middle and paths out to every door
export const GROUNDS_R = 112, RING = 64, ARCADE_R = 36;   // ARCADE_R: the arcade's radius round the pool, clear of the lantern posts
export function groundsSpec(halls, seed){ return { id: GROUNDS, kind: 'grounds', seed: (seed ^ 0x6a2d) >>> 0, halls }; }
function buildGrounds(spec){
  const r = mulberry32(spec.seed), n = spec.halls.length, G = helixGeom(), off = r() * TAU;
  const L = grid(-GROUNDS_R - 4, -GROUNDS_R - 4, GROUNDS_R + 4, GROUNDS_R + 4);
  L.props = []; L.finds = []; L.waters = [{ x: 0, z: 0, r: 9, y: -0.2 }];
  const slot = i => off + i * TAU / (n + 1);
  // each palace's front: a block w wide and d deep, its door on the face toward the middle
  const halls = spec.halls.map((h, i) => {
    const a = slot(i), w = 24 + r() * 8, d = 14, ht = 14 + r() * 6;
    return { ...h, a, w, d, h: ht, x: Math.cos(a) * (RING + d / 2), z: Math.sin(a) * (RING + d / 2), door: [Math.cos(a) * RING, Math.sin(a) * RING] };
  });
  // the stair tower, its two doors facing round the ring, either way
  const ta = slot(n), tc = RING + G.R2, rot = ta + Math.PI / 2 - G.DOOR;
  const tower = { x: Math.cos(ta) * tc, z: Math.sin(ta) * tc, rot, a: ta };
  const inBlock = (b, x, z, pad) => {
    const u = (x - b.x) * Math.cos(b.a) + (z - b.z) * Math.sin(b.a), v = -(x - b.x) * Math.sin(b.a) + (z - b.z) * Math.cos(b.a);
    return Math.abs(u) < b.d / 2 + pad && Math.abs(v) < b.w / 2 + pad;
  };
  const doors = [...halls.map(b => b.door), ...[0, 1].map(k => { const a = rot + G.base(k) + G.DOOR; return [tower.x + Math.cos(a) * G.R1, tower.z + Math.sin(a) * G.R1]; })];
  // paths: from the pool's rim out to each door, the tower's two by way of its front
  const paths = doors.map(([x, z]) => { const l = Math.hypot(x, z); return [[x / l * 10.5, z / l * 10.5], [x, z]]; });
  const segD = (x, z, [[ax, az], [bx, bz]]) => { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * L.W + i, x = L.x0 + (i + 0.5) * CELL, z = L.z0 + (j + 0.5) * CELL, rr = Math.hypot(x, z);
    if (rr > GROUNDS_R || halls.some(b => inBlock(b, x, z, 0.5)) || Math.hypot(x - tower.x, z - tower.z) < G.R1 + 1) continue;
    L.open[k] = 1;
    L.ceil[k] = 80;
    const nearDoor = Math.min(...doors.map(([dx, dz]) => Math.hypot(x - dx, z - dz)));
    L.floor[k] = rr < 9 ? -1.4 : rr < 10.5 ? 0.25 : 0.7 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.4) * Math.min(1, Math.max(0, (nearDoor - 6) / 12));
    L.tag[k] = rr < 10.5 ? 2 : paths.some(p => segD(x, z, p) < 1.6) ? 1 : 0;      // 2 the pool and its kerb, 1 a path
  }
  L.kind = 'grounds'; L.id = spec.id;
  finish(L);
  L.fronts = halls; L.tower = tower; L.paths = paths; L.stair = G;   // (fronts: L.halls is a cave's dripstone halls)
  // an arcade of worn openings (gen/arcade.js) across the path to the palace with the most
  // room either side, curved round the pool, the path through its middle opening
  const pa = doors.map(([x, z]) => Math.atan2(z, x)), gapAt = i => Math.min(...pa.filter((_, q) => q !== i).map(b => Math.abs(wrap(b - pa[i]))));
  const ai = halls.map((_, i) => i).reduce((b, i) => gapAt(i) > gapAt(b) ? i : b, 0);
  const AR = ARCADE_R, len = Math.min(46, 2 * (gapAt(ai) * AR - 7)), A = arcadeSpec(spec.seed ^ 0xa4c, { len });
  L.arcade = { ...A, a: pa[ai], R: AR, hall: halls[ai].name };
  const AF = arcadeField(A), walk0 = L.walkable;
  // where you stand against its stone: at your feet and at your head, a body's width off
  L.walkable = (x, z) => {
    if (!walk0(x, z)) return false;
    const s = wrap(Math.atan2(z, x) - L.arcade.a) * AR, v = Math.hypot(x, z) - AR;
    if (Math.abs(v) > 6 || Math.abs(s) > A.half + 4) return true;
    const y = L.floorAt(x, z);
    return !arcadeSolid(A, s, v, y + 0.3, 0.35, AF) && !arcadeSolid(A, s, v, y + 1.8, 0.35, AF);
  };
  L.mouths = [
    ...halls.map((b, i) => ({ x: b.door[0], z: b.door[1], y: 0, face: b.a, to: { level: b.level, mouth: 1 },
      label: b.name, ask: `The great doors of ${b.name}, standing open. Go in?`, go: 'Go in.', desc: `The great doors of ${b.name}.` })),
    ...[0, 1].map(k => { const [x, z] = doors[n + k]; return { x, z, y: 0, face: Math.atan2(tower.z - z, tower.x - x), to: { level: STAIR, mouth: k },
      label: 'the Turning Stair', ask: 'A round tower, a door at its foot, and inside a ramp going up and round. Go in?', go: 'Go in.', desc: 'A door into the Turning Stair.' }; }),
  ];
  for (const m of L.mouths){ const p = stepIn(L, m); [m.inX, m.inZ] = p || [m.x, m.z]; }
  return L;
}
