// Under the Lea, drawn (js/gen/under.js plans the mouths and builds the levels).
//
// Above ground: each cave mouth is a dark arch going back into the hillside,
// framed by boulders under a rock brow; the crypt is a stairwell in the chapel's
// floor inside a stone kerb.
//
// Below: a level is its own THREE.Scene, black beyond the torch. Floors, walls
// and ceilings come from the level's grid in chunks (so three.js culls the parts
// behind you); a cave's corners are jittered so its walls read as rock, not
// blocks. Light is your torch, a faint ambient so the dark isn't flat, glowing
// fungus on some walls, and the daylight at each mouth.

import * as THREE from 'three';
import { under, height } from './terrain.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo } from './settle-view.js';
import { ashlar, flags, rock, hewn, marble, relief, reliefFromImage, fresco } from './stone-tex.js';
import { glass, jewels, outlines, outlinePath } from './glass.js';
import { juliaMaterial } from './julia-tex.js';
import { pavement, PAVEMENTS } from './pavement.js';
import { CELL, bayAt, STONES } from './gen/under.js';
import { ingredient } from './ingredients.js';
import { Boats } from './boats.js';
import { mulberry32 } from './rng.js';
import { wisps } from './wisps.js';

const TILE = 3;                      // world size of one texture tile underground (u)
const CHUNK = 24;                    // cells per mesh, each way
const TORCH = { color: 0xffa04a, intensity: 5, distance: 26, decay: 1.3 };
const shade = (c, k, n = 0) => c.map(v => v * k + n);
const GLOW = 0x4ff0d0;               // the fungus's light: a blue-green, as foxfire is
// how grand a region's finish: its floor going down, and a Faerie palace grander than the
// deepest floor (5) everywhere, passages and stairs too
const depthOf = R => R ? (R.palace ? 5 : R.fl ?? 0) : 0;

let MATS = null;
function materials(){
  if (MATS) return MATS;
  // worn stone with depth (stone-tex.js): one height field gives the colour and the normal map
  const lam = (t, { side = THREE.FrontSide, vc = true, ns = 1 } = {}) =>
    new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(ns, ns), vertexColors: vc, side });
  // the walls' textures are 128px over two tiles (6u) each way, so they repeat half as often
  const big = t => { for (const m of [t.map, t.normalMap]) m.repeat.set(0.5, 0.5); return t; };
  const rk = rock(0x50c4, {}), wall = big(ashlar(0xa51a, { w: 128, h: 128, courses: 8, len: [12, 26], wear: 1.2, tone: [134, 126, 112], moss: 0.25 }));
  const wallB = big(ashlar(0xb0b2, { w: 128, h: 128, courses: 10, len: [8, 40], wear: 1.0, tone: [142, 126, 104], moss: 0.15 }));    // warmer, long and short
  const wallC = big(ashlar(0xc0c3, { w: 128, h: 128, courses: 5, len: [28, 56], wear: 1.4, tone: [126, 124, 118], moss: 0.2 }));    // big grey blocks
  const rockCut = big(hewn(0x4e11, {})), rockFloor = big(hewn(0x4e12, { tone: [112, 104, 92], strength: 2.4 }));
  const vault = ashlar(0x7a017, { courses: 6, len: [8, 16], wear: 0.9, tone: [124, 118, 106], moss: 0.12 });
  const drums = ashlar(0xc01, { courses: 5, len: [64, 64], wear: 1.1, tone: [138, 130, 116], moss: 0.1 });   // a column: courses of drums, no vertical joints
  const fl = flags(0xf1a65, {});
  // polished marble (stone-tex.js marble()): smooth, so the torch slides across it; worn duller in places
  const pol = (t, { vc = true, big: b = true } = {}) => {
    if (b) for (const m of [t.map, t.normalMap, t.orm]) m.repeat.set(0.5, 0.5);
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 0.7, vertexColors: vc });
  };
  return MATS = {
    cave: { floor: lam(rk, { ns: 0.8 }), wall: lam(rk), ceil: lam(rk) },
    crypt: { floor: lam(fl), wall: lam(wall), ceil: lam(vault), column: lam(drums, { vc: false }), trim: lam(wall),
      walls: { A: lam(wall), B: lam(wallB), C: lam(wallC), hewn: lam(rockCut), M: pol(marble('revet', 41)) }, hewnFloor: lam(rockFloor, { ns: 0.7 }),
      // grander floors going down (pavement.js): glazed tiles on the cathedral's floor, Cosmati work on the two below;
      // each texture covers its own `world` of u, so its repeat is set from that
      pave: Object.fromEntries(PAVEMENTS.map((k, q) => { const t = pavement(k, 61 + q * 17); for (const m of [t.map, t.normalMap, t.orm]) m.repeat.set(TILE / t.world, TILE / t.world); const mt = pol(t, { big: false }); mt.userData.world = t.world; return [k, mt]; })),
      // and marble columns under the gilded capitals: verde antico, porphyry for the slender shafts
      verde: pol(marble('shaft', 53), { vc: false, big: false }), porphyry: pol(marble('porphyry', 59), { vc: false, big: false }),
      // voussoirs: one course of wedge stones, laid round an arch by archBand()
      vous: lam(ashlar(0x7005, { w: 128, h: 32, courses: 1, len: [22, 30], mortar: 1.4, wear: 1.0, tone: [142, 134, 118], moss: 0.08, strength: 3.6 })) },
    lam,
    dark: new THREE.MeshLambertMaterial({ color: 0x1b1814 }),
    black: new THREE.MeshBasicMaterial({ color: 0x050403 }),
    rock: lam(rk),
    plain: new THREE.MeshLambertMaterial({ vertexColors: true }),
    iron: new THREE.MeshLambertMaterial({ vertexColors: true }),
    daylight: new THREE.MeshBasicMaterial({ color: 0xd8e6ee, fog: false, side: THREE.DoubleSide }),
    water: new THREE.MeshLambertMaterial({ color: 0x0c1a20, transparent: true, opacity: 0.88 }),
    quartz: new THREE.MeshLambertMaterial({ color: 0xe8eef2, emissive: 0x203040, flatShading: true }),
    amber: new THREE.MeshLambertMaterial({ color: 0xd88a2a, emissive: 0x3a1a00 }),
    cap: new THREE.MeshLambertMaterial({ color: 0xb8a078 }), stem: new THREE.MeshLambertMaterial({ color: 0xe0d8c4 }),
    glowCap: new THREE.MeshLambertMaterial({ color: 0x9fe8dc, emissive: GLOW, emissiveIntensity: 0.8 }), glowStem: new THREE.MeshLambertMaterial({ color: 0xd8f0ea, emissive: GLOW, emissiveIntensity: 0.3 }),
    salt: new THREE.MeshLambertMaterial({ color: 0xf4f2ec, emissive: 0x202428, flatShading: true }),
    wax: new THREE.MeshLambertMaterial({ color: 0xd9b45a, emissive: 0x2a1c04 }),
    fish: new THREE.MeshLambertMaterial({ color: 0xe8dcd4, emissive: 0x1a1414 }),
    // dripstone: the cave's rock, paler and wetter (calcite, not the rock it grew on)
    drip: lam(rk, { ns: 0.6 }),
    flame: new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    halo: new THREE.SpriteMaterial({ map: haloTexture(), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.35 }),
    weave: weaveNormal(),
    // gilding: gold leaf over carved stone, so the stone's worn relief shows through it
    // (not fully metal: there's no environment underground for a mirror to show, so a true metal reads black but for its highlights)
    gold: new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 0.7, roughness: 0.38, normalMap: drums.normalMap, normalScale: new THREE.Vector2(0.6, 0.6) }),
  };
}

