import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER, WORLD_R } from '../config.js';
import { height, terrainType, soilRichness, groundSink } from '../terrain.js';
import { rand, randint, fork } from '../rng.js';
import { makeGrassTexture, makeFruitTexture, makePussywillowTexture, makeCattailTexture, makeAcornTexture, makeMushroomTexture, makeTrinketTexture } from '../textures.js';
import { makeLeafAtlas } from './leaf.js';
import { makeBark } from './bark.js';
import { generateTree, TREE_SPECIES, SHRUB_SPECIES, REDWOOD_SPECIES, OAK_SPECIES } from './tree.js';

// plantWorld — scatter trees & shrubs across the terrain. We generate a few
// detailed archetypes once, then GPU-instance each across many positions, so
// the whole forest costs only ~2 draw calls per archetype.

const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;

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

// a small fruit on crossed quads, centred at pos (it hangs, so not based at y=0)
function fruitCard(size, pos){
  const a = new THREE.PlaneGeometry(size, size);
  const b = a.clone(); b.rotateY(Math.PI/2);
  const g = mergeGeometries([a, b], false);
  g.translate(pos.x, pos.y, pos.z);
  return g;
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

// The shared forageable: a placed group with one harvestable mesh that toggles
// off when picked (E) and back on after `regrow`. A single visibility flip.
function forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng }){
  grp.add(harvest);
  grp.position.set(x, height(x, z), z);
  scene.add(grp);
  return {
    x, z, kind, ripe: true, timer: 0,
    tick(dt){ if (!this.ripe){ this.timer -= dt; if (this.timer <= 0){ this.ripe = true; harvest.visible = true; } } },
    collect(){
      if (!this.ripe) return 0;
      this.ripe = false; harvest.visible = false; this.timer = regrow;
      return randint(rng, yieldRange[0], yieldRange[1]);
    },
  };
}

// A bush/tree forageable: a generated body (bark + leaves) carrying a fruit/nut
// cluster up in the canopy.
function makePlant(scene, rng, { x, z, body, barkMat, leafMat, fruitMat, fruit, kind, yieldRange, regrow }){
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(body.branchGeo, barkMat));
  if (body.leafGeo) grp.add(new THREE.Mesh(body.leafGeo, leafMat));
  const harvest = new THREE.Mesh(mergeGeometries(fruit, false), fruitMat);
  return forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng });
}

// A scatter of little crossed-quad cards sitting on the ground (y from ~0 up),
// jittered within `spread`. The harvestable body for ground foods.
function cardCluster(n, size, spread, rng){
  const out = [];
  for (let i = 0; i < n; i++){
    const a = rng()*Math.PI*2, r = spread * Math.sqrt(rng());
    out.push(fruitCard(size, new THREE.Vector3(Math.cos(a)*r, size*0.5, Math.sin(a)*r)));
  }
  return out;
}

// A low ground forageable: nuts, roots, mushrooms — no woody body, just a small
// harvestable cluster of cards on the earth.
function makeGroundFood(scene, rng, { x, z, n, size, spread, mat, kind, yieldRange, regrow }){
  const grp = new THREE.Group();
  const harvest = new THREE.Mesh(mergeGeometries(cardCluster(n, size, spread, rng), false), mat);
  return forageable(scene, grp, harvest, { x, z, kind, yieldRange, regrow, rng });
}

