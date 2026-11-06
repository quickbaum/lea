import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { crisp } from './textures.js';

// stamp-view.js — a stamp as a real object in the light, and an envelope to carry them
// (docs/letters.md "How a stamp is drawn"). One renderer however many stamps; a perspective
// camera, because under an orthographic one a flat plane has a single view vector and the
// highlight never sweeps. One surface per stamp: the art's maps, with the frame and the text
// composited INTO them (colour, relief, roughness, metal), so a gilt frame is gilt and stands
// proud, and nothing slides against anything when it tilts. It renders only while it's open.
//
// Art: sprites/stamps/index.json lists the designs drawn so far, each sprites/stamps/<design>/
// with color.png and, for full PBR, normal.png (OpenGL: +Y up), rough.png, metal.png, and
// optionally glow.png. No text, frame or perforations in them. A design with no art gets a
// placeholder from placeholder() below.
//
//   await envelopeScene(canvas, letter, opts) → { flip(), refreshSeal(), hold(on), stop(), resize() }
//   await stampScene(canvas, stamp) → the same, for one stamp under a loupe
//   await bakeStamp(stamp, px) → a data URL, for a plate in the album

const CARD_W = 384, CARD_H = 512;      // the composited stamp's size, when its art doesn't say
const MARGIN = 0.075;                  // the paper left round the art, of the width

// the address and the letter are in Niconne; loaded here, not by CSS, so it's certain to be there
// when it's drawn into a texture
let fontLoad = null;
export const fontsReady = () => fontLoad ||= (async () => {
  try { const f = new FontFace('Niconne', 'url(fonts/Niconne-Regular.ttf)'); await f.load(); document.fonts.add(f); } catch (e){ console.warn('Niconne:', e); }
  await Promise.all(['700 25px "IM Fell English SC"', '600 20px "Cormorant Garamond"'].map(x => document.fonts?.load(x).catch(() => null)));
})();

// ---- small helpers ----
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function hash2(x, y, s = 0){ let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647 / 7 | 0); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function noise(x, y, s = 0){
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s = 0, oct = 4) => { let a = 0.5, t = 0, f = 1, n = 0; for (let i = 0; i < oct; i++){ t += a * noise(x * f, y * f, s + i); n += a; a *= 0.5; f *= 2.03; } return t / n; };
const hex = h => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// the extra physical properties a design's material has, beyond its maps
const MATERIAL = {
  'faerie-0': { name: 'beaten gold', clearcoat: 0.2, clearcoatRoughness: 0.3, envMapIntensity: 1.5 },
  'faerie-1': { name: 'mother of pearl', iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 560], clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.3 },
  'faerie-2': { name: 'enamel and copper', clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.3 },
  'faerie-3': { name: 'moth velvet and silver', sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xb48cff), envMapIntensity: 1.2 },
};
const GREEN_TINT = [0x7a2b28, 0x27496b, 0x3b5a2e, 0x6b4a1f], FOREIGN_TINT = [0x4b2a63, 0x1f5c5a, 0x8a3f6a, 0x2d2d2d], OLD_TINT = [0x4a4034, 0x5c3a2a, 0x39423c, 0x3a3640];

// A placeholder for art not drawn yet: per pixel { r g b, rough, metal, height }. Plainly a stand-in:
// a rosette, not a picture. u, v are 0..1 across the art, a 3:4 upright.
function placeholder(design, u, v){
  const cx = u - 0.5, cy = (v - 0.5) * 4 / 3, r = Math.hypot(cx, cy), a = Math.atan2(cy, cx);
  const petals = Math.cos(a * 8) * 0.5 + 0.5, rose = smooth(0.02, 0, Math.abs(r - (0.16 + 0.17 * petals)));
  const ring = smooth(0.012, 0, Math.abs(r - 0.42)), bud = smooth(0.09, 0.07, r);
  const motif = Math.max(rose, ring, bud);
  const px = u * 128, py = v * 171;
  if (design === 'faerie-0'){                  // beaten gold, the rosette raised out of it
    const dimple = fbm(px / 7, py / 7, 3, 3);
    const gold = mix3(hex(0xd9a441), hex(0xffdc8a), dimple);
    return { c: motif ? mix3(gold, hex(0xfff0c0), motif * 0.6) : gold, rough: 0.34 + 0.22 * fbm(px / 3, py / 3, 9, 2) - 0.2 * motif, metal: 1, h: dimple * 0.5 + motif * 0.9 };
  }
  if (design === 'faerie-1'){                  // nacre: laid down in fine curved bands
    const band = Math.sin((r + fbm(px / 24, py / 24, 5, 3) * 0.2) * 150) * 0.5 + 0.5;
    const pale = mix3(hex(0xe9e4ee), hex(0xf8f4e8), band);
    return { c: mix3(pale, hex(0x5f4d86), motif * 0.75), rough: 0.18 + 0.1 * band, metal: 0, h: band * 0.14 - motif * 0.45 };
  }
  if (design === 'faerie-2'){                  // cloisonné: enamel cells in copper wire
    const k = 14, gx = (a + Math.PI) / (2 * Math.PI) * k * 2, gy = r * 16, wire = Math.max(smooth(0.1, 0.03, Math.abs(gx - Math.round(gx))), smooth(0.11, 0.03, Math.abs(gy - Math.round(gy))));
    const cell = hash2(Math.floor(gx), Math.floor(gy), 2), enamel = cell < 0.5 ? mix3(hex(0x0d6d78), hex(0x2fb4a0), cell * 2) : cell < 0.82 ? hex(0x143f96) : hex(0xd8903a);
    const body = r > 0.56 ? hex(0x10283f) : enamel;
    return wire > 0.5 ? { c: hex(0xc9794a), rough: 0.32, metal: 1, h: 1 } : { c: body, rough: 0.14, metal: 0, h: 0.2 };
  }
  if (design === 'faerie-3'){                  // velvet, a moth's dark, worked in silver thread
    const nap = fbm(px / 2, py / 2, 8, 2);
    if (motif > 0.3) return { c: hex(0xe6e8f2), rough: 0.3 + 0.2 * (Math.sin((px + py) * 2.4) * 0.5 + 0.5), metal: 1, h: 0.75 + 0.2 * Math.sin((px + py) * 2.4) };
    return { c: mix3(hex(0x1c1036), hex(0x3a2264), nap), rough: 0.92, metal: 0, h: nap * 0.2 };
  }
  // a realm of the green world: one colour of ink on paper, engraved
  const tints = design.startsWith('foreign') ? FOREIGN_TINT : design.startsWith('old') ? OLD_TINT : GREEN_TINT, tint = hex(tints[+design.split('-')[1] % tints.length]);
  const hatch = Math.sin((u * 0.9 + v * 0.45) * 330) * 0.5 + 0.5, solid = Math.max(motif, smooth(0.5, 0.56, r) * hatch);
  return { c: mix3(hex(0xefe6cf), tint, Math.min(1, solid + 0.12)), rough: 0.86, metal: 0, h: solid * 0.25 + fbm(px / 2, py / 2, 4, 2) * 0.12 };
}

