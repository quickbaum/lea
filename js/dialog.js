// dialog.js — in-game branching dialogue (formerly the standalone puck service;
// folded back in here). Trees live in /dialogs/<name>.json:
//   { root, speaker, portrait, nodes: { id: { text, choices:[{label, next, action}] } } }
// next:null ends the talk; next omitted on an `action` choice re-renders the same
// node (so e.g. "Gather more clouds" can be tapped repeatedly). text may contain
// [[node]] or [[node|label]] inline links. `action` names a function supplied by
// the caller in opts.actions — that's how Claude actually changes the weather.

const cache = {};

function ensureCss(){
  if (document.getElementById('dialog-css')) return;
  const el = document.createElement('style'); el.id = 'dialog-css';
  el.textContent = `
  #dlg-overlay{position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;
    justify-content:center;background:rgba(0,0,0,.15);font-family:Georgia,'Times New Roman',serif;}
  #dlg-box{display:flex;gap:18px;max-width:760px;width:calc(100% - 48px);margin:0 0 32px;
    background:#1d1a14;border:2px solid #c9a23a;border-radius:10px;padding:18px 20px;
    box-shadow:0 10px 40px #000c;color:#efe6cf;}
  #dlg-portrait{width:120px;flex:0 0 120px;align-self:flex-end;image-rendering:auto;
    filter:drop-shadow(0 3px 6px #000a);}
  #dlg-main{flex:1;min-width:0;}
  #dlg-speaker{font-weight:bold;color:#e8c75a;font-size:16px;margin-bottom:6px;letter-spacing:.02em;}
  #dlg-text{font-size:18px;line-height:1.5;white-space:pre-wrap;margin-bottom:14px;}
  #dlg-roster{display:flex;flex-wrap:wrap;gap:10px;margin:2px 0 14px;}
  .dlg-kin{width:74px;text-align:center;}
  .dlg-kin-face{width:66px;height:66px;object-fit:cover;border:1px solid #c9a23a;border-radius:4px;
    display:block;margin:0 auto 3px;image-rendering:auto;background:#0c0e16;}
  .dlg-kin-name{font-size:12px;color:#efe6cf;line-height:1.15;}
  .dlg-kin-rel{font-size:11px;color:#a89c78;font-style:italic;}
  .dlg-kin.clickable{cursor:pointer;border-radius:5px;transition:background .12s;}
  .dlg-kin.clickable:hover{background:#3a3320;}
  .dlg-kin.clickable:hover .dlg-kin-face{border-color:#fff;}
  .dlg-link{color:#e8c75a;border-bottom:1px dotted #e8c75a;cursor:pointer;}
  .dlg-link:hover{color:#fff;}
  #dlg-choices{display:flex;flex-direction:column;gap:7px;}
  .dlg-choice{cursor:pointer;padding:7px 12px;border:1px solid #5a5238;border-radius:6px;
    background:#272318;font-size:15px;transition:background .12s,border-color .12s;}
  .dlg-choice:hover{background:#3a3320;border-color:#c9a23a;}
  .dlg-back{color:#a89c78;cursor:pointer;font-size:13px;margin-bottom:8px;}
  .dlg-back:hover{color:#fff;}
  @media(max-width:560px){#dlg-portrait{display:none;}#dlg-box{margin-bottom:0;}}`;
  document.head.appendChild(el);
}

