// convo.js — conversations as something that happens over time. Two dwellers who
// meet with something to say start a Conversation; it runs one short turn at a
// time, topic by topic, each topic a little chain of moves (a tell, a "where?",
// a guess, an offer, a decision). Every move comes from real state, read at the
// moment it's said, and does its work then: a fact passes when it's spoken, a
// "Here, have some" really hands food over, "I'll go later" really makes a plan
// (an agenda entry, plans.js, which Brain.choose acts on). Pure sim, no rendering: each move goes
// out through world.onSocial as a 'say' event for js/talk-view.js to show, and
// main.js turns its key into words.
//
// Manners come from the culture (`culture.talk`): how long a turn and a pause
// are, how many topics a talk runs to, whether a newcomer waits for a pause, cuts
// in, or isn't welcome, and whether people say goodbye. Whether the talkers stop,
// walk on together, or drift apart depends on where they are in the talk and who
// they are (steer). See docs/talk.md.

import { addNews, newsFor, GOSSIP_CD } from './gossip.js';
import { tie, regard, nudge, chemistry } from './ties.js';
import { addPlan, dropPlan, firstPlan, inAHurry, plansOf, boostCraving, craving, CRAVED } from './plans.js';
import { Project, projectOf } from './projects.js';
import { foresight } from './larder.js';
import { lack } from './trade.js';
import { RECIPES, stepsKnown, learnRecipe, carries, potNeeds, potHelp, potLeft, potStep, potDish } from './recipes.js';

const PART_R     = 9;       // apart further than this, someone has left the talk
const JOIN_R     = 5;       // close enough to ask to join
const GROUP_MAX  = 4;
const TALK_FAM   = 0.03;    // familiarity a hearer gains per turn
const TALK_REG   = 0.05;    // regard moved per turn, by how it landed (±1)
const TALK_REP   = 0.06;    // regard for someone, on hearing of their kindness
const TALK_EASE  = 0.15;    // folk mostly get along: a turn leans pleasant
const TALK_COMPANY = 0.05;  // loneliness eased per turn heard
const ASK_GAP    = 0.2;     // days (a day is ~10 min): nobody asks the same thing again sooner
const SAY_GAP    = 0.15;    // nor says what they're doing, or how they are, over and over
const PLAN_DAYS  = 1;       // a plan made in talk holds this long
const STEER_DT   = 1;       // seconds between stop / walk-on reassessments

// turnS: the shortest a move is up; readS: seconds per character on top (a long
// line stays longer); loreS: the same for a saying, slower — it takes a moment to
// sink in, and the pause after one is longer too (pause × LORE_PAUSE)
export const DEFAULT_TALK = { turnS: 2.6, readS: 0.055, loreS: 0.085, pause: 0.9, join: 'pause', strangers: true, farewell: true, maxTopics: 4, sayings: 0.3 };
const LORE_PAUSE = 2.2;
const GUESS_CHARS = 26;     // a line's length when nobody has told us its words (the headless harness)
// A long line — a saying, a song, an omen, a recipe — can't be followed on the
// move: it waits till speaker and hearer stand still (the talk asks them to stop),
// and if they can't within HOLD_MAX seconds it goes unsaid.
const LONG_CHARS = 48;
const HOLD_MAX   = 5;

// what someone says they're doing, by their current action (Brain.choose)
export const INTENT = { chop: 'wood', stack: 'wood', 'cut-thatch': 'hut', 'stake-hut': 'hut', 'build-shel': 'hut',
  build: 'fire', tend: 'fire', fire: 'fire', food: 'food', getfood: 'pot', sup: 'pot', cook: 'pot',
  store: 'food', hunt: 'meat', sleep: 'sleepy', indoors: 'sleepy', shelter: 'rain', 'tree-shelter': 'rain',
  collect: 'gems', revere: 'tree', fish: 'food', 'gather-flower': 'flower', 'plan-food': 'food', 'plan-cook': 'pot', help: 'pot', bring: 'food',
  'peel-bark': 'tree', 'canoe-work': 'wood', 'canoe-bring': 'wood' };
const FOOD_ICON = { berries: 'berries', apples: 'apples', acorns: 'nuts', hazelnuts: 'nuts',
  chamomile: 'flower', roots: 'roots', 'cattail root': 'roots', mushrooms: 'mushrooms', morels: 'mushrooms' };

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const need = (n, k) => (n.needs && n.needs[k]) || 0;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const quiet = (n, key, now, gap) => { const t = n._said && n._said.get(key); return t == null || now - t >= gap; };
const kin = (a, b) => !!(a.group && a.group === b.group);
let NEXT_ID = 1;

const tallyHold = w => { if (w.talkStats) w.talkStats.unsaid = (w.talkStats.unsaid || 0) + 1; };

// a move's words, for timing it — a fault in the words must never stop the world
// (a throw here once froze the Lea's three-day warm-up), so it's caught and logged
let _wordsWarned = false, _warned = false;
const warnOnce = (what, e) => { if (!_warned){ _warned = true; console.warn('talk:', what, e); } };
function wordsOf(w, m){
  try { return (w.lineOf(m) || '').length; }
  catch (e){ if (!_wordsWarned){ _wordsWarned = true; console.warn('talk: no words for', m.key, e); } return null; }
}

// one move: who says what to whom. `key` names the line (main.js SAY / moveLine);
// `ask` marks a question (it doesn't land either way, and its answer is owed).
const M = (who, to, key, icon, extra) => ({ who, to, key, icon, ...extra });

export function factIcon(f){
  return f.kind === 'dish' ? 'food' : f.kind === 'saw' ? 'person' : f.kind === 'kind' ? 'gift' : f.kind === 'food' ? (FOOD_ICON[f.foodKind] || 'food') : f.kind === 'market' ? 'trade' : f.kind === 'boat' ? 'place' : 'omen';
}

// ---- sayings: what folk know by heart ----------------------------------------
// Proverbs, verses and song lines (sayings.json, built by tools/build_sayings.py)
// that someone may answer talk with: "I'm starving." → "The idle soul shall suffer
// hunger." Many come in halves, call and response: if the hearer knows the second
// half they say it, and the two have shared something; if not, they ask how it
// goes, and now they know it — for a while. A saying learned in talk is
// half-forgotten after LORE_HALF days (they still know how it starts, and may
// have to ask the end), and gone after LORE_GONE. What a household grew up with
// (their heritage, from the group and the saying) is never forgotten.
const LORE_HALF = 2, LORE_GONE = 5;
const LORE_MAX  = 2;        // sayings in one talk, at most
let SAYINGS = [];
export function setSayings(list){
  SAYINGS = list.map(s => ({ id: s.id, kind: s.kind, n: s.parts.length, tags: new Set(s.tags), lens: s.parts.map(p => p.length) }));
}
const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
function lore(n){
  if (n.lore && n._loreN === SAYINGS.length) return n.lore;
  n.lore = n.lore || new Map(); n._loreN = SAYINGS.length;
  const home = n.group ? 'g' + n.group.id : 'n' + n.id;     // a household shares its heritage
  const elder = n.role === 'elder' || n.role === 'mother' || n.role === 'father' || n.role === 'captain';
  for (const s of SAYINGS){
    const p = (s.kind === 'song' ? 0.5 : 0.28) * (elder ? 1.7 : 1) * (n.stargazer && s.tags.has('fate') ? 1.8 : 1);
    if (!n.lore.has(s.id) && hash01(home, s.id) < p) n.lore.set(s.id, { heritage: true });
  }
  return n.lore;
}
const knowsAll   = (n, s, now) => { const e = lore(n).get(s.id); return !!e && (e.heritage || now - e.t < LORE_HALF); };
const knowsStart = (n, s, now) => { const e = lore(n).get(s.id); return !!e && (e.heritage || now - e.t < LORE_GONE); };
const learn = (n, s, now) => { const e = lore(n).get(s.id); if (!e || !e.heritage) lore(n).set(s.id, { t: now }); };

const KIND_WORDS = new Set(['proj-ack-good', 'proj-yes', 'proj-claim', 'praise-cook', 'praise-other', 'praise-thanks', 'pot-offer', 'a-pot-help', 'give-food', 'thanks-food', 'lore-learnt', 'a-help', 'a-stuck', 'meh-reply']);

