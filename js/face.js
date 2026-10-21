// face.js — painted modular face compositor.
//
// Stacks the hand-painted face parts over the 3D-baked Lea head to turn the
// void-faced grey clay into a person. Every part is an independent PNG in
// sprites/face/, drawn against the same 808×820 frontal head template, so parts
// always line up. Modular by design: each part has several variants (hair1..7,
// noses1..5, …); a face is a pick of one variant per slot plus a skin tone and
// hair/iris hues. Thousands of identities from a small kit, at near-zero cost.
//
// Skin colour is handled by tinting, not by the parts: base + shading are
// composited grey, then the skin region (sprites/face/skin_mask.png) is recast
// onto a per-persona, race-aware flesh tone by luminance — so the weather/light
// baked into the template no longer shows, and the painted shading survives as
// darker/lighter flesh. Feature parts (eyes, nose, brows, hair…) draw on top.
//
// This is the seed of the future portrait source — once it proves out it
// replaces wojak.js's dialog portraits, in the painted style, matched to the
// in-world sprite. faceParts(rng, race) rolls a deterministic descriptor so a
// given WORLD_SEED always yields the same faces.

const DIR = 'sprites/face/';

// Natural template size the parts were painted at.
export const FACE_W = 808, FACE_H = 820;

// Per-race skin palettes (sRGB). Skin tone is a per-persona trait rolled from
// these, matching how the village mixes human/elf/dwarf/goblin.
export const RACES = ['human', 'elf', 'dwarf', 'goblin'];
const SKIN = {
  human:  [[236, 201, 169], [224, 181, 142], [201, 152, 116], [170, 122, 90], [135, 96, 70]],
  elf:    [[240, 222, 205], [228, 203, 184], [210, 182, 166], [224, 196, 205]],  // fair, some rosy
  dwarf:  [[226, 180, 146], [206, 156, 120], [184, 132, 100], [164, 112, 84]],   // ruddy tan
  goblin: [[150, 166, 96], [126, 150, 80], [104, 134, 68], [120, 158, 92]],      // olive/green
};
// Mean luminance of the base head's skin region (measured once); tints scale
// relative to this so the baked shading survives the recolour.
const SKIN_LREF = 0.5;

// skinTone(rng, race) → [r,g,b]: pick a palette entry and jitter its lightness a
// little so two peasants of the same race rarely share an exact tone.
export function skinTone(rng = Math.random, race = 'human'){
  const pal = SKIN[race] || SKIN.human;
  const base = pal[Math.floor(rng() * pal.length)];
  const k = 0.9 + rng() * 0.2;                      // ±10% lightness
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  return [cl(base[0] * k), cl(base[1] * k), cl(base[2] * k)];
}

// Natural colour palettes (hex) for the seeded faces. Hair drives brows, beard,
// moustache and hair together. The lab colour pickers can override either.
export const HAIR_COLORS = ['#14110f', '#2e211a', '#4a3527', '#6b4a2e', '#7b4b2a',
                            '#6e3b2a', '#b5651d', '#c9a45b', '#8a8580', '#cfc9c0'];
export const EYE_COLORS  = ['#5b3a1e', '#3a2416', '#8a5a22', '#4a6d8c', '#3f6f7a',
                            '#4f7a52', '#6e5a34', '#6a6a6a'];
