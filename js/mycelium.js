// Mycelium — the wood's own news network, and the mirror of gossip.js.
//
// The folk have a fast, sighted, mobile, unreliable network above ground. This is
// the other one: slow, blind, immobile and literal. Trees cannot move, so they pay
// a fungus to carry what they cannot go and see. Same fact-store shape as
// gossip.js, different physics — diffusion over distance and TIME instead of
// exchange on encounter.
//
// What the model is faithful to (docs/mycelium.md has the sources):
//   - Two fungal GUILDS that barely interconnect: ectomycorrhizal (oak, birch,
//     redwood) and arbuscular (maple, rowan). A maple and an oak standing in each
//     other's shade are on different networks and hear different news.
//   - The link is a trade, not a wire. It runs on soil: rich damp ground carries,
//     dry sand and rock do not. So the network is patchy in exactly the way the
//     terrain is, which is the same rule ("form follows soil") the trees' own
//     shapes already obey.
//   - The fungus is a BROKER, not a mother. Karst, Jones & Cahill (2023) found no
//     evidence for trees preferentially feeding kin or warning their offspring, so
//     nothing here does that. A tree hears what it can pay for, and what it can pay
//     is set by its light and its water.
//   - Distance costs specificity, not just strength. A fact five hops away has lost
//     its place and kept only its mood — see hops/mag, and how wood-talk.js phrases
//     them.
//
// Pure simulation: no THREE, no DOM, no terrain import. Terrain is INJECTED as
// height()/soil() so this module runs headless under tools/check-mycelium.mjs.

// ---------------------------------------------------------------- guilds ----

// Real mycorrhizal types. Ectomycorrhizal fungi sheathe the root tip and are the
// mushroom-forming ones (boletes, amanitas, chanterelles); arbuscular fungi grow
// inside the root cells and fruit underground or not at all — which is why the
// visible rings in the world belong to the ecto wood.
const ECTO = new Set(['oak', 'birch', 'redwood', 'pine']);

export const GUILDS = ['ecto', 'arb'];

// species names arrive as 'oak-broad', 'maple-lean', 'redwood-tall' …
export const baseSpecies = name => String(name || '').split('-')[0].toLowerCase();
export const guildOf = name => (ECTO.has(baseSpecies(name)) ? 'ecto' : 'arb');

// Ecto networks run further — they build rhizomorphs, cords that carry over
// metres of soil. Arbuscular hyphae are finer and more local.
const LINK_R  = { ecto: 17, arb: 11 };
const DEGREE  = { ecto: 5,  arb: 4  };

// ---------------------------------------------------------------- signals ---

// What the wood can feel. Every one of these is something a plant genuinely
// senses: pressure and compaction, damage, heat, water. Nothing is sight.
// `rank` is worth over and above strength, and exists for the same reason
// gossip.js's NEWS_RANK does: tread is CHRONIC — it refreshes its own timestamp
// every hour for as long as anyone keeps walking there — so on freshness or
// strength alone it drowns out every actual event, and the whole wood ends up with
// nothing to say but "feet". Events outrank conditions.
export const SIGNALS = {
  tread:   { ttl: 4,  atten: 0.60, hops: 5, rank: 1, cap: 2 },  // feet on the roots; the ground goes hard
  wound:   { ttl: 3,  atten: 0.70, hops: 6, rank: 2, cap: 3 },  // a shrub cut, a branch torn — sharp and brief
  fire:    { ttl: 6,  atten: 0.66, hops: 6, rank: 3, cap: 3 },  // heat, then ash in the soil
  mast:    { ttl: 10, atten: 0.85, hops: 8, rank: 3, cap: 1 },  // the synchrony; travels far, fades slowly
  quicken: { ttl: 5,  atten: 0.72, hops: 6, rank: 2, cap: 2 },  // sudden richness — a carcass, a spill
};

const MIN_MAG   = 0.06;      // below this a signal is no longer worth carrying
const STEP_DAYS = 1 / 24;    // the network moves news about once an in-game hour

// -------------------------------------------------------------------- node --

