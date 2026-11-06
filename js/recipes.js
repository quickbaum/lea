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
// half of the steps, after RECIPE_GONE nothing. How long that takes is a person's
// own (memoryOf): some hold a recipe longer, some never lose one. Cooking a dish
// refreshes it. The book dishes (`book`) are taught by the player; a cook who knows
// one makes it instead of the plain dish of its base (startPot), and puts a portion
// by for the player (putBy, read by main.js). Pure sim, no rendering; talk
// (convo.js) reads the pot through potNeeds / potHelp / potLeft / potStuck.
// See docs/talk.md.

import { countOf, takeFood, rawOf, takeRaw } from './larder.js';
import { RAW_KINDS, RARE } from './ingredients.js';

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
  // what's caught on the bank (docs/fishing.md), with an onion from a village if
  // anyone has one, or a root
  'fish stew': { base: ['fish', 'eels'], steps: [
    { do: 'prep', t: 6,  say: 'gut the fish' },
    { do: 'wait', t: 8,  say: 'let it simmer' },
    { do: 'add',  t: 10, item: ['onions', 'leeks', 'roots', 'cattail root'], say: 'an onion or a root' },
    { do: 'wait', t: 4,  say: 'let it sit' },
  ] },
  // the villages' everyday dish: whatever the croft gives, and something from
  // the wild in it if there's any to be had (trade.js, docs/trade.md). Villagers
  // grow up knowing it; the folk learn it in talk.
  'pottage': { base: ['turnips', 'parsnips', 'cabbages', 'onions', 'leeks', 'beans', 'peas'], village: true, steps: [
    { do: 'prep', t: 6,  say: 'chop the greens' },
    { do: 'wait', t: 10, say: 'let it boil' },
    { do: 'add',  t: 10, item: ['meat', 'fish', 'eels', 'mushrooms', 'morels', 'roots', 'hazelnuts'], say: 'something from the wild, if there is any' },
    { do: 'stir', t: 7,  say: 'stir it' },
    { do: 'wait', t: 6,  say: 'let it thicken' },
  ] },
  'chamomile tea': { base: ['chamomile'], warms: true, steps: [
    { do: 'wait', t: 8,  say: 'steep the flowers' },
  ] },
  // Found in books, not known: the kitchen books on the crypts' shelves (gen/under.js
  // shelves(), docs/under.md "Books"). Nobody is born knowing them (`book`), so they stay
  // out of the folk's pots and cravings until they're taught. Some want what only a hard
  // place gives (RARE); `intro` is the book's own opening line.
  'foxfire draught': { book: true, base: ['foxfire'], intro: 'Of the shining cap that grows in the deep places, and a draught of it against the dark.', steps: [
    { do: 'prep', t: 6,  say: 'slice the foxfire thin' },
    { do: 'wait', t: 10, say: 'simmer them till the shine goes out of the water' },
    { do: 'add',  t: 10, item: ['chamomile'], say: 'chamomile to settle it' },
    { do: 'wait', t: 6,  say: 'let it stand' },
  ] },
  'blindfish broth': { book: true, base: ['blindfish'], intro: 'Of the white fish of the under-lakes, that never saw the sun.', steps: [
    { do: 'prep', t: 6,  say: 'clean the fish' },
    { do: 'add',  t: 10, item: ['cave salt'], say: 'a pinch of the cave salt' },
    { do: 'wait', t: 10, say: 'let it simmer' },
    { do: 'add',  t: 10, item: ['leeks', 'onions', 'roots'], say: 'a leek or a root' },
    { do: 'stir', t: 7,  say: 'stir it' },
  ] },
  'salted eel': { book: true, base: ['eels'], intro: 'To keep eels through the winter, as the cellarer did.', steps: [
    { do: 'prep', t: 8,  say: 'skin the eels' },
    { do: 'add',  t: 10, item: ['cave salt'], say: 'rub them with cave salt' },
    { do: 'wait', t: 12, say: 'smoke them slowly' },
  ] },
  'hazel porridge': { book: true, base: ['hazelnuts'], intro: 'A porridge for fast days, of hazelnuts.', steps: [
    { do: 'prep', t: 7,  say: 'crack and grind the nuts' },
    { do: 'wait', t: 10, say: 'let it simmer' },
    { do: 'stir', t: 7,  say: 'stir it' },
    { do: 'add',  t: 10, item: ['berries'], say: 'berries if there are any' },
  ] },
  'bean broth': { book: true, base: ['beans', 'peas'], intro: 'The brothers\' broth, of beans.', steps: [
    { do: 'wait', t: 12, say: 'soak and boil the beans' },
    { do: 'add',  t: 10, item: ['onions', 'leeks'], say: 'an onion' },
    { do: 'stir', t: 7,  say: 'stir it' },
    { do: 'add',  t: 10, item: ['mushrooms', 'morels', 'foxfire'], say: 'mushrooms near the end' },
    { do: 'wait', t: 6,  say: 'let it thicken' },
  ] },
};
// what only a hard place gives, and where (the deep caves for now; mountaintops, islands
// and the like later), and the foods that must be cooked: both are ingredients.js's now
export { RARE, RAW_KINDS };
export const BOOK_RECIPES = Object.keys(RECIPES).filter(id => RECIPES[id].book);
export const recipeFor = kind => Object.keys(RECIPES).find(id => !RECIPES[id].book && RECIPES[id].base.includes(kind)) || null;   // (a book's dish isn't known: docs/under.md "Books")

