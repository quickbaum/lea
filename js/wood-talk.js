// wood-talk.js — what a tree says, and what the fungus says back.
//
// Built on mycelium.js the way main.js's peasantTree() is built on agents.js: the
// dialogue reads live state and phrases it. Nothing here invents facts; every line
// is a rendering of something the node actually holds.
//
// The voice rules come out of what a plant can actually sense, and they are the
// point of the whole feature — Tolkien's RECOVERY ("regaining of a clear view")
// works by describing a world you know through senses you do not have:
//
//   - NO SIGHT. Never "a man in a green cloak." A person is a warmth, a shadow, a
//     weight on the roots, ground gone hard that no longer drinks.
//   - NO NAMES, NO FACES, NO COUNTING PEOPLE. Kinds, not individuals.
//   - LOCATION IS IDENTITY. It cannot leave, so everything first-hand is "here",
//     and everything else is bought.
//   - TIME IS WRONG. Days are "lights", winter is "the cold", and the player's
//     whole visit is an instant it may not bother to mark.
//
// TWO REGISTERS over the same facts:
//   - treeVoice()      — the sense-only wood. You EXAMINE it; its state rises into
//                        you as second-person sensation. It does not speak.
//   - facedTreeVoice() — the few carved, faced trees (js/tree-faces.js). These
//                        actually SPEAK, in first person — same real state, no
//                        invented backstory. The helpers below take a `self` flag
//                        to switch "it/its" → "me/my".
//
// The fungus is the opposite in every respect, and its voice should read as a
// deliberate shock after the trees: brisk, worldly, mercantile, first-person,
// and entirely uninterested in being loved. It is a broker, not a mother.

import { SIGNALS } from './mycelium.js';

// ------------------------------------------------------------- vocabulary ---

const SPECIES_WORD = {
  oak: 'oak', birch: 'birch', redwood: 'redwood', maple: 'maple', rowan: 'rowan', pine: 'pine',
};
const speciesWord = base => SPECIES_WORD[base] || base;

// A tree's clock. It has no hours; it has light and dark, and the cold.
function ago(days){
  if (days < 0.5)  return 'this light';
  if (days < 1.5)  return 'a light back';
  if (days < 3.5)  return `${Math.round(days)} lights back`;
  if (days < 7)    return 'many lights back';
  return 'before the cold';
}

// Direction as a rooted thing knows it: by gravity, and by whether the ground
// there drinks. No compass — a tree has no use for one.
function where(node, f, ctx){
  const dh = ctx.height(f.x, f.z) - ctx.height(node.x, node.z);
  const d  = Math.hypot(f.x - node.x, f.z - node.z);
  const slope = dh > 1.6 ? 'up-slope' : dh < -1.6 ? 'down-slope' : 'on the level';
  const near  = d < 12 ? 'close' : d < 34 ? 'a way off' : 'far off';
  return `${near}, ${slope}`;
}

const wetWord = s => (s > 0.66 ? 'in wet ground' : s < 0.3 ? 'in dry ground' : '');

// --------------------------------------------------------------- phrasing ---

// The core of the feature: the SAME fact reads differently depending on how far it
// travelled to get here. Distance costs specificity before it costs strength, so a
// thing five hops away has lost its place and kept only its mood.
function tell(node, f, ctx, self = false){
  const when = ago(ctx.now - f.t);
  const lag  = f.at - f.t;
  const late = lag > 0.9 ? ` Reached ${self ? 'me' : 'it'} ${Math.max(1, Math.round(lag))} lights on.` : '';

  if (f.hops >= 5){                                   // mood only
    const mood = {
      tread: 'Ground pressed hard, somewhere. Often.',
      wound: 'Something opened. Not near.',
      fire:  'Something burned, far off. The threads still taste of ash.',
      mast:  'A fullness, everywhere at once — no telling where it began.',
      quicken: 'A sweetness in the soil, too far to reach.',
    }[f.kind];
    return mood || 'Something, too far to name.';
  }

  const place = f.hops === 0 ? 'here' : where(node, f, ctx);
  const wet   = f.hops <= 2 ? wetWord(ctx.soil(f.x, f.z)) : '';
  const at    = [place, wet].filter(Boolean).join(', ');

  switch (f.kind){
    case 'tread':
      return f.hops === 0
        ? `Feet, ${when} — the same weight, again and again, till the ground here went hard and stopped drinking.`
        : `Feet, ${at} — many, over and over.${late}`;
    case 'wound':
      return f.hops === 0
        ? `Something cut, ${when}, close enough to taste. Green opened, then stopped.`
        : `Green torn open, ${at}, ${when}.${late}`;
    case 'fire':
      return f.hops === 0
        ? `Heat, ${when}, near — not the sun's, the kind that leaves ash.`
        : `A burning, ${at}, ${when}.${late}`;
    case 'mast':
      return `The ${speciesWord(f.what)}, fruiting — all at once, ${when}. Nothing told them to.`;
    case 'quicken':
      return `Richness in the soil, ${at}, ${when}. Something ended there.${late}`;
    default:
      return `Something, ${at}, ${when}.`;
  }
}

