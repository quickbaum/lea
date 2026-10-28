// Boats — communal bark canoes moored along the lakeshores. A boat is a plain
// world object: anyone may climb in (the player with E; NPCs later) and paddle
// across water. The hull is a parametric low-poly canoe, flat-shaded and crisp to
// match the game's look. Boats float at the waterline and bob; an unmanned boat
// sways gently where it was left, a manned one is glued under its rider's camera.
//
// Also the canoe the folk are making on the bank (CanoeBedView, docs/boats.md
// "Making canoes"). Deferred: portaging a canoe overland.

import * as THREE from 'three';
import { WATER, WORLD_R, AREA } from './config.js';
import { height } from './terrain.js';

const HULL = 0x6b4a2b;     // bark-brown
const TRIM = 0x4f3318;     // darker gunwale / thwarts
const PADDLE = 0x8a6a3f;
// how high the hull rides: gunwales sit FLOAT above the waterline, the keel a
// little below — so the canoe floats *on* the water, not submerged in it.
const FLOAT = 0.42;

// A canoe pointed along -Z (the camera's forward at yaw 0), so setting the
// group's rotation.y to a heading aims the bow where you paddle.
function buildCanoe(){
  const g = new THREE.Group();
  const HALF_L = 1.7, BEAM = 0.5, DEPTH = 0.55, N = 12;

  // --- hull: keel line + two gunwale rails, skinned with triangles ---
  const pos = [], idx = [];
  // vertex layout per station i: [keel, portRail, starboardRail]
  for (let i = 0; i <= N; i++){
    const s = i / N * 2 - 1;                 // -1 (bow) .. +1 (stern)
    const taper = Math.sqrt(Math.max(0, 1 - s * s));   // ellipse → fine points
    const z = s * HALF_L;
    const keelY = -DEPTH * taper;            // rocker: ends rise to the waterline
    pos.push(0, keelY, z);                    // keel
    pos.push(-BEAM * taper, 0, z);            // port rail (+? we use -x)
    pos.push( BEAM * taper, 0, z);            // starboard rail
  }
  for (let i = 0; i < N; i++){
    const a = i * 3, b = (i + 1) * 3;         // station i, station i+1
    // port skin (keel→portRail)
    idx.push(a, a + 1, b);  idx.push(b, a + 1, b + 1);
    // starboard skin (keel→starboardRail)
    idx.push(a, b, a + 2);  idx.push(b, b + 2, a + 2);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hg.setIndex(idx);
  hg.computeVertexNormals();
  const hull = new THREE.Mesh(hg, new THREE.MeshLambertMaterial({
    color: HULL, flatShading: true, side: THREE.DoubleSide,
  }));
  g.add(hull);

  // --- gunwale rails: a thin strip along each top edge for definition ---
  const railMat = new THREE.MeshLambertMaterial({ color: TRIM, flatShading: true });
  for (const sign of [-1, 1]){
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, HALF_L * 1.7), railMat);
    rail.position.set(sign * BEAM * 0.7, 0, 0);
    g.add(rail);
  }

  // --- thwarts: a couple of cross-seats ---
  for (const z of [-0.5, 0.5]){
    const tw = new THREE.Mesh(new THREE.BoxGeometry(BEAM * 1.6, 0.06, 0.16), railMat);
    tw.position.set(0, -0.02, z);
    g.add(tw);
  }

  // --- interior floor: tapered strip above the waterline so the water surface
  // doesn't show through the open hull when viewed from above ---
  // FLOAT = 0.42, so water is at boat-local y = −FLOAT = −0.42; floor at −0.25
  // is 17 cm above it. Half-width at each station is 85 % of the hull width
  // at that y level (linear interpolation from keel to rail).
  const FLOOR_Y = -0.25;
  const fp = [], fi = [];
  for (let i = 0; i <= N; i++){
    const s = i / N * 2 - 1;
    const taper = Math.sqrt(Math.max(0, 1 - s * s));
    const z = s * HALF_L;
    const keelDepth = DEPTH * (taper + 1e-6);      // avoids div-by-0 at the tips
    const fhw = Math.max(0, 0.85 * BEAM * (FLOOR_Y / keelDepth + 1));
    fp.push(-fhw, FLOOR_Y, z, fhw, FLOOR_Y, z);
  }
  for (let i = 0; i < N; i++){
    const a = i * 2, b = a + 2;
    fi.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  floorGeo.setIndex(fi);
  floorGeo.computeVertexNormals();
  g.add(new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ color: HULL, flatShading: true })));

  // --- a paddle laid across the gunwales ---
  const paddle = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.4),
    new THREE.MeshLambertMaterial({ color: PADDLE, flatShading: true }));
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.4),
    new THREE.MeshLambertMaterial({ color: PADDLE, flatShading: true }));
  blade.position.set(0, 0, 0.85);
  paddle.add(shaft, blade);
  paddle.position.set(BEAM * 0.3, 0.06, -0.2);
  paddle.rotation.y = 0.25;
  g.add(paddle);

  return g;
}

