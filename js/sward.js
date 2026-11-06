// How long the grass is, wherever something has eaten it (docs/sheep.md). Not trail wear, which makes bare earth and
// quicker going: grazed ground is a short pale lawn. Pure: no three.js, no terrain.
//
// Only what's been eaten is stored, in chunks. Regrowth isn't simulated: a cell keeps its height and the time it was
// last touched, and the current height is worked out on reading. So idle pasture costs nothing, the Lea's time skips
// just work, and a flock nobody can see can still eat. Cells sit on the ground's own 2u vertices (trails.js).
export const SWARD = {
  CELL: 2,
  FLOOR: 0.18,          // bitten as low as it goes: never bare, which is what paths are for
  REGROW: 1 / 3.5,      // of full height, per game day
  EAT: 0.2,            // of what's above the floor, per second, under one sheep's mouth
};
const CHUNK = 32;       // cells a side

export class Sward {
  constructor(){
    this.chunks = new Map(); this.list = [];
    this.now = 0;       // the world's clock, in days
    this._k = NaN; this._c = null; this._slice = 0;
  }
  _chunk(cx, cz, make){
    const k = (cx + 32768) * 65536 + (cz + 32768);
    if (k === this._k) return this._c;
    let c = this.chunks.get(k);
    if (!c){
      if (!make) return null;              // (a miss isn't cached: it's cheap, and the next read may be elsewhere)
      c = { cx, cz, h: new Float32Array(CHUNK * CHUNK).fill(1), t: new Float32Array(CHUNK * CHUNK).fill(this.now), shown: new Uint8Array(CHUNK * CHUNK).fill(255) };
      this.chunks.set(k, c); this.list.push(c);
    }
    this._k = k; this._c = c;
    return c;
  }
  // grass height at a point, 0..1 of full
  heightAt(x, z){
    if (!this.list.length) return 1;
    const gx = Math.round(x / SWARD.CELL), gz = Math.round(z / SWARD.CELL);
    const c = this._chunk(gx >> 5, gz >> 5, false);
    if (!c) return 1;
    const i = (gz & 31) * CHUNK + (gx & 31), v = c.h[i] + SWARD.REGROW * (this.now - c.t[i]);
    return v > 1 ? 1 : v;
  }
  _bite(gx, gz, k){
    const c = this._chunk(gx >> 5, gz >> 5, true), i = (gz & 31) * CHUNK + (gx & 31);
    let v = c.h[i] + SWARD.REGROW * (this.now - c.t[i]);
    if (v > 1) v = 1;
    if (v > SWARD.FLOOR) v -= (v - SWARD.FLOOR) * k;
    c.h[i] = v; c.t[i] = this.now;
  }
  // a mouthful here: most under the mouth, a little round it. Falls off as it shortens, as the bites do
  eat(x, z, dt, rate = SWARD.EAT){
    const gx = Math.round(x / SWARD.CELL), gz = Math.round(z / SWARD.CELL), k = Math.min(1, rate * dt);
    this._bite(gx, gz, k);
    this._bite(gx + 1, gz, k * 0.35); this._bite(gx - 1, gz, k * 0.35);
    this._bite(gx, gz + 1, k * 0.35); this._bite(gx, gz - 1, k * 0.35);
  }
  // a flock nobody's near: the same eating, spread over a disc
  eatDisc(x, z, r, dt, rate){
    const n = Math.ceil(r / SWARD.CELL), k = Math.min(1, rate * dt);
    for (let a = -n; a <= n; a += 1) for (let b = -n; b <= n; b += 1)
      if (a * a + b * b <= n * n) this._bite(Math.round(x / SWARD.CELL) + a, Math.round(z / SWARD.CELL) + b, k);
  }
  // how much a sheep wants this grass. They favour short leafy growth over long stemmy, and there's nothing in
  // a bare-bitten patch. The shape is mine; the research only gives the order of things.
  value(x, z){
    const h = this.heightAt(x, z);
    if (h < 0.3) return (h - SWARD.FLOOR) / (0.3 - SWARD.FLOOR) * 0.25;
    if (h < 0.6) return 0.25 + (h - 0.3) / 0.3 * 0.75;
    return 1 - (h - 0.6) / 0.4 * 0.3;
  }
  // the same, over a patch
  patchValue(x, z, r){
    return (this.value(x, z) + this.value(x + r, z) + this.value(x - r, z) + this.value(x, z + r) + this.value(x, z - r)) / 5;
  }
  // one chunk a frame near the viewer: tell the painter about cells that have visibly changed. paint(x, z, h)
  paintSlice(vx, vz, reach, paint){
    const n = this.list.length;
    if (!n) return;
    const c = this.list[this._slice = (this._slice + 1) % n], span = CHUNK * SWARD.CELL;
    const mx = (c.cx + 0.5) * span, mz = (c.cz + 0.5) * span;
    if (Math.abs(mx - vx) > reach + span || Math.abs(mz - vz) > reach + span) return;
    for (let i = 0; i < c.h.length; i++){
      let v = c.h[i] + SWARD.REGROW * (this.now - c.t[i]);
      if (v > 1) v = 1;
      const q = Math.round(v * 40);
      if (q === c.shown[i] || (c.shown[i] === 255 && q === 40)) continue;
      c.shown[i] = q;
      paint((c.cx * CHUNK + (i & 31)) * SWARD.CELL, (c.cz * CHUNK + (i >> 5)) * SWARD.CELL, v);
    }
  }
}
