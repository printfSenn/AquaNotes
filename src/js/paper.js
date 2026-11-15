/* Paper: a procedural paper texture, plus per-note looks (tone, fold, curled corner, slightly rough edge)
   for the floating cards. Exposes WN.paper = { texture(), style(id), edge(id, wetness) }. */
(function () {
  window.WN = window.WN || {};
  var styles = {}, tex = null;

  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // value noise that wraps around (period px, py), so the texture tiles without seams
  function lattice(x, y) { var h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
  function tnoise(x, y, px, py) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px, y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
    return (lattice(x0, y0) * (1 - u) + lattice(x1, y0) * u) * (1 - v) + (lattice(x0, y1) * (1 - u) + lattice(x1, y1) * u) * v;
  }

  // Dark features only (it is multiplied onto the paper colour): cloudy mottling, fine grain, long fibres and a few flecks.
  function texture() {
    if (tex) return tex;
    var W = 320, H = 200, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), im = g.createImageData(W, H), d = im.data, rnd = mulberry(20241115);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var mottle = tnoise(x / W * 7, y / H * 4.5, 7, 5), mid = tnoise(x / W * 46, y / H * 29, 46, 29), grain = rnd();
      var a = 0.05 + (mottle - 0.5) * 0.09 + (mid - 0.5) * 0.07 + (grain - 0.5) * 0.09; a = a < 0 ? 0 : a > 0.22 ? 0.22 : a;
      var k = (y * W + x) * 4; d[k] = 70; d[k + 1] = 62; d[k + 2] = 50; d[k + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
    g.lineCap = 'round';
    for (var i = 0; i < 230; i++) {                     // fibres, drawn three times each so they wrap around the tile edges
      var fx = rnd() * W, fy = rnd() * H, len = 7 + rnd() * 24, ang = rnd() * 6.283, bend = (rnd() - 0.5) * 9;
      var mx = fx + Math.cos(ang) * len / 2 + Math.cos(ang + 1.57) * bend, my = fy + Math.sin(ang) * len / 2 + Math.sin(ang + 1.57) * bend;
      var ex = fx + Math.cos(ang) * len, ey = fy + Math.sin(ang) * len;
      g.strokeStyle = 'rgba(88,78,62,' + (0.11 + rnd() * 0.18).toFixed(3) + ')'; g.lineWidth = 0.5 + rnd() * 0.6;
      for (var ox = -W; ox <= W; ox += W) for (var oy = -H; oy <= H; oy += H) { g.beginPath(); g.moveTo(fx + ox, fy + oy); g.quadraticCurveTo(mx + ox, my + oy, ex + ox, ey + oy); g.stroke(); }
    }
    for (var s = 0; s < 34; s++) { g.fillStyle = 'rgba(70,58,44,' + (0.18 + rnd() * 0.25).toFixed(2) + ')'; g.beginPath(); g.arc(rnd() * W, rnd() * H, 0.35 + rnd() * 0.7, 0, 6.283); g.fill(); }
    tex = cv.toDataURL('image/png'); return tex;
  }

  // every note keeps the same look (derived from its id)
  function style(id) {
    id = String(id); if (styles[id]) return styles[id];
    var r = mulberry(hashStr(id)), tones = [[252, 253, 255], [253, 248, 236], [241, 242, 238]];   // copy paper, cream, recycled
    var st = { tone: tones[Math.floor(r() * 3)], px: Math.floor(r() * 320), py: Math.floor(r() * 200),
      crease: r() < 0.38 ? { ang: 20 + Math.floor(r() * 140), pos: 32 + Math.floor(r() * 36) } : null,
      curl: r() < 0.5 ? (r() < 0.5 ? 'br' : 'tr') : '', jit: [] };
    for (var i = 0; i < 40; i++) st.jit.push(r() * 2 - 1);
    return (styles[id] = st);
  }

  // the outline: almost straight like cut paper, getting rougher and softer when the paper is wet
  function edge(id, wet) {
    var j = style(id).jit, k = 0.5 + wet * 1.6, pts = [], i = 0;
    function p(x, y) { pts.push((x < 0 ? 0 : x > 100 ? 100 : x).toFixed(2) + '% ' + (y < 0 ? 0 : y > 100 ? 100 : y).toFixed(2) + '%'); }
    var a, b;
    for (a = 0; a <= 10; a++) p(2.2 + 95.6 * a / 10, 0.25 + j[i++ % 40] * 0.9 * k);
    for (b = 1; b <= 5; b++) p(99.75 + j[i++ % 40] * 0.5 * k, 8 + 84 * (b - 1) / 4);
    for (a = 10; a >= 0; a--) p(2.2 + 95.6 * a / 10, 99.75 + j[i++ % 40] * 0.9 * k);
    for (b = 5; b >= 1; b--) p(0.25 + j[i++ % 40] * 0.5 * k, 8 + 84 * (b - 1) / 4);
    return pts.join(',');
  }

  WN.paper = { texture: texture, style: style, edge: edge };
})();
