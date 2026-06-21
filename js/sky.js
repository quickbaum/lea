import * as THREE from 'three';

// sky.js — a simple geocentric sky.
//
// The world sits still; the Sun and Moon ride the ecliptic and the whole
// celestial sphere turns about the pole once per sidereal day (the ancient
// model). Stars come from a real catalogue (RA/Dec), so real constellations
// appear in their correct relative places and rise/set correctly for the
// observer's latitude. Astrology hooks (sun/moon/star directions) are exposed
// for later — for now this just renders.
//
// Frame: world +Y up, North = -Z, East = +X. A star at equatorial (RA,Dec) is a
// unit vector with the celestial pole along +Y; the whole field is rotated by
// (spin about pole by sidereal angle) then (tilt the pole down to altitude =
// latitude, due north). Sun/Moon use the same rotation so everything agrees.

const DEG = Math.PI / 180;
const OBLIQ = 23.4393 * DEG;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ecliptic longitude -> equatorial [RA, Dec] (radians), ecliptic latitude 0
function eclToEq(lon){
  const sl = Math.sin(lon), cl = Math.cos(lon);
  return [Math.atan2(Math.cos(OBLIQ) * sl, cl), Math.asin(Math.sin(OBLIQ) * sl)];
}
function eqUnit(ra, dec, out){
  const cd = Math.cos(dec);
  return out.set(cd * Math.cos(ra), Math.sin(dec), cd * Math.sin(ra));
}
// rough B-V colour index -> RGB tint
function bv2rgb(bv){
  if (bv < 0.0)  return [0.70, 0.80, 1.0];
  if (bv < 0.4)  return [0.86, 0.91, 1.0];
  if (bv < 0.8)  return [1.0,  0.98, 0.92];
  if (bv < 1.2)  return [1.0,  0.92, 0.78];
  return            [1.0,  0.82, 0.62];
}

