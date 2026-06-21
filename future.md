# QuickBaum's World — future directions

Short notes on where the generator goes next. The architecture (see `js/gen/`)
is a **pattern language** (after Christopher Alexander): small patterns compose
into larger ones — leaf → tree → grove → garden → building → block → town — all
seeded and deterministic. Each idea below is "just another pattern." 


## Texts

In the ~/texts directory there are several PDFs that are required to understand for this project. You may find it helpful to summarize or provide a rough guide for navigating each of those documents so that you don't re-read, or rely on inefficient searches. You may also want to do some research around the texts - their context in history, how other people are talking about them, etc, if this is helpful.

> **Navigation guides written:** see `docs/texts/` — one md per text (with page
> numbers / pattern numbers for Ilya's physical copies) plus `README.md` (index +
> through-line). Use those to jump into a text instead of re-reading the PDFs.

Ilz has physical copies of those books, so you should refer to page numbers for him  to quickly reference something.

There are two texts by Christopher Alexander:
- The Timeless Way of Building
- A Pattern Language
Both of these have been extensively applied to software (design patterns) but this project is more focused on exploring them as they relate to "Faerean Dramas" which one may think of as simulations of groups of elements in the natural world - humanoids, beasts, plants. Our own Faerean Drama. QuickBaum's Lea. We will have these simulants building structures, communities, and truly inhabiting the world. They will be talking to one another and to the player.

Not included but relevant is the Bicameral Mind, and the Thirteenth Floor. The characters in the game are automatons, but sometimes are inhabited by intelligences such as Claude and Ollama. But those resources are extremely scarce, and should occur infrequently. One may call this "inspiration", but since the characters are bicameral they may consider it like talking to daemons and gods. Read the bublog to understand and expand on how this relates to the bub's original architecture.

Included also are texts by and about Tolkien, where he describes Faerean Dramas and Faerie Stories. These are important because we are generating an Otherworld, programming a Faerean Drama. I don't want to merely nod at ideas in these texts, but to have them deeply inform the architecture and spirit of the worldbuilding tool we are co-creating.

Not included, but should consider learning a bit about: the lore of the actual Might and Magic franchise, specifically the world of XEEN and its spaceship planets (we are not just ripping sprites from there, but also the idea of artificial "planets") and also The Death Gate Cycle (which has artificial worlds into which elves, dwarves, and humans are sent after the sundering of the original earth). These connect thematically with the spirit of the game.



## The Sky

