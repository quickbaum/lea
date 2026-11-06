// close-x.js — the one way every popup offers to be shut: a dark disc in a brass ring with a
// penned cross, top right of what it shuts. The look is CSS and the cross is an inline SVG with
// no ids, so it draws the same however the popup that holds it is hidden.
//   const x = closeX(fn, 'Close (Esc)')   a button; the click goes no further than it
//   pinX(x, frame, overlay)               on frame's corner, for a frame that scrolls or clips
//                                         (a child couldn't hang over its edge). Lets go by itself
//                                         once the button or the popup is taken away

const CSS = `
.close-x {
  position: absolute; z-index: 5; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
  display: grid; place-items: center; cursor: pointer; color: #eadfbf;
  background: radial-gradient(circle at 38% 28%, #4a3f2a, #231e15 62%, #15120c);
  box-shadow: 0 0 0 1.5px #c9a23a, 0 0 0 2.5px #0009, inset 0 1px 1px #fff3, 0 3px 8px #000b;
  transition: color .12s, box-shadow .12s, transform .12s;
  -webkit-tap-highlight-color: transparent;
}
.close-x::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; }
.close-x svg { width: 18px; height: 18px; display: block; filter: drop-shadow(0 1px 0 #0009); }
.close-x:hover { color: #fff3c4; transform: scale(1.08); box-shadow: 0 0 0 1.5px #f0cf6a, 0 0 0 2.5px #0009, inset 0 1px 1px #fff5, 0 3px 10px #000c, 0 0 10px #e8c75a66; }
.close-x:active { transform: scale(.95); }
.close-x:focus-visible { outline: 2px solid #fff3c4; outline-offset: 3px; }
.close-x.pinned { transform: translate(-50%, -50%); }
.close-x.pinned:hover { transform: translate(-50%, -50%) scale(1.08); }
.close-x.pinned:active { transform: translate(-50%, -50%) scale(.95); }
`;
const CROSS = '<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="currentColor" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round" d="M3.4 3.4Q9.9 7.6 14.6 14.6 8.1 10.4 3.4 3.4ZM14.6 3.4Q10.4 9.9 3.4 14.6 7.6 8.1 14.6 3.4Z"/></svg>';

function ensureCss(){
  if (document.getElementById('close-x-css')) return;
  const st = document.createElement('style'); st.id = 'close-x-css'; st.textContent = CSS;
  document.head.appendChild(st);
}

export function closeX(fn, title = 'Close (Esc)'){
  ensureCss();
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'close-x'; b.title = title; b.setAttribute('aria-label', 'Close');
  b.innerHTML = CROSS;
  b.addEventListener('click', e => { e.stopPropagation(); fn(); });
  return b;
}

// layout's own numbers, not the screen rect, so a frame still flying in (page.js flyOut) doesn't
// carry the button with it. Kept far enough in from the window's edge to stay whole and pressable
export function pinX(x, frame, overlay){
  const EDGE = 24;
  x.classList.add('pinned');
  overlay.appendChild(x);
  const place = () => {
    if (!x.isConnected){ seen.disconnect(); removeEventListener('resize', place); return; }
    x.style.left = `${Math.min(frame.offsetLeft + frame.offsetWidth, overlay.clientWidth - EDGE)}px`;
    x.style.top = `${Math.max(frame.offsetTop, EDGE)}px`;
  };
  const seen = new ResizeObserver(place); seen.observe(frame);
  addEventListener('resize', place);
  place();
}
