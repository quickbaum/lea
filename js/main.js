import * as THREE from 'three';
import { SIZE, WATER, WORLD_SEED, WORLD_R, WORLD } from './config.js';
import { mulberry32, fork } from './rng.js';
import { height, biome, walkable, buildTerrain, terrainType, soilRichness, pace, setWearSource, settlements, ruins, under } from './terrain.js';
import { spawnPeasants, spawnNamedNPC } from './npc.js';
import { PuckFlock } from './puck.js';
import { Warren } from './fauna.js';
import { plantWorld, cullFlora, floraTilesDrawn, setFloraLod } from './gen/flora.js';
import { MusicPlayer } from './music.js';
import { Footsteps } from './footsteps.js';
import { Boats, CanoeBedView } from './boats.js';
import { fishingSpots, fishingGrounds } from './gen/fishing.js';
import { habitat } from './gen/land.js';
import { makeFishingView } from './fishing-view.js';
import { Ambience } from './ambience.js';
import { Sky } from './sky.js';
import { SkyPicker } from './skypicker.js';
import { AgentWorld, CULTURES, dishName } from './agents.js';
import { factIcon, idleMove, setSayings, knowDish } from './convo.js';
import { RECIPES, RAW_KINDS, RARE, BOOK_RECIPES, stepsKnown, memoryOf } from './recipes.js';
import { INGREDIENTS, LOOKS, ingredient, edible } from './ingredients.js';
import { makePack } from './pack.js';
import { packView } from './pack-view.js';
import { makeJournal } from './journal.js';
import { journalView } from './journal-view.js';
import { describe as describeProv, THIN_R, DAWN, isDawn } from './provenance.js';
import { PREPARATIONS, shelfBook, wantsMet, daysToNewMoon, NEW_MOON } from './stillroom.js';
import { houseName, phaseName } from './astrology.js';
import { makeVitals, tickVitals, canRun, spend, eat, eatValue, SP_MAX, ST_MAX } from './vitals.js';
import { worth, isWild, VALUABLES } from './trade.js';
import { addFood, countOf, rawOf, rawKinds, addRaw, giveForDish } from './larder.js';
import { CampfireView, ShelterView, HutView, FireLights } from './campfire-view.js';
import { ShrineView } from './shrine-view.js';
import { TrailField } from './trails.js';
import { buildRoad } from './road-view.js';
import { buildSettlements } from './settle-view.js';
import { buildRuins } from './ruins-view.js';
import { buildEntrances, buildLevelView, entranceHit } from './under-view.js';
import { buildLevel } from './gen/under.js';
import { buildStairView, buildGroundsView } from './faerie-places-view.js';
import { juliaWarm } from './julia-tex.js';
import { walkOf, wayNote, roadFrom } from './ways.js';
import { GrassDetail } from './grass.js';
import * as wojak from './wojak.js';
import { faceParts, composeFace, composeHead } from './face.js';
import { bakeFolk } from './folk-avatars.js';
const LEA_FACE_CARDS = false;   // painted face card over Lea sprites in-world (see below)
import { markBackdrop } from './kin-mark.js';
import { sampleFaceSkin } from './headscan.js';
import { generateCrown, PORTRAIT_SCALE, PORTRAIT_ANCHOR_X, PORTRAIT_BOTTOM_Y } from './crown.js';
import { makeSociety, makeHouseholds } from './society.js';
import { makeOmen } from './astrology.js';
import { talk, talkTree, loadTree } from './dialog.js';
import { readPage } from './page.js';
import { FAERIE_BOOKS } from './faerie-books.js';
import { makePuckGuide } from './puck-guide.js';
import { createHands } from './hands.js';
import { bakeMissing } from './spritebaker.js';
import { Rain } from './rain.js';
import { intakeRumor } from './rumor.js';
import { Fireworks } from './firework.js';
import { FaerieSight } from './faerie-view.js';
import { planPortals, palaceSpec, portalPaths, buildFaerie, groundsSpec, stairSpec, GROUNDS, STAIR } from './gen/faerie.js';
import { planRoute } from './guide.js';
import { Mycelium } from './mycelium.js';
import { treeVoice, facedTreeVoice, ringTree, woodRumour } from './wood-talk.js';
import { TreeFaces } from './tree-faces.js';
import { createMaps } from './map.js';
import { places, placeAt, placePhrase, settlementNames, ruinNames, underNames } from './gen/places.js';
import { makeTalkView } from './talk-view.js';
import { makeTosses } from './toss.js';

// Bake any sprites that are in tools/bakes.json but not yet on disk.
// Runs in the user's Chrome (real GPU) and saves results to the server.
// Fire-and-forget — first visit bakes, subsequent visits skip.
bakeMissing();

