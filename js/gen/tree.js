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

// A bush is leafy down its inner stems and its outer stems droop (arch), so the
// leaves come down toward the ground rather than sitting as a ball on a stalk.
// (Don't shorten trunkLen to get there: the whole bush is scaled so its branches
// reach targetHeight, so a shorter stem scales everything else — leaf spread
// included — up.)
const SHRUB = {
  trunkLen: 0.4, baseRad: 0.12, depth: 3, childMin: 3, childMax: 4,
  continuity: 0.25, elevBase: 55, elevTip: 12, arch: 22, outwardPull: 0.7, azJitter: 0.9,
  lenFalloff: 0.74, radFalloff: 0.62, taper: 0.7, radial: 4,
  leavesPerTip: 6, leavesMid: 6, leafDepth: 3, leafSpread: 0.4, leafOut: 0.25,
  leafFinal: 0.32, targetHeight: 1.7,
  rootCount: 0,         // shrubs are too small/twiggy to bother with visible roots
};

const UP = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
function dirAzEl(az, elDeg){
  const el = elDeg * Math.PI/180, c = Math.cos(el);
  return new THREE.Vector3(c*Math.cos(az), Math.sin(el), c*Math.sin(az));
}

// a soft bell (about -1..1, most near 0): a sum of three uniforms
const bell = (rng) => (rng() + rng() + rng() - 1.5) / 1.5;

