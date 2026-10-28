// journal-view.js — the journal (js/journal.js) as a page of your own book, on the same
// foxed paper as the old books' pages (page.css): what's in hand at the top, then the
// days, newest first, each entry led by the time of day it began.

import { ensureCss } from './page.js';

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const dayName = d => d < ORD.length ? `The ${ORD[d]} day` : `Day ${d + 1}`;

// onClose: called after it's shut (to take the look back)
export function journalView(journal, { onClose }){
  let overlay = null;

  function open(){
    ensureCss();
    journal.read();
    overlay = document.createElement('div'); overlay.id = 'page-overlay'; overlay.className = 'journal';
    const tasks = journal.tasks(), days = journal.days();
    overlay.innerHTML = `<div class="old-page journal-page"><h2 class="page-title">My Journal</h2>` +
      (tasks.length ? `<div class="journal-hand"><div class="journal-head">In hand</div><ul>${tasks.map(k => `<li>${esc(k.text)}</li>`).join('')}</ul></div>` : '') +
      (days.length ? days.map(d => `<div class="journal-day">${dayName(d.day)}</div>` +
        d.entries.map(e => `<p><span class="journal-when">${esc(e.when)}.</span> ${esc(e.text)}</p>`).join('')).join('')
        : '<p class="journal-none">Nothing written yet. What I find, and who I meet that comes to anything, goes here.</p>') +
      `<div class="page-close">Close the journal.</div></div>` +
      `<div class="page-aside">J or Esc to close</div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.page-close').onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  }
  function close(){
    if (!overlay) return;
    overlay.remove(); overlay = null;
    onClose?.();
  }
  return { open, close, get isOpen(){ return !!overlay; } };
}
