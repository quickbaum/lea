// larder.js — what a person carries to eat, by kind. A pack used to be one
// count with one label, so picking berries turned your apples into berries. Now
// npc.larder is a list of batches { kind, n, t } (t = when gathered, so things
// can go off), and npc.pack / npc.packKind are kept as a mirror (the total, and
// the most plentiful kind) for everything that only needs "how much food".
// Every change to what's carried goes through here, or the mirror lies.
//
// Foods keep differently (KEEP_DAYS): berries go off in a day or two, apples
// and nuts keep. People eat what will spoil first, and keep a stock of snacks
// — the foods eaten raw that keep — sized by their foresight (snackTarget).
// Pure data, no rendering. See docs/talk.md (planning).

export const KEEP_DAYS = { berries: 1.5, apples: 6, hazelnuts: 10, chamomile: 3, mushrooms: 2, food: 4 };
export const SNACKS = ['apples', 'hazelnuts', 'berries'];    // carried to eat between meals
const KEEPERS = new Set(['apples', 'hazelnuts']);           // …and the ones worth stocking

const keep = kind => KEEP_DAYS[kind] ?? 3;
function sync(n){
  const L = n.larder || [];
  let total = 0, best = null, bn = 0;
  const by = {};
  for (const b of L){ total += b.n; by[b.kind] = (by[b.kind] || 0) + b.n; }
  for (const k in by) if (by[k] > bn){ bn = by[k]; best = k; }
  n.pack = total; n.packKind = best;
}
export function larder(n){
  if (!n.larder){ n.larder = []; if ((n.pack || 0) > 0) n.larder.push({ kind: n.packKind || 'food', n: n.pack, t: 0 }); }
  return n.larder;
}

export function addFood(n, kind, k, now){
  if (k <= 0) return 0;
  const L = larder(n), last = L[L.length - 1];
  if (last && last.kind === kind && Math.abs(last.t - now) < 0.05) last.n += k;   // same picking: one batch
  else L.push({ kind, n: k, t: now });
  sync(n);
  return k;
}
export const countOf = (n, kind) => larder(n).reduce((a, b) => a + (kind == null || b.kind === kind ? b.n : 0), 0);
export const snackCount = n => larder(n).reduce((a, b) => a + (SNACKS.includes(b.kind) ? b.n : 0), 0);
export const kindsCarried = n => [...new Set(larder(n).filter(b => b.n > 0).map(b => b.kind))];

// take up to k, soonest-to-spoil first; `which` limits it to a kind (a string)
// or to kinds a test accepts (a function). Returns [{kind, n}].
export function takeFood(n, k, now, which = null){
  const L = larder(n), out = [];
  const ok = which == null ? () => true : typeof which === 'function' ? which : kind => kind === which;
  const order = L.filter(b => ok(b.kind))
    .sort((a, b) => (a.t + keep(a.kind)) - (b.t + keep(b.kind)));
  for (const b of order){
    if (k <= 0) break;
    const m = Math.min(k, b.n); b.n -= m; k -= m;
    const o = out.find(x => x.kind === b.kind); if (o) o.n += m; else out.push({ kind: b.kind, n: m });
  }
  n.larder = L.filter(b => b.n > 0);
  sync(n);
  return out;
}
// …the same, but keep the snacks we're stocking: give or store the rest first
export function takeSpare(n, k, now){
  const out = takeFood(n, k, now, kind => !KEEPERS.has(kind));            // what won't keep goes first
  const over = Math.max(0, larder(n).reduce((a, b) => a + (KEEPERS.has(b.kind) ? b.n : 0), 0) - snackTarget(n));
  if (k - total(out) > 0 && over > 0) out.push(...takeFood(n, Math.min(k - total(out), over), now, kind => KEEPERS.has(kind)));
  return out;
}
export const total = list => list.reduce((a, b) => a + b.n, 0);
export function giveAll(to, list, now){ for (const b of list) addFood(to, b.kind, b.n, now); }

// drop what's gone off; returns how many went
export function spoil(n, now){
  const L = larder(n); let lost = 0;
  for (const b of L) if (now - b.t > keep(b.kind)){ lost += b.n; b.n = 0; }
  if (lost){ n.larder = L.filter(b => b.n > 0); sync(n); }
  return lost;
}

// Foresight (0.5..1.5), from who they are — hashed, not drawn, so adding it
// doesn't shift the seeded world. The prudent stock more and plan further ahead.
export function foresight(n){
  if (n._foresight == null){
    let h = Math.imul((n.id + 1) ^ 0x5bd1e995, 2654435761) >>> 0; h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2d) >>> 0;
    n._foresight = 0.5 + (h % 1001) / 1000;
  }
  return n._foresight;
}
// how many snacks they like to have on hand
export const snackTarget = n => Math.round(1 + 2.5 * foresight(n));
export const isKeeper = kind => KEEPERS.has(kind);
