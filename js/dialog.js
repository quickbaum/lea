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
  const el = document.createElement('link');
  el.id = 'dialog-css'; el.rel = 'stylesheet'; el.href = 'dialog.css';
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
