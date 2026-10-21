// projects.js — shared plans: a household's goal, split into tasks people take on.
//   dish      — "Shall we make rabbit stew tonight?": the base, the extras, the cooking
//   provision — "We're all low. We should gather.": everyone brings some food home
//   hut       — "Help me with the hut?": poles and thatch brought to a hut going up
// A project lives at a fire, with a basket (stash) where what's brought is kept,
// and a deadline. Each task is open, taken (by one person), done, or failed;
// taking a task puts it on that person's agenda (plans.js) as a 'task' plan.
//
// The care (joint intention): a shared plan only holds while its members keep
// each other informed. So every change a member makes — done, failed, gave up —
// is owed as news to the others (member.owes), and talk is the only way it gets
// to them (convo.js). Nothing is claimed for ever: a task plan that lapses puts
// the task back as open and owes a "couldn't". Deadlines end every project,
// done or not. Survival comes first (Brain.choose gates plans behind need).
// One project per household at a time. See docs/talk.md.

import { RECIPES, RAW_KINDS } from './recipes.js';
import { addPlan, dropPlan, plansOf } from './plans.js';
import { countOf, takeFood } from './larder.js';

let NEXT = 1;
const GRACE = 0.05;                 // days after the deadline before a done-or-not project is cleared

export class Project {
  constructor(w, kind, owner, fire, { dish = null, by }){
    this.w = w; this.id = NEXT++; this.kind = kind; this.owner = owner; this.group = owner.group;
    this.fire = fire; this.dish = dish; this.by = by; this.status = 'on';
    this.members = new Set([owner]); this.stash = new Map(); this.tasks = [];
    this.cooked = false;
    if (kind === 'dish'){
      const r = RECIPES[dish];
      this.tasks.push({ id: 'base', item: r.base, n: 2, who: null, state: 'open' });
      for (const st of r.steps) if (st.do === 'add') this.tasks.push({ id: 'add:' + st.item[0], item: st.item, n: 1, who: null, state: 'open' });
      this.tasks.push({ id: 'cook', cook: true, who: null, state: 'open' });
    } else if (kind === 'hut'){   // `fire` is the hut here: poles to its pile, thatch to its roof
      this.hut = fire;
      this.tasks.push({ id: 'poles', item: ['wood'], n: 2, who: null, state: 'open' });
      this.tasks.push({ id: 'poles2', item: ['wood'], n: 2, who: null, state: 'open' });
      this.tasks.push({ id: 'thatch', item: ['thatch'], n: 2, who: null, state: 'open' });
      this.tasks.push({ id: 'thatch2', item: ['thatch'], n: 2, who: null, state: 'open' });
    } else {   // provision: bring home snacks that keep, a few each
      this.tasks.push({ id: 'gather1', item: ['apples', 'hazelnuts', 'berries'], n: 2, who: null, state: 'open' });
      this.tasks.push({ id: 'gather2', item: ['apples', 'hazelnuts', 'berries'], n: 2, who: null, state: 'open' });
    }
    tally(w, 'proposed');
  }

  get open(){ return this.tasks.filter(t => t.state === 'open'); }
  taskOf(n){ return this.tasks.find(t => t.who === n && t.state === 'taken') || null; }

  join(n){ this.members.add(n); n.project = this; }

  // n takes task t: it goes on their agenda; if the plan lapses, the task is
  // released and they owe the others a "couldn't"
  take(n, t){
    if (!t || t.state !== 'open') return null;
    this.join(n);
    t.who = n; t.state = 'taken';
    const pl = addPlan(n, { kind: 'task', project: this, task: t, item: t.item || null, cook: !!t.cook, dish: this.dish,
      fire: this.fire, until: this.by,
      // lapsing at the deadline is the project's end (one "never mind"), not a separate "couldn't"
      onLapse: () => this.w.time >= this.by ? this.finish('dropped') : this.fail(n, t, 'lapsed') });
    if (t.item) pl.deliver = (a) => this.deliver(a, t);
    if (t.cook) pl.onCooked = () => this.cookedNow(n, t);
    return t;
  }
  // the task most fit for n: one whose things they carry, else the first open (never cook unless they know it — convo checks)
  best(n){ return this.open.find(t => t.item && carriesAny(n, t.item)) || this.open.find(t => !t.cook) || null; }

