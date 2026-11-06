// The settlements' buildings, drawn (js/gen/settle.js plans them, land.js levels
// their pads): long log houses and cottages under thatch, plank barns and sheds
// under shingles, granaries up on posts, and a well on the village green. Each
// settlement is a handful of merged meshes — one per material — so the whole
// lot is a few dozen draw calls, static, frustum-culled by settlement.

import * as THREE from 'three';
import { settlements } from './terrain.js';
import { KINDS } from './gen/settle.js';
import { height } from './terrain.js';
import { UNITS_PER_M } from './config.js';
import { makeTexture } from './textures.js';
import { mulberry32 } from './rng.js';

const M = UNITS_PER_M;
const TILE = 2 * M;              // world size of one texture tile (2 m)
const SINK = 0.4;                // walls run this far below the pad, so no gap shows on its feathered edge
const OVER_EAVE = 0.4 * M;       // roof overhang past the walls
const OVER_GABLE = 0.3 * M;
const POST = 0.24 * M;           // corner posts
const DARK = [0.22, 0.16, 0.10], SHUTTER = [0.17, 0.12, 0.08], POSTC = [0.30, 0.23, 0.15];
const WIN_DARK = [0.10, 0.08, 0.06], WIN_LIT = [1.0, 0.70, 0.34], STONE = [0.45, 0.43, 0.40];

// ---- textures (32px a tile, nearest-filtered like the rest of the world) ------------
export function pixels(seed, draw){
  return makeTexture(32, 32, (g, w, h) => {
    const r = mulberry32(seed), img = g.createImageData(w, h), d = img.data;
    draw(r, (x, y, [cr, cg, cb]) => {
      const o = (y * w + x) * 4;
      d[o] = Math.max(0, Math.min(255, cr)); d[o + 1] = Math.max(0, Math.min(255, cg)); d[o + 2] = Math.max(0, Math.min(255, cb)); d[o + 3] = 255;
    });
    g.putImageData(img, 0, 0);
  }, { repeat: [1, 1] });
}
const shade = (c, k, n = 0) => c.map(v => v * k + n);
// horizontal logs, 4px (~0.25 m) each: lit on top, clay chinking in the joint
const logsTexture = () => pixels(0x1095, (r, put) => {
  for (let row = 0; row < 8; row++){
    const base = shade([112, 90, 64], 0.85 + r() * 0.25);
    for (let x = 0; x < 32; x++) for (let k = 0; k < 4; k++){
      const n = (r() - 0.5) * 14;
      put(x, row * 4 + k, k === 3 ? [118, 108, 92].map(v => v + n * 0.5) : shade(base, [1.12, 1.0, 0.88][k], n));
    }
  }
});
// vertical boards, 4px each, dark gaps, the odd knot
const boardsTexture = () => pixels(0xb0a2d, (r, put) => {
  for (let col = 0; col < 8; col++){
    const base = shade([116, 104, 86], 0.8 + r() * 0.3), knot = r() < 0.4 ? (r() * 30) | 0 : -9;
    for (let y = 0; y < 32; y++) for (let k = 0; k < 4; k++){
      const n = (r() - 0.5) * 12;
      let c = k === 3 ? shade(base, 0.45) : shade(base, k === 0 ? 1.08 : 1, n);
      if (Math.abs(y - knot) < 1 && k === 1) c = shade(base, 0.6);
      put(col * 4 + k, y, c);
    }
  }
});
// thatch: straws down the slope, in courses
const thatchTexture = () => pixels(0x7a7c4, (r, put) => {
  const streak = Array.from({ length: 32 }, () => 0.85 + r() * 0.3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
    const n = (r() - 0.5) * 22, course = y % 8 === 7 ? 0.68 : y % 8 === 0 ? 1.1 : 1;
    put(x, y, shade([146, 122, 76], streak[x] * course, n));
  }
});
// split shingles in staggered rows, silvered with weather
const shingleTexture = () => pixels(0x5419e, (r, put) => {
  for (let row = 0; row < 8; row++){
    let x = row % 2 ? 2 : 0;
    const cuts = new Set();
    while (x < 32){ cuts.add(x); x += 3 + ((r() * 3) | 0); }
    let tone = 1;
    for (let x = 0; x < 32; x++){
      if (cuts.has(x)) tone = 0.8 + r() * 0.35;
      for (let k = 0; k < 4; k++){
        const n = (r() - 0.5) * 10;
        put(x, row * 4 + k, cuts.has(x) || k === 3 ? shade([98, 90, 80], 0.55) : shade([104, 96, 84], tone * (k === 0 ? 1.08 : 1), n));
      }
    }
  }
});

