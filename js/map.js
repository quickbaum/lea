// Maps: the round minimap that turns with you, the place name above it, and the
// big map on M. Both maps share the land's colours (habitats + a hillshade), the
// region names (gen/places.js) and the caller's marks (people, faced trees …),
// which main.js draws through `drawMarks(ctx, toScreen)` so it never needs to
// know which map, or which way up, it's drawing on.

import { SIZE, WATER } from './config.js';
import { height, habitat, HABITATS, settlements, ruins, under } from './gen/land.js';
import { places, placeAt, settlementNames, ruinNames, underNames } from './gen/places.js';

const WATER_RGB = [47, 109, 176];
const MINI_R = 150;                 // world units from you to the minimap's rim
const TILE = 128, TRES = 2;         // land tiles: 128u at 2u per pixel
const BIG_PX = 768;                 // the whole-world bake behind the big map
const FONT = "Georgia,'Times New Roman',serif";
// what people built, in its own colour so it reads apart from the land's names:
// the lanes, the buildings, and the settlements' and lanes' names
const LANE_RGB = '#d98a4a', BUILT_RGB = '#3a2414', BUILT_NAME = '#f4b27a';
// the ruins: older than anyone's building, in stone grey
const RUIN_RGB = '#a39e92', RUIN_NAME = '#c9c4b8';   // light, so the walls read apart from the dark buildings

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

// The settlements on a map (gen/settle.js): lanes as lines, buildings as their
// footprints once they're big enough to see, and the names — settlements first,
// then a lane's name beside it where the lane is long enough on screen to carry
// it. `px` is screen pixels per world unit. Pushes the name boxes into `boxes`,
// so the region names drawn after keep clear of them.
function drawSettlements(ctx, toScreen, px, boxes, inView){
  const S = settlements(), names = settlementNames(), lw = Math.max(1.5, Math.min(4, 3.2 * px));
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [w, c] of [[lw + 2, 'rgba(12,10,6,.7)'], [lw, LANE_RGB]]){
    ctx.lineWidth = w; ctx.strokeStyle = c;
    for (const l of S.lanes){
      ctx.beginPath();
      for (let k = 0; k < l.xs.length; k += 3){ const [sx, sy] = toScreen(l.xs[k], l.zs[k]); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
      const [ex, ey] = toScreen(l.xs[l.xs.length - 1], l.zs[l.zs.length - 1]); ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }
  if (px > 0.25){
    ctx.fillStyle = BUILT_RGB;
    for (const b of S.buildings){
      const lx = Math.cos(b.a), lz = Math.sin(b.a), cx = -lz, cz = lx;
      ctx.beginPath();
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
        const [sx, sy] = toScreen(b.x + lx * u * b.hl + cx * v * b.hw, b.z + lz * u * b.hl + cz * v * b.hw);
        ctx.lineTo(sx, sy);
      }
      ctx.fill();
    }
  }
  const put = (text, x, z, fs, dy = 0) => {
    let [sx, sy] = toScreen(x, z); sy += dy;
    if (!inView(sx, sy)) return;
    ctx.font = `italic ${fs}px ${FONT}`;
    const w = ctx.measureText(text).width, b = { x0: sx - w / 2 - 3, x1: sx + w / 2 + 3, y0: sy - fs / 2 - 2, y1: sy + fs / 2 + 2 };
    if (overlaps(b, boxes)) return;
    boxes.push(b); label(ctx, text, sx, sy, fs, BUILT_NAME);
  };
  S.places.forEach((p, i) => put(names[i].name, p.x, p.z, p.kind === 'village' ? 13 : 11, p.kind === 'farmstead' ? -12 : 0));
  for (const l of S.lanes){
    const i = S.places.indexOf(l.place), text = names[i].lane;
    ctx.font = `italic 10px ${FONT}`;
    if (l.length * px < ctx.measureText(text).width * 1.6) continue;   // too short on screen to name
    const k = l.xs.length >> 1;
    put(text, l.xs[k], l.zs[k], 10, -8);
  }
}

