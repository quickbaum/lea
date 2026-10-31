import * as THREE from 'three';
import { prepRig, poseOf, blend, solve, ANIMS } from './skeleton-pose.js';

// The skeleton: a layered drawing (sprites/Skeleton.psd) as a cut-paper puppet in the Lea. Each
// bone is its own card, hung on a rig (js/skeleton-pose.js does the poses and the kinematics),
// and drawn live: nothing is baked. Standing, the cards turn together to face you, like the
// troll. Loose, each card turns to face you on its own, lying on its side on the floor, so a
// bone is never seen edge-on. It can fall to pieces, into a heap or strewn about, and pull
// itself back together from wherever its bones lie.
//
//   const kit = await loadSkeletonKit();
//   const s = makeSkeleton(kit, { x, z, floorAt, lit: true, pile: true });       // or scatter: { r, ok }
//   scene.add(s.object);
//   s.assemble(); s.play('run'); s.talking = true; s.collapse({ scatter }); ...
//   each frame: s.update(dt, camera, tint)
//
// States: 'up' (the rig drives the bones), 'falling', 'pile', 'rising'. While up, play(name)
// crossfades to an animation (skeleton-pose.js ANIMS); one with a length (`once`) goes back to
// what it was doing when it ends. `speed` sets the walk's pace; `talking` works the jaw over
// any of them; `at`, when set, is the animation's clock instead of its own (dancers in step). Lying bones can `stir` (0..1): they twitch, as a warning. collapse({ now })
// skips the fall.
//
// `scatter`: { r, ok(x, z) } strews the bones over the floor within r of (x, z), wherever ok
// says (a level's walkable()); without it they fall in a heap.
//
// Above ground it's drawn unlit and tinted with the hour, like every sprite (pass `tint`);
// underground, `lit`, it takes the torch's light, so it's dark until you're close.

let KIT = null;
export function loadSkeletonKit(base = ''){
  return KIT || (KIT = Promise.all([
    fetch(base + 'sprites/skeleton/rig.json').then(r => r.json()),
    new THREE.TextureLoader().loadAsync(base + 'sprites/skeleton/atlas.png'),
  ]).then(([rig, tex]) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;   // crisp, as the troll and Puck
    const R = prepRig(rig), [AW, AH] = rig.atlasSize;
    // one card per bone, about its centre, in the drawing's pixels (scaled to the Lea's units when placed)
    const geos = R.pieces.map(p => {
      const g = new THREE.PlaneGeometry(p.w, p.h), [ax, ay, w, h] = p.atlas, uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++){
        const u = p.flip ? 1 - uv.getX(i) : uv.getX(i), v = uv.getY(i);
        uv.setXY(i, (ax + u * w) / AW, 1 - (ay + (1 - v) * h) / AH);
      }
      return g;
    });
    const opts = { map: tex, alphaTest: 0.5, side: THREE.DoubleSide };
    return { R, geos, unlit: new THREE.MeshBasicMaterial({ ...opts, fog: true }), lit: new THREE.MeshLambertMaterial(opts) };
  }));
}

// the order the bones come back in, feet first, the skull last and its jaw after it
const RISE = ['foot', 'shin', 'femur', 'pelvis', 'lumbar', 'thoracic', 'ribs_low', 'ribs', 'sternum', 'scapula', 'clavicle', 'humerus', 'forearm', 'hand', 'neck', 'skull', 'jaw'];
const riseRank = id => RISE.indexOf(id.replace(/_[RL]$/, ''));
const DEPTH = 0.004;             // standing, each bone's card a hair in front of the one drawn before it
const FADE = 0.25;               // the crossfade between animations (s)

const rand = s => () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const easeOutBounce = k => k < 1 / 2.75 ? 7.5625 * k * k : k < 2 / 2.75 ? 7.5625 * (k -= 1.5 / 2.75) * k + 0.75
  : k < 2.5 / 2.75 ? 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375 : 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375;
const smooth = k => k * k * (3 - 2 * k);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpA = (a, b, k) => a + wrap(b - a) * k;

