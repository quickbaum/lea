import * as THREE from 'three';
import { TOUCH, stick, touchControls } from './touch.js';
import { SIZE, WATER, WORLD_SEED, WORLD_R, WORLD } from './config.js';
import { mulberry32, fork } from './rng.js';
import { height, biome, walkable, solidAt, buildTerrain, terrainType, treeCover, soilRichness, pace, setWearSource, settlements, road, ruins, under, roadBand, builtBand } from './terrain.js';
import { spawnPeasants, spawnNamedNPC } from './npc.js';
import { PuckFlock, setPuckObstacles } from './puck.js';
import { makeTrolls } from './troll.js';
import { loadSkeletonKit, makeSkeleton } from './skeleton.js';
import { makeGuards } from './skeleton-guards.js';
import { makeBolts } from './light-bolt.js';
import { Warren } from './fauna.js';
import { SheepView } from './sheep-view.js';
import { ShearHands } from './shear-hands.js';
import { shearable } from './shear.js';
import { StuckWatch, watchWorld } from './stuck.js';
import { habitat as habitatAt } from './terrain.js';
import { spawnFlocks, SHEEP } from './sheep.js';
import { flockOwners, flockLand, raiseCommons } from './flock-land.js';
import { hireShepherds } from './shepherd.js';
import { Sward } from './sward.js';
import { buildFolds } from './fold-view.js';
import { plantWorld, cullFlora, floraTilesDrawn, setFloraLod, makeFairyRing } from './gen/flora.js';
import { Footsteps } from './footsteps.js';
import { whoAnswers, answerWait, doorMood, onDoorSide } from './knock.js';
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
import { bagView } from './bag-view.js';
import { makeJournal } from './journal.js';
import { journalBlocks } from './journal-view.js';
import { makeBook } from './book-view.js';
import { describe as describeProv, THIN_R, DAWN, isDawn } from './provenance.js';
import { PREPARATIONS, prepWants, shelfBook, shelfCraft, wantsMet, daysToNewMoon, NEW_MOON } from './stillroom.js';
import { CRAFTS, canMake, needsText, teachCraft, goodsOf, takeGoods, addGoods } from './making.js';
import { houseName, phaseName } from './astrology.js';
import { makeVitals, tickVitals, canRun, spend, eat, eatValue, SP_MAX, ST_MAX } from './vitals.js';
import { vitalsView } from './vitals-view.js';
import { worth, isWild, isCrop, VALUABLES, ROAD_GOODS, isCraft, nameCraft } from './trade.js';
import { craftPic, designOf } from './craft-view.js';
import { traderSites, traderCount, TRADE } from './traders.js';
import { addFood, countOf, rawOf, rawKinds, addRaw, giveForDish } from './larder.js';
import { CampfireView, ShelterView, HutView, FireLights } from './campfire-view.js';
import { makeCookView } from './cook-view.js';
import { lantern } from './lantern.js';
import { ShrineView } from './shrine-view.js';
import { TrailField } from './trails.js';
import { buildRoad } from './road-view.js';
import { buildSettlements } from './settle-view.js';
import { buildRuins } from './ruins-view.js';
import { stairClearing } from './gen/under.js';
import { buildEntrances, buildLevelView, entranceHit, entranceAim, FAERIE_LIGHT } from './under-view.js';
import { createGlance } from './glance.js';
import { buildLevel } from './gen/under.js';
import { buildStairView, buildGroundsView } from './faerie-places-view.js';
import { juliaWarm } from './julia-tex.js';
import { walkOf, wayNote, roadFrom } from './ways.js';
import { GrassDetail } from './grass.js';
import * as wojak from './wojak.js';
import { faceParts, composeFace, composeHead } from './face.js';
import { dressFromPool } from './folk-pool.js';
const LEA_FACE_CARDS = false;   // painted face card over Lea sprites in-world (see below)
import { markBackdrop } from './kin-mark.js';
import { sampleFaceSkin } from './headscan.js';
import { generateCrown, PORTRAIT_SCALE, PORTRAIT_ANCHOR_X, PORTRAIT_BOTTOM_Y } from './crown.js';
import { makeSociety, makeHouseholds } from './society.js';
import { makeOmen, telescopeOf, giveTelescope, glassReading, glassHoard } from './astrology.js';
import { sightAt, NAMED_STARS } from './telescope.js';
import { talk, talkTree, loadTree, setVoicePlayer } from './dialog.js';
import { readPage } from './page.js';
import { FAERIE_BOOKS } from './faerie-books.js';
import { TUNES, MUSIC_BOOKS, shelfMusic, shelfTune, schedule } from './tunes.js';
import { phrasesKnown, phraseCount, knowsTune, knownSet, tunesOf, teachTune, instrumentOf, giveInstrument, craftsKnown, musicalCamp, fluencyOf, practiceGo } from './music-sim.js';
import { playTalk } from './play-talk.js';
import { DRUMS, parts, partNotes, liftFor, roughen } from './arrange.js';
import { staffSvg } from './notation.js';
import { Instruments } from './instruments.js';
import { makePuckGuide } from './puck-guide.js';
import { createHands } from './hands.js';
import { bakeMissing } from './spritebaker.js';
import { Rain } from './rain.js';
import { intakeRumor } from './rumor.js';
import { Fireworks } from './firework.js';
import { FaerieSight, OVAL } from './faerie-view.js';
import { planPortals, extraDoor, palaceSpec, portalPaths, buildFaerie, groundsSpec, stairSpec, GROUNDS, STAIR } from './gen/faerie.js';
import { planRoute } from './guide.js';
import { Mycelium } from './mycelium.js';
import { treeVoice, facedTreeVoice, ringTree, woodRumour } from './wood-talk.js';
import { TreeFaces } from './tree-faces.js';
import { createMaps } from './map.js';
import { closeX } from './close-x.js';
import { places, placeAt, placePhrase, settlementNames, farNames, ruinNames, underNames } from './gen/places.js';
import { makeTalkView } from './talk-view.js';
import { makeMail } from './mail.js';
import { makeTombRite } from './tomb-rite.js';
import { makePerfLog, sendPerfLog } from './perf-log.js';
import { treePieces } from './kin.js';
import { personBlocks, loadSkull } from './person-view.js';
import './kit/bub-lineage.js';       // the Bub's family tree (a link to the kit's own file: docs/skeletons.md)
import { buildJunctions } from './junction-view.js';
import { addNews } from './gossip.js';
import { nudge, regard } from './ties.js';
import { isMember, mayHear, atSecretRite } from './fellowships.js';
import { makeTosses } from './toss.js';
import { crisp } from './textures.js';

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
const junctionView = buildJunctions(scene, { junctions: settlements().junctions, nameOf: p => settlementNames()[settlements().places.indexOf(p)].name, height });                // the signpost and mailbox where each lane meets the road
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
  const ringRng = mulberry32((WORLD_SEED ^ 0xfa1e) >>> 0);   // its own stream: the circles' caps renumber nothing else
  for (const r of caps.slice(0, Math.max(1, Math.round(caps.length / 10)))){
    r.p.ring = true; r.p.ringNode = r.node;
    makeFairyRing(r.p, ringRng);                              // a circle of fairy mushrooms
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
lantern.attach(scene);                                    // yours, after dark
agents.setTrees(forage.trees);                             // so the hearth lands in a clearing
agents.setObstacles(forage.obstacles);                    // trunks & shrubs people walk around
setPuckObstacles((x, z, r) => agents.obstaclesWithin(x, z, r));   // and Puck hops round
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
agents.setFood(forage.plants.filter(p => !p.ring && p.kind !== 'elder'));   // bushes/trees double as food sources (the folk leave fairy rings be)
agents.setElders(forage.plants.filter(p => p.kind === 'elder'));            // stems for making instruments (making.js)
agents.setValuables(forage.valuables);                     // rare finds people gather & trade
agents.setFishing(fishingSpots({ height, walkable, water: WATER, radius: WORLD_R, habitat,   // places on the bank to fish (docs/fishing.md)
  rng: mulberry32((WORLD_SEED ^ 0xf15b) >>> 0) }),
  fishingGrounds({ height, water: WATER, radius: WORLD_R, rng: mulberry32((WORLD_SEED ^ 0xb0a7) >>> 0) }));   // …and out on the deep water, from a boat
const fishView = makeFishingView(scene, { water: WATER });
agents.setFlowers(forage.flowers || []);                   // wildflowers human women pick for crown-making
agents.setOnCrownMade(async (npc, flowerIds) => {
  const crownCanvas = await generateCrown(flowerIds);
  npc.wearCrown(crownCanvas);
  // The in-world sprite shows the crown via wearCrown. TODO: overlay the flower
  // crown on the painted-face portrait too (the old PORTRAIT_* params were tuned
  // for the 100×100 wojak portrait, not the new head template).
});
agents.setOnCrownWilted(npc => npc.takeOffCrown());
agents.spawnFauna();                                       // rabbits — quarry that roam, flee & are hunted (docs/hunting.md)
let warren = null;
new Warren(scene, agents.fauna).load().then(w => { warren = w; });   // draws the rabbits
const sheepView = new SheepView(scene, 150);               // and the sheep (docs/sheep.md); they're spawned once the bands exist
const _sheepTint = new THREE.Color();
function drawSheep(tint){
  let n = 0;
  sheepView.setHeld(-1);
  if (!down) for (const f of agents.flocks){
    if (!f.awake) continue;
    for (const s of f.sheep){
      if (n >= sheepView.capacity) break;
      lantern.warm(_sheepTint.copy(tint), s.x, s.z);
      if (s.held) sheepView.setHeld(n);
      sheepView.set(n++, s, height(s.x, s.z), _sheepTint);
    }
  }
  sheepView.setCount(n);
  if (n){
    sheepView.setLight({ sunDir: sky.sunDir });
    sheepView.shared.uSun.value.copy(sky.sunLight.color).multiplyScalar(sky.sunLight.intensity * 0.65);
    sheepView.update(performance.now() / 1000);
  }
}

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
// and the steps down to each crypt, worn bare around the well
for (const e of under().entrances) if (e.kind === 'stair'){ const c = stairClearing(e); trail.clearing(c.x, c.z, c.r); }
trail.flush();

// A fire laid by anyone clears the grass round it, the same way, for as long as it
// stands; once it's gone the ground grows back slowly. A house's hearth never comes
// here: it's indoors. r takes in the sitting circle, the woodpile and the basket.
const FIRE_CLEARING_R = 5;
agents.onFireLaid = f => { f.clearedCells = trail.clearing(f.x, f.z, FIRE_CLEARING_R); };
agents.onFireGone = f => { if (f.clearedCells) trail.release(f.clearedCells); f.clearedCells = null; };

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
const sward = new Sward();                                 // how short it's been eaten (docs/sheep.md)
grassDetail.sward = sward;
let foldView = null;

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
    // sheep are held in common by a band (docs/sheep.md, js/flock-land.js)
    spawnFlocks(agents, flockOwners(api.groups), mulberry32((WORLD_SEED ^ 0x5eef) >>> 0), flockLand(agents, sward));
    { const commons = raiseCommons(agents, trail);
      foldView = buildFolds(scene, commons.map(c => c.fold), commons.map(c => c.hut), height);
      // a shepherd speaks first (js/shepherd.js): within earshot, and not over a conversation you're in
      hireShepherds(agents, ((sky.time % 1) + 1) % 1, { sayAloud: (n, kind, line) => {
        if (down || document.getElementById('dlg-overlay') || n.convo || Math.hypot(n.x - pos.x, n.z - pos.z) > 35) return;
        talkView.say(n, { who: n, to: PLAYER, key: 'shepherd-' + kind, icon: kind === 'chased' ? 'cross' : 'hello', line });
      } }); }
    // the fellowships (js/fellowships.js, docs/fellowships.md): who belongs, and the stones they meet at
    { const rn = ruinNames();
      agents.setFellowships({ circles: ruins().map((u, i) => ({ u, i })).filter(q => q.u.kind === 'circle')
        .map(({ u, i }) => ({ x: u.x, z: u.z, r: u.rad || 10, name: rn[i].name })) }); }
    setLoad('painting faces…', 0.08);
    // Portraits first, then warmTrails. warmTrails pre-simulates synchronously and
    // triggers onCrownMade for any woman who gathers 7 flowers. onCrownMade is async
    // (awaits generateCrown), so it completes after warmTrails returns. If portraits
    // were generated AFTER warmTrails, wojak.ready() could overwrite a crown portrait
    // that onCrownMade had already set. Generating portraits first guarantees the
    // base portrait is always in place before onCrownMade overrides it with the crown.
    return wojak.ready().then(async () => {
      // human villagers wear characters from the pool baked ahead of time (js/folk-pool.js)
      // (a failure here must not stop the world loading: they keep their painted sheets)
      try { await dressFromPool(api.npcs, WORLD_SEED, (i, n) => setLoad(`dressing the folk… ${i}/${n}`, 0.08 + 0.1 * i / Math.max(1, n))); }
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
    perfLog?.mark('ready');
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
  // the fellowships sit the warm-up out: its nights are made up while the clock stands
  // still, so a member would spend tonight's one going-out (agents.js maybeRite) on one
  const fellowships = agents.fellowships; agents.fellowships = [];
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
  agents.fellowships = fellowships;
  trail.flush();
}

// No land music (2026-10-29): the only music is what's played, by you and by the folk
// (instruments.js), and the MUSIC slider sets its volume. music.js, the old terrain
// soundtrack, is kept but not loaded.
const footsteps = new Footsteps();
const ambience = new Ambience();
const instruments = new Instruments();
setVoicePlayer((kind, sched, o) => instruments.play(kind, sched, { ...o, voice: true }));   // a voiced speaker's words ring (dialog.js sing)
let tunePlaying = null;          // { id, kind, perf }: the tune you're playing (playTune, below)
const stopTuneBtn = document.getElementById('stop-tune');   // shown while you play; T does the same
stopTuneBtn.addEventListener('click', () => stopTune());

// While the splash is up the world is rendered but paused, and name tags hide.
let playing = false;
let inDialog = false;          // a conversation is open (keeps us 'in game', not menu)
let settingsOpen = false;      // the sound settings panel is open (also keeps us 'in game')

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
// just under the minimap's ring.
const hoverPanel = document.createElement('div');
hoverPanel.id = 'hover-panel';
hoverPanel.style.cssText = 'position:fixed;right:28px;top:320px;width:180px;height:90px;'
  + "border:10px solid;border-image:url('thin_dark_frame.png') 10 round;background:#1d1a14;"
  + "display:none;align-items:center;gap:8px;padding:6px;box-sizing:border-box;overflow:hidden;"
  + "font-family:Georgia,'Times New Roman',serif;color:#efe6cf;z-index:40;";
const hoverFace = document.createElement('img');
hoverFace.style.cssText = 'width:56px;height:56px;flex:0 0 56px;object-fit:cover;'
  + 'border:1px solid #c9a23a;border-radius:3px;background:#0c0e16;background-size:20px;';
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
const PUCK_REACH = 6;         // Puck bolts from anyone inside 7, so a little further off than anyone else
const SHEEP_REACH = 8;        // sheep move off at 7 and stop just past it, so you have to be able to reach one standing there
const LOOK_CONE = 0.97;       // ~14° cone: how near the cursor a target must sit
const ENTRANCE_REACH = 9;     // a cave mouth or the crypt stair: how far off your view can meet it and E still go down

// the single thing the cursor is pointed at drives BOTH the hover box and what
// E acts on, so they never disagree. We pick the talkable entity (Claude, Puck,
// any peasant) whose direction best lines up with where you're looking — not
// merely the nearest one. updateFocus() sets nearTalker / nearFruit and the box.
// how far along your gaze it meets door p's oval (faerie-view.js OVAL, a little generous), or -1
function portalHit(p){
  const nx = Math.cos(p.face), nz = Math.sin(p.face), c = camera.position;
  const den = _fwd.x * nx + _fwd.z * nz;
  if (Math.abs(den) < 1e-4) return -1;                // looking along its edge
  const t = ((p.x - c.x) * nx + (p.z - c.z) * nz) / den;
  if (t < 0) return -1;
  const hx = c.x + _fwd.x * t - p.x, hz = c.z + _fwd.z * t - p.z, hy = c.y + _fwd.y * t - p.y;
  const u = (-hx * nz + hz * nx) / OVAL[0], v = (hy - OVAL[1] - 0.1) / OVAL[1];
  return u * u + v * v <= 1.3 ? t : -1;
}
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

// everything above ground you might look at, as consider(x, z, eyeY, maxDist, data): the hover
// box and E pick from these, and so does the glance
const SIGN_AIM = 2.7, BOX_AIM = 1.5;   // how far above the ground you aim at them (units): the plank, and the box
function focusables(consider){
  // the box only reads something you're relatively close to (FRAME_RANGE);
  // E still only fires once within TALK_RANGE
  if (avatar) consider(avatar.x, avatar.z, height(avatar.x, avatar.z) + 1.0, FRAME_RANGE, { kind: 'person', c: avatar, dialog: 'claude', name: 'Claude' });
  if (puck && !(puck.aloof > 0)) consider(puck.x,   puck.z,   height(puck.x,   puck.z)   + 1.0, PUCK_REACH, { kind: 'person', c: puck,   dialog: 'puck',   name: 'Puck', reach: PUCK_REACH });
  for (const T of trolls){ const [x, z] = T.front(pos.x, pos.z); consider(x, z, height(x, z) + T.h * 0.59, FRAME_RANGE, { kind: 'person', c: T, dialog: T.dialog, name: T.name }); }
  for (const n of npcApi.npcs) if (!n._indoors)            // nobody indoors to be seen
    consider(n.x, n.z, height(n.x, n.z) + n.h * 0.6, FRAME_RANGE, { kind: 'person', c: n, peasant: true, name: n.name || 'a peasant', npc: n });
  // forageables: berries, shells, stones… (a strong mushroom ring is a talker
  // instead of a plain pick — the caps are the organism's mouth, and taking them
  // ends the conversation)
  for (const p of forage.pickables ? forage.pickables() : []){
    if (!p.ripe) continue;
    const m = p.aim();                                 // by the fruit itself: up in its tree, or down in the grass
    consider(p.x + m.dx, p.z + m.dz, height(p.x, p.z) + m.y, FRAME_RANGE,
      p.ring ? { kind: 'ring', item: p } : { kind: 'fruit', item: p });
  }
  // campfires (informational — not an E target)
  for (const fr of agents.openFires || [])
    consider(fr.x, fr.z, height(fr.x, fr.z) + 0.6, FRAME_RANGE, { kind: 'fire', fire: fr });
  // rabbits (informational)
  for (const q of agents.fauna || [])
    if (q.alive) consider(q.x, q.z, height(q.x, q.z) + 0.3, FRAME_RANGE, { kind: 'rabbit', q });
  // sheep (informational)
  if (!down) for (const f of agents.flocks)
    if (f.awake) for (const s of f.sheep){
      // one you could shear catches the eye, as Puck does. Short of wool, it's only there to read about, up close
      const ready = shearable(s) && !boating;
      consider(s.x, s.z, height(s.x, s.z) + 0.8, ready ? SHEEP_REACH : FRAME_RANGE, { kind: 'sheep', s, f, wool: ready ? s : null, reach: ready ? SHEEP_REACH : undefined });
    }
  // fishing spots: aim at the water off the bank (E casts, if you're on the bank)
  if (!boating && !playerFish)
    for (const sp of agents.fishing)
      if (Math.hypot(sp.x - pos.x, sp.z - pos.z) < 6) consider(sp.wx, sp.wz, WATER + 0.1, FRAME_RANGE + 3, { kind: 'fishspot', spot: sp });
  // moored boats (board with E) — only when you're not already aboard one
  if (!boating)
    for (const b of boats.list)
      if (!b.aboard) consider(b.x, b.z, WATER + 0.4, FRAME_RANGE, { kind: 'boat', boat: b });
  // a house door, from its own side of the house
  if (!boating)
    for (const h of agents.houses)
      if (onDoorSide(h, pos.x, pos.z)) consider(h.door.x, h.door.z, height(h.door.x, h.door.z) + 1.2, FRAME_RANGE, { kind: 'door', house: h });
  for (const b of agents.canoeBuilds)                // a canoe being made on the bank
    consider(b.x, b.z, height(b.x, b.z) + 0.3, FRAME_RANGE, { kind: 'canoe-bed', bed: b });
  // where a lane meets the road: its signpost, and its mailbox
  for (const q of junctionView.list){
    consider(q.j.x, q.j.z, height(q.j.x, q.j.z) + SIGN_AIM, FRAME_RANGE, { kind: 'sign', sign: q });
    consider(q.j.box.x, q.j.box.z, height(q.j.box.x, q.j.box.z) + BOX_AIM, FRAME_RANGE, { kind: 'mailbox', mailbox: q });
  }
  // shrubs: firewood, E to cut. They're everywhere, so they come last and only take the eye from nothing (updateFocus)
  if (!boating) for (const s of forage.shrubs)
    if (s.alive !== false && Math.abs(s.x - pos.x) < FRAME_RANGE && Math.abs(s.z - pos.z) < FRAME_RANGE)
      consider(s.x, s.z, height(s.x, s.z) + 0.6, FRAME_RANGE, { kind: 'shrub', shrub: s });
}

// you're out in the world: no panel has you. The look may be locked or the cursor free, since
// the keys walk and aim either way
function inWorld(){ return playing && !inDialog && !settingsOpen && !invOpen && !restOpen && !myBook.isOpen && !maps.bigOpen && !skyPicker._open; }

function updateFocus(){
  nearSheep = null; nearTalker = null; nearFruit = null; nearShrub = null; nearObject = null; nearBoat = null; nearTree = null; nearRing = null; nearFish = null; nearHouseDoor = null; nearSign = null; nearMailbox = null;
  nearTomb = null; nearWarden = false; nearEntrance = null; nearFind = null; nearExit = -1; nearSconce = null; nearShelf = null; nearPortal = null; nearDoor = null; nearChest = null;
  if (!inWorld()){ hoverPanel.style.display = 'none'; return; }
  if (down){ underFocus(); return; }
  camera.getWorldDirection(_fwd);

  // ONE cone pick across everything you might look at — people, forageables,
  // campfires — so the box and the E-target are always the same thing.
  let best = null, bestDot = LOOK_CONE, held = null;   // held: what the glance is on. It needn't be near the middle of the view
  const consider = (x, z, eyeY, maxDist, data) => {
    const { dist, dot } = focusAt(eyeY, x, z);
    if (dist < 0.4 || dist > maxDist) return;
    if (glance.target && glanceRef(data) === glance.target) held = { dist, ...data };
    if (data.kind === 'shrub' && best && best.kind !== 'shrub') return;   // anything else in the cone comes first
    if (dot > bestDot){ bestDot = dot; best = { dist, ...data }; }
  };
  focusables(consider);
  // a cave mouth, the crypt stair: aimed at by the opening itself (under-view
  // entranceHit), not a point near it — you look down into a stairwell. A hit
  // counts as near dead centre, so it wins unless someone stands in the way.
  for (const en of under().entrances){
    if (en.troll || Math.hypot(en.x - pos.x, en.z - pos.z) > 16) continue;   // the troll's: he's in the way
    if (en === glance.target) held = { dist: Math.hypot(en.x - pos.x, en.z - pos.z), kind: 'entrance', e: en };
    const t = entranceHit(en, camera.position.x, camera.position.y, camera.position.z, _fwd.x, _fwd.y, _fwd.z, ENTRANCE_REACH);
    if (t >= 0 && 0.99 > bestDot){ bestDot = 0.99; best = { dist: t, kind: 'entrance', e: en }; }
  }
  // a door into Faerie, seen with the salve on: aimed at by its oval, foot to crown (like
  // an entrance, a hit counts as near dead centre)
  if (sight) for (const pt of doors()){
    if (Math.hypot(pt.x - pos.x, pt.z - pos.z) > 16) continue;
    if (pt === glance.target) held = { dist: Math.hypot(pt.x - pos.x, pt.z - pos.z), kind: 'portal', p: pt };
    const t = portalHit(pt);
    if (t >= 0 && t <= FRAME_RANGE && 0.99 > bestDot){ bestDot = 0.99; best = { dist: t, kind: 'portal', p: pt }; }
  }
  if (held) best = held;

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
  if (best && best.dist <= (best.reach ?? TALK_RANGE)){
    if (best.kind === 'person') nearTalker = best;
    else if (best.kind === 'fruit') nearFruit = best.item;
    else if (best.kind === 'shrub') nearShrub = best.shrub;
    else if (best.kind === 'sheep' && best.wool && !best.s.held) nearSheep = best.s;
    else if (best.kind === 'fire') nearObject = best.fire;   // inspect the fire/pot with E
    else if (best.kind === 'boat') nearBoat = best.boat;      // climb aboard with E
    else if (best.kind === 'tree') nearTree = best.node;      // listen to a tree with E
    else if (best.kind === 'ring') nearRing = best.item;      // the fungus talks (and can be picked)
    else if (best.kind === 'door') nearHouseDoor = best.house;   // knock with E
    else if (best.kind === 'sign') nearSign = best.sign;         // read it with E
    else if (best.kind === 'mailbox') nearMailbox = best.mailbox;   // open it with E
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
    showText(label, best.npc?.postRider ? 'Carries the post along the road.' : best.npc?.trader ? (best.npc.trader.kind === 'music' ? 'Plays along the road, for their supper.' : 'Trades along the road.') : '', best.npc && best.npc.portrait, markBackdrop(best.npc?.group?.id));
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
    showText('A fairy ring', 'Violet caps in a circle. The rest of it is underfoot.', null);
  } else if (best && best.kind === 'rabbit'){
    showText('A rabbit', best.q.fleeing ? 'Bolting — wary of you.' : 'Grazing, ears twitching.', null);
  } else if (best && best.kind === 'sheep'){
    const doing = { run: 'Off with the others.', walk: 'Walking back to the others.', rest: 'Lying down, chewing.', graze: 'Head down, grazing.' }[best.s.mode];
    const wool = best.s.len < 0.25 ? ' Freshly shorn.' : shearable(best.s) ? '' : ' Its wool is growing back.';
    showText('A sheep', `${doing} One of the ${best.f.name} flock.${wool}`, null);
  } else if (best && best.kind === 'entrance'){
    showText(underNames()[best.e.level].name, best.e.kind === 'cave' ? 'A cave mouth. Cold air breathes out of it.' : `Steps going down ${STAIR_WHERE[best.e.site] || STAIR_WHERE.chapel}.`, null);
  } else if (best && best.kind === 'portal'){
    showText(cap(best.p.name), 'A door of nothing, standing in the air. Lights spiral into it, and out.', null);
  } else if (best && best.kind === 'door'){
    // what you can see from the step: a lamp shows after dark if someone's home (settle-view.js)
    const dark = (sky.night ?? 0) >= 0.5;
    showText('A door', !dark ? 'The door of a house.' : best.house.occupied ? 'There is lamplight in the window.' : 'The windows are dark.', null);
  } else if (best && best.kind === 'sign'){
    showText('A signpost', `It points up the lane: ${best.sign.name}.`, null);
  } else if (best && best.kind === 'mailbox'){
    showText('A mailbox', mailHolds(best.mailbox) ? 'Its flag is up. There are letters in it.' : 'Its flag is down.', null);
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
  } else if (best && best.kind === 'shrub'){
    showText('A shrub', 'Dry enough to burn.', null);
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
  if (puck && !(puck.aloof > 0)) check(puck.x, height(puck.x, puck.z) + 1.0, puck.z,
    { kind: 'person', c: puck, dialog: 'puck', name: 'Puck', reach: PUCK_REACH });
  for (const T of trolls){ const [x, z] = T.front(pos.x, pos.z); check(x, height(x, z) + T.h * 0.59, z, { kind: 'person', c: T, dialog: T.dialog, name: T.name }); }
  for (const n of npcApi.npcs) if (!n._indoors)
    check(n.x, height(n.x, n.z) + n.h * 0.6, n.z,
      { kind: 'person', c: n, peasant: true, name: n.name || 'a peasant', npc: n });
  for (const fr of agents.openFires || [])
    check(fr.x, height(fr.x, fr.z) + 0.6, fr.z, { kind: 'fire', fire: fr });
  if (!boating)
    for (const b of boats.list)
      check(b.x, WATER + 0.4, b.z, { kind: 'boat', boat: b });
  if (!boating && !down)
    for (const h of agents.houses)
      if (onDoorSide(h, pos.x, pos.z)) check(h.door.x, height(h.door.x, h.door.z) + 1.2, h.door.z, { kind: 'door', house: h });
  if (!down)
    for (const q of junctionView.list){
      check(q.j.x, height(q.j.x, q.j.z) + SIGN_AIM, q.j.z, { kind: 'sign', sign: q });
      check(q.j.box.x, height(q.j.box.x, q.j.box.z) + BOX_AIM, q.j.box.z, { kind: 'mailbox', mailbox: q });
    }

  if (best && bestDist3d <= (best.reach ?? TALK_RANGE)) {
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
      relock();
    };
    if (target.peasant){
      const tree = peasantTree(npc, sky, target.door);
      const onNav = (id) => {
        mapMark = null;
        if (target.door && id !== tree.root) target.door.said = true;   // past the greeting at the door
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
    sitAt(target.fire);
  } else if (target.kind === 'boat'){
    board(target.boat);
  } else if (target.kind === 'door'){
    knockAt(target.house);
  } else if (target.kind === 'sign'){
    readSign(target.sign);
  } else if (target.kind === 'mailbox'){
    openMailbox(target.mailbox);
  }
}

// where a lane meets the road (js/junction-view.js): the name, and how many live up it; and the box
function readSign(q){ setForageMsg(`${q.name}. Population ${mail.population(q.j)}.`, 6000); }
function openMailbox(q){
  inDialog = true; document.exitPointerLock?.();
  talkTree(mail.boxTree(q.j), { onClose: () => { inDialog = false; relock(); } });
}
const mailHolds = q => mail.boxes[junctionView.list.indexOf(q)].letters.length > 0;

// ---------- knocking at a house door (js/knock.js) ----------
// You knock, and wait on the step: someone indoors comes out to you and the talk opens,
// slowly and in a worse temper if you've got them out of bed. Walk off and the knock lapses.
const KNOCK_GIVE_UP = 10;   // further than this from the door, you've left
const KNOCK_STIR = 6;       // a wait longer than this gets a sound from inside partway through
let knock = null;           // { house, t, stir }: the door you're waiting at
function knockAt(house){
  if (knock) return;
  footsteps.knock();
  const who = whoAnswers(house), t = answerWait(who, (sky.night ?? 0) >= 0.5);
  knock = { house, t, stir: who && t > KNOCK_STIR ? t * 0.45 : -1 };
  setForageMsg('You knock at the door.', 2500);
}
function tickKnock(dt){
  if (!knock) return;
  const h = knock.house;
  if (down || boating || Math.hypot(h.door.x - pos.x, h.door.z - pos.z) > KNOCK_GIVE_UP){ knock = null; return; }
  knock.t -= dt;
  if (knock.stir >= 0 && knock.t <= knock.stir){ knock.stir = -1; setForageMsg('Something stirs inside.', 2500); }
  if (knock.t > 0 || inDialog || settingsOpen || maps.bigOpen || invOpen || myBook.isOpen || restOpen) return;   // they wait till you're free
  knock = null;
  const who = whoAnswers(h);                         // whoever's in now: the house has gone on without you
  if (!who){ setForageMsg('No one comes to the door.', 3000); return; }
  const dark = (sky.night ?? 0) >= 0.5;
  const door = { mood: doorMood(who, dark, voiceHas(who, 'door-kind', 0.35)), woken: who.sleeping, said: false };
  h.leave(who);                                      // comes to the door
  doInteract({ kind: 'person', c: who, peasant: true, name: who.name, door });
}

// ---------- inventory panel ----------
const invPanel = document.getElementById('inv-panel');
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
  if (e.use === 'play') return tunePlaying?.kind === kind ? 'Playing. Click it again to stop.' : tunesRead.size ? 'Click to play a tune on it.' : "Click to play it. You don't know a tune for it yet.";
  if (e.raw) return 'Raw: it wants a pot over a fire.';
  if (e.use === 'fire') return `${TOUCH ? 'Double-tap' : 'Right-click'} to lay a fire (${FIRE_LOGS} logs), or drag it onto a fire you're sat at to feed it.`;
  if (e.group === 'trinket') return 'A pretty thing, worth a trade.';
  if (e.use === 'unlock') return `A key. Aim at the door with its sign on it and ${TOUCH ? 'tap Use' : 'press E'}.`;
  if (e.use === 'look') return `${TOUCH ? 'Double-tap' : 'Right-click'} to look through it. Stargazers would give a great deal for it.`;
  return 'Not for eating as it is.';
}
// the line under the grid for a box: what it's good for, then where it came from (its
// oldest lot; how many other gatherings are mixed in with it)
function packSays(box){
  if (box.kind === 'letter'){ const l = mail.letterIn(box); if (l) return mail.says(l); }
  const lots = box.lots || [], more = lots.length - 1;
  return `${packUse(box.kind)} ${describeProv(lots[0] && lots[0].prov)}${more > 0 ? ` (With ${more} other ${more === 1 ? 'gathering' : 'gatherings'}.)` : ''}`;
}
const potFill = q => q == null ? 1 : 0.55 + 0.45 * q;   // a botched pot fills you less (as agents.js STEW_SATIETY)
function eatFromPack(box){
  const e = ingredient(box.kind) || {}, name = e.label || box.kind;
  if (e.use === 'sight') return useSalve(box);
  if (e.use === 'letter'){ const l = mail.letterIn(box); if (l) mail.lookAt(l); return ''; }
  if (e.use === 'look') return raiseGlass();
  if (e.use === 'play') return playFromPack(box);
  if (e.use === 'fire') return startPlacing();
  if (!edible(box.kind)) return packUse(box.kind);
  const g = eat(me, box.kind, agents.time, potFill(box.lots?.[0]?.prov?.q));
  myPack.takeFrom(box.id);
  return `You eat some ${name}: ${giveWords(g) || "you're as full of it as you'll get"}.`;
}
// the telescope (telescope.js; docs/telescope.md): raised to your eye you stand still and see
// the sky closer: the picture goes finer than the world's chunky pixels, the faint stars come
// out, the moon has a face. The wheel turns the magnification; a step, E or Esc lowers it.
const SCOPE_MAG = [4, 8, 16], SCOPE_PIXEL = 2, SCOPE_PITCH = 1.54;
let scope = null;
const scopeSeen = new Set();                     // the sights you've found (the journal says so once)
const scopeEl = document.createElement('div');
scopeEl.id = 'scope'; scopeEl.className = 'hide';
scopeEl.innerHTML = '<div class="scope-says"></div><div class="scope-mag"></div><div class="scope-aim"></div><div class="scope-star hide"></div>';
document.body.appendChild(scopeEl);
const [_scopeSays, _scopeMag, _scopeAim, _scopeStar] = scopeEl.children;
function setScopeMag(i){
  scope.i = Math.max(0, Math.min(SCOPE_MAG.length - 1, i));
  camera.zoom = SCOPE_MAG[scope.i]; camera.updateProjectionMatrix();
  _scopeMag.textContent = `${SCOPE_MAG[scope.i]}× ${TOUCH ? '' : ' · wheel to change · E to lower'}`;
}
function raiseGlass(){
  if (down) return 'Not down here. It wants the open sky.';
  if (boating) return 'Not from a boat. The stars would not hold still.';
  if (invOpen) closeInventory(true);
  scope = { i: 1, t: 0 };
  PIXEL = Math.min(gfx.pixel, SCOPE_PIXEL); resize();
  sky.setScope(gfx.pixel / PIXEL);
  scopeEl.classList.remove('hide'); document.body.classList.add('scoping');
  setScopeMag(1);
  scopeSaysNow();
  return null;
}
function lowerGlass(){
  if (!scope) return;
  scope = null;
  camera.zoom = 1;
  PIXEL = gfx.pixel; resize();                   // (resize takes the zoom back through the projection)
  sky.setScope(0);
  scopeEl.classList.add('hide'); document.body.classList.remove('scoping'); _scopeStar.classList.add('hide');
  pitch = Math.max(-1.3, Math.min(1.3, pitch));
}
// what's in the middle of the glass, in words: the moon, or one of the sights, or the state of the night
const _scopeDir = new THREE.Vector3();
function scopeSaysNow(){
  camera.getWorldDirection(_scopeDir);
  const moonDeg = Math.acos(Math.max(-1, Math.min(1, _scopeDir.dot(sky.moonDir)))) * 180 / Math.PI;
  const { ra, dec } = sky.aimOf(_scopeDir), dark = (sky.night ?? 0) > 0.5, clear = (sky.cloudCover ?? 0) < 0.85;
  let says = '';
  if (_scopeDir.y < 0.02) says = '';                                     // the far hills, only the far hills
  else if (moonDeg < 4 && sky.moonDir.y > -0.05) says = `The moon, ${moonNow()}, in the House of the ${houseName(sky.moonLon ?? 0)}.`;
  else if (!dark) says = 'Too bright for stars.';
  else if (!clear) says = 'Nothing but cloud.';
  else {
    const s = sightAt(ra, dec, 16 / SCOPE_MAG[scope.i] * 0.5);
    if (s){
      says = `${s.name}. ${s.says}`;
      if (!scopeSeen.has(s.name)){ scopeSeen.add(s.name); jot('saw', `${s.name.replace(/^The /, 'the ')}, through the telescope`); }
    }
  }
  _scopeSays.textContent = says;
}
// the named star nearest what you're pointing at gets its name beside it. Pointing is the middle
// of the glass while the look is locked, the mouse if it's free (a relock the browser refused).
const SCOPE_HOVER = 0.07;                        // how near it must be, as a share of the screen's short side
const _starDir = new THREE.Vector3();
let _mouseX = 0, _mouseY = 0;
addEventListener('mousemove', e => { _mouseX = e.clientX; _mouseY = e.clientY; });
function scopeHover(){
  camera.updateMatrixWorld();
  const short = Math.min(innerWidth, innerHeight), locked = document.pointerLockElement === canvas;
  const hx = locked ? innerWidth / 2 : _mouseX, hy = locked ? innerHeight / 2 : _mouseY;
  let best = null, bd = SCOPE_HOVER * short, bx = 0, by = 0;
  if ((sky.night ?? 0) > 0.5 && (sky.cloudCover ?? 0) < 0.85) for (const st of NAMED_STARS){
    sky.dirOf(st[1], st[2], _starDir);
    if (_starDir.y < 0) continue;                // set below the horizon
    const y = _starDir.y; _starDir.multiplyScalar(sky.R).add(camera.position).project(camera);
    if (_starDir.z >= 1 || y < 0) continue;      // behind you
    const x = (_starDir.x + 1) / 2 * innerWidth, yy = (1 - _starDir.y) / 2 * innerHeight, d = Math.hypot(x - hx, yy - hy);
    if (d < bd && Math.hypot(x - innerWidth / 2, yy - innerHeight / 2) < short * 0.43){ bd = d; best = st; bx = x; by = yy; }
  }
  _scopeStar.classList.toggle('hide', !best);
  if (!best) return;
  if (_scopeStar.dataset.name !== best[0]){ _scopeStar.dataset.name = best[0]; _scopeStar.innerHTML = `<b>${best[0]}</b> in ${best[3]}`; }
  _scopeStar.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px)`;
}
addEventListener('wheel', e => { if (scope) setScopeMag(scope.i + (e.deltaY < 0 ? 1 : -1)); }, { passive: true });
// the fairy salve (stillroom.js): touched to one eye after dark at a thin place, it
// shows what's in the Lea under glamour (faerie-view.js), the whole Lea over, until first
// light: the portals to the Gentry's palaces, the Gentry and their lights going between the
// thin places, and the whole of it in Faerie's own purple light. An
// ordinary crypt or cave puts it out; inside a palace it holds (docs/magic.md).
// Puck has something to say about it, and more the second time (the midwife's tale,
// docs/texts/magic-traditions.md §4: they take the eye that sees them).
let sight = null, salveUses = 0;
// every thin place in the Lea: the fairy rings, the stone circles, the sacred trees
const thinSpots = () => [...forage.plants.filter(q => q.ring).map(q => ({ kind: 'fairy ring', x: q.x, z: q.z, r: 3 })),
  ...ruins().filter(u => u.kind === 'circle').map(u => ({ kind: 'stone circle', x: u.x, z: u.z, r: u.rad || THIN_R })),
  ...agents.shrines.map(t => ({ kind: 'sacred tree', x: t.x, z: t.z, r: TREE_AT }))];
// the portals (gen/faerie.js), the palaces' own doors at a few of the thin places, and the
// paths between them: planned once, the first time anything asks
let _portals = null, _faerieSet = false;
function portals(){
  return (_portals ??= planPortals(thinSpots(), { seed: WORLD_SEED, size: SIZE, walkable, height }));
}
// and a door at every other thin place (gen/faerie.js extraDoor), each into the nearest
// palace: they were always there, and the salve only lets you see them
let _doors = null;
function doors(){
  if (_doors) return _doors;
  const own = new Set(portals().map(p => p.thin.join()));
  return (_doors = [...portals(), ...thinSpots().filter(t => !own.has([t.x, t.z].join()))
    .map(t => extraDoor(t, portals(), { walkable, height })).filter(Boolean)]);
}
function openSight(){
  if (!_faerieSet){ faerie.setWorld(doors(), portalPaths(doors(), (a, b, c, d) => planRoute(a, b, c, d, 'scenic'))); _faerieSet = true; }
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
  const puckSays = salveUses === 1 ? "Oh! You've the green salve on. See the door, just there? And more out across the Lea, where the lights go up. Look, then, but don't stare." : "Again? Mind they don't see you looking. They take the eye that sees them.";
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
// spell points and stamina, as the arcs round the minimap (health isn't drawn until something
// can hurt you: docs/magic.md)
const vitalsUI = vitalsView();
const vitalsEl = vitalsUI.el;
vitalsEl.classList.add('hide');
document.body.appendChild(vitalsEl);
function drawVitals(){
  vitalsEl.classList.remove('hide');
  bag.el.classList.remove('hide');
  vitalsUI.draw(me.sp / SP_MAX, me.st / ST_MAX, me.winded);
}
const packUI = packView(invPanel, myPack, { onEat: eatFromPack, says: packSays, onClose: () => sat ? getUp() : closeInventory(true), onDropOut: (box, ev) => !!sat && cook.drop(box, ev) });
// opening the pack frees the mouse (to drag and eat); closing it takes the look back
function openInventory(){
  packUI.render();
  invPanel.classList.remove('hide');
  bag.placeCard(invPanel);
  if (!invOpen) bag.openInto(invPanel);   // (this also runs to refresh a card that's already up)
  invOpen = true;
  if (sat) seatPack();
}
function closeInventory(relockAfter = false){ if (invOpen) bag.closeFrom(invPanel); invOpen = false; if (relockAfter) relock(); }
const togglePack = () => { if (sat) return; invOpen ? closeInventory(true) : openInventory(); };
const bag = bagView({ onClick: togglePack });
addEventListener('resize', () => { if (invOpen) openInventory(); });
// what's just been got flies from what you were looking at, or else from where you aim, to the bag
const _flyFrom = new THREE.Vector3();
function flyToBag(kind, n){
  const q = glance.at, r = canvas.getBoundingClientRect();
  if (q) _flyFrom.set(q.x, q.top ?? q.y, q.z).project(camera);
  const seen = q && _flyFrom.z < 1 && Math.abs(_flyFrom.x) < 1 && Math.abs(_flyFrom.y) < 1;
  bag.receive(kind, n, seen ? { x: r.left + (_flyFrom.x + 1) / 2 * r.width, y: r.top + (1 - _flyFrom.y) / 2 * r.height }
                            : { x: r.left + r.width / 2, y: r.top + r.height / 2 });
}
// put n of kind in the pack: true if any went in; says so if some or all didn't fit
function stow(kind, n, prov){
  const got = myPack.add(kind, n, prov);
  if (got < n) setForageMsg(got ? `+${got} ${kind}; no room in your pack for the rest.` : 'No room in your pack.', 3000);
  else if (ingredient(kind)?.use === 'play') setForageMsg(`You take the ${ingredient(kind).label}. Click it in your pack (I) to play it.`, 4000);
  else setForageMsg(`+${n} ${kind}`);
  if (invOpen) openInventory();
  if (got > 0) flyToBag(kind, got);
  if (got > 0 && (prov?.how === 'picked' || prov?.how === 'found')) jot(prov.how, (ingredient(kind) || {}).label || kind);
  return got;
}

// ---------- the journal (J): what came of the day, as a diary (js/journal.js) ----------
const journal = makeJournal(() => ({ t: agents.time, hour: (((sky.time ?? 0) % 1) + 1) % 1 * 24 }));
// something new in the Log: a dot on the book by the map (book.css)
const markJournal = () => document.body.classList.toggle('log-unread', journal.unread);
function openJournal(){ openBook('journal', { at: 'end' }); }     // a page of your own book, at its latest spread
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
}).then(a => { avatar = a; talkView.name(a, params.get('name') ?? 'Claude Opus 4.8', 'claude'); });

// Puck — a magical hopping creature who travels in winking-in-and-out bands.
// The leader is persistent and talkable; the band is ephemeral. See js/puck.js.
let puck = null, pucks = null, puckGuide = null;
// the trolls, each by the mouth of his cave (js/troll.js, dialogs/troll.json, dialogs/elder.json)
const trolls = makeTrolls(scene);
// come too close to one (troll.js tooClose) and he roars at you, in a bubble, and you jump back
// out of his reach: away from him, a hop and a few strides (more from the big one), not steered
let shove = null;          // { dx, dz, dist, hop, t, dur }
const ease = t => 1 - (1 - t) * (1 - t);
function roarAt(T){
  talkView.say(T, { who: T, key: 'roar', icon: 'cross', line: T.roar });
  const [dx, dz] = T.away(pos.x, pos.z);
  shove = { dx, dz, dist: 3 + 2.5 * T.scale, hop: 0.9, t: 0, dur: 0.5 };
}
new PuckFlock(scene, { x: -4, z: 13 }).load().then(f => {
  pucks = f; puck = f.leader; talkView.name(puck, 'Puck', 'puck');
  // Puck as a guide: "Where am I?" → somewhere to go → he leads you there (js/puck-guide.js)
  puckGuide = makePuckGuide({ flock: f, player: pos, say: line => talkView.say(puck, { who: puck, key: 'guide', icon: 'place', line, lilt: 'puck', hand: 'puck' }), finder: { kinds: findKinds, where: whereFound, thin: thinPlaces, salve: () => salveHeard }, friends: puckFriends,
    onArrive: d => { journal.arrive(destPlace(d), 'puck'); markJournal(); },
    onSetOff: () => { watchPuck = WATCH_PUCK; glance.startTurn(); } });
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
    if (PREPARATIONS[id]) for (const w of prepWants(id, madeOnce.has(id))) wanted.add(w.kind);
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
  const d = sight && nearestOf(doors(), x, z);     // with the salve on, the doors are thin places too
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
// `seen`: land you haven't seen shows nobody on it. Only mapMark ignores it: someone told you.
function drawMarks(ctx, toScreen, seen){
  ctx.fillStyle = '#fd4';
  for (const n of npcApi.npcs){ if (n._indoors || !seen(n.x, n.z)) continue; const [mx,my] = toScreen(n.x, n.z); ctx.fillRect(mx-1.5, my-1.5, 3, 3); }
  if (avatar && seen(avatar.x, avatar.z)){ const [ax,ay] = toScreen(avatar.x, avatar.z); ctx.fillStyle = '#6cf'; ctx.fillRect(ax-2, ay-2, 4, 4); }
  if (pucks){ ctx.fillStyle = '#e8c75a';
    for (const p of pucks.members){ if (!seen(p.x, p.z)) continue; const [px2,py2] = toScreen(p.x, p.z); const s = (p === pucks.leader) ? 4 : 2; ctx.fillRect(px2-s/2, py2-s/2, s, s); } }
  // faced trees — the speaking ones, marked as a small cross echoing their eyes
  for (const n of facedTrees){
    if (!seen(n.x, n.z)) continue;
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
document.getElementById('bigmap').append(closeX(closeBigMap, 'Close (M or Esc)'));

// ---------- first-person controls ----------
const start = document.getElementById('start');

const hud = document.getElementById('hud');
let yaw = 0, pitch = 0;
const WATCH_PUCK = 1.5;                            // s you're turned to follow Puck as he sets off, once the talk is over
let watchPuck = 0;
const glance = createGlance();                     // an offset on the camera, on top of yaw and pitch (js/glance.js)
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
// debug: the fellowships (js/fellowships.js) — where each meets, who belongs, who's out now
window.leaFellows = () => agents.fellowships.map(F => ({ name: F.def.name, secrecy: F.def.secrecy,
  at: F.site ? `${F.site.name} @${F.site.x | 0},${F.site.z | 0}` : `a fire near @${F.anchor.x | 0},${F.anchor.z | 0}`,
  members: F.members.map(n => n.name), out: F.members.filter(n => n.brain?._rite).map(n => `${n.name}${n.brain._rite.sat ? ' (sat)' : ''}`),
  nights: [...F.present.entries()].map(([o, h]) => `night ${o}: ${h.size}`) }));
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
// what a villager says they're up to in their croft (docs/farming.md)
function fieldTalk(npc, f, v){
  const c = f.crop;
  if (npc.actionLabel === 'reap') return v('d-reap', [`Getting the ${c} in. They're ready.`, `Bringing in the ${c}. Come back in an hour and it'll be bare earth.`, `Lifting the ${c}. A good year for them.`]);
  const job = f.job;
  if (job === 'sow') return v('d-sow', [`Sowing ${c}. It was something else here last year.`, `Getting the ${c} in. You don't put the same thing in the same ground twice running.`, `Sowing. ${c[0].toUpperCase() + c.slice(1)} this time.`]);
  if (job === 'stake') return f.needs === 'trellis'
    ? v('d-poles', ['Setting the bean poles. They need something to climb.', "Putting up poles. Beans won't get anywhere without them.", 'Poles for the beans. Hazel, off the woodpile.'])
    : v('d-sticks', ['Pushing in sticks for the peas.', "Peas'll lie in the mud without a bit of brush to climb.", 'Brush for the peas to hold on to.']);
  if (f.needs && f.supports < 1) return v('d-nopoles', [`Hoeing. I can't pole the ${c} till there's wood, and they've stopped growing.`, `The ${c} want poles and the stack's bare. I need to cut some.`]);
  return v('d-hoe', [`Hoeing the ${c}. The weeds don't stop.`, `Keeping the weeds off the ${c}.`, 'Hoeing. It never ends, this.']);
}
window.leaSettlements = i => {
  const S = settlements().places;
  if (i != null && S[i | 0]){ const [x, z] = S[i | 0].gate; pos.x = x; pos.z = z; pos.y = height(x, z) + EYE; }
  const names = settlementNames();
  return S.map((p, k) => ({ i: k, name: names[k].name, kind: p.kind, at: `${Math.round(p.x)},${Math.round(p.z)}`, buildings: p.buildings.length,
    households: agents.houses.filter(h => p.buildings.includes(h.b)).map(h => ({
      family: h.household[0]?.group?.name, people: h.household.map(n => `${n.name || '?'}${n._indoors === h ? ' (in)' : ''}${n.sleeping ? ' zz' : ''}`) })) }));
};
// the flocks (js/sheep.js): list them, or leaFlocks(i) to stand a little way off one
window.leaFlocks = i => {
  const F = agents.flocks, f = i != null && F[i | 0];
  if (f){ const x = f.anchor.x - 26, z = f.anchor.z; pos.x = x; pos.z = z; pos.y = height(x, z) + EYE; }
  return F.map((q, k) => ({ i: k, name: q.name, sheep: q.sheep.length, fold: q.fold ? `${Math.round(q.fold.x)},${Math.round(q.fold.z)} ${q.fold.open ? 'open' : 'shut'}, ${q.inside || 0} in` : null, shepherd: q.fold?.keeper ? `${q.fold.keeper.name}, ${q.fold.keeper.actionLabel || ''} at ${Math.round(q.fold.keeper.x)},${Math.round(q.fold.keeper.z)}` : null, hut: q.common ? `${Math.round(q.common.hut.x)},${Math.round(q.common.hut.z)}` : null, wool: { len: +(q.sheep.reduce((a, s) => a + s.len, 0) / q.sheep.length).toFixed(2), dirt: +(q.sheep.reduce((a, s) => a + s.dirt, 0) / q.sheep.length).toFixed(2), wet: +(q.sheep.reduce((a, s) => a + s.wet, 0) / q.sheep.length).toFixed(2) }, at: `${Math.round(q.cx)},${Math.round(q.cz)}`, home: `${Math.round(q.home.x)},${Math.round(q.home.z)}`, awake: q.awake, spread: +q.spread.toFixed(1), running: +q.runningShare.toFixed(2) }));
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
// underground, stand beside the first untaken find of a kind ('foxfire', 'cave salt', 'heart key'…), the lake's 'canoe',
// the first shut 'chest', or before the first locked 'door', facing it
window.leaFind = kind => {
  if (!down) return 'not underground';
  const L = down.L;
  if (kind === 'door'){                                    // the first locked door: in front of it, in the room
    const d = (L.doors || []).find(q => !q.open); if (!d) return 'no locked door here';
    const x = d.x - Math.cos(d.a) * 3, z = d.z - Math.sin(d.a) * 3;
    upos.set(x, L.floorAt(x, z) + EYE, z); yaw = Math.atan2(-Math.cos(d.a), -Math.sin(d.a)); pitch = 0;
    return `before the door of ${d.sign}`;
  }
  const f = kind === 'canoe' ? L.canoe : kind === 'chest' ? (L.chests || []).find(c => !c.open) : L.finds.find(f => !f.taken && f.kind === kind);
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
window.leaSeen = () => maps.seenShare;               // how much of the land you've seen, 0..1
// what folk say about places: the i-th peasant's "Where are we?" answer and news
window.leaAsk = (i = 0) => { const n = agents.npcs[i | 0]; if (!n) return null;
  return { at: placeAt(n.x, n.z).name, where: whereAreWe(n, (k, a) => voicePick(n, k, a)), news: newsReport(n, sky?.time ?? 0) }; };
window.leaCull = v => (cullOn = v !== false);   // leaCull(false) draws the whole world's flora — for measuring
window.leaGlance = handsOn => { if (handsOn) glance.handsOn(); return { locked: document.pointerLockElement === canvas, log: glance.log, handsOff: glance.handsOff, y: glance.y, p: glance.p, target: glance.target, yaw, pitch }; };   // the glance: `log` says what each stop did; leaGlance(true) forgets the mouse, for testing
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

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space' && document.pointerLockElement === canvas) e.preventDefault();   // a jump, not a click on whatever button last had focus
});
addEventListener('keyup',   e => keys[e.code] = false);
canvas.addEventListener('click', e => {
  if (!playing) {
    if (_worldReady) canvas.requestPointerLock();   // enter from splash
  } else if (document.pointerLockElement !== canvas) {
    if (!castAt(e.clientX, e.clientY)) tryClickInteract(e);   // cursor mode: a skeleton first, else click to interact or re-lock
  } else if (!scope) castAt(innerWidth / 2, innerHeight / 2);  // locked: at whatever's under the crosshair
});
start.addEventListener('click',  () => { if (_worldReady) canvas.requestPointerLock(); });
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('mouselook', locked);
  document.getElementById('look-btn').textContent = locked ? 'Esc to Click' : 'L to Look';
  if (locked) {
    glance.settle();
    document.body.classList.remove('cursor-mode');
    if (!playing) {
      // First entry into the game world
      playing = true;
      start.classList.add('hide');
      window.Leaves?.stop();
      footsteps.init(); ambience.init(); instruments.init();
    }
  } else {
    // a panel released the lock for itself, and takes the look back when it shuts; only a bare Esc leaves you in cursor mode
    if (inDialog || settingsOpen || maps.bigOpen || invOpen || myBook.isOpen || restOpen || !cheatEl.classList.contains('hide')) return;
    if (!playing) return;
    // Player pressed Escape — enter cursor mode (world keeps running)
    document.body.classList.add('cursor-mode');
    glance.handsOn();                                  // the mouse is a pointer now; it says nothing about how you look
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
  instruments.setVolume(volMusic); footsteps.setVolume(volSfx); ambience.setVolume(volSfx);
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
                       smooth: false, hands: true, map: true, meter: false,
                       // a phone: 4× of a 390-point screen would be a smear, and 2× is still fewer pixels than a desktop at 4×
                       ...(TOUCH ? { pixel: 2, draw: 90, lod: 35, sway: false } : {}) };
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

// dx, dy in radians, from the mouse or a thumb
function turnView(dx, dy){
  const _took = glance.manual(Math.hypot(dx, dy));   // really looking: the glance's offset becomes your own view
  if (_took){ yaw += _took.y; pitch += _took.p; watchPuck = 0; }   // (and it's yours again)
  const _slow = scope ? 1 / SCOPE_MAG[scope.i] : 1, _top = scope ? SCOPE_PITCH : 1.3;   // through a telescope a small move is a long way, and you can look straight up
  yaw -= dx*_slow;
  pitch = Math.max(-_top, Math.min(_top, pitch - dy*_slow));
}
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  turnView(e.movementX*0.0022, e.movementY*0.0022);
});
// the phone's controls (js/touch.js): a tap acts as a click does in cursor mode, on what's under the finger
const touchUI = touchControls(canvas, {
  look: turnView,
  tap: (x, y) => { if (!castAt(x, y)) tryClickInteract({ clientX: x, clientY: y }); },
  wake: () => { if (playing){ footsteps.init(); ambience.init(); instruments.init(); } },
});

