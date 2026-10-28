// The ruins, drawn (js/gen/ruins.js plans them): broken walls of coursed
// rubble stone, mossed along their tops, standing stones in their rings, and
// fallen blocks lying in the grass; the abbey's arches and rose as rings of
// voussoirs, and its fallen pier drums on their sides. Each ruin is one merged mesh, static,
// frustum-culled by ruin.

import * as THREE from 'three';
import { ruins } from './terrain.js';
import { Geo } from './settle-view.js';
import { mulberry32 } from './rng.js';
import { ashlar } from './stone-tex.js';
import { UNITS_PER_M } from './config.js';

const TILE = 2 * UNITS_PER_M;            // world size of one texture tile (2 m)

let MAT = null;
// worn ashlar with depth (stone-tex.js): chipped arrises and eroded joints in the
// normal map as well as the colour, and mossier than underground — these stand
// in the weather
const material = () => {
  if (MAT) return MAT;
  const t = ashlar(0x5707e, { courses: 4, len: [10, 22], wear: 1.4, tone: [134, 128, 114], moss: 0.5 });
  return MAT = new THREE.MeshLambertMaterial({ map: t.map, normalMap: t.normalMap, vertexColors: true });
};

// One block: an oriented box from y0 up h, its top drawn in `topC`, narrowing
// to `taper` of its footprint at the top (a standing stone), world-space UVs.
function block(G, o, col, topC, taper = 1){
  const c = Math.cos(o.a), s = Math.sin(o.a), y0 = o.y0, y1 = o.y0 + o.h;
  const P = (u, v, y) => [o.x + c * u - s * v, y, o.z + s * u + c * v];
  const out = (u, v) => [c * u - s * v, 0, s * u + c * v];
  const { hl, hw } = o, tl = hl * taper, tw = hw * taper;
  const uv = (along, y) => [along / TILE, (y - y0) / TILE];
  // four sides: [bottom-left, bottom-right] corners in (u, v), and the outward normal
  for (const [u0, v0, u1, v1, ou, ov, L] of [
    [-hl, -hw, hl, -hw, 0, -1, 2 * hl], [hl, -hw, hl, hw, 1, 0, 2 * hw],
    [hl, hw, -hl, hw, 0, 1, 2 * hl], [-hl, hw, -hl, -hw, -1, 0, 2 * hw]]){
    const k = taper, ou0 = u0 * k, ov0 = v0 * k, ou1 = u1 * k, ov1 = v1 * k;
    G.quad(P(u0, v0, y0), P(u1, v1, y0), P(ou1, ov1, y1), P(ou0, ov0, y1),
      uv(0, y0), uv(L, y0), uv(L - (L - L * k) / 2, y1), uv((L - L * k) / 2, y1), out(ou, ov), col);
  }
  G.quad(P(-tl, -tw, y1), P(tl, -tw, y1), P(tl, tw, y1), P(-tl, tw, y1),
    [0, 0], [2 * tl / TILE, 0], [2 * tl / TILE, 2 * tw / TILE], [0, 2 * tw / TILE], [0, 1, 0], topC);
  // one hanging over a door or round a rose shows its underside
  if (o.lift) G.quad(P(-hl, -hw, y0), P(hl, -hw, y0), P(hl, hw, y0), P(-hl, hw, y0),
    [0, 0], [2 * hl / TILE, 0], [2 * hl / TILE, 2 * hw / TILE], [0, 2 * hw / TILE], [0, -1, 0], col);
}

