// lilt.js — how people sound and look when they speak (docs/lilts.md). Three separate things:
//
//   a lilt   the melody of someone's speech: scale, tempo, the shape of a phrase, how a sentence
//            lands. Cultural: it can be learned and imitated, so it holds nothing personal.
//   a form   how lines are composed: rhymed couplets, a haiku (js/verse.js). Cultural too.
//   a hand   the individual: their ink, their lettering, their instrument and pitch.
//
// Keeping them apart is what makes imitation show: Puck in someone else's lilt is still Puck's
// bell and Puck's green, carrying a foreign tune. Pure, so node can check it.

import { kinMark } from './kin-mark.js';

export const LILTS = {
  // Puck's: quick and bright on a major pentatonic. Every lilt is a shape that stretches over any
  // sentence, not a fixed tune: the sentence's arch, where it lands, and the long-short swing of
  // its feet when it's in metre.
  puck: {
    bpm: 180, scale: [0, 2, 4, 7, 9], span: [-3, 7],
    arch: { peak: 0.4, rise: 4, shortRise: 2, exclaim: 2 },   // scale steps above home, at `peak` through
    cadence: { fall: 0, hang: 2, questionUp: 2, questionMin: 4 },   // end of a sentence; a comma; a question
    leap: 4,                                                  // no jump wider than this many steps
    swing: [2, 1],                                            // eighths for a stressed, unstressed syllable
  },
};

// `hue` and `sat` are the ink (an inkOn() each surface, since no one colour reads on both);
// `font` is CSS; `kind` an instrument from instruments/instruments.json.
export const HANDS = {
  puck: { hue: 96, sat: 62, font: 'italic', kind: 'celesta', gain: 0.45, home: 'C', octave: 5 },
  claude: { hue: 262, sat: 58 },
};

// a household's hand, by its id. The ink stays in the family of the dye on the household's mark
// (js/kin-mark.js: umber, madder, indigo, soot), so what they say matches the mark on their pack; the
// three shades in each family spread the four dyes further.
const DYE_INKS = [
  [{ hue: 28, sat: 70 }, { hue: 38, sat: 72 }, { hue: 18, sat: 58 }],     // umber
  [{ hue: 4, sat: 68 }, { hue: 346, sat: 60 }, { hue: 14, sat: 76 }],     // madder
  [{ hue: 222, sat: 62 }, { hue: 204, sat: 66 }, { hue: 240, sat: 50 }],  // indigo
  [{ hue: 170, sat: 40 }, { hue: 285, sat: 34 }, { hue: 130, sat: 34 }],  // soot
];
export function householdHand(id){
  if (!Number.isFinite(id)) return null;
  id = Math.abs(id | 0);
  return DYE_INKS[kinMark(id).dye][id % 3];
}

// a hand by who it is: a name in HANDS, a hand itself, or anyone with a household
export function handOf(who){
  if (!who) return null;
  if (typeof who === 'string') return HANDS[who] || null;
  if (who.hand) return handOf(who.hand);
  return who.group ? householdHand(who.group.id) : null;
}

// the ink as CSS: dark on a bubble's paper, light on the dialog's dark panel
const SURFACE = { paper: 30, panel: 74 };
export function inkOn(hand, surface){
  if (!hand || hand.hue == null) return '';
  return `hsl(${hand.hue} ${hand.sat}% ${SURFACE[surface]}%)`;
}