// the art's own maps, if it's been drawn
let artIndex = null;
const loadIndex = () => artIndex ||= fetch('sprites/stamps/index.json').then(r => r.ok ? r.json() : []).catch(() => []);
const loadImage = src => new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const pixelsOf = (img, w, h) => { const c = canvasOf(w, h), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };

// frame and text are masks: white where the overlay is. Drawn once for a realm and value.
function drawOverlay(stamp, W, H){
  const c = canvasOf(W, H), g = c.getContext('2d'), m = W * MARGIN, fae = stamp.kind === 'faerie';
  g.strokeStyle = g.fillStyle = '#fff';
  g.lineWidth = W * (fae ? 0.012 : 0.008); g.strokeRect(m * 0.72, m * 0.72, W - m * 1.44, H - m * 1.44);
  if (fae){ g.lineWidth = W * 0.004; g.strokeRect(m * 1.02, m * 1.02, W - m * 2.04, H - m * 2.04);
    for (const [x, y] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]){ g.beginPath(); g.arc(x, y, W * 0.026, 0, 7); g.fill(); } }
  // the realm's name along the foot on a clear band, the value at the top corner
  const fam = fae ? '"Cormorant Garamond", serif' : '"IM Fell English SC", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let fs = W * 0.082; g.font = `600 ${fs}px ${fam}`;
  while (g.measureText(stamp.realmName).width > W * 0.76 && fs > 8){ fs -= 1; g.font = `600 ${fs}px ${fam}`; }
  g.fillText(stamp.realmName, W / 2, H - m * 1.95);
  g.font = `700 ${W * 0.13}px ${fam}`; g.fillText(`${stamp.value}${fae ? '' : 'd'}`, W - m * 2.6, m * 2.6);
  return g.getImageData(0, 0, W, H).data;
}
// the band behind the text, so it reads over any art: a mask of its own
function drawBacking(stamp, W, H){
  const c = canvasOf(W, H), g = c.getContext('2d'), m = W * MARGIN;
  g.fillStyle = '#fff'; g.fillRect(m * 1.1, H - m * 2.8, W - m * 2.2, m * 1.7);
  g.beginPath(); g.arc(W - m * 2.6, m * 2.6, W * 0.11, 0, 7); g.fill();
  return g.getImageData(0, 0, W, H).data;
}
// semicircles bitten out of the edges, as the old renderer does; at this size they read clean
export function perforation(W, H){
  const c = canvasOf(W, H), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
  const rad = W * 0.0165, step = rad * 3.3;
  const nx = Math.max(2, Math.round(W / step)), ny = Math.max(2, Math.round(H / step));
  for (let i = 0; i < nx; i++){ const x = (i + 0.5) * W / nx; for (const y of [0, H]){ g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); } }
  for (let i = 0; i < ny; i++){ const y = (i + 0.5) * H / ny; for (const x of [0, W]){ g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill(); } }
  return c;
}

// height (Float32Array) → an OpenGL normal map, optionally laid over the art's own
function normalFrom(h, W, H, strength, base = null){
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x;
    const dx = (h[y * W + Math.min(W - 1, x + 1)] - h[y * W + Math.max(0, x - 1)]) * strength;
    const dy = (h[Math.min(H - 1, y + 1) * W + x] - h[Math.max(0, y - 1) * W + x]) * strength;   // canvas y runs down; +Y in the map runs up
    let nx = -dx, ny = dy, nz = 1;
    if (base){ nx += base[i * 4] / 127.5 - 1; ny += base[i * 4 + 1] / 127.5 - 1; nz = Math.max(0.05, base[i * 4 + 2] / 127.5 - 1); }
    const l = Math.hypot(nx, ny, nz);
    out[i * 4] = (nx / l * 0.5 + 0.5) * 255; out[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; out[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; out[i * 4 + 3] = 255;
  }
  return out;
}
const canvasFromPixels = (data, W, H) => { const c = canvasOf(W, H); c.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0); return c; };
function tex(canvas, srgb = false){
  const t = crisp(new THREE.CanvasTexture(canvas));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;      // (the old renderer never tagged its art, so its colours came out wrong)
  return t;
}

const OVERLAY = {   // what frame and text are made of, by realm kind
  faerie: { c: hex(0xf0cf7a), rough: 0.2, metal: 1, rise: 0.9, back: hex(0x1a1030), backRough: 0.5 },
  green:  { c: hex(0x2a2018), rough: 0.7, metal: 0, rise: 0.12, back: hex(0xefe6cf), backRough: 0.86 },
};
const cards = new Map();              // design|realm|value → Promise of { color, normal, orm, glow, alpha, aspect, mat }