// ---------- renderer (low internal res, upscaled for the retro look) ----------
const canvas = document.getElementById('c');
// high-performance: on a laptop with two GPUs, ask for the discrete one
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let PIXEL = 4;     // 3 → 4 on 2026-10-20: chunkier, ~44% fewer pixels; the settings panel moves it
function resize(){
  renderer.setPixelRatio(1);
  renderer.setSize(Math.floor(innerWidth/PIXEL), Math.floor(innerHeight/PIXEL), false);
  canvas.style.width = innerWidth + 'px';
  canvas.style.height = innerHeight + 'px';
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const scene = new THREE.Scene();
const SKY = 0x9fc6e8;

scene.background = new THREE.Color(SKY);
// Draw distance. The fog is the real horizon — nothing past FOG_FAR is visible,
// so it is also what cullFlora() uses to decide which trees to send to the GPU.
// Pulled in from 170 when the world doubled: a nearer haze both costs less and
// keeps the Lea feeling like woodland rather than an empty plain.
let FOG_NEAR = 30, FOG_FAR = 130;   // `let`: the settings panel's draw distance moves them
scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
const EYE = 1.7;
const EYE_BOAT = 1.32;     // seated in the canoe (above the floating gunwale)

// Lighting + sky (sun/moon/stars/clouds) are owned by Sky — see js/sky.js.

// ---------- world ----------
const rng = mulberry32(WORLD_SEED);
const { ground, waterTex } = buildTerrain(scene);
buildRoad(scene);                                          // the Old Road's paving (js/gen/road.js)
const settleView = buildSettlements(scene);                // the villages' wooden buildings (js/gen/settle.js)
buildRuins(scene);                                         // the old stone ruins, mostly far from the road (js/gen/ruins.js)
buildEntrances(scene);                                     // cave mouths and the crypt stair (js/gen/under.js)
const forage = plantWorld(scene, fork(rng), { ground });   // ground passed so duff can be painted under trees
const boats = new Boats(scene); boats.scatter(fork(rng));   // communal canoes moored at the lakeshores

// The wood's own news network, under everything: trees linked through fungus into
// two guilds that don't interconnect, carrying what they feel (feet, cutting, fire)
// slowly outward. See js/mycelium.js for the model, js/wood-talk.js for the voice,
// docs/mycelium.md for the biology and what of it is actually evidenced.
// its own stream off WORLD_SEED rather than a fork() of the shared chain: adding a
// subsystem must not renumber the ones after it, or the same seed grows different
// people. Determinism is per-seed reproducibility, not just "seeded somewhere".
const myc = new Mycelium(forage.treeRecords,
  { rng: mulberry32((WORLD_SEED ^ 0x6d7963) >>> 0), height, soil: soilRichness });
// The strongest rings get a voice: only where the network genuinely runs deep is
// there enough of an organism present to have an opinion. The rest are just food.
// Ranked rather than thresholded, so a given world always has some — how deep
// "deep" is depends on the wood that seed happened to grow.
{
  const caps = forage.plants
    .filter(p => p.kind === 'mushrooms' || p.kind === 'morels')
    .map(p => ({ p, node: myc.nearest(p.x, p.z, 14), s: myc.strengthAt(p.x, p.z) }))
    .filter(r => r.node)
    .sort((a, b) => b.s - a.s);
  for (const r of caps.slice(0, Math.max(1, Math.round(caps.length / 3)))){
    r.p.ring = true; r.p.ringNode = r.node;
  }
}

// The faced trees: the great broad hardwoods carry a carved face (always visible,
// one side only) and — unlike the sense-only wood — actually speak. Chosen by
// physical bigness (bole radius × height × the network depth beneath them), spaced
// apart so each is a landmark, and biased to the biggest — they should be
// remarkable, not just well-connected. Redwoods are the true giants but the WRONG
// shape: their broad root flare is far wider than the upper bole, so an eye-height
// face buries in it — so faces go on the great OAKS and maples, whose straight
// boles wear one cleanly. Face turned toward the middle of the world so a wanderer
// meets their gaze.
const facedTrees = (() => {
  const FACE_KINDS = new Set(['oak', 'maple']);
  // firm, dry, open ground: reeds/cattails grow on mud near water, so a gathering
  // oak wants solid grass all around — no mud or water within reach, or the glade
  // would re-choke with swamp growth the clearing doesn't track
  const dry = (x, z) => {
    if (terrainType(x, z) !== 'grass') return false;
    for (let a = 0; a < 10; a++){ const t = a / 10 * Math.PI * 2;   // just the glade radius
      const tt = terrainType(x + Math.cos(t) * 6.5, z + Math.sin(t) * 6.5);
      if (tt === 'mud' || tt === 'water') return false;
    }
    return true;
  };
  const size = n => ((n.trunkR || 0.3) * n.scale) * ((n.trunkH || 8) * n.scale) * (1 + n.reach * 0.25)
                  * (n.base === 'oak' ? 1.3 : 1);        // oaks read as the "wise tree" — favour them
  const ranked = myc.nodes.filter(n => FACE_KINDS.has(n.base) && dry(n.x, n.z)).sort((a, b) => size(b) - size(a));
  const picked = [];
  for (const n of ranked){
    if (picked.length >= 24) break;
    if (picked.some(p => Math.hypot(p.x - n.x, p.z - n.z) < 40)) continue;   // spread them out
    picked.push(n);
  }
  return picked;
})();
for (const e of facedTrees) e.faced = true;
const treeFaces = new TreeFaces(scene, height);
treeFaces.load(facedTrees.map(node => ({ node, yaw: Math.atan2(-node.x, -node.z) })))
  .then(tf => { if (new URLSearchParams(location.search).has('gaze')) tf.faces.forEach(f => { f.forceOn = true; }); });

// agent layer: NPC drives + the affordance substrate + the campfire ritual.
// See docs/npc-behavior.md. Behaviour lives in the world (smart objects), not
// in the NPC's head.
// Seeded: personas, names, stargazers, fauna spawns all derive from WORLD_SEED
// (ephemeral jitter inside the agent layer stays on Math.random by design).
// The agent layer is sim-only; hearth, lean-to & hut meshes are injected here.
const agents = new AgentWorld(scene, { rng: fork(rng),
  makeFireView: f => new CampfireView(f), makeShelterView: s => new ShelterView(s),
  makeHutView: h => new HutView(h), makeCanoeView: b => new CanoeBedView(b),
  makeShrineView: s => { const v = new ShrineView(s); scene.add(v.group); return v; } });
// the dwellers' talk as speech bubbles, and hand-overs as a tossed sprite (docs/talk.md)
const talkView = makeTalkView({ camera, canvas, lineFor: moveLine });
// a move stays up as long as its words take to read, so the sim asks for them (convo.js _speak)
agents.lineOf = m => (m.line ??= moveLine(m));
const tosses = makeTosses(scene);
agents.onSocial = e => { talkView.onSocial(e); tosses.onSocial(e, pos.x, pos.z); };
// the proverbs, verses and song lines folk answer talk with (tools/build_sayings.py)
const SAYINGS = new Map();
fetch('sayings.json').then(r => r.json()).then(d => { for (const s of d.sayings) SAYINGS.set(s.id, s); setSayings(d.sayings); })
  .catch(e => console.warn('no sayings:', e));
const fireLights = new FireLights(scene);                 // hearths borrow these; the count never changes
agents.setTrees(forage.trees);                             // so the hearth lands in a clearing
agents.setObstacles(forage.obstacles);                    // trunks & shrubs people walk around
agents.buildNav();                                        // A* walkability grid (routes around water/trees)
agents.setHouses(settlements());                          // the village dwellings, each with its hearth lit (docs/settlements.md)
agents.setShrubs(forage.shrubs);                           // choppable firewood for the fires
// Great faced trees the folk revere & visit. Each carries an ear: `hear()` hands
// the sim whatever the wood is actually carrying at that tree, phrased as the
// dialogue phrases it — so a root-wise pilgrim can take it away as gossip. The
// agent layer never learns what a mycelium is (docs/sacred-trees.md §H, Dodona).
agents.setShrines(facedTrees.map(node => ({
  x: node.x, z: node.z,
  hear: () => {
    const f = myc.heard(node)[0];
    return f ? { key: f.key, text: woodRumour(node, f, woodCtx()) } : null;
  },
})));
// ?rite — debug: show a shrine already built, without waiting days for the folk
if (new URLSearchParams(location.search).has('rite'))
  for (const sh of agents.shrines)
    for (const r of sh.rings) for (const s of r.slots)
      sh.place(s, s.precious ? ['amber', 'quartz', 'shell'][(s.ring + r.slots.indexOf(s)) % 3] : 'stone');
// no pre-placed fire — the folk raise their own organically (curfew/stranded
// logic in agents.js), so hearths emerge where people actually gather.
agents.setBoats(boats);                                    // communal canoes NPCs ferry across the water
agents.setBirches(forage.treeRecords.filter(t => t.species === 'birch'));   // bark for the canoes the folk make (docs/boats.md)
agents.setFood(forage.plants);                             // bushes/trees double as food sources
agents.setValuables(forage.valuables);                     // rare finds people gather & trade
agents.setFishing(fishingSpots({ height, walkable, water: WATER, radius: WORLD_R, habitat,   // places on the bank to fish (docs/fishing.md)
  rng: mulberry32((WORLD_SEED ^ 0xf15b) >>> 0) }),
  fishingGrounds({ height, water: WATER, radius: WORLD_R, rng: mulberry32((WORLD_SEED ^ 0xb0a7) >>> 0) }));   // …and out on the deep water, from a boat
const fishView = makeFishingView(scene, { water: WATER });
agents.setFlowers(forage.flowers || []);                   // wildflowers female elves pick for crown-making
agents.setOnCrownMade(async (npc, flowerIds) => {
  const crownCanvas = await generateCrown(flowerIds);
  npc.wearCrown(crownCanvas);
  // The in-world sprite shows the crown via wearCrown. TODO: overlay the flower
  // crown on the painted-face portrait too (the old PORTRAIT_* params were tuned
  // for the 100×100 wojak portrait, not the new head template).
});
agents.spawnFauna();                                       // rabbits — quarry that roam, flee & are hunted (docs/hunting.md)
let warren = null;
new Warren(scene, agents.fauna).load().then(w => { warren = w; });   // draws the rabbits

// trails: a wear field that NPCs (and the player) tread into bare paths over
// time, suppressing grass on the route. See docs/trails.md.
const trail = new TrailField(ground);
setWearSource((x, z) => trail.wearAt(x, z));    // worn ground is quicker going (terrain.js pace)
forage.reeds.forEach(g => trail.addGrass(g));   // tall swamp grass also thins off trodden paths
forage.ferns.forEach(g => trail.addGrass(g));   // woodland ferns also thin off trodden paths
forage.groundCover.forEach(g => trail.addGrass(g));   // sedge, cotton grass, heather too

// keep a glade open around each faced tree: the folk visit them, and overgrowth
// shouldn't swallow a great tree's face. A permanent soft clearing bares the
// ground and empties the grass/reeds/ferns there (reusing the trail suppression),
// scaled to the trunk. Shrubs standing in the glade are cleared too.
for (const n of facedTrees){
  const r = Math.max(4, (n.trunkR || 0.5) * n.scale * 4.5);
  trail.clearing(n.x, n.z, r);
  for (const s of forage.shrubs) if (s.alive !== false && Math.hypot(s.x - n.x, s.z - n.z) < r * 0.8) s.chop();
}
trail.flush();

// decorative single-pixel grass blades that carpet the ground near the camera
// and sway in the wind (cosmetic only; not tracked). See js/grass.js. Concentric
// layers, dense underfoot (so looking down the ground is fully covered) thinning
// out with distance: each is uniform & world-fixed, summed for the falloff. The
// outermost sets how far grass is drawn. trail lets blades keep off trodden paths.
// ONE uniform blade field: constant density, height set only by world location, so
// grass never grows/shrinks or thickens as you approach it (no proximity effects,
// no density ring). Only a gentle alpha dissolve at the far edge, where the clumps
// take over.
const grassDetail = new GrassDetail(scene, { trail, radius: 22, count: 60000, fade: 'alpha' });

// what you carry: a grid of boxes (pack.js, drawn by pack-view.js); `basket` is its
// counts ({ berries: 3 }), kept in step by the pack, for everything that only asks how many
const myPack = makePack();
const basket = myPack.counts;
// your health, stamina and spell points (vitals.js; docs/magic.md "Consuming")
const me = makeVitals();
const basketText = () => Object.entries(basket).map(([k, v]) => `${v} ${k}`).join(', ');
let npcApi = { npcs: [], update(){} };
// the folk form legible social groups (families, clans, bands, lone wanderers),
// each spawning as a cluster on the land — see society.js / docs/texts patterns
const society = makeSociety(fork(rng), WORLD.folk);   // chosen on the start screen
// ...and the villagers, a household to each dwelling, on top of that count (own
// seed stream, so adding them shifts nothing else)
society.push(...makeHouseholds(mulberry32((WORLD_SEED ^ 0x4011e) >>> 0), agents.houses.map(h => h.doorMouth()), society.length));
// Clan Lea — the procedural ANNY avatars baked by tools/bake_leas.py (varying skin,
// gender, body). Injected as a kin group so they get human names sharing the 'Lea'
// surname, wojak portraits, and the assembled peasant dialogue for free. The roster
// (slugs + each body's sampled face skin tone) is written by the baker.
// A stable 32-bit seed per NPC from their (deterministic) identity, so each
// painted face is fixed for a given WORLD_SEED. FNV-1a over name/slug.
function faceSeed(n){
  const s = `${n.name || ''}|${n.given || ''}|${n.surname || ''}|${n.slug || ''}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

fetch('sprites/npc/lea_clan.json').then(r => r.ok ? r.json() : []).catch(() => [])
  .then(clan => {
    // Males only for now — the painted face card is aligned to the male Lea sprite
    // (female heads sit differently; revisit when we have a female alignment).
    clan = clan.filter(e => !e.slug.startsWith('female'));
    if (clan.length){
      const r = fork(rng);
      let leaSpot = [8, 8];
      for (let i = 0; i < 300; i++){ const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * WORLD_R * 0.55;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr; if (walkable(x, z)){ leaSpot = [x, z]; break; } }
      society.push({ id: society.length, kind: 'clan', surname: 'Lea', race: 'human', name: 'Clan Lea',
        cx: leaSpot[0], cz: leaSpot[1], spread: 8, npcs: [],
        members: clan.map((e, i) => ({ slug: e.slug, role: i === 0 ? 'elder' : 'kin', skin: e.skin })) });
    }
    return spawnPeasants(scene, fork(rng), society);
  })
  .then(api => {
    npcApi = api;
    // ?culture=chatty|reserved puts everyone under that manner of talk; mixed
    // alternates by household, so you can watch the two meet (agents.js CULTURES)
    const cq = new URLSearchParams(location.search).get('culture');
    const cultureOf = n => cq === 'mixed' ? (n.group && n.group.id % 2 ? CULTURES.chatty : CULTURES.reserved)
                         : CULTURES[cq] || CULTURES.folk;
    for (const n of api.npcs) agents.attach(n, cultureOf(n));
    for (const g of api.groups) if (g.village) agents.settleIn(g.npcs, agents.houses[g.house]);   // villagers move in
    setLoad('painting faces…', 0.08);
    // Portraits first, then warmTrails. warmTrails pre-simulates synchronously and
    // triggers onCrownMade for any elf who gathers 7 flowers. onCrownMade is async
    // (awaits generateCrown), so it completes after warmTrails returns. If portraits
    // were generated AFTER warmTrails, wojak.ready() could overwrite a crown portrait
    // that onCrownMade had already set. Generating portraits first guarantees the
    // base portrait is always in place before onCrownMade overrides it with the crown.
    return wojak.ready().then(async () => {
      // human villagers get characters of their own, baked here (js/folk-avatars.js)
      // (a failure here must not stop the world loading: they keep their painted sheets)
      try { await bakeFolk(api.npcs, WORLD_SEED, (i, n) => setLoad(`dressing the folk… ${i}/${n}`, 0.08 + 0.1 * i / Math.max(1, n))); }
      catch (e){ console.warn('folk bake skipped:', e); }
      for (const n of api.npcs){
        if (n.baked) continue;                 // own colours and a portrait of their own face
        // wojak still supplies the sprite-recolour palette; the painted modular
        // face (js/face.js) is now the dialog/hover portrait, deterministic per NPC.
        const f = wojak.face(n.gender, n.race, n.skinTone, null);
        if (!n.slug?.includes('-lea-')) n.recolor(f.palette); // Leas have baked wagara colors
        // The baked lea_clan `skin` mis-sampled the garment; read the real face
        // skin off the sprite so the painted skin coverage blends over the head.
        let tone = n.skinTone;
        if (n.slug?.includes('-lea-')){
          const sampled = sampleFaceSkin(n._baseTex.image, n.m);
          if (sampled) tone = sampled;
        }
        const parts = faceParts(mulberry32(faceSeed(n)), { race: n.race, gender: n.gender, tone });
        n.faceParts = parts;
        n.portrait = (await composeFace(parts, { work: 320, size: 460 })).toDataURL();
        // Lea-style sprites can also wear the painted face in-world (a head card over
        // the baked head, shown when facing the camera). Off since 2026-10-20: the
        // card read as pasted-on. The dialog portrait above is unaffected.
        if (LEA_FACE_CARDS && n.slug?.includes('-lea-')){
          // overlay: the painted parts + skin coverage (face/chins tinted to the
          // sampled skin) on transparent, to sit over the Lea's own baked head.
          const headCv = await composeHead(parts, { overlay: true, work: 300, size: 300 });
          const tex = new THREE.CanvasTexture(headCv);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.magFilter = tex.minFilter = THREE.NearestFilter;
          tex.generateMipmaps = false;
          tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
          const fm = n.setFace(tex, headCv.width / headCv.height);
          if (fm) scene.add(fm);
        }
      }
      setLoad('the folk going about their days…', 0.20);
      await warmTrails(120, p => setLoad('the folk going about their days…', 0.20 + 0.80 * p));
      setLoad('ready', 1.0);
    });
  })
  // a failure anywhere in the loading chain says so on the loading line, rather
  // than leaving the last stage's words standing as if it were still working
  .catch(err => {
    console.error('the Lea failed to load:', err);
    if (_loadLabel) _loadLabel.textContent = `the Lea failed to load: ${err && err.message || err}`;
  });

// Loading-bar helpers — track world-warm-up progress on the splash screen.
let _worldReady = false;
const _loadFill   = document.getElementById('loading-fill');
const _loadLabel  = document.getElementById('loading-label');
const _loadStatus = document.getElementById('loading-status');
function setLoad(msg, frac){
  if (_loadLabel) _loadLabel.textContent = msg;
  if (_loadFill)  _loadFill.style.width  = (frac * 100).toFixed(1) + '%';
  if (frac >= 1){
    _worldReady = true;
    // Brief pause so the bar visually completes before swapping to CLICK TO ENTER.
    setTimeout(() => {
      _loadStatus?.classList.add('done');
      setTimeout(() => {
        _loadStatus?.classList.add('hide');
        document.getElementById('enter-text')?.classList.remove('hide');
        document.getElementById('controls-text')?.classList.remove('hide');
      }, 420);
    }, 250);
  }
}

// Pre-simulate the agents (no rendering) so trails are already trodden in by the
// time the player looks. We cycle day/night a few times so both the campfire
// gathering and daytime foraging lay their paths. See docs/trails.md.
async function warmTrails(seconds, onProgress){
  const dt = 0.15, steps = Math.floor(seconds / dt);
  const CHUNK = 40;   // yield to the browser every ~6 simulation-seconds
  for (let s = 0; s < steps; s++){
    agents.night = 0.5 - 0.5 * Math.cos(s / steps * Math.PI * 6);   // ~3 day/night cycles
    agents.day = 1 - agents.night;
    agents.update(dt);                                              // fires burn down -> wood gets gathered
    forage.update(dt);                                              // picked plants regrow during warm-up too
    for (const n of npcApi.npcs) if (n.brain) n.brain.step(dt);
    agents.separate(dt);
    agents.resolveTrees();
    for (const n of npcApi.npcs) if (n.moving) trail.deposit(n.x, n.z, dt);
    trail.tick(dt);
    if (s % 13 === 0) agents.nav.refreshWear(trail);              // the paths re-price the routes (~2 s)
    if ((s + 1) % CHUNK === 0){
      onProgress?.((s + 1) / steps);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  trail.flush();
}

const music = new MusicPlayer();
const footsteps = new Footsteps();
const ambience = new Ambience();

// While the splash is up the world is rendered but paused, and name tags hide.
let playing = false;
let inDialog = false;          // a conversation is open (keeps us 'in game', not menu)
let settingsOpen = false;      // the sound settings panel is open (also keeps us 'in game')
const nameTags = [];
const registerTag = (tag) => { if (tag){ tag.visible = playing; nameTags.push(tag); } };

// my in-world presence for shared diagnosis (name tag above a peasant)
let avatar = null;
const params = new URLSearchParams(location.search);

// dev-only NPC debug overlay: per-NPC drives + chosen action. Toggle with B
// (or ?debugnpc). Off by default — the shipped world reads NPCs by behaviour.
const npcDbg = document.createElement('pre');
npcDbg.style.cssText = 'position:fixed;left:6px;top:6px;margin:0;padding:6px 8px;'
  + 'font:11px/1.35 monospace;color:#cfe;background:rgba(0,0,0,.55);'
  + 'white-space:pre;pointer-events:none;z-index:50;display:none;';
document.body.appendChild(npcDbg);
let showNpcDbg = params.has('debugnpc');
if (showNpcDbg) npcDbg.style.display = 'block';

// "hover" panel for the peasant the player is looking at (pointer-locked view =
// whoever is nearest the centre of the screen): portrait + name in a framed box
// stacked just above the minimap, sharing the map's frame so they read as a pair.
const hoverPanel = document.createElement('div');
hoverPanel.style.cssText = 'position:fixed;right:10px;bottom:222px;width:180px;height:90px;'
  + "border:10px solid;border-image:url('thin_dark_frame.png') 10 round;background:#1d1a14;"
  + "display:none;align-items:center;gap:8px;padding:6px;box-sizing:border-box;overflow:hidden;"
  + "font-family:Georgia,'Times New Roman',serif;color:#efe6cf;z-index:40;";
const hoverFace = document.createElement('img');
hoverFace.style.cssText = 'width:56px;height:56px;flex:0 0 56px;object-fit:cover;'
  + 'border:1px solid #c9a23a;border-radius:3px;background:#0c0e16;background-size:20px;image-rendering:auto;';
// name + description stack vertically beside the (optional) portrait
const hoverText = document.createElement('div');
hoverText.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;';
const hoverName = document.createElement('div');
hoverName.style.cssText = 'font-size:12.5px;font-weight:bold;line-height:1.35;'
  + 'color:#e8c75a;word-break:break-word;';
// a sub-line: weather when nothing's framed, or an object's flavour text
const hoverAmbient = document.createElement('div');
hoverAmbient.style.cssText = 'font-size:12.5px;line-height:1.35;'
  + 'color:#cdbf98;word-break:break-word;display:none;';
hoverText.appendChild(hoverName); hoverText.appendChild(hoverAmbient);
hoverPanel.appendChild(hoverFace); hoverPanel.appendChild(hoverText);
document.body.appendChild(hoverPanel);

// --- ambient readouts (used when not looking at anyone) -----------------------
const COMPASS = ['north','northeast','east','southeast','south','southwest','west','northwest'];
// the box reports where the wind blows *from*; sky.wind is the direction it blows toward
function describeWind(w){
  const speed = Math.hypot(w.x, w.y);
  if (speed < 0.1) return 'The air is still.';
  // bearing of the source (-w), with north = -z, east = +x
  const fx = -w.x, fz = -w.y;
  const bearing = (Math.atan2(fx, -fz) * 180 / Math.PI + 360) % 360;
  const dir = COMPASS[Math.round(bearing / 45) % 8];
  const strength = speed < 0.4 ? 'A light breeze' : speed < 0.85 ? 'A steady breeze'
    : speed < 1.35 ? 'A brisk wind' : 'A strong gale';
  return `${strength} out of the ${dir}.`;
}
// f is the day fraction: 0 = midnight, 0.5 = noon
function describeTime(f){
  const h = (((f % 1) + 1) % 1) * 24;
  if (h < DAWN[0] || h >= 22) return 'The dead of night.';
  if (h < DAWN[1]) return 'Dawn is breaking.';
  if (h < 11)   return 'Morning.';
  if (h < 13)   return 'Midday.';
  if (h < 17)   return 'Afternoon.';
  if (h < 19)   return 'Evening draws in.';
  return 'Nightfall.';
}
// no real thermometer in the Lea — temperature follows the hour (warmest mid-
// afternoon, coldest before dawn) and is knocked down a notch under heavy cloud
function describeTemp(f, cloud = 0.5){
  const h = (((f % 1) + 1) % 1) * 24;
  let t = Math.cos((h - 15) / 24 * 2 * Math.PI);   // -1 before dawn .. +1 mid-afternoon
  t -= 0.18 * (cloud - 0.5);                        // overcast runs a touch cooler
  const word = t < -0.6 ? 'Bitterly cold' : t < -0.25 ? 'Cold' : t < 0.05 ? 'Chilly'
    : t < 0.35 ? 'Cool' : t < 0.65 ? 'Mild' : t < 0.9 ? 'Warm' : 'Hot';
  return `${word} out.`;
}

const _fwd = new THREE.Vector3(), _to = new THREE.Vector3();
const TALK_RANGE = 4.5;       // how close you must be to actually talk / pick up
const FRAME_RANGE = TALK_RANGE; // the box reads an object/person exactly when E can act on it
const LOOK_CONE = 0.97;       // ~14° cone: how near the cursor a target must sit
const ENTRANCE_REACH = 9;     // a cave mouth or the crypt stair: how far off your view can meet it and E still go down

// the single thing the cursor is pointed at drives BOTH the hover box and what
// E acts on, so they never disagree. We pick the talkable entity (Claude, Puck,
// any peasant) whose direction best lines up with where you're looking — not
// merely the nearest one. updateFocus() sets nearTalker / nearFruit and the box.
function focusAt(eyeY, x, z){          // angular fit of (x,z) to the view dir
  _to.set(x - camera.position.x, eyeY - camera.position.y, z - camera.position.z);
  const dist = _to.length();
  return { dist, dot: dist > 1e-3 ? _to.dot(_fwd) / dist : -1 };
}
// pretty title + flavour for a forageable under the cursor
function forageLabel(p){
  const k = p.kind || 'something';
  const title = k.charAt(0).toUpperCase() + k.slice(1);
  if (p.valuable){
    const desc = { shell: 'A shell, washed up on the sand.', stone: 'A curious stone.',
      amber: 'Amber — old sap turned to gold.', quartz: 'A glint of quartz.' }[k]
      || 'A pretty thing, worth a trade.';
    return { title, desc };
  }
  return { title, desc: 'Ripe for the picking.' };
}

function updateFocus(){
  nearTalker = null; nearFruit = null; nearObject = null; nearBoat = null; nearTree = null; nearRing = null; nearFish = null;
  nearEntrance = null; nearFind = null; nearExit = -1; nearSconce = null; nearShelf = null; nearPortal = null;
  if (!playing || inDialog || document.pointerLockElement !== canvas){ hoverPanel.style.display = 'none'; return; }
  if (down){ underFocus(); return; }
  camera.getWorldDirection(_fwd);

  // ONE cone pick across everything you might look at — people, forageables,
  // campfires — so the box and the E-target are always the same thing.
  let best = null, bestDot = LOOK_CONE;
  const consider = (x, z, eyeY, maxDist, data) => {
    const { dist, dot } = focusAt(eyeY, x, z);
    if (dist < 0.4 || dist > maxDist) return;
    if (dot > bestDot){ bestDot = dot; best = { dist, ...data }; }
  };
  // the box only reads something you're relatively close to (FRAME_RANGE);
  // E still only fires once within TALK_RANGE
  if (avatar) consider(avatar.x, avatar.z, height(avatar.x, avatar.z) + 1.0, FRAME_RANGE, { kind: 'person', c: avatar, dialog: 'claude', name: 'Claude' });
  if (puck)   consider(puck.x,   puck.z,   height(puck.x,   puck.z)   + 1.0, FRAME_RANGE, { kind: 'person', c: puck,   dialog: 'puck',   name: 'Puck'   });
  for (const n of npcApi.npcs) if (!n._indoors)            // nobody indoors to be seen
    consider(n.x, n.z, height(n.x, n.z) + n.h * 0.6, FRAME_RANGE, { kind: 'person', c: n, peasant: true, name: n.name || 'a peasant', npc: n });
  // forageables: berries, shells, stones… (a strong mushroom ring is a talker
  // instead of a plain pick — the caps are the organism's mouth, and taking them
  // ends the conversation)
  for (const p of forage.pickables ? forage.pickables() : []){
    if (!p.ripe) continue;
    consider(p.x, p.z, height(p.x, p.z) + 0.5, FRAME_RANGE,
      p.ring ? { kind: 'ring', item: p } : { kind: 'fruit', item: p });
  }
  // campfires (informational — not an E target)
  for (const fr of agents.openFires || [])
    consider(fr.x, fr.z, height(fr.x, fr.z) + 0.6, FRAME_RANGE, { kind: 'fire', fire: fr });
  // rabbits (informational)
  for (const q of agents.fauna || [])
    if (q.alive) consider(q.x, q.z, height(q.x, q.z) + 0.3, FRAME_RANGE, { kind: 'rabbit', q });
  // fishing spots: aim at the water off the bank (E casts, if you're on the bank)
  if (!boating && !playerFish)
    for (const sp of agents.fishing)
      if (Math.hypot(sp.x - pos.x, sp.z - pos.z) < 6) consider(sp.wx, sp.wz, WATER + 0.1, FRAME_RANGE + 3, { kind: 'fishspot', spot: sp });
  // moored boats (board with E) — only when you're not already aboard one
  if (!boating)
    for (const b of boats.list)
      if (!b.aboard) consider(b.x, b.z, WATER + 0.4, FRAME_RANGE, { kind: 'boat', boat: b });
  // a cave mouth, the crypt stair: aimed at by the opening itself (under-view
  // entranceHit), not a point near it — you look down into a stairwell. A hit
  // counts as near dead centre, so it wins unless someone stands in the way.
  for (const en of under().entrances){
    if (Math.hypot(en.x - pos.x, en.z - pos.z) > 16) continue;
    const t = entranceHit(en, camera.position.x, camera.position.y, camera.position.z, _fwd.x, _fwd.y, _fwd.z, ENTRANCE_REACH);
    if (t >= 0 && 0.99 > bestDot){ bestDot = 0.99; best = { dist: t, kind: 'entrance', e: en }; }
  }
  if (sight) for (const pt of portals())             // a door into Faerie, seen with the salve on
    if (Math.hypot(pt.x - pos.x, pt.z - pos.z) < 16) consider(pt.x, pt.z, pt.y + 2.7, FRAME_RANGE, { kind: 'portal', p: pt });
  for (const b of agents.canoeBuilds)                // a canoe being made on the bank
    consider(b.x, b.z, height(b.x, b.z) + 0.3, FRAME_RANGE, { kind: 'canoe-bed', bed: b });

  // Trees are everywhere and never move, so they're the LOWEST-priority thing to
  // frame — only when nothing more interesting (a person, forage, a fire) sits in
  // the cone. Otherwise a trunk dead ahead would steal a peasant's slot. Cone-test
  // just the trees near the player (spatial hash), not the whole forest.
  if (!best){
    let bt = null, btDot = LOOK_CONE;
    for (const n of myc.nodesNear(camera.position.x, camera.position.z, FRAME_RANGE + 1)){
      const { dist, dot } = focusAt(height(n.x, n.z) + 1.4, n.x, n.z);
      if (dist < 0.4 || dist > FRAME_RANGE) continue;
      if (dot > btDot){ btDot = dot; bt = { dist, kind: 'tree', node: n }; }
    }
    if (bt){ best = bt; bestDot = btDot; }
  }

  // wire E to whatever's framed, if it's within reach and actionable
  if (best && best.dist <= TALK_RANGE){
    if (best.kind === 'person') nearTalker = best;
    else if (best.kind === 'fruit') nearFruit = best.item;
    else if (best.kind === 'fire') nearObject = best.fire;   // inspect the fire/pot with E
    else if (best.kind === 'boat') nearBoat = best.boat;      // climb aboard with E
    else if (best.kind === 'tree') nearTree = best.node;      // listen to a tree with E
    else if (best.kind === 'ring') nearRing = best.item;      // the fungus talks (and can be picked)
  }
  if (best && best.kind === 'entrance') nearEntrance = best.e;   // within ENTRANCE_REACH already
  if (best && best.kind === 'portal' && best.dist <= TALK_RANGE + 1.5) nearPortal = best.p;
  if (best && best.kind === 'fishspot' && Math.hypot(best.spot.x - pos.x, best.spot.z - pos.z) < 3) nearFish = best.spot;   // on the bank: cast with E
  if (boating && !playerFish)                         // in a canoe, over a ground in the deep water: cast with E
    for (const g of agents.grounds) if (Math.hypot(g.x - pos.x, g.z - pos.z) < BOAT_CAST_R && !(g.taken && g.taken !== PLAYER)) nearFish = g;

  // render the box: portrait+name for people, a title+flavour for objects,
  // and the weather readout when nothing is framed
  hoverPanel.style.display = 'flex';
  const showText = (title, desc, portrait, bg = '') => {
    hoverName.textContent = title; hoverName.style.display = '';
    // only on change: re-setting a data-URL src every frame re-decodes the image
    if (portrait){
      if (hoverFace.src !== portrait){ hoverFace.src = portrait; hoverFace.style.backgroundImage = bg; }   // their household's mark behind them
      hoverFace.style.display = '';
    }
    else hoverFace.style.display = 'none';
    if (desc){ hoverAmbient.textContent = desc; hoverAmbient.style.display = ''; }
    else hoverAmbient.style.display = 'none';
  };
  if (best && best.kind === 'person' && best.name){
    const label = best.peasant ? displayName(best.npc) : best.name;   // strangers stay anonymous
    showText(label, '', best.npc && best.npc.portrait, markBackdrop(best.npc?.group?.id));
  } else if (best && best.kind === 'fruit'){
    const { title, desc } = forageLabel(best.item); showText(title, desc, null);
  } else if (best && best.kind === 'tree'){
    const n = best.node;
    const size = n.scale > 1.25 ? 'A great ' : n.scale < 0.8 ? 'A young ' : 'A ';
    showText(`${size}${n.base}`,
      n.faced             ? 'A face in the bark. Its eyes are opening.'
      : n.links.length >= 4 ? 'Deep in the threads.'
      : n.links.length >= 1 ? 'Something runs under it.'
      :                       'Joined to nothing — it stands apart.', null);
  } else if (best && best.kind === 'fishspot'){
    const sp = best.spot, who = sp.taken && sp.taken !== PLAYER ? sp.taken : null;
    showText(sp.kind === 'eels' ? 'Muddy, reedy water' : 'Deep water off the bank',
      who ? `${displayName(who)} is fishing here.`
      : sp.stock > 0.6 ? (sp.kind === 'eels' ? 'Eels lie in mud like this.' : 'Fish are rising here.')
      : sp.stock > FISH_LOW_SHOWN ? 'Fished a little lately.' : 'Fished out, for now.', null);
  } else if (best && best.kind === 'ring'){
    showText(best.item.kind === 'morels' ? 'A ring of morels' : 'A ring of mushrooms',
      'Caps in a curve. The rest of it is underfoot.', null);
  } else if (best && best.kind === 'rabbit'){
    showText('A rabbit', best.q.fleeing ? 'Bolting — wary of you.' : 'Grazing, ears twitching.', null);
  } else if (best && best.kind === 'entrance'){
    showText(underNames()[best.e.level].name, best.e.kind === 'cave' ? 'A cave mouth. Cold air breathes out of it.' : `Steps going down ${STAIR_WHERE[best.e.site] || STAIR_WHERE.chapel}.`, null);
  } else if (best && best.kind === 'portal'){
    showText(cap(best.p.name), 'A door of nothing, standing in the air. Lights spiral into it, and out.', null);
  } else if (best && best.kind === 'boat'){
    const by = best.boat.madeBy;
    showText('A bark canoe', by ? `${displayName(by)} made it. Anyone may take it.` : 'Moored at the water’s edge. Anyone may take it.', null);
  } else if (best && best.kind === 'canoe-bed'){
    const b = best.bed, need = b.needs();
    showText('A canoe being made',
      need === 'bark' ? (b.bark ? `${b.bark} of 3 sheets of birch bark laid out.` : 'Ground levelled by the water. No bark yet.')
      : need === 'ribs' ? 'The bark is down. It wants poles for the ribs.'
      : b.progress < 0.55 ? 'The sides are bent up against stakes.'
      : b.progress < 0.85 ? 'Ribs in, the seams half sewn.' : 'Nearly done. The seams are being gummed.', null);
  } else if (best && best.kind === 'fire'){
    const pot = best.fire.potLabel && best.fire.potLabel();   // something simmering?
    if (pot) showText(pot.title, pot.desc, null);
    else showText(best.fire.lit ? 'Campfire' : 'Campfire (cold)',
             best.fire.lit ? 'Burning warm — a place to gather.' : 'Naught but cold ashes.', null);
  } else {
    hoverFace.style.display = 'none'; hoverName.style.display = 'none';
    hoverAmbient.style.display = '';
    const f = sky.time ?? 0;
    hoverAmbient.textContent = `${describeWind(sky.wind)} ${describeTime(f)} ${describeTemp(f, sky.cloudCover)}`;
  }
}

// ---------- cursor-mode click interaction ----------
// Projects game-object world positions onto screen space and triggers the same
// interaction as pressing E, so the player can click NPCs/fires in cursor mode.
const _clickVec = new THREE.Vector3();
function tryClickInteract(e){
  if (inDialog) return;
  const cx = e.clientX, cy = e.clientY, W = window.innerWidth, H = window.innerHeight;
  const CLICK_R = 52;   // pixel hit radius

  let best = null, bestD = CLICK_R, bestDist3d = Infinity;
  const check = (x, eyeY, z, data) => {
    _clickVec.set(x, eyeY, z).project(camera);
    if (_clickVec.z > 1) return;                          // behind camera
    const sx = (_clickVec.x + 1) * 0.5 * W;
    const sy = (-_clickVec.y + 1) * 0.5 * H;
    const d2 = Math.hypot(sx - cx, sy - cy);
    const d3 = Math.hypot(x - pos.x, z - pos.z);
    if (d2 < bestD){ bestD = d2; bestDist3d = d3; best = data; }
  };

  if (avatar) check(avatar.x, height(avatar.x, avatar.z) + 1.0, avatar.z,
    { kind: 'person', c: avatar, dialog: 'claude', name: 'Claude' });
  if (puck)   check(puck.x, height(puck.x, puck.z) + 1.0, puck.z,
    { kind: 'person', c: puck, dialog: 'puck', name: 'Puck' });
  for (const n of npcApi.npcs) if (!n._indoors)
    check(n.x, height(n.x, n.z) + n.h * 0.6, n.z,
      { kind: 'person', c: n, peasant: true, name: n.name || 'a peasant', npc: n });
  for (const fr of agents.openFires || [])
    check(fr.x, height(fr.x, fr.z) + 0.6, fr.z, { kind: 'fire', fire: fr });
  if (!boating)
    for (const b of boats.list)
      check(b.x, WATER + 0.4, b.z, { kind: 'boat', boat: b });

  if (best && bestDist3d <= TALK_RANGE) {
    doInteract(best);
  }
}

function doInteract(target){
  if (inDialog) return;
  if (target.kind === 'person'){
    const npc = target.c;
    npc.talking = true; inDialog = true;
    if (npc.heading !== undefined) npc.heading = Math.atan2(pos.x - npc.x, pos.z - npc.z);
    document.exitPointerLock?.();
    const onClose = () => {
      mapMark = null; npc.talking = false; inDialog = false;
      try { canvas.requestPointerLock(); } catch (_){}
    };
    if (target.peasant){
      const tree = peasantTree(npc, sky);
      const onNav = (id) => {
        mapMark = null;
        if (id === 'name') npc.known = true;
        if (id === 'stars') thinKnown = true;
        if (id === 'doc-thin') thinKnown = true;
        if (id === 'doc-else') salveHeard = true;
        if (id === 'doctor') mapMark = tree.doctorMark;
        if (id === 'kin' && npc.group)
          for (const o of npc.group.npcs)
            if (o !== npc && !o.known && !o.heardFrom) o.heardFrom = npc;
        tree.speaker = displayName(npc);
      };
      talkTree(tree, { onClose, onNav });
    } else {
      const onNav = () => { mapMark = null; };
      openTalk(target.dialog, { actions: weatherActions, onClose, onNav });
    }
  } else if (target.kind === 'fire'){
    inDialog = true; document.exitPointerLock?.();
    const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch(_){} };
    talkTree(fireTree(target.fire), { onClose });
  } else if (target.kind === 'boat'){
    board(target.boat);
  }
}

// ---------- inventory panel ----------
const invPanel = document.getElementById('inv-panel');
const invBtn   = document.getElementById('inv-btn');
let invOpen = false;

// Where, how and under what sky something was got (js/provenance.js): every unit that goes
// in the pack carries one. `how` is picked / found / fished / traded / given; `from`, who.
const RING_AT = 4.5, TREE_AT = 4.5;   // inside a fairy ring; within a sacred tree's outer precinct
function provHere(how, from = null){
  const under = !!down, x = under ? upos.x : pos.x, z = under ? upos.z : pos.z, now = agents.time;
  const thin = [];
  if (under){
    const L = down.L;
    if (L.site === 'tomb') thin.push('barrow');
    if ((L.cavern && Math.hypot(x - L.cavern.x, z - L.cavern.z) < L.cavern.R + 6) || (L.halls || []).some(h => Math.hypot(x - h.x, z - h.z) < h.R + 4)) thin.push('the deep');
  } else {
    if (forage.plants.some(q => q.ring && Math.hypot(q.x - x, q.z - z) < RING_AT)) thin.push('fairy ring');
    if (agents.shrines.some(sh => Math.hypot(sh.x - x, sh.z - z) < TREE_AT)) thin.push('sacred tree');
    if (ruins().some(ru => ru.kind === 'circle' && Math.hypot(ru.x - x, ru.z - z) < (ru.rad || THIN_R))) thin.push('stone circle');
  }
  const ateLast = Math.max(-Infinity, ...Object.values(me._diet || {}));
  return { t: now, hour: (((sky.time ?? 0) % 1) + 1) % 1 * 24,
    moon: { illum: sky.moonIllum ?? 0, waxing: Math.sin((sky.moonLon ?? 0) - (sky.sunLon ?? 0)) > 0, house: houseName(sky.moonLon ?? 0) },
    sunHouse: houseName(sky.sunLon ?? 0), rain: rain.intensity || 0, cloud: sky.cloudCover || 0,
    x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, place: under ? null : placePhrase(placeAt(x, z)),
    under: under ? down.name : null, ground: under ? (down.L.kind === 'cave' ? 'rock' : 'stone') : terrainType(x, z),
    thin, how, from, fasting: Number.isFinite(ateLast) ? Math.round((now - ateLast) * 24 * 10) / 10 : null };
}
// what eating one gives, in words, for the line under the grid
const giveWords = g => [g.stamina >= 0.5 && `+${Math.round(g.stamina)} stamina`, g.health >= 0.5 && `+${Math.round(g.health)} health`, g.sp >= 0.25 && `+${+g.sp.toFixed(1)} spell points`].filter(Boolean).join(', ');
function packUse(kind){
  const e = ingredient(kind) || {};
  if (edible(kind)){ const g = eatValue(me, kind, agents.time); return `Eat one: ${giveWords(g) || 'nothing much'}${g.f < 0.9 ? " (you've had that lately)" : ''}.`; }
  if (e.use === 'sight') return 'Use: touch it to one eye, after dark, at a fairy ring, a stone circle or a sacred tree.';
  if (e.raw) return 'Raw: it wants a pot over a fire.';
  if (e.group === 'trinket') return 'A pretty thing, worth a trade.';
  return 'Not for eating as it is.';
}
// the line under the grid for a box: what it's good for, then where it came from (its
// oldest lot; how many other gatherings are mixed in with it)
function packSays(box){
  const lots = box.lots || [], more = lots.length - 1;
  return `${packUse(box.kind)} ${describeProv(lots[0] && lots[0].prov)}${more > 0 ? ` (With ${more} other ${more === 1 ? 'gathering' : 'gatherings'}.)` : ''}`;
}
function eatFromPack(box){
  const e = ingredient(box.kind) || {}, name = e.label || box.kind;
  if (e.use === 'sight') return useSalve(box);
  if (!edible(box.kind)) return packUse(box.kind);
  const g = eat(me, box.kind, agents.time);
  myPack.takeFrom(box.id);
  return `You eat some ${name}: ${giveWords(g) || "you're as full of it as you'll get"}.`;
}
// the fairy salve (stillroom.js): touched to one eye after dark at a thin place, it
// shows what's in the Lea under glamour (faerie-view.js), the whole Lea over, until first
// light: the portals to the Gentry's palaces, and the Gentry walking between them. An
// ordinary crypt or cave puts it out; inside a palace it holds (docs/magic.md).
// Puck has something to say about it, and more the second time (the midwife's tale,
// docs/texts/magic-traditions.md §4: they take the eye that sees them).
let sight = null, salveUses = 0;
// the portals (gen/faerie.js), beside the thin places, and the paths between them: planned
// once, the first time anything asks
let _portals = null, _faerieSet = false;
function portals(){
  if (_portals) return _portals;
  const thin = [...forage.plants.filter(q => q.ring).map(q => ({ kind: 'fairy ring', x: q.x, z: q.z, r: 3 })),
    ...ruins().filter(u => u.kind === 'circle').map(u => ({ kind: 'stone circle', x: u.x, z: u.z, r: u.rad || THIN_R })),
    ...agents.shrines.map(t => ({ kind: 'sacred tree', x: t.x, z: t.z, r: TREE_AT }))];
  return (_portals = planPortals(thin, { seed: WORLD_SEED, size: SIZE, walkable, height }));
}
function openSight(){
  if (!_faerieSet){ faerie.setWorld(portals(), portalPaths(portals(), (a, b, c, d) => planRoute(a, b, c, d, 'scenic'))); _faerieSet = true; }
  faerie.start();
}
const inPalace = () => !!down && !!down.L.faerie;           // a palace, the grounds or the stair: anywhere in Faerie
function useSalve(box){
  if (down) return 'Not down here. It wants the open night, and a place the Gentry gather.';
  if (faerie.active) return "Your eye's anointed already.";
  // where the Gentry gather, as near as you can see into it (THIN_R, wider than a pick's
  // "inside", so it works where Puck stops when he brings you: thinPlaces)
  const near = r => [
    forage.plants.some(q => q.ring && Math.hypot(q.x - pos.x, q.z - pos.z) < r) && 'fairy ring',
    ruins().some(u => u.kind === 'circle' && Math.hypot(u.x - pos.x, u.z - pos.z) < (u.rad || THIN_R) + r - THIN_R) && 'stone circle',
    agents.shrines.some(t => Math.hypot(t.x - pos.x, t.z - pos.z) < r) && 'sacred tree'].filter(Boolean);
  const thin = near(THIN_R);
  if ((sky.night ?? 0) < 0.5) return 'Not by daylight. After dark, the book says.';
  if (!thin.length) return near(THIN_R * 2).length ? `Closer: you're not near enough the ${near(THIN_R * 2)[0]} to see into it.` : 'Nothing to see here. It wants a fairy ring, a stone circle or a sacred tree.';
  myPack.takeFrom(box.id);
  salveUses++;
  sight = { x: pos.x, z: pos.z };
  openSight();
  jot('saw', 'the Gentry, with the green salve on one eye');
  const puckSays = salveUses === 1 ? "Oh! You've the green salve on. See the doors, out across the Lea? Look, then, but don't stare." : "Again? Mind they don't see you looking. They take the eye that sees them.";
  setTimeout(() => setForageMsg(`Puck, at your ear: "${puckSays}"`, 6000), 2500);
  return `You touch the salve to one eye. It stings, and then the dark ${thin[0] === 'sacred tree' ? 'under the tree' : `in the ${thin[0]}`} is not empty.`;
}
function tickSight(){
  if (!sight) return;
  const h = (((sky.time ?? 0) % 1) + 1) % 1 * 24;
  if (inPalace()) return;                              // in Faerie, the night holds
  const away = !!down;                                // an ordinary crypt or cave puts it out
  if (away || (h >= 5 && h < 12)){
    sight = null; faerie.stop();
    setForageMsg(away ? 'The salve has worn off.' : 'First light. The salve has worn off, and the place is only a place.', 4000);
  }
}
// spell points and stamina, as two upright bars beside the minimap (health isn't drawn
// until something can hurt you: docs/magic.md)
const vitalsEl = document.createElement('div');
vitalsEl.id = 'vitals'; vitalsEl.className = 'hide';
vitalsEl.innerHTML = '<div class="bar sp" title="Spell points"><i></i></div><div class="bar st" title="Stamina"><i></i></div>';
document.body.appendChild(vitalsEl);
const [_spFill, _stFill] = vitalsEl.querySelectorAll('i');
function drawVitals(){
  vitalsEl.classList.remove('hide');
  _spFill.style.height = `${(me.sp / SP_MAX * 100).toFixed(1)}%`;
  _stFill.style.height = `${(me.st / ST_MAX * 100).toFixed(1)}%`;
  vitalsEl.classList.toggle('winded', me.winded);
}
const packUI = packView(invPanel, myPack, { onEat: eatFromPack, says: packSays });
// opening the pack frees the mouse (to drag and eat); closing it takes the look back
function openInventory(){
  packUI.render();
  invPanel.classList.remove('hide');
  invOpen = true;
}
function closeInventory(relockAfter = false){ invPanel.classList.add('hide'); invOpen = false; if (relockAfter) relock(); }
// put n of kind in the pack: true if any went in; says so if some or all didn't fit
function stow(kind, n, prov){
  const got = myPack.add(kind, n, prov);
  if (got < n) setForageMsg(got ? `+${got} ${kind}; no room in your pack for the rest.` : 'No room in your pack.', 3000);
  else setForageMsg(`+${n} ${kind}`);
  if (invOpen) openInventory();
  if (got > 0 && (prov?.how === 'picked' || prov?.how === 'found')) jot(prov.how, (ingredient(kind) || {}).label || kind);
  return got;
}

// ---------- the journal (J): what came of the day, as a diary (js/journal.js) ----------
const journal = makeJournal(() => ({ t: agents.time, hour: (((sky.time ?? 0) % 1) + 1) % 1 * 24 }));
const journalBtn = document.getElementById('journal-btn');
const journalUI = journalView(journal, { onClose: () => relock() });
const markJournal = () => journalBtn.classList.toggle('new', journal.unread);
function openJournal(){ if (invOpen) closeInventory(); document.exitPointerLock?.(); journalUI.open(); markJournal(); }
journalBtn.addEventListener('click', e => { e.stopPropagation(); journalUI.isOpen ? journalUI.close() : openJournal(); });
// where something happened, as the journal names it: underground, the cave, or the ruin
// over the crypt; above, a ruin you're among, a settlement you're in, else the region
const SETTLE_R = 45;
const RUIN_WHAT = { circle: n => `${n}, a ring of standing stones`, aqueduct: n => `${n}, an old aqueduct` };
const ruinPlace = i => { const n = ruinNames()[i]; return { key: n.name, name: n.name, at: n.at, what: (RUIN_WHAT[ruins()[i].kind] || (m => `the ruins of ${m}`))(n.name) }; };
function journalPlace(){
  if (down){
    const ri = down.L.site !== 'tomb' ? under().levels[down.L.id]?.ruin : null, n = ri != null ? ruinNames()[ri] : null;
    return n ? { key: n.name, name: n.name, at: 'under' } : { key: down.name, name: down.name, at: 'in' };
  }
  const i = ruins().findIndex(ru => Math.hypot(ru.x - pos.x, ru.z - pos.z) < (ru.rad || THIN_R));
  if (i >= 0) return ruinPlace(i);
  const j = settlements().places.findIndex(q => Math.hypot(q.x - pos.x, q.z - pos.z) < SETTLE_R);
  if (j >= 0){ const n = settlementNames()[j].name; return { key: n, name: n, at: 'at' }; }
  const g = placeAt(pos.x, pos.z);
  return { key: g.name, name: g.name, at: g.at };
}
// a place Puck brought you to (puck-guide.js destinations: a settlement, a ruin, a cave or tomb)
// or a spot he found you something at (`spot`: a ring, a bank, a bush), named by where it is
function destPlace(d){
  if (d.spot) return journalPlace();
  const i = ruinNames().findIndex(n => n.name === d.name);
  return i >= 0 ? ruinPlace(i) : { key: d.name, name: d.name, at: d.kind === 'cave' || d.kind === 'tomb' ? 'in' : 'at' };
}
// something done, where you are (I implied): jot('picked', 'hazelnuts')
function jot(verb, obj){ journal.did(journalPlace(), verb, obj); markJournal(); }
// a talk's "who": their name, and where they are
const whoAt = npc => { const p = journalPlace(); return `${displayName(npc)} ${p.at} ${p.name}`; };
// what a recipe wants, in words
const wantsWords = id => { const w = recipeWants(id).map(a => a.join(' or ')); return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w.at(-1)}`; };
// walking about: a ruin come upon; underground, the rooms of a crypt, a cave's hall and its lake
let journalT = 0;
function tickJournal(dt){
  if ((journalT += dt) < 0.5) return;
  journalT = 0;
  if (!down){
    const i = ruins().findIndex(ru => Math.hypot(ru.x - pos.x, ru.z - pos.z) < (ru.rad || THIN_R));
    if (i >= 0) journal.arrive(ruinPlace(i), 'stumble');
    return;
  }
  const L = down.L, place = journalPlace();
  if (L.reg){
    const i = Math.floor((upos.x - L.x0) / L.cell), j = Math.floor((upos.z - L.z0) / L.cell);
    const r = i >= 0 && j >= 0 && i < L.W && j < L.H ? L.reg[j * L.W + i] : -1;
    if (r >= 0){ journal.explore(place, r); markJournal(); }
  }
  if (L.cavern && Math.hypot(upos.x - L.cavern.lx, upos.z - L.cavern.lz) < L.cavern.LR + 6) jot('reached', 'the great lake at the bottom');
  if ((L.halls || []).some(h => Math.hypot(upos.x - h.x, upos.z - h.z) < h.R)) jot('found', 'a hall of dripstone');
}

invBtn.addEventListener('click', e => {
  e.stopPropagation();
  invOpen ? closeInventory() : openInventory();
});
invPanel.addEventListener('click', e => e.stopPropagation());

document.getElementById('look-btn').addEventListener('click', () => {
  try { canvas.requestPointerLock(); } catch (_){}
});

// geocentric sky: sun/moon on the ecliptic, real-catalogue stars, drifting clouds
const _pf = (k, def) => { const v = parseFloat(params.get(k)); return isNaN(v) ? def : v; };
const sky = new Sky(scene, {
  latitude:  _pf('lat',    42),
  dayLength: _pf('daylen', 600),   // real seconds per full day-night cycle
  time:      _pf('time',   0.35),  // 0=midnight .. 0.5=noon
  sunLon:    _pf('sunlon', 35),    // sun's ecliptic longitude (season)
});
sky.load();
const skyPicker = new SkyPicker(sky);   // \ to open, [ ] to cycle, M to toggle mode (M opens the map otherwise)

const rain = new Rain(scene);
rain.setSky(sky);
// Save the base day sky colours so we can lerp back when dry.
// domeU is ready after sky.load(), which is synchronous.
const _skyHorizBase = sky.domeU.uHorizon.value.clone();
const _skyZenBase   = sky.domeU.uZenith.value.clone();
const _rainSkyHoriz = new THREE.Color(0.44, 0.44, 0.46);  // stormy horizon — near-neutral grey
const _rainSkyZen   = new THREE.Color(0.28, 0.28, 0.30);  // deep overcast zenith — flat grey

// the weather is Claude's to command, through dialogue (see dialogs/claude.json)
const weatherActions = {
  cloudsMore:  () => sky.addCloudCover(+0.2),
  cloudsFewer: () => sky.addCloudCover(-0.2),
  cloudsClear: () => { sky.setCloudCover(0); rain.stopRain(); },
  rainStart:   () => rain.startRain(),
  rainHeavy:   () => rain.heavyRain(),
  rainStop:    () => rain.stopRain(),
  timeDawn:    () => sky.setDayFraction(0.23),
  timeNoon:    () => sky.setDayFraction(0.50),
  timeDusk:    () => sky.setDayFraction(0.78),
  timeNight:   () => sky.setDayFraction(0.00),
  // the moon: the sky turns on to that phase, the day doesn't (see Sky.turnHeavens)
  moonNew:     () => sky.turnHeavens(moonAhead(daysToNewMoon(sky.moonLon, sky.sunLon, sky.yearDays))),
  moonFull:    () => sky.turnHeavens(moonAhead(frac((daysToNewMoon(sky.moonLon, sky.sunLon, sky.yearDays) - SYNODIC() / 2) / SYNODIC()) * SYNODIC())),
  moonQuarter: () => sky.turnHeavens(SYNODIC() / 4),
  windEast:    () => sky.setWind(-0.9, 0.0),
  windWest:    () => sky.setWind( 0.9, 0.0),
  windGale:    () => sky.setWind( 1.6, 0.5),
  windCalm:    () => sky.setWind( 0.05, 0.0),
};
if (params.has('clouds')) sky.setCloudCover(+params.get('clouds'));   // debug: 0..1 cover
if (params.has('talk')) talk(params.get('talk') || 'claude', { actions: weatherActions });

spawnNamedNPC(scene, {
  slug: 'male-peasant-elf',
  x: +(params.get('cx') ?? 3), z: +(params.get('cz') ?? 14),
  name: params.get('name') ?? 'Claude Opus 4.8', labelColor: '#9fd0ff',
}).then(a => { avatar = a; registerTag(a?.label); });

// Puck — a magical hopping creature who travels in winking-in-and-out bands.
// The leader is persistent and talkable; the band is ephemeral. See js/puck.js.
let puck = null, pucks = null, puckGuide = null;
new PuckFlock(scene, { x: -4, z: 13 }).load().then(f => {
  pucks = f; puck = f.leader; registerTag(f.leader?.label);
  // Puck as a guide: "Where am I?" → somewhere to go → he leads you there (js/puck-guide.js)
  puckGuide = makePuckGuide({ flock: f, player: pos, say: line => talkView.say(puck, { who: puck, key: 'guide', icon: 'place', line }), finder: { kinds: findKinds, where: whereFound, thin: thinPlaces, salve: () => salveHeard }, friends: puckFriends,
    onArrive: d => { journal.arrive(destPlace(d), 'puck'); markJournal(); } });
});
// what Puck knows of where things are found (puck-guide.js "Where would I find…?"): the
// kinds worth asking about, what your recipes want first (then the old books, where the
// recipes come from), and for one, his word on it
// and the nearest place it's got, as a destination he can lead you to
const FOUND_LORE = {
  bushes: 'On the bushes, at the wood edges and along the hedges.', trees: 'On the trees. Look up!', ground: 'Dig for them, where the ground is soft.',
  oaks: 'Under the oaks, in autumn.', shade: 'In the shade, where it stays damp.', meadows: 'In the meadows, among the grass.', marsh: 'In the marsh. Wet feet, I\'m afraid.',
  croft: "They grow them in the village crofts. Ask the folk; they'll trade.", water: 'In the water. They bite best at dusk: find a bank and cast.',
  'the hunt': "The hunters bring those back. Puck doesn't hunt.", shore: 'Along the shores, washed up.', grass: 'Dropped in the grass, if you look.', rock: 'Grown out of the rock, where it shows.', tombs: 'In the old tombs, with the dead.',
};
const nearestOf = (list, x, z) => { let b = null, bd = Infinity; for (const q of list){ const d = Math.hypot(q.x - x, q.z - z); if (d < bd){ bd = d; b = q; } } return b; };
function findKinds(){
  const wanted = new Set();
  for (const id of recipesRead){
    if (PREPARATIONS[id]) for (const w of PREPARATIONS[id].wants) wanted.add(w.kind);
    else for (const alts of recipeWants(id)) for (const k of alts) wanted.add(k);
  }
  const others = Object.keys(INGREDIENTS).filter(k => !wanted.has(k) && INGREDIENTS[k].group !== 'dish' && !INGREDIENTS[k].use);
  return { wanted: [...wanted], others: ['books', ...others] };
}
// the nearest crypt under a ruined church that has what you're after (`has(L)`, asked of
// the built level: not every crypt has bookshelves, or wax on its altars). Levels are
// built as going down builds them, into the same cache (levelOf), so each costs once.
function nearestCrypt(x, z, has){
  const built = id => { if (!levels.has(id)) levels.set(id, buildLevel(under().levels[id])); return levels.get(id); };
  const st = under().entrances.filter(en => en.kind === 'stair' && en.site !== 'tomb' && has(built(en.level))).map(en => ({ x: en.stand[0], z: en.stand[1], en }));
  const c = nearestOf(st, x, z), name = c && underNames()[c.en.level]?.name;
  return c && name ? { name, what: `the crypt ${name}`, x: c.x, z: c.z, arrive: 8 } : null;
}
// the folk Puck will find for you by name (puck-guide.js "Take me to Claude."): a live
// destination, since they wander. Until you've talked to Claude, you ask for whoever's in charge.
let metClaude = false;
const puckFriends = () => avatar ? [{ name: 'Claude', what: 'Claude', spot: true, live: true, arrive: 6, met: metClaude, stranger: "I'd like to meet whoever's in charge here.",
  get x(){ return avatar.x; }, get z(){ return avatar.z; }, where: () => placePhrase(placeAt(avatar.x, avatar.z)) }] : [];
// once a stargazer's told you of them (thinKnown), or you carry the fairy salve: the
// nearest thin place of each kind it works at (useSalve), nearest first, each as a
// destination that ends inside it; else null
let thinKnown = false;
let salveHeard = false;   // a stargazer's told you of the salves of old ("doc-else"): ask Puck how
function thinPlaces(){
  const salve = basket['fairy salve'] > 0 || !!sight;
  if (!salve && !thinKnown) return null;
  return { night: (sky.night ?? 0) >= 0.5, salve, places: thinNear(pos.x, pos.z) };
}
// the nearest thin place of each kind to x, z (and the nearest door, with the salve on), nearest first
function thinNear(x, z){
  const here = (qx, qz) => placePhrase(placeAt(qx, qz)), places = [];
  const r = nearestOf(forage.plants.filter(q => q.ring), x, z);
  if (r) places.push({ kind: 'fairy ring', dest: { name: 'the fairy ring', spot: true, what: `a fairy ring ${here(r.x, r.z)}`, x: r.x, z: r.z, arrive: RING_AT - 1.5 } });
  const R = ruins(), rn = ruinNames(), c = nearestOf(R.map((u, i) => ({ x: u.x, z: u.z, u, i })).filter(q => q.u.kind === 'circle'), x, z);
  if (c) places.push({ kind: 'stone circle', dest: { name: rn[c.i].name, what: `a stone circle, ${rn[c.i].name}`, x: c.x, z: c.z, arrive: Math.max(2, (c.u.rad || THIN_R) * 0.5) } });
  const t = nearestOf(agents.shrines, x, z);
  if (t) places.push({ kind: 'sacred tree', dest: { name: 'the sacred tree', spot: true, what: `a sacred tree ${here(t.x, t.z)}`, x: t.x, z: t.z, arrive: TREE_AT - 1.5 } });
  const d = sight && nearestOf(portals(), x, z);   // with the salve on, the doors are thin places too
  if (d) places.push({ kind: 'door into Faerie', dest: { name: d.name, what: `a door into ${d.name}`, x: d.stand[0], z: d.stand[1], arrive: 4 } });
  places.sort((a, b) => Math.hypot(a.dest.x - x, a.dest.z - z) - Math.hypot(b.dest.x - x, b.dest.z - z));
  return places;
}
function whereFound(kind){
  const e = ingredient(kind) || {}, x = pos.x, z = pos.z, here = (qx, qz) => placePhrase(placeAt(qx, qz));
  if (kind === 'books') return { lore: "Old books? In the crypts under the ruined churches, on the brothers' shelves: the cellarer's in the undercroft, more in the cloister and the chapter house. Most have rotted. In the chapter house, look at the mouldy ones too; the learned books were kept in cases.",
                                 dest: nearestCrypt(x, z, L => (L.shelves || []).some(shelfBook)) };
  if (e.rare === 'cave'){
    const caves = under().entrances.filter(en => en.kind === 'cave').map(en => ({ x: en.stand[0], z: en.stand[1], en }));
    const c = nearestOf(caves, x, z), name = c && underNames()[c.en.level]?.name;
    return { lore: kind === 'foxfire' ? 'You can only find weird glowy stuff like that in deep caves. Keep going down, and look for something that glows.' : 'Only deep in the caves, where the passages go down. Bring a light.',
             ...(kind === 'foxfire' ? { ask: { label: 'Are there caves like that around?' } } : {}),
             dest: c && name ? { name, what: `a cave mouth, ${name}`, x: c.x, z: c.z, arrive: 8 } : null };
  }
  if (e.rare === 'ring'){
    const r = nearestOf(forage.plants.filter(q => q.ring), x, z);
    return { lore: 'Folks say that four-leaf clover is oh so rare, but every morning I hop by this or that ring of mushrooms and without a fail, find at least one four-leaf clover. Found a five-leaf once but it tasted like centaur urine.',
             ask: { label: 'A ring of mushrooms?', text: "Yeah, I heard people calling them fairy rings. They're hiding in the grass all over the place. Want me to show you?", go: 'Yes, show me.' },
             dest: r ? { name: 'the fairy ring', spot: true, what: `a fairy ring ${here(r.x, r.z)}`, x: r.x, z: r.z, arrive: 4 } : null };
  }
  if (e.from === 'crypt')
    return { lore: 'They used to burn candles in those old crypts, I\'m sure that you can find some wax there. But you need the really thick wax, from a real altar.',
             dest: nearestCrypt(x, z, L => L.finds.some(f => f.kind === kind && !f.taken)) };
  const lore = `${cap(kind)}? ${FOUND_LORE[e.from] || "Now there's a question. Keep your eyes open."}${e.when === 'dusk' && e.from !== 'water' ? ' Best at dusk.' : ''}`;
  if (e.group === 'garden'){
    const S = settlements().places, names = settlementNames(), v = nearestOf(S.map((q, i) => ({ x: q.x, z: q.z, i })).filter(q => S[q.i].kind !== 'farmstead'), x, z);
    return { lore, dest: v ? { name: names[v.i].name, what: names[v.i].name, x: v.x, z: v.z, arrive: 22 } : null };
  }
  if (e.from === 'water'){
    const w = nearestOf(agents.fishing, x, z);
    return { lore, dest: w ? { name: 'the water', spot: true, what: `a good bank ${here(w.x, w.z)}`, x: w.x, z: w.z, arrive: 3 } : null };
  }
  const q = nearestOf(forage.plants.filter(f => f.kind === kind && !f.ring), x, z);
  return { lore, dest: q ? { name: `the ${kind}`, spot: true, what: `some ${kind} ${here(q.x, q.z)}`, x: q.x, z: q.z, arrive: 3 } : null };
}
// a /dialogs conversation; Puck's with his guide branch grafted on, and Puck held
// still while you talk (skittish as he is, he'd hop off mid-sentence). Puck's
// "human-doctors" (dialogs/puck.json) sends you to ask the folk: askDoctor
let askDoctor = false;
function openTalk(name, opts){
  if (name === 'claude') metClaude = true;
  if (name !== 'puck' || !puckGuide) return talk(name, opts);
  const nav = opts.onNav;
  opts = { ...opts, onNav: id => { if (id === 'human-doctors') askDoctor = true; nav?.(id); } };
  const p = puck, onClose = opts.onClose;
  p.talking = true;
  return loadTree('puck').then(t => talkTree(puckGuide.graft(t), { ...opts, onClose: () => { p.talking = false; onClose?.(); } }))
    .catch(e => { p.talking = false; console.warn('dialog:', e); });
}

// ---------- maps ----------
// The round minimap, the place name above it and the big map (M) live in map.js;
// what's drawn on them (people, faced trees, a kin marker) is drawn here, through
// toScreen, so the same marks land right on either map whichever way it's turned.
const MAP = document.getElementById('map');
function drawMarks(ctx, toScreen){
  ctx.fillStyle = '#fd4';
  for (const n of npcApi.npcs){ if (n._indoors) continue; const [mx,my] = toScreen(n.x, n.z); ctx.fillRect(mx-1.5, my-1.5, 3, 3); }
  if (avatar){ const [ax,ay] = toScreen(avatar.x, avatar.z); ctx.fillStyle = '#6cf'; ctx.fillRect(ax-2, ay-2, 4, 4); }
  if (pucks){ ctx.fillStyle = '#e8c75a';
    for (const p of pucks.members){ const [px2,py2] = toScreen(p.x, p.z); const s = (p === pucks.leader) ? 4 : 2; ctx.fillRect(px2-s/2, py2-s/2, s, s); } }
  // faced trees — the speaking ones, marked as a small cross echoing their eyes
  for (const n of facedTrees){
    const [fx, fy] = toScreen(n.x, n.z);
    ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(fx-3.5, fy); ctx.lineTo(fx+3.5, fy); ctx.moveTo(fx, fy-3.5); ctx.lineTo(fx, fy+3.5); ctx.stroke();
    ctx.strokeStyle = '#bde04a';                  // eye-glow green
    ctx.beginPath(); ctx.moveTo(fx-3, fy); ctx.lineTo(fx+3, fy); ctx.moveTo(fx, fy-3); ctx.lineTo(fx, fy+3); ctx.stroke();
  }
  if (mapMark){                                    // a person's last-seen spot (set in dialog)
    const [kx, ky] = toScreen(mapMark.x, mapMark.z);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(kx, ky, 6, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#e8c75a'; ctx.beginPath(); ctx.arc(kx, ky, 2.5, 0, Math.PI*2); ctx.fill();
  }
}
const maps = createMaps({ mini: MAP, nameEl: document.getElementById('place'), drawMarks });
function openBigMap(){ const p = down ? upos : pos; maps.openBig(p.x, p.z, yaw); document.exitPointerLock?.(); }
function closeBigMap(){
  maps.closeBig();
  if (playing && !document.body.classList.contains('cursor-mode')){ try { canvas.requestPointerLock(); } catch (_){} }
}

// ---------- first-person controls ----------
const start = document.getElementById('start');

const hud = document.getElementById('hud');
let yaw = 0, pitch = 0;
const keys = {};

const fireworks = new Fireworks(scene);
const faerie = new FaerieSight(scene, height);   // what the fairy salve shows (useSalve)

// Cross-app intake: other bub apps post events into the meadow. Only the local
// bub compositor ever forwards these; the public deployment simply never
// receives one, and each event can only add a short gossip fact and/or a scene
// decoration (see rumor.js / firework.js).
addEventListener('message', ev => {
  const d = ev.data;
  if (!d || typeof d.type !== 'string') return;
  if (d.type === 'lea:rumor' && typeof d.text === 'string'){
    intakeRumor(agents, { text: d.text, courier: d.courier, id: d.id, source: d.source });
  } else if (d.type === 'lea:firework'){
    receiveFirework(d);
  }
});
// direct hooks for same-page callers and local testing
window.leaRumor    = ev => intakeRumor(agents, ev || {});
window.leaFirework = payload => receiveFirework(payload || {});
// diagnostic: the state of the wood's network — what got built, what it's carrying,
// and where the elders stand (so a session can walk to one: ?x=&z=)
// make the wood feel something at a place, for testing the network without waiting
// for the folk to light a fire there (same seam agents' own activity uses)
window.leaWoodFeel = (x, z, kind = 'fire', mag = 1) => {
  const n = myc.feel(+x, +z, kind, +mag);
  return n ? { seeded: n.id, sp: n.base, guild: n.guild, links: n.links.length } : null;
};
// render a tree's actual dialogue by position, and where it says its neighbours
// stand (so a session can confirm the trees describe real geography)
window.leaTreeAt = (x, z) => {
  const n = myc.nearest(+x, +z, 30);
  if (!n) return null;
  const tree = n.faced ? facedTreeVoice(n, woodCtx()) : treeVoice(n, woodCtx());
  const text = {};
  for (const id of Object.keys(tree.nodes)) text[id] = tree.nodes[id].text;
  return {
    at: { x: Math.round(n.x), z: Math.round(n.z) }, sp: n.base, guild: n.guild, faced: !!n.faced,
    scale: +n.scale.toFixed(2), links: n.links.length, holding: n.news.size,
    neighbours: n.links.map(l => ({ sp: l.to.base, x: Math.round(l.to.x), z: Math.round(l.to.z), w: +l.w.toFixed(2) })),
    text,
  };
};
// faced trees: coordinates + the camera pose that meets each one's gaze (debug)
window.leaFaces = () => facedTrees.map(n => {
  const yaw = Math.atan2(-n.x, -n.z);                 // the face looks toward centre
  const nx = Math.sin(yaw), nz = Math.cos(yaw), d = 5.5;
  // nearest same-guild neighbour distance — a rough "is it crowded" read for testing
  let nn = Infinity; for (const l of n.links){ const dd = Math.hypot(l.to.x-n.x, l.to.z-n.z); if (dd<nn) nn=dd; }
  return { x: Math.round(n.x), z: Math.round(n.z), sp: n.base, links: n.links.length,
           r: +((n.trunkR||0)*n.scale).toFixed(2), nearest: +nn.toFixed(1),
           // stand out on the face side and look back at the trunk
           view: { x: +(n.x + nx * d).toFixed(1), z: +(n.z + nz * d).toFixed(1), yaw: +yaw.toFixed(2) } };
});
// force a faced tree's eyes lit for a screenshot (headless can't grant pointer lock)
window.leaGaze = i => { const f = treeFaces.faces[i|0]; if (f){ f.glow = 1; f.eyesMat.opacity = 1; } return !!f; };
// reverence: is the visit-the-great-trees behaviour live and firing?
window.leaReverence = () => {
  const folk = agents.npcs;
  // how far each person is from the nearest shrine — a pilgrimage they can't reach
  // is a pilgrimage that never happens (the affordance market has a 70u horizon)
  const near = folk.map(n => Math.min(...agents.shrines.map(s => Math.hypot(s.x - n.x, s.z - n.z))));
  near.sort((a, b) => a - b);
  return { shrines: agents.shrines.length, folk: folk.length,
    revering: folk.filter(n => n.actionLabel === 'revere').length,
    meanReverence: +(folk.reduce((a, n) => a + (n.reverence || 0), 0) / (folk.length || 1)).toFixed(2),
    nearestShrine: { min: +(near[0] ?? -1).toFixed(0), median: +(near[near.length >> 1] ?? -1).toFixed(0),
                     within70: near.filter(d => d <= 70).length },
    doing: folk.reduce((m, n) => (m[n.actionLabel || '?'] = (m[n.actionLabel || '?'] || 0) + 1, m), {}),
    pilgrims: folk.filter(n => n.brain && n.brain._pilgrim).length };
};
// debug: force the reverence conditions (full urge, sated needs) so a visit can be
// watched live without waiting a day for it to build
// dev: NPC billboard state, for checking the idle breath from outside the game
window.leaNpcs = () => agents.npcs.slice(0, 6).map(n => ({
  slug: n.slug, moving: !!n.moving,
  scaleY: +n.mesh.scale.y.toFixed(5), y: +n.mesh.position.y.toFixed(4) }));
window.leaRevTest = () => { for (const n of agents.npcs){ n.reverence = 1;
  n.needs.warmth = n.needs.food = n.needs.rest = n.needs.company = 0.1; } return agents.npcs.length; };
// the rite: how far each shrine has been built, and (debug) fill one to see it whole
window.leaShrines = () => agents.shrines.map(sh => ({
  x: Math.round(sh.x), z: Math.round(sh.z), laid: sh.stones().length, total: sh.total,
  rings: sh.rings.map(r => `${r.slots.filter(s => s.kind).length}/${r.slots.length}`).join('→'),
  offerings: sh.stones().filter(s => s.precious && s.kind !== 'stone').map(s => s.kind),
}));
window.leaShrineFill = (i = 0, precious = 'amber') => {
  const sh = agents.shrines[i | 0]; if (!sh) return null;
  for (const r of sh.rings) for (const s of r.slots) if (!s.kind) sh.place(s, s.precious ? precious : 'stone');
  return sh.stones().length;
};
// debug: command the weather from the console, without going through the dialogue.
// `leaRain()` reports, `leaRain(true)` opens the heavens, `leaRain(false)` stops it.
// The cloud is set outright rather than left to fill at FILL_RATE, because that
// fill is per-frame-clamped: on a slow renderer "wait ten seconds" is not ten
// seconds' worth of weather.
window.leaRain = (on) => {
  if (on === true){ sky.setCloudCover(1); rain.heavyRain(); }
  else if (on === false){ rain.stopRain(); sky.setCloudCover(0.55); }
  return { intensity: +rain.intensity.toFixed(2), cover: +sky.cloudCover.toFixed(2) };
};
// The camp (docs/camp.md): what stands, and how the roofs are holding up.
window.leaCamp = () => agents.huts.map(h => ({
  x: Math.round(h.x), z: Math.round(h.z), built: +h.built.toFixed(2), thatch: +h.thatch.toFixed(2),
  owner: h.owner && (h.owner.name || h.owner.slug), beds: h.beds.size,
  fire: h.fire ? `${Math.round(h.fire.x)},${Math.round(h.fire.z)}` : 'gone',
}));
// debug: raise a full ring of huts at the nearest hearth at once, so a camp can be
// LOOKED at without waiting for the folk to build one over a couple of evenings
window.leaCampTest = (n = 5, thatch = 1) => {
  let fire = null, fd = Infinity;
  for (const f of agents.openFires){ const d = Math.hypot(f.x - camera.position.x, f.z - camera.position.z);
    if (d < fd){ fd = d; fire = f; } }
  if (!fire) return 'no hearth nearby';
  const who = agents.npcs[0] || null;
  for (let i = 0; i < n; i++){
    const site = agents.hutSite(fire, who || { group: null });
    if (!site) break;
    const h = agents.addHut(site.x, site.z, site.angle, null, fire, site.rad);
    h.staked = 1; h.frame = 1; h.loads = h.loadsNeed; h.thatch = thatch; h.view?.sync();
  }
  return { at: `${Math.round(fire.x)},${Math.round(fire.z)}`, huts: agents.hutsAt(fire).length };
};

// Perf probe. `leaPerf()` in the console reports what the frames since the last
// call actually cost — average frame, time inside the agent sim, time submitting
// the draw, and what the renderer sent — then resets. Numbers, not hunches: the
// sim and the draw fail in completely different ways and want different fixes.
const perf = { sim: 0, draw: 0, frames: 0, t0: performance.now(), calls: 0, triangles: 0, iv: [] };
let cullOn = true;
// places: where you are, what the name line says, and how many regions the Lea has
window.leaPlaces = () => ({ here: placeAt(pos.x, pos.z).name, shown: document.getElementById('place').textContent,
  count: places().length, sample: places().slice(0, 8).map(g => g.name) });
// settlements (js/gen/settle.js): list them, or leaSettlements(i) to stand at one's gate
window.leaSettlements = i => {
  const S = settlements().places;
  if (i != null && S[i | 0]){ const [x, z] = S[i | 0].gate; pos.x = x; pos.z = z; pos.y = height(x, z) + EYE; }
  const names = settlementNames();
  return S.map((p, k) => ({ i: k, name: names[k].name, kind: p.kind, at: `${Math.round(p.x)},${Math.round(p.z)}`, buildings: p.buildings.length,
    households: agents.houses.filter(h => p.buildings.includes(h.b)).map(h => ({
      family: h.household[0]?.group?.name, people: h.household.map(n => `${n.name || '?'}${n._indoors === h ? ' (in)' : ''}${n.sleeping ? ' zz' : ''}`) })) }));
};
// the ruins (js/gen/ruins.js): list them, or leaRuins(i) to stand just outside one, facing it
window.leaRuins = i => {
  const R = ruins(), names = ruinNames();
  if (i != null && R[i | 0]){
    const ru = R[i | 0], x = ru.x + ru.rad + 6, z = ru.z;
    pos.x = x; pos.z = z; pos.y = height(x, z) + EYE;
  }
  return R.map((ru, k) => ({ i: k, name: names[k].name, kind: ru.kind, at: `${Math.round(ru.x)},${Math.round(ru.z)}`, byRoad: ru.byRoad }));
};
// under the Lea (js/gen/under.js): list the ways down, leaUnder(i) to stand at
// entrance i, leaUnder(i, true) to go straight down it
window.leaUnder = (i, go = false) => {
  const E = under().entrances, names = underNames();
  const e = i != null ? E[i | 0] : null;
  if (e){
    if (down) comeUp(0);
    pos.x = e.stand[0]; pos.z = e.stand[1]; pos.y = height(pos.x, pos.z) + EYE;
    yaw = Math.atan2(Math.cos(e.face), Math.sin(e.face));              // facing the mouth
    if (go) goDown(e);
  }
  return E.map((x, k) => ({ i: k, name: names[x.level].name, kind: x.kind, mouth: x.mouth, at: `${Math.round(x.x)},${Math.round(x.z)}` }));
};
// into Faerie's grounds (or 'stair': the Turning Stair) without a portal, to try them
window.leaFaerie = (where = 'grounds') => { fade(() => goDown({ level: where === 'stair' ? STAIR : GROUNDS, mouth: 0 })); return where; };
window.leaDown = () => down && { name: down.name, at: `${upos.x.toFixed(1)},${upos.z.toFixed(1)}`, floor: +down.L.floorAt(upos.x, upos.z).toFixed(2),
  finds: down.L.finds.map(f => `${f.kind}${f.taken ? ' (taken)' : ''}`), revealed: down.L.revealed.reduce((a, b) => a + b, 0) };
// underground, stand beside the first untaken find of a kind ('foxfire', 'cave salt'…) or the lake's 'canoe', facing it
window.leaFind = kind => {
  if (!down) return 'not underground';
  const L = down.L, f = kind === 'canoe' ? L.canoe : L.finds.find(f => !f.taken && f.kind === kind);
  if (!f) return `no ${kind} here: ${[...new Set(L.finds.filter(f => !f.taken).map(f => f.kind))].join(', ')}`;
  for (let a = 0; a < 6.28; a += 0.4){
    const x = f.x + Math.cos(a) * 2, z = f.z + Math.sin(a) * 2;
    if (!L.walkable(x, z)) continue;
    upos.set(x, L.floorAt(x, z) + EYE, z);
    yaw = Math.atan2(-(f.x - x), -(f.z - z)); pitch = -0.4;
    return `beside the ${kind}`;
  }
  return `no room to stand by the ${kind}`;
};
// the market (docs/trade.md): recent trades at the village doors, and what each household has put by
window.leaMarket = () => ({ trades: agents.market.trades.slice(-15).map(r => `${r.folk.player ? 'you' : r.folk.name || '?'} → ${villageOf(r.house)}: ${qty(r.gn, r.gave)} for ${qty(r.qn, r.got)}`),
  talks: agents.market.talks || 0, miss: agents.market.miss,
  plans: agents.npcs.flatMap(n => (n.plans || []).filter(p => p.kind === 'trade').map(p => `${n.name}: ${p.item} for ${villageOf(p.house)}`)), spare: agents.houses.map(h => `${villageOf(h)} ${h.household[0]?.group?.name || ''}: ${Object.entries(h.spare).map(([k, n]) => n + ' ' + k).join(', ') || 'nothing'}`) });
window.leaMap = on => { if (on === false) closeBigMap(); else openBigMap(); return maps.bigOpen; };
// what folk say about places: the i-th peasant's "Where are we?" answer and news
window.leaAsk = (i = 0) => { const n = agents.npcs[i | 0]; if (!n) return null;
  return { at: placeAt(n.x, n.z).name, where: whereAreWe(n, (k, a) => voicePick(n, k, a)), news: newsReport(n, sky?.time ?? 0) }; };
window.leaCull = v => (cullOn = v !== false);   // leaCull(false) draws the whole world's flora — for measuring
window.leaWorld = () => ({ scene, camera, forage, agents, trail });   // debug handle on the live world
function pacing(iv){
  if (!iv.length) return {};
  const a = iv.slice().sort((x, y) => x - y), q = p => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(1);
  return { medianMs: q(0.5), p95Ms: q(0.95), worstMs: +a[a.length - 1].toFixed(1), over25ms: a.filter(v => v > 25).length };
}
window.leaPerf = () => {
  const n = Math.max(1, perf.frames), secs = (performance.now() - perf.t0) / 1000;
  const out = {
    fps:       +(perf.frames / Math.max(secs, 1e-3)).toFixed(1),
    // wall-clock, not the loop's dt: dt is clamped, so it lies about a slow frame
    frameMs:   +(secs * 1000 / n).toFixed(2),
    simMs:     +(perf.sim / n).toFixed(2),      // agents.update + every NPC's brain & billboard
    drawMs:    +(perf.draw / n).toFixed(2),     // JS-side cost of renderer.render (submission, not GPU)
    // the world pass of the last frame — read live, renderer.info would report the
    // hands overlay, which renders after it and resets the counters
    calls:     perf.calls,
    triangles: perf.triangles,
    // frame PACING, not just the average: a few long frames among short ones feel
    // like lag while turning even when fps looks fine
    ...pacing(perf.iv),
    tilesDrawn: floraTilesDrawn(),
    npcs:      npcApi ? npcApi.npcs.length : 0,
  };
  perf.sim = perf.draw = perf.frames = perf.frameMs = 0; perf.t0 = performance.now(); perf.iv.length = 0;
  return out;
};
window.leaWood = () => ({
  ...myc.stats(),
  rings: forage.plants.filter(p => p.ring).length,
  carrying: myc.nodes.reduce((a, n) => a + n.news.size, 0),
  elders: myc.elders.map(e => ({ id: e.id, sp: e.base, guild: e.guild, links: e.links.length,
                                 x: Math.round(e.x), z: Math.round(e.z), news: e.news.size })),
});
// diagnostic: how many folk currently carry a cross-app rumour, with samples
window.leaNews = () => {
  const carry = agents.npcs.filter(n => n.news && [...n.news.values()].some(f => f.src === 'rumor'));
  return { carriers: carry.length, of: agents.npcs.length,
           samples: carry.slice(0, 5).map(n => [...n.news.values()].filter(f => f.src === 'rumor').map(f => f.text)) };
};

// A firework is one occasion with two halves: a burst of colour overhead, and a
// portent the star-readers spread on the ground. The colours come from whatever
// the sending app cleared; the folk never learn the cause — only that a light
// crossed the sky (meaning, never mechanism).
function receiveFirework(d){
  // bloom it ahead of where the player is looking (forward = -(sin yaw, cos yaw)),
  // lifted into the sky, so a clear is reliably seen rather than off behind you.
  const fx = Math.sin(yaw), fz = Math.cos(yaw), dist = 58;
  const at = { x: pos.x - fx * dist, z: pos.z - fz * dist, y: pos.y + 42 };
  const origin = fireworks.launch({ colors: d.colors, rows: d.rows, at });
  const rows = Math.max(1, Math.min(4, (d.rows | 0) || 1));
  const grandeur = ['a spark of', 'a bloom of', 'a great flowering of', 'a whole heaven of'][rows - 1];
  intakeRumor(agents, {
    text: `A light crossed the night — ${grandeur} coloured fire, gone as quick as it came.`,
    courier: 'sky', near: { x: pos.x, z: pos.z, count: 5 },
    id: 'firework:' + Math.floor(performance.now()),
  });
  return origin;
}

addEventListener('keydown', e => keys[e.code] = true);
addEventListener('keyup',   e => keys[e.code] = false);
canvas.addEventListener('click', e => {
  if (!playing) {
    if (_worldReady) canvas.requestPointerLock();   // enter from splash
  } else if (document.pointerLockElement !== canvas) {
    tryClickInteract(e);                            // cursor mode: click to interact or re-lock
  }
});
start.addEventListener('click',  () => { if (_worldReady) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    document.body.classList.remove('cursor-mode');
    if (!playing) {
      // First entry into the game world
      playing = true;
      start.classList.add('hide');
      for (const t of nameTags) t.visible = true;
      window.Leaves?.stop();
      music.init(); footsteps.init(); ambience.init();
    }
    music.play(terrainType(pos.x, pos.z));
  } else {
    if (inDialog || settingsOpen || maps.bigOpen) return;    // dialog/settings/map released lock temporarily
    if (!playing) { music.play('menu'); return; }
    // Player pressed Escape — enter cursor mode (world keeps running)
    document.body.classList.add('cursor-mode');
  }
});

// ---------- sound settings (music vs. effects balance) ----------
const gear = document.getElementById('gear');
const settingsEl = document.getElementById('settings');
const musicRange = document.getElementById('vol-music');
const sfxRange = document.getElementById('vol-sfx');
const musicVal = document.getElementById('vol-music-val');
const sfxVal = document.getElementById('vol-sfx-val');
const readVol = (s, d) => { const v = parseFloat(s); return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d; };
let volMusic = readVol(localStorage.getItem('lea.vol.music'), 0.5);   // music quieter by default
let volSfx   = readVol(localStorage.getItem('lea.vol.sfx'), 1.0);     // effects at full
function applyVolumes(){
  music.setVolume(volMusic); footsteps.setVolume(volSfx); ambience.setVolume(volSfx);
  musicRange.value = Math.round(volMusic * 100); musicVal.textContent = `${Math.round(volMusic * 100)}%`;
  sfxRange.value   = Math.round(volSfx   * 100); sfxVal.textContent   = `${Math.round(volSfx   * 100)}%`;
}
applyVolumes();
musicRange.addEventListener('input', () => { volMusic = musicRange.value / 100; localStorage.setItem('lea.vol.music', volMusic); applyVolumes(); });
sfxRange.addEventListener('input',   () => { volSfx   = sfxRange.value   / 100; localStorage.setItem('lea.vol.sfx',   volSfx);   applyVolumes(); });
// ---------- performance settings (per browser) ----------
// Switches for finding what costs what on a given machine. Defaults are the
// shipped look; each change applies live and is remembered in localStorage.
const GFX_DEFAULTS = { pixel: 4, draw: 130, lod: 55, grass: true, sway: true,
                       smooth: false, hands: true, map: true, meter: false };
const gfx = { ...GFX_DEFAULTS };
try { Object.assign(gfx, JSON.parse(localStorage.getItem('lea.gfx') || '{}')); } catch (_){}
const meterEl = document.getElementById('meter');
function applyGfx(){
  if (PIXEL !== gfx.pixel){ PIXEL = gfx.pixel; resize(); }
  FOG_FAR = gfx.draw; FOG_NEAR = Math.min(30, FOG_FAR * 0.3);
  rain.setFogBase(FOG_NEAR, FOG_FAR);              // rain sets fog.near/far from these each frame
  scene.fog.near = FOG_NEAR; scene.fog.far = FOG_FAR;
  setFloraLod(gfx.lod);
  grassDetail.mesh.visible = gfx.grass;
  grassDetail.swayOn = gfx.sway;   // not .sway: that's the blade buffer
  MAP.style.display = gfx.map ? '' : 'none';
  document.body.classList.toggle('no-minimap', !gfx.map);
  meterEl.classList.toggle('hide', !gfx.meter);
}
const saveGfx = () => { try { localStorage.setItem('lea.gfx', JSON.stringify(gfx)); } catch (_){} };
for (const [key, id, fmt] of [['pixel', 'gfx-pixel', v => `${v}×`], ['draw', 'gfx-draw', v => `${v}`],
                              ['lod', 'gfx-lod', v => `${v}`]]){
  const el = document.getElementById(id), val = document.getElementById(id + '-val');
  el.value = gfx[key]; val.textContent = fmt(gfx[key]);
  el.addEventListener('input', () => { gfx[key] = +el.value; val.textContent = fmt(gfx[key]); applyGfx(); saveGfx(); });
}
for (const [key, id] of [['grass', 'gfx-grass'], ['sway', 'gfx-sway'], ['smooth', 'gfx-smooth'],
                         ['hands', 'gfx-hands'], ['map', 'gfx-map'], ['meter', 'gfx-meter']]){
  const el = document.getElementById(id);
  el.checked = gfx[key];
  el.addEventListener('change', () => { gfx[key] = el.checked; applyGfx(); saveGfx(); });
}
applyGfx();
// frame meter: fps and the worst frame over the last half second
const meter = { n: 0, worst: 0, t0: performance.now(), frameMs: 0 };
function tickMeter(frameMs){
  if (!gfx.meter) return;
  meter.n++; if (frameMs > meter.worst) meter.worst = frameMs;
  const now = performance.now();
  if (now - meter.t0 < 500) return;
  meterEl.textContent = `${(meter.n * 1000 / (now - meter.t0)).toFixed(0)} fps · worst ${meter.worst.toFixed(0)} ms · ${perf.calls} calls`;
  meter.n = 0; meter.worst = 0; meter.t0 = now;
}

function openSettings(){ settingsOpen = true; settingsEl.classList.remove('hide'); document.exitPointerLock?.(); }
function closeSettings(){ settingsOpen = false; settingsEl.classList.add('hide'); if (playing && !document.body.classList.contains('cursor-mode')){ try { canvas.requestPointerLock(); } catch (_){} } }
gear.addEventListener('click', e => { e.stopPropagation(); settingsOpen ? closeSettings() : openSettings(); });
document.getElementById('settings-done').addEventListener('click', closeSettings);

addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX*0.0022;
  pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY*0.0022));
});

// ---------- debug presence: pose-from-URL, fly cam, copy-pose ----------
const pos = new THREE.Vector3(0, 0, 20);
pos.y = height(pos.x, pos.z) + EYE;
let fly = params.has('fly');
const DEBUG = params.has('debug');
if (params.has('x') || params.has('debug')){
  document.getElementById('start')?.classList.add('hide'); window.Leaves?.stop();
  playing = true; for (const t of nameTags) t.visible = true;
}
if (params.has('x'))     pos.x = +params.get('x');
if (params.has('z'))     pos.z = +params.get('z');
if (params.has('y'))     pos.y = +params.get('y');
if (params.has('yaw'))   yaw   = +params.get('yaw');
if (params.has('pitch')) pitch = +params.get('pitch');
// ?canoebed[=0.5] — debug: a canoe half made on the bank nearest you (docs/boats.md,
// "Making canoes"), its materials in and that much of the work done; 0 shows the
// bed with its bark laid out instead. Its place goes to the console.
if (params.has('canoebed')){
  const at = [...agents.fishing].sort((p, q) => Math.hypot(p.x - pos.x, p.z - pos.z) - Math.hypot(q.x - pos.x, q.z - pos.z))[0];
  const site = at && agents.canoeSite({ x: at.x, z: at.z, group: null });
  if (site){
    const b = agents.addCanoeBuild(site, { name: 'nobody', group: null, needs: { company: 0 } });
    const t = Math.min(1, +(params.get('canoebed') || 0.5));
    b.bark = t > 0 ? 3 : 2; b.ribs = t > 0 ? 4 : 0; b.work = t * b.workNeed; b.view?.sync();
    console.log(`canoe bed at ?x=${site.x.toFixed(0)}&z=${site.z.toFixed(0)}`);
  }
}
const poseURL = () =>
  `${location.origin}${location.pathname}?x=${pos.x.toFixed(1)}&z=${pos.z.toFixed(1)}` +
  `&y=${pos.y.toFixed(1)}&yaw=${yaw.toFixed(3)}&pitch=${pitch.toFixed(3)}&fly=1`;
let poseMsg = '';    let _poseMsgT = 0;
let forageMsg = ''; let _forageMsgT = 0;
const setForageMsg = (s, ms = 2000) => { forageMsg = s; clearTimeout(_forageMsgT); _forageMsgT = setTimeout(() => forageMsg = '', ms); };
const setPoseMsg   = (s, ms = 2500) => { poseMsg   = s; clearTimeout(_poseMsgT);   _poseMsgT   = setTimeout(() => poseMsg   = '', ms); };
let nearTalker = null;     // {c, dialog|peasant, name} of the nearest talkable NPC
let nearFish = null;       // a fishing spot you're on the bank of (E casts)
// Your line in the water (docs/fishing.md): where, how long you'll wait, where
// you stood. Walk off and you reel in. Bites come as for the folk (agents.biteRate).
let playerFish = null;
const FISH_LOW_SHOWN = 0.2;
const FISH_NAMES = ['perch', 'roach', 'tench', 'rudd', 'pike'];
const DEEP_NAMES = ['pike', 'trout', 'perch', 'bream'];   // what's caught out on the deep water
const BOAT_CAST_R = 9;                                     // how near a ground's middle you can fish it from a boat
function castLine(sp){
  if (sp.taken && sp.taken !== PLAYER){ setForageMsg(`${displayName(sp.taken)} is fishing there.`); return; }
  sp.taken = PLAYER;
  // the float: off the bank where the spot says, or over the side of the boat
  const a = sp.boat ? yaw + Math.PI : 0, me = down ? upos : pos;   // (yaw 0 looks down -Z: over the bow)
  const fx = sp.boat ? me.x + Math.sin(a) * 3.5 : sp.wx, fz = sp.boat ? me.z + Math.cos(a) * 3.5 : sp.wz;
  playerFish = { sp, left: 25 + Math.random() * 20, x: me.x, z: me.z, fx, fz };
  setForageMsg(sp.boat ? 'You let a line down over the side. Hold the boat still.' : 'You cast a line. Hold still and wait.', 4000);
}
function reelIn(msg){
  if (!playerFish) return;
  if (playerFish.sp.taken === PLAYER) playerFish.sp.taken = null;
  playerFish = null;
  if (msg) setForageMsg(msg, 3500);
}
function tickFishing(dt){
  const f = playerFish, me = down ? upos : pos;
  if (!f) return;
  if (Math.hypot(me.x - f.x, me.z - f.z) > 1.5) return reelIn('You reel in.');
  f.left -= dt;
  if (Math.random() < agents.biteRate(f.sp, null) * dt){
    const n = agents.landFish(f.sp), k = f.sp.kind;
    if (!myPack.add(k, n, provHere('fished'))) return reelIn('No room in your pack. You let it go.');
    jot('caught', (ingredient(k) || {}).label || k);
    if (invOpen) openInventory();
    const names = f.sp.boat ? DEEP_NAMES : FISH_NAMES;
    const name = k === 'eels' ? (n === 1 ? 'An eel' : 'Two eels') : `${n === 1 ? 'A' : 'Two'} ${names[(Math.random() * (n === 1 ? names.length : names.length - 1)) | 0]}`;
    return reelIn(`${name}, into the basket.`);
  }
  if (f.left <= 0) reelIn(f.sp.stock < 0.3 ? "Nothing's biting. It's been fished hard." : (sky?.evening ?? 0) > 0.2 ? "Nothing's biting." : "Nothing's biting. They rise better at dusk.");
}
// who's fishing near you, for the view: the folk on the bank, and you
function fishersNear(){
  const out = [];
  for (const n of npcApi.npcs){
    const sp = n.fishing;
    if (!sp || n._indoors || n.moving || Math.hypot(n.x - pos.x, n.z - pos.z) > 120) continue;
    out.push({ x: n.x, y: n.rideY != null ? n.rideY - 0.35 : height(n.x, n.z), z: n.z, face: sp.face, wx: sp.wx, wz: sp.wz, d: Math.hypot(n.x - pos.x, n.z - pos.z) });   // (in a canoe: from the gunwale)
  }
  out.sort((a, b) => a.d - b.d);
  if (playerFish){
    const f = playerFish, face = Math.atan2(f.fx - pos.x, f.fz - pos.z);
    out.unshift({ face, wx: f.fx, wz: f.fz, hand: { x: pos.x + Math.sin(face) * 0.5, y: pos.y - 0.5, z: pos.z + Math.cos(face) * 0.5 } });
  }
  return out;
}
let nearFruit = null;      // nearest ripe forageable plant within reach
let nearObject = null;     // a non-pickable thing you can inspect with E (e.g. a campfire/pot)
let nearBoat = null;       // a moored boat within reach to climb into with E
let nearTree = null;       // a tree within reach to listen to with E
let nearPortal = null;     // a door into Faerie, with the salve on (portals)
let nearRing = null;       // a mushroom ring strong enough to speak for the network
let boating = null;        // the boat you're currently aboard (null = on foot)
let mapMark = null;        // {x,z,name} drawn on the minimap (a person's last-seen spot)
const SIGHT_RANGE = 18;    // "in view" radius — matches agents.js sighting memory

// you don't know a stranger's name until you've been told it (npc.known). Until
// then they read as e.g. "An elvish fellow" / "A dwarven lady" in box & dialogue.
const RACE_ADJ = { elf: 'elvish', dwarf: 'dwarven', human: 'human', goblin: 'goblin' };
function descriptor(npc){
  const adj = RACE_ADJ[npc.race] || 'wandering';
  const noun = npc.gender === 'female' ? 'lady' : 'fellow';
  return `${/^[aeiou]/i.test(adj) ? 'An' : 'A'} ${adj} ${noun}`;
}
function displayName(npc){ return npc.known && npc.name ? npc.name : descriptor(npc); }

// how `other` is related to `speaker`, from the speaker's view, using the light
// kin roles set in society.js (assignRoles). Drives the "Who are your people?" roster.
function relationTo(speaker, other){
  if (other === speaker) return '(myself)';
  const g = speaker.group; if (!g) return 'companion';
  const fem = other.gender === 'female';
  if (g.kind === 'family'){
    const sChild = speaker.role === 'child', oChild = other.role === 'child';
    if (sChild && !oChild) return fem ? 'mother' : 'father';
    if (!sChild && oChild) return fem ? 'daughter' : 'son';
    if (!sChild && !oChild) return fem ? 'wife' : 'husband';
    return fem ? 'sister' : 'brother';
  }
  if (g.kind === 'clan') return other.role === 'elder' ? 'clan elder' : (fem ? 'kinswoman' : 'kinsman');
  if (g.kind === 'band') return other.role === 'captain' ? 'our captain' : 'comrade';
  return 'companion';
}

// a colloquial "when" for a sighting that happened `days` ago (sky.time is in days)
function timeAgo(days){
  const h = days * 24;
  if (h < 0.5) return 'just now';
  if (h < 2)   return 'a little while ago';
  if (h < 8)   return 'a few hours ago';
  if (days < 1.5) return 'yesterday';
  return `${Math.round(days)} days ago`;
}

// where/when the speaker last saw `o`, and whether it warrants a map marker.
// Returns { line, mark }. Four cases, per design:
//   - right here now      → "standing right here with me"   (no marker)
//   - in view now         → "not far — just over yonder"    (no marker)
//   - old sighting, near  → "around this very spot, {when}"  (no marker)
//   - old sighting, away  → "{when}, away from here…"        (marker)
// No memory at all → an apologetic line, no marker.
function sightingOf(speaker, o, now){
  const fem = o.gender === 'female';
  const They = fem ? 'She' : 'He', them = fem ? 'her' : 'him';
  const v = (key, arr) => voicePick(speaker, key, arr);
  const nowD = Math.hypot(o.x - speaker.x, o.z - speaker.z);
  if (nowD < 3.5)  return { line: v('so-here', [`${They}'s standing right here with me.`, `Why, ${them} right here beside me!`, `${They}'s here — you're looking at ${them}.`]), mark: null };
  if (nowD < SIGHT_RANGE) return { line: v('so-near', [`${They}'s not far — just over yonder.`, `${They}'s about, only a few steps off.`, `Close by — there, see?`]), mark: null };
  const s = speaker.seen && speaker.seen.get(o);
  if (!s) return { line: v('so-none', [`I've not laid eyes on ${them} in an age.`, `Haven't seen hide nor hair of ${them} lately.`, `Couldn't tell you — it's been too long.`]), mark: null };
  const when = timeAgo(Math.max(0, now - s.t));
  const seenNear = Math.hypot(s.x - speaker.x, s.z - speaker.z) < 22;
  if (seenNear) return { line: v('so-spot', [`I saw ${them} around this very spot, ${when}.`, `${They} was hereabouts ${when}.`, `Last I saw ${them}, ${when}, ${pron2(fem)} was right around here.`]), mark: null };
  const there = placeAt(s.x, s.z), where = there === placeAt(speaker.x, speaker.z) ? 'a way off from here' : placePhrase(there);
  return { line: v('so-far', [`I last saw ${them} ${when}, ${where} — let me show you where on your map.`, `${They} was ${where} ${when} — here, I'll mark it for you.`, `Saw ${them} ${where}, ${when}. I'll point it on your map.`]),
           mark: { x: s.x, z: s.z, name: o.name } };
}
const pron2 = fem => fem ? 'she' : 'he';

