// talk-view.js — the dwellers' talk, shown as speech bubbles. Reads the social
// events agents.js sends out (world.onSocial): each 'say' is one move of a
// conversation (js/convo.js) — a bubble over the speaker for as long as the move
// takes, with its icon (or the face of the person it's about), and a small
// green/red mark for how it landed with the listener. A glimpse is one passing
// bubble — hearts, or a scowl. Walk up close and a conversation opens into its
// spoken lines (lineFor, from main.js); once you've heard one it stays words to
// its end, even as you walk off. say() is one of them speaking to you.
//
// Plain HTML over the canvas, NOT in the 3D scene: the world is drawn at a
// fraction of screen resolution and upscaled pixelated, and the icons must stay
// sharp to be legible. Only the few bubbles nearest the player are drawn.

import * as THREE from 'three';
import { ICONS } from './talk-icons.js';
import { height } from './terrain.js';

const REACT_AT  = 0.45;   // when, as a share of the move, the reaction mark appears
const GLANCE_S  = 3;
const RANGE     = 40;     // bubbles further than this from the player aren't drawn
const NEAR_TEXT = 7;      // closer than this, a conversation shows its words
const MAX_SHOWN = 5;      // bubbles on screen at once (nearest win)
const SAY_S     = 5;      // a remark to the player stays up this long

const CSS = `
#talk{position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden;}
#talk .tb{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;
  padding:5px 8px;background:#fbf8ef;color:#2e2a24;border:2px solid #2e2a24;border-radius:12px;
  font:15px/1.3 Georgia,serif;max-width:250px;box-shadow:0 2px 6px rgba(0,0,0,.25);
  transform-origin:50% 100%;will-change:transform;transition:opacity .15s;}
#talk .tb::after{content:"";position:absolute;left:50%;bottom:-9px;margin-left:-6px;
  border:6px solid transparent;border-top:7px solid #2e2a24;border-bottom:0;}
#talk .tb::before{content:"";position:absolute;left:50%;bottom:-5px;margin-left:-4px;z-index:1;
  border:4px solid transparent;border-top:5px solid #fbf8ef;border-bottom:0;}
#talk .tb svg{width:30px;height:30px;flex:none;fill:#2e2a24;}
#talk .tb .face{position:relative;width:32px;height:32px;flex:none;}
#talk .tb .face img{width:32px;height:32px;border-radius:50%;object-fit:cover;background:#d9cfb8;}
#talk .tb .face svg{position:absolute;right:-5px;bottom:-4px;width:17px;height:17px;
  background:#fbf8ef;border-radius:50%;padding:1px;}
#talk .tb .line{display:none;white-space:pre-line;}
#talk .tb.lore .line{font-style:italic;}
#talk .tb.near .line{display:block;}
#talk .tb.near > .ic > svg{width:22px;height:22px;}
#talk .tb .re{position:absolute;right:-8px;top:-8px;width:18px;height:18px;border-radius:50%;
  font:bold 14px/18px sans-serif;text-align:center;color:#fff;border:2px solid #fbf8ef;display:none;}
#talk .tb .re.up{background:#3f9b4a;display:block;}
#talk .tb .re.down{background:#c0453a;display:block;}
#talk .tb.glance{padding:3px 5px;}
#talk .tb.glance svg{width:24px;height:24px;}
#talk .tb.glance.like svg{fill:#c0453a;}
`;

