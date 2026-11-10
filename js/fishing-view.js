// fishing-view.js — what fishing looks like (docs/fishing.md): a rod and a line
// from whoever sits on the bank, a float on the water that rides the ripples,
// and now and then a ring where a fish rises. Rises come more often where the
// water is well stocked and at the evening rise, so you can read a good spot by
// watching it. The spots and the catching are js/gen/fishing.js and agents.js.

import * as THREE from 'three';

const RIGS     = 12;     // fishers drawn at once (the nearest)
const RINGS    = 10;
const RISE_R   = 90;     // rises shown within this of you
const RISE_P   = 0.05;   // rises per second at a full spot, by day
const RISE_T   = 2.4;    // seconds a ring takes to spread and fade
const ROD_PTS  = 7;      // a rod's a curve, butt to tip, so it can bend
const LINE_PTS = 6;      // …and the line sags from the tip to the float
// how long each rod is (u), and how far it rises from the hand: a hand line is a stub of stick
const ROD_LEN  = { 'hand line': 0.6, 'fishing pole': 2.3, 'jointed rod': 2.8 };

export function makeFishingView(scene, { water }){
  const rodMat   = new THREE.LineBasicMaterial({ color: 0x5a3e22 });
  const lineMat  = new THREE.LineBasicMaterial({ color: 0xd8d2c0, transparent: true, opacity: 0.55 });
  const floatMat = new THREE.MeshLambertMaterial({ color: 0xc8342a });
  const floatGeo = new THREE.SphereGeometry(0.08, 8, 6);
  const ringGeo  = new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2);

  const seg = (mat, n = 2) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const l = new THREE.Line(g, mat); l.frustumCulled = false; return l;
  };
  const rigs = [];
  for (let i = 0; i < RIGS; i++){
    const rod = seg(rodMat, ROD_PTS), line = seg(lineMat, LINE_PTS), float = new THREE.Mesh(floatGeo, floatMat);
    rod.visible = line.visible = float.visible = false;
    scene.add(rod, line, float);
    rigs.push({ rod, line, float });
  }
  const rings = [];
  for (let i = 0; i < RINGS; i++){
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8ea, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; scene.add(m);
    rings.push({ m, t: 0 });
  }
  const set = (l, ax, ay, az, bx, by, bz) => {
    const p = l.geometry.attributes.position.array;
    p[0] = ax; p[1] = ay; p[2] = az; p[3] = bx; p[4] = by; p[5] = bz;
    l.geometry.attributes.position.needsUpdate = true; l.visible = true;
  };
  // a curve through n points: from a toward b, the middle pulled down by `sag` (quadratic)
  const curve = (l, n, ax, ay, az, bx, by, bz, sag) => {
    const p = l.geometry.attributes.position.array;
    for (let i = 0; i < n; i++){
      const t = i / (n - 1), drop = sag * 4 * t * (1 - t);
      p[i * 3] = ax + (bx - ax) * t; p[i * 3 + 1] = ay + (by - ay) * t - drop; p[i * 3 + 2] = az + (bz - az) * t;
    }
    l.geometry.attributes.position.needsUpdate = true; l.visible = true;
  };
  let clock = 0;

  // fishers: [{ x, y, z, face, wx, wz, hand?, rod?, bite? }] — y the ground under them;
  // `hand` overrides where the rod is held (the player's, from the eye); `rod` its kind
  // (js/tackle.js; the folk's are poles); `bite` 'nibble' (the float twitches) or 'take'
  // (it goes under, and the rod tip bows to the water).
  // spots: the fishing spots near enough to show rises; px, pz: you.
  function update(fishers, spots, px, pz, dt, evening = 0){
    clock += dt;
    for (let i = 0; i < RIGS; i++){
      const r = rigs[i], f = fishers[i];
      if (!f){ r.rod.visible = r.line.visible = r.float.visible = false; continue; }
      // aim along the way to the float (a player's hand is off to one side of it)
      const h = f.hand || { x: f.x + Math.sin(f.face) * 0.25, y: f.y + 0.75, z: f.z + Math.cos(f.face) * 0.25 };
      const ax = f.wx - h.x, az = f.wz - h.z, ad = Math.hypot(ax, az) || 1, sx = ax / ad, sz = az / ad;
      const L = ROD_LEN[f.rod] ?? ROD_LEN['fishing pole'], take = f.bite === 'take';
      // the tip: up at about 30 degrees, bowed down toward the water when a fish has it
      const up = take ? 0.18 : 0.5, out = Math.sqrt(1 - up * up);
      const tip = { x: h.x + sx * L * out, y: h.y + L * up, z: h.z + sz * L * out };
      const bob = take ? -0.16 : f.bite === 'nibble' ? (Math.sin(clock * 23 + i) > 0.55 ? -0.05 : 0) : Math.sin(clock * 2.1 + i * 1.7) * 0.025;
      curve(r.rod, ROD_PTS, h.x, h.y, h.z, tip.x, tip.y, tip.z, (take ? 0.3 : 0.05) * L / 2.3);   // a droop of its own weight; bowed, with a fish on
      curve(r.line, LINE_PTS, tip.x, tip.y, tip.z, f.wx, water + 0.05 + bob, f.wz, take ? 0 : 0.12);   // slack till it's taken
      r.float.position.set(f.wx, water + 0.05 + bob, f.wz); r.float.visible = true;
    }
    // a fish rises: a ring spreads on the water, more often where there are more
    for (const s of spots){
      if (Math.hypot(s.wx - px, s.wz - pz) > RISE_R) continue;
      if (Math.random() > RISE_P * s.stock * (1 + 2 * evening) * dt) continue;
      const g = rings.find(q => !q.m.visible);
      if (!g) break;
      const a = Math.random() * Math.PI * 2, d = 1 + Math.random() * 4;
      g.m.position.set(s.wx + Math.sin(a) * d, water + 0.03, s.wz + Math.cos(a) * d);
      g.t = 0; g.m.visible = true;
    }
    for (const g of rings){
      if (!g.m.visible) continue;
      g.t += dt;
      const k = g.t / RISE_T;
      if (k >= 1){ g.m.visible = false; continue; }
      g.m.scale.setScalar(0.15 + 1.1 * k);
      g.m.material.opacity = 0.6 * (1 - k);
    }
  }
  return { update };
}
