// Places: the Lea carved into named regions — "Bramwick Wood", "the Sedmere
// Marshes", "Lake Mirren". Pure (no three.js), so node tools can list them.
//
// Habitats come in thousands of small patches, far too many to name, so a region
// is a coarser thing: the Lea is split into irregular cells ~250u across (seeded
// points on a jittered grid), and each cell is named for the habitat that covers
// most of it. Cell borders lean toward the terrain — a sample prefers a nearby
// cell whose kind matches its own habitat — so a marsh's name ends roughly where
// the marsh does. A few features are always their own region whatever the cells
// say: the great lake, its island, and each sizeable stand of old growth.
//
// Names are built from syllables (onset + vowel + coda, and a softer ending), so
// every seed gets its own map; the same seed always gets the same names.

import { SIZE, WATER, WORLD_SEED } from '../config.js';
import { mulberry32 } from '../rng.js';
import { height, habitat, GREAT_LAKE } from './land.js';

const CELL = 250;                 // region scale (u)
const STEP = 16;                  // sampling grid (u)
const HALF = SIZE / 2;
const N = Math.ceil(SIZE / STEP);

// ---- kinds ----------------------------------------------------------------------
// habitat → region kind. Beach is a thin rim, never a region in its own right.
const KIND_OF = { lake: 'lake', beach: null, marsh: 'marsh', fen: 'fen', carr: 'carr',
  wetmeadow: 'wetmeadow', meadow: 'meadow', woodland: 'wood', grove: 'grove', heath: 'heath', rock: 'rock' };

// name templates per kind: `t` is the name ({N} = the generated part), `at` how
// a speaker puts someone there ("in", "on", "by" …, used as `${at} ${name}`)
const TEMPLATES = {
  wood:      [{ t: '{N} Wood', at: 'in' }, { t: 'the {N} Woods', at: 'in' }, { t: '{N} Weald', at: 'in' }, { t: '{N} Forest', at: 'in' }],
  grove:     [{ t: '{N} Grove', at: 'in' }, { t: 'the Grove of {N}', at: 'in' }, { t: 'the {N} Pines', at: 'among' }],
  marsh:     [{ t: 'the {N} Marshes', at: 'out on' }, { t: '{N} Marsh', at: 'out on' }, { t: 'the {N} Reeds', at: 'down in' }],
  fen:       [{ t: '{N} Fen', at: 'out on' }, { t: 'the {N} Fens', at: 'out on' }, { t: '{N} Moss', at: 'out on' }],
  carr:      [{ t: '{N} Carr', at: 'in' }, { t: 'the {N} Alders', at: 'among' }, { t: '{N} Wetwood', at: 'in' }],
  wetmeadow: [{ t: '{N} Ings', at: 'on' }, { t: 'the {N} Water-meadows', at: 'on' }, { t: '{N} Mead', at: 'on' }],
  meadow:    [{ t: '{N} Meadows', at: 'on' }, { t: 'the Lees of {N}', at: 'on' }, { t: '{N} Field', at: 'on' }, { t: '{N} Green', at: 'on' }],
  heath:     [{ t: '{N} Heath', at: 'up on' }, { t: '{N} Moor', at: 'up on' }, { t: 'the {N} Downs', at: 'up on' }],
  rock:      [{ t: 'the {N} Crags', at: 'up among' }, { t: '{N} Tor', at: 'up on' }, { t: 'the Crags of {N}', at: 'up among' }, { t: '{N} Scar', at: 'up on' }],
  lake:      [{ t: 'Lake {N}', at: 'by' }, { t: '{N} Mere', at: 'by' }, { t: '{N} Water', at: 'by' }],
  greatlake: [{ t: 'Lake {N}', at: 'out on' }, { t: 'the {N} Water', at: 'out on' }],
  island:    [{ t: 'the Isle of {N}', at: 'on' }, { t: '{N} Isle', at: 'on' }, { t: '{N} Holm', at: 'on' }],
};