  // at the fire with the goods: into the basket
  deliver(n, t){
    if (t.state !== 'taken' || t.who !== n) return;
    if (this.kind === 'hut'){                     // to the hut itself
      const h = this.hut;
      if (t.item[0] === 'wood' && (n.firewood || 0) > 0){ const m = Math.min(n.firewood, t.n); n.firewood -= m; h.addPoles(m); this.done(n, t); }
      else if (t.item[0] === 'thatch' && (n.thatchArms || 0) > 0){ const m = Math.min(n.thatchArms, t.n); n.thatchArms -= m; h.addThatch(m); this.done(n, t); }
      return;
    }
    let got = 0;
    for (const k of t.item){
      if (RAW_KINDS.has(k)){ if (n.rawKind === k && n.raw > 0){ const m = Math.min(n.raw, t.n - got); n.raw -= m; got += m; if (n.raw <= 0) n.rawKind = null; this.put(k, m); } }
      else { const have = countOf(n, k); if (have > 0){ const m = Math.min(have, t.n - got); takeFood(n, m, this.w.time, k); got += m; this.put(k, m); } }
      if (got >= t.n) break;
    }
    if (got <= 0) return;
    if (this.kind === 'provision' && this.fire.addFood){ this.fire.addFood(got); this.stash.clear(); }   // home to the camp store
    if (got >= t.n || this.kind === 'provision') this.done(n, t);
  }
  put(k, m){ this.stash.set(k, (this.stash.get(k) || 0) + m); }
  takeStash(kinds, m){
    let got = 0, kind = null;
    for (const k of kinds){ const have = this.stash.get(k) || 0; if (have > 0){ const x = Math.min(have, m - got); this.stash.set(k, have - x); got += x; kind = kind || k; } if (got >= m) break; }
    return { kind, n: got };
  }

  done(n, t){
    t.state = 'done';
    this._dropTask(n, t);
    owe(this, n, { what: 'done', task: t });
    tally(this.w, 'tasksDone');
    // a provisioning trip is done when everyone who went has brought something back
    if (this.kind === 'provision' && !this.tasks.some(x => x.state === 'taken')) this.finish('done');
  }
  fail(n, t, why){
    if (this.status !== 'on' || t.state !== 'taken' || t.who !== n) return;   // (a plan that ended takes its tasks with it)
    t.state = 'open'; t.who = null;              // back on the table for someone else
    owe(this, n, { what: 'failed', task: t, why });
    tally(this.w, 'tasksFailed');
  }
  cookedNow(n, t){ this.cooked = true; this.done(n, t); this.finish('done'); }

  finish(status){
    if (this.status !== 'on') return;
    this.status = status;
    for (const t of this.tasks) if (t.state === 'taken'){ t.state = status === 'done' ? 'done' : 'off'; }
    tally(this.w, status === 'done' ? 'done' : 'dropped');
    if (status !== 'done') owe(this, this.owner, { what: 'dropped' });
    if (status === 'done' && this.kind === 'hut') owe(this, this.owner, { what: 'built' });
    // meal: the members come to eat together when it's ready (agents.js 'meal' plan)
    if (status === 'done' && this.kind === 'dish')
      for (const m of this.members) addPlan(m, { kind: 'meal', fire: this.fire, dish: this.dish, until: this.w.time + 0.25 });
    for (const m of this.members) for (const p of [...plansOf(m, this.w.time)]) if (p.project === this) dropPlan(m, p);
  }
  _dropTask(n, t){ for (const p of [...plansOf(n, this.w.time)]) if (p.task === t) dropPlan(n, p); }

  // every frame-ish: the deadline, and tasks held by someone who's gone to sleep for the night
  tick(now){
    if (this.status !== 'on') return now > this.by + GRACE;
    if (this.kind === 'hut'){                      // done when it stands; off if it's been given up
      if (this.hut.done){ this.finish('done'); return false; }
      if (!this.w.huts.includes(this.hut)){ this.finish('dropped'); return false; }
    }
    if (now > this.by){ this.finish(this.kind === 'provision' && this.tasks.some(t => t.state === 'done') ? 'done' : 'dropped'); return false; }
    // the cook can start once the base is in the basket
    return false;
  }
}

const carriesAny = (n, items) => items.some(k => k === 'wood' ? (n.firewood || 0) > 0 : k === 'thatch' ? (n.thatchArms || 0) > 0 : countOf(n, k) > 0 || (n.rawKind === k && n.raw > 0));
// n owes the other members news of this; told in talk (convo.js projectNewsChain)
function owe(p, n, news){
  if (!n.owes) n.owes = [];
  n.owes.push({ project: p, ...news, to: new Set([...p.members].filter(m => m !== n)) });
}
function tally(w, k){ if (w.projStats) w.projStats[k] = (w.projStats[k] || 0) + 1; }

export const projectOf = (w, group) => group ? w.projects.find(p => p.group === group && p.status === 'on') || null : null;
