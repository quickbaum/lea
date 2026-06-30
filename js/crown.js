// crown.js — procedural flower crown generator.
// Takes a list of flower species IDs (integers), loads their ground-sprite images,
// and arranges them in a semicircle arc on a canvas. Used both for the in-world
// sprite texture update (wearCrown) and as a portrait overlay.

const CROWN_W = 205, CROWN_H = 150;

// Portrait overlay params — used by wojak.face() when compositing the crown
export const PORTRAIT_SCALE   = 376;  // crown width in portrait pixels (portrait is 100×100)
export const PORTRAIT_ANCHOR_X = 0.94; // horizontal centre (0=left edge, 1=right edge)
export const PORTRAIT_BOTTOM_Y = 22;  // y of the CROWN_H bottom edge in the portrait
const ARC_CX  = 86, ARC_CY = 167;   // arc centre — below the canvas bottom
const ARC_R   = 18;                  // radius of the arc
const FLOWER_SIZE = 10;               // rendered width of each flower (px)

const _cache = new Map();

function loadFlower(id){
  if (_cache.has(id)) return _cache.get(id);
  const p = new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `flowers/heads/flowers${id}.png`;
  });
  _cache.set(id, p);
  return p;
}

// generateCrown(flowerIds) → Promise<HTMLCanvasElement>
// flowerIds: array of integer species IDs (e.g. [5, 7, 14, 27, 45, 16, 49])
// Canvas may be taller than CROWN_H when arc centre is below the edge — cv._nominalH
// tells wearCrown how much vertical space to budget so scale/position stay correct.
export async function generateCrown(flowerIds){
  const imgs = await Promise.all(flowerIds.map(loadFlower));
  const overflow = Math.max(0, ARC_CY + FLOWER_SIZE - CROWN_H + 4);
  const cv = document.createElement('canvas');
  cv.width = CROWN_W; cv.height = CROWN_H + overflow;
  cv._nominalH = CROWN_H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, CROWN_W, CROWN_H + overflow);
  const n = flowerIds.length;
  // Sweep from 148° (left side) to 32° (right side) in canvas coords:
  //   x = ARC_CX + ARC_R·cos(a)
  //   y = ARC_CY − ARC_R·sin(a)   (y-down, so subtract)
  for (let i = 0; i < n; i++){
    const img = imgs[i]; if (!img) continue;
    const deg = 150 - (134 / Math.max(n - 1, 1)) * i;
    const rad = deg * Math.PI / 180;
    const cx  = ARC_CX + ARC_R * Math.cos(rad);
    const cy  = ARC_CY - ARC_R * Math.sin(rad);
    const iw  = img.naturalWidth  || img.width  || 1;
    const ih  = img.naturalHeight || img.height || 1;
    const fw  = FLOWER_SIZE;
    const fh  = Math.round(ih * (fw / iw));
    ctx.drawImage(img, Math.round(cx - fw / 2), Math.round(cy - fh / 2), fw, fh);
  }
  return cv;
}
