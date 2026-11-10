// The shepherd's day (docs/sheep.md): one person from a village, held to a round by plans.js dayRound. They open the fold at
// dawn, take the flock to ground they've chosen, sit where they can see it, move it to fresher ground in the afternoon, bring
// it in and shut the gate at dusk, and sleep in the hut. Real need still breaks it, and it comes back after. The flock carries
// on by itself if they're not there: js/sheep.js falls back on the hour.
//
// They keep an eye out: for one that's gone off, for one short at the count, for someone running the flock about. And they've a
// pipe: the flock has a tune it knows as its call, which is how they're moved and brought in, and a lost sheep that hears it comes.
// Sitting, they play for themselves, and while they do they're slower to notice things. Nomad shepherds aren't here yet.
import { dayRound, temperament } from './plans.js';
import { giveInstrument, phrasesKnown, phraseCount, learnTune, drilled, tunesOf, playThrough, playOut } from './music-sim.js';
import { FOLK_TUNES } from './tunes.js';

// who keeps them: out of the household with the most hands, someone it can spare, and the steadiest of those. The parents
// run the house and the croft, so they only go if there's nobody else.
export function chooseShepherd(houses){
  const free = n => !n.postRider && !n.trader && !n.shepherding && n.name !== undefined;
  const hands = h => h.household.filter(free).length;
  const big = [...houses].filter(h => hands(h) > 0).sort((a, b) => hands(b) - hands(a))[0];
  if (!big) return null;
  const steady = n => temperament(n.id ?? n.name).steadiness;
  const them = big.household.filter(free), spare = them.filter(n => n.role !== 'father' && n.role !== 'mother');
  return (spare.length ? spare : them).sort((a, b) => steady(b) - steady(a))[0];
}

// The hut, as far as a person's concerned: somewhere to be out of sight. Not a House, which has a hearth, a field and a
// household. They stay on the doorstep in fact, since nobody can see them there and it's where they'll come out.
class ShepherdHut {
  constructor(round, b){
    this.round = round; this.b = b; this.x = b.x; this.z = b.z;
    // the door's on the side away from the fold (gen/common.js): door -1 in the building's frame
    const k = b.hw + 1.2, s = Math.sin(b.a), c = Math.cos(b.a);
    this.mouth = { x: b.x - s * b.door * k, z: b.z + c * b.door * k };
  }
  enter(npc){ npc._indoors = this; npc.moving = false; npc.path = null; }
  // Brain turns anyone out of a building their target isn't in, every step, and a round's job has no building. So staying
  // is decided here: they go when the night's step ends or something else calls them
  leave(npc){
    if (npc.brain?.target?.kind === this.round.name && this.round.jobs.get(npc)?.step?.name === 'in-the-hut') return;
    npc._indoors = null; npc.sitting = false; npc.sleeping = false;
  }
}

// somewhere to sit and see them from: the highest clear ground close to the flock's ground
function lookout(flock, g){
  const L = flock.land;
  let best = null, by = -Infinity;
  for (let i = 0; i < 14; i++){
    const a = i * 0.449, d = 12 + (i % 3) * 5, x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
    if (!L.walkable(x, z) || L.within?.(x, z, 2)?.length || flock._inFold(x, z)) continue;
    const y = L.height?.(x, z) ?? 0;
    if (y > by){ by = y; best = { x, z }; }
  }
  return best || g;
}

// Needs in the Lea turn over in a couple of minutes, and everyone else is never far from a hearth. A shepherd is out from dawn
// to dark, 100u from any fire: walking out there alone used up their warmth, and past the point a round gives way they stood
// about all day with nothing in reach. So they've bread in a bag and a thick cloak, which keep them below that point
// wherever they are. For now the bread comes from nowhere: it should come out of the household's stores.
const PROVIDED = 0.55, EASE = 0.05, DAY = 600;
function provided(a, dt){
  const N = a.needs;
  for (const k of ['food', 'warmth', 'rest']) if (N[k] > PROVIDED) N[k] = Math.max(PROVIDED, N[k] - EASE * dt);
}

