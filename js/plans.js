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
// Survival still comes first: Brain.choose gates these behind need like any want.

import { RECIPES, recipeFor } from './recipes.js';

const AGENDA_MAX = 4;

const samePlan = (a, b) => a.kind === b.kind && (a.fire || null) === (b.fire || null)
  && (a.dish || null) === (b.dish || null) && (a.task || null) === (b.task || null);

export function addPlan(n, p){
  if (!n.plans) n.plans = [];
  const i = n.plans.findIndex(q => samePlan(q, p));
  if (i >= 0) n.plans.splice(i, 1);
  n.plans.push(p);
  if (n.plans.length > AGENDA_MAX) n.plans.splice(0, n.plans.length - AGENDA_MAX);   // the oldest give way
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
export const CRAVED = Object.keys(RECIPES).filter(id => !RECIPES[id].warms && !RECIPES[id].book);   // (nobody craves a dish they've never had)

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
