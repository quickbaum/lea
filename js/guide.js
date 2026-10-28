// guide.js — where Puck can take you, which way, and how he'd tell it.
// Pure (the land only, no three.js), so node can plan and check routes.
//
//   destinations(x, z)            the places worth walking to, nearest first
//   planRoute(x0, z0, x1, z1, s)  a walk there in one of two styles:
//                                   'road'   — the old road wherever it helps
//                                   'scenic' — off the road, through the woods and over the heath
//   routeOptions(x0, z0, dest)    the one or two routes worth offering
//   describeRoute(route)          "Take the old road north, then east through Shirn Wood."
//
// Routes are planned on a coarse grid (8u cells) over the whole Lea: the nav's
// fine grid (js/nav.js) gives up long before the far side of the map. The fine
// footwork is Puck's (he's fae; he hops round what he meets).

import { SIZE, WATER } from './config.js';
import { height, habitat, road, settlements, ruins, under } from './gen/land.js';
import { placeAt, settlementNames, ruinNames, underNames } from './gen/places.js';

const CELL = 8;
const HALF = SIZE / 2;
const N = Math.ceil(SIZE / CELL);
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
// a compass word for the way from a to b (north is -z)
export const bearing = (ax, az, bx, bz) => COMPASS[Math.round(((Math.atan2(bx - ax, -(bz - az)) * 180 / Math.PI + 360) % 360) / 45) % 8];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---- where to ------------------------------------------------------------------
// { name, kind, what, x, z, arrive, d }: `what` is how Puck introduces it ("the
// village of Thornwick", "old ruins: Genden Minster"), `arrive` how close counts
// as there. Settlements, ruins, caves and country tombs.
let DEST = null;
function allDestinations(){
  if (DEST) return DEST;
  DEST = [];
  const S = settlements().places, sn = settlementNames();
  S.forEach((p, i) => {
    const name = sn[i].name;
    const what = p.kind === 'village' ? `the village of ${name}` : p.kind === 'hamlet' ? `${name}, a hamlet` : `${name}, a farmstead`;
    DEST.push({ name, kind: p.kind, what, x: p.x, z: p.z, arrive: 22 });
  });
  const R = ruins(), rn = ruinNames();
  R.forEach((u, i) => {
    const what = u.kind === 'aqueduct' ? `an old aqueduct, ${rn[i].name}` : u.kind === 'circle' ? `a stone circle, ${rn[i].name}` : `an old ruin, ${rn[i].name}`;
    DEST.push({ name: rn[i].name, kind: u.kind, what, x: u.x, z: u.z, arrive: Math.min(40, Math.max(12, u.rad * 0.8)) });
  });
  const U = under(), un = underNames(), seen = new Set();
  for (const e of U.entrances){
    if (e.kind === 'stair' && e.site !== 'tomb') continue;             // a crypt's stair: the ruin over it is the place
    const key = e.level + (e.kind === 'cave' ? ':' + e.mouth : '');
    if (seen.has(key)) continue; seen.add(key);
    const name = un[e.level]?.name;
    if (!name) continue;
    DEST.push({ name, kind: e.kind === 'cave' ? 'cave' : 'tomb', what: e.kind === 'cave' ? `a cave mouth, ${name}` : `an old tomb, ${name}`,
      x: e.stand[0], z: e.stand[1], arrive: 8 });
  }
  return DEST;
}
// nearest first, and a cave's two mouths count once (its nearer); `skip` drops ones
// already offered, `near` the ones you're standing at; `kinds`, only those kinds
export function destinations(x, z, { skip = 0, n = 4, kinds = null } = {}){
  const by = new Map();
  for (const d of allDestinations()){
    if (kinds && !kinds.includes(d.kind)) continue;
    const dd = { ...d, d: Math.hypot(d.x - x, d.z - z) };
    if (dd.d < d.arrive) continue;
    const prev = by.get(d.name);
    if (!prev || dd.d < prev.d) by.set(d.name, dd);
  }
  return [...by.values()].sort((a, b) => a.d - b.d).slice(skip, skip + n);
}
// how far, as Puck reckons it (the player walks 8u a second)
export const farWord = d => d < 150 ? 'a short hop' : d < 400 ? 'a fair walk' : d < 800 ? 'a good long walk' : 'a long way';

// ---- the coarse grid -------------------------------------------------------------
// per cell: what the ground is (an index into GROUND), whether the road runs
// through it, and how steep it is. Built once, on the first route asked for.
const GROUND = ['meadow', 'heath', 'wood', 'grove', 'rock', 'wet', 'wetmeadow', 'field', 'lane', 'water'];
const GROUND_OF = { meadow: 0, green: 0, yard: 8, lane: 8, road: 8, beach: 0, heath: 1, woodland: 2, grove: 3, rock: 4,
  marsh: 5, fen: 5, carr: 5, wetmeadow: 6, field: 7, lake: 9 };
