// music-sim.js — the folk and their tunes (docs/music.md, step 2). Pure sim, no sound:
// main.js listens in (instruments.js) on what this says is being played.
//
//   Knowing a tune: by phrases, from the start (tunes.js `phrases`). Everyone grows up with
//   some of the folk's own tunes (FOLK_TUNES), by a hash of their household as with heritage
//   recipes. One learnt holds whole for a while and then half of it, and then it's gone, on
//   each person's own memory (recipes.js memoryOf); tunes hold a little longer than recipes,
//   and playing one refreshes it.
//   An ear: a hash of who they are. A good ear takes a whole tune at a hearing; most pick up
//   a phrase each time they hear it; a few can't carry a tune by ear at all, and learn only
//   when someone sits down and teaches them, a phrase at a time. A simpler tune goes in faster
//   for all of them (easeOf, EASE): a fair ear has a simple one whole at a hearing.
//   Instruments: one each at most (n.instrument, an ingredients.js kind). Music runs in
//   families: in some camps most of the folk have their own, a pipe, a tabor, now and then a
//   fiddle, so a camp that plays sits down to play together; the rest are given or traded one
//   by the player. A drummer needs no tune: they keep the beat under whatever's played.
//   Several players make an ensemble, each with a part (arrange.js parts): the tune, a
//   counter-line under it, the tune an octave down, the drum.
//   A session (docs/music.md "Planned: rhythm first"): music at the fire starts with a rhythm in
//   one meter (rhythm.js LEA_PATTERNS), on the tabor, or clapped by whoever's sitting there
//   without an instrument if nobody has one. The drummer sets the tempo from the first tune, and
//   it winds down as the night gets late. The rhythm goes a few cycles alone, then the musicians
//   take turns: each starts a tune they know in that meter's family, at that tempo, its first bar
//   on a cycle's head, and whoever else knows it plays a part. The rhythm carries on between tunes.
//   They go round what they know (never the same tune twice running, if there's another) for a
//   handful of tunes, or until nobody has one in that meter; after a rest, the next may be in another.
//   A clapper who gets up hands the clapping to someone else sitting there.
//   A Gentry tune is played in the rests, with no rhythm, and now and then within a session.
//   A musician with nobody to keep a rhythm plays as before: below.
//   Playing: after dark at a lit fire, whoever sits there with an instrument plays, alone
//   or with others (whoever's coming to the fire with an instrument is waited for a while, and
//   whoever stands in earshot with one joins in); a full night gathering (agents.js Campfire.gathering) is rarer than an
//   evening by the fire, and too rare to wait for. They play a tune they share, the one they
//   know best between them, rest a while, and play another. Each plays as far as they know it and stops; whoever's in earshot
//   when it ends, sitting or passing, learns by ear what was played. Someone who comes to know a whole tune and has an
//   instrument to play it on is news (gossip kind 'tune').
//   Dancing: when a tune starts, whoever's sitting at the fire and isn't playing gets up and
//   dances to it (n.dance), and so does whoever sits down while it's going, till it ends:
//   up from their seat and round the fire in a ring, a step to
//   each beat, with a hop on it and a sway across two; by a hash of the tune, the ring goes one
//   way all through, turns back every four bars, or goes round while closing in to the fire and
//   opening out again. Each dancer's place is worked out from the tune's own clock (dancePose),
//   so the ring keeps together and in time. (Real historical figures, later: docs/music.md.)
//   Practice: knowing a tune isn't having it in the hands (fluencyOf). By day, someone who's
//   diligent goes off to a place of their own (agents.js practiceSpot), out of everyone's
//   earshot, and drills their weakest tune a phrase at a time, slow, faltering, over and over
//   (stepPractice, arrange.js roughen); main.js sounds it. What it buys you hear at the fire.

import { TUNE_IDS, FOLK_TUNES, tune, schedule, phraseSchedule } from './tunes.js';
import { DRUMS, parts, partNotes, liftFor, roughen } from './arrange.js';
import { firstPlan, dropPlan } from './plans.js';
import { memoryOf } from './recipes.js';
import { addNews } from './gossip.js';
import { craftsOf } from './making.js';
import { leaPattern, familyOf, gridOf, cycleSec, tuneBeatSec, shape } from './rhythm.js';

const TUNE_HALF = 3, TUNE_GONE = 8;   // days a learnt tune holds whole, then half (× memoryOf)
const BORN = 0.45, BORN_ELDER = 0.75; // the chance of growing up with each of the folk's own tunes
const GOOD_EAR = 0.2, NO_EAR = 0.25;  // shares of the folk with a good ear, and with none
const MUSICAL = 0.4, OWN = 0.7;       // the share of camps that play, and of a playing camp's folk with an instrument…
const OWN_KINDS = [[0.45, 'tabor pipe'], [0.8, 'tabor'], [1, 'vielle']];   // …and which (cumulative shares)
const REST = [20, 60];                // seconds between tunes at a gathering
const SEAT = 2;                       // how far out from the ring counts as sitting at it
const EARSHOT = 18;                   // how near you must be to learn a tune by ear (u)
const DARK = 0.35;                    // how dark it must be to play (agents.js NIGHT_GATHER)
const WAIT = 45;                      // how long the first to sit will wait for others coming with instruments (s)
const LEAD_IN = [2, 3], BETWEEN = [1, 2];   // a session's cycles of rhythm alone before the first tune, and between tunes
const RHYTHM_ONLY = 8;                // cycles a rhythm with no tune over it goes on for
const SESSION_TUNES = [4, 8];         // how many tunes a session goes on for, round and round what they know
const CLAPPERS = 4;                   // most who clap at a fire
const TEMPO_BAND = 0.25;              // how far a tune's own tempo may be from the session's
const GENTRY_BEAT = 0.35;             // the share of sessions that take a Gentry tune too (they sound good with a beat)
const WIND = 0.18;                    // how much slower the rhythm is by the small hours
const DANCE_OUT = 1.4, DANCE_STEP = 0.55, DANCE_MAX = 14, DANCE_IN = 2;   // the ring's way out past the seats (u); a step a beat (u); most dancers at a fire; seconds to get up into the ring

