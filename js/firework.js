import * as THREE from 'three';

// Fireworks — coloured bursts high in the Lea's sky, launched by cross-app
// events. A Tetris line clear ships the cleared cells' colours (see
// apps/lea-celestial-events.md and apps/lea-rumor-intake.md); the firework is
// the visible half of the occasion, the rumour it seeds is the other. Pure scene
// decoration: one short-lived THREE.Points burst per firework — expanding,
// arcing under gravity, fading out. Bigger clears (more rows) burst bigger and
// brighter. No dependency on the outside world; if never launched, it does
// nothing, so the public deployment is unaffected.

const GRAV = 26;             // downward pull (world units / s^2)
const DRAG = 0.62;           // fraction of velocity kept per second (air brake)
const LIFE = [1.6, 2.4];     // seconds a burst lives

function toColor(c){
  let col;
  try { col = new THREE.Color(c); } catch { col = new THREE.Color('#ffd24d'); }
  // additive blending makes dark colours invisible against the sky — lift any
  // dim colour so every grain actually reads as light.
  const m = Math.max(col.r, col.g, col.b);
  if (m === 0) col.setRGB(1, 1, 1);
  else if (m < 0.6){ const s = 0.6 / m; col.setRGB(col.r*s, col.g*s, col.b*s); }
  return col;
}

export class Fireworks {
  constructor(scene){
    this.scene = scene;
    this.bursts = [];
  }

  // payload: { colors: [css-colour…], rows: 1..4 }
  launch(payload = {}){
    const rows = Math.max(1, Math.min(4, (payload.rows | 0) || 1));
    const palette = (Array.isArray(payload.colors) && payload.colors.length)
      ? payload.colors.map(toColor) : [toColor('#ffd24d')];
    const count = 60 + rows * 60;                 // 120..300 grains

    // origin: if the caller gives a point (ahead of the player's view), bloom
    // there with a little jitter so it's reliably seen; otherwise a random
    // bearing overhead, well above the treeline.
    let ox, oy, oz;
    if (payload.at){
      ox = payload.at.x + (Math.random() - 0.5) * 26;
      oz = payload.at.z + (Math.random() - 0.5) * 26;
      oy = (payload.at.y != null ? payload.at.y : 80) + Math.random() * 20 + rows * 4;
    } else {
      const az = Math.random() * Math.PI * 2;
      const rad = 45 + Math.random() * 70;
      ox = Math.cos(az) * rad; oz = Math.sin(az) * rad;
      oy = 80 + Math.random() * 55 + rows * 6;
    }
    const spread = 10 + rows * 4;                 // burst speed

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++){
      pos[i*3] = ox; pos[i*3+1] = oy; pos[i*3+2] = oz;
      // an even random direction on the unit sphere, then out at a random speed
      const u = Math.random()*2 - 1, th = Math.random()*Math.PI*2, s = Math.sqrt(1 - u*u);
      const sp = spread * (0.4 + Math.random()*0.6);
      vel[i*3]   = s*Math.cos(th)*sp;
      vel[i*3+1] = u*sp + 2;                       // faint upward bias so it blooms
      vel[i*3+2] = s*Math.sin(th)*sp;
      const c = palette[(Math.random()*palette.length) | 0];
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.2 + rows*0.5, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, life: LIFE[0] + Math.random()*(LIFE[1]-LIFE[0]), age: 0 });

    // cap concurrent bursts so a flurry of clears can't pile up unbounded
    while (this.bursts.length > 12) this._retire(this.bursts.shift());
    return { x: ox, y: oy, z: oz, count };
  }

  _retire(b){
    this.scene.remove(b.points);
    b.points.geometry.dispose();
    b.points.material.dispose();
  }

  update(dt){
    if (!this.bursts.length) return;
    const drag = Math.pow(DRAG, dt);
    for (let k = this.bursts.length - 1; k >= 0; k--){
      const b = this.bursts[k];
      b.age += dt;
      const p = b.points.geometry.attributes.position.array;
      const v = b.vel;
      for (let i = 0; i < v.length; i += 3){
        v[i]   *= drag;
        v[i+1]  = v[i+1]*drag - GRAV*dt;
        v[i+2] *= drag;
        p[i] += v[i]*dt; p[i+1] += v[i+1]*dt; p[i+2] += v[i+2]*dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      const t = b.age / b.life;
      b.points.material.opacity = Math.max(0, 1 - t*t);   // ease-out fade
      if (b.age >= b.life){ this._retire(b); this.bursts.splice(k, 1); }
    }
  }
}
