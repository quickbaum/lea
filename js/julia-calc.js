// julia-calc.js — the Turning Stair's Julia panels, as numbers (julia-tex.js makes them
// textures). Pure arithmetic and no imports, so a worker can run it (julia-worker.js): the
// deep views take seconds, and that shouldn't be a pause on the stair.
//
// Each surface of the stair is a grid of panels, each panel a zoomed view into one set,
// z → z² + c (tools/julia-views.mjs found them), all coloured in the surface's own way:
//   ramp     each panel its own: 'bands' (escape count), 'stripe' (stripe average: silky
//            curves), 'trap' (distance to a point: eyes and pearls); enamel inside the set
//   wall     'line': cloisonné, gold wire along every other escape band, on polished stone;
//            where the wires would crowd (near the set) it leaves dark lace instead
//   soffit   'stucco': pale raised bands, gold leaf inside the set, for the ramps' undersides
//   verde, porphyry   'malachite': the escape bands sharp and wide, for the columns (and the
//            window surrounds); rail the same in amethyst, for the parapets
//   dome     one big 'stripe' view, round a spiral's eye, unframed
// Each panel is framed in gold (but the dome's).
//
//   juliaRaw(name | spec)  →  { w, h, rgb, H, rough, metal, cols, rows, pw, ph }  (Float32Arrays)

const GOLD = [226, 184, 96], PEARL = [234, 228, 240];
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, f) => a.map((x, q) => x + (b[q] - x) * f);
// cosine palettes (after Iñigo Quilez), a + b·cos(2π(c·t + d))
export const PALETTES = [
  [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0.62, 0.42, 0.18]],     // 0 violet, teal, gold
  [[0.5, 0.4, 0.3], [0.5, 0.4, 0.3], [1, 1, 1], [0.0, 0.1, 0.2]],        // 1 ember
  [[0.6, 0.65, 0.75], [0.35, 0.35, 0.3], [1, 1, 1], [0.55, 0.6, 0.65]],  // 2 ice and silver
  [[0.4, 0.55, 0.45], [0.4, 0.4, 0.35], [1, 1, 0.5], [0.3, 0.2, 0.2]],   // 3 verdigris
  [[0.45, 0.32, 0.6], [0.4, 0.3, 0.4], [1, 1, 1], [0.8, 0.9, 0.6]],      // 4 amethyst and rose
  [[0.2, 0.42, 0.32], [0.16, 0.22, 0.16], [1, 1, 1], [0.1, 0.2, 0.15]],  // 5 verde antico
  [[0.42, 0.16, 0.24], [0.2, 0.1, 0.14], [1, 1, 1], [0.0, 0.15, 0.1]],   // 6 porphyry
  [[0.14, 0.17, 0.42], [0.1, 0.12, 0.24], [1, 1, 1], [0.3, 0.25, 0.1]],  // 7 lapis
  [[0.3, 0.2, 0.4], [0.16, 0.11, 0.2], [1, 1, 1], [0.05, 0.15, 0.1]],   // 8 dark amethyst, a stone
];
const paint = (P, t) => [0, 1, 2].map(q => 255 * Math.max(0, Math.min(1, P[0][q] + P[1][q] * Math.cos(2 * Math.PI * (P[2][q] * t + P[3][q])))));
const itersFor = w => Math.round(160 + 45 * Math.log2(3.6 / w));   // deeper views need more (as tools/julia-views.mjs scored them)

