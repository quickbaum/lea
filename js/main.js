import * as THREE from 'three';
import { SIZE, WATER, WORLD_SEED } from './config.js';
import { mulberry32, fork } from './rng.js';
import { height, biome, walkable, buildTerrain, terrainType } from './terrain.js';
import { spawnPeasants, spawnNamedNPC } from './npc.js';
import { PuckFlock } from './puck.js';
import { plantWorld } from './gen/flora.js';
import { MusicPlayer } from './music.js';
import { Sky } from './sky.js';
import { AgentWorld } from './agents.js';
import { TrailField } from './trails.js';
import { GrassDetail, GrassClumps } from './grass.js';
import * as wojak from './wojak.js';
import { makeSociety } from './society.js';
import { talk, talkTree } from './dialog.js';

// ---------- renderer (low internal res, upscaled for the retro look) ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
const PIXEL = 3;
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
scene.fog = new THREE.Fog(SKY, 35, 170);   // farther haze so the bigger world reads as open

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
const EYE = 1.7;

// Lighting + sky (sun/moon/stars/clouds) are owned by Sky — see js/sky.js.

// ---------- world ----------
const rng = mulberry32(WORLD_SEED);
const { ground, waterTex } = buildTerrain(scene);
const forage = plantWorld(scene, fork(rng), { ground });   // ground passed so duff can be painted under trees

// agent layer: NPC drives + the affordance substrate + the campfire ritual.
// See docs/npc-behavior.md. Behaviour lives in the world (smart objects), not
// in the NPC's head.
const agents = new AgentWorld(scene);
agents.setTrees(forage.trees);                             // so the hearth lands in a clearing
agents.setObstacles(forage.obstacles);                    // trunks & shrubs people walk around
agents.buildNav();                                        // A* walkability grid (routes around water/trees)
agents.setShrubs(forage.shrubs);                           // choppable firewood for the fires
// no pre-placed fire — the folk raise their own organically (curfew/stranded
// logic in agents.js), so hearths emerge where people actually gather.
agents.setFood(forage.plants);                             // bushes/trees double as food sources
agents.setValuables(forage.valuables);                     // rare finds people gather & trade

// trails: a wear field that NPCs (and the player) tread into bare paths over
// time, suppressing grass on the route. See docs/trails.md.
const trail = new TrailField(ground);
trail.addGrass(forage.grass);
trail.addGrass(forage.reeds);   // tall swamp grass also thins off trodden paths

// decorative single-pixel grass blades that carpet the ground near the camera
// and sway in the wind (cosmetic only; not tracked). See js/grass.js. Concentric
// layers, dense underfoot (so looking down the ground is fully covered) thinning
// out with distance: each is uniform & world-fixed, summed for the falloff. The
// outermost sets how far grass is drawn. trail lets blades keep off trodden paths.
// ONE uniform blade field: constant density, height set only by world location, so
// grass never grows/shrinks or thickens as you approach it (no proximity effects,
// no density ring). Only a gentle alpha dissolve at the far edge, where the clumps
// take over.
const grassDetail = new GrassDetail(scene, { trail, radius: 22, count: 120000, fade: 'alpha' });
// beyond the blade field, cheap STATIC clump cards carry grass deep into the
// distance (scene-lit, so they match the terrain). They overlap the blade edge so
// the handoff is hidden. See js/grass.js.
const grassClumps = new GrassClumps(scene, { trail, innerR: 16, outerR: 110, count: 34000 });

const basket = {};                          // what we've foraged: { berries, apples }
const basketText = () => Object.entries(basket).map(([k, v]) => `${v} ${k}`).join(', ');
let npcApi = { npcs: [], update(){} };
// the folk form legible social groups (families, clans, bands, lone wanderers),
// each spawning as a cluster on the land — see society.js / docs/texts patterns
const society = makeSociety(fork(rng), 32);
spawnPeasants(scene, fork(rng), society)
  .then(api => {
    npcApi = api;
    for (const n of api.npcs) agents.attach(n);
    warmTrails(120);
    // give each peasant a procedural wojak portrait for its dialog, and tint its
    // in-world sprite (magenta/green/yellow zones) to match (once assets load)
    wojak.ready().then(() => {
      for (const n of api.npcs){ const f = wojak.face(n.gender, n.race); n.portrait = f.url; n.recolor(f.palette); }
    });
  });

