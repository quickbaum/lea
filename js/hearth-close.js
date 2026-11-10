// hearth-close.js — the hearth as you see it sat at it (docs/cooking.md "The close hearth"). The
// world's fires are built cheap (campfire-view.js: 12-sided pots, box logs, flat colour) because
// the folk keep dozens of them. When you sit at one, this dresses that one fire up, and undresses
// it when you get up: the same meshes get finer geometry and textured materials in place (so the
// view's own update() still decides what shows), the plain cauldron gives way to a turned one, and
// the pot's contents are drawn as they are: the broth, what's gone in, bubbles, steam, a spoon.
// It adds no lights (FireLights: the light count is baked into every shader).
//   const close = new CloseHearth(view, { x, z });   // the seat, so a stir on screen turns the spoon the right way
//   close.update(dt); close.stir(screenAngle); close.dispose();

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeTexture } from './textures.js';
import { ingredient } from './ingredients.js';
import { RECIPES } from './recipes.js';

// ---- textures (crisp, made once) --------------------------------------------------------------
let TEX = null;
const rndI = (n) => Math.floor(Math.random() * n);
function speckle(g, w, h, n, cols, sz = 1){ for (let i = 0; i < n; i++){ g.fillStyle = cols[rndI(cols.length)]; g.fillRect(rndI(w), rndI(h), sz, sz); } }
function textures(){
  if (TEX) return TEX;
  // cast iron: near black, pitted, a little rust, sooted heavy toward the bottom. The lathe's v runs
  // from the foot (v 0) up the outside, then down the inside, and a canvas texture is flipped: v 0
  // is the canvas's BOTTOM row, so the foot's soot is drawn at the bottom.
  const iron = makeTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#2c2b2b'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 500, ['#363433', '#232222', '#3c3836', '#1c1b1b']);
    speckle(g, w, h, 40, ['#5a3a26', '#6b4429', '#4a3424']);                     // rust
    for (let y = 0; y < h * 0.4; y++){ g.fillStyle = `rgba(8,7,6,${0.75 * (1 - y / (h * 0.4))})`; g.fillRect(0, h - 1 - y, w, 1); }   // soot at the foot
    for (let i = 0; i < 26; i++){ g.fillStyle = 'rgba(10,9,8,.55)'; const x = rndI(w), n = rndI(h * 0.45) + 4; g.fillRect(x, h - n, 1, n); }  // soot runs up from it
    g.fillStyle = '#4a4542'; g.fillRect(0, Math.floor(h * 0.48), w, 2);          // the lip, worn bright
  }, { repeat: [3, 1] });
  // bark: rough vertical furrows, lichen flecks
  const bark = makeTexture(32, 64, (g, w, h) => {
    g.fillStyle = '#4a3320'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++){ const d = Math.random(); g.fillStyle = d < .3 ? '#38261a' : d < .6 ? '#57402a' : '#4e3622'; g.fillRect(x, 0, 1, h); }
    for (let i = 0; i < 70; i++){ g.fillStyle = Math.random() < .5 ? '#2a1c12' : '#6a5038'; g.fillRect(rndI(w), rndI(h), 1, 2 + rndI(6)); }
    speckle(g, w, h, 18, ['#7d8a5a', '#8f9a6a']);
  }, { repeat: [2, 1] });
  // end grain: rings round a dark heart
  const grain = makeTexture(16, 16, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const r = Math.hypot(x - 7.5, y - 7.5), ring = Math.floor(r) % 3;
      g.fillStyle = r > 7 ? '#3a2818' : ring === 0 ? '#9a7650' : ring === 1 ? '#b08a5e' : '#a27e56';
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#2a1a10'; g.fillRect(7, 7, 2, 2);
  });
  // stone: grey speckle, a few lichen spots
  const stone = makeTexture(32, 32, (g, w, h) => {
    g.fillStyle = '#8a8884'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 300, ['#7a7874', '#9a9792', '#6e6c69', '#a6a29c']);
    speckle(g, w, h, 12, ['#b4ad7a', '#9aa070', '#c2b88a'], 2);
  }, { repeat: [2, 2] });
  // steam: a soft pixel puff
  const puff = makeTexture(16, 16, (g, w, h) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const r = Math.hypot(x - 7.5, y - 7.5) / 7.5, a = Math.max(0, 1 - r * r) * (0.55 + 0.45 * Math.random());
      if (a > 0.08){ g.fillStyle = `rgba(235,232,226,${a.toFixed(2)})`; g.fillRect(x, y, 1, 1); }
    }
  });
  return (TEX = { iron, bark, grain, stone, puff });
}

