// spritebaker.js — runtime sprite baker via hidden iframe (baker.html?mode=worker).
// The user's real Chrome GPU bakes atlases on demand (much faster than headless
// SwiftShader on the Pi). Results are POST-ed to /api/save-sprite so subsequent
// page loads skip the bake entirely.
//
// Usage:
//   import { bakeMissing } from './spritebaker.js';
//   bakeMissing();   // fire-and-forget; bakes anything in bakes.json not yet on disk

let _iframe = null, _ready = false;
const _waiters = [], _pending = new Map();
let _seq = 0;

function ensureIframe() {
  if (_iframe) return;
  _iframe = document.createElement('iframe');
  _iframe.src = '/baker.html?mode=worker';
  _iframe.style.cssText =
    'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:none;bottom:0;right:0';
  document.body.appendChild(_iframe);
  window.addEventListener('message', _onMsg);
}

function _onMsg(ev) {
  if (!_iframe || ev.source !== _iframe.contentWindow) return;
  const d = ev.data;
  if (d.type === 'ready') {
    _ready = true;
    _waiters.splice(0).forEach(r => r());
  } else if (d.type === 'bake-done' || d.type === 'bake-error') {
    const p = _pending.get(d.id);
    if (!p) return;
    _pending.delete(d.id);
    d.type === 'bake-done' ? p.resolve(d) : p.reject(new Error(d.error));
  }
}

function whenReady() {
  return _ready ? Promise.resolve() : new Promise(r => _waiters.push(r));
}

// Bake one sprite by model/anim URL. Resolves with {slug, png, meta} once the bake
// is done and has been saved to the server. Rejects on load or render error.
export async function bakeSprite(slug, model, anim, lights) {
  ensureIframe();
  await whenReady();
  const id = String(++_seq);
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    _iframe.contentWindow.postMessage({ type: 'bake', id, slug, model, anim, lights }, '*');
  });
}

// Compare the live manifest against tools/bakes.json and bake any sprite that is
// missing or whose source model/anim file is newer than the stored bake mtime.
// Safe to call on every boot — no-ops if everything is fresh.
export async function bakeMissing() {
  const [manifest, recipes] = await Promise.all([
    fetch('sprites/npc/manifest.json').then(r => r.json()).catch(() => ({ sprites: [] })),
    fetch('/api/bake-recipes').then(r => r.json()).catch(() => ({})),
  ]);

  const bySlug = new Map((manifest.sprites || []).map(s => [s.slug, s]));
  const todo = [];
  for (const [slug, recipe] of Object.entries(recipes)) {
    const entry = bySlug.get(slug);
    if (!entry) {
      todo.push([slug, recipe, 'missing']);
    } else {
      const modelStale = recipe.modelMtime && (entry.modelMtime == null || recipe.modelMtime > entry.modelMtime);
      const animStale  = recipe.animMtime  && (entry.animMtime  == null || recipe.animMtime  > entry.animMtime);
      if (modelStale || animStale) todo.push([slug, recipe, 'stale']);
    }
  }
  if (!todo.length) return;

  console.log(`[spritebaker] ${todo.length} sprite(s) to bake:`,
    todo.map(([s,, reason]) => `${s} (${reason})`).join(', '));
  ensureIframe();

  for (const [slug, recipe] of todo) {
    try {
      await bakeSprite(
        slug,
        '/models/' + recipe.model,
        '/anims/' + recipe.anim,
        recipe.lights || null,
      );
      console.log(`[spritebaker] ✓ ${slug}`);
    } catch (e) {
      console.error(`[spritebaker] ✗ ${slug}:`, e);
    }
  }

  console.log('[spritebaker] done — reload to use newly baked sprites');
}
