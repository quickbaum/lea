import * as THREE from 'three';
import { SIZE, SEG, WATER } from './config.js';
import { makeTexture, makeGrain } from './textures.js';

// ---- heightfield + habitats ---------------------------------------------------
// The land itself is generated in js/gen/land.js (seeded noise, region fields,
// habitats; pure so node tools can map it). This module keeps the API the rest
// of the game was written against: height, biome colour, the five surface types.
import { height, habitat, fields, HABITATS, road, roadBand, settlements, ruins, under, builtBand, solidAt, builtAt } from './gen/land.js';
export { height, habitat, HABITATS, road, roadBand, settlements, ruins, under, builtBand, solidAt, builtAt };

function hash(x, z){
  const n = Math.sin(x*127.1 + z*311.7) * 43758.5453;
  return n - Math.floor(n);
}
const ROCK = HABITATS.rock.color;

export function biome(x, z, h = height(x, z)){ return HABITATS[habitat(x, z, h)].color; }
// the surface the game reads: 'water' | 'sand' | 'mud' | 'grass' | 'rock'
export function terrainType(x, z){ return HABITATS[habitat(x, z)].surface; }
// how readily trees take hold here, 0..1 (woodland and alder carr high, open
// meadow and marsh low) — flora uses it so forests and clearings form
export function treeCover(x, z){ return HABITATS[habitat(x, z)].cover; }
// dry ground, and not through the wall of a building (settle.js)
export const walkable = (x, z) => height(x, z) > WATER - 0.1 && !solidAt(x, z, 0.35);

// ---- walking pace -------------------------------------------------------------
// How fast anyone walks here, as a multiple of their pace on a level meadow:
// the ground (HABITATS[..].pace — the road quickest, a reedbed half speed) times
// the slope. The slope follows Tobler's hiking function: fastest on a gentle
// downhill (~5%), slower on the flat, and falling off steeply either way — a
// 30% climb is about a third of your flat pace. Used by the player, by the folk
// as they walk, and by their pathfinding and choices (nav.js, agents.js), so
// everyone weighs the same land the same way.
const TOBLER_FLAT = Math.exp(3.5 * 0.05);         // normalises Tobler to 1 on the level
export const slopePace = grade => Math.max(0.2, Math.exp(-3.5 * Math.abs(grade + 0.05)) * TOBLER_FLAT);
export function groundPace(x, z){ return HABITATS[habitat(x, z)].pace; }
// Worn ground is quicker going: a trodden path is packed earth, so the more it's
// walked (trails.js wear, 0..1) the nearer its pace comes to TRAIL_PACE — a
// path through a reedbed is most of the way to a meadow's. Ground already
// quicker than a path (the road) is left as it is. This closes the trails'
// loop: paths form where walking is easy, and are easier for being walked.
export const TRAIL_PACE = 1.1;
export function wornPace(ground, w){
  if (!(w > 0.08) || ground >= TRAIL_PACE) return ground;
  const t = Math.min(1, (w - 0.08) / 0.42), k = t * t * (3 - 2 * t);
  return ground + (TRAIL_PACE - ground) * 0.8 * k;
}
let wearAt = null;                                  // (x, z) => wear; main.js hands over the trail field
export function setWearSource(fn){ wearAt = fn; }
// walking from (x, z) in direction (dx, dz)
export function pace(x, z, dx, dz){
  const l = Math.hypot(dx, dz);
  const ground = wornPace(groundPace(x, z), wearAt ? wearAt(x, z) : 0);
  if (!l) return ground;
  const ux = dx / l, uz = dz / l;
  const grade = (height(x + ux, z + uz) - height(x - ux, z - uz)) / 2;   // rise per unit, ahead
  return ground * slopePace(grade);
}

