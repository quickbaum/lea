// book-view.js — your own book, open in front of you: two pages at a time in a shaped leather
// binding, seen from a little way down so you see its thickness; a banner for each section,
// growing from under the top page's fore-edge, in section order wherever you are (the one
// you're in sits indented);
// and leaves that turn in 3D, bending as they go, or riffle when you jump by a tab. The look
// is the board in mocks/book notes.psd; the drawn parts are js/book-art.js.
//
//   const book = makeBook({ sections, onClose, onSection })   onSection(id): whenever you come to rest in a section
//   book.open(id, { at: 'start' | 'end' })   open at a section (its first or last spread)
//   book.refresh()                            lay the pages out again, staying where you are
//   book.key(e)                               a keydown while open; true if the book took it
//   book.say(text)                            a word under the book, for a moment
//   book.close(); book.isOpen
//
// sections: [{ id, title, tab, bare, sub, empty, blocks: () => [Node | html] }]
// `tab` is its hand-drawn banner, sprites/book/tab-<tab>.png. `bare`: no title on its first page, so a
// grid of plates lines up across both pages. The book flows a section's blocks onto as many pages as they need
// (measured, at the size the book is now), and starts each section on a left-hand page. A
// block with class `keep` isn't left alone at the foot of a page (a heading goes over with what
// it heads). Hovering anything with `data-desc` writes it at the foot of its page, in place of
// the page number.
//
// The book stands clear of the spell points and stamina (#vitals, raised over the overlay by
// book.css), so you can see them while you read.
//
// The turning leaf is a strip of hinged slices (each a clone of the two pages it carries,
// cut to its share), so it can bend; the live pages are only ever the two lying open, so
// anything clickable on them keeps working. Styles in book.css; the paper's fonts in page.css.

import { ensureCss } from './page.js';
import { drawCover, drawSheets, drawCrease, makePapers, dipTop, FOOT_LIP, CORNER_R } from './book-art.js';

const SLICES = 6;          // hinged slices across a turning leaf
const BEND = 7;            // degrees each slice lags the one before, at the height of a turn
const TURN_MS = 680, RIFFLE_MS = 520, RIFFLE_GAP = 85, RIFFLE_MAX = 6;
const TAB_H = .14, TAB_W = .205, TAB_STEP = .152, TAB_ROOT = -8;   // a tab's size and spacing, of the page's height; its inner end, px from the page's box (tucked under the top page)
const HINT = '← → or a folded corner to turn · a tab for its section · Esc to close';
const PAD = 90;                                    // px round the drawn parts, for their shadows

function ensureBookCss(){
  ensureCss();
  if (document.getElementById('book-css')) return;
  const el = document.createElement('link');
  el.id = 'book-css'; el.rel = 'stylesheet'; el.href = new URL('../book.css', import.meta.url).href;
  document.head.appendChild(el);
}

