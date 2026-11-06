// kin.js — who the dead were, and whose people they are. Pure data: no three, no world. A lineage
// is a surname and a tree of dead, some still with kin walking the Lea, some died out. The dead lie
// in the crypts' tombs (a crypt holds 3 names a floor; docs/skeletons.md, "The dead and their kin").
//
//   makeKin({ seed, crypts: [{ id, floors }], living: [{ id, name, surname }], surnames: [..] })
//   kin.people         Map id → { id, name, given, surname, sex, parent, kids, lineage, dead, crypt, slot, npc }
//   kin.inTomb(crypt, slot)   who lies there, or null: a name worn away
//   kin.epitaph(p)     what the tomb says
//   kin.tree(lineage, knows)  what you know of a lineage, as bub-lineage draws it: { tree }, or null
//
// `tree` is a projection, as bub-lineage asks: the same shape a note's family gets on the Bub, so
// an improvement to the drawing reaches both. Ancestors you haven't learned are unnamed.

import { makeName } from './names.js';
import { mulberry32 } from './rng.js';

export const PER_FLOOR = 3;      // names a crypt holds per floor: below the fewest coffins measured (tools/check-kin.mjs)
const CHILD = { female: 'daughter', male: 'son' };

export function makeKin({ seed = 1, crypts = [], living = [], surnames = [] }){
  const r = mulberry32((seed ^ 0x6b1a5) >>> 0), people = new Map(), lineages = [];
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--){ const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const slots = shuffle(crypts.flatMap(c => Array.from({ length: c.floors * PER_FLOOR }, (_, slot) => ({ crypt: c.id, slot }))));
  const tombs = new Map();
  let nextDead = 0;

  const bury = (lineage, parent) => {
    const at = slots.pop(); if (!at) return null;
    const nm = makeName(r() < 0.5 ? 'female' : 'male', r), id = `d${nextDead++}`;
    const p = { id, name: `${nm.given} ${lineage.surname}`, given: nm.given, surname: lineage.surname, sex: nm.gender, parent, kids: [], lineage: lineage.id, dead: true, crypt: at.crypt, slot: at.slot };
    people.set(id, p); tombs.set(`${at.crypt}:${at.slot}`, p); lineage.people.push(p);
    if (parent) people.get(parent).kids.push(id);
    return p;
  };
  // those still walking the Lea come first, so as many as can be have dead below; then lines that have died out
  const byName = new Map();
  for (const n of living) if (n.surname){ if (!byName.has(n.surname)) byName.set(n.surname, []); byName.get(n.surname).push(n); }
  const names = [...shuffle([...byName.keys()].sort()), ...shuffle(surnames.filter(s => !byName.has(s)))];
  for (const surname of names){
    if (!slots.length) break;
    const lineage = { id: lineages.length, surname, people: [], root: null };
    const root = bury(lineage, null);
    lineage.root = root.id;
    let gen = [root];
    for (let g = 0; g < 2 && slots.length; g++){       // three generations at most, so a tree fits a page
      const next = [];
      for (const q of gen){
        const n = g === 0 ? 2 + ((r() * 2) | 0) : (r() * 3) | 0;
        for (let k = 0; k < n; k++){ const c = bury(lineage, q.id); if (c) next.push(c); }
      }
      if (!next.length) break;
      gen = next;
    }
    // the living descend from the youngest dead, whichever that was
    for (const n of byName.get(surname) || []){
      const parent = gen[(Math.imul(n.id + 1, 2654435761) >>> 8) % gen.length];
      const p = { id: `n${n.id}`, name: n.name, surname, parent: parent.id, kids: [], lineage: lineage.id, dead: false, npc: n };
      people.set(p.id, p); parent.kids.push(p.id); lineage.people.push(p);
    }
    lineages.push(lineage);
  }

  const kin = {
    people, lineages,
    inTomb: (crypt, slot) => tombs.get(`${crypt}:${slot}`) || null,
    dead: () => [...people.values()].filter(p => p.dead),
    epitaph(p){
      const up = p.parent && people.get(p.parent);
      return up ? `${p.name}, ${CHILD[p.sex] || 'child'} of ${up.name}.` : `${p.name}.`;
    },
    // what you know of a lineage: those you know, and the ancestors between them, unnamed if you don't
    tree(lineage, knows){
      const L = lineages[lineage]; if (!L) return null;
      const node = id => {
        const p = people.get(id), kids = p.kids.map(node).filter(Boolean), k = knows(p);
        if (!k && !kids.length) return null;
        return { ...(k ? { id: p.id } : {}), name: k ? p.name : '…', exists: k, sex: p.sex, ...(k && !p.dead ? { rel: 'living' } : {}), kids };
      };
      const tree = node(L.root);
      return tree ? { tree } : null;
    },
  };
  return kin;
}

// A big tree in pieces a book page can hold (about 15 rows; the book won't split a block): a branch
// that fits is one piece, and one that doesn't is its own name, then its children's branches.
export const PIECE_ROWS = 12;
const rows = n => 1 + n.kids.reduce((a, k) => a + rows(k), 0);
export function treePieces(node, depth = 0, max = PIECE_ROWS){
  if (rows(node) <= max) return [{ tree: node, depth, head: false }];
  return [{ tree: { ...node, kids: [] }, depth, head: true }, ...node.kids.flatMap(k => treePieces(k, depth + 1, max))];
}

// which coffin holds which slot in a built level: dealt by a hash, so nothing else moves. Bare lids
// first, so every crypt has a named tomb whose slab can slide with nothing on it.
export const lidBare = (p, finds) => !finds.some(f => Math.hypot(f.x - p.x, f.z - p.z) < 0.4);
export function tombOrder(coffins, cryptId, finds = []){
  const key = i => Math.imul(Math.imul(i + 1, 2654435761) ^ Math.imul(cryptId + 1, 40503), 1274126177) >>> 0;
  return coffins.map((p, i) => ({ p, k: key(i), bare: lidBare(p, finds) })).sort((a, b) => (b.bare - a.bare) || (a.k - b.k)).map(q => q.p);
}
