import * as THREE from 'three';
import { height, under } from './terrain.js';
import { mouthShape, halfWidth } from './gen/under.js';

// The trolls — characters, not monsters (docs/music.md, "The troll"). Each sits in the one
// mouth of his own cave (gen/under.js marks it `troll` with his id), knees up, filling the way
// in, and talks (dialogs/<id>.json). A flat drawing that turns to face you, pixelated and
// shaded with the hour like Puck. You can't get past him: main.js won't aim at the mouth
// behind him, and come too close (into him, or round him into the mouth: tooClose) and he
// roars and you jump back (main.js roarAt). Wanting a tune before he'll stand aside is step 4
// of the plan.
//   troll  the first, in a cave mouth like any other
//   elder  the old one, in a mouth twice the size (the entrance's `scale`), and twice his size

const TROLLS = {
  troll: { sprite: 'sprites/troll_sitting.png', name: 'the troll', roar: 'GRRRAAAH!' },
  elder: { sprite: 'sprites/troll_elder_sitting.png', name: 'the old troll', roar: 'HRRROOOAAARGH!' },
};
const H = 7.6;          // how tall one sits in an ordinary mouth (u): its opening is 7–8 high (gen/under.js mouthShape)
const R = 3;            // how close you can come, likewise

export function makeTrolls(scene){
  return under().entrances.filter(en => TROLLS[en.troll]).map(e => makeTroll(scene, e));
}

function makeTroll(scene, e){
  const S = e.scale || 1, D = TROLLS[e.troll], h = H * S, r = R * S;
  const x = e.x + Math.cos(e.face) * 0.6 * S, z = e.z + Math.sin(e.face) * 0.6 * S;   // in the doorway, just out of it
  const T = { x, z, h, r, scale: S, id: e.troll, dialog: e.troll, name: D.name, roar: D.roar, entrance: e, mesh: null, talking: false };
  const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.5, transparent: true, fog: true });
  new THREE.TextureLoader().load(D.sprite, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    mat.map = tex; mat.needsUpdate = true;
    const w = h * tex.image.width / tex.image.height;
    const geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
    T.mesh = new THREE.Mesh(geo, mat);
    T.mesh.position.set(x, height(x, z) - 0.15 * S, z);
    scene.add(T.mesh);
  });
  // turned to face the camera, about the upright only; tint: the light of the hour (main.js)
  T.update = (camera, visible, tint) => {
    if (!T.mesh) return;
    T.mesh.visible = visible;
    if (tint) mat.color.copy(tint);
    T.mesh.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z);
  };
  // (px, pz) moved out of where he sits
  T.pushOut = (px, pz) => {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    return d >= r || d < 1e-6 ? [px, pz] : [x + dx / d * r, z + dz / d * r];
  };
  // (px, pz) too close: inside where he sits, or in the mouth behind him, past the stone's face
  // and within the opening's width (a little more), as far in as the hill's cut (land.js cutMouths)
  const M = mouthShape(e), half = halfWidth(M.o, 0) + 1;
  T.tooClose = (px, pz) => {
    if (Math.hypot(px - x, pz - z) < r) return true;
    const qx = px - M.px, qz = pz - M.pz, u = -(qx * M.fx + qz * M.fz);
    return u > -1 && u < (e.depth || 20) + 3 && Math.abs(qx * M.tx + qz * M.tz) < half;
  };
  // which way you jump from him: away from him, but never on into the hill
  T.away = (px, pz) => {
    let dx = px - x, dz = pz - z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const into = 0.5 - (dx * M.fx + dz * M.fz);
    if (into > 0){ dx += M.fx * into * 2; dz += M.fz * into * 2; }
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  // where to aim at him from (px, pz) to talk: the near side of him, his knees, so a big one can
  // be spoken to from where pushOut leaves you (main.js's TALK_RANGE)
  T.front = (px, pz) => {
    const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz) || 1, k = (r - R) / d;
    return [x + dx * k, z + dz * k];
  };
  return T;
}
