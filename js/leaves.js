/*!
 * leaves.js — pixel-art wind-blown foliage forming distinct trees.
 * Vendored from ~/annotations (viewer/leaves.js); the only changes are: it can
 * host its canvas inside a target element (LEAVES_CONFIG.target) so it hides
 * with that element, and its opacity is configurable. Self-contained IIFE.
 * (Candidate to centralise later — see openworld/future.md, distance-LOD note.)
 */
(function () {
  'use strict';

  const cfg = Object.assign({
    fps:         12,
    scale:       1,
    windAmp:     2,
    windSpeed:   0.3,
    treeSpacing: 120,
    canopyR:     72,
    density:     80,
    opacity:     0.45,   // NEW
    target:      null,   // NEW: CSS selector to host the canvas; else <body>
  }, window.LEAVES_CONFIG);

  const S        = cfg.scale;
  const FRAME_MS = 1000 / cfg.fps;

  const PALETTES = [
    ['#020501', '#080e04', '#122408'],
    ['#030702', '#0c1c06', '#20440c'],
    ['#050c03', '#163508', '#4a8a12'],
    ['#070f04', '#286014', '#8cd428'],
    ['#0b1606', '#388020', '#a4ec30'],
    ['#1a1a04', '#6e7c0e', '#a0a81a'],
  ];

  function parseSpr(rows) {
    const out = { s: [], b: [], h: [] };
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const c = rows[y][x];
        if (c === 's' || c === 'b' || c === 'h') out[c].push([x, y]);
      }
    return out;
  }

  const SPRITES = [
    parseSpr([
      '.......hhhhh....', '.....hhbbbbbhh..', '....hbbbbbbbbh..', '...sbbbbbbbbbhh.',
      '..ssbbbbbbbbbbb.', '..ssbbbbbbbbbbbb', '..sssbbbbbbbbbb.', '...sssbbbbbbbb..',
      '....sssbbbbbb...', '.....sssbbb.....', '......sss.......',
    ]),
    parseSpr([
      '.........hhhhhhh....', '.......hhbbbbbbhh...', '.....hhbbbbbbbbbhh..',
      '....sbbbbbbbbbbbbbh.', '...ssbbbbbbbbbbbbbbb', '..sssbbbbbbbbbbbbbbb',
      '...sssbbbbbbbbbbbbb.', '....ssssbbbbbbbbb...', '.....sssssss........',
    ]),
    parseSpr([
      '....hhhh..', '...hbbbhh.', '..hbbbbbh.', '.sbbbbbbhh', '.sbbbbbbbb', 'ssbbbbbbbb',
      'ssbbbbbbb.', '.ssbbbbbbb', '..ssbbbbbb', '..sssbbbb.', '...sssbbb.', '....ssbb..',
      '.....sbb..', '......ss..', '.......s..',
    ]),
    parseSpr([
      '......hhhh....', '....hhbbbbhh..', '...hbbbbbbbbh.', '..sbbbbbbbbbbh', '.ssbbbbbbbbbbb',
      '.ssbbbbbbbbbb.', '.ssbbbbbbbbbb.', '.sssbbbbbbbb..', '..sssbbbbbbb..', '...sssbbbbbb..',
      '....ssssbbbb..', '.....sssss....',
    ]),
    parseSpr([
      '....hhhh...', '..hhbbbbbh.', '.sbbbbbbbbh', 'ssbbbbbbbbb', 'ssbbbbbbbbb', '.sssbbbbbbb',
      '..ssssbbbb.', '...ssssss..',
    ]),
  ];

  const ROLES = ['s', 'b'];
  function buildSpriteCache() {
    const cache = [];
    for (let p = 0; p < PALETTES.length; p++) {
      const row = [];
      for (let si = 0; si < SPRITES.length; si++) {
        const sprite = SPRITES[si];
        let maxX = 0, maxY = 0;
        for (const role of ROLES) for (const [x, y] of sprite[role]) {
          if (x > maxX) maxX = x; if (y > maxY) maxY = y;
        }
        const oc  = new OffscreenCanvas((maxX + 1) * S, (maxY + 1) * S);
        const oc2 = oc.getContext('2d');
        for (let r = 0; r < ROLES.length; r++) {
          oc2.fillStyle = PALETTES[p][r];
          for (const [x, y] of sprite[ROLES[r]]) oc2.fillRect(x * S, y * S, S, S);
        }
        row.push(oc);
      }
      cache.push(row);
    }
    return cache;
  }
  const spriteCache = buildSpriteCache();

  // ── Canvas (hosted in target element if given, else full-screen) ───────────
  const host  = (cfg.target && document.querySelector(cfg.target)) || document.body;
  const fixed = host === document.body;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    fixed ? 'position:fixed' : 'position:absolute',
    'inset:0', 'width:100%', 'height:100%',
    'pointer-events:none', 'z-index:0',
    'opacity:' + cfg.opacity, 'filter:hue-rotate(41deg)',
  ].join(';');
  host.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let W, H, leaves;

  function buildLeaves() {
    const sp = cfg.treeSpacing, margin = sp * 2, raw = [];
    for (let ty = -margin; ty < H + margin; ty += sp) {
      for (let tx = -margin; tx < W + margin; tx += sp) {
        const cx = tx + (Math.random() - 0.5) * sp * 0.5;
        const cy = ty + (Math.random() - 0.5) * sp * 0.35;
        const r  = cfg.canopyR * (0.65 + Math.random() * 0.7);
        const treePhase = (Math.round(cx / sp) * 0.41 + Math.round(cy / sp) * 0.23) % (Math.PI * 2);
        const count = Math.round(cfg.density * (r / cfg.canopyR) ** 2);
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist  = Math.sqrt(Math.random()) * r;
          const lx = cx + Math.cos(angle) * dist, ly = cy + Math.sin(angle) * dist;
          const nx = (lx - cx) / r, ny = (ly - cy) / r;
          const lightVal = nx * 0.6 - ny * 0.8;
          const rawDepth  = (cy + margin) / (H + 2 * margin);
          const baseDepth = Math.max(0, Math.min(4, Math.round(rawDepth * 4)));
          const lightOff  = lightVal > 0.2 ? 1 : lightVal < -0.2 ? -1 : 0;
          const paletteIdx = (lightVal > 0.45 && Math.random() < 0.2)
            ? 5 : Math.max(0, Math.min(4, baseDepth + lightOff));
          raw.push({
            bx: lx, by: ly,
            phase: treePhase + (Math.random() - 0.5) * 0.4,
            spriteIdx: Math.floor(Math.random() * SPRITES.length), paletteIdx,
          });
        }
      }
    }
    leaves = raw;
  }

  function resize() {
    const useHost = host && host !== document.body;
    W = canvas.width  = (useHost ? host.clientWidth  : window.innerWidth)  || window.innerWidth;
    H = canvas.height = (useHost ? host.clientHeight : window.innerHeight) || window.innerHeight;
    buildLeaves();
  }
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 200); });
  resize();

  function drawFrame() {
    const breezeFrontX = (elapsed * 0.2 * W) % (W * 1.6) - W * 0.3;
    const gust = Math.max(0, Math.sin(elapsed * 0.07)) * Math.max(0, Math.sin(elapsed * 0.11 + 1.1));
    const gustFrontX = (elapsed * cfg.windSpeed * W) % (W * 1.8) - W * 0.4;
    ctx.clearRect(0, 0, W, H);
    for (const l of leaves) {
      const breezeDist = (l.bx - breezeFrontX) / (W * 0.45);
      const breezeBell = Math.exp(-(breezeDist * breezeDist) * 2);
      const gustDist = (l.bx - gustFrontX) / (W * 0.35);
      const gustBell = Math.exp(-(gustDist * gustDist) * 3);
      const gustAmp  = cfg.windAmp * 7.5 * gustBell * gust;
      const amp = 2.1 * breezeBell + gustAmp;
      const dx = Math.round(Math.sin(elapsed * 2.1 + l.phase) * amp);
      const dy = Math.round(Math.sin(elapsed * 1.4 + l.phase + 0.8) * amp * 0.25);
      const ox = Math.round(l.bx) + dx, oy = Math.round(l.by) + dy;
      const bitmap = spriteCache[l.paletteIdx][l.spriteIdx];
      if (ox + bitmap.width >= 0 && ox <= W && oy + bitmap.height >= 0 && oy <= H)
        ctx.drawImage(bitmap, ox, oy);
    }
  }

  let raf, lastTime = 0, elapsed = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = now - lastTime;
    if (dt < FRAME_MS) return;
    lastTime = now; elapsed += dt / 1000; drawFrame();
  }
  drawFrame();

  let running = false;
  function start() { if (running) return; running = true; lastTime = performance.now(); raf = requestAnimationFrame(tick); }
  function stop()  { if (!running) return; running = false; cancelAnimationFrame(raf); }
  document.addEventListener('visibilitychange', () => {
    if (!running) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else { lastTime = performance.now(); raf = requestAnimationFrame(tick); }
  });

  window.Leaves = { start, stop, toggle() { running ? stop() : start(); return running; } };
  start();
}());
