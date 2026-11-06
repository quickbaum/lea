// person-view.js — a person's page in your book (Folk section; docs/skeletons.md, "A person's page"):
// a face, what you know of them, their people, and what you have to do with them. mail.js
// personRecord says what's known; this only draws it. A link is `data-goto`, an anchor book-view.js flips to.

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// the dead have no faces: their own skull and jaw, off the skeleton's atlas (sprites/skeleton/). Made once.
let SKULL = null;
export function loadSkull(){
  if (SKULL) return;
  const im = new Image();
  im.onload = () => {
    const cv = document.createElement('canvas'); cv.width = 90; cv.height = 115;
    const g = cv.getContext('2d');
    g.drawImage(im, 142, 223, 90, 96, 0, 0, 90, 96);        // the skull
    g.drawImage(im, 39, 332, 66, 47, 11, 68, 66, 47);       // the jaw, under it, where the rig has it
    SKULL = cv.toDataURL();
  };
  im.src = new URL('../sprites/skeleton/atlas.png', import.meta.url).href;
}

const section = (title, html) => `<div class="pp-sec"><div class="bp-h keep">${esc(title)}</div>${html}</div>`;

// the page's blocks: `link` turns known names in a sentence into links
export function personBlocks(r, link = esc){
  const face = r.dead ? (SKULL ? `<img class="pp-face pp-skull" src="${SKULL}" alt="">` : '')
    : r.face ? `<img class="pp-face" src="${r.face}" alt=""${r.faceBg ? ` style="background-image:${esc(r.faceBg)}"` : ''}>` : '';
  const back = r.line ? `<a class="person-link pp-back" data-goto="line:${esc(r.line)}">The ${esc(r.line)} line</a>` : '';
  const out = [`<div class="pp-head keep bp-newpage" data-anchor="${esc(r.id)}">${face}<div class="pp-name">${esc(r.name)}</div>${back}</div>`];
  if (r.facts.length) out.push(`<ul class="pp-list">${r.facts.map(f => `<li>${link(esc(f))}</li>`).join('')}</ul>`);
  if (r.people.length) out.push(section('Their people', `<ul class="pp-list">${r.people.map(p => `<li><span class="pp-rel">${esc(p.rel)}:</span> ${p.id ? `<a class="person-link" data-goto="${esc(p.id)}">${esc(p.name)}</a>` : esc(p.name)}</li>`).join('')}</ul>`));
  if (r.quests.length) out.push(section('In hand', `<ul class="pp-list">${r.quests.map(q => `<li>${link(esc(q))}</li>`).join('')}</ul>`));
  if (r.done.length) out.push(section('Done', `<ul class="pp-list">${r.done.map(q => `<li>${link(esc(q))}</li>`).join('')}</ul>`));
  return out;
}
