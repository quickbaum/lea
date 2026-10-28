// How a local tells you the way: not just "north of here" but the one thing
// worth knowing about the walk — take the road, there's a path, it's a long
// way round, it's boggy. Pure (the land only, no three.js), so node can check
// it; the words themselves live with the rest of the talk in main.js.
//
// Everything said is read off the route the speaker would actually walk (the
// nav's path, the same one they'd take), so a detail is true of the way, not
// of the straight line.

import { habitat, height, road, roadBand } from './gen/land.js';

const WET = new Set(['marsh', 'fen', 'carr']);
const WOOD = new Set(['woodland', 'grove', 'carr']);

// Walk the route (a list of [x, z], from the speaker) every 2u and tally it.
// wearAt(x, z) is the trail field's wear, if there is one.
export function walkOf(pts, wearAt = null){
  const w = { len: 0, straight: 0, road: 0, path: 0, wet: 0, wood: 0, rock: 0, rise: 0 };
  if (!pts || pts.length < 2) return w;
  const [x0, z0] = pts[0], [x1, z1] = pts[pts.length - 1];
  w.straight = Math.hypot(x1 - x0, z1 - z0);
  w.rise = height(x1, z1) - height(x0, z0);
  for (let k = 0; k + 1 < pts.length; k++){
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 2));
    for (let s = 0; s < n; s++){
      const x = ax + (bx - ax) * (s + 0.5) / n, z = az + (bz - az) * (s + 0.5) / n, d = L / n, h = habitat(x, z);
      w.len += d;
      if (roadBand(x, z) === 2) w.road += d;
      else if (wearAt && wearAt(x, z) > 0.3) w.path += d;
      if (WET.has(h)) w.wet += d;
      if (WOOD.has(h)) w.wood += d;
      if (h === 'rock') w.rock += d;
    }
  }
  return w;
}

// The one thing about the walk a local would mention, most useful first, or
// null when it's an ordinary stroll. Short walks get nothing: you can see there.
export function wayNote(w){
  if (w.len < 30) return null;
  const f = k => w[k] / w.len;
  if (w.road >= 30 && f('road') >= 0.4) return 'road';
  if (w.straight > 30 && w.len > w.straight * 1.35) return 'round';
  if (f('wet') >= 0.3) return 'bog';
  if (w.path >= 20 && f('path') >= 0.5) return 'path';
  if (w.rise > 6) return 'up';
  if (w.rise < -6) return 'down';
  if (f('rock') >= 0.3) return 'rock';
  if (f('wood') >= 0.75) return 'wood';            // the least telling, so the bar is high
  return null;
}

// The old road as a landmark from (x, z): how far off it is, which way, and
// which two ways it runs from its nearest point (compass bearings in degrees,
// north = -z, east = +x), or null if it's beyond `reach`.
export function roadFrom(x, z, reach = 200){
  const R = road(), { d, s } = R.nearest(x, z);
  if (d > reach) return null;
  const k = Math.max(1, Math.min(R.xs.length - 2, Math.round(s / R.step)));
  const tx = R.xs[k + 1] - R.xs[k - 1], tz = R.zs[k + 1] - R.zs[k - 1];
  const px = R.xs[k], pz = R.zs[k];
  const bearing = (dx, dz) => (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return { d, on: roadBand(x, z) === 2, toward: bearing(px - x, pz - z), runs: [bearing(tx, tz), bearing(-tx, -tz)] };
}
