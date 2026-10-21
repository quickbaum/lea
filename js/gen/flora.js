import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER, WORLD_R, AREA } from '../config.js';
import { height, terrainType, soilRichness, groundSink, treeCover, habitat } from '../terrain.js';
import { rand, randint, fork } from '../rng.js';
import { makeGrassTexture, makePussywillowTexture, makeCattailTexture, makeAcornTexture, makeMushroomTexture, makeTrinketTexture, makeVineTexture, makeFernTexture, makeRedwoodFoliageTexture, makeSedgeTexture, makeCottonGrassTexture, makeHeatherTexture } from '../textures.js';
import { makeLeafAtlas } from './leaf.js';
import { makeBark, makeBirchBark, makeRedwoodBark, makeRowanBark } from './bark.js';
import { generateTree, leafMaterial, TREE_SPECIES, SHRUB_SPECIES, REDWOOD_SPECIES, OAK_SPECIES, BIRCH_SPECIES, ROWAN_SPECIES, PINE_SPECIES, ALDER_SPECIES } from './tree.js';

// plantWorld — scatter trees & shrubs across the terrain. We generate a few
// detailed archetypes once, then GPU-instance each across many positions, so
// the whole forest costs only ~2 draw calls per archetype.

const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;

// pre-allocated for per-frame billboard matrix updates
const _bbM   = new THREE.Matrix4();
const _bbS   = new THREE.Vector3();
const _fEuler = new THREE.Euler();
const _fQ    = new THREE.Quaternion();
const _yAxis  = new THREE.Vector3(0, 1, 0);

// ---- spatial tiling ---------------------------------------------------------
// Each kind of tree used to be ONE world-spanning InstancedMesh with
// frustumCulled = false, so every trunk and every leaf card in the world was
// submitted to the GPU on every frame — bearable in a 400u world, ruinous once
// it doubled. Instead we cut each set into CHUNK-sized tiles and draw only the
// tiles you can see: fog closes at ~130u, so you are looking at a couple of
// percent of the Lea, and that is all that gets drawn.
//
// A tile is NOT a mesh. At 3200u a mesh per tile per species meant ~80k
// Object3Ds (~1.2 KB each before any geometry) and a culling pass that tested
// 31k tiles a frame. So a tile holds a TileBatch — its instances' matrices,
// with the setMatrixAt/instanceMatrix API chop() and trails already use — and
// drawing goes through one pooled InstancedMesh per (geometry, material),
// refilled from the visible tiles only when what's visible changes. Tiles are
// also grouped into CELL-sized blocks, tested first, so the per-frame pass only
// looks inside blocks that are in view.
const CHUNK = 50;     // 100 culled too coarsely: a tile drew whole if any corner was in range
const CELL = 400;     // culling blocks
// Trees whose nearest trunk in the tile is past lodDist draw their far version
// (generateTree's branchGeoFar/leafGeoFar) — by then the fog has a quarter of them.
let lodDist = 55;
export function setFloraLod(d){ lodDist = d; }   // the settings panel's tree-detail slider
const floraTiles = [];   // { batches, plain, sphere, reach, vis, isFar }
const cells = new Map(); // CELL block key -> { tiles, sphere }
let cellsDirty = true;
let poolScene = null;

// Group entries (each `[x, z, …]`) into CHUNK-sized tiles, keyed by tile corner.
function tileEntries(list){
  const tiles = new Map();
  for (const e of list){
    const k = Math.floor(e[0] / CHUNK) + ',' + Math.floor(e[1] / CHUNK);
    let a = tiles.get(k);
    if (!a){ a = []; tiles.set(k, a); }
    a.push(e);
  }
  return tiles;
}

// One tile's instances of one (geometry, material): a stand-in for a per-tile
// InstancedMesh with just the part of its API the rest of the code uses.
class TileBatch {
  constructor(geometry, material, count){
    this.isTileBatch = true;
    this.geometry = geometry; this.material = material; this.count = count;
    this.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
    this._v = -1;          // instanceMatrix.version last copied into the pool
  }
  setMatrixAt(i, m){ m.toArray(this.instanceMatrix.array, i * 16); }
  getMatrixAt(i, m){ m.fromArray(this.instanceMatrix.array, i * 16); }
}

// The drawn side: one InstancedMesh per (geometry, material), sized to hold
// every instance of it, of which only the visible tiles' are copied in.
const pools = new Map();
function poolFor(geometry, material){
  const k = geometry.uuid + '|' + material.uuid;
  let p = pools.get(k);
  if (!p){ p = { geometry, material, members: [], mesh: null, dirty: true }; pools.set(k, p); }
  return p;
}
// Sized to what's drawn, not to every instance in the world (that was 35 MB at
// 3200u): starts small and grows by half again whenever a refill needs more.
function buildPool(p, need){
  if (p.mesh){ poolScene.remove(p.mesh); p.mesh.dispose(); }
  p.mesh = new THREE.InstancedMesh(p.geometry, p.material, Math.max(64, Math.ceil(need * 1.5)));
  p.mesh.frustumCulled = false;       // we chose its instances; the bounds would be stale
  p.mesh.count = 0;
  poolScene.add(p.mesh);
}
// refill a pool from its members whose tile currently draws them
const drawn = (m) => { const t = m.tile; return t.vis && !(m.mode === 'near' && t.isFar) && !(m.mode === 'far' && !t.isFar); };
function fillPool(p){
  let need = 0;
  for (const m of p.members) if (drawn(m)) need += m.batch.count;
  if (!p.mesh || p.mesh.instanceMatrix.count < need) buildPool(p, need);
  const dst = p.mesh.instanceMatrix.array;
  let n = 0;
  for (const m of p.members){
    if (!drawn(m)) continue;
    const b = m.batch;
    dst.set(b.instanceMatrix.array.subarray(0, b.count * 16), n * 16);
    n += b.count;
  }
  p.mesh.count = n;
  p.mesh.instanceMatrix.clearUpdateRanges();
  p.mesh.instanceMatrix.addUpdateRange(0, n * 16);
  p.mesh.instanceMatrix.needsUpdate = true;
  p.dirty = false;
}

// Register a tile for culling. The bounding sphere is built from the spread of
// the entries plus the tallest thing standing on them, so it covers the canopy
// and not just the ground positions.
// `meshes` are TileBatches (pooled) or plain Meshes (shown/hidden as a whole,
// e.g. the merged redwood shadows). `farGeos` (parallel) gives each batch a
// far-LOD geometry drawn from the same matrices (so chop() hides both). A null
// entry means "hide at distance" (acorns); undefined means no LOD for it.
function registerTile(scene, meshes, entries, geos, farGeos = []){
  poolScene = scene;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, maxSc = 0;
  let y0 = Infinity, y1 = -Infinity;            // the ground under the entries — on a hillside
  for (const e of entries){                     // a tile's plants span tens of units of height
    if (e[0] < x0) x0 = e[0]; if (e[0] > x1) x1 = e[0];
    if (e[1] < z0) z0 = e[1]; if (e[1] > z1) z1 = e[1];
    const gy = height(e[0], e[1]);
    if (gy < y0) y0 = gy; if (gy > y1) y1 = gy;
    const sc = typeof e[3] === 'number' ? e[3] : 1;
    if (sc > maxSc) maxSc = sc;
  }
  let geoR = 0;
  for (const g of geos){
    if (!g) continue;
    if (!g.boundingSphere) g.computeBoundingSphere();
    geoR = Math.max(geoR, g.boundingSphere.radius);
  }
  // enclose the box of ground points, grown by the tallest thing standing on them
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
  const r = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + geoR * Math.max(maxSc, 1) + 2;
  const sphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
  // how far the tile's trunks reach from its centre — LOD goes by the nearest trunk
  const reach = Math.hypot(x1 - x0, z1 - z0) / 2;
  const tile = { batches: [], plain: [], sphere, reach, vis: false, isFar: false };
  meshes.forEach((m, i) => {
    if (!m) return;
    if (!m.isTileBatch){ m.frustumCulled = false; m.visible = false; tile.plain.push(m); return; }
    // member modes: 'near' draws when close, 'far' when distant, 'always' either way
    const fg = farGeos[i];
    const near = poolFor(m.geometry, m.material);
    near.members.push({ tile, batch: m, mode: fg === undefined ? 'always' : 'near' });
    const ps = [near];
    if (fg){                                       // far twin: same matrices, cheaper geometry
      const far = poolFor(fg, m.material);
      far.members.push({ tile, batch: m, mode: 'far' });
      ps.push(far);
    }
    tile.batches.push({ batch: m, pools: ps });
  });
  floraTiles.push(tile);
  const ck = Math.floor(cx / CELL) + ',' + Math.floor(cz / CELL);
  let c = cells.get(ck);
  if (!c){ c = { tiles: [], sphere: new THREE.Sphere() }; cells.set(ck, c); }
  c.tiles.push(tile);
  cellsDirty = true;
}

