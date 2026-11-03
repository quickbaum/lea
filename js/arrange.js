// arrange.js — one tune, several players: who plays what (docs/music.md, "The arrangement").
// Every part is made from the melody as the player knows it (tunes.js schedule), so a player
// who knows half the tune plays half of their part. Pure; the notes are { t, dur, midi, vel? }
// in seconds, as instruments.js plays them.
//
//   melody   the tune as written
//   counter  a second line under it: a note on every beat, a third, sixth, fifth or octave
//            below the tune, moving as little as it can, against the tune's motion where it
//            can, never in parallel fifths or octaves, closing on the octave. The rules of
//            first-species counterpoint, roughly, applied beat by beat
//   low      the tune an octave down
//   drum     the metre on a tabor: the low head on the strong beats, the snare between,
//            from the first full bar to the end
//
//   voiceN   written-out music's own voices (tunes.js `under`): no need to make any up
//
//   parts(players, id) gives each player ({ kind }) a part: drums drum; of the rest the first
//   plays the tune, the second the counter-line, the third the tune low, and round again.
//   Written-out music: the first plays the tune, the second the lowest voice (the tenor, the
//   bass: with the tune it's the frame the rest hangs on), the next the voices between, and
//   any more double the tune, every other one an octave down if the instrument goes that low.
//   A tune played in unison (texture 'unison'): all on the tune,
//   every other one an octave down if the instrument goes that low.
//   Any part is put up an octave, or two, if it goes lower than the instrument can (FLOOR).
//
// The Gentry's way of playing (a tune with style 'gentry'; docs/music.md "The Gentry's way"),
// after the slow, enchanted town music of old games: no beat to speak of, a drone under
// everything, a harp breaking the harmony into a rolling figure, and bells high over the tune.
// The harmony is guessed bar by bar from the tune's own notes (chords).
//   drone      the tonic held two bars at a time, from the first full bar (on a fiddle, with
//              its fifth: a double stop); in written-out music, its own bass, a bar at a time
//              (Bach's moves too far from home for one note held under it)
//   broken     each bar's chord, root fifth octave tenth octave fifth, in quavers, left to ring
//   bells      the tune's note at each bar's head, two octaves up, struck once; not in the
//              first phrase, so they come in once the tune is under way
//   heartbeat  the tabor's low head, softly, once a bar
// The folk who learn a Gentry tune play it the Gentry's way too, with what they have: a drone
// wants a held note (a pipe, a fiddle) and broken chords under it, broken chords a plucked one
// (a psaltery, a harp), and bells a harp or the silver pipes, so without Faerie's instruments
// it's thinner and plainer; with nothing plucked, it's the tune and a counter-line.

import { tune, schedule, stepMidi } from './tunes.js';

export const DRUMS = new Set(['tabor']);
const HELD = new Set(['vielle', 'tabor pipe', 'silver pipes', 'bone flute']);   // can hold a drone
const PLUCKED = new Set(['harp', 'psaltery']);                                  // can break a chord
const BELLS = new Set(['harp', 'silver pipes']);                                // ring out high
const LOW_OK = new Set(['vielle', 'psaltery', 'harp']);       // reach an octave below the tune
// the lowest note each sounds well (MIDI): a pipe's sample pitched far down is mud
const FLOOR = { 'bone flute': 60, 'tabor pipe': 60, 'silver pipes': 60, vielle: 55, psaltery: 48, harp: 40 };
const BOOM = 45, SNARE = 38;                                   // the tabor's two sounds (instruments.json)

export function parts(players, id = null){
  const T = id ? tune(id) : null, nv = T ? T.voices : 1;
  if (T?.style === 'gentry') return gentryParts(players);
  const order = nv > 1 ? [0, nv - 1, ...Array.from({ length: nv - 2 }, (_, k) => k + 1)] : [];
  let i = 0;
  return players.map(p => {
    if (DRUMS.has(p.kind)) return 'drum';
    const k = i++;
    if (T?.texture === 'unison') return k % 2 && LOW_OK.has(p.kind) ? 'low' : 'melody';
    if (nv > 1) return k < nv ? (order[k] ? 'voice' + order[k] : 'melody') : LOW_OK.has(p.kind) && (k - nv) % 2 === 0 ? 'low' : 'melody';
    return ['melody', 'counter', LOW_OK.has(p.kind) ? 'low' : 'melody'][k % 3];
  });
}

