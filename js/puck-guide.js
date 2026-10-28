// puck-guide.js — Puck as a guide. Ask him "Where am I?", then "Anything
// interesting nearby?", pick a place, hear the way there (by the road, or the
// pretty way), and he hops ahead along it, waiting for you, talking as you go:
// "Ah, Shirn Wood! Haven't been here in ages." "We take a left here." "Not much
// longer now." The routes and their telling are js/guide.js; his footwork on the
// route is Puck.guideStep (js/puck.js); this is his side of it: the dialog
// branch, and the remarks along the way.
//
// His greeting asks only "What is a puck?" (dialogs/puck.json, down to Faerie and the
// doctors) and "Where am I?"; everything he'll take you to hangs off the second: what's
// nearby, the villages ("I'd like to meet some people."), Claude (asked for as whoever's
// in charge until you've met them, then by name), finding things, and the thin places.
//
// He also knows where things are found ("Where would I find…?"): `finder` (main.js)
// gives the kinds worth asking about, the ones your recipes want first, and for each
// what he knows of it and the nearest place it's got, which he'll lead you to like any
// other destination. And once a stargazer has told you of them (or you carry the fairy
// salve), `finder.thin()` gives the nearest thin place of each kind (a fairy ring, a
// stone circle, a sacred tree), and he'll take you to one: "Take me to a thin place."
// Once a stargazer has told you of the old salves (`finder.salve()`), his greeting has
// "How do I make a salve…?": he can't read, so it's books, and he'll lead you to them.
// `friends()` gives the folk he'll find for you (Claude, for now; `met` once you have,
// else `stranger` is how you ask for them): "Take me to Claude." They wander, so a friend's
// dest has live x and z (getters): the route is planned to where they stand when you
// ask, and you've arrived when you're near where they are now.

import { placeAt, placePhrase, places } from './gen/places.js';
import { roadFrom } from './ways.js';
import { destinations, routeOptions, describeRoute, routeLegs, farWord, bearing } from './guide.js';

const pick = a => a[(Math.random() * a.length) | 0];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const GAP = 5;          // seconds between remarks
const SOON = 1.5;       // and between one and a remark that can't wait (a new region, a turn)

// Entering a region, by its kind: {N} is its name
const ENTER = {
  wood:      ['Ah, {N}! Haven\'t been here in ages.', '{N}. Mind the roots.', 'Into {N} we go. Keep close.'],
  grove:     ['{N}. The old trees. Speak softly here.', 'Ah, {N}. Smell the pine?'],
  carr:      ['{N}. Alders, and wet feet.', 'Through {N}. Squelch, squelch.'],
  heath:     ['Up onto {N}. Smell that heather!', '{N}! You can see for miles up here.'],
  rock:      ['{N}. Watch your step on the stones.', 'Over {N}. Hop, hop!'],
  meadow:    ['{N}, all in flower.', 'Across {N}. Lovely, isn\'t it?'],
  wetmeadow: ['{N}. Soft going here.', 'Across {N}. Mind the ditches.'],
  marsh:     ['{N}. Wet feet ahead, I\'m afraid.', 'Out on {N}. Stay on the tussocks!'],
  fen:       ['{N}. Wet feet ahead, I\'m afraid.', '{N}. Don\'t stop, or you\'ll sink.'],
  lake:      ['There\'s {N}. Pretty, isn\'t it?'],
  greatlake: ['Along by {N}. Mind the water.'],
};