const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
const isElder = n => n.role === 'elder' || n.role === 'mother' || n.role === 'father';
export const phraseCount = id => tune(id).phrases.length;
// How hard a tune is to pick up: the notes in its phrases (a phrase played again isn't new),
// weighted by how many pitches it moves among. A simple tune (a nursery tune, a short dance)
// goes in faster than a long one in parts: EASE, how many phrases each hearing or
// lesson gives a fair ear, and a tin ear (which learns nothing by ear unless a tune is simple)
const EASE = { simple: { ear: 99, none: 1, teach: 99, teachNone: 2 },
               middling: { ear: 2, none: 0, teach: 3, teachNone: 1 },
               hard: { ear: 1, none: 0, teach: 2, teachNone: 1 } };
const EASES = new Map();
export function tuneWeight(id){
  const P = tune(id), notes = P.phrases.reduce((a, p) => a + p.notes.filter(n => n.midi != null).length, 0);
  return notes * new Set(schedule(id).notes.map(n => n.midi)).size / 7;
}
export function easeOf(id){
  if (!EASES.has(id)){
    const e = tuneWeight(id);
    EASES.set(id, e <= 40 ? 'simple' : e <= 100 ? 'middling' : 'hard');
  }
  return EASES.get(id);
}

// ---- knowing a tune ----------------------------------------------------------------
function tunebook(n){
  if (n.tunes) return n.tunes;
  n.tunes = new Map();
  const home = n.group ? 'g' + n.group.id : 'n' + n.id;
  for (const id of FOLK_TUNES) if (hash01(home, 't:' + id) < (isElder(n) ? BORN_ELDER : BORN)) n.tunes.set(id, { heritage: true });
  return n.tunes;
}
export function earOf(n){
  const h = hash01('n' + n.id + '|' + (n.name || ''), 'ear');
  return h < GOOD_EAR ? 'good' : h > 1 - NO_EAR ? 'none' : 'fair';
}
// how many of the tune's phrases n knows, from the start (0: doesn't know it)
export function phrasesKnown(n, id, now){
  const e = tunebook(n).get(id);
  if (!e) return 0;
  if (e.heritage) return phraseCount(id);
  const age = now - e.t, m = memoryOf(n);
  return age < TUNE_HALF * m ? e.k : age < TUNE_GONE * m ? Math.ceil(e.k / 2) : 0;
}
export const knowsTune = (n, id, now) => phrasesKnown(n, id, now) >= phraseCount(id);
export const knownSet = k => new Set(Array.from({ length: k }, (_, i) => i));
// the tunes n knows any of, best known first
export const tunesOf = (n, now) => TUNE_IDS.map(id => [id, phrasesKnown(n, id, now)]).filter(([, k]) => k > 0).sort((a, b) => b[1] / phraseCount(b[0]) - a[1] / phraseCount(a[0])).map(([id]) => id);

// n comes to know up to `k` phrases of it (never fewer than they hold now); fresh, so it
// holds from now. A whole tune newly known, by someone with an instrument, is news.
export function learnTune(n, id, now, k){
  const book = tunebook(n), e = book.get(id);
  if (e && e.heritage) return phraseCount(id);
  const had = phrasesKnown(n, id, now), got = Math.min(phraseCount(id), Math.max(had, k));
  book.set(id, { t: now, k: got });
  if (got === phraseCount(id) && had < got && instrumentOf(n)) addNews(n, { kind: 'tune', key: 'tune:' + id + ':' + n.id, tune: id, subj: n, t: now });
  return got;
}
// the player sits down and plays it to them, phrase by phrase: a good ear has it all, a fair
// one a few phrases more (a simple tune all of it), someone with no ear one or two (main.js talk)
export function teachTune(n, id, now){
  const had = phrasesKnown(n, id, now), ear = earOf(n), E = EASE[easeOf(id)];
  return { had, got: learnTune(n, id, now, ear === 'good' ? phraseCount(id) : had + (ear === 'fair' ? E.teach : E.teachNone)), ear };
}

// someone arrives already knowing a tune, and has it in their hands: no news, they've always had it
export function bringTune(n, id, now, hands = 0.85){
  tunebook(n).set(id, { t: now, k: phraseCount(id) });
  (n.hands ??= new Map()).set(id, { f: hands, t: now });
}

export const isHeritage = (n, id) => !!tunebook(n).get(id)?.heritage;