export function stampCard(stamp){
  const key = `${stamp.design}|${stamp.realmName}|${stamp.value}`;
  if (cards.has(key)) return cards.get(key);
  const p = (async () => {
    await fontsReady();
    const drawn = (await loadIndex()).includes(stamp.design);
    const dir = `sprites/stamps/${stamp.design}/`;
    const [cImg, nImg, rImg, mImg, gImg] = drawn ? await Promise.all(['color', 'normal', 'rough', 'metal', 'glow'].map(n => loadImage(`${dir}${n}.png`))) : [];
    const W = cImg ? Math.min(768, cImg.naturalWidth) : CARD_W, H = cImg ? Math.round(W * cImg.naturalHeight / cImg.naturalWidth) : CARD_H;
    const ov = OVERLAY[stamp.kind === 'faerie' ? 'faerie' : 'green'];
    const n = W * H, color = new Uint8ClampedArray(n * 4), orm = new Uint8ClampedArray(n * 4), glow = gImg ? pixelsOf(gImg, W, H) : null, height = new Float32Array(n);
    const cPix = cImg && pixelsOf(cImg, W, H), rPix = rImg && pixelsOf(rImg, W, H), mPix = mImg && pixelsOf(mImg, W, H), nPix = nImg && pixelsOf(nImg, W, H);
    const mask = drawOverlay(stamp, W, H), back = drawBacking(stamp, W, H), m = W * MARGIN;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
      const i = y * W + x, inArt = x >= m && x < W - m && y >= m && y < H - m;
      let c, rough, metal, h = 0;
      if (!inArt){ c = ov.back; rough = ov.backRough; metal = 0; if (stamp.kind === 'faerie') { c = hex(0x1a1030); rough = 0.5; } else h = fbm(x / 2.5, y / 2.5, 6, 2) * 0.1; }
      else if (cPix){ c = [cPix[i * 4] / 255, cPix[i * 4 + 1] / 255, cPix[i * 4 + 2] / 255]; rough = rPix ? rPix[i * 4 + 1] / 255 : 0.85; metal = mPix ? mPix[i * 4 + 2] / 255 : 0; }
      else { const a = placeholder(stamp.design, (x - m) / (W - 2 * m), (y - m) / (H - 2 * m)); c = a.c; rough = a.rough; metal = a.metal; h = a.h; }
      const bk = back[i * 4] / 255;
      if (bk > 0 && inArt){ c = mix3(c, ov.back, bk); rough += (ov.backRough - rough) * bk; metal *= 1 - bk; h *= 1 - bk; }
      const k = mask[i * 4] / 255;                  // frame and text: into every map
      if (k > 0){ c = mix3(c, ov.c, k); rough += (ov.rough - rough) * k; metal += (ov.metal - metal) * k; h += ov.rise * k; }
      color[i * 4] = c[0] * 255; color[i * 4 + 1] = c[1] * 255; color[i * 4 + 2] = c[2] * 255; color[i * 4 + 3] = 255;
      orm[i * 4 + 1] = rough * 255; orm[i * 4 + 2] = metal * 255; orm[i * 4 + 3] = 255;   // three reads roughness from G, metalness from B
      height[i] = h;
    }
    return { W, H, aspect: W / H, mat: MATERIAL[stamp.design] || {}, color: canvasFromPixels(color, W, H), orm: canvasFromPixels(orm, W, H),
      normal: canvasFromPixels(normalFrom(height, W, H, W / 90, nPix), W, H), glow: glow && canvasFromPixels(new Uint8ClampedArray(glow), W, H), alpha: perforation(W, H) };
  })();
  cards.set(key, p);
  return p;
}
function stampMesh(card, width, sx = 1, sy = 1){
  const { mat } = card, { name, ...phys } = mat;
  const m = new THREE.MeshPhysicalMaterial({ map: tex(card.color, true), normalMap: tex(card.normal), normalScale: new THREE.Vector2(1, 1),
    roughnessMap: tex(card.orm), metalnessMap: tex(card.orm), roughness: 1, metalness: 1, alphaMap: tex(card.alpha), alphaTest: 0.5, ...phys });
  if (card.glow){ m.emissive = new THREE.Color(0xffffff); m.emissiveMap = tex(card.glow, true); m.emissiveIntensity = 1; }
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / card.aspect, sx, sy), m);
}

