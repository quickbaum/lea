// folk-pool.js — dresses the human villagers from a fixed pool of characters, baked ahead of
// time on a fast machine (folk-bake.html) and served as plain files, so nothing is baked while
// the world loads and any world, custom ones too, gets them at once. A villager is given a pool
// character by the world's seed, their gender and their age, so a world always looks the same.
// A household's mark isn't on their clothes (a pool can't carry every mark): it's on their pack,
// their thatch, their portrait's backdrop and their ink. Design in docs/folk-pool.md.

import * as THREE from 'three';
import { assignPool } from './folk-deal.js';

const DIR = 'sprites/folk/';
const PARALLEL = 6;        // images fetched at once

// A character is about 12 MB on the GPU (a 1970×1280 atlas and its sitting one). A phone takes the
// half-size pair, about 3 MB: it draws so few pixels that a villager never needs more. So does
// everyone on the public build, which ships only those (pool.json says `small`).
const TOUCH = document.documentElement.classList.contains('touch');

export const bakedFolkEnabled = () => new URLSearchParams(location.search).get('bakedfolk') !== '0';
export const wantsBake = n => /-human|-lea-/.test(n.slug || '');

function loadTex(url){
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    res(t);
  }, undefined, rej));
}

// Dress them, and return how many were. With no pool to draw on, they keep their painted sheets.
export async function dressFromPool(npcs, worldSeed, onProgress = () => {}){
  try { indexedDB.deleteDatabase('lea-folk'); } catch (_){}   // bakes from when each browser made its own
  if (!bakedFolkEnabled()) return 0;
  const pool = await fetch(DIR + 'pool.json').then(r => r.ok ? r.json() : null).catch(() => null), folk = pool?.folk;
  if (!folk?.length) return 0;
  const SMALL = TOUCH || pool.small ? '-s' : '';
  const given = assignPool(npcs.filter(wantsBake), folk, worldSeed);
  // Each character is fetched once, and everyone wearing them shares its textures (npc.js clones
  // them, which shares the upload too), so the GPU's bill is the characters in use, not the folk.
  const wanted = [...new Set(given.values())], textures = new Map();
  let done = 0, at = 0;
  async function worker(){
    while (at < wanted.length){
      const f = wanted[at++];
      try { textures.set(f.id, await Promise.all([loadTex(`${DIR}${f.id}${SMALL}.png`), loadTex(`${DIR}${f.id}-sit${SMALL}.png`)])); }
      catch (e){ console.warn('pool character failed to load:', f.id, e); }
      onProgress(++done, wanted.length);
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  let dressed = 0;
  for (const [n, f] of given){
    const t = textures.get(f.id);
    if (!t) continue;                              // (they keep their painted sheet)
    n.setAtlas(t[0], f.m, f.frameM);
    n.setPoseAtlas('sitting', t[1], f.sitM);
    n.portrait = `${DIR}${f.id}-face.png`;
    dressed++;
  }
  return dressed;
}
