import * as THREE from 'three';

// Floating text label as a camera-facing Sprite. Used for name tags above
// avatars/NPCs. Drawn once to a canvas; depthTest off so it never hides behind
// foliage.
export function makeLabel(text, { color = '#fff', bg = 'rgba(20,20,28,0.7)', size = 48, worldH = 0.85 } = {}){
  const font = `bold ${size}px monospace`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const pad = size * 0.35;
  const w = Math.ceil(meas.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = bg;
  if (g.roundRect){ g.beginPath(); g.roundRect(0, 0, w, h, 12); g.fill(); }
  else g.fillRect(0, 0, w, h);
  g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(worldH * w / h, worldH, 1);
  sp.renderOrder = 999;
  return sp;
}