// the notes of one part of tune `id`, for a player who knows `known` (a Set of phrase indices),
// on instrument `kind` (put up out of its depths), if given
export function partNotes(id, part, known = null, kind = null){
  const s = schedule(id, known, /^voice\d+$/.test(part) ? +part.slice(5) : 0);
  let notes = s.notes;
  if (part === 'low') notes = notes.map(n => ({ ...n, midi: n.midi - 12 }));
  else if (part === 'counter') notes = counter(id, s);
  else if (part === 'drum') return { notes: drum(id, s), length: s.length };
  else if (part === 'heartbeat') return { notes: heartbeat(id, s), length: s.length };
  else if (part === 'drone') notes = drone(id, s, kind === 'vielle');
  else if (part === 'broken') notes = broken(id, s);
  else if (part === 'bells') return { notes: bells(id, s), length: s.length };   // high on purpose: never lifted
  const up = liftFor(notes, kind);
  return { notes: up ? notes.map(n => ({ ...n, midi: n.midi + up })) : notes, length: s.length };
}

// a part as a player's hands actually give it (music-sim.js fluencyOf, 0..1): the odd wrong
// note, an uneven touch. Alone (`solo`) they can also falter between notes, which is what practice
// sounds like. In a band nobody falters: they'd lose each other. By a hash of `key`, so a tune joined partway is the same tune.
const CLEAN = 0.95, SLIP = 0.32, FALTER = 0.22;
const h01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
export function roughen({ notes, length }, f, key, { solo = false } = {}){
  if (f >= CLEAN) return { notes, length };
  const slip = Math.pow(1 - f, 1.5) * SLIP, out = [];
  let late = 0;
  for (let i = 0; i < notes.length; i++){
    const n = notes[i], h = a => h01(key, i + a), wrong = h('w') < slip;
    if (solo && i && h('f') < (1 - f) * FALTER) late += 0.15 + 0.35 * h('l');
    out.push({ ...n, t: n.t + late, midi: wrong ? n.midi + (h('d') < 0.5 ? -1 : 1) * (h('s') < 0.6 ? 2 : 1) : n.midi,
               vel: (n.vel ?? 0.82) * (1 - (1 - f) * 0.35 * h('v')) });
  }
  return { notes: out, length: length + late };
}

// how far (semitones, whole octaves) notes must go up to sit above instrument `kind`'s floor
export function liftFor(notes, kind){
  const floor = FLOOR[kind] ?? 0, lo = Math.min(...notes.map(n => n.midi));
  return lo < floor ? 12 * Math.ceil((floor - lo) / 12) : 0;
}

// the beat (seconds), the bar, and where the first full bar starts (after the pick-up)
function grid(id){
  const T = tune(id), crotchet = 60 / T.bpm, compound = T.meter[1] === 8 && T.meter[0] % 3 === 0;
  const beat = compound ? crotchet * 1.5 : crotchet * 4 / T.meter[1];
  const bar = T.meter[0] / T.meter[1] * 4 * crotchet;
  // a pick-up: the notes before the first bar line, if they're short of a bar (written-out
  // music marks the end of every bar, so a whole first bar is a bar, not a pick-up)
  const first = T.phrases[T.form[0]], head = first.bars[0] > 0 ? first.notes.slice(0, first.bars[0]).reduce((a, n) => a + n.len, 0) * T.unitSec : 0;
  const pick = head < bar - 1e-6 ? head : 0;
  return { beat, bar, pick, beats: Math.round(bar / beat), eighth: crotchet / 2, compound };
}

