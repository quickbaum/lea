// page.js — a page of an old book, read up close (the crypts' bookshelves). Not a talk:
// the page is the thing itself, printed text on foxed paper, and anything a later reader
// scrawled on it goes in the margin in their own hand and ink. What the game wants to tell
// you about reading it (e.g. "you copy it out") sits outside the page, under it.
//   readPage({ book, title, body: [para, …], margins: [note, …], paper, aside, close, onClose })
// `paper` 'vellum' is a Faerie book's: fine calfskin, gilt-ruled, in another type (page.css).

export function ensureCss(){
  if (document.getElementById('page-css')) return;
  const el = document.createElement('link');
  el.id = 'page-css'; el.rel = 'stylesheet'; el.href = 'page.css';
  document.head.appendChild(el);
}

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function readPage({ book, title, body = [], margins = [], paper, aside, close = 'Close the book.', onClose } = {}){
  ensureCss();
  const overlay = el('div'); overlay.id = 'page-overlay';
  const page = el('div', ['old-page', paper, paper && !margins.length && 'bare'].filter(Boolean).join(' '));
  page.lang = 'en';   // so hyphens: auto can break the long justified lines
  if (book) page.appendChild(el('div', 'page-running', book));
  if (title) page.appendChild(el('h2', 'page-title', title));
  body.forEach((p, i) => page.appendChild(el('p', i ? '' : 'page-first', p)));
  margins.forEach((m, i) => { const n = el('div', 'page-margin', m); n.style.setProperty('--i', i); page.appendChild(n); });
  const shut = el('div', 'page-close', close);
  page.appendChild(shut);
  overlay.appendChild(page);
  if (aside) overlay.appendChild(el('div', 'page-aside', aside));
  document.body.appendChild(overlay);

  function done(){ overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); }
  function onKey(e){ if (e.key === 'Escape') done(); }
  document.addEventListener('keydown', onKey);
  shut.onclick = done;
  overlay.addEventListener('click', e => { if (e.target === overlay) done(); });
}
