import * as THREE from 'three';
import { SIZE, SEG, WATER } from './config.js';
import { makeTexture, makeGrain } from './textures.js';

// ---- heightfield (pure functions; safe to call from any generator) ----------
export function height(x, z){
  const base = Math.sin(x*0.040)*3.0 + Math.cos(z*0.038)*3.0
       + Math.sin(x*0.013)*4.2 * Math.cos(z*0.011)*1.0
       + Math.sin((x+z)*0.09)*1.3
       + Math.sin(x*0.21)*0.35 + Math.cos(z*0.24)*0.35;
  // Some broad regions are far hillier than others. A slow-varying mask gates an
  // extra band of ridged relief, so the world has calm plains AND rugged uplands
  // (squared so plains stay flat and the hilly zones rise sharply into rock).
  const m = 0.5 + 0.5 * Math.sin(x*0.0055 + 1.7) * Math.cos(z*0.0061 - 0.5);
  const hilly = m * m;
  const hills = Math.sin(x*0.075) * Math.cos(z*0.082) * 5.0
              + Math.sin((x*0.9 - z*0.6) * 0.05) * 3.5;
  return base + hilly * hills;
}
function hash(x, z){
  const n = Math.sin(x*127.1 + z*311.7) * 43758.5453;
  return n - Math.floor(n);
}

const C = {
  deep:  [0.30,0.26,0.18], sand: [0.79,0.69,0.47], mud: [0.43,0.31,0.20],
  grass: [0.36,0.48,0.23], rock: [0.49,0.47,0.44],
};
export function biome(x, z, h = height(x, z)){
  const hb = h + (hash(Math.floor(x), Math.floor(z)) - 0.5) * 1.1;
  if (hb < WATER)       return C.deep;
  if (hb < WATER + 0.9) return C.sand;
  if (hb < WATER + 2.6) return C.mud;
  if (hb < 4.8)         return C.grass;
  return C.rock;
}
export function terrainType(x, z){
  const hb = height(x,z) + (hash(Math.floor(x), Math.floor(z)) - 0.5) * 1.1;
  if (hb < WATER)       return 'water';
  if (hb < WATER + 0.9) return 'sand';
  if (hb < WATER + 2.6) return 'mud';
  if (hb < 4.8)         return 'grass';
  return 'rock';
}
export const walkable = (x, z) => height(x, z) > WATER + 0.25;

// Soil richness 0..1: moist lowland grass/mud is rich; dry sand and high rock
// are poor. Plants grown on richer soil fill out broader and fuller.
export function soilRichness(x, z){
  const ty = terrainType(x, z);
  if (ty === 'water') return 0;
  if (ty === 'rock')  return 0.05;
  if (ty === 'sand')  return 0.2;
  const moist = Math.max(0, Math.min(1, (4.8 - height(x, z)) / 6));  // lower = wetter
  return Math.min(1, (ty === 'mud' ? 0.7 : 0.5) + moist * 0.4);
}

// A reproducible random point on chosen terrain types, within a radius.
export function randomLand(rng, radius = 95, allowed = null){
  for (let t = 0; t < 80; t++){
    const x = (rng() - 0.5) * radius * 2, z = (rng() - 0.5) * radius * 2;
    if (Math.hypot(x, z) > radius) continue;
    if (!allowed || allowed.has(terrainType(x, z))) return [x, z];
  }
  return [0, 0];
}

// ---- meshes -----------------------------------------------------------------
export function buildTerrain(scene){
  const grain = makeGrain();

  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++){
    const x = pos.getX(i), z = pos.getZ(i), h = height(x, z);
    pos.setY(i, h);
    const c = biome(x, z, h);
    const j = 0.92 + hash(x*3.3, z*3.3) * 0.16;
    col[i*3] = c[0]*j; col[i*3+1] = c[1]*j; col[i*3+2] = c[2]*j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({vertexColors: true, map: grain}));
  scene.add(ground);

  const waterTex = makeTexture(64, 64, (g) => {
    g.fillStyle = '#2f6db0'; g.fillRect(0,0,64,64);
    for (let i = 0; i < 160; i++){
      g.fillStyle = Math.random() < .5 ? '#3f86cf' : '#235a96';
      g.fillRect(Math.random()*64|0, Math.random()*64|0, 2, 1);
    }
  }, {repeat: [30, 30]});
  const waterGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  waterGeo.rotateX(-Math.PI/2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({
    map: waterTex, transparent: true, opacity: 0.78, depthWrite: false, color: 0xbfe0ff
  }));
  water.position.y = WATER;
  scene.add(water);

  return { ground, water, waterTex };
}
