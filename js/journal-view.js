// journal-view.js — the journal (js/journal.js) as blocks for your own book (js/book-view.js): the
// days, oldest first as a diary reads, each entry led by the time of day it began, and what's
// in hand after the latest, where J opens the book.

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const dayName = d => d < ORD.length ? `The ${ORD[d]} day` : `Day ${d + 1}`;

export function journalBlocks(journal, link = t => t){     // link: escaped text → the same with known names as links
  const out = [];
  for (const d of [...journal.days()].reverse()){
    out.push(`<div class="bp-h keep">${dayName(d.day)}</div>`);
    for (const e of d.entries) out.push(`<p class="jentry"><span class="when">${esc(e.when)}.</span> ${link(esc(e.text))}</p>`);
  }
  const tasks = journal.tasks();
  if (tasks.length) out.push(`<div class="jhand"><div class="bp-h">In hand</div><ul>${tasks.map(k => `<li>${link(esc(k.text))}</li>`).join('')}</ul></div>`);
  return out;
}