// One tree. `news` is the same shape as an NPC's: a small Map keyed by fact key.
// The extra field over gossip.js is `at` — when the fact ARRIVED here, as against
// `t` when it happened. The gap between them is how a tree can say the ash reached
// it three lights after the burning.
class Node {
  constructor(id, { x, z, species, scale = 1, trunkR, trunkH }){
    this.id = id; this.x = x; this.z = z;
    this.species = species; this.base = baseSpecies(species);
    this.guild = guildOf(species);
    this.scale = scale;
    this.trunkR = trunkR; this.trunkH = trunkH;   // archetype trunk metrics (× scale = actual)
    this.links = [];            // [{ to: Node, w: 0..1 }]
    this.news = new Map();
    this.light = 1; this.water = 0; this.vigor = 0;
    this.hurt = 0;              // damage felt in its OWN body, not heard about
  }
  // How much it can afford to know. A shaded tree in poor ground carries two
  // facts; a well-lit one with its roots in wet bottomland carries eight. This is
  // the whole economy — the tree pays carbon for news, and its carbon is its light.
  get capacity(){ return 2 + Math.round(this.vigor * 6); }
  // How deep into the threads it is: the sum of what its links can carry.
  get reach(){ let s = 0; for (const l of this.links) s += l.w; return s; }
  get age(){ return this.scale; }               // rendered scale IS its age here
}

// ---------------------------------------------------------------- network ---

export class Mycelium {
  // trees: [{ x, z, species, scale }]
  // opts:  { rng, height(x,z), soil(x,z) }   — terrain injected, see header
  constructor(trees, { rng = Math.random, height = () => 0, soil = () => 0.5 } = {}){
    this.height = height; this.soil = soil;
    this.time = 0;
    this._stepAt = 0;
    this._seenDead = new WeakSet();   // shrub records already mourned
    this._treadCursor = 0;
    this._mastEra = -1;

    this.nodes = (trees || [])
      .filter(t => t && Number.isFinite(t.x) && Number.isFinite(t.z))
      .map((t, i) => new Node(i, t));

    this._hash = buildHash(this.nodes, 18);
    this._link();
    this._condition();
    this._chooseElders(rng);
  }

  // --- construction -------------------------------------------------------

  // Link within guild only, nearest-first, capped degree. The weight is the soil
  // between the two trees: hyphae bridge damp rich ground and die in dry sand, so
  // a link across a sandbar is worth almost nothing even when it is short.
  _link(){
    for (const n of this.nodes){
      const R = LINK_R[n.guild];
      const cand = [];
      for (const m of near(this._hash, n.x, n.z, R, 18)){
        if (m === n || m.guild !== n.guild) continue;
        const d = Math.hypot(m.x - n.x, m.z - n.z);
        if (d > R || d < 1e-6) continue;
        const w = this._linkWeight(n, m, d, R);
        if (w > 0.04) cand.push({ to: m, w, d });
      }
      cand.sort((a, b) => b.w - a.w);
      n.links = cand.slice(0, DEGREE[n.guild]).map(({ to, w }) => ({ to, w }));
    }
  }

  _linkWeight(n, m, d, R){
    // sample the ground along the link — the worst patch en route governs, the way
    // a dry ridge between two damp hollows cuts the cord
    let worst = 1;
    for (let k = 1; k <= 3; k++){
      const f = k / 4;
      const s = this.soil(n.x + (m.x - n.x) * f, n.z + (m.z - n.z) * f);
      if (s < worst) worst = s;
    }
    const prox = 1 - d / R;
    return clamp01(prox * worst * 1.25);
  }

  // Each tree's own standing: how much light it gets (crowding), how much water it
  // can reach, and the product of the two — its vigor, which is its purse.
  _condition(){
    for (const n of this.nodes){
      let crowd = 0;
      for (const m of near(this._hash, n.x, n.z, 9, 18)){
        if (m === n) continue;
        const d = Math.hypot(m.x - n.x, m.z - n.z);
        if (d < 9) crowd += (1 - d / 9) * (m.scale > n.scale ? 1 : 0.45);
      }
      n.light = clamp01(1 - crowd / 5.5);
      n.water = clamp01(this.soil(n.x, n.z));
      n.vigor = clamp01(n.light * 0.55 + n.water * 0.45) * clamp01(0.35 + n.scale * 0.5);
    }
  }

  // The elders: old, well-connected, and spread out, so they read as landmarks
  // rather than a thicket of talkers. Deliberately few — see docs/mycelium.md.
  _chooseElders(rng, want = 22, minGap = 26){
    const scored = this.nodes
      .map(n => ({ n, s: n.age * (0.6 + n.reach) * (0.4 + n.vigor) * (0.85 + rng() * 0.3) }))
      .sort((a, b) => b.s - a.s);
    const picked = [];
    for (const { n } of scored){
      if (picked.length >= want) break;
      if (picked.some(p => Math.hypot(p.x - n.x, p.z - n.z) < minGap)) continue;
      n.elder = true;
      picked.push(n);
    }
    this.elders = picked;
  }

  // --- sensing ------------------------------------------------------------

