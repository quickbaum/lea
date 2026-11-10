// drums.js — the world's drums, made by synthesis (docs/music.md "Built: rhythm in Faerie").
// Taken out of the rhythm bench (tools/probes/maghreb.html), which imports it, so the bench and
// the Faerie palaces strike the same drum. The Lea's own drums (the tabor, hands) are samples,
// in instruments.js; these have none.
//
//   DRUMS[id]   its name, its strokes (a pattern row's characters, rhythm.js), which are low
//               (a dum: the drone and the broken chords' root land there), which soft
//   KITS[id]    the drums a tradition plays; `lead`, the drum the broken chords follow, `bass`,
//               the drone's and the bells'
//   strike(ctx, dest, drum, k, t, vel)   one stroke `k` on `drum` at ctx time t, into dest

export const DRUMS = {
  darbuka:  { name: 'darbuka', strokes: { D: 'dum: low, the middle of the skin', T: 'tek: high, at the rim', K: 'ka: tek with the other hand, softer' }, low: 'D', soft: 'K' },
  bendir:   { name: 'bendir', strokes: { D: 'dum, the snare buzzing under it', T: 'tek, at the rim' }, low: 'D' },
  taarija:  { name: 'taarija', strokes: { D: 'dum', T: 'tek' }, low: 'D' },
  claps:    { name: 'claps', strokes: { X: 'a clap' } },   // (not 'clap': that's the Lea's sampled clap, instruments.json)
  riq:      { name: 'riq', strokes: { D: 'dum: the skin, the jingles with it', T: 'the jingles alone' }, low: 'D' },
  tbel:     { name: 'tbel', strokes: { D: 'the curved stick, on the bass head', T: 'the thin stick, on the other' }, low: 'D' },
  krakeb:   { name: 'krakeb', strokes: { X: 'the iron castanets, clacked' } },
  kick:     { name: 'kick drum', strokes: { D: 'the kick' }, low: 'D' },
  snare:    { name: 'snare drum', strokes: { T: 'a hit', K: 'a ghost note, soft' }, soft: 'K' },
  hihat:    { name: 'hi-hat', strokes: { x: 'closed', o: 'open' } },
  bassdrum: { name: 'bass drum', strokes: { D: 'the big drum' }, low: 'D' },
  cymbals:  { name: 'cymbals', strokes: { X: 'a crash of the pair' } },
  conga:    { name: 'conga', strokes: { B: 'bass: the palm, in the middle', O: 'open: the fingers at the edge, ringing', S: 'slap: sharp, damped' }, low: 'B' },
  claves:   { name: 'claves', strokes: { X: 'the two sticks struck' } },
  shaker:   { name: 'shaker', strokes: { X: 'a shake' } },
  bell:     { name: 'bell', strokes: { X: 'the iron bell, struck' } },
  djembe:   { name: 'djembe', strokes: { B: 'bass: the palm, in the middle', T: 'tone: the fingers at the edge', S: 'slap: sharp, the fingers loose' }, low: 'B' },
  tapan:    { name: 'tapan', strokes: { D: 'the mallet, on the big head', T: 'the rod, on the small one' }, low: 'D' },
  bodhran:  { name: 'bodhrán', strokes: { D: 'a down stroke of the tipper', T: 'an up stroke' }, low: 'D' },
};
export const KITS = {
  maghreb: { name: 'Maghrebi drums', drums: ['darbuka', 'bendir', 'taarija', 'claps'], lead: 'darbuka', bass: 'bendir' },
  gnawa:   { name: 'Gnawa', drums: ['tbel', 'krakeb', 'claps'], lead: 'tbel', bass: 'tbel' },
  arabic:  { name: 'Arabic takht', drums: ['darbuka', 'riq', 'claps'], lead: 'darbuka', bass: 'darbuka' },
  kit:     { name: 'drum kit', drums: ['kick', 'snare', 'hihat'], lead: 'hihat', bass: 'kick' },
  band:    { name: 'brass band', drums: ['bassdrum', 'snare', 'cymbals'], lead: 'snare', bass: 'bassdrum' },
  latin:   { name: 'Latin', drums: ['conga', 'claves', 'shaker'], lead: 'conga', bass: 'conga' },
  westafrica: { name: 'West African', drums: ['bell', 'djembe', 'shaker'], lead: 'djembe', bass: 'djembe' },
  balkan:  { name: 'Balkan', drums: ['tapan', 'darbuka'], lead: 'darbuka', bass: 'tapan' },
  irish:   { name: 'Irish', drums: ['bodhran'], lead: 'bodhran', bass: 'bodhran' },
};

