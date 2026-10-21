// Ties — what one person thinks of another. Each NPC keeps npc.ties, a Map from
// the other person to { fam, reg }: familiarity (0..1, how well they know them)
// and regard (-1..1, dislike..like). One-way: A can like B more than B likes A.
// Kin start out known and warm. Talk, gifts and fair trades move both; a pair's
// fixed chemistry tilts how their talk lands, so some folk simply grate on each
// other. Pure data, like gossip.js; agents.js writes it, main.js reads it.
// See docs/talk.md.

const KIN_FAM = 0.5, KIN_REG = 0.35;

// a stable [-1, 1] per unordered pair: the same two people always get on (or
// don't) in the same way, from their ids alone (no draw on any rng)
export function chemistry(a, b){
  const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
  let h = Math.imul((lo + 1) * 73856093 ^ (hi + 1) * 19349663, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h % 2001) / 1000 - 1;
}

export function tie(a, b){
  if (!a.ties) a.ties = new Map();
  let t = a.ties.get(b);
  if (!t){
    const kin = a.group && a.group === b.group;
    t = { fam: kin ? KIN_FAM : 0, reg: kin ? KIN_REG : 0 };
    a.ties.set(b, t);
  }
  return t;
}

// what a thinks of b, without creating a tie for a stranger
export function regard(a, b){
  const t = a.ties && a.ties.get(b);
  if (t) return t.reg;
  return a.group && a.group === b.group ? KIN_REG : 0;
}

export function nudge(a, b, dFam, dReg){
  const t = tie(a, b);
  t.fam = Math.min(1, Math.max(0, t.fam + dFam));
  t.reg = Math.min(1, Math.max(-1, t.reg + dReg));
  return t;
}
