import * as THREE from 'three';
import { PERSON_H, WORLD_R, UNITS_PER_M } from './config.js';
import { height, walkable, randomLand } from './terrain.js';
import { makeLabel } from './label.js';
import { makePackTexture } from './textures.js';
import { KIN_DYES, kinMark, patternMask } from './kin-mark.js';
import { scanAtlas } from './headscan.js';

const WHITE = new THREE.Color(1, 1, 1);
const FACE_CARD_FALLBACK_TOP = 0.035;   // crown row / frameH if a frame's scan fails

// Cache pack textures by their contents (and their household's mark) so
// identical packs share one texture.
const PACK_CACHE = new Map();
const PACK_MARK_N = 28;            // px per pattern repeat: one across the sack (fewer and the finer figures turn to noise)
function packKey(food, wood, kind, trinkets, group){
  food = Math.min(food, 6); wood = Math.min(wood, 4); trinkets = Math.min(trinkets, 2);   // match the texture's draw caps
  let key = food + '|' + wood + '|' + kind + '|' + trinkets;
  if (group && Number.isFinite(group.id)){
    const m = kinMark(group.id);
    // until the pattern has decoded the pack is drawn plain; the key changes once
    // it is ready, so the next frame swaps in the marked one
    key += '|' + m.key + '|' + m.dye + (patternMask(m.key, PACK_MARK_N) ? '' : '|plain');
  }
  return key;
}
function packTexture(food, wood, kind, trinkets, group, key){
  let t = PACK_CACHE.get(key);
  if (!t){
    let mark = null;
    if (group && Number.isFinite(group.id)){
      const m = kinMark(group.id), mask = patternMask(m.key, PACK_MARK_N);
      if (mask) mark = { mask, n: PACK_MARK_N, dye: KIN_DYES[m.dye] };
    }
    t = makePackTexture(Math.min(food, 6), Math.min(wood, 4), kind, Math.min(trinkets, 2), mark);
    PACK_CACHE.set(key, t);
  }
  return t;
}

// viewing sector (0 = we see the front .. 4 = the back) -> [atlas row, mirror?]
const DIR_MAP = [[0,false],[1,false],[2,false],[3,false],[4,false],
                 [3,true],[2,true],[1,true]];

const FIRE_GLOW = new THREE.Color(1.0, 0.72, 0.42);   // warm cast when near a fire

// height scale by folk — goblins are little, dwarves short & stout (1 = human/elf)
const RACE_SCALE = { dwarf: 0.72, goblin: 0.62 };
// Match on slug segments (e.g. 'male-peasant-goblin') to avoid substring collisions.
function raceScale(slug = ''){
  const parts = new Set(slug.split('-'));
  for (const r in RACE_SCALE) if (parts.has(r)) return RACE_SCALE[r];
  return 1;
}

// The M&M sprites reserve magenta / green / blue / yellow as palette-swap zones,
// but WHICH colour means garment vs hair/trim differs per sheet (e.g. the dwarf's
// magenta is his tunic & green his beard, but the female human's magenta is her
// hair & green her dress; the male-human-b's garment is blue). There's no reliable
// automatic rule, so for this fixed set of 8 sprites we hardcode each zone's role.
// Roles -> palette: shirt = primary, hair = accent, trim = secondary. Shading is
// preserved by scaling the target by the pixel's brightness; goblin green *skin*
// (r≈g) never matches isGrn so it's left alone.
//
// The sheets also pair tintable walk frames with a PRE-COLOURED stand frame
// (column 0). So idle/chop must use the first walk frame, never col 0.
const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
const isMag = (r, g, b) => g * 2 < r && g * 2 < b && r > 28 && b > 28;
const isGrn = (r, g, b) => r * 2 < g && b * 5 < g * 4 && g > 28;   // r<0.5g excludes goblin skin
const isBlu = (r, g, b) => b > 60 && b > r * 1.6 && b > g * 1.4;   // b clearly dominant (not magenta, where r≈b)
const isYel = (r, g, b) => b < 45 && r > 120 && g > 110;
// per-sprite zone roles (see above). DEFAULT covers any unlisted sprite.
const TINT_ROLES = {
  'male-peasant-human-a':   { mag: 'shirt', grn: 'hair', yel: 'hair' },
  'female-peasant-human-a': { mag: 'hair',  grn: 'shirt' },
  'male-peasant-human-b':   { blu: 'shirt', grn: 'hair' },   // magenta speck on lips: ignored
  'male-peasant-dwarf':     { mag: 'shirt', grn: 'hair' },   // green = beard
  'male-peasant-elf':       { mag: 'shirt', grn: 'hair' },
  'female-peasant-elf':     { mag: 'hair',  grn: 'shirt' },
  'male-peasant-goblin':    { mag: 'shirt' },
  'female-peasant-goblin':  { mag: 'shirt', blu: 'hair' },
};
const DEFAULT_ROLES = { mag: 'shirt', grn: 'hair', yel: 'hair' };

