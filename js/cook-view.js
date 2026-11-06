// cook-view.js — sitting down at a fire to cook (docs/cooking.md). The world keeps running. The
// camera, the pack and what comes out of the pot are main.js's; this is what's drawn over the
// view: the recipe on a loose leaf, the place over the pot things are dropped, the one thing
// the dish wants doing now. All the cooking itself is recipes.js potAct.
//   const cook = makeCookView({ world, pack, known, cookOf, say, onEat, onLadle, onFeed, onDouse, mayDouse, book });
//   cook.open(fire), cook.close(), cook.tick(dt, { x, y, r }), cook.drop(box, ev) → did it land?
// Stage 2 lets you use any empty pot; asking first comes with the rest of the NPC pots.

import { potAct, potView, RECIPES } from './recipes.js';
import { ingredient } from './ingredients.js';
import { ensureCss } from './page.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const SLIP = { caught: 'caught a little', without: 'did without' };
const WHY = { 'not-yours': who => who ? `That's ${who}'s pot.` : "That's someone's pot.", cold: () => 'The fire is out.', ready: () => 'It wants ladling out first.',
              'prep-first': () => 'That wants working first, on the board.', 'straight-in': () => 'There is nothing to work there. It goes straight in the pot.',
              'too-late': () => 'Too late to add more of that.', full: () => 'The pot is full.', wrong: () => "That isn't what it wants.", 'not-yet': () => 'Not yet.', 'no-step': () => 'There is nothing to do but wait.' };