// ------------------------------------------------------------ any tree -------

const nameFor = node => {
  const w = speciesWord(node.base);
  return node.scale > 1.25 ? `The great ${w}` : node.scale < 0.8 ? `A young ${w}` : `The ${w}`;
};

// How a rooted thing places another tree it can feel through its own roots: by
// gravity (up/down-slope), by how far, and by whether their roots actually touch.
// No compass — but slope + distance + species + size is enough to pick the tree
// out by eye and walk to it, which is the whole point: the player VERIFIES.
function placeNeighbour(node, other, ctx, self = false){
  const dh = ctx.height(other.x, other.z) - ctx.height(node.x, node.z);
  const d  = Math.hypot(other.x - node.x, other.z - node.z);
  const slope = dh > 1.2 ? 'up-slope' : dh < -1.2 ? 'down-slope' : 'level';
  // a finer ladder than the fact-locator's, so near neighbours read distinctly
  // enough for the player to tell them apart on the ground
  const with_ = self ? 'me' : 'it';
  const near  = d < 3 ? `roots tangled close in with ${with_}` : d < 5 ? `root to root with ${with_}`
              : d < 8 ? 'close by' : d < 12 ? 'a few lengths off' : 'a little apart';
  const r = other.scale / node.scale;
  const age = r > 1.3 ? 'a great old' : r > 1.08 ? 'an older' : r < 0.75 ? 'a young' : r < 0.94 ? 'a smaller' : 'another';
  return `${age} ${speciesWord(other.base)}, ${slope}, ${near}`;
}

// What you sense of a tree's condition, phrased through the neighbour that CAUSES
// it — so the hunger for light comes with the thing standing in the way, which you
// can go and lay a hand on yourself. Sensation, not statement.
function bodyLine(node, ctx, self = false){
  const bits = [];
  const it = self ? 'me' : 'it', its = self ? 'my' : 'its', I = self ? 'I' : 'it';
  // who takes its light: a bigger tree standing close
  const shader = node.links.map(l => l.to)
    .filter(o => o.scale > node.scale * 1.05 && Math.hypot(o.x - node.x, o.z - node.z) < 10)
    .sort((a, b) => Math.hypot(a.x - node.x, a.z - node.z) - Math.hypot(b.x - node.x, b.z - node.z))[0];
  if (node.light > 0.7)      bits.push(`Light in plenty — nothing large stands over ${it}.`);
  else if (shader)           bits.push(`A hunger for light. ${placeNeighbour(node, shader, ctx, self)} takes the morning; ${self ? 'I live' : 'this one lives'} on what falls past.`);
  else if (node.light > 0.38) bits.push(`Something crosses ${its} light part of each day. Borne.`);
  else                        bits.push('Deep shade — too much, too close to feel by what.');

  bits.push(node.water > 0.66 ? ` ${self ? 'My roots' : 'Roots'} in wet ground; never a reach for water.`
          : node.water > 0.34 ? ` ${self ? 'My roots' : 'Roots'} reach a little, find enough.`
          :                     ` ${self ? 'My roots' : 'Roots'} strain through dry ground for little — so little reaches ${it} through the threads. ${I} cannot pay.`);
  if (node.scale > 1.2) bits.push(' And age, underneath: a long while standing.');
  if (node.hurt > 0.05) bits.push(' A fresh hurt, still closing.');
  return bits.join('');
}