// ---------- debug presence: pose-from-URL, fly cam, copy-pose ----------
const pos = new THREE.Vector3(0, 0, 20);
pos.y = height(pos.x, pos.z) + EYE;
let fly = params.has('fly');
const DEBUG = params.has('debug');
// ?perflog: record how the game runs on this machine, and send it home (js/perf-log.js)
let perfLog = null;
if (params.has('perflog')){
  let sendTo = null;
  perfLog = makePerfLog({ perf, renderer, send: (d, why) => sendTo?.(d, why), state: () => ({ ready: _worldReady, playing, level: down ? down.name : null, folk: npcApi ? npcApi.npcs.length : 0 }) });
  sendTo = sendPerfLog(perfLog);
}
if (params.has('x') || params.has('debug')){
  document.getElementById('start')?.classList.add('hide'); window.Leaves?.stop();
  playing = true;
  document.body.classList.add('cursor-mode');
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
let nearHouseDoor = null;  // a house whose door you're aiming at (E knocks)
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
    flyToBag(k, n);
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
let nearSign = null, nearMailbox = null;   // where a lane meets the road: read it, open it
let nearShrub = null;      // a shrub you could cut for firewood, with E
let nearSheep = null;      // a sheep with enough wool on it to shear, with E
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
  const facts = npc.news ? [...npc.news.values()].filter(f => mayHear(f, PLAYER)).sort((a, b) => rank(b) - rank(a) || b.t - a.t).slice(0, 3) : [];
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
const PLAYER = { player: true, fellowships: new Map() };   // fellowships you belong to (fellowships.js; joining is to come)
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
  if (kin && to?.group === sp.group) return PARENT[rel] || given;
  const knows = (to?.group && to.group === o.group) || (to?.ties?.get(o)?.fam || 0) > 0.15;   // (no `to`: a letter to Faerie, a stranger to all of them)
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
  } else if (f.kind === 'tune'){
    const inst = ingredient(f.subj.instrument)?.label || 'pipe';
    line = f.subj === sp ? `I can play ${f.tune} now, on my ${inst}.`
         : src ? `${src} ${says} ${who} plays ${f.tune} now.` : `${who} plays ${f.tune} now, on ${pron(f.subj, true)} ${inst}.`;
  } else if (f.kind === 'dish'){
    line = f.subj === sp ? `I make ${f.recipe} now, from an old book${tail(when)}.`
         : src ? `${src} ${says} ${who} makes ${f.recipe} now, from an old book.` : `${who} makes ${f.recipe} now, from an old book.`;
  } else if (f.kind === 'sign'){
    const at = f.place || where;
    line = f.what === 'went'
      ? (src ? `${src} ${says} ${who} went off in the night, toward ${at}.` : vp('sg1', [`I saw ${who} go off in the dark${tail(when)}, toward ${at}.`, `${who} went out in the night${tail(when)}. Toward ${at}, it looked like.`]))
      : (src ? `${src} ${says} there were folk out at ${at} in the night.` : vp('sg2', [`There were folk at ${at} in the night${tail(when)}. Just sitting there in the dark.`, `I saw people out at ${at} in the night${tail(when)}. Sitting in a ring, not talking.`]));
  } else if (f.kind === 'fellow'){
    line = fellowLine(sp, f, src, says, where, when);
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
// what a fellowship's own say of its meeting (agents.js endRite): a member says "we", anyone
// else passes it on. Only told where mayHear allows (a secret one, only to its own).
function fellowLine(sp, f, src, says, where, when){
  const mine = isMember(sp, f.fid);
  if (f.fid === 'night-company') return mine ? `We kept the stones${tail(when)}. ${cap(numWord(f.n))} of us.` : `${src || 'They'} ${says} the stones were kept.`;
  if (f.fid === 'fiddlers') return mine ? `The fiddlers met at the full moon${tail(when)}, ${where}. ${cap(numWord(f.n))} of us played.`
    : `${src || 'They'} ${says} the fiddlers met at the full moon. ${cap(numWord(f.n))} of them played.`;
  return '';
}
const numWord = k => ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][k] || String(k);

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
  if (f.kind === 'sign') return f.what === 'went'
    ? (!src ? `I saw ${who} go off in the dark.` : `${src} saw ${who} go off in the night.`)
    : (!src ? `There were folk out at ${f.place || 'the stones'} in the night.` : `${src} says there were folk at ${f.place || 'the stones'} in the night.`);
  if (f.kind === 'fellow') return isMember(sp, f.fid)
    ? (f.fid === 'night-company' ? 'We kept the stones.' : 'The fiddlers had a good meet.')
    : (f.fid === 'night-company' ? `${src || 'Someone'} says the stones were kept.` : `${src || 'Someone'} says the fiddlers met.`);
  if (f.kind === 'market'){
    const deal = `${qty(f.qn, f.get)} for ${qty(f.gn, f.give)}`, at = villageOf(f.house);
    return f.subj === sp ? `I got ${deal} at ${at}.` : `${who} got ${deal} at ${at}.`;
  }
  if (f.kind === 'tune') return f.subj === sp ? vp('tt0', [`I can play ${f.tune} now.`, `I've learnt ${f.tune}.`])
    : !src ? `${who} plays ${f.tune} now.` : `${src} says ${who} plays ${f.tune} now.`;
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
  if (kind === 'salt') return n === 1 ? 'a measure of salt' : `${num(n)} measures of salt`;
  if (kind === 'wire') return n === 1 ? 'a coil of wire' : `${num(n)} coils of wire`;
  if (kind === 'gut') return n === 1 ? 'a length of gut' : `${num(n)} lengths of gut`;
  if (kind === 'iron') return n === 1 ? 'an iron blade' : `${num(n)} iron blades`;
  if (kind === 'board') return n === 1 ? 'a seasoned board' : `${num(n)} seasoned boards`;
  const one = kind === 'berries' ? 'berry' : kind === 'cattail root' ? kind : kind.replace(/s$/, '');
  return n === 1 ? `${/^[aeiou]/.test(one) ? 'an' : 'a'} ${one}` : `${num(n)} ${goods(kind)}`;
}
// the kind said as goods: "acorns", "cattail roots", "pretty things"
const goods = kind => isCraft(kind) ? ingredient(kind)?.label || kind : kind === 'trinket' ? 'pretty things' : kind === 'iron' ? 'iron blades' : kind === 'board' ? 'seasoned boards' : kind === 'hide' ? 'hides' : kind === 'cattail root' || kind === 'shell' || kind === 'stone' ? kind + 's' : kind;
function tradeLine(m, sp){
  const v = (k, arr) => voicePick(sp, k, arr), N = n => cap(num(n));
  switch (m.key){
    case 'tr-cry':     { const [a, b] = (m.wares || []).map(goods), w = a ? cap(a) + (b ? ` and ${b}` : '') : null;
      return w ? v('tr-cry', [`${w}! Who's short?`, `${w}, here at the well!`, `${w}! Come and see!`]) : 'Come and see!'; }
    case 'tr-wares-ask': return v('tr-wares-ask', ["What've you got?", 'What are you selling?', "What's in the pack?"]);
    case 'tr-wares':   return m.item ? v('tr-wares', [`${cap(goods(m.item))}, if you're short.`, `I've ${goods(m.item)}, just off the road.`, `${cap(goods(m.item))}, and a fair price.`]) : 'Not much left, truth be told.';
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
  'i-practice':    ['Going off to practice.', 'Off to work at a tune.'],
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
  'crown-nice':    ["That's a lovely crown.", 'Nice flowers.', 'I like your crown.', 'Those flowers suit you.'],
  'crown-thanks':  ['Thank you.', 'Thanks. I made it myself.', 'Thanks. Seven flowers, it took.'],
  'crown-wilting': ["Thanks. It's starting to wilt.", "Thanks. It won't last much longer."],
  'crown-yours':   ['Yours too.', "So's yours."],
  'q-crown-where': ['Where did you get those flowers?', 'Where did you find those flowers?'],
  'crown-pretty':  ["They're lovely.", 'Pretty things.'],
  's-crown':       ['I made this crown myself.', 'Seven flowers, this crown took.'],
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
  if (m.key === 'a-crown-where') return `I picked them ${whereSaid(sp, m.x, m.z)}.`;
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
    .filter(f => mayHear(f, PLAYER) && !told.has(f.key + f.t) && !(f.kind === 'saw' && f.subj && Math.hypot(f.subj.x - pos.x, f.subj.z - pos.z) < 20))
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
// the post (js/mail.js, docs/letters.md)
loadSkull();
const mail = makeMail({ regardOfMe: n => regard(n, PLAYER), markBackdrop, crypts: () => under().levels.filter(l => l.kind === 'crypt').map(l => ({ id: l.id, floors: l.floors, name: underNames()[l.id].name, x: l.mouths[0].x, z: l.mouths[0].z })), level: id => { if (!levels.has(id)) levels.set(id, buildLevel(under().levels[id])); return levels.get(id); },
  seed: WORLD_SEED, settlements, settlementNames, farNames, road, walkable, npcs: () => npcApi?.npcs || [], villageOf: h => villageOf(h), portals: () => portals(), houses: () => agents.houses,
  now: () => agents.time, pack: myPack, stow, jot, journal, provHere, displayName: n => displayName(n), whereWord: (a, b, c, d) => whereWord(a, b, c, d),
  factLine: (a, b, c, d) => factLine(a, b, c, d), addNews, nudge, markAlbum: () => markJournal(), refreshBook: () => myBook.refresh(), setMsg: t => setForageMsg(t, 4000), touch: TOUCH });
agents.post = mail.folk;                               // the folk work the boxes too (js/mailboxes.js)
// each settlement's handiwork: its name, and its picture (js/craft-view.js, docs/economy.md)
for (const s of agents.crafts){ nameCraft(s, settlementNames()[s.place]?.name || 'village', designOf(s)); craftPic(s, url => { ingredient(s.kind).pic = [url]; }); }
// the traders (js/traders.js, docs/economy.md): a few of the folk work the road for what they can make on it
agents.startTraders({ seed: WORLD_SEED, count: traderCount(SIZE), musicians: 1, road: road(), keepOf: k => ingredient(k)?.keep ?? 3,
  sites: traderSites({ S: settlements(), road: road(), walkable, radius: WORLD_R, houses: () => agents.houses, placeNames: settlementNames(), farNames: farNames() }),
  // leaving, they say where for, to whoever's near enough to hear (as a shepherd speaks first)
  setOff: (n, q) => {
    if (down || document.getElementById('dlg-overlay') || n.convo || n._indoors || Math.hypot(n.x - pos.x, n.z - pos.z) > 35) return;
    talkView.say(n, { who: n, to: PLAYER, key: 'trader-off', icon: 'hello', line: `Well, I'm off to ${q.name}!` });
  } });
window.leaTraders = () => agents.traders.list.map(t => ({ name: t.who.name, at: t.at, bound: t.bound, x: Math.round(t.who.x), z: Math.round(t.who.z), stock: t.stock, deals: t.deals,
  gain: +t.gain.toFixed(1), wealth: [+t.wealth0.toFixed(1), +agents.traders.wealth(t, agents.time).toFixed(1)], places: t.seen.size, doing: t.who.actionLabel }));
window.leaEconomy = () => ({ traders: agents.traders.stats, last: (agents.traders.log || []).slice(-10).map(r => `${r.folk.name} ${r.house ? 'at ' + villageOf(r.house) : 'on the road'}: ${qty(r.gn, r.gave)} for ${qty(r.qn, r.got)}`),
  shelfEaten: agents.market.eaten || 0, trades: agents.market.trades.length, houses: agents.houses.map(h => `${villageOf(h)}: ${Object.entries(h.spare).filter(([, n]) => n > 0).map(([k, n]) => n + ' ' + k).join(', ') || 'nothing'}${Object.keys(h.goods).length ? ' + ' + JSON.stringify(h.goods) : ''}`) });
window.leaPost = () => ({ ...mail.folk.stats, time: agents.time, day: agents.day, evening: agents.evening, carrier: mail.folk.ride.who?.name, at: mail.folk.ride.who && [Math.round(mail.folk.ride.who.x), Math.round(mail.folk.ride.who.z)], bag: mail.folk.ride.bag.length, jobs: [...mail.folk.jobs].map(([n, j]) => `${n.name}: ${j.kind}`) });
// debug: leaMail() the state; leaMailTalk(npc) opens a real talk with them; leaMailNpcs() who has a home
window.leaMailNpcs = () => agents.npcs.filter(n => n.home);
window.leaMailTalk = n => { inDialog = true; talkTree(peasantTree(n, sky), { onClose: () => { inDialog = false; } }); };
window.leaWarden = () => talkToWarden();
// debug: leaDeadLetter() takes one from the Warden's real talk; leaFaceTomb(right) stands you at its tomb (or the wrong one) in its crypt
window.leaDeadLetter = () => { for (let i = 0; i < 3; i++){ const t = mail.wardenTree(), c = t.nodes.root.choices[0]; if (!c) break; c.run?.(); const o = t.nodes[c.next], y = o.choices?.[0]; if (!y) return o.text; y.run?.(); const l = [...mail.post.letters.values()].find(x => x.state === 'carried' && x.to.dead); if (l) return { to: l.to.name, where: l.to.cryptName, stamps: l.stamps.map(q => `${q.realmName} ${q.value}`), says: o.text }; } return null; };
window.leaFaceTomb = (right = true) => { const l = [...mail.post.letters.values()].find(x => x.state === 'carried' && x.to.dead), id = +l.to.realm.slice(5); goDown({ level: id, mouth: 0 }); const L = down.L, tombs = L.props.filter(p => p.kind === 'coffin'), p = tombs.find(q => !!mail.letterAt(L, q) === right); upos.set(p.x + Math.sin(p.a) * 3, L.floorAt(p.x + Math.sin(p.a) * 3, p.z - Math.cos(p.a) * 3) + EYE, p.z - Math.cos(p.a) * 3); yaw = Math.atan2(-(p.x - upos.x), -(p.z - upos.z)); pitch = -0.2; window.leaTombP = p; return { at: [p.x, p.z], walk: L.walkable(upos.x, upos.z) }; };
window.leaUseTomb = () => { useTomb(window.leaTombP); return { msg: document.getElementById('forage-msg')?.textContent, busy: tombRite?.busy, inDialog }; };
window.leaUseTombBusy = () => !!tombRite?.busy;
window.leaKin = () => ({ lines: mail.kin().lineages.map(L => `${L.surname}: ${L.people.length}`), trees: mail.kinTrees() });
window.leaPackOpen = () => { document.exitPointerLock?.(); openInventory(); };
window.leaWardenAt = () => ({ at: WARDEN_AT, placed: !!wardenSprite?.parent, near: nearWarden, here: down?.L.id });
window.leaFaceWarden = () => { const { x, z } = WARDEN_AT; upos.set(x, down.L.floorAt(x, z + 3) + EYE, z + 3); yaw = Math.atan2(-(x - upos.x), -(z - upos.z)); pitch = 0; };
window.leaBook = id => openBook(id);
window.leaFaceJunction = (i, what = 'mailbox') => { const q = junctionView.list[i], t = what === 'sign' ? q.j : q.j.box, a = what === 'sign' ? SIGN_AIM : BOX_AIM, d = 3; pos.x = t.x + Math.cos(q.j.box.a) * d; pos.z = t.z + Math.sin(q.j.box.a) * d; pos.y = height(pos.x, pos.z) + EYE; yaw = Math.atan2(-(t.x - pos.x), -(t.z - pos.z)); pitch = Math.atan2(height(t.x, t.z) + a - pos.y, d); };
window.leaAfar = (far = 'far0') => { const n = agents.houses.find(h => h.household.length)?.household[0], l = n && mail.fromAfar(far, n); if (l) mail.lookAt(l); return l && { id: l.id, from: l.from.name, fromLine: l.fromLine, to: l.toLines, stamps: l.stamps.map(s => `${s.realmName} ${s.value} ${s.design}`), body: l.body }; };
window.leaBoxes = () => junctionView.list.map((q, i) => ({ name: q.name, at: [Math.round(q.j.x), Math.round(q.j.z)], pop: mail.population(q.j), flag: q.up, letters: mail.boxes[i].letters.map(l => `${l.from.name} → ${l.to.name}`) }));
window.leaMail = () => ({ letters: [...mail.post.letters.values()].map(l => `${l.id} ${l.state}: ${l.from.name} → ${l.to.name}, ${l.stamps.map(s => `${s.realmName} ${s.value}`).join(' + ')}`),
  stock: [...mail.post.issues.values()].map(s => `${s.id} ${s.left}/${s.printed} ${s.design}`), album: mail.album.length });
function villageOf(h){
  const S = settlements().places, k = h ? S.findIndex(p => p.buildings.includes(h.b)) : -1;
  return k >= 0 ? settlementNames()[k].name : 'the village';
}
// A peasant's dialogue is assembled live from its drives + surroundings, phrased in
// the NPC's own voice (see above). It's a window on the NPC's state: what it's
// doing, how it feels (its strongest unmet drive), and the sky.
function peasantTree(npc, sky, door = null){   // door: come to their door at your knock ({ mood, woken, said }, knockAt)
  const n = npc.needs || {};
  const v = (key, arr) => voicePick(npc, key, arr);     // pick this NPC's phrasing
  const fem = npc.gender === 'female';
  const Pron = fem ? 'She' : 'He', pron = fem ? 'she' : 'he', their = fem ? 'her' : 'his';
  const T = agents.traders, tr = npc.trader;
  const stockList = () => Object.entries(tr.stock).filter(([k, m]) => m > 0).map(([k, m]) => `${num(m)} ${goods(k)}`).join(', ');
  const placeName = id => T.stops.find(q => q.id === id)?.name;
  // what they're up to, in a word (the "What are you doing?" line)
  const traderSays = () => {
    const to = placeName(tr.bound), at = placeName(tr.at), far = T.stops.find(q => q.id === tr.bound)?.far;
    if (tr.kind === 'music') return tr.crying ? v('d-busk', [`Playing, here by the well. Folk give what they can.`, `Playing for my supper. ${at ? `${at} hasn't` : "They haven't"} had a tune in a while.`])
      : to ? v('d-busk-go', [`On to ${to}, to play.`, `Walking to ${to}. They'll want a tune there, I should think.`]) : v('d-busk-idle', ["Resting my fingers.", 'Between places.']);
    if (tr.crying) return v('d-trader-cry', [`Selling, here at the well. I've ${stockList() || 'not much left'}.`, `Crying my wares. Folk come over if they're short of something.`]);
    return to ? v('d-trader-go', [far ? `On down the road, to ${to}. They'll give me a good deal more for this lot there.` : `On to ${to}. There's folk there short of what I've got.`, `${to} next. I've ${stockList() || 'not much left'} to shift.`])
      : v('d-trader-at', [`Trading. I've ${stockList() || 'not much left'}.`, `Calling at a few doors${at ? ` round ${at}` : ''}. Not everyone hears me at the well.`]);
  };
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
  const fr = npc.actionLabel === 'rite' && npc.brain?._rite;
  const onRound = agents.rounds?.find(r => r.holders.has(npc))?.says(npc);   // a day's round says what it's for (plans.js dayRound)
  const doing = onRound ? v(onRound.key, onRound.lines) : npc.actionLabel === 'practice' ? v('d-practice', [npc.practice ? `Working at ${npc.practice.id}. I come out here so nobody has to hear it.` : "Going off to practice. Nobody wants to hear that by the fire.", npc.practice ? `Practicing ${npc.practice.id}. It doesn't go right yet.` : "Off to practice, where it's quiet."])
    : npc.actionLabel === 'observe' ? v('d-observe', ["Up at the sky with my telescope. Don't jog my arm.", 'Looking. It takes hours, and the night is short enough.', 'Counting stars. There are more of them than you would think.'])
    : fr && fr.F.id === 'fiddlers' ? (fr.sat ? v('d-fiddlers', ["It's the fiddlers' meet. Full moon, and everyone's brought something to play.", "The fiddlers' meet. We play the night through, when the moon's full."])
                                                       : v('d-fiddlers-go', ["Off to the fiddlers' meet. It's the full moon.", "Going to the fiddlers' meet. Come and listen, if you like."]))
    : npc.actionLabel === 'canoe-work' ? v('d-canoe', ["Making a canoe. The bark's on. Now it's the ribs and the seams.", "Sewing the canoe. It goes quicker with two.", "Working on the canoe. It takes days."])
    : npc.actionLabel === 'peel-bark'  ? v('d-bark', ["Peeling birch bark. It's for a canoe.", "Getting bark off this birch, for the canoe.", "Bark for a canoe. It comes away in a sheet if you're careful."])
    : npc.actionLabel === 'canoe-bring'? v('d-cbring', ["Taking this to the canoe.", "This is for the canoe down by the water."])
    : (npc.actionLabel === 'farm' || npc.actionLabel === 'reap') && npc.home?.field ? fieldTalk(npc, npc.home.field, v)
    : npc.chopping              ? v('d-chop', ["Cutting firewood — the woodpile's run low.", "Felling a shrub for the fire. Hungry work.", "Wood for the hearth. It never stops needing it."])
    : npc.sitting && npc.atGathering ? v('d-gather', ["Sitting at the night fire with the others — there's a song going, and old talk.", "By the fire with my people — songs and stories till the dark wears thin.", "Round the night fire. This is the best of the day, if you ask me."])
    : npc.sitting                  ? v('d-sit', ["Sitting by the fire, warming my hands.", "Resting by the hearth a while.", "Just warming myself — the cold gets in the bones."])
    : npc.actionLabel === 'chop'   ? v('d-gochop', ["Off to cut some wood for the fire.", "Going to fell a shrub — the fire's hungry.", "After firewood."])
    : npc.actionLabel === 'stack'  ? v('d-stack', ["Stacking firewood by the hearth for us all.", "Building up the woodpile — it's everyone's.", "Laying in wood by the fire."])
    : npc.actionLabel === 'build'  ? v('d-build', ["Laying a fire here — no camp's near enough for nightfall.", "Making my own hearth. Naught else within reach.", "Setting a fire before the dark catches me out."])
    : npc.actionLabel === 'post'   ? v('d-post', ["There's a letter wants seeing to.", "Off with the post. It won't take long."])
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
    : npc.actionLabel === 'listen' && npc._listenGo ? v('d-listen', ["Listening. There's someone playing by the well.", "Stopped to hear the music. It's not often there's any."])
    : npc.trader ? traderSays()
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
  const hasGlass = telescopeOf(npc);
  const starsLine = !npc.stargazer ? null
    : (sky?.night ?? 0) < 0.35 ? v('stars-day', ["The stars keep their counsel by day — come back after dark.", "Naught to read while the sun's up. Ask me by night.", "The sky's too bright now; after dusk, friend."])
    : v('stars-intro', ["Let me look... ", "Aye, I read a little. ", "The sky tonight? "])
      + makeOmen({ moonLon: sky?.moonLon || 0, sunLon: sky?.sunLon || 0, illum: sky?.moonIllum || 0 })
      + (hasGlass ? ` ${(sky?.cloudCover ?? 0) < 0.7 ? glassReading({ illum: sky?.moonIllum || 0 }) : 'And no use taking my telescope out, under all this.'}`
         : npc.id % 2 ? v('stars-wish', [" What I'd give for a telescope. The old star-readers were buried with theirs, and nobody goes down to look.", " With a telescope I could tell you more. There are some yet, in the old tombs, they say."]) : '');
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
  // what a stargazer has to give for a telescope: their pretty things, the house's spare, the gold
  const glassPrice = () => [...(npc.trinkets > 0 ? [[npc.trinketKind || 'shell', npc.trinkets]] : []), ...spare(), ['gold', glassHoard(npc)]];
  const held = g => g === 'trinket' ? (npc.trinkets || 0) : countOf(npc, g) + rawOf(npc, g);
  const isInst = k => ingredient(k)?.use === 'play';
  const tradeable = () => Object.keys(basket).filter(k => basket[k] > 0 && (isWild(k) || isCrop(k) || ROAD_GOODS.has(k) || isCraft(k) || VALUABLES.has(k) || (isInst(k) && !instrumentOf(npc))));
  let deal = null, dealt = '';
  const offerOf = k => {
    const gn = isInst(k) ? 1 : Math.min(basket[k] || 0, 3), g = asKind(k), now = agents.time;
    const gb = ROAD_GOODS.has(g) || isCraft(g) ? agents.traderWorth(npc, house, g) : worth(npc, g, held(g) + (house.spare[g] || 0), now);
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
    flyToBag(d.get, d.qn);
    jot('traded', `${d.give} for ${d.get} with ${displayName(npc)}`);
    if (isInst(g)) giveInstrument(npc, g);
    else if (g === 'salt' || g === 'iron') house.goods[g] = (house.goods[g] || 0) + d.gn;
    else if (ROAD_GOODS.has(g) || isCraft(g)) addGoods(npc, g, d.gn);
    else if (g === 'trinket'){ npc.trinkets = (npc.trinkets || 0) + d.gn; if (!npc.trinketKind) npc.trinketKind = d.give; }
    else if (RAW_KINDS.has(g)) addRaw(npc, g, d.gn);
    else addFood(npc, g, d.gn, now);
    const rec = { t: now, folk: PLAYER, villager: npc, house, gave: d.give, gn: d.gn, got: d.get, qn: d.qn };
    house.ledger.push(rec); if (house.ledger.length > 12) house.ledger.shift();
    agents.market.trades.push(rec); npc._lastTrade = rec;
    dealt = `"${v('t-done', ['Done.', 'Done. Here you are.', 'Fair enough. Done.'])}" ${Pron} counts ${qty(d.qn, d.get)} into your basket.`;
    deal = null;
    if (invOpen) openInventory();
  };
  // ---- a trader (js/traders.js, docs/economy.md): you pick what you're after, then what you'll give. They
  // value both by what they'd fetch up the road, so they'll give more of what's cheap to them. ----
  let trWant = null, trDeal = null, trSaid = '';
  const trOffer = (give, want) => {
    const gn = Math.min(basket[give] || 0, 3), now = agents.time, gb = T.resale(tr, asKind(give), now), cb = T.resale(tr, want, now) / 0.8;   // (they count their own at what it'd really fetch)
    let max = 0; while (max < tr.stock[want] && gn * gb - (max + 1) * cb > 0) max++;
    return max > 0 ? { give, gn, get: want, max, qn: Math.ceil(max / 2), asked: false } : null;
  };
  const trDo = d => {
    if ((basket[d.give] || 0) < d.gn || (tr.stock[d.get] || 0) < d.qn){ trSaid = `"${v('t-gone', ["You've not got them now.", 'Seems that went somewhere.'])}"`; return; }
    if (myPack.room(d.get, d.qn) < d.qn){ trSaid = `"${v('t-full', ["You've no room for them.", "Where would you put them?"])}"`; return; }
    myPack.take(d.give, d.gn); T.put(tr, asKind(d.give), d.gn);
    tr.stock[d.get] -= d.qn; if (tr.stock[d.get] <= 0) delete tr.stock[d.get];
    myPack.add(d.get, d.qn, provHere('traded', displayName(npc))); flyToBag(d.get, d.qn);
    jot('traded', `${d.give} for ${d.get} with ${displayName(npc)}`);
    tr.deals++; T.stats.deals++;
    (T.log ??= []).push({ t: agents.time, folk: npc, villager: PLAYER, house: null, gave: d.get, gn: d.qn, got: d.give, qn: d.gn, trader: true });
    trSaid = `"${v('t-done', ['Done.', 'Done. Here you are.', 'Fair enough. Done.'])}" ${Pron} counts ${qty(d.qn, d.get)} into your basket.`;
    if (invOpen) openInventory();
  };
  const traderNodes = !tr ? {} : {
    get trStock(){
      const list = Object.entries(tr.stock).filter(([, m]) => m > 0);
      if (!list.length) return { text: `"${v('tr-empty', ['Sold out. Catch me when I come back up the road.', "There's nothing left in the pack, I'm afraid."])}"` };
      return { text: `"I've ${stockList()}. What are you after?"`,
        choices: list.map(([k]) => ({ label: cap(goods(k)) + '.', next: 'trGive', run: () => { trWant = k; } })) };
    },
    get trGive(){
      const mine = Object.keys(basket).filter(k => basket[k] > 0 && k !== trWant && T.resale(tr, asKind(k), agents.time) > 0.05 && (isWild(k) || isCrop(k) || VALUABLES.has(k) || k === 'hide' || k === 'gut' || k === 'cave salt'));
      if (!mine.length) return { text: `"You've nothing I could sell on, by the look of it."`, choices: [{ label: 'Something else, then.', next: 'trStock' }] };
      return { text: `"${cap(goods(trWant))}. What'll you give for them?"`,
        choices: mine.map(k => ({ label: cap(qty(Math.min(basket[k], 3), k)) + '.', next: 'trOffer', run: () => { trDeal = trOffer(k, trWant); } })) };
    },
    get trOffer(){
      const d = trDeal;
      if (!d) return { text: `"${v('tr-nouse', ["There's no money in that for me, not for this.", "I'd lose on that. Not for this."])}"`, choices: [{ label: 'Something else, then.', next: 'trGive' }] };
      const say = !d.asked ? `"For ${qty(d.gn, d.give)}? ${cap(qty(d.qn, d.get))}."` : d.bumped ? `"${cap(num(d.qn))}, then. That's as far as I go."` : `"No. ${cap(qty(d.qn, d.get))} is fair."`;
      const c = [{ label: 'Done.', next: 'trDone', run: () => trDo(d) }];
      if (!d.asked) c.push({ label: v('t-push', ['Can you do better?', "That's a bit thin.", 'Make it a few more?']), next: 'trOffer',
        run: () => { d.asked = true; const up = Math.ceil((d.qn + d.max) / 2); d.bumped = up > d.qn; d.qn = up; } });
      c.push({ label: 'No, thanks.', next: 'trStock', run: () => { trDeal = null; } });
      return { text: say, choices: c };
    },
    get trDone(){ return { text: trSaid }; },
    // where they're bound (js/traders.js t.bound), how far it is on the road, and what takes them there. Not chosen yet
    // while they're still selling at a place: they'll go where it pays once they're done
    get trWhere(){
      const q = T.stops.find(s => s.id === tr.bound), here = placeName(tr.at);
      if (!q) return { text: `"${tr.crying || here ? v('tr-where-here', [`Nowhere yet. I'm ${tr.kind === 'music' ? 'playing' : 'selling'}${here ? ` here at ${here}` : ''} a while, then wherever it pays.`, `I've not made up my mind. When I'm done${here ? ` at ${here}` : ' here'}, I'll go where it'll pay.`])
                                                    : v('tr-where-none', ["Wherever it pays. I've not worked out where yet.", "I'll know when I've had a think."])}"` };
      const days = Math.abs(q.s - tr.s) / TRADE.WALK_DAY;   // tr.s: how far along the road they've got (traders.js done)
      const far = days < 0.35 ? 'not far' : days < 0.75 ? "half a day's walk" : days < 1.4 ? "a day's walk" : `${num(Math.round(days))} days' walk`;
      const why = tr.kind === 'music' ? v('tr-where-music', ["They've not had music there in a while. They'll feed me for a tune.", "Nobody's played there lately. A place like that's glad of you."])
        : q.far ? `It's past the end of the road. They make ${words(Object.keys(q.f.sells).map(goods))} there, and pay well for what we've got here.`
        : stockList() ? `I've ${stockList()} to shift, and there'll be someone there short of it.` : "There's sure to be something worth having there.";
      return { text: `"${q.name}. It's ${far} down the road. ${why}"` };
    },
    // what they know that you might use: the widest gap they've seen, between two places they've been
    get trTip(){
      const g = T.tip(tr, agents.time);
      if (!g) return { text: `"${v('tr-notip', ["I've not been round enough lately to say.", 'Ask me when I have been up and down the road a bit.'])}"` };
      return { text: `"${cap(goods(g.kind))}. They'll let them go for next to nothing at ${g.cheap.name}, and you'd get a good deal more for them at ${g.dear.name}."` };
    },
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
  const untaughtCrafts = () => [...craftsRead].filter(k => (craftsKnown(npc).get(k) || 0) < 2);
  const untaughtTunes = () => [...tunesRead].filter(id => !knowsTune(npc, id, agents.time));
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
    // tunes (docs/music.md, music-sim.js): teaching one you've read by playing it to them,
    // giving them an instrument, and asking them to play
    get tuneTeach(){
      const ids = untaughtTunes(), kind = carriedInstrument();
      if (!ids.length || !kind) return { text: `"${v('tt-know', ['I know all of those.', "I've had those off you already."])}"` };
      return { text: `"${v('tt-which', ['A tune? Go on, which?', 'Play it, then. Which one?'])}"`,
        choices: ids.map(id => ({ label: `${cap(id)}.`, next: 'tuned', run: () => {
          const r = teachTune(npc, id, agents.time), all = r.got >= phraseCount(id), inst = instrumentOf(npc);
          playTune(id, kind, excerpt(partNotes(id, DRUMS.has(kind) ? 'drum' : 'melody', null, kind)));   // the opening, not the whole tune
          jot('taught', `${displayName(npc)} ${all ? '' : 'some of '}${id}`);
          const said = all ? (r.ear === 'good' ? v('tt-good', ['I have it now.', "That's it. I've got it."]) : v('tt-all', ['That\'s the whole of it now, I think.', "I've got it all now."]))
            : r.ear === 'none' ? v('tt-none', ["I can't hold a tune. The first bit, maybe.", "I've no ear for it. The start, maybe."])
            : v('tt-some', ["I've the start of it. Play it me again some time.", "I've got some of it. Not the end yet."]);
          const tail = inst ? '' : ` ${v('tt-noinst', ["Not that I've anything to play it on.", "I'd need something to play it on, mind."])}`;
          cookSaid = `You play ${id} through on your ${ingredient(kind).label}, slowly, a bit at a time. "${said}${tail}"`;
        } })) };
    },
    get tuned(){ return { text: cookSaid }; },
    // instrument making (making.js): showing them how, and asking for a hide or gut off a kill
    get craftTeach(){
      return { text: `"${v('ct-which', ['Go on, then. Which?', 'Show me. What is it?'])}"`,
        choices: untaughtCrafts().map(k => ({ label: `A ${ingredient(k).label}.`, next: 'tuned', run: () => {
          const r = teachCraft(npc, k, musicalCamp(npc)), name = ingredient(k).label;
          jot('taught', `${displayName(npc)} ${r.got ? 'how to make' : 'some of how to make'} a ${name}`);
          cookSaid = `You show ${fem ? 'her' : 'him'} how a ${name} is made, step by step. "${r.got
            ? v('ct-got', ["I see. I could make one of those.", "That's not so hard. I'll make one."])
            : v('ct-some', ["Show me again some time. I nearly have it.", "I've half of it. Not the rest yet."])}"`;
        } })) };
    },
    get askGoods(){
      const h = Math.min(1, goodsOf(npc, 'hide')), g = Math.min(2, goodsOf(npc, 'gut'));
      const got = [];
      if (h && myPack.room('hide', 1)){ takeGoods(npc, 'hide', 1); stow('hide', 1, provHere('given', displayName(npc))); got.push('a hide'); }
      if (g && myPack.room('gut', g)){ takeGoods(npc, 'gut', g); stow('gut', g, provHere('given', displayName(npc))); got.push(g > 1 ? `${g} lengths of gut` : 'a length of gut'); }
      return { text: got.length ? `"${v('ag-yes', ['Off the last kill. Take it.', "Here. I've no use for it just now."])}" ${Pron} gives you ${got.join(' and ')}.` : `"${v('ag-room', ["You've no room for it.", 'Where would you put it?'])}"` };
    },
    get instGive(){
      const ks = Object.keys(myPack.counts).filter(k => myPack.counts[k] > 0 && ingredient(k)?.use === 'play');
      if (!ks.length || instrumentOf(npc)) return { text: `"${v('ig-have', ["I've one already, thanks.", 'I have my own.'])}"` };
      return { text: `"${v('ig-which', ['Something to play? What is it?', "For me? Let's see."])}"`,
        choices: ks.map(k => ({ label: `${cap(ingredient(k).label)}.`, next: 'instGiven', run: () => {
          if (tunePlaying?.kind === k && !(myPack.counts[k] > 1)) stopTune();
          myPack.take(k, 1); giveInstrument(npc, k);
          jot('gave', `${displayName(npc)} my ${ingredient(k).label}`);
          const knows = tunesOf(npc, agents.time).length;
          cookSaid = `You give ${fem ? 'her' : 'him'} the ${ingredient(k).label}. "${knows ? v('ig-play', ["I'll play it by the fire tonight.", 'Thank you. I know a tune or two for this.'])
            : v('ig-learn', ["I'll have to learn something to play on it.", "Thank you. I don't know any tunes, mind."])}"`;
          if (invOpen) openInventory();
        } })) };
    },
    get instGiven(){ return { text: cookSaid }; },
    get playMe(){
      const id = tunesOf(npc, agents.time)[0], kind = instrumentOf(npc), k = phrasesKnown(npc, id, agents.time);
      const band = playForYou(npc, id, kind, k);
      noteHeard(npc, id);
      const part = k < phraseCount(id), names = band.map(p => `${displayName(p.npc)} on ${p.npc.gender === 'female' ? 'her' : 'his'} ${ingredient(p.kind).label}`);
      const lead = DRUMS.has(kind) ? `${Pron} beats out ${id} on ${their} ${ingredient(kind).label}` : `${Pron} plays ${id} on ${their} ${ingredient(kind).label}`;
      return { text: `${lead}${names.length ? `, and ${names.join(' and ')} join${names.length > 1 ? '' : 's'} in` : ''}.${part ? ` ${Pron} stops partway. "${v('pm-part', ["That's as far as I know it.", 'I forget how it goes after that.'])}"` : ''}`,
               choices: PT.reactions() };
    },
    // the still-room (stillroom.js): a stargazer makes the fairy salve, if what you bring
    // was rightly got and the moon is new. Once it's been made, any stargazer has the rest
    // put by: it only wants the clover, and no moon
    get salve(){
      const again = madeOnce.has('fairy salve'), met = wantsMet(myPack, 'fairy salve', again), short = met.filter(m => !m.ok);
      if (short.length){
        const lacks = short.filter(m => !(m.want.test && m.have >= m.want.n)).map(m => m.want.say), wrong = short.filter(m => m.want.test && m.have >= m.want.n).map(m => m.want.wrong);
        const wrongKinds = short.filter(m => m.want.test && m.have >= m.want.n).map(m => m.want.kind);
        journal.task('salve', `The fairy salve: ${whoAt(npc)} will make it${lacks.length ? `, but wants ${lacks.join(', and ')}` : ''}.${wrongKinds.length ? ` The ${wrongKinds.join(' and ')} I have wasn't rightly got.` : ''}`);
        jot('asked', `${displayName(npc)} to make the fairy salve`);
        return { text: `"${again ? v('sv-again', ['The green salve again? The wax is put by.', "I've the wax put by for that."]) : v('sv-know', ['The green salve? I know how it goes.', 'The salve for the eye. My gran made it once.'])}${lacks.length ? ` ${v('sv-lack', ["But I'd want {l}, and you've not got {it}.", "Bring me {l} first."]).replace('{l}', lacks.join(', and ')).replace('{it}', lacks.length > 1 ? 'them' : 'it')}` : ''}${wrong.length ? ' ' + wrong.join(' ') : ''}"` };
      }
      if (!again && (sky.moonIllum ?? 1) >= NEW_MOON){
        const d = daysToNewMoon(sky.moonLon ?? 0, sky.sunLon ?? 0), when = d < 1 ? 'before tomorrow' : d < 1.5 ? 'tomorrow' : `in ${Math.round(d)} days`;
        journal.task('salve', `The fairy salve: I have all it wants. ${whoAt(npc)} will make it at the dark of the moon, ${when}.`);
        jot('asked', `${displayName(npc)} to make the fairy salve`);
        return { text: `"${v('sv-moon', ["You've all of it. But it's made at the dark of the moon, and there's moon up there yet. Come back {w}.", 'Not with that moon. When it goes dark, {w}, bring it all back to me.']).replace('{w}', when)}"` };
      }
      return { text: `"${again ? v('sv-leaf', ["That's the leaf. Shall I work it in?", "You've the leaf, and I've the rest. Now, then?"]) : v('sv-now', ['You have it all, and the moon is dark. Now, then?', "Everything, and no moon. It's tonight or not for a month."])}"`,
        choices: [{ label: v('q-sv-make', ['Make it, please.', 'Yes. Make it.']), next: 'salveMade', run: () => {
          if (!myPack.room('fairy salve', 1) && !(basket['fairy salve'] > 0)){ cookSaid = `"${v('sv-full', ["You've nowhere to carry it. Make room first.", 'Your pack is full; I would only spill it.'])}"`; return; }
          for (const w of prepWants('fairy salve', again)) myPack.take(w.kind, w.n, w.test || null);
          madeOnce.add('fairy salve');
          stow('fairy salve', 1, provHere('given', displayName(npc)));
          journal.done('salve'); journal.done('recipe:fairy salve');
          jot('had', `${displayName(npc)} make me the fairy salve`);
          const told = v('sv-done', ['There. One eye only, mind, and after dark.', "Touch it to one eye, after dark. Not both. Never both."]);
          cookSaid = again ? `${fem ? 'She' : 'He'} takes down a small pot of green wax and works the leaf into it with a thumb. "${told}"`
            : `${fem ? 'She' : 'He'} warms the wax over a candle and works the leaf and the caps into it with a thumb, under the breath counting something. "${told} I've made up more wax than that wants, and it keeps. Next time, just bring me the leaf, any day. I'll tell the others who read the stars."`;
        } }] };
    },
    get salveMade(){ return { text: cookSaid }; },
  };

  // farewell addresses them by name once known, else by their kind ("Goodbye, Elf")
  const farewell = () => door?.mood === 'surly' || door?.mood === 'woken' ? v('bye-woken', ['Sorry to have woken you.', 'Sorry. Go back to bed.'])
    : door?.mood === 'late' ? 'Goodnight.'
    : npc.known && npc.given ? `Goodbye, ${npc.given}`
    : `Goodbye, ${(npc.race || 'stranger').replace(/^./, c => c.toUpperCase())}`;
  // what they say on opening the door, and on coming back to it after a question
  const doorGreet = () => door.said ? ({
      day:   v('door-more',  ['"What else?"', '"Something more?"']),
      late:  v('door-more',  ['"What else?"', '"Something more?"']),
      woken: v('door-more-w', ['"What else? It\'s cold on this step."', '"Is that all of it?"']),
      surly: v('door-more-s', ['"Is that it? I\'d like to get back to bed."', '"Well? What else?"']),
    })[door.mood] : ({
      day: npc.known ? v('door-day-k', ['"Oh, it\'s you. What brings you to the door?"', '"Hello again. Come in out of the road a moment, or are you passing?"'])
        : v('door-day', ['"Yes? Can I help you?"', '"Hello. I don\'t know your face. What is it?"', '"Yes? Who\'s this, then?"']),
      late: npc.known ? v('door-late-k', ['"You\'re out late. Is anything wrong?"', '"At this hour? Well, hello. What is it?"'])
        : v('door-late', ['"It\'s late. Who\'s there?"', '"Who comes knocking after dark?"', '"We don\'t get callers at this hour. What do you want?"']),
      woken: v('door-woken', [`${Pron} comes to the door blinking. "It's the middle of the night. Is something wrong?"`, `${Pron} has a blanket round ${their} shoulders. "What is it? Has something happened?"`]),
      surly: v('door-surly', [`The door opens a hand's width. "Do you know what hour it is?"`, `${Pron} glares out at you, half asleep. "You've woken the house. What do you want?"`, `"Who's that? Do you know how late it is?"`]),
    })[door.mood];
  // what you can say to someone you've heard play (play-talk.js)
  const mailTalk = mail.talk(npc, v, Pron);
  const PT = playTalk({ npc, now: () => agents.time, v, Pron, their, cap, name: displayName(npc), label: k => ingredient(k).label, carried: carriedInstrument, known: () => [...tunesRead],
    heard: () => heardOf(npc), forget: () => heardPlaying.delete(npc), jot,
    playMine: (id, kind) => playTune(id, kind, excerpt(partNotes(id, DRUMS.has(kind) ? 'drum' : 'melody', null, kind))),
    playTheirs: (id, kind, k) => { playForYou(npc, id, kind, k); noteHeard(npc, id); } });
  // her flower crown, if she's wearing one as the talk opens (docs/crowns.md)
  const crown = npc.crown || null, crownLate = () => npc.crownUntil - agents.time < 0.5;
  const crownWhere = { label: v('q-crown-where', ['Where did you get those flowers?', 'Where did you find those flowers?']), next: 'crownWhere' };
  const tree = { speaker: displayName(npc), portrait: npc.portrait, portraitBg: markBackdrop(npc.group?.id), hand: npc, root: 'hi', farewell, nodes: {
    get keepAt(){ return PT.nodes.keepAt; }, get better(){ return PT.nodes.better; }, get tryIt(){ return PT.nodes.tryIt; }, get noSong(){ return PT.nodes.noSong; }, get praise(){ return PT.nodes.praise; },
    get hi(){
      const rite = atSecretRite(npc);
      if (rite && !isMember(PLAYER, rite.F.id))
        return { text: !rite.sat ? `"${v('fs-going', ["Can't stop now.", "Another time. I'm wanted somewhere."])}"`
          : npc.id % 2 ?   /* some ignore you, some tell you to go */ v('fs-ignore', [`${Pron} looks past you and says nothing.`, `${Pron} doesn't answer. None of them look round.`])
          : `"${v('fs-leave', ['Not tonight. Go on home.', "You shouldn't be here. Go back the way you came."])}"` };
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
      if (crown){
        c.push({ label: v('q-crown', ["That's a lovely crown.", 'I like your flowers.', 'Those flowers suit you.']), next: 'crown', run: () => { if (!crown.praised){ crown.praised = true; nudge(npc, PLAYER, 0.03, 0.08); } } });
        c.push(crownWhere);
      }
      if (tr){ if (tr.kind !== 'music') c.push({ label: v('q-trader', ['What are you carrying?', 'What have you got?', "What's in the pack?"]), next: 'trStock' });
        c.push({ label: v('q-trader-where', ['Where are you headed?', 'Where are you off to next?']), next: 'trWhere' });
        if (tr.kind !== 'music') c.push({ label: v('q-trader-tip', ["What's cheap where, these days?", "Where's the good trade?"]), next: 'trTip' }); }
      if (house && (sky?.day ?? 1) > 0.3) c.push({ label: v('q-trade', ['Got anything to trade?', 'Anything put by to trade?', 'Will you trade?']), next: 'trade' });
      if (unknownTo().length) c.push({ label: v('q-teach-them', ['I found an old recipe…', "I've a recipe from an old book…"]), next: 'teach' });
      if (carriedInstrument() && untaughtTunes().length) c.push({ label: v('q-tune-teach', ["I've a tune for you…", 'Want to learn a tune?']), next: 'tuneTeach' });
      if (!npc.home && untaughtCrafts().length) c.push({ label: v('q-craft-teach', ['I could show you how to make an instrument…', "I've learnt how to make something to play…"]), next: 'craftTeach' });
      if (!npc.home && (goodsOf(npc, 'hide') || goodsOf(npc, 'gut'))) c.push({ label: v('q-ask-goods', ['Have you a hide or any gut to spare?', 'Any hide or gut going spare?']), next: 'askGoods' });
      if (!instrumentOf(npc) && carriedInstrument()) c.push({ label: v('q-give-inst', ["I've brought you something to play.", 'Would you like an instrument?']), next: 'instGive' });
      if (instrumentOf(npc) && tunesOf(npc, agents.time).length) c.push({ label: v('q-play', ['Will you play something?', 'Play me a tune?']), next: 'playMe' });
      c.push(...mailTalk.choices());
      if (givable().length) c.push({ label: v('q-give-cook', ["I've brought something for your cooking.", 'Here, for your cooking.']), next: 'give' });
      // a portion they've put by for you, from a pot of a book dish (recipes.js putBy)
      let greetAll = door ? doorGreet() : greet;
      if (npc.saved && npc.saved.length && door?.mood !== 'surly'){
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
      c.unshift(...PT.reactions());   // you've just heard them play: first thing on your mind
      if (npc.actionLabel === 'practice' && npc.practice) greetAll = `${v('greet-practice', ["Oh! I thought I was alone out here.", "Oh! How long have you been there?"])} ${greetAll}`;
      if (askDoctor) c.push({ label: "Is there a doctor around? My eyes aren't showing me what I need to see.", next: 'doctor' });
      c.push({ label: v('q-where', ["Where are we?", "What is this place called?", "What do folk call this place?", "Where am I, friend?"]), next: 'where' });
      if (voiceHas(npc, 'has-sky', 0.65)) c.push({ label: v('q-sky', ["How looks the sky?", "What of the weather?", "How's the day?", "Fair skies?", "What's the sky doing?", "Think it'll hold fair?"]), next: 'sky' });
      if (npc.stargazer && recipesRead.has('fairy salve')) c.push({ label: v('q-salve', ['Could you make the fairy salve?', "I've a still-room book. The salve for the eye?"]), next: 'salve' });
      if (npc.stargazer && !hasGlass && basket.telescope > 0) c.push({ label: v('q-glass', ["I've found a telescope.", 'Have you ever looked through one of these?']), next: 'glass' });
      if (npc.stargazer) c.push({ label: v('q-stars', ["What do the stars say?", "Any word from the heavens?", "What do you read up there?", "Read me the sky?"]), next: 'stars' });
      // got out of bed by a stranger: the bare essentials, and no chat
      return { text: greetAll, choices: door?.mood === 'surly' ? c.filter(o => o.next === 'where' || o.next === 'doing' || o.next === 'doctor') : c };
    },
    get news(){ return { text: newsReport(npc, sky?.time ?? 0) }; },
    get where(){ return { text: whereAreWe(npc, v) }; },
    get plans(){ return { text: plansReport(npc, v) }; },
    name:  { text: nameLine, choices: [ { label: v('q-kin', ["Who are your people?", "Who do you call kin?", "Who are your folk?", "Tell me of your people.", "Have you family hereabouts?", "Who do you travel with?"]), next: 'kin' } ] },
    crown: { text: crown && crownLate() ? v('crown-wilting', ["Thanks. It's starting to wilt.", "Thanks. It won't last much longer."]) : v('crown-thanks', ['Thank you.', 'Thanks. I made it myself.', 'Thanks. Seven flowers, it took.']), choices: crown ? [crownWhere] : [] },
    crownWhere: { text: crown ? `I picked them ${whereSaid(npc, crown.x, crown.z)}.${crownLate() ? ' They don\'t last, mind.' : ''}` : '' },
    doing: { text: door?.woken ? v('d-woken', ['"Sleeping, until you knocked."', '"I was asleep. Now I\'m standing at the door."']) : doing },
    feel:  { text: feel },
    self:  { text: selfLine },
    kin:   { text: kinLine, ...(kinRoster ? { roster: kinRoster } : {}) },
    pack:  { text: packLine },
    sky:   { text: skyLine },
    ...(starsLine ? { stars: { text: starsLine + thinLine } } : {}),
    // your telescope, to a stargazer who has none (docs/telescope.md): the one thing they'd
    // empty their house for. Everything they carry, the household's spare, the gold put by.
    get glass(){
      const pay = glassPrice();
      return { text: `${Pron} takes it in both hands and looks along it, and for a while says nothing. "${v('glass-want', ["I've wanted one of these all my life.", "Where did you find this? No, don't tell me."])} ${pay.length ? `I'll give you all I have for it: ${pay.map(([k, n]) => qty(n, k)).join(', ')}.` : "I've nothing that's worth it."}"`,
        choices: [{ label: 'Take it.', next: 'glassGiven', run: () => {
          if (!(basket.telescope > 0)) return;
          myPack.take('telescope', 1); giveTelescope(npc);   // (first: its room in your pack goes to what they give)
          for (const [k, n] of pay){
            const got = myPack.room(k, n) >= n && stow(k, n, provHere('traded', displayName(npc)));
            if (!got) continue;
            if (k === 'gold') continue;
            if (house?.spare?.[k] > 0) house.spare[k] -= n; else npc.trinkets = 0;
          }
          jot('traded', `my telescope to ${displayName(npc)}`);
        } }, { label: 'Not yet.', next: 'glassKept' }] };
    },
    glassGiven: { text: `"${v('glass-given', ["Clear skies to you, then. To both of us.", "I won't sleep tonight."])}"` },
    glassKept: { text: `${Pron} gives it back, slowly. "${v('glass-kept', ["Bring it back, when you've looked your fill.", "You know where I am."])}"` },
    doctor: { text: doctorLine, ...(npc.stargazer ? { choices: [{ label: "My eyes can't see the way into Faerie.", next: 'doc-faerie' }] } : {}) },
    ...stargazerNodes,
    ...kinNodes,
  }};
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(tradeNodes));   // getters, so the offer re-reads live
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(traderNodes));
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(cookNodes));
  Object.defineProperties(tree.nodes, Object.getOwnPropertyDescriptors(mailTalk.nodes));
  tree.doctorMark = doctorMark;
  return tree;
}

// Sitting at a fire (E on it; docs/cooking.md): the view lowers and turns to the pot, the cursor
// comes free, the pack opens, and js/cook-view.js draws the rest. The world keeps running. A step,
// E or Esc gets you up. The pot is kept in the gap between the leaf and the pack.
let sat = null;
const SEAT_R = 1.75, SEAT_DROP = 0.65, SEAT_EASE = 4;
const potTop = f => height(f.x, f.z) + (f.view?._brothY ?? 0.5);
function sitAt(fire){
  if (!fire.done){ setForageMsg(fire.fireReport(), 3500); return; }
  if (!fire.lit){
    if (!(myPack.counts.wood > 0)){ setForageMsg('Cold ashes. It wants wood.', 3500); return; }
    if (rain.intensity > RAIN_NO_FIRE){ setForageMsg('The rain will not let it catch.', 3500); return; }
    myPack.take('wood', 1); fire.addWood(1); fire.rekindle();
    setForageMsg('You lay a log on the ashes, and it catches.', 3500);
    return;
  }
  const d = Math.hypot(pos.x - fire.x, pos.z - fire.z) || 1, k = SEAT_R / d, sx = fire.x + (pos.x - fire.x) * k, sz = fire.z + (pos.z - fire.z) * k;
  inDialog = true; document.exitPointerLock?.();
  sat = { fire, x: walkable(sx, sz) ? sx : pos.x, z: walkable(sx, sz) ? sz : pos.z, drop: 0 };
  glance.reset();
  openInventory();
  cook.open(fire);
  document.body.classList.add('sat');
}
// The leaf, the pot and the pack all want room. Beside the leaf if the pack fits there with a gap
// for the pot; if not, a smaller pack; if still not, along the bottom, with the pot above it.
const POT_GAP = 160;
function seatPack(){
  const leafR = 16 + Math.min(330, innerWidth * 0.34);
  const place = n => { packUI.maxCell = n; packUI.render(); bag.placeBeside(invPanel); return invPanel.getBoundingClientRect(); };
  let r = place(52);
  if (r.left - leafR < POT_GAP) r = place(40);
  if (r.left - leafR < POT_GAP && innerHeight - r.height > 200) invPanel.style.top = `${innerHeight - r.height - 8}px`;
}
function getUp(){
  if (!sat) return;
  sat = null;
  packUI.maxCell = 52;
  cook.close();
  closeInventory();
  document.body.classList.remove('sat');
  inDialog = false; relock();
}
function satFrame(dt){
  const f = sat.fire, e = Math.min(1, dt * SEAT_EASE);
  if (!f.lit && !f.pot.raw && !f.pot.ready){ getUp(); return; }
  pos.x += (sat.x - pos.x) * e; pos.z += (sat.z - pos.z) * e;
  sat.drop += (SEAT_DROP - sat.drop) * e;
  camera.position.set(pos.x, pos.y - sat.drop, pos.z);
  // aim so the pot lands in the gap
  const leaf = document.querySelector('.cook-paper')?.getBoundingClientRect(), pk = invPanel.getBoundingClientRect();
  const left = leaf?.width ? leaf.right : 0, stacked = pk.width && pk.left < left + 120;
  const right = stacked ? Math.min(innerWidth, document.getElementById('vitals')?.getBoundingClientRect().left || innerWidth) : pk.width ? pk.left : innerWidth;
  sat.stacked = stacked;
  const mid = (left + right) / 2 - (stacked ? 90 : 0), midY = stacked ? pk.top / 2 : innerHeight * 0.4;   // (stacked: room for the board beside it)
  const css = document.getElementById('cook').style;
  css.setProperty('--cook-mid', `${mid}px`);
  css.setProperty('--cook-foot', `${stacked ? innerHeight - pk.top + 8 : 24}px`);
  if (leaf) document.querySelector('.cook-paper').style.maxHeight = stacked ? `${pk.top - 24}px` : '';
  const tanV = Math.tan(camera.fov * Math.PI / 360), ndc = mid / innerWidth * 2 - 1, ndcY = 1 - midY / innerHeight * 2;
  const dx = f.x - pos.x, dz = f.z - pos.z, wantY = Math.atan2(-dx, -dz) + Math.atan(ndc * tanV * camera.aspect);
  const wantP = Math.atan2(potTop(f) - camera.position.y, Math.hypot(dx, dz)) - Math.atan(ndcY * tanV);
  let dy = (wantY - yaw) % (Math.PI * 2); if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
  yaw += dy * e; pitch += (wantP - pitch) * e;
}
const _potAt = new THREE.Vector3(), _potRim = new THREE.Vector3();
function potOnScreen(f){
  _potAt.set(f.x, potTop(f), f.z).project(camera);
  _potRim.set(f.x + 0.32, potTop(f), f.z).project(camera);
  const r = canvas.getBoundingClientRect();
  const rad = Math.hypot((_potRim.x - _potAt.x) * r.width, (_potRim.y - _potAt.y) * r.height) / 2;
  return { x: r.left + (_potAt.x + 1) / 2 * r.width, y: r.top + (1 - _potAt.y) / 2 * r.height, r: Math.max(56, rad * 1.5), stacked: sat.stacked };
}
// Shearing (docs/sheep.md): E on a sheep with its wool on. js/shear-hands.js has the view and the drag, and this the before and after.
// For now anyone may shear any sheep, with no shears to carry, and the fleece is yours: to be settled with the shepherds.
const shearHands = new ShearHands({ canvas, camera, view: sheepView, ground: height, snip: () => footsteps.snip(), onEnd: ({ fleece, dirt, at }) => {
  inDialog = false; relock();
  if (at && walkable(at.x, at.z)){ pos.x = at.x; pos.z = at.z; }   // you're where the view is
  if (fleece){ myPack.add('fleece', 1, { ...provHere('shorn'), dirt }); flyToBag('fleece', 1); setForageMsg('The fleece comes away, and the sheep bolts, pale and light.', 4000); }
  else setForageMsg('You let it go, with the job half done.', 3500);
} });
function startShearing(s){
  inDialog = true; document.exitPointerLock?.();
  glance.reset();
  shearHands.begin(s, pos);
}
window.leaShear = { hands: shearHands, start: startShearing };

// Stuck, measured (js/stuck.js, docs/npc-behavior.md "Stuck"): the folk on their way somewhere, and the sheep, who walk and get
// nowhere, or can't walk. Always counting, as it's cheap; leaStuck() in the console says what's been found. With ?stucklog it
// also goes to bub every minute, as a ?perflog recording does (logs/perf/<id>.json, kind 'stuck').
// (var, and checked: the world can tick before this line has run, while the game is still loading)
var stuckWatch = new StuckWatch(), _stuckId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
function watchStuck(dt){ if (stuckWatch) watchWorld(stuckWatch, dt, agents, habitatAt); }
window.leaStuck = (all = false) => all ? stuckWatch.events : stuckWatch.summary();
if (params.has('stucklog')) setInterval(() => {
  if (!stuckWatch.events.length) return;
  const body = JSON.stringify({ meta: { id: _stuckId, kind: 'stuck', ua: navigator.userAgent, world: WORLD_SEED }, summary: stuckWatch.summary(), events: stuckWatch.events });
  fetch('/api/perflog', { method: 'POST', body }).catch(() => {});
}, 60000);
// ---- firewood, and laying a fire (docs/cooking.md) -------------------------------------------------
// Work with your hands (cutting a shrub, the fire's rite) takes a moment and holds you: walk off
// and it stops. A fire is placed like this: use wood from the pack, a ring on the ground ahead
// says whether it can go there, E lays it (agents.fireSpotWhy; Campfire.raise is the same rite the
// folk use). No flint or tinder; the rain stops it.
const FIRE_LOGS = 3, FIRE_SPARE = 2, CUT_TIME = 2.6, CUT_LOGS = 3, RAIN_NO_FIRE = 0.35, PLACE_AHEAD = 3, LAY_TIME = 6;
let job = null, placing = null;
const jobBar = document.createElement('div');
jobBar.style.cssText = 'position:fixed;left:50%;bottom:22%;width:170px;height:7px;margin-left:-85px;background:#000a;border:1px solid #e3d09f88;border-radius:3px;display:none;z-index:30;pointer-events:none';
jobBar.innerHTML = '<div style="height:100%;width:0;background:#e3d09f;border-radius:2px"></div>';
document.body.appendChild(jobBar);
function startJob(time, { step, done, stopped }){
  job = { t: 0, time, x: pos.x, z: pos.z, step, done, stopped };
  jobBar.style.display = 'block';
}
function endJob(){ job = null; jobBar.style.display = 'none'; }
function tickHands(dt){
  if (job){
    if (down || inDialog || Math.hypot(pos.x - job.x, pos.z - job.z) > 0.6){ const j = job; endJob(); j.stopped?.(); }
    else {
      job.t += dt; job.step?.(dt);
      jobBar.firstChild.style.width = `${Math.min(100, job.t / job.time * 100)}%`;
      if (job.t >= job.time){ const j = job; endJob(); j.done(); }
    }
  }
  if (placing) placeFrame();
}
function cutShrub(s){
  if (job) return;
  if (!myPack.room('wood', 1)){ setForageMsg('No room in your pack.', 2600); return; }
  setForageMsg('You cut at the shrub.', 1500);
  startJob(CUT_TIME, { done: () => { if (s.alive === false) return; s.chop(); stow('wood', CUT_LOGS, provHere('found')); } });
}
const _ghost = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9fe08a, transparent: true, opacity: 0.55, depthWrite: false }));
_ghost.visible = false; scene.add(_ghost);
function startPlacing(){
  if (sat) return 'Drag it onto the fire to feed it.';
  if (down) return 'Not down here. There is nowhere for the smoke to go.';
  if (boating) return 'Not in a boat.';
  if ((myPack.counts.wood || 0) < FIRE_LOGS) return `A fire wants ${FIRE_LOGS} logs.`;
  if (invOpen) closeInventory(true);
  placing = { why: null, shown: null, x: 0, z: 0 };
  _ghost.visible = true;
  setForageMsg('Find a clear spot, and press E to lay a fire. Esc to think better of it.', 4000);
  return null;
}
function stopPlacing(){ placing = null; _ghost.visible = false; }
function placeFrame(){
  if (down || boating || !inWorld() || (myPack.counts.wood || 0) < FIRE_LOGS){ stopPlacing(); return; }
  const x = pos.x - Math.sin(yaw) * PLACE_AHEAD, z = pos.z - Math.cos(yaw) * PLACE_AHEAD;
  placing.x = x; placing.z = z;
  placing.why = agents.fireSpotWhy(x, z) || (rain.intensity > RAIN_NO_FIRE ? 'The rain will not let it catch.' : null);
  _ghost.position.set(x, height(x, z) + 0.06, z);
  _ghost.material.color.setHex(placing.why ? 0xe0705a : 0x9fe08a);
  if (placing.why && placing.why !== placing.shown) setForageMsg(placing.why, 2000);
  placing.shown = placing.why;
}
function layFire(){
  const { x, z, why } = placing;
  if (why){ setForageMsg(why, 2000); return; }
  stopPlacing();
  myPack.take('wood', FIRE_LOGS);
  const f = agents.addCampfire(x, z, { exact: true, built: false });
  setForageMsg('You ring the stones, and lay the wood.', LAY_TIME * 1000);
  startJob(LAY_TIME, { step: dt => f.raise(dt),
    done: () => { f.raise(1e6); f.addWood(FIRE_SPARE); setForageMsg('It catches. E to sit at it.', 3500); jot('lit', 'a fire'); },
    stopped: () => { agents.removeFire(f); myPack.add('wood', FIRE_LOGS, null); setForageMsg('You leave it unlaid, and take your wood back.', 3000); } });
}
// what comes out of the pot: a dish you can name, or a plain boil
const potItem = f => (f.pot.recipe && ingredient(f.pot.recipe)) ? f.pot.recipe : 'plain boil';
function notePot(f){ if (!f.pot.noted){ f.pot.noted = true; jot('cooked', f.pot.recipe || `some ${f.pot.kind}`); } }
const cook = makeCookView({ world: agents, pack: myPack, book: { receive: el => myBook.receive(el) }, say: m => setForageMsg(m, 2600),
  known: () => [...recipesRead].filter(id => RECIPES[id]),
  onFeed: f => { if (f.woodpile >= 12){ setForageMsg('The pile is as high as it will go.', 2600); return false; } f.addWood(1); return true; },
  mayDouse: f => {
    if (f.pot.raw + f.pot.ready > 0) return 'Not with food over it.';
    return agents.near(f.x, f.z, 5).length ? 'Not with folk sat at it.' : null;
  },
  onDouse: f => {
    const logs = f.douse(), back = Math.min(logs, myPack.room('wood', logs));
    getUp();
    if (back) myPack.add('wood', back, null);
    setForageMsg(`You kick the fire apart.${back ? ` You take back ${back} ${back === 1 ? 'log' : 'logs'}.` : ''}`, 3500);
    jot('put out', 'a fire');
  },
  cookOf: f => { const c = f.potCook(); return c ? displayName(c) : null; },
  onLadle: f => {
    const kind = potItem(f);
    if (!myPack.room(kind, 1)){ setForageMsg('No room in your pack.', 2600); return; }
    notePot(f);
    stow(kind, 1, { ...provHere('cooked'), q: f.takeStew() });
    packUI.render();
  },
  onEat: f => {
    const kind = potItem(f);
    notePot(f);
    const g = eat(me, kind, agents.time, potFill(f.takeStew()));
    setForageMsg(`You eat a bowl of ${(ingredient(kind) || {}).label || kind}: ${giveWords(g) || "you're as full of it as you'll get"}.`, 3500);
  },
});
// debug: sit at the nearest lit fire, for driving this without pointer lock
window.leaCook = { sit(){ const lit = agents.openFires.filter(f => f.lit && f.done); sitAt(lit.reduce((a, b) => Math.hypot(b.x - pos.x, b.z - pos.z) < Math.hypot(a.x - pos.x, a.z - pos.z) ? b : a)); return sat?.fire; }, up: getUp, cheat(){ CHEATS.CHEF(); }, get fire(){ return sat?.fire; }, get pack(){ return myPack; }, get playing(){ return playing; }, get job(){ return job; }, get placing(){ return placing; }, get shrubs(){ return forage.shrubs; }, cut: cutShrub, pos, world: agents, me };
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
let nearTomb = null;   // a coffin you can read, or bring a letter to
let nearEntrance = null, nearFind = null, nearExit = -1, nearSconce = null, nearShelf = null, nearDoor = null, nearChest = null;
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
let cameBy = null;   // the door you went through (askPortal): you come out by it, if it led into this palace
function leavePalace(){
  const p = cameBy?.level === down.L.id ? cameBy : portalOf(down.L.id), h = (((sky.time ?? 0) % 1) + 1) % 1 * 24, day = h >= 5 && h < 19;
  pos.x = p.stand[0]; pos.z = p.stand[1]; pos.y = height(pos.x, pos.z) + EYE;
  yaw = Math.atan2(-Math.cos(p.face), -Math.sin(p.face)); pitch = 0;
  down = null; nearFind = null; nearExit = -1; cameBy = null;
  maps.setLevel(null);
  if (day){
    sight = null; faerie.stop();
    setForageMsg('You step out into daylight. Behind you there is only grass; the door has gone.', 4500);
    setTimeout(() => setForageMsg('Puck, at your ear: "All night, you were in there! Count yourself lucky it was only the one. Folk have gone in and come out a hundred years on."', 7000), 3500);
  } else setForageMsg('You step back through the dark, into the night of the Lea.', 3000);
}
function askPortal(p){
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  talkTree({ speaker: cap(p.name), root: 'ask', farewell: 'Stay in the Lea.', nodes: { ask: {
    text: `An oval of black hangs in the air, a door into nothing. Lights spiral into it, and out again. Go through into ${p.name}?`,
    choices: [{ label: 'Go through.', next: null, run: () => fade(() => { cameBy = p; goDown({ level: p.level, mouth: 0 }); }) }] } } }, { onClose });
}
function askDown(e){
  const name = underNames()[e.level].name;
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  talkTree({ speaker: name, root: 'ask', farewell: 'Stay above.', nodes: { ask: {
    text: (e.kind === 'cave' ? 'A cave mouth in the hillside. Cold air breathes out of the dark.' : `Worn steps go down ${STAIR_WHERE[e.site] || STAIR_WHERE.chapel}, into the dark.`) + ` Go down into ${name}?`,
    choices: [{ label: 'Go down.', next: null, run: () => fade(() => goDown(e)) }] } } }, { onClose });
}
function askUp(k){
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  const m = down.L.mouths[k];
  talkTree({ speaker: down.name, root: 'ask', farewell: m.to ? 'Stay here.' : 'Stay below.', nodes: { ask: {
    text: m.ask ? m.ask : down.L.site === 'palace' ? 'The door you came in by. Beyond it, the Lea. Go back through?' : down.L.kind === 'cave' ? 'Daylight, up ahead. Climb out?' : `The stair climbs ${STAIR_UP[down.L.site] || STAIR_UP.chapel}. Go back up?`,
    choices: [{ label: m.go || 'Climb out.', next: null, run: () => fade(() => comeUp(k)) }] } } }, { onClose });
}
// a locked door into a room (gen/under.js doors()): its key opens it, and you keep the key (one
// opens several); without it, the door says what key it wants. Open, it stays open all session
function tryDoor(d){
  if (!((basket[d.key] || 0) > 0)){ setForageMsg(`Locked. ${cap(d.sign)} is worked in iron on it.`, 3500); return; }
  d.open = true; d.prop.solid = false;
  setForageMsg(`The ${d.key} turns in the lock. The doors swing in.`, 3500);
  disturb();
}
// a chest: lift the lid, and what it holds can be taken like any find
function openChest(c){
  c.open = true; disturb();
  const ci = down.L.chests.indexOf(c), what = down.L.finds.filter(f => f.chest === ci && !f.taken);
  setForageMsg(what.length ? `You lift the lid. Inside: ${words(what.map(f => `a ${ingredient(f.kind)?.label || f.kind}`))}.` : 'You lift the lid. It is empty.', 3500);
}
function takeFind(f){
  disturb();
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
const madeOnce = new Set();      // preparations a stargazer has made for you: what they want from then on is less (stillroom.js)
// A Faerie palace's shelves hold the Gentry's library instead (faerie-books.js): real
// recipes out of mortal books, read and copied but not yet made. Kept apart from
// recipesRead, which the folk's cooking and Puck's finding read as things to make.
const faerieRead = new Set();
const PALACE_SHELF = ['A bookcase', 'Every book on it whole, bound in vellum, the edges gilt.'];
const LECTERN = ['A lectern', 'A choir book lies open on it, kept dry under a fold of oilcloth.'];
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
// where a shelf is on the screen, by the middle you aim at it by; what a page flies out of (page.js)
function shelfOnScreen(sh){
  const p = new THREE.Vector3(sh.x, sh.y + sh.h * 0.55, sh.z).project(camera), r = canvas.getBoundingClientRect();
  return { x: Math.min(r.right, Math.max(r.left, r.left + (p.x + 1) / 2 * r.width)), y: Math.min(r.bottom, Math.max(r.top, r.top + (1 - p.y) / 2 * r.height)) };
}
function readShelf(sh){
  const mb = shelfMusic(sh), cr = !mb && shelfCraft(sh), from = shelfOnScreen(sh);
  if (mb || cr) disturb();
  if (mb){ readMusic(mb, shelfTune(sh), from); return; }
  if (cr){ readCraft(cr, from); return; }
  const id = bookRecipe(sh);
  if (id && FAERIE_BOOKS[id]){ readFaerieBook(id, from); return; }
  if (id) disturb();
  if (!id){ setForageMsg(SHELF_LABEL[sh.state][1], 3000); return; }
  const fresh = !recipesRead.has(id), prep = !!PREPARATIONS[id];
  recipesRead.add(id);
  if (fresh){
    jot('found', prep ? `the making of the ${id}, in a still-room book` : `a recipe for ${id}`);
    journal.task(`recipe:${id}`, prep ? `The ${id}: a stargazer could make it, from ${PREPARATIONS[id].wants.map(w => w.say).join(', ')}.` : `A recipe for ${id}, to teach to a cook. It wants ${wantsWords(id)}.`);
  }
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  readPage({ from, book: prep ? 'A book kept dry in its case' : SHELF_BOOK[sh.room] || 'An old book', title: cap(id), ...(prep ? prepPage(id) : recipePage(id)),
             into: fresh && intoBook, onClose });
}
// a book of the Gentry's: on vellum, in their own type (page.js `paper`)
function readFaerieBook(id, from){
  const B = FAERIE_BOOKS[id], fresh = !faerieRead.has(id);
  faerieRead.add(id);
  if (fresh){
    jot('found', `${B.magic ? 'the making of' : 'a recipe for'} ${id}, in a book of the Gentry's`);
    journal.task(`recipe:${id}`, `${cap(id)}, out of ${B.from.charAt(0).toLowerCase() + B.from.slice(1)}. It wants ${B.wants.join(', ')}.`);
  }
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  readPage({ paper: 'vellum', book: B.from, from, title: cap(id), body: [B.intro, ...B.body], margins: B.margins || [],
             into: fresh && intoBook, onClose });
}
// Music books (docs/music.md; tunes.js): the one dry book on a mouldy shelf, a choir book in
// a cloister or a songbook in an undercroft, or one of the Gentry's on a palace shelf.
// Reading one copies its tunes onto the Tunes page of the spellbook, and with an instrument
// in the pack you can play one there and then.
const tunesRead = new Set();
// Maker's books (making.js): one on a shelf of its own in each crypt. Reading one copies the
// making into your book (the Crafts page), which is where you make the instrument, with what
// it wants in your pack; you can show the folk how, too (talk).
const craftsRead = new Set();
const intoBook = el => myBook.receive(el);    // a page you've copied, on its way into your book, once shut
function readCraft(kind, from){
  const C = CRAFTS[kind], name = ingredient(kind).label, fresh = !craftsRead.has(kind);
  craftsRead.add(kind);
  if (fresh){
    jot('found', `how to make a ${name}, in ${C.book.charAt(0).toLowerCase() + C.book.slice(1)}`);
    journal.task(`craft:${kind}`, `How to make a ${name}. It wants ${needsText(kind)}.`);
  }
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  readPage({ book: C.book, title: cap(name), ...(C.verse ? { verse: C.verse } : { body: [C.about, `It wants ${needsText(kind)}.`] }),
             margins: [...(C.margin ? [C.margin] : []), ...C.needs.filter(([m]) => ingredient(m)?.from === 'nowhere yet').map(([m]) => `${cap(ingredient(m).label)}: none to be had yet.`)],
             from, into: fresh && intoBook, onClose });
}
// make one now, if you've what it wants (instant): what happened, in a line
function makeCraft(kind){
  const name = ingredient(kind).label;
  if (!canMake(myPack, kind)) return `You haven't what it needs: ${needsText(kind)}.`;
  if (myPack.room(kind, 1) < 1) return `No room in your pack for a ${name}.`;
  for (const [m, k] of CRAFTS[kind].needs) myPack.take(m, k);
  myPack.add(kind, 1, provHere('made'));
  flyToBag(kind, 1);
  jot('made', `a ${name}`);
  if (invOpen) openInventory();
  return `You make a ${name}. It's in your pack.`;
}
const words = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
function readMusic(bookId, tune, from){
  const B = MUSIC_BOOKS[bookId], fresh = tunesRead.has(tune) ? [] : [tune];   // one tune to a shelf (tunes.js shelfTune)
  fresh.forEach(t => tunesRead.add(t));
  if (fresh.length) jot('found', `${B.from.charAt(0).toLowerCase() + B.from.slice(1)}, with ${words(fresh)} in it`);
  inDialog = true; document.exitPointerLock?.();
  const onClose = () => { inDialog = false; relock(); };
  const kind = carriedInstrument();
  readPage({ paper: B.paper, book: B.from, from,
             tunes: [tune].map(id => ({ title: cap(id), about: TUNES[id].about, svg: staffSvg(id, { square: B.head === 'square' }),
                                        play: kind ? playNote(kind, liftFor(schedule(id).notes, kind)) : null })),
             into: fresh.length > 0 && intoBook,
             actions: kind ? [tune].map(id => ({ label: `Play ${id} on your ${ingredient(kind).label}.`,
               run: el => { if (tunePlaying?.id === id){ stopTune(); el.textContent = `Play ${id} on your ${ingredient(kind).label}.`; } else { playTune(id, kind); el.textContent = 'Stop playing.'; } } })) : [],
             onClose });
}
// one note off the page (page.js playable) on instrument `kind`, `up` semitones above as
// written (arrange.js liftFor, as the whole tune is played); a drum gives its deep stroke
const playNote = (kind, up) => (midi, secs) => instruments.play(kind, { notes: [{ t: 0, dur: secs, midi: DRUMS.has(kind) ? 45 : midi + up }], length: secs })
  .catch(e => console.warn('instruments:', e));
// the first instrument in the pack, or null
const carriedInstrument = () => Object.keys(myPack.counts).find(k => myPack.counts[k] > 0 && ingredient(k)?.use === 'play') || null;
// Playing (js/instruments.js). One tune at a time; the music of the land drops away under it.
async function playTune(id, kind, sched = id ? partNotes(id, DRUMS.has(kind) ? 'drum' : 'melody', null, kind) : null){
  stopTune();
  const p = tunePlaying = { id, kind, perf: null };
  stopTuneBtn.classList.remove('hide');
  const perf = await instruments.play(kind, sched).catch(e => { console.warn('instruments:', e); return null; });
  if (tunePlaying !== p){ perf?.stop(); return; }
  if (!perf){ stopTune(); return; }
  p.perf = perf;
  perf.done.then(() => { if (tunePlaying === p) stopTune(); });
}
function stopTune(){ stopTuneBtn.classList.add('hide'); if (!tunePlaying) return; tunePlaying.perf?.stop(); tunePlaying = null; }
// the first `secs` of a part (partNotes), dying away over its last `fade`: a taste of a tune,
// as you play a villager the start of it (the whole thing ran on too long)
function excerpt({ notes }, secs = 6, fade = 2){
  const out = notes.filter(n => n.t < secs).map(n => ({ ...n, dur: Math.min(n.dur, secs - n.t),
    vel: (n.vel ?? 0.82) * Math.max(0.1, Math.min(1, (secs - n.t) / fade)) }));
  return { notes: out, length: secs };
}
// an instrument clicked in the pack: stop it if it's playing; else a tune you know (asked
// which, if you know several), or without one a few notes up and down
const NOODLE = [62, 64, 67, 69, 67, 64, 62].map((midi, i) => ({ t: i * 0.32, dur: i === 6 ? 0.9 : 0.3, midi }));
function playFromPack(box){
  const kind = box.kind, name = ingredient(kind).label;
  if (tunePlaying?.kind === kind){ stopTune(); return 'You stop playing.'; }
  const known = [...tunesRead];
  if (!known.length){ playTune(null, kind, { notes: NOODLE, length: 2.8 }); return `You play a few notes on the ${name}. You don't know a tune for it yet; the old books have some.`; }
  if (known.length === 1){ playTune(known[0], kind); return `You play ${known[0]} on the ${name}.`; }
  inDialog = true;
  talkTree({ root: 'pick', speaker: cap(name), nodes: { pick: { text: 'Play which tune?',
    choices: known.map(id => ({ label: `${cap(id)}.`, next: null, run: () => playTune(id, kind) })) } } },
    { onClose: () => { inDialog = false; } });
  return null;
}

// Listening in (docs/music.md): the folk's tunes at the fires (music-sim.js stepMusic), and a
// tune someone plays you in talk, each player sounded from where they sit and fading with
// distance, each on their part (arrange.js: the tune, a counter-line, the tune low, the drum).
// A tune already going when you come in earshot is joined where it's got to. All of it is
// heard in the room you're in (instruments.js ROOMS).
const HEAR_R = 90, BAND_R = 10;
const heardFires = new Map();     // fire → { M, players: [{ npc, perf }] }
let playedForYou = null;          // [{ npc, perf }]
// one player's part, from `at` seconds in (null if they've nothing left to play)
function playPart(id, p, at, still){
  let s = partNotes(id, p.part, DRUMS.has(p.kind) ? null : knownSet(p.k), p.kind);
  if (p.f != null) s = roughen(s, p.f, `${p.npc.id}|${id}|${p.part}`);   // as their hands have it (music-sim.js fluencyOf)
  const notes = s.notes.filter(n => n.t >= at).map(n => ({ ...n, t: n.t - at }));
  if (!notes.length) return null;
  const r = { npc: p.npc, perf: null, until: performance.now() / 1000 + s.length - at };
  instruments.play(p.kind, { notes, length: s.length - at }, { gain: 0 }).then(perf => { if (still()) r.perf = perf; else perf?.stop(); });
  return r;
}
// npc plays you a tune, and anyone near them with an instrument and some of it joins in (a
// drummer always can); returns who joined
function playForYou(npc, id, kind, k){
  for (const r of playedForYou || []) r.perf?.stop();
  const handsOf = (o, kd) => DRUMS.has(kd) ? null : fluencyOf(o, id, agents.time);
  const band = [{ npc, kind, k: DRUMS.has(kind) ? phraseCount(id) : k, f: handsOf(npc, kind) }];
  for (const o of npcApi.npcs){
    if (o === npc || Math.hypot(o.x - npc.x, o.z - npc.z) > BAND_R || !instrumentOf(o)) continue;
    const ok = DRUMS.has(o.instrument) ? phraseCount(id) : phrasesKnown(o, id, agents.time);
    if (ok) band.push({ npc: o, kind: o.instrument, k: ok, f: handsOf(o, o.instrument) });
  }
  parts(band, id).forEach((part, i) => { band[i].part = part; });
  const rec = playedForYou = [];
  for (const p of band){ const r = playPart(id, p, 0, () => playedForYou === rec); if (r) rec.push(r); }
  return band.slice(1);
}
function placeSound(r){
  if (!r.perf) return 0;
  const dx = r.npc.x - pos.x, dz = r.npc.z - pos.z, d = Math.hypot(dx, dz);
  camera.getWorldDirection(_fwd);
  const fl = Math.hypot(_fwd.x, _fwd.z) || 1, rx = -_fwd.z / fl, rz = _fwd.x / fl;   // the right hand
  const g = down ? 0 : Math.pow(Math.max(0, 1 - d / HEAR_R), 1.6);
  r.perf.place(g, d > 0.5 ? (dx * rx + dz * rz) / d : 0);
  return g;
}
// who you've heard play lately, and what (play-talk.js reads it: you can only remark on playing
// you actually heard). A sound fades to nothing at HEAR_R; a whisper of it doesn't count.
const heardPlaying = new WeakMap(), HEARD_FOR = 0.1, HEARD_MIN = 0.02;   // days it stays fresh; the gain that counts
const noteHeard = (npc, id) => heardPlaying.set(npc, { id, t: agents.time });
const heardOf = npc => { const h = heardPlaying.get(npc); return h && agents.time - h.t < HEARD_FOR ? h : null; };
// someone at their practice, out at their spot (music-sim.js stepPractice): each go at the
// phrase is sounded from where they sit, joined where it's got to
const heardPractice = new Map();  // npc → { go, r }
function practiceTick(){
  for (const n of npcApi.npcs){
    const go = n.practice ? practiceGo(n, agents.time) : n.piping?.go ?? null, d = Math.hypot(n.x - pos.x, n.z - pos.z);   // (or a shepherd on their pipe, js/shepherd.js)
    let h = heardPractice.get(n);
    if (h && (h.go !== go || down || d > HEAR_R + 10)){ h.r.perf?.stop(); heardPractice.delete(n); h = null; }
    if (!h && go && !down && d < HEAR_R){
      const at = go.length - go.left, notes = go.notes.filter(x => x.t >= at).map(x => ({ ...x, t: x.t - at }));
      if (!notes.length) continue;
      const r = { npc: n, perf: null }, hh = h = { go, r };
      heardPractice.set(n, h);
      instruments.play(go.kind, { notes, length: go.length - at }, { gain: 0 }).then(perf => { if (heardPractice.get(n) === hh) r.perf = perf; else perf?.stop(); });
    }
    if (h && placeSound(h.r) > HEARD_MIN && (n.practice || n.piping)) noteHeard(n, n.practice?.id ?? n.piping.id);
  }
}
function listenTick(){
  instruments.setRoom(!down ? 'open' : down.L.site === 'palace' ? 'palace' : down.L.kind === 'cave' ? 'cave' : 'crypt');
  for (const f of agents.fires){
    const M = f.music?.tune ? f.music : null, d = Math.hypot(f.x - pos.x, f.z - pos.z);
    let h = heardFires.get(f);
    if (h && (h.M !== M || down || d > HEAR_R + 10)){ for (const r of h.players) r.perf?.stop(); heardFires.delete(f); h = null; }
    if (!h && M && !down && d < HEAR_R){
      const hh = h = { M, players: [] }, at = M.length - M.left;
      heardFires.set(f, h);
      for (const p of M.players){ const r = playPart(M.tune, p, at, () => heardFires.get(f) === hh); if (r) hh.players.push(r); }
    }
    if (h) for (const r of h.players) if (placeSound(r) > HEARD_MIN && M && M.length - M.left < (M.players.find(p => p.npc === r.npc)?.len ?? 0)) noteHeard(r.npc, M.tune);
  }
  practiceTick();
  for (const r of playedForYou || []) placeSound(r);
  palaceBandTick();
  wardenTick();
}
// The Gentry's musicians (docs/music.md "The Gentry's way"): in a palace's great halls (its
// rooms of kind 'hall' or 'crossing', the biggest four), four of them in a ring in the middle,
// playing the Gentry's tunes one after another, their way (arrange.js gentryParts). Only the
// band nearest you plays; walk to another hall and that one starts up. Elf billboards, unlit.
const BAND_KINDS = ['silver pipes', 'vielle', 'harp', 'harp'], PALACE_HEAR = 45, BANDS_MAX = 4;
const GENTRY_TUNES = Object.keys(TUNES).filter(id => TUNES[id].style === 'gentry');
const elfTex = ['male', 'female'].map(g => { const t = crisp(new THREE.TextureLoader().load(`sprites/billboards/${g}-peasant-elf.png`)); t.colorSpace = THREE.SRGBColorSpace; return t; });
let palaceBand = null;   // { L, bands: [{ x, y, z, sprites, players: [{ npc, kind, part }] }], at: the band playing, perfs, next, tune }
function makePalaceBands(L){
  const big = R => R.kind === 'hall' || R.kind === 'crossing';
  const rooms = L.regions.filter(R => R.type === 'room' && R.kind !== 'landing' && R.kind !== 'head');
  const halls = (rooms.some(big) ? rooms.filter(big) : rooms)          // (a palace dealt no great hall: its biggest rooms)
    .sort((a, b) => b.w * b.h - a.w * a.h).slice(0, BANDS_MAX);
  const bands = halls.map((R, h) => {
    const players = BAND_KINDS.map((kind, i) => {
      let x = R.cx, z = R.cz;
      for (const rad of [2.4, 1.6, 0.8]){                 // in a ring, closer in if a pillar's in the way
        const a = (i + 0.5) * Math.PI / 2 + h, px = R.cx + Math.cos(a) * rad, pz = R.cz + Math.sin(a) * rad;
        if (L.walkable(px, pz)){ x = px; z = pz; break; }
      }
      return { npc: { x, z }, kind };
    });
    const sprites = players.map((p, i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: elfTex[i % 2], transparent: true, alphaTest: 0.1, color: 0xe8e0ff }));
      s.scale.set(1.0, 2.05, 1); s.position.set(p.npc.x, R.y + 1.02, p.npc.z);
      return s;
    });
    return { x: R.cx, y: R.y, z: R.cz, sprites, players };
  });
  return { L, bands, at: null, perfs: [], next: 0, tune: (L.seed ?? 0) % Math.max(1, GENTRY_TUNES.length) };
}
const stopBandMusic = P => { for (const r of P.perfs) r.perf?.stop(); P.perfs = []; };
function stopPalaceBand(){ if (!palaceBand) return; stopBandMusic(palaceBand); for (const b of palaceBand.bands) for (const s of b.sprites) s.removeFromParent(); palaceBand = null; }
// The Post-Warden (js/mail.js): one of the fae, at a desk by the water in the Grounds. One for now;
// Faerie will be peopled as the Lea is, so nothing else may rely on there being only this.
const WARDEN_AT = { x: 0, z: -14 };
let wardenSprite = null, nearWarden = false;
function wardenSpot(L){ for (const r of [14, 16, 12, 18]) for (let a = 0; a < 12; a++){ const x = Math.cos(a * 0.52) * r, z = Math.sin(a * 0.52) * r; if (L.walkable(x, z)) return { x, z }; } return WARDEN_AT; }
function wardenTick(){
  const here = down?.L.id === GROUNDS;
  if (!here){ wardenSprite?.removeFromParent(); return; }
  if (!wardenSprite){
    wardenSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: elfTex[1], transparent: true, alphaTest: 0.1, color: 0xd8d0f0 }));
    wardenSprite.scale.set(1.15, 2.36, 1);
    Object.assign(WARDEN_AT, wardenSpot(down.L));
  }
  if (wardenSprite.parent !== down.view.scene){ wardenSprite.position.set(WARDEN_AT.x, down.L.floorAt(WARDEN_AT.x, WARDEN_AT.z) + 1.18, WARDEN_AT.z); down.view.scene.add(wardenSprite); }
}
function talkToWarden(){
  inDialog = true; document.exitPointerLock?.();
  talkTree(mail.wardenTree(), { onClose: () => { inDialog = false; relock(); } });
}
function palaceBandTick(){
  if (down?.L.site !== 'palace' || !GENTRY_TUNES.length){ stopPalaceBand(); return; }
  if (palaceBand?.L !== down.L){ stopPalaceBand(); palaceBand = makePalaceBands(down.L); }
  const P = palaceBand, now = performance.now() / 1000;
  if (!P.bands.length) return;
  for (const b of P.bands) for (const s of b.sprites) if (s.parent !== down.view.scene) down.view.scene.add(s);
  const dist = b => Math.hypot(b.x - upos.x, (b.y - upos.y) * 3, b.z - upos.z);   // (another floor's hall is far)
  const near = P.bands.reduce((a, b) => dist(b) < dist(a) ? b : a);
  if (near !== P.at){ stopBandMusic(P); P.at = near; P.next = now + 2; }
  const B = P.at;
  if (now >= P.next){                                    // the next tune, a few seconds after the last
    const id = GENTRY_TUNES[P.tune++ % GENTRY_TUNES.length], ps = B.players, mine = P.perfs = [];
    parts(ps, id).forEach((part, i) => { ps[i].part = part; });
    let len = 0;
    for (const p of ps){
      const s = partNotes(id, p.part, null, p.kind), r = { npc: p.npc, perf: null };
      len = Math.max(len, s.length);
      instruments.play(p.kind, s, { gain: 0 }).then(perf => { if (palaceBand === P && P.perfs === mine) r.perf = perf; else perf?.stop(); });
      mine.push(r);
    }
    P.next = now + len + 5;
  }
  camera.getWorldDirection(_fwd);
  const fl = Math.hypot(_fwd.x, _fwd.z) || 1, rx = -_fwd.z / fl, rz = _fwd.x / fl, dy = Math.abs(B.y - upos.y) * 3;
  for (const r of P.perfs){
    if (!r.perf) continue;
    const dx = r.npc.x - upos.x, dz = r.npc.z - upos.z, d = Math.hypot(dx, dz), D = Math.hypot(d, dy);
    r.perf.place(Math.pow(Math.max(0, 1 - D / PALACE_HEAR), 1.4), d > 0.5 ? (dx * rx + dz * rz) / d : 0);
  }
}
// who's playing right now, for the notes over their heads (talk-view.js): the fires' players
// while their part lasts, and a band playing for you
function playingNow(){
  if (down) return [];
  const out = [], now = performance.now() / 1000;
  for (const f of agents.fires){
    const M = f.music; if (!M?.tune) continue;
    const at = M.length - M.left;
    for (const p of M.players) if (at < p.len) out.push(p.npc);
  }
  for (const r of playedForYou || []) if (now < r.until && !out.includes(r.npc)) out.push(r.npc);
  for (const n of heardPractice.keys()) if (!out.includes(n)) out.push(n);   // at their practice, while a go at it sounds
  return out;
}