const div = (cls, html) => { const e = document.createElement('div'); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ease = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export function makeBook({ sections, onClose, onSection }){
  let overlay = null, bookEl, pagesEl, slotL, slotR, coverCv, sheetsCv, ribbonsEl, measureEl, asideEl;
  let geo = null, papers = null, paperKey = '', ready = null, creases = [], sayT = 0;
  let pages = [], starts = {}, spread = 0, busy = false, pending = null;
  let anchor = null;        // 'start' | 'end' of its section, as opened; once you turn, where you've turned to

  // ---- laying out: the book's size from the window, then each section flowed onto pages
  function size(){
    const vw = innerWidth, vh = innerHeight;
    const small = vh < 520 || vw < 640;   // a phone: the book takes the whole screen, its asides gone
    overlay.classList.toggle('small', small);
    const lipY = small ? 14 : 34, lipX = Math.round(lipY * 1.15);
    // the room left of the spell points, which stay in sight beside the book
    const v = document.getElementById('vitals')?.getBoundingClientRect();
    const reserve = v && v.width ? vw - v.left + 14 : 0, margin = small ? 4 : 16, avail = vw - reserve - margin * 2;
    // the page, the book's two and the tabs out to the right all scale together
    const ph0 = Math.min(vh - (small ? 70 : 180), 700), aspect = .69;
    const pw = Math.round(Math.min(ph0 * aspect, (avail - lipX - TAB_ROOT) / (2 + TAB_W / aspect))), ph = Math.round(pw / aspect);
    const whole = lipX + 2 * pw + TAB_ROOT + ph * TAB_W;
    const left = margin + Math.max(0, (avail - whole) / 2) + lipX;
    bookEl.style.marginLeft = `${Math.round(left)}px`;
    asideEl.style.marginLeft = `${Math.round(left)}px`;
    for (const [k, v] of Object.entries({ pw, ph, lipx: lipX, lipy: lipY, tabroot: TAB_ROOT })) bookEl.style.setProperty(`--${k}`, `${v}px`);
    asideEl.style.width = `${2 * pw}px`;
    const sag = .6;
    // where the page's outer corner and the board's actually fall, for what's laid on them
    bookEl.style.setProperty('--creasetop', `${Math.round(5 + dipTop(1 - CORNER_R, ph))}px`);
    bookEl.style.setProperty('--sagtop', `${Math.round(sag * dipTop(1, ph))}px`);
    const lipFoot = Math.round(FOOT_LIP(ph));
    bookEl.style.setProperty('--lipfoot', `${lipFoot}px`);
    bookEl.style.marginBottom = `${lipFoot - lipY}px`;   // centred as a whole, its deeper foot included
    const n = sections.length, step = n > 1 ? Math.min(TAB_STEP, (1 - TAB_H) / (n - 1)) : 0;
    bookEl.style.setProperty('--tabstep', `${(step * ph).toFixed(1)}px`);
    bookEl.style.setProperty('--tabtop', `${((1 - TAB_H - step * (n - 1)) / 2 * ph).toFixed(1)}px`);

    geo = { w: pw, h: ph, lipX, lipY, lipFoot, sag, padX: lipX + PAD, padY: Math.max(lipY, lipFoot) + PAD };
    const S = Math.min(devicePixelRatio || 1, 1.5);
    for (const cv of [coverCv, sheetsCv]){
      const cssW = 2 * pw + 2 * geo.padX, cssH = ph + 2 * geo.padY;
      cv.width = Math.round(cssW * S); cv.height = Math.round(cssH * S);
      cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
      cv.style.left = `${-geo.padX}px`; cv.style.top = `${-geo.padY}px`;
    }
    drawCover(coverCv, geo);
    const c = Math.round(pw * .15);
    bookEl.style.setProperty('--crease', `${c}px`);
    for (const [cv, seed] of creases) drawCrease(cv, c, pw, seed);
    return paintPapers(pw, ph);
  }
  // the paper is baked to pictures once a size, so a turning leaf's slices can share them,
  // and kept: opening the book again at the same size costs nothing
  function paintPapers(pw, ph){
    const key = `${pw}x${ph}`;
    if (key !== paperKey){
      paperKey = key;
      ready = makePapers(pw, ph).then(p => {
        if (key !== paperKey){ for (const u of [...p.left, ...p.right]) URL.revokeObjectURL(u); return; }
        const old = papers; papers = p;
        if (old) setTimeout(() => { for (const u of [...old.left, ...old.right]) URL.revokeObjectURL(u); }, 2000);
      });
    }
    return ready = ready.then(() => {
      if (!bookEl || !papers) return;
      for (const [name, url] of [['L0', papers.left[0]], ['L1', papers.left[1]], ['R0', papers.right[0]], ['R1', papers.right[1]]]) bookEl.style.setProperty(`--paper${name}`, `url(${url})`);
    });
  }
  function blankPage(){ const p = newPage(null); p.classList.add('blank'); p.querySelector('.bp-body').appendChild(div('bp-fleuron', '❦')); return p; }
  function newPage(sec){
    const p = div('bpage');
    if (sec) p.dataset.sec = sec.id;
    p.append(div('bp-head', sec ? esc(sec.title) : ''), div('bp-body'), div('bp-foot'));
    return p;
  }
  const toNode = b => typeof b === 'string' ? Object.assign(document.createElement('div'), { innerHTML: b }).firstElementChild || div(null, b) : b;
  function paginate(){
    pages = []; starts = {};
    measureEl.replaceChildren();
    for (const sec of sections){
      if (pages.length % 2) pages.push(blankPage());
      starts[sec.id] = pages.length;
      const blocks = sec.blocks() || [];
      const heads = sec.bare ? [] : [div('bp-title keep', esc(sec.title)), ...(sec.sub ? [div('bp-sub keep', esc(sec.sub))] : [])];
      const all = [...heads, ...(blocks.length ? blocks.map(toNode) : [div('bp-empty', esc(sec.empty || 'Nothing written here yet.'))])];
      let pg = newPage(sec), body = pg.querySelector('.bp-body');
      if (!sec.bare) pg.classList.add('opening');           // its title heads it; no running head over that
      measureEl.appendChild(pg);
      for (const node of all){
        body.appendChild(node);
        if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1){
          node.remove();
          const carry = [];        // a heading left last on the page goes over with what it heads
          while (body.children.length > 1 && body.lastElementChild.classList.contains('keep')) carry.unshift(body.lastElementChild), body.lastElementChild.remove();
          pages.push(pg);
          pg = newPage(sec); body = pg.querySelector('.bp-body'); measureEl.appendChild(pg);
          body.append(...carry, node);
        }
      }
      pages.push(pg);
    }
    if (pages.length % 2) pages.push(blankPage());
    pages.forEach((p, i) => {
      p.classList.add(i % 2 ? 'right' : 'left', `v${(i >> 1) % 2}`);      // two papers, turn about
      p.querySelector('.bp-foot').textContent = i + 1;
      p.querySelector('.bp-foot').dataset.n = i + 1;
      p.remove();
    });
  }
  const spreads = () => pages.length / 2;
  const sectionAt = s => { let cur = sections[0].id; for (const sec of sections) if (starts[sec.id] / 2 <= s) cur = sec.id; return cur; };
  const lastSpreadOf = id => {
    const i = sections.findIndex(s => s.id === id), next = sections[i + 1];
    return (next ? starts[next.id] / 2 : spreads()) - 1;
  };

  // ---- the two pages lying open, the page edges either side, the ribbons
  function show(){
    slotL.replaceChildren(pages[2 * spread]);
    slotR.replaceChildren(pages[2 * spread + 1]);
    slotL.classList.toggle('can', spread > 0);
    slotR.classList.toggle('can', spread < spreads() - 1);
    edges(spread, spread);
    ribbons();
    onSection?.(sectionAt(spread));
  }
  // the sheets under each side: a thicker block the more of the book lies that way
  function edges(sl, sr){
    const n = Math.max(1, spreads() - 1);
    drawSheets(sheetsCv, geo, sl / n, (spreads() - 1 - sr) / n);
  }
  function ribbons(){
    const cur = sectionAt(spread);
    ribbonsEl.replaceChildren(...sections.map((sec, k) => {
      const at = starts[sec.id] / 2;
      const r = div(`ribbon${sec.id === cur ? ' on' : ''}`);
      r.style.setProperty('--k', k);
      r.title = sec.title;
      const im = document.createElement('img');
      im.src = new URL(`../sprites/book/tab-${sec.tab}.png`, import.meta.url).href; im.alt = sec.title; im.draggable = false;
      r.appendChild(im);
      r.onclick = e => { e.stopPropagation(); anchor = null; go(at); };
      return r;
    }));
  }

  // ---- turning: one leaf to the next spread or the last, or a riffle of several to a ribbon's
  function go(t){
    t = Math.max(0, Math.min(spreads() - 1, t));
    if (busy){ pending = t; return; }
    if (t === spread) return;
    const fwd = t > spread, s = spread, L = Math.min(Math.abs(t - s), RIFFLE_MAX);
    busy = true;
    // what lies open under the turning leaves: the side they leave keeps its page, the
    // side they're going to shows the destination's
    slotL.replaceChildren(fwd ? pages[2 * s] : pages[2 * t]);
    slotR.replaceChildren(fwd ? pages[2 * t + 1] : pages[2 * s + 1]);
    slotL.classList.remove('can'); slotR.classList.remove('can');
    edges(fwd ? s : t, fwd ? t : s);
    const leaves = [];
    for (let j = 0; j < L; j++){
      const u = fwd ? t - L + j : t + L - 1 - j;
      let front = 2 * u + 1, back = 2 * u + 2;
      if (j === 0){ if (fwd) front = 2 * s + 1; else back = 2 * s; }
      leaves.push(leaf(pages[front], pages[back], fwd));
    }
    const dur = L > 1 ? RIFFLE_MS : TURN_MS, gap = L > 1 ? RIFFLE_GAP : 0, t0 = performance.now();
    const under = fwd ? slotR : slotL;          // the page a leaf is lifted off, shadowed by it
    const land = fwd ? slotL : slotR;
    function frame(now){
      let done = true, lift = 0;
      leaves.forEach((lf, j) => {
        const p = Math.max(0, Math.min(1, (now - t0 - j * gap) / dur));
        if (p < 1) done = false;
        pose(lf, p, fwd, j, L);
        lift = Math.max(lift, Math.sin(Math.PI * p));
      });
      under.style.setProperty('--cast', (lift * .32).toFixed(3));
      land.style.setProperty('--cast', (lift * .22).toFixed(3));
      if (!done) return requestAnimationFrame(frame);
      leaves.forEach(lf => lf.el.remove());
      under.style.setProperty('--cast', 0); land.style.setProperty('--cast', 0);
      spread = t; busy = false; show();
      if (pending != null){ const p = pending; pending = null; go(p); }
    }
    requestAnimationFrame(frame);
  }
  // a leaf of SLICES hinged slices, each carrying its share of the leaf's two pages
  function leaf(frontPage, backPage, fwd){
    const el = div('bleaf'), slices = [];
    let parent = el;
    for (let i = 0; i < SLICES; i++){
      const sl = div('slice'); sl.style.setProperty('--i', i);
      const f = div('face front'), b = div('face back');
      const fc = clone(frontPage), bc = clone(backPage);
      fc.style.left = `calc(var(--pw) * ${-i / SLICES})`;
      bc.style.left = `calc(var(--pw) * ${-(SLICES - 1 - i) / SLICES})`;
      // the slice's shade, inside the page so it can be cut to the paper's shape
      const sf = div('shade'), sb = div('shade rev');
      sf.style.setProperty('--x', i / SLICES); sb.style.setProperty('--x', (SLICES - 1 - i) / SLICES);
      fc.appendChild(sf); bc.appendChild(sb);
      f.appendChild(fc); b.appendChild(bc);
      sl.append(f, b);
      parent.appendChild(sl); parent = sl; slices.push(sl);
    }
    pagesEl.appendChild(el);
    return { el, slices, fwd };
  }
  // a page's copy for a slice; cloneNode leaves a canvas blank, so its picture is copied over
  function clone(page){
    const c = page.cloneNode(true), src = page.querySelectorAll('canvas');
    c.querySelectorAll('canvas').forEach((cv, i) => cv.getContext('2d').drawImage(src[i], 0, 0));
    return c;
  }
  function pose(lf, p, fwd, j, L){
    const e = ease(p), a = fwd ? -180 * e : -180 * (1 - e);
    // the free edge lags the spine through the air, most at the height of the turn
    const bend = (fwd ? 1 : -1) * BEND * Math.sin(Math.PI * p);
    lf.el.style.transform = `rotateY(${a}deg)`;
    // stacking: on the side it starts from, the first to go is on top; once over, the last
    lf.el.style.zIndex = (fwd ? a > -90 : a < -90) ? 10 + L - j : 100 + j;      // always over the shadow it casts
    // light from in front: going edge-on darkens. Each slice runs from the shade at one hinge to
    // the shade at the next, so the sheet reads as a curve, not as boards
    const shade = i => (0.55 * (1 - Math.abs(Math.cos((a + i * bend) * Math.PI / 180)))).toFixed(3);
    lf.slices.forEach((sl, i) => {
      if (i) sl.style.transform = `rotateY(${bend}deg)`;
      sl.style.setProperty('--s0', shade(i)); sl.style.setProperty('--s1', shade(i + 1));
    });
  }

  // ---- open, close, keys
  // already open, it turns there (C with the journal open riffles back to the spells)
  function open(id = sections[0].id, { at = 'start' } = {}){
    const target = () => at === 'end' ? lastSpreadOf(id) : starts[id] / 2;
    if (overlay){ anchor = null; go(target()); return; }
    anchor = at;
    ensureBookCss(); build();
    const art = size(); paginate();
    spread = target();
    show();
    // shown once the paper's baked and the book's own type is in (it's measured again in that)
    const shown = overlay;
    Promise.all([art, document.fonts?.ready]).then(() => {
      if (overlay !== shown) return;
      if (!busy) refresh();
      overlay.classList.add('ready');
    });
  }
  function build(){
    overlay = div(null); overlay.id = 'book-overlay';
    document.body.classList.add('book-open');
    bookEl = div('book');
    const cover = div('book-cover');
    coverCv = document.createElement('canvas'); coverCv.className = 'book-art';
    sheetsCv = document.createElement('canvas'); sheetsCv.className = 'book-art';
    // hand-drawn corners will go here; the brass stands in till then
    const corners = ['tl', 'tr', 'bl', 'br'].map(c => div(`corner ${c}`));
    ribbonsEl = div('book-ribbons');
    pagesEl = div('book-pages');
    slotL = div('slot left'); slotR = div('slot right');
    const cornerL = div('turn left'), cornerR = div('turn right');
    cornerL.onclick = e => { e.stopPropagation(); anchor = null; go(spread - 1); };
    cornerR.onclick = e => { e.stopPropagation(); anchor = null; go(spread + 1); };
    creases = [[document.createElement('canvas'), 61], [document.createElement('canvas'), 62]];
    cornerL.appendChild(creases[0][0]); cornerR.appendChild(creases[1][0]);
    slotL.appendChild(cornerL); slotR.appendChild(cornerR);
    // the corners sit over the page, so slot children are kept apart from them
    const keepCorner = (slot, corner) => { const rc = slot.replaceChildren.bind(slot); slot.replaceChildren = (...n) => rc(...n, corner); };
    keepCorner(slotL, cornerL); keepCorner(slotR, cornerR);
    pagesEl.append(slotL, slotR);
    bookEl.append(cover, coverCv, ...corners, sheetsCv, ribbonsEl, pagesEl);   // the tabs lie on the sheets, under the top page
    measureEl = div('book-measure');
    bookEl.appendChild(measureEl);
    asideEl = div('book-aside'); asideEl.textContent = HINT;
    overlay.append(bookEl, asideEl);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    // what a thing on the page is, written at the page's foot while you point at it
    overlay.addEventListener('mouseover', e => {
      const d = e.target.closest?.('[data-desc]'), pg = e.target.closest?.('.bpage');
      if (!pg) return;
      const foot = pg.querySelector('.bp-foot');
      foot.textContent = d ? d.dataset.desc : foot.dataset.n;
      foot.classList.toggle('desc', !!d);
    });
    addEventListener('resize', onResize);
  }
  function onResize(){ if (overlay && !busy) refresh(); }
  function refresh(){
    if (!overlay) return;
    // where you were: the start or end of the section you opened at, or as far into it as you'd turned
    const sec = sectionAt(spread), off = spread - starts[sec] / 2;
    size(); paginate();
    spread = anchor === 'end' ? lastSpreadOf(sec) : anchor === 'start' ? starts[sec] / 2 : Math.min(starts[sec] / 2 + off, lastSpreadOf(sec));
    show();
  }
  function key(e){
    if (!overlay) return false;
    if (e.code === 'ArrowRight' || e.code === 'PageDown'){ anchor = null; go((pending ?? spread) + 1); return true; }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp'){ anchor = null; go((pending ?? spread) - 1); return true; }
    return false;
  }
  function close(){
    if (!overlay) return;
    removeEventListener('resize', onResize);
    overlay.remove(); overlay = null; busy = false; pending = null;
    document.body.classList.remove('book-open');
    onClose?.();
  }
  function say(text){
    if (!overlay || !text) return;
    asideEl.textContent = text;
    clearTimeout(sayT); sayT = setTimeout(() => { if (asideEl) asideEl.textContent = HINT; }, 3200);
  }
  return { open, close, refresh, key, say, get isOpen(){ return !!overlay; }, get section(){ return overlay ? sectionAt(spread) : null; } };
}
