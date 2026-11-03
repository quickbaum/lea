// telescope.js — what a telescope shows that the naked eye can't (docs/telescope.md). Pure
// data and drawing, no THREE: sky.js builds its points from deepField and hangs moonSurface
// on the moon; main.js names what's in the middle of the glass (sightAt).
//
// The positions of the SIGHTS are the real ones (J2000, degrees), so the Pleiades are
// where the catalogue's Taurus has them. The stars inside them, and the faint
// field along the Milky Way, are invented: the catalogue stops at the eye's limit (mag 6).

const DEG = Math.PI / 180;
// mulberry32: the faint stars and the moon's face are the same every night, for everyone
function stream(seed){
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

// n stars, spread (degrees, one sigma); what the glass says when one sits in the middle of it
export const SIGHTS = [
  { name: 'The Pleiades', ra: 56.75, dec: 24.12, n: 120, spread: 0.55, bv: -0.05, says: 'A hundred stars, where the eye finds seven.' },
  { name: 'The Hyades', ra: 66.75, dec: 15.87, n: 90, spread: 2.2, bv: 0.6, says: 'A loose flock of them, gold and white.' },
  { name: 'The Beehive Cluster', ra: 130.1, dec: 19.67, n: 110, spread: 0.65, bv: 0.5, says: 'The eye sees a smudge. It is a swarm.' },
  { name: 'The Double Cluster', ra: 35.2, dec: 57.14, n: 170, spread: 0.55, bv: 0.1, says: 'Two knots of stars, side by side, and a few red among the white.' },
  { name: 'Messier 35', ra: 92.27, dec: 24.33, n: 100, spread: 0.35, bv: 0.3, says: 'A round crowd of stars, at the feet of Gemini.' },
  { name: 'The Coma Star Cluster', ra: 186.0, dec: 26.0, n: 60, spread: 2.6, bv: 0.4, says: 'A thin scatter, combed out across the dark.' },
  { name: 'The Wild Duck Cluster', ra: 282.77, dec: -6.27, n: 150, spread: 0.18, bv: 0.2, says: 'A wedge of faint stars, flying together.' },
  { name: 'The Hercules Cluster', ra: 250.42, dec: 36.46, n: 260, spread: 0.12, bv: 0.7, says: 'Stars past counting, packed into a ball.' },
  { name: 'The Orion Nebula', ra: 83.82, dec: -5.39, n: 70, spread: 0.2, bv: -0.2, says: 'Hot blue stars, close in a knot.' },
  { name: 'The Andromeda Galaxy', ra: 10.68, dec: 41.27, n: 340, spread: 0.45, bv: 0.8, faint: true, says: 'A long pale cloud that no glass will break into stars.' },
];

// where a sight is in reach of the middle of the glass: the nearest, within its own size or
// `within` degrees, whichever is more. ra, dec in degrees.
export function sightAt(ra, dec, within = 1){
  let best = null, bd = Infinity;
  for (const s of SIGHTS){
    const c = Math.sin(dec * DEG) * Math.sin(s.dec * DEG) + Math.cos(dec * DEG) * Math.cos(s.dec * DEG) * Math.cos((ra - s.ra) * DEG);
    const d = Math.acos(Math.min(1, Math.max(-1, c))) / DEG;
    if (d < Math.max(within, s.spread * 2) && d < bd){ bd = d; best = s; }
  }
  return best;
}

// the faint stars, in the catalogue's shape [ra°, dec°, mag, B-V]: fainter than mag 6, thick
// along the Milky Way and thickest toward its centre, thin elsewhere; and the SIGHTS' own
export function deepField(n = 22000){
  const r = stream(0x7e1e5c0b), out = [];
  const eq = (ra, dec) => [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pole = eq(192.86, 27.13), c0 = eq(266.4, -28.94);        // the galaxy's north pole; its centre
  const k = dot(pole, c0), centre = c0.map((v, i) => v - k * pole[i]);   // (square to the pole)
  const m = Math.hypot(...centre); centre.forEach((v, i) => { centre[i] = v / m; });
  const side = [pole[1] * centre[2] - pole[2] * centre[1], pole[2] * centre[0] - pole[0] * centre[2], pole[0] * centre[1] - pole[1] * centre[0]];
  const colour = () => -0.2 + 1.8 * r() * r();
  const faint = () => 6.05 + 3.4 * Math.sqrt(r());               // more faint ones than bright ones
  for (let i = 0; i < n; i++){
    if (r() < 0.28){                                             // the thin scatter, all over
      const z = 2 * r() - 1, a = 360 * r();
      out.push([a, Math.asin(z) / DEG, faint(), colour()]);
      continue;
    }
    const l = gauss(r) * 70 * DEG * (r() < 0.45 ? 1 : 2.6), b = gauss(r) * 6.5 * DEG;   // along the band; across it
    const cb = Math.cos(b), p = [0, 1, 2].map(j => cb * (Math.cos(l) * centre[j] + Math.sin(l) * side[j]) + Math.sin(b) * pole[j]);
    out.push([((Math.atan2(p[1], p[0]) / DEG) + 360) % 360, Math.asin(p[2]) / DEG, faint(), colour()]);
  }
  for (const s of SIGHTS) for (let i = 0; i < s.n; i++){
    const dec = s.dec + gauss(r) * s.spread;
    out.push([(s.ra + gauss(r) * s.spread / Math.cos(s.dec * DEG) + 360) % 360, dec, s.faint ? 8.8 + r() * 0.7 : 6.05 + 2.6 * r(), s.bv + (r() - 0.5) * 0.5]);
  }
  return out;
}

// the moon's face through the glass: seas where our moon has them, then craters, each a
// shaded bowl with a lit rim. S×S, the disc radius r about the middle. Drawn once.
export function moonSurface(S, r){
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), R = stream(0x3a0071), cx = S / 2, u = r / 100;
  g.fillStyle = '#d4d6da'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++){                                // the highland's grain
    g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(70,72,80,0.05)';
    g.beginPath(); g.arc(cx + (R() * 2 - 1) * r, cx + (R() * 2 - 1) * r, (1 + R() * 5) * u, 0, 7); g.fill();
  }
  g.fillStyle = 'rgba(92,96,108,0.16)';                          // the seas: blobs of blobs, soft-edged by overlap
  for (const [x, y, q] of [[-38, -40, 30], [-8, -36, 22], [-54, 2, 34], [20, -22, 20], [34, -2, 24], [62, -30, 13], [-26, 34, 22], [14, 26, 16], [-10, 2, 15]])
    for (let i = 0; i < 26; i++){
      const a = R() * 6.28, d = q * Math.sqrt(R());
      g.beginPath(); g.arc(cx + (x + Math.cos(a) * d) * u, cx + (y + Math.sin(a) * d) * u, (q * 0.35 + R() * q * 0.35) * u, 0, 7); g.fill();
    }
  const crater = (x, y, q) => {
    const px = cx + x * u, py = cx + y * u, pq = q * u;
    g.fillStyle = 'rgba(64,66,76,0.55)'; g.beginPath(); g.arc(px, py, pq, 0, 7); g.fill();
    g.strokeStyle = 'rgba(245,246,248,0.8)'; g.lineWidth = Math.max(1, pq * 0.2); g.beginPath(); g.arc(px - pq * 0.08, py + pq * 0.08, pq, 0.4, 3.9); g.stroke();
    if (q > 4.5){ g.fillStyle = 'rgba(232,234,238,0.75)'; g.beginPath(); g.arc(px, py, pq * 0.17, 0, 7); g.fill(); }   // the central peak
  };
  g.strokeStyle = 'rgba(248,248,250,0.14)';                      // one young crater's rays, low in the south
  for (let i = 0; i < 26; i++){
    const a = R() * 6.28, l = 25 + R() * 90;
    g.lineWidth = (0.6 + R() * 1.5) * u; g.beginPath(); g.moveTo(cx - 8 * u, cx + 72 * u); g.lineTo(cx + (-8 + Math.cos(a) * l) * u, cx + (72 + Math.sin(a) * l) * u); g.stroke();
  }
  crater(-8, 72, 5.5); crater(-28, 12, 5); crater(-44, -24, 4); crater(36, 44, 6);   // a few to know it by
  for (let i = 0; i < 230; i++){
    const a = R() * 6.28, d = 100 * Math.sqrt(R());
    crater(Math.cos(a) * d, Math.sin(a) * d, 0.6 + 4.2 * R() * R() * R());
  }
  return c;
}