// where each thing underground is aimed at
const underAim = {
  find: (f, L) => [f.x, (f.view ? f.view.position.y : f.y ?? L.floorAt(f.x, f.z)) + 0.2, f.z],   // (where it's drawn: a key hovers over its chest)
  sconce: s => [s.x, s.aimY ?? s.y + 0.45, s.z],            // a torch on the wall, by its head
  shelf: s => [s.x, s.y + s.h * 0.55, s.z],                 // a bookshelf, by its middle
  door: d => [d.x - Math.cos(d.a) * 0.1, d.y + 1.6, d.z - Math.sin(d.a) * 0.1],   // a locked door, by its lock
  chest: c => [c.x, c.y + c.h, c.z],                        // a shut chest, by its lid
  warden: L => [WARDEN_AT.x, L.floorAt(WARDEN_AT.x, WARDEN_AT.z) + 1.6, WARDEN_AT.z],
};

// underground, what's in front of you: a find to take, or the way out
function underFocus(){
  camera.getWorldDirection(_fwd);
  const L = down.L;
  let best = null, bd = 0.9;
  for (const f of L.finds){
    if (f.taken || (f.chest != null && !L.chests[f.chest].open)) continue;   // (what's in a shut chest can't be seen)
    const [ax, ay, az] = underAim.find(f, L), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; best = f; }
  }
  // a torch on the wall, aimed at by its head
  let sc = null;
  for (const s of L.sconces || []){
    const [ax, ay, az] = underAim.sconce(s), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; sc = s; best = null; }
  }
  // a bookshelf, aimed at by its middle
  let sh = null;
  for (const s of L.shelves || []){
    const [ax, ay, az] = underAim.shelf(s), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, d = Math.hypot(dx, dy, dz);
    if (d > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
    if (dot > bd){ bd = dot; sh = s; sc = null; best = null; }
  }
  // a locked door (aimed at by its lock), and a shut chest (by its lid); open ones are only furniture
  let dr = null, ch = null;
  for (const d of L.doors || []){
    if (d.open) continue;
    const [ax, ay, az] = underAim.door(d), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, dd = Math.hypot(dx, dy, dz);
    if (dd > TALK_RANGE + 1) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / dd;
    if (dot > Math.min(bd, 0.75)){ bd = dot; dr = d; sh = sc = best = null; }            // (a broad thing: a wider cone)
  }
  for (const c of L.chests || []){
    if (c.open) continue;
    const [ax, ay, az] = underAim.chest(c), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, dd = Math.hypot(dx, dy, dz);
    if (dd > TALK_RANGE) continue;
    const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / dd;
    if (dot > bd){ bd = dot; ch = c; dr = sh = sc = best = null; }
  }
  nearWarden = false;
  if (L.id === GROUNDS){
    const [ax, ay, az] = underAim.warden(L), dx = ax - upos.x, dy = ay - upos.y, dz = az - upos.z, dd = Math.hypot(dx, dy, dz);
    if (dd < TALK_RANGE && (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / dd > Math.min(bd, 0.75)){ nearWarden = true; dr = sh = sc = ch = best = null; }
  }
  // what the glance is on, if it's in reach, wins wherever it is on the screen
  const t = glance.target, q = t && glance.at;
  if (q && Math.hypot(q.x - upos.x, q.y - upos.y, q.z - upos.z) <= (q.range ?? TALK_RANGE)){
    const isFind = L.finds.includes(t), isSc = (L.sconces || []).includes(t), isSh = (L.shelves || []).includes(t), isDr = (L.doors || []).includes(t), isCh = (L.chests || []).includes(t);
    if (t === WARDEN_AT || isFind || isSc || isSh || isDr || isCh){
      best = isFind ? t : null; sc = isSc ? t : null; sh = isSh ? t : null; dr = isDr ? t : null; ch = isCh ? t : null; nearWarden = t === WARDEN_AT;
    }
  }
  nearFind = best; nearSconce = sc; nearShelf = sh; nearDoor = dr; nearChest = ch;
  // a tomb, by its slab, when you're looking at nothing else: what's on a lid gets taken first
  nearTomb = null;
  if (!best && !sc && !sh && !dr && !ch && !nearWarden && L.kind === 'crypt' && L.site !== 'palace'){
    let td = 0.8;
    for (const p of L.props){
      if (p.kind !== 'coffin') continue;
      const dx = p.x - upos.x, dy = p.y + p.h - upos.y, dz = p.z - upos.z, d = Math.hypot(dx, dy, dz);
      if (d > TALK_RANGE + 1) continue;
      const dot = (dx * _fwd.x + dy * _fwd.y + dz * _fwd.z) / d;
      if (dot > td){ td = dot; nearTomb = p; }
    }
  }
  nearExit = L.mouths.findIndex(m => Math.hypot(m.x - upos.x, m.z - upos.z) < 6 && (m.fy == null || Math.abs(m.fy - (upos.y - EYE)) < 2.5));   // (the stair's doors: only at their own height)
  hoverPanel.style.display = 'flex'; hoverFace.style.display = 'none'; hoverName.style.display = ''; hoverAmbient.style.display = '';
  // the lake's canoe: in it, nothing else is in reach but the water; beside it, it's yours to take
  const canoe = down.view.canoe;
  if (boating){
    nearFind = nearSconce = nearShelf = nearDoor = nearChest = nearTomb = null; nearExit = -1;
    nearFish = L.eelsAt(upos.x, upos.z) ? L.eels : null;
    if (nearFish){ hoverName.textContent = 'Black water'; hoverAmbient.textContent = L.eels.stock < 0.3 ? 'Deep and still. Fished hard, lately.' : 'Deep and still. Eels lie down there in the dark.'; }
    else { hoverName.textContent = 'The lake'; hoverAmbient.textContent = 'Shallow here. Paddle out to the deep water to fish.'; }
    return;
  }
  if (canoe && !best && !sc && !sh && !dr && !ch && Math.hypot(canoe.x - upos.x, canoe.z - upos.z) < 3.5){
    nearBoat = canoe; nearExit = -1;
    hoverName.textContent = 'A bark canoe'; hoverAmbient.textContent = 'Drawn up at the edge of the black water, a paddle across it.';
    return;
  }
  if (nearWarden){ nearExit = -1; hoverName.textContent = 'The Post-Warden'; hoverAmbient.textContent = 'One of them, at a tall desk. Letters in, letters out.'; return; }
  if (sh){ const [t, d] = sh.lectern ? LECTERN : sh.palace ? PALACE_SHELF : SHELF_LABEL[sh.state]; hoverName.textContent = t; const b = bookRecipe(sh), mb = shelfMusic(sh), cr = shelfCraft(sh);
    hoverAmbient.textContent = cr ? (craftsRead.has(cr) ? `${CRAFTS[cr].book}: copied into your book.` : 'Kept dry: one book, its spine marked with a drawing of an instrument.') : mb ? (tunesRead.has(shelfTune(sh)) ? `${cap(shelfTune(sh))}: copied into your book.` : sh.palace || sh.lectern ? d : 'Mould on all of them but one, in a leather case.')
      : b && (recipesRead.has(b) || faerieRead.has(b)) ? `${cap(b)}: copied into your book.` : b && sh.state !== 'book' ? 'Mould on all of them but one, in a leather case.' : d; }
  else if (dr){ hoverName.textContent = 'A locked door'; hoverAmbient.textContent = `Oak, banded with iron. ${cap(dr.sign)} is worked in iron across its two leaves.`; }
  else if (ch){ hoverName.textContent = 'A chest'; hoverAmbient.textContent = 'An oak coffer, bound in iron, shut but not locked.'; }
  else if (sc){ const [t, d] = (LIGHT_LABEL[sc.kind || 'torch'] || LIGHT_LABEL.torch)[sc.lit ? 1 : 0]; hoverName.textContent = t; hoverAmbient.textContent = d; }
  else if (best){ const [t, d] = FIND_LABEL[best.kind] || [best.kind, '']; hoverName.textContent = t; hoverAmbient.textContent = d; }
  else if (nearExit >= 0){ const m = L.mouths[nearExit]; hoverName.textContent = m.label ? cap(m.label) : 'The way out'; hoverAmbient.textContent = m.desc || 'Daylight, and the air of the world above.'; }
  else { hoverName.textContent = down.name; hoverAmbient.textContent = 'Your torch lights a few strides of rock.'; }
}

// ---------- your own book (js/book-view.js): spells, recipes, tunes, crafts, the journal ----------
// C opens it at the spells and J at the journal's latest spread; a tab goes to a section.
// The spells: click one, or press its number, from any page. Teleport opens the world map to
// choose a spot, from anywhere, underground included; Fly is the fly camera; Wizard Eye shows
// the whole of the level you're in, or of the Lea; Town Portal opens it to choose among the settlements you've seen.
// Each costs spell points (vitals.js): Teleport and Town Portal when you land,
// Fly to rise and then a trickle while you're up (run out and you drift down), Wizard Eye at once.
// a little pixel sigil for each spell, drawn on a 16px grid, until its plate is drawn (sprites/spells/<id>.png)
function sigil(kind){
  const cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const g = cv.getContext('2d'), px = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++){
    const dx = x - 7.5, dy = y - 7.5, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    if (kind === 'teleport'){                                           // a swirl going in
      const s = ((th + Math.PI) / (Math.PI * 2) + r / 5) % 1;
      if (r < 7.5 && s < 0.35) px(x, y, r < 3 ? '#8a6a20' : '#3a4a78');
    } else if (kind === 'fly'){                                         // a feather
      const spine = Math.abs(dx + dy * 0.6) < 0.8 && r < 7;
      const vane = Math.abs(dx + dy * 0.6) < 3.2 - Math.abs(dy) * 0.25 && dy > -6 && dy < 5;
      if (spine) px(x, y, '#3a2a14'); else if (vane) px(x, y, '#4a6a88');
    } else if (kind === 'eye'){                                         // an eye
      const lid = Math.abs(dy) < 4.5 * Math.cos(dx / 8 * Math.PI / 2) && Math.abs(dx) < 7.5;
      if (r < 2.2) px(x, y, '#101010'); else if (r < 3.6) px(x, y, '#8a6a20'); else if (lid) px(x, y, '#c9b48a');
    } else if (kind === 'town'){                                        // a house, its door lit
      const door = x >= 7 && x <= 8 && y >= 11 && y <= 14;
      const roof = y >= 2 && y <= 7 && Math.abs(dx) <= y - 1;
      const wall = y >= 8 && y <= 14 && Math.abs(dx) <= 5;
      if (door) px(x, y, '#8a6a20'); else if (roof) px(x, y, '#3a2a14'); else if (wall) px(x, y, '#3a4a78');
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
  { id: 'eye', name: 'Wizard Eye', cost: 5, desc: 'See the whole shape of the place you are in.', can: () => true,
    cast(){
      spend(me, 5);
      if (down) maps.revealAll(); else maps.revealLand();
      setForageMsg(`The whole of ${down ? down.name : 'the Lea'} opens in your mind.`, 3000); relock(); } },
  { id: 'town', name: 'Town Portal', cost: 6, desc: 'Step through to any town you have seen.', can: () => knownTowns().length > 0, why: 'You have not seen a town yet.', cast: castTownPortal },
];
const spellsKnown = new Set();     // none to begin with (the GRIMOIRE cheat teaches them all)
const knownSpells = () => SPELLS.filter(sp => spellsKnown.has(sp.id));
const affords = sp => (sp.free && sp.free()) || me.sp >= sp.cost;
const POOR = 'Not enough strength left in you.';
function relock(){ if (playing && !document.body.classList.contains('cursor-mode')){ try { canvas.requestPointerLock(); } catch (_){} } }
const bookEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const entryEl = (html, cls = 'entry') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; return e; };
const plateMissing = new Set();     // plates not drawn yet: asked for once, then the sigil
function stampPlate(rec){
  const e = entryEl(`<div class="pic">${rec.url ? `<img src="${rec.url}" alt="" draggable="false">` : ''}</div><div class="name">${bookEsc(rec.stamp.realmName)}, ${rec.stamp.value}${rec.stamp.kind === 'faerie' ? '' : 'd'}</div>`, 'plate stamp-plate');
  e.dataset.desc = `No. ${rec.stamp.copy}. Came on a letter from ${rec.from}.`;
  e.onclick = () => mail.loupe(rec);
  return e;
}
function spellPlate(sp, i){
  const can = sp.can(), ok = can && affords(sp);
  const el = entryEl(`<div class="pic"></div><span class="key">${i + 1}</span><div class="name">${bookEsc(sp.name)}</div><div class="cost">${bookEsc(sp.costNote || sp.cost)} spell points</div>`, 'plate' + (ok ? '' : ' off'));
  el.dataset.desc = !can ? sp.why : !ok ? POOR : sp.desc;
  const pic = el.querySelector('.pic');
  if (plateMissing.has(sp.id)) pic.appendChild(sigil(sp.id));
  else {
    const im = new Image(); im.alt = ''; im.draggable = false;
    im.onerror = () => { plateMissing.add(sp.id); im.replaceWith(sigil(sp.id)); };
    im.src = `sprites/spells/${sp.id}.png`;
    pic.appendChild(im);
  }
  el.onclick = () => castSpell(i);
  return el;
}
// what you've read in the crypts' books, each ingredient marked if you carry it
function recipeBlocks(){
  const rows = [...recipesRead].map(id => {
    if (PREPARATIONS[id]){                     // a preparation: each want marked only if got rightly
      const again = madeOnce.has(id), wants = wantsMet(myPack, id, again).map(m => `<span class="${m.ok ? 'have' : ''}${RARE[m.want.kind] ? ' rare' : ''}">${bookEsc(m.want.n > 1 ? `${m.want.n} ${m.want.kind}` : m.want.kind)}${m.want.test && m.have >= m.want.n && !m.ok ? ' (not rightly got)' : ''}</span>`).join(' · ');
      return entryEl(`<div class="name">${bookEsc(cap(id))}</div><div class="wants">${wants} — ${again ? 'any stargazer has the rest put by, any day' : 'made by a stargazer, at the new moon'}</div>`);
    }
    const wants = recipeWants(id).map(alts => {
      const have = alts.some(k => (basket[k] || 0) > 0), rare = alts.some(k => RARE[k]);
      return `<span class="${have ? 'have' : ''}${rare ? ' rare' : ''}">${bookEsc(alts.join(' or '))}</span>`;
    }).join(' · ');
    return entryEl(`<div class="name">${bookEsc(cap(id))}</div><div class="wants">${wants}</div>`);
  });
  // the Gentry's books: what they want, in their own words; marked where it's a thing you carry
  const lore = [...faerieRead].map(id => {
    const B = FAERIE_BOOKS[id];
    const wants = B.wants.map(w => `<span class="${B.kinds.some(k => w.includes(k) && (basket[k] || 0) > 0) ? 'have' : ''}">${bookEsc(w)}</span>`).join(' · ');
    return entryEl(`<div class="name">${bookEsc(cap(id))}</div><div class="wants">${wants} — from ${bookEsc(B.from.charAt(0).toLowerCase() + B.from.slice(1))}</div>`);
  });
  return [...rows, ...(lore.length ? [entryEl("From the Gentry's library", 'bp-h keep'), entryEl('Out of mortal books, kept in Faerie. Most want things not yet found in the Lea.', 'bp-sub keep'), ...lore] : [])];
}
// the tunes you've read (docs/music.md): each with what it's for, and the book it's out of
function tuneBlocks(){
  return [...tunesRead].map(id => entryEl(`<div class="name">${bookEsc(cap(id))}</div><div class="about">${bookEsc(TUNES[id].about)}${TUNES[id].book ? ` — from ${bookEsc(MUSIC_BOOKS[TUNES[id].book].from.toLowerCase())}` : ''}</div>`));
}
// the instruments you know how to make (making.js): what each wants, marked where you carry
// it; click one you've everything for to make it
function craftBlocks(){
  return [...craftsRead].map(k => {
    const it = ingredient(k), can = canMake(myPack, k);
    const wants = CRAFTS[k].needs.map(([m, n]) => `<span class="${(basket[m] || 0) >= n ? 'have' : ''}">${bookEsc(`${n > 1 ? n + ' ' : ''}${ingredient(m)?.label || m}`)}</span>`).join(' · ');
    const el = entryEl(`${it.pic?.[0] ? `<div class="pic"><img src="${bookEsc(it.pic[0])}" alt=""></div>` : ''}<div class="name">${bookEsc(cap(it.label))}${can ? ' <span class="act">— make one</span>' : ''}</div><div class="wants">${wants}</div>`);
    if (can){
      el.style.cursor = 'pointer';
      el.onclick = () => { myBook.say(makeCraft(k)); myBook.refresh(); };
    }
    return el;
  });
}
let bookRelocks = true;      // shutting the book takes the look back, unless a spell has something else for you
const myBook = makeBook({
  onClose: () => { if (bookRelocks) relock(); },
  onSection: id => { if (id === 'journal'){ journal.read(); markJournal(); } },
  onIcon: () => journal.unread ? openJournal() : openBook(),     // the dot says the Log's new: that's where it opens
  sections: [
    { id: 'journal', title: 'Log', tab: 'log', always: true, empty: 'Nothing written yet. What I find, and who I meet that comes to anything, goes here.', blocks: () => journalBlocks(journal, mail.linkNames) },
    { id: 'recipes', title: 'Food', tab: 'food', sub: 'Copied from the old books. Ticked: what you carry; starred: found only in hard places.', blocks: recipeBlocks },
    { id: 'crafts', title: 'Making Things', tab: 'making', sub: "Copied from the makers' books. Ticked: what you carry.", blocks: craftBlocks },
    { id: 'tunes', title: 'Song', tab: 'song', sub: 'Copied from the music books. Play one on an instrument from your pack.', blocks: tuneBlocks },
    { id: 'folk', title: 'Folk', tab: 'folk', sub: 'Everyone I know of, and whose people they are. A name turns to their page.', blocks: kinBlocks },
    { id: 'stamps', title: 'Stamps', tab: 'stamps', bare: true, empty: 'No stamps yet.', blocks: () => mail.album.map(stampPlate) },
    { id: 'spells', title: 'Spells', tab: 'spells', bare: true, empty: "You don't know any spells.", blocks: () => knownSpells().map(spellPlate) },
  ],
});
// a lineage as you know it, drawn by the Bub's own bub-lineage (js/kit/, a link to the kit's file)
function kinBlocks(){
  const block = (cls, fill) => { const e = document.createElement('div'); e.className = cls; fill(e); return e; };
  return mail.kinTrees().filter(t => t.data).flatMap(t => [
    block('kin-name keep', e => { e.textContent = t.surname; e.dataset.anchor = `line:${t.surname}`; }),      // (`keep`: goes over the page with what it heads)
    ...treePieces(t.data.tree).map(q => block(`kin-line${q.head ? ' keep' : ''}`, e => {
      e.style.marginLeft = `${q.depth * 0.9}em`;
      window.bubLineage.tree(e, { tree: q.tree });
    })),
  ]).concat(mail.peopleKnown().flatMap(q => personBlocks(mail.personRecord(q), mail.linkNames)));
}
function openBook(id, how){
  if (invOpen) closeInventory();
  myBook.open(id, how);
  document.exitPointerLock?.();
}
function castSpell(i){
  const sp = knownSpells()[i];
  if (!sp || !sp.can()) return;
  if (!affords(sp)){ setForageMsg(POOR, 2500); return; }
  bookRelocks = false; myBook.close(); bookRelocks = true;
  sp.cast();
}
// the nearest dry ground to a spot, within 24u, or null
function dryGroundNear(x, z){
  for (let r = 0; r <= 24; r += 1.5) for (let q = 0; q < 16; q++){
    const a = q / 16 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (Math.hypot(px, pz) < WORLD_R && walkable(px, pz)) return [px, pz];
  }
  return null;
}
// a spell puts you down at a spot: out of any level you were in, out of any boat (it stays where it was)
function arriveBySpell(spot, then){
  fade(() => {
    if (down){ down = null; nearFind = null; nearExit = -1; nearSconce = null; maps.setLevel(null); }
    if (boating){ boating.aboard = false; boating = null; }
    pos.x = spot[0]; pos.z = spot[1]; pos.y = height(pos.x, pos.z) + EYE;
    then();
  });
}
// Teleport: choose on the world map, then stand on the nearest dry ground to it.
// From underground you come up out of the level wherever you chose.
function castTeleport(){
  maps.pick((x, z) => {
    const spot = dryGroundNear(x, z);
    relock();
    if (!spot){ setForageMsg('There is nothing to stand on there.'); return; }
    if (!spend(me, 8)){ setForageMsg(POOR, 2500); return; }
    arriveBySpell(spot, () => setForageMsg(`You step out of the air ${placePhrase(placeAt(pos.x, pos.z))}.`, 3500));
  }, down ? upos.x : pos.x, down ? upos.z : pos.z, yaw);
}
// Town Portal: the settlements you've seen, farmsteads too. They are the same ones the map
// names, so the spell can't give away a place still in the dark.
function knownTowns(){
  const names = settlementNames();
  return settlements().places.flatMap((p, i) => maps.seen(p.x, p.z) ? [{ x: p.x, z: p.z, gate: p.gate, kind: p.kind, name: names[i].name }] : []);
}
// You choose a town on the world map and come out at its gate, facing in.
function castTownPortal(){
  maps.pickPlace(knownTowns(), t => {
    const spot = dryGroundNear(t.gate[0], t.gate[1]);
    relock();
    if (!spot){ setForageMsg('There is nothing to stand on there.'); return; }
    if (!spend(me, 6)){ setForageMsg(POOR, 2500); return; }
    arriveBySpell(spot, () => {
      yaw = Math.atan2(-(t.x - spot[0]), -(t.z - spot[1]));
      setForageMsg(`You step through to ${t.name}.`, 3500);
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
const CHEATS = { CHEF: () => chef(), TPTOTRADER: () => toTrader(), GENEALOGICAL: () => { const n = mail.learnKin(); setForageMsg(`Every family tree is in your book: ${n} lineages.`, 4000); }, GRIMOIRE: () => { for (const sp of SPELLS) spellsKnown.add(sp.id); setForageMsg('You know every spell. They are in your book.'); }, SALVEMEUP: () => { stow('fairy salve', 1, null); stow('four-leaf clover', 1, { ...provHere('picked'), hour: 5.2, thin: ['fairy ring'] }); recipesRead.add('fairy salve'); madeOnce.add('fairy salve'); }, STARGAZE: () => stow('telescope', 1, null), MUSICAL: musical, BONES: bones };
// TPTOTRADER: stood a few steps from a trader, facing them; again for the next one
let traderTp = 0;
function toTrader(){
  const list = agents.traders?.list || [];
  if (down || boating) return setForageMsg('Not from here.');
  if (!list.length) return setForageMsg('There are no traders on the road.');
  const t = list[traderTp++ % list.length], n = t.who;
  if (n._indoors) return setForageMsg(`${displayName(n)} is indoors.`);
  for (let i = 0; i < 12; i++){
    const a = i * 0.52 + 0.3, x = n.x + Math.cos(a) * 4, z = n.z + Math.sin(a) * 4;
    if (!walkable(x, z) && i < 11) continue;
    pos.x = x; pos.z = z; pos.y = height(x, z) + EYE;
    yaw = Math.atan2(-(n.x - x), -(n.z - z)); pitch = -0.1;
    break;
  }
  setForageMsg(`${displayName(n)}${list.length > 1 ? ` (${(traderTp - 1) % list.length + 1} of ${list.length}; again for the next)` : ''}.`, 4000);
}
// CHEF: every dish in your book, firewood, two of everything they want, as far as the pack holds them, and you stood at a lit fire
function chef(){
  const ids = Object.keys(RECIPES), kinds = [...new Set(ids.flatMap(id => recipeWants(id).flat()))];
  for (const id of ids) recipesRead.add(id);
  myPack.add('wood', 8, null);
  const missed = kinds.filter(k => !myPack.add(k, 2, null));
  const f = !down && !boating && agents.addCampfire(pos.x + 2.5, pos.z, { refine: false });   // (or the one already near: it won't lay two close together)
  if (f){
    f.raise(1e6); f.fuel = Math.max(f.fuel, 0.7); f.addWood(6);
    const d = Math.hypot(pos.x - f.x, pos.z - f.z) || 1;
    pos.x = f.x + (pos.x - f.x) / d * 3; pos.z = f.z + (pos.z - f.z) / d * 3; pos.y = height(pos.x, pos.z) + EYE;
    yaw = Math.atan2(-(f.x - pos.x), -(f.z - pos.z)); pitch = -0.25;
  }
  setForageMsg(`You know every dish.${f ? ' A fire burns before you: E to sit at it.' : ''}${missed.length ? ` No room in your pack for the ${words(missed)}.` : ''}`, 5000);
  if (invOpen) openInventory();
}
// MUSICAL: every tune and every maker's book copied into your book, and one of each instrument you aren't carrying, as far as the pack holds them
function musical(){
  for (const id of Object.keys(TUNES)) tunesRead.add(id);
  for (const k of Object.keys(CRAFTS)) craftsRead.add(k);            // and how to make every instrument that can be made
  const kinds = Object.keys(INGREDIENTS).filter(k => INGREDIENTS[k].use === 'play' && !(myPack.counts[k] > 0));
  const missed = kinds.filter(k => !myPack.add(k, 1, null)).map(k => ingredient(k).label || k);
  setForageMsg(`You know every tune.${missed.length ? ` No room in your pack for the ${words(missed)}.` : ' Every instrument is in your pack.'}`, 5000);
  if (invOpen) openInventory();
}
// BONES: a heap of bones 4u in front of you (js/skeleton.js), above ground or below. Come near
// and it pulls itself together and shows you what it can do, an animation every few seconds;
// walk off and it falls back to pieces. A look at the puppet in the world: the crypts' own
// heaps, and the chase, come later
const heaps = [];                                    // { s, where: the level's id, or null on the Lea }
const SHOW = ['wave', 'talk', 'laugh', 'dance', 'reach', 'look', 'walk', 'run', 'carry', 'stagger', 'idle'];
function bones(){
  const here = down ? upos : pos, where = down ? down.L.id : null, floorAt = down ? down.L.floorAt : height;
  const x = here.x - Math.sin(yaw) * 4, z = here.z - Math.cos(yaw) * 4;
  loadSkeletonKit().then(kit => {
    const s = makeSkeleton(kit, { x, z, floorAt, lit: where !== null, pile: true, seed: heaps.length + 1 });
    heaps.push({ s, where, show: 0, t: 0 });
    setForageMsg('A heap of old bones lies in front of you.', 3000);
  });
}
// the crypts' own skeletons (gen/under.js guards(), js/skeleton-guards.js), made the first time
// you go down into a level and kept with it, so they lie where they fell when you come back
let skelKit = null, guardsHere = null;
loadSkeletonKit().then(k => { skelKit = k; });
// you took something down here (a find, a book, a chest opened, a door unlocked): the
// crypt's bones grow restless, and rise when you walk into their room (skeleton-guards.js)
function disturb(){ if (down?.L.skel) down.L.skel.disturb(); }
// a tomb (docs/skeletons.md): E reads it. With its letter in your pack, the slab slides off and its dead get up for it
let tombRite = null;
function useTomb(p){
  const L = down.L, letter = mail.letterAt(L, p);
  setForageMsg(mail.readTomb(L, p), 6000);
  if (!letter || !skelKit) return;
  tombRite ||= makeTombRite(skelKit);
  if (tombRite.busy) return;
  inDialog = true;
  tombRite.open({ L, view: down.view, p, x: upos.x, z: upos.z, onUp: () => {
    document.exitPointerLock?.();
    talkTree(mail.tombTree(letter), { onClose: () => { inDialog = false; tombRite.done(); relock(); } });
  } });
}
function tickBones(dt, tint){
  const where = down ? down.L.id : null, here = down ? upos : pos, sc = down ? down.view.scene : scene;
  const L = down?.L, G = L?.guards?.length && skelKit ? (L.skel ||= makeGuards(L, skelKit)) : null;
  if (G !== guardsHere){ guardsHere?.leave(); guardsHere = G; }
  if (G) G.update(dt, { x: upos.x, z: upos.z, camera, scene: sc });
  tombRite?.update(dt, L, camera);
  if (sc !== boltScene){ bolts.clear(); boltScene = sc; }
  bolts.update(dt);
  for (const H of heaps){
    if (H.where !== where){ H.s.object.removeFromParent(); continue; }   // (and out of a level's scene before it's disposed)
    if (H.s.object.parent !== sc) sc.add(H.s.object);
    const d = Math.hypot(here.x - H.s.x, here.z - H.s.z), s = H.s;
    if (H.stun > 0){ if ((H.stun -= dt) <= 0 && s.state === 'pile'){ s.stir = 0; s.assemble(); H.t = 0; } else s.stir = H.stun < 1.2 ? 0.8 : 0; }   // struck: up again soon
    else if (s.state === 'pile'){ s.stir = Math.max(0, Math.min(1, (6 - d) / 2.5)); if (d < 3.5){ s.stir = 0; s.assemble(); H.t = 0; } }
    else if (s.state === 'up'){
      if (d > 9) s.collapse();
      else if ((H.t += dt) > 4.5){ H.t = 0; s.play(SHOW[H.show++ % SHOW.length]); s.talking = s.anim === 'walk' || s.anim === 'idle'; }
    }
    s.update(dt, camera, tint);
  }
}
// Light against the dead (docs/skeletons.md): click a skeleton on its feet, in the crypts or a
// BONES heap, and a ball of light (light-bolt.js) flies from your hand and knocks it to bones,
// for a few seconds. A dark torch, brazier or candle it lights. Pointer locked, you aim with the
// crosshair; with the cursor free, where you click. In range, in sight (not through a wall),
// and the nearest under the click. Each throw costs a spell point.
const bolts = makeBolts(), SPELL_RANGE = 30, SPELL_PX = 70, SPELL_SP = 1, _spellV = new THREE.Vector3();
let boltScene = null;
function skeletonsToStrike(){
  const out = [];
  if (guardsHere) for (const m of guardsHere.targets()) out.push({ s: m.s, hit: () => guardsHere.strike(m) });
  const where = down ? down.L.id : null;
  for (const H of heaps) if (H.where === where && (H.s.state === 'up' || H.s.state === 'rising'))
    out.push({ s: H.s, hit: () => { H.s.collapse({ scatter: { r: 1.4, ok: down ? down.L.walkable : null } }); H.stun = 4; } });
  const floorAt = down ? down.L.floorAt : height;
  for (const t of out){ const s = t.s; t.at = v => v.set(s.x, floorAt(s.x, s.z) + 1.15, s.z); }
  return out;
}
function lightsToStrike(){
  return down ? (down.L.sconces || []).filter(s => !s.lit).map(s => ({ s, at: v => v.set(s.x, s.aimY ?? s.y + 0.45, s.z),
    hit: () => { s.lit = true; setForageMsg(`The light catches, and ${LIGHT_VERB[s.kind || 'torch']} burns.`); } })) : [];
}
function castAt(cx, cy){
  if (inDialog || !playing) return false;
  const here = down ? upos : pos, W = innerWidth, H = innerHeight;
  let best = null, bestD = Infinity;
  for (const t of [...skeletonsToStrike(), ...lightsToStrike()]){
    const d3 = Math.hypot(t.s.x - here.x, t.s.z - here.z);
    if (d3 > SPELL_RANGE) continue;
    t.at(_spellV).project(camera);
    if (_spellV.z > 1) continue;
    const px = Math.hypot((_spellV.x + 1) * 0.5 * W - cx, (-_spellV.y + 1) * 0.5 * H - cy);
    if (px > SPELL_PX || d3 >= bestD) continue;
    if (down){                                       // not through rock
      const n = Math.ceil(d3 / 0.5); let clear = true;
      for (let q = 1; q < n && clear; q++) clear = down.L.openAt(here.x + (t.s.x - here.x) * q / n, here.z + (t.s.z - here.z) * q / n);
      if (!clear) continue;
    }
    best = t; bestD = d3;
  }
  if (!best) return false;
  if (!spend(me, SPELL_SP)){ setForageMsg(POOR, 2500); return true; }   // (it was aimed at something: don't fall through to a click)
  const from = new THREE.Vector3(0.25, -0.3, -0.5).applyQuaternion(camera.quaternion).add(camera.position);   // from your right hand
  const aim = new THREE.Vector3(), t = best;
  bolts.cast(down ? down.view.scene : scene, from, () => t.at(aim), t.hit);
  return true;
}
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
  if (scope && /^(Key[WASDE]|Arrow(Up|Down))$/.test(e.code)){ lowerGlass(); return; }   // a step, or E, lowers the telescope
  if (scope && e.code === 'Escape') lowerGlass();     // (and the browser frees the mouse, below, as for any Esc)
  if (sat && /^(Key[WASDE]|Arrow(Up|Down)|Escape)$/.test(e.code)){ getUp(); return; }   // a step, E or Esc: you get up
  if (shearHands.on && /^(KeyE|Escape)$/.test(e.code)){ shearHands.letGo(); return; }
  if (sat && e.code === 'KeyI') return;
  if (placing && e.code === 'Escape') stopPlacing();   // (and the browser frees the mouse, as for any Esc)
  if (placing && e.code === 'KeyE' && inWorld()){ layFire(); return; }
  if (myBook.isOpen){                                 // your book takes the keys while it's open
    if (e.code === 'Escape' || (e.code === 'KeyC' && myBook.section === 'spells') || (e.code === 'KeyJ' && myBook.section === 'journal')) myBook.close();
    else if (e.code === 'KeyC') myBook.open('spells');      // it turns there
    else if (e.code === 'KeyJ') myBook.open('journal', { at: 'end' });
    else if (/^Digit[1-9]$/.test(e.code)) castSpell(+e.code.slice(5) - 1);
    else if (myBook.key(e)) e.preventDefault();
    return;
  }
  if (rest && (e.code === 'KeyR' || e.code === 'Escape' || /^(Key[WASD]|Arrow(Up|Down))$/.test(e.code))){ stopRest(false); return; }   // passing time: R or a step stops it
  if (restOpen){
    if (e.code === 'KeyR' || e.code === 'Escape') closeRest(true);
    else if (/^Digit[1-9]$/.test(e.code)) startRest(+e.code.slice(5) - 1);
    return;
  }
  if (maps.bigOpen && (e.code === 'KeyM' || e.code === 'Escape')){ closeBigMap(); return; }
  if (invOpen && (e.code === 'KeyI' || e.code === 'Escape')){ closeInventory(true); return; }
  if (e.code === 'KeyI' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openInventory(); document.exitPointerLock?.(); return; }
  if (e.code === 'KeyC' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openBook('spells'); return; }
  if (e.code === 'KeyJ' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openJournal(); return; }
  if (e.code === 'KeyR' && playing && !inDialog && !settingsOpen && !skyPicker._open){ if (invOpen) closeInventory(); openRest(); return; }
  if (e.code === 'KeyM' && playing && !inDialog && !settingsOpen && !skyPicker._open){ openBigMap(); return; }
  if (e.code === 'KeyT' && tunePlaying){ stopTune(); return; }
  if (e.key === 'Enter' && playing && !inDialog && !settingsOpen && !skyPicker._open && !invOpen){ e.preventDefault(); openCheat(); return; }
  if (e.code === 'KeyO'){ settingsOpen ? closeSettings() : openSettings(); return; }
  if (e.code === 'KeyL' && document.body.classList.contains('cursor-mode') && !inDialog && !settingsOpen && !skyPicker._open && !invOpen && !maps.bigOpen){ try { canvas.requestPointerLock(); } catch (_){} return; }
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
  const _inLook = inWorld();                            // (E aims at the middle of the screen, cursor free or not)
  if (e.code === 'KeyE' && _inLook && !inDialog) glance.rearm();   // if that uses it up, the eye may go on to the next
  if (e.code === 'KeyE' && _inLook && !inDialog && down){
    if (boating){ if (playerFish) reelIn('You reel in.'); else if (nearFish) castLine(nearFish); else disembark(); }
    else if (nearWarden) talkToWarden();
    else if (nearBoat) board(nearBoat);
    else if (nearShelf) readShelf(nearShelf);
    else if (nearDoor) tryDoor(nearDoor);
    else if (nearChest) openChest(nearChest);
    else if (nearTomb) useTomb(nearTomb);
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
      relock();
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
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearHouseDoor){
    knockAt(nearHouseDoor);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearSign){
    readSign(nearSign);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearMailbox){
    openMailbox(nearMailbox);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearObject){
    sitAt(nearObject);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearShrub){
    cutShrub(nearShrub);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearSheep){
    startShearing(nearSheep);
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearTree){
    inDialog = true; document.exitPointerLock?.();          // examine a tree / speak with a faced one
    const node = nearTree;
    const onClose = () => { inDialog = false; relock(); };
    // faced trees actually talk (first person); the rest are examined by sensation
    talkTree(node.faced ? facedTreeVoice(node, woodCtx()) : treeVoice(node, woodCtx()), { onClose });
  } else if (e.code === 'KeyE' && _inLook && !inDialog && nearRing){
    inDialog = true; document.exitPointerLock?.();          // the fungus itself
    const ring = nearRing;
    const onClose = () => { inDialog = false; relock(); };
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

// ---------- the glance (js/glance.js): for walking with the keys alone ----------
// What can draw the eye: what E can act on, in the places updateFocus and underFocus aim at it.
// rank is a handicap against the angle in radians: furniture gives way to what you came for.
// Trees, rabbits and fishing water aren't here: they're everywhere, or nothing to take.
const GLANCE_RANK = { fire: 0.2, door: 0.35, sign: 0.2, mailbox: 0.1, shrub: 0.6, sheep: 0.3 };   // (shrubs are everywhere: anything else near first)
const glanceRef = d => d.c || d.item || d.fire || d.boat || d.house || d.sign || d.mailbox || d.shrub || d.wool;
function glanceThings(cb){
  if (down){
    const L = down.L, put = (ref, [x, y, z], o) => cb({ ref, x, y, z, ...o });
    for (const f of L.finds) if (!f.taken && !(f.chest != null && !L.chests[f.chest].open)) put(f, underAim.find(f, L));
    for (const s of L.shelves || []) put(s, underAim.shelf(s));
    for (const c of L.chests || []) if (!c.open) put(c, underAim.chest(c));
    for (const d of L.doors || []) if (!d.open) put(d, underAim.door(d), { rank: 0.15, range: TALK_RANGE + 1 });
    for (const s of L.sconces || []) put(s, underAim.sconce(s), { rank: 0.4 });
    if (L.id === GROUNDS) put(WARDEN_AT, underAim.warden(L));
    return;
  }
  focusables((x, z, y, _, d) => {
    const ref = glanceRef(d);
    if (ref && !(d.kind === 'door' && boating)) cb({ ref, x, y, z, rank: GLANCE_RANK[d.kind], range: d.reach, los: d.kind === 'boat' ? false : undefined,
      top: d.kind === 'person' ? y + (d.c.h ? d.c.h * 0.42 : 0.9) : undefined });   // (a person's aimed at by the chest: the box goes over the head)
  });
  for (const en of under().entrances)
    if (!en.troll && Math.hypot(en.x - pos.x, en.z - pos.z) < 16) cb({ ref: en, ...entranceAim(en), range: 7, los: false });
  if (sight) for (const pt of doors()) if (Math.hypot(pt.x - pos.x, pt.z - pos.z) < 16) cb({ ref: pt, x: pt.x, y: pt.y + OVAL[1], z: pt.z, range: TALK_RANGE });
}
// no wall in the way. It stops a metre short, because a shelf or a door is in a wall
function glanceClear(x, z){
  const here = down ? upos : pos, blocked = down ? (a, b) => !down.L.walkable(a, b) : (a, b) => solidAt(a, b, 0.2);
  const dx = x - here.x, dz = z - here.z, d = Math.hypot(dx, dz);
  for (let t = 0.3; t < d - 1; t += 0.3) if (blocked(here.x + dx / d * t, here.z + dz / d * t)) return false;
  return true;
}
// what E would do just now, in words, in the order E's handler tries things
const pickWords = p => p.valuable ? `pick up the ${p.kind}` : `pick ${p.kind}`;
function useWords(){
  return playerFish ? 'reel in' : boating ? (nearFish ? 'fish here' : 'step ashore') : nearBoat ? 'board the boat'
    : down ? (nearWarden ? 'talk to the Post-Warden' : nearShelf ? (bookRecipe(nearShelf) || shelfMusic(nearShelf) || shelfCraft(nearShelf) ? 'read the book' : 'look at the shelf')
      : nearDoor ? ((basket[nearDoor.key] || 0) > 0 ? `unlock it with the ${nearDoor.key}` : 'try the door') : nearChest ? 'open the chest'
      : nearTomb ? (mail.letterAt(down.L, nearTomb) ? 'give the letter' : 'read the tomb')
      : nearSconce ? `${nearSconce.lit ? 'put out' : 'light'} ${LIGHT_VERB[nearSconce.kind || 'torch']}` : nearFind ? `take the ${nearFind.kind}` : nearExit >= 0 ? 'climb out' : '')
    : nearPortal ? 'go through' : nearEntrance ? 'go down' : nearTalker ? `talk to ${nearTalker.peasant ? displayName(nearTalker.npc) : nearTalker.name}` : nearHouseDoor && !knock ? 'knock'
    : nearSign ? 'read the sign' : nearMailbox ? 'open the mailbox' : placing ? (placing.why ? '' : 'lay a fire') : nearObject ? (nearObject.lit ? 'sit at the fire' : 'light the fire') : nearShrub ? 'cut firewood' : nearSheep ? 'shear' : nearTree ? (nearTree.faced ? 'speak' : 'examine') : nearRing ? 'listen' : nearFruit ? pickWords(nearFruit) : nearFish ? 'fish here' : '';
}

// the box over what the glance is on: what E will do to it
const glanceBox = document.createElement('div');
glanceBox.id = 'glance-box';
glanceBox.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;white-space:nowrap;box-sizing:border-box;'
  + "border:10px solid;border-image:url('thin_dark_frame.png') 10 round;background:#1d1a14;padding:0 4px;"
  + "font:13px/1.35 Georgia,'Times New Roman',serif;color:#efe6cf;z-index:35;opacity:0;visibility:hidden;"
  + 'transition:opacity .2s,visibility .2s;';
const glanceKey = document.createElement('b'), glanceWords = document.createElement('span');
glanceKey.style.color = '#e8c75a';
glanceBox.append(glanceKey, glanceWords);
document.body.appendChild(glanceBox);
const _boxAt = new THREE.Vector3();
let _boxSays = '';
function drawGlanceBox(){
  const q = glance.at, c = camera.position;
  const inReach = q && Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) <= (q.range ?? TALK_RANGE);   // (the eyes hold on a little past where E stops)
  const says = inReach && inWorld() ? useWords() : '';
  if (says) _boxAt.set(q.x, q.top ?? q.y + 0.25, q.z).project(camera);
  if (!says || _boxAt.z > 1){ if (_boxSays){ _boxSays = ''; glanceBox.style.opacity = 0; glanceBox.style.visibility = 'hidden'; } return; }
  if (says !== _boxSays){
    if (!_boxSays){ glanceBox.style.opacity = 1; glanceBox.style.visibility = 'visible'; }
    _boxSays = says;
    glanceKey.textContent = TOUCH ? '' : 'E';
    glanceWords.textContent = TOUCH ? cap(says) : ` to ${says}`;
  }
  // above it, and kept on the screen if it's right at your feet
  const w = glanceBox.offsetWidth, h = glanceBox.offsetHeight, x = (_boxAt.x + 1) / 2 * innerWidth, y = (1 - _boxAt.y) / 2 * innerHeight;
  const bx = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)), by = Math.max(8, Math.min(innerHeight - h - 8, y - h - 12));
  glanceBox.style.transform = `translate(${bx.toFixed(0)}px,${by.toFixed(0)}px)`;
}

let _posePitch = params.has('pitch');
let _glanceWhere = null, _glanceX = 0, _glanceZ = 0;

// one tick of the world's own life: the folk, the beasts, the paths, the wood. Each frame
// runs it once; passing time runs it many times a frame. `walking`: you tread the path too
function worldTick(simDt, tint, walking){
  agents.syncSky(sky); agents.rain = rain.intensity; agents.update(simDt);
  watchStuck(simDt);
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
  if (pucks) pucks.update(camera, simDt, pos, tint, { outside: !down });
  for (const T of trolls) T.update(camera, !down, tint);   // flock owns Puck's movement
  tickJournal(simDt);                                  // what comes of walking about, for the journal
  if (puckGuide) puckGuide.tick(simDt);                // and, on a trip, what he says along the way
  if (warren) warren.update(camera, simDt, tint);      // draw the rabbits
  drawSheep(tint);                                     // and the sheep
  sward.now = agents.time;
  sward.paintSlice(pos.x, pos.z, 200, (x, z, h) => trail.setLawn(x, z, Math.min(1, (1 - h) / 0.7)));   // eaten ground goes pale
  foldView?.update(simDt);
  for (const f of agents.flocks) if (f.awake) for (const s of f.sheep) if (s.mode === 'walk') trail.deposit(s.x, s.z, simDt * 0.2);   // the droveways tread themselves
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
  if (!playing || inDialog || myBook.isOpen || maps.bigOpen) return stopRest(false);
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
  if (rest) stopRest(false); else if (restOpen) closeRest(true); else if (playing && !inDialog) openRest();
});
restPanel.addEventListener('click', e => e.stopPropagation());
// console: the clock and the moon, and the rest under way (if any)
window.leaRest = () => ({ hour: +hourOf(sky.time).toFixed(2), day: +sky.time.toFixed(3), moon: moonNow(), illum: +(sky.moonIllum ?? 0).toFixed(3),
  resting: rest && { to: rest.o.label, untilDay: +rest.until.toFixed(3) }, open: restOpen, sp: +me.sp.toFixed(1) });
let turnHeld = 0;                                  // how long the arrows have been turning you
// Space jumps: about a metre, a little over half a second. Only the view rises (like the troll's
// shove): the walkability rules don't know about height, so it clears nothing. Hold to keep hopping.
const JUMP_V = 6.8, JUMP_G = 22, HEAD_GAP = 0.3;   // take-off speed, gravity, eye-to-ceiling at the top
let jumpH = 0, jumpV = 0;                          // height above your feet's walking height, and its speed
function loop(now){
  meter.frameMs = now - last;
  perfLog?.frame(meter.frameMs);
  if (perf.iv.length < 20000) perf.iv.push(meter.frameMs);   // frame intervals, for leaPerf's pacing
  const dt = Math.max(0, Math.min(0.05, (now - last)/1000)); last = now;   // (on a busy Pi the first frame's stamp can predate setup)
  // The arrow keys drive you as in Doom, alongside WASD and the mouse: up/down walk,
  // left/right turn. While a panel is up the arrows are the panel's (a book's pages, a scrolling list).
  const _arrows = inWorld();
  touchUI.setFree(_arrows);
  const _ahead = keys.KeyW || (_arrows && keys.ArrowUp), _back = keys.KeyS || (_arrows && keys.ArrowDown);
  const _shift = keys.ShiftLeft || keys.ShiftRight, _walking = _ahead || _back || keys.KeyA || keys.KeyD;
  const running = _shift && canRun(me) && !fly && !boating;
  if (playing){
    tickVitals(me, dt, { running: running && _walking, flying: fly && flyPaid && !down });
    if (fly && flyPaid && me.sp <= 0){ fly = false; flyPaid = false; setForageMsg('Your strength fails. You drift down.', 3500); }
    drawVitals();
    myBook.dock();     // closed, the book sits by the map (it's a no-op once made)
  }
  const speed = (running || (_shift && fly) ? 16 : 8) * dt;
  const _turn = _arrows ? (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0) : 0;
  turnHeld = _turn ? turnHeld + dt : 0;
  // Doom's rates: 123 deg/s, double when running, half for the first moment so a tap can aim
  if (_turn) watchPuck = 0;
  if (_turn) yaw += glance.takeYaw();              // turning carries on from what you're looking at
  if (_turn) yaw += _turn * 2.15 * (running || (_shift && fly) ? 2 : 1) * (turnHeld < 0.17 ? 0.5 : 1) * dt / (scope ? SCOPE_MAG[scope.i] : 1);
  if (scope){
    if (down || boating || inDialog || settingsOpen || invOpen || myBook.isOpen || restOpen || maps.bigOpen) lowerGlass();   // anything else that wants you takes it from your eye
    else if ((scope.t -= dt) <= 0){ scope.t = 0.25; scopeSaysNow(); }
  }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let dx = 0, dz = 0;
  if (_ahead){ dx -= fx; dz -= fz; }
  if (_back){ dx += fx; dz += fz; }
  if (keys.KeyA){ dx -= fz; dz += fx; }
  if (keys.KeyD){ dx += fz; dz -= fx; }
  if (stick.mag){ dx = -fx*stick.fwd + fz*stick.right; dz = -fz*stick.fwd - fx*stick.right; }   // a thumb leans any way, not just eight
  const len = Math.hypot(dx, dz) || 1;
  const _lean = stick.mag ? 0.3 + 0.7*stick.mag : 1;     // and leaning a little walks slowly
  dx = dx/len*speed*_lean; dz = dz/len*speed*_lean;
  if (rest || shove || shearHands.on) dx = dz = 0;                 // passing time: you stay put; jumping back from a troll, you're not steering
  if (fly || boating) jumpH = jumpV = 0;          // (taking to the air or a canoe mid-jump)
  else {
    if (keys.Space && _arrows && !rest && !shove && !jumpH && !jumpV) jumpV = JUMP_V;
    if (jumpV || jumpH){
      jumpH += jumpV * dt; jumpV -= JUMP_G * dt;
      if (jumpH <= 0) jumpH = jumpV = 0;
    }
  }
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
      const room = Math.max(0, L.headAt(upos.x, upos.z) - HEAD_GAP - upos.y);
      if (jumpH > room){ jumpH = room; jumpV = Math.min(jumpV, 0); }   // you bump your head (no room at all: no jump)
      camera.position.copy(upos); camera.position.y += jumpH;
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
    // a troll: too close and he roars, and you jump back (below); pushOut keeps you out of him meanwhile
    for (const T of trolls){
      if (!shove && T.tooClose(pos.x, pos.z)) roarAt(T);
      const [tx, tz] = T.pushOut(pos.x, pos.z); if (walkable(tx, tz)){ pos.x = tx; pos.z = tz; }
    }
    let hop = 0;
    if (shove){
      const s0 = ease(shove.t / shove.dur); shove.t = Math.min(shove.dur, shove.t + dt);
      const s1 = ease(shove.t / shove.dur), step = (s1 - s0) * shove.dist;
      if (walkable(pos.x + shove.dx * step, pos.z)) pos.x += shove.dx * step;
      if (walkable(pos.x, pos.z + shove.dz * step)) pos.z += shove.dz * step;
      hop = Math.sin(Math.PI * shove.t / shove.dur) * shove.hop;
      if (shove.t >= shove.dur) shove = null;
    }
    const groundY = height(pos.x, pos.z) + EYE;
    // smooth camera height (settings): ease toward the ground instead of riding
    // every bump, so small terrain wobble doesn't shift the low-res image a pixel.
    // High up (a flight just ended), drift down rather than drop.
    if (Number.isFinite(pos.y) && pos.y > groundY + 1.5) pos.y = Math.max(groundY, pos.y - 7 * dt);
    else pos.y = gfx.smooth && Number.isFinite(pos.y) ? pos.y + (groundY - pos.y) * Math.min(1, dt * 8) : groundY;
    camera.position.set(pos.x, pos.y + hop + jumpH, pos.z);
  }
  // the glance: stopped near something, walking with the keys alone
  const _gHere = down ? upos : pos;
  if (_glanceWhere !== (down ? down.L : null) || Math.hypot(_gHere.x - _glanceX, _gHere.z - _glanceZ) > 2) glance.reset();   // a stair, a door, a fade: the view was set outright
  _glanceWhere = down ? down.L : null; _glanceX = _gHere.x; _glanceZ = _gHere.z;
  if (_posePitch && (_walking || _turn || document.pointerLockElement === canvas)) _posePitch = false;
  // the cursor free, you look straight ahead (a pose URL's pitch stands until you move: it's a picture)
  if (_arrows && !rest && !scope && !fly && !TOUCH && !_posePitch && document.body.classList.contains('cursor-mode')) pitch = glance.level(dt, pitch);
  if (fly || boating || scope){ const b = glance.bake(); yaw += b.y; pitch += b.p; }
  else if (watchPuck > 0 && _arrows && !rest && !down && puck?.guide){   // he's setting off: a real turn, kept after
    watchPuck -= dt;
    const b = glance.bake(); yaw += b.y; pitch += b.p;   // what the view's on now is where it turns from
    yaw = glance.turnTo(dt, yaw, Math.atan2(-(puck.x - pos.x), -(puck.z - pos.z)));
  }
  else glance.tick(dt, { free: _arrows && !rest,
    moving: !!(_walking || stick.mag || shove), turning: !!_turn, yaw, pitch, eye: camera.position, things: glanceThings, clear: glanceClear });
  if (sat) satFrame(dt);
  if (shearHands.on){ const a = shearHands.frame(dt, (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0)); if (a){ yaw = a.yaw; pitch = a.pitch; } }
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotateY(yaw + glance.y); camera.rotateX(pitch + glance.p);
  if (sat) cook.tick(dt, potOnScreen(sat.fire));

  waterTex.offset.x = (now*0.000015) % 1;
  waterTex.offset.y = (now*0.00001) % 1;

  if (rest) restFrame();                           // passing time: many world ticks this frame

  // Lerp sky gradient toward storm grey before sky.update() so that background
  // colour, fog colour and dome shader all derive from the modified values.
  const _ri = rain.intensity;
  sky.domeU.uHorizon.value.copy(_skyHorizBase).lerp(_rainSkyHoriz, _ri);
  sky.domeU.uZenith.value.copy(_skyZenBase).lerp(_rainSkyZen,   _ri);
  sky.setGlamour(faerie.k, FAERIE_LIGHT);          // the salve's sight: Faerie's purple over the Lea
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
  agents.viewer = down ? null : pos;                                          // sheep out of anyone's sight sleep
  lantern.update(dt, pos, down ? 0 : sky.night ?? 0);
  const _tAgents = performance.now();
  worldTick(simDt, tint, (dx || dz) && !fly && !down);
  perf.sim += performance.now() - _tAgents;
  listenTick();
  footsteps.update(simDt, {
    moving: !!(dx || dz) && !fly && !boating && !jumpH,   // no footfalls in the air
    running,
    terrain: down ? 'rock' : terrainType(pos.x, pos.z),
  }, down ? [] : npcApi.npcs, { x: pos.x, z: pos.z, yaw, terrainAt: terrainType });   // underground, nobody's footsteps but yours
  boats.update(simDt, now * 0.001);                  // bob the moored canoes
  if (playing) ambience.update(dt, down ? { here: { x: upos.x, z: upos.z, yaw }, under: true, fires: [], npcs: [], wind: 0, sea: { prox: 0, pan: 0 },   // underground: the world's sounds die away,
    drips: down.L.site === 'palace' || down.L.faerie || !['cave', 'crypt'].includes(down.L.kind) ? null : down.L.kind }   // and water drips in the dark (not in Faerie)
    : {                                              // fire / sea / wind / chopping
    here: { x: pos.x, z: pos.z, yaw },
    fires: agents.openFires, npcs: npcApi.npcs,
    wind: sky.wind ? sky.wind.length() : 0, sea: seaProx(),
  });
  // faced trees: eyes glow in while the tree is the examine target, coloured by its state
  treeFaces.update(dt, now, { examined: nearTree, night: sky.night ?? 0, tint: sky.spriteTint });
  if (gfx.grass && !down) grassDetail.update(pos.x, pos.z, now * 0.001, sky.groundTint, lantern);   // blades follow the viewer, sway, lit like the turf
  updateFocus();                                     // cursor-aimed: sets nearTalker / nearFruit + the box
  if (puck) puck.held = nearTalker?.c === puck;      // E would talk to him: he stays for it
  // hands tint: base sky tint darkened at night, then warmed by nearby lit fires
  let fireGlow = 0;
  for (const f of agents.openFires){
    if (!f.lit) continue;
    const fd = Math.hypot(pos.x - f.x, pos.z - f.z);
    const s = Math.max(0, 1 - fd / FIRE_LIGHT_RANGE);
    if (s * s > fireGlow) fireGlow = s * s;
  }
  if (down) _handsTint.copy(_torchTint);           // underground: only the torch lights them
  else _handsTint.copy(sky.spriteTint).lerp(_torchTint, sky.night ?? 0).lerp(_fireWarm, fireGlow * 0.88);   // after dark, the lantern's
  hands.update(dt, { moving: !!(dx || dz) && !fly, running,
                     visible: playing && !fly && !scope && gfx.hands, tint: _handsTint });
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
    junctionView.update(dt, mail.boxes.map(b => b.letters.length > 0));
    ground.lod(camera, FOG_FAR + 20);                  // ground tiles past the fog draw coarse
  }
  if (down) down.view.update(dt, camera);            // the torch goes with you
  if (heaps.length || down || guardsHere || boltScene) tickBones(dt, tint);
  const _tDraw = performance.now();
  if (scope) scopeHover();
  renderer.render(down ? down.view.scene : scene, camera);
  perf.draw += performance.now() - _tDraw;
  perf.calls = renderer.info.render.calls; perf.triangles = renderer.info.render.triangles;
  perf.frames++;
  hands.render(renderer);                            // overlay pass, on top of the world
  // desaturate the canvas when it rains — muted, wet-day look
  const _sat = down ? 1 : 1 - rain.intensity * 0.38;
  canvas.style.filter = _sat < 0.995 ? `saturate(${_sat.toFixed(3)})` : '';
  if (playing && !down){ maps.updatePlace(pos.x, pos.z); maps.see(pos.x, pos.z, camera.position.y); }   // the map opens as you see the land
  if (down) maps.reveal(upos.x, upos.z);              // the automap fills in as you go
  talkView.update(simDt, pos.x, pos.z, playingNow(), playing && !down, _boxSays.startsWith('talk to') ? nearTalker?.c : null);              // after the camera moved this frame
  if (playing && down) tickFishing(dt);
  if (playing) tickHands(dt);
  if (playing && !down){ tickFishing(dt); fishView.update(fishersNear(), agents.fishingWater || (agents.fishingWater = [...agents.fishing, ...agents.grounds]), pos.x, pos.z, dt, sky?.evening ?? 0); }
  if (playing && !down) maybeRemark(dt);
  if (playing) tickKnock(dt);
  const _me = down ? upos : pos;
  if (gfx.map) maps.drawMini(_me.x, _me.z, yaw + glance.y);
  if (maps.bigOpen && now - _bigT > 150){ _bigT = now; maps.tickBig(_me.x, _me.z, yaw); }   // people move on the big map too
  tickMeter(meter.frameMs);
  if (showNpcDbg) npcDbg.textContent = agents.debugText(pos.x, pos.z);
  const _hudParts = [
    `x ${_me.x.toFixed(0)} z ${_me.z.toFixed(0)} yaw ${yaw.toFixed(2)}${fly && !down ? ' [fly]' : ''}`,
    `${npcApi.npcs.length} peasants`,
    `P: copy pose  ${DEBUG ? 'F: fly  ' : ''}B: npc  C: spells  I: pack  J: journal  R: rest`,
    nearFind    && `E: take the ${nearFind.kind}`,
    nearShelf   && (bookRecipe(nearShelf) || shelfMusic(nearShelf) || shelfCraft(nearShelf) ? 'E: read the book' : 'E: look at the shelf'),
    nearDoor    && ((basket[nearDoor.key] || 0) > 0 ? `E: unlock it with the ${nearDoor.key}` : 'E: try the door'),
    nearWarden  && 'E: talk to the Post-Warden',
    nearChest   && 'E: open the chest',
    nearTomb    && (mail.letterAt(down.L, nearTomb) ? 'E: give the letter' : 'E: read the tomb'),
    nearSconce  && `E: ${nearSconce.lit ? 'put out' : 'light'} ${LIGHT_VERB[nearSconce.kind || 'torch']}`,
    nearExit >= 0 && !nearFind && !nearSconce && !nearShelf && !nearDoor && !nearChest && !nearTomb && `E: climb out`,
    nearEntrance && `E: go down`,
    nearTalker  && `E: talk to ${nearTalker.name}`,
    nearHouseDoor && !knock && `E: knock`,
    nearSign    && `E: read the sign`,
    nearMailbox && `E: open the mailbox`,
    nearFruit   && `E: ${pickWords(nearFruit)}`,
    nearObject  && `E: sit`,
    nearShrub   && `E: cut firewood`,
    nearSheep   && `E: shear`,
    nearTree    && (nearTree.faced ? `E: speak` : `E: examine`),
    nearRing    && `E: listen`,
    playerFish  ? `E: reel in` : nearFish && `E: fish here`,
    boating     ? (!nearFish && !playerFish && `E: step ashore`) : nearBoat && `E: board the boat`,
    basketText() && `basket: ${basketText()}`,
  ].filter(Boolean);
  // A phone has no keys to name: what E would do goes on the Use button, in the order E's handler
  // tries things, and the top line keeps only what's being said and what you carry.
  if (TOUCH){
    touchUI.setScope(!!scope);
    const _use = !_arrows ? '' : scope ? 'lower the glass' : useWords();
    touchUI.setUse(_use);
    _hudParts.splice(0, _hudParts.length, ..._hudParts.filter(p => p.startsWith('basket:')));
  }
  const _hudMsgs = [poseMsg && `— ${poseMsg}`, forageMsg && `— ${forageMsg}`].filter(Boolean).join('  ');
  hud.textContent = _hudParts.join('  ·  ') + (_hudMsgs ? `  ${_hudMsgs}` : '');
  drawGlanceBox();
  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);
