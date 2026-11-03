// dialog.js — in-game branching dialogue (formerly the standalone puck service;
// folded back in here). Trees live in /dialogs/<name>.json:
//   { root, speaker, portrait, nodes: { id: { text, choices:[{label, next, action}] } } }
// next:null ends the talk; next omitted on an `action` choice re-renders the same
// node (so e.g. "Gather more clouds" can be tapped repeatedly). text may contain
// [[node]] or [[node|label]] inline links. A tree built at runtime may give a
// choice `run`, a function called when it's picked (before moving to `next`). `action` names a function supplied by
// the caller in opts.actions — that's how Claude actually changes the weather.
// A tree with a `lilt` (js/lilt.js: Puck's) sings: each screen's words come up one
// at a time on the beat of a score worked out from them, each sounding a note on their
// instrument (played by whatever setVoicePlayer was given; main.js gives its Instruments). A
// click or Space shows the rest at once; the choices wait until the words are all there.
// That tree's text may carry hidden marks ({slow}, *stress*, …: speech-score.js), never
// shown; other trees' text is shown as written (claude.json's *asterisks* stay).

import { prepare, score } from './speech-score.js';
import { LILTS, handOf, inkOn } from './lilt.js';

const cache = {};
let voicePlayer = null;          // (kind, { notes, length }, { gain }) → Promise<{ stop } | null>
export function setVoicePlayer(fn){ voicePlayer = fn; }

// each word of el's text in a span of its own, split as speech-score.js prepare() splits them
function wordify(el){
  const spans = [];
  const walk = node => {
    for (const ch of [...node.childNodes]){
      if (ch.nodeType !== 3){ walk(ch); continue; }
      const frag = document.createDocumentFragment();
      for (const part of ch.textContent.split(/(\s+)/)){
        if (!part) continue;
        if (/^\s+$/.test(part)){ frag.appendChild(document.createTextNode(part)); continue; }
        const w = document.createElement('span'); w.className = 'dlg-w'; w.textContent = part;
        frag.appendChild(w); spans.push(w);
      }
      node.replaceChild(frag, ch);
    }
  };
  walk(el);
  return spans;
}