const pickHex = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// hexToHsl('#rrggbb') → [h,s,l] each 0..1.
export function hexToHsl(hex){
  const n = parseInt(hex.slice(1), 16);
  return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

// The face parts, in draw order (bottom→top). Fields:
//   count    — number of variants (files are name1.png..nameN.png; a count of 1
//              is the bare name.png).
//   skin     — part of the skin group: composited grey then recoloured by the
//              flesh tint (base head + broad shading), rather than drawn on top.
//   hue      — 'hair' | 'iris': this part's colour hue-rotates for variety.
//   optional — probability the part is absent for a given face (e.g. bald, or no
//              beard). Skin parts and core features are never optional.
//   tint     — 'hair' | 'iris': recolour this part to the persona's hair or eye
//              colour (full HSL, so black line-art can become any colour). The
//              four hair parts (brows, moustache, beards, hair) share one colour.
//   blend    — canvas globalCompositeOperation for the part (e.g. 'multiply' so
//              wrinkles darken the skin beneath instead of sitting on it as grey).
export const LAYERS = [
  { name: 'base',      count: 1, skin: true },
  { name: 'face',      count: 1, skin: true },                 // broad skin shading
  { name: 'chins',     count: 3, skin: true },                 // jaw shading/shape
  { name: 'wrinkles',  count: 1, blend: 'multiply' },
  { name: 'noses',     count: 5 },
  { name: 'eyes',      count: 3 },                             // sclera
  { name: 'eyeballs',  count: 1, tint: 'iris' },              // irises
  { name: 'mouths',    count: 4 },
  { name: 'moustache', count: 4, optional: 0.55, tint: 'hair' },
  { name: 'beards',    count: 5, optional: 0.55, tint: 'hair' },
  { name: 'brows',     count: 4, tint: 'hair' },
  { name: 'hair',      count: 7, optional: 0.12, tint: 'hair' },  // sometimes bald
];

const _cache = new Map();   // 'hair3' -> Promise<Image|null>

// File for a part variant: bare name.png when the part has a single variant,
// else numbered name{idx}.png.
function fileFor(L, idx){ return `${L.name}${L.count > 1 ? idx : ''}.png`; }

function loadLayer(L, idx){
  const src = fileFor(L, idx);
  if (_cache.has(src)) return _cache.get(src);
  const p = new Promise(res => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = () => res(null);   // missing variant → skip, don't break the stack
    img.src = DIR + src;
  });
  _cache.set(src, p);
  return p;
}

// faceParts(rng, { race, gender, tone }) → descriptor. For each variant part, an
// index 1..count (or 0 when an optional part is absent). Plus race, tone [r,g,b],
// hairColor, eyeColor, and wrinkleAmt (0..1 crease strength, later tied to age).
// Women get no beard/moustache. tone, if given (e.g. a baked body's skin), is
// used verbatim so the face matches the body; otherwise rolled from the race
// palette. All off the provided rng, so faces are stable per seed.
export function faceParts(rng = Math.random, { race = 'human', gender = 'male', tone = null } = {}){
  const d = { race, gender };
  for (const L of LAYERS){
    if (L.name === 'base') continue;                 // always present, single
    const femaleHair = gender === 'female' && (L.name === 'beards' || L.name === 'moustache');
    if (femaleHair || (L.optional && rng() < L.optional)){ d[L.name] = 0; continue; }
    d[L.name] = L.count > 1 ? 1 + Math.floor(rng() * L.count) : 1;
  }
  d.hairColor   = pickHex(rng, HAIR_COLORS);   // shared by brows/beard/moustache/hair
  d.eyeColor    = pickHex(rng, EYE_COLORS);
  d.tone        = tone || skinTone(rng, race);
  d.wrinkleAmt  = Math.round(100 * rng() ** 1.8) / 100;   // biased toward smooth (young)
  return d;
}