// what a move is about, for answering it with a saying
const THEME = {
  'tell-food': 'food', 'tell-dish': 'food', 'q-teach': 'food', 'q-food': 'hunger', 's-pot': 'hunger', 'a-food-hungry': 'hunger', 'give-food': 'gift',
  'thanks-food': 'gift', 'tell-kind': 'gift', 'kind-warm': 'gift', 'go-now': 'travel', 'yes-go': 'travel',
  'go-later': 'later', 'q-fire': 'fire', 's-fire': 'cold', 'a-fire-tired': 'rest', 'no-tired': 'rest', 'i-chop': 'work',
  'i-stack': 'work', 's-rain': 'rain', 'a-rain-yes': 'weather', 'a-rain-maybe': 'weather', 's-sleepy': 'rest',
  'i-sleep': 'rest', 'hi-back': 'guest', 'join-ok': 'guest', 'join-sit': 'guest', 'tell-saw': 'friend',
  'omen-mean': 'fate', 'a-hut-have': 'hut', 'a-hut-mine': 'hut', 'a-hut-yes': 'hut', 's-omen': 'night',
  's-sun': 'merry', 'me-too': 'friend', 'same': 'friend', 'i-food': 'food', 'i-plan-food': 'travel',
  'a-pot-help': 'food', 'praise-thanks': 'gift', 'praise-agree': 'food', 'story-food': 'food', 'story-kind': 'gift',
  'story-saw': 'friend', 'ok-tomorrow': 'later', 'a-tomorrow-none': 'later', 'help-ok': 'work', 'fetch-it': 'travel',
  'meh-reply': 'talk', 'lore-thanks': 'talk', 's-crave': 'food', 'crave-too': 'food',
  'proj-cook': 'friend', 'proj-done': 'gift', 'proj-failed': 'work', 'prov-go': 'work', 'proj-ack-good': 'friend',
};

// someone answers the topic just finished with a saying they know (or half know)
function sayingAfter(c){
  const th = c.theme; c.theme = null;
  if (!th || !SAYINGS.length || c.lore >= LORE_MAX || Math.random() > (c.talk.sayings ?? 0.3)) return null;
  const now = c.w.time;
  const by = [th.to, ...c.members.filter(m => m !== th.to && m !== th.who)].filter(m => m && c.members.includes(m));
  for (const A of by){
    const fits = SAYINGS.filter(s => s.tags.has(th.tag) && !c.saidLore.has(s.id) && knowsStart(A, s, now));
    if (!fits.length) continue;
    c.lore++;
    return sayingChain(c, A, th.who, fits[Math.floor(Math.random() * fits.length)]);
  }
  return null;
}

// A says the first part; B answers with the next if B knows it (call and
// response — and the two of them warm to each other for it), or asks how it goes
// and learns it. If A only half remembers, A asks B for the end.
function* sayingChain(c, A, B, s){
  const now = c.w.time, icon = s.kind === 'song' ? 'music' : 'scroll';
  const part = (who, to, k, extra) => M(who, to, 'saying', icon, { saying: s.id, part: k, feel: true, ...extra });
  c.saidLore.add(s.id);
  const whole = knowsAll(A, s, now);
  yield part(A, B, 0);
  if (s.n === 1){
    if (knowsStart(B, s, now)){ learn(B, s, now); yield M(B, A, 'lore-agree', icon, { feel: true }); }
    else { learn(B, s, now); yield M(B, A, 'lore-new', icon, { feel: true }); }
    return;
  }
  for (let k = 1; k < s.n; k++){
    if (!whole){                                             // forgotten how it ends
      yield M(A, B, 'lore-forgot', 'ask', { ask: true });
      if (knowsAll(B, s, now)){
        yield part(B, A, k);
        learn(A, s, now); learn(B, s, now);
        yield M(A, B, 'lore-thanks', icon);
      } else yield M(B, A, 'lore-dunno', 'ask');
      return;
    }
    if (knowsAll(B, s, now)){                                // they both know it
      yield part(B, A, k);
      learn(B, s, now); nudge(A, B, 0.04, 0.05); nudge(B, A, 0.04, 0.05);
    } else {
      yield M(B, A, 'lore-ask', 'ask', { ask: true });
      yield part(A, B, k);
      learn(B, s, now);
      yield M(B, A, 'lore-learnt', icon, { feel: true });
      return;
    }
  }
  learn(A, s, now);
}

// make a plan: Brain.choose weighs it (agents.js)
function plan(w, n, kind, extra){ return addPlan(n, { kind, until: w.time + PLAN_DAYS, ...extra }); }

export class Conversation {
  constructor(w, a, b){
    this.w = w; this.id = NEXT_ID++;
    this.talk = (a.culture && a.culture.talk) || DEFAULT_TALK;
    this.members = [a, b]; this.waiting = [];
    this.chain = opening(this, a, b);
    this.t = 0.3; this.topics = 0; this.last = null; this.closed = false; this.done = false;
    this.lastOpener = null; this.told = new Set();
    this.theme = null; this.saidLore = new Set(); this.lore = 0;   // sayings (sayingAfter)
    this.mode = new Map(); this._steerT = 0;
    a.convo = b.convo = this;
  }

  // A trade at a village door (agents.js callAt): a talk that opens with the
  // haggle, and holds both of them there till it's done (see _steer).
  static haggle(w, a, b, h){
    for (const n of [a, b]) if (n.convo) n.convo.leave(n);
    const c = new Conversation(w, a, b);
    c.chain = c.trading = (function*(){ yield* opening(c, a, b); yield* haggleChain(c, a, b, h); })();
    return c;
  }

  // has either of them anything to say? (else they don't start)
  static worthIt(w, a, b){
    return tie(a, b).fam < 0.15 || !!pickTopic(w, a, b, null) || !!pickTopic(w, b, a, null);
  }

  // Protocol. Someone close by wants in: they wait for a pause, cut in, or are
  // turned away, by the talk's culture. Newcomers stand by while they wait.
  offerJoin(n){
    if (this.done || n.convo || this.members.length + this.waiting.length >= GROUP_MAX) return;
    const knows = this.members.some(m => kin(m, n) || tie(n, m).fam > 0.25);
    if (this.talk.join === 'never' && !this.members.some(m => kin(m, n))) return;
    if (!this.talk.strangers && !knows) return;
    this.waiting.push(n); n.convo = this;
  }

  _admit(atPause){
    if (!this.waiting.length) return;
    if (this.talk.join !== 'interrupt' && !atPause) return;
    for (const n of this.waiting.splice(0)){
      if (!this.members.some(m => dist(m, n) <= JOIN_R + 2)){ n.convo = null; continue; }   // gave up
      this.members.push(n);
      if (this.talk.join === 'interrupt'){ this.chain = null; this.nextSpeaker = n; }   // cut straight in with their own news
      else this.chain = joining(this, n);
    }
  }

  leave(n){
    const i = this.members.indexOf(n); if (i >= 0) this.members.splice(i, 1);
    const j = this.waiting.indexOf(n); if (j >= 0) this.waiting.splice(j, 1);
    if (n.convo === this) n.convo = null;
    n._gossipCd = GOSSIP_CD; this.mode.delete(n);
    if (n.brain && n.brain.target && n.brain.target.kind === 'talk'){ n.brain.target = null; n.brain.decideT = 0; }
  }

  end(){
    if (this.done) return;
    this.done = true;
    // parted: after a goodbye the pair don't seek each other out again for a while
    if (this.goer) for (const o of this.members) if (o !== this.goer){ part(this.goer, o, this.w.time); part(o, this.goer, this.w.time); }
    for (const n of [...this.members, ...this.waiting]) this.leave(n);
    this.w._emit({ type: 'end', convo: this });
  }

  update(dt){
    if (this.done) return;
    for (const m of [...this.members])
      if (m.sleeping || !this.members.some(o => o !== m && dist(m, o) <= PART_R)) this.leave(m);
    for (const n of [...this.waiting]) if (n.sleeping || !this.members.some(m => dist(m, n) <= PART_R)) this.leave(n);
    if (this.members.length < 2) return this.end();
    if ((this._steerT -= dt) <= 0){ this._steerT = STEER_DT; this._steer(); }
    if (this.stay && (this.stayT -= dt) <= 0) this.stay = null;   // it's been read
    if ((this.t -= dt) > 0) return;
    if (this.pending){                                 // a long line, waiting on stillness
      const m = this.pending, still = n => !n || !n.moving;
      if (!this.members.includes(m.who)){ this.pending = null; this.chain = null; }
      else if (still(m.who) && still(m.to)){ this.pending = null; this._speak(m); this.stay = m; this.stayT = m.dur; return; }   // and they stay put while it's up
      else if ((this.held += dt) < HOLD_MAX) return;
      else { this.pending = null; this.chain = null; tallyHold(this.w); }   // couldn't stop: let it go, and the rest of that topic with it
    }
    this._admit(!this.chain);
    for (let guard = 0; guard < 8; guard++){
      if (!this.chain){
        this._admit(true);
        if (this.closed) return this.end();
        this.chain = this.topics < this.talk.maxTopics ? this._nextTopic() : null;
        if (this.chain) this.topics++;
        else { this.closed = this._byeSaid = true; this.chain = this.talk.farewell && !this.noBye ? farewell(this) : null; if (!this.chain) return this.end(); }
      }
      let s;
      try { s = this.chain.next(); }
      catch (e){ warnOnce('a topic failed', e); this.chain = null; continue; }   // a fault ends the topic, never the world
      if (!s.done && this._long(s.value)){ this.pending = s.value; this.held = 0; if (this.w.talkStats) this.w.talkStats.held = (this.w.talkStats.held || 0) + 1; return; }   // wait for them to stand still
      if (s.done){
        this.chain = sayingAfter(this);                // answer the topic with a saying, perhaps
        if (this.chain) continue;
        if (this.closed && !this._byeSaid){ this._byeSaid = true; this.chain = this.talk.farewell && !this.noBye ? farewell(this) : null; if (!this.chain) return this.end(); }
        continue;
      }
      return this._speak(s.value);
    }
    this.end();
  }

