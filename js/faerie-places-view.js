// Faerie beyond the palaces, drawn (js/gen/faerie.js builds them; docs/magic.md "The grounds
// and the Turning Stair"):
//
//   buildStairView(L)    the Turning Stair: two ramps winding round an open well, half a turn
//                        apart, columns on their inner edge, rising to a gallery under a gold
//                        dome with an oculus. The columns go up the orders as you climb, as
//                        Bramante's do: plain, then scrolled, then gilded
//   buildGroundsView(L, sky)  the grounds: a lawn under the Lea's own stars and a Doom sky
//                        (a second Sky, held at midnight), the palaces' fronts in a ring
//                        round it, the stair tower among them, a pool, lanterned paths
//
// Each is a view as under-view.js's are: { scene, update(dt, camera), dispose() }. The
// palace's own materials (under-view.js faerieKit) dress both, so nothing here is plain stone.

import * as THREE from 'three';
import { Geo } from './settle-view.js';
import { faerieKit, lightFaerie, faerieGiltGlass, windowSurround, TRACERY } from './under-view.js';
import { Sky } from './sky.js';
import { cobble, rock, ashlar } from './stone-tex.js';
import { juliaMaterial } from './julia-tex.js';
import { JULIA_SURFACES } from './julia-calc.js';

const FAERIE_SKY = 'mek-bub2sk12';    // sky/doom/manifest.json
import { wisps, haloTex } from './wisps.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUNDS_R } from './gen/faerie.js';
import { arcadeMesh } from './gen/arcade.js';

const WHITE = [1, 1, 1];
const pt = (r, a, y, cx = 0, cz = 0) => [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
const glowMat = c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });

// an upright cylinder's wall in a Geo, facing out (or in), from y0 to y1; `skip(a, y0, y1)`
// gives the holes in the strip at angle a as [[ya, yb], ...]
function wallRing(g, cx, cz, r, y0, y1, { inward = false, n = 96, T = 3, skip = null, uv = (a, y) => [a * r / T, y / T] } = {}){
  for (let q = 0; q < n; q++){
    const a0 = q / n * Math.PI * 2, a1 = (q + 1) / n * Math.PI * 2, am = (a0 + a1) / 2;
    const out = inward ? [-Math.cos(am), 0, -Math.sin(am)] : [Math.cos(am), 0, Math.sin(am)];
    let spans = [[y0, y1]];
    for (const [ha, hb] of skip ? skip(am) : []) spans = spans.flatMap(([a, b]) => hb <= a || ha >= b ? [[a, b]] : [[a, ha], [hb, b]].filter(([u, v]) => v - u > 0.01));
    for (const [ya, yb] of spans){
      const A = pt(r, a0, ya, cx, cz), B = pt(r, a1, ya, cx, cz), C = pt(r, a1, yb, cx, cz), D = pt(r, a0, yb, cx, cz);
      g.quad(A, B, C, D, uv(a0, ya), uv(a1, ya), uv(a1, yb), uv(a0, yb), out, WHITE);
    }
  }
}
// a flat ring (or disc, ri 0) at height y, facing up or down
function flatRing(g, cx, cz, ri, ro, y, { down = false, n = 96, T = 3 } = {}){
  for (let q = 0; q < n; q++){
    const a0 = q / n * Math.PI * 2, a1 = (q + 1) / n * Math.PI * 2;
    const P = [pt(ri, a0, y, cx, cz), pt(ro, a0, y, cx, cz), pt(ro, a1, y, cx, cz), pt(ri, a1, y, cx, cz)];
    g.quad(...P, ...P.map(p => [p[0] / T, p[2] / T]), [0, down ? -1 : 1, 0], WHITE);
  }
}
// a dome over a ring of radius R springing at y, rising `rise`, open at the top to radius `eye`
function dome(g, cx, cz, R, y, rise, { inward = true, eye = 0, n = 64, m = 16, T = 3, uv = (a, v) => [a * R / T, v * R / T] } = {}){
  const v1 = eye ? Math.acos(eye / R) : Math.PI / 2;
  for (let p = 0; p < m; p++){
    const va = p / m * v1, vb = (p + 1) / m * v1;
    for (let q = 0; q < n; q++){
      const a0 = q / n * Math.PI * 2, a1 = (q + 1) / n * Math.PI * 2;
      const P = [[a0, va], [a1, va], [a1, vb], [a0, vb]].map(([a, v]) => pt(R * Math.cos(v), a, y + rise * Math.sin(v), cx, cz));
      const am = (a0 + a1) / 2, vm = (va + vb) / 2, o = [Math.cos(am) * Math.cos(vm), Math.sin(vm), Math.sin(am) * Math.cos(vm)];
      g.quad(...P, uv(a0, va), uv(a1, va), uv(a1, vb), uv(a0, vb), inward ? o.map(x => -x) : o, WHITE);
    }
  }
}
function disposer(scene){
  return () => scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material?.userData?.own) o.material.dispose(); });
}
const own = m => { m.userData.own = true; return m; };