export function makeCookView({ world, pack, known, cookOf, say, onEat, onLadle, onFeed, onDouse, mayDouse, book }){
  ensureCss();
  let fire = null, chosen = null, paper = null, paperKey = '', working = false, sayT = 0, lastState = '';
  const root = el('div', 'cook hide'); root.id = 'cook';
  const zone = el('div', 'cook-zone'), says = el('div', 'cook-says'), saysMain = el('div'), saysFire = el('div', 'cook-fireline'), controls = el('div', 'cook-controls'), board = el('div', 'cook-board');
  says.append(saysMain, saysFire);
  root.append(zone, board, says, controls);
  // the board across your knees: what a dish's first work is done on, before anything goes in the pot.
  // Hold on it to work.
  board.onpointerdown = e => { if (fire?.pot.board && potView(fire.pot).now?.do === 'prep'){ working = true; e.preventDefault(); } };
  document.body.appendChild(root);

  const stopWork = () => { working = false; };   // (let go anywhere)
  addEventListener('pointerup', stopWork); addEventListener('pointercancel', stopWork);

  function open(f){
    fire = f; chosen = null; paperKey = ''; working = false; sayT = 0;
    f.hands = true;
    root.classList.remove('hide');
    refresh();
    if (paper) flyOut(paper);
  }
  function close(){
    if (!fire) return;
    fire.hands = false; fire = null; working = false;
    root.classList.add('hide');
    if (paper){ const leaf = paper; paper = null; (book?.receive(leaf) || Promise.resolve()).then(() => leaf.remove()); }
  }
  // the leaf comes up out of your book, as a page goes back into it (page.js)
  function flyOut(leaf){
    const r = document.querySelector('.book-icon')?.getBoundingClientRect();
    if (!r?.width) return;
    const p = leaf.getBoundingClientRect();
    leaf.animate({ transform: `translate(${r.left + r.width / 2 - p.left - p.width / 2}px, ${r.top + r.height / 2 - p.top - p.height / 2}px) scale(.08) rotate(8deg)`, offset: 0 },
                 { duration: 420, easing: 'cubic-bezier(.2, .7, .25, 1)' });
  }

  const mine = () => !!fire?.pot.mine;
  const empty = () => fire.pot.raw + fire.pot.ready <= 0;
  const recipeNow = () => (empty() ? chosen : fire.pot.recipe);

  // ---- the leaf -------------------------------------------------------------------------------
  function drawPaper(){
    const p = fire.pot, id = recipeNow(), list = empty() ? known() : [];
    const view = potView(p), others = !empty() && !mine() && !p.helper;
    const key = others ? 'none' : id ? `${id}|${view.steps.map(s => s.state + (s.slip || '')).join()}` : list.length ? `list|${list.join()}` : 'none';
    if (key === paperKey) return;
    paperKey = key;
    if (key === 'none'){ if (paper){ paper.remove(); paper = null; } return; }
    const fresh = !paper;
    if (fresh){ paper = el('div', 'old-page cook-paper'); paper.lang = 'en'; root.appendChild(paper); }
    paper.textContent = '';
    if (id) drawRecipe(id, view); else drawList(list);
    if (fresh && fire.hands && !root.classList.contains('hide')) flyOut(paper);
  }
  function drawList(list){
    paper.append(el('div', 'page-running', 'Out of your book'), el('h2', 'page-title', 'What to make'));
    const ul = el('ul', 'cook-list');
    for (const id of list){
      const R = RECIPES[id], li = el('li', R.base.some(k => pack.counts[k] > 0) ? 'have' : '', cap(id));
      li.onclick = () => { chosen = id; refresh(); };
      ul.appendChild(li);
    }
    paper.appendChild(ul);
  }
  function drawRecipe(id, view){
    const R = RECIPES[id], cooking = !empty();
    paper.appendChild(el('div', 'page-running', R.book ? 'Copied from an old book' : 'As the folk make it'));
    paper.appendChild(el('h2', 'page-title', cap(id)));
    if (R.intro) paper.appendChild(el('p', 'page-first', R.intro));
    paper.appendChild(el('p', 'cook-take', `Take ${R.base.join(' or ')}.`));
    const ol = el('ol', 'cook-steps');
    R.steps.forEach((s, i) => {
      const v = view.steps[i], li = el('li', cooking ? v.state : 'todo');
      li.appendChild(el('span', 'say', cap(s.say) + '.'));
      if (cooking && v.state === 'done') li.appendChild(el('span', 'tick', '✓'));
      if (cooking && v.slip) li.appendChild(el('span', 'slip', SLIP[v.slip]));
      ol.appendChild(li);
    });
    paper.appendChild(ol);
    if (!cooking){ const back = el('div', 'cook-other', 'Something else'); back.onclick = () => { chosen = null; refresh(); }; paper.appendChild(back); }
  }

  // ---- what wants doing now ----------------------------------------------------------------------
  let controlsKey = '';
  const button = (label, on) => { const b = el('button', 'cook-do', label); b.type = 'button'; if (on) b.onclick = on; return b; };
  function act(a, arg){ const r = potAct(fire, world, a, arg); if (!r.ok) say(WHY[r.why]?.(cookOf(fire)) || ''); refresh(); return r; }
  function drawControls(){
    const p = fire.pot, v = potView(p), now = v.now;
    const key = `${mine()}|${p.ready > 0}|${now ? now.do + now.say : ''}`;
    if (key === controlsKey) return;
    controlsKey = key;
    controls.textContent = ''; working = false;
    if (p.ready > 0 && mine()){
      controls.append(button('Ladle it into your pack', () => { onLadle(fire); refresh(); }), button('Eat a bowl', () => { onEat(fire); refresh(); }));
    } else if (empty()) controls.append(douseButton());
    else if (now && mine()){
      if (now.do === 'stir') controls.append(button('Stir', () => act('stir')));
      else if (now.do === 'add') controls.append(button('Do without it', () => act('without')));
    }
  }
  // putting a fire out: arms first (a second click, within a moment, does it)
  function douseButton(){
    const b = button('Put the fire out'); let armed = null;
    b.classList.add('quiet');
    b.onclick = () => {
      const why = mayDouse(fire);
      if (why){ say(why); return; }
      if (armed){ clearTimeout(armed); onDouse(fire); return; }
      b.textContent = 'Really put it out?'; b.classList.add('armed');
      armed = setTimeout(() => { armed = null; b.textContent = 'Put the fire out'; b.classList.remove('armed'); }, 3000);
    };
    return b;
  }
  function fireWords(){
    const n = fire.woodpile | 0;
    return `${fire.fuel > 0.5 ? 'Burning well' : 'Burning low'}, ${n ? `${n} ${n === 1 ? 'log' : 'logs'} stacked` : 'no wood stacked'}.${pack.counts.wood > 0 ? ' Drag wood onto it to feed it.' : ''}`;
  }
  function saysNow(){
    const p = fire.pot;
    if (!fire.lit) return 'The fire is out.';
    if (empty()) return pack.items.length ? 'Drag something from your pack into the pot.' : 'Your pack is empty.';
    if (!mine() && !p.helper) return `${fire.potReport()}${cookOf(fire) ? ` It's ${cookOf(fire)}'s pot.` : ''}`;
    const now = potView(p).now;
    if (p.ready > 0) return fire.potReport();
    if (!now) return 'It boils.';
    if (now.do === 'add') return `It wants ${now.item.join(' or ')}: drag it in.`;
    if (now.do === 'prep') return `${cap(now.say)}: hold on the board.`;
    if (now.do === 'stir') return 'Stir it, before it catches.';
    return `${cap(now.say)}.`;
  }
  // the board shows what's on it, one chip to a unit; once worked, they fly to the pot
  let boardKey = '';
  function drawBoard(){
    const p = fire.pot, up = empty() || !!p.board;
    if (!up && boardKey && boardKey !== 'off') tipIn();
    board.classList.toggle('off', !up);
    const key = up ? `${p.kind}|${p.board ? p.raw : 0}` : 'off';
    if (key === boardKey) return;
    boardKey = key;
    board.textContent = '';
    if (!up) return;
    if (!p.board){ board.append(el('span', 'cook-board-hint', 'Work it here')); return; }
    const e = ingredient(p.kind) || {};
    for (let i = 0; i < p.raw; i++){
      const c = el('span', 'cook-chip'); c.style.setProperty('--tint', e.color || '#8a7a50');
      if (e.pic){ const im = el('img'); im.src = e.pic[0]; im.draggable = false; im.alt = ''; c.append(im); }
      board.append(c);
    }
  }
  function tipIn(){
    const z = zone.getBoundingClientRect();
    for (const c of board.querySelectorAll('.cook-chip')){
      const r = c.getBoundingClientRect(), fly = c.cloneNode(true);
      fly.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;margin:0;pointer-events:none`;
      root.append(fly);
      fly.animate({ transform: `translate(${z.left + z.width / 2 - r.left}px, ${z.top + z.height / 2 - r.top}px) scale(.5)`, opacity: .2 }, { duration: 380, easing: 'cubic-bezier(.45, .05, .55, .95)' }).onfinish = () => fly.remove();
    }
  }
  function refresh(){ if (!fire) return; drawPaper(); drawControls(); drawBoard(); saysMain.textContent = saysNow(); saysFire.textContent = fire.lit ? fireWords() : ''; }

  // ---- each frame -------------------------------------------------------------------------------
  function tick(dt, at){
    if (!fire) return;
    if (at){
      const { x: px, y: py, r, stacked } = at, w = board.offsetWidth, h = board.offsetHeight;
      zone.style.cssText = `left:${px - r}px;top:${py - r}px;width:${2 * r}px;height:${2 * r}px`;
      board.style.left = `${stacked ? px + r + 8 : px - w / 2}px`; board.style.top = `${stacked ? py - h / 2 : py + r + 8}px`;   // under the pot, or beside it if the pack is under both
    }
    if (working) act('prep', dt);
    const now = fire.pot.raw > 0 && potView(fire.pot).now;
    root.style.setProperty('--frac', now ? now.frac : 0);
    const state = `${fire.pot.step}|${fire.pot.raw}|${fire.pot.ready}`;    // a step gone by shows at once; the rest can lag a little
    if (state !== lastState || (sayT -= dt) <= 0){ lastState = state; sayT = 0.4; refresh(); }
  }

  // ---- something dropped on the pot, from the pack ------------------------------------------------
  function drop(box, ev){
    if (!fire) return false;
    const r = zone.getBoundingClientRect(), b = board.getBoundingClientRect();
    const onBoard = !board.classList.contains('off') && ev.clientX >= b.left && ev.clientX <= b.right && ev.clientY >= b.top && ev.clientY <= b.bottom;
    const onPot = Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) <= r.width / 2;
    if (!onBoard && !onPot) return false;                                  // on neither: it goes back in the pack
    const to = onBoard ? 'board' : 'pot';
    if (box.kind === 'wood'){ if (onBoard) return false; if (onFeed(fire)) pack.takeFrom(box.id); refresh(); return true; }
    const e = ingredient(box.kind) || {}, kind = box.kind, now = fire.pot.raw > 0 && potView(fire.pot).now;
    let got;
    // what the dish is asking for goes in, whatever it is (salt isn't food, but a recipe can want it); only then ask if it's food
    if (now && now.do === 'add' && (mine() || fire.pot.helper) && now.item.includes(kind)){
      if (onBoard){ say('That goes in the pot.'); return true; }
      got = act('add', kind);
    }
    else if (!(e.raw || e.eat) || e.group === 'dish' || e.group === 'trinket'){ say("That won't go in a pot."); return true; }
    else if (empty()){
      const take = known().filter(id => RECIPES[id].base.includes(kind));
      if (chosen && !take.includes(chosen)){ say("That isn't what this wants. Turn the leaf to make something else."); return true; }
      got = act('put', { kind, n: 1, recipe: chosen || take[0] || null, to });
    } else got = act('put', { kind, n: 1, to });
    if (got.ok) pack.takeFrom(box.id);
    refresh();
    return true;
  }

  return { open, close, tick, drop, get fire(){ return fire; }, get working(){ return working; }, refresh };
}
