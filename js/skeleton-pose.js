// The skeleton puppet's poses: pure maths, no three, so node can check it (tools/check-skeleton.mjs)
// and a 2D canvas can draw it (tools/probes/skeleton.html?2d).
//
// The puppet is a front-view drawing (sprites/Skeleton.psd), cut into bones by
// tools/extract_skeleton_psd.py into sprites/skeleton/atlas.png + rig.json: a tree of joints
// (nodes) with the bones (pieces) hung on them. A pose gives each node
//   r       a turn about its joint, radians, anticlockwise as you look at it
//   sx, sy  a squash of its own bones along/across them; a bone that points at you
//           (an arm reaching out, a knee coming up) is drawn shorter. It moves the joints
//           below it too, but doesn't skew them
//   dx, dy  a slide of the joint, in the drawing's pixels (y up)
// and the whole a `lift` off the ground (u). solve() turns a pose into one 2D matrix per bone
// in the Lea's units, standing on y = 0: the feet are put back on the ground every frame, so
// an animation never has to work out how high the hips are.
//
// Sides: _R is the drawn side (the skeleton's right, on the picture's left), _L its mirror.
// limb() takes "out" angles, away from the body, so one number moves either side the same way.

export function prepRig(rig){
  const byId = new Map(rig.nodes.map(n => [n.id, { ...n, kids: [] }]));
  for (const n of byId.values()) if (n.parent) byId.get(n.parent).kids.push(n);
  const order = [];                              // parents before children
  (function walk(n){ order.push(n); n.kids.forEach(walk); })([...byId.values()].find(n => !n.parent));
  const y = py => rig.ground - py, x = px => px - rig.axis;   // the drawing's pixels -> y-up pixels about the spine's foot
  for (const n of order){
    const p = n.parent && byId.get(n.parent);
    n.at = [x(n.pivot[0]), y(n.pivot[1])];
    n.off = p ? [n.at[0] - p.at[0], n.at[1] - p.at[1]] : n.at.slice();
  }
  const pieces = rig.pieces.map((p, i) => {
    const n = byId.get(p.node), [l, t, w, h] = p.box;
    return { ...p, i, w, h, c: [x(l + w / 2) - n.at[0], y(t + h / 2) - n.at[1]] };   // its centre, from its joint
  });
  const feet = pieces.filter(p => p.node.startsWith('foot'));
  return { ...rig, byId, order, pieces, feet };
}

// --- poses ------------------------------------------------------------------------------------

const S = { _R: -1, _L: 1 };                       // "out" is clockwise on the right side, as drawn
const nd = (P, id) => P[id] || (P[id] = { r: 0, sx: 1, sy: 1, dx: 0, dy: 0 });
const pos = v => Math.max(0, v);
// a smooth wobble in -1..1, the same for the same t and seed
const wob = (t, k = 0) => (Math.sin(t * 1.3 + k * 7.1) + Math.sin(t * 2.17 + k * 3.3) * 0.6 + Math.sin(t * 3.71 + k * 1.9) * 0.3) / 1.9;

// one side's limb, in "out" angles (radians away from the body) and squashes
function limb(P, side, q){
  const s = S[side];
  for (const [k, v] of Object.entries(q)){
    const [joint, what] = k.split('.');            // 'arm' (out) or 'arm.sy'
    const n = nd(P, joint + side);
    if (!what) n.r += s * v; else n[what] = what === 'dx' ? n.dx + s * v : what === 'dy' ? n.dy + v : n[what] * v;
  }
}
const both = (P, q) => { limb(P, '_R', q); limb(P, '_L', q); };

// the jaw: open 0..1 (it drops; the skull hides its top)
const jaw = (P, open) => { nd(P, 'jaw').dy -= open * 11; nd(P, 'jaw').sy *= 1 + open * 0.08; };
// talk-like jaw: syllables about five a second, with pauses between phrases
export const chatter = (t, k = 0) => {
  const phrase = Math.sin(t * 0.9 + k) > -0.55 ? 1 : 0.15;
  return phrase * pos(Math.sin(t * 15.7 + k) * 0.6 + Math.sin(t * 9.3 + k * 2) * 0.5) * 0.9;
};

