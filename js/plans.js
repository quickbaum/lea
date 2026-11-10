// plans.js — a person's agenda: a few goals held at once, each with an expiry,
// instead of one slot that every new intention overwrote ("fetch berries"
// erasing "go for those apples"). Brain.choose weighs every live plan (agents.js);
// talk makes them (convo.js), cravings make them (cravings below), and shared
// plans hand them out as tasks (projects.js). A plan is { kind, until, ... }:
//   food   — go to a place where there's food (x, z, food, from, now?, start?)
//   bring  — get an item and take it to a fire's pot (item, fire, x?, z?)
//   help   — stay and work at a fire's pot (fire)
//   wood   — fetch firewood
//   hut    — get on with building a hut
//   dish   — make a dish you're craving (dish)
//   task   — your part in a shared plan (project, task)
//   practice — go and work at a tune, told to or wanting it (tune; music-sim.js practiceWant)
// Survival still comes first: Brain.choose gates these behind need like any want.

import { RECIPES, recipeFor } from './recipes.js';
import { Patch } from './patch.js';

const AGENDA_MAX = 4;

const samePlan = (a, b) => a.kind === b.kind && (a.fire || null) === (b.fire || null)
  && (a.dish || null) === (b.dish || null) && (a.task || null) === (b.task || null);

export function addPlan(n, p){
  if (!n.plans) n.plans = [];
  const i = n.plans.findIndex(q => samePlan(q, p));
  if (i >= 0) n.plans.splice(i, 1);
  n.plans.push(p);
  // the oldest give way, and lapse as they go: a task it held goes back to the others
  if (n.plans.length > AGENDA_MAX) for (const q of n.plans.splice(0, n.plans.length - AGENDA_MAX)) q.onLapse?.(q);
  n._plansMade = (n._plansMade || 0) + 1;
  return p;
}
export function dropPlan(n, p){
  if (!n.plans) return;
  const i = n.plans.indexOf(p); if (i >= 0) n.plans.splice(i, 1);
}
// the live agenda (expired plans fall away here)
export function plansOf(n, now){
  if (!n.plans || !n.plans.length) return [];
  if (n.plans.some(p => p.until < now)){
    for (const p of n.plans) if (p.until < now && p.onLapse) p.onLapse(p);
    n.plans = n.plans.filter(p => p.until >= now);
  }
  return n.plans;
}
export const firstPlan = (n, kind) => (n.plans || []).find(p => p.kind === kind) || null;
export const hasPlan = (n, kind) => !!firstPlan(n, kind);
export const inAHurry = n => (n.plans || []).some(p => p.now);

// ---- cravings ----------------------------------------------------------------
// Wanting a particular dish — not hunger. It grows with time since you last had
// it (to your own taste for it, hashed from who you are), and hearing it praised
// adds a boost that fades. A strong enough craving becomes a plan to make it.
// Tea isn't craved: the cold sends people to it (agents.js brew).
const CRAVE_DAYS  = 2;       // days without a dish for the craving to come back in full
const CRAVE_AT    = 0.7;     // how strong before you set about making it
const CRAVE_CD    = 0.5;     // days between one person's craving plans
const BOOST_DAYS  = 1;       // a boost from hearing it praised fades over this
export const CRAVED = Object.keys(RECIPES).filter(id => !RECIPES[id].warms && !RECIPES[id].book && !RECIPES[id].hedge);   // (nobody craves a dish they've never had, or one of what they don't gather)

const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
export const taste = (n, dish) => 0.3 + 0.7 * hash01('t' + n.id, dish);

export function hadDish(n, kind, now){ const d = RECIPES[kind] ? kind : recipeFor(kind); if (d){ if (!n._had) n._had = new Map(); n._had.set(d, now); } }
export function boostCraving(n, dish, v, now){ if (!n._boost) n._boost = new Map(); n._boost.set(dish, { v: Math.min(1, (boostOf(n, dish, now)) + v), t: now }); }
const boostOf = (n, dish, now) => { const b = n._boost && n._boost.get(dish); return b ? b.v * Math.max(0, 1 - (now - b.t) / BOOST_DAYS) : 0; };

