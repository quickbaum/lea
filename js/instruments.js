// instruments.js — the Lea's instruments, sounding (docs/music.md "Sound"). Each is a
// few samples out of a General MIDI soundfont (tools/extract_instruments.py →
// instruments/instruments.json): a note plays the sample nearest it, pitched up or down,
// looped while it's held, under a simple envelope (blown and bowed ones hold; plucked and
// struck ones die away). Its own AudioContext, like footsteps.js and ambience.js, made on
// the first gesture. A drum (`perc`) isn't pitched: each note names one of its sounds, which
// rings out whole.
//
// Everything is heard in a room (setRoom): a reverb made here, from decaying noise, as long
// and as dark as the place, with distinct echoes off the walls in a cave. Out on the Lea it's
// nearly dry; a crypt's stone rings for a couple of seconds; a cave rings for longer and gives
// your notes back to you; a Faerie palace is long and bright.
//
//   const inst = new Instruments(); inst.init()            (on a click)
//   inst.setRoom('cave')                                   (ROOMS)
//   const p = await inst.play('vielle', schedule(id))       (tunes.js schedule; arrange.js parts)
//   p.place(gain, pan)  — where the player stands from you; p.stop(); p.done (a promise)
//   inst.play('darbuka', { notes: [{ t, k: 'D' }] })        (a drum with no samples: drums.js, each note a stroke)
//   { at }: start at that ctx time instead of now, so parts asked for apart keep time together

import { isSynthDrum, strike } from './drums.js';

const BANK = 'instruments/';
const LEAD = 0.08;          // seconds between asking and the first note
// Tunes against the world's sounds. Samples are normalised, so a tune ran about 20 dB over the
// leaves at the default slider (too loud); this takes 10 dB off. Speech skips it (voice).
const MUSIC_LEVEL = 0.32;
// decay: seconds for the tail to die away (−60 dB); wet: how much of it you hear; tone: how
// bright the tail is (0 dark .. 1 bright); echoes: [seconds, loudness] off far walls
export const ROOMS = {
  open:   { decay: 0.6, wet: 0.12, tone: 0.55, echoes: [] },
  crypt:  { decay: 2.4, wet: 0.42, tone: 0.45, echoes: [[0.09, 0.25]] },
  cave:   { decay: 4.5, wet: 0.62, tone: 0.28, echoes: [[0.23, 0.55], [0.47, 0.38], [0.71, 0.24], [0.96, 0.14], [1.2, 0.08]] },
  palace: { decay: 3.4, wet: 0.48, tone: 0.8, echoes: [[0.12, 0.2]] },
};

export class Instruments {
  constructor(){ this.ctx = null; this.master = null; this._vol = 1; this._bank = null; this._buf = new Map(); this._room = 'open'; }

  init(){
    if (!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9 * this._vol;
      // dry straight out; wet through the room's reverb
      this.dry = this.ctx.createGain(); this.wet = this.ctx.createGain(); this.verb = this.ctx.createConvolver();
      this.music = this.ctx.createGain(); this.music.gain.value = MUSIC_LEVEL; this.music.connect(this.master);
      this.master.connect(this.dry); this.dry.connect(this.ctx.destination);
      this.master.connect(this.verb); this.verb.connect(this.wet); this.wet.connect(this.ctx.destination);
      const room = this._room; this._room = null; this.setRoom(room);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }
  setVolume(v){ this._vol = Math.max(0, Math.min(1, v)); if (this.master) this.master.gain.value = 0.9 * this._vol; }

  // the room everything is heard in (ROOMS); cheap to call every frame, it only rebuilds on a change
  setRoom(name){
    if (!ROOMS[name] || name === this._room) return;
    this._room = name;
    if (!this.ctx) return;
    const R = ROOMS[name], t = this.ctx.currentTime;
    this.verb.buffer = impulse(this.ctx, R);
    this.wet.gain.setTargetAtTime(R.wet, t, 0.3);
    this.dry.gain.setTargetAtTime(1 - R.wet * 0.45, t, 0.3);
  }

  // the instrument's samples, fetched and decoded the first time it's played
  async _load(name){
    this._bank ??= fetch(BANK + 'instruments.json').then(r => r.json());
    const I = (await this._bank)[name];
    if (!I) throw new Error(`no instrument ${name}`);
    await Promise.all(I.zones.map(async z => {
      if (this._buf.has(z.file)) return;
      const buf = await fetch(BANK + z.file).then(r => r.arrayBuffer());
      this._buf.set(z.file, await this.ctx.decodeAudioData(buf));
    }));
    return I;
  }

  // one note: the zone that covers it, pitched from the key it was recorded at
  _note(I, out, midi, t, dur, vel){
    const ctx = this.ctx, z = I.zones.find(q => q.lo <= midi && midi <= q.hi) || I.zones.at(-1);
    const src = ctx.createBufferSource();
    src.buffer = this._buf.get(z.file);
    if (I.perc){                                    // a drum: the sound as it is, rung out whole
      const g = ctx.createGain(); g.gain.value = vel;
      src.connect(g); g.connect(out); src.start(t); src.stop(t + src.buffer.duration);
      return src;
    }
    src.playbackRate.value = Math.pow(2, (midi - z.root + z.cents / 100) / 12);
    if (z.loop){ src.loop = true; src.loopStart = z.loop[0]; src.loopEnd = z.loop[1]; }
    const g = ctx.createGain(), end = t + dur;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + Math.max(0.005, I.attack));
    if (I.sustain) g.gain.setValueAtTime(vel, Math.max(t + I.attack, end - 0.02));
    else g.gain.setTargetAtTime(0, t + 0.01, 0.35 + dur * 0.4);     // a plucked string fades as it rings
    g.gain.setTargetAtTime(0, end, I.release / 3);
    src.connect(g); g.connect(out);
    src.start(t); src.stop(end + I.release * 2);
    return src;
  }

