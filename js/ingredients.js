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
//   use     what using one does instead (main.js useFromPack): 'sight', the fairy salve; 'play', an instrument

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
               temper: [1, -1], virtues: ['soothing'], pic: ['flowers/flowers41.png', 'flowers/flowers13.png'], size: [1, 1], stack: 8, eat: { stamina: 3, health: 3 } },
  roots:     { group: 'roots', raw: true, worth: 0.8, from: 'ground', dish: 'root stew', color: '#6f8f3a',
               temper: [1, -1], pic: ['sprites/items/roots.png'], size: [1, 2], stack: 3 },
  acorns:    { group: 'nuts', raw: true, worth: 0.4, from: 'oaks', dish: 'acorn porridge', color: '#9c6b35',
               temper: [-1, -2], pic: ['sprites/items/acorn.png'], size: [1, 1], stack: 12 },
  mushrooms: { hyph: 'mush-rooms', group: 'fungi', keep: 2, worth: 1.0, from: 'shade', dish: 'mushroom stew', color: '#b0623c',
               look: ['Pale mushrooms', 'Growing in the damp where the daylight still reaches.'],
               temper: [-2, 2], pic: ['sprites/items/mushroom1.png'], size: [1, 1], stack: 4, eat: { stamina: 8 } },
  morels:    { group: 'fungi', raw: true, worth: 1.3, from: 'shade', dish: 'morel stew', color: '#7a5a3a',
               temper: [-1, 2], pic: ['sprites/items/morel.png'], size: [1, 1], stack: 4 },
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
  // the caps of a fairy ring (gen/flora.js makeFairyRing), and what grows on the Gentry's
  // lawns (gen/faerie.js). Folk leave them be (main.js), and nobody eats them
  'fairy mushrooms': { hyph: 'fairy mush-rooms', from: 'fairy ring', virtues: ['shine'], color: '#7a2a78',
               look: ['Fairy mushrooms', 'Violet caps with a faint light of their own.'],
               pic: ['sprites/items/mushroom_faerie.png'], size: [1, 1], stack: 6 },
  'four-leaf clover': { hyph: 'four-leaf clo-ver', from: 'fairy ring', when: 'dawn', rare: 'ring', virtues: ['breaks glamour'],
               color: '#5fae4a', temper: [-1, -1], size: [1, 1], stack: 3 },
  // what ran down from the altar candles (gen/under.js): old salves were bound with wax
  // a letter in your pack: each is itself (js/mail.js; its lot's provenance names it), so one to a box
  letter:    { from: 'given', keep: 36500, color: '#d9c8a2', pic: ['sprites/items/letter.png'], size: [1, 1], stack: 1, use: 'letter' },
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

  // ---- what the folk cook, and what you make of a pot with no recipe (docs/cooking.md):
  // filling, but they haven't the book dishes' spell points ----
  'acorn porridge': { group: 'dish', from: 'a cook', color: '#8a6a3a', size: [2, 1], stack: 1, eat: { stamina: 22, health: 2 } },
  'rabbit stew':    { group: 'dish', from: 'a cook', color: '#7a4a32', size: [2, 1], stack: 1, eat: { stamina: 28, health: 4 } },
  'root stew':      { group: 'dish', from: 'a cook', color: '#8a6e3e', size: [2, 1], stack: 1, eat: { stamina: 20, health: 2 } },
  'fish stew':      { group: 'dish', from: 'a cook', color: '#a8a68a', size: [2, 1], stack: 1, eat: { stamina: 24, health: 3 } },
  'pottage':        { group: 'dish', from: 'a cook', color: '#6f7a40', size: [2, 1], stack: 1, eat: { stamina: 22, health: 3 } },
  'chamomile tea':  { group: 'dish', from: 'a cook', color: '#d8c56a', size: [1, 2], stack: 1, eat: { stamina: 8, health: 2 } },
  'plain boil':     { group: 'dish', from: 'a cook', color: '#857a60', size: [2, 1], stack: 1, eat: { stamina: 14 } },

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

  // ---- materials for making instruments (making.js; docs/music.md "Making instruments"):
  // not food, not trinkets. Elder stems off the elder bushes; a hide and gut off a kill (the
  // folk's hunters keep them). Board and wire come up the road with the traders (js/traders.js) ----
  // elder's soft pith pushes out of a green stem, leaving a tube: the old pipe and whistle wood
  // cut from shrubs, stacked by a fire or laid into a new one (docs/cooking.md); use: lay a fire
  wood: { label: 'firewood', group: 'material', use: 'fire', worth: 0.3, from: 'shrubs', color: '#6b4a2a', size: [1, 2], stack: 4 },
  elder: { label: 'elder stem', group: 'material', worth: 0.5, from: 'elder bushes', color: '#8a7a4e', size: [1, 3], stack: 4,
           look: ['An elder stem', 'A straight green stem, soft at the heart.'] },
  hide:  { group: 'material', worth: 1.2, from: 'a kill', color: '#9a7a5a', size: [2, 2], stack: 2,
           look: ['A hide', 'Scraped clean and dried stiff.'] },
  fleece: { group: 'material', worth: 1.5, from: 'shearing', color: '#d8ccb0', size: [3, 2], stack: 1,
            look: ['A fleece', 'All in a piece, greasy and warm, and it smells of sheep.'] },
  gut:   { group: 'material', worth: 0.8, from: 'a kill', color: '#d8c8a0', size: [1, 1], stack: 6,
           look: ['Gut string', 'Cleaned, twisted and dried into a cord.'] },
  board: { label: 'seasoned board', group: 'material', worth: 1.5, from: 'foreign parts', color: '#b08a5a', size: [1, 3], stack: 2,
           look: ['A seasoned board', 'Old timber, dry right through, that will not warp.'] },
  wire:  { group: 'material', worth: 2, from: 'foreign parts', color: '#c0a060', size: [1, 1], stack: 4,
           look: ['Wire', 'A coil of fine brass wire.'] },

  // ---- what the traders bring along the road (js/traders.js, docs/economy.md). Salt goes on a house's harvest
  // and is used up by it; a blade makes its digging quicker till it wears out. Neither is food ----
  salt:  { group: 'foreign', worth: 1.3, keep: 365, from: 'foreign parts', color: '#e8e4d8', temper: [1, -3], virtues: ['keeping'], size: [1, 1], stack: 6,
           look: ['Salt', 'Grey sea salt, in a twist of cloth.'] },
  iron:  { label: 'iron blade', group: 'foreign', worth: 3, keep: 3650, from: 'foreign parts', color: '#6a6e74', size: [1, 2], stack: 1,
           look: ['An iron blade', 'A spade-iron, to shoe the edge of a wooden digging spade.'] },

  // ---- instruments (docs/music.md): found where nobody plays them any more, played from
  // the pack (main.js playFromPack) with the tunes you've read; their sound is sampled,
  // instruments/instruments.json. Not food, not trinkets. Given to the folk, or traded to
  // anyone without one (`worth`, trade.js); music-sim.js plays them at the fires ----
  // `span`: how long its longer side is, in u (1u ≈ 0.67 m), when it lies about underground
  // (under-view.js stands its picture up at that size)
  // the oldest instruments anyone has found are bird-bone flutes, in caves
  'bone flute':   { span: 0.45, group: 'instrument', use: 'play', worth: 2.5, from: 'the deep', color: '#e6dcc2', size: [1, 3], stack: 1,
                    look: ['A bone flute', "A bird's wing-bone, holed for the fingers, lying in the silt."], pic: ['sprites/items/bone_flute.png'] },
  'tabor pipe':   { span: 0.6, label: 'pipe', group: 'instrument', use: 'play', worth: 2, from: 'tombs', color: '#a07a4a', size: [1, 3], stack: 1,
                    look: ['A pipe', 'A wooden pipe with three holes, the kind played with one hand.'], pic: ['sprites/items/tabor_pipe.png'] },
  vielle:         { span: 0.95, label: 'fiddle', group: 'instrument', use: 'play', worth: 4, from: 'tombs', color: '#8a4e2a', size: [2, 4], stack: 1,
                    look: ['A fiddle', 'Laid away with its bow, as if for its player.'], pic: ['sprites/items/fiddle_1.png'] },
  psaltery:       { span: 0.8, group: 'instrument', use: 'play', worth: 3.5, from: 'tombs', color: '#b08850', size: [3, 2], stack: 1,
                    look: ['A psaltery', 'A board strung with wire, still nearly in tune.'], pic: ['sprites/items/psaltery.png'] },
  // a small drum with a snare across its head, played with one stick (and a pipe in the other hand)
  tabor:          { span: 0.55, label: 'tabor', group: 'instrument', use: 'play', worth: 2, from: 'tombs', color: '#9a7046', size: [2, 2], stack: 1,
                    look: ['A tabor', 'A little drum, its head still tight, its stick tucked in the cord.'], pic: ['sprites/items/tabor.png'] },
  harp:           { span: 1.2, group: 'instrument', use: 'play', worth: 5, from: 'Faerie', color: '#d8b44a', size: [2, 4], stack: 1,
                    look: ['A harp', 'Gilt, and strung with something finer than gut.'], pic: ['sprites/items/harp_1.png'] },
  'silver pipes': { span: 0.6, group: 'instrument', use: 'play', worth: 4.5, from: 'Faerie', color: '#c8ced6', size: [1, 3], stack: 1,
                    look: ['Silver pipes', 'A flute of silver, cold, without a mark on it.'], pic: ['sprites/items/silver_pipes.png'] },

  // ---- the telescope (docs/telescope.md): laid in a few tombs (gen/under.js instruments), and
  // given or sold to the stargazers, who want nothing more. Not food, and no use to anyone else ----
  telescope: { span: 0.9, use: 'look', from: 'tombs', color: '#b08a3e', size: [1, 4], stack: 1,
               look: ['A telescope', 'A long brass tube, with a lens at each end. Laid here with whoever made it.'], pic: ['sprites/items/telescope.png'] },

  // ---- keys (gen/under.js KEY_SETS; docs/under.md "Keys and chests"): the chapel crypt's
  // locked rooms, the bow of each the emblem on its doors. Kept after use, in the pack like
  // anything else for now (a key ring is wanted). Not food, not for trade ----
  'lancet key': { span: 0.42, group: 'key', use: 'unlock', size: [1, 1], stack: 1,
                  look: ['A lancet key', 'Iron, heavy, its bow worked as a lancet window.'], pic: ['sprites/keys/cathedral5.png'] },
  'vesica key': { span: 0.42, group: 'key', use: 'unlock', size: [1, 1], stack: 1,
                  look: ['A vesica key', 'Iron, heavy, its bow worked as a vesica, an eye.'], pic: ['sprites/keys/cathedral4.png'] },
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
export const FOOD_GROUP = tableOf('group', e => e.group && e.group !== 'garden' && e.group !== 'trinket' && e.group !== 'dish' && e.group !== 'instrument' && e.group !== 'material' && e.group !== 'key');
export const DISH_KINDS = kindsWhere(e => e.group === 'dish');
export const CROP_KINDS = kindsWhere(e => e.group === 'garden');
export const TRINKETS   = kindsWhere(e => e.group === 'trinket');
export const WORTHS     = tableOf('worth');
export const DISHES     = tableOf('dish');
export const COLORS     = tableOf('color');
export const LOOKS      = tableOf('look');
// the player can eat it from the pack (vitals.js): it has an `eat`, and isn't raw
export const edible = kind => { const e = INGREDIENTS[kind]; return !!(e && e.eat && !e.raw); };