  // too long to follow on the move? (sayings and songs always; else by its words)
  _long(m){
    if (m.key === 'saying' || m.key === 'a-how' || m.key === 'tell-omen' || m.key === 'omen-mean') return true;
    return !!this.w.lineOf && (wordsOf(this.w, m) || 0) > LONG_CHARS;
  }

  // the next topic: whoever didn't open the last one speaks first, to whoever
  // spoke last (or anyone else in the talk)
  _nextTopic(){
    const order = this.nextSpeaker ? [this.nextSpeaker, ...this.members.filter(m => m !== this.nextSpeaker)]
      : [...this.members.filter(m => m !== this.lastOpener), ...this.members.filter(m => m === this.lastOpener)];
    this.nextSpeaker = null;
    for (const sp of order){
      const to = this.last && this.last.who !== sp && this.members.includes(this.last.who) ? this.last.who
        : this.members.find(m => m !== sp);
      const g = pickTopic(this.w, sp, to, this);
      if (g){ this.lastOpener = sp; return g; }
    }
    return null;
  }

  _speak(m){
    const w = this.w, now = w.time;
    if (m.mark){                                   // said — and a question asked is settled for all who heard it
      for (const o of m.mark.startsWith('q:') ? this.members : [m.who]){ if (!o._said) o._said = new Map(); o._said.set(m.mark, now); }
    }
    m.react = m.ask || !(m.fact || m.feel) ? 0 : react(m.to, m.who, m);   // news and opinions land; "where?" doesn't
    if (KIND_WORDS.has(m.key)) m.react = Math.max(0, m.react);                // thanks and offers of food don't grate
    nudge(m.to, m.who, TALK_FAM, TALK_REG * m.react);
    for (const o of this.members){
      if (o === m.who) continue;
      o.needs.company = clamp01(o.needs.company - TALK_COMPANY);
      if (o !== m.to) nudge(o, m.who, TALK_FAM * 0.5, 0);        // overheard
      if (m.fact && o !== m.fact.subj){
        addNews(o, { ...m.fact, from: m.who, hops: (m.fact.hops || 0) + 1 });   // the news passes as it's said
        if (m.fact.kind === 'kind' && regard(o, m.fact.subj) > -0.3) nudge(o, m.fact.subj, 0, TALK_REP);
      }
    }
    if (m.fact) this.told.add(m.fact.key);
    const th = THEME[m.key];
    if (th && !m.ask && m.key !== 'saying') this.theme = { tag: th, who: m.who, to: m.to };
    m.who.needs.company = clamp01(m.who.needs.company - TALK_COMPANY);
    // as long as it takes to read: the game tells us the words (world.lineOf, main.js);
    // without it, a saying's length is known and anything else is a guess
    const lore = m.key === 'saying', tk = this.talk;
    const chars = (w.lineOf && wordsOf(w, m)) ?? (lore ? (SAYINGS.find(s => s.id === m.saying)?.lens[m.part] || 60) : GUESS_CHARS);
    m.dur = (tk.turnS ?? DEFAULT_TALK.turnS) + chars * (lore ? (tk.loreS ?? DEFAULT_TALK.loreS) : (tk.readS ?? DEFAULT_TALK.readS));
    this.last = m;
    this.t = m.dur + (tk.pause ?? DEFAULT_TALK.pause) * (lore ? LORE_PAUSE : 1);
    w._emit({ type: 'say', convo: this, move: m });
  }

  // Stop to talk, walk on together, or go: each talker weighs how caught up they
  // are (where the talk is — an answer owed holds you; a goodbye lets you go — how
  // sociable they are, how they feel about the other) against what's pulling them
  // away (their worst need, a job they're committed to, a plan to go now).
  _steer(){
    if (this.trading && this.trading === this.chain){ for (const m of this.members) this.mode.set(m, 'halt'); return; }   // mid-haggle: nobody walks off
    const stay = new Map();
    for (const m of this.members) stay.set(m, this._engage(m) - this._urgency(m));
    for (const m of this.members){
      const prev = this.mode.get(m), s = stay.get(m) + (prev === 'go' ? -0.1 : 0.1);   // a little hysteresis
      this.mode.set(m, s > 0 ? 'halt' : 'go');
    }
    if (this.members.some(m => this.mode.get(m) === 'go'))       // someone's moving off: follow, if keen enough
      for (const m of this.members){
        if (this.mode.get(m) !== 'halt') continue;
        this.mode.set(m, stay.get(m) < 0.3 ? 'go' : 'follow');
      }
  }
  _engage(m){
    const owed = this.last && this.last.to === m && this.last.ask;
    const stage = this.closed ? 0.15 : owed ? 1.3 : this.chain ? 0.85 : 0.5;
    const soc = Math.min(1.6, Math.max(0.5, (m.persona && m.persona.company) || 1));
    const other = this.members.find(o => o !== m);
    return stage * soc * (1 + 0.5 * (other ? regard(m, other) : 0));
  }
  _urgency(m){
    const b = m.brain;
    if (b && (b._building || b._buildingShel || b._sleep || b._pilgrim || b._ferry || (b._buildingHut && b._buildingHut.staked < 1))) return 3;
    const worst = Math.max(need(m, 'warmth'), need(m, 'food'), need(m, 'rest'));
    return 1.3 * worst * worst + (inAHurry(m) ? 0.5 : 0);
  }

  // the Brain asks: what should I do with my feet? A target, or null to carry on
  // with my own business (and the talk goes with me while we're in earshot)
  steer(n){
    const pm = this.pending || this.stay;             // a long line waits on us, or is being said: stay for it
    if (pm && (n === pm.who || n === pm.to)){
      const o = n === pm.who ? pm.to : pm.who;
      // waiting to say it: come close enough and stop. Saying it: stay just where you are (seated, if seated)
      if (o) return this.stay ? { ...talkTarget(o, 99), sit: n.sitting } : n.sitting ? { ...talkTarget(o, 99), sit: true } : talkTarget(o, 3.2);
    }
    if (n.sitting) return null;                       // talk from your seat
    const others = this.members.filter(o => o !== n);
    if (!others.length) return null;
    const near = others.reduce((a, b) => dist(a, n) <= dist(b, n) ? a : b);
    if (this.waiting.includes(n)) return talkTarget(near, 3);   // stand by till there's a pause
    const mode = this.mode.get(n) || 'halt';
    if (mode === 'go') return null;
    if (mode === 'follow'){
      const goer = others.find(o => this.mode.get(o) === 'go') || near;
      return talkTarget(goer, 1.6);
    }
    return talkTarget(near, 2.6);
  }
}

const talkTarget = (o, tol) => ({ kind: 'talk', x: o.x, z: o.z, tol,
  satisfy: (a, dt) => { a.needs.company = clamp01(a.needs.company - 0.04 * dt); } });

// how a hearer takes a move: their regard for anyone it's about, a liking for
// useful news, all tilted by the pair's chemistry → +1 / 0 / −1
function react(to, who, m){
  if (!to) return 0;
  let base = 0.3;
  if (m.fact && m.fact.subj){
    const r = regard(to, m.fact.subj);
    base = m.fact.kind === 'kind' ? (r < -0.3 ? -1 : 0.8) : r > 0.25 ? 0.8 : r < -0.25 ? -0.8 : 0;
  } else if (m.fact) base = m.fact.kind === 'food' ? 0.7 : 0.4;
  const s = base + TALK_EASE + chemistry(to, who) * 0.8;
  return s > 0.5 ? 1 : s < -0.5 ? -1 : 0;
}