// ---- syllables ----------------------------------------------------------------
// An English-countryside sound, with no real place names. A word is a stressed
// syllable (onset + vowel + coda) and usually an ending. The coda is chosen to
// suit what follows it — a soft one before a consonant ending ("Wenley"), a
// firmer one before a vowel ending ("Tarrow") or with no ending at all ("Brack").
const ONSET = ['b', 'br', 'c', 'cr', 'd', 'dr', 'f', 'fl', 'g', 'gr', 'h', 'l', 'm', 'n', 'p', 'r', 's', 'sh',
  'st', 't', 'th', 'tr', 'w', 'wr', '', ''];
const VOWEL = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'i', 'ea', 'ai'];
const ENDING_C = ['ley', 'wyn', 'mere', 'ston', 'wick', 'by', 'well', 'ham', 'dale', 'cot', 'ford', 'wood', 'thorn',
  'more', 'stead', 'combe', 'den', 'ridge', 'holt', 'brook', 'ton', 'field'];
const ENDING_V = ['en', 'ow', 'el', 'ar', 'ith', 'an', 'ing', 'in', 'ock', 'ey', 'ell', 'om', 'er', 'ick'];
const CODA_C = ['', '', 'l', 'n', 'r', 's', 'm', 'rn', 'l', 'n'];          // before a consonant ending
const CODA_V = ['d', 'l', 'll', 'm', 'n', 'r', 'rr', 's', 't', 'th', 'v', 'nd', 'rd', 'st', 'ck', 'nn', 'tt'];
const CODA_END = ['ck', 'ld', 'll', 'nd', 'rn', 'rk', 'rth', 'sk', 'st', 'th', 'm', 'n', 'ft', 'rne', 'le'];
// syllables recombine freely, so they can spell what no one wants on a map
// ("Fuck Scar" came up on the first big-map render). Anything containing one of
// these is re-rolled; it errs broad, since a lost name costs nothing.
const RUDE = /fuc|fuk|shit|cunt|cock|dick|piss|slut|twat|wank|arse|tit|fag|nig|rape|cum|porn|poo|butt|boob|sex|bitch|bum|crap|turd|knob|prick|puss|homo|jizz|spunk|tard|anus|anal|semen|nazi|kkk|hitl|dam|hell|ass|tard|wop|spic|kike|coon|gook|dyke|whor|hoe|nob|scat|crack|dong|wee|pee/i;
function makeWord(r){
  const pick = a => a[(r() * a.length) | 0];
  for (let tries = 0; tries < 40; tries++){
    const on = pick(ONSET), v = on ? pick(VOWEL) : pick(['a', 'e', 'o', 'a']);
    const roll = r();
    let w;
    if (roll < 0.15) w = on + v + pick(CODA_END);
    else if (roll < 0.6){ const c = pick(CODA_C); w = on + v + c + pick(ENDING_C.filter(e => !c || e[0] !== c)); }
    else w = on + v + pick(CODA_V) + pick(ENDING_V);
    if (!on && w.length < 5) continue;                  // "Ard Wood" is too thin
    if (w.length < 4 || w.length > 10) continue;
    if (/(.)\1\1/.test(w)) continue;
    if (RUDE.test(w)) continue;
    return w[0].toUpperCase() + w.slice(1);
  }
  return 'Brook';
}

// ---- build ----------------------------------------------------------------------
let REG = null, GRID = null;

