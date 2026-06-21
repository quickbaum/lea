import * as THREE from 'three';

// Render a canvas into a THREE texture. Nearest filtering keeps the crisp,
// grainy, pixel look across the whole world.
export function makeTexture(w, h, draw, {repeat = null, colorSpace = THREE.SRGBColorSpace} = {}){
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.colorSpace = colorSpace;
  return t;
}

// Grayscale speckle used as a multiply mask to keep surfaces grainy.
export function makeGrain(){
  return makeTexture(64, 64, (g) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++){
      const v = 170 + (Math.random() * 85 | 0);   // 170..255 -> ~0.67..1.0
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1);
    }
  }, {repeat: [60, 60], colorSpace: THREE.LinearSRGBColorSpace});
}

// A clump of grass blades on a transparent card. Blades fan up from the base
// with slight lean and per-blade shading; nearest filtering keeps them crisp and
// pixelly. `tall` grows reedy swamp grass; otherwise short meadow grass.
export function makeGrassTexture({ blades = 8, tall = false, seed = Math.random } = {}){
  const w = 48, h = 64;
  const base = tall ? [96, 112, 56] : [78, 122, 52];   // olive reeds vs green meadow
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < blades; i++){
      const bx = 5 + seed() * (w - 10);
      const bh = (tall ? 0.78 : 0.55) * h + seed() * 0.25 * h;
      const lean = (seed() - 0.5) * (tall ? 8 : 16);
      const wdt = 1.5 + seed() * (tall ? 1.5 : 2.2);
      const sh = 0.65 + seed() * 0.5;
      g.fillStyle = `rgb(${base[0]*sh|0},${base[1]*sh|0},${base[2]*sh|0})`;
      g.beginPath();
      g.moveTo(bx - wdt, h); g.lineTo(bx + wdt, h);
      g.lineTo(bx + lean, h - bh);
      g.closePath(); g.fill();
    }
  });
}

// Pussywillow: a few bare arching brown stems studded with soft silvery catkins
// (the fuzzy oval buds), on a transparent card.
export function makePussywillowTexture({ seed = Math.random } = {}){
  const w = 48, h = 80;
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    const stems = 3 + (seed() * 3 | 0);
    for (let s = 0; s < stems; s++){
      const bx = w*0.5 + (seed() - 0.5) * w*0.55;
      const topY = h*0.05 + seed() * h*0.12;
      const topX = bx + (seed() - 0.5) * w*0.5;
      const midX = (bx + topX)/2 + (seed() - 0.5) * 6;
      const midY = (h + topY)/2;
      g.strokeStyle = `rgb(${90 + (seed()*30|0)},${55 + (seed()*20|0)},${42 + (seed()*15|0)})`;
      g.lineWidth = 1.4 + seed();
      g.beginPath(); g.moveTo(bx, h); g.quadraticCurveTo(midX, midY, topX, topY); g.stroke();
      const buds = 4 + (seed() * 4 | 0);
      for (let b = 0; b < buds; b++){
        const t = 0.18 + (b / buds) * 0.78;                          // along the stem
        const px = (1-t)*(1-t)*bx + 2*(1-t)*t*midX + t*t*topX;
        const py = (1-t)*(1-t)*h  + 2*(1-t)*t*midY + t*t*topY;
        const r = 2.2 + seed() * 1.6, gray = 205 + (seed()*40|0);
        g.fillStyle = `rgb(${gray},${gray},${gray-10})`;            // silvery fuzz
        g.beginPath(); g.ellipse(px + (seed()-0.5)*2, py, r*0.7, r, (seed()-0.5)*0.6, 0, Math.PI*2); g.fill();
        g.fillStyle = 'rgba(110,112,122,0.35)';                     // soft shading
        g.beginPath(); g.ellipse(px + 0.8, py + 0.9, r*0.4, r*0.7, 0, 0, Math.PI*2); g.fill();
      }
    }
  });
}