// ---- choosing a topic --------------------------------------------------------
// What sp would raise with `to` now, most pressing first: the camp fire low as
// night comes, no roof at dusk, hunger with an empty pack, clouds piling up,
// news `to` hasn't heard, what `to` is up to, what sp is up to, how sp is.
// Returns a chain (generator), or null if there's nothing worth saying.
function pickTopic(w, sp, to, c){
  const now = w.time;
  const ask = key => quiet(sp, 'q:' + key, now, ASK_GAP);
  // a shared plan (projects.js): news owed to a member first — that's the duty
  // that holds a shared plan together — then telling kin of it, then proposing one
  const owed = sp.owes && sp.owes.find(o => o.to.has(to));
  if (owed) return projectNewsChain(w, sp, to, owed, c);
  const proj = busy(sp) ? sp.project : null;
  if (proj && kin(sp, to) && !proj.members.has(to) && proj.open.length && !busy(to) && quiet(sp, 'pt:' + proj.id + ':' + to.id, now, 1)) return projectTellChain(w, sp, to, proj);
  if (proj && proj.members.has(to) && !proj.taskOf(to) && proj.open.some(t => !t.cook) && quiet(to, 'pa:' + proj.id, now, 0.05)) return projectTellChain(w, sp, to, proj);
  // foresight: someone prudent, not hungry yet, sees the household running low and
  // gets everyone gathering before it bites (a provision plan)
  if (kin(sp, to) && foresight(sp) > 1 && need(sp, 'food') < 0.5 && !projectOf(w, sp.group) && !busy(to)
      && quiet(sp, 'q:provision', now, ASK_GAP) && householdShort(w, sp) && homeFire(w, sp)) return provisionChain(w, sp, to);
  // a hut of ours going up, stuck for poles or thatch: ask the household to help raise it
  const raising = kin(sp, to) && !projectOf(w, sp.group) && !busy(to) && quiet(sp, 'ph:*', now, ASK_GAP)
    && w.huts.find(h => !h.done && h.staked >= 1 && (h.owner === sp || (h.kin && h.kin === sp.group)) && quiet(sp, 'ph:' + w.huts.indexOf(h), now, ASK_GAP));
  if (raising) return hutChain2(w, sp, to, raising);
  // a canoe of ours on the bed: ask for a hand with it (docs/boats.md, "Making canoes")
  const bed = !to.home && !busy(to) && quiet(sp, 'cn:*', now, ASK_GAP) && (w.canoeBuilds || []).find(b =>
    (b.owner === sp || (sp.plans || []).some(q => q.build === b)) && !(to.plans || []).some(q => q.build === b));
  if (bed) return canoeChain(w, sp, to, bed);
  // wanting a canoe and knowing none: ask before setting about making one
  if (!sp.home && sp.brain && sp.brain._canoeWish > 0 && !(to.home) && ask('canoe')) return canoeAskChain(w, sp, to);
  const want = firstPlan(sp, 'dish');
  if (want && kin(sp, to) && !projectOf(w, sp.group) && !busy(to)){
    // the dish they crave, or another they'd like nearly as much, that the two can manage
    const dish = [want.dish, ...CRAVED].find(d => (d === want.dish || craving(sp, d, now) > 0.5) && quiet(sp, 'pp:' + d, now, ASK_GAP) && feasible(w, sp, to, d));
    if (dish) return proposeChain(w, sp, to, want, dish);
  }
  let fire = null, fd = 45;
  for (const f of w.fires){ const d = Math.hypot(f.x - sp.x, f.z - sp.z); if (d < fd){ fd = d; fire = f; } }
  if (fire && fire.lit && fire.woodpile < 4 && (w.evening > 0.2 || w.night > 0.3) && ask('fire')) return fireChain(w, sp, to);
  // the pot: the cook stuck on a step asks; thanks for a meal; what's cooking; the cooking itself
  const pot = nearPot(w, sp), meal = sp._ate;
  if (pot && pot.pot.stuck && pot.potCook() === sp && quiet(sp, 'q:stuck' + pot.pot.step, now, 0.03)) return stuckChain(w, sp, to, pot);
  if (meal && now - meal.t < 0.2 && meal.cook && meal.cook !== sp && quiet(sp, praiseKey(meal), now, 0.5)) return praiseChain(w, sp, to);
  if (pot && ask('pot') && (pot.potCook() === sp || pot.pot.raw > 0 || need(sp, 'food') > 0.3)) return potChain(w, sp, to, pot);
  if (pot && pot.potCook() !== sp && cookingWanted(w, sp, pot)) return cookingChain(w, sp, pot.potCook() && pot.potCook().convo === sp.convo && pot.potCook() !== sp ? pot.potCook() : to, pot);
  const heard = heardDish(sp, to, now);
  if (heard) return teachChain(w, sp, to, heard.recipe);
  if ((w.evening > 0.25 || w.rain > 0.2) && !hasRoof(w, sp) && ask('hut')) return hutChain(w, sp, to);
  if (need(sp, 'food') > 0.55 && !((sp.pack || 0) > 0) && ask('food')) return hungerChain(w, sp, to, c);
  if (w.rain < 0.05 && w.cloud > 0.45 && ask('rain')) return rainChain(w, sp, to);
  // the fire at night: the day's story, tomorrow, a song
  const evening = w.night > 0.5 && w.fires.some(f => f.lit && Math.hypot(f.x - sp.x, f.z - sp.z) < 9);   // night, by a fire
  if (evening && c && c.members.some(m => m.atGathering) && ask('sing')) { const g = singChain(c, sp, to); if (g) return g; }
  if (evening){                                      // the day's doings, told as a story, before any omen
    const day = newsFor(sp, to, c && c.told, x => x.kind !== 'omen' && w.time - x.t < 0.5);
    if (day && quiet(sp, 'st:' + day.key, now, 0.5)){ if (!sp._said) sp._said = new Map(); sp._said.set('st:' + day.key, now); return storyChain(w, sp, to, day); }
  }
  if (evening && ask('tomorrow')) return tomorrowChain(w, sp, to);
  const f = newsFor(sp, to, c && c.told);
  if (f) return newsChain(w, sp, to, f, c);
  if (INTENT[to.actionLabel] && quiet(to, 'i:' + to.actionLabel, now, SAY_GAP) && ask('doing')) return doingChain(w, sp, to);
  if (INTENT[sp.actionLabel] && quiet(sp, 'i:' + sp.actionLabel, now, SAY_GAP)) return selfChain(w, sp, to);
  if (want && quiet(sp, 's:crave' + want.dish, now, ASK_GAP)) return craveChain(w, sp, to, want.dish);   // a craving, said aloud
  const st = smallTopic(w, sp);
  if (quiet(sp, 's:' + st, now, SAY_GAP)) return smallChain(w, sp, to, st);
  return null;
}

const hasRoof = (w, n) => w.huts.some(h => h.mayUse(n) && h.built > 0.99);
// a pot with something in it, within talking reach of the fire
function nearPot(w, n){
  for (const f of w.fires) if (f.pot && (f.pot.raw + f.pot.ready) > 0 && Math.hypot(f.x - n.x, f.z - n.z) < 8) return f;
  return null;
}
function smallTopic(w, n){
  if (w.rain > 0.2) return 'rain';
  if (need(n, 'food') > 0.6) return 'pot';
  if (need(n, 'warmth') > 0.6) return 'fire';
  if (need(n, 'rest') > 0.65) return 'sleepy';
  return w.night > 0.5 ? 'omen' : 'sun';
}
function intentMove(w, n, to){
  if (!INTENT[n.actionLabel]) return M(n, to, 'i-none', 'hello');   // they've stopped since: "Nothing much."
  const b = n.brain, ref = b && b.target && b.target.ref;
  const p = n.actionLabel === 'plan-food' ? firstPlan(n, 'food') || firstPlan(n, 'bring') : null;
  // gathering for a dish we mean to make, or making it: say so
  const dishPl = (plansOf(n, w.time).find(q => q.kind === 'dish' || (q.kind === 'task' && q.dish)) || null);
  if (n.actionLabel === 'food' && ref && dishPl && RECIPES[dishPl.dish]
      && (RECIPES[dishPl.dish].base.includes(ref.kind) || RECIPES[dishPl.dish].steps.some(st => st.item && st.item.includes(ref.kind))))
    return M(n, to, 'i-gather-dish', INTENT.food, { mark: 'i:food', feel: true, food: ref.kind, dish: dishPl.dish });
  return M(n, to, 'i-' + n.actionLabel, INTENT[n.actionLabel], { mark: 'i:' + n.actionLabel, feel: true,
    food: p ? p.food : n.actionLabel === 'food' && ref ? ref.kind : null, src: p ? p.from : null,
    dish: n.actionLabel === 'plan-cook' && ref && ref.pot ? ref.pot.recipe : null });
}

// ---- chains ------------------------------------------------------------------