let MATS = null;
function materials(){
  if (MATS) return MATS;
  const mat = (map, side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ map, vertexColors: true, side });
  return MATS = {
    logs: mat(logsTexture()), boards: mat(boardsTexture()),
    thatch: mat(thatchTexture(), THREE.DoubleSide), shingle: mat(shingleTexture(), THREE.DoubleSide),
    detail: new THREE.MeshLambertMaterial({ vertexColors: true }),
    windows: new THREE.MeshBasicMaterial({ vertexColors: true }),           // unlit: a lamp shows at night
    crops: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    logpile: new THREE.MeshLambertMaterial({ color: 0x6b5236 }),
    smoke: new THREE.PointsMaterial({ map: puffTexture(), size: 2.6, vertexColors: true, transparent: true, depthWrite: false }),
  };
}

// ---- geometry -----------------------------------------------------------------------
// Flat-shaded triangles in world space; each face is wound to face `out`.
export class Geo {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; }
  tri(a, b, c, ua, ub, uc, out, col){
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0){ [b, c] = [c, b]; [ub, uc] = [uc, ub]; n = n.map(v => -v); }
    const l = Math.hypot(...n) || 1;
    for (const [v, u] of [[a, ua], [b, ub], [c, uc]]){
      this.p.push(...v); this.n.push(n[0] / l, n[1] / l, n[2] / l); this.uv.push(...u); this.c.push(...col);
    }
  }
  quad(a, b, c, d, ua, ub, uc, ud, out, col){ this.tri(a, b, c, ua, ub, uc, out, col); this.tri(a, c, d, ua, uc, ud, out, col); }
  // an upright box (no bottom) centred at (x, z), from y0 to y1, turned to angle a
  box(x, z, y0, y1, sx, sz, a, col){
    const c = Math.cos(a), s = Math.sin(a), P = (u, v, y) => [x + c * u - s * v, y, z + s * u + c * v];
    const hx = sx / 2, hz = sz / 2, Z = [0, 0];
    for (const [u0, v0, u1, v1, ox, oz] of [[-hx, -hz, hx, -hz, 0, -1], [hx, -hz, hx, hz, 1, 0], [hx, hz, -hx, hz, 0, 1], [-hx, hz, -hx, -hz, -1, 0]])
      this.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), Z, Z, Z, Z, [c * ox - s * oz, 0, s * ox + c * oz], col);
    this.quad(P(-hx, -hz, y1), P(hx, -hz, y1), P(hx, hz, y1), P(-hx, hz, y1), Z, Z, Z, Z, [0, 1, 0], col);
  }
  mesh(mat){
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
  }
}

