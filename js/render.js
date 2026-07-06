// Canvas renderer: stylised top-down island look — light aqua sea with foam,
// sand ring, blobby trees with highlight tops, grey rock clusters, palms.
(function () {
  'use strict';

  var PAL = {
    seaTop: '#9fdede', seaBottom: '#5fc2cd',
    foam: 'rgba(255,255,255,0.75)',
    sand: '#f2e2bd', sandEdge: '#e3cd9d',
    rough: '#a9c25d', roughDot: '#98b150',
    fairway: '#bdd77a', fairwayStripe: 'rgba(255,255,255,0.05)',
    green: '#95d876', fringe: '#aade7f',
    bunker: '#f5e6bf', bunkerEdge: '#dfc794',
    water: '#7ccfd6', waterEdge: 'rgba(255,255,255,0.55)',
    treeShadow: 'rgba(46,86,52,0.28)',
    pinPole: '#f4f4f0', flag: '#e6543f',
    ball: '#ffffff',
  };

  var TREE_COLS = {
    g:  { base: '#4e9152', top: '#7ac564' },
    g2: { base: '#3e7d46', top: '#63b153' },
    o:  { base: '#b06a2c', top: '#e09a44' },
    y:  { base: '#8f8a2e', top: '#c2b84a' },
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, scale: 4 };
    this.target = { x: 0, y: 0, scale: 4 };
    this.time = 0;
  }

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

  // Fit a world-rect into view (world y+ is "up the hole" → screen up).
  Renderer.prototype.fitBounds = function (b, pad) {
    pad = pad || 0;
    if (!this.w || !this.h) this.resize();
    if (!this.w || !this.h) return;
    // reserve screen space for the HUD (top) and controls (bottom)
    var insetTop = 55, insetBottom = 150;
    var availH = Math.max(120, this.h - insetTop - insetBottom);
    var bw = (b.maxX - b.minX) + pad * 2;
    var bh = (b.maxY - b.minY) + pad * 2;
    var scale = Math.min(this.w / bw, availH / bh);
    this.target = {
      x: (b.minX + b.maxX) / 2,
      // shift world center so the fitted rect sits between the insets
      y: (b.minY + b.maxY) / 2 - (this.h / 2 - insetTop - availH / 2) / scale,
      scale: scale,
    };
  };

  Renderer.prototype.snapCamera = function () {
    this.cam.x = this.target.x; this.cam.y = this.target.y; this.cam.scale = this.target.scale;
  };

  Renderer.prototype.tickCamera = function (dt) {
    if (!isFinite(this.cam.scale) || !isFinite(this.cam.x)) this.snapCamera();
    var k = 1 - Math.pow(0.002, dt / 1000); // smooth ease (dt in ms)
    this.cam.x += (this.target.x - this.cam.x) * k;
    this.cam.y += (this.target.y - this.cam.y) * k;
    this.cam.scale += (this.target.scale - this.cam.scale) * k;
  };

  Renderer.prototype.toScreen = function (p) {
    return {
      x: this.w / 2 + (p.x - this.cam.x) * this.cam.scale,
      y: this.h / 2 - (p.y - this.cam.y) * this.cam.scale,
    };
  };

  Renderer.prototype.toWorld = function (sx, sy) {
    return {
      x: this.cam.x + (sx - this.w / 2) / this.cam.scale,
      y: this.cam.y - (sy - this.h / 2) / this.cam.scale,
    };
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

  Renderer.prototype.draw = function (state) {
    var ctx = this.ctx;
    var hole = state.hole;
    this.resize();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.time = state.time || 0;

    // --- sea ---
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, PAL.seaTop);
    g.addColorStop(1, PAL.seaBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawWaves();

    if (hole) {
      // --- island ---
      // foam ring
      this.blobPath(hole.beachPoly);
      ctx.strokeStyle = PAL.foam;
      ctx.lineWidth = Math.max(2, this.cam.scale * 1.6);
      ctx.stroke();
      // beach
      this.blobPath(hole.beachPoly);
      ctx.fillStyle = PAL.sand;
      ctx.fill();
      // grass
      this.blobPath(hole.grassPoly);
      ctx.fillStyle = PAL.rough;
      ctx.fill();

      // rough texture dots (cheap, seeded off tuft positions)
      ctx.fillStyle = PAL.roughDot;
      for (var i = 0; i < hole.tufts.length; i++) {
        var tf = hole.tufts[i];
        var s = this.toScreen(tf);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 * tf.s * (this.cam.scale / 4), 0, Math.PI * 2);
        ctx.fill();
      }

      // fairway (thick round-cap centerline)
      ctx.strokeStyle = PAL.fairway;
      ctx.lineWidth = hole.fairwayW * this.cam.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.poly(hole.line, false);
      ctx.stroke();

      // green + fringe
      var gc = this.toScreen(hole.green);
      ctx.fillStyle = PAL.fringe;
      ctx.beginPath(); ctx.arc(gc.x, gc.y, (hole.greenR + 2.5) * this.cam.scale, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PAL.green;
      ctx.beginPath(); ctx.arc(gc.x, gc.y, hole.greenR * this.cam.scale, 0, Math.PI * 2); ctx.fill();

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

      // tee markers
      this.drawTee(hole.tee);

      // aim preview (under decor so trees overlap it naturally)
      if (state.aim) this.drawAim(state.aim);

      // decor sorted by screen y (things lower on screen draw last)
      var decor = [];
      for (i = 0; i < hole.trees.length; i++) decor.push({ y: -hole.trees[i].y, kind: 'tree', o: hole.trees[i] });
      for (i = 0; i < hole.rocks.length; i++) decor.push({ y: -hole.rocks[i].y, kind: 'rock', o: hole.rocks[i] });
      decor.sort(function (a, b) { return a.y - b.y; });
      for (i = 0; i < decor.length; i++) {
        if (decor[i].kind === 'tree') this.drawTree(decor[i].o);
        else this.drawRocks(decor[i].o);
      }

      // pin
      this.drawPin(hole.pin);

      // balls + golfers
      if (state.balls) {
        for (var uid in state.balls) {
          var b = state.balls[uid];
          if (!b || b.holed || (state.flying && state.flying.uid === uid)) continue;
          this.drawBallAt(b, state.chars && state.chars[uid], uid === state.myUid);
        }
      }

      // flying ball
      if (state.flying) this.drawFlying(state.flying);
      if (state.splash) this.drawSplash(state.splash);
    }

    ctx.restore();
  };

  Renderer.prototype.drawWaves = function () {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
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

  Renderer.prototype.drawTee = function (tee) {
    var ctx = this.ctx;
    var s = this.toScreen(tee);
    var r = this.cam.scale;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 5 * r, 3 * r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d8e89a';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 4.2 * r, 2.4 * r, 0, 0, Math.PI * 2); ctx.fill();
  };

  Renderer.prototype.drawTree = function (t) {
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var r = t.r * this.cam.scale;
    if (t.kind === 'palm') return this.drawPalm(t, s, r);
    var col = TREE_COLS[t.kind] || TREE_COLS.g;
    // shadow
    ctx.fillStyle = PAL.treeShadow;
    ctx.beginPath(); ctx.ellipse(s.x - r * 0.5, s.y + r * 0.55, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    // canopy: cluster of circles
    ctx.fillStyle = col.base;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x - r * 0.55, s.y + r * 0.25, r * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + r * 0.55, s.y + r * 0.28, r * 0.58, 0, Math.PI * 2); ctx.fill();
    // highlight top
    ctx.fillStyle = col.top;
    ctx.beginPath(); ctx.arc(s.x + r * 0.18, s.y - r * 0.28, r * 0.62, 0, Math.PI * 2); ctx.fill();
  };

  Renderer.prototype.drawPalm = function (t, s, r) {
    var ctx = this.ctx;
    ctx.fillStyle = PAL.treeShadow;
    ctx.beginPath(); ctx.ellipse(s.x - r * 0.6, s.y + r * 0.5, r * 1.1, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    // trunk
    var topX = s.x + t.lean * r, topY = s.y - r * 1.5;
    ctx.strokeStyle = '#9a6b3f';
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + t.lean * r * 0.4, s.y - r, topX, topY);
    ctx.stroke();
    // fronds
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 + 0.4;
      var fx = Math.cos(a) * r * 1.15, fy = Math.sin(a) * r * 0.75;
      var grad = i % 2 ? '#3f9448' : '#5cb556';
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(2, r * 0.3);
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.quadraticCurveTo(topX + fx * 0.6, topY + fy * 0.6 - r * 0.35, topX + fx, topY + fy);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a4d2a';
    ctx.beginPath(); ctx.arc(topX, topY, r * 0.18, 0, Math.PI * 2); ctx.fill();
  };

  Renderer.prototype.drawRocks = function (cluster) {
    var ctx = this.ctx;
    for (var i = 0; i < cluster.pieces.length; i++) {
      var rk = cluster.pieces[i];
      var s = this.toScreen(rk);
      var r = rk.r * this.cam.scale;
      ctx.fillStyle = PAL.treeShadow;
      ctx.beginPath(); ctx.ellipse(s.x - r * 0.4, s.y + r * 0.4, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
      facet(ctx, s, r, rk.sides, rk.rot, '#cdd3da');
      facet(ctx, { x: s.x + r * 0.18, y: s.y - r * 0.22 }, r * 0.55, rk.sides, rk.rot + 0.5, '#e4e8ee');
      // moss
      ctx.fillStyle = 'rgba(122,167,84,0.75)';
      ctx.beginPath(); ctx.arc(s.x - r * 0.3, s.y - r * 0.45, r * 0.28, 0, Math.PI * 2); ctx.fill();
    }
    function facet(ctx, s, r, sides, rot, col) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (var j = 0; j < sides; j++) {
        var a = rot + (j / sides) * Math.PI * 2;
        var rr = r * (0.82 + 0.25 * Math.sin(j * 2.7 + rot * 5));
        var px = s.x + Math.cos(a) * rr, py = s.y + Math.sin(a) * rr * 0.85;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  };

  Renderer.prototype.drawPin = function (pin) {
    var ctx = this.ctx;
    var s = this.toScreen(pin);
    var r = this.cam.scale;
    // hole
    ctx.fillStyle = 'rgba(30,60,35,0.85)';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, 1.1 * r, 0.65 * r, 0, 0, Math.PI * 2); ctx.fill();
    // pole
    var top = s.y - 13 * r;
    ctx.strokeStyle = PAL.pinPole;
    ctx.lineWidth = Math.max(1.5, r * 0.5);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, top); ctx.stroke();
    // flag (waves gently)
    var wave = Math.sin(this.time / 300) * r;
    ctx.fillStyle = PAL.flag;
    ctx.beginPath();
    ctx.moveTo(s.x, top);
    ctx.lineTo(s.x + 6.5 * r, top + 1.8 * r + wave * 0.15);
    ctx.lineTo(s.x, top + 3.6 * r);
    ctx.closePath();
    ctx.fill();
  };

  Renderer.prototype.drawBallAt = function (b, char, isMe) {
    var ctx = this.ctx;
    var s = this.toScreen(b);
    var r = Math.max(2.5, this.cam.scale * 0.75);
    if (char) Character.draw(ctx, char, s.x - r * 3.2, s.y + r, Math.max(0.55, this.cam.scale / 7));
    ctx.fillStyle = 'rgba(40,70,40,0.35)';
    ctx.beginPath(); ctx.ellipse(s.x + r * 0.25, s.y + r * 0.35, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = isMe ? '#3f8fd2' : 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };

  Renderer.prototype.drawFlying = function (f) {
    var ctx = this.ctx;
    var s = this.toScreen(f);
    var lift = f.h * this.cam.scale * 0.55;
    var r = Math.max(2.5, this.cam.scale * 0.75) * (1 + f.h / 45);
    // shadow stays on the ground
    ctx.fillStyle = 'rgba(40,70,40,' + Math.max(0.08, 0.35 - f.h / 120) + ')';
    ctx.beginPath(); ctx.ellipse(s.x, s.y, r * 0.9, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(s.x, s.y - lift, r, 0, Math.PI * 2); ctx.fill();
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
    ctx.arc(s.x, s.y, (2 + age * 9) * this.cam.scale * 0.5, 0, Math.PI * 2);
    ctx.stroke();
  };

  Renderer.prototype.drawAim = function (aim) {
    var ctx = this.ctx;
    var from = this.toScreen(aim.from);
    var to = this.toScreen(aim.to);
    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.setLineDash([]);
    // landing ring
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(to.x, to.y, Math.max(6, this.cam.scale * 3.5), 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(to.x, to.y, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  };

  window.Renderer = Renderer;
})();
