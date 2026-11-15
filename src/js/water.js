/* Water: height-field wave simulation rendered to a canvas (ripples, refraction, caustics).
   Exposes WN.water = { disturb(x, y, radius, amount), sample(x, y), onStep(fn), canvas, GW, GH, CELL, frozen }. */
(function () {
  var cvs = document.getElementById('c'), ctx = cvs.getContext('2d');
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  var CELL, GW, GH, CW, CH, cur, prev, bg, cau, img, dpr, forced = 0;
  var drops = [], foam = [], T = 0, DAMP = 0.9925, frozen = false;
  var NW = 4, ANG = [0.4, 2.1, -0.9, 3.5], LAM = [90, 55, 140, 38], SPD = [1.6, 2.3, 1.1, 3.0], AMP = [0.8, 0.6, 1.0, 0.35];
  var KX = [], KY = [], UX = [], UY = [], cA, sA, rcB = [], rsB = [], colIn;
  var DEP = 3.5;
  // light: sun direction and half vector (view straight down)
  var LX = -0.35, LY = -0.45, LZ = 0.82, ll = Math.sqrt(LX*LX + LY*LY + LZ*LZ);
  LX /= ll; LY /= ll; LZ /= ll;
  var HX = LX, HY = LY, HZ = LZ + 1, hl = Math.sqrt(HX*HX + HY*HY + HZ*HZ);
  HX /= hl; HY /= hl; HZ /= hl;

  function hash(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(window.innerWidth || 0, 320), h = Math.max(window.innerHeight || 0, 240);
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    CELL = forced || Math.max(3, Math.ceil(Math.sqrt(w * h / 170000)));
    GW = Math.ceil(w / CELL); GH = Math.ceil(h / CELL);
    CW = (GW >> 1) + 1; CH = (GH >> 1) + 1;
    cur = new Float32Array(GW * GH); prev = new Float32Array(GW * GH);
    cau = new Float32Array(CW * CH); colIn = new Float32Array(CW);
    buf.width = GW; buf.height = GH;
    img = bctx.createImageData(GW, GH);
    cA = new Float32Array(NW * GW); sA = new Float32Array(NW * GW);
    for (var k = 0; k < NW; k++) {
      var kk = 2 * Math.PI * CELL / LAM[k];
      UX[k] = Math.cos(ANG[k]) * AMP[k]; UY[k] = Math.sin(ANG[k]) * AMP[k];
      KX[k] = kk * Math.cos(ANG[k]); KY[k] = kk * Math.sin(ANG[k]);
      for (var x = 0; x < GW; x++) { cA[k*GW + x] = Math.cos(KX[k] * x); sA[k*GW + x] = Math.sin(KX[k] * x); }
    }
    buildFloor();
  }

  function blurFloor() {
    var w = GW, h = GH, tmp = new Uint8ClampedArray(bg.length), x, y, c;
    for (var pass = 0; pass < 2; pass++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
        for (c = 0; c < 3; c++) tmp[(y * w + x) * 3 + c] = (bg[(y * w + xm) * 3 + c] + bg[(y * w + x) * 3 + c] + bg[(y * w + xp) * 3 + c]) / 3;
      }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
        for (c = 0; c < 3; c++) bg[(y * w + x) * 3 + c] = (tmp[(ym * w + x) * 3 + c] + tmp[(y * w + x) * 3 + c] + tmp[(yp * w + x) * 3 + c]) / 3;
      }
    }
  }
  function buildFloor() { buildFloor0(); blurFloor(); }
  function buildFloor0() {
    bg = new Uint8ClampedArray(GW * GH * 3);
    var Tl = Math.max(8, Math.round(70 / CELL));
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++) {
      var tx = Math.floor(x / Tl), ty = Math.floor(y / Tl), gx = x % Tl, gy = y % Tl;
      var n = hash(tx, ty), n2 = hash(x >> 1, y >> 1);
      var depth = 1 - 0.28 * (y / GH) - 0.18 * Math.abs(x / GW - 0.5);
      var r, g, b;
      if (gx < 1 || gy < 1) { r = 110; g = 165; b = 180; }
      else {
        var e = Math.min(gx, gy, Tl - gx, Tl - gy), bev = e < 3 ? 0.9 + e * 0.035 : 1;
        var gr = 0.97 + n2 * 0.06;
        r = (40 + n * 16) * bev * gr; g = (160 + n * 20) * bev * gr; b = (180 + n * 14) * bev * gr;
      }
      if (Math.abs(x - GW * 0.25) < 2.5 || Math.abs(x - GW * 0.75) < 2.5 || Math.abs(y - GH * 0.5) < 2.5) { r = 25; g = 70; b = 120; }
      var i = (y * GW + x) * 3;
      bg[i] = r * depth; bg[i+1] = g * depth; bg[i+2] = b * depth;
    }
  }

  function disturb(cx, cy, rad, amt) {
    var x0 = Math.max(1, Math.floor(cx - rad)), x1 = Math.min(GW - 2, Math.ceil(cx + rad));
    var y0 = Math.max(1, Math.floor(cy - rad)), y1 = Math.min(GH - 2, Math.ceil(cy + rad));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d < rad) cur[y * GW + x] -= amt * 0.5 * (1 + Math.cos(Math.PI * d / rad));
    }
  }

  function step() {
    var w = GW;
    for (var y = 1; y < GH - 1; y++) {
      var i = y * w + 1;
      for (var x = 1; x < w - 1; x++, i++)
        prev[i] = ((cur[i-1] + cur[i+1] + cur[i-w] + cur[i+w]) * 0.5 - prev[i]) * DAMP;
    }
    var t = cur; cur = prev; prev = t;
  }

  function caustics() {
    for (var cx = 0; cx < CW; cx++) colIn[cx] = Math.sin(cx * 2 * 0.06 - T * 0.5) * 1.7;
    for (var cy = 0; cy < CH; cy++) {
      var y = cy * 2, rin = Math.sin(y * 0.07 + T * 0.6) * 1.7, a2 = y * 0.1 - T * 0.7;
      for (var cx2 = 0; cx2 < CW; cx2++) {
        var x = cx2 * 2;
        var l1 = 1 - Math.abs(Math.sin(x * 0.09 + T * 0.9 + rin)); l1 *= l1; l1 *= l1;
        var l2 = 1 - Math.abs(Math.sin(a2 + colIn[cx2])); l2 *= l2; l2 *= l2;
        cau[cy * CW + cx2] = (l1 + l2) * 18;
      }
    }
  }

  function fi(x, y) {
    x = x < 0 ? 0 : x > GW - 1 ? GW - 1 : x; y = y < 0 ? 0 : y > GH - 1 ? GH - 1 : y;
    return ((y | 0) * GW + (x | 0)) * 3;
  }

  function render() {
    var d = img.data, w = GW, h = GH;
    caustics();
    for (var y = 0; y < h; y++) {
      for (var k = 0; k < NW; k++) { var B = KY[k] * y + SPD[k] * T; rcB[k] = Math.cos(B); rsB[k] = Math.sin(B); }
      for (var x = 0; x < w; x++) {
        var i = y * w + x, dx = 0, dy = 0, lap = 0;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          dx = cur[i+1] - cur[i-1]; dy = cur[i+w] - cur[i-w];
          lap = cur[i-1] + cur[i+1] + cur[i-w] + cur[i+w] - 4 * cur[i];
        }
        for (k = 0; k < NW; k++) {
          var c = cA[k*w + x] * rcB[k] - sA[k*w + x] * rsB[k];
          dx += UX[k] * c; dy += UY[k] * c;
        }
        var sx = dx * 0.045, sy = dy * 0.045;
        var nz = 1 / Math.sqrt(sx*sx + sy*sy + 1), nx = -sx * nz, ny = -sy * nz;
        var ox = sx * DEP, oy = sy * DEP;
        ox = ox > 8 ? 8 : ox < -8 ? -8 : ox; oy = oy > 8 ? 8 : oy < -8 ? -8 : oy;
        // refracted floor, slight dispersion per channel
        var cl = cau[(y >> 1) * CW + (x >> 1)] + lap * 0.25;
        var fr = bg[fi(x + ox * 0.98, y + oy * 0.98)] + cl * 0.8;
        var fg = bg[fi(x + ox, y + oy) + 1] + cl;
        var fb = bg[fi(x + ox * 1.02, y + oy * 1.02) + 2] + cl;
        // water absorption
        fr = fr * 0.45 + 6; fg = fg * 0.55 + 30; fb = fb * 0.75 + 55;
        // fresnel and sky reflection
        var p = 1 - nz, F = 0.09 + p * (0.8 + p * 1.5); if (F > 0.5) F = 0.5;
        var u = 0.5 + (-nx * 0.6 - ny * 0.8) * 2.5; u = u < 0 ? 0 : u > 1 ? 1 : u;
        var sr = 60 + 155 * u, sg = 120 + 112 * u, sb = 190 + 52 * u;
        // sun glint
        var t = nx * HX + ny * HY + nz * HZ; t = t < 0 ? 0 : t;
        var t2 = t * t, t4 = t2 * t2, t8 = t4 * t4, t16 = t8 * t8, t32 = t16 * t16, t64 = t32 * t32, t128 = t64 * t64;
        var spec = (t128 * t128) * 150 + t32 * 3;
        // white water on sharp crests
        var fo = Math.abs(lap) > 40 ? (Math.abs(lap) - 40) * 0.4 : 0; if (fo > 30) fo = 30;
        var o = i * 4;
        d[o]   = fr * (1 - F) + sr * F + spec + fo + 3;
        d[o+1] = fg * (1 - F) + sg * F + spec + fo + 9;
        d[o+2] = fb * (1 - F) + sb * F + spec + fo + 13;
        d[o+3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buf, 0, 0, cvs.width, cvs.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawFoam(); drawDrops();
  }

  function addFoam(x, y, n, r) {
    for (var i = 0; i < n; i++)
      foam.push({ x: x + (Math.random() - .5) * 10, y: y + (Math.random() - .5) * 10,
        vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5, r: r * (0.5 + Math.random()), life: 1 });
    if (foam.length > 300) foam.splice(0, foam.length - 300);
  }

  function drawFoam() {
    for (var i = foam.length - 1; i >= 0; i--) {
      var f = foam[i]; f.x += f.vx; f.y += f.vy; f.life -= 0.012;
      if (f.life <= 0) { foam.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(240,252,255,' + (f.life * 0.45).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
    }
  }

  function splash(px, py, v, dirx, diry, big) {
    return;
    var n = big ? 18 : Math.min(5, 1 + Math.floor(v * 0.6));
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, s = Math.random() * (big ? 2.4 : 0.8) + 0.15;
      drops.push({ x: px, y: py, z: 2,
        vx: Math.cos(a) * s + dirx * 0.12 * Math.min(v, 4), vy: Math.sin(a) * s + diry * 0.12 * Math.min(v, 4),
        vz: (big ? 3.5 : 1.4) + Math.random() * (big ? 4 : 2) + Math.min(v, 5) * (big ? 0.8 : 0.25), r: big ? 1.2 + Math.random() * 2.3 : 0.9 + Math.random() * 1.3 });
    }
    if (big) addFoam(px, py, 8, 4);
    if (drops.length > 400) drops.splice(0, drops.length - 400);
  }

  function updateDrops() {
    for (var i = drops.length - 1; i >= 0; i--) {
      var p = drops[i];
      p.x += p.vx; p.y += p.vy; p.z += p.vz; p.vz -= 0.32;
      if (p.z <= 0) {
        disturb(p.x / CELL, p.y / CELL, 1.5 + p.r * 0.4, 14 + p.r * 14);
        if (p.r > 2.2) addFoam(p.x, p.y, 2, p.r);
        drops.splice(i, 1);
      }
    }
  }

  function drawDrops() {
    for (var i = 0; i < drops.length; i++) {
      var p = drops[i], y = p.y - p.z * 1.4, r = p.r * (1 + p.z * 0.01);
      ctx.fillStyle = 'rgba(0,40,70,' + Math.max(0.04, 0.22 - p.z * 0.004).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 3, p.r, p.r * 0.6, 0, 0, 6.283); ctx.fill();
      var vy = p.vy - p.vz * 1.4, sp = Math.sqrt(p.vx * p.vx + vy * vy), ang = Math.atan2(vy, p.vx);
      ctx.fillStyle = 'rgba(205,236,252,0.6)'; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.ellipse(p.x, y, r * (1 + sp * 0.3), r, ang, 0, 6.283); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(p.x - r * 0.3, y - r * 0.3, r * 0.3, 0, 6.283); ctx.fill();
    }
  }

  var last = null, lastT = 0, lastSplash = 0, active = 0, hint = document.getElementById('hint');
  window.addEventListener('pointermove', function (e) {
    if (frozen) return;
    var t = performance.now(), x = e.clientX, y = e.clientY;
    active = t; hint.classList.add('gone');
    if (last) {
      var dx = x - last.x, dy = y - last.y, dist = Math.sqrt(dx * dx + dy * dy);
      var v = dist / Math.max(1, t - lastT), steps = Math.max(1, Math.ceil(dist / (CELL * 2)));
      var rad = 2 + Math.min(v, 3) * 0.4, amt = 30 + Math.min(v, 3) * 28;
      for (var s = 1; s <= steps; s++)
        disturb((last.x + dx * s / steps) / CELL, (last.y + dy * s / steps) / CELL, rad, amt / Math.sqrt(steps) * 1.2);
      if (v > 1.6 && dist > 0 && t - lastSplash > 100) { lastSplash = t; splash(x, y, v, dx / dist, dy / dist, false); }
      
    }
    last = { x: x, y: y }; lastT = t;
  });
  window.addEventListener('pointerdown', function (e) {
    if (frozen) return;
    if (e.target.closest && e.target.closest('.app, .tog, .card')) return;
    active = performance.now(); hint.classList.add('gone');
    disturb(e.clientX / CELL, e.clientY / CELL, 5, 450);
    splash(e.clientX, e.clientY, 3, 0, 0, true);
    last = { x: e.clientX, y: e.clientY }; lastT = active;
  });
  window.addEventListener('pointerleave', function () { last = null; });
  window.addEventListener('resize', resize);
  setInterval(function () {
    if (!frozen && performance.now() - active > 2500)
      disturb(3 + Math.random() * (GW - 6), 3 + Math.random() * (GH - 6), 2.5, 70 + Math.random() * 60);
  }, 1800);

  resize();
  // surface height at a screen point (bilinear), used so floating things can ride the waves
  function sample(px, py) {
    var x = px / CELL, y = py / CELL;
    if (x < 1) x = 1; if (y < 1) y = 1; if (x > GW - 2.01) x = GW - 2.01; if (y > GH - 2.01) y = GH - 2.01;
    var xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, i = yi * GW + xi;
    return (cur[i] * (1 - fx) + cur[i + 1] * fx) * (1 - fy) + (cur[i + GW] * (1 - fx) + cur[i + GW + 1] * fx) * fy;
  }
  var stepHooks = [];
  // public API used by app.js and ice.js
  window.WN = window.WN || {};
  WN.water = { disturb: disturb, canvas: cvs, sample: sample, onStep: function (fn) { stepHooks.push(fn); } };
  Object.defineProperty(WN.water, 'GW', { get: function () { return GW; } });
  Object.defineProperty(WN.water, 'GH', { get: function () { return GH; } });
  Object.defineProperty(WN.water, 'CELL', { get: function () { return CELL; } });
  Object.defineProperty(WN.water, 'frozen', { get: function () { return frozen; }, set: function (v) { frozen = !!v; } });

  var lt = performance.now(), ema = 16, since = 0;
  (function loop(now) {
    var dt = now - lt; lt = now;
    if (dt < 100) { ema = ema * 0.95 + dt * 0.05; since++; }
    if (ema > 26 && since > 90 && CELL < 6) { forced = CELL + 1; since = 0; ema = 16; resize(); }
    T += 0.016;
    if (!frozen) { try { step(); updateDrops(); render(); } catch (e) {} for (var hi = 0; hi < stepHooks.length; hi++) { try { stepHooks[hi](); } catch (e) {} } }
    requestAnimationFrame(loop);
  })(lt);
})();
