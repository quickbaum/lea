// talk-view.js — the dwellers' talk, shown as speech bubbles. Reads the social
// events agents.js sends out (world.onSocial): each 'say' is one move of a
// conversation (js/convo.js) — a bubble over the speaker for as long as the move
// takes, with its icon (or the face of the person it's about), and a small
// green/red mark for how it landed with the listener. A glimpse is one passing
// bubble — hearts, or a scowl. Walk up close and a conversation opens into its
// spoken lines (lineFor, from main.js); once you've heard one it stays words to
// its end, even as you walk off. say() is one of them speaking to you.
// Whoever's playing an instrument (main.js: the fires' players, and a band playing for you)
// has a note over their head while their part lasts, bobbing; beside their bubble if they talk.
//
// A bubble stays where it was first said, over the spot the speaker's head was, and its tail
// stretches to follow them, as far as TAIL_MAX; past that they draw the bubble along. A line said to you stays on the screen, pinned to its edge, so you can
// still read it after you've walked past the spot; anyone else's goes when the spot's out of view.
// Named characters (name()) carry their name over their head the same way; when they speak it
// goes above the bubble, "Name:", and the two never overlap.
//
// Plain HTML over the canvas, NOT in the 3D scene: the world is drawn at a
// fraction of screen resolution and upscaled pixelated, and the icons must stay
// sharp to be legible. Only the few bubbles nearest the player are drawn.

import * as THREE from 'three';
import { ICONS } from './talk-icons.js';
import { height } from './terrain.js';
import { ringLine } from './dialog.js';
import { prepare } from './speech-score.js';
import { handOf, inkOn } from './lilt.js';
const escH = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const REACT_AT  = 0.45;   // when, as a share of the move, the reaction mark appears
const GLANCE_S  = 3;
const RANGE     = 40;     // bubbles further than this from the player aren't drawn
const NEAR_TEXT = 7;      // closer than this, a conversation shows its words
const MAX_SHOWN = 5;      // bubbles on screen at once (nearest win)
const SAY_S     = 5;      // a remark to the player stays up this long
const PLAY_RANGE = 60;    // a player's note shows from further than talk (you hear music further)
const NAME_RANGE = 60;    // a name shows from this far
const NAME_H = 30;        // px a "Name:" takes above a bubble, and its gap
const TAIL_MAX = 120;     // px a tail may stretch on the screen; past that the speaker draws the bubble along
const TAIL_BASE = 7;      // half the width of a tail where it leaves the bubble
const CORNER = 14;        // and how far it keeps from the bubble's corners
const EDGE = 8;           // px a pinned bubble keeps from the screen's edge
const MAP_CLEAR = 250;    // and from the right, on a screen with room: the minimap's up there

const CSS = `
#talk{position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden;}
#talk .tb{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;
  padding:5px 8px;background:#fbf8ef;color:#2e2a24;border:2px solid #2e2a24;border-radius:12px;
  font:15px/1.3 Georgia,serif;max-width:310px;box-shadow:0 2px 6px rgba(0,0,0,.25);
  transform-origin:50% 100%;will-change:transform;transition:opacity .15s;}
#talk .tb svg.tail{position:absolute;left:50%;top:100%;width:1px;height:1px;overflow:visible;
  fill:#fbf8ef;stroke:#2e2a24;stroke-width:2;stroke-linejoin:round;}
#talk .tb svg:not(.tail){width:30px;height:30px;flex:none;fill:#2e2a24;}
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
#talk .tb.glance svg:not(.tail){width:24px;height:24px;}
#talk .tb.glance.like svg:not(.tail){fill:#c0453a;}
#talk .tn{position:absolute;left:0;top:0;padding:1px 9px;background:#fbf8ef;color:#2e2a24;
  border:2px solid #2e2a24;border-radius:12px;font:15px/1.3 Georgia,serif;white-space:nowrap;
  box-shadow:0 2px 6px rgba(0,0,0,.25);transform-origin:50% 100%;will-change:transform;transition:opacity .15s;}
#talk .tp{position:absolute;left:0;top:0;width:26px;height:26px;border-radius:50%;
  background:#fbf8ef;border:2px solid #2e2a24;box-shadow:0 2px 6px rgba(0,0,0,.25);
  display:flex;align-items:center;justify-content:center;will-change:transform;transition:opacity .2s;}
#talk .tp svg{width:18px;height:18px;fill:#2e2a24;animation:tp-bob .9s ease-in-out infinite alternate;}
@keyframes tp-bob{from{transform:translateY(1.5px) rotate(-8deg)}to{transform:translateY(-1.5px) rotate(8deg)}}
`;

