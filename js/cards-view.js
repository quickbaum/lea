// cards-view.js — the table for a game of cards with one of the folk (docs/cards.md). DOM only: the
// rules and how they choose are js/cards.js; who they are, the talk before and what the game
// leaves behind are main.js's. The world keeps running behind it.
//   const table = makeCardsView({ onClose, pace })  pace: ms between the beats of their go
//   table.open({ name, she, mind, manner })   name: theirs; she: for "she draws"; mind: cardMind(recall);
//                                             manner: cardManner(n), 'easy' | 'keen'
//   table.leave()                             the close button and Esc: mid-game it asks first (a second
//                                             press within a few seconds gets up); between games, at once
//   table.close()                             onClose({ games, won, lost }) after, from either way out
//   table.isOpen
// Tap a card of yours to ask for its rank. Their go plays itself out at a talking pace. What's
// said goes in speech bubbles by each name; what happens is a line in the middle; and every card
// that changes hands flies there (fly(): where each card was, against where it is after).

import { goFish, ask, heed, theirAsk, rankOf, rankName, RANKS, SUITS, newPack, score, winner } from './cards.js';
import { closeX } from './close-x.js';

const CSS = `
#cards { position: fixed; inset: 0; z-index: 39; display: grid; place-items: center; background: #0007; font: 15px Georgia, serif;
  --cw: clamp(46px, 10.5vw, 84px); --ch: calc(var(--cw) * 1.45); }
#cards.hide { display: none; }
.cards-cloth { position: relative; width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 32px); box-sizing: border-box;
  padding: 16px 16px 14px; display: flex; flex-direction: column; gap: 10px; border-radius: 10px; color: #f3ead2;
  background: radial-gradient(ellipse at 50% 40%, #3d6a3f, #22412a 75%); box-shadow: 0 0 0 3px #4a3218, 0 0 0 5px #1d140a, 0 10px 40px #000c; }
.cards-row { display: flex; align-items: center; gap: 10px; min-height: calc(var(--ch) * .62); }
.cards-who { font-variant: small-caps; letter-spacing: .04em; font-size: 15px; opacity: .9; min-width: 0; }
.cards-books { margin-left: auto; display: flex; gap: 3px; flex-wrap: wrap; justify-content: flex-end; max-width: 55%; }
.cards-book { width: calc(var(--cw) * .42); height: calc(var(--ch) * .42); border-radius: 3px; background-size: cover; box-shadow: 1px 1px 0 #fff, 2px 2px 0 #ccc, 3px 3px 0 #999, 0 2px 4px #0008; }
.cards-hand { display: flex; justify-content: center; min-height: var(--ch); padding: 4px 0; }
.cards-hand.theirs { min-height: calc(var(--ch) * .62); }
.cards-card { width: var(--cw); height: var(--ch); flex: none; border-radius: 5px; background: #fff center/cover; box-shadow: 0 2px 5px #0009; transition: transform .12s; }
.cards-hand.theirs .cards-card { width: calc(var(--cw) * .62); height: calc(var(--ch) * .62); }
.cards-back { background: #7a1f1f; background-image: repeating-linear-gradient(45deg, #0000 0 5px, #e8d5a833 5px 6px), repeating-linear-gradient(-45deg, #0000 0 5px, #e8d5a833 5px 6px);
  border: 3px solid #f4ecd8; box-sizing: border-box; }
.cards-group { display: flex; flex: none; border-radius: 6px; cursor: default; }
.cards-group + .cards-group { margin-left: 6px; }
.cards-group .cards-card + .cards-card { margin-left: calc(var(--cw) * -.62); }
.cards-mine.go .cards-group { cursor: pointer; }
.cards-mine.go .cards-group:hover .cards-card, .cards-mine.go .cards-group:focus-visible .cards-card { transform: translateY(-8px); }
.cards-group:focus-visible { outline: 2px solid #f0cf6a; outline-offset: 2px; }
.cards-group.new .cards-card { box-shadow: 0 0 0 2px #f0cf6a, 0 2px 5px #0009; }
.cards-mid { display: flex; align-items: center; justify-content: center; gap: 16px; min-height: calc(var(--ch) * .8); margin-bottom: 16px; }
.cards-pile { position: relative; flex: none; width: calc(var(--cw) * .8); height: calc(var(--ch) * .8); }
.cards-pile .cards-card { position: absolute; inset: 0; width: 100%; height: 100%; }
.cards-pile .cards-card.under { background: #efe6cf; border: none; box-shadow: none; }      /* the edges of the cards under the top one */
.cards-pile .cards-card.under:nth-child(even) { background: #c9bb98; }
.cards-pile span { position: absolute; left: 50%; bottom: -18px; transform: translateX(-50%); font-size: 12px; opacity: .8; white-space: nowrap; }
.cards-pile.empty .cards-card { opacity: .15; }
.cards-said { flex: 1; min-width: 0; max-width: 380px; text-align: center; line-height: 1.35; font-size: 14px; font-style: italic; opacity: .85; }
.cards-foot { display: flex; justify-content: center; gap: 8px; min-height: 34px; align-items: center; font-size: 13px; opacity: .9; }
.cards-btn { font: 15px Georgia, serif; color: #2a1c0e; background: #e3d09f; border: 1px solid #5a3a14; border-radius: 3px; padding: 6px 14px; cursor: pointer; box-shadow: 0 2px 6px #0009; }
.cards-btn:hover { background: #efe2bf; }
.cards-cloth > .close-x { top: -12px; right: -12px; }
/* speech: the Lea's bubbles (talk-view.js), each beside its speaker's name, its tail towards them */
.cards-bubble { position: relative; margin-left: 12px; max-width: min(340px, 58%); padding: 4px 10px; background: #fbf8ef; color: #2e2a24;
  border: 2px solid #2e2a24; border-radius: 12px; font: 15px/1.3 Georgia, serif; box-shadow: 0 2px 6px #0004; transform-origin: 0 50%; }
.cards-bubble::before, .cards-bubble::after { content: ''; position: absolute; top: 50%; border: solid transparent; }
.cards-bubble::before { left: -12px; margin-top: -8px; border-width: 8px 12px 8px 0; border-right-color: #2e2a24; }
.cards-bubble::after { left: -8px; margin-top: -6px; border-width: 6px 9px 6px 0; border-right-color: #fbf8ef; }
.cards-bubble.hush { visibility: hidden; }
.cards-bubble.pop { animation: cards-pop .18s ease-out; }
@keyframes cards-pop { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
.cards-fly { position: fixed; z-index: 41; margin: 0 !important; pointer-events: none; perspective: 700px; background: none !important; box-shadow: none !important; }
.cards-fly .flip { position: absolute; inset: 0; transform-style: preserve-3d; }
.cards-fly .side { position: absolute; inset: 0; border-radius: 5px; backface-visibility: hidden; -webkit-backface-visibility: hidden; background: #fff center/cover; box-shadow: 0 6px 14px #0009; }
.cards-fly .side.cards-back { background: #7a1f1f; background-image: repeating-linear-gradient(45deg, #0000 0 5px, #e8d5a833 5px 6px), repeating-linear-gradient(-45deg, #0000 0 5px, #e8d5a833 5px 6px);
  border: 3px solid #f4ecd8; box-sizing: border-box; }
.cards-bubble .w { opacity: 0; transition: opacity .12s; }
.cards-bubble .w.on { opacity: 1; }
.cards-hidden { visibility: hidden; }
@media (max-width: 520px){ .cards-cloth { padding: 12px 10px; } .cards-books { max-width: 45%; } }
`;
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const FACES = new URL('../sprites/cards/', import.meta.url).href;      // (from here, so any page can hold the table)
const face = c => `url(${FACES}${c}.png)`;
const called = c => `${rankOf(c)}${SUIT[c.slice(-1)]}`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const PACE = 1700;                                  // ms between the beats of their go (slower, 2026-11-10)
const FLY = 700, STAGGER = 140, LIFT = 26;          // ms a card takes to fly, ms between cards flying together, px it lifts mid-flight
const WORD = 210, STOP = 260, READ = 900;           // a line comes up a word at a time (as Puck's): ms a word, more after , . ? and
                                                    // ms to read it once it's all up, before the game goes on

