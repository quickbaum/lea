import { makeTexture, speckle } from '../textures.js';
import { rand, pick } from '../rng.js';
import { definePattern, SCALE } from './pattern.js';

// Pre-render a tileable bark texture: a base brown with vertical fibres, darker
// furrows, and grain. Wrapped around the branch cylinders. Tiles in both axes
// (vertical fibres wrap naturally; the seam is hidden by the grain).

const BARKS = [
  { base:'#5a3f28', dark:'#3e2a18', light:'#74573a' },  // oak-ish
  { base:'#6a513a', dark:'#46341f', light:'#86694a' },  // maple-ish
  { base:'#4f4234', dark:'#352a20', light:'#6b5b48' },  // grey-brown
];

export function makeBark(rng, { w = 64, h = 128 } = {}){
  const pal = pick(rng, BARKS);
  return makeTexture(w, h, (g) => {
    g.fillStyle = pal.base; g.fillRect(0, 0, w, h);
    // vertical fibres
    for (let i = 0; i < w*1.4; i++){
      const x = Math.random()*w;
      g.strokeStyle = Math.random() < 0.5 ? pal.dark : pal.light;
      g.globalAlpha = 0.25 + Math.random()*0.4;
      g.lineWidth = Math.random() < 0.2 ? 2 : 1;
      g.beginPath();
      let y = -5;
      g.moveTo(x, y);
      while (y < h + 5){ y += 6 + Math.random()*10; g.lineTo(x + (Math.random()-0.5)*2, y); }
      g.stroke();
    }
    // a few deeper furrows
    g.globalAlpha = 0.5;
    for (let i = 0; i < 5; i++){
      const x = Math.random()*w;
      g.strokeStyle = pal.dark; g.lineWidth = 2 + Math.random()*2;
      g.beginPath(); let y = -5; g.moveTo(x, y);
      while (y < h + 5){ y += 8 + Math.random()*8; g.lineTo(x + (Math.random()-0.5)*4, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    speckle(g, 0, 0, w, h, {density: 0.4});
  }, {repeat: [1, 1]});
}

// Redwood bark: deep reddish-brown with pronounced wide vertical furrows — the bark
// is very thick and fibrous, so furrows are broad and the ridges between them thick.
export function makeRedwoodBark(rng, { w = 64, h = 128 } = {}){
  return makeTexture(w, h, (g) => {
    g.fillStyle = '#4a3022'; g.fillRect(0, 0, w, h);
    // broad fibrous ridges (lighter strips between furrows)
    for (let i = 0; i < w * 0.9; i++){
      const x = Math.random() * w;
      g.strokeStyle = Math.random() < 0.55 ? '#5a3c28' : '#38221a';
      g.globalAlpha = 0.35 + Math.random() * 0.45;
      g.lineWidth = Math.random() < 0.25 ? 3 : Math.random() < 0.5 ? 2 : 1;
      g.beginPath(); let y = -5; g.moveTo(x, y);
      while (y < h + 5){ y += 4 + Math.random() * 8; g.lineTo(x + (Math.random() - 0.5) * 3, y); }
      g.stroke();
    }
    // deep furrows — dark, wide
    g.globalAlpha = 0.7;
    for (let i = 0; i < 8; i++){
      const x = Math.random() * w;
      g.strokeStyle = '#1a100a'; g.lineWidth = 2 + Math.random() * 3;
      g.beginPath(); let y = -5; g.moveTo(x, y);
      while (y < h + 5){ y += 5 + Math.random() * 9; g.lineTo(x + (Math.random() - 0.5) * 2, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    speckle(g, 0, 0, w, h, { density: 0.3, dark: 'rgba(0,0,0,0.2)', light: 'rgba(160,80,40,0.12)' });
  }, { repeat: [1, 1] });
}

// Rowan bark: silver-grey, relatively smooth with fine horizontal lenticels —
// similar character to young ash, much lighter than oak or maple.
export function makeRowanBark(rng, { w = 64, h = 128 } = {}){
  return makeTexture(w, h, (g) => {
    g.fillStyle = '#8e8e88'; g.fillRect(0, 0, w, h);
    // fine vertical fibres, lighter than regular bark
    for (let i = 0; i < w * 1.1; i++){
      const x = Math.random() * w;
      g.strokeStyle = Math.random() < 0.5 ? '#a0a09a' : '#72726c';
      g.globalAlpha = 0.18 + Math.random() * 0.28;
      g.lineWidth = 1;
      g.beginPath(); let y = -5; g.moveTo(x, y);
      while (y < h + 5){ y += 6 + Math.random() * 10; g.lineTo(x + (Math.random() - 0.5) * 1.5, y); }
      g.stroke();
    }
    // small horizontal lenticel dashes
    g.globalAlpha = 1;
    const marks = 10 + (Math.random() * 10 | 0);
    for (let i = 0; i < marks; i++){
      g.fillStyle = '#585852';
      g.globalAlpha = 0.45 + Math.random() * 0.3;
      g.fillRect(Math.random() * w | 0, Math.random() * h | 0, 2 + (Math.random() * 5 | 0), 1);
    }
    g.globalAlpha = 1;
    speckle(g, 0, 0, w, h, { density: 0.25, dark: 'rgba(0,0,0,0.1)', light: 'rgba(255,255,255,0.15)' });
  }, { repeat: [1, 1] });
}

// Birch bark: pale cream/white base with the distinctive short horizontal dark
// lenticel dashes and faint peeling seam lines. Much smoother than regular bark
// (few vertical fibres), so the lenticels are the dominant visual.
export function makeBirchBark(rng, { w = 64, h = 128 } = {}){
  return makeTexture(w, h, (g) => {
    g.fillStyle = '#c8c4bc'; g.fillRect(0, 0, w, h);
    // subtle horizontal band variation — the pale pinkish/cream stripes of peeling bark
    for (let y = 0; y < h;){
      const bh = 2 + Math.random() * 5 | 0;
      g.fillStyle = Math.random() < 0.5 ? 'rgba(240,236,228,0.4)' : 'rgba(210,204,192,0.25)';
      g.fillRect(0, y, w, bh);
      y += bh + (1 + Math.random() * 4 | 0);
    }
    // characteristic horizontal lenticel dashes
    g.globalAlpha = 1;
    const marks = 20 + (Math.random() * 16 | 0);
    for (let i = 0; i < marks; i++){
      const mx = Math.random() * w | 0, my = Math.random() * h | 0;
      const mw = 3 + (Math.random() * 9 | 0), mh = Math.random() < 0.25 ? 2 : 1;
      g.fillStyle = Math.random() < 0.65 ? '#2c2522' : '#3e322c';
      g.globalAlpha = 0.65 + Math.random() * 0.35;
      g.fillRect(mx, my, mw, mh);
    }
    // a few longer faint horizontal seam lines
    for (let i = 0; i < 5; i++){
      const y = Math.random() * h;
      g.strokeStyle = '#2a2018'; g.globalAlpha = 0.12 + Math.random() * 0.18; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y);
      let x = 0;
      while (x < w){ x += 3 + Math.random() * 7; g.lineTo(x, y + (Math.random() - 0.5)); }
      g.stroke();
    }
    g.globalAlpha = 1;
    speckle(g, 0, 0, w, h, { density: 0.2, dark: 'rgba(0,0,0,0.07)', light: 'rgba(255,255,255,0.22)' });
  }, { repeat: [1, 1] });
}

definePattern({
  name: 'bark.generic', scale: SCALE.LEAF,
  generate: ({ rng }) => makeBark(rng),
});
