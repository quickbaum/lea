// cards.js — a pack of cards, who carries one, and the games played with it (docs/cards.md). Pure:
// no DOM, no world; the rng is passed in. The table is js/cards-view.js; the talk is main.js.
//
// The first game is Go Fish, two hands. On your turn you ask for a rank you hold. If they have any,
// they hand them all over and you go again. If not, "Go fish": you draw one, and if it's what you
// asked for you show it and go again; otherwise it's their turn. Four of a rank is a book, laid
// down. When your hand is empty you draw; when the pile's empty too, you sit out. The game ends
// when all thirteen books are down, and whoever has more has won. No stakes (docs/cards.md).
//
//   const g = goFish(rng)                   g.hands[0] is yours, g.hands[1] theirs; g.turn whose go
//   ask(g, seat, rank, rng) → event         { seat, rank, got, fished, lucky, books, again } or { error }
//   const mind = cardMind(recall)           what the folk remember of your asks
//   heed(mind, ev, rng)                     after every ask, both seats'
//   theirAsk(g, mind, rng) → rank           their choice, from their own hand only; mind.why says
//                                           'remembered' if it was something you'd asked for
//   carriesCards(n), cardRecall(n)          by who they are (a hash), never the world's random stream
//   dealPacks(npcs)                         once: one card player to every settlement and camp

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const SUITS = ['S', 'H', 'D', 'C'];
const NAMES = { 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens', 8: 'eights', 9: 'nines', 10: 'tens',
                J: 'jacks', Q: 'queens', K: 'kings', A: 'aces' };
const ONE = { 2: 'a two', 3: 'a three', 4: 'a four', 5: 'a five', 6: 'a six', 7: 'a seven', 8: 'an eight', 9: 'a nine', 10: 'a ten',
              J: 'a jack', Q: 'a queen', K: 'a king', A: 'an ace' };
export const rankName = (r, n = 2) => n === 1 ? ONE[r] : NAMES[r];
export const rankOf = c => c.slice(0, -1);
export const newPack = () => RANKS.flatMap(r => SUITS.map(s => r + s));
const HAND = 7;                                  // dealt to each of two

