// tackle.js — what you fish with, and the strike (docs/fishing.md "Tackle" and "The strike").
// Pure, no THREE: tools/check-tackle.mjs drives it. main.js holds the line and the pack.
//
// A rod is a multiplier on agents.biteRate, never a second bite system: the folk's water
// and yours are the same water. With no rod in the pack you fish a hand line, wound on a
// stick. A pole you make yourself, from a straight shoot (the Crafts page of your book); a
// jointed rod comes from a villager who fishes.
//
// The strike: a bite isn't a catch. The float twitches (the nibble), then goes under for a
// moment (the take), and E then sets the hook. Strike on the nibble and you pull it out of
// the fish's mouth; wait past the take and it's gone with the bait. A better rod gives you
// longer to see it go under, and lands two more often.

export const RODS = {
  // bite: × the bite rate. take: seconds the float stays under (generous: young children play the
  // Lea; 2026-11-10. It may later depend on the fish too). two: × the chance of two at once
  'hand line':    { bite: 0.7, take: 1.0, two: 0.7 },
  'fishing pole': { bite: 1.0, take: 1.3, two: 1.0 },
  'jointed rod':  { bite: 1.25, take: 1.6, two: 1.3 },
};
export const ROD_KINDS = ['jointed rod', 'fishing pole'];   // best first: the one you fish with is the best you carry
export const rodOf = counts => ROD_KINDS.find(k => (counts[k] || 0) > 0) || 'hand line';

// what you can make yourself (main.js craftBlocks, beside the instruments; known from the start)
export const TACKLE_CRAFTS = {
  'fishing pole': { needs: [['wood', 1]], about: 'A straight shoot out of the firewood, trimmed, with a line tied off at the tip.' },
};

const NIBBLE = [0.8, 2.4];   // s of twitching before it takes

// a bite begins: the nibble, then the take
export function newBite(rod, rnd = Math.random){
  return { phase: 'nibble', t: NIBBLE[0] + rnd() * (NIBBLE[1] - NIBBLE[0]), take: RODS[rod].take };
}
// on with the clock: 'nibble' → 'take' → 'gone'. Returns the phase.
export function stepBite(b, dt){
  if (b.phase === 'gone') return b.phase;
  b.t -= dt;
  if (b.t > 0) return b.phase;
  if (b.phase === 'nibble'){ b.phase = 'take'; b.t = b.take; }
  else b.phase = 'gone';
  return b.phase;
}
// E while a bite's on: 'hooked' on the take, 'early' on the nibble, 'late' once it's gone
export const strike = b => b.phase === 'take' ? 'hooked' : b.phase === 'nibble' ? 'early' : 'late';
