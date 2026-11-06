// The settlements' buildings, drawn (js/gen/settle.js plans them, land.js levels
// their pads): long log houses and cottages under thatch, plank barns and sheds
// under shingles, granaries up on posts, and a well on the village green. Each
// settlement is a handful of merged meshes — one per material — so the whole
// lot is a few dozen draw calls, static, frustum-culled by settlement.

import * as THREE from 'three';
import { settlements } from './terrain.js';
import { height } from './terrain.js';
import { UNITS_PER_M } from './config.js';
import { makeTexture } from './textures.js';
import { mulberry32 } from './rng.js';
import { addDressed, addWell } from './house-view.js';
import { ashlar } from './stone-tex.js';
import { fieldInto, croftInto, paintAtlas } from './crop-view.js';

const M = UNITS_PER_M;
const TILE = 2 * M;              // world size of one texture tile (2 m)
const SINK = 0.4;                // walls run this far below the pad, so no gap shows on its feathered edge
const POSTC = [0.30, 0.23, 0.15];
const WIN_DARK = [0.035, 0.028, 0.022], WIN_LIT = [1.0, 0.70, 0.34];

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
    const n = (r() - 0.5) * 22, course = y % 8 === 7 ? 0.84 : y % 8 === 0 ? 1.06 : 1;
    put(x, y, shade([176, 152, 100], streak[x] * course, n));
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

// limewashed daub: near white, so each house's wash can colour it; trowel marks and flaking
const daubTexture = () => pixels(0xda0b, (r, put) => {
  const blot = Array.from({ length: 6 }, () => [r() * 32, r() * 32, 3 + r() * 5]);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
    let k = 232 + (r() - 0.5) * 16 + Math.sin(y * 0.8 + x * 0.25) * 4;
    for (const [bx, by, br] of blot) if (Math.hypot(x - bx, y - by) < br) k -= 7;
    if (r() < 0.012) k -= 44;
    put(x, y, [k, k * 0.985, k * 0.95]);
  }
});
// coursed rubble: long stones, deep joints
const stoneTexture = () => pixels(0x570e, (r, put) => {
  const ids = new Int16Array(32 * 32), tones = [];
  for (let row = 0; row < 5; row++){
    let x = (row * 7) % 5 - 5;
    while (x < 32){
      const w = 5 + ((r() * 7) | 0), id = tones.length;
      tones.push(0.8 + r() * 0.34);
      const y0 = Math.floor(row * 32 / 5), y1 = Math.floor((row + 1) * 32 / 5);
      for (let yy = y0; yy < y1; yy++) for (let q = x; q < x + w; q++){
        const edge = yy === y1 - 1 || q === x + w - 1;
        ids[yy * 32 + ((q + 32) % 32)] = edge ? -1 : id;
      }
      x += w;
    }
  }
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
    const id = ids[y * 32 + x], n = (r() - 0.5) * 16;
    put(x, y, id < 0 ? [92, 86, 76] : shade([158, 152, 140], tones[id], n));
  }
});
// sawn and adzed oak: grain along the timber
const timberTexture = () => pixels(0x7188, (r, put) => {
  const rows = Array.from({ length: 32 }, () => 0.86 + r() * 0.28);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
    const n = (r() - 0.5) * 16, knot = Math.hypot((x - 20) * 0.5, y - 12) < 2.2 ? 0.7 : 1;
    put(x, y, shade([196, 186, 172], rows[y] * knot, n));
  }
});

// a wattle hurdle: rods woven through uprights, with daylight through it (one tile is a panel)
const wattleTexture = () => makeTexture(32, 16, (g, w, h) => {
  const r = mulberry32(0x3a771e), im = g.createImageData(w, h), d = im.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const o = (y * w + x) * 4, row = y >> 1, over = ((x >> 2) + row) % 2 === 0, gap = (y % 2 === 1 && !over) || x % 8 === 0 && y % 2 === 1 && r() < 0.5;
    const k = (over ? 150 : 104) + (r() - 0.5) * 34;
    d[o] = k; d[o + 1] = k * 0.8; d[o + 2] = k * 0.55; d[o + 3] = gap ? 0 : 255;
  }
  g.putImageData(im, 0, 0);
}, { repeat: [1, 1] });

