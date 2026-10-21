// crown.js — procedural flower crown generator.
// Takes a list of flower species IDs (integers), loads their ground-sprite images,
// and arranges them in a semicircle arc on a canvas. Used both for the in-world
// sprite texture update (wearCrown) and as a portrait overlay.
//
// Tunables live in crown_params.json (edited by crown-tuner.html via
// /api/save-crown-params — same pattern as walk_params.json / outfit.json).
// The defaults below only apply if the file is missing or unreadable.

const DEFAULTS = {
  cvW: 205, cvH: 150,        // crown canvas size
  arcX: 86, arcY: 167,       // arc centre — below the canvas bottom
  arcR: 18,                  // radius of the arc
  angS: 150, angP: 134,      // angle sweep: start° and span° (150° → 16°)
  flSz: 10,                  // rendered width of each flower (px)
  pSc: 376,                  // portrait overlay: crown width in portrait px (portrait is 100×100)
  pAx: 0.94,                 // portrait overlay: horizontal centre (0=left edge, 1=right edge)
  pBy: 22,                   // portrait overlay: y of the crown's bottom edge
};
let P = DEFAULTS;
try {
  P = { ...DEFAULTS, ...(await (await fetch('crown_params.json')).json()) };
} catch (_) { /* no params file yet — the defaults above match the last tuning */ }

// Portrait overlay params — used by wojak.face() when compositing the crown
export const PORTRAIT_SCALE    = P.pSc;
export const PORTRAIT_ANCHOR_X = P.pAx;
export const PORTRAIT_BOTTOM_Y = P.pBy;

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
// Canvas may be taller than cvH when arc centre is below the edge — cv._nominalH
// tells wearCrown how much vertical space to budget so scale/position stay correct.
export async function generateCrown(flowerIds){
  const imgs = await Promise.all(flowerIds.map(loadFlower));
  const overflow = Math.max(0, P.arcY + P.flSz - P.cvH + 4);
  const cv = document.createElement('canvas');
  cv.width = P.cvW; cv.height = P.cvH + overflow;
  cv._nominalH = P.cvH;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, P.cvW, P.cvH + overflow);
  const n = flowerIds.length;
  // Sweep from angS° (left side) down through angP° in canvas coords:
  //   x = arcX + arcR·cos(a)
  //   y = arcY − arcR·sin(a)   (y-down, so subtract)
  for (let i = 0; i < n; i++){
    const img = imgs[i]; if (!img) continue;
    const deg = P.angS - (P.angP / Math.max(n - 1, 1)) * i;
    const rad = deg * Math.PI / 180;
    const cx  = P.arcX + P.arcR * Math.cos(rad);
    const cy  = P.arcY - P.arcR * Math.sin(rad);
    const iw  = img.naturalWidth  || img.width  || 1;
    const ih  = img.naturalHeight || img.height || 1;
    const fw  = P.flSz;
    const fh  = Math.round(ih * (fw / iw));
    ctx.drawImage(img, Math.round(cx - fw / 2), Math.round(cy - fh / 2), fw, fh);
  }
  return cv;
}
