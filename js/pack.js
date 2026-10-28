// pack.js — the player's pack as a grid, as in Diablo and Might and Magic. Each box
// holds one ingredient and takes the cells its size says (ingredients.js `size`), up
// to its `stack` (a handful of berries in one cell; one eel across three). Things
// added go first into a box of the same kind with room, then into the first free
// place, scanning rows top to bottom. What doesn't fit stays out (add returns how
// many went in). Boxes can be moved, and dropped onto a box of the same kind to
// merge. Within a box, its units are kept as lots, each with its provenance (where, how
// and under what sky it was got: js/provenance.js), so a rite can ask for the right
// ones; a box's n is always the sum of its lots. What's taken without asking comes from
// the oldest lot. Pure data, no rendering: js/pack-view.js draws it.
//
// `counts` is the old basket ({ kind: n }), kept in step on every change, so
// everything that only asks "how many do I carry" reads it as before.

import { ingredient } from './ingredients.js';
import { sameLot } from './provenance.js';

export const PACK_W = 10, PACK_H = 6;
const sizeOf = kind => (ingredient(kind) && ingredient(kind).size) || [1, 1];
const stackOf = kind => (ingredient(kind) && ingredient(kind).stack) || 1;

export function makePack(w = PACK_W, h = PACK_H){
  const items = [], counts = {};
  let nextId = 1;
  const sync = () => {
    for (const k in counts) delete counts[k];
    for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + it.n;
  };
  // is the rect (x, y, sw, sh) inside the grid and clear of every box but `skip`?
  const clear = (x, y, sw, sh, skip = null) => x >= 0 && y >= 0 && x + sw <= w && y + sh <= h &&
    !items.some(it => { if (it === skip) return false; const [iw, ih] = sizeOf(it.kind);
      return x < it.x + iw && it.x < x + sw && y < it.y + ih && it.y < y + sh; });
  const freeSpot = (kind) => { const [sw, sh] = sizeOf(kind);
    for (let y = 0; y + sh <= h; y++) for (let x = 0; x + sw <= w; x++) if (clear(x, y, sw, sh)) return [x, y];
    return null; };
  // lots: put m into a box (joining a lot of the same gathering), take m out (oldest first,
  // or only lots whose provenance passes `test`)
  const putLot = (it, m, prov) => { const l = it.lots.find(x => sameLot(x.prov, prov)); if (l) l.n += m; else it.lots.push({ n: m, prov }); it.n += m; };
  const takeLots = (it, m, test = null) => { let got = 0;
    for (const l of it.lots){ if (got >= m) break; if (test && !test(l.prov)) continue; const x = Math.min(l.n, m - got); l.n -= x; got += x; }
    it.lots = it.lots.filter(l => l.n > 0); it.n -= got; return got; };
  const at = (cx, cy) => items.find(it => { const [iw, ih] = sizeOf(it.kind); return cx >= it.x && cx < it.x + iw && cy >= it.y && cy < it.y + ih; }) || null;

  const pack = {
    w, h, items, counts,
    size: sizeOf, stack: stackOf, at,
    // how many more of `kind` would fit, at most `upto`
    room(kind, upto = Infinity){
      let r = items.filter(it => it.kind === kind).reduce((a, it) => a + stackOf(kind) - it.n, 0);
      if (r >= upto) return upto;
      // free places: count by filling a scratch copy (boxes don't overlap, so this is exact)
      const placed = [];
      for (;;){
        const s = freeSpot(kind); if (!s) break;
        const ghost = { kind, n: 0, x: s[0], y: s[1] }; items.push(ghost); placed.push(ghost);
        r += stackOf(kind); if (r >= upto) break;
      }
      for (const g of placed) items.splice(items.indexOf(g), 1);
      return Math.min(r, upto);
    },
    // put up to n of kind in, all of one provenance; returns how many went in
    add(kind, n, prov = null){
      let left = n;
      for (const it of items) if (left > 0 && it.kind === kind && it.n < stackOf(kind)){ const m = Math.min(left, stackOf(kind) - it.n); putLot(it, m, prov); left -= m; }
      while (left > 0){
        const s = freeSpot(kind); if (!s) break;
        const m = Math.min(left, stackOf(kind)), it = { id: nextId++, kind, n: 0, lots: [], x: s[0], y: s[1] };
        putLot(it, m, prov); items.push(it); left -= m;
      }
      sync();
      return n - left;
    },
    // take up to n of kind out, from the smallest boxes first (so full ones stay full);
    // `test(prov)` takes only units got so (a rite's "picked at dawn"); returns how many
    take(kind, n, test = null){
      let left = n;
      const mine = items.filter(it => it.kind === kind).sort((a, b) => a.n - b.n);
      for (const it of mine){ if (left <= 0) break; left -= takeLots(it, left, test); }
      for (let i = items.length - 1; i >= 0; i--) if (items[i].n <= 0) items.splice(i, 1);
      sync();
      return n - left;
    },
    // how many of kind you carry that pass test(prov)
    countWhere(kind, test){ return items.filter(it => it.kind === kind).reduce((a, it) => a + it.lots.reduce((b, l) => b + (test(l.prov) ? l.n : 0), 0), 0); },
    // the provenances of what you carry of kind, with how many of each: [{ n, prov }]
    lotsOf(kind){ return items.filter(it => it.kind === kind).flatMap(it => it.lots); },
    // one from a particular box (eating from the box you clicked): its oldest lot; returns
    // the provenance of what was taken, or null if nothing was
    takeFrom(id){
      const it = items.find(b => b.id === id); if (!it || !it.lots.length) return null;
      const prov = it.lots[0].prov;
      takeLots(it, 1);
      if (it.n <= 0) items.splice(items.indexOf(it), 1);
      sync();
      return { prov };
    },
    // what dropping box `id` with its top-left on (x, y) would do: 'move', 'merge' (onto a
    // box of the same kind with room, which then takes what it can) or null (no room)
    dropAt(id, x, y){
      const it = items.find(b => b.id === id); if (!it) return null;
      const [sw, sh] = sizeOf(it.kind);
      if (clear(x, y, sw, sh, it)) return { how: 'move' };
      const hits = new Set();
      for (let cy = y; cy < y + sh; cy++) for (let cx = x; cx < x + sw; cx++){ const b = at(cx, cy); if (b && b !== it) hits.add(b); }
      if (hits.size === 1){ const b = [...hits][0]; if (b.kind === it.kind && b.n < stackOf(b.kind)) return { how: 'merge', into: b }; }
      return null;
    },
    move(id, x, y){
      const d = pack.dropAt(id, x, y), it = items.find(b => b.id === id);
      if (!d) return false;
      if (d.how === 'move'){ it.x = x; it.y = y; }
      else {                                       // merge: the lots move across, oldest first, as far as there's room
        let room = stackOf(it.kind) - d.into.n;
        for (const l of it.lots){ if (room <= 0) break; const x = Math.min(l.n, room); putLot(d.into, x, l.prov); l.n -= x; it.n -= x; room -= x; }
        it.lots = it.lots.filter(l => l.n > 0);
        if (it.n <= 0) items.splice(items.indexOf(it), 1);
      }
      sync();
      return true;
    },
  };
  return pack;
}
