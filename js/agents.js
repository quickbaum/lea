// Agent layer — NPC drives, the affordance ("smart object") substrate, and the
// first ritual (the campfire sitting-circle). Design: docs/npc-behavior.md.
//
// The core idea: behaviour lives in the WORLD, not in the agent's head. Things
// in the world *advertise* how much they satisfy a need (The Sims), agents are
// near-dumb selectors that pick the loudest advertiser minus distance, and the
// emergent gatherings are Alexander's "patterns of events bound to patterns of
// space" (Timeless Way ch. 4-5). See docs/texts/.

import * as THREE from 'three';
import { height, walkable, terrainType } from './terrain.js';
import { WORLD_R } from './config.js';
import { makeName, composeName } from './names.js';
import { NavGrid } from './nav.js';

export const NEEDS = ['warmth', 'food', 'company', 'rest'];

// Placeholder culture. The culture generator (docs/npc-behavior.md §3) will make
// these procedurally; for now one shared folk. `personalSpace` = the comfortable
// distance this people keeps from others in the open — different cultures keep
// different distances (proxemics), so this is where that variation will live.
export const DEFAULT_CULTURE = { name: 'folk', personalSpace: 1.3 };

// Individual temperament + skill. Personality is *which wants pull hardest*: the
// drive multipliers say how fast each need rises (a glutton hungers sooner, a
// solitary soul rarely grows lonely), and `beauty` is the taste for collecting
// fine things — which, in a Maslow-ish stack, only surfaces once survival and
// belonging are met (see Brain.choose). Skill is how well the body serves: a
// strong person chops faster and carries more, a keen-eyed one spots small
// valuables from further off. Procedural for now; the culture generator will
// later seed the distributions. (Math.random, like the rest of the agent jitter
// — not yet seed-reproducible.)
const DEFAULT_PERSONA = { warmth: 1, food: 1, company: 1, rest: 1, beauty: 1, strength: 1, perception: 1 };
function makePersona(){
  const v = (lo, hi) => lo + Math.random() * (hi - lo);
  return {
    warmth:  v(0.7, 1.3),   // temperament: how fast each drive rises
    food:    v(0.7, 1.4),
    company: v(0.4, 1.6),   // low = solitary, high = craves company
    rest:    v(0.7, 1.3),
    beauty:  v(0.3, 1.8),   // taste for collecting valuables (top of the need-stack)
    strength:   v(0.7, 1.4), // chop speed, armful size, carrying capacity
    perception: v(0.7, 1.4), // spotting small things (shells, stones)
  };
}

// how fast each need drifts toward "unmet" (per second). Small = legible.
const DRIFT = { warmth: 0.045, food: 0.022, company: 0.030, rest: 0.020 };

const DIST_COST = 0.022;     // utility lost per world-unit of travel
const ACT_MIN   = 0.05;      // below this best-score, just wander
const HARD_R    = 0.5;       // body radius: two NPCs never get closer than this
const INTIMATE  = 0.7;       // personal space shrinks in intimate settings (the fire circle)
const SEP_SPEED = 2.2;       // how fast crowding is eased apart (units/sec)
const OB_CELL   = 4;         // spatial-hash cell size for obstacle (trunk) lookups

// firewood economy: a fire burns fuel and dies untended; people chop shrubs,
// carry the wood, and feed the hearth. Required to build & keep a fire (Pat. 181).
const BURN_RATE   = 0.006;   // fuel spent per second (full -> cold in ~165s)
const FUEL_LOW    = 0.6;     // below this, the fire wants tending
const FUEL_CAP    = 1.2;     // a well-fed fire can bank a little reserve
const CHOP_TIME   = 2.6;     // seconds of swinging to fell one shrub
const LOGS_PER_SHRUB = 3;    // wood a felled shrub yields
const FUEL_PER_LOG   = 0.18; // fuel each log restores when the fire eats one off the pile
// Wood isn't fed straight to the flame: people stack it by the hearth as a
// visible communal reserve, and the fire draws logs off that pile as it burns.
const WOOD_CAP    = 12;      // logs a hearth's woodpile holds (also the visible stack's size)
const WOOD_LOW    = 4;       // below this the pile wants restocking — someone goes to chop
const WOOD_START  = 5;       // logs a fresh hearth is laid with (so it doesn't die at once)
const STACK_KEEP  = 0;       // logs a person keeps in their pack after stacking the rest
const CHOP_BIAS   = 1.3;     // pull toward chopping when the woodpile runs low
const STACK_BIAS  = 1.6;     // pull toward stacking wood we already carry
const TEND_RADIUS = 5;       // a fire counts as attended if anyone is within this
const UNATTENDED_GRACE = 12; // seconds a lit fire may burn with nobody near before it's damped out
const FIRE_RECLAIM = 30;     // seconds a cold, empty, unminded hearth lingers before it crumbles away
const TEND_BIAS   = 0.75;    // duty pull to keep watch over a lit fire nobody else is tending
const TEND_COOK   = 2.4;     // how much stronger that duty is when a stew is in the pot
// the night gathering (Layer-4 ritual): a lit fire after dark with enough folk
// seated round it becomes a gathering — they sway/sing together and bond deeply.
// Grounded in Wiessner's firelight research (night talk is social, not economic).
const GATHER_MIN     = 3;    // seated folk that make a fire-circle a "gathering"
const NIGHT_GATHER   = 0.35; // how dark it must be for the gathering to kindle
const GATHER_COMPANY = 1.8;  // how much more deeply company is sated at a gathering
const BUILD_BIAS  = 1.5;     // pull toward laying a new fire when stranded & cold
// curfew: anticipate nightfall — make for the nearest fire as dusk nears (the
// `evening` signal gives lead time), and if too far from any camp, lay one early.
const CURFEW_BIAS   = 1.7;   // pull toward camp, scaled by how far into the evening it is
const FAR_FROM_CAMP = 45;    // farther than this from any reachable fire at dusk → build your own
const SIGHT_RANGE   = 18;    // how close a groupmate must be to be "seen" (sighting memory)
const BUILD_LOGS  = LOGS_PER_SHRUB;   // wood needed to start a fire from scratch
// No real pathfinding yet: an NPC that can't make headway toward a goal (e.g. a
// fire across water) gives up on it and — if cold — builds its own fire instead.
const STUCK_TIME     = 3.5;  // seconds of no progress before we call a goal unreachable
const BLACKLIST_TIME = 45;   // how long we then ignore that fire (it may be reachable later)

// food economy: gathering and eating are decoupled. NPCs forage into a personal
// pack, eat from it when hungry (anywhere), cache the surplus at the camp hearth,
// and draw from that shared store when their own pack runs dry. See docs/forage.md.
const PACK_MAX       = 6;    // rations an NPC can carry
const RATION_SATIETY = 0.3;  // hunger one ration relieves when eaten
const EAT_AT         = 0.5;  // hunger level at which we reach into the pack
const EAT_CD         = 4;    // min seconds between bites (so a pack isn't gulped at once)
const DEPOSIT_KEEP   = 2;    // rations kept on the person when caching surplus
const STORE_CAP      = 40;   // a hearth's food cache capacity
const FORAGE_BIAS    = 1.0;  // pull toward gathering, scaled by how empty the pack is
const GETFOOD_BIAS   = 1.3;  // pull toward the camp cache when hungry & empty-handed
const STORE_BIAS     = 0.8;  // pull toward caching a full pack at camp

// cooking: some foraged things can't be eaten raw (roots, acorns, most fungi).
// People carry them in a separate raw bag, bring them to a lit fire, and simmer
// them in the hearth pot; the finished stew lands in the shared food cache.
const COOK_KINDS = new Set(['roots', 'acorns', 'cattail root', 'morels']);
export const needsCooking = (kind) => COOK_KINDS.has(kind);
const COOK_TIME  = 22;      // seconds a potful takes to become edible
const COOK_BIAS  = 1.0;     // pull toward taking raw food to the pot
const POT_CAP    = 12;      // raw units a pot holds at once
const STEW_SATIETY  = 0.34; // hunger one cooked portion from the pot relieves (a hearty meal)
const POT_EAT_RANGE = 3.5;  // how close you must be to the pot to eat from it
const SUP_BIAS      = 1.6;  // pull, when hungry & empty-handed, toward a pot with ready stew
// a stew's name, by its main ingredient (for the look-at description)
const DISH_NAME = { mushrooms: 'mushroom stew', morels: 'morel stew', roots: 'root stew',
  acorns: 'acorn porridge', 'cattail root': 'cattail broth' };
const dishName = (kind) => DISH_NAME[kind] || `${kind} stew`;