// Pre-simulate the agents (no rendering) so trails are already trodden in by the
// time the player looks. We cycle day/night a few times so both the campfire
// gathering and daytime foraging lay their paths. See docs/trails.md.
function warmTrails(seconds){
  const dt = 0.15, steps = Math.floor(seconds / dt);
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
  }
  trail.flush();
}

const music = new MusicPlayer();

// While the splash is up the world is rendered but paused, and name tags hide.
let playing = false;
let inDialog = false;          // a conversation is open (keeps us 'in game', not menu)
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
hoverPanel.style.cssText = 'position:fixed;right:10px;bottom:200px;width:180px;height:90px;'
  + "border:10px solid;border-image:url('thin_dark_frame.png') 10 round;background:#1d1a14;"
  + "display:none;align-items:center;gap:8px;padding:6px;box-sizing:border-box;overflow:hidden;"
  + "font-family:Georgia,'Times New Roman',serif;color:#efe6cf;z-index:40;";
const hoverFace = document.createElement('img');
hoverFace.style.cssText = 'width:56px;height:56px;flex:0 0 56px;object-fit:cover;'
  + 'border:1px solid #c9a23a;border-radius:3px;background:#0c0e16;image-rendering:auto;';
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
  if (h < 4.5 || h >= 22) return 'The dead of night.';
  if (h < 6.5)  return 'Dawn is breaking.';
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
  nearTalker = null; nearFruit = null; nearObject = null;
  if (!playing || inDialog){ hoverPanel.style.display = 'none'; return; }
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
  if (puck)   consider(puck.x,   puck.z,   height(puck.x,   puck.z)   + 1.0, FRAME_RANGE, { kind: 'person', c: puck,   dialog: 'lea',    name: 'Puck'   });
  for (const n of npcApi.npcs)
    consider(n.x, n.z, height(n.x, n.z) + n.h * 0.6, FRAME_RANGE, { kind: 'person', c: n, peasant: true, name: n.name || 'a peasant', npc: n });
  // forageables: berries, shells, stones…
  for (const p of forage.pickables ? forage.pickables() : []){
    if (!p.ripe) continue;
    consider(p.x, p.z, height(p.x, p.z) + 0.5, FRAME_RANGE, { kind: 'fruit', item: p });
  }
  // campfires (informational — not an E target)
  for (const fr of agents.fires || [])
    consider(fr.x, fr.z, height(fr.x, fr.z) + 0.6, FRAME_RANGE, { kind: 'fire', fire: fr });

  // wire E to whatever's framed, if it's within reach and actionable
  if (best && best.dist <= TALK_RANGE){
    if (best.kind === 'person') nearTalker = best;
    else if (best.kind === 'fruit') nearFruit = best.item;
    else if (best.kind === 'fire') nearObject = best.fire;   // inspect the fire/pot with E
  }

  // render the box: portrait+name for people, a title+flavour for objects,
  // and the weather readout when nothing is framed
  hoverPanel.style.display = 'flex';
  const showText = (title, desc, portrait) => {
    hoverName.textContent = title; hoverName.style.display = '';
    if (portrait){ hoverFace.src = portrait; hoverFace.style.display = ''; }
    else hoverFace.style.display = 'none';
    if (desc){ hoverAmbient.textContent = desc; hoverAmbient.style.display = ''; }
    else hoverAmbient.style.display = 'none';
  };
  if (best && best.kind === 'person' && best.name){
    const label = best.peasant ? displayName(best.npc) : best.name;   // strangers stay anonymous
    showText(label, '', best.npc && best.npc.portrait);
  } else if (best && best.kind === 'fruit'){
    const { title, desc } = forageLabel(best.item); showText(title, desc, null);
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

// geocentric sky: sun/moon on the ecliptic, real-catalogue stars, drifting clouds
const sky = new Sky(scene, {
  latitude:  +(params.get('lat')    ?? 42),
  dayLength: +(params.get('daylen') ?? 600),   // real seconds per full day-night cycle
  time:      +(params.get('time')   ?? 0.35),  // 0=midnight .. 0.5=noon
  sunLon:    +(params.get('sunlon') ?? 35),    // sun's ecliptic longitude (season)
});
sky.load();

// the weather is Claude's to command, through dialogue (see dialogs/claude.json)
const weatherActions = {
  cloudsMore:  () => sky.addCloudCover(+0.2),
  cloudsFewer: () => sky.addCloudCover(-0.2),
  cloudsClear: () => sky.setCloudCover(0),
  timeDawn:    () => sky.setDayFraction(0.23),
  timeNoon:    () => sky.setDayFraction(0.50),
  timeDusk:    () => sky.setDayFraction(0.78),
  timeNight:   () => sky.setDayFraction(0.00),
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
let puck = null, pucks = null;
new PuckFlock(scene, { x: -4, z: 13 }).load().then(f => {
  pucks = f; puck = f.leader; registerTag(f.leader?.label);
});

// ---------- minimap ----------
const MAP = document.getElementById('map');
const MS = MAP.width;
const mctx = MAP.getContext('2d');
const baked = document.createElement('canvas'); baked.width = baked.height = MS;
(function bake(){
  const bctx = baked.getContext('2d');
  const img = bctx.createImageData(MS, MS);
  for (let py = 0; py < MS; py++) for (let px = 0; px < MS; px++){
    const x = (px/MS - 0.5)*SIZE, z = (py/MS - 0.5)*SIZE, h = height(x, z);
    let c;
    if (h < WATER) c = [47,109,176];
    else { const b = biome(x, z, h); c = [b[0]*255, b[1]*255, b[2]*255]; }
    const o = (py*MS + px)*4;
    img.data[o]=c[0]; img.data[o+1]=c[1]; img.data[o+2]=c[2]; img.data[o+3]=255;
  }
  bctx.putImageData(img, 0, 0);
})();
const world2map = (x, z) => [ (x/SIZE + 0.5)*MS, (z/SIZE + 0.5)*MS ];
function drawMinimap(px, pz, yaw){
  mctx.clearRect(0, 0, MS, MS);
  mctx.drawImage(baked, 0, 0);
  mctx.fillStyle = '#fd4';
  for (const n of npcApi.npcs){ const [mx,my] = world2map(n.x, n.z); mctx.fillRect(mx-1.5, my-1.5, 3, 3); }
  if (avatar){ const [ax,ay] = world2map(avatar.x, avatar.z); mctx.fillStyle = '#6cf'; mctx.fillRect(ax-2, ay-2, 4, 4); }
  if (pucks){ mctx.fillStyle = '#e8c75a';
    for (const p of pucks.members){ const [px2,py2] = world2map(p.x, p.z); const s = (p === pucks.leader) ? 4 : 2; mctx.fillRect(px2-s/2, py2-s/2, s, s); } }
  if (mapMark){                                    // a person's last-seen spot (set in dialog)
    const [kx, ky] = world2map(mapMark.x, mapMark.z);
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.arc(kx, ky, 6, 0, Math.PI*2); mctx.stroke();
    mctx.fillStyle = '#e8c75a'; mctx.beginPath(); mctx.arc(kx, ky, 2.5, 0, Math.PI*2); mctx.fill();
  }
  const [mx, my] = world2map(px, pz);
  // tip of the triangle points up at rotation 0; facing dir is (-sin,-cos)·yaw → rotate -yaw
  mctx.save(); mctx.translate(mx, my); mctx.rotate(-yaw);
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1;
  mctx.beginPath(); mctx.moveTo(0,-5); mctx.lineTo(3.5,4); mctx.lineTo(-3.5,4); mctx.closePath();
  mctx.fill(); mctx.stroke(); mctx.restore();
}

// ---------- first-person controls ----------
const start = document.getElementById('start');
const hud = document.getElementById('hud');
let yaw = 0, pitch = 0;
const keys = {};
addEventListener('keydown', e => keys[e.code] = true);
addEventListener('keyup',   e => keys[e.code] = false);
canvas.addEventListener('click', () => canvas.requestPointerLock());
start.addEventListener('click', () => canvas.requestPointerLock());
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (!locked && inDialog) return;                   // a dialogue is open — stay in-game
  playing = locked;
  start.classList.toggle('hide', playing);
  for (const t of nameTags) t.visible = playing;     // hide name tags on the splash
  if (playing) window.Leaves?.stop(); else window.Leaves?.start();   // splash-only foliage
  music.init();
  music.play(playing ? terrainType(pos.x, pos.z) : 'menu');
});
addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= e.movementX*0.0022;
  pitch = Math.max(-1.3, Math.min(1.3, pitch - e.movementY*0.0022));
});

