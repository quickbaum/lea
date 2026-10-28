import * as THREE from 'three';
import { alongPath } from './gen/faerie.js';

// faerie-view.js — what the fairy salve shows (docs/magic.md "Faerie palaces"): what's
// in the Lea all along under glamour. While your eye is anointed, the whole Lea over:
//   · the portals to the Gentry's palaces (gen/faerie.js planPortals): an upright oval of
//     black, lights spiralling into it from the front and out of it again
//   · the Gentry, tall pale figures walking the paths between the portals; one you come
//     near fades away, and is further along its path when you look again
// Pure scene decoration, no rules: main.js decides when the sight opens and closes, and
// what E does at a portal. Nothing here is drawn until start().

const SPIRAL = 90;          // lights round each portal
const OVAL = [1.5, 2.6];    // a portal's half-width and half-height
const SPACING = 60;         // one figure on a path for every so many units of it
const SHOWN = 14;           // at most this many figures drawn, the nearest
const SEE = 140;            // and none further than this
const SHY = 7;              // closer than this and a figure fades away
const PACE = 1.1;           // how fast they walk (u/s)
const FADE = 1.2;           // seconds to fade the whole sight in or out

// a tall, soft, pale shape, head and shoulders and a long fall of robe: drawn once,
// every figure shares it
function figureTexture(){
  const c = document.createElement('canvas'); c.width = 64; c.height = 192;
  const g = c.getContext('2d');
  const body = g.createLinearGradient(0, 30, 0, 192);
  body.addColorStop(0, 'rgba(235,245,255,0.9)'); body.addColorStop(0.7, 'rgba(215,235,250,0.55)'); body.addColorStop(1, 'rgba(215,235,250,0)');
  g.fillStyle = body;
  g.beginPath(); g.moveTo(32, 34); g.bezierCurveTo(52, 40, 54, 70, 58, 192); g.lineTo(6, 192); g.bezierCurveTo(10, 70, 12, 40, 32, 34); g.fill();
  const head = g.createRadialGradient(32, 22, 2, 32, 22, 14);
  head.addColorStop(0, 'rgba(245,250,255,0.95)'); head.addColorStop(1, 'rgba(245,250,255,0)');
  g.fillStyle = head; g.beginPath(); g.arc(32, 22, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// one round soft dot, for the lights
function moteTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'), r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
const TINTS = [[0.75, 1, 0.8], [1, 0.95, 0.65], [0.7, 0.9, 1]];

export class FaerieSight {
  constructor(scene, height){
    this.scene = scene; this.height = height;
    this.on = false; this.k = 0; this.t = 0;          // k: how far faded in, 0..1
    this.group = new THREE.Group(); this.group.visible = false; scene.add(this.group);
    this.moteTex = moteTexture(); this.figTex = figureTexture();
    this.portals = []; this.paths = []; this.walkers = []; this.figs = [];
    this.ovalMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, transparent: true, opacity: 0, fog: false });
    this.moteMat = new THREE.PointsMaterial({ size: 0.3, map: this.moteTex, vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    for (let q = 0; q < SHOWN; q++){
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.figTex, transparent: true, opacity: 0, depthWrite: false, color: 0xdfeeff }));
      s.scale.set(0.75, 2.25, 1); s.visible = false; this.group.add(s); this.figs.push(s);
    }
  }
  // the portals and the paths between them (gen/faerie.js): once, before the first start()
  setWorld(portals, paths){
    this.portals = portals.map(p => {
      const g = new THREE.Group();
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = Math.PI / 2 - p.face;          // its plane across the way it faces
      const oval = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.ovalMat);
      oval.scale.set(OVAL[0], OVAL[1], 1); oval.position.y = OVAL[1] + 0.1; g.add(oval);
      const geo = new THREE.BufferGeometry(), P = new Float32Array(SPIRAL * 3), C = new Float32Array(SPIRAL * 3);
      for (let i = 0; i < SPIRAL; i++) C.set(TINTS[i % 3], i * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      const pts = new THREE.Points(geo, this.moteMat); pts.frustumCulled = false; g.add(pts);
      this.group.add(g);
      return { p, g, pts, seeds: Array.from({ length: SPIRAL }, (_, i) => ({ s: Math.random(), a: Math.random() * Math.PI * 2, out: i % 2, v: 0.08 + Math.random() * 0.08 })) };
    });
    this.paths = paths;
    this.walkers = paths.flatMap((P, pi) => { const n = Math.max(2, Math.ceil(P.len / SPACING)); return Array.from({ length: n }, (_, q) => ({ pi, s: P.len * (q + Math.random() * 0.5) / n, dir: q % 2 ? -1 : 1, a: 0, gone: 0, d: Infinity })); });
  }
  start(){ this.on = true; this.group.visible = true; }
  stop(){ this.on = false; }
  get active(){ return this.on || this.k > 0; }
  update(dt, cam){
    this.k = Math.max(0, Math.min(1, this.k + (this.on ? dt : -dt) / FADE));
    if (!this.k){ this.group.visible = false; return; }
    this.t += dt;
    this.ovalMat.opacity = this.k * 0.92;
    this.moteMat.opacity = this.k * (0.8 + 0.2 * Math.sin(this.t * 1.7));
    // the lights round each portal near enough to see: half spiral in to its middle from
    // in front, half spiral out of it behind and drift away
    for (const P of this.portals){
      const near = Math.hypot(P.p.x - cam.x, P.p.z - cam.z) < SEE;
      P.g.visible = near; if (!near) continue;
      const A = P.pts.geometry.attributes.position.array;
      for (let i = 0; i < SPIRAL; i++){
        const m = P.seeds[i]; m.s = (m.s + m.v * dt) % 1;
        const f = m.out ? m.s : 1 - m.s, rad = 0.1 + 1.25 * f, ang = m.a + (m.out ? 1 : -1) * m.s * Math.PI * 5;
        A[i * 3] = Math.cos(ang) * rad * OVAL[0];
        A[i * 3 + 1] = OVAL[1] + 0.1 + Math.sin(ang) * rad * OVAL[1];
        A[i * 3 + 2] = (m.out ? -1 : 1) * f * 1.8;
      }
      P.pts.geometry.attributes.position.needsUpdate = true;
    }
    // the walkers: along their paths, turning at the ends; shy of you
    for (const w of this.walkers){
      const P = this.paths[w.pi];
      if (w.gone > 0){ w.gone -= dt; continue; }
      w.s += w.dir * PACE * dt;
      if (w.s > P.len){ w.s = P.len; w.dir = -1; } else if (w.s < 0){ w.s = 0; w.dir = 1; }
      const [x, z] = alongPath(P, w.s); w.x = x; w.z = z;
      const d = Math.hypot(x - cam.x, z - cam.z); w.d = d;
      if (d < SHY) w.a = Math.max(0, w.a - dt / 0.6); else w.a = Math.min(1, w.a + dt / 2.5);
      if (d < SHY && w.a <= 0){ w.s = Math.max(0, Math.min(P.len, w.s + w.dir * (20 + Math.random() * 25))); w.gone = 1 + Math.random() * 2; }
    }
    const show = this.walkers.filter(w => w.gone <= 0 && w.d < SEE).sort((a, b) => a.d - b.d).slice(0, SHOWN);
    this.figs.forEach((s, q) => {
      const w = show[q];
      if (!w){ s.visible = false; return; }
      s.visible = true; s.position.set(w.x, this.height(w.x, w.z) + 1.1, w.z);
      s.material.opacity = this.k * w.a * 0.55;
    });
  }
}
