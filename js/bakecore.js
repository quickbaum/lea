// Shared bake pipeline — the scene/lights/orthographic-turntable rig that turns a
// 3D subject into the runtime sprite atlas (rows = facings front->back, mirrored to
// 8 dirs by npc.js; cols = stand + walk frames). Lifted from baker.js so the avatar
// studio and the model baker share one implementation.
//
// Unlike baker.js (which drove a Mixamo AnimationMixer), this is pose-function
// driven: callers pass poseFn(frac, isStand) which poses the subject for each cell.

import * as THREE from 'three';

const TARGET_H = 2.0;   // subject normalised to this height before framing
const PAD = 1.08;       // frustum padding so the silhouette doesn't touch the cell edge

export class BakeStudio {
  constructor(previewCanvas){
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene = new THREE.Scene();
    this.hemi = new THREE.HemisphereLight(0xeef2ff, 0x4a4636, 1.1);
    this.key  = new THREE.DirectionalLight(0xfff4e6, 2.2);
    this.fill = new THREE.DirectionalLight(0xcfe0ff, 1.1);
    this.rim  = new THREE.DirectionalLight(0xbcd0ff, 0.5); this.rim.position.set(2, 2, -3);
    this.scene.add(this.hemi, this.key, this.fill, this.rim);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
    this.turntable = new THREE.Group(); this.scene.add(this.turntable);
    this.bbox = new THREE.Box3();
    this.subject = null;

    this.previewCanvas = previewCanvas;
    this.pctx = previewCanvas ? previewCanvas.getContext('2d') : null;
    // live, caller-tweakable look
    this.light = { exposure: 1.25, key: 2.2, fill: 1.1, keyAz: -35, tilt: 0, baseYaw: 0 };
  }

  // place a subject (Object3D) in the turntable, normalised: scaled to TARGET_H,
  // feet on the floor, centred on x/z.
  setSubject(obj){
    [...this.turntable.children].forEach(c => this.turntable.remove(c));
    obj.updateWorldMatrix(true, true);
    let b = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); b.getSize(size);
    obj.scale.multiplyScalar(size.y > 0 ? TARGET_H / size.y : 1);
    obj.updateWorldMatrix(true, true);
    b = new THREE.Box3().setFromObject(obj);
    const c = new THREE.Vector3(); b.getCenter(c);
    obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y;
    obj.updateWorldMatrix(true, true);
    // (Skinned meshes are bound at identity in compose(); three.js applies this group's
    // scale + the turntable rotation as ancestor transforms correctly — same as baker.js
    // did with the loaded goblin. No re-bind needed.)
    this.turntable.add(obj);
    this.subject = obj;
    this.bbox = new THREE.Box3().setFromObject(obj);
  }

  _applyLight(){
    const az = THREE.MathUtils.degToRad(this.light.keyAz);
    this.key.position.set(Math.sin(az) * 4, 4, Math.cos(az) * 4 + 1);
    this.fill.position.set(-Math.sin(az) * 4, 2, -Math.cos(az) * 2 + 2);
    this.key.intensity = this.light.key;
    this.fill.intensity = this.light.fill;
    this.renderer.toneMappingExposure = this.light.exposure;
  }

  _frame(aspect){
    const size = new THREE.Vector3(); this.bbox.getSize(size);
    const ctr = new THREE.Vector3(); this.bbox.getCenter(ctr);
    const halfH = size.y * 0.5 * PAD, halfW = halfH * aspect, cam = this.camera;
    cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.01; cam.far = 100; cam.updateProjectionMatrix();
    const t = THREE.MathUtils.degToRad(this.light.tilt), d = 20;
    cam.position.set(ctr.x, ctr.y + Math.sin(t) * d, ctr.z + Math.cos(t) * d);
    cam.lookAt(ctr.x, ctr.y, ctr.z);
  }

  // draw the live preview: spin (radians extra yaw), poseFn(frac,false) for the gait
  renderPreview(poseFn, spin, tSec, walkSpeed = 1){
    if (!this.subject) return;
    this._applyLight();
    const W = this.previewCanvas.width, H = this.previewCanvas.height;
    this.renderer.setSize(W, H, false);
    this._frame(W / H);
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.light.baseYaw) + spin;
    if (poseFn) poseFn((tSec * walkSpeed) % 1, false);
    this.renderer.render(this.scene, this.camera);
    this.pctx.clearRect(0, 0, W, H);
    this.pctx.drawImage(this.renderer.domElement, 0, 0);
  }

  // front-facing silhouette aspect → cell width (keeps in-world proportions)
  autoCellW(cellH){
    this.turntable.rotation.y = THREE.MathUtils.degToRad(this.light.baseYaw);
    this.turntable.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(this.turntable);
    const s = new THREE.Vector3(); b.getSize(s);
    return Math.max(32, Math.round(cellH * (s.y > 0 ? s.x / s.y : 0.5)));
  }

  // bake into atlasCanvas; returns {cols,rows,walkLen,cellW,cellH}
  bake(atlasCanvas, { rows = 5, walkLen = 9, cellH = 256, cellW = 0, poseFn } = {}){
    const cols = walkLen + 1;
    if (cellW <= 0) cellW = this.autoCellW(cellH);
    atlasCanvas.width = cols * cellW; atlasCanvas.height = rows * cellH;
    const actx = atlasCanvas.getContext('2d');
    actx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    this._applyLight();
    this.renderer.setSize(cellW, cellH, false);
    this._frame(cellW / cellH);
    const baseYaw = THREE.MathUtils.degToRad(this.light.baseYaw);
    for (let r = 0; r < rows; r++){
      this.turntable.rotation.y = baseYaw + (rows > 1 ? r * (Math.PI / (rows - 1)) : 0);
      for (let c = 0; c < cols; c++){
        const isStand = c === 0, frac = isStand ? 0 : (c - 1) / walkLen;
        if (poseFn) poseFn(frac, isStand);
        this.turntable.updateWorldMatrix(true, true);
        this.renderer.render(this.scene, this.camera);
        actx.drawImage(this.renderer.domElement, c * cellW, r * cellH, cellW, cellH);
      }
    }
    return { cols, rows, walkLen, cellW, cellH };
  }

  // POST the atlas to the server save endpoint (writes sprites/npc/<slug>.png + manifest)
  async save(atlasCanvas, slug, meta){
    const png = atlasCanvas.toDataURL('image/png');
    const res = await fetch('/api/save-sprite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, png, frameW: meta.cellW, frameH: meta.cellH,
        cols: meta.cols, rows: meta.rows, walkLen: meta.walkLen }) });
    return res.json();
  }
}