// ---- the Turning Stair ----------------------------------------------------------------
// its floor, walls, ramps' undersides and columns are all panels of zoomed Julia sets, each
// surface coloured its own way (julia-calc.js). They take seconds, so a worker makes them
// (julia-tex.js): until a surface's arrives it is plain stone, then it takes the panels
const S = JULIA_SURFACES;
const juliaMat = (name, colour, opts) => own(juliaMaterial(name, colour, opts));
const SLAB_ = 0.45, RAIL_ = 1.05;             // the ramp's slab, and the rail over it (u)
export function buildStairView(L){
  const K = faerieKit(), G = L.helix, T = K.tile, { R0, R1, R2, top } = G;
  const scene = new THREE.Scene();
  lightFaerie(scene);                                  // as the palaces: dim, blue-violet
  const gFloor = new Geo(), gWall = new Geo(), gTrim = new Geo(), gVous = { verde: new Geo(), porphyry: new Geo() }, gGallery = new Geo(), gMosaic = new Geo(), gRamp = new Geo(), gSoffit = new Geo(), glassG = [new Geo(), new Geo(), new Geo()];
  // the ramps' own coordinates, following the spiral: u along it (at the middle of the ramp,
  // so the pattern fans out a little toward the wall), v across it, wall to well
  // (the second ramp half a strip on: other panels side by side)
  const RW = R1 - R0, RM = (R0 + R1) / 2, strip = n => RW * S[n].pw / S[n].ph * S[n].cols;
  const uvR = (r, th, k = 0, n = 'ramp') => [th * RM / strip(n) + k / 2, (r - R0) / RW];
  let pane = 0; const gGlass = { quad: (...a) => glassG[pane++ % 3].quad(...a) };   // every window stained glass, three designs in turn
  // each window set in voussoirs and on a sill, as the cathedral's are (under-view.js
  // windowSurround), but of the columns' stone (julia-calc.js verde, porphyry), verde low and
  // porphyry high as the columns go; each column panel's gold edge falls as a joint between
  // stones. The window's frame follows the round wall: along it is round it (the way the
  // cathedral's runs, so its faces wind the same way), out is inward
  const RAILS = (SLAB_ + RAIL_) * S.rail.pw / S.rail.ph * S.rail.cols;   // the length of ramp one strip of rail panels covers
  const surround = (a, r, yc, hw, hh, stone) => {
    const P = (u, y, o = 0) => pt(r - o, a - u / r, y), out = [-Math.cos(a), 0, -Math.sin(a)];
    windowSurround(gVous[stone], new Geo(), { pattern: 'lancet', y: yc }, TRACERY.lancet, 0, hw, hh, P, out, 0.24 * S.verde.pw / S.verde.ph * S.verde.cols);
  };
  const STEP = Math.PI / 36, RINGS = [R0, (2 * R0 + R1) / 3, (R0 + 2 * R1) / 3, R1], SLAB = SLAB_, RAIL = RAIL_, PR = R0 + 0.18;
  const ext = (p, dy) => [p[0], p[1] + dy, p[2]];
  for (const k of [0, 1]){
    const b = G.base(k);
    for (let th = 0; th < G.thMax - 1e-6; th += STEP){
      const t1 = Math.min(G.thMax, th + STEP), a0 = b + th, a1 = b + t1, y0 = G.y(th), y1 = G.y(t1);
      // the ramp: paved on top, white underneath (seen from the ramp below)
      for (let q = 0; q < RINGS.length - 1; q++){
        const A = pt(RINGS[q], a0, y0), B = pt(RINGS[q + 1], a0, y0), C = pt(RINGS[q + 1], a1, y1), D = pt(RINGS[q], a1, y1);
        const ua = uvR(RINGS[q], th, k), ub = uvR(RINGS[q + 1], th, k), uc = uvR(RINGS[q + 1], t1, k), ud = uvR(RINGS[q], t1, k);
        gRamp.quad(A, B, C, D, ua, ub, uc, ud, [0, 1, 0], WHITE);
        gSoffit.quad(ext(A, -SLAB), ext(B, -SLAB), ext(C, -SLAB), ext(D, -SLAB), uvR(RINGS[q], th, k, 'soffit'), uvR(RINGS[q + 1], th, k, 'soffit'),
          uvR(RINGS[q + 1], t1, k, 'soffit'), uvR(RINGS[q], t1, k, 'soffit'), [0, -1, 0], WHITE);
      }
      // its inner edge: the slab's face, and a parapet over it, between the ramp and the well
      // in the rail's panels (julia-calc.js 'rail'), laid along the ramp as the floor's are:
      // v up the slab's face and the parapet, from the slab's foot to the rail's top, whose
      // last sliver is the panels' gold edge, so the rail is capped in gold
      // a panel to each bay between columns (at th = π/8 + nπ/4), so the divisions fall on them
      const bay = t => (t - Math.PI / 8) / (Math.PI / 4) / S.rail.cols + k / 2;
      const s0 = bay(th), s1 = bay(t1), vS = SLAB / (SLAB + RAIL);
      const ia = pt(R0, a0, y0 - SLAB), ib = pt(R0, a1, y1 - SLAB), ic = pt(R0, a1, y1 + RAIL), id = pt(R0, a0, y0 + RAIL);
      gTrim.quad(ia, ib, ic, id, [s0, 0], [s1, 0], [s1, 1], [s0, 1], [-Math.cos(a0), 0, -Math.sin(a0)], WHITE);
      const ja = pt(PR, a0, y0), jb = pt(PR, a1, y1), jc = pt(PR, a1, y1 + RAIL), jd = pt(PR, a0, y0 + RAIL);
      gTrim.quad(ja, jb, jc, jd, [s0, vS], [s1, vS], [s1, 1], [s0, 1], [Math.cos(a0), 0, Math.sin(a0)], WHITE);
      gTrim.quad(id, ic, jc, jd, [s0, 0.985], [s1, 0.985], [s1, 0.995], [s0, 0.995], [0, 1, 0], WHITE);
    }
    // a wall across the annulus behind each foot (the other ramp's underside comes down to
    // the floor there), and a parapet across the end of each landing
    const end = (a, y0, y1, tside) => {
      const A = pt(R0, a, y0), B = pt(R1, a, y0), C = pt(R1, a, y1), D = pt(R0, a, y1);
      const ue = (R1 - R0) / RAILS, v0 = 0, v1 = (y1 - y0) / (SLAB + RAIL);             // courses of rail panels, one rail high
      gTrim.quad(A, B, C, D, [0, v0], [ue, v0], [ue, v1], [0, v1], [-Math.sin(a) * tside, 0, Math.cos(a) * tside], WHITE);
      gTrim.quad(A, B, C, D, [0, v0], [ue, v0], [ue, v1], [0, v1], [Math.sin(a) * tside, 0, -Math.cos(a) * tside], WHITE);
    };
    end(b, -0.2, G.P / 2 - SLAB, 1);
    end(b + G.thMax, top - SLAB, top + RAIL, -1);
    // windows in the shaft's wall, a quarter turn apart up each ramp, lit from outside
    for (let th = Math.PI / 4; th < G.thL - 0.3; th += Math.PI / 2){
      const a = b + th, y = G.y(th), r = R1 - 0.03, w = 0.6 / R1;
      const A = pt(r, a - w, y + 1.4), B = pt(r, a + w, y + 1.4), C = pt(r, a + w, y + 3.4), D = pt(r, a - w, y + 3.4);
      gGlass.quad(A, B, C, D, [1, 0], [0, 0], [0, 1], [1, 1], [-Math.cos(a), 0, -Math.sin(a)], WHITE);
      surround(a, r, y + 2.4, 0.6, 1, y < top / 2 ? 'verde' : 'porphyry');
    }
  }
  // the shaft's wall: up to the gallery's parapet, open at the two foot doors and over the landings
  const foot = [0, 1].map(k => G.base(k) + G.DOOR), lands = [0, 1].map(k => G.base(k) + G.thMax);
  const near = (a, c) => Math.abs(Math.atan2(Math.sin(a - c), Math.cos(a - c)));
  const holes = a => [
    ...foot.filter(c => near(a, c) < 0.17).map(() => [0, 3.6]),
    ...lands.filter(c => { const d = Math.atan2(Math.sin(a - c), Math.cos(a - c)); return d <= 0.02 && d >= -(G.LAND - 0.12); }).map(() => [top, top + RAIL + 1]),
  ];
  // the shaft's wall in Julia panels, the grid going round exactly four times (and the
  // gallery's, six); the parapets, ends and well's rim stay marble, framing them.
  // The shaft's rows climb with the stair (level rows cut across the ramps). The ramps
  // meet the wall where y = P·(a − kπ)/2π (+ whole turns), so y − P·a/2π is a multiple of P/2
  // on every ramp. Measuring height from that, a row of panels is the band of wall between
  // one ramp and the next, its gold frame a skirting along the floor (lifted a hair, SKIRT,
  // so it shows). Once round, v moves by exactly 1, the texture's height: no seam
  const grid = (turns, y0) => (a, y) => [a / (2 * Math.PI) * turns, (y - y0) / (2 * Math.PI * R1 / (turns * S.wall.cols) * S.wall.ph / S.wall.pw * S.wall.rows)];
  const SKIRT = 0.06, helical = (a, y) => [a / (2 * Math.PI) * 4, (y - G.P * a / (2 * Math.PI) - SKIRT) / G.P];
  wallRing(gWall, 0, 0, R1, -0.2, top + RAIL, { inward: true, n: 180, T, skip: holes, uv: helical });
  // round rings of rail panels: a whole number of panels round, so no seam
  const ringU = (R, h) => a => a / (2 * Math.PI) * Math.round(2 * Math.PI * R / (h * S.rail.pw / S.rail.ph)) / S.rail.cols;
  const gu = ringU(R1 + 0.25, RAIL);
  wallRing(gTrim, 0, 0, R1 + 0.25, top, top + RAIL, { n: 180, T, skip: holes, uv: (a, y) => [gu(a), (y - top) / RAIL] });
  for (let q = 0; q < 180; q++){                 // the parapet's top, round the gallery
    const a0 = q / 180 * Math.PI * 2, a1 = (q + 1) / 180 * Math.PI * 2;
    if (holes((a0 + a1) / 2).some(([u]) => u === top)) continue;
    const P = [pt(R1, a0, top + RAIL), pt(R1 + 0.25, a0, top + RAIL), pt(R1 + 0.25, a1, top + RAIL), pt(R1, a1, top + RAIL)];
    gTrim.quad(...P, [gu(a0), 0.985], [gu(a0), 0.995], [gu(a1), 0.995], [gu(a1), 0.985], [0, 1, 0], WHITE);
  }
  // the gallery: a paved ring round the top of the shaft, tall windows, a gold dome with an
  // oculus open to the Faerie sky
  flatRing(gFloor, 0, 0, R1 + 0.25, R2, top, { T });
  wallRing(gGallery, 0, 0, R2, top, top + 9, { inward: true, n: 96, T, uv: (a, y) => grid(6, top)(a, y).map((v, q) => q ? v * R1 / R2 : v) });
  for (let q = 0; q < 16; q++){
    const a = (q + 0.5) / 16 * Math.PI * 2, w = 0.8 / R2, r = R2 - 0.03;
    const A = pt(r, a - w, top + 2), B = pt(r, a + w, top + 2), C = pt(r, a + w, top + 7), D = pt(r, a - w, top + 7);
    gGlass.quad(A, B, C, D, [1, 0], [0, 0], [0, 1], [1, 1], [-Math.cos(a), 0, -Math.sin(a)], WHITE);
    surround(a, r, top + 4.5, 0.8, 2.5, 'porphyry');
  }
  // the dome: one great Julia view (julia-calc.js 'dome'), its spiral's eye in the oculus.
  // Equidistant from the crown, so the spiral spreads evenly down to the rim
  const domeUV = (a, v) => { const rho = 0.49 * (1 - v / (Math.PI / 2)); return [0.5 + rho * Math.cos(a), 0.5 + rho * Math.sin(a)]; };
  dome(gMosaic, 0, 0, R2, top + 9, R2 * 0.8, { eye: 2.4, T, uv: domeUV });
  const oculus = new THREE.Mesh(new THREE.CircleGeometry(2.5, 32), faerieGiltGlass('rose', 1));     // a rose window in the eye of the dome, gilt as the lancets
  oculus.rotation.x = Math.PI / 2; oculus.position.y = top + 9 + R2 * 0.8 * Math.sin(Math.acos(2.4 / R2)) + 0.05;
  scene.add(oculus);
  // the well's floor: a pool of light at the bottom, under a ring of paving
  flatRing(gFloor, 0, 0, R0, R1, -0.02, { T });
  const wu = ringU(R0, 1.18);
  wallRing(gTrim, 0, 0, R0, -1.2, -0.02, { inward: true, n: 48, T, uv: (a, y) => [wu(a), (y + 1.2) / 1.18] });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(R0, 48), own(new THREE.MeshBasicMaterial({ color: 0xc8ecff })));
  pool.rotation.x = -Math.PI / 2; pool.position.y = -0.9;
  scene.add(pool);
  const poolLight = new THREE.PointLight(0xbfe6ff, 2.5, 40, 1.2); poolLight.position.set(0, 1.5, 0); scene.add(poolLight);
  const wallMat = juliaMat('wall', 0x2a2c58, { clearcoat: 0.35, clearcoatRoughness: 0.2 });
  const floorMat = juliaMat('ramp', 0xb8b0c8, { iridescence: 0.55, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 620], clearcoat: 0.5, clearcoatRoughness: 0.12 });
  const stoneMat = { verde: juliaMat('verde', 0x2f6a52, { clearcoat: 0.6, clearcoatRoughness: 0.08 }), porphyry: juliaMat('porphyry', 0x6a2438, { clearcoat: 0.6, clearcoatRoughness: 0.08 }) };
  for (const [g, m] of [[gFloor, K.floor], [gWall, wallMat], [gGallery, wallMat], [gTrim, juliaMat('rail', 0x5a4878, { clearcoat: 0.6, clearcoatRoughness: 0.08 })],
    [gSoffit, juliaMat('soffit', 0xe4dcea)], [gRamp, floorMat], [gMosaic, juliaMat('dome', 0x4a3a78, { clearcoat: 0.3, clearcoatRoughness: 0.2 })],
    [gVous.verde, stoneMat.verde], [gVous.porphyry, stoneMat.porphyry],
    ...glassG.map((g, v) => [g, faerieGiltGlass('lancet', v)])]){ const mesh = g.mesh(m); if (mesh) scene.add(mesh); }
  // the columns, on each ramp's inner edge, holding up the other ramp over it, verde below and
  // porphyry above. They stand an eighth of a turn apart on both ramps, so each stands right
  // on the one below: at each angle, really one column, which each ramp passes through. Where
  // it does, a gilt node (the shafts cut the rail, their white bases clashed): a lathed
  // swelling from under the slab to over the rail, wider than both, so the rail runs into it
  // and doesn't cross the shaft, with a bead at the rail's top carrying its gold cap round
  // and one at the slab's foot. The rail's panels are one to a bay, so their gold divisions
  // fall on the columns (rail, above)
  // each shaft one long Julia panel, running up it (u up the shaft, v round it, so the panel's
  // gold edges meet in a fillet down the back); the shafts take the panels in turn
  const shaftGeos = Array.from({ length: S.verde.cols }, (_, q) => {
    const g = new THREE.CylinderGeometry(0.17, 0.2, 1, 12), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++){ const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, (q + v) / S.verde.cols, u); }
    return g;
  });
  const NODE = [-SLAB - 0.4, RAIL + 0.4], bead = (y, at) => 0.035 * Math.exp(-(((y - at) / 0.07) ** 2));
  const nodeGeo = new THREE.LatheGeometry(Array.from({ length: 33 }, (_, q) => {
    const t = q / 32, y = NODE[0] + t * (NODE[1] - NODE[0]);
    // the shaft's radius below (its top, 0.17) to above (its foot, 0.2), swelling smoothly between
    return new THREE.Vector2(0.17 + 0.03 * t + 0.11 * Math.sin(Math.PI * t) ** 1.6 + bead(y, RAIL) + bead(y, -SLAB), y);
  }), 20);
  const nodes = [], starts = [], mx = new THREE.Matrix4();
  let shaft = 0;
  for (const k of [0, 1]) for (let th = Math.PI / 8; th + Math.PI <= G.thMax; th += Math.PI / 4){
    const a = G.base(k) + th, x = Math.cos(a) * (R0 + 0.09), z = Math.sin(a) * (R0 + 0.09);
    const y0 = G.y(th), y1 = G.y(th + Math.PI), band = Math.min(3, Math.floor(y0 / top * 4));
    const s = new THREE.Mesh(shaftGeos[shaft++ % shaftGeos.length], band < 2 ? stoneMat.verde : stoneMat.porphyry);
    s.scale.y = y1 - y0; s.position.set(x, (y0 + y1) / 2, z);               // floor to floor; the nodes hide its ends
    scene.add(s);
    for (const y of [y0, y1]) if (!nodes.some(n => Math.hypot(n[0] - x, n[2] - z) < 0.01 && Math.abs(n[1] - y) < 0.01)) nodes.push([x, y, z]);
    starts.push([x, y0, z]);
  }
  // where a column ends and none goes on up (the top half-turn), the node opens into a flower
  // two rings of gilt petals from the rail's bead, cupping a glowing orb
  const tops = nodes.filter(n => !starts.some(m => Math.hypot(m[0] - n[0], m[2] - n[2]) < 0.01 && Math.abs(m[1] - n[1]) < 0.01));
  if (tops.length){
    const petal = (len, open, wid, cup) => {                      // one petal: up and out from the stem, curling open, cupped across
      const pos = [], uv = [], idx = [], NS = 10, NW = 6;
      for (let i = 0; i <= NS; i++) for (let j = 0; j <= NW; j++){
        const t = i / NS, w = (j / NW - 0.5) * 2, half = wid * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - 0.35 * t);
        const rr = 0.1 + len * open * t * t + len * 0.25 * t, yy = len * (t - 0.45 * open * t * t) + cup * w * w * half;
        pos.push(rr, yy, w * half); uv.push(t, j / NW);
      }
      for (let i = 0; i < NS; i++) for (let j = 0; j < NW; j++){ const a = i * (NW + 1) + j, b = a + NW + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const ring = (n, len, open, wid, cup, turn, lift) => Array.from({ length: n }, (_, q) => { const g = petal(len, open, wid, cup); g.rotateY(turn + q / n * Math.PI * 2); g.translate(0, lift, 0); return g; });
    const flowerGeo = mergeGeometries([...ring(6, 0.95, 0.85, 0.26, 0.5, 0, 0), ...ring(6, 0.6, 0.45, 0.18, 0.6, Math.PI / 6, 0.08)]);
    const petalMat = own(K.gold.clone()); petalMat.side = THREE.DoubleSide;
    const orbGeo = new THREE.SphereGeometry(0.17, 16, 12), orbMat = own(new THREE.MeshBasicMaterial({ color: 0xfff2d8 }));
    const flowers = new THREE.InstancedMesh(flowerGeo, petalMat, tops.length), orbs = new THREE.InstancedMesh(orbGeo, orbMat, tops.length);
    const halo = [];
    tops.forEach(([x, y, z], q) => {
      mx.makeTranslation(x, y + RAIL + 0.06, z); flowers.setMatrixAt(q, mx);
      mx.makeTranslation(x, y + RAIL + 0.42, z); orbs.setMatrixAt(q, mx); halo.push(x, y + RAIL + 0.42, z);
    });
    flowers.computeBoundingSphere(); orbs.computeBoundingSphere();
    // and a soft glow round each orb, as round the floating lights
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(halo, 3));
    const hp = new THREE.Points(hg, own(new THREE.PointsMaterial({ map: haloTex(), size: 1.6, color: 0xffe6c0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 })));
    scene.add(flowers, orbs, hp);
  }
  const nodeMesh = new THREE.InstancedMesh(nodeGeo, K.gold, nodes.length);
  nodes.forEach(([x, y, z], q) => { mx.makeTranslation(x, y, z); nodeMesh.setMatrixAt(q, mx); });
  nodeMesh.computeBoundingSphere(); scene.add(nodeMesh);
  const lights = wisps(scene, L.wisps || []);
  return { scene, update(dt, camera, t = performance.now() / 1000){ lights.update(dt, camera, t); }, dispose: disposer(scene) };
}

