// vitals.js — the player's health, stamina and spell points, as in Might and Magic.
// Pure data, no rendering (main.js draws the bars). Design: docs/magic.md "Consuming".
//
//   spell points  spent on spells (main.js SPELLS `cost`); they come back by themselves
//                 slowly, a full refill in about one Lea day, faster by eating something
//                 with the virtue for it (hazelnuts, for now)
//   stamina       spent running; back by itself in about a minute. Run it out and you're
//                 winded: walking only, until it's a quarter back
//   health        modelled, not yet drawn: nothing in the Lea can hurt you yet
//
// Eating (eat) gives what the ingredient's `eat` says (ingredients.js), scaled by how
// much you've missed its food group: the folk's own variety model (trade.js lack), so
// a second handful of the same thing a minute later gives little.

import { ingredient, edible } from './ingredients.js';
import { ate, lack, groupOf } from './trade.js';

export const HP_MAX = 30, ST_MAX = 100, SP_MAX = 20;
const ST_RUN    = ST_MAX / 12;    // per second running: empty in ~12 s
const ST_BACK   = ST_MAX / 60;    // per second otherwise: full in ~a minute
const WINDED_TO = ST_MAX / 4;     // winded until it's back to this
const SP_BACK   = SP_MAX / 600;   // per real second: one Lea day at the default 600 s day
const FLY_DRAIN = 1 / 4;          // spell points per second aloft
const EAT_FLOOR = 0.25;           // what a food you've just had still gives

export function makeVitals(){
  return { hp: HP_MAX, st: ST_MAX, sp: SP_MAX, winded: false, _diet: {} };
}
// a frame: running (Shift held and moving on foot) and flying (by the spell) cost
export function tickVitals(v, dt, { running = false, flying = false } = {}){
  if (running && !v.winded){ v.st = Math.max(0, v.st - ST_RUN * dt); if (v.st <= 0) v.winded = true; }
  else v.st = Math.min(ST_MAX, v.st + ST_BACK * dt);
  if (v.winded && v.st >= WINDED_TO) v.winded = false;
  v.sp = Math.min(SP_MAX, v.sp + SP_BACK * dt);
  if (flying) v.sp = Math.max(0, v.sp - FLY_DRAIN * dt);
}
export const canRun = v => !v.winded;
export function spend(v, sp){ if (v.sp < sp) return false; v.sp -= sp; return true; }

// what eating one `kind` would give now, before the caps: { stamina, health, sp, f }
export function eatValue(v, kind, now){
  const e = ingredient(kind);
  if (!edible(kind)) return null;
  const g = e.group === 'dish' ? 'dish:' + kind : groupOf(kind), f = g ? EAT_FLOOR + (1 - EAT_FLOOR) * lack(v, g, now) : 1;
  return { stamina: (e.eat.stamina || 0) * f, health: (e.eat.health || 0) * f, sp: (e.eat.sp || 0) * f, f };
}
// eat one: returns what it actually gave (after the caps), or null if it can't be eaten
export function eat(v, kind, now){
  const g = eatValue(v, kind, now);
  if (!g) return null;
  const before = { st: v.st, hp: v.hp, sp: v.sp };
  v.st = Math.min(ST_MAX, v.st + g.stamina); v.hp = Math.min(HP_MAX, v.hp + g.health); v.sp = Math.min(SP_MAX, v.sp + g.sp);
  if (ingredient(kind).group === 'dish') (v._diet || (v._diet = {}))['dish:' + kind] = now; else ate(v, kind, now);
  return { stamina: v.st - before.st, health: v.hp - before.hp, sp: v.sp - before.sp, f: g.f };
}