// the speaker describing a groupmate's nature (third person), for the clickable
// kin roster. The "last seen" sentence is appended by the caller (sightingOf).
function describeKin(speaker, o){
  const ps = o.persona || {}, g = k => ps[k] ?? 1;
  const fem = o.gender === 'female';
  const They = fem ? 'She' : 'He', them = fem ? 'her' : 'him', themself = fem ? 'herself' : 'himself';
  const kind = speaker.group && speaker.group.kind, rel = relationTo(speaker, o);
  const relPhrase = kind === 'band' ? (rel === 'our captain' ? rel : `a ${rel}`) : `my ${rel}`;
  const v = (key, arr) => voicePick(speaker, 'dk-' + o.id + '-' + key, arr);
  const dom = [['food', g('food'), v('food', [`${They} thinks mostly of the next meal.`, `${They}'s ever hungry, that one.`, `Lives for ${them === 'her' ? 'her' : 'his'} food, ${They.toLowerCase()} does.`])],
               ['company', g('company'), v('comp', [`${They} loves good company above all.`, `${They}'s never happier than among folk.`, `A sociable soul, ${them} — always in the thick of it.`])],
               ['beauty', g('beauty'), v('beau', [`${They} can't pass a pretty shell or stone.`, `${They}'s an eye for bright things.`, `Always stooping for some bauble, ${They.toLowerCase()} is.`])],
               ['comfort', (g('warmth') + g('rest')) / 2, v('comf', [`${They} asks only for a warm hearth and a good rest.`, `${They} likes ${fem ? 'her' : 'his'} comforts — a fire and a rest.`, `An easy life suits ${them} best.`])]]
              .reduce((a, b) => b[1] > a[1] ? b : a)[2];
  const social = g('company') < 0.8 ? v('soc-', [`Keeps to ${themself}, mostly.`, `A quiet one — keeps ${fem ? 'her' : 'his'} own counsel.`, `Solitary, by nature.`])
    : g('company') > 1.25 ? v('soc+', [`Happiest in a crowd.`, `Loves a gathering, ${them}.`, `Can't abide being alone.`]) : v('soc0', [`Takes folk as they come.`, `Easy enough with anyone.`, `Gets on with most.`]);
  const sk = [];
  if (g('strength') > 1.15) sk.push('strong in the arm'); else if (g('strength') < 0.85) sk.push('not the sturdiest');
  if (g('perception') > 1.15) sk.push('sharp-eyed'); else if (g('perception') < 0.85) sk.push('a touch blind to small things');
  const skill = sk.length ? ` And ${fem ? 'she' : 'he'}'s ${sk.join(', ')}.` : '';
  const give = g('generosity') > 1.2 ? ` Open-handed — ${fem ? 'she' : 'he'} shares freely.`
    : g('generosity') < 0.8 ? ` Keeps a tight fist, mind.` : '';
  const stand = (o.esteem || 0) > 4 ? ` Well thought of among us.` : '';
  return `${o.name} — ${relPhrase}. ${dom} ${social}${skill}${give}${stand}`;
}