// each block's sphere encloses its tiles' spheres (built once, after planting)
function buildCells(){
  for (const c of cells.values()){
    const b = new THREE.Box3();
    for (const t of c.tiles) b.union(new THREE.Box3().setFromCenterAndSize(t.sphere.center,
      new THREE.Vector3(1, 1, 1).multiplyScalar(t.sphere.radius * 2)));
    b.getBoundingSphere(c.sphere);
  }
  cellsDirty = false;
}

const _cullFrustum = new THREE.Frustum();
const _cullMtx = new THREE.Matrix4();

// how many flora tiles survived the last cull, out of how many exist (perf probe)
export function floraTilesDrawn(){
  let vis = 0, far = 0;
  for (const t of floraTiles) if (t.vis){ vis++; if (t.isFar) far++; }
  return `${vis}/${floraTiles.length} (${far} far)`;
}
// for tools/probes: the tiles and what they hold
export function floraDebug(){ return { tiles: floraTiles, pools: [...pools.values()], cells: [...cells.values()] }; }

// set a tile's state; mark the pools that must refill if it changed
function setTile(t, vis, isFar){
  if (t.vis === vis && t.isFar === isFar){
    if (vis) for (const tb of t.batches)             // chop()/trails changed its matrices?
      if (tb.batch.instanceMatrix.version !== tb.batch._v){ tb.batch._v = tb.batch.instanceMatrix.version; for (const p of tb.pools) p.dirty = true; }
    return;
  }
  t.vis = vis; t.isFar = isFar;
  for (const tb of t.batches){ tb.batch._v = tb.batch.instanceMatrix.version; for (const p of tb.pools) p.dirty = true; }
  for (const m of t.plain) m.visible = vis;
}

// Decide which flora tiles draw, and at which LOD. Called once a frame from
// main.js with the fog's far distance.
export function cullFlora(camera, maxDist, enabled = true){
  if (cellsDirty) buildCells();
  if (!enabled){    // dev: show the whole world's flora, to measure what culling saves
    for (const t of floraTiles) setTile(t, true, false);
  } else {
    // the camera has already been moved for this frame but three.js only refreshes
    // these during render, so bring them up to date or we'd cull last frame's view
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    _cullMtx.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _cullFrustum.setFromProjectionMatrix(_cullMtx);
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of cells.values()){
      const cc = c.sphere.center;
      const cvis = Math.hypot(cc.x - cx, cc.z - cz) - c.sphere.radius < maxDist && _cullFrustum.intersectsSphere(c.sphere);
      for (const t of c.tiles){
        if (!cvis){ if (t.vis) setTile(t, false, false); continue; }
        const s = t.sphere.center;
        const d = Math.hypot(s.x - cx, s.z - cz);
        const vis = d - t.sphere.radius < maxDist && _cullFrustum.intersectsSphere(t.sphere);
        setTile(t, vis, vis && d - t.reach > lodDist);
      }
    }
  }
  for (const p of pools.values()) if (p.dirty) fillPool(p);
}

function buildArchetypes(rng, speciesList, atlas){
  // carry the species name through: the mycelium layer needs to know what kind of
  // tree stands where (guilds differ by species — see js/mycelium.js)
  return speciesList.map(sp => ({ ...generateTree(fork(rng), sp, atlas), name: sp.name }));
}

// Place `count` instances on allowed terrain, bucketed by archetype.
// `choose(x,z,rng)` returns which archetype index to use at a spot.
// Returns the list of [x,z] actually planted (so callers can shade the ground
// beneath them and keep grass from growing under the canopy).
const ZERO_MTX = new THREE.Matrix4().makeScale(0, 0, 0);

// `allowed` is a Set of surface types, or a (x, z) => bool for anything finer.
// `coverK` (0..1) is how much the habitat's tree cover decides where they take
// hold: 1 puts nearly all of them in woodland and carr, 0 ignores it.
function scatter(scene, rng, archetypes, barkMat, leafMat, count, allowed, scaleRange, choose, extraMat, collect, flareR = 1.4, coverK = 0.95){
  const buckets = archetypes.map(() => []);
  const placed = [];
  for (let i = 0; i < count; i++){
    let x, z, ok = false;
    for (let t = 0; t < 60 && !ok; t++){
      x = (rng() - 0.5) * WORLD_R * 2; z = (rng() - 0.5) * WORLD_R * 2;
      if (Math.hypot(x, z) < WORLD_R && (typeof allowed === 'function' ? allowed(x, z) : allowed.has(terrainType(x, z)))
          && (!coverK || rng() < 1 - coverK * (1 - treeCover(x, z)))) ok = true;
    }
    if (!ok) continue;
    const ai = choose ? choose(x, z, rng) : Math.floor(rng() * archetypes.length);
    const sc = rand(rng, scaleRange[0], scaleRange[1]);
    buckets[ai].push([x, z, rand(rng, 0, Math.PI*2), sc]);
    // entries stay [x, z, …]: every consumer destructures the first two, so the
    // trailing scale + species + trunk metrics ride along for the mycelium/face layer
    placed.push([x, z, sc, archetypes[ai].name, archetypes[ai].trunkR, archetypes[ai].trunkH]);
  }

  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  buckets.forEach((list, ai) => {
    if (!list.length) return;
    const { branchGeo, leafGeo, acornGeo } = archetypes[ai];
    // one set of meshes per spatial tile rather than one for the whole world, so
    // the trees you are nowhere near never reach the GPU (see cullFlora)
    for (const tile of tileEntries(list).values()){
      const trunks = new TileBatch(branchGeo, barkMat, tile.length);
      const leaves = leafGeo ? new TileBatch(leafGeo, leafMat, tile.length) : null;
      const nuts = (acornGeo && extraMat) ? new TileBatch(acornGeo, extraMat, tile.length) : null;
      tile.forEach(([x, z, yaw, sc], i) => {
        q.setFromAxisAngle(UP, yaw);
        // sink the base into a slope so the downhill root flare reaches soil rather
        // than floating (and the uphill side buries into the bank) — 60% of the
        // measured drop, so gentle ground is barely touched. Flat ground => 0.
        const sink = groundSink(x, z, flareR * sc) * 0.6;
        v.set(x, height(x, z) - sink, z);
        mtx.compose(v, q, new THREE.Vector3(sc, sc, sc));
        trunks.setMatrixAt(i, mtx);
        if (leaves) leaves.setMatrixAt(i, mtx);
        if (nuts) nuts.setMatrixAt(i, mtx);
        if (collect){            // a removable record: chop() hides this instance
          collect.push({ x, z, r: 0.7, alive: true,
            chop(){
              if (!this.alive) return; this.alive = false;
              trunks.setMatrixAt(i, ZERO_MTX); trunks.instanceMatrix.needsUpdate = true;
              if (leaves){ leaves.setMatrixAt(i, ZERO_MTX); leaves.instanceMatrix.needsUpdate = true; }
            } });
        }
      });
      registerTile(scene, [trunks, leaves, nuts], tile, [branchGeo, leafGeo, acornGeo],
        [archetypes[ai].branchGeoFar, archetypes[ai].leafGeoFar, null]);
    }
  });
  return placed;
}