export function plantWorld(scene, rng, { ground = null, trees = 320, shrubs = 460, redwoods = 45,
                                         oaks = 80, grass = 2400, reeds = 1000, bushes = 20, fruitTrees = 8,
                                         pussywillows = 420, cattails = 520,
                                         hazels = 14, roots = 18, mushrooms = 20, acornPatches = 16,
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
  const redwoodArch = buildArchetypes(rng, REDWOOD_SPECIES, atlas);

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
  const redwoodPos = scatter(scene, fork(rng), redwoodArch, barkMat, leafMat, redwoods, new Set(['grass','mud']),        [0.7, 1.35], null, null, null, 3.0);
  const oakPos     = scatter(scene, fork(rng), oakArch,     barkMat, oakLeafMat, oaks,  new Set(['grass','mud']),        [0.6, 1.45], null, acornMat, null, 2.4);

  // litter footprint per tree (big trees cast a wider duff ring than maples)
  const litter = [...treePos.map(([x,z]) => [x, z, 3.6]),
                  ...redwoodPos.map(([x,z]) => [x, z, 5.5]),
                  ...oakPos.map(([x,z]) => [x, z, 4.8])];
  const underTree = spotGrid(litter);
  if (ground) shadeGroundUnderTrees(ground.geometry, underTree);

  // --- ground cover: meadow grass on open land, reeds in the swampy mud ---
  const grassMat = new THREE.MeshLambertMaterial({
    map: makeGrassTexture({ seed: rng }), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const reedMat = new THREE.MeshLambertMaterial({
    map: makeGrassTexture({ seed: rng, tall: true, blades: 6 }), alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const meadowGeo = grassCard(1.3, 1.0);
  const reedGeo   = grassCard(1.1, 2.2);

  const onLand = (rng) => {                       // open grass, never under a tree
    for (let t = 0; t < 8; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      if (terrainType(x, z) !== 'grass') continue;
      if (underTree(x, z) > 0.15) continue;
      return [x, z, 0.8 + rng()*0.7];
    }
    return null;
  };
  const inSwamp = (rng) => {                       // reedy wet mud near the water
    for (let t = 0; t < 8; t++){
      const x = (rng()-0.5)*WORLD_R*2, z = (rng()-0.5)*WORLD_R*2;
      if (Math.hypot(x, z) > WORLD_R) continue;
      if (terrainType(x, z) !== 'mud') continue;
      return [x, z, 0.85 + rng()*0.8];
    }
    return null;
  };

  const meadow = scatterGrass(scene, fork(rng), meadowGeo, grassMat, grass, onLand);
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
  const fruitMats = {
    red:   new THREE.MeshLambertMaterial({ map: makeFruitTexture([196, 38, 46]), alphaTest: 0.5, side: THREE.DoubleSide }),
    blue:  new THREE.MeshLambertMaterial({ map: makeFruitTexture([62, 78, 168]), alphaTest: 0.5, side: THREE.DoubleSide }),
    apple: new THREE.MeshLambertMaterial({ map: makeFruitTexture([206, 60, 44]), alphaTest: 0.5, side: THREE.DoubleSide }),
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
    const fruit = fruitPositions(body.leafGeo.boundingBox, 12, 0.2, 0.95, frng).map(p => fruitCard(0.22, p));
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: berryMat, fruit, kind: 'berries', yieldRange: [2, 4], regrow: 24 }));
  }
  for (let i = 0; i < fruitTrees; i++){                      // small apple trees
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = generateTree(fork(frng), { ...TREE_SPECIES[1], targetHeight: 6, leavesPerTip: 14 }, atlas);
    body.leafGeo.computeBoundingBox();
    const fruit = fruitPositions(body.leafGeo.boundingBox, 10, 0.45, 0.95, frng).map(p => fruitCard(0.5, p));
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: fruitMats.apple, fruit, kind: 'apples', yieldRange: [1, 2], regrow: 40 }));
  }

  // --- a hunter-gatherer's larder: not just berries. See docs/forage.md. ---
  // Real foragers live mostly on gathered plants — starchy roots, storable nuts,
  // fungi, wetland tubers — so each food grows where it actually would.
  const hazelMat   = new THREE.MeshLambertMaterial({ map: makeFruitTexture([138, 96, 54]), alphaTest: 0.5, side: THREE.DoubleSide });
  const mushMats   = [makeMushroomTexture([150, 60, 44]), makeMushroomTexture([176, 132, 70])]
    .map(t => new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));

  for (let i = 0; i < hazels; i++){                          // hazelnut bushes (woodland)
    const s = landSpot(new Set(['grass','mud'])); if (!s) continue;
    const body = generateTree(fork(frng), { ...SHRUB_SPECIES[0], targetHeight: 1.7 }, atlas);
    body.leafGeo.computeBoundingBox();
    const fruit = fruitPositions(body.leafGeo.boundingBox, 9, 0.25, 0.9, frng).map(p => fruitCard(0.18, p));
    plants.push(makePlant(scene, frng, { x: s[0], z: s[1], body, barkMat, leafMat,
      fruitMat: hazelMat, fruit, kind: 'hazelnuts', yieldRange: [2, 4], regrow: 60 }));
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

  return {
    plants,
    valuables,                                        // rare finds: shells, stones, amber, quartz
    trees: [...treePos, ...redwoodPos, ...oakPos],   // trunk [x,z] list, e.g. for siting clearings
    grass: meadow,                                    // { inst, items } — meadow tufts, hidden along trails
    reeds: reedGrass,                                 // { inst, items } — tall swamp grass, also hidden along trails
    shrubs: shrubRecs,                                // choppable shrubs (firewood) — see agents.js
    // obstacles people walk around: trunks, plus shrubs (which vanish when chopped:
    // the shrub records carry .alive, and the avoidance code skips dead ones)
    obstacles: [
      ...treePos.map(([x, z])    => ({ x, z, r: 0.9 })),
      ...redwoodPos.map(([x, z]) => ({ x, z, r: 1.4 })),
      ...oakPos.map(([x, z])     => ({ x, z, r: 1.0 })),
      ...shrubRecs,
    ],
    update(dt){ for (const p of plants) p.tick(dt); for (const v of valuables) v.tick(dt); },
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