function parseText(text, go){
  const frag = document.createDocumentFragment();
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null){
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    const node = m[1].trim().replace(/\s+/g, '-').toLowerCase();
    const span = document.createElement('span');
    span.className = 'dlg-link'; span.textContent = (m[2] || m[1]).trim();
    span.onclick = () => go(node);
    frag.appendChild(span); last = re.lastIndex;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function open(tree, opts){
  ensureCss();
  opts = opts || {};
  const actions = opts.actions || {};
  const history = [];
  let cur = null;

  const overlay = document.createElement('div'); overlay.id = 'dlg-overlay';
  const box = document.createElement('div'); box.id = 'dlg-box';
  const portrait = document.createElement('img');
  portrait.id = 'dlg-portrait'; portrait.alt = tree.speaker || '';
  if (tree.portrait) portrait.src = tree.portrait; else portrait.style.display = 'none';
  const main = document.createElement('div'); main.id = 'dlg-main';
  box.appendChild(portrait); box.appendChild(main);
  overlay.appendChild(box); document.body.appendChild(overlay);

  function close(){ overlay.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
  function onKey(e){ if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function go(id, push = true){
    const node = tree.nodes[id];
    if (!node) return;
    if (push && cur && cur !== id) history.push(cur);
    if (id === tree.root) history.length = 0;
    cur = id;
    if (opts.onNav) opts.onNav(id);          // per-navigation hook (e.g. clear a map marker)
    main.innerHTML = '';

    if (tree.speaker){
      const sp = document.createElement('div'); sp.id = 'dlg-speaker'; sp.textContent = tree.speaker;
      main.appendChild(sp);
    }
    if (history.length){
      const back = document.createElement('div');
      back.className = 'dlg-back'; back.textContent = '← back';
      back.onclick = () => go(history.pop(), false);
      main.appendChild(back);
    }
    const t = document.createElement('div'); t.id = 'dlg-text';
    t.appendChild(parseText(node.text, go));
    main.appendChild(t);

    // an optional roster of people (portrait + name + relation), e.g. one's kin
    if (node.roster && node.roster.length){
      const grid = document.createElement('div'); grid.id = 'dlg-roster';
      for (const m of node.roster){
        const cell = document.createElement('div'); cell.className = 'dlg-kin';
        if (m.portrait){ const im = document.createElement('img'); im.className = 'dlg-kin-face'; im.src = m.portrait; im.alt = m.name || ''; cell.appendChild(im); }
        const nm = document.createElement('div'); nm.className = 'dlg-kin-name'; nm.textContent = m.name || ''; cell.appendChild(nm);
        if (m.relation){ const rel = document.createElement('div'); rel.className = 'dlg-kin-rel'; rel.textContent = m.relation; cell.appendChild(rel); }
        if (m.next || m.onSelect){              // clickable: ask about this person
          cell.className = 'dlg-kin clickable';
          cell.onclick = () => { if (m.next) go(m.next); if (m.onSelect) m.onSelect(); };
        }
        grid.appendChild(cell);
      }
      main.appendChild(grid);
    }

    const choices = [...(node.choices || [])];
    if (id !== tree.root && !choices.some(c => c.next === tree.root))
      choices.push({ label: 'Ask about something else.', next: tree.root });
    if (!choices.some(c => c.next === null)){
      const fw = typeof tree.farewell === 'function' ? tree.farewell()
        : (tree.farewell || 'Farewell, good fellow!');     // per-tree close label
      choices.push({ label: fw, next: null });
    }

    const cs = document.createElement('div'); cs.id = 'dlg-choices';
    for (const c of choices){
      const b = document.createElement('div'); b.className = 'dlg-choice'; b.textContent = c.label;
      b.onclick = () => {
        if (c.action && actions[c.action]) actions[c.action]();
        if (c.next === null) close();
        else if (c.next === undefined) go(cur, false);   // action with no target: stay, repeatable
        else go(c.next);
      };
      cs.appendChild(b);
    }
    main.appendChild(cs);
  }
  go(tree.root);
}

function load(name){
  if (cache[name]) return Promise.resolve(cache[name]);
  return fetch(`dialogs/${name}.json`).then(r => r.json()).then(t => (cache[name] = t));
}

// talk('claude', { actions, onClose }) — open a conversation from a /dialogs file.
export function talk(name, opts = {}){
  return load(name).then(t => open(t, opts)).catch(e => console.warn('dialog:', e));
}

// talkTree(tree, opts) — open a conversation from an in-memory tree (no fetch),
// for dialogue assembled at runtime (e.g. a peasant reporting its current state).
export function talkTree(tree, opts = {}){ open(tree, opts); }