// ---- the hands, and practice ---------------------------------------------------------
// How well n's hands have a tune, 0..1: apart from how much of it they know. A tune grown up
// with starts well; one just learnt starts middling, and nobody plays worse than that. Drilling and playing raise it, and it slips
// slowly in the idle days, so it's kept up, not finished with.
const HAND_BORN = [0.6, 1], HAND_NEW = 0.5, HAND_NEW_GOOD = 0.55, HAND_FLOOR = 0.5, HAND_SLIP = 0.04;   // a day's slip
const HAND_PLAYED = 0.02;                                     // what playing a tune through at a fire gives
const GO_GAIN = { simple: 0.06, middling: 0.03, hard: 0.015 };  // what one go at it gives (× ear)
const EAR_GAIN = { good: 1.3, fair: 1, none: 0.6 };
const AIM = 0.92, LAZY = 0.2, RUN = 0.7;                      // good enough to leave be; below this diligence, not unless told; past this, whole run-throughs too
const SESSION = [80, 140], GAP = [1.5, 4], REPS = 3;          // seconds' practice; between goes; goes at a phrase before the next
const SLOW = 0.62;                                            // how slowly the clumsiest drill it, of full speed
export const ROUGH = 0.65;                                    // below this, they know it isn't right
const whoOf = n => 'n' + n.id + '|' + (n.name || '');
export function fluencyOf(n, id, now){
  const h = n.hands?.get(id);
  if (h) return Math.max(HAND_FLOOR, h.f - HAND_SLIP * (now - h.t));
  return isHeritage(n, id) ? HAND_BORN[0] + (HAND_BORN[1] - HAND_BORN[0]) * hash01(whoOf(n), 'hand:' + id) : earOf(n) === 'good' ? HAND_NEW_GOOD : HAND_NEW;
}
export function drilled(n, id, now, gain){
  (n.hands ??= new Map()).set(id, { f: Math.min(1, fluencyOf(n, id, now) + gain), t: now });
}
export const diligence = n => hash01(whoOf(n), 'diligent');
// is n minded to practise, and what? { id, pull }, or null. A session under way carries on; a
// plan to (told to, or a new tune they mean to get) comes first; else their weakest tune, if
// it's weak enough and they're the sort who bothers.
export function practiceWant(n, now){
  const kind = instrumentOf(n);
  if (!kind || DRUMS.has(kind)) return null;
  if (n.practice) return { id: n.practice.id, pull: 1 };
  const told = firstPlan(n, 'practice');
  if (told && told.until >= now && phrasesKnown(n, told.tune, now)) return { id: told.tune, pull: 1.5 };
  const d = diligence(n);
  if (d < LAZY) return null;
  let id = null, low = AIM;
  for (const t of tunesOf(n, now)){ const f = fluencyOf(n, t, now); if (f < low){ low = f; id = t; } }
  return id && { id, pull: d * (0.8 + AIM - low) };
}
// one go at it: a phrase, slow, or (once it's coming) now and then the whole of what they know
function newGo(n, S, now){
  const f = fluencyOf(n, S.id, now), k = phrasesKnown(n, S.id, now);
  if (!k) return null;
  const whole = f >= RUN && S.goes % (REPS + 1) === REPS;
  const base = whole ? schedule(S.id, knownSet(k)) : phraseSchedule(S.id, Math.floor(S.goes / REPS) % k);
  const up = liftFor(schedule(S.id).notes, S.kind), speed = whole ? 1 : SLOW + (1 - SLOW) * f;
  const s = roughen({ notes: base.notes.map(x => ({ ...x, t: x.t / speed, dur: x.dur / speed, midi: x.midi + up })), length: base.length / speed },
    f, whoOf(n) + S.id + S.goes + Math.floor(now * 600), { solo: true });
  return { kind: S.kind, notes: s.notes, length: s.length, left: s.length };
}
// the whole of what n knows of a tune, at speed, as well as they can: { kind, id, notes, length, left }, sounded by main.js
// as a go at practice is (a shepherd on their pipe, js/shepherd.js). Playing it keeps it
export function playThrough(n, id, now, { solo = true } = {}){
  const k = phrasesKnown(n, id, now), kind = instrumentOf(n);
  if (!k || !kind) return null;
  const base = schedule(id, knownSet(k)), up = liftFor(schedule(id).notes, kind);
  const s = roughen({ notes: base.notes.map(x => ({ ...x, midi: x.midi + up })), length: base.length }, fluencyOf(n, id, now), whoOf(n) + id + Math.floor(now * 600), { solo });
  learnTune(n, id, now, k); drilled(n, id, now, HAND_PLAYED);
  return { kind, id, k, notes: s.notes, length: s.length, left: s.length };
}
// a whole tune played out of doors (a shepherd's, a trader's at a well, a practice with company): whoever's
// free in earshot may join in (joinIn); with company, the player doesn't falter, or they'd lose each other.
// `still()`: is that go still the one sounding
export function playOut(n, id, now, still, w = world){
  const js = w ? joinersFor(n, id, w) : [];
  const go = playThrough(n, id, now, { solo: !js.length });
  if (go && js.length) joinIn(n, go, id, w, js, still);
  return go;
}
// ---- joining in, outside (docs/music.md "Planned: rhythm first", decisions 5 and 6) ----------------
// Someone plays a whole tune outside: the shepherd to the flock, a trader at a well, someone at their
// practice, you. Whoever's within earshot, free (fed, warm, awake, not busy with music of their own) and
// has an instrument may stop and play along from the start: a part of it if they know some of it
// (arrange.js parts, as at a fire), the Lea's pattern for its meter if theirs is a drum. They stand and
// play that one, perhaps the next, and go on their way. n.joining: { host, id, go, still }; the Brain
// (agents.js) gives up their feet while it lasts, and main.js sounds `go` as it does a practice.
const JOIN_HUNGER = 0.6, JOIN_REST = 0.15, JOIN_MOST = 3;   // too hungry or cold to stop; days before joining again; most at once
let world = null;                                       // the world last stepped (the shepherd's round hasn't one of its own)
export const joiningNow = n => { const J = n.joining; if (!J) return null; if (!J.still() || J.go.left <= 0){ n.joining = null; return null; } return J; };
export function joinersFor(host, id, w = world){
  if (!w || !id) return [];
  const out = [];
  for (const n of w.npcs){
    if (n === host || out.length >= JOIN_MOST || !instrumentOf(n) || Math.hypot(n.x - host.x, n.z - host.z) > EARSHOT) continue;
    if (n.sleeping || n._indoors || n.sheltered || n.talking || n.dance || n.practice || n.piping?.go || n.shepherding || joiningNow(n)) continue;
    if ((n._joinRest ?? -1) > w.time || (n.needs?.food ?? 0) > JOIN_HUNGER || (n.needs?.warmth ?? 0) > JOIN_HUNGER) continue;
    if (!DRUMS.has(n.instrument) && !phrasesKnown(n, id, w.time)) continue;
    out.push(n);
  }
  return out;
}
export function joinIn(host, go, id, w, js, still){
  const ps = [{ kind: go.kind }, ...js.map(n => ({ kind: n.instrument }))], as = parts(ps, id), hostK = go.k ?? phraseCount(id);
  const st = w.musicStats ??= { played: 0, learnt: 0, tunes: {} };
  js.forEach((n, i) => {
    const part = as[i + 1], drum = DRUMS.has(n.instrument), k = drum ? hostK : Math.min(hostK, phrasesKnown(n, id, w.time));
    let s = partNotes(id, part, drum ? null : knownSet(k), n.instrument);
    if (drum) s = { notes: s.notes.filter(x => x.t < go.length), length: go.length };
    else { s = roughen(s, fluencyOf(n, id, w.time), whoOf(n) + id + part); learnTune(n, id, w.time, k); drilled(n, id, w.time, HAND_PLAYED); }
    const at = () => go.length - go.left;
    n.joining = { host, id, part, go: { kind: n.instrument, notes: s.notes, length: s.length, get left(){ return s.length - at(); } }, still };
    n._joins = n._joinedHost === host ? (n._joins || 0) + 1 : 1; n._joinedHost = host;
    if (n._joins >= 1 + Math.floor(hash01(whoOf(n), 'joins') * 2)) n._joinRest = w.time + JOIN_REST;   // that one, perhaps the next
    st.joined = (st.joined || 0) + 1;
    st.joinedBy ??= {}; st.joinedBy[part] = (st.joinedBy[part] || 0) + 1;
  });
}
// ---- playing on the road ----------------------------------------------------------------
// A trader plays as they walk (docs/economy.md): a tune, a while's quiet, another. Sounded by main.js as a shepherd's pipe is
// (n.piping). A tune broken off teaches nobody; one played out teaches whoever's in earshot where it ends.
//   on    free to play: walking, nobody to talk to      dt  seconds since last asked      roll()  0..1, the caller's own stream
//   gap   [least, most] seconds between tunes (a musician's set at a well goes quicker)
// Returns { id, k, f, learnt } when a tune's just been played out, so whoever's paying can pay.
export const ROAD_GAP = [30, 100], SET_GAP = [6, 16];
const roadGap = (roll, g = ROAD_GAP) => g[0] + roll() * (g[1] - g[0]);
export function roadTune(n, w, on, dt, roll, gap = ROAD_GAP){
  const P = n.piping ??= { go: null, id: null, last: null, gap: roadGap(roll, gap) };
  if (!on){ P.go = null; return; }
  const st = w.musicStats ??= { played: 0, learnt: 0, tunes: {} }, R = st.road ??= { played: 0, finished: 0, learnt: 0 };
  if (P.go){
    P.go.left -= dt;
    if (P.go.left > 0) return;
    R.finished++;
    const k = phrasesKnown(n, P.id, w.time), learnt = heardAt(n.x, n.z, w, P.id, k);
    R.learnt += learnt;
    P.go = null; P.gap = roadGap(roll, gap);
    return { id: P.id, k, f: fluencyOf(n, P.id, w.time), learnt };
  }
  P.gap = Math.min(P.gap, gap[1]);                 // (come from the road to a set, the next one's sooner)
  if ((P.gap -= dt) > 0) return;
  const known = tunesOf(n, w.time), choice = known.length > 1 ? known.filter(id => id !== P.last) : known;
  if (!choice.length || !instrumentOf(n) || DRUMS.has(n.instrument)){ P.gap = gap[1]; return; }
  P.id = P.last = choice[Math.floor(roll() * choice.length)];
  world = w;
  const go = P.go = n.moving ? playThrough(n, P.id, w.time) : playOut(n, P.id, w.time, () => n.piping?.go === go, w);   // walking, nobody stops to join
  R.played++;
}