function grow(rng, P){
  const segs = [], leaves = [];
  // Leaves grow as a spray ALONG the outer part of a twig (from `from` to a
  // little past `to`), bell-scattered around it — dense where the twig is and
  // thinning out, with no cube-shaped edge and few strays. Outward bias builds
  // the canopy shell. (It used to be a uniform cube around the tip.)
  const cluster = (from, to, n, sp, out) => {
    for (let i = 0; i < n; i++){
      const t = rand(rng, 0.25, 1.15);
      const p = new THREE.Vector3().lerpVectors(from, to, t);
      p.x += bell(rng) * sp * 1.3; p.y += bell(rng) * sp * 1.3; p.z += bell(rng) * sp * 1.3;
      p.addScaledVector(out, rng() * P.leafOut);
      leaves.push(p);
    }
  };
  const branch = (pos, dir, len, rad, depth, az) => {
    const end = pos.clone().addScaledVector(dir, len);
    segs.push({ a: pos.clone(), b: end, r0: rad, r1: rad * P.taper });

    const out = new THREE.Vector3(end.x, 0, end.z);    // radial-from-axis = "toward open light"
    if (out.lengthSq() < 1e-3) out.set(Math.cos(az), 0, Math.sin(az));
    out.normalize();

    if (depth <= 0){ cluster(pos, end, P.leavesPerTip, P.leafSpread, out); return; }

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
    if (depth <= P.leafDepth) cluster(pos, end, P.leavesMid, P.leafSpread, out);
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

// One leaf card. With `face` (the crown's outward normal here) the card turns
// to face out of the crown, within ~35°, spun at random about that — so cards
// fill the silhouette instead of standing edge-on; without, it's fully random.
const _Z = new THREE.Vector3(0, 0, 1), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _n = new THREE.Vector3();
function leafQuad(pos, size, rng, atlas, face = null){
  const geo = new THREE.PlaneGeometry(size, size);
  if (face){
    _n.set(face.x + bell(rng) * 0.7, face.y + bell(rng) * 0.7, face.z + bell(rng) * 0.7).normalize();
    _qb.setFromAxisAngle(_Z, rand(rng, 0, Math.PI * 2));          // spin within the card's plane
    _qa.setFromUnitVectors(_Z, _n).multiply(_qb);
    geo.applyQuaternion(_qa);
  } else geo.applyQuaternion(new THREE.Quaternion().setFromEuler(
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

// A large flat horizontal foliage disc — used for conifers where the foliage reads
// as broad horizontal tiers rather than scattered individual leaves. The disc is
// mostly horizontal with a slight random tilt; the blob texture + alphaTest give
// it an irregular feathery silhouette. Standard UV (no atlas remapping needed).
function leafFlat(pos, size, rng){
  const geo = new THREE.PlaneGeometry(size, size);
  geo.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(
    -Math.PI / 2 + rand(rng, -0.28, 0.28),   // mostly horizontal, slight tilt
    rand(rng, 0, Math.PI * 2),                // random rotation around Y
    rand(rng, -0.12, 0.12)
  )));
  geo.translate(pos.x, pos.y, pos.z);
  return geo;
}

// A foliage bunch: N individual leaf quads (same size as a normal leaf) packed
// tightly in a small sphere around the branch tip. Reads as a mass of foliage
// rather than one big card — the leaves are real, just clustered. Slightly
// flattened vertically so the bunch reads as a horizontal spray from below.
function leafBunch(pos, size, count, rng, atlas){
  const n  = count + (rng() * (count * 0.5) | 0);   // count ± 50%
  const r  = size * 0.85;                            // cluster radius
  const geos = [];
  for (let i = 0; i < n; i++){
    const theta  = rng() * Math.PI * 2;
    const phi    = Math.acos(2 * rng() - 1);
    const radius = Math.pow(rng(), 0.4) * r;         // bias toward the centre
    const p = new THREE.Vector3(
      pos.x + radius * Math.sin(phi) * Math.cos(theta),
      pos.y + radius * Math.cos(phi) * 0.5,          // flatten vertically
      pos.z + radius * Math.sin(phi) * Math.sin(theta),
    );
    geos.push(leafQuad(p, size, rng, atlas));
  }
  return mergeGeometries(geos, false);
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

// Far-LOD foliage: keep every `every`-th leaf card, each grown about its own
// centre so the canopy keeps most of its coverage. Cards are merged PlaneGeometry
// quads (4 verts + 6 indices each, in order); anything shaped otherwise is
// returned unchanged, so a new leaf style can't break — it just doesn't thin.
function thinCards(geo, every, grow){
  const idx = geo.index, nv = geo.attributes.position.count, nq = nv / 4;
  if (!idx || nv % 4 || idx.count !== nq * 6) return geo;
  const si = idx.array;
  for (let q = 0; q < nq; q++)
    for (let t = 0; t < 6; t++){ const v = si[q*6 + t]; if (v < q*4 || v > q*4 + 3) return geo; }
  const keep = [];
  for (let q = 0; q < nq; q += every) keep.push(q);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)){
    const k = attr.itemSize, src = attr.array, dst = new src.constructor(keep.length * 4 * k);
    keep.forEach((q, j) => dst.set(src.subarray(q*4*k, (q+1)*4*k), j*4*k));
    out.setAttribute(name, new THREE.BufferAttribute(dst, k, attr.normalized));
  }
  const p = out.attributes.position.array;
  for (let j = 0; j < keep.length; j++){
    const o = j * 12;
    const cx = (p[o] + p[o+3] + p[o+6] + p[o+9]) / 4;
    const cy = (p[o+1] + p[o+4] + p[o+7] + p[o+10]) / 4;
    const cz = (p[o+2] + p[o+5] + p[o+8] + p[o+11]) / 4;
    for (let v = 0; v < 4; v++){
      const w = o + v*3;
      p[w] = cx + (p[w] - cx) * grow; p[w+1] = cy + (p[w+1] - cy) * grow; p[w+2] = cz + (p[w+2] - cz) * grow;
    }
  }
  const ix = new Uint32Array(keep.length * 6);
  keep.forEach((q, j) => { for (let t = 0; t < 6; t++) ix[j*6 + t] = si[q*6 + t] - q*4 + j*4; });
  out.setIndex(new THREE.BufferAttribute(ix, 1));
  return out;
}

// The material for crown-lit leaf cards. They're double-sided, and three.js
// flips the lighting normal on a back face — right for a solid surface, wrong
// here: the normal is the CROWN's, so a card seen from behind would be lit as
// if facing into the tree and go black. This multiplies the flip back out.
export function leafMaterial(opts){
  const m = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n\tnormal *= faceDirection;   // undo the back-face flip: crown-lit\n#endif');
  };
  m.customProgramCacheKey = () => 'crown-lit-leaf';
  return m;
}

// Fit an ellipsoid to a cloud of leaf positions (centre = mean, radii = spread
// per axis) and hand back its outward normal at any point, tipped a little
// toward the sky so the top of a crown reads as the lit top.
function crownShape(pts){
  if (!pts.length) return null;
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / pts.length);
  let sx = 0, sy = 0, sz = 0;
  for (const p of pts){ sx += (p.x - c.x) ** 2; sy += (p.y - c.y) ** 2; sz += (p.z - c.z) ** 2; }
  const k = 1 / pts.length;
  const rx = Math.sqrt(sx * k) + 1e-3, ry = Math.sqrt(sy * k) + 1e-3, rz = Math.sqrt(sz * k) + 1e-3;
  return { c, normal: (p, out = new THREE.Vector3()) => {
    out.set((p.x - c.x) / (rx * rx), (p.y - c.y) / (ry * ry), (p.z - c.z) / (rz * rz));
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
    return out.normalize().addScaledVector(UP, 0.35).normalize();
  } };
}
// card centres of a merged quad geometry (4 verts each)
function leafCentres(geo){
  const p = geo.attributes.position.array, out = [];
  for (let o = 0; o + 11 < p.length; o += 12)
    out.push(new THREE.Vector3((p[o] + p[o+3] + p[o+6] + p[o+9]) / 4, (p[o+1] + p[o+4] + p[o+7] + p[o+10]) / 4, (p[o+2] + p[o+5] + p[o+8] + p[o+11]) / 4));
  return out;
}
// give every vertex of each card the crown's normal at that card
function crownNormals(geo, crown){
  const cs = leafCentres(geo), n = new Float32Array(cs.length * 12), v = new THREE.Vector3();
  cs.forEach((c, q) => { crown.normal(c, v); for (let k = 0; k < 4; k++){ n[q*12 + k*3] = v.x; n[q*12 + k*3 + 1] = v.y; n[q*12 + k*3 + 2] = v.z; } });
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

export function generateTree(rng, params, atlas){
  const P = { ...DEFAULTS, ...params };
  const { segs, leaves } = grow(rng, P);

  let branchGeo = mergeGeometries(segs.map(s => segmentCyl(s, P.radial)), false);
  branchGeo.computeBoundingBox();
  const H = (branchGeo.boundingBox.max.y - branchGeo.boundingBox.min.y) || 1;
  const s = P.targetHeight / H;
  const leafNat = P.leafFinal / s;

  // The crown as an ellipsoid around its leaves: each leaf's outward normal on
  // it decides which way the card faces, and is the normal it's LIT with — so
  // the crown shades as one rounded mass (sunny side bright, the far side and
  // underside darker) instead of a speckle of cards each lit by its own tilt.
  const crown = crownShape(leaves);
  const faceOf = p => crown ? crown.normal(p) : null;
  const leafFn = P.leafStyle === 'flat'
    ? p => leafFlat(p, leafNat, rng)
    : P.leafBunch
      ? p => leafBunch(p, leafNat, P.leafBunch, rng, atlas)
      : p => leafQuad(p, leafNat, rng, atlas, faceOf(p));
  const leafGeo = leaves.length
    ? mergeGeometries(leaves.map(leafFn), false)
    : null;
  const crownLit = leafGeo && P.leafStyle !== 'flat' && !P.leafBunch;

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
  if (leafGeo){
    if (crownLit) crownNormals(leafGeo, crownShape(leafCentres(leafGeo)));   // re-fit in final space
    else leafGeo.computeVertexNormals();
  }
  if (acornGeo) acornGeo.computeVertexNormals();

  // Far LOD, drawn for trees well into the fog (flora.js picks per tile): only the
  // thickest limbs, with half the sides, no roots, and a third of the leaf cards.
  // Built from the same segments, so it uses no rng — the world's seed is untouched.
  const thick = segs.map(sg => sg.r0).sort((a, b) => b - a);
  const cut = thick[Math.floor(thick.length * 0.4)];
  const radialFar = Math.max(3, Math.ceil(P.radial / 2));
  const branchGeoFar = mergeGeometries(segs.filter(sg => sg.r0 >= cut).map(sg => segmentCyl(sg, radialFar)), false);
  branchGeoFar.scale(s, s, s);
  branchGeoFar.translate(0, -minY, 0);
  branchGeoFar.computeVertexNormals();
  const leafGeoFar = leafGeo ? thinCards(leafGeo, 3, 1.6) : null;
  // Trunk metrics in the geometry's own space (before per-instance scale). Measure
  // the ACTUAL bole radius from the vertices in the lower trunk band — the visual
  // trunk is far wider than a single baseRad cylinder (root flare + stacked low
  // segments), so baseRad*s badly underestimates it. Take a high percentile of the
  // radial distance so a stray low branch doesn't blow it up.
  const pos = branchGeo.attributes.position;
  const yLo = 0.04 * P.targetHeight, yHi = 0.22 * P.targetHeight, rs = [];
  for (let i = 0; i < pos.count; i++){
    const y = pos.getY(i);
    if (y >= yLo && y <= yHi) rs.push(Math.hypot(pos.getX(i), pos.getZ(i)));
  }
  rs.sort((a, b) => a - b);
  const trunkR = rs.length ? rs[Math.floor(rs.length * 0.85)] : P.baseRad * s;
  return { branchGeo, leafGeo, acornGeo, branchGeoFar, leafGeoFar, trunkR, trunkH: P.targetHeight };
}

// Species presets — form follows soil. flora.js places rich on moist lowland,
// lean on dry/high ground (kept in this order so soil can index them).
export const TREE_SPECIES = [
  // leaves spread over the outer three branch levels (leafDepth 3), fewer per
  // tip, so the crown is a deep dome rather than a cap on the outermost twigs
  { name: 'maple-rich', targetHeight: 13, outwardPull: 0.6,  elevTip: 18, leavesPerTip: 11, leavesMid: 6, leafDepth: 3, leafSpread: 1.2 },
  { name: 'maple',      targetHeight: 11, outwardPull: 0.48, elevTip: 22, leavesPerTip: 8,  leavesMid: 5, leafDepth: 3 },
  { name: 'maple-lean', targetHeight: 9,  outwardPull: 0.3,  elevTip: 30, elevBase: 68, leavesPerTip: 6, leavesMid: 3, leafDepth: 3 },
];
export const SHRUB_SPECIES = [
  { ...SHRUB, name: 'shrub-a' },
  { ...SHRUB, name: 'shrub-b', targetHeight: 2.2, outwardPull: 0.8 },
];

// Redwood: an excurrent giant with a strong vertical leader and a conical crown.
// Real coast redwoods (Sequoia sempervirens) have horizontal to slightly drooping
// outer branches — NOT upward-reaching like a fir. The conical silhouette comes
// from branches being longest near mid-height and shorter near the top, with the
// outer tips drooping gracefully. Lower trunk is bare (natural branch shedding).
// Bark is deep reddish-brown with thick vertical furrows.
const REDWOOD = {
  trunkLen: 4.2, baseRad: 0.62, depth: 5, childMin: 2, childMax: 4,
  continuity: 0.66,
  elevBase: 56, elevTip: 20,
  arch: 20,
  outwardPull: 0.30,          // spread branches outward so they don't crowd the trunk
  azJitter: 0.65,             // irregular spacing stops branches from looking regimented
  lenFalloff: 0.79, radFalloff: 0.70, taper: 0.82, radial: 6,
  leavesPerTip: 2, leavesMid: 1, leafDepth: 3, leafSpread: 0.5, leafOut: 0.1,
  leafStyle: 'flat',   // large horizontal disc per branch tier, not individual leaf quads
  leafFinal: 5.5, targetHeight: 34,
  rootCount: 6,
};
export const REDWOOD_SPECIES = [
  { ...REDWOOD, name: 'redwood' },
  { ...REDWOOD, name: 'redwood-tall', targetHeight: 44, baseRad: 0.74, continuity: 0.68, arch: 22 },
];

// Rowan (mountain ash): a small, slender tree of forest edges and upland clearings.
// Open airy crown, grey bark, relatively upright with moderate outward spread.
// Shade-intolerant — grows where canopy is partial, not under heavy oak/maple.
const ROWAN = {
  trunkLen: 1.6, baseRad: 0.15, depth: 4, childMin: 2, childMax: 3,
  continuity: 0.44,
  elevBase: 62, elevTip: 28,
  arch: 14,
  outwardPull: 0.40,
  azJitter: 0.60,
  lenFalloff: 0.75, radFalloff: 0.58, taper: 0.74, radial: 4,
  leavesPerTip: 6, leavesMid: 3, leafDepth: 2, leafSpread: 0.58, leafOut: 0.24,
  leafFinal: 0.30, targetHeight: 9,
  rootCount: 0,
};
export const ROWAN_SPECIES = [
  { ...ROWAN, name: 'rowan' },
  { ...ROWAN, name: 'rowan-tall', targetHeight: 11, baseRad: 0.17, leavesPerTip: 7 },
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

// Birch: a slender, upright tree with a thin trunk, high branching scaffold, and
// characteristic drooping outer tips. Small delicate leaves, pale bark. Often grows
// in clusters; shorter and more elegant than a maple, narrower than a redwood.
const BIRCH = {
  trunkLen: 2.2, baseRad: 0.17, depth: 5, childMin: 2, childMax: 3,
  continuity: 0.54,         // upright scaffold — keeps the slender silhouette
  elevBase: 70, elevTip: 36,
  arch: 24,                 // drooping outer tips — the elegant birch curve
  outwardPull: 0.40,        // moderate — birch is upright, not spreading
  azJitter: 0.52,
  lenFalloff: 0.79, radFalloff: 0.62, taper: 0.76, radial: 5,
  leavesPerTip: 8, leavesMid: 3, leafDepth: 2, leafSpread: 0.65, leafOut: 0.30,
  leafFinal: 0.36, targetHeight: 12,
  rootCount: 2,
};
export const BIRCH_SPECIES = [
  { ...BIRCH, name: 'birch' },
  { ...BIRCH, name: 'birch-tall', targetHeight: 15, continuity: 0.58, baseRad: 0.20 },
  { ...BIRCH, name: 'birch-sapling', targetHeight: 7, baseRad: 0.12, depth: 4, rootCount: 0 },
];

// Scots pine (heath, sandy ridges): a long bare bole — the low branches are shed
// as it grows — under a high, irregular, flat-topped crown of needle clumps.
// Built like the redwood (flat foliage discs) but slimmer, shorter, and with
// fewer, more crooked limbs, so it reads as a pine on open ground, not a giant.
const PINE = {
  trunkLen: 5.5, baseRad: 0.30, depth: 5, childMin: 2, childMax: 3,
  continuity: 0.60,
  elevBase: 48, elevTip: 14,
  arch: 8,
  outwardPull: 0.40,
  azJitter: 0.85,             // crooked, irregular limbs
  lenFalloff: 0.72, radFalloff: 0.64, taper: 0.80, radial: 5,
  leavesPerTip: 2, leavesMid: 0, leafDepth: 2, leafSpread: 0.45, leafOut: 0.1,
  leafStyle: 'flat',
  leafFinal: 2.6, targetHeight: 19,
  rootCount: 3,
};
export const PINE_SPECIES = [
  { ...PINE, name: 'pine' },
  { ...PINE, name: 'pine-tall', targetHeight: 24, trunkLen: 7, baseRad: 0.36 },
  { ...PINE, name: 'pine-young', targetHeight: 11, trunkLen: 2.6, baseRad: 0.18, depth: 4, rootCount: 0 },
];

// Black alder (carr): the tree of wet woods. A straight dark trunk, often
// several from one base in life; an oval, fairly narrow crown of dark, dense
// leaves held to the end of autumn.
const ALDER = {
  trunkLen: 2.4, baseRad: 0.24, depth: 5, childMin: 2, childMax: 3,
  continuity: 0.58,          // keeps a leader: oval, not domed
  elevBase: 64, elevTip: 32,
  arch: 10,
  outwardPull: 0.35,
  azJitter: 0.55,
  lenFalloff: 0.76, radFalloff: 0.62, taper: 0.78, radial: 5,
  leavesPerTip: 11, leavesMid: 5, leafDepth: 2, leafSpread: 0.8, leafOut: 0.35,
  leafFinal: 0.42, targetHeight: 14,
  rootCount: 4,              // stilted roots in waterlogged ground
};
export const ALDER_SPECIES = [
  { ...ALDER, name: 'alder' },
  { ...ALDER, name: 'alder-tall', targetHeight: 18, baseRad: 0.30 },
  { ...ALDER, name: 'alder-young', targetHeight: 9, baseRad: 0.16, depth: 4, rootCount: 2 },
];

definePattern({
  name: 'tree.maple', scale: SCALE.TREE, uses: ['leaf.maple', 'bark.generic'],
  generate: ({ rng, atlas, params }) => generateTree(fork(rng), params || {}, atlas),
});
definePattern({
  name: 'plant.shrub', scale: SCALE.PLANT, uses: ['leaf.maple', 'bark.generic'],
  generate: ({ rng, atlas, params }) => generateTree(fork(rng), { ...SHRUB, ...params }, atlas),
});