// One building into the per-material geometries.
function addBuilding(G, b, r){
  const k = KINDS[b.kind], { hl, hw } = b;
  const lx = Math.cos(b.a), lz = Math.sin(b.a), cx = -lz, cz = lx;
  const P = (u, v, y) => [b.x + lx * u + cx * v, y, b.z + lz * u + cz * v];
  const out = (u, v, y = 0) => [lx * u + cx * v, y, lz * u + cz * v];
  const floor = b.y + (k.raised || 0) * M, y0 = k.raised ? floor : b.y - SINK;
  const E = floor + k.eaves * M, pitch = Math.tan(k.pitch * Math.PI / 180), R = E + hw * pitch;
  // weathering: each building a little lighter or darker, greyer or warmer
  const t = 0.82 + b.tint * 0.24, warm = r() * 0.08;
  const wallC = [t + warm, t, t - warm], roofC = [t, t, t];
  const W = G[k.wall], RF = G[k.roof], D = G.detail;
  const uvW = (along, y) => [along / TILE, (y - y0) / TILE];
  // the long walls
  for (const s of [-1, 1]){
    const v = s * hw;
    W.quad(P(-hl, v, y0), P(hl, v, y0), P(hl, v, E), P(-hl, v, E), uvW(0, y0), uvW(2 * hl, y0), uvW(2 * hl, E), uvW(0, E), out(0, s), wallC);
  }
  // the gable ends: a wall and the triangle up to the ridge
  for (const s of [-1, 1]){
    const u = s * hl;
    W.quad(P(u, -hw, y0), P(u, hw, y0), P(u, hw, E), P(u, -hw, E), uvW(0, y0), uvW(2 * hw, y0), uvW(2 * hw, E), uvW(0, E), out(s, 0), wallC);
    W.tri(P(u, -hw, E), P(u, hw, E), P(u, 0, R), uvW(0, E), uvW(2 * hw, E), uvW(hw, R), out(s, 0), wallC);
  }
  // the roof: two slopes, overhanging walls and gables
  const ue = hl + OVER_GABLE, ve = hw + OVER_EAVE, yE = E - OVER_EAVE * pitch, slant = Math.hypot(ve, R - yE);
  for (const s of [-1, 1]){
    RF.quad(P(-ue, s * ve, yE), P(ue, s * ve, yE), P(ue, 0, R), P(-ue, 0, R),
      [0, 0], [2 * ue / TILE, 0], [2 * ue / TILE, slant / TILE], [0, slant / TILE], out(0, s * pitch, 1), roofC);
  }
  // corner posts
  for (const u of [-1, 1]) for (const v of [-1, 1]){
    const [x, , z] = P(u * (hl - POST * 0.3), v * (hw - POST * 0.3), 0);
    D.box(x, z, y0, E, POST, POST, b.a, POSTC);
  }
  // up on posts: the stilts, and a floor to hide the underside
  if (k.raised){
    for (const u of [-1, 1]) for (const v of [-1, 1]){
      const [x, , z] = P(u * (hl - POST), v * (hw - POST), 0);
      D.box(x, z, b.y - SINK, floor, POST * 1.2, POST * 1.2, b.a, POSTC);
    }
    const Z = [0, 0];
    D.quad(P(-hl, -hw, floor), P(hl, -hw, floor), P(hl, hw, floor), P(-hl, hw, floor), Z, Z, Z, Z, [0, -1, 0], POSTC);
  }
  // the door, on the long side toward the green or yard; a barn's is a wide double one
  const big = b.kind === 'barn', dw = (big ? 2.6 : k.raised ? 0.7 : 0.95) * M, dh = Math.min(E - floor - 0.2, (big ? 2.4 : k.raised ? 1.1 : 1.8) * M);
  const du = b.dwelling ? b.du : big || k.raised ? 0 : (r() - 0.5) * hl * 0.6, dv = b.door * (hw + 0.04), Z = [0, 0];
  const dFloor = k.raised ? floor + 0.1 : b.y;
  D.quad(P(du - dw / 2, dv, dFloor), P(du + dw / 2, dv, dFloor), P(du + dw / 2, dv, dFloor + dh), P(du - dw / 2, dv, dFloor + dh), Z, Z, Z, Z, out(0, b.door), DARK);
  if (!b.dwelling) return null;
  // a dwelling's windows: either side of the door and one at the back. They're
  // their own mesh, unlit, so they can glow when someone is home after dark
  // (update below); the record says which vertices are this house's.
  const wy = b.y + 1.0 * M, wh = 0.5 * M, ww = 0.6 * M, from = G.windows.p.length / 3;
  for (const [u, side] of [[du - hl * 0.5, b.door], [du + hl * 0.5, b.door], [-du * 0.6, -b.door]]){
    if (Math.abs(u) > hl - 0.8 * M || Math.abs(u - du) < dw) continue;
    const v = side * (hw + 0.05);
    G.windows.quad(P(u - ww / 2, v, wy), P(u + ww / 2, v, wy), P(u + ww / 2, v, wy + wh), P(u - ww / 2, v, wy + wh), Z, Z, Z, Z, out(0, side), WIN_DARK);
  }
  const rec = { b, win: [from, G.windows.p.length / 3], flicker: r() * 10 };
  // the chimney: a stone stack up through the ridge over the hearth
  const cs = 0.75 * M;
  D.box(b.x, b.z, R - 1.2, R + 1.1 * M, cs, cs, b.a, STONE.map(c => c * (0.9 + r() * 0.15)));
  rec.top = [b.x, R + 1.1 * M + 0.1, b.z];
  // where the woodpile stacks up: against the gable end away from the door
  const ge = (du > 0 ? -1 : 1) * (hl + 0.45);
  rec.pile = { x: P(ge, 0, 0)[0], z: P(ge, 0, 0)[2], y: b.y, a: b.a, ge };
  return rec;
}