The sky should be rendered simply, but interestingly. a sun and moon orbit this planet (it's geocentric for now) and at night you should be able to see the stars which are positioned according to a model similar to the ancient one, with real world constellations appearing in correct places. clouds are also possible. 

there is a file stars3.gif which can serve as inspiration. don't use that actual animation but see the way that the pixel art stars are constructed and animated, and the color palette. 


## NPC behavior & interaction

See **`docs/npc-behavior.md`** — the design for NPC drives, NPC-to-NPC
interaction, rituals, and the bicameral "inhabitation" seam (the smart-object /
ant-farm / pattern-language synthesis). Starts from the campfire gathering and
grows the same machinery up into towns. The two notes below feed into it.

## More NPC dialogs

Give each NPC a dialog. These are initially very simple ones - avoid inventing lore and personalities just yet, because that's something we are still planning. For now, all the NPCs should merely act confused - they have some awareness of what they look like and what the world around them looks like, but no additional info. they don't know how the world works or what their purpose is in it.

## NPC Names

This is harder than it looks. In order for them to have names, they need to belong to a culture, and the cultures must be procedurally generated - linguistics and more. We will code the generators that define the ways of NPC cultures. The cultures also define the rituals of its members. this includes things like gathering in a circle to dance, or foraging berries in the forest. 


## The astrologer NPC

One of the NPCs should be an astrologer, and you should be able to ask him things about the actual positioning of the stars. The answers are not pre-programmed, but actually reflects the in-game heavens at that moment. Later, other NPCs will be able to inquire about astrological events and their interpretation and relay such knowledge to others, and that knowledge may affect behavior.

## Puck

Puck has no walk animation, but it should be able to hop around. Flip the puck to set direction (the sprite is facing left, so flip when he is going right). When puck is moving away from the player, use the `puck_back.png` sprite. Puck should sometimes avoid the player, or run around the trees. It should be a bit smaller, and there can be more than one, sometimes a large group of them hopping together. These groups can spawn and disappear - they are magical creatures.


## Flora
- **Grove pattern** (`grove`, composes `tree.maple`): place trees in clusters
  with varied spacing, age, and a clearing or two, instead of the current
  uniform scatter. Edges denser, interior taller-and-leaner (competition for
  light), matching how real stands fill in.
- **More species**: conifer (strong central leader, drooping needle cards),
  birch, oak — each a param preset + maybe its own leaf/bark asset-pattern. we definitely need rowan trees, and other fruit bearing trees.
- **Undergrowth & ground cover**: ferns, grass tufts, flowers as cheap cards;
  density driven by `soilRichness` and light (sparse under dense canopy).

## Rendering / performance
- **Distance LOD via the annotations leaf sim.** The `~/annotations` project
  (`dist/leaves.js`) renders trees as **2D pixel-art canopies shaded as lit
  spheres** — depth-zone palettes (light from the upper-right), per-leaf
  micro-shading, wind animation, no geometry. That's far cheaper than our 3D
  trees. Idea: keep full 3D up close, and **swap distant trees to that flat
  lit-canopy billboard** (impostor) past some range. Same canopy *look*, a
  fraction of the cost — lets us push tree counts way up. Worth prototyping the
  lit-sphere shading as a reusable canopy texture either way.
- **Instanced LOD / impostors**, frustculling tuning, and a leaf-card budget per
  archetype so big forests stay smooth on the Pi's own screen.

## World & interaction
- [x] **Trunk collision**: tree/shrub trunks are blocked circles; NPCs steer
  around them and the player can't walk through them (`js/agents.js` obstacles;
  see `docs/trails.md`).
- **Settlements (the real goal)**: introduce the `building`, `path`, `garden`,
  `block`, `neighbourhood`, `town` patterns. Reuse the exact machinery — a
  `town` composes buildings + paths + gardens the way `tree.maple` composes
  leaves + bark. Alexander's actual patterns (e.g. *Building Complex*, *Green
  Streets*, *Positive Outdoor Space*) become the parameter sets.
- **Ecology/season**: leaf colour shift by season; trees thinning toward
  treeline/altitude; water-loving species hugging the lakes.


## Clothing

Some of the test sprites in the game are colored for tinting: for example, the beard of one peasant is green and vest magenta. This is so that colors can be applied to them. 

We should do this, but perhaps even more: if clothing is clearly masked by color, we can apply textures to it. And we already have one texture generator on the bub, in ~/wagara! Let's re-use it (not re-implement, but actually make it so that the tools work together), wagara is a dependency of this project.

In the future, the clothing system will be even more complex. Since this game, compared to Might and Magic and Daggerfall, is a peaceful one, and fashion is a part of it. We want to draw inspiration of dressup games - especially 2D ones, of which some are kinda popular right now. The challenge will be in applying clothing on top of these pre-rendered models. 

## FAQ FOR DEVS (this info shouldn't make its way into the game in any sense, it's just for the devs)
Is Quickbaum a Jewish name?
It's an old English pun that comes from Tolkien, who was a philosemite. And the game is about simulating a Way. It is the Lea. [[AvLee]]. The template. The kit. Like the Yiddish Kit, or the Celtic. 


## Places in the world
- Gamble Gold's Gay Green Woods


## Music

[x] The game should play music while the window is active. In `~/sounds/1992 - Heroes of Might and Magic II - The Succession Wars` there are flac files for various terrains. We can use them as placeholders, though ultimately the goal will be to procedurally generate the music so that it has a similar feel. The goal is to create an immersive ambiance.


## Renaming the project
[x] Quickbaum's Lea


