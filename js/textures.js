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

// Rock face texture for cliff geometry: horizontal strata bands with cracks and grain.
// Colors are neutral so Lambert lighting + flat shading provide most of the variation.
export function makeCliffTexture(){
  return makeTexture(128, 128, (g) => {
    // Strata bands (bottom of canvas = low y in world = deeper rock)
    const bands = [
      [0,  18, [105, 98,  86 ]],  // deep warm gray
      [18, 34, [120, 112, 97 ]],  // medium tan
      [34, 48, [ 96,  91, 80 ]],  // darker slate
      [48, 62, [131, 121, 104]],  // light sandstone
      [62, 76, [103,  97, 87 ]],  // medium gray
      [76, 90, [115, 107, 93 ]],  // warm mid
      [90,108, [ 92,  87, 77 ]],  // dark base layer
      [108,128,[125, 116, 100]],  // top cap, lighter
    ];
    for (const [y0, y1, [r, gr, b]] of bands){
      // Each band: slight horizontal variation (vertical gradient within band)
      for (let y = y0; y < y1; y++){
        const fade = (y - y0) / (y1 - y0);
        const rf = r - fade * 8, gf = gr - fade * 7, bf = b - fade * 6;
        g.fillStyle = `rgb(${rf|0},${gf|0},${bf|0})`;
        g.fillRect(0, y, 128, 1);
      }
    }
    // Band boundary hairlines (cracks between strata)
    g.globalAlpha = 0.45;
    g.fillStyle = '#3a3530';
    for (const [, y1] of bands.slice(0, -1)){
      g.fillRect(0, y1 - 1, 128, 2);
    }
    g.globalAlpha = 1;
    // Vertical fracture lines — slightly wavy
    for (let i = 0; i < 6; i++){
      let cx = 8 + (i / 6) * 112 + (Math.random() - 0.5) * 12;
      g.strokeStyle = `rgba(50,46,40,${0.25 + Math.random() * 0.25})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx, 0);
      for (let y = 8; y <= 128; y += 8){
        cx += (Math.random() - 0.5) * 5;
        g.lineTo(Math.max(1, Math.min(127, cx)), y);
      }
      g.stroke();
    }
    // Pixel grain
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++){
      if (Math.random() > 0.35) continue;
      const v = (Math.random() - 0.5) * 22 | 0;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v/255})` : `rgba(0,0,0,${(-v)/255})`;
      g.fillRect(x, y, 1, 1);
    }
  }, { colorSpace: THREE.SRGBColorSpace });
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

// Redwood foliage disc: a top-down view of a dense conifer canopy layer.
// Built in passes — dark base, branch structure, individual foliage tufts with
// highlights, shadowed gaps, and a feathery jagged rim — so each horizontal disc
// reads as a real mass of needles with visible surface texture.
export function makeRedwoodFoliageTexture({ seed = Math.random } = {}){
  const W = 128, H = 128;
  return makeTexture(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = W * 0.44;

    const SHADOW = ['#0e2414', '#102618', '#0c2012'];
    const DARK   = ['#183e22', '#1a4226', '#163c20'];
    const MID    = ['#245430', '#286038', '#226030'];  // mid green base tufts
    const LITE   = ['#3a7a48', '#428650', '#367244'];  // lit tuft tops
    const HILIT  = ['#4e9660', '#56a06a', '#488c5a'];  // brightest highlights

    // pass 1: dark base fill — establishes the overall blob shape
    for (let i = 0; i < 60; i++){
      const a = seed() * Math.PI * 2, r = Math.pow(seed(), 0.45) * R;
      g.fillStyle = r / R < 0.5 ? SHADOW[seed() * SHADOW.length | 0] : DARK[seed() * DARK.length | 0];
      g.beginPath(); g.arc(cx + Math.cos(a)*r, cy + Math.sin(a)*r, R*(0.08+seed()*0.18), 0, Math.PI*2); g.fill();
    }

    // pass 2: radial branch armature — the structural skeleton of the tier
    const nBranches = 8 + (seed() * 6 | 0);
    for (let i = 0; i < nBranches; i++){
      const a = (i / nBranches) * Math.PI * 2 + seed() * 0.4;
      const len = R * (0.5 + seed() * 0.45);
      g.strokeStyle = DARK[seed() * DARK.length | 0];
      g.lineWidth = 2 + seed() * 2;
      g.globalAlpha = 0.7;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a)*len, cy + Math.sin(a)*len); g.stroke();
      // sub-branches off each main branch
      for (let j = 1; j <= 3; j++){
        const t = j / 4, bx = cx + Math.cos(a)*len*t, by = cy + Math.sin(a)*len*t;
        const sa = a + (seed()-0.5)*1.2, sl = R*(0.1+seed()*0.15);
        g.lineWidth = 1; g.globalAlpha = 0.5;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx+Math.cos(sa)*sl, by+Math.sin(sa)*sl); g.stroke();
      }
    }
    g.globalAlpha = 1;

    // pass 3: foliage tufts — mid-green blobs scattered across the disc, denser
    // toward the rim where light hits the top of the layer
    for (let i = 0; i < 120; i++){
      const a = seed() * Math.PI * 2, r = Math.pow(seed(), 0.6) * R;
      const t = r / R;
      const bx = cx + Math.cos(a)*r, by = cy + Math.sin(a)*r;
      const br = R * (0.04 + seed() * 0.10);
      g.fillStyle = t < 0.35 ? DARK[seed() * DARK.length | 0]
                  : t < 0.65 ? MID[seed()  * MID.length  | 0]
                  :             LITE[seed() * LITE.length | 0];
      g.beginPath(); g.arc(bx, by, br, 0, Math.PI*2); g.fill();
    }

    // pass 4: highlight dots — small bright spots on the lit tops of tufts
    for (let i = 0; i < 60; i++){
      const a = seed() * Math.PI * 2, r = R * (0.15 + seed() * 0.75);
      const bx = cx + Math.cos(a)*r, by = cy + Math.sin(a)*r;
      g.fillStyle = seed() < 0.5 ? LITE[seed()*LITE.length|0] : HILIT[seed()*HILIT.length|0];
      g.globalAlpha = 0.55 + seed() * 0.45;
      g.beginPath(); g.arc(bx, by, R*(0.02+seed()*0.04), 0, Math.PI*2); g.fill();
    }
    g.globalAlpha = 1;

    // pass 5: needle-spray details at branch tips — short radiating lines that
    // break up any remaining smoothness and add a conifer texture
    for (let i = 0; i < 40; i++){
      const a0 = seed() * Math.PI * 2, r0 = R * (0.2 + seed() * 0.7);
      const bx = cx + Math.cos(a0)*r0, by = cy + Math.sin(a0)*r0;
      const nNeedles = 4 + (seed() * 4 | 0);
      g.strokeStyle = seed() < 0.5 ? MID[seed()*MID.length|0] : LITE[seed()*LITE.length|0];
      g.lineWidth = 1; g.globalAlpha = 0.55 + seed() * 0.3;
      for (let j = 0; j < nNeedles; j++){
        const na = seed() * Math.PI * 2, nl = R * (0.04 + seed() * 0.07);
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx+Math.cos(na)*nl, by+Math.sin(na)*nl); g.stroke();
      }
    }
    g.globalAlpha = 1;

    // pass 6: centre shadow — deep shadow under the core hides the branch origin
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
    grad.addColorStop(0,   'rgba(0,0,0,0.55)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.15)');
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
  });
}

