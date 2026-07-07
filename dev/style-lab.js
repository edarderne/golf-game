// Style lab v2: experimental "low-poly diorama" look layered on the normal
// renderer. Prototype code — once approved it gets ported into js/render.js.
//
// Feedback incorporated in v2:
// - pines with separated, individually-shaded tiers
// - palms, deciduous trees and moai rebuilt in the same faceted language
// - ONE shadow system: shaped, elongated, all cast the same direction
// - animated water bands/ripples + depth ring so the island "sits" in it
// - colour balls → flowers; sand speckle; stumps/logs/dead trees/mushrooms
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var canvas = document.getElementById('course');
  var renderer = new Renderer(canvas);

  var LAB = {
    seaTop: '#87d4d2', seaBottom: '#2e91a2',
    foam: 'rgba(255,255,255,0.8)',
    sand: '#f0dfae', sandDot: 'rgba(150,120,60,0.18)', sandDotLight: 'rgba(255,250,225,0.5)',
    islandShadow: 'rgba(12,55,68,0.25)', depthRing: 'rgba(10,50,64,0.10)',
    rough: '#95be4f', fairway: '#b9d766',
    green: '#96da70', greenHi: '#bcec8e', greenLo: '#74c258', fringe: '#abe07c',
    bunker: '#f6e7bd', bunkerEdge: '#ddc28e',
    water: '#6fcbd6', waterEdge: 'rgba(255,255,255,0.55)',
    shadow: 'rgba(35,72,45,0.24)',
    trunk: '#8a5f38', trunkHi: '#a97e4e',
    patchLight: 'rgba(255,255,225,0.04)', patchDark: 'rgba(40,80,38,0.04)',
    rockLight: '#eae5db', rockMid: '#cec8be', rockDark: '#a9a298', rockDarker: '#8e877d',
  };

  var PINES = [
    { light: '#b8d95f', dark: '#5f8c33' },
    { light: '#a2ce58', dark: '#4c7f38' },
    { light: '#c6dc63', dark: '#74973a' },
  ];
  var LEAFY = {
    g:  { light: '#8cc95e', dark: '#4e8a3c' },
    g2: { light: '#74b854', dark: '#3d7538' },
    o:  { light: '#e8a94e', dark: '#a05f26' },
    y:  { light: '#d3c355', dark: '#8f822e' },
  };
  var BLADES = ['#86b34a', '#a3ca5d', '#729f3f'];
  var FLOWERS = {
    orange: '#f09a3e', yellow: '#ecd34f', pink: '#ef8ed0', cyan: '#66d3e2',
  };

  var styled = true;
  var view = 'overview';
  var seed = 20260707;
  var holeNew = null, holeOld = null;

  // shadow direction (screen space, down-right). One light source, always.
  var SH = { x: 0.86, y: 0.5 };

  function dropShadow(R, sx, sy, w, hgt) {
    var ctx = R.ctx;
    var t = R.cam.tilt + 0.25;
    var len = hgt * 0.5 + w * 0.3;
    var cx = sx + SH.x * len * 0.45;
    var cy = sy + SH.y * len * 0.45 * t;
    ctx.fillStyle = LAB.shadow;
    ctx.beginPath();
    ctx.ellipse(cx, cy, len * 0.55 + w * 0.3, Math.max(2, w * 0.42 * t), 0.32, 0, TAU);
    ctx.fill();
  }

  // ---------- hole build + decoration ----------

  function pickHole(s) {
    var c = Course.generate(s, 3);
    for (var i = 0; i < c.length; i++) if (c[i].par === 4) return c[i];
    return c[0];
  }

  function decorate(h, s) {
    var rng = RNG.make(RNG.mix(s, 777));
    h.trees.forEach(function (t) {
      if (t.kind === 'palm') return;
      if (rng.chance(0.6)) {
        t.kind = 'pine';
        t.tiers = t.r > 6.5 ? 4 : 3;
        t.pine = rng.int(0, PINES.length - 1);
        t.faces = rng.chance(0.55) ? 3 : 2; // some pines get a third facet
      } else {
        t.lobes = rng.int(3, 5); // deciduous variety
      }
    });
    h.rocks.forEach(function (cl) {
      cl.pieces.forEach(function (p) { p.r *= 1.45; });
      var big = cl.pieces[0];
      cl.pieces.push({ x: big.x + 1, y: big.y + 1, r: big.r * 0.4, sides: 6, rot: big.rot + 1.7, cap: true, capOf: big });
    });

    var b = h.bounds;
    function roughSpot(minFairwayGap) {
      for (var i = 0; i < 60; i++) {
        var p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
        if (Course.terrainAt(h, p) !== 'rough') continue;
        if (minFairwayGap && Course.distToPolyline(p, h.line) < h.fairwayW / 2 + minFairwayGap) continue;
        return p;
      }
      return null;
    }

    // tall grass in the rough + hugging rocks
    var added = 0, tries = 400;
    while (tries-- > 0 && added < 26) {
      var p = roughSpot(0);
      if (!p) break;
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

    // props from the reference pack: stumps, fallen logs, dead trees,
    // mushrooms, pebbles — all ride through tufts so they depth-sort
    var propCounts = [['stump', rng.int(1, 3)], ['log', rng.int(1, 2)], ['dead', rng.int(1, 2)], ['pebble', rng.int(2, 4)]];
    propCounts.forEach(function (pc) {
      for (var i = 0; i < pc[1]; i++) {
        var p = roughSpot(4);
        if (!p) return;
        h.tufts.push({ x: p.x, y: p.y, kind: pc[0], s: rng.range(0.9, 1.4), rot: rng.next() * TAU });
        if (pc[0] === 'stump' && rng.chance(0.7)) {
          h.tufts.push({ x: p.x + rng.range(2, 4), y: p.y - rng.range(1, 3), kind: 'shroom', s: rng.range(0.8, 1.2), rot: rng.next() * TAU });
        }
      }
    });

    // sand speckle (beach)
    h.sandDots = [];
    tries = 500;
    while (tries-- > 0 && h.sandDots.length < 70) {
      var sp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (Course.terrainAt(h, sp) !== 'sand') continue;
      h.sandDots.push({ x: sp.x, y: sp.y, r: rng.range(0.35, 0.8), light: rng.chance(0.3) });
    }
    // sand speckle (bunkers): same texture, sampled inside each bunker
    h.bunkerDots = [];
    h.bunkers.forEach(function (poly) {
      var bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      poly.forEach(function (p) {
        bb.minX = Math.min(bb.minX, p.x); bb.maxX = Math.max(bb.maxX, p.x);
        bb.minY = Math.min(bb.minY, p.y); bb.maxY = Math.max(bb.maxY, p.y);
      });
      var n = 0, guard = 80;
      while (guard-- > 0 && n < 9) {
        var dp = { x: rng.range(bb.minX, bb.maxX), y: rng.range(bb.minY, bb.maxY) };
        if (!Course.pointInPoly(dp, poly)) continue;
        h.bunkerDots.push({ x: dp.x, y: dp.y, r: rng.range(0.3, 0.6), light: rng.chance(0.3) });
        n++;
      }
    });

    // ground mottle
    h.patches = [];
    tries = 400;
    while (tries-- > 0 && h.patches.length < 54) {
      var pp = roughSpot(0);
      if (!pp) break;
      if (Course.dist(pp, h.green) < h.greenR + 10) continue;
      h.patches.push({ x: pp.x, y: pp.y, r: rng.range(2.5, 6), rot: rng.next() * TAU, light: rng.chance(0.5) });
    }
    return h;
  }

  function rebuild() {
    holeOld = pickHole(seed);
    holeNew = decorate(pickHole(seed), seed);
    Ambient.reset(holeNew);
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
    drawStatue: Renderer.prototype.drawStatue,
  };

  Renderer.prototype.draw = function (state) {
    if (!styled) return orig.draw.call(this, state);
    var ctx = this.ctx;
    this.resize();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.time = state.time || 0;

    // sea base
    var g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, LAB.seaTop);
    g.addColorStop(1, LAB.seaBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.drawSea();
    Ambient.drawSeaLife(this);

    if (state.hole) {
      this.drawGround(state.hole, state);
      Ambient.drawLand(this);
      this.drawEntities(state.hole, state);
    }
    Ambient.drawAir(this);

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
    if (!styled) return orig.drawGround.call(this, hole, state);
    var ctx = this.ctx;
    var sc = this.cam.scale;

    // depth ring: water darkens right around the island → it sits IN the sea
    ctx.strokeStyle = LAB.depthRing;
    ctx.lineWidth = sc * 16;
    this.blobPath(hole.beachPoly);
    ctx.stroke();
    ctx.lineWidth = sc * 7;
    this.blobPath(hole.beachPoly);
    ctx.stroke();

    // island drop shadow (down-right, same as every object)
    ctx.save();
    ctx.translate(SH.x * sc * 2.4, SH.y * sc * 2.4);
    this.blobPath(hole.beachPoly);
    ctx.fillStyle = LAB.islandShadow;
    ctx.fill();
    ctx.restore();

    // pulsing foam
    var pulse = 0.55 + Math.sin(this.time / 900) * 0.2;
    this.blobPath(hole.beachPoly);
    ctx.strokeStyle = 'rgba(255,255,255,' + pulse + ')';
    ctx.lineWidth = Math.max(2, sc * 2.2);
    ctx.stroke();
    this.blobPath(hole.beachPoly);
    ctx.strokeStyle = LAB.foam;
    ctx.lineWidth = Math.max(1.5, sc * 1.2);
    ctx.stroke();

    this.blobPath(hole.beachPoly);
    ctx.fillStyle = LAB.sand;
    ctx.fill();

    // sand speckle
    if (hole.sandDots) {
      for (var i = 0; i < hole.sandDots.length; i++) {
        var d = hole.sandDots[i];
        var ds = this.toScreen(d);
        ctx.fillStyle = d.light ? LAB.sandDotLight : LAB.sandDot;
        ctx.beginPath();
        ctx.arc(ds.x, ds.y, d.r * sc * 0.6, 0, TAU);
        ctx.fill();
      }
    }

    this.blobPath(hole.grassPoly);
    ctx.fillStyle = LAB.rough;
    ctx.fill();

    ctx.fillStyle = 'rgba(60,100,40,0.18)';
    for (i = 0; i < hole.tufts.length; i++) {
      var tf = hole.tufts[i];
      if (tf.kind !== 'grass') continue;
      var s = this.toScreen(tf);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.2 * tf.s * (sc / 4), 0, TAU);
      ctx.fill();
    }

    this.poly(hole.fairwayPoly);
    ctx.fillStyle = LAB.fairway;
    ctx.fill();

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

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    this.groundEllipse(hole.tee, 5);
    ctx.fill();
    ctx.fillStyle = '#dcea9e';
    this.groundEllipse(hole.tee, 4);
    ctx.fill();

    ctx.fillStyle = LAB.fringe;
    this.groundEllipse(hole.green, hole.greenR + 2.5);
    ctx.fill();
    var gc = this.toScreen(hole.green);
    var rpx = hole.greenR * sc;
    var slope = hole.greenSlope || { x: 0, y: 1 };
    var sDown = this.toScreen({ x: hole.green.x + slope.x * 100, y: hole.green.y + slope.y * 100 });
    var gdx = sDown.x - gc.x, gdy = sDown.y - gc.y;
    var gl = Math.sqrt(gdx * gdx + gdy * gdy) || 1;
    gdx /= gl; gdy /= gl;
    var grad = ctx.createLinearGradient(gc.x - gdx * rpx, gc.y - gdy * rpx, gc.x + gdx * rpx, gc.y + gdy * rpx);
    grad.addColorStop(0, LAB.greenHi);
    grad.addColorStop(1, LAB.greenLo);
    ctx.fillStyle = grad;
    this.groundEllipse(hole.green, hole.greenR);
    ctx.fill();
    this.drawSlopeArrows(hole, gdx, gdy);

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
    // bunker speckle (same grain as the beach)
    if (hole.bunkerDots) {
      for (i = 0; i < hole.bunkerDots.length; i++) {
        var bd = hole.bunkerDots[i];
        var bds = this.toScreen(bd);
        ctx.fillStyle = bd.light ? LAB.sandDotLight : LAB.sandDot;
        ctx.beginPath();
        ctx.arc(bds.x, bds.y, bd.r * sc * 0.6, 0, TAU);
        ctx.fill();
      }
    }
    // ponds: same treatment as the sea — deep centre, drifting ripples,
    // pulsing foam edge
    for (i = 0; i < hole.waters.length; i++) {
      var pond = hole.waters[i];
      this.blobPath(pond);
      ctx.fillStyle = LAB.water;
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
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      for (var k = 0; k < 3; k++) {
        var ph = this.time / (1400 + k * 350) + k * 2.1;
        var rx = pcs.x + Math.cos(ph) * prPx * 0.35;
        var ry = pcs.y + Math.sin(ph * 0.8) * prPx * 0.25;
        ctx.beginPath();
        ctx.arc(rx, ry, prPx * (0.16 + k * 0.09), Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      ctx.restore();
      this.blobPath(pond);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.4 + Math.sin(this.time / 900 + i) * 0.15) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (state.aim) this.drawAim(state.aim);
  };

  function polyCentroid(poly) {
    var cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) { cx += poly[i].x; cy += poly[i].y; }
    return { x: cx / poly.length, y: cy / poly.length };
  }

  // ---------- trees ----------

  Renderer.prototype.drawTree = function (t) {
    if (!styled) return orig.drawTree.call(this, t);
    if (t.kind === 'pine') return drawPine(this, t);
    if (t.kind === 'palm') return drawPalm(this, t);
    return drawLeafy(this, t);
  };

  // Pine: separated tiers, each with its own shade + a dark under-rim.
  function drawPine(R, t) {
    var ctx = R.ctx;
    var s = R.toScreen(t);
    var sc = R.cam.scale;
    var r = t.r * sc;
    var col = PINES[t.pine || 0];
    var tiers = t.tiers || 3;
    var height = r * (0.6 + tiers * 0.95);

    dropShadow(R, s.x, s.y, r * 1.7, height);

    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = Math.max(1.5, r * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x, s.y - r * 0.7);
    ctx.stroke();

    for (var i = 0; i < tiers; i++) {
      var f = i / tiers;
      var halfW = r * (1.05 - f * 0.68);
      var baseY = s.y - r * 0.55 - i * r * 0.82;
      var apexY = baseY - r * 1.45;
      var kinkY = baseY + r * 0.3;
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
      // optional third facet: a mid-tone centre wedge, offset toward the
      // light, rounds the tree out
      if ((t.faces || 2) >= 3) {
        var midTone = shade(mix(col.light, col.dark), f * 24);
        ctx.fillStyle = midTone;
        ctx.beginPath();
        ctx.moveTo(cx, apexY);
        ctx.lineTo(cx - halfW * 0.42, baseY + (kinkY - baseY) * 0.35);
        ctx.lineTo(cx, kinkY);
        ctx.lineTo(cx + halfW * 0.18, baseY + (kinkY - baseY) * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // midpoint of two #rrggbb colours (returns #rrggbb so shade() can use it)
  function mix(a, b) {
    var va = parseInt(a.slice(1), 16), vb = parseInt(b.slice(1), 16);
    var r = ((va >> 16) + (vb >> 16)) >> 1;
    var g = (((va >> 8) & 255) + ((vb >> 8) & 255)) >> 1;
    var bl = ((va & 255) + (vb & 255)) >> 1;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
  }

  // Deciduous: stacked faceted lobes over a visible trunk (reference img 3).
  function drawLeafy(R, t) {
    var ctx = R.ctx;
    var s = R.toScreen(t);
    var sc = R.cam.scale;
    var r = t.r * sc;
    var col = LEAFY[t.kind] || LEAFY.g;
    var lift = r * 1.15;

    dropShadow(R, s.x, s.y, r * 1.9, r * 2.1);

    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = Math.max(2, r * 0.24);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + r * 0.08, s.y - lift);
    ctx.stroke();

    // 3-5 lobes: wide at the bottom, tightening toward a lighter crown
    var rot = t.rot || 0;
    var lobes = t.lobes || 3;
    for (var i = 0; i < lobes; i++) {
      var f = lobes === 1 ? 1 : i / (lobes - 1);
      var ang = rot + i * 2.4;
      var lx = s.x + Math.cos(ang) * r * 0.55 * (1 - f * 0.75);
      var ly = s.y - lift - f * r * 0.85 + Math.sin(ang) * r * 0.12;
      var lr = r * (0.72 - f * 0.22);
      lobe(ctx, lx, ly, lr, rot + i * 1.3, col, -10 + f * 20);
    }
  }

  function lobe(ctx, cx, cy, r, rot, col, lightBoost) {
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
  }

  // Palm: faceted kite fronds, two-tone, coconuts, curved two-tone trunk.
  function drawPalm(R, t) {
    var ctx = R.ctx;
    var s = R.toScreen(t);
    var sc = R.cam.scale;
    var r = t.r * sc;
    var lean = t.lean || 0;
    var topX = s.x + lean * r;
    var topY = s.y - r * 2.3;

    dropShadow(R, s.x, s.y, r * 2, r * 2.3);

    // trunk with a lit edge
    ctx.lineCap = 'round';
    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = Math.max(2.5, r * 0.26);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + lean * r * 0.4, s.y - r * 1.4, topX, topY);
    ctx.stroke();
    ctx.strokeStyle = LAB.trunkHi;
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(s.x - r * 0.06, s.y);
    ctx.quadraticCurveTo(s.x + lean * r * 0.34, s.y - r * 1.4, topX - r * 0.05, topY);
    ctx.stroke();

    // fronds: kite shapes, light when facing up-left
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
      // spine
      ctx.strokeStyle = 'rgba(30,80,35,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
    // coconuts
    ctx.fillStyle = '#6b4423';
    ctx.beginPath(); ctx.arc(topX - r * 0.16, topY + r * 0.14, r * 0.14, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(topX + r * 0.12, topY + r * 0.18, r * 0.12, 0, TAU); ctx.fill();
  }

  // small colour utility: lighten (+) / darken (-) a #rrggbb by n
  function shade(hex, n) {
    var v = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, (v >> 16) + n));
    var g = Math.min(255, Math.max(0, ((v >> 8) & 255) + n));
    var b = Math.min(255, Math.max(0, (v & 255) + n));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // ---------- boulders ----------

  Renderer.prototype.drawRocks = function (cluster) {
    if (!styled) return orig.drawRocks.call(this, cluster);
    var self = this;
    var pieces = cluster.pieces.slice().sort(function (a, b) {
      if (!!a.cap !== !!b.cap) return a.cap ? 1 : -1;
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
    var cy = s.y - r * 0.62;
    if (rk.cap && rk.capOf) cy = s.y - rk.capOf.r * sc * 1.15;

    if (!rk.cap) dropShadow(R, s.x, s.y, r * 2, r * 1.3);

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

  // ---------- moai: three-plane sculpted head ----------

  Renderer.prototype.drawStatue = function (st) {
    if (!styled) return orig.drawStatue.call(this, st);
    var ctx = this.ctx;
    var s = this.toScreen(st);
    var sc = this.cam.scale;
    var w = st.s * sc;
    var hgt = w * (st.kind === 'moai' ? 3.1 : 2.5);
    var light = st.tint ? '#d5bd74' : '#c3cad2';
    var mid = st.tint ? '#b39a4e' : '#9aa3ad';
    var dark = st.tint ? '#8f7a3a' : '#747d88';
    var darker = st.tint ? '#6e5d2c' : '#5b636e';

    dropShadow(this, s.x, s.y, w * 2.1, hgt);

    if (st.kind === 'moai') {
      ctx.fillStyle = '#79b657';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, w * 1.75, w * 0.75 * (this.cam.tilt + 0.3), 0, 0, TAU);
      ctx.fill();
    }

    var top = s.y - hgt;
    var fw = w * 0.62;   // front face half-width
    var sw = w * 0.5;    // side face width

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

    // front face (lit)
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.moveTo(s.x - fw, s.y);
    ctx.lineTo(s.x - fw, top + w * 0.35);
    ctx.quadraticCurveTo(s.x - fw, top, s.x, top);
    ctx.quadraticCurveTo(s.x + fw, top + w * 0.06, s.x + fw, top + w * 0.32);
    ctx.lineTo(s.x + fw, s.y);
    ctx.closePath();
    ctx.fill();
    // left edge highlight
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
    ctx.fillRect(s.x - fw * 0.9, top + hgt * 0.22, fw * 1.8, Math.max(1.5, hgt * 0.075));
    ctx.fillStyle = shade(dark, -14);
    ctx.fillRect(s.x + fw, top + hgt * 0.24, sw * 0.8, Math.max(1, hgt * 0.05));

    // nose wedge: lit left edge, shaded right
    var nx = s.x - fw * 0.08, nw = fw * 0.36, ny = top + hgt * 0.27, nh = hgt * 0.34;
    ctx.fillStyle = light;
    ctx.fillRect(nx - nw * 0.5, ny, nw * 0.5, nh);
    ctx.fillStyle = darker;
    ctx.fillRect(nx, ny, nw * 0.5, nh);
    ctx.fillRect(nx - nw * 0.6, ny + nh, nw * 1.2, Math.max(1, hgt * 0.03));

    // eye sockets
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(s.x - fw * 0.72, top + hgt * 0.31, fw * 0.44, hgt * 0.09);
    ctx.fillRect(s.x + fw * 0.22, top + hgt * 0.31, fw * 0.44, hgt * 0.09);

    // mouth
    ctx.fillStyle = darker;
    ctx.fillRect(s.x - fw * 0.34, top + hgt * 0.74, fw * 0.68, Math.max(1, hgt * 0.045));

    // base pebbles + grass
    ctx.fillStyle = LAB.rockMid;
    ctx.beginPath(); ctx.ellipse(s.x - w * 0.9, s.y + w * 0.05, w * 0.28, w * 0.18, 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = LAB.rockDark;
    ctx.beginPath(); ctx.ellipse(s.x + w * 1.0, s.y + w * 0.12, w * 0.22, w * 0.14, -0.2, 0, TAU); ctx.fill();
  };

  // ---------- tufts: tall grass, flowers, props ----------

  Renderer.prototype.drawBush = function (tf) {
    if (!styled) return orig.drawBush.call(this, tf);
    if (tf.kind === 'tall') return drawTallGrass(this, tf);
    if (tf.kind === 'stump') return drawStump(this, tf);
    if (tf.kind === 'log') return drawLog(this, tf);
    if (tf.kind === 'dead') return drawDeadTree(this, tf);
    if (tf.kind === 'shroom') return drawShroom(this, tf);
    if (tf.kind === 'pebble') return drawPebbles(this, tf);
    return drawFlower(this, tf); // orange / yellow / pink / cyan
  };

  function drawTallGrass(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var h = tf.s * 3.6 * sc;
    for (var i = 0; i < 5; i++) {
      var off = (i - 2) * h * 0.2;
      var bend = Math.sin(tf.rot + i * 2.1) * h * 0.35 + sc * 0.1;
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

  function drawFlower(R, tf) {
    var col = FLOWERS[tf.kind];
    if (!col) return;
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var u = tf.s * sc * 0.55;
    // little leaf pair + two blossoms
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
        var a = tf.rot + (p / 5) * TAU;
        ctx.beginPath();
        ctx.arc(fx + Math.cos(a) * u * 0.42, fy + Math.sin(a) * u * 0.42, u * 0.3, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(fx, fy, u * 0.24, 0, TAU);
      ctx.fill();
    }
  }

  function drawStump(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var r = tf.s * 1.9 * sc;
    var h = r * 0.9;
    dropShadow(R, s.x, s.y, r * 2, h);
    // side
    ctx.fillStyle = LAB.trunk;
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
    // top with rings
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
  }

  function drawLog(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var L = tf.s * 6.5 * sc;
    var r = tf.s * 1.2 * sc;
    var a = tf.rot * 0.4 - 0.2;
    var dx = Math.cos(a), dy = Math.sin(a) * 0.5;
    var x2 = s.x + dx * L, y2 = s.y + dy * L;
    dropShadow(R, (s.x + x2) / 2, (s.y + y2) / 2, L * 0.9, r * 1.6);
    // body
    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = r * 2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(s.x, s.y - r); ctx.lineTo(x2, y2 - r); ctx.stroke();
    ctx.strokeStyle = LAB.trunkHi;
    ctx.lineWidth = r * 0.6;
    ctx.beginPath(); ctx.moveTo(s.x, s.y - r * 1.6); ctx.lineTo(x2, y2 - r * 1.6); ctx.stroke();
    // end ring
    ctx.fillStyle = '#d9b98a';
    ctx.beginPath();
    ctx.ellipse(x2, y2 - r, r * 0.62, r, -a * 0.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,77,42,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x2, y2 - r, r * 0.32, r * 0.5, -a * 0.5, 0, TAU);
    ctx.stroke();
    // branch nub
    ctx.strokeStyle = LAB.trunk;
    ctx.lineWidth = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(s.x + dx * L * 0.4, s.y + dy * L * 0.4 - r * 1.8);
    ctx.lineTo(s.x + dx * L * 0.4 + r * 0.8, s.y + dy * L * 0.4 - r * 2.8);
    ctx.stroke();
  }

  function drawDeadTree(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var h = tf.s * 8 * sc;
    dropShadow(R, s.x, s.y, h * 0.35, h);
    ctx.strokeStyle = '#7a5233';
    ctx.lineCap = 'round';
    var lean = Math.sin(tf.rot) * 0.25;
    branch(s.x, s.y, -Math.PI / 2 + lean, h * 0.62, Math.max(1.6, h * 0.07), 3);
    function branch(x, y, ang, len, wid, depth) {
      var nx = x + Math.cos(ang) * len;
      var ny = y + Math.sin(ang) * len;
      ctx.lineWidth = wid;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      if (depth <= 0) return;
      branch(nx, ny, ang - 0.55 - Math.sin(tf.rot + depth) * 0.15, len * 0.62, wid * 0.6, depth - 1);
      branch(nx, ny, ang + 0.5 + Math.cos(tf.rot * 2 + depth) * 0.15, len * 0.58, wid * 0.6, depth - 1);
    }
  }

  function drawShroom(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
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
  }

  function drawPebbles(R, tf) {
    var ctx = R.ctx;
    var s = R.toScreen(tf);
    var sc = R.cam.scale;
    var u = tf.s * 0.9 * sc;
    var cols = [LAB.rockMid, LAB.rockLight, LAB.rockDark];
    for (var i = 0; i < 3; i++) {
      var x = s.x + Math.cos(tf.rot + i * 2.2) * u * 1.1;
      var y = s.y + Math.sin(tf.rot + i * 2.2) * u * 0.5;
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
  }

  // ---------- ambient wildlife ----------
  // Visual-only life: birds overhead, fish jumping in the sea, ducks on
  // water hazards, a turtle on the beach, a deer at the treeline.

  var Ambient = {
    birds: null, birdTimer: 4000,
    fish: null, fishTimer: 3000, splashes: [],
    ducks: [],
    turtle: null,
    deer: null, deerTimer: 7000,

    reset: function (h) {
      this.birds = null; this.fish = null; this.deer = null;
      this.splashes = [];
      this.ducks = [];
      var self = this;
      h.waters.forEach(function (pond) {
        var c = polyCentroid(pond);
        for (var i = 0; i < 2; i++) {
          self.ducks.push({
            pond: pond, cx: c.x, cy: c.y,
            x: c.x + (Math.random() - 0.5) * 6, y: c.y + (Math.random() - 0.5) * 6,
            heading: Math.random() * TAU, phase: Math.random() * TAU,
          });
        }
      });
      // one slow turtle somewhere on the beach
      var b = h.bounds;
      for (var t = 0; t < 80; t++) {
        var p = { x: b.minX + Math.random() * (b.maxX - b.minX), y: b.minY + Math.random() * (b.maxY - b.minY) };
        if (Course.terrainAt(h, p) === 'sand') {
          this.turtle = { x: p.x, y: p.y, heading: Math.random() * TAU, phase: 0 };
          break;
        }
      }
    },

    update: function (dt, h, R) {
      var sec = dt / 1000;

      // birds (screen space)
      if (this.birds) {
        this.birds.x += this.birds.vx * sec;
        if (this.birds.x < -80 || this.birds.x > R.w + 80) this.birds = null;
      } else if ((this.birdTimer -= dt) < 0) {
        this.birdTimer = 9000 + Math.random() * 7000;
        var ltr = Math.random() < 0.5;
        this.birds = {
          x: ltr ? -60 : R.w + 60, y: R.h * (0.08 + Math.random() * 0.3),
          vx: (ltr ? 1 : -1) * (50 + Math.random() * 25),
          n: 2 + Math.floor(Math.random() * 3), phase: Math.random() * TAU,
        };
      }

      // fish (world space, in open sea)
      if (this.fish) {
        this.fish.t += sec / 1.15;
        if (this.fish.t >= 1) {
          this.splashes.push({ x: this.fish.x2, y: this.fish.y2, t0: performance.now() });
          this.fish = null;
        }
      } else if ((this.fishTimer -= dt) < 0) {
        this.fishTimer = 7000 + Math.random() * 6000;
        var spot = seaSpot(h);
        if (spot) {
          var a = Math.random() * TAU;
          this.fish = {
            x1: spot.x, y1: spot.y,
            x2: spot.x + Math.cos(a) * 4, y2: spot.y + Math.sin(a) * 4,
            t: 0,
          };
          this.splashes.push({ x: spot.x, y: spot.y, t0: performance.now() });
        }
      }

      // ducks paddle, wander, stay on their pond
      this.ducks.forEach(function (d) {
        d.heading += (Math.random() - 0.5) * 1.6 * sec;
        var nx = d.x + Math.sin(d.heading) * 0.55 * sec;
        var ny = d.y + Math.cos(d.heading) * 0.55 * sec;
        if (Course.pointInPoly({ x: nx, y: ny }, d.pond)) { d.x = nx; d.y = ny; }
        else d.heading = Math.atan2(d.cx - d.x, d.cy - d.y);
      });

      // turtle inches along the beach
      if (this.turtle) {
        var tu = this.turtle;
        tu.phase += sec * 2;
        var tnx = tu.x + Math.sin(tu.heading) * 0.14 * sec;
        var tny = tu.y + Math.cos(tu.heading) * 0.14 * sec;
        if (Course.terrainAt(h, { x: tnx, y: tny }) === 'sand') { tu.x = tnx; tu.y = tny; }
        else tu.heading += 1.4;
      }

      // deer: appears near trees, grazes, slips away
      if (this.deer) {
        this.deer.age += dt;
        if (this.deer.age > this.deer.life) this.deer = null;
      } else if ((this.deerTimer -= dt) < 0) {
        this.deerTimer = 14000 + Math.random() * 10000;
        var trees = h.trees.filter(function (t) { return t.kind !== 'palm'; });
        if (trees.length) {
          var tr = trees[Math.floor(Math.random() * trees.length)];
          var dp = { x: tr.x + 2.5, y: tr.y + 2 };
          if (Course.terrainAt(h, dp) === 'rough') {
            this.deer = { x: dp.x, y: dp.y, flip: Math.random() < 0.5 ? 1 : -1, age: 0, life: 6500 + Math.random() * 3000, phase: Math.random() * TAU };
          }
        }
      }
    },

    // fish + splash rings (drawn between sea and island)
    drawSeaLife: function (R) {
      var ctx = R.ctx;
      if (this.fish) {
        var f = this.fish;
        var p = f.t;
        var x = f.x1 + (f.x2 - f.x1) * p;
        var y = f.y1 + (f.y2 - f.y1) * p;
        var s = R.toScreen({ x: x, y: y });
        var hgt = Math.sin(Math.PI * p) * 2.4 * R.cam.scale;
        var ang = Math.atan2(f.x2 - f.x1, -(f.y2 - f.y1)) + (p < 0.5 ? -0.9 : 0.9);
        var u = R.cam.scale * 0.9;
        ctx.save();
        ctx.translate(s.x, s.y - hgt);
        ctx.rotate(ang);
        ctx.fillStyle = '#9fcfdd';
        ctx.beginPath();
        ctx.moveTo(0, -u * 1.1);
        ctx.quadraticCurveTo(u * 0.55, 0, u * 0.22, u * 0.8);
        ctx.lineTo(-u * 0.22, u * 1.2);
        ctx.lineTo(-u * 0.5, u * 0.7);
        ctx.quadraticCurveTo(-u * 0.4, -u * 0.3, 0, -u * 1.1);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      var now = performance.now();
      this.splashes = this.splashes.filter(function (sp) { return now - sp.t0 < 900; });
      for (var i = 0; i < this.splashes.length; i++) {
        var sp = this.splashes[i];
        var age = (now - sp.t0) / 900;
        var ss = R.toScreen(sp);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.65 * (1 - age)) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(ss.x, ss.y, (1 + age * 4) * R.cam.scale * 0.6,
          (1 + age * 4) * R.cam.scale * 0.6 * R.cam.tilt, 0, 0, TAU);
        ctx.stroke();
      }
    },

    // ducks, turtle, deer (drawn after ground, before trees → deer can
    // stand behind trees)
    drawLand: function (R) {
      var ctx = R.ctx;
      var sc = R.cam.scale;

      this.ducks.forEach(function (d) {
        var s = R.toScreen(d);
        var u = sc * 0.8;
        var bob = Math.sin(performance.now() / 600 + d.phase) * u * 0.12;
        var dir = Math.sin(d.heading) >= 0 ? 1 : -1;
        // wake
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - dir * u * 1.2, s.y + u * 0.35);
        ctx.lineTo(s.x - dir * u * 2.4, s.y + u * 0.7);
        ctx.moveTo(s.x - dir * u * 1.2, s.y - u * 0.05);
        ctx.lineTo(s.x - dir * u * 2.4, s.y - u * 0.35);
        ctx.stroke();
        // body + mallard head
        ctx.fillStyle = '#9c7c50';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + bob, u * 1.05, u * 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fdf8ec';
        ctx.beginPath();
        ctx.arc(s.x + dir * u * 0.75, s.y - u * 0.5 + bob, u * 0.3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2e7d4f';
        ctx.beginPath();
        ctx.arc(s.x + dir * u * 0.85, s.y - u * 0.62 + bob, u * 0.34, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#e8b93d';
        ctx.beginPath();
        ctx.moveTo(s.x + dir * u * 1.15, s.y - u * 0.62 + bob);
        ctx.lineTo(s.x + dir * u * 1.55, s.y - u * 0.52 + bob);
        ctx.lineTo(s.x + dir * u * 1.12, s.y - u * 0.42 + bob);
        ctx.closePath();
        ctx.fill();
      });

      if (this.turtle) {
        var tu = this.turtle;
        var s = R.toScreen(tu);
        var u = sc * 0.7;
        var step = Math.sin(tu.phase) * u * 0.1;
        var dir = Math.sin(tu.heading) >= 0 ? 1 : -1;
        ctx.fillStyle = 'rgba(120,100,60,0.3)';
        ctx.beginPath();
        ctx.ellipse(s.x + u * 0.3, s.y + u * 0.15, u * 1.2, u * 0.5, 0, 0, TAU);
        ctx.fill();
        // flippers
        ctx.fillStyle = '#5f8f4a';
        [[-0.9, -0.35], [0.7, -0.4], [-0.85, 0.4], [0.75, 0.42]].forEach(function (fp, i) {
          ctx.beginPath();
          ctx.ellipse(s.x + fp[0] * u + (i % 2 ? step : -step), s.y + fp[1] * u, u * 0.32, u * 0.16, fp[0], 0, TAU);
          ctx.fill();
        });
        // head
        ctx.beginPath();
        ctx.arc(s.x + dir * u * 1.1, s.y - u * 0.15, u * 0.26, 0, TAU);
        ctx.fill();
        // shell: dark rim + lighter faceted top
        ctx.fillStyle = '#4a7a3e';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y - u * 0.15, u * 0.95, u * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#6faf56';
        ctx.beginPath();
        ctx.moveTo(s.x - u * 0.55, s.y - u * 0.25);
        ctx.lineTo(s.x - u * 0.1, s.y - u * 0.72);
        ctx.lineTo(s.x + u * 0.5, s.y - u * 0.55);
        ctx.lineTo(s.x + u * 0.6, s.y - u * 0.05);
        ctx.lineTo(s.x, s.y + u * 0.2);
        ctx.closePath();
        ctx.fill();
      }

      if (this.deer) {
        var de = this.deer;
        var s = R.toScreen(de);
        var u = sc * 0.85;
        var fade = Math.min(1, de.age / 400, (de.life - de.age) / 400);
        var graze = Math.max(0, Math.sin(de.age / 1200 + de.phase)) * u * 0.55;
        var f = de.flip;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        dropShadow(R, s.x, s.y, u * 2.4, u * 1.5);
        // legs
        ctx.strokeStyle = '#8a6238';
        ctx.lineWidth = Math.max(1.2, u * 0.16);
        [[-0.8, -0.55], [-0.35, -0.6], [0.35, -0.58], [0.8, -0.5]].forEach(function (lg) {
          ctx.beginPath();
          ctx.moveTo(s.x + lg[0] * u * f, s.y - u * 1.1);
          ctx.lineTo(s.x + (lg[0] + lg[1] * 0.06) * u * f, s.y);
          ctx.stroke();
        });
        // body
        ctx.fillStyle = '#a9743f';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y - u * 1.35, u * 1.15, u * 0.62, 0, 0, TAU);
        ctx.fill();
        // neck + head (dips to graze)
        var hx = s.x + f * u * 1.35, hy = s.y - u * 2.1 + graze;
        ctx.beginPath();
        ctx.moveTo(s.x + f * u * 0.7, s.y - u * 1.6);
        ctx.lineTo(hx - f * u * 0.15, hy);
        ctx.lineTo(hx + f * u * 0.1, hy + u * 0.3);
        ctx.lineTo(s.x + f * u * 0.85, s.y - u * 1.05);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hx, hy, u * 0.38, u * 0.26, f * 0.4, 0, TAU);
        ctx.fill();
        // ears + tail
        ctx.beginPath();
        ctx.ellipse(hx - f * u * 0.25, hy - u * 0.3, u * 0.2, u * 0.09, f * 0.9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#f4ead6';
        ctx.beginPath();
        ctx.arc(s.x - f * u * 1.1, s.y - u * 1.5, u * 0.16, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    },

    // birds (screen space, above everything)
    drawAir: function (R) {
      if (!this.birds) return;
      var ctx = R.ctx;
      var bd = this.birds;
      var now = performance.now();
      ctx.strokeStyle = 'rgba(40,60,72,0.75)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (var i = 0; i < bd.n; i++) {
        var bx = bd.x - i * 26 * Math.sign(bd.vx) + Math.sin(bd.phase + i * 2) * 8;
        var by = bd.y + (i % 2) * 14 + Math.sin(now / 900 + i) * 4;
        var flap = Math.sin(now / 140 + bd.phase + i * 1.4) * 0.55;
        var w = 8;
        ctx.beginPath();
        ctx.moveTo(bx - w, by - w * (0.55 - flap));
        ctx.quadraticCurveTo(bx - w * 0.3, by + w * flap * 0.6, bx, by);
        ctx.quadraticCurveTo(bx + w * 0.3, by + w * flap * 0.6, bx + w, by - w * (0.55 - flap));
        ctx.stroke();
      }
    },
  };

  // spot in open sea, comfortably clear of the island
  function seaSpot(h) {
    var b = h.bounds;
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    var rad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.5;
    for (var i = 0; i < 30; i++) {
      var a = Math.random() * TAU;
      var d = rad + 14 + Math.random() * 22;
      var p = { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
      if (!Course.pointInPoly(p, h.beachPoly)) return p;
    }
    return null;
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
    if (styled) Ambient.update(dt, h, renderer);
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
