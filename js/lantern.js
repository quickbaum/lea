// The lantern you carry after dark, on the land (underground you have the torch:
// under-view.js). One point light, always in the scene and at intensity 0 by day:
// three.js bakes the number of lights into every lit shader, so it must never come
// and go (docs/perf-notes.md).
//
// A point light only reaches lit (Lambert) materials, and the things nearest you at
// night aren't: grass blades (grass.js) and every billboard body. So this also states
// what the light would do to them, with three's own falloff, or the blades would stand
// dark on the lit turf and people would walk up as silhouettes.
import * as THREE from 'three';

const LANTERN = { color: 0xffb066, intensity: 5, distance: 26, decay: 1.3, drop: 0.25 };   // drop: held this far below the eye

export const lantern = {
  light: null, x: 0, y: 0, z: 0, power: 0,    // power: the lamp's output now, 0 by day
  distance: LANTERN.distance, decay: LANTERN.decay,
  _t: 0,

  attach(scene){
    this.light = new THREE.PointLight(LANTERN.color, 0, LANTERN.distance, LANTERN.decay);
    scene.add(this.light);
  },

  // strength: 0 (day, or underground) to 1 (night); at is the viewer's eye
  update(dt, at, strength){
    this._t += dt;
    this.x = at.x; this.y = at.y - LANTERN.drop; this.z = at.z;
    // steadier than the torch's flame: it's behind glass
    this.power = LANTERN.intensity * strength * (0.96 + 0.025 * Math.sin(this._t * 9) + 0.015 * Math.sin(this._t * 21.3));
    this.light.position.set(this.x, this.y, this.z);
    this.light.intensity = this.power;
  },

  // Warm an unlit billboard's colour, already set to the light of the hour, for one
  // standing at x, z. /PI: what a Lambert surface does with this light, since
  // a billboard's colour is what it shows, not what falls on it.
  warm(color, x, z){
    if (!(this.power > 0)) return color;
    const d = Math.max(0.5, Math.hypot(x - this.x, z - this.z));
    if (d >= this.distance) return color;
    const w = Math.max(0, 1 - (d / this.distance) ** 4);
    const g = this.power * w * w * d ** -this.decay / Math.PI, c = this.light.color;
    color.r = Math.min(1, color.r + c.r * g);
    color.g = Math.min(1, color.g + c.g * g);
    color.b = Math.min(1, color.b + c.b * g);
    return color;
  },
};