// a rough compass direction from one point to another (N = -z, E = +x), or
// "hereabouts" when it's close. Reuses the COMPASS table used for the wind.
function bearingWord(fx, fz, tx, tz){
  const dx = tx - fx, dz = tz - fz;
  if (Math.hypot(dx, dz) < 7) return 'hereabouts';
  const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return 'to the ' + COMPASS[Math.round(bearing / 45) % 8];
}
// where a thing is, as a local would say it: by the place's name when it's
// somewhere else ("out on the Tackey Marshes"), by compass when it's in the
// speaker's own place ("to the north", "hereabouts")
function whereWord(fx, fz, tx, tz){
  const there = placeAt(tx, tz);
  return there === placeAt(fx, fz) ? bearingWord(fx, fz, tx, tz) : placePhrase(there);
}
const cap = s => s[0].toUpperCase() + s.slice(1);
const compassOf = deg => COMPASS[Math.round(deg / 45) % 8];

// The way there, as a local would add it: the one thing worth knowing about the
// walk from the speaker to (x, z) — read off the route they'd really take (the
// nav's, so it's the same way they'd walk it; js/ways.js) — in their own words,
// or '' when it's an ordinary stroll.
const WAY_LINES = {
  road:  ["Take the road most of the way.", "The road gets you most of the way."],
  round: ["You'll have to go round.", "It's a long way round."],
  bog:   ["Boggy going, mind.", "Wet underfoot most of the way."],
  path:  ["There's a path most of the way.", "Follow the path."],
  up:    ["It's uphill.", "It's a climb."],
  down:  ["Downhill, easy enough.", "Downhill most of the way."],
  rock:  ["Rough going over the rocks.", "It's rocky. Mind your feet."],
  wood:  ["Through the trees.", "It's through the woods."],
};
function wayLine(sp, x, z){
  const path = agents.nav.findPath(sp.x, sp.z, x, z);
  const note = path && wayNote(walkOf([[sp.x, sp.z], ...path], (px, pz) => trail.wearAt(px, pz)));
  return note ? voicePick(sp, 'way-' + note, WAY_LINES[note]) : '';
}
const withWay = (line, sp, x, z) => { const w = wayLine(sp, x, z); return w ? `${line} ${w}` : line; };

// the old road as a landmark: which way it lies, or which ways it runs if
// you're standing on it ('' when it's too far off to matter)
function roadLine(npc, v){
  const r = roadFrom(npc.x, npc.z);
  if (!r) return '';
  if (r.on) return v('w-road-on', [`You're on the old road. It runs ${compassOf(r.runs[0])} and ${compassOf(r.runs[1])}.`,
                                   `This is the old road, running ${compassOf(r.runs[0])} to ${compassOf(r.runs[1])}.`]);
  const dir = compassOf(r.toward);
  return r.d < 60 ? v('w-road-near', [`The old road's just ${dir} of here.`, `The old road's close, off to the ${dir}.`])
                  : v('w-road-far', [`Head ${dir} and you'll strike the old road.`, `The old road runs ${dir} of here.`]);
}

// "Where are we?" — the place's name, and the lie of the land around it: its
// biggest neighbours by compass, and the great lake if it's not among them.
function whereAreWe(npc, v){
  const here = placeAt(npc.x, npc.z), name = here.name;
  const dir = g => COMPASS[Math.round(((Math.atan2(g.x - npc.x, -(g.z - npc.z)) * 180 / Math.PI + 360) % 360) / 45) % 8];
  let text = v('w-here', [`This is ${name}.`, `You're ${placePhrase(here)}, friend.`, `${cap(name)}, this. Folk have called it so as long as anyone remembers.`, `Why, ${name}. Did you not know?`]);
  const nb = here.neighbours.filter(g => g.kind !== 'island' || here.kind === 'greatlake').slice(0, 2);
  if (nb.length) text += ' ' + nb.map((g, i) => `${i ? 'to the' : 'To the'} ${dir(g)}, ${g.name}`).join('; ') + '.';
  const lake = placesBig();
  if (lake && lake !== here && !nb.includes(lake) && here.kind !== 'island')
    text += ' ' + v('w-lake', [`And away to the ${dir(lake)} lies the great lake, ${lake.name}.`, `Keep on ${dir(lake)} long enough and you'll come to ${lake.name}.`]);
  const road = roadLine(npc, v);
  if (road) text += ' ' + road;
  return `"${text}"`;
}
const placesBig = () => places().find(g => g.kind === 'greatlake');

// what an NPC will tell you when asked for news: its freshest few facts, each as a
// sentence (who was seen where/when, where food grows). Reads npc.news (agents.js).
function newsReport(npc, now){
  const rank = f => (f.kind === 'omen' ? 3 : f.kind === 'kind' ? 2 : f.kind === 'food' || f.kind === 'boat' ? 1 : 0);   // omens, reputation & tips before idle sightings
  const facts = npc.news ? [...npc.news.values()].sort((a, b) => rank(b) - rank(a) || b.t - a.t).slice(0, 3) : [];
  if (!facts.length) return voicePick(npc, 'n-none', [`"Naught I've heard worth the telling, friend."`, `"Quiet of late — no news to pass on."`, `"Nothing's reached my ears worth your time."`]);
  // people are named in rumour (the speaker knows them) — and hearing the name is
  // itself how you come to *know of* someone (sets heardFrom, so a later meeting
  // recognises them: "I've heard of you, from …"). See displayName / peasantTree.
  for (const f of facts) if (f.subj && f.subj !== npc && !f.subj.known && !f.subj.heardFrom) f.subj.heardFrom = npc;
  // the first tip of food gets the way there too: that's the one you might walk
  const tip = facts.find(f => f.kind === 'food' && Number.isFinite(f.x));
  const lines = facts.map(f => { const l = factLine(npc, f, now, PLAYER); return l && f === tip ? withWay(l, npc, f.x, f.z) : l; }).filter(Boolean);
  return '"' + lines.join(' ') + '"';
}

// The player, as a listener: factLine names people differently to a stranger
// ("my sister Bryn") than to someone who knows them ("Bryn", "Mum").
const PLAYER = { player: true };
const PARENT = { mother: 'Mum', father: 'Dad' };

// what `sp` calls `o` when talking to `to`. Folk who both know someone well use
// the first name (or Mum / Dad, inside a family); to you, kin come with how
// they're related; anyone else gets their full name.
function callName(sp, o, to){
  if (o === to) return 'you';
  if (o === sp) return 'me';
  const given = o.given || o.name || displayName(o);
  const kin = sp.group && o.group === sp.group;
  const rel = kin ? relationTo(sp, o) : null;
  if (to === PLAYER){
    if (!kin) return o.name || displayName(o);
    if (PARENT[rel] || rel === 'wife' || rel === 'husband') return 'my ' + rel;
    return rel === 'companion' ? given : `${rel.startsWith('our') ? rel : 'my ' + rel} ${given}`;
  }
  if (kin && to.group === sp.group) return PARENT[rel] || given;
  const knows = (to.group && to.group === o.group) || (to.ties?.get(o)?.fam || 0) > 0.15;
  return knows ? given : (o.name || given);         // the full name introduces someone
}

// where, said plainly: "right here", "north of here", "out on the Tackey Marshes"
function whereSaid(sp, x, z){
  const d = Math.hypot(x - sp.x, z - sp.z);
  if (d < 7) return 'right here';
  const there = placeAt(x, z);
  if (there !== placeAt(sp.x, sp.z)) return placePhrase(there);
  const dir = COMPASS[Math.round(((Math.atan2(x - sp.x, -(z - sp.z)) * 180 / Math.PI + 360) % 360) / 45) % 8];
  return (d < 25 ? 'just ' : '') + dir + ' of here';
}
// when, said plainly; '' for "just now"-ish, so a fresh thing needs no time word
function whenSaid(days){
  const h = days * 24;
  return h < 0.5 ? '' : h < 3 ? 'earlier' : h < 12 ? 'a few hours ago' : days < 1.5 ? 'yesterday' : `${Math.round(days)} days ago`;
}
const tail = w => w ? ' ' + w : '';
const pron = (o, his = false) => o.gender === 'female' ? 'her' : his ? 'his' : 'him';

// one fact as the speaker would say it to `to` — another dweller (overheard in a
// speech bubble) or you (PLAYER: "Heard any news?", or unprompted). First-hand
// news is said as what they did ("I found some berries north of here");
// passed-on news names who said it ("Bob says…"). Short, active, one sentence.
function factLine(sp, f, now, to){
  const vp = (key, arr) => voicePick(sp, key + f.key, arr);   // their own way of saying this one
  let src = f.from ? callName(sp, f.from, to) : null;
  const says = src === 'you' ? 'said' : 'says';          // "you told me so yourself"
  if (src === 'you') src = 'You';
  const who = f.subj ? callName(sp, f.subj, to) : '';
  const where = whereSaid(sp, f.x, f.z), when = whenSaid(Math.max(0, now - f.t));
  let line = '';
  if (f.kind === 'food'){
    const food = f.foodKind, are = /s$/.test(food) ? 'there are' : "there's";
    line = src ? vp('f2', [`${src} ${says} ${are} ${food} ${where}.`, `${src} told me ${are} ${food} ${where}.`])
               : vp('f1', [`I found some ${food} ${where}${tail(when)}.`, `I found ${food} ${where}${tail(when)}.`]);
  } else if (f.kind === 'saw'){
    line = src ? vp('s2', [`${src} ${says} ${who} was ${where}${tail(when)}.`, `${who} was ${where}${tail(when)}, ${src.toLowerCase() === 'you' ? 'you said' : src + ' says'}.`])
               : vp('s1', [`I saw ${who} ${where}${tail(when)}.`, `${who} was ${where}${tail(when)}.`]);
  } else if (f.kind === 'kind'){
    const got = f.obj ? callName(sp, f.obj, to) : 'someone';
    line = src ? vp('k2', [`${src} ${says} ${who} shares ${pron(f.subj, true)} food.`, `${who}'s generous, ${src.toLowerCase() === 'you' ? 'you said' : src + ' says'}.`])
         : got === 'me' ? vp('k1', [`${who} gave me some food${tail(when)}.`, `${who} shared ${pron(f.subj, true)} food with me${tail(when)}.`])
         : vp('k0', [`${who} gave ${got} some food${tail(when)}.`, `I saw ${who} share food with ${got}.`]);
  } else if (f.kind === 'boat'){
    line = f.maker === sp ? vp('b0', [`I made a canoe. It's ${where}.`, `There's a canoe ${where}. I made it.`])
         : src ? vp('b2', [`${src} ${says} there's a canoe ${where}.`, `There's a canoe ${where}, ${src.toLowerCase() === 'you' ? 'you said' : src + ' says'}.`])
               : vp('b1', [`There's a canoe ${where}.`, `I saw a canoe ${where}${tail(when)}.`]);
  } else if (f.kind === 'omen'){
    line = src ? `${src} ${says}: ${f.text}` : f.text;
  } else if (f.kind === 'dish'){
    line = f.subj === sp ? `I make ${f.recipe} now, from an old book${tail(when)}.`
         : src ? `${src} ${says} ${who} makes ${f.recipe} now, from an old book.` : `${who} makes ${f.recipe} now, from an old book.`;
  } else if (f.kind === 'market'){
    const deal = `${qty(f.qn, f.get)} for ${qty(f.gn, f.give)}`, at = villageOf(f.house);
    line = (f.subj === sp ? `I got ${deal} at ${at}${tail(when)}.` : `${who} got ${deal} at ${at}${tail(when)}.`)
      + (f.wish ? ` They're short of ${goods(f.wish)} there.` : '');
  }
  return line && cap(line);
}

// "What are you planning?" — their agenda (plans.js) and any shared plan they're in
// (projects.js), said plainly. Read live; nothing here is made up for you.
function plansReport(npc, v){
  const now = agents.time, out = [];
  const pr = npc.project && npc.project.status === 'on' ? npc.project : null;
  if (pr){
    const mine = pr.taskOf(npc);
    const others = [...pr.members].filter(m => m !== npc).map(m => callName(npc, m, PLAYER));
    out.push(pr.kind === 'dish' ? `We're making ${dishName(pr.dish)} tonight${others.length ? ', with ' + others.join(' and ') : ''}.` : `We're gathering food for the camp.`);
    if (mine) out.push(mine.cook ? "I'm doing the cooking." : `I'm to get the ${mine.item[0] === 'meat' ? 'rabbit' : mine.item[0]}.`);
  }
  let wayTold = false;                               // the way is said for the first trip only
  const trip = (line, p) => { if (wayTold || !Number.isFinite(p.x)) return line; wayTold = true; return withWay(line, npc, p.x, p.z); };
  for (const p of (npc.plans || [])){
    if (p.until < now || p.project) continue;
    if (p.start && now < p.start) out.push(trip(`First thing tomorrow I'm going for ${p.food} ${whereSaid(npc, p.x, p.z)}.`, p));
    else if (p.kind === 'dish') out.push(`I've a mind to make ${dishName(p.dish)}.`);
    else if (p.kind === 'food') out.push(trip(`I'm going for the ${p.food} ${whereSaid(npc, p.x, p.z)}${p.from ? ` that ${callName(npc, p.from, PLAYER)} told me of` : ''}.`, p));
    else if (p.kind === 'bring') out.push(`I'm taking ${p.item[0]} to the pot.`);
    else if (p.kind === 'help') out.push("I'm helping at the pot.");
    else if (p.kind === 'wood') out.push("I'm off for firewood.");
    else if (p.kind === 'hut') out.push("I need to start on a hut.");
    else if (p.kind === 'canoe') out.push(p.build && p.build.owner === npc ? "I'm making a canoe." : `I'm helping ${callName(npc, p.build.owner, PLAYER)} with a canoe.`);
    else if (p.kind === 'trade') out.push(p.item === 'meat' ? `I'm after a rabbit to take to ${villageOf(p.house)}.` : `I'm gathering ${goods(p.item)} to take to ${villageOf(p.house)}.`);
    else if (p.kind === 'meal') out.push(`There's ${dishName(p.dish)} at the fire. I'll eat with the others.`);
  }
  if (!out.length) return '"' + v('pl-none', ["Nothing much. Day by day.", "Nothing planned. I'll see what comes.", "Plans? I just get on."]) + '"';
  return '"' + out.slice(0, 3).join(' ') + '"';
}