function tintSprite(img, pal, m, roles){
  const w = img.width, h = img.height;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const col = { shirt: pal.primary, hair: pal.accent, trim: pal.secondary };
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] < 8) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    let role, f;
    if (roles.mag && isMag(r, g, b)){ role = roles.mag; f = Math.max(r, b) / 200; }
    else if (roles.grn && isGrn(r, g, b)){ role = roles.grn; f = g / 175; }
    else if (roles.blu && isBlu(r, g, b)){ role = roles.blu; f = b / 200; }
    else if (roles.yel && isYel(r, g, b)){ role = roles.yel; f = (r + g) * 0.5 / 200; }
    else continue;
    const c = col[role];
    d[i] = clamp255(c[0] * f); d[i + 1] = clamp255(c[1] * f); d[i + 2] = clamp255(c[2] * f);
  }
  ctx.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return { tex: t, idleCol: m.walkStart };   // never the pre-coloured stand frame
}

// Painted-face card placement. The card is a small billboard held over the baked
// sprite head — but WHERE the head is comes from scanning the sprite's pixels per
// frame (js/headscan.js), so it tracks the character's height and its walk-sway
// automatically. These are only the global art constants relating the painted
// overlay to a detected head box; tuned live in face-placement.html →
// face_params.json (defaults below apply if the file is missing).
//   size — card height as a fraction of body height
//   drop — card centre below the detected crown, as a fraction of body height
//   x    — fine horizontal nudge, as a fraction of body width
//   fwd  — nudge toward camera so the card draws in front of the sprite plane
// The crown (head top) and head-centre-x are read from the sprite per frame, so
// the card follows the sway and the character's height; these globals relate the
// painted overlay to that crown and are the same for every Lea (they share a skull).
let FACE_CARD = { size: 0.16, drop: 0.075, x: 0.0, fwd: 0.05 };
try { FACE_CARD = { ...FACE_CARD, ...(await (await fetch('face_params.json')).json()) }; }
catch (_) { /* no params file — defaults stand */ }

