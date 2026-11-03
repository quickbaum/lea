// speech-score.js — a character's speech as music (docs/lilts.md). Each screen of what they say
// gets a score, worked out from its words and punctuation and shaped by their lilt (js/lilt.js),
// and the words come up one at a time on its beat, each sounding a note on the instrument in their
// hand. Puck's is a bell. Pure; dialog.js shows the words and plays the notes.
//
// The score:
//   a word is a note: a quaver, a crotchet if it has two syllables, two notes slurred if more
//   (so long words take longer, as in speech); the little words are quick and soft
//   ,  ;  :      a breath (a quaver rest; a crotchet for ; and :), the phrase left hanging
//   .  !  ?      the sentence ends on a long note and the next starts on the beat; a full
//                stop falls home, a question rises and stays up, an exclamation peaks higher
//   …  —         the note is held
//   a blank line a pause to the next bar
//   each sentence rises and falls (an arch peaking ~40% through); a stressed word, a
//   capitalised one mid-sentence, or a long one sits a step higher and louder; a word's own
//   hash nudges it a step either way, so the same line always has the same tune
//
// Hidden marks, in the dialog text, never shown (each its own word, in braces, but *stress*):
//   *word*       stress this word
//   {/}          a breath after the word before
//   {slow} {quick} {even}   the tempo from here: ×0.7, ×1.3, back to the voice's own
//   {key:G}      the home note from here (a letter, b or #)
//   {m:Sw}       this word is in metre, a letter per syllable: S stressed, w not (js/verse.js
//                writes these). Its notes take the lilt's swing and its line fills the last
//                foot, so stressed syllables fall evenly: verse sets the beat, not word length.

import { LILTS, HANDS } from './lilt.js';

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const S0 = '', S1 = '';                  // hidden marks ride on a word between these
const SMALL = new Set(('a an the and or but of to in on at by for with from as is it its be was are ' +
  'i me my you your he him his she her we us our they them their that this so if not no').split(' '));