function svg(name){
  const d = ICONS[name] || ICONS.person;
  return `<svg viewBox="0 0 512 512" aria-hidden="true"><path d="${d}"/></svg>`;
}

// A bubble's tail, as an open path: filled, it covers the bubble's border where it leaves, and only
// its two long sides are stroked, so bubble and tail read as one shape. In the bubble's own px, from
// the bottom middle of its inside; W, H its inside. It leaves by the side nearest the tip. '' if
// the tip's inside the bubble.
export function tailPath(W, H, tx, ty){
  const hw = W / 2, ox = Math.abs(tx) - hw, oy = ty > 0 ? ty : -H - ty;
  if (ox <= 0 && oy <= 0) return '';
  const hold = (a, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, a));
  const f = n => n.toFixed(1);
  if (oy >= ox){
    const x = hold(tx, -hw + CORNER, hw - CORNER), y = ty > 0 ? 0 : -H;
    return `M${f(x - TAIL_BASE)} ${f(y)}L${f(tx)} ${f(ty)}L${f(x + TAIL_BASE)} ${f(y)}`;
  }
  const y = hold(ty, -H + CORNER, -CORNER), x = Math.sign(tx) * hw;
  return `M${f(x)} ${f(y - TAIL_BASE)}L${f(tx)} ${f(ty)}L${f(x)} ${f(y + TAIL_BASE)}`;
}

