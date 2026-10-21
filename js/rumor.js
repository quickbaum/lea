// Rumor intake — the inbound counterpart to gossip.js. Events from other bub apps
// are translated into in-world facts and seeded onto carrier NPCs, from which they
// spread by the ordinary gossip mechanism. The folk carry the *meaning*, never the
// mechanism — the courier's fiction is what hides the real source. See
// docs/rumor.md (design) and gossip.js (the news model this feeds).
//
// SECURITY: the Lea is published publicly and cannot reach bub's private event
// bus, so intake is transport-agnostic and fed by postMessage (see main.js) — the
// local bub compositor posts rumors; the public deployment simply never receives
// one. Incoming text is coerced to a plain string and length-capped here so a
// rumor can only ever add a short folk-fact, never anything more.

import { addNews } from './gossip.js';

const TEXT_MAX = 240;

const alive   = a => a.npcs.filter(n => n && n.alive !== false);
const seers   = a => alive(a).filter(n => n.stargazer);
const rand    = arr => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
const one     = n => (n ? [n] : []);

// A courier decides WHO hears an incoming rumor and (optionally) reshapes the
// telling. Each returns the NPC(s) to seed.
const COURIERS = {
  // impersonal / cosmic: the sky speaks and the star-readers mythologize it.
  sky: {
    pick: a => { const s = seers(a); return s.length ? s.slice(0, 6) : alive(a).slice(0, 3); },
  },
  // weighty / authored: the visitor leans in and whispers it into one mind
  // (prefer a star-reader — they're the ones already listening upward).
  claude: {
    pick: a => one(rand(seers(a)) || rand(alive(a))),
  },
  // playful / unreliable: the trickster carries it. (Garbling is a passthrough for
  // now; drift/exaggeration is this courier's eventual point.)
  puck: {
    pick: a => one(rand(alive(a))),
    flavor: text => text,
  },
  // the general bridge: "news from beyond the hills," seeded onto whoever is
  // nearest the meadow's edge — the one who most plausibly just arrived.
  wanderer: {
    pick: a => {
      const ns = alive(a); if (!ns.length) return [];
      let best = null, far = -1;
      for (const n of ns) { const d = Math.hypot(n.x, n.z); if (d > far) { far = d; best = n; } }
      return one(best);
    },
  },
};

// Feed one external event into the meadow's gossip. Returns a small summary (or
// null if nothing could be seeded). `agents` is the AgentWorld; `event` is
// { text, courier?, id?, source? }.
export function intakeRumor(agents, event) {
  if (!agents || !Array.isArray(agents.npcs) || !agents.npcs.length) return null;
  if (!event || event.text == null) return null;

  const text = String(event.text).slice(0, TEXT_MAX).trim();
  if (!text) return null;

  const name = COURIERS[event.courier] ? event.courier : 'wanderer';
  const courier = COURIERS[name];
  const targets = new Set(courier.pick(agents));

  // A broadly-witnessed event (a firework overhead) also reaches whoever is
  // nearby — anyone can see a light in the sky, not just the star-readers. The
  // caller passes { x, z, count } and the nearest living folk are seeded too, so
  // the rumour is encounterable at once, not only after it spreads.
  if (event.near) {
    const { x = 0, z = 0, count = 3 } = event.near;
    alive(agents)
      .sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))
      .slice(0, Math.max(0, count | 0))
      .forEach(n => targets.add(n));
  }
  if (!targets.size) return null;

  const t = agents.time || 0;
  // a distinct key per event so tidings coexist rather than overwrite one another
  // (native star-omens use the single key 'omen'); still deduped if the same id
  // arrives twice.
  const id = event.id != null ? String(event.id)
           : (event.source || 'ext') + ':' + Math.round(t * 1e3) + ':' + Math.floor(Math.random() * 1e4);
  const key = 'tiding:' + id;
  const told = courier.flavor ? courier.flavor(text) : text;

  for (const npc of targets) {
    // kind:'omen' so it rides the gossip at top rank and lingers; extra fields
    // (courier/src) are ignored by gossip.js but let dialogue/telling flavor it later.
    addNews(npc, { kind: 'omen', key, text: told, x: npc.x, z: npc.z, t, courier: name, src: 'rumor' });
  }
  return { key, courier: name, reached: targets.size };
}

export const RUMOR_COURIERS = Object.keys(COURIERS);