export function craving(n, dish, now){
  const last = n._had && n._had.get(dish);
  const since = last == null ? 1 : Math.min(1, Math.max(0, (now - last) / CRAVE_DAYS));
  return Math.min(1, taste(n, dish) * since + boostOf(n, dish, now));
}
// the dish they want most right now, if they want it enough (null otherwise)
export function strongestCraving(n, now){
  let best = null, bv = CRAVE_AT;
  for (const d of CRAVED){ const v = craving(n, d, now); if (v > bv){ bv = v; best = d; } }
  return best;
}
export const mayCrave = (n, now) => now >= (n._craveCd || -1e9);
export const craved = (n, now) => { n._craveCd = now + CRAVE_CD; };

// ---- intention ---------------------------------------------------------------
// What a person is about, as opposed to which step of it they're on: chopping and stacking are one
// job, getting wood. Brain.choose still scores everything, but a rival must beat the intention by the
// person's bar, so most small changes in the scores never get considered (docs/npc-psychology.md:
// Bratman's filter). Need lowers the bar and absorption raises it. Why it changed is recorded, and what
// was interrupted is kept a while and comes back.
const PURSUITS = {
  wood: ['chop', 'stack'],
  field: ['farm', 'reap'],
  eat: ['food', 'plan-food', 'plan-cook', 'cook', 'getfood', 'sup', 'ask', 'hunt', 'fish', 'boat-fish', 'store', 'brew'],
  warm: ['shelter', 'tree-shelter', 'indoors', 'build-shel'],
  hearth: ['fire', 'tend', 'build', 'home'],
  hut: ['stake-hut', 'strike-hut', 'cut-thatch', 'frame-hut', 'thatch-hut', 'rethatch'],
  canoe: ['peel-bark', 'canoe-bring', 'canoe-work'],
  instrument: ['cut-elder', 'make-inst'],
  pretty: ['collect', 'gather-flower'],
  shared: ['bring', 'help'],
};
const PURSUIT_OF = new Map(Object.entries(PURSUITS).flatMap(([p, ks]) => ks.map(k => [k, p])));
export const pursuitOf = kind => PURSUIT_OF.get(kind) || kind;

export const INTENT = {
  OFF: false,      // tools: compare with the old way of choosing (sim-harness --no-intent)
  TRIPS: true,     // tools: compare without gathering trips (sim-harness --no-trips)
  BAR: 1.5,        // how far a rival must outscore what you're about, for someone of middling steadiness.
                   // Tested .5, 1, 2 (docs/npc-psychology.md): more is steadier with no cost to need, but numbers can't show stubborn
  URGE_LO: 0.6,    // a need above this starts to lower the bar...
  URGE_HI: 0.9,    // ...and by here nothing holds it back
  ABSORB: 1.5,     // the bar is this much higher at work that takes you in
  RESUME: 0.4,     // pull back to what was interrupted, fading until it's stale
  STALE: 0.15,     // days before something interrupted is forgotten
  KEPT: 3,         // how many interrupted things a person keeps in mind
};
// What they've already taken on doesn't have to clear the bar: a letter to carry, a dish they set out to
// make, their part in a shared plan. That's a reason to go, not a passing fancy. (The first version made
// these beat it like anything else, and the post stopped riding and taught dishes stopped being made.)
const COMMITTED = new Set(['cry', 'market', 'plan-food', 'plan-cook', 'bring', 'help', 'practice', 'revere']);
export const isCommitted = kind => COMMITTED.has(kind);
const ABSORBING = new Set(['practice', 'instrument', 'canoe', 'fish']);

// `need` is how badly they want what the RIVAL offers. Being hungry is a reason to break off for food,
// not for flowers: going by their worst need instead left the bar at nothing whenever anyone was hungry.
export const rivalNeed = (pursuit, n) => pursuit === 'eat' ? n.food : pursuit === 'warm' ? n.warmth
  : pursuit === 'hearth' ? Math.max(n.warmth, n.company) : pursuit === 'sleep' ? n.rest : pursuit === 'greet' ? n.company : 0;
