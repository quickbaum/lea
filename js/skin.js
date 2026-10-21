// skin.js — a painted skin for the bare ANNY body, per character.
//
// ANNY's mesh is MakeHuman's, UVs and all, and the anny package ships MPFB2's skin
// masks in that layout (lips, eyelids, face, ears, nails — CC0) plus a segmentation
// of the eyeballs and mouth. tools-side they are packed into sprites/skin/masks_*.png;
// here they are painted into one RGBA buffer: tone with a little mottle, blush,
// lips, eyelid liner, eyebrows, and eyes with an iris, pupil and catchlight.
//
// Pure JS over a pixel buffer (no canvas), so it runs in node for tests and in the
// browser per character; loadSkinMasks / skinTexture are the browser wrappers.
//
// The face sits in UV space ROTATED: the top of the head points to -u, the chin to
// +u, and the two eyes are stacked along v. Eyebrows are drawn from the eyelid
// mask's own blobs, so they follow the layout rather than hard-coded pixels.

const hex = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (c, d, t) => [c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t, c[2] + (d[2] - c[2]) * t];
const mul = (c, k) => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];

export const BROWS = ['none', 'thin', 'arched', 'straight', 'bushy'];

// masks: { W, H, a: RGBA bytes, b: RGBA bytes, eyes: eyes.json } — see sprites/skin/README.md
function blobs(masks, test){
  const { W, H } = masks, pts = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x, y)) pts.push([x, y]);
  return pts;
}
function split2(pts, axis){                 // two clusters along an axis (left/right eye)
  if (!pts.length) return [];
  const vs = pts.map(p => p[axis]).sort((a, b) => a - b);
  let gap = 0, cut = vs[0];
  for (let i = 1; i < vs.length; i++) if (vs[i] - vs[i-1] > gap){ gap = vs[i] - vs[i-1]; cut = (vs[i] + vs[i-1]) / 2; }
  return [pts.filter(p => p[axis] < cut), pts.filter(p => p[axis] >= cut)].map(g => {
    const cx = g.reduce((s, p) => s + p[0], 0) / g.length, cy = g.reduce((s, p) => s + p[1], 0) / g.length;
    return { cx, cy, r: Math.sqrt(g.length / Math.PI), n: g.length };
  });
}

