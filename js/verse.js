// verse.js — saying something in verse, worked out as it's said (docs/lilts.md).
//
// A grammar is substitutions within substitutions. To say "take the road east" in a line of a
// given metre that ends on a given rhyme, every word can be swapped for another way of putting it,
// and every one of those swapped again ("take" for "go by", "east" for "toward the rising sun",
// "toward" for "facing"). compose() walks those choices, abandoning a branch the moment it breaks
// the metre, and keeps going until it holds lines that scan and rhyme. Nothing finished is stored.
//
//   grammar   { rule: ['a way of saying it', 'with a {nested} rule, or a {slot} from ctx', ...] }
//   ctx       { slot: 'the name of a rule' | 'plain words' | ['plain words', 'or a shorter way'] }
//             (a later alternative in a list costs a little, so it's used when it's needed), or
//             a list of these, one a line
//   form      { lines: [{ meter: ['SwSwSwS'] | syllables: 5, rhyme: 'a' }], ends: [',', '.'] }
//
// compose(form, ['rule for line 1', 'rule for line 2'], ctx, grammar) gives
//   { text, clean, lines: [...] }  or null if nothing fits (the caller says it in prose instead).
// `text` carries each word's metre as a hidden {m:Sw} mark for speech-score.js, which sets the
// beat from it; `clean` is what it looks like on the page.
//
// How a word sounds comes from js/gen/lexicon.js (CMUdict, trimmed to the grammars' words by
// tools/build-lexicon.mjs). The Lea's made-up names aren't in it, so a word it doesn't know is
// read by rule: vowel runs for syllables, and the stress first, which is how gen/places.js makes
// them. Such a word has no known rhyme, so it can't end a rhyming line.

import { LEXICON } from './gen/lexicon.js';
import { syllables } from './speech-score.js';

// little words that take the beat only if they have to; the first set never can
const NEVER_STRESSED = new Set(['the', 'a', 'an']);
const LIGHT = new Set(('of to in on at by for with from as is it its be was are and or but so if not no nor ' +
  'i me my you your he him his she her we us our they them their that this these those who whom which what ' +
  'will shall can could would should may might must do does did have has had am were than then there here ' +
  'through up down off out over into where when while how all one some').split(' '));
const COST_LIGHT_ON_BEAT = 0.5, COST_HEAVY_OFF_BEAT = 1, COST_SHORTER = 0.3, MAX_COST = 2;
const SEARCH_LIMIT = 20000, POOL = 600;

const bare = w => w.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');