// the text with its hidden marks taken out (for showing), and the words as dialog.js wraps them:
// [{ text, para, marks: [] }]. Words are split exactly as dialog.js splits what it shows: the
// text between links, and each link's label, broken at whitespace.
export function prepare(raw){
  const glued = raw
    .replace(/\s*\{\/\}/g, `${S0}/${S1}`)                              // a breath: onto the word before
    .replace(/\{([a-z]+(?::[A-Ga-g][b#]?|:[Sw]+)?)\}\s*/g, `${S0}$1${S1}`)   // a tempo, key or metre: onto the word after
    .replace(/\*([^*\s][^*]*?)\*/g, (_, w) => `${S0}*${S1}${w}`);       // stress
  const strip = s => s.replace(new RegExp(`${S0}[^${S1}]*${S1}`, 'g'), '');
  const words = [];
  let gap = '', pending = [];
  const segs = [];
  let last = 0;
  for (const m of glued.matchAll(LINK)){ segs.push(glued.slice(last, m.index)); segs.push((m[2] || m[1]).trim()); last = m.index + m[0].length; }
  segs.push(glued.slice(last));
  for (const seg of segs){
    for (const m of seg.matchAll(/(\s*)(\S+)|(\s+)$/g)){
      if (m[3] !== undefined){ gap += m[3]; continue; }
      gap += m[1];
      const marks = [...m[2].matchAll(new RegExp(`${S0}([^${S1}]*)${S1}`, 'g'))].map(x => x[1]);
      const text = strip(m[2]);
      if (!text){ pending.push(...marks); continue; }    // a mark with no word of its own: onto the next
      const para = words.length > 0 && /\n\s*\n/.test(gap);
      words.push({ text, para, br: words.length > 0 && !para && /\n/.test(gap), marks: [...pending, ...marks] });
      pending = []; gap = '';
    }
  }
  return { clean: strip(glued), words };
}

// the words and their notes: { words: [{ text, t, br }], notes: [{ t, dur, midi, vel }], length }
// (`br`: this word starts a new line). `lilt` is a name in LILTS; `hand` gives the home note, and
// by default is the hand of that name.
export function score(raw, lilt, hand = HANDS[lilt]){
  const V = LILTS[lilt], shown = prepare(raw).words;
  const out = { words: [], notes: [], length: 0 };
  if (!V || !shown.length) return out;
  // a word that's only punctuation (a full stop after a link) belongs to the word before: it
  // comes up with it, and its punctuation is that word's
  const words = [], of = [];
  for (const w of shown){
    if (/[A-Za-z0-9]/.test(w.text) || !words.length){ words.push({ ...w, n: 1 }); of.push(words.length - 1); }
    else { const u = words.at(-1); words[words.length - 1] = { ...u, text: u.text + w.text, n: u.n + 1, marks: [...u.marks, ...w.marks] }; of.push(words.length - 1); }
  }
  const at = [];                                           // when each unit starts
  const LETTER = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const homeOf = (k, octave = hand?.octave ?? 5) => 12 * (octave + 1) + LETTER[k[0].toUpperCase()] + (k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0);
  const FOOT = V.swing[0] + V.swing[1];
  let home = homeOf(hand?.home || 'C', hand?.octave ?? 5), eighth = 60 / V.bpm / 2;
  const N = V.scale.length;
  const pitch = d => { d = Math.max(V.span[0], Math.min(V.span[1], d)); return home + 12 * Math.floor(d / N) + V.scale[((d % N) + N) % N]; };
  let t = 0, e = 0, prevDeg = 1;                         // seconds; eighths since the start (for the bar)
  const rest = n => { t += n * eighth; e += n; };
  const toBoundary = (every, min) => { let n = every - (e % every); if (n < min) n += every; rest(n); };

  // sentences: runs of words up to one ending . ! ? (or the end)
  const ends = w => (w.text.match(/([.!?…]+|[,;:]|[—–-]{1,2})["'’”)\]]*$/) || [])[1] || '';
  let k0 = 0;
  for (let k = 0; k < words.length; k++){
    const w = words[k];
    if (w.para && k > 0) toBoundary(8, 2);
    for (const m of w.marks){
      if (m === 'slow') eighth = 60 / V.bpm / 2 / 0.7;
      else if (m === 'quick') eighth = 60 / V.bpm / 2 / 1.3;
      else if (m === 'even') eighth = 60 / V.bpm / 2;
      else if (m.startsWith('key:')) home = homeOf(m.slice(4));
    }
    // where this word sits in its sentence
    let kEnd = k; while (kEnd < words.length - 1 && !/[.!?]/.test(ends(words[kEnd]))) kEnd++;
    if (k === 0 || /[.!?]/.test(ends(words[k - 1]))) k0 = k;
    const n = kEnd - k0 + 1, p = n > 1 ? (k - k0) / (n - 1) : 1, endP = ends(words[kEnd]);
    const exclaim = endP.includes('!'), core = w.text.replace(/[^A-Za-z']/g, ''), lower = core.toLowerCase();
    const syl = syllables(lower), small = SMALL.has(lower) && !w.marks.includes('*');
    const stress = w.marks.includes('*') || (k > k0 && /^[A-Z]/.test(core) && lower !== 'i') || syl >= 3;
    const metre = w.marks.find(m => m.startsWith('m:'))?.slice(2);
    const lens = metre ? [...metre].map(c => c === 'S' ? V.swing[0] : V.swing[1]) : small ? [1] : syl >= 3 ? [1, 2] : syl === 2 ? [2] : [1];
    const { peak, rise, shortRise, exclaim: peakUp } = V.arch, C = V.cadence;
    const arch = p < peak ? p / peak : 1 - (p - peak) / (1 - peak);
    let deg = Math.round(1 + arch * ((n <= 3 ? shortRise : rise) + (exclaim ? peakUp : 0))) + (hash(w.text + k) % 3) - 1 + (stress ? 1 : 0);
    const punct = ends(w), last = k === kEnd;
    const degs = metre ? [...metre].map(c => deg - (c === 'S' ? 0 : 1))   // an unstressed syllable sits a step under
                       : lens.map((_, i) => deg - i);      // a slurred pair steps down
    if (last){                                             // the cadence
      if (endP.includes('?')) degs[degs.length - 1] = Math.max(prevDeg + C.questionUp, C.questionMin);
      else degs[degs.length - 1] = C.fall;
      if (degs.length > 1 && !endP.includes('?')) degs[0] = Math.max(degs[0], C.hang);
    } else if (/[,;:]/.test(punct)) degs[degs.length - 1] = C.hang;   // a clause left hanging
    for (let i = 0; i < degs.length; i++){                 // no leap wider than the lilt allows
      const from = i ? degs[i - 1] : prevDeg;
      if (degs[i] - from > V.leap) degs[i] = from + V.leap; else if (from - degs[i] > V.leap) degs[i] = from - V.leap;
    }
    const vel = (small ? 0.38 : stress ? 0.62 : 0.5) + (exclaim ? 0.08 : 0);
    at[k] = t;
    lens.forEach((len, i) => {
      let L = len;
      if (i === lens.length - 1 && last) L = Math.max(L, 2);              // a sentence ends long
      if (i === lens.length - 1 && /…|\.\.\.|[—–]|--/.test(punct)) L += 2; // held
      out.notes.push({ t, dur: L * eighth, midi: pitch(degs[i]), vel: i ? vel * 0.85 : vel });
      rest(L);
    });
    prevDeg = degs.at(-1);
    if (w.marks.includes('/')) rest(2);
    if (metre){                                            // verse keeps the beat: no breath at a comma, and a line fills its foot
      if (k < words.length - 1 && (last || words[k + 1].br)) toBoundary(FOOT, 1);
    } else if (last && k < words.length - 1) toBoundary(2, 1);
    else if (/[;:]/.test(punct)) rest(2);
    else if (punct === ',') rest(1);
  }
  out.words = shown.map((w, i) => ({ text: w.text, t: at[of[i]], br: w.br }));
  out.length = t;
  return out;
}

// syllables, roughly: runs of vowels, less a silent final e, -es or -ed
export function syllables(w){
  if (!w) return 1;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && /[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n--;
  if (n > 1 && /[^aeiouy]es$/.test(w) && !/([sxzcg]|ch|sh)es$/.test(w)) n--;   // comes, names (not horses)
  if (n > 1 && /[^aeiouytd]ed$/.test(w)) n--;                                   // walked (not wanted)
  return Math.max(1, n);
}

function hash(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