// o: { tone, iris, brows (hex), browStyle, lips (hex|null), blush (0..1), seed }
export function paintSkin(masks, o = {}, size = 1024){
  const { W, H, a, b } = masks, k = W / size;
  const tone = hex(o.tone || '#c99a7e'), irisC = hex(o.iris || '#5b3a1e');
  const browC = hex(o.brows || '#3a2a20'), style = o.browStyle || 'arched';
  const lipC = o.lips ? hex(o.lips) : mul(tone, [0.86, 0.56, 0.56]);
  const blush = o.blush ?? 0.3;
  let seed = (o.seed ?? 1) * 9301 + 49297;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const ph = Array.from({ length: 6 }, () => rnd() * 6.28);
  const out = new Uint8ClampedArray(size * size * 4);
  const at = (buf, x, y, c) => buf[((Math.min(H - 1, y * k | 0)) * W + Math.min(W - 1, x * k | 0)) * 4 + c] / 255;
  // feature anchors from the masks themselves (mask pixel space)
  const eyes = split2(blobs(masks, (x, y) => a[(y * W + x) * 4 + 1] > 128), 1);
  const lips = blobs(masks, (x, y) => a[(y * W + x) * 4] > 128);
  const lipY = lips.length ? lips.reduce((s, p) => s + p[1], 0) / lips.length : H / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    const u = x / size, v = y / size;
    const mott = 0.035 * (Math.sin(u * 37 + ph[0]) * Math.sin(v * 29 + ph[1]) + 0.6 * Math.sin(u * 91 + v * 73 + ph[2]));
    let c = tone.map(t => t * (1 + mott));
    c = mix(c, mul(tone, [1.07, 0.84, 0.82]), blush * at(a, x, y, 2));           // cheeks
    c = mix(c, mul(tone, [1.04, 0.86, 0.84]), 0.3 * at(b, x, y, 0));              // ears
    c = mix(c, lipC, 0.92 * Math.pow(at(a, x, y, 0), 0.7));                        // lips
    c = mix(c, mul(tone, [0.5, 0.42, 0.44]), 0.6 * at(a, x, y, 1));                // eyelid liner
    c = mix(c, mix(tone, [250, 225, 220], 0.45), 0.55 * at(b, x, y, 1));          // nails
    const reg = at(b, x, y, 2) * 255;
    if (reg > 190 && reg < 215) c = [236, 232, 226];                               // eyeball
    else if (reg > 140 && reg < 160) c = [150, 72, 74];                            // eye cavity
    else if (reg > 90 && reg < 110) c = [92, 34, 36];                              // mouth
    else if (reg > 50 && reg < 70) c = [176, 96, 100];                             // tongue
    else if (reg > 230){                                                           // eyeball front
      // MakeHuman maps the eyeballs at ~1/10 the face's texel density (sprites/skin/
      // eyes.json, measured): a real 12 mm iris is ~3 px here. So: a sclera, and a
      // supersampled iris + pupil centred on each eye's apex, at their true size.
      c = [236, 232, 226];
      const e = (masks.eyes || []).reduce((best, q) => !best || Math.hypot(x / size * 1024 - q.cx, y / size * 1024 - q.cy) < Math.hypot(x / size * 1024 - best.cx, y / size * 1024 - best.cy) ? q : best, null);
      if (e){
        const s = size / 1024, ri = 0.0062 * e.pxPerM * s, rp = 0.0022 * e.pxPerM * s;
        let ir = 0, pu = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++){
          const d = Math.hypot(x + (sx + 0.5) / 4 - e.cx * s, y + (sy + 0.5) / 4 - e.cy * s);
          if (d < rp) pu++; else if (d < ri) ir++;
        }
        c = mix(mix(c, irisC, ir / 16), [14, 12, 12], pu / 16);
      }
    }
    const i = (y * size + x) * 4;
    out[i] = c[0]; out[i+1] = c[1]; out[i+2] = c[2]; out[i+3] = 255;
  }
  // eyebrows: an arc above each eyelid blob (toward -u), tapering to the outer end
  if (style !== 'none') for (const e of eyes){
    const s = e.cy < lipY ? -1 : 1;                   // outward along v, away from the face's middle
    const ex = e.cx / k, ey = e.cy / k;
    const P = { thin: [2.2, 1, 0], arched: [3.2, 1.6, 0], straight: [3.6, 0.3, 0], bushy: [6, 0.9, 1] }[style] || [3, 1, 0];
    const [wid, arch, bushy] = P, len = 19, lift = 9;
    for (let t = -1; t <= 1; t += 0.004){
      const outer = t * s > 0 ? Math.abs(t) : 0;
      const cx = ex - lift - arch * 5 * (1 - t * t) + 4 * outer * outer, cy = ey + t * len + s * 3;
      const w = wid * (1 - 0.6 * outer) * (1 + 0.15 * Math.sin(t * 40) * bushy);
      for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++){
        const r = Math.hypot(dx, dy); if (r > w) continue;
        const px = Math.round(cx + dx), py = Math.round(cy + dy);
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const j = (py * size + px) * 4, al = 0.18 * (1 - r / (w + 0.5)) * (bushy ? 0.8 + 0.4 * rnd() : 1);
        for (let ch = 0; ch < 3; ch++) out[j + ch] += (browC[ch] - out[j + ch]) * al;
      }
    }
  }
  return out;
}

// ---- browser wrappers ------------------------------------------------------------
async function readPng(url){
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(im, 0, 0);
  return { W: im.width, H: im.height, data: ctx.getImageData(0, 0, im.width, im.height).data };
}
let _masks = null;
export function loadSkinMasks(base = 'sprites/skin/'){
  return _masks ??= Promise.all([readPng(base + 'masks_a.png'), readPng(base + 'masks_b.png'),
                                 fetch(base + 'eyes.json').then(r => r.json()).catch(() => [])])
    .then(([A, B, eyes]) => ({ W: A.W, H: A.H, a: A.data, b: B.data, eyes }));
}
export function skinTexture(THREE, masks, o, size = 1024){
  const tex = new THREE.DataTexture(paintSkin(masks, o, size), size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}