// A ring of voussoirs (gen/ruins.js ring()): an annulus in a wall's plane, hw
// deep either side of it, from angle t0 to t1, in steps of about 10°.
function voussoirs(G, o, col){
  const c = Math.cos(o.a), s = Math.sin(o.a), full = o.t1 - o.t0 > 6.28;
  const P = (U, Y, D) => [o.x + c * U - s * D, o.y + Y, o.z + s * U + c * D];
  const at = (rad, th) => [o.cu + rad * Math.cos(th), o.cy + rad * Math.sin(th)];
  const radial = th => [c * Math.cos(th), Math.sin(th), s * Math.cos(th)];
  const r0 = o.r, r1 = o.r + o.t, d = o.hw, n = Math.max(2, Math.ceil((o.t1 - o.t0) / (Math.PI / 18)));
  const uv = ([U, Y]) => [U / TILE, Y / TILE];
  for (let i = 0; i < n; i++){
    const ta = o.t0 + (o.t1 - o.t0) * i / n, tb = o.t0 + (o.t1 - o.t0) * (i + 1) / n, tm = (ta + tb) / 2;
    const Ia = at(r0, ta), Ib = at(r0, tb), Oa = at(r1, ta), Ob = at(r1, tb);
    for (const D of [-d, d]) G.quad(P(...Ia, D), P(...Ib, D), P(...Ob, D), P(...Oa, D), uv(Ia), uv(Ib), uv(Ob), uv(Oa), [-s * Math.sign(D), 0, c * Math.sign(D)], col);
    const la = r0 * (ta - o.t0) / TILE, lb = r0 * (tb - o.t0) / TILE, w = 2 * d / TILE;
    G.quad(P(...Ia, -d), P(...Ib, -d), P(...Ib, d), P(...Ia, d), [la, 0], [lb, 0], [lb, w], [la, w], radial(tm).map(v => -v), col);     // the soffit
    G.quad(P(...Oa, -d), P(...Ob, -d), P(...Ob, d), P(...Oa, d), [la, 0], [lb, 0], [lb, w], [la, w], radial(tm), col);                  // the back
  }
  if (!full) for (const [th, sg] of [[o.t0, -1], [o.t1, 1]]){                                  // the ends, where it springs or meets its pair
    const I = at(r0, th), O = at(r1, th), t = [-c * Math.sin(th) * sg, Math.cos(th) * sg, -s * Math.sin(th) * sg];
    G.quad(P(...I, -d), P(...O, -d), P(...O, d), P(...I, d), [0, 0], [o.t / TILE, 0], [o.t / TILE, 2 * d / TILE], [0, 2 * d / TILE], t, col);
  }
}

// A pier's drum lying on its side where it fell: an eight-sided cylinder along o.a.
function drum(G, o, col, endC){
  const c = Math.cos(o.a), s = Math.sin(o.a), R = o.hw, yc = o.y0 + o.h / 2;
  const P = (u, th) => [o.x + c * u - s * R * Math.cos(th), yc + R * Math.sin(th), o.z + s * u + c * R * Math.cos(th)];
  const ring = [...Array(8)].map((_, k) => k * Math.PI / 4 + Math.PI / 8);
  ring.forEach((ta, k) => {
    const tb = ring[(k + 1) % 8], tm = ta + Math.PI / 8;
    G.quad(P(-o.hl, ta), P(o.hl, ta), P(o.hl, tb), P(-o.hl, tb), [0, k * R / TILE], [2 * o.hl / TILE, k * R / TILE], [2 * o.hl / TILE, (k + 1) * R / TILE], [0, (k + 1) * R / TILE],
      [-s * Math.cos(tm), Math.sin(tm), c * Math.cos(tm)], col);
  });
  for (const e of [-1, 1]){
    const cen = [o.x + c * o.hl * e, yc, o.z + s * o.hl * e];
    ring.forEach((ta, k) => G.tri(cen, P(o.hl * e, ta), P(o.hl * e, ring[(k + 1) % 8]), [0, 0], [R / TILE, 0], [0, R / TILE], [c * e, 0, s * e], endC));
  }
}

export function buildRuins(scene){
  const group = new THREE.Group(), mat = material();
  ruins().forEach((ru, i) => {
    const r = mulberry32(0x7a1d + i * 104729), G = new Geo();
    // each ruin its own weathering: greyer or warmer, and how green its tops have gone
    const t = 0.82 + r() * 0.2, warm = (r() - 0.5) * 0.08, moss = 0.3 + r() * 0.5;
    const tone = k => [t * k + warm, t * k, t * k - warm];
    const mossC = k => [0.42 * k, 0.5 * k + 0.1 * moss, 0.28 * k];
    for (const p of ru.pieces){
      const k = 0.88 + r() * 0.2;
      block(G, p, tone(k), r() < moss ? mossC(k) : tone(k * 1.05));
    }
    for (const s of ru.stones){
      const k = 0.85 + r() * 0.25;
      if (s.drum) drum(G, s, tone(k), tone(k * 1.06));                   // a pier's drum
      else if (s.block) block(G, s, tone(k * 0.95), tone(k));            // rubble
      else if (s.fallen) block(G, s, tone(k * 0.9), mossC(k));           // a stone lying where it fell, gone green on top
      else block(G, s, tone(k), tone(k * 1.08), 0.72 + r() * 0.15);      // standing, narrowing to its crown
    }
    for (const g of ru.rings || []) voussoirs(G, g, tone(0.92 + r() * 0.12));
    const m = G.mesh(mat);
    if (m) group.add(m);
  });
  scene.add(group);
  return { group };
}
