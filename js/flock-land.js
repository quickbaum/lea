// How the sheep meet the real world (docs/sheep.md): what the land is to a flock, who keeps one, and what a village does to
// its ground for them. js/sheep.js stays pure, so this is the seam. The game (js/main.js) and the long run in Chrome
// (flock.html) both use it, so that what's tested is what's played.
import { WATER, WORLD_R } from './config.js';
import { height, walkable, solidAt, terrainType, treeCover, habitat, soilRichness, settlements, road, roadBand, builtBand, wearHere } from './terrain.js';
import { addSolid } from './gen/land.js';
import { settlementNames } from './gen/places.js';
import { SHEEP } from './sheep.js';

// sheep are held in common by a band: every village, and every clan or band on the move
export function flockOwners(groups){
  const names = settlementNames();
  const villages = settlements().places.flatMap((p, i) => p.kind === 'farmstead' ? [] : [{ x: p.x, z: p.z, name: names[i].name, place: p }]);
  const nomads = groups.filter(g => !g.village && (g.kind === 'clan' || g.kind === 'band')).map(g => ({ x: g.cx, z: g.cz, name: g.name, group: g }));
  return [...villages, ...nomads];
}

export function flockLand(agents, sward){
  return {
    // walkable pads the walls by a sheep's width: a house's own 0.35 is for someone slim
    walkable: (x, z) => height(x, z) > WATER - 0.1 && !solidAt(x, z, SHEEP.BODY) && Math.hypot(x, z) < WORLD_R, height,
    open: (x, z) => walkable(x, z) && terrainType(x, z) === 'grass' && treeCover(x, z) < 0.3 && habitat(x, z) !== 'grove' && !agents.fields.some(f => Math.hypot(f.x - x, f.z - z) < 22),
    // old-growth: it reads as grass, thinly wooded, but it's needle duff under big trees with nothing to eat and no way through
    thick: (x, z) => habitat(x, z) === 'grove',
    // how much of a wet fleece's dirt this ground gives it, 0 to 1: mud, or grass trodden bare (wear, as in terrain.js's wornPace)
    muddy: (x, z) => terrainType(x, z) === 'mud' ? 1 : Math.max(0, Math.min(1, (wearHere(x, z) - 0.08) / 0.42)),
    within: (x, z, r) => agents.obstaclesWithin(x, z, r),
    sward,
    // what a village's common is read from (gen/common.js)
    site: {
      solid: solidAt, soil: soilRichness, waterAt: (x, z) => height(x, z) < WATER,
      built: (x, z) => builtBand(x, z) > 0 || roadBand(x, z) > 0,
      stand: (x, z) => walkable(x, z) && terrainType(x, z) === 'grass',
      road: (x, z) => road().nearest(x, z).d,
      fields: settlements().fields || [],
    },
    zones: (x, z, r) => {
      const out = [], close = q => Math.hypot(q.x - x, q.z - z) < r;
      for (const f of agents.fields) if (close(f)) out.push(f.f);
      for (const h of agents.huts) if (close(h)) out.push({ x: h.x, z: h.z, r: h.rad });
      for (const s of agents.shelters) if (close(s)) out.push({ x: s.x, z: s.z, r: 1.6 });
      for (const c of agents.fires) if (close(c)) out.push({ x: c.x, z: c.z, r: 1.2 });
      return out;
    },
  };
}

// scrub felled, the hut solid, and if there's a ground to paint, the floors trodden to earth. Returns the commons
export function raiseCommons(agents, trail = null){
  const commons = agents.flocks.filter(f => f.common).map(f => f.common);
  for (const { fold: o, hut: h, scrub } of commons){
    for (const q of scrub) q.chop?.();
    addSolid(h, Math.hypot(h.hl, h.hw));
    agents.nav?.closeBuilt(h.x, h.z, Math.hypot(h.hl, h.hw));     // (the routes were drawn before it went up)
    if (trail){
      trail.clearingBox(o.x, o.z, o.a, o.hl, o.hw);
      trail.clearingBox(h.x, h.z, h.a, h.hl + 0.6, h.hw + 0.6);
    }
  }
  trail?.flush();
  return commons;
}