// gossip: news spreads by talk, so knowledge outruns line-of-sight. Each NPC keeps
// a small, decaying store of facts — who they've seen (and where), where food
// grows — and trades the freshest when two of them meet. See docs/gossip.md.
const GOSSIP_RANGE = 4.5;   // how close two must be to swap news
const GOSSIP_CD    = 8;     // seconds before a person will gossip again
const GOSSIP_SWAP  = 2;     // facts copied each way per exchange
const NEWS_MAX     = 8;     // facts a person carries
const NEWS_TTL     = 2;     // in-game days before a fact fades from memory

// add/refresh a fact (keyed so newer sightings of the same subject overwrite older)
function addNews(npc, fact){
  if (!npc.news) npc.news = new Map();
  const ex = npc.news.get(fact.key);
  if (!ex || fact.t > ex.t) npc.news.set(fact.key, fact);
}
function pruneNews(npc, now){
  const m = npc.news; if (!m) return;
  for (const [k, f] of m) if (now - f.t > NEWS_TTL) m.delete(k);   // forget the stale
  const over = m.size - NEWS_MAX;                                  // and the oldest past the cap
  if (over > 0){ const old = [...m.entries()].sort((a, b) => a[1].t - b[1].t);
    for (let i = 0; i < over; i++) m.delete(old[i][0]); }
}
// copy the freshest few facts from one person to another (no telling someone of themselves)
function shareNews(from, to){
  if (!from.news) return;
  const fresh = [...from.news.values()].sort((x, y) => y.t - x.t);
  let n = 0;
  for (const f of fresh){
    if (n >= GOSSIP_SWAP) break;
    if (f.subj === to) continue;
    const ex = to.news && to.news.get(f.key);
    if (!ex || f.t > ex.t){ addNews(to, { ...f }); n++; }
  }
}

// barter: trade food <-> firewood with a neighbour, so a forager and a wood-cutter
// each end up with both without doing both jobs. A need is met by exchange, not
// only by gathering. (Pattern 30, ACTIVITY NODES — exchange draws people together.)
const BARTER_BIAS  = 1.15;   // pull toward trading for what we lack
const BARTER_QTY   = 2;      // units handed over each way in a swap
const BARTER_RANGE = 16;     // how far we'll go to find a trading partner