// Round the fold, not through it. People don't collide with hurdles (only sheep do), and everything a shepherd does is on one
// side of it or the other. Wherever they're going, on the round or after a stray: if the straight line crosses the fold, they
// make for whichever corner is on the shortest way round, and when they've a clear line, the real place again.
const PAD = 1.2, ROUND = 2.5;
function crosses(f, ax, az, bx, bz, pad = PAD){
  const c = Math.cos(f.a), s = Math.sin(f.a);
  let U = f.hl + pad, V = f.hw + pad;
  const au = (ax - f.x) * c + (az - f.z) * s, av = (az - f.z) * c - (ax - f.x) * s;
  const bu = (bx - f.x) * c + (bz - f.z) * s, bv = (bz - f.z) * c - (bx - f.x) * s;
  // close by the wall already, as a route can put them: it's the wall itself that counts. Inside it, out by the nearest corner
  if (Math.abs(au) < U && Math.abs(av) < V){ U = f.hl; V = f.hw; if (Math.abs(au) < U && Math.abs(av) < V) return true; }
  // the same at the other end: a sheep against the hurdles has to be reachable, or they circle the fold for ever
  if (Math.abs(bu) < U && Math.abs(bv) < V){ U = f.hl; V = f.hw; }
  let t0 = 0, t1 = 1;
  for (const [a, d, L] of [[au, bu - au, U], [av, bv - av, V]]){
    if (Math.abs(d) < 1e-6){ if (Math.abs(a) >= L) return false; continue; }
    let p = (-L - a) / d, q = (L - a) / d;
    if (p > q) [p, q] = [q, p];
    t0 = Math.max(t0, p); t1 = Math.min(t1, q);
    if (t0 >= t1) return false;
  }
  return true;
}
// Into the fold or out of it: by the gap. Going round never gets you inside, so a sheep left in a corner of it was out of reach
// for good (check-shepherd, seed 4). In the mouth, or inside, the way is straight: returns { at }. Outside and going in, the gap is
// where to make for, round the fold if need be: returns { goal }. Neither side, or both: null
const MOUTH = 2.2;
function byGap(f, n, dest){
  const c = Math.cos(f.a), s = Math.sin(f.a), uv = (x, z) => [(x - f.x) * c + (z - f.z) * s, (z - f.z) * c - (x - f.x) * s];
  const [nu, nv] = uv(n.x, n.z), [du, dv] = uv(dest.x, dest.z);
  const inN = Math.abs(nu) < f.hl && Math.abs(nv) < f.hw, inD = Math.abs(du) < f.hl && Math.abs(dv) < f.hw;
  if (inN === inD) return null;
  const at = k => ({ x: f.x - s * (f.hw + k), z: f.z + c * (f.hw + k) });
  // (the mouth reaches well out: a job counts as done within a step or so of where it's aimed, so the aim has to move on to the real
  // place before they get that near the gap. Going out, it's aimed well beyond the gap, where nobody inside can be near enough)
  const mouth = Math.abs(nu) < (f.gap ?? 1.5) + 1 && nv > f.hw - MOUTH - 0.4 && nv < f.hw + 5;
  if (inD) return mouth ? { at: dest } : { goal: at(MOUTH) };
  return { at: at(5.2) };
}
function steer(n, job){
  const f = n.shepherding.fold, B = n.brain?.target;
  const dest0 = job.dest || (job.dest = { x: job.x, z: job.z });
  const gap = byGap(f, n, dest0);
  if (gap?.at){
    job.way = job.was = null; job.x = gap.at.x; job.z = gap.at.z;
    if (B && B.kind === 'shepherd'){ B.x = gap.at.x; B.z = gap.at.z; }
    return;
  }
  const dest = gap?.goal || dest0;
  let at = dest;
  // on the way to a corner, no second thoughts: walking toward it can clear the line, and walking back can block it again
  if (job.way && Math.hypot(job.way.x - n.x, job.way.z - n.z) >= 2.5) at = job.way;
  else if (!crosses(f, n.x, n.z, dest.x, dest.z)) job.way = job.was = null;
  else {
    // the next corner. Moved on from before it's quite reached: getting within a step's reach of one would count as having
    // got there, and they'd do at the corner whatever they came to do. And never the one just left, or they'd go back and forth
    const c = Math.cos(f.a), s = Math.sin(f.a), U = f.hl + ROUND, V = f.hw + ROUND;
    const iu = (n.x - f.x) * c + (n.z - f.z) * s, iv = (n.z - f.z) * c - (n.x - f.x) * s, inside = Math.abs(iu) < f.hl && Math.abs(iv) < f.hw;
    let bd = Infinity, best = null;
    for (const [u, v] of [[U, V], [U, -V], [-U, V], [-U, -V]]){
      const x = f.x + c * u - s * v, z = f.z + s * u + c * v;
      if ((job.way && job.way.u === u && job.way.v === v) || (job.was && job.was.u === u && job.was.v === v)) continue;
      // (only the wall itself rules out a corner: leaving the last one a little early mustn't leave them no way on but back)
      if (!inside && crosses(f, n.x, n.z, x, z, 0.2)) continue;
      const d = Math.hypot(x - n.x, z - n.z) + Math.hypot(dest.x - x, dest.z - z) + (crosses(f, x, z, dest.x, dest.z) ? 30 : 0);
      if (d < bd){ bd = d; best = { x, z, u, v }; }
    }
    job.was = job.way; job.way = best;
    if (best) at = best;
  }
  job.x = at.x; job.z = at.z;
  if (B && B.kind === 'shepherd'){ B.x = at.x; B.z = at.z; }
}

