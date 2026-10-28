// The intro: choose which Lea to enter. Nothing heavy loads until you do — the
// whole world is generated when main.js is imported, so this module imports
// nothing, hands the choice to config.js through globalThis.__leaWorld, and only
// then imports main.js. (A debug/pose link, ?debug or ?x=, skips the choice and
// loads the saved world straight away, so tools and copied poses still work.)
//
// Five presets are fixed places (each has its own seed, so "The Fens" is always
// the same fens); Custom opens the full options.

const PRESETS = [
  { id: 'lea',    name: 'The Lea',      blurb: 'Lakes, fens and woods among rolling hills, with a great lake and its island.',
    world: { size: 3200, hills: 1,   water: 1, folk: 64, seed: 20260618 } },
  { id: 'little', name: 'Little Lea',   blurb: 'A small Lea, quick to load: an afternoon’s walk from edge to edge.',
    world: { size: 800,  hills: 0.5, water: 1, folk: 24, seed: 1171 } },
  { id: 'fens',   name: 'The Fens',     blurb: 'Flat, wet country: reedbeds, peat flats and open water everywhere.',
    world: { size: 1600, hills: 0,   water: 2, folk: 40, seed: 4402 } },
  { id: 'lakes',  name: 'Lake Country', blurb: 'Big water among gentle wooded hills.',
    world: { size: 3200, hills: 0.5, water: 2, folk: 48, seed: 7713 } },
  { id: 'uplands', name: 'The Uplands', blurb: 'Dry heath and pine below bare, rocky hills. Few folk.',
    world: { size: 3200, hills: 2,   water: 0, folk: 32, seed: 9020 } },
];
const DEFAULT_CUSTOM = PRESETS[0].world;
const SIZE_WORD = { 800: 'small', 1600: 'medium', 3200: 'large' };

const $ = id => document.getElementById(id);
// the gear and pack are main.js's; until it loads they'd be dead buttons
const ingame = ['gear', 'inv-btn', 'rest-btn'];
let saved = {};
try { saved = JSON.parse(localStorage.getItem('lea.world') || '{}') || {}; } catch (_){ saved = {}; }

function enter(world, preset){
  try { localStorage.setItem('lea.world', JSON.stringify({ ...world, preset })); } catch (_){}
  globalThis.__leaWorld = world;
  globalThis.__leaRebake = !!$('intro-rebake')?.checked;   // folk-avatars.js drops its saved bakes first
  $('intro-choices')?.classList.add('hide');
  $('world-opts')?.classList.add('hide');
  $('loading-status')?.classList.remove('hide');
  for (const id of ingame) $(id)?.classList.remove('hide');
  import('./main.js').catch(err => {
    const l = $('loading-label'); if (l) l.textContent = 'the Lea failed to load — ' + (err && err.message || err);
    console.error(err);
  });
}

const params = new URLSearchParams(location.search);
if (params.has('debug') || params.has('x')){
  // straight in: config.js reads the saved world (and any ?size/?seed) itself
  $('intro-choices')?.classList.add('hide');
  $('loading-status')?.classList.remove('hide');
  import('./main.js');
} else {
  for (const id of ingame) $(id)?.classList.add('hide');
  // ---- the six buttons ----
  const grid = $('intro-presets');
  for (const p of PRESETS){
    const b = document.createElement('button');
    b.className = 'preset' + (saved.preset === p.id ? ' last' : '');
    b.innerHTML = `<span class="name"></span><span class="blurb"></span><span class="meta"></span>`;
    b.querySelector('.name').textContent = p.name;
    b.querySelector('.blurb').textContent = p.blurb;
    b.querySelector('.meta').textContent = `${SIZE_WORD[p.world.size]} · ${p.world.folk} folk` + (p.world.size >= 3200 ? ' · slower to load' : '');
    b.addEventListener('click', () => enter(p.world, p.id));
    grid.appendChild(b);
  }
  const custom = document.createElement('button');
  custom.className = 'preset custom' + (saved.preset === 'custom' ? ' last' : '');
  custom.innerHTML = '<span class="name">Custom…</span><span class="blurb">Choose the size, hills, water, folk and seed yourself.</span><span class="meta">&nbsp;</span>';
  custom.addEventListener('click', () => { $('intro-choices').classList.add('hide'); $('world-opts').classList.remove('hide'); });
  grid.appendChild(custom);

  // ---- the custom panel ----
  const box = $('world-opts');
  const pick = { ...DEFAULT_CUSTOM };
  if (saved.preset === 'custom') for (const k of Object.keys(pick)) if (Number.isFinite(+saved[k])) pick[k] = +saved[k];
  const folk = $('wo-folk'), folkVal = $('wo-folk-val'), seed = $('wo-seed'), note = $('wo-note');
  const render = () => {
    for (const set of box.querySelectorAll('.set[data-key]'))
      for (const b of set.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.v === +pick[set.dataset.key]);
    folk.value = pick.folk; folkVal.textContent = pick.folk;
    if (document.activeElement !== seed) seed.value = pick.seed;
    note.textContent = pick.size >= 3200 ? 'a large Lea takes a while to grow' : '';
  };
  for (const set of box.querySelectorAll('.set[data-key]'))
    set.addEventListener('click', e => { const b = e.target.closest('button'); if (b){ pick[set.dataset.key] = +b.dataset.v; render(); } });
  folk.addEventListener('input', () => { pick.folk = +folk.value; render(); });
  seed.addEventListener('input', () => { const v = Math.floor(+seed.value); if (Number.isFinite(v) && v >= 0 && v < 2 ** 32){ pick.seed = v; render(); } });
  $('wo-reroll').addEventListener('click', () => { pick.seed = (Math.random() * 2 ** 32) >>> 0; render(); });
  $('wo-back').addEventListener('click', () => { box.classList.add('hide'); $('intro-choices').classList.remove('hide'); });
  $('wo-make').addEventListener('click', () => enter({ ...pick }, 'custom'));
  render();
}