// Hanging vine/moss cascade: curving strands falling from the top with scattered
// leaf clusters — drawn top-to-bottom so UV V=1 (top of the vine card) is the
// attachment point and the trailing tips fall toward V=0.
export function makeVineTexture({ seed = Math.random } = {}){
  const W = 64, H = 128;
  return makeTexture(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const STEM = ['#172a08', '#1e3509', '#24400b', '#182c07'];
    const LEAF = ['#2d5010', '#3a6614', '#447418', '#305812'];
    const LITE = ['#4a7e20', '#549228', '#3e7018'];
    const nStrands = 7 + (seed() * 4 | 0);
    for (let s = 0; s < nStrands; s++){
      const startX = (0.08 + seed() * 0.84) * W;
      const dropFrac = 0.55 + seed() * 0.45;   // how far down the strand reaches (55–100%)
      const endY = H * dropFrac;
      const drift = (seed() - 0.5) * 14;       // total horizontal drift over the drop
      const freq  = 1.2 + seed() * 2.0;        // sine frequency along the drop
      const phase = seed() * Math.PI * 2;
      const amp   = 1.5 + seed() * 3.5;
      const stemCol = STEM[seed() * STEM.length | 0];
      for (let y = 0; y < endY; y++){
        const t = y / endY;
        const x = Math.round(startX + drift * t + Math.sin(t * freq * Math.PI * 2 + phase) * amp);
        if (x < 0 || x >= W) continue;
        g.fillStyle = stemCol;
        g.fillRect(x, y, 1, 1);
        if (seed() < 0.12) g.fillRect(x + 1, y, 1, 1);   // occasional 2-px width
        // leaf cluster
        if (seed() < 0.055 && y > 3){
          const side = seed() < 0.5 ? -1 : 1;
          const lx   = x + side * (2 + (seed() * 3 | 0));
          const lw   = 2 + (seed() * 3 | 0);
          const lh   = 1 + (seed() * 2 | 0);
          const lc   = seed() < 0.65 ? LEAF[seed() * LEAF.length | 0] : LITE[seed() * LITE.length | 0];
          g.fillStyle = lc;
          g.fillRect(Math.round(lx - lw / 2), y, lw, lh);
          if (seed() < 0.5) g.fillRect(Math.round(lx - (lw - 1) / 2), y - 1, lw - 1, 1);
        }
      }
    }
  });
}