// `paying` is what they're at scores now: what has stopped paying can't hold anyone, however steady (the first
// version held a villager at a cold-morning hearth all day, because a field's .55 never beat it by the full bar).
export function intentBar(what, steadiness, need, paying = 1){
  const urge = Math.min(1, Math.max(0, (need - INTENT.URGE_LO) / (INTENT.URGE_HI - INTENT.URGE_LO)));
  return INTENT.BAR * steadiness * (1 - urge) * Math.min(1, Math.max(0, paying)) * (ABSORBING.has(what) ? INTENT.ABSORB : 1);
}
// what was interrupted pulls them back once what they broke off for is finished, less as it fades.
// Never while they're still at the other thing: then each keeps interrupting the other.
export function resumePull(n, what, now){
  for (const q of n.suspended || []) if (q.what === what)
    return INTENT.RESUME * Math.max(0, 1 - (now - q.at) / INTENT.STALE);
  return 0;
}
export function suspend(n, I, now){
  (n.suspended ||= []).push({ what: I.what, why: I.why, at: now });
  n.suspended = n.suspended.filter(q => now - q.at < INTENT.STALE).slice(-INTENT.KEPT);
}
export function resumed(n, what){
  if (n.suspended?.length) n.suspended = n.suspended.filter(q => q.what !== what);
}

// Temperament: a few correlated dimensions, drawn from who you are so no seeded stream moves.
// Every number and its source is in the table in docs/npc-psychology.md. The loadings are a design
// choice made from questionnaire correlations, not a finding about behaviour.
export const TEMPER = {
  ORDER_ON_STABILITY: 0.4,      // orderliness goes with stability (van der Linden 2010, size is my choice)
  ATTEND_ON_ORDER: 0.52,        // attention (Gomez & Corr 2014: inattention, conscientiousness r -.52)
  ATTEND_ON_STABILITY: 0.35,    //                                inattention, neuroticism r +.35
  RESTLESS_ON_ORDER: -0.40,     // restlessness (same: hyperactivity/impulsivity, conscientiousness r -.40)
  RESTLESS_ON_STABILITY: -0.18, //                                                 neuroticism r +.18
  STEADY_SPREAD: 0.45,          // how widely steadiness varies: e^(z * this), my choice
};
const gauss = (id, k) => Math.sqrt(-2 * Math.log(Math.max(1e-6, hash01('tz' + k, id)))) * Math.cos(2 * Math.PI * hash01('tw' + k, id));
export function temperament(id){
  const T = TEMPER, mix = (noise, ...parts) => {
    const v = parts.reduce((s, [b, z]) => s + b * z, 0), left = Math.max(0.1, 1 - parts.reduce((s, [b]) => s + b * b, 0));
    return v + Math.sqrt(left) * noise;
  };
  const stability = gauss(id, 's'), plasticity = gauss(id, 'p');
  const orderliness = mix(gauss(id, 'o'), [T.ORDER_ON_STABILITY, stability]);
  const attention = mix(gauss(id, 'a'), [T.ATTEND_ON_ORDER, orderliness], [T.ATTEND_ON_STABILITY, stability]);
  const restlessness = mix(gauss(id, 'r'), [T.RESTLESS_ON_ORDER, orderliness], [T.RESTLESS_ON_STABILITY, stability]);
  const steadiness = Math.exp(attention * T.STEADY_SPREAD);
  return { stability, plasticity, orderliness, attention, restlessness, steadiness };
}

// ---- occupation -------------------------------------------------------------
// Holding someone to a job. The post, the traders and the rounds below all give Brain.choose the same thing:
// `jobs` (person -> { x, z, ... }, the next thing to do), a `name`, a `bias`, and `work(a, job, now, dt, brain)` for
// when they get there. A job is a commitment, so it never has to clear the bar; a real need can still break it.
//
// dayRound is the kind with a shape to the day: fixed appointments (time geography, docs/npc-psychology.md) and free time
// between. steps are { name, from, to, where(n, now) -> {x, z}, stays?, sit?, tol?, why, say: [lines], arrive(a, job, now), work(a, job, now, dt) },
// with from and to as parts of a day (0 is midnight, .25 sunrise). A step without `stays` is done once a day, on arrival.
// A person is free outside the steps. interrupt() sends them somewhere; after that, the step comes back.
export function dayRound({ name, bias = 2.5, steps }){
  const jobs = new Map(), holders = new Set(), doneToday = new Map();
  const within = (s, p) => s.from <= s.to ? p >= s.from && p < s.to : p >= s.from || p < s.to;
  const round = {
    name, bias, jobs, holders, steps, yields: true,
    hold(n){ holders.add(n); },
    release(n){ holders.delete(n); jobs.delete(n); doneToday.delete(n); },
    tol: job => job.tol ?? job.step?.tol ?? 1.8,
    // phase: how far through the day (0 to 1), which the sky knows and the clock may not
    tick(now, phase){
      for (const n of holders){
        const cur = jobs.get(n);
        if (cur?.interrupted && now < cur.until) continue;
        const s = steps.find(q => within(q, phase)), day = Math.floor(now - phase + 0.5);
        const finished = s && doneToday.get(n)?.has(`${day}:${s.name}`);
        if (!s || finished){ if (cur) jobs.delete(n); continue; }
        if (cur?.step === s) continue;
        const at = s.where(n, now);
        if (at) jobs.set(n, { kind: s.name, step: s, x: at.x, z: at.z, sit: !!s.sit, why: s.why, day }); else jobs.delete(n);
      }
    },
    work(a, job, now, dt, brain){
      if (job.step?.stays){ a.actionLabel = job.step.name; job.step.work?.(a, job, now, dt); return; }
      brain.target = null;
      if (jobs.get(a) === job) jobs.delete(a);
      if (job.step){
        let d = doneToday.get(a); if (!d) doneToday.set(a, d = new Set());
        d.add(`${job.day}:${job.step.name}`);
        job.step.arrive?.(a, job, now);
      } else job.then?.(a, now);
    },
    // { x, z, why, say, until, then(a, now) }: go there first (a stray, someone calling). The round carries on after.
    interrupt(n, job){ jobs.set(n, { kind: 'interrupted', interrupted: true, until: Infinity, ...job }); },
    says(n){ const j = jobs.get(n), lines = j?.say || j?.step?.say; return lines ? { key: `${name}-${j.step?.name || 'called'}`, lines } : null; },
    why: n => jobs.get(n)?.why ?? null,
  };
  return round;
}

