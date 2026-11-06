// Shearing, the logic (docs/sheep.md). One sheep held, and which of its puffs have been cut. A drag across the wool cuts
// what the blades pass over, on the side you can see. Nothing here marks how well it's done (for now). No THREE and no
// page: js/shear-hands.js gives it a projection and the pointer, and tools/check-shear.mjs runs it in node.
import { UNITS_PER_M } from './config.js';
import { buildFleece, nearestSkin } from './fleece.js';

export const SHEAR = {
  BRUSH_M: 0.13,      // how wide the blades take, either side of the stroke, in a sheep's metres
  FINISH: 0.92,       // this much off and the rest comes away with it, so nobody hunts for the last puffs under the belly. (One spot reaches 88%: you go round)
  KEEP: 0.5,          // let go having cut this much, and it's still a fleece you've got
  MIN_LEN: 0.8,       // shorter than this, and there's not enough on it to bother
};

const PUFFS = buildFleece();
const SEEN_AT = 0.3;   // look at a puff's middle and four points this far out (of its size)
const BLOCK_AT = 0.32;                // how much of its size a puff in front blocks: under its drawn ball, as the balls have gaps

export class Shearing {
  // s: the sheep. y: the ground under it. cut: where the times of the cuts go (the view's mask, so it draws them);
  // nonzero means cut, at that time
  constructor(s, y = 0, cut = new Float32Array(PUFFS.length)){
    this.s = s; this.y = y; this.cut = cut; this.count = 0; this.done = false;
    cut.fill(0);
    this.scale = (s.scale ?? 1) * UNITS_PER_M;
    this.cos = Math.cos(s.heading ?? 0); this.sin = Math.sin(s.heading ?? 0);
  }
  get total(){ return PUFFS.length; }
  get share(){ return this.count / PUFFS.length; }
  // a point on the sheep, in its own metres, to the world: the shader's toWorld, standing still
  toWorld(p, out = {}){
    const k = this.scale;
    out.x = (this.s.x ?? 0) + (this.cos * p[0] + this.sin * p[2]) * k;
    out.y = this.y + p[1] * k;
    out.z = (this.s.z ?? 0) + (-this.sin * p[0] + this.cos * p[2]) * k;
    return out;
  }
  // Can you see this puff from there, past the body and past any wool still in front of it? If you can see it you can take it,
  // so wool on the far side comes within reach over the back and under the belly once the near side's off
  seen(i, cam){
    const k = this.scale, dx = (cam.x - (this.s.x ?? 0)) / k, dz = (cam.z - (this.s.z ?? 0)) / k;
    const c = [this.cos * dx - this.sin * dz, (cam.y - this.y) / k, this.sin * dx + this.cos * dz];   // the camera, in the sheep's own metres
    const q = PUFFS[i], p = q.p, rx = c[2] - p[2], rz = p[0] - c[0], rl = Math.hypot(rx, rz) || 1, r = q.size * SEEN_AT;
    const sx = rx / rl * r, sz = rz / rl * r;
    for (const t of [p, [p[0] + sx, p[1], p[2] + sz], [p[0] - sx, p[1], p[2] - sz], [p[0], p[1] + r, p[2]], [p[0], p[1] - r, p[2]]])
      if (this._clear(c, t, i)) return true;
    return false;
  }
  // does the line from c to p miss the body, and the wool still on? In the sheep's own metres
  _clear(c, p, self){
    const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2], L = Math.hypot(dx, dy, dz) || 1, ux = dx / L, uy = dy / L, uz = dz / L;
    // (only the last stretch can meet the body, a sheep being about a metre long; and it stops short, since a puff sits on the skin)
    for (let d = Math.max(0, L - 1.3); d < L - 0.07; d += 0.05)
      if (nearestSkin([c[0] + ux * d, c[1] + uy * d, c[2] + uz * d]).gap === 0) return false;
    for (let j = 0; j < PUFFS.length; j++){
      if (j === self || this.cut[j]) continue;
      const o = PUFFS[j], ox = o.p[0] - c[0], oy = o.p[1] - c[1], oz = o.p[2] - c[2], along = ox * ux + oy * uy + oz * uz;
      if (along > L - 0.03) continue;        // not in front of it
      const R = o.size * BLOCK_AT;
      if (ox * ox + oy * oy + oz * oz - along * along < R * R) return false;
    }
    return true;
  }
  // how wide the blades are on the screen: project(x, y, z) gives { x, y } in pixels
  brushPx(project){
    const c = this.toWorld([0, 0.55, 0], _a), a = project(c.x, c.y, c.z), b = project(c.x, c.y + SHEAR.BRUSH_M * this.scale, c.z);
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
  // what's under this point: is there wool here to take hold of?
  woolAt(x, y, { project, cam }){
    const r = this.brushPx(project);
    for (let i = 0; i < PUFFS.length; i++){
      if (this.cut[i]) continue;
      const w = this.toWorld(PUFFS[i].p, _w), q = project(w.x, w.y, w.z);
      if (Math.hypot(q.x - x, q.y - y) < r && this.seen(i, cam)) return true;
    }
    return false;
  }
  // a stroke from (ax, ay) to (bx, by), in pixels. Returns how many puffs came off
  stroke(ax, ay, bx, by, { project, cam, now }){
    if (this.done || (ax === bx && ay === by)) return 0;     // the blades have to move to cut
    const r = this.brushPx(project), ux = bx - ax, uy = by - ay, uu = ux * ux + uy * uy;
    const hit = [];      // judged all together, against the wool as it stood: a puff doesn't uncover the one behind it in the same move
    for (let i = 0; i < PUFFS.length; i++){
      if (this.cut[i]) continue;
      const w = this.toWorld(PUFFS[i].p, _w), q = project(w.x, w.y, w.z);
      const t = Math.max(0, Math.min(1, ((q.x - ax) * ux + (q.y - ay) * uy) / uu));
      if (Math.hypot(q.x - ax - ux * t, q.y - ay - uy * t) < r && this.seen(i, cam)) hit.push(i);
    }
    for (const i of hit) this.cut[i] = Math.max(now, 0.001);
    const got = hit.length; this.count += got;
    if (this.share >= SHEAR.FINISH) this.finish(now);
    return got;
  }
  // the last of it comes away, each puff a little after the one before, so it falls rather than vanishes
  finish(now){
    if (this.done) return;
    this.done = true;
    let k = 0;
    for (let i = 0; i < PUFFS.length; i++) if (!this.cut[i]){ this.cut[i] = Math.max(now, 0.001) + (k++ % 12) * 0.03; this.count++; }
  }
  // Let go of it. What's been cut has been cut: the sheep is that much shorter, and you've a fleece if there's enough of one.
  // The wool in the world is one number, so a half-shorn sheep comes out evenly short.
  release(){
    const share = this.share, s = this.s, dirt = s.dirt ?? 0;
    s.len = Math.max(0, (s.len ?? 1) * (1 - share));
    s.dirt = dirt * (1 - share);      // the dirt went with the wool: what grows in is clean
    return { share, dirt, fleece: share >= SHEAR.KEEP };
  }
}
const _w = {}, _a = {};

// is this sheep one you could shear?
export const shearable = s => (s.len ?? 1) >= SHEAR.MIN_LEN;
