// page.js — a page of an old book, read up close (the crypts' bookshelves). Not a talk:
// the page is the thing itself, printed text on foxed paper, and anything a later reader
// scrawled on it goes in the margin in their own hand and ink. What the game wants to tell
// you about reading it (e.g. "you copy it out") sits outside the page, under it.
//   readPage({ book, title, body: [para, …], verse, margins: [note, …], tunes, paper, aside, actions, close, onClose })
// `verse`: a poem in place of (or before) the body, its lines kept as written ('\n' between).
// `paper` 'vellum' is a Faerie book's: fine calfskin, gilt-ruled, in another type (page.css).
// `tunes`: a music book's, [{ title, about, svg, play }], each under its own heading, drawn on the
// staff (js/notation.js). With `play(midi, secs)` (an instrument in the pack), a note sounds
// when you click it, and dragging across the staff plays each note you pass; a note glows
// while it sounds. `actions`: [{ label, run }], what you can do with it, set under the
// page beside the aside (it's the game's, not the book's): "Play it on your fiddle".

export function ensureCss(){
  if (document.getElementById('page-css')) return;
  const el = document.createElement('link');
  el.id = 'page-css'; el.rel = 'stylesheet'; el.href = 'page.css';
  document.head.appendChild(el);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function readPage({ book, title, body = [], verse, margins = [], tunes = [], paper, aside, actions = [], close = 'Close the book.', onClose } = {}){
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
  const shut = el('div', 'page-close', close);
  page.appendChild(shut);
  overlay.appendChild(page);
  if (aside) overlay.appendChild(el('div', 'page-aside', aside));
  for (const a of actions){ const b = el('div', 'page-aside page-action', a.label); b.onclick = () => a.run(b); overlay.appendChild(b); }
  document.body.appendChild(overlay);

  function done(){ overlay.querySelectorAll('.page-staff').forEach(f => f._unbind?.()); overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); }
  function onKey(e){ if (e.key === 'Escape') done(); }
  document.addEventListener('keydown', onKey);
  shut.onclick = done;
  overlay.addEventListener('click', e => { if (e.target === overlay) done(); });
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