// ---------- debug presence: pose-from-URL, fly cam, copy-pose ----------
const pos = new THREE.Vector3(0, 0, 20);
pos.y = height(pos.x, pos.z) + EYE;
let fly = params.has('fly');
if (params.has('x') || params.has('debug')){
  document.getElementById('start')?.classList.add('hide'); window.Leaves?.stop();
  playing = true; for (const t of nameTags) t.visible = true;
}
if (params.has('x'))     pos.x = +params.get('x');
if (params.has('z'))     pos.z = +params.get('z');
if (params.has('y'))     pos.y = +params.get('y');
if (params.has('yaw'))   yaw   = +params.get('yaw');
if (params.has('pitch')) pitch = +params.get('pitch');
const poseURL = () =>
  `${location.origin}${location.pathname}?x=${pos.x.toFixed(1)}&z=${pos.z.toFixed(1)}` +
  `&y=${pos.y.toFixed(1)}&yaw=${yaw.toFixed(3)}&pitch=${pitch.toFixed(3)}&fly=1`;
let poseMsg = '';
let forageMsg = '';
let nearTalker = null;     // {c, dialog|peasant, name} of the nearest talkable NPC
let nearFruit = null;      // nearest ripe forageable plant within reach
let nearObject = null;     // a non-pickable thing you can inspect with E (e.g. a campfire/pot)
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
  const nowD = Math.hypot(o.x - speaker.x, o.z - speaker.z);
  if (nowD < 3.5)  return { line: `${They}'s standing right here with me.`, mark: null };
  if (nowD < SIGHT_RANGE) return { line: `${They}'s not far — just over yonder.`, mark: null };
  const s = speaker.seen && speaker.seen.get(o);
  if (!s) return { line: `I've not laid eyes on ${them} in an age.`, mark: null };
  const when = timeAgo(Math.max(0, now - s.t));
  const seenNear = Math.hypot(s.x - speaker.x, s.z - speaker.z) < 22;
  if (seenNear) return { line: `I saw ${them} around this very spot, ${when}.`, mark: null };
  return { line: `I last saw ${them} ${when}, away from here — let me show you where on your map.`,
           mark: { x: s.x, z: s.z, name: o.name } };
}