// what a step costs per unit, by ground: the road style wants the road, the scenic style
// the woods and heath and never the road (it is the other way, after all)
const COST = {
  road:   [1.0, 1.1, 1.3, 1.4, 1.8, 2.2, 1.4, 1.2, 0.9],
  scenic: [1.0, 0.85, 0.8, 0.75, 1.5, 2.2, 1.3, 1.3, 1.1],
};
const ROAD_COST = { road: 0.4, scenic: 1.6 };
let GRID = null;
function grid(){
  if (GRID) return GRID;
  const g = new Uint8Array(N * N), onRoad = new Uint8Array(N * N), slope = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const x = -HALF + (i + 0.5) * CELL, z = -HALF + (j + 0.5) * CELL, k = j * N + i, h = height(x, z);
    g[k] = h < WATER + 0.2 || Math.hypot(x, z) > HALF * 0.98 ? 9 : GROUND_OF[habitat(x, z, h)] ?? 0;
    slope[k] = Math.hypot(height(x + 4, z) - height(x - 4, z), height(x, z + 4) - height(x, z - 4)) / 8;
  }
  const R = road();
  for (let s = 0; s < R.xs.length; s++){
    const i = Math.floor((R.xs[s] + HALF) / CELL), j = Math.floor((R.zs[s] + HALF) / CELL);
    if (i >= 0 && j >= 0 && i < N && j < N && g[j * N + i] !== 9) onRoad[j * N + i] = 1;
  }
  return GRID = { g, onRoad, slope };
}
const cellOf = (x, z) => [Math.max(0, Math.min(N - 1, Math.floor((x + HALF) / CELL))), Math.max(0, Math.min(N - 1, Math.floor((z + HALF) / CELL)))];
const centre = k => [-HALF + (k % N + 0.5) * CELL, -HALF + (((k / N) | 0) + 0.5) * CELL];

