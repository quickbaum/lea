// outfit.js — clothes built in the browser, on whatever body is loaded.
//
// The Might & Magic look (sprites/*.png) is garments with VOLUME: a tunic hangs
// off the shoulders and is gathered by a belt, sleeves puff and gather at the
// cuff, trousers bunch into boots, and every gather leaves dark fold valleys that
// read even at 256 px. Then hardware: a buckle, studs, a pouch, fur trim, gold.
//
// Every garment here is made from the loaded body's own surface, so it fits any
// ANNY phenotype and can run per character, client-side:
//   1. cut   — the body's triangles in the garment's region (by bone family and
//              height), subdivided once for fold resolution;
//   2. wrap  — offset along the normal, then shrink-wrapped from OUTSIDE: smooth,
//              but never closer to the body than the garment's gap. Smoothing is
//              what makes cloth span the hollows (between the breasts, the small
//              of the back) instead of tracing them like the old leotard shells;
//              it is capped where two limbs meet, or it would web the armpit;
//   3. fold  — displacement along the shell normal, with the valley depth kept
//              as a vertex colour (baked occlusion — the fold you SEE is mostly
//              the dark crease);
//   4. hem   — the cut edge gets a turned-in strip, so the cloth has thickness.
// Garments inherit the body's skin weights, so they walk with it. Hardware is
// rigid: each piece takes the skin weights of the cloth it is fixed to.
//
// The tunic's skirt below the belt is NOT built here: a skirt can't be cut from a
// body that splits at the legs. buildOutfit returns a `skirt` spec instead, which
// the Cloth Studio's cloth sim hangs from the belt line as pleated cloth.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const norm = n => n.replace(/[^a-z0-9]/gi, '').toLowerCase();
const FAMS = ['torso', 'arm', 'leg', 'foot', 'hand', 'head'];
const FAMILY = [[/^(wrist|metacarpal|finger|thumb)/, 'hand'], [/^(upperarm|lowerarm)/, 'arm'],
  [/^(upperleg|lowerleg)/, 'leg'], [/^(foot|toe)/, 'foot'],
  [/^(root|pelvis|spine|breast|clavicle|shoulder)/, 'torso'], [/./, 'head']];
const F = FAMS.length;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
// rounded ridges, sharp valleys: what cloth does when it is gathered
const crease = x => Math.abs(Math.sin(x));

// ---- looks ----------------------------------------------------------------------
// A look is one pick per slot plus colours. SLOTS lists the choices (the studio
// builds its controls from it); LOOKS are hand-made; randomLook rolls one from a
// seed, weighted so a crowd varies in SILHOUETTE first (hats, hair, skirt length,
// beards) and colour second — at sprite scale, outline is what tells people apart.
export const SLOTS = {
  top:      ['tunic', 'shirt', 'none'],
  sleeves:  ['puff', 'straight', 'short', 'none'],
  vest:     ['none', 'jerkin', 'bodice'],
  skirt:    ['none', 'tunic', 'long'],
  belt:     ['belt', 'sash', 'none'],
  feet:     ['boots', 'shoes', 'none'],
  cuff:     ['fur', 'none'],
  hair:     ['bald', 'crop', 'short', 'bob', 'long', 'bun'],
  beard:    ['none', 'short', 'full', 'long'],
  mustache: ['none', 'thin', 'walrus', 'handlebar'],
  hat:      ['none', 'cap'],
  topPattern: ['none', 'asanoha', 'seigaiha', 'shippo', 'yagasuri', 'kikko', 'uroko'],
  trousersPattern: ['none', 'asanoha', 'seigaiha', 'shippo', 'yagasuri', 'kikko', 'uroko'],
  brows:    ['thin', 'arched', 'straight', 'bushy', 'none'],
  jewels:   ['none', 'earrings', 'necklace', 'both'],
  kinOn:    ['none', 'sash', 'vest', 'skirt', 'hat'],
};
// trousers are always worn: a skirt's cloth sim can swing clear of the legs
export const WAGARA = SLOTS.topPattern.slice(1);
export const COLOR_KEYS = ['top', 'topFig', 'trousers', 'trousersFig', 'vest', 'skirt', 'belt', 'boots', 'fur', 'hat', 'metal', 'gem', 'hair', 'skin', 'iris'];

export const LOOKS = {
  peasant: { label: 'Peasant', top: 'tunic', sleeves: 'puff', vest: 'none', bottom: 'trousers', skirt: 'tunic',
    belt: 'belt', feet: 'boots', cuff: 'fur', hair: 'short', beard: 'none', mustache: 'none', hat: 'none', brows: 'arched',
    jewels: 'both', kinOn: 'none', topPattern: 'asanoha',
    colors: { top: '#3d6b2f', trousers: '#b8a684', vest: '#5b3820', skirt: '#3d6b2f', belt: '#5b3820', boots: '#3e2716',
      fur: '#e6dccb', hat: '#6b4a2e', metal: '#c9a040', gem: '#9c1020', hair: '#4a3527', skin: '#c99a7e', iris: '#3f6f7a',
      topFig: '#22401a', trousersFig: '#6a5a3a' } },
  goodwife: { label: 'Goodwife', top: 'shirt', sleeves: 'puff', vest: 'bodice', bottom: 'none', skirt: 'long',
    belt: 'none', feet: 'shoes', cuff: 'none', hair: 'long', beard: 'none', mustache: 'none', hat: 'none', brows: 'arched',
    jewels: 'earrings', kinOn: 'skirt',
    colors: { top: '#ece4d4', trousers: '#b8a684', vest: '#2f6b2a', skirt: '#2f6b2a', belt: '#4a2c18', boots: '#2a1c12',
      fur: '#e6dccb', hat: '#ece4d4', metal: '#d4a640', gem: '#2a8040', hair: '#6e3b2a', skin: '#d8ad92', iris: '#4f7a52' } },
  woodsman: { label: 'Woodsman', top: 'shirt', sleeves: 'straight', vest: 'jerkin', bottom: 'trousers', skirt: 'none',
    belt: 'belt', feet: 'boots', cuff: 'fur', hair: 'short', beard: 'full', mustache: 'walrus', hat: 'none', brows: 'bushy',
    topPattern: 'none', trousersPattern: 'yagasuri',
    jewels: 'none', kinOn: 'none',
    colors: { top: '#8a2a1c', trousers: '#4a4234', vest: '#5a3a1e', skirt: '#4a4234', belt: '#2e1c10', boots: '#3a2414',
      fur: '#8a7058', hat: '#3a3a2a', metal: '#9a9aa0', gem: '#9c1020', hair: '#2e211a', skin: '#b07a5a', iris: '#5b3a1e' } },
  monk: { label: 'Monk', top: 'tunic', sleeves: 'straight', vest: 'none', bottom: 'none', skirt: 'long',
    belt: 'sash', feet: 'shoes', cuff: 'none', hair: 'crop', beard: 'none', mustache: 'none', hat: 'none', brows: 'straight',
    jewels: 'none', kinOn: 'none',
    colors: { top: '#2e4a2a', trousers: '#4a4234', vest: '#2e4a2a', skirt: '#2e4a2a', belt: '#d8cdb0', boots: '#2a1c12',
      fur: '#e6dccb', hat: '#2e4a2a', metal: '#b0b0b8', gem: '#9c1020', hair: '#3a2a20', skin: '#c9a084', iris: '#6a6a6a' } },
  elder: { label: 'Elder', top: 'tunic', sleeves: 'straight', vest: 'none', bottom: 'none', skirt: 'long',
    belt: 'belt', feet: 'shoes', cuff: 'none', hair: 'long', beard: 'long', mustache: 'walrus', hat: 'none', brows: 'bushy',
    jewels: 'necklace', kinOn: 'none',
    colors: { top: '#3a2a6a', trousers: '#4a4234', vest: '#3a2a6a', skirt: '#3a2a6a', belt: '#c9a040', boots: '#2a1c12',
      fur: '#e6dccb', hat: '#3a2a6a', metal: '#d4a640', gem: '#b01020', hair: '#cfc9c0', skin: '#d0a488', iris: '#4a6d8c' } },
};

// natural dyes and undyed cloth — what a village could make
const DYES = ['#3d6b2f', '#2f4a3a', '#5a7a3a', '#8a2a1c', '#a0402a', '#b88a18', '#c4a050', '#2e4a7e', '#3a3a6a',
  '#5a3a1e', '#7a5a3a', '#4a4234', '#2a2420', '#d8cdb0', '#ece4d4', '#6a2a4a', '#8a6a9a', '#b8a684'];
const LEATHER = ['#5b3820', '#3e2716', '#2e1c10', '#6a4a2a', '#4a3020'];
const HAIR = ['#14110f', '#2e211a', '#4a3527', '#6b4a2e', '#7b4b2a', '#6e3b2a', '#b5651d', '#c9a45b', '#8a8580', '#cfc9c0'];
const SKIN = ['#efd2bc', '#e2bb9e', '#d0a07e', '#b9805c', '#9a6444', '#7a4a32', '#5a3626'];
const IRIS = ['#5b3a1e', '#3a2416', '#8a5a22', '#4a6d8c', '#3f6f7a', '#4f7a52', '#6e5a34'];
const METAL = ['#c9a040', '#d4a640', '#9a9aa0', '#b87333'];
const GEM = ['#9c1020', '#2a8040', '#2060a0', '#7a20a0', '#c09020'];