// --- keeping an eye out. Someone inattentive takes longer to see it (temperament: attention, a z-score)
const LOOK = 1, FETCH_FOR = 0.1;
const noticeAfter = n => 4 + 16 * (1 - Math.max(0, Math.min(1, (temperament(n.id ?? n.name).attention + 2) / 4)));
const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six'];
const word = k => WORDS[k] ?? String(k);

// --- the pipe
const PIPE = 'tabor pipe', CALL_GAP = 1.5, IDLE_GAP = [25, 70], PLAY_STEPS = new Set(['morning-ground', 'fresh-ground', 'gather']);
// the flock's call: whichever of the folk's own tunes this shepherd has best. Not one of them, and they're taught the simple one
export function takeUpPipe(n, f, now){
  giveInstrument(n, PIPE);
  const known = FOLK_TUNES.map(id => [id, phrasesKnown(n, id, now) / phraseCount(id)]).sort((a, b) => b[1] - a[1])[0];
  f.call = known[1] > 0 ? known[0] : 'the little star';
  learnTune(n, f.call, now, phraseCount(f.call));
  drilled(n, f.call, now, 1);    // they've played it every day for years
}
function pipe(round, n, now, dt){
  const f = n.shepherding, job = round.jobs.get(n), P = n.piping ??= { go: null, id: null, gap: 5 };
  const free = !n._indoors && job?.step && PLAY_STEPS.has(job.step.name) && n.brain?.target?.kind === round.name;
  const call = free && (f._led || (job.step.name === 'gather' && !f.allIn()));
  f.calling = !!call;
  if (!free){ P.go = null; return; }
  if (P.go){
    P.go.left -= dt;
    if (call && P.id !== f.call) P.go = null;                 // never mind that one: it's time for the call
    else if (P.go.left <= 0){ P.go = null; P.gap = call ? CALL_GAP : IDLE_GAP[0] + Math.random() * (IDLE_GAP[1] - IDLE_GAP[0]); }
    return;
  }
  if (call) P.gap = Math.min(P.gap, CALL_GAP);
  else if (!n.sitting) return;                                // for themselves, only sitting down
  if ((P.gap -= dt) > 0) return;
  const mine = tunesOf(n, now), id = call || !mine.length ? f.call : mine[Math.floor(Math.random() * mine.length)];
  P.id = id; const go = P.go = playOut(n, id, now, () => n.piping?.go === go) ?? null;   // whoever's free nearby may join in (music-sim.js)
  if (!P.go) P.gap = IDLE_GAP[0];
}

// --- saying so, unprompted. main.js draws it, if you're where you could hear it. Not every time: a line per kind per while
function shout(n, kind, lines, every = 60){
  const say = n.shepherding.sayAloud;
  if (!say) return;
  const W = n._shouted ??= new Map(), t = performance.now() / 1000;
  if (t - (W.get(kind) ?? -1e9) < every) return;
  W.set(kind, t);
  say(n, kind, lines[Math.floor(Math.random() * lines.length)]);
}
const Cap = s => s[0].toUpperCase() + s.slice(1);