export function shuffle(a, rng){
  for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function goFish(rng, first = 0){
  const stock = shuffle(newPack(), rng), hands = [[], []];
  for (let i = 0; i < HAND; i++) for (const h of hands) h.push(stock.pop());
  const g = { hands, books: [[], []], stock, turn: first, over: false };
  for (const s of [0, 1]) layBooks(g, s);        // (a dealt four of a kind is a book at once)
  settle(g);
  return g;
}

// four of a rank in seat's hand go down as a book
function layBooks(g, seat){
  const h = g.hands[seat], made = [];
  for (const r of RANKS){
    if (h.filter(c => rankOf(c) === r).length === 4){ g.books[seat].push(r); made.push(r); }
  }
  if (made.length) g.hands[seat] = h.filter(c => !made.includes(rankOf(c)));
  return made;
}
export const holds = (g, seat, r) => g.hands[seat].some(c => rankOf(c) === r);

// whoever's turn it is with an empty hand draws one, or, with the pile gone too, sits out
function settle(g){
  for (let guard = 0; guard < 4 && !g.over; guard++){
    if (g.books[0].length + g.books[1].length === RANKS.length){ g.over = true; break; }
    if (g.hands[g.turn].length) break;
    if (g.stock.length){ g.hands[g.turn].push(g.stock.pop()); layBooks(g, g.turn); }
    else g.turn = 1 - g.turn;
  }
  if (!g.over && !g.hands[0].length && !g.hands[1].length && !g.stock.length) g.over = true;
}

export function ask(g, seat, rank){
  if (g.over) return { error: 'over' };
  if (seat !== g.turn) return { error: 'not-your-turn' };
  if (!holds(g, seat, rank)) return { error: 'not-held' };       // you may only ask for what you hold
  const other = 1 - seat, given = g.hands[other].filter(c => rankOf(c) === rank);
  const ev = { seat, rank, got: given.length, fished: null, lucky: false, books: [], again: false };
  if (given.length){
    g.hands[other] = g.hands[other].filter(c => rankOf(c) !== rank);
    g.hands[seat].push(...given);
    ev.again = true;
  } else if (g.stock.length){
    ev.fished = g.stock.pop();
    g.hands[seat].push(ev.fished);
    ev.lucky = ev.again = rankOf(ev.fished) === rank;
  }
  ev.books = layBooks(g, seat);
  if (!ev.again) g.turn = other;
  settle(g);
  return ev;
}
export const score = g => [g.books[0].length, g.books[1].length];
export function winner(g){ const [a, b] = score(g); return !g.over ? null : a > b ? 0 : b > a ? 1 : 'draw'; }

// ---- the folk at the table ------------------------------------------------------------------------
// They remember what you've asked for (you must hold it), and forget it a little each turn: recall
// is the chance a remembered ask survives one of their turns.
export const cardMind = recall => ({ recall, yours: new Set(), lacks: new Set() });
export function heed(mind, ev){
  if (!ev || ev.error) return;
  if (ev.seat === 0){ mind.yours.add(ev.rank); mind.lacks.delete(ev.rank); }   // you asked: you've some
  else if (ev.got) mind.yours.delete(ev.rank);             // they took them off you
  else mind.lacks.add(ev.rank);                            // you'd none: no use asking again soon
  for (const r of ev.books){ mind.yours.delete(r); mind.lacks.delete(r); }   // a book's down: no more of those about
}
export function theirAsk(g, mind, rng){
  for (const S of [mind.yours, mind.lacks]) for (const r of [...S]) if (rng() > mind.recall) S.delete(r);   // a turn's forgetting
  const mine = RANKS.filter(r => holds(g, 1, r));
  const known = mine.filter(r => mind.yours.has(r));
  mind.why = 'any';                                        // (why: for what they say as they ask)
  if (known.length){ mind.why = 'remembered'; return known[Math.floor(rng() * known.length)]; }
  // nothing remembered: any rank they hold. (Asking for the one they've most of loses: 41% against
  // a random asker over 600 games, since the fewer you hold, the more are out there to be given.)
  const fresh = mine.filter(r => !mind.lacks.has(r)), from = fresh.length ? fresh : mine;   // not what you'd none of just now
  return from[Math.floor(rng() * from.length)];
}

// ---- who has a pack, and how well they hold what's said -----------------------------------------
function hashUnit(str){ let h = 2166136261 >>> 0; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return (h % 10007) / 10007; }
export const CARRY = { village: 0.25, else: 0.1 };       // shares of grown folk with a pack on them
const grown = n => n.role !== 'child' && !n.postRider && !n.trader;
const cardHash = n => hashUnit('cards|' + n.id + '|' + (n.name || ''));
export function carriesCards(n){
  if (!grown(n)) return false;
  return !!n._cardPlayer || cardHash(n) < (n.home ? CARRY.village : CARRY.else);
}
// On top of the shares, every settlement and every camp has one card player: whoever there has
// the lowest hash. Without it a small Lea (Little Lea: 2 grown villagers, 10 others) often has
// no pack in it at all. Call once the folk are all made; by who they are, so the same each load.
export function dealPacks(npcs){
  const best = new Map();
  for (const n of npcs){
    if (!grown(n)) continue;
    const key = n.home ? 'home|' + (n.home.craft ?? '') : n.group || null;
    if (key == null) continue;
    const b = best.get(key);
    if (!b || cardHash(n) < cardHash(b)) best.set(key, n);
  }
  for (const n of best.values()) n._cardPlayer = true;
  return best.size;
}
// recipes.js memoryOf: 0.5–2.6, elders ×1.3, or Infinity for the few who never forget
export function cardRecall(memory){
  if (!Number.isFinite(memory)) return 0.95;
  return Math.max(0.5, Math.min(0.92, 0.45 + 0.2 * memory));
}
// how they take the end of a game: most cheerfully, some keenly. By who they are, not by chance
export const cardManner = n => hashUnit('cardmanner|' + n.id + '|' + (n.name || '')) < 0.7 ? 'easy' : 'keen';