// Fern: several arching fronds from a base, each with bilateral primary pinnae
// that themselves carry secondary sub-pinnae (bipinnate) — giving the feathery
// layered look of real ferns. 128×128 canvas for fine pixel detail.
export function makeFernTexture({ seed = Math.random } = {}){
  const W = 128, H = 128;
  return makeTexture(W, H, (g) => {
    g.clearRect(0, 0, W, H);
    const STEM = ['#162e08', '#1d3e0b', '#22480d', '#19350a'];
    const DARK = ['#2a5610', '#326214', '#2e5c12', '#386818'];
    const MID  = ['#3a7218', '#44801e', '#3e7a1a', '#4a8820'];
    const LITE = ['#56961e', '#5ea024', '#4e8e1c', '#62aa28'];

    const cx = W / 2, cy = H - 2;
    const nFronds = 5 + (seed() * 4 | 0);   // 5–8 fronds

    for (let f = 0; f < nFronds; f++){
      const baseAngle = Math.PI * (0.14 + (f / (nFronds - 1)) * 0.72);
      const frondLen  = 34 + seed() * 24;
      // droop: frond curves downward as it extends (fiddle-head arc)
      const droop     = 0.1 + seed() * 0.45;
      const stemCol   = STEM[seed() * STEM.length | 0];
      const steps     = Math.round(frondLen);

      for (let s = 0; s < steps; s++){
        const t     = s / steps;
        const angle = baseAngle + droop * t * t;   // quadratic droop — gentle at base, sharp at tip
        const sx    = cx + Math.cos(angle) * s * 0.93;
        const sy    = cy - Math.sin(angle) * s * 0.93;
        const spx   = Math.round(sx), spy = Math.round(sy);
        if (spx < 0 || spx >= W || spy < 0 || spy >= H) continue;

        g.fillStyle = stemCol;
        g.fillRect(spx, spy, 1, 1);

        // primary pinnae every 3 steps
        if (s > 5 && s % 3 === 0){
          const perpX =  Math.sin(angle);
          const perpY =  Math.cos(angle);
          const pLen  = Math.max(1, Math.round((1 - t * 0.65) * 9 + seed() * 3));
          const pCol  = t > 0.6 ? MID[seed() * MID.length | 0] : DARK[seed() * DARK.length | 0];

          for (const side of [-1, 1]){
            for (let p = 1; p <= pLen; p++){
              const pt = p / pLen;
              const lx = Math.round(sx + perpX * side * p);
              const ly = Math.round(sy + perpY * side * p);
              if (lx < 0 || lx >= W || ly < 0 || ly >= H) continue;
              g.fillStyle = pCol;
              g.fillRect(lx, ly, 1, 1);

              // secondary sub-pinnae: tiny branches off each primary pinna
              if (p > 1 && p < pLen && p % 2 === 0){
                // sub-pinna direction: angled forward along the frond + outward
                const subLen = Math.max(1, Math.round((1 - pt) * 3));
                const subCol = pt < 0.5 ? MID[seed() * MID.length | 0]
                                        : LITE[seed() * LITE.length | 0];
                g.fillStyle = subCol;
                // forward sub-pinna (toward frond tip)
                const fwdX = Math.round(lx + Math.cos(angle) * side);
                const fwdY = Math.round(ly - Math.sin(angle) * side);
                if (fwdX >= 0 && fwdX < W && fwdY >= 0 && fwdY < H) g.fillRect(fwdX, fwdY, 1, 1);
                if (subLen > 1){
                  const fx2 = Math.round(lx + perpX * side);
                  const fy2 = Math.round(ly + perpY * side);
                  if (fx2 >= 0 && fx2 < W && fy2 >= 0 && fy2 < H) g.fillRect(fx2, fy2, 1, 1);
                }
              }
            }
          }
        }
      }
    }
    // dark centre crown
    g.fillStyle = STEM[0];
    g.fillRect(cx - 1, cy - 2, 3, 3);
  });
}