// views: { c, at: centre, w: width of the view, mode, pal }
export const JULIA_SURFACES = {
  ramp: { pw: 512, ph: 256, cols: 8, rows: 1, views: [
    { c: [0.355, 0.355], at: [0.466688, -0.865374], w: 0.2, mode: 'stripe', pal: 1 },       // a spiral arm, ember
    { c: [0.285, 0.01], at: [0.52399, -0.960037], w: 0.02, mode: 'stripe', pal: 3 },        // a seahorse eye in a fan of feathers
    { c: [-0.70176, -0.3842], at: [-0.505979, -0.192086], w: 0.2, mode: 'trap', pal: 4 },   // a ring of pearls
    { c: [-0.4, 0.6], at: [0.09539, -0.776674], w: 0.06, mode: 'trap', pal: 1 },            // a whorl of seeds
    { c: [-0.835, -0.2321], at: [0.921005, 0.285348], w: 0.06, mode: 'bands', pal: 3 },     // lace round a pool
    { c: [0.355, 0.355], at: [0.846141, -0.717606], w: 0.2, mode: 'bands', pal: 2 },        // frost spirals
    { c: [-0.70176, -0.3842], at: [-0.119055, -0.200984], w: 0.06, mode: 'bands', pal: 1 }, // a copper rosette
    { c: [-0.835, -0.2321], at: [-0.42016, -0.379707], w: 0.2, mode: 'stripe', pal: 4 },    // tendrils
  ] },
  wall: { pw: 160, ph: 320, cols: 6, rows: 2, mode: 'line', views: [
    { c: [-0.835, -0.2321], at: [-0.15869, 0.28677], w: 0.2, pal: 7 },
    { c: [-0.835, -0.2321], at: [-0.908908, 0.064774], w: 0.02, pal: 4 },
    { c: [-0.835, -0.2321], at: [0.293877, 0.457655], w: 0.02, pal: 6 },
    { c: [0.285, 0.01], at: [0.509146, 0.154178], w: 0.2, pal: 5 },
    { c: [0.285, 0.01], at: [0.52399, -0.960037], w: 0.02, pal: 7 },
    { c: [0.285, 0.01], at: [-0.140921, 0.876187], w: 0.2, pal: 4 },
    { c: [0.285, 0.01], at: [-0.756755, 0.484539], w: 0.06, pal: 6 },
    { c: [0.285, 0.01], at: [-0.405627, -0.103937], w: 0.02, pal: 5 },
    { c: [0.355, 0.355], at: [0.466688, -0.865374], w: 0.2, pal: 7 },
    { c: [0.355, 0.355], at: [0.264996, 0.478945], w: 0.6, pal: 4 },
    { c: [0.355, 0.355], at: [-0.597212, 0.759291], w: 0.6, pal: 6 },
    { c: [0.355, 0.355], at: [-0.257047, -0.666376], w: 0.02, pal: 5 },
  ] },
  soffit: { pw: 384, ph: 192, cols: 6, rows: 1, mode: 'stucco', views: [
    { c: [-0.835, -0.2321], at: [0.921005, 0.285348], w: 0.06, pal: 4 },
    { c: [-0.835, -0.2321], at: [0.602571, -0.128288], w: 0.06, pal: 2 },
    { c: [0.285, 0.01], at: [0.112476, -0.87754], w: 0.06, pal: 1 },
    { c: [-0.70176, -0.3842], at: [-0.119055, -0.200984], w: 0.06, pal: 4 },
    { c: [-0.70176, -0.3842], at: [-0.779757, 0.173429], w: 0.06, pal: 2 },
    { c: [0.355, 0.355], at: [0.218959, -0.422693], w: 0.06, pal: 1 },
  ] },
  verde: { pw: 384, ph: 128, cols: 6, rows: 1, mode: 'malachite', pal: 5, views: [
    { c: [-0.835, -0.2321], at: [-0.42016, -0.379707], w: 0.2 },
    { c: [-0.70176, -0.3842], at: [-0.086416, -0.642647], w: 0.2 },
    { c: [-0.70176, -0.3842], at: [1.396107, 0.16645], w: 0.02 },
    { c: [-0.70176, -0.3842], at: [-0.97108, -0.271881], w: 0.02 },
    { c: [-0.70176, -0.3842], at: [0.592505, 0.588815], w: 0.6 },
    { c: [0.355, 0.355], at: [-0.236006, -1.061598], w: 0.02 },
  ] },
  porphyry: { pw: 384, ph: 128, cols: 6, rows: 1, mode: 'malachite', pal: 6, views: [] },
  // the rail: one panel per bay between the stair's columns (π/4 of turn at the rail, 2.51u, by
  // the rail's 1.5u height), so each gold division falls on a column
  rail: { pw: 216, ph: 128, cols: 6, rows: 1, mode: 'malachite', pal: 8, views: [
    { c: [-0.835, -0.2321], at: [-0.15869, 0.28677], w: 0.2 },
    { c: [-0.835, -0.2321], at: [0.921005, 0.285348], w: 0.06 },
    { c: [-0.835, -0.2321], at: [0.602571, -0.128288], w: 0.06 },
    { c: [-0.835, -0.2321], at: [-0.908908, 0.064774], w: 0.02 },
    { c: [0.355, 0.355], at: [0.218959, -0.422693], w: 0.06 },
    { c: [0.355, 0.355], at: [-0.257047, -0.666376], w: 0.02 },
  ] },
  // slabs of verde and porphyry for anything with plain tiling UVs (the palaces' columns and
  // piers, the grounds' columns and posts): one view, unframed, and laid mirrored (as marble
  // veneer is book-matched), so its edges meet their own reflection and there are no seams
  verdeSlab: { pw: 384, ph: 384, cols: 1, rows: 1, mode: 'malachite', pal: 5, frame: false, mirror: true, views: [
    { c: [-0.70176, -0.3842], at: [0.592505, 0.588815], w: 0.6 },
  ] },
  porphyrySlab: { pw: 384, ph: 384, cols: 1, rows: 1, mode: 'malachite', pal: 6, frame: false, mirror: true, views: [
    { c: [-0.835, -0.2321], at: [-0.908908, 0.064774], w: 0.02 },
  ] },
  // the palaces' walls (and their trim and arches) and their vaults: the stair's cloisonné, and
  // the dome's spiral colouring, as slabs; `repeat`: how many of them a tiling UV unit holds
  // (3u: under-view.js TILE), so a slab covers 7.5u before it meets its reflection
  wallSlab: { pw: 512, ph: 512, cols: 1, rows: 1, mode: 'line', pal: 7, frame: false, mirror: true, repeat: 0.4, views: [
    { c: [0.285, 0.01], at: [-0.756755, 0.484539], w: 0.06 },
  ] },
  vaultSlab: { pw: 512, ph: 512, cols: 1, rows: 1, mode: 'stripe', pal: 4, frame: false, mirror: true, repeat: 0.4, views: [
    { c: [0.285, 0.01], at: [0.509146, 0.154178], w: 0.2 },
  ] },
  // the dome: one view, centred on a spiral's eye (the set's fixed point z = z² + c whose
  // multiplier is just over 1 and turns: 1.012 at 74°), so the arms wind into the oculus
  dome: { pw: 768, ph: 768, cols: 1, rows: 1, mode: 'stripe', pal: 4, frame: false, views: [
    { c: [0.355, 0.355], at: [0.13586, 0.48744], w: 0.6 },
  ] },
};
JULIA_SURFACES.porphyry.views = JULIA_SURFACES.verde.views;      // the same views, the other stone

