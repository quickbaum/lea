// Gossip — news spreads by talk, so knowledge outruns line-of-sight. Each NPC
// keeps a small, decaying store of facts — who they've seen (and where), where
// food grows, reputations, omens — and trades the freshest when two of them
// meet. Pure data on npc.news (a Map keyed by fact key); no rendering, no world
// state. See docs/gossip.md. Used by agents.js (AgentWorld.update + Brain) and
// read by main.js for the "any news?" dialogue.

export const GOSSIP_RANGE = 4.5;   // how close two must be to swap news
export const GOSSIP_CD    = 8;     // seconds before a person will gossip again
const NEWS_MAX     = 8;            // facts a person carries
const NEWS_TTL     = 2;            // in-game days before a fact fades from memory
const SAW_GAP      = 0.02;         // days (~half an hour): a sighting no newer than your own isn't news

// add/refresh a fact (keyed so newer sightings of the same subject overwrite older)
export function addNews(npc, fact){
  if (!npc.news) npc.news = new Map();
  const ex = npc.news.get(fact.key);
  if (!ex || fact.t > ex.t) npc.news.set(fact.key, fact);
}

export function pruneNews(npc, now){
  const m = npc.news; if (!m) return;
  // reputation & omens linger far longer than a fleeting sighting
  for (const [k, f] of m) if (now - f.t > (f.kind === 'kind' || f.kind === 'omen' ? NEWS_TTL * 5 : NEWS_TTL)) m.delete(k);
  const over = m.size - NEWS_MAX;            // past the cap, shed the least valuable first
  if (over > 0){ const low = [...m.entries()].sort((a, b) => NEWS_RANK(a[1]) - NEWS_RANK(b[1]) || a[1].t - b[1].t);
    for (let i = 0; i < over; i++) m.delete(low[i][0]); }
}

// rank facts for sharing/telling: reputation and food tips are worth more than the
// constant churn of "who I just saw" (sightings refresh to `now` every frame, so by
// freshness alone they'd drown everything else out).
const NEWS_RANK = f => (f.kind === 'omen' ? 3 : f.kind === 'kind' ? 2 : f.kind === 'food' ? 1 : 0);

// The best thing `from` could tell `to` right now: the choicest fact `to` doesn't
// already have. Never news of `to` themselves; and nobody is told they saw
// someone they've seen themselves lately — round a fire, everyone can see
// everyone, and "I saw Bryn just now" to Bryn's neighbour is noise. A
// conversation (convo.js) tells one fact a turn; the hearer's copy remembers who
// told it (`from`), so it can be passed on as "Bob says…".
export function newsFor(from, to, skip = null, ok = null){
  if (!from.news) return null;
  let best = null;
  for (const f of from.news.values()){
    if (f.subj === to || (skip && skip.has(f.key)) || (ok && !ok(f))) continue;
    const ex = to.news && to.news.get(f.key);
    if (ex && f.t <= ex.t + (f.kind === 'saw' ? SAW_GAP : 0)) continue;
    if (!best || NEWS_RANK(f) > NEWS_RANK(best) || (NEWS_RANK(f) === NEWS_RANK(best) && f.t > best.t)) best = f;
  }
  return best;
}