// A timber well-head: a cribbed square curb, two posts, a windlass beam, a little roof.
function addWell(G, w){
  const D = G.detail, y = w.y, s = 1.5 * M, h = 0.8 * M, t = 0.2 * M, Z = [0, 0];
  for (const [ox, oz, sx, sz] of [[0, -s / 2, s, t], [0, s / 2, s, t], [-s / 2, 0, t, s], [s / 2, 0, t, s]])
    D.box(w.x + ox, w.z + oz, y - SINK, y + h, sx, sz, 0, [0.42, 0.34, 0.24]);
  D.quad([w.x - s / 2, y + 0.3, w.z - s / 2], [w.x + s / 2, y + 0.3, w.z - s / 2], [w.x + s / 2, y + 0.3, w.z + s / 2], [w.x - s / 2, y + 0.3, w.z + s / 2], Z, Z, Z, Z, [0, 1, 0], [0.06, 0.07, 0.08]);
  const top = y + 2.1 * M;
  for (const sx of [-1, 1]) D.box(w.x + sx * s / 2, w.z, y - SINK, top, t, t, 0, POSTC);
  D.box(w.x, w.z, top - 0.9 * M, top - 0.75 * M, s, 0.14 * M, 0, POSTC);     // the windlass
  const R = G.shingle, half = s * 0.75, ry = top + 0.45 * M;
  for (const sz of [-1, 1])
    R.quad([w.x - half, top - 0.1, w.z + sz * half], [w.x + half, top - 0.1, w.z + sz * half], [w.x + half, ry, w.z], [w.x - half, ry, w.z],
      [0, 0], [2 * half / TILE, 0], [2 * half / TILE, 0.5], [0, 0.5], [0, 1, sz], [0.9, 0.9, 0.9]);
}

// a soft puff of smoke, pixel-edged like everything else
const puffTexture = () => makeTexture(16, 16, (g, w, h) => {
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const r = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2), o = (y * w + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.max(0, 1 - r * r) * 255 | 0;
  }
  g.putImageData(img, 0, 0);
});