  // The wood is not notified of anything; it FEELS things. This observes the live
  // world each tick rather than having agents.js call in, which is both truer and
  // keeps the agent layer untouched.
  //
  // world: { trailWear(x,z)?, shrubs?, fires?, now }
  sense(world = {}){
    const now = this.time;

    // feet on the roots — sampled round-robin so a big wood costs nothing per frame
    if (typeof world.trailWear === 'function' && this.nodes.length){
      const BATCH = 40;
      for (let k = 0; k < BATCH; k++){
        const n = this.nodes[this._treadCursor++ % this.nodes.length];
        const wear = world.trailWear(n.x, n.z) || 0;
        if (wear > 0.22) this._inject(n, 'tread', 'tread:' + n.id, wear, now, n.x, n.z);
      }
    }

    // a shrub chopped for firewood: felt once, where it stood
    if (Array.isArray(world.shrubs)){
      for (const s of world.shrubs){
        if (s.alive !== false || this._seenDead.has(s)) continue;
        this._seenDead.add(s);
        const n = this.nearest(s.x, s.z, 22);
        if (n) this._inject(n, 'wound', 'wound:' + Math.round(s.x) + ',' + Math.round(s.z), 1, now, s.x, s.z);
      }
    }

    // hearths: heat while they burn, and the ash stays in the ground after
    if (Array.isArray(world.fires)){
      for (let i = 0; i < world.fires.length; i++){
        const f = world.fires[i];
        if (!f || !f.lit) continue;
        const n = this.nearest(f.x, f.z, 26);
        if (n) this._inject(n, 'fire', 'fire:' + i, 1, now, f.x, f.z);
      }
    }
  }

  // Mast: whole stands of one species fruiting at once, across distances no signal
  // could have crossed in time. Real, and still not fully explained — so here it is
  // seeded into every tree of the species SIMULTANEOUSLY rather than propagated,
  // and the fungus is left to take credit it has not earned.
  _maybeMast(){
    const era = Math.floor(this.time / 9);      // roughly seasonal
    if (era === this._mastEra) return;
    this._mastEra = era;
    if (era < 1) return;
    const kinds = [...new Set(this.nodes.map(n => n.base))];
    if (!kinds.length) return;
    const pick = kinds[Math.abs(hash32(era * 2654435761)) % kinds.length];
    if ((Math.abs(hash32(era ^ 0x9e37)) % 100) > 34) return;   // most seasons, no mast
    for (const n of this.nodes){
      if (n.base !== pick) continue;
      this._inject(n, 'mast', 'mast:' + pick + ':' + era, 1, this.time, n.x, n.z, pick);
    }
    this.lastMast = { species: pick, era, t: this.time };
  }

  _inject(node, kind, key, mag, t, x, z, what){
    if (!node) return;
    add(node, { kind, key, mag: clamp01(mag), t, at: t, hops: 0, x, z, what });
  }

  // Something happened AT a place and the nearest tree felt it. The public seam:
  // anything outside can hand the wood an event without knowing the graph.
  feel(x, z, kind, mag = 1, what){
    if (!SIGNALS[kind]) return null;
    const n = this.nearest(x, z, 30);
    if (!n) return null;
    this._inject(n, kind, kind + ':' + Math.round(x) + ',' + Math.round(z) + ':' + Math.round(this.time * 24), mag, this.time, x, z, what);
    return n;
  }

  // Damage to a tree's own body — it knows this one first-hand, not by report.
  hurt(x, z, amount = 1){
    const n = this.nearest(x, z, 3.5);
    if (n) n.hurt = clamp01(n.hurt + amount);
    return n;
  }

  // --- propagation --------------------------------------------------------

  update(dt, now){
    if (Number.isFinite(now)) this.time = now; else this.time += dt / 600;
    if (this.time - this._stepAt < STEP_DAYS) return;
    this._stepAt = this.time;
    this._maybeMast();
    this._spread();
    this._prune();
  }

  // One hop for everything, everywhere. Facts are collected before they are
  // delivered so a signal cannot race across the whole wood inside one step —
  // news moves at one link per hour, which is what makes distance mean anything.
  _spread(){
    const pending = [];
    for (const n of this.nodes){
      if (!n.news.size) continue;
      for (const f of n.news.values()){
        const sig = SIGNALS[f.kind];
        if (!sig || f.hops >= sig.hops) continue;
        for (const l of n.links){
          const mag = f.mag * sig.atten * l.w;
          if (mag < MIN_MAG) continue;
          pending.push([l.to, { ...f, mag, hops: f.hops + 1, at: this.time }]);
        }
      }
    }
    for (const [to, f] of pending) add(to, f);
  }