// Cattail/bulrush reeds: tall green blades plus a stalk or two topped with the
// classic brown sausage seed-head.
export function makeCattailTexture({ seed = Math.random } = {}){
  const w = 40, h = 96;
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    const blades = 4 + (seed() * 3 | 0);
    for (let i = 0; i < blades; i++){
      const bx = 6 + seed() * (w - 12);
      const bh = (0.7 + seed()*0.3) * h, lean = (seed() - 0.5) * 10, wdt = 1.5 + seed()*1.5;
      const sh = 0.6 + seed() * 0.4;
      g.fillStyle = `rgb(${60*sh|0},${112*sh|0},${56*sh|0})`;
      g.beginPath(); g.moveTo(bx-wdt, h); g.lineTo(bx+wdt, h); g.lineTo(bx+lean, h-bh); g.closePath(); g.fill();
    }
    const stalks = 1 + (seed() * 2 | 0);
    for (let i = 0; i < stalks; i++){
      const sx = w*0.4 + (seed() - 0.5) * w*0.4;
      const topY = h - (0.82 + seed()*0.15) * h;
      g.strokeStyle = '#8a7a3e'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(sx, h); g.lineTo(sx, topY); g.stroke();
      const headH = 14 + seed()*8, headW = 4 + seed()*1.5, hy = topY + 6;
      g.fillStyle = '#5a3a1c';                                       // brown seed-head
      g.beginPath(); g.ellipse(sx, hy + headH/2, headW, headH/2, 0, 0, Math.PI*2); g.fill();
      g.strokeStyle = '#6a4a26'; g.lineWidth = 1;                    // little spike on top
      g.beginPath(); g.moveTo(sx, hy); g.lineTo(sx, topY - 4); g.stroke();
    }
  });
}

// An acorn on a transparent card: tan nut, darker hatched cap, tiny stem.
export function makeAcornTexture(){
  const w = 24, h = 32, cx = w/2;
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#9c6b35';                                  // nut body
    g.beginPath(); g.ellipse(cx, h*0.62, w*0.28, h*0.30, 0, 0, Math.PI*2); g.fill();
    g.fillStyle = '#5e3f1e';                                  // cap
    g.beginPath(); g.ellipse(cx, h*0.34, w*0.32, h*0.17, 0, 0, Math.PI*2); g.fill();
    g.strokeStyle = '#4a3015'; g.lineWidth = 1.5;             // stem
    g.beginPath(); g.moveTo(cx, h*0.18); g.lineTo(cx, h*0.05); g.stroke();
    g.fillStyle = 'rgba(255,230,180,0.4)';                    // highlight
    g.beginPath(); g.ellipse(cx-2, h*0.58, w*0.08, h*0.12, 0, 0, Math.PI*2); g.fill();
  });
}

// A small object of value carried for its own sake (not eaten or burned): a bit
// of shell, an interesting stone, a bead of amber, a quartz crystal. Drawn on a
// little transparent card for scattering in the world & gathering.
export function makeTrinketTexture(kind = 'stone'){
  const w = 22, h = 22, cx = w/2, cy = h/2;
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    if (kind === 'shell'){                                   // a cream scallop fan, ridged
      g.fillStyle = '#ecd2b6';
      g.beginPath(); g.moveTo(cx, h*0.82);
      g.arc(cx, h*0.82, w*0.42, Math.PI*1.16, Math.PI*1.84); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(150,110,90,0.5)'; g.lineWidth = 1;
      for (let i = 0; i <= 5; i++){ const a = Math.PI*1.18 + i*(Math.PI*0.64/5);
        g.beginPath(); g.moveTo(cx, h*0.82); g.lineTo(cx + Math.cos(a)*w*0.40, h*0.82 + Math.sin(a)*w*0.40); g.stroke(); }
    } else if (kind === 'amber'){                            // warm translucent bead
      g.fillStyle = '#d98a1e'; g.beginPath(); g.ellipse(cx, cy, w*0.30, h*0.34, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,224,130,0.65)'; g.beginPath(); g.ellipse(cx-2, cy-3, w*0.10, h*0.13, 0, 0, 7); g.fill();
    } else if (kind === 'quartz'){                           // pale crystal, faceted
      g.fillStyle = '#dde6ee';
      g.beginPath(); g.moveTo(cx, h*0.10); g.lineTo(cx + w*0.22, cy); g.lineTo(cx, h*0.90); g.lineTo(cx - w*0.22, cy); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath(); g.moveTo(cx, h*0.10); g.lineTo(cx + w*0.22, cy); g.lineTo(cx, cy); g.closePath(); g.fill();
    } else {                                                 // a smooth, sheened stone
      g.fillStyle = '#8d8a86'; g.beginPath(); g.ellipse(cx, cy+1, w*0.34, h*0.27, 0.3, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.ellipse(cx-2, cy-2, w*0.12, h*0.08, 0.3, 0, 7); g.fill();
    }
  });
}

