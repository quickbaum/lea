// place-sign.js — the sign with the place's name, hung on chains from the top of the window
// (#place, its art in sprites/hud/sign.png). A new place pulls this one up out of sight and drops
// the next: it falls, the chains catch it with a small bounce, and it settles with a slight sway.
// Only transforms are animated, so the browser can run it off the game's busy main thread.

const PULL_MS = 240, FALL_MS = 300, SETTLE_MS = 1500, STEP_MS = 30;
const HOLD_MS = 500;           // a new place must last this long, so a walk along a border doesn't flap the sign
const BOUNCE = 6, BOUNCE_HZ = 3, BOUNCE_DAMP = 6;      // px on the desktop sign (scaled with it); the peak's about half this
const SWAY = .6, SWAY_HZ = 1.1, SWAY_DAMP = 2.6;       // degrees about the pivot well above the window (index.html)

export function placeSign(el){
  const words = el.querySelector('span');
  let shown = null, want = null, holding = 0, pulling = false, anim = null, side = 1;

  // the plank's a fixed size, so a long name is lettered smaller
  function fit(){
    words.style.fontSize = '';
    const r = document.createRange(); r.selectNodeContents(words);
    const w = r.getBoundingClientRect().width, room = words.clientWidth;
    if (w > room) words.style.fontSize = `${Math.floor(parseFloat(getComputedStyle(words).fontSize) * room / w * 2) / 2}px`;
  }
  function letter(){
    shown = want;
    words.textContent = shown;
    fit();
    document.fonts?.load(`22px ${getComputedStyle(words).fontFamily}`).then(fit);
  }
  const above = () => el.offsetTop + el.offsetHeight + 8;   // clear of the window
  function drop(){
    anim?.cancel();
    const h = above(), k = el.offsetHeight / 73, all = FALL_MS + SETTLE_MS, frames = [];
    side = -side;
    for (let t = 0; t <= FALL_MS; t += STEP_MS){
      const f = t / FALL_MS;
      frames.push({ offset: t / all, transform: `translateY(${(-h * (1 - f * f)).toFixed(2)}px) rotate(0deg)` });
    }
    for (let t = STEP_MS; t < SETTLE_MS; t += STEP_MS){
      const s = t / 1000;
      const y = k * BOUNCE * Math.exp(-BOUNCE_DAMP * s) * Math.sin(2 * Math.PI * BOUNCE_HZ * s);
      const r = side * SWAY * Math.exp(-SWAY_DAMP * s) * Math.sin(2 * Math.PI * SWAY_HZ * s);
      frames.push({ offset: (FALL_MS + t) / all, transform: `translateY(${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg)` });
    }
    frames.push({ offset: 1, transform: 'translateY(0px) rotate(0deg)' });
    anim = el.animate(frames, { duration: all, easing: 'linear' });
  }
  function pull(){
    if (pulling || want === shown) return;
    pulling = true;
    const from = getComputedStyle(el).transform;     // from wherever it is, if it's still settling
    anim?.cancel();
    anim = el.animate([{ transform: from }, { transform: `translateY(${-above()}px)` }],
      { duration: PULL_MS, easing: 'cubic-bezier(.55,0,.9,.6)', fill: 'forwards' });
    anim.onfinish = () => { pulling = false; letter(); drop(); };   // whatever's wanted by now
  }
  // wait: how long the place must last first. 0 for a change that's already certain, like going underground
  function show(name, wait = HOLD_MS){
    want = name;
    clearTimeout(holding);
    if (shown === null){ el.classList.remove('hide'); letter(); drop(); return; }   // play has begun
    holding = setTimeout(pull, wait);
  }
  return { show };
}
