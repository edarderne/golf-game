// Ambient wildlife: birds overhead, fish jumping near the shore, a rare
// whale in deep water, ducks on water hazards, a turtle on the beach and a
// deer wandering the fairway. Purely visual — uses Math.random, never
// touches game state, so it cannot affect multiplayer sync.
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  function centroid(poly) {
    var cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) { cx += poly[i].x; cy += poly[i].y; }
    return { x: cx / poly.length, y: cy / poly.length };
  }

  // spot in the sea between minM and maxM yards off the shoreline
  function seaSpot(h, minM, maxM) {
    var b = h.bounds;
    var cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    for (var i = 0; i < 30; i++) {
      var v = h.beachPoly[Math.floor(Math.random() * h.beachPoly.length)];
      var dx = v.x - cx, dy = v.y - cy;
      var dl = Math.sqrt(dx * dx + dy * dy) || 1;
      var m = minM + Math.random() * (maxM - minM);
      var p = { x: v.x + (dx / dl) * m, y: v.y + (dy / dl) * m };
      if (!Course.pointInPoly(p, h.beachPoly)) return p;
    }
    return null;
  }

  window.Ambient = {
    birds: null, birdTimer: 4000,
    fish: null, fishTimer: 3000, splashes: [],
    whale: null, whaleTimer: 18000,
    ducks: [],
    turtle: null,
    deer: null, deerTimer: 7000,
    yeti: null, yetiTimer: 90000,

    reset: function (h) {
      this.birds = null; this.fish = null; this.deer = null; this.whale = null;
      this.yeti = null;
      this.splashes = [];
      this.ducks = [];
      this.deerTimer = 5000 + Math.random() * 8000;
      if (!h) { this.turtle = null; return; }
      var self = this;
      h.waters.forEach(function (pond) {
        var c = centroid(pond);
        for (var i = 0; i < 2; i++) {
          self.ducks.push({
            pond: pond, cx: c.x, cy: c.y,
            x: c.x + (Math.random() - 0.5) * 6, y: c.y + (Math.random() - 0.5) * 6,
            heading: Math.random() * TAU, phase: Math.random() * TAU,
          });
        }
      });
      this.turtle = null;
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
      if (!h) return;
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

      // fish jump close to the shore
      if (this.fish) {
        this.fish.t += sec / 1.15;
        if (this.fish.t >= 1) {
          this.splashes.push({ x: this.fish.x2, y: this.fish.y2, t0: performance.now() });
          this.fish = null;
        }
      } else if ((this.fishTimer -= dt) < 0) {
        this.fishTimer = 6000 + Math.random() * 5000;
        var spot = seaSpot(h, 4, 12);
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

      // whale: rare, far out in the deep water
      if (this.whale) {
        this.whale.t += sec / 5;
        if (this.whale.t >= 1) {
          this.splashes.push({ x: this.whale.x + this.whale.dx * 4, y: this.whale.y + this.whale.dy * 4, t0: performance.now() });
          this.whale = null;
        }
      } else if ((this.whaleTimer -= dt) < 0) {
        this.whaleTimer = 45000 + Math.random() * 45000;
        var wspot = seaSpot(h, 35, 65);
        if (wspot) {
          var wa = Math.random() * TAU;
          this.whale = { x: wspot.x, y: wspot.y, dx: Math.cos(wa), dy: Math.sin(wa), t: 0 };
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

      // deer: wanders out of the treeline, ambles across the open, pausing
      // to graze, then fades away
      if (this.deer) {
        var de = this.deer;
        de.age += dt;
        de.modeT -= dt;
        if (de.modeT < 0) {
          de.grazing = !de.grazing;
          de.modeT = de.grazing ? 2200 + Math.random() * 1600 : 3500 + Math.random() * 3000;
          if (!de.grazing) de.heading += (Math.random() - 0.5) * 1.2;
        }
        if (!de.grazing) {
          de.heading += (Math.random() - 0.5) * 0.5 * sec;
          var step = 1.35 * sec;
          var dnx = de.x + Math.sin(de.heading) * step;
          var dny = de.y + Math.cos(de.heading) * step;
          var terr = Course.terrainAt(h, { x: dnx, y: dny });
          if (terr === 'rough' || terr === 'fairway' || terr === 'tee') {
            de.x = dnx; de.y = dny;
            de.walk += step * 2.6;
          } else {
            de.heading += 1.5;
          }
        }
        if (de.age > de.life) this.deer = null;
      } else if ((this.deerTimer -= dt) < 0) {
        this.deerTimer = 13000 + Math.random() * 9000;
        var trees = h.trees.filter(function (t) { return t.kind !== 'palm'; });
        if (trees.length) {
          var tr = trees[Math.floor(Math.random() * trees.length)];
          var dp = { x: tr.x + 2.5, y: tr.y + 2 };
          if (Course.terrainAt(h, dp) === 'rough') {
            this.deer = {
              x: dp.x, y: dp.y, age: 0, life: 20000 + Math.random() * 10000,
              heading: Math.random() * TAU, grazing: false, modeT: 3000,
              walk: 0, phase: Math.random() * TAU,
            };
          }
        }
      }

      // the yeti: legendary. Every couple of minutes there's only a small
      // chance he shows up at all — then he sprints clear across the island.
      if (this.yeti) {
        var ye = this.yeti;
        ye.age += dt;
        var ystep = 6.5 * sec;
        ye.x += Math.sin(ye.heading) * ystep;
        ye.y += Math.cos(ye.heading) * ystep;
        ye.run += ystep * 1.6;
        var yterr = Course.terrainAt(h, { x: ye.x, y: ye.y });
        if (yterr === 'water' || ye.age > 16000) this.yeti = null;
      } else if ((this.yetiTimer -= dt) < 0) {
        this.yetiTimer = 100000 + Math.random() * 80000;
        if (Math.random() < 0.3) { // ~1 sighting every 8-10 minutes
          var gp = h.grassPoly;
          var vi = Math.floor(Math.random() * gp.length);
          var entry = gp[vi];
          var exit = gp[(vi + (gp.length >> 1)) % gp.length];
          var yh = Math.atan2(exit.x - entry.x, exit.y - entry.y);
          this.yeti = {
            x: entry.x + Math.sin(yh) * 2, y: entry.y + Math.cos(yh) * 2,
            heading: yh, run: 0, age: 0,
          };
        }
      }
    },

    // fish, whale + splash rings (drawn between sea and island)
    drawSeaLife: function (R) {
      var ctx = R.ctx;
      if (this.whale) {
        var wh = this.whale;
        var t = wh.t;
        var rise = Math.sin(Math.PI * Math.min(1, t * 1.15));
        var ws = R.toScreen({ x: wh.x + wh.dx * t * 5, y: wh.y + wh.dy * t * 5 });
        var wu = R.cam.scale;
        var L = wu * 7.5, H = wu * 2.3 * rise;
        ctx.save();
        ctx.beginPath();
        ctx.rect(ws.x - L, ws.y - H - wu * 3, L * 2, H + wu * 3);
        ctx.clip();
        ctx.fillStyle = '#40606f';
        ctx.beginPath();
        ctx.ellipse(ws.x, ws.y, L * 0.62, Math.max(0.01, H), 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#54798a';
        ctx.beginPath();
        ctx.ellipse(ws.x - L * 0.12, ws.y - H * 0.28, L * 0.42, Math.max(0.01, H * 0.55), -0.08, 0, TAU);
        ctx.fill();
        ctx.restore();
        if (t > 0.55 && rise > 0.05) {
          var fl = Math.sin((t - 0.55) / 0.45 * Math.PI);
          var fx = ws.x - L * 0.66, fy = ws.y - fl * wu * 2.4;
          ctx.fillStyle = '#40606f';
          ctx.beginPath();
          ctx.moveTo(fx, fy + wu * 1.2);
          ctx.quadraticCurveTo(fx - wu * 1.6, fy - wu * 0.6, fx - wu * 1.1, fy - wu * 1.1);
          ctx.quadraticCurveTo(fx - wu * 0.2, fy - wu * 0.5, fx + wu * 0.2, fy - wu * 1.2);
          ctx.quadraticCurveTo(fx + wu * 0.9, fy - wu * 0.4, fx, fy + wu * 1.2);
          ctx.closePath();
          ctx.fill();
        }
        if (t > 0.2 && t < 0.5) {
          var sp = (t - 0.2) / 0.3;
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * (1 - sp)) + ')';
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          for (var j = -1; j <= 1; j++) {
            ctx.beginPath();
            ctx.moveTo(ws.x + L * 0.4, ws.y - H);
            ctx.lineTo(ws.x + L * 0.4 + j * wu * (0.7 + sp), ws.y - H - wu * (1.4 + sp * 1.6));
            ctx.stroke();
          }
        }
      }
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
        var spl = this.splashes[i];
        var age = (now - spl.t0) / 900;
        var ss = R.toScreen(spl);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.65 * (1 - age)) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(ss.x, ss.y, (1 + age * 4) * R.cam.scale * 0.6,
          (1 + age * 4) * R.cam.scale * 0.6 * R.cam.tilt, 0, 0, TAU);
        ctx.stroke();
      }
    },

    // ducks, turtle, deer (after ground, before trees → deer can stand
    // behind trees)
    drawLand: function (R) {
      var ctx = R.ctx;
      var sc = R.cam.scale;

      this.ducks.forEach(function (d) {
        var s = R.toScreen(d);
        var u = sc * 0.8;
        var bob = Math.sin(performance.now() / 600 + d.phase) * u * 0.12;
        var dir = Math.sin(d.heading) >= 0 ? 1 : -1;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(s.x - dir * u * 1.2, s.y + u * 0.35);
        ctx.lineTo(s.x - dir * u * 2.4, s.y + u * 0.7);
        ctx.moveTo(s.x - dir * u * 1.2, s.y - u * 0.05);
        ctx.lineTo(s.x - dir * u * 2.4, s.y - u * 0.35);
        ctx.stroke();
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
        var u = sc * 1.15;
        var step = Math.sin(tu.phase) * u * 0.1;
        var dir = Math.sin(tu.heading) >= 0 ? 1 : -1;
        ctx.fillStyle = 'rgba(120,100,60,0.3)';
        ctx.beginPath();
        ctx.ellipse(s.x + u * 0.3, s.y + u * 0.15, u * 1.2, u * 0.5, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#5f8f4a';
        [[-0.9, -0.35], [0.7, -0.4], [-0.85, 0.4], [0.75, 0.42]].forEach(function (fp, i) {
          ctx.beginPath();
          ctx.ellipse(s.x + fp[0] * u + (i % 2 ? step : -step), s.y + fp[1] * u, u * 0.32, u * 0.16, fp[0], 0, TAU);
          ctx.fill();
        });
        ctx.beginPath();
        ctx.arc(s.x + dir * u * 1.1, s.y - u * 0.15, u * 0.26, 0, TAU);
        ctx.fill();
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
        var fade = Math.min(1, de.age / 500, (de.life - de.age) / 700);
        var graze = de.grazing ? Math.max(0, Math.sin(de.age / 700 + de.phase)) * u * 0.55 : 0;
        var f = Math.sin(de.heading) >= 0 ? 1 : -1;
        ctx.save();
        ctx.globalAlpha = Math.max(0, fade);
        R.dropShadow(s.x, s.y, u * 2.4, u * 1.5);
        ctx.strokeStyle = '#8a6238';
        ctx.lineWidth = Math.max(1.2, u * 0.16);
        [[-0.8, 0], [-0.35, Math.PI], [0.35, 0.4], [0.8, Math.PI + 0.4]].forEach(function (lg) {
          var swing = de.grazing ? 0 : Math.sin(de.walk + lg[1]) * u * 0.28;
          ctx.beginPath();
          ctx.moveTo(s.x + lg[0] * u * f, s.y - u * 1.1);
          ctx.lineTo(s.x + lg[0] * u * f + swing * f, s.y);
          ctx.stroke();
        });
        ctx.fillStyle = '#a9743f';
        ctx.beginPath();
        ctx.ellipse(s.x, s.y - u * 1.35, u * 1.15, u * 0.62, 0, 0, TAU);
        ctx.fill();
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
        ctx.beginPath();
        ctx.ellipse(hx - f * u * 0.25, hy - u * 0.3, u * 0.2, u * 0.09, f * 0.9, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#f4ead6';
        ctx.beginPath();
        ctx.arc(s.x - f * u * 1.1, s.y - u * 1.5, u * 0.16, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (this.yeti) {
        var ye = this.yeti;
        var s = R.toScreen(ye);
        var u = sc * 1.05;
        var f = Math.sin(ye.heading) >= 0 ? 1 : -1;
        var bounce = Math.abs(Math.sin(ye.run * 2)) * u * 0.25;
        var fade = Math.min(1, ye.age / 300, (16000 - ye.age) / 400);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fade));
        R.dropShadow(s.x, s.y, u * 1.8, u * 2.2);
        var by = s.y - u * 1.5 - bounce; // body centre, bobbing with the sprint
        // running legs
        ctx.strokeStyle = '#dfe6ea';
        ctx.lineWidth = Math.max(2, u * 0.34);
        ctx.lineCap = 'round';
        for (var li = 0; li < 2; li++) {
          var kick = Math.sin(ye.run * 2 + li * Math.PI) * u * 0.55;
          ctx.beginPath();
          ctx.moveTo(s.x, by + u * 0.5);
          ctx.lineTo(s.x + kick * f - f * u * 0.15, s.y - bounce * 0.3);
          ctx.stroke();
        }
        // shaggy body
        ctx.fillStyle = '#eef2f5';
        ctx.beginPath();
        ctx.ellipse(s.x, by, u * 0.85, u * 1.05, f * 0.12, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#d3dce2';
        ctx.beginPath();
        ctx.ellipse(s.x + f * u * 0.25, by + u * 0.15, u * 0.55, u * 0.75, f * 0.2, 0, TAU);
        ctx.fill();
        // swinging arms
        ctx.strokeStyle = '#eef2f5';
        ctx.lineWidth = Math.max(2, u * 0.3);
        for (li = 0; li < 2; li++) {
          var swing = Math.sin(ye.run * 2 + li * Math.PI + 1.2) * u * 0.5;
          ctx.beginPath();
          ctx.moveTo(s.x - f * u * 0.1, by - u * 0.35);
          ctx.lineTo(s.x + swing * f + f * u * 0.5, by + u * 0.35);
          ctx.stroke();
        }
        // head, leaning into the run
        var hx = s.x + f * u * 0.55, hy = by - u * 1.15;
        ctx.fillStyle = '#eef2f5';
        ctx.beginPath();
        ctx.arc(hx, hy, u * 0.5, 0, TAU);
        ctx.fill();
        // dark face
        ctx.fillStyle = '#5b6670';
        ctx.beginPath();
        ctx.ellipse(hx + f * u * 0.14, hy + u * 0.05, u * 0.28, u * 0.32, 0, 0, TAU);
        ctx.fill();
        // eyes
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(hx + f * u * 0.08, hy - u * 0.05, u * 0.06, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(hx + f * u * 0.26, hy - u * 0.05, u * 0.06, 0, TAU); ctx.fill();
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
})();
