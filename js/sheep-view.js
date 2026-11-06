// Sheep, drawn (docs/sheep.md). A thin low-poly body with a painted face and hooves, and the wool as
// player-facing puffs, so a sheep can be washed and shorn. Two draws for every sheep there is: one instanced
// body, one instanced quad per puff. Each sheep is a row in a small float texture, so moving a flock is
// one small upload. No skeleton: the vertex shader swings the legs and dips the neck, and a puff rides its part.
import * as THREE from 'three';
import { crisp } from './textures.js';
import { mulberry32 } from './rng.js';
import { UNITS_PER_M } from './config.js';
import { buildFleece, FLEECE_DEPTH, TORSO, HEAD, TORSO_RINGS } from './fleece.js';

// body parts, as the shader knows them
const LEG_FL = 1, LEG_FR = 2, LEG_BL = 3, LEG_BR = 4;

// --------------------------------------------------------------------- the painted atlas
const ATLAS = 64;
const CELL = {             // x, y, w, h, in atlas pixels
  skin:   [0, 0, 16, 16],
  side:   [16, 0, 16, 16],
  top:    [32, 0, 16, 16],
  muzzle: [48, 0, 16, 16],
  leg:    [0, 16, 8, 16],
  horn:   [8, 16, 8, 16],
  ear:    [16, 16, 8, 8],
  brow:   [24, 16, 16, 16],
  sideR:  [40, 16, 16, 16],
  snout:  [56, 16, 8, 8],
};
const BROWN = '#7d5c3a', BROWN_D = '#664a2e', BROWN_L = '#98744c', NOSE = '#3a2a20', HOOF = '#2b2119', EYE = '#17110d', GLINT = '#f6f1e6';

