// Ambient world sound, mostly synthesised with WebAudio. Three continuous
// "beds" (looping filtered noise whose gain + pan we steer each frame) for the
// fire, the sea, and the wind in the leaves; the leaves are a recording (LEAVES), once
// it has loaded, and the synthetic rustle until then or without it. Plus two event textures: fire
// crackles and the thunk of an axe felling a shrub. Everything is positional —
// gain falls off with distance and pans left/right relative to where you face —
// so the soundscape tells you what's around you and roughly where.
//
// Sibling to footsteps.js; deliberately its own AudioContext so neither depends
// on the other. Both are resumed on the same user gesture (pointer lock).

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
// the wind in the leaves: a spring noon in a deciduous wood, a blackbird now and then (JSE).
// About 24 dB under the synthetic bed it replaces, so its gain is scaled up by LEAVES_GAIN
// to sit where that did. Looped with its ends crossfaded over XFADE seconds, so no seam.
const LEAVES = 'sounds/AMBForst_Spring Noon Deciduous Forest Gentle Wind Leaves Rustling Blackbird Raven in Background_JSE_FA.m4a';
const LEAVES_GAIN = 16.6, XFADE = 3;
// water dripping underground (InMotionAudio, Cave Design): one drip, dry, for those close by;
// a few with the cave's echo after them, for those further off
const DRIPS = { near: 'sounds/WATRDrip_SingleDrip03_InMotionAudio_CaveDesign.m4a', far: 'sounds/WATRDrip_SingleDripDesign05_InMotionAudio_CaveDesign.m4a' };
const DRIP_EVERY = { cave: [2, 5], crypt: [6, 13] };   // seconds between drips: the caves are wetter

