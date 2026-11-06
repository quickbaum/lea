// page.js — a page of an old book, read up close (the crypts' bookshelves). Not a talk:
// the page is the thing itself, printed text on foxed paper, and anything a later reader
// scrawled on it goes in the margin in their own hand and ink. What you can do with it sits
// outside the page, under it.
//   readPage({ book, title, body: [para, …], verse, margins: [note, …], tunes, paper, actions, from, into, onClose })
// `verse`: a poem in place of (or before) the body, its lines kept as written ('\n' between).
// `paper` 'vellum' is a Faerie book's: fine calfskin, gilt-ruled, in another type (page.css).
// `tunes`: a music book's, [{ title, about, svg, play }], each under its own heading, drawn on the
// staff (js/notation.js). With `play(midi, secs)` (an instrument in the pack), a note sounds
// when you click it, and dragging across the staff plays each note you pass; a note glows
// while it sounds. `actions`: [{ label, run }], what you can do with it, set under the
// page (it's the game's, not the book's): "Play it on your fiddle".
// `from`: { x, y } on the screen, where the page flies out of as it opens (the shelf).
// `into(el)`: you copied this page, so shutting it sends the page there (book-view.js receive), a
// promise for when it's landed. You have the world back at once, while it flies.

import { closeX, pinX } from './close-x.js';

export function ensureCss(){
  if (document.getElementById('page-css')) return;
  const el = document.createElement('link');
  el.id = 'page-css'; el.rel = 'stylesheet'; el.href = 'page.css';
  document.head.appendChild(el);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function readPage({ book, title, body = [], verse, margins = [], tunes = [], paper, actions = [], from, into, onClose } = {}){
  ensureCss();
  const overlay = el('div'); overlay.id = 'page-overlay';
  const page = el('div', ['old-page', paper, (paper || tunes.length) && !margins.length && 'bare'].filter(Boolean).join(' '));
  page.lang = 'en';   // so hyphens: auto can break the long justified lines
  if (book) page.appendChild(el('div', 'page-running', book));
  if (title) page.appendChild(el('h2', 'page-title', title));
  if (verse) page.appendChild(el('p', 'page-verse', verse));
  body.forEach((p, i) => page.appendChild(el('p', i ? '' : 'page-first', p)));
  for (const t of tunes){
    page.appendChild(el('h3', 'page-tune', t.title));
    if (t.about) page.appendChild(el('p', 'page-first', t.about));
    const fig = el('div', 'page-staff'); fig.innerHTML = t.svg; page.appendChild(fig);
    if (t.play) playable(fig, t.play);
  }
  margins.forEach((m, i) => { const n = el('div', 'page-margin', m); n.style.setProperty('--i', i); page.appendChild(n); });
  overlay.appendChild(page);
  for (const a of actions){ const b = el('div', 'page-aside page-action', a.label); b.onclick = () => a.run(b); overlay.appendChild(b); }
  document.body.appendChild(overlay);
  const x = closeX(done); pinX(x, page, overlay);
  if (from) flyOut(overlay, page, from);

  function done(){
    overlay.querySelectorAll('.page-staff').forEach(f => f._unbind?.());
    x.remove();
    document.removeEventListener('keydown', onKey);
    if (into){
      overlay.getAnimations({ subtree: true }).forEach(a => a.finish());                         // shut while still arriving: it leaves from where it was going
      overlay.style.pointerEvents = 'none';
      overlay.querySelectorAll('.page-aside').forEach(a => { a.style.visibility = 'hidden'; });   // hidden, not removed: the page mustn't jump
      overlay.animate({ background: 'transparent' }, { duration: 250, fill: 'forwards' });
      into(page).then(() => overlay.remove());
    } else overlay.remove();
    if (onClose) onClose();
  }
  function onKey(e){ if (e.key === 'Escape') done(); }
  document.addEventListener('keydown', onKey);
}

// the page comes out of the shelf, small and turned, and up to where you read it; the dimness and
// what's under the page come on around it
function flyOut(overlay, page, from){
  const r = page.getBoundingClientRect(), dx = from.x - (r.left + r.width / 2), dy = from.y - (r.top + r.height / 2);
  const ms = 420;
  page.animate({ transform: `translate(${dx}px, ${dy}px) scale(.06) rotate(10deg)`, offset: 0 }, { duration: ms, easing: 'cubic-bezier(.2, .7, .25, 1)' });
  page.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }], { duration: ms });
  overlay.animate({ background: 'transparent', offset: 0 }, { duration: ms });
  overlay.querySelectorAll('.page-aside, .close-x').forEach(a => a.animate([{ opacity: 0 }, { opacity: 0, offset: .7 }, { opacity: 1 }], { duration: ms }));
}

// a staff you can play: press on a note to sound it, drag to sound each one you pass over
// (hit-tested by position, so a finger works as well as a mouse)
function playable(fig, play){
  fig.classList.add('playable');
  let down = false, last = null;
  const sound = g => {
    if (!g || g === last) return;
    last = g;
    const secs = Math.min(1.5, Math.max(0.25, +g.dataset.dur));
    play(+g.dataset.midi, secs);
    g.classList.add('sounding');
    clearTimeout(g._off); g._off = setTimeout(() => g.classList.remove('sounding'), secs * 1000);
  };
  const at = e => document.elementFromPoint(e.clientX, e.clientY)?.closest('.page-staff .note');
  fig.addEventListener('pointerdown', e => { down = true; last = null; e.preventDefault(); sound(at(e)); });
  fig.addEventListener('pointermove', e => { if (down) sound(at(e)); });
  const up = () => { down = false; last = null; };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  fig._unbind = () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
}