function fetchSheep(round, n, s, now){
  const f = n.shepherding, W = n._watch;
  W.s = s;
  const short = f.sheep.length - (f.inside || 0);
  round.interrupt(n, { x: s.x, z: s.z, why: 'a stray', until: now + FETCH_FOR, fetching: 'out',
    say: f.fold.held ? [`That's ${word(f.inside || 0)} in, and ${word(short)} short. I'm going to look.`] : ["There's one gone off. I'll fetch it back.", "One's got away from me. It won't have gone far."],
    then(a, at){
      if (Math.hypot(s.x - a.x, s.z - a.z) > 5){ if (s.lost || s.short) fetchSheep(round, a, s, at); return; }
      s.led = a; s.lost = s.short = false; s.off = null;
      shout(a, 'heel', ['Come on, you. Back with the others.', 'Where did you think you were going?'], 40);
      bringBack(round, a, s, at);
    } });
}
function bringBack(round, n, s, now){
  const f = n.shepherding, say = ['Come on, you. Back with the others.'];
  const release = a => { s.led = null; n._watch.s = null; if (f.fold.held) f.fold.open = true; };
  const go = (at, then) => round.interrupt(n, { x: at.x, z: at.z, why: 'a stray', say, until: now + FETCH_FOR, fetching: 'back', then });
  if (!f.fold.held) return go({ x: f.cx, z: f.cz }, release);
  go(f._mouthOut, release);
}
// where's the flock got to? Over there, then lead them back to their ground
function seeToFlock(round, n, now){
  const f = n.shepherding;
  n._watch.cool = 25;
  if (f.chased > 0) shout(n, 'chased', ['Hey! Leave them be!', 'Mind the sheep!', "Don't run at them!"], 30);
  round.interrupt(n, { x: f.cx, z: f.cz, why: 'the flock', until: now + FETCH_FOR, fetching: 'flock',
    say: f.chased > 0 ? ["You've got them running. Give them some room, would you?", "They'll settle if you let them. Don't run at them."] : ["They've been run all over. I'm taking them back."],
    then(){ if (f.ground) f.leadTo(f.ground); } });
}
// The gate's open after dark: a late one's been brought back, or came in by itself after they'd left. It's theirs to shut, in
// person, once they've seen it through. The fold only shuts itself if they can't come at all (sheep.js)
function seeToGate(round, n, now){
  const f = n.shepherding;
  round.interrupt(n, { x: f._mouthOut.x, z: f._mouthOut.z, why: 'dusk', until: now + FETCH_FOR, step: { name: 'see-them-in', stays: true, say: ['Just seeing the last of them in.'],
    work(a){
      if (f.strayed().length){ round.jobs.delete(a); return; }      // another one out: that first (keepWatch), and back here after
      if (!f.allIn()) return;
      shout(a, 'count', [`${Cap(word(f.sheep.length))}. That's all of them.`, `${Cap(word(f.sheep.length))}. All in.`], 20);
      f.shut(); round.jobs.delete(a);
    } } });
}
function keepWatch(round, n, now, dt){
  const f = n.shepherding, W = n._watch || (n._watch = { t: 0, seen: 0, cool: 0, s: null });
  W.cool -= dt;
  const cur = round.jobs.get(n);
  if (cur) steer(n, cur);
  if ((W.t -= dt) > 0) return;
  W.t = LOOK;
  if (!f.awake){ if (cur?.interrupted) round.jobs.delete(n); W.s = null; W.seen = 0; return; }
  if (cur?.fetching === 'out' && W.s){
    if (!W.s.lost && !W.s.short){ round.jobs.delete(n); W.s = null; return; }      // it found its own way back
    cur.dest = { x: W.s.x, z: W.s.z };                               // it's moved
    return;
  }
  if (cur?.fetching === 'back' && W.s && W.s.led !== n){ round.jobs.delete(n); W.s = null; return; }   // it fell behind
  if (cur?.interrupted) return;
  if (W.s?.led === n) W.s.led = null;                                // ran out of time, or something else called them
  W.s = null;
  const out = f.strayed();
  if (out.length){
    if ((W.seen += n.piping?.go ? LOOK / 2 : LOOK) < noticeAfter(n)) return;      // playing, it takes longer to look up
    W.seen = 0;
    shout(n, 'stray', ["There's one gone off.", 'Hold on, one of them has wandered.'], 40);
    let best = out[0], bd = Infinity;
    for (const s of out){ const d = Math.hypot(s.x - n.x, s.z - n.z); if (d < bd){ bd = d; best = s; } }
    return fetchSheep(round, n, best, now);
  }
  W.seen = 0;
  const phase = now - Math.floor(now);
  if (f.fold.held && f.fold.open && (phase >= 0.875 || phase < 0.2)) return seeToGate(round, n, now);
  if (W.cool > 0 || f.fold.held || (f.inside || 0) > f.sheep.length / 2) return;
  const far = f.ground && Math.hypot(f.cx - f.ground.x, f.cz - f.ground.z) > 35;
  if (f.chased > 0 || (far && !(f.herded > 0))) seeToFlock(round, n, now);
}