// composeFace(parts, opts) → Promise<HTMLCanvasElement>.
// opts.size — output height in px (default full template height).
// opts.work — internal working height for the pixel passes (default = size).
//             Smaller is much faster (used when baking many NPC portraits).
export async function composeFace(parts = {}, opts = {}){
  const size = opts.size || FACE_H;
  const outScale = size / FACE_H;
  const w = Math.round(FACE_W * outScale), h = Math.round(FACE_H * outScale);

  // Working resolution for all the pixel work (layers are scaled down onto it).
  const wh = Math.round(opts.work || size);
  const ww = Math.round(FACE_W * (wh / FACE_H));

  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');

  const wc = document.createElement('canvas');
  wc.width = ww; wc.height = wh;
  const wx = wc.getContext('2d');
  const tcv = document.createElement('canvas');       // scratch for recolours
  tcv.width = ww; tcv.height = wh;
  const tctx = tcv.getContext('2d');

  // Overlay mode (opts.overlay): for laying over an existing (baked) head
  // in-world. Skips the base head (the sprite provides the head), but DOES draw
  // the skin coverage — the broad `face` shading + the `chins` shape — tinted to
  // the sprite's own skin tone, so it hides the baked head's face and gives the
  // painted features a clean surface. Wrinkles then blend normally (dark creases
  // over that skin, no multiply).
  if (opts.overlay){
    for (const L of LAYERS){
      if (!L.skin || L.name === 'base') continue;   // face + chins, not the full head
      const idx = parts[L.name] || 1;
      const img = await loadLayer(L, idx);
      if (img) wx.drawImage(img, 0, 0, ww, wh);
    }
    if (parts.tone) tintByLuminance(wx, parts.tone);
  } else {
    const maskImg = await loadSkinMask();
    const mask = maskImg ? rasterizeMask(maskImg, ww, wh) : null;

    // 1) Skin group. Draw the base head, soften its baked shading so the painted
    //    shading owns the form, then draw the broad face shading — all grey, to be
    //    recoloured in one pass. The chin is handled after the tint (below).
    for (const L of LAYERS){
      if (!L.skin || L.name === 'chins') continue;
      const idx = L.name === 'base' ? 1 : (parts[L.name] || 1);
      const img = await loadLayer(L, idx);
      if (!img) continue;
      wx.drawImage(img, 0, 0, ww, wh);
      if (L.name === 'base' && mask) softenBase(wx, mask);
    }
    // 2) Recast the skin region onto the flesh tone (shading preserved).
    if (parts.tone && mask) tintSkin(wx, mask, parts.tone);

    // 2b) Chin: stamp it as an opaque flesh patch over the tinted face, so it fully
    //     covers the base jaw beneath and reads as the same skin as the face
    //     (independent of the skin mask, which the jaw can fall below).
    const chinL = LAYERS.find(L => L.name === 'chins');
    if (parts.tone && parts.chins){
      const chinImg = await loadLayer(chinL, parts.chins);
      if (chinImg) stampChin(wx, tctx, chinImg, parts.tone);
    }
  }

  // 3) Feature parts on top: honour absence, recolour hair/iris parts to their
  //    HSL colour, apply any blend mode (wrinkles multiply), and scale wrinkle
  //    strength by the persona's wrinkle amount (0 = smooth, 1 = full).
  for (const L of LAYERS){
    if (L.skin) continue;
    const idx = parts[L.name];
    if (idx === 0 || (idx === undefined && L.optional)) continue;   // absent
    const img = await loadLayer(L, idx || 1);
    if (!img) continue;

    const hex = L.tint === 'hair' ? parts.hairColor : L.tint === 'iris' ? parts.eyeColor : null;
    wx.globalCompositeOperation = opts.overlay ? 'source-over' : (L.blend || 'source-over');
    wx.globalAlpha = L.name === 'wrinkles' ? (parts.wrinkleAmt ?? 1) : 1;
    if (hex){
      tctx.clearRect(0, 0, ww, wh);
      tctx.drawImage(img, 0, 0, ww, wh);
      colorize(tctx, hexToHsl(hex));
      wx.drawImage(tcv, 0, 0);
    } else {
      wx.drawImage(img, 0, 0, ww, wh);
    }
  }
  wx.globalCompositeOperation = 'source-over';
  wx.globalAlpha = 1;

  ctx.drawImage(wc, 0, 0, w, h);
  return cv;
}

// The head region within the 808×820 template (hair-top to chin, ear to ear),
// used to crop a face down to just the head for the in-world sprite face card.
export const HEAD_RECT = { x: 250, y: 40, w: 316, h: 402 };

// composeHead(parts, opts) → Promise<HTMLCanvasElement> cropped to the head only
// (transparent around it), for use as a billboard texture over the baked sprite
// head. Same options as composeFace (size/work).
export async function composeHead(parts = {}, opts = {}){
  const full = await composeFace(parts, opts);
  const s = full.height / FACE_H;
  const sx = Math.round(HEAD_RECT.x * s), sy = Math.round(HEAD_RECT.y * s);
  const sw = Math.round(HEAD_RECT.w * s), sh = Math.round(HEAD_RECT.h * s);
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  c.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

// The skin-region mask (sprites/face/skin_mask.png) marks the base head's bare
// skin. The Image is cached; rasterizeMask draws it to the working size and
// returns the pixel data (R channel = mask), so any work resolution is fine.
let _maskP = null;
function loadSkinMask(){
  if (_maskP) return _maskP;
  _maskP = new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);   // no mask → skip tinting, base shows as-is
    img.src = `${DIR}skin_mask.png`;
  });
  return _maskP;
}
function rasterizeMask(img, w, h){
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0, w, h);
  return cx.getImageData(0, 0, w, h).data;
}

