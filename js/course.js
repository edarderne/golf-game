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
    var bendX = par === 3 ? rng.range(-15, 15) : rng.range(-1, 1) > 0
      ? rng.range(20, length * 0.16)
      : -rng.range(20, length * 0.16);
    var ctrl = { x: bendX * 1.6, y: length * rng.range(0.45, 0.6) };
    var end = { x: bendX * rng.range(0.4, 0.9), y: length };

    // Sampled centerline used for fairway distance + island outline.
    var line = [];
    var N = 48;
    for (var i = 0; i <= N; i++) line.push(bezier(tee, ctrl, end, i / N));

    var fairwayW = rng.range(26, 34);
    var greenR = rng.range(10.5, 14);
    var green = { x: end.x, y: end.y };
    var pinA = rng.next() * TAU;
    var pinR = rng.next() * greenR * 0.45;
    var pin = { x: green.x + Math.cos(pinA) * pinR, y: green.y + Math.sin(pinA) * pinR };

    // Island (grass) and beach outlines: offset the centerline both sides
    // with a wobbly margin, plus rounded caps past the tee and green.
    var margin = 42 + par * 6;
    var grassPoly = outline(rng, line, margin);
    var beachPoly = expand(grassPoly, 9);

    // Water hazards: ponds guarding the approach or flanking the fairway.
    var waters = [];
    if (par >= 4 && rng.chance(0.55)) {
      var t = rng.range(0.55, 0.8);
      var c = bezier(tee, ctrl, end, t);
      var side = rng.chance(0.5) ? 1 : -1;
      var off = fairwayW / 2 + rng.range(4, 14);
      var n = normalAt(line, t);
      waters.push(blob(rng, c.x + n.x * off * side, c.y + n.y * off * side, rng.range(14, 22), 0.35, 14));
    }
    if (par === 3 && rng.chance(0.5)) {
      // Water carry in front of the green.
      var mid = bezier(tee, ctrl, end, 0.55);
      waters.push(blob(rng, mid.x + rng.range(-8, 8), mid.y, rng.range(13, 18), 0.3, 14));
    }

    // Bunkers: 1-2 hugging the green, maybe one along the fairway.
    var bunkers = [];
    var gCount = rng.int(1, 2);
    for (i = 0; i < gCount * 3 && bunkers.length < gCount; i++) {
      var ba = rng.next() * TAU;
      var bd = greenR + rng.range(5, 10);
      var bx = green.x + Math.cos(ba) * bd, by = green.y + Math.sin(ba) * bd;
      // keep greenside bunkers on the island
      if (!pointInPoly({ x: bx, y: by }, grassPoly)) continue;
      bunkers.push(blob(rng, bx, by, rng.range(5, 8), 0.3, 12));
    }
    if (par >= 4 && rng.chance(0.6)) {
      var bt = rng.range(0.45, 0.7);
      var bc = bezier(tee, ctrl, end, bt);
      var bn = normalAt(line, bt);
      var bside = rng.chance(0.5) ? 1 : -1;
      var boff = fairwayW / 2 + rng.range(1, 6);
      var fbx = bc.x + bn.x * boff * bside, fby = bc.y + bn.y * boff * bside;
      if (pointInPoly({ x: fbx, y: fby }, grassPoly)) {
        bunkers.push(blob(rng, fbx, fby, rng.range(6, 9), 0.3, 12));
      }
    }

    var hole = {
      index: index, par: par, length: Math.round(length),
      tee: tee, green: green, greenR: greenR, pin: pin,
      line: line, fairwayW: fairwayW,
      grassPoly: grassPoly, beachPoly: beachPoly,
      waters: waters, bunkers: bunkers,
      trees: [], rocks: [], tufts: [],
      wind: { angle: rng.next() * TAU, mph: Math.round(rng.range(0, 9)) },
      bounds: polyBounds(beachPoly, 14),
    };

    scatterDecor(rng, hole);
    return hole;
  }

  function normalAt(line, t) {
    var i = Math.min(line.length - 2, Math.floor(t * (line.length - 1)));
    var dx = line[i + 1].x - line[i].x, dy = line[i + 1].y - line[i].y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  function outline(rng, line, margin) {
    var left = [], right = [];
    var phase = rng.next() * TAU;
    var phase2 = rng.next() * TAU;
    for (var i = 0; i < line.length; i++) {
      var t = i / (line.length - 1);
      var n = normalAt(line, t);
      var wob = Math.sin(t * 5 + phase) * 5 + Math.sin(t * 2.3 + phase2) * 4;
      var m = margin + wob;
      left.push({ x: line[i].x + n.x * m, y: line[i].y + n.y * m });
      right.push({ x: line[i].x - n.x * (margin - wob * 0.5), y: line[i].y - n.y * (margin - wob * 0.5) });
    }
    // Rounded caps beyond tee (bottom) and green (top).
    var capB = cap(line[0], line[1], margin, rng);
    var capT = cap(line[line.length - 1], line[line.length - 2], margin, rng);
    return left.concat(capT, right.reverse(), capB);
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

  function scatterDecor(rng, hole) {
    var b = hole.bounds;
    var tries = 900;
    var treeVariants = ['g', 'g', 'g', 'g2', 'g2', 'o', 'y'];
    while (tries-- > 0 && hole.trees.length < 34) {
      var p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (terrainAt(hole, p) !== 'rough') continue;
      if (distToPolyline(p, hole.line) < hole.fairwayW / 2 + 9) continue;
      if (dist(p, hole.green) < hole.greenR + 12) continue;
      if (dist(p, hole.tee) < 14) continue;
      var tooClose = hole.trees.some(function (t) { return dist(t, p) < t.r + 5; });
      if (tooClose) continue;
      // Palms near the island edge, leafy trees inland.
      var edgeDist = edgeDistance(hole, p);
      if (edgeDist < 8) {
        hole.trees.push({ x: p.x, y: p.y, r: rng.range(4, 6), kind: 'palm', lean: rng.range(-0.5, 0.5) });
      } else {
        hole.trees.push({ x: p.x, y: p.y, r: rng.range(4.5, 8.5), kind: rng.pick(treeVariants) });
      }
    }
    // Rock clusters.
    var rocks = rng.int(1, 3);
    tries = 200;
    while (tries-- > 0 && rocks > 0) {
      var rp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      if (terrainAt(hole, rp) !== 'rough') continue;
      if (distToPolyline(rp, hole.line) < hole.fairwayW / 2 + 14) continue;
      if (dist(rp, hole.green) < hole.greenR + 18) continue;
      var pieces = [];
      var n = rng.int(2, 4);
      for (var i = 0; i < n; i++) {
        pieces.push({
          x: rp.x + rng.range(-7, 7), y: rp.y + rng.range(-5, 5),
          r: rng.range(3.5, 7.5), sides: rng.int(5, 7), rot: rng.next() * TAU,
        });
      }
      hole.rocks.push({ x: rp.x, y: rp.y, pieces: pieces });
      rocks--;
    }
    // Little colour tufts / flowers.
    tries = 300;
    while (tries-- > 0 && hole.tufts.length < 26) {
      var tp = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
      var terr = terrainAt(hole, tp);
      if (terr !== 'rough' && terr !== 'fairway') continue;
      hole.tufts.push({ x: tp.x, y: tp.y, kind: rng.pick(['grass', 'grass', 'grass', 'orange', 'yellow']), s: rng.range(0.7, 1.4) });
    }
  }

  // Approximate distance from a point (inside grass) to the island edge.
  function edgeDistance(hole, p) {
    var best = Infinity;
    var poly = hole.grassPoly;
    for (var i = 0; i < poly.length - 1; i += 2) {
      best = Math.min(best, distToSeg(p, poly[i], poly[i + 1]));
    }
    return best;
  }

  // ---------- terrain lookup ----------
  // Returns: 'green' | 'fairway' | 'rough' | 'sand' | 'water' | 'tee'
  function terrainAt(hole, p) {
    for (var i = 0; i < hole.waters.length; i++) {
      if (pointInPoly(p, hole.waters[i])) return 'water';
    }
    if (!pointInPoly(p, hole.grassPoly)) {
      return pointInPoly(p, hole.beachPoly) ? 'sand' : 'water';
    }
    for (i = 0; i < hole.bunkers.length; i++) {
      if (pointInPoly(p, hole.bunkers[i])) return 'sand';
    }
    if (dist(p, hole.green) <= hole.greenR) return 'green';
    if (dist(p, hole.tee) <= 6) return 'tee';
    if (distToPolyline(p, hole.line) <= hole.fairwayW / 2) return 'fairway';
    return 'rough';
  }

  window.Course = {
    generate: generateCourse,
    terrainAt: terrainAt,
    dist: dist,
    distToPolyline: distToPolyline,
    pointInPoly: pointInPoly,
  };
})();