// The way onto a route from where he stands. The route starts at your feet, and
// hopping along it from there would take him straight through you (in the first
// person, a sprite hopping through the camera is one huge jump). So he joins it
// JOIN along, and if the straight hop there would pass within CLEAR of you, he
// goes round you on an arc, the short way. Returns the route with its new start,
// and how long the lead-in is.
const JOIN = 14, CLEAR = 4;
export function leadIn(route, px, pz, cx, cz){
  const P = route.pts;
  let s = 0, q = 0;
  for (; q + 1 < P.length; q++){
    const L = Math.hypot(P[q + 1][0] - P[q][0], P[q + 1][1] - P[q][1]);
    if (s + L >= JOIN) break;
    s += L;
  }
  if (q + 1 >= P.length) return { route: { ...route, pts: [[px, pz], ...P.slice(1)] }, len: 0 };   // short: just go
  const L = Math.hypot(P[q + 1][0] - P[q][0], P[q + 1][1] - P[q][1]), f = (JOIN - s) / L;
  const J = [P[q][0] + (P[q + 1][0] - P[q][0]) * f, P[q][1] + (P[q + 1][1] - P[q][1]) * f];
  const pts = [[px, pz]];
  // how close the straight hop from him to J comes to you
  const vx = J[0] - px, vz = J[1] - pz, t = Math.max(0, Math.min(1, ((cx - px) * vx + (cz - pz) * vz) / (vx * vx + vz * vz || 1)));
  if (Math.hypot(px + vx * t - cx, pz + vz * t - cz) < CLEAR){
    const R = Math.max(CLEAR + 1, Math.hypot(px - cx, pz - cz)), a0 = Math.atan2(pz - cz, px - cx);
    let da = Math.atan2(J[1] - cz, J[0] - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(da) / 0.25));
    for (let k = 1; k <= n; k++){ const a = a0 + da * k / n; pts.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
  }
  pts.push(J);
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return { route: { ...route, pts: [...pts, ...P.slice(q + 1)] }, len };
}

// lay out what he'll say along a route: where the legs change and where it turns
// (not on his way round you onto it: `from` is how long that is)
function plan(route, from = 0){
  const P = route.pts, cum = [0];
  for (let q = 1; q < P.length; q++) cum.push(cum[q - 1] + Math.hypot(P[q][0] - P[q - 1][0], P[q][1] - P[q - 1][1]));
  const len = cum[cum.length - 1];
  const at = s => {
    let q = 0; while (q + 1 < cum.length - 1 && cum[q + 1] < s) q++;
    const f = cum[q + 1] > cum[q] ? (s - cum[q]) / (cum[q + 1] - cum[q]) : 0;
    return [P[q][0] + (P[q + 1][0] - P[q][0]) * f, P[q][1] + (P[q + 1][1] - P[q][1]) * f];
  };
  // turns: where the way bends more than 55° over 12u either side, at least 40u apart
  const turns = [];
  for (let s = Math.max(16, from + 10); s < len - 16; s += 4){
    const [ax, az] = at(s - 12), [bx, bz] = at(s), [cx, cz] = at(s + 12);
    const ux = bx - ax, uz = bz - az, vx = cx - bx, vz = cz - bz;
    const ang = Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz);
    if (Math.abs(ang) < 55 * Math.PI / 180) continue;
    const last = turns[turns.length - 1];
    if (last && s - last.s < 40){ if (Math.abs(ang) > Math.abs(last.ang)){ last.s = s; last.ang = ang; } continue; }
    turns.push({ s, ang });
  }
  return { cum, len, legs: routeLegs(route), turns };
}

