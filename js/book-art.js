// book-art.js — the drawn parts of your own book (js/book-view.js), after the board in
// (mocks/book notes.psd): pages with rounded corners, rough edges and cracks, a darker border
// and a thin white line inside it; the sheets beneath, fanned out and closing up at the spine;
// and a binding with a shape, its edges following the pages down to the spine.
//
// All of it hangs on one outline, so the page, the sheets and the board agree. Coordinates are
// the book's: a page is w × h, u runs from 0 at the spine to 1 at the fore-edge.
//   drawCover(canvas, geo)                  the board, spine and headbands; drawn once a size
//   drawSheets(canvas, geo, fLeft, fRight)  the sheets under each side (the book's share there); drawn each turn
//   makePapers(w, h)                        → Promise of { left: [url, url], right: [url, url] }
//   drawCrease(canvas, c, w, seed)          the folded corner, in the page's own style

const SCALE = () => Math.min(devicePixelRatio || 1, 1.5);
export const CORNER_R = .055;      // of the page's width

function rng(seed){
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// the book is seen from a little way down, so the head and foot curve the same way, not as
// mirror images (the red line in mocks/Screenshot 2026-11-02 at 11.49.50_PM.psd). The top edge
// falls steeply into the spine and a little toward the fore-edge. The bottom edge is an arch
// too: low at the fore-edge, high across the page, low again at the spine, with the sheets
// beneath showing under it, down to a block that's nearly flat
export const dipTop = (u, h) => h * (.046 * Math.exp(-u / .055) + .016 * u * u);
const ARCH_AT = .38;              // how far out from the spine the arch peaks
export const dipFoot = (u, h) => {
  const t = Math.max(0, Math.min(1, u));
  return h * .065 * Math.pow(Math.sin(Math.PI * Math.pow(t, Math.log(.5) / Math.log(ARCH_AT))), 1.25);
};
// how far the block of sheets shows below and beside the top page; f: the share of the book
// lying on that side. Never nothing, so the layers always show
export const blockFoot = (f, h) => h * (.03 + .035 * f);
export const blockSide = (f, w) => w * (.018 + .034 * f);
export const FOOT_LIP = h => blockFoot(1, h) + 16;     // the board's lip below the page's box
const INSET = 5, BOW = 3;          // px kept clear of the page's box; how far the fore-edge bows out

// a page's outline, for a right-hand page (spine at x = 0); mirror with flip(). Rough: a slow
// wander, a fine tremble and a few nicks; rough = 0 for the clean shape.
function outline(w, h, seed, rough = 1){
  const r = CORNER_R * w, u1 = (w - INSET - BOW - r) / w, pts = [];
  const push = (x, y) => pts.push([x, y]);
  const STEP = 4 / w;
  for (let u = 0; u < u1; u += STEP) push(u * w, INSET + dipTop(u, h));
  const cxT = u1 * w, cyT = INSET + dipTop(u1, h) + r;
  for (let a = -90; a < 0; a += 10) push(cxT + r * Math.cos(a * Math.PI / 180), cyT + r * Math.sin(a * Math.PI / 180));
  const cyB = h - INSET - dipFoot(u1, h) - r;
  for (let y = cyT; y < cyB; y += 4){ const t = (y - cyT) / (cyB - cyT); push(cxT + r + BOW * Math.sin(Math.PI * t), y); }
  for (let a = 0; a < 90; a += 10) push(cxT + r * Math.cos(a * Math.PI / 180), cyB + r * Math.sin(a * Math.PI / 180));
  for (let u = u1; u > 0; u -= STEP) push(u * w, h - INSET - dipFoot(u, h));
  push(0, h - INSET - dipFoot(0, h));
  if (!rough) return pts;

  const R = rng(seed), N = pts.length, wave = [0, 1, 2, 3].map(() => [R() * 6.28, 4 + R() * 26]);
  const nicks = Array.from({ length: 5 + Math.floor(R() * 4) }, () => [Math.floor(R() * N), 2 + R() * 3.5, 2 + R() * 3]);
  return pts.map(([x, y], i) => {
    const a = pts[Math.max(0, i - 2)], b = pts[Math.min(N - 1, i + 2)];
    const tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1, nx = ty / len, ny = -tx / len;     // outward
    let d = 0;
    for (const [ph, f] of wave) d += .34 * Math.sin(ph + i / N * f * 6.28);
    d += (R() - .5) * .7;
    for (const [at, width, deep] of nicks){ const k = Math.abs(i - at); if (k < width) d -= deep * (1 - k / width); }
    const spine = Math.min(1, x / (w * .02));                       // no wander where it's bound in
    return [x + nx * d * spine * rough, y + ny * d * spine * rough];
  });
}
const flip = (pts, w) => pts.map(([x, y]) => [w - x, y]);
function trace(g, pts, dx = 0, dy = 0){
  g.beginPath();
  pts.forEach(([x, y], i) => i ? g.lineTo(x + dx, y + dy) : g.moveTo(x + dx, y + dy));
  g.closePath();
}
function noiseTile(size, seed, alpha, colour = [40, 24, 8]){
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), im = g.createImageData(size, size), R = rng(seed);
  for (let i = 0; i < im.data.length; i += 4){
    im.data[i] = colour[0]; im.data[i + 1] = colour[1]; im.data[i + 2] = colour[2];
    im.data[i + 3] = R() * R() * alpha;
  }
  g.putImageData(im, 0, 0);
  return c;
}
// soft blotches: a small field of random cells, drawn large and smooth
function blotches(g, w, h, seed, cells, colour, alpha){
  const c = document.createElement('canvas'); c.width = cells; c.height = Math.ceil(cells * h / w);
  const q = c.getContext('2d'), im = q.createImageData(c.width, c.height), R = rng(seed);
  for (let i = 0; i < im.data.length; i += 4){
    const v = R();
    im.data[i] = colour[0]; im.data[i + 1] = colour[1]; im.data[i + 2] = colour[2];
    im.data[i + 3] = v > .62 ? (v - .62) / .38 * alpha : 0;
  }
  q.putImageData(im, 0, 0);
  g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, w, h); g.restore();
}

