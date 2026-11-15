/* Ice: frosted texture, faceted cracks and a shatter animation for the lock screen.
   Exposes WN.ice = { init(lockEl), shatter(lockEl) }. Uses WN.water (optional) to make the pool react. */
(function () {
  window.WN = window.WN || {};
  var cells = [];

  // ---------- value noise for the frost texture ----------
  function hash2(x, y) { var h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177 | 0; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
  function vnoise(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return (hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u) * (1 - v) + (hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u) * v;
  }
  function fbm(x, y) { var v = 0, a = 0.5, f = 1; for (var o = 0; o < 4; o++) { v += a * vnoise(x * f, y * f); f *= 2; a *= 0.5; } return v / 0.9375; }

  // veins, grain, frost that thickens toward the edges, air bubbles and glossy streaks, drawn once to a canvas
  function makeFrost() {
    var W = 640, H = 360, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), im = g.createImageData(W, H), d = im.data;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var n = fbm(x / 90, y / 90), vein = Math.pow(1 - Math.abs(2 * n - 1), 3), grain = fbm(x / 3 + 40, y / 3 + 40);
      var e = Math.min(Math.min(x, W - 1 - x) / W, Math.min(y, H - 1 - y) / H) / 0.2;
      e = e >= 1 ? 0 : (1 - e) * (1 - e) * (0.5 + 0.5 * fbm(x / 25, y / 25));
      var a = 0.05 + vein * 0.34 + e * 0.55 + (grain - 0.5) * 0.12; a = a < 0 ? 0 : a > 0.95 ? 0.95 : a;
      var k = (y * W + x) * 4, t = vein * 0.6 + e * 0.4;
      d[k] = 170 + 75 * t; d[k + 1] = 220 + 32 * t; d[k + 2] = 245 + 10 * t; d[k + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
    for (var i = 0; i < 70; i++) {
      var bx = Math.random() * W, by = Math.random() * H, r = 1.5 + Math.random() * 5, gr = g.createRadialGradient(bx - r * 0.3, by - r * 0.3, 0, bx, by, r);
      gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(0.6, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(bx, by, r, 0, 6.283); g.fill();
    }
    [0.2, 0.52, 0.8].forEach(function (cx) {
      var w = 26 + Math.random() * 30; g.save(); g.translate(W * cx, H * 0.5); g.rotate(-0.6);
      var lg = g.createLinearGradient(-w, 0, w, 0); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,.2)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg; g.fillRect(-w, -H, 2 * w, 2 * H); g.restore();
    });
    return cv.toDataURL('image/png');
  }

  // ---------- Voronoi facets: the same cells are the cracks you see and the pieces that fall ----------
  function clipHalf(poly, mx, my, nx, ny) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], fa = (a[0] - mx) * nx + (a[1] - my) * ny, fb = (b[0] - mx) * nx + (b[1] - my) * ny;
      if (fa <= 0) out.push(a);
      if ((fa <= 0) !== (fb <= 0)) { var t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  function centroid(poly) { var cx = 0, cy = 0; poly.forEach(function (p) { cx += p[0]; cy += p[1]; }); return { cx: cx / poly.length, cy: cy / poly.length }; }
  function buildCells() {
    var cols = 9, rows = 6, seeds = [], out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) seeds.push([(c + 0.5 + (Math.random() - 0.5) * 0.7) * 100 / cols, (r + 0.5 + (Math.random() - 0.5) * 0.7) * 100 / rows, c, r]);
    seeds.forEach(function (s0) {
      var poly = [[0, 0], [100, 0], [100, 100], [0, 100]];
      seeds.forEach(function (q) {
        if (q === s0 || Math.abs(q[2] - s0[2]) > 2 || Math.abs(q[3] - s0[3]) > 2) return;
        poly = clipHalf(poly, (s0[0] + q[0]) / 2, (s0[1] + q[1]) / 2, q[0] - s0[0], q[1] - s0[1]);
      });
      if (poly.length > 2) { var c0 = centroid(poly); out.push({ poly: poly, cx: c0.cx, cy: c0.cy }); }
    });
    return out;
  }
  function makeIce() {
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'cracks'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
    function el(name, attrs) { var e = document.createElementNS(ns, name); for (var k in attrs) e.setAttribute(k, attrs[k]); svg.appendChild(e); return e; }
    var edges = '', impact = '';
    cells.forEach(function (c) {
      var pts = c.poly.map(function (pt) { return pt[0].toFixed(2) + ',' + pt[1].toFixed(2); }).join(' ');
      el('polygon', { points: pts, fill: Math.random() < 0.5 ? 'rgba(255,255,255,' + (Math.random() * 0.16).toFixed(3) + ')' : 'rgba(70,150,215,' + (Math.random() * 0.12).toFixed(3) + ')' });
      edges += 'M' + pts.replace(/ /g, 'L') + 'Z';
    });
    function branch(x, y, a, len, w) {
      var pts = 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
      for (var i = 0; i < len; i++) {
        a += (Math.random() - 0.5) * 0.7; x += Math.cos(a) * 5; y += Math.sin(a) * 5; pts += 'L' + x.toFixed(1) + ' ' + y.toFixed(1);
        if (w > 0 && Math.random() < 0.18) impact += branch(x, y, a + (Math.random() < 0.5 ? 1 : -1) * 0.9, 3 + Math.floor(Math.random() * 3), w - 1);
      }
      return pts;
    }
    for (var k = 0; k < 12; k++) impact += branch(50, 50, k / 12 * Math.PI * 2 + Math.random() * 0.3, 8 + Math.floor(Math.random() * 6), 2);
    var base = { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' };
    function stroke(d, color, w) { var a = { d: d, stroke: color, 'stroke-width': w }; for (var k2 in base) a[k2] = base[k2]; el('path', a); }
    stroke(edges, 'rgba(40,110,170,.30)', 2.6); stroke(edges, 'rgba(255,255,255,.7)', 0.9);
    stroke(impact, 'rgba(30,100,160,.38)', 3.4); stroke(impact, 'rgba(255,255,255,.95)', 1.4);
    return svg;
  }

  function init(lockEl) {
    cells = buildCells();
    try { lockEl.style.setProperty('--frost', 'url(' + makeFrost() + ')'); } catch (e) {}
    lockEl.insertBefore(makeIce(), lockEl.firstChild);
  }

  // ---------- shatter ----------
  // Pieces near the impact are cut into smaller fragments, like real ice: fine near the hit, big plates far away.
  function splitPiece(p) {
    var a = Math.random() * Math.PI, nx = Math.cos(a), ny = Math.sin(a), out = [];
    [[nx, ny], [-nx, -ny]].forEach(function (n) {
      var poly = clipHalf(p.poly, p.cx, p.cy, n[0], n[1]);
      if (poly.length > 2) { var c = centroid(poly); out.push({ poly: poly, cx: c.cx, cy: c.cy }); }
    });
    return out.length ? out : [p];
  }
  function splitAll(list) { var out = []; list.forEach(function (p) { splitPiece(p).forEach(function (q) { out.push(q); }); }); return out; }
  function reduced() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }

  function shatter(lockEl) {
    var calm = reduced();
    lockEl.classList.add('cracking');                      // card fades, cracks glow, the sheet shudders
    setTimeout(function () { release(lockEl, calm); }, calm ? 200 : 300);
  }

  function release(lockEl, calm) {
    lockEl.hidden = true; lockEl.classList.remove('cracking', 'freezing');
    var water = window.WN && WN.water;
    if (water) {                                           // the pool feels the impact and the pieces hitting it
      water.disturb(water.GW / 2, water.GH / 2, 7, 520);
      [140, 300, 460].forEach(function (d) { setTimeout(function () { water.disturb(water.GW * (0.3 + Math.random() * 0.4), water.GH * (0.3 + Math.random() * 0.4), 4.5, 300); }, d); });
    }
    if (calm) return;
    var W = window.innerWidth, H = window.innerHeight, box = document.createElement('div'); box.className = 'shards';

    var ring = document.createElement('div'); ring.className = 'shock'; box.appendChild(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0.95 }, { transform: 'translate(-50%,-50%) scale(90)', opacity: 0 }],
      { duration: 650, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' });

    var pieces = [];
    cells.forEach(function (c) {
      var d = Math.hypot((c.cx - 50) / 100 * W, (c.cy - 50) / 100 * H), list = [c];
      if (d < W * 0.25) list = splitAll(list);
      if (d < W * 0.12) list = splitAll(list);
      list.forEach(function (p) { pieces.push(p); });
    });
    var shadows = pieces.length <= 100;

    pieces.forEach(function (c) {
      var minx = 100, miny = 100, maxx = 0, maxy = 0;
      c.poly.forEach(function (pt) { minx = Math.min(minx, pt[0]); maxx = Math.max(maxx, pt[0]); miny = Math.min(miny, pt[1]); maxy = Math.max(maxy, pt[1]); });
      var sx = (maxx - minx) || 1, sy = (maxy - miny) || 1, bx = minx / 100 * W, by = miny / 100 * H;
      var wrap = document.createElement('i'), inner = document.createElement('b');
      wrap.style.left = bx + 'px'; wrap.style.top = by + 'px'; wrap.style.width = Math.max(2, sx / 100 * W) + 'px'; wrap.style.height = Math.max(2, sy / 100 * H) + 'px';
      wrap.style.transformOrigin = ((c.cx - minx) / sx * 100).toFixed(1) + '% ' + ((c.cy - miny) / sy * 100).toFixed(1) + '%';
      if (!shadows) wrap.style.filter = 'none';
      inner.style.backgroundSize = W + 'px ' + H + 'px'; inner.style.backgroundPosition = (-bx) + 'px ' + (-by) + 'px';
      inner.style.clipPath = 'polygon(' + c.poly.map(function (pt) { return ((pt[0] - minx) / sx * 100).toFixed(2) + '% ' + ((pt[1] - miny) / sy * 100).toFixed(2) + '%'; }).join(',') + ')';
      inner.style.filter = 'brightness(' + (0.93 + Math.random() * 0.14).toFixed(2) + ')';
      wrap.appendChild(inner); box.appendChild(wrap);

      // projectile motion: a kick that fades with distance from the impact, then gravity; tumbling in 3D
      var dxp = (c.cx - 50) / 100 * W, dyp = (c.cy - 50) / 100 * H, dist = Math.hypot(dxp, dyp);
      var ang = Math.atan2(dyp, dxp) + (Math.random() - 0.5) * 0.5, imp = 1 / (1 + dist / 260);
      var speed = 90 + 760 * imp * (0.6 + Math.random() * 0.8), vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed * 0.55 - (160 * imp + 40 * Math.random());
      var g = 2100 + Math.random() * 500, air = 1.0 + Math.random() * 0.55;
      var wx = (Math.random() - 0.5) * 360, wy = (Math.random() - 0.5) * 360, wz = (Math.random() - 0.5) * 520 * (0.5 + imp), frames = [];
      for (var k = 0; k <= 14; k++) {
        var f = k / 14, t = air * f;
        frames.push({
          transform: 'perspective(900px) translate3d(' + (vx * t).toFixed(1) + 'px,' + (vy * t + 0.5 * g * t * t).toFixed(1) + 'px,0) rotateX(' + (wx * t).toFixed(1) + 'deg) rotateY(' + (wy * t).toFixed(1) + 'deg) rotateZ(' + (wz * t).toFixed(1) + 'deg) scale(' + (1 + 0.1 * f).toFixed(3) + ')',
          opacity: f < 0.6 ? 1 : Math.max(0, 1 - (f - 0.6) / 0.4)
        });
      }
      wrap.animate(frames, { duration: air * 1000, delay: dist * 0.45 + Math.random() * 50, easing: 'linear', fill: 'forwards' });
    });

    for (var n = 0; n < 70; n++) {                         // fine ice dust thrown out of the impact
      var p = document.createElement('i'), r = 1.5 + Math.random() * 3.5, a2 = Math.random() * 6.283, sp = 80 + Math.random() * 420;
      p.className = 'dust'; p.style.left = (W / 2 + (Math.random() - 0.5) * 140) + 'px'; p.style.top = (H / 2 + (Math.random() - 0.5) * 100) + 'px'; p.style.width = p.style.height = (r * 2) + 'px';
      p.animate([{ transform: 'translate(0,0)', opacity: 0.95 },
        { transform: 'translate(' + (Math.cos(a2) * sp * 0.6).toFixed(0) + 'px,' + (Math.sin(a2) * sp * 0.6).toFixed(0) + 'px)', opacity: 0.8, offset: 0.4 },
        { transform: 'translate(' + (Math.cos(a2) * sp).toFixed(0) + 'px,' + (Math.sin(a2) * sp + 160).toFixed(0) + 'px)', opacity: 0 }],
        { duration: 600 + Math.random() * 700, delay: Math.random() * 240, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
      box.appendChild(p);
    }
    document.body.appendChild(box); setTimeout(function () { box.remove(); }, 3000);
  }

  WN.ice = { init: init, shatter: shatter };
})();
