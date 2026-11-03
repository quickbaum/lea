// tunes.js — the tunes of the Lea, and the books they're written in (docs/music.md).
// Every tune is a traditional one, out of copyright, under a Lea name: no real names in
// the game, as with the Gentry's books. Which tune each really is, and where the notes
// come from, is in docs/texts/tunes.md.
//
// A tune is written in ABC, the notation folk tunes have long been passed round in, split
// into phrases: a phrase is what's learnt (and forgotten) at a time, as a step is for a
// recipe. `form` is the order the phrases are played in (a phrase may come round again);
// without one, each once in order. Only the part of ABC these need is read: notes A–G a–g
// with , and ' for octaves, ^ _ = accidentals (they hold to the end of the bar), lengths
// (2, 3, /, 3/2), rests z, broken rhythm (> <), and bar lines.
//   key    the key signature, from KEYS
//   unit   the length a bare note has, as a fraction of a whole note (1/8)
//   meter  [beats, of] for the check that every whole bar adds up (tools/check-tunes.mjs)
//   bpm    crotchets a minute
//   book   the music book it's in (MUSIC_BOOKS), or none: the folk's own, known from the start
//   under  the other voices of written-out music, top down, phrase for phrase with `phrases`
//          (the top voice): the tune is what's learnt, and whoever knows it knows its parts
//   texture 'unison': played together on the tune, not in parts (arrange.js)
//   style  'gentry': played the Gentry's way, over a drone, with broken chords and bells (arrange.js)
//   harmony the chord of each bar, where the page prints them ('C', 'Am'; arrange.js chords): the Gentry's
//          way then plays those instead of guessing, and its drone follows their roots
//   home   the key the harmony is heard in, for written-out music, which is kept in C with every
//          accidental marked (arrange.js chords)
// The written-out music comes from real scores, by tools/import_scores.py (js/scores.js); a
// note held over a bar line there is tied, '-'.
// Pure data and parsing; js/instruments.js plays it, js/notation.js draws it.

import { FAERIE_BOOK_IDS } from './faerie-books.js';
import { SCORED } from './scores.js';

export const TUNES = {
  // ---- the choir book: a monastery's (the cloister's book cupboard) ----
  'the sleeping brother': { key: 'G', unit: 1 / 8, meter: [4, 4], bpm: 100, book: 'choir',
    about: 'A round, to wake a brother for the night office.',
    phrases: ['G2A2B2G2|G2A2B2G2|', 'B2c2d4|B2c2d4|', 'dedc B2G2|dedc B2G2|', 'G2D2G4|G2D2G4|'] },
  'the flowering time': { key: 'G', unit: 1 / 8, meter: [4, 4], bpm: 108, book: 'choir',
    about: 'A carol for the spring, when the fields flower.',
    phrases: ['G2G2G2A2|G2G2D4|E2D2E2F2|G4G4|', 'd2c2B2A2|B2A2G4|E2D2E2F2|G4G4|', 'D2D2E2F2|G2G2A4|d2c2B2A2|G4c4|G8|'],
    form: [0, 0, 1, 2] },
  // ---- the cellarer's songbook (the undercroft) ----
  'the old cup': { key: 'F', unit: 1 / 8, meter: [4, 4], bpm: 76, book: 'cellar',
    about: 'For the end of a night, when old friends drink together.',
    phrases: ['C2|F3F F2A2|G3F G2A2|F3F A2c2|d6', 'd2|c3A A2F2|G3F G2A2|F3D D2C2|F6'] },
  'the washerwoman': { key: 'G', unit: 1 / 8, meter: [6, 8], bpm: 160, book: 'cellar',
    about: 'A jig, quick, for dancing.',
    phrases: ['dc|BGG DGG|BGB dcB|cAA EAA|cAc edc|', 'BGG DGG|BGB dcB|cBc Adc|BGG G'],
    form: [0, 1, 0, 1] },
  // ---- the Gentry's library: tunes out of mortal hands, from every shore ----
  'the lady in green': { key: 'Am', unit: 1 / 8, meter: [6, 8], bpm: 92, book: 'green', style: 'gentry',
    about: 'A grieving air, for a lady who went away.',
    phrases: ['A|c2d e>fe|d2B G>AB|c2A A>^GA|B2^G E2', 'A|c2d e>fe|d2B G>AB|c>BA ^G>^F^G|A3 A2',
              'z|g3 g>fe|d2B G>AB|c2A A>^GA|B2^G E2', 'z|g3 g>fe|d2B G>AB|c>BA ^G>^F^G|A3 A2'] },
  'the blossom': { key: 'Am', unit: 1 / 8, meter: [4, 4], bpm: 72, book: 'blossom',
    about: 'An air from far away, for the trees in flower.',
    phrases: ['A2A2B4|A2A2B4|', 'A2B2c2B2|A2BA F4|', 'E2C2E2F2|E2EC B,4|', 'A2A2B4|A2A2B4|E2F2BA F2|E8|'],
    form: [0, 1, 2, 1, 2, 3] },
  // ---- the folk's own: known from the start, written nowhere ----
  'the little star': { key: 'C', unit: 1 / 8, meter: [4, 4], bpm: 100,
    about: 'A child\'s tune, for the stars.',
    phrases: ['C2C2G2G2|A2A2G4|F2F2E2E2|D2D2C4|', 'G2G2F2F2|E2E2D4|'],
    form: [0, 1, 1, 0] },
  "the boatman's song": { key: 'Ddor', unit: 1 / 8, meter: [4, 4], bpm: 120,
    about: 'Sung at the paddle, to keep the stroke.',
    phrases: ['A2AA A2AA|A2D2F2A2|', 'G2GG G2GG|G2C2E2G2|', 'A2AA A2AA|A2B2c2d2|', 'c2A2G2E2|D4D4|'] },
};
Object.assign(TUNES, SCORED);
// One song twice over: the folk's way and the Gentry's, as two tunes under two names. Off a printed
// page (docs/texts/tunes.md). Added after the rest so the crypts' deal of the other songs stands.
export const TUNE_IDS = Object.keys(TUNES);
export const FOLK_TUNES = TUNE_IDS.filter(id => !TUNES[id].book);