function counter(id, s){
  const T = tune(id), g = grid(id), out = [], end = s.notes.length ? s.notes.at(-1).t + s.notes.at(-1).dur : 0;
  let prev = null;
  // beats from the first one at or after 0 that falls on the grid (the pick-up's beats too)
  const t0 = g.pick - Math.floor(g.pick / g.beat + 1e-6) * g.beat;
  for (let bt = t0; bt < end - 1e-6; bt += g.beat){
    const m = s.notes.find(n => n.t <= bt + 1e-6 && bt < n.t + n.dur - 1e-6);
    if (!m){ prev = null; continue; }
    const last = bt + g.beat >= end - 1e-6;
    // an accidental the tune uses in this beat holds for the counter-line too (a raised seventh)
    const accs = {}; for (const n of s.notes) if (n.t >= bt - 1e-6 && n.t < bt + g.beat) accs[((n.step % 7) + 7) % 7] = n.acc;
    let best = null;
    for (const d of last ? [7] : [2, 5, 4, 7, 9]){
      const step = m.step - d, pc = ((step % 7) + 7) % 7;
      const midi = pc in accs ? stepMidi(step, T.key, accs[pc]) : stepMidi(step, T.key);
      if (midi < 50 || midi > 84) continue;
      const iv = ((m.midi - midi) % 12 + 12) % 12, perfect = iv === 0 || iv === 7;
      if (iv === 6 || iv === 1 || iv === 2 || iv === 10 || iv === 11) continue;      // a tritone or a second against the tune
      let cost = perfect ? 1.2 : 0;
      if (prev){
        cost += Math.abs(midi - prev.midi) * 0.25;
        const mv = Math.sign(m.midi - prev.mel), cv = Math.sign(midi - prev.midi);
        if (perfect && prev.perfect && mv && cv === mv && iv === prev.iv) cost += 6;    // parallel fifths or octaves
        if (mv && cv === -mv) cost -= 0.4;                                              // contrary motion
      }
      if (!best || cost < best.cost) best = { midi, cost, perfect, iv };
    }
    if (!best){ prev = null; continue; }
    const dur = Math.min(g.beat, end - bt);
    const held = out.at(-1);
    if (held && held.midi === best.midi && Math.abs(held.t + held.dur - bt) < 1e-6) held.dur += dur;   // the same note again: hold it
    else out.push({ t: bt, dur, midi: best.midi, vel: 0.6 });
    prev = { midi: best.midi, mel: m.midi, perfect: best.perfect, iv: best.iv };
  }
  for (const n of out) n.dur *= 0.97;
  return out;
}

function drum(id, s){
  const g = grid(id), out = [], end = s.notes.length ? s.notes.at(-1).t + s.notes.at(-1).dur : 0;
  const hit = (t, midi, vel) => { if (t < end - 0.05) out.push({ t, dur: 0.4, midi, vel }); };
  for (let b = g.pick; b < end - 1e-6; b += g.bar){
    if (g.compound){                                    // 6/8: BOOM . tap BOOM . tap
      hit(b, BOOM, 0.9); hit(b + 2 * g.eighth, SNARE, 0.35); hit(b + 3 * g.eighth, BOOM, 0.7); hit(b + 5 * g.eighth, SNARE, 0.35);
    } else for (let k = 0; k < g.beats; k++){           // 4/4 BOOM tap boom tap; 3/4 BOOM tap tap
      const strong = k === 0 || (g.beats === 4 && k === 2);
      hit(b + k * g.beat, strong ? BOOM : SNARE, k === 0 ? 0.9 : strong ? 0.7 : 0.35);
    }
  }
  return out;
}

// ---- the Gentry's way --------------------------------------------------------------------

// the tune first, on something that can hold it; then broken chords (a harp before a psaltery),
// a drone, and bells, as far as the instruments go; anyone left over doubles the tune. A drone
// only over broken chords: a tune and a held fifth with nothing moving between them is bare,
// and the fifth grates under the bars whose chord leaves it out (a pipe and a fiddle sounded
// that way); without anything to break a chord, the second player takes the counter-line
function gentryParts(players){
  const out = players.map(p => DRUMS.has(p.kind) ? 'heartbeat' : null);
  const take = (part, ok) => { const i = out.findIndex((o, j) => o === null && ok(players[j].kind)); if (i >= 0) out[i] = part; return i >= 0; };
  take('melody', k => HELD.has(k)) || take('melody', () => true);
  const chorded = take('broken', k => k === 'harp') || take('broken', k => PLUCKED.has(k));
  if (chorded) take('drone', k => HELD.has(k));
  else take('counter', () => true);
  take('bells', k => BELLS.has(k));
  let n = 0;
  return out.map((o, i) => o ?? (LOW_OK.has(players[i].kind) && n++ % 2 === 0 ? 'low' : 'melody'));
}

