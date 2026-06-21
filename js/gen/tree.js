import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, randint, fork } from '../rng.js';
import { definePattern, SCALE } from './pattern.js';

// generateTree — grow a maple the way a maple actually fills out:
//
//  * opposite branching: each fork throws a spread of branches roughly opposite
//    the parent's heading, giving the zig-zag, twiggy maple structure;
//  * decurrent crown: branches reach UP near the trunk and progressively spread
//    toward horizontal at the canopy edge (elevation falls from elevBase->elevTip),
//    so the leader gives way to a broad rounded dome rather than a single spire;
//  * phototropism: every branch also leans OUTWARD, away from the shaded centre
//    toward open light, and leaves pack onto that outer surface as a shell;
//  * arching: the outermost tips droop, rounding the silhouette.
//
// Form follows soil via params (rich -> broad & full, lean -> narrow & reaching).
// The whole tree is scaled to params.targetHeight so heights stay realistic.
// Returns { branchGeo, leafGeo } seated at y=0; materials/instancing live in flora.

const DEFAULTS = {
  trunkLen: 2.6, baseRad: 0.34, depth: 5,
  childMin: 2, childMax: 3,
  continuity: 0.45,     // how much a child keeps its parent's heading (higher = straighter scaffold)
  elevBase: 62,         // branch angle above horizontal near the trunk (reach up)
  elevTip: 22,          // angle at the canopy edge (spread out); lower = wider/flatter
  arch: 14,             // extra downward droop at the outermost tips
  outwardPull: 0.6,     // phototropism at the canopy (tapered to ~0 near the trunk)
  azJitter: 0.6,
  lenFalloff: 0.82, radFalloff: 0.66, taper: 0.76, radial: 5,
  leavesPerTip: 12, leavesMid: 5, leafDepth: 2, leafSpread: 1.05,
  leafOut: 0.5,         // push leaves outward to build the canopy shell
  leafFinal: 0.55, targetHeight: 11,
  rootCount: 5,         // visible surface roots flaring from the trunk base
};

const SHRUB = {
  trunkLen: 0.4, baseRad: 0.12, depth: 3, childMin: 3, childMax: 4,
  continuity: 0.25, elevBase: 55, elevTip: 18, arch: 8, outwardPull: 0.7, azJitter: 0.9,
  lenFalloff: 0.74, radFalloff: 0.62, taper: 0.7, radial: 4,
  leavesPerTip: 7, leavesMid: 4, leafDepth: 3, leafSpread: 0.4, leafOut: 0.25,
  leafFinal: 0.32, targetHeight: 1.7,
  rootCount: 0,         // shrubs are too small/twiggy to bother with visible roots
};

const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
function dirAzEl(az, elDeg){
  const el = elDeg * Math.PI/180, c = Math.cos(el);
  return new THREE.Vector3(c*Math.cos(az), Math.sin(el), c*Math.sin(az));
}

function grow(rng, P){
  const segs = [], leaves = [];
  const cluster = (c, n, sp, out) => {
    for (let i = 0; i < n; i++){
      const p = new THREE.Vector3(c.x + rand(rng,-sp,sp), c.y + rand(rng,-sp,sp), c.z + rand(rng,-sp,sp));
      p.addScaledVector(out, rand(rng, 0, P.leafOut));
      leaves.push(p);
    }
  };
  const branch = (pos, dir, len, rad, depth, az) => {
    const end = pos.clone().addScaledVector(dir, len);
    segs.push({ a: pos.clone(), b: end, r0: rad, r1: rad * P.taper });

    const out = new THREE.Vector3(end.x, 0, end.z);    // radial-from-axis = "toward open light"
    if (out.lengthSq() < 1e-3) out.set(Math.cos(az), 0, Math.sin(az));
    out.normalize();

    if (depth <= 0){ cluster(end, P.leavesPerTip, P.leafSpread, out); return; }

    const nb = randint(rng, P.childMin, P.childMax);
    const t = depth / P.depth;                          // 1 near trunk .. ~0 at tips
    for (let i = 0; i < nb; i++){
      // opposite branching: children fan out ~180deg from the parent's azimuth
      const childAz = az + Math.PI + (i - (nb-1)/2) * (Math.PI*0.6) + rand(rng,-P.azJitter,P.azJitter);
      let elDeg = lerp(P.elevTip, P.elevBase, t) + rand(rng,-8,8);
      if (depth <= 1) elDeg -= P.arch;                  // droop the outer tips
      const outF = Math.max(0, 1 - t * 1.15);           // keep trunk/scaffold upright; spread only the canopy
      const nd = dirAzEl(childAz, elDeg)
        .multiplyScalar(1 - P.continuity)
        .addScaledVector(dir, P.continuity)
        .addScaledVector(out, P.outwardPull * outF);
      if (nd.lengthSq() < 1e-6) nd.copy(UP);
      branch(end, nd.normalize(), len * P.lenFalloff * rand(rng,0.85,1.12), rad * P.radFalloff, depth-1, childAz);
    }
    if (depth <= P.leafDepth) cluster(end, P.leavesMid, P.leafSpread, out);
  };
  branch(new THREE.Vector3(0,0,0), UP.clone(), P.trunkLen, P.baseRad, P.depth, rand(rng, 0, Math.PI*2));
  return { segs, leaves };
}