// How far to lower an object's base so a flat footprint of radius r doesn't float
// on a slope: the drop from the centre down to the lowest ground under that
// footprint. Used to sink tree trunks into a hillside so the downhill roots reach
// soil instead of hanging in the air (trees stay vertical — we bury, not tilt).
export function groundSink(x, z, r){
  const h0 = height(x, z);
  let mn = h0;
  for (let k = 0; k < 8; k++){
    const a = k / 8 * Math.PI * 2;
    const h = height(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (h < mn) mn = h;
  }
  return h0 - mn;     // >= 0
}

// Soil richness 0..1, by habitat: wet meadow and carr are rich, fen and heath
// poor, sand and rock barely anything. Plants grown on richer soil fill out
// broader and fuller. Groundwater nudges it within a habitat, so a wood isn't
// one uniform stand.
export function soilRichness(x, z){
  const k = habitat(x, z);
  if (k === 'lake') return 0;
  return Math.max(0, Math.min(1, HABITATS[k].soil + (fields(x, z).wet - 0.5) * 0.3));
}

// A reproducible random point on chosen terrain types, within a radius.
export function randomLand(rng, radius = 95, allowed = null){
  for (let t = 0; t < 80; t++){
    const x = (rng() - 0.5) * radius * 2, z = (rng() - 0.5) * radius * 2;
    if (Math.hypot(x, z) > radius) continue;
    if (!allowed || allowed.has(terrainType(x, z))) return [x, z];
  }
  return [0, 0];
}

// ---- meshes -----------------------------------------------------------------
// The ground is one heightfield grid (SEG+1 vertices a side, row r at
// z = r*STEP - SIZE/2, column c at x = c*STEP - SIZE/2) cut into TILE-quad
// square meshes, so three.js frustum-culls the parts behind you instead of
// drawing the whole world every frame. Everything that recolours the ground
// (duff under trees, trail wear) writes the shared `color` grid — bytes, 0..255
// — by grid index and calls touch(i); upload() then re-sends only the built
// tiles that changed.
//
// A tile's mesh is built the first time the camera comes within BUILD_DIST of
// it, not up front: at 3200u, building all 400 tiles held ~130 MB of vertex
// arrays for ground nobody had walked to. Once a tile is on the GPU only its
// colours stay on the CPU (dropArray).
//
// Past the draw distance a tile swaps to a far twin that uses every FAR_STRIDE-th
// vertex (it is deep in fog there, so only its silhouette matters). Every tile
// hangs a short skirt from its edges, so a fine tile meeting a coarse one can't
// open a crack to the sky.
const TILE = 80;                  // quads per tile side (160u at 2u spacing)
const FAR_STRIDE = 4;             // far LOD: a vertex every 8u
const SKIRT = 3;                  // how far the edge skirts hang below the ground
const BUILD_DIST = 420;           // build a tile's mesh once the camera is this close (far plane 400)
const BUILDS_PER_FRAME = 2;       // spread the building out while walking
const NOW_DIST = 200;             // ...except within this: never a hole in the fog

// grid lines a stride-s lattice keeps over 0..n-1: multiples of s plus the last
const lattice = (n, s) => { const o = []; for (let k = 0; k < n - 1; k += s) o.push(k); o.push(n - 1); return o; };

function dropArray(){ this.array = null; }

// The border of an nr×nc vertex tile walked once round, and the surface +
// skirt index for a stride-s lattice over it. Depends only on the tile's size,
// so every full-size tile shares one (the cache below).
function tileRing(nr, nc){
  const ring = [];
  for (let c = 0; c < nc - 1; c++) ring.push(c);                        // top    (r = 0)
  for (let r = 0; r < nr - 1; r++) ring.push(r * nc + nc - 1);          // right
  for (let c = nc - 1; c > 0; c--) ring.push((nr - 1) * nc + c);        // bottom
  for (let r = nr - 1; r > 0; r--) ring.push(r * nc);                   // left
  return ring;
}
const _indexCache = new Map();
function tileIndex(nr, nc, stride){
  const key = nr + 'x' + nc + '/' + stride;
  if (_indexCache.has(key)) return _indexCache.get(key);
  const nv = nr * nc, ring = tileRing(nr, nc);
  const skirtOf = new Map(ring.map((v, k) => [v, nv + k]));
  // surface, same winding as PlaneGeometry after rotateX(-PI/2) (faces up)
  const rows = lattice(nr, stride), cs = lattice(nc, stride), idx = [];
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cs.length - 1; j++){
    const a = rows[i] * nc + cs[j], b = rows[i + 1] * nc + cs[j];
    const c = rows[i + 1] * nc + cs[j + 1], d = rows[i] * nc + cs[j + 1];
    idx.push(a, b, d, b, c, d);
  }
  // skirt along the border vertices this lattice keeps, facing out. In grid
  // units (col = x, row = z) the outward test is size-only, so it can be cached.
  const rs = new Set(rows), cset = new Set(cs);
  const edge = ring.filter(v => rs.has(Math.floor(v / nc)) && cset.has(v % nc));
  const mid = [(nc - 1) / 2, (nr - 1) / 2];
  for (let k = 0; k < edge.length; k++){
    const a = edge[k], b = edge[(k + 1) % edge.length], as = skirtOf.get(a), bs = skirtOf.get(b);
    const ax = a % nc, az = Math.floor(a / nc), bx = b % nc, bz = Math.floor(b / nc);
    const ex = bx - ax, ez = bz - az, ox = (ax + bx) / 2 - mid[0], oz = (az + bz) / 2 - mid[1];
    // normal of (a, as, b) is (as - a) × (b - a) ∝ (-ez, 0, ex): keep it pointing out
    if (-ez * ox + ex * oz > 0) idx.push(a, as, b, b, as, bs);
    else idx.push(a, b, as, b, bs, as);
  }
  const attr = new THREE.BufferAttribute(nv + ring.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
  _indexCache.set(key, attr);
  return attr;
}

export class Ground {
  constructor(scene, grain){
    const cols = this.cols = SEG + 1, step = this.step = SIZE / SEG, half = SIZE / 2;
    const n = cols * cols;
    const col = this.color = new Uint8Array(n * 3);
    for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++){
      const i = r * cols + c, x = c * step - half, z = r * step - half;
      const h = height(x, z);
      const base = biome(x, z, h);
      // Steep slopes expose bedrock regardless of altitude.
      // Finite-difference slope over ±1 unit; grade in rock colour above 0.35 slope.
      const e = 1.0;
      const dhx = (height(x+e,z) - height(x-e,z)) * 0.5;
      const dhz = (height(x,z+e) - height(x,z-e)) * 0.5;
      const sl  = Math.hypot(dhx, dhz);
      const rb  = h > WATER ? Math.max(0, Math.min(1, (sl - 0.35) * 3.5)) : 0;
      const j   = 0.92 + hash(x*3.3, z*3.3) * 0.16;
      for (let k = 0; k < 3; k++) col[i*3+k] = Math.min(255, (base[k] + (ROCK[k] - base[k]) * rb) * j * 255);
    }

    this.scene = scene;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, map: grain });
    this.per = Math.ceil(SEG / TILE);              // tiles a side
    this.tiles = [];
    this.dirty = new Set();
    for (let tr = 0; tr < this.per; tr++) for (let tc = 0; tc < this.per; tc++){
      const r0 = tr * TILE, c0 = tc * TILE;
      const nr = Math.min(TILE, SEG - r0) + 1, nc = Math.min(TILE, SEG - c0) + 1;
      const x0 = c0 * step - half, z0 = r0 * step - half;
      this.tiles.push({ mesh: null, far: null, r0, c0, nr, nc, x0, z0, x1: x0 + (nc - 1) * step, z1: z0 + (nr - 1) * step });
    }
  }

  // build one tile's near + far meshes (sharing one set of vertex buffers)
  _build(t){
    const { r0, c0, nr, nc } = t, cols = this.cols, step = this.step, half = SIZE / 2;
    const nv = nr * nc, ring = tileRing(nr, nc), tot = nv + ring.length;
    const P = new Float32Array(tot * 3), N = new Float32Array(tot * 3);
    const Cc = new Uint8Array(tot * 3), U = new Float32Array(tot * 2);
    const src = new Int32Array(tot);                 // grid index each vertex mirrors
    const uvScale = SIZE / 800;                      // grain repeat was tuned on the 800u world
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++){
      const g = (r0 + r) * cols + (c0 + c), v = r * nc + c;
      const x = (c0 + c) * step - half, z = (r0 + r) * step - half;
      src[v] = g;
      P[v*3] = x; P[v*3+1] = height(x, z); P[v*3+2] = z;
      // normal from the heightfield itself, so tiles meet without a lighting seam
      const dx = (height(x + step, z) - height(x - step, z)) / (2 * step);
      const dz = (height(x, z + step) - height(x, z - step)) / (2 * step);
      const len = Math.hypot(dx, 1, dz);
      N[v*3] = -dx / len; N[v*3+1] = 1 / len; N[v*3+2] = -dz / len;
      U[v*2] = (c0 + c) / SEG * uvScale; U[v*2+1] = (1 - (r0 + r) / SEG) * uvScale;
    }
    ring.forEach((v, k) => {                         // skirt twins, SKIRT below the edge
      const w = nv + k; src[w] = src[v];
      P[w*3] = P[v*3]; P[w*3+1] = P[v*3+1] - SKIRT; P[w*3+2] = P[v*3+2];
      for (let j = 0; j < 3; j++) N[w*3+j] = N[v*3+j];
      U[w*2] = U[v*2]; U[w*2+1] = U[v*2+1];
    });
    for (let v = 0; v < tot; v++){ const g = src[v] * 3; Cc[v*3] = this.color[g]; Cc[v*3+1] = this.color[g+1]; Cc[v*3+2] = this.color[g+2]; }
    const attrs = {
      position: new THREE.BufferAttribute(P, 3), normal: new THREE.BufferAttribute(N, 3),
      color: new THREE.BufferAttribute(Cc, 3, true), uv: new THREE.BufferAttribute(U, 2),
    };
    // once on the GPU, only the colours ever change (trails, duff): let the rest go
    for (const k of ['position', 'normal', 'uv']) attrs[k].onUpload(dropArray);
    const twin = (stride) => {
      const geo = new THREE.BufferGeometry();
      for (const k in attrs) geo.setAttribute(k, attrs[k]);
      geo.setIndex(tileIndex(nr, nc, stride));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      this.scene.add(mesh);
      return mesh;
    };
    t.mesh = twin(1); t.far = twin(FAR_STRIDE); t.far.visible = false;
    t.src = src;
  }

  // Build tiles the camera has come near, and swap each built one to its far
  // twin when even its nearest edge is past lodDist. (three.js still
  // frustum-culls whichever twin is showing.) Call per frame.
  lod(camera, lodDist, budget = BUILDS_PER_FRAME){
    const px = camera.position.x, pz = camera.position.z;
    for (const t of this.tiles){
      const dx = Math.max(t.x0 - px, 0, px - t.x1), dz = Math.max(t.z0 - pz, 0, pz - t.z1);
      const d = Math.hypot(dx, dz);
      if (!t.mesh){
        if (d > BUILD_DIST || (budget <= 0 && d > NOW_DIST)) continue;   // ground you can see can't wait
        this._build(t); budget--;
      }
      const far = d > lodDist;
      t.mesh.visible = !far; t.far.visible = far;
    }
  }

  // world (x,z) -> nearest grid index, or -1 off the grid
  idx(x, z){
    const c = Math.round((x + SIZE / 2) / this.step), r = Math.round((z + SIZE / 2) / this.step);
    return c < 0 || c > SEG || r < 0 || r > SEG ? -1 : r * this.cols + c;
  }
  x(i){ return (i % this.cols) * this.step - SIZE / 2; }
  z(i){ return Math.floor(i / this.cols) * this.step - SIZE / 2; }

  // grid index i's colour changed: mark its tile (and the neighbour sharing a seam)
  touch(i){
    const r = Math.floor(i / this.cols), c = i % this.cols, per = this.per;
    const tr = Math.min(per - 1, Math.floor(r / TILE)), tc = Math.min(per - 1, Math.floor(c / TILE));
    this.dirty.add(tr * per + tc);
    const er = r % TILE === 0 && tr > 0 && r < SEG, ec = c % TILE === 0 && tc > 0 && c < SEG;
    if (er) this.dirty.add((tr - 1) * per + tc);
    if (ec) this.dirty.add(tr * per + tc - 1);
    if (er && ec) this.dirty.add((tr - 1) * per + tc - 1);
  }
  touchAll(){ for (let t = 0; t < this.tiles.length; t++) this.dirty.add(t); }

  // copy the shared colours into the dirty built tiles and send them to the GPU
  // (an unbuilt tile picks its colours up when it's built)
  upload(){
    const col = this.color;
    for (const ti of this.dirty){
      const t = this.tiles[ti];
      if (!t.mesh) continue;
      const a = t.mesh.geometry.attributes.color, arr = a.array, src = t.src;
      for (let v = 0; v < src.length; v++){ const g = src[v] * 3; arr[v*3] = col[g]; arr[v*3+1] = col[g+1]; arr[v*3+2] = col[g+2]; }
      a.needsUpdate = true;
    }
    this.dirty.clear();
  }
}

export function buildTerrain(scene){
  const ground = new Ground(scene, makeGrain());

  const waterTex = makeTexture(64, 64, (g) => {
    g.fillStyle = '#2f6db0'; g.fillRect(0,0,64,64);
    for (let i = 0; i < 160; i++){
      g.fillStyle = Math.random() < .5 ? '#3f86cf' : '#235a96';
      g.fillRect(Math.random()*64|0, Math.random()*64|0, 2, 1);
    }
  }, {repeat: [30 * SIZE / 800, 30 * SIZE / 800]});   // tuned on the 800u world
  const waterGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  waterGeo.rotateX(-Math.PI/2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.78, depthWrite: false, color: 0xbfe0ff
  }));
  water.position.y = WATER;
  scene.add(water);

  return { ground, water, waterTex };
}

// buildCliffs removed — steep terrain is now expressed through slope-aware vertex
// colours in buildTerrain, and loam accumulation is a separate mesh layer built
// by buildLoamLayer() in js/gen/geology.js.
