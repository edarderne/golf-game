// Canvas renderer: low-poly diorama island look with a pseudo-3D camera.
// The camera supports rotation (aim direction points up-screen), tilt
// (vertical squash for an isometric feel) and an anchor (where the focus
// point sits vertically). One sun, top-left: highlights face up-left and
// every shadow falls down-right. Objects have height drawn straight up in
// screen space and are depth-sorted, which sells the 3D.
(function () {
  'use strict';

  // Summer (default) palette.
  var SUMMER = {
    seaTop: '#87d4d2', seaBottom: '#2e91a2',
    foam: 'rgba(255,255,255,0.8)',
    sand: '#f0dfae', sandDot: 'rgba(150,120,60,0.18)', sandDotLight: 'rgba(255,250,225,0.5)',
    islandShadow: 'rgba(12,55,68,0.25)', depthRing: 'rgba(10,50,64,0.10)',
    roughHeavy: '#6f9a3c', roughHeavyDot: 'rgba(38,70,26,0.22)',
    rough: '#95be4f', roughDot: 'rgba(60,100,40,0.18)',
    fairway: '#b9d766',
    green: '#96da70', greenHi: '#bcec8e', greenLo: '#74c258', fringe: '#abe07c',
    bunker: '#f6e7bd', bunkerEdge: '#ddc28e',
    water: '#6fcbd6',
    shadow: 'rgba(35,72,45,0.24)',
    trunk: '#8a5f38', trunkHi: '#a97e4e',
    patchLight: 'rgba(255,255,225,0.04)', patchDark: 'rgba(40,80,38,0.04)',
    rockLight: '#eae5db', rockMid: '#cec8be', rockDark: '#a9a298', rockDarker: '#8e877d',
    pinPole: '#f6f6f2', flag: '#e6543f',
    ball: '#ffffff',
  };
  // Winter (cosmetic only) — snow ground, icy water, frosted rock. Play is
  // identical; fairway / first-cut / heavy stay distinct, just snow-tinted.
  var WINTER = Object.assign({}, SUMMER, {
    seaTop: '#a9d0da', seaBottom: '#6ea1af',
    foam: 'rgba(255,255,255,0.9)',
    sand: '#e9edf0', sandDot: 'rgba(120,135,145,0.14)', sandDotLight: 'rgba(255,255,255,0.65)',
    islandShadow: 'rgba(40,60,80,0.22)', depthRing: 'rgba(30,55,80,0.10)',
    roughHeavy: '#b4c3bb', roughHeavyDot: 'rgba(110,130,120,0.20)',
    rough: '#ccd7d0', roughDot: 'rgba(120,140,130,0.14)',
    fairway: '#e3e9e5',
    green: '#d0e0d6', greenHi: '#e6f0ea', greenLo: '#bcd0c4', fringe: '#dae7df',
    bunker: '#eef1f3', bunkerEdge: '#d3dbdf',
    water: '#a2cdd8',
    shadow: 'rgba(60,80,100,0.20)',
    rockLight: '#f2f4f6', rockMid: '#dfe4e8', rockDark: '#c3cbd1', rockDarker: '#a9b3ba',
  });
  // Active palette, swapped per hole by applyTheme().
  var PAL = Object.assign({}, SUMMER);
  var THEME = 'summer';
  function applyTheme(t) {
    THEME = (t === 'winter') ? 'winter' : 'summer';
    var src = THEME === 'winter' ? WINTER : SUMMER;
    for (var k in src) PAL[k] = src[k];
  }

  var PINES = [
    { light: '#b8d95f', dark: '#5f8c33' },
    { light: '#a2ce58', dark: '#4c7f38' },
    { light: '#c6dc63', dark: '#74973a' },
  ];
  var PINES_WINTER = [
    { light: '#e4eeee', dark: '#a6bcbe' },
    { light: '#d8e6e6', dark: '#9ab3b5' },
    { light: '#eef4f2', dark: '#b3c7c4' },
  ];
  var LEAFY = {
    g:  { light: '#8cc95e', dark: '#4e8a3c' },
    g2: { light: '#74b854', dark: '#3d7538' },
    o:  { light: '#e8a94e', dark: '#a05f26' },
    y:  { light: '#d3c355', dark: '#8f822e' },
  };
  var BLADES = ['#86b34a', '#a3ca5d', '#729f3f'];
  var BLADES_WINTER = ['#c8d3cd', '#d8e1db', '#bcc9c2'];
  var FLOWERS = {
    orange: '#f09a3e', yellow: '#ecd34f', pink: '#ef8ed0', cyan: '#66d3e2',
  };

  var TAU = Math.PI * 2;
  var OVER_TILT = 0.85;
  var SH = { x: 0.86, y: 0.5 }; // shadow direction (screen space, down-right)

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, scale: 4, rot: 0, tilt: OVER_TILT, anchor: 0.5 };
    this.target = { x: 0, y: 0, scale: 4, rot: 0, tilt: OVER_TILT, anchor: 0.5 };
    this.time = 0;
  }

  // ---------- colour helpers ----------

  function shade(hex, n) {
    var v = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, (v >> 16) + n));
    var g = Math.min(255, Math.max(0, ((v >> 8) & 255) + n));
    var b = Math.min(255, Math.max(0, (v & 255) + n));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function mix(a, b) {
    var va = parseInt(a.slice(1), 16), vb = parseInt(b.slice(1), 16);
    var r = ((va >> 16) + (vb >> 16)) >> 1;
    var g = (((va >> 8) & 255) + ((vb >> 8) & 255)) >> 1;
    var bl = ((va & 255) + (vb & 255)) >> 1;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  function polyCentroid(poly) {
    var cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) { cx += poly[i].x; cy += poly[i].y; }
    return { x: cx / poly.length, y: cy / poly.length };
  }

  // ---------- camera ----------

  Renderer.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.dpr = dpr;
    this.w = w; this.h = h;
  };

  Renderer.prototype.fitBounds = function (b, pad) {
    pad = pad || 0;
    if (!this.w || !this.h) this.resize();
    if (!this.w || !this.h) return;
    var insetTop = 55, insetBottom = 150;
    var availH = Math.max(120, this.h - insetTop - insetBottom);
    var bw = (b.maxX - b.minX) + pad * 2;
    var bh = (b.maxY - b.minY) + pad * 2;
    var tilt = OVER_TILT;
    var scale = Math.min(this.w / bw, availH / (bh * tilt));
    this.target = {
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2 - (this.h / 2 - insetTop - availH / 2) / (scale * tilt),
      scale: scale,
      rot: 0, tilt: tilt, anchor: 0.5,
    };
  };

  Renderer.prototype.fitShot = function (ball, rot, ahead) {
    if (!this.w || !this.h) this.resize();
    if (!this.w || !this.h) return;
    var anchor = 0.76, tilt = 0.5;
    var avail = this.h * anchor - 70;
    var scale = Math.max(1.2, Math.min(9, avail / (ahead * tilt)));
    this.target = { x: ball.x, y: ball.y, scale: scale, rot: rot, tilt: tilt, anchor: anchor };
  };

  Renderer.prototype.snapCamera = function () {
    for (var k in this.target) this.cam[k] = this.target[k];
  };

  Renderer.prototype.tickCamera = function (dt) {
    if (!isFinite(this.cam.scale) || !isFinite(this.cam.x)) this.snapCamera();
    var k = 1 - Math.pow(0.002, dt / 1000); // smooth ease (dt in ms)
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    this.cam.scale += (this.target.scale - this.cam.scale) * k;
    this.cam.tilt += (this.target.tilt - this.cam.tilt) * k;
    this.cam.anchor += (this.target.anchor - this.cam.anchor) * k;
    var dr = this.target.rot - this.cam.rot;
    while (dr > Math.PI) dr -= TAU;
    while (dr < -Math.PI) dr += TAU;
    this.cam.rot += dr * k;
  };

  Renderer.prototype.camSpace = function (p) {
    var dx = p.x - this.cam.x, dy = p.y - this.cam.y;
    var c = Math.cos(this.cam.rot), s = Math.sin(this.cam.rot);
    return { rx: dx * c - dy * s, ry: dx * s + dy * c };
  };

  Renderer.prototype.toScreen = function (p) {
    var r = this.camSpace(p);
    return {
      x: this.w / 2 + r.rx * this.cam.scale,
      y: this.h * this.cam.anchor - r.ry * this.cam.scale * this.cam.tilt,
    };
  };

  Renderer.prototype.depth = function (p) { return this.camSpace(p).ry; };

  Renderer.prototype.toWorld = function (sx, sy) {
    var rx = (sx - this.w / 2) / this.cam.scale;
    var ry = (this.h * this.cam.anchor - sy) / (this.cam.scale * this.cam.tilt);
    var c = Math.cos(this.cam.rot), s = Math.sin(this.cam.rot);
    return { x: this.cam.x + rx * c + ry * s, y: this.cam.y - rx * s + ry * c };
  };

  // ---------- path helpers ----------

  Renderer.prototype.poly = function (pts, close) {
    var ctx = this.ctx;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var s = this.toScreen(pts[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    if (close !== false) ctx.closePath();
  };

  Renderer.prototype.blobPath = function (pts, append) {
    var ctx = this.ctx;
    var n = pts.length;
    if (!append) ctx.beginPath();
    var p0 = this.toScreen(pts[0]), p1 = this.toScreen(pts[1]);
    ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    for (var i = 1; i <= n; i++) {
      var a = this.toScreen(pts[i % n]);
      var b = this.toScreen(pts[(i + 1) % n]);
      ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    ctx.closePath();
  };

  Renderer.prototype.groundEllipse = function (p, r) {
    var s = this.toScreen(p);
    this.ctx.beginPath();
    this.ctx.ellipse(s.x, s.y, r * this.cam.scale, r * this.cam.scale * this.cam.tilt, 0, 0, TAU);
  };

  // One shadow system: shaped to footprint width + height, always cast
  // down-right. (Also used by Ambient for the deer.)
  Renderer.prototype.dropShadow = function (sx, sy, w, hgt) {
    var ctx = this.ctx;
    var t = this.cam.tilt + 0.25;
    var len = hgt * 0.5 + w * 0.3;
    var cx = sx + SH.x * len * 0.45;
    var cy = sy + SH.y * len * 0.45 * t;
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, cy, len * 0.55 + w * 0.3, Math.max(2, w * 0.42 * t), 0.32, 0, TAU);
    ctx.fill();
  };

  // ---------- main draw ----------

  Renderer.prototype.draw = function (state) {
    var ctx = this.ctx;
    var hole = state.hole;
    this.resize();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.time = state.time || 0;
    applyTheme(hole && hole.theme);

    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, PAL.seaTop);
    g.addColorStop(1, PAL.seaBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawSea();
    if (window.Ambient) Ambient.drawSeaLife(this);

    if (hole) {
      this.drawGround(hole, state);
      if (window.Ambient) Ambient.drawLand(this);
      this.drawEntities(hole, state);
    }
    if (window.Ambient) Ambient.drawAir(this);

    // global sunlight: warm glow top-left, cool falloff bottom-right
    var sun = ctx.createLinearGradient(0, 0, this.w, this.h);
    sun.addColorStop(0, 'rgba(255,248,214,0.07)');
    sun.addColorStop(0.5, 'rgba(255,255,255,0)');
    sun.addColorStop(1, 'rgba(24,50,80,0.05)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  };

  // Animated sea: slow tonal bands + drifting ripple arcs.
  Renderer.prototype.drawSea = function () {
    var ctx = this.ctx;
    var t = this.time;
    for (var i = 0; i < 3; i++) {
      var y0 = this.h * (0.12 + i * 0.3) + Math.sin(t / 5000 + i * 2.1) * 18;
      var bandH = this.h * 0.1;
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(6,50,66,0.05)';
      ctx.beginPath();
      ctx.moveTo(-20, y0);
      for (var x = 0; x <= this.w + 20; x += 26) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.016 + t / (1600 + i * 400) + i * 2) * 7);
      }
      ctx.lineTo(this.w + 20, y0 + bandH);
      for (x = this.w + 20; x >= -20; x -= 26) {
        ctx.lineTo(x, y0 + bandH + Math.sin(x * 0.013 + t / (1900 + i * 300) + i) * 7);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.5;
    for (i = 0; i < 9; i++) {
      var yy = ((i * 127 + t / 60) % (this.h + 60)) - 30;
      var xx = (i * 191 + Math.sin(t / 2400 + i) * 30) % this.w;
      ctx.beginPath();
      ctx.arc(xx, yy, 8 + (i % 3) * 4, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  };

  Renderer.prototype.drawGround = function (hole, state) {
    var ctx = this.ctx;
    var sc = this.cam.scale;
    var islands = hole.islands || [{ grass: hole.grassPoly, beach: hole.beachPoly }];
    var k;

    // depth ring: water darkens right around each island
    ctx.strokeStyle = PAL.depthRing;
    for (k = 0; k < islands.length; k++) {
      ctx.lineWidth = sc * 16;
      this.blobPath(islands[k].beach);
      ctx.stroke();
      ctx.lineWidth = sc * 7;
      this.blobPath(islands[k].beach);
      ctx.stroke();
    }

    // island drop shadows (same direction as every object)
    ctx.save();
    ctx.translate(SH.x * sc * 2.4, SH.y * sc * 2.4);
    ctx.fillStyle = PAL.islandShadow;
    for (k = 0; k < islands.length; k++) {
      this.blobPath(islands[k].beach);
      ctx.fill();
    }
    ctx.restore();

    // pulsing foam
    var pulse = 0.55 + Math.sin(this.time / 900) * 0.2;
    for (k = 0; k < islands.length; k++) {
      this.blobPath(islands[k].beach);
      ctx.strokeStyle = 'rgba(255,255,255,' + pulse + ')';
      ctx.lineWidth = Math.max(2, sc * 2.2);
      ctx.stroke();
      this.blobPath(islands[k].beach);
      ctx.strokeStyle = PAL.foam;
      ctx.lineWidth = Math.max(1.5, sc * 1.2);
      ctx.stroke();
      this.blobPath(islands[k].beach);
      ctx.fillStyle = PAL.sand;
      ctx.fill();
    }

    // beach speckle
    if (hole.sandDots) {
      for (var i = 0; i < hole.sandDots.length; i++) {
        var d = hole.sandDots[i];
        var ds = this.toScreen(d);
        ctx.fillStyle = d.light ? PAL.sandDotLight : PAL.sandDot;
        ctx.beginPath();
        ctx.arc(ds.x, ds.y, d.r * sc * 0.6, 0, TAU);
        ctx.fill();
      }
    }

    // heavy rough is the island base; the fairway + first cut sit on top
    for (k = 0; k < islands.length; k++) {
      this.blobPath(islands[k].grass);
      ctx.fillStyle = PAL.roughHeavy;
      ctx.fill();
    }

    // rough texture dots
    ctx.fillStyle = PAL.roughDot;
    for (i = 0; i < hole.tufts.length; i++) {
      var tf = hole.tufts[i];
      if (tf.kind !== 'grass') continue;
      var s = this.toScreen(tf);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.2 * tf.s * (sc / 4), 0, TAU);
      ctx.fill();
    }

    // first cut + fairway, clipped to land so cross-island holes show sea gaps
    ctx.save();
    for (k = 0; k < islands.length; k++) this.blobPath(islands[k].grass, k > 0);
    ctx.clip();
    if (hole.firstCutPoly) {
      this.poly(hole.firstCutPoly);
      ctx.fillStyle = PAL.rough;
      ctx.fill();
    }
    this.poly(hole.fairwayPoly);
    ctx.fillStyle = PAL.fairway;
    ctx.fill();
    ctx.restore();

    // low-poly tone patches
    if (hole.patches) {
      for (i = 0; i < hole.patches.length; i++) {
        var pa = hole.patches[i];
        ctx.fillStyle = pa.light ? PAL.patchLight : PAL.patchDark;
        ctx.beginPath();
        for (var v = 0; v < 3; v++) {
          var a = pa.rot + (v / 3) * TAU;
          var pt = this.toScreen({ x: pa.x + Math.cos(a) * pa.r, y: pa.y + Math.sin(a) * pa.r });
          if (v === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // tee pad
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    this.groundEllipse(hole.tee, 5);
    ctx.fill();
    ctx.fillStyle = '#dcea9e';
    this.groundEllipse(hole.tee, 4);
    ctx.fill();

    // green with slope shading (polygon so ovals/rotations project correctly)
    ctx.fillStyle = PAL.fringe;
    if (hole.fringePoly) this.blobPath(hole.fringePoly); else this.groundEllipse(hole.green, hole.greenR + 2.5);
    ctx.fill();
    var gc = this.toScreen(hole.green);
    var rpx = hole.greenR * sc;
    var slope = hole.greenSlope || { x: 0, y: 1 };
    var sDown = this.toScreen({ x: hole.green.x + slope.x * 100, y: hole.green.y + slope.y * 100 });
    var gdx = sDown.x - gc.x, gdy = sDown.y - gc.y;
    var gl = Math.sqrt(gdx * gdx + gdy * gdy) || 1;
    gdx /= gl; gdy /= gl;
    var grad = ctx.createLinearGradient(gc.x - gdx * rpx, gc.y - gdy * rpx, gc.x + gdx * rpx, gc.y + gdy * rpx);
    grad.addColorStop(0, PAL.greenHi);
    grad.addColorStop(1, PAL.greenLo);
    ctx.fillStyle = grad;
    if (hole.greenPoly) this.blobPath(hole.greenPoly); else this.groundEllipse(hole.green, hole.greenR);
    ctx.fill();
    this.drawGreenSlope(hole, state);

    // bunkers with a soft lip + speckle
    for (i = 0; i < hole.bunkers.length; i++) {
      this.blobPath(hole.bunkers[i]);
      ctx.fillStyle = PAL.bunkerEdge;
      ctx.fill();
      ctx.save();
      ctx.translate(-sc * 0.5, -sc * 0.7);
      this.blobPath(hole.bunkers[i]);
      ctx.fillStyle = PAL.bunker;
      ctx.fill();
      ctx.restore();
    }
    if (hole.bunkerDots) {
      for (i = 0; i < hole.bunkerDots.length; i++) {
        var bd = hole.bunkerDots[i];
        var bds = this.toScreen(bd);
        ctx.fillStyle = bd.light ? PAL.sandDotLight : PAL.sandDot;
        ctx.beginPath();
        ctx.arc(bds.x, bds.y, bd.r * sc * 0.6, 0, TAU);
        ctx.fill();
      }
    }

    // ponds: deep centre + pulsing foam edge (ducks carry the movement)
    for (i = 0; i < hole.waters.length; i++) {
      var pond = hole.waters[i];
      this.blobPath(pond);
      ctx.fillStyle = PAL.water;
      ctx.fill();
      var pc = polyCentroid(pond);
      var pcs = this.toScreen(pc);
      var pr = 0;
      for (var vi = 0; vi < pond.length; vi++) {
        pr = Math.max(pr, Math.hypot(pond[vi].x - pc.x, pond[vi].y - pc.y));
      }
      var prPx = pr * sc;
      ctx.save();
      this.blobPath(pond);
      ctx.clip();
      var deep = ctx.createRadialGradient(pcs.x, pcs.y, prPx * 0.1, pcs.x, pcs.y, prPx);
      deep.addColorStop(0, 'rgba(16,84,104,0.35)');
      deep.addColorStop(1, 'rgba(16,84,104,0)');
      ctx.fillStyle = deep;
      ctx.fillRect(pcs.x - prPx, pcs.y - prPx, prPx * 2, prPx * 2);
      ctx.restore();
      this.blobPath(pond);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + Math.sin(this.time / 900 + i) * 0.15) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (state.aim) this.drawAim(state.aim);
  };

  // Green slope grid: a square mesh laid over the green, each node lifted by
  // the surface height so it bulges over mounds and dips into swales — you read
  // the break from how the grid warps (like a contour mesh). Colours unchanged;
  // brighter/denser while lining up a putt.
  Renderer.prototype.drawGreenSlope = function (hole, state) {
    var ctx = this.ctx;
    var sc = this.cam.scale;
    if (sc < 2.4 || !hole.greenPoly || !window.Course || !Course.greenHeight) return;
    var putting = !!(state && state.aim && state.aim.isPutt);
    var poly = hole.greenPoly;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      var q = poly[i];
      if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
      if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
    }
    var step = Math.max(2.4, hole.greenR * 0.15);
    var lift = sc * (putting ? 1.8 : 1.3);
    // Build a node grid that overshoots the green by one cell on every side, so
    // once we clip to the green the mesh fills right up to the edge.
    var x0 = minX - step, y0 = minY - step;
    var cols = Math.ceil((maxX + step - x0) / step) + 1;
    var rows = Math.ceil((maxY + step - y0) / step) + 1;
    var nodes = [];
    for (var r = 0; r < rows; r++) {
      nodes[r] = [];
      for (var c = 0; c < cols; c++) {
        var wp = { x: x0 + c * step, y: y0 + r * step };
        var s = this.toScreen(wp);
        nodes[r][c] = { x: s.x, y: s.y - Course.greenHeight(hole, wp) * lift };
      }
    }
    // Clip to the exact green outline, then draw the whole grid — the outline
    // cuts the blocks off cleanly at the edge (graph-paper-in-the-green look).
    ctx.save();
    this.blobPath(poly);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,' + (putting ? 0.5 : 0.32) + ')';
    ctx.lineWidth = Math.max(0.7, sc * 0.12);
    ctx.beginPath();
    for (r = 0; r < rows; r++) {
      for (c = 0; c < cols - 1; c++) {
        var a = nodes[r][c], b = nodes[r][c + 1];
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
    }
    for (c = 0; c < cols; c++) {
      for (r = 0; r < rows - 1; r++) {
        var a2 = nodes[r][c], b2 = nodes[r + 1][c];
        ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y);
      }
    }
    ctx.stroke();
    ctx.restore();
    // Boundary line around the green that contains the grid.
    this.blobPath(poly);
    ctx.strokeStyle = 'rgba(255,255,255,' + (putting ? 0.85 : 0.55) + ')';
    ctx.lineWidth = Math.max(1.2, sc * 0.22);
    ctx.stroke();
  };

  // ---------- depth-sorted entities ----------

  Renderer.prototype.drawEntities = function (hole, state) {
    var self = this;
    var items = [];
    var i;

    for (i = 0; i < hole.trees.length; i++) (function (t) {
      items.push({ d: self.depth(t), fn: function () { self.drawTree(t); } });
    })(hole.trees[i]);

    for (i = 0; i < hole.rocks.length; i++) (function (r) {
      items.push({ d: self.depth(r), fn: function () { self.drawRocks(r); } });
    })(hole.rocks[i]);

    for (i = 0; i < hole.statues.length; i++) (function (st) {
      items.push({ d: self.depth(st), fn: function () { self.drawStatue(st); } });
    })(hole.statues[i]);

    for (i = 0; i < hole.tufts.length; i++) (function (tf) {
      if (tf.kind === 'grass') return;
      items.push({ d: self.depth(tf), fn: function () { self.drawBush(tf); } });
    })(hole.tufts[i]);

    items.push({ d: this.depth(hole.pin), fn: function () { self.drawPin(hole.pin); } });

    if (state.balls) {
      Object.keys(state.balls).forEach(function (uid) {
        var b = state.balls[uid];
        if (!b || b.holed || (state.flying && state.flying.uid === uid)) return;
        items.push({
          d: self.depth(b),
          fn: function () { self.drawBallAt(b, state.chars && state.chars[uid], uid === state.myUid); },
        });
      });
    }

    if (state.flying) {
      var f = state.flying;
      items.push({ d: this.depth(f), fn: function () { self.drawFlying(f); } });
    }
    if (state.splash) {
      var sp = state.splash;
      items.push({ d: this.depth(sp), fn: function () { self.drawSplash(sp); } });
    }

    items.sort(function (a, b) { return b.d - a.d; }); // far first
    for (i = 0; i < items.length; i++) items[i].fn();
  };

  // ---------- trees ----------

  Renderer.prototype.drawTree = function (t) {
    if (t.kind === 'pine') return this.drawPine(t);
    // Winter: deciduous + palms go bare and snow-tipped; pines stay (frosted).
    if (THEME === 'winter') {
      var s = this.toScreen(t);
      return this.drawBare(s, t.r * this.cam.scale, t.rot || 0);
    }
    if (t.kind === 'palm') return this.drawPalm(t);
    return this.drawLeafy(t);
  };

  // Bare, snow-tipped tree used for winter deciduous/palms.
  Renderer.prototype.drawBare = function (s, r, rot) {
    var ctx = this.ctx;
    this.dropShadow(s.x, s.y, r * 1.1, r * 2);
    ctx.strokeStyle = PAL.trunk;
    ctx.lineCap = 'round';
    var h = r * 2.0;
    branch(s.x, s.y, -Math.PI / 2 + Math.sin(rot) * 0.18, h * 0.6, Math.max(1.8, r * 0.22), 3);
    function branch(x, y, ang, len, wid, depth) {
      var nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
      ctx.lineWidth = wid;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      if (depth <= 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(nx, ny, Math.max(1.5, wid * 1.1), 0, TAU); ctx.fill();
        return;
      }
      branch(nx, ny, ang - 0.5 - Math.sin(rot + depth) * 0.15, len * 0.66, wid * 0.62, depth - 1);
      branch(nx, ny, ang + 0.48 + Math.cos(rot * 2 + depth) * 0.15, len * 0.62, wid * 0.62, depth - 1);
    }
  };

  // Pine: separated tiers with per-tier shading, 3-4 facets each.
  Renderer.prototype.drawPine = function (t) {
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var sc = this.cam.scale;
    var r = t.r * sc;
    var col = (THEME === 'winter' ? PINES_WINTER : PINES)[t.pine || 0];
    var tiers = t.tiers || 3;
    var height = r * (0.6 + tiers * 0.95);

    this.dropShadow(s.x, s.y, r * 1.7, height);

    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y - r * 0.7);
    ctx.stroke();

    for (var i = 0; i < tiers; i++) {
      var f = i / tiers;
      var halfW = r * (1.0 - i * (0.62 / tiers));
      var baseY = s.y - r * 0.6 - i * r * 0.92;
      var apexY = baseY - r * 1.55;
      var kinkY = baseY + r * 0.28;
      var sway = Math.sin((t.rot || 0) * 3 + i * 1.7) * r * 0.06;
      var cx = s.x + sway;

      // under-rim: separates this tier from the one below
      ctx.fillStyle = shade(col.dark, -10);
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 1.02, baseY + r * 0.08);
      ctx.lineTo(cx + halfW * 1.02, baseY + r * 0.08);
      ctx.lineTo(cx, kinkY + r * 0.1);
      ctx.closePath();
      ctx.fill();

      // lit + shaded faces, lighter toward the top of the tree
      ctx.fillStyle = shade(col.light, f * 26);
      ctx.beginPath();
      ctx.moveTo(cx, apexY);
      ctx.lineTo(cx - halfW, baseY);
      ctx.lineTo(cx, kinkY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(col.dark, f * 22);
      ctx.beginPath();
      ctx.moveTo(cx, apexY);
      ctx.lineTo(cx + halfW, baseY);
      ctx.lineTo(cx, kinkY);
      ctx.closePath();
      ctx.fill();

      // extra facets round the tree out
      var faces = t.faces || 3;
      var midHex = mix(col.light, col.dark);
      if (faces >= 3) {
        ctx.fillStyle = shade(midHex, f * 24);
        ctx.beginPath();
        ctx.moveTo(cx, apexY);
        ctx.lineTo(cx - halfW * 0.42, baseY + (kinkY - baseY) * 0.35);
        ctx.lineTo(cx, kinkY);
        ctx.lineTo(cx + halfW * 0.14, baseY + (kinkY - baseY) * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      if (faces >= 4) {
        ctx.fillStyle = shade(mix(midHex, col.dark), f * 22);
        ctx.beginPath();
        ctx.moveTo(cx, apexY);
        ctx.lineTo(cx + halfW * 0.14, baseY + (kinkY - baseY) * 0.5);
        ctx.lineTo(cx, kinkY);
        ctx.lineTo(cx + halfW * 0.52, baseY + (kinkY - baseY) * 0.28);
        ctx.closePath();
        ctx.fill();
      }
    }
  };

  // Deciduous: 3-5 stacked faceted lobes over a visible trunk.
  Renderer.prototype.drawLeafy = function (t) {
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var sc = this.cam.scale;
    var r = t.r * sc;
    var col = LEAFY[t.kind] || LEAFY.g;
    var lift = r * 1.15;

    this.dropShadow(s.x, s.y, r * 1.9, r * 2.1);

    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = Math.max(2, r * 0.24);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + r * 0.08, s.y - lift);
    ctx.stroke();

    var rot = t.rot || 0;
    var lobes = t.lobes || 3;
    for (var i = 0; i < lobes; i++) {
      var f = lobes === 1 ? 1 : i / (lobes - 1);
      var ang = rot + i * 2.4;
      var lx = s.x + Math.cos(ang) * r * 0.55 * (1 - f * 0.75);
      var ly = s.y - lift - f * r * 0.85 + Math.sin(ang) * r * 0.12;
      var lr = r * (0.72 - f * 0.22);
      this.drawLobe(lx, ly, lr, rot + i * 1.3, col, -10 + f * 20);
    }
  };

  Renderer.prototype.drawLobe = function (cx, cy, r, rot, col, lightBoost) {
    var ctx = this.ctx;
    var n = 7;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = rot + (i / n) * TAU;
      var rr = r * (0.85 + 0.22 * Math.sin(i * 2.3 + rot * 5));
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.9 });
    }
    var peak = { x: cx - r * 0.2, y: cy - r * 0.25 };
    for (i = 0; i < n; i++) {
      var v1 = pts[i], v2 = pts[(i + 1) % n];
      var mx = (v1.x + v2.x) / 2 - cx;
      var my = (v1.y + v2.y) / 2 - cy;
      var facing = (-mx - my * 1.2) / r;
      ctx.fillStyle = shade(facing > 0 ? col.light : col.dark, lightBoost + facing * 14);
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(v1.x, v1.y);
      ctx.lineTo(v2.x, v2.y);
      ctx.closePath();
      ctx.fill();
    }
  };

  // Palm: faceted kite fronds, coconuts, curved two-tone trunk.
  Renderer.prototype.drawPalm = function (t) {
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var sc = this.cam.scale;
    var r = t.r * sc;
    var lean = t.lean || 0;
    var topX = s.x + lean * r;
    var topY = s.y - r * 2.3;

    this.dropShadow(s.x, s.y, r * 2, r * 2.3);

    ctx.lineCap = 'round';
    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = Math.max(2.5, r * 0.26);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + lean * r * 0.4, s.y - r * 1.4, topX, topY);
    ctx.stroke();
    ctx.strokeStyle = PAL.trunkHi;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.06, s.y);
    ctx.quadraticCurveTo(s.x + lean * r * 0.34, s.y - r * 1.4, topX - r * 0.05, topY);
    ctx.stroke();

    var fronds = 6;
    for (var i = 0; i < fronds; i++) {
      var a = (i / fronds) * TAU + 0.35 + (t.rot || 0);
      var dx = Math.cos(a), dy = Math.sin(a) * 0.62 + 0.12;
      var L = r * 1.45 * (0.85 + 0.25 * Math.sin(i * 2.7));
      var px = -dy, py = dx;
      var w = r * 0.24;
      var tipX = topX + dx * L, tipY = topY + dy * L;
      var midX = topX + dx * L * 0.45, midY = topY + dy * L * 0.45;
      var lit = (-dx - dy * 1.2) > 0;
      ctx.fillStyle = lit ? '#79c356' : '#47953f';
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(midX + px * w, midY + py * w);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(midX - px * w, midY - py * w);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,80,35,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.arc(topX - r * 0.16, topY + r * 0.14, r * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(topX + r * 0.12, topY + r * 0.18, r * 0.12, 0, TAU); ctx.fill();
  };

  // ---------- boulders ----------

  Renderer.prototype.drawRocks = function (cluster) {
    var self = this;
    var pieces = cluster.pieces.slice().sort(function (a, b) {
      if (!!a.cap !== !!b.cap) return a.cap ? 1 : -1;
      return b.y - a.y;
    });
    pieces.forEach(function (rk) { self.drawBoulder(rk); });
  };

  Renderer.prototype.drawBoulder = function (rk) {
    var ctx = this.ctx;
    var s = this.toScreen(rk);
    var sc = this.cam.scale;
    var r = rk.r * sc;
    var rng = RNG.make(RNG.mix((rk.x * 97) | 0, ((rk.y * 131) | 0) + (rk.sides || 6)));
    var cy = s.y - r * 0.62;
    if (rk.cap && rk.capR) cy = s.y - rk.capR * sc * 1.15;

    if (!rk.cap) this.dropShadow(s.x, s.y, r * 2, r * 1.3);

    var n = 7;
    var verts = [];
    var rot = rk.rot || 0;
    for (var i = 0; i < n; i++) {
      var a = rot + (i / n) * TAU;
      var rr = r * (0.78 + rng.next() * 0.3);
      verts.push({ x: s.x + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.82 });
    }
    var peak = { x: s.x - r * 0.18, y: cy - r * 0.22 };
    for (i = 0; i < n; i++) {
      var v1 = verts[i], v2 = verts[(i + 1) % n];
      var mx = (v1.x + v2.x) / 2 - s.x;
      var my = (v1.y + v2.y) / 2 - cy;
      var facing = (-mx - my * 1.2) / r;
      ctx.fillStyle = facing > 0.45 ? PAL.rockLight
        : facing > -0.25 ? PAL.rockMid
        : facing > -0.8 ? PAL.rockDark : PAL.rockDarker;
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(v1.x, v1.y);
      ctx.lineTo(v2.x, v2.y);
      ctx.closePath();
      ctx.fill();
    }
  };

  // ---------- moai: three-plane sculpted heads, each face unique ----------

  Renderer.prototype.drawStatue = function (st) {
    var ctx = this.ctx;
    var s = this.toScreen(st);
    var sc = this.cam.scale;
    var rng = RNG.make(RNG.mix((st.x * 53) | 0, ((st.y * 97) | 0) + (st.kind === 'moai' ? 7 : 3)));
    var w = st.s * sc;
    var hgt = w * ((st.kind === 'moai' ? 2.8 : 2.1) + rng.next() * 0.7);
    var browY = 0.17 + rng.next() * 0.09;
    var browTh = 0.055 + rng.next() * 0.035;
    var noseW = 0.26 + rng.next() * 0.18;
    var noseL = 0.27 + rng.next() * 0.14;
    var mouthW = 0.4 + rng.next() * 0.4;
    var mouthY = 0.68 + rng.next() * 0.1;
    var eyeH = 0.07 + rng.next() * 0.05;
    rng.next(); // keep the rng stream stable (was the topknot roll)
    var light = st.tint ? '#d5bd74' : '#c3cad2';
    var mid = st.tint ? '#b39a4e' : '#9aa3ad';
    var dark = st.tint ? '#8f7a3a' : '#747d88';
    var darker = st.tint ? '#6e5d2c' : '#5b636e';

    this.dropShadow(s.x, s.y, w * 2.1, hgt);

    if (st.kind === 'moai') {
      ctx.fillStyle = '#79b657';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, w * 1.75, w * 0.75 * (this.cam.tilt + 0.3), 0, 0, TAU);
      ctx.fill();
    }

    var top = s.y - hgt;
    var fw = w * (0.55 + rng.next() * 0.14);
    var sw = w * (0.4 + rng.next() * 0.18);

    // right side plane (shaded)
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(s.x + fw, s.y);
    ctx.lineTo(s.x + fw, top + w * 0.32);
    ctx.quadraticCurveTo(s.x + fw, top + w * 0.06, s.x + fw * 0.55, top + w * 0.02);
    ctx.lineTo(s.x + fw + sw * 0.8, top + w * 0.28);
    ctx.lineTo(s.x + fw + sw, top + w * 0.75);
    ctx.lineTo(s.x + fw + sw * 0.92, s.y - w * 0.15);
    ctx.closePath();
    ctx.fill();

    // front face (lit) + left edge highlight
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(s.x - fw, s.y);
    ctx.lineTo(s.x - fw, top + w * 0.35);
    ctx.quadraticCurveTo(s.x - fw, top, s.x, top);
    ctx.quadraticCurveTo(s.x + fw, top + w * 0.06, s.x + fw, top + w * 0.32);
    ctx.lineTo(s.x + fw, s.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(s.x - fw, s.y);
    ctx.lineTo(s.x - fw, top + w * 0.35);
    ctx.quadraticCurveTo(s.x - fw, top, s.x, top);
    ctx.lineTo(s.x - fw * 0.55, top + w * 0.28);
    ctx.lineTo(s.x - fw * 0.62, s.y);
    ctx.closePath();
    ctx.fill();

    // brow
    ctx.fillStyle = darker;
    ctx.fillRect(s.x - fw * 0.9, top + hgt * browY, fw * 1.8, Math.max(1.5, hgt * browTh));
    ctx.fillStyle = shade(dark, -14);
    ctx.fillRect(s.x + fw, top + hgt * (browY + 0.02), sw * 0.8, Math.max(1, hgt * browTh * 0.7));

    // nose wedge: lit left edge, shaded right
    var nx = s.x - fw * 0.08, nw = fw * noseW, ny = top + hgt * (browY + 0.05), nh = hgt * noseL;
    ctx.fillStyle = light;
    ctx.fillRect(nx - nw * 0.5, ny, nw * 0.5, nh);
    ctx.fillStyle = darker;
    ctx.fillRect(nx, ny, nw * 0.5, nh);
    ctx.fillRect(nx - nw * 0.6, ny + nh, nw * 1.2, Math.max(1, hgt * 0.03));

    // eye sockets
    var eyeY = top + hgt * (browY + browTh + 0.03);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(s.x - fw * 0.72, eyeY, fw * 0.44, hgt * eyeH);
    ctx.fillRect(s.x + fw * 0.22, eyeY, fw * 0.44, hgt * eyeH);

    // mouth
    ctx.fillStyle = darker;
    ctx.fillRect(s.x - fw * mouthW * 0.5, top + hgt * mouthY, fw * mouthW, Math.max(1, hgt * 0.045));

    // scattered faceted stones at the base
    var stones = 2 + Math.floor(rng.next() * 3);
    for (var st2 = 0; st2 < stones; st2++) {
      var sa = rng.next() * TAU;
      var sd = w * (0.85 + rng.next() * 0.6);
      var px = s.x + Math.cos(sa) * sd;
      var py = s.y + Math.sin(sa) * sd * 0.45 + w * 0.08;
      var pr = w * (0.16 + rng.next() * 0.2);
      var prot = rng.next() * TAU;
      ctx.fillStyle = PAL.rockDark;
      ctx.beginPath();
      for (var pv = 0; pv < 5; pv++) {
        var pa = prot + (pv / 5) * TAU;
        var prr = pr * (0.8 + rng.next() * 0.35);
        var vx = px + Math.cos(pa) * prr, vy = py + Math.sin(pa) * prr * 0.8;
        if (pv === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PAL.rockLight;
      ctx.beginPath();
      ctx.moveTo(px - pr * 0.7, py - pr * 0.1);
      ctx.lineTo(px - pr * 0.15, py - pr * 0.75);
      ctx.lineTo(px + pr * 0.55, py - pr * 0.35);
      ctx.lineTo(px, py + pr * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  };

  // ---------- tufts: tall grass, flowers, props ----------

  Renderer.prototype.drawBush = function (tf) {
    if (tf.kind === 'tall') return this.drawTallGrass(tf);
    if (tf.kind === 'stump') return this.drawStump(tf);
    if (tf.kind === 'log') return this.drawLog(tf);
    if (tf.kind === 'dead') return this.drawDeadTree(tf);
    if (tf.kind === 'shroom') return this.drawShroom(tf);
    if (tf.kind === 'pebble') return this.drawPebbles(tf);
    return this.drawFlower(tf);
  };

  Renderer.prototype.drawTallGrass = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var h = tf.s * 3.6 * sc;
    for (var i = 0; i < 5; i++) {
      var off = (i - 2) * h * 0.2;
      var bend = Math.sin(tf.rot + i * 2.1) * h * 0.35 + sc * 0.1;
      var bh = h * (0.6 + 0.4 * Math.sin(tf.rot * 3 + i));
      var blades = THEME === 'winter' ? BLADES_WINTER : BLADES;
      ctx.fillStyle = blades[(i + Math.floor(tf.rot * 7)) % blades.length];
      ctx.beginPath();
      ctx.moveTo(s.x + off - h * 0.09, s.y);
      ctx.lineTo(s.x + off + h * 0.09, s.y);
      ctx.lineTo(s.x + off + bend, s.y - bh);
      ctx.closePath();
      ctx.fill();
    }
  };

  Renderer.prototype.drawFlower = function (tf) {
    var col = FLOWERS[tf.kind];
    if (!col) return;
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var u = tf.s * sc * 0.55;
    var rot = tf.rot || 0;
    ctx.fillStyle = '#6ca23f';
    ctx.beginPath();
    ctx.ellipse(s.x - u * 0.8, s.y - u * 0.15, u * 0.75, u * 0.3, -0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.x + u * 0.7, s.y - u * 0.1, u * 0.65, u * 0.28, 0.45, 0, TAU);
    ctx.fill();
    for (var f = 0; f < 2; f++) {
      var fx = s.x + (f ? u * 0.7 : -u * 0.5);
      var fy = s.y - u * (f ? 1.1 : 1.5);
      ctx.strokeStyle = '#5c8f38';
      ctx.lineWidth = Math.max(1, u * 0.16);
      ctx.beginPath();
      ctx.moveTo(fx, s.y);
      ctx.lineTo(fx, fy + u * 0.3);
      ctx.stroke();
      ctx.fillStyle = col;
      for (var p = 0; p < 5; p++) {
        var a = rot + (p / 5) * TAU;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * u * 0.42, fy + Math.sin(a) * u * 0.42, u * 0.3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(fx, fy, u * 0.24, 0, TAU);
      ctx.fill();
    }
  };

  Renderer.prototype.drawStump = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var r = tf.s * 1.9 * sc;
    var h = r * 0.9;
    this.dropShadow(s.x, s.y, r * 2, h);
    ctx.fillStyle = PAL.trunk;
    ctx.beginPath();
    ctx.moveTo(s.x - r, s.y - h);
    ctx.lineTo(s.x - r, s.y);
    ctx.quadraticCurveTo(s.x, s.y + r * 0.5, s.x + r, s.y);
    ctx.lineTo(s.x + r, s.y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade('#8a5f38', -22);
    ctx.beginPath();
    ctx.moveTo(s.x + r * 0.3, s.y - h + r * 0.2);
    ctx.lineTo(s.x + r * 0.3, s.y + r * 0.16);
    ctx.quadraticCurveTo(s.x + r * 0.7, s.y + r * 0.1, s.x + r, s.y);
    ctx.lineTo(s.x + r, s.y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#d9b98a';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - h, r, r * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,77,42,0.5)';
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - h, r * 0.6, r * 0.32, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(s.x, s.y - h, r * 0.28, r * 0.15, 0, 0, TAU);
    ctx.stroke();
  };

  Renderer.prototype.drawLog = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var L = tf.s * 6.5 * sc;
    var r = tf.s * 1.2 * sc;
    var a = (tf.rot || 0) * 0.4 - 0.2;
    var dx = Math.cos(a), dy = Math.sin(a) * 0.5;
    var x2 = s.x + dx * L, y2 = s.y + dy * L;
    this.dropShadow((s.x + x2) / 2, (s.y + y2) / 2, L * 0.9, r * 1.6);
    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = r * 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x, s.y - r); ctx.lineTo(x2, y2 - r); ctx.stroke();
    ctx.strokeStyle = PAL.trunkHi;
    ctx.lineWidth = r * 0.6;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - r * 1.6); ctx.lineTo(x2, y2 - r * 1.6); ctx.stroke();
    ctx.fillStyle = '#d9b98a';
    ctx.beginPath();
    ctx.ellipse(x2, y2 - r, r * 0.62, r, -a * 0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,77,42,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x2, y2 - r, r * 0.32, r * 0.5, -a * 0.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(s.x + dx * L * 0.4, s.y + dy * L * 0.4 - r * 1.8);
    ctx.lineTo(s.x + dx * L * 0.4 + r * 0.8, s.y + dy * L * 0.4 - r * 2.8);
    ctx.stroke();
  };

  Renderer.prototype.drawDeadTree = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var h = tf.s * 8 * sc;
    this.dropShadow(s.x, s.y, h * 0.35, h);
    ctx.strokeStyle = '#7a5233';
    ctx.lineCap = 'round';
    var rot = tf.rot || 0;
    var lean = Math.sin(rot) * 0.25;
    branch(s.x, s.y, -Math.PI / 2 + lean, h * 0.62, Math.max(1.6, h * 0.07), 3);
    function branch(x, y, ang, len, wid, depth) {
      var nx = x + Math.cos(ang) * len;
      var ny = y + Math.sin(ang) * len;
      ctx.lineWidth = wid;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      if (depth <= 0) return;
      branch(nx, ny, ang - 0.55 - Math.sin(rot + depth) * 0.15, len * 0.62, wid * 0.6, depth - 1);
      branch(nx, ny, ang + 0.5 + Math.cos(rot * 2 + depth) * 0.15, len * 0.58, wid * 0.6, depth - 1);
    }
  };

  Renderer.prototype.drawShroom = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var u = tf.s * 0.9 * sc;
    for (var i = 0; i < 2; i++) {
      var x = s.x + i * u * 1.1 - u * 0.5;
      var capR = u * (i ? 0.5 : 0.75);
      ctx.fillStyle = '#f3e7d0';
      ctx.fillRect(x - capR * 0.22, s.y - capR * 1.15, capR * 0.44, capR * 1.15);
      ctx.fillStyle = i ? '#e5484d' : '#d8403f';
      ctx.beginPath();
      ctx.ellipse(x, s.y - capR * 1.1, capR, capR * 0.72, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(x - capR * 0.3, s.y - capR * 1.35, capR * 0.16, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + capR * 0.25, s.y - capR * 1.2, capR * 0.12, 0, TAU); ctx.fill();
    }
  };

  Renderer.prototype.drawPebbles = function (tf) {
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var u = tf.s * 0.9 * sc;
    var rot = tf.rot || 0;
    var cols = [PAL.rockMid, PAL.rockLight, PAL.rockDark];
    for (var i = 0; i < 3; i++) {
      var x = s.x + Math.cos(rot + i * 2.2) * u * 1.1;
      var y = s.y + Math.sin(rot + i * 2.2) * u * 0.5;
      var r = u * (0.55 - i * 0.12);
      ctx.fillStyle = cols[i];
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x - r * 0.5, y - r * 0.8);
      ctx.lineTo(x + r * 0.55, y - r * 0.7);
      ctx.lineTo(x + r, y);
      ctx.closePath();
      ctx.fill();
    }
  };

  // ---------- pin, balls, effects ----------

  Renderer.prototype.drawPin = function (pin) {
    var ctx = this.ctx;
    var s = this.toScreen(pin);
    var sc = this.cam.scale;
    ctx.fillStyle = 'rgba(30,60,35,0.85)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, 1.1 * sc, 0.65 * sc * (this.cam.tilt + 0.3), 0, 0, TAU);
    ctx.fill();
    var top = s.y - 13 * sc * (1.3 - this.cam.tilt * 0.35);
    ctx.strokeStyle = PAL.pinPole;
    ctx.lineWidth = Math.max(1.5, sc * 0.5);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, top); ctx.stroke();
    var wave = Math.sin(this.time / 300) * sc;
    ctx.fillStyle = PAL.flag;
    ctx.beginPath();
    ctx.moveTo(s.x, top);
    ctx.lineTo(s.x + 6.5 * sc, top + 1.8 * sc + wave * 0.15);
    ctx.lineTo(s.x, top + 3.6 * sc);
    ctx.closePath();
    ctx.fill();
  };

  Renderer.prototype.drawBallAt = function (b, char, isMe) {
    var ctx = this.ctx;
    var s = this.toScreen(b);
    var sc = this.cam.scale;
    var r = Math.max(2.5, sc * 0.75);
    if (char) {
      Character.draw(ctx, char, s.x - r * 3.4, s.y + r * 0.6, Math.max(0.55, Math.min(2.4, sc / 5)));
    }
    ctx.fillStyle = 'rgba(40,70,40,0.35)';
    ctx.beginPath();
    ctx.ellipse(s.x + r * 0.25, s.y + r * 0.3, r, r * 0.45, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(s.x, s.y - r * 0.4, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = isMe ? '#3f8fd2' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  Renderer.prototype.drawFlying = function (f) {
    var ctx = this.ctx;
    var s = this.toScreen(f);
    var lift = f.h * this.cam.scale * 0.55;
    var r = Math.max(2.5, this.cam.scale * 0.75) * (1 + f.h / 45);
    ctx.fillStyle = 'rgba(40,70,40,' + Math.max(0.08, 0.35 - f.h / 120) + ')';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 0.9, r * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(s.x, s.y - lift, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  Renderer.prototype.drawSplash = function (sp) {
    var ctx = this.ctx;
    var s = this.toScreen(sp);
    var age = (this.time - sp.t0) / 700;
    if (age > 1) return;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - age)) + ')';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, (2 + age * 9) * this.cam.scale * 0.5,
      (2 + age * 9) * this.cam.scale * 0.5 * this.cam.tilt, 0, 0, TAU);
    ctx.stroke();
  };

  Renderer.prototype.drawAim = function (aim) {
    var ctx = this.ctx;
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    var end;
    if (aim.path && aim.path.length > 1) {
      this.poly(aim.path, false);
      ctx.stroke();
      end = this.toScreen(aim.path[aim.path.length - 1]);
    } else {
      var from = this.toScreen(aim.from);
      end = this.toScreen(aim.to);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Putt read: dots flow along the predicted line toward the hole, so the
    // break direction and pace are easy to read.
    if (aim.isPutt && aim.path && aim.path.length > 1) {
      var pts = [];
      for (var i = 0; i < aim.path.length; i++) pts.push(this.toScreen(aim.path[i]));
      var seg = [], total = 0;
      for (i = 1; i < pts.length; i++) {
        var d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        seg.push(d); total += d;
      }
      var spacing = Math.max(14, this.cam.scale * 4);
      var phase = ((this.time || 0) / 300 % 1) * spacing;
      var dotR = Math.max(2, this.cam.scale * 0.9);
      for (var dpos = phase; dpos < total; dpos += spacing) {
        var acc = 0, j = 0;
        while (j < seg.length && acc + seg[j] < dpos) { acc += seg[j]; j++; }
        if (j >= seg.length) break;
        var f = (dpos - acc) / (seg[j] || 1);
        var dx = pts[j].x + (pts[j + 1].x - pts[j].x) * f;
        var dy = pts[j].y + (pts[j + 1].y - pts[j].y) * f;
        var fade = 1 - dpos / total;
        ctx.beginPath();
        ctx.arc(dx, dy, dotR, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.45 + 0.45 * fade) + ')';
        ctx.fill();
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    var rr = Math.max(6, this.cam.scale * 3.5);
    ctx.beginPath();
    ctx.ellipse(end.x, end.y, rr, rr * this.cam.tilt, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(end.x, end.y, 2.4, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  };

  window.Renderer = Renderer;
})();