function segmentCyl(s, radial){
  const dir = new THREE.Vector3().subVectors(s.b, s.a);
  const len = dir.length() || 0.001;
  const geo = new THREE.CylinderGeometry(Math.max(s.r1,0.002), Math.max(s.r0,0.002), len, radial, 1, true);
  geo.translate(0, len/2, 0);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  geo.translate(s.a.x, s.a.y, s.a.z);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * len * 0.4);
  return geo;
}

function leafQuad(pos, size, rng, atlas){
  const geo = new THREE.PlaneGeometry(size, size);
  geo.applyQuaternion(new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rand(rng,0,Math.PI*2), rand(rng,0,Math.PI*2), rand(rng,0,Math.PI*2))));
  geo.translate(pos.x, pos.y, pos.z);
  const idx = Math.floor(rng() * atlas.count);
  const cx = idx % atlas.cols, r = Math.floor(idx / atlas.cols);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++){
    const u = uv.getX(i), v = uv.getY(i);
    uv.setXY(i, (cx + u) / atlas.cols, 1 - (r + 1 - v) / atlas.rows);
  }
  return geo;
}

// crossed quads for a hanging fruit/acorn (an "X", so it reads from any angle)
function acornQuad(pos, size){
  const a = new THREE.PlaneGeometry(size, size * 1.3);    // a touch taller than wide
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b], false);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

// Surface/buttress roots, built in FINAL tree-space (trunk base already at y=0,
// `baseR` = the scaled trunk-base radius). Each root leaves the trunk right at
// its foot — fat and low — so the base *flares into* the roots with no bare
// cylinder of trunk showing beneath them (there's no "trunk" once roots begin on
// a real tree). From there it sweeps outward, skimming the ground, then dives
// just under it. Two tapered segments per root; merged into the trunk so they
// carry the same bark. Roots splay roughly evenly around, with jitter so the
// flare is gnarled, not a neat wheel.
function rootSegs(rng, baseR, n){
  const segs = [];
  const a0 = rand(rng, 0, Math.PI*2);
  for (let i = 0; i < n; i++){
    const az = a0 + i / n * Math.PI*2 + rand(rng, -0.4, 0.4);
    const ca = Math.cos(az), sa = Math.sin(az);
    const spread = baseR * rand(rng, 2.6, 4.4);                 // how far the root reaches out
    const p0   = new THREE.Vector3(ca*baseR*0.5, baseR*rand(rng,0.12,0.45), sa*baseR*0.5);  // at the foot, fat & low
    const knee = new THREE.Vector3(ca*spread*0.5, baseR*0.10, sa*spread*0.5);               // skimming the ground
    const tip  = new THREE.Vector3(ca*spread, -baseR*rand(rng,0.5,1.0), sa*spread);         // diving under
    const r0 = baseR*rand(rng,0.6,0.85), r1 = baseR*0.34, r2 = baseR*0.10;
    segs.push({ a: p0,   b: knee, r0,      r1 });
    segs.push({ a: knee, b: tip,  r0: r1,  r1: r2 });
  }
  return segs;
}

export function generateTree(rng, params, atlas){
  const P = { ...DEFAULTS, ...params };
  const { segs, leaves } = grow(rng, P);

  let branchGeo = mergeGeometries(segs.map(s => segmentCyl(s, P.radial)), false);
  branchGeo.computeBoundingBox();
  const H = (branchGeo.boundingBox.max.y - branchGeo.boundingBox.min.y) || 1;
  const s = P.targetHeight / H;
  const leafNat = P.leafFinal / s;

  const leafGeo = leaves.length
    ? mergeGeometries(leaves.map(p => leafQuad(p, leafNat, rng, atlas)), false)
    : null;

  // acorns: a scattering of small nuts tucked among the leaves (oaks only)
  let acornGeo = null;
  if (P.acorns && leaves.length){
    const spots = leaves.filter(() => rng() < 0.07).slice(0, 40);
    if (spots.length) acornGeo = mergeGeometries(spots.map(p => acornQuad(p, leafNat * 0.5)), false);
  }

  branchGeo.scale(s, s, s);
  if (leafGeo) leafGeo.scale(s, s, s);
  if (acornGeo) acornGeo.scale(s, s, s);
  branchGeo.computeBoundingBox();
  const minY = branchGeo.boundingBox.min.y;
  branchGeo.translate(0, -minY, 0);
  if (leafGeo) leafGeo.translate(0, -minY, 0);
  if (acornGeo) acornGeo.translate(0, -minY, 0);

  // roots: grown directly in final space (trunk base now at y=0) and merged into
  // the trunk, sized to the scaled base radius (the bottom segment's r0 = baseRad).
  if (P.rootCount){
    const rsegs = rootSegs(rng, P.baseRad * s, P.rootCount);
    const radial = Math.max(4, (P.radial | 0) - 1);
    branchGeo = mergeGeometries([branchGeo, ...rsegs.map(seg => segmentCyl(seg, radial))], false);
  }

  branchGeo.computeVertexNormals();
  if (leafGeo) leafGeo.computeVertexNormals();
  if (acornGeo) acornGeo.computeVertexNormals();
  return { branchGeo, leafGeo, acornGeo };
}

