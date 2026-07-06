// Shot simulation. Fully deterministic: the same shot params produce the
// same result on both clients, so only the inputs are synced and each side
// replays the flight locally for the animation.
(function () {
  'use strict';

  var CLUBS = [
    { id: 'driver', name: 'Driver', short: 'DR', carry: 232, roll: 26, loft: 0.32, meterSpeed: 1.2 },
    { id: 'wood3', name: '3 Wood', short: '3W', carry: 205, roll: 20, loft: 0.38, meterSpeed: 1.12 },
    { id: 'iron5', name: '5 Iron', short: '5i', carry: 175, roll: 13, loft: 0.5, meterSpeed: 1.0 },
    { id: 'iron7', name: '7 Iron', short: '7i', carry: 148, roll: 9, loft: 0.62, meterSpeed: 0.94 },
    { id: 'iron9', name: '9 Iron', short: '9i', carry: 118, roll: 6, loft: 0.74, meterSpeed: 0.88 },
    { id: 'wedge', name: 'Wedge', short: 'W', carry: 82, roll: 3, loft: 0.95, meterSpeed: 0.82 },
    { id: 'putter', name: 'Putter', short: 'PT', carry: 40, roll: 0, loft: 0, meterSpeed: 0.75 },
  ];

  function club(id) {
    for (var i = 0; i < CLUBS.length; i++) if (CLUBS[i].id === id) return CLUBS[i];
    return CLUBS[2];
  }

  // How much a lie hurts the strike (multiplies carry).
  function lieFactor(lie, clubId) {
    if (lie === 'rough') return 0.72;
    if (lie === 'sand') return clubId === 'wedge' ? 0.8 : 0.5;
    return 1.0; // tee, fairway, green
  }

  // Roll friction per terrain (multiplies remaining roll each yard-step).
  function rollFactor(terr) {
    if (terr === 'green') return 1.25;
    if (terr === 'fairway') return 1.0;
    if (terr === 'rough') return 0.35;
    if (terr === 'sand') return 0.08;
    return 1.0;
  }

  var HOLE_CAPTURE = 1.6; // yards — resting/passing this close to the pin drops in

  // shot: { club, aim (radians), power 0..1, acc -1..1 }
  // ball: { x, y, lie }
  // Returns { keys: [{t,x,y,h}], rest: {x,y}, lie, water, holed, feedback, carryPoint }
  function simulate(hole, ball, shot) {
    if (shot.club === 'putter') return simulatePutt(hole, ball, shot);

    var c = club(shot.club);
    var lf = lieFactor(ball.lie, c.id);
    var carry = c.carry * shot.power * lf;

    // Mishit shaping: acc < 0 → hook (curves left of aim), acc > 0 → slice.
    var curve = shot.acc * carry * 0.42;

    var dirX = Math.sin(shot.aim), dirY = Math.cos(shot.aim);
    var perpX = dirY, perpY = -dirX; // right of aim

    // Wind drift while airborne (high loft + long carry = more drift).
    var w = hole.wind;
    var driftMag = w.mph * c.loft * (carry / 100) * 0.9;
    var wdx = Math.cos(w.angle) * driftMag, wdy = Math.sin(w.angle) * driftMag;

    var land = {
      x: ball.x + dirX * carry + perpX * curve + wdx,
      y: ball.y + dirY * carry + perpY * curve + wdy,
    };

    // Flight keyframes (t normalized 0..1 over the flight).
    var keys = [];
    var apex = 8 + carry * 0.13 * (0.6 + c.loft); // fake height, for scale/shadow
    var S = 26;
    for (var i = 0; i <= S; i++) {
      var t = i / S;
      var px = ball.x + dirX * carry * t + perpX * curve * t * t + wdx * t * t;
      var py = ball.y + dirY * carry * t + perpY * curve * t * t + wdy * t * t;
      keys.push({ t: t, x: px, y: py, h: apex * 4 * t * (1 - t) });
    }

    var result = rollOut(hole, land, keys, {
      dirX: dirX + perpX * (curve / Math.max(carry, 1)) * 2,
      dirY: dirY + perpY * (curve / Math.max(carry, 1)) * 2,
      rollDist: c.roll * shot.power * (0.5 + lf * 0.5),
      bounce: true,
    });

    result.feedback = feedbackFor(shot, result);
    result.carryPoint = land;
    return result;
  }

  function simulatePutt(hole, ball, shot) {
    var offGreen = ball.lie !== 'green' && ball.lie !== 'tee' && ball.lie !== 'fairway';
    var maxDist = 42 * (offGreen ? 0.5 : 1);
    var distTotal = maxDist * shot.power;
    var aim = shot.aim + shot.acc * 0.09; // mistimed putts push/pull
    var keys = [{ t: 0, x: ball.x, y: ball.y, h: 0 }];
    var result = rollOut(hole, { x: ball.x, y: ball.y }, keys, {
      dirX: Math.sin(aim), dirY: Math.cos(aim),
      rollDist: distTotal, bounce: false, isPutt: true,
    });
    if (result.holed) result.feedback = { text: 'In the hole!', tone: 'great' };
    else if (Math.abs(shot.acc) > 0.5) result.feedback = { text: shot.acc > 0 ? 'Pushed it!' : 'Pulled it!', tone: 'bad' };
    else result.feedback = null;
    return result;
  }

  // Steps the ball along the ground from `start`, appending keyframes.
  // Distances in yards; friction varies with the terrain under the ball.
  function rollOut(hole, start, keys, opts) {
    var x = start.x, y = start.y;
    var len = Math.sqrt(opts.dirX * opts.dirX + opts.dirY * opts.dirY) || 1;
    var dx = opts.dirX / len, dy = opts.dirY / len;

    var terr = Course.terrainAt(hole, { x: x, y: y });
    var holed = false, water = false;

    if (terr === 'water') {
      keys.push({ t: 1.15, x: x, y: y, h: -1, splash: true });
      return { keys: keys, rest: null, water: true, holed: false };
    }

    var remaining = opts.rollDist;
    if (opts.bounce) {
      // one bounce hop covering ~25% of the roll
      var hop = Math.min(remaining * 0.3, 12);
      var hx = x + dx * hop, hy = y + dy * hop;
      var ht = Course.terrainAt(hole, { x: hx, y: hy });
      if (ht === 'water') {
        keys.push({ t: 1.12, x: hx, y: hy, h: -1, splash: true });
        return { keys: keys, rest: null, water: true, holed: false };
      }
      keys.push({ t: 1.08, x: (x + hx) / 2, y: (y + hy) / 2, h: 3.2 });
      keys.push({ t: 1.16, x: hx, y: hy, h: 0 });
      x = hx; y = hy;
      remaining -= hop;
    }

    var t = opts.bounce ? 1.16 : 0;
    var step = 1.0;
    var travelled = 0;
    var total = Math.max(remaining, 0.01);
    while (remaining > 0.5) {
      var nx = x + dx * step, ny = y + dy * step;
      var nterr = Course.terrainAt(hole, { x: nx, y: ny });
      if (nterr === 'water') {
        keys.push({ t: t + 0.1, x: nx, y: ny, h: -1, splash: true });
        water = true;
        break;
      }
      x = nx; y = ny;
      travelled += step;
      t += (opts.isPutt ? 1.6 : 0.9) * (step / total) * (0.4 + 0.6 * (remaining / total));
      keys.push({ t: t, x: x, y: y, h: 0 });
      // only drop in if the ball is rolling slowly enough — fast rolls skip
      // over the cup like in real golf
      if (remaining < 14 && Course.dist({ x: x, y: y }, hole.pin) < HOLE_CAPTURE) { holed = true; break; }
      // `remaining` is in fairway-equivalent yards: slower terrain under the
      // ball consumes it faster, so a roll dies quickly in rough or sand.
      remaining -= step / Math.max(rollFactor(nterr), 0.06);
      terr = nterr;
    }

    if (holed) {
      keys.push({ t: t + 0.15, x: hole.pin.x, y: hole.pin.y, h: 0, drop: true });
      return { keys: keys, rest: { x: hole.pin.x, y: hole.pin.y }, water: false, holed: true };
    }
    if (water) return { keys: keys, rest: null, water: true, holed: false };

    var lie = Course.terrainAt(hole, { x: x, y: y });
    if (lie === 'water') lie = 'rough';
    return { keys: keys, rest: { x: x, y: y }, lie: lie === 'tee' ? 'fairway' : lie, water: false, holed: false };
  }

  function feedbackFor(shot, result) {
    if (result.holed) return { text: 'It’s in!!', tone: 'great' };
    if (result.water) return { text: 'Splash! +1 penalty', tone: 'bad' };
    var a = shot.acc;
    if (shot.power < 0.5) return { text: 'Chunked it…', tone: 'bad' };
    if (Math.abs(a) <= 0.06) {
      return shot.power >= 0.97 ? { text: 'PERFECT strike!', tone: 'great' } : { text: 'Pure!', tone: 'good' };
    }
    if (a > 0.45) return { text: 'Sliced it!', tone: 'bad' };
    if (a < -0.45) return { text: 'Hooked it!', tone: 'bad' };
    if (a > 0.12) return { text: 'A little fade…', tone: 'ok' };
    if (a < -0.12) return { text: 'A little draw…', tone: 'ok' };
    return { text: 'Good strike', tone: 'good' };
  }

  window.Physics = {
    CLUBS: CLUBS,
    club: club,
    lieFactor: lieFactor,
    simulate: simulate,
    HOLE_CAPTURE: HOLE_CAPTURE,
  };
})();