function breathe(P, t, k){
  nd(P, 'chest').sy *= 1 + 0.012 * Math.sin(t * 1.7 + k);
  nd(P, 'pelvis').r += 0.015 * wob(t * 0.5, k);
  nd(P, 'chest').r -= 0.02 * wob(t * 0.5, k + 1);
  nd(P, 'head').r += 0.05 * wob(t * 0.4, k + 2);
  both(P, { arm: 0.05 + 0.02 * wob(t * 0.6, k + 3), fore: 0.06 });
}
// now and then a look aside: the skull narrows and slides, as a turned head does
function look(P, t, k, every = 0.23){
  const L = Math.sin(t * every + k * 3), a = Math.sign(L) * Math.min(1, pos(Math.abs(L) - 0.6) * 4);
  const h = nd(P, 'head'); h.sx *= 1 - 0.1 * Math.abs(a); h.dx += a * 7;
  const j = nd(P, 'jaw'); j.dx += a * 2;
}

// a step: phase 0..2π a stride (two steps); amp scales it
function legs(P, ph, amp = 1){
  for (const [side, off] of [['_R', 0], ['_L', Math.PI]]){
    const swing = Math.sin(ph + off), up = pos(swing);
    limb(P, side, { thigh: 0.04 * up * amp, 'thigh.sy': 1 - 0.17 * up * amp, shin: 0.07 * up * amp, 'shin.sy': 1 - 0.12 * up * amp,
      foot: 0.1 * up * amp, 'foot.sy': 1 - 0.2 * up * amp });
  }
  const w = Math.sin(ph);                          // the weight going over the standing foot
  nd(P, 'pelvis').r += 0.06 * w * amp; nd(P, 'pelvis').dx += 5 * w * amp;
  nd(P, 'chest').r -= 0.07 * w * amp; nd(P, 'head').r += 0.04 * w * amp;
  nd(P, 'chest').dy += 3 * Math.abs(Math.cos(ph)) * amp;
}
function swingArms(P, ph, amp = 1){
  for (const [side, off] of [['_R', Math.PI], ['_L', 0]]){
    const fwd = Math.sin(ph + off), f = pos(fwd);
    limb(P, side, { arm: 0.07 + 0.05 * Math.abs(fwd) * amp, 'arm.sy': 1 - 0.14 * f * amp, fore: -0.3 * f * amp, 'fore.sy': 1 - 0.18 * f * amp });
  }
}

