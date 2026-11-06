// Sheep, simulated (docs/sheep.md). A flock has no leader and no plan: each sheep grazes, keeps its distance from
// anything in its flight zone, and copies its neighbours. That gives the real pattern: long slow spreading out,
// sudden packing together (Ginelli 2015), each sheep pushing inward when threatened (King 2012), and herding
// by walking, with no herding tool. No three.js and no terrain here: the land is handed in, so node can run it.
// Units are the world's (about 1.5 to the metre). js/sheep-view.js draws these records.

import { Dodge } from './dodge.js';
import { Patch } from './patch.js';
import { SWARD } from './sward.js';
import { planCommon } from './gen/common.js';

const DAY_SECONDS = 600;      // a game day, unless the URL's changed it (main.js)
// seconds for rain to wet, and for it to dry; dirt per game day
export const WOOL = {
  WETS: 120, DRIES: 200,             // the fleece, in full rain
  GROUND_WETS: 60, GROUND_DRIES: 300,
  MUD: 1.2, FOLD_MUD: 0.9,           // a day on wet mud; how muddy the fold is, packed and trodden
  DRY_DIRT: 0.03,                    // a dry day: next to nothing
  RINSE: 0.8, RINSE_RAIN: 0.25, RINSE_FLOOR: 0.3,   // a day of full rain, the least rain that rinses, and as clean as rain gets it
};
export const SHEEP = {
  WALK: 1.3,          // going somewhere, calmly
  RUN: 6.0,           // flat out: the player walks at 8, so you can get round them, just
  GRAZE_STEP: 0.5,    // the amble between bites
  ZONE_PLAYER: 7,     // flight zone: how near the player comes before they move off
  ZONE_FOLK: 2.5,     // the folk they know, and let much closer
  KEEP: 1.25,         // room each sheep keeps from the next: nearer than this it shuffles off at once
  ROOM: 2.8,          // room it likes while grazing: it picks its next bite away from anyone nearer than this
  BODY: 0.75,         // how wide a berth it gives a trunk: about half a fleeced sheep's length
  SEE: 9,             // how far a neighbour's running catches
  HEFT_R: 38,         // the home ground: left alone, they drift back inside this
  ROAM_R: 15,         // how far from the flock's grazing centre before a sheep walks back
  ANCHOR_SPEED: 0.25, // how fast that centre wanders as they eat their way along
  WAKE_R: 190,        // beyond this nobody can see them: they stop being simulated
};