// ---- the one renderer: moved between canvases by copying, never one per stamp ----
let shared = null;
function renderer(){
  if (shared) return shared;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
  const pm = new THREE.PMREMGenerator(r);
  shared = { r, env: pm.fromScene(new RoomEnvironment(), 0.03).texture };
  pm.dispose();
  return shared;
}
function makeStage(env, fit){
  const scene = new THREE.Scene(); scene.environment = env;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  const key = new THREE.PointLight(0xfff4dc, 3.2, 0, 1.6); key.position.set(0.5, 0.6, 1.1);  // near the surface: its highlight runs across it
  const rim = new THREE.PointLight(0xbfd0ff, 1.4, 0, 1.6); rim.position.set(-0.8, -0.5, 0.9);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.08));
  const group = new THREE.Group(); scene.add(group);
  return { scene, camera, key, rim, group, fit };
}
// Runs a stage in a 2D canvas, on the shared renderer: only while on, only when it's on screen.
function run(canvas, stage){
  const { r } = renderer(), g = canvas.getContext('2d');
  let on = true, px = 0, py = 0, rx = 0, ry = 0, flip = 0, flipTo = 0, t0 = performance.now(), raf = 0, last = t0, held = false;
  const size = () => {
    const b = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round((b.width || canvas.width) * dpr)), h = Math.max(2, Math.round((b.height || canvas.height) * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    return [w, h];
  };
  const move = e => { const b = canvas.getBoundingClientRect(); px = ((e.clientX - b.left) / b.width) * 2 - 1; py = ((e.clientY - b.top) / b.height) * 2 - 1; held = true; };
  const leave = () => { held = false; };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
  function frame(now){
    if (!on) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;   // (a busy machine's frame stamp can be older than `last`: negative, the easing below explodes)
    const t = (now - t0) / 1000, ease = 1 - Math.exp(-dt * 7);    // by time, not by frame: the old one's eased at the speed of the machine
    const tx = held ? px : Math.sin(t * 0.37) * 0.55, ty = held ? py : Math.sin(t * 0.53 + 1) * 0.55;   // nobody touching it: it drifts, so it still shimmers
    const tilt = stage.tiltK ?? 1;      // while a stamp's being lifted, the envelope holds still under your hand
    rx += (ty * 0.26 * tilt - rx) * ease; ry += (tx * 0.3 * tilt - ry) * ease;
    stage.update?.(dt);
    flip += (flipTo - flip) * (1 - Math.exp(-dt * 6));
    stage.group.rotation.set(rx, ry + flip * Math.PI, 0);
    stage.key.position.set(tx * stage.fit * 0.8, -ty * stage.fit * 0.6, stage.fit * 0.75);
    stage.rim.position.set(-tx * stage.fit * 0.7, ty * stage.fit * 0.5, stage.fit * 0.8);
    const [w, h] = size();
    r.setPixelRatio(1); r.setSize(w, h, false);
    stage.camera.aspect = w / h;
    const vh = 2 * Math.tan(stage.camera.fov * Math.PI / 360);
    if (stage.slot){
      // the canvas fills the screen so a lifted stamp can go anywhere; the envelope stays framed
      // in its slot in the layout, by moving the camera (flat on, so nothing's skewed)
      const cb = canvas.getBoundingClientRect(), sb = stage.slot.getBoundingClientRect();
      const wpp = Math.max(stage.fit / sb.width, stage.fit * stage.tall / sb.height) * 1.12;   // world units to a CSS pixel, at the face
      stage.wpp = wpp;
      stage.camera.position.set(-(sb.left + sb.width / 2 - cb.left - cb.width / 2) * wpp, (sb.top + sb.height / 2 - cb.top - cb.height / 2) * wpp, wpp * cb.height / vh);
    } else stage.camera.position.z = Math.max(stage.fit / (vh * stage.camera.aspect), stage.fit * (stage.tall || 0.75) / vh) * 1.12;
    stage.camera.updateProjectionMatrix();
    r.setClearColor(0, 0);
    r.render(stage.scene, stage.camera);
    g.clearRect(0, 0, w, h); g.drawImage(r.domElement, 0, 0);
  }
  raf = requestAnimationFrame(frame);
  return { flip(now = false){ flipTo = flipTo ? 0 : 1; if (now) flip = flipTo; return !!flipTo; }, get flipped(){ return !!flipTo; },
    stop(){ on = false; cancelAnimationFrame(raf); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); },
    // a single known pose, for a check (fixed light, no drift)
    still(tx, ty){ on = false; cancelAnimationFrame(raf); held = true; px = tx; py = ty; t0 = last = performance.now(); rx = ty * 0.26; ry = tx * 0.3; on = true; frame(performance.now()); on = false; cancelAnimationFrame(raf); } };
}

// ---- the envelope: a thin solid with rounded corners and a bevelled rim, and on each face a sheet
// whose edges are browned and whose relief is real, as the book's pages are (book-art.js paper) ----
const ENV_W = 3.2, ENV_H = 2.0, ENV_R = 0.03, ENV_D = 0.028, ENV_B = 0.012, STAMP_W = 0.42;
const FACE_Z = ENV_D / 2 + ENV_B + 0.0006;     // where a face lies, in the envelope's own space
const FW = 1024, FH = 640, NW = 512, NH = 320;  // a face's colour and relief, in pixels
const roundedPath = (P, x, y, w, h, r) => { P.moveTo(x + r, y); P.lineTo(x + w - r, y); P.quadraticCurveTo(x + w, y, x + w, y + r); P.lineTo(x + w, y + h - r); P.quadraticCurveTo(x + w, y + h, x + w - r, y + h); P.lineTo(x + r, y + h); P.quadraticCurveTo(x, y + h, x, y + h - r); P.lineTo(x, y + r); P.quadraticCurveTo(x, y, x + r, y); };
const shapeOf = (w, h, r) => { const s = new THREE.Shape(); roundedPath(s, -w / 2, -h / 2, w, h, r); return s; };