// a little seeded wobble, so a rock or a log isn't a perfect solid
const wob = (x, y, z, k = 1) => Math.sin(5.1 * x + 1.3) * Math.sin(4.3 * y + 0.7) * Math.sin(6.2 * z + 2.1) * k
  + Math.sin(11.7 * x + 3.1) * Math.sin(9.3 * z + 0.4) * 0.4 * k;
function rockGeometry(r, seed = 0){
  const geo = new THREE.IcosahedronGeometry(r, 2), p = geo.attributes.position, v = new THREE.Vector3();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++){
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize(), k = 1 + 0.16 * wob(n.x + seed, n.y, n.z) - 0.18 * Math.max(0, -n.y);   // flatter underneath
    p.setXYZ(i, v.x * k, v.y * k * 0.85, v.z * k);
    const soot = 0.55 + 0.45 * Math.min(1, (n.y + 1) / 1.4);                                       // darker low down, where the ash is
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = soot;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
// a log along y: rough round, more sides, a gnarl or two; groups are the bark and the two ends
function logGeometry(rTop, rBot, len){
  const geo = new THREE.CylinderGeometry(rTop, rBot, len, 12, 4), p = geo.attributes.position, sd = Math.random() * 9;
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r < 1e-5) continue;
    const k = 1 + 0.12 * wob(x / (rBot + 1e-3) + sd, y * 3, z / (rBot + 1e-3));
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
// the hook, as a chain of links from y0 to y1 (local)
function chainGeometry(y0, y1){
  const links = [], step = 0.034;
  for (let y = y0, i = 0; y < y1; y += step, i++){
    const l = new THREE.TorusGeometry(0.016, 0.0045, 4, 8);
    l.scale(1, 1.4, 1);
    if (i % 2) l.rotateY(Math.PI / 2);
    l.translate(0, y + 0.012, 0);
    links.push(l);
  }
  const g = links.length ? mergeGeometries(links) : new THREE.BufferGeometry();
  links.forEach(l => l.dispose());
  return g;
}

// ---- the cauldron: turned, with a lip, lugs and (hung) a bail ----------------------------------
// The profile is drawn about the belly's centre (potY) and keeps the plain pot's sizes: belly
// 0.32 across, lip at +0.16..0.19, the broth's surface at +0.14 (view._brothY), so the drop zone,
// the stir ring and the camera's aim, which read those, are still right.
const PROFILE = [[0.001, -0.215], [0.13, -0.208], [0.23, -0.172], [0.295, -0.1], [0.322, -0.02], [0.316, 0.05], [0.292, 0.108], [0.266, 0.142],
                 [0.272, 0.165], [0.298, 0.178], [0.302, 0.19], [0.284, 0.192], [0.258, 0.158], [0.278, 0.1], [0.3, 0.02], [0.282, -0.09], [0.21, -0.16], [0.001, -0.19]];
function cauldron(potY, hung, bailTop){
  const T = textures(), iron = new THREE.MeshLambertMaterial({ map: T.iron, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 28), iron);
  body.position.y = potY; g.add(body);
  for (const s of [-1, 1]){                                         // two lugs at the shoulder
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10), iron);
    lug.position.set(s * 0.3, potY + 0.135, 0); lug.rotation.y = Math.PI / 2;
    g.add(lug);
  }
  if (hung){                                                        // the bail, from lug to lug over the top
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.007, 4, 24, Math.PI), iron);
    bail.position.y = potY + 0.135; bail.scale.y = (bailTop - bail.position.y) / 0.3;   // flattened to fit under a low crossbar
    g.add(bail);
  } else {                                                          // three stub feet, sat in the stones
    for (let i = 0; i < 3; i++){
      const a = i / 3 * Math.PI * 2 + 0.5, ft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.08, 6), iron);
      ft.position.set(Math.cos(a) * 0.17, potY - 0.23, Math.sin(a) * 0.17); g.add(ft);
    }
  }
  return { group: g, mats: [iron] };
}

