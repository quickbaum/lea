// journal.js — the player's journal (J): what they've done that came to something,
// written up as a diary. Not a log of every step: a visit to a place is one entry
// ("Puck took me to the Citock Caves, where I found cave salt and caught a fish."),
// gathering what was done there into one sentence, and what's still in hand (a salve
// a stargazer is waiting to make, a recipe taught to a cook) is kept at the top until
// it's done. Pure data and wording, no rendering: js/journal-view.js draws it.
//
// A place is { key, name, at, what?, rooms? }: `at` the preposition ("in Shirn Wood",
// "under Brenwick Abbey"), `what` how to say you stumbled on it ("the ruins of
// Brenwick Abbey"), `rooms` what its rooms are called ("rooms", "chambers").
//   arrive(place, how)       how: 'puck' (he led you there), 'stumble', 'down'
//   did(place, verb, obj)    a clause, I implied: did(p, 'picked', 'hazelnuts')
//   explore(place, roomId)   a room of a crypt walked into ("explored a few of its rooms")
//   task(key, text) / done(key)   what's in hand, and its end
// `clock()` gives { t (days), hour }.

const MERGE = 2 / 24;                       // back at the same place within two hours: the same entry
const OPEN_RANK = { down: 1, stumble: 2, puck: 3 };   // what an entry opens with, if it could be several
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const list = a => a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`;
const FEW = n => n >= 7 ? 'many' : n >= 4 ? 'some' : 'a few';
const PART = h => h < 5 ? 'Night' : h < 9 ? 'Early morning' : h < 12 ? 'Morning' : h < 14 ? 'Midday' : h < 18 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';

export function makeJournal(clock){
  const entries = [];                     // { key, place, t, day, hour, open, acts: [{ verb, objs } | { verb: 'explored', rooms: Set }] }
  const tasks = new Map();                // key → { text, t }
  let unread = false;

  // the entry this happens in: the last one at this place, if it was lately; else a new one
  function entryAt(place){
    const { t, hour } = clock();
    for (let i = entries.length - 1; i >= 0 && i >= entries.length - 4; i--){
      const e = entries[i];
      if (e.key === place.key && t - e.last < MERGE){ e.last = t; return e; }
    }
    const e = { key: place.key, place, t, last: t, day: Math.floor(t), hour, open: null, acts: [] };
    entries.push(e);
    return e;
  }
  const said = e => e.acts.some(a => a.objs ? a.objs.length : a.rooms.size >= 2);

  const journal = {
    get unread(){ return unread; }, read(){ unread = false; },
    arrive(place, how){
      const e = entryAt(place);
      if (!e.open || OPEN_RANK[how] > OPEN_RANK[e.open]) e.open = how;
      if (how === 'puck') unread = true;
    },
    did(place, verb, obj){
      const e = entryAt(place), same = e.acts.find(a => a.verb === verb && a.objs);
      if (same && same.objs.includes(obj)) return;   // said already
      if (same) same.objs.push(obj);                 // picked hazelnuts and bilberries
      else e.acts.push({ verb, objs: [obj] });
      unread = true;
    },
    explore(place, room){
      const e = entryAt(place);
      let a = e.acts.find(x => x.rooms);
      if (!a){ a = { verb: 'explored', rooms: new Set() }; e.acts.push(a); }
      const was = a.rooms.size; a.rooms.add(room);
      if (a.rooms.size === 2 && was === 1) unread = true;
    },
    task(key, text){ const had = tasks.get(key); if (had && had.text === text) return; tasks.set(key, { text, t: clock().t }); unread = true; },
    done(key){ tasks.delete(key); },
    tasks: () => [...tasks.values()],

    // the days, newest first, each its entries in the order they happened, as sentences
    days(){
      const by = new Map();
      for (const e of entries){
        if (!said(e) && e.open !== 'puck') continue;          // walked through, nothing came of it
        if (!by.has(e.day)) by.set(e.day, []);
        by.get(e.day).push({ when: PART(e.hour), text: write(e) });
      }
      return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([day, es]) => ({ day, entries: es }));
    },
  };

  // an entry as a sentence or two: how you came there and what you did there, then the
  // rest three things to a sentence, the I left out as a diary does ("Found a recipe…")
  function write(e){
    const p = e.place;
    const clauses = e.acts.map(a => a.rooms ? (a.rooms.size >= 2 ? `explored ${FEW(a.rooms.size)} of its ${p.rooms || 'rooms'}` : null)
                                            : `${a.verb} ${list(a.objs)}`).filter(Boolean);
    const one = e.open === 'stumble' || e.open === 'down';   // "…and explored some of its rooms." takes only one
    const first = clauses.slice(0, one ? 1 : 3), rest = clauses.slice(first.length);
    let s;
    if (e.open === 'puck') s = `Puck took me to ${p.name}` + (first.length ? `, where I ${list(first)}` : '');
    else if (e.open === 'stumble') s = `Stumbled upon ${p.what || p.name} and ${first[0]}`;
    else if (e.open === 'down') s = `Went down ${p.at === 'under' ? 'under' : 'into'} ${p.name} and ${first[0]}`;
    else s = `${cap(p.at)} ${p.name} I ${list(first)}`;
    s += '.';
    for (let i = 0; i < rest.length; i += 3) s += ` ${cap(list(rest.slice(i, i + 3)))}.`;
    return s;
  }
  return journal;
}