class Boat {
  // `water`: the level it floats on (the Lea's, unless it's on a cave's lake)
  constructor(x, z, yaw, water = WATER){
    this.x = x; this.z = z; this.yaw = yaw; this.water = water;
    this.aboard = false;
    this._claimed = null;          // an NPC that has reserved this boat for a crossing
    this.deckY = water + FLOAT;     // world Y of the gunwale — where a rider sits
    this.group = buildCanoe();
    this.group.position.set(x, water + FLOAT, z);
    this.group.rotation.y = yaw;
    this._ph = Math.random() * Math.PI * 2;   // bob phase, so boats don't bob in lockstep
  }
  placeAt(x, z, yaw){ this.x = x; this.z = z; this.yaw = yaw; }
  update(dt, t){
    this.group.position.set(this.x, this.water + FLOAT, this.z);
    this.group.rotation.y = this.yaw;
    if (this.aboard){
      this.group.position.y = this.water + FLOAT;    // glued steady under the rider
      this.group.rotation.z = 0;
    } else {
      this.group.position.y = this.water + FLOAT + Math.sin(t * 1.3 + this._ph) * 0.05;   // gentle bob
      this.group.rotation.z = Math.sin(t * 0.9 + this._ph) * 0.04;                   // slow roll
    }
  }
}

export class Boats {
  constructor(scene){ this.scene = scene; this.list = []; }

  add(x, z, yaw, water){
    const b = new Boat(x, z, yaw, water);
    this.scene.add(b.group);
    this.list.push(b);
    return b;
  }

  // Scatter a few moored boats at lake edges: stand on a shore point, look for
  // water nearby, and beach a canoe at the waterline with its bow facing out.
  scatter(rng, n = Math.round(16 * AREA), radius = WORLD_R){
    let placed = 0, tries = 0;
    while (placed < n && tries++ < 750 * n){   // shoreline is a thin target — budget tries per boat
      const x = (rng() - 0.5) * radius * 2, z = (rng() - 0.5) * radius * 2;
      if (Math.hypot(x, z) > radius) continue;
      const h = height(x, z);
      if (h < WATER + 0.1 || h > WATER + 1.6) continue;   // want a shoreline, not deep water or high ground
      // average direction toward nearby water
      let wx = 0, wz = 0, found = 0;
      for (let k = 0; k < 16; k++){
        const a = k / 16 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        if (height(x + c * 4, z + s * 4) < WATER){ wx += c; wz += s; found++; }
      }
      if (!found) continue;
      const len = Math.hypot(wx, wz) || 1; wx /= len; wz /= len;   // unit dir toward water
      // march out from the bank to the first spot deep enough for the hull to float clear
      let bx = null, bz = null;
      for (let step = 1.5; step <= 7; step += 0.6){
        const px = x + wx * step, pz = z + wz * step;
        if (height(px, pz) < WATER - 0.3){ bx = px; bz = pz; break; }
      }
      if (bx === null) continue;                                   // too shallow/flat here — try elsewhere
      // bow points toward the water (forward is -Z at yaw 0, so heading = atan2(-wx,-wz))
      this.add(bx, bz, Math.atan2(-wx, -wz));
      placed++;
    }
    return placed;
  }