// name -> (P, t, o) filling P; o: { speed, seed }. `once` ones end on their own (their length, s)
export const ANIMS = {
  idle(P, t, o){ breathe(P, t, o.seed); look(P, t, o.seed); jaw(P, 0.08 * pos(wob(t * 0.7, o.seed))); },
  walk(P, t, o){
    const ph = t * Math.PI * 2 * 0.85 * (o.speed || 1);
    breathe(P, t, o.seed); legs(P, ph); swingArms(P, ph);
  },
  // the chase: quicker, lurching, arms up and out with the fingers hooked, the jaw going
  run(P, t, o){
    const ph = t * Math.PI * 2 * 1.4 * (o.speed || 1), a = Math.sin(ph);
    legs(P, ph, 1.5);
    limb(P, '_R', { arm: 1.25 + 0.25 * a, fore: 0.9 - 0.3 * a, hand: 0.4 + 0.3 * Math.sin(t * 9) });
    limb(P, '_L', { arm: 1.25 - 0.25 * a, fore: 0.9 + 0.3 * a, hand: 0.4 + 0.3 * Math.sin(t * 9 + 2) });
    nd(P, 'head').sy *= 0.95; nd(P, 'head').r += 0.12 * Math.sin(ph * 0.5);
    jaw(P, 0.5 + 0.5 * Math.sin(t * 22));
  },
  talk(P, t, o){
    breathe(P, t, o.seed); look(P, t, o.seed, 0.5);
    jaw(P, chatter(t, o.seed));
    nd(P, 'head').r += 0.06 * Math.sin(t * 2.3); nd(P, 'head').dy += 2 * pos(Math.sin(t * 4.6));
    const g = wob(t * 0.8, o.seed + 5);            // the right hand makes its points
    limb(P, '_R', { arm: 0.3 + 0.15 * g, 'arm.sy': 0.85, fore: -1.1 - 0.35 * g, 'fore.sy': 0.8, hand: 0.3 * Math.sin(t * 3) });
  },
  laugh(P, t, o){
    const shake = Math.abs(Math.sin(t * 11));
    breathe(P, t, o.seed);
    jaw(P, 0.6 + 0.4 * Math.sin(t * 22));
    const h = nd(P, 'head'); h.dy += 5 + 3 * shake; h.sy *= 0.92; h.r += 0.12 * Math.sin(t * 2.5);   // thrown back
    nd(P, 'chest').dy += 3 * shake; nd(P, 'chest').r += 0.05 * Math.sin(t * 2.5);
    both(P, { shoulder: -0.04 * shake, arm: -0.12, 'arm.sy': 0.92, fore: -1.6, 'fore.sy': 0.85 });   // hands to the belly
  },
  wave(P, t, o){
    breathe(P, t, o.seed); jaw(P, 0.3 + 0.2 * Math.sin(t * 3));
    limb(P, '_R', { shoulder: 0.08, arm: 2.5, fore: -0.25 + 0.5 * Math.sin(t * 7), hand: 0.25 * Math.sin(t * 7 - 1) });
  },
  // the danse macabre: a hopping jig, heels kicked out to the side, arms flung up
  dance(P, t, o){
    const ph = t * Math.PI * 2 * 1.1 * (o.speed || 1), s = Math.sin(ph), hop = Math.abs(Math.sin(ph));
    limb(P, '_R', { thigh: 0.45 * pos(s), shin: 0.9 * pos(s), foot: 0.5 * pos(s), 'thigh.sy': 1 - 0.1 * pos(s) });
    limb(P, '_L', { thigh: 0.45 * pos(-s), shin: 0.9 * pos(-s), foot: 0.5 * pos(-s), 'thigh.sy': 1 - 0.1 * pos(-s) });
    limb(P, '_R', { arm: 2.1 + 0.5 * s, fore: 0.6 + 0.6 * s, hand: 0.5 * Math.sin(ph * 2) });
    limb(P, '_L', { arm: 2.1 - 0.5 * s, fore: 0.6 - 0.6 * s, hand: 0.5 * Math.sin(ph * 2 + 1) });
    nd(P, 'pelvis').r += 0.14 * s; nd(P, 'chest').r -= 0.2 * s; nd(P, 'head').r += 0.25 * s;
    jaw(P, 0.5 * hop);
    P.lift = 0.07 * hop;
  },
  // arms out at you, fingers opening and closing: the grab
  reach(P, t, o){
    breathe(P, t, o.seed);
    const c = 0.5 + 0.5 * Math.sin(t * 6);
    const lunge = 0.5 + 0.5 * Math.sin(t * 2.2);       // and a lurch at you, now and again
    // the upper arms come at you, so they're drawn short; the forearms up, claws by the head,
    // closing in as it lunges
    both(P, { shoulder: 0.1, arm: 1.0 - 0.15 * lunge, 'arm.sy': 0.55 - 0.1 * lunge, fore: 1.5 - 0.5 * lunge, 'fore.sy': 0.85,
      hand: -0.5 + 0.8 * c, 'hand.sy': 0.75 + 0.25 * c });
    nd(P, 'head').sy *= 0.94 - 0.03 * lunge; nd(P, 'chest').sy *= 1 - 0.04 * lunge;
    jaw(P, 0.4 + 0.3 * Math.sin(t * 4));
  },
  // something held overhead (you, on the way back to the stair), walking
  carry(P, t, o){
    const ph = t * Math.PI * 2 * 0.9 * (o.speed || 1);
    legs(P, ph, 1.1);
    both(P, { shoulder: -0.1, arm: 2.85, fore: 0.25, hand: 1.1 });
    nd(P, 'head').sy *= 0.93; nd(P, 'head').r += 0.05 * Math.sin(ph);
    jaw(P, chatter(t, o.seed) * 0.6);
  },
  // the shudder of coming together, or of a pile about to: every joint chattering
  rattle(P, t, o){
    breathe(P, t, o.seed);
    for (const id of ['pelvis', 'loins', 'chest', 'neck', 'head', 'shoulder_R', 'shoulder_L', 'arm_R', 'arm_L', 'fore_R', 'fore_L', 'hand_R', 'hand_L', 'thigh_R', 'thigh_L', 'shin_R', 'shin_L']){
      const k = id.length * 1.7 + id.charCodeAt(0);
      const n = nd(P, id); n.r += 0.07 * wob(t * 31, k); n.dx += 2 * wob(t * 37, k + 1); n.dy += 1.5 * wob(t * 29, k + 2);
    }
    jaw(P, pos(Math.sin(t * 40)) * 0.7);
  },
  // struck (a spell, later): thrown back, arms flung up, then back to its feet
  stagger: Object.assign((P, t, o) => {
    const k = Math.exp(-t * 3.2), j = Math.sin(t * 18) * k;
    breathe(P, t, o.seed);
    nd(P, 'pelvis').dx += 14 * k; nd(P, 'pelvis').r -= 0.18 * k;
    nd(P, 'chest').sy *= 1 - 0.1 * k; nd(P, 'chest').r += 0.25 * k;
    nd(P, 'head').r -= 0.5 * j; nd(P, 'head').dy += 4 * k;
    both(P, { arm: 1.7 * k, fore: 0.8 * j, hand: 0.6 * j });
    jaw(P, k);
  }, { once: 1.4 }),
  // a slow look round, left and right
  look(P, t, o){
    breathe(P, t, o.seed);
    const a = Math.sin(t * 1.1);
    const h = nd(P, 'head'); h.sx *= 1 - 0.13 * Math.abs(a); h.dx += a * 10; h.r += 0.04 * a;
    nd(P, 'jaw').dx += a * 3; nd(P, 'chest').r -= 0.03 * a;
  },
};
export const ANIM_NAMES = Object.keys(ANIMS);

