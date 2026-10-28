// pack-view.js — draws the pack grid (js/pack.js) in the inventory panel. A box shows
// the ingredient's name and how many; boxes are as big as the thing (ingredients.js
// `size`). Drag a box to move it, or onto a box of the same kind to merge them.
// Double-click or right-click a box to eat one. The line under the grid says what the
// box under the pointer is, and what eating one would give. It never moves the panel
// a fixed box the grid's width, the text shrunk to fit it, the how-to beside it.
// What has a picture
// (ingredients.js `pic`) shows it in place of its name.

import { ingredient, edible } from './ingredients.js';

const CELL = 52;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// el: the panel; pack: makePack(); onEat(box) → a line to show, or null;
// says(box) → what eating one gives now, and where the box's things came from
export function packView(el, pack, { onEat, says }){
  let drag = null, hoverId = null, note = '';

  function render(){
    el.innerHTML = `<h3>YOUR PACK</h3><div class="pack-grid" style="width:${pack.w * CELL}px;height:${pack.h * CELL}px;background-size:${CELL}px ${CELL}px"></div>` +
      `<div class="pack-foot" style="width:${pack.w * CELL}px"><div class="pack-desc"></div><div class="pack-hint">drag to move<br>right-click to eat or use</div></div>`;
    const grid = el.querySelector('.pack-grid');
    for (const it of pack.items){
      const [w, h] = pack.size(it.kind), e = ingredient(it.kind) || {};
      const b = document.createElement('div');
      b.className = 'pack-box'; b.dataset.id = it.id;
      b.style.cssText = `left:${it.x * CELL}px;top:${it.y * CELL}px;width:${w * CELL - 3}px;height:${h * CELL - 3}px;--tint:${e.color || '#8a7a50'}`;
      b.lang = 'en';   // (so a long name hyphenates in a small box)
      const name = e.pic ? `<img class="pic" src="${(it.n > 1 && e.pic[1]) || e.pic[0]}" alt="${esc(e.label || it.kind)}" draggable="false">`
                         : `<span class="nm">${esc(e.hyph ? e.hyph.replace(/-/g, '\u00ad') : e.label || it.kind)}</span>`;
      b.innerHTML = name + (pack.stack(it.kind) > 1 ? `<span class="ct">${it.n}</span>` : '');
      if (!edible(it.kind)) b.classList.add('raw');
      grid.appendChild(b);
    }
    grid.addEventListener('pointerdown', down);
    grid.addEventListener('dblclick', ev => { const b = boxOf(ev.target); if (b) eatBox(b); });
    grid.addEventListener('contextmenu', ev => { ev.preventDefault(); const b = boxOf(ev.target); if (b) eatBox(b); });
    grid.addEventListener('pointermove', ev => { if (drag) return; const b = boxOf(ev.target); const id = b ? b.id : null; if (id !== hoverId){ hoverId = id; note = ''; foot(); } });
    grid.addEventListener('pointerleave', () => { if (!drag){ hoverId = null; foot(); } });
    foot();
  }
  const boxOf = t => { const d = t.closest && t.closest('.pack-box'); return d ? pack.items.find(it => it.id === +d.dataset.id) : null; };
  function foot(){
    const f = el.querySelector('.pack-desc'); if (!f) return;
    const it = pack.items.find(b => b.id === hoverId);
    const text = note ? note : it ? `${cap((ingredient(it.kind) || {}).label || it.kind)} (${it.n}). ${says(it)}` : pack.items.length ? '' : '— empty —';
    f.textContent = text;
    // shrink to fit the fixed box; past the smallest size it clips, and the whole of it is the tooltip
    let fs = 12; f.style.fontSize = `${fs}px`;
    while (f.scrollHeight > f.clientHeight + 1 && fs > 9){ fs -= 0.5; f.style.fontSize = `${fs}px`; }
    f.title = f.scrollHeight > f.clientHeight + 1 ? text : '';
  }
  function eatBox(it){ const line = onEat(it); note = line || ''; render(); hoverId = it.id; foot(); }

  // dragging: the box follows the pointer; where it would land is outlined, green if it can
  function down(ev){
    if (ev.button !== 0) return;
    const b = boxOf(ev.target); if (!b) return;
    const grid = el.querySelector('.pack-grid'), r = grid.getBoundingClientRect();
    const node = grid.querySelector(`.pack-box[data-id="${b.id}"]`);
    drag = { it: b, node, grid, ox: ev.clientX - r.left - b.x * CELL, oy: ev.clientY - r.top - b.y * CELL, sx: ev.clientX, sy: ev.clientY, moved: false, tx: b.x, ty: b.y };
    try { grid.setPointerCapture(ev.pointerId); } catch (_){}   // (a synthetic event has no real pointer)
    grid.addEventListener('pointermove', move);
    grid.addEventListener('pointerup', up, { once: true });
    grid.addEventListener('pointercancel', up, { once: true });
  }
  function move(ev){
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 4) return;
    drag.moved = true;
    const r = drag.grid.getBoundingClientRect(), x = ev.clientX - r.left - drag.ox, y = ev.clientY - r.top - drag.oy;
    drag.node.classList.add('lifted');
    drag.node.style.left = `${x}px`; drag.node.style.top = `${y}px`;
    drag.tx = Math.round(x / CELL); drag.ty = Math.round(y / CELL);
    const ok = !!pack.dropAt(drag.it.id, drag.tx, drag.ty), [w, h] = pack.size(drag.it.kind);
    let ghost = drag.grid.querySelector('.pack-ghost');
    if (!ghost){ ghost = document.createElement('div'); ghost.className = 'pack-ghost'; drag.grid.appendChild(ghost); }
    ghost.style.cssText = `left:${drag.tx * CELL}px;top:${drag.ty * CELL}px;width:${w * CELL - 3}px;height:${h * CELL - 3}px`;
    ghost.classList.toggle('bad', !ok);
  }
  function up(){
    const d = drag; drag = null;
    d.grid.removeEventListener('pointermove', move);
    if (d.moved) pack.move(d.it.id, d.tx, d.ty);   // where it can't go, it goes back
    render();
  }

  return { render, get dragging(){ return !!drag; } };
}
