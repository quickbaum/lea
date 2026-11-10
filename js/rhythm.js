// rhythm.js — rhythms, and fitting tunes to them (docs/music.md "Planned: rhythm first").
// Pure. Taken out of the rhythm bench (tools/probes/maghreb.html), which imports it, so the bench
// is where a rhythm is tried and heard and the Lea plays the same thing.
//
//   a pattern   a row per drum, a character a pulse ('.' a rest); its meter sets the grid
//   gridOf(p)   the pulses of a cycle, grouped into beats (threes in compound time; twos, or
//               fours, in simple time; aksak meters spell theirs out)
//   fracs(z, lean)   where a beat's pulses fall, 0..1, with the lean (or swing) applied
//   shape(id)   a tune's beat, bar and pick-up, in its own beats
//   warpFn(...) a tune's time inside a beat, bent onto the pulses as they're timed
//   fitGroup(id, G, meter)   how a tune's meter meets the rhythm's (0 same … 3 drifts)

import { TUNES, tune } from './tunes.js';

// in the list's order, a section a meter
export const METERS = [
  { m: '2/4',  about: 'two beats a bar' },
  { m: '3/4',  about: 'three beats a bar' },
  { m: '4/4',  about: 'four beats a bar' },
  { m: '2/2',  about: 'cut time: two half-note beats a bar' },
  { m: '5/4',  about: 'five beats a bar, felt 3+2' },
  { m: '6/8',  about: 'two beats of three' },
  { m: '7/8',  about: 'uneven: beats of two and three' },
  { m: '9/8',  about: 'three beats of three, or 2+2+2+3' },
  { m: '12/8', about: 'four beats of three' },
];
export const PATTERNS = [
  // 2/4
  { name: 'oom-pah', meter: [2, 4], kit: 'band', info: 'bass on the beat, a chick between: a polka, a march',
    about: 'The two-step of a polka or a march band: the bass drum on each beat, the cymbals on each "and" between.',
    rows: { bassdrum: 'D.D. D.D.', cymbals: '.X.X .X.X' } },
  { name: 'habanera', meter: [2, 4], beats: [4, 4], bars: 1, kit: 'latin', info: 'long, short, two even: Cuba, the tango, a dozen dances since',
    about: 'The habanera: a dotted quaver, a semiquaver, two quavers. It went from Cuba into the tango and much else. The claves carry it, the conga\'s bass on the beat. In semiquavers here, four pulses a beat.',
    rows: { claves: 'X..XX.X.', conga: 'B...B...', shaker: 'XXXXXXXX' } },
  { name: 'malfuf', meter: [2, 4], beats: [4, 4], bars: 1, kit: 'arabic', info: 'Arabic: dum, then two teks, quick',
    about: 'Malfuf, a quick Arabic two: a dum, then teks on the fourth and seventh semiquavers. Often used to lead in or to hurry the end.',
    rows: { darbuka: 'D..T..T.', riq: 'D.TTT.TT' } },
  { name: 'ayyub', meter: [2, 4], beats: [4, 4], bars: 1, kit: 'arabic', info: 'Arabic: the rocking trance two',
    about: 'Ayyub, the two of the zar and other trance music: dum, ka dum, tek. It rocks and keeps going.',
    rows: { darbuka: 'D..KD.T.', riq: 'D.T.D.T.' } },
  // 3/4
  { name: 'waltz', meter: [3, 4], kit: 'band', info: 'one, two, three: bass, then two chicks',
    about: 'The waltz: the bass drum on the first beat, the snare on the second and third.',
    rows: { bassdrum: 'D..... D.....', snare: '..T.T. ..T.T.' } },
  { name: 'three, in twos and threes', meter: [3, 4], info: 'the 3/4 bar against a 6/8 one: the same six quavers',
    about: 'Six quavers make a 3/4 bar (2+2+2) or a 6/8 one (3+3). The bendir keeps the 3/4, the claps the 6/8: the same hemiola as the chaabi cycle, from the other side.',
    rows: { bendir: 'D.D.D. D.D.D.', claps: 'X..X.. X..X..' } },
  // 4/4
  { name: 'backbeat', meter: [4, 4], kit: 'kit', info: 'rock and pop: kick on 1 and 3, snare on 2 and 4',
    about: 'The backbeat of rock and pop: the kick on 1 and 3, the snare on 2 and 4, the hi-hat in quavers, opening at the end of the cycle.',
    rows: { kick: 'D...D.D. D...D.D.', snare: '..T...T. ..T...TK', hihat: 'xxxxxxxx xxxxxxxo' } },
  { name: 'maqsum', meter: [4, 4], kit: 'arabic', info: 'Arabic: the everyday four, dum tek – tek dum – tek –',
    about: 'Maqsum, the most common Arabic rhythm: dum tek, tek, dum, tek.',
    rows: { darbuka: 'DT.TD.T.', riq: 'DTTTDTTT' } },
  { name: 'baladi', meter: [4, 4], kit: 'arabic', info: 'Arabic: maqsum with two dums at the head',
    about: 'Baladi, maqsum\'s earthier sibling: two dums together at the head of the bar.',
    rows: { darbuka: 'DD.TD.T.', riq: 'DD.TD.T.' } },
  { name: 'sa\'idi', meter: [4, 4], kit: 'arabic', info: 'Egyptian: dum tek – dum dum – tek –',
    about: 'Sa\'idi, from Upper Egypt, the stick dance\'s rhythm: the two dums in the middle carry it.',
    rows: { darbuka: 'DT.DD.T.', riq: 'DT.DD.T.', claps: '..X...X.' } },
  { name: 'tresillo', meter: [4, 4], kit: 'latin', info: '3+3+2 quavers: the Caribbean and Latin cell',
    about: 'Tresillo: eight quavers grouped 3+3+2. Under a great deal of Latin, Caribbean and popular music.',
    rows: { claves: 'X..X..X.', conga: 'B..OB.O.', shaker: 'XXXXXXXX' } },
  // 2/2
  { name: 'alla breve', meter: [2, 2], kit: 'band', info: 'two big beats: a quick march, a reel',
    about: 'Cut time: two half-note beats a bar, each of four quavers. The bass drum on the beat, the snare between, the cymbals at the cycle\'s head.',
    rows: { bassdrum: 'D...D... D...D...', snare: '..T...T. ..T.TKT.', cymbals: 'X....... ........' } },
  // 5/4
  { name: 'five, 3+2', meter: [5, 4], bars: 1, kit: 'kit', info: 'five beats felt as three and two',
    about: 'Five beats, felt 3+2, a jazz drummer\'s way: the kick on the first and fourth, the snare between, the hi-hat on every beat.',
    rows: { kick: 'D.....D...', snare: '..T.T...T.', hihat: 'x.x.x.x.x.' } },
  // 6/8
  { name: 'plain 6/8', meter: [6, 8], info: 'two beats a bar: low, then high',
    about: 'The baseline: low on the first beat of each bar, high on the second. Two beats a bar, each of three pulses.',
    rows: { darbuka: 'D..T.. D..T..' } },
  { name: '3+3 against 2+2+2', meter: [6, 8], info: 'bendir in twos of three, claps in threes of two',
    about: 'Why the beat is hard to find. The bendir beats two to a bar (3+3), the claps three (2+2+2), both from the same twelve pulses. Count along each way in turn.',
    rows: { bendir: 'D..D.. D..D..', claps: 'X.X.X. X.X.X.' } },
  { name: 'chaabi, a two-bar cycle', meter: [6, 8], info: 'my reading of the groove: all four drums',
    about: 'My reading, a starting point: a darbuka line whose second bar answers the first, the bendir holding the 3+3, the claps on the 2+2+2, the taarija filling. Change it by ear. Then try starting the cycle on another pulse.',
    rows: { darbuka: 'D.KT.K D.DT.K', bendir: 'D..T.. D..T.T', taarija: '.T..T. .T..TT', claps: 'X.X.X. X.X.X.' } },
  { name: 'the hemiola turn', meter: [6, 8], info: 'my reading: a bar in threes, a bar in twos',
    about: 'My reading, after the general 6/8 habit of turning the beat over: the first bar walks in 3+3, the second runs in 2+2+2 on every drum, then the cycle falls back onto the one. Not taken from a named rhythm.',
    rows: { darbuka: 'D..T.K D.T.D.', bendir: 'D..D.. D.D.D.', claps: 'X..X.. X.X.X.' } },
  { name: 'gnawa-like', meter: [6, 8], kit: 'gnawa', info: 'after a description: bass on 1 and 4, offbeat metal',
    about: 'After a written description, not a recording: the big drum, the tbel, accents pulses 1 and 4 of each bar, and the krakeb, the iron castanets, fill the pulses between. A real Gnawa groove often sits nearer a long-short swing: try the lean slider.',
    rows: { tbel: 'D..D.. D..T..', krakeb: '.XX.XX .XX.XX' } },
  { name: 'busy darbuka', meter: [6, 8], info: 'my reading: the chaabi line, filled in',
    about: 'My reading: the chaabi cycle with the darbuka filling nearly every pulse with light ka strokes, the way a player decorates once the groove is settled. The bendir and claps hold it steady underneath.',
    rows: { darbuka: 'DKKTKK DKDTKT', bendir: 'D..T.. D..T.T', claps: 'X.X.X. X.X.X.' } },
  // 7/8
  { name: 'rachenitsa, 2+2+3', meter: [7, 8], beats: [2, 2, 3], kit: 'balkan', info: 'Bulgarian: short, short, long',
    about: 'Seven quavers as 2+2+3, short short long: the rachenitsa\'s limp. The long beat lasts half again as long; the tempo counts the short ones.',
    rows: { tapan: 'D.T.D.T D.T.D..', darbuka: 'D.T.D.. D.T.DKT' } },
  { name: 'lesnoto, 3+2+2', meter: [7, 8], beats: [3, 2, 2], kit: 'balkan', info: 'Macedonian: long, short, short',
    about: 'Seven quavers as 3+2+2, long short short: the lesnoto, walked slowly. The same seven pulses as the rachenitsa, the long beat first.',
    rows: { tapan: 'D..T.T. D..T.T.', darbuka: '.K.D.D. .K.D.DK' } },
  // 9/8
  { name: 'slip jig, 3+3+3', meter: [9, 8], bars: 1, kit: 'irish', info: 'three beats of three: the Irish slip jig',
    about: 'Nine quavers as three beats of three: the slip jig, on a bodhrán, the tipper going down and up.',
    rows: { bodhran: 'DTDDTDDTT' } },
  { name: 'karşılama, 2+2+2+3', meter: [9, 8], beats: [2, 2, 2, 3], bars: 1, kit: 'balkan', info: 'Turkish and Balkan: three short, one long',
    about: 'Nine quavers as 2+2+2+3: three short beats and a long one, the karşılama\'s and the Roma 9/8\'s. My spelling of the strokes; the grouping is the thing.',
    rows: { tapan: 'D...D.T..', darbuka: 'D.T.D.T.T' } },
  // 12/8
  { name: 'shuffle', meter: [12, 8], kit: 'kit', info: 'four beats of three: the blues shuffle',
    about: 'Four beats of three quavers, the first and third of each sounded: the shuffle of the blues and of rock and roll. The snare on beats 2 and 4.',
    rows: { kick: 'D.....D.....', snare: '...T.....T..', hihat: 'x.xx.xx.xx.x' } },
  { name: 'the 12/8 bell', meter: [12, 8], kit: 'westafrica', info: 'West African: seven strokes over twelve pulses',
    about: 'The standard bell pattern of West African and Afro-Cuban music: seven strokes over twelve pulses, against four steady beats.',
    rows: { bell: 'X.X.XX.X.X.X', djembe: 'B..T.SB..T.S', shaker: 'XXXXXXXXXXXX' } },
  { name: 'empty', meter: [6, 8], info: 'twelve rests, to make your own',
    about: 'Twelve rests, to make one from scratch.',
    rows: {} },
];
// a rhythm's grid: N pulses a cycle, NB beats; each beat's pulses (size), where each beat starts,
// each pulse's beat (pb) and place in it (pj); base, the beat the tempo counts (the short one, in aksak)
export function gridOf(p){
  const [n, d] = p.meter, compound = d === 8 && n % 3 === 0 && n > 3;
  const beats = p.beats || (compound ? Array(n / 3).fill(3) : d === 2 ? Array(n).fill(4) : d === 8 ? Array(n).fill(1) : Array(n).fill(2));
  const bar = beats.reduce((a, b) => a + b, 0), bars = p.bars || (bar <= 8 ? 2 : 1);
  const size = Array.from({ length: bars }, () => beats).flat();
  const start = [], pb = [], pj = []; let at = 0;
  size.forEach((z, b) => { start.push(at); for (let j = 0; j < z; j++){ pb.push(b); pj.push(j); } at += z; });
  return { meter: p.meter, beats, bars, bar, size, start, pb, pj, N: at, NB: size.length, base: Math.min(...beats),
           threes: beats.every(z => z === 3), key: beats.join('+') + '×' + bars };
}
// a beat is 3 pulses; `lean` (-1..1) moves pulses 2 and 3 between even thirds and a 2/4 split
// (−1: 25/25/50 short short long; +1: 50/25/25 long short short)
// a beat of 2 or 4 pulses: its off-pulses pushed later (swung, long short, up to a triplet's 2:1) or earlier
export function fracs(n, l = 0){
  if (n !== 3) return Array.from({ length: n }, (_, i) => i / n + (i % 2 ? l / (3 * n) : 0));
  const E = [0, 1/3, 2/3];
  const T = l < 0 ? [0, 0.25, 0.5] : [0, 0.5, 0.75], a = Math.abs(l);
  return E.map((e, i) => e + (T[i] - e) * a);
}