// a moment's practice, from the Brain, at the spot. True when the session's over.
export function stepPractice(n, w, dt, id){
  const now = w.time, st = w.musicStats ??= { played: 0, learnt: 0, tunes: {} }, P = st.practice ??= { sessions: 0, goes: 0, alone: 0, gained: 0 };
  let S = n.practice;
  if (!S){ S = n.practice = { id, kind: n.instrument, left: SESSION[0] + Math.random() * (SESSION[1] - SESSION[0]), gap: 1, goes: 0, go: null }; P.sessions++; }
  S.seen = now; S.left -= dt;
  if (S.go){
    S.go.left -= dt;
    if (S.go.left <= 0){
      const gain = GO_GAIN[easeOf(S.id)] * EAR_GAIN[earOf(n)];
      drilled(n, S.id, now, gain); P.gained += gain;
      const kn = phrasesKnown(n, S.id, now); if (kn) learnTune(n, S.id, now, kn);   // drilling it keeps it, as playing does
      S.go = null; S.goes++; S.gap = GAP[0] + Math.random() * (GAP[1] - GAP[0]);
    }
  } else if ((S.gap -= dt) <= 0 && S.left > 0){
    // company: they stop drilling and play it through at speed, with whoever's joined (decision 6)
    world = w;
    const company = phrasesKnown(n, S.id, now) && joinersFor(n, S.id, w).length;
    if (company){ const go = S.go = playOut(n, S.id, now, () => n.practice?.go === go, w); if (go) P.company = (P.company || 0) + 1; }
    else S.go = newGo(n, S, now);
    if (!S.go) S.left = 0;
    else {
      P.goes++;
      if (!(w.near?.(n.x, n.z, EARSHOT) ?? []).some(o => o !== n && !o._indoors)) P.alone++;
      if ((w.fires || []).some(f => Math.hypot(f.x - n.x, f.z - n.z) < EARSHOT)) P.byFire = (P.byFire || 0) + 1;
    }
  }
  if (S.left > 0 || S.go) return false;
  n.practice = null; n._practiceRest = now + 0.5 + 0.8 * (1 - diligence(n));
  const told = firstPlan(n, 'practice'); if (told?.tune === S.id) dropPlan(n, told);
  return true;
}
// the go sounding now, if any: stale once the Brain's stopped coming back to it (talk, hunger)
export const practiceGo = (n, now) => { const S = n.practice; return S?.go && now - S.seen < 2 / 600 ? S.go : null; };