// a pixel flame, white-hot at the root, and a soft halo round it
function flameTexture(){
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 32;
  const g = cv.getContext('2d'), im = g.createImageData(16, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 16; x++){
    const v = 1 - y / 32, wdt = 6.5 * Math.sin(Math.PI * Math.min(1, (y + 2) / 30)) * (0.55 + 0.45 * v), d = Math.abs(x + 0.5 - 8) / Math.max(0.01, wdt);
    if (d > 1) continue;
    const heat = (1 - d) * (0.4 + 0.6 * (y / 32)), o = (y * 16 + x) * 4;
    im.data[o] = 255; im.data[o + 1] = 120 + 135 * heat; im.data[o + 2] = 40 + 180 * heat * heat; im.data[o + 3] = 255 * Math.min(1, (1 - d) * 2.2);
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function haloTexture(){
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,170,80,1)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// woven cloth: warp and weft crossing over and under, as a normal map tile
function weaveNormal(){
  const N = 8, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'), im = g.createImageData(N, N);
  const h = (x, y) => { const over = ((Math.floor(x / 2) + Math.floor(y / 2)) & 1) === 0; return over ? Math.sin(((x % 2) + 0.5) / 2 * Math.PI) : Math.sin(((y % 2) + 0.5) / 2 * Math.PI) * 0.7; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    let nx = -(h(x + 1, y) - h(x + N - 1, y)) * 1.2, ny = (h(x, y + 1) - h(x, y + N - 1)) * 1.2, nz = 1; const l = Math.hypot(nx, ny, nz), o = (y * N + x) * 4;
    im.data[o] = (nx / l * 0.5 + 0.5) * 255; im.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; im.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; im.data[o + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---- above ground ------------------------------------------------------------------
export function buildEntrances(scene){
  const mats = materials(), group = new THREE.Group();
  under().entrances.forEach((e, n) => {
    const r = mulberry32(0xe17 + n * 7717);
    if (e.kind === 'cave') caveMouth(group, e, r, mats); else stairwell(group, e, r, mats);
  });
  scene.add(group);
  return group;
}

// the openings' sizes, shared by the drawing and by entranceHit()
const ARCH = { back: 1.0, W: 2.6, SPR: 1.8, sink: 0.6 };   // a cave mouth: set back into the hill, half-width, springing height
const WELL = { L: 4.6, W: 1.5 };                            // the crypt stair: length back from the mouth, half-width

// Does a view ray (from o along unit d) hit this entrance's opening within
// `reach`? Returns the distance along the ray, or -1. A cave mouth is its arch,
// a vertical opening in the hillside; the stair is a hole in the floor. This is
// what E aims at, so it is the shape you see, not a point near it.
export function entranceHit(e, ox, oy, oz, dx, dy, dz, reach){
  const fx = Math.cos(e.face), fz = Math.sin(e.face), tx = -fz, tz = fx;
  if (e.kind === 'cave'){
    const px = e.x - fx * ARCH.back, pz = e.z - fz * ARCH.back, y0 = height(px, pz) - ARCH.sink;
    const den = dx * fx + dz * fz;                         // facing the arch: the ray runs into the hill
    if (den > -0.05) return -1;
    const t = ((px - ox) * fx + (pz - oz) * fz) / den;
    if (t < 0 || t > reach) return -1;
    const u = (ox + dx * t - px) * tx + (oz + dz * t - pz) * tz, v = oy + dy * t - y0;
    const top = v <= ARCH.SPR ? ARCH.W : Math.sqrt(Math.max(0, ARCH.W * ARCH.W - ((v - ARCH.SPR) / 0.95) ** 2));
    return v >= 0 && Math.abs(u) <= top + 0.4 ? t : -1;
  }
  if (dy > -0.05) return -1;                               // the stairwell: looking down at it
  const y = height(e.x - fx * WELL.L / 2, e.z - fz * WELL.L / 2), t = (y - oy) / dy;
  if (t < 0 || t > reach) return -1;
  const qx = ox + dx * t - e.x, qz = oz + dz * t - e.z, u = -(qx * fx + qz * fz), v = qx * tx + qz * tz;
  return u >= -0.6 && u <= WELL.L + 0.6 && Math.abs(v) <= WELL.W + 0.6 ? t : -1;   // the kerb counts
}

function caveMouth(group, e, r, mats){
  const fx = Math.cos(e.face), fz = Math.sin(e.face), tx = -fz, tz = fx;
  const px = e.x - fx * ARCH.back, pz = e.z - fz * ARCH.back, y0 = height(px, pz) - ARCH.sink, DEPTH = 5;
  // the arch's outline, left foot round the top to right foot (across, up)
  const W = ARCH.W, SPR = ARCH.SPR, out = [[-W, 0]];
  for (let q = 0; q <= 10; q++){ const a = Math.PI - q / 10 * Math.PI; out.push([Math.cos(a) * W, SPR + Math.sin(a) * W * 0.95]); }
  out.push([W, 0]);
  const P = (u, v, back) => [px + tx * u - fx * back, y0 + v, pz + tz * u - fz * back];
  const G = new Geo(), Z = [0, 0];
  for (let k = 0; k + 1 < out.length; k++){
    const [u0, v0] = out[k], [u1, v1] = out[k + 1], mu = (u0 + u1) / 2, mv = (v0 + v1) / 2 - SPR * 0.5;
    G.quad(P(u0, v0, 0), P(u1, v1, 0), P(u1, v1, DEPTH), P(u0, v0, DEPTH), Z, Z, Z, Z, [-tx * mu, -mv, -tz * mu], [0.5, 0.47, 0.44]);
  }
  group.add(G.mesh(mats.dark));
  // the dark at the back
  const B = new Geo();
  for (let k = 0; k + 1 < out.length; k++) B.tri(P(0, SPR * 0.6, DEPTH), P(...out[k], DEPTH), P(...out[k + 1], DEPTH), Z, Z, Z, [fx, 0, fz], [1, 1, 1]);
  group.add(B.mesh(mats.black));
  // boulders round it and a brow of rock over it
  const R = new Geo();
  const rock = (cx, cz, cy, sx, sy, sz, a) => {
    const c = Math.cos(a), s = Math.sin(a), hx = sx / 2, hz = sz / 2, k = 0.85 + r() * 0.25, col = [k, k * 0.97, k * 0.93];
    const C = (u, v, y) => [cx + c * u - s * v, y, cz + s * u + c * v];
    const uv = (a1, y) => [a1 / TILE, y / TILE];
    for (const [u0, v0, u1, v1, ox, oz] of [[-hx, -hz, hx, -hz, 0, -1], [hx, -hz, hx, hz, 1, 0], [hx, hz, -hx, hz, 0, 1], [-hx, hz, -hx, -hz, -1, 0]])
      R.quad(C(u0, v0, cy), C(u1, v1, cy), C(u1 * 0.8, v1 * 0.8, cy + sy), C(u0 * 0.8, v0 * 0.8, cy + sy), uv(0, 0), uv(sx, 0), uv(sx, sy), uv(0, sy), [c * ox - s * oz, 0, s * ox + c * oz], col);
    R.quad(C(-hx * 0.8, -hz * 0.8, cy + sy), C(hx * 0.8, -hz * 0.8, cy + sy), C(hx * 0.8, hz * 0.8, cy + sy), C(-hx * 0.8, hz * 0.8, cy + sy), Z, [sx / TILE, 0], [sx / TILE, sz / TILE], [0, sz / TILE], [0, 1, 0], col);
  };
  for (let k = 1; k < out.length - 1; k += 2){
    const [u, v] = out[k], l = Math.hypot(u, v - SPR * 0.5) || 1, push = 1.1 + r() * 0.6;
    const cu = u + u / l * push, cv = v + (v - SPR * 0.5) / l * push * 0.6, [cx, , cz] = P(cu, 0, 0.4 + r());
    const s = 1.6 + r() * 1.4;
    rock(cx, cz, y0 + Math.max(-0.4, cv - s * 0.6), s, s * (0.8 + r() * 0.5), s * (0.9 + r() * 0.6), e.face + (r() - 0.5));
  }
  for (const side of [-1, 1]){ const [cx, , cz] = P(side * (W + 1.4), 0, 0.2); rock(cx, cz, y0 - 0.3, 2.2 + r(), 1.8 + r(), 2.4, e.face + r()); }
  const [bx, , bz] = P(0, 0, DEPTH * 0.45);
  rock(bx, bz, y0 + SPR + W * 0.8, W * 2 + 2.4, 1.6, DEPTH + 2, e.face + Math.PI / 2);
  group.add(R.mesh(mats.rock));
}

function stairwell(group, e, r, mats){
  const fx = Math.cos(e.face), fz = Math.sin(e.face), tx = -fz, tz = fx, L = WELL.L, W = WELL.W;
  // the opening runs back from the mouth, away from where you stand
  const P = (u, v, lift = 0.1) => { const x = e.x - fx * u + tx * v, z = e.z - fz * u + tz * v; return [x, height(x, z) + lift, z]; };
  // in half-unit squares, so it follows the ground rather than sinking into a rise
  const G = new Geo(), Z = [0, 0], NU = Math.ceil(L / 0.5), NV = Math.ceil(2 * W / 0.5);
  for (let a = 0; a < NU; a++) for (let b = 0; b < NV; b++){
    const u0 = a * L / NU, u1 = (a + 1) * L / NU, v0 = -W + b * 2 * W / NV, v1 = -W + (b + 1) * 2 * W / NV;
    G.quad(P(u0, v0), P(u0, v1), P(u1, v1), P(u1, v0), Z, Z, Z, Z, [0, 1, 0], [1, 1, 1]);
  }
  group.add(G.mesh(mats.black));
  // the kerb round it, and the first step showing at the near end
  const K = new Geo(), col = [0.62, 0.6, 0.56];
  const kerb = (u, v, len, across, a) => { const [x, y, z] = P(u, v, 0); K.box(x, z, y - 0.3, y + 0.28, len, across, a, col); };
  kerb(L / 2, -W - 0.3, L + 1.2, 0.6, e.face); kerb(L / 2, W + 0.3, L + 1.2, 0.6, e.face);
  kerb(-0.3, 0, 0.6, 2 * W, e.face); kerb(L + 0.3, 0, 0.6, 2 * W, e.face);
  const [sx, sy, sz] = P(0.5, 0, 0); K.box(sx, sz, sy - 0.5, sy - 0.25, 0.8, 2 * W, e.face, [0.5, 0.48, 0.45]);
  group.add(K.mesh(mats.plain));
}

// ---- below ground ------------------------------------------------------------------
// A level's own scene, and update(dt, camera) to carry the torch. reveal() is
// main.js's to call; dispose() frees the GPU side on the way out.
// each crypt's own stone (gen/under.js STONES): its stone materials, tinted; the maps are shared
const TINTED = new Map();
function tinted(c, stone){
  if (!TINTED.has(stone)){
    const k = STONES[stone], t = m => { const n = m.clone(); n.color.setRGB(k[0], k[1], k[2]); return n; };
    TINTED.set(stone, { ...c, floor: t(c.floor), wall: t(c.wall), ceil: t(c.ceil), column: t(c.column), trim: t(c.trim), hewnFloor: t(c.hewnFloor), vous: t(c.vous),
      walls: { ...c.walls, A: t(c.walls.A), B: t(c.walls.B), C: t(c.walls.C), hewn: t(c.walls.hewn) } });
  }
  return TINTED.get(stone);
}
// a Faerie palace's: no plain stone anywhere. Mosaic underfoot (the passages and stairs paved
// too: pavingOf), marble walls, trim and arches, verde antico columns, gold mosaic overhead
let PALACE_MATS = null;
function palaceMats(c){
  if (PALACE_MATS) return PALACE_MATS;
  // the columns and piers in the Julia slabs (julia-calc.js), as the Turning Stair's: verde, and porphyry
  const verde = juliaMaterial('verdeSlab', 0x2f6a52, { clearcoat: 0.6, clearcoatRoughness: 0.08, envMap: palaceEnv() });
  const porphyry = juliaMaterial('porphyrySlab', 0x6a2438, { clearcoat: 0.6, clearcoatRoughness: 0.08, envMap: palaceEnv() });
  // the walls, their trim and arches, and the vaults overhead, in Julia slabs too the
  // stair's cloisonné, and the dome's spiral colouring. Vertex colours kept, for the shading
  const wall = juliaMaterial('wallSlab', 0x2a2c58, { vertexColors: true, clearcoat: 0.3, clearcoatRoughness: 0.2, envMap: palaceEnv() });
  const vault = juliaMaterial('vaultSlab', 0x4a3a78, { vertexColors: true, clearcoat: 0.3, clearcoatRoughness: 0.2, envMap: palaceEnv() });
  return (PALACE_MATS = { ...c, verde, porphyry, floor: c.pave.cubes, hewnFloor: c.pave.cubes, ceil: vault, column: verde, trim: wall, vous: wall,
    walls: { ...c.walls, M: wall, A: wall, B: wall, C: wall, hewn: wall } });
}
// and what its polish and gold reflect, so they shine as metal and marble do in a bright room
// (underground there's nothing, so a crypt goes without): a pale vault above, a ring of lit
// windows at eye height, warm gold and marble below. An equirectangular picture; three makes
// it into the blurred reflections each roughness wants
let PALACE_ENV = null;
function palaceEnv(){
  if (PALACE_ENV) return PALACE_ENV;
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d'), sky = g.createLinearGradient(0, 0, 0, 128);
  sky.addColorStop(0, '#8e78cc'); sky.addColorStop(0.45, '#56468e'); sky.addColorStop(0.55, '#5e4664'); sky.addColorStop(1, '#251a36');   // a violet dusk, not a bright day
  g.fillStyle = sky; g.fillRect(0, 0, 256, 128);
  const glassC = ['#ffe9a8', '#bcd4ff', '#ffc4c4', '#d8ffd8'];
  for (let q = 0; q < 12; q++){ g.fillStyle = glassC[q % 4]; g.fillRect(q * 256 / 12 + 6, 34, 9, 26); }
  const t = new THREE.CanvasTexture(cv); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return PALACE_ENV = t;
}
// the palace's materials, for the rest of Faerie (faerie-places-view.js): mosaic underfoot,
// marble walls, verde and porphyry columns, gold mosaic overhead, gilding, and the palace's
// reflections. The floor, walls and mosaic want vertex colours (Geo gives them)
// the light in Faerie's buildings (2026-10-27): dimmer than day, blue-violet, a haze
// at the far end of a hall; the windows and the floating lights do the rest
export const FAERIE_LIGHT = { haze: 0x1f1440, near: 16, far: 110, ambient: [0x7a58d0, 0.5], hemi: [0xa07cff, 0x2a1850, 0.55] };
export function lightFaerie(scene){
  const F = FAERIE_LIGHT;
  scene.background = new THREE.Color(F.haze);
  scene.fog = new THREE.Fog(F.haze, F.near, F.far);
  scene.add(new THREE.AmbientLight(...F.ambient), new THREE.HemisphereLight(...F.hemi));
  scene.environment = palaceEnv();
}
// a stained-glass window lit from behind, as a palace's (reliefMat, tier 'glow'): 'lancet',
// 'clerestory', 'triforium' or 'rose', in three variants
export function faerieGlass(pattern = 'lancet', variant = 0){ return reliefMat(pattern, true, materials(), variant, 'glow'); }
// the same, its tracery gilt and only its glass lit (the Turning Stair's: the tracery's
// pale stone, glowing with the glass, read as silver)
const GILT = new Map();
export function faerieGiltGlass(pattern = 'lancet', variant = 0){
  if (GILT.has(pattern + variant)) return GILT.get(pattern + variant);
  const t = glass(pattern, 23 + variant * 101, { ...TRACERY[pattern], tier: 'gems', gilt: true });
  const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 1,
    alphaMap: t.alpha, alphaTest: 0.5, emissive: 0xffffff, emissiveMap: t.glow, emissiveIntensity: 2.4, envMap: palaceEnv() });
  GILT.set(pattern + variant, m);
  return m;
}
export function faerieKit(){
  const base = materials(), c = palaceMats(base.crypt);
  return { floor: c.floor, wall: c.walls.M, mosaic: c.ceil, verde: c.verde, porphyry: c.porphyry, gold: base.gold, water: base.water, env: palaceEnv(), tile: TILE };
}
export function buildLevelView(L){
  const base = materials(), stone = L.kind === 'crypt' && L.style ? L.style.stone : 'grey';
  const mats = L.site === 'palace' ? { ...base, crypt: palaceMats(base.crypt) } : stone === 'grey' ? base : { ...base, crypt: tinted(base.crypt, stone) }, M = L.kind === 'cave' ? mats.cave : mats.crypt;
  const scene = new THREE.Scene();
  // a Faerie palace (gen/faerie.js) is brightly lit, its far end lost in a pale haze, not the dark
  const palace = L.site === 'palace';
  if (palace) lightFaerie(scene);
  else {
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 5, L.kind === 'cave' ? (L.cavern ? 55 : 34) : 70);   // a crypt's halls, and a cave's great cavern, are big enough to want further
    // a crypt's dark is grey; a cave's is faintly the foxfire' blue-green, never quite black
    scene.add(L.kind === 'cave' ? new THREE.AmbientLight(GLOW, 0.05) : new THREE.AmbientLight(0x3a4250, 0.35));
  }
  const torch = new THREE.PointLight(TORCH.color, palace ? 0 : TORCH.intensity, TORCH.distance, TORCH.decay);
  if (!palace) scene.add(torch);                       // in Faerie your torch is out
  const CW = L.W + 1, cave = L.kind === 'cave';
  let crypt = null;
  if (!cave) crypt = cryptView(L, scene, mats);
  // corner positions: a cave's are shifted a little each way so its walls are rough
  const hash = (i, j, s) => { let n = (i * 73856093 ^ j * 19349663 ^ s * 83492791) >>> 0; n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0; return (n >>> 8) / 16777216; };
  const cx = (i, j) => L.x0 + i * CELL + (cave ? (hash(i, j, 1) - 0.5) * 1.1 : 0);
  const cz = (i, j) => L.z0 + j * CELL + (cave ? (hash(i, j, 2) - 0.5) * 1.1 : 0);
  const F = (i, j, d = 0) => [cx(i, j), L.floorC[j * CW + i] + d, cz(i, j)];
  const C = (i, j, d = 0) => [cx(i, j), L.ceilC[j * CW + i] + d, cz(i, j)];
  const uvF = p => [p[0] / TILE, p[2] / TILE];
  const open = (i, j) => i >= 0 && j >= 0 && i < L.W && j < L.H && L.open[j * L.W + i] === 1;
  if (cave) for (let J = 0; J < L.H; J += CHUNK) for (let I = 0; I < L.W; I += CHUNK){
    const gF = new Geo(), gW = new Geo(), gC = new Geo();
    for (let j = J; j < Math.min(L.H, J + CHUNK); j++) for (let i = I; i < Math.min(L.W, I + CHUNK); i++){
      if (!open(i, j)) continue;
      const k = 0.8 + hash(i, j, 3) * 0.3, col = cave ? [k, k * 0.95, k * 0.88] : [k, k, k * 0.96];
      const a = F(i, j), b = F(i + 1, j), c = F(i + 1, j + 1), d = F(i, j + 1);
      gF.quad(a, b, c, d, uvF(a), uvF(b), uvF(c), uvF(d), [0, 1, 0], shade(col, cave ? 0.75 : 1));
      const ca = C(i, j), cb = C(i + 1, j), cc = C(i + 1, j + 1), cd = C(i, j + 1);
      gC.quad(ca, cb, cc, cd, uvF(ca), uvF(cb), uvF(cc), uvF(cd), [0, -1, 0], shade(col, 0.8));
      // a wall on each side that meets solid rock
      for (const [di, dj, p0, p1] of [[1, 0, [i + 1, j], [i + 1, j + 1]], [-1, 0, [i, j], [i, j + 1]], [0, 1, [i, j + 1], [i + 1, j + 1]], [0, -1, [i, j], [i + 1, j]]]){
        if (open(i + di, j + dj)) continue;
        const f0 = F(...p0, -0.3), f1 = F(...p1, -0.3), t0 = C(...p0, 0.3), t1 = C(...p1, 0.3);
        const s0 = (f0[0] + f0[2]) / TILE, s1 = s0 + Math.hypot(f1[0] - f0[0], f1[2] - f0[2]) / TILE;
        gW.quad(f0, f1, t1, t0, [s0, f0[1] / TILE], [s1, f1[1] / TILE], [s1, t1[1] / TILE], [s0, t0[1] / TILE], [-di, 0, -dj], col);
      }
    }
    for (const [g, m] of [[gF, M.floor], [gW, M.wall], [gC, M.ceil]]){ const mesh = g.mesh(m); if (mesh) scene.add(mesh); }
  }
  // daylight at each mouth: the way out
  for (const m of L.mouths){
    if (m.grand){ grandDoor(scene, L, m, mats); continue; }
    const w = L.kind === 'cave' ? 6 : 4.2, h = L.kind === 'cave' ? 5 : 4, y = L.floorAt(m.x, m.z) - 0.5;
    const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats.daylight);
    q.position.set(m.x + Math.cos(m.face) * 0.6, y + h / 2, m.z + Math.sin(m.face) * 0.6);
    q.rotation.y = Math.PI / 2 - m.face;            // the plane faces back down the passage
    scene.add(q);
  }
  // the pool, stone coffins, glowing fungus
  // the pool, and a cavern's lake: one flat disc each, the floor above it hiding its edge
  for (const wt of L.waters || []){
    const w = new THREE.Mesh(new THREE.CircleGeometry(wt.r, wt.lake ? 64 : 28), mats.water);
    w.rotation.x = -Math.PI / 2; w.position.set(wt.x, wt.y, wt.z);
    scene.add(w);
  }
  if (L.drips && L.drips.length) dripstone(L, scene, mats);
  if (L.shelves && L.shelves.length) bookshelves(L, scene, mats);
  const glow = glowLights(L, scene);
  // the finds: each its own little group, hidden once taken
  for (const f of L.finds){
    const g = new THREE.Group(), r = mulberry32(Math.round(f.x * 13 + f.z * 7));
    const y = f.y ?? L.floorAt(f.x, f.z);
    const ing = ingredient(f.kind), pic = ing?.pic;
    if (pic){                                                    // a picture of it, always facing you, standing on the floor
      const s = new THREE.Sprite(picMat((f.n > 1 && pic[1]) || pic[0], ing.virtues?.includes('shine'))), w = f.n > 1 && pic[1] ? 0.85 : 0.6;
      s.center.set(0.5, 0); s.scale.set(w, w * 96 / 90, 1); g.add(s);
    } else if (f.kind === 'quartz') for (let q = 0; q < 3 + f.n; q++){
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), mats.quartz);
      m.scale.set(1, 2.4 + r() * 1.6, 1); m.position.set((r() - 0.5) * 0.5, 0.2, (r() - 0.5) * 0.5);
      m.rotation.set((r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8); g.add(m);
    } else if (f.kind === 'amber') for (let q = 0; q < 2 + f.n * 2; q++){
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), mats.amber);
      const a = q / (2 + f.n * 2) * Math.PI * 2; m.position.set(Math.cos(a) * 0.22, 0.05, Math.sin(a) * 0.22); g.add(m);   // a string of beads, broken
    } else if (f.kind === 'gold') for (let q = 0; q < 4 + f.n * 3; q++){   // a heap of coins
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.025, 10), mats.gold);
      const a = r() * 6.28, d = r() * 0.28 * (q < 6 ? 1 : 0.5); m.position.set(Math.cos(a) * d, 0.015 + (q >= 6 ? 0.025 * (q - 5) : 0), Math.sin(a) * d); m.rotation.set((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3); g.add(m);
    } else if (f.kind === 'cave salt') for (let q = 0; q < 5 + f.n * 3; q++){   // a white crust of crystals on the rock
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08 + r() * 0.1, 0.03 + r() * 0.05, 0.08 + r() * 0.1), mats.salt);
      const a = r() * 6.28, d = r() * 0.4; m.position.set(Math.cos(a) * d, 0.02, Math.sin(a) * d); m.rotation.set((r() - 0.5) * 0.4, r() * 3, (r() - 0.5) * 0.4); g.add(m);
    } else if (f.kind === 'blindfish') for (let q = 0; q < 1 + f.n; q++){       // pale fish, still in the shallows
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 5), mats.fish); body.scale.set(2.6, 0.7, 0.9);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 4), mats.fish); tail.rotation.z = Math.PI / 2; tail.position.x = -0.3;
      const fish = new THREE.Group(); fish.add(body, tail);
      fish.position.set((r() - 0.5) * 0.7, -0.05 * q, (r() - 0.5) * 0.7); fish.rotation.y = r() * 6.28; g.add(fish);
    } else if (f.kind === 'beeswax'){                                        // a lump of old wax, run down off the altar candles
      const lump = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), mats.wax); lump.scale.set(1.3, 0.45, 1); lump.position.y = 0.05; g.add(lump);
      for (let q = 0; q < 3; q++){ const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), mats.wax); d.position.set((r() - 0.5) * 0.3, 0.02, (r() - 0.5) * 0.25); d.scale.y = 0.6; g.add(d); }
    } else for (let q = 0; q < 2 + f.n; q++){                    // mushrooms; foxfire are the glow's own, lit from within
      const s = 0.7 + r() * 0.6, x = (r() - 0.5) * 0.8, z = (r() - 0.5) * 0.8, gc = f.kind === 'foxfire';
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.04 * s, 0.22 * s, 5), gc ? mats.glowStem : mats.stem); stem.position.set(x, 0.11 * s, z);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.13 * s, 0.1 * s, 7), gc ? mats.glowCap : mats.cap); cap.position.set(x, 0.24 * s, z);
      g.add(stem, cap);
    }
    g.position.set(f.x, y, f.z); g.visible = !f.taken; f.view = g;
    scene.add(g);
  }
  // past the fog nothing shows, so don't draw it: the other floors, the far end of a cave
  const far = scene.fog.far + 6, culled = [];
  scene.updateMatrixWorld(true);   // (or whatever was placed by its position counts as at the origin, and is never drawn)
  scene.traverse(o => { if (!o.isMesh) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const bs = o.isInstancedMesh ? o.boundingSphere : o.geometry.boundingSphere; if (bs) culled.push({ o, c: bs.center.clone().applyMatrix4(o.matrixWorld), r: bs.radius }); });
  // the lake's canoe: added after the culling list, since it goes where you paddle it
  // Faerie: the floating lights, and the stained glass casting its light into the room
  // (the nearest few windows, and the great door, each lend a light from a fixed pool)
  const lights = palace && L.wisps ? wisps(scene, L.wisps) : null;
  const panes = palace ? [...L.panels.filter(p => TRACERY[p.pattern]).map(p => ({ x: p.x + Math.cos(p.face) * 1.6, y: p.y, z: p.z + Math.sin(p.face) * 1.6, i: 3.2, c: 0xc8b4ff })),
    ...L.mouths.filter(m => m.grand).map(m => ({ x: m.x - Math.cos(m.face) * 2, y: m.y + 3.5, z: m.z - Math.sin(m.face) * 2, i: 5, c: 0xa8a0ff }))] : [];
  const paneLights = panes.length ? Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffffff, 0, 20, 1.3); scene.add(l); return l; }) : [];
  let paneT = 0;
  let boats = null, canoe = null;
  if (L.canoe){ boats = new Boats(scene); canoe = boats.add(L.canoe.x, L.canoe.z, L.canoe.yaw, L.cavern.lake.y); }
  let t = 0, cullT = 0;
  return {
    scene, canoe,
    update(dt, camera){
      t += dt;
      if ((cullT -= dt) <= 0){
        cullT = 0.25;
        const p = camera.position;
        for (const m of culled) m.o.visible = !m.o.userData.pending && m.c.distanceTo(p) - m.r < far;   // a tapestry stays hidden until its cloth is made
      }
      torch.position.set(camera.position.x, camera.position.y - 0.25, camera.position.z);
      torch.intensity = (palace ? 0 : TORCH.intensity) * (0.9 + 0.06 * Math.sin(t * 11) + 0.04 * Math.sin(t * 23.7));
      for (const f of L.finds) if (f.view) f.view.visible = !f.taken;
      glow.update(camera, t);
      if (boats) boats.update(dt, t);
      if (crypt) crypt.update(dt, camera, t);
      if (lights) lights.update(dt, camera, t);
      if (paneLights.length && (paneT -= dt) <= 0){
        paneT = 0.4;
        const p = camera.position, near = panes.map(q => [Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z), q]).sort((a, b) => a[0] - b[0]);
        paneLights.forEach((l, q) => { const [d, w] = near[q] || []; if (!w || d > 50){ l.intensity = 0; return; } l.position.set(w.x, w.y, w.z); l.color.setHex(w.c); l.intensity = w.i; });
      }
    },
    // the geometry, and the materials made for this view alone (the tapestries' aged cloth,
    // the bosses' gems); the shared ones (stone, marble, frescoes, reliefs) stay for the next
    dispose(){
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (m && m.userData && m.userData.own){ for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) m[k]?.dispose(); m.dispose(); }
      });
    },
  };
}

