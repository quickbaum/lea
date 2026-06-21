# Quickbaum's Lea  (`~/openworld`, served as bub app **openworld**, port 8111)

A browser-based **3D worldbuilding toy / generative simulation**: pre-rendered 2D
sprites walking around a real 3D landscape (the Doom / Daggerfall / Might & Magic
6–8 look), grown procedurally and meant, over time, to become a living
**Faerean Drama** — humanoids, beasts, and plants that inhabit, build, converse,
and form communities.

> Working title in code/title bar: **Quickbaum's Lea**. The current logo art
> (`qbworld.png`) says **"Quickbaum's World"** — naming is *unresolved* (see
> "Open questions"). "Quickbaum" = quicken-tree = **rowan**; the Lea is its meadow.

This README is the re-orientation doc. For the roadmap and the project's deeper
intent in the author's own words, read **`future.md`** (it's the source of truth
for direction and lore; this README documents what *exists*).

---

## 1. Philosophy (why this is built the way it is)

Read `future.md` and the PDFs in **`~/texts`** — they are meant to *deeply* inform
the architecture, not be nodded at. The pillars:

- **Christopher Alexander — a pattern language.** *The Timeless Way of Building*
  and *A Pattern Language*. The whole generator is a hierarchy of **patterns**:
  small, named, parameterized, composable generators. `leaf → tree → grove →
  garden → building → block → neighbourhood → town`. A `tree.maple` *composes*
  `leaf.maple` + `bark.generic`; later a `town` will compose `building` + `path`
  + `garden` the **same way**. Alexander's actual patterns become parameter sets.
- **Tolkien — Faërian Drama.** (*On Fairy-Stories*, *Tolkien's Faërian Drama*.)
  We are programming an Otherworld / sub-creation — a Perilous Realm with its own
  law, not a game of conquest. It is **peaceful**; fashion, dwelling, and talk
  matter more than combat.
- **The Bicameral Mind / The Thirteenth Floor.** NPCs are **automatons** that
  keep their "Way" until a voice tells them otherwise. Rarely, an automaton is
  **inhabited by a real intelligence** (Claude or Ollama) — to them it feels like
  a god/daemon speaking ("inspiration"). This is deliberately **scarce**, mirroring
  bub's own architecture (scarce Claude calls, local models for routine work — see
  `~/CLAUDE.md` and `~/bublog/bub architecture.md`). The dialogue service is the
  seed of this; the in-world "Claude" character is currently a *scripted* tree,
  **not** a live model.

Determinism matters: one `WORLD_SEED` regenerates the same world, so patterns must
be seeded and reproducible.

---

## 2. What exists right now (state)

- **Terrain**: a heightfield with biomes (water / sand / mud / grass / rock) drawn
  with per-vertex colour + a grain texture (grainy retro look). A translucent
  animated water plane; you can't walk into lakes.
- **Maples**: real **3D procedural trees** — recursively grown bark cylinders +
  a canopy of leaf cards from a pre-rendered maple-leaf atlas. The crown model
  imitates a real maple (opposite branching, decurrent spreading crown,
  phototropism = outward/up reach tapered so the trunk stays upright, arching
  tips). **Form follows soil**: rich moist lowland → broad full maples, dry/high →
  lean. GPU-**instanced** so a forest is a few draw calls. Shrubs use the same
  generator with bushier params.
- **NPCs**: ~18 wandering **peasants** (real MnM7 sprite sheets, 8-direction +
  walk-cycle animation). They face the camera (billboards) and pick the correct
  directional frame from the angle between camera and heading.
- **Characters (talkable)**:
  - **Claude** ("Claude Opus 4.8") — a wandering NPC (elf body) with a name tag,
    dialogue portrait = `claude_avatar.png`. Originally my debug avatar; now walks.
    His dialogue can **change the weather** (clouds / time of day / wind) via
    nested options that call `weatherActions` in main.js → `sky` methods.
  - **Puck** — faerie interlocutor, a billboard (`sprites/puck.png`) with a tag.
  - Walk up, press **E** to talk. NPCs **freeze while mid-dialogue**, and the
    world keeps running (it does **not** drop to the splash) so weather changes
    are visible behind the dialogue box. `?clouds=0..1` debug-sets cloud cover.
- **Splash**: `qbworld.png` logo over a dark-green base with animated pixel-art
  **leaves** (`js/leaves.js`, vendored from `~/annotations`). World renders behind;
  it is **paused** (sim `dt=0`) and name tags hide until you enter.
