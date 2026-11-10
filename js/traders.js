// traders.js — people who work the Old Road for a profit. Pure: no world, no drawing. AgentWorld ticks it
// and Brain walks whoever holds a job here, as a commitment (as js/mailboxes.js does for the post). Design,
// measurements and sources: docs/economy.md.
//
// A trader lives on the gaps between places. What a thing is worth differs from door to door (a house with
// 14 turnips will let one go for nothing, a house with none won't: trade.js worth), and a trader is whoever
// walks from the one to the other. There's no price list and no coin. A trader values goods by what they
// expect to get for them elsewhere (`resale`), remembered from what they saw at each door (`book`), and the
// same haggle the folk use (trade.js strike) finds the swap both sides gain from. Their profit is what those
// swaps add up to, in the Lea's own units of worth: a money of account nobody ever holds.
//
//   the book    what a thing fetched at each place when they last looked; old news fades toward a guess
//   resale      what one more of a kind should fetch somewhere else, less the walk and the spoiling
//   the round   door to door at a place, then the road, then the next place: wherever the stock should fetch
//               most for the days it takes to get there. Off each end lie foreign parts
//   foreign parts  where the road's goods come from. Each sells its own and pays well for the other's, so the
//               road itself is a gradient, and it pays for what the Lea has that they haven't
//
//   makeTraders({ seed, places, fars, road, pick, base, callDoor, accost, keepOf })
//     places[i]   { id, name, x, z, s, gate: { x, z }, houses: () => [house] }; s is where its lane meets the road
//     fars[i]     { id, name, x, z, s, sells: { kind: price }, buys: { kind: price } }
//     road        { xs, zs, step }: the road's centre line (gen/road.js)
//     pick(n)     the people who'll trade, asked until there are some
//     base(kind)  a thing's worth anywhere, before anyone's wants (trade.js)
//     callDoor(n, house)  they've reached a door: try to haggle there (Brain.callAt)
//     accost(n)   walking along, look for someone worth stopping for; true if a talk began
//     keepOf(kind)  days it keeps (ingredients.js)
//     provision(n)  food for the road, when they set out
//     feed(n, kind, k)  they've eaten into their stock: put k of it in their pack (true if it's food)
//     song(n, on, secs, roll)  a moment on the road: `on` if they're free to play as they walk (music-sim.js roadTune)
//     tuneUp(n, roll)  they've taken up the road: their instrument and the tunes they carry
//     setOff(n, stop)  they've made up their mind where next, and are leaving: they say so
//
// A lone musician works the same round for their supper (docs/economy.md "Lone musicians"): no goods, no foreign parts.
// Their stops are the villages, chosen by how long since each had music; at each they play a set by the well (`busk`),
// and whoever liked it gives them something to eat, till they've their supper. They're in `list` with kind 'music'.
//     pickMusic()   the folk who'll take up the road with an instrument
//     thirst(id, now)  how much a place wants music, 0..3: days since it had any
//     busk(n, t, c, secs)  a moment of their set at the well

export const TRADE = { DAY_SECS: 600, CAP: 24, HOP: 200, MARGIN: 0.8, DOORS: 4, WALK_DAY: 700, STAY: 0.5, BOOK_FADE: 12, SEED_STOCK: 14, RATIONS: 6, RATION_COST: 0.4, KEEP_BACK: 3, MEAL_GAP: 0.5, MEET_R: 7, MEET_DAYS: 1.5, CRY_DAYS: 0.22, CRY_MIN: 0.07, CRY_BEAT: 0.03, CRY_R: 70, CRY_DOORS: 2, BUSK_DAYS: 0.25, SUPPER: 6, FAR_CRAFT: 2.4, GLUT: 12, GLUT_CRAFT: 5, GLUT_DAYS: 15 };
// what a foreign part pays: its list, and a good price for any village's handiwork, less the more of it has come
// lately. It wears off with time, so somewhere that's had plenty pays well again in a while.
const isCraftKind = kind => kind.startsWith('craft-');
const paysAt = (f, kind) => (f.buys[kind] ?? (isCraftKind(kind) ? TRADE.FAR_CRAFT : 0)) / (1 + (f.glut?.[kind] || 0) / (isCraftKind(kind) ? TRADE.GLUT_CRAFT : TRADE.GLUT));
function settleGlut(f, now){
  const g = f.glut ??= {}, t = f.glutT ?? now;
  for (const k in g) g[k] *= Math.pow(0.5, (now - t) / TRADE.GLUT_DAYS);
  f.glutT = now;
}

