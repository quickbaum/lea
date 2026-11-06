// Campfire & shelter VIEWS — every mesh, texture and light for the hearth, the
// lean-to and the hut. The sim side (fuel, woodpile, pot, seats, thatch —
// js/agents.js) knows nothing about Three.js; main.js injects these views via
// AgentWorld's makeFireView/makeShelterView/makeHutView options, and the headless
// harness simply doesn't.
// A view reads its sim object's state each frame and mirrors it — so the sim
// never has to call back into the view when wood is stacked or stew is ladled.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height } from './terrain.js';
import { WOOD_CAP, STORE_CAP } from './agents.js';
import { KIN_DYES as THATCH_DYES, kinMark, patternMask } from './kin-mark.js';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const _emberCol = new THREE.Color();

// ---------------------------------------------------------------- flame texture
// A soft teardrop flame on a transparent card, drawn once and reused (additive).
// A soft, mostly-white teardrop (a luminance mask, hot at the base, feathered to
// nothing at the pointed tip). It carries little colour of its own so each flame
// layer can be TINTED — orange body, amber middle, white-hot core — via the
// material colour and combined additively. Drawn taller than wide for an upward lick.
function flameTexture(){
  const w = 32, h = 56, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(w/2, h*0.74, 1, w/2, h*0.62, h*0.66);
  grad.addColorStop(0.0,  'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,250,235,0.92)');
  grad.addColorStop(0.66, 'rgba(255,225,195,0.42)');
  grad.addColorStop(1.0,  'rgba(255,200,170,0)');
  g.fillStyle = grad;
  g.beginPath();                                   // teardrop: round base, pointed top
  g.moveTo(w/2, 1);
  g.quadraticCurveTo(w*0.99, h*0.52, w*0.5, h*0.98);
  g.quadraticCurveTo(w*0.01, h*0.52, w/2, 1);
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;   // crisp, no blur (matches the game)
  t.generateMipmaps = false;
  return t;
}
let FLAME_TEX = null;
const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// a grainy ash/charcoal disc for the fire pit — speckled greys with a few ember
// flecks, and a soft radial alpha so the scorch fades into grass at the rim
// instead of ending on a hard circle (it's mapped onto the draped ground patch).
function pitTexture(){
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, s, s);
  // scorched earth: charred black at the heart, baked & reddened soil around it,
  // singed ash-grey toward the rim — the burn fades out into the ground.
  const base = g.createRadialGradient(s/2, s/2, s*0.04, s/2, s/2, s*0.5);
  base.addColorStop(0.0,  '#100c09');   // charred black centre
  base.addColorStop(0.32, '#251a12');   // dark char
  base.addColorStop(0.58, '#3c2417');   // baked, reddened earth ring
  base.addColorStop(0.82, '#4a4036');   // singed soil & ash
  base.addColorStop(1.0,  '#564b41');   // scorched dirt, blending out
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  // grit: pale ash dust, black charcoal flecks, a scatter of ember sparks
  for (let i = 0; i < 1600; i++){
    const x = Math.random() * s, y = Math.random() * s, b = Math.random();
    g.fillStyle = b < 0.5 ? `rgba(${150 + Math.random()*40|0},${142 + Math.random()*36|0},128,${0.10 + Math.random() * 0.35})`
      : b < 0.86 ? `rgba(12,10,8,${0.3 + Math.random() * 0.55})`
      : `rgba(${190 + Math.random() * 55 | 0},${70 + Math.random() * 45 | 0},25,${0.2 + Math.random() * 0.4})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // fade the alpha out toward the edge (keep RGB, mask the disc round + soft)
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createRadialGradient(s/2, s/2, s*0.18, s/2, s/2, s*0.5);
  grad.addColorStop(0,   'rgba(0,0,0,1)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;   // crisp, no blur
  return t;
}
let PIT_TEX = null;

// A soft round shadow for the ground under a roof — dark at the middle, feathered
// to nothing at the rim, so it fades into grass instead of ending on a hard disc.
// The canopy shade under a tree is painted into the ground's vertex colours at
// world-gen (`shadeGroundUnderTrees`, js/gen/flora.js), but that route is closed
// to anything built at runtime: js/trails.js caches those colours as the
// un-trodden ground and writes over them as paths wear in. So a hut carries its
// own draped patch instead, the same way a hearth carries its scorch.
function shadeTexture(){
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  // Toned to the leaf-litter brown the canopy shade uses (0.30/0.25/0.16 in
  // shadeGroundUnderTrees) rather than a grey shadow, so a hut floor and a tree
  // floor read as the same kind of ground. Deep in the middle: the dome hides
  // most of this from outside, so what has to carry it is the glimpse through
  // the doorway and the view from within.
  const grad = g.createRadialGradient(s/2, s/2, s*0.06, s/2, s/2, s*0.5);
  grad.addColorStop(0.0,  'rgba(20,16,10,0.96)');
  grad.addColorStop(0.55, 'rgba(26,21,13,0.86)');
  grad.addColorStop(0.85, 'rgba(34,28,18,0.38)');
  grad.addColorStop(1.0,  'rgba(34,28,18,0)');
  g.fillStyle = grad; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}
let SHADE_TEX = null;

// The scorched ground under a hearth, built as a small mesh that DRAPES over the
// real heightfield: every vertex's Y is sampled from height(), so it lies flush
// on any slope instead of a flat disc that cuts into the hill on one side and
// floats on the other. It sits just ABOVE the ground (we can't carve a recess into
// the coarse terrain — anything dug below it would be hidden by the terrain mesh —
// so the pit's depth is read from the ash & coals heaped on top, not a dug bowl).
// Y is relative to the hearth origin (cx,cz) so the mesh parents straight onto the
// campfire group. UVs are a top-down planar projection, so the pit texture's soft
// round edge handles the blend into grass.
const PATCH_LIFT = 0.03;
function groundPatch(cx, cz, r, mat = null){
  const RINGS = 4, SPOKES = 18;
  const h0 = height(cx, cz);
  const pos = [], uv = [], idx = [];
  pos.push(0, PATCH_LIFT, 0); uv.push(0.5, 0.5);            // centre
  for (let ri = 1; ri <= RINGS; ri++){
    const f = ri / RINGS, rr = r * f;
    for (let si = 0; si < SPOKES; si++){
      const a = si / SPOKES * Math.PI * 2;
      const dx = Math.cos(a) * rr, dz = Math.sin(a) * rr;
      pos.push(dx, height(cx + dx, cz + dz) - h0 + PATCH_LIFT, dz);   // drape on the surface
      uv.push(0.5 + Math.cos(a) * f * 0.5, 0.5 + Math.sin(a) * f * 0.5);
    }
  }
  for (let si = 0; si < SPOKES; si++){                       // centre fan (up-facing winding)
    const a = 1 + si, b = 1 + (si + 1) % SPOKES;
    idx.push(0, b, a);
  }
  for (let ri = 0; ri < RINGS - 1; ri++){                    // ring quads
    const base = 1 + ri * SPOKES, next = base + SPOKES;
    for (let si = 0; si < SPOKES; si++){
      const ia = base + si, ib = base + (si + 1) % SPOKES;
      const oa = next + si, ob = next + (si + 1) % SPOKES;
      idx.push(ia, ob, oa, ia, ib, ob);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  mat ||= new THREE.MeshLambertMaterial({ map: PIT_TEX, color: 0xffffff,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(geo, mat);
}

// the broth's tint, by the dish simmering in it
const BROTH_TINT = { mushrooms: 0x7a5a3a, morels: 0x5a3f2a, roots: 0xa97f43,
  acorns: 0x8a6a3a, 'cattail root': 0x9c8a5a };

// ------------------------------------------------------------- campfire view
// ---------------------------------------------------------------- fire lights
// A fixed pool of point lights, handed each frame to the burning hearths nearest
// the camera. Three.js bakes the NUMBER of lights into every lit shader, so a
// PointLight per hearth recompiled the whole world's materials each time the folk
// built a fire or one burnt out (a visible hitch, all game long), and every lit
// pixel paid for every fire on the map. A fire's glow reaches ~20u and the fog
// closes by 130u, so a few lights cover everything you can see. Spare lights stay
// in the scene at intensity 0 — the count must never change.
export class FireLights {
  constructor(scene, n = 4){
    this.lights = [];
    for (let i = 0; i < n; i++){
      const l = new THREE.PointLight(0xff7a33, 0, 14, 2);
      scene.add(l); this.lights.push(l);
    }
    this._near = [];
  }
  // maxDist: also hide whole hearths lost in the fog (CampfireView never sets its
  // group's visibility itself, so this is the only writer)
  update(fires, camera, maxDist = Infinity){
    const cx = camera.position.x, cz = camera.position.z, near = this._near;
    near.length = 0;
    for (const f of fires){
      if (f.group) f.group.visible = Math.hypot(f.x - cx, f.z - cz) < maxDist;
      const gl = f.view?.glow;
      if (!gl || gl.intensity <= 0) continue;
      // rank by distance to the lit circle's edge, so a big fire just out of reach
      // still beats a small one a little nearer
      gl._d = Math.hypot(gl.x - cx, gl.z - cz) - gl.distance;
      near.push(gl);
    }
    near.sort((a, b) => a._d - b._d);
    for (let i = 0; i < this.lights.length; i++){
      const l = this.lights[i], gl = near[i];
      if (!gl){ l.intensity = 0; continue; }
      l.position.set(gl.x, gl.y, gl.z);
      l.intensity = gl.intensity; l.distance = gl.distance;
    }
  }
}

// Builds every mesh for one Campfire (js/agents.js) and mirrors its state each
// frame. Sets fire.group (added to the scene by AgentWorld) and fire.view (so
// the sim's update can drive the animation with the same dt).
export class CampfireView {
  constructor(fire){
    this.fire = fire;
    fire.view = this;
    const { x, z } = fire;
    this.flicker = 1;
    this.embers = [];        // glowing flecks on the ash, pulsing with the flame

    FLAME_TEX ||= flameTexture();
    PIT_TEX ||= pitTexture();
    const g = new THREE.Group();
    g.position.set(x, height(x, z), z);
    // The pit's many small pieces are batched, not one Mesh each: a hearth used to
    // be ~60 draw calls of pebbles (every ash lump even had its own material), and
    // the folk keep building hearths all game. Ash + charcoal never change → one
    // merged mesh; stones and coals are revealed/recoloured → one InstancedMesh each.
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
    const _p = new THREE.Vector3(), _s = new THREE.Vector3();
    const place = (px, py, pz, sx, sy, sz) =>
      _m.compose(_p.set(px, py, pz), _q.setFromEuler(_e.set(rnd()*3, rnd()*3, rnd()*3)), _s.set(sx, sy, sz));
    const bedPieces = [];                                 // baked ash + charcoal geometries
    const bedPiece = (radius, colour) => {
      const geo = new THREE.DodecahedronGeometry(radius).applyMatrix4(_m);
      const n = geo.attributes.position.count, c = new Float32Array(n * 3);
      for (let k = 0; k < n; k++){ c[k*3] = colour.r; c[k*3+1] = colour.g; c[k*3+2] = colour.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
      bedPieces.push(geo);
    };

    // A hearth is built UP and let DOWN by adding/removing pieces — stones to the
    // ring, sticks to the wood — not by scaling (that looked rubbery). We lay the
    // full set once and reveal as many as the gathering warrants (see update). The
    // reveal order is spread by the golden angle so the ring fills evenly, not one
    // side first. No two fires are laid the same (style + scatter vary).
    const rnd = Math.random;
    this.style = ['teepee', 'cabin', 'pile'][Math.floor(rnd() * 3)];
    this.fireLevel = 0;                                   // 0..1, eased toward attendance
    const S = this.structure = new THREE.Group();
    g.add(S);
    const GOLD = 2.399963;

    // fire pit: the scorched ground itself, draped over the real slope (always
    // shown). Not a flat disc — it follows the hill — and a touch wider than the
    // stone ring, so the char haloes out past it.
    const h0 = height(x, z);
    const PIT_R = 1.35;
    S.add(groundPatch(x, z, PIT_R));
    // local Y just above the scorched ground at an offset — so the ash, charcoal,
    // coals and stones rest ON it (and follow the slope) rather than hovering flat.
    const floorY = (dx, dz) => height(x + dx, z + dz) - h0 + PATCH_LIFT + 0.01;

    // The bed of the pit, built the way a real one settles: a soft layer of grey
    // ASH (mounded, not flat), angular black CHARCOAL chunks half-sunk in it, and
    // glowing COALS nestled low among them — hottest at the heart, cooling outward.
    // Ash + charcoal are always there (a hearth carries its leavings); the coals
    // are revealed by fireLevel and pulse with the flame (see update).

    // ash: low irregular mounds, paler at the rim, settling toward the centre
    for (let i = 0, n = 22 + (rnd() * 10 | 0); i < n; i++){
      const a = rnd() * Math.PI*2, r = Math.pow(rnd(), 0.7) * 0.9;        // denser toward middle
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const gr = 0.30 + rnd() * 0.28 + 0.12 * (r / 0.9);                  // darker centre, paler edge
      const radius = 0.05 + rnd() * 0.07;
      place(dx, floorY(dx, dz) + 0.01, dz,
        1 + rnd() * 0.5, 0.35 + rnd() * 0.25, 1 + rnd() * 0.5);          // flattened, settled
      bedPiece(radius, new THREE.Color(gr, gr * 0.96, gr * 0.9));
    }
    // charcoal: charred chunks & burnt log-ends, angular and dark, half-buried
    const charCol = new THREE.Color(0x1c1815);
    for (let i = 0, n = 7 + (rnd() * 4 | 0); i < n; i++){
      const a = rnd() * Math.PI*2, r = rnd() * 0.62;
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const radius = 0.07 + rnd() * 0.09;
      place(dx, floorY(dx, dz), dz,                                       // resting in the ash, bottoms buried
        1 + rnd() * 0.8, 0.5 + rnd() * 0.4, 1 + rnd() * 0.8);
      bedPiece(radius, charCol);
    }
    S.add(new THREE.Mesh(mergeGeometries(bedPieces, false),
      new THREE.MeshLambertMaterial({ vertexColors: true })));
    for (const geo of bedPieces) geo.dispose();
    // coals: glowing chunks low in the bed; each remembers its heat (hot at centre)
    // and a flicker phase, so the bed shimmers unevenly rather than pulsing as one.
    // One InstancedMesh: `count` reveals the first N, setColorAt does the glow.
    const coals = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 14);
    const ember0 = new THREE.Color(0xff7a2a);
    for (let i = 0; i < 14; i++){
      const a = rnd() * Math.PI*2, r = Math.pow(rnd(), 1.4) * 0.55;       // clustered at the heart
      const dx = Math.cos(a)*r, dz = Math.sin(a)*r;
      const sz = 0.035 + rnd() * 0.05;
      coals.setMatrixAt(i, place(dx, floorY(dx, dz) + 0.005, dz, sz, sz, sz));   // nestled among the char
      coals.setColorAt(i, ember0);                       // instanceColor exists from the start
      this.embers.push({ heat: clamp01(1 - r / 0.55) * (0.6 + rnd() * 0.4),     // centre = hottest
                         ph: rnd() * Math.PI * 2 });
    }
    // never frustum-cull: three caches an InstancedMesh's bounds from the instances
    // shown at the time, and a cold or half-laid hearth starts with count 0
    coals.frustumCulled = false;
    S.add(coals); this.coals = coals;
    // stones — a full ring laid down, revealed in an even spread (ring fills, not one side)
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8a8a86 });
    // one InstancedMesh, laid in reveal order: update() shows the first N via `count`
    this.stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stoneMat, 11);
    for (let i = 0; i < 11; i++){
      const a = i * GOLD, r = 0.9 + rnd() * 0.07;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      const sz = 0.12 + rnd() * 0.1;
      // sit each stone on the actual ground at its spot, so the ring rides the
      // contour around the bowl rather than hovering at one flat height.
      this.stones.setMatrixAt(i, place(dx, height(x + dx, z + dz) - h0 + 0.07 + rnd() * 0.06, dz, sz, sz, sz));
    }
    this.stones.frustumCulled = false;                    // see the coals: count may start at 0
    S.add(this.stones);
    // the wood, in this fire's style — laid to its largest, revealed stick by stick
    const logMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    this.logs = [];
    // each log records `_top`, roughly how high it reaches, so a pot set over the
    // fire can hide the fuel that would otherwise poke up through it (see update).
    if (this.style === 'teepee'){                         // sticks leaning into a cone
      for (let i = 0; i < 7; i++){
        const a = i * GOLD;
        const log = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), logMat);
        log.position.set(Math.cos(a)*0.22, 0.42, Math.sin(a)*0.22);
        log.rotation.z = Math.cos(a)*0.5; log.rotation.x = -Math.sin(a)*0.5;
        log._top = 0.84;                                   // tall sticks converging up top
        S.add(log); this.logs.push(log);
      }
    } else if (this.style === 'cabin'){                   // crisscrossed log-cabin stack (revealed layer by layer)
      for (let layer = 0; layer < 3; layer++){
        const horiz = layer % 2 === 0, y = 0.1 + layer * 0.16;
        for (const off of [-0.22, 0.22]){
          const log = new THREE.Mesh(new THREE.BoxGeometry(horiz ? 0.75 : 0.12, 0.12, horiz ? 0.12 : 0.75), logMat);
          log.position.set(horiz ? 0 : off, y, horiz ? off : 0); log._top = y + 0.06;
          S.add(log); this.logs.push(log);
        }
      }
    } else {                                              // a rough pile of logs lying flat
      for (let i = 0; i < 6; i++){
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 6), logMat);
        log.rotation.z = Math.PI/2; log.rotation.y = rnd() * Math.PI;
        log.position.set((rnd()-0.5)*0.35, 0.08 + i * 0.035, (rnd()-0.5)*0.35);
        log._top = 0.08 + i * 0.035 + 0.07;
        S.add(log); this.logs.push(log);
      }
    }
    // flame: nested crossed billboards (reads from any angle) — a deep-orange
    // body, an amber middle and a white-hot core — with small licking tongues and
    // rising sparks. Each part is given its own phase so the fire DANCES (sways,
    // leans, stretches, brightens out of step) rather than pulsing as one blob.
    const mkFlameMat = (hex, op) => new THREE.MeshBasicMaterial({
      map: FLAME_TEX, color: hex, transparent: true, opacity: op,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.flame = new THREE.Group();
    this.flameParts = [];
    const LAYERS = [
      { w: 0.92, h: 1.30, hex: 0xff4a12, op: 0.80 },   // outer body, deep orange (tallest)
      { w: 0.60, h: 0.98, hex: 0xff9a2a, op: 0.95 },   // amber middle
      { w: 0.34, h: 0.66, hex: 0xfff2c4, op: 1.00 },   // white-hot core (lowest, brightest)
    ];
    for (const ly of LAYERS){
      const mat = mkFlameMat(ly.hex, ly.op);
      const part = new THREE.Group();
      for (let i = 0; i < 2; i++){                       // crossed pair, omni-directional
        const q = new THREE.Mesh(new THREE.PlaneGeometry(ly.w, ly.h), mat);
        q.rotation.y = i * Math.PI / 2; q.position.y = ly.h / 2;
        part.add(q);
      }
      part._ph = rnd() * Math.PI * 2; part._mat = mat; part._rgb = hexRGB(ly.hex);
      this.flame.add(part); this.flameParts.push(part);
    }
    // licking tongues: small flames around the heart that wave and duck in and out
    this.tongues = [];
    for (let i = 0; i < 4; i++){
      const mat = mkFlameMat(0xffb648, 0.85);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.5), mat);
      const a = rnd() * Math.PI * 2;
      q.position.set(Math.cos(a) * 0.18, 0.85 + rnd() * 0.3, Math.sin(a) * 0.18);
      q.rotation.y = rnd() * Math.PI;
      q._ph = rnd() * Math.PI * 2; q._mat = mat; q._baseY = q.position.y;
      this.flame.add(q); this.tongues.push(q);
    }
    // sparks: tiny embers that rise from the heart, drift out and wink out, then respawn
    this.sparks = [];
    for (let i = 0; i < 6; i++){
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04),
        new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      sp._t = rnd(); sp._a = rnd() * Math.PI * 2; sp._r = 0.05 + rnd() * 0.12; sp._spd = 0.55 + rnd() * 0.5;
      this.flame.add(sp); this.sparks.push(sp);
    }
    g.add(this.flame);
    // the warm light the (lit) terrain and trees pick up. A hearth doesn't own a
    // PointLight: it states the glow it would cast, and FireLights lends one of a
    // fixed few to the hearths nearest the viewer (see below).
    this.glow = { x, y: g.position.y + 0.7, z, intensity: 0, distance: 14 };

    // the camp food cache: a little basket beside the hearth whose heaped contents
    // grow with the stock. Hidden when empty. (Pattern 181's hearth as camp centre.)
    this.basket = new THREE.Group();
    const weave = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.27, 0.34, 9),
      new THREE.MeshLambertMaterial({ color: 0x7a5328 }));
    weave.position.y = 0.17;
    this.basketHeap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0xb2412e }));
    this.basketHeap.position.y = 0.34;
    this.basket.add(weave); this.basket.add(this.basketHeap);
    // sit it on the ground at its OWN offset, not the fire's centre height, so it
    // doesn't float/sink on a slope (h0 is the hearth-centre height).
    this.basket.position.set(1.7, height(x + 1.7, z + 0.4) - h0, 0.4); this.basket.visible = false;
    g.add(this.basket);

    // the cooking pot: a dark cauldron held over the flames, holding whatever raw
    // ingredients are simmering. Hidden (with its support) when nothing's cooking.
    // How it's HELD is varied per hearth, so fires don't all look alike:
    //  · 'rocks'  — the cauldron balanced low on three stout hearth-stones
    //  · 'tripod' — slung from a lashed tripod of sticks over the flames
    //  · 'spit'   — hung from a crossbar resting on two forked uprights
    this.potGroup = new THREE.Group();
    const potMat  = new THREE.MeshLambertMaterial({ color: 0x2b2b2e });
    const cookWoodMat = new THREE.MeshLambertMaterial({ color: 0x4a3320 });
    const cookStoneMat = new THREE.MeshLambertMaterial({ color: 0x807d77 });
    this.cookStyle = ['rocks', 'tripod', 'spit'][Math.floor(rnd() * 3)];
    let potY;                                               // height of the cauldron's belly centre
    if (this.cookStyle === 'rocks'){
      potY = 0.26;                                          // sits low, cradled by the stones
      for (let i = 0; i < 3; i++){
        const a = i / 3 * Math.PI*2 + rnd();
        const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + rnd() * 0.05), cookStoneMat);
        st.position.set(Math.cos(a) * 0.28, 0.11, Math.sin(a) * 0.28);
        st.scale.y = 0.85; st.rotation.set(rnd()*3, rnd()*3, rnd()*3);
        this.potGroup.add(st);
      }
    } else if (this.cookStyle === 'tripod'){
      potY = 0.52; const apex = 1.18;
      for (let i = 0; i < 3; i++){
        const a = i / 3 * Math.PI*2 + 0.3;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.04, 1.32, 5), cookWoodMat);
        leg.position.set(Math.cos(a) * 0.42, apex * 0.5, Math.sin(a) * 0.42);   // foot splayed out, top to the apex
        leg.rotation.z = -Math.cos(a) * 0.33; leg.rotation.x = Math.sin(a) * 0.33;
        this.potGroup.add(leg);
      }
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, apex - potY - 0.12, 4), potMat);
      hook.position.y = (apex + potY + 0.04) / 2; this.potGroup.add(hook);    // a short chain to the rim
    } else {                                                // spit
      potY = 0.5; const barY = 0.9;
      for (let s = -1; s <= 1; s += 2){
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, barY + 0.12, 5), cookWoodMat);
        up.position.set(s * 0.52, (barY + 0.12) / 2, 0); up.rotation.z = -s * 0.12;
        this.potGroup.add(up);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 5), cookWoodMat);
      bar.rotation.z = Math.PI/2; bar.position.y = barY; this.potGroup.add(bar);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, barY - potY - 0.12, 4), potMat);
      hook.position.y = (barY + potY + 0.04) / 2; this.potGroup.add(hook);
    }
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI*2, 0, Math.PI*0.62), potMat);
    belly.scale.y = 0.8; belly.position.y = potY;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 16), potMat);
    rim.rotation.x = Math.PI/2; rim.position.y = potY + 0.16;
    // fuel reaching above here would clip up into the cauldron, so it's hidden
    // while the pot is set (you cook over coals, not a standing stack of sticks).
    this._potClear = potY - 0.12;
    // the broth surface — coloured by the dish, bubbles gently while cooking
    this._brothY = potY + 0.14;
    this.potBroth = new THREE.Mesh(new THREE.CircleGeometry(0.25, 14),
      new THREE.MeshLambertMaterial({ color: 0x6b5230 }));
    this.potBroth.rotation.x = -Math.PI/2; this.potBroth.position.y = this._brothY;
    this.potGroup.add(belly); this.potGroup.add(rim); this.potGroup.add(this.potBroth);
    this.potGroup.position.set(0, 0, 0); this.potGroup.visible = false;
    g.add(this.potGroup);

    // the woodpile: logs people stack by the hearth, crisscrossed in layers so it
    // reads as a real stack. We pre-build WOOD_CAP logs and show as many as are
    // stocked, so the pile visibly grows and shrinks. (Pattern 181 — the hearth
    // as the camp's stocked centre.)
    const logMat2 = new THREE.MeshLambertMaterial({ color: 0x5a3d22 });
    this.woodLogs = [];
    this.woodpileGroup = new THREE.Group();
    const perLayer = 3, logLen = 1.0, logR = 0.09, gap = 0.24;
    for (let layer = 0; this.woodLogs.length < WOOD_CAP; layer++){
      const horiz = layer % 2 === 0;                  // alternate direction each layer
      for (let j = 0; j < perLayer && this.woodLogs.length < WOOD_CAP; j++){
        const log = new THREE.Mesh(new THREE.CylinderGeometry(logR, logR, logLen, 6), logMat2);
        log.rotation.z = Math.PI/2;                   // lay it on its side (running along x)
        if (!horiz) log.rotation.y = Math.PI/2;       // odd layers run along z
        const off = (j - (perLayer-1)/2) * gap;
        log.position.set(horiz ? 0 : off, logR + layer*logR*2, horiz ? off : 0);
        this.woodpileGroup.add(log); this.woodLogs.push(log);
      }
    }
    // ground the stack at its own offset so it rests on the slope, not floating
    // off the hearth-centre height.
    this.woodpileGroup.position.set(-1.6, height(x - 1.6, z + 0.5) - h0, 0.5);
    g.add(this.woodpileGroup);

    fire.group = this.group = g;
    this.update(0);          // mirror the starting state (woodpile, visibility)
  }

  update(dt){
    const fire = this.fire;
    this.flicker += (Math.random() - 0.5) * 8 * dt;
    this.flicker = clamp01(this.flicker * 0.9 + 0.1 * (0.8 + Math.random() * 0.4));
    const f = 0.75 + this.flicker * 0.5;
    const fuelSize = Math.min(1, fire.fuel * 2.5);        // flame shrinks as fuel runs low

    // the hearth is built up / let down by ADDING & REMOVING pieces (not scaling):
    // a lone fire is a few stones and sticks, a gathering has a full ring and a
    // proper stack. The level eases (so pieces don't flicker on/off at the margin).
    let near = 0;
    for (const n of fire.world.npcs) if (Math.hypot(n.x - fire.x, n.z - fire.z) < fire.ringR + 1.5) near++;
    this.fireLevel += (Math.min(1, near / 6) - this.fireLevel) * Math.min(1, dt * 0.4);
    const L = this.fireLevel;
    const B = fire.built;     // < 1 while the build ritual is still laying the hearth
    // while building, pieces appear in order — hearthstones (stage 1), then the wood
    // (stage 2) — driven by build progress; once finished, by the gathering's size.
    const styleMaxLogs = this.style === 'cabin' ? 6 : this.style === 'teepee' ? 7 : 6;
    const styleFullLogs = this.style === 'cabin' ? (1 + Math.round(L * 2)) * 2   // 1–3 layers
      : this.style === 'teepee' ? 3 + Math.round(L * 4) : 2 + Math.round(L * 4);
    const nStones = B < 1 ? Math.round(5 * clamp01(B / 0.30)) : 5 + Math.round(L * 6);
    this.stones.count = Math.min(11, nStones);
    const nLogs = B < 1 ? Math.round(styleMaxLogs * clamp01((B - 0.25) / 0.35)) : styleFullLogs;
    // when a pot is set over the fire, hide fuel that would poke up into it —
    // cooking happens over the coals, with the tall stack burnt down.
    const potted = (fire.pot.raw + fire.pot.ready) > 0;
    for (let i = 0; i < this.logs.length; i++)
      this.logs[i].visible = i < nLogs && !(potted && this.logs[i]._top > this._potClear);
    const nEmber = 4 + Math.round(L * 10);     // a lone fire glows with a few coals; a big one, a full bed

    // the flame itself is fluid, so it may grow with the wood (eased L) — that reads
    // natural, unlike scaling the stones. Light reach follows it.
    const sz = fuelSize * (0.7 + 0.9 * L);
    this.flame.visible = fire.lit;
    this.glow.intensity = (1.8 + 1.4 * f) * sz;
    this.glow.distance = 11 + 8 * L;                      // a big fire throws light further
    // cap flame height to just below the pot base when cooking (pot visible = potted);
    // 1.30 is the outer billboard layer height. This keeps flame under the cauldron.
    const flameH = potted ? this._potClear / 1.30 : sz;
    this.flame.scale.set(sz, flameH, sz);                 // overall size; the dance is per-part below

    if (fire.lit){
      this._ft = (this._ft || 0) + dt;
      const t = this._ft;
      // each nested body layer waves on its own phase: lean, side-sway, vertical
      // stretch and a brightness pulse — all out of step, so the fire flickers alive.
      for (const part of this.flameParts){
        const ph = part._ph;
        part.scale.y = 1 + 0.24 * Math.sin(t * 7 + ph) * f;
        part.scale.x = 1 + 0.10 * Math.sin(t * 9 + ph * 1.3);
        part.rotation.z = 0.10 * Math.sin(t * 5 + ph);
        part.position.x = 0.05 * Math.sin(t * 6 + ph * 1.7);
        const b = 0.6 + 0.55 * f;
        part._mat.color.setRGB(part._rgb[0] * b, part._rgb[1] * b, part._rgb[2] * b);
      }
      // tongues lick upward and occasionally duck out of sight
      for (const q of this.tongues){
        const ph = q._ph, s = 0.5 + 0.5 * Math.sin(t * 8 + ph);
        q.visible = Math.sin(t * 3 + ph) > -0.35;
        q.scale.y = 0.7 + 0.7 * s;
        q.position.y = q._baseY + 0.14 * s;
        q.rotation.z = 0.28 * Math.sin(t * 6 + ph);
        const b = 0.55 + 0.6 * f;
        q._mat.color.setRGB(b, b * 0.68, b * 0.22);
      }
      // sparks ride up from the heart, drift outward and fade, then respawn at the base
      const sparking = fire.fuel > 0.25;
      for (const sp of this.sparks){
        sp._t += dt * sp._spd;
        if (sp._t > 1){ sp._t -= 1; sp._a = Math.random() * Math.PI * 2; sp._r = 0.05 + Math.random() * 0.12; sp._spd = 0.55 + Math.random() * 0.5; }
        const life = sp._t, fade = 1 - life;
        sp.visible = sparking;
        sp.position.set(Math.cos(sp._a) * sp._r * (1 + life * 1.5), 0.7 + life * 1.5, Math.sin(sp._a) * sp._r * (1 + life * 1.5));
        sp.material.color.setRGB(fade, fade * 0.55, fade * 0.12);
        sp.scale.setScalar(0.5 + 0.9 * fade);
      }
    }
    // the coal bed: each coal glows around its own heat (hot at the heart) with its
    // own flicker, so the bed shimmers unevenly — deep red at the edge, near
    // white-orange at the centre — and fades to black when the fire is out.
    const eg = fire.lit ? 0.45 + 0.5 * f : 0;
    const ct = this._ft || 0;
    const nShown = fire.lit ? Math.min(nEmber, this.embers.length) : 0;
    this.coals.count = nShown;
    for (let i = 0; i < nShown; i++){
      const em = this.embers[i];
      const flick = 0.78 + 0.22 * Math.sin(ct * 4 + em.ph);
      const v = clamp01(eg * em.heat * flick + 0.06);
      this.coals.setColorAt(i, _emberCol.setRGB(Math.min(1, 0.55 + v * 0.7), v * v * 0.7, v * v * v * 0.3));
    }
    if (nShown) this.coals.instanceColor.needsUpdate = true;

    // the woodpile mirrors the stock (bottom layers fill first => it grows up)
    const nWood = Math.min(fire.woodpile | 0, this.woodLogs.length);
    for (let i = 0; i < this.woodLogs.length; i++) this.woodLogs[i].visible = i < nWood;

    // the food basket mirrors the cache
    this.basket.visible = fire.foodStore > 0;
    this.basketHeap.scale.setScalar(0.5 + 0.9 * Math.min(1, fire.foodStore / STORE_CAP));

    // the pot mirrors what's simmering: shown when charged, broth tinted by the
    // dish, bubbling gently while it cooks over a live flame.
    this.potGroup.visible = potted;
    if (potted){
      this.potBroth.material.color.setHex(BROTH_TINT[fire.pot.kind] || 0x6b5230);
      if (fire.pot.raw > 0 && fire.lit){
        const bub = 0.5 + 0.5 * Math.sin(this._t = (this._t || 0) + dt * 6);  // gentle bubbling
        this.potBroth.position.y = this._brothY + bub * 0.015;
      }
    }
  }
}

// ------------------------------------------------------------- shelter view
// The lean-to's meshes: two rear uprights + a bark slab, open front toward the
// nearest fire. Mirrors the sim's build progress via sync() (called from
// Shelter.raise) — it grows from the ground up while being raised.
export class ShelterView {
  constructor(shelter){
    this.shelter = shelter;
    shelter.view = this;
    const { x, z } = shelter;

    const h0 = height(x, z);
    const g = new THREE.Group();
    g.position.set(x, h0, z);
    g.rotation.y = shelter.angle;   // open front faces the nearest fire

    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a2010 });
    const slabMat = new THREE.MeshLambertMaterial({ color: 0x2a1608, side: THREE.DoubleSide });

    // two rear uprights — the lean-to's back (local -Z)
    for (const side of [-0.52, 0.52]){
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.05, 1.35, 5), poleMat);
      p.position.set(side, 0.675, -0.45);
      g.add(p);
    }
    // bark slab: PlaneGeometry (XY plane, normal +Z) rotated so it leans steeply
    // back — bottom edge near ground at front, top edge elevated at back.
    const slab = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.55), slabMat);
    slab.rotation.x = -Math.PI * 0.36;   // ~65° tilt from horizontal
    slab.position.set(0, 0.72, -0.18);
    g.add(slab);

    shelter.group = this.group = g;
    this.sync();
  }

  sync(){
    const b = this.shelter.built;
    this.group.visible = b > 0;            // hidden until the raising starts
    this.group.scale.y = Math.max(b, 0.01);   // grows from ground up while being raised
  }
}

// ------------------------------------------------------------------ hut view
// The settled shelter (docs/camp.md): a dome of bent saplings thatched with cut
// grass, with a doorway facing the hearth. Two states are mirrored from the sim,
// and both must be legible at a distance:
//   · `built`  0..1 — the raising. Frame first, then the thatch fills in.
//   · `thatch` 0..1 — the roof. As it rots the straw greys, panels drop out
//     leaving gaps, and the whole dome sags. A run-down camp should LOOK it.
// Local +Z is the doorway (the group is yawed so +Z points at the fire), matching
// ShelterView's convention.
const THATCH_FRESH = [0.60, 0.50, 0.27];   // cut straw
const THATCH_ROT   = [0.34, 0.32, 0.28];   // grey, weathered, half gone
// Dimensions in metres (the world is metric — main.js puts the eye at 1.7).
// A family hut in the record is ~3m across and tall enough to sit upright in: a
// Mbuti mongolu or a Ju/'hoansi skerm, not a kennel. The first cut was 1.9m wide
// and 0.9m tall, which read as garden furniture beside a person.
// Each hut carries its OWN half-width (`hut.rad`, 1.30–2.05m by household size),
// so every measure here is derived from it rather than fixed. HUT_SHAPE is the
// one proportion they share: how tall a dome is for its width.
const HUT_SHAPE    = 1.25;                  // crown height as a multiple of half-width
const HUT_REF      = 1.6;                   // the size the panel geometry was drawn at
const HUT_PANELS   = 18;                    // thatch panels round the dome, per course
const HUT_DOOR     = 0.5;                   // half-width of the doorway gap, radians (~1.5m across)

// ---------------------------------------------------------- patterned thatch
// Each household weaves its mark into its roof: one of Wagara's patterns
// (baked from Wagara's own generator — tools/bake_hut_patterns.py), worked in
// dyed straw against the plain. Kin share a pattern and a dye, so a camp's
// roofs say who lives next to whom, the same thing the siting already does.
//
// Three maps per pattern+dye, drawn once and shared by every hut that uses it:
//   · colour   — straw strands running down the slope, the figure in dye.
//                Near-neutral, because the material's own colour still carries
//                fresh → rotten (HutView.sync), multiplying through it.
//   · bump     — the figure stands proud of the ground strands; strands groove.
//   · specular — the dyed figure is smooth split cane and catches the light;
//                the plain straw barely does. This is what makes the pattern
//                glint as you walk past, or in firelight — and it dulls as the
//                roof rots (sync scales the specular colour by the thatch).
// Phong, not Standard: it gives the glint for little more than Lambert costs.
const THATCH_TEX   = 128;                               // px, square, one tile
const THATCH_SETS  = new Map();                         // 'pattern|dye' → { map, bumpMap, specularMap }

// a deterministic hash, so a strand looks the same on every load
const strandHash = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function thatchSet(key, dye){
  const id = key + '|' + dye;
  let set = THATCH_SETS.get(id);
  if (set) return set;
  const N = THATCH_TEX;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cv = { map: mk(), bumpMap: mk(), specularMap: mk() };
  set = {};
  for (const k in cv){
    const t = new THREE.CanvasTexture(cv[k]);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter;                  // crisp up close, like the rest of the world
    t.minFilter = THREE.LinearMipmapLinearFilter;       // ...but a fine figure must not crawl at a distance
    t.colorSpace = k === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    set[k] = t;
  }
  THATCH_SETS.set(id, set);
  const paint = (mask) => {                             // mask: Uint8 alpha, 1 = figure
    const d = THATCH_DYES[dye];
    const ctx = {}, img = {};
    for (const k in cv){ ctx[k] = cv[k].getContext('2d'); img[k] = ctx[k].createImageData(N, N); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const sx = x >> 1;                                // strands two texels wide, running down the slope
      const strand = strandHash(sx, 7);
      const along = strandHash(sx, y >> 3);             // each strand varies along its length
      const groove = (x & 1) ? 0 : 0.18;                // the line between two strands
      const f = mask ? mask[y * N + x] : 0;
      const straw = 0.82 + 0.16 * strand + 0.06 * along - groove * 0.5;
      const i = (y * N + x) * 4;
      const c = img.map.data, b = img.bumpMap.data, sp = img.specularMap.data;
      const r = f ? d[0] / 0.6 : 1, g = f ? d[1] / 0.5 : 1, bl = f ? d[2] / 0.27 : 1;   // dye relative to fresh straw
      c[i]     = Math.min(255, 255 * straw * r);
      c[i + 1] = Math.min(255, 255 * straw * g);
      c[i + 2] = Math.min(255, 255 * straw * bl);
      c[i + 3] = 255;
      const h = 0.35 + 0.15 * strand - groove + (f ? 0.4 : 0);
      b[i] = b[i + 1] = b[i + 2] = Math.max(0, Math.min(255, 255 * h)); b[i + 3] = 255;
      const s = f ? 0.75 + 0.25 * along : 0.12 + 0.12 * strand;
      sp[i] = sp[i + 1] = sp[i + 2] = 255 * s; sp[i + 3] = 255;
    }
    for (const k in cv){ ctx[k].putImageData(img[k], 0, 0); set[k].needsUpdate = true; }
  };
  const mask = patternMask(key, N, paint);              // plain straw until the figure has decoded
  paint(mask);
  return set;
}
// whose mark: kin share one; a hut with no household takes one from where it stands
// (the same mark their packs carry — js/kin-mark.js)
function hutMark(hut){
  return kinMark(hut.kin && Number.isFinite(hut.kin.id) ? hut.kin.id
               : Math.round(hut.x * 7 + hut.z * 13));
}
const THATCH_SPEC = new THREE.Color(0x6a5c44);         // the glint at a fresh roof
// A panel whose UVs are in tiles, not 0..1: one pattern repeat is the same size
// on every panel and every hut, rather than stretched to whatever panel it lands on.
const THATCH_TILE = 0.9;                                // metres per repeat
function thatchPanel(w, h){
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / THATCH_TILE, uv.getY(i) * h / THATCH_TILE);
  return g;
}

export class HutView {
  constructor(hut){
    this.hut = hut;
    hut.view = this;
    const { x, z } = hut;

    const R = hut.rad, H = R * HUT_SHAPE;
    const g = new THREE.Group();
    g.position.set(x, height(x, z), z);
    const shelterAngle = hut.angle;
    g.rotation.y = shelterAngle;           // doorway (local +Z) faces the hearth

    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a2010 });
    const mark = hutMark(hut);
    this.mark = mark.key;
    const tex = thatchSet(mark.key, mark.dye);
    this.thatchMat = new THREE.MeshPhongMaterial({ color: 0x998044, side: THREE.DoubleSide,
      map: tex.map, bumpMap: tex.bumpMap, bumpScale: 2.5, specularMap: tex.specularMap,
      specular: THATCH_SPEC.clone(), shininess: 28 });

    // The ground inside is in shade, like the ground under a tree. Drapes over the
    // real heightfield so it lies flush on a slope. Counter-rotated out of the
    // group's yaw so the drape still matches the terrain it was sampled from (the
    // group is turned to face the hearth, the ground is not).
    SHADE_TEX ||= shadeTexture();
    // Lambert, not Basic: an unlit material keeps its full daylight value after
    // dark, so the patch stopped being a shadow and started being a stain that
    // glowed against the night ground. Lit, it darkens with everything else — and
    // a shadow at midnight is correctly almost nothing.
    this.shadeMat = new THREE.MeshLambertMaterial({ map: SHADE_TEX, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const shade = groundPatch(x, z, R * 1.06, this.shadeMat);
    shade.rotation.y = -shelterAngle;
    g.add(shade);
    this.shade = shade;

    // Stage one, and the reason it comes first: the ground scraped and a ring of
    // stakes driven in. It stands before any wall does, so from the moment it
    // appears every other builder's siting can see the ground is taken.
    const stakes = new THREE.Group();
    const stakeGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.42, 4);
    const nStakes = Math.max(7, Math.round(R * 5));
    this.stakes = [];
    for (let i = 0; i < nStakes; i++){
      let a = (i / nStakes) * Math.PI * 2;
      let d = a; while (d > Math.PI) d -= Math.PI * 2;
      if (Math.abs(d) < HUT_DOOR) continue;          // the doorway is left open
      const st = new THREE.Mesh(stakeGeo, poleMat);
      st.position.set(Math.sin(a) * R, 0.19, Math.cos(a) * R);
      st.rotation.z = (i % 3 - 1) * 0.12;            // driven in by hand, not machined
      stakes.add(st); this.stakes.push(st);
    }
    g.add(stakes);

    // the frame: three bent saplings crossing at the crown (the mongolu/skerm
    // dome — arches jammed into the ground, not a carpentered thing)
    const ribs = new THREE.Group();
    const ribGeo = new THREE.TorusGeometry(R, 0.05, 4, 9, Math.PI);
    this.tall = H / R;                     // the frame is a squashed circle, wider than high
    for (let i = 0; i < 3; i++){
      const rib = new THREE.Mesh(ribGeo, poleMat);
      rib.rotation.y = i * Math.PI / 3;
      ribs.add(rib);
    }
    g.add(ribs);
    this.ribs = ribs;

    // Thatch, in two courses tiled from the ground up — which is how it is
    // actually done (the lower course first, the upper lapped over it, so water
    // runs off one onto the next). One shell would be cheaper, but tiles are what
    // let the roof open in patches as it rots.
    // Each course sits at a polar angle up the dome, so both follow the frame's
    // real curve rather than being placed by eye.
    this.panels = [];
    const onDome = (phi) => ({ r: R * Math.cos(phi), y: H * Math.sin(phi) });
    const k = R / HUT_REF;                 // the thatch panels scale with the dome
    // The courses must LAP — a gap between them shows the frame through, which is
    // what a bigger dome exposed. Each is wide enough to overlap its neighbours
    // round the ring, and set low enough to overlap the course below.
    const courses = [
      { geo: thatchPanel(1.05 * k, 1.75 * k), ...onDome(0.34), tilt: -0.34 },   // skirt
      { geo: thatchPanel(0.95 * k, 1.60 * k), ...onDome(0.88), tilt: -0.95 },   // crown
    ];
    for (const [c, course] of courses.entries()){
      for (let i = 0; i < HUT_PANELS; i++){
        const a = (i / HUT_PANELS) * Math.PI * 2 + c * (Math.PI / HUT_PANELS);   // upper course laps the joints below
        // the doorway: leave the panels facing the fire off entirely
        let d = a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < HUT_DOOR * (c ? 0.6 : 1)) continue;   // the crown laps further over the door
        const p = new THREE.Mesh(course.geo, this.thatchMat);
        p.position.set(Math.sin(a) * course.r, course.y, Math.cos(a) * course.r);
        p.rotation.set(0, a, 0);
        p.rotateX(course.tilt);            // lean the top in toward the crown
        g.add(p);
        this.panels.push(p);               // pushed course by course = laying order
      }
    }
    // ...and a scattered order for taking them away again, so a rotting roof
    // opens up in patches rather than unzipping round the dome
    this.rot = this.panels.map((_, i) => i);
    for (let i = this.rot.length - 1; i > 0; i--){
      const j = ((i * 7 + 3) % (i + 1));   // deterministic shuffle — same hut, same wear
      [this.rot[i], this.rot[j]] = [this.rot[j], this.rot[i]];
    }

    hut.group = this.group = g;
    this.sync();
  }

  sync(){
    const h = this.hut, b = h.built, th = h.thatch;
    this.group.visible = h.staked > 0;               // nothing stands until the ground is marked
    // the stakes go in one by one as the ground is staked out, and stay standing
    // afterwards as the hut's footing
    const staked = Math.round(this.stakes.length * clamp01(h.staked));
    for (let i = 0; i < this.stakes.length; i++) this.stakes[i].visible = i < staked;
    // the raising: frame up to 0.45, thatch from there
    const frame = clamp01(b / 0.45), roof = clamp01((b - 0.45) / 0.55);
    this.ribs.scale.y = Math.max(frame, 0.01) * this.tall;   // squashed to the dome's height, and grows as it's raised
    // Two independent facts about a panel: whether it has been LAID yet (the
    // raising, bottom course first) and whether it has since ROTTED off. A panel
    // shows only if both say so.
    const n = this.panels.length;
    const laid = Math.round(n * roof);
    const kept = Math.round(n * (0.25 + 0.75 * th));
    for (const p of this.panels) p.visible = false;
    for (let i = 0; i < n; i++){
      const idx = this.rot[i];
      if (i < kept && idx < laid) this.panels[idx].visible = true;
    }
    const t = clamp01(1 - th);
    this.thatchMat.color.setRGB(
      THATCH_FRESH[0] + (THATCH_ROT[0] - THATCH_FRESH[0]) * t,
      THATCH_FRESH[1] + (THATCH_ROT[1] - THATCH_FRESH[1]) * t,
      THATCH_FRESH[2] + (THATCH_ROT[2] - THATCH_FRESH[2]) * t);
    this.thatchMat.specular.copy(THATCH_SPEC).multiplyScalar(0.15 + 0.85 * th);   // a rotten roof stops shining
    this.group.scale.y = 0.86 + 0.14 * th;   // a bare frame sags
    // The shade belongs to the roof: none until the courses start going on
    // (`roof` is the raising), then as deep as the thatch that is left.
    this.shade.visible = roof > 0.02;
    this.shadeMat.opacity = 0.25 + 0.75 * clamp01(roof * th);
  }
}