// valuables: rare non-utilitarian finds (shells, stones, amber, quartz) people
// pick up for their own worth and spend as trade currency. Gathered opportunist-
// ically — a weak pull, so survival always wins — and capped so packs don't bulge.
const COLLECT_BIAS  = 0.5;   // mild curiosity pull toward a nearby valuable
const COLLECT_RANGE = 14;    // we won't trek far out of our way for a trinket
const TRINKET_MAX   = 8;     // how many a person will carry

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ---------------------------------------------------------------- flame texture
// A soft teardrop flame on a transparent card, drawn once and reused (additive).
function flameTexture(){
  const w = 32, h = 48, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(w/2, h*0.72, 1, w/2, h*0.72, h*0.6);
  grad.addColorStop(0.0, 'rgba(255,250,210,1)');
  grad.addColorStop(0.3, 'rgba(255,200,90,0.95)');
  grad.addColorStop(0.7, 'rgba(245,120,30,0.55)');
  grad.addColorStop(1.0, 'rgba(180,40,10,0)');
  g.fillStyle = grad;
  g.beginPath();                                   // teardrop: round base, pointed top
  g.moveTo(w/2, 2);
  g.quadraticCurveTo(w*0.98, h*0.55, w/2, h*0.96);
  g.quadraticCurveTo(w*0.02, h*0.55, w/2, 2);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
let FLAME_TEX = null;

// ------------------------------------------------------------ campfire siting
// Choosing where to lay a hearth is a small act of SITE REPAIR (Pattern 104):
// don't drop it at random — find flat, open, sheltered ground. We score
// candidates on a deterministic grid around a desired centre by:
//  · flatness  — local slope is gentle, else rejected (NOT on a hillside)
//  · openness  — few actual trees nearby, none on the spot (a clearing)
//  · windbreak — some higher ground within ~10u on at least one side (shelter)
// minus a small pull back toward the desired centre and a wetland penalty.
const ringSpread = (x, z, r) => {            // height range over an 8-point ring
  let mn = Infinity, mx = -Infinity;
  for (let k = 0; k < 8; k++){ const a = k/8 * Math.PI*2; const h = height(x + Math.cos(a)*r, z + Math.sin(a)*r); if (h < mn) mn = h; if (h > mx) mx = h; }
  return mx - mn;
};
function siteScore(x, z, cx, cz, trees){
  if (!walkable(x, z)) return -1;
  const ty = terrainType(x, z);
  if (ty !== 'grass' && ty !== 'mud') return -1;          // no water/sand/rock hearths
  const ls = ringSpread(x, z, 2.5);
  if (ls > 1.4) return -1;                                 // too steep — a hillside
  let count = 0, nearest = Infinity;                       // actual trees nearby
  for (const t of trees){ const d = Math.hypot(x - t[0], z - t[1]); if (d < 9) count++; if (d < nearest) nearest = d; }
  if (nearest < 2.6) return -1;                            // a trunk is basically on the spot
  const h0 = height(x, z);
  let maxRise = -Infinity;                                 // tallest nearby side (a windbreak)
  for (let k = 0; k < 8; k++){ const a = k/8 * Math.PI*2; maxRise = Math.max(maxRise, height(x + Math.cos(a)*10, z + Math.sin(a)*10) - h0); }
  const flat = clamp01(1 - ls / 1.4);
  const open = clamp01(1 - count / 8);                     // few trees within 9u => clearing
  const windbreak = clamp01(maxRise / 4);
  const mud = ty === 'mud' ? 0.15 : 0;                     // keep it off soggy ground
  const dist = Math.hypot(x - cx, z - cz);
  return 0.40 * flat + 0.35 * open + 0.25 * windbreak - 0.004 * dist - mud;
}
// best hearth site on a grid within R of (cx,cz); null if nothing suitable
function findCampfireSite(cx, cz, trees, R = 30, S = 3){
  let best = null, bestS = 0;
  for (let dx = -R; dx <= R; dx += S) for (let dz = -R; dz <= R; dz += S){
    const x = cx + dx, z = cz + dz;
    if (Math.hypot(x, z) >= WORLD_R) continue;
    const s = siteScore(x, z, cx, cz, trees);
    if (s > bestS){ bestS = s; best = [x, z]; }
  }
  return best;
}

// ------------------------------------------------------------------- campfire
// Pattern 181 (THE FIRE) + Pattern 185 (SITTING CIRCLE). A smart object: it
// advertises warmth always and company at night, and hands out evenly-spaced
// seats in a ring so a gathering self-arranges.
export class Campfire {
  constructor(world, x, z){
    this.world = world;
    this.x = x; this.z = z;
    this.ringR = 2.3;        // base radius of the sitting circle
    this.seatArc = 1.15;     // comfortable arc spacing between neighbours (intimate)
    this.arrive = 0.6;       // how close a seat counts as "arrived"
    this.slots = new Map();  // npc -> ring angle
    this.flicker = 1;
    this.fuel = 0.7;         // the live flame; burns down, topped up off the woodpile
    this.woodpile = WOOD_START;  // logs stacked nearby — the communal reserve it eats
    this.idleT = 0;          // seconds it has burned with nobody near (then it's damped)

    FLAME_TEX ||= flameTexture();
    const g = new THREE.Group();
    g.position.set(x, height(x, z), z);

    // fire pit: a dark flat disc with a ring of stones
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 16),
      new THREE.MeshLambertMaterial({ color: 0x2a2622 }));
    pit.rotation.x = -Math.PI/2; pit.position.y = 0.02; g.add(pit);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a8a86 });
    for (let i = 0; i < 8; i++){
      const a = i/8 * Math.PI*2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), stoneMat);
      s.position.set(Math.cos(a)*0.9, 0.1, Math.sin(a)*0.9);
      g.add(s);
    }
    // logs: a few sticks leaning into a teepee
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    for (let i = 0; i < 4; i++){
      const a = i/4 * Math.PI*2;
      const log = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), logMat);
      log.position.set(Math.cos(a)*0.22, 0.4, Math.sin(a)*0.22);
      log.rotation.z = Math.cos(a)*0.5; log.rotation.x = -Math.sin(a)*0.5;
      g.add(log);
    }
    // flame: crossed additive billboards so it reads from any angle
    const flameMat = new THREE.MeshBasicMaterial({
      map: FLAME_TEX, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.flame = new THREE.Group();
    for (let i = 0; i < 2; i++){
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), flameMat);
      q.rotation.y = i * Math.PI/2; q.position.y = 0.6;
      this.flame.add(q);
    }
    g.add(this.flame);
    // warm point light that the (lit) terrain and trees pick up
    this.light = new THREE.PointLight(0xff7a33, 2.2, 14, 2);
    this.light.position.set(0, 0.7, 0); g.add(this.light);

    // the camp food cache: a little basket beside the hearth whose heaped contents
    // grow with the stock. Hidden when empty. (Pattern 181's hearth as camp centre.)
    this.foodStore = 0;
    this.basket = new THREE.Group();
    const weave = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.27, 0.34, 9),
      new THREE.MeshLambertMaterial({ color: 0x7a5328 }));
    weave.position.y = 0.17;
    this.basketHeap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xb2412e }));
    this.basketHeap.position.y = 0.34;
    this.basket.add(weave); this.basket.add(this.basketHeap);
    this.basket.position.set(1.7, 0, 0.4); this.basket.visible = false;
    g.add(this.basket);

    // the cooking pot: a dark cauldron slung over the flames, holding whatever raw
    // ingredients are simmering. Hidden when nothing's cooking. (see needsCooking)
    this.pot = { raw: 0, ready: 0, kind: null, cook: 0 };   // raw units simmering, cooked portions waiting, ingredient, simmer seconds
    this.potGroup = new THREE.Group();
    const potMat = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI*2, 0, Math.PI*0.62), potMat);
    belly.scale.y = 0.8; belly.position.y = 0.36;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 16), potMat);
    rim.rotation.x = Math.PI/2; rim.position.y = 0.52;
    // the broth surface — coloured by the dish, bubbles gently while cooking
    this.potBroth = new THREE.Mesh(new THREE.CircleGeometry(0.25, 14),
      new THREE.MeshLambertMaterial({ color: 0x6b5230 }));
    this.potBroth.rotation.x = -Math.PI/2; this.potBroth.position.y = 0.5;
    this.potGroup.add(belly); this.potGroup.add(rim); this.potGroup.add(this.potBroth);
    this.potGroup.position.set(0, 0.45, 0); this.potGroup.visible = false;
    g.add(this.potGroup);

    // the woodpile: logs people stack by the hearth, crisscrossed in layers so it
    // reads as a real stack. We pre-build WOOD_CAP logs and show as many as are
    // stocked, so the pile visibly grows and shrinks. (Pattern 181 — the hearth
    // as the camp's stocked centre.)
    const logMat2 = new THREE.MeshLambertMaterial({ color: 0x5a3d22 });
    this.woodLogs = [];
    this.woodpileGroup = new THREE.Group();
    const perLayer = 3, logLen = 1.0, logR = 0.09, gap = 0.24;
    for (let layer = 0; this.woodLogs.length < WOOD_CAP; layer++){
      const horiz = layer % 2 === 0;                  // alternate direction each layer
      for (let j = 0; j < perLayer && this.woodLogs.length < WOOD_CAP; j++){
        const log = new THREE.Mesh(new THREE.CylinderGeometry(logR, logR, logLen, 6), logMat2);
        log.rotation.z = Math.PI/2;                   // lay it on its side (running along x)
        if (!horiz) log.rotation.y = Math.PI/2;       // odd layers run along z
        const off = (j - (perLayer-1)/2) * gap;
        log.position.set(horiz ? 0 : off, logR + layer*logR*2, horiz ? off : 0);
        this.woodpileGroup.add(log); this.woodLogs.push(log);
      }
    }
    this.woodpileGroup.position.set(-1.6, 0, 0.5);
    g.add(this.woodpileGroup);
    this._refreshWoodpile();

    this.group = g;
  }

  get lit(){ return this.fuel > 0; }
  needsWood(){ return this.woodpile < WOOD_LOW; }   // the pile wants restocking
  addWood(logs){ this.woodpile = Math.min(WOOD_CAP, this.woodpile + logs); this._refreshWoodpile(); }
  extinguish(){ this.fuel = 0; }   // damped out; update() hides the flame & kills the light next frame
  // show as many stacked logs as we have wood (bottom layers fill first => it grows up)
  _refreshWoodpile(){
    const n = Math.min(this.woodpile | 0, this.woodLogs.length);
    for (let i = 0; i < this.woodLogs.length; i++) this.woodLogs[i].visible = i < n;
  }

  // shared food cache at the hearth
  hasFood(){ return this.foodStore > 0; }
  addFood(n){ this.foodStore = Math.min(STORE_CAP, this.foodStore + n); this._refreshBasket(); }
  takeFood(n){ const got = Math.min(this.foodStore, n); this.foodStore -= got; this._refreshBasket(); return got; }
  _refreshBasket(){
    this.basket.visible = this.foodStore > 0;
    const f = Math.min(1, this.foodStore / STORE_CAP);
    this.basketHeap.scale.setScalar(0.5 + 0.9 * f);
  }

  // the cooking pot: add raw ingredients (returns how many were accepted), and a
  // look-at description of what's simmering. The pot only cooks over a lit fire.
  cook(kind, n){
    const p = this.pot;
    const take = Math.min(n | 0, POT_CAP - p.raw - p.ready);
    if (take <= 0) return 0;
    if (p.raw === 0 && p.ready === 0){ p.kind = kind; p.cook = 0; }   // fresh pot takes its name
    p.raw += take;
    this._refreshPot();
    return take;
  }
  // eat one cooked portion straight from the pot (the communal meal); 0 if none ready
  takeStew(){
    if (this.pot.ready <= 0) return 0;
    this.pot.ready -= 1;
    if (this.pot.raw <= 0 && this.pot.ready <= 0) this.pot.kind = null;
    this._refreshPot();
    return 1;
  }
  potReady(){ return this.pot.ready > 0; }
  _refreshPot(){
    const p = this.pot;
    this.potGroup.visible = (p.raw + p.ready) > 0;
    const tint = { mushrooms: 0x7a5a3a, morels: 0x5a3f2a, roots: 0xa97f43,
      acorns: 0x8a6a3a, 'cattail root': 0x9c8a5a }[p.kind] || 0x6b5230;
    this.potBroth.material.color.setHex(tint);
  }
  // fuller descriptions for the inspect dialog (E on the fire) — read live each call
  potReport(){
    const p = this.pot;
    if (p.raw + p.ready <= 0)
      return "The pot hangs empty over the fire, waiting on something worth cooking.";
    const dish = cap1(dishName(p.kind));
    if (p.ready > 0){
      let s = `${dish}, cooked and ready. There's enough ladled here to feed ${p.ready} ${p.ready === 1 ? 'soul' : 'souls'}.`;
      if (p.raw > 0) s += ` Another ${p.raw} ${p.raw === 1 ? 'portion is' : 'portions are'} still simmering.`;
      return s;
    }
    const prog = p.cook / COOK_TIME;
    const state = prog < 0.33 ? "only just begun to simmer"
      : prog < 0.75 ? "simmering away — not yet fit to eat"
      : "nearly ready";
    return `${dish}, ${state}. When it's done it'll feed ${p.raw} ${p.raw === 1 ? 'soul' : 'souls'}.`;
  }
  fireReport(){
    if (!this.lit) return "Cold ashes — the fire has burned out.";
    const w = this.woodpile | 0;
    const heat = this.fuel > 0.5 ? "burning bright and warm" : "burning low";
    const wood = w > 0 ? `${w} ${w === 1 ? 'log is' : 'logs are'} stacked beside it.`
      : "No wood is stacked — it'll want feeding before long.";
    return `It's ${heat}. ${wood}${this.gathering ? " Folk are gathered close around it, swaying to a low song." : ""}`;
  }
  foodReport(){
    const n = this.foodStore | 0;
    return n > 0 ? `The basket holds ${n} ${n === 1 ? 'ration' : 'rations'} of gathered food.`
      : "The food basket sits empty.";
  }

  // a sentence for the look-at box, or null if the pot is empty
  potLabel(){
    const p = this.pot;
    if (p.raw + p.ready <= 0) return null;
    const dish = cap1(dishName(p.kind));
    if (p.ready > 0)                                  // cooked and being eaten
      return { title: 'Cooking pot', desc: `${dish} — ready to eat${p.raw > 0 ? ', more still simmering' : ''}.` };
    const prog = p.cook / COOK_TIME;                  // still simmering
    const state = prog < 0.33 ? 'just beginning to simmer'
      : prog < 0.75 ? 'not yet ready to eat'
      : 'nearly ready';
    return { title: 'Cooking pot', desc: `${dish} — ${state}.` };
  }

  // what this fire offers `npc` right now (0..1 per need). A dying fire gives
  // less; a cold hearth offers nothing at all.
  advertise(){
    const night = this.world.night;
    const heat = Math.min(1, this.fuel * 2.5);    // weak when low, gone at zero
    return {
      warmth:  (0.55 + 0.45 * night) * heat,
      company: (0.20 + 0.80 * night) * (this.lit ? 1 : 0.15),  // embers still draw a little
      rest:    (0.15 + 0.35 * night) * heat,
    };
  }

  // an evenly-spread seat for npc (claims one on first ask)
  seat(npc){
    if (!this.slots.has(npc)){
      const angs = [...this.slots.values()].sort((a, b) => a - b);
      let ang;
      if (!angs.length) ang = Math.random() * Math.PI*2;
      else {                                          // place in the largest gap
        let best = angs[0] + Math.PI, gap = -1;
        for (let i = 0; i < angs.length; i++){
          const a = angs[i], b = (i+1 < angs.length) ? angs[i+1] : angs[0] + Math.PI*2;
          if (b - a > gap){ gap = b - a; best = a + (b - a)/2; }
        }
        ang = best;
      }
      this.slots.set(npc, ang);
    }
    const ang = this.slots.get(npc);
    const r = Math.max(this.ringR, this.slots.size * this.seatArc / (2 * Math.PI));  // circle grows as people join
    return { x: this.x + Math.cos(ang) * r, z: this.z + Math.sin(ang) * r };
  }
  release(npc){ this.slots.delete(npc); }

  // satisfy the seated npc; company recovers faster the more company there is, and
  // deeper still at a night gathering (the social payoff of firelit talk & song)
  satisfy(npc, dt){
    const social = 0.5 + 0.5 * Math.min(1, (this.slots.size - 1) / 3);
    const gather = this.gathering ? GATHER_COMPANY : 1;
    npc.atGathering = !!this.gathering;          // read by AnimNPC (sway) & dialogue
    npc.needs.warmth  = clamp01(npc.needs.warmth  - 0.30 * dt);
    npc.needs.company = clamp01(npc.needs.company - 0.24 * dt * social * gather);
    npc.needs.rest    = clamp01(npc.needs.rest    - 0.18 * dt);
  }

  update(dt){
    if (dt > 0) this.fuel = Math.max(0, this.fuel - BURN_RATE * dt);   // burns down untended
    // feed itself off the woodpile: when the flame sinks low, a stacked log catches.
    // BURN_RATE is slow, so this consumes the pile visibly over time (~one log a while).
    if (this.fuel < FUEL_LOW && this.woodpile > 0){
      this.woodpile -= 1;
      this.fuel = Math.min(FUEL_CAP, this.fuel + FUEL_PER_LOG);
      this._refreshWoodpile();
    }
    this.flicker += (Math.random() - 0.5) * 8 * dt;
    this.flicker = clamp01(this.flicker * 0.9 + 0.1 * (0.8 + Math.random() * 0.4));
    const f = 0.75 + this.flicker * 0.5;
    const size = Math.min(1, this.fuel * 2.5);            // flame shrinks as fuel runs low
    this.flame.visible = this.lit;
    this.light.intensity = (1.8 + 1.4 * f) * size;        // dims and dies with the fuel
    const potBurn = this.pot.raw > 0 ? 0.5 : 1;           // a pot tames the blaze to a low cooking flame
    this.flame.scale.set((0.85 + 0.3 * f) * size, (0.8 + 0.5 * f) * size * potBurn, (0.85 + 0.3 * f) * size);

    // simmer the pot — only over a live flame. When done, the raw turns to ready
    // portions that sit in the pot to be eaten from (not tipped into the cache).
    if (this.pot.raw > 0 && this.lit && dt > 0){
      this.pot.cook += dt;
      const bub = 0.5 + 0.5 * Math.sin(this._t = (this._t || 0) + dt * 6);  // gentle bubbling
      this.potBroth.position.y = 0.5 + bub * 0.015;
      if (this.pot.cook >= COOK_TIME){                     // done: raw → ready stew
        this.pot.ready += this.pot.raw;
        this.pot.raw = 0; this.pot.cook = 0;
        this._refreshPot();
      }
    }

    // is this a night gathering? (lit, dark out, enough folk actually seated round it)
    let seated = 0;
    for (const n of this.world.npcs)
      if (n.sitting && Math.hypot(n.x - this.x, n.z - this.z) < this.ringR + 2) seated++;
    this.gathering = this.lit && this.world.night > NIGHT_GATHER && seated >= GATHER_MIN;
  }
}

