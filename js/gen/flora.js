import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER, WORLD_R } from '../config.js';
import { height, terrainType, soilRichness, groundSink } from '../terrain.js';
import { rand, randint, fork } from '../rng.js';
import { makeGrassTexture, makePussywillowTexture, makeCattailTexture, makeAcornTexture, makeMushroomTexture, makeTrinketTexture, makeVineTexture, makeFernTexture, makeRedwoodFoliageTexture } from '../textures.js';
import { makeLeafAtlas } from './leaf.js';
import { makeBark, makeBirchBark, makeRedwoodBark, makeRowanBark } from './bark.js';
import { generateTree, TREE_SPECIES, SHRUB_SPECIES, REDWOOD_SPECIES, OAK_SPECIES, BIRCH_SPECIES, ROWAN_SPECIES } from './tree.js';

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

function buildArchetypes(rng, speciesList, atlas){
  return speciesList.map(sp => generateTree(fork(rng), sp, atlas));
}

// Place `count` instances on allowed terrain, bucketed by archetype.
// `choose(x,z,rng)` returns which archetype index to use at a spot.
// Returns the list of [x,z] actually planted (so callers can shade the ground
// beneath them and keep grass from growing under the canopy).
const ZERO_MTX = new THREE.Matrix4().makeScale(0, 0, 0);

