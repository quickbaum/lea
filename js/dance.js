// dance.js — what the music is doing at a moment, for whatever moves to it (docs/music.md
// "Built: the Gentry's lights dance"). Pure. Now the Gentry's lights in a palace hall (wisps.js)
// read it; the fae dancers to come, in real dances' steps, are to read the same.
//
//   track({ notes, strokes, beats, bars })   the timeline of what's played, in seconds from its
//       start: the tune ({ t, dur, midi }), the drums' strokes ({ t, vel, low }), the heads of
//       its beats and its bars
//   feel(T, t)   at time t: { on, beat (0..1 through it), beatLen, bar (0..1), pulse (1 on a
//       beat's head, dying away), accent (the strokes just struck, a dum more), pitch (the
//       tune's note, or the last), rise (that pitch 0..1 between the tune's lowest and highest) }

// the last index whose time is at or before t (-1 if none)
function before(list, t, key = x => x){
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (key(list[m]) <= t + 1e-9){ at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}
export function track({ notes = [], strokes = [], beats = [], bars = [] }){
  const by = (a, b) => a.t - b.t;
  const tune = [...notes].sort(by), hits = [...strokes].sort(by), ms = tune.map(n => n.midi);
  return { tune, hits, beats: [...beats].sort((a, b) => a - b), bars: [...bars].sort((a, b) => a - b),
           lo: ms.length ? Math.min(...ms) : 60, hi: ms.length ? Math.max(...ms) : 72,
           end: Math.max(beats.at(-1) ?? 0, ...tune.map(n => n.t + n.dur)) };
}
const PULSE = 0.12, ACCENT = 0.09;   // seconds for a beat's head, and a stroke, to die away
export function feel(T, t){
  const off = { on: false, beat: 0, beatLen: 1, bar: 0, pulse: 0, accent: 0, pitch: null, rise: 0.5 };
  if (!T || t < (T.beats[0] ?? 0) || t > T.end) return off;
  const i = before(T.beats, t), b0 = T.beats[i], b1 = T.beats[i + 1] ?? b0 + (b0 - (T.beats[i - 1] ?? b0 - 1));
  const j = before(T.bars, t), r0 = T.bars[j] ?? b0, r1 = T.bars[j + 1] ?? r0 + (r0 - (T.bars[j - 1] ?? r0 - 1));
  let accent = 0;
  for (let k = before(T.hits, t, h => h.t); k >= 0 && t - T.hits[k].t < 6 * ACCENT; k--)
    accent += (T.hits[k].vel ?? 1) * (T.hits[k].low ? 1.4 : 1) * Math.exp(-(t - T.hits[k].t) / ACCENT);
  const n = before(T.tune, t, x => x.t), note = n >= 0 ? T.tune[n] : null;
  const pitch = note ? note.midi : null;
  return { on: true, beat: (t - b0) / (b1 - b0), beatLen: b1 - b0, bar: (t - r0) / ((r1 - r0) || 1),
           pulse: Math.exp(-(t - b0) / PULSE), accent: Math.min(1.5, accent),
           pitch, rise: pitch == null ? 0.5 : (pitch - T.lo) / ((T.hi - T.lo) || 1) };
}