// sing a line said in the world (talk-view.js bubbles): the notes start now, and the words come
// up on their beats from t0 (ms, performance.now(); null until the notes are asked for)
// { words: [{ text, t, br }], length, t0, stop() }, or null if they can't sing
export function ringLine(text, lilt, who = lilt){
  const hand = handOf(who);
  if (!voicePlayer || !LILTS[lilt] || !hand?.kind) return null;
  const sc = score(text, lilt, hand);
  if (!sc.words.length) return null;
  const r = { words: sc.words, length: sc.length, t0: null, perf: null, stop(){ this.perf?.stop(); } };
  Promise.resolve(voicePlayer(hand.kind, { notes: sc.notes, length: sc.length }, { gain: hand.gain ?? 1 })).catch(() => null)
    .then(p => { r.perf = p; r.t0 = performance.now() + 80; });
  return r;
}
// sing one screen: { skip() }, or null if it can't (no player, or the words don't line up)
function sing(textEl, choicesEl, text, lilt, who = lilt){
  const hand = handOf(who), sc = score(text, lilt, hand), spans = wordify(textEl);
  if (!voicePlayer || !LILTS[lilt] || !hand?.kind || spans.length !== sc.words.length) return null;
  textEl.classList.add('singing'); choicesEl.classList.add('waiting');
  let perf = null, timer = null, done = false, t0 = 0;
  const finish = () => {
    if (done) return; done = true; clearTimeout(timer);
    for (const w of spans) w.classList.add('sung');
    textEl.classList.remove('singing'); choicesEl.classList.remove('waiting');
  };
  const tick = () => {
    const now = (performance.now() - t0) / 1000;
    let next = null;
    spans.forEach((w, i) => { if (sc.words[i].t <= now + 0.01) w.classList.add('sung'); else if (next === null) next = sc.words[i].t; });
    timer = next === null ? setTimeout(finish, 250) : setTimeout(tick, Math.max(10, (next - now) * 1000));
  };
  // the words keep time even with no sound (no audio yet): the clock starts once the notes are asked for
  Promise.resolve(voicePlayer(hand.kind, { notes: sc.notes, length: sc.length }, { gain: hand.gain ?? 1 })).catch(() => null).then(p => {
    perf = p;
    if (done){ p?.stop(); return; }
    t0 = performance.now() + 80;                   // instruments.js starts its notes 80 ms on
    tick();
  });
  return { skip(){ perf?.stop(); finish(); } };
}

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
  let cur = null, song = null;

  const overlay = document.createElement('div'); overlay.id = 'dlg-overlay';
  const box = document.createElement('div'); box.id = 'dlg-box';
  const portrait = document.createElement('img');
  portrait.id = 'dlg-portrait'; portrait.alt = tree.speaker || '';
  if (tree.portrait) portrait.src = tree.portrait; else portrait.style.display = 'none';
  if (tree.portraitBg){ portrait.style.backgroundImage = tree.portraitBg; portrait.classList.add('marked'); }   // their household's mark (js/kin-mark.js)
  const main = document.createElement('div'); main.id = 'dlg-main';
  box.appendChild(portrait); box.appendChild(main);
  overlay.appendChild(box); document.body.appendChild(overlay);

  function close(){ song?.skip(); overlay.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); }
  function onKey(e){
    if (e.key === 'Escape') close();
    else if (song && (e.key === ' ' || e.key === 'Enter')){ e.preventDefault(); song.skip(); }
  }
  // a click shows the rest of what's said; not a click that takes you somewhere (a choice, a
  // link, back): that click opens the next screen first, and skipping then would skip that one
  main.addEventListener('click', e => { if (!e.target.closest('.dlg-choice, .dlg-link, .dlg-back, .dlg-kin')) song?.skip(); });
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  function go(id, push = true){
    const node = tree.nodes[id];
    if (!node) return;
    if (push && cur && cur !== id) history.push(cur);
    if (id === tree.root) history.length = 0;
    cur = id;
    if (opts.onNav) opts.onNav(id);          // per-navigation hook (e.g. clear a map marker)
    song?.skip(); song = null;
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
    t.appendChild(parseText(tree.lilt ? prepare(node.text).clean : node.text, go));
    const hand = handOf(tree.hand);                  // their ink and lettering
    if (hand){ t.style.color = inkOn(hand, 'panel'); if (hand.font) t.style.fontStyle = hand.font; }
    main.appendChild(t);

    // an optional roster of people (portrait + name + relation), e.g. one's kin
    if (node.roster && node.roster.length){
      const grid = document.createElement('div'); grid.id = 'dlg-roster';
      for (const m of node.roster){
        const cell = document.createElement('div'); cell.className = 'dlg-kin';
        if (m.portrait){ const im = document.createElement('img'); im.className = 'dlg-kin-face'; im.src = m.portrait; im.alt = m.name || ''; if (m.portraitBg) im.style.backgroundImage = m.portraitBg; cell.appendChild(im); }
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
        if (c.run) c.run();                               // (a runtime tree's choice can act directly)
        if (c.next === null) close();
        else if (c.next === undefined) go(cur, false);   // action with no target: stay, repeatable
        else go(c.next);
      };
      cs.appendChild(b);
    }
    main.appendChild(cs);
    if (tree.lilt) song = sing(t, cs, node.text, tree.lilt, tree.hand);
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

// loadTree('lea') — a /dialogs tree itself, to add to before it's opened (Puck's guide branch)
export const loadTree = load;

// talkTree(tree, opts) — open a conversation from an in-memory tree (no fetch),
// for dialogue assembled at runtime (e.g. a peasant reporting its current state).
export function talkTree(tree, opts = {}){ open(tree, opts); }