// A palace's great door onto the grounds (gen/faerie.js groundsDoor): a round-headed
// opening in the wall with a marble frame and a gilded archivolt, its two gilded leaves
// standing open into the room. The opening is dark, as the portals in the Lea are, and the
// Gentry's lights spiral into it (gen/faerie.js palaceWisps).
function grandDoor(scene, L, m, mats){
  const DW = 3.6, DH = 5.4, R = DW / 2, y = m.y, fx = Math.cos(m.face), fz = Math.sin(m.face), tx = -fz, tz = fx;
  const rot = Math.atan2(-fx, -fz);                                   // a mesh's front (+z) turned to face into the room
  const at = (u, o) => [m.x + tx * u - fx * o, m.z + tz * u - fz * o];   // u along the wall, o out from it into the room
  const own = mt => { mt.userData.own = true; return mt; };
  // the opening: the night beyond, shaped to the arch
  const sh = new THREE.Shape(); sh.moveTo(-R, 0); sh.lineTo(R, 0); sh.lineTo(R, DH); sh.absarc(0, DH, R, 0, Math.PI, false); sh.lineTo(-R, 0);
  const og = new THREE.ShapeGeometry(sh, 16), uv = og.attributes.uv, pos = og.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + R) / DW, pos.getY(i) / (DH + R));
  const open = new THREE.Mesh(og, own(new THREE.MeshBasicMaterial({ color: 0x06040c, fog: false })));
  const [ox, oz] = at(0, 0.03); open.position.set(ox, y, oz); open.rotation.y = rot; scene.add(open);
  // the frame: marble jambs, a gilded archivolt over them, a threshold
  const marble = own(new THREE.MeshStandardMaterial({ color: 0xe8e4f2, roughness: 0.3, metalness: 0.05 }));
  for (const s of [-1, 1]){
    const j = new THREE.Mesh(new THREE.BoxGeometry(0.55, DH, 0.6), marble), [x, z] = at(s * (R + 0.27), 0.3);
    j.position.set(x, y + DH / 2, z); j.rotation.y = rot; scene.add(j);
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(R + 0.27, 0.3, 8, 28, Math.PI), mats.gold), [ax, az] = at(0, 0.3);
  arch.position.set(ax, y + DH, az); arch.rotation.y = rot; scene.add(arch);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(DW + 1.2, 0.14, 1.1), marble), [sx, sz] = at(0, 0.5);
  sill.position.set(sx, y + 0.07, sz); sill.rotation.y = rot; scene.add(sill);
  // the leaves, gilded, swung open into the room
  const open90 = 1.75;
  for (const s of [-1, 1]){
    const [hx, hz] = at(s * R, 0.1), dx = -s * tx * Math.cos(open90) - fx * Math.sin(open90), dz = -s * tz * Math.cos(open90) - fz * Math.sin(open90);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(R, DH - 0.1, 0.12), mats.gold);
    leaf.position.set(hx + dx * R / 2, y + DH / 2, hz + dz * R / 2); leaf.rotation.y = Math.atan2(-dz, dx); scene.add(leaf);
  }
}

// a find's picture (ingredients.js `pic`), one material per image, kept for the next level.
// A sprite takes no light, so it's never dark; what shines of itself (the foxfire) shows
// through the fog too, and the rest fades into it like the rock
const PIC_MAT = new Map();
function picMat(src, shine){
  if (!PIC_MAT.has(src)){
    const t = new THREE.TextureLoader().load(src); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    PIC_MAT.set(src, new THREE.SpriteMaterial({ map: t, alphaTest: 0.5, fog: !shine }));
  }
  return PIC_MAT.get(src);
}

// a painted vault's material, made the first time a room needs it (stone-tex.js fresco)
const FRESCO_MAT = new Map();
function frescoMat(key){
  if (FRESCO_MAT.has(key)) return FRESCO_MAT.get(key);
  const fresh = key.endsWith('!'), kind = fresh ? key.slice(0, -1) : key;      // '!': a palace's, never worn (gen/under.js)
  const t = fresco(kind, 50 + ['stars', 'vines', 'joints', 'mosaic'].indexOf(kind), { wear: kind === 'mosaic' ? 0.45 : 1, fresh });
  const m = kind === 'mosaic'
    // gold tesserae: metal and smooth where the gold is, so they catch every flame
    ? new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 0.7, vertexColors: true })
    : new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, vertexColors: true });
  FRESCO_MAT.set(key, m);
  return m;
}

// ---- the crypt's architecture --------------------------------------------------------
// An arch's ring of voussoirs, textured round the arch: the stone's courses run
// along the curve and its joints point to the centre, as wedge-cut voussoirs are
// laid, instead of level courses the curve cuts across. `curve` is the intrados,
// [along, y] from one springing to the other; P(along, y, off) places a point,
// `off` through the arch's depth; faces: [{ off, n }] its faces (n, the world
// normal), soffit: [off0, off1] the underside between them. Returns the
// extrados, for whatever wall stands on it.
const VOUSSOIR = 4.6;                    // u of arc one voussoir texture tile covers (about five stones)
function archBand(G, curve, P, band, faces, soffit, col = [1, 0.98, 0.94], extrados = false, tile = VOUSSOIR){
  const n = curve.length - 1, s = [0], N = [], O = [];
  for (let q = 1; q <= n; q++) s.push(s[q - 1] + Math.hypot(curve[q][0] - curve[q - 1][0], curve[q][1] - curve[q - 1][1]));
  for (let q = 0; q <= n; q++){
    const a = curve[Math.max(0, q - 1)], b = curve[Math.min(n, q + 1)], ta = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(ta, ty) || 1;
    N.push([-ty / l, ta / l]); O.push([curve[q][0] - ty / l * band, curve[q][1] + ta / l * band]);
  }
  const u = q => s[q] / tile;
  for (let q = 0; q < n; q++){
    const k = 0.92 + 0.08 * Math.sin(q * 2.7);
    for (const f of faces)
      G.quad(P(...curve[q], f.off), P(...curve[q + 1], f.off), P(...O[q + 1], f.off), P(...O[q], f.off), [u(q), 0], [u(q + 1), 0], [u(q + 1), 1], [u(q), 1], f.n, shade(col, k));
    if (soffit){
      const [o0, o1] = soffit, mid = P(...curve[q], 0), cen = P(curve[q][0] - N[q][0], curve[q][1] - N[q][1], 0);
      G.quad(P(...curve[q], o0), P(...curve[q + 1], o0), P(...curve[q + 1], o1), P(...curve[q], o1), [u(q), 0], [u(q + 1), 0], [u(q + 1), 1], [u(q), 1], [cen[0] - mid[0], cen[1] - mid[1], cen[2] - mid[2]], shade(col, k * 0.9));
      if (extrados){
        const m2 = P(...O[q], 0), out = P(O[q][0] + N[q][0], O[q][1] + N[q][1], 0);
        G.quad(P(...O[q], o0), P(...O[q + 1], o0), P(...O[q + 1], o1), P(...O[q], o1), [u(q), 0], [u(q + 1), 0], [u(q + 1), 1], [u(q), 1], [out[0] - m2[0], out[1] - m2[1], out[2] - m2[2]], shade(col, k * 0.85));
      }
    }
  }
  return O;
}
const S = 4;                         // samples across a cell, where a vault curves
// an upright box with world-space UVs, turned to angle a
function boxUV(G, x, z, y0, y1, sx, sz, a, col, top = col){
  const c = Math.cos(a), s = Math.sin(a), P = (u, v, y) => [x + c * u - s * v, y, z + s * u + c * v], hx = sx / 2, hz = sz / 2;
  for (const [u0, v0, u1, v1, ox, oz, L] of [[-hx, -hz, hx, -hz, 0, -1, sx], [hx, -hz, hx, hz, 1, 0, sz], [hx, hz, -hx, hz, 0, 1, sx], [-hx, hz, -hx, -hz, -1, 0, sz]])
    G.quad(P(u0, v0, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v0, y1), [0, y0 / TILE], [L / TILE, y0 / TILE], [L / TILE, y1 / TILE], [0, y1 / TILE], [c * ox - s * oz, 0, s * ox + c * oz], col);
  G.quad(P(-hx, -hz, y1), P(hx, -hz, y1), P(hx, hz, y1), P(-hx, hz, y1), [0, 0], [sx / TILE, 0], [sx / TILE, sz / TILE], [0, sz / TILE], [0, 1, 0], top);
}