// A backpack carried on an NPC's back, with its contents poking out the top:
// wood sticks, little food items (coloured by what's stowed), and any glinting
// valuables. Cached per (food, wood, kind, trinkets) by the caller.
const PACK_FOOD_COLOR = {
  berries: '#c4263a', apples: '#ce3c2c', mushrooms: '#b0623c', acorns: '#9c6b35',
  hazelnuts: '#8a6438', roots: '#6f8f3a', 'cattail root': '#6f8f3a', food: '#c4263a',
};
export function makePackTexture(food = 0, wood = 0, kind = 'food', trinkets = 0){
  return makeTexture(48, 48, (g) => {
    g.clearRect(0, 0, 48, 48);
    const fc = PACK_FOOD_COLOR[kind] || PACK_FOOD_COLOR.food;
    // contents sticking out of the top (drawn first, then the pack over their base)
    for (let i = 0; i < Math.min(wood, 4); i++){       // firewood: pale sticks
      g.strokeStyle = '#7a5226'; g.lineWidth = 3; g.beginPath();
      const x = 15 + i * 6; g.moveTo(x, 20); g.lineTo(x - 2, 4); g.stroke();
    }
    for (let i = 0; i < Math.min(food, 6); i++){       // food: round morsels
      g.fillStyle = fc; const x = 14 + (i % 3) * 8, y = 14 - (i / 3 | 0) * 6;
      g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill();
    }
    // the pack: a leather sack with a flap, two straps and a buckle
    g.fillStyle = '#7a5a32'; g.fillRect(10, 16, 28, 28);
    g.fillStyle = '#6b4d2a'; g.fillRect(10, 16, 28, 11);     // flap
    g.fillStyle = '#54391f'; g.fillRect(10, 16, 28, 2);      // top shadow
    g.strokeStyle = '#43301c'; g.lineWidth = 2;              // straps
    g.beginPath(); g.moveTo(17, 18); g.lineTo(17, 43); g.moveTo(31, 18); g.lineTo(31, 43); g.stroke();
    g.fillStyle = '#caa24a'; g.fillRect(22, 26, 4, 4);       // buckle
    for (let i = 0; i < Math.min(trinkets, 2); i++){        // valuables: a glint tied to the flap
      const x = 14 + i * 20, y = 30;
      g.fillStyle = '#9fe3e8'; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(x - 1, y - 1, 1, 0, Math.PI * 2); g.fill();
    }
  });
}

// A little mushroom on a transparent card: a domed cap over a pale stem, with a
// couple of speckles. For forageable fungi in the shade. capColor varies species.
export function makeMushroomTexture(capColor = [150, 60, 44]){
  const w = 24, h = 28, cx = w/2;
  return makeTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e7dfc8';                                  // stem
    g.fillRect(cx - w*0.10, h*0.45, w*0.20, h*0.46);
    g.fillStyle = `rgb(${capColor[0]},${capColor[1]},${capColor[2]})`;
    g.beginPath(); g.ellipse(cx, h*0.46, w*0.34, h*0.27, 0, Math.PI, 0); g.fill();   // domed cap
    g.fillStyle = 'rgba(255,255,255,0.55)';                   // flecks
    g.beginPath(); g.arc(cx - 2.5, h*0.40, 1.6, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(cx + 3,   h*0.33, 1.2, 0, Math.PI*2); g.fill();
  });
}

// A single round fruit/berry on a transparent card: dark rim, flat body colour,
// a little specular dot. Used for berries and tree fruit.
export function makeFruitTexture([r, g, b]){
  const s = 24, c = s/2, rad = s*0.40;
  return makeTexture(s, s, (g2) => {
    g2.clearRect(0, 0, s, s);
    g2.fillStyle = 'rgba(0,0,0,0.5)';
    g2.beginPath(); g2.arc(c, c, rad + 1.3, 0, Math.PI*2); g2.fill();
    g2.fillStyle = `rgb(${r},${g},${b})`;
    g2.beginPath(); g2.arc(c, c, rad, 0, Math.PI*2); g2.fill();
    g2.fillStyle = 'rgba(255,255,255,0.55)';
    g2.beginPath(); g2.arc(c - rad*0.3, c - rad*0.32, rad*0.26, 0, Math.PI*2); g2.fill();
  });
}

// Speckle a region of a 2D context with darker/lighter grain (call after a fill,
// ideally inside a clip path). Gives leaves and bark their fine texture.
export function speckle(g, x, y, w, h, {density = 0.25, dark = 'rgba(0,0,0,0.18)', light = 'rgba(255,255,255,0.14)'} = {}){
  const n = (w * h * density) | 0;
  for (let i = 0; i < n; i++){
    g.fillStyle = Math.random() < 0.5 ? dark : light;
    g.fillRect(x + Math.random() * w | 0, y + Math.random() * h | 0, 1, 1);
  }
}
