import * as THREE from 'three';

// A ball of light thrown from your hand (docs/skeletons.md, "Light against the dead"): a hot
// white core in a soft gold glow, flying fast and homing on what it was thrown at, and on
// arrival a flash and a spray of sparks. It's all additive sprites, no real light: adding a
// light to a level's scene mid-play recompiles every lit material in it (under-view.js keeps
// fixed pools of lights for that reason), and a stutter on every throw would be worse than
// walls that don't catch the glow.
//
//   const bolts = makeBolts();
//   bolts.cast(scene, from: Vector3, aim: () => Vector3, onHit)
//   each frame: bolts.update(dt)
//   bolts.clear()   on leaving the scene

const SPEED = 28;            // u/s
const LIFE = 2;              // s before a bolt that never arrives fizzles out
let TEX = null;
function glowTex(){
  if (TEX) return TEX;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,240,190,0.9)');
  r.addColorStop(0.55, 'rgba(255,200,110,0.35)'); r.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  TEX = new THREE.CanvasTexture(c); TEX.colorSpace = THREE.SRGBColorSpace;
  return TEX;
}
const glow = (size, color = 0xffffff) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(size); s.renderOrder = 10;
  return s;
};

export function makeBolts(){
  const live = [];             // { kind: 'bolt' | 'spark' | 'flash', obj, ... }
  const v = new THREE.Vector3();
  function burst(scene, at){
    const f = glow(2.2, 0xfff2c0); f.position.copy(at); scene.add(f);
    live.push({ kind: 'flash', obj: f, scene, t: 0, life: 0.35 });
    for (let i = 0; i < 14; i++){
      const s = glow(0.22, 0xffe6a0); s.position.copy(at); scene.add(s);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, k = Math.sqrt(1 - u * u), sp = 2 + Math.random() * 4;
      live.push({ kind: 'spark', obj: s, scene, t: 0, life: 0.4 + Math.random() * 0.4, vel: new THREE.Vector3(Math.cos(a) * k * sp, u * sp + 1.5, Math.sin(a) * k * sp) });
    }
  }
  return {
    cast(scene, from, aim, onHit){
      const obj = new THREE.Group(), halo = glow(0.9, 0xffd890), core = glow(0.28);
      obj.add(halo, core); obj.position.copy(from); scene.add(obj);
      live.push({ kind: 'bolt', obj, halo, scene, t: 0, aim, onHit });
    },
    update(dt){
      for (let i = live.length - 1; i >= 0; i--){
        const b = live[i]; b.t += dt;
        let done = false;
        if (b.kind === 'bolt'){
          const to = b.aim(), d = v.subVectors(to, b.obj.position).length(), step = SPEED * dt;
          b.halo.scale.setScalar(0.9 + 0.15 * Math.sin(b.t * 40));          // it flickers as it flies
          if (d <= step){ b.obj.position.copy(to); burst(b.scene, to); b.onHit?.(); done = true; }
          else { b.obj.position.addScaledVector(v.normalize(), step); done = b.t > LIFE; }
        } else {
          const k = b.t / b.life;
          if (b.kind === 'spark'){ b.vel.y -= 6 * dt; b.obj.position.addScaledVector(b.vel, dt); b.obj.material.opacity = 1 - k; }
          else { b.obj.scale.setScalar(2.2 * (1 + k)); b.obj.material.opacity = 1 - k; }
          done = k >= 1;
        }
        if (done){ b.obj.removeFromParent(); b.obj.traverse(o => o.material?.dispose()); live.splice(i, 1); }
      }
    },
    clear(){ for (const b of live){ b.obj.removeFromParent(); b.obj.traverse(o => o.material?.dispose()); } live.length = 0; },
  };
}