export function shepherdRound(){
  const flockOf = n => n.shepherding;
  // to ground of their choosing, and the flock after them. Once a step: after fetching a stray they go back where they were
  const lead = step => (n, now) => {
    const key = `${Math.floor(now)}:${step}`;
    if (n._lead?.key === key) return n._lead.at;
    const f = flockOf(n), g = f.chooseGround();
    if (g) f.leadTo(g);
    return (n._lead = { key, at: lookout(f, g || f.home) }).at;
  };
  // at the gatepost, where the count's done, and out of the way of the gap
  const gatepost = n => { const o = flockOf(n).fold, u = o.gap + 1.2, v = o.hw + 1.4, c = Math.cos(o.a), s = Math.sin(o.a); return { x: o.x + c * u - s * v, z: o.z + s * u + c * v }; };
  const round = dayRound({ name: 'shepherd', bias: 2.5, steps: [
    { name: 'in-the-hut', from: 0.885, to: 0.24, stays: true, sit: true, tol: 1.2, why: 'night', where: n => flockOf(n).hutPlace.mouth,
      say: ['I sleep out here by the fold. Somebody should.'],
      // (rest and warmth as at home, whose bed is still theirs: the numbers for it live with House)
      work(a, job, now, dt){ const h = flockOf(a).hutPlace; if (a._indoors !== h) h.enter(a); a.home?.sleep(a, dt); } },
    { name: 'open-fold', from: 0.24, to: 0.31, why: 'dawn', where: n => flockOf(n)._mouthOut,
      say: ['Off to let them out.', "They'll be waiting at the gate by now."],
      arrive(a){ flockOf(a).letOut(); shout(a, 'out', ['Out you go, then.', 'Go on. Out.']); } },
    { name: 'morning-ground', from: 0.31, to: 0.57, stays: true, sit: true, why: 'the flock', where: lead('morning'),
      work(a, job){ job.say = [`They know ${a.shepherding.call}. I play it and they come.`, 'Minding the sheep.']; },
      say: ['Minding the sheep.', "There's good grass up here. They'll stay on it most of the morning.", "I've bread in the bag. I'm all right out here till dark."] },
    { name: 'fresh-ground', from: 0.57, to: 0.72, stays: true, sit: true, why: 'fresh ground', where: lead('afternoon'),
      say: ["They've had the best of that patch, so I've moved them on.", 'Minding the sheep. This is better grass than where we were.'] },
    // setting off is what starts them home: they know the way, and come after
    { name: 'gather', from: 0.72, to: 0.875, stays: true, tol: 1.5, why: 'dusk', where: n => { flockOf(n).callIn(); return gatepost(n); },
      say: ['Bringing them in before dark.'],
      work(a, job){
        const f = flockOf(a), n = f.sheep.length, k = f.inside || 0;
        f.callIn();
        job.say = !f.awake || k === n ? [`That's all of them. ${Cap(word(n))}.`] : [`${Cap(word(k))} so far, of ${word(n)}. Don't talk to me, I'll lose count.`];
        if (f.allIn()){
          if (f.fold.open && f.awake) shout(a, 'count', [`${Cap(word(n))}. That's all of them.`, `${Cap(word(n))}. All in.`]);
          f.shut();
        }
      } },
    { name: 'shut-gate', from: 0.875, to: 0.885, why: 'dusk', where: n => flockOf(n)._mouthOut,
      // not on anyone still out: if they're slow it's left open for them, and the fold shuts itself once it's dark (sheep.js)
      arrive(a){ const f = flockOf(a); if (f.allIn()) f.shut(); } },
  ] });
  const tick = round.tick; let last = null;
  round.tick = (now, phase) => {
    const dt = last == null ? 0 : Math.min(5, (now - last) * DAY); last = now;
    tick(now, phase);
    if (dt > 0) for (const n of round.holders){ provided(n, dt); keepWatch(round, n, now, dt); pipe(round, n, now, dt); }
  };
  return round;
}

// a shepherd for every flock with a fold. owner.place tells whose
// sayAloud(n, kind, line): someone speaking first, drawn by main.js
export function hireShepherds(agents, phase, { sayAloud = null } = {}){
  const round = shepherdRound(), S = [];
  for (const f of agents.flocks){
    if (!f.fold || !f.owner?.place) continue;
    const houses = agents.houses.filter(h => f.owner.place.buildings.includes(h.b));
    const n = chooseShepherd(houses);
    if (!n) continue;
    n.shepherding = f;
    f.keeper(n, new ShepherdHut(round, f.common.hut), phase);
    f.sayAloud = sayAloud;
    takeUpPipe(n, f, agents.time ?? 0);
    round.hold(n);
    S.push(n);
  }
  agents.rounds = [...(agents.rounds || []), round];
  return { round, shepherds: S };
}