// how much of one sheep's full-time mouthful a flock out of sight takes per sheep. Measured against a watched flock on flat
// land (2026-11-04): at 1.7 the unwatched left 2.3x the short grass, on a head down 27% of grazing hours
const UNWATCHED_BITE = 0.7;
const LOST_WAIT = 120;
const CALL_R = 60;     // how far a shepherd's tune carries, as far as a sheep's concerned
const LOST_R = 26;     // kept sheep this far from their ground with nobody in sight stop trying, and wait to be found
const GROUND_R = 16;   // the ground a shepherd's put them on, from which they drift
const GRAZE_TURN = 1.1, SHUFFLE = 0.3;   // rad/s, and u/s
const WALL = 0.5, _uv = [0, 0], _wp = [0, 0];
// does the line from a to b pass through the box |u| < hu, |v| < hv?
const crosses = (au, av, bu, bv, hu, hv) => {
  let lo = 0, hi = 1;
  const du = bu - au, dv = bv - av;
  if (du){ const p = (-hu - au) / du, q = (hu - au) / du; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
  else if (Math.abs(au) >= hu) return false;
  if (dv){ const p = (-hv - av) / dv, q = (hv - av) / dv; lo = Math.max(lo, Math.min(p, q)); hi = Math.min(hi, Math.max(p, q)); }
  else if (Math.abs(av) >= hv) return false;
  return lo < hi;
};
const TURNS = [0, 0.8, 1.6, 2.4, -0.8, -1.6];   // tried in order, times the sheep's own side
const _lean = [0, 0];
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const angleTo = (from, to) => { let d = to - from; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

class Sheep {
  constructor(x, z, r){
    this.x = x; this.z = z;
    this.heading = r() * Math.PI * 2;
    this.mode = 'graze';            // graze | walk | run | rest
    this.speed = 0;
    this.phase = r() * 6.28;        // the stride, for the view
    this.walk = 0; this.graze = 1; this.lie = 0;   // how far into each pose, 0..1, eased
    this.tx = x; this.tz = z; this.stepT = r() * 8;
    this.fright = 0;                // how much pressure it's under this moment, 0..1
    this.runT = 0; this.calm = r() * 60;
    this.side = r() < 0.5 ? 1 : -1; // which way it goes round what's in the way, and holds to it
    this.lazy = r();                // who settles first and gets up last
    // the wool: the three numbers the view reads
    this.len = 1; this.dirt = 0.35 + r() * 0.55; this.wet = 0;
    this.scale = 0.88 + r() * 0.18; this.seed = r();
    this.woolDays = 3 + (this.seed * 7.3 % 1) * 2;    // how long it takes to grow back: a decision in docs/sheep.md, not a real sheep's year. (From its seed: another roll would move every sheep after it)
  }
}

// What the flock wants of the hour. dayFrac: 0.5 is noon, as in sky.js
// with a fold, they're brought in from late afternoon and let out at dawn
export const penTime = f => f > 0.72 || f < 0.25;
export function flockHour(f){
  if (f < 0.23 || f > 0.83) return 'night';
  if (f > 0.44 && f < 0.57) return 'midday';     // lying up, chewing the cud
  return 'graze';
}

export class Flock {
  // land: { walkable(x,z), open(x,z), within(x,z,r), zones(x,z,r) }. walkable is water and walls, with a sheep's width of
  // padding; open is good grazing ground; within is trunks and shrubs; zones is what's on the ground and can change:
  // crofts { x, z, a, hl, hw } and huts, fires { x, z, r }. sward: js/sward.js, if the grass is to be eaten.
  // rng: seeded, for where they are and who they are. fold: gen/common.js, if they've one to come home to.
  constructor({ home, n = 20, land, rng, owner = null, name = '', tune = {}, fold = null }){
    this.home = { x: home.x, z: home.z }; this.land = land; this.owner = owner; this.name = name;
    this.tune = { flee: 1, ...tune };
    this.dodge = land.within ? new Dodge(land.within, SHEEP.BODY, { roots: !tune.overRoots }) : null;
    this.zones = []; this._zoneT = 0;
    this.sward = land.sward && !tune.noEat ? land.sward : null;
    this.patch = new Patch({ bar: 0.85, settle: 30 }); this._lookT = 0; this._discT = 0;
    this.fold = fold;
    this.call = null; this.calling = false;   // the tune they know as theirs, and whether it's being played to them (js/shepherd.js)
    if (fold){
      const c = Math.cos(fold.a), s = Math.sin(fold.a);
      this._fc = c; this._fs = s;
      // just outside the gap and just inside it, the +v side
      this._mouthOut = { x: fold.x - s * (fold.hw + 2.2), z: fold.z + c * (fold.hw + 2.2) };
      this._mouthIn = { x: fold.x - s * (fold.hw - 2.2), z: fold.z + c * (fold.hw - 2.2) };
    }
    this.anchor = { x: home.x, z: home.z };   // where they're grazing around just now
    this.target = { x: home.x, z: home.z };
    this.targetT = 0;
    this.night = fold ? { x: fold.x, z: fold.z } : this._findNightSpot(rng);
    this.awake = false; this.herded = 0; this.runs = 0;
    this.sheep = [];
    for (let i = 0; i < n; i++){
      let x = home.x, z = home.z;
      for (let k = 0; k < 20; k++){
        const a = rng() * 6.283, r = Math.sqrt(rng()) * 7;
        if (land.walkable(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r)){ x = home.x + Math.cos(a) * r; z = home.z + Math.sin(a) * r; break; }
      }
      this.sheep.push(new Sheep(x, z, rng));
    }
    this.cx = home.x; this.cz = home.z; this.spread = 0;
    this._measure();
  }

  // they go up for the night: the highest open ground on the heft, if the land says
  _findNightSpot(rng){
    let best = { x: this.home.x, z: this.home.z }, bh = -Infinity;
    for (let i = 0; i < 16; i++){
      const a = rng() * 6.283, r = 8 + rng() * (SHEEP.HEFT_R - 10);
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (!this.land.open(x, z)) continue;
      const h = this.land.height ? this.land.height(x, z) : 0;
      if (h > bh){ bh = h; best = { x, z }; }
    }
    return best;
  }
  _measure(){
    let cx = 0, cz = 0; const n = this.sheep.length;
    for (const s of this.sheep){ cx += s.x; cz += s.z; }
    this.cx = cx / n; this.cz = cz / n;
    let d = 0; for (const s of this.sheep) d += Math.hypot(s.x - this.cx, s.z - this.cz);
    this.spread = d / n;
  }

  // the flock's grazing centre: it wanders over the heft, goes up at night, and stays where they've been driven until
  // they've drifted home in their own time
  _moveAnchor(dt, hour, penned){
    const A = this.anchor;
    if (hour === 'night' || penned) this.target = this.night;
    else if (this.sward){
      // they eat their way along, and when here has stopped paying against what's about, they move on (js/patch.js)
      if ((this._lookT -= dt) <= 0 || this.target === this.night){
        this._lookT = 12;
        const best = this._bestGround();
        if (best && (this.target === this.night || this.patch.leave(best.v) || (this.targetT -= 12) <= 0)){
          this.target = best; this.targetT = 240; this.patch.arrive(); this.moves = (this.moves || 0) + 1;
        }
      }
    } else if ((this.targetT -= dt) <= 0 || this.target === this.night){
      this.targetT = 60 + Math.random() * 90;
      for (let i = 0; i < 8; i++){
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * SHEEP.HEFT_R;
        const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
        if (this._grazeable(x, z)){ this.target = { x, z }; break; }
      }
    }
    const dx = this.target.x - A.x, dz = this.target.z - A.z, d = Math.hypot(dx, dz);
    if (d <= 6) this._led = false;
    if (d > 0.5){ const k = SHEEP.ANCHOR_SPEED * (hour === 'night' || penned ? 2.5 : this._led && this.calling ? 4 : 1) * dt / d; A.x += dx * k; A.z += dz * k; }
    // by day the ground they're making for lies outside the hurdles, so it goes round them
    if (this.fold && !penned){
      const f = this.fold, [u, v] = this._foldUV(A.x, A.z), H = f.hl + 3, W = f.hw + 3;
      if (Math.abs(u) < H && Math.abs(v) < W){
        const ou = H - Math.abs(u), ov = W - Math.abs(v), du = ou < ov ? Math.sign(u || 1) * ou : 0, dv = ou < ov ? 0 : Math.sign(v || 1) * ov;
        A.x += this._fc * du - this._fs * dv; A.z += this._fs * du + this._fc * dv;
      }
    }
  }
  // and a way there that doesn't go through standing forest: they walk the straight line, and it can't be walked
  _reachable(x, z){
    const T = this.land.thick;
    if (!T) return true;
    const A = this.anchor;
    for (let t = 0.2; t < 1; t += 0.2) if (T(A.x + (x - A.x) * t, A.z + (z - A.z) * t)) return false;
    return true;
  }
  _grazeable(x, z){
    if (!this.land.open(x, z) || !this._reachable(x, z)) return false;
    return !this.fold || Math.hypot(x - this.fold.x, z - this.fold.z) > this.fold.hl + 6;
  }
  // the best-looking ground on the home range, a little against the walk there
  _bestGround(){
    let best = null, bv = -Infinity;
    // on the ground the shepherd's brought them to, if they have one; else anywhere on their range
    const C = this.ground || this.home, R = this.ground ? GROUND_R : SHEEP.HEFT_R;
    for (let i = 0; i < 10; i++){
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * R;
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      if (!this._grazeable(x, z)) continue;
      const pay = this.sward.patchValue(x, z, 7), v = pay - Math.hypot(x - this.anchor.x, z - this.anchor.z) * 0.002;
      if (v > bv){ bv = v; best = { x, z, v: pay }; }
    }
    return best;
  }

  // --- what a shepherd does to them (js/shepherd.js). Nobody keeping them, and it all goes by the hour instead
  keeper(n, hut, phase){ this.fold.keeper = n; this.fold.held = penTime(phase); this.hutPlace = hut; }
  letOut(){ this.fold.held = false; this.fold.open = true; }
  callIn(){ this.fold.held = true; }
  shut(){ this.fold.open = false; }
  allIn(){ return !this.awake || this.inside === this.sheep.length; }
  strayed(){ return this.sheep.filter(s => (s.lost || s.short) && !s.led); }
  // the best of the range, as someone who knows it would pick: fresh grass over a wide patch, any of it
  chooseGround(){
    if (!this.sward) return null;
    let best = null, bv = -Infinity;
    for (let i = 0; i < 16; i++){
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * SHEEP.HEFT_R;
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (!this._grazeable(x, z)) continue;
      const v = this.sward.patchValue(x, z, GROUND_R) + Math.random() * 0.05;
      if (v > bv){ bv = v; best = { x, z }; }
    }
    return best;
  }
  leadTo(g){ this.ground = g; this.target = { ...g, v: 1 }; this.targetT = 240; this._lookT = 12; this._led = true; this.patch.arrive(); this.moves = (this.moves || 0) + 1; }
  _isPenned(f){
    const o = this.fold;
    if (!o) return false;
    if (!o.keeper) return penTime(f);
    // kept: it's their word. If they haven't come, the sheep don't wait for ever
    if (o.held && f > 0.42 && f < 0.72) this.letOut();
    else if (!o.held && f > 0.8) o.held = true;
    return o.held;
  }

  // the fold, in its own terms: along its length (u) and across (v), with the gap in the +v side
  _foldUV(x, z){
    const f = this.fold, dx = x - f.x, dz = z - f.z;
    _uv[0] = dx * this._fc + dz * this._fs; _uv[1] = dz * this._fc - dx * this._fs;
    return _uv;
  }
  _inFold(x, z){
    if (!this.fold) return false;
    const [u, v] = this._foldUV(x, z);
    return Math.abs(u) < this.fold.hl && Math.abs(v) < this.fold.hw;
  }
  // in the hurdles themselves? Inside and out are both free: it's the line between. The gap passes when the gate's open
  _inWall(x, z){
    const f = this.fold;
    if (!f || this.tune.noWall) return false;
    const [u, v] = this._foldUV(x, z), au = Math.abs(u), av = Math.abs(v);
    const onSide = Math.abs(au - f.hl) < WALL && av < f.hw + WALL, onEnd = Math.abs(av - f.hw) < WALL && au < f.hl + WALL;
    if (!onSide && !onEnd) return false;
    return !(f.open && v > 0 && au < f.gap - 0.2 && !onSide);
  }
  _inMouth(x, z){
    const f = this.fold, [u, v] = this._foldUV(x, z);
    return v > f.hw - 3 && v < f.hw + 4 && Math.abs(u) < f.gap + 2.5;
  }
  // where to walk for G, by way of the gap if the hurdles are between
  _way(s, G, out){
    if (!this.fold){ out[0] = G.x; out[1] = G.z; return; }
    const here = this._inFold(s.x, s.z), there = this._inFold(G.x, G.z);
    const to = here === there ? G : here ? this._mouthIn : this._mouthOut;
    const [u, v] = this._foldUV(s.x, s.z), f = this.fold;
    // at the gap: through, whichever side of the line it's on
    const atGap = v > 0 && Math.abs(u) < f.gap + 0.5 && Math.abs(v - f.hw) < 2.4;
    if (here !== there && atGap){
      // off to one side of the gap: onto its centre line first, or it only meets the post
      if (Math.abs(u) > f.gap - 0.6 && Math.abs(v - f.hw) > WALL){
        const line = f.hw + (here ? -1 : 1) * (WALL + 0.5);
        out[0] = f.x - this._fs * line; out[1] = f.z + this._fc * line;
        return;
      }
      const far = there ? this._mouthIn : this._mouthOut; out[0] = far.x; out[1] = far.z; return;
    }
    out[0] = to.x; out[1] = to.z;
    if (!here) this._round(u, v, to, out);
  }
  // outside, with the fold between it and where it's going: by whichever corner is shorter
  _round(u, v, to, out){
    const f = this.fold, [tu, tv] = this._foldUV(to.x, to.z), M = 1, C = 1.6;
    if (!crosses(u, v, tu, tv, f.hl + M, f.hw + M)) return;
    let bd = Infinity, bu = 0, bv = 0;
    for (const su of [-1, 1]) for (const sv of [-1, 1]){
      const cu = su * (f.hl + C), cv = sv * (f.hw + C);
      if (crosses(u, v, cu, cv, f.hl + M, f.hw + M)) continue;
      // the whole way from that corner: on to the goal, or by the next corner round if the fold's still in the way
      let on = Math.hypot(tu - cu, tv - cv);
      if (crosses(cu, cv, tu, tv, f.hl + M, f.hw + M))
        on = Math.min(2 * (f.hl + C) + Math.hypot(tu + cu, tv - cv), 2 * (f.hw + C) + Math.hypot(tu - cu, tv + cv));
      const d = Math.hypot(cu - u, cv - v) + on;
      if (d < bd){ bd = d; bu = cu; bv = cv; }
    }
    if (bd === Infinity) return;
    out[0] = f.x + this._fc * bu - this._fs * bv; out[1] = f.z + this._fs * bu + this._fc * bv;
  }
  // caught in the line of the hurdles, by a closing gate or a shove: straight back out on the side it's on
  _wallOut(x, z, out){
    if (!this._inWall(x, z)) return false;
    const f = this.fold, [u, v] = this._foldUV(x, z), au = Math.abs(u), av = Math.abs(v);
    const dv = Math.abs(av - f.hw), du = Math.abs(au - f.hl);
    if (dv <= du){ const k = (av < f.hw ? -1 : 1) * Math.sign(v || 1); out[0] = -this._fs * k; out[1] = this._fc * k; }
    else { const k = (au < f.hl ? -1 : 1) * Math.sign(u || 1); out[0] = this._fc * k; out[1] = this._fs * k; }
    return true;
  }

  // is (x, z) inside a croft, a hut, a fire?
  _inZone(x, z){
    for (const q of this.zones){
      const dx = x - q.x, dz = z - q.z;
      if (q.r !== undefined){ const r = q.r + SHEEP.BODY; if (dx * dx + dz * dz < r * r) return true; continue; }
      const c = Math.cos(q.a), s = Math.sin(q.a), u = dx * c + dz * s, v = dz * c - dx * s;
      if (Math.abs(u) < q.hl + SHEEP.BODY && Math.abs(v) < q.hw + SHEEP.BODY) return true;
    }
    return false;
  }
  // the way out, for a sheep something's been raised on: the nearest edge
  _zoneOut(x, z, out){
    for (const q of this.zones){
      const dx = x - q.x, dz = z - q.z;
      if (q.r !== undefined){
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < q.r + SHEEP.BODY){ out[0] = dx / d; out[1] = dz / d; return true; }
        continue;
      }
      const c = Math.cos(q.a), s = Math.sin(q.a), u = dx * c + dz * s, v = dz * c - dx * s;
      const pu = q.hl + SHEEP.BODY - Math.abs(u), pv = q.hw + SHEEP.BODY - Math.abs(v);
      if (pu <= 0 || pv <= 0) continue;
      if (pu < pv){ const k = u >= 0 ? 1 : -1; out[0] = c * k; out[1] = s * k; }
      else { const k = v >= 0 ? 1 : -1; out[0] = -s * k; out[1] = c * k; }
      return true;
    }
    return false;
  }
  _clear(x, z){ return this.land.walkable(x, z) && !this._inZone(x, z) && !this._inWall(x, z); }

  // out of everyone's sight nothing's simulated. Coming back into range, they're wherever the hours took them
  _wake(penned){
    this.awake = true;
    for (const s of this.sheep) s._placed = false;
    if (penned && this.fold){      // they were brought in hours ago
      const f = this.fold;
      for (const s of this.sheep){
        const u = (Math.random() * 2 - 1) * (f.hl - 1.2), v = (Math.random() * 2 - 1) * (f.hw - 1.2);
        s.x = s.tx = f.x + this._fc * u - this._fs * v; s.z = s.tz = f.z + this._fs * u + this._fc * v;
        s._obs = null; s.mode = 'rest'; s.lie = 1; s.graze = 0; s.speed = 0;
      }
      this._measure();
      return;
    }
    const dx = this.anchor.x - this.cx, dz = this.anchor.z - this.cz;
    for (const s of this.sheep){
      if (this._clear(s.x + dx, s.z + dz)){ s.x += dx; s.z += dz; }
      if (this.dodge){ const x = s.x, z = s.z; s._obs = null; if (this.dodge.push(s) && !this._clear(s.x, s.z)){ s.x = x; s.z = z; } }
      s.tx = s.x; s.tz = s.z; s.mode = 'graze'; s.speed = 0;
    }
    this._measure();
  }

  // What the weather and the ground do to the wool (docs/sheep.md). Rain wets it, and it dries. Wet ground dirties it, in the fold most,
  // since they're packed in there all night. Long rain rinses it, but only so far: fleece is greasy, and that's what washing is for.
  _wool(dt, rain, penned){
    const W = WOOL;
    this.groundWet = rain > 0.05 ? Math.min(1, (this.groundWet || 0) + rain * dt / W.GROUND_WETS) : Math.max(0, (this.groundWet || 0) - dt / W.GROUND_DRIES);
    const ground = this.groundWet;
    for (const s of this.sheep){
      if (s.len < 1 && !s.held) s.len = Math.min(1, s.len + dt / (DAY_SECONDS * s.woolDays));
      s.wet = rain > 0.05 ? Math.min(1, s.wet + rain * dt / W.WETS) : Math.max(0, s.wet - dt / W.DRIES);
      let d = dt / DAY_SECONDS * W.DRY_DIRT;
      if (ground > 0.02 && !s.held){
        const inFold = this.fold && (this.awake ? this._inFold(s.x, s.z) : penned);
        const mud = inFold ? W.FOLD_MUD : this.land.muddy ? this.land.muddy(s.x, s.z) : 0;
        d += ground * mud * dt / DAY_SECONDS * W.MUD;
      }
      s.dirt = Math.min(1, s.dirt + d);
      if (rain > W.RINSE_RAIN && s.wet > 0.6 && s.dirt > W.RINSE_FLOOR) s.dirt = Math.max(W.RINSE_FLOOR, s.dirt - rain * dt / DAY_SECONDS * W.RINSE);
    }
  }

  // threats: [{ x, z, r }]; the player and whoever's near. viewer: {x,z} or null. dayFrac from the sky.
  update(dt, { threats = [], viewer = null, dayFrac = 0.35, rain = 0 } = {}){
    const hour = flockHour(dayFrac), penned = this._isPenned(dayFrac);
    // the wool, seen or not; it changes slowly, so once a second is plenty
    if ((this._woolT = (this._woolT || 0) + dt) >= 1){ this._wool(this._woolT, rain, penned); this._woolT = 0; }
    // let out: they're making for the ground beyond the gap, not for the middle of the fold
    if (this.fold){
      if (this._wasPen && !penned){ const c = this.fold.hw + 10; this.anchor.x = this.fold.x - this._fs * c; this.anchor.z = this.fold.z + this._fc * c; this.target = this.night; }
      this._wasPen = penned;
    }
    this._moveAnchor(dt, hour, penned);
    const near = viewer && Math.hypot(viewer.x - this.cx, viewer.z - this.cz) < SHEEP.WAKE_R;
    if (!near){
      if (this.awake) for (const s of this.sheep){ s.lost = s.short = false; s.led = null; s.off = null; }
      this.awake = false;
      if (this.fold && !this.fold.keeper) this.fold.open = !penned;
      else if (this.fold && penned && (dayFrac > 0.92 || dayFrac < 0.2)) this.fold.open = false;
      // nobody can see them, but they still eat. Every couple of seconds, a disc's worth of what they'd have bitten
      if (this.sward && hour === 'graze' && !penned && (this._discT += dt) > 2){
        const r = 7, cells = Math.PI * r * r / (SWARD.CELL * SWARD.CELL);
        this.sward.eatDisc(this.anchor.x, this.anchor.z, r, this._discT, this.sheep.length * SWARD.EAT * UNWATCHED_BITE / cells);
        this.patch.feed(this.sward.patchValue(this.anchor.x, this.anchor.z, 6), this._discT);
        this._discT = 0;
      }
      return;
    }
    // what's on the ground round here: read now and then, so a flock costs a look at a few crofts and not all of them
    if (this.land.zones && (this._zoneT -= dt) <= 0){ this._zoneT = 3; this.zones = this.land.zones(this.cx, this.cz, 70); }
    // kept, with the gate still open at dusk, they're on their way in: they wake out on the grass and come in as you watch
    if (!this.awake) this._wake(penned && !(this.fold.keeper && this.fold.open && dayFrac > 0.72 && dayFrac < 0.85));
    this._measure();
    if (this.fold && !penned) this.fold.open = true;
    let inside = 0, biteSum = 0, biting = 0, pressed = false, astray = false;
    const k0 = this.fold?.keeper, kept = !!k0, late = kept && penned && (dayFrac > 0.84 || dayFrac < 0.2);

    const all = this.sheep, n = all.length, A = this.anchor;
    for (let i = 0; i < n; i++){
      const s = all[i];
      if (s.held) continue;     // in someone's hands (js/shear-hands.js): it stands, and the others go round it
      // --- who's about: the nearest few, and how many are running or lying
      let sepX = 0, sepZ = 0, mx = 0, mz = 0, ax = 0, az = 0, m = 0, running = 0, still = 0, lying = 0, alarmed = 0, nearest = Infinity, nearDX = 0, nearDZ = 0;
      for (let j = 0; j < n; j++){
        if (j === i) continue;
        const o = all[j], dx = s.x - o.x, dz = s.z - o.z, d = Math.hypot(dx, dz) || 0.01;
        if (d < nearest){ nearest = d; nearDX = dx / d; nearDZ = dz / d; }
        if (d < SHEEP.KEEP){ const k = (SHEEP.KEEP - d) / SHEEP.KEEP / d * 1.2; sepX += dx * k; sepZ += dz * k; }
        if (d < SHEEP.SEE){
          mx += o.x; mz += o.z; m++;
          ax += Math.sin(o.heading); az += Math.cos(o.heading);
          if (o.mode === 'run') running++; else if (o.mode === 'graze') still++;
          if (o.mode === 'rest') lying++;
          if (o.fright > 0) alarmed++;
        }
      }
      // --- pressure: anything inside the flight zone
      let px = 0, pz = 0, fright = 0;
      for (const t of threats){
        const dx = s.x - t.x, dz = s.z - t.z, d = Math.hypot(dx, dz) || 0.01;
        if (d >= t.r) continue;
        const k = 1 - d / t.r;
        px += dx / d * k; pz += dz / d * k; fright = Math.max(fright, k);
        if (t.player) pressed = true;
      }
      s.fright = fright;
      const alone = m === 0;
      const fromAnchor = Math.hypot(A.x - s.x, A.z - s.z);
      const inFold = this.fold ? this._inFold(s.x, s.z) : false;
      if (inFold) inside++;
      // kept sheep can get lost, and someone comes for them (js/shepherd.js). Nobody keeping them, and they just walk back,
      // as they always have. Short: not lost, still trying to get home, but it's late and they're not there yet. It's what the
      // count at the gap finds, and it stops the gate being shut on them
      if (kept && !s.led){
        // nobody's come for it after a good while: it finds its own way, which is what the flock does with nobody keeping it
        if (s.lost && !s.off && (s.lostFor = (s.lostFor || 0) + dt) > LOST_WAIT){ s.lost = false; s.lostFor = 0; s.ownWay = LOST_WAIT; }
        // hearing the call: it knows that, and comes
        if (s.lost && this.calling && !s.off && k0 && Math.hypot(s.x - k0.x, s.z - k0.z) < CALL_R){ s.lost = false; s.lostFor = 0; s.ownWay = LOST_WAIT; }
        if (s.ownWay > 0) s.ownWay -= dt;
        else if (!s.lost && !inFold && alone && fromAnchor > LOST_R) s.lost = true;
        else if (s.lost && !s.off && (inFold || m >= 3)){ s.lost = false; s.lostFor = 0; }
        // (close by the gap it'll get in by itself, unless the gate's already been shut on it: then someone has to come)
        s.short = late && !inFold && !s.lost && (!this.fold.open || Math.hypot(s.x - this._mouthOut.x, s.z - this._mouthOut.z) > 6);
      }
      if (s.lost || s.short || s.led) astray = true;

      // --- what it's doing
      if (s.led) s.mode = 'walk';
      else if (fright > 0){
        s.mode = 'run'; s.runT = 1.5; s.calm = 0; this.herded = 8;
      } else if (s.mode === 'run'){
        s.runT -= dt;
        if (alarmed && s.runT < 1) s.runT = 1;     // nobody settles while those beside it are still being pressed
        // a burst, not a way of life: when its time's up it stops, sooner once those around have stopped
        if (s.runT <= 0 && Math.random() < dt * (1.2 + 0.2 * still)){
          s.mode = 'graze'; s.calm = 40 + Math.random() * 80; s.stepT = 1 + Math.random() * 4; s.tx = s.x; s.tz = s.z;
        }
      } else if (alarmed && Math.random() < dt * 1.5 * alarmed){
        // a neighbour bolting from something gets everyone up, however calm: fear doesn't wait its turn
        s.mode = 'run'; s.runT = 2 + Math.random() * 2;
      } else if ((s.calm -= dt) <= 0 && (s.mode !== 'rest' || lying < m * 0.5)){
        // running catches: one or two start, then it spreads through the flock. A sheep out on its own starts more
        // readily. Having just run, it won't catch it again for a while, or a flock would run for ever
        const reach = this.spread > 8 ? (this.spread - 8) * 0.0035 : 0;
        const rate = 0.0004 + reach + 0.3 * running * running + (alone ? 0.05 : 0);
        if (Math.random() < rate * dt){ s.mode = 'run'; s.runT = 2 + Math.random() * 3; this.runs++; }
      }
      if (!s.led && (s.mode === 'graze' || s.mode === 'walk' || s.mode === 'rest')){
        const wantRest = hour === 'night' || (hour === 'midday' && s.lazy < 0.75);
        // gone off on its own, until it's far enough; then it stays where it is and eats
        if (s.off){
          if (Math.hypot(s.off.x - s.x, s.off.z - s.z) < 2){ s.off = null; s.mode = 'graze'; s.tx = s.x; s.tz = s.z; }
          else s.mode = 'walk';
        }
        else if (s.lost && !inFold){ if (s.mode === 'walk'){ s.mode = 'graze'; s.tx = s.x; s.tz = s.z; } }
        // in at dusk, out at dawn, and nobody stops to eat in the gateway with the rest behind it
        else if (this.fold && (penned ? inFold ? false : this.fold.open : inFold)){ s.mode = 'walk'; }
        else if (this.fold && this.fold.open && this._inMouth(s.x, s.z)){ s.mode = 'walk'; }
        else if (inFold && s.mode === 'walk'){ s.mode = 'graze'; s.tx = s.x; s.tz = s.z; }   // in: that's far enough
        else if (inFold && s.mode === 'graze' && wantRest && Math.random() < dt * 0.15) s.mode = 'rest';
        else if (inFold) {}
        else if (fromAnchor > SHEEP.ROAM_R){ s.mode = 'walk'; }
        else if (s.mode === 'walk' && fromAnchor < SHEEP.ROAM_R * 0.6){ s.mode = 'graze'; s.tx = s.x; s.tz = s.z; s.stepT = Math.random() * 3; }   // here will do: no going back for the last bite
        else if (s.mode === 'graze' && wantRest && Math.random() < dt * 0.15) s.mode = 'rest';
        else if (s.mode === 'rest' && !wantRest && Math.random() < dt * (0.03 + 0.12 * (1 - s.lazy))) s.mode = 'graze';
      }

      // --- where it wants to go, and how fast
      let dirX = 0, dirZ = 0, want = 0;
      if (s.mode === 'run'){
        // inward (the selfish herd), the way the others face, and off from whatever's pressing
        const toX = m ? mx / m - s.x : 0, toZ = m ? mz / m - s.z : 0, tl = Math.hypot(toX, toZ) || 1;
        const al = Math.hypot(ax, az) || 1;
        const flee = this.tune.flee;
        const pl = Math.hypot(px, pz) || 1;
        const pack = fright > 0 ? 1.1 : 1.2;
        dirX = toX / tl * pack + ax / al * 0.45 + px / pl * 1.6 * flee * (fright > 0 ? 1 : 0);
        dirZ = toZ / tl * pack + az / al * 0.45 + pz / pl * 1.6 * flee * (fright > 0 ? 1 : 0);
        want = fright > 0 ? SHEEP.WALK + (SHEEP.RUN - SHEEP.WALK) * Math.sqrt(fright) : SHEEP.RUN * 0.55;
      } else if (s.led || s.off){
        // at someone's heels (a little quicker than they walk, or it'd never catch up), or off on its own
        const to = s.led || s.off, wx = to.x - s.x, wz = to.z - s.z, l = Math.hypot(wx, wz) || 1;
        dirX = wx / l; dirZ = wz / l; want = !s.led ? SHEEP.WALK : l > 2.4 ? 2.6 : 0;
        if (s.led && l > 14){ s.led = null; s.lost = true; }   // lost them on the way: they'll have to come back for it
      } else if (s.mode === 'walk'){
        // shut out? It hangs about the gate, and in time someone comes for it (docs/sheep.md)
        this._way(s, !penned ? (inFold ? this._mouthOut : A) : this.fold.open || inFold ? this.night : this._mouthOut, _wp);
        const wx = _wp[0] - s.x, wz = _wp[1] - s.z, l = Math.hypot(wx, wz) || 1;
        dirX = wx / l; dirZ = wz / l; want = SHEEP.WALK * (this.calling ? 1.35 : 1);
      } else if (s.mode === 'graze'){
        // a few steps to the next bite, then head down. They spread by choosing ground away from the others
        // the time's its head down: it only starts once it's got there, or the amble eats most of it
        if (Math.hypot(s.tx - s.x, s.tz - s.z) <= 0.15 && (s.stepT -= dt) <= 0){
          // it looks about and goes for the best-looking bite in reach, and moves sooner where the grass is poor
          let a = Math.random() * 6.283, r = 0.6 + Math.random() * 1.6, here = 1;
          if (this.sward){
            here = this.sward.value(s.x, s.z);
            let bv = -1;
            // mostly what's in front of it: a sheep grazes forward, and doesn't turn round for every mouthful. Only a
            // bare patch has it look further about. (ca is measured as heading is, so this is its own forward)
            const fan = here < 0.3 || this.tune.spin ? 3.1 : 0.9;
            for (let c = 0; c < 5; c++){
              const ca = s.heading + (Math.random() * 2 - 1) * fan, cr = 0.6 + Math.random() * 1.4;
              const cv = this.sward.value(s.x + Math.sin(ca) * cr, s.z + Math.cos(ca) * cr) + Math.random() * 0.15;
              if (cv > bv){ bv = cv; a = Math.PI / 2 - ca; r = cr; }
            }
          }
          s.stepT = (6 + Math.random() * 9) * (0.4 + 0.6 * here);
          let ox = Math.cos(a) * r, oz = Math.sin(a) * r;
          if (m){ const away = Math.hypot(s.x - mx / m, s.z - mz / m) || 1; ox += (s.x - mx / m) / away * 0.5; oz += (s.z - mz / m) / away * 0.5; }
          if (nearest < SHEEP.ROOM){ const k = 1.6 * (1 - nearest / SHEEP.ROOM) + 0.3; ox += nearDX * k; oz += nearDZ * k; }
          s.tx = s.x + ox; s.tz = s.z + oz;
          if (this.dodge?.hit(s, s.tx, s.tz)){ s.tx = s.x; s.tz = s.z; }   // no grazing in among the roots: it waits for a better look
        }
        const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
        if (d > 0.15){
          dirX = dx / d; dirZ = dz / d; want = SHEEP.GRAZE_STEP;
          // shoved off it, or someone's standing on it: not worth the walk
          if ((s.stepping = (s.stepping || 0) + dt) > 7){ s.tx = s.x; s.tz = s.z; s.stepping = 0; }
        } else s.stepping = 0;
      }
      // keeping room always applies, even to one standing still
      dirX += sepX * (want ? 1.2 : 0.8); dirZ += sepZ * (want ? 1.2 : 0.8);
      // standing at its bite with someone too close: a shuffle sideways, head still down. Turning to face the way it's
      // shoved had grazing flocks spinning on the spot (2026-11-04)
      if (!want && (sepX || sepZ)){
        if (s.mode === 'graze' && !this.tune.spin){
          const l = Math.hypot(sepX, sepZ) || 1, nx = s.x + sepX / l * SHUFFLE * dt, nz = s.z + sepZ / l * SHUFFLE * dt;
          if (this._clear(nx, nz) && !this.dodge?.hit(s, nx, nz)){ s.x = s.tx = nx; s.z = s.tz = nz; }
        } else want = SHEEP.GRAZE_STEP;
      }
      if (s.mode === 'rest' && s.lie > 0.5) want = 0;
      // curve round a trunk coming up, rather than meeting it and sliding
      if (this.dodge && want > 0.8){
        this.dodge.steer(s, dirX, dirZ, want > 2 ? 3.5 : 2, _lean);
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX = dirX / l + _lean[0]; dirZ = dirZ / l + _lean[1];
      }
      // something's been raised on it (a hut, a planted croft): out, by the nearest edge
      const stranded = (this.zones.length && this._zoneOut(s.x, s.z, _lean)) || (this.fold && this._wallOut(s.x, s.z, _lean));
      if (stranded){ dirX = _lean[0]; dirZ = _lean[1]; want = SHEEP.WALK; }

      // just put down, on a spot nobody chose with this trunk in mind: it isn't moving, so nothing else would shift it
      if (!s._placed){ s._placed = true; this.dodge?.push(s); }
      // --- move: turn no faster than a sheep turns, and go round what can't be walked on
      // grazing it turns slowly, and doesn't walk until it's facing about the right way, or it'd circle a near bite
      let aim = want;
      if (want > 0 && (dirX || dirZ)){
        const goal = Math.atan2(dirX, dirZ), off = angleTo(s.heading, goal), rate = s.mode === 'graze' && !this.tune.spin ? GRAZE_TURN : 6;
        s.heading += Math.max(-1, Math.min(1, off / (rate * dt || 1))) * rate * dt;
        if (s.mode === 'graze' && !this.tune.spin) aim = want * Math.max(0, Math.cos(off));
      }
      s.speed += (aim - s.speed) * Math.min(1, dt * (aim > s.speed ? 4 : 6));
      if (s.speed > 0.02){
        const step = s.speed * dt;
        let moved = false;
        // straight on, else round by its own side, so it follows a wall to the corner instead of dithering at it
        for (let t = 0; t < TURNS.length && !moved; t++){
          const off = TURNS[t] * s.side, h = s.heading + off, nx = s.x + Math.sin(h) * step, nz = s.z + Math.cos(h) * step;
          if (!stranded && !this._clear(nx, nz)) continue;
          const px = s.x, pz = s.z;
          s.x = nx; s.z = nz;
          if (this.dodge && this.dodge.push(s) && !stranded && (!this._clear(s.x, s.z) || this.dodge.hit(s, s.x, s.z))){ s.x = px; s.z = pz; continue; }
          if (off) s.heading += angleTo(s.heading, h) * Math.min(1, dt * 8);
          moved = true;
        }
        if (!moved){ s.speed = 0; s.side = -s.side; }   // boxed in: try the other way
        s.phase += step * 5.2;
      }
      // --- the pose the view draws
      const ease = Math.min(1, dt * 4);
      s.walk += (clamp01(s.speed / SHEEP.WALK) - s.walk) * ease;
      s.graze += ((s.mode === 'graze' && s.speed < 0.25 ? 1 : 0) - s.graze) * ease;
      s.lie += ((s.mode === 'rest' && s.speed < 0.1 ? 1 : 0) - s.lie) * Math.min(1, dt * 1.5);
      // --- a head down is a mouthful, a little ahead of the body
      if (this.sward && s.graze > 0.7 && !inFold){
        const mx2 = s.x + Math.sin(s.heading) * 1.1, mz2 = s.z + Math.cos(s.heading) * 1.1;
        this.sward.eat(mx2, mz2, dt);
        biteSum += this.sward.value(mx2, mz2); biting++;
      }
    }
    if (biting) this.patch.feed(biteSum / biting, dt);
    // the gate: shut once they're all in, and late on regardless. Whoever's still out is out
    if (penned && this.fold.open && (this.fold.keeper ? !astray && (dayFrac > 0.97 || dayFrac < 0.2) : inside === n || dayFrac > 0.9 || dayFrac < 0.25)) this.fold.open = false;
    this.inside = inside;
    // now and then one just wanders off, the one at the edge. Someone has to notice
    if (kept && !penned && hour === 'graze' && !this.tune.noStray && (this._strayT = (this._strayT ?? 120) - dt) <= 0){
      this._strayT = 200 + Math.random() * 300;
      let far = null, fd = -1;
      for (const s of all){ const d = Math.hypot(s.x - this.cx, s.z - this.cz); if (d > fd && !s.lost && !s.led){ fd = d; far = s; } }
      if (far){
        const a = Math.atan2(far.z - this.cz, far.x - this.cx) + (Math.random() - 0.5), r = LOST_R + 6 + Math.random() * 12;
        const x = this.anchor.x + Math.cos(a) * r, z = this.anchor.z + Math.sin(a) * r;
        if (this._grazeable(x, z)){ far.off = { x, z }; far.lost = true; }
      }
    }
    this.chased = pressed ? 6 : Math.max(0, (this.chased || 0) - dt);
    if (this.herded > 0){
      // where they've been driven is where they graze, for now
      this.herded -= dt;
      this.anchor.x = this.cx; this.anchor.z = this.cz;
      this.targetT = Math.min(this.targetT, 10);
    }
  }
  // a step in the world: who's pressing on them, what hour it is. world is the AgentWorld
  tick(dt, world){
    const threats = [];
    if (this.awake){
      if (world.threat) threats.push({ x: world.threat.x, z: world.threat.z, r: SHEEP.ZONE_PLAYER, player: true });
      for (const n of world.near(this.cx, this.cz, this.spread + 8 + SHEEP.ZONE_FOLK))
        // (Walter of Henley's test: sheep aren't scared of their own shepherd)
        if (!n._indoors && n !== this.fold?.keeper) threats.push({ x: n.x, z: n.z, r: SHEEP.ZONE_FOLK });
    }
    // a band on the move takes its flock with it (docs/sheep.md): their home range is wherever the band has got to
    const g = this.owner?.group;
    if (g && g.npcs?.length && (this._bandT = (this._bandT || 0) - dt) <= 0){
      this._bandT = 20;
      let x = 0, z = 0; for (const n of g.npcs){ x += n.x; z += n.z; }
      x /= g.npcs.length; z /= g.npcs.length;
      if (Math.hypot(x - this.home.x, z - this.home.z) > 30 && this.land.open(x, z)){
        this.home = { x, z }; this.night = { x: x + 8, z: z + 8 };
      }
    }
    this.update(dt, { threats, viewer: world.viewer, dayFrac: world.time - Math.floor(world.time), rain: world.rain || 0 });
  }
  get runningShare(){ let k = 0; for (const s of this.sheep) if (s.mode === 'run') k++; return k / this.sheep.length; }
}

// a flock for each band that keeps one: owners [{ x, z, name }]. rng is its own stream, so the sheep don't move anything else
export function spawnFlocks(world, owners, rng, land){
  for (const o of owners){
    // a settled place keeps its sheep on a common with a fold (gen/common.js); a band on the move, wherever it's got to
    const common = o.place && land.site ? planCommon(o.place, { ...land.site, height: land.height, open: land.open, trunks: land.within, rng }) : null;
    // saying so: this fallback once hid every fold in the world behind sheep that looked fine
    if (o.place && land.site && !common) console.warn(`no site for a fold at ${o.name}`, o.place.commonMiss);
    const home = common ? common.home : findPasture(o.x, o.z, land, rng, { avoid: world.flocks.map(f => f.home) });
    if (!home) continue;
    const f = new Flock({ home, n: 15 + (rng() * 11 | 0), land, rng, owner: o, name: o.name, fold: common?.fold || null });
    f.common = common;
    world.flocks.push(f);
  }
  return world.flocks;
}

// a good place for a flock: a walk from where its people live, on open ground, with room
export function findPasture(cx, cz, land, rng, { min = 40, max = 150, avoid = [] } = {}){
  let best = null, bs = -1;
  for (let i = 0; i < 40; i++){
    const a = rng() * 6.283, r = min + rng() * (max - min);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (!land.open(x, z) || avoid.some(q => Math.hypot(q.x - x, q.z - z) < 90)) continue;
    let room = 0;
    for (let k = 0; k < 8; k++){ const b = k * 0.785; if (land.open(x + Math.cos(b) * 14, z + Math.sin(b) * 14)) room++; }
    const s = room - r * 0.01;
    if (s > bs){ bs = s; best = { x, z }; }
  }
  return best;
}