export function makeCardsView({ onClose, pace = PACE }){
  if (!document.getElementById('cards-css')){ const st = el('style'); st.id = 'cards-css'; st.textContent = CSS; document.head.appendChild(st); }
  const root = el('div', 'hide'); root.id = 'cards';
  const cloth = el('div', 'cards-cloth');
  const topRow = el('div', 'cards-row'), theirName = el('div', 'cards-who'), theirSay = el('div', 'cards-bubble hush'), theirBooks = el('div', 'cards-books');
  const theirHand = el('div', 'cards-hand theirs');
  const mid = el('div', 'cards-mid'), pile = el('div', 'cards-pile'), said = el('div', 'cards-said');
  const myHand = el('div', 'cards-hand cards-mine');
  const myRow = el('div', 'cards-row'), myName = el('div', 'cards-who', 'You'), mySay = el('div', 'cards-bubble hush'), myBooks = el('div', 'cards-books');
  const foot = el('div', 'cards-foot');
  topRow.append(theirName, theirSay, theirBooks); mid.append(pile, said); myRow.append(myName, mySay, myBooks);
  cloth.append(closeX(() => leave()), topRow, theirHand, mid, myHand, myRow, foot);
  root.append(cloth);
  document.body.appendChild(root);

  // a fast pace (the mock's ?pace=20) flies fast too; and no flying for those who'd rather not
  // (reduced motion: the cards still slide, so you can see where they go, but don't lift or turn)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches, k = Math.min(1, pace / PACE);
  const flyMs = FLY * k, staggerMs = STAGGER * k, wordMs = WORD * k, stopMs = STOP * k, readMs = READ * k;
  let g = null, who = null, run = 0, busy = false, fresh = new Set(), tally = { games: 0, won: 0, lost: 0 };
  const wait = ms => { const r = run; return new Promise(ok => setTimeout(() => ok(r === run), ms)); };   // false once the table's shut or redealt

  // a line comes up a word at a time, as Puck's do; resolves once it's up and there's been time to
  // read it (false if the table's shut or redealt meanwhile)
  function bubble(b, text){
    clearTimeout(b._t);
    b.classList.toggle('hush', !text); b.classList.remove('pop');
    if (!text){ b.textContent = ''; return Promise.resolve(true); }
    const words = text.split(/\s+/);
    b.replaceChildren(...words.flatMap((w, i) => { const s = el('span', 'w', w); return i ? [' ', s] : [s]; }));
    void b.offsetWidth; b.classList.add('pop');
    const spans = [...b.querySelectorAll('.w')], r = run;
    return new Promise(done => {
      let i = 0;
      const next = () => {
        if (r !== run) return done(false);
        if (i >= spans.length){ b._t = setTimeout(() => done(r === run), readMs + 60 * k * words.length); return; }
        const w = spans[i++]; w.classList.add('on');
        b._t = setTimeout(next, wordMs + (/[,;:]$/.test(w.textContent) ? stopMs : /[.?!]$/.test(w.textContent) ? stopMs * 1.6 : 0));
      };
      next();
    });
  }
  const hush = () => { bubble(theirSay); bubble(mySay); };
  const note = text => { said.textContent = text || ''; };
  function books(box, rs){ box.replaceChildren(...rs.map(r => { const b = el('div', 'cards-book'); b.dataset.rank = r; b.style.backgroundImage = face(r + 'S'); b.title = cap(rankName(r)); return b; })); }
  // overlap a long hand so it stays on the cloth
  function fit(hand, n, w){
    const room = hand.clientWidth || cloth.clientWidth - 32;
    return n * w <= room ? 0 : Math.min(w * 0.85, (n * w - room) / Math.max(1, n - 1));
  }
  function draw(){
    theirName.textContent = who.name;
    books(theirBooks, g.books[1]); books(myBooks, g.books[0]);
    // theirs, face down
    const tw = theirHand.querySelector('.cards-card')?.offsetWidth || 50, tv = fit(theirHand, g.hands[1].length, tw);
    theirHand.replaceChildren(...g.hands[1].map((c, i) => { const d = el('div', 'cards-card cards-back'); d.dataset.card = c; if (i) d.style.marginLeft = `${2 - tv}px`; return d; }));
    // the pile
    // the pile, as thick as what's left in it: a card's edge for every three, stacked up and left from
    // where it sits, the top card on them
    const depth = Math.ceil(g.stock.length / 3), layers = [];
    for (let i = 0; i < depth; i++){ const u = el('div', 'cards-card under'); u.style.transform = `translate(${-i}px, ${-i}px)`; layers.push(u); }
    const top = el('div', 'cards-card cards-back top');
    top.style.transform = `translate(${-depth}px, ${-depth}px)`;
    pile.replaceChildren(...layers, top, el('span', null, g.stock.length ? `${g.stock.length} left` : 'none left'));
    pile.classList.toggle('empty', !g.stock.length);
    // yours, face up, a group to a rank: tap a group to ask for it
    const groups = RANKS.map(r => g.hands[0].filter(c => rankOf(c) === r)).filter(a => a.length);
    const yourGo = g.turn === 0 && !g.over && !busy;
    myHand.classList.toggle('go', yourGo);
    const cw = myHand.querySelector('.cards-card')?.offsetWidth || 70;
    const span = groups.reduce((a, gr) => a + cw * (1 + 0.38 * (gr.length - 1)) + 6, 0), room = myHand.clientWidth || cloth.clientWidth - 32;
    const squeeze = span > room ? (span - room) / Math.max(1, groups.length - 1) : 0;
    myHand.replaceChildren(...groups.map((gr, i) => {
      const b = el('div', 'cards-group'); const r = rankOf(gr[0]);
      if (i && squeeze) b.style.marginLeft = `${6 - squeeze}px`;
      if (gr.some(c => fresh.has(c))) b.classList.add('new');
      b.append(...gr.map(c => { const d = el('div', 'cards-card'); d.dataset.card = c; d.style.backgroundImage = face(c); return d; }));
      b.title = `Ask for ${rankName(r)}`; b.setAttribute('role', 'button'); b.tabIndex = yourGo ? 0 : -1;
      b.setAttribute('aria-label', `${gr.map(called).join(', ')}. Ask for ${rankName(r)}`);
      const go = () => { if (myHand.classList.contains('go')) yours(r); };
      b.addEventListener('click', go);
      b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); go(); } });
      return b;
    }));
    if (g.over){ if (!busy) end(); return; }                   // (once the last cards have landed)
    foot.replaceChildren();
    foot.textContent = yourGo ? 'Your go: tap a card to ask for that kind.' : g.turn === 1 ? `${who.name}'s go.` : '';
  }

  // ---- flying: where every card is (its zone and the box it's drawn in), before a move and after it.
  // Each card whose zone changed flies from the one box to the other, turning over on the way if
  // it goes between face down (their hand, the pile) and face up (yours, the books).
  function where(){
    const m = new Map(), box = e => e.getBoundingClientRect();
    for (const d of myHand.querySelectorAll('[data-card]')) m.set(d.dataset.card, { zone: 'mine', el: d, r: box(d) });
    for (const d of theirHand.querySelectorAll('[data-card]')) m.set(d.dataset.card, { zone: 'theirs', el: d, r: box(d) });
    for (const [s, B] of [[0, myBooks], [1, theirBooks]]) for (const d of B.querySelectorAll('[data-rank]'))
      for (const su of SUITS) m.set(d.dataset.rank + su, { zone: 'book' + s, el: d, r: box(d) });
    const top = pile.querySelector('.top'), pr = box(top);
    for (const c of g.stock) m.set(c, { zone: 'pile', el: top, r: pr });
    return m;
  }
  const faceUp = z => z === 'mine' || z === 'book0' || z === 'book1';
  async function fly(before, after){
    const moves = [...after].filter(([c, a]) => before.get(c) && before.get(c).zone !== a.zone).map(([c, a]) => [c, before.get(c), a]);
    if (!moves.length) return true;
    const landing = new Set(moves.map(([, , a]) => a.el).filter(e => e !== pile.querySelector('.top')));
    landing.forEach(e => e.classList.add('cards-hidden'));
    await Promise.all(moves.map(([c, b, a], i) => new Promise(done => {
      // a card with two sides, the one it starts on towards you; turning is half a turn about its upright
      const d = el('div', 'cards-card cards-fly'), flip = el('div', 'flip'), up0 = faceUp(b.zone), up1 = faceUp(a.zone);
      const front = el('div', 'side'), back = el('div', 'side cards-back');
      front.style.backgroundImage = face(c);
      (up0 ? back : front).style.transform = 'rotateY(180deg)';
      flip.append(front, back); d.append(flip);
      const at = (r, lift = 0) => ({ left: `${r.left}px`, top: `${r.top - lift}px`, width: `${r.width}px`, height: `${r.height}px` });
      const mid = { left: (b.r.left + a.r.left) / 2, top: (b.r.top + a.r.top) / 2, width: (b.r.width + a.r.width) / 2, height: (b.r.height + a.r.height) / 2 };
      Object.assign(d.style, at(b.r), { visibility: 'hidden' });
      root.append(d);
      const opts = { duration: flyMs, delay: i * staggerMs, easing: 'ease-in-out', fill: 'both' };
      const anim = d.animate([at(b.r), { ...at(mid, still ? 0 : LIFT), offset: 0.5 }, at(a.r)], opts);
      if (up0 !== up1) flip.animate(still ? [{ transform: 'none' }, { transform: 'none', offset: 0.5 }, { transform: 'rotateY(180deg)', offset: 0.5 }, { transform: 'rotateY(180deg)' }]
                                          : [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], opts);
      setTimeout(() => { d.style.visibility = ''; }, i * staggerMs);        // (waiting its turn, it isn't drawn twice over the pile)
      anim.onfinish = anim.oncancel = () => { d.remove(); done(); };
    })));
    landing.forEach(e => e.classList.remove('cards-hidden'));
    return true;
  }
  // a move of the game: where things were, the move, draw it, and fly what changed hands
  async function move(seat, rank){
    const before = where(), ev = ask(g, seat, rank);
    if (ev.error) return ev;
    heed(who.mind, ev);
    draw();
    await fly(before, where());
    return ev;
  }
  const booksLine = (ev, mine) => !ev.books.length ? '' : `${mine ? 'You lay' : `${who.Pron} lays`} down the ${ev.books.map(r => rankName(r)).join(' and ')}.`;

  async function yours(r){
    if (busy) return;
    busy = true; draw();
    const r0 = run;
    hush(); note('');
    if (!await bubble(mySay, pick([`Have you any ${rankName(r)}?`, `Any ${rankName(r)}?`, `Got any ${rankName(r)}?`]))) return;
    const n = g.hands[1].filter(c => rankOf(c) === r).length;
    if (!await bubble(theirSay, n === 1 ? pick([`One ${rankName(r, 1).replace(/^an? /, '')}. Here.`, 'Just the one. Here.'])
                      : n ? pick([`${cap(numWord(n))}. There.`, `I've ${numWord(n)}. Here you are.`])
                      : pick(['Go fish.', 'None. Go fish.', 'Not one. Go fish.']))) return;
    fresh = new Set();
    const before = g.hands[0].slice();
    const ev = await move(0, r);
    if (run !== r0 || ev.error){ busy = false; return; }
    g.hands[0].filter(c => !before.includes(c)).forEach(c => fresh.add(c));
    const what = ev.got ? 'Your go again.' : ev.fished ? (ev.lucky ? `You draw the ${called(ev.fished)}, just what you asked for. Your go again.` : `You draw the ${called(ev.fished)}.`) : 'The pile is gone.';
    if (!g.over) note([what, booksLine(ev, true)].filter(Boolean).join(' '));   // (or the score stays)
    busy = false; draw();
    if (g.turn === 1 && !g.over) theirs();
  }
  async function theirs(){
    const r0 = run;
    busy = true; draw();
    while (!g.over && g.turn === 1){
      if (!await wait(pace * 0.6)) return;                    // (a moment to look at their hand)
      hush();
      const r = theirAsk(g, who.mind, Math.random), remembered = who.mind.why === 'remembered';
      if (!await bubble(theirSay, remembered ? pick([`You asked for ${rankName(r)} before. Still got them?`, `Have you still got ${rankName(r)}?`])
                                  : pick([`Have you any ${rankName(r)}?`, `Got any ${rankName(r)}?`, `Any ${rankName(r)}?`]))) return;
      const mine = g.hands[0].filter(c => rankOf(c) === r);
      if (!await bubble(mySay, mine.length === 1 ? pick(['Just the one.', 'One. Here.']) : mine.length ? pick(['Here, take them.', `${cap(numWord(mine.length))}. Here.`]) : pick(['Go fish.', 'None. Go fish.']))) return;
      fresh = new Set();
      const ev = await move(1, r);
      if (run !== r0) return;
      const what = ev.got ? `You hand over ${mine.map(called).join(', ')}.${remembered ? ` ${who.Pron} remembered.` : ''}`
        : ev.fished ? (ev.lucky ? `${who.Pron} draws, and it's ${rankName(r, 1)}. ${who.Pron} goes again.` : `${who.Pron} draws one.`) : 'The pile is gone.';
      if (!g.over) note([what, booksLine(ev, false)].filter(Boolean).join(' '));
      if (ev.got && !g.over && g.turn === 1){ hush(); if (!await bubble(theirSay, pick(['Thank you kindly.', 'Ha. Thank you.', 'Thank you.']))) return; }
    }
    busy = false; draw();
  }
  function end(){
    if (g.ended) return;                                       // (draw() comes here every time once it's over)
    g.ended = true;
    const w = winner(g), [mine, theirs_] = score(g);
    tally.games++; if (w === 0) tally.won++; else if (w === 1) tally.lost++;
    const keen = who.manner === 'keen';
    bubble(mySay);
    bubble(theirSay, w === 1 ? (keen ? pick(['Mine! Another?', "That's mine. Again?"]) : pick(['That one went my way. Another?', "Mine, that time. Shall we go again?"]))
      : keen ? pick(["You had me there. Again, I'll have you this time.", 'Again. I want that back.']) : pick(['Well played. Another?', "You've beaten me. Good game."]));
    note(`${mine} books to ${theirs_}.`);
    const again = el('button', 'cards-btn', 'Deal again'), done = el('button', 'cards-btn', 'Thank you, that will do');
    again.type = done.type = 'button';
    again.onclick = () => deal(tally.games % 2);             // (taking turns to go first: they go first in the second game)
    done.onclick = () => close();
    foot.replaceChildren(again, done);
    busy = false;
  }
  // the deal: every card starts on the pile, and goes out one at a time, a card to each in turn
  async function deal(first = 0){
    const r0 = ++run;
    g = goFish(Math.random, first); fresh = new Set();
    who.mind.yours.clear(); who.mind.lacks.clear();
    hush(); note(first ? `Seven each. ${who.name} goes first this time.` : 'Seven each. You go first.');
    busy = true;
    const pr = pile.getBoundingClientRect(), before = new Map(newPack().map(c => [c, { zone: 'pile', r: pr }]));
    draw();
    // in dealing order, theirs and yours by turns (and a dealt book straight down), not hand order
    const after = where(), order = [...after].filter(([, a]) => a.zone !== 'pile');
    const dealt = new Map(interleave(order));
    await fly(before, dealt);
    if (run !== r0) return;
    busy = false; draw();
    if (first) theirs();
  }

  function open({ name, she, mind, manner }){
    who = { name, Pron: she ? 'She' : 'He', mind, manner };
    tally = { games: 0, won: 0, lost: 0 };
    root.classList.remove('hide');
    requestAnimationFrame(() => deal(0));                      // (once the cloth has a width to fit hands to, and a pile to deal from)
  }
  // leaving mid-game throws the game away, so the first press only warns
  let armed = 0, armTimer = 0;
  function leave(){
    if (!g || g.over || Date.now() < armed) return close();
    armed = Date.now() + 3000;
    clearTimeout(armTimer);
    foot.textContent = 'Get up and leave the game? Press again to go.';
    armTimer = setTimeout(() => { armed = 0; if (!g.over && !busy) draw(); }, 3000);
  }
  function close(){
    if (root.classList.contains('hide')) return;
    run++; clearTimeout(armTimer); armed = 0; busy = false;
    root.querySelectorAll('.cards-fly').forEach(d => d.remove());
    root.classList.add('hide');
    onClose?.(tally);
  }
  return { open, close, leave, get isOpen(){ return !root.classList.contains('hide'); } };
}

// the dealt cards in dealing order: one to each hand in turn (a book dealt goes down where its cards fell)
function interleave(list){
  const a = list.filter(([, w]) => w.zone === 'mine' || w.zone === 'book0'), b = list.filter(([, w]) => w.zone === 'theirs' || w.zone === 'book1'), out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++){ if (a[i]) out.push(a[i]); if (b[i]) out.push(b[i]); }
  return out;
}
function numWord(n){ return ['no', 'one', 'two', 'three'][n] || String(n); }
