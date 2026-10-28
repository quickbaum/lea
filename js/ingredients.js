// ingredients.js — what each thing you can carry IS, in one place. Every list that
// used to say it piecemeal is derived from here: what must be cooked (recipes.js
// RAW_KINDS), what only a hard place gives (RARE), how long it keeps and which are
// snacks (larder.js), its food group and worth (trade.js), what a find looks like
// underground, the dish it makes, its colour in a pack. Pure data, no rendering.
// Design: docs/magic.md "What an ingredient is"; history: docs/texts/magic-traditions.md §1.
//
//   label   what it's called (the key, unless it reads better otherwise)
//   hyph    where a long name may break in a one-cell pack box ('hazel-nuts')
//   group   food group (trade.js): fruit, nuts, fungi, roots, meat, fish; 'garden' for
//           the villages' crops; 'trinket' for the valuables; none for what isn't food
//   raw     must be cooked: carried in the raw bag, never eaten as it is
//   keep    days before it goes off (larder.js; unset = the default 3)
//   snack   eaten raw between meals; 'keep' = and worth stocking (larder.js SNACKS / KEEPERS)
//   worth   base worth in a swap (trade.js; unset = 0.6)
//   from    where it's found: bushes, trees, ground, water, croft, shore, cave…
//   when    when it's found, only where the game has a rule for it
//   rare    only a hard place gives it (the value is the place: 'cave')
//   look    [title, line] when you aim at it as a find underground
//   pic     [one, several]: its picture, as a find underground and in a pack box (sprites/items/);
//           `several` is optional (then `one` serves for any number)
//   dish    what a potful of it is called, when no recipe names it (agents.js dishName)
//   color   its colour in a carried pack (textures.js)
//   temper  [hot, moist] in Galen's degrees, -4..4: [-2, 2] is cold and moist in the
//           second degree. The manifest qualities, which the kitchen reasons with. The
//           values follow the old tables (the Tacuinum sanitatis and its kin) as I know
//           them from general knowledge, not a checked source. Nothing reads them yet.
//   virtues occult powers, which can't be reasoned from temper, only learned
//   sym     sympathies: who or what it suits as a gift ('sacred tree': shrine offerings)
//   size    [w, h] cells it takes in the player's pack grid, a box of `stack`
//   eat     what eating one gives the player: { stamina, health, sp } (vitals.js)
//   use     what using one does instead (main.js useFromPack): 'sight', the fairy salve