// one pixel of a view: { col, h, rough, metal } (and, for 'line', mu: the escape count, -1 in the set)
function sample(V, mode, P, zr, zi, iters){
  const [cr, ci] = V.c, stripe = mode === 'stripe';
  let i = 0, r2 = 0, trap = 1e9, cross = 1e9, st = 0, stLast = 0;
  for (; i < iters; i++){
    const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; r2 = zr * zr + zi * zi;
    const d = (zr - 0.3) * (zr - 0.3) + zi * zi; if (d < trap) trap = d;
    const c2 = Math.min(Math.abs(zr), Math.abs(zi)); if (c2 < cross) cross = c2;
    if (stripe){ stLast = 0.5 + 0.5 * Math.sin(5 * Math.atan2(zi, zr)); st += stLast; }
    if (r2 > 1e4) break;
  }
  const inside = i >= iters, vein = 1 - smooth(0, 0.05, cross);
  const mu = inside ? 0 : i + 1 - Math.log2(Math.log2(r2) / 2), near = smooth(2, 30, mu);
  if (mode === 'line'){                                     // polished stone; juliaRaw lays the gold wire over it
    const stone = paint(P, 0.15 + mu * 0.012).map(c => c * (0.45 + 0.35 * near));
    if (inside) return { col: mix(paint(P, 0.6).map(c => c * 0.5), GOLD, vein * 0.6), h: 0.35 + 0.2 * vein, rough: 0.3, metal: vein * 0.6, mu: -1 };
    return { col: stone, h: 0.3, rough: 0.25, metal: 0.05, mu };
  }
  if (mode === 'stucco'){                                   // pale plaster, raised in bands, gold leaf in the set
    if (inside) return { col: mix(PEARL, GOLD, 0.75), h: 0.85, rough: 0.3, metal: 0.9 };
    const band = 0.5 + 0.5 * Math.sin(mu * 1.6), h = 0.15 + 0.55 * near + 0.2 * band;
    return { col: mix(PEARL, paint(P, mu * 0.04), 0.4).map(c => c * (0.5 + 0.5 * h)), h, rough: 0.55, metal: 0 };
  }
  if (mode === 'malachite'){                                // the escape bands, sharp and fine, as in malachite
    if (inside) return { col: mix(paint(P, 0.5), GOLD, 0.5 + 0.5 * vein), h: 0.7, rough: 0.2, metal: 0.8 };
    const f = (mu * 0.3) % 1, saw = Math.pow(f, 2.2), fine = 0.5 + 0.5 * Math.sin(mu * 2.5);
    const col = paint(P, 0.1 + 0.5 * saw).map(c => c * (0.7 + 0.45 * saw + 0.15 * fine) * (0.55 + 0.45 * near));
    return { col, h: 0.35 + 0.3 * saw + 0.1 * fine, rough: 0.14 + 0.1 * (1 - saw), metal: 0.05 };
  }
  if (inside){                                              // the ramp's: enamel veined with gold
    const p = paint(P, Math.sqrt(trap) * 1.6 + 0.3);
    return { col: mix(p, GOLD, vein), h: 0.6 + 0.3 * vein, rough: 0.1 + 0.2 * (1 - vein), metal: 0.65 + 0.35 * vein };
  }
  let t, h;
  if (stripe){
    const f = mu - Math.floor(mu), avg = (st - stLast) / Math.max(1, i) * (1 - f) + st / (i + 1) * f;   // smoothed between the last two counts
    t = avg * 1.3 + mu * 0.01; h = 0.3 + 0.5 * avg;
  } else if (mode === 'trap'){
    const dd = Math.sqrt(Math.sqrt(trap)); t = dd * 1.4 + 0.1; h = 0.3 + 0.5 * (1 - Math.min(1, dd));
  } else { const band = 0.5 + 0.5 * Math.sin(mu * 2.4); t = mu * 0.06; h = 0.3 + 0.25 * near + 0.15 * band; }
  const col = paint(P, t), bright = (col[0] + col[1] + col[2]) / 765;
  return { col: col.map(c => c * (0.35 + 0.65 * near)), h, rough: 0.55 - 0.4 * near * bright, metal: 0.85 * near * bright };
}