// A tune's beat is a dotted crotchet in compound time (6/8, 9/8, 12/8), else a note of the meter's
// own (arrange.js grid). Each tune beat goes to `speed` rhythm beats, and inside a beat the tune's
// time is bent onto the pulses: compound tunes' thirds onto the three pulses as they're timed; a
// simple tune's halves left straight (two against three) or the second moved onto the third pulse
// (long short, a jig's way).
export function shape(id){
  const T = TUNES[id], P = tune(id);
  const compound = T.meter[1] === 8 && T.meter[0] % 3 === 0;
  const beatW = compound ? 3 / 8 : 1 / T.meter[1];                // a beat, in whole notes
  const barW = T.meter[0] / T.meter[1];
  const ph = P.phrases[P.form[0]], b0 = ph.bars.length ? ph.bars[0] : ph.notes.length;
  let pick = ph.notes.slice(0, b0).reduce((a, n) => a + n.len, 0) * T.unit;
  if (pick >= barW - 1e-9) pick = 0;                             // a full first bar is never a pick-up
  return { T, P, compound, beatW, barW, pickBeats: pick / beatW, beatsPerBar: barW / beatW };
}
// 0..1 of a rhythm beat as the tune has it → 0..1 as it's played. `timing()` gives { lean, fit }
// as they are now (the bench reads its controls live)
// a beat of z pulses: a compound tune's thirds onto three pulses; a simple tune's halves onto two
// (swung as the pulses are), its quarters onto four, its halves onto three by the fit; the rest straight
export function warpFn(compound, speed, timing = () => ({ lean: 0, fit: 'swung' })){
  return (f, z = 3) => {
    if (speed !== 1) return f;
    const { lean, fit } = timing(), fr = fracs(z, lean);
    const pts = compound ? (z === 3 ? [[0, 0], [1/3, fr[1]], [2/3, fr[2]], [1, 1]] : [[0, 0], [1, 1]])
      : z === 2 ? [[0, 0], [0.5, fr[1]], [1, 1]]
      : z === 4 ? [[0, 0], [0.25, fr[1]], [0.5, fr[2]], [0.75, fr[3]], [1, 1]]
      : z === 3 && fit === 'swung' ? [[0, 0], [0.5, fr[2]], [1, 1]] : [[0, 0], [1, 1]];
    for (let i = 1; i < pts.length; i++){
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (f <= x1 + 1e-9) return y0 + (y1 - y0) * (f - x0) / (x1 - x0);
    }
    return 1;
  };
}
// How a tune's meter meets a rhythm's (grid G, meter [n, d]): 0, the same meter; 1, the same kind
// of beat (in threes, or not) with whole bars to the cycle; 2, the other kind, bars still filling
// it; 3, bars that drift across the cycle
export function fitGroup(id, G, meter){
  const S = shape(id);
  if (TUNES[id].meter.join('/') === meter.join('/')) return 0;
  const fills = G.NB % S.beatsPerBar === 0 || S.beatsPerBar % G.NB === 0;
  return !fills ? 3 : S.compound === G.threes ? 1 : 2;
}

