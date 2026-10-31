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

import { TUNE_IDS, FOLK_TUNES, tune, schedule } from './tunes.js';
import { DRUMS, parts } from './arrange.js';
import { memoryOf } from './recipes.js';
import { addNews } from './gossip.js';
import { craftsOf } from './making.js';

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
export function easeOf(id){
  if (!EASES.has(id)){
    const P = tune(id), notes = P.phrases.reduce((a, p) => a + p.notes.filter(n => n.midi != null).length, 0);
    const e = notes * new Set(schedule(id).notes.map(n => n.midi)).size / 7;
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
  const M = f.music ??= { rest: REST[0] * Math.random() };
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
  // the tune they know best between them (not the one just played, if there's another): the
  // pipers and fiddlers choose; drummers only if there's nobody else
  const choosers = tuneful.length ? tuneful : drummers;
  let best = null;
  for (const id of TUNE_IDS){
    const ks = choosers.map(n => phrasesKnown(n, id, w.time)), sum = ks.reduce((a, k) => a + k, 0);
    if (!sum) continue;
    const score = sum / phraseCount(id) - (id === M.last ? 1.5 : 0);   // and not the same one twice running, if they've another
    if (!best || score > best.score) best = { id, ks, score };
  }
  if (!best){ M.rest = REST[1]; return; }
  const lead = Math.max(...best.ks);
  const ps = choosers.map((n, i) => ({ npc: n, kind: n.instrument, k: best.ks[i] })).filter(p => p.k > 0);
  for (const p of ps) learnTune(p.npc, best.id, w.time, p.k);              // playing it keeps it
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
  const at = Math.max(0, M.length - M.left);
  for (const n of sittingAt(f, w)){
    if (n.dance?.M === M || n.sleeping || n.talking || M.players.some(p => p.npc === n) || M.dancers.length >= DANCE_MAX) continue;
    n.dance = { M, f, a: Math.atan2(n.z - f.z, n.x - f.x), r0: Math.hypot(n.x - f.x, n.z - f.z), t0: at };
    M.dancers.push(n);
    w.musicStats.danced = (w.musicStats.danced || 0) + 1;
  }
}
const DANCES = ['ring', 'turn', 'in-out'];
export function dancePose(n){
  const d = n.dance, M = d?.M;
  if (!M || d.f.music !== M){ if (d) n.dance = null; return null; }
  const T = tune(M.tune), crotchet = 60 / T.bpm, compound = T.meter[1] === 8 && T.meter[0] % 3 === 0;
  const beat = compound ? crotchet * 1.5 : crotchet * 4 / T.meter[1], bar = T.meter[0] / T.meter[1] * 4 * crotchet;
  const kind = DANCES[Math.floor(hash01(M.tune, 'dance') * DANCES.length)], dir = hash01(M.tune, 'dir') < 0.5 ? -1 : 1;
  const R = d.f.ringR + DANCE_OUT, P = 4 * bar;
  // how far round, in seconds' going: on all through; back and forth every four bars; or slower, round while closing in and opening out
  const round = at => { const ph = at % (2 * P); return kind === 'turn' ? (ph < P ? ph : 2 * P - ph) : kind === 'in-out' ? at * 0.6 : at; };
  const place = at => {
    const b = Math.min(1, (at - d.t0) / DANCE_IN);                     // getting up from the seat into the ring
    const ring = kind === 'in-out' ? R + 0.6 - 0.9 * (0.5 - 0.5 * Math.cos(2 * Math.PI * at / P)) : R;
    const r = d.r0 + (ring - d.r0) * Math.max(0, b), a = d.a + dir * (round(at) - round(d.t0)) * DANCE_STEP / beat / R;
    return [d.f.x + Math.cos(a) * r, d.f.z + Math.sin(a) * r];
  };
  const at = Math.max(d.t0, M.length - M.left), [x, z] = place(at), [x2, z2] = place(at + 0.1);
  const fb = beat > 0 ? (at / beat) % 1 : 0;
  return { x, z, heading: Math.atan2(x2 - x, z2 - z), moving: Math.hypot(x2 - x, z2 - z) > 1e-3, hop: Math.sin(Math.PI * fb), sway: Math.sin(Math.PI * at / beat) };
}

const sittingAt = (f, w) => w.npcs.filter(n => n.sitting && Math.hypot(n.x - f.x, n.z - f.z) < f.ringR + SEAT);
// at the end of a tune, everyone in earshot may learn by ear what was played: a good ear all
// of it, a fair one the next phrase or so (a simple tune all of it), none nothing (or, of a
// simple tune, a phrase)
function heard(f, w, M){
  const most = Math.max(...M.players.map(p => p.k)), E = EASE[easeOf(M.tune)];
  for (const n of w.npcs){
    if (Math.hypot(n.x - f.x, n.z - f.z) > EARSHOT) continue;
    const ear = earOf(n), had = phrasesKnown(n, M.tune, w.time), gain = ear === 'good' ? most : ear === 'fair' ? E.ear : E.none;
    if (!gain || had >= most) continue;
    learnTune(n, M.tune, w.time, Math.min(most, had + gain));
    w.musicStats.learnt++;
  }
}
