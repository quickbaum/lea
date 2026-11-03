// folk-deal.js — who wears which character from the villagers' pool (js/folk-pool.js). No browser
// and no three.js, so tools/check-folk-pool.mjs can test it directly.

export const genderOf = n => /^female/.test(n.slug || '') ? 'f' : 'm';
export const ageOf = n => n.role === 'elder' ? 'elder' : n.role === 'child' ? 'child' : 'adult';
// who stands in if a group of the pool is empty: nobody ever changes gender, and an age does
const NEXT_AGE = { child: ['child', 'adult', 'elder'], adult: ['adult', 'elder', 'child'], elder: ['elder', 'adult', 'child'] };

function hash(s){ let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function shuffled(list, seed){
  const a = [...list]; let st = seed | 0;
  const r = () => { st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// npc → pool character. Each group of the pool is dealt round in a shuffled order, so nobody
// repeats until that group has run out, and a household never wears the same person twice if
// the group can help it.
export function assignPool(npcs, folk, worldSeed){
  const decks = new Map();
  for (const f of folk){ const k = `${f.gender}-${f.age}`; if (!decks.has(k)) decks.set(k, []); decks.get(k).push(f); }
  for (const [k, list] of decks) decks.set(k, { cards: shuffled(list, hash(`${worldSeed}|${k}`)), next: 0 });
  const out = new Map(), inGroup = new Map();
  for (const n of npcs){
    const g = genderOf(n), deck = NEXT_AGE[ageOf(n)].map(a => decks.get(`${g}-${a}`)).find(Boolean);
    if (!deck) continue;                           // nobody of this gender: they keep their painted sheet
    const worn = n.group ? (inGroup.get(n.group) ?? inGroup.set(n.group, new Set()).get(n.group)) : null;
    let card = null;
    for (let t = 0; t < deck.cards.length; t++){
      const c = deck.cards[(deck.next + t) % deck.cards.length];
      if (!worn?.has(c.id)){ card = c; deck.next += t + 1; break; }
    }
    if (!card){ card = deck.cards[deck.next % deck.cards.length]; deck.next++; }
    worn?.add(card.id);
    out.set(n, card);
  }
  return out;
}
