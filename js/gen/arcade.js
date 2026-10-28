// gen/arcade.js — organic arcades, after a reference painting (docs/HVqvATMXIAEKeDJ.png;
// docs/magic.md "The castle in the painting"): a wall pierced by oval and egg-shaped
// openings, each a different size, as if worn through rock rather than built on piers.
// Pure, so node can check it.
//
// The wall lies in its own plane: s along it (0 at the middle, ±len/2 at the ends), y up
// from the ground, v through it. One field says where it's solid: d(s, y), roughly the
// distance to the nearest opening, the crest or an end (> 0 inside the stone). The faces
// stand off the middle plane by
//     h = sqrt(2ρd − d²)  while d < ρ,   ρ beyond,
// so every edge, the openings' rims as much as the crest, is a half-round of radius ρ, the
// front and back meeting in the middle plane: worn, never cut. Near the ground ρ and d both
// grow, so each pier flares into the ground like a root, wider through and narrower between.
//
//   arcadeSpec(seed, { len, gate })  the openings; `gate` the half-width the middle one
//                                    must keep at the ground (a path goes through it)
//   arcadeField(A)                   { d, rho, h } of a spec
//   arcadeMesh(A, cell)              its two faces in wall coordinates, for the view
//   arcadeSolid(A, s, v, y, pad)     is (s, v) at height y inside the stone (or within pad)?

import { mulberry32 } from '../rng.js';

const RHO = 1.3, FLARE = 1.3, ROOT = 1.4;    // the rims' half-round (u); how far a root spreads, and how high it reaches
const K = 1.0;                               // the smooth-min's reach: where two rims meet, they blend over about this

// a smooth minimum: the stone between two openings worn into a saddle, not a crease
const smin = (a, b, k = K) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
const flare = y => FLARE * Math.exp(-Math.max(y, 0) / ROOT);

// the crest: a little over the middle opening, falling to the ground at the ends (as the
// painting's bridge runs down into the cliff), a little uneven
const crestOf = (len, ph, top) => s => { const c = Math.cos(Math.PI * s / len); return 1.2 + (top - 1.2) * Math.pow(Math.max(c, 0), 0.75) + 0.5 * Math.sin(s * 0.37 + ph); };

// an opening: a superellipse centred (s, y), half-width a, half-height bt above its middle and
// bb below it (an egg when they differ), exponent n (2 an ellipse, 3 nearly a rounded box).
// Its field is F/|∇F|, about the distance to its outline, negative inside
function openingD(o, s, y){
  const x = (s - o.s) / o.a, b = y > o.y ? o.bt : o.bb, z = (y - o.y) / b, n = o.n;
  const ax = Math.abs(x) + 1e-9, az = Math.abs(z) + 1e-9, S = Math.pow(ax, n) + Math.pow(az, n), R = Math.pow(S, 1 / n);
  const k = Math.pow(S, 1 / n - 1), gx = k * Math.pow(ax, n - 1) / o.a, gz = k * Math.pow(az, n - 1) / b;
  return (R - 1) / Math.hypot(gx, gz);
}

export function arcadeSpec(seed, { len = 40, gate = 2.4 } = {}){
  const r = mulberry32(seed), half = len / 2, ph = r() * 6.28;
  // the middle opening, the path through it: tall, its foot below the ground
  const a0 = gate + 1.6 + r() * 0.5, bt0 = a0 * (1.55 + r() * 0.3), top = 2.2 + bt0 + RHO + 1.8, crest = crestOf(len, ph, top);
  const openings = [{ s: 0, y: 2.2, a: a0, bt: bt0, bb: 4.6, n: 2.2 + r() * 0.4, walk: true }];
  for (const side of [-1, 1]){
    let edge = a0;
    for (;;){
      const gap = 1.5 + r() * 1.4, t = (edge + gap) / half;           // t: how far out along the wall
      let a = (0.9 + r() * 2.4) * (1 - 0.4 * t);
      const s = side * (edge + gap + a);
      if (Math.abs(s) + a > half - 2.6) break;
      // most stand on the ground; each rises toward the crest, leaving a rim and a bit of stone
      const walk = r() < 0.75, n = 1.8 + r() * 1.4, bb = a * (walk ? 0.8 + r() * 0.5 : 0.7 + r() * 0.4);
      const y = walk ? bb * (0.1 + r() * 0.3) : 1.3 + bb + r() * 1.2;
      const room = Math.min(crest(s - a), crest(s), crest(s + a)) - RHO - 0.8;
      const bt = Math.min((room - y) * (0.7 + r() * 0.3), a * 2.3);
      if (bt < Math.max(0.8, a * 0.7)){ edge = Math.abs(s) + a; continue; }
      openings.push({ s, y, a, bt, bb, n, walk });
      edge = Math.abs(s) + a;
    }
  }
  // small high openings over the piers, where there's stone enough above both neighbours
  const row = [...openings].sort((p, q) => p.s - q.s);
  for (let q = 0; q + 1 < row.length; q++){
    const L = row[q], R = row[q + 1], s = (L.s + L.a + R.s - R.a) / 2, a = 0.55 + r() * 0.6;
    const y = Math.max(L.y + L.bt, R.y + R.bt) * 0.85 + a + 0.6, room = crest(s) - RHO - 0.9;
    if (y + a <= room && r() < 0.75) openings.push({ s, y, a, bt: a * (1 + r() * 0.4), bb: a, n: 2 + r() * 0.5, walk: false });
  }
  return { seed, len, half, ph, top, openings, rho: RHO };
}

