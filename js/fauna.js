import * as THREE from 'three';
import { height } from './terrain.js';

// Fauna renderer — draws the rabbits whose *simulation* lives in agents.js
// (AgentWorld.fauna, the Quarry records). We only read x/z/heading/alive/moving/
// fleeing here and billboard a sprite for each, with a hopping arc. See
// docs/hunting.md. The 288x576 sheet is a 4x8 grid of 72px frames; rows are
// directions (0 away / 1 side / 2 toward / …), columns are hop frames.
const SHEET = 'sprites/fauna/rabbit.png';
const COLS = 4, ROWS = 8;
const ROW_AWAY = 0, ROW_SIDE = 1, ROW_TOWARD = 2;   // the three views we use

function loadTex(src){
  return new Promise((res, rej) => new THREE.TextureLoader().load(src, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    res(t);
  }, undefined, rej));
}
const WHITE = new THREE.Color(1, 1, 1);
const _right = new THREE.Vector3();

export class Warren {
  constructor(scene, fauna){ this.scene = scene; this.fauna = fauna; this.tex = null; this.units = []; }

  async load(){
    this.tex = await loadTex(SHEET);
    for (const rec of this.fauna){
      const tex = this.tex.clone(); tex.needsUpdate = true;
      tex.repeat.set(1 / COLS, 1 / ROWS);
      const h = 0.75 + Math.random() * 0.15;           // small, slight size variance
      const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, transparent: true, fog: true });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(h, h), mat);   // 72x72 → square
      this.scene.add(mesh);
      this.units.push({ rec, mesh, mat, tex, h, phase: Math.random() * 6.28, frameT: 0, col: 0 });
    }
    return this;
  }

  _cell(tex, row, col){ tex.offset.set(col / COLS, 1 - (row + 1) / ROWS); }

  update(cam, dt, tint){
    if (!this.units.length) return;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);     // camera's screen-right in world
    for (const u of this.units){
      const r = u.rec;
      if (!r.alive){ u.mesh.visible = false; continue; }
      u.mesh.visible = true;
      u.mat.color.copy(tint || WHITE);

      // hop: rise on a sine arc while moving (faster, higher when bolting)
      const rate = r.moving ? (r.fleeing ? 12 : 8) : 0;
      u.phase += rate * dt;
      const yOff = r.moving ? Math.abs(Math.sin(u.phase)) * u.h * (r.fleeing ? 0.5 : 0.32) : 0;
      u.mesh.position.set(r.x, height(r.x, r.z) + u.h / 2 + yOff, r.z);

      // billboard toward the camera
      u.mesh.rotation.y = Math.atan2(cam.position.x - r.x, cam.position.z - r.z);

      // which view: moving toward the camera → front, away → back, else side (mirrored)
      const fx = Math.sin(r.heading), fz = Math.cos(r.heading);
      const tcx = cam.position.x - r.x, tcz = cam.position.z - r.z;
      const tl = Math.hypot(tcx, tcz) || 1;
      const dot = (fx * tcx + fz * tcz) / tl;            // >0 moving toward cam
      let row, mirror = 1;
      if (dot > 0.4) row = ROW_TOWARD;
      else if (dot < -0.4) row = ROW_AWAY;
      else { row = ROW_SIDE; mirror = (fx * _right.x + fz * _right.z) > 0 ? -1 : 1; }  // side faces left by default
      u.mesh.scale.x = mirror * Math.abs(u.mesh.scale.x || 1);

      // cycle hop frames while moving, sit on frame 0 at rest
      if (r.moving){ u.frameT += dt; if (u.frameT > (r.fleeing ? 0.08 : 0.12)){ u.frameT = 0; u.col = (u.col + 1) % COLS; } }
      else u.col = 0;
      this._cell(u.tex, row, u.col);
    }
  }
}
