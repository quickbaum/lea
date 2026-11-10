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
//   book.goto(name)                           flip to the page with data-anchor="name"; a click on [data-goto] does this
//   book.key(e)                               a keydown while open; true if the book took it
//   book.say(text)                            a word under the book, for a moment
//   book.close(); book.isOpen                 closed, it isn't gone: it lies tilted in the bottom left corner, half off the window
//   book.dock()                               make it, small, before anything opens it
//   book.receive(el)                          el flies into it, put away; a promise for the landing
//
// sections: [{ id, title, tab, bare, sub, empty, blocks: () => [Node | html] }]
// `tab` is its hand-drawn banner, sprites/book/tab-<tab>.png. A section with no blocks (unless
// `always`) has no tab and no pages until it has something in it; asked for by name, the book says its `empty` instead. `bare`: no title on its first page, so a
// grid of plates lines up across both pages. The book flows a section's blocks onto as many pages as they need
// (measured, at the size the book is now), and starts each section on a left-hand page. A
// block with class `keep` isn't left alone at the foot of a page (a heading goes over with what
// it heads); one with `bp-newpage` starts a page. Hovering anything with `data-desc` writes it at the foot of its page, in place of
// the page number.
//
// Open, the book's spine is on the middle of the screen, and its drawn height is centred too. It stands clear of
// the map's ring, with the spell points and stamina (#vitals, raised over the overlay by book.css), so you can see
// them while you read: in a narrow window it's the book that gets smaller. On a phone there's no room to spare,
// so there it fills what's left of the ring instead of centring.
//
// The turning leaf is a strip of hinged slices (each a clone of the two pages it carries,
// cut to its share), so it can bend; the live pages are only ever the two lying open, so
// anything clickable on them keeps working. Styles in book.css; the paper's fonts in page.css.

import { ensureCss } from './page.js';
import { closeX } from './close-x.js';
import { drawCover, drawSheets, drawCrease, makePapers, dipTop, FOOT_LIP, CORNER_R } from './book-art.js';

const SLICES = 6;          // hinged slices across a turning leaf
const BEND = 7;            // degrees each slice lags the one before, at the height of a turn
const TURN_MS = 680, RIFFLE_MS = 520, RIFFLE_GAP = 85, RIFFLE_MAX = 6;
const TAB_H = .105, TAB_W = .154, TAB_STEP = .114, TAB_TOP = .075, TAB_ROOT = -8;   // a tab's size and spacing, of the page's height; its inner end, px from the page's box (tucked under the top page)
const HINT = '← → or a folded corner to turn · a tab for its section · Esc to close';
const DOCK_W = 270, DOCK_DEG = 11, DOCK_LEFT = 60, DOCK_FOOT = 65;   // put away: its width, tilt, and its middle from the window's left and foot (px, off the board)
const MIN_PW = 40;                                 // px: a page never lays out narrower, however small the window (a collapsed one measures 0, or less after the margins)
const PAD = 90;                                    // px round the drawn parts, for their shadows

let bookCss = null;        // settled once book.css is in: the pages can't be measured before it
function ensureBookCss(){
  ensureCss();
  if (bookCss) return bookCss;
  const el = document.createElement('link');
  el.id = 'book-css'; el.rel = 'stylesheet'; el.href = new URL('../book.css', import.meta.url).href;
  bookCss = new Promise(done => { el.onload = el.onerror = done; });
  document.head.appendChild(el);
  return bookCss;
}