// the speaker describing a groupmate's nature (third person), for the clickable
// kin roster. The "last seen" sentence is appended by the caller (sightingOf).
function describeKin(speaker, o){
  const ps = o.persona || {}, g = k => ps[k] ?? 1;
  const fem = o.gender === 'female';
  const They = fem ? 'She' : 'He', them = fem ? 'her' : 'him', themself = fem ? 'herself' : 'himself';
  const kind = speaker.group && speaker.group.kind, rel = relationTo(speaker, o);
  const relPhrase = kind === 'band' ? (rel === 'our captain' ? rel : `a ${rel}`) : `my ${rel}`;
  const dom = [['food', g('food'), `${They} thinks mostly of the next meal.`],
               ['company', g('company'), `${They} loves good company above all.`],
               ['beauty', g('beauty'), `${They} can't pass a pretty shell or stone.`],
               ['comfort', (g('warmth') + g('rest')) / 2, `${They} asks only for a warm hearth and a good rest.`]]
              .reduce((a, b) => b[1] > a[1] ? b : a)[2];
  const social = g('company') < 0.8 ? `Keeps to ${themself}, mostly.`
    : g('company') > 1.25 ? `Happiest in a crowd.` : `Takes folk as they come.`;
  const sk = [];
  if (g('strength') > 1.15) sk.push('strong in the arm'); else if (g('strength') < 0.85) sk.push('not the sturdiest');
  if (g('perception') > 1.15) sk.push('sharp-eyed'); else if (g('perception') < 0.85) sk.push('a touch blind to small things');
  const skill = sk.length ? ` And ${fem ? 'she' : 'he'}'s ${sk.join(', ')}.` : '';
  return `${o.name} — ${relPhrase}. ${dom} ${social}${skill}`;
}