const LETTERS = 'CDEFGAB';
const tonicStep = key => 28 + LETTERS.indexOf(key[0]);           // C4 = 28, as tunes.js steps
const pcOf = m => ((m % 12) + 12) % 12;
const endOf = s => s.notes.length ? s.notes.at(-1).t + s.notes.at(-1).dur : 0;

// The harmony, a chord a bar, guessed from the whole tune (and written-out music's other
// voices too: a bass says a lot): of the triads on the scale's seven degrees (an accidental
// used in the bar holds for the chord too: a raised seventh makes the dominant major), the one
// that holds most of the bar's notes, beats counting double, the tune's note on the bar's
// head always in it, and the bass's too where it can be, best as the root. Ties go to the tonic, then the
// subdominant and a major dominant (a minor one is a weak chord to lean on), then the chord
// before; the last bar is the tonic if it can be. The scale is the tune's `home` key if it
// has one (written-out music is kept in C, every accidental marked), else its key.
// [{ t, len, pcs: [root, third, fifth] }], from the first full bar.
const chordCache = new Map();
// a chord as a page prints it, 'C' or 'Am', as pitch classes [root, third, fifth]
const printedChord = name => { const r = pcOf(stepMidi(28 + LETTERS.indexOf(name[0]), 'C')); return [r, pcOf(r + (name.endsWith('m') ? 3 : 4)), pcOf(r + 7)]; };
export function chords(id){
  if (chordCache.has(id)) return chordCache.get(id);
  const T = tune(id), K = T.home || T.key, g = grid(id), t0 = tonicStep(K), out = [];
  if (T.harmony){                                     // printed on the page: no guessing
    T.harmony.forEach((name, i) => out.push({ t: g.pick + i * g.bar, len: g.bar, pcs: printedChord(name) }));
    chordCache.set(id, out);
    return out;
  }
  const voices = Array.from({ length: T.voices }, (_, v) => schedule(id, null, v).notes);
  const all = voices.flat(), end = Math.max(...voices.map(v => v.length ? v.at(-1).t + v.at(-1).dur : 0));
  const sounding = (v, b) => v.find(n => n.t <= b + 1e-6 && b < n.t + n.dur - 1e-6);
  for (let b = g.pick; b < end - 1e-6; b += g.bar){
    const len = Math.min(g.bar, end - b), last = b + g.bar >= end - 1e-6;
    const inBar = all.filter(n => n.t < b + len - 1e-6 && n.t + n.dur > b + 1e-6);
    const head = sounding(voices[0], b), bass = T.voices > 1 ? sounding(voices.at(-1), b) : null;
    const accs = {}; for (const n of inBar) if (n.t >= b - 1e-6) accs[((n.step % 7) + 7) % 7] = n.acc;
    const cands = [];
    for (let d = 0; d < 7; d++){
      const pcs = [0, 2, 4].map(k => { const st = t0 + d + k, p7 = ((st % 7) + 7) % 7; return pcOf(p7 in accs ? stepMidi(st, K, accs[p7]) : stepMidi(st, K)); });
      if (pcOf(pcs[2] - pcs[0]) !== 7) continue;                   // diminished: no chord to rest on
      let score = 0;
      for (const n of inBar){
        const w = (Math.min(n.t + n.dur, b + len) - Math.max(n.t, b)) * (n.t >= b - 1e-6 && Math.abs((n.t - b) / g.beat - Math.round((n.t - b) / g.beat)) < 1e-3 ? 2 : 1);
        score += pcs.includes(pcOf(n.midi)) ? w : -0.6 * w;
      }
      score = score / len + (d === 0 ? 0.15 : d === 3 || (d === 4 && pcOf(pcs[1] - pcs[0]) === 4) ? 0.08 : 0) + (out.at(-1)?.pcs.join() === pcs.join() ? 0.1 : 0);
      if (bass && pcs[0] === pcOf(bass.midi)) score += 0.3;            // a bass note is most often the root
      if (last && d === 0) score += 100;
      cands.push({ score, pcs });
    }
    const holds = (c, n) => !n || c.pcs.includes(pcOf(n.midi));
    const pick = [c => holds(c, head) && holds(c, bass), c => holds(c, head), () => true].map(f => cands.filter(f)).find(cs => cs.length) || [];
    const best = pick.reduce((a, c) => !a || c.score > a.score ? c : a, null);
    out.push({ t: b, len, pcs: best ? best.pcs : out.at(-1)?.pcs ?? [pcOf(stepMidi(t0, K)), pcOf(stepMidi(t0 + 2, K)), pcOf(stepMidi(t0 + 4, K))] });
  }
  chordCache.set(id, out);
  return out;
}
// the bars of the harmony a player who knows `s` (schedule) gets through
const barsOf = (id, s) => { const end = endOf(s); return chords(id).filter(c => c.t < end - 1e-6).map(c => ({ ...c, len: Math.min(c.len, end - c.t) })); };