// ----------------------------------------------------------------------- brain
// One per NPC. Holds the drives and runs the decision loop. Steps the NPC's
// x/z/heading/moving each frame; re-decides only a few times a second.
class Brain {
  constructor(world, npc){
    this.world = world; this.npc = npc;
    npc.needs = { warmth: rand(), food: rand(), company: rand(), rest: rand() };
    this.target = null;          // current candidate {kind, x, z, ref, satisfy}
    this.decideT = Math.random() * 0.6;
    this.wanderH = Math.random() * Math.PI*2; this.wanderT = 0;
    npc.actionLabel = 'wander';
    npc.fireGlow = 0;
    npc.pack = 2; npc.eatCd = 0;   // a couple of rations to start; gather/eat are decoupled
    npc.raw = 0; npc.rawKind = null;   // raw, must-be-cooked ingredients (separate from edible rations)
    npc.trinkets = 0;              // valuables carried (shells/stones/amber/quartz) — see choose()
    // pathfinding: A* waypoints toward the goal (see followPath); reachability is
    // judged by actual progress, and goals we truly can't reach get blacklisted.
    this.path = null; this.pathI = 0; this.pgx = 0; this.pgz = 0; this.repathT = 0;
    this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;   // travel-progress sampler
    this._blacklist = new Map();   // Campfire -> seconds left ignored
  }

  step(dt){
    const npc = this.npc, w = this.world, n = npc.needs;
    npc.moving = false; npc.chopping = false;   // set true only while felling a shrub

    // 0. let old "unreachable" grudges expire (a fire may be reachable from elsewhere)
    for (const [f, left] of this._blacklist){
      if (left - dt <= 0) this._blacklist.delete(f); else this._blacklist.set(f, left - dt);
    }

    // 1. drives drift up (warmth faster when it's cold/night), each at this
    // person's own temperament — so individuals hunger/chill/tire/lonely at their
    // own rates (the loner barely grows lonely; the glutton hungers fast).
    const p = npc.persona || DEFAULT_PERSONA;
    n.warmth  = clamp01(n.warmth  + DRIFT.warmth  * dt * (0.4 + 1.6 * w.night) * p.warmth);
    n.food    = clamp01(n.food    + DRIFT.food    * dt * p.food);
    n.company = clamp01(n.company + DRIFT.company * dt * p.company);
    n.rest    = clamp01(n.rest    + DRIFT.rest    * dt * p.rest);

    // 1b. eat when hungry. A communal pot at hand is supped first — slowly, a
    // portion at a time, so a stewful is shared down to empty — else the pack.
    npc.eatCd -= dt;
    if (n.food > EAT_AT && npc.eatCd <= 0){
      let ate = false;
      for (const f of w.fires){
        if (f.pot.ready > 0 && Math.hypot(f.x - npc.x, f.z - npc.z) < POT_EAT_RANGE && f.takeStew() > 0){
          n.food = clamp01(n.food - STEW_SATIETY); ate = true; break;
        }
      }
      if (!ate && (npc.pack || 0) > 0){ npc.pack -= 1; n.food = clamp01(n.food - RATION_SATIETY); ate = true; }
      if (ate) npc.eatCd = EAT_CD;
    }

    // 2. re-decide periodically (or if we have nothing)
    this.decideT -= dt;
    if (this.decideT <= 0 || !this.target){
      this.decideT = 0.6 + Math.random() * 0.5;
      this.choose();
    }

    // 3. act on the current target
    const t = this.target;
    if (!t){ npc.sitting = false; this.wanderStep(dt); this.path = null; }
    else {
      // only the sitting affordance claims a ring seat; tending actions (stoke/
      // fetch/store) just walk to the hearth itself with their own tolerance.
      const useSeat = !!t.sit && t.ref instanceof Campfire;
      const goal = useSeat ? t.ref.seat(npc) : { x: t.x, z: t.z };
      const tol  = useSeat ? t.ref.arrive : (t.tol || 1.5);
      const d = Math.hypot(goal.x - npc.x, goal.z - npc.z);
      if (d > tol){
        npc.sitting = false; this.followPath(goal.x, goal.z, dt);
        // stuck = travelled almost nowhere over a sample window (no route / wedged).
        // Position-based, so legitimately rounding a lake never reads as stuck.
        this._stuckSampleT -= dt;
        if (this._stuckSampleT <= 0){
          if (Math.hypot(npc.x - this._sx, npc.z - this._sz) < 1.2){   // gave up: maybe build our own
            if (t.ref instanceof Campfire){ this._blacklist.set(t.ref, BLACKLIST_TIME); t.ref.release(npc); }
            this.target = null; this.path = null;
          }
          this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;
        }
      } else {                                  // arrived: perform the affordance
        npc.sitting = !!t.sit; this.path = null;
        npc.heading = Math.atan2(t.x - npc.x, t.z - npc.z);   // face the thing
        t.satisfy(npc, dt);
      }
    }

    // firelight glow on the sprite (read by AnimNPC), only near a fire at dusk/night
    let glow = 0;
    for (const fire of w.fires){
      const d = Math.hypot(fire.x - npc.x, fire.z - npc.z);
      glow = Math.max(glow, (1 - Math.min(1, d / 6)));
    }
    npc.fireGlow = glow * (0.25 + 0.55 * w.night);
  }

