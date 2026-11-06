// making.js — making instruments (docs/music.md, "Making instruments"). Pure sim: what each
// instrument is made of, who knows how, the folk's store of materials, and teaching.
// main.js runs the player's side (the maker's books, the Crafts page, making one at once,
// teaching it); agents.js the folk's (fetching elder, making one at camp, giving it away).
//
//   A craft is learnt from a maker's book, one to a bookshelf, dealt round the whole shelves
//   with the kitchen books (stillroom.js shelfBook, shelfCraft here). Some instructions
//   want seasoned board and wire, which only the traders bring (js/traders.js).
//   Materials: elder stems, cut from the elder bushes (gen/flora.js); a hide and gut, off a
//   kill (agents.js Quarry: the hunter keeps them). The folk keep them in n.goods, apart
//   from food, which goes to the pot.
//   The folk: in a camp that plays, some grow up knowing how to make a pipe or a tabor (and
//   now and then someone in a camp that doesn't), by a hash of who they are, as tunes are
//   by household; anyone can be taught. A handy person has it in one lesson, the rest in two.
//   A maker makes one for themselves first, then for kin without one, then a spare to swap
//   with whoever they meet who has none (agents.js).

import { ingredient } from './ingredients.js';

// each craft by the instrument it makes (ingredients.js): its materials, its book, and how
// long the folk take over it (seconds of work at camp). Its page prints `about` and what it
// wants; or, where it has one, `verse` (lines kept as written), with the making itself
// written in the margin (`margin`) in a reader's hand
export const CRAFTS = {
  'tabor pipe': { needs: [['elder', 1]], work: 90, basic: true,
    book: "A pipe-maker's notes", about: 'A straight elder stem, the pith pushed out, three holes burnt through: two on top, one under for the thumb.' },
  tabor: { needs: [['elder', 1], ['hide', 1], ['gut', 1]], work: 150, basic: true,
    book: "A drum-maker's notes",
    verse: 'Knights and ladies in joyous wise,\nIn quaint attire, as of days gone by,\nPacing a measure soberly,\nTo sound of tabor and pipe they pass,\nMaking sweet music, across the grass.',
    margin: 'Take a hoop of green elder tree and lace over it a wet hide. Use gut of a beast for the snare.' },
  vielle: { needs: [['board', 2], ['gut', 3], ['beeswax', 1]], work: 300,
    book: "A fiddle-maker's book", about: 'A body cut and hollowed from a seasoned board, a belly glued on, three gut strings, and a bow waxed to bite.' },
  psaltery: { needs: [['board', 2], ['wire', 1]], work: 240,
    book: "A psaltery-maker's book", about: 'A shallow box of seasoned board, pins along both sides, and wire strung across it.' },
};
export const CRAFT_IDS = Object.keys(CRAFTS);
export const MATERIALS = [...new Set(CRAFT_IDS.flatMap(k => CRAFTS[k].needs.map(([m]) => m)))];

const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
const MAKERS = { musical: { 'tabor pipe': 0.35, tabor: 0.2 }, other: { 'tabor pipe': 0.08, tabor: 0.04 } };
const HANDY = 0.55;               // the share who learn a craft in one lesson

// ---- the folk's materials --------------------------------------------------------------
const goods = n => n.goods ??= {};
export const goodsOf = (n, k) => goods(n)[k] || 0;
export function addGoods(n, k, m = 1){ goods(n)[k] = goodsOf(n, k) + m; return m; }
export function takeGoods(n, k, m = 1){ const got = Math.min(goodsOf(n, k), m); goods(n)[k] = goodsOf(n, k) - got; if (!goods(n)[k]) delete goods(n)[k]; return got; }
// the first thing still wanted for craft `kind` (the material's name), or null if all's to hand
export const missingFor = (n, kind) => CRAFTS[kind].needs.find(([m, k]) => goodsOf(n, m) < k)?.[0] ?? null;

// ---- knowing a craft ----------------------------------------------------------------------
// `musical`: whether their camp plays (music-sim.js instrumentOf's hash, passed in so this
// stays free of it)
export function craftsOf(n, musical){
  if (n.crafts) return n.crafts;
  n.crafts = new Map();
  const who = 'n' + n.id + '|' + (n.name || '');
  if (!n.home) for (const [k, p] of Object.entries(MAKERS[musical ? 'musical' : 'other'])) if (hash01(who, 'make:' + k) < p) n.crafts.set(k, 2);
  return n.crafts;
}
export const knowsCraft = (n, kind, musical) => (craftsOf(n, musical).get(kind) || 0) >= 2;
export const handyOf = n => hash01('n' + n.id + '|' + (n.name || ''), 'handy') < HANDY;
// a lesson: shown how, with the thing made in front of them. Lessons are counted in halves:
// a handy person takes it all in at once, anyone else in two
export function teachCraft(n, kind, musical){
  const C = craftsOf(n, musical), had = C.get(kind) || 0;
  C.set(kind, Math.min(2, had + (handyOf(n) ? 2 : 1)));
  return { had: had >= 2, got: C.get(kind) >= 2, handy: handyOf(n) };
}

// ---- the player's side (main.js): the materials in a pack ({ counts }) ------------------
export const canMake = (pack, kind) => CRAFTS[kind].needs.every(([m, k]) => (pack.counts[m] || 0) >= k);
export const needsText = kind => CRAFTS[kind].needs.map(([m, k]) => `${k > 1 ? k + ' ' : ''}${ingredient(m)?.label || m}`).join(', ');