function* opening(c, a, b){
  if (tie(a, b).fam >= 0.15) return;               // they know each other: straight to it
  yield M(a, b, 'hi-name', 'hello');               // "Hello. I'm Tam."
  nudge(a, b, 0.12, 0); nudge(b, a, 0.12, 0);       // introduced
  yield M(b, a, 'hi-back', 'hello');               // "Bryn."
}

function* joining(c, n){
  const host = c.members.filter(m => m !== n).reduce((a, b) => dist(a, n) <= dist(b, n) ? a : b);
  yield M(n, host, 'join-ask', 'hello', { ask: true });       // "Mind if I join?"
  yield M(host, n, host.sitting ? 'join-sit' : 'join-ok', 'hello');
}

// Goodbye is said only by someone actually leaving: each talker works out what
// they'd do next, and if it takes them away, they say so and go. If nobody's going
// anywhere (two at a fire), there's no goodbye — the talk just lapses.
function* farewell(c){
  const goer = c.members.find(m => willLeave(m));
  if (!goer) return;
  const other = c.last && c.last.who !== goer && c.members.includes(c.last.who) ? c.last.who : c.members.find(m => m !== goer);
  if (!other) return;
  c.goer = goer;
  yield M(goer, other, 'bye', 'hello');             // "Right, I'm off."
  yield M(other, goer, 'bye-back', 'hello');        // "See you."
}
const LEAVE_D = 8;
export const PART_DAYS = 0.1;                         // ~a minute: a goodbye holds this long
function part(a, b, now){ if (!a._parted) a._parted = new Map(); a._parted.set(b, now); }
export const parted = (a, b, now) => !!a._parted && now - (a._parted.get(b) ?? -1) < PART_DAYS;
function willLeave(n){
  const b = n.brain;
  if (!b) return false;
  const held = b.target;
  b.choose();                                        // what would I do next, if not this?
  const t = b.target; b.target = held;               // (just asking — the talk still has our feet)
  return !!t && t.kind !== 'greet' && Math.hypot(t.x - n.x, t.z - n.z) > LEAVE_D;
}

// news, told a piece at a time. Food: what, then (if they care) where, a guess
// at how far, an offer to go together, and what each decides to do about it.
function* newsChain(w, T, L, f, c){
  yield M(T, L, 'tell-' + f.kind, factIcon(f), { fact: f });
  if (f.kind === 'food'){
    if (need(L, 'food') < 0.25 && !kin(T, L)) return;            // the mark says how it landed
    yield M(L, T, 'ask-where', 'ask', { ask: true });
    yield M(T, L, 'where', 'place', { x: f.x, z: f.z });
    const far = Math.hypot(f.x - T.x, f.z - T.z);
    if (far < 12){                                               // right by: no outing to plan
      if (need(L, 'food') > 0.3){ plan(w, L, 'food', { x: f.x, z: f.z, food: f.foodKind, from: T, now: true }); yield M(L, T, 'grab', 'food'); }
      return;
    }
    if (far > 35){
      const g = M(L, T, 'guess', 'place', { x: f.x, z: f.z, ask: true });
      yield g;
      yield M(T, L, 'guess-reply', 'place', { x: f.x, z: f.z, re: g });
    }
    yield* goChain(w, T, L, f, c);
  } else if (f.kind === 'saw'){
    if (!(kin(L, f.subj) || regard(L, f.subj) > 0.4)) return;   // only folk they care about
    yield M(L, T, 'ask-where-who', 'ask', { ask: true, subj: f.subj });
    yield M(T, L, 'where', 'place', { x: f.x, z: f.z });
    yield M(L, T, 'thanks', 'hello');
  } else if (f.kind === 'kind'){
    const r = regard(L, f.subj);
    yield M(L, T, r > 0.3 ? 'kind-warm' : r < -0.3 ? 'kind-cold' : 'kind-mild', 'gift', { subj: f.subj, feel: true });
  } else if (f.kind === 'market'){
    // a trade heard of: one of the folk short of garden food asks what that village wants
    if (f.wish && !L.home && lack(L, 'garden', w.time) > 0.3 && w.tradePlan){
      yield M(L, T, 'mk-ask', 'ask', { ask: true });              // "What do they want there?"
      yield M(T, L, 'mk-wish', 'trade', { item: f.wish });         // "Meat, mostly."
      w.tradePlan(L, f.house, f.wish);
      yield M(L, T, 'mk-plan', 'trade', { item: f.wish });         // "I'll get some and go."
    } else yield M(L, T, f.qn >= f.gn ? 'mk-good' : 'mk-dear', 'trade', { feel: true });
  } else if (f.kind === 'boat'){
    // where a canoe lies (agents.js seeCanoes): the folk ask where; villagers keep off the water
    if (L.home) return;
    yield M(L, T, 'ask-where', 'ask', { ask: true });
    yield M(T, L, 'where', 'place', { x: f.x, z: f.z });
    yield M(L, T, 'thanks', 'hello');
  } else if (f.kind === 'dish'){
    if (f.subj === T && stepsKnown(L, f.recipe, w.time) < RECIPES[f.recipe].steps.length && stepsKnown(T, f.recipe, w.time) === RECIPES[f.recipe].steps.length) yield* teachChain(w, L, T, f.recipe);
  } else if (f.kind === 'omen' && f.house){
    yield M(L, T, 'omen-ask', 'ask', { ask: true });
    yield M(T, L, 'omen-mean', 'omen', { tenor: f.tenor });
  }
}

// "Want to go get them?" — the hearer asks if they're hungry and like the teller.
// The teller says yes only if they're hungry too; no, if there's plenty near them.
// Then the hearer decides: now, later, or not at all — and that is a real plan.
function* goChain(w, T, L, f, c){
  const where = { x: f.x, z: f.z, food: f.foodKind, from: T };
  if (need(L, 'food') > 0.35 && regard(L, T) > -0.2){
    yield M(L, T, 'propose-food', 'ask', { ask: true, food: f.foodKind });
    if (need(T, 'food') > 0.5 && !((T.pack || 0) > 1)){
      plan(w, T, 'food', { ...where, from: null, now: true }); plan(w, L, 'food', { ...where, now: true });
      yield M(T, L, 'yes-go', 'food');
      c.closed = true; c.noBye = true;                           // off they go together
      return;
    }
    const plenty = w.food.filter(p => p.ripe && Math.hypot(p.x - T.x, p.z - T.z) < 30).length >= 3;
    yield M(T, L, plenty ? 'no-plenty' : (T.pack || 0) > 2 ? 'no-pack' : 'no-busy', 'food');
  }
  const n = need(L, 'food');
  if (n > 0.55){ plan(w, L, 'food', { ...where, now: true }); yield M(L, T, 'go-now', 'food'); c.closed = true; }
  else if (n > 0.3){ plan(w, L, 'food', where); yield M(L, T, 'go-later', 'food'); }
}

function* fireChain(w, A, B){
  yield M(A, B, 'q-fire', 'fire', { mark: 'q:fire' });          // "Fire's getting low."
  if ((B.firewood || 0) > 0){ yield M(B, A, 'a-fire-have', 'wood'); return; }   // they'll stack it (choose)
  const tired = n => need(n, 'rest') > 0.6 || need(n, 'food') > 0.7;
  if (!tired(B)){
    plan(w, B, 'wood', { now: true });
    yield M(B, A, 'a-fire-go', 'wood', { ask: true });           // "I'll get some. Coming?"
    if (!tired(A) && regard(A, B) > -0.2){ plan(w, A, 'wood', { now: true }); yield M(A, B, 'yes-come', 'wood'); }
    else yield M(A, B, 'no-tired', 'sleepy');
  } else {
    yield M(B, A, 'a-fire-tired', 'sleepy', { ask: true });       // "I'm worn out. Can you?"
    if (!tired(A)){ plan(w, A, 'wood', { now: true }); yield M(A, B, 'fine-i-go', 'wood'); }
    else yield M(A, B, 'someone', 'wood');
  }
}

function* hutChain(w, A, B){
  yield M(A, B, 'q-hut', 'hut', { mark: 'q:hut', ask: true });  // "Should we build a hut?"
  const ours = w.huts.find(h => h.mayUse(B));
  if (ours && ours.built > 0.99){
    yield M(B, A, 'a-hut-have', 'hut');                           // "Ours is up."
    plan(w, A, 'hut'); yield M(A, B, 'a-hut-mine', 'hut');        // "I'd better start mine."
  } else if (ours) yield M(B, A, 'a-hut-building', 'hut');        // "We're still on ours."
  else {
    yield M(B, A, w.rain > 0.2 ? 'a-hut-rain' : 'a-hut-yes', 'hut');
    plan(w, A, 'hut');
  }
}