// the pose of an animation at t (s); `talking` lays the jaw's chatter over whatever it's doing
export function poseOf(name, t, o = {}){
  const P = { lift: 0 };
  (ANIMS[name] || ANIMS.idle)(P, t, { seed: 0, ...o });
  if (o.talking) { const j = nd(P, 'jaw'), base = j.dy; j.dy = Math.min(base, -chatter(t, (o.seed || 0) + 9) * 11); }
  return P;
}

// a crossfade: k = 0 is a, 1 is b
export function blend(a, b, k){
  if (k >= 1) return b; if (k <= 0) return a;
  const P = { lift: a.lift + (b.lift - a.lift) * k };
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])){
    if (id === 'lift') continue;
    const x = a[id] || { r: 0, sx: 1, sy: 1, dx: 0, dy: 0 }, y = b[id] || { r: 0, sx: 1, sy: 1, dx: 0, dy: 0 };
    P[id] = { r: x.r + (y.r - x.r) * k, sx: x.sx + (y.sx - x.sx) * k, sy: x.sy + (y.sy - x.sy) * k, dx: x.dx + (y.dx - x.dx) * k, dy: x.dy + (y.dy - x.dy) * k };
  }
  return P;
}

// --- kinematics -------------------------------------------------------------------------------

const ZERO = { r: 0, sx: 1, sy: 1, dx: 0, dy: 0 };
// pose -> for each piece a 2D matrix [a, b, c, d, e, f] taking its own coordinates (u right,
// v up, about its centre, in the drawing's pixels) to the puppet's, in the Lea's units: x to
// its left as you look at it, y up from the ground, its feet on y = 0 (+ lift)
export function solve(R, P, out = R.pieces.map(() => new Float64Array(6))){
  const W = new Map();                          // node -> [cos, sin, tx, ty, sx, sy]: where its joint is and how it's turned
  for (const n of R.order){
    const q = P[n.id] || ZERO, p = n.parent && W.get(n.parent);
    let c, s, tx, ty;
    if (!p){ c = Math.cos(q.r); s = Math.sin(q.r); tx = n.off[0] + q.dx; ty = n.off[1] + q.dy; }
    else {
      const [pc, ps, px, py, psx, psy] = p, ox = n.off[0] * psx + q.dx, oy = n.off[1] * psy + q.dy;
      tx = px + pc * ox - ps * oy; ty = py + ps * ox + pc * oy;
      const a = Math.atan2(ps, pc) + q.r; c = Math.cos(a); s = Math.sin(a);
    }
    W.set(n.id, [c, s, tx, ty, q.sx, q.sy]);
  }
  for (const pc of R.pieces){
    const [c, s, tx, ty, sx, sy] = W.get(pc.node), m = out[pc.i];
    m[0] = c * sx; m[1] = s * sx; m[2] = -s * sy; m[3] = c * sy;   // columns: where u and v go
    m[4] = tx + c * pc.c[0] * sx - s * pc.c[1] * sy;
    m[5] = ty + s * pc.c[0] * sx + c * pc.c[1] * sy;
  }
  // stand it on the ground: the lowest corner of a foot at 0
  let low = Infinity;
  for (const f of R.feet){
    const m = out[f.i];
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) low = Math.min(low, m[5] + m[1] * u * f.w / 2 + m[3] * v * f.h / 2);
  }
  const k = R.unit, lift = (P.lift || 0) / k - low;
  for (const m of out){ for (let i = 0; i < 6; i++) m[i] *= k; m[5] += lift * k; }
  return out;
}
