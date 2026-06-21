// Shared world constants. Keep this small and dependency-free.
export const SIZE   = 400;     // terrain extent (world units, square)
export const SEG    = 200;     // terrain mesh resolution
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
// terrain, forests, and (later) towns. Change it to roll a new world.
export const WORLD_SEED = 20260618;