// ---- what they say in conversation (js/convo.js) ----------------------------
// A conversation is a chain of short moves; each move's `key` picks its line.
// Short on purpose: the detail comes a turn at a time ("Ted saw some berries."
// "Where?" "South of here."), so a bubble is a few words.

// a fact as the opening of a topic: what, and from whom — the where comes later
function tellLine(sp, f, to, now){
  const vp = (key, arr) => voicePick(sp, key + f.key, arr);
  const src = f.from ? callName(sp, f.from, to) : null, saw = f.hops === 1;   // the teller saw it themselves
  const who = f.subj ? callName(sp, f.subj, to) : '', when = whenSaid(Math.max(0, now - f.t));
  if (f.kind === 'food'){
    const food = f.foodKind, are = /s$/.test(food) ? 'there are' : "there's";
    return !src ? vp('tf1', [`I found some ${food}.`, `I came across some ${food}.`])
      : saw ? vp('tf2', [`${src} saw some ${food}.`, `${src} found some ${food}.`])
            : vp('tf3', [`${src} says ${are} ${food} about.`, `${src} heard of some ${food}.`]);
  }
  if (f.kind === 'saw') return !src ? `I saw ${who}${tail(when)}.` : saw ? `${src} saw ${who}${tail(when)}.` : `${src} says ${who}'s about.`;
  if (f.kind === 'kind'){
    const got = f.obj ? callName(sp, f.obj, to) : 'someone';
    return !src ? `${who} gave ${got} some food.` : `${src} says ${who}'s been sharing.`;
  }
  if (f.kind === 'market'){
    const deal = `${qty(f.qn, f.get)} for ${qty(f.gn, f.give)}`, at = villageOf(f.house);
    return f.subj === sp ? `I got ${deal} at ${at}.` : `${who} got ${deal} at ${at}.`;
  }
  if (f.kind === 'dish') return f.subj === sp ? vp('td0', [`I've learnt to make ${f.recipe}. From an old book, it is.`, `I make ${f.recipe} now. It's out of an old book.`])
    : !src ? `${who} makes ${f.recipe}, out of an old book.` : `${src} says ${who} makes ${f.recipe}, from an old book.`;
  if (f.kind === 'boat') return f.maker === sp ? vp('tb0', ["I've made a canoe.", "The canoe's finished."])
    : !src ? vp('tb1', ["I saw a canoe.", "There's a canoe about."])
    : saw ? `${src} saw a canoe.` : `${src} says there's a canoe.`;
  if (f.kind === 'omen') return f.house ? (src ? `${src} says the moon's in the House of the ${f.house}.` : `The moon's in the House of the ${f.house}.`)
                                        : (src ? `${src} says: ${f.text}` : f.text);
  return '';
}

// the day's news as a fireside story: what happened, where, and that it was today
function storyLine(sp, f, to, now){
  const src = f.from ? callName(sp, f.from, to) : null, who = f.subj ? callName(sp, f.subj, to) : '';
  const where = whereSaid(sp, f.x, f.z);
  if (f.kind === 'food') return cap(src ? `${src} found ${f.foodKind} ${where} today.` : `I found ${f.foodKind} ${where} today.`);
  if (f.kind === 'saw')  return cap(src ? `${src} saw ${who} ${where} today.` : `I saw ${who} ${where} today.`);
  if (f.kind === 'kind'){ const got = f.obj ? callName(sp, f.obj, to) : 'someone'; return cap(`${who} gave ${got} food today.`); }
  return tellLine(sp, f, to, now);
}

// "where?" answered roughly, by compass from the speaker
function whereCoarse(sp, x, z){
  const d = Math.hypot(x - sp.x, z - sp.z);
  if (d < 7) return 'Right here.';
  const dir = COMPASS[Math.round(((Math.atan2(x - sp.x, -(z - sp.z)) * 180 / Math.PI + 360) % 360) / 45) % 8];
  return d < 25 ? `Just ${dir} of here.` : `${cap(dir)} of here.`;
}
// The hearer's guess at how far: the named place a good way past it, the way it
// lies ("All the way at Rowsly Lake?" "Not that far."), or the place itself if
// that's further on anyway ("Out on the Tackey Marshes?" "That's it.").
function guessOf(m){
  if (m._g) return m._g;
  const sp = m.who, dx = m.x - sp.x, dz = m.z - sp.z;
  const actual = placeAt(m.x, m.z), past = placeAt(sp.x + dx * 1.7, sp.z + dz * 1.7), here = placeAt(sp.x, sp.z);
  return (m._g = past && past !== actual && past !== here ? { place: past, wrong: true }
               : actual !== here ? { place: actual, wrong: false } : { place: null, far: Math.hypot(dx, dz) > 60 });
}

// ---- trade talk (convo.js haggleChain, docs/trade.md) ----------------------
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
const num = n => NUM[n] || String(n);
// "three morels", "a turnip", "two cuts of meat", "a pretty thing"
function qty(n, kind){
  if (kind === 'meat') return n === 1 ? 'a cut of meat' : `${num(n)} cuts of meat`;
  if (kind === 'trinket') return n === 1 ? 'a pretty thing' : `${num(n)} pretty things`;
  if (kind === 'amber' || kind === 'quartz') return n === 1 ? `a piece of ${kind}` : `${num(n)} pieces of ${kind}`;
  if (kind === 'cave salt') return n === 1 ? 'a lump of cave salt' : `${num(n)} lumps of cave salt`;
  const one = kind === 'berries' ? 'berry' : kind === 'cattail root' ? kind : kind.replace(/s$/, '');
  return n === 1 ? `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}` : `${num(n)} ${goods(kind)}`;
}
// the kind said as goods: "acorns", "cattail roots", "pretty things"
const goods = kind => kind === 'trinket' ? 'pretty things' : kind === 'cattail root' || kind === 'shell' || kind === 'stone' ? kind + 's' : kind;
function tradeLine(m, sp){
  const v = (k, arr) => voicePick(sp, k, arr), N = n => cap(num(n));
  switch (m.key){
    case 'tr-ask':     return v('tr-ask', [`Any ${m.item} to spare?`, `Have you ${m.item} to trade?`, `I'm after ${m.item}. Got any?`]);
    case 'tr-what':    return v('tr-what', ['Some. What have you brought?', "Might have. What've you got?", 'Could be. What are you offering?']);
    case 'tr-bid':     return `${cap(qty(m.gn, m.give))} for ${qty(m.qn, m.get)}?`;
    case 'tr-counter': return v('tr-counter', [`${N(m.qn)}.`, `${N(m.qn)}, no more.`, `I'd give ${num(m.qn)}.`]);
    case 'tr-meet':    return v('tr-meet', [`${N(m.qn)}, then?`, `Call it ${num(m.qn)}?`]);
    case 'tr-done':    return v('tr-done', ['Done.', 'Done. Here you are.', 'Fair enough. Done.']);
    case 'tr-off':     return "You've not got them now.";
    case 'tr-show':    return m.item ? v('tr-show', [`${cap(goods(m.item))}, mostly.`, `I've ${goods(m.item)}.`]) : 'Not much, truth be told.';
    case 'tr-no':      return m.wish && m.wish !== m.item
      ? v('tr-no', [`No use for ${goods(m.item)}. Bring ${goods(m.wish)}, and we'll talk.`, `Not for ${goods(m.item)}. We're short of ${goods(m.wish)}.`])
      : `No use for ${goods(m.item)}, sorry.`;
    case 'tr-none':    return v('tr-none', ['Nothing to spare, sorry. Not till we reap.', "We've none put by just now."]);
    case 'tr-wish':    return v('tr-wish', [`Bring ${goods(m.item)} next time.`, `We're short of ${goods(m.item)}, if you come by again.`]);
    case 'mk-ask':     return v('mk-ask', ['What do they want there?', 'What are they short of?']);
    case 'mk-wish':    return v('mk-wish', [`${cap(goods(m.item))}, mostly.`, `They're short of ${goods(m.item)}.`]);
    case 'mk-plan':    return v('mk-plan', ["I'll get some and go.", `Then I'll take them ${goods(m.item)}.`]);
    case 'mk-good':    return v('mk-good', ['Not bad.', "That's a fair rate."]);
    case 'mk-dear':    return v('mk-dear', ['Dear, that.', 'They drive a hard bargain.']);
  }
  return '';
}

const SAY = {
  'ask-where':     ['Where?', 'Where was that?', 'Where?'],
  'ask-where-who': ['Where?', 'Where was that?'],
  'thanks':        ['Thanks.', 'Good, thanks.'],
  'propose-food':  ['Want to go and get them?', 'Shall we go?', 'Fancy going?'],
  'yes-go':        ["Yes, let's go.", "Let's go now.", 'Come on, then.'],
  'no-plenty':     ["Nah, there's plenty of food here.", "No need. There's plenty here."],
  'no-pack':       ["Nah, I've got enough.", "I'm fine, I've got food."],
  'no-busy':       ['Not now.', 'Maybe later.'],
  'go-now':        ["I'll go now, then.", "I'm going to go now."],
  'go-later':      ["I think I'll go later.", 'Maybe later, then.'],
  'grab':          ["I'll grab some, then.", 'Good, I need some.'],
  'kind-warm':     ["{who}'s good like that.", "That's {who} for you."],
  'kind-cold':     ['Did {who}, now.', 'Hm. {who}.'],
  'kind-mild':     ['Kind of {who}.', 'Good of {who}.'],
  'omen-ask':      ['Meaning?', 'Is that good?', 'What does that mean?'],
  'hi-name':       ["Hello. I'm {me}.", "Hi. I'm {me}.", '{me}. Hello.'],
  'hi-back':       ['{me}.', "Hello, I'm {me}.", '{me}. Nice to meet you.'],
  'join-ask':      ['Mind if I join you?', 'Room for one more?'],
  'join-ok':       ['Course.', 'Go on.'],
  'join-sit':      ['Sit down.', 'Pull up a log.'],
  'bye':           ["Right, I'm off.", 'Better get going.', 'See you later.'],
  'bye-back':      ['See you.', 'Bye.', 'Take care.'],
  'q-fire':        ["The fire's getting low.", "Fire's nearly out."],
  'a-fire-have':   ["I've got some wood.", "I've got wood here."],
  'a-fire-go':     ["I'll get some. Coming?", "I'll fetch some. You coming?"],
  'a-fire-tired':  ["I'm worn out. Can you?", "I'm too tired. You go?"],
  'yes-come':      ['Sure.', 'All right.'],
  'no-tired':      ["I'm too tired.", "I'll stay. I'm worn out."],
  'fine-i-go':     ["Fine, I'll go.", "All right, I'll go."],
  'someone':       ['Someone should.', 'Somebody ought to.'],
  'q-hut':         ['Should we build a hut?', 'Where are you sleeping tonight?'],
  'a-hut-have':    ['Ours is up.', "We've got our hut."],
  'a-hut-mine':    ["I'd better start mine.", 'I should start on mine.'],
  'a-hut-building':["We're still on ours.", "Ours isn't done yet."],
  'a-hut-yes':     ['Yes, before dark.', "We'd better."],
  'a-hut-rain':    ['Yes, before it pours.', "We'd better. This rain isn't stopping."],
  'q-food':        ["Know where there's food?", 'Any food around?', "I'm starving. Seen any food?"],
  'q-food-kin':    ["I'm starving.", 'Got anything to eat?', "I haven't eaten all day."],
  'give-food':     ['Here, have some.', 'Here. Take some of mine.'],
  'thanks-food':   ['Thanks.', "Thank you. I'll pay you back."],
  'a-food-no':     ['No idea, sorry.', "Haven't seen any."],
  'a-food-hungry': ["I'm hungry too.", "If I knew, I'd be eating."],
  'q-rain':        ["Think it'll rain?", 'Looks like rain?'],
  'a-rain-yes':    ['Looks like it.', "I'd say so."],
  'a-rain-maybe':  ['Could do.', 'Hard to say.'],
  'rain-roof':     ["I'd better find a roof.", 'I need a roof, then.'],
  'q-doing':       ['What are you up to?', 'Where are you off to?', 'Busy?'],
  'me-too':        ['Me too.', 'Same here.'],
  'same':          ['Me too.', 'Same.'],
  'i-none':        ['Nothing much.', 'Not much.'],
  'i-chop':        ['Getting firewood.', 'Off to chop some wood.'],
  'i-stack':       ['Taking this wood to the fire.', 'Wood for the fire.'],
  'i-cut-thatch':  ['Cutting grass for the roof.', 'Getting thatch.'],
  'i-stake-hut':   ["I'm starting a hut.", 'Building a hut.'],
  'i-build-shel':  ['Putting up a shelter.', 'Making a lean-to.'],
  'i-build':       ['Making a fire.', "I'll get a fire going."],
  'i-tend':        ['Minding the fire.', 'Tending the fire.'],
  'i-fire':        ['Going to sit by the fire.', 'Back to the fire.'],
  'i-food':        ['Looking for food.', 'Finding something to eat.'],
  'i-food-kind':   ['Going to pick some {food}.', 'Off to get {food}.'],
  'i-plan-food':   ['Going for those {food} {src} mentioned.', 'After those {food} {src} told me about.'],
  'i-plan-food-own':['Going for those {food}.', 'Off to get those {food}.'],
  'i-gather-dish': ['Getting {food} for {dish}.', 'Picking {food}. I want to make {dish}.'],
  'proj-propose':  ['Shall we make {dish} tonight?', 'How about {dish} tonight?'],
  'proj-yes':      ["Yes, let's.", 'Good idea.'],
  'proj-no':       ['Not tonight.', "I'm too tired for that."],
  'proj-claim':    ["I'll get the {item}.", "I'll see to the {item}."],
  'proj-cook':     ["I'll cook it.", "I'll do the cooking."],
  'proj-tell':     ["We're making {dish} tonight.", "There's {dish} on tonight."],
  'proj-tell-prov':["We're gathering food for the camp.", "We're stocking up."],
  'proj-pass':     ['Good luck with it.', 'Save me some.'],
  'proj-done':     ['Got the {item}.', 'The {item} {are} in the basket.'],
  'proj-done-cook':["It's on the fire.", "The {dish}'s cooking."],
  'proj-done-prov':['I brought food back.', "The basket's fuller."],
  'proj-failed':   ["Couldn't get the {item}.", 'No {item} today.'],
  'proj-dropped':  ['Never mind the {dish}.', "The {dish}'s off."],
  'proj-ack-good': ['Good.', 'Well done.'],
  'proj-ack-bad':  ['Never mind.', 'Someone else can try.'],
  'prov-low':      ["We're all short.", "I've nothing either. None of us has."],
  'prov-low-ahead':["We're getting low on food.", "There's not much food left among us."],
  'prov-pass':     ["I'm worn out. Maybe later.", "Not now, I'm too tired."],
  'hut-ask-poles': ['Help me with the hut? It needs poles.', "Can you help with the hut? I'm short of poles."],
  'hut-ask-thatch':['Help me thatch the hut?', 'The hut needs a roof. Can you help?'],
  'proj-tell-hut': ["We're raising a hut.", "We're putting up a hut."],
  'q-canoe':       ['Know of a canoe anywhere?', 'Seen a canoe about?'],
  'a-canoe-no':    ["No. Haven't seen one.", 'No, sorry.'],
  'cn-ask':        ['Help me with the canoe?', "Can you give me a hand with the canoe? It's slow alone."],
  'cn-ask-bark':   ['Help me with the canoe? It needs bark.', "I'm making a canoe. Can you get me some birch bark?"],
  'cn-ask-poles':  ['Help me with the canoe? It needs poles.', "I'm making a canoe. I'm short of poles for the ribs."],
  'cn-yes':        ["All right. I'll help.", "Yes. I'll come and help."],
  'cn-no':         ['Not now.', "I can't, sorry."],
  'i-peel-bark':   ['Getting birch bark for a canoe.', 'Peeling bark. It\'s for a canoe.'],
  'i-canoe-work':  ['Working on the canoe.', 'Sewing the canoe. The seams take ages.'],
  'i-canoe-bring': ['Taking this to the canoe.', 'This is for the canoe.'],
  'hut-no':        ['Not now.', "I'm worn out. Later."],
  'proj-done-hut': ['Brought the {item}.', 'The {item} {are} by the hut.'],
  'proj-built':    ["The hut's up.", "The hut's finished."],
  'proj-dropped-hut':["The hut's come down.", 'We lost the hut.'],
  'prov-go':       ["We should gather. I'll go for apples.", "Let's go and gather, then."],
  's-crave':       ['I could do with some {dish}.', "I've a mind for {dish}.", "I keep thinking about {dish}."],
  'crave-too':     ['So could I.', 'Now you mention it, me too.'],
  'i-plan-cook':   ['Making {dish}.', 'Putting {dish} on.'],
  'i-help':        ['Helping with the pot.', 'Giving a hand with the cooking.'],
  'i-bring':       ['Taking this to the pot.', 'Bringing something for the pot.'],
  'i-getfood':     ['Getting something to eat.', 'Going to eat.'],
  'i-sup':         ['Getting some stew.', 'Going for stew.'],
  'i-cook':        ['Going to cook.', 'Putting this in the pot.'],
  'i-store':       ['Taking this food to camp.', "This is for the camp's store."],
  'i-hunt':        ['Hunting.', "I'm after a rabbit."],
  'i-sleep':       ['Going to bed.', 'Turning in.'],
  'i-indoors':     ['Going to bed.', 'Turning in.'],
  'i-shelter':     ['Getting out of the rain.', 'Getting dry.'],
  'i-tree-shelter':['Getting out of the rain.', 'Getting dry.'],
  'i-collect':     ['I saw something shiny.', 'Looking for pretty stones.'],
  'i-revere':      ['Going to the great tree.', 'Off to the old tree.'],
  'i-gather-flower':['Picking flowers.', 'Getting some flowers.'],
  's-rain':        ["I'm soaked.", 'Rain again.'],
  's-pot':         ['I could eat.', "I'm starving."],
  's-fire':        ["I'm freezing.", 'My hands are cold.'],
  's-sleepy':      ["I'm half asleep.", "I'm worn out."],
  's-sun':         ['Nice day.', 'Good weather.'],
  's-omen':        ['Getting dark.', 'Quiet night.'],
  'hello':         ['Hello, traveller.', 'Oh, hello.', 'Hello there.'],
  'lore-agree':    ['So they say.', 'True enough.', "That's so."],
  'q-pot-ready':   ['Is it ready?', 'Can I have some?'],
  'pot-offer':     ["{Dish}'s ready. Have some.", "There's {dish} if you want it."],
  'q-pot-need':    ['Do we need anything for it?', 'Need anything?'],
  'have-it':       ["I've got some {food}.", "I've got {food} here."],
  'fetch-it':      ["I know where there's {food}. I'll go.", "I'll fetch some {food}."],
  'no-have':       ["I haven't got any.", "Can't help there."],
  'q-help':        ['Can I help?', 'Want a hand?'],
  'help-ok':       ['All right.', 'Sure.'],
  'ask-cook':      ["Ask {who}, it's their pot.", "Don't ask me. {who}'s cooking."],
  'q-how':         ['How do you make {dish} again?', "How's {dish} made?"],
  'q-teach':       ['Would you show me how to make {dish}?', "I heard you make {dish}. How's it done?"],
  'q-stuck':       ["What's next for the {dish}?", 'What comes next?'],
  'q-stuck-start': ['How do I start the {dish}?', 'How does {dish} begin?'],
  'meh-cook':      ['That {dish} was a bit off.', 'The {dish} was a bit thin.'],
  'meh-reply':     ['I lost track of it.', "I'm still learning that one."],
  'meh-other':     ["{who}'s {dish} was a bit off.", "{who}'s {dish} wasn't the best."],
  'pot-mine':      ["I've got {dish} on.", "{Dish}'s on."],
  'a-pot-help':    ['Help yourself.', 'Go on, have some.'],
  'q-pot-what':    ["What's cooking?", 'What are you making?'],
  'q-pot-long':    ['How much longer?', "How long till it's ready?"],
  'praise-cook':   ['That {dish} was good.', 'Good {dish}, that.'],
  'praise-other':  ["{who}'s {dish} was good.", "{who} makes a good {dish}."],
  'praise-thanks': ['Glad you liked it.', 'Thanks.'],
  'praise-agree':  ['It was.', 'It was good.'],
  'praise-try':    ["I'll have to try it.", 'I missed it.'],
  'story-react':   ['Huh.', 'Is that so.', 'Good to hear.'],
  'q-tomorrow':    ['Where shall we forage tomorrow?', 'Where to, tomorrow?'],
  'a-tomorrow-none':["Let's see in the morning.", "Wherever there's food."],
  'ok-tomorrow':   ['All right.', 'Tomorrow, then.'],
  'q-sing':        ['Give us a song.', 'Sing something.'],
  'lore-new':      ['Never heard that one.', "Huh. I'll remember that."],
  'lore-ask':      ['How does the rest go?', 'Go on. How does it end?', "I don't know that one. How does it go?"],
  'lore-learnt':   ["I'll remember that.", "That's a good one."],
  'lore-forgot':   ['…how does the rest go?', "I've forgotten how it ends."],
  'lore-thanks':   ['That was it.', 'Yes, that.'],
  'lore-dunno':    ["Don't know it.", 'Never heard it.'],
};

// the words for one move. Fact tells, where, and guesses are worked out; the rest
// fill a line from SAY with names as this speaker would say them to this hearer.
function moveLine(m){
  const sp = m.who, to = m.to || PLAYER, now = agents.time;
  if (m.fact && m.key.startsWith('tell-')) return tellLine(sp, m.fact, to, now);
  if (m.key === 'where') return withWay(whereCoarse(sp, m.x, m.z), sp, m.x, m.z);
  if (m.key === 'guess'){
    const g = guessOf(m);
    return g.place ? (g.wrong ? `All the way at ${g.place.name}?` : `${cap(placePhrase(g.place))}?`) : 'Far?';
  }
  if (m.key === 'guess-reply'){
    const g = guessOf(m.re);
    if (!g.place) return g.far ? withWay('A fair walk.', sp, m.x, m.z) : 'Not really.';
    if (!g.wrong) return withWay(voicePick(sp, 'g-yes', ["That's it.", "That's the one."]), sp, m.x, m.z);
    const actual = placeAt(m.x, m.z);
    return 'Not that far.' + (actual !== placeAt(sp.x, sp.z) ? ` ${cap(placePhrase(actual))}.` : '');
  }
  if (m.key === 'omen-mean') return cap(m.tenor || 'who knows') + '.';
  if (m.key.startsWith('tr-') || m.key.startsWith('mk-')) return tradeLine(m, sp);
  if (m.key === 'saying') return SAYINGS.get(m.saying)?.parts[m.part] || '';
  if (m.key === 'a-pot-what'){
    const dish = cap(dishName(m.dish || 'food'));
    return !m.cook || m.cook === sp ? `${dish}.` : `${dish}. ${callName(sp, m.cook, to)}'s making it.`;
  }
  if (m.key === 'a-pot-long') return m.left <= 0 ? "It's ready." : m.left < 8 ? 'Nearly there.' : m.left < 20 ? 'Not long now.' : 'A while yet.';
  // a recipe step, said as an instruction ("Crack the acorns."), or the whole dish
  if (m.key === 'a-pot-need' || m.key === 'a-help' || m.key === 'a-stuck') return cap(m.say) + '.';
  if (m.key === 'a-how') return cap(RECIPES[m.recipe].steps.map(st => st.say).join(', ')) + '.';
  if (m.key.startsWith('story-') && m.fact) return storyLine(sp, m.fact, to, now);   // the story itself, not the reply to it
  if (m.key === 'a-tomorrow'){
    const f = m.fact, src = f.from ? callName(sp, f.from, to) : null;
    return `${cap(whereSaid(sp, f.x, f.z))}. ${src ? `${src} saw ${f.foodKind} there.` : `I saw ${f.foodKind} there.`}`;
  }
  let key = m.key;
  if (key === 'i-food' && m.food) key = 'i-food-kind';
  if (key === 'i-plan-food' && !m.src) key = 'i-plan-food-own';
  const arr = SAY[key];
  if (!arr) return '';
  return cap(voicePick(sp, key, arr)
    .replace('{food}', m.food || 'food')
    .replace('{item}', m.item || 'food')
    .replace('{are}', /s$/.test(m.item || '') ? 'are' : 'is')
    .replace('{dish}', m.dish ? dishName(m.dish) : 'stew')
    .replace('{Dish}', cap(m.dish ? dishName(m.dish) : 'stew'))
    .replace('{src}', m.src ? callName(sp, m.src, to) : '')
    .replace('{me}', sp.given || sp.name || '')
    .replace(/\{who\}/g, m.subj ? callName(sp, m.subj, to) : 'them'));
}

// Unprompted: walk up to someone and now and then they'll say something to you —
// a piece of news they haven't told you yet, or what they're up to. Never two folk
// at once, and nobody repeats themselves to you. To you, news comes whole, place
// and all (factLine): you can't ask "where?".
const REMARK_R = 4.5, REMARK_P = 0.3, REMARK_CD = 120, REMARK_GAP = 20;
let _remarkT = 0;
function maybeRemark(dt){
  if ((_remarkT -= dt) > 0) return;
  _remarkT = 1;                                       // look once a second
  if (document.getElementById('dlg-overlay')) return;
  const nowS = performance.now() / 1000;
  let n = null, nd = REMARK_R;
  for (const o of npcApi.npcs){
    const d = Math.hypot(o.x - pos.x, o.z - pos.z);
    if (d < nd && !o.sleeping && !o.convo && (o._remarkAt || -1e9) < nowS - REMARK_CD){ nd = d; n = o; }
  }
  if (!n || Math.random() > REMARK_P) return;
  const told = n._toldYou || (n._toldYou = new Set());
  const rank = f => (f.kind === 'omen' ? 3 : f.kind === 'kind' ? 2 : f.kind === 'food' || f.kind === 'boat' ? 1 : 0);
  const fact = n.news && [...n.news.values()]
    .filter(f => !told.has(f.key + f.t) && !(f.kind === 'saw' && f.subj && Math.hypot(f.subj.x - pos.x, f.subj.z - pos.z) < 20))
    .sort((a, b) => rank(b) - rank(a) || b.t - a.t)[0];
  let move;
  if (fact){
    told.add(fact.key + fact.t);
    if (fact.subj && !fact.subj.known && !fact.subj.heardFrom) fact.subj.heardFrom = n;   // as with "Heard any news?"
    move = { who: n, to: PLAYER, key: 'tell-' + fact.kind, icon: factIcon(fact), fact, subj: fact.subj, line: factLine(n, fact, agents.time, PLAYER) };
  } else {
    move = idleMove(agents, n, PLAYER) || (!n.known ? { who: n, to: PLAYER, key: 'hello', icon: 'hello' } : null);
    if (!move) return;                            // nothing new to say to you
    if (move.mark){ if (!n._said) n._said = new Map(); n._said.set(move.mark, agents.time); }
    move.line = moveLine(move);
  }
  n._remarkAt = nowS;
  _remarkT = REMARK_GAP;
  talkView.say(n, move);
}

// Each NPC has a stable "voice": deterministic picks (seeded by npc.id) from sets
// of paraphrases, so the same person always phrases a thing their way, yet no two
// folk sound alike. voiceHash → a stable number per (npc, key); voicePick chooses a
// variant; voiceHas gives a per-NPC yes/no (varies which options a person offers).
function voiceHash(npc, key){
  let h = (((npc && npc.id) || 0) + 1) * 2654435761 >>> 0;
  for (let i = 0; i < key.length; i++) h = ((h ^ key.charCodeAt(i)) * 16777619) >>> 0;
  return h >>> 0;
}
const voicePick = (npc, key, arr) => arr[voiceHash(npc, key) % arr.length];
const voiceHas  = (npc, key, p) => (voiceHash(npc, key) % 1000) / 1000 < p;