// answers to what you say about their playing (play-talk.js): 'admit' a rough player of
// anything but a child's tune knows it; otherwise they take it badly and answer back
export const keepAtReply = (n, id, now) => easeOf(id) !== 'simple' && (fluencyOf(n, id, now) < ROUGH || phrasesKnown(n, id, now) < phraseCount(id)) ? 'admit' : 'retort';
// the song you offered them instead: one they know whole; heavier than theirs; or not
export const songVerdict = (n, played, offered, now) => knowsTune(n, offered, now) ? 'knows' : tuneWeight(offered) > tuneWeight(played) ? 'better' : 'nobetter';

// ---- instruments -----------------------------------------------------------------
// does n's camp play? (a hash of the household: music runs in families)
export const musicalCamp = n => { const who = 'n' + n.id + '|' + (n.name || ''); return !n.home && hash01(n.group ? 'g' + n.group.id : who, 'musical') < MUSICAL; };
export function instrumentOf(n){
  if (n.instrument === undefined){
    const who = 'n' + n.id + '|' + (n.name || '');
    n.instrument = musicalCamp(n) && hash01(who, 'own') < OWN ? OWN_KINDS.find(([c]) => hash01(who, 'which') < c)[1] : null;
  }
  return n.instrument;
}
// the crafts n knows (making.js craftsOf), a camp that plays more often making its own
export const craftsKnown = n => craftsOf(n, musicalCamp(n));
export const giveInstrument = (n, kind) => { n.instrument = kind; };

// ---- playing at a gathering --------------------------------------------------------
// f.music: { rest } between tunes, or { tune, players: [{ npc, kind, k, part, len }], length, left }
// while one's played (seconds). main.js reads it to sound it.
// A tune starts after dark at a lit fire with a player sitting at it, and goes on while the
// fire burns and any of its players is still sitting there (the dark can come and go under it).
export function stepMusic(f, w, dt){
  world = w;
  const M = f.music ??= { rest: REST[0] * Math.random() };
  if (M.session){ stepSession(f, w, dt, M); return; }
  if (M.tune){
    const seated = sittingAt(f, w);
    if (!f.lit || !M.players.some(p => seated.includes(p.npc))){ sitDown(M); f.music = { rest: REST[1], last: M.tune }; return; }
    M.left -= dt;
    joinDance(f, w, M);
    if (M.left <= 0){ heard(f, w, M); sitDown(M); f.music = { rest: REST[0] + Math.random() * (REST[1] - REST[0]), last: M.tune }; }
    return;
  }
  M.rest -= dt;
  if (M.rest > 0 || !f.lit || w.night <= DARK) return;
  const near = w.npcs.filter(n => instrumentOf(n) && !n.sleeping && !n.sheltered && Math.hypot(n.x - f.x, n.z - f.z) < EARSHOT);
  if (!near.some(n => n.sitting)) return;
  // someone on their way here with an instrument: wait for them a while
  if ((M.waited ?? 0) < WAIT && w.npcs.some(n => instrumentOf(n) && !near.includes(n) && n.brain?.target?.ref === f)){ M.waited = (M.waited ?? 0) + 3; M.rest = 3; return; }
  M.waited = 0;
  const players = near;
  const drummers = players.filter(n => DRUMS.has(n.instrument)), tuneful = players.filter(n => !DRUMS.has(n.instrument));
  // somebody to keep a rhythm: a drummer, or else hands. Then it's a session, unless this rest is
  // for a quiet Gentry tune and somebody knows one
  const clappers = drummers.length ? [] : sittingAt(f, w).filter(n => !instrumentOf(n) && !n.sleeping && !n.talking).slice(0, CLAPPERS);
  const quiet = M.quiet && tuneful.some(n => tunesOf(n, w.time).some(id => tune(id).style === 'gentry'));
  if ((drummers.length || clappers.length) && !quiet){ startSession(f, w, M, drummers, clappers, tuneful); return; }
  const gentryOnly = !!quiet;
  // the tune they know best between them (not the one just played, if there's another): the
  // pipers and fiddlers choose; drummers only if there's nobody else
  const choosers = tuneful.length ? tuneful : drummers;
  let best = null;
  for (const id of TUNE_IDS){
    if (gentryOnly && tune(id).style !== 'gentry') continue;
    const ks = choosers.map(n => phrasesKnown(n, id, w.time)), sum = ks.reduce((a, k) => a + k, 0);
    if (!sum) continue;
    const score = sum / phraseCount(id) - (id === M.last ? 1.5 : 0);   // and not the same one twice running, if they've another
    if (!best || score > best.score) best = { id, ks, score };
  }
  if (!best){ M.rest = REST[1]; return; }
  const lead = Math.max(...best.ks);
  const ps = choosers.map((n, i) => ({ npc: n, kind: n.instrument, k: best.ks[i], f: DRUMS.has(n.instrument) ? null : fluencyOf(n, best.id, w.time) })).filter(p => p.k > 0);
  for (const p of ps){ learnTune(p.npc, best.id, w.time, p.k); if (p.f != null) drilled(p.npc, best.id, w.time, HAND_PLAYED); }   // playing it keeps it
  if (tuneful.length) for (const n of drummers) ps.push({ npc: n, kind: n.instrument, k: lead });   // the drum goes along
  parts(ps, best.id).forEach((part, i) => { ps[i].part = part; });
  // how long each plays: as far as they know it (a drum, the whole way under the others)
  for (const p of ps) p.len = schedule(best.id, knownSet(p.k)).length;
  const length = Math.max(...ps.map(p => p.len));
  f.music = { tune: best.id, players: ps, length, left: length, last: M.last };
  (w.musicStats ??= { played: 0, learnt: 0, tunes: {} }).played++;
  w.musicStats.tunes[best.id] = (w.musicStats.tunes[best.id] || 0) + 1;
  w.musicStats.parts ??= {};
  for (const p of ps) w.musicStats.parts[p.part] = (w.musicStats.parts[p.part] || 0) + 1;
  if (ps.length > 1) w.musicStats.bands = (w.musicStats.bands || 0) + 1;
  f.music.dancers = [];
  joinDance(f, w, f.music);                                   // and the rest of the ring gets up to dance
}
const sitDown = M => { for (const n of M.dancers || []) if (n.dance?.M === M) n.dance = null; };