// Species presets — form follows soil. flora.js places rich on moist lowland,
// lean on dry/high ground (kept in this order so soil can index them).
export const TREE_SPECIES = [
  { name: 'maple-rich', targetHeight: 13, outwardPull: 0.6,  elevTip: 18, leavesPerTip: 17, leavesMid: 7, leafSpread: 1.2 },
  { name: 'maple',      targetHeight: 11, outwardPull: 0.48, elevTip: 22, leavesPerTip: 12, leavesMid: 5 },
  { name: 'maple-lean', targetHeight: 9,  outwardPull: 0.3,  elevTip: 30, elevBase: 68, leavesPerTip: 8 },
];
export const SHRUB_SPECIES = [
  { ...SHRUB, name: 'shrub-a' },
  { ...SHRUB, name: 'shrub-b', targetHeight: 2.2, outwardPull: 0.8 },
];

// Redwood: an excurrent giant — one tall straight leader (high continuity), with
// short branches that barely spread (low outwardPull) and reach steeply upward
// (high elevation), so the silhouette is a narrow towering spire rather than the
// maples' broad dome. Far taller than anything else in the world.
const REDWOOD = {
  trunkLen: 4.2, baseRad: 0.62, depth: 5, childMin: 2, childMax: 3,
  continuity: 0.62,           // keep a strong vertical leader
  elevBase: 54, elevTip: 40,  // branches stay near-upright → narrow crown
  arch: 9,                    // a gentle droop at the branch tips
  outwardPull: 0.12,          // hardly spreads — columnar
  azJitter: 0.5,
  lenFalloff: 0.74, radFalloff: 0.7, taper: 0.82, radial: 6,
  leavesPerTip: 15, leavesMid: 6, leafDepth: 3, leafSpread: 0.7, leafOut: 0.2,
  leafFinal: 0.6, targetHeight: 34,
  rootCount: 6,               // big buttress roots at the base of the giant
};
export const REDWOOD_SPECIES = [
  { ...REDWOOD, name: 'redwood' },
  { ...REDWOOD, name: 'redwood-tall', targetHeight: 42, baseRad: 0.7, continuity: 0.66 },
];

// Oak: a sturdy, gnarled, wide-spreading tree. A thick trunk and heavy, low,
// crooked limbs (low continuity + high azimuth jitter) carry a broad rounded
// dome (very horizontal canopy edge, strong outward pull, heavy droop). Shorter
// and far broader than a maple, with its own round-lobed leaves and acorns.
const OAK = {
  trunkLen: 3.0, baseRad: 0.50, depth: 5, childMin: 2, childMax: 4,
  continuity: 0.38,            // crooked, zig-zag scaffold
  elevBase: 55, elevTip: 12,   // reach up at the trunk, spread flat at the edge → broad dome
  arch: 18,                    // heavy drooping outer limbs
  outwardPull: 0.75,           // wide spreading crown
  azJitter: 0.8,               // gnarled branching
  lenFalloff: 0.80, radFalloff: 0.64, taper: 0.82, radial: 6,
  leavesPerTip: 14, leavesMid: 6, leafDepth: 2, leafSpread: 1.0, leafOut: 0.55,
  leafFinal: 0.5, targetHeight: 12, acorns: true,
  rootCount: 6,                // gnarled, prominent surface roots
};
export const OAK_SPECIES = [
  { ...OAK, name: 'oak' },
  { ...OAK, name: 'oak-broad', targetHeight: 13, outwardPull: 0.85, elevTip: 9,  baseRad: 0.58 },
  { ...OAK, name: 'oak-young', targetHeight: 9,  outwardPull: 0.6,  leavesPerTip: 12 },
];

definePattern({
  name: 'tree.maple', scale: SCALE.TREE, uses: ['leaf.maple', 'bark.generic'],
  generate: ({ rng, atlas, params }) => generateTree(fork(rng), params || {}, atlas),
});
definePattern({
  name: 'plant.shrub', scale: SCALE.PLANT, uses: ['leaf.maple', 'bark.generic'],
  generate: ({ rng, atlas, params }) => generateTree(fork(rng), { ...SHRUB, ...params }, atlas),
});