// the settlement a house stands in, by name ("Thornwick")
function villageOf(h){
  const S = settlements().places, k = h ? S.findIndex(p => p.buildings.includes(h.b)) : -1;
  return k >= 0 ? settlementNames()[k].name : 'the village';
}
// A peasant's dialogue is assembled live from its drives + surroundings, phrased in
// the NPC's own voice (see above). It's a window on the NPC's state: what it's
// doing, how it feels (its strongest unmet drive), and the sky.
function peasantTree(npc, sky){
  const n = npc.needs || {};
  const v = (key, arr) => voicePick(npc, key, arr);     // pick this NPC's phrasing
  const fem = npc.gender === 'female';
  const Pron = fem ? 'She' : 'He', pron = fem ? 'she' : 'he', their = fem ? 'her' : 'his';
  // the market (agents.js callAt, docs/trade.md): where they're bound, or the swap just made
  const mh = npc.brain?.target?.kind === 'market' ? npc.brain.target.house : null;
  const mkt = mh ? { at: villageOf(mh), crop: Object.entries(mh.spare).sort((a, b) => b[1] - a[1])[0]?.[0] || 'greens' } : null;
  const lt = npc._lastTrade, now = sky?.time ?? 0;
  const ct = npc._caught;   // a catch at the water (agents.js fishAt)
  const caught = ct && now - ct.t < 0.12 ? (ct.boat ? v('d-caught-b', [`Caught ${qty(ct.n, ct.kind)} out on the water. It's for the pot.`, `I had ${qty(ct.n, ct.kind)} from the canoe earlier.`])
    : v('d-caught', [`Caught ${qty(ct.n, ct.kind)} at the water. It's for the pot.`, `I had ${qty(ct.n, ct.kind)} on the line earlier.`])) : null;
  const traded = !lt || now - lt.t > 0.12 ? null
    : lt.folk === npc ? v('d-traded', [`Just back from ${villageOf(lt.house)}. ${cap(qty(lt.gn, lt.gave))} got me ${qty(lt.qn, lt.got)}.`, `I've been trading at ${villageOf(lt.house)}. ${cap(qty(lt.qn, lt.got))}, for ${qty(lt.gn, lt.gave)}.`])
    : v('d-traded-v', [`${lt.folk.player ? 'You' : lt.folk.name || 'One of the folk'} came to the door. ${cap(qty(lt.gn, lt.gave))} for ${qty(lt.qn, lt.got)}.`, `Had a trade at the door. ${cap(qty(lt.qn, lt.got))} went for ${qty(lt.gn, lt.gave)}.`]);
  const doing = npc.actionLabel === 'canoe-work' ? v('d-canoe', ["Making a canoe. The bark's on. Now it's the ribs and the seams.", "Sewing the canoe. It goes quicker with two.", "Working on the canoe. It takes days."])
    : npc.actionLabel === 'peel-bark'  ? v('d-bark', ["Peeling birch bark. It's for a canoe.", "Getting bark off this birch, for the canoe.", "Bark for a canoe. It comes away in a sheet if you're careful."])
    : npc.actionLabel === 'canoe-bring'? v('d-cbring', ["Taking this to the canoe.", "This is for the canoe down by the water."])
    : npc.chopping              ? v('d-chop', ["Cutting firewood — the woodpile's run low.", "Felling a shrub for the fire. Hungry work.", "Wood for the hearth. It never stops needing it."])
    : npc.sitting && npc.atGathering ? v('d-gather', ["Sitting at the night fire with the others — there's a song going, and old talk.", "By the fire with my people — songs and stories till the dark wears thin.", "Round the night fire. This is the best of the day, if you ask me."])
    : npc.sitting                  ? v('d-sit', ["Sitting by the fire, warming my hands.", "Resting by the hearth a while.", "Just warming myself — the cold gets in the bones."])
    : npc.actionLabel === 'chop'   ? v('d-gochop', ["Off to cut some wood for the fire.", "Going to fell a shrub — the fire's hungry.", "After firewood."])
    : npc.actionLabel === 'stack'  ? v('d-stack', ["Stacking firewood by the hearth for us all.", "Building up the woodpile — it's everyone's.", "Laying in wood by the fire."])
    : npc.actionLabel === 'build'  ? v('d-build', ["Laying a fire here — no camp's near enough for nightfall.", "Making my own hearth. Naught else within reach.", "Setting a fire before the dark catches me out."])
    : npc.actionLabel === 'fire'   ? ((sky?.evening ?? 0) > 0.3 ? v('d-fire-e', ["Heading back to camp before the dark sets in.", "Making for home — night's coming.", "Back to the fire before dusk's done."]) : v('d-fire-d', ["Making for the fire — I want to be warm.", "Off to the hearth. I'm chilled.", "Toward the fire — the cold's got me."]))
    : npc.actionLabel === 'food'   ? v('d-food', ["Gathering food to carry back.", "Foraging — filling my pack.", "Out after berries and roots."])
    : npc.actionLabel === 'getfood'? v('d-getfood', ["Fetching a bite from the camp stores.", "To the basket for a meal.", "Drawing some food from the common store."])
    : npc.actionLabel === 'tend'   ? ((sky?.night ?? 0) > 0.3 ? v('d-tend-n', ["Keeping the fire — someone must watch it.", "Watching the flames through the dark. It's my turn.", "Minding the night fire. It mustn't go out."]) : v('d-tend-d', ["Minding the fire and the pot — they shouldn't be left alone.", "Keeping an eye on the hearth. Idle work, but needed.", "Tending the fire. Someone has to."]))
    : npc.actionLabel === 'sup'    ? v('d-sup', ["Supping at the pot — there's stew, and it's good.", "Having a bowl of stew. You're welcome to ask the cook.", "Eating from the pot. Warms you right through."])
    : npc.actionLabel === 'cook'   ? v('d-cook', ["Off to the pot — these want cooking before they're fit to eat.", "Taking these to the fire. Raw, they'd do me no good.", "Bound for the pot with what I've gathered."])
    : npc.actionLabel === 'store'  ? v('d-store', ["Stowing food in the camp basket.", "Putting by the surplus for the others.", "Adding to the common store — no sense letting it spoil on me."])
    : npc.actionLabel === 'trade'  ? v('d-trade', ["Off to barter — a fair swap beats a long forage.", "Going to trade. Easier than gathering it all myself.", "After a swap with a neighbour."])
    : npc.actionLabel === 'fish' && npc.fishing ? (npc.fishing.kind === 'eels'
        ? v('d-eels', ["After eels. They lie up in mud like this.", "Waiting on an eel. They're slow to bite.", "Eels, if I'm lucky. It's the right sort of mud."])
        : v('d-fish', ["Fishing. Waiting on a bite.", "Watching the float. They come up better towards evening.", "Fishing. It's deep just off here."]))
    : npc.actionLabel === 'boat-fish' ? (npc.fishing ? v('d-boatfish', ["Fishing from the canoe. It's deep out here.", "Out over the deep water. Pike lie down there.", "Waiting on a bite. Better out here than off the bank."])
        : v('d-goboat', ["Taking a canoe out to fish.", "Off out on the water after fish.", "Going out in the canoe. The deep water's less fished."]))
    : npc.actionLabel === 'fish'   ? v('d-gofish', ["Off to the water to fish.", "Going to try my luck at the water.", "Down to the bank with a line."])
    : caught                       ? caught
    : npc.actionLabel === 'market' && mkt ? v('d-market', [`Off to ${mkt.at} to trade. I've not had anything from a garden in days.`, `Taking this lot to ${mkt.at}. They grow ${mkt.crop} there.`, `Going to ${mkt.at} for ${mkt.crop}, if they'll swap.`])
    : traded                       ? traded
    : npc.actionLabel === 'ask'    ? v('d-ask', ["Going to ask a neighbour for a bite — they'll not see me go hungry.", "Off to beg a meal from kin. That's what they're for.", "Asking round for food. No shame in it."])
    : npc.actionLabel === 'hunt'   ? v('d-hunt', ["After a rabbit — quick beast, but it's meat for the pot if I catch it.", "Hunting. There's a rabbit, if my legs are quick enough.", "Chasing a coney. Meat enough for many, if I land it."])
    : npc.actionLabel === 'collect'? v('d-collect', ["Something caught my eye — a pretty thing to keep.", "Stooping for a bauble I spied.", "A shiny bit on the ground — I couldn't pass it."])
    : npc.actionLabel === 'gather-flower'? v('d-gflower', ["Picking flowers — I've a mind to make myself a crown.", "After wildflowers. I want them fresh.", `${npc.flowerInventory?.length || 0} of ${7} so far — nearly there.`])
    : npc.actionLabel === 'greet'  ? v('d-greet', ["Just passing the time with the others.", "Chatting with folk. Nothing pressing.", "Idling with company."])
    :                                v('d-wander', ["Wandering. Looking for somewhere to be.", "Just roaming — no errand to speak of.", "Drifting where my feet take me."]);
  const top = [['food',    n.food    ?? 0, v('f-food', ["Hungry. My belly's been grumbling.", "Famished, if I'm honest.", "Could eat a horse — or a rabbit, at least.", "Peckish enough to gnaw bark.", "My stomach thinks my throat's cut."])],
               ['company', n.company ?? 0, v('f-comp', ["Lonely. It's quiet out here.", "I could do with a friendly face.", "A bit solitary of late.", "Starved for a good talk, truth be told.", "It gets lonesome, out under the sky."])],
               ['warmth',  n.warmth  ?? 0, v('f-warm', ["Cold. I'd like to be near a fire.", "Chilled through — I need a hearth.", "Frozen. Where's a good fire?", "Cold's in my bones today.", "I'd give much for a warm hearth."])],
               ['rest',    n.rest    ?? 0, v('f-rest', ["Weary. I could do with a rest.", "Tired to the bone.", "Worn out, truth be told.", "Dead on my feet, near enough.", "I could sleep a week."])]]
              .reduce((a, b) => b[1] > a[1] ? b : a);
  const feel = top[1] > 0.55 ? top[2] : v('f-ok', ["Well enough, I suppose.", "Can't complain.", "Middling — the usual.", "Right as rain.", "Fair to middling.", "Same as ever — which is fine by me.", "No worse than yesterday."]);
  const night = sky?.night ?? 0, day = sky?.day ?? 1;
  const skyLine = night > 0.7 ? v('s-night', ["Dark now. The stars are out — the whole sky of them.", "Black as pitch — but look at those stars.", "Deep night. The stars keep me company.", "Night's full come. A good sky for wishing on.", "Dark as a cellar, and the stars like spilled salt."])
    : night > 0.3 ? v('s-dusk', ["The light's going thin. Dusk, or near it.", "Getting on for dark.", "The day's bleeding out — dusk soon.", "Gloaming now. The fires'll want lighting.", "Half-light. The day's near spent."])
    : day   > 0.6 ? v('s-day', ["The sun's well up. A fair day for it.", "Fine and bright — a good day.", "Sun's out. Can't ask for better.", "Broad day, and warm. Lovely.", "Clear and bright — the kind of day you forgive winter for."])
    :               v('s-dawn', ["Grey light. The day's not yet awake.", "Early yet — the day's still rubbing its eyes.", "Pale morning. Cold light.", "First light, barely. Dew's still down.", "The sun's not properly up. Bleary, like me."]);
  // what the peasant is carrying: foraged rations (packKind) + firewood logs + valuables
  const food = npc.pack | 0, wood = npc.firewood | 0, trink = npc.trinkets | 0, rawn = npc.raw | 0;
  const trinkName = npc.trinketKind || 'trinket';
  const carry = [];
  // each kind carried (larder.js), with a word on what won't keep
  const byKind = {};
  for (const b of (npc.larder || (food ? [{ kind: npc.packKind || 'food', n: food }] : []))) byKind[b.kind] = (byKind[b.kind] || 0) + b.n;
  for (const [k, m] of Object.entries(byKind))
    carry.push(`${m} ${k === 'food' ? 'rations' : k}${k === 'berries' ? ' (to eat soon, before they turn)' : ''}`);
  if (rawn > 0) carry.push(rawKinds(npc).map(k => `${rawOf(npc, k)} ${k}`).join(', ') + ', for the pot');
  if (wood > 0) carry.push(`${wood} log${wood === 1 ? '' : 's'} of firewood`);
  if (trink > 0) carry.push(`${trink} bit${trink === 1 ? '' : 's'} of ${trinkName} I'm rather fond of`);
  const packLine = carry.length
    ? v('p-lead', ["Let's see here... ", "Let me see... ", "In here? ", "Carrying "]) + carry.join(', and ') + "."
    : v('p-empty', ["Naught but lint and crumbs — it's empty.", "Empty as a beggar's bowl.", "Nothing on me just now.", "Not a thing — travelling light."]);
  // personality + skill, read off the NPC's persona (agents.js)
  const ps = npc.persona || {};
  const g = (k) => ps[k] ?? 1;
  const dom = [['food',    g('food'),                    v('dom-food', ["Truth be told, I think most about my next meal.", "My belly rules me, I'll confess.", "I live from one meal to the next, and gladly."])],
               ['company', g('company'),                 v('dom-comp', ["I do love good company — folk are the best of the Lea.", "Give me people and I want for nothing.", "A life among friends is the only life I'd have."])],
               ['beauty',  g('beauty'),                  v('dom-beau', ["I can't pass a pretty shell or stone without stooping for it.", "I've an eye for fine things — shells, amber, bright stones.", "Pretty baubles are my weakness, I'll own."])],
               ['comfort', (g('warmth') + g('rest')) / 2, v('dom-comf', ["A warm hearth and an easy rest — that's my whole ambition.", "Give me a fire and a soft spot and I ask no more.", "Comfort's all I crave: warmth, and a chance to put my feet up."])]]
              .reduce((a, b) => b[1] > a[1] ? b : a)[2];
  const social = g('company') < 0.8 ? v('self-solo', ["I keep to myself, mostly — crowds wear on me.", "I'm a quiet sort; crowds tire me.", "I like my own company best, truth be told."])
    : g('company') > 1.25 ? v('self-crowd', ["I'm never so happy as among others.", "Give me a crowd and I'm content.", "I can hardly abide being alone."])
    : v('self-mid', ["I take folk as they come.", "I'm easy enough, company or none.", "Folk are folk — I get on with most."]);
  const sk = [];
  if (g('strength') > 1.15) sk.push(v('sk-str+', ["strong in the arm — wood falls quick under my axe, and I carry a good load", "stout enough — I shoulder a heavy load and never feel it", "broad-backed; the hard hauling falls to me"]));
  else if (g('strength') < 0.85) sk.push(v('sk-str-', ["not the strongest — a heavy pack soon tires me", "no great muscle on me, I'll admit", "slight of build; I leave the heavy work to others"]));
  if (g('perception') > 1.15) sk.push(v('sk-per+', ["sharp-eyed — I spy the little treasures others tread right past", "keen of sight; nothing small escapes me", "I've a hunter's eye — I miss little"]));
  else if (g('perception') < 0.85) sk.push(v('sk-per-', ["a touch blind to small things on the ground", "I'll walk clean past a shell and never see it", "my eyes aren't what they were for small things"]));
  const give = g('generosity') > 1.2 ? v('give+', [" I share what I have — none of mine go hungry while I've a full pack.", " What's mine is the band's; I don't hoard.", " I give freely — it comes back round, always."])
    : g('generosity') < 0.8 ? v('give-', [" I keep what's mine, I'll own it — times are lean enough.", " I look to myself first; no shame in it.", " I don't give easy — a body must mind its own."]) : "";
  const stand = (npc.esteem || 0) > 4 ? v('stand', [" Folk speak well of me, I'm told.", " I'm well thought of round here, if I say so.", " I've a fair name among my people."]) : "";
  const star = npc.stargazer ? v('star-self', [" And I read the stars a little, when they're out.", " I've a touch of the star-lore, for what it's worth.", " I watch the night sky, too — it speaks, if you listen."]) : "";
  const selfLine = `${dom} ${social}${give}${stand}${star} ` +
    (sk.length ? v('self-skill', ["As for my hands and eyes — ", "What can I do? Well — ", "My hands and eyes — "]) + sk.join("; ") + "."
      : v('self-plain', ["Naught remarkable in my hands or eyes.", "Nothing special about me, mind.", "I'm no one remarkable."]));
  // who they belong to (society.js groups): an intro line + a roster of the whole
  // immediate group — each member's portrait, name, relation, and (on click) a
  // detail node about them plus a map marker where they were last seen.
  const grp = npc.group;
  let kinLine, kinRoster = null; const kinNodes = {};
  if (!grp || grp.kind === 'lone'){
    kinLine = v('kin-lone', ["I keep my own road — no kin nor company but my own shadow.", "No people to speak of — I walk alone.", "Just me. I've no kin hereabouts."]);
  } else {
    kinLine = grp.kind === 'band' ? v('kin-band', [`${grp.name} — those I ride with (ask after any of them):`, `I travel with ${grp.name}. Ask after any of them:`, `${grp.name}, my road-companions — ask of whom you like:`])
      :                             v('kin-fam', [`${grp.name} — my kin (ask after any of them):`, `My people are ${grp.name}. Ask of any:`, `${grp.name} — my own blood. Ask after them:`]);
    const now = sky?.time ?? 0;
    kinRoster = (grp.npcs || []).map((o, i) => {
      const item = { name: o.name, portrait: o.portrait, portraitBg: markBackdrop(o.group?.id), relation: relationTo(npc, o) };
      if (o !== npc){
        const id = 'kin' + i;
        const s = sightingOf(npc, o, now);                 // when/where last seen (+ maybe a marker)
        item.next = id;
        item.onSelect = () => { mapMark = s.mark; };        // null unless seen elsewhere, long ago
        kinNodes[id] = { text: describeKin(npc, o) + ' ' + s.line };
      }
      return item;
    });
  }
  // they give their name freely when asked (for now); a friendly self-introduction
  const given = npc.given || npc.name;
  let nameLine = v('name', [
    `"${given}," ${pron} says. "${npc.name}, if you want the whole of it. And you are?"`,
    `${Pron} dips ${their} head. "${npc.name}. Folk call me ${given}. And yourself?"`,
    `"Me? ${npc.name}." ${Pron} grins. "${given}, to friends. Who're you, then?"`,
    `"${npc.name}," ${pron} says simply. "And what do they call you?"`,
  ]);
  // if you'd heard the name before (from a groupmate's introduction), you recognise it
  if (npc.heardFrom && !npc.known)
    nameLine += '\n\n' + v('recog', [
      `The name strikes a chord. "I've heard of you," you say, "from ${displayName(npc.heardFrom)}."`,
      `You know the name. "${displayName(npc.heardFrom)} spoke of you," you tell ${fem ? 'her' : 'him'}.`,
      `"I've heard that name — ${displayName(npc.heardFrom)} mentioned you," you say, and ${pron} looks pleased.`,
    ]);
  // a stargazer's reading of the night sky, grounded in the real moon phase & house
  // (astrology.js). Computed once when the talk opens, so it's stable for the chat.
  const starsLine = !npc.stargazer ? null
    : (sky?.night ?? 0) < 0.35 ? v('stars-day', ["The stars keep their counsel by day — come back after dark.", "Naught to read while the sun's up. Ask me by night.", "The sky's too bright now; after dusk, friend."])
    : v('stars-intro', ["Let me look... ", "Aye, I read a little. ", "The sky tonight? "])
      + makeOmen({ moonLon: sky?.moonLon || 0, sunLon: sky?.sunLon || 0, illum: sky?.moonIllum || 0 });
  // "Is there a doctor around?" (once Puck's sent you to ask): a stargazer says they are
  // one, near enough; someone with a stargazer among their kin sends you to them, with
  // where they last saw them (and a mark on the map); the rest are rude (hand-written lines)
  let doctorLine, doctorMark = null;
  const sg = (grp && grp.kind !== 'lone' ? grp.npcs || [] : []).filter(o => o !== npc && o.stargazer)
    .sort((a, b) => (npc.seen?.get(b)?.t ?? -1) - (npc.seen?.get(a)?.t ?? -1))[0];
  // a stargazer goes on: her grandmother's portal at the nearest thin place, and the salves of old
  const near = npc.stargazer ? thinNear(npc.x, npc.z).find(q => q.kind !== 'door into Faerie') : null;
  const nearWhere = !near ? 'the old stones' : near.kind === 'stone circle' ? near.dest.name : near.dest.what;
  const stargazerNodes = !npc.stargazer ? {} : {
    'doc-faerie': { text: `And you think that mine can? My mother told me that her grandmother once saw a portal at ${nearWhere}, but very dimly.`,
      choices: [{ label: "What's a thin place?", next: 'doc-thin' }, { label: 'Did she tell you anything else?', next: 'doc-else' }] },
    'doc-thin': { text: v('doc-thin', ['Where the other side comes close: the fairy rings, the stone circles, the old sacred trees. The sky leans down to the ground there.',
      "A place where this world wears thin, and the other shows through. Fairy rings, stone circles, the sacred trees."]),
      choices: [{ label: 'Did she tell you anything else?', next: 'doc-else' }] },
    'doc-else': { text: 'She said that in the old days, folks would anoint their eyes with salves to see what they have no business seeing.',
      choices: [{ label: 'Did she tell you how to make it?', next: 'doc-make' }] },
    'doc-make': { text: "No one knows how to make things like that anymore! If you find the recipe, find me again I'll make it for you." },
  };
  if (npc.stargazer) doctorLine = v('doc-self', ["I read the stars. That's as near a doctor as you'll get for that sort of seeing.", "You've found one, near enough. I'm a stargazer."]);
  else if (sg){
    const s = sightingOf(npc, sg, sky?.time ?? 0), them = sg.gender === 'female' ? 'her' : 'him';
    doctorLine = `${v('doc-kin', [`No doctor, but my ${relationTo(npc, sg)} ${sg.name} reads the stars. Ask ${them}.`, `Try ${sg.name}, my ${relationTo(npc, sg)}. Reads the stars, ${sg.gender === 'female' ? 'she' : 'he'} does.`])} ${s.line}`;
    doctorMark = s.mark;
    if (!sg.known && !sg.heardFrom) sg.heardFrom = npc;
  } else doctorLine = npc.role === 'elder' ? 'My eyes are showing me someone who needs to learn to respect his elder.'
    : v('doc-rude', ["They're going to see my fist flying at them if your mouth doesn't stop talking.", 'Go look somewhere else, then.', 'Are you calling me ugly?']);

  // and the thin places, which is how you come to know of them (Puck's "Take me to a thin place.")
  const thinLine = !npc.stargazer ? '' : v('stars-thin', [" Mind the thin places, too: the fairy rings, the stone circles, the sacred trees. The sky leans close to the ground there.",
    " And where it's thin, the fairy rings and stone circles and the old sacred trees, the other side is near. Folk who know keep off them after dark."]);

  // Trading with you at their door (docs/trade.md): the household's spare crops
  // for what's in your basket. They value what you bring as they would from one
  // of the folk (trade.js worth), open at about half what they'd go to, and come
  // up once if you ask.
  const house = npc.home;
  const spare = () => house ? Object.entries(house.spare).filter(([, k]) => k > 0) : [];
  const asKind = k => VALUABLES.has(k) ? 'trinket' : k;
  const held = g => g === 'trinket' ? (npc.trinkets || 0) : countOf(npc, g) + rawOf(npc, g);
  const tradeable = () => Object.keys(basket).filter(k => basket[k] > 0 && (isWild(k) || VALUABLES.has(k)));
  let deal = null, dealt = '';
  const offerOf = k => {
    const gn = Math.min(basket[k] || 0, 3), g = asKind(k), now = agents.time;
    const gb = worth(npc, g, held(g), now);
    let best = null;
    for (const [c, have] of spare()){
      const cb = worth(npc, c, have + countOf(npc, c), now);
      let max = 0; while (max < have && gn * gb - (max + 1) * cb > 0) max++;
      if (max > 0 && (!best || max > best.max)) best = { give: k, gn, get: c, max };
    }
    if (best){ best.qn = Math.ceil(best.max / 2); best.asked = false; }
    return best;
  };
  const doTrade = d => {
    const now = agents.time, g = asKind(d.give);
    if ((basket[d.give] || 0) < d.gn || (house.spare[d.get] || 0) < d.qn){ dealt = `"${v('t-gone', ["You've not got them now.", 'Seems that went somewhere.'])}"`; return; }
    if (myPack.room(d.get, d.qn) < d.qn){ dealt = `"${v('t-full', ["You've no room for them.", "Where would you put them?"])}"`; return; }
    myPack.take(d.give, d.gn);
    house.spare[d.get] -= d.qn;
    myPack.add(d.get, d.qn, provHere('traded', displayName(npc)));
    jot('traded', `${d.give} for ${d.get} with ${displayName(npc)}`);
    if (g === 'trinket'){ npc.trinkets = (npc.trinkets || 0) + d.gn; if (!npc.trinketKind) npc.trinketKind = d.give; }
    else if (RAW_KINDS.has(g)) addRaw(npc, g, d.gn);
    else addFood(npc, g, d.gn, now);
    const rec = { t: now, folk: PLAYER, villager: npc, house, gave: d.give, gn: d.gn, got: d.get, qn: d.qn };
    house.ledger.push(rec); if (house.ledger.length > 12) house.ledger.shift();
    agents.market.trades.push(rec); npc._lastTrade = rec;
    dealt = `"${v('t-done', ['Done.', 'Done. Here you are.', 'Fair enough. Done.'])}" ${Pron} counts ${qty(d.qn, d.get)} into your basket.`;
    deal = null;
    if (invOpen) openInventory();
  };
  const tradeNodes = !house ? {} : {
    get trade(){
      const sp = spare();
      if (!sp.length) return { text: `"${v('t-none', ['Nothing put by just now. Come back after we reap.', "We've nothing spare, I'm sorry."])}"` };
      const list = sp.map(([c, k]) => `${num(k)} ${c}`).join(' and ');
      const mine = tradeable();
      if (!mine.length) return { text: `"We've ${list} put by. But you've nothing we'd want, by the look of it."` };
      return { text: `"We've ${list} put by. What have you got?"`,
        choices: mine.map(k => ({ label: cap(qty(Math.min(basket[k], 3), k)) + '.', next: 'offer', run: () => { deal = offerOf(k); } })) };
    },
    get offer(){
      const d = deal;
      if (!d) return { text: `"${v('t-nouse', ["No, I've no use for that.", "That's no good to us, sorry."])}"`, choices: [{ label: 'Something else, then.', next: 'trade' }] };
      const say = !d.asked ? `"For ${qty(d.gn, d.give)}? I'll give you ${qty(d.qn, d.get)}."`
        : d.bumped ? `"${cap(num(d.qn))}, then. That's as far as I go."` : `"No. ${cap(qty(d.qn, d.get))} is fair."`;
      const c = [{ label: 'Done.', next: 'traded', run: () => doTrade(d) }];
      if (!d.asked) c.push({ label: v('t-push', ['Can you do better?', "That's a bit thin.", 'Make it a few more?']), next: 'offer',
        run: () => { d.asked = true; const up = Math.ceil((d.qn + d.max) / 2); d.bumped = up > d.qn; d.qn = up; } });
      c.push({ label: 'No, thanks.', next: 'trade', run: () => { deal = null; } });
      return { text: say, choices: c };
    },
    get traded(){ return { text: dealt }; },
  };

  // Book recipes (docs/magic.md "Teaching"): what they've put by for you from a pot of
  // one; teaching them one you've read; giving them what a dish they know wants (the
  // Lea runs on open-handed sharing, so you give, you don't sell)
  let cookSaid = '';
  const unknownTo = () => [...recipesRead].filter(id => RECIPES[id] && stepsKnown(npc, id, agents.time) < RECIPES[id].steps.length);
  const theirBook = () => BOOK_RECIPES.filter(id => stepsKnown(npc, id, agents.time) > 0);
  const givable = () => [...new Set(theirBook().flatMap(id => recipeWants(id).flat()))].filter(k => (basket[k] || 0) > 0);
  const cookNodes = {
    get saved(){ return { text: cookSaid }; },
    get teach(){
      const ids = unknownTo();
      if (!ids.length) return { text: `"${v('tc-know', ['I know all of those already.', "I've had those off you already."])}"` };
      return { text: `"${v('tc-which', ['An old recipe? Which one?', 'Go on, then. Which?', "From a book? Let's hear it."])}"`,
        choices: ids.map(id => ({ label: `${cap(id)}.`, next: 'taught', run: () => {
          knowDish(npc, id, agents.time);
          journal.task(`cook:${npc.name}:${id}`, `${whoAt(npc)} knows how to make ${id} now, and will put some by for me when ${pron} cooks it. It wants ${wantsWords(id)}.`);
          journal.done(`recipe:${id}`);
          jot('taught', `${displayName(npc)} how to make ${id}`);
          const never = memoryOf(npc) === Infinity;
          cookSaid = `You read it out from your copy: ${RECIPES[id].steps.map(st => st.say).join(', then ')}. "${never ? v('tc-never', ["I'll not forget that.", "That's mine for good now."]) : v('tc-try', ["I'll try to keep that in my head.", "I'll remember it, for a while anyway."])}"`;
        } })) };
    },
    get taught(){ return { text: cookSaid }; },
    get give(){
      const ks = givable();
      if (!ks.length) return { text: `"${v('tc-nothing', ["You've nothing for it just now.", 'Nothing I need, thanks.'])}"` };
      return { text: `"${v('tc-what', ['For my cooking? What have you brought?', "That's kind. What is it?"])}"`,
        choices: ks.map(k => ({ label: `${cap(qty(Math.min(basket[k], 6), k))}.`, next: 'given', run: () => {
          const n = myPack.take(k, Math.min(basket[k] || 0, 6)), now = agents.time;
          if (RAW_KINDS.has(k)) addRaw(npc, k, n); else { addFood(npc, k, n, now); giveForDish(npc, k, now); }   // kept back for the dish
          const dish = theirBook().find(id => recipeWants(id).some(alts => alts.includes(k)));
          if (n > 0) jot('gave', `${displayName(npc)} ${qty(n, k)} for ${their} ${dish}`);
          cookSaid = `You give ${fem ? 'her' : 'him'} ${qty(n, k)}. "${v('tc-thanks', ['Now I can make {d} properly.', "That's the {d} seen to, then. Thank you."]).replace('{d}', dish)}"`;
          if (invOpen) openInventory();
        } })) };
    },
    get given(){ return { text: cookSaid }; },
    // the still-room (stillroom.js): a stargazer makes the fairy salve, if what you bring
    // was rightly got and the moon is new
    get salve(){
      const met = wantsMet(myPack, 'fairy salve'), short = met.filter(m => !m.ok);
      if (short.length){
        const lacks = short.filter(m => !(m.want.test && m.have >= m.want.n)).map(m => m.want.say), wrong = short.filter(m => m.want.test && m.have >= m.want.n).map(m => m.want.wrong);
        const wrongKinds = short.filter(m => m.want.test && m.have >= m.want.n).map(m => m.want.kind);
        journal.task('salve', `The fairy salve: ${whoAt(npc)} will make it${lacks.length ? `, but wants ${lacks.join(', and ')}` : ''}.${wrongKinds.length ? ` The ${wrongKinds.join(' and ')} I have wasn't rightly got.` : ''}`);
        jot('asked', `${displayName(npc)} to make the fairy salve`);
        return { text: `"${v('sv-know', ['The green salve? I know how it goes.', 'The salve for the eye. My gran made it once.'])}${lacks.length ? ` ${v('sv-lack', ["But I'd want {l}, and you've not got {it}.", "Bring me {l} first."]).replace('{l}', lacks.join(', and ')).replace('{it}', lacks.length > 1 ? 'them' : 'it')}` : ''}${wrong.length ? ' ' + wrong.join(' ') : ''}"` };
      }
      if ((sky.moonIllum ?? 1) >= NEW_MOON){
        const d = daysToNewMoon(sky.moonLon ?? 0, sky.sunLon ?? 0), when = d < 1 ? 'before tomorrow' : d < 1.5 ? 'tomorrow' : `in ${Math.round(d)} days`;
        journal.task('salve', `The fairy salve: I have all it wants. ${whoAt(npc)} will make it at the dark of the moon, ${when}.`);
        jot('asked', `${displayName(npc)} to make the fairy salve`);
        return { text: `"${v('sv-moon', ["You've all of it. But it's made at the dark of the moon, and there's moon up there yet. Come back {w}.", 'Not with that moon. When it goes dark, {w}, bring it all back to me.']).replace('{w}', when)}"` };
      }
      return { text: `"${v('sv-now', ['You have it all, and the moon is dark. Now, then?', "Everything, and no moon. It's tonight or not for a month."])}"`,
        choices: [{ label: v('q-sv-make', ['Make it, please.', 'Yes. Make it.']), next: 'salveMade', run: () => {
          if (!myPack.room('fairy salve', 1) && !(basket['fairy salve'] > 0)){ cookSaid = `"${v('sv-full', ["You've nowhere to carry it. Make room first.", 'Your pack is full; I would only spill it.'])}"`; return; }
          for (const w of PREPARATIONS['fairy salve'].wants) myPack.take(w.kind, w.n, w.test || null);
          stow('fairy salve', 1, provHere('given', displayName(npc)));
          journal.done('salve'); journal.done('recipe:fairy salve');
          jot('had', `${displayName(npc)} make me the fairy salve`);
          cookSaid = `${fem ? 'She' : 'He'} warms the wax over a candle and works the leaf and the caps into it with a thumb, under the breath counting something. "${v('sv-done', ['There. One eye only, mind, and after dark.', "Touch it to one eye, after dark. Not both. Never both."])}"`;
        } }] };
    },
    get salveMade(){ return { text: cookSaid }; },
  };

  // farewell addresses them by name once known, else by their kind ("Goodbye, Elf")
  const farewell = () => npc.known && npc.given ? `Goodbye, ${npc.given}`
    : `Goodbye, ${(npc.race || 'stranger').replace(/^./, c => c.toUpperCase())}`;
  const tree = { speaker: displayName(npc), portrait: npc.portrait, portraitBg: markBackdrop(npc.group?.id), root: 'hi', farewell, nodes: {
    get hi(){
      const greet = npc.known
        ? v('greet-k', ["Ah — you again. Well met.", "Back again? Good to see you.", "Hello again, friend.", "You! Twice in a day — the Lea's small.", "Oh, it's you. Sit a moment, if you like.", "Well, look who it is."])
        : v('greet', ["Oh — hello, stranger.", "Well met, traveller.", "Hail, friend — didn't hear you coming.", "Oh! A face I don't know.", "Good day to you.", "Hullo there. Lost, are you?", "Mind yourself — oh, just a traveller.", "A stranger, out here? Well met all the same.", "Peace to you, wanderer.", "Didn't expect company. Hello."]);
      // labels are phrased in the NPC's voice; and which topics they'll talk on varies
      const c = [{ label: v('q-name', ["What is your name?", "What do they call you?", "Who might you be?", "Your name, friend?", "Have you a name?", "By what name do you go?"]), next: 'name' },
                 { label: v('q-doing', ["What are you doing?", "What keeps you busy?", "Hard at work?", "What's the task today?", "What are you about?", "Busy, are you?"]), next: 'doing' }];
      if (voiceHas(npc, 'has-news', 0.8)) c.push({ label: v('q-news', ["Heard any news?", "What's the word?", "Any tidings?", "What's new hereabouts?", "Anything stirring?", "Heard aught of late?"]), next: 'news' });
      if (npc.known){                                  // personal topics unlock once you know them — and not all will talk of each
        if (voiceHas(npc, 'has-feel', 0.85)) c.push({ label: v('q-feel', ["How do you fare?", "How are you keeping?", "All well with you?", "How goes it?", "Are you well?", "How's the day treating you?"]), next: 'feel' });
        if (voiceHas(npc, 'has-self', 0.85)) c.push({ label: v('q-self', ["What sort are you?", "What manner of soul are you?", "Tell me of yourself.", "What's your way?", "What kind of person are you?", "What makes you, you?"]), next: 'self' });
        c.push({ label: v('q-plans', ["What are you planning?", "What's ahead for you?", "Any plans?", "What are you up to later?"]), next: 'plans' });
        if (voiceHas(npc, 'has-pack', 0.8))  c.push({ label: v('q-pack', ["What's in thy pack?", "What are you carrying?", "What's in your bag?", "What do you bear?", "Anything in that pack?", "What have you on you?"]), next: 'pack' });
      }
      if (house && (sky?.day ?? 1) > 0.3) c.push({ label: v('q-trade', ['Got anything to trade?', 'Anything put by to trade?', 'Will you trade?']), next: 'trade' });
      if (unknownTo().length) c.push({ label: v('q-teach-them', ['I found an old recipe…', "I've a recipe from an old book…"]), next: 'teach' });
      if (givable().length) c.push({ label: v('q-give-cook', ["I've brought something for your cooking.", 'Here, for your cooking.']), next: 'give' });
      // a portion they've put by for you, from a pot of a book dish (recipes.js putBy)
      let greetAll = greet;
      if (npc.saved && npc.saved.length){
        const dish = npc.saved[0].dish;
        greetAll += ` ${v('tc-saved', ['I saved you some {d}. It was your recipe.', "Here, I kept some {d} back for you."]).replace('{d}', dish)}`;
        c.unshift({ label: v('q-saved', ['Thank you.', "That's good of you."]), next: 'saved', run: () => {
          if (!myPack.room(dish, 1)){ cookSaid = `"${v('tc-full', ["You've no room for it. I'll keep it for you.", "Your pack's full. It'll keep."])}"`; return; }
          npc.saved.shift(); stow(dish, 1, provHere('given', displayName(npc)));
          journal.done(`cook:${npc.name}:${dish}`);
          jot('was given', `some ${dish} by ${displayName(npc)}, cooked from my recipe`);
          cookSaid = `You put the ${dish} in your pack.`;
        } });
      }
      if (askDoctor) c.push({ label: "Is there a doctor around? My eyes aren't showing me what I need to see.", next: 'doctor' });
      c.push({ label: v('q-where', ["Where are we?", "What is this place called?", "What do folk call this place?", "Where am I, friend?"]), next: 'where' });
      if (voiceHas(npc, 'has-sky', 0.65)) c.push({ label: v('q-sky', ["How looks the sky?", "What of the weather?", "How's the day?", "Fair skies?", "What's the sky doing?", "Think it'll hold fair?"]), next: 'sky' });
      if (npc.stargazer && recipesRead.has('fairy salve')) c.push({ label: v('q-salve', ['Could you make the fairy salve?', "I've a still-room book. The salve for the eye?"]), next: 'salve' });
      if (npc.stargazer) c.push({ label: v('q-stars', ["What do the stars say?", "Any word from the heavens?", "What do you read up there?", "Read me the sky?"]), next: 'stars' });
      return { text: greetAll, choices: c };
    },
    get news(){ return { text: newsReport(npc, sky?.time ?? 0) }; },
    get where(){ return { text: whereAreWe(npc, v) }; },
    get plans(){ return { text: plansReport(npc, v) }; },
    name:  { text: nameLine, choices: [ { label: v('q-kin', ["Who are your people?", "Who do you call kin?", "Who are your folk?", "Tell me of your people.", "Have you family hereabouts?", "Who do you travel with?"]), next: 'kin' } ] },
    doing: { text: doing },
    feel:  { text: feel },
    self:  { text: selfLine },
    kin:   { text: kinLine, ...(kinRoster ? { roster: kinRoster } : {}) },
    pack:  { text: packLine },
    sky:   { text: skyLine },
    ...(starsLine ? { stars: { text: starsLine + thinLine } } : {}),
    doctor: { text: doctorLine, ...(npc.stargazer ? { choices: [{ label: "My eyes can't see the way into Faerie.", next: 'doc-faerie' }] } : {}) },
    ...stargazerNodes,
    ...kinNodes,
  }};
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(tradeNodes));   // getters, so the offer re-reads live
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(cookNodes));
  tree.doctorMark = doctorMark;
  return tree;
}