// A* over the coarse grid: { pts: [[x, z] …] from start to end, len, road: u on the road }, or null
export function planRoute(x0, z0, x1, z1, style = 'road'){
  const { g, onRoad, slope } = grid(), W = COST[style];
  const cost = k => g[k] === 9 ? Infinity : (onRoad[k] ? ROAD_COST[style] : W[g[k]]) * (1 + 4 * Math.min(slope[k], 1));
  const minC = Math.min(ROAD_COST[style], ...W);
  // a start or end in the water (a cave mouth on the shore): the nearest dry cell
  const dry = (x, z) => {
    let [i, j] = cellOf(x, z);
    if (g[j * N + i] !== 9) return j * N + i;
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++){
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < N && b < N && g[b * N + a] !== 9) return b * N + a;
    }
    return -1;
  };
  const s = dry(x0, z0), t = dry(x1, z1);
  if (s < 0 || t < 0) return null;
  const ti = t % N, tj = (t / N) | 0;
  const hEst = k => { const dx = Math.abs(k % N - ti), dz = Math.abs(((k / N) | 0) - tj); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * minC; };
  const gs = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N);
  // a binary heap of [f, k]
  const heap = [], push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i){ const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length){ heap[0] = last; let i = 0; for (;;){ const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  gs[s] = 0; push(hEst(s), s);
  while (heap.length){
    const [, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === t) break;
    const i = k % N, j = (k / N) | 0, ck = cost(k);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a, cq = cost(q);
      if (cq === Infinity || done[q]) continue;
      if (di && dj && (g[j * N + a] === 9 || g[b * N + i] === 9)) continue;     // no cutting a shore's corner
      const step = (di && dj ? 1.414 : 1) * (ck + cq) / 2, ng = gs[k] + step;
      if (ng < gs[q]){ gs[q] = ng; from[q] = k; push(ng + hEst(q), q); }
    }
  }
  if (!done[t]) return null;
  const cells = [];
  for (let k = t; k >= 0; k = from[k]) cells.push(k);
  cells.reverse();
  // the cells' centres, softened (two rounds of corner-cutting) so the way doesn't zigzag
  let pts = [[x0, z0], ...cells.slice(1, -1).map(centre), [x1, z1]];
  for (let it = 0; it < 2; it++){
    const out = [pts[0]];
    for (let q = 0; q + 1 < pts.length; q++){
      const [ax, az] = pts[q], [bx, bz] = pts[q + 1];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(pts[pts.length - 1]); pts = out;
  }
  let len = 0, onR = 0;
  for (let q = 0; q + 1 < pts.length; q++){
    const L = Math.hypot(pts[q + 1][0] - pts[q][0], pts[q + 1][1] - pts[q][1]);
    len += L;
    const [i, j] = cellOf(pts[q][0], pts[q][1]);
    if (onRoad[j * N + i]) onR += L;
  }
  return { pts, len, road: onR, style };
}

// The routes worth offering to `dest`: the road way, and the scenic way when it
// really is another way (not the road's own line give or take, nor much longer).
// If the road barely helps, just the one way, called 'direct'.
export function routeOptions(x0, z0, dest){
  const byRoad = planRoute(x0, z0, dest.x, dest.z, 'road');
  if (!byRoad) return [];
  const scenic = planRoute(x0, z0, dest.x, dest.z, 'scenic');
  if (byRoad.road < 60 || byRoad.road < byRoad.len * 0.25) return [{ ...(scenic && scenic.len < byRoad.len * 1.15 ? scenic : byRoad), style: 'direct' }];
  if (!scenic || scenic.len > byRoad.len * 1.6 || overlap(byRoad, scenic) > 0.6) return [byRoad];
  return [byRoad, scenic];
}
// how much of b runs within a cell or two of a
function overlap(a, b){
  const cells = new Set(a.pts.map(([x, z]) => cellOf(x, z).join()));
  let near = 0;
  for (const [x, z] of b.pts){
    const [i, j] = cellOf(x, z);
    let hit = false;
    for (let dj = -2; dj <= 2 && !hit; dj++) for (let di = -2; di <= 2 && !hit; di++) hit = cells.has(`${i + di},${j + dj}`);
    if (hit) near++;
  }
  return near / b.pts.length;
}

// ---- the route, told -------------------------------------------------------------
// The legs of a route: stretches on the road, or through one named region, each
// with its compass way. Stretches under 40u fold into the one before.
export function routeLegs(route){
  const { onRoad } = grid(), legs = [];
  const step = 8, P = route.pts;
  let acc = 0;
  for (let q = 0; q + 1 < P.length; q++){
    const [ax, az] = P[q], [bx, bz] = P[q + 1], L = Math.hypot(bx - ax, bz - az);
    for (let u = 0; u < L; u += step){
      const x = ax + (bx - ax) * u / L, z = az + (bz - az) * u / L, [i, j] = cellOf(x, z);
      const road = !!onRoad[j * N + i], reg = placeAt(x, z), key = road ? 'road' : reg ? reg.id : '?';
      const last = legs[legs.length - 1];
      if (last && last.key === key){ last.x1 = x; last.z1 = z; last.len += Math.min(step, L - u); last.s1 = acc + u; }
      else legs.push({ key, road, place: road ? null : reg, x0: x, z0: z, x1: x, z1: z, len: Math.min(step, L - u), s0: acc + u, s1: acc + u });
    }
    acc += L;
  }
  // fold the short ones into their neighbour (the one before, else the one after)
  for (let q = 0; q < legs.length; q++){
    if (legs[q].len >= 40 || legs.length === 1) continue;
    const into = q > 0 ? legs[q - 1] : legs[q + 1];
    if (q > 0){ into.x1 = legs[q].x1; into.z1 = legs[q].z1; into.s1 = legs[q].s1; }
    else { into.x0 = legs[q].x0; into.z0 = legs[q].z0; into.s0 = legs[q].s0; }
    into.len += legs[q].len;
    legs.splice(q--, 1);
  }
  // and merge what's now next to its like
  for (let q = 1; q < legs.length; q++) if (legs[q].key === legs[q - 1].key){
    const a = legs[q - 1]; a.x1 = legs[q].x1; a.z1 = legs[q].z1; a.s1 = legs[q].s1; a.len += legs[q].len; legs.splice(q--, 1);
  }
  for (const l of legs) l.dir = bearing(l.x0, l.z0, l.x1, l.z1);
  return legs;
}
// the way you cross a region of each kind
const THROUGH = { wood: 'through', grove: 'through', carr: 'through', meadow: 'across', wetmeadow: 'across', marsh: 'across', fen: 'across',
  heath: 'over', rock: 'over', lake: 'along', greatlake: 'along the shore of', island: 'across' };
// "Take the old road north, then east through Shirn Wood, then over Dirn Heath."
// At most four legs: past that, the middle ones go unsaid ("…, and on to …").
export function describeRoute(route){
  const legs = routeLegs(route);
  const said = legs.length > 4 ? [legs[0], legs[1], legs[legs.length - 1]] : legs;
  const parts = said.map((l, q) => {
    if (l.road) return q === 0 ? `take the old road ${l.dir}` : `follow the old road ${l.dir}`;
    const name = l.place?.name || 'open country';
    return `${l.dir} ${THROUGH[l.place?.kind] || 'across'} ${name}`;
  });
  let text = parts[0];
  for (let q = 1; q < parts.length; q++) text += (legs.length > 4 && q === parts.length - 1 ? ', and on ' : ', then ') + parts[q];
  return cap(text) + '.';
}
