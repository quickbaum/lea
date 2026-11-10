// An ordered (Bayer) dither over the finished frame — a port of the pose explorer's
// filter pass (~/pose-trainer/explorer). The world and the hands draw to the canvas as
// always; that picture is copied to a texture and redrawn through posterize + Bayer.
// It runs at the renderer's internal resolution, so one dither cell is one Lea pixel
// and it scales with PIXEL SIZE. Off (the default), apply() returns at once and the
// picture can't change.
import * as THREE from 'three';

const FRAG = `
  uniform sampler2D tFrame, tBayer;
  uniform vec2 uRes;
  uniform float uLevels;
  void main() {
    vec2 cell = floor(gl_FragCoord.xy);
    vec3 c = texture2D(tFrame, (cell + 0.5) / uRes).rgb;
    float d = texture2D(tBayer, (mod(cell, 4.0) + 0.5) / 4.0).r - 0.5;
    // even steps of the display value; the Bayer map spans one step's width
    c = clamp(floor(c * (uLevels - 1.0) + 0.5 - d) / (uLevels - 1.0), 0.0, 1.0);
    gl_FragColor = vec4(c, 1.0);
  }`;

// the 4×4 Bayer matrix, as thresholds in (0,1)
function bayer4(){
  const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const data = new Uint8Array(16 * 4);
  m.forEach((v, i) => { data[i * 4] = Math.round((v + 0.5) / 16 * 255); });
  const t = new THREE.DataTexture(data, 4, 4);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function makeDither(){
  const u = { tFrame: { value: null }, tBayer: { value: bayer4() },
              uRes: { value: new THREE.Vector2(1, 1) }, uLevels: { value: 4 } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, fragmentShader: FRAG,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(quad);
  const cam = new THREE.Camera(), size = new THREE.Vector2(), origin = new THREE.Vector2();
  let tex = null;
  const state = { on: false, levels: 4 };

  function apply(renderer){
    if (!state.on) return;
    renderer.getDrawingBufferSize(size);
    if (!tex || tex.image.width !== size.x || tex.image.height !== size.y){
      if (tex) tex.dispose();
      tex = new THREE.FramebufferTexture(size.x, size.y);
      u.tFrame.value = tex; u.uRes.value.copy(size);
    }
    u.uLevels.value = state.levels;
    renderer.copyFramebufferToTexture(origin, tex);
    const prevAuto = renderer.autoClear; renderer.autoClear = false;
    renderer.render(scene, cam);
    renderer.autoClear = prevAuto;
  }
  return { state, apply };
}