export function makeSkeleton(kit, o = {}){
  const { R, geos } = kit, rnd = rand((o.seed ?? 1) * 7919 + 13);
  const floorAt = o.floorAt || (() => o.y ?? 0);
  const mat = o.lit ? kit.lit : kit.unlit;
  const object = new THREE.Group();
  // each bone: where it is now (`at`: its card's centre, its turn in its own plane, its squash,
  // and which way the card faces), and for a move, where from and where to
  const card = () => ({ p: new THREE.Vector3(), roll: 0, sx: R.unit, sy: R.unit, yaw: 0 });
  const bones = R.pieces.map((p, i) => {
    const m = new THREE.Mesh(geos[i], mat);
    m.matrixAutoUpdate = false; m.frustumCulled = false;   // the cards move far from where their geometry says
    object.add(m);
    return { p, m, at: card(), from: card(), to: card(), rig: card(), delay: 0, dur: 0, arc: 0 };
  });
  const S = {
    object, x: o.x ?? 0, z: o.z ?? 0, yaw: 0, state: 'up', anim: 'idle', speed: 1, talking: false, stir: 0, at: null,
    seed: o.seed ?? 1, faceCamera: o.faceCamera !== false,
  };
  let t = 0, animT = 0, prev = null, prevT = 0, fadeK = 1, back = null, clock = 0;
  const cam = new THREE.Vector3(S.x, 0, S.z + 5);
  const M = R.pieces.map(() => new Float64Array(6));
  const q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3();
  const copy = (a, b) => { a.p.copy(b.p); a.roll = b.roll; a.sx = b.sx; a.sy = b.sy; a.yaw = b.yaw; return a; };
  const towardCam = p => Math.atan2(cam.x - p.x, cam.z - p.z);

  // the pose now, into each bone's `rig` card
  function rigCards(){
    let P = poseOf(S.anim, S.at ?? animT, { speed: S.speed, seed: S.seed, talking: S.talking });
    if (fadeK < 1 && prev) P = blend(poseOf(prev, prevT, { speed: S.speed, seed: S.seed, talking: S.talking }), P, smooth(fadeK));
    solve(R, P, M);
    const c = Math.cos(S.yaw), s = Math.sin(S.yaw), y0 = floorAt(S.x, S.z);
    for (const b of bones){
      const [a, bb, cc, d, ex, fy] = M[b.p.i], dz = b.p.i * DEPTH, r = b.rig;
      r.p.set(S.x + c * ex + s * dz, y0 + fy, S.z - s * ex + c * dz);
      r.roll = Math.atan2(bb, a); r.sx = Math.hypot(a, bb); r.sy = Math.hypot(cc, d); r.yaw = S.yaw;
    }
  }
  const draw = b => {
    const a = b.at;
    e.set(0, a.yaw, a.roll); q.setFromEuler(e); sc.set(a.sx, a.sy, 1);
    b.m.matrix.compose(a.p, q, sc);
  };

  S.play = (name, { restart = false } = {}) => {
    if (!ANIMS[name] || (name === S.anim && !restart)) return S;
    const once = ANIMS[name].once;
    back = once ? (ANIMS[S.anim].once ? back : S.anim) : null;
    prev = S.anim; prevT = animT; fadeK = 0;
    S.anim = name; animT = 0;
    return S;
  };

  // where each bone comes to lie: on its side, its long way along the floor, resting on it.
  // In a heap about (x, z), the big ones under and the rest on top, the skull last; or strewn
  // within `scatter.r`, on ground scatter.ok allows
  function lay(scatter){
    const order = bones.slice().sort((a, b) => b.p.w * b.p.h - a.p.w * a.p.h);
    let pile = 0;
    for (const b of order){
      const id = b.p.id, head = id === 'skull' || id === 'jaw', to = b.to;
      let x = S.x, z = S.z;
      if (scatter){
        for (let n = 0; n < 16; n++){
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * scatter.r, px = S.x + Math.cos(a) * d, pz = S.z + Math.sin(a) * d;
          if (!scatter.ok || scatter.ok(px, pz)){ x = px; z = pz; break; }
        }
      } else {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (head ? 0.15 : 0.45);
        x += Math.cos(a) * d; z += Math.sin(a) * d;
      }
      const long = b.p.h > b.p.w * 1.3, wide = b.p.w > b.p.h * 1.3;
      to.roll = head ? (rnd() - 0.5) * 0.7                                            // a skull sits up
        : long ? (rnd() < 0.5 ? 1 : -1) * Math.PI / 2 + (rnd() - 0.5) * 0.5            // a long bone lies along the floor
        : wide ? (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 0.5 : rnd() * Math.PI * 2;
      to.sx = to.sy = R.unit;
      const half = (Math.abs(b.p.w * Math.sin(to.roll)) + Math.abs(b.p.h * Math.cos(to.roll))) / 2 * R.unit * 0.85;   // its drawn edge, not its box's
      to.p.set(x, floorAt(x, z) + half + (scatter ? 0 : pile), z);
      if (!scatter) pile += 0.012;                                                     // a heap builds up
      to.yaw = towardCam(to.p);
    }
  }

  S.collapse = ({ scatter = null, now = false } = {}) => {   // now: lying there already, no fall
    if (S.state === 'pile' || S.state === 'falling') return S;
    if (S.state === 'up'){ rigCards(); for (const b of bones) copy(b.at, b.rig); }
    lay(scatter);
    for (const b of bones){
      copy(b.from, b.at);
      const h = Math.max(0.05, b.from.p.y - b.to.p.y);
      b.dur = 0.35 + Math.sqrt(2 * h / 9.8) * 1.3 + rnd() * 0.15;
      b.delay = rnd() * 0.12 + (b.p.id === 'skull' || b.p.id === 'jaw' ? 0.1 : 0);
      b.to.roll = b.from.roll + wrap(b.to.roll - b.from.roll) + (rnd() < 0.4 ? Math.sign(rnd() - 0.5) * Math.PI * 2 : 0);   // some tumble right round
    }
    S.state = 'falling'; clock = 0;
    if (now){ for (const b of bones){ b.to.roll = wrap(b.to.roll); copy(b.at, b.to); } S.state = 'pile'; }
    return S;
  };
  S.assemble = () => {
    if (S.state === 'up' || S.state === 'rising') return S;
    for (const b of bones){
      copy(b.from, b.at);
      const d = Math.hypot(b.from.p.x - S.x, b.from.p.z - S.z);
      b.delay = riseRank(b.p.id) * 0.1 + rnd() * 0.06; b.dur = 0.45 + d * 0.12 + rnd() * 0.1;
      b.arc = 0.3 + d * 0.15;                                                           // from across a room, a higher flight
    }
    S.state = 'rising'; clock = 0; S.play('rattle', { restart: true });
    return S;
  };

  S.update = (dt, camera, tint) => {
    t += dt; animT += dt; prevT += dt; clock += dt;
    if (camera) cam.copy(camera.position);
    if (fadeK < 1) fadeK = Math.min(1, fadeK + dt / FADE);
    if (back && animT >= ANIMS[S.anim].once) S.play(back);
    if (tint && mat === kit.unlit) mat.color.copy(tint);
    if (S.faceCamera) S.yaw = Math.atan2(cam.x - S.x, cam.z - S.z);

    if (S.state === 'up'){ rigCards(); for (const b of bones) copy(b.at, b.rig); }
    else if (S.state === 'falling'){
      let done = true;
      for (const b of bones){
        const k = Math.min(1, Math.max(0, (clock - b.delay) / b.dur)), a = b.at, f = b.from, g = b.to;
        if (k < 1) done = false;
        const kx = 1 - (1 - k) * (1 - k);
        a.p.lerpVectors(f.p, g.p, kx); a.p.y = f.p.y + (g.p.y - f.p.y) * easeOutBounce(k);
        a.roll = f.roll + (g.roll - f.roll) * smooth(Math.min(1, k * 1.2));
        a.sx = f.sx + (g.sx - f.sx) * k; a.sy = f.sy + (g.sy - f.sy) * k;
        a.yaw = lerpA(f.yaw, towardCam(a.p), smooth(k));
      }
      if (done){ for (const b of bones) b.to.roll = wrap(b.to.roll); S.state = 'pile'; }
    }
    else if (S.state === 'pile'){
      for (const b of bones){
        const a = copy(b.at, b.to); a.yaw = towardCam(a.p);
        if (!S.stir) continue;
        const k = b.p.i * 1.7 + S.seed, j = Math.sin(t * 37 + k) > 0.6 - S.stir * 0.5 ? S.stir : 0;
        a.p.y += j * 0.03 * Math.abs(Math.sin(t * 23 + k)); a.roll += j * 0.15 * Math.sin(t * 29 + k);
      }
    }
    else if (S.state === 'rising'){
      let done = true;
      rigCards();
      for (const b of bones){
        const k = Math.min(1, Math.max(0, (clock - b.delay) / b.dur)), a = b.at, f = b.from, g = b.rig;
        if (k < 1) done = false;
        if (k >= 1){ copy(a, g); continue; }
        if (k <= 0){ copy(a, f); a.yaw = towardCam(a.p); continue; }
        const s = smooth(k);
        a.p.lerpVectors(f.p, g.p, s); a.p.y += Math.sin(k * Math.PI) * b.arc;   // up off the floor and across
        a.roll = lerpA(f.roll, g.roll, s);
        a.sx = f.sx + (g.sx - f.sx) * s; a.sy = f.sy + (g.sy - f.sy) * s;
        a.yaw = lerpA(towardCam(a.p), g.yaw, s);
      }
      if (done){ S.state = 'up'; S.play(o.then || 'idle'); }
    }
    for (const b of bones) draw(b);
  };

  // start lying (in a heap, or strewn), or standing
  if (o.pile || o.scatter){ lay(o.scatter); for (const b of bones) copy(b.at, b.to); S.state = 'pile'; S.update(0); }
  else S.update(0);
  S.dispose = () => { object.removeFromParent(); };
  return S;
}
