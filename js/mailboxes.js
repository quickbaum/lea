// mailboxes.js — the post as the folk work it, in the boxes where each lane meets the road. Pure: no
// world, no drawing. js/mail.js says who lives where and writes the letters; AgentWorld ticks it, and Brain
// walks whoever holds a job here, as a commitment (docs/letters.md, "The folk's post").
//
//   a resident posts    someone of the place, on a good day, walks to its box and leaves a letter
//   the carrier rides   one person walks the road, stop to stop, end to end: takes from each box what's
//                       bound for another box on the road, leaves what's for here. Off either end of the
//                       road lie foreign parts, and that's where foreign letters come from
//   a resident fetches  a letter for this place, left a while, gets fetched and walked to the door
//
// A letter for Faerie stays in its box: no one on the road can carry it, only you. Anyone may take any
// letter from a box before they do. A job that runs past its time lapses and hands its letters back.
//
//   makeMailboxes({ seed, realms, at, folkIn, send, doorOf, receive, carrier, stops, fromAfar })
//     realms[i], at[i]   box i's realm id and where it stands, { x, z }
//     folkIn(realm)      who may write or be written to there, today
//     send(from, to)     writes a letter and takes its stamps (to null: Faerie). Null if it can't be paid
//     doorOf(letter)     where to walk it to, { x, z }
//     receive(letter, by) it's arrived, carried by the person `by`
//     carrier()          who rides (asked until someone can)
//     stops              the road in order: { x, z, box: i } or { x, z, far: id }
//     fromAfar(far, to)  a letter in from foreign parts, to a person. Null if it can't be paid

export const BOX = { CAP: 4, DAILY: 0.55, FAE: 0.5, FETCH_WAIT: 0.6, BAG: 10, FROM_AFAR: 2, FAR_FIRST: 0.34 };
const ERRAND_DAYS = 1.2, WALK_DAY = 500;     // a job's time: this long, plus its length at this many u a day

