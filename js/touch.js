// touch.js — the Lea on a phone. Phones have no pointer lock and no keys, and the game is
// written all through against both. So rather than teach forty call sites about touch, this
// gives them what they already ask for: a stand-in pointer lock (document.pointerLockElement,
// canvas.requestPointerLock, the pointerlockchange event) and real key events from the on-screen
// controls, so a step still breaks a rest and Use is still E. main.js adds only what keys can't
// say: how far the stick leans, how far a thumb dragged, and what Use would do. Design in
// docs/phone.md.
//
// A touch laptop keeps its mouse: this is on only when the main pointer is a finger (or ?touch).

const params = new URLSearchParams(location.search);
export const TOUCH = params.has('touch') || matchMedia('(hover: none) and (pointer: coarse)').matches;

const LOOK = 0.005;        // radians a dragged pixel turns you (a thumb moves less far than a mouse)
const STICK_R = 56;        // px from the stick's centre to full lean
const DEAD = 0.18;         // lean under this is no step at all
const RUN_AT = 1.5;        // pushed this far past the ring (× STICK_R), you run
const TAP_MS = 280, TAP_PX = 10;   // a touch that stayed this short and this still is a tap, not a drag

// the left thumb's lean, read every frame by main.js: fwd/right in -1..1, mag 0..1
export const stick = { fwd: 0, right: 0, mag: 0 };

function key(type, code){
  const k = code === 'Escape' ? 'Escape' : code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
  document.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true }));
}
const press = code => { key('keydown', code); key('keyup', code); };

// ---------- the stand-in pointer lock ----------
if (TOUCH){
  document.documentElement.classList.add('touch');
  const canvas = document.getElementById('c');
  let locked = false, asked = false;
  const changed = () => document.dispatchEvent(new Event('pointerlockchange'));
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked ? canvas : null });
  // Taking it is synchronous, inside the tap: entering the world starts the sound, and iOS only
  // lets an AudioContext start within the gesture. Letting go waits a microtask, as some callers
  // release first and only then mark their panel open (the real event is later still).
  canvas.requestPointerLock = () => {
    if (locked) return;
    locked = true; changed();
    if (asked) return;                                    // once: if you leave the full screen, the game stays out of it
    asked = true;                                         // Android gets the whole screen; iPhones have no such call
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch?.(() => {});
  };
  document.exitPointerLock = () => { if (locked){ locked = false; queueMicrotask(changed); } };

  // iOS pinches the page whatever the viewport tag says, and the toolbars report late on a turn
  document.addEventListener('gesturestart', e => e.preventDefault());
  addEventListener('orientationchange', () => setTimeout(() => dispatchEvent(new Event('resize')), 300));

  const enter = document.getElementById('enter-text');
  if (enter) enter.textContent = 'TAP TO ENTER';
  const how = document.getElementById('controls-text');
  if (how) how.textContent = 'hold it sideways · left thumb walks, push far to run · right thumb looks · tap someone to talk';
}

