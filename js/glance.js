// The glance: for someone walking with the keys alone, who has no way to look down at a
// berry or across at a shelf. Stop near something you could use and, after a moment, your
// eyes go to it: square on sideways, but tilting only enough to have it in view. E acts on it
// from then on, cursor or no; walk on and the eyes come back.
//
// It's an offset on the camera (y, p), never on the player's own yaw and pitch: those stay
// where the player left them, so walking keeps its heading through the whole thing.
//
//   walking             the offset eases out, and the next stop may glance again
//   turning (the keys)  you've taken the aim: main.js adds takeYaw() to its yaw so the view
//                       doesn't jump, the pitch eases out, and what you turned from won't
//                       call you back; after a turn only what's nearly ahead draws the eye
//   the mouse or thumb  bake() both into the player's own view, and no glances for a while
//
// One look per stop: standing still, you aren't dragged round by whoever wanders past.
// Tab (step) moves the eye on to the next thing in reach, left to right as you see them, and
// round again; Shift+Tab goes back. It's asked for, so it looks even when the mouse was used.
// Pure, no THREE: tools/check-glance.mjs drives it.

export const GLANCE = {
  PAUSE: 0.45,          // s stood still before the eyes move
  REACH: 70 * Math.PI / 180,   // how far off your heading it may be (just past the screen's edge)
  REACH_TURNED: 25 * Math.PI / 180,   // ...after turning with the keys
  LOSE: 110 * Math.PI / 180,   // someone walking off round behind you: let them go
  RANGE: 4.5, KEEP: 1.5,  // m: to catch the eye (a thing may have its own range), and how much further it holds it
  LEVEL: 0.25,          // s: smoothing as the player's own pitch comes level, the cursor free
  TO: 0.3, BACK: 0.16,  // s: smoothing going to it and coming back (arrives in about twice that)
  TURN: 0.25,           // s: smoothing as turnTo swings the player round
  PITCH_TOP: 1.3,       // main.js's limit on looking up and down
  TILT_BAND: 18 * Math.PI / 180,   // this far above or below the middle of the view needs no tilt (clear of the hands; the screen's edge is 35)
  TILT_MOST: 25 * Math.PI / 180,   // and the most the view will tilt, however close it is
  HANDS_OFF: 60,        // s after really using the mouse or a thumb that nothing moves the view
  DELIBERATE: 0.25,     // rad (about 115 px) moved inside one DELIBERATE_S: a look, not a hand settling
  DELIBERATE_S: 0.5,
  SETTLE: 0.3,          // s after taking the lock when movement doesn't count: the hand that clicked, and the browser's stray jump
};

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// how far to tilt, for something `a` radians above or below the middle of the view
export function softTilt(a){
  const over = Math.abs(a) - GLANCE.TILT_BAND;
  return over <= 0 ? 0 : Math.sign(a) * Math.min(GLANCE.TILT_MOST, over);
}

// Unity's SmoothDamp: eases in and out, follows a moving goal, doesn't overshoot, and doesn't
// care about the frame rate. Returns [value, velocity].
function damp(cur, goal, vel, smooth, dt){
  const w = 2 / smooth, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const c = cur - goal, t = (vel + w * c) * dt;
  let v = (vel - w * t) * e, out = goal + (c + t) * e;
  if ((goal - cur > 0) === (out > goal)){ out = goal; v = 0; }
  return [out, v];
}

