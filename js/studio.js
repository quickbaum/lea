// Avatar Studio (P1) — generate a procedural body, preview it walking, bake it to a
// runtime sprite atlas, and save it into the game. Reuses BakeStudio (bakecore.js)
// for the scene/turntable/bake/save, and composeAvatar (avatar/compose.js) for the
// procedurally generated, rigged, animated subject.

import { BakeStudio } from './bakecore.js';
import { composeAvatar } from './avatar/compose.js';

const $ = id => document.getElementById(id);
const status = m => { $('status').textContent = m; };

const studio = new BakeStudio($('preview'));
const atlasCanvas = $('atlas');

let avatar = null;
function generate(){
  const vox = +$('detail').value || 0.008;
  status(`Generating body (detail ${vox})…`);
  setTimeout(() => {                       // let the status paint before the heavy build
    const t0 = performance.now();
    avatar = composeAvatar({ voxel: vox });
    studio.setSubject(avatar.group);
    status(`Body generated in ${((performance.now() - t0) / 1000).toFixed(1)}s. Tweak, then Bake.`);
  }, 30);
}
generate();
$('detail').onchange = generate;

// ---- live preview ----
let spin = 0, walkT = 0, last = performance.now();
function loop(now){
  const dt = (now - last) / 1000; last = now;
  spin += dt * 0.5; walkT += dt;
  // push control values into the studio look
  studio.light.exposure = +$('exposure').value;
  studio.light.key = +$('keyInt').value;
  studio.light.fill = +$('fillInt').value;
  studio.light.keyAz = +$('keyAz').value;
  studio.light.tilt = +$('tilt').value;
  studio.light.baseYaw = +$('baseYaw').value;
  studio.renderPreview((frac, isStand) => avatar.pose(frac, isStand), spin, walkT, +$('walkSpeed').value);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---- bake / save ----
let meta = null;
function bake(){
  if (!avatar) return;
  const cellH = Math.max(48, +$('cellH').value | 0);
  meta = studio.bake(atlasCanvas, { cellH, poseFn: (frac, isStand) => avatar.pose(frac, isStand) });
  $('atlasCap').textContent =
    `Baked ${meta.cols}×${meta.rows} · cell ${meta.cellW}×${meta.cellH} · ${atlasCanvas.width}×${atlasCanvas.height}px`;
  $('save').disabled = false;
  status('Baked. Name it and save into the game.');
}

async function save(){
  if (!meta) return;
  const slug = $('slug').value.trim();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(slug)){
    status('Slug must be lowercase letters/digits/hyphens.'); return;
  }
  status('Saving…');
  try {
    const j = await studio.save(atlasCanvas, slug, meta);
    if (j.ok){ status(`Saved → ${j.file}. Reload the game to see it.`); loadSlugs(); }
    else status('Save failed: ' + j.error);
  } catch (e){ status('Save failed: ' + e.message); }
}

async function loadSlugs(){
  try {
    const m = await (await fetch('sprites/npc/manifest.json')).json();
    $('slugs').innerHTML = (m.sprites || []).map(s => `<option value="${s.slug}">`).join('');
  } catch {}
}
loadSlugs();

// ---- wiring ----
const bindV = (id, fmt) => { const el = $(id), out = $(id + 'V'); if (out){ el.oninput = () => out.textContent = fmt(el.value); el.oninput(); } };
bindV('walkSpeed', v => (+v).toFixed(1));
bindV('baseYaw', v => v + '°');
bindV('tilt', v => v + '°');
bindV('exposure', v => (+v).toFixed(2));
bindV('keyInt', v => (+v).toFixed(1));
bindV('fillInt', v => (+v).toFixed(1));
bindV('keyAz', v => v + '°');

$('bake').onclick = bake;
$('save').onclick = save;