// treeVoice(node, ctx) — ctx: { myc, now, height, soil, rain, night }
// You are not being TALKED to. You lay a hand on the tree and its state rises into
// you as sensation — the magic is the interface. Second person, impressions not
// statements; the tree is the thing examined, never the speaker. What you can feel
// varies with where the tree stands and what the wood is doing, and every spatial
// impression is verifiable: the neighbours you sense are really there.
export function treeVoice(node, ctx){
  const heard  = () => ctx.myc.heard(node);
  const back   = { label: 'Turn your attention elsewhere.', next: 'listen' };  // suppresses the generic "ask about something else"

  return {
    speaker: nameFor(node),
    portrait: null,
    root: 'listen',
    farewell: 'Take your hand from the bark.',
    nodes: {
      // the first wash of sensation on touching it — differs tree to tree from
      // live state alone, so no two feel the same
      get listen(){
        const news = heard();
        const opening =
            node.hurt > 0.05   ? 'Bark split under your palm — a fresh wound, still weeping.'
          : !node.links.length ? 'You reach in and it is alone. Nothing answers from the soil around it.'
          : ctx.night > 0.5    ? 'Slowed almost to sleep. What you feel comes dim and far between.'
          : ctx.rain > 0.15    ? 'It is drinking. Every tree near it drinks at once — no threads needed for that.'
          : node.light < 0.35  ? 'You feel the reaching first — upward, toward a light that never quite comes.'
          : news.length        ? 'Something is moving underground the moment you touch it. Word, travelling. This tree is on its road.'
          : node.reach > 2.2   ? 'Knotted deep into the wood — many others pulling through its roots, close, trading.'
          :                      'The sense of the tree rises slowly into your hand. Patient. Rooted. In no hurry.';
        const c = [{ label: 'Sense what it wants.', next: 'body' }];
        if (node.links.length) c.push({ label: 'Feel what stands near it.', next: 'neighbours' });
        if (news.length)       c.push({ label: 'Reach into the threads.', next: 'wood' });
        c.push({ label: 'Follow the roots down.', next: 'threads' });
        c.push({ label: 'Feel how it senses you.', next: 'me' });
        return { text: opening, choices: c };
      },

      get body(){
        const c = [];
        if (node.links.length) c.push({ label: 'Feel what stands near it.', next: 'neighbours' });
        c.push(back);
        return { text: bodyLine(node, ctx), choices: c };
      },

      // THE node the design turns on. You sense the linked trees by where they
      // stand — up-slope, close, older — then go and find each one exactly there,
      // and feel the same wood from its side. That corroboration IS the network,
      // felt rather than asserted.
      get neighbours(){
        const ls = [...node.links]
          .sort((a, b) => Math.hypot(a.to.x - node.x, a.to.z - node.z) - Math.hypot(b.to.x - node.x, b.to.z - node.z))
          .slice(0, 4);
        if (!ls.length) return { text: 'You feel out along the roots and nothing answers. What grows near is not its kind, and the threads will not cross to a stranger.', choices: [back] };
        // group neighbours it can't tell apart (similar trees at a similar remove):
        // you feel "several of a kind close", not four identical impressions
        const groups = [];
        for (const l of ls){
          const place = placeNeighbour(node, l.to, ctx);
          const g = groups.find(x => x.place === place);
          if (g){ g.n++; g.weak = g.weak && l.w < 0.3; } else groups.push({ place, n: 1, weak: l.w < 0.3 });
        }
        const lines = groups.map(g => {
          const weak = g.weak ? ' — faint' : '';   // poor ground between; explained once below
          return g.n > 1 ? `— ${g.n} of a kind: ${g.place}${weak}.` : `— ${g.place}${weak}.`;
        });
        const faint = groups.some(g => g.weak) ? ' The faint ones sit across poor ground; little carries.' : '';
        const off = node.guild === 'ecto' ? 'maples and rowans' : 'oaks and birches';
        return { text:
          `You feel out along the roots. Others answer — its own kind, only its own:\n\n${lines.join('\n')}\n\n`
        + `They are really there.${faint} Lay a hand on one and feel the same wood from its side.\n\n`
        + `The ${off} nearby you cannot reach through this tree — different threads.`,
          choices: [back] };
      },

      // what the threads are carrying — arriving as impression, with the pointer
      // that leads you upstream toward where a thing actually happened
      get wood(){
        const fs = heard();
        if (!fs.length) return { text: 'Only slow things moving — the pull for light, the wet rising. Nothing has passed lately.', choices: [back] };
        const seen = new Set(), lines = [];
        for (const f of fs){
          const line = tell(node, f, ctx);
          if (seen.has(line)) continue;
          seen.add(line); lines.push(line);
          if (lines.length >= 3) break;
        }
        const top = fs[0];
        const nearer = top && top.hops > 0 ? ctx.myc.nearerSource(node, top) : null;
        if (nearer){
          const place = placeNeighbour(node, nearer.node, ctx).split(', ').slice(1).join(', ');
          lines.push(`The ${speciesWord(nearer.node.base)} — ${place} — holds it clearer; it stood nearer. Follow it back to find where.`);
        }
        return { text: 'You reach into the threads:\n\n' + lines.join('\n\n'), choices: [back] };
      },

      get threads(){
        if (!node.links.length) return { text:
          'The roots go down and simply end. The ground around is dry; nothing of the threads will cross it.', choices: [back] };
        const guild = node.guild === 'ecto'
          ? 'pale threads sheathing every root-tip'
          : 'pale threads laced inside the roots themselves';
        const price = ctx.rain > 0.2
          ? 'Cheap trade just now — the rain has left nothing to bargain over.'
          : node.vigor > 0.6
            ? 'It pays well, rich in light, so word comes from far off.'
            : 'It pays little, so little comes — only what is close.';
        return {
          text: `Down past where roots should end, they tangle in something finer that is not the tree — ${guild}. `
              + `A bargain, old and constant: sugar down, water and word back up. ${price}`,
          choices: [{ label: 'Reach for its tenderness.', next: 'mother' },
                    { label: 'Feel who else is on the threads.', next: 'neighbours' }, back],
        };
      },

      // The Karst/Jones/Cahill correction, felt rather than told. The popular story
      // is that the network is maternal; there is no evidence for it, and sensing
      // its absence is both truer and better drama.
      get mother(){ return { text:
        'You reach for something like care and find none. The threads take and give and take, and go where the trade is best — feeding this tree one season, robbing it the next. You cannot even tell which they are doing now.\n\n'
      + 'Not a mother. A market, under the whole wood.', choices: [back] }; },

      get me(){ return { text:
        'You feel yourself as the tree does: a warmth that should not move, a shadow with weight, a pressure on the roots that keeps returning to the same lines. '
      + 'To it you are the thing that makes the paths. It has no idea what you look like — no idea what anything looks like.', choices: [back] }; },
    },
  };
}

