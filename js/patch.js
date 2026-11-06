// Leaving a place when it stops paying (docs/npc-psychology.md, docs/sheep.md). One small idea with several takers: a
// flock on grazed-down grass, and in time a shepherd choosing ground, a nomad camp, someone at a poor berry patch.
// Keep a running sense of what this place is paying, and compare it with what's expected elsewhere. `bar` is how much
// worse here must be before going. People differ in it; for a person it would be their steadiness.
export class Patch {
  constructor({ tau = 30, bar = 0.8, settle = 45 } = {}){
    this.tau = tau; this.bar = bar; this.settle = settle;    // seconds of memory; the ratio; least time before moving on
    this.rate = 1; this.since = 0;
  }
  feed(value, dt){
    this.rate += (value - this.rate) * Math.min(1, dt / this.tau);
    this.since += dt;
  }
  arrive(value = this.rate){ this.rate = value; this.since = 0; }
  leave(elsewhere){ return this.since >= this.settle && this.rate < elsewhere * this.bar; }
}