// guide: { puck, flock, player, say(text), onArrive(dest) } — say puts a bubble over Puck;
// onArrive, when he's brought you where you asked (for the journal)
export function makePuckGuide({ flock, player, say, finder = null, onArrive = null, friends = null }){
  let trip = null;            // { dest, route, plan, leg, turnK, said, t, waitT, offT, half, near }
  let chosen = null, page = 0, opts = new Map(), asked = null, fpage = 0;
  const puck = () => flock.leader;

  function start(dest, planned){
    const p = puck(), { route, len: lead } = leadIn(planned, p.x, p.z, player.x, player.z), pl = plan(route, lead);
    p.guide = { pts: route.pts, cum: pl.cum, len: pl.len, s: 0, ip: 0, k: 0 };
    trip = { dest, route, plan: pl, leg: 0, turnK: 0, seen: new Set([dest.name]), t: GAP, waitT: 0, offT: 0, stage: 0 };
    const first = pl.legs[0];
    say(pick(['Follow me!', 'This way!', 'Come on, then!']) + (first?.road ? ' The old road first.' : ''));
  }
  function stop(){
    const p = puck();
    if (p){ p.guide = null; flock.leaderCx = p.x; flock.leaderCz = p.z; }   // he stays where he got to
    trip = null;
  }

  // a remark, if he hasn't just made one (`now` for the ones that can't wait long)
  function remark(text, now = false){
    if (trip.t < (now ? SOON : GAP)) return false;
    say(text); trip.t = 0; return true;
  }

  function tick(dt){
    if (!trip) return;
    const p = puck(), g = p && p.guide;
    if (!g){ trip = null; return; }
    trip.t += dt;
    const dPlayer = Math.hypot(p.x - player.x, p.z - player.z);
    // you've gone off somewhere (or away in a blink): he gives up and stays put
    trip.offT = dPlayer > 150 ? trip.offT + dt : 0;
    if (trip.offT > 10 || dPlayer > 400){ stop(); return; }
    // there
    const dEnd = Math.hypot(player.x - trip.dest.x, player.z - trip.dest.z);
    if (g.s >= g.len - 1 && dEnd < trip.dest.arrive + 8){
      say(pick([`Here we are: ${trip.dest.name}!`, `${cap(trip.dest.name)}! Told you I knew the way.`, `And here's ${trip.dest.name}.`]));
      const dest = trip.dest;
      stop(); onArrive?.(dest); return;
    }
    // a friend who's wandered off from where the route ends: after them, from where he is
    if (trip.dest.live && g.s >= g.len - 1 && Math.hypot(g.pts.at(-1)[0] - trip.dest.x, g.pts.at(-1)[1] - trip.dest.z) > trip.dest.arrive + 4 && (trip.chase = (trip.chase || 0) + 1) <= 5){
      const o = routeOptions(p.x, p.z, trip.dest);
      if (o.length){
        const pl = plan(o[0], 0);
        p.guide = { pts: o[0].pts, cum: pl.cum, len: pl.len, s: 0, ip: 0, k: 0 };
        Object.assign(trip, { route: o[0], plan: pl, leg: 0, turnK: 0, stage: 0 });
        trip.t = GAP; remark(pick([`${cap(trip.dest.name)}'s moved on. This way!`, `Not here any more! After ${trip.dest.name}, then.`]), true);
        return;
      }
    }
    // waiting for you
    trip.waitT = g.waiting ? trip.waitT + dt : 0;
    if (trip.waitT > 3 && remark(pick(['Over here!', 'Keep up, slowcoach!', 'This way!', 'Yoo-hoo! Here!']))){ trip.waitT = -5; return; }
    if (g.off > 60 && dPlayer > 40 && remark(pick(["We're going this way!", 'Not that way! Here!']))) return;
    if (dPlayer > 30) return;                         // the rest he says only with you near enough to hear
    const pl = trip.plan;
    // a new leg: onto the road, off it, into a region
    const legNow = pl.legs.findIndex(l => g.s >= l.s0 && g.s <= l.s1 + 0.5);
    if (legNow > trip.leg){
      if (trip.t < SOON) return;                      // in a moment: let the last remark be read
      const l = pl.legs[legNow], was = pl.legs[trip.leg];
      trip.leg = legNow;
      if (l.road) remark(pick(['Onto the old road now.', "Here's the old road. Easy going.", 'The old road! Follow it a while.']), true);
      else {
        const name = l.place?.name, lines = ENTER[l.place?.kind] || ['Here\'s {N}.'];
        const line = name ? pick(lines).replace('{N}', name) : 'On we go.';
        remark(cap(was && was.road ? `We leave the road here. ${line}` : line), true);
      }
      return;
    }
    // a turn just ahead
    const tn = pl.turns[trip.turnK];
    if (tn && g.s > tn.s - 6 && trip.t >= SOON){
      trip.turnK++;
      if (g.s < tn.s + 6){
        const left = tn.ang < 0;
        remark(pick(left ? ['We take a left here.', 'Left, here!', 'Bear left.'] : ['We take a right here.', 'Right, here!', 'Bear right.']), true);
        return;
      }
    }
    // somewhere worth knowing, passing close by
    for (const d of destinations(p.x, p.z, { n: 3 })){
      if (d.d > 45 || trip.seen.has(d.name)) continue;
      trip.seen.add(d.name);
      if (remark(`That's ${d.name}, over to the ${bearing(p.x, p.z, d.x, d.z)}.`)) return;
    }
    // how far yet
    const left = g.len - g.s;
    if (trip.stage === 0 && g.len > 250 && g.s > g.len * 0.5){ if (remark(pick(['Halfway there, near enough.', 'Halfway! Keep going.']))) trip.stage = 1; return; }
    if (trip.stage <= 1 && left < Math.max(80, g.len * 0.2) && g.len > 150){ if (remark(pick(['Not much longer now.', 'Not far now.']))) trip.stage = 2; return; }
    if (trip.stage <= 2 && left < 30){ if (remark(pick(['Nearly there!', 'Almost there!']))) trip.stage = 3; }
  }

  // ---- the dialog branch -------------------------------------------------------
  const options = d => { if (!opts.has(d.name)) opts.set(d.name, routeOptions(player.x, player.z, d)); return opts.get(d.name); };
  const BYE = { label: 'Farewell, good fellow.', next: null };
  const nodes = {
    get 'g-where'(){
      const here = placeAt(player.x, player.z);
      let text = pick([`You're ${placePhrase(here)}, traveller.`, `Why, ${placePhrase(here)}! Where else?`, `${cap(placePhrase(here))}. Puck always knows.`]);
      const r = roadFrom(player.x, player.z);
      if (r) text += r.on ? ' And this is the old road under your feet.' : ` The old road runs off to the ${['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(r.toward / 45) % 8]}.`;
      page = 0;
      const choices = [{ label: 'Anything interesting nearby?', next: 'g-near' }, { label: "I'd like to meet some people.", next: 'g-people' }];
      for (const f of friends ? friends() : [])
        choices.push(f.met ? { label: `Take me to ${f.name}.`, next: 'g-friend', run: () => { chosen = f; } }
                           : { label: f.stranger, next: 'g-friend', run: () => { chosen = f; } });
      if (finder) choices.push({ label: 'Help me find something.', next: 'g-find', run: () => { fpage = 0; } });
      if (finder && finder.thin && finder.thin()) choices.push({ label: 'Take me to a thin place.', next: 'g-thin' });
      choices.push(BYE);
      return { text, choices };
    },
    // the villages and hamlets, nearest first
    get 'g-people'(){
      const ds = destinations(player.x, player.z, { n: 4, kinds: ['village', 'hamlet'] });
      const choices = ds.map(d => ({ label: `${cap(d.name)}, ${farWord(d.d)} ${bearing(player.x, player.z, d.x, d.z)}.`, next: 'g-way', run: () => { chosen = d; } }));
      choices.push({ label: 'Never mind.', next: null });
      return { text: "Worst idea you've had all day.", choices };
    },
    get 'g-near'(){
      const ds = destinations(player.x, player.z, { skip: page * 4, n: 4 });
      if (!ds.length) return { text: "That's all I know of, I'm afraid. Even Puck can't know everything.", choices: [BYE] };
      const lines = ds.map((d, q) => `${q ? pick(["There's", 'And', 'Then there\'s']) : "There's"} ${d.what}, ${farWord(d.d)} ${bearing(player.x, player.z, d.x, d.z)}.`);
      const choices = ds.map(d => ({ label: `Let's go to ${d.name}.`, next: 'g-way', run: () => { chosen = d; } }));
      choices.push({ label: 'Anything else?', next: 'g-near', run: () => { page++; } }, { label: 'Never mind.', next: null });
      return { text: (page ? 'Further off, then. ' : 'Let me see... ') + lines.join(' '), choices };
    },
    get 'g-way'(){
      const d = chosen, o = d ? options(d) : [];
      const back = { label: 'Somewhere else, then.', next: 'g-near' };
      if (!o.length) return { text: `${cap(d.name)}? That's out over the water. You'd want a canoe for that, and Puck doesn't do canoes.`, choices: [back] };
      const go = (route, label) => ({ label, next: null, run: () => start(d, route) });
      if (o.length === 1) return { text: `${cap(d.name)}? ${describeRoute(o[0])} ${cap(farWord(o[0].len))}.`, choices: [go(o[0], 'Lead the way.'), back] };
      const [byRoad, scenic] = o, longer = byRoad.len > scenic.len * 1.1;
      return { text: `${cap(d.name)}? Two ways. By the road: ${describeRoute(byRoad)}${longer ? " Longer, but it's easy going." : ''} Or the pretty way: ${describeRoute(scenic)}`,
        choices: [go(byRoad, 'The road, then.'), go(scenic, 'The pretty way.'), back] };
    },
  };
  // where things are found: a page of kinds (wanted first), then what he knows of one
  const FPAGE = 5;
  Object.defineProperties(nodes, Object.getOwnPropertyDescriptors({
    get 'g-find'(){
      const { wanted, others } = finder.kinds(), all = [...wanted, ...others], ks = all.slice(fpage * FPAGE, fpage * FPAGE + FPAGE);
      if (!ks.length){ fpage = 0; return { text: "That's the lot. If it grows, swims or shines in the Lea, Puck's told you where.", choices: [{ label: 'From the top, then.', next: 'g-find' }, BYE] }; }
      const choices = ks.map(k => ({ label: `${cap(k)}.`, next: 'g-found', run: () => { asked = k; } }));
      if (all.length > (fpage + 1) * FPAGE) choices.push({ label: 'Something else.', next: 'g-find', run: () => { fpage++; } });
      choices.push({ label: 'Never mind.', next: null });
      const lead = fpage ? 'What else, then?' : wanted.length ? pick(["Looking for something? I'd guess it's for one of those recipes of yours.", 'Find what? Puck knows where everything is. Nearly.']) : pick(['Find what? Puck knows where everything is. Nearly.', 'Ask away.']);
      return { text: lead, choices };
    },
    get 'g-thin'(){
      const t = finder.thin && finder.thin();
      if (!t || !t.places.length) return { text: "A thin place? Not one I can get you to from here.", choices: [BYE] };
      const lines = t.places.map((q, i) => `${i ? pick(['Or', 'Then there\'s']) : "There's"} ${q.dest.what}, ${farWord(Math.hypot(q.dest.x - player.x, q.dest.z - player.z))} ${bearing(player.x, player.z, q.dest.x, q.dest.z)}.`);
      const choices = t.places.map(q => ({ label: `The ${q.kind}.`, next: 'g-way', run: () => { chosen = q.dest; } }));
      choices.push({ label: 'Never mind.', next: null });
      const lead = t.salve ? pick(['The green salve, is it? Somewhere the Gentry gather, then.', "Want to see them, do you? I know where they'll be."])
                           : pick(["A thin place? Been talking to the stargazers, have you?", 'Somewhere the Gentry gather, then. Not that you\'ll see them.']);
      return { text: `${lead} ${lines.join(' ')}${t.salve && !t.night ? ' Mind, nothing shows till after dark.' : ''}`, choices };
    },
    get 'g-found-ask'(){
      const w = finder.where(asked), d = w.dest, back = { label: 'Something else.', next: 'g-find' };
      if (!d) return { text: "Not that I know of. Even Puck can't know everything.", choices: [back, BYE] };
      return { text: w.ask.text || `There's ${d.what}, ${farWord(Math.hypot(d.x - player.x, d.z - player.z))} ${bearing(player.x, player.z, d.x, d.z)}.`,
        choices: [{ label: w.ask.go || 'Take me there.', next: 'g-way', run: () => { chosen = d; } }, back, BYE] };
    },
    get 'g-friend'(){
      const d = chosen;
      if (!d) return { text: 'Who? Never heard of them.', choices: [BYE] };
      const far = Math.hypot(d.x - player.x, d.z - player.z);
      if (!d.met) return { text: `${pick(["In charge? Nobody's in charge of the Lea. But if anybody is, it's Claude.", 'In charge! Ha. The nearest thing is Claude.'])} ${far < d.arrive ? 'Right there, as it happens.' : `${pick(['Last I saw,', 'Wandering about'])} ${d.where()}, ${farWord(far)} ${bearing(player.x, player.z, d.x, d.z)}.`}`,
        choices: far < d.arrive ? [BYE] : [{ label: 'Take me there.', next: 'g-way' }, { label: 'Never mind.', next: null }] };
      if (far < d.arrive) return { text: pick([`${cap(d.name)}? Right there! Puck can't help you if you won't look.`, `${cap(d.name)} is just there. Turn round!`]), choices: [BYE] };
      return { text: `${cap(d.name)}? ${pick(['Last I saw,', 'Wandering about'])} ${d.where()}, ${farWord(far)} ${bearing(player.x, player.z, d.x, d.z)}. ${pick(['Never stays put, that one.', 'Talks like a book, you know.'])}`,
        choices: [{ label: 'Take me there.', next: 'g-way' }, { label: 'Never mind.', next: null }] };
    },
    get 'g-salve'(){
      return { text: "Word of advice: never follow a puck recipe if I were you. Real magical recipes come from books, and mine don't, because I can't read.",
        choices: [{ label: 'Where can I find books?', next: 'g-found', run: () => { asked = 'books'; } }, BYE] };
    },
    // `ask`: a question you put to him first ("A ring of mushrooms?"), and then the way
    get 'g-found'(){
      const w = finder.where(asked), back = { label: 'Something else.', next: 'g-find' };
      if (w.ask) return { text: w.lore, choices: [{ label: w.ask.label, next: 'g-found-ask' }, back, BYE] };
      if (!w.dest) return { text: w.lore, choices: [back, BYE] };
      const d = w.dest;
      return { text: `${w.lore} The nearest is ${d.what}, ${farWord(Math.hypot(d.x - player.x, d.z - player.z))} ${bearing(player.x, player.z, d.x, d.z)}.`,
        choices: [{ label: 'Take me there.', next: 'g-way', run: () => { chosen = d; } }, back, BYE] };
    },
  }));
  // the badger's wood (dialogs/puck.json "badger"): the biggest wood in the Lea
  const badger = () => [...places()].filter(g => g.kind === 'wood').sort((a, b) => b.area - a.area)[0]?.name || 'the old wood';
  // Puck's tree with the branch grafted on: "Where am I?" in his greeting (and, on a
  // trip, a way to call it off)
  function graft(tree){
    const root = tree.nodes[tree.root], extra = [{ label: 'Where am I?', next: 'g-where' }];
    if (finder?.salve?.()) extra.push({ label: 'How do I make a salve to help me see the way to Faerie?', next: 'g-salve' });
    if (trip) extra.unshift({ label: "Let's stop here.", next: null, run: () => { say('As you like. Another time!'); stop(); } });
    const choices = [...root.choices];
    const bye = choices.findIndex(c => c.next === null);
    choices.splice(bye < 0 ? choices.length : bye, 0, ...extra);
    const out = { ...tree, nodes: Object.create(null) };
    for (const k of Object.keys(tree.nodes)) out.nodes[k] = tree.nodes[k];
    for (const k of Object.keys(nodes)) Object.defineProperty(out.nodes, k, Object.getOwnPropertyDescriptor(nodes, k));
    out.nodes[tree.root] = { ...root, choices };
    for (const [k, n] of Object.entries(tree.nodes)) if (n.text?.includes('{badger}')) out.nodes[k] = { ...n, text: n.text.replaceAll('{badger}', badger()) };
    opts = new Map();                                 // routes are from where you stand now
    return out;
  }

  return { graft, tick, stop, get active(){ return !!trip; } };
}