// the same day and box always roll the same, and nothing else's rng stream shifts for it
const roller = (seed, key, day) => {
  let h = (seed ^ Math.imul(day + 1, 40503)) >>> 0;
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const one = (list, r) => list[(r() * list.length) | 0];

export function makeMailboxes({ seed = 1, realms = [], at = [], folkIn, send, doorOf = () => null, receive = () => {}, carrier = () => null, stops = [], fromAfar = null }){
  const boxes = realms.map((realm, i) => ({ realm, letters: [], day: null, at: at[i] || { x: 0, z: 0 }, since: new Map() }));
  const jobs = new Map();            // person → { kind, x, z, until, ... }: what Brain walks them to
  const stats = { asked: 0, posted: 0, moved: 0, fetched: 0, arrived: 0, fromAfar: 0, lapsed: 0, lapsedBy: {}, stops: 0 };
  const boxOf = realm => boxes.find(b => b.realm === realm) || null;
  const elsewhere = realm => realms.filter(q => q !== realm).flatMap(folkIn);
  const ride = { who: null, stop: 0, dir: 1, bag: [] };
  const stay = (n, dist) => ERRAND_DAYS + dist / WALK_DAY;
  const put = (box, l, now) => { box.letters.push(l); box.since.set(l, now); };
  const fars = stops.filter(q => q.far).map(q => q.far);

  // what a resident here would write, and to whom
  function letterOut(box, from, r){
    if (from.stargazer && r() < BOX.FAE) return send(from, null);          // those who read the stars know who to write to
    const away = elsewhere(box.realm);
    if (away.length) return send(from, one(away, r));
    const near = folkIn(box.realm).filter(n => n !== from && (!n.home || n.home !== from.home));   // nowhere else to write to: next door, then
    return near.length ? send(from, one(near, r)) : null;
  }
  // what's already in a box when the world begins: as if it had been going on for years
  function firstLetter(box, r){
    const here = folkIn(box.realm), away = elsewhere(box.realm);
    if (!here.length) return null;
    const out = () => letterOut(box, one(here, r), r);
    const inn = () => {
      if (fromAfar && fars.length && r() < BOX.FAR_FIRST){ const l = fromAfar(one(fars, r), one(here, r)); if (l){ stats.fromAfar++; return l; } }
      return away.length ? send(one(away, r), one(here, r)) : null;
    };
    const [a, b] = r() < 0.5 ? [out, inn] : [inn, out];
    return a() || b();
  }
  const isInbound = (box, l) => !!l.to && l.to.realm === box.realm;
  const toAnotherBox = (box, l) => !!l.to && l.to.realm !== box.realm && !!boxOf(l.to.realm);

  function daily(box, day, now, daytime){
    const first = box.day === null;
    if (box.day === day || (!daytime && !first)) return;     // (what's already in a box needs no one out walking)
    const here = folkIn(box.realm);
    if (!here.length) return;      // (the folk are placed after the first frames: a box's first day is when it has people)
    box.day = day;
    const r = roller(seed, box.realm, day);
    if (first){ const l = firstLetter(box, r); if (l) put(box, l, now - BOX.FETCH_WAIT / 2); return; }
    if (box.letters.length >= BOX.CAP || r() >= BOX.DAILY) return;
    const free = here.filter(n => !jobs.has(n));
    if (!free.length) return;
    const n = one(free, r);
    stats.asked++;
    jobs.set(n, { kind: 'post', box, x: box.at.x, z: box.at.z, until: now + stay(n, Math.hypot(box.at.x - n.x, box.at.z - n.z)) });
  }
  function fetchers(box, now, daytime){
    if (!daytime || [...jobs.values()].some(j => j.kind === 'fetch' && j.box === box)) return;
    const waiting = box.letters.filter(l => isInbound(box, l) && now - box.since.get(l) >= BOX.FETCH_WAIT);
    if (!waiting.length) return;
    const free = folkIn(box.realm).filter(n => !jobs.has(n));
    if (!free.length) return;
    const n = one(free, roller(seed, box.realm + 'fetch', Math.floor(now * 8)));
    jobs.set(n, { kind: 'fetch', box, x: box.at.x, z: box.at.z, until: now + stay(n, Math.hypot(box.at.x - n.x, box.at.z - n.z)) });
  }
  function nextRide(now, daytime){
    if (!stops.length || !daytime) return;
    if (!ride.who){ ride.who = carrier(); if (!ride.who) return; ride.who.postRider = true; }
    if (jobs.has(ride.who)) return;
    if (stops.length > 1){
      if (ride.stop + ride.dir < 0 || ride.stop + ride.dir >= stops.length) ride.dir = -ride.dir;
      ride.stop += ride.dir;
    }
    const q = stops[ride.stop], w = ride.who;
    jobs.set(w, { kind: 'ride', stop: q, x: q.x, z: q.z, until: now + stay(w, Math.hypot(q.x - w.x, q.z - w.z)) * 1.5 });
  }
  let nextLook = -1;
  function tick(now, daytime = true){
    if (now < nextLook) return;
    nextLook = now + 0.01;
    for (const [n, j] of jobs) if (now > j.until){
      jobs.delete(n); stats.lapsed++; stats.lapsedBy[j.kind] = (stats.lapsedBy[j.kind] || 0) + 1;
      for (const l of j.kind === 'door' ? [j.letter, ...j.held] : []){ const b = boxOf(l.to.realm); if (b) put(b, l, now); }     // back in the box for someone else
      if (n === ride.who) ride.stop -= stops.length > 1 ? ride.dir : 0;                                // try that stop again
    }
    const day = Math.floor(now);
    for (const box of boxes){ daily(box, day, now, daytime); fetchers(box, now, daytime); }
    nextRide(now, daytime);
  }
  // the person's got there
  function done(n, job, now){
    if (jobs.get(n) !== job) return;
    jobs.delete(n);
    if (job.kind === 'post'){
      const r = roller(seed, `${job.box.realm}post`, Math.floor(now * 8));
      const l = job.box.letters.length < BOX.CAP ? letterOut(job.box, n, r) : null;
      if (l){ put(job.box, l, now); stats.posted++; }
    } else if (job.kind === 'fetch'){
      const mine = job.box.letters.filter(l => isInbound(job.box, l)).slice(0, 2);
      for (const l of mine) take(job.box, l);
      stats.fetched += mine.length;
      walkTo(n, mine, now);
    } else if (job.kind === 'door'){
      receive(job.letter, n); stats.arrived++;
      walkTo(n, job.held, now);
    } else if (job.kind === 'ride'){
      stats.stops++;
      const q = job.stop, box = q.box != null ? boxes[q.box] : null;
      if (box){
        for (const l of [...ride.bag]) if (isInbound(box, l) && box.letters.length < BOX.CAP){ ride.bag.splice(ride.bag.indexOf(l), 1); put(box, l, now); stats.moved++; }
        for (const l of [...box.letters]) if (toAnotherBox(box, l) && ride.bag.length < BOX.BAG){ take(box, l); ride.bag.push(l); }
      } else if (q.far && fromAfar){
        const all = realms.flatMap(folkIn), r = roller(seed, q.far, Math.floor(now * 8));
        for (let i = 0; i < BOX.FROM_AFAR && all.length && ride.bag.length < BOX.BAG; i++){
          const l = fromAfar(q.far, one(all, r));
          if (l){ ride.bag.push(l); stats.fromAfar++; }
        }
      }
    }
  }
  // on to the first of these letters' doors; the rest wait in the hand
  function walkTo(n, letters, now){
    if (!letters.length) return;
    const [letter, ...held] = letters, door = doorOf(letter);
    if (!door){ receive(letter, n); stats.arrived++; return walkTo(n, held, now); }
    jobs.set(n, { kind: 'door', letter, held, x: door.x, z: door.z, until: now + stay(n, Math.hypot(door.x - n.x, door.z - n.z)) });
  }
  function take(box, letter){
    const i = box.letters.indexOf(letter);
    if (i >= 0){ box.letters.splice(i, 1); box.since.delete(letter); }
    return i >= 0;
  }
  // an occupation (plans.js): what Brain.choose walks them to
  const work = (a, job, now, dt, brain) => { brain.target = null; done(a, job, now); };
  return { name: 'post', bias: 2.0, work, boxes, jobs, tick, done, take, stats, ride };
}