function cryptView(L, scene, mats){
  const M = mats.crypt, W = L.W, Rg = L.regions;
  const hash = (i, j, s) => { let n = (i * 73856093 ^ j * 19349663 ^ s * 83492791) >>> 0; n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0; return (n >>> 8) / 16777216; };
  const open = (i, j) => i >= 0 && j >= 0 && i < W && j < L.H && L.open[j * W + i] === 1;
  const ceilK = (k, x, z) => { const a = L.reg[k], b = L.reg2[k], c = L.regionCeil(Rg[a], x, z); return b >= 0 ? Math.max(c, L.regionCeil(Rg[b], x, z)) : c; };
  const floorK = (k, x, z) => L.regionFloor(Rg[L.reg[k]], x, z);
  // how many facets a cell's ceiling has along an edge running in x (horiz) or z, as drawn below;
  // and the drawn ceiling's height at t along that edge: the chord between its facets' corners
  const cellSteps = (k, horiz) => { const R = Rg[L.reg[k]], two = L.reg2[k] >= 0; return R.type === 'vault' || R.type === 'shaped' ? 3 : two || R.axis === (horiz ? 'z' : 'x') ? S : 1; };
  const drawnCeil = (k, horiz, t, x, z) => {
    const n = cellSteps(k, horiz), d = CELL / n, q = Math.min(n - 1, Math.floor(t / d + 1e-9)), f = (t - q * d) / d;
    const t0 = q * d, dx = horiz ? 1 : 0, dz = horiz ? 0 : 1, ox = x - dx * t, oz = z - dz * t;
    if (f < 1e-9) return ceilK(k, x, z);
    return ceilK(k, ox + dx * t0, oz + dz * t0) * (1 - f) + ceilK(k, ox + dx * (t0 + d), oz + dz * (t0 + d)) * f;
  };
  // a vault's arc length across from its crown, so the texture runs round it evenly
  const arcCache = new Map();
  const arc = (R, d) => {
    const key = Rg.indexOf(R) + ':' + d.toFixed(2);
    if (arcCache.has(key)) return arcCache.get(key);
    const prof = q => R.type === 'room' ? R.rise * Math.sqrt(Math.max(0, 1 - (q / R.hs) ** 2)) : Math.sqrt(Math.max(0, R.rad * R.rad - q * q));
    let s = 0; const n = 16, sg = Math.sign(d), ad = Math.abs(d);
    for (let q = 0; q < n; q++){ const a = ad * q / n, b = ad * (q + 1) / n; s += Math.hypot(b - a, prof(b) - prof(a)); }
    arcCache.set(key, s * sg); return s * sg;
  };
  // ---- pavements laid to the room (floors 4-6) ----
  // A paved room's floor is a field inside bands, as real pavements were laid: a border
  // along its walls and doorways (and where it meets the next room, as nave meets aisle),
  // a narrower band down every bay line, and a piece where two bands meet: a corner
  // motif at the walls, a knot where bay lines cross. Each cell is cut into up to nine
  // pieces for it. The field's panels fit the bays (paveFit), so they line up with the
  // piers and the vault overhead.
  const BW = 0.7, BB = 0.45, CERAMIC = new Set(['encausticA', 'encausticB', 'cistercian']);
  const PW = k => M.pave[k].userData.world, fits = new Map();
  // the field's module, u along the room's axis and v across: whole bays, or bays
  // halved, as near the pavement's own size and as near square as they'll come
  const paveFit = (R, pv) => {
    const key = Rg.indexOf(R) + ':' + pv;
    if (fits.has(key)) return fits.get(key);
    const ax = R.axis === 'x', world = PW(pv);
    let u0, u1, v0, v1, bu, bv;
    if (R.type === 'vault'){ u0 = R.u0; u1 = R.u1; v0 = R.v0; v1 = R.v1; bu = R.bayU; bv = R.bayV; }
    else {
      const xa = L.x0 + R.i * CELL, xb = xa + R.w * CELL, za = L.z0 + R.j * CELL, zb = za + R.h * CELL;
      [u0, u1, v0, v1] = ax ? [xa, xb, za, zb] : [za, zb, xa, xb]; bu = u1 - u0; bv = v1 - v0;
    }
    const opts = (b, len) => { const nb = Math.max(1, Math.round(len / b)), o = []; for (let m = 1; m <= nb; m++) if (nb % m === 0) o.push(b * m); for (let n = 2; n <= 4; n++) o.push(b / n); return o; };
    let best = null;
    for (const mu of opts(bu, u1 - u0)) for (const mv of opts(bv, v1 - v0)){
      const sc = Math.abs(Math.log(mu / world)) + Math.abs(Math.log(mv / world)) + 2 * Math.abs(Math.log(mu / mv));
      if (!best || sc < best.sc) best = { sc, mu, mv };
    }
    const f = { ax, u0, v0, mu: best.mu, mv: best.mv };
    fits.set(key, f); return f;
  };
  // texture v runs along the axis, so a chain of roundels runs down the room
  const fieldUV = (R, pv) => { const f = paveFit(R, pv), sc = PW(pv) / TILE;
    return (x, z) => { const u = f.ax ? x : z, v = f.ax ? z : x; return [(v - f.v0) / f.mv * sc, (u - f.u0) / f.mu * sc]; }; };
  // what lies beyond a cell's edge: 'wall' (rock, a doorway, another room), 'bay' (a bay line), or nothing.
  // A bay line gets its band only where it's also the edge of a field module, so a band
  // never cuts through a composition; and none crosses a chain of roundels
  const bandOf = (k, R, pv, i, j, di, dj, p) => {
    if (!open(i + di, j + dj) || L.reg[(j + dj) * W + i + di] !== L.reg[k]) return 'wall';
    if (R.type !== 'vault') return null;
    const alongU = (di !== 0) === (R.axis === 'x');
    if (alongU && pv === 'rotae') return null;
    const f = paveFit(R, pv), [o, b, e, m] = alongU ? [R.u0, R.bayU, R.u1, f.mu] : [R.v0, R.bayV, R.v1, f.mv], q = (p - o) / b, qm = (p - o) / m;
    return p > o + 0.01 && p < e - 0.01 && Math.abs(q - Math.round(q)) < 0.01 && Math.abs(qm - Math.round(qm)) < 0.01 ? 'bay' : null;
  };
  const paveCell = (B, R, pv, k, i, j, x0, z0, x1, z1, y) => {
    const tier = CERAMIC.has(pv) ? 'tile' : 'cos', F = fieldUV(R, pv);
    const eL = bandOf(k, R, pv, i, j, -1, 0, x0), eR = bandOf(k, R, pv, i, j, 1, 0, x1), eB = bandOf(k, R, pv, i, j, 0, -1, z0), eT = bandOf(k, R, pv, i, j, 0, 1, z1);
    const wOf = e => e === 'wall' ? BW : e === 'bay' ? BB : 0;
    // an inside corner: no band on either side here, but the cell across the corner is beyond the room
    const diag = (di, dj) => !open(i + di, j + dj) || L.reg[(j + dj) * W + i + di] !== L.reg[k];
    const cc = { LB: !eL && !eB && diag(-1, -1), RB: !eR && !eB && diag(1, -1), LT: !eL && !eT && diag(-1, 1), RT: !eR && !eT && diag(1, 1) };
    const wl = wOf(eL) || (cc.LB || cc.LT ? BW : 0), wr = wOf(eR) || (cc.RB || cc.RT ? BW : 0), wb = wOf(eB) || (cc.LB || cc.RB ? BW : 0), wt = wOf(eT) || (cc.LT || cc.RT ? BW : 0);
    const xs = [x0, x0 + wl, x1 - wr, x1], zs = [z0, z0 + wb, z1 - wt, z1];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++){
      const xa = xs[a], xb = xs[a + 1], za = zs[b], zb = zs[b + 1];
      if (xb - xa < 1e-4 || zb - za < 1e-4) continue;
      const ex = a === 0 ? eL : a === 2 ? eR : null, ez = b === 0 ? eB : b === 2 ? eT : null, lx = a === 0 ? x0 : x1, lz = b === 0 ? z0 : z1;
      let key, uv;
      // a band runs along the line x = lx (vert) or z = lz: along it, and out from it
      const strip = (e, vert) => {
        key = tier + (e === 'bay' ? 'Line' : 'Wall');
        const sc = PW(key) / TILE, wd = vert ? xb - xa : zb - za;
        uv = vert ? (x, z) => [z / PW(key) * sc, Math.abs(x - lx) / wd * sc] : (x, z) => [x / PW(key) * sc, Math.abs(z - lz) / wd * sc];
      };
      const corner = knot => { key = tier + (knot ? 'Knot' : 'Corner'); const sc = PW(key) / TILE, cw = xb - xa, ch = zb - za; uv = (x, z) => [Math.abs(x - lx) / cw * sc, Math.abs(z - lz) / ch * sc]; };
      if (ex && ez){
        // two bands meet: a knot where bay lines cross, a corner piece at the walls, and
        // where a bay line meets a wall the wall's border runs on past it
        if (ex === 'bay' && ez === 'bay') corner(true); else if (ex === 'wall' && ez === 'wall') corner(false); else if (ex === 'wall') strip(ex, true); else strip(ez, false);
      } else if (ex) strip(ex, true);
      else if (ez) strip(ez, false);
      else if (a !== 1 && b !== 1 && cc[(a === 0 ? 'L' : 'R') + (b === 0 ? 'B' : 'T')]) corner(false);
      else { key = pv; uv = F; }
      B('floor:pave:' + key).quad([xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], uv(xa, za), uv(xb, za), uv(xb, zb), uv(xa, zb), [0, 1, 0], [1, 1, 1]);
    }
  };
  const CH = 16;
  for (let J = 0; J < L.H; J += CH) for (let I = 0; I < W; I += CH){
    // one geometry per material: floors (flags, or rock where it's cut), walls by finish, vaults
    const bucket = {}, B = key => bucket[key] || (bucket[key] = new Geo());
    for (let j = J; j < Math.min(L.H, J + CH); j++) for (let i = I; i < Math.min(W, I + CH); i++){
      if (!open(i, j)) continue;
      const k = j * W + i, R = Rg[L.reg[k]], two = L.reg2[k] >= 0, cut = R.finish === 'hewn', uo = R.uo || 0;
      const big = R.type === 'vault' || R.type === 'shaped' || R.type === 'room';
      const pv = R.type === 'stair' && !R.palace ? null : pavingOf(R, L.reg[k], big, L.style?.salt || 0), gF = B(pv ? 'floor:pave:' + pv : R.type === 'stair' || R.fl < 3 ? (cut && R.type !== 'room' ? 'floor:hewn' : 'floor') : cut ? 'floor:hewn' : 'floor'), gW = B('wall:' + R.finish), gC = B(R.fresco ? 'ceil:fresco:' + R.fresco : cut ? 'ceil:hewn' : 'ceil');
      const x0 = L.x0 + i * CELL, z0 = L.z0 + j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const tone = 0.82 + hash(i, j, 3) * 0.22, col = [tone, tone, tone * 0.97];
      // the floor: flat, or treads down a stair with a riser at each
      if (R.type === 'stair'){
        const ax = R.axis === 'x';
        for (let q = 0; q < 2; q++){
          const p0 = (ax ? x0 : z0) + q * CELL / 2, p1 = p0 + CELL / 2, mid = (p0 + p1) / 2;
          const yy = p => L.regionFloor(R, ...(ax ? [p, z0] : [x0, p]));
          const y = yy(mid);
          const Q = (p, a) => ax ? [p, y, a] : [a, y, p];
          const a0 = ax ? z0 : x0, a1 = ax ? z1 : x1;
          gF.quad(Q(p0, a0), Q(p1, a0), Q(p1, a1), Q(p0, a1), [p0 / TILE, a0 / TILE], [p1 / TILE, a0 / TILE], [p1 / TILE, a1 / TILE], [p0 / TILE, a1 / TILE], [0, 1, 0], col);
          const yb = yy(p0 - CELL / 4);
          if (Math.abs(yb - y) > 0.02){
            const lo = Math.min(y, yb), hi = Math.max(y, yb), dir = y < yb ? 1 : -1;   // the riser faces the lower tread
            const V = (a, h) => ax ? [p0, h, a] : [a, h, p0];
            gF.quad(V(a0, lo), V(a1, lo), V(a1, hi), V(a0, hi), [a0 / TILE, lo / TILE], [a1 / TILE, lo / TILE], [a1 / TILE, hi / TILE], [a0 / TILE, hi / TILE], ax ? [dir, 0, 0] : [0, 0, dir], shade(col, 0.85));
          }
        }
      } else {
        const y = R.y;
        // a paved room is laid to its walls and bays (paveCell); a round one keeps its composition
        // centred on it, and anything else is laid in world space
        if (pv && big && R.type !== 'shaped') paveCell(B, R, pv, k, i, j, x0, z0, x1, z1, y);
        else {
          let fu = (x, z) => [x / TILE, z / TILE];
          if (pv && big && R.cx !== undefined){
            const half = M.pave[pv].map.repeat.x > 0 ? 0.5 / M.pave[pv].map.repeat.x : 0, along = pv === 'rotae' && R.axis === 'x';
            fu = along ? (x, z) => [(z - R.cz) / TILE + half, (x - R.cx) / TILE + half] : (x, z) => [(x - R.cx) / TILE + half, (z - R.cz) / TILE + half];
          }
          gF.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], fu(x0, z0), fu(x1, z0), fu(x1, z1), fu(x0, z1), [0, 1, 0], pv ? [1, 1, 1] : col);
        }
      }
      // the vault: sampled across its curve (both ways where two passages cross)
      const vlt = R.type === 'vault' || R.type === 'shaped', nx = vlt ? 3 : two || R.axis === 'z' ? S : 1, nz = vlt ? 3 : two || R.axis === 'x' ? S : 1;
      const uv = (x, z, y) => {
        if (two) return [(x + uo) / TILE, z / TILE];
        const along = R.axis === 'x' ? x : z, across = R.axis === 'x' ? z : x;
        return [(along + uo) / TILE, (R.c + arc(R, across - R.c)) / TILE];
      };
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++){
        const xa = x0 + a * CELL / nx, xb = x0 + (a + 1) * CELL / nx, za = z0 + b * CELL / nz, zb = z0 + (b + 1) * CELL / nz;
        const P = (x, z) => [x, ceilK(k, x, z), z];
        const pa = P(xa, za), pb = P(xb, za), pc = P(xb, zb), pd = P(xa, zb);
        if (vlt){
          // a groin vault curves both ways: project the texture along whichever way this facet faces
          const ex = (pb[1] - pa[1]) / (xb - xa), ez = (pd[1] - pa[1]) / (zb - za);
          const pr = Math.abs(ex) < 0.6 && Math.abs(ez) < 0.6 ? q => [(q[0] + uo) / TILE, q[2] / TILE] : Math.abs(ex) > Math.abs(ez) ? q => [q[2] / TILE, q[1] / TILE] : q => [(q[0] + uo) / TILE, q[1] / TILE];
          gC.quad(pa, pb, pc, pd, pr(pa), pr(pb), pr(pc), pr(pd), [0, -1, 0], shade(col, 0.9));
        } else
        gC.quad(pa, pb, pc, pd, uv(...[pa[0], pa[2]]), uv(pb[0], pb[2]), uv(pc[0], pc[2]), uv(pd[0], pd[2]), [0, -1, 0], shade(col, 0.9));
      }
      // edges: a wall where rock is behind; where the next cell's vault or floor
      // stands at another height, the face between (the wall over a doorway, cut
      // to the passage's arch, is one of these). Their tops follow each cell's
      // ceiling as it's drawn (its facets' chords, not the true curve), so they
      // meet it without a crack where a vault is steep and sampled coarsely.
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const ex0 = di > 0 ? x1 : x0, ez0 = dj > 0 ? z1 : z0, horiz = dj !== 0;
        const at = t => horiz ? [x0 + t, ez0] : [ex0, z0 + t];                 // t along the edge, 0..CELL
        const nb = open(i + di, j + dj) ? (j + dj) * W + i + di : -1;
        const inward = [-di, 0, -dj];
        // a shaped room's wall is drawn along its true outline (below); but where a cell
        // edge lies wholly outside that outline, it gets its wall too: hidden behind the
        // curve, except beside a doorway, where it closes the corner the outline leaves open
        if (nb < 0 && R.type === 'shaped' && [0, 0.5, 1].some(f => R.shape.inside(...at(f * CELL), 0))) continue;
        if (nb >= 0 && !(di > 0 || dj > 0)) continue;     // each shared edge once
        const mineN = cellSteps(k, horiz), ts = new Set();
        for (let q = 0; q <= mineN; q++) ts.add(q * CELL / mineN);
        if (nb >= 0){ const n2 = cellSteps(nb, horiz); for (let q = 0; q <= n2; q++) ts.add(q * CELL / n2); }
        const T = [...ts].sort((p, q) => p - q);
        for (let q = 0; q + 1 < T.length; q++){
          const [ax, az] = at(T[q]), [bx, bz] = at(T[q + 1]), ua = ((horiz ? ax : az) + uo) / TILE, ub = ((horiz ? bx : bz) + uo) / TILE;
          if (nb < 0){
            const fa = floorK(k, ax, az) - 0.6, fb = floorK(k, bx, bz) - 0.6, ta = drawnCeil(k, horiz, T[q], ax, az) + 0.02, tb = drawnCeil(k, horiz, T[q + 1], bx, bz) + 0.02;
            gW.quad([ax, fa, az], [bx, fb, bz], [bx, tb, bz], [ax, ta, az], [ua, fa / TILE], [ub, fb / TILE], [ub, tb / TILE], [ua, ta / TILE], inward, col);
            continue;
          }
          const ca = drawnCeil(k, horiz, T[q], ax, az), cb = drawnCeil(k, horiz, T[q + 1], bx, bz), na = drawnCeil(nb, horiz, T[q], ax, az), nbb = drawnCeil(nb, horiz, T[q + 1], bx, bz);
          if (Math.abs(ca - na) <= 0.03 && Math.abs(cb - nbb) <= 0.03) continue;
          // the face is masonry above the LOWER vault, seen from the side that is open
          // that high: it looks into the cell whose vault is the higher (the wall over a
          // doorway faces the room, the wall over an arcade faces the nave). Where the
          // two vaults cross along the edge, it's two faces, split where they cross,
          // each facing its own way.
          const face = (px, pz, qx, qz, c0, c1, n0, n1) => {
            const mine = c0 + c1 > n0 + n1, lo = [Math.min(c0, n0), Math.min(c1, n1)], hi = [Math.max(c0, n0), Math.max(c1, n1)];
            const u0 = ((horiz ? px : pz) + uo) / TILE, u1 = ((horiz ? qx : qz) + uo) / TILE;
            gW.quad([px, lo[0], pz], [qx, lo[1], qz], [qx, hi[1], qz], [px, hi[0], pz], [u0, lo[0] / TILE], [u1, lo[1] / TILE], [u1, hi[1] / TILE], [u0, hi[0] / TILE], mine ? inward : [di, 0, dj], col);
          };
          const da = ca - na, db = cb - nbb;
          if (da * db < 0){
            const f = da / (da - db), mx = ax + (bx - ax) * f, mz = az + (bz - az) * f, my = ca + (cb - ca) * f;
            face(ax, az, mx, mz, ca, my, na, my); face(mx, mz, bx, bz, my, cb, my, nbb);
          } else face(ax, az, bx, bz, ca, cb, na, nbb);
        }
      }
    }
    const matOf = key => key === 'floor' ? M.floor : key === 'floor:hewn' ? M.hewnFloor : key.startsWith('floor:pave:') ? M.pave[key.slice(11)] : key === 'ceil' ? M.ceil : key === 'ceil:hewn' ? M.walls.hewn : key === 'ceil:fresco:mosaic!' && M.ceil.userData.julia ? M.ceil : key.startsWith('ceil:fresco:') ? frescoMat(key.slice(12)) : M.walls[key.slice(5)];   // a palace's gold mosaic vaults are its Julia vault now (palaceMats); its starry ones stay
    for (const key in bucket){ const mesh = bucket[key].mesh(matOf(key)); if (mesh) scene.add(mesh); }
  }
  shapedWalls(L, scene, M);
  reliefs(L, scene, mats);

  const T = new Geo(), V = new Geo();     // trim: jambs, spandrels, coffins; V: the voussoir rings
  const light = 0.98;
  // doorways: a ring of voussoirs round the passage's arch, standing proud of the wall, on half-columns
  const halfCols = [];
  for (const d of L.doorways){
    const ax = d.axis === 'x', o = d.into;          // the room lies toward `o` along the axis
    const P = (off, across, y) => ax ? [d.line + o * off, y, across] : [across, y, d.line + o * off];
    const n = 12, ri = d.rad, dep = 0.16, face = ax ? [o, 0, 0] : [0, 0, o];
    const curve = Array.from({ length: n + 1 }, (_, q) => { const t = Math.PI * (1 - q / n); return [d.c + Math.cos(t) * ri, d.spring + Math.sin(t) * ri]; });
    archBand(V, curve, (a, y, off) => P(off, a, y), 0.55, [{ off: dep, n: face }], [0, dep], [light, light, light * 0.97], true);
    // an engaged half-column either side, under the ring: set into the wall's face
    for (const sd of [-1, 1]){ const [x, , z] = P(0, d.c + sd * (ri + 0.3), 0); halfCols.push({ x, z, y: d.y, h: d.spring - d.y }); }
  }
  // the half-columns, instanced: a base, the shaft, a capital under the arch's springing
  const hcByH = new Map();
  for (const c of halfCols){ const k = c.h.toFixed(2); if (!hcByH.has(k)) hcByH.set(k, []); hcByH.get(k).push(c); }
  for (const list of hcByH.values()){
    const h = list[0].h, parts = [];
    const base = new THREE.CylinderGeometry(0.42, 0.46, 0.3, 12); base.translate(0, 0.05, 0); parts.push(base);
    const shaft = new THREE.CylinderGeometry(0.3, 0.32, h, 12); shaft.translate(0, h / 2, 0); parts.push(shaft);
    const cap = new THREE.CylinderGeometry(0.46, 0.31, 0.32, 12); cap.translate(0, h - 0.16, 0); parts.push(cap);
    const ab = new THREE.BoxGeometry(0.95, 0.12, 0.95); ab.translate(0, h + 0.02, 0); parts.push(ab);
    const geo = mergeGeometries(parts.map(g => { const q = g.toNonIndexed(), u = q.attributes.uv, pz = q.attributes.position; for (let v = 0; v < u.count; v++) u.setXY(v, u.getX(v) * 0.6, pz.getY(v) / TILE); return q; }));
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, M.column, list.length), mx = new THREE.Matrix4();
    list.forEach((c, q) => { mx.makeTranslation(c.x, c.y - 0.05, c.z); inst.setMatrixAt(q, mx); });
    inst.computeBoundingSphere(); scene.add(inst);
  }
  // arcades: round arches from capital to capital, a voussoir ring and the wall above
  for (const A of L.arcades){
    const dx = A.b[0] - A.a[0], dz = A.b[1] - A.a[1], span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span, nx = -uz, nz = ux;
    const mx = (A.a[0] + A.b[0]) / 2, mz = (A.a[1] + A.b[1]) / 2, ri = span / 2 - 0.95, ro = ri + 0.6, top = A.top ?? A.y + ro + 0.55, h = A.depth / 2;   // the arch springs from the abacus's edge
    const P = (u, y, side) => [mx + ux * u + nx * side * h, y, mz + uz * u + nz * side * h];
    const n = 14;
    const curve = Array.from({ length: n + 1 }, (_, q) => { const t = Math.PI * (1 - q / n); return [Math.cos(t) * ri, A.y + Math.sin(t) * ri]; });
    const outer = archBand(V, curve, (u, y, off) => P(u, y, off), ro - ri, [{ off: -1, n: [-nx, 0, -nz] }, { off: 1, n: [nx, 0, nz] }], [-1, 1], [light, light, light * 0.97]);
    for (const side of [-1, 1]){
      const f = [nx * side, 0, nz * side], uvp = ([u, y]) => [(u + mx + mz) / TILE, y / TILE];
      for (let q = 0; q < n; q++)                        // the spandrel, on the ring's back
        T.quad(P(...outer[q], side), P(...outer[q + 1], side), P(outer[q + 1][0], top, side), P(outer[q][0], top, side), uvp(outer[q]), uvp(outer[q + 1]), uvp([outer[q + 1][0], top]), uvp([outer[q][0], top]), f, [0.9, 0.9, 0.88]);
      // over each capital, the pier between the arch's foot and the next
      for (const sg of [-1, 1]){
        const u0 = sg * ro, u1 = sg * span / 2;
        T.quad(P(u0, A.y, side), P(u1, A.y, side), P(u1, top, side), P(u0, top, side), [0, A.y / TILE], [0.2, A.y / TILE], [0.2, top / TILE], [0, top / TILE], f, [0.9, 0.9, 0.88]);
      }
    }
    T.quad(P(-span / 2, top, -1), P(span / 2, top, -1), P(span / 2, top, 1), P(-span / 2, top, 1), [0, 0], [span / TILE, 0], [span / TILE, 0.3], [0, 0.3], [0, 1, 0], [0.8, 0.8, 0.78]);
    // its two ends, over the columns: closed (a row's last arch would show its inside),
    // and a block standing on each capital where two arcades meet at an angle
    for (const sg of [-1, 1]){
      const e = sg * span / 2, out = [ux * sg, 0, uz * sg];
      T.quad(P(e, A.y, -1), P(e, A.y, 1), P(e, top, 1), P(e, top, -1), [0, A.y / TILE], [A.depth / TILE, A.y / TILE], [A.depth / TILE, top / TILE], [0, top / TILE], out, [0.88, 0.88, 0.86]);
      const [bx, , bz] = P(e - sg * 0.45, 0, 0);
      boxUV(T, bx, bz, A.y, top, 0.9, A.depth + 0.12, Math.atan2(uz, ux), [0.9, 0.9, 0.88]);
    }
    // the underside between the arch's foot and the capital's centre
    for (const sg of [-1, 1]){
      const u0 = sg * ri, u1 = sg * span / 2;
      T.quad(P(u0, A.y, -1), P(u1, A.y, -1), P(u1, A.y, 1), P(u0, A.y, 1), [0, 0], [0.2, 0], [0.2, 0.2], [0, 0.2], [0, -1, 0], [0.8, 0.8, 0.78]);
    }
  }
  // stone coffins: a chest and a lid with a chamfered top
  for (const p of L.props) if (p.kind === 'coffin'){
    boxUV(T, p.x, p.z, p.y - 0.2, p.y + p.h - 0.2, 2 * p.hl, 2 * p.hw, p.a, [0.86, 0.84, 0.8]);
    boxUV(T, p.x, p.z, p.y + p.h - 0.2, p.y + p.h, 2 * p.hl + 0.22, 2 * p.hw + 0.22, p.a, [0.95, 0.93, 0.88]);
    boxUV(T, p.x, p.z, p.y + p.h, p.y + p.h + 0.12, 2 * p.hl - 0.2, 2 * p.hw - 0.5, p.a, [0.9, 0.88, 0.84]);
  }
  const tm = T.mesh(M.trim); if (tm) scene.add(tm);
  const vm = V.mesh(M.vous); if (vm) scene.add(vm);

  // round columns: a lathe of base, shaft with a slight swell, capital, and a square abacus
  const byH = new Map();
  const deep = p => { const i = Math.floor((p.x - L.x0) / L.cell), j = Math.floor((p.z - L.z0) / L.cell), R = Rg[L.reg[j * W + i]]; return depthOf(R) >= 4; };
  for (const p of L.props) if (p.kind === 'column'){ const key = p.h + ':' + deep(p); if (!byH.has(key)) byH.set(key, []); byH.get(key).push(p); }
  for (const list of byH.values()){
    const h = list[0].h;
    const r = 0.62, prof = [[0.001, 0], [0.92, 0], [0.92, 0.28], [0.8, 0.36], [0.7, 0.5], [r, 0.62], [r * 1.04, h * 0.45], [r, h - 0.62], [0.68, h - 0.5], [0.86, h - 0.3], [0.9, h - 0.22]];
    const lathe = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 14);
    const uvA = lathe.attributes.uv, pos = lathe.attributes.position;
    for (let v = 0; v < uvA.count; v++) uvA.setXY(v, uvA.getX(v) * (2 * Math.PI * r) / TILE, pos.getY(v) / TILE);
    const abacus = new THREE.BoxGeometry(1.9, 0.24, 1.9); abacus.translate(0, h - 0.1, 0);
    const plinth = new THREE.BoxGeometry(1.95, 0.26, 1.95); plinth.translate(0, 0.08, 0);
    for (const g of [abacus, plinth]){ const u = g.attributes.uv; for (let v = 0; v < u.count; v++) u.setXY(v, u.getX(v) * 0.6, u.getY(v) * 0.1); }
    const geo = mergeGeometries([lathe.toNonIndexed(), abacus.toNonIndexed(), plinth.toNonIndexed()]);
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, deep(list[0]) ? M.verde : M.column, list.length), mx = new THREE.Matrix4();     // marble, on the deepest floors
    list.forEach((p, q) => { mx.makeRotationY(hash(q, 7, 1) * 6.28); mx.setPosition(p.x, p.y - 0.05, p.z); inst.setMatrixAt(q, mx); });
    inst.computeBoundingSphere();
    scene.add(inst);
  }

  // torches on the walls: an iron bracket and a pitch-wrapped head; lit ones get
  // a flame, and lend themselves one of a few lights (a fixed pool, so the
  // scene's light count never changes and nothing recompiles)
  const I = new Geo();
  for (const sc of L.sconces){
    if (sc.kind === 'brazier'){
      // a standing brazier: three iron legs, a bowl, coals; a big fire when lit
      for (let q = 0; q < 3; q++){ const a = q / 3 * Math.PI * 2; boxUV(I, sc.x + Math.cos(a) * 0.35, sc.z + Math.sin(a) * 0.35, sc.y - 0.1, sc.y + 1.0, 0.08, 0.08, a, [0.16, 0.15, 0.14]); }
      boxUV(I, sc.x, sc.z, sc.y + 0.95, sc.y + 1.25, 1.0, 1.0, Math.PI / 4, [0.18, 0.17, 0.16]);
      boxUV(I, sc.x, sc.z, sc.y + 1.25, sc.y + 1.32, 0.8, 0.8, 0, [0.1, 0.08, 0.07]);
      const fl = new THREE.Sprite(mats.flame); fl.scale.set(0.9, 1.4, 1); fl.position.set(sc.x, sc.y + 1.95, sc.z); fl.visible = sc.lit;
      const ha = new THREE.Sprite(mats.halo); ha.scale.set(5, 5, 1); ha.position.set(sc.x, sc.y + 1.8, sc.z); ha.visible = sc.lit;
      scene.add(fl, ha); sc.view = { fls: [[fl, 0.9, 1.4]], ha, ph: hash(sc.x | 0, sc.z | 0, 5) * 10 };
      continue;
    }
    if (sc.kind === 'candles' || sc.kind === 'altarCandle'){
      // an iron stand with five candles on prickets along its bar, or one candle on an altar
      const fls = [], ph = hash(sc.x | 0, sc.z | 0, 5) * 10, c = Math.cos(sc.face + Math.PI / 2), sn = Math.sin(sc.face + Math.PI / 2);
      let tips;
      if (sc.kind === 'candles'){
        for (let q = 0; q < 3; q++){ const a = q / 3 * Math.PI * 2; boxUV(I, sc.x + Math.cos(a) * 0.22, sc.z + Math.sin(a) * 0.22, sc.y - 0.05, sc.y + 0.3, 0.05, 0.05, a, [0.16, 0.15, 0.14]); }
        boxUV(I, sc.x, sc.z, sc.y, sc.y + 1.3, 0.07, 0.07, sc.face, [0.17, 0.16, 0.15]);
        boxUV(I, sc.x, sc.z, sc.y + 1.26, sc.y + 1.31, 0.05, 1.05, sc.face, [0.18, 0.17, 0.16]);
        tips = [-0.48, -0.24, 0, 0.24, 0.48].map(d => [sc.x + c * d, sc.y + 1.31, sc.z + sn * d]);
      } else tips = [[sc.x, sc.y, sc.z]];
      for (const [x, y, z] of tips){
        boxUV(I, x, z, y, y + 0.2, 0.075, 0.075, 0, [0.86, 0.8, 0.66]);                                        // the candle, tallow
        const f = new THREE.Sprite(mats.flame); f.scale.set(0.09, 0.17, 1); f.position.set(x, y + 0.29, z); f.visible = sc.lit; scene.add(f); fls.push([f, 0.09, 0.17]);
      }
      const ha = new THREE.Sprite(mats.halo); ha.scale.set(sc.kind === 'candles' ? 1.7 : 0.7, sc.kind === 'candles' ? 1.1 : 0.7, 1); ha.position.set(sc.x, tips[0][1] + 0.3, sc.z); ha.visible = sc.lit;
      scene.add(ha); sc.view = { fls, ha, ph };
      continue;
    }
    const fx = Math.cos(sc.face), fz = Math.sin(sc.face), wx = sc.x - fx * 0.22, wz = sc.z - fz * 0.22;
    boxUV(I, wx, wz, sc.y - 0.35, sc.y - 0.05, 0.12, 0.3, sc.face, [0.16, 0.15, 0.14]);                       // the wall plate
    boxUV(I, sc.x - fx * 0.11, sc.z - fz * 0.11, sc.y - 0.2, sc.y - 0.12, 0.26, 0.07, sc.face, [0.18, 0.17, 0.16]);   // the arm
    boxUV(I, sc.x, sc.z, sc.y - 0.24, sc.y, 0.16, 0.16, sc.face, [0.2, 0.19, 0.18]);                          // the cup
    boxUV(I, sc.x, sc.z, sc.y - 0.1, sc.y + 0.42, 0.07, 0.07, sc.face, [0.36, 0.26, 0.17]);                  // the stick
    boxUV(I, sc.x, sc.z, sc.y + 0.3, sc.y + 0.55, 0.14, 0.14, sc.face, [0.12, 0.1, 0.08]);                    // the head, pitch and tow
    const fl = new THREE.Sprite(mats.flame); fl.scale.set(0.32, 0.62, 1); fl.position.set(sc.x, sc.y + 0.78, sc.z); fl.visible = sc.lit;
    const ha = new THREE.Sprite(mats.halo); ha.scale.set(1.6, 1.6, 1); ha.position.set(sc.x, sc.y + 0.72, sc.z); ha.visible = sc.lit;
    scene.add(fl, ha); sc.view = { fls: [[fl, 0.32, 0.62]], ha, ph: hash(sc.x | 0, sc.z | 0, 5) * 10 };
  }
  const im = I.mesh(mats.iron); if (im) scene.add(im);
  const POOL = L.site === 'palace' ? 0 : 5, pool = [];        // (a palace has no torches: gen/faerie.js)
  for (let q = 0; q < POOL; q++){ const l = new THREE.PointLight(0xff9a48, 0, 18, 1.4); scene.add(l); pool.push(l); }

  // tapestries
  for (const t of L.tapestries) hangTapestry(scene, L.site === 'palace' ? { ...t, pristine: true } : t, mats);
  ribsAndPiers(L, scene, mats);

  return {
    update(dt, camera, time){
      const cx = camera.position.x, cz = camera.position.z;
      const near = s => Math.hypot(s.x - cx, s.z - cz) - (s.kind === 'brazier' ? 25 : 0);   // a brazier counts as nearer: it lights so much more
      const lit = L.sconces.filter(s => s.lit).sort((a, b) => near(a) - near(b));
      pool.forEach((l, q) => {
        const sc = lit[q];
        if (!sc || Math.hypot(sc.x - cx, sc.z - cz) > 60){ l.intensity = 0; return; }
        const f = 0.85 + 0.1 * Math.sin(time * 9 + sc.view.ph) + 0.05 * Math.sin(time * 21 + sc.view.ph * 2), big = sc.kind === 'brazier';
        if (big){ l.position.set(sc.x, sc.y + 2.2, sc.z); l.intensity = 9 * f; l.distance = 48; l.decay = 1.1; }   // a brazier lights a bay up into its vault
        else if (sc.kind === 'candles'){ l.position.set(sc.x, sc.y + 1.7, sc.z); l.intensity = 2.4 * f; l.distance = 13; l.decay = 1.4; l.color.setHex(0xffc27a); }
        else if (sc.kind === 'altarCandle'){ l.position.set(sc.x, sc.y + 0.4, sc.z); l.intensity = 0.9 * f; l.distance = 7; l.decay = 1.5; l.color.setHex(0xffc27a); }
        else { l.position.set(sc.x + Math.cos(sc.face) * 0.3, sc.y + 0.8, sc.z + Math.sin(sc.face) * 0.3); l.intensity = 3.2 * f; l.distance = 18; l.decay = 1.4; }
        if (sc.kind !== 'candles' && sc.kind !== 'altarCandle') l.color.setHex(0xff9a48);
      });
      for (const sc of L.sconces){
        const v = sc.view; v.ha.visible = sc.lit;
        v.fls.forEach(([fl, w, h], q) => {
          fl.visible = sc.lit;
          if (sc.lit){ const f = 0.9 + 0.12 * Math.sin(time * 13 + v.ph + q) * Math.sin(time * 7.3 + v.ph); fl.scale.set(w * (0.95 + 0.1 * Math.sin(time * 17 + v.ph + q * 2)), h * f, 1); }
        });
      }
    },
  };
}