// the same day and trader always roll the same, and nothing else's rng stream shifts for it
const roller = (seed, key) => {
  let h = seed >>> 0;
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};

// A road's two ends, as far as anyone can walk: where foreign parts begin.
export function roadEnds(road, walkable, radius){
  const n = road.xs.length, end = (from, d) => {
    for (let k = from; k >= 0 && k < n; k += d) if (Math.hypot(road.xs[k], road.zs[k]) < radius - 15 && walkable(road.xs[k], road.zs[k])) return { x: road.xs[k], z: road.zs[k], s: k * road.step };
    return { x: road.xs[from], z: road.zs[from], s: from * road.step };
  };
  return [end(0, 1), end(n - 1, -1)];
}
// What each of the two foreign parts makes, and what it'll pay. One sells salt and wire, the other iron and
// seasoned board; each pays over the odds for what the other sells, which is what keeps someone walking
// the whole road. Both pay well for what only the Lea has: its amber and pretty things, its hides, its nuts.
export function farGoods(i){
  const sells = i === 0 ? { salt: 0.5, wire: 1.0 } : { iron: 1.4, board: 0.8 };
  const other = i === 0 ? { iron: 2.2, board: 1.3 } : { salt: 1.0, wire: 1.7 };
  return { sells, buys: { ...other, trinket: 2.6, hide: 1.6, gut: 1.0, hazelnuts: 1.1, morels: 1.2, onions: 0.8, beans: 0.75, parsnips: 0.5, turnips: 0.45, peas: 0.55, leeks: 0.5, cabbages: 0.45, 'cave salt': 1.2 } };
}

