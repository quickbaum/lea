// recipes.js — dishes as steps, and who knows them. A pot over a fire works
// through its dish one step at a time (stepPot, from Campfire.update):
//   prep  — work someone at the fire does (crack the acorns); helpers speed it
//   wait  — time on the fire
//   stir  — must be done by someone who knows to, before the step's time runs out
//   add   — an ingredient someone at the fire carries goes in (berries at the end)
// Every step but waiting needs someone at the fire who knows it. If nobody does,
// the pot stalls (the cook asks the fire, in talk), and after a while the cook
// guesses — and the dish suffers. Missed stirs and missing ingredients cost too.
// Quality (pot.q, 0..1) decides how filling it is and how warmly the cook is
// thanked. Knowing a recipe works like knowing a saying (convo.js): households
// grow up with some; others are learned in talk ("How do you make that?"), and
// forgotten from the end — after RECIPE_HALF days you remember only the first
// half of the steps, after RECIPE_GONE nothing. Pure sim, no rendering; talk
// (convo.js) reads the pot through potNeeds / potHelp / potLeft / potStuck.
// See docs/talk.md.

import { countOf, takeFood } from './larder.js';

export const RECIPES = {
  'acorn porridge': { base: ['acorns'], steps: [
    { do: 'prep', t: 7,  say: 'crack the acorns' },
    { do: 'wait', t: 10, say: 'let it simmer' },
    { do: 'stir', t: 7,  say: 'stir it' },
    { do: 'add',  t: 12, item: ['berries'], say: 'berries at the end' },
    { do: 'wait', t: 4,  say: 'let it sit' },
  ] },
  'rabbit stew': { base: ['meat'], steps: [
    { do: 'prep', t: 9,  say: 'joint the rabbit' },
    { do: 'add',  t: 12, item: ['roots', 'cattail root'], say: 'some roots' },
    { do: 'wait', t: 10, say: 'let it simmer' },
    { do: 'stir', t: 7,  say: 'stir it' },
    { do: 'add',  t: 12, item: ['mushrooms', 'morels'], say: 'mushrooms near the end' },
    { do: 'wait', t: 4,  say: 'let it sit' },
  ] },
  'root stew': { base: ['roots', 'cattail root', 'morels'], steps: [
    { do: 'prep', t: 6,  say: 'scrub the roots' },
    { do: 'wait', t: 12, say: 'let it boil' },
    { do: 'stir', t: 7,  say: 'stir it' },
  ] },
  'chamomile tea': { base: ['chamomile'], warms: true, steps: [
    { do: 'wait', t: 8,  say: 'steep the flowers' },
  ] },
};
// foods that must be cooked: they go in the raw bag, not the pack (one list, used everywhere)
export const RAW_KINDS = new Set(['roots', 'acorns', 'cattail root', 'morels', 'meat']);
export const recipeFor = kind => Object.keys(RECIPES).find(id => RECIPES[id].base.includes(kind)) || null;

const AT_FIRE      = 3.5;    // close enough to the pot to work at it
const RECIPE_HALF  = 2, RECIPE_GONE = 5;   // days, as for sayings
const PATIENCE     = 8;      // seconds a cook waits on a step nobody knows, then guesses
const FETCH_WAIT   = 40;     // how long an add step waits for someone who's gone to fetch it
const ADD_WAIT     = 6;      // …and for anyone at all to turn up with it, otherwise
const Q_STIR = 0.25, Q_ADD = 0.2, Q_GUESS = 0.2;

// ---- knowing a recipe ----------------------------------------------------------
const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
function cookbook(n){
  if (n.recipes) return n.recipes;
  n.recipes = new Map();
  const home = n.group ? 'g' + n.group.id : 'n' + n.id;
  const elder = n.role === 'elder' || n.role === 'mother' || n.role === 'father';
  for (const id in RECIPES) if (hash01(home, 'r:' + id) < (elder ? 0.85 : 0.6)) n.recipes.set(id, { heritage: true });
  return n.recipes;
}
// how many of the recipe's steps n remembers (0 = doesn't know it)
export function stepsKnown(n, id, now){
  const e = cookbook(n).get(id), len = RECIPES[id].steps.length;
  if (!e) return 0;
  if (e.heritage) return len;
  const age = now - e.t;
  return age < RECIPE_HALF ? len : age < RECIPE_GONE ? Math.ceil(len / 2) : 0;
}
export const knowsStep = (n, id, i, now) => i < stepsKnown(n, id, now);
export const learnRecipe = (n, id, now) => { const e = cookbook(n).get(id); if (!e || !e.heritage) cookbook(n).set(id, { t: now }); };

