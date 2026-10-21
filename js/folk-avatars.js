// folk-avatars.js — every human villager gets a character of their own, baked on the
// player's machine (the Pi only serves files; an M2 bakes a villager in a second or
// two). Each one's body (height, build, age, figure) and look (garments, colours,
// prints, hair, beard, jewellery) come from a seed of the world, their group and
// their place in it, and a household's members wear its mark (kin-mark.js — the
// same pattern as their thatch and packs). Elves, dwarves and goblins keep their
// painted M&M sheets: there are no models for them.
//
// Bakes are cached in IndexedDB by everything that shapes them, so a world loads its
// villagers instantly the second time. ?bakedfolk=0 turns it all off.

import { loadBodyKit, randomBody } from './body-kit.js';
import { randomLook } from './outfit.js';
import { loadSkinMasks } from './skin.js';
import { makeAvatar, loadAvatarMaps } from './character.js';
import { createBaker } from './avatar-bake.js';
import { loadClip } from './walk_anim.js';
import { kinMark } from './kin-mark.js';

const VERSION = 4;                 // bump when the generators change, so old bakes are dropped
// the two recorded walks kept (07_01 had a strange neck tilt); each villager gets
// one by seed, so a crowd doesn't move in step
const CLIPS = ['cmu-08_01', 'cmu-35_01'], ARM_OUT = 8;

export const bakedFolkEnabled = () => new URLSearchParams(location.search).get('bakedfolk') !== '0';
export const wantsBake = n => /-human|-lea-/.test(n.slug || '');

function hash(s){ let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---- cache (IndexedDB: key -> { png Blob, m, frameM, portrait Blob, sitPng Blob, sitM }) ----
const db = () => new Promise((res, rej) => { const r = indexedDB.open('lea-folk', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('bakes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function cacheGet(key){ try { const d = await db(); return await new Promise(res => {
  const q = d.transaction('bakes').objectStore('bakes').get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function cachePut(key, val){ try { const d = await db(); d.transaction('bakes', 'readwrite').objectStore('bakes').put(val, key); } catch { /* no cache: bake next time too */ } }
const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));
const toImage = blob => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(blob); });
// A Blob read back from IndexedDB points into the browser's store on disk, and can
// stop being readable mid-session (portraits went to broken images, and a reload
// fell back to the painted sheets). Copy a cache hit into memory first; if it won't
// read, it's a miss and gets baked again.
async function inMemory(hit){
  try {
    const copy = async b => new Blob([await b.arrayBuffer()], { type: 'image/png' });
    return { ...hit, png: await copy(hit.png), portrait: await copy(hit.portrait), sitPng: await copy(hit.sitPng) };
  } catch (e){ console.warn('folk bake cache unreadable, re-baking', e); return null; }
}

// the character for one villager: deterministic from the world seed and their place
export function folkCharacter(n, worldSeed, index){
  const g = n.group, gender = /^female/.test(n.slug || '') ? 'f' : 'm';
  const seed = hash(`${worldSeed}|${g?.id ?? 'x'}|${index}|${n.slug}`);
  const kin = g && (g.kind === 'family' || g.kind === 'clan') ? kinMark(g.id) : null;
  const look = randomLook(seed, { gender, kin });
  const body = randomBody(seed, gender);
  if (n.role === 'elder') body.age = Math.max(body.age, 0.9);
  if (n.role === 'child'){ body.age = 0.6; body.height -= 0.06; body.girth = Math.min(body.girth, 0.95); }
  return { seed, look, body };
}

// bake (or fetch from cache) every eligible villager; onProgress(i, n)
export async function bakeFolk(npcs, worldSeed, onProgress = () => {}){
  const todo = npcs.filter(wantsBake);
  if (!todo.length || !bakedFolkEnabled()) return 0;
  const [kit, maps, masks, ...clips] = await Promise.all([loadBodyKit(), loadAvatarMaps(), loadSkinMasks(), ...CLIPS.map(c => loadClip(c))]);
  let baker = null, done = 0;
  for (const [i, n] of todo.entries()){
    onProgress(i, todo.length);
    try {
      const { seed, look, body } = folkCharacter(n, worldSeed, n.group ? n.group.npcs.indexOf(n) : i);
      const ci = seed % CLIPS.length, clip = clips[ci];
      const key = `v${VERSION}|${CLIPS[ci]}|${ARM_OUT}|${hash(JSON.stringify({ look, body }))}`;
      let hit = await cacheGet(key);
      if (hit) hit = await inMemory(hit);
      if (!hit){
        baker ??= createBaker();
        const av = await makeAvatar(kit, look, body, { env: baker.env, maps, masks, seed });
        const out = baker.bake(av, clip, { armOut: ARM_OUT });
        const face = baker.portrait(av, clip);
        const sit = baker.sit(av, out);                       // seated at a fire or in a hut
        av.dispose();
        hit = { png: await toBlob(out.canvas), m: out.m, frameM: out.frameM, portrait: await toBlob(face),
          sitPng: await toBlob(sit.canvas), sitM: sit.m };
        cachePut(key, hit);
      }
      n.setAtlas(await toImage(hit.png), hit.m, hit.frameM);
      n.setPoseAtlas('sitting', await toImage(hit.sitPng), hit.sitM);
      n.portrait = URL.createObjectURL(hit.portrait);
      n.look = look; n.bodyParams = body;
      done++;
    } catch (e){ console.warn('folk bake failed for', n.slug, e); }
    await new Promise(r => setTimeout(r, 0));              // let the loading bar paint
  }
  baker?.dispose();
  onProgress(todo.length, todo.length);
  return done;
}
