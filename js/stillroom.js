// stillroom.js — preparations past the kitchen: the still-room tier (docs/magic.md "The
// craft as a ladder of rooms"). Each is made by someone who knows the craft (not a cook
// at a pot), wants its ingredients gathered *rightly* (a test on each one's provenance,
// js/provenance.js), and may want the sky to be right too. Their books are on the crypts'
// shelves beside the kitchen books (shelfBook). Pure data; main.js runs the talk.
//
// The first is the fairy salve (docs/texts/magic-traditions.md §4): an ointment for the
// eye that shows what's already in the Lea under glamour. A stargazer makes it, at the
// new moon, of a four-leaf clover picked at dawn in a fairy ring, foxfire, and beeswax.

import { BOOK_RECIPES } from './recipes.js';
import { isDawn } from './provenance.js';
import { FAERIE_BOOK_IDS } from './faerie-books.js';

const dawn = p => !!p && isDawn(p.hour);
const inRing = p => !!p && (p.thin || []).includes('fairy ring');

export const PREPARATIONS = {
  'fairy salve': {
    maker: 'stargazer', moon: 'new',
    intro: "Of the green salve for the eye, by which the midwife saw the Gentry as they are.",
    wants: [
      { kind: 'four-leaf clover', n: 1, test: p => dawn(p) && inRing(p), say: 'a leaf of four, picked at first light within a fairy ring', wrong: "That clover wasn't picked at first light in a ring. It won't take." },
      { kind: 'foxfire', n: 2, say: 'two caps of the shining foxfire' },
      { kind: 'beeswax', n: 1, say: 'a lump of beeswax, to bind it' },
    ],
    method: 'at the dark of the moon, let one who reads the stars melt the wax and work in the leaf and the caps',
    use: 'Touch it to one eye, after dark, where the Gentry gather: a fairy ring, a stone circle, a sacred tree.',
  },
};
export const PREP_IDS = Object.keys(PREPARATIONS);

// which book a shelf holds, or null (gen/under.js shelves(): `room`, `state`, `book` its deal
// number). A whole shelf holds a kitchen book, dealt round by number. The chapter house
// was where the learned books were kept, in cases: a mouldy shelf there (state 'ruined')
// has lost its others but still holds a still-room book, dry in its case.
// A Faerie palace's shelves (gen/under.js, `palace`) are all whole, and hold the Gentry's
// own library (faerie-books.js), dealt round across the palaces by number.
export function shelfBook(sh){
  if (sh.palace) return FAERIE_BOOK_IDS[sh.book % FAERIE_BOOK_IDS.length];
  if (sh.state === 'book') return BOOK_RECIPES[sh.book % BOOK_RECIPES.length];
  if (sh.state === 'ruined' && sh.room === 'chapterhouse') return PREP_IDS[Math.abs(sh.seed | 0) % PREP_IDS.length];
  return null;
}

// what you carry of each want, rightly got: [{ want, have, rightly }] (pack: makePack)
export function wantsMet(pack, id){
  return PREPARATIONS[id].wants.map(w => {
    const have = pack.counts[w.kind] || 0, rightly = w.test ? pack.countWhere(w.kind, w.test) : have;
    return { want: w, have, rightly, ok: rightly >= w.n };
  });
}
// days (Lea days, fractional) until the moon is next new, from the sun's and moon's
// ecliptic longitudes (sky.js): the moon gains on the sun once a synodic month
export function daysToNewMoon(moonLon, sunLon, yearDays = 360){
  const gain = 2 * Math.PI / 27.32 - 2 * Math.PI / yearDays;   // radians a day
  const elong = (((moonLon - sunLon) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return (2 * Math.PI - elong) / gain;
}
export const NEW_MOON = 0.06;   // illuminated fraction below which it's the new moon (astrology.js phaseName)