// randomLook(seed, { gender: 'f'|'m', kin: {key, dye}|null }) -> look
export function randomLook(seed = 1, { gender = 'f', kin = null } = {}){
  // mulberry32: a small LCG gave nearly the same first draws for nearby seeds
  let st = (seed | 0) ^ 0x9e3779b9;
  const r = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr, w) => { if (!w) return arr[Math.floor(r() * arr.length)];
    let t = r() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++){ t -= w[i]; if (t <= 0) return arr[i]; } return arr[arr.length - 1]; };
  const f = gender === 'f';
  const L = {
    label: `Random #${seed}`,
    top: pick(['tunic', 'shirt'], [1, 1]),
    sleeves: pick(['puff', 'straight', 'short'], [f ? 3 : 1, 3, 1]),
    vest: pick(['none', 'jerkin', 'bodice'], f ? [2, 1, 2] : [2, 2, 0]),
    bottom: 'trousers',
    skirt: f ? pick(['long', 'tunic', 'none'], [5, 2, 1]) : pick(['none', 'tunic', 'long'], [5, 3, 1]),
    belt: pick(['belt', 'sash', 'none'], [4, 2, 1]),
    feet: pick(['boots', 'shoes'], [3, 2]),
    cuff: pick(['fur', 'none'], [1, 2]),
    hair: f ? pick(['long', 'bun', 'bob', 'short'], [4, 2, 2, 1]) : pick(['crop', 'short', 'bald', 'long', 'bob'], [3, 3, 2, 1, 1]),
    beard: f ? 'none' : pick(['none', 'short', 'full', 'long'], [4, 2, 3, 1]),
    mustache: f ? 'none' : pick(['none', 'thin', 'walrus', 'handlebar'], [3, 1, 2, 1]),
    hat: pick(['none', 'cap'], [5, 2]),
    topPattern: r() < 0.4 ? pick(WAGARA) : 'none',
    trousersPattern: r() < 0.3 ? pick(WAGARA) : 'none',
    brows: pick(['thin', 'arched', 'straight', 'bushy'], f ? [2, 3, 1, 0] : [1, 1, 2, 2]),
    jewels: pick(['none', 'earrings', 'necklace', 'both'], f ? [1, 2, 1, 1] : [4, 1, 1, 0]),
    kinOn: 'none',
  };
  if (L.vest === 'bodice' && L.top === 'tunic') L.top = 'shirt';
  const top = pick(DYES), skirtC = r() < 0.5 ? top : pick(DYES);
  L.colors = { top, trousers: pick(DYES), vest: L.vest === 'jerkin' ? pick(LEATHER) : pick(DYES), skirt: skirtC,
    belt: pick(LEATHER), boots: pick(LEATHER), fur: pick(['#e6dccb', '#8a7058', '#4a3a2a', '#cfc0a8']), hat: pick(DYES),
    metal: pick(METAL), gem: pick(GEM), hair: pick(HAIR), skin: pick(SKIN), iris: pick(IRIS),
    topFig: pick(DYES), trousersFig: pick(DYES) };
  if (kin){                                   // the household's mark goes on one garment
    const on = ['sash', 'vest', 'skirt', 'hat'].filter(k => k === 'sash' || (k === 'vest' && L.vest !== 'none') ||
      (k === 'skirt' && L.skirt !== 'none') || (k === 'hat' && L.hat === 'cap'));
    L.kinOn = pick(on); if (L.kinOn === 'sash') L.belt = 'sash';
    L.kin = kin;
  }
  return L;
}

// ---- the body ------------------------------------------------------------------
function readBody(body){
  const g = body.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, N = g.attributes.normal;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
  const n = P.count, bones = body.skeleton.bones;
  const famOfBone = bones.map(b => FAMS.indexOf(FAMILY.find(([re]) => re.test(norm(b.name)))[1]));
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), fam = new Float32Array(n * F);
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++){
    pos[i*3] = P.getX(i); pos[i*3+1] = P.getY(i); pos[i*3+2] = P.getZ(i);
    nrm[i*3] = N.getX(i); nrm[i*3+1] = N.getY(i); nrm[i*3+2] = N.getZ(i);
    ymin = Math.min(ymin, pos[i*3+1]); ymax = Math.max(ymax, pos[i*3+1]);
    for (let k = 0; k < 4; k++){
      const j = SI.getComponent(i, k), w = SW.getComponent(i, k);
      si[i*4+k] = j; sw[i*4+k] = w; fam[i*F + famOfBone[j]] += w;
    }
  }
  const joint = name => {
    const i = bones.findIndex(b => norm(b.name) === norm(name));
    return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(body.skeleton.boneInverses[i].clone().invert());
  };
  // A body split at UV seams (for its painted skin) has duplicate vertices along every
  // seam; garments walk the mesh's connectivity, so weld them back by position.
  const canon = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++){
    const k = `${Math.round(pos[i*3] * 1e5)},${Math.round(pos[i*3+1] * 1e5)},${Math.round(pos[i*3+2] * 1e5)}`;
    if (!seen.has(k)) seen.set(k, i); canon[i] = seen.get(k);
  }
  const raw = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
  const tris = Uint32Array.from(raw, i => canon[i]);
  return { n, pos, nrm, si, sw, fam, tris, ymin, ymax, H: ymax - ymin, joint };
}

// merge two (or more) weighted skin influences into the top four
function mixSkin(srcs){              // [[si, sw, off, factor], ...]
  const js = [], ws = [];            // a few influences: arrays beat a Map here
  for (const [si, sw, o, f] of srcs)
    for (let k = 0; k < 4; k++){ const w = sw[o + k] * f; if (w <= 0) continue;
      const at = js.indexOf(si[o + k]); if (at < 0){ js.push(si[o + k]); ws.push(w); } else ws[at] += w; }
  const top = js.map((j, i) => [j, ws[i]]).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const s = top.reduce((t, x) => t + x[1], 0) || 1;
  while (top.length < 4) top.push([0, 0]);
  return top.map(([j, w]) => [j, w / s]);
}