// A spatial hash of [x, z, radius] spots, for "is this point under a tree?"
// queries and ground shading. Cell size must be >= the largest radius.
function spotGrid(spots, cell = 8){
  const grid = new Map();
  for (const s of spots){
    const k = Math.floor(s[0]/cell) + ',' + Math.floor(s[1]/cell);
    let a = grid.get(k); if (!a){ a = []; grid.set(k, a); }
    a.push(s);
  }
  // strongest overlap influence at (x,z): 1 at a spot centre, 0 at its edge
  return (x, z) => {
    const cx = Math.floor(x/cell), cz = Math.floor(z/cell);
    let t = 0;
    for (let gx = cx-1; gx <= cx+1; gx++) for (let gz = cz-1; gz <= cz+1; gz++){
      const a = grid.get(gx + ',' + gz); if (!a) continue;
      for (const s of a){
        const ti = 1 - Math.hypot(x - s[0], z - s[1]) / s[2];
        if (ti > t) t = ti;
      }
    }
    return t;
  };
}

// Paint the ground beneath trees a leaf-litter brown — the canopy shades out the
// grass, so the duff shows instead. `influence` comes from spotGrid.
function shadeGroundUnderTrees(ground, influence){
  const col = ground.color, n = col.length / 3;
  const duff = [0.30 * 255, 0.25 * 255, 0.16 * 255];   // ground.color is bytes
  for (let i = 0; i < n; i++){
    const t = influence(ground.x(i), ground.z(i));
    if (t <= 0) continue;
    const k = Math.min(1, t * 1.25);                  // fully duff a touch inside the edge
    for (let j = 0; j < 3; j++) col[i*3+j] = lerp(col[i*3+j], duff[j], k);
  }
  ground.touchAll(); ground.upload();
}

// crossed quads (an "X" from above) so a tuft reads from every angle, base at y=0
function grassCard(w, h){
  const a = new THREE.PlaneGeometry(w, h); a.translate(0, h/2, 0);
  const b = a.clone(); b.rotateY(Math.PI/2);
  return mergeGeometries([a, b], false);
}

// like grassCard but hangs DOWN from y=0 (attachment at top, tips trail below)
function vineCard(w, h){
  const a = new THREE.PlaneGeometry(w, h); a.translate(0, -h/2, 0);
  const b = a.clone(); b.rotateY(Math.PI/2);
  return mergeGeometries([a, b], false);
}

// Scatter grass tufts where `place(rng)` returns a spot, GPU-instanced and cut
// into flora tiles so they cull with the trees (world-spanning, they were ~120k
// triangles drawn wherever you looked once the world reached 1600u).
// Returns [{ inst, items }], one per tile, where items[k] = { x, z, m } is the
// world position and original matrix of instance k — so trails can hide tufts
// on worn ground.
function scatterGrass(scene, rng, geo, mat, count, place){
  const q = new THREE.Quaternion();
  const spots = [];
  for (let i = 0; i < count; i++){
    const spot = place(rng); if (!spot) continue;
    const [x, z, sc] = spot;
    q.setFromAxisAngle(UP, rng() * Math.PI*2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z), z), q, new THREE.Vector3(sc, sc, sc));
    spots.push([x, z, m, sc]);
  }
  const groups = [];
  for (const tile of tileEntries(spots).values()){
    const inst = new TileBatch(geo, mat, tile.length);
    const items = tile.map(([x, z, m], k) => { inst.setMatrixAt(k, m); return { x, z, m }; });
    registerTile(scene, [inst], tile, [geo]);
    groups.push({ inst, items });
  }
  return groups;
}

// random points within a canopy bbox, between lowFrac..highFrac of its height
function fruitPositions(bb, n, lowFrac, highFrac, rng){
  const cx = (bb.min.x + bb.max.x)/2, cz = (bb.min.z + bb.max.z)/2;
  const rx = (bb.max.x - bb.min.x)*0.42, rz = (bb.max.z - bb.min.z)*0.42;
  const y0 = lerp(bb.min.y, bb.max.y, lowFrac), y1 = lerp(bb.min.y, bb.max.y, highFrac);
  const out = [];
  for (let i = 0; i < n; i++){
    const a = rng()*Math.PI*2, r = Math.sqrt(rng());
    out.push(new THREE.Vector3(cx + Math.cos(a)*rx*r, lerp(y0, y1, rng()), cz + Math.sin(a)*rz*r));
  }
  return out;
}

// Camera-facing InstancedMesh for fruit/berries — one unit plane per spot,
// matrices updated each frame by billboard(camQ) to always face the player.
const FRUIT_CARD = new THREE.PlaneGeometry(1, 1);   // shared by every fruit cluster
function makeFruitInst(mat, spots, size){
  const inst = new THREE.InstancedMesh(FRUIT_CARD, mat, spots.length);
  inst.frustumCulled = false;
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3(size, size, size);
  const _q = new THREE.Quaternion();
  for (let i = 0; i < spots.length; i++){
    _m.compose(spots[i], _q, _s);
    inst.setMatrixAt(i, _m);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

// The shared forageable: a placed group with one harvestable mesh that toggles
// off when picked (E) and back on after `regrow`. A single visibility flip.
function forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng, fruitSpots = null, fruitSize = 1, basicMat = false }){
  grp.add(harvest);
  grp.position.set(x, height(x, z), z);
  scene.add(grp);
  return {
    x, z, kind, ripe: true, timer: 0,
    grp,                                      // so the per-frame pass can hide the whole plant when it's out of sight
    mat: basicMat ? harvest.material : null,  // non-null only for MeshBasicMaterial items that need sky tinting
    tick(dt){ if (!this.ripe){ this.timer -= dt; if (this.timer <= 0){ this.ripe = true; harvest.visible = true; } } },
    collect(){
      if (!this.ripe) return 0;
      this.ripe = false; harvest.visible = false; this.timer = regrow;
      return randint(rng, yieldRange[0], yieldRange[1]);
    },
    billboard(camQ){
      if (!fruitSpots || !this.ripe) return;
      _bbS.setScalar(fruitSize);
      for (let i = 0; i < fruitSpots.length; i++){
        _bbM.compose(fruitSpots[i], camQ, _bbS);
        harvest.setMatrixAt(i, _bbM);
      }
      harvest.instanceMatrix.needsUpdate = true;
    },
  };
}

// A bush/tree forageable: a generated body (bark + leaves) carrying a fruit/nut
// cluster up in the canopy.
function makePlant(scene, rng, { x, z, body, barkMat, leafMat, fruitMat, fruitSpots, fruitSize, kind, yieldRange, regrow }){
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(body.branchGeo, barkMat));
  if (body.leafGeo) grp.add(new THREE.Mesh(body.leafGeo, leafMat));
  const harvest = makeFruitInst(fruitMat, fruitSpots, fruitSize);
  return forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng, fruitSpots, fruitSize });
}

// A scatter of camera-facing cards on the ground (y ≈ size/2 up), jittered within `spread`.
function cardCluster(n, size, spread, rng){
  const out = [];
  for (let i = 0; i < n; i++){
    const a = rng()*Math.PI*2, r = spread * Math.sqrt(rng());
    out.push(new THREE.Vector3(Math.cos(a)*r, size * 0.5, Math.sin(a)*r));
  }
  return out;
}

// A low ground forageable: nuts, roots, mushrooms — no woody body, just a small
// harvestable cluster of cards on the earth.
function makeGroundFood(scene, rng, { x, z, n, size, spread, mat, kind, yieldRange, regrow }){
  const grp = new THREE.Group();
  const spots = cardCluster(n, size, spread, rng);
  const harvest = makeFruitInst(mat, spots, size);
  return forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng, fruitSpots: spots, fruitSize: size });
}

