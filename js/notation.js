// notation.js — a tune drawn on the staff, for the page of a music book (js/page.js).
// One staff to a phrase, each phrase once, in the order written (the form that repeats
// them is the player's business). The clef is a letter G on the second line, as old
// books drew it before it grew its curls; the choir book has square heads on red lines,
// as a monastery's would. Marked accidentals only; the key signature does the rest.
// Returns an SVG string (no DOM), so a check can draw one without a browser. Each sounding
// note is a <g class="note"> with its pitch and length (data-midi, data-dur in seconds) and a
// clear strip over the staff to its next note, so page.js can play it under a click or a drag.

import { tune } from './tunes.js';

const GAP = 8, HALF = GAP / 2, W = 620, LEFT = 74, TOP = 22, SYS = 78;
const E4 = 30;                                     // the bottom line (tunes.js steps: C4 = 28)
const SHARP_AT = [38, 35, 39, 36, 33, 37, 34], FLAT_AT = [34, 37, 33, 36, 32, 35, 31];
const SIG = { C: 0, G: 1, D: 2, A: 3, F: -1, Bb: -2, Am: 0, Em: 1, Bm: 2, Dm: -1, Gm: -2, Ddor: 0, Ador: 1, Edor: 2, Gmix: 0, Dmix: 1 };
const ACC = { '^': '♯', _: '♭', '=': '♮' };

export function staffSvg(id, { square = false } = {}){
  const P = tune(id);
  const sig = SIG[P.key] || 0, line = square ? '#a8382c' : 'currentColor';
  const out = [];
  // a tune sung low (a tenor's, as old music mostly is) is written an octave up, with an 8
  // under the clef, as editions of it do: else it hangs below the staff on ledger lines
  const all = P.phrases.flatMap(ph => ph.notes).filter(n => n.midi != null);
  const oct = all.reduce((a, n) => a + n.midi, 0) / all.length < 62 ? 7 : 0;
  P.phrases.forEach((ph, s) => {
    const base = TOP + s * SYS + 4 * GAP, y = step => base - (step - E4) * HALF;
    for (let l = 0; l < 5; l++) out.push(`<line x1="0" x2="${W}" y1="${base - l * GAP}" y2="${base - l * GAP}" stroke="${line}" stroke-width="0.8"/>`);
    out.push(`<text x="4" y="${y(32) + 7}" font-size="26" font-style="italic">G</text>`);
    if (oct) out.push(`<text x="9" y="${y(27) + 5}" font-size="10">8</text>`);
    let x = 26;
    for (let k = 0; k < Math.abs(sig); k++){ out.push(`<text x="${x}" y="${y((sig > 0 ? SHARP_AT : FLAT_AT)[k]) + 4}" font-size="13">${sig > 0 ? '♯' : '♭'}</text>`); x += 8; }
    if (s === 0) out.push(`<text x="${x + 4}" y="${base - 2 * GAP + 1}" font-size="18" font-weight="bold">${P.meter[0]}</text><text x="${x + 4}" y="${base + 1}" font-size="18" font-weight="bold">${P.meter[1]}</text>`);
    // spread the notes over the staff by length, a little more than in proportion
    const notes = ph.notes, room = W - LEFT - 10, weight = n => 0.9 + Math.sqrt(n.len);
    const total = notes.reduce((a, n) => a + weight(n), 0) + ph.bars.length * 0.6;
    let nx = LEFT, bi = 0;
    notes.forEach((n, i) => {
      while (bi < ph.bars.length && ph.bars[bi] === i){ if (i > 0) out.push(`<line x1="${nx - 6}" x2="${nx - 6}" y1="${base - 4 * GAP}" y2="${base}" stroke="currentColor" stroke-width="1"/>`); nx += room * 0.6 / total; bi++; }
      const adv = room * weight(n) / total, svg = noteSvg(oct && n.midi != null ? { ...n, step: n.step + oct } : n, nx, y, P.unit, square);
      out.push(n.midi == null ? svg : `<g class="note" data-midi="${n.midi}" data-dur="${(n.len * P.unitSec).toFixed(3)}"><rect x="${nx - 7}" y="${base - 4 * GAP - 14}" width="${adv}" height="${4 * GAP + 28}" fill="transparent"/>${svg}</g>`);
      nx += adv;
    });
    if (ph.bars.at(-1) === notes.length) out.push(`<line x1="${nx - 6}" x2="${nx - 6}" y1="${base - 4 * GAP}" y2="${base}" stroke="currentColor" stroke-width="1"/>`);
  });
  const h = TOP + P.phrases.length * SYS - 18;
  return `<svg class="staff" viewBox="0 0 ${W} ${h}" xmlns="http://www.w3.org/2000/svg" fill="currentColor" font-family="inherit">${out.join('')}</svg>`;
}

function noteSvg(n, x, y, unit, square){
  const q = n.len * unit * 4;                     // in crotchets
  if (n.midi == null) return `<path d="M${x - 3} ${y(36) - 3} l6 0 l-5 12" stroke="currentColor" fill="none" stroke-width="1.6"/><circle cx="${x - 2}" cy="${y(36) - 3}" r="2"/>`;
  const cy = y(n.step), out = [];
  for (let s = 28; s >= n.step; s -= 2) out.push(`<line x1="${x - 8}" x2="${x + 8}" y1="${y(s)}" y2="${y(s)}" stroke="currentColor" stroke-width="0.8"/>`);
  for (let s = 40; s <= n.step; s += 2) out.push(`<line x1="${x - 8}" x2="${x + 8}" y1="${y(s)}" y2="${y(s)}" stroke="currentColor" stroke-width="0.8"/>`);
  const pow2 = v => Number.isInteger(Math.log2(v)), dotted = !pow2(q) && pow2(q / 1.5), base = dotted ? q / 1.5 : q;
  const open = base >= 2;
  out.push(square
    ? `<rect x="${x - 4}" y="${cy - 3.6}" width="8" height="7.2" ${open ? 'fill="none" stroke="currentColor" stroke-width="1.4"' : ''}/>`
    : `<ellipse cx="${x}" cy="${cy}" rx="4.8" ry="3.5" transform="rotate(-20 ${x} ${cy})" ${open ? 'fill="none" stroke="currentColor" stroke-width="1.4"' : ''}/>`);
  if (n.mark) out.push(`<text x="${x - 15}" y="${cy + 4}" font-size="12">${ACC[n.mark]}</text>`);
  if (dotted) out.push(`<circle cx="${x + 8}" cy="${cy - (n.step % 2 ? 0 : HALF)}" r="1.4"/>`);
  if (base < 4){
    const up = n.step < 34, sx = up ? x + 4.3 : x - 4.3, ey = up ? cy - 26 : cy + 26;
    out.push(`<line x1="${sx}" x2="${sx}" y1="${cy}" y2="${ey}" stroke="currentColor" stroke-width="1.1"/>`);
    const flags = base <= 0.25 ? 2 : base <= 0.5 ? 1 : 0;
    for (let f = 0; f < flags; f++){ const fy = ey + (up ? f * 6 : -f * 6); out.push(`<path d="M${sx} ${fy} q7 ${up ? 6 : -6} 5 ${up ? 14 : -14}" stroke="currentColor" fill="none" stroke-width="1.3"/>`); }
  }
  return out.join('');
}
