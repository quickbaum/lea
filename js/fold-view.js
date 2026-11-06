// A sheepfold, drawn (docs/sheep.md): wattle hurdles round a rectangle, as the crofts have, with a gap to the sun and one
// hurdle hung in it as a gate. Everything but the gates merges into one mesh per material.
import * as THREE from 'three';
import { Geo, settlementGeos, settlementMaterials } from './settle-view.js';
import { addDressed } from './house-view.js';
import { mulberry32 } from './rng.js';

const H = 0.95, STEP = 2.6;   // a hurdle's height and length: taller than a croft's, to hold a sheep

export function buildFolds(scene, folds, huts, ground){
  if (!folds.length) return { update(){} };
  const G = settlementGeos(), mats = settlementMaterials(), gates = [];
  for (const f of folds){
    const lx = Math.cos(f.a), lz = Math.sin(f.a), cx = -lz, cz = lx;
    const P = (u, v, y = 0) => { const x = f.x + lx * u + cx * v, z = f.z + lz * u + cz * v; return [x, ground(x, z) + y, z]; };
    const run = (from, to, pos, gated, out) => {
      const n = Math.max(1, Math.round(Math.abs(to - from) / STEP));
      for (let i = 0; i < n; i++){
        const a = from + (to - from) * i / n, b = from + (to - from) * (i + 1) / n;
        if (gated && Math.abs((a + b) / 2) < f.gap) continue;
        const pa = pos(a), pb = pos(b), L = Math.abs(b - a) / 2.8, t = 0.9 + ((i * 7) % 3) * 0.06;
        G.wattle.quad(pa(0), pb(0), pb(H), pa(H), [0, 0], [L, 0], [L, 1], [0, 1], out, [t, t, 0.84]);
        const top = pa(H + 0.14), foot = pa(-0.1);
        G.timber.tbox(foot[0], foot[2], foot[1], top[1], 0.13, 0.13, f.a, [0.34, 0.28, 0.2], 3);
      }
    };
    for (const s of [-1, 1]){
      run(-f.hl, f.hl, u => y => P(u, s * f.hw, y), s === 1, [cx * s, 0, cz * s]);
      run(-f.hw, f.hw, v => y => P(s * f.hl, v, y), false, [lx * s, 0, lz * s]);
    }
    // the gate: one hurdle hung from the gap's post
    const g = new Geo(), W = f.gap * 2;
    g.quad([0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, 0], [W / 2.8, 0], [W / 2.8, 1], [0, 1], [0, 0, 1], [0.95, 0.95, 0.84]);
    g.quad([0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0], [0, 0], [W / 2.8, 0], [W / 2.8, 1], [0, 1], [0, 0, -1], [0.95, 0.95, 0.84]);
    const mesh = g.mesh(mats.wattle), hinge = P(-f.gap, f.hw, 0);
    mesh.position.set(hinge[0], hinge[1], hinge[2]);
    scene.add(mesh);
    gates.push({ f, mesh, swing: 0 });
  }
  // the huts, as the village's own buildings are drawn
  const r = mulberry32(0xf01d);
  for (const h of huts) addDressed(G, h, r, ground);
  for (const k of Object.keys(G)){ const m = G[k].mesh(mats[k]); if (m) scene.add(m); }
  return {
    update(dt){
      for (const g of gates){
        const want = g.f.open ? 1.45 : 0;              // swung back against the outside of the fold, or shut
        if (Math.abs(g.swing - want) < 0.001) continue;
        g.swing += Math.sign(want - g.swing) * Math.min(Math.abs(want - g.swing), dt * 1.4);
        g.mesh.rotation.y = -g.f.a - g.swing;
      }
    },
  };
}
