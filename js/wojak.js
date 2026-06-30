// wojak.js — procedural face portraits from layered assets, ported from
// suchaone/wojakgen (MIT; assets in sprites/wojak/). Each face stacks 100×100
// transparent layers (skin base, nose, mouth, detail, eyes, brows, shirt, hair,
// beard, stache) on a coloured background, with hair/beard/eyes randomly
// HSL-shifted for variety. We use it to give every NPC a unique dialog portrait.
//
// Usage: await ready(); then face('male'|'female') -> a PNG data-URL.

const DEFS  = { base: 7, nose: 10, mouth: 10, detail: 4, eyes: 5, brows: 6, shirt: 9, hair: 32, beard: 11, stache: 6 };
const GDEFS = { base: 7, mouth: 10, detail: 1, eyes: 2 };
const BG = ['#8cbfff', '#b9ffb9', '#8a8383', '#719064', '#8f6490', '#f5b0f7', '#a06c90', '#098876', '#a9f1e6'];

const L = {}, G = {};   // loaded Image arrays: layer-name -> [img, img, ...]
let _ready = null;

export function ready(){ return _ready || (_ready = load()); }

function load(){
  const all = [];
  const loadArr = (dict, target, path) => {
    for (const k in dict){
      target[k] = [];
      for (let i = 1; i <= dict[k]; i++){
        const im = new Image();
        all.push(new Promise(r => { im.onload = r; im.onerror = r; }));
        im.src = path + k + i + '.png';
        target[k].push(im);
      }
    }
  };
  loadArr(DEFS, L, 'sprites/wojak/');
  loadArr(GDEFS, G, 'sprites/wojak/girl/');
  return Promise.all(all);
}

const rnd  = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const darken = (c, f) => [c[0] * f | 0, c[1] * f | 0, c[2] * f | 0];
// muted peasant-cloth colours, used when the portrait shows no shirt to sample
const CLOTH = [[120, 90, 60], [90, 100, 120], [100, 110, 80], [130, 110, 90], [110, 90, 110], [80, 95, 105]];

// the five hair-colour presets from the original (HSL offsets applied to the
// grey hair base of hair/beard sprites)
function hairShift(){
  return pick([
    { h: 0, s: 0, l: -1 },                                              // black
    { h: 0, s: -1, l: rnd(-.5, .5) },                                   // gray
    { h: rnd(.30, .33), s: rnd(-.4, .4), l: rnd(-.2, .3) },             // blond
    { h: rnd(.28, .30), s: rnd(-1, 1), l: rnd(-.35, -.3) },             // brown
    { h: rnd(.15, .23), s: rnd(-.3, .3), l: rnd(-.1, -.15) },           // red
  ]);
}

// compose a face and return a data-URL. gender selects the male/female layer set;
// elves get procedural pointed ears (the asset set has none) tinted to the skin.
// overlayOpts is optional: { img, scale, anchorX, bottomY } — composited on top
// after palette sampling so the crown pixels don't skew tint-colour detection.
export function face(gender = 'male', race = 'human', skin = null, overlayOpts = null){
  const female = gender === 'female';
  const cv = document.createElement('canvas'); cv.width = cv.height = 100;
  const ctx = cv.getContext('2d');
  const tcv = document.createElement('canvas'); tcv.width = tcv.height = 100;
  const tctx = tcv.getContext('2d');

  const goblin = race === 'goblin';
  // a layer onto the temp canvas (optionally HSL-shifted, skin->green for goblins,
  // or skin->`tint` so the portrait matches a baked body's skin tone), then onto the
  // face
  const draw = (img, shift, green, tint) => {
    if (!img) return;
    tctx.clearRect(0, 0, 100, 100);
    tctx.drawImage(img, 0, 0);
    if (shift) recolor(tctx, shift);
    if (green) greenSkin(tctx);
    else if (tint) tintSkin(tctx, tint);
    ctx.drawImage(tcv, 0, 0);
  };

  ctx.fillStyle = pick(BG); ctx.fillRect(0, 0, 100, 100);

  const hs = hairShift();
  const eyeShift   = { h: rnd(-.7, -.15), s: rnd(-1, 0), l: rnd(-.5, .2) };
  const mouthShift = { h: rnd(-1, 1), s: rnd(-1, .5), l: rnd(-.5, .2) };

  draw(pick(female ? G.base : L.base), null, goblin, skin);  // skin (green=goblin, tint=match body)
  // sample the (possibly tinted) skin tone at a cheek for elf ears
  let earSkin = null;
  if (race === 'elf'){ const c = ctx.getImageData(34, 54, 1, 1).data; earSkin = [c[0], c[1], c[2]]; }
  draw(pick(L.nose), null, goblin, skin);                // nose shares the skin tone
  draw(female ? pick(G.mouth) : pick(L.mouth), female ? mouthShift : undefined);
  if (female) draw(G.detail[0]);
  else if (Math.random() < 0.5) draw(pick(L.detail));
  draw(female ? pick(G.eyes) : pick(L.eyes), eyeShift);
  draw(pick(L.brows));
  if (Math.random() < 0.8) draw(pick(L.shirt));
  // hair: indices 0..25/26 are styles (27+ are headwear we skip); males 30% bald
  if (female) draw(L.hair[Math.floor(rnd(0, 26))], hs);
  else if (Math.random() < 0.7) draw(L.hair[Math.floor(rnd(0, 27))], hs);
  if (earSkin) drawEar(ctx, 33, -1, earSkin);   // elf ear (only the near one — the face is in 3/4 turn)
  if (!female){                                          // facial hair (always for dwarves)
    const dwarf = race === 'dwarf';
    if (dwarf || Math.random() < 0.3) draw(pick(L.beard), hs);
    if (dwarf || Math.random() < 0.3) draw(pick(L.stache), hs);
  }

  // a palette read off the finished portrait, so the in-world sprite can be tinted
  // to match (its magenta/green/yellow zones -> primary/secondary/accent).
  const samp = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  const bg = samp(2, 2), cheek = earSkin || samp(40, 55);
  const shirtPx = samp(50, 96), hairPx = samp(50, 11);
  const isFace = c => dist(c, bg) > 45;
  const primary = (isFace(shirtPx) && dist(shirtPx, cheek) > 55) ? shirtPx : pick(CLOTH);
  const accent  = (isFace(hairPx) && dist(hairPx, cheek) > 40) ? hairPx : darken(cheek, 0.7);
  const palette = { primary, secondary: darken(primary, 0.6), accent };

  // draw wearable overlay after palette sampling so crown pixels don't affect tints
  if (overlayOpts?.img) {
    const { img, scale = 65, anchorX = 0.5, bottomY = 28 } = overlayOpts;
    const ovW = scale;
    const srcW = img.naturalWidth  || img.width  || 1;
    const srcH = img.naturalHeight || img.height || 1;
    // _nominalH is the layout height (CROWN_H); anchor bottomY against it so the
    // overflow portion (flowers dipping below the canvas edge) lands on the face,
    // matching how wearCrown positions the crown on the in-world sprite.
    const nominalH = img._nominalH || srcH;
    const nominalOvH = Math.round(nominalH * (ovW / srcW));
    const ovH       = Math.round(srcH     * (ovW / srcW));
    ctx.drawImage(img, Math.round(100 * anchorX - ovW / 2), bottomY - nominalOvH, ovW, ovH);
  }

  return { url: cv.toDataURL(), palette };
}