  update(dt, t){ for (const b of this.list) b.update(dt, t); }
}

// A canoe being made on the bank (agents.js CanoeBuild). The bed is a patch of
// levelled earth with a row of stakes down each side. Sheets of birch bark are
// laid out on it as they come, and poles beside it; then the hull takes shape:
// the bark's sides bend up against the stakes as the work goes on, and the ribs
// and gunwales go in. Finished, the bed is cleared and a canoe floats off the bank.
const BARK_PALE = 0xd8cdb4;   // a sheet of birch bark, white side up
const EARTH = 0x5a4632;
export class CanoeBedView {
  constructor(b){
    this.b = b;
    const g = this.group = new THREE.Group();
    g.position.set(b.x, height(b.x, b.z), b.z);
    g.rotation.y = b.face + Math.PI / 2;         // along the shore, the water to one side
    const earth = new THREE.MeshLambertMaterial({ color: EARTH, flatShading: true });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 4.2), earth);
    bed.position.y = 0.02; g.add(bed);
    const stakeMat = new THREE.MeshLambertMaterial({ color: TRIM, flatShading: true });
    const stake = new THREE.BoxGeometry(0.05, 0.7, 0.05);
    for (const sx of [-0.62, 0.62]) for (let i = 0; i < 6; i++){
      const st = new THREE.Mesh(stake, stakeMat);
      st.position.set(sx, 0.3, -1.6 + i * 0.64); st.rotation.z = sx * 0.08;   // leaning out a little
      g.add(st);
    }
    // the bark, laid out a sheet at a time
    const barkMat = new THREE.MeshLambertMaterial({ color: BARK_PALE, flatShading: true, side: THREE.DoubleSide });
    this.sheets = [];
    for (let i = 0; i < 3; i++){
      const sh = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 1.35), barkMat);
      sh.position.set(0, 0.07 + i * 0.02, -1.35 + i * 1.35); sh.rotation.y = (i - 1) * 0.06;
      sh.visible = false; g.add(sh); this.sheets.push(sh);
    }
    // the poles, beside the bed
    const poleMat = new THREE.MeshLambertMaterial({ color: PADDLE, flatShading: true });
    this.poles = [];
    for (let i = 0; i < 4; i++){
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.2), poleMat);
      pl.position.set(1.0 + (i % 2) * 0.12, 0.05 + (i >> 1) * 0.08, 0); pl.rotation.y = 0.04 * (i - 1.5);
      pl.visible = false; g.add(pl); this.poles.push(pl);
    }
    // the hull itself, without its paddle: it rises off the bed as the work goes on
    this.hull = buildCanoe();
    this.hull.children[this.hull.children.length - 1].visible = false;
    this.hull.visible = false; g.add(this.hull);
    this.sync();
  }
  sync(){
    const b = this.b, building = b.bark >= 3 && b.ribs >= 4;
    this.sheets.forEach((s, i) => { s.visible = !building && i < b.bark; });
    this.poles.forEach((p, i) => { p.visible = !building && i < b.ribs; });
    this.hull.visible = building;
    if (building){
      const t = Math.min(1, b.work / (b.workNeed || 600));
      const up = 0.12 + 0.88 * t;                  // the sides bend up
      this.hull.scale.set(1, up, 1);
      this.hull.position.y = 0.06 + 0.55 * up;     // keel on the bed
      // ribs and gunwales go in once the sides are up (children 1..4: rails, thwarts)
      for (let i = 1; i <= 4; i++) this.hull.children[i].visible = t > 0.4;
    }
  }
  dispose(){ this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
}