// ---- the grounds -------------------------------------------------------------------
// cobbles (stone-tex.js cobble), for the paths, the stair tower's shaft and the palaces'
// plinths: stones packed big to small, after a reference painting (docs/HVqvATMXIAEKeDJ.png)
let COBBLE = null;
function cobbleMat(){
  if (COBBLE) return COBBLE;
  const t = cobble(11);
  return COBBLE = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.82, metalness: 0, vertexColors: true });
}
// the arcades (gen/arcade.js): their stone pale and worn smooth, the band under the crest or
// the deck cobbled, as the painting's bridge. `place(s)` lays the wall's plane out on the
// ground: the point s along it, its tangent t and its normal n (+v)
const ARC_T = 6;                  // the rock's tile (u)
let ARCMATS = null;
function arcMats(){
  if (ARCMATS) return ARCMATS;
  const t = rock(23, { w: 128, h: 128, tone: [182, 166, 142], strength: 3 }), a = ashlar(31, { w: 64, h: 64, tone: [196, 186, 170], moss: 0, wear: 0.6 });
  const cob = cobbleMat().clone(); cob.vertexColors = false;
  return ARCMATS = { stone: new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughness: 0.88, metalness: 0 }), cob,
    dressed: new THREE.MeshStandardMaterial({ map: a.map, normalMap: a.normalMap, roughness: 0.8, metalness: 0 }) };
}
// a mesh from flat arrays, each triangle wound to face the way its normals say
function meshOf(P, N, U, mat){
  for (let k = 0; k < P.length; k += 9){
    const e1 = [P[k + 3] - P[k], P[k + 4] - P[k + 1], P[k + 5] - P[k + 2]], e2 = [P[k + 6] - P[k], P[k + 7] - P[k + 1], P[k + 8] - P[k + 2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (c[0] * (N[k] + N[k + 3] + N[k + 6]) + c[1] * (N[k + 1] + N[k + 4] + N[k + 7]) + c[2] * (N[k + 2] + N[k + 5] + N[k + 8]) >= 0) continue;
    for (let q = 0; q < 3; q++){ const i = k + 3 + q, j = k + 6 + q; [P[i], P[j]] = [P[j], P[i]]; [N[i], N[j]] = [N[j], N[i]]; }
    const u = k / 3 * 2; for (let q = 0; q < 2; q++){ const i = u + 2 + q, j = u + 4 + q; [U[i], U[j]] = [U[j], U[i]]; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, mat);
}
// opts: cell (the mesh's), off (where the wall's middle plane stands from place's line, in v),
// back (a material for the faces' backs: a tier wall's are the insides of its galleries)
function arcadeView(A, place, { cell = 0.25, off = 0, back = null } = {}){
  const M = arcadeMesh(A, cell), mats = arcMats();
  const lay = (pos, nrm, uvs, T, pick = () => true) => {
    const P = [], N = [], U = [];
    for (let k = 0; k < pos.length / 3; k++){
      if (!pick((k / 3) | 0)) continue;
      const [s, y, v] = pos.slice(k * 3, k * 3 + 3), [ns, ny, nv] = nrm.slice(k * 3, k * 3 + 3), o = place(s);
      P.push(o.x + o.nx * (v + off), y, o.z + o.nz * (v + off));
      N.push(o.tx * ns + o.nx * nv, ny, o.tz * ns + o.nz * nv);
      U.push(uvs[k * 2] / T, uvs[k * 2 + 1] / T);
    }
    return [P, N, U];
  };
  const front = t => !back || M.face[t] > 0;
  const out = [meshOf(...lay(M.pos, M.nrm, M.uv, ARC_T, t => front(t) && !M.band[t]), mats.stone), meshOf(...lay(M.pos, M.nrm, M.uv, 10, t => front(t) && M.band[t]), mats.cob)];
  if (back) out.push(meshOf(...lay(M.pos, M.nrm, M.uv, ARC_T, t => !front(t)), back));
  if (M.deck){ out.push(meshOf(...lay(M.deck.pos, M.deck.nrm, M.deck.uv, 10), mats.cob)); out.push(meshOf(...lay(M.parapet.pos, M.parapet.nrm, M.parapet.uv, 3), mats.dressed)); }
  return out.filter(m => m.geometry.attributes.position.count);
}

const ringPlace = A => s => { const a = A.a + s / A.R, c = Math.cos(a), sn = Math.sin(a); return { x: c * A.R, z: sn * A.R, tx: -sn, tz: c, nx: c, nz: sn }; };
export function buildGroundsView(L, lea = null){
  const K = faerieKit(), T = K.tile;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x120c24, 80, 300);
  scene.add(new THREE.AmbientLight(0x6a50c0, 0.55));          // Faerie's own purple, over the night's moonlight
  // the sky: the Lea's own (sky.js), its real stars as they stand over the Lea tonight, but
  // always midnight here, and always the Doom sky BUB2SK12 as a band round the horizon,
  // faintly lit
  const sky = new Sky(scene, { latitude: lea ? lea.lat / (Math.PI / 180) : 42, dayLength: 1e9,
    time: Math.floor(lea?.time ?? 0), sunLon: lea ? lea.sunLon / (Math.PI / 180) : 35 });
  if (lea) sky.moonLon = lea.moonLon;
  sky.setCloudCover(0);
  sky.load();
  sky.loadDoomManifest().then(m => { const i = m.findIndex(e => e.id === FAERIE_SKY); sky.setDoomSky(Math.max(0, i)); sky.setDoomMode(1); });
  // the band shows only as bright as the day (the dome shader), so lift the day a little
  // (update, below) but make the day's colours the night's, so the sky above stays night
  sky.domeU.uZenith.value.copy(sky.domeU.uNightZenith.value); sky.domeU.uHorizon.value.copy(sky.domeU.uNightHoriz.value);
  // the ground: lawn, pale paths, the pool's kerb
  const CW = L.W + 1, gGround = new Geo(), gCobble = new Geo(), CT = 10;     // CT: the world size of one cobble tile (u): 256 px, so the smallest stones ~4 cm
  const hash = (i, j) => { let n = (i * 73856093 ^ j * 19349663) >>> 0; n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0; return (n >>> 8) / 16777216; };
  for (let j = 0; j < L.H; j++) for (let i = 0; i < L.W; i++){
    const k = j * L.W + i;
    if (!L.open[k]) continue;
    const v = 0.92 + hash(i, j) * 0.16, tag = L.tag[k];
    const c = tag === 1 ? [0.82 * v, 0.8 * v, 0.76 * v] : tag === 2 ? [0.9, 0.9, 0.93] : [0.36 * v, 0.55 * v, 0.44 * v];
    const P = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [L.x0 + a * L.cell, L.floorC[b * CW + a], L.z0 + b * L.cell]);
    if (tag === 1 || tag === 2) gCobble.quad(...P, ...P.map(p => [p[0] / CT, p[2] / CT]), [0, 1, 0], [v, v, v]);   // the paths and the pool's kerb are cobbled
    else gGround.quad(...P, ...P.map(p => [p[0] / T, p[2] / T]), [0, 1, 0], c);
  }
  scene.add(gGround.mesh(own(new THREE.MeshLambertMaterial({ vertexColors: true }))));
  const hedge = new THREE.Mesh(new THREE.CylinderGeometry(GROUNDS_R + 0.8, GROUNDS_R + 0.8, 5, 128, 1, true), own(new THREE.MeshLambertMaterial({ color: 0x1f3a2a, side: THREE.DoubleSide })));
  hedge.position.y = 2.5; scene.add(hedge);
  // the pool, and a gilded basin in the middle of it
  const w = L.waters[0];
  const water = new THREE.Mesh(new THREE.CircleGeometry(w.r + 0.6, 48), own(new THREE.MeshLambertMaterial({ color: 0x24346a, emissive: 0x0c1438 })));
  water.rotation.x = -Math.PI / 2; water.position.set(w.x, w.y, w.z); scene.add(water);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.5, 1.2, 24), K.gold); basin.position.set(w.x, w.y + 1.4, w.z);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.4, 12), K.gold); stem.position.set(w.x, w.y + 0.5, w.z);
  scene.add(basin, stem);
  const gWall = new Geo(), gGlow = new Geo(), gDrum = new Geo(), lit = own(glowMat(0xffe6b0));
  const pane = (g, x, z, a, y0, y1, hw, off = 0.06) => {         // a lit rectangle on a face looking toward a
    const ox = Math.cos(a), oz = Math.sin(a), tx = -oz, tz = ox, cx = x + ox * off, cz = z + oz * off;
    const P = [[cx - tx * hw, y0, cz - tz * hw], [cx + tx * hw, y0, cz + tz * hw], [cx + tx * hw, y1, cz + tz * hw], [cx - tx * hw, y1, cz - tz * hw]];
    g.quad(...P, [0, 0], [1, 0], [1, 1], [0, 1], [ox, 0, oz], WHITE);
  };
  // the palaces' fronts: a marble block, its great door lit, flanked by verde columns, a gilded dome
  const colGeo = new THREE.CylinderGeometry(0.4, 0.45, 1, 14);
  for (const b of L.fronts){
    const ca = Math.cos(b.a), sa = Math.sin(b.a), P = (u, v, y) => [b.x + ca * u - sa * v, y, b.z + sa * u + ca * v];
    const hu = b.d / 2, hv = b.w / 2;
    for (const [u0, v0, u1, v1, ou, ov] of [[-hu, -hv, -hu, hv, -1, 0], [-hu, hv, hu, hv, 0, 1], [hu, hv, hu, -hv, 1, 0], [hu, -hv, -hu, -hv, 0, -1]]){
      // a cobbled plinth, marble above it (as the reference painting's bridge: rubble below, dressed wall above)
      const PL = 2.6, len = Math.hypot(P(u1, v1, 0)[0] - P(u0, v0, 0)[0], P(u1, v1, 0)[2] - P(u0, v0, 0)[2]), o = [ca * ou - sa * ov, 0, sa * ou + ca * ov];
      gCobble.quad(P(u0, v0, -0.5), P(u1, v1, -0.5), P(u1, v1, PL), P(u0, v0, PL), [0, -0.5 / CT], [len / CT, -0.5 / CT], [len / CT, PL / CT], [0, PL / CT], o, WHITE);
      gWall.quad(P(u0, v0, PL), P(u1, v1, PL), P(u1, v1, b.h), P(u0, v0, b.h), [0, PL / T], [len / T, PL / T], [len / T, b.h / T], [0, b.h / T], o, WHITE);
    }
    const R = [P(-hu, -hv, b.h), P(-hu, hv, b.h), P(hu, hv, b.h), P(hu, -hv, b.h)];
    gWall.quad(...R, ...R.map(p => [p[0] / T, p[2] / T]), [0, 1, 0], WHITE);
    const face = b.a + Math.PI;                                    // the front looks in, to the pool
    pane(gGlow, b.door[0], b.door[1], face, 0, 6.5, 2.4);
    for (const v of [-hv * 0.6, -hv * 0.3, hv * 0.3, hv * 0.6]){ const [x, , z] = P(-hu, v, 0); pane(gGlow, x, z, face, b.h * 0.45, b.h * 0.75, 0.9); }
    for (const s of [-1, 1]){
      const [x, , z] = P(-hu - 0.7, s * 3.4, 0), c = new THREE.Mesh(colGeo, K.verde);
      c.scale.y = 8; c.position.set(x, 4, z); scene.add(c);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 8.4), K.gold); lintel.position.set(...P(-hu - 0.7, 0, 8.4)); lintel.rotation.y = -b.a; scene.add(lintel);
    const d = new THREE.Mesh(new THREE.SphereGeometry(Math.min(b.w, b.d) * 0.4, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), K.gold);
    d.position.set(b.x, b.h, b.z); scene.add(d);
  }
  // the stair tower: its shaft, the wider drum of the gallery, the dome; windows climbing it
  // where the ramps climb inside, and its two doors lit
  const tw = L.tower, H = L.stair;
  if (tw && H){
    const local = (a, r, y) => pt(r, tw.rot + a, y, tw.x, tw.z);
    wallRing(gCobble, tw.x, tw.z, H.R1 + 0.6, -0.5, H.top, { n: 64, T: CT });      // the shaft rubble-built, the gallery's drum marble
    // the gallery's drum in the stair's own wall panels (julia-calc.js 'wall'), the cloisonné
    // inside showing outside too: six turns of the grid round, rows level
    const RD = H.R2 + 0.4, pwD = 2 * Math.PI * RD / (6 * S.wall.cols), rowD = pwD * S.wall.ph / S.wall.pw;
    wallRing(gDrum, tw.x, tw.z, RD, H.top - 1, H.top + 9.5, { n: 96, T, uv: (a, y) => [a / (2 * Math.PI) * 6, (y - H.top + 1) / (rowD * S.wall.rows)] });
    flatRing(gWall, tw.x, tw.z, H.R1 + 0.6, H.R2 + 0.4, H.top - 1, { down: true, n: 64, T });
    const d = new THREE.Mesh(new THREE.SphereGeometry(H.R2 + 0.4, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), K.gold);
    d.scale.y = 0.8; d.position.set(tw.x, H.top + 9.5, tw.z); scene.add(d);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 16), own(new THREE.MeshBasicMaterial({ color: 0xf6f8ff })));
    lantern.position.set(tw.x, H.top + 9.5 + (H.R2 + 0.4) * 0.8 + 1, tw.z); scene.add(lantern);
    for (const k of [0, 1]){
      for (let th = Math.PI / 4; th < H.thL - 0.3; th += Math.PI / 2){
        const a = H.base(k) + th, [x, , z] = local(a, H.R1 + 0.6, 0);
        pane(gGlow, x, z, tw.rot + a, H.y(th) + 1.4, H.y(th) + 3.4, 0.6, 0.04);
      }
      for (let q = 0; q < 16; q++){ const a = (q + 0.5) / 16 * Math.PI * 2, [x, , z] = local(a, H.R2 + 0.4, 0); pane(gGlow, x, z, tw.rot + a, H.top + 2, H.top + 7, 0.8, 0.04); }
      const a = H.base(k) + H.DOOR, [x, , z] = local(a, H.R1 + 0.6, 0);
      pane(gGlow, x, z, tw.rot + a, 0, 3.6, 1.5, 0.04);
    }
  }
  // lanterns along the paths
  const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 2.2, 6), lampGeo = new THREE.SphereGeometry(0.28, 10, 8), postMat = K.porphyry;                 // the lantern posts in porphyry (the Julia slab, as the columns')
  for (const [[ax, az], [bx, bz]] of L.paths){
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let s = 6, q = 0; s < len - 4; s += 13, q++){
      const side = q % 2 ? 2.4 : -2.4, x = ax + ux * s - uz * side, z = az + uz * s + ux * side;
      if (!L.isOpen(x, z)) continue;
      const y = L.floorAt(x, z), post = new THREE.Mesh(postGeo, postMat), lamp = new THREE.Mesh(lampGeo, lit);
      post.position.set(x, y + 1.1, z); lamp.position.set(x, y + 2.35, z); scene.add(post, lamp);
    }
  }
  if (L.arcade) for (const m of arcadeView(L.arcade, ringPlace(L.arcade))) scene.add(m);
  for (const [g, m] of [[gWall, K.wall], [gGlow, lit], [gCobble, cobbleMat()], [gDrum, juliaMat('wall', 0x2a2c58, { clearcoat: 0.35, clearcoatRoughness: 0.2 })]]){ const mesh = g.mesh(m); if (mesh) scene.add(mesh); }
  return { scene, sky, dispose: disposer(scene),
    update(dt, camera){
      sky.update(dt, camera);
      sky.domeU.uDay.value = 0.32;                 // the Doom band shows, dimly (the shader scales it by daylight)
    } };
}