// the paper's grain, once per colour: it's costly at this size on a Pi, and every envelope shares it
const grains = new Map();
function grainOf(base, seed){
  const key = `${base}|${seed}`;
  if (grains.has(key)) return grains.get(key);
  const w = FW >> 1, h = FH >> 1, c = canvasOf(w, h), g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0, y = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4){ const n = (fbm(x / 1.6, y / 1.6, seed, 2) - 0.5) * 16 + (fbm(x / 36, y / 36, seed + 3, 2) - 0.5) * 18; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
  g.putImageData(d, 0, 0);
  grains.set(key, c);
  return c;
}
// the sheet: grain, flat to its edge. No shading drawn inward from the edge: it makes the face look
// sunk in a tray. The depth is the solid's rim, catching the light, and the shadow it casts.
function sheetOf(base, seed){
  const c = canvasOf(FW, FH);
  c.getContext('2d').drawImage(grainOf(base, seed), 0, 0, FW, FH);
  return c;
}
// the four flaps of the back, last on top: [points, height in the relief]
const FLAPS = [
  [[[0, 0], [FW * .46, FH * .5], [0, FH]], 60],
  [[[FW, 0], [FW * .54, FH * .5], [FW, FH]], 60],
  [[[0, FH], [FW * .5, FH * .42], [FW, FH]], 125],
  [[[0, 0], [FW * .5, FH * .6], [FW, 0]], 195],
];
function traceFlap(g, pts, s = 1){       // straight sides and a rounded tip, as a real flap is cut
  const [a, tip, b] = pts, near = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], n = near(tip, a, .09), m = near(tip, b, .09);
  g.beginPath(); g.moveTo(a[0] * s, a[1] * s); g.lineTo(n[0] * s, n[1] * s); g.quadraticCurveTo(tip[0] * s, tip[1] * s, m[0] * s, m[1] * s); g.lineTo(b[0] * s, b[1] * s); g.closePath();
}
function drawFlaps(c, edge){
  const g = c.getContext('2d');
  for (const [pts] of FLAPS){
    g.save(); g.shadowColor = `rgba(${edge},.55)`; g.shadowBlur = 13; g.shadowOffsetY = 2.5; traceFlap(g, pts); g.fillStyle = 'rgba(255,250,235,.16)'; g.fill(); g.restore();
    traceFlap(g, pts); g.strokeStyle = 'rgba(255,250,235,.32)'; g.lineWidth = 1.6; g.stroke();
  }
}
// a face's relief: the paper's grain, and on the back its flaps. Cached:
// one front and one back serve every envelope.
const reliefs = {};
function reliefOf(back){
  if (reliefs[back]) return reliefs[back];
  let flap = null;
  if (back){
    const c = canvasOf(NW, NH), g = c.getContext('2d', { willReadFrequently: true }), s = NW / FW;
    g.fillStyle = '#000'; g.fillRect(0, 0, NW, NH);
    for (const [pts, v] of FLAPS){ traceFlap(g, pts, s); g.fillStyle = `rgb(${v},${v},${v})`; g.fill(); }
    flap = g.getImageData(0, 0, NW, NH).data;
  }
  const h = new Float32Array(NW * NH);
  for (let y = 0; y < NH; y++) for (let x = 0; x < NW; x++){
    h[y * NW + x] = fbm(x / 1.4, y / 1.4, 11, 2) * 0.16 + fbm(x / 9, y / 9, 13, 2) * 0.14 + (flap ? flap[(y * NW + x) * 4] / 255 * 2.1 : 0);
  }
  return reliefs[back] = canvasFromPixels(normalFrom(h, NW, NH, 1.1), NW, NH);
}
// a seal: a raised disc with the mark in it. wax and clay are thick; ink is flat on the paper
const SEAL = { wax: { color: 0x8c1420, rough: 0.34, clearcoat: 0.7, rise: 1.8 }, clay: { color: 0xa7714a, rough: 0.96, clearcoat: 0, rise: 1.4 }, ink: { color: 0x9c2a1c, rough: 0.82, clearcoat: 0, rise: 0.08, flat: true } };
// a realm's own seal, a mark drawn for it: sprites/seals/<art>.png, black on clear. Loaded before a
// seal is made (a seal is remade when it's broken, and that can't wait)
const SEAL_COLOR = { faerie: 0xa78ae6 };   // a realm's own wax
const sealArt = new Map();
const loadSealArt = art => { if (!art) return Promise.resolve(); if (!sealArt.has(art)) sealArt.set(art, loadImage(`sprites/seals/${art}.png`)); return sealArt.get(art); };
function sealMesh(seal, art = null){
  const N = art ? 512 : 256, R = N / 2, S = SEAL[seal.material] || SEAL.clay, h = new Float32Array(N * N), a = canvasOf(N, N), ag = a.getContext('2d');
  const mc = canvasOf(N, N), mg = mc.getContext('2d', { willReadFrequently: true });
  if (art){ const d = R * 1.5, k = d / Math.max(art.naturalWidth, art.naturalHeight), w = art.naturalWidth * k, ht = art.naturalHeight * k; mg.drawImage(art, R - w / 2, R - ht / 2, w, ht); }   // inside the wax's raised lip
  else {
    mg.fillStyle = mg.strokeStyle = '#fff'; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.font = `${N * 0.5}px Niconne, cursive`;
    mg.fillText(seal.mark || '?', R, R); mg.lineWidth = 4; mg.beginPath(); mg.arc(R, R, R * 0.72, 0, 7); mg.stroke();
  }
  const finish = new Uint8ClampedArray(N * N * 4);    // pressed wax is duller than the wax round it: R clearcoat, G roughness
  const mark = mg.getImageData(0, 0, N, N).data, col = ag.createImageData(N, N), base = hex(SEAL_COLOR[seal.art] ?? S.color), rs = seal.mark ? (seal.mark.charCodeAt(0) % 97) : 3, sc = N / 256;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
    const i = y * N + x, ang = Math.atan2(y - R, x - R), edge = R * (0.86 + 0.09 * fbm(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2 + 5, rs, 3)), r = Math.hypot(x - R, y - R);
    const inside = smooth(edge, edge - 2 * sc, r), dome = smooth(edge, edge - R * 0.2, r), press = mark[i * 4 + 3] / 255;
    let crack = 0;
    if (!seal.whole){ const line = (x - R) / sc * 0.82 + (y - R) / sc * 0.56 + (fbm(x / sc / 12, y / sc / 12, rs + 1, 3) - 0.5) * 34; crack = smooth(4, 1, Math.abs(line)); }
    h[i] = dome * S.rise - press * S.rise * 0.42 + fbm(x / sc / 9, y / sc / 9, rs, 2) * 0.1 * S.rise - crack * S.rise;
    finish[i * 4] = 255 * (1 - press * 0.9); finish[i * 4 + 1] = 255 * Math.min(1, S.rough + press * 0.42); finish[i * 4 + 3] = 255;
    const shade = 1 - 0.34 * press - 0.75 * crack + (fbm(x / sc / 20, y / sc / 20, rs + 2, 2) - 0.5) * 0.18;
    col.data[i * 4] = base[0] * shade * 255; col.data[i * 4 + 1] = base[1] * shade * 255; col.data[i * 4 + 2] = base[2] * shade * 255; col.data[i * 4 + 3] = inside * 255;
  }
  ag.putImageData(col, 0, 0);
  const m = new THREE.MeshPhysicalMaterial({ map: tex(a, true), transparent: true, alphaTest: 0.05, normalMap: tex(canvasFromPixels(normalFrom(h, N, N, 2.2 * sc), N, N)), roughness: 1, metalness: 0, clearcoat: S.clearcoat, clearcoatRoughness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 });
  m.roughnessMap = m.clearcoatMap = tex(canvasFromPixels(finish, N, N));
  const size = art ? 0.8 : 0.62;     // a drawn seal has more to show
  return new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
}
const PAPER = { green: ['#d9c8a2', '94,62,24'], faerie: ['#d7cfe8', '58,40,96'] };
function envelopeFaces(letter){
  const [base, edge] = letter.from.fae ? PAPER.faerie : PAPER.green;
  const front = sheetOf(base, 21), back = sheetOf(base, 22), g = front.getContext('2d');
  g.fillStyle = letter.from.fae ? '#2c1e58' : '#2b2118'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const lines = letter.toLines || [letter.to.name];
  const sized = (text, px, room) => { let s = px; g.font = `${s}px Niconne, cursive`; while (g.measureText(text).width > room && s > 24){ s -= 2; g.font = `${s}px Niconne, cursive`; } return s; };
  lines.forEach((l, i) => { sized(l, 74, FW - 240 - i * 56); g.fillText(l, 140 + i * 56, 392 + i * 84); });
  sized(`from ${letter.fromLine || letter.from.name}`, 38, FW * .42); g.fillText(`from ${letter.fromLine || letter.from.name}`, 62, 90);
  if (letter.kind === 'parcel'){ g.strokeStyle = '#6a5636'; g.lineWidth = 3; g.setLineDash([12, 7]); g.beginPath(); g.moveTo(0, FH / 2 + 80); g.lineTo(FW, FH / 2 + 80); g.stroke(); }
  drawFlaps(back, edge);
  return { front, back, base };
}
function postmark(text, seedAngle, art = null){
  const N = 256, c = canvasOf(N, N), g = c.getContext('2d'); g.translate(N / 2, N / 2); g.rotate(seedAngle);
  if (art){           // a realm with a seal of its own cancels with it, in ink
    const d = N * .9, k = d / Math.max(art.naturalWidth, art.naturalHeight), w = art.naturalWidth * k, h = art.naturalHeight * k;
    g.drawImage(art, -w / 2, -h / 2, w, h);
    g.globalCompositeOperation = 'source-in'; g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = 'rgba(44,30,88,.85)'; g.fillRect(0, 0, N, N);
    return c;
  }
  g.strokeStyle = g.fillStyle = 'rgba(24,18,24,.82)'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.stroke(); g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 66, 0, 7); g.stroke();
  g.font = '700 25px "IM Fell English SC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const place = (text.place || '').toUpperCase(), step = Math.min(0.26, 4.6 / Math.max(place.length, 1));
  [...place].forEach((ch, i) => { g.save(); g.rotate((i - (place.length - 1) / 2) * step); g.translate(0, -89); g.fillText(ch, 0, 0); g.restore(); });
  g.font = '700 24px "IM Fell English SC", serif'; g.fillText(text.date || '', 0, 0);
  return c;
}
const jitter = (id, i) => (hash2(id, i, 5) - 0.5);
const softShadow = () => { const c = canvasOf(128, 80), g = c.getContext('2d'); g.filter = 'blur(7px)'; g.fillStyle = 'rgba(0,0,0,.72)'; g.fillRect(14, 14, 100, 52); const t = crisp(new THREE.CanvasTexture(c)); return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }); };
const PM_SIZE = 0.72;

