// vitals-view.js — spell points (blue, left) and stamina (gold, right) as the two arcs round the
// minimap, from the design board (mocks/hud mock.psd; art in sprites/hud, cut by tools/cut_hud.py).
// Stack, bottom up: ring, fill, track. The tracks are translucent, so they stay over the fills
// and make the groove. Both fills rise from the foot of the ring. The hole's left open for #map.

const BOX = 464;                  // the art's box; drawn at half size on a desktop
// centre radius and stroke of each fill, and where its round end sits at empty and at full
// (degrees clockwise from 12), as measured by cut_hud.py
const SP = { r: 199.14, w: 36.24, from: 187.01, to: 347.7 };
const ST = { r: 198.17, w: 33.62, from: 174.14, to: 11.8 };

const at = (r, deg) => {
  const a = deg * Math.PI / 180;
  return `${(BOX / 2 + r * Math.sin(a)).toFixed(2)} ${(BOX / 2 - r * Math.cos(a)).toFixed(2)}`;
};
const arc = ({ r, from, to }) => `M${at(r, from)}A${r} ${r} 0 0 ${to > from ? 1 : 0} ${at(r, to)}`;

export function vitalsView(){
  const el = document.createElement('div');
  el.id = 'vitals';
  const img = (name, extra = '') => `<image href="sprites/hud/${name}.png" width="${BOX}" height="${BOX}" ${extra}/>`;
  const reveal = (id, b) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${BOX}" height="${BOX}">`
    + `<path d="${arc(b)}" pathLength="1" fill="none" stroke="#fff" stroke-width="${b.w}" stroke-linecap="round" stroke-dasharray="1 2"/></mask>`;
  const hit = (b, title) => `<path class="hit" d="${arc(b)}" fill="none" stroke="transparent" stroke-width="${b.w}"><title>${title}</title></path>`;
  el.innerHTML = `<svg viewBox="0 0 ${BOX} ${BOX}"><defs>${reveal('vitals-sp', SP)}${reveal('vitals-st', ST)}</defs>`
    + img('ring') + img('sp', 'class="sp" mask="url(#vitals-sp)"') + img('st', 'class="st" mask="url(#vitals-st)"') + img('tracks')
    + hit(SP, 'Spell points') + hit(ST, 'Stamina') + '</svg>';
  const bar = (id, cls) => ({ dash: el.querySelector(`#${id} path`), fill: el.querySelector(`.${cls}`), shown: -1 });
  const sp = bar('vitals-sp', 'sp'), st = bar('vitals-st', 'st');
  const set = (b, v) => {
    v = Math.round(Math.min(1, Math.max(0, v)) * 500) / 500;
    if (v === b.shown) return;                 // this runs every frame; the SVG repaints only on a change
    b.shown = v;
    b.dash.setAttribute('stroke-dasharray', `${v} 2`);
    b.fill.style.visibility = v ? '' : 'hidden';   // a dash of nothing would still draw its round end
  };
  return { el, draw(spFrac, stFrac, winded){ set(sp, spFrac); set(st, stFrac); el.classList.toggle('winded', winded); } };
}
