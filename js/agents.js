// Agent layer — NPC drives, the affordance ("smart object") substrate, and the
// first ritual (the campfire sitting-circle). Design: docs/npc-behavior.md.
//
// The core idea: behaviour lives in the WORLD, not in the agent's head. Things
// in the world *advertise* how much they satisfy a need (The Sims), agents are
// near-dumb selectors that pick the loudest advertiser minus distance, and the
// emergent gatherings are Alexander's "patterns of events bound to patterns of
// space" (Timeless Way ch. 4-5). See docs/texts/.

import { height, walkable, terrainType, pace, builtBand, solidAt } from './terrain.js';
import { WORLD_R, WATER } from './config.js';
import { at as frameAt } from './gen/settle.js';
import { makeName, composeName } from './names.js';
import { NavGrid } from './nav.js';
import { readOmen } from './astrology.js';
import { RECIPES, RAW_KINDS, BOOK_RECIPES, recipeFor, startPot, stepPot, carries, stepsKnown, potDish } from './recipes.js';
import { DISHES } from './ingredients.js';
import { addPlan, dropPlan, plansOf, firstPlan, hadDish, strongestCraving, mayCrave, craved } from './plans.js';
import { addFood, takeFood, takeSpare, giveAll, total, countOf, snackCount, snackTarget, foresight, isKeeper, spoil, SNACKS, rawOf, rawKinds, addRaw, takeRaw, heldForDish } from './larder.js';
import { addNews, pruneNews, knowCanoe, knownCanoes, GOSSIP_RANGE, GOSSIP_CD } from './gossip.js';
import { nudge, regard } from './ties.js';
import { ate as hadFood, lack, worth, strike, ends, wishOf, cropAt, isCrop, CROPS } from './trade.js';
import { Conversation, DEFAULT_TALK, parted } from './convo.js';

export const NEEDS = ['warmth', 'food', 'company', 'rest'];

// Placeholder culture. The culture generator (docs/npc-behavior.md §3) will make
// these procedurally; for now one shared folk. `personalSpace` = the comfortable
// distance this people keeps from others in the open — different cultures keep
// different distances (proxemics), so this is where that variation will live.
export const DEFAULT_CULTURE = { name: 'folk', personalSpace: 1.3, talk: DEFAULT_TALK };
// two contrasting manners of talk, to see what culture does to conversation (main.js
// ?culture=chatty|reserved|mixed). Chatty folk talk fast and long, barge in, skip
// goodbyes; reserved folk keep it short, let only kin join, and always take leave.
export const CULTURES = {
  folk: DEFAULT_CULTURE,
  chatty:   { name: 'chatty', personalSpace: 1.0,
              talk: { turnS: 2.1, readS: 0.045, loreS: 0.07, pause: 0.4, join: 'interrupt', strangers: true, farewell: false, maxTopics: 7, sayings: 0.45 } },
  reserved: { name: 'reserved', personalSpace: 1.6,
              talk: { turnS: 3.0, readS: 0.06, loreS: 0.095, pause: 1.5, join: 'never', strangers: false, farewell: true, maxTopics: 2, sayings: 0.2 } },
};

// Individual temperament + skill. Personality is *which wants pull hardest*: the
// drive multipliers say how fast each need rises (a glutton hungers sooner, a
// solitary soul rarely grows lonely), and `beauty` is the taste for collecting
// fine things — which, in a Maslow-ish stack, only surfaces once survival and
// belonging are met (see Brain.choose). Skill is how well the body serves: a
// strong person chops faster and carries more, a keen-eyed one spots small
// valuables from further off. Procedural for now; the culture generator will
// later seed the distributions.
//
// Randomness policy: WORLD-DEFINING draws (who a person is — persona, name,
// stargazer flag, starting needs — and where the fauna spawn) come from the
// world's seeded rng (world.rng), so one WORLD_SEED reproduces the same folk.
// EPHEMERAL jitter (decision timing, wander headings, separation nudges, flame
// cosmetics) stays on Math.random — it doesn't define the world.
const DEFAULT_PERSONA = { warmth: 1, food: 1, company: 1, rest: 1, beauty: 1, strength: 1, perception: 1, generosity: 1 };
function makePersona(rng = Math.random){
  const v = (lo, hi) => lo + rng() * (hi - lo);
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

const WALK = 2.0;            // walking speed on a level meadow (u/s); terrain.js pace scales it
const DIST_COST = 0.022;     // utility lost per world-unit of travel, at the land's typical going (TRIP_NORM)
// nav.travelCost prices a trip in level-meadow units, and the land averages
// ~1.5× that; dividing by it keeps a typical trip weighing what DIST_COST was
// tuned on, so pace reorders where the folk go without shrinking their range
const TRIP_NORM = 1.5;
const ACT_MIN   = 0.05;      // below this best-score, just wander

// Reverence — the finest want of all, above even beauty: a content, unlonely soul
// drifts to one of the great faced trees (docs/mycelium.md), sits a while, and
// leaves. Deliberate and OCCASIONAL because the urge rebuilds over days, not the
// minutes the daily drives cycle in. No lore — just a pull toward a marked place.
const REV_DRIFT   = 0.0016;  // reverence accrues slowly (a rough day to fill)
const REV_PULL    = 2.2;     // draw of a great tree at peace — enough to make the trek from ~30u
const REV_SATISFY = 0.08;    // spent while sitting at the tree (a visit lasts seconds)
const REV_BREAK   = 0.92;    // a need this urgent ends the rite — devotion isn't hunger
const CIRCLE_LAPS  = 1;      // circuits before the offering. Ovoo practice is three, but the
                             // needs clock here is fast (warmth fills in ~20s) and a three-circuit
                             // rite can never finish before hunger breaks it — so one clear lap.
const CIRCLE_STEPS = 8;      // waypoints per lap — enough to read as a circle, not a triangle
const MOOT_COMPANY = 0.22;   // company sated per second at a moot (cf. the night fire)
const MOOT_DRAW    = 1.6;    // how strongly folk already sitting the ring draw others in
const ROOTWISE_CHANCE = 0.22; // who can hear what the wood carries (cf. stargazers)
const SHRINE_TOL  = 2.2;     // stop at the trunk's edge, within the glade
const HARD_R    = 0.5;       // body radius: two NPCs never get closer than this
const INTIMATE  = 0.7;       // personal space shrinks in intimate settings (the fire circle)
const SEP_SPEED = 2.2;       // how fast crowding is eased apart (units/sec)
const SEP_R     = 6;         // widest crowding radius considered (> any personal space)
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
export const WOOD_CAP = 12;  // logs a hearth's woodpile holds (also the visible stack's size — read by campfire-view.js)
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
// Neighbour bin size for AgentWorld.near(). Must be >= the largest radius anyone
// asks for (SIGHT_RANGE is the widest), or the 3×3 block searched around a point
// would miss people standing inside it.
const NBR_CELL      = SIGHT_RANGE;
// Sightings & gossip run on their own slow clock rather than every frame: a fact
// is timestamped and gossip has a cooldown of its own, so noticing a passer-by a
// fifth of a second later is invisible — and it is the most expensive pass here.
const SOCIAL_DT     = 0.2;
// glimpses of how people feel, in passing (ties.js; talk itself is js/convo.js)
const GLANCE_FAM = 0.25, GLANCE_REG = 0.4;   // a tie strong enough to show in passing
const GLANCE_CD  = 30;      // seconds between one person's glimpses
const PLAN_BIAS  = 1.4;     // pull toward a plan on the agenda (plans.js)
const PLAN_DIST  = 0.006;   // a plan is worth a longer walk than a passing want
// The kinds our plans want gathered, with how much: a dish's base (unless the raw
// bag already holds enough of it) and its extras (unless we carry one); a shared
// plan's task likewise. Read by the gathering and hunting in Brain.choose.
function wantedKinds(npc, now){
  const want = new Map();
  for (const pl of plansOf(npc, now)){
    if (pl.start && now < pl.start) continue;
    const r = (pl.kind === 'dish' || (pl.kind === 'task' && pl.cook)) ? RECIPES[pl.dish] : null;
    if (r){
      if (!r.base.some(k => rawOf(npc, k) >= 2)) for (const k of r.base) want.set(k, 1);
      for (const st of r.steps) if (st.do === 'add' && !carries(npc, st.item)) for (const k of st.item) want.set(k, Math.max(want.get(k) || 0, 0.6));
    }
    if (pl.kind === 'task' && pl.item && !pl.cook && !carries(npc, pl.item)) for (const k of pl.item) want.set(k, 1.2);
    if (pl.kind === 'trade' && stockOf(npc, pl.item) < TRADE_STOCK) want.set(pl.item, Math.max(want.get(pl.item) || 0, 1));   // gathering for a village
  }
  return want;
}
const BUILD_LOGS  = LOGS_PER_SHRUB;   // wood needed to start a fire from scratch

// rain shelter: lean-tos NPCs raise against heavy rain (docs/shelters.md).
// Rain boosts warmth drain (RAIN_CHILL); only sheltered NPCs avoid that penalty.
// Three tiers: tree canopy (free, partial) → existing lean-to → build one.
const RAIN_CHILL   = 1.8;   // warmth drains this many × faster while exposed to rain
const RAIN_SEEK    = 0.28;  // rain intensity at which NPCs actively look for cover
const RAIN_MISERY  = 0.45;  // how much of the urge to get out of the rain is the rain
                            // itself rather than the cold (see Brain.choose)
const RAIN_BUILD   = 0.62;  // intensity at which they'll raise a lean-to if nothing is near
const LEAN_WARMTH  = 0.38;  // warmth advertised by a lean-to (per unit of rain intensity)
const TREE_SHADE   = 0.16;  // warmth a tree canopy provides (partial cover, no build needed)
const TREE_SHADE_R = 3.2;   // canopy radius giving meaningful cover
const LEAN_CAP     = 2;     // max occupants per lean-to
const LEAN_BUILD_T = 5.0;   // seconds to raise a lean-to (one chop → one lean-to)
const LEAN_LOGS    = 1;     // shrub-logs consumed to build one
const SHELTER_BIAS = 1.45;  // urgency bonus toward cover when rain + warmth drive are high
const BUILD_SH_B   = 1.25;  // bonus toward building when no alternative

// huts: the SETTLED shelter (docs/camp.md). Where the lean-to above is what you
// throw up when rain catches you in the open, a hut is what you raise AT CAMP and
// come home to — sited on a ring outside the sitting circle with its doorway to
// the hearth (so the clearing between stays the living space: Pat. 67 COMMON LAND,
// 106 POSITIVE OUTDOOR SPACE), thatched, slept in, and rethatched when weather has
// stripped the roof. Kin settle beside kin (Pat. 37 HOUSE CLUSTER), so the plan of
// a camp reads as the social diagram it is.
// Huts differ in size, because households do: a lone soul throws up a small
// skerm, a family raises a mongolu big enough to sleep several. Size is not
// decoration — it sets how many sleep there, how many poles the frame takes and
// how many armfuls the roof needs, so a bigger hut is visibly more work.
// Sized against a person, not against each other. The world is metric (the eye
// sits at 1.7), and with HUT_SHAPE below the crown is 1.25× the half-width — so
// the SMALLEST hut must still clear a standing body. The first pass at variation
// took the minimum down to 1.30, which is a 1.6m crown: shorter than the people
// meant to live in it. Floor it where someone can stand up inside.
const HUT_RAD       = [1.90, 2.80];   // half-width in metres — 3.8m to 5.6m across
const HUT_SHAPE     = 1.25;  // crown height as a multiple of the half-width
const HUT_GAP       = 1.5;   // clear ground left between two huts' walls — room to walk
                             // between them: the wall puts anyone shut out HUT_BODY clear
                             // of it, so at 0.7 two walls left no gap a body could hold
// Trees. A trunk inside the dome is the obvious clip, but the wall must also
// clear a body's width of walkway and the low limbs round the trunk — at the
// old fixed 1.8m from the hut's MIDDLE, a 5.6m hut stood right through a trunk.
const HUT_TREE_CLEAR  = 1.6;  // wall to trunk, for a tree
const HUT_SHRUB_CLEAR = 0.5;  // wall to stem, for a shrub
// Raising one is a PROCESS, not a rite you stand through (docs/camp.md):
//   stake out the ground → set the frame of poles → thatch it, armful by armful.
// Only the first two happen on the spot; the thatching takes as many trips out to
// the meadow as the roof needs, so a hut going up is something you watch happen
// over an evening rather than a thing that appears.
const STAKE_T       = 4.0;   // seconds to scrape and stake out the ground
const FRAME_T       = 7.0;   // seconds to bend and set the saplings
const LAY_T         = 2.8;   // seconds to lay one armful onto the roof
const SITE_CLAIM_T  = 30;    // seconds a chosen site is held before the claim lapses
const ABANDON_T     = 420;   // seconds an unfinished hut may go unworked before it's given up
// Standing huts nobody sleeps in any more. The folk don't leave them to litter
// the meadow: a derelict is worth something — its frame is seasoned poles, and
// poles are the same stuff a new hut's frame and a hearth's woodpile want. So a
// person short of wood will strike one rather than go and fell a live shrub.
const DERELICT_T    = 900;   // seconds unslept-in before a hut counts as derelict
const STRIKE_T      = 5.0;   // seconds to pull one down
const STRIKE_BIAS   = 1.2;   // pull toward striking a derelict when we want poles
const STRIKE_REACH  = 34;    // how far someone will walk to salvage one
const ROT_T         = 2400;  // a derelict nobody salvages finally falls in on itself
// How far out the ring sits is measured from the HUT's own size, not fixed: a
// 5.6m dome parked at a fixed 4.6m would have its back wall standing in the
// sitting circle. These are the gaps tried beyond (seat ring + half-width).
const HUT_RING      = [0.7, 1.6, 2.6];
const HUTS_PER_FIRE = 6;     // huts one hearth's camp will grow
const HUT_WARMTH    = 0.55;  // warmth a full roof sheds rain-wise (a lean-to gives 0.38)
const HUT_REST      = 0.5;   // rest advertised at night — what draws the weary in
const HUT_CAMP_R    = 26;    // how near a hearth you must be for it to be "your camp"
const HUT_INDOORS   = 1.35;  // a whole roof draws harder than a tree or a lean-to

// the villagers' work (docs/settlements.md): a field to keep, water to draw
const GROW_RATE  = 0.003;    // crop growth per second at full care in daylight (~a day to ripen)
const CARE_FADE  = 0.0033;   // how fast a field's upkeep wears off (~five minutes from fully kept to neglected)
const HOE_RATE   = 0.02;     // upkeep added per second of hoeing
const HARVEST    = 8;        // food a ripe field puts in the house's store
const FARM_BIAS  = 0.55;     // pull toward the day's work in the field
const WORK_T     = [25, 45]; // seconds one spell of field work lasts
const REAP_T     = 30;       // seconds to bring a ripe field in
const WATER_BIAS = 0.45;     // pull toward the well, once a day
const WATER_T    = 8;        // seconds at the well
const WOOD_HOME  = 8;        // logs a household likes stacked against its gable
const HOME_BIAS  = 1.9;      // pull home to the hearth as evening comes (beats an open fire's curfew)
const CHORE_DIST = DIST_COST * 0.15;   // a chore is gone out for on purpose: the walk barely counts against it
// The wall is solid. A hut is not a bush you drift through: people walk round it,
// and the only way in is the doorway (which is why the doorway faces the hearth —
// see the siting above). Each hut's wall is its own radius; this is the margin.
// A body is not a point. The sprites are ~0.8m wide billboards, and the thatch
// panels bulge past the nominal wall at their corners, so an occupant parked at
// wall-minus-a-little still cuts through the roof. Keep a whole body's width.
const HUT_CLEAR     = 0.85;  // how far inside its wall an occupant is held
const HUT_BODY      = 0.45;  // and how far outside it anyone shut out is put
const HUT_DOORA     = 0.52;  // half-angle of the doorway, radians (matches HUT_DOOR in the view)
const ENTER_HOLD    = 1.6;   // once lined up to go in, how far wide of the door (× HUT_DOORA) before the approach is given up
const HUT_SLOT_A    = 0.95;  // radians between neighbouring spots round the back wall (5 fit, clear of the door)
// The roof rots. This is load-bearing, not flavour: without it huts only ever
// accumulate, and a structure that cannot fall down stops meaning anything.
const THATCH_DRY    = 1 / 2600; // thatch lost per second in fair weather (~4 days to bare)
const THATCH_WET    = 4;     // ...times this while it rains — storms are what strip a roof
const THATCH_LOW    = 0.6;   // below this the roof wants mending
const THATCH_ARM    = 0.6;   // roof one armful of cut grass restores
const THATCH_CUT_T  = 3.0;   // seconds of cutting to gather one armful
const THATCH_ARMS   = 2;     // armfuls a person carries at once
const THATCH_BIAS   = 1.5;   // pull toward mending your own roof
const HUT_BUILD_B   = 1.6;   // pull toward raising one when you've nowhere to sleep
const HUT_SITE_TTL  = 6;     // seconds a chosen hut site is cached (siting is a grid scan)
const CUT_SPOT_TTL  = 20;    // seconds a chosen patch of thatching grass is kept in mind
// sleeping — the Lea's first night beat. Turning in is a commitment: the night is
// slept through unless a real need wakes you (hunger, or the cold).
const SLEEP_NIGHT  = 0.45;  // how dark before anyone turns in
const SLEEP_AT     = 0.45;  // rest need at which a roof of your own starts to call
const SLEEP_WAKE   = 0.22;  // night level at which the camp wakes
const SLEEP_REST   = 0.30;  // rest drained per second asleep (a fireside seat gives 0.18)
const SLEEP_WARMTH = 0.06;  // warmth eased per second under a WHOLE roof (a fire gives 0.30)
const SLEEP_CHILL  = 0.85;  // how much of the night's chill a whole roof keeps off you
const SLEEP_BIAS   = 0.9;   // pull toward bed at night (must beat dozing at the fire)
const SLEEP_TURNIN = 0.8;   // you don't take the cold to bed — warm at the fire first
const SLEEP_BREAK  = 0.95;  // a need past this wakes you and ends the night. Set high on
                            // purpose: you go to bed with the hunger you have — only real
                            // desperation turns you out of it.

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
export const STORE_CAP = 40; // a hearth's food cache capacity (read by campfire-view.js for the basket heap)
const FORAGE_BIAS    = 1.0;  // pull toward gathering, scaled by how empty the pack is
const GETFOOD_BIAS   = 1.3;  // pull toward the camp cache when hungry & empty-handed
const STORE_BIAS     = 0.8;  // pull toward caching a full pack at camp

// cooking: some foraged things can't be eaten raw (roots, acorns, most fungi).
// People carry them in a separate raw bag, bring them to a lit fire, and simmer
// them in the hearth pot; the finished stew lands in the shared food cache.
const COOK_KINDS = RAW_KINDS;              // (recipes.js — one list of what must be cooked)
export const needsCooking = (kind) => COOK_KINDS.has(kind);
const COOK_TIME  = 22;      // seconds a potful takes to become edible
const COOK_BIAS  = 1.0;     // pull toward taking raw food to the pot
const POT_CAP    = 12;      // raw units a pot holds at once
const STEW_SATIETY  = 0.34; // hunger one cooked portion from the pot relieves (a hearty meal)
const POT_EAT_RANGE = 3.5;  // how close you must be to the pot to eat from it
const TEA_WARMTH    = 0.3;  // chill a cup of chamomile tea takes off (recipes.js)
const BREW_BIAS     = 0.9;  // pull toward brewing chamomile when cold
const SNACK_BIAS    = 0.5;
const BOOK_MIN      = 3;    // of a book dish's base, to be worth putting on a pot of it
const RESERVE_AT    = 0.8;  // hunger at which the snacks kept in reserve get eaten
const keptCount = n => countOf(n, 'apples') + countOf(n, 'hazelnuts');  // pull toward topping up the snacks we keep on hand (larder.js)
const SUP_BIAS      = 1.6;  // pull, when hungry & empty-handed, toward a pot with ready stew
// a stew's name, by its main ingredient (for the look-at description)
const DISH_NAME = { ...DISHES, food: 'stew' };   // (ingredients.js `dish`)
export const dishName = (kind) => RECIPES[kind] ? kind : recipeFor(kind) || DISH_NAME[kind] || `${kind} stew`;   // a recipe's name, or an ingredient's dish

// gossip lives in js/gossip.js (addNews / pruneNews / newsFor), told a turn at a time by js/convo.js — see docs/gossip.md
const STARGAZER_CHANCE = 0.25;   // a quarter of folk read the stars (form & spread omens)
const OMEN_CD = [40, 100];       // seconds between an astrologer forming a fresh omen

// barter: trade food <-> firewood with a neighbour, so a forager and a wood-cutter
// each end up with both without doing both jobs. A need is met by exchange, not
// only by gathering. (Pattern 30, ACTIVITY NODES — exchange draws people together.)
const BARTER_BIAS  = 1.15;   // pull toward trading for what we lack
const BARTER_QTY   = 2;      // units handed over each way in a swap
const BARTER_RANGE = 16;     // how far we'll go to find a trading partner

// the market (js/trade.js, docs/trade.md): the folk grow nothing and the
// villagers don't range the wild, so each comes to miss what the other has. A
// soul of the folk who has gone long without garden food takes what they've
// gathered to a village door, and the household haggles crops out of its spare.
const CROP_SPARE    = 5;     // crops a reaped field puts by for trading, on top of what feeds the house
const SPARE_CAP     = 14;    // a household's spare tops out (the rest is eaten, or spoils)
const MARKET_WANT   = 0.55;  // how much they must miss garden food to make the trip
const MARKET_BIAS   = 1.0;   // pull of the trip, × that want
const MARKET_DIST   = DIST_COST * 0.06;   // a planned journey across the Lea: the walk barely counts
const MARKET_REACH  = 400;   // about half a day's walk: a village nearer than that is a neighbour
const MARKET_GO     = 2.0;   // once set out, the journey holds — only a real need breaks it
const MARKET_DAYS   = 0.6;   // …for this long, then it's given up
const MARKET_HAVE   = 2;     // carrying this many crops already, they stay home
const MARKET_RETRY  = 0.25;  // days before calling again at a door that turned them away
const MARKET_ANSWER = 8;     // a household member this near the door comes to it (within a talk's reach, convo.js PART_R)
const MARKET_SEEK   = 70;    // …one further off, out at work, is gone and found
const PARTNER_PULL  = 0.35;  // a door they've traded at before draws them (partners, docs/trade.md)
const POTTAGE_MIN   = 3;     // crops enough to put a pottage on
const TRADE_STOCK   = 3;     // gathering for a village: this many in hand, then go
const TRADE_DAYS    = 1.5;   // a plan to bring a village what it's short of holds this long
const VILLAGE_WILD  = 30;    // villagers forage no further than this from home: they've fields to keep

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
const FAUNA_N      = 48;        // rabbits afoot at once
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

// fishing (js/gen/fishing.js, docs/fishing.md): sit on the bank where deep water
// comes close in, with a line out, and wait. Bites come more often at the evening
// rise and where the water hasn't been fished lately; a catch goes in the raw bag,
// bound for the pot (fish stew), or to a village that's asked for it.
const FISH_BIAS    = 1.05;      // pull toward the bank, × hunger (or a plan's want)
const FISH_T       = [30, 60];  // seconds one sitting lasts, if nothing bites
const FISH_RATE    = 0.035;     // bites per second at a full spot, by day
const FISH_RISE    = 1.5;       // …and this much more at the evening rise
const FISH_TAKE    = 0.18;      // stock one fish takes from a spot
const FISH_STOCK   = 0.8;       // stock a spot gets back per day
const FISH_LOW     = 0.15;      // below this a spot's fished out: try elsewhere
const FISH_REACH   = 220;       // how far they'll walk to fish (further for a plan): it's a trip made on purpose…
const FISH_DIST    = DIST_COST * 0.4;   // …so the walk counts for less
const FISH_SKIP    = 0.08;      // days before trying again a spot where nothing bit
// …and from a boat, out on a ground in the deep water (gen/fishing.js fishingGrounds)
const BOAT_BITE    = 1.4;       // the deep holds more, and bigger, and nobody fishes it from the bank
const BOAT_OUT     = 160;       // how far they'll paddle out to a ground
const BOAT_FISH_T  = [60, 110]; // seconds out on the water
const BOAT_PULL    = 0.45;      // how much they must want fish to take a boat out
const BOAT_PREF    = 1.15;      // a canoe out beats the bank, other things equal (it's the better water)

// --- canoes: known, sought, and made (docs/boats.md, "Making canoes"). Nobody
//     knows where every canoe is: they remember the ones they've seen and been
//     told of (gossip.js knowCanoe), go to those, and make one when they know none.
const CANOE_SIGHT  = 45;        // a canoe on the shore or the water is seen from this far
const CANOE_SEEK   = 220;       // how far they'll go to a canoe they know of, to fish from it
const CANOE_GONE   = 10;        // at the place they knew it and it's not in sight: forgotten
const CANOE_HOLD   = 1.5;       // once set out for a known canoe, the walk holds this much harder
const CANOE_DIST   = DIST_COST * 0.1;   // a day out on the water is a trip made on purpose: the walk to the canoe barely counts
const CANOE_GO     = 2.0;       // …and a trip for bark or to the bed (as a market trip does: only a real need breaks it)
const CANOE_BARK   = 3;         // sheets of birch bark sewn into a hull
const CANOE_RIBS   = 4;         // poles split for ribs and gunwales
const BARK_T       = 7;         // seconds to score a birch and peel a sheet off it
const BARK_REACH   = 160;       // how far from the bed they'll go for a birch
const CANOE_WORK   = 600;       // seconds of shaping, sewing and gumming, with two or more at it
const CANOE_SOLO   = 0.5;       // …alone it goes at this rate: much of it wants a second pair of hands
const CANOE_SPELL  = [35, 65];  // seconds one spell at the bed lasts
const CANOE_BREAK  = 0.02;      // days off between spells (about 12 s): the rest of life goes on
const CANOE_WANT   = 120;       // seconds of wanting a canoe and knowing none before resolving to make one (time to ask round first)
const CANOE_CD     = 3;         // days between one person's canoes
const CANOE_SITE_R = 150;       // how far from where they are they'll make one
const CANOE_BIAS   = 1.6;       // pull of the work to the one making it (a hut's raising pulls about as hard)
const CANOE_HELP   = 1.15;      // …to kin and to anyone who said they'd help
const CANOE_CREW   = 0.5;       // company advertised by a bed where others are at work
const CANOE_COMPANY= 0.05;      // company sated per second, per other worker at the bed
const CANOE_IDLE   = 1.5;       // days unworked before a half-made canoe is given up

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
  if (builtBand(x, z) >= 2) return -1;                     // nor on a settlement's green, lanes or yards
  if (solidAt(x, z, 5)) return -1;                         // nor hard against a wall (a building, a ruin), where the hut would cross it
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
//
// SIM ONLY — no Three.js here. The meshes, flame and light live in
// js/campfire-view.js (CampfireView), injected by AgentWorld's makeFireView
// option; headless runs (tools/sim-harness.mjs) simply skip the view.
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
    this.fuel = built ? 0.7 : 0;          // the live flame; an unbuilt hearth isn't lit yet
    this.woodpile = built ? WOOD_START : 0;  // logs stacked nearby — laid as the build finishes
    this.idleT = 0;          // seconds it has burned with nobody near (then it's damped)
    this.foodStore = 0;      // the camp food cache (the basket by the hearth)
    // the cooking pot: raw units simmering, cooked portions waiting, ingredient, simmer seconds
    this.pot = { raw: 0, ready: 0, kind: null, cook: 0 };
    this.view = null;        // CampfireView, set by the injected factory
    this.group = null;       // the view's THREE.Group (scene handle), if a view exists
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
  addWood(logs){ this.woodpile = Math.min(WOOD_CAP, this.woodpile + logs); }
  extinguish(){ this.fuel = 0; }   // damped out; the view hides the flame & kills the light next frame

  // shared food cache at the hearth (the view mirrors it into the basket each frame)
  hasFood(){ return this.foodStore > 0; }
  addFood(n){ this.foodStore = Math.min(STORE_CAP, this.foodStore + n); }
  takeFood(n){ const got = Math.min(this.foodStore, n); this.foodStore -= got; return got; }

  // the cooking pot: add raw ingredients (returns how many were accepted), and a
  // look-at description of what's simmering. The pot only cooks over a lit fire.
  cook(kind, n, by = null){
    const p = this.pot;
    const take = Math.min(n | 0, POT_CAP - p.raw - p.ready);
    if (take <= 0) return 0;
    if (p.raw === 0 && p.ready === 0){ p.kind = kind; p.cook = 0; p.cooks = new Map(); startPot(p, kind, by, this.world.time); }   // a fresh pot: its dish (recipes.js; a book dish if its cook knows one)
    else if (!this.accepts(kind)) return 0;
    if (by){ if (!p.cooks) p.cooks = new Map(); p.cooks.set(by, (p.cooks.get(by) || 0) + take); }   // who made it (talk credits them)
    p.raw += take;
    return take;
  }
  // will this go in the pot? An empty pot takes anything; a dish under way only its own base
  accepts(kind){
    const p = this.pot;
    if (p.raw + p.ready >= POT_CAP) return false;
    if (p.raw + p.ready === 0) return true;
    const r = RECIPES[p.recipe];
    return r ? r.base.includes(kind) && p.ready === 0 : p.kind === kind;
  }
  isTea(){ const r = RECIPES[this.pot.recipe]; return !!(r && r.warms); }
  // whoever put the most into the pot: it's their stew
  potCook(){ const c = this.pot.cooks; let best = null, n = 0; if (c) for (const [k, v] of c) if (v > n){ n = v; best = k; } return best; }
  // eat one cooked portion straight from the pot (the communal meal); 0 if none ready
  // eat one portion; returns its quality (0..1, recipes.js), or 0 if there's none
  takeStew(){
    if (this.pot.ready <= 0) return 0;
    const q = this.pot.readyQ ?? 1;
    this.pot.ready -= 1;
    if (this.pot.raw <= 0 && this.pot.ready <= 0){ this.pot.kind = null; this.pot.recipe = null; this.pot.readyQ = null; }
    return Math.max(0.05, q);
  }
  potReady(){ return this.pot.ready > 0; }
  // fuller descriptions for the inspect dialog (E on the fire) — read live each call
  potReport(){
    const p = this.pot;
    if (p.raw + p.ready <= 0)
      return "The pot hangs empty over the fire, waiting on something worth cooking.";
    const dish = cap1(dishName(potDish(p)));
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
    const dish = cap1(dishName(potDish(p)));
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
    // a hearth indoors: seats round it on the oval the house's floor allows
    if (this.oval){ const o = this.oval, c = Math.cos(ang) * o.ru, s = Math.sin(ang) * o.rv;
      return { x: this.x + o.lx * c + o.cx * s, z: this.z + o.lz * c + o.cz * s }; }
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
    if (dt > 0) this.fuel = Math.max(0, this.fuel - BURN_RATE * (this.burnK ?? 1) * dt);   // burns down untended (a house's hearth is kept low: burnK)
    // feed itself off the woodpile: when the flame sinks low, a stacked log catches.
    // BURN_RATE is slow, so this consumes the pile visibly over time (~one log a while).
    // (a household's hearth is banked while the house stands empty: it only
    // takes from the pile with someone home — so its smoke means someone is in)
    if (this.fuel < FUEL_LOW && this.woodpile > 0 && (!this.home || this.home.occupied)){
      this.woodpile -= 1;
      this.fuel = Math.min(FUEL_CAP, this.fuel + FUEL_PER_LOG);
    }

    // simmer the pot — only over a live flame. When done, the raw turns to ready
    // portions that sit in the pot to be eaten from (not tipped into the cache).
    // Each dish is worked through step by step by whoever's at the fire and knows it.
    stepPot(this, this.world, dt);

    // is this a night gathering? (lit, dark out, enough folk actually seated round it)
    let seated = 0;
    for (const n of this.world.npcs)
      if (n.sitting && Math.hypot(n.x - this.x, n.z - this.z) < this.ringR + 2) seated++;
    this.gathering = this.lit && this.world.night > NIGHT_GATHER && seated >= GATHER_MIN;

    this.view?.update(dt);           // the meshes mirror the new state (if we have any)
  }
}

