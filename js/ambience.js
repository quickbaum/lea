// Ambient world sound, synthesised with WebAudio — no assets. Three continuous
// "beds" (looping filtered noise whose gain + pan we steer each frame) for the
// fire, the sea, and the wind in the leaves; plus two event textures: fire
// crackles and the thunk of an axe felling a shrub. Everything is positional —
// gain falls off with distance and pans left/right relative to where you face —
// so the soundscape tells you what's around you and roughly where.
//
// Sibling to footsteps.js; deliberately its own AudioContext so neither depends
// on the other. Both are resumed on the same user gesture (pointer lock).

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

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

  // env: { here:{x,z,yaw}, fires:[{x,z,lit,fuel}], npcs:[{x,z,chopping}],
  //        wind: <0..~1.6>, sea: { prox:0..1, pan:-1..1 } }
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
    const gust = 0.6 + 0.4 * Math.sin(this._t * 0.33 + 1.3);
    const wmag = clamp((env.wind || 0) / 1.6, 0, 1);
    this._steer(this.beds.wind, (0.05 + wmag * 0.22) * gust, fwx * 0.2);

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
