// toss.js — a hand-over you can see. When one dweller gives another food, wood or
// a valuable (a gift, or each side of a trade; agents.js sends a 'give' event),
// a little sprite of it is tossed in an arc from the giver's hands to the
// receiver's. It's part of the world, so it's drawn in the scene (pixelated like
// everything else), unlike the speech bubbles. The goods themselves change hands
// at once in the sim; this is only the showing of it.

import * as THREE from 'three';
import { makeTossTexture } from './textures.js';
import { height } from './terrain.js';

const FLIGHT_S = 0.6;     // seconds in the air
const ARC      = 0.7;     // how high above the straight line it rises
const RANGE    = 60;      // hand-overs further than this from the player aren't drawn
const SIZE     = 0.28;

const TEX = new Map();
const tex = (item, kind) => {
  const k = item + ':' + (item === 'food' ? kind : '');
  if (!TEX.has(k)) TEX.set(k, makeTossTexture(item, kind));
  return TEX.get(k);
};
const hands = n => (n.rideY != null ? n.rideY : height(n.x, n.z)) + (n.h || 1.7) * (n._curPose === 'sitting' ? 0.35 : 0.55);

export function makeTosses(scene){
  const live = [];
  function onSocial(e, px, pz){
    if (e.type !== 'give' || Math.hypot(e.from.x - px, e.from.z - pz) > RANGE) return;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(e.item, e.kind), transparent: true, alphaTest: 0.5 }));
    sp.scale.set(SIZE, SIZE, 1);
    scene.add(sp);
    live.push({ sp, from: e.from, to: e.to, t: 0 });
  }
  function update(dt, tint){
    for (let i = live.length - 1; i >= 0; i--){
      const k = live[i]; k.t += dt;
      const u = Math.min(1, k.t / FLIGHT_S);
      // follow both ends as they move, so it always lands in the receiver's hands
      const x = k.from.x + (k.to.x - k.from.x) * u, z = k.from.z + (k.to.z - k.from.z) * u;
      const y = hands(k.from) + (hands(k.to) - hands(k.from)) * u + ARC * 4 * u * (1 - u);
      k.sp.position.set(x, y, z);
      k.sp.material.rotation = u * Math.PI * 1.5;
      if (tint) k.sp.material.color.copy(tint);
      if (u >= 1){ scene.remove(k.sp); k.sp.material.dispose(); live.splice(i, 1); }
    }
  }
  return { onSocial, update };
}