function svg(name){
  const d = ICONS[name] || ICONS.person;
  return `<svg viewBox="0 0 512 512" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function makeTalkView({ camera, canvas, lineFor }){
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const layer = document.createElement('div'); layer.id = 'talk'; document.body.appendChild(layer);
  const lines = [];      // { move, who, t, dur, convo } — one per conversation at a time
  const glances = [];    // { who, like, t }
  const pool = [];       // bubble elements, reused
  const v = new THREE.Vector3();

  function onSocial(e){
    if (e.type === 'say'){
      const l = { move: e.move, who: e.move.who, t: 0, dur: e.move.dur || 2.5, convo: e.convo };
      const i = lines.findIndex(x => x.convo === e.convo);      // a new move replaces that talk's last
      if (i >= 0) lines[i] = l; else lines.push(l);
    } else if (e.type === 'glance') glances.push({ who: e.who, like: e.like, t: 0 });
  }

  // someone speaks to the player: one move, already words
  function say(who, move){ lines.push({ move, who, t: 0, dur: SAY_S, convo: { heard: true } }); }

  function bubble(i){
    let el = pool[i];
    if (!el){
      el = document.createElement('div'); el.className = 'tb';
      el.innerHTML = '<span class="ic"></span><span class="line"></span><span class="re"></span>';
      layer.appendChild(el); pool[i] = el;
    }
    return el;
  }

  // fill a bubble for a move (only when the move changes — cheap per frame)
  function fill(el, m){
    if (el._key === m) return;
    el._key = m;
    el.className = 'tb';
    const ic = el.firstChild, subj = m.subj || (m.fact && m.fact.subj);
    if (subj && subj.portrait){
      ic.innerHTML = `<span class="face"><img src="${subj.portrait}" alt="">${m.icon === 'gift' ? svg('gift') : ''}</span>`;
      ic.querySelector('img').onerror = () => { ic.innerHTML = svg(m.icon); };
    } else ic.innerHTML = svg(m.icon);
    el.children[1].textContent = '';
    el.children[2].className = 're'; el.children[2].textContent = '';
  }

  function headPos(n){
    const gy = n.rideY != null ? n.rideY : height(n.x, n.z);
    return v.set(n.x, gy + (n.h || 1.7) * (n._curPose === 'sitting' ? 0.66 : 1.0) + 0.35, n.z);
  }

  function update(dt, px, pz){
    for (let i = lines.length - 1; i >= 0; i--) if ((lines[i].t += dt) >= lines[i].dur) lines.splice(i, 1);
    for (let i = glances.length - 1; i >= 0; i--) if ((glances[i].t += dt) >= GLANCE_S) glances.splice(i, 1);

    // what's showing right now, nearest the player first
    const shown = [];
    for (const l of lines){
      const d = Math.hypot(l.who.x - px, l.who.z - pz);
      if (d < NEAR_TEXT) l.convo.heard = true;        // once words, words to the end
      if (d < RANGE) shown.push({ d, who: l.who, line: l });
    }
    for (const g of glances){
      const d = Math.hypot(g.who.x - px, g.who.z - pz);
      if (d < RANGE * 0.75) shown.push({ d, who: g.who, glance: g });
    }
    shown.sort((a, b) => a.d - b.d);

    const w = canvas.clientWidth, h = canvas.clientHeight;
    let used = 0;
    for (const s of shown){
      if (used >= MAX_SHOWN) break;
      headPos(s.who).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;   // behind or off screen
      const el = bubble(used++);
      if (s.glance){
        const key = s.glance;
        if (el._key !== key){ el._key = key; el.className = 'tb glance' + (key.like ? ' like' : '');
          el.firstChild.innerHTML = svg(key.like ? 'hearts' : 'cross'); el.children[1].textContent = ''; el.children[2].className = 're'; }
      } else {
        const l = s.line, m = l.move;
        fill(el, m);
        const near = !!l.convo.heard;
        el.classList.toggle('near', near);
        el.classList.toggle('lore', m.key === 'saying');      // a saying or song: verse, in italics
        // the line is worked out once per move and kept, so it never changes under you
        if (near && m.line == null && lineFor){
          try { m.line = lineFor(m) || ''; } catch (e){ m.line = ''; console.warn('talk: no words for', m.key, e); }   // never stop the frame over words
        }
        if (near && !el.children[1].textContent) el.children[1].textContent = m.line || '';
        const re = el.children[2];
        if (l.t >= l.dur * REACT_AT && m.react){
          re.className = 're ' + (m.react > 0 ? 'up' : 'down');
          re.textContent = m.react > 0 ? '+' : '−';
        }
      }
      const sc = Math.max(0.7, 1 - s.d / (RANGE * 1.6));
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 10px)) scale(${sc.toFixed(3)})`;
      el.style.opacity = '1';
      el.style.zIndex = String(MAX_SHOWN - used);     // the nearest talk on top
    }
    for (let i = used; i < pool.length; i++){ pool[i].style.opacity = '0'; pool[i]._key = null; }
  }

  return { onSocial, update, say };
}
