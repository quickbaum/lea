// palace-music.js — the Gentry's sets over the world's drums, in a Faerie palace (docs/music.md
// "Built: rhythm in Faerie"). Pure: what is played when; main.js sounds it.
//
// Decided 2026-11-09: every rhythm the bench has is to be heard in Faerie, before the far realms are
// built; some palaces have no drums, the others the bench's beats. So:
//   - every third palace (palace:2, palace:5) keeps the Gentry's own way: no drum (main.js, as it was)
//   - in the rest, drummers stand round the band, and the hall plays SETS, going round every
//     rhythm the bench has (rhythm.js PATTERNS), each palace from its own place in the list
//   - a set: the drums alone two cycles, then one Gentry tune whose bars fit the rhythm
//     (fitGroup 0 or 1) at its own tempo, its first full bar on a cycle's head, fitted beat by beat
//     (rhythm.js fitTune: on 7/8 the tune's beats go long and short with the drum's), the drums on
//     to the cycle's end, and one cycle more. A rhythm no Gentry tune fits (5/4, the slip jig) is
//     played by the drums alone, ALONE cycles.
//   - the band plays it the bench's "Faerean" way: the tune on the silver pipes, the vielle the
//     tune an octave down, broken chords on a harp following the lead drum (root on a dum, up the
//     chord on its other strokes), bells on the other harp, a bar's head rung on the bass drum's
//     first stroke. (The bench's drone on the dums is left out: the vielle's sample grates over
//     the drums there.)

import { TUNES, schedule } from './tunes.js';
import { partNotes, chords } from './arrange.js';
import { PATTERNS, gridOf, fracs, rowOf, fitGroup, ownBpm, fitTune, cycleSec, rhythmNotes, shape, tuneBeatSec } from './rhythm.js';
import { DRUMS, KITS } from './drums.js';
import { track } from './dance.js';

export const GENTRY = Object.keys(TUNES).filter(id => TUNES[id].style === 'gentry');
// every rhythm but the empty one, each with its tradition (a pattern with none is the Maghreb's)
export const PALACE_PATTERNS = PATTERNS.filter(p => Object.keys(p.rows).length).map(p => ({ ...p, kit: p.kit || 'maghreb' }));
export const LEAD = 2, TAIL = 1, ALONE = 8, REST = 5;   // cycles: drums alone first, after, with no tune; seconds between sets
export const ALONE_BPM = 66;
export const DRUMMERS = 3;            // standing round the band; a pattern's rows dealt round them

// does this palace (its level's id, 'palace:N') have drums?
export const palaceDrums = id => { const n = +String(id).split(':')[1]; return Number.isFinite(n) && n % 3 !== 2; };

// the tunes that fit a rhythm best (fitGroup 0, else 1), or none
export function fitting(p, G = gridOf(p)){
  const g = GENTRY.map(id => [id, fitGroup(id, G, p.meter)]).filter(([, f]) => f <= 1);
  const best = Math.min(...g.map(([, f]) => f));
  return g.filter(([, f]) => f === best).map(([id]) => id);
}

// set n in a palace (seed: where in the list its sets start). { p, kit, G, bpm, cyc, id (or
// null), enter (s: the tune's first note), head (s: its first full bar, a cycle's head), end (s:
// the drums stop), rows: [{ drum, row, who }] }. Times from the set's start.
export function planSet(seed, n){
  const p = PALACE_PATTERNS[((seed >>> 0) + n) % PALACE_PATTERNS.length], G = gridOf(p);
  const ids = fitting(p, G), id = ids.length ? ids[Math.floor(((seed >>> 0) + n) / PALACE_PATTERNS.length) % ids.length] : null;
  const bpm = id ? ownBpm(id, G) : ALONE_BPM, cyc = cycleSec(G, bpm);
  const rows = Object.keys(p.rows).map((drum, i) => ({ drum, row: drum, who: i % DRUMMERS }));
  if (!id) return { p, kit: p.kit, G, bpm, cyc, id: null, head: null, enter: null, end: ALONE * cyc, rows };
  const F = fitTune(id, G, bpm), head = LEAD * cyc, len = F.at(schedule(id).length);
  return { p, kit: p.kit, G, bpm, cyc, id, F, head, enter: head + F.at(0), end: (Math.ceil(len / cyc - 1e-6) + LEAD + TAIL) * cyc, rows };
}

// a drum row's strokes from `from` to `to` (s from the set's start), for instruments.js
export const drumNotes = (S, r, from, to) => rhythmNotes(S.p, r.row, r.drum, S.bpm, from, Math.min(to, S.end));

// the band's parts for a set with a tune: [{ part, kind, notes }] in seconds from the set's start
export const BAND = [{ part: 'tune', kind: 'silver pipes' }, { part: 'low', kind: 'vielle' }, { part: 'broken', kind: 'harp' }, { part: 'bells', kind: 'harp' }];
export function bandNotes(S){
  if (!S.id) return BAND.map(b => ({ ...b, notes: [] }));
  const { id, F, head } = S, shift = n => ({ ...n, t: n.t + head });
  const lay = list => F.lay(list).map(shift);
  const tune = lay(schedule(id).notes), low = lay(partNotes(id, 'low', null, 'vielle').notes);
  const follow = followers(S);
  return BAND.map(b => ({ ...b, notes: b.part === 'tune' ? tune : b.part === 'low' ? low : follow[b.part] }));
}