// Hungry and empty-handed. To your own people you just say so, and if they have
// anything they hand it over; anyone else you ask where there's food. A gift is
// made before it's spoken of — "Here, have some" only if something changed hands.
function* hungerChain(w, A, B, c){
  const family = kin(A, B);
  yield M(A, B, family ? 'q-food-kin' : 'q-food', 'pot', { mark: 'q:food', ask: true });
  const gen = (B.persona && B.persona.generosity) || 1;
  if ((B.pack || 0) > (family ? 1 : 2) && (family ? gen >= 0.5 : gen >= 1.1) && w.giveFood(B, A) > 0){
    yield M(B, A, 'give-food', 'gift');                            // "Here, have some." (tossed)
    yield M(A, B, 'thanks-food', 'hello');
    return;
  }
  const tip = B.news && [...B.news.values()].filter(f => f.kind === 'food'
    && !((A.news && A.news.get(f.key)?.t) >= f.t)).sort((x, y) => y.t - x.t)[0];
  if (tip){
    yield M(B, A, 'tell-food', factIcon(tip), { fact: tip });
    yield M(A, B, 'ask-where', 'ask', { ask: true });
    yield M(B, A, 'where', 'place', { x: tip.x, z: tip.z });
    plan(w, A, 'food', { x: tip.x, z: tip.z, food: tip.foodKind, from: B, now: true });
    yield M(A, B, Math.hypot(tip.x - A.x, tip.z - A.z) < 12 ? 'grab' : 'go-now', 'food');
    if (c) c.closed = true;
    return;
  }
  yield M(B, A, family && householdShort(w, A) ? 'prov-low' : need(B, 'food') > 0.55 ? 'a-food-hungry' : 'a-food-no', 'pot');
}

// ---- a trade at a village door (agents.js callAt, js/trade.js, docs/trade.md) ----
// A of the folk asks B of the household for the crop A wants most. No deal: B
// says so, and what they'd take instead. A deal: A bids high, B counters low,
// they meet where trade.js strike put it, and the goods change hands on "Done."
// Whatever B says they're short of, A remembers (a plan to bring it).
function* haggleChain(c, A, B, h){
  const w = c.w, t = w.tradeTerms(A, B, h);
  if (!t.want){ yield M(B, A, 'tr-none', 'trade'); w.tradeDone(A, B, h, null, t); return; }
  yield M(A, B, 'tr-ask', 'trade', { ask: true, item: t.want });           // "Any onions to spare?"
  yield M(B, A, 'tr-what', 'trade', { ask: true });                        // "Some. What have you brought?"
  const d = t.deal;
  if (!d){
    yield M(A, B, 'tr-show', 'trade', { item: t.show });                   // "Acorns, mostly."
    yield M(B, A, 'tr-no', 'trade', { item: t.show, wish: t.wish, feel: true });   // "No use for acorns. Bring meat."
    w.tradeDone(A, B, h, null, t);
    return;
  }
  const deal = { give: d.give, gn: d.gn, get: d.get };
  yield M(A, B, 'tr-bid', 'trade', { ...deal, qn: t.bidQ, ask: true });   // "Three morels for six leeks?"
  if (t.bidQ !== d.qn){
    yield M(B, A, 'tr-counter', 'trade', { ...deal, qn: t.askQ });        // "Four."
    if (t.askQ !== d.qn) yield M(A, B, 'tr-meet', 'trade', { ...deal, qn: d.qn, ask: true });   // "Five, then?"
  }
  const ok = w.tradeDone(A, B, h, d, t);                                  // the hand-over (tossed)
  yield M(B, A, ok ? 'tr-done' : 'tr-off', 'trade', { ...deal, qn: d.qn, feel: ok });
  if (!ok) return;
  yield M(A, B, 'thanks', 'hello');
  if (t.wish && t.wish !== d.give) yield M(B, A, 'tr-wish', 'trade', { item: t.wish });   // "Bring meat next time."
}

// ---- shared plans ----------------------------------------------------------------
const busy = n => !!(n.project && n.project.status === 'on');   // in a live shared plan
const homeFire = (w, n) => { let f = null, d = 45; for (const g of w.fires){ const x = Math.hypot(g.x - n.x, g.z - n.z); if (g.done && x < d){ d = x; f = g; } } return f; };
// the household's food, carried and in their camp's basket, against its size
function householdShort(w, n){
  const folk = n.group && n.group.npcs ? n.group.npcs : [n];
  const f = homeFire(w, n);
  const food = folk.reduce((a, m) => a + (m.pack || 0), 0) + (f && f.foodStore ? f.foodStore : 0);
  return food < 1.5 * folk.length;
}
// could the two of them manage it? someone carries the base, or knows where it
// grows, or — for meat — is keen-eyed enough to hunt it
function feasible(w, A, B, dish){
  const r = RECIPES[dish];
  return r.base.some(k => carries(A, [k]) || carries(B, [k])
    || (k !== 'meat' && [A, B].some(n => n.news && [...n.news.values()].some(f => f.kind === 'food' && f.foodKind === k))));
  // (meat only once someone has a rabbit: hunting is too chancy to plan a supper on)
}
const itemWord = t => t.cook ? 'cooking' : t.item[0] === 'meat' ? 'rabbit' : t.item[0] === 'wood' ? 'poles' : t.item[0];

// A, craving a dish, puts it to kin: yes (by their own wanting, regard, tiredness)
// makes it a shared plan at A's fire — A cooks, B takes the part they're best for.
function* proposeChain(w, A, B, want, dish){
  const f = homeFire(w, A);
  if (!f) return;
  if (!A._said) A._said = new Map(); A._said.set('pp:' + dish, w.time);
  yield M(A, B, 'proj-propose', 'pot', { ask: true, dish });
  const yes = need(B, 'rest') < 0.7 && need(B, 'food') < 0.9 && (craving(B, dish, w.time) > 0.3 || regard(B, A) > 0.25);
  if (!yes || projectOf(w, A.group)){ yield M(B, A, 'proj-no', 'pot', { feel: true }); return; }
  const pr = new Project(w, 'dish', A, f, { dish, by: w.time + 0.4 }); w.projects.push(pr);
  dropPlan(A, want);                                                    // the craving's now a shared plan
  const cook = pr.tasks.find(t => t.cook), bt = pr.best(B);
  pr.take(A, cook);
  yield M(B, A, 'proj-yes', 'pot', { feel: true });
  if (bt){ pr.take(B, bt); yield M(B, A, 'proj-claim', 'food', { item: itemWord(bt) }); }
  yield M(A, B, 'proj-cook', 'pot', { dish });
  const base = pr.tasks.find(t => t.id === 'base');
  if (base.state === 'open') pr.take(A, base);                          // the base must be someone's: the proposer's, then
  else { const t2 = pr.best(A); if (t2 && carriesAny(A, t2.item)) pr.take(A, t2); }
}
const carriesAny = (n, items) => items.some(k => carries(n, [k]));

function* provisionChain(w, A, B){
  // the hearth now, as the caller checked it: after the first line A may have walked out of
  // homeFire's 45u, and a project with no fire crashed the planner (pl.fire.x)
  const f = homeFire(w, A);
  if (!f) return;
  if (!A._said) A._said = new Map(); A._said.set('q:provision', w.time);
  yield M(A, B, 'prov-low-ahead', 'pot', { ask: true });               // "We're getting low on food."
  const pr = new Project(w, 'provision', A, f, { by: w.time + 0.3 }); w.projects.push(pr);
  pr.take(A, pr.open[0]);
  A._said.set('pt:' + pr.id + ':' + B.id, w.time);                     // B's been told, whatever they say
  if (need(B, 'rest') < 0.7){ pr.take(B, pr.open[0]); yield M(B, A, 'prov-go', 'food', { feel: true }); }   // "We should gather. I'll go for apples."
  else yield M(B, A, 'prov-pass', 'sleepy');
}

// "Help me with the hut?" — a hut of ours stuck at the frame or the roof. Yes makes
// it a shared plan: poles and thatch brought to it, done when it stands.
function* hutChain2(w, A, B, h){
  for (const n of [A, B]){ if (!n._said) n._said = new Map(); n._said.set('ph:' + w.huts.indexOf(h), w.time); n._said.set('ph:*', w.time); }   // asked: hut talk settled for both a while
  yield M(A, B, h.frame < 1 ? 'hut-ask-poles' : 'hut-ask-thatch', 'hut', { ask: true });
  if (need(B, 'rest') > 0.85 || need(B, 'food') > 0.9 || regard(B, A) < -0.2){ yield M(B, A, 'hut-no', 'hut', { feel: true }); return; }   // only the worn out or starving refuse kin a hand with a roof
  const pr = new Project(w, 'hut', A, h, { by: w.time + 0.5 }); w.projects.push(pr);
  const want = h.frame < 1 ? 'wood' : 'thatch';
  const tb = pr.open.find(t => t.item[0] === want) || pr.open[0];
  pr.take(B, tb);
  yield M(B, A, 'proj-claim', 'hut', { item: itemWord(tb) });
  const ta = pr.open.find(t => t.item[0] === want); if (ta) pr.take(A, ta);
}

