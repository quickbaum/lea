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
import { WORLD_R, WATER } from './config.js';
import { makeName, composeName } from './names.js';
import { NavGrid } from './nav.js';
import { makeOmen } from './astrology.js';

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
const DEFAULT_PERSONA = { warmth: 1, food: 1, company: 1, rest: 1, beauty: 1, strength: 1, perception: 1, generosity: 1 };
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
    generosity: v(0.4, 1.6), // willingness to give food away freely (see sharing)
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
const FIRE_SHY_R  = 1.15;    // the no-step core of a lit fire — nobody walks through the blaze
const FIRE_SHY_REACH = 1.8;  // distance at which a walker starts steering around the flame
const FIRE_CLEAR  = 5.0;     // min clearance a hearth keeps from a trunk (trees are flammable; 5 clears redwood canopies)
const MAX_FIRE_SPREAD = 1.1; // max height range over a 2.5m ring before ground's too steep to lay a hearth
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
const FIRE_WARMTH_RATE  = 0.30; // warmth need drained per second while seated at fire
const FIRE_COMPANY_RATE = 0.24; // company need drained per second (scaled by crowd + gathering)
const FIRE_REST_RATE    = 0.18; // rest need drained per second while seated
const BUILD_TIME  = 6;       // seconds to lay a hearth as a ritual: ring stones, lay wood, kindle