function build(){
  const r = mulberry32((WORLD_SEED ^ 0x9a1e5) >>> 0);
  // seeds: one per cell, jittered inside it
  const CN = Math.max(2, Math.round(SIZE / CELL)), cw = SIZE / CN;
  const seeds = [];
  for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++)
    seeds.push({ x: -HALF + (i + 0.2 + r() * 0.6) * cw, z: -HALF + (j + 0.2 + r() * 0.6) * cw, i, j });
  // sample habitat on the grid
  const hab = new Array(N * N), kind = new Array(N * N);
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++){
    const x = -HALF + (gx + 0.5) * STEP, z = -HALF + (gz + 0.5) * STEP, k = gz * N + gx;
    hab[k] = habitat(x, z, height(x, z)); kind[k] = KIND_OF[hab[k]];
  }
  // the 3×3 nearby seeds of a sample (seeds are one per cell, so the nearest is among them)
  const near = (x, z) => {
    const ci = Math.floor((x + HALF) / cw), cj = Math.floor((z + HALF) / cw), out = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < CN && j < CN) out.push(j * CN + i);
    }
    return out;
  };
  // pass 1: plain Voronoi → each cell's dominant kind
  const owner = new Int32Array(N * N);
  const vote = seeds.map(() => ({}));
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++){
    const x = -HALF + (gx + 0.5) * STEP, z = -HALF + (gz + 0.5) * STEP, k = gz * N + gx;
    let best = -1, bd = Infinity;
    for (const s of near(x, z)){ const d = (seeds[s].x - x) ** 2 + (seeds[s].z - z) ** 2; if (d < bd){ bd = d; best = s; } }
    owner[k] = best;
    if (kind[k]) vote[best][kind[k]] = (vote[best][kind[k]] || 0) + 1;
  }
  const dom = vote.map(v => Object.entries(v).sort((a, b) => b[1] - a[1])[0]?.[0] || 'meadow');
  // pass 2: borders lean toward the terrain — a matching cell counts as nearer
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++){
    const x = -HALF + (gx + 0.5) * STEP, z = -HALF + (gz + 0.5) * STEP, k = gz * N + gx;
    let best = -1, bd = Infinity;
    for (const s of near(x, z)){
      let d = Math.hypot(seeds[s].x - x, seeds[s].z - z);
      if (kind[k] && dom[s] === kind[k]) d *= 0.7;
      if (d < bd){ bd = d; best = s; }
    }
    owner[k] = best;
  }
  // regions: one per cell, then the special features carved out of them
  const regions = seeds.map((s, i) => ({ id: i, kind: dom[i] }));
  const L = GREAT_LAKE;
  const lakeId = regions.length; regions.push({ id: lakeId, kind: 'greatlake' });
  const isleId = regions.length; regions.push({ id: isleId, kind: 'island' });
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++){
    const x = -HALF + (gx + 0.5) * STEP, z = -HALF + (gz + 0.5) * STEP, k = gz * N + gx;
    if (Math.hypot(x - L.ix, z - L.iz) < L.IR * 1.6 && hab[k] !== 'lake') owner[k] = isleId;
    else if (Math.hypot(x - L.cx, z - L.cz) < L.R * 1.25 && (hab[k] === 'lake' || hab[k] === 'marsh' || hab[k] === 'beach')) owner[k] = lakeId;
  }
  // old-growth stands big enough to find get their own name (flood fill)
  const seen = new Uint8Array(N * N);
  for (let k0 = 0; k0 < N * N; k0++){
    if (seen[k0] || hab[k0] !== 'grove' || owner[k0] === isleId) continue;
    const cells = [k0], st = [k0]; seen[k0] = 1;
    while (st.length){
      const k = st.pop(), gx = k % N, gz = (k / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const q = nz * N + nx;
        if (!seen[q] && hab[q] === 'grove'){ seen[q] = 1; st.push(q); cells.push(q); }
      }
    }
    if (cells.length < 40) continue;                 // ~100u square: smaller stands stay part of their wood
    const id = regions.length; regions.push({ id, kind: 'grove' });
    for (const k of cells) owner[k] = id;
  }
  // tally each region: area, centroid
  for (const g of regions){ g.n = 0; g.sx = 0; g.sz = 0; }
  for (let k = 0; k < N * N; k++){
    const g = regions[owner[k]];
    g.n++; g.sx += -HALF + (k % N + 0.5) * STEP; g.sz += -HALF + (((k / N) | 0) + 0.5) * STEP;
  }
  // a cell left with only scraps (its land taken by the lake or a grove) folds
  // into whichever neighbour surrounds it most
  for (const g of regions) if (g.n > 0 && g.n < 30 && g.id < lakeId){
    const count = {};
    for (let k = 0; k < N * N; k++){
      if (owner[k] !== g.id) continue;
      const gx = k % N, gz = (k / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const o = owner[nz * N + nx]; if (o !== g.id) count[o] = (count[o] || 0) + 1;
      }
    }
    const to = +(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
    if (to < 0) continue;
    const t = regions[to];
    for (let k = 0; k < N * N; k++) if (owner[k] === g.id) owner[k] = to;
    t.n += g.n; t.sx += g.sx; t.sz += g.sz; g.n = 0;
  }
  // label point: the region's own sample nearest its centroid (centroids of
  // crescent-shaped regions can fall outside them)
  for (const g of regions){
    if (!g.n) continue;
    const cx = g.sx / g.n, cz = g.sz / g.n;
    let bd = Infinity;
    for (let k = 0; k < N * N; k++){
      if (owner[k] !== g.id) continue;
      const x = -HALF + (k % N + 0.5) * STEP, z = -HALF + (((k / N) | 0) + 0.5) * STEP, d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < bd){ bd = d; g.x = x; g.z = z; }
    }
    g.area = g.n * STEP * STEP;
  }
  // names: unique generated part, and a template drawn per region
  const used = new Set();
  for (const g of regions){
    if (!g.n) continue;
    const tl = TEMPLATES[g.kind] || TEMPLATES.meadow;
    // "Forest" and the big plural names are kept for the larger regions
    const choices = g.area < CELL * CELL * 0.5 ? tl.filter(t => !/Forest|the .*s$/.test(t.t)) : tl;
    const t = (choices.length ? choices : tl)[(r() * (choices.length || tl.length)) | 0];
    // no doubled stems: "Hinwood Woods", "Wrunmere Mere"
    const nouns = t.t.replace('{N}', '').toLowerCase().match(/[a-z]{4,}/g) || [];
    let w; do w = makeWord(r); while (used.has(w) || nouns.some(n => w.toLowerCase().includes(n.slice(0, 4))));
    used.add(w);
    g.word = w; g.name = t.t.replace('{N}', w); g.at = t.at;
  }
  GRID = owner;
  REG = regions.filter(g => g.n > 0);
  for (const g of REG) delete g.sx, delete g.sz;
  // neighbours: regions that share a border, by length of the shared edge
  const byId = new Map(REG.map(g => [g.id, g]));
  const edge = new Map(REG.map(g => [g.id, {}]));
  for (let gz = 0; gz < N; gz++) for (let gx = 0; gx < N; gx++){
    const a = owner[gz * N + gx];
    for (const [dx, dz] of [[1, 0], [0, 1]]){
      const nx = gx + dx, nz = gz + dz; if (nx >= N || nz >= N) continue;
      const b = owner[nz * N + nx]; if (a === b) continue;
      edge.get(a)[b] = (edge.get(a)[b] || 0) + 1; edge.get(b)[a] = (edge.get(b)[a] || 0) + 1;
    }
  }
  for (const g of REG) g.neighbours = Object.entries(edge.get(g.id)).sort((p, q) => q[1] - p[1]).map(([id]) => byId.get(+id));
}

// every region: { id, kind, name, word, at, x, z (label point), area, neighbours }
export function places(){ if (!REG) build(); return REG; }

// the region at a point
export function placeAt(x, z){
  if (!REG) build();
  const gx = Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / STEP)));
  const gz = Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / STEP)));
  return _byId()[GRID[gz * N + gx]];
}
let _idx = null;
function _byId(){ if (!_idx){ _idx = []; for (const g of REG) _idx[g.id] = g; } return _idx; }

// "in Bramwick Wood", "out on the Sedmere Marshes", "by Lake Mirren"
export const placePhrase = g => `${g.at} ${g.name}`;
