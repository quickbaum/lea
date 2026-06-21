// Footstep sounds, synthesised with WebAudio — no assets to ship. Each footfall is
// built from one or two short filtered-noise "voices" shaped by a fast attack +
// exponential decay. The ground type changes the whole character of the step, not
// just its brightness:
//   grass — a bright swishy rustle with a light crunch
//   rock  — a hard, sharp tick: bright body + a high transient
//   sand  — a soft, dark, muffled fwoomph
//   mud   — a low damp body with a resonant wet squelch
//   water — a splashy body with a bright spattering tail
// The player's own steps and nearby NPCs' steps run on their own cadence; NPC steps
// are distance-attenuated and panned relative to the camera, and each NPC's footfall
// is sampled against the ground it's actually standing on.

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

export class Footsteps {
  constructor(){
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this._pphase = 0;          // player step-cadence accumulator
    this._left = false;        // alternate foot (tiny pan + pitch wobble)
    this._vol = 1;             // SFX volume multiplier (0..1), from settings
  }

  // scale the whole footstep mix; 1 = the default level
  setVolume(v){
    this._vol = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = 0.32 * this._vol;
  }

  // build the audio graph on first user gesture (an AudioContext can't start before
  // one). Safe to call repeatedly — it resumes a suspended context and no-ops after.
  init(){
    if (!this.ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32 * this._vol;   // subtle under the music
      this.master.connect(this.ctx.destination);
      // a half-second of white noise, reused for every step
      const n = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // one filtered-noise component of a footfall
  _voice(o){
    const ctx = this.ctx; if (!ctx) return;
    const t = o.t0 ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = (o.rate ?? 1) * (0.88 + Math.random() * 0.24);   // grit/grain variation
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.value = o.cut * (0.9 + Math.random() * 0.2);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const att = o.attack ?? 0.005, dur = o.dur ?? 0.13;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.gain, t + att);
    g.gain.exponentialRampToValueAtTime(0.0006, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o.pan ?? 0, -1, 1);
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // one footfall on a given ground type, composed from 1–2 voices.
  _step(terrain = 'grass', gain = 1, pan = 0, foot = false){
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    const lvl = gain * (foot ? 1.0 : 0.92);              // alternate-foot weight
    const rk = foot ? 1.05 : 0.96;                       // & a small pitch wobble between feet
    switch (terrain){
      case 'rock':                                       // hard, sharp tick
        this._voice({ type: 'highpass', cut: 1800, q: 0.6, dur: 0.07, gain: lvl * 0.85, pan, rate: 1.3 * rk, attack: 0.002, t0: t });
        this._voice({ type: 'bandpass', cut: 4200, q: 2.0, dur: 0.03, gain: lvl * 0.5,  pan, rate: 1.5 * rk, attack: 0.001, t0: t });
        break;
      case 'sand':                                       // soft, dark, muffled
        this._voice({ type: 'lowpass', cut: 520, q: 0.5, dur: 0.17, gain: lvl * 0.7, pan, rate: 0.8 * rk, attack: 0.012, t0: t });
        break;
      case 'mud':                                        // low damp body + wet squelch
        this._voice({ type: 'lowpass',  cut: 360, q: 0.8, dur: 0.17, gain: lvl * 0.8,  pan, rate: 0.7 * rk, attack: 0.012, t0: t });
        this._voice({ type: 'bandpass', cut: 520, q: 3.6, dur: 0.12, gain: lvl * 0.35, pan, rate: 0.7 * rk, attack: 0.02,  t0: t + 0.012 });
        break;
      case 'water':                                      // splash body + bright spatter tail
        this._voice({ type: 'lowpass',  cut: 900,  q: 0.4, dur: 0.10, gain: lvl * 0.8, pan, rate: 1.0 * rk, attack: 0.002, t0: t });
        this._voice({ type: 'highpass', cut: 3000, q: 0.5, dur: 0.20, gain: lvl * 0.5, pan, rate: 1.1 * rk, attack: 0.004, t0: t });
        break;
      default:                                           // grass: swishy rustle + light crunch
        this._voice({ type: 'bandpass', cut: 2000, q: 0.7, dur: 0.13, gain: lvl * 0.85, pan, rate: 1.2 * rk, attack: 0.006, t0: t });
        this._voice({ type: 'highpass', cut: 3500, q: 0.5, dur: 0.05, gain: lvl * 0.3,  pan, rate: 1.4 * rk, attack: 0.004, t0: t });
    }
  }

  // call each frame. `walk` = the player's own footing this frame; `npcs` are nearby
  // walkers; `here` is the camera/listener {x, z, yaw} for distance + stereo.
  update(dt, walk, npcs, here){
    if (!this.ctx || this.ctx.state !== 'running' || dt <= 0) return;

    // --- the player's own steps ---
    if (walk && walk.moving){
      this._pphase += dt;
      const interval = walk.running ? 0.30 : 0.45;          // quicker when sprinting
      if (this._pphase >= interval){
        this._pphase = 0; this._left = !this._left;
        this._step(walk.terrain, 0.5, this._left ? -0.1 : 0.1, this._left);
      }
    } else this._pphase = Math.min(this._pphase, 0.45);

    // --- nearby NPCs' steps (distance-attenuated, stereo-panned) ---
    if (!npcs || !here) return;
    const MAXD = 14, fwx = -Math.sin(here.yaw), fwz = -Math.cos(here.yaw);
    const rgx = -fwz, rgz = fwx;                            // listener's right vector
    for (const n of npcs){
      if (!n.moving){ n._stepT = 0; continue; }
      const ddx = n.x - here.x, ddz = n.z - here.z;
      const dist = Math.hypot(ddx, ddz);
      if (dist > MAXD) continue;
      n._stepT = (n._stepT || Math.random() * 0.5) + dt;
      if (n._stepT < 0.5) continue;                         // each NPC's own cadence
      n._stepT = 0;
      const fall = clamp(1 - dist / MAXD, 0, 1);
      const gain = 0.34 * fall * fall;                      // near-silent at the edge
      if (gain < 0.01) continue;
      const inv = dist || 1, pan = clamp((ddx * rgx + ddz * rgz) / inv * 0.7, -1, 1);
      const terr = here.terrainAt ? here.terrainAt(n.x, n.z) : (n.terrain || 'grass');
      this._step(terr, gain, pan, Math.random() < 0.5);
    }
  }
}
