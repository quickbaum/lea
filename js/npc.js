import * as THREE from 'three';
import { PERSON_H, WORLD_R } from './config.js';
import { height, walkable, randomLand } from './terrain.js';
import { makeLabel } from './label.js';
import { makePackTexture } from './textures.js';

// Cache pack textures by their contents so identical packs share one texture.
const PACK_CACHE = new Map();
function packTexture(food, wood, kind, trinkets){
  food = Math.min(food, 6); wood = Math.min(wood, 4); trinkets = Math.min(trinkets, 2);   // match the texture's draw caps
  const key = food + '|' + wood + '|' + kind + '|' + trinkets;
  let t = PACK_CACHE.get(key);
  if (!t){ t = makePackTexture(food, wood, kind, trinkets); PACK_CACHE.set(key, t); }
  return t;
}

// viewing sector (0 = we see the front .. 4 = the back) -> [atlas row, mirror?]
const DIR_MAP = [[0,false],[1,false],[2,false],[3,false],[4,false],
                 [3,true],[2,true],[1,true]];

const FIRE_GLOW = new THREE.Color(1.0, 0.72, 0.42);   // warm cast when near a fire

// height scale by folk — goblins are little, dwarves short & stout (1 = human/elf)
const RACE_SCALE = { dwarf: 0.72, goblin: 0.62 };
function raceScale(slug = ''){
  for (const r in RACE_SCALE) if (slug.includes(r)) return RACE_SCALE[r];
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

class AnimNPC {
  constructor(base, x, z, label = null){
    this.x = x; this.z = z; this.m = base.m; this.h = PERSON_H * raceScale(base.slug) * (base.heightScale || 1); this.label = label;
    this.tex = base.tex.clone(); this.tex.needsUpdate = true;
    this._baseTex = this.tex; this._baseM = base.m;        // base (walk) atlas, for restoring after a pose
    this._baseAspect = base.m.frameW/base.m.frameH;
    this.poses = base.poses || null;                       // optional sitting/reclining idle atlases
    this._poseTex = {}; this._curPose = null;              // lazily-cloned pose textures + current pose
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.h*(this.m.frameW/this.m.frameH), this.h),
      new THREE.MeshBasicMaterial({map:this.tex, alphaTest:0.5, transparent:true, fog:true})
    );
    this.mesh.position.set(x, height(x,z)+this.h/2, z);
    if (label) label.position.set(x, height(x,z)+this.h+0.6, z);
    this.heading = Math.random()*Math.PI*2;
    this.wander = 0; this.frame = 0; this.frameT = 0; this.moving = false; this.chopAnim = 0;
    this.idleCol = this.m.standCol;   // overridden by recolor() if the stand frame is pre-coloured
    // a backpack billboard shown on the back when carrying food/firewood
    this.packMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.h*0.42, this.h*0.4),
      new THREE.MeshBasicMaterial({ alphaTest:0.5, transparent:true, fog:true })
    );
    this.packMesh.visible = false; this._packKey = '';
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
    const wantPose = (this.poses && planted && this.sitting && this.poses.sitting)
      ? 'sitting' : null;
    this._usePose(wantPose);
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
    const gy = this.rideY != null ? this.rideY : height(this.x, this.z), halfH = this.h * clipFrac / 2;
    this.mesh.position.set(this.x, gy + halfH - chopDip + hopOff + swayBob, this.z);
    if (this.label) this.label.position.set(this.x, gy + this.h * clipFrac + 0.5 + hopOff, this.z);

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
    const kind = this.packKind || 'food';
    const key = food + '|' + wood + '|' + kind + '|' + trink;
    if (key !== this._packKey){
      this._packKey = key;
      this.packMesh.material.map = packTexture(food, wood, kind, trink);
      this.packMesh.material.needsUpdate = true;
    }
    const back = 0.18, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const gy = this.rideY != null ? this.rideY : height(this.x, this.z);   // ride the gunwale over water
    this.packMesh.position.set(
      this.x - fx*back, gy + this.h*0.6*sy + hopOff, this.z - fz*back);
    this.packMesh.rotation.set(0, toCam, 0, 'YXZ');
    this.packMesh.material.color.copy(tint || WHITE);
    this.packMesh.visible = true;
  }
}

const WHITE = new THREE.Color(1, 1, 1);

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
          frameW:s.frameW, frameH:s.frameH}
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
      walkStart:meta.walkStart, walkLen:meta.walkLen, frameW:s.frameW, frameH:s.frameH } };
    const label = name ? makeLabel(name, { color: labelColor }) : null;
    const npc = new AnimNPC(base, x, z, label);
    npc.slug = s.slug;
    if (recolor) npc.recolor(recolor);   // tint robe colours; pass recolor:null to keep the baked sprite as-is (e.g. Lea's skin)
    scene.add(npc.mesh); scene.add(npc.packMesh); if (label) scene.add(label);
    return npc;
  } catch (e){ console.warn('spawnNamedNPC failed:', e); return null; }
}