// a second of white noise, one per AudioContext, for the skins' rattle and the metal
const NOISE = new WeakMap();
function noiseOf(ctx){
  let b = NOISE.get(ctx);
  if (!b){ b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; NOISE.set(ctx, b); }
  return b;
}
// the pieces a stroke is made of: a pitched thump (tone), a band of noise (hiss), each under a
// quick envelope into the drum's out
function voice(ctx, dest, vel){
  const env = (t, peak, dec) => { const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak * vel, t + 0.002); g.gain.setTargetAtTime(0, t + 0.004, dec); g.connect(dest); return g; };
  const tone = (t, f0, f1, peak, dec, type = 'sine') => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec * 2);
    o.connect(env(t, peak, dec)); o.start(t); o.stop(t + dec * 8);
  };
  const hiss = (t, freq, q, peak, dec, len = 0.4) => {
    const s = ctx.createBufferSource(); s.buffer = noiseOf(ctx); const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); f.connect(env(t, peak, dec)); s.start(t, Math.random() * 0.5); s.stop(t + len);
  };
  return { tone, hiss };
}
// the riq's jingles: two pairs of little cymbals, a hair apart
const jingle = (hiss, t, g) => { hiss(t, 7200, 3, 0.4 * g, 0.06, 0.3); hiss(t + 0.011, 9300, 3, 0.3 * g, 0.05, 0.3); };
export const SOUND = {
  darbuka: { D: ({ tone, hiss }, t) => { tone(t, 150, 85, 0.9, 0.12); hiss(t, 400, 1, 0.15, 0.02); },
             T: ({ tone, hiss }, t) => { tone(t, 620, 560, 0.35, 0.03, 'triangle'); hiss(t, 3800, 2, 0.55, 0.025); },
             K: ({ tone, hiss }, t) => { tone(t, 600, 540, 0.2, 0.025, 'triangle'); hiss(t, 3400, 2, 0.32, 0.02); } },
  bendir:  { D: ({ tone, hiss }, t) => { tone(t, 75, 52, 0.9, 0.2); hiss(t, 1800, 0.8, 0.22, 0.12, 0.7); },          // the gut snare buzzes under it
             T: ({ hiss }, t) => { hiss(t, 1300, 1.2, 0.5, 0.04); hiss(t, 2200, 0.8, 0.18, 0.1, 0.5); } },
  taarija: { D: ({ tone }, t) => { tone(t, 260, 210, 0.45, 0.06); },
             T: ({ tone, hiss }, t) => { tone(t, 900, 850, 0.2, 0.02, 'triangle'); hiss(t, 5000, 2, 0.35, 0.015); } },
  claps:   { X: ({ hiss }, t) => { for (const dt of [0, 0.009, 0.019]) hiss(t + dt, 1200, 1.5, 0.45, dt < 0.019 ? 0.006 : 0.05, 0.2); } },
  riq:     { D: ({ tone, hiss }, t) => { tone(t, 230, 190, 0.4, 0.05); jingle(hiss, t, 0.4); }, T: ({ hiss }, t) => jingle(hiss, t, 0.5) },
  tbel:    { D: ({ tone, hiss }, t) => { tone(t, 68, 48, 1, 0.22); hiss(t, 500, 1, 0.2, 0.05); },
             T: ({ tone, hiss }, t) => { tone(t, 420, 400, 0.25, 0.02, 'triangle'); hiss(t, 2600, 2, 0.35, 0.02); } },
  krakeb:  { X: ({ tone, hiss }, t) => { for (const [dt, g] of [[0, 1], [0.016, 0.6]]){ hiss(t + dt, 4600, 4, 0.55 * g, 0.03, 0.2); tone(t + dt, 2900, 2800, 0.12 * g, 0.03, 'square'); } } },
  kick:    { D: ({ tone, hiss }, t) => { tone(t, 130, 45, 1, 0.13); hiss(t, 3000, 1, 0.12, 0.005); } },
  snare:   { T: ({ tone, hiss }, t) => { tone(t, 200, 175, 0.4, 0.05, 'triangle'); hiss(t, 2600, 0.7, 0.7, 0.09, 0.4); },
             K: ({ tone, hiss }, t) => { tone(t, 200, 175, 0.12, 0.03, 'triangle'); hiss(t, 2600, 0.7, 0.22, 0.04, 0.2); } },
  hihat:   { x: ({ hiss }, t) => hiss(t, 9000, 0.9, 0.35, 0.02, 0.15), o: ({ hiss }, t) => hiss(t, 8500, 0.8, 0.32, 0.2, 0.7) },
  bassdrum:{ D: ({ tone, hiss }, t) => { tone(t, 90, 48, 1, 0.26); hiss(t, 300, 1, 0.2, 0.05); } },
  cymbals: { X: ({ hiss }, t) => { hiss(t, 6000, 0.5, 0.45, 0.3, 1.2); hiss(t, 3500, 1, 0.2, 0.18, 0.8); } },
  conga:   { B: ({ tone }, t) => tone(t, 115, 92, 0.75, 0.08), O: ({ tone }, t) => tone(t, 310, 290, 0.6, 0.12),
             S: ({ tone, hiss }, t) => { tone(t, 340, 330, 0.3, 0.03); hiss(t, 2100, 1.5, 0.5, 0.02); } },
  claves:  { X: ({ tone }, t) => tone(t, 2500, 2480, 0.5, 0.025) },
  shaker:  { X: ({ hiss }, t) => hiss(t, 7000, 1.2, 0.22, 0.03, 0.12) },
  bell:    { X: ({ tone }, t) => { tone(t, 1250, 1250, 0.32, 0.15, 'triangle'); tone(t, 2170, 2170, 0.12, 0.08); } },
  djembe:  { B: ({ tone }, t) => tone(t, 88, 66, 0.9, 0.12), T: ({ tone, hiss }, t) => { tone(t, 330, 310, 0.5, 0.06); hiss(t, 1500, 1, 0.15, 0.02); },
             S: ({ tone, hiss }, t) => { hiss(t, 2600, 1, 0.6, 0.03); tone(t, 430, 410, 0.25, 0.02); } },
  tapan:   { D: ({ tone, hiss }, t) => { tone(t, 66, 44, 1, 0.3); hiss(t, 600, 1, 0.25, 0.06); }, T: ({ hiss }, t) => hiss(t, 4200, 1.2, 0.45, 0.025) },
  bodhran: { D: ({ tone, hiss }, t) => { tone(t, 98, 72, 0.8, 0.12); hiss(t, 800, 1, 0.12, 0.03); }, T: ({ tone, hiss }, t) => { tone(t, 145, 122, 0.45, 0.07); hiss(t, 900, 1, 0.08, 0.02); } },
};
export const isSynthDrum = id => !!SOUND[id];
// one stroke; false if the drum hasn't that stroke
export function strike(ctx, dest, drum, k, t, vel = 1){
  const f = SOUND[drum]?.[k];
  if (!f) return false;
  f(voice(ctx, dest, vel), t);
  return true;
}