export const INGREDIENTS = {
  // ---- the wild larder (gen/flora.js, docs/forage.md) ----
  berries:   { group: 'fruit', keep: 1.5, snack: true, worth: 0.7, from: 'bushes', color: '#6e1f4c',
               temper: [-1, 1], size: [1, 1], stack: 10, eat: { stamina: 10, health: 1 } },
  apples:    { group: 'fruit', keep: 6, snack: 'keep', worth: 0.7, from: 'trees', color: '#ce3c2c',
               temper: [-1, 1], size: [1, 1], stack: 3, eat: { stamina: 15, health: 2 } },
  // hazel is the tree of wisdom in Irish story: its nuts fell into Connla's Well and fed
  // the Salmon of Knowledge (general knowledge). The one basket food with spell points.
  hazelnuts: { hyph: 'hazel-nuts', group: 'nuts', keep: 10, snack: 'keep', worth: 1.0, from: 'bushes', color: '#8a6438',
               temper: [1, -1], virtues: ['wisdom'], pic: ['sprites/items/hazelnut.png'], size: [1, 1], stack: 12, eat: { stamina: 5, sp: 2 } },
  chamomile: { hyph: 'chamo-mile', keep: 3, from: 'meadows', color: '#e6dea0',
               temper: [1, -1], virtues: ['soothing'], size: [1, 1], stack: 8, eat: { stamina: 3, health: 3 } },
  roots:     { group: 'roots', raw: true, worth: 0.8, from: 'ground', dish: 'root stew', color: '#6f8f3a',
               temper: [1, -1], pic: ['sprites/items/roots.png'], size: [1, 2], stack: 3 },
  acorns:    { group: 'nuts', raw: true, worth: 0.4, from: 'oaks', dish: 'acorn porridge', color: '#9c6b35',
               temper: [-1, -2], size: [1, 1], stack: 12 },
  mushrooms: { hyph: 'mush-rooms', group: 'fungi', keep: 2, worth: 1.0, from: 'shade', dish: 'mushroom stew', color: '#b0623c',
               look: ['Pale mushrooms', 'Growing in the damp where the daylight still reaches.'],
               temper: [-2, 2], size: [1, 1], stack: 4, eat: { stamina: 8 } },
  morels:    { group: 'fungi', raw: true, worth: 1.3, from: 'shade', dish: 'morel stew', color: '#7a5a3a',
               temper: [-1, 2], size: [1, 1], stack: 4 },
  'cattail root': { group: 'roots', raw: true, worth: 0.6, from: 'marsh', dish: 'cattail broth', color: '#6f8f3a',
               temper: [-1, 1], size: [1, 2], stack: 3 },
  meat:      { group: 'meat', raw: true, worth: 1.4, from: 'the hunt', dish: 'rabbit stew', color: '#a33a32',
               temper: [-1, -1], size: [2, 1], stack: 2 },
  fish:      { group: 'fish', raw: true, worth: 1.1, from: 'water', when: 'dusk', dish: 'fish stew', color: '#9fb2b8',
               temper: [-2, 2], size: [2, 1], stack: 1 },
  eels:      { group: 'fish', raw: true, worth: 1.3, from: 'water', when: 'dusk', dish: 'stewed eels', color: '#4b4a36',
               temper: [-2, 3], size: [3, 1], stack: 1 },

  // ---- the villages' crops (trade.js CROPS: this order is cropAt's) ----
  turnips:   { group: 'garden', keep: 12, worth: 0.8, from: 'croft', color: '#d9c7d6', temper: [1, 1],  size: [1, 1], stack: 2, eat: { stamina: 10 } },
  parsnips:  { group: 'garden', keep: 12, worth: 0.9, from: 'croft', color: '#e2d3a4', temper: [1, 1],  pic: ['sprites/items/parsnip.png'], size: [1, 2], stack: 2, eat: { stamina: 10 } },
  cabbages:  { group: 'garden', keep: 8,  worth: 0.9, from: 'croft', color: '#7fae5a', temper: [1, -1], size: [2, 2], stack: 1, eat: { stamina: 12 } },
  onions:    { group: 'garden', keep: 20, worth: 1.1, from: 'croft', color: '#c98a44', temper: [4, 3],  size: [1, 1], stack: 2, eat: { stamina: 6, health: 2 } },
  leeks:     { group: 'garden', keep: 6,  worth: 1.0, from: 'croft', color: '#9cc27a', temper: [3, -2], size: [1, 3], stack: 2, eat: { stamina: 8 } },
  beans:     { group: 'garden', keep: 15, worth: 1.0, from: 'croft', color: '#5f7a3a', temper: [-1, -1], size: [1, 1], stack: 10, eat: { stamina: 10 } },
  peas:      { group: 'garden', keep: 10, worth: 0.9, from: 'croft', color: '#86b94e', temper: [0, 1],  size: [1, 1], stack: 10, eat: { stamina: 10 } },

  // ---- what only the deep gives (gen/under.js deepFinds, docs/under.md "The deep") ----
  foxfire:  { hyph: 'fox-fire', raw: true, rare: 'cave', from: 'cave', virtues: ['shine'],
               look: ['Foxfire', 'A fungus that shines blue-green in the dark. Good eating, cooked.'],
               pic: ['sprites/items/glowcap.png', 'sprites/items/glowcap_group.png'],
               temper: [-2, 1], size: [1, 1], stack: 4 },
  // salt is what stays fixed in the fire: the first of Paracelsus's three principles
  'cave salt': { rare: 'cave', from: 'cave', virtues: ['keeping'], keep: 365,   // (salt doesn't go off in a cook's pack)
               look: ['Cave salt', 'A white crust on the rock, left where the lake once stood higher.'],
               temper: [1, -3], size: [1, 1], stack: 6 },
  blindfish: { raw: true, rare: 'cave', from: 'cave',
               look: ['Blindfish', 'Pale, eyeless fish, hanging still in the dark shallows.'],
               temper: [-3, 3], size: [2, 1], stack: 1 },

  // ---- for the still-room (stillroom.js): the fairy salve's, and the salve ----
  // a four-leaved clover breaks glamour, as the ointment does (traditions §4); found only by
  // searching a fairy ring's clover at first light (main.js)
  'four-leaf clover': { hyph: 'four-leaf clo-ver', from: 'fairy ring', when: 'dawn', rare: 'ring', virtues: ['breaks glamour'],
               color: '#5fae4a', temper: [-1, -1], size: [1, 1], stack: 3 },
  // what ran down from the altar candles (gen/under.js): old salves were bound with wax
  beeswax:   { from: 'crypt', keep: 365, virtues: ['binding'], color: '#d9b45a', temper: [1, -1], size: [1, 1], stack: 4,
               look: ['Beeswax', 'Old beeswax, run down from the altar candles into a lump.'] },
  'fairy salve': { hyph: 'fairy salve', from: 'a stargazer', use: 'sight', virtues: ['the second sight'], color: '#7fd0a0', size: [1, 1], stack: 2 },

  // ---- the book dishes, cooked by the folk you taught (recipes.js `book`): a portion
  // put by for you comes in a crock (a flask, for the draught). They give far more than
  // anything raw, and are where most spell points come from. group 'dish': each is its
  // own for variety (vitals.js), and not a food group the folk trade by. ----
  'hazel porridge':  { group: 'dish', from: 'a cook', color: '#a07a4a', temper: [1, 0],  size: [2, 1], stack: 1, eat: { stamina: 30, sp: 4 } },
  'bean broth':      { group: 'dish', from: 'a cook', color: '#6f7a40', temper: [0, 1],  size: [2, 1], stack: 1, eat: { stamina: 30, health: 5 } },
  'salted eel':      { group: 'dish', from: 'a cook', color: '#5a5640', temper: [0, -1], size: [2, 1], stack: 1, eat: { stamina: 25 } },
  'blindfish broth': { group: 'dish', from: 'a cook', color: '#b9c4c8', temper: [-1, 1], size: [2, 1], stack: 1, eat: { health: 15, sp: 6 } },
  // "against the dark" (its book's own words): later, perhaps, your way lit underground
  'foxfire draught': { hyph: 'fox-fire draught', group: 'dish', from: 'a cook', color: '#3fc9a8', virtues: ['against the dark'],
                       temper: [-1, 0], size: [1, 2], stack: 1, eat: { sp: 10 } },

  // ---- the valuables (flora.js; trade.js VALUABLES): pretty things, worth a trade,
  // and what the shrines take as offerings (docs/sacred-trees.md) ----
  shell:  { group: 'trinket', from: 'shore', sym: ['sacred tree'], size: [1, 1], stack: 1 },
  stone:  { group: 'trinket', from: 'ground', size: [1, 1], stack: 1 },
  // the lapidaries held amber hot and dry
  amber:  { group: 'trinket', from: 'grass', temper: [1, -1], sym: ['sacred tree'], size: [1, 1], stack: 5,
            look: ['Amber beads', 'A broken string of them, left with the dead.'], pic: ['sprites/items/amber.png'] },
  // rock crystal was thought to be ice frozen past thawing (Pliny), so very cold
  quartz: { group: 'trinket', from: 'rock', temper: [-3, -2], sym: ['sacred tree'], size: [1, 2], stack: 1,
            look: ['Quartz', 'Clear crystals grown out of the rock.'] },
  gold:   { group: 'trinket', from: 'tombs', temper: [0, 0], size: [1, 1], stack: 20,
            look: ['Gold', 'Old coins, thin and worn smooth, their stamp long gone.'] },
};
for (const k in INGREDIENTS) INGREDIENTS[k].label ??= k;