// Inspecting a campfire/pot (E on it). It doesn't "talk" — you examine it — but it
// rides the same dialogue UI. Nodes are getters so each re-reads the fire's live
// state (the stew cooks on while you look). The pot report says what's in it and
// how many it can feed; the fire and basket each get their own line.
function fireTree(fire){
  const has = () => (fire.pot.raw + fire.pot.ready) > 0;
  const speaker = has() ? 'The cooking pot' : (fire.lit ? 'The campfire' : 'Cold ashes');
  return { speaker, portrait: null, root: 'look', farewell: 'Step away.', nodes: {
    get look(){
      return { text: has() ? fire.potReport() : fire.fireReport(), choices: (() => {
        const c = [];
        if (has()) c.push({ label: 'What’s in the pot?', next: 'pot' });
        c.push({ label: 'How fares the fire?', next: 'fire' });
        if ((fire.foodStore | 0) > 0) c.push({ label: 'What’s in the food basket?', next: 'store' });
        return c;
      })() };
    },
    get pot(){ return { text: fire.potReport() }; },
    get fire(){ return { text: fire.fireReport() }; },
    get store(){ return { text: fire.foodReport() }; },
  }};
}
// climb into a moored boat: snap onto it and switch to paddling
function board(b){
  boating = b; b.aboard = true;
  if (down){ upos.x = b.x; upos.z = b.z; } else { pos.x = b.x; pos.z = b.z; }
  setForageMsg(down ? 'You climb into the canoe. The paddle is cold and wet.' : 'You climb into the boat.');
}
// step ashore: find the nearest walkable shore around the boat and stand there;
// refuse if there's only open water within reach (you'd have to wade/swim).
function disembark(){
  const me = down ? upos : pos, ok = down ? down.L.walkable : walkable;
  for (let r = 1.5; r <= 8; r += 0.5){
    for (let k = 0; k < 16; k++){
      const a = k / 16 * Math.PI * 2, x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r;
      if (ok(x, z)){
        if (down) upos.set(x, down.L.floorAt(x, z) + EYE, z); else { pos.x = x; pos.z = z; pos.y = height(x, z) + EYE; }
        boating.aboard = false; boating = null;
        setForageMsg('You step ashore.');
        return;
      }
    }
  }
  setForageMsg('No shore close enough to step out.');
}

// ---------- under the Lea (js/gen/under.js, docs/under.md) ----------
// A cave or crypt is its own map, as in Might and Magic 6–8: E at its mouth asks
// whether to go down, and the screen fades to the level's own scene. Up here
// the world goes on — the folk, the weather, the clock — it just isn't drawn.
// `pos` stays where you stood at the mouth; underground you walk `upos`.
const levels = new Map();               // levels built this session: what you've mapped, taken and lit stays
// The views are heavy (the deepest crypt is ~420k triangles), so only the one you're in
// and the last one you left are kept; any other is rebuilt on the way down. A view is
// built from its level's seed and draws its state (finds, lit lights) from the level,
// so it comes back exactly as you left it.
const views = new Map();
let down = null;                        // { L, view, name } while you're underground
const upos = new THREE.Vector3();
let nearEntrance = null, nearFind = null, nearExit = -1, nearSconce = null, nearShelf = null;
const fadeEl = document.createElement('div');
fadeEl.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s;z-index:40';
document.body.appendChild(fadeEl);
function fade(then){
  fadeEl.style.opacity = '1';
  setTimeout(() => { then(); setTimeout(() => { fadeEl.style.opacity = '0'; }, 120); }, 380);
}
function levelOf(id){
  if (!levels.has(id)) levels.set(id, (typeof id === 'string' ? buildFaerie : buildLevel)(levelSpec(id)));
  if (typeof id === 'string') juliaWarm();                 // the stair's floor takes seconds: start on it in Faerie, off the main thread
  const L = levels.get(id);
  let view = views.get(id);
  if (view) views.delete(id); else view = (L.kind === 'stair' ? buildStairView : L.kind === 'grounds' ? buildGroundsView : buildLevelView)(L, sky);   // (the grounds show the Lea's stars)
  views.set(id, view);                                  // the most recent last
  while (views.size > 2){ const [k, v] = views.entries().next().value; v.dispose(); views.delete(k); }
  return { L, view };
}
// a level's plan and name: one under the Lea (gen/under.js), or in Faerie (gen/faerie.js): a
// palace behind a portal, the grounds behind them all, or the stair tower in the grounds
const portalOf = id => portals().find(p => p.level === id);
const levelSpec = id => id === GROUNDS ? groundsSpec(portals().map(p => ({ level: p.level, name: cap(p.name) })), WORLD_SEED)
  : id === STAIR ? stairSpec(portals().length) : typeof id === 'string' ? palaceSpec(portalOf(id)) : under().levels[id];
const levelName = id => id === GROUNDS ? 'The Gentry\'s Grounds' : id === STAIR ? 'The Turning Stair' : typeof id === 'string' ? cap(portalOf(id).name) : underNames()[id].name;
function goDown(e){
  const { L, view } = levelOf(e.level), m = L.mouths[e.mouth];
  down = { L, view, name: levelName(e.level) };
  L.enter?.(e.mouth);                                  // the stair: onto the ramp at this door's foot
  upos.set(m.inX, L.floorAt(m.inX, m.inZ) + EYE, m.inZ);
  const look = m.look ?? m.face + Math.PI;             // facing in, away from the daylight (or up the stair's ramp)
  yaw = Math.atan2(-Math.cos(look), -Math.sin(look)); pitch = 0;
  maps.setLevel(L, down.name);
  setForageMsg(e.from ? `You go through, into ${down.name}.` : L.site === 'palace' ? `You step through the dark, into ${down.name}.` : `You go down into ${down.name}.`, 3000);
  if (sight && !L.faerie){ sight = null; faerie.stop(); setTimeout(() => setForageMsg('Down here the salve fades from your eye.', 3500), 3100); }   // (tickSight only runs above ground)
  journal.arrive(journalPlace(), 'down');
}
// out by mouth k, onto the ground in front of it, facing away from it
function comeUp(k){
  const to = down.L.mouths[k].to;                      // a door into another level of Faerie
  if (to){ nearFind = null; nearExit = -1; return goDown({ ...to, from: down.L.id }); }
  if (down.L.site === 'palace') return leavePalace();
  const e = under().entrances.find(x => x.level === down.L.id && x.mouth === k);
  pos.x = e.stand[0]; pos.z = e.stand[1]; pos.y = height(pos.x, pos.z) + EYE;
  yaw = Math.atan2(-Math.cos(e.face), -Math.sin(e.face)); pitch = 0;
  down = null; nearFind = null; nearExit = -1;
  maps.setLevel(null);
  setForageMsg('You come up into the open air.', 2500);
}
// where a crypt's stair goes down from, and where it comes up (gen/under.js: a crypt's site)
const STAIR_WHERE = { chapel: 'under the chapel floor', hall: "under the old hall's floor", tower: 'under the tower', tomb: 'into the ground between worn kerbstones', abbey: "under the abbey's crossing" };
const STAIR_UP = { chapel: 'to the chapel floor', hall: "to the old hall's floor", tower: "to the tower's floor", tomb: 'to the open air', abbey: "to the abbey's crossing" };
// out of a palace, through its door, onto the spot in front of the portal. After dawn the
// salve has done: the door is gone behind you, and Puck remarks on how long you were
// away (the tales' night inside that's a year outside is for later: docs/magic.md)
function leavePalace(){
  const p = portalOf(down.L.id), h = (((sky.time ?? 0) % 1) + 1) % 1 * 24, day = h >= 5 && h < 19;
  pos.x = p.stand[0]; pos.z = p.stand[1]; pos.y = height(pos.x, pos.z) + EYE;
  yaw = Math.atan2(-Math.cos(p.face), -Math.sin(p.face)); pitch = 0;
  down = null; nearFind = null; nearExit = -1;
  maps.setLevel(null);
  if (day){
    sight = null; faerie.stop();
    setForageMsg('You step out into daylight. Behind you there is only grass; the door has gone.', 4500);
    setTimeout(() => setForageMsg('Puck, at your ear: "All night, you were in there! Count yourself lucky it was only the one. Folk have gone in and come out a hundred years on."', 7000), 3500);
  } else setForageMsg('You step back through the dark, into the night of the Lea.', 3000);
}
function askPortal(p){
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
  talkTree({ speaker: cap(p.name), root: 'ask', farewell: 'Stay in the Lea.', nodes: { ask: {
    text: `An oval of black hangs in the air, a door into nothing. Lights spiral into it, and out again. Go through into ${p.name}?`,
    choices: [{ label: 'Go through.', next: null, run: () => fade(() => goDown({ level: p.level, mouth: 0 })) }] } } }, { onClose });
}
function askDown(e){
  const name = underNames()[e.level].name;
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
  talkTree({ speaker: name, root: 'ask', farewell: 'Stay above.', nodes: { ask: {
    text: (e.kind === 'cave' ? 'A cave mouth in the hillside. Cold air breathes out of the dark.' : `Worn steps go down ${STAIR_WHERE[e.site] || STAIR_WHERE.chapel}, into the dark.`) + ` Go down into ${name}?`,
    choices: [{ label: 'Go down.', next: null, run: () => fade(() => goDown(e)) }] } } }, { onClose });
}
function askUp(k){
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
  const m = down.L.mouths[k];
  talkTree({ speaker: down.name, root: 'ask', farewell: m.to ? 'Stay here.' : 'Stay below.', nodes: { ask: {
    text: m.ask ? m.ask : down.L.site === 'palace' ? 'The door you came in by. Beyond it, the Lea. Go back through?' : down.L.kind === 'cave' ? 'Daylight, up ahead. Climb out?' : `The stair climbs ${STAIR_UP[down.L.site] || STAIR_UP.chapel}. Go back up?`,
    choices: [{ label: m.go || 'Climb out.', next: null, run: () => fade(() => comeUp(k)) }] } } }, { onClose });
}
function takeFind(f){
  const got = stow(f.kind, f.n, provHere('found'));
  f.n -= got; if (f.n <= 0) f.taken = true;   // what didn't fit stays where it was
}
// what a light underground says, unlit and lit
const LIGHT_LABEL = {
  torch:       [['An old torch', 'Its head is black with old pitch. It would still take a flame.'], ['A torch, burning', 'Pitch and tow, smoking in its iron cup.']],
  brazier:     [['A brazier', 'An iron bowl of old coals on three legs.'], ['A brazier, burning', 'The coals glow red under a tall flame.']],
  candles:     [['A candle stand', 'Five stubs of tallow on iron prickets.'], ['Candles, burning', 'Five small flames, steady in the still air.']],
  altarCandle: [['An altar candle', 'A stub of wax on a pricket.'], ['An altar candle, lit', 'Its flame stands quite still.']],
};
const LIGHT_VERB = { torch: 'the torch', brazier: 'the brazier', candles: 'the candles', altarCandle: 'the candle' };
const FIND_LABEL = LOOKS;   // what a find says when you aim at it (ingredients.js `look`)
// Books on the crypts' shelves (gen/under.js shelves(), docs/under.md "Books"): a whole one
// holds a recipe, dealt round the book recipes by its deal number. Reading it copies the
// recipe into your own book (the Recipes page of the spellbook); what wants a rare
// ingredient says, in a margin note, where that's found. A mouldy shelf in a chapter house
// holds a still-room book instead (stillroom.js shelfBook): a preparation, not a dish.
const recipesRead = new Set();   // kitchen recipes and preparations alike, by id
// A Faerie palace's shelves hold the Gentry's library instead (faerie-books.js): real
// recipes out of mortal books, read and copied but not yet made. Kept apart from
// recipesRead, which the folk's cooking and Puck's finding read as things to make.
const faerieRead = new Set();
const PALACE_SHELF = ['A bookcase', 'Every book on it whole, bound in vellum, the edges gilt.'];
const SHELF_LABEL = {
  book:   ['A bookshelf', 'Mostly ruined with damp, but one book is still whole.'],
  ruined: ['A bookshelf', 'A few books left, swollen and grey with mould.'],
  rotted: ['A fallen bookshelf', 'The case has rotted through; its books are pulp.'],
};
const SHELF_BOOK = { undercroft: "The cellarer's book", cloister: 'A book from the cupboard', chapterhouse: 'A book from the chapter house' };
const RARE_WHERE = { cave: 'deep in the caves, where the passages go down', ring: 'in the fairy rings, at first light' };
const bookRecipe = shelfBook;
// what a recipe wants: its base, then what goes in on the way (each a list of alternatives)
const recipeWants = id => [RECIPES[id].base, ...RECIPES[id].steps.filter(st => st.do === 'add').map(st => st.item)];
// a recipe as its page prints it, and what a later reader wrote beside it: where a rare
// ingredient is found goes in the margin, in another hand (js/page.js)
function recipePage(id){
  const R = RECIPES[id], steps = R.steps.map(st => st.say).join(', then ');
  const rare = [...new Set(recipeWants(id).flat())].filter(k => RARE[k]);
  return { body: [R.intro, `Take ${R.base.join(' or ')}; ${steps}.`],
           margins: rare.length ? [`${cap(rare.join(' and '))}: only ${RARE_WHERE[RARE[rare[0]]]}.`] : [] };
}
// a still-room book's page: what it wants and how it's done, and where the hard ones are found
function prepPage(id){
  const P = PREPARATIONS[id], wants = P.wants.map(w => w.say);
  const rare = P.wants.map(w => w.kind).filter(k => RARE[k]);
  return { body: [P.intro, `Take ${wants.slice(0, -1).join(', ')} and ${wants.at(-1)}; ${P.method}.`, P.use],
           margins: rare.map(k => `${cap(k)}: only ${RARE_WHERE[RARE[k]]}.`) };
}
function readShelf(sh){
  const id = bookRecipe(sh);
  if (id && FAERIE_BOOKS[id]){ readFaerieBook(id); return; }
  if (!id){ setForageMsg(SHELF_LABEL[sh.state][1], 3000); return; }
  const fresh = !recipesRead.has(id), prep = !!PREPARATIONS[id];
  recipesRead.add(id);
  if (fresh){
    jot('found', prep ? `the making of the ${id}, in a still-room book` : `a recipe for ${id}`);
    journal.task(`recipe:${id}`, prep ? `The ${id}: a stargazer could make it, from ${PREPARATIONS[id].wants.map(w => w.say).join(', ')}.` : `A recipe for ${id}, to teach to a cook. It wants ${wantsWords(id)}.`);
  }
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
  readPage({ book: prep ? 'A book kept dry in its case' : SHELF_BOOK[sh.room] || 'An old book', title: cap(id), ...(prep ? prepPage(id) : recipePage(id)),
             aside: fresh ? 'You copy it into your book of recipes.' : null, onClose });
}
// a book of the Gentry's: on vellum, in their own type (page.js `paper`)
function readFaerieBook(id){
  const B = FAERIE_BOOKS[id], fresh = !faerieRead.has(id);
  faerieRead.add(id);
  if (fresh){
    jot('found', `${B.magic ? 'the making of' : 'a recipe for'} ${id}, in a book of the Gentry's`);
    journal.task(`recipe:${id}`, `${cap(id)}, out of ${B.from.charAt(0).toLowerCase() + B.from.slice(1)}. It wants ${B.wants.join(', ')}.`);
  }
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
  readPage({ paper: 'vellum', book: B.from, title: cap(id), body: [B.intro, ...B.body], margins: B.margins || [],
             aside: fresh ? 'You copy it into your book of recipes.' : null, onClose });
}
// underground, what's in front of you: a find to take, or the way out
function underFocus(){
  camera.getWorldDirection(_fwd);
  const L = down.L;
  let best = null, bd = 0.9;
  for (const f of L.finds){
    if (f.taken) continue;
    const y = (f.y ?? L.floorAt(f.x, f.z)) + 0.2, dx = f.x - upos.x, dy = y - upos.y, dz = f.z - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; best = f; }
  }
  // a torch on the wall, aimed at by its head
  let sc = null;
  for (const s of L.sconces || []){
    const dx = s.x - upos.x, dy = (s.aimY ?? s.y + 0.45) - upos.y, dz = s.z - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; sc = s; best = null; }
  }
  // a bookshelf, aimed at by its middle
  let sh = null;
  for (const s of L.shelves || []){
    const dx = s.x - upos.x, dy = s.y + s.h * 0.55 - upos.y, dz = s.z - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; sh = s; sc = null; best = null; }
  }
  nearFind = best; nearSconce = sc; nearShelf = sh;
  nearExit = L.mouths.findIndex(m => Math.hypot(m.x - upos.x, m.z - upos.z) < 6 && (m.fy == null || Math.abs(m.fy - (upos.y - EYE)) < 2.5));   // (the stair's doors: only at their own height)
  hoverPanel.style.display = 'flex'; hoverFace.style.display = 'none'; hoverName.style.display = ''; hoverAmbient.style.display = '';
  // the lake's canoe: in it, nothing else is in reach but the water; beside it, it's yours to take
  const canoe = down.view.canoe;
  if (boating){
    nearFind = nearSconce = nearShelf = null; nearExit = -1;
    nearFish = L.eelsAt(upos.x, upos.z) ? L.eels : null;
    if (nearFish){ hoverName.textContent = 'Black water'; hoverAmbient.textContent = L.eels.stock < 0.3 ? 'Deep and still. Fished hard, lately.' : 'Deep and still. Eels lie down there in the dark.'; }
    else { hoverName.textContent = 'The lake'; hoverAmbient.textContent = 'Shallow here. Paddle out to the deep water to fish.'; }
    return;
  }
  if (canoe && !best && !sc && !sh && Math.hypot(canoe.x - upos.x, canoe.z - upos.z) < 3.5){
    nearBoat = canoe; nearExit = -1;
    hoverName.textContent = 'A bark canoe'; hoverAmbient.textContent = 'Drawn up at the edge of the black water, a paddle across it.';
    return;
  }
  if (sh){ const [t, d] = sh.palace ? PALACE_SHELF : SHELF_LABEL[sh.state]; hoverName.textContent = t; const b = bookRecipe(sh); hoverAmbient.textContent = b && (recipesRead.has(b) || faerieRead.has(b)) ? `${cap(b)}: copied into your book.` : b && sh.state !== 'book' ? 'Mould on all of them but one, in a leather case.' : d; }
  else if (sc){ const [t, d] = (LIGHT_LABEL[sc.kind || 'torch'] || LIGHT_LABEL.torch)[sc.lit ? 1 : 0]; hoverName.textContent = t; hoverAmbient.textContent = d; }
  else if (best){ const [t, d] = FIND_LABEL[best.kind] || [best.kind, '']; hoverName.textContent = t; hoverAmbient.textContent = d; }
  else if (nearExit >= 0){ const m = L.mouths[nearExit]; hoverName.textContent = m.label ? cap(m.label) : 'The way out'; hoverAmbient.textContent = m.desc || 'Daylight, and the air of the world above.'; }
  else { hoverName.textContent = down.name; hoverAmbient.textContent = 'Your torch lights a few strides of rock.'; }
}

// ---------- the spellbook (C) ----------
// A page of spells, as in Might and Magic: click one, or press its number.
// Teleport opens the world map to choose a spot, from anywhere, underground
// included; Fly is the fly camera; Wizard Eye shows the whole of the level
// you're in. Each costs spell points (vitals.js): Teleport when you land, Fly to rise
// and then a trickle while you're up (run out and you drift down), Wizard Eye at once.
const spellEl = document.createElement('div');
spellEl.id = 'spellbook'; spellEl.className = 'hide';
document.body.appendChild(spellEl);
let spellOpen = false;
// a little pixel sigil for each spell, drawn on a 16px grid
function sigil(kind){
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const g = cv.getContext('2d'), px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    if (kind === 'teleport'){                                           // a swirl going in
      const s = ((th + Math.PI) / (Math.PI * 2) + r / 5) % 1;
      if (r < 7.5 && s < 0.35) px(x, y, r < 3 ? '#f4e6a8' : '#8fa8d8');
    } else if (kind === 'fly'){                                         // a feather
      const spine = Math.abs(dx + dy * 0.6) < 0.8 && r < 7;
      const vane = Math.abs(dx + dy * 0.6) < 3.2 - Math.abs(dy) * 0.25 && dy > -6 && dy < 5;
      if (spine) px(x, y, '#efe6cf'); else if (vane) px(x, y, '#9ec8e8');
    } else if (kind === 'eye'){                                         // an eye
      const lid = Math.abs(dy) < 4.5 * Math.cos(dx / 8 * Math.PI / 2) && Math.abs(dx) < 7.5;
      if (r < 2.2) px(x, y, '#101010'); else if (r < 3.6) px(x, y, '#c9a23a'); else if (lid) px(x, y, '#efe6cf');
    }
  }
  return cv;
}
let flyPaid = false;      // flying by the spell (it drains spell points), not the debug camera
const SPELLS = [
  { id: 'teleport', name: 'Teleport', cost: 8, desc: 'Step out of the air anywhere in the Lea.', can: () => true, cast: castTeleport },
  { id: 'fly', name: 'Fly', cost: 2, costNote: '2, then 1 every 4 s aloft', desc: 'Rise and go over the land. Cast again to come down.', can: () => !down, why: 'The rock above is too close.',
    free: () => fly,      // coming down costs nothing
    cast(){
      if (fly){ fly = false; flyPaid = false; setForageMsg('You come back down to earth.'); }
      else { spend(me, 2); fly = true; flyPaid = true; setForageMsg('You rise off the ground.'); }
      relock(); } },
  { id: 'eye', name: 'Wizard Eye', cost: 5, desc: 'See the whole shape of the place you are under.', can: () => !!down, why: 'Only underground, where the dark hides it.',
    cast(){ spend(me, 5); maps.revealAll(); setForageMsg(`The whole of ${down.name} opens in your mind.`, 3000); relock(); } },
];
const affords = sp => (sp.free && sp.free()) || me.sp >= sp.cost;
const POOR = 'Not enough strength left in you.';
function relock(){ if (playing && !document.body.classList.contains('cursor-mode')){ try { canvas.requestPointerLock(); } catch (_){} } }
function openSpellbook(){
  spellEl.innerHTML = `<div class="book"><h2>Spellbook</h2><p class="sub">What you know of the old craft. Spell points: ${Math.floor(me.sp)} of ${SP_MAX}.</p><div class="spells"></div>` +
    recipesPage() + '<div class="foot">click a spell or press its number · C or Esc to close</div></div>';
  const list = spellEl.querySelector('.spells');
  SPELLS.forEach((sp, i) => {
    const can = sp.can(), ok = can && affords(sp), el = document.createElement('div');
    el.className = 'spell' + (ok ? '' : ' off');
    el.appendChild(sigil(sp.id));
    el.insertAdjacentHTML('beforeend', `<span class="key">${i + 1}</span><div class="name">${sp.name}</div><div class="cost">${sp.costNote || sp.cost} spell points</div><div class="desc">${!can ? sp.why : !ok ? POOR : sp.desc}</div>`);
    el.onclick = () => castSpell(i);
    list.appendChild(el);
  });
  spellEl.classList.remove('hide'); spellOpen = true;
  document.exitPointerLock?.();
}
// the Recipes page: what you've read in the crypts' books, each ingredient marked if you carry it
function recipesPage(){
  if (!recipesRead.size && !faerieRead.size) return '';
  const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = [...recipesRead].map(id => {
    if (PREPARATIONS[id]){                     // a preparation: each want marked only if got rightly
      const wants = wantsMet(myPack, id).map(m => `<span class="${m.ok ? 'have' : ''}${RARE[m.want.kind] ? ' rare' : ''}">${esc(m.want.n > 1 ? `${m.want.n} ${m.want.kind}` : m.want.kind)}${m.want.test && m.have >= m.want.n && !m.ok ? ' (not rightly got)' : ''}</span>`).join(' · ');
      return `<div class="recipe"><div class="name">${esc(cap(id))}</div><div class="wants">${wants} — made by a stargazer, at the new moon</div></div>`;
    }
    const wants = recipeWants(id).map(alts => {
      const have = alts.some(k => (basket[k] || 0) > 0), rare = alts.some(k => RARE[k]);
      return `<span class="${have ? 'have' : ''}${rare ? ' rare' : ''}">${esc(alts.join(' or '))}</span>`;
    }).join(' · ');
    return `<div class="recipe"><div class="name">${esc(cap(id))}</div><div class="wants">${wants}</div></div>`;
  }).join('');
  // the Gentry's books: what they want, in their own words; marked where it's a thing you carry
  const lore = [...faerieRead].map(id => {
    const B = FAERIE_BOOKS[id];
    const wants = B.wants.map(w => `<span class="${B.kinds.some(k => w.includes(k) && (basket[k] || 0) > 0) ? 'have' : ''}">${esc(w)}</span>`).join(' · ');
    return `<div class="recipe"><div class="name">${esc(cap(id))}</div><div class="wants">${wants} — from ${esc(B.from.charAt(0).toLowerCase() + B.from.slice(1))}</div></div>`;
  }).join('');
  return `<h3>Recipes</h3><p class="sub">Copied from the old books. Marked: what you carry; starred: found only in hard places.</p><div class="recipes">${rows}</div>`
    + (lore ? `<h3>From the Gentry's library</h3><p class="sub">Out of mortal books, kept in Faerie. Most want things not yet found in the Lea.</p><div class="recipes">${lore}</div>` : '');
}
function closeSpellbook(lock = true){ spellEl.classList.add('hide'); spellOpen = false; if (lock) relock(); }
function castSpell(i){
  const sp = SPELLS[i];
  if (!sp || !sp.can()) return;
  if (!affords(sp)){ setForageMsg(POOR, 2500); return; }
  closeSpellbook(false);
  sp.cast();
}
spellEl.addEventListener('click', e => { if (e.target === spellEl) closeSpellbook(); });
// Teleport: choose on the world map, then stand on the nearest dry ground to it.
// From underground you come up out of the level wherever you chose.
function castTeleport(){
  maps.pick((x, z) => {
    let spot = null;
    for (let r = 0; r <= 24 && !spot; r += 1.5) for (let q = 0; q < 16 && !spot; q++){
      const a = q / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (Math.hypot(px, pz) < WORLD_R && walkable(px, pz)) spot = [px, pz];
    }
    relock();
    if (!spot){ setForageMsg('There is nothing to stand on there.'); return; }
    if (!spend(me, 8)){ setForageMsg(POOR, 2500); return; }
    fade(() => {
      if (down){ down = null; nearFind = null; nearExit = -1; nearSconce = null; maps.setLevel(null); }
      if (boating){ boating.aboard = false; boating = null; }
      pos.x = spot[0]; pos.z = spot[1]; pos.y = height(pos.x, pos.z) + EYE;
      setForageMsg(`You step out of the air ${placePhrase(placeAt(pos.x, pos.z))}.`, 3500);
    });
  }, down ? upos.x : pos.x, down ? upos.z : pos.z, yaw);
}

// pick a ripe forageable into the basket (E in the world, or "take the caps" from
// inside a ring's own dialogue)
function gather(p){
  if (!myPack.room(p.kind, 1)){ setForageMsg('No room in your pack.', 3000); return 0; }
  const n = p.collect();
  return n > 0 ? stow(p.kind, n, provHere('picked')) : 0;
}