export function juliaRaw(spec = 'ramp'){
  const S = typeof spec === 'string' ? JULIA_SURFACES[spec] : spec;
  const { pw, ph, cols, rows, views, frame = true } = S, w = pw * cols, h = ph * rows, aspect = pw / ph;
  const rgb = new Float32Array(w * h * 3), H = new Float32Array(w * h), rough = new Float32Array(w * h), metal = new Float32Array(w * h);
  const EDGE = 0.06 * Math.min(1, aspect);                  // the gold frame, as a share of the panel's height
  for (let p = 0; p < cols * rows; p++){
    const V = views[p % views.length], iters = itersFor(V.w), mode = V.mode || S.mode, P = PALETTES[(V.pal ?? S.pal ?? 0) % PALETTES.length];
    const x0 = (p % cols) * pw, y0 = Math.floor(p / cols) * ph, MU = mode === 'line' ? new Float32Array(pw * ph).fill(NaN) : null;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++){
      const k = (y0 + y) * w + x0 + x, u = (x + 0.5) / pw, v = (y + 0.5) / ph, edge = Math.min(v, 1 - v, Math.min(u, 1 - u) * aspect);
      let o;
      if (frame && edge < EDGE){                            // the frame, with a groove inside it
        const groove = edge > EDGE * 0.7;
        o = groove ? { col: [14, 10, 30], h: 0.1, rough: 0.7, metal: 0 } : { col: GOLD, h: 0.9, rough: 0.2, metal: 1 };
      } else { o = sample(V, mode, P, V.at[0] + (u - 0.5) * V.w, V.at[1] + (v - 0.5) * V.w / aspect, iters); if (MU) MU[y * pw + x] = o.mu; }
      rgb.set(o.col, k * 3); H[k] = o.h; rough[k] = o.rough; metal[k] = o.metal;
    }
    // cloisonné: gold wire where a pixel's band differs from its neighbour's by one; where
    // they differ by more, the bands are too close to wire, so dark lace
    if (MU) for (let y = 0; y < ph - 1; y++) for (let x = 0; x < pw - 1; x++){
      const m = MU[y * pw + x]; if (Number.isNaN(m)) continue;
      const k = (y0 + y) * w + x0 + x, b = m < 0 ? -9 : Math.floor(m * 0.5);
      let d = 0;
      for (const n of [MU[y * pw + x + 1], MU[(y + 1) * pw + x]]){ if (Number.isNaN(n)) continue; d = Math.max(d, Math.abs((n < 0 ? -9 : Math.floor(n * 0.5)) - b)); }
      if (d === 1){ rgb.set(GOLD, k * 3); H[k] = 0.8; rough[k] = 0.18; metal[k] = 1; }
      else if (d > 1){ rgb.set([rgb[k * 3] * 0.35, rgb[k * 3 + 1] * 0.35, rgb[k * 3 + 2] * 0.35], k * 3); H[k] = 0.2; }
    }
  }
  return { w, h, rgb, H, rough, metal, cols, rows, pw, ph, aspect };
}
