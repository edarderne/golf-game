// Canvas renderer: stylised low-poly island look with a pseudo-3D camera.
// The camera supports rotation (aim direction points up-screen), tilt
// (vertical squash for an isometric feel) and an anchor (where the focus
// point sits vertically). Objects have height drawn straight up in screen
// space and are depth-sorted, which sells the 3D.
(function () {
  'use strict';

  var PAL = {
    seaTop: '#8fd8d8', seaBottom: '#2f96a4',
    foam: 'rgba(255,255,255,0.75)',
    sand: '#f2e0b4', sandEdge: '#e0c890',
    rough: '#b0c853', roughDot: '#9fb748',
    fairway: '#c8dc72',
    green: '#9fdc72', greenHi: '#c0ec8e', greenLo: '#7cc45e',
    fringe: '#b2e07f',
    bunker: '#f6e7bd', bunkerEdge: '#dfc794',
    water: '#6fcbd6', waterEdge: 'rgba(255,255,255,0.55)',
    shadow: 'rgba(44,84,52,0.28)',
    trunk: '#8a5f38',
    pinPole: '#f6f6f2', flag: '#e6543f',
    ball: '#ffffff',
    stone: '#8b939e', stoneLight: '#aab2bc', stoneDark: '#6e7681',
    stoneOchre: '#b39a4e', stoneOchreLight: '#cdb56a', stoneOchreDark: '#8f7a3a',
  };

  var TREE_COLS = {
    g:  { base: '#4f9a55', top: '#7ecb62', dark: '#3d7d44' },
    g2: { base: '#3e8148', top: '#66b654', dark: '#2f663a' },
    o:  { base: '#b06a2c', top: '#e09a44', dark: '#8f5423' },
    y:  { base: '#98932f', top: '#c9be4c', dark: '#7a7526' },
  };

  var BUSH_COLS = {
    orange: { base: '#d98a2f', top: '#f0ab4e' },
    yellow: { base: '#c4b23e', top: '#e2d35e' },
    pink:   { base: '#d770c1', top: '#efa2de' },
    cyan:   { base: '#4fb9c9', top: '#83dbe6' },
  };

  var TAU = Math.PI * 2;

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, scale: 4, rot: 0, tilt: 0.85, anchor: 0.5 };
    this.target = { x: 0, y: 0, scale: 4, rot: 0, tilt: 0.85, anchor: 0.5 };
    this.time = 0;
  }

  var OVER_TILT = 0.85;

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

  // Overview: whole hole, top-down-ish, no rotation.
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

  // Shot view: behind the ball, aim direction up-screen, isometric tilt.
  // `ahead` is how many yards of course should be visible past the ball.
  Renderer.prototype.fitShot = function (ball, rot, ahead) {
    if (!this.w || !this.h) this.resize();
    if (!this.w || !this.h) return;
    var anchor = 0.76, tilt = 0.5;
    var avail = this.h * anchor - 70; // px between ball and the top HUD
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

  // Rotated camera-space coords (rx right, ry away/up-screen).
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

  Renderer.prototype.poly = function (pts, close) {
    var ctx = this.ctx;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var s = this.toScreen(pts[i]);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    if (close !== false) ctx.closePath();
  };

  // Smooth closed blob through points (quadratic through midpoints).
  Renderer.prototype.blobPath = function (pts) {
    var ctx = this.ctx;
    var n = pts.length;
    ctx.beginPath();
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

  // ---------- main draw ----------

  Renderer.prototype.draw = function (state) {
    var ctx = this.ctx;
    var hole = state.hole;
    this.resize();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.time = state.time || 0;

    // sea
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, PAL.seaTop);
    g.addColorStop(1, PAL.seaBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawWaves();

    if (hole) {
      this.drawGround(hole, state);
      this.drawEntities(hole, state);
    }
    ctx.restore();
  };

  Renderer.prototype.drawGround = function (hole, state) {
    var ctx = this.ctx;
    var sc = this.cam.scale;

    // foam ring + beach + grass
    this.blobPath(hole.beachPoly);
    ctx.strokeStyle = PAL.foam;
    ctx.lineWidth = Math.max(2, sc * 1.6);
    ctx.stroke();
    this.blobPath(hole.beachPoly);
    ctx.fillStyle = PAL.sand;
    ctx.fill();
    this.blobPath(hole.grassPoly);
    ctx.fillStyle = PAL.rough;
    ctx.fill();

    // rough texture dots (plain grass tufts live in the ground layer)
    ctx.fillStyle = PAL.roughDot;
    for (var i = 0; i < hole.tufts.length; i++) {
      var tf = hole.tufts[i];
      if (tf.kind !== 'grass') continue;
      var s = this.toScreen(tf);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.2 * tf.s * (sc / 4), 0, TAU);
      ctx.fill();
    }

    // fairway
    this.poly(hole.fairwayPoly);
    ctx.fillStyle = PAL.fairway;
    ctx.fill();

    // tee pad
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    this.groundEllipse(hole.tee, 5);
    ctx.fill();
    ctx.fillStyle = '#dcea9e';
    this.groundEllipse(hole.tee, 4);
    ctx.fill();

    // green: fringe, slope-shaded surface, downhill arrows
    ctx.fillStyle = PAL.fringe;
    this.groundEllipse(hole.green, hole.greenR + 2.5);
    ctx.fill();
    var gc = this.toScreen(hole.green);
    var rpx = hole.greenR * sc;
    var slope = hole.greenSlope || { x: 0, y: 1, mag: 0 };
    // screen direction of downhill
    var sHere = this.toScreen(hole.green);
    var sDown = this.toScreen({ x: hole.green.x + slope.x * 100, y: hole.green.y + slope.y * 100 });
    var gdx = sDown.x - sHere.x, gdy = sDown.y - sHere.y;
    var gl = Math.sqrt(gdx * gdx + gdy * gdy) || 1;
    gdx /= gl; gdy /= gl;
    var grad = ctx.createLinearGradient(gc.x - gdx * rpx, gc.y - gdy * rpx, gc.x + gdx * rpx, gc.y + gdy * rpx);
    grad.addColorStop(0, PAL.greenHi);
    grad.addColorStop(1, PAL.greenLo);
    ctx.fillStyle = grad;
    this.groundEllipse(hole.green, hole.greenR);
    ctx.fill();
    this.drawSlopeArrows(hole, gdx, gdy);

    // bunkers
    for (i = 0; i < hole.bunkers.length; i++) {
      this.blobPath(hole.bunkers[i]);
      ctx.fillStyle = PAL.bunker;
      ctx.fill();
      ctx.strokeStyle = PAL.bunkerEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // ponds
    for (i = 0; i < hole.waters.length; i++) {
      this.blobPath(hole.waters[i]);
      ctx.fillStyle = PAL.water;
      ctx.fill();
      this.blobPath(hole.waters[i]);
      ctx.strokeStyle = PAL.waterEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // aim preview sits on the ground, under trees/statues
    if (state.aim) this.drawAim(state.aim);
  };

  Renderer.prototype.drawSlopeArrows = function (hole, gdx, gdy) {
    var ctx = this.ctx;
    if (!hole.greenSlope || hole.greenSlope.mag < 0.005) return;
    var sc = this.cam.scale;
    if (sc < 2.2) return; // only readable up close
    var strength = Math.min(1, hole.greenSlope.mag / 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.25 + strength * 0.35) + ')';
    ctx.lineWidth = Math.max(1.2, sc * 0.28);
    ctx.lineCap = 'round';
    var px = -gdy, py = gdx; // perpendicular in screen space
    var gc = this.toScreen(hole.green);
    var rpx = hole.greenR * sc;
    var wob = Math.sin(this.time / 500) * rpx * 0.03;
    for (var i = -1; i <= 1; i += 2) { // two arrows, clear of the pin
      var cx = gc.x + px * i * rpx * 0.5 + gdx * (wob - rpx * 0.05);
      var cy = gc.y + py * i * rpx * 0.5 * this.cam.tilt + gdy * (wob - rpx * 0.05);
      var a = rpx * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx - px * a - gdx * a, cy - py * a - gdy * a);
      ctx.lineTo(cx + gdx * a * 0.9, cy + gdy * a * 0.9);
      ctx.lineTo(cx + px * a - gdx * a, cy + py * a - gdy * a);
      ctx.stroke();
    }
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

    items.sort(function (a, b) { return b.d - a.d; }); // far (big ry) first
    for (i = 0; i < items.length; i++) items[i].fn();
  };

  Renderer.prototype.drawWaves = function () {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1.5;
    var t = this.time / 1400;
    for (var i = 0; i < 6; i++) {
      var yy = ((i * 137 + t * 20) % (this.h + 60)) - 30;
      var xx = (i * 211) % this.w;
      ctx.beginPath();
      ctx.arc(xx, yy, 9 + (i % 3) * 4, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  };

  // Faceted low-poly canopy + trunk.
  Renderer.prototype.drawTree = function (t) {
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var sc = this.cam.scale;
    var r = t.r * sc;
    if (t.kind === 'palm') return this.drawPalm(t, s, r);
    var col = TREE_COLS[t.kind] || TREE_COLS.g;
    var lift = r * (1.35 - this.cam.tilt * 0.55); // canopy rises as view tilts
    var cy = s.y - lift;

    // ground shadow
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(s.x - r * 0.35, s.y + r * 0.12, r * 1.0, r * 0.42 * (this.cam.tilt + 0.3), 0, 0, TAU);
    ctx.fill();

    // trunk
    ctx.strokeStyle = PAL.trunk;
    ctx.lineWidth = Math.max(1.5, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, cy + r * 0.4);
    ctx.stroke();

    // canopy: irregular polygon, then shade facets clipped inside it
    ctx.save();
    canopyPath(ctx, s.x, cy, r, t.rot || 0);
    ctx.fillStyle = col.base;
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = col.dark;
    ctx.beginPath();
    ctx.ellipse(s.x + r * 0.45, cy + r * 0.5, r * 0.95, r * 0.8, 0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col.top;
    ctx.beginPath();
    ctx.ellipse(s.x - r * 0.28, cy - r * 0.35, r * 0.75, r * 0.6, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  };

  function canopyPath(ctx, cx, cy, r, rot) {
    var n = 8;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var a = rot + (i / n) * TAU;
      var rr = r * (0.86 + 0.2 * Math.sin(i * 2.1 + rot * 3));
      var px = cx + Math.cos(a) * rr;
      var py = cy + Math.sin(a) * rr * 0.92;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  Renderer.prototype.drawPalm = function (t, s, r) {
    var ctx = this.ctx;
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(s.x - r * 0.6, s.y + r * 0.15, r * 1.1, r * 0.4 * (this.cam.tilt + 0.3), 0, 0, TAU);
    ctx.fill();
    var lift = r * (2.1 - this.cam.tilt * 0.7);
    var topX = s.x + t.lean * r, topY = s.y - lift;
    ctx.strokeStyle = '#9a6b3f';
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + t.lean * r * 0.4, s.y - lift * 0.6, topX, topY);
    ctx.stroke();
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU + 0.4;
      var fx = Math.cos(a) * r * 1.15, fy = Math.sin(a) * r * 0.75;
      ctx.strokeStyle = i % 2 ? '#3f9448' : '#5cb556';
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(topX + fx * 0.6, topY + fy * 0.6 - r * 0.35, topX + fx, topY + fy);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a4d2a';
    ctx.beginPath(); ctx.arc(topX, topY, r * 0.18, 0, TAU); ctx.fill();
  };

  Renderer.prototype.drawRocks = function (cluster) {
    var ctx = this.ctx;
    for (var i = 0; i < cluster.pieces.length; i++) {
      var rk = cluster.pieces[i];
      var s = this.toScreen(rk);
      var r = rk.r * this.cam.scale;
      ctx.fillStyle = PAL.shadow;
      ctx.beginPath();
      ctx.ellipse(s.x - r * 0.4, s.y + r * 0.15, r, r * 0.4 * (this.cam.tilt + 0.3), 0, 0, TAU);
      ctx.fill();
      facet(ctx, s.x, s.y - r * 0.3, r, rk.sides, rk.rot, '#cdd3da');
      facet(ctx, s.x + r * 0.18, s.y - r * 0.52, r * 0.55, rk.sides, rk.rot + 0.5, '#e4e8ee');
      ctx.fillStyle = 'rgba(122,167,84,0.75)';
      ctx.beginPath(); ctx.arc(s.x - r * 0.3, s.y - r * 0.72, r * 0.26, 0, TAU); ctx.fill();
    }
    function facet(ctx, cx, cy, r, sides, rot, col) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (var j = 0; j < sides; j++) {
        var a = rot + (j / sides) * TAU;
        var rr = r * (0.82 + 0.25 * Math.sin(j * 2.7 + rot * 5));
        var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * 0.85;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  };

  // Moai statue: tall faceted head with brow + nose, light/dark sides.
  Renderer.prototype.drawStatue = function (st) {
    var ctx = this.ctx;
    var s = this.toScreen(st);
    var sc = this.cam.scale;
    var w = st.s * sc;                       // half-width in px
    var hgt = w * (st.kind === 'moai' ? 3.1 : 2.5); // full height in px
    var light = st.tint ? PAL.stoneOchreLight : PAL.stoneLight;
    var base = st.tint ? PAL.stoneOchre : PAL.stone;
    var dark = st.tint ? PAL.stoneOchreDark : PAL.stoneDark;

    // shadow
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(s.x - w * 0.5, s.y + w * 0.1, w * 1.4, w * 0.5 * (this.cam.tilt + 0.3), 0, 0, TAU);
    ctx.fill();

    // grass mound base for the big one
    if (st.kind === 'moai') {
      ctx.fillStyle = '#79b657';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, w * 1.7, w * 0.75 * (this.cam.tilt + 0.3), 0, 0, TAU);
      ctx.fill();
    }

    var top = s.y - hgt;
    // head block (rounded top, slight taper)
    ctx.fillStyle = base;
    roundedHead(ctx, s.x, top, w, hgt);
    ctx.fill();
    // light left facet
    ctx.save();
    roundedHead(ctx, s.x, top, w, hgt);
    ctx.clip();
    ctx.fillStyle = light;
    ctx.fillRect(s.x - w, top - 2, w * 0.55, hgt + 4);
    ctx.fillStyle = dark;
    ctx.fillRect(s.x + w * 0.45, top - 2, w * 0.6, hgt + 4);
    // brow
    ctx.fillStyle = dark;
    ctx.fillRect(s.x - w * 0.78, top + hgt * 0.22, w * 1.56, Math.max(1.5, hgt * 0.07));
    // nose
    ctx.fillRect(s.x - w * 0.14, top + hgt * 0.26, w * 0.28, hgt * 0.34);
    // eye shadows
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(s.x - w * 0.62, top + hgt * 0.3, w * 0.36, hgt * 0.1);
    ctx.fillRect(s.x + w * 0.26, top + hgt * 0.3, w * 0.36, hgt * 0.1);
    // mouth
    ctx.fillStyle = dark;
    ctx.fillRect(s.x - w * 0.3, top + hgt * 0.72, w * 0.6, Math.max(1, hgt * 0.045));
    ctx.restore();

    // moss at the base
    ctx.fillStyle = 'rgba(101,155,72,0.85)';
    ctx.beginPath();
    ctx.ellipse(s.x - w * 0.45, s.y - w * 0.15, w * 0.4, w * 0.22, 0, 0, TAU);
    ctx.fill();

    function roundedHead(ctx, cx, top, w, hgt) {
      var bot = top + hgt;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.85, bot);
      ctx.lineTo(cx - w * 0.95, top + hgt * 0.28);
      ctx.quadraticCurveTo(cx - w * 0.9, top, cx, top);
      ctx.quadraticCurveTo(cx + w * 0.9, top, cx + w * 0.95, top + hgt * 0.28);
      ctx.lineTo(cx + w * 0.85, bot);
      ctx.closePath();
    }
  };

  Renderer.prototype.drawBush = function (tf) {
    var ctx = this.ctx;
    var col = BUSH_COLS[tf.kind];
    if (!col) return;
    var s = this.toScreen(tf);
    var r = tf.s * 1.8 * this.cam.scale * 0.6;
    ctx.fillStyle = PAL.shadow;
    ctx.beginPath();
    ctx.ellipse(s.x - r * 0.3, s.y + r * 0.1, r, r * 0.4, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col.base;
    ctx.beginPath();
    ctx.arc(s.x, s.y - r * 0.5, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col.top;
    ctx.beginPath();
    ctx.arc(s.x - r * 0.25, s.y - r * 0.75, r * 0.55, 0, TAU);
    ctx.fill();
  };

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
      // curved putt preview with the green's break applied
      this.poly(aim.path, false);
      ctx.stroke();
      end = this.toScreen(aim.path[aim.path.length - 1]);
    } else {
      var from = this.toScreen(aim.from);
      end = this.toScreen(aim.to);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    }
    ctx.setLineDash([]);
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