// ---- a garment cut from the body ---------------------------------------------------
// keep(i): is body vertex i inside the garment. o.gap(c), o.bridge(c), o.fold(c),
// o.post(c, p) all take a per-vertex context c = { b, n, y, th, fam(k), arm, leg }.
function shell(B, keep, o){
  const tri = [];
  for (let t = 0; t < B.tris.length; t += 3){
    const a = B.tris[t], b = B.tris[t+1], c = B.tris[t+2];
    if (keep(a) && keep(b) && keep(c)) tri.push(a, b, c);
  }
  // remap + one midpoint subdivision (folds need the resolution)
  const map = new Map(), src = [];
  const vid = i => { if (!map.has(i)){ map.set(i, src.length); src.push([i]); } return map.get(i); };
  let T = tri.map(vid);
  const mid = new Map();
  const edge = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a;
    if (!mid.has(k)){ mid.set(k, src.length); src.push([src[a][0], src[b][0], a, b]); } return mid.get(k); };
  const T2 = [];
  for (let t = 0; t < T.length; t += 3){
    const [a, b, c] = [T[t], T[t+1], T[t+2]], ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
    T2.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  T = T2;
  const V = src.length;
  const bp = new Float32Array(V * 3), bn = new Float32Array(V * 3), si = new Uint16Array(V * 4), sw = new Float32Array(V * 4);
  const fam = new Float32Array(V * F);
  for (let v = 0; v < V; v++){
    const s = src[v];
    const from = s.length === 1 ? [s[0]] : [s[0], s[1]];
    for (const i of from) for (let k = 0; k < 3; k++){ bp[v*3+k] += B.pos[i*3+k] / from.length; bn[v*3+k] += B.nrm[i*3+k]; }
    for (const i of from) for (let k = 0; k < F; k++) fam[v*F+k] += B.fam[i*F+k] / from.length;
    const sk = from.length === 1 ? mixSkin([[B.si, B.sw, from[0] * 4, 1]]) : mixSkin([[B.si, B.sw, from[0] * 4, 0.5], [B.si, B.sw, from[1] * 4, 0.5]]);
    sk.forEach(([j, w], k) => { si[v*4+k] = j; sw[v*4+k] = w; });
  }
  // adjacency + boundary (an edge used by one triangle is a hem)
  // (sorted edge keys in a typed array: Sets and Maps per vertex were a third of the shell)
  const keys = new Float64Array(T.length);
  for (let t = 0, q = 0; t < T.length; t += 3) for (let e = 0; e < 3; e++, q++){
    const a = T[t+e], b = T[t+(e+1)%3]; keys[q] = a < b ? a * 1e6 + b : b * 1e6 + a; }
  keys.sort();
  const NB = Array.from({ length: V }, () => []), bEdges = [], bnb = Array.from({ length: V }, () => []);
  for (let q = 0; q < keys.length; ){
    let r = q + 1; while (r < keys.length && keys[r] === keys[q]) r++;
    const a = Math.floor(keys[q] / 1e6), b = keys[q] - a * 1e6;
    NB[a].push(b); NB[b].push(a);
    if (r - q === 1){ bEdges.push([a, b]); bnb[a].push(b); bnb[b].push(a); }
    q = r;
  }
  const isB = bnb.map(x => x.length > 0);
  // flat neighbour lists (CSR): the wrap below is the shell's inner loop
  const csr = lists => { const off = new Int32Array(V + 1); for (let v = 0; v < V; v++) off[v + 1] = off[v] + lists[v].length;
    const adj = new Int32Array(off[V]); for (let v = 0; v < V; v++) adj.set(lists[v], off[v]); return { off, adj }; };
  const ALL = csr(NB), WRAP = csr(NB.map((l, v) => isB[v] ? bnb[v] : l));
  // smooth the normal field over the garment's own connectivity, so neighbouring
  // offsets can't cross in a concave region and fold the shell inside the body
  for (let it = 0; it < 4; it++){
    const t = new Float32Array(bn);
    for (let v = 0; v < V; v++) for (let e = ALL.off[v]; e < ALL.off[v + 1]; e++){ const u = ALL.adj[e]; t[v*3] += bn[u*3]; t[v*3+1] += bn[u*3+1]; t[v*3+2] += bn[u*3+2]; }
    for (let v = 0; v < V; v++){ const l = Math.hypot(t[v*3], t[v*3+1], t[v*3+2]) || 1; for (let k = 0; k < 3; k++) bn[v*3+k] = t[v*3+k] / l; }
  }
  // per-vertex context for the garment's rules
  const c = { b: new THREE.Vector3(), n: new THREE.Vector3(), y: 0, th: 0, mix: 0, f: null, i: 0 };
  const FI = Object.fromEntries(FAMS.map((k, i) => [k, i]));
  c.f = k => fam[c.i * F + FI[k]];                     // one closure, not one per call
  const ctx = v => {
    c.i = v; c.b.set(bp[v*3], bp[v*3+1], bp[v*3+2]); c.n.set(bn[v*3], bn[v*3+1], bn[v*3+2]);
    c.y = c.b.y; c.th = Math.atan2(c.b.x - o.cx, c.b.z - o.cz);
    let mx = 0; for (let k = 0; k < F; k++) mx = Math.max(mx, fam[v*F+k]); c.mix = 1 - mx;
    return c;
  };
  const gap = new Float32Array(V), bridge = new Float32Array(V);
  for (let v = 0; v < V; v++){ ctx(v); gap[v] = o.gap(c); bridge[v] = (o.bridge ? o.bridge(c) : 0.03) * (1 - Math.min(1, c.mix * 3)) + 0.002; }
  // wrap from outside
  let p = new Float32Array(V * 3);
  for (let v = 0; v < V; v++) for (let k = 0; k < 3; k++) p[v*3+k] = bp[v*3+k] + bn[v*3+k] * gap[v];
  const iters = o.iters ?? 18, kk = 0.5;
  for (let it = 0; it < iters; it++){
    const q = new Float32Array(p);
    const { off, adj } = WRAP;
    for (let v = 0; v < V; v++){
      const e0 = off[v], e1 = off[v + 1], cnt = e1 - e0;
      if (!cnt) continue;
      let ax = 0, ay = 0, az = 0;
      for (let e = e0; e < e1; e++){ const u = adj[e] * 3; ax += p[u]; ay += p[u+1]; az += p[u+2]; }
      q[v*3] += kk * (ax / cnt - p[v*3]); q[v*3+1] += kk * (ay / cnt - p[v*3+1]); q[v*3+2] += kk * (az / cnt - p[v*3+2]);
    }
    p = q;
    for (let v = 0; v < V; v++){
      const dx = p[v*3] - bp[v*3], dy = p[v*3+1] - bp[v*3+1], dz = p[v*3+2] - bp[v*3+2];
      const d = dx * bn[v*3] + dy * bn[v*3+1] + dz * bn[v*3+2];
      const lo = gap[v], hi = gap[v] + bridge[v];
      const push = d < lo ? lo - d : d > hi ? hi - d : 0;
      // tangential drift would slide a vertex off the skin weights it carries
      let tx = dx - d * bn[v*3], ty = dy - d * bn[v*3+1], tz = dz - d * bn[v*3+2];
      const tl = Math.sqrt(tx*tx + ty*ty + tz*tz), tmax = 0.012, ts = tl > tmax ? (tmax - tl) / tl : 0;
      p[v*3] += push * bn[v*3] + ts * tx; p[v*3+1] += push * bn[v*3+1] + ts * ty; p[v*3+2] += push * bn[v*3+2] + ts * tz;
    }
  }
  if (o.post) for (let v = 0; v < V; v++){ ctx(v); const q = new THREE.Vector3(p[v*3], p[v*3+1], p[v*3+2]); o.post(c, q); p[v*3] = q.x; p[v*3+1] = q.y; p[v*3+2] = q.z; }
  // folds along the shell's own normal; the valley depth becomes occlusion
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.setIndex(T); geo.computeVertexNormals();
  const sn = geo.attributes.normal.array, col = new Float32Array(V * 3).fill(1);
  if (o.fold) for (let v = 0; v < V; v++){
    ctx(v); const [disp, valley] = o.fold(c);
    for (let k = 0; k < 3; k++) p[v*3+k] += sn[v*3+k] * disp;
    const a = 1 - (o.ao ?? 0.45) * valley; col[v*3] = col[v*3+1] = col[v*3+2] = a;
  }
  // hem: turn the cut edge in, so the cloth has a visible thickness
  const thick = o.thick ?? 0.006, extra = [], eCol = [], eSi = [], eSw = [], eIdx = [];
  const inner = new Map();
  const innerOf = v => {
    if (!inner.has(v)){
      inner.set(v, V + extra.length / 3);
      for (let k = 0; k < 3; k++) extra.push(p[v*3+k] - sn[v*3+k] * thick);
      eCol.push(0.5, 0.5, 0.5); for (let k = 0; k < 4; k++){ eSi.push(si[v*4+k]); eSw.push(sw[v*4+k]); }
    }
    return inner.get(v);
  };
  for (const [a, b] of bEdges){ const a2 = innerOf(a), b2 = innerOf(b); eIdx.push(a, b, b2, a, b2, a2); }
  const VP = new Float32Array([...p, ...extra]);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(VP, 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array([...col, ...eCol]), 3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([...si, ...eSi], 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute([...sw, ...eSw], 4));
  out.setIndex([...T, ...eIdx]);
  if (o.uv){                                   // the garment's own UV rule; turned-in hem copies its edge
    const uv = new Float32Array((V + extra.length / 3) * 2);
    for (let v = 0; v < V; v++){ ctx(v); const [u, w] = o.uv(c); uv[v*2] = u; uv[v*2+1] = w; }
    for (const [v, k] of inner){ uv[k*2] = uv[v*2]; uv[k*2+1] = uv[v*2+1]; }
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  } else cylUV(out, o.cx, o.cz);
  out.computeVertexNormals();
  return { geo: out, p, V, si, sw, bp };
}

// one weave tile ≈ 6 cm; cylindrical about the body axis
function cylUV(geo, cx, cz){
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++){
    const th = Math.atan2(p.getX(i) - cx, p.getZ(i) - cz);
    uv[i*2] = (th / (2 * Math.PI) + 0.5) * 14; uv[i*2+1] = p.getY(i) / 0.06;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// rigid hardware: every vertex takes one skin (that of the cloth it is fixed to)
function rigid(geo, sk){
  const n = geo.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) sk.forEach(([j, w], k) => { si[i*4+k] = j; sw[i*4+k] = w; });
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (!geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geo;
}
// nearest-vertex skin from a pool of [x,y,z] positions with their skin arrays
function nearestSkin(pool, x, y, z){
  let best = -1, bd = Infinity;
  for (let i = 0; i < pool.n; i++){
    const d = (pool.p[i*3]-x) ** 2 + (pool.p[i*3+1]-y) ** 2 + (pool.p[i*3+2]-z) ** 2;
    if (d < bd){ bd = d; best = i; }
  }
  return mixSkin([[pool.si, pool.sw, best * 4, 1]]);
}

// A shoe lofted along the foot: cross-sections of the foot's own vertices (toes
// and all) taken in slices from heel to tip, each closed into a boxy superellipse
// with a flat sole. The envelope of the toes, not the toes.
function shoe(B, inFoot, ankleY){
  const ids = []; for (let i = 0; i < B.n; i++) if (inFoot(i)) ids.push(i);
  let z0 = Infinity, z1 = -Infinity;
  for (const i of ids){ z0 = Math.min(z0, B.pos[i*3+2]); z1 = Math.max(z1, B.pos[i*3+2]); }
  const S = 18, R = 24, clr = 0.007, sole = 0.008, sl = [];
  for (let k = 0; k < S; k++){
    const za = z0 + (z1 - z0) * k / S, zb = z0 + (z1 - z0) * (k + 1) / S;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const i of ids){ const z = B.pos[i*3+2]; if (z < za - 0.004 || z > zb + 0.004) continue;
      x0 = Math.min(x0, B.pos[i*3]); x1 = Math.max(x1, B.pos[i*3]); y0 = Math.min(y0, B.pos[i*3+1]); y1 = Math.max(y1, B.pos[i*3+1]); }
    if (x0 < Infinity) sl.push({ z: (za + zb) / 2, x0, x1, y0, y1: Math.min(y1, ankleY + 0.035) });
  }
  for (let it = 0; it < 2; it++) for (let k = 1; k < sl.length - 1; k++)      // smooth along the foot
    for (const f of ['x0', 'x1', 'y1']) sl[k][f] = (sl[k-1][f] + 2 * sl[k][f] + sl[k+1][f]) / 4;
  const floorY = Math.min(...sl.map(q => q.y0)) - sole;
  const pos = [], col = [], idx = [], src = [];
  for (const q of sl){
    const xc = (q.x0 + q.x1) / 2, a = (q.x1 - q.x0) / 2 + clr, yc = (q.y0 + q.y1) / 2;
    const bt = q.y1 - yc + clr;
    for (let r = 0; r < R; r++){
      const ph = 2 * Math.PI * r / R, cs = Math.cos(ph), sn = Math.sin(ph);
      const x = xc + a * Math.sign(cs) * Math.abs(cs) ** 0.6;
      const y = sn >= 0 ? yc + bt * sn ** 0.8 : Math.max(floorY, yc - (yc - floorY) * Math.abs(sn) ** 0.35);
      pos.push(x, y, q.z); col.push(...(y <= floorY + 0.004 ? [0.32, 0.32, 0.32] : [1, 1, 1]));
    }
  }
  const N = sl.length;
  for (let k = 0; k < N - 1; k++) for (let r = 0; r < R; r++){
    const a = k * R + r, b = k * R + (r + 1) % R, c = (k + 1) * R + r, d = (k + 1) * R + (r + 1) % R;
    idx.push(a, b, c, b, d, c);
  }
  for (const [k, dz] of [[0, -0.006], [N - 1, 0.008]]){                          // heel and toe caps
    const q = sl[k], ci = pos.length / 3;
    pos.push((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2 - 0.004, q.z + dz); col.push(1, 1, 1);
    for (let r = 0; r < R; r++) idx.push(ci, k * R + r, k * R + (r + 1) % R);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const pool = { n: ids.length, p: Float32Array.from(ids.flatMap(i => [B.pos[i*3], B.pos[i*3+1], B.pos[i*3+2]])),
    si: Uint16Array.from(ids.flatMap(i => [...B.si.slice(i*4, i*4+4)])), sw: Float32Array.from(ids.flatMap(i => [...B.sw.slice(i*4, i*4+4)])) };
  const n = pos.length / 3, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) nearestSkin(pool, pos[i*3], pos[i*3+1], pos[i*3+2]).forEach(([j, w], k) => { si[i*4+k] = j; sw[i*4+k] = w; });
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

// ---- materials -----------------------------------------------------------------
function materials(spec, env){
  const cloth = (hex, weave, extra = {}) => new THREE.MeshPhysicalMaterial({
    color: hex, roughness: 0.93, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
    sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.25),
    normalMap: weave || null, normalScale: new THREE.Vector2(0.7, 0.7), envMap: env, envMapIntensity: 0.35, ...extra });
  return {
    cloth: (hex, map = null) => cloth(map ? '#ffffff' : hex, spec.weave, map ? { map } : {}),
    leather: hex => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.5, metalness: 0, vertexColors: true,
      side: THREE.DoubleSide, clearcoat: 0.3, clearcoatRoughness: 0.45, envMap: env, envMapIntensity: 0.5 }),
    fur: hex => cloth(hex, spec.fleece || null, { roughness: 1, sheen: 1, sheenRoughness: 0.9, normalScale: new THREE.Vector2(1.6, 1.6) }),
    hair: hex => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.55, metalness: 0, vertexColors: true,
      side: THREE.DoubleSide, sheen: 0.6, sheenRoughness: 0.35, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.35),
      envMap: env, envMapIntensity: 0.4 }),
    metal: hex => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.26, metalness: 1, vertexColors: true,
      envMap: env, envMapIntensity: 1.3 }),
    gem: hex => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.04, metalness: 0, clearcoat: 1,
      clearcoatRoughness: 0.02, vertexColors: true, envMap: env, envMapIntensity: 1.8 }),
  };
}

// a plain grid surface (rings × columns) as skinned geometry; skin per vertex from a pool
function gridGeo(pos, col, nu, nv, closed, pool, uvScale = [6, 0.11]){
  const idx = [];
  for (let r = 0; r < nv - 1; r++) for (let u = 0; u < (closed ? nu : nu - 1); u++){
    const a = r * nu + u, b = r * nu + (u + 1) % nu, c = (r + 1) * nu + u, d = (r + 1) * nu + (u + 1) % nu;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = pos.length / 3, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++){ uv[i*2] = (i % nu) / nu * uvScale[0] * 14 / 6; uv[i*2+1] = pos[i*3+1] / 0.06; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) (typeof pool === 'function' ? pool(i) : nearestSkin(pool, pos[i*3], pos[i*3+1], pos[i*3+2])).forEach(([j, w], k) => { si[i*4+k] = j; sw[i*4+k] = w; });
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return g;
}
const poolOf = (...shells) => {
  const n = shells.reduce((t, s) => t + s.n, 0), p = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  let o = 0; for (const s of shells){ p.set(s.p.subarray(0, s.n * 3), o * 3); si.set(s.si.subarray(0, s.n * 4), o * 4); sw.set(s.sw.subarray(0, s.n * 4), o * 4); o += s.n; }
  return { n, p, si, sw };
};

