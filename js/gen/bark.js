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

definePattern({
  name: 'bark.generic', scale: SCALE.LEAF,
  generate: ({ rng }) => makeBark(rng),
});