// "Will you help me with the canoe?" Yes puts it on their agenda (agents.js
// choose: bark, poles, a spell at the bed). Kin say yes unless worn out or
// starving; anyone else, if they like the one asking.
function* canoeChain(w, A, B, b){
  for (const n of [A, B]){ if (!n._said) n._said = new Map(); n._said.set('cn:*', w.time); }
  yield M(A, B, b.needs() === 'bark' ? 'cn-ask-bark' : b.needs() === 'ribs' ? 'cn-ask-poles' : 'cn-ask', 'wood', { ask: true });
  if (need(B, 'rest') > 0.8 || need(B, 'food') > 0.8 || regard(B, A) < (kin(A, B) ? -0.3 : 0.15)){ yield M(B, A, 'cn-no', 'wood', { feel: true }); return; }
  addPlan(B, { kind: 'canoe', build: b, until: w.time + 1.5 });
  yield M(B, A, 'cn-yes', 'wood');
}

// "Know of a canoe anywhere?" — the one they know of nearest the asker, said as
// news (so the asker remembers it, gossip.js knowCanoe), and where; or no.
function* canoeAskChain(w, A, B){
  yield M(A, B, 'q-canoe', 'ask', { mark: 'q:canoe', ask: true });
  let best = null, bd = Infinity;
  for (const [b, k] of B.canoes || []){
    if (A.canoes && A.canoes.has(b)) continue;
    const d = Math.hypot(k.x - A.x, k.z - A.z); if (d < bd){ bd = d; best = [b, k]; }
  }
  if (!best){ yield M(B, A, 'a-canoe-no', 'ask'); return; }
  const f = w.canoeFact(best[0], best[1].x, best[1].z, best[1].t, best[1].from);
  yield M(B, A, 'tell-boat', factIcon(f), { fact: f });
  yield M(B, A, 'where', 'place', { x: f.x, z: f.z });
  yield M(A, B, 'thanks', 'hello');
}

// telling someone of the household's plan; they may take a part in it
function* projectTellChain(w, A, B, pr){
  if (!A._said) A._said = new Map(); A._said.set('pt:' + pr.id + ':' + B.id, w.time);
  if (!B._said) B._said = new Map(); B._said.set('pa:' + pr.id, w.time);
  yield M(A, B, pr.kind === 'dish' ? 'proj-tell' : pr.kind === 'hut' ? 'proj-tell-hut' : 'proj-tell-prov', pr.kind === 'dish' ? 'pot' : pr.kind === 'hut' ? 'hut' : 'food', { dish: pr.dish });
  const t = pr.best(B);
  if (t && ((need(B, 'rest') < 0.7 && !busy(B) && regard(B, A) > -0.2) || pr.members.has(B))){
    pr.take(B, t);
    yield M(B, A, 'proj-claim', 'food', { item: itemWord(t) });
  } else yield M(B, A, 'proj-pass', 'pot');
}

// news owed about a shared plan: done, couldn't, or off
function* projectNewsChain(w, A, B, o, c){
  const heard = c ? c.members : [B];
  for (const m of heard) o.to.delete(m);
  if (!o.to.size) A.owes.splice(A.owes.indexOf(o), 1);
  const t = o.task, pr = o.project;
  const key = o.what === 'built' ? 'proj-built' : o.what === 'dropped' ? (pr.kind === 'hut' ? 'proj-dropped-hut' : 'proj-dropped') : o.what === 'failed' ? 'proj-failed'
    : t && t.cook ? 'proj-done-cook' : pr.kind === 'provision' ? 'proj-done-prov' : pr.kind === 'hut' ? 'proj-done-hut' : 'proj-done';
  yield M(A, B, key, o.what === 'done' ? 'gift' : 'pot', { item: t ? itemWord(t) : '', dish: pr.dish, feel: true });
  yield M(B, A, o.what === 'done' || o.what === 'built' ? 'proj-ack-good' : 'proj-ack-bad', 'hello', { feel: true });
}

function* rainChain(w, A, B){
  yield M(A, B, 'q-rain', 'cloud', { mark: 'q:rain', ask: true });
  const likely = w.cloud > 0.62;
  yield M(B, A, likely ? 'a-rain-yes' : 'a-rain-maybe', 'cloud');
  if (likely && !hasRoof(w, A)) yield M(A, B, 'rain-roof', 'hut');
}

function* doingChain(w, A, B){
  yield M(A, B, 'q-doing', 'ask', { mark: 'q:doing', ask: true });
  yield intentMove(w, B, A);
  if (INTENT[A.actionLabel] && A.actionLabel === B.actionLabel) yield M(A, B, 'me-too', INTENT[A.actionLabel]);
}
function* selfChain(w, A, B){
  yield intentMove(w, A, B);
  if (INTENT[B.actionLabel] && A.actionLabel === B.actionLabel) yield M(B, A, 'me-too', INTENT[B.actionLabel]);
}
function* craveChain(w, A, B, dish){
  yield M(A, B, 's-crave', 'pot', { mark: 's:crave' + dish, dish, feel: true });   // "I could do with some acorn porridge."
  if (craving(B, dish, w.time) > 0.5) yield M(B, A, 'crave-too', 'pot', { dish, feel: true });   // "So could I."
}
function* smallChain(w, A, B, st){
  yield M(A, B, 's-' + st, st, { mark: 's:' + st, feel: true });
  if (smallTopic(w, B) === st && st !== 'sun' && st !== 'omen') yield M(B, A, 'same', st);   // "Me too."
}

// ---- by the fire --------------------------------------------------------------

// the pot: ready? help yourself. Not yet: what is it, whose is it, how long.
// Whoever answers knows only what they can see — the cook, if they're in the talk,
// answers for their own pot.
function* potChain(w, A, B, f){
  const p = f.pot, cook = f.potCook(), dish = potDish(p);     // pinned: the pot can be emptied mid-talk
  if (cook === A){                                   // it's my pot: I tell you, you needn't ask
    if (p.ready > 0){ yield M(A, B, 'pot-offer', 'pot', { mark: 'q:pot', dish, feel: true }); return; }
    yield M(A, B, 'pot-mine', 'pot', { mark: 'q:pot', dish });
    yield M(B, A, 'q-pot-long', 'ask', { ask: true });
    yield M(A, B, 'a-pot-long', 'pot', { prog: f.pot.raw > 0 ? f.pot.cook / w.cookTime : 1 });
    return;
  }
  const ans = cook && cook !== A && dist(cook, A) < 6 && cook.convo === A.convo ? cook : B;
  if (p.ready > 0){
    yield M(A, ans, 'q-pot-ready', 'pot', { mark: 'q:pot', ask: true });
    yield M(ans, A, 'a-pot-help', 'pot', { feel: true });
    return;
  }
  yield M(A, ans, 'q-pot-what', 'pot', { mark: 'q:pot', ask: true });
  yield M(ans, A, 'a-pot-what', 'pot', { dish, cook });
  yield M(A, ans, 'q-pot-long', 'ask', { ask: true });
  yield M(ans, A, 'a-pot-long', 'pot', { left: f.pot.raw > 0 ? potLeft(f.pot, w.cookTime) : 0 });   // read when answered
  yield* cookingChain(w, A, ans, f);
}

// is there a cooking question A would ask about this pot now? (cookingChain's tests)
function cookingWanted(w, A, f){
  const p = f.pot, now = w.time;
  if (!RECIPES[p.recipe] || p.raw <= 0) return false;
  if (potNeeds(p).length && quiet(A, 'q:need' + p.recipe, now, ASK_GAP)) return true;
  if (potHelp(p) && need(A, 'rest') < 0.6 && quiet(A, 'q:help' + p.recipe, now, ASK_GAP)) return true;
  return stepsKnown(A, p.recipe, now) < RECIPES[p.recipe].steps.length && quiet(A, 'q:how' + p.recipe, now, ASK_GAP);
}