// ---- books -----------------------------------------------------------------------------
// The shelves (gen/under.js shelves()): an oak case against the wall, four boards. Whole
// ('book'): rows of books in old dyed leather, one of them sound; 'ruined': a few left,
// slumped and grey with mould; 'rotted': the case fallen in, boards down, no books.
function bookshelves(L, scene, mats){
  const G = new Geo(), oak = [0.42, 0.3, 0.2], dark = [0.3, 0.22, 0.15];
  const DYES = [[0.5, 0.18, 0.14], [0.22, 0.28, 0.42], [0.45, 0.36, 0.2], [0.24, 0.34, 0.22], [0.52, 0.44, 0.34], [0.32, 0.2, 0.26]];
  for (const sh of L.shelves){
    const r = mulberry32(sh.seed), nx = Math.cos(sh.face), nz = Math.sin(sh.face), tx = -nz, tz = nx, a = Math.atan2(tz, tx);
    // a point `u` along the wall, `v` out from the back
    const P = (u, v) => [sh.x + tx * u + nx * (v - sh.d / 2), sh.z + tz * u + nz * (v - sh.d / 2)];
    const box = (u, v, y0, y1, su, sv, col, tilt = 0) => { const [x, z] = P(u, v); G.box(x, z, sh.y + y0, sh.y + y1, su, sv, a + tilt, col); };
    const rot = sh.state === 'rotted', H = sh.h, boards = rot ? [0.08, 0.7] : [0.08, 0.6, 1.12, 1.64];
    box(-sh.w / 2 + 0.04, sh.d / 2, 0, H, 0.08, sh.d, oak); box(sh.w / 2 - 0.04, sh.d / 2, 0, rot ? H * 0.7 : H, 0.08, sh.d, oak);   // the sides (a rotted one's half fallen)
    box(0, 0.03, 0, H, sh.w, 0.04, dark);                                                                                     // the back
    if (!rot) box(0, sh.d / 2, H - 0.06, H, sh.w + 0.08, sh.d + 0.04, oak);                                                 // the top
    for (const y of boards) box(0, sh.d / 2, y - 0.03, y, sh.w - 0.16, sh.d - 0.04, oak);
    if (rot){                                                                                                                // boards down on the floor, a tumble of pulp
      for (let q = 0; q < 3; q++) box((r() - 0.5) * 1.4, sh.d + 0.3 + r() * 0.4, 0, 0.04, 1.4 + r() * 0.5, 0.25, dark, (r() - 0.5) * 0.6);
      for (let q = 0; q < 4; q++) box((r() - 0.5) * 1.6, sh.d * 0.5 + r() * 0.5, 0, 0.06 + r() * 0.06, 0.22, 0.3, [0.3, 0.3, 0.26], r() * 3);
      continue;
    }
    // the books on each board: upright, leaning, or gone
    const full = sh.state === 'book' ? 0.85 : 0.3;
    for (const y of boards){
      if (y > H - 0.3) continue;
      for (let u = -sh.w / 2 + 0.12; u < sh.w / 2 - 0.12;){
        const bw = 0.05 + r() * 0.07, bh = 0.32 + r() * 0.16;
        if (r() < full){
          const k = sh.state === 'book' ? 0.8 + r() * 0.4 : 0.55, dye = DYES[(r() * DYES.length) | 0], col = sh.state === 'book' ? dye.map(c => c * k) : dye.map(c => (c * 0.4 + 0.3) * k);
          const lean = sh.state === 'ruined' ? (r() - 0.5) * 0.5 : (r() < 0.1 ? 0.25 : 0);
          box(u + bw / 2, 0.08 + sh.d * 0.35, y, y + bh * (sh.state === 'ruined' ? 0.8 : 1), bw, sh.d * 0.6, col, lean);
        }
        u += bw + 0.005;
      }
    }
  }
  const m = G.mesh(mats.plain); if (m) scene.add(m);
}