// Pixel-art flower sprites for camera-facing billboard scatter.
// kind: 'daisy' | 'poppy' | 'bluebell' | 'dandelion'
// Canvas (0,0) = top-left; Three.js flipY means canvas y≈H-2 lands at the
// bottom of the geometry (ground), canvas y≈0 at the top (flower head).
export function makeFlowerTexture(kind = 'daisy', seed = Math.random){
  const W = 48, H = 64;
  return makeTexture(W, H, g => {
    g.clearRect(0, 0, W, H);
    const cx = W >> 1;        // 24 — horizontal centre
    const BASE = H - 2;       // 62 — stem base (ground level in texture)

    const dot = (x, y, col) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      g.fillStyle = col; g.fillRect(x, y, 1, 1);
    };
    const blob = (x, y, r, col) => {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx*dx + dy*dy <= r*r) dot(x+dx, y+dy, col);
    };
    const seg = (x0, y0, x1, y1, col) => {
      const dx = x1-x0, dy = y1-y0, n = Math.max(Math.abs(dx), Math.abs(dy), 1);
      for (let i = 0; i <= n; i++)
        dot(Math.round(x0 + dx*i/n), Math.round(y0 + dy*i/n), col);
    };

    if (kind === 'daisy'){
      const headY = 14 + (seed()*6|0);
      const lean  = (seed()*5|0) - 2;
      seg(cx, BASE, cx + lean, headY + 5, '#2c5c1a');
      seg(cx + lean - 1, headY + 24, cx + lean - 5, headY + 20, '#4a8024');
      seg(cx + lean + 1, headY + 34, cx + lean + 5, headY + 30, '#3e7020');
      const hx = cx + lean;
      for (let p = 0; p < 10; p++){
        const a = (p / 10) * Math.PI * 2;
        for (let r = 5; r <= 11; r++)
          dot(Math.round(hx + Math.cos(a)*r), Math.round(headY + Math.sin(a)*r),
              r > 9 ? '#d8d8cc' : '#f4f4ec');
      }
      blob(hx, headY, 3, '#e8b000');
      blob(hx, headY, 1, '#b88800');
    }

    else if (kind === 'poppy'){
      const headY = 12 + (seed()*6|0);
      const lean  = (seed()*6|0) - 3;
      // gently curved stem
      for (let y = BASE; y >= headY + 5; y--){
        const t = (BASE - y) / (BASE - headY - 5);
        dot(Math.round(cx + lean * t * t), y, '#3a6618');
      }
      const hx = cx + lean;
      seg(hx, headY + 22, hx - 7, headY + 17, '#3c6a1c');
      seg(hx, headY + 22, hx - 5, headY + 26, '#3c6a1c');
      for (let p = 0; p < 4; p++){
        const a = (p / 4) * Math.PI * 2 + Math.PI/5;
        for (let r = 3; r <= 13; r++)
          for (let s = -0.4; s <= 0.4; s += 0.14){
            const px = Math.round(hx + Math.cos(a + s*(r/13)) * r);
            const py = Math.round(headY + Math.sin(a + s*(r/13)) * r);
            dot(px, py, r > 9 ? '#e83820' : r > 5 ? '#cc2010' : '#a81808');
          }
      }
      blob(hx, headY, 2, '#200808');
    }

    else if (kind === 'bluebell'){
      const nBells = 3 + (seed()*2|0);
      const forkY  = 10 + (seed()*8|0);
      seg(cx, BASE, cx, forkY + 4, '#2c6018');
      for (let b = 0; b < nBells; b++){
        const side = b % 2 === 0 ? 1 : -1;
        const bx   = cx + side * (4 + (seed()*4|0));
        const by   = forkY + (seed()*10|0) + Math.round(b / nBells * 18);
        seg(cx, forkY + Math.round(b / nBells * 8), bx, by, '#2c6018');
        for (let dy = 0; dy < 9; dy++){
          const hw = 1 + Math.round(dy * 0.45);
          for (let dx = -hw; dx <= hw; dx++)
            dot(bx + dx, by + dy,
              (Math.abs(dx) === hw || dy === 8) ? '#3828a8' : dy < 3 ? '#6848d8' : '#7a5cf0');
        }
        dot(bx, by + 10, '#ede050');
      }
    }

    else if (kind === 'dandelion'){
      const headY = 14 + (seed()*6|0);
      const lean  = (seed()*4|0) - 2;
      seg(cx, BASE, cx + lean, headY + 2, '#426820');
      seg(cx + lean, headY + 20, cx + lean - 8, headY + 15, '#3a6018');
      const hx = cx + lean;
      const rays = 22 + (seed()*8|0);
      for (let r = 0; r < rays; r++){
        const a = (r / rays) * Math.PI * 2;
        for (let d = 3; d <= 12; d++)
          dot(Math.round(hx + Math.cos(a)*d), Math.round(headY + Math.sin(a)*d),
              d < 6 ? '#cc9800' : d < 9 ? '#eec000' : '#ffe040');
      }
      blob(hx, headY, 2, '#b08000');
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
