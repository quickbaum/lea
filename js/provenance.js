// provenance.js — where, how and under what conditions a thing in your pack was got.
// Every unit the player gathers, finds, catches, trades for or is given carries one
// (pack.js keeps them as lots within a box), so a rite can later ask for vervain picked
// at dawn, salt from the deep, a cap taken inside a fairy ring at the new moon, or a
// gatherer who was fasting (docs/texts/magic-traditions.md §2, docs/magic.md
// "Gathering as a rite"). Pure data and words; main.js fills it from the live world.
//
//   t        when (days, agents.time) and hour (0..24)
//   moon     { illum 0..1, waxing, house } and sunHouse: the real sky (sky.js, astrology.js)
//   rain, cloud   the weather, 0..1
//   x, z, place   where; under: the level's name if it was underground; ground: terrain type
//   thin     the thin places it was got at or in: 'fairy ring', 'sacred tree',
//            'stone circle', 'barrow', 'the deep'
//   how      'picked' | 'found' | 'fished' | 'traded' | 'given'; from: who, for the last two
//   fasting  hours since you last ate (Lea hours), or null if you never have
// Not recorded yet, for want of anything in the game to say it: what tool you used (iron
// or none), your hands, whether you looked back.

import { phaseName } from './astrology.js';

export const THIN_R = 9;   // how near a thin place counts as at it

// first light, in hours: the four-leaf clover shows, and is picked "at dawn" (stillroom.js)
export const DAWN = [4, 7.5];
export const isDawn = h => h >= DAWN[0] && h < DAWN[1];
export function hourWord(h){
  if (h < DAWN[0] || h >= 22) return 'in the dead of night';
  if (h < DAWN[1]) return 'at dawn';
  if (h < 11) return 'in the morning';
  if (h < 13) return 'at midday';
  if (h < 17) return 'in the afternoon';
  if (h < 19) return 'at dusk';
  return 'at nightfall';
}
const HOW = { picked: 'Picked', found: 'Found', fished: 'Caught', traded: 'Traded for', given: 'Given you' };
const FROM = { traded: 'with', given: 'by' };   // "Traded for with Tam", "Given you by Tam"
const THIN_AT = { 'fairy ring': 'inside a fairy ring', 'sacred tree': 'under a sacred tree', 'stone circle': 'within a stone circle', barrow: 'by a barrow', 'the deep': 'in the deep' };

// one line, as the pack shows it: "Picked at dawn on Tackey Marsh, inside a fairy ring,
// under a waning crescent moon in the House of the Stag, in the rain. You were fasting."
export function describe(p){
  if (!p) return 'Where it came from, nobody knows.';
  const parts = [`${HOW[p.how] || 'Got'}${p.from ? ` ${FROM[p.how] || 'from'} ${p.from}` : ''} ${hourWord(p.hour)}`];
  if (p.under) parts[0] += ` in ${p.under}`;
  else if (p.place) parts[0] += ` ${p.place}`;
  for (const k of p.thin || []) parts.push(THIN_AT[k] || k);
  if (p.moon && !p.under) parts.push(`under a ${phaseName(p.moon.illum, p.moon.waxing)} in the House of the ${p.moon.house}`);
  if (!p.under && p.rain > 0.3) parts.push('in the rain');
  let s = parts.join(', ') + '.';
  if (p.fasting == null || p.fasting >= 12) s += ' You were fasting.';
  return s;
}
// are two provenances the same gathering? (one pick, one find: then they share a lot)
export const sameLot = (a, b) => a === b || (!!a && !!b && a.t === b.t && a.x === b.x && a.z === b.z && a.how === b.how);