function drone(id, s, fifth){
  const T = tune(id), bars = barsOf(id, s), out = [];
  if (T.voices > 1){                                  // written-out music: its own bass, a bar at a time
    const bass = schedule(id, null, T.voices - 1).notes;
    for (const c of bars){
      const n = bass.find(n => n.t <= c.t + 1e-6 && c.t < n.t + n.dur - 1e-6) || bass.find(n => n.t >= c.t && n.t < c.t + c.len - 1e-6);
      if (!n) continue;
      const midi = 48 + pcOf(n.midi - 48), held = out.at(-1);
      if (held && held.midi === midi && Math.abs(held.t + held.dur - c.t) < 1e-6) held.dur += c.len;
      else out.push({ t: c.t, dur: c.len, midi, vel: 0.38 });
    }
    return out;
  }
  if (T.harmony){                                     // printed chords: their roots, a bar at a time (a held A would grate under the G bars)
    for (const c of bars){
      const midi = 48 + pcOf(c.pcs[0] - 48), held = out.at(-1);
      if (held && held.midi === midi && Math.abs(held.t + held.dur - c.t) < 1e-6) held.dur += c.len;
      else out.push({ t: c.t, dur: c.len, midi, vel: 0.38 });
    }
    return fifth ? out.flatMap(n => [n, { ...n, midi: n.midi + 7, vel: 0.3 }]) : out;
  }
  const tonic = stepMidi(tonicStep(T.key), T.key), root = 48 + pcOf(tonic - 48);
  for (let i = 0; i < bars.length; i += 2){
    const dur = bars[i].len + (bars[i + 1]?.len ?? 0);
    out.push({ t: bars[i].t, dur, midi: root, vel: 0.38 });
    if (fifth) out.push({ t: bars[i].t, dur, midi: root + 7, vel: 0.3 });
  }
  return out;
}

const FIGURE = [0, 1, 2, 3, 2, 1];
function broken(id, s){
  const g = grid(id), out = [];
  for (const c of barsOf(id, s)){
    const r = 43 + pcOf(c.pcs[0] - 43), tones = [r, r + 7, r + 12, r + 12 + pcOf(c.pcs[1] - c.pcs[0])];
    const n = Math.round(c.len / g.eighth);
    for (let k = 0; k < n; k++) out.push({ t: c.t + k * g.eighth, dur: 2 * g.eighth, midi: tones[FIGURE[k % FIGURE.length]], vel: k ? 0.4 : 0.52 });
  }
  return out;
}

function bells(id, s){
  const P = tune(id), first = P.phrases[P.form[0]].notes.reduce((a, n) => a + n.len, 0) * P.unitSec, out = [];
  for (const c of barsOf(id, s)){
    if (c.t < first - 1e-6) continue;
    const m = s.notes.find(n => n.t <= c.t + 1e-6 && c.t < n.t + n.dur - 1e-6);
    if (!m) continue;
    let midi = m.midi;
    while (midi < 84) midi += 12;
    while (midi > 100) midi -= 12;
    out.push({ t: c.t, dur: 0.35, midi, vel: 0.5 });
  }
  return out;
}

function heartbeat(id, s){
  return barsOf(id, s).map(c => ({ t: c.t, dur: 0.4, midi: BOOM, vel: 0.3 }));
}