// ---- the crops ----------------------------------------------------------------------
// A field's rows, as low ridges following the ground along its length, in five
// stages from ploughed earth to ripe grain. Rebuilt only when the stage changes.
const CROP_STAGES = [
  { h: 0.10, c: [0.30, 0.22, 0.14] },       // sown: ridged earth
  { h: 0.30, c: [0.38, 0.52, 0.20] },       // shoots
  { h: 0.65, c: [0.33, 0.50, 0.18] },       // in leaf
  { h: 0.95, c: [0.56, 0.54, 0.24] },       // turning
  { h: 1.15, c: [0.74, 0.62, 0.28] },       // ripe
];
function cropGeometry(f, stage){
  const G = new Geo(), { h, c } = CROP_STAGES[stage], lx = Math.cos(f.a), lz = Math.sin(f.a), cx = -lz, cz = lx;
  const P = (u, v) => { const x = f.x + lx * u + cx * v, z = f.z + lz * u + cz * v; return [x, height(x, z), z]; };
  const Z = [0, 0], rows = Math.max(2, Math.floor(2 * f.hw / 1.5)), gap = 2 * f.hw / rows, half = 0.35;
  for (let k = 0; k < rows; k++){
    const v = -f.hw + gap * (k + 0.5);
    for (let u = -f.hl + 0.6; u < f.hl - 0.6; u += 2){
      const u1 = Math.min(f.hl - 0.6, u + 2);
      const a0 = P(u, v - half), a1 = P(u1, v - half), b0 = P(u, v + half), b1 = P(u1, v + half);
      const r0 = P(u, v), r1 = P(u1, v); r0[1] += h; r1[1] += h;
      const shade = c.map(x => x * (0.9 + 0.1 * Math.sin(u * 1.7 + k)));
      G.quad(a0, a1, r1, r0, Z, Z, Z, Z, [cx * -1, 1, cz * -1], shade);
      G.quad(b1, b0, r0, r1, Z, Z, Z, Z, [cx, 1, cz], shade);
    }
  }
  return G;
}

const PUFFS = 8, PUFF_LIFE = 7;     // smoke puffs per chimney, and how long each drifts