// ---- a gathering trip --------------------------------------------------------
// Going out for food means meaning to bring back so much, and it ends when you have it or the place stops paying
// (js/patch.js; Batek camps and Barack's berry task, docs/npc-psychology.md). Without one, the pull fell with each pick and folk
// went back to the fire nearly empty-handed, ate that, and came out again.
export const TRIP = {
  HOLD: 0.6,       // what's added to the food they've gone out for, until they have what they came for
  FILL: 0.6,       // how full a pack someone of middling orderliness means to bring back...
  FILL_ORDER: 0.15, // ...and how much more per unit of orderliness
  MIN: 2,          // nobody goes out for less
  PATCH_TAU: 25, PATCH_SETTLE: 15,   // seconds: a sense of how this place is paying, and least time to judge it
  BAR: 0.5,        // gives up when it's paying under this share of what they usually get...
  BAR_RESTLESS: 0.12, // ...and more per unit of restlessness: the restless leave sooner (Barack 2024)
  USUAL: 0.2,      // food a second they expect before they've any experience of it. My guess, then learnt
  USUAL_LEARN: 0.3,
  SPENT_DAYS: 0.1, SPENT_R: 30, SPENT_COST: 0.5,   // a place given up on stays less attractive a while
};
export function startTrip(persona, at, pack, cap, now, usual){
  const order = persona?.temper?.orderliness ?? 0, rest = persona?.restlessness ?? 0;
  const fill = Math.min(1, Math.max(0.3, TRIP.FILL + TRIP.FILL_ORDER * order));
  const want = Math.max(TRIP.MIN, Math.ceil(fill * cap) - (pack || 0));
  const bar = Math.min(0.9, Math.max(0.2, TRIP.BAR + TRIP.BAR_RESTLESS * rest));
  const patch = new Patch({ tau: TRIP.PATCH_TAU, settle: TRIP.PATCH_SETTLE, bar });
  patch.arrive(usual ?? TRIP.USUAL);
  return { x: at.x, z: at.z, want, got: 0, t0: now, last: now, gained: 0, patch, usual: usual ?? TRIP.USUAL };
}
// called as they choose, with the seconds since last time. 'filled', 'spent', or null to carry on
export function tripCheck(trip, secs){
  if (trip.got >= trip.want) return 'filled';
  // the walk there isn't the place paying badly: the place is judged from the first thing found in it
  if (!trip.got) return null;
  if (!trip.arrived){ trip.arrived = true; trip.patch.arrive(trip.usual); trip.gained = 0; return null; }
  if (secs > 0){ trip.patch.feed(trip.gained / secs, secs); trip.gained = 0; }
  return trip.patch.leave(trip.usual) ? 'spent' : null;
}
export const learnedRate = (trip, now, secs) => trip.usual + TRIP.USUAL_LEARN * (trip.got / Math.max(5, secs) - trip.usual);