  // pick the affordance with the highest (advertised × deficit − distance) score
  choose(){
    const npc = this.npc, w = this.world, n = npc.needs;
    const p = npc.persona || DEFAULT_PERSONA;
    // Maslow-ish gating: belonging waits on survival, and the finer wants (a taste
    // for beautiful things) wait on both. So a starving or freezing person ignores
    // company and trinkets; a content one indulges them. `eff` is the need vector
    // the decision loop actually weighs, after this gating.
    const surv = Math.max(n.warmth, n.food, n.rest);
    const companyGate = clamp01(1 - 0.75 * surv);
    const beautyGate  = clamp01(1 - 0.75 * Math.max(surv, n.company));
    const eff = { warmth: n.warmth, food: n.food, rest: n.rest, company: n.company * companyGate };
    let best = null, bestScore = ACT_MIN;
    const consider = (kind, x, z, ad, ref, opts = {}) => {
      const dist = Math.hypot(x - npc.x, z - npc.z);
      if (dist > 70) return;
      let s = -DIST_COST * dist + (opts.bias || 0);
      for (const k in ad) s += ad[k] * eff[k];
      if (s > bestScore){ bestScore = s; best = { kind, x, z, ref, ...opts,
        satisfy: opts.satisfy || (ref && ref.satisfy ? (a, dt) => ref.satisfy(a, dt) : () => {}) }; }
    };

    for (const fire of w.fires){
      if (this._blacklist.has(fire)) continue;            // a fire we've found we can't reach
      consider('fire', fire.x, fire.z, fire.advertise(), fire, { sit: true });
    }

    // duty of the hearth: a lit fire — above all one with a stew in the pot — must
    // not be left to itself. Keep watch over any reachable lit fire that nobody else
    // is tending (and if that nobody includes us, stay put). This is a flat duty
    // pull, independent of how warm/social we feel, so fires & stews aren't deserted.
    for (const fire of w.fires){
      if (this._blacklist.has(fire) || !fire.lit) continue;
      const minded = w.npcs.some(o => o !== npc && Math.hypot(o.x - fire.x, o.z - fire.z) < TEND_RADIUS);
      if (minded) continue;                               // someone else has it
      const cooking = (fire.pot.raw + fire.pot.ready) > 0;
      consider('tend', fire.x, fire.z, {}, fire, { sit: true, bias: TEND_BIAS * (cooking ? TEND_COOK : 1) });
    }

    // felling one shrub's worth of wood — shared by tending and building
    const chopSatisfy = (shrub) => (a, dt) => {
      if (!shrub.alive){ this.target = null; return; }    // someone beat us to it
      a.chopping = true; a.chopT = (a.chopT || 0) + dt;
      if (a.chopT >= (a.chopTime || CHOP_TIME)){          // a strong arm fells it faster
        shrub.chop(); a.firewood = (a.firewood || 0) + Math.round(LOGS_PER_SHRUB * p.strength);  // & hauls a bigger armful
        a.chopT = 0; a.chopping = false; this.target = null;   // re-decide: carry it on
      }
    };
    const goChop = (bias) => {
      const shrub = w.nearestShrub(npc.x, npc.z);
      if (shrub) consider('chop', shrub.x, shrub.z, {}, shrub, { tol: 1.5, bias, satisfy: chopSatisfy(shrub) });
    };

    // firewood economy. First, a *reachable* fire whose woodpile is running low:
    // stack the wood we carry onto it, else go cut some. The fire burns the pile
    // on its own (Campfire.update). Urgency rises as the pile empties / night
    // falls / we grow cold.
    let lowFire = null, dd = 50;
    let homeFire = null, homeD = Infinity;        // nearest reachable fire = our "camp"
    for (const f of w.fires){
      if (this._blacklist.has(f)) continue;
      const d = Math.hypot(f.x - npc.x, f.z - npc.z);
      if (d < homeD){ homeD = d; homeFire = f; }
      if (f.needsWood() && d < dd){ dd = d; lowFire = f; }
    }
    const haveReachableFire = !!homeFire;

    // curfew: anticipate nightfall. As the evening draws on, make for the nearest
    // fire to settle before dark (a pull that grows with `evening`, independent of
    // how cold we are yet). If we've wandered too far from any camp, build one.
    const ev = w.evening || 0;
    const farFromCamp = !homeFire || homeD > FAR_FROM_CAMP;
    if (ev > 0.15 && homeFire && !farFromCamp)
      consider('fire', homeFire.x, homeFire.z, {}, homeFire, { sit: true, bias: CURFEW_BIAS * ev });

    if (lowFire){
      const urgency = (1 - lowFire.woodpile / WOOD_LOW) * (0.45 + 0.55 * n.warmth) * (0.5 + 0.5 * w.night);
      if ((npc.firewood || 0) > STACK_KEEP)
        consider('stack', lowFire.x, lowFire.z, {}, lowFire, { tol: 1.2, bias: STACK_BIAS * urgency,
          satisfy: (a) => { lowFire.addWood((a.firewood || 0) - STACK_KEEP); a.firewood = STACK_KEEP; this.target = null; } });
      else goChop(CHOP_BIAS * urgency);
    } else if ((n.warmth > 0.45 && !haveReachableFire) || (ev > 0.35 && farFromCamp)){
      // Stranded & cold, OR dusk is closing in and there's no camp within reach:
      // make our own. Gather an armful, then lay a hearth here and stack the wood.
      const want = Math.max(n.warmth, ev);
      if ((npc.firewood || 0) >= BUILD_LOGS)
        consider('build', npc.x, npc.z, {}, null, { tol: 2.0, bias: BUILD_BIAS * want,
          satisfy: (a) => {
            const f = w.addCampfire(a.x, a.z, { refine: false });   // right here, reachable
            f.woodpile = 0; f.addWood(a.firewood); a.firewood = 0;  // stocked with the wood we hauled
            this.target = null;
          } });
      else goChop(CHOP_BIAS * want);
    }
    // --- food economy: forage -> pack -> eat; cache the surplus at camp, and
    // draw from that store when the pack runs dry. (Eating itself is in step.) ---
    const pack = npc.pack || 0;
    const cap = npc.packMax || PACK_MAX;                 // a strong back carries more
    const packDeficit = 1 - pack / cap;
    const raw = npc.raw || 0;
    const rawCap = cap;                                  // carry as much raw as cooked
    let storeFire = null, sd = 55, campFire = null, cd = 55, cookFire = null, kd = 55, supFire = null, pd = 30;
    for (const f of w.fires){
      if (this._blacklist.has(f)) continue;
      const d = Math.hypot(f.x - npc.x, f.z - npc.z);
      if (d < cd){ cd = d; campFire = f; }
      if (f.hasFood() && d < sd){ sd = d; storeFire = f; }
      if (f.lit && d < kd){ kd = d; cookFire = f; }     // a live flame we could cook over
      if (f.potReady() && d < pd){ pd = d; supFire = f; }   // a pot with ready stew to share
    }
    // hungry: go sup at a pot of ready stew (the communal meal — eat from it in step)
    if (n.food > 0.4 && supFire)
      consider('sup', supFire.x, supFire.z, {}, supFire, { sit: true, bias: SUP_BIAS * n.food * p.food });
    // hungry and empty-handed: fetch a load from the camp cache (food-keen folk more so)
    if (pack === 0 && n.food > 0.4 && storeFire)
      consider('getfood', storeFire.x, storeFire.z, {}, storeFire, { tol: 1.6, bias: GETFOOD_BIAS * n.food * p.food,
        satisfy: (a) => { const got = storeFire.takeFood((a.packMax || PACK_MAX) - (a.pack || 0));
          if (got > 0){ a.pack = (a.pack || 0) + got; a.packKind = 'food'; } this.target = null; } });
    // gather to keep stocked. Raw-edible foods go in the eating pack; things that
    // must be cooked go in a separate raw bag, bound for the pot.
    if (pack < cap || raw < rawCap)
      for (const pl of w.food){
        if (!pl.ripe) continue;                       // already picked — nothing here
        const cookable = needsCooking(pl.kind);
        if (cookable ? raw >= rawCap : pack >= cap) continue;   // no room in the right bag
        const deficit = cookable ? (1 - raw / rawCap) : packDeficit;
        consider('food', pl.x, pl.z, {}, pl, { tol: 1.4, bias: FORAGE_BIAS * deficit * p.food,
          satisfy: (a) => {                           // pick it: the fruit vanishes & regrows later
            if (pl.ripe){ const y = pl.collect(); if (y > 0){
              if (needsCooking(pl.kind)){ a.raw = Math.min(rawCap, (a.raw || 0) + y); a.rawKind = pl.kind; }
              else { a.pack = Math.min(a.packMax || PACK_MAX, (a.pack || 0) + y); a.packKind = pl.kind; }
              // now they *know* this patch — a food tip to pass on (it regrows)
              addNews(a, { kind: 'food', key: 'food:' + pl.kind + ':' + (pl.x|0) + ',' + (pl.z|0),
                foodKind: pl.kind, x: pl.x, z: pl.z, t: w.time });
            } }
            this.target = null;
          } });
      }
    // carrying raw ingredients & a live flame with pot-room is near: take them to cook
    if (raw > 0 && cookFire && cookFire.pot.raw < POT_CAP)
      consider('cook', cookFire.x, cookFire.z, {}, cookFire, { tol: 1.6, bias: COOK_BIAS * (0.5 + raw / rawCap),
        satisfy: (a) => { if ((a.raw || 0) > 0){ const put = cookFire.cook(a.rawKind, a.raw); a.raw -= put; if (a.raw <= 0) a.rawKind = null; } this.target = null; } });
    // hungry, nothing edible to hand (no rations, no reachable cache) but carrying
    // raw food and no fire to cook on → lay a hearth. But only if there's no hearth
    // near at all: a cold one nearby will be relit by the firewood economy, so we
    // don't pepper the meadow with one-off cook-fires (see the behaviour report).
    if (n.food > 0.55 && pack === 0 && !storeFire && raw > 0 && !cookFire && (!campFire || cd > FAR_FROM_CAMP)){
      if ((npc.firewood || 0) >= BUILD_LOGS)
        consider('build', npc.x, npc.z, {}, null, { tol: 2.0, bias: BUILD_BIAS * n.food,
          satisfy: (a) => {
            const f = w.addCampfire(a.x, a.z, { refine: false });   // right here, reachable
            f.woodpile = 0; f.addWood(a.firewood); a.firewood = 0;
            this.target = null;
          } });
      else goChop(CHOP_BIAS * n.food);
    }
    // pack full: carry the surplus to camp and cache it (delayed-return)
    if (pack >= cap && campFire)
      consider('store', campFire.x, campFire.z, {}, campFire, { tol: 1.6, bias: STORE_BIAS,
        satisfy: (a) => { const give = (a.pack || 0) - DEPOSIT_KEEP;
          if (give > 0){ campFire.addFood(give); a.pack = DEPOSIT_KEEP; } this.target = null; } });

    // --- barter: get what we lack from a neighbour who has it, paying with our
    //     own surplus (food <-> firewood). Only trades when the two are actually
    //     adjacent, so nobody trades with someone who has wandered off. ---
    const haveWood = npc.firewood || 0;
    // pay the partner: the complementary utilitarian good if we have it, else spend
    // a valuable as currency. Returns true if a payment was made.
    const payWith = (a, s, good) => {
      if (good === 'wood' && (a.firewood || 0) >= 1){
        const pay = Math.min(a.firewood, BARTER_QTY); a.firewood -= pay; s.firewood = (s.firewood || 0) + pay; return true;
      }
      if (good === 'food' && (a.pack || 0) > DEPOSIT_KEEP){
        const pay = Math.min(a.pack - DEPOSIT_KEEP, BARTER_QTY); a.pack -= pay; s.pack = (s.pack || 0) + pay; if (!s.packKind) s.packKind = a.packKind; return true;
      }
      if ((a.trinkets || 0) >= 1){   // spend a valuable instead — it's worth a swap
        a.trinkets -= 1; s.trinkets = (s.trinkets || 0) + 1; if (!s.trinketKind) s.trinketKind = a.trinketKind; return true;
      }
      return false;
    };
    const tradeFor = (a, s, want) => {
      if (Math.hypot(a.x - s.x, a.z - s.z) > 2.5){ this.target = null; return; }   // partner moved off
      if (want === 'food'){
        const got = Math.min(s.pack || 0, BARTER_QTY);
        if (got > 0 && payWith(a, s, 'wood')){ s.pack -= got; a.pack = (a.pack || 0) + got; a.packKind = s.packKind || 'food'; }
      } else {   // want wood
        const got = Math.min(s.firewood || 0, BARTER_QTY);
        if (got > 0 && payWith(a, s, 'food')){ s.firewood -= got; a.firewood = (a.firewood || 0) + got; }
      }
      this.target = null;
    };
    const nearestWith = (has) => {        // closest peasant carrying a tradeable surplus
      let best = null, bd = BARTER_RANGE;
      for (const o of w.npcs){ if (o === npc) continue; const d = Math.hypot(o.x - npc.x, o.z - npc.z);
        if (d < bd && has(o)){ bd = d; best = o; } }
      return best;
    };
    const canPay = (good) => (good === 'wood' ? haveWood >= BARTER_QTY : pack > DEPOSIT_KEEP) || (npc.trinkets || 0) >= 1;
    // hungry & out of food, but with wood or a valuable to pay → buy food from a forager
    if (pack === 0 && n.food > 0.4 && canPay('wood')){
      const s = nearestWith(o => (o.pack || 0) > BARTER_QTY);
      if (s) consider('trade', s.x, s.z, {}, s, { tol: 1.6, bias: BARTER_BIAS * n.food,
        satisfy: (a) => tradeFor(a, s, 'food') });
    }
    // need wood (a fire wants it / stranded & cold) & out of wood, but with food or a
    // valuable to pay → buy wood from a wood-cutter instead of felling a shrub ourselves
    if (haveWood === 0 && n.warmth > 0.45 && canPay('food') && (lowFire || !haveReachableFire)){
      const s = nearestWith(o => (o.firewood || 0) > BARTER_QTY);
      if (s) consider('trade', s.x, s.z, {}, s, { tol: 1.6, bias: BARTER_BIAS * n.warmth,
        satisfy: (a) => tradeFor(a, s, 'wood') });
    }

    // valuables: pick up an interesting find we pass near. Top of the need-stack —
    // `beautyGate` holds it back until survival & belonging are met — and scaled by
    // this person's taste for fine things (`beauty`). Keen eyes spot them further off.
    if ((npc.trinkets || 0) < (npc.trinketMax || TRINKET_MAX)){
      let v = null, vd = npc.collectRange || COLLECT_RANGE;
      for (const o of w.valuables){ if (!o.ripe) continue; const d = Math.hypot(o.x - npc.x, o.z - npc.z); if (d < vd){ vd = d; v = o; } }
      if (v) consider('collect', v.x, v.z, {}, v, { tol: 1.3, bias: COLLECT_BIAS * p.beauty * beautyGate,
        satisfy: (a) => { if (v.ripe){ const y = v.collect(); if (y > 0){ a.trinkets = (a.trinkets || 0) + y; a.trinketKind = v.kind; } } this.target = null; } });
    }

    for (const o of w.npcs){     // other people advertise company — kinfolk more so
      if (o === npc) continue;
      const kin = npc.group && o.group === npc.group;       // same family/clan/band
      consider('greet', o.x, o.z, { company: kin ? 0.6 : 0.22 }, null,
        { tol: 1.7, satisfy: (a, dt) => { a.needs.company = clamp01(a.needs.company - (kin ? 0.16 : 0.10) * dt); } });
    }

    // release a seat we're abandoning
    if (this.target && this.target.ref instanceof Campfire &&
        (!best || best.ref !== this.target.ref)) this.target.ref.release(npc);

    // new target → drop the old path & restart the stuck sampler so a fresh route
    // is planned and we don't carry stale "no progress" against the new goal
    const prevRef = this.target && this.target.ref;
    if (!best || best.ref !== prevRef){
      this.path = null; this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;
    }
    this.target = best;
    npc.actionLabel = !best ? 'wander' : best.kind;
  }