export function makeTalkView({ camera, canvas, lineFor }){
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const layer = document.createElement('div'); layer.id = 'talk'; document.body.appendChild(layer);
  const lines = [];      // { move, who, t, dur, convo } — one per conversation at a time
  const glances = [];    // { who, like, t }
  const pool = [];       // bubble elements, reused
  const notes = [];      // the players' notes, reused
  const names = new Map();   // who → { el, name, ink }
  const v = new THREE.Vector3(), head = new THREE.Vector3();

  // who carries their name over their head: `hand` (js/lilt.js) inks it
  function name(who, text, hand){
    if (!who || names.has(who)) return;
    const el = document.createElement('div'); el.className = 'tn'; el.style.opacity = '0';
    el.style.color = inkOn(handOf(hand), 'paper'); el.style.fontStyle = handOf(hand)?.font || '';
    layer.appendChild(el);
    names.set(who, { el, name: text });
  }
  // where the point `v` (a world position) falls on the screen, in px. off: it's outside it.
  // Behind the camera a projection comes out mirrored, so it's turned back and sent far out to the side.
  function toScreen(w, h){
    v.project(camera);
    const behind = v.z > 1;
    const nx = behind ? -v.x * 1e3 : v.x, ny = behind ? -v.y * 1e3 : v.y;
    return { x: (nx * 0.5 + 0.5) * w, y: (-ny * 0.5 + 0.5) * h, off: behind || v.z < -1 || Math.abs(nx) > 1.1 || Math.abs(ny) > 1.1 };
  }

  function onSocial(e){
    if (e.type === 'say'){
      const l = { move: e.move, who: e.move.who, t: 0, dur: e.move.dur || 2.5, convo: e.convo };
      const i = lines.findIndex(x => x.convo === e.convo);      // a new move replaces that talk's last
      if (i >= 0) lines[i] = l; else lines.push(l);
    } else if (e.type === 'glance') glances.push({ who: e.who, like: e.like, t: 0 });
  }

  // someone speaks to the player: one move, already words (replacing their last remark, if it's still up)
  function say(who, move){
    const l = { move, who, t: 0, dur: SAY_S, convo: { heard: true, said: true } };
    const i = lines.findIndex(x => x.who === who && x.convo.said);
    if (i >= 0){ lines[i].move.ring?.stop(); lines[i] = l; } else lines.push(l);   // (a line cut off stops singing)
  }

  function bubble(i){
    let el = pool[i];
    if (!el){
      el = document.createElement('div'); el.className = 'tb';
      el.innerHTML = '<span class="ic"></span><span class="line"></span><span class="re"></span><svg class="tail" aria-hidden="true"><path/></svg>';
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
    el.children[1].textContent = ''; el._ringM = null;
    el.children[2].className = 're'; el.children[2].textContent = '';
  }

  function headPos(n){
    const gy = n.rideY != null ? n.rideY : height(n.x, n.z);
    return v.set(n.x, gy + (n.h || 1.7) * (n._curPose === 'sitting' ? 0.66 : 1.0) + 0.35, n.z);
  }

  // players: the npcs playing an instrument right now
  // showNames: the name tags are up (not on the splash, not underground)
  // unnamed: whoever the "E to talk to" box is over, which already says who they are
  function update(dt, px, pz, players = [], showNames = true, unnamed = null){
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
    const talking = new Map();       // who has a bubble up → where it is on screen
    for (const s of shown){
      if (used >= MAX_SHOWN) break;
      const rec = s.line || s.glance, toYou = !!s.line?.convo.said;
      head.copy(headPos(s.who));
      if (!rec.at){                                   // it's first seen where their head is now, and stays there
        if (toScreen(w, h).off) continue;             // behind or off screen
        rec.at = head.clone();
      }
      const spot = (v.copy(rec.at), toScreen(w, h));
      if (spot.off && !toYou) continue;               // gone from view: only what's said to you stays up
      const el = bubble(used++);
      if (s.glance){
        const key = s.glance;
        if (el._key !== key){ el._key = key; el.className = 'tb glance' + (key.like ? ' like' : '');
          el.firstChild.innerHTML = svg(key.like ? 'hearts' : 'cross'); el.children[1].textContent = ''; el.children[2].className = 're'; }
      } else {
        const l = s.line, m = l.move;
        fill(el, m);
        // their ink and lettering (the element is reused, so set them every time)
        const hand = handOf(m.hand || s.who), lineEl = el.children[1];
        lineEl.style.color = inkOn(hand, 'paper'); lineEl.style.fontStyle = hand?.font || '';
        const near = !!l.convo.heard;
        el.classList.toggle('near', near);
        el.classList.toggle('lore', m.key === 'saying');      // a saying or song: verse, in italics
        // the line is worked out once per move and kept, so it never changes under you
        if (near && m.line == null && lineFor){
          try { m.line = lineFor(m) || ''; } catch (e){ m.line = ''; console.warn('talk: no words for', m.key, e); }   // never stop the frame over words
        }
        // a line with a lilt (move.lilt: Puck's guide lines) sings, its words coming up on their notes
        if (near && m.lilt && m.line && m.ring === undefined){
          m.ring = ringLine(m.line, m.lilt, m.hand);
          if (m.ring) l.dur = Math.max(l.dur, m.ring.length + 2.5);
        }
        if (m.ring){
          const now = m.ring.t0 == null ? -1 : (performance.now() - m.ring.t0) / 1000;
          const n = m.ring.words.filter(w => w.t <= now + 0.01).length;
          if (el._ringM !== m || el._ringN !== n){
            el._ringM = m; el._ringN = n;
            el.children[1].innerHTML = m.ring.words.map((w, i) => (i ? (w.br ? '\n' : ' ') : '') + (i < n ? escH(w.text) : `<span style="opacity:0">${escH(w.text)}</span>`)).join('');
          }
        } else if (near && !el.children[1].textContent) el.children[1].textContent = (m.lilt ? prepare(m.line || '').clean : m.line) || '';
        const re = el.children[2];
        if (l.t >= l.dur * REACT_AT && m.react){
          re.className = 're ' + (m.react > 0 ? 'up' : 'down');
          re.textContent = m.react > 0 ? '+' : '−';
        }
      }
      const sc = Math.max(0.7, 1 - Math.hypot(rec.at.x - px, rec.at.z - pz) / (RANGE * 1.6));
      // the bottom middle of the bubble on the screen, kept on it if it's said to you
      const bw = el.offsetWidth * sc, bh = el.offsetHeight * sc, above = names.has(s.who) && showNames ? NAME_H * sc : 0;
      const spotZ = (v.copy(rec.at).project(camera), v.z);
      let x = spot.x, y = spot.y - 10;
      const pin = clear => {
        if (!toYou) return;
        const right = w - clear - bw / 2;
        x = Math.max(EDGE + bw / 2, Math.min(right, x));
        y = Math.max(EDGE + bh + above, Math.min(h - EDGE, y));
      };
      pin(w > 700 ? MAP_CLEAR : EDGE);
      // the tail, to where the speaker is now (or the edge of the screen, in their direction)
      const tip = (v.copy(head), toScreen(w, h));
      const tx = Math.max(0, Math.min(w, tip.x)), ty = Math.max(0, Math.min(h, tip.y));
      // too long, and the bubble comes along: from its nearest edge to the tip, no further than TAIL_MAX
      const gx = tx - x, gy = ty > y ? ty - y : ty - (y - bh);
      const ox = Math.sign(gx) * Math.max(0, Math.abs(gx) - bw / 2), oy = ty <= y && ty >= y - bh ? 0 : gy;
      const tail = Math.hypot(ox, oy);
      if (tail > TAIL_MAX){
        const k = (tail - TAIL_MAX) / tail;
        x += ox * k; y += oy * k;
        pin(EDGE);                                    // the tail's limit beats keeping clear of the minimap
        // and it stays where it's been drawn to. A spot behind you can't be moved on the screen: it follows next frame's pin
        if (!spot.off) rec.at.set(x / w * 2 - 1, 1 - (y + 10) / h * 2, spotZ).unproject(camera);
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      el.style.opacity = '1';
      el.style.zIndex = String(MAX_SHOWN - used);     // the nearest talk on top
      el.children[3].firstChild.setAttribute('d', tailPath(el.clientWidth, el.clientHeight, (tx - x) / sc, (ty - y) / sc + el.clientTop));
      talking.set(s.who, { sc, x, top: y - bh, z: el.style.zIndex });
    }
    for (let i = used; i < pool.length; i++){ pool[i].style.opacity = '0'; pool[i]._key = null; }

    // a note over each player's head (over to the side of a bubble, if they're talking)
    let k = 0;
    for (const n of players){
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d > PLAY_RANGE) continue;
      headPos(n).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      let el = notes[k];
      if (!el){ el = document.createElement('div'); el.className = 'tp'; el.innerHTML = svg('music'); layer.appendChild(el); notes[k] = el; }
      k++;
      const sc = Math.max(0.7, 1 - d / (PLAY_RANGE * 1.6)), side = talking.has(n) ? 70 * talking.get(n).sc : 0;
      const x = (v.x * 0.5 + 0.5) * w + side, y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, calc(-100% - 10px)) scale(${sc.toFixed(3)})`;
      el.style.opacity = '1';
    }
    for (let i = k; i < notes.length; i++) notes[i].style.opacity = '0';

    // the names: above the bubble if they're speaking, else over their head
    for (const [who, tag] of names){
      const said = showNames && talking.get(who), d = Math.hypot(who.x - px, who.z - pz);
      const fade = who.mat ? who.mat.opacity : 1;     // (Puck winks out, and his name with him)
      let x, y, sc;
      if (said){ x = said.x; y = said.top - 3 * said.sc; sc = said.sc; tag.el.style.zIndex = said.z; }
      else if (showNames && d < NAME_RANGE){
        headPos(who);
        const p = toScreen(w, h);
        if (!p.off){ x = p.x; y = p.y - 10; sc = Math.max(0.7, 1 - d / (RANGE * 1.6)); tag.el.style.zIndex = '0'; }
      }
      if (x === undefined || who === unnamed){ tag.el.style.opacity = '0'; continue; }
      const text = said ? tag.name + ':' : tag.name;
      if (tag.text !== text) tag.el.textContent = tag.text = text;
      tag.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      tag.el.style.opacity = String(fade);
    }
  }

  return { onSocial, update, say, name };
}