export class Ambience {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.beds = {};
    this._t = 0;          // running clock for the slow swell/gust LFOs
    this._vol = 1;        // SFX volume multiplier (0..1), from settings
  }

  // scale the whole ambience mix; 1 = the default level
  setVolume(v){
    this._vol = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = 0.5 * this._vol;
  }

  init(){
    if (!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5 * this._vol;
      this.master.connect(this.ctx.destination);
      // two seconds of looping noise, shared by every bed
      const n = Math.floor(this.ctx.sampleRate * 2);
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      // the three continuous beds (start silent; steered each frame)
      this.beds.fire = this._bed(480, 'lowpass', 1.0);
      this.beds.sea  = this._bed(760, 'lowpass', 0.8);
      this.beds.wind = this._bed(1900, 'bandpass', 0.9);
      this._recorded('wind', LEAVES);
      this.drips = {}; this._dripT = 1;
      for (const [k, url] of Object.entries(DRIPS)) fetch(encodeURI(url)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(b => this.ctx.decodeAudioData(b)).then(buf => { this.drips[k] = buf; }).catch(e => console.warn(`ambience: drip ${k} not loaded (${e.message})`));
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // a persistent looping-noise voice: source → filter → gain → panner → master
  _bed(cutoff, type, q){
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = cutoff; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(f); f.connect(g); g.connect(pan); pan.connect(this.master);
    src.start();
    return { src, f, g, pan };
  }

  // swap a bed for a looping recording once it has loaded (the synthetic one plays till then;
  // if it never loads, as in a build without the file, that one stays)
  _recorded(name, url){
    const ctx = this.ctx;
    fetch(encodeURI(url)).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b)).then(buf => {
        const src = ctx.createBufferSource(); src.buffer = seamless(ctx, buf, XFADE); src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        src.connect(g); g.connect(pan); pan.connect(this.master);
        src.start(0, Math.random() * src.buffer.duration);       // somewhere in the loop, not always its start
        const old = this.beds[name];
        old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); setTimeout(() => old.src.stop(), 2000);
        this.beds[name] = { src, g, pan, recorded: true };
      }).catch(e => console.warn(`ambience: ${name} recording not loaded (${e.message}); keeping the synthetic one`));
  }

  // glide a bed's gain/pan toward targets without clicks
  _steer(bed, gain, pan){
    const t = this.ctx.currentTime;
    bed.g.gain.setTargetAtTime(gain, t, 0.12);
    bed.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.12);
  }

  // a one-shot noise burst (crackle / chop thunk)
  _burst(cutoff, type, dur, gain, pan, rate = 1){
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = cutoff; f.Q.value = type === 'bandpass' ? 1.4 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // a recorded one-shot, at a gain and pan, its pitch nudged by `rate`
  _play(buf, gain, pan, rate){
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = gain;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
    src.connect(g); g.connect(p); p.connect(this.master);
    src.start();
  }

  // env: { here:{x,z,yaw}, fires:[{x,z,lit,fuel}], npcs:[{x,z,chopping}],
  //        wind: <0..~1.6>, sea: { prox:0..1, pan:-1..1 }, drips: null | 'cave' | 'crypt',
  //        under: true below ground, where the outdoor beds (the leaves) fall silent }
  update(dt, env){
    if (!this.ctx || this.ctx.state !== 'running' || dt <= 0 || !env) return;
    this._t += dt;
    const here = env.here || { x: 0, z: 0, yaw: 0 };
    // listener's right vector, for stereo placement
    const fwx = -Math.sin(here.yaw), fwz = -Math.cos(here.yaw);
    const rgx = -fwz, rgz = fwx;
    const panOf = (dx, dz, d) => clamp((dx * rgx + dz * rgz) / (d || 1) * 0.7, -1, 1);

    // --- fire: nearest lit hearth drives the bed; crackles spawn near it ---
    const FIRE_R = 15;
    let fProx = 0, fPan = 0;
    for (const f of env.fires || []){
      if (!f.lit) continue;
      const dx = f.x - here.x, dz = f.z - here.z, d = Math.hypot(dx, dz);
      if (d > FIRE_R) continue;
      const heat = clamp((f.fuel || 0) / 0.5, 0.2, 1);
      const p = clamp(1 - d / FIRE_R, 0, 1) * clamp(1 - d / FIRE_R, 0, 1) * heat;
      if (p > fProx){ fProx = p; fPan = panOf(dx, dz, d); }
    }
    this._steer(this.beds.fire, fProx * 0.5, fPan);
    if (fProx > 0.05 && Math.random() < fProx * dt * 14)         // pops & snaps
      this._burst(2600, 'bandpass', 0.05 + Math.random() * 0.06, fProx * 0.5, fPan, 1.2);

    // --- sea: a slow wash that swells in and out, loud only near a shore ---
    const swell = 0.55 + 0.45 * Math.sin(this._t * 0.5);
    const sea = env.sea || { prox: 0, pan: 0 };
    this._steer(this.beds.sea, clamp(sea.prox, 0, 1) * swell * 0.55, sea.pan);

    // --- wind in the leaves: a baseline rustle that gusts with the wind ---
    const wmag = clamp((env.wind || 0) / 1.6, 0, 1), wb = this.beds.wind, out = env.under ? 0 : 1;   // its baseline would play on underground
    if (wb.recorded){                                   // the recording gusts by itself: only a slow swell, and its own stereo
      const swell = 0.85 + 0.15 * Math.sin(this._t * 0.21 + 1.3);
      this._steer(wb, out * LEAVES_GAIN * (0.07 + wmag * 0.2) * swell, 0);
    } else {
      const gust = 0.6 + 0.4 * Math.sin(this._t * 0.33 + 1.3);
      this._steer(wb, out * (0.05 + wmag * 0.22) * gust, fwx * 0.2);
    }

    // --- underground: a drip somewhere in the dark now and then, 3–18u off; near ones dry,
    // far ones with their echo, quieter the further, panned to where they fall ---
    if (env.drips && (this._dripT -= dt) <= 0){
      const [lo, hi] = DRIP_EVERY[env.drips] || DRIP_EVERY.crypt;
      this._dripT = lo + Math.random() * (hi - lo);
      const d = 3 + Math.random() * 15, a = Math.random() * Math.PI * 2, dx = Math.cos(a) * d, dz = Math.sin(a) * d;
      const far = d > 9, buf = this.drips[far ? 'far' : 'near'];
      if (buf) this._play(buf, (far ? 0.9 : 1.5) * (1 - (d - 3) / 18), panOf(dx, dz, d), 0.8 + Math.random() * 0.45);
    }

    // --- chopping: each felling NPC swings on its own cadence ---
    const CHOP_R = 22;
    for (const n of env.npcs || []){
      if (!n.chopping){ n._chopT = 0; continue; }
      const dx = n.x - here.x, dz = n.z - here.z, d = Math.hypot(dx, dz);
      if (d > CHOP_R) continue;
      n._chopT = (n._chopT || Math.random() * 0.7) + dt;
      if (n._chopT < 0.62 + Math.random() * 0.12) continue;     // ~one swing per ¾ s
      n._chopT = 0;
      const fall = clamp(1 - d / CHOP_R, 0, 1);
      const g = 0.5 * fall * fall;
      if (g < 0.015) continue;
      const pan = panOf(dx, dz, d);
      this._burst(300, 'lowpass', 0.16, g, pan, 1);              // the dull thock of the blow
      this._burst(1400, 'bandpass', 0.05, g * 0.5, pan, 1);     // a little woody crack on top
    }
  }
}
// a buffer that loops without a seam: its last `xf` seconds faded (equal power) into its first
function seamless(ctx, buf, xf){
  const X = Math.min(Math.floor(xf * buf.sampleRate), buf.length >> 2), N = buf.length - X;
  const out = ctx.createBuffer(buf.numberOfChannels, N, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++){
    const a = buf.getChannelData(c), o = out.getChannelData(c);
    o.set(a.subarray(0, N));
    for (let i = 0; i < X; i++){ const t = i / X; o[i] = a[i] * Math.sqrt(t) + a[N + i] * Math.sqrt(1 - t); }
  }
  return out;
}
