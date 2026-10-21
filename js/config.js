// Shared world constants. Keep this small and dependency-free.

// The world the player chose on the start screen. The whole Lea is generated
// from these when main.js is first imported, so js/intro.js hands its choice
// over as globalThis.__leaWorld before importing it. Without one (a ?debug or
// pose link), the last choice in localStorage['lea.world'] is used, with ?size=
// and ?seed= in the URL overriding; node tools pass a JSON LEA_WORLD env var.
// Everything is clamped — it arrives from storage and URLs.
export const SIZES = [800, 1600, 3200];
export const WORLD_DEFAULTS = { size: 3200, seed: 20260618, folk: 64, hills: 1, water: 1 };
function readWorld(){
  let w = {};
  if (globalThis.__leaWorld && typeof globalThis.__leaWorld === 'object') return clampWorld(globalThis.__leaWorld);
  try {
    if (typeof localStorage !== 'undefined') w = JSON.parse(localStorage.getItem('lea.world') || '{}') || {};
    else if (typeof process !== 'undefined' && process.env && process.env.LEA_WORLD) w = JSON.parse(process.env.LEA_WORLD);
  } catch { w = {}; }
  try {
    if (typeof location !== 'undefined'){
      const q = new URLSearchParams(location.search);
      if (q.has('size')) w.size = +q.get('size');
      if (q.has('seed')) w.seed = +q.get('seed');
    }
  } catch {}
  return clampWorld(w);
}
function clampWorld(w){
  const num = (v, lo, hi, d) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d;
  const D = WORLD_DEFAULTS;
  return {
    size:  SIZES.includes(+w.size) ? +w.size : D.size,
    seed:  Math.floor(num(w.seed, 0, 2 ** 32 - 1, D.seed)),
    folk:  Math.round(num(w.folk, 8, 160, D.folk)),      // people in the world
    hills: num(w.hills, 0, 2, D.hills),                  // 0 flat .. 1 hilly .. 2 mountainous
    water: num(w.water, 0, 2, D.water),                  // 0 dry .. 1 normal .. 2 wet
  };
}
export const WORLD = readWorld();

export const SIZE   = WORLD.size;    // terrain extent (world units, square)
export const SEG    = SIZE / 2;   // terrain mesh resolution: a vertex every 2u

// World area relative to the 800u world the scatter counts were tuned on.
// Multiply a per-world count (trees, shells, boats) by this to hold its density.
// People are deliberately NOT scaled: a bigger world is meant to feel emptier.
export const AREA = (SIZE / 800) ** 2;
export const WATER  = -2.2;    // height below which is lake

// Usable world radius: how far from the centre things spawn and roam. Kept a
// little inside SIZE/2 so nothing wanders off the edge of the terrain mesh.
export const WORLD_R = SIZE * 0.47;

// Scale: a peasant billboard is PERSON_H tall and reads as ~1.75 m, so we can
// convert real-world metres to world units. Tree/plant heights use this so a
// "10 m maple" actually looks 10 m next to the people.
export const PERSON_H    = 2.6;
export const UNITS_PER_M = PERSON_H / 1.75;   // ~1.49 units per metre
export const m = (metres) => metres * UNITS_PER_M;

// One seed drives the whole world, so a given seed always regenerates the same
// terrain, forests, and (later) towns. Chosen on the start screen (WORLD.seed).
export const WORLD_SEED = WORLD.seed;