  // Travel toward (gx,gz) along an A* path that routes around water & tree
  // clusters, steering locally (moveTo) between waypoints. Repaths when the goal
  // moves, on a timer, or when the path runs out. Falls back to direct steering if
  // no path exists (then the stuck sampler eventually gives the goal up).
  followPath(gx, gz, dt){
    const nav = this.world.nav;
    if (!nav){ this.moveTo(gx, gz, dt); return; }
    this.repathT -= dt;
    if (!this.path || this.repathT <= 0 || Math.hypot(gx - this.pgx, gz - this.pgz) > nav.cell){
      this.path = nav.findPath(this.npc.x, this.npc.z, gx, gz);
      this.pathI = 0; this.pgx = gx; this.pgz = gz; this.repathT = 1.0 + Math.random() * 0.6;
    }
    if (!this.path || !this.path.length){ this.moveTo(gx, gz, dt); return; }   // no route: steer direct
    const reach = nav.cell * 0.9;
    let wp = this.path[this.pathI];
    while (this.pathI < this.path.length - 1 &&
           Math.hypot(this.npc.x - wp[0], this.npc.z - wp[1]) < reach){
      wp = this.path[++this.pathI];
    }
    this.moveTo(wp[0], wp[1], dt);
  }

  moveTo(gx, gz, dt){
    const npc = this.npc, w = this.world;
    // start with the direction to the goal
    let sx = gx - npc.x, sz = gz - npc.z;
    const gd = Math.hypot(sx, sz) || 1; sx /= gd; sz /= gd;
    // steer around nearby trunks: push away (radial) + slip past (tangential)
    for (const o of w.obstaclesNear(npc.x, npc.z)){
      if (o.alive === false) continue;             // a chopped shrub is gone
      const ox = npc.x - o.x, oz = npc.z - o.z;
      const d = Math.hypot(ox, oz) || 1e-3;
      const reach = o.r + 0.4 + 2.2;                 // body + sense radius
      if (d < reach){
        const push = (reach - d) / reach;            // 0..1, stronger when closer
        sx += (ox/d) * push; sz += (oz/d) * push;    // radial: away from trunk
        let tx = -oz/d, tz = ox/d;                   // tangential: slip around
        if (tx*(gx-npc.x) + tz*(gz-npc.z) < 0){ tx = -tx; tz = -tz; }   // toward the goal side
        sx += tx * push * 0.9; sz += tz * push * 0.9;
      }
    }
    const a = Math.atan2(sx, sz);
    npc.heading = a;
    const spd = 1.6 * dt;
    const nx = npc.x + Math.sin(a) * spd, nz = npc.z + Math.cos(a) * spd;
    if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){
      npc.x = nx; npc.z = nz; npc.moving = true;   // trunks are resolved by pushOut, not rejected
    } else { npc.heading += 0.8; }   // last resort: turn and retry next frame
  }

  wanderStep(dt){
    const npc = this.npc;
    this.wanderT -= dt;
    if (this.wanderT <= 0){ this.wanderH = Math.random() * Math.PI*2; this.wanderT = 2 + Math.random() * 4; }
    const spd = 1.2 * dt;
    const vx = Math.sin(this.wanderH) * spd, vz = Math.cos(this.wanderH) * spd;
    if (walkable(npc.x + vx, npc.z + vz) && Math.hypot(npc.x + vx, npc.z + vz) < WORLD_R){
      npc.x += vx; npc.z += vz; npc.moving = true; npc.heading = this.wanderH;
    } else { this.wanderH += Math.PI * 0.7; this.wanderT = 1 + Math.random() * 2; }
  }
}

