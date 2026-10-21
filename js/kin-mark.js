// kin-mark.js — a household's mark: one of Wagara's patterns, worked in one dye.
// Kin share it, and it goes on everything they make — the thatch of their huts
// (js/campfire-view.js, HutView) and the packs they carry (js/textures.js) — so
// you can tell whose people someone is from across the clearing.
//
// The patterns are baked from Wagara's own generator (tools/bake_hut_patterns.py
// → js/gen/hut-patterns.js); this module turns them into masks, once per size.

import { HUT_PATTERNS } from './gen/hut-patterns.js';

export const KIN_DYES = [            // linear-ish RGB, 0..1
  [0.42, 0.26, 0.16],   // umber
  [0.55, 0.20, 0.14],   // madder
  [0.20, 0.24, 0.34],   // indigo
  [0.16, 0.14, 0.12],   // soot-black
];
export const PATTERN_KEYS = Object.keys(HUT_PATTERNS);

// the mark for a group id (or any integer): { key, dye }
export function kinMark(id){
  id = Math.abs(id | 0);
  return { key: PATTERN_KEYS[id % PATTERN_KEYS.length], dye: (id * 5 + 1) % KIN_DYES.length };
}

// The pattern as a square mask, N×N, 1 = figure. The tile is whole periods, so
// stretched square it still repeats. Decoding an SVG is asynchronous: returns the
// mask if it is ready, else null — and calls `onReady` once it is (callers that
// draw every frame can just ask again instead).
const MASKS = new Map();            // 'key|N' → Uint8Array | Promise-ish pending list
export function patternMask(key, N, onReady){
  const id = key + '|' + N;
  const got = MASKS.get(id);
  if (got instanceof Uint8Array) return got;
  if (got){ if (onReady) got.push(onReady); return null; }
  const waiting = onReady ? [onReady] : [];
  MASKS.set(id, waiting);
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0, N, N);
    const px = g.getImageData(0, 0, N, N).data, mask = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) mask[i] = px[i * 4] < 128 ? 1 : 0;   // black figure on white
    MASKS.set(id, mask);
    for (const f of waiting) f(mask);
  };
  im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(HUT_PATTERNS[key].svg);
  return null;
}

// The mark as a backdrop behind someone's portrait (dialogs, the kin roster, the
// hover box): their household's pattern in its dye on undyed cloth, the same
// cloth as their pack. Returns a CSS `url(...)` for `background-image`, or ''
// if the pattern hasn't decoded yet — they are decoded on load (below), long
// before anyone can open a dialog.
const BG_N = 64, BG_GROUND = [184, 156, 108];
const BG_CACHE = new Map();
export function markBackdrop(id){
  if (!Number.isFinite(id)) return '';
  const m = kinMark(id), ck = m.key + '|' + m.dye;
  if (BG_CACHE.has(ck)) return BG_CACHE.get(ck);
  const mask = patternMask(m.key, BG_N);
  if (!mask) return '';
  const c = document.createElement('canvas'); c.width = c.height = BG_N;
  const g = c.getContext('2d'), im = g.createImageData(BG_N, BG_N), d = im.data;
  const fig = KIN_DYES[m.dye].map(v => Math.round(v * 255));
  for (let i = 0; i < BG_N * BG_N; i++){
    const col = mask[i] ? fig : BG_GROUND;
    const x = i % BG_N, y = (i / BG_N) | 0, grain = ((x * 7 + y * 13) % 5) * 3;   // the pack's weave
    d[i * 4] = col[0] - grain; d[i * 4 + 1] = col[1] - grain; d[i * 4 + 2] = col[2] - grain; d[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const url = `url(${c.toDataURL()})`;
  BG_CACHE.set(ck, url);
  return url;
}
// decode every pattern at the backdrop size up front (cheap: nine small SVGs)
if (typeof document !== 'undefined') for (const k of PATTERN_KEYS) patternMask(k, BG_N);
