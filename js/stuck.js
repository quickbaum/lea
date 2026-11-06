// Stuck, measured (docs/npc-behavior.md, "Stuck"). For anyone who walks, folk or sheep: over the last WINDOW seconds of trying to
// get somewhere, did they get anywhere? Two kinds:
//   thrash  walked a good way and ended up about where they started: pushed back and forth among roots, round a corner and back
//   wedged  trying to go, and hardly moving at all
// Measuring only, for now: nothing here changes how anyone walks. Pure: the game (main.js, ?stucklog) and the flock run on the Mac
// (tools/flock-core.mjs) feed it, so both count the same thing.

export const STUCK = {
  WINDOW: 12,       // s of trying, looked at as a whole
  EVERY: 0.5,       // s between samples
  THRASH_L: 3,      // walked at least this far in the window...
  THRASH_K: 0.25,   // ...and got less than this share of it from where they began
  WEDGED_L: 0.6,    // trying the whole window and walked less than this
  COOL: 30,         // s before the same walker counts again: one bad patch is one event, not twenty
  KEEP: 400,        // events kept
};

export class StuckWatch {
  constructor(){ this.w = new Map(); this.events = []; this.t = 0; this.acc = 0; this.watched = 0; this.trying = {}; }

  // Once a frame, or a sim step. each(visit) calls visit(key, x, z, trying, aim, info) for every walker. aim: where they're making
  // for, as a word, so an event can say whether they changed their mind in the window (a thrash, or only a change of plan?).
  // info() is only called if something's found, and says what they were doing and what's about them
  tick(dt, each){
    this.t += dt;
    if ((this.acc += dt) < STUCK.EVERY) return;
    this.acc = 0;
    const N = Math.round(STUCK.WINDOW / STUCK.EVERY), seen = new Set();
    each((key, x, z, trying, aim, info) => {
      if (typeof aim === 'function'){ info = aim; aim = null; }
      seen.add(key);
      let r = this.w.get(key);
      if (!r){ r = { xs: [], zs: [], aims: [], tries: 0, quietUntil: 0 }; this.w.set(key, r); }
      r.xs.push(x); r.zs.push(z); r.aims.push(aim);
      r.tries = trying ? r.tries + 1 : 0;              // trying, without a break: a stop to graze or talk starts it again
      if (trying){ const k = key.slice(0, key.indexOf(':')); this.trying[k] = (this.trying[k] || 0) + STUCK.EVERY; }   // (for a rate: per hour of trying)
      if (r.xs.length > N + 1){ r.xs.shift(); r.zs.shift(); r.aims.shift(); }
      if (r.tries < N || r.xs.length < N + 1 || this.t < r.quietUntil) return;
      let L = 0;
      for (let i = 1; i < r.xs.length; i++) L += Math.hypot(r.xs[i] - r.xs[i - 1], r.zs[i] - r.zs[i - 1]);
      const D = Math.hypot(x - r.xs[0], z - r.zs[0]);
      const kind = L >= STUCK.THRASH_L && D < STUCK.THRASH_K * L ? 'thrash' : L < STUCK.WEDGED_L ? 'wedged' : null;
      if (!kind) return;
      r.quietUntil = this.t + STUCK.COOL;
      const seenAims = [...new Set(r.aims.filter(a => a != null))];
      this.events.push({ t: +this.t.toFixed(1), key, kind, x: +x.toFixed(1), z: +z.toFixed(1), walked: +L.toFixed(1), got: +D.toFixed(1), aims: seenAims.length, aimList: seenAims.slice(0, 4), ...(info ? info() : {}) });
      if (this.events.length > STUCK.KEEP) this.events.shift();
    });
    this.watched = Math.max(this.watched, seen.size);
    for (const k of this.w.keys()) if (!seen.has(k)) this.w.delete(k);    // gone out of the count, or asleep
  }