// ---- dancing -------------------------------------------------------------------------
// where a dancer is now, from the tune's clock: { x, z, heading, hop (0..1, up on each beat),
// sway (-1..1, across two beats) }, or null if the tune they were dancing to is over
// whoever's sitting at the fire, awake, and not playing, gets up (from where they sit: d.a,
// the angle of their seat, and d.t0, when)
function joinDance(f, w, M){
  if (M.dancers.length >= DANCE_MAX) return;
  const at = clockOf(M);
  for (const n of sittingAt(f, w)){
    if (n.dance?.M === M || n.sleeping || n.talking || M.players.some(p => p.npc === n) || M.rhythm?.some(r => r.npc === n) || M.dancers.length >= DANCE_MAX) continue;
    n.dance = { M, f, a: Math.atan2(n.z - f.z, n.x - f.x), r0: Math.hypot(n.x - f.x, n.z - f.z), t0: at };
    M.dancers.push(n);
    w.musicStats.danced = (w.musicStats.danced || 0) + 1;
  }
}
const DANCES = ['ring', 'turn', 'in-out'];
export function dancePose(n){
  const d = n.dance, M = d?.M;
  if (!M || d.f.music !== M){ if (d) n.dance = null; return null; }
  // in a session, the rhythm's beat and bar, and a figure for the session; else the tune's
  let beat, bar;
  if (M.session){ beat = 60 / M.bpm; bar = beat * M.G.bar / M.G.base; }
  else {
    const T = tune(M.tune), crotchet = 60 / T.bpm, compound = T.meter[1] === 8 && T.meter[0] % 3 === 0;
    beat = compound ? crotchet * 1.5 : crotchet * 4 / T.meter[1]; bar = T.meter[0] / T.meter[1] * 4 * crotchet;
  }
  const key = M.session ? M.key : M.tune;
  const kind = DANCES[Math.floor(hash01(key, 'dance') * DANCES.length)], dir = hash01(key, 'dir') < 0.5 ? -1 : 1;
  const R = d.f.ringR + DANCE_OUT, P = 4 * bar;
  // how far round, in seconds' going: on all through; back and forth every four bars; or slower, round while closing in and opening out
  const round = at => { const ph = at % (2 * P); return kind === 'turn' ? (ph < P ? ph : 2 * P - ph) : kind === 'in-out' ? at * 0.6 : at; };
  const place = at => {
    const b = Math.min(1, (at - d.t0) / DANCE_IN);                     // getting up from the seat into the ring
    const ring = kind === 'in-out' ? R + 0.6 - 0.9 * (0.5 - 0.5 * Math.cos(2 * Math.PI * at / P)) : R;
    const r = d.r0 + (ring - d.r0) * Math.max(0, b), a = d.a + dir * (round(at) - round(d.t0)) * DANCE_STEP / beat / R;
    return [d.f.x + Math.cos(a) * r, d.f.z + Math.sin(a) * r];
  };
  const at = Math.max(d.t0, clockOf(M)), [x, z] = place(at), [x2, z2] = place(at + 0.1);
  const fb = beat > 0 ? (at / beat) % 1 : 0;
  return { x, z, heading: Math.atan2(x2 - x, z2 - z), moving: Math.hypot(x2 - x, z2 - z) > 1e-3, hop: Math.sin(Math.PI * fb), sway: Math.sin(Math.PI * at / beat) };
}

