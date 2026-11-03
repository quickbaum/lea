import { makeSkeleton } from './skeleton.js';

// The crypts' skeletons, in a level (docs/skeletons.md). gen/under.js guards() lays them out:
// each guard is a few skeletons whose bones lie strewn on the floor in front of something worth
// coming down for. They lie still while you walk among them. Take something (a find, a book
// read off a shelf, a chest opened, a locked door opened with its key: main.js calls
// disturb()) and every heap in the crypt grows restless: its bones rattle where they lie. Walk
// into a room where restless bones lie and they fly together and come after you, slowly: you
// can walk away from them. Nothing rises in the room you're standing in when you take
// something; those bones rise when you come back into it. Lose one (out of its sight a while,
// or the way to you long) and it falls to pieces where it stands, still restless, so the
// crypt's dangers move about.
// Two or more of them on you and they dance: a ring round you, in step, in the figures the
// folk dance round a fire (music-sim.js dancePose): round and round; back and forth every four
// bars; or round while closing in and opening out. The ring keeps to you at a shamble, so
// walking off breaks it, and whoever falls behind goes back to the chase.
// Struck by a ball of light (main.js, light-bolt.js: click one) a skeleton falls to bones on
// the spot, but not for long: it lies a few seconds, rattles, and gets up and comes on again.
// Catching you does nothing yet: grabbing and carrying you back to the stair is step 2.
//
//   const G = makeGuards(L, kit);          // once per level; kept on the level, so they stay where they fell
//   G.update(dt, { x, z, camera, scene })  // each frame you're in the level
//   G.disturb()                            // you took something: the crypt is restless
//   G.targets()                            // the ones on their feet, to aim at
//   G.strike(m)                            // a ball of light hit it
//   G.leave()                              // on the way out: whoever was after you gives up

const RESTIVE = 0.55;   // how hard restless bones rattle (skeleton.js stir)
const WARN = 0.9;       // s of hard rattling before they rise (and up to half as much more, so a group staggers)
const SPEED = 5;        // u/s, a shamble: you walk 8 and run 16 (main.js)
const CHASE_PACE = 0.75;   // the run animation's speed at that shamble
const REACH = 1.3;      // close enough to grab at you
const LOSE = 5;         // s out of sight before it gives up
const FAR = 30;         // it sees no further than this; and gives up when the way to you is twice as long
const DRAW = 45;        // beyond this a skeleton isn't drawn or moved
const RESTLESS = 3;     // s fallen before it can rise again
const STUN = 4;         // s a struck skeleton lies in bones before it rattles and rises again
// the ring
const RING = 3;         // the ring's radius (u): an arm's length and more, so you can see them dance
const JOIN = RING + 0.8;   // this near you, two or more of them dance
const LEAVE = 2;        // a dancer this far outside the ring (fallen behind you) goes back to the chase: about a second of walking off
const PACE = 0.55;      // the dance's speed: skeleton-pose.js dance hops 2.2 times a second at 1
const BEAT = 1 / (2.2 * PACE);   // s, a hop; everyone on the same beat
const BAR = 4 * BEAT, FIGURE = 8 * BAR;   // a figure lasts eight bars, then the next
const STEP = 0.8;       // u/s round the ring
const FIGURES = ['ring', 'turn', 'in-out'];

