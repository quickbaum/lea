// trade.js — what the folk and the villagers swap, and at what rate. Pure sim,
// no rendering. Design and sources: docs/trade.md.
//
// The two peoples live off different land. The villagers grow garden crops in
// the crofts behind their houses and have no time to range for wild food; the
// folk range the wild for nuts, fungi, fruit, roots and meat, and grow nothing.
// Each comes to miss what only the other has. That want, not a price list, is
// what drives trade: it's the forager–farmer exchange anthropologists describe
// (the Mbuti and their villager partners in the Ituri, the Agta and Ilocano
// rice farmers), where meat and forest foods go one way and garden food the
// other, between households who come back to the same partners.
//
//   diet     — when a person last ate each food group (ate / lack)
//   worth    — what one more of a thing is worth to someone, now: its base worth,
//              scaled by how much they lack its group, and less for every one
//              they already hold
//   strike   — two people's worths for what each can offer → the best swap both
//              gain from, or null. No set prices: the rate lands between what
//              the buyer must get and what the seller will give.

import { FOOD_GROUP, CROP_KINDS, WORTHS, TRINKETS } from './ingredients.js';

export const CROPS = CROP_KINDS;          // (ingredients.js, in its order: cropAt indexes it)
const CROP = new Set(CROPS);

// food groups; a person misses a group they haven't eaten in a while (fish and
// eels are one: docs/fishing.md). ingredients.js `group`.
const GROUP = FOOD_GROUP;
export const groupOf = kind => CROP.has(kind) ? 'garden' : GROUP[kind] || null;
export const isCrop = kind => CROP.has(kind);
export const isWild = kind => !!GROUP[kind];

const VARIETY_DAYS = 1.5;    // days without a group for the want of it to come back in full
const HELD_SOFT    = 3;      // each this many already held halves what one more is worth
const TRINKET_WANT = 0.7;    // a pretty thing is wanted steadily, not by diet

// base worth of one unit (ingredients.js `worth`). Meat and morels are prized, acorns
// barely worth the leaching; onions and beans keep and flavour everything, turnips are plenty.
const WORTH = { ...WORTHS, trinket: 1.8 };

export function ate(n, kind, now){
  const g = groupOf(kind);
  if (g) (n._diet || (n._diet = {}))[g] = now;
}
// how much a person misses a food group, 0 (just had it) .. 1
export function lack(n, g, now){
  const t = n._diet && n._diet[g];
  return t == null ? 1 : Math.min(1, Math.max(0, (now - t) / VARIETY_DAYS));
}
// a household's own taste for a food, 0.7..1.3, the same for all of them: one
// village prizes morels, another hazelnuts (so they ask for different things)
const hash01 = s => { let h = 2166136261 >>> 0; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
const taste = (n, kind) => 0.7 + 0.6 * hash01(`${n.group ? 'g' + n.group.id : 'n' + n.id}|${kind}`);
export function worth(n, kind, held, now){
  const g = groupOf(kind);
  const want = kind === 'trinket' ? TRINKET_WANT : g ? lack(n, g, now) : 0.4;
  return (WORTH[kind] ?? 0.6) * taste(n, kind) * (0.3 + want) / (1 + held / HELD_SOFT);
}

// The haggle. `offers` are what the buyer can give, `wants` what the seller can:
// each { kind, have, a, b } where a and b are its worth to buyer and seller.
// Tries every pairing and every count up to the caps, and keeps the swap whose
// smaller side's gain is largest — a deal both walk away glad of, rather than
// one that fleeces either. Returns { give, gn, get, qn, gainA, gainB } or null.
export function strike(offers, wants, maxGive = 3, maxGet = 6){
  let best = null, bv = 0;
  for (const o of offers) for (const w of wants){
    if (o.kind === w.kind) continue;
    for (let gn = 1; gn <= Math.min(o.have, maxGive); gn++)
      for (let qn = 1; qn <= Math.min(w.have, maxGet); qn++){
        const gainA = qn * w.a - gn * o.a, gainB = gn * o.b - qn * w.b;
        const v = Math.min(gainA, gainB);
        if (gainA > 0 && gainB > 0 && v > bv){ bv = v; best = { give: o.kind, gn, get: w.kind, qn, gainA, gainB }; }
      }
  }
  return best;
}

// The two ends of the haggle over a struck deal, as said aloud: the buyer's bid
// (the most crops the seller would still gain from) and the seller's counter
// (the fewest the buyer would still gain from). The deal itself lies between.
export function ends(o, w, d){
  let bid = d.qn, ask = d.qn;
  while (bid < w.have && d.gn * o.b - (bid + 1) * w.b > 0) bid++;
  while (ask > 1 && (ask - 1) * w.a - d.gn * o.a > 0) ask--;
  return { bid, ask };
}

// the wild food a person would pay most for right now — what a household says
// it's short of ("Bring meat next time")
export const WILD = ['meat', 'eels', 'fish', 'morels', 'mushrooms', 'hazelnuts', 'roots', 'berries', 'apples', 'cattail root', 'acorns'];
export function wishOf(n, held, now){
  let best = null, bv = 0;
  for (const k of WILD){ const v = worth(n, k, held(k), now); if (v > bv){ bv = v; best = k; } }
  return best;
}

// the valuables (flora.js), worth the same as a trinket
export const VALUABLES = new Set(TRINKETS);   // (ingredients.js; gold is found deep under the Lea, docs/under.md)

// a field's crop, fixed by where it lies (so one seed grows the same crofts)
export function cropAt(x, z){
  let h = 2166136261 >>> 0;
  for (const c of `${Math.round(x)},${Math.round(z)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return CROPS[h % CROPS.length];
}