// ---- the deep: dripstone and the glow's light ---------------------------------------
// Stalagmites, stalactites and columns (gen/under.js dripstone()), as rough tapered
// cones in pale calcite: a stalagmite thick at its foot, a stalactite hanging to a point,
// a column waisted where the two grew together.
function dripstone(L, scene, mats){
  const G = new Geo(), SIDES = 7;
  const cone = (x, z, y0, y1, prof, r, seed, col) => {
    // prof(t): radius at t (0 at y0, 1 at y1) as a fraction of r; bumps per ring so it isn't a lathe
    const rings = 5, rnd = mulberry32(seed), ph = rnd() * 6.28, jit = Array.from({ length: (rings + 1) * SIDES }, () => 0.85 + rnd() * 0.3);
    const P = (q, k) => { const t = q / rings, a = ph + k / SIDES * Math.PI * 2, rr = Math.max(0.015, r * prof(t) * jit[q * SIDES + (k % SIDES)]); return [x + Math.cos(a) * rr, y0 + (y1 - y0) * t, z + Math.sin(a) * rr]; };
    for (let q = 0; q < rings; q++) for (let k = 0; k < SIDES; k++){
      const a = P(q, k), b = P(q, k + 1), c = P(q + 1, k + 1), d = P(q + 1, k), m = (k + 0.5) / SIDES * Math.PI * 2 + ph;
      const u0 = k / SIDES * r * 6.28 / TILE, u1 = (k + 1) / SIDES * r * 6.28 / TILE;
      G.quad(a, b, c, d, [u0, a[1] / TILE], [u1, b[1] / TILE], [u1, c[1] / TILE], [u0, d[1] / TILE], [Math.cos(m), 0, Math.sin(m)], col);
    }
  };
  for (const d of L.drips){
    const k = 0.95 + ((d.x * 7.1 + d.z * 3.3) % 1 + 1) % 1 * 0.2, col = [k * 1.25, k * 1.18, k * 1.02], seed = (d.x * 131 + d.z * 71) | 0;
    if (d.column) cone(d.x, d.z, d.fy - 0.3, d.cy + 0.3, t => 1 - 0.45 * Math.sin(Math.PI * t), d.rm, seed, col);
    else {
      if (d.hm > 0) cone(d.x, d.z, d.fy - 0.3, d.fy + d.hm, t => (1 - t) ** 0.8, d.rm, seed, col);
      if (d.lt > 0) cone(d.x, d.z, d.cy + 0.3, d.cy - d.lt, t => (1 - t) ** 0.9, d.rt, seed + 1, col);
    }
  }
  const m = G.mesh(mats.drip); if (m) scene.add(m);
}
// The foxfire' light: what shines of itself (ingredients.js virtue 'shine') really lights
// the rock round it. A few blue-green lights, a fixed set so the shaders don't change, go
// each moment to the caps nearest you, brighter for a bigger clump; a cap taken goes dark.
// (The wall glow, L.glow, is no longer drawn: only where the caps grow.)
function glowLights(L, scene){
  const caps = L.finds.filter(f => ingredient(f.kind)?.virtues?.includes('shine'))
    .map(f => ({ f, x: f.x, y: (f.y ?? L.floorAt(f.x, f.z)) + 0.5, z: f.z, ph: (f.x * 0.37 + f.z * 0.11) % 6.28 }));
  const N = Math.min(6, caps.length), lights = [];
  for (let q = 0; q < N; q++){ const l = new THREE.PointLight(GLOW, 0, 12, 1.6); scene.add(l); lights.push(l); }
  return {
    update(camera, t){
      if (!N) return;
      const cx = camera.position.x, cz = camera.position.z;
      const near = caps.filter(c => !c.f.taken && Math.abs(c.x - cx) < 45 && Math.abs(c.z - cz) < 45).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      lights.forEach((l, q) => {
        const c = near[q];
        if (!c){ l.intensity = 0; return; }
        l.position.set(c.x, c.y, c.z);
        l.distance = 9 + 2 * c.f.n;
        l.intensity = (1 + 0.4 * c.f.n) * (0.9 + 0.1 * Math.sin(t * 0.7 + c.ph));   // a slow breath, not a flicker
      });
    },
  };
}

// ---- tapestries ----------------------------------------------------------------------
// Old and torn: the picture (a dithered tapestry, or a Wagara figure in historic
// dyes) faded and grimed, stained by a tide line of damp, its hem ragged, eaten
// by moths and torn up from the bottom, scorched round the holes. PBR: the cloth
// is a standard material with a woven normal map and a roughness map, and gold
// thread (the asanoha's orphare) is metal where the figure runs.
const TAP_CACHE = new Map();
function loadImage(name){
  if (!TAP_CACHE.has(name)) TAP_CACHE.set(name, new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = `textures/under/${name}.png`; }));
  return TAP_CACHE.get(name);
}
function hangTapestry(scene, t, mats){
  const geo = new THREE.PlaneGeometry(t.w, t.h, 16, 10), pos = geo.attributes.position, r = mulberry32(t.seed), ph = r() * 6.3, fold = 1.6 + r() * 0.8;
  for (let v = 0; v < pos.count; v++){
    const x = pos.getX(v), y = pos.getY(v), low = (t.h / 2 - y) / t.h;         // folds fall loose toward the hem
    pos.setZ(v, 0.05 + (0.09 * Math.sin(x * fold + ph) + 0.04 * Math.sin(x * fold * 2.3 + ph * 2)) * (0.3 + 0.7 * low));
  }
  geo.computeVertexNormals();
  const weave = mats.weave.clone(); weave.needsUpdate = true; weave.repeat.set(t.w * 7, t.h * 7);
  const mat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0, normalMap: weave, normalScale: new THREE.Vector2(0.6, 0.6), side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  mat.userData.own = true;                                  // this view's own: dispose() frees it and its maps
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(t.x, t.top - t.h / 2, t.z);
  mesh.rotation.y = Math.PI / 2 - t.face;
  mesh.visible = false; mesh.userData.pending = true;      // until the cloth is made
  scene.add(mesh);
  // the rod it hangs from, on two hooks
  const rod = new THREE.Mesh(new THREE.BoxGeometry(t.w + 0.4, 0.07, 0.07), mats.dark);
  rod.position.set(t.x + Math.cos(t.face) * 0.1, t.top + 0.04, t.z + Math.sin(t.face) * 0.1); rod.rotation.y = Math.PI / 2 - t.face;
  scene.add(rod);
  loadImage(t.tex).then(img => {
    const { map, orm, gold } = ageCloth(img, t, r);
    mat.map = map; mat.roughnessMap = orm; if (gold){ mat.metalnessMap = orm; mat.metalness = 1; }
    mat.color.set(0xffffff); mat.needsUpdate = true; mesh.visible = true; mesh.userData.pending = false;
  }).catch(() => { mesh.visible = false; });
}
function ageCloth(img, t, r){
  // crop the picture to the cloth's shape, about its middle
  const aspect = t.w / t.h, iw = img.width, ih = img.height;
  let cw = iw, ch = Math.round(iw / aspect);
  if (ch > ih){ ch = ih; cw = Math.round(ih * aspect); }
  const W = cw, H = ch, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, 0, 0, W, H);
  const im = g.getImageData(0, 0, W, H), d = im.data;
  const wagara = t.tex.startsWith('wagara'), goldHex = t.tex === 'wagara-asanoha' ? [0xb8, 0x91, 0x2f] : null;
  const noise = (() => { const P = 64, L = Array.from({ length: P * P }, () => r()); return (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, A = (a, b) => L[((b % P + P) % P) * P + ((a % P + P) % P)]; const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); return (A(i, j) * (1 - sx) + A(i + 1, j) * sx) * (1 - sy) + (A(i, j + 1) * (1 - sx) + A(i + 1, j + 1) * sx) * sy; }; })();
  const n2 = (x, y) => noise(x / 9, y / 9) * 0.6 + noise(x / 3, y / 3) * 0.4;
  // the holes: moth-eaten blobs, a tear or two up from the hem, sometimes a lost corner (none of
  // it on a palace's cloth, `pristine`: whole, bright, clean)
  const P = !!t.pristine;
  const holes = [];
  for (let q = 0, n = 3 + ((r() * 8) | 0); q < n; q++) holes.push({ x: r() * W, y: H * (0.15 + r() * 0.8), r: 1 + r() * Math.min(W, H) * 0.035 });
  const tears = [];
  for (let q = 0, n = r() < 0.75 ? 1 + ((r() * 2) | 0) : 0; q < n; q++) tears.push({ x: W * (0.15 + r() * 0.7), w: 2 + r() * W * 0.07, h: H * (0.15 + r() * 0.35), lean: (r() - 0.5) * 0.6 });
  const corner = r() < 0.35 ? { left: r() < 0.5, s: Math.min(W, H) * (0.12 + r() * 0.15) } : null;
  const gone = (x, y) => {
    if (P) return false;
    const ragged = 1.5 + n2(x * 3, 7) * H * 0.05;
    if (y > H - ragged || x < n2(3, y * 3) * 2.2 || x > W - 1 - n2(9, y * 3) * 2.2) return true;     // the hem and the frayed sides
    for (const h of holes) if (Math.hypot(x - h.x, y - h.y) < h.r * (0.7 + 0.6 * n2(x * 2, y * 2))) return true;
    for (const e of tears){ const k = (y - (H - e.h)) / e.h; if (k > 0 && Math.abs(x - e.x - e.lean * (H - y) - (n2(x, y * 4) - 0.5) * 3) < e.w * k) return true; }
    if (corner){ const cx = corner.left ? x : W - 1 - x; if (cx + (H - y) < corner.s * (0.8 + 0.4 * n2(x * 2, y * 2))) return true; }
    return false;
  };
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = gone(x, y) ? 1 : 0;
  // the cloth within 2px of a hole: scorched or rotten (the mask grown twice, once each way)
  const grow = (m, dx, dy) => { const o = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ let v = m[y * W + x]; for (let q = 1; q <= 2 && !v; q++){ const X = x + dx * q, Y = y + dy * q, X2 = x - dx * q, Y2 = y - dy * q; v = (X < W && Y < H && m[Y * W + X]) || (X2 >= 0 && Y2 >= 0 && m[Y2 * W + X2]); } o[y * W + x] = v ? 1 : 0; } return o; };
  const edge = grow(grow(mask, 1, 0), 0, 1);
  const near = (x, y) => edge[y * W + x] === 1;
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H;
  const og = oc.getContext('2d'), om = og.createImageData(W, H), o = om.data;
  const tide = P ? 2 : 0.72 + r() * 0.12, fade = P ? 0.02 : 0.16 + r() * 0.18;
  let anyGold = false;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const k = y * W + x, p = k * 4;
    let R0 = d[p], G0 = d[p + 1], B0 = d[p + 2];
    const isGold = goldHex && Math.abs(R0 - goldHex[0]) + Math.abs(G0 - goldHex[1]) + Math.abs(B0 - goldHex[2]) < 60;
    // a woven border on the Wagara cloths, in the figure's own darkened colour
    const bw = Math.max(3, Math.round(Math.min(W, H) * 0.04));
    if (wagara && (x < bw || y < bw || x >= W - bw || y >= H - bw)){ const e = (x === bw - 1 || y === bw - 1 || x === W - bw || y === H - bw); R0 = e ? 200 : R0 * 0.45; G0 = e ? 176 : G0 * 0.45; B0 = e ? 120 : B0 * 0.45; }
    // faded toward dust, grimier low down, a tide line of old damp
    const f = fade + n2(x, y) * (P ? 0.03 : 0.18), dust = [118, 106, 90];
    R0 += (dust[0] - R0) * f; G0 += (dust[1] - G0) * f; B0 += (dust[2] - B0) * f;
    let dk = P ? 1 : 1 - Math.pow(y / H, 2) * 0.22 * (0.5 + n2(x * 2, y));
    const line = tide + (n2(x * 2, 3) - 0.5) * 0.08;
    if (y / H > line) dk *= 0.78; else if (y / H > line - 0.012) dk *= 0.62;
    if (near(x, y)) dk *= 0.55;                                                      // scorched or rotten round the holes
    d[p] = R0 * dk; d[p + 1] = G0 * dk * (near(x, y) ? 0.85 : 1); d[p + 2] = B0 * dk * (near(x, y) ? 0.7 : 1);
    d[p + 3] = mask[k] ? 0 : 255;
    // occlusion, roughness, metal: wool is rough, grime rougher, gold thread smooth and metal
    o[p] = 255; o[p + 1] = isGold ? 110 : 225 + n2(x, y) * 30; o[p + 2] = isGold ? 230 : 0; o[p + 3] = 255;
    if (isGold) anyGold = true;
  }
  g.putImageData(im, 0, 0); og.putImageData(om, 0, 0);
  const map = new THREE.CanvasTexture(cv); map.magFilter = map.minFilter = THREE.NearestFilter; map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = false;
  const orm = new THREE.CanvasTexture(oc); orm.magFilter = orm.minFilter = THREE.NearestFilter; orm.colorSpace = THREE.NoColorSpace; orm.generateMipmaps = false;
  return { map, orm, gold: anyGold };
}