- **Sky** (`js/sky.js`): a **geocentric** model — Sun and Moon ride the ecliptic;
  the whole celestial sphere turns about the pole once per sidereal day. **Stars
  are real** (`sky/stars.json`, ~5044 of mag ≤ 6 from the d3-celestial catalogue)
  so **real constellations** (`sky/constellations.json`, drawn as faint lines)
  appear in correct relative places and rise/set correctly for the observer's
  **latitude**. Gradient sky dome with sun-glow + sunset band, day/night lighting
  (Sky owns the hemisphere + sun + moon lights and the fog/clear colour), Moon
  with computed **phase**, and **clouds as discrete billboard masses** that drift
  with the wind and wrap around the player. Astrology hooks
  (`sky.sunDir`, `sky.moonDir`, `sky.getSunAltitude()`, star directions via the
  rotating `celestial` group) are exposed for later — positions are meant to drive
  events/characters eventually, but don't yet.
- **Minimap**, first-person controls, and a **debug fly-cam** (below).

---

## 3. Architecture & file map

**Engine vs generation library.** The engine is the viewer; `js/gen/` is the
reusable, future-facing generation toolkit.

```
js/
  config.js     SIZE, WATER, PERSON_H, UNITS_PER_M, WORLD_SEED, m(metres)
  rng.js        seeded RNG (mulberry32) + fork()/rand/randint/pick/chance
  textures.js   makeTexture(canvas->THREE), makeGrain(), speckle()
  terrain.js    height(), biome(), terrainType(), walkable(), soilRichness(),
                randomLand(), buildTerrain(scene)
  npc.js        AnimNPC (directional walk + wander + `talking` freeze),
                spawnPeasants(), spawnNamedNPC()  (Claude)
  avatar.js     addAvatar()/addCharacter() — billboard chars w/ name tag (Puck)
  label.js      makeLabel() — camera-facing text sprite (name tags)
  leaves.js     vendored pixel-art foliage (splash bg); window.Leaves.start/stop
  main.js       boot, scene/camera/renderer, lights, minimap, controls, loop,
                splash/pause/nametag logic, Puck widget load + talk
  gen/
    pattern.js  Pattern { name, scale, generate(ctx) } + registry + SCALE ladder
    leaf.js     makeLeafAtlas() — pre-rendered maple leaves  → "leaf.maple"
    bark.js     makeBark() — tileable bark texture           → "bark.generic"
    tree.js     generateTree() recursive 3D tree; TREE_SPECIES/SHRUB_SPECIES
                → patterns "tree.maple", "plant.shrub"
    flora.js    plantWorld(scene,rng) — build archetypes, scatter, GPU-instance
```

**Rendering**: Three.js (r160) via **import map** in `index.html` (`three` +
`three/addons/`). Low internal resolution upscaled with `image-rendering:pixelated`
for the retro look. Sprites use `NearestFilter`, **no mipmaps** (mipmaps caused a
green halo from keyed-pixel bleed, and blur).

---

## 4. Services & infrastructure (this is a bub app — see `~/CLAUDE.md`)

- **openworld** — port **8111**, `~/openworld/server.py` (stdlib static server,
  binds 127.0.0.1, path-traversal guarded, `/health`). systemd **user** unit
  `openworld.service`. Registered in `~/bub/ports.json`, fronted by Caddy with
  forward-auth (roles ilya/missvu). `server.py` reads files fresh — **no restart
  needed for edits** to html/js/assets.
