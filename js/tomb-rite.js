// tomb-rite.js — a letter brought to the right tomb (docs/skeletons.md, "The dead and their kin"):
// the slab slides off, the bones in it fly together beside it, and when the talk is done they drop
// back over the side and the slab slides home. main.js opens the talk at `onUp` and calls done() after.
//
//   const rite = makeTombRite(kit);
//   rite.open({ L, view, p, x, z, onUp })   // p: the coffin prop; (x, z): where you stand
//   rite.done()                             // the talk's over: back in, and shut
//   rite.update(dt, L, camera)              // each frame; leaving the level ends it at once
//   rite.busy                               // no second one while this one's going

import { makeSkeleton } from './skeleton.js';

const OPEN = 1.5, SHUT = 1.3;      // s, the slab's travel
const CLEAR = 3.9;                 // u from the tomb's middle to the end of a slab that has tipped to the floor
const smooth = k => k * k * (3 - 2 * k);

export function makeTombRite(kit){
  let at = null;     // { L, view, p, S, dir, room, k, phase, onUp }
  const rite = {
    get busy(){ return !!at; },
    open({ L, view, p, x, z, onUp }){
      if (at) return false;
      const c = Math.cos(p.a), s = Math.sin(p.a);
      // the slab goes off the end with room for it, tipping to the floor; with no room it only slides partway
      const clear = d => L.walkable(p.x + c * d * CLEAR, p.z + s * d * CLEAR);
      const dir = clear(1) ? 1 : clear(-1) ? -1 : 1, room = clear(dir);
      // it stands at the long side nearer you, or the other if that side's wall
      const side = -s * (x - p.x) + c * (z - p.z) >= 0 ? 1 : -1, off = p.hw + 0.75;
      const spot = q => [p.x - s * q * off, p.z + c * q * off];
      const [sx, sz] = L.walkable(...spot(side)) ? spot(side) : spot(-side);
      const into = { x: p.x, z: p.z, y: p.y + p.h - 0.2, hl: p.hl, hw: p.hw, a: p.a };
      const S = makeSkeleton(kit, { x: sx, z: sz, floorAt: L.floorAt, lit: true, into, seed: ((p.x * 31 + p.z * 17) | 0) + 1 });
      S.object.visible = false;      // under the slab until it moves
      view.scene.add(S.object);
      at = { L, view, p, S, dir, room, into, k: 0, phase: 'opening', onUp };
      return true;
    },
    done(){
      if (!at || at.phase !== 'up') return;
      at.S.talking = false; at.S.collapse({ into: at.into }); at.phase = 'falling';
    },
    update(dt, L, camera){
      if (!at) return;
      if (L !== at.L){ end(); return; }     // gone: the view may not outlive this, and the geometry's rebuilt shut
      const { S } = at;
      if (at.phase === 'opening'){
        at.k = Math.min(1, at.k + dt / OPEN); slab();
        if (at.k > 0.25) S.object.visible = true;
        if (at.k >= 1){ S.assemble(); at.phase = 'rising'; }
      } else if (at.phase === 'rising'){
        if (S.state === 'up'){ at.phase = 'up'; S.talking = true; at.onUp(); }
      } else if (at.phase === 'falling'){
        if (S.state === 'pile') at.phase = 'closing';
      } else if (at.phase === 'closing'){
        at.k = Math.max(0, at.k - dt / SHUT); slab();
        if (at.k < 0.2) S.object.visible = false;
        if (at.k <= 0){ end(); return; }
      }
      S.update(dt, camera);
    },
  };
  const slab = () => at.view.setSlab?.(at.p, smooth(at.k), at.dir, at.room);
  const end = () => { at.S.dispose(); at.view.setSlab?.(at.p, 0, at.dir, at.room); at = null; };
  return rite;
}
