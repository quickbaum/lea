// Background music using HoMM2 terrain tracks as placeholders.
// Two Audio elements crossfade when the track key changes.
// Pauses automatically when the browser tab is hidden.
// Terrain transitions are debounced: the player must dwell on new terrain
// for DWELL_S seconds before the track switches, preventing rapid flicking
// at biome borders.

const TRACKS = {
  menu:  '01 - Main Menu.flac',
  grass: '18 - Grass Theme.flac',
  mud:   '17 - Dirt Theme.flac',
  sand:  '13 - Desert Theme.flac',
  water: '16 - Ocean Theme.flac',
  rock:  '12 - Wasteland Theme.flac',
};

const SOUNDS   = '/sounds/';
const VOL      = 0.5;
const FADE_MS  = 4000;  // crossfade duration
const DWELL_S  = 3;     // seconds on new terrain before committing

export class MusicPlayer {
  constructor() {
    this._els     = [this._mk(), this._mk()];
    this._cur     = 0;
    this._key     = null;     // currently playing key
    this._pending = null;     // terrain candidate (may not be committed yet)
    this._dwellT  = 0;        // seconds spent continuously on _pending
    this._ready   = false;
    this._gain    = VOL;      // playing volume (0..1), adjustable from settings

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._els.forEach(a => a.pause());
      } else if (this._ready) {
        this._els[this._cur].play().catch(() => {});
      }
    });
  }

  _mk() {
    const a = new Audio();
    a.loop = true;
    a.volume = 0;
    return a;
  }

  _fade(el, target) {
    clearInterval(el._fid);
    const from  = el.volume;
    const steps = Math.round(FADE_MS / 50);
    const delta = (target - from) / steps;
    let v = from;
    el._fid = setInterval(() => {
      v = Math.max(0, Math.min(1, v + delta));
      el.volume = v;
      const done = delta < 0 ? v <= target : v >= target;
      if (done) {
        el.volume = target;
        clearInterval(el._fid);
        if (target === 0) { el.pause(); el.currentTime = 0; }
      }
    }, 50);
  }

  _switch(key) {
    const file = TRACKS[key] ?? TRACKS.grass;
    const next = 1 - this._cur;
    const na   = this._els[next];
    const ca   = this._els[this._cur];

    this._fade(ca, 0);

    na.src = SOUNDS + encodeURIComponent(file);
    na.volume = 0;
    na.play().catch(() => {});
    this._fade(na, this._gain);

    this._key = key;
    this._cur = next;
  }

  // Call once on first user gesture to unlock browser autoplay.
  init() { this._ready = true; }

  // Set playing volume (0..1). Fades the live track to the new level.
  setVolume(v) {
    this._gain = Math.max(0, Math.min(1, v));
    if (this._key) this._fade(this._els[this._cur], this._gain);
  }

  // Immediate switch — use for deliberate mode changes (menu ↔ game).
  play(key) {
    if (!this._ready) return;
    this._pending = key;
    this._dwellT  = 0;
    if (key !== this._key) this._switch(key);
  }

  // Call every frame with the current terrain key and dt (seconds).
  // Switches only after the player has stayed on the new terrain for DWELL_S.
  update(key, dt) {
    if (!this._ready) return;
    if (key !== this._pending) {
      this._pending = key;
      this._dwellT  = 0;
    }
    if (key !== this._key) {
      this._dwellT += dt;
      if (this._dwellT >= DWELL_S) this._switch(key);
    }
  }
}
