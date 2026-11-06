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

import { FOOD_GROUP, CROP_KINDS, WORTHS, TRINKETS, INGREDIENTS } from './ingredients.js';

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

// What the road's goods are worth to whoever might use them (docs/economy.md). Not by diet: a household wants
// salt for its harvest and a blade if its own's worn out; a maker wants wire and board if their craft calls for
// them. `use` is how much they'd have a use for it, 0..1, from agents.js; held halves it as for anything.
export const ROAD_GOODS = new Set(['salt', 'iron', 'wire', 'board']);
export const useWorth = (n, kind, use, held) => (WORTH[kind] ?? 0.6) * taste(n, kind) * (0.1 + use) / (1 + held / HELD_SOFT);
export const baseWorth = kind => isCraft(kind) ? CRAFT.BASE : WORTH[kind] ?? 0.6;

// Village crafts (docs/economy.md). A style is a design, an arrangement and a medium, kept apart so each can grow:
// more designs, ways of laying them out, ways of working them. For now the designs are Wagara's patterns (the Lea's
// baked copy, js/kin-mark.js; `design` is an index, js/craft-view.js draws it) and each settlement has one style of its own. A person wants what they haven't got: another of the same
// style is worth far less, and your own village's is everyday stuff to you. So a piece is worth most far from home.
export const CRAFT = { BASE: 2.2, HELD: 1, OWN: 0.35, RATE: 0.2, STORE: 3 };
export const MEDIA = { embroidery: { label: 'embroidery', look: 'stitched in thread' }, beadwork: { label: 'bead-work', look: 'worked in beads' } };
const DYES = [['#27406b', '#e3d8bf'], ['#9c3a2e', '#e8dcc4'], ['#e3d8bf', '#27406b'], ['#c9a23a', '#3b3a32'], ['#5a3f2a', '#dcc9a3'], ['#56663a', '#e3d8bf']];
export const isCraft = kind => typeof kind === 'string' && kind.startsWith('craft-');
// each settlement's style: from where the settlement is, so it's the same every time and takes nothing from the rng
export function craftStyles(places){
  if (!places.length) return [];
  const off = Math.floor(hash01(`${Math.round(places[0].x)},${Math.round(places[0].z)}`) * 1000);
  return places.map((p, i) => {
    const media = Object.keys(MEDIA), medium = media[(off + i) % media.length], [ink, ground] = DYES[(off + i * 5) % DYES.length];
    const kind = `craft-${i}`, s = { kind, place: i, design: off + i * 5, arrange: 'allover', medium, ink, ground };
    INGREDIENTS[kind] = { label: `${MEDIA[medium].label}`, group: 'craft', worth: CRAFT.BASE, keep: 3650, from: `place ${i}`, color: ink, size: [1, 1], stack: 4, style: s,
      look: [MEDIA[medium].label, `A patterned piece, ${MEDIA[medium].look}.`] };
    return s;
  });
}
// a place's name, once the world's named them: this is how you tell one village's work from another's
export function nameCraft(style, name, design){
  const e = INGREDIENTS[style.kind], word = MEDIA[style.medium].label;
  e.label = `${name} ${word}`; e.from = name; e.look = [e.label, `A ${design} pattern, ${MEDIA[style.medium].look}.`];
}
export function craftWorth(n, kind, held, own){
  const eye = 0.4 + 0.6 * (n.persona?.beauty ?? 1);
  return CRAFT.BASE * taste(n, kind) * eye * (own ? CRAFT.OWN : 1) / (1 + held / CRAFT.HELD);
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

// How each crop is kept (docs/farming.md). family: its place in the rotation. support: what it must
// climb, without which it stops at its shoots. rate: how fast it comes on. yield: how much it brings
// in. soil: what a crop does to the ground: pulses put back, cabbages take the most.
export const HUSBANDRY = {
  beans:    { family: 'pulse',  support: 'trellis', rate: 0.9,  yield: 1.0,  soil: 0.3 },
  peas:     { family: 'pulse',  support: 'sticks',  rate: 1.15, yield: 0.8,  soil: 0.25 },
  cabbages: { family: 'leaf',   support: null,      rate: 0.85, yield: 1.2,  soil: -0.3 },
  leeks:    { family: 'allium', support: null,      rate: 0.8,  yield: 1.0,  soil: -0.15 },
  onions:   { family: 'allium', support: null,      rate: 0.9,  yield: 0.95, soil: -0.15 },
  turnips:  { family: 'root',   support: null,      rate: 1.2,  yield: 1.05, soil: -0.1 },
  parsnips: { family: 'root',   support: null,      rate: 0.85, yield: 1.0,  soil: -0.1 },
};
const ROTATION = ['pulse', 'leaf', 'allium', 'root'];
// What follows a crop on the same ground: the next family, and which of it by where the field lies.
export function nextCrop(crop, x, z, turn){
  const fam = ROTATION[(ROTATION.indexOf(HUSBANDRY[crop].family) + 1) % ROTATION.length];
  const opts = Object.keys(HUSBANDRY).filter(k => HUSBANDRY[k].family === fam);
  return opts[(Math.abs(Math.round(x) * 31 + Math.round(z)) + turn) % opts.length];
}

// the valuables (flora.js), worth the same as a trinket
export const VALUABLES = new Set(TRINKETS);   // (ingredients.js; gold is found deep under the Lea, docs/under.md)

// a field's crop, fixed by where it lies (so one seed grows the same crofts)
export function cropAt(x, z){
  let h = 2166136261 >>> 0;
  for (const c of `${Math.round(x)},${Math.round(z)}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return CROPS[h % CROPS.length];
}