// look in the clover inside a fairy ring: at first light, one four-leaf clover a ring a
// day (stillroom.js wants it picked so, for the fairy salve); otherwise every leaf has
// three. Said in the ring's voice (wood-talk.js ringTree).
function searchClover(ring){
  const h = (((sky.time ?? 0) % 1) + 1) % 1 * 24, day = Math.floor(agents.time);
  if (!isDawn(h)) return 'Clover. Three leaves on every one you will find by this light. The fourth only shows itself when the sun is coming up, and not for long.';
  if (ring._clover === day) return 'You have had the one I grow today. Tomorrow, at first light.';
  if (!myPack.room('four-leaf clover', 1)){ return 'There is one, between my caps. You have nowhere to put it.'; }
  ring._clover = day;
  const prov = provHere('picked');
  if (!prov.thin.includes('fairy ring')) prov.thin.push('fairy ring');   // inside this one, whatever the reach
  stow('four-leaf clover', 1, prov);
  return 'There. Four leaves, in the grass between my caps, wet with the dew. It is picked now; what it is good for is your business.';
}

// live state the wood's dialogue reads: whose clock, whose weather, whose ground
const woodCtx = () => ({ myc, now: myc.time, rain: rain.intensity, night: sky.night ?? 0, height, soil: soilRichness });

// how close open water is, and which way — drives the seashore wash. Marches a
// few rays outward until each hits water; nearest hit sets loudness + stereo side.
function seaProx(){
  if (height(pos.x, pos.z) < WATER + 0.3) return { prox: 1, pan: 0 };   // on/at the water
  const MAX = 26; let best = MAX, bdx = 0, bdz = 0;
  for (let k = 0; k < 12; k++){
    const a = k / 12 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let r = 3; r <= MAX; r += 3){
      if (height(pos.x + c * r, pos.z + s * r) < WATER){ if (r < best){ best = r; bdx = c; bdz = s; } break; }
    }
  }
  const prox = best >= MAX ? 0 : 1 - best / MAX;
  const fwx = -Math.sin(yaw), fwz = -Math.cos(yaw), rgx = -fwz, rgz = fwx;
  return { prox: prox * prox, pan: prox > 0 ? Math.max(-1, Math.min(1, (bdx * rgx + bdz * rgz) * 0.8)) : 0 };
}

// cheats: Enter opens a line to type one into (Enter runs it, Esc drops it); its keys
// stop at the box, so typing doesn't walk you about or open panels
const cheatEl = document.getElementById('cheat');
const CHEATS = { SALVEMEUP: () => stow('fairy salve', 1, null) };
function openCheat(){
  for (const k in keys) keys[k] = false;
  document.exitPointerLock?.();
  cheatEl.value = ''; cheatEl.classList.remove('hide'); cheatEl.focus();
}
function closeCheat(){ cheatEl.classList.add('hide'); cheatEl.blur(); relock(); }
cheatEl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.code === 'Escape'){ e.preventDefault(); closeCheat(); }
  else if (e.key === 'Enter'){
    const run = CHEATS[cheatEl.value.trim().toUpperCase()];
    closeCheat();
    if (run) run(); else if (cheatEl.value.trim()) setForageMsg('Nothing happens.');
  }
});
cheatEl.addEventListener('keyup', e => e.stopPropagation());
cheatEl.addEventListener('blur', () => cheatEl.classList.add('hide'));

addEventListener('keydown', e => {
  if (journalUI.isOpen){                              // and so does the journal
    if (e.code === 'KeyJ' || e.code === 'Escape') journalUI.close();
    return;
  }
  if (spellOpen){                                     // the spellbook takes the keys while it's open
    if (e.code === 'KeyC' || e.code === 'Escape') closeSpellbook();
    else if (/^Digit[1-9]$/.test(e.code)) castSpell(+e.code.slice(5) - 1);
    return;
  }
  if (rest && (e.code === 'KeyR' || e.code === 'Escape' || /^Key[WASD]$/.test(e.code))){ stopRest(false); return; }   // passing time: R or a step stops it
  if (restOpen){
    if (e.code === 'KeyR' || e.code === 'Escape') closeRest(true);
    else if (/^Digit[1-9]$/.test(e.code)) startRest(+e.code.slice(5) - 1);
    return;
  }
  if (maps.bigOpen && (e.code === 'KeyM' || e.code === 'Escape')){ closeBigMap(); return; }
  if (invOpen && (e.code === 'KeyI' || e.code === 'Escape')){ closeInventory(true); return; }
  if (e.code === 'KeyI' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openInventory(); document.exitPointerLock?.(); return; }
  if (e.code === 'KeyC' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openSpellbook(); return; }
  if (e.code === 'KeyJ' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openJournal(); return; }
  if (e.code === 'KeyR' && playing && !inDialog && !settingsOpen && !skyPicker._open){ if (invOpen) closeInventory(); openRest(); return; }
  if (e.code === 'KeyM' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openBigMap(); return; }
  if (e.key === 'Enter' && playing && !inDialog && !settingsOpen && !skyPicker._open && !invOpen){ e.preventDefault(); openCheat(); return; }
  if (e.code === 'KeyO'){ settingsOpen ? closeSettings() : openSettings(); return; }
  if (e.code === 'Escape' && settingsOpen){ closeSettings(); return; }
  if (e.code === 'Escape' && playing && !inDialog){
    if (document.pointerLockElement !== canvas){
      // Already in cursor mode — Escape re-locks
      try { canvas.requestPointerLock(); } catch (_){}
    }
    // If locked, the browser exits pointer lock automatically on Escape;
    // pointerlockchange will pick it up and enter cursor mode.
    return;
  }
  if (e.code === 'KeyF' && DEBUG){ fly = !fly; flyPaid = false; }   // the free fly camera, for debugging (?debug)
  if (e.code === 'KeyB'){ showNpcDbg = !showNpcDbg; npcDbg.style.display = showNpcDbg ? 'block' : 'none'; }
  if (e.code === 'KeyP'){
    const u = poseURL();
    navigator.clipboard?.writeText(u).catch(()=>{});
    setPoseMsg('pose copied'); console.log('POSE', u);
  }
  const _inLook = document.pointerLockElement === canvas;
  if (e.code === 'KeyE' && _inLook && !inDialog && down){
    if (boating){ if (playerFish) reelIn('You reel in.'); else if (nearFish) castLine(nearFish); else disembark(); }
    else if (nearBoat) board(nearBoat);
    else if (nearShelf) readShelf(nearShelf);
    else if (nearSconce){ nearSconce.lit = !nearSconce.lit; setForageMsg(nearSconce.lit ? 'You light it from your own torch.' : 'You put it out.'); }
    else if (nearFind) takeFind(nearFind); else if (nearExit >= 0) askUp(nearExit);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && playerFish){
    reelIn('You reel in.');
  } else if (e.code === 'KeyE' && _inLook && !inDialog && boating && nearFish){
    castLine(nearFish);                                   // over a ground: fish from the boat
  } else if (e.code === 'KeyE' && _inLook && !inDialog && boating){
    disembark();
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearBoat){
    board(nearBoat);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearPortal){
    askPortal(nearPortal);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearEntrance){
    askDown(nearEntrance);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearTalker){
    const npc = nearTalker.c;
    npc.talking = true; inDialog = true;                  // stop walking mid-dialogue
    if (npc.heading !== undefined) npc.heading = Math.atan2(pos.x - npc.x, pos.z - npc.z);   // turn to face me
    document.exitPointerLock?.();
    const onClose = () => {
      mapMark = null;                                     // clear any kin marker on leaving
      npc.talking = false; inDialog = false;
      try { canvas.requestPointerLock(); } catch (_){}
    };
    if (nearTalker.peasant){
      const tree = peasantTree(npc, sky);
      const onNav = (id) => {
        mapMark = null;                                  // clear the marker on any topic change
        if (id === 'name') npc.known = true;             // they told you their name directly
        if (id === 'stars') thinKnown = true;            // a stargazer's told you of the thin places
        if (id === 'doc-thin') thinKnown = true;
        if (id === 'doc-else') salveHeard = true;        // the salves of old: now Puck can be asked
        if (id === 'doctor') mapMark = tree.doctorMark;  // where they last saw their stargazer
        if (id === 'kin' && npc.group){                  // you've now *heard of* their kin (not met them)
          for (const o of npc.group.npcs)
            if (o !== npc && !o.known && !o.heardFrom) o.heardFrom = npc;
        }
        tree.speaker = displayName(npc);                 // header reflects what you now know
      };
      talkTree(tree, { onClose, onNav });
    } else {
      const onNav = () => { mapMark = null; };
      openTalk(nearTalker.dialog, { actions: weatherActions, onClose, onNav });
    }
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearObject){
    inDialog = true; document.exitPointerLock?.();         // examine the fire/pot
    const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
    talkTree(fireTree(nearObject), { onClose });
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearTree){
    inDialog = true; document.exitPointerLock?.();          // examine a tree / speak with a faced one
    const node = nearTree;
    const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
    // faced trees actually talk (first person); the rest are examined by sensation
    talkTree(node.faced ? facedTreeVoice(node, woodCtx()) : treeVoice(node, woodCtx()), { onClose });
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearRing){
    inDialog = true; document.exitPointerLock?.();          // the fungus itself
    const ring = nearRing;
    const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
    talkTree(ringTree(ring.ringNode, woodCtx(), { onTake: () => gather(ring), clover: () => searchClover(ring) }), { onClose });
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearFruit){
    gather(nearFruit);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearFish){
    castLine(nearFish);
  }
});

const hands = createHands();              // Doom-style first-person hands viewmodel

const _handsTint = new THREE.Color();
const _fireWarm  = new THREE.Color(1.0, 0.58, 0.20);   // warm amber fire light
const _torchTint = new THREE.Color(0.62, 0.42, 0.26);  // your torch, underground
const _rainTint  = new THREE.Color(0.55, 0.62, 0.80);  // cool blue-grey cast under rain
const FIRE_LIGHT_RANGE = 10;

let last = performance.now(), _bigT = 0, walkPace = 1, _wearT = 0;

// one tick of the world's own life: the folk, the beasts, the paths, the wood. Each frame
// runs it once; passing time runs it many times a frame. `walking`: you tread the path too
function worldTick(simDt, tint, walking){
  agents.syncSky(sky); agents.rain = rain.intensity; agents.update(simDt);
  npcApi.update(camera, simDt, tint);
  tosses.update(simDt, tint);
  agents.separate(simDt);                          // keep NPCs from overlapping / crowding
  agents.resolveTrees();                           // pop anyone out of a trunk they touched
  if (simDt > 0){                                  // walkers tread paths into the wear field
    for (const n of npcApi.npcs) if (n.moving) trail.deposit(n.x, n.z, simDt);
    if (avatar && avatar.moving) trail.deposit(avatar.x, avatar.z, simDt);
    if (walking) trail.deposit(pos.x, pos.z, simDt);
    for (const q of agents.fauna) if (q.alive && q.moving) trail.deposit(q.x, q.z, simDt * 0.25);   // faint animal traces
  }
  trail.tick(simDt);
  if ((_wearT += simDt) > 2){ _wearT = 0; agents.nav.refreshWear(trail); }   // the paths re-price the routes
  // the wood feels what happened above it (feet, cutting, fire) and moves it along
  // the threads about once an in-game hour — see js/mycelium.js
  myc.update(simDt, agents.time);
  myc.sense({ trailWear: (x, z) => trail.wearAt(x, z), shrubs: forage.shrubs, fires: agents.openFires });
  if (avatar) avatar.update(camera, simDt, tint);
  if (pucks) pucks.update(camera, simDt, pos, tint, { outside: !down });   // flock owns Puck's movement
  tickJournal(simDt);                                  // what comes of walking about, for the journal
  if (puckGuide) puckGuide.tick(simDt);                // and, on a trip, what he says along the way
  if (warren) warren.update(camera, simDt, tint);      // draw the rabbits
  forage.update(simDt);
  if (down){ const g = down.L.eels; if (g && g.stock < 1) g.stock = Math.min(1, g.stock + simDt / sky.dayLength); }   // the eels come back
}

// ---------- passing time (R) ----------
// Rest until dawn, dusk, the full moon…, in two tiers:
//   up to ROUGH_OVER days: the world is run fast, whole world ticks, as many as fit in
//     REST_BUDGET ms of each frame, so the folk live the hours out. A tick is REST_DT
//     sim-seconds: the sim harness holds its invariants and its folk keep their ways at
//     1 s, but at 2 s they walk past the seats and doorways they're aiming for (arrival
//     is ~0.5 m, a 2 s step is 3.2 m), so they stop building fires and huts
//   longer: skipAhead jumps all but the last FULL_LAST days roughly, then the ticks run
//     the rest, so what you wake to is the real sim's state
// Cost: about 6 ms a tick on the Pi (the harness), so a day of ticks is ~4 s
const REST_DT = 1, REST_BUDGET = 250, ROUGH_OVER = 1, FULL_LAST = 4 / 24;
const HOUR = 1 / 24, frac = t => ((t % 1) + 1) % 1;
const hourOf = t => frac(t) * 24;
// the next time the clock reads hour h (not now: at least a quarter hour ahead)
const nextHour = h => { let d = frac(h / 24 - frac(sky.time)); if (d < HOUR / 4) d += 1; return sky.time + d; };
const SYNODIC = () => 2 * Math.PI / (2 * Math.PI / 27.32 - 2 * Math.PI / sky.yearDays);   // days (stillroom.js daysToNewMoon)
const moonAhead = d => d < 0.05 ? d + SYNODIC() : d;
const REST_TO = [
  { label: 'An hour',             until: () => sky.time + HOUR },
  { label: 'Until dawn',          until: () => nextHour(5.5) },
  { label: 'Until noon',          until: () => nextHour(12) },
  { label: 'Until dusk',          until: () => nextHour(19) },
  { label: 'Until midnight',      until: () => nextHour(0) },
  // the moon is full at a moment that may fall by day; rest on to that evening, when it's up
  { label: 'Until the full moon', moon: true, until: () => {
    const t = sky.time + moonAhead(frac((daysToNewMoon(sky.moonLon ?? 0, sky.sunLon ?? 0, sky.yearDays) - SYNODIC() / 2) / SYNODIC()) * SYNODIC());
    const h = hourOf(t);
    return h >= 6 && h < 20 ? t + (20 - h) * HOUR : t;
  } },
  { label: 'Until the new moon',  moon: true, until: () => sky.time + moonAhead(daysToNewMoon(sky.moonLon ?? 0, sky.sunLon ?? 0, sky.yearDays)) },
];
const restBtn   = document.getElementById('rest-btn');
const restPanel = document.getElementById('rest-panel');
let restOpen = false, rest = null, _restDrawT = 0;
const howLong = d => d < 1.5 * HOUR ? 'an hour' : d < 1 ? `${Math.round(d * 24)} hours` : d < 1.5 ? 'a day' : `${Math.round(d)} days`;
const moonNow = () => phaseName(sky.moonIllum ?? 0, Math.sin((sky.moonLon ?? 0) - (sky.sunLon ?? 0)) > 0);
const restHead = () => `<p class="now">${describeTime(sky.time)} ${cap(moonNow())}.</p>`;
function openRest(){
  restPanel.innerHTML = '<h3>PASS TIME</h3>' + restHead() + '<div class="opts"></div><div class="foot">click or press a number · R or Esc to close</div>';
  const list = restPanel.querySelector('.opts');
  REST_TO.forEach((o, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="key">${i + 1}</span>${o.label} <span class="for">${howLong(o.until() - sky.time)}</span>`;
    b.onclick = e => { e.stopPropagation(); startRest(i); };
    list.appendChild(b);
  });
  restPanel.classList.remove('hide'); restOpen = true;
  document.exitPointerLock?.();
}
function closeRest(relockAfter = false){ restPanel.classList.add('hide'); restOpen = false; if (relockAfter) relock(); }
function startRest(i){
  const o = REST_TO[i]; if (!o) return;
  const until = o.until();
  rest = { o, from: sky.time, until };
  if (until - sky.time > ROUGH_OVER) skipAhead(until - FULL_LAST - sky.time);
  restPanel.innerHTML = `<h3>PASSING TIME</h3><p class="now"></p><div class="track"><i></i></div><div class="foot">${o.label.toLowerCase()} · R or a step to stop</div>`;
  restOpen = false; _restDrawT = 0;
  try { canvas.requestPointerLock(); } catch (_){}   // look around while it passes
}
function stopRest(arrived){
  if (!rest) return;
  const o = rest.o; rest = null;
  restPanel.classList.add('hide');
  setForageMsg(arrived ? `${describeTime(sky.time)}${o.moon ? ` ${cap(moonNow())}.` : ''}` : 'You stop resting.', 4000);
}
// the frame's share: run world ticks until this frame's slice of the rest is done, or its
// time budget is spent (long rests go as fast as the machine allows)
// the rough part of a long rest: the clock, the sky, the moon and what regrows move on
// exactly; the folk don't live it. They're left as they were, and the last FULL_LAST of
// ticks walks them back into their day. So no hut goes up and no news spreads while you
// skip. Their meals move on with the clock, or everyone would wake starved of variety;
// fires are left as they were, as if their keepers kept them
function skipAhead(days){
  if (!(days > 0)) return;
  const s = days * sky.dayLength;
  sky.update(s, camera);
  agents.syncSky(sky);
  tickVitals(me, s);
  forage.update(s);                                // berries ripen, felled shrubs come back
  for (const q of agents.fauna) if (!q.alive) q.update(s);   // the rabbits come back (a live one would move: left be)
  trail.tick(s);                                   // the paths grass over
  myc.update(s, agents.time);
  for (const n of agents.npcs) if (n._diet) for (const g in n._diet) n._diet[g] += days;
  if (down){ const g = down.L.eels; if (g && g.stock < 1) g.stock = Math.min(1, g.stock + days); }
}
function restFrame(){
  if (!playing || inDialog || spellOpen || maps.bigOpen) return stopRest(false);
  const t0 = performance.now();
  while (performance.now() - t0 < REST_BUDGET){
    const left = (rest.until - sky.time) * sky.dayLength;
    if (left <= 0) break;
    const s = Math.min(REST_DT, left);
    sky.update(s, camera);
    tickVitals(me, s);                             // resting: spell points and breath come back
    worldTick(s, sky.spriteTint, false);
  }
  perf.sim += performance.now() - t0;
  if (sky.time >= rest.until) return stopRest(true);
  if (t0 - _restDrawT > 200){                      // the panel, a few times a second
    _restDrawT = t0;
    restPanel.querySelector('.now').textContent = `${describeTime(sky.time)} ${cap(moonNow())}.`;
    restPanel.querySelector('.track i').style.width = `${((sky.time - rest.from) / (rest.until - rest.from) * 100).toFixed(1)}%`;
    restPanel.classList.remove('hide');
  }
}
restBtn.addEventListener('click', e => {
  e.stopPropagation();
  if (rest) stopRest(false); else if (restOpen) closeRest(); else if (playing && !inDialog) openRest();
});
restPanel.addEventListener('click', e => e.stopPropagation());
// console: the clock and the moon, and the rest under way (if any)
window.leaRest = () => ({ hour: +hourOf(sky.time).toFixed(2), day: +sky.time.toFixed(3), moon: moonNow(), illum: +(sky.moonIllum ?? 0).toFixed(3),
  resting: rest && { to: rest.o.label, untilDay: +rest.until.toFixed(3) }, open: restOpen, sp: +me.sp.toFixed(1) });
function loop(now){
  meter.frameMs = now - last;
  if (perf.iv.length < 20000) perf.iv.push(meter.frameMs);   // frame intervals, for leaPerf's pacing
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  const _shift = keys.ShiftLeft || keys.ShiftRight, _walking = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD;
  const running = _shift && canRun(me) && !fly && !boating;
  if (playing){
    tickVitals(me, dt, { running: running && _walking, flying: fly && flyPaid && !down });
    if (fly && flyPaid && me.sp <= 0){ fly = false; flyPaid = false; setForageMsg('Your strength fails. You drift down.', 3500); }
    drawVitals();
  }
  const speed = (running || (_shift && fly) ? 16 : 8) * dt;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let dx = 0, dz = 0;
  if (keys.KeyW){ dx -= fx; dz -= fz; }
  if (keys.KeyS){ dx += fx; dz += fz; }
  if (keys.KeyA){ dx -= fz; dz += fx; }
  if (keys.KeyD){ dx += fz; dz -= fx; }
  const len = Math.hypot(dx, dz) || 1;
  dx = dx/len*speed; dz = dz/len*speed;
  if (rest) dx = dz = 0;                          // passing time: you stay put
  if (down){
    // underground: the level's own floor and walls; rough going in a cave
    const L = down.L;
    if (boating){                                   // on the cave's lake, in its canoe (as above: a canoe glides, can't sprint)
      const bdx = dx * 5 / 8, bdz = dz * 5 / 8;
      if (L.floats(upos.x + bdx, upos.z)) upos.x += bdx;
      if (L.floats(upos.x, upos.z + bdz)) upos.z += bdz;
      upos.y = L.cavern.lake.y + EYE_BOAT;
      camera.position.copy(upos);
      boating.placeAt(upos.x, upos.z, yaw);
      Object.assign(L.canoe, { x: upos.x, z: upos.z, yaw });   // (a rebuilt view finds it where you left it)
    } else {
      if (dx || dz){ const p = L.kind === 'cave' ? 0.8 : 1; walkPace += (p - walkPace) * Math.min(1, dt * 4); dx *= walkPace; dz *= walkPace; }
      if (L.walkable(upos.x + dx, upos.z)) upos.x += dx;
      if (L.walkable(upos.x, upos.z + dz)) upos.z += dz;
      L.moved?.(upos.x, upos.z);                      // the stair keeps track of which turn of which ramp you're on
      const groundY = L.floorAt(upos.x, upos.z) + EYE;
      upos.y = gfx.smooth && Number.isFinite(upos.y) ? upos.y + (groundY - upos.y) * Math.min(1, dt * 8) : groundY;
      camera.position.copy(upos);
    }
  } else if (fly){
    pos.x += dx; pos.z += dz;                       // no terrain clamp in fly cam
    if (keys.Space) pos.y += speed;
    if (keys.KeyQ) pos.y -= speed;
    camera.position.set(pos.x, pos.y, pos.z);
  } else if (boating){
    const k = 5 / 8;                                // a canoe glides; can't sprint (speed is the walk's, 8)
    const bdx = dx * k, bdz = dz * k;
    const floats = (x, z) => height(x, z) < WATER + 0.15;          // stay on the water; nose up to shore
    if (floats(pos.x + bdx, pos.z)) pos.x += bdx;
    if (floats(pos.x, pos.z + bdz)) pos.z += bdz;
    pos.y = WATER + EYE_BOAT;
    camera.position.set(pos.x, pos.y, pos.z);
    boating.placeAt(pos.x, pos.z, yaw);             // the boat rides under the camera
  } else {
    // the going underfoot slows or speeds you like everyone else (terrain.js pace),
    // eased so a grainy habitat border doesn't jolt the stride
    if (dx || dz){
      const p = pace(pos.x, pos.z, dx, dz);
      walkPace += (p - walkPace) * Math.min(1, dt * 4);
      dx *= walkPace; dz *= walkPace;
    }
    if (walkable(pos.x+dx, pos.z)) pos.x += dx;
    if (walkable(pos.x, pos.z+dz)) pos.z += dz;
    const [rx, rz] = agents.pushOut(pos.x, pos.z);   // slide out of a trunk, never stick
    if (walkable(rx, rz)){ pos.x = rx; pos.z = rz; }
    const groundY = height(pos.x, pos.z) + EYE;
    // smooth camera height (settings): ease toward the ground instead of riding
    // every bump, so small terrain wobble doesn't shift the low-res image a pixel.
    // High up (a flight just ended), drift down rather than drop.
    if (Number.isFinite(pos.y) && pos.y > groundY + 1.5) pos.y = Math.max(groundY, pos.y - 7 * dt);
    else pos.y = gfx.smooth && Number.isFinite(pos.y) ? pos.y + (groundY - pos.y) * Math.min(1, dt * 8) : groundY;
    camera.position.set(pos.x, pos.y, pos.z);
  }
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotateY(yaw); camera.rotateX(pitch);

  waterTex.offset.x = (now*0.000015) % 1;
  waterTex.offset.y = (now*0.00001) % 1;

  if (rest) restFrame();                           // passing time: many world ticks this frame

  // Lerp sky gradient toward storm grey before sky.update() so that background
  // colour, fog colour and dome shader all derive from the modified values.
  const _ri = rain.intensity;
  sky.domeU.uHorizon.value.copy(_skyHorizBase).lerp(_rainSkyHoriz, _ri);
  sky.domeU.uZenith.value.copy(_skyZenBase).lerp(_rainSkyZen,   _ri);
  sky.update(dt, camera);
  rain.update(pos.x, pos.y, pos.z, dt, sky.cloudCover, sky.wind);
  if (rain.intensity > 0 && sky.domeU) {           // darken clouds — rainclouds absorb light
    const cd = 1 - rain.intensity * 0.60;
    sky.domeU.uCloudLight.value.multiplyScalar(cd);
    sky.domeU.uCloudShadow.value.multiplyScalar(cd * 0.7);
  }
  const tint = sky.spriteTint;                     // daylight illumination for unlit sprites
  if (rain.intensity > 0)                          // darken sprites under storm clouds
    tint.multiplyScalar(1 - rain.intensity * 0.45).lerp(_rainTint, rain.intensity * 0.22 * sky.day);

  const simDt = playing ? dt : 0;                  // world is paused on the splash
  agents.threat = playing && !fly && !down ? { x: pos.x, z: pos.z } : null;   // rabbits flee the player too
  const _tAgents = performance.now();
  worldTick(simDt, tint, (dx || dz) && !fly && !down);
  perf.sim += performance.now() - _tAgents;
  if (playing) music.update(down ? 'rock' : terrainType(pos.x, pos.z), simDt);
  footsteps.update(simDt, {
    moving: !!(dx || dz) && !fly && !boating,
    running,
    terrain: down ? 'rock' : terrainType(pos.x, pos.z),
  }, down ? [] : npcApi.npcs, { x: pos.x, z: pos.z, yaw, terrainAt: terrainType });   // underground, nobody's footsteps but yours
  boats.update(simDt, now * 0.001);                  // bob the moored canoes
  if (playing) ambience.update(dt, down ? { here: { x: upos.x, z: upos.z, yaw }, fires: [], npcs: [], wind: 0, sea: { prox: 0, pan: 0 } }   // underground: the world's sounds die away
    : {                                              // fire / sea / wind / chopping
    here: { x: pos.x, z: pos.z, yaw },
    fires: agents.openFires, npcs: npcApi.npcs,
    wind: sky.wind ? sky.wind.length() : 0, sea: seaProx(),
  });
  // faced trees: eyes glow in while the tree is the examine target, coloured by its state
  treeFaces.update(dt, now, { examined: nearTree, night: sky.night ?? 0, tint: sky.spriteTint });
  if (gfx.grass && !down) grassDetail.update(pos.x, pos.z, now * 0.001, sky.groundTint);   // blades follow the viewer, sway, lit like the turf
  updateFocus();                                     // cursor-aimed: sets nearTalker / nearFruit + the box
  // hands tint: base sky tint darkened at night, then warmed by nearby lit fires
  let fireGlow = 0;
  for (const f of agents.openFires){
    if (!f.lit) continue;
    const fd = Math.hypot(pos.x - f.x, pos.z - f.z);
    const s = Math.max(0, 1 - fd / FIRE_LIGHT_RANGE);
    if (s * s > fireGlow) fireGlow = s * s;
  }
  if (down) _handsTint.copy(_torchTint);           // underground: only the torch lights them
  else _handsTint.copy(sky.spriteTint).lerp(_fireWarm, fireGlow * 0.88);
  hands.update(dt, { moving: !!(dx || dz) && !fly, running,
                     visible: playing && !fly && gfx.hands, tint: _handsTint });
  if (!down){                                         // the land's draw, skipped underground
    forage.billboardFruits(camera, sky.spriteTint, FOG_FAR + 20);
    fireworks.update(dt);                              // cross-app colour-bursts in the sky
    if (faerie.active){ tickSight(); faerie.update(dt, pos); }   // the salve's sight, while it lasts
    // send the GPU only the flora you could actually see: tiles inside the fog and
    // inside the view cone. Must run after the camera is placed for this frame.
    // +20: fog thickens with depth along the view, not distance, so trees off to the
    // side can sit past FOG_FAR and still show faintly (cutting at FOG_FAR lost them)
    cullFlora(camera, FOG_FAR + 20, cullOn);
    fireLights.update(agents.openFires, camera, FOG_FAR + 20);
    settleView.update(dt, { houses: agents.houses, night: agents.night, wind: sky.wind });   // lamplit windows, chimney smoke, woodpiles, crops   // also hides hearths lost in the fog
    ground.lod(camera, FOG_FAR + 20);                  // ground tiles past the fog draw coarse
  }
  if (down) down.view.update(dt, camera);            // the torch goes with you
  const _tDraw = performance.now();
  renderer.render(down ? down.view.scene : scene, camera);
  perf.draw += performance.now() - _tDraw;
  perf.calls = renderer.info.render.calls; perf.triangles = renderer.info.render.triangles;
  perf.frames++;
  hands.render(renderer);                            // overlay pass, on top of the world
  // desaturate the canvas when it rains — muted, wet-day look
  const _sat = down ? 1 : 1 - rain.intensity * 0.38;
  canvas.style.filter = _sat < 0.995 ? `saturate(${_sat.toFixed(3)})` : '';
  if (playing && !down) maps.updatePlace(pos.x, pos.z);
  if (down) maps.reveal(upos.x, upos.z);              // the automap fills in as you go
  talkView.update(simDt, pos.x, pos.z);              // after the camera moved this frame
  if (playing && down) tickFishing(dt);
  if (playing && !down){ tickFishing(dt); fishView.update(fishersNear(), agents.fishingWater || (agents.fishingWater = [...agents.fishing, ...agents.grounds]), pos.x, pos.z, dt, sky?.evening ?? 0); }
  if (playing && !down) maybeRemark(dt);
  const _me = down ? upos : pos;
  if (gfx.map) maps.drawMini(_me.x, _me.z, yaw);
  if (maps.bigOpen && now - _bigT > 150){ _bigT = now; maps.tickBig(_me.x, _me.z, yaw); }   // people move on the big map too
  tickMeter(meter.frameMs);
  if (showNpcDbg) npcDbg.textContent = agents.debugText(pos.x, pos.z);
  const _hudParts = [
    `x ${_me.x.toFixed(0)} z ${_me.z.toFixed(0)} yaw ${yaw.toFixed(2)}${fly && !down ? ' [fly]' : ''}`,
    `${npcApi.npcs.length} peasants`,
    `P: copy pose  ${DEBUG ? 'F: fly  ' : ''}B: npc  C: spells  I: pack  J: journal  R: rest`,
    nearFind    && `E: take the ${nearFind.kind}`,
    nearShelf   && (bookRecipe(nearShelf) ? 'E: read the book' : 'E: look at the shelf'),
    nearSconce  && `E: ${nearSconce.lit ? 'put out' : 'light'} ${LIGHT_VERB[nearSconce.kind || 'torch']}`,
    nearExit >= 0 && !nearFind && !nearSconce && !nearShelf && `E: climb out`,
    nearEntrance && `E: go down`,
    nearTalker  && `E: talk to ${nearTalker.name}`,
    nearFruit   && `E: gather ${nearFruit.kind}`,
    nearObject  && `E: examine`,
    nearTree    && (nearTree.faced ? `E: speak` : `E: examine`),
    nearRing    && `E: listen`,
    playerFish  ? `E: reel in` : nearFish && `E: fish here`,
    boating     ? (!nearFish && !playerFish && `E: step ashore`) : nearBoat && `E: board the boat`,
    basketText() && `basket: ${basketText()}`,
  ].filter(Boolean).join('  ·  ');
  const _hudMsgs = [poseMsg && `— ${poseMsg}`, forageMsg && `— ${forageMsg}`].filter(Boolean).join('  ');
  hud.textContent = _hudParts + (_hudMsgs ? `  ${_hudMsgs}` : '');
  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);
