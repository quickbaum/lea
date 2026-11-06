// What you've seen of the land: the record behind the maps' darkness. Rays go out
// from your eye over the terrain, and ground counts as seen while no nearer rise
// stands between it and you. So a hilltop opens a country and a hollow opens little.
// Only the ground hides things; trees don't, or a wood would stay dark as you walk it.
// Pure (the height function comes in), so tools/check-sight.mjs runs it without a browser.

export function makeSight({ size, height, water, cell = 4, reach = 130, near = 14, rays = 256, stand = 2, onSee = () => {} }){
  const N = Math.ceil(size / cell), half = size / 2, cells = new Uint8Array(N * N);
  let count = 0;
  function mark(x, z){
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const k = j * N + i;
    if (cells[k]) return;
    cells[k] = 1; count++; onSee(i, j);
  }
  function look(x, z, eye){
    for (let b = -near; b <= near; b += cell) for (let a = -near; a <= near; a += cell)   // what's at your feet, always
      if (a * a + b * b <= near * near) mark(x + a, z + b);
    for (let r = 0; r < rays; r++){
      const dx = Math.cos(r / rays * Math.PI * 2), dz = Math.sin(r / rays * Math.PI * 2);
      let top = -Infinity;                            // the steepest rise along this ray so far
      for (let d = cell; d <= reach; d += cell){
        const px = x + dx * d, pz = z + dz * d;
        if (Math.abs(px) >= half || Math.abs(pz) >= half) break;
        const g = Math.max(height(px, pz), water);    // a lake is flat, and hides nothing beyond it
        if ((g + stand - eye) / d >= top) mark(px, pz);   // `stand`: anything standing there shows over a low rise, and it keeps the edge from speckling
        top = Math.max(top, (g - eye) / d);
      }
    }
  }
  // all of it at once, hill or no hill (the Wizard Eye spell). No onSee: the caller clears its veil whole
  function revealAll(){ cells.fill(1); count = N * N; }
  function seen(x, z){
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    return i >= 0 && j >= 0 && i < N && j < N && cells[j * N + i] === 1;
  }
  return { look, revealAll, seen, N, get share(){ return count / (N * N); } };
}