// what of the postmark lands on this stamp, as a canvas the stamp's own size: it goes with the
// stamp when it's lifted, and into the album. null if the mark misses it.
function cancelFor(pm, mx, my, st){
  const dx = mx - st.x, dy = my - st.y, c0 = Math.cos(-st.rot), s0 = Math.sin(-st.rot), lx = dx * c0 - dy * s0, ly = dx * s0 + dy * c0;
  if (Math.abs(lx) > st.w / 2 + PM_SIZE * .45 || Math.abs(ly) > st.h / 2 + PM_SIZE * .45) return null;
  const cw = 256, ch = Math.round(cw * st.h / st.w), k = cw / st.w, c = canvasOf(cw, ch), g = c.getContext('2d');
  g.translate(cw / 2 + lx * k, ch / 2 - ly * k); g.rotate(st.rot); g.drawImage(pm, -PM_SIZE * k / 2, -PM_SIZE * k / 2, PM_SIZE * k, PM_SIZE * k);
  return c;
}
// the ink on a stamp: on the stamp's own geometry, so it bends with it
function inkOn(mesh, canvas){
  const t = crisp(new THREE.CanvasTexture(canvas)); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(mesh.geometry, new THREE.MeshPhysicalMaterial({ map: t, transparent: true, roughness: 1, metalness: 0, specularIntensity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.renderOrder = 2; mesh.add(m); return m;
}
// bend a stamp: `a` 0..1 how far it's peeled, (dx, dy) the way it's pulled, in its own plane.
// The side you're pulling comes up first; the far side stays stuck to the last.
function bend(e, a, dx, dy){
  const p = e.mesh.geometry.attributes.position, b = e.base;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++){ const d = b[i * 3] * dx + b[i * 3 + 1] * dy; if (d < lo) lo = d; if (d > hi) hi = d; }
  for (let i = 0; i < p.count; i++){
    const x = b[i * 3], y = b[i * 3 + 1], t = (x * dx + y * dy - lo) / (hi - lo || 1), w = t * t * (3 - 2 * t) * a;
    p.setXYZ(i, x - dx * w * e.h * .16, y - dy * w * e.h * .16, w * e.h * .62);
  }
  p.needsUpdate = true; e.mesh.geometry.computeVertexNormals();
}

export async function envelopeScene(canvas, letter, { slot = null } = {}){
  await fontsReady();
  const { env } = renderer(), stage = makeStage(env, ENV_W), { group } = stage;
  stage.tall = ENV_H / ENV_W; stage.slot = slot;
  const faces = envelopeFaces(letter), cols = 4, gap = STAMP_W * 0.1;

  // where everything lies, first: the postmark goes down on the paper before the stamps do
  const cards = await Promise.all(letter.stamps.map(stampCard));
  const entries = letter.stamps.map((stamp, i) => {
    const h = STAMP_W / cards[i].aspect, row = Math.floor(i / cols), col = i % cols;
    return { stamp, card: cards[i], w: STAMP_W, h, x: ENV_W / 2 - 0.14 - STAMP_W / 2 - col * (STAMP_W + gap) + jitter(letter.id, i) * 0.02, y: ENV_H / 2 - 0.14 - h / 2 - row * (h + gap) + jitter(letter.id, i + 40) * 0.02, rot: jitter(letter.id, i + 80) * 0.05 };
  });
  if (letter.postmark){
    const pm = postmark(letter.postmark, jitter(letter.id, 3) * 0.7, (await loadSealArt(letter.postmark.art)) || null), rows = Math.ceil(entries.length / cols), lastN = entries.length % cols || cols;
    const mx = ENV_W / 2 - 0.14 - lastN * (STAMP_W + gap) - 0.02, my = ENV_H / 2 - 0.14 - (rows - 0.5) * (STAMP_W * 4 / 3 + gap) + 0.02;
    const k = FW / ENV_W, g = faces.front.getContext('2d');
    g.drawImage(pm, (mx + ENV_W / 2) * k - PM_SIZE * k / 2, (ENV_H / 2 - my) * k - PM_SIZE * k / 2, PM_SIZE * k, PM_SIZE * k);
    for (const e of entries) e.cancel = cancelFor(pm, mx, my, e);
  }

  // paper is matte: no specular at all, so only the stamps shine. Roughness alone isn't enough, the
  // lights sit close and a rough highlight still slides across it as a sheen.
  const MATTE = { roughness: 1, metalness: 0, specularIntensity: 0, envMapIntensity: 0.65 };
  // the solid: its rim catches the light when it tilts; the faces lie on it, inset by the bevel
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeOf(ENV_W, ENV_H, ENV_R), { depth: ENV_D, bevelEnabled: true, bevelThickness: ENV_B, bevelSize: ENV_B, bevelOffset: -ENV_B, bevelSegments: 3, curveSegments: 10 }),
    new THREE.MeshPhysicalMaterial({ color: new THREE.Color(faces.base).multiplyScalar(0.92), ...MATTE }));
  body.position.z = -ENV_D / 2; group.add(body);
  const faceGeo = () => { const f = new THREE.ShapeGeometry(shapeOf(ENV_W - 2 * ENV_B, ENV_H - 2 * ENV_B, ENV_R - ENV_B), 10), P = f.attributes.position, U = f.attributes.uv;
    for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / ENV_W + .5, P.getY(i) / ENV_H + .5);
    return f; };
  const sheet = (face, back) => { const m = new THREE.Mesh(faceGeo(), new THREE.MeshPhysicalMaterial({ map: tex(face, true), normalMap: tex(reliefOf(back)), normalScale: new THREE.Vector2(.7, .7), ...MATTE }));
    if (back){ m.rotation.y = Math.PI; m.position.z = -FACE_Z; } else m.position.z = FACE_Z; group.add(m); return m; };
  sheet(faces.front, false); sheet(faces.back, true);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(ENV_W * 1.14, ENV_H * 1.2), softShadow()); under.position.set(0.05, -0.08, -0.28); stage.scene.add(under);

  // the stamps, and under each the clean patch of paper it kept from the light
  for (const e of entries){
    const bare = new THREE.Mesh(new THREE.PlaneGeometry(e.w, e.h), new THREE.MeshPhysicalMaterial({ color: new THREE.Color(faces.base).lerp(new THREE.Color(0xffffff), 0.16), ...MATTE, alphaMap: tex(e.card.alpha), alphaTest: 0.5 }));
    bare.position.set(e.x, e.y, FACE_Z + 0.0015); bare.rotation.z = e.rot; group.add(bare);
    e.mesh = stampMesh(e.card, e.w, 14, 18); e.mesh.material.side = THREE.DoubleSide;
    e.mesh.position.set(e.x, e.y, FACE_Z + 0.004); e.mesh.rotation.z = e.rot; group.add(e.mesh);
    e.base = e.mesh.geometry.attributes.position.array.slice();
    if (e.cancel) inkOn(e.mesh, e.cancel);
  }
  const held = new THREE.Mesh(new THREE.PlaneGeometry(STAMP_W * 1.5, STAMP_W * 1.9), softShadow()); held.visible = false; held.position.z = FACE_Z + 0.006; held.renderOrder = 1; group.add(held);
  const sealImg = (await loadSealArt(letter.seal?.art)) || null;
  let sealObj = null;
  const putSeal = () => {
    if (sealObj){ group.remove(sealObj); sealObj.geometry.dispose(); sealObj.material.dispose(); sealObj = null; }
    if (!letter.seal) return;
    sealObj = sealMesh(letter.seal, sealImg); sealObj.rotation.y = Math.PI; sealObj.position.set(0, ENV_H / 2 - .6 * ENV_H, -FACE_Z - 0.003); group.add(sealObj);
  };
  putSeal();

  // ---- lifting a stamp: press on it, pull. It peels from the side you pull; past its own height it
  // comes free and follows you. Let go near where it was and it goes back; anywhere else, it's yours.
  let lift = null;     // { onLift, hover, grab, free, a, dx, dy, px, py, home }
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const at = ev => {
    const b = canvas.getBoundingClientRect(), ndc = new THREE.Vector2(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera); return ray;
  };
  const inPlane = ev => {          // where the pointer is on the face, in the envelope's own space
    at(ev); group.updateMatrixWorld();
    const n = new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld), o = new THREE.Vector3(0, 0, FACE_Z).applyMatrix4(group.matrixWorld);
    plane.setFromNormalAndCoplanarPoint(n, o);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? group.worldToLocal(hit) : null;
  };
  const onStamp = p => p && entries.find(e => !e.gone && Math.abs((p.x - e.x) * Math.cos(e.rot) + (p.y - e.y) * Math.sin(e.rot)) < e.w / 2 && Math.abs(-(p.x - e.x) * Math.sin(e.rot) + (p.y - e.y) * Math.cos(e.rot)) < e.h / 2);
  const down = ev => {
    if (!lift || lift.grab) return;
    const p = inPlane(ev), e = onStamp(p); if (!e) return;
    ev.preventDefault(); try { canvas.setPointerCapture(ev.pointerId); } catch (_){}
    lift.grab = e; lift.start = p; lift.free = false; lift.px = e.x; lift.py = e.y; lift.a = 0; lift.dx = 0.7; lift.dy = 0.7; lift.hover = null; lift.back = false;
    canvas.style.cursor = 'grabbing'; stage.tiltK = 0;
  };
  const move = ev => {
    if (!lift) return;
    const p = inPlane(ev); if (!p) return;
    if (!lift.grab){ const e = onStamp(p); lift.hover = e || null; canvas.style.cursor = e ? 'grab' : ''; return; }
    if (lift.back) return;
    const e = lift.grab, vx = p.x - lift.start.x, vy = p.y - lift.start.y, d = Math.hypot(vx, vy);
    if (d > 0.012){ const c = Math.cos(-e.rot), s = Math.sin(-e.rot); lift.dx = (vx * c - vy * s) / d; lift.dy = (vx * s + vy * c) / d; }
    lift.a = Math.min(1, d / (e.h * .8));
    if (lift.a >= 1) lift.free = true;
    lift.tx = p.x; lift.ty = p.y;
  };
  const up = async ev => {
    if (!lift?.grab || lift.back) return;
    const e = lift.grab; canvas.style.cursor = ''; stage.tiltK = stage.liftTilt;
    if (!lift.free || Math.hypot(e.mesh.position.x - e.x, e.mesh.position.y - e.y) < e.h * .75){ lift.back = true; return; }   // not far enough: it goes back
    const b = canvas.getBoundingClientRect(), target = { x: ev.clientX, y: ev.clientY, width: stage.wpp ? e.w / stage.wpp : b.width * e.w / ENV_W * 1.1 };
    e.gone = true; const taken = lift; lift = null; held.visible = false;
    await taken.onLift(e.stamp, e.cancel || null, target, () => { e.mesh.visible = false; });
  };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  stage.update = dt => {
    const g = lift?.grab; held.visible = !!g;
    if (g){ const up = g.mesh.position.z - FACE_Z; held.position.x = g.mesh.position.x + up * .28; held.position.y = g.mesh.position.y - up * .36; held.material.opacity = Math.min(.8, .25 + up * 2); held.scale.setScalar(1 + up * .35); }
    if (!lift) return;
    const k = 1 - Math.exp(-dt * 14);
    for (const e of entries){   // the corner under your pointer starts to come up: it says it can be lifted
      if (e === lift.grab || e.gone) continue;
      e.hoverA = (e.hoverA || 0) + ((e === lift.hover ? 0.1 : 0) - (e.hoverA || 0)) * k;
      if (e.hoverA > 0.002 || e.bent){ bend(e, e.hoverA, 0.7, 0.7); e.bent = e.hoverA > 0.002; }
    }
    const e = lift.grab; if (!e) return;
    if (lift.back){            // settling back where it was
      lift.showA = (lift.showA ?? lift.a) * (1 - k * .8);
      e.mesh.position.x += (e.x - e.mesh.position.x) * k; e.mesh.position.y += (e.y - e.mesh.position.y) * k; e.mesh.position.z += (FACE_Z + 0.004 - e.mesh.position.z) * k; e.mesh.rotation.x *= 1 - k; e.mesh.rotation.y *= 1 - k;
      bend(e, lift.showA, lift.dx, lift.dy);
      if (lift.showA < 0.004 && Math.hypot(e.mesh.position.x - e.x, e.mesh.position.y - e.y) < 0.002){ bend(e, 0, 1, 0); e.mesh.position.set(e.x, e.y, FACE_Z + 0.004); e.mesh.rotation.x = e.mesh.rotation.y = 0; lift.grab = null; lift.back = false; lift.showA = null; }
      return;
    }
    const shown = lift.free ? 0.25 : lift.a;
    lift.showA = (lift.showA ?? 0) + (shown - (lift.showA ?? 0)) * k;
    bend(e, lift.showA, lift.dx, lift.dy);
    if (lift.free){            // off the paper, in your fingers, a little above it
      const ox = e.mesh.position.x, oy = e.mesh.position.y;
      e.mesh.position.x += ((lift.tx ?? ox) - ox) * k; e.mesh.position.y += ((lift.ty ?? oy) - oy) * k; e.mesh.position.z += (FACE_Z + 0.3 - e.mesh.position.z) * k;
      e.mesh.rotation.y += (Math.max(-.6, Math.min(.6, (e.mesh.position.x - ox) * 18)) - e.mesh.rotation.y) * k; e.mesh.rotation.x += (Math.max(-.6, Math.min(.6, (oy - e.mesh.position.y) * 18)) - e.mesh.rotation.x) * k;
    }
  };
  const runner = run(canvas, stage), stop = runner.stop;
  return Object.assign(runner, { refreshSeal: putSeal,
    // let one stamp be lifted: onLift(stamp, cancel, { x, y, width } on screen, hideIt)
    allowLift(onLift){ lift = { onLift, grab: null }; stage.liftTilt = 0.3; stage.tiltK = 0.3; },
    stop(){ stop(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); lift = null; } });
}