const sittingAt = (f, w) => w.npcs.filter(n => n.sitting && Math.hypot(n.x - f.x, n.z - f.z) < f.ringR + SEAT);
// at the end of a tune, everyone in earshot may learn by ear what was played: a good ear all
// of it, a fair one the next phrase or so (a simple tune all of it), none nothing (or, of a
// simple tune, a phrase)
function heard(f, w, M){ heardAt(f.x, f.z, w, M.tune, Math.max(...M.players.map(p => p.k))); }
// how many of the folk picked some of it up
function heardAt(x, z, w, id, most){
  const E = EASE[easeOf(id)];
  let got = 0;
  for (const n of w.npcs){
    if (Math.hypot(n.x - x, n.z - z) > EARSHOT || n._indoors || n.sleeping) continue;
    const ear = earOf(n), had = phrasesKnown(n, id, w.time), gain = ear === 'good' ? most : ear === 'fair' ? E.ear : E.none;
    if (!gain || had >= most) continue;
    learnTune(n, id, w.time, Math.min(most, had + gain));
    w.musicStats.learnt++; got++;
  }
  return got;
}

// ---- a session: rhythm first ------------------------------------------------------------
// f.music while a session's on: { session, pat, G, bpm, cyc (a cycle, s), t (s since it began; 0 a cycle's
// head), rhythm: [{ npc, kind: 'tabor'|'clap', row }], tune (the one playing now, or null), start (when on
// the session's clock its notes' 0 falls: its pick-up before a cycle's head), scale (its seconds → the
// session's), players, length, left, next (the cycle head the next tune comes in on), turn, played, dancers }
// The clock a dancer keeps: a session's own, or a lone tune's
const clockOf = M => M.session ? M.t : Math.max(0, M.length - M.left);
// how late in the night it is, 0 at dusk to 1 in the small hours (w.time: days, 0 midnight)
const lateness = w => Math.max(0, Math.min(1, (((w.time ?? 0) % 1) - 0.75 + 1) % 1 / 0.4));
// the tempo the drummer sets (beats a minute): the first tune's own, wound down by the hour, and a
// little by who they are (or, clapping, by whoever started it)
export const sessionTempo = (id, w, who) => 60 / tuneBeatSec(id) * (1 - WIND * lateness(w)) * (0.96 + 0.08 * hash01(whoOf(who), 'tempo'));
// may tune id be played in this session? Its meter in the family, its own tempo near the session's
const fitsSession = (M, id) => familyOf(tune(id).meter) === M.family && Math.abs(60 / tuneBeatSec(id) / M.bpm0 - 1) <= TEMPO_BAND && (tune(id).style !== 'gentry' || M.gentry);
// the musicians round the fire who might start a tune or play one: tuneful, awake, in earshot
const tunefulNear = (f, w) => w.npcs.filter(n => instrumentOf(n) && !DRUMS.has(n.instrument) && !n.sleeping && !n.sheltered && Math.hypot(n.x - f.x, n.z - f.z) < EARSHOT);