// the stone's half-thickness off the rims at height y: the spec's ρ, swollen near the ground
export const rhoAt = (A, y) => (A.rho ?? RHO) + flare(y);

// A spec with `deck(s)` (a causeway or a tier wall) has no crest: its wall is cut flat at the
// deck, and its ends run on past the deck's (`ends`) to bury themselves in the shore and the rock
export function arcadeField(A){
  const crest = A.deck ? null : crestOf(A.len, A.ph, A.top), reach = 2.5 * ((A.rho ?? RHO) + FLARE) + 1;
  // the openings in order along the wall, so only those near s are looked at: one further off
  // than `reach` past its rim can't change the stone's shape or its uvs
  const ops = [...A.openings].sort((p, q) => p.s - q.s), maxA = Math.max(0, ...ops.map(o => o.a)), lo0 = s => {
    let lo = 0, hi = ops.length; const t = s - maxA - reach;
    while (lo < hi){ const m = (lo + hi) >> 1; if (ops[m].s < t) lo = m + 1; else hi = m; }
    return lo;
  };
  const d = (s, y) => {
    let o = Infinity;
    for (let q = lo0(s); q < ops.length && ops[q].s < s + maxA + reach; q++){ const op = ops[q]; if (Math.abs(s - op.s) < op.a + reach){ const v = openingD(op, s, y); o = o === Infinity ? v : smin(o, v); } }
    const outer = A.deck ? A.ends - Math.abs(s) : smin(crest(s) - y, A.half - Math.abs(s));
    return (o === Infinity ? outer : smin(o, outer)) + 0.7 * flare(y);
  };
  const rho = y => rhoAt(A, y);
  const h = (s, y) => { const dd = d(s, y); if (dd <= 0) return 0; const p = rho(y); return dd >= p ? p : Math.sqrt(2 * p * dd - dd * dd); };
  return { d, rho, h, crest, top: A.deck || crest };
}

export function arcadeSolid(A, s, v, y, pad = 0, F = arcadeField(A)){
  if (Math.abs(s) > A.half + FLARE + pad + 1 || Math.abs(v) > rhoAt(A, -1) + pad) return false;
  // within pad of the stone: the nearest of a few points round (s, v) inside it
  for (const [ds, dv] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad], [pad * 0.7, pad * 0.7], [-pad * 0.7, pad * 0.7], [pad * 0.7, -pad * 0.7], [-pad * 0.7, -pad * 0.7]])
    if (Math.abs(v + dv) < F.h(s + ds, y)) return true;
  return false;
}