// Then the cooking itself, if there's anything for the asker in it: does the
// dish want anything (and have I got it, or know where it is — a real errand);
// can I help (a real hand at the work); how do you make it (and now I know).
function* cookingChain(w, A, cook, f){
  const p = f.pot;
  if (!RECIPES[p.recipe] || p.raw <= 0) return;
  const id = p.recipe, dish = potDish(p), now = w.time, len = RECIPES[id].steps.length;   // the dish, fixed now: the pot may be emptied mid-talk
  if (stepsKnown(cook, id, now) < len){       // they don't know the dish: send A to whoever's cooking it
    const owner = f.potCook();
    if (owner && owner !== cook && owner !== A && quiet(A, 'q:ask-cook' + id, now, ASK_GAP)){
      yield M(A, cook, 'q-help', 'ask', { ask: true, mark: 'q:ask-cook' + id });
      yield M(cook, A, 'ask-cook', 'pot', { subj: owner });
    }
    return;
  }
  const needs = potNeeds(p);
  if (needs.length && quiet(A, 'q:need' + id, now, ASK_GAP)){
    yield M(A, cook, 'q-pot-need', 'ask', { ask: true, mark: 'q:need' + id });
    const item = needs[0], step = RECIPES[id].steps.find(s => s.item === item);
    yield M(cook, A, 'a-pot-need', 'pot', { say: step.say });
    const have = carries(A, item);
    const tip = !have && A.news && [...A.news.values()].filter(x => x.kind === 'food' && item.includes(x.foodKind)).sort((x, y) => y.t - x.t)[0];
    if (have){ addPlan(A, { kind: 'bring', item, fire: f, until: now + 0.2 }); yield M(A, cook, 'have-it', 'food', { food: have }); }
    else if (tip){
      addPlan(A, { kind: 'bring', item, fire: f, x: tip.x, z: tip.z, until: now + 0.5 }); p.fetching = 60;
      yield M(A, cook, 'fetch-it', 'food', { food: tip.foodKind });
    } else yield M(A, cook, 'no-have', 'pot');
    return;
  }
  const work = potHelp(p);
  if (work && need(A, 'rest') < 0.6 && quiet(A, 'q:help' + id, now, ASK_GAP)){
    yield M(A, cook, 'q-help', 'ask', { ask: true, mark: 'q:help' + id });
    p.helpers.set(A, now + 0.06); addPlan(A, { kind: 'help', fire: f, until: now + 0.06 });
    yield M(cook, A, 'a-help', 'pot', { say: work.say, feel: true });
    yield M(A, cook, 'help-ok', 'hello');
    return;
  }
  if (stepsKnown(A, id, now) < len && quiet(A, 'q:how' + id, now, ASK_GAP)){
    yield M(A, cook, 'q-how', 'ask', { ask: true, mark: 'q:how' + id, dish });
    knowDish(A, id, now);
    yield M(cook, A, 'a-how', 'pot', { recipe: id });
    yield M(A, cook, 'lore-learnt', 'pot', { feel: true });
  }
}

// A book dish (taught by the player, recipes.js) spreads like a rumour: whoever learns
// one makes it now, and that's news ("Tam makes hazel porridge, from an old book"),
// passed on by gossip. Someone who's heard it, meeting the cook, asks to be shown.
export function knowDish(n, id, now){
  learnRecipe(n, id, now);
  if (RECIPES[id].book) addNews(n, { kind: 'dish', key: 'dish:' + id + ':' + n.id, recipe: id, subj: n, t: now });
}
const heardDish = (A, B, now) => A.news && [...A.news.values()].find(f => f.kind === 'dish' && f.subj === B
  && stepsKnown(A, f.recipe, now) < RECIPES[f.recipe].steps.length && stepsKnown(B, f.recipe, now) === RECIPES[f.recipe].steps.length
  && quiet(A, 'q:teach' + f.recipe, now, ASK_GAP));
function* teachChain(w, A, B, id){
  yield M(A, B, 'q-teach', 'ask', { ask: true, mark: 'q:teach' + id, dish: id });
  knowDish(A, id, w.time);
  yield M(B, A, 'a-how', 'pot', { recipe: id });
  yield M(A, B, 'lore-learnt', 'pot', { feel: true });
}

// the pot has stalled on a step nobody at the fire knows: whoever's there asks
// what comes next — and if the other knows, now they both do
function* stuckChain(w, A, B, f){
  const p = f.pot, step = potStep(p), id = p.recipe;
  if (!B._said) B._said = new Map(); B._said.set('q:pot', w.time);   // they've heard what's cooking now
  yield M(A, B, p.step ? 'q-stuck' : 'q-stuck-start', 'ask', { ask: true, mark: 'q:stuck' + p.step, dish: potDish(p) });
  if (B.convo && stepsKnown(B, id, w.time) > p.step){
    learnRecipe(A, id, w.time);
    yield M(B, A, 'a-stuck', 'pot', { say: step.say, feel: true });
    yield M(A, B, 'lore-thanks', 'pot');
  } else yield M(B, A, 'lore-dunno', 'ask');
}

// thanks for a meal: to the cook, or about them
const praiseKey = meal => 'c:' + meal.cook.id + ':' + meal.kind;
const markSaid = (n, key, now) => { if (!n._said) n._said = new Map(); n._said.set(key, now); };
function* praiseChain(w, A, B){
  const meal = A._ate;
  markSaid(A, praiseKey(meal), w.time);
  const good = (meal.q ?? 1) >= 0.6;               // a botched pot gets a different word
  if (B === meal.cook){
    yield M(A, B, good ? 'praise-cook' : 'meh-cook', 'pot', { dish: meal.kind, feel: true });
    if (good){ nudge(B, A, 0.03, 0.08); nudge(A, B, 0, 0.06); }
    yield M(B, A, good ? 'praise-thanks' : 'meh-reply', 'pot', { feel: true });
  } else {
    yield M(A, B, good ? 'praise-other' : 'meh-other', 'pot', { dish: meal.kind, subj: meal.cook, feel: true });
    if (good){ const d = RECIPES[meal.kind] ? meal.kind : Object.keys(RECIPES).find(id => RECIPES[id].base.includes(meal.kind)); if (d && !RECIPES[d].book) boostCraving(B, d, 0.35, w.time); }   // now they want some (not a book dish: nobody craves those)
    if (good) nudge(A, meal.cook, 0, 0.06);
    const same = B._ate && B._ate.cook === meal.cook && B._ate.kind === meal.kind && w.time - B._ate.t < 0.3;
    if (same) markSaid(B, praiseKey(meal), w.time);              // agreeing counts as saying it
    yield M(B, A, same ? 'praise-agree' : 'praise-try', 'pot', { feel: true });
  }
}

// night by the fire: the day's news told as a story, place and all
function* storyChain(w, T, L, f){
  yield M(T, L, 'story-' + f.kind, factIcon(f), { fact: f });
  yield M(L, T, 'story-react', 'hello', { feel: true });
}

// "Where shall we forage tomorrow?" — settled from a real tip, and kept: both
// get a plan that starts in the morning
function* tomorrowChain(w, A, B){
  yield M(A, B, 'q-tomorrow', 'ask', { mark: 'q:tomorrow', ask: true });
  const tip = B.news && [...B.news.values()].filter(f => f.kind === 'food' && Math.hypot(f.x - B.x, f.z - B.z) > 25)
    .sort((x, y) => y.t - x.t)[0];
  if (!tip){ yield M(B, A, 'a-tomorrow-none', 'ask'); return; }
  const day = w.time % 1, start = Math.floor(w.time) + (day > 0.5 ? 1 : 0) + 0.27;   // first light
  yield M(B, A, 'a-tomorrow', 'place', { fact: tip, x: tip.x, z: tip.z, food: tip.foodKind });
  const where = { x: tip.x, z: tip.z, food: tip.foodKind, start, until: start + 0.6 };
  addPlan(B, { kind: 'food', ...where, from: null }); addPlan(A, { kind: 'food', ...where, from: B });
  yield M(A, B, 'ok-tomorrow', 'food');
}

// at a gathering: "Give us a song." — whoever knows one sings, and anyone who
// knows the next part takes it up (sayingChain)
function singChain(c, A, B){
  const now = c.w.time;
  for (const singer of [B, ...c.members.filter(m => m !== B)]){
    const songs = SAYINGS.filter(s => s.kind === 'song' && !c.saidLore.has(s.id) && knowsStart(singer, s, now));
    if (!songs.length) continue;
    const song = songs[Math.floor(Math.random() * songs.length)];
    const listener = singer === A ? B : A;
    return (function* (){
      yield M(A, singer, 'q-sing', 'music', { mark: 'q:sing', ask: true });
      yield* sayingChain(c, singer, listener, song);
    })();
  }
  return null;
}

// for a remark to the player: what they're up to, or how they are, if not said lately
export function idleMove(w, n, to){
  const now = w.time;
  if (INTENT[n.actionLabel] && quiet(n, 'i:' + n.actionLabel, now, SAY_GAP)) return intentMove(w, n, to);
  const st = smallTopic(w, n);
  return quiet(n, 's:' + st, now, SAY_GAP) ? M(n, to, 's-' + st, st, { mark: 's:' + st }) : null;
}
