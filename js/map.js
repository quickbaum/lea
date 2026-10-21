// Maps: the round minimap that turns with you, the place name above it, and the
// big map on M. Both maps share the land's colours (habitats + a hillshade), the
// region names (gen/places.js) and the caller's marks (people, faced trees …),
// which main.js draws through `drawMarks(ctx, toScreen)` so it never needs to
// know which map, or which way up, it's drawing on.

import { SIZE, WATER } from './config.js';
import { height, habitat, HABITATS } from './gen/land.js';
import { places, placeAt } from './gen/places.js';

const WATER_RGB = [47, 109, 176];
const MINI_R = 150;                 // world units from you to the minimap's rim
const TILE = 128, TRES = 2;         // land tiles: 128u at 2u per pixel
const BIG_PX = 768;                 // the whole-world bake behind the big map
const FONT = "Georgia,'Times New Roman',serif";

// one pixel of land: habitat colour, lit from the north-west
function landRGB(x, z){
  const h = height(x, z);
  if (h < WATER){ const d = Math.min(1, (WATER - h) / 6); return WATER_RGB.map(c => c * (1 - d * 0.35)); }
  const c = HABITATS[habitat(x, z, h)].color;
  const shade = Math.max(0.6, Math.min(1.3, 1 + (height(x - 3, z - 3) - h) * 0.16));
  return [c[0] * 255 * shade, c[1] * 255 * shade, c[2] * 255 * shade];
}
function bakeArea(x0, z0, span, px){
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(px, px), k = span / px;
  for (let py = 0; py < px; py++) for (let qx = 0; qx < px; qx++){
    const c = landRGB(x0 + (qx + 0.5) * k, z0 + (py + 0.5) * k), o = (py * px + qx) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
// land tiles, baked on demand (a few per frame) and kept
const tiles = new Map();
let tileBudget = 0;
function tile(i, j){
  const key = i + ',' + j;
  let t = tiles.get(key);
  if (!t && tileBudget-- > 0){ t = bakeArea(i * TILE, j * TILE, TILE, TILE / TRES); tiles.set(key, t); }
  return t;
}

// a label with a dark outline, centred on (x, y); returns its box
function label(ctx, text, x, y, size, color = '#f3e7c4'){
  ctx.font = `italic ${size}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(12,10,6,.85)'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
const overlaps = (a, list) => list.some(b => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);

function arrow(ctx, x, y, rot){
  // tip points up at rotation 0
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
}

export function createMaps({ mini, nameEl, drawMarks }){
  // ---------- the place name ----------
  let current = null;
  function updatePlace(px, pz){
    const g = placeAt(px, pz);
    if (g === current) return g;
    nameEl.classList.remove('hide');                 // first call: play has begun
    current = g;
    nameEl.classList.add('fade');                     // fade out, swap, fade in
    clearTimeout(nameEl._t);
    nameEl._t = setTimeout(() => { nameEl.textContent = g.name; nameEl.classList.remove('fade'); }, nameEl.textContent ? 350 : 0);
    return g;
  }

  // ---------- the minimap ----------
  const mctx = mini.getContext('2d');
  const MS = mini.width, C = MS / 2, scale = C / MINI_R;
  function drawMini(px, pz, yaw){
    tileBudget = 2;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // world → minimap: centred on you, turned so the way you face is up
    const toScreen = (x, z) => { const dx = x - px, dz = z - pz; return [C + (dx * cos - dz * sin) * scale, C + (dx * sin + dz * cos) * scale]; };
    mctx.clearRect(0, 0, MS, MS);
    mctx.save();
    mctx.beginPath(); mctx.arc(C, C, C, 0, Math.PI * 2); mctx.clip();
    mctx.fillStyle = '#1d1a14'; mctx.fillRect(0, 0, MS, MS);
    mctx.save();
    mctx.translate(C, C); mctx.rotate(yaw); mctx.scale(scale, scale); mctx.translate(-px, -pz);
    mctx.imageSmoothingEnabled = true;
    const reach = MINI_R * 1.42;
    for (let j = Math.floor((pz - reach) / TILE); j <= Math.floor((pz + reach) / TILE); j++)
      for (let i = Math.floor((px - reach) / TILE); i <= Math.floor((px + reach) / TILE); i++){
        const t = tile(i, j);
        if (t) mctx.drawImage(t, i * TILE, j * TILE, TILE, TILE);
      }
    mctx.restore();
    drawMarks(mctx, toScreen);
    // names of the places whose heart is in view
    const boxes = [];
    for (const g of places()){
      const [sx, sy] = toScreen(g.x, g.z);
      if (Math.hypot(sx - C, sy - C) > C - 14) continue;
      mctx.font = `italic 11px ${FONT}`;
      const w = mctx.measureText(g.name).width, b = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - 7, y1: sy + 7 };
      if (overlaps(b, boxes)) continue;
      boxes.push(b); label(mctx, g.name, sx, sy, 11);
    }
    arrow(mctx, C, C, 0);
    // north on the rim, since the map turns
    const nx = C + sin * (C - 9), ny = C - cos * (C - 9);
    mctx.font = `bold 11px ${FONT}`; label(mctx, 'N', nx, ny, 11, '#e8c75a');
    mctx.restore();
  }

  // ---------- the big map ----------
  const wrap = document.createElement('div');
  wrap.id = 'bigmap'; wrap.className = 'hide';
  const big = document.createElement('canvas');
  const hint = document.createElement('div');
  hint.className = 'hint'; hint.textContent = 'M or Esc to close · scroll to zoom · drag to move';
  wrap.append(big, hint); document.body.appendChild(wrap);
  const bctx = big.getContext('2d');
  let world = null;                                   // the whole-world bake
  let view = { cx: 0, cz: 0, z: 1 }, fit = 1, open = false, drag = null, player = { x: 0, z: 0, yaw: 0 };
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  function size(){
    const d = DPR(); big.width = innerWidth * d; big.height = innerHeight * d;
    fit = Math.min(big.width, big.height) * 0.92 / SIZE;
  }
  const toBig = (x, z) => [big.width / 2 + (x - view.cx) * view.z, big.height / 2 + (z - view.cz) * view.z];
  function drawBig(){
    if (!open) return;
    const d = DPR(), W = big.width, H = big.height;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.fillStyle = '#0d0c09'; bctx.fillRect(0, 0, W, H);
    const [x0, y0] = toBig(-SIZE / 2, -SIZE / 2);
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(world, x0, y0, SIZE * view.z, SIZE * view.z);
    // close in, the fine tiles sharpen the land where they're ready
    let pending = false;
    if (view.z > Math.max(1.5 * BIG_PX / SIZE, 0.5 * d)){        // past the bake's own detail
      tileBudget = 6; bctx.imageSmoothingEnabled = true;
      const wx0 = view.cx - W / 2 / view.z, wz0 = view.cz - H / 2 / view.z;
      for (let j = Math.floor(wz0 / TILE); j <= Math.floor((wz0 + H / view.z) / TILE); j++)
        for (let i = Math.floor(wx0 / TILE); i <= Math.floor((wx0 + W / view.z) / TILE); i++){
          if (Math.abs(i * TILE) > SIZE / 2 + TILE || Math.abs(j * TILE) > SIZE / 2 + TILE) continue;
          const t = tile(i, j);
          if (!t){ pending = true; continue; }
          const [sx, sy] = toBig(i * TILE, j * TILE);
          bctx.drawImage(t, sx, sy, TILE * view.z, TILE * view.z);
        }
    }
    bctx.strokeStyle = 'rgba(201,162,58,.5)'; bctx.lineWidth = d;
    bctx.strokeRect(x0, y0, SIZE * view.z, SIZE * view.z);
    bctx.save(); bctx.scale(d, d);
    drawMarks(bctx, (x, z) => { const [sx, sy] = toBig(x, z); return [sx / d, sy / d]; });
    // names, biggest places first; a name that would overlap one already
    // drawn waits for you to zoom in
    const boxes = [], here = placeAt(player.x, player.z);
    const list = [...places()].sort((a, b) => (b === here) - (a === here) || b.area - a.area);
    for (const g of list){
      let [sx, sy] = toBig(g.x, g.z); sx /= d; sy /= d;
      if (sx < -80 || sy < -20 || sx > W / d + 80 || sy > H / d + 20) continue;
      const fs = g.kind === 'greatlake' ? 16 : g.area > 40000 ? 13 : 11;
      bctx.font = `italic ${fs}px ${FONT}`;
      const w = bctx.measureText(g.name).width, b = { x0: sx - w / 2 - 3, x1: sx + w / 2 + 3, y0: sy - fs / 2 - 2, y1: sy + fs / 2 + 2 };
      if (overlaps(b, boxes)) continue;
      boxes.push(b); label(bctx, g.name, sx, sy, fs, g === here ? '#e8c75a' : '#f3e7c4');
    }
    const [ax, ay] = toBig(player.x, player.z);
    arrow(bctx, ax / d, ay / d, -player.yaw);
    bctx.restore();
    if (pending) requestAnimationFrame(drawBig);
  }
  function clampView(){
    view.z = Math.max(fit, Math.min(fit * 24, view.z));
    const half = SIZE / 2;
    view.cx = Math.max(-half, Math.min(half, view.cx)); view.cz = Math.max(-half, Math.min(half, view.cz));
  }
  function openBig(px, pz, yaw){
    if (!world) world = bakeArea(-SIZE / 2, -SIZE / 2, SIZE, BIG_PX);
    player = { x: px, z: pz, yaw };
    size(); open = true; wrap.classList.remove('hide');
    view = { cx: 0, cz: 0, z: fit };
    drawBig();
  }
  function closeBig(){ open = false; wrap.classList.add('hide'); drag = null; }
  big.addEventListener('wheel', e => {
    e.preventDefault();
    const d = DPR(), mx = e.offsetX * d, my = e.offsetY * d;
    const wx = view.cx + (mx - big.width / 2) / view.z, wz = view.cz + (my - big.height / 2) / view.z;
    view.z *= Math.exp(-e.deltaY * 0.0015); clampView();
    view.cx = wx - (mx - big.width / 2) / view.z; view.cz = wz - (my - big.height / 2) / view.z;   // zoom about the cursor
    clampView(); drawBig();
  }, { passive: false });
  big.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; big.setPointerCapture(e.pointerId); });
  big.addEventListener('pointermove', e => {
    if (!drag) return;
    const d = DPR();
    view.cx = drag.cx - (e.clientX - drag.x) * d / view.z; view.cz = drag.cz - (e.clientY - drag.y) * d / view.z;
    clampView(); drawBig();
  });
  big.addEventListener('pointerup', () => { drag = null; });
  addEventListener('resize', () => { if (open){ const r = view.z / fit; size(); view.z = fit * r; clampView(); drawBig(); } });

  return {
    updatePlace, drawMini, openBig, closeBig,
    get bigOpen(){ return open; },
    // while open, follow the player and the people moving about (a few times a second)
    tickBig(px, pz, yaw){ if (!open) return; player = { x: px, z: pz, yaw }; drawBig(); },
  };
}