const AT_FIRE      = 3.5;    // close enough to the pot to work at it
const RECIPE_HALF  = 2, RECIPE_GONE = 5;   // days, as for sayings (scaled by memoryOf)
const NEVER_FORGET = 0.15;   // the share of people who never lose a recipe they've learned
const SAVED_MAX    = 2;      // portions a cook keeps put by for the player
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
  for (const id in RECIPES){
    if (RECIPES[id].book) continue;                // found in books, never grown up with
    const born = RECIPES[id].village ? !!n.home : hash01(home, 'r:' + id) < (elder ? 0.85 : 0.6);   // a village dish: every household knows it, nobody else does
    if (born) n.recipes.set(id, { heritage: true });
  }
  return n.recipes;
}
// how well n holds a learned recipe: a factor on how long it takes to fade, 0.5..2
// (elders a little better), or Infinity for those who never forget. A hash of who
// they are, so it doesn't draw on the world's random stream.
export function memoryOf(n){
  if (n.recipeMemory != null) return n.recipeMemory;
  const h = hash01('n' + n.id + '|' + (n.name || ''), 'memory');
  const elder = n.role === 'elder' || n.role === 'mother' || n.role === 'father';
  return (n.recipeMemory = h < NEVER_FORGET ? Infinity : (0.5 + 1.5 * (h - NEVER_FORGET) / (1 - NEVER_FORGET)) * (elder ? 1.3 : 1));
}
// how many of the recipe's steps n remembers (0 = doesn't know it)
export function stepsKnown(n, id, now){
  const e = cookbook(n).get(id), len = RECIPES[id].steps.length;
  if (!e) return 0;
  if (e.heritage) return len;
  const age = now - e.t, m = memoryOf(n);
  return age < RECIPE_HALF * m ? len : age < RECIPE_GONE * m ? Math.ceil(len / 2) : 0;
}
export const knowsStep = (n, id, i, now) => i < stepsKnown(n, id, now);
export const learnRecipe = (n, id, now) => { const e = cookbook(n).get(id); if (!e || !e.heritage) cookbook(n).set(id, { t: now }); };

// ---- the pot -------------------------------------------------------------------
// carries one of `items`? (rations in the pack, or raw in the raw bag)
export function carries(n, items){
  for (const b of (n.larder || [])) if (b.n > 0 && items.includes(b.kind)) return b.kind;
  if (!n.larder && (n.pack || 0) > 0 && items.includes(n.packKind)) return n.packKind;
  for (const k of items) if (rawOf(n, k) > 0) return k;
  return null;
}
function takeOne(n, kind, now){
  if (countOf(n, kind) > 0){ takeFood(n, 1, now, kind); return true; }
  if (takeRaw(n, kind, 1) > 0) return true;
  return false;
}
const atFire = (w, f) => w.near(f.x, f.z, AT_FIRE).filter(n => !n.sleeping && Math.hypot(n.x - f.x, n.z - f.z) <= AT_FIRE);

// the book dish `by` knows (even half) that's made from `kind`, if any
export const bookDishFor = (by, kind, now) => BOOK_RECIPES.find(id => RECIPES[id].base.includes(kind) && stepsKnown(by, id, now) > 0) || null;
// what a pot is a pot of, by name: its recipe, or (with none) its ingredient
export const potDish = p => p.recipe || p.kind;
export function startPot(p, kind, by = null, now = 0){
  p.recipe = (by && bookDishFor(by, kind, now)) || recipeFor(kind); p.step = 0; p.st = 0; p.stall = 0; p.q = 1;
  p.helpers = new Map(); p.missing = null; p.fetching = 0; p.stuck = false;
}

export function stepPot(f, w, dt){
  const p = f.pot;
  if (p.raw <= 0 || !f.lit || dt <= 0) return;
  const r = RECIPES[p.recipe];
  if (!r){ p.cook += dt; if (p.cook >= w.cookTime) finish(p); return; }     // nothing to follow: just boil it
  const s = r.steps[p.step];
  if (!s){ tally(w, 'dishes'); tally(w, 'quality', Math.max(0, p.q)); finish(p); if (r.book){ tally(w, 'book:' + p.recipe); putBy(f, p, w.time); } return; }
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
// a book dish is done: its cook has it fresh in mind again, and keeps a portion back
// for the player, who brought the recipe (main.js hands it over in talk)
function putBy(f, p, now){
  const c = f.potCook && f.potCook();
  if (!c) return;
  learnRecipe(c, p.recipe, now);
  if (p.ready > 0 && (c.saved || (c.saved = [])).length < SAVED_MAX){ p.ready -= 1; c.saved.push({ dish: p.recipe, q: p.readyQ ?? 1, t: now }); }
}
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