// the named stars: [name, ra°, dec°, IAU constellation]. The catalogue (sky/stars.json) has only
// positions, so these are matched to it by place; check-telescope fails if one lands on no
// bright star, or a bright star has no name. Their usual names, from general knowledge.
export const NAMED_STARS = [
  ['Sirius', 101.29, -16.72, 'Canis Major'], ['Canopus', 95.99, -52.70, 'Carina'], ['Arcturus', 213.92, 19.18, 'Boötes'],
  ['Rigil Kentaurus', 219.90, -60.83, 'Centaurus'], ['Vega', 279.23, 38.78, 'Lyra'], ['Capella', 79.17, 46.00, 'Auriga'],
  ['Rigel', 78.63, -8.20, 'Orion'], ['Procyon', 114.83, 5.22, 'Canis Minor'], ['Achernar', 24.43, -57.24, 'Eridanus'],
  ['Betelgeuse', 88.79, 7.41, 'Orion'], ['Hadar', 210.96, -60.37, 'Centaurus'], ['Altair', 297.70, 8.87, 'Aquila'],
  ['Acrux', 186.65, -63.10, 'Crux'], ['Aldebaran', 68.98, 16.51, 'Taurus'], ['Antares', 247.35, -26.43, 'Scorpius'],
  ['Spica', 201.30, -11.16, 'Virgo'], ['Pollux', 116.33, 28.03, 'Gemini'], ['Fomalhaut', 344.41, -29.62, 'Piscis Austrinus'],
  ['Deneb', 310.36, 45.28, 'Cygnus'], ['Mimosa', 191.93, -59.69, 'Crux'], ['Regulus', 152.09, 11.97, 'Leo'],
  ['Adhara', 104.66, -28.97, 'Canis Major'], ['Castor', 113.65, 31.89, 'Gemini'], ['Gacrux', 187.79, -57.11, 'Crux'],
  ['Shaula', 263.40, -37.10, 'Scorpius'], ['Bellatrix', 81.28, 6.35, 'Orion'], ['Elnath', 81.57, 28.61, 'Taurus'],
  ['Miaplacidus', 138.30, -69.72, 'Carina'], ['Alnilam', 84.05, -1.20, 'Orion'], ['Alnair', 332.06, -46.96, 'Grus'],
  ['Alnitak', 85.19, -1.94, 'Orion'], ['Alioth', 193.51, 55.96, 'Ursa Major'], ['Dubhe', 165.93, 61.75, 'Ursa Major'],
  ['Mirfak', 51.08, 49.86, 'Perseus'], ['Wezen', 107.10, -26.39, 'Canis Major'], ['Sargas', 264.33, -43.00, 'Scorpius'],
  ['Kaus Australis', 276.04, -34.38, 'Sagittarius'], ['Avior', 125.63, -59.51, 'Carina'], ['Alkaid', 206.88, 49.31, 'Ursa Major'],
  ['Menkalinan', 89.88, 44.95, 'Auriga'], ['Atria', 252.17, -69.03, 'Triangulum Australe'], ['Alhena', 99.43, 16.40, 'Gemini'],
  ['Peacock', 306.41, -56.74, 'Pavo'], ['Alsephina', 131.18, -54.71, 'Vela'], ['Mirzam', 95.67, -17.96, 'Canis Major'],
  ['Alphard', 141.90, -8.66, 'Hydra'], ['Polaris', 37.95, 89.26, 'Ursa Minor'], ['Hamal', 31.79, 23.46, 'Aries'],
  ['Algieba', 154.99, 19.84, 'Leo'], ['Diphda', 10.90, -17.99, 'Cetus'], ['Mizar', 200.98, 54.93, 'Ursa Major'],
  ['Nunki', 283.82, -26.30, 'Sagittarius'], ['Menkent', 211.67, -36.37, 'Centaurus'], ['Mirach', 17.43, 35.62, 'Andromeda'],
  ['Alpheratz', 2.10, 29.09, 'Andromeda'], ['Rasalhague', 263.73, 12.56, 'Ophiuchus'], ['Kochab', 222.68, 74.16, 'Ursa Minor'],
  ['Saiph', 86.94, -9.67, 'Orion'], ['Denebola', 177.26, 14.57, 'Leo'], ['Algol', 47.04, 40.96, 'Perseus'],
  ['Almach', 30.97, 42.33, 'Andromeda'], ['Sadr', 305.56, 40.26, 'Cygnus'], ['Naos', 120.90, -40.00, 'Puppis'],
  ['Alphecca', 233.67, 26.71, 'Corona Borealis'], ['Mintaka', 83.00, -0.30, 'Orion'], ['Aludra', 111.02, -29.30, 'Canis Major'],
  ['Caph', 2.29, 59.15, 'Cassiopeia'], ['Schedar', 10.13, 56.54, 'Cassiopeia'], ['Ruchbah', 21.45, 60.24, 'Cassiopeia'],
  ['Eltanin', 269.15, 51.49, 'Draco'], ['Merak', 165.46, 56.38, 'Ursa Major'], ['Izar', 221.25, 27.07, 'Boötes'],
  ['Enif', 326.05, 9.88, 'Pegasus'], ['Phecda', 178.46, 53.69, 'Ursa Major'], ['Scheat', 345.94, 28.08, 'Pegasus'],
  ['Alderamin', 319.64, 62.59, 'Cepheus'], ['Markeb', 140.53, -55.01, 'Vela'], ['Markab', 346.19, 15.21, 'Pegasus'],
  ['Menkar', 45.57, 4.09, 'Cetus'], ['Arneb', 83.18, -17.82, 'Lepus'], ['Gienah', 183.95, -17.54, 'Corvus'],
  ['Zubeneschamali', 229.25, -9.38, 'Libra'], ['Zubenelgenubi', 222.72, -16.04, 'Libra'], ['Unukalhai', 236.07, 6.43, 'Serpens'],
  ['Sheratan', 28.66, 20.81, 'Aries'], ['Kraz', 188.60, -23.40, 'Corvus'], ['Muphrid', 208.67, 18.40, 'Boötes'],
  ['Hassaleh', 74.25, 33.17, 'Auriga'], ['Lesath', 262.69, -37.30, 'Scorpius'], ['Albireo', 292.68, 27.96, 'Cygnus'],
  ['Alcyone', 56.87, 24.11, 'Taurus'], ['Sadalsuud', 322.89, -5.57, 'Aquarius'], ['Sadalmelik', 331.45, -0.32, 'Aquarius'],
  ['Tarazed', 296.56, 10.61, 'Aquila'], ['Vindemiatrix', 195.54, 10.96, 'Virgo'], ['Thuban', 211.10, 64.38, 'Draco'],
  ['Rastaban', 262.61, 52.30, 'Draco'], ['Deneb Algedi', 326.76, -16.13, 'Capricornus'], ['Alcor', 201.31, 54.99, 'Ursa Major'],
  ['Megrez', 183.86, 57.03, 'Ursa Major'], ['Algorab', 187.47, -16.52, 'Corvus'], ['Sulafat', 284.74, 32.69, 'Lyra'],
  ['Sheliak', 282.52, 33.36, 'Lyra'], ['Cor Caroli', 194.01, 38.32, 'Canes Venatici'], ['Rasalgethi', 258.66, 14.39, 'Hercules'],
  ['Kornephoros', 247.55, 21.49, 'Hercules'], ['Sabik', 257.59, -15.72, 'Ophiuchus'], ['Dschubba', 240.08, -22.62, 'Scorpius'],
  ['Acrab', 241.36, -19.81, 'Scorpius'], ['Kaus Media', 275.25, -29.83, 'Sagittarius'], ['Ascella', 285.65, -29.88, 'Sagittarius'],
  ['Wasat', 110.03, 21.98, 'Gemini'], ['Mebsuta', 100.98, 25.13, 'Gemini'], ['Tejat', 95.74, 22.51, 'Gemini'],
  ['Zosma', 168.53, 20.52, 'Leo'], ['Chertan', 168.56, 15.43, 'Leo'], ['Ankaa', 6.57, -42.31, 'Phoenix'],
  ['Homam', 340.37, 10.83, 'Pegasus'], ['Algenib', 3.31, 15.18, 'Pegasus'],
];