export function buildSettlements(scene){
  const S = settlements(), mats = materials(), group = new THREE.Group();
  const recs = new Map();           // building → { win, top, pile }: what update() animates
  const winGeos = [];
  S.places.forEach((p, i) => {
    const r = mulberry32(0x5e77 + i * 7919);
    const G = { logs: new Geo(), boards: new Geo(), thatch: new Geo(), shingle: new Geo(), detail: new Geo(), windows: new Geo() };
    for (const b of p.buildings){ const rec = addBuilding(G, b, r); if (rec) recs.set(b, rec); }
    if (p.well) addWell(G, p.well);
    for (const k of Object.keys(G)){
      const m = G[k].mesh(mats[k]); if (!m) continue;
      group.add(m);
      if (k === 'windows'){ winGeos.push(m.geometry); for (const b of p.buildings) if (recs.has(b)) recs.get(b).geo = m.geometry; }
    }
  });
  // the woodpiles: one instanced log mesh, up to a dozen logs a house
  const tops = [...recs.values()], LOGS = 12;
  const logs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.28, 1.5), mats.logpile, Math.max(1, tops.length * LOGS));
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < logs.count; i++) logs.setMatrixAt(i, hide);
  group.add(logs);
  // the smoke: one cloud of points, a few puffs per chimney
  const N = tops.length * PUFFS, sp = new Float32Array(N * 3), sc = new Float32Array(N * 4), age = new Float32Array(N);
  for (let i = 0; i < N; i++) age[i] = (i % PUFFS) / PUFFS * PUFF_LIFE;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 4));
  const smoke = new THREE.Points(sg, mats.smoke);
  smoke.frustumCulled = false;
  group.add(smoke);
  // the fields
  const crops = S.fields.map(f => { const m = new THREE.Mesh(cropGeometry(f, 0).mesh(mats.crops).geometry, mats.crops); m.userData = { f, stage: 0 }; group.add(m); return m; });
  scene.add(group);

  let t = 0, cropT = 0;
  return {
    group,
    // houses: agents.houses (who is in, the hearth); night 0..1; wind: a THREE.Vector2/3 or null
    update(dt, { houses = [], night = 0, wind = null } = {}){
      t += dt;
      const wx = wind ? (wind.x || 0) : 0.4, wz = wind ? (wind.y ?? wind.z ?? 0) : 0.2;
      tops.forEach((rec, hi) => {
        const h = rec.house || (rec.house = houses.find(o => o.b === rec.b));
        // windows: lamplight once it's getting dark, while someone is home
        const lit = h && h.occupied ? Math.max(0, Math.min(1, (night - 0.12) / 0.3)) : 0;
        const k = lit * (0.88 + 0.12 * Math.sin(t * 3.1 + rec.flicker) * Math.sin(t * 1.7 + rec.flicker * 2));
        if (rec.geo && Math.abs(k - (rec.k ?? -1)) > 0.01){
          rec.k = k;
          const col = rec.geo.attributes.color;
          for (let v = rec.win[0]; v < rec.win[1]; v++)
            col.setXYZ(v, WIN_DARK[0] + (WIN_LIT[0] - WIN_DARK[0]) * k, WIN_DARK[1] + (WIN_LIT[1] - WIN_DARK[1]) * k, WIN_DARK[2] + (WIN_LIT[2] - WIN_DARK[2]) * k);
          col.needsUpdate = true;
        }
        // smoke while the hearth burns
        const burning = !!(h && h.fire && h.fire.lit);
        for (let q = 0; q < PUFFS; q++){
          const i = hi * PUFFS + q;
          age[i] += dt;
          if (age[i] > PUFF_LIFE) age[i] -= PUFF_LIFE;
          const a = age[i], f = a / PUFF_LIFE;
          sp[i * 3]     = rec.top[0] + wx * a * 0.5 + Math.sin(a * 0.9 + i) * 0.25 * a;
          sp[i * 3 + 1] = rec.top[1] + a * 0.75;
          sp[i * 3 + 2] = rec.top[2] + wz * a * 0.5;
          const g = 0.62 + 0.15 * f;
          sc[i * 4] = sc[i * 4 + 1] = g; sc[i * 4 + 2] = g * 1.02;
          sc[i * 4 + 3] = burning ? 0.5 * Math.min(1, a * 1.5) * (1 - f) : Math.max(0, sc[i * 4 + 3] - dt * 0.3);
        }
        // the woodpile: as many logs as the hearth has stacked
        const n = h && h.fire ? Math.min(LOGS, Math.ceil(h.fire.woodpile)) : 0;
        if (n !== rec.logs){
          rec.logs = n;
          const p = rec.pile, m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.a), v = new THREE.Vector3();
          for (let j = 0; j < LOGS; j++){
            if (j >= n){ logs.setMatrixAt(hi * LOGS + j, hide); continue; }
            const row = Math.floor(j / 4), col = j % 4;
            // logs lie across the gable end (along its width), stacked four to a course
            const along = (col - 1.5) * 0.36 + (row % 2) * 0.18, out = 0.22 * Math.sign(p.ge);
            v.set(p.x + Math.cos(p.a) * out - Math.sin(p.a) * along, p.y + 0.14 + row * 0.27, p.z + Math.sin(p.a) * out + Math.cos(p.a) * along);
            m.compose(v, q, new THREE.Vector3(1, 1, 1));
            logs.setMatrixAt(hi * LOGS + j, m);
          }
          logs.instanceMatrix.needsUpdate = true;
        }
      });
      sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true;
      // the crops, a few times a second: rebuilt when a field moves to its next stage
      cropT -= dt;
      if (cropT <= 0){
        cropT = 0.5;
        for (const m of crops){
          const fd = m.userData.sim || (m.userData.sim = houses.map(h => h.field).find(x => x && x.f === m.userData.f));
          if (!fd) continue;
          const stage = Math.min(4, Math.floor(fd.growth * 4 + 0.001));
          if (stage !== m.userData.stage){
            m.userData.stage = stage;
            m.geometry.dispose();
            m.geometry = cropGeometry(m.userData.f, stage).mesh(mats.crops).geometry;
          }
        }
      }
    },
  };
}