export const ingredient = kind => INGREDIENTS[kind] || null;
const kindsWhere = test => Object.keys(INGREDIENTS).filter(k => test(INGREDIENTS[k]));
const tableOf = (field, test = e => e[field] != null) => Object.fromEntries(kindsWhere(test).map(k => [k, INGREDIENTS[k][field]]));

// the tables the folk's sim reads (same contents as the lists they replace)
export const RAW_KINDS = new Set(kindsWhere(e => e.raw));
export const RARE      = tableOf('rare');
export const KEEP      = tableOf('keep');
export const SNACK_KINDS  = kindsWhere(e => e.snack);
export const KEEPER_KINDS = kindsWhere(e => e.snack === 'keep');
export const FOOD_GROUP = tableOf('group', e => e.group && e.group !== 'garden' && e.group !== 'trinket' && e.group !== 'dish');
export const DISH_KINDS = kindsWhere(e => e.group === 'dish');
export const CROP_KINDS = kindsWhere(e => e.group === 'garden');
export const TRINKETS   = kindsWhere(e => e.group === 'trinket');
export const WORTHS     = tableOf('worth');
export const DISHES     = tableOf('dish');
export const COLORS     = tableOf('color');
export const LOOKS      = tableOf('look');
// the player can eat it from the pack (vitals.js): it has an `eat`, and isn't raw
export const edible = kind => { const e = INGREDIENTS[kind]; return !!(e && e.eat && !e.raw); };