// The ruins on a map (gen/ruins.js): their walls and stones as footprints once
// they're big enough to see, a small grey mark when not, and their names.
function drawRuins(ctx, toScreen, px, boxes, inView){
  const names = ruinNames();
  ruins().forEach((ru, i) => {
    const [cx, cy] = toScreen(ru.x, ru.z);
    if (!inView(cx, cy)) return;
    ctx.fillStyle = RUIN_RGB;
    if (px > 0.5){
      for (const o of [...ru.pieces, ...ru.stones]){
        if (o.block) continue;
        const lx = Math.cos(o.a), lz = Math.sin(o.a), qx = -lz, qz = lx, hw = Math.max(o.hw, 0.6 / px);
        ctx.beginPath();
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]){
          const [sx, sy] = toScreen(o.x + lx * u * o.hl + qx * v * hw, o.z + lz * u * o.hl + qz * v * hw);
          ctx.lineTo(sx, sy);
        }
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = RUIN_NAME; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(cx - 2.5, cy - 2.5, 5, 5); ctx.fill(); ctx.stroke();
    }
    const fs = 10, dy = -Math.max(9, (ru.labelR || ru.rad) * px + 6);
    ctx.font = `italic ${fs}px ${FONT}`;
    const text = names[i].name, w = ctx.measureText(text).width, b = { x0: cx - w / 2 - 3, x1: cx + w / 2 + 3, y0: cy + dy - fs / 2 - 2, y1: cy + dy + fs / 2 + 2 };
    if (overlaps(b, boxes)) return;
    boxes.push(b); label(ctx, text, cx, cy + dy, fs, RUIN_NAME);
  });
}

// The ways down (gen/under.js): a cave mouth as a dark arch, a crypt's stair as a
// dark square with its steps. One under a ruin goes unnamed, the ruin's name being
// beside it; a cave or a country tomb is named.
const WAY_RGB = '#1a1612', WAY_EDGE = '#e8c75a';
export function drawWaysDown(ctx, toScreen, px, boxes, inView){
  const names = underNames(), levels = under().levels;
  for (const e of under().entrances){
    const [cx, cy] = toScreen(e.x, e.z);
    if (!inView(cx, cy)) continue;
    const s = Math.max(4, Math.min(7, 3 * px + 3));
    ctx.fillStyle = WAY_RGB; ctx.strokeStyle = WAY_EDGE; ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (e.kind === 'cave'){ ctx.moveTo(cx - s, cy + s * 0.8); ctx.lineTo(cx - s, cy); ctx.arc(cx, cy, s, Math.PI, 0); ctx.lineTo(cx + s, cy + s * 0.8); ctx.closePath(); }
    else ctx.rect(cx - s, cy - s, 2 * s, 2 * s);
    ctx.fill(); ctx.stroke();
    if (e.kind !== 'cave'){ ctx.beginPath(); for (let q = 1; q < 3; q++){ ctx.moveTo(cx - s + 2, cy - s + q * 2 * s / 3); ctx.lineTo(cx + s - 2, cy - s + q * 2 * s / 3); } ctx.stroke(); }
    const spec = levels[e.level];
    if (spec.ruin !== undefined || (e.kind === 'cave' && e.mouth > 0)) continue;
    const fs = 10, text = names[e.level].name;
    ctx.font = `italic ${fs}px ${FONT}`;
    const w = ctx.measureText(text).width, dy = s + 9, b = { x0: cx - w / 2 - 3, x1: cx + w / 2 + 3, y0: cy + dy - fs / 2 - 2, y1: cy + dy + fs / 2 + 2 };
    if (overlaps(b, boxes)) continue;
    boxes.push(b); label(ctx, text, cx, cy + dy, fs, WAY_EDGE);
  }
}

function arrow(ctx, x, y, rot){
  // tip points up at rotation 0
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.restore();
}

