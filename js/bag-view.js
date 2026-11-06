// bag-view.js — the backpack on the HUD, from the design board (mocks/backpack_1.psd; art in sprites/hud,
// cut by tools/cut_bag.py). Click it for the pack: it flips open, rises and fades as the pack's card
// fades in where it was, and closing runs that backwards. What you pick up flies to it and drops in
// between the body and the flap, so the flap is what hides it; while the card's up there's no bag to
// fly to, and it just turns up in the card. Where the bag sits is index.html's #bag.

import { ingredient } from './ingredients.js';

// opening: hold on the open bag, then it goes up and out as the card comes in. Closing is quicker.
const HOLD = 150, CROSS = 260, BACK = 180, RISE = 28;

const pic = (src, cls) => { const i = new Image(); i.src = src; i.className = cls; i.alt = ''; i.draggable = false; return i; };

export function bagView({ onClick }){
  const el = document.createElement('div');
  el.id = 'bag'; el.title = 'Your pack (I)'; el.className = 'hide';
  const flap = pic('sprites/hud/bag-flap.png', 'flap');
  el.append(pic('sprites/hud/bag-back.png', 'back'), pic('sprites/hud/bag-open.png', 'open-back'), flap);
  el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  document.body.appendChild(el);

  // the thing itself: its picture, or for what has none yet, its box from the pack
  function token(kind, n){
    const e = ingredient(kind) || {};
    if (e.pic) return pic((n > 1 && e.pic[1]) || e.pic[0], 'bag-item');
    const t = document.createElement('div');
    t.className = 'bag-item box'; t.textContent = e.label || kind; t.style.setProperty('--tint', e.color || '#8a7a50');
    return t;
  }

  // from {x, y} on the screen: an arc that comes down onto the top of the bag, over everything...
  function receive(kind, n, from){
    const b = el.getBoundingClientRect();
    if (!b.width || el.classList.contains('open')) return;   // no bag on the screen: nothing to fly to
    const end = Math.max(14, Math.min(36, b.width * .2));   // its size as it goes in
    const x = b.left + b.width / 2, y = b.top + b.height * .05 - end / 2;    // its middle, on the flap's top edge
    const cx = x, cy = y - Math.max(25, b.height * .35);    // straight above, so it falls in
    const it = token(kind, n);
    Object.assign(it.style, { left: `${x - end / 2}px`, top: `${y - end / 2}px`, width: `${end}px`, height: `${end}px` });
    document.body.appendChild(it);
    const frames = [];
    for (let i = 0; i <= 16; i++){
      const t = i / 16, u = 1 - t, s = 1 + .5 * u;
      const px = u * u * from.x + 2 * u * t * cx + t * t * x, py = u * u * from.y + 2 * u * t * cy + t * t * y;
      frames.push({ transform: `translate(${(px - x).toFixed(1)}px,${(py - y).toFixed(1)}px) scale(${s.toFixed(3)})` });
    }
    it.animate(frames, { duration: 560, easing: 'cubic-bezier(.35,.1,.6,1)' }).finished.then(() => dropIn(it, end, b), () => it.remove());
  }
  // ...and then into the bag's own stack, behind the flap, which lifts for it and settles
  function dropIn(it, end, b){
    it.classList.add('in');
    Object.assign(it.style, { left: `${(b.width - end) / 2}px`, top: `${b.height * .05 - end}px` });
    el.insertBefore(it, flap);
    const lift = Math.max(2, b.height * .025);
    flap.animate([{ transform: 'none' }, { transform: `translateY(${-lift}px) scaleY(.97)`, offset: .35 }, { transform: 'none' }], { duration: 300, easing: 'ease-out' });
    it.animate({ transform: `translateY(${end + b.height * .06}px)` }, { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished.then(() => {
      it.remove();
      el.animate([{ transform: 'none' }, { transform: 'scale(1.025,.975)', offset: .4 }, { transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }, () => it.remove());
  }

  // the card in the bag's place: down in the corner under the ring, over the book. A window too short
  // for that puts it left of the ring instead. (16: room for its X, which hangs over the corner)
  function placeCard(panel){
    const ring = document.getElementById('vitals')?.getBoundingClientRect(), w = panel.offsetWidth, h = panel.offsetHeight;
    const top = innerHeight - h - 4;
    if (ring && top < ring.bottom - 5) return placeBeside(panel);
    Object.assign(panel.style, { left: `${Math.max(8, innerWidth - w - 16)}px`, top: `${top}px`, bottom: 'auto' });
  }
  // beside where the bag sits, level with it, on the screen, and clear of the ring and the book. (offset*, not
  // a rect: the bag's own animation mustn't move the card.) (14: room for its X, which hangs over the corner)
  function placeBeside(panel){
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const top = Math.max(14, Math.min(innerHeight - h - 8, el.offsetTop + el.offsetHeight / 2 - h / 2));
    let right = el.offsetLeft - 8;
    for (const o of [document.getElementById('vitals'), document.querySelector('.book-icon')]){
      const r = o?.getBoundingClientRect();
      if (r?.width && r.top < top + h && r.bottom > top && r.left < right) right = r.left - 8;
    }
    Object.assign(panel.style, { left: `${Math.max(8, right - w)}px`, top: `${top}px`, bottom: 'auto' });
  }

  // the bag into the card and back. Whatever's still running gives way, so a quick I-I can't leave either half-done.
  let running = [], shutTimer = 0;
  const run = (target, frames, opts) => { const a = target.animate(frames, opts); running.push(a); return a; };
  const stop = () => { clearTimeout(shutTimer); running.forEach(a => a.cancel()); running = []; };
  const out = { opacity: 0, transform: `translateY(${-RISE}px)` }, here = { opacity: 1, transform: 'none' };

  function openInto(panel){
    stop();
    panel.classList.remove('hide'); panel.style.pointerEvents = '';
    el.classList.remove('gone'); el.classList.add('open');
    run(el, [here, out], { delay: HOLD, duration: CROSS, easing: 'ease-in', fill: 'both' }).onfinish = () => el.classList.add('gone');
    run(panel, [{ opacity: 0, transform: 'translateY(10px)' }, here], { delay: HOLD, duration: CROSS, easing: 'ease-out', fill: 'backwards' });
  }
  function closeFrom(panel){
    stop();
    panel.style.pointerEvents = 'none';
    el.classList.remove('gone');
    run(panel, [here, { opacity: 0, transform: 'translateY(10px)' }], { duration: BACK, easing: 'ease-in', fill: 'forwards' }).onfinish = () => {
      panel.classList.add('hide'); panel.style.pointerEvents = '';
    };
    run(el, [out, here], { duration: BACK, easing: 'ease-out', fill: 'backwards' }).onfinish = () => {
      shutTimer = setTimeout(() => el.classList.remove('open'), HOLD / 2);
    };
  }

  return { el, receive, placeCard, placeBeside, openInto, closeFrom };
}