// ---------------------------------------------------------- the faced trees --

// facedTreeVoice(node, ctx) — the few carved trees that actually SPEAK, in first
// person, where the rest of the wood is only felt. Same real state, same helpers
// (with self=true) — nothing invented, no backstory. It knows it is rooted and
// feels things; it does not know what you are or why you have come. See
// docs/mycelium.md §4 and js/tree-faces.js (the carved face + waking eyes).
export function facedTreeVoice(node, ctx){
  const heard = () => ctx.myc.heard(node);
  const back  = { label: 'Ask it something else.', next: 'wake' };

  return {
    speaker: nameFor(node),
    portrait: null,
    root: 'wake',
    farewell: 'Leave it to its light.',
    nodes: {
      get wake(){
        const news = heard();
        const opening =
            node.hurt > 0.05   ? 'I am opened — a fresh wound, still weeping. You are shaped like the thing that did it, only smaller.'
          : !node.links.length ? 'I stand apart. Nothing of mine is joined to me here; the ground between is wrong for it.'
          : ctx.night > 0.5    ? 'It is dark, and I am slow. Ask me plainly, and I will answer if I can.'
          : ctx.rain > 0.15    ? 'I am drinking. Every tree near me drinks at once — that much needs no threads.'
          : node.light < 0.35  ? 'I reach, always, for a light that never quite comes. Something stands over me.'
          : news.length        ? 'Word is moving in the threads as you touch me. I sit on its road.'
          : node.reach > 2.2   ? 'I am knotted deep in the wood — many others pull at my roots, close, trading in the dark.'
          :                      'You have found my face. Few come round to this side. Ask, then — I am in no hurry.';
        const c = [{ label: 'What are you?', next: 'body' }];
        if (node.links.length) c.push({ label: 'What stands near you?', next: 'kin' });
        if (news.length)       c.push({ label: 'What moves in the threads?', next: 'news' });
        c.push({ label: 'What carries it to you?', next: 'threads' });
        c.push({ label: 'What am I, to you?', next: 'me' });
        return { text: opening, choices: c };
      },

      get body(){
        const c = [];
        if (node.links.length) c.push({ label: 'What stands near you?', next: 'kin' });
        c.push(back);
        return { text: bodyLine(node, ctx, true), choices: c };
      },

      get kin(){
        const ls = [...node.links]
          .sort((a, b) => Math.hypot(a.to.x - node.x, a.to.z - node.z) - Math.hypot(b.to.x - node.x, b.to.z - node.z))
          .slice(0, 4);
        if (!ls.length) return { text: 'None. What grows near me is not my kind, and the threads will not cross to a stranger.', choices: [back] };
        const groups = [];
        for (const l of ls){
          const place = placeNeighbour(node, l.to, ctx, true);
          const g = groups.find(x => x.place === place);
          if (g){ g.n++; g.weak = g.weak && l.w < 0.3; } else groups.push({ place, n: 1, weak: l.w < 0.3 });
        }
        const lines = groups.map(g => {
          const weak = g.weak ? ' — faint' : '';
          return g.n > 1 ? `— ${g.n} of a kind: ${g.place}${weak}.` : `— ${g.place}${weak}.`;
        });
        const faint = groups.some(g => g.weak) ? ' The faint ones sit across poor ground; little carries.' : '';
        const off = node.guild === 'ecto' ? 'maples and rowans' : 'oaks and birches';
        return { text:
          `My own kind answer through the threads, and only mine:\n\n${lines.join('\n')}\n\n`
        + `They stand where I say.${faint} Go round to one and it will feel the same wood from its side — not mine.\n\n`
        + `The ${off} nearby I cannot reach at all. Different threads.`,
          choices: [back] };
      },

      get news(){
        const fs = heard();
        if (!fs.length) return { text: 'Only slow things — the pull for light, the wet rising. Nothing has passed lately.', choices: [back] };
        const seen = new Set(), lines = [];
        for (const f of fs){
          const line = tell(node, f, ctx, true);
          if (seen.has(line)) continue;
          seen.add(line); lines.push(line);
          if (lines.length >= 3) break;
        }
        const top = fs[0];
        const nearer = top && top.hops > 0 ? ctx.myc.nearerSource(node, top) : null;
        if (nearer){
          const place = placeNeighbour(node, nearer.node, ctx, true).split(', ').slice(1).join(', ');
          lines.push(`The ${speciesWord(nearer.node.base)} — ${place} — held it before me; it stood nearer. Follow it back to find where.`);
        }
        return { text: lines.join('\n\n'), choices: [back] };
      },

      get threads(){
        const guild = node.guild === 'ecto'
          ? 'pale threads sheathe my every root-tip'
          : 'pale threads run inside my roots themselves';
        const price = ctx.rain > 0.2
          ? 'Cheap trade just now — the rain has left nothing to bargain over.'
          : node.vigor > 0.6
            ? 'I pay well, rich in light, so word comes to me from far off.'
            : 'I pay little, so little comes — only what is close.';
        return {
          text: `Below, where my roots should end, ${guild} — not mine, and never gone. A bargain, old and constant: my sugar down, water and word back up. ${price}`,
          choices: [{ label: 'Do they care for you?', next: 'mother' }, back],
        };
      },

      get mother(){ return { text:
        'You want them to love me. They do not. They take my sugar and carry it where the trade runs best — feeding me one season, robbing me the next, and I cannot tell you which they do now.\n\n'
      + 'Not a mother. A market, under the whole wood.', choices: [back] }; },

      get me(){ return { text:
        'You? A warmth that should not move, a weight on my roots that keeps returning to the same lines. You are the thing that makes the paths. '
      + 'I do not know what you look like. I do not know what anything looks like.', choices: [back] }; },
    },
  };
}

