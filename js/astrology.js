// astrology.js — a homemade zodiac laid over the REAL ecliptic. The sun and moon
// move physically (sky.js advances sunLon/moonLon each frame), so which "house"
// they occupy and the moon's phase are genuine sky-state; only the *meanings* are
// folk interpretation. Pure (no THREE), so the headless harness runs it too.
// Some NPCs "read the stars" and spread omens drawn from this. See docs/gossip.md.

const HOUSES = ['Rowan', 'Otter', 'Hare', 'Hearth', 'Reed', 'Stag',
                'Shell', 'Crow', 'Wolf', 'Salmon', 'Bee', 'Spindle'];
const TAU = Math.PI * 2;
const norm = a => ((a % TAU) + TAU) % TAU;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// the ecliptic house a longitude falls in (the moon/sun's "sign")
export function houseName(lon){ return HOUSES[Math.floor(norm(lon) / TAU * 12) % 12]; }

// the moon's phase from its illuminated fraction + whether it's waxing
export function phaseName(illum, waxing){
  if (illum < 0.06) return 'new moon';
  if (illum > 0.94) return 'full moon';
  if (illum > 0.44 && illum < 0.56) return waxing ? 'first-quarter moon' : 'last-quarter moon';
  return (waxing ? 'waxing ' : 'waning ') + (illum < 0.5 ? 'crescent' : 'gibbous') + ' moon';
}

const DOMAIN = {
  Rowan: 'a ward against ill-wishing', Otter: 'a boon to those who fish the shallows',
  Hare: 'a sign for the hunt', Hearth: 'good for sharing a fire',
  Reed: 'a blessing on the foragers', Stag: 'a time for the bold',
  Shell: 'luck for finders of small treasures', Crow: 'a keeper of secrets',
  Wolf: 'good for those who travel in packs', Salmon: 'a sign of the long road home',
  Bee: 'a reward for honest labour', Spindle: 'a time for the patient',
};

// a portent grounded in the real phase + the moon's current house. `rnd` lets a
// caller seed the interpretation (so a given stargazer reads it their own way).
export function makeOmen({ moonLon, sunLon, illum }, rnd = Math.random){
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const waxing = Math.sin(moonLon - sunLon) > 0;
  const house = houseName(moonLon), phase = phaseName(illum, waxing);
  const tenor = illum > 0.94 ? pick(['fortune runs high', 'luck is abroad', 'what is begun will flourish'])
    : illum < 0.06 ? pick(['it is a time to begin anew', 'plant your hopes now', 'the slate is wiped clean'])
    : waxing ? pick(['things are on the grow', 'set to your work — it will prosper', 'the tide is coming in'])
    : pick(['it is a time to mend, not to begin', 'hold fast and waste nothing', 'the tide is going out']);
  const dom = DOMAIN[house];
  return pick([
    `The ${phase} rides in the House of the ${house} — ${tenor}, and ${dom}.`,
    `${cap(phase)} in the ${house}: ${tenor}.`,
    `With the moon in the House of the ${house}, ${tenor} — ${dom}.`,
  ]);
}