// The two faces, front (v > 0) then back, as triangles in wall coordinates [s, y, v], with
// smooth normals [ns, ny, nv] and uvs (u, v in u of stone). The plane is cut into cells,
// each clipped to d ≥ 0 (and, for a causeway, to under its deck), so the rims fall exactly
// where the faces meet; `band` marks the triangles in the band under the crest or the deck
// (the view cobbles them). A causeway's deck and parapets come in `deck` and `parapet`, each
// { pos, nrm, uv }.
export function arcadeMesh(A, cell = 0.25, F = arcadeField(A)){
  const ends = A.ends ?? A.half, y0 = A.bottom ?? -2, TOPF = F.top;
  const y1 = Math.max(...Array.from({ length: 81 }, (_, q) => TOPF((q / 40 - 1) * A.half))) + 0.5;
  const s0 = -ends - FLARE - 1, s1 = ends + FLARE + 1;
  const NS = Math.ceil((s1 - s0) / cell), NY = Math.ceil((y1 - y0) / cell), W1 = NS + 1;
  // the clip: the stone (d), and for a causeway under its deck (U) and over its foot (B, a
  // tier wall standing on the road below it)
  const D = new Float32Array(W1 * (NY + 1)), U = new Float32Array(W1 * (NY + 1)), Bf = new Float32Array(W1 * (NY + 1));
  for (let i = 0; i <= NS; i++){
    const s = s0 + i * cell, sc = Math.max(-A.half, Math.min(A.half, s)), ty = A.deck ? A.deck(sc) : Infinity, by = A.base ? A.base(sc) : -Infinity;
    for (let j = 0; j <= NY; j++){ const y = y0 + j * cell, k = j * W1 + i; U[k] = ty - y; Bf[k] = y - by; D[k] = U[k] < -cell * 2 || Bf[k] < -cell * 2 ? -1 : F.d(s, y); }
  }
  const clip = k => Math.min(D[k], U[k], Bf[k]);
  const e = 0.02, cache = new Map();
  // a point of the front face at (s, y), d known (0 on a rim); the back is its mirror
  const at = (key, s, y, dd) => {
    let w = cache.get(key);
    if (w) return w;
    const p = F.rho(y), dp = y > 0 ? -FLARE / ROOT * Math.exp(-y / ROOT) : 0;
    const gx = (F.d(s + e, y) - F.d(s - e, y)) / (2 * e), gy = (F.d(s, y + e) - F.d(s, y - e)) / (2 * e), gl = Math.hypot(gx, gy) || 1;
    const nx = gx / gl, ny = gy / gl;
    // h, and g = h∇h (finite even on the rim, where ∇h isn't)
    let h, g, arc;
    if (dd <= 0){ h = 0; g = [p * nx, p * ny]; arc = 0; }
    else if (dd < p){ h = Math.sqrt(2 * p * dd - dd * dd); g = [(p - dd) * nx, (p - dd) * ny + dd * dp]; arc = p * Math.acos(1 - dd / p); }
    else { h = p; g = [0, p * dp]; arc = dd + p * (Math.PI / 2 - 1) * Math.max(0, 1 - (dd - p) / (1.5 * p)); }
    // the uvs unrolled round the rim, so the stone isn't squeezed into a line there
    const sh = arc - Math.max(dd, 0), nl = Math.hypot(g[0], g[1], h) || 1;
    w = { s, y, h, n: [-g[0] / nl, -g[1] / nl, h / nl], uv: [s + nx * sh, y + ny * sh] };
    cache.set(key, w);
    return w;
  };
  const pos = [], nrm = [], uv = [], band = [], face = [];
  // flat: stone well clear of any rim (its uvs no longer unrolled) and of the deck's band and
  // the foot, so a run of such cells is one plane and can be one quad (up to 6u, so the wall
  // still follows a curve it's laid along)
  const flat = (i, j) => [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].every(([a, b]) => { const k = b * W1 + a; return D[k] >= 2.5 * F.rho(y0 + b * cell) + 0.1 && U[k] > 2.6 && Bf[k] > 0; });
  const run = Math.max(1, Math.floor(6 / cell));
  for (let j = 0; j < NY; j++) for (let i = 0; i < NS; i++){
    if (flat(i, j)){
      let n = 1; while (n < run && i + n < NS && flat(i + n, j)) n++;
      const k = [[i, j], [i + n, j], [i + n, j + 1], [i, j + 1]].map(([a, b]) => b * W1 + a), sa = s0 + i * cell, sb = s0 + (i + n) * cell, ya = y0 + j * cell, yb = ya + cell;
      const V = [at(k[0], sa, ya, D[k[0]]), at(k[1], sb, ya, D[k[1]]), at(k[2], sb, yb, D[k[2]]), at(k[3], sa, yb, D[k[3]])];
      for (const f of A.oneSided ? [1] : [1, -1]) for (const tri of [[V[0], V[1], V[2]], [V[0], V[2], V[3]]]){
        const T = f > 0 ? tri : [tri[0], tri[2], tri[1]];
        for (const w of T){ pos.push(w.s, w.y, f * w.h); nrm.push(w.n[0], w.n[1], f * w.n[2]); uv.push(w.uv[0], w.uv[1]); }
        band.push(false); face.push(f);
      }
      i += n - 1; continue;
    }
    const C = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => { const k = b * W1 + a; return { k, s: s0 + a * cell, y: y0 + b * cell, c: clip(k), d: D[k], u: Math.min(U[k], Bf[k]) }; });
    if (C.every(c => c.c <= 0)) continue;
    // clip the cell; a point on the clip is keyed by its edge, so the cells either side share it.
    // Cut by the deck it keeps its depth; cut by the stone's edge it's on a rim (d = 0)
    const poly = [];
    for (let q = 0; q < 4; q++){
      const P = C[q], Q = C[(q + 1) % 4];
      if (P.c > 0) poly.push(at(P.k, P.s, P.y, P.d));
      if ((P.c > 0) !== (Q.c > 0)){
        const t = P.c / (P.c - Q.c), key = 'e' + Math.min(P.k, Q.k) + ':' + Math.max(P.k, Q.k), s = P.s + (Q.s - P.s) * t, y = P.y + (Q.y - P.y) * t;
        const byDeck = P.u + (Q.u - P.u) * t <= P.d + (Q.d - P.d) * t;        // (or by the foot)
        poly.push(at(key, s, y, byDeck ? Math.max(1e-4, F.d(s, y)) : 0));
      }
    }
    if (poly.length < 3) continue;
    const cs = poly.reduce((a, c) => a + c.s, 0) / poly.length, cy = poly.reduce((a, c) => a + c.y, 0) / poly.length;
    const top = cy > TOPF(Math.max(-A.half, Math.min(A.half, cs))) - 2.2;
    // a one-sided wall (a tier wall, its back in the mountain) keeps its back only round the
    // openings, the insides of the galleries, where it can be seen
    const backs = !A.oneSided || C.some(c => c.d < F.rho(c.y) + 0.6);
    for (const f of backs ? [1, -1] : [1]) for (let q = 1; q < poly.length - 1; q++){
      const tri = f > 0 ? [poly[0], poly[q], poly[q + 1]] : [poly[0], poly[q + 1], poly[q]];
      for (const w of tri){ pos.push(w.s, w.y, f * w.h); nrm.push(w.n[0], w.n[1], f * w.n[2]); uv.push(w.uv[0], w.uv[1]); }
      band.push(top); face.push(f);
    }
  }
  const out = { pos, nrm, uv, band, face };
  if (A.deck){
    // the deck between the parapets, and each parapet: its inner face, its top, its outer face
    // flush with the wall's, capped at the ends
    const PH = 1.0, PW = 0.4, dk = { pos: [], nrm: [], uv: [] }, pp = { pos: [], nrm: [], uv: [] };
    const quad = (G, a, b, c, d, n, ua, ub, uc, ud) => { for (const [P, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]){ G.pos.push(...P); G.nrm.push(...n); G.uv.push(...u); } };
    const n = Math.ceil(A.len / 0.5);
    for (let q = 0; q < n; q++){
      const sa = -A.half + q * A.len / n, sb = -A.half + (q + 1) * A.len / n, ya = A.deck(sa), yb = A.deck(sb), ra = F.rho(ya), rb = F.rho(yb);
      quad(dk, [sa, ya, -(ra - PW)], [sb, yb, -(rb - PW)], [sb, yb, rb - PW], [sa, ya, ra - PW], [0, 1, 0], [sa, -(ra - PW)], [sb, -(rb - PW)], [sb, rb - PW], [sa, ra - PW]);
      for (const f of [1, -1]){
        const ia = f * (ra - PW), ib = f * (rb - PW), oa = f * ra, ob = f * rb;
        quad(pp, [sa, ya, ia], [sb, yb, ib], [sb, yb + PH, ib], [sa, ya + PH, ia], [0, 0, -f], [sa, ya], [sb, yb], [sb, yb + PH], [sa, ya + PH]);
        quad(pp, [sa, ya + PH, ia], [sb, yb + PH, ib], [sb, yb + PH, ob], [sa, ya + PH, oa], [0, 1, 0], [sa, 0], [sb, 0], [sb, PW], [sa, PW]);
        quad(pp, [sa, ya, oa], [sb, yb, ob], [sb, yb + PH, ob], [sa, ya + PH, oa], [0, 0, f], [sa, ya], [sb, yb], [sb, yb + PH], [sa, ya + PH]);
      }
    }
    for (const [s, f] of [[-A.half, -1], [A.half, 1]]){
      const y = A.deck(s), r = F.rho(y);
      for (const g of [1, -1]) quad(pp, [s, y, g * (r - PW)], [s, y, g * r], [s, y + PH, g * r], [s, y + PH, g * (r - PW)], [f, 0, 0], [0, y], [PW, y], [PW, y + PH], [0, y + PH]);
    }
    out.deck = dk; out.parapet = pp;
  }
  return out;
}