// ---- the pot -------------------------------------------------------------------
// carries one of `items`? (rations in the pack, or raw in the raw bag)
export function carries(n, items){
  for (const b of (n.larder || [])) if (b.n > 0 && items.includes(b.kind)) return b.kind;
  if (!n.larder && (n.pack || 0) > 0 && items.includes(n.packKind)) return n.packKind;
  if ((n.raw || 0) > 0 && items.includes(n.rawKind)) return n.rawKind;
  return null;
}
function takeOne(n, kind, now){
  if (countOf(n, kind) > 0){ takeFood(n, 1, now, kind); return true; }
  if (n.rawKind === kind && n.raw > 0){ n.raw -= 1; if (n.raw <= 0) n.rawKind = null; return true; }
  return false;
}
const atFire = (w, f) => w.near(f.x, f.z, AT_FIRE).filter(n => !n.sleeping && Math.hypot(n.x - f.x, n.z - f.z) <= AT_FIRE);

export function startPot(p, kind){
  p.recipe = recipeFor(kind); p.step = 0; p.st = 0; p.stall = 0; p.q = 1;
  p.helpers = new Map(); p.missing = null; p.fetching = 0; p.stuck = false;
}

export function stepPot(f, w, dt){
  const p = f.pot;
  if (p.raw <= 0 || !f.lit || dt <= 0) return;
  const r = RECIPES[p.recipe];
  if (!r){ p.cook += dt; if (p.cook >= w.cookTime) finish(p); return; }     // nothing to follow: just boil it
  const s = r.steps[p.step];
  if (!s){ tally(w, 'dishes'); tally(w, 'quality', Math.max(0, p.q)); return finish(p); }
  p.cook += dt;
  const here = atFire(w, f), now = w.time;
  // anyone at the fire can stir; the rest wants someone who knows the dish
  const knower = s.do === 'stir' ? here[0] : here.find(n => knowsStep(n, p.recipe, p.step, now));
  if (p.fetching > 0) p.fetching -= dt;
  p.stuck = false; p.missing = null;
  if (s.do === 'wait'){ if ((p.st += dt) >= s.t) next(p); return; }
  if (!knower){                                   // nobody here knows what comes next
    if (s.do === 'stir' && (p.st += dt) >= s.t){ p.q -= Q_STIR; tally(w, 'unstirred'); next(p); return; }   // unstirred, it catches
    if (!here.length){ tally(w, 'unattended', dt); return; }   // (nobody here at all: it just sits)
    p.stuck = true;
    if ((p.stall += dt) >= PATIENCE){ p.q -= Q_GUESS; tally(w, 'guessed'); next(p); }   // the cook has a go anyway
    return;
  }
  p.stall = 0;
  if (s.do === 'prep'){
    for (const [n, until] of p.helpers) if (until < now) p.helpers.delete(n);
    const hands = 1 + here.filter(n => n !== knower && p.helpers.has(n)).length;   // helpers speed the work
    if ((p.st += dt * hands) >= s.t) next(p);
  } else if (s.do === 'stir'){
    next(p);                                       // someone who knows to has stirred it
  } else if (s.do === 'add'){
    const giver = here.find(n => carries(n, s.item));
    if (giver){ takeOne(giver, carries(giver, s.item), now); next(p); return; }
    const proj = w.projects && w.projects.find(q => q.fire === f && q.stash.size);   // or from a shared plan's basket
    if (proj && proj.takeStash(s.item, 1).n > 0){ next(p); return; }
    p.missing = s.item;
    if ((p.st += dt) >= (p.fetching > 0 ? FETCH_WAIT : ADD_WAIT)){ p.q -= Q_ADD; tally(w, 'without'); next(p); }   // done without
  }
}
function next(p){ p.step++; p.st = 0; p.stall = 0; }
// counts for the harness's report (world.potStats, when it's set)
function tally(w, k, v = 1){ if (w.potStats) w.potStats[k] = (w.potStats[k] || 0) + v; }
function finish(p){
  p.readyQ = p.ready > 0 ? Math.min(p.readyQ ?? 1, Math.max(0, p.q ?? 1)) : Math.max(0, p.q ?? 1);
  p.ready += p.raw; p.raw = 0; p.cook = 0; p.step = 0; p.st = 0;
}

// ---- what talk reads -------------------------------------------------------------
// what the dish still wants put in: the ingredient lists of the add steps to come
export function potNeeds(p){
  const r = RECIPES[p.recipe]; if (!r || p.raw <= 0) return [];
  return r.steps.slice(p.step).filter(s => s.do === 'add').map(s => s.item);
}
// is there work a helper could do, now or soon? (the step, or null)
export function potHelp(p){
  const r = RECIPES[p.recipe]; if (!r || p.raw <= 0) return null;
  return r.steps.slice(p.step, p.step + 2).find(s => s.do === 'prep') || null;
}
// seconds left, roughly (stalls and fetches not counted)
export function potLeft(p, cookTime){
  const r = RECIPES[p.recipe];
  if (!r) return Math.max(0, cookTime - p.cook);
  return r.steps.slice(p.step).reduce((a, s, i) => a + (s.do === 'stir' ? 1 : s.t) - (i === 0 ? p.st : 0), 0);
}
export const potStep = p => (RECIPES[p.recipe] && RECIPES[p.recipe].steps[p.step]) || null;
export const prevStep = p => (RECIPES[p.recipe] && p.step > 0 && RECIPES[p.recipe].steps[p.step - 1]) || null;