// the crops' cards (crop-view.js paints them). Both faces are lit from above: three.js would flip
// the normal on the back, and half of every crossed pair would go dark.
function cardMaterial(){
  const A = paintAtlas();
  const t = makeTexture(A.w, A.h, g => { const im = g.createImageData(A.w, A.h); im.data.set(A.data); g.putImageData(im, 0, 0); });
  const m = new THREE.MeshLambertMaterial({ map: t, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize( vNormal ); vec3 nonPerturbedNormal = normal;');
  };
  return m;
}

let MATS = null;
function materials(){
  if (MATS) return MATS;
  const mat = (map, side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ map, vertexColors: true, side });
  return MATS = {
    logs: mat(logsTexture()), boards: mat(boardsTexture()), daub: mat(daubTexture()), stone: mat(stoneTexture()), timber: mat(timberTexture()),
    thatch: mat(thatchTexture(), THREE.DoubleSide), shingle: mat(shingleTexture(), THREE.DoubleSide),
    // the well's brickwork: the cathedrals' own ashlar (js/stone-tex.js), so it takes the light the same way
    brick: (t => new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true }))(
      ashlar(0xb41c, { courses: 12, len: [9, 17], wear: 1.2, tone: [150, 112, 86], moss: 0.25 })),
    detail: new THREE.MeshLambertMaterial({ vertexColors: true }),
    windows: new THREE.MeshBasicMaterial({ vertexColors: true }),           // unlit: a lamp shows at night
    crops: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    cards: cardMaterial(),
    wattle: new THREE.MeshLambertMaterial({ map: wattleTexture(), vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.5 }),
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
  // A smooth-shaded sheet (a thatched slope): rows of points, with a uv and a colour at each.
  // Normals are averaged across each point's neighbours; `out` says which side is the outside.
  grid(pts, uv, col, out){
    const R = pts.length, C = pts[0].length;
    const at = (i, j) => pts[Math.max(0, Math.min(R - 1, i))][Math.max(0, Math.min(C - 1, j))];
    const nrm = pts.map((row, i) => row.map((_, j) => {
      const a = at(i + 1, j), b = at(i - 1, j), c = at(i, j + 1), d = at(i, j - 1);
      const e1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], e2 = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = n.map(v => -v);
      const l = Math.hypot(...n);
      return l > 1e-6 ? n.map(v => v / l) : (() => { const m = Math.hypot(...out) || 1; return out.map(v => v / m); })();
    }));
    const emit = (i0, j0, i1, j1, i2, j2) => {
      const a = pts[i0][j0], b = pts[i1][j1], c = pts[i2][j2];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (Math.abs(g[0]) + Math.abs(g[1]) + Math.abs(g[2]) < 1e-9) return;      // a hip's collapsed corner
      const flip = g[0] * out[0] + g[1] * out[1] + g[2] * out[2] < 0;
      for (const [i, j] of flip ? [[i0, j0], [i2, j2], [i1, j1]] : [[i0, j0], [i1, j1], [i2, j2]]){
        this.p.push(...pts[i][j]); this.n.push(...nrm[i][j]); this.uv.push(...uv[i][j]); this.c.push(...col[i][j]);
      }
    };
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++){ emit(i, j, i, j + 1, i + 1, j + 1); emit(i, j, i + 1, j + 1, i + 1, j); }
  }
  // A cut-out picture on a quad: corners counter-clockwise from lower left, rect [u0, v0, u1, v1] from the
  // atlas. The normal is straight up on every card, so a plant takes the light as one soft mass and
  // not as flat planes that flash when you walk round them.
  card(a, b, c, d, [u0, v0, u1, v1], tone = 1, flip = false){
    const L = flip ? u1 : u0, R = flip ? u0 : u1, col = [tone, tone, tone];
    for (const [p, u, v] of [[a, L, v0], [b, R, v0], [c, R, v1], [a, L, v0], [c, R, v1], [d, L, v1]]){
      this.p.push(...p); this.n.push(0, 1, 0); this.uv.push(u, v); this.c.push(...col);
    }
  }
  // box() with its faces textured to scale
  tbox(x, z, y0, y1, sx, sz, a, col, tile){
    const c = Math.cos(a), s = Math.sin(a), P = (u, v, y) => [x + c * u - s * v, y, z + s * u + c * v];
    const hx = sx / 2, hz = sz / 2;
    for (const [u0, v0, u1, v1, ox, oz, len] of [[-hx, -hz, hx, -hz, 0, -1, sx], [hx, -hz, hx, hz, 1, 0, sz], [hx, hz, -hx, hz, 0, 1, sx], [-hx, hz, -hx, -hz, -1, 0, sz]]){
      const ua = x / tile, ub = ua + len / tile, va = y0 / tile, vb = y1 / tile;
      this.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), [ua, va], [ub, va], [ub, vb], [ua, vb], [c * ox - s * oz, 0, s * ox + c * oz], col);
    }
    const Z = [0, 0];
    this.quad(P(-hx, -hz, y1), P(hx, -hz, y1), P(hx, hz, y1), P(-hx, hz, y1), Z, Z, Z, Z, [0, 1, 0], col);
  }
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