export function makeTraders({ seed = 1, places = [], fars = [], road, pick = () => [], base = () => 0.6, callDoor = () => {}, accost = () => false, keepOf = () => 3, feed = null, provision = null, cry = null, song = null, tuneUp = null, setOff = null, pickMusic = () => [], thirst = () => 3, busk = null }){
  const stops = [...places.map(p => ({ ...p, far: false, p })), ...fars.map(f => ({ ...f, far: true, f }))];
  const byId = new Map(stops.map(q => [q.id, q]));
  const jobs = new Map();            // person → { kind: 'walk' | 'door', x, z, until, ... }: what Brain walks them to
  const list = [];                   // the traders
  const stats = { deals: 0, stops: 0, farTrips: 0, lapsed: 0, spoiled: 0, eaten: 0, sold: {}, bought: {}, door: {}, hops: { done: 0, days: 0, dist: 0 }, lapsedDoing: {}, lapses: [], farIncome: { crafts: 0, other: 0 }, cry: { stops: 0, beats: 0, heard: 0, came: 0, dealt: 0 }, busk: { stops: 0, tunes: 0, came: 0, fed: 0, food: 0 } };
  let visits = 0;   // door: how calls at doors ended, and why
  const heldBy = new Map();          // person → trader

  // --- the book ---------------------------------------------------------------------------------
  // what they'd expect a kind to fetch at a stop: seen there and fading toward a guess, or a guess
  function fetches(t, stop, kind, now){
    if (stop.far) return paysAt(stop.f, kind);
    const seen = t.book.get(stop.id)?.[kind], guess = base(kind) * 0.6;
    if (!seen) return guess;
    const fade = Math.min(1, (now - seen.t) / TRADE.BOOK_FADE);
    return seen.v + (guess - seen.v) * fade;
  }
  const walkDays = (a, b) => Math.abs(a - b) / TRADE.WALK_DAY;
  const posS = t => t.at ? byId.get(t.at).s : t.s;
  // what one more of a kind should fetch somewhere other than here, less what it loses on the way
  function resale(t, kind, now, here = t.at){
    let best = 0;
    const from = posS(t);
    for (const q of stops){
      if (q.id === here) continue;
      const days = walkDays(from, q.s), keep = keepOf(kind);
      const v = fetches(t, q, kind, now) * Math.max(0.1, 1 - days / keep) * Math.pow(0.97, days);
      if (v > best) best = v;
    }
    return best * TRADE.MARGIN;
  }
  // short of food for the road, a trader pays a fair price for any, whatever it'd resell for
  const edible = t => Object.keys(t.stock).reduce((a, k) => a + (feed && feed(t.who, k, 0) ? t.stock[k] : 0), 0);
  function wanted(t, kind, now){
    const v = resale(t, kind, now), n = t.who;
    return feed && feed(n, kind, 0) && edible(t) < TRADE.KEEP_BACK ? Math.max(v, base(kind) * 0.5) : v;
  }
  // write down what a kind is worth to someone here
  function observe(t, kind, v, now, at = t.at){
    if (!at || byId.get(at)?.far) return;
    let b = t.book.get(at);
    if (!b) t.book.set(at, b = {});
    const was = b[kind];
    b[kind] = { v: was && now - was.t < 0.5 ? (was.v + v) / 2 : v, t: now };   // doors seen the same visit average out
  }
  // what the stock's worth, if sold where it should fetch most: how they know how they're doing
  function reckon(t, now){
    let sum = 0;
    for (const k in t.stock) sum += t.stock[k] * resale(t, k, now, null);
    return sum;
  }

  // --- the round ---------------------------------------------------------------------------------
  // where next: what the stock should fetch at each stop, for the days it takes. Somewhere not seen in a
  // while is worth a look, and an empty pack wants foreign parts. Another trader bound there spoils it.
  function nextStop(t, now){
    const r = roller(seed, `${t.id}:${Math.floor(now * 4)}`), from = posS(t);
    const held = Object.values(t.stock).reduce((a, b) => a + b, 0), room = TRADE.CAP - held;
    let best = null, bv = -Infinity;
    if (t.kind === 'music'){
      // the village that's gone longest without a tune, for the walk; one another musician's bound for is spoilt
      for (const q of stops){
        if (q.far || (q.id === t.at && thirst(q.id, now) < 0.5)) continue;   // (the same place again, if it's had none for half a day)
        const others = list.some(o => o !== t && o.kind === 'music' && o.bound === q.id) ? 0.35 : 1;
        const v = (0.3 + thirst(q.id, now)) * others / (walkDays(from, q.s) + TRADE.STAY) * (0.9 + r() * 0.2);
        if (v > bv){ bv = v; best = q; }
      }
      return best;
    }
    for (const q of stops){
      if (q.id === t.at) continue;
      let sale = 0;
      for (const k in t.stock) sale += Math.min(t.stock[k], 6) * fetches(t, q, k, now);
      const since = t.seen.get(q.id);
      const look = q.far ? room * 0.6 : since == null ? 3 : Math.min(3, (now - since) * 1.2);
      const others = list.some(o => o !== t && o.kind !== 'music' && o.bound === q.id) ? 0.35 : 1;
      const days = walkDays(from, q.s) + TRADE.STAY;
      const v = (sale + look) * others / days * (0.9 + r() * 0.2);
      if (v > bv){ bv = v; best = q; }
    }
    return best;
  }
  // down the lane to the road, along it, up the next lane: waypoints a walker can take one at a time, so a
  // trader's seen on the road rather than cutting across country
  function routeTo(t, q){
    const pts = [], here = t.at ? byId.get(t.at) : null;
    if (here?.gate) pts.push(...(here.lane || []), here.gate);   // down a long lane a hop at a time (traderSites)
    const a = posS(t), b = q.s, dir = b > a ? 1 : -1;
    for (let s = a + dir * TRADE.HOP; (b - s) * dir > TRADE.HOP * 0.5; s += dir * TRADE.HOP){
      const k = Math.max(0, Math.min(road.xs.length - 1, Math.round(s / road.step)));
      pts.push({ x: road.xs[k], z: road.zs[k], s });
    }
    if (q.gate) pts.push(q.gate, ...(q.lane || []).slice().reverse());
    pts.push({ x: q.x, z: q.z, arrive: q.id });
    return pts;
  }
  const put = (t, kind, n) => { t.stock[kind] = (t.stock[kind] || 0) + n; };
  const room = t => TRADE.CAP - Object.values(t.stock).reduce((a, b) => a + b, 0);

  // Foreign parts: everything that'll sell goes, at their prices, and what they make is bought with it.
  // The one place a trader does sums aloud: this is the carters' reckoning at the road's end.
  function atFar(t, f, now){
    stats.farTrips++;
    settleGlut(f, now);
    let credit = t.credit;
    // one at a time, each fetching a bit less, while it beats what it should fetch elsewhere
    for (const k of Object.keys(t.stock)){
      while (t.stock[k] > 0){
        const p = paysAt(f, k);
        if (!p || (p < resale(t, k, now, f.id) && !feed?.(t.who, k, 0))) break;
        credit += p; t.stock[k]--; f.glut[k] = (f.glut[k] || 0) + 1;
        stats.sold[k] = (stats.sold[k] || 0) + 1;
        const b = isCraftKind(k) ? 'crafts' : 'other'; stats.farIncome[b] += p;
      }
      if (!t.stock[k]) delete t.stock[k];
    }
    // food for the road first, or nobody gets to the next place to sell anything
    while (edible(t) < TRADE.RATIONS && credit >= TRADE.RATION_COST){ put(t, 'beans', 1); credit -= TRADE.RATION_COST; stats.rations = (stats.rations || 0) + 1; }
    // a load of what they make, till the money or the room runs out: even at first, then more of what's been selling
    const kinds = Object.entries(f.sells), load = {};
    while (room(t) > 0){
      let k = null, bv = -1;
      for (const [q, p] of kinds){ if (credit < p) continue; const v = (1 + (t.moved[q] || 0)) / (1 + (load[q] || 0)); if (v > bv){ bv = v; k = q; } }
      if (!k) break;
      put(t, k, 1); credit -= f.sells[k]; load[k] = (load[k] || 0) + 1; stats.bought[k] = (stats.bought[k] || 0) + 1;
    }
    for (const k in t.moved) t.moved[k] /= 2;       // what sold lately counts for more than what sold long ago
    t.credit = credit;
  }
  function arrive(t, q, now){
    t.at = q.id; t.bound = null; t.s = q.s; t.seen.set(q.id, now); stats.stops++;
    t.gainAt = t.gain;
    if (q.far){ const was = wealth(t, now); atFar(t, q.f, now); t.led.far += wealth(t, now) - was; return; }
    if (t.kind === 'music'){       // a set by the well, for whoever comes
      t.doors = [];
      t.crying = { spot: { x: q.x, z: q.z }, visit: ++visits, start: now, until: now + TRADE.BUSK_DAYS, beat: now, busk: true, coming: 0, q };
      stats.busk.stops++;
      return;
    }
    // They stand at the well and cry their wares, and whoever's short of something comes over (Brain, agents.js traderCry)
    t.doors = [];
    t.crying = { spot: { x: q.x, z: q.z }, visit: ++visits, start: now, until: now + TRADE.CRY_DAYS, beat: now, deals0: t.deals, coming: 0, q };
    stats.cry.stops++;
  }
  // nobody came to the well: try the nearest few doors before moving on
  function doorsOf(t, q){
    const hs = q.p.houses().slice().sort((a, b) => Math.hypot(a.mouth.x - t.who.x, a.mouth.z - t.who.z) - Math.hypot(b.mouth.x - t.who.x, b.mouth.z - t.who.z));
    return hs.slice(0, TRADE.CRY_DOORS);
  }

  // --- spoilage and supper ------------------------------------------------------------------------
  function spoil(t, now){
    const days = now - t.lastDay; if (days < 0.25) return;
    t.lastDay = now;
    const r = roller(seed, `${t.id}:rot:${Math.floor(now * 4)}`);
    for (const k of Object.keys(t.stock)){
      const keep = keepOf(k);
      if (keep >= 100) continue;
      for (let i = t.stock[k]; i > 0; i--) if (r() < days / keep){ t.led.spoiled += resale(t, k, now, null); t.stock[k]--; stats.spoiled++; }
      if (t.stock[k] <= 0) delete t.stock[k];
    }
  }

  let nextLook = -1, lastLook = 0;
  function tick(now, daytime = true){
    if (now < nextLook) return;
    nextLook = now + 0.005;
    const gap = now - lastLook;
    for (const [n, j] of jobs){
      if (!daytime){ j.until += now - lastLook; j.night = (j.night || 0) + now - lastLook; continue; }      // a night by the fire doesn't count against the walk
      if (now <= j.until) continue;
      jobs.delete(n); stats.lapsed++;
      // why: what they were at when the time ran out, and how much of the way they'd made
      const doing = n.convo ? 'talk' : n.actionLabel || 'idle';
      stats.lapsedDoing[doing] = (stats.lapsedDoing[doing] || 0) + 1;
      if (stats.lapses.length < 40) stats.lapses.push({ who: n.name, job: j.kind, doing, target: n.brain?.target?.kind || null, day: +now.toFixed(2), of: +(j.d ?? 0).toFixed(0), left: +Math.hypot(j.x - n.x, j.z - n.z).toFixed(0), food: +(n.needs?.food ?? 0).toFixed(2), x: Math.round(n.x), z: Math.round(n.z), toX: Math.round(j.x), toZ: Math.round(j.z), path: n.brain?.path?.length ?? null, ferry: !!n.brain?._ferry, indoors: !!n._indoors, sleeping: !!n.sleeping, sitting: !!n.sitting });
      // that stretch again, unless it's beaten them twice: then on to the next
      if (j.pt && (j.tries || 0) < 1){ const t = heldBy.get(n); t.route.unshift(j.pt); t.retry = 1; }
      else if (j.pt?.arrive){ const t = heldBy.get(n); arrive(t, byId.get(j.pt.arrive), now); }
    }
    lastLook = now;
    if (!list.length){
      pick().forEach((who, i) => {
        const t = { id: i, kind: 'trade', who, stock: {}, credit: 0, gain: 0, gainAt: 0, book: new Map(), seen: new Map(), at: null, s: 0, bound: null,
          route: [], doors: [], lastDay: now, wealth0: 0, deals: 0, moved: {}, crying: null, led: { far: 0, eaten: 0, spoiled: 0 } };
        // they start at whichever end of the road they came in by, with a first load
        const f = fars[i % Math.max(1, fars.length)];
        if (f){ t.at = f.id; t.s = f.s; t.credit = TRADE.SEED_STOCK; atFar(t, f, now); stats.farTrips--; t.seen.set(f.id, now); who.x = f.x + i * 1.5; who.z = f.z + i; who.path = null; }
        else if (stops[0]){ t.at = stops[0].id; t.s = stops[0].s; }
        t.wake = now + i * 0.35;      // they don't set out together
        t.wealth0 = reckon(t, now) + t.credit;
        who.trader = t; heldBy.set(who, t); list.push(t);
        provision?.(who);
        tuneUp?.(who, roller(seed, `${i}:tunes`));
        t.songRoll = roller(seed, `${i}:song`);
      });
      // the musicians: no stock; from wherever they are, they make for a village first, and play there
      const villages = stops.filter(q => !q.far), k0 = list.length;
      pickMusic().forEach((who, j) => {
        const i = k0 + j, q = villages[(j * 2 + 1) % Math.max(1, villages.length)];
        const t = { id: i, kind: 'music', who, stock: {}, credit: 0, gain: 0, gainAt: 0, book: new Map(), seen: new Map(), at: null, s: q?.s ?? 0, bound: q?.id ?? null,
          route: q ? [{ x: q.x, z: q.z, arrive: q.id }] : [], doors: [], lastDay: now, wealth0: 0, deals: 0, moved: {}, crying: null, led: { far: 0, eaten: 0, spoiled: 0 } };
        t.wake = now + 0.1 + j * 0.35;
        who.trader = t; heldBy.set(who, t); list.push(t);
        provision?.(who);
        tuneUp?.(who, roller(seed, `${i}:tunes`));
        t.songRoll = roller(seed, `${i}:song`);
      });
      return;
    }
    for (const t of list){
      const n = t.who;
      spoil(t, now);
      if (now < t.wake) continue;
      // a tune as they go, when there's nobody to talk to and they've the breath for it
      if (song && !t.crying?.busk) song(n, daytime && jobs.get(n)?.kind === 'walk' && n.brain?.target?.kind === 'trade' && !n.convo && !n.talking && !n._indoors && !n.sleeping && !(n.needs?.food > 0.8), gap * TRADE.DAY_SECS, t.songRoll);
      // A trader eats out of the stock, the cheapest first, a proper meal twice a day, and that comes out of the
      // profit. A meal holds them till the next: they buy their dinners, they don't stop to look for them. Out
      // of food they walk on hungry to the next door, and pay what they must (`wanted`).
      if (feed){
        const fedTill = (t.ate ?? -1) + TRADE.MEAL_GAP;
        if (now < fedTill) n.needs.food = Math.min(n.needs.food, 0.45);
        else if (n.needs?.food > 0.5){
          const k = Object.keys(t.stock).filter(k => t.stock[k] > 0 && feed(n, k, 0)).sort((a, b) => base(a) - base(b))[0];
          if (k){ feed(n, k, 1); t.ate = now; t.led.eaten += resale(t, k, now, null); t.stock[k]--; if (!t.stock[k]) delete t.stock[k]; stats.eaten++; }
        }
      }
      if (n.brain?._market) continue;      // gone to find whoever's out at work (Brain.callAt)
      if (t.crying){
        const c = t.crying, job = jobs.get(n);
        if (!daytime){ c.until += gap; c.start += gap; c.beat += gap; if (job?.kind === 'cry') jobs.delete(n); continue; }   // to the fire; back in the morning
        if (c.busk){
          if (now > c.until){ if (job?.kind === 'cry') jobs.delete(n); t.crying = null; continue; }
          if (!job && !n.convo) jobs.set(n, { kind: 'cry', x: c.spot.x, z: c.spot.z, until: Infinity });
          busk?.(n, t, c, !n.convo && !n.talking && Math.hypot(n.x - c.spot.x, n.z - c.spot.z) < 8 ? gap * TRADE.DAY_SECS : 0);
          continue;
        }
        if (now > c.until || (now > c.start + TRADE.CRY_MIN && !c.coming && !n.convo)){
          if (job?.kind === 'cry') jobs.delete(n);
          if (t.deals === c.deals0) t.doors = doorsOf(t, c.q);
          t.crying = null;
          continue;
        }
        if (!job && !n.convo) jobs.set(n, { kind: 'cry', x: c.spot.x, z: c.spot.z, until: Infinity });
        if (!n.convo && now >= c.beat && Math.hypot(n.x - c.spot.x, n.z - c.spot.z) < 8){ c.beat = now + TRADE.CRY_BEAT; stats.cry.beats++; c.coming = cry ? cry(n, t, c) : 0; }
        continue;
      }
      if (n.convo || n.talking || n._indoors || jobs.has(n)) { if (daytime && t.kind !== 'music' && !n.convo && jobs.has(n) && jobs.get(n).kind === 'walk') accost(n); continue; }
      if (!daytime) continue;
      if (t.kind !== 'music' && accost(n)) continue;
      if (t.doors.length){
        const h = t.doors.shift();
        jobs.set(n, { kind: 'door', house: h, x: h.mouth.x, z: h.mouth.z, until: now + 0.25, d: Math.hypot(h.mouth.x - n.x, h.mouth.z - n.z) });
      } else if (t.route.length){
        const q = t.route.shift();
        jobs.set(n, { kind: 'walk', pt: q, x: q.x, z: q.z, until: now + 0.8, tries: t.retry || 0, t0: now, d: Math.hypot(q.x - n.x, q.z - n.z) }); t.retry = 0;
      } else {
        const q = nextStop(t, now);
        if (!q) continue;
        t.bound = q.id; t.route = routeTo(t, q);
        setOff?.(n, q);
      }
    }
  }
  // the person's got there
  function done(n, job, now){
    if (jobs.get(n) !== job) return;
    jobs.delete(n);
    const t = heldBy.get(n);
    if (job.kind === 'door') callDoor(n, job.house);
    else {
      stats.hops.done++; stats.hops.days += now - job.t0 - (job.night || 0); stats.hops.dist += job.d;
      if (job.pt.arrive) arrive(t, byId.get(job.pt.arrive), now);
      else if (job.pt.s != null) t.s = job.pt.s;
    }
  }
  function wealth(t, now){ return reckon(t, now) + t.credit; }
  // the gap they'd tell you of: the kind with the widest spread between two places they've seen, and where
  function tip(t, now){
    let best = null;
    const seen = stops.filter(q => !q.far && t.book.has(q.id));
    for (const a of seen) for (const b of seen){
      if (a === b) continue;
      const A = t.book.get(a.id), B = t.book.get(b.id);
      for (const k in A) if (B[k]){ const gap = B[k].v - A[k].v; if (!best || gap > best.gap) best = { kind: k, gap, cheap: a, dear: b }; }
    }
    return best && best.gap > 0.2 ? best : null;
  }
  // an occupation (plans.js): stronger than a market trip, since the round is their living
  const tol = job => job.kind === 'walk' ? 6 : job.kind === 'cry' ? 3 : 1.8;
  const work = (a, job, now, dt, brain) => { if (job.kind === 'cry'){ a.actionLabel = heldBy.get(a)?.kind === 'music' ? 'busk' : 'cry'; return; } brain.target = null; done(a, job, now); };
  return { name: 'trade', bias: 4.0, tol, work, list, jobs, tick, done, stats, resale, wanted, edible, observe, put, room, wealth, tip, of: n => heldBy.get(n) || null, stops };
}

