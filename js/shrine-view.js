// Shrine view — the stones the folk lay around a great faced tree.
//
// The sim side (js/agents.js → Shrine) owns the rings, the gateways and which
// slots are filled; it knows nothing of Three.js. main.js injects this via
// AgentWorld's makeShrineView, and the headless harness simply doesn't — so the
// rite runs and is tested with no meshes at all.
//
// One InstancedMesh per shrine, sized to every slot, with unfilled slots scaled to
// nothing; sync() is called by Shrine.place() when a stone goes down. Ordinary
// stones are grey field rock; the innermost precinct holds what people actually
// gave up — a shell, amber, quartz — so those instances are tinted and sit a
// little brighter (SACRED SITES 24: "a tree, or rock or stone, takes on the power
// through which people can connect themselves to their own past").

import * as THREE from 'three';
import { height } from './terrain.js';

// what an offered valuable looks like once it is laid down
const OFFER_COLOR = {
  stone:  0x8a8378,
  shell:  0xe8dcc6,
  amber:  0xc8862a,
  quartz: 0xd8e2ea,
};
const PLAIN = new THREE.Color(0x7d766b);

// one lumpy rock, reused for every stone (rotation + scale make them differ)
function rockGeometry(){
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  const p = g.attributes.position;
  // squash it down and rough it up so it reads as field stone, not a ball
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.82 + ((i * 37) % 13) / 13 * 0.36;
    p.setXYZ(i, x * n, y * 0.55 * n, z * n);
  }
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class ShrineView {
  constructor(shrine){
    this.shrine = shrine;
    shrine.view = this;

    const slots = shrine.rings.flatMap(r => r.slots);
    this.slots = slots;
    const geo = rockGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const inst = new THREE.InstancedMesh(geo, mat, slots.length);
    inst.frustumCulled = false;
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(slots.length * 3), 3);
    for (let i = 0; i < slots.length; i++) inst.setMatrixAt(i, ZERO);   // nothing laid yet
    inst.instanceMatrix.needsUpdate = true;
    this.inst = inst;
    shrine.group = this.group = inst;
    this.sync();
  }

  // called when a stone is placed (Shrine.place)
  sync(){
    const inst = this.inst;
    let changed = false;
    for (let i = 0; i < this.slots.length; i++){
      const s = this.slots[i];
      if (!s.kind || s._shown) continue;
      const sc = s.size * (s.precious ? 0.5 : 0.62);       // offerings are smaller, finer things
      _q.setFromAxisAngle(_up, s.yaw);
      _v.set(s.x, height(s.x, s.z) + sc * 0.22, s.z);      // seated into the turf
      _s.set(sc, sc * (s.precious ? 0.8 : 1), sc);
      _m.compose(_v, _q, _s);
      inst.setMatrixAt(i, _m);
      _c.set(s.precious ? (OFFER_COLOR[s.kind] ?? OFFER_COLOR.stone) : PLAIN.getHex());
      inst.setColorAt(i, _c);
      s._shown = true; changed = true;
    }
    if (changed){
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  }
}