// ---- the Lea's own rhythms ---------------------------------------------------------------
// Plain patterns for a tabor (D its low head, T the snare's rattle, K a soft one) and hands (X a
// clap), one for each meter the Lea's tunes are in. `clap` is clapped along with a drum; `hands`
// is what's clapped when there's no drum, the beat itself. Kit 'lea'. (Decided 2026-11-09: the
// bench's other rhythms are for Faerie and the far realms.)
export const LEA_PATTERNS = [
  { name: 'the two-step', meter: [2, 4], kit: 'lea', info: 'the Lea: low, a rattle, low, two rattles',
    about: 'The Lea\'s 2/4: the tabor\'s low head on each bar\'s head, its snare between; hands on the second beat.',
    rows: { tabor: 'D.T. D.TT', clap: '..X. ..X.', hands: 'X.X. X.XX' } },
  { name: 'the walk', meter: [4, 4], kit: 'lea', info: 'the Lea: low on 1 and 3, a rattle on 2 and 4',
    about: 'The Lea\'s 4/4: low on one and three, the snare on two and four, a quick pair to close the cycle; hands on two and four.',
    rows: { tabor: 'D.T.D.T. D.T.D.TT', clap: '..X...X. ..X...X.', hands: 'X.X.X.X. X.X.X.XX' } },
  { name: 'the long step', meter: [2, 2], kit: 'lea', info: 'the Lea: two big beats a bar',
    about: 'The Lea\'s cut time: low on each half-bar, the snare between, a run at the end of the cycle.',
    rows: { tabor: 'D...T... D...T.TK', clap: '....X... ....X...', hands: 'X...X... X...X.X.' } },
  { name: 'the quick four', meter: [4, 8], kit: 'lea', info: 'the Lea: four quavers a bar, low and high',
    about: 'The Lea\'s 4/8, for the round: low, rattle, low, rattle, a quaver each.',
    rows: { tabor: 'DTDT DTTT', clap: '.X.X .X.X', hands: 'XXXX XXXX' } },
  { name: 'the turn', meter: [3, 4], kit: 'lea', info: 'the Lea: low, then two rattles',
    about: 'The Lea\'s 3/4: the low head on the bar\'s head, the snare on two and three.',
    rows: { tabor: 'D.T.T. D.T.TT', clap: '..X.X. ..X.X.', hands: 'X.X.X. X.X.X.' } },
  { name: 'the jig step', meter: [6, 8], kit: 'lea', info: 'the Lea: two beats of three, low-rattle on each',
    about: 'The Lea\'s 6/8: low on each beat, a rattle on its third quaver, hands on the beats.',
    rows: { tabor: 'D.TD.T D.TDTT', clap: 'X..X.. X..X..', hands: 'X..X.. X..X.X' } },
];
// a family of meters: tunes in one can be played over a rhythm in another, beat for beat
// (2/4, 4/4, 2/2 and 4/8 are one; 3/4 and 6/8 each their own)
export const familyOf = meter => { const m = meter.join('/'); return ['2/4', '4/4', '2/2', '4/8'].includes(m) ? 'duple' : m; };
export const leaPattern = meter => LEA_PATTERNS.find(p => p.meter.join('/') === meter.join('/'));
// a pattern's row, as long as its cycle (a bar's worth repeats)
export function rowOf(p, id, G = gridOf(p)){
  const r = (p.rows[id] || '').replace(/\s/g, '');
  return (r && G.N % r.length === 0 ? r.repeat(G.N / r.length) : (r + '.'.repeat(G.N)).slice(0, G.N)).split('');
}
// a tune's own beat (s), as rhythm.js counts it (shape: a dotted crotchet in compound time)
export const tuneBeatSec = id => shape(id).beatW * 4 * 60 / TUNES[id].bpm;
// a rhythm at `bpm` (its short beat a minute): how long a cycle is (s)
export function cycleSec(G, bpm){ return G.size.reduce((a, z) => a + z / G.base, 0) * 60 / bpm; }
// the strokes the Lea plays (instruments.json): the tabor's low head and snare, a clap
export const STROKE = { tabor: { D: [45, 0.9], T: [38, 0.42], K: [38, 0.26] }, clap: { X: [39, 0.7] } };
// The strokes of one row from `from` to `to` (s; 0 a cycle's head), as notes for instruments.js
// ({ t from `from`, dur, midi, vel }). The first stroke of each bar a little louder.
export function rhythmNotes(p, row, kind, bpm, from, to, lean = 0){
  const G = gridOf(p), cells = rowOf(p, row, G), base = 60 / bpm, cyc = cycleSec(G, bpm), out = [];
  const S = STROKE[kind];   // (a drum with no samples, drums.js's: each stroke is named, `k`)
  for (let c = Math.floor(from / cyc); c * cyc < to; c++){
    let bt = c * cyc;
    for (let b = 0; b < G.NB; b++){
      const z = G.size[b], len = base * z / G.base, fr = fracs(z, lean);
      for (let j = 0; j < z; j++){
        const s = cells[G.start[b] + j], st = S ? S[s] : s !== '.' && [0, 1], t = bt + fr[j] * len;
        if (!st || t < from - 1e-6 || t >= to - 1e-6) continue;   // (a hair before `to` is the next chunk's)
        out.push({ t: t - from, dur: 0.4, midi: st[0], vel: st[1] * (j === 0 && G.start[b] % G.bar === 0 ? 1.1 : 1), ...(S ? {} : { k: s }) });
      }
      bt += len;
    }
  }
  return out;
}

