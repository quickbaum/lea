import * as THREE from 'three';
import { PERSON_H } from './config.js';
import { height } from './terrain.js';
import { makeLabel } from './label.js';

// A named, camera-facing avatar (a peasant billboard + floating name tag).
// Used to give a tester an in-world presence — e.g. "Claude Opus 4.8" — so we
// share a vantage while diagnosing. Returns { x, z, update(cam), moveTo(x,z) }.
export async function addAvatar(scene, { x = 0, z = 18, slug = 'male-peasant-elf', name = 'Claude' } = {}){
  const loader = new THREE.TextureLoader();
  let aspect = 0.5;
  try {
    const list = await (await fetch('sprites/billboards/manifest.json')).json();
    const e = list.find(s => s.slug === slug) || list[0];
    if (e){ slug = e.slug; aspect = e.w / e.h; }
  } catch (_) {}

  const tex = await new Promise((res) => loader.load(`sprites/billboards/${slug}.png`, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    res(t);
  }));

  const h = PERSON_H, w = h * aspect;
  const body = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, transparent: true, fog: true })
  );
  const label = makeLabel(name, { color: '#9fd0ff' });
  scene.add(body); scene.add(label);

  const api = {
    x, z,
    moveTo(nx, nz){
      api.x = nx; api.z = nz;
      const gy = height(nx, nz);
      body.position.set(nx, gy + h / 2, nz);
      label.position.set(nx, gy + h + 0.7, nz);
    },
    update(cam){ body.rotation.y = Math.atan2(cam.position.x - api.x, cam.position.z - api.z); },
  };
  api.moveTo(x, z);
  return api;
}

// A general named billboard character from an arbitrary sprite (e.g. Puck).
// Aspect is read from the loaded image so it isn't squashed.
export async function addCharacter(scene, { src, x = 0, z = 0, name = '', worldH = 2.0, labelColor = '#fff' }){
  const loader = new THREE.TextureLoader();
  const tex = await new Promise((res) => loader.load(src, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    res(t);
  }));
  const aspect = (tex.image.width || 1) / (tex.image.height || 1);
  const h = worldH, w = h * aspect;
  const body = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, transparent: true, fog: true })
  );
  const label = name ? makeLabel(name, { color: labelColor }) : null;
  scene.add(body); if (label) scene.add(label);
  const api = {
    x, z, label,
    moveTo(nx, nz){
      api.x = nx; api.z = nz;
      const gy = height(nx, nz);
      body.position.set(nx, gy + h / 2, nz);
      if (label) label.position.set(nx, gy + h + 0.6, nz);
    },
    update(cam){ body.rotation.y = Math.atan2(cam.position.x - api.x, cam.position.z - api.z); },
  };
  api.moveTo(x, z);
  return api;
}
