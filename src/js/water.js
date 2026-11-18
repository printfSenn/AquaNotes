/* Water: height-field wave simulation rendered to a canvas (ripples, refraction, caustics).
   Exposes WN.water = { disturb(x, y, radius, amount), sample(x, y), shadowDir(px, py), refract(px, py, out), onStep(fn), onDraw(fn), night, rain, koi, depth, style ('pool' or 'pond'), pads, canvas, GW, GH, CELL, frozen }. */
(function () {
  var cvs = document.getElementById('c'), ctx = cvs.getContext('2d');
  var buf = document.createElement('canvas'), bctx = buf.getContext('2d');
  var CELL, GW, GH, CW, CH, cur, prev, bg, cau, img, dpr, forced = 0;
  var drops = [], foam = [], T = 0, DAMP = 0.9925, frozen = false;
  var NW = 4, ANG = [0.4, 2.1, -0.9, 3.5], LAM = [90, 55, 140, 38], SPD = [1.6, 2.3, 1.1, 3.0], AMP = [0.8, 0.6, 1.0, 0.35];
  var KX = [], KY = [], UX = [], UY = [], cA, sA, rcB = [], rsB = [], colIn;
  var DEP = 3.5;
  var nightT = 0, nightK = 0, drawHooks = [], cauGain = 15;
  var rainOn = false, rainAcc = 0, koiOn = true, depthT = 1, depthK = 1, vigK, fishL, fishS, fish = [], hasFish = false;
  var pond = false, padsOn = true, pads = [];
  var bx0 = 0, by0 = 0, bx1 = 0, by1 = 0, sxs = [], sys = [];
  var LAMPS = [[0.2, 0.26], [0.8, 0.32], [0.5, 0.8]], LAMPZ = 7, glowR = 1, lampG = [];
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
    vigK = new Float32Array(GW * GH);
    for (var vy = 0; vy < GH; vy++) for (var vx = 0; vx < GW; vx++) {
      var vnx = (vx / GW - 0.5) * 2, vny = (vy / GH - 0.5) * 2, vr = Math.sqrt(vnx * vnx + vny * vny) / 1.4142 + (vny > 0 ? vny * 0.06 : 0);
      var vk = (vr - 0.36) / 0.64; vk = vk < 0 ? 0 : vk > 1 ? 1 : vk; vigK[vy * GW + vx] = vk * vk * (3 - 2 * vk);
    }
    fishL = new Uint8ClampedArray(GW * GH * 4); fishS = new Uint8ClampedArray(GW * GH); hasFish = false; for (var fq = 0; fq < fish.length; fq++) fish[fq].bb = null;
    glowR = Math.max(GW, GH) * 0.2;
    lampG = LAMPS.map(function (l) { return [l[0] * GW, l[1] * GH]; });
  }

  function blurFloor() {
    var w = GW, h = GH, tmp = new Uint8ClampedArray(bg.length), x, y, c;
    for (var pass = 0; pass < 1; pass++) {
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
  function buildFloor() { (pond ? buildPond : buildFloor0)(); blurFloor(); }
  // koi pond floor: pebbles in dark mud with soft patches of algae
  function buildPond() {
    bg = new Uint8ClampedArray(GW * GH * 3);
    var Pb = Math.max(7, Math.round(34 / CELL)), pal = [[170,154,120],[142,138,126],[122,102,80],[98,108,82],[186,172,142],[92,88,78]];
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++) {
      var cx0 = Math.floor(x / Pb), cy0 = Math.floor(y / Pb), best = 9, bpx = 0, bpy = 0, brad = 1, bh = 0;
      for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
        var qx = cx0 + i, qy = cy0 + j, pcx = (qx + 0.2 + 0.6 * hash(qx * 7 + 3, qy * 13 + 5)) * Pb, pcy = (qy + 0.2 + 0.6 * hash(qx * 11 + 1, qy * 5 + 9)) * Pb, rad = Pb * (0.3 + 0.2 * hash(qx + 17, qy + 31));
        var ddx = x - pcx, ddy = y - pcy, dd = Math.sqrt(ddx * ddx + ddy * ddy) / rad;
        if (dd < best) { best = dd; bpx = ddx; bpy = ddy; brad = rad; bh = hash(qx + 5, qy + 77); }
      }
      var n2 = hash(x >> 1, y >> 1), r, g, b, c = pal[Math.floor(bh * pal.length) % pal.length];
      var mud = 0.8 + 0.2 * n2;
      if (best < 1) {
        var lt = 0.78 + 0.34 * (-(bpx * 0.55 + bpy * 0.65) / brad) * 0.7 + 0.1 * (1 - best), edge = best > 0.82 ? 1 - (best - 0.82) * 2.2 : 1, gr = (0.94 + 0.1 * n2) * lt * edge;
        r = c[0] * gr; g = c[1] * gr; b = c[2] * gr;
      } else {
        var f = best < 1.18 ? (best - 1) / 0.18 : 1;
        r = (c[0] * 0.3 * (1 - f) + 50 * f) * mud; g = (c[1] * 0.3 * (1 - f) + 44 * f) * mud; b = (c[2] * 0.3 * (1 - f) + 32 * f) * mud;
      }
      var al = Math.sin(x * 0.021 + y * 0.013) * Math.sin(y * 0.027 - x * 0.011) + 0.4 * Math.sin(x * 0.06 - y * 0.05);
      if (al > 0.3) { var am = Math.min(0.5, (al - 0.3) * 0.9); r = r * (1 - am) + 70 * am; g = g * (1 - am) + 112 * am; b = b * (1 - am) + 46 * am; }
      var edgeD = Math.sqrt(Math.pow(x / GW - 0.5, 2) + Math.pow(y / GH - 0.5, 2)) * 1.4, depth = 0.9 + 0.1 * Math.min(1, edgeD), o = (y * GW + x) * 3;
      bg[o] = r * depth; bg[o + 1] = g * depth; bg[o + 2] = b * depth;
    }
  }
  function buildFloor0() {
    bg = new Uint8ClampedArray(GW * GH * 3);
    // small pool mosaic tiles with thin light grout, lane lines on the floor
    var Tl = Math.max(5, Math.round(24 / CELL));
    var lane = Math.max(2, Math.round(10 / CELL));
    for (var y = 0; y < GH; y++) for (var x = 0; x < GW; x++) {
      var tx = Math.floor(x / Tl), ty = Math.floor(y / Tl), gx = x % Tl, gy = y % Tl;
      var n = hash(tx, ty), n2 = hash(x >> 1, y >> 1);
      var mott = 0.97 + 0.03 * Math.sin(x * 0.07 + y * 0.05) * Math.sin(y * 0.09 - x * 0.03);
      var depth = 1 - 0.1 * (y / GH) - 0.06 * Math.abs(x / GW - 0.5);
      var inLane = Math.abs(x - GW * 0.25) < lane || Math.abs(x - GW * 0.75) < lane || Math.abs(y - GH * 0.5) < lane;
      var r, g, b;
      if (gx < 1 || gy < 1) {
        // grout
        if (inLane) { r = 120; g = 170; b = 215; } else { r = 205; g = 232; b = 245; }
      } else {
        var e = Math.min(gx, gy, Tl - gx, Tl - gy), bev = e < 2 ? 0.95 + e * 0.025 : 1;
        var gr = (0.985 + n2 * 0.03) * mott * bev;
        var tv = (n - 0.5) * 14;
        if (inLane) { r = 25 + tv * 0.4; g = 85 + tv * 0.8; b = 165 + tv * 0.8; }
        else { r = 175 + tv; g = 222 + tv * 0.5; b = 244 + tv * 0.3; }
        r *= gr; g *= gr; b *= gr;
      }
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
    cauGain = (pond ? 9 : 15) + nightK * 9;
    for (var cx = 0; cx < CW; cx++) colIn[cx] = Math.sin(cx * 2 * 0.06 - T * 0.5) * 1.7;
    for (var cy = 0; cy < CH; cy++) {
      var y = cy * 2, rin = Math.sin(y * 0.07 + T * 0.6) * 1.7, a2 = y * 0.1 - T * 0.7;
      for (var cx2 = 0; cx2 < CW; cx2++) {
        var x = cx2 * 2;
        var l1 = 1 - Math.abs(Math.sin(x * 0.09 + T * 0.9 + rin)); l1 *= l1; l1 *= l1;
        var l2 = 1 - Math.abs(Math.sin(a2 + colIn[cx2])); l2 *= l2; l2 *= l2;
        cau[cy * CW + cx2] = (l1 + l2) * cauGain;
      }
    }
  }

  function fi(x, y) {
    x = x < 0 ? 0 : x > GW - 1 ? GW - 1 : x; y = y < 0 ? 0 : y > GH - 1 ? GH - 1 : y;
    return ((y | 0) * GW + (x | 0)) * 3;
  }

  function render() {
    var d = img.data, w = GW, h = GH, nk = nightK;
    var AB = pond ? [0.32, 6, 0.5, 26, 0.42, 20] : [0.14, 2, 0.5, 8, 0.9, 25], cf = 1 - 0.68 * nk;
    var SD = pond ? [34, 88, 74, 100, 70, 66] : [55, 110, 120, 105, 210, 45], SN = pond ? [6, 22, 16, 34, 22, 38] : [14, 62, 30, 84, 74, 100];
    var LC = pond ? [115, 85, 30] : [40, 95, 120], LS = pond ? [1.1, 0.9, 0.55] : [0.8, 1, 1.05], FB = pond ? 0.09 : 0.05, FM = pond ? 0.5 : 0.4;
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
        var glow = 0, lspec = 0, li, lp;
        if (nk > 0.003) {
          for (li = 0; li < lampG.length; li++) {
            lp = lampG[li];
            var ldx = lp[0] - x, ldy = lp[1] - y, dd = ldx*ldx + ldy*ldy, g = 1 / (1 + dd / (glowR * glowR * 0.35));
            glow += g * g;
            var il = 1 / Math.sqrt(dd + LAMPZ * LAMPZ), hx2 = ldx * il, hy2 = ldy * il, hz2 = LAMPZ * il + 1, ih = 1 / Math.sqrt(hx2*hx2 + hy2*hy2 + hz2*hz2);
            var lt = (nx * hx2 + ny * hy2 + nz * hz2) * ih; lt = lt < 0 ? 0 : lt;
            var l2 = lt * lt, l4 = l2 * l2, l8 = l4 * l4, l16 = l8 * l8, l32 = l16 * l16, l64 = l32 * l32;
            lspec += l64 * l64 * 90 * g + l32 * 2.2 * g;
          }
          if (glow > 1.4) glow = 1.4;
        }
        // refracted floor, slight dispersion per channel
        var fa = 0, fk = 0, ssh = 0;
        if (hasFish) {
          var fcx = x + ox, fcy = y + oy; fcx = fcx < 0 ? 0 : fcx > GW - 1 ? GW - 1 : fcx; fcy = fcy < 0 ? 0 : fcy > GH - 1 ? GH - 1 : fcy;
          var fidx = (fcy | 0) * GW + (fcx | 0); fk = fidx * 4; fa = fishL[fk + 3]; ssh = fishS[fidx];
        }
        var cl = (cau[(y >> 1) * CW + (x >> 1)] + lap * 0.25) * (1 + nk * glow * 0.9);
        var fr = bg[fi(x + ox * 0.98, y + oy * 0.98)] + cl * 0.8;
        var fg = bg[fi(x + ox, y + oy) + 1] + cl;
        var fb = bg[fi(x + ox * 1.02, y + oy * 1.02) + 2] + cl;
        if (ssh) { var shk = 1 - 0.5 * ssh / 255; fr *= shk; fg *= shk; fb *= shk; }
        // water absorption (clear by day, deeper at night; pool lamps light the tiles)
        var lit = nk * glow;
        fr = fr * (AB[0] * cf + lit * 0.5) + AB[1] * cf + lit * LC[0];
        fg = fg * (AB[2] * cf + lit * 0.6) + AB[3] * cf + lit * LC[1];
        fb = fb * (AB[4] * cf + lit * 0.62) + AB[5] * cf + lit * LC[2];
        if (fa) {
          var fal = fa / 255, fln = 1 - 0.55 * nk + lit * 0.8; fln = fln < 0.15 ? 0.15 : fln;
          fr = fr * (1 - fal) + (fishL[fk] * 0.84 * fln) * fal;
          fg = fg * (1 - fal) + (fishL[fk + 1] * 0.84 * fln + 6 * fln) * fal;
          fb = fb * (1 - fal) + (fishL[fk + 2] * 0.84 * fln + 14 * fln) * fal;
        }
        // fresnel and sky reflection
        var p = 1 - nz, F = FB + p * (0.8 + p * 1.5); if (F > FM) F = FM;
        var u = 0.5 + (-nx * 0.6 - ny * 0.8) * 2.5; u = u < 0 ? 0 : u > 1 ? 1 : u;
        var sr = (SD[0] + SD[1] * u) * (1 - nk) + (SN[0] + SN[1] * u) * nk, sg = (SD[2] + SD[3] * u) * (1 - nk) + (SN[2] + SN[3] * u) * nk, sb = (SD[4] + SD[5] * u) * (1 - nk) + (SN[4] + SN[5] * u) * nk;
        // sun glint by day, pool lamp glints by night
        var t = nx * HX + ny * HY + nz * HZ; t = t < 0 ? 0 : t;
        var t2 = t * t, t4 = t2 * t2, t8 = t4 * t4, t16 = t8 * t8, t32 = t16 * t16, t64 = t32 * t32, t128 = t64 * t64;
        var spec = ((t128 * t128) * 150 + t32 * 3) * (1 - nk);
        var sr2 = spec + lspec * LS[0] * nk, sg2 = spec + lspec * LS[1] * nk, sb2 = spec + lspec * LS[2] * nk;
        // white water on sharp crests
        var fo = Math.abs(lap) > 40 ? (Math.abs(lap) - 40) * 0.4 : 0; if (fo > 30) fo = 30; fo *= 1 - 0.45 * nk;
        var o = i * 4;
        var dv = vigK[i] * depthK;
        d[o]   = (fr * (1 - F) + sr * F + sr2 + fo + 0) * (1 - 0.6 * dv);
        d[o+1] = (fg * (1 - F) + sg * F + sg2 + fo + 4) * (1 - 0.48 * dv);
        d[o+2] = (fb * (1 - F) + sb * F + sb2 + fo + 8) * (1 - 0.36 * dv);
        d[o+3] = 255;
      }
    }
    bctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buf, 0, 0, cvs.width, cvs.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPads(ctx);
    for (var dh = 0; dh < drawHooks.length; dh++) { try { drawHooks[dh](ctx); } catch (e) {} }
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

  var downAt = null, last = null, lastT = 0, lastSplash = 0, active = 0, hint = document.getElementById('hint');
  window.addEventListener('pointermove', function (e) {
    if (frozen) return;
    var t = performance.now(), x = e.clientX, y = e.clientY;
    active = t; hint.classList.add('gone');
    var onCard = !e.buttons && e.target && e.target.closest && e.target.closest('.card');
    if (last && !onCard) {
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
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
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
  // ---- lily pads: float on the surface, ride the waves, and get pushed around by ripples ----
  var PADS = [[0.18,0.28,46,1],[0.25,0.34,34,0],[0.14,0.38,28,0],[0.22,0.22,24,0],[0.72,0.64,52,1],[0.80,0.58,36,0],[0.66,0.70,32,0],[0.78,0.72,26,0],[0.84,0.68,22,0],[0.52,0.16,30,0],[0.58,0.22,22,0],[0.40,0.80,34,1],[0.46,0.86,24,0]];
  function updatePads() {
    if (!pond || !padsOn) return;
    if (!pads.length) pads = PADS.map(function (q, i) { return { hx: q[0], hy: q[1], r: q[2], fl: q[3], ox: 0, oy: 0, vx: 0, vy: 0, fx: 0, fy: 0, sh: 0, r0: hash(i, 7) * 6.283, rd: 0, wr: 0, na: hash(i, 3) * 6.283, ph: hash(i, 5) * 6.283, tint: hash(i, 11) }; });
    var W = GW * CELL, H = GH * CELL, sc = Math.min(W, H) / 720, dt = 0.016, e = 10, lim = 28 * sc;
    for (var i = 0; i < pads.length; i++) {
      var p = pads[i], x = p.hx * W + p.ox, y = p.hy * H + p.oy;
      var gx = (sample(x + e, y) - sample(x - e, y)) / (2 * e), gy = (sample(x, y + e) - sample(x, y - e)) / (2 * e);
      p.fx += (-gx - p.fx) * 0.05; p.fy += (-gy - p.fy) * 0.05;
      p.vx = (p.vx + (p.fx * 80 - p.ox * 1.6 + Math.sin(T * 0.35 + p.ph) * 1.4) * dt) * 0.93; p.vy = (p.vy + (p.fy * 80 - p.oy * 1.6 + Math.cos(T * 0.31 + p.ph) * 1.4) * dt) * 0.93;
      p.ox += p.vx * dt; p.oy += p.vy * dt; p.ox = p.ox > lim ? lim : p.ox < -lim ? -lim : p.ox; p.oy = p.oy > lim ? lim : p.oy < -lim ? -lim : p.oy;
      var shear = ((sample(x + e, y + e) - sample(x - e, y + e)) - (sample(x + e, y - e) - sample(x - e, y - e))) / (2 * e);
      p.sh += (shear - p.sh) * 0.05; p.wr = (p.wr + (p.sh * 60 - p.rd * 3) * dt) * 0.93; p.rd += p.wr * dt; p.rd = p.rd > 0.9 ? 0.9 : p.rd < -0.9 ? -0.9 : p.rd;
    }
  }
  function rgb(r, g, b, a) { return 'rgba(' + (r < 0 ? 0 : r > 255 ? 255 : r | 0) + ',' + (g < 0 ? 0 : g > 255 ? 255 : g | 0) + ',' + (b < 0 ? 0 : b > 255 ? 255 : b | 0) + ',' + (a == null ? 1 : a) + ')'; }
  function drawBloom(c, s, nk, ph) {
    var dm = 1 - 0.45 * nk, k, g;
    for (var ring = 0; ring < 2; ring++) {
      var n = ring ? 7 : 9, len = s * (ring ? 0.78 : 1), wd = s * (ring ? 0.2 : 0.23);
      for (k = 0; k < n; k++) {
        c.save(); c.rotate(k * 6.283 / n + ring * 0.35 + ph * 0.2);
        g = c.createLinearGradient(0, 0, len, 0); g.addColorStop(0, rgb(255 * dm, 248 * dm, 240 * dm)); g.addColorStop(1, rgb((ring ? 244 : 238) * dm, (ring ? 160 : 150) * dm, (ring ? 192 : 184) * dm));
        c.fillStyle = g; c.strokeStyle = rgb(214 * dm, 110 * dm, 150 * dm, 0.5); c.lineWidth = 0.7;
        c.beginPath(); c.ellipse(len * 0.5, 0, len * 0.5, wd, 0, 0, 6.283); c.fill(); c.stroke(); c.restore();
      }
    }
    c.fillStyle = rgb(244 * dm, 196 * dm, 70 * dm); c.beginPath(); c.arc(0, 0, s * 0.15, 0, 6.283); c.fill();
    c.fillStyle = rgb(226 * dm, 140 * dm, 40 * dm); for (k = 0; k < 6; k++) { c.beginPath(); c.arc(Math.cos(k * 1.047) * s * 0.07, Math.sin(k * 1.047) * s * 0.07, s * 0.03, 0, 6.283); c.fill(); }
  }
  function drawPads(c) {
    if (!pond || !padsOn || !pads.length) return;
    var W = GW * CELL, H = GH * CELL, sc = Math.min(W, H) / 720, nk = nightK, dm = 1 - 0.58 * nk, FAR = 4000, dp = cvs.width / Math.max(1, window.innerWidth);
    var sa = Math.sqrt(LX * LX + LY * LY) || 1, sdx = -LX / sa, sdy = -LY / sa, i, k;
    for (i = 0; i < pads.length; i++) {
      var p = pads[i], x = p.hx * W + p.ox, y = p.hy * H + p.oy, ang = p.r0 + p.rd + Math.sin(T * 0.25 + p.ph) * 0.03, r = p.r * sc * (1 + sample(x, y) * 0.0015);
      c.save(); c.translate(x - FAR, y); c.rotate(ang); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, p.na + 0.22, p.na + 6.061); c.closePath();
      c.fillStyle = '#000'; c.shadowColor = 'rgba(0,20,12,' + (0.4 * (1 - 0.3 * nk)).toFixed(2) + ')'; c.shadowBlur = 7 * dp; c.shadowOffsetX = (FAR + sdx * 7) * dp; c.shadowOffsetY = sdy * 7 * dp; c.fill(); c.restore();
      c.save(); c.translate(x, y); c.rotate(ang); c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, p.na + 0.22, p.na + 6.061); c.closePath();
      var g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.05, 0, 0, r), t = p.tint;
      g.addColorStop(0, rgb((88 + 34 * t) * dm, (158 + 22 * t) * dm, 72 * dm + nk * 6)); g.addColorStop(0.7, rgb((54 + 12 * t) * dm, 124 * dm, 60 * dm + nk * 6)); g.addColorStop(1, rgb(34 * dm, 90 * dm, 46 * dm + nk * 8));
      c.fillStyle = g; c.fill(); c.lineWidth = 1.2; c.strokeStyle = rgb(22 * dm, 64 * dm, 34 * dm, 0.9); c.stroke();
      c.strokeStyle = rgb(26 * dm, 84 * dm, 42 * dm, 0.4); c.lineWidth = 0.8; c.beginPath();
      for (k = 0; k < 9; k++) { var va = p.na + 0.5 + k * 5.28 / 8; c.moveTo(Math.cos(va) * r * 0.08, Math.sin(va) * r * 0.08); c.lineTo(Math.cos(va) * r * 0.93, Math.sin(va) * r * 0.93); }
      c.stroke();
      c.fillStyle = 'rgba(255,255,220,' + (0.16 * (1 - 0.6 * nk)).toFixed(3) + ')'; c.beginPath(); c.ellipse(-r * 0.32, -r * 0.38, r * 0.34, r * 0.16, -0.6, 0, 6.283); c.fill();
      if (p.fl) { c.translate(r * 0.1, -r * 0.02); drawBloom(c, r * 0.62, nk, p.ph); }
      c.restore();
    }
  }
  function updateRain() {
    if (!rainOn) { rainAcc = 0; return; }
    rainAcc += 0.3 * (GW * GH / 60000);
    if (rainAcc > 6) rainAcc = 6;
    while (rainAcc >= 1) {
      rainAcc -= 1;
      var big = Math.random() < 0.08;
      disturb(2 + Math.random() * (GW - 4), 2 + Math.random() * (GH - 4), (big ? 2.4 : 1.2) + Math.random() * 1.1, (big ? 60 : 14) + Math.random() * 28);
    }
  }

  // ---- koi: drawn into small layers that render() samples through the same refraction as the floor ----
  var KC = { orange: [238, 108, 34], red: [214, 70, 30], white: [246, 242, 232], black: [44, 44, 52], gold: [238, 192, 64] };
  function koiColor(f, t) {
    if (f.kind === 1) return KC.orange;
    if (f.kind === 3) return KC.gold;
    var v = Math.sin(t * 7.2 + f.seed) + 0.8 * Math.sin(t * 13 + f.seed * 2.3);
    if (t < 0.12 && f.kind === 0) return KC.red;
    if (v > 0.25) return f.kind === 2 && Math.sin(t * 23 + f.seed * 5) > 0.5 ? KC.black : (f.kind === 0 ? KC.orange : KC.red);
    return KC.white;
  }
  function stamp(cx, cy, rad, c, al, sh) {
    var x0 = Math.max(0, Math.floor(cx - rad - 1)), x1 = Math.min(GW - 1, Math.ceil(cx + rad + 1)), y0 = Math.max(0, Math.floor(cy - rad - 1)), y1 = Math.min(GH - 1, Math.ceil(cy + rad + 1));
    if (x0 < bx0) bx0 = x0; if (x1 > bx1) bx1 = x1; if (y0 < by0) by0 = y0; if (y1 > by1) by1 = y1;
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var ex = x + 0.5 - cx, ey = y + 0.5 - cy, cv = (rad + 1 - Math.sqrt(ex * ex + ey * ey)) / 1.6; if (cv <= 0) continue; if (cv > 1) cv = 1;
      var a = cv * al, k = y * GW + x;
      if (sh) { var v = a * 255; if (v > fishS[k]) fishS[k] = v; continue; }
      var j = k * 4, ea = fishL[j + 3] / 255, oa = a + ea * (1 - a); if (oa <= 0) continue;
      fishL[j] = (c[0] * a + fishL[j] * ea * (1 - a)) / oa; fishL[j + 1] = (c[1] * a + fishL[j + 1] * ea * (1 - a)) / oa; fishL[j + 2] = (c[2] * a + fishL[j + 2] * ea * (1 - a)) / oa; fishL[j + 3] = oa * 255;
    }
  }
  function clearFish() {
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i]; if (!f.bb) continue;
      for (var y = f.bb[1]; y <= f.bb[3]; y++) { fishL.fill(0, (y * GW + f.bb[0]) * 4, (y * GW + f.bb[2] + 1) * 4); fishS.fill(0, y * GW + f.bb[0], y * GW + f.bb[2] + 1); }
      f.bb = null;
    }
  }
  function newFish(i) {
    var W = GW * CELL, H = GH * CELL;
    return { x: 100 + Math.random() * Math.max(10, W - 200), y: 100 + Math.random() * Math.max(10, H - 200), a: Math.random() * 6.283, sp: 26, ph: Math.random() * 6.283, len: 78 + Math.random() * 38,
      seed: Math.random() * 6.283, kind: [0, 2, 0, 1, 3, 0, 2][i % 7], want: 0, wt: 0, turn: 0, panic: 0, bb: null };
  }
  function updateFish() {
    clearFish();
    if (!koiOn) { hasFish = false; return; }
    var fishN = pond ? 7 : 5; while (fish.length < fishN) fish.push(newFish(fish.length));
    var W = GW * CELL, H = GH * CELL, dt = 0.016, now = performance.now(), ptr = last && now - active < 4000 ? last : null;
    var offx = -LX * 14 / CELL, offy = -LY * 14 / CELL, S = 16;
    for (var q = 0; q < fishN; q++) {
      var f = fish[q], sx = 0, sy = 0, flee = 0;
      f.wt -= dt; if (f.wt <= 0) { f.want = f.a + (Math.random() - 0.5) * 2.2; f.wt = 1.2 + Math.random() * 2.5; }
      sx = Math.cos(f.want) * 0.7; sy = Math.sin(f.want) * 0.7;
      var m = 90;
      if (f.x < m) sx += (m - f.x) / m * 2.5; else if (f.x > W - m) sx -= (f.x - (W - m)) / m * 2.5;
      if (f.y < m) sy += (m - f.y) / m * 2.5; else if (f.y > H - m) sy -= (f.y - (H - m)) / m * 2.5;
      if (ptr) { var px = f.x - ptr.x, py = f.y - ptr.y, dd = Math.sqrt(px * px + py * py) || 1; if (dd < 190) { flee = 1 - dd / 190; sx += px / dd * flee * 5; sy += py / dd * flee * 5; } }
      if (downAt && now - downAt.t < 120) { var ex = f.x - downAt.x, ey = f.y - downAt.y, ed = Math.sqrt(ex * ex + ey * ey) || 1; if (ed < 260) { f.panic = 1; f.a = Math.atan2(ey, ex) + (Math.random() - 0.5) * 0.6; } }
      f.panic *= 0.965;
      var da = Math.atan2(sy, sx) - f.a; while (da > Math.PI) da -= 6.283; while (da < -Math.PI) da += 6.283;
      var mt = (1.3 + flee * 3.5 + f.panic * 3) * dt, tr = da > mt ? mt : da < -mt ? -mt : da;
      f.a += tr; f.turn += (tr / dt - f.turn) * 0.1;
      var tsp = 24 + Math.sin(now / 1900 + f.seed * 3) * 7 + flee * 120 + f.panic * 150; f.sp += (tsp - f.sp) * 0.06;
      f.x += Math.cos(f.a) * f.sp * dt; f.y += Math.sin(f.a) * f.sp * dt;
      if (f.x < 20) f.x = 20; else if (f.x > W - 20) f.x = W - 20; if (f.y < 20) f.y = 20; else if (f.y > H - 20) f.y = H - 20;
      f.ph += dt * (4.5 + f.sp * 0.1);
      var len = f.len / CELL, hx = f.x / CELL, hy = f.y / CELL, dx = Math.cos(f.a), dy = Math.sin(f.a), nx = -dy, ny = dx;
      var bw = len * 0.15, amp = len * (0.05 + 0.1 * Math.min(1, f.sp / 90)), bend = Math.max(-0.6, Math.min(0.6, f.turn * 0.13)) * len, i, t;
      bx0 = GW; by0 = GH; bx1 = 0; by1 = 0;
      for (i = 0; i <= S + 3; i++) {
        t = i / S; var lat = Math.sin(f.ph - t * 3.4) * amp * Math.pow(t, 1.3) + bend * t * t;
        sxs[i] = hx - dx * t * len + nx * lat; sys[i] = hy - dy * t * len + ny * lat;
      }
      for (i = 0; i <= S; i++) {
        t = i / S; var u = (t - 0.28) / (t < 0.28 ? 0.36 : 0.78), r = bw * Math.max(0.14, 1 - u * u), col = koiColor(f, t);
        stamp(sxs[i] + offx, sys[i] + offy, r * 1.05, col, 0.8, true);
        stamp(sxs[i], sys[i], r, col, 1, false);
        if (i >= 4 && i <= 6) {
          var fw = r * (0.95 + 0.3 * Math.sin(f.ph * 1.3 + i)), fr2 = r * (0.8 - (i - 4) * 0.15);
          stamp(sxs[i] + nx * fw, sys[i] + ny * fw, fr2, KC.white, 0.6, false); stamp(sxs[i] - nx * fw, sys[i] - ny * fw, fr2, KC.white, 0.6, false);
          stamp(sxs[i] + nx * fw + offx, sys[i] + ny * fw + offy, fr2, KC.white, 0.4, true); stamp(sxs[i] - nx * fw + offx, sys[i] - ny * fw + offy, fr2, KC.white, 0.4, true);
        }
      }
      var tc = koiColor(f, 0.95);
      for (i = 1; i <= 3; i++) {
        var spread = i * bw * 0.42, tr2 = bw * (0.78 - i * 0.12);
        stamp(sxs[S + i] + nx * spread, sys[S + i] + ny * spread, tr2, tc, 0.6, false); stamp(sxs[S + i] - nx * spread, sys[S + i] - ny * spread, tr2, tc, 0.6, false);
        stamp(sxs[S + i] + nx * spread + offx, sys[S + i] + ny * spread + offy, tr2, tc, 0.4, true); stamp(sxs[S + i] - nx * spread + offx, sys[S + i] - ny * spread + offy, tr2, tc, 0.4, true);
      }
      f.bb = [Math.max(0, bx0), Math.max(0, by0), Math.min(GW - 1, bx1), Math.min(GH - 1, by1)];
    }
    hasFish = true;
  }
  // unit direction a floating thing's shadow falls (away from the sun, or from the nearest pool lamp at night), plus length and strength
  function shadowDir(px, py) {
    var sl = Math.sqrt(LX * LX + LY * LY) || 1, sdx = -LX / sl, sdy = -LY / sl, len = sl / LZ;
    if (nightK > 0.01 && lampG.length) {
      var gx = px / CELL, gy = py / CELL, best = 1e9, bx = 0, by = 0;
      for (var i = 0; i < lampG.length; i++) { var ax = gx - lampG[i][0], ay = gy - lampG[i][1], dd = ax * ax + ay * ay; if (dd < best) { best = dd; bx = ax; by = ay; } }
      var bl = Math.sqrt(bx * bx + by * by) || 1;
      sdx = sdx * (1 - nightK) + bx / bl * nightK; sdy = sdy * (1 - nightK) + by / bl * nightK;
      var nl = Math.sqrt(sdx * sdx + sdy * sdy) || 1; sdx /= nl; sdy /= nl;
    }
    return { x: sdx, y: sdy, len: len * (1 - 0.2 * nightK), k: 1 - 0.35 * nightK };
  }
  // how much the surface bends the view of the floor at a screen point (px), same maths as render(): ripples plus the ambient waves
  function refract(px, py, out) {
    var x = px / CELL, y = py / CELL;
    if (x < 1) x = 1; if (y < 1) y = 1; if (x > GW - 2.01) x = GW - 2.01; if (y > GH - 2.01) y = GH - 2.01;
    var i = (y | 0) * GW + (x | 0), dx = cur[i + 1] - cur[i - 1], dy = cur[i + GW] - cur[i - GW];
    for (var k = 0; k < NW; k++) { var c = Math.cos(KX[k] * x + KY[k] * y + SPD[k] * T); dx += UX[k] * c; dy += UY[k] * c; }
    var ox = dx * 0.045 * DEP, oy = dy * 0.045 * DEP;
    out[0] = (ox > 8 ? 8 : ox < -8 ? -8 : ox) * CELL; out[1] = (oy > 8 ? 8 : oy < -8 ? -8 : oy) * CELL;
  }
  // public API used by app.js and ice.js
  window.WN = window.WN || {};
  WN.water = { disturb: disturb, canvas: cvs, sample: sample, shadowDir: shadowDir, refract: refract, onStep: function (fn) { stepHooks.push(fn); }, onDraw: function (fn) { drawHooks.push(fn); } };
  Object.defineProperty(WN.water, 'fish', { get: function () { return fish.map(function (f) { return { x: f.x, y: f.y, sp: f.sp }; }); } });
  Object.defineProperty(WN.water, 'style', { get: function () { return pond ? 'pond' : 'pool'; }, set: function (v) { var np = v === 'pond'; if (np === pond) return; pond = np; if (GW) buildFloor(); } });
  Object.defineProperty(WN.water, 'pads', { get: function () { return padsOn; }, set: function (v) { padsOn = !!v; } });
  Object.defineProperty(WN.water, 'padState', { get: function () { return pads.map(function (p) { return { ox: p.ox, oy: p.oy, rd: p.rd }; }); } });
  Object.defineProperty(WN.water, 'rain', { get: function () { return rainOn; }, set: function (v) { rainOn = !!v; } });
  Object.defineProperty(WN.water, 'koi', { get: function () { return koiOn; }, set: function (v) { koiOn = !!v; } });
  Object.defineProperty(WN.water, 'depth', { get: function () { return depthT > 0.5; }, set: function (v) { depthT = v ? 1 : 0; } });
  Object.defineProperty(WN.water, 'night', { get: function () { return nightT > 0.5; }, set: function (v) { nightT = v ? 1 : 0; } });
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
    nightK += (nightT - nightK) * 0.04; if (Math.abs(nightT - nightK) < 0.004) nightK = nightT;
    depthK += (depthT - depthK) * 0.06; if (Math.abs(depthT - depthK) < 0.004) depthK = depthT;
    if (!frozen) { try { step(); updateDrops(); updateRain(); updatePads(); updateFish(); render(); } catch (e) {} for (var hi = 0; hi < stepHooks.length; hi++) { try { stepHooks[hi](); } catch (e) {} } }
    requestAnimationFrame(loop);
  })(lt);
})();