export function createGlance(){
  let vl = 0, vf = 0, vy = 0, vp = 0, idle = 0, clock = 0, armed = true, turned = false;
  let target = null, passed = null, handsOffUntil = 0, moved = 0, movedFrom = -1, settleUntil = 0, step = 0;

  const note = what => { me.log.push(`${clock.toFixed(1)} s: ${what}`); if (me.log.length > 8) me.log.shift(); };
  const toward = (eye, q, yaw, pitch) => {
    const dx = q.x - eye.x, dz = q.z - eye.z;
    return { dist: Math.hypot(dx, q.y - eye.y, dz), off: wrap(Math.atan2(-dx, -dz) - yaw),
             p: Math.max(-GLANCE.PITCH_TOP, Math.min(GLANCE.PITCH_TOP, Math.atan2(q.y - eye.y, Math.hypot(dx, dz)))) - pitch };
  };

  const me = {
    y: 0, p: 0,
    at: null,                  // the thing looked at, as things() gave it: where it is
    log: [],                   // the last few stops and what each did, in order (leaGlance(), for finding out)
    get target(){ return target; },
    get handsOff(){ return Math.max(0, handsOffUntil - clock); },   // s until it may look again

    // one frame. { free: nothing else has the view; moving; turning; yaw, pitch, eye: {x,y,z};
    // things(cb): cb({ ref, x, y, z, range?, rank? }) for each thing there is;
    // clear(x, z): whether anything stands between you and there }
    tick(dt, { free, moving, turning, yaw, pitch, eye, things, clear }){
      if (!free) return;
      clock += dt;
      let goalY = 0, goalP = 0, smooth = GLANCE.BACK;
      if (moving){
        idle = 0; target = null; me.at = null; passed = null; armed = true; turned = false; step = 0;
      } else if (turning){
        idle = 0; if (target) passed = target; target = null; me.at = null; armed = true; turned = true; step = 0;
      } else {
        idle += dt;
        if (step){                 // Tab: the next thing in reach, in the order they stand across the view
          const dir = step; step = 0;
          const row = [];
          things(q => {
            const a = toward(eye, q, yaw, pitch);
            if (a.dist >= 0.4 && a.dist <= (q.range ?? GLANCE.RANGE) && Math.abs(a.off) <= GLANCE.REACH && (q.los === false || clear(q.x, q.z))) row.push({ q, a });
          });
          row.sort((m, n) => n.a.off - m.a.off);           // left (off > 0) to right
          let i = row.findIndex(r => r.q.ref === target);
          if (i >= 0) i = (i + dir + row.length) % row.length;
          else if (row.length){                            // nothing held: the first one past the middle of the view, that way
            i = dir > 0 ? row.findIndex(r => r.a.off < me.y) : row.findLastIndex(r => r.a.off > me.y);
            if (i < 0) i = dir > 0 ? 0 : row.length - 1;
          }
          if (i >= 0){ target = row[i].q.ref; me.at = row[i].q; armed = false; passed = null; idle = Math.max(idle, GLANCE.PAUSE); }
          note(row.length ? `tab: ${i + 1} of ${row.length}` : 'tab: nothing in reach');
        }
        if (target || (armed && idle >= GLANCE.PAUSE)){
          const seen = []; things(t => seen.push(t));
          if (target){
            const q = seen.find(t => t.ref === target), a = q && toward(eye, q, yaw, pitch);
            if (a && a.dist <= (q.range ?? GLANCE.RANGE) + GLANCE.KEEP && Math.abs(a.off) <= GLANCE.LOSE){
              goalY = me.y + wrap(a.off - me.y); goalP = softTilt(a.p); smooth = GLANCE.TO; me.at = q;
            } else { target = null; me.at = null; }
          }
          if (!target && armed && idle >= GLANCE.PAUSE){
            armed = false;
            if (clock < handsOffUntil) note(`stopped: no look, the mouse or a thumb was used, ${(handsOffUntil - clock).toFixed(0)} s to go`);
            else {
              const reach = turned ? GLANCE.REACH_TURNED : GLANCE.REACH;
              const ranked = [];
              for (const q of seen){
                if (q.ref === passed) continue;
                const a = toward(eye, q, yaw, pitch);
                if (a.dist < 0.4 || a.dist > (q.range ?? GLANCE.RANGE) || Math.abs(a.off) > reach) continue;
                ranked.push({ q, a, score: Math.abs(a.off) + a.dist * 0.12 + (q.rank || 0) });
              }
              ranked.sort((m, n) => m.score - n.score);
              const hit = ranked.find(r => r.q.los === false || clear(r.q.x, r.q.z));
              note(hit ? `stopped: looked at something ${hit.a.dist.toFixed(1)} m off, ${(hit.a.off * 180 / Math.PI).toFixed(0)} deg from heading` : ranked.length ? `stopped: ${ranked.length} in reach, all behind a wall` : `stopped: nothing in reach, of ${seen.length} things`);
              if (hit){ target = hit.q.ref; me.at = hit.q; goalY = me.y + wrap(hit.a.off - me.y); goalP = softTilt(hit.a.p); smooth = GLANCE.TO; }
            }
          }
        }
      }
      [me.y, vy] = damp(me.y, goalY, vy, smooth, dt);
      [me.p, vp] = damp(me.p, goalP, vp, smooth, dt);
      if (!target){
        if (Math.abs(me.y) < 1e-4 && Math.abs(vy) < 1e-3){ me.y = 0; vy = 0; }
        if (Math.abs(me.p) < 1e-4 && Math.abs(vp) < 1e-3){ me.p = 0; vp = 0; }
      }
    },

    // the cursor free, nothing can hold the view up or down, so it comes level: the next pitch
    level(dt, pitch){
      if (pitch === 0){ vl = 0; return 0; }
      let out; [out, vl] = damp(pitch, 0, vl, GLANCE.LEVEL, dt);
      if (Math.abs(out) < 1e-4 && Math.abs(vl) < 1e-3){ out = 0; vl = 0; }
      return out;
    },

    // the player being turned to something, for real: the next yaw, which stays where it's left.
    // Follows a goal that moves, the short way round. startTurn first. (Stands in for tick while it
    // lasts, so it keeps the clock: the mouse must be able to take the view back.)
    startTurn(){ vf = 0; },
    turnTo(dt, yaw, goal){
      clock += dt;
      let out; [out, vf] = damp(yaw, yaw + wrap(goal - yaw), vf, GLANCE.TURN, dt);
      return out;
    },

    // the keys have started turning you: hand the sideways part over to the player's yaw
    takeYaw(){ const y = me.y; me.y = 0; vy = 0; return y; },

    // the mouse or a thumb moved (rad). A deliberate look returns { y, p } to add to the
    // player's own view, so nothing jumps; a hand settling returns null and changes nothing.
    manual(rad){
      if (clock < settleUntil) return null;
      if (clock - movedFrom > GLANCE.DELIBERATE_S){ moved = 0; movedFrom = clock; }
      moved += rad;
      if (moved < GLANCE.DELIBERATE) return null;
      handsOffUntil = clock + GLANCE.HANDS_OFF; moved = 0; note('the mouse or a thumb took the view');
      return me.bake();
    },

    // for testing: forget the mouse was used
    handsOn(){ handsOffUntil = 0; },

    // the lock was just taken
    settle(){ settleUntil = clock + GLANCE.SETTLE; },

    // give the offset to the player's view and stop glancing (the glass, a canoe, the fly cam)
    bake(){
      const out = { y: me.y, p: me.p };
      me.y = me.p = vy = vp = 0; target = null; me.at = null; armed = false; idle = 0;
      return out;
    },

    // Tab (1) or Shift+Tab (-1): on to the next thing, on the next frame stood still
    step(dir){ step = dir < 0 ? -1 : 1; },

    // E was pressed: if that used the thing up, the eye may go on to the next
    rearm(){ armed = true; passed = null; },

    // moved by the world (a stair, a door, a fade): the view was set outright, so no offset
    reset(){ me.y = me.p = vy = vp = 0; target = null; me.at = null; passed = null; armed = false; idle = 0; turned = false; },
  };
  return me;
}