class AnimNPC {
  constructor(base, x, z, label = null){
    this.x = x; this.z = z; this.m = base.m; this.h = PERSON_H * raceScale(base.slug) * (base.heightScale || 1); this.label = label;
    this.tex = base.tex.clone(); this.tex.needsUpdate = true;
    this._baseTex = this.tex; this._baseM = base.m;        // base (walk) atlas, for restoring after a pose
    this._baseAspect = base.m.frameW/base.m.frameH;
    this.poses = base.poses || null;                       // optional sitting/reclining idle atlases
    this._poseTex = {}; this._curPose = null;              // lazily-cloned pose textures + current pose
    // billboardH > h when the atlas has top padding for a wearable (crown etc.) that
    // extends above the character's head. The plane is taller but the character's
    // world height (this.h, feet→head) stays unchanged.
    const _topPad = base.m.topPad || 0;
    this._billboardH = _topPad ? this.h * base.m.frameH / (base.m.frameH - _topPad) : this.h;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this._billboardH*(this.m.frameW/this.m.frameH), this._billboardH),
      new THREE.MeshBasicMaterial({map:this.tex, alphaTest:0.5, transparent:true, fog:true})
    );
    this.mesh.position.set(x, height(x,z)+this._billboardH/2, z);
    if (label) label.position.set(x, height(x,z)+this._billboardH+0.6, z);
    this.heading = Math.random()*Math.PI*2;
    this.wander = 0; this.frame = 0; this.frameT = 0; this.moving = false; this.chopAnim = 0;
    this.idleCol = this.m.standCol;   // overridden by recolor() if the stand frame is pre-coloured
    // a backpack billboard shown on the back when carrying food/firewood
    this.packMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.h*0.42, this.h*0.4),
      new THREE.MeshBasicMaterial({ alphaTest:0.5, transparent:true, fog:true })
    );
    this.packMesh.visible = false; this._packKey = '';
    this.faceMesh = null;   // optional painted-face card over the head (setFace)
  }
  // Give this NPC a painted-face card (js/face.js) shown over the baked head when
  // facing the camera. `tex` is a head-crop texture, `aspect` its width/height.
  // Scans the sprite atlas for the head box per front-facing frame (so placement
  // tracks height + sway) and sizes the card to the detected head width.
  // Returns the mesh so the caller can add it to the scene.
  setFace(tex, aspect){
    this._headBoxes = scanAtlas(this._baseTex.image, this.m, [0, 1]);
    // Card sized off body height (all Leas share a skull, so one size fits all);
    // it's positioned per frame from the detected crown + sway in _updateFace.
    const h = this._billboardH * FACE_CARD.size, w = h * aspect;
    this.faceMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, fog: true, depthWrite: false })
    );
    this.faceMesh.renderOrder = 1;   // draw after the body sprite so it sits on top
    return this.faceMesh;
  }
  setCell(row, col, flip){
    const C = this.m.cols, R = this.m.rows, t = this.tex;
    t.repeat.set((flip?-1:1)/C, 1/R);
    t.offset.set((flip ? col+1 : col)/C, 1 - (row+1)/R);
  }
  // Swap the active atlas to a pose variant (sitting/reclining) or back to the
  // base walk atlas. Pose textures are cloned lazily and cached. No-op if the
  // pose is already active. Dormant when this NPC has no pose atlases.
  _usePose(pose){
    if (pose === this._curPose) return;
    this._curPose = pose;
    if (!pose){ this.tex = this._baseTex; this.m = this._baseM; }
    else {
      const p = this.poses[pose];
      if (!this._poseTex[pose]){
        const t = p.tex.clone(); t.needsUpdate = true; this._poseTex[pose] = t;
      }
      this.tex = this._poseTex[pose]; this.m = p.m;
    }
    this.mesh.material.map = this.tex; this.mesh.material.needsUpdate = true;
    this.frame = 0; this.frameT = 0;
  }
  // Replace the base atlas with one baked on this machine (js/avatar-bake.js). It has
  // its own frame size, and its own HEIGHT: the billboard spans `frameM` metres of
  // world, so a tall body is a tall sprite. Pose atlases don't apply to it.
  setAtlas(image, m, frameM){
    const t = new THREE.Texture(image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.tex.dispose?.();
    this.tex = t; this._baseTex = t; this.m = m; this._baseM = m;
    this.poses = null; this._poseTex = {}; this._curPose = null; this._headBoxes = null;
    this.idleCol = m.standCol; this._baseAspect = m.frameW / m.frameH;
    this.h = this._billboardH = frameM * UNITS_PER_M;
    const gy = height(this.x, this.z);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(this._billboardH * this._baseAspect, this._billboardH);
    this.mesh.position.set(this.x, gy + this._billboardH / 2, this.z);
    if (this.label) this.label.position.set(this.x, gy + this._billboardH + 0.6, this.z);
    this.mesh.material.map = t; this.mesh.material.needsUpdate = true;
    this.setCell(0, this.idleCol, false);
    this.baked = true;
  }
  // a pose atlas baked on this machine (avatar-bake.js bakeSitAtlas): same frame
  // height and world scale as the walk atlas, its own width
  setPoseAtlas(pose, image, m){
    const t = new THREE.Texture(image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    (this.poses ??= {})[pose] = { tex: t, m };
    this._poseTex[pose] = null; this._curPose = null;
  }
  // swap this NPC's atlas for one tinted to `palette`, and move idle/chop onto a
  // tintable frame if the stand frame is a pre-coloured variant. Keeps the current
  // frame's UV; old texture is freed.
  recolor(palette){
    const src = this.tex.image;
    if (!src || !src.width) return;
    const roles = TINT_ROLES[this.slug] || DEFAULT_ROLES;
    const { tex, idleCol } = tintSprite(src, palette, this.m, roles);
    tex.repeat.copy(this.tex.repeat); tex.offset.copy(this.tex.offset);
    this.tex.dispose?.();
    this.tex = tex; this.idleCol = idleCol;
    this._baseTex = tex; this._curPose = null;   // base atlas changed; re-sync on next pose check
    this.mesh.material.map = tex; this.mesh.material.needsUpdate = true;
  }
  // Apply a procedurally-generated crown canvas to this NPC's sprite atlas.
  // Expands each cell's height by topPad=100px, placing the crown in the headspace
  // and the original character in the lower portion. Updates the billboard geometry
  // so the crown appears in-world above the character's head.
  wearCrown(crownCanvas){
    this.m = { ...this.m };   // own copy — don't mutate the shared manifest entry
    const origFH = this.m.frameH, topPad = 100, newFH = origFH + topPad;
    const { cols, rows } = this.m, fw = this.m.frameW;
    const srcImg = this._baseTex.image;
    if (!srcImg?.width) return;
    // Build expanded atlas: original content pushed down by topPad in each row
    const cv = document.createElement('canvas');
    cv.width = fw * cols; cv.height = newFH * rows;
    const ctx = cv.getContext('2d');
    for (let row = 0; row < rows; row++){
      ctx.drawImage(srcImg,
        0, row * origFH, fw * cols, origFH,
        0, row * newFH + topPad, fw * cols, origFH);
    }
    // Composite crown into the top area of every cell (same pose across all walk frames).
    // nominalH is the layout height (CROWN_H) used for scale/position; the actual canvas
    // may be taller (overflow when arc centre sits below the canvas edge), and those extra
    // pixels are drawn into the sprite area so flowers don't get clipped at the forehead.
    const crownW = crownCanvas.width;
    const nominalH = crownCanvas._nominalH || crownCanvas.height;
    const scale  = Math.min(fw / crownW, topPad / nominalH);
    const drawW  = crownW * scale, drawH = crownCanvas.height * scale;
    for (let row = 0; row < rows; row++){
      for (let col = 0; col < cols; col++){
        ctx.drawImage(crownCanvas,
          col * fw + (fw - drawW) / 2,
          row * newFH + (topPad - nominalH * scale),
          drawW, drawH);
      }
    }
    // Replace texture
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.copy(this.tex.repeat); t.offset.copy(this.tex.offset);
    this.tex.dispose?.();
    this.tex = t; this._baseTex = t; this._curPose = null;
    this.mesh.material.map = t; this.mesh.material.needsUpdate = true;
    // Update frame dimensions and billboard height
    this.m.frameH = newFH; this.m.topPad = topPad;
    this._billboardH = this.h * newFH / origFH;
    // Rebuild geometry to show the crown above the character's head
    const gy = height(this.x, this.z);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(
      this._billboardH * (fw / newFH), this._billboardH);
    this.mesh.position.set(this.x, gy + this._billboardH / 2, this.z);
    if (this.label) this.label.position.set(this.x, gy + this._billboardH + 0.6, this.z);
  }
  update(cam, dt, tint){
    if (tint) this.mesh.material.color.copy(tint);   // brighten/dim with the daylight
    if (this.fireGlow) this.mesh.material.color.lerp(FIRE_GLOW, this.fireGlow);   // warmed by a fire
    this.moving = false;
    if (!this.talking){                          // frozen while in dialogue
      if (this.brain) this.brain.step(dt);       // smart-object decision loop (agents.js)
      else {                                      // default: aimless wander
        this.wander -= dt;
        if (this.wander <= 0){ this.heading = Math.random()*Math.PI*2; this.wander = 2+Math.random()*4; }
        const spd = 1.6*dt;
        const vx = Math.sin(this.heading)*spd, vz = Math.cos(this.heading)*spd;
        if (walkable(this.x+vx, this.z+vz) && Math.hypot(this.x+vx, this.z+vz) < WORLD_R){
          this.x += vx; this.z += vz; this.moving = true;
        } else { this.heading += Math.PI*0.7; this.wander = 1+Math.random()*2; }
      }
    }
    // chopping firewood: a rhythmic axe-swing. The atlas has no attack frames
    // (10 cols = stand + 9 walk), so unless one is added (m.attackStart) we sell
    // the action procedurally — a quick dip-and-lean on each downstroke.
    let chopDip = 0, lean = 0;
    if (this.chopping){ this.chopAnim += dt; const p = this.chopAnim * 9;
      chopDip = Math.abs(Math.sin(p)) * 0.14;       // body bends as the axe falls
      lean = Math.sin(p) * 0.22;
    } else this.chopAnim = 0;

    // goblins break into a Puck-like hopping gait now and then, instead of walking.
    // They toggle between strolling and bounding every few seconds; while bounding
    // and on the move they rise on a sine arc and hold a legs-together frame.
    let hopOff = 0; this.hopGait = false;
    if ((this.slug || '').includes('goblin')){
      this.hopSwitch = (this.hopSwitch ?? (2 + Math.random()*3)) - dt;
      if (this.hopSwitch <= 0){
        this.hopBound = !this.hopBound;                       // flip walk <-> hop
        this.hopSwitch = this.hopBound ? 1.5 + Math.random()*2.5 : 3 + Math.random()*5;
        this.hopPhase = 0;
      }
      if (this.hopBound && this.moving && !this.sitting && !this.chopping){
        this.hopPhase = (this.hopPhase || 0) + 8 * dt;
        const air = Math.sin(this.hopPhase);
        hopOff = Math.max(0, air) * (0.4 * this.h);
        this.hopGait = true;
        if (air > 0){                                  // a real bound: spring forward while airborne
          const fwd = 2.6 * dt;
          const nx = this.x + Math.sin(this.heading)*fwd, nz = this.z + Math.cos(this.heading)*fwd;
          if (walkable(nx, nz) && Math.hypot(nx, nz) < WORLD_R){ this.x = nx; this.z = nz; }
        }
      }
    }

    // night-gathering sway: seated folk at a gathering rock gently in unison (a
    // shared wall-clock phase keeps the whole circle in time — song made visible).
    let sway = 0, swayBob = 0;
    if (this.sitting && this.atGathering){
      const ph = performance.now() * 0.0016;        // shared across all NPCs → synchronised
      sway = Math.sin(ph) * 0.1;
      swayBob = (Math.cos(ph * 2) * 0.5 + 0.5) * this.h * 0.03;
    }

    // Seated/reclining NPCs use a baked pose atlas when one exists for their slug
    // (<slug>-sitting / <slug>-reclining in the manifest); otherwise they keep
    // standing (the earlier behaviour — shrinking sank feet into sloped ground).
    // Gate on *actual* stillness, not just the sitting flag: an NPC can carry a
    // "sit" intent (e.g. tending a fire) while the brain walks it off to fetch wood,
    // so we measure real translation this frame — any movement → walk sprite, only a
    // planted NPC shows the seated pose. Covers brain locomotion, drift and boats alike.
    const speed = (this._lastX != null)
      ? Math.hypot(this.x - this._lastX, this.z - this._lastZ) / Math.max(dt, 1e-4) : 0;
    this._lastX = this.x; this._lastZ = this.z;
    // boat crossing counts as planted for pose selection even though position changes
    const planted = speed < 0.15 || !!this._inBoat;
    // only the baked villagers' seated sheets (avatar-bake.js) — the older painted
    // sitting sheets stay off, as they have been since July
    this._usePose(this.baked && this.sitting && planted && this.poses?.sitting ? 'sitting' : null);
    // NPCs in boats with no sitting sprite: show only the top half of the walk sprite
    // so their legs don't appear below the waterline. rideY is set to the gunwale.
    const boatClip = !!this._inBoat && !this._curPose;
    const clipFrac = boatClip ? 0.5 : 1;
    this.mesh.scale.y = clipFrac;
    // Pose atlases may have a different frame aspect than the walk atlas; the plane
    // encodes the base aspect, so compensate on x. (Pose bakes share the walk's
    // world scale + bottom-anchoring, so height/grounding stay unchanged.)
    this.mesh.scale.x = this._curPose ? (this.m.frameW/this.m.frameH)/this._baseAspect : 1;
    // rideY overrides the ground height when seated in a boat (over water).
    const gy = this.rideY != null ? this.rideY : height(this.x, this.z), halfH = this._billboardH * clipFrac / 2;
    this.mesh.position.set(this.x, gy + halfH - chopDip + hopOff + swayBob, this.z);
    if (this.label) this.label.position.set(this.x, gy + this._billboardH * clipFrac + 0.5 + hopOff, this.z);

    const toCam = Math.atan2(cam.position.x - this.x, cam.position.z - this.z);
    this.mesh.rotation.y = toCam;
    this.mesh.rotation.z = lean + sway;            // chop-lean and/or gathering sway
    let rel = ((this.heading - toCam) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
    const [row, flip] = DIR_MAP[Math.round(rel/(Math.PI/4)) % 8];
    let col = this.idleCol;                             // a tintable frame (not the pre-coloured stand)
    if (this.chopping && this.m.attackStart != null){   // real attack frames, if the atlas ever gains them
      this.frameT += dt;
      if (this.frameT > 0.09){ this.frameT = 0; this.frame = (this.frame+1) % this.m.attackLen; }
      col = this.m.attackStart + this.frame;
    } else if (this.moving){
      this.frameT += dt;
      if (this.frameT > 0.11){ this.frameT = 0; this.frame = (this.frame+1) % this.m.walkLen; }
      col = this.m.walkStart + this.frame;
    } else this.frame = 0;
    if (this._curPose){                                // seated/reclining idle loop from the pose atlas
      this.frameT += dt;
      if (this.frameT > 0.13){ this.frameT = 0; this.frame = (this.frame+1) % this.m.walkLen; }
      col = this.m.walkStart + this.frame;
    }
    if (this.hopGait) col = this.idleCol;              // legs-together frame reads as a bound
    this.setCell(row, col, flip);
    if (this.faceMesh) this._updateFace(row, col, flip, toCam, gy, hopOff + swayBob - chopDip, lean + sway, tint);
    if (boatClip) {
      // crop to the top half of the current cell so only torso+head shows above the gunwale
      this.tex.repeat.y = 0.5 / this.m.rows;
      this.tex.offset.y = 1 - (row + 0.5) / this.m.rows;
    }

    this._updatePack(toCam, clipFrac, tint, hopOff);
  }

  // Show a backpack on the NPC's back when it's carrying. Placed behind the body
  // along its heading, so it reads as a pack (visible when you see their back,
  // tucked behind them from the front). Texture redrawn only when contents change.
  _updatePack(toCam, sy = 1, tint, hopOff = 0){
    const food = this.pack | 0, wood = this.firewood | 0, trink = this.trinkets | 0;
    if (food <= 0 && wood <= 0 && trink <= 0){ this.packMesh.visible = false; return; }
    // the morsels poking out are what's actually carried (larder.js), a few of each kind
    const kind = this.larder && this.larder.length
      ? this.larder.flatMap(b => Array(Math.min(b.n, 3)).fill(b.kind)).slice(0, 6).join(',') : (this.packKind || 'food');
    const key = packKey(food, wood, kind, trink, this.group);
    if (key !== this._packKey){
      this._packKey = key;
      this.packMesh.material.map = packTexture(food, wood, kind, trink, this.group, key);
      this.packMesh.material.needsUpdate = true;
    }
    const back = 0.18, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const gy = this.rideY != null ? this.rideY : height(this.x, this.z);   // ride the gunwale over water
    if (this._curPose === 'sitting'){
      // seated: the pack is off, resting on the ground at their side
      const side = this.h * 0.32, behind = this.h * 0.06, half = this.packMesh.geometry.parameters.height / 2;
      const px = this.x - fz*side - fx*behind, pz = this.z + fx*side - fz*behind;
      this.packMesh.position.set(px, (this.rideY != null ? this.rideY : height(px, pz)) + half, pz);
    } else this.packMesh.position.set(
      this.x - fx*back, gy + this.h*0.6*sy + hopOff, this.z - fz*back);
    this.packMesh.rotation.set(0, toCam, 0, 'YXZ');
    this.packMesh.material.color.copy(tint || WHITE);
    this.packMesh.visible = true;
  }

  // Hold the painted-face card over the head, facing the camera. Only shown when
  // the NPC is facing us (front sectors) — the painted face is frontal, so it
  // hides as they turn away and the baked head takes over. The head position is
  // read from the current frame's detected head box, so the card tracks the
  // walk-sway and the character's height. Lit with the body.
  _updateFace(row, col, flip, toCam, gy, yOff, rotZ, tint){
    const fm = this.faceMesh;
    fm.visible = (row === 0 || row === 1) && !this._inBoat;
    if (!fm.visible) return;
    const fh = this.m.frameH, fw = this.m.frameW;
    const hb = this._headBoxes?.[row]?.[col] || this._headBoxes?.[0]?.[0];
    // Anchor to the detected crown, dropped down to the face; centre-x follows sway.
    const topFrac = hb ? hb.top / fh : FACE_CARD_FALLBACK_TOP;
    let cxFrac = hb ? hb.cx / fw - 0.5 : 0;
    if (flip) cxFrac = -cxFrac;                                    // mirrored 3/4 view
    const bodyW = this._billboardH * (fw / fh);
    const ox = (cxFrac + FACE_CARD.x) * bodyW;                     // horizontal in the billboard plane
    const fx = Math.sin(toCam), fz = Math.cos(toCam);             // toward camera
    fm.position.set(
      this.x + fx * FACE_CARD.fwd + Math.cos(toCam) * ox,
      gy + this._billboardH * (1 - topFrac - FACE_CARD.drop) + yOff,
      this.z + fz * FACE_CARD.fwd - Math.sin(toCam) * ox);
    fm.rotation.set(0, toCam, rotZ, 'YXZ');
    fm.material.color.copy(tint || WHITE);
    if (this.fireGlow) fm.material.color.lerp(FIRE_GLOW, this.fireGlow);
  }
}

// Spawn the peasant population from a `society` (see society.js): each group's
// members are placed clustered around its spawn centre, so families/clans/bands
// read as legible knots of people on the land. Each NPC is tagged with its group
// (npc.group), and the group's npc list is filled. Returns {npcs, groups, update}.
export async function spawnPeasants(scene, rng, groups = []){
  const loader = new THREE.TextureLoader();
  const npcs = [];
  function loadTex(file){
    return new Promise((res, rej) => loader.load(file, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      res(t);
    }, undefined, rej));
  }
  try {
    const meta = await (await fetch('sprites/npc/manifest.json')).json();
    const bases = await Promise.all(meta.sprites.map(async s => ({
      tex: await loadTex(s.file),
      slug: s.slug,                                   // race/gender for naming
      m: {cols:meta.cols, rows:meta.rows, standCol:meta.standCol,
          walkStart:meta.walkStart, walkLen:meta.walkLen,
          frameW:s.frameW, frameH:s.frameH, topPad:s.topPad||0}
    })));
    const bySlug = new Map(bases.map(b => [b.slug, b]));
    // Attach optional pose atlases (sitting/reclining idle bakes) by the
    // convention <slug>-<pose>. Dormant until such atlases exist in the manifest;
    // pose entries are loaded but never spawned on their own (only group members
    // spawn, and members reference base slugs).
    for (const b of bases){
      const pb = bySlug.get(b.slug + '-sitting');
      if (pb) b.poses = { sitting: { tex: pb.tex, m: pb.m } };
    }
    const landSet = new Set(['grass','mud','sand']);
    for (const g of groups){
      g.npcs = [];
      for (const m of g.members){
        let p = null;                                 // a walkable spot near the group centre
        for (let t = 0; t < 40; t++){
          const a = rng()*Math.PI*2, rr = Math.sqrt(rng()) * g.spread;
          const x = g.cx + Math.cos(a)*rr, z = g.cz + Math.sin(a)*rr;
          if (walkable(x, z) && Math.hypot(x, z) < WORLD_R){ p = [x, z]; break; }
        }
        if (!p) p = randomLand(rng, WORLD_R, landSet);
        const b = (m.heightScale && m.heightScale !== 1)
          ? {...(bySlug.get(m.slug) || bases[0]), heightScale: m.heightScale}
          : (bySlug.get(m.slug) || bases[0]);
        const npc = new AnimNPC(b, p[0], p[1]);
        npc.slug = m.slug; npc.group = g; npc.role = m.role;   // naming + group/kin awareness
        if (m.skin) npc.skinTone = m.skin;                     // baked body skin → matching wojak portrait
        m.npc = npc; g.npcs.push(npc);
        scene.add(npc.mesh); scene.add(npc.packMesh); npcs.push(npc);
      }
    }
  } catch (e){ console.warn('no peasants:', e); }

  return { npcs, groups, update: (cam, dt, tint) => { for (const n of npcs) n.update(cam, dt, tint); } };
}

// Spawn a single named, wandering NPC (e.g. the Claude character) with a name
// tag that follows him. Same wander logic as the peasants, for now.
// Returns the AnimNPC (has .x/.z and .update(cam, dt)), or null on failure.
export async function spawnNamedNPC(scene, { slug = 'male-peasant-elf', x = 0, z = 0, name = '', labelColor = '#fff', recolor = { primary: [70, 90, 150], secondary: [42, 55, 100], accent: [205, 180, 120] } } = {}){
  const loader = new THREE.TextureLoader();
  try {
    const meta = await (await fetch('sprites/npc/manifest.json')).json();
    const s = meta.sprites.find(e => e.slug === slug) || meta.sprites[0];
    const tex = await new Promise((res, rej) => loader.load(s.file, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      res(t);
    }, undefined, rej));
    const base = { tex, m: { cols:meta.cols, rows:meta.rows, standCol:meta.standCol,
      walkStart:meta.walkStart, walkLen:meta.walkLen, frameW:s.frameW, frameH:s.frameH, topPad:s.topPad||0 } };
    const label = name ? makeLabel(name, { color: labelColor }) : null;
    const npc = new AnimNPC(base, x, z, label);
    npc.slug = s.slug;
    if (recolor) npc.recolor(recolor);   // tint robe colours; pass recolor:null to keep the baked sprite as-is (e.g. Lea's skin)
    scene.add(npc.mesh); scene.add(npc.packMesh); if (label) scene.add(label);
    return npc;
  } catch (e){ console.warn('spawnNamedNPC failed:', e); return null; }
}