// a pointed elf ear at head-side x0, pointing out (dir -1 left / +1 right), filled
// with the skin tone [r,g,b] and a darker edge + inner crease for a little form.
function drawEar(ctx, x0, dir, skin){
  const fill = `rgb(${skin[0]},${skin[1]},${skin[2]})`;
  const edge = `rgb(${skin[0] * 0.62 | 0},${skin[1] * 0.62 | 0},${skin[2] * 0.62 | 0})`;
  ctx.lineJoin = 'round'; ctx.lineWidth = 1;
  ctx.fillStyle = fill; ctx.strokeStyle = edge;
  ctx.beginPath();
  ctx.moveTo(x0, 46);                       // upper root, at the head's edge
  ctx.lineTo(x0 + dir * 11, 30);            // pointed tip, up & out
  ctx.lineTo(x0 + dir * 1, 57);             // lower root
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = `rgb(${skin[0] * 0.8 | 0},${skin[1] * 0.8 | 0},${skin[2] * 0.8 | 0})`;
  ctx.beginPath(); ctx.moveTo(x0 + dir * 2, 50); ctx.lineTo(x0 + dir * 8, 35); ctx.stroke();   // inner crease
}

// cast a skin layer onto a target tone [r,g,b] (sRGB), keeping its shading — so a
// portrait's face matches a baked body's skin colour. Brightness relative to a mid
// skin reference scales the target (shadows darker, highlights lighter).
function tintSkin(ctx, [tr, tg, tb]){
  const im = ctx.getImageData(0, 0, 100, 100), d = im.data;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const k = l / 0.62;                        // 0.62 ≈ mean brightness of the skin layers
    d[i] = cl(tr * k); d[i + 1] = cl(tg * k); d[i + 2] = cl(tb * k);
  }
  ctx.putImageData(im, 0, 0);
}

// remap a skin layer to goblin green: each pixel keeps its brightness but is cast
// onto a green ramp, so shading is preserved while the flesh turns olive-green.
function greenSkin(ctx){
  const im = ctx.getImageData(0, 0, 100, 100), d = im.data;
  const cl = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = cl(l * 0.50); d[i + 1] = cl(l * 0.95 + 8); d[i + 2] = cl(l * 0.42);
  }
  ctx.putImageData(im, 0, 0);
}

// shift the hue/sat/light of a layer's recolourable region (the grey hair base,
// hue ~0.7..0.99) — leaves skin/transparent pixels alone.
function recolor(ctx, shift){
  const img = ctx.getImageData(0, 0, 100, 100), d = img.data;
  for (let i = 0; i < d.length; i += 4){
    if (d[i + 3] === 0) continue;
    const hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (hsl[0] > .7 && hsl[0] < .99){
      hsl[0] = (hsl[0] + shift.h + 1) % 1;
      hsl[1] = Math.max(0, Math.min(1, hsl[1] + shift.s));
      hsl[2] = Math.max(0, Math.min(1, hsl[2] + shift.l));
      const rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
    }
  }
  ctx.putImageData(img, 0, 0);
}

function rgbToHsl(r, g, b){
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min){ h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max){
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
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
