// tree-faces.js — the carved faces on the few speaking trees.
//
// Most of the wood is faceless and examined by sensation (js/wood-talk.js). A
// small, special set of trees instead wear a face carved into the bark — always
// visible, on ONE side only, so you have to come round to find it — and, unlike
// the sense-only trees, they actually talk. The eyes are dark until you examine
// the tree, then glow in and answer to its live state (night, depth in the
// threads, a fire in its news).
//
// View layer only: a fixed-orientation decal quad on the trunk (NOT a
// camera-billboard — the face keeps its side). The art is two registered layers,
// `sprites/face/tree-face.png` (the shadow face) and `-eyes.png` (the glow),
// cropped here to the face's alpha box so both align on the same quad.

import * as THREE from 'three';

const FACE_SRC = 'sprites/face/tree-face.png';
const EYES_SRC = 'sprites/face/tree-face-eyes.png';
// alpha box of the shadow-face layer; the eyes are cropped to the SAME box so the
// two quads line up pixel for pixel (see tools/check — measured from the sprites)
const CROP = [61, 112, 510, 994];
const CW = CROP[2] - CROP[0], CH = CROP[3] - CROP[1];   // 449 x 882
const ASPECT = CH / CW;

// trunk half-widths by species (matches the obstacle radii in flora.js)
const TRUNK_R = { redwood: 1.4, oak: 1.0, birch: 0.6, rowan: 0.5 };

function loadCropped(src){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
      cv.getContext('2d').drawImage(img, CROP[0], CROP[1], CW, CH, 0, 0, CW, CH);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      res(t);
    };
    img.onerror = rej;
    img.src = src;
  });
}

const EYE_WARM = new THREE.Color(1.0, 0.86, 0.25);   // ordinary glow
const EYE_COLD = new THREE.Color(0.85, 0.95, 1.0);   // a fire in its news

export class TreeFaces {
  constructor(scene, height){ this.scene = scene; this.height = height; this.faces = []; this.ready = false; }

  // faced: [{ node, yaw }] — node from mycelium (x,z,scale,base,links,reach), yaw
  // = the compass direction the face looks (so it sits on one side of the trunk)
  async load(faced){
    const [faceTex, eyesTex] = await Promise.all([loadCropped(FACE_SRC), loadCropped(EYES_SRC)]);
    for (const f of faced) this._make(f.node, f.yaw, faceTex, eyesTex);
    this.ready = true;
    return this;
  }

  // A curved shell wrapping the actual trunk cylinder — it hugs the bark and stays
  // inside the trunk's silhouette, so it reads as relief carved into the bark, not
  // a flat sticker floating in front. Sized from the tree's REAL trunk radius and
  // height (js/gen/tree.js → trunkR/trunkH), not a guess. The eyes ride a hair
  // further out on additive blending so they glow.
  _shell(r, H, theta, thetaStart, radial){
    // open-ended cylinder arc; UVs run u across the arc, v up the height
    const g = new THREE.CylinderGeometry(r, r, H, radial, 1, true, thetaStart, theta);
    // the outside of a cylinder shows the texture mirrored; flip u so it reads right
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    return g;
  }

  _make(node, yaw, faceTex, eyesTex){
    // real measured bole radius × this instance's scale (fallback only if missing)
    const r = (node.trunkR ? node.trunkR : (TRUNK_R[node.base] || 0.9)) * node.scale;
    const trunkH = (node.trunkH ? node.trunkH : 10) * node.scale;
    // size the face to the trunk's GIRTH: a wide arc across the front, height to the
    // art's aspect — so a fat trunk gets a big face and a slim one a small face.
    const theta = 1.9;                                   // ~109° of the front
    const H = Math.min(theta * r * ASPECT, trunkH * 0.6); // don't overrun the bole
    const radial = Math.max(6, Math.round(theta / (Math.PI * 2) * 32));
    // CylinderGeometry places theta from +z toward +x (vertex dir = (sinθ, cosθ)),
    // matching our heading convention — so the arc centres on `yaw`.
    const thetaStart = yaw - theta / 2;

    const faceMat = new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, alphaTest: 0.3, depthWrite: false, side: THREE.FrontSide });
    const eyesMat = new THREE.MeshBasicMaterial({ map: eyesTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide, opacity: 0 });

    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(this._shell(r + 0.02, H, theta, thetaStart, radial), faceMat));
    grp.add(new THREE.Mesh(this._shell(r + 0.05, H, theta, thetaStart, radial), eyesMat));
    // anchor by the EYES (at v≈0.42 up the art) landing near a wanderer's eye
    // height, not by a fraction of the tree's height — so faces meet your gaze
    // whether the tree is a sapling or a giant.
    const EYE_H = Math.min(2.3, trunkH * 0.4);
    const eyeUp = (0.42 - 0.5) * H;                      // eyes' offset from shell centre
    grp.position.set(node.x, this.height(node.x, node.z) + EYE_H - eyeUp, node.z);
    this.scene.add(grp);
    this.faces.push({ node, grp, faceMat, eyesMat, glow: 0 });
  }

  // how bright the eyes want to be when examined, from the tree's live state —
  // the same state the dialogue reads (js/wood-talk.js)
  _level(node, night){
    let v = 0.7;
    if (night > 0.5) v *= 0.4;                 // slowed almost to sleep
    if (node.reach > 2.2) v *= 1.3;            // deep in the threads
    if (!node.links.length) v *= 0.5;          // lone, barely lit
    return Math.min(1, v);
  }
  _hasFire(node){ for (const f of node.news.values()) if (f.kind === 'fire') return true; return false; }

  // examined = the mycelium node aimed-at within reach; tint = the scene's sprite
  // tint (day/night), so the unlit face darkens with the world without going
  // Lambert-black on its own dark art.
  update(dt, now, { examined = null, night = 0, tint = null } = {}){
    if (!this.ready) return;
    for (const f of this.faces){
      if (tint) f.faceMat.color.copy(tint);
      const on = f.node === examined || f.forceOn;   // forceOn: ?gaze debug
      const target = on ? this._level(f.node, night) : 0;
      f.glow += (target - f.glow) * Math.min(1, dt * 3);        // gradual fade in/out
      const pulse = 0.82 + 0.18 * Math.sin(now * 0.003 + f.node.x);
      f.eyesMat.opacity = f.glow * pulse;
      f.eyesMat.color.copy(this._hasFire(f.node) ? EYE_COLD : EYE_WARM);
    }
  }
}