export function makeGuards(L, kit){
  const W = L.W, H = L.H, cell = L.cell;
  const cellOf = (x, z) => [Math.floor((x - L.x0) / cell), Math.floor((z - L.z0) / cell)];
  const idx = (x, z) => { const [i, j] = cellOf(x, z); return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i; };
  const shutCells = new Set(), shut = k => shutCells.has(k);   // the cells of shut doors, this frame
  const near = (x, z, r, seed) => {                     // a walkable spot within r of (x, z)
    let s = seed;
    for (let n = 0; n < 20; n++){
      s = Math.imul(s ^ (s >>> 13), 0x5bd1e995) >>> 0;
      const a = (s % 6283) / 1000, d = r * ((s >>> 16) % 1000) / 1000, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (L.walkable(px, pz)) return [px, pz];
    }
    return [x, z];
  };
  const scatter = r => ({ r, ok: (x, z) => L.walkable(x, z) });

  const all = [];
  for (const g of L.guards || []){
    const group = [];
    for (let k = 0; k < g.n; k++){
      const [x, z] = near(g.x, g.z, 1.4, g.seed + k * 977);
      const s = makeSkeleton(kit, { x, z, floorAt: L.floorAt, lit: true, seed: (g.seed + k) | 0, scatter: scatter(g.r) });
      const m = { s, g, group, mode: g.still ? 'still' : 'lying', unseen: 0, rest: 0 };   // still: old bones, upper floors; they never wake
      group.push(m); all.push(m);
    }
  }

  // which way to the player from every cell: a breadth-first walk out from the player's cell over
  // the open ones (a shut door is a wall), recomputed when the player moves to another cell
  const dist = new Int32Array(W * H).fill(-1), queue = new Int32Array(W * H);
  let from = -2, age = 0;
  function flow(px, pz){
    const k0 = idx(px, pz);
    if (k0 === from && age < 1) return;
    from = k0; age = 0; dist.fill(-1);
    if (k0 < 0) return;
    let head = 0, tail = 0; dist[k0] = 0; queue[tail++] = k0;
    while (head < tail){
      const k = queue[head++], i = k % W, j = (k / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const a = i + di, b = j + dj, q = b * W + a;
        if (a < 0 || b < 0 || a >= W || b >= H || dist[q] >= 0 || !L.open[q] || shut(q)) continue;
        dist[q] = dist[k] + 1; queue[tail++] = q;
      }
    }
  }
  // in sight: open ground all the way, no shut door, and on about the same floor
  function sees(x, z, px, pz){
    if (Math.abs(L.floorAt(x, z) - L.floorAt(px, pz)) > 2.5) return false;
    const d = Math.hypot(px - x, pz - z), n = Math.ceil(d / 0.5);
    for (let q = 1; q < n; q++){
      const sx = x + (px - x) * q / n, sz = z + (pz - z) * q / n;
      if (!L.openAt(sx, sz)) return false;
      const k = idx(sx, sz); if (shut(k)) return false;
    }
    return true;
  }
  // a step toward the player, sliding along walls
  function step(m, px, pz, dt, see){
    const s = m.s;
    let tx = px, tz = pz;
    if (!see){
      const k = idx(s.x, s.z); if (k < 0 || dist[k] < 0) return false;
      const i = k % W, j = (k / W) | 0;
      let best = dist[k], bi = -1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]){
        const q = (j + dj) * W + (i + di);
        if (i + di >= 0 && j + dj >= 0 && i + di < W && j + dj < H && dist[q] >= 0 && dist[q] < best){ best = dist[q]; bi = q; }
      }
      if (bi < 0) return false;
      tx = L.x0 + (bi % W + 0.5) * cell; tz = L.z0 + (((bi / W) | 0) + 0.5) * cell;
    }
    let dx = tx - s.x, dz = tz - s.z;
    for (const o of all) if (o !== m && o.mode === 'hunt'){          // not into each other
      const ox = s.x - o.s.x, oz = s.z - o.s.z, d = Math.hypot(ox, oz);
      if (d < 0.8 && d > 1e-4){ dx += ox / d * 1.5; dz += oz / d * 1.5; }
    }
    const l = Math.hypot(dx, dz); if (l < 1e-4) return false;
    const v = SPEED * dt, nx = s.x + dx / l * v, nz = s.z + dz / l * v;
    if (L.walkable(nx, nz)){ s.x = nx; s.z = nz; }
    else if (L.walkable(nx, s.z)) s.x = nx;
    else if (L.walkable(s.x, nz)) s.z = nz;
    else return false;
    return true;
  }
  // the room (gen/under.js region: a room, a vault, a stretch of passage, a stair) at (x, z)
  const roomAt = (x, z) => { const k = idx(x, z); return k < 0 ? -1 : L.reg[k]; };
  for (const m of all) m.room = roomAt(m.s.x, m.s.z);
  let restless = false, was = null;                     // the crypt disturbed; the room you were in last frame
  function fall(m, now = false){
    m.mode = restless ? 'restless' : 'lying'; m.rest = RESTLESS; m.unseen = 0; m.s.at = null;
    m.s.collapse({ scatter: scatter(1.2), now });
    m.room = roomAt(m.s.x, m.s.z);
  }

  // the ring: who's in it (each with a place, k of n), its clock, its figure and its way round
  const ring = { on: false, t: 0, fig: 0, dir: 1 };
  function placeIn(k, n, px, pz){
    const t = ring.t, fig = FIGURES[(ring.fig + Math.floor(t / FIGURE)) % FIGURES.length], tf = t % FIGURE, P = 4 * BAR;
    const round = fig === 'turn' ? (tf % (2 * P) < P ? tf % (2 * P) : 2 * P - tf % (2 * P)) : fig === 'in-out' ? t * 0.6 : t;
    const r = fig === 'in-out' ? RING + 0.5 - 1.2 * (0.5 - 0.5 * Math.cos(2 * Math.PI * tf / P)) : RING;   // in to 2.3u at the closest
    const a = k / n * Math.PI * 2 + ring.dir * round * STEP / RING;
    return [px + Math.cos(a) * r, pz + Math.sin(a) * r];
  }
  function toChase(m){ m.mode = 'hunt'; m.s.at = null; m.s.speed = CHASE_PACE; }
  function dancing(dt, px, pz){
    const near = all.filter(m => (m.mode === 'hunt' || m.mode === 'dance') && m.s.state === 'up'
      && Math.hypot(m.s.x - px, m.s.z - pz) < (m.mode === 'dance' ? LEAVE + RING : JOIN));
    const was = all.filter(m => m.mode === 'dance');
    if (near.length < 2){ for (const m of was) toChase(m); ring.on = false; return; }
    if (!ring.on){ ring.on = true; ring.t = 0; ring.fig = Math.floor(Math.random() * FIGURES.length); ring.dir = Math.random() < 0.5 ? -1 : 1; }
    ring.t += dt;
    for (const m of was) if (!near.includes(m)) toChase(m);
    // places in the ring, dealt only when someone joins or leaves (dealt every frame, two who
    // came from the same side swapped places each frame and met in the middle): by where each
    // one is round you then, so the places they go to are the nearest
    if (near.length === was.length && near.every(m => m.mode === 'dance')) return;
    const ang = m => Math.atan2(m.s.z - pz, m.s.x - px), [ax, az] = placeIn(0, 1, 0, 0), a0 = Math.atan2(az, ax);
    const off = m => ((ang(m) - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    near.sort((a, b) => off(a) - off(b));
    near.forEach((m, k) => { m.mode = 'dance'; m.k = k; m.n = near.length; });
  }

  let scene = null;
  return {
    all,
    targets: () => all.filter(m => m.mode === 'hunt' || m.mode === 'dance' || m.mode === 'rising'),
    strike(m){
      if (m.mode !== 'hunt' && m.mode !== 'dance' && m.mode !== 'rising') return;
      m.mode = 'struck'; m.stun = STUN * (0.85 + Math.random() * 0.3); m.unseen = 0; m.rest = 0; m.s.at = null;
      m.s.collapse({ scatter: scatter(1.4) });                // knocked apart, the bones flung a little way
    },
    disturb(){
      restless = true;
      for (const m of all) if (m.mode === 'lying') m.mode = 'restless';
    },
    update(dt, { x: px, z: pz, camera, scene: sc }){
      if (scene !== sc){ for (const m of all) sc.add(m.s.object); scene = sc; }
      age += dt;
      shutCells.clear(); for (const d of L.doors || []) if (!d.open) shutCells.add(idx(d.x, d.z));
      if (all.some(m => m.mode === 'hunt' || m.mode === 'dance')) flow(px, pz);
      dancing(dt, px, pz);
      // into a room where restless bones lie: they rise (not the room you were in: you came in)
      const here = roomAt(px, pz), came = was !== null && here !== was && here >= 0;
      was = here;
      if (came) for (const m of all) if (m.mode === 'restless' && m.room === here){ m.mode = 'rattling'; m.warn = WARN * (1 + Math.random() * 0.5); }
      for (const m of all){
        const s = m.s, d = Math.hypot(px - s.x, pz - s.z);
        s.object.visible = d < DRAW;
        if (d > DRAW && (m.mode === 'still' || m.mode === 'lying' || m.mode === 'restless')) continue;
        if (m.rest > 0) m.rest -= dt;
        const see = m.mode === 'hunt' && d < FAR && sees(s.x, s.z, px, pz);
        if (m.mode === 'struck'){
          if ((m.stun -= dt) <= 0 && s.state === 'pile'){ m.mode = 'rattling'; m.warn = WARN * 0.6; }
          else s.stir = m.stun < 1.2 && s.state === 'pile' ? 0.8 : 0;   // the last moment: they start to stir
        }
        else if (m.mode === 'restless') s.stir = m.rest <= 0 && s.state === 'pile' ? RESTIVE : 0;
        else if (m.mode === 'rattling'){
          s.stir = 1;
          if ((m.warn -= dt) <= 0 && m.rest <= 0 && s.state === 'pile'){ m.mode = 'rising'; s.stir = 0; s.assemble(); }
        } else if (m.mode === 'rising'){
          if (s.state === 'up'){ toChase(m); s.play('run'); }
        } else if (m.mode === 'dance'){
          // to its place in the ring, round you and out (never across the middle), at no more
          // than a shamble's pace; in step with the others
          const [tx, tz] = placeIn(m.k, m.n, px, pz), ta = Math.atan2(tz - pz, tx - px), tr = Math.hypot(tx - px, tz - pz);
          const ca = Math.atan2(s.z - pz, s.x - px), cr = Math.hypot(s.x - px, s.z - pz), v = SPEED * dt;
          const dr = Math.max(-v, Math.min(v, tr - cr)), turn = Math.atan2(Math.sin(ta - ca), Math.cos(ta - ca));
          const na = ca + Math.max(-v / Math.max(cr, 1), Math.min(v / Math.max(cr, 1), turn)), nr = cr + dr;
          const nx = px + Math.cos(na) * nr, nz = pz + Math.sin(na) * nr;
          if (L.walkable(nx, nz)){ s.x = nx; s.z = nz; } else if (L.walkable(nx, s.z)) s.x = nx; else if (L.walkable(s.x, nz)) s.z = nz;
          s.play('dance'); s.at = ring.t; s.speed = PACE;   // (falling behind you, it leaves the ring in dancing())
        } else if (m.mode === 'hunt'){
          m.unseen = see ? 0 : m.unseen + dt;
          const k = idx(s.x, s.z), way = see ? d : k >= 0 && dist[k] >= 0 ? dist[k] * cell : Infinity;
          if (m.unseen > LOSE || way > FAR * 2) fall(m);
          else if (d < REACH) s.play('reach');
          else { s.play(step(m, px, pz, dt, see && d < 12) ? 'run' : 'look'); }
        }
        s.update(dt, camera);
      }
    },
    // you've gone: whoever was up is lying where it stood when you come back
    leave(){
      for (const m of all) if (m.mode !== 'still' && m.mode !== 'lying' && m.mode !== 'restless'){ fall(m, true); m.s.stir = 0; m.s.at = null; }
      ring.on = false;
      for (const m of all) m.s.object.removeFromParent();
      scene = null; was = null;
    },
  };
}
