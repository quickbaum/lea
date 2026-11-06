// Keeping a body out of tree trunks and shrubs, cheaply. Each body holds a short list of the obstacles round it and
// fetches a new one only after moving REFRESH, so most frames cost a handful of distance checks rather than a
// grid lookup. Used by the sheep (js/sheep.js) and Puck (js/puck.js). The folk and the player use agents.pushOut.

const REACH = 4, ROOT_REACH = 7, REFRESH = 1.5;     // fetched out to REACH, so anything within REACH - REFRESH of the body is always known

export class Dodge {
  // within(x, z, r): obstacles { x, z, r, roots?, alive? } near a point (agents.obstaclesWithin). radius: the body's.
  // roots: keep off the spread of the roots as well as the trunk, as something low on the ground has to
  constructor(within, radius, { roots = false } = {}){ this.within = within; this.radius = radius; this.roots = roots; this.reach = roots ? ROOT_REACH : REACH; }
  _r(o){ return this.roots && o.roots > o.r ? o.roots : o.r; }

  nearby(b){
    if (!b._obs || Math.hypot(b.x - b._ox, b.z - b._oz) > REFRESH){
      b._obs = this.within(b.x, b.z, this.reach); b._ox = b.x; b._oz = b.z;
    }
    return b._obs;
  }
  // would a body at (x, z) overlap anything? (x, z) must be within a step of b
  hit(b, x, z){
    for (const o of this.nearby(b)){
      if (o.alive === false) continue;     // a chopped shrub is gone
      const dx = x - o.x, dz = z - o.z, r = this._r(o) + this.radius;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }
  // move b out to the edge of anything it's inside, so it slides round a trunk rather than sticking. In place
  push(b){
    let moved = false;
    for (let it = 0; it < 2; it++){
      let again = false;
      for (const o of this.nearby(b)){
        if (o.alive === false) continue;
        const dx = b.x - o.x, dz = b.z - o.z, r = this._r(o) + this.radius, d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 0.001, k = r / d;
        b.x = o.x + (d2 ? dx : r) * (d2 ? k : 1); b.z = o.z + dz * k;
        again = moved = true;
      }
      if (!again) break;
    }
    return moved;
  }
  // which way to lean to pass what's coming up: [x, z] added to a heading, so it curves round before it touches.
  // Writes into out, to spare an array each frame
  steer(b, dirX, dirZ, look, out){
    out[0] = 0; out[1] = 0;
    const l = Math.hypot(dirX, dirZ);
    if (!l) return out;
    const fx = dirX / l, fz = dirZ / l;
    for (const o of this.nearby(b)){
      if (o.alive === false) continue;
      const dx = o.x - b.x, dz = o.z - b.z, ahead = dx * fx + dz * fz;
      const R = this._r(o);
      if (ahead <= 0 || ahead > look + R) continue;
      const side = dx * fz - dz * fx, clear = R + this.radius + 0.25;     // how far off the line it lies
      if (Math.abs(side) >= clear) continue;
      const k = (clear - Math.abs(side)) / clear * (1 - ahead / (look + R)) * 2.2, s = side >= 0 ? -1 : 1;
      out[0] += fz * s * k; out[1] += -fx * s * k;
    }
    return out;
  }
}