// A lane's way points from the place out toward the road, a hop apart, stopping half a hop short of the end (the
// gate's there). Some lanes run 700u; one leg that long is past what A* finds from the village end, and a trader
// stood at the well for days (bublog lea-round-fixes). No `s` on them: they're not on the road.
export function lanePoints(lane){
  const pts = [], n = lane.xs.length;
  let acc = 0, next = TRADE.HOP;
  for (let k = 1; k < n; k++){
    acc += Math.hypot(lane.xs[k] - lane.xs[k - 1], lane.zs[k] - lane.zs[k - 1]);
    if (acc >= next && lane.length - acc > TRADE.HOP * 0.5){ pts.push({ x: lane.xs[k], z: lane.zs[k] }); next = acc + TRADE.HOP; }
  }
  return pts;
}
// Where the traders stop, from the world's own plan: each settlement, by the place its lane meets the road, and
// each end of the road. (Used by the game and by the harness, so both have the same round.)
export function traderSites({ S, road, walkable, radius, houses, placeNames = [], farNames = [] }){
  const places = S.places.map((p, i) => {
    const j = (S.junctions || []).find(q => q.place === p);
    return { id: `s${i}`, name: placeNames[i]?.name || `place ${i}`, x: p.well?.x ?? p.x, z: p.well?.z ?? p.z, s: j?.s ?? road.nearest(p.x, p.z).s, gate: j ? { x: j.x, z: j.z } : null,
      lane: j ? lanePoints(j.lane) : [], houses: () => houses().filter(h => p.buildings.includes(h.b)) };
  }).filter(p => p.houses().length);
  const fars = roadEnds(road, walkable, radius).map((e, i) => ({ id: `far${i}`, name: farNames[i] || `far ${i}`, ...e, ...farGoods(i) }));
  return { places, fars };
}
// how many walk the road: fixed for now, by what a road seems to support (docs/economy.md: one gained on every
// seed at 3200, three as a group broke even and cut the folk's own trading). Later: up to the market.
export const traderCount = size => size >= 3200 ? 2 : 1;
