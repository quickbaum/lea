// headscan.js — find the head in a baked sprite cell from its own pixels.
//
// The painted-face card must sit on the sprite's head wherever it actually is —
// which differs per walk frame (the head sways side to side) and, for sprites
// baked at runtime, can't be hardcoded. Two signals are rock-solid for any head,
// bald or haired: the CROWN (topmost opaque row) and the head-CENTRE-X (over a
// band just below the crown). Head *height* is NOT reliable — a haired head's
// silhouette drapes to the shoulders with no neck to find — so the card is
// anchored to the crown with a global size/drop rather than a detected height.
//
// scanAtlas(image, m, rows) → boxes[row][col] = { top, cx, w } in cell-local
// pixels. Used by npc.js (in-world placement) and face-placement.html (the tuner)
// so both agree.

const ALPHA = 25;

// Detect the head anchor within one cell of an atlas whose RGBA pixels are
// `data` (row-major, atlas width `W`), the cell at (x0,y0) sized cw×ch.
export function detectHeadBox(data, W, x0, y0, cw, ch){
  const rowInfo = y => {
    let n = 0, l = cw, r = -1;
    const base = ((y0 + y) * W + x0) * 4 + 3;
    for (let x = 0; x < cw; x++){
      if (data[base + x * 4] > ALPHA){ n++; if (x < l) l = x; if (x > r) r = x; }
    }
    return { n, l, r };
  };

  let top = -1;
  for (let y = 0; y < ch; y++){ if (rowInfo(y).n > 0){ top = y; break; } }
  if (top < 0) return null;

  // Centre x over a band just below the crown (the head, above the shoulders), so
  // it follows the walk-sway without being pulled by the widening shoulders.
  const band = Math.round(ch * 0.14);
  let l = cw, r = -1;
  for (let y = top; y <= Math.min(top + band, ch - 1); y++){
    const w = rowInfo(y); if (w.n){ if (w.l < l) l = w.l; if (w.r > r) r = w.r; }
  }
  return { top, cx: (l + r) / 2, w: r - l };
}

// Sample the sprite's actual face-skin colour from the front standing cell — a
// pair of cheek patches beside the nose, skipping dark (eyes/shadow/hair) and
// near-white (sclera/highlight) pixels. Used to tint the painted face's skin
// coverage so it blends over the baked head, instead of trusting the baked
// `skin` value in lea_clan.json (which mis-sampled the garment). Returns [r,g,b]
// or null.
export function sampleFaceSkin(image, m){
  const cw = m.frameW, ch = m.frameH, W = m.cols * cw, H = m.rows * ch;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(image, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;
  const box = detectHeadBox(data, W, 0, 0, cw, ch);
  if (!box) return null;

  const y0 = box.top + Math.round(ch * 0.08), y1 = box.top + Math.round(ch * 0.16);
  const off = Math.max(6, Math.round(box.w * 0.28));   // out to the cheeks
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y <= y1; y++){
    for (const sx of [box.cx - off, box.cx + off]){
      const x = Math.round(sx); if (x < 0 || x >= cw) continue;
      const i = (y * W + x) * 4;
      if (data[i + 3] < 128) continue;
      const lum = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
      if (lum < 55 || lum > 235) continue;              // skip eyes/shadow and sclera/highlight
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

// Scan an atlas image for the given rows (front sectors), all columns.
// Returns boxes[row][col]; null cells where nothing was found.
export function scanAtlas(image, m, rows = [0, 1]){
  const cols = m.cols, cw = m.frameW, ch = m.frameH;
  const W = cols * cw, H = m.rows * ch;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(image, 0, 0, W, H);
  const data = cx.getImageData(0, 0, W, H).data;

  const boxes = {};
  for (const row of rows){
    boxes[row] = [];
    for (let col = 0; col < cols; col++){
      boxes[row][col] = detectHeadBox(data, W, col * cw, row * ch, cw, ch);
    }
  }
  return boxes;
}