// ------------------------------------------------------------- the fungus ----

// Only strong rings get a voice (main.js decides which, from Mycelium.strengthAt).
// ringTree(node, ctx, { onTake, clover }) — taking the caps ends the conversation,
// which is the honest outcome: the fruiting body is the mouth. `clover()` searches the
// grass inside the ring (main.js: a four-leaf one at first light) and says what you found.
export function ringTree(node, ctx, opts = {}){
  const heardAround = () => {
    // The fungus is not stuck in one place, so it knows everything its whole
    // neighbourhood holds — which is strictly more than any single tree.
    const seen = new Map();
    const around = [node, ...node.links.map(l => l.to)];
    for (const n of around) for (const f of n.news.values()){
      const ex = seen.get(f.key);
      if (!ex || f.mag > ex.mag) seen.set(f.key, f);
    }
    return [...seen.values()].sort((a, b) => b.mag - a.mag);
  };

  let found = null;   // what the last look in the clover turned up
  return {
    speaker: 'The ring',
    portrait: null,
    root: 'ring',
    farewell: 'Leave it to its business.',
    nodes: {
      get ring(){
        const c = [
          { label: 'What do you carry?', next: 'news' },
          { label: 'What do the trees pay you?', next: 'trade' },
          { label: 'Do you look after them?', next: 'mother' },
        ];
        if (opts.clover) c.push({ label: 'Look in the clover.', run: () => { found = opts.clover(); }, next: 'clover' });
        if (opts.onTake) c.push({ label: 'Take the caps.', run: opts.onTake, next: null });
        return { text:
          'These are the caps. The rest of me is under your feet and runs further than you have walked today.\n\n'
        + 'Ask, then. I deal in this.', choices: c };
      },

      get news(){
        const fs = heardAround();
        if (!fs.length) return { text: 'Nothing worth carrying. It has been a quiet stretch of ground and I am not paid to invent things.' };
        // brisk, plain, and it names distances the trees cannot
        const lines = fs.slice(0, 4).map(f => {
          const d = Math.round(Math.hypot(f.x - node.x, f.z - node.z));
          const days = Math.max(0, ctx.now - f.t);
          const kind = {
            tread: 'feet, regular ones', wound: 'something cut', fire: 'a fire',
            mast: `${speciesWord(f.what)} fruiting, the lot of them at once`, quicken: 'a windfall in the soil',
          }[f.kind] || 'something';
          return `— ${kind}, ${d} paces off, ${days < 1 ? 'today' : `${Math.round(days)} days back`}. ${f.hops === 0 ? 'First hand.' : `Came to me through ${f.hops}.`}`;
        });
        return { text: 'What I have on hand:\n\n' + lines.join('\n') };
      },

      get clover(){ return { text: found || 'Grass. Clover. Nothing you came for.' }; },

      get trade(){ return { text:
        'Sugar. They make it out of light and they cannot move, and I can move and cannot make it. That is the entire basis of our friendship.\n\n'
      + `I take carbon and I hand back phosphorus, nitrogen, water — and word, when the word is worth something. ${ctx.rain > 0.2 ? 'Rates are poor for me this week; everyone has water, nobody is desperate.' : 'Rates are good for me just now. Dry ground makes generous trees.'}` }; },

      get mother(){ return { text:
        'People do like that story. No.\n\n'
      + 'I move things where the return is best. Sometimes that is a seedling and it lives, and you would call that kindness. '
      + 'Sometimes I take a dying one\'s last sugar and carry it to a stranger uphill who is paying better, and you would call that something else. '
      + 'It is the same act. I am not their mother. I am the road, and I charge a toll.' }; },
    },
  };
}

// ------------------------------------------------------- what a listener takes --

// What a root-wise soul carries away from a great tree and repeats to the folk.
// Dodona (docs/sacred-trees.md §H): the oak's answer arrived as the rustle of its
// leaves, and a reader rendered it into words. Kept to one short line — it rides
// the ordinary gossip store (gossip.js), in the folk's mouths, not the tree's.
export function woodRumour(node, f, ctx){
  if (!f) return null;
  const when = ago(ctx.now - f.t);
  const at   = f.hops === 0 ? 'here' : where(node, f, ctx);
  const who  = nameFor(node).replace(/^The |^A /, '');      // "great oak"
  const said = {
    fire:    `fire, ${at}, ${when}`,
    tread:   `feet ${at} — many, and often`,
    wound:   `green torn open, ${at}, ${when}`,
    mast:    `the ${speciesWord(f.what)} all fruiting at once`,
    quicken: `the soil gone rich, ${at}, ${when}`,
  }[f.kind] || `something, ${at}, ${when}`;
  return `The ${who} has it that there was ${said}.`;
}

export const _internals = { tell, ago, where, SIGNALS };