- **Dialogue is now in-game** (`js/dialog.js`), not a separate service. It was
  briefly the standalone `~/puck/` service on port 8112 (now **disabled &
  unregistered** — the cross-port split was over-engineered for one game; the
  `~/puck/` dir is an orphan, safe to delete). `talk(name, {actions, onClose})`
  loads `dialogs/<name>.json` (same-origin fetch), renders portrait + text
  (parses `[[node|label]]` links) + choices, back-history, auto "ask else"/
  "farewell". A choice may carry `action` (a key into the caller's `actions` map)
  and/or `next` (omit `next` on an action choice to re-render the node, so it
  repeats). Trees: `dialogs/claude.json`, `dialogs/lea.json` (Puck).
- After editing `ports.json`/roles: `sudo -n env HOME=/home/ilya python3
  ~/bub/gen_caddyfile.py --install` (note the `HOME=` — without it `Path.home()`
  becomes `/root`).

---

## 5. Asset pipeline (MnM7 sprites)

Sprites are ripped Might & Magic VII sheets from The Spriters Resource — **local
placeholders behind the auth wall only**, not for public release.

- `fetch_sprites.py` — scraped all 72 sheets into `sprites/*.png` (+ manifest).
- `process_peasants.py` — old approach: single front billboard per peasant →
  `sprites/billboards/` (now used for Puck-style static billboards / aspect lookup).
- `process_npc.py` — **current**: decodes each 18×6, 256px-cell sheet
  (rows 0–4 = 5 directions front/¾/side/back¾/back; col 0 = stand; cols 9–17 =
  9-frame walk) into a packed **atlas** per character → `sprites/npc/<slug>.png` +
  `sprites/npc/manifest.json` (cols/rows/standCol/walkStart/walkLen/frameW/frameH).
  8 peasants done; 2 female sheets skipped (non-standard widths 19/26 cols).
- Background keying auto-detects each sheet's corner colour (cyan/yellow/green).
- `qbworld.png` logo, `claude_avatar.png` portrait (also copied to `~/puck/`).

---

## 6. Controls & debug

In-world: **WASD** move, **mouse** look (click to lock), **shift** run, **E** talk
(when near a character), **esc** release.

Debug (great with the headless renderer below):
- `?debug` — hide splash, run world, show name tags.
- `?x=&z=&y=&yaw=&pitch=&fly=1` — set camera pose / free-fly (Q down, Space up).
  In-world press **P** to copy the current pose URL, **F** to toggle fly.
- `?cx=&cz=&name=` — place/rename the Claude avatar.
- `?talk=lea` / `?talk=claude` — auto-open a dialogue (for screenshots).
- **Sky**: `?time=` (0=midnight, 0.5=noon), `?daylen=` (real sec/cycle, default 600),
  `?lat=` (latitude °, default 42), `?sunlon=` (sun ecliptic longitude °, the season).

`yaw=0` looks toward **−z**; `yaw=π` toward +z.

---

## 7. How to verify changes (headless Chromium)

bub is headless; I render screenshots with software WebGL:

```
timeout 120 chromium --headless=new --no-sandbox --disable-gpu --use-gl=swiftshader \
  --enable-unsafe-swiftshader --window-size=900,600 --hide-scrollbars \
  --virtual-time-budget=8000 --screenshot=/tmp/shot.png \
  "http://127.0.0.1:8111/?debug" 2>/dev/null
pkill -9 -f "[-]-headless"            # ALWAYS clean up — stray chromium = hung terminal
```
Then Read `/tmp/shot.png`.

**Gotchas (these caused real "terminal hangs"):**
- The splash leaf animation (continuous `requestAnimationFrame`) makes
  `--virtual-time-budget` **slow/hang**; for splash shots use a generous `timeout`
  or capture without virtual-time. For in-world shots use `?debug` (stops leaves).
- Always wrap in `timeout` and `pkill -9 -f "[-]-headless"` after. Verify with
  `ps -C chromium` (note: `pgrep chromium` also matches your own shell command —
  use `ps -C chromium`).
- Syntax-check ES modules before rendering: `cp f.js /tmp/c.mjs && node --check /tmp/c.mjs`.

There is **no GUI** on bub; everything is viewed on a real device via Caddy (LAN)
or these headless shots.

---

## 8. Non-obvious decisions / gotchas

- **Cross-port without CORS**: load shared JS/portraits with `<script>`/`<img>`
  (cookie-authed) instead of `fetch` (which hits Caddy's CORS-preflight wall).
- **Walking-backwards bug** was a sign error in the camera-vs-heading angle (now
  `heading - toCam`); **bending trees** were from outward-pull applied to the
  lower trunk (now tapered to ~0 near the trunk).
- **Texture clone before image load** leaves blanks — load fully, then clone.
- Heights are realistic via `UNITS_PER_M` (a peasant ≈ 1.75 m ≈ 2.6 units); trees
  are scaled to a target height from their bounding box.

---

## 9. Open questions / immediate next steps

- **Naming**: logo says "World", title says "Lea" — pick one (or regen logo).
- **Texts guide**: produce a page-referenced navigation guide to the `~/texts`
  PDFs (Ilya has physical copies → cite page numbers) so patterns can be designed
  from Alexander/Tolkien directly. High-leverage, foundational.
- **Roadmap** (`future.md`): grove pattern (clustering = the machinery towns
  reuse) → **rowan** + fruit trees (the namesake!) → undergrowth → distance LOD
  via the leaf-sim impostor → simulant routines/NPC-to-NPC talk + the bicameral
  "inspiration" mechanic → **settlements (the real goal)** → clothing/fashion
  (color-mask tinting + reuse `~/wagara` as a dependency).

Suggested arc: **ground (texts) + identity → grove + rowan → simulants → settlements**.
