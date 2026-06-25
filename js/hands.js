// Doom-style first-person hands. A flat image pinned to the bottom-centre of the
// view that gently bobs up/down (with a slight sway) while the player walks. It is
// drawn as an overlay pass through the SAME renderer as the world, so it inherits
// the low-res upscale + colour pipeline and stays visually consistent (no crisp DOM
// sprite floating over a pixelated scene).
import * as THREE from 'three';

export function createHands(src = '/hands1.png'){
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // normalised device coords
  let imgA = 317 / 103;                                           // hands1.png aspect (w/h)
  const tex = new THREE.TextureLoader().load(src, t => { imgA = t.image.width / t.image.height; });
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;   // keep it chunky
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  scene.add(mesh);

  let phase = 0, amp = 0, visible = false;

  function update(dt, { moving, running, visible: vis, tint }){
    visible = vis; mesh.visible = vis;
    if (!vis) return;
    if (tint) mat.color.copy(tint);
    amp += ((moving ? 1 : 0) - amp) * Math.min(1, dt * 8);        // ease the bob in/out
    const f = running ? 2.5 : 1.7;                                // steps per second-ish
    phase += dt * f * Math.PI * 2 * (0.35 + 0.65 * amp);
    const aspect = innerWidth / innerHeight;
    const ndcW = 2 * 0.50;                                        // ~half the screen width
    const ndcH = ndcW * (1 / imgA) * aspect;                     // preserve the image aspect
    mesh.scale.set(ndcW, ndcH, 1);
    const bob  = Math.sin(phase)       * 0.024 * amp;            // vertical, once per step
    const sway = Math.sin(phase * 0.5) * 0.013 * amp;            // horizontal, once per stride
    const restY = -1 + ndcH * 0.5 - 0.09;                        // peek up from the bottom edge
    mesh.position.set(sway, restY + bob, 0);
  }

  function render(renderer){
    if (!visible) return;
    const prevAuto = renderer.autoClear; renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, cam);
    renderer.autoClear = prevAuto;
  }

  return { update, render };
}