// ---- a tune on a rhythm, beat by beat ------------------------------------------------------
// The tempo (the rhythm's short beat a minute) that gives a rhythm beat, on average, the length
// of the tune's own beat at its own tempo
export function ownBpm(id, G){ return 60 * G.N / (G.NB * G.base * tuneBeatSec(id)); }
// Seconds on a rhythm (grid G at bpm, `lean` its pulses) from rhythm beat 0, the head of a cycle,
// to rhythm beat rb (any real number; before 0 is the cycle before): whole beats, each its own
// length (an aksak beat of three is longer than one of two), then the part of a beat, bent by
// `warp` (warpFn) onto the pulses as they're timed
export function beatClock(G, bpm, warp = f => f){
  const len = G.size.map(z => 60 / bpm * z / G.base), pre = [0];
  for (const l of len) pre.push(pre.at(-1) + l);
  const cyc = pre.at(-1);
  return rb => {
    const i = Math.floor(rb + 1e-9), c = Math.floor(i / G.NB), b = i - c * G.NB;
    return c * cyc + pre[b] + warp(Math.max(0, rb - i), G.size[b]) * len[b];
  };
}
// A tune's notes (tunes.js schedule's, or an arrange.js part's: { t, dur | len } in seconds at
// the tune's own tempo) as played on rhythm G at bpm: each tune beat a rhythm beat, 0 the head
// of the tune's first full bar, on a cycle's head. Its pick-up comes before 0. The fit is for a
// tune whose bars fill the cycle (fitGroup ≤ 2).
export function fitTune(id, G, bpm, lean = 0){
  const S = shape(id), clock = beatClock(G, bpm, warpFn(S.compound, 1, () => ({ lean, fit: 'swung' })));
  const rb = sec => sec / S.P.unitSec * S.T.unit / S.beatW - S.pickBeats;
  const at = sec => clock(rb(sec));
  return { at, rb, lay: list => list.map(n => { const t = at(n.t), d = n.dur ?? n.len; return { ...n, t, [n.dur != null ? 'dur' : 'len']: at(n.t + d) - t }; }) };
}