function paintAtlas(){
  const cv = document.createElement('canvas'); cv.width = cv.height = ATLAS;
  const g = cv.getContext('2d');
  const rect = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  const speck = ([cx, cy, cw, ch], col, n, seed) => { const r = mulberry32(seed); for (let i = 0; i < n; i++) rect(col, cx + (r() * cw | 0), cy + (r() * ch | 0), 1, 1); };

  // shorn skin: pale cream, a little stubble
  rect('#e4d6bd', ...CELL.skin); speck(CELL.skin, '#d3c2a4', 40, 3);

  // The head's faces run lengthwise: a cell's top row (y) is at the nose, its bottom at the back of the head.
  // The eye sits on the edge between side and top and carries over it, so one eye reads from the side and the front.
  // Across a side cell, x runs low to high on the -x side and high to low on the +x side, hence two cells.
  let [x, y] = CELL.side;
  rect(BROWN, ...CELL.side); speck(CELL.side, BROWN_D, 14, 5);
  rect(EYE, x + 13, y + 5, 3, 5); rect(GLINT, x + 14, y + 6, 1, 1);
  [x, y] = CELL.sideR;
  rect(BROWN, ...CELL.sideR); speck(CELL.sideR, BROWN_D, 14, 6);
  rect(EYE, x, y + 5, 3, 5); rect(GLINT, x + 1, y + 6, 1, 1);

  // the top of the head, the same eye at each edge
  [x, y] = CELL.top;
  rect(BROWN, ...CELL.top); speck(CELL.top, BROWN_D, 14, 7);
  for (const ex of [x, x + 13]) rect(EYE, ex, y + 5, 3, 5);

  // the muzzle: a sheep's nose is one soft pad, wide at the top and coming to a point, with a line down to a
  // small mouth that turns up at the ends. Separate dots here read as a second tiny face.
  [x, y] = CELL.muzzle;
  rect(BROWN_L, ...CELL.muzzle);
  rect(NOSE, x + 3, y + 2, 10, 2); rect(NOSE, x + 4, y + 4, 8, 1); rect(NOSE, x + 6, y + 5, 4, 1); rect(NOSE, x + 7, y + 6, 2, 1);
  rect(NOSE, x + 7, y + 7, 2, 4);
  rect(NOSE, x + 4, y + 11, 8, 1); rect(NOSE, x + 3, y + 10, 1, 1); rect(NOSE, x + 12, y + 10, 1, 1);
  rect(BROWN_L, ...CELL.snout);

  // the leg, and its hoof at the bottom
  [x, y] = CELL.leg;
  rect(BROWN, ...CELL.leg); speck(CELL.leg, BROWN_D, 10, 9);
  rect(HOOF, x, y + 13, 8, 3);

  // the horn: ridged, paler toward the tip
  [x, y] = CELL.horn;
  rect('#a58d68', ...CELL.horn);
  for (let i = 2; i < 16; i += 3) rect('#7c6748', x, y + i, 8, 1);

  rect(BROWN_D, ...CELL.ear);
  rect(BROWN, ...CELL.brow); speck(CELL.brow, BROWN_D, 14, 11);

  const t = crisp(new THREE.CanvasTexture(cv));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --------------------------------------------------------------------- the body
// All in metres at this stage; the shader scales to world units. The sheep faces +Z, standing on y = 0.
function buildBody(){
  const pos = [], nor = [], uv = [], part = [], idx = [];
  const uvOf = ([cx, cy, cw, ch]) => {       // corners a,b,c,d: bottom-left, bottom-right, top-right, top-left
    const e = 0.02;
    const u0 = (cx + e) / ATLAS, u1 = (cx + cw - e) / ATLAS, v1 = 1 - (cy + e) / ATLAS, v0 = 1 - (cy + ch - e) / ATLAS;
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  };
  // a flat quad, wound so that it faces away from `inside`
  const quad = (a, b, c, d, cell, p, inside) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map(k => k / l);
    const to = [a[0] - inside[0], a[1] - inside[1], a[2] - inside[2]];
    const out = n[0] * to[0] + n[1] * to[1] + n[2] * to[2] >= 0;
    if (!out) n = n.map(k => -k);
    const base = pos.length / 3, t = uvOf(cell);
    [a, b, c, d].forEach((q, i) => { pos.push(...q); nor.push(...n); uv.push(...t[i]); part.push(p); });
    if (out) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  // a 4-sided thing from one ring to another. Rings run [+x low, -x low, -x high, +x high] seen from `a` toward `b`
  const hull = (a, b, cells, p) => {
    const inside = [0, 1, 2].map(k => (a[0][k] + a[2][k] + b[0][k] + b[2][k]) / 4);
    for (let i = 0; i < 4; i++){
      const j = (i + 1) % 4;
      quad(a[i], a[j], b[j], b[i], cells[i] || cells[0], p, inside);
    }
    if (cells.capA) quad(a[0], a[1], a[2], a[3], cells.capA, p, inside);
    if (cells.capB) quad(b[1], b[0], b[3], b[2], cells.capB, p, inside);
  };
  // an upright ring
  const ring = (cx, cy, cz, hw, hh) => [[cx + hw, cy - hh, cz], [cx - hw, cy - hh, cz], [cx - hw, cy + hh, cz], [cx + hw, cy + hh, cz]];
  // a level ring
  const level = (cx, y, cz, hw, hd) => [[cx + hw, y, cz - hd], [cx - hw, y, cz - hd], [cx - hw, y, cz + hd], [cx + hw, y, cz + hd]];

  // the barrel: eight-sided rings along Z, since a shorn sheep shows all of it
  const rings = TORSO_RINGS;
  const round = ([z, y, w, h], i) => { const a = (i + 0.5) / 8 * Math.PI * 2; return [Math.cos(a) * w, y + Math.sin(a) * h, z]; };
  const mid = [0, 0.5, 0];
  for (let r = 0; r + 1 < rings.length; r++) for (let i = 0; i < 8; i++)
    quad(round(rings[r], i), round(rings[r], i + 1), round(rings[r + 1], i + 1), round(rings[r + 1], i), CELL.skin, TORSO, mid);
  // the tail: a little stub
  hull(ring(0, 0.55, -0.42, 0.03, 0.03), ring(0, 0.43, -0.49, 0.02, 0.02), [CELL.skin], TORSO);

  // legs: top is at the hip, hoof on the ground
  for (const [p, lx, lz] of [[LEG_FL, 0.10, 0.28], [LEG_FR, -0.10, 0.28], [LEG_BL, 0.10, -0.30], [LEG_BR, -0.10, -0.30]])
    hull(level(lx, 0, lz, 0.028, 0.032), level(lx, 0.46, lz, 0.04, 0.05), [CELL.leg], p);

  // the neck, and the head on it: a wedge narrowing to the nose, facing a little down
  hull(ring(0, 0.62, 0.34, 0.065, 0.08), ring(0, 0.78, 0.50, 0.055, 0.07), [CELL.brow], HEAD);
  const back = ring(0, 0.82, 0.50, 0.085, 0.085), nose = ring(0, 0.73, 0.69, 0.052, 0.05);
  // rings run low +x, low -x, high -x, high +x: under, -x side, top, +x side
  const faces = [CELL.brow, CELL.side, CELL.top, CELL.sideR]; faces.capA = CELL.brow;
  hull(back, nose, faces, HEAD);
  // the end of the snout rounds off in paler brown, and the face of it carries the nose and mouth
  const tip = ring(0, 0.722, 0.72, 0.04, 0.038), ends = [CELL.snout]; ends.capB = CELL.muzzle;
  hull(nose, tip, ends, HEAD);

  // ears, out flat from the sides, and horns sweeping up and back from the poll
  for (const s of [1, -1]){
    hull(ring(s * 0.08, 0.84, 0.50, 0.012, 0.022), ring(s * 0.17, 0.81, 0.46, 0.008, 0.03), [CELL.ear], HEAD);
    // a ram's curl rather than a goat's sweep: out, back, and round down
    const a = ring(s * 0.06, 0.88, 0.52, 0.034, 0.034);
    const b = ring(s * 0.13, 0.95, 0.47, 0.028, 0.028);
    const c = ring(s * 0.19, 0.92, 0.38, 0.021, 0.021);
    const d = ring(s * 0.20, 0.82, 0.37, 0.006, 0.006);
    hull(a, b, [CELL.horn], HEAD); hull(b, c, [CELL.horn], HEAD); hull(c, d, [CELL.horn], HEAD);
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

// where the wool goes: js/fleece.js
export { buildFleece };

// --------------------------------------------------------------------- the puff sprites: grey, lit by the shader
const PUFF_PX = 16, PUFF_FRAMES = 4;
function paintPuffs(){
  const W = PUFF_PX * PUFF_FRAMES, H = PUFF_PX, data = new Uint8Array(W * H * 4), r = mulberry32(9);
  for (let f = 0; f < PUFF_FRAMES; f++){
    const lobes = Array.from({ length: 3 }, () => [r() * 6.28, 0.02 + r() * 0.04, 2 + (r() * 3 | 0)]);
    for (let py = 0; py < H; py++) for (let px = 0; px < PUFF_PX; px++){
      const nx = (px + 0.5) / PUFF_PX * 2 - 1, ny = (py + 0.5) / PUFF_PX * 2 - 1;
      const d = Math.hypot(nx, ny), a = Math.atan2(ny, nx);
      let edge = 0.84; for (const [ph, amp, k] of lobes) edge += Math.sin(a * k + ph) * amp;
      const i = (py * W + f * PUFF_PX + px) * 4;
      if (d > edge) continue;
      // a ball lit from above: data row 0 is the texture's bottom, so +ny is up
      const z = Math.sqrt(Math.max(0, 1 - (d / edge) ** 2));
      let lum = 0.72 + 0.24 * (ny * 0.7 + z * 0.5);
      if (f === 3){   // a curl: a dark line wound inward
        const turns = (a + Math.PI) / 6.283 + d * 2.3;
        if (Math.abs(turns % 1 - 0.5) < 0.13 && d < edge * 0.92) lum -= 0.2;
      } else if (d > edge * 0.74) lum -= 0.17;
      lum = Math.round(Math.min(1, lum) * 6) / 6;       // a few flat tones, not a gradient
      const v = Math.round(lum * 255);
      data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
    }
  }
  const t = crisp(new THREE.DataTexture(data, W, H, THREE.RGBAFormat));
  t.needsUpdate = true;
  return t;
}

// --------------------------------------------------------------------- shaders
const POSE = /* glsl */`
  uniform highp sampler2D uFlock;
  uniform float uTime;
  uniform float uUnit;
  vec4 sheepA, sheepB, sheepC, sheepD;   // x y z heading | phase walk graze scale | len dirt wet seed | tint lie
  void readSheep(int id){
    sheepA = texelFetch(uFlock, ivec2(0, id), 0);
    sheepB = texelFetch(uFlock, ivec2(1, id), 0);
    sheepC = texelFetch(uFlock, ivec2(2, id), 0);
    sheepD = texelFetch(uFlock, ivec2(3, id), 0);
  }
  vec3 rotX(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c); }
  // from the sheep's own metres to where this part has swung to
  void pose(float part, inout vec3 p, inout vec3 n){
    float phase = sheepB.x, walk = sheepB.y, graze = sheepB.z, seed = sheepC.w, lie = sheepD.w;
    if (part > 0.5 && part < 4.5){
      // a walk: back left, front left, back right, front right, a quarter-stride apart
      float off = part < 1.5 ? 1.5708 : part < 2.5 ? 4.7124 : part < 3.5 ? 0.0 : 3.1416;
      vec3 hip = vec3(0.0, 0.46, part < 2.5 ? 0.28 : -0.30);   // each leg swings from its own hip
      float a = sin(phase + off) * 0.42 * walk * (1.0 - lie) + lie * (part < 2.5 ? 1.45 : -1.45);   // lying, they fold under
      p = rotX(p - hip, a) + hip; n = rotX(n, a);
    } else if (part > 4.5){
      // the neck drops to the grass, nibbling; standing, the head looks about a little
      float nibble = sin(uTime * 7.0 + seed * 40.0) * 0.05 * graze;
      float idle = sin(uTime * 0.6 + seed * 20.0) * 0.06 * (1.0 - graze);
      float a = graze * 1.72 + nibble + idle * (1.0 + lie);
      vec3 pivot = vec3(0.0, 0.60, 0.32);
      p = rotX(p - pivot, a) + pivot; n = rotX(n, a);
    }
    p.y += sin(phase * 2.0) * 0.012 * walk;   // the body rises and falls with the stride
    p.y -= lie * 0.27;                        // lying, the whole sheep sinks
  }
  vec3 toWorld(vec3 p, out vec3 axisX, out vec3 axisZ){
    float c = cos(sheepA.w), s = sin(sheepA.w);
    axisX = vec3(c, 0.0, -s); axisZ = vec3(s, 0.0, c);   // heading 0 faces +Z, as the sim's rabbits do
    return sheepA.xyz + (axisX * p.x + vec3(0.0, p.y, 0.0) + axisZ * p.z) * uUnit * sheepB.w;
  }
`;
const LIGHT = /* glsl */`
  uniform vec3 uSunDir, uSun, uAmbient;
  // wrapped, so the fleece goes round into shade instead of cutting off
  vec3 lit(vec3 n){ return uAmbient + uSun * clamp((dot(n, uSunDir) + 0.9) / 1.9, 0.0, 1.0); }
`;

const BODY_VERT = /* glsl */`
  attribute float aPart;
  varying vec2 vUv; varying vec3 vLight;
  uniform vec3 uSunDir, uSun, uAmbient;
  ${POSE}
  vec3 litBody(vec3 n){ return uAmbient + uSun * clamp((dot(n, uSunDir) + 0.3) / 1.3, 0.0, 1.0); }
  #include <fog_pars_vertex>
  void main(){
    readSheep(gl_InstanceID);
    vec3 p = position, n = normal, ax, az;
    pose(aPart, p, n);
    vec3 w = toWorld(p, ax, az);
    vec3 wn = ax * n.x + vec3(0.0, n.y, 0.0) + az * n.z;
    vUv = uv; vLight = litBody(wn) * sheepD.rgb;
    vec4 mvPosition = viewMatrix * vec4(w, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const BODY_FRAG = /* glsl */`
  uniform sampler2D uAtlas;
  varying vec2 vUv; varying vec3 vLight;
  #include <fog_pars_fragment>
  void main(){
    vec4 t = texture2D(uAtlas, vUv);
    gl_FragColor = vec4(t.rgb * vLight, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const PUFF_VERT = /* glsl */`
  uniform highp sampler2D uPuffs;
  uniform float uPuffCount, uDepth;
  uniform vec3 uClean, uDirty;
  uniform highp sampler2D uCut;      // the sheep in your hands (js/shear.js): when each puff was cut, or 0
  uniform int uHeld;
  uniform float uGather;
  varying vec2 vUv; varying vec3 vColor;
  ${POSE}
  ${LIGHT}
  #include <fog_pars_vertex>
  void main(){
    int count = int(uPuffCount);
    int puff = gl_InstanceID % count;
    readSheep(gl_InstanceID / count);
    vec4 a = texelFetch(uPuffs, ivec2(puff, 0), 0);   // place, size
    vec4 b = texelFetch(uPuffs, ivec2(puff, 1), 0);   // outward, part
    vec4 c = texelFetch(uPuffs, ivec2(puff, 2), 0);   // frame, noise
    float len = sheepC.x, dirt = sheepC.y, wet = sheepC.z;
    // wet wool lies flat, and short wool sits near the skin
    float full = len * mix(1.0, 0.55, wet);
    vec3 p = a.xyz - b.xyz * uDepth * (1.0 - full), n = b.xyz, ax, az;
    pose(b.w, p, n);
    float size = len < 0.04 ? 0.0 : a.w * mix(0.45, 1.0, full) * mix(1.0, 0.9, wet) * uUnit * sheepB.w;
    // cut: it falls, and lies on the ground either side of the sheep, until it's gathered up
    if (gl_InstanceID / count == uHeld){
      float at = texelFetch(uCut, ivec2(puff, 0), 0).r;
      if (at > 0.0){
        float k = clamp((uTime - at) / 0.55, 0.0, 1.0);
        vec3 rest = vec3(sign(a.x + 0.001) * (0.30 + abs(a.x) * 1.3) + (c.y - 0.5) * 0.12, 0.03 + c.y * 0.08, a.z * 1.2 + (fract(c.y * 7.0) - 0.5) * 0.14);
        p = vec3(mix(p.x, rest.x, k), mix(p.y, rest.y, k * k), mix(p.z, rest.z, k));
        p = mix(p, vec3(0.0, 0.1, 0.0), uGather);
        size *= 1.0 - uGather;
      }
    }
    vec3 w = toWorld(p, ax, az);
    vec3 wn = ax * n.x + vec3(0.0, n.y, 0.0) + az * n.z;
    vec4 mvPosition = viewMatrix * vec4(w, 1.0);
    mvPosition.xy += position.xy * size;          // always square to the view
    gl_Position = projectionMatrix * mvPosition;
    vUv = (vec2(c.x, 0.0) + uv) / vec2(${PUFF_FRAMES}.0, 1.0);
    // dirt goes in patches: each puff turns at its own level
    float mask = smoothstep(c.y - 0.12, c.y + 0.12, dirt * 1.24 - 0.12);
    vec3 col = mix(uClean, uDirty, mask);
    col *= mix(vec3(1.0), vec3(0.80, 0.80, 0.78), wet);
    col *= 0.95 + 0.1 * c.y;
    vColor = col * lit(wn) * sheepD.rgb;
    #include <fog_vertex>
  }
`;
const PUFF_FRAG = /* glsl */`
  uniform sampler2D uPuffTex;
  varying vec2 vUv; varying vec3 vColor;
  #include <fog_pars_fragment>
  void main(){
    vec4 t = texture2D(uPuffTex, vUv);
    if (t.a < 0.5) discard;
    gl_FragColor = vec4(vColor * t.r, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const linear = hex => new THREE.Color(hex);    // THREE.Color takes hex as sRGB and holds it linear

// --------------------------------------------------------------------- the view
export class SheepView {
  constructor(scene, capacity = 64){
    this.scene = scene; this.capacity = capacity;
    this.data = new Float32Array(capacity * 4 * 4);
    this.flock = new THREE.DataTexture(this.data, 4, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.flock.magFilter = this.flock.minFilter = THREE.NearestFilter;
    this.flock.needsUpdate = true;

    const light = { uSunDir: { value: new THREE.Vector3(-0.4, 0.8, 0.45).normalize() }, uSun: { value: new THREE.Color(0.62, 0.58, 0.5) }, uAmbient: { value: new THREE.Color(0.56, 0.54, 0.52) } };
    const shared = { uFlock: { value: this.flock }, uTime: { value: 0 }, uUnit: { value: UNITS_PER_M }, ...light };
    this.shared = shared;

    // the body
    const bodyGeo = buildBody();
    this.bodyTris = bodyGeo.index.count / 3;
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, uAtlas: { value: paintAtlas() } },
      vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, fog: true,
    });
    this.body = new THREE.Mesh(bodyGeo, bodyMat);

    // the wool
    const puffs = buildFleece(); this.puffCount = puffs.length;
    const tpl = new Float32Array(puffs.length * 3 * 4);
    puffs.forEach((q, i) => {
      tpl.set([...q.p, q.size], i * 4);
      tpl.set([...q.n, q.part], (puffs.length + i) * 4);
      tpl.set([q.frame, q.noise, 0, 0], (2 * puffs.length + i) * 4);
    });
    const puffTex = new THREE.DataTexture(tpl, puffs.length, 3, THREE.RGBAFormat, THREE.FloatType);
    puffTex.magFilter = puffTex.minFilter = THREE.NearestFilter; puffTex.needsUpdate = true;
    // one sheep at a time can be in your hands, so one row of cuts
    this.cutData = new Float32Array(puffs.length);
    this.cutTex = new THREE.DataTexture(this.cutData, puffs.length, 1, THREE.RedFormat, THREE.FloatType);
    this.cutTex.magFilter = this.cutTex.minFilter = THREE.NearestFilter; this.cutTex.needsUpdate = true;

    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    const puffMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...shared, uPuffs: { value: puffTex }, uPuffTex: { value: paintPuffs() },
        uPuffCount: { value: puffs.length }, uDepth: { value: FLEECE_DEPTH },
        uCut: { value: this.cutTex }, uHeld: { value: -1 }, uGather: { value: 0 },
        uClean: { value: linear(0xf7f3e8) }, uDirty: { value: linear(0xb49c78) } },
      vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG, fog: true,
    });
    this.wool = new THREE.Mesh(quad, puffMat);
    this.puffMat = puffMat;

    for (const m of [this.body, this.wool]){ m.frustumCulled = false; scene.add(m); }   // instances span the flock
    this.setCount(0);
  }
  setCount(n){
    this.count = Math.min(n, this.capacity);
    this.body.geometry.instanceCount = this.count;
    this.wool.geometry.instanceCount = this.count * this.puffCount;
  }
  // one sheep's state; x,z in world units, y the ground under it; tint its light (daylight, a lantern). Called for every
  // sheep every frame, so it writes in place
  set(i, s, y = s.y ?? 0, tint = null){
    const d = this.data, o = i * 16;
    d[o] = s.x ?? 0; d[o + 1] = y; d[o + 2] = s.z ?? 0; d[o + 3] = s.heading ?? 0;
    d[o + 4] = s.phase ?? 0; d[o + 5] = s.walk ?? 0; d[o + 6] = s.graze ?? 0; d[o + 7] = s.scale ?? 1;
    d[o + 8] = s.len ?? 1; d[o + 9] = s.dirt ?? 0; d[o + 10] = s.wet ?? 0; d[o + 11] = s.seed ?? (i * 0.137 % 1);
    d[o + 12] = tint ? tint.r : 1; d[o + 13] = tint ? tint.g : 1; d[o + 14] = tint ? tint.b : 1; d[o + 15] = s.lie ?? 0;
  }
  // which instance is in your hands (-1, none), for this frame
  setHeld(i){ this.puffMat.uniforms.uHeld.value = i; }
  markCut(){ this.cutTex.needsUpdate = true; }
  setGather(g){ this.puffMat.uniforms.uGather.value = g; }
  setLight({ sunDir, sun, ambient } = {}){
    if (sunDir) this.shared.uSunDir.value.copy(sunDir).normalize();
    if (sun) this.shared.uSun.value.copy(sun);
    if (ambient) this.shared.uAmbient.value.copy(ambient);
  }
  update(time){
    this.shared.uTime.value = time;
    this.flock.needsUpdate = true;
  }
  get tris(){ return this.count * (this.bodyTris + this.puffCount * 2); }
}