// ---- a page's paper
function paper(w, h, left, seed){
  const S = SCALE(), c = document.createElement('canvas');
  c.width = Math.round(w * S); c.height = Math.round(h * S);
  const g = c.getContext('2d'); g.scale(S, S);
  const raw = outline(w, h, seed), pts = left ? flip(raw, w) : raw, R = rng(seed * 7 + 1);
  const sx = u => left ? w - u * w : u * w;     // from the spine outward
  g.save();
  trace(g, pts); g.clip();

  // the sheet: warm ground, large soft stains, foxing, fibres, grain
  const ground = g.createRadialGradient(w * .5, h * .42, h * .05, w * .5, h * .46, h * .78);
  ground.addColorStop(0, '#f5e7bf'); ground.addColorStop(.62, '#ecd8a2'); ground.addColorStop(1, '#d9b877');
  g.fillStyle = ground; g.fillRect(0, 0, w, h);
  blotches(g, w, h, seed + 11, 7, [176, 122, 50], 46);
  blotches(g, w, h, seed + 12, 18, [176, 122, 50], 20);
  for (let i = 0; i < 26; i++){
    const x = R() * w, y = R() * h, rr = 1 + R() * R() * 7, f = g.createRadialGradient(x, y, 0, x, y, rr);
    f.addColorStop(0, `rgba(122,76,28,${.1 + R() * .24})`); f.addColorStop(1, 'rgba(122,76,28,0)');
    g.fillStyle = f; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g.lineWidth = .5;
  for (let i = 0; i < 260; i++){
    const x = R() * w, y = R() * h, a = R() * 6.28, l = 3 + R() * 12;
    g.strokeStyle = R() < .5 ? `rgba(90,60,24,${.05 + R() * .08})` : `rgba(255,248,226,${.06 + R() * .1})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.fillStyle = g.createPattern(noiseTile(220, seed + 3, 30, [96, 62, 20]), 'repeat'); g.fillRect(0, 0, w, h);

  // the edge: browned by handling, a border a little darker, a thin white line inside it. Each
  // is a stroke of the outline, clipped to the page, so only its inner half shows
  for (let k = 44; k > 4; k -= 4){ g.strokeStyle = 'rgba(112,72,28,.035)'; g.lineWidth = k; trace(g, pts); g.stroke(); }
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,252,238,.7)'; g.lineWidth = 8.5; trace(g, pts); g.stroke();
  g.strokeStyle = '#94703c'; g.lineWidth = 5; trace(g, pts); g.stroke();
  g.strokeStyle = '#5e4018'; g.lineWidth = 1.8; trace(g, pts); g.stroke();

  // cracks in from the edge, thickest at the outer corners and the foot of the spine: each a
  // dark split with a lit lip beside it
  const inward = (x, y) => { const dx = w / 2 - x, dy = h / 2 - y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  for (let i = 0; i < pts.length; i++){
    const [x, y] = pts[i], u = (left ? w - x : x) / w, v = y / h;
    const outer = u > .8 && (v < .16 || v > .84), foot = u < .3 && v > .86, head = u < .16 && v < .08;
    const p = outer ? .05 : foot ? .1 : head ? .03 : v > .85 ? .02 : .006;
    if (R() > p) continue;
    let [nx, ny] = inward(x, y), a = Math.atan2(ny, nx) + (R() - .5) * 1.1, l = 5 + R() * (foot ? 22 : 16);
    let cx = x, cy = y; const line = [[cx, cy]];
    for (let s = 0, n = 2 + Math.floor(R() * 3); s < n; s++){ a += (R() - .5) * .8; cx += Math.cos(a) * l / n; cy += Math.sin(a) * l / n; line.push([cx, cy]); }
    const draw = (dx, dy, style, lw) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); line.forEach(([px, py], k) => k ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy)); g.stroke(); };
    draw(.9, .9, 'rgba(255,250,232,.55)', .9);
    draw(0, 0, `rgba(84,54,20,${.28 + R() * .3})`, .8);
  }
  // the sheet rolling: over at the fore-edge, flat across the page, a lit ridge where it
  // lifts off the fold, then down into the shade of the spine
  const roll = g.createLinearGradient(sx(0), 0, sx(1), 0);
  for (const [u, col] of [[0, 'rgba(16,8,2,.96)'], [.012, 'rgba(24,12,3,.86)'], [.03, 'rgba(38,22,6,.74)'], [.07, 'rgba(58,34,10,.56)'],
    [.12, 'rgba(84,54,20,.36)'], [.18, 'rgba(110,76,34,.17)'], [.24, 'rgba(120,84,40,.03)'], [.29, 'rgba(255,250,232,.2)'], [.34, 'rgba(255,250,232,.24)'], [.42, 'rgba(255,248,226,.06)'], [.5, 'rgba(0,0,0,0)'],
    [.8, 'rgba(0,0,0,0)'], [.92, 'rgba(84,54,20,.1)'], [.98, 'rgba(58,34,10,.22)'], [1, 'rgba(38,22,6,.3)']]) roll.addColorStop(u, col);
  g.fillStyle = roll; g.fillRect(0, 0, w, h);
  // the shade pooling where the sheet dives at the head and foot of the spine
  for (const [y, ry] of [[0, h * .1], [h, h * .1]]){
    g.save(); g.translate(sx(0), y); g.scale(w * .3 / ry, 1);
    const p = g.createRadialGradient(0, 0, 0, 0, 0, ry);
    p.addColorStop(0, 'rgba(30,16,4,.6)'); p.addColorStop(1, 'rgba(30,16,4,0)');
    g.fillStyle = p; g.fillRect(-ry, -ry, ry * 2, ry * 2);
    g.restore();
  }
  // lit from above, a touch
  const down = g.createLinearGradient(0, 0, 0, h);
  down.addColorStop(0, 'rgba(255,246,220,.09)'); down.addColorStop(.3, 'rgba(0,0,0,0)'); down.addColorStop(.72, 'rgba(0,0,0,0)'); down.addColorStop(1, 'rgba(58,34,10,.14)');
  g.fillStyle = down; g.fillRect(0, 0, w, h);
  g.restore();
  return c;
}
const toUrl = c => new Promise(res => c.toBlob(b => res(URL.createObjectURL(b)), 'image/png'));
// two of each side, turn about, so the stains don't repeat from one leaf to the next
export async function makePapers(w, h){
  const [l0, l1, r0, r1] = await Promise.all([[true, 101], [true, 202], [false, 303], [false, 404]].map(([left, seed]) => toUrl(paper(w, h, left, seed))));
  return { left: [l0, l1], right: [r0, r1] };
}

// ---- the sheets under each side: the outline again and again, each lower and further out, so
// their edges lie in layers across the wedge under the top page, and closing up at the spine's
// side and the book's head. Deepest first; the top page's shadow falls on them last
export function drawSheets(canvas, geo, fLeft, fRight){
  const { w, h, padX, padY } = geo, S = SCALE(), g = canvas.getContext('2d');
  g.setTransform(S, 0, 0, S, 0, 0);
  g.clearRect(0, 0, canvas.width / S, canvas.height / S);
  g.translate(padX, padY);
  const TONES = ['#d9c799', '#bfa878', '#d0bc8c', '#b39b6b', '#d4c192', '#c4ad7d'];
  const Tmid = (blockFoot(fLeft, h) + blockFoot(fRight, h)) / 2;
  for (const [f, side] of [[fLeft, -1], [fRight, 1]]){
    const T = blockFoot(f, h), Tx = blockSide(f, w), n = Math.max(8, Math.round((T + dipFoot(ARCH_AT, h)) / 2.5));
    const shifted = (t, seed) => outline(w, h, seed, .5).map(([x, y]) => {
      const u = x / w, v = y / h, low = Math.min(1, Math.max(0, (v - .35) / .4));
      const px = x + t * Tx * Math.pow(u, .6) * (.35 + .65 * v);
      // the arch flattening, down to the block's base; both sides' blocks meet at one depth at the spine
      const near = Math.min(1, u / .16), base = Tmid + (T - Tmid) * near * near * (3 - 2 * near);
      const py = y + t * (dipFoot(u, h) * .85 + base) * low;
      return [w + side * px, py];
    });
    // the shadow of the whole block on the board
    g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 14; g.shadowOffsetX = side * 3; g.shadowOffsetY = 7;
    trace(g, shifted(1, 900)); g.fillStyle = '#3e2a12'; g.fill(); g.restore();
    for (let i = n; i >= 1; i--){
      trace(g, shifted(i / n, 500 + i * 13 + (side > 0 ? 7 : 0)));
      g.fillStyle = TONES[i % TONES.length]; g.fill();
      g.strokeStyle = `rgba(52,32,10,${.38 + .3 * (i / n)})`; g.lineWidth = .7; g.stroke();
    }
    // the block goes into the dark as it nears the spine
    g.save(); trace(g, shifted(1, 900)); g.clip();
    const dark = g.createLinearGradient(w, 0, w + side * w * .24, 0);
    dark.addColorStop(0, 'rgba(14,6,1,.96)'); dark.addColorStop(.14, 'rgba(22,10,2,.82)'); dark.addColorStop(.4, 'rgba(36,18,4,.46)'); dark.addColorStop(.75, 'rgba(46,26,8,.14)'); dark.addColorStop(1, 'rgba(46,26,8,0)');
    g.fillStyle = dark; g.fillRect(0, 0, 2 * w, h * 1.2);
    g.restore();
    // the top page, standing over the rest (the page itself lies on this)
    const top = outline(w, h, 77, 0).map(([x, y]) => [w + side * x, y]);
    g.save(); g.shadowColor = 'rgba(30,16,4,.8)'; g.shadowBlur = 8; g.shadowOffsetX = side * 2.5; g.shadowOffsetY = 4;
    trace(g, top); g.fillStyle = '#6b5026'; g.fill(); g.restore();
  }
  // the fold, down through the block to the board
  g.strokeStyle = '#080301'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(w, h * .97); g.lineTo(w, h + Tmid - 6); g.stroke();
}

// ---- the binding: calf over boards, its head and foot following the pages down to the spine
function rim(geo, inset){
  const { w, h, lipX, lipY, lipFoot, sag } = geo, r = Math.max(4, 18 - inset * .4), pts = [];
  const L = -lipX + inset, Rx = 2 * w + lipX - inset, T = -lipY + inset, B = h + lipFoot - inset;
  const head = x => T + sag * dipTop(Math.abs(x - w) / w, h);
  const foot = x => B + h * .016 * Math.exp(-Math.abs(x - w) / w / .1);   // its foot dips down to the spine
  for (let x = L + r; x <= Rx - r; x += 5) pts.push([x, head(x)]);
  for (let a = -90; a <= 0; a += 15) pts.push([Rx - r + r * Math.cos(a * Math.PI / 180), head(Rx - r) + r + r * Math.sin(a * Math.PI / 180)]);
  for (let a = 0; a <= 90; a += 15) pts.push([Rx - r + r * Math.cos(a * Math.PI / 180), foot(Rx - r) - r + r * Math.sin(a * Math.PI / 180)]);
  for (let x = Rx - r; x >= L + r; x -= 5) pts.push([x, foot(x)]);
  for (let a = 90; a <= 180; a += 15) pts.push([L + r + r * Math.cos(a * Math.PI / 180), foot(L + r) - r + r * Math.sin(a * Math.PI / 180)]);
  for (let a = 180; a <= 270; a += 15) pts.push([L + r + r * Math.cos(a * Math.PI / 180), head(L + r) + r + r * Math.sin(a * Math.PI / 180)]);
  return pts;
}
export function drawCover(canvas, geo){
  const { w, h, lipX, lipY, lipFoot, padX, padY } = geo, S = SCALE(), g = canvas.getContext('2d');
  g.setTransform(S, 0, 0, S, 0, 0);
  g.clearRect(0, 0, canvas.width / S, canvas.height / S);
  g.translate(padX, padY);
  const outer = rim(geo, 0);
  // the thickness of the board, under its shadow on whatever it lies on
  g.save(); g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 34; g.shadowOffsetY = 20;
  trace(g, outer, 0, 6); g.fillStyle = '#120904'; g.fill(); g.restore();
  trace(g, outer, 0, 5); g.fillStyle = '#1e1006'; g.fill();
  trace(g, outer, 0, 3); g.fillStyle = '#2e1a0b'; g.fill();

  g.save(); trace(g, outer); g.clip();
  const X = -lipX, Y = -lipY, W = 2 * w + 2 * lipX, H = h + lipY + lipFoot + h * .02;
  const hide = g.createRadialGradient(X + W * .3, Y + H * .25, 0, X + W * .4, Y + H * .4, W * .75);
  hide.addColorStop(0, '#80502a'); hide.addColorStop(.5, '#60371b'); hide.addColorStop(1, '#3e200e');
  g.fillStyle = hide; g.fillRect(X, Y, W, H);
  g.save(); g.translate(X, Y); blotches(g, W, H, 31, 16, [20, 8, 2], 130); blotches(g, W, H, 32, 60, [20, 8, 2], 70); g.restore();
  g.fillStyle = g.createPattern(noiseTile(180, 33, 150, [14, 6, 2]), 'repeat'); g.fillRect(X, Y, W, H);
  g.fillStyle = g.createPattern(noiseTile(90, 34, 30, [255, 216, 170]), 'repeat'); g.fillRect(X, Y, W, H);
  // the hollow of the spine between the boards, and a hinge groove each side of it
  const hollow = g.createLinearGradient(w - 26, 0, w + 26, 0);
  for (const [t, c] of [[0, 'rgba(0,0,0,0)'], [.14, 'rgba(10,4,1,.55)'], [.24, 'rgba(120,76,40,.35)'], [.36, 'rgba(14,6,2,.75)'], [.5, 'rgba(6,3,1,.95)'], [.64, 'rgba(14,6,2,.75)'], [.76, 'rgba(120,76,40,.35)'], [.86, 'rgba(10,4,1,.55)'], [1, 'rgba(0,0,0,0)']]) hollow.addColorStop(t, c);
  g.fillStyle = hollow; g.fillRect(w - 26, Y, 52, H);
  // tooling: a gilt fillet and a blind one, following the board's own shape
  trace(g, rim(geo, 7)); g.strokeStyle = 'rgba(218,178,92,.72)'; g.lineWidth = 1.3; g.stroke();
  trace(g, rim(geo, 7), 0, 1); g.strokeStyle = 'rgba(16,6,2,.5)'; g.lineWidth = .8; g.stroke();
  trace(g, rim(geo, 12)); g.strokeStyle = 'rgba(14,6,2,.5)'; g.lineWidth = 2; g.stroke();
  // the worn, lit edge of the board
  trace(g, outer); g.strokeStyle = 'rgba(214,160,104,.45)'; g.lineWidth = 2; g.stroke();
  g.restore();

  // the headband: the stitched cord at the head of the spine, seen in the gap between the pages
  const bw = 16, hh = dipTop(0, h) * .7 + 6, y = INSET + dipTop(0, h) * .55 - 4;
  g.fillStyle = '#1a0c04'; g.fillRect(w - bw - 2, y - 2, bw * 2 + 4, hh + 4);
  for (let x = -bw; x < bw; x += 3){
    g.fillStyle = (x + 16) % 6 < 3 ? '#8a2a1c' : '#d2b46a';
    g.fillRect(w + x, y, 2.4, hh);
  }
  const shade = g.createLinearGradient(w - bw, 0, w + bw, 0);
  shade.addColorStop(0, 'rgba(0,0,0,.7)'); shade.addColorStop(.5, 'rgba(0,0,0,.15)'); shade.addColorStop(1, 'rgba(0,0,0,.7)');
  g.fillStyle = shade; g.fillRect(w - bw, y, bw * 2, hh);
}

// ---- the page's corner, folded over: the same paper, rough edge and browned border as the
// page, with a rounded tip and a soft fold. For a top-right corner, in a box c across whose top
// right is the page's corner; book.css mirrors it for the left page. w: the page's width
export function drawCrease(canvas, c, w, seed){
  const S = SCALE(), g = canvas.getContext('2d'), R = rng(seed);
  canvas.width = canvas.height = Math.round(c * S);
  g.setTransform(S, 0, 0, S, 0, 0);
  const r = CORNER_R * w, M = c * .1;                      // the page's corner radius; room for the shadow
  const A = [c * .36 + M * .2, M * .1], B = [c - M * .1, c * .62], tip = [c * .4, c * .62];
  const quad = (p, q, e, n = 14) => Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
    return [a * p[0] + b * q[0] + d * e[0], a * p[1] + b * q[1] + d * e[1]];
  });
  const jitter = pts => pts.map(([x, y]) => [x + (R() - .5) * .9, y + (R() - .5) * .9]);
  // the fold, bowed a little toward the corner, and the flap's two free edges meeting in a round tip
  const fold = jitter(quad(B, [c * .72, c * .26], A));
  const near = [tip[0] + c * .02, tip[1] - c * .17], far = [tip[0] + c * .17, tip[1] + c * .03];
  const free = jitter([...quad(A, [c * .37, c * .24], near), ...quad(near, [tip[0] - c * .01, tip[1] + c * .03], far), ...quad(far, [c * .78, c * .66], B)]);
  // what the fold uncovers: the next sheet's corner, in shade, with its own rough edge
  const corner = jitter([[A[0], M * .1], [c - r, M * .1],
    ...Array.from({ length: 9 }, (_, i) => { const a = (-90 + i * 10) * Math.PI / 180; return [c - r + r * Math.cos(a), r + r * Math.sin(a)]; }), B]);
  g.save(); trace(g, [...corner, ...fold]); g.clip();
  const under = g.createLinearGradient(c * .62, c * .38, c, 0);
  under.addColorStop(0, '#6e5026'); under.addColorStop(.35, '#a98c5a'); under.addColorStop(1, '#d4bd8c');
  g.fillStyle = under; g.fillRect(0, 0, c, c);
  g.fillStyle = g.createPattern(noiseTile(90, seed + 3, 40, [96, 62, 20]), 'repeat'); g.fillRect(0, 0, c, c);
  g.strokeStyle = 'rgba(94,64,24,.8)'; g.lineWidth = 2.4; g.beginPath(); corner.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  g.restore();

  // the flap's soft shadow on the page, then the flap: warm paper, lit along the fold and browning
  // toward its tip, grained, with the page's border on its free edges
  const flap = [...free, ...fold];
  g.save(); g.shadowColor = 'rgba(40,22,6,.6)'; g.shadowBlur = c * .13; g.shadowOffsetX = -c * .035; g.shadowOffsetY = c * .05;
  trace(g, flap); g.fillStyle = '#c9ae78'; g.fill(); g.restore();
  g.save(); trace(g, flap); g.clip();
  const light = g.createLinearGradient(c * .72, c * .26, c * .42, c * .6);
  light.addColorStop(0, '#f4e7c2'); light.addColorStop(.3, '#ecd9a8'); light.addColorStop(.75, '#dcc28c'); light.addColorStop(1, '#c9a970');
  g.fillStyle = light; g.fillRect(0, 0, c, c);
  blotches(g, c, c, seed + 5, 5, [176, 122, 50], 46);
  g.fillStyle = g.createPattern(noiseTile(90, seed + 4, 30, [96, 62, 20]), 'repeat'); g.fillRect(0, 0, c, c);
  const edge = (lw, style) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); free.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); };
  g.lineJoin = 'round';
  for (let k = 16; k > 3; k -= 3) edge(k, 'rgba(112,72,28,.05)');
  edge(5.5, 'rgba(255,252,238,.55)'); edge(3.2, '#94703c'); edge(1.3, '#5e4018');
  g.restore();
  // the fold itself, a soft crease rather than a line
  const crease = (lw, style) => { g.strokeStyle = style; g.lineWidth = lw; g.beginPath(); fold.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); };
  g.lineCap = 'round';
  crease(2.6, 'rgba(255,248,226,.32)'); crease(1, 'rgba(84,54,20,.4)');
}