function startSession(f, w, M, drummers, clappers, tuneful){
  const gentry = Math.random() < GENTRY_BEAT;
  // the first tune: the one they know best between them, preferring a family they've more in, and
  // not the last session's family if there's another
  let best = null;
  for (const id of TUNE_IDS){
    if (tune(id).style === 'gentry' && !gentry) continue;
    const ks = tuneful.map(n => phrasesKnown(n, id, w.time)), sum = ks.reduce((a, k) => a + k, 0);
    if (!sum) continue;
    const fam = familyOf(tune(id).meter);
    const score = sum / phraseCount(id) + 0.1 * TUNE_IDS.filter(o => familyOf(tune(o).meter) === fam && tuneful.some(n => phrasesKnown(n, o, w.time))).length - (fam === M.lastFamily ? 1 : 0);
    if (!best || score > best.score) best = { id, score };
  }
  const first = best?.id ?? null;
  // with no tune to play, the drum still has its say: the plain walk, at a walking pace
  const pat = first ? leaPattern(tune(first).meter) : leaPattern([4, 4]), G = gridOf(pat);
  const lead = (drummers[0] || clappers[0]);
  const bpm0 = first ? 60 / tuneBeatSec(first) : 100, bpm = first ? sessionTempo(first, w, lead) : 100 * (1 - WIND * lateness(w));
  const cyc = cycleSec(G, bpm);
  const S = f.music = { session: true, pat, G, key: pat.name + ':' + Math.floor(w.time * 24), family: familyOf(pat.meter), gentry, bpm, bpm0, cyc, t: 0,
    rhythm: drummers.map(n => ({ npc: n, kind: 'tabor', row: 'tabor' })).concat(clappers.map(n => ({ npc: n, kind: 'clap', row: 'hands' }))),
    tune: null, players: [], length: 0, left: 0, first, next: cyc * (LEAD_IN[0] + Math.floor(Math.random() * (LEAD_IN[1] - LEAD_IN[0] + 1))),
    turn: 0, played: [], dancers: [], last: M.last, until: first ? Infinity : cyc * RHYTHM_ONLY,
    tunes: SESSION_TUNES[0] + Math.floor(Math.random() * (SESSION_TUNES[1] - SESSION_TUNES[0] + 1)) };
  const st = w.musicStats ??= { played: 0, learnt: 0, tunes: {} };
  st.sessions = (st.sessions || 0) + 1;
  st.byMeter ??= {}; st.byMeter[pat.meter.join('/')] = (st.byMeter[pat.meter.join('/')] || 0) + 1;
  if (clappers.length) st.clapped = (st.clapped || 0) + 1;
  joinDance(f, w, S);
}
function endSession(f, w, S, why){
  sitDown(S);
  const E = (w.musicStats.sessionEnds ??= {}); E[why] = (E[why] || 0) + 1;
  // a rest, and the next may be a quiet one: a Gentry tune with no rhythm, if anyone has one
  f.music = { rest: REST[0] + Math.random() * (REST[1] - REST[0]), last: S.tune || S.played.at(-1) || S.last, lastFamily: S.family, quiet: true };
  const st = w.musicStats; if (st){ st.sessionTunes ??= []; st.sessionTunes.push(S.played.length); }
}
function stepSession(f, w, dt, S){
  S.t += dt;
  // whoever keeps the rhythm stays to keep it: a drummer in earshot and awake, a clapper sitting there
  const seated = sittingAt(f, w);
  S.rhythm = S.rhythm.filter(r => !r.npc.sleeping && (r.kind === 'tabor' ? Math.hypot(r.npc.x - f.x, r.npc.z - f.z) < EARSHOT : seated.includes(r.npc)));
  // hands: a clapper gone, someone else sitting there without an instrument takes it up
  if (S.rhythm.every(r => r.kind === 'clap') && S.rhythm.length < CLAPPERS){
    for (const n of seated){
      if (S.rhythm.length >= CLAPPERS) break;
      if (instrumentOf(n) || n.sleeping || n.talking || S.rhythm.some(r => r.npc === n) || S.players.some(p => p.npc === n)) continue;
      if (n.dance?.M === S) n.dance = null;
      S.rhythm.push({ npc: n, kind: 'clap', row: 'hands' });
    }
  }
  const why = !f.lit ? 'fire out' : !S.rhythm.length ? 'no rhythm' : S.t > S.until ? (S.played.length || S.tune ? 'done' : 'rhythm alone') : null;
  if (why){ if (S.tune) heard(f, w, S); endSession(f, w, S, why); return; }
  joinDance(f, w, S);
  if (S.tune){
    S.left = S.start + S.length - S.t;
    if (!S.players.some(p => seated.includes(p.npc) || Math.hypot(p.npc.x - f.x, p.npc.z - f.z) < EARSHOT)){ S.tune = null; S.next = nextHead(S, S.t, BETWEEN[0]); return; }
    if (S.left > 0) return;
    heard(f, w, S);
    S.played.push(S.tune); S.tune = null;
    S.next = nextHead(S, S.t, BETWEEN[0] + Math.floor(Math.random() * (BETWEEN[1] - BETWEEN[0] + 1)));
    return;
  }
  if (S.until !== Infinity || S.t < S.next - S.cyc) return;   // a cycle ahead of its head, the next tune is chosen, so its pick-up can sound
  // whose turn it is: they start a tune they know in this meter, near its tempo, one not played yet
  // in this session before one that has been, never the one just played if they've another; if they've
  // none, the next musician. Once the session's had its tunes, or nobody has one, it's done after a cycle
  const near = tunefulNear(f, w), just = S.played.at(-1);
  let id = null;
  if (S.played.length >= S.tunes){ S.until = S.next; return; }
  if (!S.played.length && S.first && near.some(n => phrasesKnown(n, S.first, w.time))) id = S.first;
  for (let i = 0; !id && i < near.length; i++){
    const n = near[(S.turn + i) % near.length];
    const mine = tunesOf(n, w.time).filter(t => fitsSession(S, t));
    const pick = mine.find(t => !S.played.includes(t)) ?? mine.find(t => t !== just) ?? (near.length === 1 ? mine[0] : null);
    if (pick){ id = pick; S.turn += i + 1; }
  }
  if (!id){ S.until = S.next; return; }
  playInSession(f, w, S, id, near);
}
// the cycle head `cycles` after the one at or after t
const nextHead = (S, t, cycles) => (Math.ceil(t / S.cyc - 1e-6) + cycles) * S.cyc;
function playInSession(f, w, S, id, near){
  const scale = (60 / S.bpm) / tuneBeatSec(id), pick = shape(id).pickBeats * 60 / S.bpm;
  const ps = near.map(n => ({ npc: n, kind: n.instrument, k: phrasesKnown(n, id, w.time), f: fluencyOf(n, id, w.time) })).filter(p => p.k > 0);
  if (!ps.length){ S.next = nextHead(S, S.t, 1); return; }   // nobody here has it after all (it's gone from them, they've gone): try again next cycle
  for (const p of ps){ learnTune(p.npc, id, w.time, p.k); drilled(p.npc, id, w.time, HAND_PLAYED); }
  parts(ps, id).forEach((part, i) => { ps[i].part = part; });
  for (const p of ps) p.len = schedule(id, knownSet(p.k)).length * scale;
  Object.assign(S, { tune: id, players: ps, scale, start: S.next - pick, length: Math.max(...ps.map(p => p.len)) });
  S.left = S.start + S.length - S.t;
  const st = w.musicStats;
  st.played++; st.tunes[id] = (st.tunes[id] || 0) + 1; st.inSession = (st.inSession || 0) + 1;
  st.parts ??= {};
  for (const p of ps) st.parts[p.part] = (st.parts[p.part] || 0) + 1;
  if (ps.length + S.rhythm.length > 1) st.bands = (st.bands || 0) + 1;
}
