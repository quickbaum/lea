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

export function makeFishingView(scene, { water }){
  const rodMat   = new THREE.LineBasicMaterial({ color: 0x5a3e22 });
  const lineMat  = new THREE.LineBasicMaterial({ color: 0xd8d2c0, transparent: true, opacity: 0.55 });
  const floatMat = new THREE.MeshLambertMaterial({ color: 0xc8342a });
  const floatGeo = new THREE.SphereGeometry(0.08, 8, 6);
  const ringGeo  = new THREE.RingGeometry(0.85, 1, 24).rotateX(-Math.PI / 2);

  const seg = (mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, mat); l.frustumCulled = false; return l;
  };
  const rigs = [];
  for (let i = 0; i < RIGS; i++){
    const rod = seg(rodMat), line = seg(lineMat), float = new THREE.Mesh(floatGeo, floatMat);
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
  let clock = 0;

  // fishers: [{ x, y, z, face, wx, wz, hand? }] — y the ground under them;
  // `hand` overrides where the rod is held (the player's, from the eye).
  // spots: the fishing spots near enough to show rises; px, pz: you.
  function update(fishers, spots, px, pz, dt, evening = 0){
    clock += dt;
    for (let i = 0; i < RIGS; i++){
      const r = rigs[i], f = fishers[i];
      if (!f){ r.rod.visible = r.line.visible = r.float.visible = false; continue; }
      const sx = Math.sin(f.face), sz = Math.cos(f.face);
      const h = f.hand || { x: f.x + sx * 0.25, y: f.y + 0.75, z: f.z + sz * 0.25 };
      const tip = { x: h.x + sx * 2.0, y: h.y + 1.1, z: h.z + sz * 2.0 };
      const bob = Math.sin(clock * 2.1 + i * 1.7) * 0.025 + (f.dip ? -0.06 : 0);
      set(r.rod, h.x, h.y, h.z, tip.x, tip.y, tip.z);
      set(r.line, tip.x, tip.y, tip.z, f.wx, water + 0.05 + bob, f.wz);
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