const div = (cls, html) => { const e = document.createElement('div'); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ease = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export function makeBook({ sections, onClose, onSection, onIcon }){
  let overlay = null, bookEl, pagesEl, slotL, slotR, coverCv, sheetsCv, ribbonsEl, measureEl, asideEl;
  let geo = null, papers = null, paperKey = '', ready = null, creases = [], sayT = 0;
  let pages = [], starts = {}, spread = 0, busy = false, pending = null;
  let live = [];            // the sections with something in them, in order: these have tabs and pages
  let up = false;           // lying open in front of you; otherwise small by the map (once dock()ed or opened)
  let opening = false;      // being set up: the paper and fonts aren't in, so the pages aren't final
  let wanted = null;        // { id, at } asked for when it couldn't open yet: the last place asked for
  let iconEl = null;
  let anchor = null;        // 'start' | 'end' of its section, as opened; once you turn, where you've turned to

  // ---- laying out: the book's size from the window, then each section flowed onto pages
  function size(){
    const vw = innerWidth, vh = innerHeight;
    const small = vh < 520 || vw < 640;   // a phone: the book takes the whole screen, its asides gone
    overlay.classList.toggle('small', small);
    const lipY = small ? 14 : 34, lipX = Math.round(lipY * 1.15);
    // the spell points stay in sight beside the book, so its right half has to end short of them
    const v = document.getElementById('vitals')?.getBoundingClientRect();
    const reserve = v && v.width ? vw - v.left + 14 : 0, margin = small ? 4 : 16, avail = vw - reserve - margin * 2;
    // the page, the book's two and the tabs out to the right all scale together
    const ph0 = Math.min(vh - (small ? 70 : 180), 700), aspect = .69;
    const fit = small ? (avail - lipX - TAB_ROOT) / (2 + TAB_W / aspect)
      : Math.min(vw / 2 - margin - lipX, (vw / 2 - reserve - margin - TAB_ROOT) / (1 + TAB_W / aspect));
    const pw = Math.max(MIN_PW, Math.round(Math.min(ph0 * aspect, fit))), ph = Math.round(pw / aspect);
    const whole = lipX + 2 * pw + TAB_ROOT + ph * TAB_W;
    const left = small ? margin + Math.max(0, (avail - whole) / 2) + lipX : vw / 2 - pw;
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
    asideEl.style.top = `${Math.round(Math.min((vh + ph + lipY + lipFoot) / 2 + 8, vh - 26))}px`;   // under the foot, out of the flow: it mustn't push the book up
    const n = sections.length, step = n > 1 ? Math.min(TAB_STEP, (1 - TAB_TOP - TAB_H) / (n - 1)) : 0;
    bookEl.style.setProperty('--tabstep', `${(step * ph).toFixed(1)}px`);
    bookEl.style.setProperty('--tabtop', `${(TAB_TOP * ph).toFixed(1)}px`);

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
    const filled = sections.map(sec => [sec, sec.blocks() || []]).filter(([sec, b]) => b.length || sec.always);
    live = filled.length ? filled.map(([sec]) => sec) : [sections[0]];   // an empty book still has a page to open on
    for (const sec of live){
      if (pages.length % 2) pages.push(blankPage());
      starts[sec.id] = pages.length;
      const blocks = filled.find(([f]) => f === sec)?.[1] || [];
      const heads = sec.bare ? [] : [div('bp-title keep', esc(sec.title)), ...(sec.sub ? [div('bp-sub keep', esc(sec.sub))] : [])];
      const all = [...heads, ...(blocks.length ? blocks.map(toNode) : [div('bp-empty', esc(sec.empty || 'Nothing written here yet.'))])];
      let pg = newPage(sec), body = pg.querySelector('.bp-body');
      if (!sec.bare) pg.classList.add('opening');           // its title heads it; no running head over that
      measureEl.appendChild(pg);
      for (const node of all){
        if (node.classList?.contains('bp-newpage') && body.children.length){ pages.push(pg); pg = newPage(sec); body = pg.querySelector('.bp-body'); measureEl.appendChild(pg); }   // it starts a page of its own
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
  const sectionAt = s => { let cur = live[0].id; for (const sec of live) if (starts[sec.id] / 2 <= s) cur = sec.id; return cur; };
  const lastSpreadOf = id => {
    const i = live.findIndex(s => s.id === id), next = live[i + 1];
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
    if (up) onSection?.(sectionAt(spread));
  }
  // the sheets under each side: a thicker block the more of the book lies that way
  function edges(sl, sr){
    const n = Math.max(1, spreads() - 1);
    drawSheets(sheetsCv, geo, sl / n, (spreads() - 1 - sr) / n);
  }
  function ribbons(){
    const cur = sectionAt(spread);
    ribbonsEl.replaceChildren(...live.map((sec, k) => {
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
    if (opening || !up) return;   // nothing to turn yet, or it's put away
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
      if (wanted && !opening){ const w = wanted; wanted = null; rise(w); return; }
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
  // id left out: as you left it
  function open(id, { at = 'start' } = {}){
    const w = { id, at };
    if (up){
      if (id == null) return;
      if (id in starts){ if (!opening){ anchor = null; go(place(w)); } else wanted = w; }
      else sayEmpty(id);
      return;
    }
    if (!overlay){ wanted = w; dock(); return; }
    if (opening || busy){ wanted = w; return; }
    rise(w);
  }
  const place = w => w.id in starts ? (w.at === 'end' ? lastSpreadOf(w.id) : starts[w.id] / 2) : starts[live[0].id] / 2;
  const sayEmpty = id => { if (id != null && !(id in starts)) say(sections.find(s => s.id === id)?.empty); };
  // the book made, small by the map, before anything asks for it. Laid out for good only when the
  // paper's baked and the book's type is in; laying out in book.css is what asks for its fonts,
  // so fonts.ready means nothing before it.
  function dock(){
    if (overlay) return;
    opening = true;
    const css = ensureBookCss(); build();
    const art = size(); paginate();
    spread = 0;
    show();
    css.then(() => { paginate(); return Promise.all([art, document.fonts?.ready]); }).then(() => {
      opening = false;
      paginate(); show();
      toIcon();
      void overlay.offsetWidth;            // sat by the map before the zoom's switched on
      overlay.classList.add('ready');
      if (wanted){ const w = wanted; wanted = null; requestAnimationFrame(() => rise(w)); }
    });
  }
  // up from the corner, at the place asked for
  function rise(w){
    up = true;
    overlay.classList.add('up');
    document.body.classList.add('book-open');
    asideEl.textContent = HINT;
    if (w.id == null){ anchor = null; refresh(); }
    else {
      size(); paginate();
      anchor = w.id in starts ? w.at : 'start';
      spread = place(w);
      show();
      sayEmpty(w.id);
    }
    for (const k of ['--dx', '--dy', '--zs', '--rz']) bookEl.style.removeProperty(k);
  }
  // how far the whole book moves, shrinks and turns to lie put away. On a desktop, in the bottom left
  // corner (it was the bottom right, after mocks/hud mock.psd, till the bag took that); on a phone, where that's under the thumb, small under the ring
  function toIcon(){
    const { w, h, lipX, lipY, lipFoot } = geo, touch = document.documentElement.classList.contains('touch');
    const v = document.getElementById('vitals')?.getBoundingClientRect(), seen = v && v.width;
    const iw = touch ? 64 : DOCK_W, zs = iw / (2 * w + 2 * lipX), ih = (h + lipY + lipFoot) * zs;
    const cx = touch && seen ? v.left + v.width / 2 : DOCK_LEFT;
    const cy = touch && seen ? v.bottom + 6 + ih / 2 : innerHeight - DOCK_FOOT;
    const deg = touch ? 0 : DOCK_DEG, a = deg * Math.PI / 180;
    // the book scales and turns about .book's transform-origin, 62% down; its drawn middle is a little above that
    const fromMid = (.62 * h - (h + lipFoot - lipY) / 2) * zs;
    bookEl.style.setProperty('--dx', `${(cx - fromMid * Math.sin(a) - (bookEl.offsetLeft + w)).toFixed(1)}px`);
    bookEl.style.setProperty('--dy', `${(cy + fromMid * Math.cos(a) - (bookEl.offsetTop + .62 * h)).toFixed(1)}px`);
    bookEl.style.setProperty('--zs', zs.toFixed(4));
    bookEl.style.setProperty('--rz', `${deg}deg`);
    Object.assign(iconEl.style, { left: `${cx - iw / 2}px`, top: `${cy - ih / 2}px`, width: `${iw}px`, height: `${ih}px`, transform: `rotate(${deg}deg)` });
  }
  // something copied into the book: `el` flies from where it is to the book put away and sinks in, and
  // the book stirs as it lands. Promises the landing; at once if the book isn't lying there to catch it.
  function receive(el){
    const r = iconEl?.getBoundingClientRect();
    if (up || !r?.width) return Promise.resolve();
    const p = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - (p.left + p.width / 2), dy = r.top + r.height / 2 - (p.top + p.height / 2);
    const flight = el.animate({ transform: `translate(${dx}px, ${dy}px) scale(${r.width * .45 / p.width}) rotate(${bookEl.style.getPropertyValue('--rz') || '0deg'})` },
                              { duration: 650, easing: 'cubic-bezier(.45, .05, .3, 1)', fill: 'forwards' });
    el.animate([{ opacity: 1, offset: .82 }, { opacity: 0 }], { duration: 650, fill: 'forwards' });   // on the clock, not the flight's easing: it would be gone before it got there
    return flight.finished.catch(() => {}).then(() => {
      // added onto the book's own transform, so it swells where it lies
      bookEl.animate([{ transform: 'scale(1)', filter: 'brightness(1)' }, { transform: 'scale(1.07)', filter: 'brightness(1.3)', offset: .4 }, { transform: 'scale(1)', filter: 'brightness(1)' }],
                     { duration: 450, easing: 'ease', composite: 'add' });
    });
  }
  function build(){
    overlay = div(null); overlay.id = 'book-overlay';
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
    bookEl.append(cover, coverCv, ...corners, sheetsCv, ribbonsEl, pagesEl, closeX(close));   // the tabs lie on the sheets, under the top page
    measureEl = div('book-measure');
    bookEl.appendChild(measureEl);
    asideEl = div('book-aside'); asideEl.textContent = HINT;
    iconEl = document.createElement('button');
    iconEl.className = 'book-icon'; iconEl.title = 'Your book (J)';
    iconEl.onclick = e => { e.stopPropagation(); onIcon ? onIcon() : open(); };
    overlay.append(bookEl, asideEl, iconEl);
    document.body.appendChild(overlay);
    // what a thing on the page is, written at the page's foot while you point at it
    overlay.addEventListener('mouseover', e => {
      const d = e.target.closest?.('[data-desc]'), pg = e.target.closest?.('.bpage');
      if (!pg) return;
      const foot = pg.querySelector('.bp-foot');
      foot.textContent = d ? d.dataset.desc : foot.dataset.n;
      foot.classList.toggle('desc', !!d);
    });
    // a link on the page: flip to what it names (`data-goto`, or a family tree's card, bub-lineage's own <a href="#id">)
    overlay.addEventListener('click', e => {
      const a = e.target.closest?.('[data-goto], a.bub-lin-card'); if (!a) return;
      e.preventDefault(); e.stopPropagation();
      goto(a.dataset.goto || a.getAttribute('href').slice(1));
    }, true);
    addEventListener('resize', onResize);
  }
  // to the spread with this anchor on it (data-anchor)
  function goto(name){
    const i = pages.findIndex(p => p.querySelector(`[data-anchor="${CSS.escape(name)}"]`));
    if (i >= 0){ anchor = null; go(i >> 1); }
  }
  function onResize(){
    if (innerWidth < 260 || innerHeight < 120) return;   // collapsed, not resized: reflowing onto pages this small would lose your place
    if (overlay && !busy && !opening){ refresh(); if (!up) toIcon(); }
  }
  function refresh(){
    if (!overlay) return;
    // where you were: the start or end of the section you opened at, or as far into it as you'd turned
    let sec = sectionAt(spread); const off = spread - starts[sec] / 2;
    size(); paginate();
    if (!(sec in starts)) sec = live[0].id;
    spread = anchor === 'end' ? lastSpreadOf(sec) : anchor === 'start' ? starts[sec] / 2 : Math.min(starts[sec] / 2 + off, lastSpreadOf(sec));
    show();
  }
  function key(e){
    if (!up) return false;
    if (e.code === 'ArrowRight' || e.code === 'PageDown'){ anchor = null; go((pending ?? spread) + 1); return true; }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp'){ anchor = null; go((pending ?? spread) - 1); return true; }
    return false;
  }
  // down to the corner; a page still turning finishes on the way
  function close(){
    const had = wanted; wanted = null; pending = null;
    if (!up){ if (had) onClose?.(); return; }
    up = false;
    overlay.classList.remove('up');
    document.body.classList.remove('book-open');
    toIcon();
    onClose?.();
  }
  function say(text){
    if (!overlay || !text) return;
    asideEl.textContent = text;
    clearTimeout(sayT); sayT = setTimeout(() => { if (asideEl) asideEl.textContent = HINT; }, 3200);
  }
  return { open, close, dock, refresh, key, say, receive, goto, get isOpen(){ return up || !!wanted; }, get section(){ return up ? sectionAt(spread) : null; } };
}
