// knock.js — knocking at a village house's door. Who comes, how long they take, and what
// mood they come in; main.js has the words (peasantTree) and the waiting (tickKnock).
// A knock is answered by someone indoors at that moment: awake before asleep, a grown-up
// before a child. Someone asleep has to wake and get up, so that's the long wait. Pure data,
// like ties.js; nobody in the sim hears anything, and the answerer goes back in afterwards
// by the ordinary way (agents.js Brain: their business is indoors, so to the door and in).

const WAIT = { awake: [2, 4], late: [4, 7], asleep: [10, 18], empty: 6 };   // seconds at the door

const free = o => !o.convo && !o.talking;
const grown = o => o.role !== 'child';

export function whoAnswers(house){
  const home = [...house.inside].filter(free);
  return home.find(o => !o.sleeping && grown(o)) || home.find(o => !o.sleeping)
      || home.find(grown) || home[0] || null;
}

// seconds until they get there; nobody home takes as long to find out as a short wait
export function answerWait(who, dark, rnd = Math.random){
  if (!who) return WAIT.empty;
  const [lo, hi] = who.sleeping ? WAIT.asleep : dark ? WAIT.late : WAIT.awake;
  return lo + rnd() * (hi - lo);
}

// day: an ordinary caller. late: awake, but it's dark out. woken: got out of bed, and willing
// to hear why, for someone they know or by nature. surly: got out of bed for a stranger.
export function doorMood(who, dark, kindly){
  if (!dark) return 'day';
  if (!who.sleeping) return 'late';
  return who.known || kindly ? 'woken' : 'surly';
}

// on the door's side of the house, so you can't knock through the back wall
export function onDoorSide(house, x, z){
  const d = house.door;
  return (x - d.x) * d.nx + (z - d.z) * d.nz > 0;
}