// ---- reliefs -------------------------------------------------------------------------
// Carved friezes along the tops of walls, each under a projecting cornice, and
// framed panels: patterns from stone-tex.js, or a Wagara sheet carved in stone.
// One material per pattern, made the first time it's needed.
const RELIEF = new Map();
// the cathedral's tracery panels, and the texture each is cut at (its aspect is the panel's)
// fractal tracery, inlaid by tier (js/glass.js); three of each, so neighbouring windows differ
export const TRACERY = { lancet: { w: 128, h: 256 }, clerestory: { w: 160, h: 240 }, triforium: { w: 256, h: 96 }, rose: { w: 256, h: 256 } };
// what a floor's windows are inlaid with: humble at the top, gems in gold at the bottom
// Which pavement a floor gets (pavement.js), or null for flags or rock. Picked by the
// room's kind, so all the bays of one space match; passages and plain rooms by their index.
//   floor 4 (fl 3, the cathedral's): glazed tiles. Encaustic in the church and the chapter
//     houses (Westminster's chapter house is paved so), Cistercian tile mosaic in the chapels
//   floors 5-6: Cosmati work. A chain of roundels down a nave, a quincunx under a dome,
//     panels elsewhere; the passages opus sectile
const PAVE_BY_KIND = {
  3: { nave: 'encausticA', choir: 'encausticA', crossing: 'encausticA', arm: 'encausticA', aisle: 'encausticB', chapterhouse: 'encausticB', octagon: 'encausticB',
    chapel: 'cistercian', apse: 'cistercian', walk: 'encausticB', undercroft: 'cistercian' },
  4: { nave: 'rotae', choir: 'rotae', aisle: 'panels', rotunda: 'quincunx', grandrotunda: 'quincunx', treasury: 'quincunx', octagon: 'quincunx', chapterhouse: 'quincunx', chapel: 'rotae', apse: 'quincunx', gilthall: 'panels', crossing: 'quincunx' },
};
function pavingOf(R, ri, big, salt = 0){
  const fl = depthOf(R);
  if (!(fl >= 3)) return null;
  if (!big) return fl >= 4 ? (ri % 2 ? 'cubes' : 'stars') : null;
  // the other crypts pick their own, by kind (so a space's bays still match)
  if (salt){ let h = salt; for (const c of R.kind) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (fl >= 4 ? ['panels', 'quincunx', 'rotae'] : ['encausticA', 'encausticB', 'cistercian'])[h % 3]; }
  const by = PAVE_BY_KIND[Math.min(fl, 4)];
  if (by[R.kind]) return by[R.kind];
  return fl >= 4 ? ['panels', 'quincunx', 'rotae'][ri % 3] : ['encausticA', 'encausticB', 'cistercian'][ri % 3];
}
const tierOf = fl => fl >= 5 ? 'glow' : fl >= 4 ? 'gems' : fl >= 2 ? 'marble' : 'lead';     // 'glow': a palace's, the gems lit from behind
// `stone`: the crypt's own (gen/under.js STONES), which tints the carving; not the tracery's inlay
function reliefMat(pattern, panel, mats, variant = 0, tier = 'gems', stone = 'grey'){
  const tr0 = TRACERY[pattern], key = pattern + (panel ? ':p' : ':f') + '#' + variant + ':' + tier + (tr0 ? '' : ':' + stone);
  if (RELIEF.has(key)) return RELIEF.get(key);
  const k = STONES[stone] || STONES.grey;
  let mat;
  if (pattern.startsWith('wagara')){
    mat = new THREE.MeshLambertMaterial({ color: 0x8a847a });          // plain stone until the sheet loads
    loadImage(pattern).then(img => { const t = reliefFromImage(img, 31, { w: 64, h: 64 }); mat.map = t.map; mat.normalMap = t.normalMap; mat.color.setRGB(k[0], k[1], k[2]); mat.needsUpdate = true; });
  } else {
    const tr = TRACERY[pattern];
    if (tr){
      // the tracery inlaid: polished or matte, but nothing glows underground; cut away outside its outline.
      // In a palace it does: the glass lit from behind, as a window in daylight
      const glow = tier === 'glow', t = glass(pattern, 23 + variant * 101, { ...tr, tier: glow ? 'gems' : tier });
      mat = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 0.7, alphaMap: t.alpha, alphaTest: 0.5,
        ...(glow ? { emissive: 0xffffff, emissiveMap: t.map, emissiveIntensity: 2.4 } : {}) });
    } else {
      const t = panel ? relief(pattern, 21, { w: 64, h: 64, frame: true }) : relief(pattern, 11);
      mat = new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.2, 1.2) });
      mat.color.setRGB(k[0], k[1], k[2]);
    }
  }
  RELIEF.set(key, mat);
  return mat;
}
// gold set with stones (js/glass.js): an archivolt's band, an altar's frontal
const JEWELS = new Map();
function jewelMat(kind){
  if (!JEWELS.has(kind)){ const t = jewels(kind, 7); JEWELS.set(kind, new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, metalnessMap: t.orm, roughness: 1, metalness: 0.7 })); }
  return JEWELS.get(kind);
}
// the floor a wall panel belongs to: the room it faces into
function panelFloor(L, p){
  const fx = Math.cos(p.face), fz = Math.sin(p.face);
  for (const d of [0.8, 1.6, 2.4, 3.2]){
    const x = p.x + fx * d, z = p.z + fz * d, i = Math.floor((x - L.x0) / L.cell), j = Math.floor((z - L.z0) / L.cell);
    if (i < 0 || j < 0 || i >= L.W || j >= L.H) continue;
    const k = j * L.W + i, R = L.open[k] ? L.regions[L.reg[k]] : null;
    if (R) return depthOf(R);
  }
  return 0;
}
function reliefs(L, scene, mats){
  const groups = new Map(), G = key => groups.get(key) || groups.set(key, new Geo()).get(key), C = new Geo(), W1 = [1, 1, 1];
  const V = new Geo(), J = new Geo();          // voussoirs round the windows; their jewelled archivolts, on the deepest floors
  for (const f of L.friezes){
    const g = G(f.pattern + ':f'), off = 0.06, y0 = f.y - f.h / 2, y1 = f.y + f.h / 2, out = [f.nx, 0, f.nz];
    const P = (a, y, o = off) => f.horiz ? [a, y, f.line + f.nz * o] : [f.line + f.nx * o, y, a];
    const ul = 2 * f.h;                                              // one repeat of the pattern along the frieze
    g.quad(P(f.a0, y0), P(f.a1, y0), P(f.a1, y1), P(f.a0, y1), [f.a0 / ul, 0], [f.a1 / ul, 0], [f.a1 / ul, 1], [f.a0 / ul, 1], out, W1);
    // the cornice over it: a moulding that throws a shadow line under the vault
    const [cx, , cz] = P((f.a0 + f.a1) / 2, 0, 0.09);
    boxUV(C, cx, cz, y1, y1 + 0.16, f.horiz ? f.a1 - f.a0 : 0.18, f.horiz ? 0.18 : f.a1 - f.a0, 0, [0.95, 0.93, 0.88]);
    const [bx, , bz] = P((f.a0 + f.a1) / 2, 0, 0.05);
    boxUV(C, bx, bz, y0 - 0.08, y0, f.horiz ? f.a1 - f.a0 : 0.1, f.horiz ? 0.1 : f.a1 - f.a0, 0, [0.9, 0.88, 0.84]);
  }
  for (const p of L.panels){
    const tr = TRACERY[p.pattern], fl = tr ? panelFloor(L, p) : 0;
    const g = G(p.pattern + ':p:' + (tr ? Math.abs(Math.round(p.x * 7 + p.z * 13)) % 3 + ':' + tierOf(fl) : 0)), fx = Math.cos(p.face), fz = Math.sin(p.face), tx = -fz, tz = fx, out = [fx, 0, fz];
    const hw = (p.w || p.s) / 2, hh = (p.h || p.s) / 2;
    const P = (u, y, o = 0.03) => [p.x + tx * u + fx * o, y, p.z + tz * u + fz * o];
    g.quad(P(-hw, p.y - hh), P(hw, p.y - hh), P(hw, p.y + hh), P(-hw, p.y + hh), [1, 0], [0, 0], [0, 1], [1, 1], out, W1);
    if (tr){ windowSurround(V, J, p, tr, fl, hw, hh, P, out); continue; }   // tracery is set in the wall: voussoirs, not a frame
    const h = hw;
    // a moulded frame standing proud round it
    const fr = 0.12, col = [0.93, 0.91, 0.86];
    for (const [u, y, su, sy] of [[0, p.y + h + fr / 2, p.s + 2 * fr, fr], [0, p.y - h - fr / 2, p.s + 2 * fr, fr], [-h - fr / 2, p.y, fr, p.s], [h + fr / 2, p.y, fr, p.s]]){
      const [x, , z] = P(u, 0, 0.06);
      boxUV(C, x, z, y - sy / 2, y + sy / 2, su, 0.12, Math.atan2(tz, tx), col);
    }
  }
  for (const [key, g] of groups){ const [pattern, kind, v, tier] = key.split(':'), m = g.mesh(reliefMat(pattern, kind === 'p', mats, +(v || 0), tier, L.style?.stone)); if (m) scene.add(m); }
  const cm = C.mesh(mats.crypt.trim); if (cm) scene.add(cm);
  const vm = V.mesh(mats.crypt.vous); if (vm) scene.add(vm);
  const jm = J.mesh(jewelMat('strip')); if (jm) scene.add(jm);
}
// A window's surround, as an arch's: a ring of voussoirs round its outline,
// standing proud of the tracery so the window sits back in the wall, and a sill
// under it. On the two deepest floors a band of stones in gold runs round the
// ring's inner edge, an archivolt set with jewels.
const FRONT = 0.17;                                       // the voussoirs' face, out from the wall's line
export function windowSurround(V, J, p, tr, fl, hw, hh, P, out, tile = VOUSSOIR){
  const k = tr.w / tr.h, col = [0.98, 0.96, 0.92];
  const Q = ([X, Y]) => [hw - X / k * 2 * hw, p.y - hh + Y * 2 * hh];   // the panel's units to (along, y): its u runs right to left
  let sill = null;
  for (const s of outlines(p.pattern, k)){
    const curve = outlinePath(s).map(Q);
    // round the outside clockwise (archBand lays the band to the curve's left)
    let area = 0; for (let q = 0; q < curve.length; q++){ const [a, b] = [curve[q], curve[(q + 1) % curve.length]]; area += a[0] * b[1] - b[0] * a[1]; }
    if (area > 0) curve.reverse();
    const us = curve.map(c => c[0]), span = Math.max(...us) - Math.min(...us), band = Math.min(0.6, Math.max(0.24, 0.2 * span));
    archBand(V, curve, P, band, [{ off: FRONT, n: out }], [-0.2, FRONT], col, true, tile);
    if (fl >= 4){ const jb = Math.min(0.22, band * 0.45); archBand(J, curve, P, jb, [{ off: FRONT + 0.02, n: out }], null, [1, 1, 1], false, jb * 8); }
    if (s.type === 'arch'){ const u0 = Math.min(...us) - band, u1 = Math.max(...us) + band; sill = sill ? [Math.min(sill[0], u0), Math.max(sill[1], u1)] : [u0, u1]; }
  }
  if (sill){
    // the sill: a slab under the opening(s), its top sloped out a little, as a sill sheds water (here, only habit)
    const y0 = p.y - hh, sh = 0.22, d = FRONT + 0.12, [u0, u1] = sill, L0 = (u1 - u0) / TILE;
    const S = (u, y, o) => P(u, y, o);
    V.quad(S(u0, y0 - sh, d), S(u1, y0 - sh, d), S(u1, y0 - 0.02, d), S(u0, y0 - 0.02, d), [0, 0], [L0, 0], [L0, 0.25], [0, 0.25], out, col);
    V.quad(S(u0, y0 - 0.02, d), S(u1, y0 - 0.02, d), S(u1, y0, -0.1), S(u0, y0, -0.1), [0, 0], [L0, 0], [L0, 0.25], [0, 0.25], [out[0], 1, out[2]], shade(col, 1.05));
    V.quad(S(u0, y0 - sh, d), S(u1, y0 - sh, d), S(u1, y0 - sh, -0.1), S(u0, y0 - sh, -0.1), [0, 0], [L0, 0], [L0, 0.25], [0, 0.25], [0, -1, 0], shade(col, 0.7));
    for (const [u, sgn] of [[u0, 1], [u1, -1]]){
      const [ax, , az] = P(u0, 0, 0), [bx, , bz] = P(u1, 0, 0), ex = (ax - bx) * sgn, ez = (az - bz) * sgn;   // its ends face along the wall
      V.quad(S(u, y0 - sh, d), S(u, y0 - 0.02, d), S(u, y0, -0.1), S(u, y0 - sh, -0.1), [0, 0], [0.1, 0], [0.1, 0.25], [0, 0.25], [ex, 0, ez], shade(col, 0.85));
    }
  }
}