export function createMaps({ mini, nameEl, drawMarks }){
  // ---------- underground (gen/under.js) ----------
  // While you're down a cave or a crypt, both maps show that level instead of
  // the land: only the cells you've come near, the way Might and Magic's
  // automap fills in. One pixel a cell, painted as they're revealed.
  let level = null;
  function setLevel(L, name){
    current = null;                                   // the place name redraws on the way back up
    if (!L){ level = null; return; }
    const cv = document.createElement('canvas'); cv.width = L.W; cv.height = L.H;
    level = { L, name, cv, ctx: cv.getContext('2d') };
    for (let k = 0; k < L.W * L.H; k++) if (L.revealed[k]) paintCell(k);
    nameEl.classList.remove('hide', 'fade'); clearTimeout(nameEl._t); nameEl.textContent = name;
  }
  function paintCell(k){
    const { L, ctx } = level, i = k % L.W, j = (k / L.W) | 0;
    const x = L.x0 + (i + 0.5) * L.cell, z = L.z0 + (j + 0.5) * L.cell, f = L.floor[k];
    const wet = (L.waters || []).some(w => Math.hypot(x - w.x, z - w.z) < w.r && f < w.y);   // where the floor lies under the water
    ctx.fillStyle = !L.open[k] ? '#2e2720' : wet ? '#2f5a7a' : L.kind === 'cave' ? '#8a7558' : '#8d8a80';
    ctx.fillRect(i, j, 1, 1);
  }
  // reveal the cells within reach of (x, z), and the rock that bounds them
  function reveal(x, z, R = 12){
    if (!level) return;
    const { L } = level, c = L.cell;
    for (let j = Math.max(0, Math.floor((z - R - L.z0) / c)); j <= Math.min(L.H - 1, Math.floor((z + R - L.z0) / c)); j++)
      for (let i = Math.max(0, Math.floor((x - R - L.x0) / c)); i <= Math.min(L.W - 1, Math.floor((x + R - L.x0) / c)); i++){
        const k = j * L.W + i;
        if (L.revealed[k] || Math.hypot(L.x0 + (i + 0.5) * c - x, L.z0 + (j + 0.5) * c - z) > R) continue;
        L.revealed[k] = 1; paintCell(k);
      }
  }
  // the level and its mouths, through a world → screen transform turned by `yaw`
  function drawLevel(ctx, toScreen, yaw, scale, fs){
    const { L, cv } = level, [ox, oy] = toScreen(L.x0, L.z0);
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.translate(ox, oy); ctx.rotate(yaw); ctx.scale(scale * L.cell, scale * L.cell);
    ctx.drawImage(cv, 0, 0);
    ctx.restore();
    for (const m of L.mouths){
      const k = Math.floor((m.z - L.z0) / L.cell) * L.W + Math.floor((m.x - L.x0) / L.cell);
      if (!L.revealed[k]) continue;
      const [sx, sy] = toScreen(m.x, m.z);
      ctx.fillStyle = '#e8c75a'; ctx.fillRect(sx - 3, sy - 3, 6, 6);
      label(ctx, m.label || 'the way out', sx, sy - 10, fs, '#e8c75a');
    }
  }
  function drawLevelMini(px, pz, yaw){
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toScreen = (x, z) => { const dx = x - px, dz = z - pz; return [C + (dx * cos - dz * sin) * scale, C + (dx * sin + dz * cos) * scale]; };
    mctx.clearRect(0, 0, MS, MS);
    mctx.save();
    mctx.beginPath(); mctx.arc(C, C, C, 0, Math.PI * 2); mctx.clip();
    mctx.fillStyle = '#0b0a08'; mctx.fillRect(0, 0, MS, MS);
    drawLevel(mctx, toScreen, yaw, scale, 10);
    arrow(mctx, C, C, 0);
    mctx.restore();
  }

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
    if (level) return drawLevelMini(px, pz, yaw);
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
    const boxes = [];
    drawSettlements(mctx, toScreen, scale, boxes, (sx, sy) => Math.hypot(sx - C, sy - C) < C - 14);
    drawRuins(mctx, toScreen, scale, boxes, (sx, sy) => Math.hypot(sx - C, sy - C) < C - 14);
    drawWaysDown(mctx, toScreen, scale, boxes, (sx, sy) => Math.hypot(sx - C, sy - C) < C - 14);
    drawMarks(mctx, toScreen);
    // names of the places whose heart is in view
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
  hint.className = 'hint'; hint.textContent = 'M or Esc to close · scroll to zoom · drag to move';   // HINT, below
  wrap.append(big, hint); document.body.appendChild(wrap);
  const bctx = big.getContext('2d');
  let world = null;                                   // the whole-world bake
  let view = { cx: 0, cz: 0, z: 1 }, fit = 1, open = false, drag = null, player = { x: 0, z: 0, yaw: 0 };
  // choosing a place (the Teleport spell): the world is shown even from underground,
  // and a click — not a drag — picks the spot
  let picking = null;
  const HINT = 'M or Esc to close · scroll to zoom · drag to move';
  const showLevel = () => level && !picking;
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  function size(){
    const d = DPR(); big.width = innerWidth * d; big.height = innerHeight * d;
    fit = Math.min(big.width, big.height) * 0.92 / SIZE;
  }
  const toBig = (x, z) => [big.width / 2 + (x - view.cx) * view.z, big.height / 2 + (z - view.cz) * view.z];
  function drawBig(){
    if (!open) return;
    const d = DPR(), W = big.width, H = big.height;
    if (showLevel()){                                   // underground: the level, north up
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.fillStyle = '#0b0a08'; bctx.fillRect(0, 0, W, H);
      bctx.save(); bctx.scale(d, d);
      const toB = (x, z) => { const [sx, sy] = toBig(x, z); return [sx / d, sy / d]; };
      drawLevel(bctx, toB, 0, view.z / d, 11);
      const [ax, ay] = toB(player.x, player.z);
      arrow(bctx, ax, ay, -player.yaw);
      label(bctx, level.name, W / d / 2, 28, 16, '#e8c75a');
      bctx.restore();
      return;
    }
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
    const toB = (x, z) => { const [sx, sy] = toBig(x, z); return [sx / d, sy / d]; };
    const boxes = [];
    drawSettlements(bctx, toB, view.z / d, boxes, (sx, sy) => sx > -80 && sy > -20 && sx < W / d + 80 && sy < H / d + 20);
    drawRuins(bctx, toB, view.z / d, boxes, (sx, sy) => sx > -80 && sy > -20 && sx < W / d + 80 && sy < H / d + 20);
    drawWaysDown(bctx, toB, view.z / d, boxes, (sx, sy) => sx > -80 && sy > -20 && sx < W / d + 80 && sy < H / d + 20);
    drawMarks(bctx, toB);
    // names, biggest places first; a name that would overlap one already
    // drawn waits for you to zoom in
    const here = placeAt(player.x, player.z);
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
    if (showLevel()){
      const { L } = level, lf = levelFit();
      view.z = Math.max(lf, Math.min(lf * 12, view.z));
      view.cx = Math.max(L.x0, Math.min(L.x0 + L.W * L.cell, view.cx)); view.cz = Math.max(L.z0, Math.min(L.z0 + L.H * L.cell, view.cz));
      return;
    }
    view.z = Math.max(fit, Math.min(fit * 24, view.z));
    const half = SIZE / 2;
    view.cx = Math.max(-half, Math.min(half, view.cx)); view.cz = Math.max(-half, Math.min(half, view.cz));
  }
  const levelFit = () => Math.min(big.width, big.height) * 0.92 / (Math.max(level.L.W, level.L.H) * level.L.cell);
  function openBig(px, pz, yaw){
    player = { x: px, z: pz, yaw };
    size(); open = true; wrap.classList.remove('hide');
    if (showLevel()){ view = { cx: px, cz: pz, z: levelFit() * 2 }; clampView(); drawBig(); return; }
    if (!world) world = bakeArea(-SIZE / 2, -SIZE / 2, SIZE, BIG_PX);
    view = { cx: 0, cz: 0, z: fit };
    drawBig();
  }
  function closeBig(){ open = false; wrap.classList.add('hide'); drag = null; picking = null; hint.textContent = HINT; big.style.cursor = ''; }
  // pick(cb, x, z, yaw): open the world map for choosing a spot; cb(x, z) on a click
  function pick(cb, px, pz, yaw){
    picking = cb;
    openBig(px, pz, yaw);
    hint.textContent = 'Click where you would go · scroll to zoom · drag to move · Esc to cancel';
    big.style.cursor = 'crosshair';
  }
  big.addEventListener('wheel', e => {
    e.preventDefault();
    const d = DPR(), mx = e.offsetX * d, my = e.offsetY * d;
    const wx = view.cx + (mx - big.width / 2) / view.z, wz = view.cz + (my - big.height / 2) / view.z;
    view.z *= Math.exp(-e.deltaY * 0.0015); clampView();
    view.cx = wx - (mx - big.width / 2) / view.z; view.cz = wz - (my - big.height / 2) / view.z;   // zoom about the cursor
    clampView(); drawBig();
  }, { passive: false });
  big.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: 0 }; big.setPointerCapture(e.pointerId); });
  big.addEventListener('pointermove', e => {
    if (!drag) return;
    const d = DPR();
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
    view.cx = drag.cx - (e.clientX - drag.x) * d / view.z; view.cz = drag.cz - (e.clientY - drag.y) * d / view.z;
    clampView(); drawBig();
  });
  big.addEventListener('pointerup', e => {
    const click = drag && drag.moved < 5;
    drag = null;
    if (!click || !picking) return;
    const d = DPR(), cb = picking;
    const wx = view.cx + (e.offsetX * d - big.width / 2) / view.z, wz = view.cz + (e.offsetY * d - big.height / 2) / view.z;
    closeBig();
    cb(wx, wz);
  });
  addEventListener('resize', () => { if (open){ const r = view.z / fit; size(); view.z = fit * r; clampView(); drawBig(); } });

  return {
    updatePlace, drawMini, openBig, closeBig, setLevel, reveal, pick,
    // the whole level at once (the Wizard Eye spell)
    revealAll(){
      if (!level) return;
      const { L } = level, near = k => { const i = k % L.W, j = (k / L.W) | 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++){ const q = (j + b) * L.W + i + a; if (i + a >= 0 && i + a < L.W && j + b >= 0 && j + b < L.H && L.open[q]) return true; } return false; };
      for (let k = 0; k < L.W * L.H; k++) if (!L.revealed[k] && near(k)){ L.revealed[k] = 1; paintCell(k); }   // the open ground and the rock that bounds it
    },
    get bigOpen(){ return open; },
    // while open, follow the player and the people moving about (a few times a second)
    tickBig(px, pz, yaw){ if (!open) return; player = { x: px, z: pz, yaw }; drawBig(); },
  };
}