// a soft puff of smoke, pixel-edged like everything else
const puffTexture = () => makeTexture(16, 16, (g, w, h) => {
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const r = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / (w / 2), o = (y * w + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.max(0, 1 - r * r) * 255 | 0;
  }
  g.putImageData(img, 0, 0);
});

// the per-material buffers one settlement draws into, and meshes from them (also the probe's way in)
export const settlementGeos = () => ({ logs: new Geo(), boards: new Geo(), daub: new Geo(), stone: new Geo(), timber: new Geo(), brick: new Geo(), wattle: new Geo(), thatch: new Geo(), shingle: new Geo(), detail: new Geo(), windows: new Geo() });
export const settlementMaterials = () => materials();

const PUFFS = 8, PUFF_LIFE = 7;     // smoke puffs per chimney, and how long each drifts

export function buildSettlements(scene){
  const S = settlements(), mats = materials(), group = new THREE.Group();
  const recs = new Map();           // building → { win, top, pile }: what update() animates
  const winGeos = [];
  S.places.forEach((p, i) => {
    const r = mulberry32(0x5e77 + i * 7919);
    const G = settlementGeos();
    for (const b of p.buildings){ const rec = addDressed(G, b, r, height); if (rec) recs.set(b, rec); }
    if (p.well) addWell(G, p.well, height, p.green ? p.green.a : 0);
    for (const f of p.fields || []) croftInto(G, f, height, f.house, r);
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
  // a field is two meshes: its earth, poles and any geometry plants, and its cards
  const redraw = (m, st) => {
    const A = new Geo(), B = new Geo();
    fieldInto(A, m.userData.f, height, st, B);
    m.geometry.dispose(); m.geometry = A.mesh(mats.crops).geometry;
    const c = m.userData.cards;
    c.geometry.dispose();
    const cm = B.mesh(mats.cards);
    c.geometry = cm ? cm.geometry : new THREE.BufferGeometry(); c.visible = !!cm;
  };
  const crops = S.fields.map(f => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), mats.crops), cards = new THREE.Mesh(new THREE.BufferGeometry(), mats.cards);
    m.userData = { f, key: '', cards }; group.add(m); group.add(cards);
    redraw(m, { crop: null, sown: true });
    return m;
  });
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
          const st = { crop: fd.crop, stage: Math.min(4, Math.floor(fd.growth * 4 + 0.001)), up: Math.ceil(fd.supports * 8) / 8, sown: fd.sown, weeds: fd.care < 0.12 ? 2 : fd.care < 0.28 ? 1 : 0 };
          const key = `${st.crop}.${st.stage}.${st.up}.${st.sown}.${st.weeds}`;
          if (key !== m.userData.key){
            m.userData.key = key;
            redraw(m, st);
          }
        }
      }
    },
  };
}
