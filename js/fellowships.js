// Fellowships — groups the folk (and, later, the player) are initiated into: mystery
// companies, groves, clubs, guilds. One general system: a fellowship is DATA (below),
// and the engine only reads its fields. docs/fellowships.md (design), research in
// docs/texts/mysteries.md.
//
// Pure: no rendering, no world state of its own. agents.js runs the rite (Brain.riteStep)
// and seeds who belongs (AgentWorld.setFellowships); gossip.js asks mayHear() before
// telling anyone anything a fellowship keeps; main.js says the lines.
//
// Belonging is npc.fellowships: Map id -> { grade, since }. Several at once is just several
// entries. Who belongs is a hash of who they are (as musicalCamp and memoryOf do), so it
// never draws on the world's random stream.

// Secrecy, per fellowship:
//   secret — members deny it; gossip carries only what outsiders see (a 'sign')
//   known  — that you belong may be known; what's done isn't (not used yet)
//   open   — anyone may know, and watch
export const FELLOWSHIPS = {
  // After the benandanti and the Căluşari (mysteries.md §3): ordinary folk who go out on
  // the quarter nights to a stone circle. Its job (keeping the harvest) is step 3.
  'night-company': {
    name: 'the night company',
    secrecy: 'secret',
    who: 'any', share: 0.22, min: 3, max: 8,
    site: 'circle',
    when: { quarter: true, dark: 0.4 },
    rite: [{ do: 'rounds', laps: 1, r: 0.7 }, { do: 'sit', r: 0.5 }],
    icon: 'omen',
  },
  // Open, and no job: whoever plays meets at one fire on the night of the full moon, and
  // the music sim (music-sim.js) does the rest once they're sat down with instruments.
  'fiddlers': {
    name: "the fiddlers' meet",
    secrecy: 'open',
    who: 'musician', share: 1, min: 2, max: 12,
    site: 'fire',
    when: { fullMoon: true, dark: 0.35 },
    rite: [{ do: 'sit' }],
    icon: 'music',
  },
};
export const FELLOWSHIP_IDS = Object.keys(FELLOWSHIPS);

export const REACH = 200;          // members live within this of their meeting place (a night's walk there and back)

const TAU = 2 * Math.PI;
const MOON_SIDEREAL = 27.32;       // days (sky.js; the harness moves the moon the same)

// the meeting's occasion: the night, by its midnight (sky.time's whole days fall at
// midnight), so a member goes once a night and the night isn't split at 0:00
export const occasion = w => Math.round(w.time);

// does an angle moving at `rate` per day pass `offset` (mod `step`) during the night
// centred on this midnight? — the night "of" a quarter day or a full moon
function crossesTonight(w, lon, rate, step, offset){
  const M = occasion(w);
  const a = lon + (M - 0.5 - w.time) * rate - offset, b = a + rate;
  return Math.floor(b / step) > Math.floor(a / step);
}
const sunRate  = w => TAU / (w.yearDays || 360);
export const quarterNight = w => crossesTonight(w, w.sunLon || 0, sunRate(w), TAU / 4, 0);
export const fullMoonNight = w => crossesTonight(w, (w.moonLon || 0) - (w.sunLon || 0), TAU / MOON_SIDEREAL - sunRate(w), TAU, Math.PI);

// is the meeting on, now?
export function meetingOpen(def, w){
  const c = def.when;
  if (c.dark != null && !((w.night || 0) > c.dark)) return false;
  if (c.quarter && !quarterNight(w)) return false;
  if (c.fullMoon && !fullMoonNight(w)) return false;
  return true;
}

const hash01 = (a, b) => { let h = 2166136261 >>> 0; for (const c of a + '|' + b) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; };
export const memberHash = (id, n) => hash01('fellow:' + id, 'n' + n.id + '|' + (n.name || ''));

export const isMember = (n, id) => !!(n && n.fellowships && n.fellowships.has(id));

// may `to` be told fact `f`? Anything a fellowship keeps (f.fid set) goes only to its own,
// unless the fellowship is open. Facts no fellowship keeps always may.
export function mayHear(f, to){
  if (!f || !f.fid) return true;
  const def = FELLOWSHIPS[f.fid];
  if (!def || def.secrecy === 'open') return true;
  if (f.kind === 'sign') return true;            // what anyone could see is anyone's to tell
  return isMember(to, f.fid);
}

// is this person, right now, at (or on their way to) a rite strangers mayn't see?
export function atSecretRite(n){
  const r = n && n.brain && n.brain._rite;
  return r && FELLOWSHIPS[r.F.id].secrecy !== 'open' ? r : null;
}
