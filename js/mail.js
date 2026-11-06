// mail.js — the post, in play: villagers hand you letters, you carry them in your pack, look at
// them, deliver them, and keep the stamps. js/post.js is the rules; js/stamp-view.js draws them.
// Design: docs/letters.md. main.js hands in the world through `w`.
//
// A letter's words come from the sender's real news (gossip.js), and that news reaches the reader
// when it arrives. A letter you've opened stays opened: the people at both ends stop trusting you.

import { makePost } from './post.js';
import { makeMailboxes } from './mailboxes.js';
import { makeName, humanSurnames } from './names.js';
import { makeKin, tombOrder, lidBare } from './kin.js';
import { WORLD_R } from './config.js';
import { mulberry32 } from './rng.js';
import { closeX, pinX } from './close-x.js';
import { envelopeScene, stampScene, bakeStamp, materialOf } from './stamp-view.js';

const OFFER_GAP = 0.5;        // days before someone has another letter to send
const WARDEN = { id: 'warden', name: 'the Post-Warden', realm: 'faerie', fae: true, x: 0, z: 0 };
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = n => ROMAN.reduce((s, [v, r]) => { while (n >= v){ s += r; n -= v; } return s; }, '');

function ensureCss(){
  if (document.getElementById('post-css')) return;
  const l = document.createElement('link'); l.id = 'post-css'; l.rel = 'stylesheet'; l.href = 'post.css'; document.head.appendChild(l);
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function makeMail(w){
  const places = w.settlements().places, names = w.settlementNames();
  const realms = places.map((p, i) => ({ id: `s${i}`, name: names[i].name, kind: 'green', x: p.x, z: p.z }));
  realms.push({ id: 'faerie', name: 'Faerie', kind: 'faerie', x: 0, z: 0 });
  // foreign parts, off each end of the Old Road: a realm with its own stamps, where the carrier meets the map's edge
  const R = w.road(), edge = from => { const n = R.xs.length, d = from ? 1 : -1; for (let k = from ? 0 : n - 1; k >= 0 && k < n; k += d) if (Math.hypot(R.xs[k], R.zs[k]) < WORLD_R - 15 && w.walkable(R.xs[k], R.zs[k])) return { x: R.xs[k], z: R.zs[k] }; return { x: R.xs[0], z: R.zs[0] }; };
  const far = w.farNames().map((name, i) => ({ id: `far${i}`, name, kind: 'foreign', ...edge(i === 0) }));
  realms.push(...far);
  // each crypt's a realm of its own, long gone: a fixed stock of stamps, never reprinted
  const crypts = w.crypts();
  for (const c of crypts) realms.push({ id: `crypt${c.id}`, name: c.name, kind: 'old', x: c.x, z: c.z });
  const post = makePost({ seed: w.seed, realms });
  const album = [];                  // { stamp, url, how }: the stamps you hold
  const distrust = new Set();        // houses that know you open letters
  const said = new Map();            // npc → the letter they're offering, while they offer it
  const handed = new Set();          // the letters you delivered yourself
  let wardenWrote = false, wardenHeld = null;

  const realmOf = h => { const i = places.findIndex(p => p.buildings.includes(h.b)); return i >= 0 ? `s${i}` : null; };
  const person = n => ({ id: n.id, name: n.name, realm: realmOf(n.home), x: n.home.x, z: n.home.z, npc: n, house: n.home });
  const placeLine = p => p.fae ? "in the Gentry's Grounds" : p.dead ? `in ${p.cryptName}` : `at ${w.villageOf(p.house)}`;
  const doorFrom = p => { const ps = w.portals(); return ps.length ? Math.min(...ps.map(q => Math.hypot(q.x - p.x, q.z - p.z))) : 500; };
  const carried = () => [...post.letters.values()].filter(l => l.state === 'carried');
  const boxOf = l => w.pack.items.find(b => b.lots[0]?.prov?.mail === l.id);
  const stampMark = (realm, t) => realm === 'faerie' ? { place: 'Faerie', art: 'faerie', date: roman(1 + Math.floor(Math.abs(Math.sin(t * 91.7)) * 1400)) } : { place: post.realm(realm).name, date: `Day ${Math.floor(t) + 1}` };

  // the words: their real news, or nothing much. Plain: most of the Lea writes as it talks.
  function compose(from, to, fact){
    const news = fact ? w.factLine(from.npc, fact, w.now(), to.npc || null) : null;
    return `${to.npc ? `Dear ${to.npc.given || to.name},` : 'To the Post-Warden,'}\n\n${news ? `${news}\n\nI thought you'd want to know.` : 'All well here. Nothing much to tell. I only wanted to write.'}\n\n${from.name}`;
  }
  const freshest = n => [...(n.news?.values() || [])].filter(f => f.text || f.kind).sort((a, b) => b.t - a.t)[0] || null;
  function someHouse(from, n){    // far is better: it's what a letter's for
    const others = w.houses().filter(h => h !== n.home && h.household.length && realmOf(h)), far = others.filter(h => realmOf(h) !== from.realm);
    const pool = far.length ? far : others;
    return pool.length ? pool[(n.id * 7 + Math.floor(w.now())) % pool.length] : null;
  }
  // has this person something to send today? A cheap question, asked on every talk; it spends nothing
  function hasLetter(n){
    if (!n.home || !realmOf(n.home) || distrust.has(n.home) || n._mailNext > w.now()) return false;
    if (said.has(n)) return true;
    if ((Math.imul(n.id + 1, 2654435761) + Math.imul(Math.floor(w.now()) + 1, 40503) >>> 8) % 3) return false;   // a third of them, on any one day
    return n.stargazer || !!someHouse(person(n), n);
  }
  // writes it, which takes stamps from stock: only once they've been asked for it
  function write(n){
    if (said.has(n)) return said.get(n);
    const toFae = n.stargazer;     // those who read the stars know who to write to
    const house = toFae ? null : someHouse(person(n), n);
    if (!toFae && !house) return null;
    const letter = letterFrom(n, toFae ? null : house.household[n.id % house.household.length]);
    if (letter) said.set(n, letter);
    return letter;
  }
  // a letter from one person to another (no one: to Faerie), its stamps taken from stock. Null if they've run out.
  function letterFrom(n, toNpc){
    const from = person(n), to = toNpc ? person(toNpc) : WARDEN, fact = freshest(n);
    const seal = { material: toNpc ? 'ink' : 'wax', mark: n.name[0] };
    const t = w.now(), letter = post.send({ from, to, weight: 1 + (n.id % 2), door: toNpc ? 0 : doorFrom(from), seal, body: compose(from, to, fact), payload: fact && { fact }, postmark: stampMark(from.realm, t), t });
    if (!letter) return null;           // the post's run out of what it would take
    letter.toLines = to.fae ? ['The Post-Warden', "The Gentry's Grounds"] : [to.name, `at ${w.villageOf(to.house)}`];
    letter.fromLine = `${from.name}, ${w.villageOf(from.house)}`;
    return letter;
  }

  function take(letter, giver, jot = ['was given', `a letter by ${giver}`]){
    const prov = { ...w.provHere('given', giver), mail: letter.id };
    if (!w.pack.room('letter', 1)) return false;
    w.stow('letter', 1, prov);
    w.jot(...jot);
    letter.state = 'carried';
    if (giver && letter.from.npc) { said.delete(letter.from.npc); letter.from.npc._mailNext = w.now() + OFFER_GAP; }
    w.journal.task(`mail:${letter.id}`, `A letter from ${letter.from.name} for ${letter.to.fae ? 'the Post-Warden, in the Gentry\'s Grounds' : `${letter.to.name}, ${placeLine(letter.to)}`}.`);
    return true;
  }
  // handed over: what it carried now happens. Returns how it went, for the words.
  function hand(letter, who){
    const box = boxOf(letter); if (box) w.pack.takeFrom(box.id);
    w.journal.done(`mail:${letter.id}`);
    post.deliver(letter, w.now());
    handed.add(letter);
    const whole = !letter.seal || letter.seal.whole;
    if (!whole) for (const p of [letter.from, letter.to]) if (p.house) distrust.add(p.house);
    arrives(letter, who, whole);
    w.jot('delivered', `a letter from ${letter.from.name} to ${letter.to.name}`);
    return { whole };
  }
  // what a letter carried now happens, whoever brought it
  function arrives(letter, who, whole = true){
    if (letter.payload?.fact && who && !who.fae) w.addNews(who, { ...letter.payload.fact, from: letter.from.npc || letter.payload.fact.from, hops: (letter.payload.fact.hops || 0) + 1 });
    if (whole && letter.from.npc && letter.to.npc) w.nudge(letter.to.npc, letter.from.npc, 0.05, 0.06);
  }
  // into the album, with whatever of the postmark came away on it
  async function keep(stamp, letter, cancel, url){
    const rec = { stamp, cancel, url, postmark: letter.postmark, from: letter.from.name, to: letter.to.name };
    album.push(rec); w.markAlbum(); w.refreshBook();
    return rec;
  }

  // ---- what the talk needs: choices (asked afresh each time the talk comes back to them) and nodes ----
  function talk(n, v, Pron){
    const nodes = {}, here = n.home ? realmOf(n.home) : null, res = {};
    const forHere = () => n.home ? carried().filter(l => l.to.house === n.home) : [];
    const whereTo = () => carried().filter(l => !l.to.fae && !l.to.dead && l.to.house !== n.home)[0] || null;
    let asked = null, took = false;
    nodes.mailAsk = () => {
      const l = asked;
      if (!l) return { text: `"${v('mail-none', ['Not today.', 'Nothing today, as it turns out.'])}"` };
      const whom = l.to.fae ? v('mail-fae', ["This is for the Gentry's post. You'd want a door, and I can't tell you where.", "It goes under the hill. Don't ask me how you get there. Someone will know."]) : `${v('mail-for', ["This one's for", "It's for"])} ${l.to.name}, ${placeLine(l.to)}.`;
      return { text: `"${whom}" ${Pron} holds it out. "${v('mail-wont', ["It's stamped already. It only wants taking.", "It's paid for. It just needs legs."])}"`,
        choices: [{ label: "I'll take it.", next: 'mailTaken', run: () => { took = take(l, w.displayName(n)); } }, { label: 'Not today.', next: 'mailNot' }] };
    };
    nodes.mailTaken = () => ({ text: took ? `"${v('mail-thanks', ['Thanks. Mind the seal.', "Good. Don't let it get wet."])}"` : `"${v('mail-full', ["You've no room for it. Come back when you have.", "Your pack's full. It can wait."])}"` });
    nodes.mailRider = () => {
      const job = mailboxes.jobs.get(n), k = mailboxes.ride.bag.length, next = job?.kind === 'ride' ? job.stop.name : null;
      return { text: `"${v('mail-rider', ['Up and down the road, box to box.', 'That I do. This road, end to end.'])} ${k ? `${k === 1 ? 'One letter' : `${k} letters`} in the bag.` : 'Nothing in the bag just now.'}${next ? ` ${next} next.` : ''}"` };
    };
    nodes.mailNot = { text: `"${v('mail-ok', ["It'll keep.", 'Another time, then.'])}"` };
    nodes.mailStamp = { text: `${Pron} holds the envelope out for you. "${v('mail-lift', ['Go on. Just the one.', 'Mind you don\'t tear it. One, mind.'])}"` };
    nodes.mailWhere = () => {
      const l = whereTo(); if (!l) return { text: `"${v('mail-where0', ['Who?', "I couldn't tell you."])}"` };
      const there = w.whereWord(n.x, n.z, l.to.house.x, l.to.house.z);
      return { text: here === realmOf(l.to.house) ? `"${v('mail-where', ["That's the house", 'You want the house'])} ${there}."` : `"${w.villageOf(l.to.house)}? ${v('mail-way', ["That's", "It's"])} ${there}."` };
    };
    for (const l of forHere()) nodes[`mailGave${l.id}`] = () => {
      const r = res[l.id]; if (!r) return { text: '' };
      if (!r.whole) return { text: `${Pron} turns it over and looks at the seal. "${v('mail-opened', ['This has been opened.', "Someone's had this open."])}" ${Pron} looks at you for a while. "${v('mail-opened2', ["Don't bring us any more.", "We'll find someone else to carry for us."])}"` };
      const mine = l.to.npc === n ? v('mail-mine', ['Thank you.', 'Oh. Thank you.']) : v('mail-theirs', [`I'll see ${l.to.name} gets it.`, `${l.to.name}'s out. I'll hand it over.`]);
      return { text: `"${mine}" ${Pron} looks at the envelope. "${v('mail-collect', ['You can have the stamp, if you like them.', "You want the stamp? I've no use for it."])}"`,
        choices: [{ label: "I'd like that.", next: 'mailStamp', run: () => lookAt(l, { lift: true }) }, { label: 'No, keep it.', next: 'mailNot' }] };
    };
    const choices = () => {
      const c = [];
      for (const l of forHere()) c.push({ label: l.to.npc === n ? `I've a letter for you, from ${l.from.name}.` : `I've a letter for ${l.to.name}.`, next: `mailGave${l.id}`, run: () => { res[l.id] = hand(l, l.to.npc); } });
      if (hasLetter(n) && !forHere().length) c.push({ label: v('q-mail', ['Any letters want carrying?', 'Got anything that wants carrying?']), next: 'mailAsk', run: () => { asked = write(n); } });
      const lost = whereTo();
      if (n.postRider) c.push({ label: 'You carry the post?', next: 'mailRider' });
      if (lost) c.push({ label: here === realmOf(lost.to.house) ? `Where does ${lost.to.name} live?` : `Do you know the way to ${w.villageOf(lost.to.house)}?`, next: 'mailWhere' });
      return c;
    };
    return { choices, nodes: resolve(nodes) };
  }

  // ---- the mailboxes, where each lane meets the road (js/mailboxes.js) ----
  const junctions = w.settlements().junctions;
  const realmAt = j => `s${places.indexOf(j.place)}`;
  // who lives in a place, by its houses
  const residents = realm => w.houses().filter(h => realmOf(h) === realm).flatMap(h => h.household);
  // a letter in from foreign parts. Its sender's a stranger the sim doesn't hold, so it carries no news: keeping up a tie
  const farRng = mulberry32((w.seed ^ 0xfa4) >>> 0);
  let farId = 0;
  function letterFromAfar(farIdOf, n){
    const realm = post.realm(farIdOf), nm = makeName(farRng() < 0.5 ? 'female' : 'male', farRng), t = w.now();
    const from = { id: `far${++farId}`, name: nm.full, realm: realm.id, x: realm.x, z: realm.z, foreign: true }, to = person(n);
    const body = [`I've stopped at ${realm.name}. The road's good as far as here, and there's work if you want it.`, `We're at ${realm.name} for the winter. Prices you wouldn't believe. Everyone's well.`, `I said I'd write when I got to ${realm.name}, so I'm writing. It's further than they tell you.`][(farRng() * 3) | 0];
    const letter = post.send({ from, to, weight: 1, seal: { material: 'wax', mark: nm.given[0] }, postmark: stampMark(realm.id, t), t, body: `Dear ${n.given || to.name},\n\n${body}\n\n${nm.given}` });
    if (!letter) return null;
    letter.toLines = [to.name, `at ${w.villageOf(to.house)}`]; letter.fromLine = `${from.name}, ${realm.name}`;
    return letter;
  }
  const stops = !junctions.length ? [] : [{ ...far[0], far: far[0].id },
    ...junctions.map((j, i) => ({ x: j.box.x, z: j.box.z, s: j.s, box: i, name: names[places.indexOf(j.place)].name })).sort((a, b) => a.s - b.s),
    { ...far[1], far: far[1].id }];
  const mailboxes = makeMailboxes({ seed: w.seed, realms: junctions.map(realmAt), at: junctions.map(j => j.box), stops,
    folkIn: realm => residents(realm).filter(n => n.home && !distrust.has(n.home)),
    send: (from, to) => { const l = letterFrom(from, to); if (l) from._mailNext = w.now() + OFFER_GAP; return l; },
    fromAfar: letterFromAfar,
    doorOf: l => l.to.house?.mouth || null,
    receive: l => { post.deliver(l, w.now()); arrives(l, l.to.npc); },
    // one of the folk, who've no house to get back to at night
    carrier: () => { const folk = w.npcs().filter(n => !n.home && n.name && !n.trader); return folk.length ? folk[w.seed % folk.length] : null; } });
  const population = j => residents(realmAt(j)).length;
  function boxTree(j){
    const box = mailboxes.boxes[junctions.indexOf(j)], name = names[places.indexOf(j.place)].name;
    const nodes = {}, realm = realmAt(j);
    let full = false;
    const takeOne = l => { const ok = take(l, `the mailbox at ${name}`, ['took', `a letter out of the mailbox at ${name}`]); if (ok) mailboxes.take(box, l); return ok; };
    const fromWhere = l => l.from.foreign ? `, in ${post.realm(l.from.realm).name}` : l.from.realm === realm ? '' : `, ${w.villageOf(l.from.house)}`;
    const label = l => `For ${l.to.fae ? "the Post-Warden, in the Gentry's Grounds" : `${l.to.name}, ${l.to.realm === realm ? `here at ${name}` : placeLine(l.to)}`}. From ${l.from.name}${fromWhere(l)}.`;
    nodes.root = () => {
      const n = box.letters.length, c = box.letters.map(l => ({ label: label(l), run: () => { full = !takeOne(l); } }));
      if (n > 1) c.push({ label: 'Take them all.', run: () => { full = false; for (const l of [...box.letters]) if (!takeOne(l)){ full = true; break; } } });
      const inside = !n ? 'Nothing in it.' : n === 1 ? 'One letter, stamped and sealed.' : `${n === 2 ? 'Two' : 'Three'} letters, stamped and sealed.`;
      return { text: `${inside}${full ? ' You have no room in your pack.' : ''}`, choices: c };
    };
    return { speaker: `The ${name} mailbox`, portrait: null, root: 'root', farewell: 'Shut the box.', nodes: resolve(nodes) };
  }

  // ---- the dead (js/kin.js, docs/skeletons.md): they lie in named tombs, and take letters from Faerie alone ----
  let kinOf = null;
  // (not kept until the folk are in: the book lays itself out before they are, and they'd be left out of every tree)
  const kin = () => { if (kinOf) return kinOf; const k = makeKin({ seed: w.seed, crypts, living: w.npcs().filter(n => n.surname && n.name), surnames: humanSurnames() }); if (w.npcs().length) kinOf = k; return k; };
  const known = new Set();           // the people you've read of, by kin id
  const placed = new Set();          // of the dead, those whose tomb you've found
  const wrote = new Set();           // the dead the Warden has written to
  const tombsOf = L => L.tombs ||= tombOrder(L.props.filter(p => p.kind === 'coffin'), L.id, L.finds);
  const inTomb = (L, p) => kin().inTomb(L.id, tombsOf(L).indexOf(p));
  const letterAt = (L, p) => { const q = inTomb(L, p); return q ? carried().find(l => l.to.dead && l.to.tomb === q.id) || null : null; };
  // what the tomb says; the name goes in your book, and so does the parent it names
  function readTomb(L, p){
    const q = inTomb(L, p);
    if (!q) return 'The name on this tomb has worn away.';
    known.add(q.id); placed.add(q.id); if (q.parent) known.add(q.parent);
    w.refreshBook();
    return `Cut into the slab: ${kin().epitaph(q)}`;
  }
  // the next of the dead with a tomb a slab can slide off. Builds their crypt to find out (levels are kept, so that's once)
  function nextDead(){
    const k = w.seed >>> 0, dead = kin().dead().filter(q => !wrote.has(q.id));
    dead.sort((a, b) => (Math.imul(a.slot + 7, 40503) ^ Math.imul(a.crypt + k, 2654435761)) - (Math.imul(b.slot + 7, 40503) ^ Math.imul(b.crypt + k, 2654435761)));
    for (const q of dead){
      const L = w.level(q.crypt), p = tombsOf(L)[q.slot];
      if (p && lidBare(p, L.finds)) return q;
    }
    return null;
  }
  function letterToDead(q){
    const c = crypts.find(x => x.id === q.crypt), t = w.now();
    const to = { id: q.id, name: q.name, realm: `crypt${c.id}`, x: c.x, z: c.z, dead: true, tomb: q.id, cryptName: c.name };
    const letter = post.send({ from: WARDEN, to, weight: 1, door: doorFrom(to), seal: { material: 'wax', mark: 'W', art: 'faerie' }, postmark: stampMark('faerie', t), t, body: '' });
    if (!letter) return null;
    wrote.add(q.id);
    letter.toLines = [q.name, `in ${c.name}`]; letter.fromLine = "the Gentry's Post";
    return letter;
  }
  // the bones stand by their tomb with it in their hand: the same offer as anyone's, without the words
  function tombTree(letter){
    const q = kin().people.get(letter.to.tomb);
    known.add(q.id); placed.add(q.id); if (q.parent) known.add(q.parent);
    hand(letter, null);
    const nodes = {
      root: { text: `It takes the envelope in its fingers, and holds it to where its eyes were. It does not break the seal. Its jaw works, with no sound at all, and it turns the envelope and holds it out to you, a finger on the stamps.`,
        choices: [{ label: "I'd like that.", next: 'lifted', run: () => lookAt(letter, { lift: true }) }, { label: 'No, keep it.', next: 'kept' }] },
      lifted: { text: 'It waits, and draws the envelope back.' },
      kept: { text: 'It draws the envelope back.' },
    };
    return { speaker: q.name, portrait: null, root: 'root', farewell: 'Step back.', nodes: resolve(nodes) };
  }
  // the GENEALOGICAL cheat: everyone in every lineage, the living too
  const learnKin = () => { for (const q of kin().people.values()){ known.add(q.id); if (q.dead) placed.add(q.id); } w.refreshBook(); return kin().lineages.length; };
  // the people you know of, a tree to a lineage, in the shape bub-lineage draws. A lineage shows once you've read one of its dead
  const knows = p => known.has(p.id) || (!p.dead && !!p.npc?.known);
  const kinTrees = () => kinOf ? kin().lineages.filter(L => L.people.some(p => p.dead && known.has(p.id))).map(L => ({ surname: L.surname, data: kin().tree(L.id, knows) })) : [];

  // Everyone you know of: those in the trees, and those you've met who aren't. id: a kin id, or n<id> for the living
  const peopleKnown = () => {
    if (!kinOf && !w.npcs().length) return [];
    const tree = kin(), out = [...tree.people.values()].filter(knows);
    for (const n of w.npcs()) if (n.known && n.name && !tree.people.has(`n${n.id}`)) out.push({ id: `n${n.id}`, name: n.name, dead: false, npc: n, kids: [] });
    return out;
  };
  // what's on their page: only what you've really come to know, and what you have to do with them
  function personRecord(q){
    const tree = kin(), n = q.npc, shown = kinTrees().some(t => t.surname === q.surname), facts = [], people = [];
    if (q.dead){
      const c = crypts.find(x => x.id === q.crypt);
      facts.push(placed.has(q.id) ? `Lies in ${c.name}.` : "Where they lie, I don't know.");
      if (placed.has(q.id)) facts.push(`The tomb says: ${tree.epitaph(q)}`);
    } else {
      if (n.home) facts.push(`Lives at ${w.villageOf(n.home)}.`); else facts.push('One of the folk, with no house of their own.');
      if (n.group?.name) facts.push(`Of ${n.group.name}.`);
      if (n.known){
        if (n.postRider) facts.push('Carries the post.');
        if (n.stargazer) facts.push('Reads the stars.');
        const r = w.regardOfMe(n);
        if (r > 0.25) facts.push('Thinks well of me.'); else if (r < -0.15) facts.push('Has no time for me.');
      }
      if (n.home && distrust.has(n.home)) facts.push('Knows I open letters.');
    }
    const named = id => { const p = tree.people.get(id); return p && knows(p) ? p : null; };
    const CHILD = { female: 'Daughter', male: 'Son' };
    const up = q.parent && named(q.parent);
    if (up) people.push({ rel: q.dead ? 'Child of' : 'Descends from', id: up.id, name: up.name });
    for (const id of q.kids || []){ const k = named(id); if (k) people.push({ rel: k.dead ? (CHILD[k.sex] || 'Child') : 'Descendant', id: k.id, name: k.name }); }
    const pid = q.dead ? q.id : n?.id;
    const mine = l => l.from.id === pid || l.to.id === pid;
    const quests = w.journal.tasks().map(t => t.text).filter(t => t.includes(q.name));
    const done = [...handed].filter(mine).map(l => l.to.id === pid ? `I brought them a letter from ${l.from.name}.` : `I took their letter to ${l.to.name}.`);
    const stamps = album.filter(a => a.from === q.name || a.to === q.name).length;
    if (stamps) done.push(`${stamps === 1 ? 'A stamp' : `${stamps} stamps`} in my book came off their post.`);
    return { id: q.id, name: q.name, dead: !!q.dead, face: n?.portrait || null, faceBg: n?.group?.id != null ? w.markBackdrop(n.group.id) : null, line: shown ? q.surname : null, facts, people, quests, done };
  }
  // known names in an escaped sentence, as links to their pages
  function linkNames(html){
    const ps = peopleKnown().sort((a, b) => b.name.length - a.name.length);
    if (!ps.length) return html;
    const byName = new Map(ps.map(p => [p.name, p.id]));
    const re = new RegExp(`(?<![\\w>])(${ps.map(p => p.name.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')).join('|')})(?!\\w)`, 'g');
    return html.replace(re, m => `<a class="person-link" data-goto="${byName.get(m)}">${m}</a>`);
  }

  // ---- the Post-Warden, in the Gentry's Grounds ----
  function wardenTree(){
    const nodes = {};
    const forMe = () => carried().filter(l => l.to.fae);
    const writeTo = n => {
      const to = person(n), t = w.now();
      const letter = post.send({ from: WARDEN, to, weight: 1, door: doorFrom(to), seal: { material: 'wax', mark: 'W', art: 'faerie' }, postmark: stampMark('faerie', t), t,
        body: `${to.name}:\n\nYour letter was received. It was read.\n\nWe keep what we are sent. Write again, if you have more to say.\n\nThe Post-Warden, for the Gentry` });
      if (!letter) return null;
      letter.toLines = [to.name, `at ${w.villageOf(to.house)}`]; letter.fromLine = "the Gentry's Post";
      return letter;
    };
    let gave = null, reply = null;
    nodes.root = () => {
      const c = [];
      for (const l of forMe()) c.push({ label: `A letter, from ${l.from.name}.`, next: 'gave', run: () => {
        const r = hand(l, null); gave = { r, l };
        reply = r.whole && l.from.npc ? writeTo(l.from.npc) : null;
      } });
      if (!forMe().length && !carried().some(l => l.to.dead)) c.push({ label: 'Is there anything that wants carrying?', next: 'outbound', run: () => {
        const all = w.houses().flatMap(h => h.household), pick = all.find(n => n.stargazer) || all[0];
        wardenHeld ||= (!wardenWrote && pick && writeTo(pick)) || (() => { const q = nextDead(); return q && letterToDead(q); })();
      } });
      return { text: 'A tall one, in grey, at a tall desk by the water. It doesn\'t look up. "The post. Letters in, letters out."', choices: c };
    };
    nodes.gave = () => {
      if (!gave) return { text: '' };
      const { r, l } = gave;
      if (!r.whole) return { text: 'It looks at the seal, and then, for the first time, at you. "This has been opened. We know who did it." It puts the letter away, unread.' };
      return { text: `It breaks the seal with a nail, reads, and nods. "${reply ? `There'll be an answer. Take it to ${l.from.name}.` : "There's no answer."}" It turns the envelope round and pushes it across. "One stamp. Yours."`,
        choices: reply ? [{ label: "I'll take it.", next: 'took', run: () => { take(reply, 'the Post-Warden'); lookAt(l, { lift: true }); } }] : [{ label: 'Thank you.', next: 'tookStamp', run: () => lookAt(l, { lift: true }) }] };
    };
    nodes.outbound = () => {
      const letter = wardenHeld;
      if (!letter) return { text: '"No. Not today."' };
      return { text: `"There is." It lays it on the desk: wax, and a stamp that catches the light. "For ${letter.to.name}, ${placeLine(letter.to)}. Paid."${letter.to.dead ? ' "It is not for reading."' : ''}`,
        choices: [{ label: "I'll take it.", next: 'took', run: () => { if (take(letter, 'the Post-Warden')){ if (!letter.to.dead) wardenWrote = true; wardenHeld = null; } } }, { label: 'Not now.', next: null }] };
    };
    nodes.tookStamp = { text: '"Go carefully."' };
    nodes.took = { text: '"Go carefully. Your door shuts at first light."' };
    return { speaker: 'The Post-Warden', portrait: null, root: 'root', farewell: 'Step away.', nodes: resolve(nodes) };
  }
  // the talk reads nodes as plain objects or getters: functions become getters, so they read live
  function resolve(nodes){
    const out = {};
    for (const k of Object.keys(nodes)){
      const d = Object.getOwnPropertyDescriptor(nodes, k);
      if (d.get) Object.defineProperty(out, k, { enumerable: true, get: d.get });
      else if (typeof d.value === 'function') Object.defineProperty(out, k, { enumerable: true, get: d.value });
      else if (!k.startsWith('_')) out[k] = d.value;
    }
    return out;
  }

  // ---- looking at an envelope ----
  function lookAt(letter, { lift = false } = {}){
    ensureCss();
    const ov = el('div', 'post-overlay'), box = el('div', 'post-box'), canvas = el('canvas', 'post-env'), cap = el('div', 'post-cap'), acts = el('div', 'post-acts'), read = el('div', 'post-read');
    const paid = post.paid(letter).map(q => `${post.realm(q.realm).name} ${q.paid}${post.realm(q.realm).kind === 'faerie' ? '' : 'd'}`).join(' and ');
    cap.textContent = lift ? 'Press on a stamp and pull it off. Just the one.' : `${letter.toLines?.join(', ') || letter.to.name}. Paid: ${paid}. ${letter.weight} oz.`;
    const shut = el('button', 'post-btn', lift ? 'Leave them' : 'Put it away'), turn = el('button', 'post-btn', 'Turn it over'), crack = el('button', 'post-btn', 'Break the seal');
    if (!lift){ acts.append(turn); if (letter.seal?.whole && !letter.to.dead) acts.append(crack); }    // (the dead's letters don't open: they've nothing written in them yet)
    acts.append(shut);
    if (!lift && letter.seal && !letter.seal.whole) showBody();
    // lifting: the canvas covers the screen, so the stamp isn't cut off at the envelope's edge; the slot
    // holds the envelope's place in the layout
    const slot = lift ? el('div', 'post-env post-slot') : null;
    if (lift) canvas.classList.add('post-full');
    box.append(...(slot ? [slot] : []), canvas, cap, read, acts); ov.append(box); document.body.append(ov);
    pinX(closeX(() => close()), box, ov);
    let scene = null, armed = false, gone = false;
    envelopeScene(canvas, letter, { slot }).then(s => {
      if (gone){ s.stop(); return; }
      scene = s;
      if (lift){ document.body.classList.add('post-lifting'); s.allowLift((stamp, cancel, from, hide) => toBook(stamp, cancel, from, hide, letter).then(close)); }
    }).catch(e => console.warn('envelope:', e));
    function showBody(){ read.textContent = letter.body || 'Nothing written.'; read.classList.add('on'); }
    turn.onclick = () => scene?.flip();
    crack.onclick = () => {                         // it can't be undone: arm first
      if (!armed){ armed = true; crack.textContent = "It can't be mended. Break it?"; crack.classList.add('armed'); return; }
      post.breakSeal(letter); scene?.refreshSeal?.(); crack.remove(); showBody();
      w.jot('broke the seal on', `a letter for ${letter.to.name}`);
    };
    crack.onpointerleave = () => { if (armed){ armed = false; crack.textContent = 'Break the seal'; crack.classList.remove('armed'); } };
    const close = () => { gone = true; scene?.stop(); ov.remove(); document.body.classList.remove('post-lifting'); removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape' || e.code === 'KeyI'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    addEventListener('keydown', onKey, true);
    shut.onclick = close;
  }
  // the lifted stamp flies to your book by the map, and is in it when it lands
  async function toBook(stamp, cancel, from, hide, letter){
    const url = await bakeStamp(stamp, 360, cancel);
    const im = el('img', 'post-flying'); im.src = url; im.draggable = false;
    const w0 = Math.max(40, from.width), h0 = w0 * 4 / 3;
    im.style.cssText = `left:${from.x - w0 / 2}px;top:${from.y - h0 / 2}px;width:${w0}px;height:${h0}px`;
    document.body.append(im); hide();
    const icon = document.querySelector('.book-icon'), r = icon?.getBoundingClientRect();
    const to = r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2, s: Math.max(.16, Math.min(r.height, 50) / h0 * .7) } : { x: innerWidth - 60, y: innerHeight - 60, s: .2 };
    await new Promise(ok => {
      requestAnimationFrame(() => { im.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.s}) rotate(-6deg)`; im.style.opacity = '.92'; });
      setTimeout(ok, 620);
    });
    im.remove();
    await keep(stamp, letter, cancel, url);
    if (icon){ icon.classList.add('post-got'); setTimeout(() => icon.classList.remove('post-got'), 500); }
    w.setMsg?.(`A stamp for your book: ${stamp.realmName}, ${stamp.value}${stamp.kind === 'faerie' ? '' : 'd'}.`);
  }
  // a stamp under the loupe, from the album
  function loupe(rec){
    ensureCss();
    const ov = el('div', 'post-overlay'), box = el('div', 'post-box post-loupe'), canvas = el('canvas', 'post-stamp');
    const m = materialOf(rec.stamp.design);
    box.append(canvas, el('div', 'post-cap', `${rec.stamp.realmName}, ${rec.stamp.value}${rec.stamp.kind === 'faerie' ? '' : 'd'}${m ? `, ${m}` : ''}. No. ${rec.stamp.copy} of ${post.issues.get(rec.stamp.issue).printed}. Posted ${rec.postmark?.date || ''} by ${rec.from}.`));
    ov.append(box); document.body.append(ov);
    pinX(closeX(() => close()), box, ov);
    let scene = null, gone = false;
    stampScene(canvas, rec.stamp, rec.cancel).then(s => { if (gone) s.stop(); else scene = s; });
    const close = () => { gone = true; scene?.stop(); ov.remove(); removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape'){ e.stopImmediatePropagation(); e.preventDefault(); close(); } };
    addEventListener('keydown', onKey, true);
  }

  return { kin, learnKin, peopleKnown, personRecord, linkNames, readTomb, letterAt, tombTree, kinTrees, post, album, talk, wardenTree, boxTree, population, boxes: mailboxes.boxes, folk: mailboxes, fromAfar: letterFromAfar, resolve, lookAt, loupe,
    letterIn: box => post.letters.get(box.lots[0]?.prov?.mail) || null,
    says: l => `A letter for ${l.to.fae ? 'the Post-Warden' : `${l.to.name}, ${placeLine(l.to)}`}, from ${l.from.name}.${l.seal && !l.seal.whole ? ' The seal is broken.' : ''} ${w.touch ? 'Double-tap' : 'Right-click'} to look at it.` };
}