// { stress: '10' (a digit a syllable: 1 main, 2 secondary, 0 none), rhyme: 'IY S T' | null, known }
const SOUNDS = new Map();
export function sound(word){
  const w = bare(word);
  let s = SOUNDS.get(w);
  if (s) return s;
  const ph = LEXICON[w]?.split(' ');
  if (ph){
    const stress = ph.filter(p => /\d/.test(p)).map(p => p.at(-1)).join('');
    let from = ph.findLastIndex(p => /[12]$/.test(p));
    if (from < 0) from = ph.findLastIndex(p => /\d/.test(p));
    const rhyme = ph.slice(from).map(p => p.replace(/\d/, '')).join(' ');
    let start = from;                                  // the consonants leading into that vowel
    while (start > 0 && !/\d/.test(ph[start - 1])) start--;
    s = { stress, rhyme, onset: ph.slice(start, from).join(' '), known: true };
  } else {                                             // a made-up name
    const parts = w.split('-').filter(Boolean), n = parts.reduce((a, p) => a + syllables(p.replace(/'s$/, '')), 0) || 1;
    s = { stress: '1' + '0'.repeat(n - 1), rhyme: null, onset: null, known: false };
  }
  SOUNDS.set(w, s);
  return s;
}

// do these two words truly rhyme? The same sound from the last stress on, and not the same word
// in disguise: "day" and "lackaday", "way" and "away", "know" and "no" all have the same consonant
// leading in, so they're a word rhymed with itself; so is one that ends in the other ("east",
// "northeast"), whatever leads in.
export function rhymes(a, b){
  const x = bare(a), y = bare(b), sx = sound(x), sy = sound(y);
  if (!sx.rhyme || sx.rhyme !== sy.rhyme) return false;
  if (sx.stress.at(-1) === '0' || sy.stress.at(-1) === '0') return false;
  if (sx.onset === sy.onset) return false;
  return !x.endsWith(y) && !y.endsWith(x);
}

// does this word fit the pattern at pos? its marks ('Sw'), and what it costs in awkwardness, or null
function fit(word, pattern, pos){
  const { stress } = sound(word), n = stress.length, w = bare(word);
  if (pos + n > pattern.length) return null;
  const slice = pattern.slice(pos, pos + n);
  if (n === 1){
    if (slice === 'S'){
      if (NEVER_STRESSED.has(w)) return null;
      return { marks: slice, cost: LIGHT.has(w) || stress === '0' ? COST_LIGHT_ON_BEAT : 0 };
    }
    return { marks: slice, cost: LIGHT.has(w) || NEVER_STRESSED.has(w) || stress === '0' ? 0 : COST_HEAVY_OFF_BEAT };
  }
  for (let i = 0; i < n; i++){
    if (stress[i] === '1' && slice[i] !== 'S') return null;
    if (stress[i] === '0' && slice[i] !== 'w') return null;
  }
  return { marks: slice, cost: 0 };
}

const TOKEN = /\{([\w:-]+)\}|([^\s{}]+)/g;
function tokens(text, via = []){
  const out = [];
  for (const m of text.matchAll(TOKEN)) out.push(m[1] ? { slot: m[1], via } : { word: m[2], via });
  return out;
}
function shuffled(a, rng){
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--){ const j = (rng() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// every way the rule comes out that fits the line, up to the limits: [{ words: [{ word, marks }], cost, rhyme, last }]
function linesOf(rule, line, ctx, grammar, rng){
  const out = [];
  let budget = SEARCH_LIMIT;
  const patterns = line.meter || [null];
  for (const pattern of patterns){
    const walk = (todo, pos, count, cost, words) => {
      if (out.length >= POOL || budget-- <= 0) return;
      if (!todo.length){
        if (pattern ? pos !== pattern.length : count !== line.syllables) return;
        const last = words.at(-1), s = sound(last.word);
        if (line.rhyme && (!s.rhyme || s.stress.at(-1) === '0')) return;     // a rhyme needs a known, stressed end
        if (saysNameTwice(words)) return;
        out.push({ words, cost, rhyme: s.rhyme, last: bare(last.word), pattern, short: words.some(w => w.short) ? 1 : 0 });
        return;
      }
      const [t, ...rest] = todo;
      if (t.slot){
        const v = ctx[t.slot] ?? t.slot;
        if (Array.isArray(v)){                                               // ways of saying it, best first
          const named = { slot: t.slot };                                    // one filling-in of this slot, however many words
          v.forEach((alt, q) => walk([...tokens(alt, t.via).map(x => ({ ...x, named, short: q > 0 })), ...rest], pos, count, cost + q * COST_SHORTER, words));
          return;
        }
        const alts = grammar[v];
        if (!alts){ const named = { slot: t.slot }; return walk([...tokens(String(v), t.via).map(x => ({ ...x, named })), ...rest], pos, count, cost, words); }    // plain words from ctx
        for (const alt of shuffled(alts, rng)) walk([...tokens(alt, [...t.via, { rule: v, alt }]), ...rest], pos, count, cost, words);
        return;
      }
      if (/^[^A-Za-z]+$/.test(t.word)){                                      // loose punctuation joins the word before
        if (!words.length) return;
        const before = words.slice(); before[before.length - 1] = { ...before.at(-1), word: before.at(-1).word + t.word };
        return walk(rest, pos, count, cost, before);
      }
      if (pattern){
        const f = fit(t.word, pattern, pos);
        if (!f || cost + f.cost > MAX_COST) return;
        walk(rest, pos + f.marks.length, count + f.marks.length, cost + f.cost, [...words, { word: t.word, marks: f.marks, via: t.via, short: t.short, named: t.named }]);
      } else {
        const n = sound(t.word).stress.length;
        if (count + n > line.syllables) return;
        walk(rest, pos + n, count + n, cost, [...words, { word: t.word, marks: 'w'.repeat(n), via: t.via }]);
      }
    };
    walk([{ slot: rule, via: [] }], 0, 0, 0, []);
  }
  return out;
}

// a line that says a word of the name over again: "Besfield Farm, a farm", "the Citock Caves, a
// cave", "an old ruin, Old Tower". A shorter form of the name can usually say it properly.
function saysNameTwice(words){
  const stem = w => bare(w.word).replace(/s$/, '');
  const named = new Set(words.filter(w => w.named).map(stem).filter(w => !LIGHT.has(w) && !NEVER_STRESSED.has(w)));
  return words.some(w => !w.named && named.has(stem(w)));
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function render(line, end){
  const ws = line.words.map(w => w.word), lastW = ws.at(-1);
  if (end && !/[.!?,;:]$/.test(lastW)) ws[ws.length - 1] = lastW + end;
  ws[0] = cap(ws[0]);
  return { marked: ws.map((w, i) => `{m:${line.words[i].marks}}${w}`).join(' '), clean: ws.join(' '),
    parts: ws.map((w, i) => ({ word: w, marks: line.words[i].marks, via: line.words[i].via, named: line.words[i].named })) };
}

// What someone has said lately, so they don't repeat themselves: whole lines, and the last few
// rhyme sounds (long enough to cover a whole screen, so no sound comes twice in one speech).
export function makeMemory(rhymeSpan = 12){
  const lines = new Set(), rhymes = [], shapes = new Map();
  let clock = 0;
  return {
    saidLine: l => lines.has(l), saidRhyme: r => rhymes.includes(r),
    shapeAge: k => shapes.get(k) ?? -1, noteShape: k => shapes.set(k, ++clock),
    note(words, rhyme){
      for (const l of words) lines.add(l);
      if (lines.size > 80) lines.clear();
      if (rhyme){ rhymes.push(rhyme); if (rhymes.length > rhymeSpan) rhymes.shift(); }
    },
  };
}

// rules: one per line of the form. memory: from makeMemory, read and added to. `only` narrows what
// will do: 'fresh', a rhyme sound not lately said; 'full', that and every name in full
export function compose(form, rules, ctx, grammar, { rng = Math.random, memory = null, only = null } = {}){
  const L = form.lines;
  const said = l => l.words.map(w => bare(w.word)).join(' ');
  const pools = L.map((line, i) => linesOf(rules[i], line, Array.isArray(ctx) ? ctx[i] : ctx, grammar, rng));
  if (pools.some(p => !p.length)) return null;
  // Every rhyme sound gets an equal chance, however many lines end on it: otherwise the search
  // settles on the few sounds with the most lines, and the smoothest of those. A fresh draw each time.
  const draw = new Map();
  const drawOf = r => { if (!draw.has(r)) draw.set(r, rng()); return draw.get(r); };
  const chosen = [];
  const pick = (i, from, dead) => {
    if (i === L.length) return true;
    const mate = L[i].rhyme ? L.findIndex((x, j) => j < i && x.rhyme === L[i].rhyme) : -1;
    let cands = from[i];
    if (mate >= 0) cands = cands.filter(l => rhymes(l.last, chosen[mate].last));
    if (!cands.length) return false;
    // a name in full if at all possible, then in steps of awkwardness, then by the draw; the same
    // line shape as the first if possible
    const rank = l => Math.floor(l.cost + (i && l.pattern !== chosen[0].pattern ? 0.5 : 0));
    const ranked = cands.slice().sort((a, b) => a.short - b.short || rank(a) - rank(b) || drawOf(a.rhyme) - drawOf(b.rhyme));
    for (const c of ranked){
      if (mate < 0 && dead.has(c.last)) continue;      // a word already found to have no partner
      chosen[i] = c;
      if (pick(i + 1, from, dead)) return true;
      if (mate < 0) dead.add(c.last);
    }
    return false;
  };
  // the best that will do: nothing lately said, then a repeated line but a new sound, then a new
  // line on an old sound, then anything. Repeating is better than falling back to prose.
  const freshLine = l => !memory?.saidLine(said(l));
  const freshRhyme = (l, i) => !L[i].rhyme || !memory?.saidRhyme(l.rhyme);
  const full = l => only !== 'full' || !l.short;
  const tiers = only ? [(l, i) => full(l) && freshLine(l) && freshRhyme(l, i), (l, i) => full(l) && freshRhyme(l, i)]
    : memory ? [(l, i) => freshLine(l) && freshRhyme(l, i), freshRhyme, freshLine, () => true] : [() => true];
  if (!tiers.some(ok => { const from = pools.map((p, i) => p.filter(l => ok(l, i))); return from.every(p => p.length) && pick(0, from, new Set()); })) return null;
  const out = chosen.map((l, i) => render(l, form.ends?.[i]));
  memory?.note(chosen.map(said), chosen.find((_, i) => L[i].rhyme)?.rhyme);
  const v = { text: out.map(o => o.marked).join('\n'), clean: out.map(o => o.clean).join('\n'), lines: out.map(o => o.clean),
    marked: out.map(o => o.marked), parts: out.map(o => o.parts), rules };
  onCompose?.(v);
  return v;
}

// The same thing can be put in several shapes: name then direction, direction then name, one
// sentence across the break. `shapes` are lists of rules, as for compose(), and none is preferred.
// The one least lately used comes first, so a speech doesn't march through one pattern, but a fresh
// rhyme and a name in full both matter more than a fresh shape. A shape is remembered by its place in
// the list, not its rules: "ruin, then direction" and "tomb, then direction" are one pattern to the ear.
export function composeShaped(form, shapes, ctx, grammar, { rng = Math.random, memory = null, family = '' } = {}){
  const key = s => family + ':' + shapes.indexOf(s);
  const age = s => memory?.shapeAge(key(s)) ?? -1;
  const order = shuffled(shapes, rng).sort((a, b) => age(a) - age(b));
  for (const only of ['full', 'fresh', null]) for (const s of order){
    const v = compose(form, s, ctx, grammar, { rng, memory, only });
    if (v){ memory?.noteShape(key(s)); return v; }
  }
  return null;
}

// a listener for everything composed, so the verse tool can trace a line said by the real guide
// code back to the rules behind it
let onCompose = null;
export const setComposeListener = fn => { onCompose = fn; };

// how a line of a grammar reads on its own, for the tool: the ways it fits this line of the form
export const fits = (text, line, ctx, grammar, rng = Math.random) => {
  const G = { ...grammar, '__line': [text] };
  return linesOf('__line', line, ctx, G, rng);
};
// a word's sound learned while editing (the lexicon is trimmed to what was saved)
export function learn(word, phones){ const w = bare(word); LEXICON[w] = phones; SOUNDS.delete(w); }
