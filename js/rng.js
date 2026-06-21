// Seeded pseudo-random generator (mulberry32) + small helpers.
//
// Determinism matters for a generative world: every pattern takes an rng so the
// same seed reproduces the same trees, the same town layout, etc. Derive a
// child rng (fork) when you want an independent-but-reproducible stream for a
// sub-pattern, so adding a leaf doesn't shift the street grid.

export function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A new independent stream, seeded from the parent (so still reproducible).
export function fork(rng){ return mulberry32((rng() * 2 ** 32) >>> 0); }

export const rand    = (rng, a = 1, b)   => b === undefined ? rng() * a : a + rng() * (b - a);
export const randint = (rng, a, b)       => Math.floor(a + rng() * (b - a + 1));
export const pick    = (rng, arr)        => arr[Math.floor(rng() * arr.length)];
export const chance  = (rng, p)          => rng() < p;