// ---- what's in the pot -----------------------------------------------------------------------
// each kind floats as its own shape (cut as its prep cuts it), tinted by its colour
const SHAPE_OF = { acorns: 'kernel', hazelnuts: 'kernel', berries: 'pea', beans: 'pea', peas: 'pea',
  cabbages: 'leaf', leeks: 'ring', onions: 'ring', chamomile: 'flower', elderflowers: 'flower', primroses: 'flower', violets: 'flower', heather: 'flower',
  'juniper berries': 'pea', elderberries: 'pea', 'pine needles': 'leaf', 'pine bark': 'flake', 'willow bark': 'flake', meat: 'chunk', fish: 'flake', eels: 'flake', blindfish: 'flake',
  mushrooms: 'cap', morels: 'cap', foxfire: 'cap' };
const SHAPE_BY_GROUP = { nuts: 'kernel', fruit: 'pea', fungi: 'cap', meat: 'chunk', fish: 'flake', roots: 'dice', garden: 'dice' };
const NO_SHOW = new Set(['cave salt', 'salt']);                         // it dissolves
function shapeGeometry(s){
  switch (s){
    case 'kernel': return new THREE.SphereGeometry(0.024, 6, 4).scale(1, 0.55, 0.75);
    case 'pea':    return new THREE.SphereGeometry(0.014, 6, 4);
    case 'leaf':   return new THREE.BoxGeometry(0.06, 0.004, 0.035);
    case 'ring':   return new THREE.TorusGeometry(0.018, 0.006, 4, 8).rotateX(Math.PI / 2);
    case 'flower': return new THREE.CylinderGeometry(0.014, 0.014, 0.004, 8);
    case 'chunk':  return new THREE.DodecahedronGeometry(0.03).scale(1, 0.7, 0.85);
    case 'flake':  return new THREE.BoxGeometry(0.045, 0.012, 0.025);
    case 'cap':    return new THREE.SphereGeometry(0.026, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
    default:       return new THREE.BoxGeometry(0.03, 0.022, 0.028);    // 'dice'
  }
}
const SHAPES = ['kernel', 'pea', 'leaf', 'ring', 'flower', 'chunk', 'flake', 'cap', 'dice'];
const PER_SHAPE = 48;
const shapeFor = k => SHAPE_OF[k] || SHAPE_BY_GROUP[ingredient(k)?.group] || 'dice';
const BUBBLES = 14, STEAM = 7, DROPS = 8;
const LIQ_R = 0.255;                                                    // the broth's reach at its surface

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();

export class CloseHearth {
  constructor(view, seat){
    this.view = view; this.fire = view.fire;
    const T = textures(), fx = this.fire.x, fz = this.fire.z;
    const tl = Math.hypot(seat.x - fx, seat.z - fz) || 1;
    this.toward = { x: (seat.x - fx) / tl, z: (seat.z - fz) / tl };      // from the pot to you
    this.swaps = []; this.made = [];                                    // [obj, prop, was] to put back; what to dispose
    const swap = (obj, prop, val) => { this.swaps.push([obj, prop, obj[prop]]); obj[prop] = val; };
    const own = x => (this.made.push(x), x);

    // ---- dress the hearth's own meshes in place ----
    const barkMat = own(new THREE.MeshLambertMaterial({ map: T.bark })), endMat = own(new THREE.MeshLambertMaterial({ map: T.grain }));
    const barkMats = [barkMat, endMat, endMat];
    const stoneMat = own(new THREE.MeshLambertMaterial({ map: T.stone, vertexColors: true }));
    swap(view.stones, 'geometry', own(rockGeometry(1, 0.3))); swap(view.stones, 'material', stoneMat);
    swap(view.coals, 'geometry', own(rockGeometry(1, 1.7)));
    // a log's geometry: a box stands in for a squared stick, so it becomes a round one along its long side
    const relog = (mesh) => {
      const g = mesh.geometry, P = g.parameters || {};
      let geo;
      if (g.type === 'BoxGeometry'){
        const dims = [P.width, P.height, P.depth], ax = dims.indexOf(Math.max(...dims)), r = Math.min(...dims) / 2;
        geo = logGeometry(r * 0.95, r, dims[ax]);
        if (ax === 0) geo.rotateZ(Math.PI / 2); else if (ax === 2) geo.rotateX(Math.PI / 2);
      } else if (g.type === 'CylinderGeometry') geo = logGeometry(P.radiusTop, P.radiusBottom, P.height);
      else return;
      swap(mesh, 'geometry', own(geo)); swap(mesh, 'material', barkMats);
    };
    view.logs.forEach(relog); view.woodLogs.forEach(relog);
    // the pot's support: sticks become bark, stones become rock, the hook a chain; the plain pot hides
    const potY = view._brothY - 0.14;
    let bailTop = potY + 0.135 + 0.3;                                  // a round bail's top, unless the hook's too short for it
    const rockMat = own(new THREE.MeshLambertMaterial({ map: T.stone, vertexColors: true }));
    for (const ch of [...view.potGroup.children]){
      const u = ch.userData || {};
      if (u.simple){ swap(ch, 'visible', false); continue; }
      if (ch === view.potBroth) continue;
      if (u.chain){
        const P = ch.geometry.parameters, half = P.height / 2;
        bailTop = Math.min(bailTop, ch.position.y + half - 0.08);       // (the spit's bar is low: the bail flattens, and keeps a few links of chain)
        const bottom = bailTop - ch.position.y;                         // down to the top of the bail
        const ironMat = own(new THREE.MeshLambertMaterial({ map: T.iron }));
        swap(ch, 'geometry', own(chainGeometry(bottom, half))); swap(ch, 'material', ironMat);
        continue;
      }
      if (ch.geometry?.type === 'DodecahedronGeometry'){ swap(ch, 'geometry', own(rockGeometry(ch.geometry.parameters.radius, Math.random() * 5))); swap(ch, 'material', rockMat); }
      else if (ch.geometry?.type === 'CylinderGeometry') relog(ch);
    }

    // ---- the turned cauldron ----
    const pot = cauldron(potY, view.cookStyle !== 'rocks', bailTop);
    pot.mats.forEach(own);
    this.pot = pot.group; view.potGroup.add(this.pot);

    // ---- the broth: a surface with its own drawn swirl and skin, redrawn a few times a second ----
    this.brothTex = makeTexture(32, 32, () => {});
    own(this.brothTex);
    this.brothMat = own(new THREE.MeshLambertMaterial({ map: this.brothTex }));
    this.broth = new THREE.Mesh(own(new THREE.CircleGeometry(LIQ_R, 24)), this.brothMat);
    this.broth.rotation.x = -Math.PI / 2; this.broth.position.y = view._brothY;
    view.potGroup.add(this.broth);
    this.drawT = 0; this.swirl = 0; this.spin = 0.25;                      // spin: how fast the pot turns (rad/s), stirring adds to it

    // ---- pieces: one instanced mesh a shape ----
    const pieceMat = own(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    this.shapes = {};
    for (const s of SHAPES){
      const im = new THREE.InstancedMesh(own(shapeGeometry(s)), pieceMat, PER_SHAPE);
      im.count = 0; im.frustumCulled = false;
      im.setColorAt(0, _c.set(0xffffff));
      view.potGroup.add(im); this.shapes[s] = im;
    }
    this.pieces = []; this.contentKey = null;                          // (null: not looked yet, so what's already in doesn't splash)

    // ---- bubbles, steam, splash ----
    this.bubMat = own(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.bubbles = new THREE.InstancedMesh(own(new THREE.SphereGeometry(1, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2)), this.bubMat, BUBBLES);
    this.bubbles.count = 0; this.bubbles.frustumCulled = false;
    view.potGroup.add(this.bubbles);
    this.bub = Array.from({ length: BUBBLES }, () => ({ life: -Math.random(), r: 0, a: 0, s: 0 }));
    this.steam = [];
    for (let i = 0; i < STEAM; i++){
      const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: T.puff, transparent: true, depthWrite: false, opacity: 0 })));
      sp._t = Math.random(); sp._a = Math.random() * 6.3; sp._r = Math.random() * 0.15;
      view.potGroup.add(sp); this.steam.push(sp);
    }
    this.ringMat = own(new THREE.MeshBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0, depthWrite: false }));
    this.ripple = new THREE.Mesh(own(new THREE.RingGeometry(0.8, 1, 20)), this.ringMat);
    this.ripple.rotation.x = -Math.PI / 2; this.ripple.visible = false;
    view.potGroup.add(this.ripple);
    this.drops = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.008, 4, 3)), this.bubMat, DROPS);
    this.drops.count = 0; this.drops.frustumCulled = false;
    view.potGroup.add(this.drops);
    this.splashT = -1; this.dropV = [];

    // ---- the spoon: a wooden one, resting against the rim, that goes round when you stir ----
    const spoonMat = own(new THREE.MeshLambertMaterial({ color: 0x9a7448 }));
    const spoon = new THREE.Group();
    const handle = new THREE.Mesh(own(new THREE.CylinderGeometry(0.009, 0.012, 0.5, 6)), spoonMat);
    handle.position.y = 0.25; spoon.add(handle);
    const bowl = new THREE.Mesh(own(new THREE.SphereGeometry(0.035, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.5, 1.3)), spoonMat);
    bowl.position.y = 0.01; spoon.add(bowl);
    this.spoon = new THREE.Group(); this.spoon.add(spoon);
    this.spoonTilt = spoon;
    view.potGroup.add(this.spoon);
    // at rest, it leans on the rim on your right
    const rx = this.toward.z, rz = -this.toward.x;                     // your right, along the ground (the camera looks from you to the pot)
    this.spoonA = Math.atan2(rz * 0.8 - this.toward.z * 0.6, rx * 0.8 - this.toward.x * 0.6);
    this.stirV = 0; this.stirAcc = 0;
    this.update(0);
  }

  // a stir on screen: the angle round the pot as you see it (atan2 of screen dy, dx). On screen,
  // right is your right and down is toward you, so that's where it goes in the world.
  stir(a){
    const rx = this.toward.z, rz = -this.toward.x;                     // your right, along the ground
    const dx = rx * Math.cos(a) + this.toward.x * Math.sin(a), dz = rz * Math.cos(a) + this.toward.z * Math.sin(a);
    const w = Math.atan2(dz, dx);
    let d = w - this.spoonA; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    this.spoonA = w;
    this.stirAcc += d;                                                 // how far the spoon went round this frame (update)
    this.stirring = 0.25;
  }

  // what's in, as pieces: the base, a few to a portion, and each thing added
  _contents(p){
    const kinds = [];
    if (p.kind && !NO_SHOW.has(p.kind)) for (let i = 0; i < Math.max(1, (p.raw + p.ready) | 0) * 4; i++) kinds.push(p.kind);
    for (const k of p.added || []) if (!NO_SHOW.has(k)) for (let i = 0; i < 5; i++) kinds.push(k);
    return kinds;
  }

  update(dt){
    const fire = this.fire, p = fire.pot, view = this.view;
    const has = p.raw + p.ready > 0 && !p.board, lit = fire.lit, heat = lit ? Math.min(1, fire.fuel * 2) : 0;
    const cooking = p.raw > 0 && lit, ready = p.ready > 0 && p.raw <= 0;
    // how far along the dish is, 0..1: the broth thickens and takes the colour of what's in it
    const R = RECIPES[p.recipe], prog = ready ? 1 : R ? Math.min(1, (p.step + (p.st || 0) / (R.steps[p.step]?.t || 1)) / R.steps.length) : Math.min(1, (p.cook || 0) / 22);
    const base = ingredient(p.kind)?.color || '#7a6040', dish = ingredient(p.recipe || '')?.color || base;
    _c.set('#4a3c2c').lerp(_c2.set(base), 0.35 + 0.25 * prog);         // water with the base in it
    if (prog > 0.5) _c.lerp(_c2.set(dish), (prog - 0.5) * 1.4);

    // the spin: the pot's slow roll on the boil, and what your stirring gives it, settling back
    // the broth takes up half the spoon's speed round, and lets it go when you stop
    this.stirring = Math.max(0, (this.stirring || 0) - dt);
    if (dt > 0 && this.stirAcc){ const rate = this.stirAcc / dt; this.stirV += (Math.max(-4, Math.min(4, 0.5 * rate)) - this.stirV) * Math.min(1, dt * 3); }
    else this.stirV *= Math.exp(-dt * 1.2);
    this.stirAcc = 0;
    this.spin = (cooking ? 0.18 + 0.25 * heat : 0.04) + this.stirV;
    this.swirl += this.spin * dt;

    // the broth surface
    this.broth.visible = has;
    if (has && (this.drawT -= dt) <= 0){ this.drawT = 0.12; this._drawBroth(_c, prog, heat * (cooking ? 1 : 0.3)); }

    // the pieces
    const kinds = has ? this._contents(p) : [], key = kinds.join();
    if (key !== this.contentKey){
      const was = this.pieces.length;
      const fresh = this.contentKey !== null;                          // dropped in while you watch: it falls in, and splashes
      while (this.pieces.length < kinds.length) this.pieces.push({ r: Math.sqrt(Math.random()) * (LIQ_R - 0.04), a: Math.random() * 6.3, ph: Math.random() * 6.3, rot: Math.random() * 6.3, sink: Math.random(), drop: fresh ? 0.4 + Math.random() * 0.6 : 0 });
      this.pieces.length = kinds.length;
      if (fresh && kinds.length > was) this._splash();
      this.contentKey = key;
    }
    const counts = {};
    for (const s of SHAPES) counts[s] = 0;
    const t = (this._t = (this._t || 0) + dt);
    for (let i = 0; i < this.pieces.length; i++){
      const pc = this.pieces[i], k = kinds[i], s = shapeFor(k), im = this.shapes[s], n = counts[s];
      if (n >= PER_SHAPE) continue;
      // inner pieces go round faster than outer (the pot's flow), and bob on the boil
      const aa = pc.a + this.swirl * (1.2 - pc.r / LIQ_R * 0.6);
      pc.drop = Math.max(0, pc.drop - dt * 2.5);
      const soft = ready ? 0.6 : prog;                                  // cooked down, more of it sits under
      const y = view._brothY + 0.004 - pc.sink * 0.02 * (0.5 + soft) + 0.006 * heat * Math.sin(t * 5 + pc.ph) + pc.drop * 0.25;
      _m.compose(_p.set(Math.cos(aa) * pc.r, y, Math.sin(aa) * pc.r), _q.setFromEuler(_e.set(0.3 * Math.sin(t * 2 + pc.ph) * heat, pc.rot + aa, 0)), _s.set(1, 1, 1));
      im.setMatrixAt(n, _m);
      _c2.set(ingredient(k)?.color || '#8a7a50').lerp(_c, 0.15 + 0.35 * soft);   // stewed, they take the broth's colour
      im.setColorAt(n, _c2);
      counts[s] = n + 1;
    }
    for (const s of SHAPES){ const im = this.shapes[s]; im.count = counts[s]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }

    // bubbles: rise and pop over a hot fire, more of them the hotter it is
    let nb = 0;
    for (const b of this.bub){
      b.life += dt * (0.8 + heat);
      if (b.life >= 1){ b.life = has && cooking && Math.random() < 0.3 + 0.7 * heat ? 0 : -Math.random() * 0.6; b.r = Math.sqrt(Math.random()) * (LIQ_R - 0.03); b.a = Math.random() * 6.3; b.s = 0.006 + Math.random() * 0.012; }
      if (b.life < 0 || !has) continue;
      const sc = b.s * (b.life < 0.85 ? 0.4 + b.life * 0.7 : (1 - b.life) * 6);
      _m.compose(_p.set(Math.cos(b.a + this.swirl) * b.r, view._brothY + 0.001, Math.sin(b.a + this.swirl) * b.r), _q.identity(), _s.set(sc, sc, sc));
      this.bubbles.setMatrixAt(nb++, _m);
    }
    this.bubbles.count = nb; this.bubbles.instanceMatrix.needsUpdate = true;
    this.bubMat.color.copy(_c).lerp(_c2.set(0xffffff), 0.35);

    // steam: rises off a hot pot and thins away
    const steamy = has && lit ? 0.25 + 0.5 * heat : 0;
    for (const sp of this.steam){
      sp._t += dt * 0.35;
      if (sp._t > 1){ sp._t -= 1; sp._a = Math.random() * 6.3; sp._r = Math.random() * 0.15; }
      const u = sp._t, drift = 0.12 * u;
      sp.position.set(Math.cos(sp._a) * (sp._r + drift), view._brothY + 0.04 + u * 0.75, Math.sin(sp._a) * (sp._r + drift));
      sp.scale.setScalar(0.12 + u * 0.3);
      sp.material.opacity = steamy * Math.sin(Math.PI * u) * 0.55;
      sp.visible = steamy > 0;
    }

    // a splash: a ring going out and a few drops up and back
    if (this.splashT >= 0){
      this.splashT += dt;
      const u = this.splashT / 0.7;
      this.ripple.visible = u < 1;
      this.ripple.scale.setScalar(0.02 + u * 0.2); this.ripple.position.y = view._brothY + 0.003;
      this.ringMat.opacity = (1 - u) * 0.7;
      let nd = 0;
      for (const d of this.dropV){
        const tt = this.splashT, y = view._brothY + d.vy * tt - 4.9 * tt * tt;
        if (y < view._brothY) continue;
        _m.compose(_p.set(d.x + d.vx * tt, y, d.z + d.vz * tt), _q.identity(), _s.set(1, 1, 1));
        this.drops.setMatrixAt(nd++, _m);
      }
      this.drops.count = nd; this.drops.instanceMatrix.needsUpdate = true;
      if (u >= 1){ this.splashT = -1; this.drops.count = 0; }
    }

    // the spoon: rests on the rim at its angle, bowl in the broth; tilts in toward the middle as it goes round
    const sr = this.stirring > 0 ? 0.16 : 0.2;
    this.spoon.position.set(Math.cos(this.spoonA) * sr, view._brothY - 0.04, Math.sin(this.spoonA) * sr);
    this.spoon.rotation.set(0, -this.spoonA, 0);
    this.spoonTilt.rotation.set(0, 0, -(this.stirring > 0 ? 0.32 : 0.55));   // handle out over the rim
    this.spoon.visible = view.potGroup.visible;
  }

  _splash(){
    this.splashT = 0; this.dropV = [];
    const a = Math.random() * 6.3, r = Math.random() * 0.1;
    for (let i = 0; i < DROPS; i++){
      const b = Math.random() * 6.3, v = 0.15 + Math.random() * 0.2;
      this.dropV.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, vx: Math.cos(b) * v, vz: Math.sin(b) * v, vy: 0.6 + Math.random() * 0.5 });
    }
  }

  // the broth's face: its colour, a skin that thickens, the swirl's streaks going round, foam at the edge on the boil
  _drawBroth(col, prog, boil){
    const cv = this.brothTex.image, g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
    const hex = '#' + col.getHexString();
    g.fillStyle = hex; g.fillRect(0, 0, W, H);
    const light = '#' + _c2.copy(col).lerp(_c2.clone().set(0xffffff), 0.25).getHexString();
    const dark = '#' + _c2.copy(col).multiplyScalar(0.72).getHexString();
    // streaks, laid along the flow and turned with it
    for (let i = 0; i < 9; i++){
      const r = 3 + i * 1.4, a0 = this.swirl * (1.2 - r / 16 * 0.6) + i * 1.7;
      g.fillStyle = i % 2 ? light : dark;
      for (let k = 0; k < 6 + i; k++){
        const a = a0 + k * 0.16;
        g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
    }
    // a skin of fat flecks as it thickens
    const flecks = Math.round(prog * 18);
    for (let i = 0; i < flecks; i++){
      const a = i * 2.39996 + this.swirl * 0.8, r = 2 + (i * 7) % 13;
      g.fillStyle = '#' + _c2.copy(col).lerp(_c2.clone().set(0xf0dca0), 0.4).getHexString();
      g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
    // foam round the edge when it boils
    if (boil > 0.2) for (let i = 0; i < 28 * boil; i++){
      const a = Math.random() * 6.3, r = 13 + Math.random() * 3;
      g.fillStyle = 'rgba(240,232,214,.8)'; g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
    this.brothTex.needsUpdate = true;
  }

  dispose(){
    for (let i = this.swaps.length - 1; i >= 0; i--){ const [o, k, v] = this.swaps[i]; o[k] = v; }
    const added = [this.pot, this.broth, ...Object.values(this.shapes), this.bubbles, ...this.steam, this.ripple, this.drops, this.spoon];
    for (const o of added) this.view.potGroup.remove(o);
    const seen = new Set();
    for (const x of this.made){ if (x && !seen.has(x)){ seen.add(x); x.dispose?.(); } }
    this.pot.traverse(o => o.geometry?.dispose?.());   // (the cauldron's own geometries)
  }
}