  // what's been found, in short: how many, of which kind, doing what, where
  summary(){
    const by = f => { const o = {}; for (const e of this.events){ const k = f(e); o[k] = (o[k] || 0) + 1; } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])); };
    // places: events within 20u of each other are one place
    const places = [];
    for (const e of this.events){
      const p = places.find(q => Math.hypot(q.x - e.x, q.z - e.z) < 20);
      if (p){ p.n++; p.who.add(e.key); } else places.push({ x: e.x, z: e.z, n: 1, who: new Set([e.key]), ground: e.ground, near: e.near });
    }
    places.sort((a, b) => b.n - a.n);
    const rate = Object.fromEntries(Object.entries(this.trying).map(([k, s]) => [k, { hoursTrying: +(s / 3600).toFixed(1), perHour: +(this.events.filter(e => e.key.startsWith(k + ':')).length / Math.max(1e-6, s / 3600)).toFixed(1) }]));
    const oneAim = this.events.filter(e => e.aims <= 1).length;
    return { seconds: Math.round(this.t), watched: this.watched, events: this.events.length, oneAim, rate, kinds: by(e => `${e.who}: ${e.kind}`), doing: by(e => `${e.who}: ${e.doing}`),
      ground: by(e => e.ground || '?'), places: places.slice(0, 12).map(p => ({ at: `${Math.round(p.x)},${Math.round(p.z)}`, n: p.n, walkers: p.who.size, ground: p.ground, near: p.near })) };
  }
}

// Everyone who walks in an AgentWorld, as the game and walk.html both watch them: folk (key p:) and awake sheep (s:). Folk are trying
// while they're further off than the Brain's own tolerance (plus 1u), and aren't sitting, sleeping, talking, indoors or boating; sheep while walking,
// running, led or off on their own. ground(x, z): what the land is there (terrain.js habitat)
export function watchWorld(watch, dt, agents, ground = () => null){
  const within = (x, z, r) => agents.obstaclesWithin(x, z, r);
  watch.tick(dt, visit => {
    for (const n of agents.npcs){
      // not there yet, as the Brain judges it: its own tolerance (agents.js, 1.5 unless the target says), and a little over, since
      // a seat or a doorway is judged from somewhere else
      const t = n.brain?.target, going = t && Number.isFinite(t.x) && Math.hypot(t.x - n.x, t.z - n.z) > (t.tol || 1.5) + 1;
      const trying = !!going && !n.sitting && !n.sleeping && !n.talking && !n._indoors && !n.boating;
      visit(`p:${n.id ?? n.name}`, n.x, n.z, trying, going ? `${t.kind}@${Math.round(t.x)},${Math.round(t.z)}` : null, () => ({ who: n.shepherding ? 'shepherd' : n.trader ? 'trader' : 'person', name: n.name, doing: n.actionLabel || t?.kind || '?',
        ground: ground(n.x, n.z), near: nearOf(within, n.x, n.z), to: `${Math.round(t.x)},${Math.round(t.z)} (${Math.round(Math.hypot(t.x - n.x, t.z - n.z))} off)` }));
    }
    for (const f of agents.flocks || []){
      if (!f.awake) continue;
      f.sheep.forEach((s, i) => visit(`s:${f.name}#${i}`, s.x, s.z, !s.held && (s.mode === 'walk' || s.mode === 'run' || !!s.led || !!s.off), s.mode,
        () => ({ who: 'sheep', flock: f.name, doing: `${s.mode}${s.led ? ' led' : ''}${s.off ? ' off' : ''}${s.lost ? ' lost' : ''}`,
          ground: f.fold && f._inFold(s.x, s.z) ? 'in the fold' : ground(s.x, s.z), near: nearOf(within, s.x, s.z) })));
    }
  });
}

// what's about a point, for an event: the nearest few trunks, with their root spread, and how far
export function nearOf(within, x, z){
  return within(x, z, 6).filter(o => o.alive !== false).map(o => ({ d: +(Math.hypot(o.x - x, o.z - z)).toFixed(1), r: +o.r.toFixed(1), roots: o.roots ? +o.roots.toFixed(1) : undefined }))
    .sort((a, b) => a.d - b.d).slice(0, 3);
}
