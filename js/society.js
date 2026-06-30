// society.js — group the peasant population into legible social units instead of
// a uniform scatter (Pattern 8 MOSAIC OF SUBCULTURES, 37 HOUSE CLUSTER, 75 THE
// FAMILY): families & clans (kin sharing a surname & race), bands of adventurers
// (mixed folk under a company name), and the occasional lone wanderer. Each group
// gets a spawn centre so its members cluster on the land; the spawner places them
// and tags each NPC with its group, and the agent layer reads the grouping
// (kin keep closer company; see agents.js).

import { randomLand } from './terrain.js';
import { WORLD_R } from './config.js';
import { surnameFor } from './names.js';

// sprites available per folk (dwarves only have a male sheet — so a dwarf group
// reads as brothers / a warrior clan)
const SLUGS = {
  human:  ['male-peasant-human-a', 'female-peasant-human-a', 'male-peasant-human-b'],
  elf:    ['male-peasant-elf', 'female-peasant-elf'],
  dwarf:  ['male-peasant-dwarf'],
  goblin: ['male-peasant-goblin', 'female-peasant-goblin'],
};
const FAMILY_RACES = ['human', 'human', 'elf', 'goblin', 'goblin', 'dwarf'];   // weighted to human, goblins boosted
const ALL_RACES = Object.keys(SLUGS);
const BAND_ADJ  = ['Grey', 'Iron', 'Wandering', 'Golden', 'Silent', 'Red', 'Free', 'Bramble', 'North', 'Ember', 'Stone', 'Wild'];
const BAND_NOUN = ['Company', 'Wolves', 'Wardens', 'Banners', 'Striders', 'Foxes', 'Vagabonds', 'Kindred', 'Company', 'Hands'];

// Build groups totalling ~`total` members. Returns an array of group objects:
//   { id, kind:'family'|'clan'|'band'|'lone', name, surname|null, race|null,
//     members:[{slug}], npcs:[], cx, cz, spread }
export function makeSociety(rng, total = 32){
  const ri = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const pick = a => a.length ? a[Math.floor(rng() * a.length)] : undefined;
  const plan = [['family', 0.42], ['band', 0.26], ['clan', 0.14], ['lone', 0.18]];
  const pickKind = () => { let r = rng(); for (const [k, w] of plan){ if ((r -= w) < 0) return k; } return 'family'; };

  const groups = [];
  let used = 0, id = 0;
  while (used < total){
    const kind = pickKind();
    let size = kind === 'family' ? ri(3, 6) : kind === 'clan' ? ri(6, 9) : kind === 'band' ? ri(3, 6) : 1;
    size = Math.min(size, total - used);
    if (size <= 0) break;
    const c = randomLand(rng, WORLD_R * 0.9, new Set(['grass', 'mud', 'sand'])) || [0, 0];
    const g = { id: id++, kind, members: [], npcs: [], surname: null, race: null, name: null,
                cx: c[0], cz: c[1], spread: kind === 'clan' ? 10 : kind === 'band' ? 6 : 4.5 };

    if (kind === 'family' || kind === 'clan'){
      const race = pick(FAMILY_RACES);
      g.race = race; g.surname = surnameFor(race, rng);
      g.name = kind === 'clan' ? `Clan ${g.surname}` : `the ${g.surname} family`;
      for (let i = 0; i < size; i++) g.members.push({ slug: pick(SLUGS[race]) });
    } else if (kind === 'band'){
      g.name = `the ${pick(BAND_ADJ)} ${pick(BAND_NOUN)}`;
      for (let i = 0; i < size; i++) g.members.push({ slug: pick(SLUGS[pick(ALL_RACES)]) });
    } else {   // lone
      g.members.push({ slug: pick(SLUGS[pick(ALL_RACES)]) });
    }
    assignRoles(g);
    groups.push(g);
    used += size;
  }
  return groups;
}

// light kinship roles so dialog can say how people are related. Families with 4+
// get a father/mother (first man/woman) and children; smaller families are just
// siblings. Clans have an elder; bands a captain.
function assignRoles(g){
  const gen = s => /^female/.test(s) ? 'female' : 'male';
  if (g.kind === 'family'){
    if (g.members.length >= 4){
      let f = false, m = false;
      for (const mem of g.members){
        const ge = gen(mem.slug);
        if (ge === 'male' && !f){ mem.role = 'father'; f = true; }
        else if (ge === 'female' && !m){ mem.role = 'mother'; m = true; }
        else mem.role = 'child';
      }
    } else for (const mem of g.members) mem.role = 'child';
  } else if (g.kind === 'clan'){
    g.members.forEach((mem, i) => mem.role = i === 0 ? 'elder' : 'kin');
  } else if (g.kind === 'band'){
    g.members.forEach((mem, i) => mem.role = i === 0 ? 'captain' : 'member');
  } else {
    g.members[0].role = 'lone';
  }
}