function scatter(scene, rng, archetypes, barkMat, leafMat, count, allowed, scaleRange, choose, extraMat, collect, flareR = 1.4){
  const buckets = archetypes.map(() => []);
  const placed = [];
  for (let i = 0; i < count; i++){
    let x, z, ok = false;
    for (let t = 0; t < 60 && !ok; t++){
      x = (rng() - 0.5) * WORLD_R * 2; z = (rng() - 0.5) * WORLD_R * 2;
      if (Math.hypot(x, z) < WORLD_R && allowed.has(terrainType(x, z))) ok = true;
    }
    if (!ok) continue;
    const ai = choose ? choose(x, z, rng) : Math.floor(rng() * archetypes.length);
    buckets[ai].push([x, z, rand(rng, 0, Math.PI*2), rand(rng, scaleRange[0], scaleRange[1])]);
    placed.push([x, z]);
  }

  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3();
  buckets.forEach((list, ai) => {
    if (!list.length) return;
    const { branchGeo, leafGeo, acornGeo } = archetypes[ai];
    const trunks = new THREE.InstancedMesh(branchGeo, barkMat, list.length);
    const leaves = leafGeo ? new THREE.InstancedMesh(leafGeo, leafMat, list.length) : null;
    const nuts = (acornGeo && extraMat) ? new THREE.InstancedMesh(acornGeo, extraMat, list.length) : null;
    trunks.frustumCulled = false; if (leaves) leaves.frustumCulled = false; if (nuts) nuts.frustumCulled = false;
    list.forEach(([x, z, yaw, sc], i) => {
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
    trunks.instanceMatrix.needsUpdate = true;
    scene.add(trunks);
    if (leaves){ leaves.instanceMatrix.needsUpdate = true; scene.add(leaves); }
    if (nuts){ nuts.instanceMatrix.needsUpdate = true; scene.add(nuts); }
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
function shadeGroundUnderTrees(geo, influence){
  const pos = geo.attributes.position, col = geo.attributes.color;
  const duff = [0.30, 0.25, 0.16];
  for (let i = 0; i < pos.count; i++){
    const t = influence(pos.getX(i), pos.getZ(i));
    if (t <= 0) continue;
    const k = Math.min(1, t * 1.25);                  // fully duff a touch inside the edge
    col.setXYZ(i,
      lerp(col.getX(i), duff[0], k),
      lerp(col.getY(i), duff[1], k),
      lerp(col.getZ(i), duff[2], k));
  }
  col.needsUpdate = true;
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

// Scatter grass tufts where `place(rng)` returns a spot, GPU-instanced.
// Returns { inst, items } where items[k] = { x, z, m } is the world position and
// original matrix of instance k — so trails can hide tufts on worn ground.
function scatterGrass(scene, rng, geo, mat, count, place){
  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.frustumCulled = false;
  const items = [];
  const q = new THREE.Quaternion();
  let n = 0;
  for (let i = 0; i < count; i++){
    const spot = place(rng); if (!spot) continue;
    const [x, z, sc] = spot;
    q.setFromAxisAngle(UP, rng() * Math.PI*2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, height(x, z), z), q, new THREE.Vector3(sc, sc, sc));
    inst.setMatrixAt(n, m);
    items.push({ x, z, m });
    n++;
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
  scene.add(inst);
  return { inst, items };
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
function makeFruitInst(mat, spots, size){
  const geo = new THREE.PlaneGeometry(1, 1);
  const inst = new THREE.InstancedMesh(geo, mat, spots.length);
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

export function plantWorld(scene, rng, { ground = null, trees = 320, shrubs = 460, redwoods = 45,
                                         oaks = 80, grass = 2400, reeds = 1000, bushes = 20, fruitTrees = 8,
                                         pussywillows = 420, cattails = 520,
                                         hazels = 14, daisies = 30, roots = 18, mushrooms = 20, acornPatches = 16,
                                         cattailRoots = 12,
                                         shells = 24, stones = 30, ambers = 10, quartzes = 12 } = {}){
  const atlas = makeLeafAtlas(fork(rng));
  const bark  = makeBark(fork(rng));

  const barkMat = new THREE.MeshLambertMaterial({ map: bark });
  const leafMat = new THREE.MeshLambertMaterial({
    map: atlas.texture, alphaTest: 0.5, side: THREE.DoubleSide,
  });

  const treeArch    = buildArchetypes(rng, TREE_SPECIES, atlas);   // [rich, mid, lean]
  const shrubArch   = buildArchetypes(rng, SHRUB_SPECIES, atlas);
  // redwoodArch built below with the conifer atlas, after coniferAtlas is created

  // oaks have their own round-lobed leaves, acorns, and a broad gnarled form
  const oakAtlas   = makeLeafAtlas(fork(rng), { kind: 'oak' });
  const oakLeafMat = new THREE.MeshLambertMaterial({ map: oakAtlas.texture, alphaTest: 0.5, side: THREE.DoubleSide });
  const acornMat   = new THREE.MeshLambertMaterial({ map: makeAcornTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
  const oakArch    = buildArchetypes(rng, OAK_SPECIES, oakAtlas);

  // form follows soil: rich moist ground grows broad maples, dry/high grows lean
  const bySoil = (x, z) => { const r = soilRichness(x, z); return r > 0.62 ? 0 : r > 0.4 ? 1 : 2; };

  // wide per-instance scale ranges so heights form a continuum (saplings up to
  // giants) rather than clustering around each archetype's set height
  const treePos = scatter(scene, fork(rng), treeArch,    barkMat, leafMat, trees,    new Set(['grass','mud']),        [0.55, 1.55], bySoil);
  const shrubRecs = [];   // removable: each shrub can be chopped down for firewood
  scatter(scene, fork(rng), shrubArch,   barkMat, leafMat, shrubs,   new Set(['grass','mud','sand']), [0.65, 1.5], null, null, shrubRecs, 0.6);
  const redwoodBarkMat  = new THREE.MeshLambertMaterial({ map: makeRedwoodBark(fork(rng)) });
  // flat horizontal disc foliage — leafStyle:'flat' ignores the atlas entirely,
  // so pass a dummy; the material uses the blob texture directly.
  const redwoodFoliageMat = new THREE.MeshLambertMaterial({ map: makeRedwoodFoliageTexture({ seed: fork(rng) }), alphaTest: 0.35, side: THREE.DoubleSide });
  const dummyAtlas      = { texture: null, cols: 1, rows: 1, count: 1 };
  const redwoodArch     = buildArchetypes(rng, REDWOOD_SPECIES, dummyAtlas);
  const redwoodPos = scatter(scene, fork(rng), redwoodArch, redwoodBarkMat, redwoodFoliageMat, redwoods, new Set(['grass','mud']), [0.7, 1.35], null, null, null, 3.0);

  // blob shadows: terrain-conforming shadow patches under each redwood.
  // Each blob is a subdivided grid whose vertices are displaced to the terrain
  // height, so the shadow hugs uneven ground instead of clipping through it.
  // All blobs are merged into one geometry — one draw call total.
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

    const SEGS = 10, N = SEGS + 1;   // 10×10 quad grid per blob
    const allPos = [], allUV = [], allIdx = [];
    let vOff = 0;
    for (const [cx, cz] of redwoodPos){
      const R = (12 + rng() * 7) * 0.5;   // half-width
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
    blobGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(allIdx), 1));
    const blobMesh = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({
      map: blobTex, transparent: true, depthWrite: false,
    }));
    blobMesh.renderOrder = 1;
    scene.add(blobMesh);
  }
  const oakPos     = scatter(scene, fork(rng), oakArch,     barkMat, oakLeafMat, oaks,  new Set(['grass','mud']),        [0.6, 1.45], null, acornMat, null, 2.4);

  // litter footprint per tree (big trees cast a wider duff ring than maples)
  const litter = [...treePos.map(([x,z]) => [x, z, 3.6]),
                  ...redwoodPos.map(([x,z]) => [x, z, 5.5]),
                  ...oakPos.map(([x,z]) => [x, z, 4.8])];
  const underTree = spotGrid(litter);
  if (ground) shadeGroundUnderTrees(ground.geometry, underTree);

  // --- birch: pioneer species, grow in tight clumps on open/disturbed ground ---
  // Placed AFTER underTree is computed so we can actively avoid existing canopy shade.
  // Cluster centres are found on open ground (low underTree); individual trees scatter
  // around each centre with a uniform-disc distribution (sqrt for even spread).
  const birchArch    = buildArchetypes(rng, BIRCH_SPECIES, atlas);
  const birchBarkMat = new THREE.MeshLambertMaterial({ map: makeBirchBark(fork(rng)) });
  const birchLeafMat = new THREE.MeshLambertMaterial({
    map: atlas.texture, color: new THREE.Color(0.82, 1.0, 0.68),
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const BIRCH_CLUSTERS = 14, CLUSTER_R = 9;
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
    for (const [x, z] of birchPos){
      bkts[rng() * birchArch.length | 0].push([x, z, rand(rng, 0, Math.PI*2), rand(rng, 0.6, 1.3)]);
    }
    const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bv = new THREE.Vector3(), bs = new THREE.Vector3();
    for (let ai = 0; ai < birchArch.length; ai++){
      const list = bkts[ai]; if (!list.length) continue;
      const { branchGeo, leafGeo } = birchArch[ai];
      const trunks = new THREE.InstancedMesh(branchGeo, birchBarkMat, list.length);
      const leaves = leafGeo ? new THREE.InstancedMesh(leafGeo, birchLeafMat, list.length) : null;
      trunks.frustumCulled = false; if (leaves) leaves.frustumCulled = false;
      list.forEach(([x, z, yaw, sc], i) => {
        bq.setFromAxisAngle(UP, yaw);
        bv.set(x, height(x, z) - groundSink(x, z, 1.2 * sc) * 0.6, z);
        bm.compose(bv, bq, bs.setScalar(sc));
        trunks.setMatrixAt(i, bm); if (leaves) leaves.setMatrixAt(i, bm);
      });
      trunks.instanceMatrix.needsUpdate = true; scene.add(trunks);
      if (leaves){ leaves.instanceMatrix.needsUpdate = true; scene.add(leaves); }
    }
  }

  // --- rowan: small forest-edge trees, shade-intolerant, individual or pairs ---
  // Grow where canopy is partial (underTree 0.08–0.40) — forest margins and
  // clearings edges. Greyer and lighter than maple; no prominent surface roots.
  const rowanArch    = buildArchetypes(rng, ROWAN_SPECIES, atlas);
  const rowanBarkMat = new THREE.MeshLambertMaterial({ map: makeRowanBark(fork(rng)) });
  const rowanLeafMat = new THREE.MeshLambertMaterial({
    map: atlas.texture, color: new THREE.Color(0.78, 0.95, 0.60),
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const rowanPos = [];
  {
    const rm = new THREE.Matrix4(), rq = new THREE.Quaternion(), rv = new THREE.Vector3(), rs = new THREE.Vector3();
    const bkts = rowanArch.map(() => []);
    for (let i = 0; i < 320; i++){     // try 320 times to place ~100 rowans
      const x = (rng() - 0.5) * WORLD_R * 2, z = (rng() - 0.5) * WORLD_R * 2;
      if (Math.hypot(x, z) >= WORLD_R) continue;
      if (!['grass','mud','rock'].includes(terrainType(x, z))) continue;
      const u = underTree(x, z);
      if (u < 0.08 || u > 0.42) continue;   // forest edge — partial light
      rowanPos.push([x, z]);
      bkts[rng() * rowanArch.length | 0].push([x, z, rand(rng, 0, Math.PI*2), rand(rng, 0.65, 1.2)]);
    }
    for (let ai = 0; ai < rowanArch.length; ai++){
      const list = bkts[ai]; if (!list.length) continue;
      const { branchGeo, leafGeo } = rowanArch[ai];
      const trunks = new THREE.InstancedMesh(branchGeo, rowanBarkMat, list.length);
      const leaves = leafGeo ? new THREE.InstancedMesh(leafGeo, rowanLeafMat, list.length) : null;
      trunks.frustumCulled = false; if (leaves) leaves.frustumCulled = false;
      list.forEach(([x, z, yaw, sc], i) => {
        rq.setFromAxisAngle(UP, yaw);
        rv.set(x, height(x, z) - groundSink(x, z, sc) * 0.6, z);
        rm.compose(rv, rq, rs.setScalar(sc));
        trunks.setMatrixAt(i, rm); if (leaves) leaves.setMatrixAt(i, rm);
      });
      trunks.instanceMatrix.needsUpdate = true; scene.add(trunks);
      if (leaves){ leaves.instanceMatrix.needsUpdate = true; scene.add(leaves); }
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
    const maxV = hosts.length * 2;
    const vInst = new THREE.InstancedMesh(vGeo, vineMat, maxV);
    vInst.frustumCulled = false;
    const vm = new THREE.Matrix4(), vq = new THREE.Quaternion(), vv = new THREE.Vector3(), vs = new THREE.Vector3();
    let vn = 0;
    for (const [tx, tz, baseSc] of hosts){
      const clusters = 1 + (rng() < 0.55 ? 1 : 0);   // 1–2 clusters per host
      for (let c = 0; c < clusters && vn < maxV; c++){
        const a = rng() * Math.PI * 2, r = 0.15 + rng() * 0.55;
        const vx = tx + Math.cos(a) * r, vz = tz + Math.sin(a) * r;
        const vy = height(vx, vz) + 3.8 + rng() * 2.2;   // attach near branch level
        vq.setFromAxisAngle(UP, rng() * Math.PI * 2);
        vv.set(vx, vy, vz);
        const sc = baseSc * (0.75 + rng() * 0.5);
        vs.set(sc, sc * (0.8 + rng() * 0.45), sc);        // vary drop length more than width
        vm.compose(vv, vq, vs);
        vInst.setMatrixAt(vn++, vm);
      }
    }
    vInst.count = vn;
    vInst.instanceMatrix.needsUpdate = true;
    scene.add(vInst);
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
  const ferns = scatterGrass(scene, fork(rng), fernGeo, fernMat, 1400, inShade);

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

  for (let i = 0; i < bushes; i++){                          // waist-high berry bushes
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = generateTree(fork(frng), { ...SHRUB_SPECIES[0], targetHeight: 1.5 }, atlas);
    body.leafGeo.computeBoundingBox();
    const berryMat = frng() < 0.5 ? fruitMats.red : fruitMats.blue;
    const fruitSpots = fruitPositions(body.leafGeo.boundingBox, 12, 0.2, 0.95, frng);
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: berryMat, fruitSpots, fruitSize: 0.22, kind: 'berries', yieldRange: [2, 4], regrow: 24 }));
  }
  for (let i = 0; i < fruitTrees; i++){                      // small apple trees
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = generateTree(fork(frng), { ...TREE_SPECIES[1], targetHeight: 6, leavesPerTip: 14 }, atlas);
    body.leafGeo.computeBoundingBox();
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
    const body = generateTree(fork(frng), { ...SHRUB_SPECIES[0], targetHeight: 1.7 }, atlas);
    body.leafGeo.computeBoundingBox();
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
    const PATCHES_PER = 2;    // patch centres per species
    const PER_SPECIES = 60;   // flowers per species
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
    trees: [...treePos, ...redwoodPos, ...oakPos, ...birchPos, ...rowanPos],
    grass: null,
    reeds: reedGrass,                                 // { inst, items } — tall swamp grass, also hidden along trails
    ferns,                                            // { inst, items } — woodland ferns, hidden along trails
    shrubs: shrubRecs,                                // choppable shrubs (firewood) — see agents.js
    // obstacles people walk around: trunks, plus shrubs (which vanish when chopped:
    // the shrub records carry .alive, and the avoidance code skips dead ones)
    obstacles: [
      ...treePos.map(([x, z])    => ({ x, z, r: 0.9 })),
      ...redwoodPos.map(([x, z]) => ({ x, z, r: 1.4 })),
      ...oakPos.map(([x, z])     => ({ x, z, r: 1.0 })),
      ...birchPos.map(([x, z])   => ({ x, z, r: 0.6 })),
      ...rowanPos.map(([x, z])   => ({ x, z, r: 0.5 })),
      ...shrubRecs,
    ],
    update(dt){ for (const p of plants) p.tick(dt); for (const v of valuables) v.tick(dt); for (const f of flowers) f.tick(dt); },
    billboardFruits(cam, flowerTint){
      const q = cam.quaternion;
      for (const p of plants){
        if (flowerTint && p.mat) p.mat.color.copy(flowerTint);
        p.billboard(q);
      }
      for (const v of valuables) v.billboard(q);
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