// Recast every non-transparent pixel onto `tone` by its luminance (no mask),
// keeping alpha — used in overlay mode to cast the grey skin-coverage (face +
// chins) onto the sprite's own skin tone so it blends over the baked head.
function tintByLuminance(ctx, [tr, tg, tb]){
  const { width: w, height: h } = ctx.canvas;
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const k = l / SKIN_LREF;
    d[i] = cl(tr * k); d[i + 1] = cl(tg * k); d[i + 2] = cl(tb * k);
  }
  ctx.putImageData(im, 0, 0);
}

// Recast the skin-mask pixels onto `tone`, scaling by each pixel's luminance
// relative to the reference so the baked/painted shading still reads. Non-skin
// and transparent pixels are left untouched.
function tintSkin(ctx, mask, [tr, tg, tb]){
  const { width: w, height: h } = ctx.canvas;
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  for (let i = 0; i < d.length; i += 4){
    if (mask[i] < 128 || d[i + 3] === 0) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const k = l / SKIN_LREF;
    d[i] = cl(tr * k); d[i + 1] = cl(tg * k); d[i + 2] = cl(tb * k);
  }
  ctx.putImageData(im, 0, 0);
}

// Recolour a part to a target [h,s,l]. Unlike a hue rotation (which does nothing
// to black or grey line-art), this sets hue + saturation for every opaque pixel
// and centres lightness on the target, preserving the part's own relative
// shading around it — so black hair can become blond, red, grey, anything.
function colorize(ctx, [th, ts, tl]){
  const { width: w, height: h } = ctx.canvas;
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    sum += (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; n++;
  }
  const meanL = n ? sum / n : 0.5;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const nl = Math.max(0, Math.min(1, tl + (l - meanL) * 1.2));   // shading around target
    const rgb = hslToRgb(th, ts, nl);
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
  }
  ctx.putImageData(im, 0, 0);
}

// Stamp a chin variant as an opaque flesh patch over the already-tinted face.
// Wherever the chin has coverage, overwrite the working canvas with the skin
// tone carrying the chin's own relative shading, fully opaque — so the base jaw
// beneath is covered and the chin reads as the same skin as the face.
function stampChin(wx, tctx, img, [tr, tg, tb]){
  const { width: w, height: h } = wx.canvas;
  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(img, 0, 0, w, h);
  const cd = tctx.getImageData(0, 0, w, h).data;
  const lum = i => (cd[i] * 0.3 + cd[i + 1] * 0.59 + cd[i + 2] * 0.11) / 255;
  let sum = 0, n = 0;
  for (let i = 0; i < cd.length; i += 4){ if (cd[i + 3] > 20){ sum += lum(i); n++; } }
  const mean = n ? sum / n : SKIN_LREF;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  const wd = wx.getImageData(0, 0, w, h), d = wd.data;
  for (let i = 0; i < cd.length; i += 4){
    if (cd[i + 3] < 20) continue;                              // outside the chin shape
    const k = (SKIN_LREF + (lum(i) - mean) * 0.8) / SKIN_LREF; // shading around the tone
    d[i] = cl(tr * k); d[i + 1] = cl(tg * k); d[i + 2] = cl(tb * k); d[i + 3] = 255;
  }
  wx.putImageData(wd, 0, 0);
}

// Pull the base head's skin luminance toward the reference, halving its baked
// top-light/jaw shading so the painted shading (face/chins/wrinkles) provides
// the form instead of doubling up with the template's own shadows.
function softenBase(ctx, mask){
  const KEEP = 0.5;
  const { width: w, height: h } = ctx.canvas;
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  const ref = SKIN_LREF * 255;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  for (let i = 0; i < d.length; i += 4){
    if (mask[i] < 128 || d[i + 3] === 0) continue;
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    if (l <= 0) continue;
    const k = (ref + (l - ref) * KEEP) / l;    // scale channels toward the reference
    d[i] = cl(d[i] * k); d[i + 1] = cl(d[i + 1] * k); d[i + 2] = cl(d[i + 2] * k);
  }
  ctx.putImageData(im, 0, 0);
}

function rgbToHsl(r, g, b){
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min){ h = s = 0; }
  else {
    const dd = max - min;
    s = l > 0.5 ? dd / (2 - max - min) : dd / (max + min);
    switch (max){
      case r: h = (g - b) / dd + (g < b ? 6 : 0); break;
      case g: h = (b - r) / dd + 2; break;
      default: h = (r - g) / dd + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l){
  let r, g, b;
  if (s === 0){ r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