// The parts that play on a drum's strokes (the bench's followers, maghreb.html): the broken
// chords on the kit's lead drum, the bells on its bass drum, while the tune lasts
function followers(S){
  const { p, G, id, F, head } = S, K = KITS[p.kit], cells = {}, beat = z => 60 / S.bpm * z / G.base;
  for (const d of Object.keys(p.rows)) cells[d] = rowOf(p, d, G);
  const pick = d => cells[d] ? d : Object.keys(p.rows).find(x => DRUMS[x]?.low) || Object.keys(p.rows)[0];
  const lead = pick(K.lead), bass = pick(K.bass);
  const ch = chords(id).map(c => ({ ...c, rb: F.rb(c.t), end: F.rb(c.t + c.len) }));
  const bells = partNotes(id, 'bells').notes.map(b => ({ ...b, rb: F.rb(b.t) }));
  const last = F.rb(schedule(id).length), first = Math.min(0, F.rb(0));
  const out = { broken: [], bells: [] };
  let fig = 0, lastBar = null, lastQ = null;
  for (let c = 0; ; c++){
    let bt = c * S.cyc;
    if (bt >= S.end) break;
    for (let b = 0; b < G.NB; b++){
      const z = G.size[b], len = beat(z), fr = [...fracs(z), 1];
      for (let j = 0; j < z; j++){
        const s = G.start[b] + j, t = bt + fr[j] * len, q = (c * G.NB + b + j / z) - head / S.cyc * G.NB;   // q: tune beats from its first full bar
        if (q < first - 1e-6 || q >= last - 1e-6) continue;
        const step = (fr[j + 1] - fr[j]) * len;
        // broken chords: the root on a dum (on a drum with none, its first stroke in each bar), up the chord on the rest
        const k = cells[lead][s];
        if (k !== '.'){
          const Dm = DRUMS[lead] || {}, low = !!Dm.low && Dm.low.includes(k);
          const C = ch.find(x => x.rb <= q + 1e-6 && q < x.end - 1e-6) || ch.at(-1);
          const r = 43 + (((C.pcs[0] - 43) % 12) + 12) % 12, third = (((C.pcs[1] - C.pcs[0]) % 12) + 12) % 12, tones = [r, r + 7, r + 12, r + 12 + third];
          const bar = `${c}:${Math.floor(s / G.bar)}`, root = low || (!Dm.low && lastBar !== bar);
          lastBar = bar;
          let midi;
          if (root){ midi = tones[0]; fig = 0; } else { fig = (fig % 4) + 1; midi = tones[[1, 2, 3, 2][fig - 1]]; }
          const vel = low ? 1 : Dm.soft?.includes(k) ? 0.6 : 0.8;
          out.broken.push({ t, dur: step * 2, midi, vel: (root ? 0.55 : 0.42) * (low || root ? 1 : vel / 0.8) });
        }
        // bells: any bar head passed since the bass drum's last stroke (on this very stroke, the first time)
        if (cells[bass][s] !== '.'){
          const span = lastQ == null || q - lastQ > 2 ? 0 : q - lastQ;
          lastQ = q;
          for (const B of bells){ const ago = q - B.rb; if (ago > -1e-6 && (ago < span - 1e-6 || ago < 1e-6)) out.bells.push({ t, dur: 0.35, midi: B.midi, vel: 0.5 }); }
        }
      }
      bt += len;
    }
  }
  return out;
}

// ---- what the lights (and, later, the fae dancers) move to: dance.js tracks ----------------
// a set's: the tune on the pipes, every drum's strokes (a dum is low), the rhythm's beats and bars
export function setTrack(S){
  const beats = [], bars = [], { G } = S;
  for (let c = 0, t = 0; t < S.end - 1e-6; c++) for (let b = 0; b < G.NB; b++){
    if (G.start[b] % G.bar === 0) bars.push(t);
    beats.push(t); t += 60 / S.bpm * G.size[b] / G.base;
  }
  beats.push(S.end);
  const strokes = S.rows.flatMap(r => drumNotes(S, r, 0, S.end).map(n => ({ t: n.t, vel: n.vel, low: !!DRUMS[r.drum]?.low?.includes(n.k) })));
  const notes = S.id ? bandNotes(S).find(b => b.part === 'tune').notes : [];
  return track({ notes, strokes, beats, bars });
}
// a tune played the Gentry's own way, with no drum (main.js): its own beats and bars, the pick-up
// before the first; each of the melody's notes a light stroke, a bar's head more
export function tuneTrack(id, melody){
  const S = shape(id), beat = tuneBeatSec(id), len = schedule(id).length, pick = S.pickBeats * beat;
  const beats = [], bars = [];
  for (let k = pick > 1e-6 ? -1 : 0, t; (t = pick + k * beat) < len + 1e-6; k++){ beats.push(Math.max(0, t)); if (((k % S.beatsPerBar) + S.beatsPerBar) % S.beatsPerBar === 0 && t >= 0) bars.push(t); }
  const heads = new Set(bars.map(t => t.toFixed(3)));
  return track({ notes: melody, beats, bars, strokes: melody.map(n => ({ t: n.t, vel: heads.has(n.t.toFixed(3)) ? 0.8 : 0.45 })) });
}
