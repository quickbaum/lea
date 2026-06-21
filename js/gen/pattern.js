// pattern.js — the composability core of the world generator.
//
// Inspired by Christopher Alexander's *A Pattern Language*: a pattern is a
// named, parameterized solution that lives at a particular SCALE and is built
// out of smaller patterns. Patterns form a language — larger ones invoke
// smaller ones — so the same machinery that grows a tree from leaves will grow
// a town from buildings, paths, and gardens.
//
// A Pattern here is just:  { name, scale, generate(ctx) -> artifact }
// where ctx carries at least { rng, ...params } and an artifact is whatever the
// scale produces (a THREE geometry for a tree; later, a placement plan for a
// neighbourhood). Patterns stay deterministic: same rng + params => same result.

export const SCALE = {
  LEAF:        'leaf',
  PLANT:       'plant',     // shrub, flower
  TREE:        'tree',
  GROVE:       'grove',     // a cluster of trees
  GARDEN:      'garden',
  BUILDING:    'building',
  BLOCK:       'block',
  NEIGHBORHOOD:'neighborhood',
  TOWN:        'town',
};

// Rough ordering, smallest first — lets tools reason about "what composes what".
export const SCALE_ORDER = [
  SCALE.LEAF, SCALE.PLANT, SCALE.TREE, SCALE.GROVE, SCALE.GARDEN,
  SCALE.BUILDING, SCALE.BLOCK, SCALE.NEIGHBORHOOD, SCALE.TOWN,
];

export class Pattern {
  constructor({ name, scale, generate, uses = [] }){
    this.name = name;
    this.scale = scale;
    this.uses = uses;            // names of sub-patterns this one composes
    this._generate = generate;
  }
  generate(ctx = {}){ return this._generate(ctx); }
}

const registry = new Map();

export function definePattern(def){
  const p = new Pattern(def);
  registry.set(p.name, p);
  return p;
}
export function pattern(name){
  const p = registry.get(name);
  if (!p) throw new Error(`unknown pattern: ${name}`);
  return p;
}
export function patterns(scale = null){
  const all = [...registry.values()];
  return scale ? all.filter(p => p.scale === scale) : all;
}