// The music books, and where each is kept (docs/music.md). A mouldy shelf in a crypt
// (not the chapter house's, which keeps its still-room book) has one book dry in its
// case: in a cloister the choir book, in an undercroft the cellarer's songbook. A
// Faerie palace's shelves deal the Gentry's music books round with their recipe books
// (stillroom.js shelfBook).
export const MUSIC_BOOKS = {
  choir:   { from: 'A choir book', room: 'cloister', paper: null, head: 'square' },
  cellar:  { from: "The cellarer's songbook", room: 'undercroft', paper: null },
  green:   { from: 'A leaf of music, gilt-edged', faerie: true, paper: 'vellum' },
  blossom: { from: 'A leaf of music, gilt-edged', faerie: true, paper: 'vellum' },
  fortune: { from: 'A part-book for three viols, gilt-edged', faerie: true, paper: 'vellum' },
  trio:    { from: 'A music book for two fiddles and a bass', faerie: true, paper: 'vellum' },
  pass:    { from: 'A scroll of songs, from far to the east', faerie: true, paper: 'vellum' },
  rocking: { from: 'A leaf of music for flute and lute, gilt-edged', faerie: true, paper: 'vellum' },
  sorrowful: { from: 'A leaf of music, gilt-edged, its corner turned down', faerie: true, paper: 'vellum' },
};
for (const [id, B] of Object.entries(MUSIC_BOOKS)) B.tunes = TUNE_IDS.filter(t => TUNES[t].book === id);
export const FAERIE_MUSIC = Object.keys(MUSIC_BOOKS).filter(b => MUSIC_BOOKS[b].faerie);
// the music book on a shelf (gen/under.js shelves()), or null. A palace's: its place in the
// deal after the Gentry's recipe books (stillroom.js shelfBook deals the two together).
export function shelfMusic(sh){
  if (sh.tune) return TUNES[sh.tune].book;                  // a crypt song's own shelf or lectern (gen/under.js songs())
  if (sh.palace){ const i = sh.book % (FAERIE_BOOK_IDS.length + FAERIE_MUSIC.length) - FAERIE_BOOK_IDS.length; return i >= 0 ? FAERIE_MUSIC[i] : null; }
  return null;
}

// the one tune in a shelf's music book (never more than one to a shelf), or null: a crypt
// song's own (gen/under.js songs()); a palace's dealt round its book's tunes by how many times
// round the library its number has gone
export function shelfTune(sh){
  if (sh.tune) return sh.tune;
  const b = shelfMusic(sh); if (!b) return null;
  const T = MUSIC_BOOKS[b].tunes;
  return T[Math.floor(sh.book / (FAERIE_BOOK_IDS.length + FAERIE_MUSIC.length)) % T.length];
}
// a staff step (C4 = 28) as a MIDI note, under a key signature, or with `acc` (−1, 0, 1)
export function stepMidi(step, key, acc = keyAcc(key)['CDEFGAB'[((step % 7) + 7) % 7]] || 0){
  return 12 * (Math.floor(step / 7) + 1) + SEMI[((step % 7) + 7) % 7] + acc;
}
// key signatures: how many sharps (+) or flats (−)
const KEYS = { C: 0, G: 1, D: 2, A: 3, F: -1, Bb: -2, Am: 0, Em: 1, Bm: 2, Dm: -1, Gm: -2, Ddor: 0, Ador: 1, Edor: 2, Gmix: 0, Dmix: 1 };
const SHARPS = 'FCGDAEB', FLATS = 'BEADGCF';
const STEP = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }, SEMI = [0, 2, 4, 5, 7, 9, 11];
function keyAcc(key){
  const n = KEYS[key]; if (n == null) throw new Error(`tunes: no key ${key}`);
  const acc = {};
  for (let i = 0; i < Math.abs(n); i++) acc[(n > 0 ? SHARPS : FLATS)[i]] = Math.sign(n);
  return acc;
}

