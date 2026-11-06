// craft-view.js — a village craft as a small pixel picture. The design is one of Wagara's patterns, already baked
// for the Lea (js/kin-mark.js patternMask, js/gen/hut-patterns.js). A style keeps its design, arrangement and medium
// apart so each can grow on its own (trade.js craftStyles); this only draws how it's worked.

import { patternMask, PATTERN_KEYS } from './kin-mark.js';

const SIZE = 32, HEM = 2;
// the wagara among the baked patterns, for now (the others came with the kin marks)
const WAGARA = PATTERN_KEYS.filter(k => ['seigaiha', 'asanoha', 'shippo', 'kikko', 'yagasuri', 'uroko'].includes(k));
export const designOf = s => WAGARA[s.design % WAGARA.length];
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16), c = s => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k))); return `rgb(${c(16)},${c(8)},${c(0)})`; };

// how it's worked: thread leaves little gaps along the stitch; beads sit on a grid, each with its catch of light
const WORKED = {
  embroidery: { mask: SIZE, draw(g, s, m){ for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++){
    const hem = x < HEM || y < HEM || x >= SIZE - HEM || y >= SIZE - HEM, on = m[y * SIZE + x];
    g.fillStyle = hem ? shade(s.ground, 0.72) : on && (x + y * 2) % 5 !== 4 ? ((x + y) % 2 ? s.ink : shade(s.ink, 1.18)) : (x ^ y) & 1 ? s.ground : shade(s.ground, 0.94);
    g.fillRect(x, y, 1, 1); } } },
  beadwork: { mask: SIZE / 2, draw(g, s, m){ const N = SIZE / 2; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const c = m[j * N + i] ? s.ink : s.ground, x = i * 2, y = j * 2;
    g.fillStyle = shade(c, 0.72); g.fillRect(x, y, 2, 2);
    g.fillStyle = c; g.fillRect(x, y, 1, 2); g.fillRect(x, y, 2, 1);
    g.fillStyle = shade(c, 1.25); g.fillRect(x, y, 1, 1); } } },
};
// hands the picture over as soon as the pattern has decoded
export function craftPic(s, done){
  const w = WORKED[s.medium], make = m => {
    const c = document.createElement('canvas'); c.width = c.height = SIZE;
    w.draw(c.getContext('2d'), s, m); done(c.toDataURL('image/png'));
  };
  const m = patternMask(designOf(s), w.mask, make);
  if (m) make(m);
}