// ---------- the controls ----------
// hooks from main.js: look(dx, dy) in px; tap(x, y); wake() on any touch (a phone suspends sound
// when you leave the page, and only a gesture brings it back).
export function touchControls(canvas, { look, tap, wake }){
  if (!TOUCH) return { setFree(){}, setUse(){}, setScope(){} };

  const el = (tag, id, text, parent = document.body) => { const n = document.createElement(tag); n.id = id; if (text) n.textContent = text; parent.appendChild(n); return n; };
  const row = document.getElementById('corner-btns');
  el('button', 'spell-btn', 'spells', row).addEventListener('click', () => press('KeyC'));
  el('button', 'map-btn', 'map', row).addEventListener('click', () => press('KeyM'));
  document.getElementById('map')?.addEventListener('click', () => press('KeyM'));

  const base = el('div', 'stick'), nub = el('div', 'stick-nub', '', base);
  const use = el('button', 'use-btn'); use.classList.add('hide');
  const jump = el('button', 'jump-btn', 'jump');
  const close = el('button', 'close-btn', '✕'); close.setAttribute('aria-label', 'Close'); close.classList.add('hide');
  const glass = el('div', 'glass-btns'); glass.classList.add('hide');
  const more = el('button', 'glass-more', '+', glass), less = el('button', 'glass-less', '−', glass);

  // Pressed on pointerdown: a thumb already looking shouldn't have to lift for a click to count
  // And the click that follows is swallowed: what a press shut is gone by the lift, and the click
  // would land on whatever's under it (the gear under the ✕, the overlay of a dialog Use just opened,
  // which a click closes). Cancelling touchstart can't be relied on: it isn't always cancelable.
  const pressed = new Set(); let swallowUntil = 0;
  document.addEventListener('pointerup', e => { if (pressed.delete(e.pointerId)) swallowUntil = e.timeStamp + 400; }, true);
  document.addEventListener('pointercancel', e => pressed.delete(e.pointerId), true);
  addEventListener('click', e => {
    if (e.timeStamp < swallowUntil){ swallowUntil = 0; e.stopPropagation(); e.preventDefault(); }
  }, true);
  const onPress = (n, down, up) => {
    n.addEventListener('pointerdown', e => { pressed.add(e.pointerId); e.preventDefault(); e.stopPropagation(); down(); });
    if (up) for (const t of ['pointerup', 'pointercancel', 'pointerleave']) n.addEventListener(t, up);
  };
  onPress(use, () => press('KeyE'));
  let jumping = false;
  onPress(jump, () => { jumping = true; key('keydown', 'Space'); }, () => { if (jumping){ jumping = false; key('keyup', 'Space'); } });
  onPress(close, () => press('Escape'));
  const zoom = deltaY => dispatchEvent(new WheelEvent('wheel', { deltaY }));
  onPress(more, () => zoom(-1));
  onPress(less, () => zoom(1));

  // one thumb on the stick, one on the look; each keeps its own finger whatever else lands
  let walk = null, turn = null, free = false;
  const held = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, ShiftLeft: false };
  const hold = (code, on) => { if (held[code] !== on){ held[code] = on; key(on ? 'keydown' : 'keyup', code); } };

  function lean(dx, dy){
    const d = Math.hypot(dx, dy), m = Math.min(1, d / STICK_R), k = d ? m / d : 0;
    stick.mag = m < DEAD ? 0 : m;
    stick.right = stick.mag ? dx * k : 0;
    stick.fwd = stick.mag ? -dy * k : 0;
    // The keys say that you're stepping, which the game listens for. How much comes from `stick`.
    hold('KeyW', stick.fwd > 0.38);
    hold('KeyS', stick.fwd < -0.38);
    hold('KeyD', stick.right > 0.38);
    hold('KeyA', stick.right < -0.38);
    hold('ShiftLeft', d > STICK_R * RUN_AT);
    base.classList.toggle('run', held.ShiftLeft);
    const c = Math.min(d, STICK_R) / (d || 1);
    nub.style.transform = `translate(${(dx * c).toFixed(1)}px, ${(dy * c).toFixed(1)}px)`;
  }
  function letGo(){
    walk = null; turn = null;
    lean(0, 0);
    base.classList.remove('on');
    if (jumping){ jumping = false; key('keyup', 'Space'); }
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });   // no click, no selection, no magnifier
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !free) return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();              // (a stray cursor mode: there's no Esc to leave it by)
    const t = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: e.timeStamp, moved: false };
    if (e.clientX < innerWidth * 0.45 && !walk){
      walk = t;
      base.style.left = `${e.clientX}px`; base.style.top = `${e.clientY}px`;
      base.classList.add('on');
    } else if (!turn) turn = t;
    else return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_){}
  });
  canvas.addEventListener('pointermove', e => {
    if (walk && e.pointerId === walk.id){
      if (Math.hypot(e.clientX - walk.sx, e.clientY - walk.sy) > TAP_PX) walk.moved = true;
      lean(e.clientX - walk.sx, e.clientY - walk.sy);
    } else if (turn && e.pointerId === turn.id){
      if (Math.hypot(e.clientX - turn.sx, e.clientY - turn.sy) > TAP_PX) turn.moved = true;
      look((e.clientX - turn.x) * LOOK, (e.clientY - turn.y) * LOOK);
      turn.x = e.clientX; turn.y = e.clientY;
    }
  });
  const lift = e => {
    const t = walk && e.pointerId === walk.id ? walk : turn && e.pointerId === turn.id ? turn : null;
    if (!t) return;
    if (t === walk){ walk = null; lean(0, 0); base.classList.remove('on'); } else turn = null;
    if (e.type === 'pointerup' && !t.moved && e.timeStamp - t.t0 < TAP_MS) tap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  document.addEventListener('pointerup', wake, { capture: true, passive: true });   // (iOS counts a lift as a gesture, not a press)

  return {
    // main.js, each frame: is the world what's in front of you, or is a panel up?
    setFree(on){
      if (on === free) return;
      free = on;
      if (!on) letGo();                                    // a panel opening under a held thumb mustn't keep you walking
      document.documentElement.classList.toggle('free', on);
      close.classList.toggle('hide', on);
    },
    setUse(label){
      if (use.textContent === (label || '')) return;
      use.textContent = label || '';
      use.classList.toggle('hide', !label);
    },
    setScope(on){ glass.classList.toggle('hide', !on); },
  };
}