// One phrase of ABC → notes: { step (diatonic, C4 = 28), acc, midi, len (in `unit`s) }, a
// rest has midi null; and the bar lines, as the index of the note each falls before.
const NOTE = /^([_^=]?)([A-Ga-gz])([,']*)(\d*)(\/?)(\d*)/;
export function parsePhrase(abc, key){
  const sig = keyAcc(key), notes = [], bars = [];
  let barAcc = {}, broken = null;
  for (let i = 0; i < abc.length;){
    const ch = abc[i];
    if (ch === ' ' || ch === ':' || ch === ']'){ i++; continue; }
    if (ch === '-'){ const last = notes.at(-1); if (last && last.midi != null) last.tie = true; i++; continue; }   // held into the next
    if (ch === '|'){ bars.push(notes.length); barAcc = {}; i++; continue; }
    if (ch === '>' || ch === '<'){
      const last = notes.at(-1); if (!last) throw new Error(`tunes: ${ch} with nothing before it in "${abc}"`);
      last.len *= ch === '>' ? 1.5 : 0.5; broken = ch === '>' ? 0.5 : 1.5; i++; continue;
    }
    const m = NOTE.exec(abc.slice(i));
    if (!m) throw new Error(`tunes: can't read "${abc.slice(i, i + 6)}" in "${abc}"`);
    i += m[0].length;
    const [, accMark, letter, octs, num, slash, den] = m;
    let len = num ? +num : 1;
    if (slash) len /= den ? +den : 2;
    if (broken){ len *= broken; broken = null; }
    if (letter === 'z'){ notes.push({ midi: null, len }); continue; }
    const L = letter.toUpperCase();
    let step = STEP[L] + 28 + (letter === L ? 0 : 7);
    for (const o of octs) step += o === "'" ? 7 : -7;
    if (accMark) barAcc[step] = accMark === '^' ? 1 : accMark === '_' ? -1 : 0;
    const acc = step in barAcc ? barAcc[step] : sig[L] || 0;
    const midi = 12 * (Math.floor(step / 7) + 1) + SEMI[step % 7] + acc;
    notes.push({ step, acc, midi, len, ...(accMark ? { mark: accMark } : {}) });
  }
  return { notes, bars };
}

// a tune parsed: its phrases, and the order they're played in
const parsed = new Map();
export function tune(id){
  if (parsed.has(id)) return parsed.get(id);
  const T = TUNES[id]; if (!T) return null;
  const P = { id, ...T, phrases: T.phrases.map(p => parsePhrase(p, T.key)), form: T.form || T.phrases.map((_, i) => i),
              under: (T.under || []).map(v => v.map(p => parsePhrase(p, T.key))) };
  P.voices = 1 + P.under.length;
  P.unitSec = 60 / T.bpm * 4 * T.unit;   // a crotchet is a beat
  parsed.set(id, P);
  return P;
}
// the notes to play, in seconds from the start: [{ t, dur, midi }], the phrases in their
// form, or only those in `known` (a Set of phrase indices) and stopping at the first
// one not known: someone who's half learnt a tune plays as far as they know it. `voice`:
// which of written-out music's voices (0, the top, is the tune). A tied note is one note.
// one phrase alone, from nought: what's drilled at practice (music-sim.js)
export function phraseSchedule(id, k){
  const P = tune(id), out = [];
  let t = 0, held = null;
  for (const n of P.phrases[k].notes){
    const dur = n.len * P.unitSec;
    if (held && n.midi === held.midi) held.dur += dur;
    else if (n.midi != null) out.push(held = { t, dur, midi: n.midi, step: n.step, acc: n.acc });
    if (!n.tie) held = null;
    t += dur;
  }
  return { notes: out, length: t };
}
export function schedule(id, known = null, voice = 0){
  const P = tune(id), out = [], V = voice ? P.under[voice - 1] : P.phrases;
  let t = 0, held = null;
  for (const k of P.form){
    if (known && !known.has(k)) break;
    for (const n of V[k].notes){
      const dur = n.len * P.unitSec;
      if (held && n.midi === held.midi) held.dur += dur;
      else if (n.midi != null) out.push(held = { t, dur, midi: n.midi, step: n.step, acc: n.acc });
      if (!n.tie) held = null;
      t += dur;
    }
  }
  return { notes: out, length: t };
}