  _prune(){
    const now = this.time;
    for (const n of this.nodes){
      const m = n.news;
      for (const [k, f] of m){
        const sig = SIGNALS[f.kind];
        if (!sig || now - f.t > sig.ttl || f.mag < MIN_MAG) m.delete(k);
      }
      // a tree only needs to know the ground is trodden once; several tellings of
      // the same chronic thing are the same fact arriving by different roots
      const perKind = new Map();
      for (const f of [...m.values()].sort((a, b) => b.mag - a.mag)){
        const k = (perKind.get(f.kind) || 0) + 1;
        perKind.set(f.kind, k);
        if (k > (SIGNALS[f.kind].cap || 99)) m.delete(f.key);
      }
      const over = m.size - n.capacity;
      if (over > 0){
        // shed the cheapest first — conditions before events, faint before strong.
        // What a poor tree cannot pay for, it forgets.
        const worth = f => (SIGNALS[f.kind].rank || 1) + f.mag;
        const low = [...m.entries()].sort((a, b) => worth(a[1]) - worth(b[1]) || a[1].t - b[1].t);
        for (let i = 0; i < over; i++) m.delete(low[i][0]);
      }
      if (n.hurt > 0) n.hurt = Math.max(0, n.hurt - 0.06 * STEP_DAYS * 24);
    }
  }

  // --- queries ------------------------------------------------------------

  nearest(x, z, maxD = Infinity){
    let best = null, bd = maxD;
    for (const n of near(this._hash, x, z, Math.min(maxD, 40), 18)){
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd){ bd = d; best = n; }
    }
    return best;
  }

  // every tree within r of a point — the focus loop cone-tests only these, so all
  // trees can be talkable without walking the whole forest each frame
  nodesNear(x, z, r){
    const out = [];
    for (const n of near(this._hash, x, z, r, 18)){
      if (Math.hypot(n.x - x, n.z - z) <= r) out.push(n);
    }
    return out;
  }

  // Of a node's linked neighbours, the one that holds this same fact by a SHORTER
  // path (fewer hops) — i.e. stood nearer the source. This is what lets a tree
  // point the player up the network toward where a thing actually happened.
  nearerSource(node, fact){
    let best = null;
    for (const l of node.links){
      const f = l.to.news.get(fact.key);
      if (f && f.hops < fact.hops && (!best || f.hops < best.f.hops)) best = { node: l.to, f };
    }
    return best;
  }

  // what a node knows — events before conditions, then by strength
  heard(node){
    if (!node || !node.news) return [];
    const worth = f => (SIGNALS[f.kind].rank || 1) + f.mag;
    return [...node.news.values()].sort((a, b) => worth(b) - worth(a) || b.t - a.t);
  }

  // how strongly the network runs under a point — used to decide which mushroom
  // rings are worth a voice
  strengthAt(x, z){
    const n = this.nearest(x, z, 14);
    if (!n) return 0;
    return clamp01(n.reach / 3);
  }

  stats(){
    let links = 0, facts = 0, linked = 0;
    for (const n of this.nodes){ links += n.links.length; facts += n.news.size; if (n.links.length) linked++; }
    return { nodes: this.nodes.length, links: links / 2, linked, facts, elders: this.elders.length };
  }
}

// ------------------------------------------------------------------ utils ---

// A fact is always replaced WHOLE, never merged field-by-field. Each stored fact
// is one telling — when the thing happened (t), when word of it got here (at), and
// by how long a path (hops) — and those three only mean anything together.
// Merging them independently is what put `at` before `t` on repeating signals like
// tread, which refresh their own `t` every hour at the source.
function add(node, fact){
  const ex = node.news.get(fact.key);
  if (!ex){ node.news.set(fact.key, fact); return; }
  if (fact.t > ex.t) node.news.set(fact.key, fact);                          // a newer telling
  else if (fact.t === ex.t && fact.mag > ex.mag) node.news.set(fact.key, fact); // a shorter path
}

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

function hash32(n){
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) | 0;
}

function buildHash(nodes, cell){
  const g = new Map();
  for (const n of nodes){
    const k = Math.floor(n.x / cell) + ',' + Math.floor(n.z / cell);
    let a = g.get(k); if (!a){ a = []; g.set(k, a); }
    a.push(n);
  }
  return { g, cell };
}

function* near({ g, cell }, x, z, r, _cell){
  const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
  const span = Math.max(1, Math.ceil(r / cell));
  for (let gx = cx - span; gx <= cx + span; gx++)
    for (let gz = cz - span; gz <= cz + span; gz++){
      const a = g.get(gx + ',' + gz);
      if (a) yield* a;
    }
}