// ── canvas textures ────────────────────────────────────────────────────────
function discTexture(draw){
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function sunTexture(){
  return discTexture(g => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,245,1)');
    grd.addColorStop(0.25, 'rgba(255,240,190,1)');
    grd.addColorStop(0.5, 'rgba(255,200,120,0.5)');
    grd.addColorStop(1, 'rgba(255,180,80,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  });
}
function drawMoon(g, illum, waxing){
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = '#0c0e16'; g.beginPath(); g.arc(32, 32, 22, 0, 7); g.fill();   // dark disc
  g.save(); g.beginPath(); g.arc(32, 32, 22, 0, 7); g.clip();
  g.fillStyle = '#e8ecf4';
  // lit region: half disc + terminator ellipse
  const k = clamp(illum, 0, 1);
  const term = 22 * (1 - 2 * k);                       // signed terminator half-width
  g.beginPath();
  if (waxing) g.arc(32, 32, 22, -Math.PI/2, Math.PI/2, false);   // right half lit
  else        g.arc(32, 32, 22, Math.PI/2, -Math.PI/2, false);   // left half lit
  g.ellipse(32, 32, Math.abs(term), 22, 0, Math.PI/2, -Math.PI/2, (term > 0) === waxing);
  g.fill();
  // subtle maria
  g.fillStyle = 'rgba(150,160,180,0.35)';
  for (const [x, y, r] of [[26,26,4],[38,30,5],[30,40,3]]){ g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  g.restore();
}

// A cloud is a baked normal+coverage map: a lumpy cumulus height field turned
// into per-texel surface normals (RGB) + coverage (A). The cloud shader lights
// it from the *actual* sun direction, so painterly highlights/shadows fall on
// the right side and backlit clouds get a silver lining. Not orbs — a unifying
// base mass plus multi-scale cauliflower bumps gives an organic, painterly form.
const CLOUD_W = 200, CLOUD_H = 132;
function makeCloudTexture(){
  const W = CLOUD_W, H = CLOUD_H, h = new Float32Array(W * H), baseY = H * 0.66;
  const lump = (cx, cy, rx, ry, amp, p = 1.2) => {
    const x0 = Math.max(0, (cx-rx)|0), x1 = Math.min(W, (cx+rx+1)|0);
    const y0 = Math.max(0, (cy-ry)|0), y1 = Math.min(H, (cy+ry+1)|0);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){
      const nd = ((x-cx)/rx)**2 + ((y-cy)/ry)**2;
      if (nd < 1) h[y*W+x] += amp * Math.pow(1 - nd, p);
    }
  };
  lump(W*0.5, baseY - H*0.15, W*0.34, H*0.20, 1.0, 1.0);                 // unifying base mass
  const big = 3 + (Math.random()*3|0);
  for (let i=0;i<big;i++)
    lump(W*0.5 + (Math.random()-0.5)*W*0.5, baseY - H*0.18 - Math.random()*H*0.16,
         H*(0.16+Math.random()*0.1), H*(0.15+Math.random()*0.1), 0.85);  // billows
  const small = 16 + (Math.random()*12|0);
  for (let i=0;i<small;i++)
    lump(W*0.5 + (Math.random()-0.5)*W*0.62, baseY - H*0.1 - Math.random()*H*0.34,
         H*(0.05+Math.random()*0.06), H*(0.05+Math.random()*0.06), 0.5, 1.6);  // cauliflower
  for (let y=0;y<H;y++){                                                 // flat base
    const f = y > baseY ? Math.max(0, 1 - (y-baseY)/(H*0.06)) : 1;
    if (f < 1) for (let x=0;x<W;x++) h[y*W+x] *= f;
  }
  let mx = 0; for (let i=0;i<h.length;i++) mx = Math.max(mx, h[i]); mx = mx || 1;
  for (let i=0;i<h.length;i++) h[i] /= mx;

  const img = new ImageData(W, H), BUMP = 2.6;
  const at = (x,y) => h[Math.min(H-1,Math.max(0,y))*W + Math.min(W-1,Math.max(0,x))];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const i = (y*W+x)*4, a = h[y*W+x];
    const nx = -(at(x+1,y) - at(x-1,y)) * BUMP;
    const ny =  (at(x,y+1) - at(x,y-1)) * BUMP;     // +Y = up (texture top)
    const il = 1 / Math.hypot(nx, ny, 1);
    img.data[i]   = (nx*il*0.5+0.5)*255;
    img.data[i+1] = (ny*il*0.5+0.5)*255;
    img.data[i+2] = (il*0.5+0.5)*255;               // nz
    img.data[i+3] = a <= 0.001 ? 0 : clamp((a - 0.06) / 0.10, 0, 1) * 255;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;                 // it's a normal map, not colour
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}
// A panoramic mountain silhouette baked into one texture: several ridgelines
// stacked front-to-back (nearest lowest & darkest, farthest highest & palest),
// each outline jagged from integer harmonics so it wraps seamlessly. The red
// channel is a 0..1 depth/shade value — high at each crest, fading toward the
// valley below — which the shader turns into the sky colour, darkened by depth,
// so the ranges read as receding gradient layers of haze (real aerial
// perspective) rather than flat cut-outs.
function makeMountainTexture(){
  const W = 1024, H = 256, horizon = 0.10, N = 6;
  const img = new ImageData(W, H);
  // N stacked ridgelines: nearest (0) sits lowest, farthest (N-1) highest. Each
  // wraps seamlessly (integer harmonics) and is gated by a gentle envelope so the
  // ranges roll up and down around the horizon.
  const ridges = [];
  for (let i = 0; i < N; i++){
    const harms = [2, 3, 5, 7, 11, 13].slice(0, 4 + (i % 3));
    const ph = harms.map(() => Math.random() * Math.PI * 2);
    const baseRise = horizon + (i / (N - 1)) * 0.34;     // farther layers rise higher up
    const amp = 0.055 + 0.03 * i;                        // and grow a touch jaggier
    const envK = 1 + i, envPhase = Math.random() * Math.PI * 2;
    const arr = new Float32Array(W);
    for (let x = 0; x < W; x++){
      const a = x / W * Math.PI * 2;
      let r = 0, w = 1, tot = 0;
      for (let o = 0; o < harms.length; o++){ r += w * (0.5 + 0.5 * Math.sin(a*harms[o] + ph[o])); tot += w; w *= 0.6; }
      r /= tot;
      const env = clamp(0.65 + 0.35 * Math.sin(a*envK + envPhase), 0, 1);
      arr[x] = baseRise + amp * env * r;
    }
    ridges.push(arr);
  }
  for (let row = 0; row < H; row++){
    const hf = 1 - row / H;                              // 0 at the horizon base .. 1 at the top
    for (let x = 0; x < W; x++){
      const i4 = (row*W + x) * 4;
      let win = -1;
      for (let i = 0; i < N; i++){ if (ridges[i][x] >= hf){ win = i; break; } }   // nearest covering layer
      if (win < 0){ img.data[i4+3] = 0; continue; }      // above every ridge → open sky
      // each layer is a vertical gradient: darkest at its own crest, fading lighter
      // (hazier) down toward the valley below it; farther layers are paler overall.
      const base = 0.92 - (win / (N - 1)) * 0.60;
      const grad = clamp((ridges[win][x] - hf) / 0.16, 0, 1);
      const val = clamp(base - grad * 0.42, 0, 1);
      const v = val * 255;
      img.data[i4] = v; img.data[i4+1] = v; img.data[i4+2] = v; img.data[i4+3] = 255;
    }
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}

const CLOUD_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const CLOUD_FRAG = `
  uniform sampler2D uTex; uniform vec3 uSun, uLight, uShadow; uniform float uOpacity;
  varying vec2 vUv;
  void main(){
    vec4 t = texture2D(uTex, vUv);
    if (t.a < 0.5) discard;                         // crisp silhouette
    vec3 N = normalize(t.xyz * 2.0 - 1.0);
    vec3 L = normalize(uSun);
    float lit = dot(N, L);
    vec3 col = mix(uShadow, uLight, smoothstep(-0.2, 0.55, lit));   // painterly key
    col += uLight * smoothstep(0.6, 0.96, lit) * 0.30;             // highlight
    float back = smoothstep(0.0, -0.5, L.z);                       // sun behind cloud
    float edge = smoothstep(0.6, 0.05, N.z);                       // toward silhouette
    col += uLight * back * edge;                                   // silver lining
    float n = fract(sin(dot(vUv, vec2(127.1, 311.7))) * 43758.5453);
    col *= 0.96 + 0.08 * n;                                        // painterly grain
    gl_FragColor = vec4(col, uOpacity);
  }`;

export class Sky {
  constructor(scene, { latitude = 42, dayLength = 600, time = 0.35, sunLon = 35, yearDays = 360 } = {}){
    this.scene = scene;
    this.lat = latitude * DEG;
    this.dayLength = dayLength;          // real seconds per day-night cycle
    this.yearDays = yearDays;
    this.time = time;                    // day fraction accumulator (days)
    this.sunLon = sunLon * DEG;
    this.moonLon = this.sunLon + Math.PI;   // start near full moon
    this.R = 360;   // celestial sphere — beyond the mountains (330) so ridges can occlude it
    this.wind = new THREE.Vector2(0.7, 0.25);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qs = new THREE.Quaternion();
    this._qt = new THREE.Quaternion();
    this._moonIllum = -1;
    this.spriteTint = new THREE.Color(1, 1, 1);   // illumination for unlit billboards
    this.groundTint = new THREE.Color(1, 1, 1);   // light on flat ground (matches the Lambert terrain)
    this.evening = 0;                             // 0 by day, rises through the afternoon to dusk

    this.root = new THREE.Group(); scene.add(this.root);
    this.celestial = new THREE.Group(); this.root.add(this.celestial);   // stars + lines

    this._buildDome();
    this._buildMountains();
    this._buildClouds();
    this._buildSunMoon();
    this._buildLights();
    this.cloudCover = 0.55; this._applyCloudCover();
  }

  // ── sky dome (gradient + sun glow) ──
  _buildDome(){
    this.domeU = {
      uDay:        { value: 1 },
      uSunDir:     { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:   { value: new THREE.Color(1, 0.9, 0.7) },
      uZenith:     { value: new THREE.Color(0x2a6bc4) },
      uHorizon:    { value: new THREE.Color(0xbfd8 ) },
      uNightZenith:{ value: new THREE.Color(0x05060f) },
      uNightHoriz: { value: new THREE.Color(0x121a2e) },
    };
    this.domeU.uHorizon.value.setHex(0xbcd6ee);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, uniforms: this.domeU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform float uDay; uniform vec3 uSunDir,uSunColor,uZenith,uHorizon,uNightZenith,uNightHoriz;
        void main(){
          vec3 d = normalize(vDir);
          float t = pow(clamp(d.y,0.0,1.0), 0.5);
          vec3 day = mix(uHorizon, uZenith, t);
          vec3 night = mix(uNightHoriz, uNightZenith, t);
          vec3 col = mix(night, day, uDay);
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          float glow = pow(sd, 6.0)*0.5 + pow(sd, 220.0)*2.0;
          float sunUp = smoothstep(-0.25, 0.1, uSunDir.y);
          col += uSunColor * glow * sunUp;
          // warm band along the horizon near sunrise/sunset
          float band = pow(1.0 - clamp(d.y,0.0,1.0), 4.0) * pow(max(sd,0.0),1.5);
          col += uSunColor * band * (1.0 - abs(uSunDir.y)) * sunUp * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), mat);
    this.dome.renderOrder = -10;
    this.root.add(this.dome);
  }

  // ── distant mountains: a silhouette ring on the horizon, behind the world ──
  _buildMountains(){
    this.mtnU = {
      uTex:      { value: makeMountainTexture() },
      uSkyHoriz: { value: new THREE.Color(0xbcd6ee) },   // sky at the horizon (bright haze)
      uSkyZen:   { value: new THREE.Color(0x2a6bc4) },   // sky higher up
    };
    const mat = new THREE.ShaderMaterial({
      // depthWrite:true so the solid ridges occlude the sun/moon/stars behind them
      // (sky pixels are discarded, so they don't write depth and stay see-through)
      uniforms: this.mtnU, transparent: true, depthWrite: true, depthTest: true,
      fog: false, side: THREE.BackSide,
      vertexShader: `
        varying vec2 vUv; varying vec3 vDir;
        void main(){
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vDir = wp.xyz - cameraPosition;            // view direction, so we can read the sky behind
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform sampler2D uTex; uniform vec3 uSkyHoriz, uSkyZen;
        varying vec2 vUv; varying vec3 vDir;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          if (t.a < 0.5) discard;                    // crisp ridge outline
          // the sky colour directly behind this point (same gradient as the dome)
          vec3 d = normalize(vDir);
          vec3 sky = mix(uSkyHoriz, uSkyZen, pow(clamp(d.y, 0.0, 1.0), 0.5));
          // aerial perspective: each ridge is the local sky, darkened by depth —
          // crests (t.r high) keep real definition, valley haze (t.r low) ~= sky,
          // so layers always lighten with distance and never out-dark the sky.
          gl_FragColor = vec4(sky * mix(0.97, 0.40, t.r), 1.0);
        }`,
    });
    const R = 330, Hgt = 230;
    this.mountains = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Hgt, 128, 1, true), mat);
    this.mountains.position.y = Hgt * 0.5 - 24;       // sink the base just under the horizon
    this.mountains.renderOrder = -9;                  // after the dome, before the world
    this.mountains.frustumCulled = false;
    this.root.add(this.mountains);
  }

  // ── clouds: billboard masses lit by the real sun, drifting & wrapping around you ──
  _buildClouds(){
    this.cloudMats = [];
    for (let i = 0; i < 5; i++) this.cloudMats.push(new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: makeCloudTexture() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uLight: { value: new THREE.Color(1, 1, 1) },
        uShadow: { value: new THREE.Color(0.5, 0.58, 0.72) },
        uOpacity: { value: 0.95 },
      },
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, transparent: true, depthWrite: false,
    }));
    this.cloudR = 320;                         // clouds live within this radius of the player
    this.clouds = [];
    this.cloudGroup = new THREE.Group(); this.scene.add(this.cloudGroup);
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 16; i++){
      const m = new THREE.Mesh(geo, this.cloudMats[(Math.random()*this.cloudMats.length)|0]);
      const w = 55 + Math.random() * 95;
      m.scale.set(w, w * (CLOUD_H / CLOUD_W), 1);
      m.position.set((Math.random()*2-1)*this.cloudR, 55 + Math.random()*60, (Math.random()*2-1)*this.cloudR);
      m.renderOrder = -4;
      this.cloudGroup.add(m); this.clouds.push(m);
    }
  }

  _buildSunMoon(){
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false }));
    this.sunSprite.scale.setScalar(this.R * 0.16);
    this.moonTex = discTexture(g => drawMoon(g, 0.5, true));
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.moonTex, depthWrite: false, depthTest: true, fog: false }));
    this.moonSprite.scale.setScalar(this.R * 0.07);
    this.root.add(this.sunSprite); this.root.add(this.moonSprite);
  }

  _buildLights(){
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556b2f, 1.3);
    this.sunLight = new THREE.DirectionalLight(0xfff2d0, 0.9);
    this.moonLight = new THREE.DirectionalLight(0xaec6ff, 0.0);
    this.scene.add(this.hemi, this.sunLight, this.moonLight);
  }

  // load the real star catalogue + constellation lines (async; sky works before it lands)
  async load(){
    try {
      const [sd, cd] = await Promise.all([
        fetch('sky/stars.json').then(r => r.json()),
        fetch('sky/constellations.json').then(r => r.json()),
      ]);
      this._buildStars(sd.stars);
      this._buildConstellations(cd.lines);
    } catch (e){ console.warn('sky: no star data', e); }
  }

  _buildStars(stars){
    const n = stars.length, R = this.R - 6;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++){
      const [raDeg, decDeg, mag, bv] = stars[i];
      eqUnit(raDeg * DEG, decDeg * DEG, v).multiplyScalar(R);
      pos[i*3] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z;
      const [r, g, b] = bv2rgb(bv);
      const bright = clamp((6.6 - mag) / 6.6, 0.25, 1.0);
      col[i*3] = r*bright; col[i*3+1] = g*bright; col[i*3+2] = b*bright;
      siz[i] = clamp((6.6 - mag) * 0.9, 0.7, 6.0);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    this.starU = { uNight: { value: 0 }, uScale: { value: 1.3 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; uniform float uScale;
        varying vec3 vCol; varying float vY;
        void main(){ vCol = aColor; vec4 wp = modelMatrix * vec4(position,1.0); vY = wp.y;
          gl_Position = projectionMatrix * viewMatrix * wp; gl_PointSize = aSize * uScale; }`,
      fragmentShader: `
        uniform float uNight; varying vec3 vCol; varying float vY;
        void main(){ if (vY < 0.0 || uNight <= 0.001) discard;
          vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
          gl_FragColor = vec4(vCol, smoothstep(0.5, 0.05, r) * uNight); }`,
    });
    this.stars = new THREE.Points(geo, mat);
    this.stars.frustumCulled = false;
    this.celestial.add(this.stars);
  }

  _buildConstellations(lines){
    const segs = [], R = this.R - 8, v = new THREE.Vector3();
    for (const line of lines){
      for (let i = 0; i < line.length - 1; i++){
        for (const p of [line[i], line[i+1]]){
          eqUnit(p[0]*DEG, p[1]*DEG, v).multiplyScalar(R);
          segs.push(v.x, v.y, v.z);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3));
    this.lineU = { uNight: { value: 0 }, uColor: { value: new THREE.Color(0x5a78b0) } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.lineU, transparent: true, depthWrite: false,
      vertexShader: `varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uNight; uniform vec3 uColor; varying float vY;
        void main(){ if (vY < 0.0) discard; gl_FragColor = vec4(uColor, uNight * 0.22); }`,
    });
    this.conLines = new THREE.LineSegments(geo, mat);
    this.conLines.frustumCulled = false;
    this.celestial.add(this.conLines);
  }

  setWind(x, z){ this.wind.set(x, z); }
  getSunAltitude(){ return Math.asin(clamp(this.sunDir.y, -1, 1)); }

  // ── weather controls (Claude the daemon can drive these from dialogue) ──
  _applyCloudCover(){
    const n = Math.round(this.cloudCover * this.clouds.length);
    this.clouds.forEach((c, i) => { c.visible = i < n; });
  }
  setCloudCover(v){ this.cloudCover = clamp(v, 0, 1); this._applyCloudCover(); }
  addCloudCover(d){ this.setCloudCover((this.cloudCover ?? 0.55) + d); }
  setDayFraction(f){ this.time = Math.floor(this.time) + ((f % 1) + 1) % 1; }

  update(dt, camera){
    const rate = dt / this.dayLength;
    this.time += rate;
    this.sunLon += rate * (2 * Math.PI / this.yearDays);
    this.moonLon += rate * (2 * Math.PI / 27.32);

    const f = this.time - Math.floor(this.time);
    const Hsun = (f - 0.5) * 2 * Math.PI;
    const [raS, decS] = eclToEq(this.sunLon);
    const LST = Hsun + raS;

    // celestial sphere orientation: spin about pole, then tilt pole to latitude (north)
    this._qs.setFromAxisAngle(Y_AXIS, LST - Math.PI / 2);
    this._qt.setFromAxisAngle(X_AXIS, this.lat - Math.PI / 2);
    this._q.copy(this._qt).multiply(this._qs);
    this.celestial.quaternion.copy(this._q);

    eqUnit(raS, decS, this.sunDir).applyQuaternion(this._q).normalize();
    const [raM, decM] = eclToEq(this.moonLon);
    eqUnit(raM, decM, this.moonDir).applyQuaternion(this._q).normalize();

    this.root.position.copy(camera.position);
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(this.R);
    this.moonSprite.position.copy(this.moonDir).multiplyScalar(this.R);
    this.moonSprite.visible = this.moonDir.y > -0.05;

    const sunAlt = this.sunDir.y;                          // sine of altitude
    const day = smooth(-0.15, 0.18, sunAlt);
    const night = 1 - smooth(-0.18, -0.02, sunAlt);
    // "evening": only in the afternoon (sun past its peak, f>0.5), ramping from 0
    // while the sun is still fairly high to 1 just past sunset — so the agent layer
    // gets lead time to head for camp BEFORE dark, not only once it's cold.
    this.evening = (f > 0.5) ? smooth(0.35, -0.05, sunAlt) : 0;
    this.sunAlt = sunAlt; this.day = day; this.night = night;   // read by the agent layer

    // sun colour warms as it nears the horizon
    const warm = 1 - clamp(sunAlt * 2.2, 0, 1);
    this.domeU.uSunColor.value.setRGB(1.0, 0.85 - 0.25 * warm, 0.6 - 0.45 * warm);
    this.domeU.uDay.value = day;
    this.domeU.uSunDir.value.copy(this.sunDir);
    if (this.starU) this.starU.uNight.value = night;
    if (this.lineU) this.lineU.uNight.value = night;

    // lights
    this.sunLight.position.copy(this.sunDir).multiplyScalar(100);
    this.sunLight.intensity = clamp(sunAlt * 1.6, 0, 1) * 0.95;
    this.sunLight.color.setRGB(1.0, 0.93 - 0.2 * warm, 0.82 - 0.35 * warm);
    this.moonLight.position.copy(this.moonDir).multiplyScalar(100);
    const moonIllum = (1 - Math.cos(this.moonLon - this.sunLon)) / 2;
    this.moonIllum = moonIllum;                            // exposed for astrology (read by agents/dialogue)
    this.moonLight.intensity = clamp(this.moonDir.y, 0, 1) * 0.22 * moonIllum * night;
    this.hemi.intensity = 0.3 + 1.05 * day;
    this.hemi.color.setRGB(0.6 + 0.4 * day, 0.65 + 0.35 * day, 0.7 + 0.3 * day);

    // Light reaching flat (up-facing) ground: the hemisphere sky term in full plus
    // the sun/moon weighted by how high they sit — i.e. exactly what the Lambert
    // terrain gets on level ground. Used to tint the decorative grass so it reads
    // the same colour as the turf around it through the whole cycle.
    this.groundTint.copy(this.hemi.color).multiplyScalar(this.hemi.intensity);
    this._gTmp ||= new THREE.Color();
    this._gTmp.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity * Math.max(0, this.sunDir.y));
    this.groundTint.add(this._gTmp);
    this._gTmp.copy(this.moonLight.color).multiplyScalar(this.moonLight.intensity * Math.max(0, this.moonDir.y));
    this.groundTint.add(this._gTmp);

    const sunset = smooth(0.30, 0.0, Math.abs(sunAlt)) * smooth(-0.22, 0.08, sunAlt);

    // The sky gradient as colours (horizon + zenith), blended day/night and
    // tinted warm at sunset. The horizon band is the bright haze everything in
    // the distance fades toward; the zenith is the deeper sky overhead.
    const skyHoriz = this.domeU.uNightHoriz.value.clone().lerp(this.domeU.uHorizon.value, day)
      .lerp(this.domeU.uSunColor.value, sunset * 0.35);
    const skyZen = this.domeU.uNightZenith.value.clone().lerp(this.domeU.uZenith.value, day);
    this.scene.background = skyHoriz;

    // Distant land settles a bit below the horizon haze (real aerial perspective:
    // it's lighter than the foreground but darker than the open sky), and it sits
    // continuous with the mountains' nearest ridge so the layers read as one haze.
    const fogCol = skyHoriz.clone().multiplyScalar(0.63);
    if (this.scene.fog) this.scene.fog.color.copy(fogCol);

    // mountains read the local sky behind them and just darken it — see shader
    if (this.mtnU){
      this.mtnU.uSkyHoriz.value.copy(skyHoriz);
      this.mtnU.uSkyZen.value.copy(skyZen);
    }

    // Illumination tint for unlit billboards (people, Puck): bright by day, dim
    // and cool by night (lifted a little on bright-moon nights), warm at sunset —
    // so the sprites read as lit, matching the Lambert-shaded trees and terrain.
    const moonAdd = this.moonLight.intensity * 0.8;
    const b = clamp(0.30 + 0.72 * day + moonAdd, 0, 1);
    this.spriteTint.setRGB(1, 1, 1)
      .lerp(this.domeU.uSunColor.value, sunset * 0.5)
      .lerp(this._spriteNight ||= new THREE.Color(0.45, 0.55, 0.80), (1 - day) * 0.5)
      .multiplyScalar(b);

    // clouds: light from the actual sun direction (in billboard-local space)
    const sunLocal = new THREE.Vector3().copy(this.sunDir).applyQuaternion(camera.quaternion.clone().invert());
    const lightCol = new THREE.Color(1, 1, 1).lerp(this.domeU.uSunColor.value, sunset * 0.7)
      .multiplyScalar(0.22 + 0.78 * day);
    const shadowCol = new THREE.Color(0.50, 0.58, 0.74).multiplyScalar(0.28 + 0.55 * day);
    const cop = 0.45 + 0.5 * day;
    for (const mat of this.cloudMats){
      mat.uniforms.uSun.value.copy(sunLocal);
      mat.uniforms.uLight.value.copy(lightCol);
      mat.uniforms.uShadow.value.copy(shadowCol);
      mat.uniforms.uOpacity.value = cop;
    }
    const dx = this.wind.x * dt * 3, dz = this.wind.y * dt * 3, R = this.cloudR;
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of this.clouds){
      c.position.x += dx; c.position.z += dz;
      if (c.position.x - cx >  R) c.position.x -= 2*R; else if (c.position.x - cx < -R) c.position.x += 2*R;
      if (c.position.z - cz >  R) c.position.z -= 2*R; else if (c.position.z - cz < -R) c.position.z += 2*R;
      c.quaternion.copy(camera.quaternion);          // billboard toward camera
    }

    // moon phase texture (redraw only when it shifts noticeably)
    if (Math.abs(moonIllum - this._moonIllum) > 0.02){
      this._moonIllum = moonIllum;
      drawMoon(this.moonTex.image.getContext('2d'), moonIllum, Math.sin(this.moonLon - this.sunLon) > 0);
      this.moonTex.needsUpdate = true;
    }
  }
}