// ------------------------------------------------------------------- shelter
// A lean-to: raised quickly from one shrub's worth of poles + a bark slab.
// NPCs build one near the fire when rain is heavy enough and nothing else covers
// them. Faces toward the nearest fire (the open front draws the warmth + company
// of the hearth while the slab sheds the rain — ethnographically accurate, see
// docs/shelters.md). Capacity LEAN_CAP; once built, it persists.
// SIM ONLY — the lean-to's meshes live in js/campfire-view.js (ShelterView).
class Shelter {
  constructor(world, x, z, angle = 0){
    this.world = world; this.x = x; this.z = z; this.built = 0;
    this.reach = 1.3;   // within this radius = sheltered
    this.angle = angle; // open front faces the nearest fire (read by the view)
    this.view = null;   // ShelterView, set by the injected factory
    this.group = null;  // the view's THREE.Group (scene handle), if a view exists
  }

  get done(){ return this.built >= 1; }
  raise(dt){
    this.built = Math.min(1, this.built + dt / LEAN_BUILD_T);
    this.view?.sync();   // grows from ground up while being raised
    return this.built >= 1;
  }

  // number of NPCs currently inside (used to cap occupancy)
  _occ(){ return this.world.npcs.filter(n => Math.hypot(n.x - this.x, n.z - this.z) < this.reach).length; }

  advertise(rain){
    if (rain < 0.05 || !this.done) return {};
    if (this._occ() >= LEAN_CAP) return {};
    return { warmth: LEAN_WARMTH * rain };
  }

  satisfy(npc, dt){
    npc.sheltered = true;
    const rain = this.world.rain || 0;
    npc.needs.warmth = clamp01(npc.needs.warmth - LEAN_WARMTH * 0.6 * rain * dt);
  }
}

// ----------------------------------------------------------------------- hut
// The settled shelter: a bent-sapling dome thatched with cut grass, raised on the
// ring around a hearth with its doorway facing the fire. Four events hang off it
// (docs/camp.md) — raising it, mending its roof, sheltering under it when rain
// catches you at camp, and turning in for the night. The roof decays and must be
// rethatched, so a hut is a thing people keep rather than a thing people place.
// Ownership is USE-RIGHT, not title (Pat. 79): the builder's while they sleep in
// it, open to their kin, and `lastUsed` is what a lapsing claim will read.
// SIM ONLY — the meshes live in js/campfire-view.js (HutView).
class Hut {
  constructor(world, x, z, angle, owner, fire, rad = HUT_RAD[0]){
    this.world = world; this.x = x; this.z = z; this.angle = angle;
    this.fire = fire || null;      // the hearth whose ring it stands on
    this.rad = rad;                // half-width — this hut's own size
    // Everything a hut costs and holds follows from how big it is.
    this.cap       = Math.max(2, Math.round(rad * 1.8));   // sleepers
    this.logsNeed  = Math.max(2, Math.round(rad * 2.0));   // poles for the frame
    this.loadsNeed = Math.max(2, Math.round(rad * 2.4));   // armfuls of thatch for the roof
    // the three stages of raising it
    this.staked = 0;               // 0..1 ground scraped and marked out
    this.frame  = 0;               // 0..1 saplings bent and set
    this.loads  = 0;               // armfuls laid so far, of loadsNeed
    // what's been brought and not yet used: poles for the frame (a trip at a time,
    // by anyone of the household), and thatch cut before the frame was up
    this.poles = 0; this.thatchPile = 0;
    this.thatch = 0;               // 0..1 roof — rises as it's laid, then decays
    this.owner = owner || null;    // whoever staked it
    this.kin = owner ? owner.group : null;   // their family/clan may shelter here too
    this.lastUsed = world.time;
    this.idleT = 0;                // seconds since anyone last worked on the raising
    this.unusedT = 0;              // seconds since anyone last sheltered or slept here
    this.beds = new Set();         // who sleeps here — a household, not the whole clan
    this.view = null;              // HutView, set by the injected factory
    this.group = null;             // the view's THREE.Group (scene handle), if a view exists
    this._synced = -1;             // thatch level the view was last told about
  }

  // geometry, all off the one radius
  get wall(){ return this.rad; }                  // so tests can ask, without exporting constants
  get inner(){ return Math.max(0.2, this.rad - HUT_CLEAR); }
  get reach(){ return this.rad + 0.15; }          // within this = inside
  contains(x, z){ return Math.hypot(x - this.x, z - this.z) < this.rad; }
  exitPoint(){ return this.doorMouth(); }         // where an occupant makes for to leave
  get done(){ return this.staked >= 1 && this.frame >= 1 && this.loads >= this.loadsNeed; }
  // 0..1 for the view: the frame is the first 45% of the raising, thatch the rest
  get built(){ return 0.45 * this.frame + 0.55 * Math.min(1, this.loads / this.loadsNeed); }
  // How well the roof actually WORKS, as against how full it looks. People
  // rethatch a leaking roof, not a tidy one, so thatch settles at an equilibrium
  // somewhere below full — and a roof at that level should still be a roof. Only
  // a badly gone one stops keeping the weather out.
  get roof(){ return clamp01(this.thatch / THATCH_LOW); }

  // ---- the raising, stage by stage -------------------------------------------
  // Each returns true when that stage is finished. The brain calls whichever one
  // the hut is up to; between them the builder is free to go and fetch what the
  // next stage needs, which is what makes this a process rather than a rite.
  stakeOut(dt){
    this.idleT = 0;
    this.staked = Math.min(1, this.staked + dt / STAKE_T);
    this.view?.sync();
    return this.staked >= 1;
  }
  setFrame(dt){
    this.idleT = 0;
    this.frame = Math.min(1, this.frame + dt / FRAME_T);
    if (this.frame >= 1) while (this.thatchPile > 0 && this.loads < this.loadsNeed){ this.thatchPile--; this.layThatch(); }   // the waiting thatch goes on
    this.view?.sync();
    return this.frame >= 1;
  }
  // a trip's worth brought to the hut and left there (poles, or thatch before the frame stands)
  addPoles(n){ this.idleT = 0; this.poles += n; }
  addThatch(n){
    this.idleT = 0;
    if (this.frame >= 1) for (let i = 0; i < n && this.loads < this.loadsNeed; i++) this.layThatch();
    else this.thatchPile += n;
  }
  // lay one armful onto the roof. While the hut is going up this counts toward
  // the courses it still needs; once it stands, the same act mends it.
  layThatch(){
    this.idleT = 0;
    if (this.loads < this.loadsNeed){
      this.loads++;
      this.thatch = Math.min(1, this.loads / this.loadsNeed);
    } else {
      this.thatch = clamp01(this.thatch + THATCH_ARM);
    }
    this._synced = this.thatch;
    this.view?.sync();
  }
  // Nobody's home, and nobody has been for a long while. A hut is only derelict
  // once its own people have stopped using it — kin coming and going keeps it
  // alive, which is what makes a lived-in camp look different from a left one.
  get derelict(){ return this.unusedT > DERELICT_T; }
  // What pulling it down yields. The poles are in the frame, so a hut that never
  // got that far is just stakes and is worth nothing.
  get salvage(){ return this.frame >= 1 ? this.logsNeed : 0; }

  // what this hut is waiting for: 'stake' | 'frame' | 'thatch' | null
  needs(){
    if (this.staked < 1) return 'stake';
    if (this.frame < 1) return 'frame';
    if (this.loads < this.loadsNeed) return 'thatch';
    return this.thatch < THATCH_LOW ? 'thatch' : null;
  }
  // whose hut is this? Yours if you raised it, or if its owner is your kin. This
  // is the RAIN test — anyone's kin may duck under a roof in a downpour.
  mayUse(npc){ return !this.owner || this.owner === npc || (this.kin && npc.group === this.kin); }
  // ...but SLEEPING is by bed, and a hut holds a household's worth. A clan bigger
  // than one roof raises a second one — which is what makes a camp a ring of huts
  // rather than a single shed, and what puts kin next to kin on that ring.
  bedIn(npc){ return this.beds.has(npc) || (this.mayUse(npc) && this.beds.size < this.cap); }
  claimBed(npc){ if (!this.beds.has(npc) && this.beds.size < this.cap) this.beds.add(npc); }
  // occupants other than `npc` (capacity is a family's worth, not a crowd's)
  _occ(npc){
    let c = 0;
    // own scratch array: the shared one may be mid-iteration in the caller above us
    for (const o of this.world.near(this.x, this.z, this.reach, this._nearBuf || (this._nearBuf = [])))
      if (o !== npc) c++;
    return c;
  }
  hasRoom(npc){ return this._occ(npc) < this.cap; }