// a rough compass direction from one point to another (N = -z, E = +x), or
// "hereabouts" when it's close. Reuses the COMPASS table used for the wind.
function bearingWord(fx, fz, tx, tz){
  const dx = tx - fx, dz = tz - fz;
  if (Math.hypot(dx, dz) < 7) return 'hereabouts';
  const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return 'to the ' + COMPASS[Math.round(bearing / 45) % 8];
}

// what an NPC will tell you when asked for news: its freshest few facts, each as a
// sentence (who was seen where/when, where food grows). Reads npc.news (agents.js).
function newsReport(npc, now){
  const facts = npc.news ? [...npc.news.values()].sort((a, b) => b.t - a.t).slice(0, 3) : [];
  if (!facts.length) return "Naught I've heard worth the telling, friend.";
  const lines = facts.map(f => {
    const where = bearingWord(npc.x, npc.z, f.x, f.z);
    if (f.kind === 'saw') return `${displayName(f.subj)} was seen ${where}, ${timeAgo(Math.max(0, now - f.t))}.`;
    if (f.kind === 'food') return `There's ${f.foodKind} to be had ${where}.`;
    return '';
  }).filter(Boolean);
  return '"' + lines.join(' ') + '"';
}

// A peasant's dialogue is assembled live from its drives + surroundings — no lore
// or personality yet (cultures aren't generated). It's a window on the NPC's
// state: what it's doing, how it feels (its strongest unmet drive), and the sky.
function peasantTree(npc, sky){
  const n = npc.needs || {};
  const doing = npc.chopping              ? "Cutting firewood — the woodpile's run low."
    : npc.sitting && npc.atGathering ? "Sitting at the night fire with the others — there's a song going, and old talk."
    : npc.sitting                  ? "Sitting by the fire, warming my hands."
    : npc.actionLabel === 'chop'   ? "Off to cut some wood for the fire."
    : npc.actionLabel === 'stack'  ? "Stacking firewood by the hearth for us all."
    : npc.actionLabel === 'build'  ? "Laying a fire here — no camp's near enough for nightfall."
    : npc.actionLabel === 'fire'   ? ((sky?.evening ?? 0) > 0.3 ? "Heading back to camp before the dark sets in." : "Making for the fire — I want to be warm.")
    : npc.actionLabel === 'food'   ? "Gathering food to carry back."
    : npc.actionLabel === 'getfood'? "Fetching a bite from the camp stores."
    : npc.actionLabel === 'tend'   ? ((sky?.night ?? 0) > 0.3 ? "Keeping the fire — someone must watch it." : "Minding the fire and the pot. They shouldn't be left alone.")
    : npc.actionLabel === 'sup'    ? "Supping at the pot — there's stew, and it's good."
    : npc.actionLabel === 'cook'   ? "Off to the pot — these want cooking before they're fit to eat."
    : npc.actionLabel === 'store'  ? "Stowing food in the camp basket."
    : npc.actionLabel === 'trade'  ? "Off to barter — a fair swap beats a long forage."
    : npc.actionLabel === 'collect'? "Something caught my eye — a pretty thing to keep."
    : npc.actionLabel === 'greet'  ? "Just passing the time with the others."
    :                                "Wandering. Looking for somewhere to be.";
  const top = [['food',    n.food    ?? 0, "Hungry. My belly's been grumbling."],
               ['company', n.company ?? 0, "Lonely. It's quiet out here."],
               ['warmth',  n.warmth  ?? 0, "Cold. I'd like to be near a fire."],
               ['rest',    n.rest    ?? 0, "Weary. I could do with a rest."]]
              .reduce((a, b) => b[1] > a[1] ? b : a);
  const feel = top[1] > 0.55 ? top[2] : "Well enough, I suppose.";
  const night = sky?.night ?? 0, day = sky?.day ?? 1;
  const skyLine = night > 0.7 ? "Dark now. The stars are out — the whole sky of them."
    : night > 0.3 ? "The light's going thin. Dusk, or near it."
    : day   > 0.6 ? "The sun's well up. A fair day for it."
    :               "Grey light. The day's not yet awake.";
  // what the peasant is carrying: foraged rations (packKind) + firewood logs + valuables
  const food = npc.pack | 0, wood = npc.firewood | 0, trink = npc.trinkets | 0, rawn = npc.raw | 0;
  const foodName = (npc.packKind && npc.packKind !== 'food') ? npc.packKind : 'victuals';
  const trinkName = npc.trinketKind || 'trinket';
  const carry = [];
  if (food > 0) carry.push(`${food} handful${food === 1 ? '' : 's'} of ${foodName}`);
  if (rawn > 0) carry.push(`${rawn} of ${npc.rawKind || 'raw fare'}, for the pot`);
  if (wood > 0) carry.push(`${wood} log${wood === 1 ? '' : 's'} of firewood`);
  if (trink > 0) carry.push(`${trink} bit${trink === 1 ? '' : 's'} of ${trinkName} I'm rather fond of`);
  const packLine = carry.length
    ? "Let's see here... " + carry.join(', and ') + "."
    : "Naught but lint and crumbs — it's empty.";
  // personality + skill, read off the NPC's persona (agents.js)
  const ps = npc.persona || {};
  const g = (k) => ps[k] ?? 1;
  const dom = [['food',    g('food'),                    "Truth be told, I think most about my next meal."],
               ['company', g('company'),                 "I do love good company — folk are the best of the Lea."],
               ['beauty',  g('beauty'),                  "I can't pass a pretty shell or stone without stooping for it."],
               ['comfort', (g('warmth') + g('rest')) / 2, "A warm hearth and an easy rest — that's my whole ambition."]]
              .reduce((a, b) => b[1] > a[1] ? b : a)[2];
  const social = g('company') < 0.8 ? "I keep to myself, mostly — crowds wear on me."
    : g('company') > 1.25 ? "I'm never so happy as among others."
    : "I take folk as they come.";
  const sk = [];
  if (g('strength') > 1.15) sk.push("strong in the arm — wood falls quick under my axe, and I carry a good load");
  else if (g('strength') < 0.85) sk.push("not the strongest — a heavy pack soon tires me");
  if (g('perception') > 1.15) sk.push("sharp-eyed — I spy the little treasures others tread right past");
  else if (g('perception') < 0.85) sk.push("a touch blind to small things on the ground");
  const selfLine = `${dom} ${social} ` +
    (sk.length ? "As for my hands and eyes — " + sk.join("; ") + "." : "Naught remarkable in my hands or eyes.");
  // who they belong to (society.js groups): an intro line + a roster of the whole
  // immediate group — each member's portrait, name, relation, and (on click) a
  // detail node about them plus a map marker where they were last seen.
  const grp = npc.group;
  let kinLine, kinRoster = null; const kinNodes = {};
  if (!grp || grp.kind === 'lone'){
    kinLine = "I keep my own road — no kin nor company but my own shadow.";
  } else {
    kinLine = grp.kind === 'band' ? `${grp.name} — those I ride with (ask after any of them):`
      :                             `${grp.name} — my kin (ask after any of them):`;
    const now = sky?.time ?? 0;
    kinRoster = (grp.npcs || []).map((o, i) => {
      const item = { name: o.name, portrait: o.portrait, relation: relationTo(npc, o) };
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
  let nameLine = `"${npc.given || npc.name}" — ${npc.gender === 'female' ? 'she' : 'he'} smiles. `
    + `"${npc.name}, if you want the whole of it. And you are?"`;
  // if you'd heard the name before (from a groupmate's introduction), you recognise it
  if (npc.heardFrom && !npc.known)
    nameLine += `\n\nThe name strikes a chord. "I've heard of you," you say, "from ${displayName(npc.heardFrom)}."`;
  // farewell addresses them by name once known, else by their kind ("Goodbye, Elf")
  const farewell = () => npc.known && npc.given ? `Goodbye, ${npc.given}`
    : `Goodbye, ${(npc.race || 'stranger').replace(/^./, c => c.toUpperCase())}`;
  return { speaker: displayName(npc), portrait: npc.portrait, root: 'hi', farewell, nodes: {
    hi:    { text: "Oh — hello, stranger.", get choices(){    // personal questions unlock once you know them
               const c = [{ label: "What is your name?",  next: 'name'  },
                          { label: "What are you doing?", next: 'doing' },
                          { label: "Heard any news?",     next: 'news'  }];
               if (npc.known) c.push({ label: "How do you fare?",  next: 'feel' },
                                     { label: "What sort are you?", next: 'self' },
                                     { label: "What's in thy pack?", next: 'pack' });
               c.push({ label: "How looks the sky?", next: 'sky' });
               return c; } },
    get news(){ return { text: newsReport(npc, sky?.time ?? 0) }; },
    name:  { text: nameLine, choices: [ { label: "Who are your people?", next: 'kin' } ] },
    doing: { text: doing },
    feel:  { text: feel },
    self:  { text: selfLine },
    kin:   { text: kinLine, ...(kinRoster ? { roster: kinRoster } : {}) },
    pack:  { text: packLine },
    sky:   { text: skyLine },
    ...kinNodes,
  }};
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
addEventListener('keydown', e => {
  if (e.code === 'KeyF') fly = !fly;
  if (e.code === 'KeyB'){ showNpcDbg = !showNpcDbg; npcDbg.style.display = showNpcDbg ? 'block' : 'none'; }
  if (e.code === 'KeyP'){
    const u = poseURL();
    navigator.clipboard?.writeText(u).catch(()=>{});
    poseMsg = 'pose copied'; console.log('POSE', u);
    setTimeout(() => poseMsg = '', 2500);
  }
  if (e.code === 'KeyE' && playing && !inDialog && nearTalker){
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
        if (id === 'kin' && npc.group){                  // you've now *heard of* their kin (not met them)
          for (const o of npc.group.npcs)
            if (o !== npc && !o.known && !o.heardFrom) o.heardFrom = npc;
        }
        tree.speaker = displayName(npc);                 // header reflects what you now know
      };
      talkTree(tree, { onClose, onNav });
    } else {
      const onNav = () => { mapMark = null; };
      talk(nearTalker.dialog, { actions: weatherActions, onClose, onNav });
    }
  } else if (e.code === 'KeyE' && playing && !inDialog && nearObject){
    inDialog = true; document.exitPointerLock?.();         // examine the fire/pot
    const onClose = () => { inDialog = false; try { canvas.requestPointerLock(); } catch (_){} };
    talkTree(fireTree(nearObject), { onClose });
  } else if (e.code === 'KeyE' && playing && !inDialog && nearFruit){
    const n = nearFruit.collect();
    if (n > 0){
      basket[nearFruit.kind] = (basket[nearFruit.kind] || 0) + n;
      forageMsg = `+${n} ${nearFruit.kind}`;
      setTimeout(() => forageMsg = '', 2000);
    }
  }
});

let last = performance.now();
function loop(now){
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 14 : 7) * dt;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let dx = 0, dz = 0;
  if (keys.KeyW){ dx -= fx; dz -= fz; }
  if (keys.KeyS){ dx += fx; dz += fz; }
  if (keys.KeyA){ dx -= fz; dz += fx; }
  if (keys.KeyD){ dx += fz; dz -= fx; }
  const len = Math.hypot(dx, dz) || 1;
  dx = dx/len*speed; dz = dz/len*speed;
  if (fly){
    pos.x += dx; pos.z += dz;                       // no terrain clamp in fly cam
    if (keys.Space) pos.y += speed;
    if (keys.KeyQ) pos.y -= speed;
    camera.position.set(pos.x, pos.y, pos.z);
  } else {
    if (walkable(pos.x+dx, pos.z)) pos.x += dx;
    if (walkable(pos.x, pos.z+dz)) pos.z += dz;
    const [rx, rz] = agents.pushOut(pos.x, pos.z);   // slide out of a trunk, never stick
    if (walkable(rx, rz)){ pos.x = rx; pos.z = rz; }
    pos.y = height(pos.x, pos.z) + EYE;
    camera.position.set(pos.x, pos.y, pos.z);
  }
  camera.rotation.set(0, 0, 0, 'YXZ');
  camera.rotateY(yaw); camera.rotateX(pitch);

  waterTex.offset.x = (now*0.000015) % 1;
  waterTex.offset.y = (now*0.00001) % 1;

  sky.update(dt, camera);
  const tint = sky.spriteTint;                     // daylight illumination for unlit sprites

  const simDt = playing ? dt : 0;                  // world is paused on the splash
  agents.syncSky(sky); agents.update(simDt);       // share day/night; flicker fires
  if (playing) music.update(terrainType(pos.x, pos.z), simDt);
  npcApi.update(camera, simDt, tint);
  agents.separate(simDt);                          // keep NPCs from overlapping / crowding
  agents.resolveTrees();                           // pop anyone out of a trunk they touched
  if (simDt > 0){                                  // walkers tread paths into the wear field
    for (const n of npcApi.npcs) if (n.moving) trail.deposit(n.x, n.z, simDt);
    if (avatar && avatar.moving) trail.deposit(avatar.x, avatar.z, simDt);
    if ((dx || dz) && !fly) trail.deposit(pos.x, pos.z, simDt);
  }
  trail.tick(simDt);
  if (avatar) avatar.update(camera, simDt, tint);
  if (pucks) pucks.update(camera, simDt, pos, tint);   // flock owns Puck's movement
  forage.update(simDt);
  grassDetail.update(pos.x, pos.z, now * 0.001, sky.groundTint);   // blades follow the viewer, sway, lit like the turf
  grassClumps.update(pos.x, pos.z);                  // far static clumps (rebuilt only when moving)
  updateFocus();                                     // cursor-aimed: sets nearTalker / nearFruit + the box
  renderer.render(scene, camera);
  drawMinimap(pos.x, pos.z, yaw);
  if (showNpcDbg) npcDbg.textContent = agents.debugText(pos.x, pos.z);
  hud.textContent =
    `x ${pos.x.toFixed(0)} z ${pos.z.toFixed(0)} yaw ${yaw.toFixed(2)}${fly ? ' [fly]' : ''}` +
    `  ·  ${npcApi.npcs.length} peasants  ·  P: copy pose  F: fly  B: npc` +
    (nearTalker ? `  ·  E: talk to ${nearTalker.name}` : '') +
    (nearFruit ? `  ·  E: gather ${nearFruit.kind}` : '') +
    (nearObject ? `  ·  E: examine` : '') +
    (basketText() ? `  ·  basket: ${basketText()}` : '') +
    (poseMsg ? `  — ${poseMsg}` : '') + (forageMsg ? `  — ${forageMsg}` : '');
  requestAnimationFrame(loop);
}
resize();
requestAnimationFrame(loop);