// ---- the cathedral: ribs, arcades, piers ----------------------------------------------
// Ribs run along each bay's groins (its diagonals in plan) and across its edges
// (transverse and wall ribs), a boss at each crown; the round Romanesque vaults
// of the hall crypt have none. The arcades between nave and aisles are already
// there as the wall over the aisles' arches; here they get their thickness, a
// soffit and a moulded face either side. Compound piers carry them: a core with
// four shafts (Chartres' pilier cantonné), and a vaulting shaft from each pier
// up to the high vault's springing.
function ribsAndPiers(L, scene, mats){
  let G = new Geo();
  const floorOf = (x, z) => { const i = Math.floor((x - L.x0) / L.cell), j = Math.floor((z - L.z0) / L.cell), R = L.regions[L.reg[j * L.W + i]]; return depthOf(R); };
  const gems = [];                                                 // a cabochon under each boss on the deepest floors
  const lightC = [1, 0.98, 0.94];
  // a rib along a plan path a→b (world x, z), hanging `d` below the vault, `w` wide
  const rib = (R, ax, az, bx, bz, w = 0.38, d = 0.34, n = 14) => {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.1) return;
    const ux = (bx - ax) / len, uz = (bz - az) / len, px = -uz * w / 2, pz = ux * w / 2;
    const pt = q => { const x = ax + (bx - ax) * q / n, z = az + (bz - az) * q / n; return [x, L.regionCeil(R, x, z) - 0.03, z]; };
    for (let q = 0; q < n; q++){
      const a = pt(q), b = pt(q + 1), A = [a[0] + px, a[1], a[2] + pz], A2 = [a[0] - px, a[1], a[2] - pz], B = [b[0] + px, b[1], b[2] + pz], B2 = [b[0] - px, b[1], b[2] - pz];
      const lo = p => [p[0], p[1] - d, p[2]], s = q * len / n / TILE, t = (q + 1) * len / n / TILE;
      G.quad(lo(A), lo(B), lo(B2), lo(A2), [s, 0], [t, 0], [t, 0.12], [s, 0.12], [0, -1, 0], lightC);
      G.quad(A, B, lo(B), lo(A), [s, 0], [t, 0], [t, 0.1], [s, 0.1], [px, 0, pz], shade(lightC, 0.9));
      G.quad(A2, B2, lo(B2), lo(A2), [s, 0], [t, 0], [t, 0.1], [s, 0.1], [-px, 0, -pz], shade(lightC, 0.9));
    }
  };
  const W = (R, u, v) => R.axis === 'x' ? [u, v] : [v, u];
  // a region's ribs (gold on the last two floors) and its bosses (gold from the cathedral down)
  let GB = new Geo();
  const flush = R => {
    const m = G.mesh(depthOf(R) >= 4 ? mats.gold : mats.crypt.trim); if (m) scene.add(m);
    const b = GB.mesh(mats.gold); if (b) scene.add(b);
    G = new Geo(); GB = new Geo();
  };
  for (const R of L.regions){
    if (R.type !== 'vault' || R.round) continue;
    const nu = Math.round((R.u1 - R.u0) / R.bayU), nv = Math.round((R.v1 - R.v0) / R.bayV);
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++){
      const u0 = R.u0 + a * R.bayU, u1 = u0 + R.bayU, v0 = R.v0 + b * R.bayV, v1 = v0 + R.bayV, e = 0.05;
      const pu = (R.pu || 0) + e, pv = (R.pv || 0) + e;                                                                 // from the capitals' edges
      rib(R, ...W(R, u0 + pu, v0 + pv), ...W(R, u1 - pu, v1 - pv)); rib(R, ...W(R, u0 + pu, v1 - pv), ...W(R, u1 - pu, v0 + pv));   // the diagonals
      rib(R, ...W(R, u0 + e, v0 + e), ...W(R, u0 + e, v1 - e), 0.5, 0.42);                                                // transverse
      if (a === nu - 1) rib(R, ...W(R, u1 - e, v0 + e), ...W(R, u1 - e, v1 - e), 0.5, 0.42);
      for (const v of [v0 + 0.12, v1 - 0.12]) rib(R, ...W(R, u0 + pu, v), ...W(R, u1 - pu, v), 0.26, 0.24);            // wall ribs
      const [bx, bz] = W(R, (u0 + u1) / 2, (v0 + v1) / 2), by = L.regionCeil(R, bx, bz);
      boxUV(depthOf(R) >= 3 ? GB : G, bx, bz, by - 0.75, by, 0.9, 0.9, Math.PI / 4, lightC);                                     // the boss: gilded from the cathedral down
      if (depthOf(R) >= 4) gems.push([bx, by - 0.75, bz]);
    }
    flush(R);                                                      // a mesh per vault, so the ones behind you are culled
  }
  // a shaped room's own ribs and bosses (radial, round a dome, a ring's ridge)
  for (const R of L.regions){
    if (R.type !== 'shaped') continue;
    for (const [ax, az, bx, bz, w, d] of R.ribs) rib(R, ax, az, bx, bz, w, d, 18);
    for (const [bx, bz] of R.bosses){ const by = L.regionCeil(R, bx, bz); boxUV(depthOf(R) >= 3 ? GB : G, bx, bz, by - 0.75, by, 0.9, 0.9, Math.PI / 4, lightC); if (depthOf(R) >= 4) gems.push([bx, by - 0.75, bz]); }
    flush(R);
  }
  // the arcades' thickness: under each aisle bay's arch where it opens to the nave, choir or transept
  const V = new Geo();
  for (const C of L.basilicas || []) for (const A of C.aisles){
    const nu = Math.round((A.u1 - A.u0) / A.bayU), naveV = Math.abs(A.v0 - C.nave.c) < Math.abs(A.v1 - C.nave.c) ? A.v0 : A.v1;
    for (let a = 0; a < nu; a++){
      const u0 = A.u0 + a * A.bayU, u1 = u0 + A.bayU, n = 16, dep = 0.7, pin = (A.pu || 0) + 0.02;   // from the capitals' edges
      const vin = naveV + (naveV === A.v0 ? 0.01 : -0.01);
      const curve = Array.from({ length: n + 1 }, (_, q) => { const u = u0 + pin + (u1 - u0 - 2 * pin) * q / n; return [u, L.regionCeil(A, ...W(A, u, vin))]; });
      const P = (u, y, o) => { const [x, z] = W(A, u, naveV + o); return [x, y, z]; }, nrm = side => A.axis === 'x' ? [0, 0, side] : [side, 0, 0];
      archBand(V, curve, P, 0.55, [{ off: -dep / 2, n: nrm(-1) }, { off: dep / 2, n: nrm(1) }], [-dep / 2, dep / 2], lightC);
    }
  }
  { const vm = V.mesh(mats.crypt.vous); if (vm) scene.add(vm); }
  // gems under the bosses: polished, domed, each its own colour (lapis and garnet the most)
  if (gems.length){
    const geo = new THREE.SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0 }), gems.length), mx = new THREE.Matrix4(), c = new THREE.Color();
    inst.material.userData.own = true;
    const COLS = [0x1a2c78, 0x1a2c78, 0x70101e, 0x70101e, 0x145c38, 0x4e2268, 0xa8461e];
    gems.forEach(([x, y, z], q) => { mx.makeTranslation(x, y + 0.04, z); inst.setMatrixAt(q, mx); inst.setColorAt(q, c.set(COLS[(Math.abs(Math.round(x * 3 + z * 7))) % COLS.length])); });
    inst.computeBoundingSphere(); scene.add(inst);
  }
  // the altar: a block with a projecting slab, the mensa; on the deepest floors a
  // golden altar, gold set with stones on all four sides, as Sant'Ambrogio's
  const F = new Geo();
  for (const p of L.props) if (p.kind === 'altar'){
    boxUV(G, p.x, p.z, p.y - 0.1, p.y + p.h - 0.15, 2 * p.hl, 2 * p.hw, p.a, [0.92, 0.9, 0.85]);
    boxUV(G, p.x, p.z, p.y + p.h - 0.15, p.y + p.h, 2 * p.hl + 0.35, 2 * p.hw + 0.35, p.a, [1, 0.98, 0.93]);
    if (floorOf(p.x, p.z) < 4) continue;
    const c = Math.cos(p.a), s = Math.sin(p.a), Pt = (u, v, y) => [p.x + c * u - s * v, y, p.z + s * u + c * v], y0 = p.y + 0.02, y1 = p.y + p.h - 0.2, hx = p.hl + 0.02, hz = p.hw + 0.02;
    for (const [u0, v0, u1, v1, ox, oz] of [[-hx, -hz, hx, -hz, 0, -1], [hx, -hz, hx, hz, 1, 0], [hx, hz, -hx, hz, 0, 1], [-hx, hz, -hx, -hz, -1, 0]]){
      const n = Math.max(1, Math.round(Math.hypot(u1 - u0, v1 - v0) / (y1 - y0)));     // square fields of the frontal along the side
      F.quad(Pt(u0, v0, y0), Pt(u1, v1, y0), Pt(u1, v1, y1), Pt(u0, v0, y1), [0, 0], [n, 0], [n, 1], [0, 1], [c * ox - s * oz, 0, s * ox + c * oz], [1, 1, 1]);
    }
  }
  { const fm = F.mesh(jewelMat('panel')); if (fm) scene.add(fm); }
  const gm = G.mesh(mats.crypt.trim); if (gm) scene.add(gm);

  // the octagon's benches, one along each side
  for (const b of L.benchesR || []){
    const [x, z] = [b.x, b.z];
    boxUV(G, x, z, b.y - 0.1, b.y + b.h, b.d, b.len, b.a, [0.92, 0.9, 0.85]);
  }
  // a font: a stone bowl on a stem, in the rotunda's middle
  for (const p of L.props) if (p.kind === 'font'){
    const prof = [[0.001, 0], [0.75, 0], [0.75, 0.2], [0.42, 0.3], [0.36, 0.7], [0.5, 0.85], [1.05, 1.0], [1.1, 1.25], [0.95, 1.25], [0.9, 1.05], [0.001, 1.05]];
    const lathe = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 16);
    const u = lathe.attributes.uv, pos = lathe.attributes.position; for (let v = 0; v < u.count; v++) u.setXY(v, u.getX(v) * 2.2, pos.getY(v) / TILE);
    const m = new THREE.Mesh(lathe, mats.crypt.column); m.position.set(p.x, p.y - 0.05, p.z); scene.add(m);
  }
  // the chapter house's stone bench, round its walls
  for (const b of L.benches || []){
    const len = b.a1 - b.a0, mid = (b.a0 + b.a1) / 2, [x, z] = b.horiz ? [mid, b.line + b.nz * b.d / 2] : [b.line + b.nx * b.d / 2, mid];
    boxUV(G, x, z, b.y - 0.1, b.y + b.h, b.horiz ? len : b.d, b.horiz ? b.d : len, 0, [0.92, 0.9, 0.85]);
  }
  const bm = G.mesh(mats.crypt.trim); if (bm) scene.add(bm);
  G = new Geo();

  // compound piers, instanced by size and height: a core, four shafts round it, a base, a capital band
  const piers = L.props.filter(p => p.kind === 'pier'), groups = new Map();
  for (const p of piers){ p.gilt = floorOf(p.x, p.z) >= 4; const key = `${p.style}:${(p.k || 1).toFixed(2)}:${p.h.toFixed(2)}:${p.gilt}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(p); }
  for (const list of groups.values()){
    // Gothic: a slender core and four shafts, no thicker than the ribs they gather (0.95
    // across at k = 1); Romanesque: the massive drum and shafts, for the low groin vaults
    const k = list[0].k || 1, h = list[0].h, goth = list[0].style === 'gothic', parts = [];
    const r = (goth ? 0.62 : 1.0) * k, sr = (goth ? 0.2 : 0.3) * k, so = r + (goth ? 0.08 : 0.12) * k;
    const core = new THREE.CylinderGeometry(r, r, h, 16); core.translate(0, h / 2, 0); parts.push(core);
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){ const sh = new THREE.CylinderGeometry(sr, sr, h, 8); sh.translate(ox * so, h / 2, oz * so); parts.push(sh); }
    const capital = goth ? new THREE.CylinderGeometry(so + sr + 0.12 * k, so * 0.95, 0.45, 16) : new THREE.CylinderGeometry(r + 0.6 * k, r + 0.3 * k, 0.55, 16);
    capital.translate(0, h - (goth ? 0.22 : 0.27), 0);
    const ab = goth ? 2 * (so + sr) + 0.35 * k : 2 * r + 1.4 * k, abacus = new THREE.BoxGeometry(ab, goth ? 0.2 : 0.28, ab); abacus.translate(0, h + 0.08, 0);
    const gilt = list[0].gilt, capParts = [capital, abacus];
    if (!gilt) parts.push(...capParts);                       // deep down, the capitals are gilded: their own mesh, below
    const pl = goth ? 2 * (so + sr) + 0.2 * k : 2 * r + 1.1 * k, plinth = new THREE.BoxGeometry(pl, goth ? 0.45 : 0.6, pl); plinth.translate(0, 0.15, 0); parts.push(plinth);
    const geo = mergeGeometries(parts.map(g => { const q = g.toNonIndexed(); const u = q.attributes.uv; for (let v = 0; v < u.count; v++) u.setXY(v, u.getX(v) * 2.2, u.getY(v) * h / TILE); return q; }));
    geo.computeVertexNormals();
    const inst = new THREE.InstancedMesh(geo, gilt ? mats.crypt.verde : mats.crypt.column, list.length), mx = new THREE.Matrix4();   // under gold capitals, verde antico
    list.forEach((p, q) => { mx.makeTranslation(p.x, p.y - 0.05, p.z); inst.setMatrixAt(q, mx); });
    inst.computeBoundingSphere(); scene.add(inst);
    if (gilt){
      const cg = mergeGeometries(capParts.map(g => g.toNonIndexed())); cg.computeVertexNormals();
      const ci = new THREE.InstancedMesh(cg, mats.gold, list.length);
      list.forEach((p, q) => { mx.makeTranslation(p.x, p.y - 0.05, p.z); ci.setMatrixAt(q, mx); });
      ci.computeBoundingSphere(); scene.add(ci);
    }
  }
  // Shafts where the ribs land. At every corner of every Gothic bay, a shaft rises
  // to exactly the vault's springing and ends in a small capital, so each rib comes
  // down onto something: over a pier, from its capital, half set into the wall
  // above the arcade; against a wall, from the floor, engaged in it (and set into
  // the corner where two walls meet). Dedup'd where bays share a corner.
  const SR = 0.24, shafts = [], responds = [], seenS = new Set();
  for (const R of L.regions){
    if (R.type !== 'vault' || (R.round && !(R.pu || R.pv))) continue;     // a round vault with no inset has nothing to land
    const nu = Math.round((R.u1 - R.u0) / R.bayU), nv = Math.round((R.v1 - R.v0) / R.bayV);
    for (let a = 0; a <= nu; a++) for (let b = 0; b <= nv; b++){
      const u = R.u0 + a * R.bayU, v = R.v0 + b * R.bayV, [x, z] = W(R, u, v);
      const key = `${x.toFixed(1)},${z.toFixed(1)},${R.spring.toFixed(1)}`;
      if (seenS.has(key)) continue;
      // which way is into the room from here: along each axis where the corner is on the region's edge
      const du = a === 0 ? 1 : a === nu ? -1 : 0, dv = b === 0 ? 1 : b === nv ? -1 : 0;
      const pier = piers.find(p => Math.hypot(p.x - x, p.z - z) < 0.8);
      if (pier){
        const capTop = pier.y + pier.h + 0.18;
        if (R.spring - capTop < 1.5 || (!du && !dv)) continue;          // the pier's own capital carries these ribs
        const [ox, oz] = W(R, du * SR, dv * SR);
        shafts.push({ x: x + ox, z: z + oz, y0: capTop, y1: R.spring }); seenS.add(key);
        continue;
      }
      // a wall corner: rock behind it (any of the four cells round the point)
      let rock = false;
      for (const [ex, ez] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) if (!L.isOpen(x + ex, z + ez)) rock = true;
      if (!rock || (!du && !dv)) continue;
      // where the vault's arches spring from a band (an inset), the wall carries them on a
      // respond as wide as that band: a flat pilaster with an abacus; otherwise a thin shaft
      const bu = dv && !du ? 2 * (R.pu || 0) : du && !dv ? 2 * (R.pv || 0) : Math.min(R.pu || 0, R.pv || 0);
      if (bu > 0.6){
        const along = dv && !du ? 'u' : du && !dv ? 'v' : 'corner', dep = 0.32;
        const [ox, oz] = along === 'corner' ? W(R, du * bu / 2, dv * bu / 2) : W(R, du * dep / 2, dv * dep / 2);
        const [sx, sz] = along === 'u' ? W(R, bu, dep) : along === 'v' ? W(R, dep, bu) : W(R, bu, bu);
        responds.push({ x: x + ox, z: z + oz, sx: Math.abs(sx), sz: Math.abs(sz), y0: R.y, y1: R.spring }); seenS.add(key);
        continue;
      }
      const [ox, oz] = W(R, du * SR * 1.05, dv * SR * 1.05);
      shafts.push({ x: x + ox, z: z + oz, y0: R.y, y1: R.spring }); seenS.add(key);
    }
  }
  L.springers = shafts; L.responds = responds;     // for tools: what carries each corner's ribs
  { const T = new Geo();
    for (const p of responds){
      boxUV(T, p.x, p.z, p.y0 - 0.1, p.y1 - 0.2, p.sx, p.sz, 0, [0.95, 0.93, 0.88]);
      boxUV(T, p.x, p.z, p.y1 - 0.2, p.y1, p.sx + 0.25, p.sz + 0.25, 0, [1, 0.98, 0.93]);       // its abacus, at the springing
    }
    const m = T.mesh(mats.crypt.trim); if (m) scene.add(m); }
  // shaped rooms: a shaft wherever their ribs come down on a wall (if there's wall there)
  for (const R of L.regions){
    if (R.type !== 'shaped') continue;
    for (const [x, z, nx, nz] of R.springs){
      if (L.openAt(x - nx * 0.6, z - nz * 0.6)) continue;               // an opening, not a wall
      shafts.push({ x: x + nx * SR, z: z + nz * SR, y0: R.y, y1: R.spring });
    }
  }
  const byLen = new Map();
  for (const s of shafts){ s.deep = floorOf(s.x, s.z) >= 4; const key = (s.y1 - s.y0).toFixed(1) + ':' + s.deep; if (!byLen.has(key)) byLen.set(key, []); byLen.get(key).push(s); }
  const mx = new THREE.Matrix4();
  for (const list of byLen.values()){
    const len = list[0].y1 - list[0].y0, sh = new THREE.CylinderGeometry(SR, SR, len, 8); sh.translate(0, len / 2, 0);
    const u = sh.attributes.uv; for (let v = 0; v < u.count; v++) u.setXY(v, u.getX(v) * 0.5, u.getY(v) * len / TILE);
    const inst = new THREE.InstancedMesh(sh, list[0].deep ? mats.crypt.porphyry : mats.crypt.column, list.length);   // porphyry on the deepest floors
    list.forEach((s, q) => { mx.makeTranslation(s.x, s.y0, s.z); inst.setMatrixAt(q, mx); });
    inst.computeBoundingSphere(); scene.add(inst);
  }
  // their capitals: a little bell and abacus at the springing, where the ribs sit
  if (shafts.length){
    const bell = new THREE.CylinderGeometry(0.42, 0.26, 0.34, 10); bell.translate(0, -0.17, 0);
    const ab = new THREE.BoxGeometry(0.95, 0.14, 0.95); ab.translate(0, 0.02, 0);
    const geo = mergeGeometries([bell.toNonIndexed(), ab.toNonIndexed()]); geo.computeVertexNormals();
    for (const gilt of [false, true]){
      const list = shafts.filter(sh => (floorOf(sh.x, sh.z) >= 4) === gilt); if (!list.length) continue;
      const inst = new THREE.InstancedMesh(geo, gilt ? mats.gold : mats.crypt.column, list.length);
      list.forEach((sh, q) => { mx.makeTranslation(sh.x, sh.y1, sh.z); inst.setMatrixAt(q, mx); });
      inst.computeBoundingSphere(); scene.add(inst);
    }
  }
}

// ---- shaped rooms' walls -----------------------------------------------------------
// Along each shaped room's true outline, a wall from the floor up to its vault,
// facing in, except where another room or a passage lies straight on outside it:
// that's an opening, and the grid's face (passage arch up to the room's springing)
// closes it as a doorway.
function shapedWalls(L, scene, M){
  const geos = {};
  for (const R of L.regions){
    if (R.type !== 'shaped') continue;
    const ri = L.regions.indexOf(R), g = geos[R.finish] || (geos[R.finish] = new Geo()), uo = R.uo || 0;
    for (const line of R.shape.boundary(0.5)){
      let s0 = 0;
      for (let q = 0; q + 1 < line.length; q++){
        const [ax, az] = line[q], [bx, bz] = line[q + 1], len = Math.hypot(bx - ax, bz - az); if (len < 1e-4) continue;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        let nx = -(bz - az) / len, nz = (bx - ax) / len;                        // a normal; flip it to point in
        if (!R.shape.inside(mx + nx * 0.3, mz + nz * 0.3, 0)){ nx = -nx; nz = -nz; }
        // what lies outside: step out until past this room's own cells
        let open = false;
        for (let d = 0.3; d < 3.2; d += 0.4){
          const qx = mx - nx * d, qz = mz - nz * d, i = Math.floor((qx - L.x0) / L.cell), j = Math.floor((qz - L.z0) / L.cell);
          if (i < 0 || j < 0 || i >= L.W || j >= L.H) break;
          const k = j * L.W + i;
          if (!L.open[k]) break;                                              // rock: a wall
          if (L.reg[k] !== ri){ open = true; break; }                          // another room, a passage: an opening
        }
        if (!open){
          const fa = R.y - 0.6, ta = R.ceilFn(ax, az) + 0.02, tb = R.ceilFn(bx, bz) + 0.02, u0 = (s0 + uo) / TILE, u1 = (s0 + len + uo) / TILE;
          g.quad([ax, fa, az], [bx, fa, bz], [bx, tb, bz], [ax, ta, az], [u0, fa / TILE], [u1, fa / TILE], [u1, tb / TILE], [u0, ta / TILE], [nx, 0, nz], [0.92, 0.92, 0.9]);
        }
        s0 += len;
      }
    }
  }
  for (const f in geos){ const m = geos[f].mesh(M.walls[f] || M.wall); if (m) scene.add(m); }
}