export async function stampScene(canvas, stamp, cancel = null){
  await fontsReady();
  const { env } = renderer(), card = await stampCard(stamp), stage = makeStage(env, 1.2);
  stage.tall = 1.2 / card.aspect / 1.2;
  const m = stampMesh(card, 1.2); stage.group.add(m);
  if (cancel) inkOn(m, cancel);
  return run(canvas, stage);
}

// one still of a stamp, for a plate in the album: the live one's for the loupe
export async function bakeStamp(stamp, px = 180, cancel = null){
  await fontsReady();
  const { r, env } = renderer(), card = await stampCard(stamp), stage = makeStage(env, 1.2), W = px, H = Math.round(px / card.aspect);
  const m = stampMesh(card, 1.2); stage.group.add(m); stage.group.rotation.set(-0.08, 0.12, 0);
  if (cancel) inkOn(m, cancel);
  r.setPixelRatio(1); r.setSize(W, H, false); stage.camera.aspect = W / H;
  const vh = 2 * Math.tan(stage.camera.fov * Math.PI / 360);
  stage.camera.position.z = Math.max(1.2 / (vh * stage.camera.aspect), (1.2 / card.aspect) / vh) * 1.08; stage.camera.updateProjectionMatrix();
  r.setClearColor(0, 0); r.render(stage.scene, stage.camera);
  const url = r.domElement.toDataURL('image/png');
  stage.group.traverse(o => { if (o.isMesh){ o.geometry.dispose(); for (const v of Object.values(o.material)) if (v?.isTexture) v.dispose(); o.material.dispose(); } });
  return url;
}
export const materialOf = design => MATERIAL[design]?.name || null;
