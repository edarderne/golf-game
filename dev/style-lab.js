// Style lab: experimental "low-poly diorama" look layered on the normal
// renderer. Everything here is prototype code — once the look is approved
// it gets ported into js/render.js for the real game.
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var canvas = document.getElementById('course');
  var renderer = new Renderer(canvas);

  // Consistent light from the TOP-LEFT: highlights up-left, shadows
  // cast down-right. This is the biggest "3D feel" change.
  var LAB = {
    seaTop: '#83d2d0', seaBottom: '#2b8ea0',
    foam: 'rgba(255,255,255,0.75)',
    sand: '#f0ddA6', islandShadow: 'rgba(15,60,70,0.22)',
    rough: '#93bd4d', fairway: '#b7d765',
    green: '#96da70', greenHi: '#bcec8e', greenLo: '#74c258', fringe: '#abe07c',
    bunker: '#f6e7bd', bunkerEdge: '#ddc28e',
    water: '#6fcbd6', waterEdge: 'rgba(255,255,255,0.55)',
    shadow: 'rgba(38,76,48,0.26)',
    trunk: '#8a5f38',
    patchLight: 'rgba(255,255,225,0.04)', patchDark: 'rgba(40,80,38,0.04)',
    rockLight: '#e9e4da', rockMid: '#cdc7bd', rockDark: '#aaa399', rockDarker: '#8f887e',
    pinPole: '#f6f6f2', flag: '#e6543f',
  };

  // two pine colourways + blade greens for tall grass
  var PINES = [
    { light: '#b8d95f', dark: '#5f8c33' },
    { light: '#a2ce58', dark: '#4c7f38' },
    { light: '#c6dc63', dark: '#74973a' },
  ];
  var BLADES = ['#86b34a', '#a3ca5d', '#729f3f'];

  var styled = true;
  var view = 'overview';
  var seed = 20260707;
  var holeNew = null, holeOld = null;

  // ---------- hole build + decoration ----------

  function pickHole(s) {
    var c = Course.generate(s, 3);
    for (var i = 0; i < c.length; i++) if (c[i].par === 4) return c[i];
    return c[0];
  }

  function decorate(h, s) {
    var rng = RNG.make(RNG.mix(s, 777));
    // ~2/3 of leafy trees become layered pines (palms stay palms)
    h.trees.forEach(function (t) {
      if (t.kind !== 'palm' && rng.chance(0.66)) {
        t.kind = 'pine';
        t.tiers = t.r > 6.5 ? 3 : 2;
        t.pine = rng.int(0, PINES.length - 1);
      }
    });
    // bigger, chunkier boulders
    h.rocks.forEach(function (cl) {
      cl.pieces.forEach(function (p) { p.r *= 1.45; });
      // little capstone lump like the reference photos
      var big = cl.pieces[0];
      cl.pieces.push({ x: big.x + 1, y: big.y + 1, r: big.r * 0.4, sides: 6, rot: big.rot + 1.7, cap: true, capOf: big });
    });
    // tall grass: scattered in the rough + hugging rocks and trees
    var tries = 400, added = 0;
    var b = h.bounds;
    while (tries-- > 0 && added < 26) {
      var p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (Course.terrainAt(h, p) !== 'rough') continue;
      h.tufts.push({ x: p.x, y: p.y, kind: 'tall', s: rng.range(0.8, 1.5), rot: rng.next() * TAU });
      added++;
    }
    h.rocks.forEach(function (cl) {
      for (var i = 0; i < 3; i++) {
        var a = rng.next() * TAU;
        var d = rng.range(6, 11);
        var p = { x: cl.x + Math.cos(a) * d, y: cl.y + Math.sin(a) * d };
        if (Course.terrainAt(h, p) === 'rough') {
          h.tufts.push({ x: p.x, y: p.y, kind: 'tall', s: rng.range(1, 1.6), rot: rng.next() * TAU });
        }
      }
    });
    // subtle low-poly tone patches on the grass
    h.patches = [];
    tries = 400;
    while (tries-- > 0 && h.patches.length < 54) {
      var pp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      var terr = Course.terrainAt(h, pp);
      if (terr !== 'rough') continue; // keep the fairway clean
      if (Course.dist(pp, h.green) < h.greenR + 10) continue;
      h.patches.push({
        x: pp.x, y: pp.y, r: rng.range(2.5, 6), rot: rng.next() * TAU,
        light: rng.chance(0.5),
      });
    }
    return h;
  }

  function rebuild() {
    holeOld = pickHole(seed);
    holeNew = decorate(pickHole(seed), seed);
    fitView(true);
  }

  function hole() { return styled ? holeNew : holeOld; }

  // ---------- renderer overrides ----------

  var orig = {
    draw: Renderer.prototype.draw,
    drawGround: Renderer.prototype.drawGround,
    drawTree: Renderer.prototype.drawTree,
    drawRocks: Renderer.prototype.drawRocks,
    drawBush: Renderer.prototype.drawBush,
    drawPin: Renderer.prototype.drawPin,
  };

  Renderer.prototype.draw = function (state) {
    if (!styled) return orig.draw.call(this, state);
    var ctx = this.ctx;
    this.resize();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.time = state.time || 0;

    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, LAB.seaTop);
    g.addColorStop(1, LAB.seaBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawWaves();

    if (state.hole) {
      this.drawGround(state.hole, state);
      this.drawEntities(state.hole, state);
    }

    // global sunlight: warm glow from the top-left, cool falloff bottom-right
    var sun = ctx.createLinearGradient(0, 0, this.w, this.h);
    sun.addColorStop(0, 'rgba(255,248,214,0.07)');
    sun.addColorStop(0.5, 'rgba(255,255,255,0)');
    sun.addColorStop(1, 'rgba(24,50,80,0.05)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  };

  Renderer.prototype.drawGround = function (hole, state) {
    if (!styled) return orig.drawGround.call(this, hole, state);
    var ctx = this.ctx;
    var sc = this.cam.scale;

    // island drop shadow in the sea (sun top-left → shadow bottom-right)
    ctx.save();
    ctx.translate(sc * 1.6, sc * 2.1);
    this.blobPath(hole.beachPoly);
    ctx.fillStyle = LAB.islandShadow;
    ctx.fill();
    ctx.restore();

    this.blobPath(hole.beachPoly);
    ctx.strokeStyle = LAB.foam;
    ctx.lineWidth = Math.max(2, sc * 1.6);
    ctx.stroke();
    this.blobPath(hole.beachPoly);
    ctx.fillStyle = LAB.sand;
    ctx.fill();
    this.blobPath(hole.grassPoly);
    ctx.fillStyle = LAB.rough;
    ctx.fill();

    // rough dots
    ctx.fillStyle = 'rgba(60,100,40,0.18)';
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
    ctx.fillStyle = LAB.fairway;
    ctx.fill();

    // low-poly tone patches (subtle triangular mottle)
    if (hole.patches) {
      for (i = 0; i < hole.patches.length; i++) {
        var pa = hole.patches[i];
        ctx.fillStyle = pa.light ? LAB.patchLight : LAB.patchDark;
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

    // green with slope shading
    ctx.fillStyle = LAB.fringe;
    this.groundEllipse(hole.green, hole.greenR + 2.5);
    ctx.fill();
    var gc = this.toScreen(hole.green);
    var rpx = hole.greenR * sc;
    var slope = hole.greenSlope || { x: 0, y: 1 };
    var sHere = this.toScreen(hole.green);
    var sDown = this.toScreen({ x: hole.green.x + slope.x * 100, y: hole.green.y + slope.y * 100 });
    var gdx = sDown.x - sHere.x, gdy = sDown.y - sHere.y;
    var gl = Math.sqrt(gdx * gdx + gdy * gdy) || 1;
    gdx /= gl; gdy /= gl;
    var grad = ctx.createLinearGradient(gc.x - gdx * rpx, gc.y - gdy * rpx, gc.x + gdx * rpx, gc.y + gdy * rpx);
    grad.addColorStop(0, LAB.greenHi);
    grad.addColorStop(1, LAB.greenLo);
    ctx.fillStyle = grad;
    this.groundEllipse(hole.green, hole.greenR);
    ctx.fill();
    this.drawSlopeArrows(hole, gdx, gdy);

    // bunkers with a soft inner lip
    for (i = 0; i < hole.bunkers.length; i++) {
      this.blobPath(hole.bunkers[i]);
      ctx.fillStyle = LAB.bunkerEdge;
      ctx.fill();
      ctx.save();
      ctx.translate(-sc * 0.5, -sc * 0.7);
      this.blobPath(hole.bunkers[i]);
      ctx.fillStyle = LAB.bunker;
      ctx.fill();
      ctx.restore();
    }
    for (i = 0; i < hole.waters.length; i++) {
      this.blobPath(hole.waters[i]);
      ctx.fillStyle = LAB.water;
      ctx.fill();
      this.blobPath(hole.waters[i]);
      ctx.strokeStyle = LAB.waterEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (state.aim) this.drawAim(state.aim);
  };

  // ----- layered paper-fold pine -----

  Renderer.prototype.drawTree = function (t) {
    if (!styled || t.kind !== 'pine') return orig.drawTree.call(this, t);
    var ctx = this.ctx;
    var s = this.toScreen(t);
    var sc = this.cam.scale;
    var r = t.r * sc;
    var col = PINES[t.pine || 0];

    // shadow (down-right)
    ctx.fillStyle = LAB.shadow;
    ctx.beginPath();
    ctx.ellipse(s.x + r * 0.5, s.y + r * 0.16, r * 1.05, r * 0.4 * (this.cam.tilt + 0.3), 0, 0, TAU);
    ctx.fill();

    // trunk
    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y - r * 0.7);
    ctx.stroke();

    // tiers, bottom to top; each tier is two flat-shaded faces with a
    // V-shaped underside kink — the folded-paper look from the reference
    var tiers = t.tiers || 2;
    for (var i = 0; i < tiers; i++) {
      var halfW = r * (1.0 - i * (0.62 / tiers));
      var baseY = s.y - r * 0.6 - i * r * 0.92;
      var apexY = baseY - r * 1.55;
      var kinkY = baseY + r * 0.28;
      // left (lit) face
      ctx.fillStyle = col.light;
      ctx.beginPath();
      ctx.moveTo(s.x, apexY);
      ctx.lineTo(s.x - halfW, baseY);
      ctx.lineTo(s.x, kinkY);
      ctx.closePath();
      ctx.fill();
      // right (shaded) face
      ctx.fillStyle = col.dark;
      ctx.beginPath();
      ctx.moveTo(s.x, apexY);
      ctx.lineTo(s.x + halfW, baseY);
      ctx.lineTo(s.x, kinkY);
      ctx.closePath();
      ctx.fill();
    }
  };

  // ----- faceted boulders -----

  Renderer.prototype.drawRocks = function (cluster) {
    if (!styled) return orig.drawRocks.call(this, cluster);
    var self = this;
    var pieces = cluster.pieces.slice().sort(function (a, b) {
      if (!!a.cap !== !!b.cap) return a.cap ? 1 : -1; // capstones on top
      return b.y - a.y;
    });
    pieces.forEach(function (rk) { drawBoulder(self, rk); });
  };

  function drawBoulder(R, rk) {
    var ctx = R.ctx;
    var s = R.toScreen(rk);
    var sc = R.cam.scale;
    var r = rk.r * sc;
    var rng = RNG.make(RNG.mix((rk.x * 97) | 0, ((rk.y * 131) | 0) + (rk.sides || 6)));

    var cy = s.y - r * 0.62;                    // lump centre raised off ground
    if (rk.cap && rk.capOf) {                   // capstone rides on its parent
      cy = s.y - rk.capOf.r * sc * 1.15;
    }

    if (!rk.cap) {
      ctx.fillStyle = LAB.shadow;
      ctx.beginPath();
      ctx.ellipse(s.x + r * 0.42, s.y + r * 0.12, r * 1.08, r * 0.42 * (R.cam.tilt + 0.3), 0, 0, TAU);
      ctx.fill();
    }

    // irregular outline
    var n = 7;
    var verts = [];
    var rot = rk.rot || 0;
    for (var i = 0; i < n; i++) {
      var a = rot + (i / n) * TAU;
      var rr = r * (0.78 + rng.next() * 0.3);
      verts.push({ x: s.x + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.82 });
    }

    // interior "peak" pulled toward the light for convincing facets
    var peak = { x: s.x - r * 0.18, y: cy - r * 0.22 };

    for (i = 0; i < n; i++) {
      var v1 = verts[i], v2 = verts[(i + 1) % n];
      var mx = (v1.x + v2.x) / 2 - s.x;
      var my = (v1.y + v2.y) / 2 - cy;
      // facet brightness from its facing vs the top-left light
      var facing = (-mx - my * 1.2) / r;
      ctx.fillStyle = facing > 0.45 ? LAB.rockLight
        : facing > -0.25 ? LAB.rockMid
        : facing > -0.8 ? LAB.rockDark : LAB.rockDarker;
      ctx.beginPath();
      ctx.moveTo(peak.x, peak.y);
      ctx.lineTo(v1.x, v1.y);
      ctx.lineTo(v2.x, v2.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ----- tall grass -----

  Renderer.prototype.drawBush = function (tf) {
    if (!styled || tf.kind !== 'tall') return orig.drawBush.call(this, tf);
    var ctx = this.ctx;
    var s = this.toScreen(tf);
    var sc = this.cam.scale;
    var h = tf.s * 3.6 * sc;
    var blades = 5;
    for (var i = 0; i < blades; i++) {
      var off = (i - (blades - 1) / 2) * h * 0.2;
      var bend = Math.sin(tf.rot + i * 2.1) * h * 0.35 + this.cam.scale * 0.1;
      var bh = h * (0.6 + 0.4 * Math.sin(tf.rot * 3 + i));
      ctx.fillStyle = BLADES[(i + Math.floor(tf.rot * 7)) % BLADES.length];
      ctx.beginPath();
      ctx.moveTo(s.x + off - h * 0.09, s.y);
      ctx.lineTo(s.x + off + h * 0.09, s.y);
      ctx.lineTo(s.x + off + bend, s.y - bh);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ---------- lab page plumbing ----------

  function fitView(snap) {
    var h = hole();
    if (!h) return;
    if (view === 'overview') {
      renderer.fitBounds(h.bounds, 4);
    } else {
      var aim = Math.atan2(h.pin.x - h.tee.x, h.pin.y - h.tee.y);
      renderer.fitShot(h.tee, aim, Math.min(h.length * 0.8, 260));
    }
    if (snap) renderer.snapCamera();
  }

  var last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(100, now - last);
    last = now;
    fitView(false);
    renderer.tickCamera(dt);
    var h = hole();
    renderer.draw({
      hole: h,
      time: now,
      balls: { p1: { x: h.tee.x, y: h.tee.y, lie: 'tee', strokes: 0 } },
      myUid: null,
    });
  }

  document.getElementById('btn-view').addEventListener('click', function () {
    view = view === 'overview' ? 'iso' : 'overview';
    this.textContent = 'View: ' + view;
    fitView(false);
  });
  document.getElementById('btn-seed').addEventListener('click', function () {
    seed = RNG.newSeed();
    rebuild();
  });
  document.getElementById('btn-style').addEventListener('click', function () {
    styled = !styled;
    this.textContent = 'Style: ' + (styled ? 'NEW' : 'OLD');
  });

  rebuild();
  requestAnimationFrame(frame);
})();
