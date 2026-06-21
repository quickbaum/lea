// names.js — give each peasant a name fitting its sprite's race, plus an optional
// epithet earned from its persona (agents.js): "Mighty Bill Thorn", "Alana the
// Keen". The race/gender is read from the sprite slug (e.g. female-peasant-elf);
// given + surname are drawn from per-folk lists; the epithet reflects the NPC's
// most pronounced trait or skill (or none, for the unremarkable).

const NAMES = {
  human: {
    male:   ['Bill', 'Tom', 'Hob', 'Wat', 'Ned', 'Gil', 'Rod', 'Sam', 'Cole', 'Aldous', 'Edric', 'Garret', 'Hal', 'Miles', 'Osric'],
    female: ['Alana', 'Bess', 'Maud', 'Edith', 'Rowan', 'Mae', 'Nora', 'Sela', 'Wilda', 'Gisla', 'Annot', 'Tilda', 'Joan', 'Lena'],
    surnames: ['Thorn', 'Fielding', 'Ashby', 'Marsh', 'Brook', 'Hale', 'Tanner', 'Weaver', 'Stone', 'Bramble', 'Hollow', 'Reed', 'Carter', 'Wynn'],
  },
  elf: {
    male:   ['Aelar', 'Faelar', 'Thandir', 'Eldrin', 'Caelum', 'Sylvar', 'Aerendil', 'Itheril', 'Galad', 'Mirath'],
    female: ['Aerith', 'Liriel', 'Sariel', 'Elaria', 'Nuala', 'Thessaly', 'Caelith', 'Miriel', 'Aeliana', 'Ysolde'],
    surnames: ['Moonwhisper', 'Silverleaf', 'Dawnbreeze', 'Nightbloom', 'Starfall', 'Greenwillow', 'Ashglade', 'Mistwood', 'Thornwind', 'Lightfoot'],
  },
  dwarf: {
    male:   ['Borin', 'Durgan', 'Thrain', 'Grumli', 'Balin', 'Orik', 'Hodur', 'Bofur', 'Karok', 'Dwalin'],
    female: ['Hilda', 'Borgun', 'Vistra', 'Dagna', 'Brunni', 'Greta', 'Onika', 'Bardhild', 'Helja', 'Tova'],
    surnames: ['Ironfist', 'Stonebeard', 'Deepdelve', 'Oakshield', 'Coalhewer', 'Forgeheart', 'Hammerfall', 'Grimaxe', 'Orefinder', 'Stoutarm'],
  },
  goblin: {
    male:   ['Snik', 'Grizzle', 'Murt', 'Krall', 'Zeg', 'Bork', 'Fizzle', 'Naxx', 'Wug', 'Skarn'],
    female: ['Nix', 'Gretcha', 'Pesk', 'Mizzle', 'Yark', 'Snagga', 'Vrix', 'Hagga', 'Zilla', 'Brak'],
    surnames: ['Mudfoot', 'Snagtooth', 'Quickfinger', 'Bogwart', 'Grubsnout', 'Rattlebone', 'Cinderpaw', 'Nettlewick', 'Sourgrub', 'Toadwhistle'],
  },
};

// a race-appropriate surname (for sharing across a family/clan)
export function surnameFor(race = 'human', rng = Math.random){
  const set = NAMES[race] || NAMES.human;
  return set.surnames[Math.floor(rng() * set.surnames.length)];
}

// slug (e.g. "female-peasant-elf") -> { race, gender, given, surname, full }
export function makeName(slug = '', rng = Math.random){
  const gender = /^female/.test(slug) ? 'female' : 'male';
  const race = ['elf', 'dwarf', 'goblin', 'human'].find(r => slug.includes(r)) || 'human';
  const set = NAMES[race] || NAMES.human;
  const pick = a => a[Math.floor(rng() * a.length)];
  const given = pick(set[gender] || set.male);
  const surname = pick(set.surnames);
  return { race, gender, given, surname, full: `${given} ${surname}` };
}

// An epithet earned from the persona's strongest trait/skill, or null. Each
// candidate fires only past a threshold; the one furthest past it wins, so the
// title names what's most defining about the person.
export function epithet(p, rng = Math.random){
  if (!p) return null;
  const opts = [
    { v: p.strength - 1,   t: 0.18, kind: 'prefix', words: ['Mighty', 'Strong', 'Burly', 'Stout'] },
    { v: 1 - p.strength,   t: 0.18, kind: 'prefix', words: ['Wee', 'Slight', 'Old'] },
    { v: p.perception - 1, t: 0.18, kind: 'suffix', words: ['the Keen', 'the Sharp-eyed', 'the Watchful'] },
    { v: p.beauty - 1,     t: 0.45, kind: 'suffix', words: ['the Magpie', 'the Collector', 'the Gleaner'] },
    { v: p.food - 1,       t: 0.28, kind: 'suffix', words: ['the Hungry', 'the Ravenous'] },
    { v: p.company - 1,    t: 0.40, kind: 'suffix', words: ['the Merry', 'the Sociable'] },
    { v: 1 - p.company,    t: 0.35, kind: 'suffix', words: ['the Solitary', 'the Quiet', 'the Lonesome'] },
  ];
  const cand = opts.filter(o => o.v >= o.t).sort((a, b) => (b.v - b.t) - (a.v - a.t));
  if (!cand.length) return null;
  const top = cand[0];
  return { kind: top.kind, word: top.words[Math.floor(rng() * top.words.length)] };
}

// full display name: "Mighty Bill Thorn" (prefix) or "Alana the Keen" (suffix),
// or just "Bill Thorn" for the unremarkable.
export function composeName(nm, persona, rng = Math.random){
  const e = epithet(persona, rng);
  if (!e) return nm.full;
  return e.kind === 'prefix' ? `${e.word} ${nm.full}` : `${nm.given} ${e.word}`;
}