function rand(){ return Math.random(); }

// ------------------------------------------------------------------ the world
// Owns the affordances, the campfires, and the shared day/night state the
// brains read. Attach it to NPCs, feed it the sky + food sources each frame.
export class AgentWorld {
  constructor(scene){
    this.scene = scene;
    this.fires = [];
    this.trees = [];      // trunk [x,z] list, used to site hearths in clearings
    this.shrubs = [];     // choppable shrubs (firewood)
    this.food = [];       // forage plants (visited, not depleted, by NPCs)
    this.valuables = [];  // rare finds people gather & trade (shells/stones/amber/quartz)
    this.npcs = [];       // NPCs that have brains (for pairwise company)
    this.day = 1; this.night = 0; this.evening = 0;
    this.time = 0;        // in-game day counter (fractional), for sighting memory
    this._nextId = 0;     // hands out stable per-NPC ids (gossip fact keys)
    this.culture = DEFAULT_CULTURE;
    this._obGrid = new Map();   // spatial hash of obstacle circles {x,z,r}
    this._obstacles = [];       // flat list (also fed to the nav grid)
    this.nav = new NavGrid();   // A* walkability grid (built in buildNav)
  }

  // register the circles people walk around (tree trunks, shrubs)
  setObstacles(list){
    this._obstacles = list || [];
    this._obGrid.clear();
    for (const o of this._obstacles){
      const k = ((o.x / OB_CELL) | 0) + ',' + ((o.z / OB_CELL) | 0);
      (this._obGrid.get(k) || this._obGrid.set(k, []).get(k)).push(o);
    }
  }
  // build the pathfinding grid (water/bounds + large static obstacles). Call once
  // after setObstacles; the nav grid is static thereafter.
  buildNav(){ this.nav.build(this._obstacles); }
  // obstacles in the 3x3 cells around (x,z)
  obstaclesNear(x, z){
    const cx = (x / OB_CELL) | 0, cz = (z / OB_CELL) | 0, out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++){
      const b = this._obGrid.get((cx + i) + ',' + (cz + j)); if (b) out.push(...b);
    }
    return out;
  }
  // nudge (x,z) out to the edge of any trunk it's inside, so walkers slide around
  // a tree instead of getting stuck in it. Returns the resolved [x,z]. Several
  // iterations so a body wedged between overlapping trunks still works free.
  pushOut(x, z){
    for (let it = 0; it < 4; it++){
      let moved = false;
      for (const o of this.obstaclesNear(x, z)){
        if (o.alive === false) continue;           // a chopped shrub is gone
        const dx = x - o.x, dz = z - o.z, rr = o.r + 0.35;
        const d = Math.hypot(dx, dz);
        if (d < rr){
          if (d < 1e-3){ const a = Math.random() * Math.PI*2; x = o.x + Math.cos(a)*rr; z = o.z + Math.sin(a)*rr; }
          else { x = o.x + dx/d * rr; z = o.z + dz/d * rr; }
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }
  // is (x,z) inside any (living) obstacle?
  inObstacle(x, z){
    for (const o of this.obstaclesNear(x, z)){
      if (o.alive === false) continue;
      if (Math.hypot(x - o.x, z - o.z) < o.r + 0.35) return true;
    }
    return false;
  }
  // nearest point to (x,z) that is on land AND clear of every trunk, found by
  // searching outward rings. The guaranteed escape when a straight push-out
  // would land in water or in another tree. Returns [x,z] or null if hemmed in.
  clearSpot(x, z){
    if (walkable(x, z) && Math.hypot(x, z) < WORLD_R && !this.inObstacle(x, z)) return [x, z];
    for (let r = 0.8; r <= 8; r += 0.7){
      for (let k = 0; k < 12; k++){
        const a = k / 12 * Math.PI*2 + r;          // rotate each ring so samples don't line up
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (Math.hypot(px, pz) < WORLD_R && walkable(px, pz) && !this.inObstacle(px, pz)) return [px, pz];
      }
    }
    return null;
  }
  // pop every NPC out of any trunk it has wandered (or spawned) into (run each step)
  resolveTrees(){
    for (const n of this.npcs){
      let [x, z] = this.pushOut(n.x, n.z);
      const escaped = (x !== n.x || z !== n.z);
      if (escaped && walkable(x, z) && Math.hypot(x, z) < WORLD_R && !this.inObstacle(x, z)){
        n.x = x; n.z = z;                                  // clean push-out worked
      } else if (this.inObstacle(n.x, n.z)){               // still stuck (water-side / clustered trunks)
        const c = this.clearSpot(n.x, n.z);
        if (c){ n.x = c[0]; n.z = c[1]; }
      }
    }
  }

  setTrees(trees){ this.trees = trees || []; }

  // the choppable shrubs (firewood). Records carry .alive and .chop() (flora.js).
  setShrubs(shrubs){ this.shrubs = shrubs || []; }
  // nearest still-standing shrub to (x,z), within reach, or null
  nearestShrub(x, z, range = 45){
    let best = null, bd = range;
    for (const s of this.shrubs){
      if (!s.alive) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd){ bd = d; best = s; }
    }
    return best;
  }

  // place a campfire near (x,z). refine=true searches for the best flat/open/
  // sheltered site nearby (the world's first hearth). refine=false lays it right
  // here, just nudged clear of trunks — for an NPC building one where it stands,
  // so the new fire is guaranteed reachable (no jumping across the water it's stuck at).
  addCampfire(x, z, { refine = true } = {}){
    if (refine){
      const site = findCampfireSite(x, z, this.trees);
      if (site){ [x, z] = site; }
      else if (!walkable(x, z)){                     // fallback: spiral to any dry ground
        for (let r = 1; r < 30 && !walkable(x, z); r++){
          const a = r * 1.3; x += Math.cos(a) * 1.5; z += Math.sin(a) * 1.5;
        }
      }
    } else {
      const c = this.clearSpot(x, z); if (c){ [x, z] = c; }
    }
    const f = new Campfire(this, x, z);
    this.fires.push(f); this.scene.add(f.group);
    return f;
  }

  setFood(plants){ this.food = plants || []; }
  setValuables(list){ this.valuables = list || []; }

  attach(npc, culture = this.culture){
    if (this.inObstacle(npc.x, npc.z)){          // spawned inside a trunk? step clear first
      const c = this.clearSpot(npc.x, npc.z);
      if (c){ npc.x = c[0]; npc.z = c[1]; }
    }
    npc.brain = new Brain(this, npc);
    npc.culture = culture;
    // individual temperament + skill (see makePersona / Brain.choose)
    const p = npc.persona = makePersona();
    if (npc.group && npc.group.kind === 'lone') p.company = Math.min(p.company, 0.65);   // loners keep apart
    npc.packMax      = Math.max(3, Math.round(PACK_MAX * p.strength));     // strong → carries more food
    npc.trinketMax   = Math.max(3, Math.round(TRINKET_MAX * p.strength));
    npc.chopTime     = CHOP_TIME / p.strength;                             // strong → fells shrubs faster
    npc.collectRange = COLLECT_RANGE * p.perception;                       // keen-eyed → spots finds further off
    // a name fitting the sprite's race; kin (family/clan) share their group surname
    const nm = makeName(npc.slug);
    const surname = (npc.group && npc.group.surname) || nm.surname;
    npc.race = nm.race; npc.given = nm.given; npc.surname = surname; npc.gender = nm.gender;
    npc.name = composeName({ given: nm.given, surname, full: `${nm.given} ${surname}` }, p);
    // comfortable distance: solitary folk keep more room, sociable folk less
    npc.personalSpace = culture.personalSpace * (1.5 - 0.45 * p.company) * (0.9 + Math.random() * 0.2);
    npc.seen = new Map();   // groupmate -> { x, z, t } last-sighting memory (kin dialogue)
    npc.id = this._nextId++;   // stable id, so gossip can key facts by subject
    npc.news = new Map();      // small decaying store of facts heard or seen (see gossip)
    this.npcs.push(npc);
    return npc;
  }

  syncSky(sky){ this.day = sky.day ?? 1; this.night = sky.night ?? 0; this.evening = sky.evening ?? 0; this.time = sky.time ?? this.time; }

  update(dt){
    const keep = [];
    for (const f of this.fires){
      f.update(dt);
      const near = this.npcs.some(n => Math.hypot(n.x - f.x, n.z - f.z) < TEND_RADIUS);
      // never leave a fire burning unattended: if nobody is near it, the last to
      // leave damps it (a short grace so brief stepping-away doesn't kill it).
      if (f.lit){
        // a pot with food in it (simmering or ready) keeps the fire "in use"
        const tended = (f.pot.raw + f.pot.ready) > 0 || near;
        if (tended) f.idleT = 0;
        else { f.idleT += dt; if (f.idleT > UNATTENDED_GRACE) f.extinguish(); }
        f.deadT = 0; keep.push(f);
      } else {
        f.idleT = 0;
        // a cold, empty, unminded hearth crumbles back into the meadow rather than
        // littering the world forever (stops the fire-sprawl seen in the report).
        const abandoned = !near && (f.pot.raw + f.pot.ready) <= 0 && f.woodpile <= 0;
        f.deadT = abandoned ? (f.deadT || 0) + dt : 0;
        if (f.deadT > FIRE_RECLAIM){
          this.scene.remove(f.group);
          for (const n of this.npcs) if (n.brain) n.brain._blacklist.delete(f);
        } else keep.push(f);
      }
    }
    this.fires = keep;
    // sightings + gossip (cheap O(n²); the world has tens of NPCs, not thousands).
    // Seeing someone makes a fresh "saw" fact; standing close enough to talk trades
    // the freshest news both ways, so word of people & food outruns line-of-sight.
    const now = this.time;
    for (const n of this.npcs) n._gossipCd = (n._gossipCd || 0) - dt;
    for (const n of this.npcs){
      for (const o of this.npcs){
        if (o === n) continue;
        const d = Math.hypot(o.x - n.x, o.z - n.z);
        if (d <= SIGHT_RANGE){                          // saw them with our own eyes
          addNews(n, { kind: 'saw', key: 'saw:' + o.id, subj: o, x: o.x, z: o.z, t: now });
          if (n.group && o.group === n.group && n.seen) n.seen.set(o, { x: o.x, z: o.z, t: now });
        }
        if (d <= GOSSIP_RANGE && n._gossipCd <= 0 && o._gossipCd <= 0){   // close enough to chat
          shareNews(n, o); shareNews(o, n);
          n._gossipCd = GOSSIP_CD; o._gossipCd = GOSSIP_CD;
        }
      }
      pruneNews(n, now);
    }
  }

  // Personal-space pass (Pattern 127, INTIMACY GRADIENT). After everyone has
  // moved, ease apart any pair closer than their combined comfortable distance —
  // softly as a gradient, hard inside the body radius so they can never overlap.
  // Seated NPCs use a tighter distance, so the fire circle reads as intimate
  // while open ground stays roomy. Comfort is culture-driven (npc.personalSpace).
  separate(dt){
    if (dt <= 0) return;
    const list = this.npcs, n = list.length;
    for (let i = 0; i < n; i++){
      const a = list[i];
      if (a.talking) continue;
      const aSpace = (a.personalSpace || 1.3) * (a.sitting ? INTIMATE : 1);
      let px = 0, pz = 0;
      for (let j = 0; j < n; j++){
        if (j === i) continue;
        const b = list[j];
        const dx = a.x - b.x, dz = a.z - b.z;
        const d = Math.hypot(dx, dz);
        const bSpace = (b.personalSpace || 1.3) * (b.sitting ? INTIMATE : 1);
        const want = Math.max(HARD_R, (aSpace + bSpace) * 0.5);
        if (d > want) continue;
        if (d < 1e-3){ const r = Math.random() * Math.PI*2; px += Math.cos(r); pz += Math.sin(r); continue; }
        const overlap = (want - d) / want;                              // 0..1, larger when closer
        const strength = overlap * overlap                              // soft comfort gradient
          + (d < HARD_R ? 1.5 * (HARD_R - d) / HARD_R : 0);             // hard core: never overlap
        px += (dx / d) * strength; pz += (dz / d) * strength;
      }
      if (px || pz){
        const mag = Math.hypot(px, pz);
        const sc = Math.min(mag, 1.2) / mag * SEP_SPEED * dt;
        const nx = a.x + px * sc, nz = a.z + pz * sc;
        if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){ a.x = nx; a.z = nz; }
      }
    }
  }

  // dev overlay text: world state + the nearest few NPCs' drives & actions
  debugText(px, pz){
    const bar = v => { const n = Math.round(clamp01(v) * 4); return '█'.repeat(n) + '░'.repeat(4 - n); };
    const fires = this.fires.map(f => `fuel ${bar(f.fuel)}/wood ${f.woodpile | 0}/food ${f.foodStore | 0}` +
      (f.pot.raw > 0 ? `/pot ${f.pot.kind} ${(f.pot.cook / COOK_TIME * 100) | 0}%` : '') +
      (f.pot.ready > 0 ? `/stew ${f.pot.ready}` : '')).join('  ');
    const standing = this.shrubs.reduce((s, x) => s + (x.alive ? 1 : 0), 0);
    const finds = this.valuables.reduce((s, x) => s + (x.ripe ? 1 : 0), 0);
    const lines = [`day ${this.day.toFixed(2)}  night ${this.night.toFixed(2)}  ${fires || 'no fire'}  shrubs ${standing}  finds ${finds}`];
    const near = this.npcs
      .map(n => ({ n, d: Math.hypot(n.x - px, n.z - pz) }))
      .sort((a, b) => a.d - b.d).slice(0, 7);
    for (const { n, d } of near){
      const q = n.needs;
      lines.push(`W${bar(q.warmth)} F${bar(q.food)} C${bar(q.company)} R${bar(q.rest)}` +
        `  ${(n.actionLabel || '?').padEnd(7)} d${d.toFixed(0)}` +
        `${n.sitting ? ' sit' : ''}${n.chopping ? ' chop' : ''}${n.firewood ? ' w' + n.firewood : ''}${n.pack ? ' p' + n.pack : ''}${n.raw ? ' r' + n.raw : ''}${n.trinkets ? ' t' + n.trinkets : ''}${n.news && n.news.size ? ' n' + n.news.size : ''}`);
    }
    return lines.join('\n');
  }
}
