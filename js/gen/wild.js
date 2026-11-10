// wild.js — what you can take from what already grows: needles and bark off a pine,
// berries off a juniper, bark off a willow, heather tips, the blossom or the berries of
// an elder, primroses and violets out of their patches. Asked for, 2026-11-10: "more items that
// can be collected from nature … starting from what's already in the environment, and
// focusing on things that can be used for recipes" (docs/forage.md "From what grows").
//
// A source is a spot, a height to aim at, and a timer: no mesh of its own, so taking from
// it changes nothing you can see (the crown flowers are the exception: they're their own
// flowers, and vanish as the crown-makers' do). Player only, for now: none of this is in
// flora's `plants`, so the folk never forage it, and no folk dish wants it.
//
// Nothing here draws on the world's random stream: what a picking yields is a hash of the
// spot and how many times it's been picked, so the seeded world is untouched.

const CELL = 8;                           // grid cell (u) for sourcesNear

// what each source gives (the eye is at 1.7; the aim cone is ~14°, so heights on one tree sit
// well apart): [kind, aim height off the ground, yield lo..hi, regrow s, verb]
const PINE_NEEDLES = ['pine needles',    2.6, 2, 4, 90,  'pick pine needles'];
const PINE_BARK    = ['pine bark',       1.4, 1, 2, 240, 'strip some pine bark'];
const WILLOW_BARK  = ['willow bark',     1.4, 1, 2, 240, 'strip some willow bark'];
const JUNIPER      = ['juniper berries', 0.6, 3, 6, 120, 'pick juniper berries'];
const HEATHER      = ['heather',         0.25, 1, 3, 150, 'pick heather tips'];
const ELDERBERRIES = ['elderberries',    0, 2, 4, 90,  'pick elderberries'];
const ELDERFLOWERS = ['elderflowers',    0, 2, 3, 90,  'pick elderflowers'];

const hash = (x, z, n) => { let h = Math.imul((x * 73) | 0, 0x9e3779b1) ^ Math.imul((z * 37) | 0, 0x85ebca6b) ^ Math.imul(n + 1, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return (h >>> 0) / 4294967296; };

// an elder bush flowers or fruits by where it stands (there are no seasons yet): about
// two in five are in flower. flora.js reads this to draw the bush's cards.
export const elderInFlower = (x, z) => hash(x, z, 7) < 0.4;

export function makeWild({ pines = [], junipers = [], willows = [], elders = [], heather = [], flowers = [] } = {}){
  let clock = 0;                          // seconds, advanced by update()
  const grid = new Map();
  const key = (cx, cz) => cx * 65536 + cz;
  const put = s => { const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL)); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(s); };
  const all = [];

  function source(x, z, [kind, y, lo, hi, regrow, verb], scale = 1, dx = 0, dz = 0){
    let until = 0, picked = 0;
    const s = {
      x, z, kind, verb, wild: true,
      get ripe(){ return clock >= until; },
      aim(){ return { dx, y: y * scale, dz }; },
      collect(){
        if (clock < until) return 0;
        until = clock + regrow;
        return lo + Math.floor(hash(x, z, picked++) * (hi - lo + 1));
      },
    };
    if (!lazy){ all.push(s); put(s); }
    return s;
  }
  let lazy = false;
  const made = new Map();                 // lazy grid entry → its source, once made
  const real = e => { if (!e.lazy) return e; let s = made.get(e); if (!s){ lazy = true; s = source(e.x, e.z, e.lazy); lazy = false; made.set(e, s); } return s; };

  for (const [x, z] of pines){ source(x, z, PINE_NEEDLES); source(x, z, PINE_BARK); }
  for (const [x, z] of willows) source(x, z, WILLOW_BARK);
  for (const [x, z, sc] of junipers) source(x, z, JUNIPER, sc || 1);
  // heather: tens of thousands of cushions in a big world, so a source is only made when
  // you come near one (near(), below), and only one cushion in three has tips worth taking
  for (const [x, z] of heather) if (hash(x, z, 3) < 0.34) put({ x, z, lazy: HEATHER });
  // the elder's stems are cut at its foot (flora.js aims the bush there); its blossom or
  // its berries are up among the leaves, where its cards are drawn
  for (const e of elders){
    const a = e.aim();
    source(e.x, e.z, elderInFlower(e.x, e.z) ? ELDERFLOWERS : ELDERBERRIES, 1, a.dx, a.dz).aim = () => a;
  }
  // the crown flowers (flora.js `flowers`): the edible ones, by sprite. Shared with the
  // women who pick them for crowns, so gone is gone for both until it grows back.
  const FLOWER_KIND = { 53: 'primroses', 49: 'violets' };
  for (const f of flowers){
    const kind = FLOWER_KIND[f.speciesId]; if (!kind) continue;
    const s = { x: f.x, z: f.z, kind, verb: `pick ${kind}`, wild: true,
      get ripe(){ return f.alive; },
      aim(){ return { dx: 0, y: 0.2, dz: 0 }; },
      collect(){ if (!f.alive) return 0; f.remove(); return 1; } };
    all.push(s); put(s);
  }

  return {
    sources: all,                         // (not the heather: made as you come near it)
    update(dt){ clock += dt; },
    // every source within r of (x, z), ripe or not
    near(x, z, r){
      const out = [];
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
      for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++){
        const a = grid.get(key(cx, cz)); if (!a) continue;
        for (const e of a) if (Math.abs(e.x - x) <= r && Math.abs(e.z - z) <= r) out.push(real(e));
      }
      return out;
    },
  };
}
