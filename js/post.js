// post.js — the post of the Lea: realms, the stamps they issue, what a letter owes, and the
// letters themselves. Pure data, no rendering and no world: main.js says where people are.
// Design: docs/letters.md. Drawn by js/stamp-view.js.
//
//   makePost({ seed, realms })   realms: [{ id, name, kind: 'green' | 'foreign' | 'faerie' | 'old', x, z }]   (old: a crypt's, a fixed stock that's never reprinted)
//   post.legs(from, to)          who charges for what: [{ realm, dist, crossing }]
//   post.fare(leg, weight)       what one leg owes, in that realm's stamps
//   post.frank(legs, weight)     stamps taken from stock to pay them: [{ issue, copy, realm, value }]
//   post.send({ from, to, ... }) a letter, franked; null if a realm can't pay its leg
//
// A person is { id, name, realm, x, z }, whoever they are: a villager, one of the fae. Nothing
// here may assume Faerie holds only one of them (it will be peopled like the Lea).

import { mulberry32 } from './rng.js';

// weight in ounces → its band (a sheet or two up to a heavy parcel)
const WEIGHT_BANDS = [[1, 1], [2, 2], [4, 3], [8, 5], [Infinity, 8]];
// a leg's length in u → its band (trade.md: about 400u is half a day's walk)
const DIST_BANDS = [[150, 1], [600, 2], [1500, 3], [Infinity, 4]];
const band = (table, v) => table.find(([top]) => v <= top)[1];

// Faerie charges for the crossing itself, whatever the distance, and counts in its own way
const CROSSING = 3;
export const VALUES = { green: [1, 2, 5, 10], foreign: [1, 2, 5, 10], faerie: [1, 3, 7, 13], old: [1, 2, 5] };
const PRINTED = { green: [60, 40, 18, 6], foreign: [24, 16, 8, 3], faerie: [13, 9, 5, 2], old: [12, 6, 2] };   // foreign parts: only what the carrier brings in
export const DESIGNS = { green: 4, foreign: 4, faerie: 4, old: 4 };     // how many designs in each pool (sprites/stamps/, or placeholders)

// the fewest stamps paying exactly `owed` out of what's in stock; if no exact sum exists, the
// least over, then the fewest. stock: [{ value, left }], any order. Returns values, or null.
export function fewestStamps(stock, owed){
  if (owed <= 0) return [];
  const most = Math.max(...stock.map(s => s.value), 1), top = owed + most;
  // best[v] = the fewest stamps summing to v, counting stock (bounded knapsack, one stamp at a time)
  let best = new Array(top + 1).fill(null); best[0] = [];
  for (const s of stock) for (let k = 0; k < s.left && k < top; k++){
    const next = best.slice();
    for (let v = 0; v + s.value <= top; v++){
      const b = best[v]; if (!b) continue;
      const w = v + s.value, had = next[w];
      if (!had || b.length + 1 < had.length) next[w] = [...b, s.value];
    }
    if (next.every((b, v) => b === best[v])) break;
    best = next;
  }
  for (let v = owed; v <= top; v++) if (best[v]) return best[v].slice().sort((a, b) => b - a);
  return null;
}

export function makePost({ seed = 1, realms = [] }){
  const r = mulberry32((seed ^ 0x5057a3) >>> 0);
  const byId = new Map(realms.map(R => [R.id, R]));
  const issues = new Map();                 // `${realm}:${value}` → issue
  const letters = new Map();                // id → letter
  let nextLetter = 1;

  // designs are dealt from a pool by the seed, without repeats while the pool lasts
  const pool = { green: [], foreign: [], faerie: [], old: [] };
  const deal = kind => {
    if (!pool[kind].length){ pool[kind] = Array.from({ length: DESIGNS[kind] }, (_, i) => i); for (let i = pool[kind].length - 1; i > 0; i--){ const j = (r() * (i + 1)) | 0; [pool[kind][i], pool[kind][j]] = [pool[kind][j], pool[kind][i]]; } }
    return pool[kind].pop();
  };
  for (const R of realms){
    const kind = R.kind === 'faerie' || R.kind === 'foreign' || R.kind === 'old' ? R.kind : 'green';
    VALUES[kind].forEach((value, i) => {
      issues.set(`${R.id}:${value}`, { id: `${R.id}:${value}`, realm: R.id, realmName: R.name, kind, value,
        design: `${kind}-${deal(kind)}`, printed: PRINTED[kind][i], left: PRINTED[kind][i] });
    });
  }
  const issuesOf = id => [...issues.values()].filter(s => s.realm === id);
  const isFae = id => byId.get(id)?.kind === 'faerie';

  const post = {
    realms, issues, letters, issuesOf,
    // the nearest green realm's post carries to Faerie's door: `door` is that stretch's length,
    // which main.js knows and this doesn't. Two green realms split the way at half.
    legs(from, to, door = 0){
      const dist = Math.hypot(from.x - to.x, from.z - to.z);
      if (from.realm === to.realm) return [{ realm: from.realm, dist: isFae(from.realm) ? 0 : dist, crossing: false }];
      if (isFae(from.realm)) return [{ realm: from.realm, dist: 0, crossing: true }, { realm: to.realm, dist: door, crossing: false }];
      if (isFae(to.realm)) return [{ realm: from.realm, dist: door, crossing: false }, { realm: to.realm, dist: 0, crossing: true }];
      return [{ realm: from.realm, dist: dist / 2, crossing: false }, { realm: to.realm, dist: dist / 2, crossing: false }];
    },
    fare(leg, weight){
      const w = band(WEIGHT_BANDS, weight);
      return (leg.crossing ? CROSSING : band(DIST_BANDS, leg.dist)) * w;
    },
    // takes the stamps out of stock: all or nothing, so a leg that can't be paid costs no one anything
    frank(legs, weight){
      const plan = [];
      for (const leg of legs){
        const stock = issuesOf(leg.realm).filter(s => s.left > 0);
        const vals = fewestStamps(stock, post.fare(leg, weight));
        if (!vals) return null;
        plan.push({ realm: leg.realm, vals });
      }
      const out = [];
      for (const { realm, vals } of plan) for (const value of vals){
        const s = issues.get(`${realm}:${value}`);
        out.push({ issue: s.id, realm, realmName: s.realmName, kind: s.kind, value, design: s.design, copy: s.printed - s.left + 1 });
        s.left--;
      }
      return out;
    },
    // a letter, or null if it can't be paid for. `postmark`: where and when (main.js fills it)
    send({ from, to, kind = 'letter', weight = 1, door = 0, seal = null, body = '', payload = null, postmark = null, t = 0 }){
      const legs = post.legs(from, to, door), stamps = post.frank(legs, weight);
      if (!stamps) return null;
      const letter = { id: nextLetter++, kind, from, to, weight, legs, stamps, body, payload, postmark, t,
        seal: seal ? { ...seal, whole: true } : null, state: 'posted', carrier: null };
      letters.set(letter.id, letter);
      return letter;
    },
    // what's left to find out at a look: how much each realm was paid, and whether it took mixed stamps
    paid: letter => letter.legs.map(l => ({ ...l, owed: post.fare(l, letter.weight),
      paid: letter.stamps.filter(s => s.realm === l.realm).reduce((a, s) => a + s.value, 0) })),
    breakSeal(letter){ if (letter.seal) letter.seal.whole = false; },
    deliver(letter, t){ letter.state = 'delivered'; letter.deliveredAt = t; letter.carrier = null; },
    realm: id => byId.get(id) || null,
  };
  return post;
}