  // play notes ([{ t, dur, midi }], from tunes.js schedule) on an instrument. A little
  // unevenness in time and loudness, so it sounds played rather than printed.
  async play(name, { notes, length }, { gain = 1, pan = 0, voice = false, at = null } = {}){
    this.init();
    if (!this.ctx) return null;
    const synth = isSynthDrum(name), I = synth ? { release: 0.5 } : await this._load(name);
    const ctx = this.ctx, out = ctx.createGain(), panner = ctx.createStereoPanner();
    out.gain.value = gain; panner.pan.value = pan;
    out.connect(panner); panner.connect(voice ? this.master : this.music);
    const now = ctx.currentTime, t0 = at ?? now + LEAD, srcs = [];
    for (const n of notes){
      const jitter = (Math.random() - 0.5) * 0.012;
      if (t0 + n.t + jitter < now) continue;                  // (asked for late: what's past is past)
      if (synth){ strike(ctx, out, name, n.k, t0 + n.t + jitter, (n.vel ?? 1) * (0.92 + Math.random() * 0.16)); continue; }
      srcs.push(this._note(I, out, n.midi, t0 + n.t + jitter, n.dur * 0.94, (n.vel ?? 0.82) * (0.92 + Math.random() * 0.16)));
    }
    let finish, stopped = false;
    const done = new Promise(res => { finish = res; });
    const timer = setTimeout(() => finish(true), (length + t0 - now + I.release) * 1000);
    return {
      done,
      place(g, p){ out.gain.setTargetAtTime(g, ctx.currentTime, 0.1); panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, p)), ctx.currentTime, 0.1); },
      stop(){
        if (stopped) return; stopped = true; clearTimeout(timer);
        out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        setTimeout(() => { for (const s of srcs) try { s.stop(); } catch (_){} out.disconnect(); }, 400);
        finish(false);
      },
    };
  }
}

// A room's impulse response: stereo noise under an exponential decay, darkened by a one-pole
// low-pass (each side its own noise, so the tail is wide), with the echoes as short bursts
// of the same, later and quieter.
function impulse(ctx, R){
  const sr = ctx.sampleRate, len = Math.ceil(sr * R.decay), buf = ctx.createBuffer(2, len, sr);
  const a = 0.08 + 0.85 * R.tone;                  // the low-pass: how much of each new sample gets through
  for (let ch = 0; ch < 2; ch++){
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++){
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-6.9 * i / len);
    }
    for (const [at, g] of R.echoes){               // a wall far off: the sound again, a burst 25 ms long
      const i0 = Math.floor((at + (ch ? 0.013 : 0)) * sr), n = Math.floor(0.025 * sr);
      for (let i = 0; i < n && i0 + i < len; i++) d[i0 + i] += g * (Math.random() * 2 - 1) * Math.exp(-5 * i / n) * 2.5;
    }
  }
  return buf;
}