// Counts are per 800u world (where they were tuned); D() scales them by AREA so
// density holds whatever SIZE is.
const D = (n) => Math.round(n * AREA);
export function plantWorld(scene, rng, { ground = null, trees = D(1280), shrubs = D(1840), redwoods = D(180),
                                         oaks = D(320), grass = D(9600), reeds = D(4000), bushes = D(80), fruitTrees = D(32),
                                         pussywillows = D(1680), cattails = D(2080),
                                         hazels = D(56), daisies = D(120), roots = D(72), mushrooms = D(80), acornPatches = D(64),
                                         cattailRoots = D(48),
                                         shells = D(96), stones = D(120), ambers = D(40), quartzes = D(48),
                                         pines = D(150), alders = D(120), sedges = D(6000), cottongrass = D(2500), heather = D(9000) } = {}){
  const atlas = makeLeafAtlas(fork(rng));
  const bark  = makeBark(fork(rng));

  const barkMat = new THREE.MeshLambertMaterial({ map: bark });
  const leafMat = leafMaterial({ map: atlas.texture });   // crown-lit (see tree.js)

  const treeArch    = buildArchetypes(rng, TREE_SPECIES, atlas);   // [rich, mid, lean]
  const shrubArch   = buildArchetypes(rng, SHRUB_SPECIES, atlas);
  // redwoodArch built below with the conifer atlas, after coniferAtlas is created

  // oaks have their own round-lobed leaves, acorns, and a broad gnarled form
  const oakAtlas   = makeLeafAtlas(fork(rng), { kind: 'oak' });
  const oakLeafMat = leafMaterial({ map: oakAtlas.texture });
  const acornMat   = new THREE.MeshLambertMaterial({ map: makeAcornTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const oakArch    = buildArchetypes(rng, OAK_SPECIES, oakAtlas);

  // form follows soil: rich moist ground grows broad maples, dry/high grows lean
  const bySoil = (x, z) => { const r = soilRichness(x, z); return r > 0.62 ? 0 : r > 0.4 ? 1 : 2; };

  // wide per-instance scale ranges so heights form a continuum (saplings up to
  // giants) rather than clustering around each archetype's set height
  const treePos = scatter(scene, fork(rng), treeArch,    barkMat, leafMat, trees,    new Set(['grass','mud']),        [0.55, 1.55], bySoil);
  const shrubRecs = [];   // removable: each shrub can be chopped down for firewood
  scatter(scene, fork(rng), shrubArch,   barkMat, leafMat, shrubs,   new Set(['grass','mud','sand']), [0.65, 1.5], null, null, shrubRecs, 0.6, 0.6);   // shrubs edge out into the open
  const redwoodBarkMat  = new THREE.MeshLambertMaterial({ map: makeRedwoodBark(fork(rng)) });
  // flat horizontal disc foliage — leafStyle:'flat' ignores the atlas entirely,
  // so pass a dummy; the material uses the blob texture directly.
  const redwoodFoliageMat = new THREE.MeshLambertMaterial({ map: makeRedwoodFoliageTexture({ seed: fork(rng) }), alphaTest: 0.35, side: THREE.DoubleSide });
  const dummyAtlas      = { texture: null, cols: 1, rows: 1, count: 1 };
  const redwoodArch     = buildArchetypes(rng, REDWOOD_SPECIES, dummyAtlas);
  const redwoodPos = scatter(scene, fork(rng), redwoodArch, redwoodBarkMat, redwoodFoliageMat, redwoods,
    (x, z) => habitat(x, z) === 'grove', [0.7, 1.35], null, null, null, 3.0, 0);   // only in the old-growth stands

  // blob shadows: terrain-conforming shadow patches under each redwood.
  // Each blob is a subdivided grid whose vertices are displaced to the terrain
  // height, so the shadow hugs uneven ground instead of clipping through it.
  // Blobs are merged per flora tile and culled with the trees: one merged mesh
  // for the whole world was 144k triangles drawn wherever you looked.
  {
    const bc = document.createElement('canvas'); bc.width = bc.height = 64;
    const bg = bc.getContext('2d');
    const gr = bg.createRadialGradient(32, 32, 1, 32, 32, 32);
    gr.addColorStop(0,    'rgba(0,0,0,0.72)');
    gr.addColorStop(0.40, 'rgba(0,0,0,0.55)');
    gr.addColorStop(0.72, 'rgba(0,0,0,0.25)');
    gr.addColorStop(1,    'rgba(0,0,0,0)');
    bg.fillStyle = gr; bg.fillRect(0, 0, 64, 64);
    const blobTex = new THREE.CanvasTexture(bc);
    const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
    const blobFoot = new THREE.PlaneGeometry(19, 19);   // the widest blob, for the tile's cull sphere

    const SEGS = 10, N = SEGS + 1;   // 10×10 quad grid per blob
    // radii drawn in planting order, so the rng stream (and the rest of the world) is unchanged
    const blobs = redwoodPos.map(([cx, cz]) => [cx, cz, (12 + rng() * 7) * 0.5]);   // R = half-width
    for (const tile of tileEntries(blobs).values()){
      const allPos = [], allUV = [], allIdx = [];
      let vOff = 0;
      for (const [cx, cz, R] of tile){
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
          const u = i / SEGS, v = j / SEGS;
          const wx = cx + (u - 0.5) * R * 2, wz = cz + (v - 0.5) * R * 2;
          allPos.push(wx, height(wx, wz) + 0.06, wz);
          allUV.push(u, v);
        }
        for (let j = 0; j < SEGS; j++) for (let i = 0; i < SEGS; i++){
          const a = vOff + j*N+i, b = vOff + j*N+i+1, c = vOff + (j+1)*N+i, d = vOff + (j+1)*N+i+1;
          allIdx.push(a, c, b,  b, c, d);
        }
        vOff += N * N;
      }
      const blobGeo = new THREE.BufferGeometry();
      blobGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(allPos), 3));
      blobGeo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(allUV),  2));
      blobGeo.setIndex(allIdx);
      const blobMesh = new THREE.Mesh(blobGeo, blobMat);
      blobMesh.renderOrder = 1;
      registerTile(scene, [blobMesh], tile, [blobFoot]);
      scene.add(blobMesh);
    }
  }
  const oakPos     = scatter(scene, fork(rng), oakArch,     barkMat, oakLeafMat, oaks,  new Set(['grass','mud']),        [0.6, 1.45], null, acornMat, null, 2.4);

  // Scots pine on the heath, alder in the carr — each only in its own habitat.
  // Pine needles reuse the redwood foliage disc, tinted to a pine's grey-green;
  // its bark is the redwood's, warmed toward the orange of an old pine's top.
  const pineArch = buildArchetypes(rng, PINE_SPECIES, dummyAtlas);
  const pineBarkMat = new THREE.MeshLambertMaterial({ map: makeRedwoodBark(fork(rng)), color: new THREE.Color(0.95, 0.80, 0.66) });
  const pineFoliageMat = new THREE.MeshLambertMaterial({ map: makeRedwoodFoliageTexture({ seed: fork(rng) }),
    color: new THREE.Color(0.70, 0.86, 0.80), alphaTest: 0.35, side: THREE.DoubleSide });
  const pinePos = scatter(scene, fork(rng), pineArch, pineBarkMat, pineFoliageMat, pines,
    (x, z) => habitat(x, z) === 'heath', [0.7, 1.25], null, null, null, 1.6, 0);
  const alderArch = buildArchetypes(rng, ALDER_SPECIES, atlas);
  const alderBarkMat = new THREE.MeshLambertMaterial({ map: makeBark(fork(rng)), color: new THREE.Color(0.55, 0.53, 0.52) });
  const alderLeafMat = leafMaterial({ map: atlas.texture, color: new THREE.Color(0.55, 0.72, 0.48) });
  const alderPos = scatter(scene, fork(rng), alderArch, alderBarkMat, alderLeafMat, alders,
    (x, z) => habitat(x, z) === 'carr', [0.7, 1.3], null, null, null, 1.6, 0);

  // litter footprint per tree (big trees cast a wider duff ring than maples)
  const litter = [...treePos.map(([x,z]) => [x, z, 3.6]),
                  ...redwoodPos.map(([x,z]) => [x, z, 5.5]),
                  ...oakPos.map(([x,z]) => [x, z, 4.8]),
                  ...pinePos.map(([x,z]) => [x, z, 3.2]),
                  ...alderPos.map(([x,z]) => [x, z, 3.6])];
  const underTree = spotGrid(litter);
  if (ground) shadeGroundUnderTrees(ground, underTree);

  // --- birch: pioneer species, grow in tight clumps on open/disturbed ground ---
  // Placed AFTER underTree is computed so we can actively avoid existing canopy shade.
  // Cluster centres are found on open ground (low underTree); individual trees scatter
  // around each centre with a uniform-disc distribution (sqrt for even spread).
  const birchArch    = buildArchetypes(rng, BIRCH_SPECIES, atlas);
  const birchBarkMat = new THREE.MeshLambertMaterial({ map: makeBirchBark(fork(rng)) });
  const birchLeafMat = leafMaterial({ map: atlas.texture, color: new THREE.Color(0.82, 1.0, 0.68) });
  const BIRCH_CLUSTERS = D(56), CLUSTER_R = 9;
  const birchCenters = [];
  for (let i = 0; i < BIRCH_CLUSTERS * 8 && birchCenters.length < BIRCH_CLUSTERS; i++){
    const x = (rng() - 0.5) * WORLD_R * 2, z = (rng() - 0.5) * WORLD_R * 2;
    if (Math.hypot(x, z) >= WORLD_R) continue;
    if (!['grass','mud'].includes(terrainType(x, z))) continue;
    if (underTree(x, z) > 0.12) continue;   // open clearing — pioneer species need light
    birchCenters.push([x, z]);
  }
  const birchPos = [];
  for (const [cx, cz] of birchCenters){
    const n = 3 + (rng() * 4 | 0);   // 3–6 per grove
    let placed = 0;
    for (let t = 0; t < n * 6 && placed < n; t++){
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * CLUSTER_R;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.hypot(x, z) >= WORLD_R) continue;
      if (!['grass','mud'].includes(terrainType(x, z))) continue;
      if (underTree(x, z) > 0.28) continue;   // can be near a forest edge but not in shade
      birchPos.push([x, z]);
      placed++;
    }
  }
  // instance the birch groves
  {
    const bkts = birchArch.map(() => []);
    for (const rec of birchPos){
      const [x, z] = rec;
      const sc = rand(rng, 0.6, 1.3);
      rec[2] = sc;                       // record the age alongside the position
      bkts[rng() * birchArch.length | 0].push([x, z, rand(rng, 0, Math.PI*2), sc]);
    }
    const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bv = new THREE.Vector3(), bs = new THREE.Vector3();
    for (let ai = 0; ai < birchArch.length; ai++){
      const list = bkts[ai]; if (!list.length) continue;
      const { branchGeo, leafGeo, branchGeoFar, leafGeoFar } = birchArch[ai];
      for (const tile of tileEntries(list).values()){
        const trunks = new TileBatch(branchGeo, birchBarkMat, tile.length);
        const leaves = leafGeo ? new TileBatch(leafGeo, birchLeafMat, tile.length) : null;
        tile.forEach(([x, z, yaw, sc], i) => {
          bq.setFromAxisAngle(UP, yaw);
          bv.set(x, height(x, z) - groundSink(x, z, 1.2 * sc) * 0.6, z);
          bm.compose(bv, bq, bs.setScalar(sc));
          trunks.setMatrixAt(i, bm); if (leaves) leaves.setMatrixAt(i, bm);
        });
        registerTile(scene, [trunks, leaves], tile, [branchGeo, leafGeo], [branchGeoFar, leafGeoFar]);
      }
    }
  }

  // --- rowan: small forest-edge trees, shade-intolerant, individual or pairs ---
  // Grow where canopy is partial (underTree 0.08–0.40) — forest margins and
  // clearings edges. Greyer and lighter than maple; no prominent surface roots.
  const rowanArch    = buildArchetypes(rng, ROWAN_SPECIES, atlas);
  const rowanBarkMat = new THREE.MeshLambertMaterial({ map: makeRowanBark(fork(rng)) });
  const rowanLeafMat = leafMaterial({ map: atlas.texture, color: new THREE.Color(0.78, 0.95, 0.60) });
  const rowanPos = [];
  {
    const rm = new THREE.Matrix4(), rq = new THREE.Quaternion(), rv = new THREE.Vector3(), rs = new THREE.Vector3();
    const bkts = rowanArch.map(() => []);
    for (let i = 0; i < D(1280); i++){    // try 1280 times (per 800u world) to place ~400 rowans
      const x = (rng() - 0.5) * WORLD_R * 2, z = (rng() - 0.5) * WORLD_R * 2;
      if (Math.hypot(x, z) >= WORLD_R) continue;
      if (!['grass','mud','rock'].includes(terrainType(x, z))) continue;
      const u = underTree(x, z);
      if (u < 0.08 || u > 0.42) continue;   // forest edge — partial light
      const rsc = rand(rng, 0.65, 1.2);
      rowanPos.push([x, z, rsc]);
      bkts[rng() * rowanArch.length | 0].push([x, z, rand(rng, 0, Math.PI*2), rsc]);
    }
    for (let ai = 0; ai < rowanArch.length; ai++){
      const list = bkts[ai]; if (!list.length) continue;
      const { branchGeo, leafGeo, branchGeoFar, leafGeoFar } = rowanArch[ai];
      for (const tile of tileEntries(list).values()){
        const trunks = new TileBatch(branchGeo, rowanBarkMat, tile.length);
        const leaves = leafGeo ? new TileBatch(leafGeo, rowanLeafMat, tile.length) : null;
        tile.forEach(([x, z, yaw, sc], i) => {
          rq.setFromAxisAngle(UP, yaw);
          rv.set(x, height(x, z) - groundSink(x, z, sc) * 0.6, z);
          rm.compose(rv, rq, rs.setScalar(sc));
          trunks.setMatrixAt(i, rm); if (leaves) leaves.setMatrixAt(i, rm);
        });
        registerTile(scene, [trunks, leaves], tile, [branchGeo, leafGeo], [branchGeoFar, leafGeoFar]);
      }
    }
  }

  // --- hanging vines: drape from the lower canopy of large trees ---
  // Crossed vertical billboard cards (vineCard) hanging from branch height, using
  // an alpha-cutout texture of painted strands — same trick as the reference image.
  // Redwoods and oaks get vines preferentially; ~25% of regular trees also get some.
  {
    const vineMat = new THREE.MeshLambertMaterial({
      map: makeVineTexture({ seed: fork(rng) }), alphaTest: 0.4, side: THREE.DoubleSide,
    });
    const vGeo = vineCard(2.0, 4.2);
    const hosts = [
      ...redwoodPos.map(([x, z]) => [x, z, 1.0]),
      ...oakPos.map(([x, z])     => [x, z, 0.9]),
      ...treePos.filter(() => rng() < 0.28).map(([x, z]) => [x, z, 0.75]),
    ];
    // placed in one pass (same rng order as ever), then cut into flora tiles
    const vines = [];   // [x, z, matrix, scale]
    const vq = new THREE.Quaternion(), vv = new THREE.Vector3(), vs = new THREE.Vector3();
    for (const [tx, tz, baseSc] of hosts){
      const clusters = 1 + (rng() < 0.55 ? 1 : 0);   // 1–2 clusters per host
      for (let c = 0; c < clusters; c++){
        const a = rng() * Math.PI * 2, r = 0.15 + rng() * 0.55;
        const vx = tx + Math.cos(a) * r, vz = tz + Math.sin(a) * r;
        const vy = height(vx, vz) + 3.8 + rng() * 2.2;   // attach near branch level
        vq.setFromAxisAngle(UP, rng() * Math.PI * 2);
        vv.set(vx, vy, vz);
        const sc = baseSc * (0.75 + rng() * 0.5);
        vs.set(sc, sc * (0.8 + rng() * 0.45), sc);        // vary drop length more than width
        vines.push([vx, vz, new THREE.Matrix4().compose(vv, vq, vs), sc]);
      }
    }
    for (const tile of tileEntries(vines).values()){
      const vInst = new TileBatch(vGeo, vineMat, tile.length);
      tile.forEach(([, , m], k) => vInst.setMatrixAt(k, m));
      registerTile(scene, [vInst], tile, [vGeo]);
    }
  }

  // --- ferns: carpet the dappled shade under tree canopies ---
  const fernMat = new THREE.MeshLambertMaterial({
    map: makeFernTexture({ seed: fork(rng) }), alphaTest: 0.45, side: THREE.DoubleSide,
  });
  const fernGeo = grassCard(3.8, 2.6);
  const inShade = (rng) => {
    for (let t = 0; t < 12; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      if (!['grass','mud'].includes(terrainType(x, z))) continue;
      const u = underTree(x, z);
      if (u < 0.08 || u > 0.92) continue;
      return [x, z, 1.0 + rng() * 1.0];
    }
    return null;
  };
  const ferns = scatterGrass(scene, fork(rng), fernGeo, fernMat, D(1400), inShade);

  // --- ground cover: reeds in the swampy mud (meadow grass is drawn by GrassDetail in grass.js) ---
  const reedMat = new THREE.MeshLambertMaterial({
    map: makeGrassTexture({ seed: rng, tall: true, blades: 6 }), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const reedGeo = grassCard(1.1, 2.2);

  const inSwamp = (rng) => {                       // reedy wet mud near the water
    for (let t = 0; t < 8; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      if (terrainType(x, z) !== 'mud') continue;
      return [x, z, 0.85 + rng()*0.8];
    }
    return null;
  };

  const reedGrass = scatterGrass(scene, fork(rng), reedGeo, reedMat, reeds, inSwamp);

  // --- habitat ground cover: sedge in the fen and carr, cotton grass in the
  // fen, heather on the heath. Placed by habitat, tiled and culled like reeds.
  const inHabitat = (kinds, s0, s1, tries = 10) => (rng) => {
    for (let t = 0; t < tries; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      if (!kinds.includes(habitat(x, z))) continue;
      return [x, z, s0 + rng() * (s1 - s0)];
    }
    return null;
  };
  const cardMat = (map) => new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  const sedgeGroups = scatterGrass(scene, fork(rng), grassCard(1.5, 1.1), cardMat(makeSedgeTexture({ seed: fork(rng) })),
    sedges, inHabitat(['fen', 'carr'], 0.7, 1.4));
  const cottonGroups = scatterGrass(scene, fork(rng), grassCard(0.9, 1.2), cardMat(makeCottonGrassTexture({ seed: fork(rng) })),
    cottongrass, inHabitat(['fen'], 0.7, 1.2));
  const heatherGroups = scatterGrass(scene, fork(rng), grassCard(2.1, 1.0), cardMat(makeHeatherTexture({ seed: fork(rng) })),
    heather, inHabitat(['heath'], 0.7, 1.5));   // ~one cushion per 3 m² of heath

  // --- waterside plants: pussywillows & cattails right along the shoreline ---
  const pussyMat = new THREE.MeshLambertMaterial({
    map: makePussywillowTexture({ seed: rng }), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const cattailMat = new THREE.MeshLambertMaterial({
    map: makeCattailTexture({ seed: rng }), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const pussyGeo   = grassCard(1.5, 2.4);
  const cattailGeo = grassCard(1.2, 2.9);
  const atWaterEdge = (rng) => {                  // shoreline, dipping a little into the shallows
    for (let t = 0; t < 14; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      const hy = height(x, z);
      if (hy < WATER - 0.6 || hy > WATER + 1.6) continue;
      return [x, z, 0.8 + rng()*0.6];
    }
    return null;
  };
  scatterGrass(scene, fork(rng), pussyGeo,   pussyMat,   pussywillows, atWaterEdge);
  scatterGrass(scene, fork(rng), cattailGeo, cattailMat, cattails,     atWaterEdge);

  // --- forageable plants: berry bushes & fruit trees, picked with the E key ---
  // Sprites from fruit.png atlas: 38 cols × 6 rows, each 16×16 px.
  // UV: repeat=(1/38, 1/6), offset=(col/38, (5-row)/6)  [row 0 = top of image]
  const _fruitAtlasTex = (() => {
    const t = new THREE.TextureLoader().load('fruit.png');
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const fruitSprite = (col, row = 0) => {
    const t = _fruitAtlasTex.clone();
    t.repeat.set(1/38, 1/6);
    t.offset.set(col/38, (5 - row)/6);
    t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.1, side: THREE.DoubleSide });
  };
  const fruitMats = {
    red:   fruitSprite(14),   // red cherry cluster
    blue:  fruitSprite(16),   // blueberry cluster
    apple: fruitSprite(0),    // red apple
  };
  const frng = fork(rng);
  const plants = [];
  const landSpot = (allowed) => {
    for (let t = 0; t < 40; t++){
      const x = (frng()-0.5)*WORLD_R*2, z = (frng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) < WORLD_R && allowed.has(terrainType(x, z))) return [x, z];
    }
    return null;
  };

  // Bodies come from a few shared variants per kind: generating one per plant
  // was ~2,700 unique meshes at 3200u (and most of the boot's tree-growing).
  const VARIANTS = 6;
  const variants = (spec) => Array.from({ length: VARIANTS }, () => {
    const b = generateTree(fork(frng), spec, atlas); b.leafGeo.computeBoundingBox(); return b; });
  const pickBody = (vs) => vs[frng() * vs.length | 0];
  const bushBodies = variants({ ...SHRUB_SPECIES[0], targetHeight: 1.5 });
  const appleBodies = variants({ ...TREE_SPECIES[1], targetHeight: 6, leavesPerTip: 14 });
  const hazelBodies = variants({ ...SHRUB_SPECIES[0], targetHeight: 1.7 });
  for (let i = 0; i < bushes; i++){                          // waist-high berry bushes
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = pickBody(bushBodies);
    const berryMat = frng() < 0.5 ? fruitMats.red : fruitMats.blue;
    const fruitSpots = fruitPositions(body.leafGeo.boundingBox, 12, 0.2, 0.95, frng);
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: berryMat, fruitSpots, fruitSize: 0.22, kind: 'berries', yieldRange: [2, 4], regrow: 24 }));
  }
  for (let i = 0; i < fruitTrees; i++){                      // small apple trees
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = pickBody(appleBodies);
    const fruitSpots = fruitPositions(body.leafGeo.boundingBox, 10, 0.45, 0.95, frng);
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: fruitMats.apple, fruitSpots, fruitSize: 0.5, kind: 'apples', yieldRange: [1, 2], regrow: 40 }));
  }

  // --- a hunter-gatherer's larder: not just berries. See docs/forage.md. ---
  // Real foragers live mostly on gathered plants — starchy roots, storable nuts,
  // fungi, wetland tubers — so each food grows where it actually would.
  const hazelMat   = fruitSprite(19);   // brown round fruit (hazelnut)
  const mushMats   = [makeMushroomTexture([150, 60, 44]), makeMushroomTexture([176, 132, 70])]
    .map(t => new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));

  for (let i = 0; i < hazels; i++){                          // hazelnut bushes (woodland)
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = pickBody(hazelBodies);
    const fruitSpots = fruitPositions(body.leafGeo.boundingBox, 9, 0.25, 0.9, frng);
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: hazelMat, fruitSpots, fruitSize: 0.18, kind: 'hazelnuts', yieldRange: [2, 4], regrow: 60 }));
  }
  {                                                           // chamomile daisies (flowers 41 + 13) — gatherable
    const daisyTex41 = (() => { const t = new THREE.TextureLoader().load('flowers/flowers41.png'); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const daisyTex13 = (() => { const t = new THREE.TextureLoader().load('flowers/flowers13.png'); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const daisyMats = [
      new THREE.MeshBasicMaterial({ map: daisyTex41, alphaTest: 0.1, side: THREE.DoubleSide }),
      new THREE.MeshBasicMaterial({ map: daisyTex13, alphaTest: 0.1, side: THREE.DoubleSide }),
    ];
    for (let i = 0; i < daisies; i++){
      const s = landSpot(new Set(['grass'])); if (!s) continue;
      const spots = cardCluster(4, 0.45, 0.6, frng);
      const mat = daisyMats[frng() < 0.5 ? 0 : 1];
      const harvest = makeFruitInst(mat, spots, 0.45);
      plants.push(forageable(scene, new THREE.Group(), harvest, {
        x: s[0], z: s[1], kind: 'chamomile', yieldRange: [1, 2], regrow: 60, rng: frng,
        fruitSpots: spots, fruitSize: 0.45, basicMat: true,
      }));
    }
  }
  for (let i = 0; i < roots; i++){                           // tubers dug from open grassland (the starch staple)
    const s = landSpot(new Set(['grass'])); if (!s) continue;
    plants.push(makeGroundFood(scene, frng, { x: s[0], z: s[1], n: 4, size: 0.55, spread: 0.4,
      mat: leafMat, kind: 'roots', yieldRange: [1, 3], regrow: 50 }));
  }
  for (let i = 0; i < acornPatches; i++){                    // acorns on the ground at an oak's foot (storable)
    const base = oakPos[Math.floor(frng() * oakPos.length)]; if (!base) break;
    const a = frng()*Math.PI*2, r = 1.1 + frng()*1.6;
    const x = base[0] + Math.cos(a)*r, z = base[1] + Math.sin(a)*r;
    if (Math.hypot(x, z) > WORLD_R || !['grass','mud'].includes(terrainType(x, z))) continue;
    plants.push(makeGroundFood(scene, frng, { x, z, n: 6, size: 0.2, spread: 0.5,
      mat: acornMat, kind: 'acorns', yieldRange: [3, 6], regrow: 70 }));
  }
  for (let i = 0; i < mushrooms; i++){                       // mushrooms in the shaded duff under a tree
    const base = treePos[Math.floor(frng() * treePos.length)]; if (!base) break;
    const a = frng()*Math.PI*2, r = 1.6 + frng()*2.6;
    const x = base[0] + Math.cos(a)*r, z = base[1] + Math.sin(a)*r;
    if (Math.hypot(x, z) > WORLD_R || !['grass','mud'].includes(terrainType(x, z))) continue;
    // two fungi: friendly caps (mat 0, safe to eat raw) and morels (mat 1, must be cooked)
    const morel = frng() >= 0.6;
    plants.push(makeGroundFood(scene, frng, { x, z, n: 3 + (frng()*3|0), size: 0.32, spread: 0.45,
      mat: mushMats[morel ? 1 : 0], kind: morel ? 'morels' : 'mushrooms', yieldRange: [1, 3], regrow: 30 }));
  }
  for (let i = 0; i < cattailRoots; i++){                    // cattail/reed roots at the water's edge (wetland staple)
    let s = null;
    for (let t = 0; t < 30 && !s; t++){
      const x = (frng()-0.5)*WORLD_R*2, z = (frng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      const hy = height(x, z);
      if (hy >= WATER && hy <= WATER + 1.1) s = [x, z];
    }
    if (!s) continue;
    plants.push(makeGroundFood(scene, frng, { x: s[0], z: s[1], n: 4, size: 0.5, spread: 0.5,
      mat: leafMat, kind: 'cattail root', yieldRange: [1, 2], regrow: 45 }));
  }

  // --- valuables: rare, non-utilitarian finds (shells, stones, amber, quartz).
  // Gathered like food but kept for their own worth and traded as currency. They
  // reappear only slowly, so they stay scarce. See docs/forage.md / agents.js. ---
  const trinketMats = {
    shell:  new THREE.MeshLambertMaterial({ map: makeTrinketTexture('shell'),  alphaTest: 0.5, side: THREE.DoubleSide }),
    stone:  new THREE.MeshLambertMaterial({ map: makeTrinketTexture('stone'),  alphaTest: 0.5, side: THREE.DoubleSide }),
    amber:  new THREE.MeshLambertMaterial({ map: makeTrinketTexture('amber'),  alphaTest: 0.5, side: THREE.DoubleSide }),
    quartz: new THREE.MeshLambertMaterial({ map: makeTrinketTexture('quartz'), alphaTest: 0.5, side: THREE.DoubleSide }),
  };
  const valuables = [];
  const dropValuable = (x, z, kind, mat) => {
    const v = makeGroundFood(scene, frng,
      { x, z, n: 1, size: kind === 'quartz' ? 0.42 : 0.34, spread: 0.1,
        mat, kind, yieldRange: [1, 1], regrow: 200 });   // slow regrow keeps them rare
    v.valuable = true;                                    // a treasure, not food (for the look-at box)
    valuables.push(v);
  };
  for (let i = 0; i < shells; i++){                          // shells on the sand at the water's edge
    const s = landSpot(new Set(['sand'])); if (s) dropValuable(s[0], s[1], 'shell', trinketMats.shell);
  }
  for (let i = 0; i < stones; i++){                          // interesting stones, anywhere underfoot
    const s = landSpot(new Set(['grass', 'mud', 'rock'])); if (s) dropValuable(s[0], s[1], 'stone', trinketMats.stone);
  }
  for (let i = 0; i < ambers; i++){                          // amber: hardened resin at a tree's foot
    const base = treePos[Math.floor(frng() * treePos.length)]; if (!base) break;
    const a = frng()*Math.PI*2, r = 0.8 + frng()*1.4;
    const x = base[0] + Math.cos(a)*r, z = base[1] + Math.sin(a)*r;
    if (Math.hypot(x, z) < WORLD_R && ['grass', 'mud'].includes(terrainType(x, z))) dropValuable(x, z, 'amber', trinketMats.amber);
  }
  for (let i = 0; i < quartzes; i++){                        // quartz on rocky/high ground
    const s = landSpot(new Set(['rock', 'grass'])); if (s) dropValuable(s[0], s[1], 'quartz', trinketMats.quartz);
  }

  // --- flowers: curated sprite set, each species in its own monospecies patches ---
  // Each flower ID gets PATCHES_PER dedicated patch centres drawn from a shared pool.
  // Flowers only scatter around their own centres, so you see tight same-species clumps.
  const _flowerBillboards = [];
  const flowers = [];   // individual pickable flowers for NPC agents
  {
    const fwrng = fork(rng);
    const PATCHES_PER = D(2); // patch centres per species
    const PER_SPECIES = D(60); // flowers per species
    const PATCH_R     = 4.0;  // patch radius (world units)
    const FLOWER_REGROW = 120; // seconds until a picked flower regrows

    // Curated species list — familiar European/North American wildflowers only
    const SUN_IDS    = [5,7,10,14,27,45,46];  // open meadow
    const DAPPLE_IDS = [16,47,49,53,59,60];      // woodland edge

    const loader = new THREE.TextureLoader();
    const loadTex = (id) => {
      const t = loader.load(`flowers/flowers${id}.png`);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };

    const flowerGeo = new THREE.PlaneGeometry(0.45, 0.45);
    flowerGeo.translate(0, 0.225, 0);

    // Draw up to n valid positions from terrain satisfying `valid`
    const findCenters = (n, valid) => {
      const out = [];
      for (let t = 0; t < n * 10 && out.length < n; t++){
        const x = (fwrng()-0.5)*WORLD_R*2, z = (fwrng()-0.5)*WORLD_R*2;
        if (Math.hypot(x, z) < WORLD_R && valid(x, z)) out.push([x, z]);
      }
      return out;
    };

    // One InstancedMesh for one species scattered around its own patch centres.
    // Each placed flower is also registered in `flowers` as an individually
    // pickable record with alive/remove/tick for the agent system.
    const scatterFlower = (id, count, centers) => {
      if (!centers.length) return;
      const mat  = new THREE.MeshBasicMaterial({ map: loadTex(id), alphaTest: 0.1, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(flowerGeo, mat, count);
      inst.frustumCulled = false;
      const positions = [];
      const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
      let n = 0;
      for (let i = 0; i < count * 4 && n < count; i++){
        const [pcx, pcz] = centers[fwrng() * centers.length | 0];
        const a = fwrng() * Math.PI * 2, r = fwrng() * PATCH_R;
        const x = pcx + Math.cos(a)*r, z = pcz + Math.sin(a)*r;
        if (Math.hypot(x, z) > WORLD_R || terrainType(x, z) !== 'grass') continue;
        const sc = 0.7 + fwrng() * 0.5;
        const pos = new THREE.Vector3(x, height(x, z), z);
        // register as individually-pickable — remove() zeroes the billboard scale
        const idx = n, origSc = sc;
        flowers.push({
          x, z, speciesId: id, alive: true, _timer: 0,
          remove(){ if (!this.alive) return; this.alive = false; positions[idx].sc = 0; this._timer = FLOWER_REGROW; },
          tick(dt){ if (this.alive) return; this._timer -= dt; if (this._timer <= 0){ this.alive = true; positions[idx].sc = origSc; } },
        });
        positions.push({ pos, sc });
        _s.setScalar(sc); _m.compose(pos, _q, _s);
        inst.setMatrixAt(n++, _m);
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
      _flowerBillboards.push({ inst, positions, mat });
    };

    // Build a pool of centres for each habitat then slice PATCHES_PER per species
    const sunPool    = findCenters(SUN_IDS.length    * PATCHES_PER + 4, (x, z) =>
      terrainType(x, z) === 'grass' && underTree(x, z) < 0.06);
    const dapplePool = findCenters(DAPPLE_IDS.length * PATCHES_PER + 4, (x, z) => {
      const u = underTree(x, z);
      return terrainType(x, z) === 'grass' && u > 0.06 && u < 0.5;
    });

    SUN_IDS.forEach((id, i) =>
      scatterFlower(id, PER_SPECIES, sunPool.slice(i*PATCHES_PER, (i+1)*PATCHES_PER)));
    DAPPLE_IDS.forEach((id, i) =>
      scatterFlower(id, PER_SPECIES, dapplePool.slice(i*PATCHES_PER, (i+1)*PATCHES_PER)));
  }

  return {
    plants,
    valuables,                                        // rare finds: shells, stones, amber, quartz
    flowers,                                          // individually-pickable wildflowers (for elf crown agents)
    trees: [...treePos, ...redwoodPos, ...oakPos, ...birchPos, ...rowanPos, ...pinePos, ...alderPos],
    // the same trunks, but with identity: species and age. The mycelium network is
    // built over these (js/mycelium.js) — guild membership follows species, and the
    // link graph follows position, so this is all it needs.
    // scale is the per-instance size; trunkR/trunkH are the archetype's base trunk
    // radius and height (so actual = ×scale) — the face shells fit the real trunk.
    treeRecords: [
      ...treePos   .map(([x, z, sc, sp, tr, th]) => ({ x, z, scale: sc || 1, species: sp || 'maple',   trunkR: tr, trunkH: th })),
      ...redwoodPos.map(([x, z, sc, sp, tr, th]) => ({ x, z, scale: sc || 1, species: sp || 'redwood', trunkR: tr, trunkH: th })),
      ...oakPos    .map(([x, z, sc, sp, tr, th]) => ({ x, z, scale: sc || 1, species: sp || 'oak',     trunkR: tr, trunkH: th })),
      ...birchPos  .map(([x, z, sc])             => ({ x, z, scale: sc || 1, species: 'birch', trunkR: birchArch[0].trunkR, trunkH: birchArch[0].trunkH })),
      ...rowanPos  .map(([x, z, sc])             => ({ x, z, scale: sc || 1, species: 'rowan', trunkR: rowanArch[0].trunkR, trunkH: rowanArch[0].trunkH })),
    ],
    grass: null,
    reeds: reedGrass,                                 // [{ inst, items }] per tile — tall swamp grass, also hidden along trails
    ferns,                                            // [{ inst, items }] per tile — woodland ferns, hidden along trails
    groundCover: [...sedgeGroups, ...cottonGroups, ...heatherGroups],   // also worn away by paths
    shrubs: shrubRecs,                                // choppable shrubs (firewood) — see agents.js
    // obstacles people walk around: trunks, plus shrubs (which vanish when chopped:
    // the shrub records carry .alive, and the avoidance code skips dead ones)
    obstacles: [
      ...treePos.map(([x, z])    => ({ x, z, r: 0.9 })),
      ...redwoodPos.map(([x, z]) => ({ x, z, r: 1.4 })),
      ...oakPos.map(([x, z])     => ({ x, z, r: 1.0 })),
      ...birchPos.map(([x, z])   => ({ x, z, r: 0.6 })),
      ...rowanPos.map(([x, z])   => ({ x, z, r: 0.5 })),
      ...pinePos.map(([x, z])    => ({ x, z, r: 0.85 })),   // (pines and alders were missing: walked through, built over)
      ...alderPos.map(([x, z])   => ({ x, z, r: 0.85 })),
      ...shrubRecs,
    ],
    update(dt){ for (const p of plants) p.tick(dt); for (const v of valuables) v.tick(dt); for (const f of flowers) f.tick(dt); },
    // Turn the fruit/berry cards to face the camera. Every ripe plant rewrites its
    // instance matrices here and re-uploads them, so plants past the fog are hidden
    // and skipped outright — a thousand tiny buffer uploads a frame for berries
    // nobody can see was a large part of what made the doubled world drag.
    billboardFruits(cam, flowerTint, maxDist = Infinity){
      const q = cam.quaternion;
      const cx = cam.position.x, cz = cam.position.z, far2 = maxDist * maxDist;
      const inSight = (o) => {
        const dx = o.x - cx, dz = o.z - cz;
        const vis = dx*dx + dz*dz < far2;
        if (o.grp) o.grp.visible = vis;
        return vis;
      };
      for (const p of plants){
        if (!inSight(p)) continue;
        if (flowerTint && p.mat) p.mat.color.copy(flowerTint);
        p.billboard(q);
      }
      for (const v of valuables) if (inSight(v)) v.billboard(q);
      // flowers: Y-only rotation so they stay upright (just turn to face the camera)
      if (_flowerBillboards.length){
        _fEuler.setFromQuaternion(q, 'YXZ');
        _fQ.setFromAxisAngle(_yAxis, _fEuler.y);
        for (const { inst, positions, mat } of _flowerBillboards){
          if (flowerTint) mat.color.copy(flowerTint);
          for (let i = 0; i < positions.length; i++){
            _bbS.setScalar(positions[i].sc);
            _bbM.compose(positions[i].pos, _fQ, _bbS);
            inst.setMatrixAt(i, _bbM);
          }
          inst.instanceMatrix.needsUpdate = true;
        }
      }
    },
    // nearest ripe plant OR valuable within reach of (px,pz), or null (player E-gather)
    nearest(px, pz, range = 3.2){
      let best = null, bd = range;
      for (const p of plants){
        if (!p.ripe) continue;
        const d = Math.hypot(px - p.x, pz - p.z);
        if (d < bd){ bd = d; best = p; }
      }
      for (const v of valuables){
        if (!v.ripe) continue;
        const d = Math.hypot(px - v.x, pz - v.z);
        if (d < bd){ bd = d; best = v; }
      }
      return best;
    },
    // every gatherable thing (plants + valuables), for cursor-aimed E selection
    pickables(){ return plants.concat(valuables); },
  };
}