  // ---- the wall, the door, and getting in ------------------------------------
  // Bearing from the hut out to (x,z), measured against the way the door faces.
  // 0 = straight out through the doorway.
  doorOffset(x, z){
    let d = Math.atan2(x - this.x, z - this.z) - this.angle;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  atDoor(x, z){ return Math.abs(this.doorOffset(x, z)) < HUT_DOORA; }
  // the spot just outside the doorway — where you stand before stepping in
  doorMouth(){
    return { x: this.x + Math.sin(this.angle) * (this.rad + 0.55),
             z: this.z + Math.cos(this.angle) * (this.rad + 0.55) };
  }
  // Where inside someone settles. Spots run round the BACK of the floor, facing
  // the door, the first at the very back and the rest fanning out to either side
  // — so a household lies along the far wall looking out at the fire, rather
  // than everyone stopping on the threshold the moment they are "in". Kept per
  // person while they are coming or staying; a spot is freed when they go.
  spot(npc){
    const slots = this._slots || (this._slots = new Map());
    let k = slots.get(npc);
    if (k === undefined){
      for (const [o] of slots) if (o._hutIn !== this && o._hutWant !== this) slots.delete(o);
      const used = new Set(slots.values());
      k = 0; while (used.has(k)) k++;
      slots.set(npc, k);
    }
    const off = k === 0 ? 0 : Math.ceil(k / 2) * (k % 2 ? 1 : -1) * HUT_SLOT_A;
    const a = this.angle + Math.PI + off, r = this.inner * 0.8;
    return { x: this.x + Math.sin(a) * r, z: this.z + Math.cos(a) * r };
  }
  // Where someone heading for this hut should actually walk. Already inside, or
  // lined up with the doorway → on in (to their spot, if they are staying, else
  // the middle). Otherwise round to the door mouth first, so they arrive at the
  // opening rather than at the back wall.
  // Lined up but still outside, they make for the THRESHOLD (just inside the door,
  // on its axis), not their spot at the back: walking at the back spot from the
  // edge of the door's wedge took them diagonally out of it again, the goal flipped
  // to the door mouth, which put them back in — a flicker, every frame, at the door.
  // And once lined up they're committed (npc._entering) until they're in or have
  // drifted well wide of it, so the wedge's edge can't make them chatter.
  entry(npc, stay = false){
    const d = Math.hypot(npc.x - this.x, npc.z - this.z);
    if (d < this.rad){ npc._entering = null; return stay ? this.spot(npc) : { x: this.x, z: this.z }; }
    const off = Math.abs(this.doorOffset(npc.x, npc.z));
    if (off < HUT_DOORA || (npc._entering === this && off < HUT_DOORA * ENTER_HOLD)){ npc._entering = this; return this.threshold(); }
    if (npc._entering === this) npc._entering = null;
    return this.doorMouth();
  }
  threshold(){
    return { x: this.x + Math.sin(this.angle) * (this.rad - 0.7), z: this.z + Math.cos(this.angle) * (this.rad - 0.7) };
  }

  // the roof rots — slowly in fair weather, fast under rain
  tick(dt, rain){
    this.unusedT += dt;          // reset by anyone sheltering or sleeping here
    if (!this.done) return;      // a roof still going up is gaining, not losing
    this.thatch = clamp01(this.thatch - THATCH_DRY * dt * (1 + THATCH_WET * rain));
    if (Math.abs(this.thatch - this._synced) > 0.02){ this._synced = this.thatch; this.view?.sync(); }
  }

  // shelter from rain at camp — a whole roof sheds far more than a lean-to, a
  // rotted one barely more than a tree
  shelter(npc, dt){
    npc.sheltered = true; this.unusedT = 0;
    const rain = this.world.rain || 0;
    npc.needs.warmth = clamp01(npc.needs.warmth - HUT_WARMTH * 0.6 * this.roof * rain * dt);
    this.lastUsed = this.world.time;
  }

  // the night: rest comes back fast, warmth only trickles (no fire in here — this
  // is why someone wakes cold and goes out to the hearth, which is exactly right)
  sleep(npc, dt){
    this.claimBed(npc); this.unusedT = 0;
    npc.sleeping = true; npc.sitting = true; npc.sheltered = true; npc.moving = false;
    npc._roof = this.roof;                      // read next frame by the warmth drift
    npc.needs.rest   = clamp01(npc.needs.rest   - SLEEP_REST   * dt);
    npc.needs.warmth = clamp01(npc.needs.warmth - SLEEP_WARMTH * this.roof * dt);
    this.lastUsed = this.world.time;
  }
}

// What one of the folk could trade away: the wild food in their pack and raw
// bag, and their pretty things. Not the crops they came for.
function tradeGoods(a){
  const out = [];
  for (const b of a.larder || []) if (b.n > 0 && !isCrop(b.kind) && !out.some(o => o.kind === b.kind)) out.push({ kind: b.kind, have: countOf(a, b.kind), from: 'pack' });
  for (const k of rawKinds(a)) out.push({ kind: k, have: rawOf(a, k), from: 'raw' });
  if ((a.trinkets || 0) > 0) out.push({ kind: 'trinket', have: a.trinkets, from: 'trinket' });
  return out;
}
// how many of a kind someone carries, in either bag
const stockOf = (n, kind) => countOf(n, kind) + rawOf(n, kind);
// the plan to bring a village what it's short of (AgentWorld.tradePlan), if any
const tradePlanOf = (n, now) => (n.plans || []).find(p => p.kind === 'trade' && p.until >= now) || null;
// kept back for trading: not eaten, not put in the pot, until they have enough
const keeping = (n, kind, now) => { const p = tradePlanOf(n, now); return !!p && p.item === kind; };

// ----------------------------------------------------------------------- house
// A village dwelling (gen/settle.js, docs/settlements.md): a timber house with
// its hearth, its field behind it, and the household that lives there. Inside is
// out of sight: a villager walks to the door and goes in — hidden, held at the
// hearth — and comes out again on the doorstep. So nobody is ever stuck in a
// doorway, and the walls are simply solid (terrain solidAt). What shows from
// outside is the life inside: lit windows after dark, smoke from the chimney
// while the hearth burns (settle-view.js).
class House {
  constructor(world, b){
    this.world = world; this.b = b;
    this.x = b.x; this.z = b.z;
    this.household = [];
    this.inside = new Set();       // who is indoors now
    this.fire = null;              // its hearth (a Campfire, .home = this; never drawn)
    this.fireList = [];            // the fires its people see: everyone's open ones and this
    this.field = null;             // its Field
    this.spare = {};               // crops put by for trading, by kind (trade.js)
    this.ledger = [];              // its recent trades at the door, newest last
    this.lastUsed = world.time;
    // the doorstep: the first open ground straight out from the door
    this.mouth = null;
    find: for (const d of [1.4, 2.2, 3.2, 4.5]) for (const side of [0, 1, -1]){
      const [x, z] = frameAt(b, b.du + side * 1.2, b.hw + d);
      if (walkable(x, z)){ this.mouth = { x, z }; break find; }
    }
    if (!this.mouth){ const [x, z] = frameAt(b, b.du, b.hw + 1.4); this.mouth = { x, z }; }
  }
  get done(){ return true; }
  get roof(){ return 1; }
  get reach(){ return 1.0; }
  get occupied(){ return this.inside.size > 0; }
  doorMouth(){ return this.mouth; }
  mayUse(npc){ return npc.home === this; }
  bedIn(npc){ return npc.home === this; }
  claimBed(){}
  hasRoom(){ return true; }
  // in through the door: out of sight, at the hearth
  enter(npc){
    npc._indoors = this; this.inside.add(npc);
    const k = this.household.indexOf(npc);
    npc.x = this.x + Math.cos(k * 2.1) * 0.6; npc.z = this.z + Math.sin(k * 2.1) * 0.6;
    npc.moving = false; npc.path = null;
  }
  // out again, onto the doorstep
  leave(npc){
    this.inside.delete(npc); npc._indoors = null;
    npc.x = this.mouth.x + (Math.random() - 0.5) * 0.6; npc.z = this.mouth.z + (Math.random() - 0.5) * 0.6;
    npc.sitting = false; npc.sleeping = false;
    this.fire?.release(npc);
  }
  shelter(npc, dt){
    npc.sheltered = true;
    const rain = this.world.rain || 0;
    npc.needs.warmth = clamp01(npc.needs.warmth - HUT_WARMTH * 0.6 * rain * dt);
    this.lastUsed = this.world.time;
  }
  sleep(npc, dt){
    npc.sleeping = true; npc.sitting = true; npc.sheltered = true; npc.moving = false;
    npc._roof = 1;
    npc.needs.rest   = clamp01(npc.needs.rest   - SLEEP_REST   * dt);
    npc.needs.warmth = clamp01(npc.needs.warmth - SLEEP_WARMTH * dt);
    this.lastUsed = this.world.time;
  }
}
// the house a target is inside, if it is: the house itself, or its hearth
const houseOf = t => !t || !t.ref ? null : t.ref instanceof House ? t.ref : t.ref.home instanceof House ? t.ref.home : null;

// A household's field (gen/settle.js): the crop grows by day, faster for being
// worked (hoed, weeded) — `care`, which fades — and when it is ripe it is
// reaped and carried in to the house's store, and the ground sown again. So the
// villagers' food comes from their own work rather than from foraging.
class Field {
  constructor(world, f, house){
    this.world = world; this.f = f; this.house = house;
    this.x = f.x; this.z = f.z;
    this.growth = 0.2 + Math.random() * 0.6;     // 0 sown .. 1 ripe
    this.care = 0.5;                             // 0..1 how well kept, lately
    this.crop = cropAt(f.x, f.z);                // what grows here (trade.js)
  }
  // somewhere along the rows to stand and work
  workSpot(){
    const f = this.f, u = (Math.random() * 2 - 1) * (f.hl - 1.5), v = (Math.random() * 2 - 1) * (f.hw - 1.2);
    const [x, z] = frameAt(f, u, v);
    return walkable(x, z) ? { x, z } : { x: f.x, z: f.z };
  }
  get ripe(){ return this.growth >= 1; }
  tick(dt){
    const w = this.world;
    this.care = Math.max(0, this.care - CARE_FADE * dt);
    if (!this.ripe) this.growth = Math.min(1, this.growth + GROW_RATE * dt * (0.25 + 0.75 * (w.day ?? 1)) * (0.3 + 0.7 * this.care));
  }
  hoe(dt){ this.care = Math.min(1, this.care + HOE_RATE * dt); }
  reap(){
    this.growth = 0; this.care = Math.max(this.care, 0.4);
    this.house.fire?.addFood(HARVEST);
    const sp = this.house.spare;                 // and some put by, to trade
    sp[this.crop] = Math.min(SPARE_CAP, (sp[this.crop] || 0) + CROP_SPARE);
  }
}

// ----------------------------------------------------------------------- fauna
// A rabbit: roams the meadow, bolts from anyone who comes near, and (when caught)
// yields meat. Pure x/z/state — no mesh — so the headless harness can run it; the
// browser draws it from these records (js/fauna.js). See docs/hunting.md.
class Quarry {
  constructor(world, x, z){
    this.world = world; this.x = x; this.z = z;
    this.heading = world.rng() * Math.PI * 2;
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
    for (const n of this.world.near(this.x, this.z, FLEE_R)){   // binned: only folk close enough to spook us
      const d = Math.hypot(n.x - this.x, n.z - this.z); if (d < td){ td = d; tx = n.x; tz = n.z; } }
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
// -------------------------------------------------------------- canoe build
// A bark canoe being made on the bank (docs/boats.md, "Making canoes"). The bed
// is levelled ground by the water: the bark goes down on it, its sides are bent
// up against stakes, the ribs bent in, the seams sewn and gummed. First the
// materials, brought by anyone a trip at a time (three sheets of birch bark, four
// poles); then the work, which goes much faster with two or more at it. Done, it
// is an ordinary communal canoe moored off the bank, and its makers know it's there.
let CANOE_ID = 1;
class CanoeBuild {
  constructor(world, site, owner){
    this.world = world; this.id = CANOE_ID++;
    this.x = site.x; this.z = site.z; this.face = site.face;   // the bed, and the way to the water
    this.launch = site.launch;                                  // where it will float, bow out
    this.owner = owner; this.kin = owner.group || null;
    this.bark = 0; this.ribs = 0; this.work = 0;
    this.crew = 0; this._n = 0;          // at the work last frame / this frame (AgentWorld.update)
    this.hands = new Set([owner]);      // everyone who's put work or materials in
    this.lastT = world.time;
    this.view = null;                    // set by the injected factory (boats.js CanoeBedView)
  }
  needs(){ return this.bark < CANOE_BARK ? 'bark' : this.ribs < CANOE_RIBS ? 'ribs' : this.work < CANOE_WORK ? 'work' : null; }
  get progress(){ return 0.15 * (this.bark / CANOE_BARK + this.ribs / CANOE_RIBS) + 0.7 * this.work / CANOE_WORK; }
  get workNeed(){ return CANOE_WORK; }
  bring(a){
    let put = 0;
    if ((a.bark || 0) > 0 && this.bark < CANOE_BARK){ put = Math.min(a.bark, CANOE_BARK - this.bark); a.bark -= put; this.bark += put; }
    else if ((a.firewood || 0) > 0 && this.bark >= CANOE_BARK && this.ribs < CANOE_RIBS){ put = Math.min(a.firewood, CANOE_RIBS - this.ribs); a.firewood -= put; this.ribs += put; }
    if (put){ this.hands.add(a); this.lastT = this.world.time; this.view?.sync(); }
    return put;
  }
  // one person's moment at the bed; true when the canoe is finished
  labour(a, dt){
    this._n++; this.hands.add(a); this.lastT = this.world.time;
    const crew = Math.max(1, this.crew);
    this.work = Math.min(CANOE_WORK, this.work + dt * (crew >= 2 ? 1 : CANOE_SOLO));
    if (crew >= 2) a.needs.company = clamp01(a.needs.company - CANOE_COMPANY * (crew - 1) * dt);   // work's better company than a fire
    if (this.work - (this._synced || 0) > CANOE_WORK * 0.02 || this.work >= CANOE_WORK){ this._synced = this.work; this.view?.sync(); }
    return this.work >= CANOE_WORK;
  }
}

class Brain {
  // the fires this person sees: everyone's in the open, and their own household's
  // hearth indoors — never another household's (AgentWorld._fireLists)
  get fires(){ const h = this.npc.home; return h ? h.fireList : this.world.openFires; }

  constructor(world, npc){
    this.world = world; this.npc = npc;
    this._sinceWork = Math.random() * 120;     // a villager's day: since the last spell of field work (s)
    this._sinceWater = Math.random() * 600;    // ...and since drawing water
    const r = world.rng;   // starting needs are part of who a person is — seeded
    npc.needs = { warmth: r(), food: r(), company: r(), rest: r() };
    npc.reverence = r() * 0.4;   // the pull toward the great trees, seeded, slow to build
    this.target = null;          // current candidate {kind, x, z, ref, satisfy}
    this.decideT = Math.random() * 0.6;
    this.wanderH = Math.random() * Math.PI*2; this.wanderT = 0;
    npc.actionLabel = 'wander';
    npc.fireGlow = 0;
    npc.pack = 2; npc.eatCd = 0;   // a couple of rations to start; gather/eat are decoupled
    npc.raw = 0; npc.rawKind = null; npc.rawBag = {};   // raw, must-be-cooked ingredients (separate from edible rations; larder.js addRaw)
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
    this._buildingShel = null;     // a lean-to we're mid-ritual raising (commit until done)
    this._buildingHut = null;      // a hut we're mid-ritual raising (commit until done)
    this._sleep = null;            // the hut we've turned in for the night in (commit until dawn)
    this._hutSite = null; this._hutSiteT = 0;   // cached siting scan (see choose)
    this._cutSpot = null; this._cutSpotT = 0;   // the patch of thatching grass we're working
  }

  step(dt){
    const npc = this.npc, w = this.world, n = npc.needs;
    let ct;                                       // a talk's hold on our feet (convo.js steer)
    const prevSheltered = npc.sheltered;         // read before reset; Shelter.satisfy re-sets this frame
    const prevSleeping = npc.sleeping;           // likewise — Hut.sleep re-sets it
    const roof = prevSleeping ? (npc._roof || 0) : 0;   // how whole the roof over us is
    npc.sheltered = false;
    npc.moving = false; npc.chopping = false;   // set true only while felling a shrub
    npc.sleeping = false;                       // set true only by Hut.sleep, once abed
    this._hutSiteT -= dt; this._cutSpotT -= dt;

    // 0. let old "unreachable" grudges expire (a fire may be reachable from elsewhere)
    for (const [f, left] of this._blacklist){
      if (left - dt <= 0) this._blacklist.delete(f); else this._blacklist.set(f, left - dt);
    }

    // 1. drives drift up (warmth faster when it's cold/night), each at this
    // person's own temperament — so individuals hunger/chill/tire/lonely at their
    // own rates (the loner barely grows lonely; the glutton hungers fast).
    const p = npc.persona || DEFAULT_PERSONA;
    const rainChill = prevSheltered ? 1 : (1 + w.rain * RAIN_CHILL);
    // Asleep under a roof, the night's chill is largely kept off — but only in
    // proportion to the thatch. A whole roof and you sleep the night through; a
    // rotted one and you wake cold and go out to the fire, which is exactly the
    // pressure that should send someone to cut an armful of grass in the morning.
    const sleepChill = 1 - SLEEP_CHILL * roof;
    n.warmth  = clamp01(n.warmth  + DRIFT.warmth  * dt * (0.4 + 1.6 * w.night) * p.warmth * rainChill * sleepChill);
    n.food    = clamp01(n.food    + DRIFT.food    * dt * p.food);
    n.company = clamp01(n.company + DRIFT.company * dt * p.company);
    n.rest    = clamp01(n.rest    + DRIFT.rest    * dt * p.rest);
    npc.reverence = clamp01((npc.reverence || 0) + REV_DRIFT * dt * (p.perception || 1));

    npc._huntCd = (npc._huntCd || 0) - dt;   // cooldown between pounce attempts

    // astrology: a stargazer reads the night sky and forms a fresh omen now and
    // then — grounded in the real moon phase & house (astrology.js). It enters their
    // news and rides the gossip out to everyone, astrologer or not.
    if (npc.stargazer){
      npc._omenCd -= dt;
      if (w.night > 0.5 && npc._omenCd <= 0){
        npc._omenCd = OMEN_CD[0] + Math.random() * (OMEN_CD[1] - OMEN_CD[0]);
        const o = readOmen({ moonLon: w.moonLon || 0, sunLon: w.sunLon || 0, illum: w.moonIllum || 0 });
        addNews(npc, { kind: 'omen', key: 'omen', text: o.text, house: o.house, tenor: o.tenor, x: npc.x, z: npc.z, t: w.time });
      }
    }

    // 1a. what's carried goes off in time (larder.js) — berries soonest
    if ((this._spoilT = (this._spoilT || 0) - dt) <= 0){
      this._spoilT = 5;
      const lost = spoil(npc, w.time);
      if (lost){ npc._spoiled = { n: lost, t: w.time }; if (w.potStats) w.potStats.spoiled = (w.potStats.spoiled || 0) + lost; }
    }

    // 1a'. a craving for a dish (plans.js) — not hunger — becomes a plan to make it,
    // once the body's needs aren't pressing and there's no such plan already
    if ((this._craveT = (this._craveT || 0) - dt) <= 0){
      this._craveT = 8;
      if (mayCrave(npc, w.time) && n.food < 0.8 && n.warmth < 0.85 && !firstPlan(npc, 'dish') && !firstPlan(npc, 'task')){
        const dish = strongestCraving(npc, w.time);
        if (dish){ addPlan(npc, { kind: 'dish', dish, until: w.time + 0.3 + 0.4 * foresight(npc) }); craved(npc, w.time);
          if (w.potStats) w.potStats.craved = (w.potStats.craved || 0) + 1; }
      }
    }

    // 1b. eat when hungry. A communal pot at hand is supped first — slowly, a
    // portion at a time, so a stewful is shared down to empty — else the pack.
    npc.eatCd -= dt;
    if ((n.food > EAT_AT || (n.food > 0.15 && firstPlan(npc, 'meal'))) && npc.eatCd <= 0){   // (a shared meal: eat with the others)
      let ate = false;
      for (const f of this.fires){
        const kind = f.pot.kind, dish = potDish(f.pot), cook = f.potCook(), tea = f.isTea();
        if (tea && n.warmth < 0.45) continue;              // tea is for the cold, not the hungry
        const meal = firstPlan(npc, 'meal');               // a shared meal is eaten together, not only by the hungry
        if (!tea && n.food <= EAT_AT && !(meal && meal.fire === f && n.food > 0.15)) continue;
        let q;
        if (f.pot.ready > 0 && Math.hypot(f.x - npc.x, f.z - npc.z) < POT_EAT_RANGE && (q = f.takeStew()) > 0){
          if (tea) n.warmth = clamp01(n.warmth - TEA_WARMTH * (0.5 + 0.5 * q));
          else n.food = clamp01(n.food - STEW_SATIETY * (0.55 + 0.45 * q));   // a botched pot fills you less
          ate = true;
          npc._ate = { kind: dish, cook, q, t: w.time };   // something to thank the cook for (convo.js), by the dish's name
          hadDish(npc, kind, w.time);                       // and the craving for it is spent (plans.js)
          hadFood(npc, RECIPES[kind] ? RECIPES[kind].base[0] : kind, w.time);   // a food group had (trade.js)
          { const ml = firstPlan(npc, 'meal'); if (ml && ml.fire === f) dropPlan(npc, ml); }
          break;
        }
      }
      // from the pack, what'll spoil first; the snacks kept in reserve (keeping kinds, up to
      // our stock) only when properly hungry — that's what they're kept for
      if (!ate && n.food > EAT_AT && (npc.pack || 0) > 0){
        let got = takeFood(npc, 1, w.time, k => !isKeeper(k) && !keeping(npc, k, w.time) && !heldForDish(npc, k, w.time));   // what won't keep, first (not what's kept back to trade, or given for a dish)
        if (!got.length && (n.food > RESERVE_AT || keptCount(npc) > snackTarget(npc))) got = takeFood(npc, 1, w.time);
        if (got.length){ n.food = clamp01(n.food - RATION_SATIETY); ate = true; for (const g of got) hadFood(npc, g.kind, w.time); }
      }
      if (ate) npc.eatCd = EAT_CD;
    }

    // 1c. levelling: hoarding a full pack while a groupmate goes hungry — and being
    // too tight-fisted to share it — slowly erodes your standing (the "insult the
    // meat" social pressure made mechanical). Generous folk give instead (see choose).
    if ((npc.pack || 0) >= (npc.packMax || PACK_MAX) && (p.generosity || 1) < 1.0 && npc.group){
      for (const o of w.near(npc.x, npc.z, SHARE_RANGE)){
        if (o !== npc && o.group === npc.group && (o.needs?.food || 0) > 0.6){
          npc.esteem = (npc.esteem || 0) - HOARD_PENALTY * dt;
          nudge(o, npc, 0, -HOARD_PENALTY * dt);             // and the hungry one notices
          break;
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
    } else if (this._buildingShel && !this._buildingShel.done){
      const s = this._buildingShel;
      this.target = { kind: 'build-shel', x: s.x, z: s.z, ref: s, tol: 2.0,
        satisfy: (a, dt2) => this.buildShelterRite(a, dt2) };
    } else if (this._buildingHut && this._buildingHut.staked < 1){
      // Only the staking-out is a commitment you see through on the spot; the
      // frame and the thatch are jobs you come back to between errands.
      const h = this._buildingHut;
      this.target = { kind: 'stake-hut', x: h.x, z: h.z, ref: h, tol: h.rad + 1.0,
        satisfy: (a, dt2) => this.stakeHutRite(a, dt2) };
    } else if (this._sleep){
      // turned in for the night: the camp stays abed until dawn, or until a real
      // need wakes someone — hunger, or the cold of a hut with no fire in it.
      const h = this._sleep;
      // The cold only turns you out of a bed you are actually IN. Checked against
      // the walk over, it woke people before they ever lay down — they'd pick bed
      // while still chilled, freeze further on the way, and bounce straight back:
      // 419 of 463 wakings in a harness run were that thrash, not a cold night.
      const chilled = prevSleeping && n.warmth > SLEEP_BREAK;
      if (w.night < SLEEP_WAKE || n.food > SLEEP_BREAK || chilled || !h.done){
        this._sleep = null; this.target = null; this.decideT = 0;
      } else {
        this.target = { kind: 'sleep', x: h.x, z: h.z, ref: h, tol: h.reach, inside: true, sit: true,
          satisfy: (a, dt2) => h.sleep(a, dt2) };
      }
    } else if (this._pilgrim){
      this.pilgrimStep(dt);            // the rite, once begun, is seen through
    } else if (npc.convo && (ct = npc.convo.steer(npc))){
      this.target = ct;                // stopped to talk, or walking alongside (convo.js steer)
    } else {
      if (this.target && this.target.kind === 'talk'){ this.target = null; this.decideT = 0; }   // talk's over, or we're moving on
      this.decideT -= dt;
      if (this.decideT <= 0 || !this.target){
        this.decideT = 0.6 + Math.random() * 0.5;
        this.choose();
      }
    }

    if (npc.home){ this._sinceWork += dt; this._sinceWater += dt; }
    if (this.target && this.target.kind !== 'farm' && this.target.kind !== 'reap' && npc.chopping && this._spell){ npc.chopping = false; this._spell = null; }
    if (npc.fishing && !this._ferry && (!this.target || this.target.ref !== npc.fishing)) this.endFishing(npc);   // called away from the bank: reel in
    // 3. act on the current target
    const t = this.target;
    // indoors, and the business is now outside: out onto the doorstep first
    const th = houseOf(t);
    if (npc._indoors && th !== npc._indoors) npc._indoors.leave(npc);
    if (!t){ npc.sitting = false; npc._hutWant = null; this.wanderStep(dt); this.path = null; }
    else if (th){
      // A household's business indoors — its bed, its roof in the rain, its
      // hearth: to the door, in out of sight, and do it there.
      npc._hutWant = null;
      if (npc._indoors !== th){
        const m = th.doorMouth();
        if (Math.hypot(m.x - npc.x, m.z - npc.z) > 0.9){ npc.sitting = false; this.followPath(m.x, m.z, dt); }
        else { th.enter(npc); if (t.ref instanceof Campfire) t.ref.seat(npc); }
      }
      if (npc._indoors === th){ npc.sitting = !!t.sit; this.path = null; t.satisfy(npc, dt); }
    }
    else {
      // only the sitting affordance claims a ring seat; tending actions (stoke/
      // fetch/store) just walk to the hearth itself with their own tolerance.
      const useSeat = !!t.sit && t.ref instanceof Campfire;
      const isHunt = t.ref instanceof Quarry;                 // a moving target — chase it live
      const isHut  = t.ref instanceof Hut;
      // A hut is entered through its door: walk to the doorway first, then in.
      // Arrival is still judged against the hut itself, or standing at the mouth
      // would read as "arrived" and they'd shelter in the rain outside it.
      npc._hutWant = isHut ? t.ref : null;
      const goal = useSeat ? t.ref.seat(npc) : isHunt ? { x: t.ref.x, z: t.ref.z }
                 : isHut ? t.ref.entry(npc, t.inside) : { x: t.x, z: t.z };
      // Staying in (rain, sleep): arrived only once through the door and at our
      // own spot — judged by the hut's reach, they stopped on the threshold.
      const inside = isHut && t.inside;
      const tol  = useSeat ? t.ref.arrive : inside ? 0.35 : (t.tol || 1.5);
      const d = inside ? (npc._hutIn === t.ref ? Math.hypot(goal.x - npc.x, goal.z - npc.z) : Infinity)
              : isHut ? Math.hypot(t.x - npc.x, t.z - npc.z)
                      : Math.hypot(goal.x - npc.x, goal.z - npc.z);
      if (d > tol){
        npc.sitting = false;
        if (isHunt) this.moveTo(goal.x, goal.z, dt);          // direct pursuit in the open (no A* thrash)
        // the last steps in through a doorway are steered, not routed: the hut's
        // floor is blocked on the nav grid, and A* snaps a goal on it to the
        // nearest open cell — often round the BACK, where the wall stops you
        else if (isHut && t.ref.contains(goal.x, goal.z)) this.moveTo(goal.x, goal.z, dt);
        else this.followPath(goal.x, goal.z, dt);
        // stuck = travelled almost nowhere over a sample window (no route / wedged).
        // Position-based, so legitimately rounding a lake never reads as stuck.
        this._stuckSampleT -= dt;
        if (this._stuckSampleT <= 0){
          // judged against how far they could have got: a slog through a reedbed
          // is slow, not stuck (a third of the ground their pace allows, at most 1.2u)
          const could = 0.35 * WALK * STUCK_TIME * (npc._pace ?? 1);
          if (Math.hypot(npc.x - this._sx, npc.z - this._sz) < Math.min(1.2, could)){   // gave up: maybe build our own
            if (this._building && t.ref === this._building){ w.removeFire(this._building); this._building = null; }
            else if (this._buildingShel && t.ref === this._buildingShel){ w.removeShelter(this._buildingShel); this._buildingShel = null; }
            else if (this._buildingHut && t.ref === this._buildingHut){ w.removeHut(this._buildingHut); this._buildingHut = null; this._hutSite = null; w.releaseSite(npc); }
            else if (t.ref instanceof Campfire){ this._blacklist.set(t.ref, BLACKLIST_TIME); t.ref.release(npc); }
            this.target = null; this.path = null;
          }
          this._sx = npc.x; this._sz = npc.z; this._stuckSampleT = STUCK_TIME;
        }
      } else {                                  // arrived: perform the affordance
        npc.sitting = !!t.sit; this.path = null;
        npc.heading = inside ? t.ref.angle                     // settled in: look out at the fire
                    : Math.atan2(t.x - npc.x, t.z - npc.z);   // face the thing
        t.satisfy(npc, dt);
      }
    }
    }

    // firelight glow on the sprite (read by AnimNPC), only near a fire at dusk/night
    let glow = 0;
    for (const fire of this.fires){
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
      if (dist > (opts.reach || 70)) return;
      // what the trip costs is how long it takes: berries across a reedbed or
      // over a steep rise are further off than the same distance of meadow
      const trip = w.nav && w.nav.h ? w.nav.travelCost(npc.x, npc.z, x, z) / TRIP_NORM : dist;
      let s = -(opts.distCost ?? DIST_COST) * trip + (opts.bias || 0);
      for (const k in ad) s += ad[k] * eff[k];
      if (s > bestScore){ bestScore = s; best = { kind, x, z, ref, ...opts,
        satisfy: opts.satisfy || (ref && ref.satisfy ? (a, dt) => ref.satisfy(a, dt) : () => {}) }; }
    };

    for (const fire of this.fires){
      if (this._blacklist.has(fire) || !fire.done) continue;   // skip unreachable & still-being-built hearths
      consider('fire', fire.x, fire.z, fire.advertise(), fire, { sit: true });
    }

    // duty of the hearth: a lit fire — above all one with a stew in the pot — must
    // not be left to itself. Keep watch over any reachable lit fire that nobody else
    // is tending (and if that nobody includes us, stay put). This is a flat duty
    // pull, independent of how warm/social we feel, so fires & stews aren't deserted.
    for (const fire of this.fires){
      if (this._blacklist.has(fire) || !fire.lit || fire.home) continue;   // (a house's banked hearth needs no watcher)
      const minded = w.near(fire.x, fire.z, TEND_RADIUS).some(o => o !== npc);
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
    // Wanting poles has two answers now: fell a live shrub, or pull down a hut
    // nobody lives in any more. The choice is made the same way as everything
    // else — whichever is worth more once the walk is paid for — so a camp with
    // a derelict on its edge quietly recycles it, and one without goes to the
    // scrub. Striking yields a whole frame's worth at once, which is why it wins
    // when a derelict is anywhere near.
    const goStrike = (bias) => {
      let best = null, bd = STRIKE_REACH;
      for (const h of w.huts){
        if (!h.derelict || h.salvage <= 0) continue;
        if (h.owner === npc || (h.kin && npc.group === h.kin && !h.derelict)) continue;  // not your own roof
        const d = Math.hypot(h.x - npc.x, h.z - npc.z);
        if (d < bd){ bd = d; best = h; }
      }
      if (!best) return false;
      consider('strike-hut', best.x, best.z, {}, best, { tol: best.reach + 1.0, bias: bias * STRIKE_BIAS,
        satisfy: (a, dt2) => {
          a.chopping = true;                       // the same downstroke as felling
          a.strikeT = (a.strikeT || 0) + dt2;
          if (a.strikeT >= STRIKE_T){
            a.firewood = (a.firewood || 0) + best.salvage;   // a pile of poles, to frame or to burn
            a.strikeT = 0; a.chopping = false;
            w.removeHut(best);
            this.target = null;
          }
        } });
      return true;
    };
    // cut an armful of thatching grass (for a roof of ours, or our part in raising one)
    const goCutThatch = (bias) => {
      if (!this._cutSpot || this._cutSpotT <= 0){
        this._cutSpot = w.thatchSpot(npc.x, npc.z); this._cutSpotT = CUT_SPOT_TTL;
      }
      const spot = this._cutSpot;
      if (spot) consider('cut-thatch', spot[0], spot[1], {}, null, { tol: 1.6, bias,
        satisfy: (a, dt2) => {
          a.chopping = true;                          // the same downstroke as felling — no reaping frames
          a.thatchT = (a.thatchT || 0) + dt2;
          if (a.thatchT >= THATCH_CUT_T){
            a.thatchArms = Math.min(THATCH_ARMS, (a.thatchArms || 0) + 1);
            a.thatchT = 0; a.chopping = false; this._cutSpot = null; this.target = null;
          }
        } });
    };
    const goChop = (bias) => {
      goStrike(bias);                              // a derelict frame is wood too
      const shrub = w.nearestShrub(npc.x, npc.z);
      if (shrub) consider('chop', shrub.x, shrub.z, {}, shrub, { tol: 1.5, bias, satisfy: chopSatisfy(shrub) });
    };

    // firewood economy. First, a *reachable* fire whose woodpile is running low:
    // stack the wood we carry onto it, else go cut some. The fire burns the pile
    // on its own (Campfire.update). Urgency rises as the pile empties / night
    // falls / we grow cold.
    let lowFire = null, dd = 50;
    let homeFire = null, homeD = Infinity;        // nearest reachable fire = our "camp"
    for (const f of this.fires){
      if (this._blacklist.has(f) || !f.done) continue;   // a half-built hearth isn't a camp yet
      const d = Math.hypot(f.x - npc.x, f.z - npc.z);
      if (d < homeD){ homeD = d; homeFire = f; }
      if (f.needsWood() && d < dd){ dd = d; lowFire = f; }
    }
    if (npc.home && lowFire !== npc.home.fire) lowFire = null;   // a villager's wood is for their own hearth
    const haveReachableFire = !!homeFire;
    // any fire (including half-built) within this radius counts as "a hearth is forming here"
    const anyFireClose = this.fires.some(f => Math.hypot(f.x - npc.x, f.z - npc.z) < 30);

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
    } else if (!npc.home && !anyFireClose && ((n.warmth > 0.45 && !haveReachableFire) || (ev > 0.35 && farFromCamp))){   // (a villager goes home to warm up)
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
    for (const f of this.fires){
      if (this._blacklist.has(f) || !f.done) continue;   // ignore hearths still being raised
      const d = Math.hypot(f.x - npc.x, f.z - npc.z);
      if (d < cd){ cd = d; campFire = f; }
      if (f.hasFood() && d < sd){ sd = d; storeFire = f; }
      if (f.lit && d < kd && (!raw || rawKinds(npc).some(k => f.accepts(k)))){ kd = d; cookFire = f; }   // a live flame and room in its pot for something we carry
      if (f.potReady() && d < pd && (f.isTea() ? n.warmth > 0.45 : true)){ pd = d; supFire = f; }   // ready stew (or tea, if cold)
    }
    // hungry: go sup at a pot of ready stew (the communal meal — eat from it in step)
    if (supFire && (supFire.isTea() ? n.warmth > 0.45 : n.food > 0.4))
      consider('sup', supFire.x, supFire.z, {}, supFire, { sit: true,
        bias: SUP_BIAS * (supFire.isTea() ? n.warmth : n.food * p.food) });
    // cold, with chamomile in the pack and an empty pot on a fire: brew some tea
    if (n.warmth > 0.5 && countOf(npc, 'chamomile') >= 2 && cookFire && cookFire.pot.raw + cookFire.pot.ready === 0)
      consider('brew', cookFire.x, cookFire.z, {}, cookFire, { tol: 1.6, bias: BREW_BIAS * n.warmth,
        satisfy: (a) => { if (countOf(a, 'chamomile') >= 2 && cookFire.accepts('chamomile')) cookFire.cook('chamomile', total(takeFood(a, 2, w.time, 'chamomile')), a); this.target = null; } });
    // carrying garden crops, an empty pot on a lit fire near: put on a pottage
    // (recipes.js). A household does this at its own hearth; the folk with what they traded for.
    { let crops = 0; for (const c of CROPS) crops += countOf(npc, c);
      if (crops >= POTTAGE_MIN && n.food > 0.3 && cookFire && cookFire.pot.raw + cookFire.pot.ready === 0)
        consider('cook', cookFire.x, cookFire.z, {}, cookFire, { tol: 1.6, bias: COOK_BIAS * (0.5 + n.food),
          satisfy: (a) => { for (const c of CROPS){ const k = countOf(a, c); if (k > 0 && cookFire.accepts(c)){ const put = cookFire.cook(c, k, a); if (put > 0) takeFood(a, put, w.time, c); } } this.target = null; } }); }
    // knowing a book dish (taught by the player, recipes.js) whose base is in the pack
    // rather than the raw bag (hazel porridge, bean broth), with an empty pot near: put it on
    { const book = cookFire && cookFire.pot.raw + cookFire.pot.ready === 0 && n.food > 0.3 && npc.recipes
        && BOOK_RECIPES.find(id => stepsKnown(npc, id, w.time) > 0 && RECIPES[id].base.some(k => countOf(npc, k) >= BOOK_MIN));
      if (book){ const k = RECIPES[book].base.find(b => countOf(npc, b) >= BOOK_MIN);
        consider('cook', cookFire.x, cookFire.z, {}, cookFire, { tol: 1.6, bias: COOK_BIAS * (0.5 + n.food),
          satisfy: (a) => { const m = countOf(a, k); if (m >= BOOK_MIN && cookFire.accepts(k)){ const put = cookFire.cook(k, m, a); if (put > 0) takeFood(a, put, w.time, k); } this.target = null; } }); } }
    // hungry and empty-handed: fetch a load from the camp cache (food-keen folk more so)
    if (pack === 0 && n.food > 0.4 && storeFire)
      consider('getfood', storeFire.x, storeFire.z, {}, storeFire, { tol: 1.6, bias: GETFOOD_BIAS * n.food * p.food,
        satisfy: (a) => { const got = storeFire.takeFood((a.packMax || PACK_MAX) - (a.pack || 0));
          if (got > 0) addFood(a, storeFire.home?.field?.crop || 'food', got, w.time); this.target = null; } });   // a household's store is its own crop
    // what our plans want gathered (a dish's base and extras, a shared plan's part)
    const wants = wantedKinds(npc, w.time);
    // gather to keep stocked. Raw-edible foods go in the eating pack; things that
    // must be cooked go in a separate raw bag, bound for the pot.
    if (pack < cap || raw < rawCap)
      for (const pl of w.food){
        if (!pl.ripe) continue;                       // already picked — nothing here
        if (npc.home && Math.hypot(pl.x - npc.home.x, pl.z - npc.home.z) > VILLAGE_WILD) continue;   // a villager keeps to the village
        const cookable = needsCooking(pl.kind);
        if (cookable ? raw >= rawCap : pack >= cap) continue;   // no room in the right bag
        const deficit = cookable ? (1 - raw / rawCap) : packDeficit;
        // keep a stock of snacks on hand — the more foresight, the more, and the keeping kind
        const snack = SNACKS.includes(pl.kind) ? Math.max(0, 1 - snackCount(npc) / snackTarget(npc)) * (isKeeper(pl.kind) ? foresight(npc) : 0.6) : 0;
        consider('food', pl.x, pl.z, {}, pl, { tol: 1.4, reach: wants.has(pl.kind) ? 150 : 70,
          bias: FORAGE_BIAS * (deficit * p.food + SNACK_BIAS * snack) + PLAN_BIAS * (wants.get(pl.kind) || 0),
          satisfy: (a) => {                           // pick it: the fruit vanishes & regrows later
            if (pl.ripe){ const y = pl.collect(); if (y > 0){
              if (needsCooking(pl.kind)) addRaw(a, pl.kind, Math.min(rawCap - (a.raw || 0), y));
              else addFood(a, pl.kind, Math.min((a.packMax || PACK_MAX) - (a.pack || 0), y), w.time);
              // now they *know* this patch — a food tip to pass on (it regrows)
              addNews(a, { kind: 'food', key: 'food:' + pl.kind + ':' + (pl.x|0) + ',' + (pl.z|0),
                foodKind: pl.kind, x: pl.x, z: pl.z, t: w.time });
            } }
            this.target = null;
          } });
      }
    // carrying raw ingredients & a live flame with pot-room is near: take them to cook
    // (what's kept back to trade stays in the bag, unless they're starving; a pot holds one dish, so what it takes goes in, most first)
    const toCook = raw > 0 ? rawKinds(npc).filter(k => !(keeping(npc, k, w.time) && n.food < 0.8)) : [];
    if (toCook.length && cookFire && cookFire.pot.raw < POT_CAP && toCook.some(k => cookFire.accepts(k)))
      consider('cook', cookFire.x, cookFire.z, {}, cookFire, { tol: 1.6, bias: COOK_BIAS * (0.5 + raw / rawCap),
        satisfy: (a) => { for (const k of toCook) if (rawOf(a, k) > 0 && cookFire.accepts(k)) takeRaw(a, k, cookFire.cook(k, rawOf(a, k), a)); this.target = null; } });
    // --- fishing: to a spot on the bank, sit with a line out, wait for a bite, with
    //     room in the raw bag. A sitting under way holds them (it's no use if they
    //     hop off every second). ---
    let wished = false;
    if (w.fishing.length && w.rain < RAIN_SEEK && (w.day > 0.2 || w.evening > 0) && raw < rawCap){
      const fw = Math.max(wants.get('fish') || 0, wants.get('eels') || 0);
      const pull = Math.max(n.food * p.food, fw);
      const sitting = this._fish && this._fish.s;
      if (sitting || pull > 0.35){
        const skip = this._fishSkip || (this._fishSkip = new Map());
        let spot = sitting, sd = Infinity;
        if (!spot) for (const s of w.fishing){
          if ((s.taken && s.taken !== npc) || s.stock < FISH_LOW || (skip.get(s) || -1) > w.time) continue;
          if (npc.home && Math.hypot(s.x - npc.home.x, s.z - npc.home.z) > VILLAGE_WILD) continue;   // a villager keeps to the village
          const d = Math.hypot(s.x - npc.x, s.z - npc.z) / (0.5 + s.stock);
          if (d < sd){ sd = d; spot = s; }
        }
        if (spot) consider('fish', spot.x, spot.z, {}, spot, { tol: 1.0, sit: true, reach: fw ? FISH_REACH * 1.5 : FISH_REACH, distCost: FISH_DIST,
          bias: sitting ? FISH_BIAS * 1.6 : FISH_BIAS * pull * (0.5 + 0.5 * spot.stock),
          satisfy: (a, dt2) => this.fishAt(a, spot, dt2) });
        // or a canoe out to the deep water: better fishing, if there's one free near
        // (villagers keep to the village)
        const boatable = !sitting && !npc.home && pull >= BOAT_PULL && w.night < 0.3;
        const bo = boatable ? this.boatFishOption() : null;
        if (bo) consider('boat-fish', bo.board.x, bo.board.z, {}, null, { tol: 1.6, reach: CANOE_SEEK * 1.3 + 10, distCost: CANOE_DIST,
          bias: FISH_BIAS * pull * (0.5 + 0.5 * bo.ground.stock) * BOAT_PREF * (this._seekBoat === bo.boat ? CANOE_HOLD : 1),
          boat: bo.boat, satisfy: () => this.launchBoatFish(bo) });
        // wanting the deep water and knowing no canoe: in time, they resolve to make one
        else if (boatable && w.grounds.length){ this.wantCanoe(); wished = true; }
      }
    }
    if (!wished && this._canoeWish > 0) this._canoeWish = Math.max(0, this._canoeWish - 0.1);   // it fades while fishing's off their mind

    // --- a canoe being made: our own, our kin's, or one we said we'd help with.
    //     Bark first (peeled off a birch, a sheet a trip), then poles, then the
    //     work at the bed, which goes faster with company. ---
    if (w.canoeBuilds.length && !npc.home && w.night < 0.35){   // (no need gates it, as with a hut: the scores weigh it against food and fire)
      let job = null, jd = Infinity;
      for (const b of w.canoeBuilds){
        const pl = (npc.plans || []).find(q => q.kind === 'canoe' && q.build === b);
        if (b.owner !== npc && !(b.kin && b.kin === npc.group) && !pl) continue;
        const d = Math.hypot(b.x - npc.x, b.z - npc.z);
        if (d < jd){ jd = d; job = b; }
      }
      if (job && jd < CANOE_SEEK){
        const mine = job.owner === npc;
        const want = mine ? CANOE_BIAS : CANOE_HELP * (0.6 + 0.4 * clamp01(1 + regard(npc, job.owner)));   // (they help those they like more readily)
        const spell = this._canoeSpell && this._canoeSpell.b === job;
        const hold = k => this._canoeErrand === k ? CANOE_GO : 1;        // a trip for bark or to the bed, once set out on, holds
        const need = job.needs();
        const bring = () => consider('canoe-bring', job.x, job.z, {}, job, { tol: 2.2, reach: CANOE_SEEK, distCost: PLAN_DIST, bias: want * 1.2 * hold('canoe-bring'),
          satisfy: (a) => { job.bring(a); this.target = null; } });
        if (need === 'bark'){
          if ((npc.bark || 0) > 0) bring();
          else if (job.bark + w.npcs.reduce((a, o) => a + (o.bark && (o.group === job.kin || job.hands.has(o)) ? o.bark : 0), 0) < CANOE_BARK){   // (not if enough is on its way)
            const tree = this._birch && !this._birch.peeled && this._birchFor === job ? this._birch : (this._birch = w.nearestBirch(job.x, job.z, BARK_REACH), this._birchFor = job, this._birch);
            if (tree) consider('peel-bark', tree.x, tree.z, {}, tree, { tol: 1.7, reach: CANOE_SEEK + BARK_REACH, distCost: CHORE_DIST, bias: want * hold('peel-bark'),
              satisfy: (a, dt2) => this.peelBark(tree, a, dt2) });
          }
        } else if (need === 'ribs'){
          if ((npc.firewood || 0) > 0) bring();
          else goChop(CHOP_BIAS * want * 0.8);
        } else if (need === 'work' && (spell || w.time >= (this._canoeRest || 0)))
          consider('canoe-work', job.x, job.z, { company: job.crew > 0 ? CANOE_CREW : 0 }, job, { tol: 2.0, sit: true, reach: CANOE_SEEK, distCost: PLAN_DIST,
            bias: spell ? want * 2 : want * (job.crew > 0 ? 1.25 : 1),
            satisfy: (a, dt2) => this.workCanoe(job, a, dt2) });
      }
    }
    // hungry, nothing edible to hand (no rations, no reachable cache) but carrying
    // raw food and no fire to cook on → lay a hearth. But only if there's no hearth
    // near at all: a cold one nearby will be relit by the firewood economy, so we
    // don't pepper the meadow with one-off cook-fires (see the behaviour report).
    if (!npc.home && n.food > 0.55 && pack === 0 && !storeFire && raw > 0 && !anyFireClose && !cookFire && (!campFire || cd > FAR_FROM_CAMP)){   // (a villager cooks at home)
      if ((npc.firewood || 0) >= BUILD_LOGS)
        consider('build', npc.x, npc.z, {}, null, { tol: 2.0, bias: BUILD_BIAS * n.food,
          satisfy: (a, dt) => this.buildRite(a, dt) });   // laid as a ritual over several seconds
      else goChop(CHOP_BIAS * n.food);
    }
    // pack full: carry the surplus to camp and cache it (delayed-return)
    if (pack >= cap && campFire)
      consider('store', campFire.x, campFire.z, {}, campFire, { tol: 1.6, bias: STORE_BIAS,
        satisfy: (a) => { const give = (a.pack || 0) - DEPOSIT_KEEP;   // the spare goes in; the snacks we stock stay with us
          if (give > 0) campFire.addFood(total(takeSpare(a, give, w.time))); this.target = null; } });

    // --- barter: get what we lack from a neighbour who has it, paying with our
    //     own surplus (food <-> firewood). Only trades when the two are actually
    //     adjacent, so nobody trades with someone who has wandered off. ---
    const haveWood = npc.firewood || 0;
    // pay the partner: the complementary utilitarian good if we have it, else spend
    // a valuable as currency. Returns what was paid ('wood' | 'food' | 'gem'), or false.
    const payWith = (a, s, good) => {
      if (good === 'wood' && (a.firewood || 0) >= 1){
        const pay = Math.min(a.firewood, BARTER_QTY); a.firewood -= pay; s.firewood = (s.firewood || 0) + pay; return 'wood';
      }
      if (good === 'food' && (a.pack || 0) > DEPOSIT_KEEP){
        giveAll(s, takeSpare(a, Math.min(a.pack - DEPOSIT_KEEP, BARTER_QTY), w.time), w.time); return 'food';
      }
      if ((a.trinkets || 0) >= 1){   // spend a valuable instead — it's worth a swap
        a.trinkets -= 1; s.trinkets = (s.trinkets || 0) + 1; if (!s.trinketKind) s.trinketKind = a.trinketKind; return 'gem';
      }
      return false;
    };
    const tradeFor = (a, s, want) => {
      if (Math.hypot(a.x - s.x, a.z - s.z) > 2.5){ this.target = null; return; }   // partner moved off
      let paid = false;
      if (want === 'food'){
        const got = Math.min(s.pack || 0, BARTER_QTY);
        if (got > 0 && (paid = payWith(a, s, 'wood'))) giveAll(a, takeSpare(s, got, w.time), w.time);
      } else {   // want wood
        const got = Math.min(s.firewood || 0, BARTER_QTY);
        if (got > 0 && (paid = payWith(a, s, 'food'))){ s.firewood -= got; a.firewood = (a.firewood || 0) + got; }
      }
      if (paid){   // a fair swap: both hands move, and each thinks a touch better of the other
        w._emit({ type: 'give', from: a, to: s, item: paid, kind: a.packKind });
        w._emit({ type: 'give', from: s, to: a, item: want, kind: s.packKind });
        nudge(a, s, 0.04, 0.03); nudge(s, a, 0.04, 0.03);
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

    // --- the market: missing garden food, take what we've gathered to a village
    //     door. Set out only in the morning, so as to get there by day; once on
    //     the way, it's a commitment (this._market) and the berries by the path
    //     don't turn us back. A door we've traded at before draws us more. ---
    if (this._market && (this._market.until < w.time || !this.tradeGoods(npc).length)) this._market = null;
    if (!npc.home && w.houses && w.houses.length && w.rain < RAIN_SEEK){
      const go = this._market;
      if (go){
        const m = go.meet && !go.meet._indoors ? go.meet : go.house.mouth;   // the door, or the one we've gone to find
        consider('market', m.x, m.z, {}, null, { tol: 1.6, reach: 1e9, distCost: MARKET_DIST, house: go.house,
          bias: MARKET_GO, satisfy: (a) => this.callAt(a, go.house, go.meet) });
      } else if (w.day > 0.5 && !(w.evening > 0)){
        // what sends them: missing garden food, a craving for a village dish, or
        // having gathered what a village is short of. Still gathering it, they wait.
        const tp = tradePlanOf(npc, w.time), ready = tp && stockOf(npc, tp.item) >= TRADE_STOCK;
        const dish = firstPlan(npc, 'dish');
        let want = lack(npc, 'garden', w.time);
        if (dish && RECIPES[dish.dish] && RECIPES[dish.dish].village) want = Math.max(want, 0.8);
        if (ready) want = Math.max(want, 0.9);
        else if (tp && want < 0.9) want = 0;
        let crops = 0; for (const c of CROPS) crops += countOf(npc, c);
        if (want >= MARKET_WANT && crops < MARKET_HAVE && this.tradeGoods(npc).length){
          const cd = this._marketCd || (this._marketCd = new Map()), partners = npc._partners;
          let door = null, dd = Infinity;
          if (ready && (cd.get(tp.house) || -1) <= w.time && Object.values(tp.house.spare).some(v => v > 0)){ door = tp.house; dd = 0; }   // the door that asked for it
          if (!door) for (const h of w.houses){
            if ((cd.get(h) || -1) > w.time || !Object.values(h.spare).some(v => v > 0)) continue;
            const d = Math.hypot(h.mouth.x - npc.x, h.mouth.z - npc.z) * (partners && partners.has(h) ? 0.6 : 1);
            if (d < dd){ dd = d; door = h; }
          }
          if (door){
            const m = door.mouth, partner = !!(partners && partners.has(door));
            consider('market', m.x, m.z, {}, null, { tol: 1.4, reach: MARKET_REACH, distCost: MARKET_DIST, house: door,
              bias: MARKET_BIAS * Math.max(want, n.food) * p.food + (partner ? PARTNER_PULL : 0),   // hunger sends them too: crops are sure food
              satisfy: (a) => this.callAt(a, door) });
          }
        }
      }
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
          if (Math.hypot(giver.x - a.x, giver.z - a.z) < 2.2) w.giveFood(giver, a);
          this.target = null;
        } });
    }

    // hunting: hungry, with quarry in sight → give chase. High variance — the
    // keen-eyed and strong catch more; many bolt clean away. A catch is raw meat,
    // which (a COOK_KIND) goes through the pot and is shared out — the great share.
    if ((n.food > 0.5 || wants.has('meat')) && w.fauna.length){
      let q = null, qd = HUNT_SIGHT;
      for (const r of w.fauna){ if (!r.alive) continue; const d = Math.hypot(r.x - npc.x, r.z - npc.z); if (d < qd){ qd = d; q = r; } }
      if (q) consider('hunt', q.x, q.z, {}, q, { tol: CATCH_RANGE, bias: HUNT_BIAS * Math.max(n.food, wants.get('meat') || 0) * (p.perception || 1),
        satisfy: (a) => {
          if (!q.alive){ this.target = null; return; }
          if (Math.hypot(q.x - a.x, q.z - a.z) <= CATCH_RANGE + 0.4 && (a._huntCd || 0) <= 0){
            a._huntCd = CATCH_CD;
            if (Math.random() < CATCH_CHANCE * (p.perception || 1) * (0.7 + 0.3 * (p.strength || 1))){
              addRaw(a, 'meat', q.caught()); this.target = null;
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

    // ── reverence: sit a while at a great tree ──────────────────────────────────
    // The finest want, indulged only when nothing else presses — survival eased AND
    // not lonely — so it reads as a deliberate, unhurried pilgrimage rather than a
    // chore. The pull scales with how much reverence has built up; a visit drains it,
    // and rising needs eventually pull the person away, so visits end on their own.
    if (w.shrines && w.shrines.length){
      // eased of survival, and not sharply lonely: a calm soul, free to wander off
      const peace = clamp01(1 - 0.9 * surv) * clamp01(1 - 0.6 * n.company);
      const pull = npc.reverence > 0.2 ? REV_PULL * npc.reverence * peace : 0;
      for (const sh of w.shrines){
        // Folk already at the tree draw others in — ACTIVITY NODES (30), "communal
        // life concentrates, it doesn't spread thin", and 126's "strong and steady
        // pulse... drawing people in toward the center". Deliberately OUTSIDE the
        // peace gate: you go to a palaver tree *because people are there*, and a
        // lonely soul is exactly who should be drawn — which is the one thing that
        // turns staggered solitary visits into an assembly.
        const social = MOOT_DRAW * Math.min(1, (sh.present || 0) / 2);
        if (pull <= 0.02 && social <= 0) continue;
        consider('revere', sh.x, sh.z, { company: social }, sh,
          { sit: true, tol: SHRINE_TOL, bias: pull,
            satisfy: (a, dt2) => { a.reverence = clamp01(a.reverence - REV_SATISFY * dt2); } });
      }
    }

    // ── rain shelter (docs/shelters.md) ─────────────────────────────────────────
    // Rain accelerates warmth drain (RAIN_CHILL, only while exposed). When
    // intensity rises, NPCs seek the nearest cover in three tiers:
    //   1. Tree canopy — free, partial, just walk under it.
    //   2. Built lean-to — better protection, already raised by someone.
    //   3. Build a lean-to — when rain is heavy and nothing is nearby.
    // (A hut at camp is better than any of them — see the hut block below.)
    //
    // Wanting out of the rain is NOT the same as being cold. This used to read
    // `rain × warmth-deficit`, so anyone who happened to be warm carried on
    // foraging through a downpour and the whole reflex only fired on people who
    // were already freezing. Being rained on is its own discomfort
    // (docs/shelters.md §6, and the alternative framing in "the shelter drive"),
    // so a downpour pulls at everyone — harder on the cold, but never nothing.
    const rainUrge = w.rain * (RAIN_MISERY + (1 - RAIN_MISERY) * n.warmth);
    if (w.rain > RAIN_SEEK){

      // tier-1: nearest tree canopy (partial cover, no construction needed)
      let treeX = null, treeZ = null, treeD = TREE_SHADE_R + 12;
      for (const [tx, tz] of w.trees){
        const d = Math.hypot(tx - npc.x, tz - npc.z);
        if (d < treeD){ treeD = d; treeX = tx; treeZ = tz; }
      }
      if (treeX !== null){
        consider('tree-shelter', treeX, treeZ, { warmth: TREE_SHADE * w.rain }, null, {
          tol: TREE_SHADE_R,
          bias: SHELTER_BIAS * 0.55 * rainUrge,
          satisfy: (a, dt2) => {
            a.sheltered = true;
            // face outward from the trunk so the NPC huddles under the canopy
            const ox = a.x - treeX, oz = a.z - treeZ;
            const ol = Math.hypot(ox, oz);
            if (ol > 0.1) a.heading = Math.atan2(ox, oz);
            a.needs.warmth = clamp01(a.needs.warmth - TREE_SHADE * 0.5 * w.rain * dt2);
          }
        });
      }

      // tier-2: an existing lean-to with space
      for (const s of w.shelters){
        const ad = s.advertise(w.rain);
        if (!ad.warmth) continue;
        consider('shelter', s.x, s.z, ad, s, {
          tol: s.reach,
          bias: SHELTER_BIAS * rainUrge,
          satisfy: (a, dt2) => s.satisfy(a, dt2)
        });
      }

      // tier-3: build one — only when rain is heavy, no fire AND no existing shelter near.
      // Tree proximity is NOT excluded here — the utility comparison handles it. A tree
      // wins in the race naturally; building only wins in genuinely open terrain.
      if (w.rain > RAIN_BUILD && !haveReachableFire && !anyFireClose){
        const anyNear = w.shelters.some(s => Math.hypot(s.x - npc.x, s.z - npc.z) < 18);
        if (!anyNear){
          if ((npc.firewood || 0) >= LEAN_LOGS)
            consider('build-shel', npc.x, npc.z, {}, null, { tol: 2.0,
              bias: BUILD_SH_B * rainUrge,
              satisfy: (a, dt2) => this.buildShelterRite(a, dt2) });
          else goChop(CHOP_BIAS * w.rain * n.warmth);
        }
      }
    }

    // ── the hut: the settled shelter at camp (docs/camp.md) ─────────────────────
    // Four events hang off a hut, and they are what make it a place rather than a
    // prop: raising one, mending its roof, sheltering under it when rain catches
    // you at camp, and turning in for the night. The lean-to above stays what it
    // is — what you throw up when the open country catches you out.
    {
      // Two different questions, and conflating them is what makes a camp one
      // shed instead of a ring: which roof may I duck under (kin's, in rain), and
      // which roof is MINE to sleep and keep up (a bed in it).
      let myHut = null, hd = 40, myBed = null, bd = 40;
      for (const h of w.huts){
        if (!h.done || !h.mayUse(npc)) continue;    // one still going up is no shelter
        const d = Math.hypot(h.x - npc.x, h.z - npc.z);
        if (d < hd){ hd = d; myHut = h; }
        if (h.bedIn(npc) && d < bd){ bd = d; myBed = h; }
      }

      if (myHut){
        // (a) rain at camp: a whole roof beats a tree or a lean-to — while it holds
        // (labelled apart from the lean-to's 'shelter' so the harness can tell
        // "went indoors at camp" from "threw up a lean-to in the open")
        if (w.rain > RAIN_SEEK && myHut.roof > 0.15 && myHut.hasRoom(npc))
          consider('indoors', myHut.x, myHut.z, { warmth: HUT_WARMTH * myHut.roof * w.rain }, myHut,
            { tol: myHut.reach, inside: true, sit: true, bias: SHELTER_BIAS * HUT_INDOORS * rainUrge,
              satisfy: (a, dt2) => myHut.shelter(a, dt2) });

      }
      if (myBed){
        // (b) turn in — deep night, weary, and a roof of our own to sleep under.
        // A bed has to beat dozing at the fire (which also sates rest), or nobody
        // would ever go to bed; it only says so once it's properly dark.
        // ...and you warm yourself at the fire BEFORE turning in, rather than
        // taking the cold to bed with you. The order falls out of one clause:
        // gather at the hearth, get warm, then go to your hut.
        if (w.night > SLEEP_NIGHT && n.rest > SLEEP_AT && n.warmth < SLEEP_TURNIN && myBed.hasRoom(npc))
          consider('sleep', myBed.x, myBed.z, { rest: HUT_REST }, myBed,
            { tol: myBed.reach, inside: true, sit: true, bias: SLEEP_BIAS * w.night, satisfy: (a, dt2) => myBed.sleep(a, dt2) });

        // (c) mend the roof. Cheaper than building — an armful of cut grass, no
        // felling — so care is affordable and neglect is a choice.
      }

      // a villager's own house (gen/settle.js): in out of the rain, and to bed at
      // night — by the same rules as a hut, warmed at the hearth first
      const home = npc.home;
      if (home){
        if (w.rain > RAIN_SEEK)
          consider('indoors', home.x, home.z, { warmth: HUT_WARMTH * w.rain }, home,
            { tol: home.reach, inside: true, sit: true, bias: SHELTER_BIAS * HUT_INDOORS * rainUrge,
              satisfy: (a, dt2) => home.shelter(a, dt2) });
        if (w.night > SLEEP_NIGHT && n.rest > SLEEP_AT && n.warmth < SLEEP_TURNIN)
          consider('sleep', home.x, home.z, { rest: HUT_REST }, home,
            { tol: home.reach, inside: true, sit: true, bias: SLEEP_BIAS * w.night, satisfy: (a, dt2) => home.sleep(a, dt2) });

        // the day's work. A spell in the field — hoeing, weeding — then a while
        // off before the next; a ripe field is reaped and carried in. Work is a
        // pull of its own, like keeping a fire, not a need: it is what a
        // villager's day is made of when nothing more pressing calls.
        const fd = home.field, light = clamp01((w.day - 0.25) / 0.35);
        if (fd && light > 0 && w.rain < RAIN_SEEK){
          const due = clamp01(this._sinceWork / 80);
          const spell = this._spell && this._spell.f === fd ? this._spell : null;
          const spot = spell ? spell.spot : (this._farmSpot && this._farmSpot.f === fd ? this._farmSpot : (this._farmSpot = { f: fd, ...fd.workSpot() }));
          const reap = fd.ripe;
          consider(reap ? 'reap' : 'farm', spot.x, spot.z, {}, fd, { tol: 0.8, reach: 300, distCost: CHORE_DIST,
            bias: (spell ? FARM_BIAS * 1.5 : FARM_BIAS * due * (reap ? 1.5 : 1 - 0.5 * fd.care)) * light,
            satisfy: (a, dt2) => {
              if (!this._spell || this._spell.f !== fd)
                this._spell = { f: fd, spot, left: reap ? REAP_T : WORK_T[0] + Math.random() * (WORK_T[1] - WORK_T[0]) };
              a.chopping = true;                         // the hoe's (or the sickle's) rhythm
              if (!reap) fd.hoe(dt2);
              this._spell.left -= dt2;
              if (this._spell.left <= 0){
                if (reap && fd.ripe) fd.reap();
                this._spell = null; this._farmSpot = null; this._sinceWork = 0;
                a.chopping = false; this.target = null; this.decideT = 0;
              }
            } });
        }
        // and once a day, water from the village well
        const well = home.well;
        if (well && light > 0 && this._sinceWater > 450){
          consider('water', well.x + 1.6, well.z, {}, well, { tol: 1.0, reach: 300, distCost: CHORE_DIST, bias: WATER_BIAS * light,
            satisfy: (a, dt2) => {
              this._waterLeft = (this._waterLeft ?? WATER_T) - dt2;
              if (this._waterLeft <= 0){ this._waterLeft = null; this._sinceWater = 0; this.target = null; this.decideT = 0; }
            } });
        }
        // the woodpile against the gable, kept stacked by day: the hearth burns it
        const hf = home.fire;
        if (hf && light > 0 && hf.woodpile < WOOD_HOME){
          const want = 1 - hf.woodpile / WOOD_HOME;
          if ((npc.firewood || 0) > 0){
            const m = home.doorMouth();
            consider('stack', m.x, m.z, {}, m, { tol: 1.0, reach: 300, distCost: CHORE_DIST, bias: STACK_BIAS * 0.6 * want,
              satisfy: (a) => { hf.addWood(a.firewood || 0); a.firewood = 0; this.target = null; } });
          } else {
            // the ground round a village is cleared, so the wood is a walk away
            const shrub = w.nearestShrub(npc.x, npc.z, 200);
            if (shrub) consider('chop', shrub.x, shrub.z, {}, shrub, { tol: 1.5, reach: 250, distCost: CHORE_DIST, bias: CHOP_BIAS * 0.75 * want, satisfy: chopSatisfy(shrub) });
          }
        }
        // evening: home to the hearth, and in for the night
        const dusk = Math.max(w.evening || 0, w.night);
        // (once in, the weary turn in: sleeping is just the deeper end of an evening at home)
        if (hf && dusk > 0.2) consider('home', home.x, home.z, {}, hf, { sit: true, reach: 400, distCost: CHORE_DIST, bias: HOME_BIAS * dusk,
          satisfy: (a, dt2) => (w.night > 0.6 || (w.night > SLEEP_NIGHT && a.needs.rest > 0.25) ? home.sleep(a, dt2) : (a.sleeping = false, hf.satisfy(a, dt2))) });
      }

      // (c) WORK ON A HUT OF OURS. Raising one and mending one are the same
      // loop — carry an armful, lay it — differing only in whether the frame is
      // up yet. So an unfinished hut and a leaking roof both come through here,
      // and the trips out for poles and thatch fall out of it.
      const job = w.huts.find(h => (h.owner === npc || (h.kin && npc.group === h.kin)) && h.needs());
      if (job){
        const need = job.needs();
        const bare = !job.done;
        // How badly the work is wanted. An unfinished hut is pressing — you have
        // nowhere to sleep until it stands — while a thin roof on a sound hut
        // matters at dusk and in the wet and hardly at all on a fine morning.
        const want = bare
          ? clamp01(0.5 + 0.4 * n.rest + 0.5 * (w.evening || 0) + 0.6 * w.rain)
          : (1 - job.thatch / THATCH_LOW) * (0.6 + 0.8 * (w.evening || 0) + 0.8 * w.rain);
        const goWork = (bias) =>
          consider(need === 'frame' ? 'frame-hut' : need === 'stake' ? 'stake-hut' : bare ? 'thatch-hut' : 'rethatch',
            job.x, job.z, {}, job, { tol: job.reach + 0.9, bias,
              satisfy: (a, dt2) => this.workHut(job, a, dt2) });

        if (need === 'stake') goWork(THATCH_BIAS * want);
        else if (need === 'frame'){
          // poles go on the hut's pile a trip at a time, so a frame needn't wait on one
          // person carrying them all (nor lose them to a hungry fire on the way)
          if ((npc.firewood || 0) + job.poles >= job.logsNeed || (npc.firewood || 0) >= 2) goWork(THATCH_BIAS * want * 1.1);
          else goChop(CHOP_BIAS * want);                    // fell the poles it needs
        } else if ((npc.thatchArms || 0) > 0) goWork(THATCH_BIAS * want);
        else {
          // Hold on to the patch we picked. Re-rolling it every decision meant
          // walking toward a spot that moved every second and never arriving —
          // 8% of everyone's waking life spent going nowhere.
          goCutThatch(THATCH_BIAS * want * 0.85);
        }
      } else if (!myBed && campFire && cd < HUT_CAMP_R){
        // (d) STAKE OUT A NEW ONE. Nowhere of our own to sleep, at a camp with
        // room on its ring. What makes you want a roof: weariness, the evening
        // closing in, and rain.
        // ("I'd better start mine", said in talk, makes it more pressing — convo.js)
        const want = clamp01(0.4 * n.rest + 0.9 * (w.evening || 0) + 0.9 * w.rain + (firstPlan(npc, 'hut') ? 0.35 : 0));
        if (want > 0.12 && !npc.home && w.hutsAt(campFire).length < HUTS_PER_FIRE){   // villagers have a house
          // siting is a grid scan — hold the answer for a few seconds rather than
          // redoing it every decision while we walk over
          if (!this._hutSite || this._hutSite.fire !== campFire || this._hutSiteT <= 0){
            const site = w.hutSite(campFire, npc);
            this._hutSite = site ? { ...site, fire: campFire } : null;
            this._hutSiteT = HUT_SITE_TTL;
            if (site) w.claimSite(npc, site);        // spoken for, before anyone sets off
          }
          const site = this._hutSite;
          // No materials needed to stake out ground — that is the point of doing
          // it first: the claim is made on the land, then the poles are fetched.
          if (site)
            consider('stake-hut', site.x, site.z, { rest: HUT_REST * 0.7 }, null,
              { tol: site.rad + 1.0, bias: HUT_BUILD_B * want, site,
                satisfy: (a, dt2) => this.stakeHutRite(a, dt2) });
        }
      }
    }

    // the agenda (plans.js): plans made in talk, by a craving, or as a part in a
    // shared plan. "I'll go later" pulls once the need is there; "I'll go now"
    // pulls hard. Each lapses at its `until`, or is dropped once done.
    for (const pl of plansOf(npc, w.time)){
      if (pl.start && w.time < pl.start) continue;                  // agreed for tomorrow: not yet
      const done = () => { dropPlan(npc, pl); this.target = null; };
      if (pl.kind === 'food'){
        if (pack >= cap){ dropPlan(npc, pl); continue; }            // pack's full anyway
        if (pl.now || n.food > 0.35)
          consider('plan-food', pl.x, pl.z, {}, null, { tol: 6, reach: 250, distCost: PLAN_DIST,
            bias: PLAN_BIAS * (pl.now ? 1.5 : n.food), satisfy: done });
      } else if (pl.kind === 'bring'){                              // fetch an ingredient for a pot, then take it there
        if (!pl.fire.pot.raw && !pl.project){ dropPlan(npc, pl); continue; }   // the pot's done without it
        if (carries(npc, pl.item))
          consider('bring', pl.fire.x, pl.fire.z, {}, pl.fire, { tol: 2.5, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.3,
            satisfy: (a) => { if (pl.deliver) pl.deliver(a); if (!carries(a, pl.item)) done(); } });   // stepPot (or the project) takes it
        else if (pl.x != null)
          consider('plan-food', pl.x, pl.z, {}, null, { tol: 6, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.3 });
      } else if (pl.kind === 'help'){                               // "Can I help?" "Crack the acorns." — stay and work
        if (!pl.fire.pot.raw){ dropPlan(npc, pl); continue; }
        consider('help', pl.fire.x, pl.fire.z, {}, pl.fire, { tol: 2.5, bias: PLAN_BIAS, satisfy: () => {} });
      } else if (pl.kind === 'wood'){
        if ((npc.firewood || 0) > 0) dropPlan(npc, pl); else goChop(PLAN_BIAS * (pl.now ? 1.5 : 0.8));
      } else if (pl.kind === 'task' && pl.project.kind === 'hut'){  // my part in raising a hut: poles or thatch, taken to it
        const h = pl.project.hut, wood = pl.item[0] === 'wood';
        const have = wood ? (npc.firewood || 0) : (npc.thatchArms || 0);
        if (have >= Math.min(pl.task.n, wood ? 99 : THATCH_ARMS))
          consider('bring', h.x, h.z, {}, h, { tol: h.reach + 0.9, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.3,
            satisfy: (a) => { pl.deliver(a); this.target = null; } });
        else if (wood) goChop(PLAN_BIAS);
        else goCutThatch(PLAN_BIAS);
      } else if (pl.kind === 'task' && pl.item){                    // my part in a shared plan: get it, take it to the basket
        const have = pl.item.reduce((a, k) => a + (RAW_KINDS.has(k) ? rawOf(npc, k) : countOf(npc, k)), 0);
        if (have >= pl.task.n || (have > 0 && w.time > pl.project.by - 0.1))
          consider('bring', pl.fire.x, pl.fire.z, {}, pl.fire, { tol: 2.5, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.3,
            satisfy: (a) => { pl.deliver(a); this.target = null; } });
      } else if (pl.kind === 'task' && pl.cook && pl.project.stash.size){   // the cook: start it from the basket
        const pr = pl.project, r = RECIPES[pr.dish], f = pr.fire;
        const baseIn = r.base.reduce((a, k) => a + (pr.stash.get(k) || 0), 0);
        const extrasIn = pr.tasks.every(t => !t.id.startsWith('add:') || t.state === 'done');
        if (baseIn >= 2 && (extrasIn || w.time > pr.by - 0.2) && f.lit && f.pot.raw + f.pot.ready === 0)
          consider('plan-cook', f.x, f.z, {}, f, { tol: 1.6, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.5,
            satisfy: (a) => {
              const { kind, n: m } = pr.takeStash(r.base, 12);
              if (m > 0 && f.cook(kind, m, a) > 0 && f.pot.recipe === pr.dish){ pl.onCooked(f); addPlan(a, { kind: 'help', fire: f, until: w.time + 0.1 }); }
              this.target = null;
            } });
      } else if (pl.kind === 'meal'){                               // the shared meal: come and eat when it's ready
        if (pl.fire.pot.ready > 0) consider('sup', pl.fire.x, pl.fire.z, {}, pl.fire, { sit: true, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS });
        else if (!pl.fire.pot.raw) dropPlan(npc, pl);              // it's all gone
      } else if (pl.kind === 'dish' || (pl.kind === 'task' && pl.cook && !pl.project)){
        // a dish to make: with the base in the raw bag, take it to a fire whose pot will have it
        const r = RECIPES[pl.dish];
        if (!r){ dropPlan(npc, pl); continue; }
        const bk = r.base.find(k => rawOf(npc, k) >= 2);              // the dish's base, in the raw bag
        if (bk){
          let f = pl.fire && pl.fire.lit && pl.fire.accepts(bk) ? pl.fire : null;
          if (!f) for (const g of this.fires) if (g.lit && g.accepts(bk) && (!f || Math.hypot(g.x - npc.x, g.z - npc.z) < Math.hypot(f.x - npc.x, f.z - npc.z))) f = g;
          if (f) consider('plan-cook', f.x, f.z, {}, f, { tol: 1.6, reach: 250, distCost: PLAN_DIST, bias: PLAN_BIAS * 1.4,
            satisfy: (a) => {
              const put = takeRaw(a, bk, f.cook(bk, rawOf(a, bk), a));
              if (put > 0 && f.pot.recipe === pl.dish){                 // it's on: now see it through
                if (pl.onCooked) pl.onCooked(f);
                if (w.potStats) w.potStats.cravedCooked = (w.potStats.cravedCooked || 0) + 1;
                dropPlan(a, pl); addPlan(a, { kind: 'help', fire: f, until: w.time + 0.1 });
              }
              this.target = null;
            } });
        }
      }
    }

    for (const o of w.npcs){     // other people advertise company — kinfolk more so
      if (o === npc || parted(npc, o, w.time)) continue;   // (not someone we've just said goodbye to)
      if (o._indoors) continue;                             // nor someone indoors, out of sight
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
    // choosing the rite is a commitment: from here the pilgrimage runs itself,
    // gate by gate, until it's spent or a real need breaks it
    // turning in is likewise a commitment: the night is slept through (see step)
    if (best && best.kind === 'sleep') this._sleep = best.ref;
    if (best && best.kind === 'market' && !this._market) this._market = { house: best.house, until: w.time + MARKET_DAYS };
    this._canoeErrand = best && (best.kind === 'peel-bark' || best.kind === 'canoe-bring') ? best.kind : null;
    if (best && best.kind === 'boat-fish') this._seekBoat = best.boat; else if (this._seekBoat && (!best || best.kind !== 'boat-fish')) this._seekBoat = null;
    if (best && best.kind === 'revere' && !this._pilgrim)
      this._pilgrim = { shrine: best.ref, stage: 0, dwell: 0, lap: 0, laid: false, heard: false };
  }

  // The rite (Alexander 66 HOLY GROUND): pass the gateways in turn, outermost
  // first, pausing at each with a view toward the next inner precinct (134 ZEN
  // VIEW); lay a stone in whichever precinct is still being built; then sit with
  // the tree at the sanctum until the urge is spent. Nothing here is scripted as a
  // ceremony — it is just the pattern, and the ceremony falls out of it.
  pilgrimStep(dt){
    const npc = this.npc, w = this.world, n = npc.needs, p = this._pilgrim, sh = p.shrine;
    if (Math.max(n.warmth, n.food, n.rest) > REV_BREAK){   // hunger ends devotion
      sh.releaseSeat(npc);
      this._pilgrim = null; this.target = null; npc.sitting = false; return;
    }
    npc.actionLabel = 'revere';

    if (p.stage < sh.rings.length){                        // 1. the gateways
      const g = sh.gatePos(p.stage);
      this.target = { kind: 'revere', x: g.x, z: g.z, tol: 1.3, ref: sh,
        satisfy: (a, dt2) => {
          p.dwell += dt2;
          if (p.dwell >= GATE_PAUSE){ p.dwell = 0; p.stage++; this.target = null; this.path = null; }
        } };
      return;
    }

    // 2. go round it. Ovoo practice (docs/sacred-trees.md §E): the traveller
    // circles three times, one way, before making the offering. Gives the visit a
    // shape you can see from across the glade.
    if (p.lap < CIRCLE_LAPS * CIRCLE_STEPS){
      const t = sh.rings[sh.rings.length - 1].gate + (p.lap / CIRCLE_STEPS) * Math.PI * 2;
      // just outside the inner ring: clear of the trunk (which is an obstacle the
      // steering pushes away from) and still inside the outer precinct
      const r = sh.rings[sh.rings.length - 1].r + 0.7;
      this.target = { kind: 'revere', x: sh.cx + Math.sin(t) * r, z: sh.cz + Math.cos(t) * r,
        tol: 1.2, ref: sh, satisfy: () => { p.lap++; this.target = null; this.path = null; } };
      return;
    }

    if (!p.laid){                                          // 3. lay a stone
      const slot = sh.nextSlot();
      // the innermost precinct takes only what a person actually values
      if (slot && (!slot.precious || (npc.trinkets || 0) > 0)){
        this.target = { kind: 'revere', x: slot.x, z: slot.z, tol: 1.0, ref: sh,
          satisfy: (a) => {
            let kind = 'stone';
            if (slot.precious && (a.trinkets || 0) > 0){ a.trinkets -= 1; kind = a.trinketKind || 'stone'; }
            sh.place(slot, kind);
            p.laid = true; this.target = null; this.path = null;
          } };
        return;
      }
      p.laid = true;                                       // nothing to give — go in empty-handed
    }

    // 4. the sanctum: take a place on the stones and sit. A root-wise soul also
    // LISTENS — Dodona (docs/sacred-trees.md §H), where the oak's answer came as
    // the rustle of its leaves for a reader to interpret. What the wood is carrying
    // at this tree passes into the listener, and from there into ordinary gossip:
    // the only bridge by which the mycelium's knowledge reaches the folk at all.
    const seat = sh.seat(npc);
    this.target = { kind: 'revere', x: seat.x, z: seat.z, tol: 1.1, sit: true, ref: sh,
      satisfy: (a, dt2) => {
        a.heading = Math.atan2(sh.x - a.x, sh.z - a.z);    // face the tree
        a.reverence = clamp01(a.reverence - REV_SATISFY * dt2);
        // a moot bonds like the night fire does
        if (sh.moot) a.needs.company = clamp01(a.needs.company - MOOT_COMPANY * dt2);
        if (a.rootwise && !p.heard && sh.hear){
          const fact = sh.hear();
          if (fact && fact.text){
            addNews(a, { kind: 'omen', key: 'wood:' + fact.key, text: fact.text,
                         x: sh.x, z: sh.z, t: w.time, src: 'wood' });
            a.woodHeard = (a.woodHeard || 0) + 1;
          }
          p.heard = true;
        }
        // the urge spent — but a moot holds together while its people still want
        // company, so the assembly disperses rather than snapping apart
        if (a.reverence <= 0.05 && (!sh.moot || a.needs.company < 0.25)){
          sh.releaseSeat(a); this._pilgrim = null; this.target = null; a.sitting = false;
        }
      } };
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
      // a goal that moves repaths at once (above); a still one only now and then,
      // for huts going up on the way — a pace-weighted search costs a few ms
      this.pathI = 0; this.pgx = gx; this.pgz = gz; this.repathT = 2.5 + Math.random() * 1.0;
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
    // LEAVING. You go out the way you came in. Entry was always routed through
    // the doorway (Hut.entry); leaving never was, and it only appeared to work
    // because a coarse step let people tunnel through the wall band. Widen the
    // band past one step's travel and they are simply stuck against the inside of
    // their own hut, walking at the back wall for ever.
    const home = npc._hutIn;
    if (home && !home.contains(gx, gz)){
      const out = home.exitPoint(npc);
      gx = out.x; gz = out.z;
    }
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
    // huts are solid: skirt round them rather than walking into the thatch. The
    // one we're heading for is skipped once we're lined up with its door, so the
    // approach doesn't fight the entry (see Hut.entry / AgentWorld.confine).
    // Against the wall itself the push isn't enough: on a big hut it is weak at
    // the thatch, the goal still points in, the wall puts them back, and they
    // grind there. So in contact the step that walks INTO the wall is dropped and
    // they go round — and which way round is kept until they're clear, or a goal
    // dead behind the hut flips them left/right every frame and they never leave.
    let wall = null;
    for (const h of w.huts){
      if (h.frame <= 0) continue;      // a staked-out site is walked over, not round
      const ox = npc.x - h.x, oz = npc.z - h.z;
      const d = Math.hypot(ox, oz) || 1e-3;
      const reach = h.rad + 1.5;
      if (d >= reach) continue;
      // the hut we're in, or the one we're entering, doesn't shove us about
      if (npc._hutIn === h) continue;
      if (npc._hutWant === h && (h.atDoor(npc.x, npc.z) || d < h.rad || npc._entering === h)) continue;
      const push = (reach - d) / reach;
      sx += (ox/d) * push * 1.3; sz += (oz/d) * push * 1.3;        // radial: off the wall
      let tx = -oz/d, tz = ox/d;                                    // tangential: round it
      if (npc._skirt && npc._skirt.h === h) { if (npc._skirt.side < 0){ tx = -tx; tz = -tz; } }
      else if (tx*(gx-npc.x) + tz*(gz-npc.z) < 0){ tx = -tx; tz = -tz; }
      sx += tx * push * 1.1; sz += tz * push * 1.1;
      if (d < h.rad + HUT_BODY + 0.6 && (!wall || d - h.rad < wall.d - wall.h.rad))
        wall = { h, d, nx: ox/d, nz: oz/d, tx, tz };
    }
    if (wall){
      const inward = -(sx * wall.nx + sz * wall.nz);
      if (inward > 0){ sx += wall.nx * inward; sz += wall.nz * inward; }   // never step into the thatch
      sx += wall.tx * 0.6; sz += wall.tz * 0.6;                             // ...keep going round
      if (!npc._skirt || npc._skirt.h !== wall.h)
        npc._skirt = { h: wall.h, side: (wall.tx * -wall.nz + wall.tz * wall.nx) > 0 ? 1 : -1 };
    } else if (npc._skirt && Math.hypot(npc.x - npc._skirt.h.x, npc.z - npc._skirt.h.z) > npc._skirt.h.rad + 1.5){
      npc._skirt = null;               // clear of it: the next hut gets a fresh choice
    }

    // give a LIT fire a wide berth: a no-step core so nobody walks through the
    // blaze, while the sitting ring (2.3) and the tend reach (~1.6) lie outside it,
    // so people can still gather round and feed it. Firmer push than a trunk.
    for (const fr of this.fires){
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
    // the going underfoot: ground and slope (terrain.js pace), eased so the grainy
    // habitat borders don't make anyone stutter
    const p = pace(npc.x, npc.z, Math.sin(a), Math.cos(a));
    npc._pace = npc._pace == null ? p : npc._pace + (p - npc._pace) * Math.min(1, dt * 3);
    const spd = WALK * npc._pace * dt;
    const ok = (h) => { const x = npc.x + Math.sin(h) * spd, z = npc.z + Math.cos(h) * spd;
      return walkable(x, z) && Math.hypot(x, z) < WORLD_R ? [x, z] : null; };
    let to = ok(a);
    if (!to){
      // Blocked — a wall, a building's corner, the water's edge. Turning a fixed
      // amount and retrying did nothing, since the next frame steers straight back
      // into it: at a corner people stood pushing for ever. Slide instead: the
      // nearest heading either side that's open, keeping to one side for a while
      // so a corner is rounded rather than dithered at.
      if (!(npc._slideT > 0)) npc._slide = Math.random() < 0.5 ? 1 : -1;
      for (const d of [0.35, 0.7, 1.05, 1.4, 1.75]){
        for (const side of [npc._slide, -npc._slide]){
          const h = a + side * d;
          if ((to = ok(h))){ npc._slide = side; npc.heading = h; break; }
        }
        if (to) break;
      }
      npc._slideT = 1.2;
    } else if (npc._slideT > 0) npc._slideT -= dt;
    if (to){ npc.x = to[0]; npc.z = to[1]; npc.moving = true; }   // trunks are resolved by pushOut, not rejected
  }

  // the fire-building RITUAL — the satisfy for the 'build' affordance. The act loop
  // runs this each frame while we stand at the site. The first call raises a bare,
  // unlit hearth on fire-safe ground; each call advances the build (stones laid,
  // then the wood, then the kindling catches and the flame grows in). When it stands
  // finished & alight we stock it with the wood we hauled and the ritual ends.
  tradeGoods(a){ return tradeGoods(a); }
  // A sitting on the bank (docs/fishing.md): face the water, line out, and each
  // second a chance of a bite, by the spot's stock, the hour and a keen eye. A
  // catch ends the sitting (and is a food tip worth passing on); so does waiting
  // the sitting out with nothing, and then they try somewhere else for a while.
  fishAt(a, s, dt){
    const w = this.world;
    if (s.taken && s.taken !== a){ this.target = null; return; }   // someone else got there first
    if (!this._fish || this._fish.s !== s){ this._fish = { s, left: FISH_T[0] + Math.random() * (FISH_T[1] - FISH_T[0]) }; w.catches.sittings++; }
    s.taken = a; a.fishing = s; a.heading = s.face; a.sitting = true;
    this._fish.left -= dt;
    if (Math.random() < w.biteRate(s, a) * dt){
      const got = w.landFish(s);
      addRaw(a, s.kind, Math.min((a.packMax || PACK_MAX) - (a.raw || 0), got));
      w._emit({ type: 'catch', who: a, spot: s, kind: s.kind, n: got });
      addNews(a, { kind: 'food', key: 'food:' + s.kind + ':' + (s.x | 0) + ',' + (s.z | 0), foodKind: s.kind, x: s.x, z: s.z, t: w.time });
      a._caught = { kind: s.kind, n: got, t: w.time };
      return this.endFishing(a);
    }
    if (this._fish.left <= 0){ (this._fishSkip || (this._fishSkip = new Map())).set(s, w.time + FISH_SKIP); this.endFishing(a); }
  }
  endFishing(a){
    const s = a.fishing;
    if (s && s.taken === a) s.taken = null;
    a.fishing = null; this._fish = null;
    if (this.target && this.target.kind === 'fish'){ this.target = null; this.decideT = 0; }
  }
  // At a village door (docs/trade.md). Someone of the household comes to it — out
  // of the house, or over from the field — and the two talk it out: the haggle is
  // a conversation (convo.js haggleChain), acted out a line at a time, and the
  // goods change hands when it says "Done." (AgentWorld.tradeDone).
  callAt(a, h, meet = null){
    const w = this.world, now = w.time;
    this.target = null;
    const go = this._market; this._market = null;
    const cd = this._marketCd || (this._marketCd = new Map());
    const turnedAway = (why) => { cd.set(h, now + MARKET_RETRY); w.market.miss[why] = (w.market.miss[why] || 0) + 1; };
    const free = o => !o.sleeping && !o.convo && !o.talking;
    // who answers: the one we came out to find, someone home and awake, or someone near the door
    let v = meet && !meet._indoors && free(meet) && Math.hypot(meet.x - a.x, meet.z - a.z) < 3 ? meet : null;
    if (!v) v = h.household.find(o => o._indoors === h && free(o));
    if (!v){ let vd = MARKET_ANSWER;
      for (const o of h.household){ if (o._indoors || !free(o)) continue;
        const d = Math.hypot(o.x - h.mouth.x, o.z - h.mouth.z); if (d < vd){ vd = d; v = o; } } }
    if (!v && !meet){   // all out at work: go and find one of them, in the field or at the woodpile
      let f = null, fd = MARKET_SEEK;
      for (const o of h.household){ if (o._indoors || !free(o)) continue;
        const d = Math.hypot(o.x - h.x, o.z - h.z); if (d < fd){ fd = d; f = o; } }
      if (f){ this._market = { house: h, until: Math.min(go ? go.until : now + 0.15, now + 0.15), meet: f }; return; }
    }
    if (!v) return turnedAway('nobody');
    if (v._indoors) h.leave(v);                          // comes to the door
    cd.set(h, now + MARKET_RETRY);                       // one talk at a door, then off
    w.convos.push(Conversation.haggle(w, a, v, h));
    w.market.talks = (w.market.talks || 0) + 1;
  }

  buildRite(a, dt){
    const w = this.world;
    if (!this._building) this._building = w.addCampfire(a.x, a.z, { refine: false, built: false });
    a.actionLabel = 'build';
    if (this._building.raise(dt)){
      this._building.addWood(a.firewood || 0); a.firewood = 0;   // the hauled armful becomes the woodpile
      this._building = null; this.target = null;
    }
  }

  // Lean-to build ritual: called while NPC stands at the site, advances build
  // progress each frame. Material (one log) is consumed when the lean-to is first
  // created; it grows from the ground up until done, then the NPC is free again.
  buildShelterRite(a, dt){
    const w = this.world;
    if (!this._buildingShel){
      const spot = w.clearSpot(a.x, a.z) || [a.x, a.z];
      this._buildingShel = w.addShelter(spot[0], spot[1]);
      a.firewood = Math.max(0, (a.firewood || 0) - LEAN_LOGS);   // consume the pole material
    }
    a.actionLabel = 'build-shel';
    if (this._buildingShel.raise(dt)){ this._buildingShel = null; this.target = null; }
  }

  // The hut-raising rite (docs/camp.md). Like the hearth's, it is laid up in
  // stages on a chosen spot while the builder stands there — the frame of bent
  // saplings first, then the thatch — and the poles they hauled are spent on it.
  // The site was picked at decision time (choose → hutSite) so the doorway faces
  // the hearth and kin end up beside kin.
  // Staking out a new hut: the first act, on ground nobody else has spoken for.
  // The hut comes into being here — bare marked ground, no walls yet — so from
  // this moment every other builder's siting sees it and settles elsewhere.
  stakeHutRite(a, dt){
    const w = this.world;
    if (!this._buildingHut){
      const s = this.target && this.target.site;
      if (!s || !w.siteClear(s.x, s.z, s.rad, a)){          // someone got here first
        this.target = null; this._hutSite = null; w.releaseSite(a); return;
      }
      this._buildingHut = w.addHut(s.x, s.z, s.angle, a, s.fire, s.rad);
      { const hp = firstPlan(a, 'hut'); if (hp) dropPlan(a, hp); }   // the plan made in talk, kept
      this._buildingHut.claimBed(a);                        // the raiser's own bed
      this._hutSite = null; w.releaseSite(a);
    }
    a.actionLabel = 'stake-hut';
    if (this._buildingHut.stakeOut(dt)){ this._buildingHut = null; this.target = null; }
  }

  // Working on a hut that is already staked: setting its frame, or laying an
  // armful on its roof. Each is a short job on the spot — between them the person
  // walks off to fell poles or cut thatch like anyone else, which is what makes
  // the raising a process you watch rather than a rite you wait out.
  workHut(hut, a, dt){
    const need = hut.needs();
    if (need === 'stake'){ a.actionLabel = 'stake-hut'; hut.stakeOut(dt); return; }
    if (need === 'frame'){
      a.actionLabel = 'frame-hut';
      // leave what we carry on the pile; once the pile has enough, set the frame
      if ((a.firewood || 0) > 0 && hut.poles < hut.logsNeed){ const put = Math.min(a.firewood, hut.logsNeed - hut.poles); a.firewood -= put; hut.addPoles(put); }
      if (hut.poles < hut.logsNeed){ this.target = null; return; }               // go and fell some more
      if (hut.setFrame(dt)){ hut.poles -= hut.logsNeed; this.target = null; }   // the poles become the frame
      return;
    }
    // thatching: one armful at a time, each taking a moment to lay
    a.actionLabel = hut.done ? 'rethatch' : 'thatch-hut';
    if ((a.thatchArms || 0) <= 0){ this.target = null; return; }             // go and cut more
    a.layT = (a.layT || 0) + dt;
    if (a.layT >= LAY_T){
      a.layT = 0; a.thatchArms -= 1;
      hut.layThatch();
      if (hut.needs() === null) this.target = null;      // finished — stand back and look at it
    }
  }

  // Wanting to fish the deep water and knowing no canoe. It has to last (a canoe is
  // days of work) and there must be a shore near with grounds in reach of it; then
  // they stake out a bed there and it's on their agenda. Kin making one already: help
  // with theirs instead (choose).
  wantCanoe(){
    const npc = this.npc, w = this.world;
    if (w.time < (this._canoeCd || 0)) return;
    if (w.canoeBuilds.some(b => b.owner === npc || (b.kin && b.kin === npc.group) || (npc.plans || []).some(q => q.build === b))) return;
    this._canoeWish = (this._canoeWish || 0) + 0.85;                  // ~ a decision's worth of seconds
    if (this._canoeWish < CANOE_WANT) return;
    this._canoeWish = 0; this._canoeCd = w.time + CANOE_CD;
    const site = w.canoeSite(npc);
    if (!site) return;
    const b = w.addCanoeBuild(site, npc);
    addPlan(npc, { kind: 'canoe', build: b, until: w.time + CANOE_IDLE * 2 });
  }
  // a sheet of bark off a birch: score round the trunk and down, and peel it away
  peelBark(tree, a, dt){
    const w = this.world;
    if (tree.peeled){ this.target = null; this._birch = null; return; }   // someone was quicker
    a.chopping = true; a.actionLabel = 'peel-bark';
    a.barkT = (a.barkT || 0) + dt;
    if (a.barkT >= BARK_T){
      a.barkT = 0; a.chopping = false;
      tree.peeled = w.time; a.bark = (a.bark || 0) + 1;                   // one sheet: it's a load to carry
      w.canoeStats.bark++; this._birch = null; this.target = null;
    }
  }
  // a spell at the bed: kneeling, bending ribs, sewing, gumming the seams
  workCanoe(b, a, dt){
    const w = this.world;
    if (!w.canoeBuilds.includes(b)){ this._canoeSpell = null; this.target = null; return; }
    if (!this._canoeSpell || this._canoeSpell.b !== b) this._canoeSpell = { b, left: CANOE_SPELL[0] + Math.random() * (CANOE_SPELL[1] - CANOE_SPELL[0]) };
    a.actionLabel = 'canoe-work';
    this._canoeSpell.left -= dt;
    if (b.labour(a, dt)){ w.finishCanoe(b); this._canoeSpell = null; this.target = null; return; }
    if (this._canoeSpell.left <= 0){ this._canoeSpell = null; this.target = null; this._canoeRest = w.time + CANOE_BREAK; }
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
    let boat = null, bd = FERRY_REACH, at = null;       // the nearest canoe they know of (where they think it is)
    for (const [b, k] of knownCanoes(npc, w.time)){
      if (Math.hypot(b.x - npc.x, b.z - npc.z) < CANOE_SIGHT && (b.aboard || b._claimed)) continue;   // in sight, and in use
      const d = Math.hypot(k.x - npc.x, k.z - npc.z);
      if (d < bd){ bd = d; boat = b; at = k; }
    }
    if (!boat || boat.aboard || boat._claimed) return;
    const plan = this.planCrossing(at);
    if (!plan) return;
    const board = w.clearSpot(at.x, at.z);               // nearest dry land to step in from
    if (!board) return;
    boat._claimed = npc;
    this._ferry = { boat, phase: 'toBoat', board: { x: board[0], z: board[1] }, land: plan.land };
    npc.actionLabel = 'ferry';
    this.target = null; this.path = null;
  }

  // Out in a canoe to fish the deep water (docs/fishing.md, "From a boat"). The
  // option: the nearest free canoe, and the best ground it can paddle straight out
  // to. Weighed in choose() against fishing from the bank, like any other want;
  // chosen, it runs as a mode of the ferry (ferryStep: toBoat → out → fishing →
  // back), and the canoe comes back to where it was moored.
  // Only canoes they know of: seen, or told of (gossip.js knowCanoe), and judged
  // from where they think it lies. One in sight with someone in it is passed over;
  // one out of sight they go to, and find there or not (launchBoatFish).
  boatFishOption(){
    const npc = this.npc, w = this.world;
    let best = null, bv = 0;
    for (const [b, k] of knownCanoes(npc, w.time)){
      if (Math.hypot(b.x - npc.x, b.z - npc.z) < CANOE_SIGHT && (b.aboard || (b._claimed && b._claimed !== npc))) continue;
      const d = Math.hypot(k.x - npc.x, k.z - npc.z);
      if (d > (this._seekBoat === b ? CANOE_SEEK * 1.3 : CANOE_SEEK)) continue;
      const out = w.boatReachAt(k.x, k.z);
      if (!out.board) continue;
      let ground = null, gv = 0;
      for (const g of out.grounds){
        if (g.taken || g.stock < 0.3) continue;
        const v = g.stock / (1 + Math.hypot(g.x - k.x, g.z - k.z) / 80);   // a full ground near beats a full one far
        if (v > gv){ gv = v; ground = g; }
      }
      const v = gv / (1 + d / 150);
      if (ground && v > bv){ bv = v; best = { boat: b, at: k, ground, board: out.board }; }
    }
    return best;
  }
  launchBoatFish(o){
    const npc = this.npc, w = this.world, { boat, ground, board } = o;
    this._seekBoat = null;
    if (Math.hypot(boat.x - o.at.x, boat.z - o.at.z) > 4){             // it isn't where they knew it
      if (npc.canoes && npc.canoes.get(boat) === o.at){ npc.canoes.delete(boat); w.canoeStats.missed++; }
      this.target = null; this.decideT = 0; return;
    }
    if (boat.aboard || boat._claimed || ground.taken){ this.target = null; return; }   // someone beat us to it
    if (o.at.from) w.canoeStats.found++;                                // a canoe they'd only been told of
    boat._claimed = npc; ground.taken = npc;
    this._ferry = { boat, mode: 'fish', phase: 'toBoat', board, ground,
      moor: { x: boat.x, z: boat.z, yaw: boat.yaw }, left: BOAT_FISH_T[0] + Math.random() * (BOAT_FISH_T[1] - BOAT_FISH_T[0]) };
    w.catches.boatTrips++;
    this.target = null; this.path = null;
  }
  // paddle the boat (and its rider) a step toward x, z; true once there
  _paddle(x, z, dt){
    const npc = this.npc, boat = this._ferry.boat;
    let dx = x - boat.x, dz = z - boat.z;
    const dd = Math.hypot(dx, dz) || 1; dx /= dd; dz /= dd;
    npc.heading = Math.atan2(dx, dz);
    if (dd < 1.2) return true;
    const step = Math.min(dd, FERRY_SPD * dt);
    boat.placeAt(boat.x + dx * step, boat.z + dz * step, npc.heading);
    npc.x = boat.x; npc.z = boat.z;
    return false;
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
    npc.sitting = F.phase !== 'toBoat'; this.path = null;

    if (F.phase === 'toBoat'){
      if (boat.aboard){ this.endFerry(); return; }       // the player took it first
      const d = Math.hypot(F.board.x - npc.x, F.board.z - npc.z);
      if (d < 3 && Math.hypot(boat.x - F.board.x, boat.z - F.board.z) > 9){   // it's not where they knew it: forget it
        if (npc.canoes) npc.canoes.delete(boat);
        w.canoeStats.missed++; this.endFerry(); return;
      }
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
        F.phase = F.mode === 'fish' ? 'out' : 'cross';
      }
    } else if (F.phase === 'out'){                        // paddle out to the ground
      if (this._paddle(F.ground.x, F.ground.z, dt)){
        const face = Math.random() * Math.PI * 2;       // line out over the side
        F.line = { face, wx: boat.x + Math.sin(face) * 3.5, wz: boat.z + Math.cos(face) * 3.5, kind: 'fish', boat: true };
        npc.fishing = F.line; npc.heading = face; npc.moving = false;
        F.phase = 'fishing';
      }
    } else if (F.phase === 'fishing'){                    // sit with a line out; bites as on the bank, but better
      npc.moving = false; npc.heading = F.line.face;
      F.left -= dt;
      const g = F.ground;
      if (Math.random() < w.biteRate(g, npc) * dt){
        const got = w.landFish(g);
        addRaw(npc, 'fish', Math.min((npc.packMax || PACK_MAX) - (npc.raw || 0), got));
        w.catches.boatFish += got;
        w._emit({ type: 'catch', who: npc, spot: g, kind: 'fish', n: got });
        npc._caught = { kind: 'fish', n: got, t: w.time, boat: true };
      }
      if (F.left <= 0 || (npc.raw || 0) >= (npc.packMax || PACK_MAX) || g.stock < FISH_LOW || w.night > 0.3 || w.rain >= RAIN_SEEK){
        npc.fishing = null; if (g.taken === npc) g.taken = null;
        F.phase = 'back';                                 // and home with it
      }
    } else if (F.phase === 'back'){                       // paddle back to where the boat was moored, and step ashore
      if (this._paddle(F.moor.x, F.moor.z, dt)){
        boat.placeAt(F.moor.x, F.moor.z, F.moor.yaw);
        npc.x = F.board.x; npc.z = F.board.z; npc.rideY = null; npc._inBoat = false;
        boat.aboard = false; boat._claimed = null;
        this.endFerry();
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
    if (F && F.ground && F.ground.taken === this.npc) F.ground.taken = null;
    if (F && F.mode === 'fish') this.npc.fishing = null;
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
    for (const fr of this.fires){
      if (fr.lit && Math.hypot(nx - fr.x, nz - fr.z) < FIRE_SHY_R + 0.4){ intoFire = true; break; }
    }
    if (!intoFire && walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){
      npc.x = nx; npc.z = nz; npc.moving = true; npc.heading = this.wanderH;
    } else { this.wanderH += Math.PI * 0.7; this.wanderT = 1 + Math.random() * 2; }
  }
}

// ------------------------------------------------------------------- shrines
// A great faced tree and the rite that grows around it. Straight out of Alexander:
//
//   HOLY GROUND (66) — "form a series of nested precincts, each marked by a
//   gateway, each one progressively more private and more sacred than the last,
//   the innermost a final sanctum that can only be reached by passing through all
//   of the outer ones." He notes the organisation itself "can create the sacredness
//   of sites, perhaps even encourage the slow emergence of coherent rites of
//   passage" — which is exactly what we want: no scripted ceremony, just the
//   pattern, and the rite falls out of it. At the innermost sanctum he suggests
//   "no more than a simple tree" — which is what we already have.
//   SACRED SITES (24) — "a tree, or rock or stone, takes on the power through
//   which people can connect themselves to their own past"; a site is embellished
//   by the progression of spaces approaching it.
//   SITTING WALL (243) — surround an outdoor area with a low wall "wide enough to
//   sit on"; an *ambiguous boundary* that marks without shutting out.
//   SOMETHING ROUGHLY IN THE MIDDLE (126) — "resist the impulse to put it exactly
//   in the middle", so the rings sit slightly off the trunk and every stone is
//   jittered: grown, not drawn.
//
// The folk lay ordinary stones in the outer ring; the innermost precinct takes
// only what they actually value — a shell, amber, quartz given up for good.
const RING_R      = [3.5, 2.1];  // outer → inner precinct radii
const STONE_GAP   = 1.15;        // spacing along a ring
const GATE_SLOTS  = 2;           // slots left empty: the gateway (66)
const GATE_OFFSET = 2.4;         // inner gate turned away from the outer one, so the
                                 // approach must wind round inside — "layers of access"
const GATE_PAUSE  = 1.5;         // pause at each gate, ZEN VIEW (134)

class Shrine {
  constructor(x, z, rng){
    this.x = x; this.z = z;                  // the tree: the sanctum itself
    // 126: not exactly in the middle
    this.cx = x + (rng() - 0.5) * 0.7;
    this.cz = z + (rng() - 0.5) * 0.7;
    this.rings = RING_R.map((r, i) => {
      const n = Math.max(6, Math.round(2 * Math.PI * r / STONE_GAP));
      const gate = rng() * Math.PI * 2 + i * GATE_OFFSET;
      const slots = [];
      for (let k = 0; k < n; k++){
        const a = gate + (k + GATE_SLOTS) * (Math.PI * 2 / n);   // skip the gateway arc
        if (k >= n - GATE_SLOTS) break;
        const jr = r + (rng() - 0.5) * 0.22, ja = a + (rng() - 0.5) * 0.10;
        slots.push({ a: ja, x: this.cx + Math.sin(ja) * jr, z: this.cz + Math.cos(ja) * jr,
                     kind: null, precious: i === RING_R.length - 1, ring: i,
                     yaw: rng() * Math.PI * 2, size: 0.8 + rng() * 0.5 });
      }
      return { r, gate, slots };
    });
    this._preLay(rng);
  }

  // The rite is older than the player. Each shrine starts part-built — most barely
  // begun, some well under way, a few with the outer precinct long finished and an
  // offering or two already at the heart — so a wanderer finds a living practice
  // rather than a bare tree waiting to be started. Seeded: one WORLD_SEED always
  // grows the same shrines. Stones fill round from the gateway, the same order the
  // folk will carry on in.
  _preLay(rng){
    const age = rng();
    const frac = age < 0.30 ? rng() * 0.3            // barely begun
               : age < 0.85 ? 0.3 + rng() * 0.55     // well under way
               :              1;                      // an old, finished precinct
    const outer = this.rings[0];
    const n = Math.round(outer.slots.length * frac);
    for (let i = 0; i < n; i++) outer.slots[i].kind = 'stone';
    if (frac >= 1){                                   // only then has the inner begun
      const inner = this.rings[1], OFFER = ['shell', 'amber', 'quartz'];
      const m = Math.round(inner.slots.length * rng() * 0.5);
      for (let i = 0; i < m; i++) inner.slots[i].kind = OFFER[(rng() * OFFER.length) | 0];
    }
    this.preLaid = this.stones().length;
  }
  get glade(){ return this.rings[0].r + 1.4; }     // the kept clearing; nothing is cut inside it

  gatePos(i){
    const g = this.rings[i];
    return { x: this.cx + Math.sin(g.gate) * g.r, z: this.cz + Math.cos(g.gate) * g.r };
  }
  // A seat on the stones themselves — SITTING WALL (243): the ring is low and
  // "wide enough to sit on", an ambiguous boundary. Folk at a moot take places
  // round the inner precinct, evenly spread so the circle self-arranges.
  seat(npc){
    const ring = this.rings[this.rings.length - 1];
    if (!this._seats) this._seats = new Map();
    let a = this._seats.get(npc);
    if (a === undefined){
      const taken = new Set(this._seats.values());
      const n = 8;
      for (let k = 0; k < n; k++) if (!taken.has(k)){ a = k; break; }
      if (a === undefined) a = 0;
      this._seats.set(npc, a);
    }
    const t = ring.gate + Math.PI * 2 * (a / 8) + 0.4;
    return { x: this.cx + Math.sin(t) * (ring.r + 0.5), z: this.cz + Math.cos(t) * (ring.r + 0.5) };
  }
  releaseSeat(npc){ this._seats?.delete(npc); }
  ringDone(i){ return this.rings[i].slots.every(s => s.kind); }
  // nested: the outer precinct must be finished before the inner one is begun
  nextSlot(){
    for (let i = 0; i < this.rings.length; i++){
      if (this.ringDone(i)) continue;
      return this.rings[i].slots.find(s => !s.kind) || null;
    }
    return null;
  }
  place(slot, kind){ if (slot && !slot.kind){ slot.kind = kind; this.laid = (this.laid || 0) + 1; this.view?.sync(); return true; } return false; }
  stones(){ return this.rings.flatMap(r => r.slots.filter(s => s.kind)); }
  get total(){ return this.rings.reduce((a, r) => a + r.slots.length, 0); }
}

// ------------------------------------------------------------------ the world
// Owns the affordances, the campfires, and the shared day/night state the
// brains read. Attach it to NPCs, feed it the sky + food sources each frame.
export class AgentWorld {
  constructor(scene, { rng = Math.random, makeFireView = null, makeShelterView = null,
                       makeHutView = null, makeShrineView = null, makeCanoeView = null } = {}){
    this.scene = scene;
    this.rng = rng;        // seeded stream for world-defining draws (see makePersona note)
    // presentation is injected: the game passes CampfireView/ShelterView factories
    // (js/campfire-view.js); the headless harness passes nothing and runs mesh-free.
    this.makeFireView = makeFireView;
    this.makeShelterView = makeShelterView;
    this.makeHutView = makeHutView;
    this.makeShrineView = makeShrineView;
    this.makeCanoeView = makeCanoeView;
    this.fires = [];
    this.trees = [];      // trunk [x,z] list, used to site hearths in clearings
    this.shrines = [];    // the great faced trees folk revere & visit (docs/mycelium.md)
    this.shrubs = [];     // choppable shrubs (firewood)
    this.food = [];       // forage plants (visited, not depleted, by NPCs)
    this.valuables = [];  // rare finds people gather & trade (shells/stones/amber/quartz)
    this.fishing = [];    // places on the bank to fish from (gen/fishing.js)
    this.grounds = [];    // …and grounds out on the deep water, for a boat
    this.catches = { fish: 0, eels: 0, sittings: 0, boatTrips: 0, boatFish: 0 };   // tallies (harness)
    this.birches = [];     // birch trunks { x, z, peeled } — bark for canoes
    this.canoeBuilds = []; // canoes being made on the bank (CanoeBuild)
    this.canoeStats = { started: 0, made: 0, abandoned: 0, bark: 0, found: 0, missed: 0 };   // tallies (harness)
    this._reachAt = new Map();   // boatReachAt cache: launch point -> grounds + where to step in
    this.flowers = [];    // wildflowers elves pick for crown-making
    this._onCrownMade = null;  // callback(npc, flowerIds[]) when elf finishes gathering
    this.npcs = [];       // NPCs that have brains (for pairwise company)
    this.fauna = [];      // rabbits (quarry) — roam, flee, hunted for meat
    this.boats = [];      // communal canoes NPCs ferry across the water (docs/boats.md)
    this.threat = null;   // a {x,z} the fauna flee from too (the player), set per frame
    this.day = 1; this.night = 0; this.evening = 0;
    // social happenings (a talk, a glance, a hand-over) go out here for the game to
    // show (js/talk-view.js, js/toss.js); null in the headless harness
    this.onSocial = null;
    this.cloud = 0;          // sky cloud cover 0..1 (syncSky) — rain sets in past ~0.7
    this.convos = [];        // conversations under way (js/convo.js)
    this.projects = [];      // shared plans under way (js/projects.js)
    this.cookTime = COOK_TIME;   // how long a potful takes (talk answers "how long?")
    this.time = 0;        // in-game day counter (fractional), for sighting memory
    this._nextId = 0;     // hands out stable per-NPC ids (gossip fact keys)
    this.culture = DEFAULT_CULTURE;
    this.shelters = [];    // lean-tos NPCs raise against rain (docs/shelters.md)
    this.huts = [];        // the settled shelter: thatched, slept in (docs/camp.md)
    this.houses = [];      // the villages' dwellings (setHouses; docs/settlements.md)
    this.market = { trades: [], miss: {} };   // trades at village doors, and why calls came to nothing (trade.js)
    this.fields = [];      // ...and their fields
    this.openFires = [];   // fires anyone may come to: all but the households' hearths
    this._siteClaims = [];  // hut sites spoken for but not yet staked (see siteClear)
    this.rain = 0;         // current rain intensity, set from main.js each frame
    this._obGrid = new Map();   // spatial hash of obstacle circles {x,z,r}
    this._obstacles = [];       // flat list (also fed to the nav grid)
    this.nav = new NavGrid();   // A* walkability grid (built in buildNav)
    this._nbrGrid = new Map();  // spatial hash of NPCs, rebuilt each frame (see near())
    this._socialT = 0;          // accumulator for the throttled sightings/gossip pass
    this._scratch = [];         // reused result array for near() — the per-frame passes don't allocate
    this._boatIds = 0;          // canoes get an id when first seen (gossip keys)
  }

  // ---- neighbour lookup -------------------------------------------------------
  // Sightings, gossip and personal space all ask "who is close to me". Done as
  // nested loops that is O(n²) per frame — fine at 32 folk in a 400u world, but
  // the world is 800u now and almost every pair in it is half a mile apart. We
  // bin everyone into NBR_CELL squares once a frame and look only in the 3×3
  // block around the asker, so those passes cost the same however many folk live
  // here. Rebuilt every frame because NPCs move every frame.
  _rebuildNeighbours(){
    this._nbrGrid.clear();
    for (const n of this.npcs){
      const k = Math.floor(n.x / NBR_CELL) + ',' + Math.floor(n.z / NBR_CELL);
      let a = this._nbrGrid.get(k);
      if (!a){ a = []; this._nbrGrid.set(k, a); }
      a.push(n);
    }
  }

  // Everyone within `r` of (x,z) — `r` must be <= NBR_CELL, or the 3×3 block
  // around the point isn't wide enough to contain them all. `out` is reused by
  // the caller so the per-frame passes don't allocate.
  _emit(e){ if (this.onSocial) this.onSocial(e); }

  // a gift of food, from a demand-share or offered in talk (convo.js): the goods
  // move, the giver's standing rises, the hand-over is shown (a toss), and the
  // kindness is witnessed — seeding the reputation gossip carries
  // Kin give from anything they carry, the snacks they keep included (that's what
  // a household's reserve is for), keeping one back; others give only what they
  // can spare. Returns how much was really handed over.
  // ---- trade at a village door (docs/trade.md; the talk is convo.js haggleChain) ----
  // What's on the table between a caller of the folk and a household member: the
  // deal trade.js strike finds, the crop the caller wants most, the bid and the
  // counter either side of the deal, and the wild food the household is short of.
  tradeTerms(a, v, h){
    const now = this.time;
    const vCap = (v.packMax || PACK_MAX) - (v.pack || 0);
    const offers = [];
    for (const g of tradeGoods(a)){
      // what the villager has room for: pack food in the pack, raw in the raw bag
      const room = g.from === 'pack' ? vCap : g.from === 'raw' ? PACK_MAX - (v.raw || 0) : TRINKET_MAX - (v.trinkets || 0);
      const have = Math.min(g.have, room);
      if (have > 0) offers.push({ ...g, have, a: worth(a, g.kind, g.have, now), b: worth(v, g.kind, g.kind === 'trinket' ? (v.trinkets || 0) : stockOf(v, g.kind), now) });
    }
    const wants = Object.entries(h.spare).filter(([, k]) => k > 0).map(([c, k]) => ({ kind: c, have: k,
      a: worth(a, c, countOf(a, c), now), b: worth(v, c, k + countOf(v, c), now) }));
    const room = (a.packMax || PACK_MAX) - (a.pack || 0);
    const deal = room > 0 && offers.length && wants.length ? strike(offers, wants, 3, room) : null;
    let bidQ = deal && deal.qn, askQ = bidQ;
    if (deal){ const e = ends(offers.find(o => o.kind === deal.give), wants.find(x => x.kind === deal.get), deal); bidQ = Math.min(e.bid, room); askQ = e.ask; }
    return { deal, bidQ, askQ,
      want: wants.length ? wants.reduce((x, y) => y.a > x.a ? y : x).kind : null,
      wish: wishOf(v, k => stockOf(v, k), now),
      show: (offers.length ? offers : tradeGoods(a)).reduce((x, y) => !x || y.have > x.have ? y : x, null)?.kind || null };
  }
  // "Done.": the goods change hands, if they're all still there — it's been a few
  // turns of talk, and something may have been eaten. Returns whether it happened.
  tradeDone(a, v, h, d, t){
    const now = this.time, M = this.market;
    if (!d){ M.miss['no deal'] = (M.miss['no deal'] || 0) + 1; this.tradePlan(a, h, t.wish); return false; }
    const g = tradeGoods(a).find(x => x.kind === d.give);
    const room = (a.packMax || PACK_MAX) - (a.pack || 0) + (g && g.from === 'pack' ? d.gn : 0);
    if (!g || g.have < d.gn || (h.spare[d.get] || 0) < d.qn || room < d.qn){ M.miss.gone = (M.miss.gone || 0) + 1; return false; }
    let item = 'food';
    if (g.from === 'trinket'){ a.trinkets -= d.gn; v.trinkets = (v.trinkets || 0) + d.gn; if (!v.trinketKind) v.trinketKind = a.trinketKind; item = 'gem'; }
    else if (g.from === 'raw') addRaw(v, d.give, takeRaw(a, d.give, d.gn));
    else giveAll(v, takeFood(a, d.gn, now, d.give), now);
    h.spare[d.get] -= d.qn;
    addFood(a, d.get, d.qn, now);
    this._emit({ type: 'give', from: a, to: v, item, kind: d.give });
    this._emit({ type: 'give', from: v, to: a, item: 'food', kind: d.get });
    nudge(a, v, 0.05, 0.04); nudge(v, a, 0.05, 0.04);
    if (!a._partners) a._partners = new Map();
    a._partners.set(h, (a._partners.get(h) || 0) + 1);
    const rec = { t: now, folk: a, villager: v, house: h, gave: d.give, gn: d.gn, got: d.get, qn: d.qn };
    h.ledger.push(rec); if (h.ledger.length > 12) h.ledger.shift();
    M.trades.push(rec); if (M.trades.length > 300) M.trades.shift();
    a._lastTrade = rec; v._lastTrade = rec;
    const tp = tradePlanOf(a, now); if (tp && tp.item === d.give) dropPlan(a, tp);   // brought what they gathered for
    if (t.wish && t.wish !== d.give) this.tradePlan(a, h, t.wish);
    // and it's news: a rate, and what the village is short of, for the gossip to carry
    addNews(a, { kind: 'market', key: 'market:' + this.houses.indexOf(h), subj: a, house: h, x: h.mouth.x, z: h.mouth.z,
      give: d.give, gn: d.gn, get: d.get, qn: d.qn, wish: t.wish, t: now, hops: 1 });
    return true;
  }
  // one of the folk means to bring a household what it's short of (heard at the
  // door, or of a trade in talk): gathering it is now on their agenda (wantedKinds)
  tradePlan(n, h, item){
    if (n.home || !item || !h) return;
    const p = tradePlanOf(n, this.time);
    if (p && p.item === item && p.house === h){ p.until = this.time + TRADE_DAYS; return; }
    addPlan(n, { kind: 'trade', item, house: h, until: this.time + TRADE_DAYS });
  }

  giveFood(giver, a){
    const kin = !!(giver.group && giver.group === a.group);
    const give = Math.min(SHARE_QTY, (giver.pack || 0) - (kin ? 1 : SHARE_KEEP));
    if (give <= 0) return 0;
    const got = kin ? takeFood(giver, give, this.time) : takeSpare(giver, give, this.time);
    if (!total(got)) return 0;
    giveAll(a, got, this.time);
    giver.esteem = (giver.esteem || 0) + GIVE_ESTEEM;
    this._emit({ type: 'give', from: giver, to: a, item: 'food', kind: giver.packKind });
    nudge(a, giver, 0.05, 0.15); nudge(giver, a, 0.05, 0.03);   // a gift is remembered
    const fact = { kind: 'kind', key: 'kind:' + giver.id, subj: giver, obj: a, x: giver.x, z: giver.z, t: this.time };
    for (const o of this.npcs)
      if (o !== giver && Math.hypot(o.x - giver.x, o.z - giver.z) <= SIGHT_RANGE) addNews(o, { ...fact });
    return total(got);
  }

  near(x, z, r, out = []){
    out.length = 0;
    const cx = Math.floor(x / NBR_CELL), cz = Math.floor(z / NBR_CELL), r2 = r * r;
    for (let gx = cx - 1; gx <= cx + 1; gx++){
      for (let gz = cz - 1; gz <= cz + 1; gz++){
        const a = this._nbrGrid.get(gx + ',' + gz);
        if (!a) continue;
        for (const o of a){
          const dx = o.x - x, dz = o.z - z;
          if (dx*dx + dz*dz <= r2) out.push(o);
        }
      }
    }
    return out;
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
      if (builtBand(px, pz) >= 2) return false;                             // nor in a settlement
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
  setBoats(boats){ this.boats = boats && boats.list ? boats.list : (boats || []); this._boatYard = boats && boats.add ? boats : null; }
  setBirches(list){ this.birches = (list || []).map(t => ({ x: t.x, z: t.z, peeled: null })); }
  nearestBirch(x, z, r){
    let best = null, bd = r;
    for (const t of this.birches){ if (t.peeled) continue; const d = Math.hypot(t.x - x, t.z - z); if (d < bd){ bd = d; best = t; } }
    return best;
  }

  // Where to make a canoe: a bank near the maker where deep water comes close in
  // (the fishing spots are just that), with grounds a canoe launched there could
  // reach. The bed is set back from the edge; the launch is out where it floats.
  canoeSite(npc){
    let best = null, bv = -Infinity;
    for (const s of this.fishing){
      const d = Math.hypot(s.x - npc.x, s.z - npc.z);
      if (d > CANOE_SITE_R || this.canoeBuilds.some(b => Math.hypot(b.x - s.x, b.z - s.z) < 25)) continue;
      const dx = Math.sin(s.face), dz = Math.cos(s.face);
      let bx = s.x - dx * 2.5, bz = s.z - dz * 2.5;
      if (!walkable(bx, bz) || builtBand(bx, bz)){ bx = s.x; bz = s.z; }
      let lx = null, lz = null;
      for (let r = 1.5; r <= 8; r += 0.6){ const px = s.x + dx * r, pz = s.z + dz * r; if (height(px, pz) < WATER - 0.3){ lx = px; lz = pz; break; } }
      if (lx === null) continue;
      const out = this.boatReachAt(lx, lz);
      if (!out.grounds.length || !out.board) continue;
      const v = Math.min(out.grounds.length, 4) * 25 - d;        // a few grounds in reach, as near as may be
      if (v > bv){ bv = v; best = { x: bx, z: bz, face: s.face, launch: { x: lx, z: lz, yaw: Math.atan2(-dx, -dz) } }; }
    }
    return best;
  }
  addCanoeBuild(site, owner){
    const b = new CanoeBuild(this, site, owner);
    if (this.makeCanoeView) this.makeCanoeView(b);   // sets b.view + b.group
    if (b.group) this.scene.add(b.group);
    this.canoeBuilds.push(b); this.canoeStats.started++;
    return b;
  }
  removeCanoeBuild(b){
    const i = this.canoeBuilds.indexOf(b); if (i < 0) return;
    this.canoeBuilds.splice(i, 1);
    if (b.group) this.scene.remove(b.group);
    b.view?.dispose?.();
    for (const n of this.npcs){
      if (n.plans) for (const p of [...n.plans]) if (p.build === b) dropPlan(n, p);
      if (n.brain && n.brain._canoeSpell && n.brain._canoeSpell.b === b) n.brain._canoeSpell = null;
    }
  }
  // finished: off the bed and into the water, an ordinary canoe anyone may take,
  // and everyone who had a hand in it knows where it lies
  finishCanoe(b){
    const L = b.launch;
    const boat = this._boatYard ? this._boatYard.add(L.x, L.z, L.yaw)
      : (this.boats.push({ x: L.x, z: L.z, yaw: L.yaw, aboard: false, _claimed: null, deckY: WATER + 0.42,
          placeAt(nx, nz, ny){ this.x = nx; this.z = nz; this.yaw = ny; } }), this.boats[this.boats.length - 1]);
    boat.madeBy = b.owner;
    for (const n of b.hands) addNews(n, this.canoeFact(boat, boat.x, boat.z, this.time));
    this.canoeStats.made++;
    this._emit({ type: 'canoe', who: b.owner, x: boat.x, z: boat.z });
    this.removeCanoeBuild(b);
    return boat;
  }

  // the choppable shrubs (firewood). Records carry .alive and .chop() (flora.js).
  setShrubs(shrubs){ this.shrubs = shrubs || []; }
  // list: [{ x, z, hear? }] — `hear()` is injected by main.js and returns whatever
  // the wood is carrying at that tree (a fact from the mycelium), or null. The sim
  // stays ignorant of the network: it only knows some trees can be listened to.
  setShrines(list){
    this.shrines = (list || []).map(s => {
      const sh = new Shrine(s.x, s.z, this.rng);
      sh.hear = typeof s.hear === 'function' ? s.hear : null;
      if (this.makeShrineView) this.makeShrineView(sh);   // sets sh.view (js/shrine-view.js)
      return sh;
    });
  }
  // nearest still-standing shrub to (x,z), within reach, or null
  // The taboo: nothing is cut inside a sacred glade. The commonest rule at real
  // sacred trees — a Japanese shinboku is never felled, and sacred groves stand
  // while the wood around them is worked (docs/sacred-trees.md §F; SACRED SITES 24,
  // "protect them absolutely"). So the folk simply never see firewood there and go
  // elsewhere for it, and the glade stays whole.
  inSacredGlade(x, z){
    for (const sh of this.shrines) if (Math.hypot(sh.x - x, sh.z - z) < sh.glade) return true;
    return false;
  }
  nearestShrub(x, z, range = 45){
    let best = null, bd = range;
    for (const s of this.shrubs){
      if (!s.alive) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd && !this.inSacredGlade(s.x, s.z)){ bd = d; best = s; }
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
    for (const f of this.fires){ if (f.home) continue; const d = Math.hypot(f.x - x, f.z - z); if (d < nd){ nd = d; nearest = f; } }
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
    if (this.makeFireView) this.makeFireView(f);     // sets f.view + f.group
    this.fires.push(f);
    if (f.group) this.scene.add(f.group);
    this._fireLists();
    return f;
  }
  // which fires each person sees (Brain.fires): the open ones, plus — for a
  // villager — their own household's hearth. Rebuilt whenever a fire comes or goes.
  _fireLists(){
    this.openFires = this.fires.filter(f => !f.home);
    for (const h of this.houses) h.fireList = h.fire ? [...this.openFires, h.fire] : this.openFires;
  }

  // The villages' dwellings, from the land's settlements (gen/settle.js): one
  // House each, with a hearth laid and lit in the middle of its floor. Returns
  // the houses, in the order households are given them.
  setHouses(S){
    this.houses = []; this.fields = [];
    for (const p of S.places) for (const b of p.buildings){
      if (!b.dwelling) continue;
      const h = new House(this, b);
      // its hearth: a real Campfire (woodpile, pot, store) the household keeps,
      // but indoors — never drawn, never lit for anyone else (Brain.fires)
      const f = new Campfire(this, b.x, b.z);
      f.home = h; f.addFood(6);                  // something in the store to start
      f.burnK = 0.2;                             // a hearth kept low burns a fifth of a campfire's wood
      this.fires.push(f);
      h.fire = f; h.well = p.well || null;
      const fd = (p.fields || []).find(x => x.house === b);
      if (fd){ h.field = new Field(this, fd, h); this.fields.push(h.field); h.spare[h.field.crop] = CROP_SPARE; }   // last harvest's spare
      this.houses.push(h);
    }
    this._fireLists();
    return this.houses;
  }
  // give a household its house: they sleep there, shelter there, cook at its hearth, work its field
  settleIn(npcs, h){
    for (const n of npcs){ n.home = h; h.household.push(n); }
  }
  // remove a hearth from the world (e.g. a half-laid one its builder gave up on)
  removeFire(f){
    if (!f) return;
    const i = this.fires.indexOf(f); if (i >= 0) this.fires.splice(i, 1);
    if (f.group) this.scene.remove(f.group);
    for (const n of this.npcs) if (n.brain) n.brain._blacklist.delete(f);
    this._fireLists();
  }

  // ---- huts (docs/camp.md) ----------------------------------------------------
  // Is this ground fit to stand a hut on? Same demands as a hearth (dry, level,
  // grass, clear of trunks) — a hut is a lighter thing than a fire, but it is a
  // place people sleep, and nobody sleeps on a slope or in a bog.
  hutGroundOk(x, z, rad = HUT_RAD[1]){
    if (Math.hypot(x, z) >= WORLD_R || !walkable(x, z)) return false;
    if (terrainType(x, z) !== 'grass') return false;
    if (builtBand(x, z) >= 2) return false;                         // not on a settlement's green, lanes or yards
    if (ringSpread(x, z, rad) > MAX_FIRE_SPREAD) return false;      // not on a hillside, across the whole floor
    for (const o of this.obstaclesNear(x, z)){
      if (o.alive === false) continue;
      const clear = o.r >= 0.85 ? HUT_TREE_CLEAR : HUT_SHRUB_CLEAR;
      if (Math.hypot(x - o.x, z - o.z) < o.r + rad + clear) return false;   // the whole dome, and a path round it
    }
    // nor over anything that grows to eat: an apple tree through the thatch, or a
    // berry bush nobody can reach again (foragers ground at the wall, flipping)
    for (const pl of this.foodNear(x, z, rad + 3)){
      const clear = pl.kind === 'apples' ? 0.9 + HUT_TREE_CLEAR : pl.kind === 'berries' || pl.kind === 'hazelnuts' ? 0.6 + HUT_SHRUB_CLEAR : 0.5;
      if (Math.hypot(x - pl.x, z - pl.z) < rad + clear) return false;
    }
    for (const sh of this.shrines) if (Math.hypot(x - sh.x, z - sh.z) < rad + Math.max(...RING_R) + 1) return false;   // nor on holy ground
    return true;
  }
  // food plants near a point, by a coarse grid built once (plants don't move)
  foodNear(x, z, r){
    if (!this._foodGrid || this._foodGridOf !== this.food){
      this._foodGrid = new Map(); this._foodGridOf = this.food;
      for (const pl of this.food){ const k = Math.floor(pl.x / 8) + ',' + Math.floor(pl.z / 8); let a = this._foodGrid.get(k); if (!a) this._foodGrid.set(k, a = []); a.push(pl); }
    }
    const out = [];
    for (let cx = Math.floor((x - r) / 8); cx <= Math.floor((x + r) / 8); cx++)
      for (let cz = Math.floor((z - r) / 8); cz <= Math.floor((z + r) / 8); cz++){
        const a = this._foodGrid.get(cx + ',' + cz); if (a) for (const pl of a) if (Math.hypot(pl.x - x, pl.z - z) < r) out.push(pl);
      }
    return out;
  }
  // The huts that ring a hearth — by PROXIMITY, not by which fire object they
  // were raised at. Cold hearths crumble (FIRE_RECLAIM) and a fire relit on the
  // same ground is a new object, so identity would let a camp grow a second full
  // ring of six on top of the first.
  hutsAt(fire){
    const far = (fire.ringR || 2.3) + HUT_RAD[1] * 2 + HUT_RING[HUT_RING.length - 1] + HUT_GAP;
    return this.huts.filter(h => Math.hypot(h.x - fire.x, h.z - fire.z) < far);
  }

  // Somewhere to cut an armful of thatch: open meadow, near at hand. Grass isn't
  // a placed object in the Lea (it's a billboard field), so the affordance is the
  // ground itself — walk to open grass and cut. Returns [x,z] or null.
  thatchSpot(x, z){
    for (let k = 0; k < 14; k++){
      const a = this.rng() * Math.PI * 2, r = 3 + this.rng() * 15;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.hypot(px, pz) >= WORLD_R || !walkable(px, pz)) continue;
      if (terrainType(px, pz) !== 'grass') continue;
      if (this.inObstacle(px, pz)) continue;
      return [px, pz];
    }
    return null;
  }

  // Where a hut goes. On the ring OUTSIDE the fire's sitting circle, doorway to
  // the hearth — and, the part that matters socially, in the arc where this
  // person's own kin have already settled (Pat. 37 HOUSE CLUSTER). With no kin
  // here they take the widest gap in the ring, so strangers end up across the
  // clearing from each other. Returns {x,z,angle} or null if the ring is full.
  hutSite(fire, npc){
    const here = this.hutsAt(fire);
    if (here.length >= HUTS_PER_FIRE) return null;
    const angOf = h => Math.atan2(h.x - fire.x, h.z - fire.z);
    let base = null;
    for (const h of here) if (h.kin && npc.group && h.kin === npc.group){ base = angOf(h); break; }
    if (base === null){
      if (!here.length) base = this.rng() * Math.PI * 2;
      else {                                   // the widest gap between standing huts
        const angs = here.map(angOf).sort((a, b) => a - b);
        let widest = -1;
        for (let i = 0; i < angs.length; i++){
          const a0 = angs[i];
          const a1 = i + 1 < angs.length ? angs[i + 1] : angs[0] + Math.PI * 2;
          if (a1 - a0 > widest){ widest = a1 - a0; base = a0 + (a1 - a0) / 2; }
        }
      }
    }
    // How big a hut this person will raise: a household's worth. Someone with kin
    // about them builds for a family; a loner builds for themself.
    const kin = npc.group ? this.npcs.reduce((c, o) => c + (o.group === npc.group ? 1 : 0), 0) : 1;
    const want = HUT_RAD[0] + (HUT_RAD[1] - HUT_RAD[0]) * clamp01((kin - 1) / 4);
    const rad = Math.min(HUT_RAD[1], Math.max(HUT_RAD[0], want + (this.rng() - 0.5) * 0.3));

    for (let k = 0; k < 24; k++){
      // fan out from the base angle, alternating sides, so we settle as near our
      // kin as the ground allows — in fine steps, because in the wood the open
      // ground between trunks comes in narrow wedges a coarse fan steps over
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      for (const gap of HUT_RING){
        const r = (fire.ringR || 2.3) + rad + gap;   // clear of the seats, whatever its size
        const x = fire.x + Math.sin(a) * r, z = fire.z + Math.cos(a) * r;
        if (!this.hutGroundOk(x, z, rad)) continue;
        if (!this.siteClear(x, z, rad, npc)) continue;
        return { x, z, rad, angle: Math.atan2(fire.x - x, fire.z - z) };   // doorway to the fire
      }
    }
    return null;
  }

  // Is there room here for a hut of this size? Walls must clear walls — with huts
  // of different sizes a fixed centre-to-centre spacing is simply wrong — and a
  // site someone else is walking toward counts as taken.
  //
  // That second half is what stopped huts overlapping. A site used to be judged
  // only against huts that already STOOD, and a hut did not exist until its
  // builder arrived and began — so two people could pick neighbouring spots, walk
  // there, and each raise a hut through the other. The claim closes that window:
  // choosing a site takes it out of circulation before anyone sets off.
  siteClear(x, z, rad, npc){
    for (const h of this.huts)
      if (Math.hypot(h.x - x, h.z - z) < h.rad + rad + HUT_GAP) return false;
    for (const c of this._siteClaims)
      if (c.npc !== npc && Math.hypot(c.x - x, c.z - z) < c.rad + rad + HUT_GAP) return false;
    return true;
  }
  claimSite(npc, site){
    this.releaseSite(npc);
    this._siteClaims.push({ npc, x: site.x, z: site.z, rad: site.rad, t: SITE_CLAIM_T });
  }
  releaseSite(npc){
    const i = this._siteClaims.findIndex(c => c.npc === npc);
    if (i >= 0) this._siteClaims.splice(i, 1);
  }

  addHut(x, z, angle, owner, fire, rad){
    const h = new Hut(this, x, z, angle, owner, fire, rad);
    this.nav?.block(x, z, rad, 1);                    // routes go round it, not through the wall
    if (this.makeHutView) this.makeHutView(h);       // sets h.view + h.group
    if (h.group) this.scene.add(h.group);
    this.huts.push(h); return h;
  }
  removeHut(h){
    if (!h) return;
    for (const n of this.npcs){        // nobody is left "inside" a hut that is gone
      if (n.brain && n.brain._buildingHut === h) n.brain._buildingHut = null;
      if (n._hutIn === h) n._hutIn = null;
      if (n._hutWant === h) n._hutWant = null;
      if (n._skirt && n._skirt.h === h) n._skirt = null;
    }
    const i = this.huts.indexOf(h); if (i < 0) return;
    this.huts.splice(i, 1);
    this.nav?.block(h.x, h.z, h.rad, -1);
    if (h.group) this.scene.remove(h.group);
  }

  // place a lean-to near (x,z), open front facing the nearest campfire
  addShelter(x, z){
    let angle = Math.random() * Math.PI * 2;
    let nd = 50;
    for (const f of this.fires){
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < nd){ nd = d; angle = Math.atan2(f.x - x, f.z - z); }
    }
    const s = new Shelter(this, x, z, angle);
    if (this.makeShelterView) this.makeShelterView(s);   // sets s.view + s.group
    if (s.group) this.scene.add(s.group);
    this.shelters.push(s); return s;
  }
  removeShelter(s){
    if (!s) return;
    const i = this.shelters.indexOf(s); if (i >= 0) this.shelters.splice(i, 1);
    if (s.group) this.scene.remove(s.group);
  }

  // Keep bodies on the right side of a hut's wall. Called after everything that
  // can move someone — the brains, and the personal-space pass, which would
  // otherwise shove an occupant out through the thatch.
  //
  // The rule is one rule, applied to everyone: **you may only cross the wall
  // through the doorway.** `_hutIn` records whose hut you are inside, and is set
  // only at the moment you cross at the door, so nobody can end up indoors by
  // drifting through the back.
  confine(npc){
    for (const h of this.huts){
      if (h.frame <= 0) continue;      // no walls yet: nothing to keep anyone out of
      const dx = npc.x - h.x, dz = npc.z - h.z;
      const d2 = dx * dx + dz * dz;
      const W = h.rad;
      if (d2 >= (W + 0.6) * (W + 0.6)){
        if (npc._hutIn === h) npc._hutIn = null;      // stepped clear of it
        continue;
      }
      const d = Math.sqrt(d2) || 1e-4;
      const put = (r) => { npc.x = h.x + dx / d * r; npc.z = h.z + dz / d * r; };
      if (d >= W){                                    // outside, but close
        if (npc._hutIn === h) npc._hutIn = null;
        continue;
      }
      if (npc._hutIn === h){
        // Inside, rightfully. Held off the wall so no body pokes through the
        // thatch — BUT the doorway is open both ways. Without that exception the
        // clamp is a cage: it holds everyone inside the wall, so an occupant can
        // never reach it to be let out again.
        if (!h.atDoor(npc.x, npc.z) && d > h.inner) put(h.inner);
        continue;
      }
      // crossing the wall: allowed only at the doorway, and only if this is the
      // hut we're actually making for
      if (npc._hutWant === h && h.atDoor(npc.x, npc.z)){ npc._hutIn = h; continue; }
      put(W + HUT_BODY);                              // else the wall stops you
    }
  }

  // Canoes in sight are known where they lie (gossip.js knowCanoe); the nearest is
  // news worth passing on. Come to where one was known to be, and it isn't in
  // sight: it's forgotten — someone's taken it, and it may turn up elsewhere.
  seeCanoes(n, now){
    let near = null, nd = CANOE_SIGHT;
    for (const b of this.boats){
      const d = Math.hypot(b.x - n.x, b.z - n.z);
      if (d > CANOE_SIGHT) continue;
      knowCanoe(n, b, b.x, b.z, now);
      if (d < nd && !b.aboard){ nd = d; near = b; }
    }
    if (near) addNews(n, this.canoeFact(near, near.x, near.z, now));
    else if (n.canoes && n.canoes.size && !(n.news && [...n.news.values()].some(f => f.kind === 'boat'))){
      // none in sight: the one they know best stays something to tell (the news fades sooner than the memory)
      let best = null; for (const [b, k] of n.canoes) if (!best || k.t > best[1].t) best = [b, k];
      addNews(n, this.canoeFact(best[0], best[1].x, best[1].z, best[1].t, best[1].from));
    }
    if (n.canoes) for (const [b, k] of n.canoes)
      if (Math.hypot(k.x - n.x, k.z - n.z) < CANOE_GONE && Math.hypot(b.x - n.x, b.z - n.z) > CANOE_SIGHT) n.canoes.delete(b);
  }

  canoeFact(b, x, z, t, from = null){
    const id = b._cid ?? (b._cid = ++this._boatIds);
    return { kind: 'boat', key: 'boat:' + id, boat: b, x, z, t, maker: b.madeBy || null, ...(from ? { from, hops: 1 } : {}) };
  }

  setFood(plants){ this.food = plants || []; }
  setValuables(list){ this.valuables = list || []; }
  setFishing(spots, grounds = []){ this.fishing = spots || []; this.grounds = grounds || []; }
  // from where a canoe lies: the dry land to step in from, and the grounds it can
  // paddle straight out to over open water. Cached by place.
  // (Judged from a place, so the folk can ask it of where they THINK a canoe is.)
  boatReachAt(x, z){
    const key = `${x | 0},${z | 0}`;
    const hit = this._reachAt.get(key); if (hit) return hit;
    const grounds = [];
    for (const g of this.grounds){
      const d = Math.hypot(g.x - x, g.z - z);
      if (d >= BOAT_OUT) continue;
      let open = true;
      for (let r = 3; r < d && open; r += 3) if (height(x + (g.x - x) * r / d, z + (g.z - z) * r / d) > WATER - 0.2) open = false;
      if (open) grounds.push(g);
    }
    const sp = grounds.length ? this.clearSpot(x, z) : null;
    if (this._reachAt.size > 400) this._reachAt.clear();
    const out = { key, grounds, board: sp ? { x: sp[0], z: sp[1] } : null };
    this._reachAt.set(key, out);
    return out;
  }
  // how likely a bite is, per second, for this person at this spot now
  biteRate(s, a){
    const rise = 1 + FISH_RISE * (this.evening || 0);
    const skill = a && a.persona ? 0.6 + 0.4 * (a.persona.perception || 1) : 1;   // a keen eye sees the float dip
    return FISH_RATE * s.stock * rise * skill * (s.kind === 'eels' ? 0.8 : 1) * (s.boat ? BOAT_BITE : 1);
  }
  // a fish on the line: how many, and the stock they take
  landFish(s){
    const n = s.kind === 'eels' ? 1 + (Math.random() < 0.3 ? 1 : 0) : 1 + (Math.random() < 0.45 ? 1 : 0);
    s.stock = Math.max(0, s.stock - FISH_TAKE * n);
    this.catches[s.kind] = (this.catches[s.kind] || 0) + n;
    return n;
  }
  setFlowers(list){ this.flowers = list || []; }
  setOnCrownMade(cb){ this._onCrownMade = cb || null; }

  // scatter `n` rabbits across walkable land (the quarry; drawn by js/fauna.js)
  spawnFauna(n = FAUNA_N){
    for (let i = 0; i < n; i++){
      for (let k = 0; k < 40; k++){
        const a = this.rng() * Math.PI * 2, r = this.rng() * WORLD_R * 0.85;
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
    const p = npc.persona = makePersona(this.rng);
    if (npc.group && npc.group.kind === 'lone') p.company = Math.min(p.company, 0.65);   // loners keep apart
    npc.packMax      = Math.max(3, Math.round(PACK_MAX * p.strength));     // strong → carries more food
    npc.trinketMax   = Math.max(3, Math.round(TRINKET_MAX * p.strength));
    npc.chopTime     = CHOP_TIME / p.strength;                             // strong → fells shrubs faster
    npc.collectRange = COLLECT_RANGE * p.perception;                       // keen-eyed → spots finds further off
    // a name fitting the sprite's race; kin (family/clan) share their group surname
    const nm = makeName(npc.slug, this.rng);
    const surname = (npc.group && npc.group.surname) || nm.surname;
    npc.race = nm.race; npc.given = nm.given; npc.surname = surname; npc.gender = nm.gender;
    npc.name = composeName({ given: nm.given, surname, full: `${nm.given} ${surname}` }, p, this.rng);
    // comfortable distance: solitary folk keep more room, sociable folk less
    npc.personalSpace = culture.personalSpace * (1.5 - 0.45 * p.company) * (0.9 + this.rng() * 0.2);
    npc.seen = new Map();   // groupmate -> { x, z, t } last-sighting memory (kin dialogue)
    npc.id = this._nextId++;   // stable id, so gossip can key facts by subject
    npc.news = new Map();      // small decaying store of facts heard or seen (see gossip)
    npc.esteem = 0;            // social standing — rises by giving, falls by hoarding (sharing)
    npc.stargazer = this.rng() < STARGAZER_CHANCE;   // some read the stars & spread omens (astrology)
    // and some are root-wise: they can hear what the wood carries at a great tree
    // and repeat it — the folk's only ear on the mycelium (docs/sacred-trees.md §H)
    npc.rootwise = this.rng() < ROOTWISE_CHANCE;
    npc._omenCd = this.rng() * OMEN_CD[1];
    this.npcs.push(npc);
    return npc;
  }

  syncSky(sky){ this.day = sky.day ?? 1; this.night = sky.night ?? 0; this.evening = sky.evening ?? 0; this.time = sky.time ?? this.time; this.cloud = sky.cloudCover ?? 0;
    this.moonLon = sky.moonLon ?? 0; this.sunLon = sky.sunLon ?? 0; this.moonIllum = sky.moonIllum ?? 0; }   // for astrology

  update(dt){
    this._rebuildNeighbours();   // bins for near(); everything below asks it instead of scanning everyone

    // the fish come back to a spot left alone
    if (this.fishing.length){
      const d = this.time - (this._fishT ?? this.time); this._fishT = this.time;
      if (d > 0) for (const s of [...this.fishing, ...this.grounds]) if (s.stock < 1) s.stock = Math.min(1, s.stock + FISH_STOCK * d);
    }

    // The moot (docs/sacred-trees.md §G — the West African palaver tree, where a
    // village argues out its disputes under the great baobab). Enough folk sitting
    // the stone ring together turns a solitary devotion into an assembly: company
    // is sated far more deeply, as at the night fire. The gossip layer needs no
    // help — sitting a shared ring already puts them in each other's range.
    for (const sh of this.shrines){
      // count everyone AT the rite in the glade, not only those already seated —
      // the approach (gates, circuit, laying a stone) takes longer than the sitting,
      // so counting seats alone meant two visits could never overlap and no moot
      // could ever form.
      let present = 0, seated = 0;
      for (const n of this.near(sh.x, sh.z, sh.glade, this._scratch)){
        if (n.actionLabel === 'revere'){ present++; if (n.sitting) seated++; }
      }
      sh.present = present; sh.seated = seated;
      sh.moot = present >= GATHER_MIN;
    }

    const keep = [];
    for (const f of this.fires){
      f.update(dt);
      const near = this.near(f.x, f.z, TEND_RADIUS, this._scratch).length > 0;
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
        const abandoned = !f.home && f.done && !near && (f.pot.raw + f.pot.ready) <= 0 && f.woodpile <= 0;   // a house's hearth is never reclaimed
        f.deadT = abandoned ? (f.deadT || 0) + dt : 0;
        if (f.deadT > FIRE_RECLAIM){
          if (f.group) this.scene.remove(f.group);
          for (const n of this.npcs) if (n.brain) n.brain._blacklist.delete(f);
        } else keep.push(f);
      }
    }
    if (keep.length !== this.fires.length){ this.fires = keep; this._fireLists(); }
    for (const fd of this.fields) fd.tick(dt);   // the crops grow
    // the roofs rot (fast under rain) — mending them is the folk's own business
    for (const h of this.huts) h.tick(dt, this.rain || 0);
    // A raising nobody has come back to is given up on and the ground cleared —
    // otherwise a builder who wanders off (or starves) leaves a ring of stakes
    // standing for ever, and the site stays blocked for everyone else.
    for (let i = this.huts.length - 1; i >= 0; i--){
      const h = this.huts[i];
      if (!h.done){                       // a raising nobody came back to
        h.idleT += dt;
        if (h.idleT > ABANDON_T) this.removeHut(h);
      } else if (h.unusedT > ROT_T){      // a derelict nobody thought worth salvaging
        this.removeHut(h);                // ...falls in on itself, and the wood is lost
      }
    }
    // a site nobody came back to stake goes back on the market
    for (let i = this._siteClaims.length - 1; i >= 0; i--)
      if ((this._siteClaims[i].t -= dt) <= 0) this._siteClaims.splice(i, 1);
    if (this.huts.length) for (const n of this.npcs) this.confine(n);   // walls are solid
    // Sightings + gossip. Seeing someone makes a fresh "saw" fact; standing close
    // enough to talk trades the freshest news both ways, so word of people & food
    // outruns line-of-sight. Only the folk actually within SIGHT_RANGE are looked
    // at (near()), and the whole pass runs on the SOCIAL_DT clock rather than per
    // frame — it used to compare every pair every frame, which is what made a
    // crowded world crawl.
    this._socialT += dt;
    if (this._socialT >= SOCIAL_DT){
      const sdt = this._socialT; this._socialT = 0;
      const now = this.time;
      for (const n of this.npcs){ n._gossipCd = (n._gossipCd || 0) - sdt; n._glanceCd = (n._glanceCd || 0) - sdt; }
      const seen = [];
      for (const n of this.npcs){
        for (const o of this.near(n.x, n.z, SIGHT_RANGE, seen)){
          if (o === n) continue;
          addNews(n, { kind: 'saw', key: 'saw:' + o.id, subj: o, x: o.x, z: o.z, t: now });
          if (n.group && o.group === n.group && n.seen) n.seen.set(o, { x: o.x, z: o.z, t: now });
          const d = Math.hypot(o.x - n.x, o.z - n.z);
          if (d <= GOSSIP_RANGE && n._gossipCd <= 0 && o._gossipCd <= 0 && !n.convo && !n.sleeping && !o.sleeping && !n._indoors && !o._indoors && !parted(n, o, now)){
            // close enough to talk. Someone already talking isn't interrupted: you ask to
            // join theirs, and the talk's culture says how that goes (convo.js offerJoin)
            if (o.convo) o.convo.offerJoin(n);
            else if (Conversation.worthIt(this, n, o)) this.convos.push(new Conversation(this, n, o));
            else n._gossipCd = o._gossipCd = GOSSIP_CD;   // nothing to say: a nod will do
          } else if (d <= GOSSIP_RANGE * 2 && n._glanceCd <= 0 && n.ties){  // passing by: a glimpse of how they feel
            const t = n.ties.get(o);
            if (t && t.fam > GLANCE_FAM && Math.abs(t.reg) > GLANCE_REG){
              this._emit({ type: 'glance', who: n, at: o, like: t.reg > 0 });
              n._glanceCd = GLANCE_CD;
            }
          }
        }
        if (this.boats.length && !n._indoors && !n.sleeping) this.seeCanoes(n, now);
        pruneNews(n, now);
      }
    }
    for (const b of [...this.canoeBuilds]){            // who was at the work; a bed left too long is given up
      b.crew = b._n; b._n = 0;
      if (this.time - b.lastT > CANOE_IDLE){ this.canoeStats.abandoned++; this.removeCanoeBuild(b); }
    }
    for (const q of this.fauna) q.update(dt);          // rabbits roam / flee / respawn
    for (const c of this.convos) c.update(dt);         // talk, a turn at a time (convo.js)
    if (this.projects.length) this.projects = this.projects.filter(p => !p.tick(this.time));   // deadlines (projects.js)
    if (this.convos.some(c => c.done)) this.convos = this.convos.filter(c => !c.done);
  }

  // Personal-space pass (Pattern 127, INTIMACY GRADIENT). After everyone has
  // moved, ease apart any pair closer than their combined comfortable distance —
  // softly as a gradient, hard inside the body radius so they can never overlap.
  // Seated NPCs use a tighter distance, so the fire circle reads as intimate
  // while open ground stays roomy. Comfort is culture-driven (npc.personalSpace).
  separate(dt){
    if (dt <= 0) return;
    this._rebuildNeighbours();   // everyone has moved since update() binned them
    const list = this.npcs, n = list.length;
    for (let i = 0; i < n; i++){
      const a = list[i];
      // Seated folk hold their assigned ring seat — don't shove them around (they
      // still repel others below, as `b`). Otherwise the brain pulls them back to
      // the seat while this pass pushes them out, so they micro-slide in place —
      // invisible when seated read as standing, but obvious with a sitting sprite.
      if (a.talking || a.sitting) continue;
      // Indoors people stand closer — a hut is 3.2m across and holds a household,
      // so full open-ground personal space would press them into the walls.
      const aSpace = (a.personalSpace || 1.3) * (a.sitting ? INTIMATE : a._hutIn ? INTIMATE : 1);
      let px = 0, pz = 0;
      // only the folk actually within crowding distance can push us (SEP_R is
      // comfortably wider than any personal space), not the whole population
      for (const b of this.near(a.x, a.z, SEP_R, this._scratch)){
        if (b === a) continue;
        const dx = a.x - b.x, dz = a.z - b.z;
        const d = Math.hypot(dx, dz);
        const bSpace = (b.personalSpace || 1.3) * (b.sitting || b._hutIn ? INTIMATE : 1);
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
      this.confine(a);       // ...and nobody gets pushed out through a wall
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
    const huts = this.huts.length
      ? `  huts ${this.huts.length}/thatch ${(this.huts.reduce((s, h) => s + h.thatch, 0) / this.huts.length * 100 | 0)}%` : '';
    const lines = [`day ${this.day.toFixed(2)}  night ${this.night.toFixed(2)}  ${fires || 'no fire'}  shrubs ${standing}  finds ${finds}${this.shelters.length ? `  shelters ${this.shelters.length}` : ''}${huts}  rain ${(this.rain * 100 | 0)}%`];
    const near = this.npcs
      .map(n => ({ n, d: Math.hypot(n.x - px, n.z - pz) }))
      .sort((a, b) => a.d - b.d).slice(0, 7);
    for (const { n, d } of near){
      const q = n.needs;
      lines.push(`W${bar(q.warmth)} F${bar(q.food)} C${bar(q.company)} R${bar(q.rest)}` +
        `  ${(n.actionLabel || '?').padEnd(7)} d${d.toFixed(0)}` +
        `${n.sleeping ? ' zzz' : n.sitting ? ' sit' : ''}${n.chopping ? ' chop' : ''}${n.thatchArms ? ' th' + n.thatchArms : ''}${n.firewood ? ' w' + n.firewood : ''}${n.pack ? ' p' + n.pack : ''}${n.raw ? ' r' + n.raw : ''}${n.trinkets ? ' t' + n.trinkets : ''}${n.news && n.news.size ? ' n' + n.news.size : ''}${n.esteem > 0.5 ? ' e' + n.esteem.toFixed(0) : ''}`);
    }
    return lines.join('\n');
  }
}
