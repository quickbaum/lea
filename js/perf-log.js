// perf-log.js — ?perflog: records how the game runs on the machine actually playing it, and sends
// it home for reading (docs/perf-notes.md, "Recording on your own machine"). A second at a time:
// frame times, what the sim and the draw took, what the renderer holds, and each long stall with
// the scripts behind it, where the browser says. Sends itself every 30 s and on leaving, to
// /api/perflog (logs/perf/ on the server). Where that isn't there, "Save" gives you the file.
// Off, it isn't made at all. It must never break the game, so the risky parts are in try.
//
//   const log = makePerfLog({ perf, renderer, state, send })
//   log.frame(frameMs)   // from the loop, each frame
//   log.mark('entered')  // something worth finding on the timeline
//   log.data()           // what's been gathered

const MAX_SECONDS = 1800, MAX_STALLS = 1000, STALL_MS = 100, SEND_EVERY = 30;

export function makePerfLog({ perf, renderer, state = () => ({}), send = null, now = () => performance.now() }){
  const t0 = now(), id = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const seconds = [], stalls = [], marks = [];
  const at = () => +((now() - t0) / 1000).toFixed(2);
  let b = null, last = { sim: perf.sim, draw: perf.draw, frames: perf.frames }, sentAt = 0;
  const fresh = () => ({ n: 0, ms: 0, worst: 0, over50: 0, over100: 0 });
  b = fresh();

  const meta = {};
  try {
    Object.assign(meta, { id, ua: navigator.userAgent, dpr: devicePixelRatio, window: [innerWidth, innerHeight], url: location.search });
    const gl = renderer.getContext(), info = gl.getExtension('WEBGL_debug_renderer_info');
    meta.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch {}

  function closeSecond(){
    const s = { t: at(), frames: b.n, avgMs: b.n ? +(b.ms / b.n).toFixed(1) : 0, worstMs: +b.worst.toFixed(1), over50: b.over50, over100: b.over100 };
    // perf is the loop's own running totals; leaPerf() can zero them, so a drop reads as nothing spent
    const counted = perf.frames - last.frames;
    if (counted > 0){ s.simMs = +((perf.sim - last.sim) / counted).toFixed(2); s.drawMs = +((perf.draw - last.draw) / counted).toFixed(2); }
    last = { sim: perf.sim, draw: perf.draw, frames: perf.frames };
    try {
      s.calls = perf.calls; s.tris = perf.triangles;
      const m = renderer.info.memory; s.textures = m.textures; s.geometries = m.geometries; s.programs = renderer.info.programs?.length;
      if (performance.memory) s.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
      Object.assign(s, state());
    } catch {}
    if (seconds.length < MAX_SECONDS) seconds.push(s);
    b = fresh();
  }

  const log = {
    id,
    frame(ms){
      b.n++; b.ms += ms; if (ms > b.worst) b.worst = ms;
      if (ms > 50) b.over50++; if (ms > 100) b.over100++;
      if (now() - t0 >= (seconds.length + 1) * 1000) tick();
    },
    mark(name){ marks.push({ t: at(), name }); },
    data: () => ({ meta, marks, seconds, stalls }),
    send: reason => { try { send?.(log.data(), reason); } catch {} },
  };
  function tick(){
    closeSecond();
    show?.();
    if (at() - sentAt >= SEND_EVERY){ sentAt = at(); log.send('every 30 s'); }
  }

  // the stalls. Long-animation-frame names the scripts behind one (Chrome); long tasks only say when
  try {
    const kinds = PerformanceObserver.supportedEntryTypes || [];
    const useLoaf = kinds.includes('long-animation-frame');
    meta.stallKind = useLoaf ? 'long-animation-frame' : kinds.includes('longtask') ? 'longtask' : 'none';
    if (meta.stallKind !== 'none') new PerformanceObserver(list => {
      for (const e of list.getEntries()){
        if (e.duration < STALL_MS || stalls.length >= MAX_STALLS) continue;
        const r = { t: +((e.startTime - t0) / 1000).toFixed(2), ms: Math.round(e.duration) };
        if (e.scripts?.length) r.scripts = e.scripts.slice().sort((a, c) => c.duration - a.duration).slice(0, 4).map(q => ({ ms: Math.round(q.duration), fn: q.sourceFunctionName || q.invoker || '', file: (q.sourceURL || '').split('/').pop(), line: q.sourceCharPosition }));
        if (e.renderStart) r.renderMs = Math.round(e.startTime + e.duration - e.renderStart);
        stalls.push(r);
      }
    }).observe({ type: meta.stallKind, buffered: true });
  } catch {}

  // a small sign, so you know it's on, and a way to keep the file yourself
  let show = null;
  try {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;font:11px monospace;color:#fff;background:#000a;padding:3px 6px;border-radius:3px';
    const text = document.createElement('span'), save = document.createElement('button');
    save.textContent = 'Save'; save.style.cssText = 'margin-left:6px;font:11px monospace;cursor:pointer';
    save.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(log.data())], { type: 'application/json' }));
      a.download = `perf-${id}.json`; a.click();
    };
    box.append(text, save); document.body.appendChild(box);
    let told = '';
    log.status = t => { told = t; };
    show = () => { const s = seconds.at(-1); text.textContent = `● REC ${Math.round(at())}s ${s ? `${s.frames}fps` : ''} ${told}`; };
    addEventListener('visibilitychange', () => log.mark(document.hidden ? 'tab hidden' : 'tab shown'));
    addEventListener('pagehide', () => log.send('leaving'));
  } catch {}
  return log;
}

// to the server, with a word on the sign about how that went
export function sendPerfLog(log){
  return (data, reason) => {
    const body = JSON.stringify({ reason, ...data });
    if (reason === 'leaving'){ navigator.sendBeacon?.('/api/perflog', body); return; }
    fetch('/api/perflog', { method: 'POST', body }).then(r => log.status?.(r.ok ? 'sent' : 'not sent: use Save')).catch(() => log.status?.('not sent: use Save'));
  };
}