// boats (docs/boats.md): NPCs ferry across the water rather than truly navigating
// it. When the urge takes an unpressed soul by daylight, they walk to a free boat,
// glide it in a straight line to a far shore, and step off — a "ferry abstraction"
// that needs no amphibious pathfinding. The boat is left moored where they land
// (communal drift). See Brain.maybeFerry / planCrossing / ferryStep.
const FERRY_SPD      = 2.6;  // boat glide speed while crossing (world units/sec)
const FERRY_MINCROSS = 14;   // a crossing must span at least this much open water to be worth it
const FERRY_REACH    = 55;   // how far someone will walk to reach a free boat
const FERRY_CD       = [25, 60];   // seconds between one person's ferry urges
const FERRY_CALM     = 0.72; // only ferry when no survival need is past this (not while desperate)
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
const COOK_KINDS = new Set(['roots', 'acorns', 'cattail root', 'morels', 'meat']);
export const needsCooking = (kind) => COOK_KINDS.has(kind);
const COOK_TIME  = 22;      // seconds a potful takes to become edible
const COOK_BIAS  = 1.0;     // pull toward taking raw food to the pot
const POT_CAP    = 12;      // raw units a pot holds at once
const STEW_SATIETY  = 0.34; // hunger one cooked portion from the pot relieves (a hearty meal)
const POT_EAT_RANGE = 3.5;  // how close you must be to the pot to eat from it
const SUP_BIAS      = 1.6;  // pull, when hungry & empty-handed, toward a pot with ready stew
// a stew's name, by its main ingredient (for the look-at description)
const DISH_NAME = { mushrooms: 'mushroom stew', morels: 'morel stew', roots: 'root stew',
  acorns: 'acorn porridge', 'cattail root': 'cattail broth', meat: 'rabbit stew' };
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
  // reputation & omens linger far longer than a fleeting sighting
  for (const [k, f] of m) if (now - f.t > (f.kind === 'kind' || f.kind === 'omen' ? NEWS_TTL * 5 : NEWS_TTL)) m.delete(k);
  const over = m.size - NEWS_MAX;            // past the cap, shed the least valuable first
  if (over > 0){ const low = [...m.entries()].sort((a, b) => NEWS_RANK(a[1]) - NEWS_RANK(b[1]) || a[1].t - b[1].t);
    for (let i = 0; i < over; i++) m.delete(low[i][0]); }
}
// rank facts for sharing/telling: reputation and food tips are worth more than the
// constant churn of "who I just saw" (sightings refresh to `now` every frame, so by
// freshness alone they'd drown everything else out).
const NEWS_RANK = f => (f.kind === 'omen' ? 3 : f.kind === 'kind' ? 2 : f.kind === 'food' ? 1 : 0);
const STARGAZER_CHANCE = 0.25;   // a quarter of folk read the stars (form & spread omens)
const OMEN_CD = [40, 100];       // seconds between an astrologer forming a fresh omen
// copy the choicest few facts from one person to another (no telling someone of themselves)
function shareNews(from, to){
  if (!from.news) return;
  const fresh = [...from.news.values()].sort((x, y) => NEWS_RANK(y) - NEWS_RANK(x) || y.t - x.t);
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

// sharing & reciprocity (the levelling ethic of forager bands — see docs/sharing.md).
// A hungry, empty-handed soul asks a well-provisioned neighbour for food, and the
// generous give it freely (no payment). Kin share most readily; refusal among kin
// is near-unthinkable. Giving wins esteem (carried by gossip); hoarding past plenty
// while kin go hungry costs it. Standing, not stuff, is the real wealth.
const SHARE_BIAS   = 1.25;   // pull toward asking a neighbour for food when hungry
const SHARE_RANGE  = 14;     // how far an asker will go to a likely giver
const SHARE_QTY    = 2;      // rations handed over in a gift
const SHARE_KEEP   = 2;      // rations a giver keeps for themselves
const GIVE_ESTEEM  = 1.0;    // standing gained by an act of giving
const HOARD_PENALTY= 0.05;   // esteem/s lost hoarding a full pack near hungry kin
const KIN_FREELY   = 0.55;   // generosity floor among kin (they give almost regardless)

// fauna & hunting (docs/hunting.md). Rabbits roam, flee, and leave faint tracks; a
// hungry hunter stalks one and, with luck and a keen eye, catches it — a meat
// windfall that flows through the pot and the sharing-out (meat is a COOK_KIND).
const FAUNA_N      = 12;        // rabbits afoot at once
const FLEE_R       = 7;         // how near a threat comes before a rabbit bolts
const RAB_WANDER   = 0.9;       // grazing pace
const RAB_FLEE     = 1.9;       // bolting pace (just over a walker's 1.6 — hard but catchable)
const RAB_RESPAWN  = [30, 70];  // seconds before a caught rabbit reappears elsewhere
const HUNT_SIGHT   = 16;        // how far a hungry hunter spots quarry
const HUNT_BIAS    = 1.1;       // pull toward the chase
const CATCH_RANGE  = 1.8;       // close enough to pounce
const CATCH_CD     = 1.1;       // seconds between pounce attempts
const CATCH_CHANCE = 0.45;      // base capture chance per pounce (scaled by the hunter's skill)
const MEAT_YIELD   = 5;         // raw meat from one rabbit (cooked into a shared stew)

// valuables: rare non-utilitarian finds (shells, stones, amber, quartz) people
// pick up for their own worth and spend as trade currency. Gathered opportunist-
// ically — a weak pull, so survival always wins — and capped so packs don't bulge.
const COLLECT_BIAS  = 0.5;   // mild curiosity pull toward a nearby valuable
const COLLECT_RANGE = 14;    // we won't trek far out of our way for a trinket
const TRINKET_MAX   = 8;     // how many a person will carry
const FLOWER_RANGE  = 35;    // how far an elf will walk to pick a flower
const FLOWER_BIAS   = 1.4;   // strong enough to win from ~35 units at avg beauty
const FLOWER_MAX    = 7;     // flowers needed to complete a crown

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ---------------------------------------------------------------- flame texture
// A soft teardrop flame on a transparent card, drawn once and reused (additive).
// A soft, mostly-white teardrop (a luminance mask, hot at the base, feathered to
// nothing at the pointed tip). It carries little colour of its own so each flame
// layer can be TINTED — orange body, amber middle, white-hot core — via the
// material colour and combined additively. Drawn taller than wide for an upward lick.
function flameTexture(){
  const w = 32, h = 56, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(w/2, h*0.74, 1, w/2, h*0.62, h*0.66);
  grad.addColorStop(0.0,  'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,250,235,0.92)');
  grad.addColorStop(0.66, 'rgba(255,225,195,0.42)');
  grad.addColorStop(1.0,  'rgba(255,200,170,0)');
  g.fillStyle = grad;
  g.beginPath();                                   // teardrop: round base, pointed top
  g.moveTo(w/2, 1);
  g.quadraticCurveTo(w*0.99, h*0.52, w*0.5, h*0.98);
  g.quadraticCurveTo(w*0.01, h*0.52, w/2, 1);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;   // crisp, no blur (matches the game)
  t.generateMipmaps = false;
  return t;
}
let FLAME_TEX = null;
const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// a grainy ash/charcoal disc for the fire pit — speckled greys with a few ember
// flecks, and a soft radial alpha so the scorch fades into grass at the rim
// instead of ending on a hard circle (it's mapped onto the draped ground patch).
function pitTexture(){
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, s, s);
  // scorched earth: charred black at the heart, baked & reddened soil around it,
  // singed ash-grey toward the rim — the burn fades out into the ground.
  const base = g.createRadialGradient(s/2, s/2, s*0.04, s/2, s/2, s*0.5);
  base.addColorStop(0.0,  '#100c09');   // charred black centre
  base.addColorStop(0.32, '#251a12');   // dark char
  base.addColorStop(0.58, '#3c2417');   // baked, reddened earth ring
  base.addColorStop(0.82, '#4a4036');   // singed soil & ash
  base.addColorStop(1.0,  '#564b41');   // scorched dirt, blending out
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  // grit: pale ash dust, black charcoal flecks, a scatter of ember sparks
  for (let i = 0; i < 1600; i++){
    const x = Math.random() * s, y = Math.random() * s, b = Math.random();
    g.fillStyle = b < 0.5 ? `rgba(${150 + Math.random()*40|0},${142 + Math.random()*36|0},128,${0.10 + Math.random() * 0.35})`
      : b < 0.86 ? `rgba(12,10,8,${0.3 + Math.random() * 0.55})`
      : `rgba(${190 + Math.random() * 55 | 0},${70 + Math.random() * 45 | 0},25,${0.2 + Math.random() * 0.4})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // fade the alpha out toward the edge (keep RGB, mask the disc round + soft)
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createRadialGradient(s/2, s/2, s*0.18, s/2, s/2, s*0.5);
  grad.addColorStop(0,   'rgba(0,0,0,1)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;   // crisp, no blur
  return t;
}
let PIT_TEX = null;

// The scorched ground under a hearth, built as a small mesh that DRAPES over the
// real heightfield: every vertex's Y is sampled from height(), so it lies flush
// on any slope instead of a flat disc that cuts into the hill on one side and
// floats on the other. It sits just ABOVE the ground (we can't carve a recess into
// the coarse terrain — anything dug below it would be hidden by the terrain mesh —
// so the pit's depth is read from the ash & coals heaped on top, not a dug bowl).
// Y is relative to the hearth origin (cx,cz) so the mesh parents straight onto the
// campfire group. UVs are a top-down planar projection, so the pit texture's soft
// round edge handles the blend into grass.
const PATCH_LIFT = 0.03;
function groundPatch(cx, cz, r){
  const RINGS = 4, SPOKES = 18;
  const h0 = height(cx, cz);
  const pos = [], uv = [], idx = [];
  pos.push(0, PATCH_LIFT, 0); uv.push(0.5, 0.5);            // centre
  for (let ri = 1; ri <= RINGS; ri++){
    const f = ri / RINGS, rr = r * f;
    for (let si = 0; si < SPOKES; si++){
      const a = si / SPOKES * Math.PI * 2;
      const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
      pos.push(dx, height(cx + dx, cz + dz) - h0 + PATCH_LIFT, dz);   // drape on the surface
      uv.push(0.5 + Math.cos(a) * f * 0.5, 0.5 + Math.sin(a) * f * 0.5);
    }
  }
  for (let si = 0; si < SPOKES; si++){                       // centre fan (up-facing winding)
    const a = 1 + si, b = 1 + (si + 1) % SPOKES;
    idx.push(0, b, a);
  }
  for (let ri = 0; ri < RINGS - 1; ri++){                    // ring quads
    const base = 1 + ri * SPOKES, next = base + SPOKES;
    for (let si = 0; si < SPOKES; si++){
      const ia = base + si, ib = base + (si + 1) % SPOKES;
      const oa = next + si, ob = next + (si + 1) % SPOKES;
      idx.push(ia, ob, oa, ia, ib, ob);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ map: PIT_TEX, color: 0xffffff,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(geo, mat);
}

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
  if (ty !== 'grass') return -1;                           // grass only — no swamp, water, sand or rock hearths
  const ls = ringSpread(x, z, 2.5);
  if (ls > MAX_FIRE_SPREAD) return -1;                     // too steep — a hillside
  let count = 0, nearest = Infinity;                       // actual trees nearby
  for (const t of trees){ const d = Math.hypot(x - t[0], z - t[1]); if (d < 9) count++; if (d < nearest) nearest = d; }
  if (nearest < FIRE_CLEAR) return -1;                     // too near a trunk — trees catch fire
  const h0 = height(x, z);
  let maxRise = -Infinity;                                 // tallest nearby side (a windbreak)
  for (let k = 0; k < 8; k++){ const a = k/8 * Math.PI*2; maxRise = Math.max(maxRise, height(x + Math.cos(a)*10, z + Math.sin(a)*10) - h0); }
  const flat = clamp01(1 - ls / MAX_FIRE_SPREAD);
  const open = clamp01(1 - count / 8);                     // few trees within 9u => clearing
  const windbreak = clamp01(maxRise / 4);
  const dist = Math.hypot(x - cx, z - cz);
  return 0.40 * flat + 0.35 * open + 0.25 * windbreak - 0.004 * dist;
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
  constructor(world, x, z, { built = true } = {}){
    this.world = world;
    // `built` 0..1 — a hearth raised as a ritual starts at 0 (bare ground) and is
    // laid up in stages (stones, wood, kindling) by its builder; see raise(). One
    // spawned ready (the default) starts finished and alight.
    this.built = built ? 1 : 0;
    this.x = x; this.z = z;
    this.ringR = 2.3;        // base radius of the sitting circle
    this.seatArc = 1.15;     // comfortable arc spacing between neighbours (intimate)
    this.arrive = 0.6;       // how close a seat counts as "arrived"
    this.slots = new Map();  // npc -> ring angle
    this.flicker = 1;
    this.fuel = built ? 0.7 : 0;          // the live flame; an unbuilt hearth isn't lit yet
    this.woodpile = built ? WOOD_START : 0;  // logs stacked nearby — laid as the build finishes
    this.idleT = 0;          // seconds it has burned with nobody near (then it's damped)
    this.embers = [];        // glowing flecks on the ash, pulsing with the flame

    FLAME_TEX ||= flameTexture();
    PIT_TEX ||= pitTexture();
    const g = new THREE.Group();
    g.position.set(x, height(x, z), z);

    // A hearth is built UP and let DOWN by adding/removing pieces — stones to the
    // ring, sticks to the wood — not by scaling (that looked rubbery). We lay the
    // full set once and reveal as many as the gathering warrants (see update). The
    // reveal order is spread by the golden angle so the ring fills evenly, not one
    // side first. No two fires are laid the same (style + scatter vary).
    const rnd = Math.random;
    this.style = ['teepee', 'cabin', 'pile'][Math.floor(rnd() * 3)];
    this.fireLevel = 0;                                   // 0..1, eased toward attendance
    const S = this.structure = new THREE.Group();
    g.add(S);
    const GOLD = 2.399963;

    // fire pit: the scorched ground itself, draped over the real slope (always
    // shown). Not a flat disc — it follows the hill — and a touch wider than the
    // stone ring, so the char haloes out past it.
    const h0 = height(x, z);
    const PIT_R = 1.35;
    S.add(groundPatch(x, z, PIT_R));
    // local Y just above the scorched ground at an offset — so the ash, charcoal,
    // coals and stones rest ON it (and follow the slope) rather than hovering flat.
    const floorY = (dx, dz) => height(x + dx, z + dz) - h0 + PATCH_LIFT + 0.01;

    // The bed of the pit, built the way a real one settles: a soft layer of grey
    // ASH (mounded, not flat), angular black CHARCOAL chunks half-sunk in it, and
    // glowing COALS nestled low among them — hottest at the heart, cooling outward.
    // Ash + charcoal are always there (a hearth carries its leavings); the coals
    // are revealed by fireLevel and pulse with the flame (see update).

    // ash: low irregular mounds, paler at the rim, settling toward the centre
    for (let i = 0, n = 22 + (rnd() * 10 | 0); i < n; i++){
      const a = rnd() * Math.PI*2, r = Math.pow(rnd(), 0.7) * 0.9;        // denser toward middle
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const g = 0.30 + rnd() * 0.28 + 0.12 * (r / 0.9);                   // darker centre, paler edge
      const ash = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05 + rnd() * 0.07),
        new THREE.MeshLambertMaterial({ color: new THREE.Color(g, g * 0.96, g * 0.9) }));
      ash.position.set(dx, floorY(dx, dz) + 0.01, dz);
      ash.scale.set(1 + rnd() * 0.5, 0.35 + rnd() * 0.25, 1 + rnd() * 0.5);  // flattened, settled
      ash.rotation.set(rnd()*3, rnd()*3, rnd()*3); S.add(ash);
    }
    // charcoal: charred chunks & burnt log-ends, angular and dark, half-buried
    const charMat = new THREE.MeshLambertMaterial({ color: 0x1c1815 });
    for (let i = 0, n = 7 + (rnd() * 4 | 0); i < n; i++){
      const a = rnd() * Math.PI*2, r = rnd() * 0.62;
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const ch = new THREE.Mesh(new THREE.DodecahedronGeometry(0.07 + rnd() * 0.09), charMat);
      ch.position.set(dx, floorY(dx, dz), dz);                            // resting in the ash, bottoms buried
      ch.scale.set(1 + rnd() * 0.8, 0.5 + rnd() * 0.4, 1 + rnd() * 0.8);
      ch.rotation.set(rnd()*3, rnd()*3, rnd()*3); S.add(ch);
    }
    // coals: glowing chunks low in the bed; each remembers its heat (hot at centre)
    // and a flicker phase, so the bed shimmers unevenly rather than pulsing as one.
    for (let i = 0; i < 14; i++){
      const a = rnd() * Math.PI*2, r = Math.pow(rnd(), 1.4) * 0.55;       // clustered at the heart
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const em = new THREE.Mesh(new THREE.DodecahedronGeometry(0.035 + rnd() * 0.05),
        new THREE.MeshBasicMaterial({ color: 0xff7a2a, fog: false }));
      em.position.set(dx, floorY(dx, dz) + 0.005, dz);                   // nestled among the char
      em.rotation.set(rnd()*3, rnd()*3, rnd()*3);
      em._heat = clamp01(1 - r / 0.55) * (0.6 + rnd() * 0.4);             // centre = hottest
      em._ph = rnd() * Math.PI * 2;
      S.add(em); this.embers.push(em);
    }
    // stones — a full ring laid down, revealed in an even spread (ring fills, not one side)
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a8a86 });
    this.stones = [];
    for (let i = 0; i < 11; i++){
      const a = i * GOLD, r = 0.9 + rnd() * 0.07;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + rnd() * 0.1), stoneMat);
      // sit each stone on the actual ground at its spot, so the ring rides the
      // contour around the bowl rather than hovering at one flat height.
      s.position.set(dx, height(x + dx, z + dz) - h0 + 0.07 + rnd() * 0.06, dz);
      s.rotation.set(rnd()*3, rnd()*3, rnd()*3); S.add(s); this.stones.push(s);
    }
    // the wood, in this fire's style — laid to its largest, revealed stick by stick
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    this.logs = [];
    // each log records `_top`, roughly how high it reaches, so a pot set over the
    // fire can hide the fuel that would otherwise poke up through it (see update).
    if (this.style === 'teepee'){                         // sticks leaning into a cone
      for (let i = 0; i < 7; i++){
        const a = i * GOLD;
        const log = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), logMat);
        log.position.set(Math.cos(a)*0.22, 0.42, Math.sin(a)*0.22);
        log.rotation.z = Math.cos(a)*0.5; log.rotation.x = -Math.sin(a)*0.5;
        log._top = 0.84;                                   // tall sticks converging up top
        S.add(log); this.logs.push(log);
      }
    } else if (this.style === 'cabin'){                   // crisscrossed log-cabin stack (revealed layer by layer)
      for (let layer = 0; layer < 3; layer++){
        const horiz = layer % 2 === 0, y = 0.1 + layer * 0.16;
        for (const off of [-0.22, 0.22]){
          const log = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 0.75 : 0.12, 0.12, horiz ? 0.12 : 0.75), logMat);
          log.position.set(horiz ? 0 : off, y, horiz ? off : 0); log._top = y + 0.06;
          S.add(log); this.logs.push(log);
        }
      }
    } else {                                              // a rough pile of logs lying flat
      for (let i = 0; i < 6; i++){
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), logMat);
        log.rotation.z = Math.PI/2; log.rotation.y = rnd() * Math.PI;
        log.position.set((rnd()-0.5)*0.35, 0.08 + i * 0.035, (rnd()-0.5)*0.35);
        log._top = 0.08 + i * 0.035 + 0.07;
        S.add(log); this.logs.push(log);
      }
    }
    // flame: nested crossed billboards (reads from any angle) — a deep-orange
    // body, an amber middle and a white-hot core — with small licking tongues and
    // rising sparks. Each part is given its own phase so the fire DANCES (sways,
    // leans, stretches, brightens out of step) rather than pulsing as one blob.
    const mkFlameMat = (hex, op) => new THREE.MeshBasicMaterial({
      map: FLAME_TEX, color: hex, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.flame = new THREE.Group();
    this.flameParts = [];
    const LAYERS = [
      { w: 0.92, h: 1.30, hex: 0xff4a12, op: 0.80 },   // outer body, deep orange (tallest)
      { w: 0.60, h: 0.98, hex: 0xff9a2a, op: 0.95 },   // amber middle
      { w: 0.34, h: 0.66, hex: 0xfff2c4, op: 1.00 },   // white-hot core (lowest, brightest)
    ];
    for (const ly of LAYERS){
      const mat = mkFlameMat(ly.hex, ly.op);
      const part = new THREE.Group();
      for (let i = 0; i < 2; i++){                       // crossed pair, omni-directional
        const q = new THREE.Mesh(new THREE.PlaneGeometry(ly.w, ly.h), mat);
        q.rotation.y = i * Math.PI / 2; q.position.y = ly.h / 2;
        part.add(q);
      }
      part._ph = rnd() * Math.PI * 2; part._mat = mat; part._rgb = hexRGB(ly.hex);
      this.flame.add(part); this.flameParts.push(part);
    }
    // licking tongues: small flames around the heart that wave and duck in and out
    this.tongues = [];
    for (let i = 0; i < 4; i++){
      const mat = mkFlameMat(0xffb648, 0.85);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.5), mat);
      const a = rnd() * Math.PI * 2;
      q.position.set(Math.cos(a) * 0.18, 0.85 + rnd() * 0.3, Math.sin(a) * 0.18);
      q.rotation.y = rnd() * Math.PI;
      q._ph = rnd() * Math.PI * 2; q._mat = mat; q._baseY = q.position.y;
      this.flame.add(q); this.tongues.push(q);
    }
    // sparks: tiny embers that rise from the heart, drift out and wink out, then respawn
    this.sparks = [];
    for (let i = 0; i < 6; i++){
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp._t = rnd(); sp._a = rnd() * Math.PI * 2; sp._r = 0.05 + rnd() * 0.12; sp._spd = 0.55 + rnd() * 0.5;
      this.flame.add(sp); this.sparks.push(sp);
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
    // sit it on the ground at its OWN offset, not the fire's centre height, so it
    // doesn't float/sink on a slope (h0 is the hearth-centre height).
    this.basket.position.set(1.7, height(x + 1.7, z + 0.4) - h0, 0.4); this.basket.visible = false;
    g.add(this.basket);

    // the cooking pot: a dark cauldron held over the flames, holding whatever raw
    // ingredients are simmering. Hidden (with its support) when nothing's cooking.
    // How it's HELD is varied per hearth, so fires don't all look alike:
    //  · 'rocks'  — the cauldron balanced low on three stout hearth-stones
    //  · 'tripod' — slung from a lashed tripod of sticks over the flames
    //  · 'spit'   — hung from a crossbar resting on two forked uprights
    this.pot = { raw: 0, ready: 0, kind: null, cook: 0 };   // raw units simmering, cooked portions waiting, ingredient, simmer seconds
    this.potGroup = new THREE.Group();
    const potMat  = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
    const cookWoodMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    const cookStoneMat = new THREE.MeshLambertMaterial({ color: 0x807d77 });
    this.cookStyle = ['rocks', 'tripod', 'spit'][Math.floor(rnd() * 3)];
    let potY;                                               // height of the cauldron's belly centre
    if (this.cookStyle === 'rocks'){
      potY = 0.26;                                          // sits low, cradled by the stones
      for (let i = 0; i < 3; i++){
        const a = i / 3 * Math.PI*2 + rnd();
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.05), cookStoneMat);
        st.position.set(Math.cos(a) * 0.28, 0.11, Math.sin(a) * 0.28);
        st.scale.y = 0.85; st.rotation.set(rnd()*3, rnd()*3, rnd()*3);
        this.potGroup.add(st);
      }
    } else if (this.cookStyle === 'tripod'){
      potY = 0.52; const apex = 1.18;
      for (let i = 0; i < 3; i++){
        const a = i / 3 * Math.PI*2 + 0.3;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.04, 1.32, 5), cookWoodMat);
        leg.position.set(Math.cos(a) * 0.42, apex * 0.5, Math.sin(a) * 0.42);   // foot splayed out, top to the apex
        leg.rotation.z = -Math.cos(a) * 0.33; leg.rotation.x = Math.sin(a) * 0.33;
        this.potGroup.add(leg);
      }
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, apex - potY - 0.12, 4), potMat);
      hook.position.y = (apex + potY + 0.04) / 2; this.potGroup.add(hook);    // a short chain to the rim
    } else {                                                // spit
      potY = 0.5; const barY = 0.9;
      for (let s = -1; s <= 1; s += 2){
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, barY + 0.12, 5), cookWoodMat);
        up.position.set(s * 0.52, (barY + 0.12) / 2, 0); up.rotation.z = -s * 0.12;
        this.potGroup.add(up);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), cookWoodMat);
      bar.rotation.z = Math.PI/2; bar.position.y = barY; this.potGroup.add(bar);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, barY - potY - 0.12, 4), potMat);
      hook.position.y = (barY + potY + 0.04) / 2; this.potGroup.add(hook);
    }
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI*2, 0, Math.PI*0.62), potMat);
    belly.scale.y = 0.8; belly.position.y = potY;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 16), potMat);
    rim.rotation.x = Math.PI/2; rim.position.y = potY + 0.16;
    // fuel reaching above here would clip up into the cauldron, so it's hidden
    // while the pot is set (you cook over coals, not a standing stack of sticks).
    this._potClear = potY - 0.12;
    // the broth surface — coloured by the dish, bubbles gently while cooking
    this._brothY = potY + 0.14;
    this.potBroth = new THREE.Mesh(new THREE.CircleGeometry(0.25, 14),
      new THREE.MeshLambertMaterial({ color: 0x6b5230 }));
    this.potBroth.rotation.x = -Math.PI/2; this.potBroth.position.y = this._brothY;
    this.potGroup.add(belly); this.potGroup.add(rim); this.potGroup.add(this.potBroth);
    this.potGroup.position.set(0, 0, 0); this.potGroup.visible = false;
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
    // ground the stack at its own offset so it rests on the slope, not floating
    // off the hearth-centre height.
    this.woodpileGroup.position.set(-1.6, height(x - 1.6, z + 0.5) - h0, 0.5);
    g.add(this.woodpileGroup);
    this._refreshWoodpile();

    this.group = g;
  }

  get lit(){ return this.fuel > 0; }
  get done(){ return this.built >= 1; }
  // advance the building RITUAL by dt (called while the builder works at the site).
  // The hearth is laid up in stages — hearthstones first (reveal keys off `built`
  // in update), then the wood, and past 0.6 the kindling catches and the flame
  // grows in. Returns true once it stands finished & alight.
  raise(dt){
    if (this.built >= 1) return true;
    if (dt > 0) this.built = Math.min(1, this.built + dt / BUILD_TIME);
    if (this.built >= 0.6) this.fuel = Math.max(this.fuel, ((this.built - 0.6) / 0.4) * 0.7);  // kindle
    return this.built >= 1;
  }
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
    if (!this.done) return this.built < 0.3 ? "A ring of hearthstones, half-laid — someone is building a fire here."
      : this.built < 0.6 ? "A hearth taking shape — the wood is being stacked."
      : "Fresh-laid kindling, just catching — the fire is being raised.";
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
    npc.needs.warmth  = clamp01(npc.needs.warmth  - FIRE_WARMTH_RATE  * dt);
    npc.needs.company = clamp01(npc.needs.company - FIRE_COMPANY_RATE * dt * social * gather);
    npc.needs.rest    = clamp01(npc.needs.rest    - FIRE_REST_RATE    * dt);
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
    const fuelSize = Math.min(1, this.fuel * 2.5);        // flame shrinks as fuel runs low

    // the hearth is built up / let down by ADDING & REMOVING pieces (not scaling):
    // a lone fire is a few stones and sticks, a gathering has a full ring and a
    // proper stack. The level eases (so pieces don't flicker on/off at the margin).
    let near = 0;
    for (const n of this.world.npcs) if (Math.hypot(n.x - this.x, n.z - this.z) < this.ringR + 1.5) near++;
    this.fireLevel += (Math.min(1, near / 6) - this.fireLevel) * Math.min(1, dt * 0.4);
    const L = this.fireLevel;
    const B = this.built;     // < 1 while the build ritual is still laying the hearth
    // while building, pieces appear in order — hearthstones (stage 1), then the wood
    // (stage 2) — driven by build progress; once finished, by the gathering's size.
    const styleMaxLogs = this.style === 'cabin' ? 6 : this.style === 'teepee' ? 7 : 6;
    const styleFullLogs = this.style === 'cabin' ? (1 + Math.round(L * 2)) * 2   // 1–3 layers
      : this.style === 'teepee' ? 3 + Math.round(L * 4) : 2 + Math.round(L * 4);
    const nStones = B < 1 ? Math.round(5 * clamp01(B / 0.30)) : 5 + Math.round(L * 6);
    for (let i = 0; i < this.stones.length; i++) this.stones[i].visible = i < nStones;
    const nLogs = B < 1 ? Math.round(styleMaxLogs * clamp01((B - 0.25) / 0.35)) : styleFullLogs;
    // when a pot is set over the fire, hide fuel that would poke up into it —
    // cooking happens over the coals, with the tall stack burnt down.
    const potted = (this.pot.raw + this.pot.ready) > 0;
    for (let i = 0; i < this.logs.length; i++)
      this.logs[i].visible = i < nLogs && !(potted && this.logs[i]._top > this._potClear);
    const nEmber = 4 + Math.round(L * 10);     // a lone fire glows with a few coals; a big one, a full bed

    // the flame itself is fluid, so it may grow with the wood (eased L) — that reads
    // natural, unlike scaling the stones. Light reach follows it.
    const sz = fuelSize * (0.7 + 0.9 * L);
    this.flame.visible = this.lit;
    this.light.intensity = (1.8 + 1.4 * f) * sz;
    this.light.distance = 11 + 8 * L;                     // a big fire throws light further
    // cap flame height to just below the pot base when cooking (pot visible = potted);
    // 1.30 is the outer billboard layer height. This keeps flame under the cauldron.
    const flameH = potted ? this._potClear / 1.30 : sz;
    this.flame.scale.set(sz, flameH, sz);                 // overall size; the dance is per-part below

    if (this.lit){
      this._ft = (this._ft || 0) + dt;
      const t = this._ft;
      // each nested body layer waves on its own phase: lean, side-sway, vertical
      // stretch and a brightness pulse — all out of step, so the fire flickers alive.
      for (const part of this.flameParts){
        const ph = part._ph;
        part.scale.y = 1 + 0.24 * Math.sin(t * 7 + ph) * f;
        part.scale.x = 1 + 0.10 * Math.sin(t * 9 + ph * 1.3);
        part.rotation.z = 0.10 * Math.sin(t * 5 + ph);
        part.position.x = 0.05 * Math.sin(t * 6 + ph * 1.7);
        const b = 0.6 + 0.55 * f;
        part._mat.color.setRGB(part._rgb[0] * b, part._rgb[1] * b, part._rgb[2] * b);
      }
      // tongues lick upward and occasionally duck out of sight
      for (const q of this.tongues){
        const ph = q._ph, s = 0.5 + 0.5 * Math.sin(t * 8 + ph);
        q.visible = Math.sin(t * 3 + ph) > -0.35;
        q.scale.y = 0.7 + 0.7 * s;
        q.position.y = q._baseY + 0.14 * s;
        q.rotation.z = 0.28 * Math.sin(t * 6 + ph);
        const b = 0.55 + 0.6 * f;
        q._mat.color.setRGB(b, b * 0.68, b * 0.22);
      }
      // sparks ride up from the heart, drift outward and fade, then respawn at the base
      const sparking = this.fuel > 0.25;
      for (const sp of this.sparks){
        sp._t += dt * sp._spd;
        if (sp._t > 1){ sp._t -= 1; sp._a = Math.random() * Math.PI * 2; sp._r = 0.05 + Math.random() * 0.12; sp._spd = 0.55 + Math.random() * 0.5; }
        const life = sp._t, fade = 1 - life;
        sp.visible = sparking;
        sp.position.set(Math.cos(sp._a) * sp._r * (1 + life * 1.5), 0.7 + life * 1.5, Math.sin(sp._a) * sp._r * (1 + life * 1.5));
        sp.material.color.setRGB(fade, fade * 0.55, fade * 0.12);
        sp.scale.setScalar(0.5 + 0.9 * fade);
      }
    }
    // the coal bed: each coal glows around its own heat (hot at the heart) with its
    // own flicker, so the bed shimmers unevenly — deep red at the edge, near
    // white-orange at the centre — and fades to black when the fire is out.
    const eg = this.lit ? 0.45 + 0.5 * f : 0;
    const ct = this._ft || 0;
    for (let i = 0; i < this.embers.length; i++){
      const em = this.embers[i];
      em.visible = this.lit && i < nEmber;
      if (!em.visible) continue;
      const flick = 0.78 + 0.22 * Math.sin(ct * 4 + em._ph);
      const v = clamp01(eg * em._heat * flick + 0.06);
      em.material.color.setRGB(Math.min(1, 0.55 + v * 0.7), v * v * 0.7, v * v * v * 0.3);
    }

    // simmer the pot — only over a live flame. When done, the raw turns to ready
    // portions that sit in the pot to be eaten from (not tipped into the cache).
    if (this.pot.raw > 0 && this.lit && dt > 0){
      this.pot.cook += dt;
      const bub = 0.5 + 0.5 * Math.sin(this._t = (this._t || 0) + dt * 6);  // gentle bubbling
      this.potBroth.position.y = this._brothY + bub * 0.015;
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

// ----------------------------------------------------------------------- fauna
// A rabbit: roams the meadow, bolts from anyone who comes near, and (when caught)
// yields meat. Pure x/z/state — no mesh — so the headless harness can run it; the
// browser draws it from these records (js/fauna.js). See docs/hunting.md.
class Quarry {
  constructor(world, x, z){
    this.world = world; this.x = x; this.z = z;
    this.heading = Math.random() * Math.PI * 2;
    this.alive = true; this.moving = false; this.fleeing = false;
    this.respawnT = 0; this._reT = 0; this._tx = x; this._tz = z;
  }
  _relocate(){
    for (let i = 0; i < 40; i++){
      const a = Math.random() * Math.PI * 2, r = Math.random() * WORLD_R * 0.85;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (walkable(x, z)){ this.x = this._tx = x; this.z = this._tz = z; return; }
    }
  }
  update(dt){
    if (!this.alive){ this.moving = false; this.respawnT -= dt; if (this.respawnT <= 0){ this._relocate(); this.alive = true; } return; }
    // nearest threat: any NPC, plus the registered player position (world.threat)
    let tx = null, tz = null, td = FLEE_R;
    for (const n of this.world.npcs){ const d = Math.hypot(n.x - this.x, n.z - this.z); if (d < td){ td = d; tx = n.x; tz = n.z; } }
    const pt = this.world.threat;
    if (pt){ const d = Math.hypot(pt.x - this.x, pt.z - this.z); if (d < td){ td = d; tx = pt.x; tz = pt.z; } }
    this.fleeing = tx !== null;
    let spd;
    if (this.fleeing){                                   // bolt directly away
      const a = Math.atan2(this.z - tz, this.x - tx);
      this._tx = this.x + Math.cos(a) * 6; this._tz = this.z + Math.sin(a) * 6; spd = RAB_FLEE;
    } else {                                             // graze: amble to nearby spots
      this._reT -= dt;
      if (this._reT <= 0){ const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
        this._tx = this.x + Math.cos(a) * r; this._tz = this.z + Math.sin(a) * r; this._reT = 2 + Math.random() * 4; }
      spd = RAB_WANDER;
    }
    const dx = this._tx - this.x, dz = this._tz - this.z, dist = Math.hypot(dx, dz);
    this.moving = false;
    if (dist > 0.2){
      const step = Math.min(spd * dt, dist);
      const nx = this.x + dx / dist * step, nz = this.z + dz / dist * step;
      if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){ this.heading = Math.atan2(dx, dz); this.x = nx; this.z = nz; this.moving = true; }
      else this._reT = 0;                                // hemmed in (water/edge) — pick a new way
    }
  }
  caught(){
    this.alive = false;
    this.respawnT = RAB_RESPAWN[0] + Math.random() * (RAB_RESPAWN[1] - RAB_RESPAWN[0]);
    this.world._caught = (this.world._caught || 0) + 1;
    return MEAT_YIELD;
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
    npc.flowerInventory = [];      // flower species IDs gathered toward a crown (female elves only)
    npc.hasCrown = false;          // crown made this session — stops further gathering
    // pathfinding: A* waypoints toward the goal (see followPath); reachability is
    // judged by actual progress, and goals we truly can't reach get blacklisted.
    this.path = null; this.pathI = 0; this.pgx = 0; this.pgz = 0; this.repathT = 0;
    this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;   // travel-progress sampler
    this._blacklist = new Map();   // Campfire -> seconds left ignored
    this._building = null;         // a hearth we're mid-ritual laying (commit until done)
    this._ferry = null;            // an active boat crossing (commit until landed) — see ferryStep
    this._ferryCd = FERRY_CD[0] + Math.random() * (FERRY_CD[1] - FERRY_CD[0]);
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

    npc._huntCd = (npc._huntCd || 0) - dt;   // cooldown between pounce attempts

    // astrology: a stargazer reads the night sky and forms a fresh omen now and
    // then — grounded in the real moon phase & house (astrology.js). It enters their
    // news and rides the gossip out to everyone, astrologer or not.
    if (npc.stargazer){
      npc._omenCd -= dt;
      if (w.night > 0.5 && npc._omenCd <= 0){
        npc._omenCd = OMEN_CD[0] + Math.random() * (OMEN_CD[1] - OMEN_CD[0]);
        const text = makeOmen({ moonLon: w.moonLon || 0, sunLon: w.sunLon || 0, illum: w.moonIllum || 0 });
        addNews(npc, { kind: 'omen', key: 'omen', text, x: npc.x, z: npc.z, t: w.time });
      }
    }

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

    // 1c. levelling: hoarding a full pack while a groupmate goes hungry — and being
    // too tight-fisted to share it — slowly erodes your standing (the "insult the
    // meat" social pressure made mechanical). Generous folk give instead (see choose).
    if ((npc.pack || 0) >= (npc.packMax || PACK_MAX) && (p.generosity || 1) < 1.0 && npc.group){
      for (const o of w.npcs){
        if (o !== npc && o.group === npc.group && (o.needs?.food || 0) > 0.6
            && Math.hypot(o.x - npc.x, o.z - npc.z) < SHARE_RANGE){
          npc.esteem = (npc.esteem || 0) - HOARD_PENALTY * dt; break;
        }
      }
    }

    // 2/3. an active ferry owns movement outright (walk to a boat → glide across →
    // step off the far bank); otherwise maybe begin one, else run the normal loop.
    this._ferryCd -= dt;
    if (!this._ferry && !this._building && this._ferryCd <= 0){
      this._ferryCd = FERRY_CD[0] + Math.random() * (FERRY_CD[1] - FERRY_CD[0]);
      this.maybeFerry();
    }
    if (this._ferry){ this.ferryStep(dt); }
    else {
    // 2. re-decide periodically (or if we have nothing). But a half-laid hearth is a
    // commitment — we stick with the ritual to the end rather than wandering off it.
    if (this._building && !this._building.done){
      const f = this._building;
      this.target = { kind: 'build', x: f.x, z: f.z, ref: f, tol: 2.0,
        satisfy: (a, d2) => this.buildRite(a, d2) };
    } else {
      this.decideT -= dt;
      if (this.decideT <= 0 || !this.target){
        this.decideT = 0.6 + Math.random() * 0.5;
        this.choose();
      }
    }

    // 3. act on the current target
    const t = this.target;
    if (!t){ npc.sitting = false; this.wanderStep(dt); this.path = null; }
    else {
      // only the sitting affordance claims a ring seat; tending actions (stoke/
      // fetch/store) just walk to the hearth itself with their own tolerance.
      const useSeat = !!t.sit && t.ref instanceof Campfire;
      const isHunt = t.ref instanceof Quarry;                 // a moving target — chase it live
      const goal = useSeat ? t.ref.seat(npc) : isHunt ? { x: t.ref.x, z: t.ref.z } : { x: t.x, z: t.z };
      const tol  = useSeat ? t.ref.arrive : (t.tol || 1.5);
      const d = Math.hypot(goal.x - npc.x, goal.z - npc.z);
      if (d > tol){
        npc.sitting = false;
        if (isHunt) this.moveTo(goal.x, goal.z, dt);          // direct pursuit in the open (no A* thrash)
        else this.followPath(goal.x, goal.z, dt);
        // stuck = travelled almost nowhere over a sample window (no route / wedged).
        // Position-based, so legitimately rounding a lake never reads as stuck.
        this._stuckSampleT -= dt;
        if (this._stuckSampleT <= 0){
          if (Math.hypot(npc.x - this._sx, npc.z - this._sz) < 1.2){   // gave up: maybe build our own
            if (this._building && t.ref === this._building){ w.removeFire(this._building); this._building = null; }   // abandon a half-laid hearth we can't reach
            else if (t.ref instanceof Campfire){ this._blacklist.set(t.ref, BLACKLIST_TIME); t.ref.release(npc); }
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
      if (this._blacklist.has(fire) || !fire.done) continue;   // skip unreachable & still-being-built hearths
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
      if (this._blacklist.has(f) || !f.done) continue;   // a half-built hearth isn't a camp yet
      const d = Math.hypot(f.x - npc.x, f.z - npc.z);
      if (d < homeD){ homeD = d; homeFire = f; }
      if (f.needsWood() && d < dd){ dd = d; lowFire = f; }
    }
    const haveReachableFire = !!homeFire;
    // any fire (including half-built) within this radius counts as "a hearth is forming here"
    const anyFireClose = w.fires.some(f => Math.hypot(f.x - npc.x, f.z - npc.z) < 30);

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
    } else if (!anyFireClose && ((n.warmth > 0.45 && !haveReachableFire) || (ev > 0.35 && farFromCamp))){
      // Stranded & cold, OR dusk is closing in and there's no camp within reach:
      // make our own. Gather an armful, then lay a hearth here and stack the wood.
      const want = Math.max(n.warmth, ev);
      if ((npc.firewood || 0) >= BUILD_LOGS)
        consider('build', npc.x, npc.z, {}, null, { tol: 2.0, bias: BUILD_BIAS * want,
          satisfy: (a, dt) => this.buildRite(a, dt) });   // laid as a ritual over several seconds
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
      if (this._blacklist.has(f) || !f.done) continue;   // ignore hearths still being raised
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
    if (n.food > 0.55 && pack === 0 && !storeFire && raw > 0 && !anyFireClose && !cookFire && (!campFire || cd > FAR_FROM_CAMP)){
      if ((npc.firewood || 0) >= BUILD_LOGS)
        consider('build', npc.x, npc.z, {}, null, { tol: 2.0, bias: BUILD_BIAS * n.food,
          satisfy: (a, dt) => this.buildRite(a, dt) });   // laid as a ritual over several seconds
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

    // demand-sharing: hungry and short of food, ask a well-stocked neighbour for some.
    // A gift, not a trade — no payment. Kin give almost regardless; others only if
    // open-handed. Giving wins esteem and word of the kindness enters the gossip.
    if (n.food > 0.45 && pack < SHARE_QTY){
      let giver = null, gd = SHARE_RANGE;
      for (const o of w.npcs){
        if (o === npc || (o.pack || 0) <= SHARE_KEEP) continue;
        const kin = o.group && o.group === npc.group;
        const gen = (o.persona && o.persona.generosity) || 1;
        if (!(kin ? gen >= KIN_FREELY : gen >= 1.1)) continue;     // willing to give?
        const d = Math.hypot(o.x - npc.x, o.z - npc.z);
        if (d < gd){ gd = d; giver = o; }
      }
      if (giver) consider('ask', giver.x, giver.z, {}, giver, { tol: 1.6, bias: SHARE_BIAS * n.food,
        satisfy: (a) => {
          if (Math.hypot(giver.x - a.x, giver.z - a.z) < 2.2 && (giver.pack || 0) > SHARE_KEEP){
            const give = Math.min(SHARE_QTY, giver.pack - SHARE_KEEP);
            giver.pack -= give; a.pack = (a.pack || 0) + give; a.packKind = a.packKind || giver.packKind;
            giver.esteem = (giver.esteem || 0) + GIVE_ESTEEM;
            // the kindness is witnessed: receiver, giver, and any onlookers note it,
            // seeding the reputation so gossip can carry it (see NEWS_RANK / pruneNews)
            const fact = { kind: 'kind', key: 'kind:' + giver.id, subj: giver, x: giver.x, z: giver.z, t: w.time };
            for (const o of w.npcs)
              if (o !== giver && Math.hypot(o.x - giver.x, o.z - giver.z) <= SIGHT_RANGE) addNews(o, { ...fact });
          }
          this.target = null;
        } });
    }

    // hunting: hungry, with quarry in sight → give chase. High variance — the
    // keen-eyed and strong catch more; many bolt clean away. A catch is raw meat,
    // which (a COOK_KIND) goes through the pot and is shared out — the great share.
    if (n.food > 0.5 && w.fauna.length){
      let q = null, qd = HUNT_SIGHT;
      for (const r of w.fauna){ if (!r.alive) continue; const d = Math.hypot(r.x - npc.x, r.z - npc.z); if (d < qd){ qd = d; q = r; } }
      if (q) consider('hunt', q.x, q.z, {}, q, { tol: CATCH_RANGE, bias: HUNT_BIAS * n.food * (p.perception || 1),
        satisfy: (a) => {
          if (!q.alive){ this.target = null; return; }
          if (Math.hypot(q.x - a.x, q.z - a.z) <= CATCH_RANGE + 0.4 && (a._huntCd || 0) <= 0){
            a._huntCd = CATCH_CD;
            if (Math.random() < CATCH_CHANCE * (p.perception || 1) * (0.7 + 0.3 * (p.strength || 1))){
              const meat = q.caught(); a.raw = (a.raw || 0) + meat; a.rawKind = 'meat'; this.target = null;
            }
            // else: missed — it's bolting now; chase on, or it gets away
          }
        } });
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

    // flower crown: female elves gather wildflowers toward a custom crown.
    // Gated by beautyGate so survival needs come first, scaled by the beauty trait.
    if (npc.gender === 'female' && npc.race === 'elf' && !npc.hasCrown &&
        (npc.flowerInventory?.length || 0) < FLOWER_MAX){
      let fl = null, fld = FLOWER_RANGE;
      for (const o of (w.flowers || [])){ if (!o.alive) continue; const d = Math.hypot(o.x - npc.x, o.z - npc.z); if (d < fld){ fld = d; fl = o; } }
      if (fl) consider('gather-flower', fl.x, fl.z, {}, fl, { tol: 1.3, bias: FLOWER_BIAS * p.beauty * clamp01(1 - 0.5 * surv),
        satisfy: (a) => {
          if (fl.alive){
            fl.remove();
            a.flowerInventory = a.flowerInventory || [];
            a.flowerInventory.push(fl.speciesId);
            if (a.flowerInventory.length >= FLOWER_MAX){
              if (w._onCrownMade) w._onCrownMade(a, [...a.flowerInventory]);
              a.flowerInventory = [];
              a.hasCrown = true;
            }
          }
          this.target = null;
        }
      });
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
    // give a LIT fire a wide berth: a no-step core so nobody walks through the
    // blaze, while the sitting ring (2.3) and the tend reach (~1.6) lie outside it,
    // so people can still gather round and feed it. Firmer push than a trunk.
    for (const fr of w.fires){
      if (!fr.lit) continue;
      const ox = npc.x - fr.x, oz = npc.z - fr.z;
      const d = Math.hypot(ox, oz) || 1e-3;
      if (d < FIRE_SHY_REACH){
        const push = (FIRE_SHY_REACH - d) / FIRE_SHY_REACH;
        sx += (ox/d) * push * 1.6; sz += (oz/d) * push * 1.6;       // radial: back away from the flame
        let tx = -oz/d, tz = ox/d;                                  // tangential: skirt around it
        if (tx*(gx-npc.x) + tz*(gz-npc.z) < 0){ tx = -tx; tz = -tz; }
        sx += tx * push; sz += tz * push;
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

  // the fire-building RITUAL — the satisfy for the 'build' affordance. The act loop
  // runs this each frame while we stand at the site. The first call raises a bare,
  // unlit hearth on fire-safe ground; each call advances the build (stones laid,
  // then the wood, then the kindling catches and the flame grows in). When it stands
  // finished & alight we stock it with the wood we hauled and the ritual ends.
  buildRite(a, dt){
    const w = this.world;
    if (!this._building) this._building = w.addCampfire(a.x, a.z, { refine: false, built: false });
    a.actionLabel = 'build';
    if (this._building.raise(dt)){
      this._building.addWood(a.firewood || 0); a.firewood = 0;   // the hauled armful becomes the woodpile
      this._building = null; this.target = null;
    }
  }

  // Decide whether to set off across the water. Only an unpressed soul by daylight
  // bothers; they claim the nearest free boat they can walk to and a far-shore
  // landing across open water, then commit to the crossing (see ferryStep).
  maybeFerry(){
    const npc = this.npc, w = this.world, n = npc.needs;
    if (!w.boats || !w.boats.length) return;
    if (w.night > 0.45) return;                          // nights are for the fireside
    const surv = Math.max(n.warmth, n.food, n.rest);
    if (surv > FERRY_CALM) return;                       // not while hungry / cold / weary
    let boat = null, bd = FERRY_REACH;
    for (const b of w.boats){
      if (b.aboard || b._claimed) continue;
      const d = Math.hypot(b.x - npc.x, b.z - npc.z);
      if (d < bd){ bd = d; boat = b; }
    }
    if (!boat) return;
    const plan = this.planCrossing(boat);
    if (!plan) return;
    const board = w.clearSpot(boat.x, boat.z);           // nearest dry land to step in from
    if (!board) return;
    boat._claimed = npc;
    this._ferry = { boat, phase: 'toBoat', board: { x: board[0], z: board[1] }, land: plan.land };
    npc.actionLabel = 'ferry';
    this.target = null; this.path = null;
  }

  // Cast rays out from the boat over the water; the first dry shore reached after
  // crossing enough open water is a landing. Returns { land:{x,z} } or null.
  planCrossing(boat){
    const w = this.world;
    for (let a = 0; a < 12; a++){
      const ang = Math.random() * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      let water = 0, landing = null;
      for (let r = 2; r <= 90; r += 2){
        const x = boat.x + c * r, z = boat.z + s * r;
        if (Math.hypot(x, z) > WORLD_R) break;
        const h = height(x, z);
        if (h < WATER){ water = r; continue; }                 // still over open water
        if (water >= FERRY_MINCROSS && h > WATER + 0.25){ landing = { x, z }; break; }   // far bank
        if (water === 0 && r > 6) break;                       // this heading runs straight onto land
      }
      if (landing){
        const spot = w.clearSpot(landing.x, landing.z);
        if (spot) return { land: { x: spot[0], z: spot[1] } };
      }
    }
    return null;
  }

  // Run the committed crossing. Phase 'toBoat': walk to the launch point, then step
  // in. Phase 'cross': glide the boat straight to the landing, then step ashore and
  // leave the boat moored at the far bank.
  ferryStep(dt){
    const npc = this.npc, w = this.world, F = this._ferry, boat = F.boat;
    npc.sitting = F.phase === 'cross'; this.path = null;

    if (F.phase === 'toBoat'){
      if (boat.aboard){ this.endFerry(); return; }       // the player took it first
      const d = Math.hypot(F.board.x - npc.x, F.board.z - npc.z);
      if (d > 1.6){
        this.followPath(F.board.x, F.board.z, dt);
        this._stuckSampleT -= dt;                         // give up if we can't reach the launch
        if (this._stuckSampleT <= 0){
          if (Math.hypot(npc.x - this._sx, npc.z - this._sz) < 1.2) this.endFerry();
          this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;
        }
      } else {                                            // step into the canoe
        npc.x = boat.x; npc.z = boat.z;
        boat.aboard = true;
        // seat the NPC on the gunwale; npc.js will switch to the sitting sprite
        // (if one exists) or clip the walk sprite's bottom half.
        npc.rideY = boat.deckY; npc._inBoat = true;
        F.phase = 'cross';
      }
    } else {                                              // cross
      let dx = F.land.x - boat.x, dz = F.land.z - boat.z;
      const dd = Math.hypot(dx, dz) || 1; dx /= dd; dz /= dd;
      const step = FERRY_SPD * dt;
      const nx = boat.x + dx * step, nz = boat.z + dz * step;
      npc.heading = Math.atan2(dx, dz);
      if (dd < 1.6){                                         // nosed up to the far bank → disembark
        const spot = w.clearSpot(F.land.x, F.land.z) || [F.land.x, F.land.z];
        npc.x = spot[0]; npc.z = spot[1]; npc.rideY = null; npc._inBoat = false;
        boat.aboard = false; boat._claimed = null;
        boat.placeAt(boat.x, boat.z, npc.heading);        // left moored where it grounded (communal drift)
        this.endFerry();
      } else {
        boat.placeAt(nx, nz, npc.heading);
        npc.x = nx; npc.z = nz;                            // ride along (not "walking": no wake of footsteps)
      }
    }
  }

  endFerry(){
    const F = this._ferry;
    if (F && F.boat){ if (F.boat._claimed === this.npc) F.boat._claimed = null; F.boat.aboard = false; }
    this.npc.rideY = null; this.npc.sitting = false; this.npc._inBoat = false;
    this._ferry = null; this.target = null; this.path = null;
  }

  wanderStep(dt){
    const npc = this.npc;
    this.wanderT -= dt;
    if (this.wanderT <= 0){ this.wanderH = Math.random() * Math.PI*2; this.wanderT = 2 + Math.random() * 4; }
    const spd = 1.2 * dt;
    const vx = Math.sin(this.wanderH) * spd, vz = Math.cos(this.wanderH) * spd;
    const nx = npc.x + vx, nz = npc.z + vz;
    // don't idly wander into a live fire — veer off if the next step nears the flame
    let intoFire = false;
    for (const fr of this.world.fires){
      if (fr.lit && Math.hypot(nx - fr.x, nz - fr.z) < FIRE_SHY_R + 0.4){ intoFire = true; break; }
    }
    if (!intoFire && walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){
      npc.x = nx; npc.z = nz; npc.moving = true; npc.heading = this.wanderH;
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
    this.flowers = [];    // wildflowers elves pick for crown-making
    this._onCrownMade = null;  // callback(npc, flowerIds[]) when elf finishes gathering
    this.npcs = [];       // NPCs that have brains (for pairwise company)
    this.fauna = [];      // rabbits (quarry) — roam, flee, hunted for meat
    this.boats = [];      // communal canoes NPCs ferry across the water (docs/boats.md)
    this.threat = null;   // a {x,z} the fauna flee from too (the player), set per frame
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
  // a fire-SAFE spot near (x,z): land, on GENTLE ground (never a steep hillside)
  // and clear of trunks (FIRE_CLEAR, since trees burn) — searched in close rings so
  // the new hearth stays reachable. First pass insists on tree clearance; if hemmed
  // in by trees it relaxes that, but the slope bar is NEVER bypassed. Only if no
  // gentle ground exists within reach at all does it fall back to clearSpot.
  safeFireSpot(x, z){
    const ok = (px, pz, needClear) => {
      if (Math.hypot(px, pz) >= WORLD_R || !walkable(px, pz)) return false;
      if (terrainType(px, pz) !== 'grass') return false;                    // no swamp/water-edge fires
      if (ringSpread(px, pz, 2.5) > MAX_FIRE_SPREAD) return false;          // never on a slope
      if (needClear) for (const t of this.trees) if (Math.hypot(px - t[0], pz - t[1]) < FIRE_CLEAR) return false;
      return true;
    };
    for (const needClear of [true, false]){
      if (ok(x, z, needClear)) return [x, z];
      for (let r = 1.5; r <= 12; r += 1.0){
        for (let k = 0; k < 12; k++){
          const a = k / 12 * Math.PI*2 + r;
          const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (ok(px, pz, needClear)) return [px, pz];
        }
      }
    }
    return this.clearSpot(x, z);     // truly hemmed in (rare): at least dry & trunk-free
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

  // the communal boats (a Boats manager, or a raw list). NPCs find/claim/ride them.
  setBoats(boats){ this.boats = boats && boats.list ? boats.list : (boats || []); }

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
  addCampfire(x, z, { refine = true, built = true } = {}){
    // Don't create a second fire too close to an existing one; return the nearest instead.
    let nearest = null, nd = 28;
    for (const f of this.fires){ const d = Math.hypot(f.x - x, f.z - z); if (d < nd){ nd = d; nearest = f; } }
    if (nearest) return nearest;
    if (refine){
      const site = findCampfireSite(x, z, this.trees);
      if (site){ [x, z] = site; }
      else if (!walkable(x, z)){                     // fallback: spiral to any dry ground
        for (let r = 1; r < 30 && !walkable(x, z); r++){
          const a = r * 1.3; x += Math.cos(a) * 1.5; z += Math.sin(a) * 1.5;
        }
      }
    } else {
      const c = this.safeFireSpot(x, z); if (c){ [x, z] = c; }   // build clear of trees & off slopes
    }
    const f = new Campfire(this, x, z, { built });   // built:false => raised as a ritual (see Brain.buildRite)
    this.fires.push(f); this.scene.add(f.group);
    return f;
  }
  // remove a hearth from the world (e.g. a half-laid one its builder gave up on)
  removeFire(f){
    if (!f) return;
    const i = this.fires.indexOf(f); if (i >= 0) this.fires.splice(i, 1);
    this.scene.remove(f.group);
    for (const n of this.npcs) if (n.brain) n.brain._blacklist.delete(f);
  }

  setFood(plants){ this.food = plants || []; }
  setValuables(list){ this.valuables = list || []; }
  setFlowers(list){ this.flowers = list || []; }
  setOnCrownMade(cb){ this._onCrownMade = cb || null; }

  // scatter `n` rabbits across walkable land (the quarry; drawn by js/fauna.js)
  spawnFauna(n = FAUNA_N){
    for (let i = 0; i < n; i++){
      for (let k = 0; k < 40; k++){
        const a = Math.random() * Math.PI * 2, r = Math.random() * WORLD_R * 0.85;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (walkable(x, z)){ this.fauna.push(new Quarry(this, x, z)); break; }
      }
    }
    return this.fauna;
  }

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
    npc.esteem = 0;            // social standing — rises by giving, falls by hoarding (sharing)
    npc.stargazer = Math.random() < STARGAZER_CHANCE;   // some read the stars & spread omens (astrology)
    npc._omenCd = Math.random() * OMEN_CD[1];
    this.npcs.push(npc);
    return npc;
  }

  syncSky(sky){ this.day = sky.day ?? 1; this.night = sky.night ?? 0; this.evening = sky.evening ?? 0; this.time = sky.time ?? this.time;
    this.moonLon = sky.moonLon ?? 0; this.sunLon = sky.sunLon ?? 0; this.moonIllum = sky.moonIllum ?? 0; }   // for astrology

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
        const abandoned = f.done && !near && (f.pot.raw + f.pot.ready) <= 0 && f.woodpile <= 0;
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
    for (const q of this.fauna) q.update(dt);          // rabbits roam / flee / respawn
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
      // Seated folk hold their assigned ring seat — don't shove them around (they
      // still repel others below, as `b`). Otherwise the brain pulls them back to
      // the seat while this pass pushes them out, so they micro-slide in place —
      // invisible when seated read as standing, but obvious with a sitting sprite.
      if (a.talking || a.sitting) continue;
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
        `${n.sitting ? ' sit' : ''}${n.chopping ? ' chop' : ''}${n.firewood ? ' w' + n.firewood : ''}${n.pack ? ' p' + n.pack : ''}${n.raw ? ' r' + n.raw : ''}${n.trinkets ? ' t' + n.trinkets : ''}${n.news && n.news.size ? ' n' + n.news.size : ''}${n.esteem > 0.5 ? ' e' + n.esteem.toFixed(0) : ''}`);
    }
    return lines.join('\n');
  }
}
