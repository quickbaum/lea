// character.js — one character, assembled: a body of its own shape (body-kit.js), the
// clothes of its look cut from that body (outfit.js), a painted skin (skin.js), its
// household's mark and its prints (from the baked wagara patterns, so no server is
// needed), and the skirt's cloth (skirt-sim.js). The in-game baker renders these
// into sprite atlases; nothing here draws to the screen.

import * as THREE from 'three';
import { buildOutfit, wear } from './outfit.js';
import { skinTexture } from './skin.js';
import { KIN_DYES, patternMask } from './kin-mark.js';
import { makeBody } from './body-kit.js';
import { SkirtSim } from './skirt-sim.js';
import { applyClip } from './walk_anim.js';

let _maps = null;
export function loadAvatarMaps(base = 'sprites/avatar/'){
  const tl = new THREE.TextureLoader();
  const one = f => tl.loadAsync(base + f).then(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; return t; }).catch(() => null);
  return _maps ??= Promise.all([one('weave_normal.jpg'), one('fleece_normal.jpg')]).then(([weave, fleece]) => ({ weave, fleece }));
}

const hexOf = rgb => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
// a print: one of the baked wagara patterns, its figure in `fig` on `ground` (hex)
const prints = new Map();
export function printTexture(key, fig, ground){
  const id = key + fig + ground;
  if (!prints.has(id)) prints.set(id, new Promise(res => {
    const make = mask => {
      const N = 64, cv = document.createElement('canvas'); cv.width = cv.height = N;
      const g = cv.getContext('2d'), im = g.createImageData(N, N);
      const F = new THREE.Color(fig), G = new THREE.Color(ground);
      const fc = [F.r, F.g, F.b].map(v => v * 255), gc = [G.r, G.g, G.b].map(v => v * 255);
      for (let i = 0; i < N * N; i++){ const c = mask[i] ? fc : gc; im.data.set([c[0], c[1], c[2], 255], i * 4); }
      g.putImageData(im, 0, 0);
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.55, 0.55);   // ~11 cm a tile (a UV unit is 6 cm)
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      res(t);
    };
    const m = patternMask(key, 64, make);
    if (m) make(m);
  }));
  return prints.get(id);
}

// makeAvatar(kit, look, bodyParams, { env, maps, masks, seed }) -> avatar
export async function makeAvatar(kit, look, bodyParams, { env = null, maps = {}, masks = null, seed = 1 } = {}){
  const body = makeBody(kit, bodyParams);
  const C = look.colors;
  const fabric = {};
  for (const k of ['top', 'trousers']){
    const pat = look[k + 'Pattern'];
    if (pat && pat !== 'none') fabric[k] = await printTexture(pat, C[k + 'Fig'] || '#222222', C[k]);
  }
  let kinTex = null;
  if (look.kin && look.kinOn && look.kinOn !== 'none'){
    const tunic = look.top === 'tunic' && look.skirt === 'tunic';
    const ground = { sash: C.belt, hat: C.hat, vest: C.vest, skirt: tunic ? C.top : (C.skirt || C.top) }[look.kinOn];
    kinTex = await printTexture(look.kin.key, hexOf(KIN_DYES[look.kin.dye]), ground);
  }
  const outfit = buildOutfit(body.skin, look, { env, weave: maps.weave, fleece: maps.fleece, fabric, pattern: () => kinTex });
  wear(body.skin, outfit);
  if (masks && body.skin.geometry.attributes.uv){
    body.skin.material = new THREE.MeshPhysicalMaterial({ name: 'skin',
      map: skinTexture(THREE, masks, { tone: C.skin, iris: C.iris, brows: C.hair, browStyle: look.brows,
        blush: bodyParams.gender === 'f' ? 0.35 : 0.2, seed }, 512),     // a sprite's face is ~15 px: 512 is plenty, 4x faster
      roughness: 0.62, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(C.skin), envMap: env, envMapIntensity: 0.3 });
  }
  body.root.updateMatrixWorld(true);
  const sim = outfit.skirt ? new SkirtSim(outfit.skirt, body.bones) : null;
  if (sim) body.root.add(sim.mesh);              // the root stays at the origin: sim space is world space
  return {
    ...body, look, outfit, sim,
    pose(clip, frac, armOut = 8){ applyClip(body.bones, body.rest, clip, frac, { armOut }); body.root.updateMatrixWorld(true); },
    dispose(){
      sim?.dispose();
      body.root.traverse(o => { if (o.isMesh){ o.geometry.dispose(); } });
      for (const m of outfit.materials) m.dispose();
      body.skin.material.map?.dispose(); body.skin.material.dispose();
    },
  };
}