// ---- the outfit ------------------------------------------------------------------
// buildOutfit(bodyMesh, look, { env, weave, fleece, pattern }) -> { group, parts, materials, skirt, info }
// opts.pattern(kin, groundHex) -> THREE.Texture | null: the household's wagara mark
// as a tile (the studio builds it from kin-mark.js; null where there is no DOM).
export function buildOutfit(body, look, opts = {}){
  const ms = {}, t0 = performance.now(); let tl = t0;
  const lap = k => { const t = performance.now(); ms[k] = Math.round(t - tl); tl = t; };
  const B = readBody(body), H = B.H, y0 = B.ymin;
  lap('body');
  const C = { ...LOOKS.peasant.colors, ...(look.colors || {}) };
  // a tunic is ONE garment: its skirt is the top's cloth, colour and print and household mark
  const tunic = look.top === 'tunic' && look.skirt === 'tunic';
  if (!look.colors?.skirt || tunic) C.skirt = C.top;
  const jc = new Map(), J = n => { if (!jc.has(n)) jc.set(n, B.joint(n)); return jc.get(n); };   // called per vertex: cache
  const hipL = J('upperleg01.L'), hipR = J('upperleg01.R'), root = J('root');
  const cx = (hipL.x + hipR.x) / 2, cz = root.z * 0.5 + (hipL.z + hipR.z) / 4;
  const ankleY = (J('foot.L').y + J('foot.R').y) / 2;
  const beltY = y0 + 0.565 * H;
  const bootTop = ankleY + 0.17 * (H / 1.65);
  const M = materials(opts, opts.env || null);
  const kinMap = (on, ground) => (look.kin && look.kinOn === on && opts.pattern) ? opts.pattern(look.kin, ground) : null;
  const mats = [], parts = [];
  const add = (geo, mat, name) => {
    const m = new THREE.SkinnedMesh(geo, mat); m.name = name; m.frustumCulled = false;
    m.castShadow = m.receiveShadow = true; parts.push(m); if (!mats.includes(mat)) mats.push(mat); return m;
  };
  // each body vertex's dominant bone family, once (asked for millions of times)
  const DOM = Array.from({ length: B.n }, (_, i) => { let b = 0; for (let k = 1; k < F; k++) if (B.fam[i*F+k] > B.fam[i*F+b]) b = k; return FAMS[b]; });
  const domFam = i => DOM[i];
  const by = i => B.pos[i*3+1];
  const bodyPool = { n: B.n, p: B.pos, si: B.si, sw: B.sw };
  const headBone = body.skeleton.bones.findIndex(b => norm(b.name) === 'head');
  const headSkin = [[headBone, 1], [0, 0], [0, 0], [0, 0]];
  const wristL = J('wrist.L'), wristR = J('wrist.R'), elbowL = J('lowerarm01.L'), elbowR = J('lowerarm01.R');
  const shL = J('upperarm01.L'), shR = J('upperarm01.R');
  // distance along the arm from the shoulder, and the forearm fraction — plain
  // arithmetic: it runs for every arm vertex several times per garment
  const ARMJ = { 1: [shL, elbowL, wristL], [-1]: [shR, elbowR, wristR] };
  const armS = b => {
    const [sh, el, wr] = ARMJ[b.x > cx ? 1 : -1];
    const ux = el.x - sh.x, uy = el.y - sh.y, uz = el.z - sh.z, lx = wr.x - el.x, ly = wr.y - el.y, lz = wr.z - el.z;
    const up = Math.sqrt(ux*ux + uy*uy + uz*uz), lo = Math.sqrt(lx*lx + ly*ly + lz*lz);
    const ex = b.x - el.x, ey = b.y - el.y, ez = b.z - el.z, along = ex*lx + ey*ly + ez*lz;
    const t = Math.max(0, Math.min(1, along / (lo * lo)));
    const fx = el.x + lx*t - b.x, fy = el.y + ly*t - b.y, fz = el.z + lz*t - b.z;
    const mx = sh.x + ux*0.5 - b.x, my = sh.y + uy*0.5 - b.y, mz = sh.z + uz*0.5 - b.z;
    const inFore = fx*fx + fy*fy + fz*fz < mx*mx + my*my + mz*mz && along > 0;
    if (inFore) return { s: up + t * lo, fore: t, up, len: up + lo };
    const sx = b.x - sh.x, sy = b.y - sh.y, sz = b.z - sh.z;
    return { s: Math.max(0, (sx*ux + sy*uy + sz*uz) / up), fore: 0, up, len: up + lo };
  };
  const vecOf = i => new THREE.Vector3(B.pos[i*3], B.pos[i*3+1], B.pos[i*3+2]);
  // UVs that wrap each limb, so a printed pattern keeps its size and doesn't smear: arc
  // length round the limb's own axis (legs: vertical through the hip; arms: shoulder to
  // wrist), height or distance along it; 1 UV unit = 6 cm.
  const armAxis = side => { const sh = side > 0 ? shL : shR, wr = side > 0 ? wristL : wristR, a = wr.clone().sub(sh).normalize();
    const e1 = a.clone().cross(new THREE.Vector3(0, 0, 1)).normalize(); return { sh, a, e1, e2: e1.clone().cross(a) }; };
  const AX = { 1: armAxis(1), [-1]: armAxis(-1) };
  const limbUV = c => {
    const b = c.b;
    if (c.f('arm') > 0.5){ const X = AX[b.x > cx ? 1 : -1], d = b.clone().sub(X.sh);
      return [Math.atan2(d.dot(X.e1), d.dot(X.e2)) * 0.045 / 0.06, d.dot(X.a) / 0.06]; }
    if (c.f('leg') > 0.5){ const hp = b.x > cx ? hipL : hipR; return [Math.atan2(b.x - hp.x, b.z - hp.z) * 0.075 / 0.06, b.y / 0.06]; }
    return [Math.atan2(b.x - cx, b.z - cz) * 0.14 / 0.06, b.y / 0.06];
  };
  const fab = k => (opts.fabric && look[k + 'Pattern'] && look[k + 'Pattern'] !== 'none') ? opts.fabric[k] || null : null;
  const tunicMap = tunic ? (kinMap('skirt', C.top) || fab('top')) : null;

  // -- trousers: legs + pelvis, belt line down into the boots (or to the ankle)
  let trousers = null;
  {                                            // always: a skirt's cloth can swing clear of the legs
    const end = look.feet === 'boots' ? ankleY + 0.05 : ankleY + 0.012;
    const bunchAt = look.feet === 'boots' ? bootTop : end;
    trousers = shell(B, i => { const f = domFam(i);
      if (f === 'leg') return by(i) > end; return f === 'torso' && by(i) < beltY + 0.02; }, { cx, cz,
      gap: c => (look.feet === 'boots' && c.y < bootTop) ? 0.007 : 0.009 + 0.012 * smooth(hipL.y, bunchAt + 0.1, c.y),
      bridge: () => 0.02,
      fold: c => {
        const above = c.y - bunchAt;
        const a = 0.0045 * bump(above, 0.03, 0.045) + 0.0025 * bump(c.y, J('lowerleg01.L').y, 0.05);
        const w = crease(above / 0.028 * Math.PI + 0.6 * Math.sin(c.th * 3));
        const blouse = above > 0 ? 0.01 * bump(above, 0.035, 0.03) : 0;
        return [a * (w * 2 - 1) + blouse, a > 0.0015 ? 1 - w : 0];
      }, uv: limbUV });
    add(trousers.geo, M.cloth(C.trousers, fab('trousers')), 'trousers');
  }
  lap('trousers');

  // -- top: tunic (loose, bloused over the belt) or shirt (closer, tucked); sleeves by style
  const tunicLike = look.top === 'tunic';
  const topGap = c => tunicLike ? 0.016 + 0.01 * bump(c.y - beltY, 0.05, 0.035) : 0.012 + 0.005 * bump(c.y - beltY, 0.04, 0.03);
  let top = null;
  if (look.top !== 'none'){
    const sl = look.sleeves;
    top = shell(B, i => {
      const f = domFam(i);
      if (f === 'torso') return by(i) > beltY - 0.04;
      if (f !== 'arm' || sl === 'none') return false;
      const a = armS(vecOf(i));
      return sl === 'short' ? a.fore === 0 && a.s < a.up * 0.55 : a.fore < (sl === 'puff' ? 0.9 : 0.93);
    }, { cx, cz,
      gap: c => {
        if (c.f('arm') > 0.5){ const a = armS(c.b);
          if (sl === 'puff') return 0.012 + 0.022 * Math.sin(Math.PI * Math.min(1, a.fore / 0.9)) * (a.fore > 0 ? 1 : 0) + 0.006 * (a.s / a.len);
          return 0.011 + 0.004 * (a.s / a.len); }
        return topGap(c);
      },
      bridge: c => c.f('arm') > 0.5 ? 0.01 : 0.045,
      fold: c => {
        if (c.f('arm') > 0.5){
          const a = armS(c.b);
          const cuff = a.fore > 0 ? bump(a.fore, 0.86, 0.12) : 0, elbow = bump(a.s, a.up, 0.06) * (sl === 'straight' ? 1.6 : 1);
          const w1 = crease(c.th * 7 + a.s * 9), w2 = crease(a.s / 0.024 * Math.PI);
          const d = (sl === 'puff' ? 0.004 : 0.0015) * cuff * (2 * w1 - 1) + 0.003 * elbow * (2 * w2 - 1);
          return [d, cuff * (1 - w1) + elbow * (1 - w2)];
        }
        const up = c.y - beltY, g = smooth(0.2 * H, 0.0, up) * (tunicLike ? 1 : 0.6);
        const w = crease(c.th * 8 + 0.9 * Math.sin(c.th * 3 + 1.3) + up * 6);
        return [0.007 * g * (2 * w - 1), g * (1 - w) + 0.6 * bump(up, 0.012, 0.012)];
      },
      post: (c, q) => {                                          // cinch inside the belt
        const t = bump(c.y, beltY, 0.022);
        if (t < 0.05 || c.f('torso') < 0.5 || look.belt === 'none') return;
        q.x = cx + (q.x - cx) * (1 - 0.12 * t); q.z = cz + (q.z - cz) * (1 - 0.12 * t);
      }, uv: limbUV });
    add(top.geo, M.cloth(C.top, tunic ? tunicMap : fab('top')), 'top');
  }
  lap('top');

  // -- vest over the top: a buttoned jerkin, or a laced bodice
  let vest = null;
  if (look.vest !== 'none'){
    const jerk = look.vest === 'jerkin', clav = J('clavicle.L').y;
    const yTop = jerk ? Infinity : (beltY + clav) / 2 + 0.03, yBot = jerk ? beltY - 0.09 : beltY - 0.05;
    vest = shell(B, i => domFam(i) === 'torso' && by(i) > yBot && by(i) < yTop && B.fam[i*F+1] < 0.15, { cx, cz,
      gap: c => (top ? topGap(c) : 0.008) + (jerk ? 0.01 : 0.006) - (jerk ? 0 : 0.006 * bump(c.y, beltY, 0.03)),
      bridge: () => 0.04,
      fold: c => { const w = crease(c.th * 5 + c.y * 12); const a = jerk ? 0.0025 * bump(c.y, beltY - 0.04, 0.04) : 0;
        return [a * (2 * w - 1), a ? 0.6 * (1 - w) : 0]; },
      thick: 0.007 });
    const vmap = kinMap('vest', C.vest);
    add(vest.geo, jerk && !vmap ? M.leather(C.vest) : M.cloth(C.vest, vmap), 'vest');
    // front fastening, laid on the vest's own front surface
    const vp = poolOf({ n: vest.V, p: vest.p, si: vest.si, sw: vest.sw });
    const frontZ = (x, y) => { let z = -Infinity; for (let v = 0; v < vest.V; v++)
      if (Math.abs(vest.p[v*3] - x) < 0.01 && Math.abs(vest.p[v*3+1] - y) < 0.01) z = Math.max(z, vest.p[v*3+2]); return z; };
    let vyTop = -Infinity; for (let v = 0; v < vest.V; v++) if (Math.abs(vest.p[v*3] - cx) < 0.01) vyTop = Math.max(vyTop, vest.p[v*3+1]);
    const lo = yBot + 0.03, hi = Math.min(vyTop - 0.02, yTop - 0.02);
    if (jerk){
      const btn = [];
      for (let k = 0; k < 5; k++){ const y = lo + (hi - lo) * k / 4, z = frontZ(cx, y); if (!isFinite(z)) continue;
        btn.push(rigid(new THREE.SphereGeometry(0.0065, 8, 6).scale(1, 1, 0.6).translate(cx, y, z + 0.003).toNonIndexed(), nearestSkin(vp, cx, y, z))); }
      if (btn.length) add(mergeGeometries(btn), M.metal(C.metal), 'buttons');
    } else {
      const N = 6, pts = []; const lace = [];
      for (let k = 0; k <= N; k++){ const y = lo + (hi - lo) * k / N;
        for (const sx of [-1, 1]){ const x = cx + sx * 0.02, z = frontZ(x, y); pts.push(new THREE.Vector3(x, y, (isFinite(z) ? z : 0) + 0.003)); } }
      for (let k = 0; k < N; k++) for (const [a, b] of [[2*k, 2*k+3], [2*k+1, 2*k+2]]){
        const A = pts[a], Bp = pts[b], d = Bp.clone().sub(A), len = d.length();
        lace.push(rigid(new THREE.CylinderGeometry(0.0016, 0.0016, len, 5).translate(0, len / 2, 0)
          .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(A.x, A.y, A.z).toNonIndexed(),
          nearestSkin(vp, A.x, A.y, A.z)));
      }
      add(mergeGeometries(lace), M.leather(C.belt), 'lacing');
      add(mergeGeometries(pts.map(q => rigid(new THREE.TorusGeometry(0.003, 0.0012, 5, 10).translate(q.x, q.y, q.z).toNonIndexed(), nearestSkin(vp, q.x, q.y, q.z)))), M.metal(C.metal), 'eyelets');
    }
  }
  lap('vest');

  // the outermost layer at the belt line, for the belt and the skirt to sit on
  const outer = vest && vest.V ? vest : top;
  const surfPool = outer ? poolOf({ n: outer.V, p: outer.p, si: outer.si, sw: outer.sw }) : bodyPool;
  let rx = 0, zf = -Infinity, zb = Infinity;
  const scan = (P, n, keep = () => true) => { for (let v = 0; v < n; v++){ const x = P[v*3], y = P[v*3+1], z = P[v*3+2];
    if (Math.abs(y - beltY) > 0.02 || !keep(v)) continue; rx = Math.max(rx, Math.abs(x - cx)); zf = Math.max(zf, z); zb = Math.min(zb, z); } };
  if (outer) scan(outer.p, outer.V); else scan(B.pos, B.n, v => domFam(v) === 'torso');
  const beltE = { rx: rx + 0.004, rz: (zf - zb) / 2 + 0.004, cz: (zf + zb) / 2 };
  // ...and its real outline there, per angle (a from +z toward +x, like `at` below). An
  // ellipse round it stands proud at the corners, which made the skirt boxy at the waist.
  const NB = 72, beltR = new Float32Array(NB);
  const putB = (x, z) => { const a = Math.atan2(x - cx, z - beltE.cz), k = ((Math.round(a / (2 * Math.PI) * NB) % NB) + NB) % NB;
    beltR[k] = Math.max(beltR[k], Math.hypot(x - cx, z - beltE.cz)); };
  if (outer){ for (let v = 0; v < outer.V; v++) if (Math.abs(outer.p[v*3+1] - beltY) < 0.02) putB(outer.p[v*3], outer.p[v*3+2]); }
  else for (let i = 0; i < B.n; i++) if (domFam(i) === 'torso' && Math.abs(by(i) - beltY) < 0.02) putB(B.pos[i*3], B.pos[i*3+2]);
  for (let it = 0; it < 4; it++){ const q = new Float32Array(beltR);
    for (let k = 0; k < NB; k++){ const L = beltR[(k + NB - 1) % NB], Cc = beltR[k], R = beltR[(k + 1) % NB];
      q[k] = Cc ? (L && R ? (L + 2 * Cc + R) / 4 : Cc) : Math.max(L, R); }
    beltR.set(q); }
  const outlineAt = a => { const f = ((a / (2 * Math.PI) * NB) % NB + NB) % NB, k = Math.floor(f) % NB, t = f - Math.floor(f);
    return (beltR[k] * (1 - t) + beltR[(k + 1) % NB] * t) + 0.004; };
  // the skirt's pleats fold outward from that outline, so a belt must sit outside them
  const pleatOut = look.skirt === 'long' ? 0.05 : look.skirt === 'tunic' ? 0.07 : 0;
  const beltAt = a => outlineAt(a) * (1 + pleatOut) + 0.011;      // its INNER face (up to 7 mm in) still clears the pleats

  // -- belt (leather + buckle + studs + pouch) or sash (cloth, knotted at the hip)
  const at = (a, out = 0, y = beltY) => new THREE.Vector3(cx + Math.sin(a) * beltAt(a) * (1 + out), y, beltE.cz + Math.cos(a) * beltAt(a) * (1 + out));
  const skinAt = v => nearestSkin(surfPool, v.x, v.y, v.z);
  if (look.belt !== 'none'){
    const sash = look.belt === 'sash', N = 72, hw = sash ? 0.032 : 0.021, th = sash ? 0.007 : 0.005, pos = [], col = [];
    for (const [rr, yy, cc] of [[0, beltY + hw, 1], [0.012, beltY, 1], [0, beltY - hw, 1], [-1, beltY - hw, 0.55], [-1, beltY + hw, 0.55]])
      for (let k = 0; k < N; k++){ const a = 2 * Math.PI * k / N, w = sash ? crease(a * 9) : 1, R = beltAt(a);
        const r = rr < 0 ? R - th : R * (1 + rr);
        pos.push(cx + Math.sin(a) * r, yy, beltE.cz + Math.cos(a) * r); const q = cc * (sash ? 0.75 + 0.25 * w : 1); col.push(q, q, q); }
    // rows: top, bulge, bottom, inner-bottom, inner-top -> a closed band
    const idx = []; const R = 5;
    for (let r = 0; r < R; r++) for (let k = 0; k < N; k++){ const a = r*N+k, b = r*N+(k+1)%N, c = ((r+1)%R)*N+k, d = ((r+1)%R)*N+(k+1)%N; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const uv = new Float32Array(pos.length / 3 * 2); for (let i = 0; i < pos.length / 3; i++){ uv[i*2] = (i % N) / N * 14; uv[i*2+1] = pos[i*3+1] / 0.06; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeVertexNormals();
    const n = pos.length / 3, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) nearestSkin(surfPool, pos[i*3], pos[i*3+1], pos[i*3+2]).forEach(([j, w], k) => { si[i*4+k] = j; sw[i*4+k] = w; });
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const smap = sash ? kinMap('sash', C.belt) : null;
    add(g, sash ? M.cloth(C.belt, smap) : M.leather(C.belt), sash ? 'sash' : 'belt');
    if (sash){                                                   // knot + two tails at the left hip
      const ka = 1.05, kv = at(ka, 0.03), sk = skinAt(at(ka));
      const knot = new THREE.SphereGeometry(0.026, 10, 8).scale(1, 0.8, 0.6).rotateY(ka).translate(kv.x, beltY, kv.z);
      const tails = [-0.012, 0.014].map((dx, k) => new THREE.BoxGeometry(0.034, 0.24 - k * 0.05, 0.006)
        .translate(0, -(0.24 - k * 0.05) / 2, 0).rotateZ(k ? -0.12 : 0.1).rotateY(ka).translate(kv.x + dx * Math.cos(ka), beltY - 0.01, kv.z - dx * Math.sin(ka)));
      add(rigid(mergeGeometries([knot.toNonIndexed(), ...tails.map(t => t.toNonIndexed())]), sk), M.cloth(C.belt, smap), 'sash-knot');
    } else {
      const fp = at(0, 0.02), sk = skinAt(at(0));
      const bars = [[0.05, 0.007, 0, 0.0215], [0.05, 0.007, 0, -0.0215], [0.007, 0.05, -0.0215, 0], [0.007, 0.05, 0.0215, 0], [0.004, 0.05, 0.002, 0]];
      const pieces = bars.map(([w, h, x, y]) => new THREE.BoxGeometry(w, h, 0.006).translate(fp.x + x, fp.y + y, fp.z + 0.003));
      pieces.push(new THREE.BoxGeometry(0.03, 0.004, 0.004).translate(fp.x + 0.014, fp.y, fp.z + 0.006));
      add(rigid(mergeGeometries(pieces.map(q => q.toNonIndexed())), sk), M.metal(C.metal), 'buckle');
      const studs = [];
      for (const a of [0.45, 0.75, 1.05, 1.35, 1.65, -0.45, -0.75, -1.05, -1.35, -1.65]){ const v = at(a, 0.012);
        studs.push(rigid(new THREE.SphereGeometry(0.0055, 8, 6).scale(1, 1, 0.55).lookAt(new THREE.Vector3(Math.sin(a), 0, Math.cos(a))).translate(v.x, v.y, v.z).toNonIndexed(), skinAt(at(a)))); }
      add(mergeGeometries(studs), M.metal(C.metal), 'studs');
      const pa = 1.25, pv = at(pa, 0.09);
      const pouch = new THREE.SphereGeometry(0.042, 12, 10).scale(0.85, 1, 0.45).rotateY(pa).translate(pv.x, beltY - 0.055, pv.z);
      const flap = new THREE.BoxGeometry(0.06, 0.03, 0.012).rotateY(pa).translate(pv.x, beltY - 0.022, pv.z);
      add(rigid(mergeGeometries([pouch.toNonIndexed(), flap.toNonIndexed()]), skinAt(at(pa))), M.leather(C.boots), 'pouch');
    }
  }
  lap('belt');

  // How far the trousers stand off each leg bone: the sim's leg colliders must be at
  // least this fat, or the skirt passes through the trousers (it collided with a fixed
  // 10 cm capsule round the bone, inside a loose trouser leg).
  const trouserRadii = () => {
    const seg = (a, b, side) => { const ab = b.clone().sub(a), L2 = ab.lengthSq(), ds = [];
      for (let v = 0; v < trousers.V; v++){
        const q = new THREE.Vector3(trousers.p[v*3], trousers.p[v*3+1], trousers.p[v*3+2]);
        if (Math.sign(q.x - cx) !== side) continue;
        const t = q.clone().sub(a).dot(ab) / L2; if (t < 0.1 || t > 0.9) continue;
        ds.push(q.distanceTo(a.clone().addScaledVector(ab, t)));
      }
      ds.sort((x, y) => x - y); return ds.length ? ds[Math.floor(ds.length * 0.95)] : 0.09; };
    const kL = J('lowerleg01.L'), kR = J('lowerleg01.R'), aL = J('foot.L'), aR = J('foot.R');
    return { thigh: Math.max(seg(hipL, kL, 1), seg(hipR, kR, -1)) + 0.01, shin: Math.max(seg(kL, aL, 1), seg(kR, aR, -1)) + 0.01 };
  };

  // -- skirt spec for the studio's cloth sim, draping over the body's own profile
  let skirt = null;
  if (look.skirt !== 'none'){
    const long = look.skirt === 'long', hemY = long ? ankleY + 0.025 : y0 + 0.40 * H;
    const ny = long ? 24 : 16, nt = 48, profR = new Float32Array(ny * nt);
    const putP = (x, y, z) => {
      const row = Math.round((beltY - y) / (beltY - hemY) * (ny - 1));
      if (row < 0 || row >= ny) return;
      const th = Math.atan2(z - beltE.cz, x - cx), cl = ((Math.round(th / (2 * Math.PI) * nt) % nt) + nt) % nt;
      profR[row * nt + cl] = Math.max(profR[row * nt + cl], Math.hypot(x - cx, z - beltE.cz));
    };
    if (trousers) for (let v = 0; v < trousers.V; v++) putP(trousers.p[v*3], trousers.p[v*3+1], trousers.p[v*3+2]);
    for (let i = 0; i < B.n; i++){ const f = domFam(i); if (f === 'torso' || f === 'leg') putP(B.pos[i*3], by(i), B.pos[i*3+2]); }
    for (let it = 0; it < 3; it++){
      const q = new Float32Array(profR);
      for (let r = 0; r < ny; r++) for (let c = 0; c < nt; c++){
        const L = profR[r*nt + (c+nt-1)%nt], Cc = profR[r*nt+c], Rr = profR[r*nt + (c+1)%nt];
        q[r*nt+c] = Cc ? (L && Rr ? (L + 2 * Cc + Rr) / 4 : Cc) : Math.max(L, Rr);
      }
      profR.set(q);
    }
    const smap = tunic ? tunicMap : kinMap('skirt', C.skirt);
    // topR: the outline as the sim's top ring, in ITS angle convention (th from +x toward +z)
    const topR = Float32Array.from({ length: NB }, (_, k) => outlineAt(Math.PI / 2 - 2 * Math.PI * k / NB) - 0.002);
    skirt = { attachY: beltY - 0.004, hemY, cx, cz: beltE.cz, topR, topRx: beltE.rx * 0.985, topRz: beltE.rz * 0.985,
      // a long skirt must make room for a full stride: more flare, more swing, and leg
      // colliders padded so the cloth is pushed AHEAD of a stepping leg, not parted round it
      flare: long ? 1.8 : 1.32, pleats: long ? 26 : 22, pleat: pleatOut, swing: long ? 0.12 : 0.13, legPad: long ? 0.02 : 0.008, follow: long ? 0.85 : 0.3, segs: long ? 78 : 66, rings: long ? 22 : 13,
      profile: { ya: beltY - 0.004, yb: hemY, ny, nt, cx, cz: beltE.cz, r: profR, crotchY: Math.min(hipL.y, hipR.y) - 0.09 },
      legR: trouserRadii(),
      material: M.cloth(C.skirt, smap) };
    mats.push(skirt.material);
  }

  // -- feet: boots (shaft + lofted shoe + optional fur cuff) or shoes
  if (look.feet !== 'none'){
    const geos = [];
    if (look.feet === 'boots'){
      const shaft = shell(B, i => domFam(i) === 'leg' && by(i) < bootTop, { cx, cz,
        gap: c => (c.y > ankleY + 0.04 ? 0.016 : 0.011), bridge: () => 0.006,
        fold: c => { const a = 0.0018 * bump(c.y, ankleY + 0.05, 0.03); const w = crease(c.y / 0.016 * Math.PI + c.th * 2);
          return [a * (2 * w - 1), a > 0.0008 ? 1 - w : 0]; }, thick: 0.004 });
      geos.push(shaft.geo);
      if (look.cuff === 'fur'){
        const cuff = shell(B, i => domFam(i) === 'leg' && by(i) < bootTop + 0.02 && by(i) > bootTop - 0.07, { cx, cz,
          gap: () => 0.03, bridge: () => 0.01, iters: 12, thick: 0.012,
          fold: c => { const w = crease(c.th * 11 + Math.sin(c.th * 4)); return [0.003 * (2 * w - 1), 0.6 * (1 - w)]; } });
        add(cuff.geo, M.fur(C.fur), 'cuffs');
      }
    }
    for (const side of [1, -1]) geos.push(shoe(B, i => domFam(i) === 'foot' && side * B.pos[i*3] > 0, ankleY));
    add(mergeGeometries(geos), M.leather(C.boots), look.feet);
  }
  lap('feet');

  // ---- the head: landmarks from the face rig ----
  const eye = J('eye.L').clone().add(J('eye.R')).multiplyScalar(0.5), mouthY = J('oris03.L').y, noseY = J('levator06.L').y;
  const neck = J('neck01');
  const headIdx = []; for (let i = 0; i < B.n; i++) if (domFam(i) === 'head' && by(i) > neck.y - 0.01) headIdx.push(i);
  const inHead = new Uint8Array(B.n); for (const i of headIdx) inHead[i] = 1;
  let topY = -Infinity, zFront = -Infinity, zBack = Infinity, skullW = 0, chinY = Infinity;
  for (const i of headIdx){
    const x = B.pos[i*3], y = by(i), z = B.pos[i*3+2];
    topY = Math.max(topY, y);
    if (Math.abs(y - eye.y) < 0.01){ zFront = Math.max(zFront, z); zBack = Math.min(zBack, z); }
    if (Math.abs(y - (eye.y + 0.045)) < 0.008) skullW = Math.max(skullW, Math.abs(x - eye.x));
    if (Math.abs(x - eye.x) < 0.015 && z > eye.z - 0.01 && y < mouthY) chinY = Math.min(chinY, y);
  }
  const hz = (zFront + zBack) / 2, hx = eye.x;
  const thOf = (x, z) => Math.atan2(x - hx, z - hz);           // 0 = facing front
  const hairline = th => { const c = Math.cos(th), yF = eye.y + 0.05, yS = eye.y + 0.012, yB = mouthY - 0.02;
    return c >= 0 ? yS + (yF - yS) * c ** 0.6 : yS + (yB - yS) * (-c) ** 0.8; };
  const isEar = i => Math.abs(B.pos[i*3] - hx) > skullW + 0.006 && by(i) < eye.y + 0.03;
  // what hangs over the head and shoulders rests on: head, neck, torso (not arms)
  const restOn = []; for (let i = 0; i < B.n; i++){ const f = domFam(i); if ((f === 'head' || f === 'torso') && by(i) > beltY) restOn.push(i); }
  // What hangs over the head and shoulders rests on — as a lookup table: the outermost
  // radius (round the head axis) per angle × height bin, max-filtered by the search
  // window (±0.14 rad, ±12 mm). Searching every point per query made hair the
  // slowest garment.
  const surfTables = new Map();
  const surfTable = extra => {
    if (surfTables.has(extra)) return surfTables.get(extra);
    const NT = 180, Y0 = beltY - 0.02, DY = 0.004, NY = Math.ceil((topY + 0.06 - Y0) / DY), raw = new Float32Array(NT * NY);
    const put = (x, y, z) => { const r = Math.floor((y - Y0) / DY); if (r < 0 || r >= NY) return;
      const c = ((Math.floor((thOf(x, z) + Math.PI) / (2 * Math.PI) * NT) % NT) + NT) % NT;
      const k = r * NT + c, d = Math.hypot(x - hx, z - hz); if (d > raw[k]) raw[k] = d; };
    for (const i of restOn) put(B.pos[i*3], by(i), B.pos[i*3+2]);
    if (extra) for (let v = 0; v < extra.V; v++) put(extra.p[v*3], extra.p[v*3+1], extra.p[v*3+2]);
    const wt = Math.round(0.14 / (2 * Math.PI) * NT), wy = Math.round(0.012 / DY);
    const tmp = new Float32Array(NT * NY), out = new Float32Array(NT * NY);
    for (let r = 0; r < NY; r++) for (let c = 0; c < NT; c++){ let m = 0; for (let k = -wt; k <= wt; k++) m = Math.max(m, raw[r * NT + (c + k + NT) % NT]); tmp[r * NT + c] = m; }
    for (let r = 0; r < NY; r++) for (let c = 0; c < NT; c++){ let m = 0; for (let k = Math.max(0, r - wy); k <= Math.min(NY - 1, r + wy); k++) m = Math.max(m, tmp[k * NT + c]); out[r * NT + c] = m; }
    const T = { NT, NY, Y0, DY, out }; surfTables.set(extra, T); return T;
  };
  const surfAt = (th, y, extra) => {                           // outermost radius around the head axis
    const T = surfTable(extra || null), r = Math.floor((y - T.Y0) / T.DY);
    if (r < 0 || r >= T.NY) return 0;
    const c = ((Math.floor((th + Math.PI) / (2 * Math.PI) * T.NT) % T.NT) + T.NT) % T.NT;
    return T.out[r * T.NT + c];
  };
  // A MASS of hair hung around the head axis — the M&M way: one solid volume with
  // big locks, not a cap with a curtain stuck on. Each column (an angle round the head)
  // runs from the crown pole over the skull (rays from the skull's centre: a dome), then
  // falls straight down over whatever it meets (ears, jaw, shoulders: the cumulative max
  // of the surface above) to its own end. Thickness comes from `vol`; locks are a broad
  // carved wave with fine strands in it, and the lock ridges hang lowest, so the ends
  // come to points. The free edge is turned back toward the head: a mass, not a sheet.
  const skullC = new THREE.Vector3(hx, eye.y + 0.03, hz);
  const headPts = headIdx.filter(i => !isEar(i));
  // the skull's surface along a ray from its centre, also as a table: max distance per
  // (azimuth, polar) bin, max-filtered to the ~10° cone the search used
  const rayT = (() => {
    const NA = 120, NP = 50, raw = new Float32Array(NA * NP);
    for (const i of headPts){
      const vx = B.pos[i*3] - skullC.x, vy = by(i) - skullC.y, vz = B.pos[i*3+2] - skullC.z, L = Math.hypot(vx, vy, vz);
      if (L < 1e-6) continue;
      const pol = Math.acos(Math.max(-1, Math.min(1, vy / L))), az = Math.atan2(vx, vz);
      const pr = Math.min(NP - 1, Math.floor(pol / Math.PI * NP)), ac = ((Math.floor((az + Math.PI) / (2 * Math.PI) * NA) % NA) + NA) % NA;
      if (L > raw[pr * NA + ac]) raw[pr * NA + ac] = L;
    }
    const out = new Float32Array(NA * NP), w = 3;
    for (let pr = 0; pr < NP; pr++) for (let ac = 0; ac < NA; ac++){
      let m = 0; const ka = pr < 6 ? NA / 2 : w;              // near the pole every azimuth is close
      for (let dp = -w; dp <= w; dp++){ const q = pr + dp; if (q < 0 || q >= NP) continue;
        for (let da = -ka; da <= ka; da++) m = Math.max(m, raw[q * NA + ((ac + da) % NA + NA) % NA]); }
      out[pr * NA + ac] = m;
    }
    return { NA, NP, out };
  })();
  const rayDist = (d) => {
    const pol = Math.acos(Math.max(-1, Math.min(1, d.y))), az = Math.atan2(d.x, d.z);
    const pr = Math.min(rayT.NP - 1, Math.floor(pol / Math.PI * rayT.NP)), ac = ((Math.floor((az + Math.PI) / (2 * Math.PI) * rayT.NA) % rayT.NA) + rayT.NA) % rayT.NA;
    return rayT.out[pr * rayT.NA + ac];
  };
  // gather (long hair): below the neck, side columns turn round toward the back, so the
  // hair settles BEHIND the shoulders instead of tenting out over them (it flared weirdly).
  const mass = ({ ths, closed, top = null, end, vol, nv = 22, locks = 9, lockAmp = 0.006, jag = 0.03, rest = null, gather = 0 }) => {
    const nu = ths.length, cols = [];
    for (let u = 0; u < nu; u++){
      const th = ths[u], lockW = crease(th * locks + Math.sin(th * 3) * 0.8);   // 1 on a lock, 0 between
      const yEnd = end(th) - (typeof jag === 'function' ? jag(th) : jag) * lockW;
      const path = [];                                            // [x, y, z, v(0..1 along), surface radius]
      if (top === null){                                          // dome from the crown pole
        for (let k = 0; k <= 24; k++){
          const ph = (k / 24) * Math.PI / 2, d = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
          const R = rayDist(d) || 0.09, q = skullC.clone().addScaledVector(d, R);
          if (q.y < yEnd) break;
          path.push([q.x, q.y, q.z, Math.hypot(q.x - hx, q.z - hz)]);
        }
      }
      let y = top === null ? (path.length ? path[path.length - 1][1] : skullC.y) : top(th);
      let run = path.length ? path[path.length - 1][3] : 0;
      for (y -= 0.008; y > yEnd; y -= 0.008){                    // the fall
        const g = gather * smooth(mouthY, neck.y - 0.04, y);      // turn behind before reaching the shoulders
        const tg = th + ((th >= 0 ? Math.PI : -Math.PI) - th) * g * smooth(0.6, 1.2, Math.abs(th));
        run = gather ? Math.max(run * (1 - 0.5 * g), surfAt(tg, y, rest)) : Math.max(run, surfAt(th, y, rest));
        path.push([hx + Math.sin(tg) * run, y, hz + Math.cos(tg) * run, run]);
      }
      if (path.length < 2){ const R = run || 0.08; path.push([hx + Math.sin(th) * R, yEnd + 0.01, hz + Math.cos(th) * R, R], [hx + Math.sin(th) * R, yEnd, hz + Math.cos(th) * R, R]); }
      const len = [0]; for (let k = 1; k < path.length; k++) len.push(len[k-1] + Math.hypot(path[k][0] - path[k-1][0], path[k][1] - path[k-1][1], path[k][2] - path[k-1][2]));
      cols.push({ th, path, len, lockW });
    }
    const pos = [], col = [];
    const N = nv + 1;                                             // + the turned-back rim
    for (let r = 0; r < N; r++) for (let u = 0; u < nu; u++){
      const { th, path, len, lockW } = cols[u], L = len[len.length - 1];
      const f = Math.min(1, r / (nv - 1)), sTarget = f * L;
      let k = 1; while (k < len.length - 1 && len[k] < sTarget) k++;
      const t = (sTarget - len[k-1]) / Math.max(1e-6, len[k] - len[k-1]);
      const P = path[k-1].map((v, j) => v + (path[k][j] - v) * t);
      // outward = away from the skull centre on the dome, away from the axis in the fall
      const onDome = top === null && P[1] > skullC.y;
      const o = onDome ? new THREE.Vector3(P[0] - skullC.x, P[1] - skullC.y, P[2] - skullC.z).normalize()
                       : new THREE.Vector3(Math.sin(th), 0, Math.cos(th));
      const fine = crease(th * 48 + f * 6);
      let m = vol(th, f) * (1 + 0.35 * (lockW - 0.5)) + lockAmp * (2 * lockW - 1) + 0.0015 * (2 * fine - 1);
      if (r === N - 1) m = -0.004;                                // rim: back toward the head
      m *= 1 - 0.55 * smooth(0.82, 1, f) * (r === N - 1 ? 0 : 1); // lock tips thin out
      pos.push(P[0] + o.x * m, P[1] + o.y * m, P[2] + o.z * m);
      const a = r === N - 1 ? 0.35 : (1 - 0.45 * (1 - lockW)) * (1 - 0.25 * (1 - fine)) * (1 - 0.25 * smooth(0.85, 1, f));
      col.push(a, a, a);
    }
    return gridGeo(pos, col, nu, N, closed, restPool);
  };
  const restPool = (() => { const ids = restOn; return { n: ids.length,
    p: Float32Array.from(ids.flatMap(i => [B.pos[i*3], by(i), B.pos[i*3+2]])),
    si: Uint16Array.from(ids.flatMap(i => [...B.si.slice(i*4, i*4+4)])), sw: Float32Array.from(ids.flatMap(i => [...B.sw.slice(i*4, i*4+4)])) }; })();
  const around = n => Array.from({ length: n }, (_, u) => -Math.PI + 2 * Math.PI * u / n);
  const span = (a, b, n) => Array.from({ length: n }, (_, u) => a + (b - a) * u / (n - 1));

  // -- hair: crop is a close shell; every other style is one mass
  let hair = null;
  const hairGeos = [];
  if (look.hair === 'crop'){
    hair = shell(B, i => inHead[i] && !isEar(i) && by(i) > hairline(thOf(B.pos[i*3], B.pos[i*3+2])), { cx: hx, cz: hz,
      gap: () => 0.003, bridge: () => 0.01, iters: 16, thick: 0.004, ao: 0.5,
      fold: c => { const w = crease(c.th * 38 + 3 * Math.sin(c.y * 40)); return [0.0012 * (2 * w - 1), 1 - w]; } });
    hairGeos.push(hair.geo);
  } else if (look.hair !== 'bald'){
    const st = look.hair, faceA = 0.95;                           // |th| below this is the face
    const front = th => hairline(th) + 0.01 * Math.max(0, Math.cos(th));   // keep the edge off the brows
    const len = { short: front, bun: front,
      bob: th => { const a = Math.abs(th); return a < faceA ? front(th) : front(th) + (mouthY - 0.03 - front(th)) * smooth(faceA, 1.35, a); },
      long: th => { const a = Math.abs(th); return a < faceA ? front(th) : front(th) + (neck.y - 0.15 - front(th)) * smooth(faceA, 1.5, a); } }[st];
    const vol = { short: (th, f) => 0.016 - 0.006 * f, bun: (th, f) => 0.012 - 0.004 * f,
      bob: (th, f) => 0.02 + 0.006 * smooth(0.3, 0.8, f), long: (th, f) => 0.02 - 0.006 * smooth(0.4, 1, f) }[st];
    hairGeos.push(mass({ ths: around(56), closed: true, end: len, vol, nv: st === 'long' ? 30 : 20,
      locks: st === 'long' ? 9 : 11, lockAmp: st === 'short' || st === 'bun' ? 0.004 : 0.007,
      // lock tips at the sides and back; a clean hairline over the face
      jag: th => (st === 'long' ? 0.035 : st === 'bob' ? 0.02 : 0.008) * (0.15 + 0.85 * smooth(0.9, 1.4, Math.abs(th))), rest: top,
      gather: st === 'long' ? 0.9 : 0 }));
    if (st === 'bun'){
      const bc = new THREE.Vector3(hx, eye.y + 0.07, zBack - 0.04), bun = new THREE.SphereGeometry(0.045, 18, 14);
      const bp = bun.attributes.position, bcol = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++){ const w = crease(Math.atan2(bp.getY(i), bp.getX(i)) * 5 + bp.getZ(i) * 50); const a = 1 - 0.45 * (1 - w); bcol.set([a, a, a], i * 3); }
      bun.setAttribute('color', new THREE.BufferAttribute(bcol, 3)); bun.translate(bc.x, bc.y, bc.z);
      hairGeos.push(rigid(bun.toNonIndexed(), headSkin));
    }
  }
  if (hairGeos.length){
    for (const g of hairGeos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    add(mergeGeometries(hairGeos.map(g => g.index ? g.toNonIndexed() : g)), M.hair(C.hair), 'hair');
  }
  lap('hair');

  // -- beard: a mass from the jaw. Columns sweep across the face; each starts below the
  // lip at the front, beside the mouth on the cheeks, at the sideburn by the ear, and
  // falls from there (so under the chin it hangs forward of the neck, as a beard does).
  if (look.beard !== 'none'){
    const st = look.beard, tb = 1.7;
    const top = th => { const a = Math.abs(th);
      return a < 0.45 ? mouthY - 0.013 : a < 0.8 ? (mouthY - 0.013) + (noseY - 0.008 - mouthY + 0.013) * smooth(0.45, 0.8, a)
        : (noseY - 0.008) + (eye.y - 0.01 - noseY + 0.008) * smooth(0.8, 1.2, a); };
    const end = th => { const a = Math.abs(th) / tb;
      const front = st === 'short' ? chinY - 0.006 : st === 'full' ? chinY - 0.045 : chinY - 0.19;
      const sideY = mouthY - (st === 'short' ? 0.012 : 0.03);
      return st === 'long' ? sideY + (front - sideY) * Math.cos(Math.min(1, a) * Math.PI / 2) ** 1.3
                           : sideY + (front - sideY) * (1 - smooth(0.35, 1, a)); };
    const vmax = { short: 0.006, full: 0.026, long: 0.032 }[st];
    const vol = (th, f) => vmax * (0.35 + 0.65 * smooth(0, 0.45, f)) * (1 - smooth(0.55, 1, Math.abs(th) / tb) * 0.9);   // thins to nothing at the sideburn
    const g = mass({ ths: span(-tb, tb, 46), closed: false, top, end, vol, nv: st === 'long' ? 26 : 16,
      locks: 7, lockAmp: st === 'short' ? 0.0015 : 0.005, jag: st === 'short' ? 0.004 : st === 'full' ? 0.018 : 0.035 });
    add(g, M.hair(C.hair), 'beard');
  }

  // -- moustache: thin is cut from the lip; walrus and handlebar are lofted tubes laid on it
  if (look.mustache === 'thin'){
    const mus = shell(B, i => { if (!inHead[i]) return false; const x = Math.abs(B.pos[i*3] - hx), y = by(i);
      return B.pos[i*3+2] > eye.z && y > mouthY + 0.002 && y < noseY - 0.002 && x < 0.028; },
      { cx: hx, cz: hz, gap: () => 0.0035, bridge: () => 0.004, iters: 8, thick: 0.003, ao: 0.5,
        fold: c => { const w = crease(c.th * 60); return [0.001 * (2 * w - 1), 1 - w]; } });
    add(mus.geo, M.hair(C.hair), 'mustache');
  } else if (look.mustache !== 'none'){
    const walrus = look.mustache === 'walrus', K = 40, R = 10, w = walrus ? 0.046 : 0.056;
    const baseY = (mouthY + noseY) / 2 - 0.001;
    const frontZ = (x, y) => { let z = eye.z; for (const i of headIdx) if (Math.abs(B.pos[i*3] - x) < 0.006 && Math.abs(by(i) - y) < 0.006) z = Math.max(z, B.pos[i*3+2]); return z; };
    const C0 = [];
    for (let k = 0; k < K; k++){
      const t = k / (K - 1) * 2 - 1, a = Math.abs(t), x = hx + t * w;
      let y = baseY, rr = walrus ? 0.012 * (1 - 0.35 * a * a) : 0.0085 * (1 - 0.75 * a);
      if (walrus) y -= 0.034 * smooth(0.45, 1, a) ** 1.3;            // droops past the mouth corners
      else y += 0.022 * smooth(0.55, 1, a) ** 2;                      // handlebar: ends turn up
      const zs = frontZ(Math.min(Math.max(x, hx - 0.045), hx + 0.045), Math.max(y, mouthY - 0.02));
      const z = zs + rr * 0.55 - (a > 0.7 && !walrus ? 0.004 * (a - 0.7) / 0.3 : 0);
      C0.push([new THREE.Vector3(x, y, z), rr]);
    }
    const pos = [], col = [];
    for (let k = 0; k < K; k++){
      const [c, rr] = C0[k], T = C0[Math.min(K - 1, k + 1)][0].clone().sub(C0[Math.max(0, k - 1)][0]).normalize();
      const N1 = new THREE.Vector3(0, 0, 1).sub(T.clone().multiplyScalar(T.z)).normalize(), N2 = T.clone().cross(N1);
      for (let r = 0; r < R; r++){
        const ph = 2 * Math.PI * r / R, wv = crease(ph * 3 + k * 0.4), m = rr * (1 + 0.18 * (wv - 0.5));
        const q = c.clone().addScaledVector(N1, Math.cos(ph) * m * 0.7).addScaledVector(N2, Math.sin(ph) * m);
        pos.push(q.x, q.y, q.z); const aa = 1 - 0.4 * (1 - wv); col.push(aa, aa, aa);
      }
    }
    const g = gridGeo(pos, col, R, K, true, () => headSkin);       // rings are the "columns" here
    add(g, M.hair(C.hair), 'mustache');
  }
  lap('beard');

  // -- cap: a soft felt cap, rigid to the head, sitting on the hair
  if (look.hat === 'cap'){
    const bandY = eye.y + 0.072;                                 // on the brow of the skull, clear of the eyes
    let erx = skullW + 0.006, ezf = zFront, ezb = zBack;
    const meas = (x, y, z) => { if (Math.abs(y - bandY) > 0.012) return; erx = Math.max(erx, Math.abs(x - hx) + 0.006); ezf = Math.max(ezf, z + 0.006); ezb = Math.min(ezb, z - 0.006); };
    for (const i of headIdx) if (!isEar(i)) meas(B.pos[i*3], by(i), B.pos[i*3+2]);
    for (const g of hairGeos){ const hp = g.attributes.position; for (let i = 0; i < hp.count; i++) meas(hp.getX(i), hp.getY(i), hp.getZ(i)); }
    const ecz = (ezf + ezb) / 2, erz = (ezf - ezb) / 2;
    const tilt = th => (Math.cos(th) < 0 ? -0.02 * -Math.cos(th) : 0);      // a cap sits lower at the back
    const lathe = (profile, nu = 40) => {
      const pos = [], col = [];
      for (const [k, y, a] of profile) for (let u = 0; u < nu; u++){ const th = 2 * Math.PI * u / nu;
        pos.push(hx + Math.sin(th) * erx * k, y + tilt(th), ecz + Math.cos(th) * erz * k); col.push(a, a, a); }
      return gridGeo(pos, col, nu, profile.length, true, () => headSkin);
    };
    let capTop = topY; for (const g of hairGeos){ const hp = g.attributes.position; for (let i = 0; i < hp.count; i++) capTop = Math.max(capTop, hp.getY(i)); }
    const prof = []; for (let k = 0; k <= 10; k++){ const t = k / 10;
      prof.push([(1 + 0.16 * Math.sin(Math.PI * t * 0.9)) * Math.cos(t * Math.PI / 2) ** 0.55 + 0.001, bandY + (capTop + 0.03 - bandY) * Math.sin(t * Math.PI / 2), 1 - 0.25 * bump(t, 0.15, 0.1)]); }
    add(lathe(prof), M.cloth(C.hat, kinMap('hat', C.hat)), 'hat');
    add(lathe([[1.02, bandY - 0.004, 0.8], [1.04, bandY + 0.008, 1], [1.02, bandY + 0.02, 0.8]]), M.leather(C.belt), 'hatband');
  }
  lap('hat');

  // -- jewellery: hoop earrings; a chain round the neck dipping to a gem
  const jw = look.jewels || 'none';
  if (jw === 'earrings' || jw === 'both'){
    const pieces = [];
    for (const side of [1, -1]){
      let mx = 0; for (const i of headIdx) mx = Math.max(mx, side * B.pos[i*3]);
      let lobe = null;
      for (const i of headIdx){ const x = side * B.pos[i*3]; if (x > mx - 0.012 && (!lobe || by(i) < lobe.y)) lobe = vecOf(i); }
      if (!lobe) continue;
      pieces.push(rigid(new THREE.TorusGeometry(0.015, 0.0022, 6, 22).rotateY(Math.PI / 2).translate(lobe.x - side * 0.002, lobe.y - 0.013, lobe.z).toNonIndexed(), nearestSkin(bodyPool, lobe.x, lobe.y, lobe.z)));
    }
    if (pieces.length) add(mergeGeometries(pieces), M.metal(C.metal), 'earrings');
  }
  if (jw === 'necklace' || jw === 'both'){
    const surf = [];
    for (let i = 0; i < B.n; i++) if ((domFam(i) === 'torso' || (domFam(i) === 'head' && by(i) < neck.y + 0.04)) &&
        Math.abs(by(i) - neck.y) < 0.16) surf.push([B.pos[i*3], by(i), B.pos[i*3+2]]);
    for (const sh of [top, vest]) if (sh) for (let v = 0; v < sh.V; v++) if (Math.abs(sh.p[v*3+1] - neck.y) < 0.16 &&
        Math.abs(sh.p[v*3] - neck.x) < Math.abs(shL.x - neck.x)) surf.push([sh.p[v*3], sh.p[v*3+1], sh.p[v*3+2]]);
    // Width comes from the NECK (a hanging chain narrows into a V, it doesn't spread over
    // the shoulders); depth from the surface — frontmost at that (x, y) for the front run,
    // backmost for the back — so it lies on the throat, collarbones and chest.
    const K = 48, pts = [], nn = [];
    for (let i = 0; i < B.n; i++) if (domFam(i) === 'head' && Math.abs(by(i) - neck.y) < 0.025) nn.push(Math.abs(B.pos[i*3] - neck.x));
    nn.sort((a, b) => a - b); const neckR = nn.length ? nn[Math.floor(nn.length * 0.9)] : 0.055;
    for (let k = 0; k < K; k++){
      const a = 2 * Math.PI * k / K, ca = Math.cos(a), front = ca > 0;
      const y = neck.y - 0.02 - 0.11 * Math.max(0, ca) ** 1.4;
      const x = neck.x + Math.sin(a) * (neckR + 0.012) * (1 - 0.35 * Math.max(0, ca) ** 2);
      let z = neck.z + ca * (neckR + 0.01), hit = false;
      for (const [px, py, pz] of surf){
        if (Math.abs(px - x) > 0.012 || Math.abs(py - y) > 0.012) continue;
        if (front ? (!hit || pz > z) && pz > neck.z : (!hit || pz < z) && pz < neck.z){ z = pz; hit = true; }
      }
      pts.push(new THREE.Vector3(x, y, z + (front ? 0.004 : -0.004)));
    }
    for (let it = 0; it < 3; it++){ const q = pts.map((p, k) => p.clone().add(pts[(k+1)%K]).add(pts[(k+K-1)%K]).multiplyScalar(1/3)); pts.splice(0, K, ...q); }
    const chain = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.0023, 6, true);
    const pool = top ? poolOf({ n: top.V, p: top.p, si: top.si, sw: top.sw }) : bodyPool;
    const cp = chain.attributes.position, cn = cp.count, csi = new Uint16Array(cn * 4), csw = new Float32Array(cn * 4);
    for (let i = 0; i < cn; i++) nearestSkin(pool, cp.getX(i), cp.getY(i), cp.getZ(i)).forEach(([j, w], k) => { csi[i*4+k] = j; csw[i*4+k] = w; });
    chain.setAttribute('skinIndex', new THREE.BufferAttribute(csi, 4)); chain.setAttribute('skinWeight', new THREE.BufferAttribute(csw, 4));
    chain.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cn * 3).fill(1), 3));
    add(chain, M.metal(C.metal), 'necklace');
    const low = pts.reduce((a, b) => (b.y < a.y ? b : a)), sk = nearestSkin(pool, low.x, low.y, low.z);
    add(rigid(new THREE.TorusGeometry(0.013, 0.003, 6, 20).translate(low.x, low.y - 0.016, low.z + 0.005).toNonIndexed(), sk), M.metal(C.metal), 'pendant');
    add(rigid(new THREE.SphereGeometry(0.0105, 12, 10).scale(1, 1.25, 0.6).translate(low.x, low.y - 0.016, low.z + 0.006).toNonIndexed(), sk), M.gem(C.gem), 'gem');
  }
  lap('jewels');

  const group = new THREE.Group(); group.name = 'outfit';
  for (const m of parts) group.add(m);
  return { group, parts, materials: mats, skirt,
    info: { beltY, bootTop, ankleY, H, ms: { ...ms, total: Math.round(performance.now() - t0) } } };
}

// Put the outfit on: the parts share the body's skeleton and bind, as siblings.
export function wear(body, outfit){
  body.parent.add(outfit.group);
  outfit.group.position.copy(body.position); outfit.group.quaternion.copy(body.quaternion); outfit.group.scale.copy(body.scale);
  for (const m of outfit.parts) m.bind(body.skeleton, body.bindMatrix);
}
