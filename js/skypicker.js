// skypicker.js — in-game sky browser for toggling doom sky textures.
//
// Keys (when picker is open):
//   \  — toggle open/close
//   [  — previous sky
//   ]  — next sky
//   M  — cycle mode (Off → Band → Full → Off)
//   Escape — close
//
// Series filter: type any substring of the sky name (e.g. "ltn" for LTNSKY,
// "hell" for HELLSKY, "fd" for FreeDoom originals).

const S = {
  panel:  `position:fixed;bottom:12px;left:12px;background:rgba(8,10,18,0.92);
           color:#cce;font:12px/1.6 monospace;padding:10px 14px;border-radius:6px;
           border:1px solid #2a3550;z-index:9999;min-width:330px;user-select:none;
           display:none;box-shadow:0 4px 24px rgba(0,0,0,0.7);`,
  head:   `display:flex;justify-content:space-between;align-items:center;margin-bottom:6px`,
  title:  `color:#7ab4ff;font-size:13px;font-weight:bold;letter-spacing:.04em`,
  close:  `color:#556;cursor:pointer;font-size:11px;padding:1px 4px;
           border:1px solid #2a3550;border-radius:3px`,
  name:   `color:#ffe97a;font-size:14px;font-weight:bold;min-height:1.4em;margin-bottom:1px`,
  meta:   `color:#556;font-size:10px;margin-bottom:8px`,
  row:    `display:flex;gap:6px;align-items:center;margin-bottom:7px`,
  btn:    `background:#0e1420;color:#8ab;border:1px solid #2a3550;border-radius:3px;
           padding:2px 9px;cursor:pointer;font:11px monospace;white-space:nowrap`,
  btnOn:  `background:#1a2e50;color:#7ab4ff;border-color:#3a5a90`,
  inp:    `background:#060810;color:#aac;border:1px solid #2a3550;border-radius:3px;
           padding:2px 7px;font:11px monospace;flex:1;outline:none`,
  hint:   `color:#3a4a6a;font-size:10px;line-height:1.3;border-top:1px solid #151c2c;
           padding-top:6px;margin-top:4px`,
};

const MODE_LABELS = ['Off', 'Band ▲', 'Full ■'];

export class SkyPicker {
  constructor(sky){
    this.sky = sky;
    this._open = false;
    this._all = [];        // full manifest
    this._list = [];       // filtered subset
    this._listIdx = 0;     // index within _list
    this._mode = 0;
    this._panel = null;
    this._nameEl = null;
    this._metaEl = null;
    this._modeEls = [];
    this._filterEl = null;
    sky.loadDoomManifest().then(m => {
      this._all = m;
      this._list = m;
      this._buildUI();
      this._bindKeys();
    });
  }

  _buildUI(){
    const el = document.createElement('div');
    el.setAttribute('style', S.panel);
    el.innerHTML = `
      <div style="${S.head}">
        <span style="${S.title}">🌅 Sky Picker</span>
        <span id="sp-close" style="${S.close}">✕  [\\]</span>
      </div>
      <div id="sp-name" style="${S.name}">—</div>
      <div id="sp-meta" style="${S.meta}">—</div>
      <div style="${S.row}">
        <button id="sp-prev" style="${S.btn}">◄ [</button>
        <input  id="sp-filter" style="${S.inp}" placeholder="filter…" spellcheck="false" />
        <button id="sp-next" style="${S.btn}">] ►</button>
      </div>
      <div style="${S.row}">
        <span style="color:#445;font-size:10px">MODE&nbsp;[M]</span>
        <button id="sp-m0" style="${S.btn}">Off</button>
        <button id="sp-m1" style="${S.btn}">Band ▲</button>
        <button id="sp-m2" style="${S.btn}">Full ■</button>
      </div>
      <div style="${S.hint}">
        Band: doom horizon + dome above&nbsp;·&nbsp;stars OK<br>
        Full: doom sky everywhere&nbsp;·&nbsp;no stars (use Band at night)
      </div>`;
    document.body.appendChild(el);
    this._panel   = el;
    this._nameEl  = el.querySelector('#sp-name');
    this._metaEl  = el.querySelector('#sp-meta');
    this._filterEl = el.querySelector('#sp-filter');
    this._modeEls = [el.querySelector('#sp-m0'), el.querySelector('#sp-m1'), el.querySelector('#sp-m2')];

    el.querySelector('#sp-close').onclick = () => this.toggle(false);
    el.querySelector('#sp-prev').onclick  = () => this._step(-1);
    el.querySelector('#sp-next').onclick  = () => this._step(+1);
    this._modeEls.forEach((b, i) => b.onclick = () => this._setMode(i));

    this._filterEl.addEventListener('input', () => this._applyFilter());
    // prevent game hotkeys while typing in the filter box
    this._filterEl.addEventListener('keydown', e => e.stopPropagation());
  }

  _applyFilter(){
    const q = this._filterEl.value.trim().toLowerCase();
    this._list = q
      ? this._all.filter(e => e.id.includes(q) || e.src.toLowerCase().includes(q))
      : this._all;
    this._listIdx = 0;
    this._show();
  }

  _step(d){
    if (!this._list.length) return;
    this._listIdx = ((this._listIdx + d) % this._list.length + this._list.length) % this._list.length;
    this._show();
  }

  _show(){
    if (!this._list.length){
      this._nameEl.textContent = '(no match)';
      this._metaEl.textContent = '';
      return;
    }
    const entry = this._list[this._listIdx];
    const globalIdx = this._all.indexOf(entry);
    this.sky.setDoomSky(globalIdx);
    const label = entry.id.replace(/^(mek|fd)-/, '').toUpperCase();
    this._nameEl.textContent = label;
    this._metaEl.textContent =
      `${entry.src}  ·  ${entry.w}×${entry.h}px  ·  ${this._listIdx + 1} / ${this._list.length}`;
    this._refreshModeButtons();
  }

  _setMode(m){
    this._mode = m;
    this.sky.setDoomMode(m);
    this._refreshModeButtons();
  }

  _refreshModeButtons(){
    this._modeEls.forEach((b, i) => {
      b.setAttribute('style', S.btn + (i === this._mode ? S.btnOn : ''));
    });
  }

  toggle(force){
    this._open = force !== undefined ? !!force : !this._open;
    this._panel.style.display = this._open ? 'block' : 'none';
    // first open: jump to sky 0 in Band mode so something is visible immediately
    if (this._open && this._mode === 0 && this._list.length){
      this._setMode(1);
      this._show();
    }
  }

  _bindKeys(){
    window.addEventListener('keydown', e => {
      if (e.code === 'Backslash'){ this.toggle(); return; }
      if (!this._open) return;
      if (e.code === 'BracketLeft')  { this._step(-1); e.preventDefault(); }
      if (e.code === 'BracketRight') { this._step(+1); e.preventDefault(); }
      if (e.code === 'KeyM')         { this._setMode((this._mode + 1) % 3); e.preventDefault(); }
      if (e.code === 'Escape')       { this.toggle(false); e.preventDefault(); }
    }, { capture: false });
  }
}
