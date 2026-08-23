// Procedural hole generation. All distances are in yards; the world is laid
// out with the tee near the origin and the green up in +y. Everything is
// derived from the room seed so both players build identical holes.
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  // ---------- geometry helpers ----------

  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

  function pointInPoly(p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if ((yi > p.y) !== (yj > p.y) &&
          p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distToPolyline(p, pts) {
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      best = Math.min(best, distToSeg(p, pts[i], pts[i + 1]));
    }
    return best;
  }

  function distToSeg(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var wx = p.x - a.x, wy = p.y - a.y;
    var len2 = vx * vx + vy * vy || 1e-9;
    var t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
    var dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Quadratic bezier sampling for the hole centerline.
  function bezier(a, c, b, t) {
    var mt = 1 - t;
    return {
      x: mt * mt * a.x + 2 * mt * t * c.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * c.y + t * t * b.y,
    };
  }

  // Cubic Bézier — used for the dogleg centerline (a double control at the
  // corner keeps the two legs straight and the turn tight).
  function cubic(p0, c1, c2, p3, t) {
    var mt = 1 - t, a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    return {
      x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
      y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
    };
  }

  // Blobby circle polygon (used for ponds and bunkers).
  function blob(rng, cx, cy, r, wobble, n) {
    var pts = [];
    var phase = rng.next() * TAU;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      var rr = r * (1 + wobble * Math.sin(a * 3 + phase) * 0.5 + wobble * (rng.next() - 0.5));
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    return pts;
  }

  // Elliptical blob: like blob() but with independent radii + a rotation, so
  // greens can be ovals and ponds can be long lakes, not only circles. rx is
  // the radius along the local x-axis (which is rotated to `ang`).
  function ellipseBlob(rng, cx, cy, rx, ry, ang, wobble, n) {
    var pts = [];
    var phase = rng.next() * TAU;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      var w = 1 + wobble * Math.sin(a * 3 + phase) * 0.5 + wobble * (rng.next() - 0.5);
      var ex = Math.cos(a) * rx * w, ey = Math.sin(a) * ry * w;
      pts.push({ x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca });
    }
    return pts;
  }

  // Crescent pond: an annular sector hugging the OUTSIDE of the green from
  // angle a0 over `sweep` radians (a quarter/third/half wrap).
  function arcPond(rng, cx, cy, innerR, thick, a0, sweep, n) {
    var steps = Math.max(6, Math.round(n * sweep / TAU));
    var phase = rng.next() * TAU;
    var outer = [], inner = [];
    for (var i = 0; i <= steps; i++) {
      var a = a0 + sweep * (i / steps);
      var wob = 1 + 0.1 * Math.sin(a * 4 + phase);
      outer.push({ x: cx + Math.cos(a) * (innerR + thick * wob), y: cy + Math.sin(a) * (innerR + thick * wob) });
      inner.push({ x: cx + Math.cos(a) * innerR, y: cy + Math.sin(a) * innerR });
    }
    return outer.concat(inner.reverse());
  }

  // Green outline: an aspect-ratio ellipse warped by two low harmonics so
  // shapes range from round to long ovals to kidneys/peanuts. h2 drives the
  // dominant lobe (kidney), h3 a finer waver; both rotated by `ang`.
  function greenBlob(rng, cx, cy, base, aspect, ang, h2, ph2, h3, ph3, n) {
    var pts = [];
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var rx = base, ry = base * aspect;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      var w = 1 + h2 * Math.sin(a * 2 + ph2) + h3 * Math.sin(a * 3 + ph3) + 0.05 * (rng.next() - 0.5);
      var ex = Math.cos(a) * rx * w, ey = Math.sin(a) * ry * w;
      pts.push({ x: cx + ex * ca - ey * sa, y: cy + ex * sa + ey * ca });
    }
    return pts;
  }

  // Sustained neck reduction: full fraction `f` across [t0..t1] with cosine
  // shoulders of width `sh`, so the island stays pinched over a stretch
  // (rather than a single spike). Returns 0..f.
  function neckReduction(t, p) {
    if (t <= p.t0 - p.sh || t >= p.t1 + p.sh) return 0;
    if (t >= p.t0 && t <= p.t1) return p.f;
    if (t < p.t0) { var x = (t - (p.t0 - p.sh)) / p.sh; return p.f * 0.5 * (1 - Math.cos(x * Math.PI)); }
    var x2 = ((p.t1 + p.sh) - t) / p.sh;
    return p.f * 0.5 * (1 - Math.cos(x2 * Math.PI));
  }

  // ---------- hole generation ----------

  var PAR_SPECS = {
    3: { min: 130, max: 195 },
    4: { min: 310, max: 405 },
    5: { min: 480, max: 560 },
  };

  // Pick a fun mix of pars for the round (always at least one 3 and one 5
  // in rounds of 3+ holes).
  function parSequence(rng, count) {
    var pars = [];
    for (var i = 0; i < count; i++) pars.push(rng.pick([3, 4, 4, 4, 5]));
    if (pars.indexOf(3) === -1) pars[rng.int(0, count - 1)] = 3;
    if (pars.indexOf(5) === -1) {
      var idx = rng.int(0, count - 1);
      if (pars[idx] === 3 && count > 1) idx = (idx + 1) % count;
      pars[idx] = 5;
    }
    return pars;
  }

  function generateCourse(seed, holeCount) {
    var seqRng = RNG.make(RNG.mix(seed, 999));
    var pars = parSequence(seqRng, holeCount);
    var holes = [];
    for (var i = 0; i < holeCount; i++) {
      holes.push(generateHole(RNG.mix(seed, i), pars[i], i));
    }
    return holes;
  }

  function generateHole(seed, par, index) {
    var rng = RNG.make(seed);
    var spec = PAR_SPECS[par];
    var length = rng.range(spec.min, spec.max);

    var tee = { x: 0, y: 0 };

    // Signature feature — chosen first because some reshape the centerline.
    // carry = two islands with open sea (sometimes a classic island green);
    // triple = three islands / two carries (rewards distance control); dogleg =
    // a ~90° bend, cut the corner over the sea or lay up and play across;
    // narrow = a long neck; guard = water at the green; lake = a fairway pond.
    var feature;
    if (par === 3) feature = rng.pick(['none', 'none', 'carry', 'guard', 'guard']);
    else if (par === 4) feature = rng.pick(['none', 'guard', 'narrow', 'carry', 'lake', 'dogleg']);
    else feature = rng.pick(['none', 'guard', 'narrow', 'carry', 'lake', 'dogleg', 'triple']);

    // Centerline: a quadratic through `ctrl`. A dogleg puts the control point
    // straight above the tee with the green out to one side, giving a rounded
    // ~90° turn (up one leg, then across to the green).
    var ctrl, end, doglegSide = 0;
    if (feature === 'dogleg') {
      doglegSide = rng.chance(0.5) ? 1 : -1;
      var legUp = length * rng.range(0.5, 0.62);
      var legAcross = length * rng.range(0.42, 0.56);
      ctrl = { x: 0, y: legUp };
      end = { x: doglegSide * legAcross, y: legUp * rng.range(0.94, 1.06) };
    } else {
      var bendX = par === 3 ? rng.range(-15, 15) : rng.range(-1, 1) > 0
        ? rng.range(20, length * 0.16)
        : -rng.range(20, length * 0.16);
      ctrl = { x: bendX * 1.6, y: length * rng.range(0.45, 0.6) };
      end = { x: bendX * rng.range(0.4, 0.9), y: length };
    }

    // Sampled centerline used for fairway distance + island outline.
    var line = [];
    var N = 48;
    for (var i = 0; i <= N; i++) {
      line.push(feature === 'dogleg' ? cubic(tee, ctrl, ctrl, end, i / N) : bezier(tee, ctrl, end, i / N));
    }
    // Point on the actual centerline at 0..1 (matches the sampled line for
    // every feature, including the dogleg's cubic).
    function centerAt(t) { return line[Math.max(0, Math.min(N, Math.round(t * N)))]; }

    var fairwayW = rng.range(26, 34);
    var firstCutW = rng.range(9, 13); // band of light rough hugging the fairway

    // Greens are big and genuinely varied: a per-hole base size, aspect
    // ratio, rotation and two shape harmonics give rounds, long ovals and
    // kidneys. greenR is a conservative max-radius proxy for decor spacing.
    var greenBase = par === 3 ? rng.range(12.5, 15.5) : par === 4 ? rng.range(13.5, 16.5) : rng.range(14.5, 18);
    var greenAspect = rng.range(0.72, 1.4);
    var greenAng = rng.next() * TAU;
    var gH2 = rng.range(0, 0.22), gPh2 = rng.next() * TAU;
    var gH3 = rng.range(0, 0.12), gPh3 = rng.next() * TAU;
    var green = { x: end.x, y: end.y };
    var greenPoly = greenBlob(rng, green.x, green.y, greenBase, greenAspect, greenAng, gH2, gPh2, gH3, gPh3, 28);
    var fringePoly = expand(greenPoly, 2.8);
    var greenR = greenBase * Math.max(1, greenAspect) * (1 + gH2 * 0.7 + gH3 * 0.5);
    // pin on the surface: a candidate near centre pulled inward until inside
    // (robust for kidney/concave greens).
    var pinDir = rng.next() * TAU;
    var pinReach = (0.25 + rng.next() * 0.5) * greenBase;
    var pin = { x: green.x + Math.cos(pinDir) * pinReach, y: green.y + Math.sin(pinDir) * pinReach };
    for (var pg = 0; pg < 10 && !pointInPoly(pin, greenPoly); pg++) {
      pin.x = green.x + (pin.x - green.x) * 0.72;
      pin.y = green.y + (pin.y - green.y) * 0.72;
    }

    var margin = 42 + par * 6;
    var islands = [];
    if (feature === 'carry') {
      // The end caps extend each island by ~its margin, so compute the split
      // in yards with the caps included to guarantee real open sea between.
      var splitY = (par === 3 ? rng.range(0.5, 0.62) : rng.range(0.42, 0.58)) * length;
      var gapY = par === 3 ? rng.range(30, 48) : rng.range(44, 66);
      var mA = margin * (par === 3 ? 0.85 : 1);
      var teeEndT = Math.max(0.12, (splitY - gapY / 2 - mA) / length);
      islands.push(makeIsland(rng, line, 0, teeEndT, mA, null));
      if (par === 3 && rng.chance(0.65)) {
        // classic island green: a tight disc of land, minimal surround, so
        // club + power choice is everything.
        var gRad = greenR + rng.range(7, 13);
        var gGrass = blob(rng, green.x, green.y, gRad, 0.16, 18);
        islands.push({ grass: gGrass, beach: expand(gGrass, 9) });
      } else {
        // Second landmass holds the green; occasionally shrink it to a tight
        // "island green" target that leaves almost no room behind the flag.
        var tightIsland = par >= 4 && rng.chance(0.4);
        var mB = margin * (tightIsland ? 0.62 : 0.9);
        var greenStartT = Math.min(0.9, (splitY + gapY / 2 + mB) / length + (tightIsland ? rng.range(0.05, 0.1) : 0));
        islands.push(makeIsland(rng, line, greenStartT, 1, mB, null));
      }
    } else if (feature === 'triple') {
      // Three islands separated by two open-sea carries — you must control
      // distance to land each island rather than blast through them.
      var mT = margin * 0.8;
      var c1 = length * rng.range(0.28, 0.34); // centre of the first gap
      var c2 = length * rng.range(0.66, 0.74); // centre of the second gap
      var gT = rng.range(26, 36);              // each sea gap in yards
      var i1end = Math.max(0.1, (c1 - gT / 2 - mT) / length);
      var i2start = Math.min(0.45, (c1 + gT / 2 + mT) / length);
      var i2end = Math.max(i2start + 0.08, (c2 - gT / 2 - mT) / length);
      var i3start = Math.min(0.9, (c2 + gT / 2 + mT) / length);
      islands.push(makeIsland(rng, line, 0, i1end, mT, null));
      islands.push(makeIsland(rng, line, i2start, i2end, mT, null));
      islands.push(makeIsland(rng, line, i3start, 1, mT, null));
    } else if (feature === 'narrow') {
      // A long neck that stays pinched for a stretch — cutting in from one
      // side (left/right) or both — so you weigh laying up short of it.
      var nt0 = rng.range(0.24, 0.42);
      var pinch = {
        t0: nt0,
        t1: nt0 + rng.range(0.3, 0.46),
        sh: rng.range(0.07, 0.12),
        f: rng.range(0.45, 0.66),
        side: rng.pick(['both', 'both', 'left', 'right']),
      };
      islands.push(makeIsland(rng, line, 0, 1, margin, pinch));
    } else {
      // Includes dogleg — a slightly tighter margin keeps the inside of the
      // bend from pinching where the fairway turns.
      var m0 = feature === 'dogleg' ? margin * 0.82 : margin;
      islands.push(makeIsland(rng, line, 0, 1, m0, null));
    }
    var grassPoly = islands[0].grass;
    var beachPoly = islands[0].beach;
    var allBeach = [];
    islands.forEach(function (isl) { allBeach.push.apply(allBeach, isl.beach); });

    function onGrass(p) {
      for (var gi = 0; gi < islands.length; gi++) {
        if (pointInPoly(p, islands[gi].grass)) return true;
      }
      return false;
    }

    // Water hazards. (carry holes rely on the open sea between islands.)
    var waters = [];
    if (feature === 'lake') {
      // long pond running alongside the fairway for much of its length
      var lt = rng.range(0.42, 0.6);
      var lc = centerAt(lt);
      var ln = normalAt(line, lt);
      var lside = rng.chance(0.5) ? 1 : -1;
      var lhalfLen = rng.range(63, 99);
      var lhalfW = rng.range(15, 22);
      var loff = fairwayW / 2 + rng.range(2, 8) + lhalfW;
      var lang = Math.atan2(-ln.x, ln.y); // long axis runs along the fairway
      waters.push(ellipseBlob(rng, lc.x + ln.x * loff * lside, lc.y + ln.y * loff * lside, lhalfLen, lhalfW, lang, 0.22, 26));
    } else if (feature === 'guard') {
      if (rng.chance(0.5)) {
        // crescent wrapping a quarter–half of the green, just off the edge
        var wa0 = rng.next() * TAU;
        var wsweep = rng.pick([TAU * 0.22, TAU * 0.32, TAU * 0.5]);
        waters.push(arcPond(rng, green.x, green.y, greenR + rng.range(2, 4), rng.range(7, 12), wa0, wsweep, 30));
      } else {
        // round pond tangent to the green — sits OUTSIDE the putting surface
        var ga = rng.next() * TAU;
        var gr = rng.range(9, 15);
        var gd = greenR + gr + rng.range(2, 4.5);
        waters.push(blob(rng, green.x + Math.cos(ga) * gd, green.y + Math.sin(ga) * gd, gr, 0.22, 14));
      }
    } else if (feature === 'none' || feature === 'narrow') {
      if (par >= 4 && rng.chance(0.5)) {
        // an elongated pond flanking the fairway
        var t = rng.range(0.5, 0.78);
        var c = centerAt(t);
        var side = rng.chance(0.5) ? 1 : -1;
        var fn = normalAt(line, t);
        var fHalfLen = rng.range(16, 30);
        var fHalfW = rng.range(7, 11);
        var off = fairwayW / 2 + rng.range(4, 12) + fHalfW;
        var fang = Math.atan2(-fn.x, fn.y);
        waters.push(ellipseBlob(rng, c.x + fn.x * off * side, c.y + fn.y * off * side, fHalfLen, fHalfW, fang, 0.28, 22));
      }
      if (par === 3 && rng.chance(0.45)) {
        // water carry in front of the green
        var mid = centerAt(0.5);
        waters.push(blob(rng, mid.x + rng.range(-8, 8), mid.y, rng.range(15, 22), 0.3, 14));
      }
    }

    // Bunkers: 1-2 hugging the green, maybe one along the fairway.
    var bunkers = [];
    var gCount = rng.int(1, 2);
    for (i = 0; i < gCount * 3 && bunkers.length < gCount; i++) {
      var ba = rng.next() * TAU;
      var bd = greenR + rng.range(5, 10);
      var bx = green.x + Math.cos(ba) * bd, by = green.y + Math.sin(ba) * bd;
      // keep greenside bunkers on the island
      if (!onGrass({ x: bx, y: by })) continue;
      bunkers.push(blob(rng, bx, by, rng.range(5, 8), 0.3, 12));
    }
    if (par >= 4 && rng.chance(0.6)) {
      var bt = rng.range(0.45, 0.7);
      var bc = centerAt(bt);
      var bn = normalAt(line, bt);
      var bside = rng.chance(0.5) ? 1 : -1;
      var boff = fairwayW / 2 + rng.range(1, 6);
      var fbx = bc.x + bn.x * boff * bside, fby = bc.y + bn.y * boff * bside;
      if (onGrass({ x: fbx, y: fby })) {
        bunkers.push(blob(rng, fbx, fby, rng.range(6, 9), 0.3, 12));
      }
    }

    // Green slope: a base fall direction/magnitude PLUS 1-2 mounds or swales
    // so greens undulate and putts break differently across the surface.
    // Read anywhere via Course.slopeAt(hole, p).
    var slopeAng = rng.next() * TAU;
    var slopeMag = rng.range(0.03, 0.08);
    var humpN = rng.int(1, 2);
    var greenHumps = [];
    for (var gh = 0; gh < humpN; gh++) {
      var ha = rng.next() * TAU;
      var hd = rng.range(0.15, 0.65) * greenBase;
      greenHumps.push({
        x: green.x + Math.cos(ha) * hd,
        y: green.y + Math.sin(ha) * hd,
        r: rng.range(0.35, 0.6) * greenBase,
        amp: rng.range(0.6, 1.4) * (rng.chance(0.5) ? 1 : -1), // + mound, − swale
      });
    }

    var hole = {
      index: index, par: par, length: Math.round(length),
      tee: tee, green: green, greenR: greenR, pin: pin,
      greenPoly: greenPoly, fringePoly: fringePoly, greenAng: greenAng,
      line: line, fairwayW: fairwayW, firstCutW: firstCutW,
      fairwayPoly: fairwayOutline(line, fairwayW / 2),
      firstCutPoly: fairwayOutline(line, fairwayW / 2 + firstCutW),
      islands: islands, feature: feature, narrowSide: (typeof pinch !== 'undefined' && pinch) ? pinch.side : null,
      grassPoly: grassPoly, beachPoly: beachPoly,
      waters: waters, bunkers: bunkers,
      greenSlope: { x: Math.cos(slopeAng) * slopeMag, y: Math.sin(slopeAng) * slopeMag, mag: slopeMag },
      greenHumps: greenHumps,
      trees: [], rocks: [], statues: [], tufts: [],
      wind: { angle: rng.next() * TAU, mph: Math.round(rng.range(0, 9)) },
      bounds: polyBounds(allBeach, 14),
    };

    scatterDecor(rng, hole);
    return hole;
  }

  // Clean capsule polygon around the centerline (transforms correctly under
  // the tilted camera, unlike a thick canvas stroke).
  function fairwayOutline(line, halfW) {
    var left = [], right = [];
    for (var i = 0; i < line.length; i++) {
      var n = normalAt(line, i / (line.length - 1));
      left.push({ x: line[i].x + n.x * halfW, y: line[i].y + n.y * halfW });
      right.push({ x: line[i].x - n.x * halfW, y: line[i].y - n.y * halfW });
    }
    return left.concat(arcCap(line[line.length - 1], line[line.length - 2], halfW), right.reverse(), arcCap(line[0], line[1], halfW));
  }

  function arcCap(tip, inner, r) {
    var dx = tip.x - inner.x, dy = tip.y - inner.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var a0 = Math.atan2(dy / len, dx / len) + Math.PI / 2;
    var pts = [];
    for (var i = 1; i <= 6; i++) {
      var a = a0 - (i / 7) * Math.PI;
      pts.push({ x: tip.x + Math.cos(a) * r, y: tip.y + Math.sin(a) * r });
    }
    return pts;
  }

  function normalAt(line, t) {
    var i = Math.min(line.length - 2, Math.floor(t * (line.length - 1)));
    var dx = line[i + 1].x - line[i].x, dy = line[i + 1].y - line[i].y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  // Builds one island's grass+beach outline along a stretch [t0..t1] of the
  // centerline. `pinch` optionally narrows the island over a sustained neck
  // (see neckReduction) on the left, right, or both sides — the "narrow"
  // hazard.
  function makeIsland(rng, line, t0, t1, margin, pinch) {
    var last = line.length - 1;
    var i0 = Math.max(0, Math.round(t0 * last));
    var i1 = Math.min(last, Math.round(t1 * last));
    if (i1 - i0 < 3) i1 = Math.min(last, i0 + 3);
    var sub = line.slice(i0, i1 + 1);
    var left = [], right = [];
    var phase = rng.next() * TAU;
    var phase2 = rng.next() * TAU;
    for (var i = 0; i < sub.length; i++) {
      var t = (i0 + i) / last;
      var n = normalAt(sub, i / (sub.length - 1));
      var wob = Math.sin(t * 5 + phase) * 5 + Math.sin(t * 2.3 + phase2) * 4;
      var ml = margin, mr = margin;
      if (pinch) {
        var red = neckReduction(t, pinch);
        if (pinch.side !== 'right') ml *= 1 - red;
        if (pinch.side !== 'left') mr *= 1 - red;
      }
      left.push({ x: sub[i].x + n.x * (ml + wob), y: sub[i].y + n.y * (ml + wob) });
      right.push({ x: sub[i].x - n.x * (mr - wob * 0.5), y: sub[i].y - n.y * (mr - wob * 0.5) });
    }
    var capB = cap(sub[0], sub[1], margin, rng);
    var capT = cap(sub[sub.length - 1], sub[sub.length - 2], margin, rng);
    var grass = left.concat(capT, right.reverse(), capB);
    return { grass: grass, beach: expand(grass, 9) };
  }

  function cap(tip, inner, r, rng) {
    var dx = tip.x - inner.x, dy = tip.y - inner.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var a0 = Math.atan2(dy / len, dx / len) - Math.PI / 2 + Math.PI; // start from left normal
    var pts = [];
    for (var i = 1; i <= 8; i++) {
      // sweep away from the island so the cap arcs around the tip
      var a = a0 - (i / 9) * Math.PI;
      var rr = r * (1 + (rng.next() - 0.5) * 0.12);
      pts.push({ x: tip.x + Math.cos(a) * rr, y: tip.y + Math.sin(a) * rr });
    }
    return pts;
  }

  // Cheap polygon expansion from its centroid (good enough for blobby shapes).
  function expand(poly, amount) {
    var cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) { cx += poly[i].x; cy += poly[i].y; }
    cx /= poly.length; cy /= poly.length;
    return poly.map(function (p) {
      var dx = p.x - cx, dy = p.y - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      return { x: p.x + (dx / d) * amount, y: p.y + (dy / d) * amount };
    });
  }

  function polyBounds(poly, pad) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      minX = Math.min(minX, poly[i].x); maxX = Math.max(maxX, poly[i].x);
      minY = Math.min(minY, poly[i].y); maxY = Math.max(maxY, poly[i].y);
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }

  // Both rough cuts count as "off the fairway" for decor placement.
  function offFairwayRough(t) { return t === 'rough' || t === 'heavy'; }

  function scatterDecor(rng, hole) {
    var b = hole.bounds;
    var tries = 900;
    var treeVariants = ['g', 'g', 'g', 'g2', 'g2', 'o', 'y'];
    while (tries-- > 0 && hole.trees.length < 34) {
      var p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (!offFairwayRough(terrainAt(hole, p))) continue;
      if (distToPolyline(p, hole.line) < hole.fairwayW / 2 + 9) continue;
      if (dist(p, hole.green) < hole.greenR + 12) continue;
      if (dist(p, hole.tee) < 14) continue;
      var tooClose = hole.trees.some(function (t) { return dist(t, p) < t.r + 5; });
      if (tooClose) continue;
      // Palms near the island edge, leafy trees inland.
      var edgeDist = edgeDistance(hole, p);
      if (edgeDist < 8) {
        hole.trees.push({ x: p.x, y: p.y, r: rng.range(4, 6), kind: 'palm', lean: rng.range(-0.5, 0.5), rot: rng.next() * TAU });
      } else if (rng.chance(0.6)) {
        var pr = rng.range(4.5, 8.5);
        hole.trees.push({
          x: p.x, y: p.y, r: pr, kind: 'pine',
          tiers: pr > 6.5 ? 4 : 3, pine: rng.int(0, 2),
          faces: rng.chance(0.45) ? 4 : 3,
          rot: rng.next() * TAU,
        });
      } else {
        hole.trees.push({
          x: p.x, y: p.y, r: rng.range(4.5, 8.5), kind: rng.pick(treeVariants),
          lobes: rng.int(3, 5), rot: rng.next() * TAU,
        });
      }
    }
    // Rock clusters.
    var rocks = rng.int(1, 3);
    tries = 200;
    while (tries-- > 0 && rocks > 0) {
      var rp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (!offFairwayRough(terrainAt(hole, rp))) continue;
      if (distToPolyline(rp, hole.line) < hole.fairwayW / 2 + 14) continue;
      if (dist(rp, hole.green) < hole.greenR + 18) continue;
      var pieces = [];
      var n = rng.int(2, 4);
      for (var i = 0; i < n; i++) {
        pieces.push({
          x: rp.x + rng.range(-7, 7), y: rp.y + rng.range(-5, 5),
          r: rng.range(5, 10.5), sides: rng.int(5, 7), rot: rng.next() * TAU,
        });
      }
      // little capstone lump riding the biggest boulder
      var big = pieces[0];
      pieces.push({ x: big.x + 1, y: big.y + 1, r: big.r * 0.4, sides: 6, rot: big.rot + 1.7, cap: true, capR: big.r });
      hole.rocks.push({ x: rp.x, y: rp.y, pieces: pieces });
      rocks--;
    }
    // Moai shrine: a big statue with a ring of small heads (about half of
    // holes), plus the odd lone head in the rough.
    if (rng.chance(0.55)) {
      tries = 150;
      while (tries-- > 0) {
        var sp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
        if (!offFairwayRough(terrainAt(hole, sp))) continue;
        if (distToPolyline(sp, hole.line) < hole.fairwayW / 2 + 16) continue;
        if (dist(sp, hole.green) < hole.greenR + 22) continue;
        if (edgeDistance(hole, sp) < 10) continue;
        var s = rng.range(6, 8.5);
        hole.statues.push({ x: sp.x, y: sp.y, s: s, kind: 'moai', tint: 0 });
        var ringN = rng.int(2, 4);
        for (var ri = 0; ri < ringN; ri++) {
          var ra = rng.next() * TAU;
          var rd = s * rng.range(1.7, 2.4);
          var rp = { x: sp.x + Math.cos(ra) * rd, y: sp.y + Math.sin(ra) * rd };
          if (!offFairwayRough(terrainAt(hole, rp))) continue;
          hole.statues.push({ x: rp.x, y: rp.y, s: rng.range(2.4, 3.6), kind: 'head', tint: rng.chance(0.3) ? 1 : 0 });
        }
        break;
      }
    }
    var lone = rng.int(0, 3);
    tries = 120;
    while (tries-- > 0 && lone > 0) {
      var lp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (!offFairwayRough(terrainAt(hole, lp))) continue;
      if (distToPolyline(lp, hole.line) < hole.fairwayW / 2 + 10) continue;
      hole.statues.push({ x: lp.x, y: lp.y, s: rng.range(2.2, 3.4), kind: 'head', tint: rng.chance(0.3) ? 1 : 0 });
      lone--;
    }

    // Little flowers / grass tufts.
    tries = 300;
    while (tries-- > 0 && hole.tufts.length < 30) {
      var tp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      var terr = terrainAt(hole, tp);
      if (terr !== 'fairway' && !offFairwayRough(terr)) continue;
      var kind = terr === 'fairway'
        ? 'grass'
        : rng.pick(['grass', 'grass', 'grass', 'grass', 'orange', 'yellow', 'pink', 'cyan']);
      hole.tufts.push({ x: tp.x, y: tp.y, kind: kind, s: rng.range(0.7, 1.4), rot: rng.next() * TAU });
    }

    function roughSpot(minFairwayGap) {
      for (var i = 0; i < 60; i++) {
        var p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
        if (!offFairwayRough(terrainAt(hole, p))) continue;
        if (minFairwayGap && distToPolyline(p, hole.line) < hole.fairwayW / 2 + minFairwayGap) continue;
        return p;
      }
      return null;
    }

    // Tall grass in the rough, hugging rocks and moai bases.
    var added = 0;
    tries = 300;
    while (tries-- > 0 && added < 26) {
      var g = roughSpot(0);
      if (!g) break;
      hole.tufts.push({ x: g.x, y: g.y, kind: 'tall', s: rng.range(0.8, 1.5), rot: rng.next() * TAU });
      added++;
    }
    hole.rocks.forEach(function (cl) {
      for (var gi = 0; gi < 3; gi++) {
        var ga = rng.next() * TAU;
        var gd = rng.range(6, 11);
        var gp = { x: cl.x + Math.cos(ga) * gd, y: cl.y + Math.sin(ga) * gd };
        if (offFairwayRough(terrainAt(hole, gp))) {
          hole.tufts.push({ x: gp.x, y: gp.y, kind: 'tall', s: rng.range(1, 1.6), rot: rng.next() * TAU });
        }
      }
    });
    hole.statues.forEach(function (st) {
      var gn = st.kind === 'moai' ? 4 : 2;
      for (var gi = 0; gi < gn; gi++) {
        var ga = rng.next() * TAU;
        var gd = st.s * (1.1 + rng.next() * 0.7);
        hole.tufts.push({
          x: st.x + Math.cos(ga) * gd, y: st.y + Math.sin(ga) * gd * 0.7,
          kind: 'tall', s: rng.range(0.9, 1.5), rot: rng.next() * TAU,
        });
      }
    });

    // Props: stumps, fallen logs, dead trees, mushrooms, pebbles.
    [['stump', rng.int(1, 3)], ['log', rng.int(1, 2)], ['dead', rng.int(1, 2)], ['pebble', rng.int(2, 4)]]
      .forEach(function (pc) {
        for (var pi = 0; pi < pc[1]; pi++) {
          var pp = roughSpot(4);
          if (!pp) return;
          hole.tufts.push({ x: pp.x, y: pp.y, kind: pc[0], s: rng.range(0.9, 1.4), rot: rng.next() * TAU });
          if (pc[0] === 'stump' && rng.chance(0.7)) {
            hole.tufts.push({ x: pp.x + rng.range(2, 4), y: pp.y - rng.range(1, 3), kind: 'shroom', s: rng.range(0.8, 1.2), rot: rng.next() * TAU });
          }
        }
      });

    // Sand speckle: beach + bunkers.
    hole.sandDots = [];
    tries = 500;
    while (tries-- > 0 && hole.sandDots.length < 70) {
      var sd = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (terrainAt(hole, sd) !== 'sand') continue;
      hole.sandDots.push({ x: sd.x, y: sd.y, r: rng.range(0.35, 0.8), light: rng.chance(0.3) });
    }
    hole.bunkerDots = [];
    hole.bunkers.forEach(function (poly) {
      var bb = polyBounds(poly, 0);
      var bn = 0, guard = 80;
      while (guard-- > 0 && bn < 9) {
        var dp = { x: rng.range(bb.minX, bb.maxX), y: rng.range(bb.minY, bb.maxY) };
        if (!pointInPoly(dp, poly)) continue;
        hole.bunkerDots.push({ x: dp.x, y: dp.y, r: rng.range(0.3, 0.6), light: rng.chance(0.3) });
        bn++;
      }
    });

    // Subtle low-poly tone patches on the rough.
    hole.patches = [];
    tries = 400;
    while (tries-- > 0 && hole.patches.length < 54) {
      var pa = roughSpot(0);
      if (!pa) break;
      if (dist(pa, hole.green) < hole.greenR + 10) continue;
      hole.patches.push({ x: pa.x, y: pa.y, r: rng.range(2.5, 6), rot: rng.next() * TAU, light: rng.chance(0.5) });
    }
  }

  // Approximate distance from a point (inside grass) to the island edge.
  function edgeDistance(hole, p) {
    var best = Infinity;
    var isls = hole.islands || [{ grass: hole.grassPoly }];
    for (var k = 0; k < isls.length; k++) {
      var poly = isls[k].grass;
      for (var i = 0; i < poly.length - 1; i += 2) {
        best = Math.min(best, distToSeg(p, poly[i], poly[i + 1]));
      }
    }
    return best;
  }

  // ---------- terrain lookup ----------
  // Returns: 'green' | 'fairway' | 'rough' (first cut) | 'heavy' (thick rough)
  //          | 'sand' | 'water' | 'tee'
  function terrainAt(hole, p) {
    for (var i = 0; i < hole.waters.length; i++) {
      if (pointInPoly(p, hole.waters[i])) return 'water';
    }
    var isls = hole.islands || [{ grass: hole.grassPoly, beach: hole.beachPoly }];
    var onLand = false;
    for (i = 0; i < isls.length; i++) {
      if (pointInPoly(p, isls[i].grass)) { onLand = true; break; }
    }
    if (!onLand) {
      for (i = 0; i < isls.length; i++) {
        if (pointInPoly(p, isls[i].beach)) return 'sand';
      }
      return 'water';
    }
    for (i = 0; i < hole.bunkers.length; i++) {
      if (pointInPoly(p, hole.bunkers[i])) return 'sand';
    }
    if (hole.greenPoly ? pointInPoly(p, hole.greenPoly) : dist(p, hole.green) <= hole.greenR) return 'green';
    if (dist(p, hole.tee) <= 6) return 'tee';
    var dLine = distToPolyline(p, hole.line);
    if (dLine <= hole.fairwayW / 2) return 'fairway';
    if (dLine <= hole.fairwayW / 2 + (hole.firstCutW || 0)) return 'rough';
    return 'heavy';
  }

  // Local downhill gradient of the green at p: base tilt + mound/swale
  // contributions. Magnitude is clamped so putts stay controllable. Pure and
  // seeded, so physics stays deterministic across clients.
  function slopeAt(hole, p) {
    var s = hole.greenSlope || { x: 0, y: 0 };
    var gx = s.x, gy = s.y;
    var humps = hole.greenHumps;
    if (humps) {
      for (var i = 0; i < humps.length; i++) {
        var h = humps[i];
        var dx = p.x - h.x, dy = p.y - h.y;
        var e = Math.exp(-(dx * dx + dy * dy) / (2 * h.r * h.r));
        var k = h.amp * e / (h.r * h.r); // downhill points away from a mound
        gx += dx * k;
        gy += dy * k;
      }
    }
    var m = Math.sqrt(gx * gx + gy * gy);
    var MAX = 0.10;
    if (m > MAX) { gx = gx / m * MAX; gy = gy / m * MAX; m = MAX; }
    return { x: gx, y: gy, mag: m };
  }

  // Relative surface height of the green at p (for the visual slope grid only —
  // physics uses slopeAt). Base tilt plane + mound/swale bumps; consistent with
  // slopeAt so the mesh matches where putts actually break.
  function greenHeight(hole, p) {
    var s = hole.greenSlope || { x: 0, y: 0 };
    var g = hole.green;
    var h = -((p.x - g.x) * s.x + (p.y - g.y) * s.y); // downhill = lower
    var humps = hole.greenHumps;
    if (humps) {
      for (var i = 0; i < humps.length; i++) {
        var hp = humps[i];
        var dx = p.x - hp.x, dy = p.y - hp.y;
        h += hp.amp * Math.exp(-(dx * dx + dy * dy) / (2 * hp.r * hp.r));
      }
    }
    return h;
  }

  window.Course = {
    generate: generateCourse,
    terrainAt: terrainAt,
    slopeAt: slopeAt,
    greenHeight: greenHeight,
    dist: dist,
    distToPolyline: distToPolyline,
    pointInPoly: pointInPoly,
  };
})();
