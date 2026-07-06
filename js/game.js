// Main controller: screens, character creator, lobby, turn flow, swing
// meter, shot animation and realtime sync.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ---------- connection abstraction ----------
  // Online rooms sync via Firebase; practice rounds use an in-memory room
  // with the exact same data shape so the game logic has one code path.

  function FirebaseConn(code) {
    this.code = code;
    this.isLocal = false;
  }
  FirebaseConn.prototype.watch = function (cb) { Net.watchRoom(this.code, cb); };
  FirebaseConn.prototype.write = function (updates) { return Net.write(this.code, updates); };
  FirebaseConn.prototype.close = function () { Net.unwatch(); };

  function LocalConn(holes, me) {
    this.isLocal = true;
    this.room = {
      meta: { holes: holes, seed: RNG.newSeed(), hostUid: 'me', status: 'playing' },
      players: { me: { name: me.name || 'You', char: me } },
    };
  }
  LocalConn.prototype.watch = function (cb) { this.cb = cb; cb(JSON.parse(JSON.stringify(this.room))); };
  LocalConn.prototype.write = function (updates) {
    var room = this.room;
    Object.keys(updates).forEach(function (path) {
      var parts = path.split('/');
      var node = room;
      for (var i = 0; i < parts.length - 1; i++) {
        if (node[parts[i]] == null) node[parts[i]] = {};
        node = node[parts[i]];
      }
      var v = updates[path];
      if (v === null) delete node[parts[parts.length - 1]];
      else node[parts[parts.length - 1]] = v;
    });
    if (this.cb) this.cb(JSON.parse(JSON.stringify(room)));
    return Promise.resolve();
  };
  LocalConn.prototype.close = function () { this.cb = null; };

  // ---------- app state ----------

  var me = Character.load();
  var myUid = null;           // 'me' in practice mode
  var conn = null;
  var room = null;
  var course = null;          // generated holes
  var courseKey = '';         // seed+holes used to build `course`
  var renderer = null;

  var phase = 'home';         // home | lobby | watch | aim | power | accuracy | anim | summary | final
  var aimAngle = 0;
  var selectedClub = 'driver';
  var meter = null;           // {value, dir, speed, power, phase}
  var anim = null;            // {uid, shotN, keys, result, start, dur, shot}
  var pendingBalls = {};      // local result overrides until sync catches up
  var lastShotN = 0;
  var splash = null;
  var advanceTimer = null;
  var bannerTimer = null;

  var STROKE_CAP = 8;
  // With persist=none (dev harness) frames share localStorage but not auth
  // identity, so room save/rejoin would misbehave — skip it there.
  var REMEMBER_ROOM = window.GOLF_CONFIG.authPersistence !== 'none';

  // ---------- boot ----------

  function boot() {
    renderer = new Renderer($('course'));
    buildCreator();
    bindUi();
    requestAnimationFrame(frame);

    Net.init().then(function (uid) {
      myUid = uid;
      $('home-status').textContent = '';
      // auto-rejoin a live game
      var saved = REMEMBER_ROOM && localStorage.getItem('golf.room');
      if (saved) {
        Net.joinRoom(saved, { name: playerName(), char: me }).then(function (code) {
          enterRoom(new FirebaseConn(code), code);
        }).catch(function () { localStorage.removeItem('golf.room'); });
      }
    }).catch(function (e) {
      $('home-status').textContent = 'Could not connect: ' + e.message;
    });
  }

  function playerName() {
    return (me.name || '').trim() || 'Golfer';
  }

  // ---------- character creator ----------

  function buildCreator() {
    var rows = [
      { key: 'skin', label: 'Skin', arr: Character.SKINS },
      { key: 'shirt', label: 'Shirt', arr: Character.COLORS },
      { key: 'hat', label: 'Hat', arr: Character.HATS },
      { key: 'hatColor', label: 'Hat colour', arr: Character.COLORS },
    ];
    var wrap = $('creator-rows');
    rows.forEach(function (row) {
      var div = document.createElement('div');
      div.className = 'creator-row';
      var lab = document.createElement('span');
      lab.textContent = row.label;
      var left = mkBtn('‹', function () { cycle(row, -1); });
      var val = document.createElement('span');
      val.className = 'creator-val';
      val.id = 'val-' + row.key;
      var right = mkBtn('›', function () { cycle(row, 1); });
      div.appendChild(lab); div.appendChild(left); div.appendChild(val); div.appendChild(right);
      wrap.appendChild(div);
    });
    $('name-input').value = me.name || '';
    $('name-input').addEventListener('input', function () {
      me.name = this.value.slice(0, 14);
      Character.save(me);
    });
    updateCreator();

    function mkBtn(txt, fn) {
      var b = document.createElement('button');
      b.className = 'btn small';
      b.textContent = txt;
      b.addEventListener('click', fn);
      return b;
    }
    function cycle(row, d) {
      me[row.key] = (me[row.key] + d + row.arr.length) % row.arr.length;
      Character.save(me);
      updateCreator();
    }
  }

  function updateCreator() {
    var names = { skin: Character.SKINS, shirt: Character.COLORS, hat: Character.HATS, hatColor: Character.COLORS };
    ['skin', 'shirt', 'hat', 'hatColor'].forEach(function (k) {
      var el = $('val-' + k);
      if (k === 'hat') el.textContent = Character.HATS[me.hat];
      else {
        el.textContent = '';
        el.style.background = names[k][me[k]];
        el.classList.add('swatch');
      }
    });
    var cv = $('char-preview');
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    Character.draw(ctx, me, cv.width / 2, cv.height - 18, 3.1);
  }

  // ---------- ui bindings ----------

  function bindUi() {
    $('btn-create').addEventListener('click', function () {
      var holes = parseInt(document.querySelector('input[name=holes]:checked').value, 10);
      setStatus('Creating game…');
      Net.createRoom({ holes: holes, name: playerName(), char: me }).then(function (code) {
        if (REMEMBER_ROOM) localStorage.setItem('golf.room', code);
        enterRoom(new FirebaseConn(code), code);
      }).catch(function (e) { setStatus(e.message); });
    });

    $('btn-join').addEventListener('click', function () {
      var code = $('join-code').value;
      if (!code || code.trim().length < 4) { setStatus('Enter the 4-letter game code'); return; }
      setStatus('Joining…');
      Net.joinRoom(code, { name: playerName(), char: me }).then(function (c) {
        if (REMEMBER_ROOM) localStorage.setItem('golf.room', c);
        enterRoom(new FirebaseConn(c), c);
      }).catch(function (e) { setStatus(e.message); });
    });

    $('btn-practice').addEventListener('click', function () {
      var holes = parseInt(document.querySelector('input[name=holes]:checked').value, 10);
      myUid = myUid || 'me';
      var c = new LocalConn(holes, me);
      c.room.players = {};
      c.room.players[myUid] = { name: playerName(), char: me };
      enterRoom(c, null);
    });

    $('btn-copy').addEventListener('click', function () {
      var code = $('lobby-code').textContent;
      navigator.clipboard && navigator.clipboard.writeText(code);
      $('btn-copy').textContent = 'Copied!';
      setTimeout(function () { $('btn-copy').textContent = 'Copy code'; }, 1500);
    });

    $('btn-leave').addEventListener('click', leaveGame);
    $('btn-exit-final').addEventListener('click', leaveGame);
    $('btn-rematch').addEventListener('click', rematch);

    $('btn-scorecard').addEventListener('click', function () {
      var el = $('overlay-scorecard');
      if (el.classList.contains('show')) el.classList.remove('show');
      else { renderScorecard('scorecard-body'); el.classList.add('show'); }
    });
    $('btn-close-scorecard').addEventListener('click', function () {
      $('overlay-scorecard').classList.remove('show');
    });

    // club buttons
    var bar = $('clubbar');
    Physics.CLUBS.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'club';
      b.dataset.club = c.id;
      b.innerHTML = '<b>' + c.short + '</b><i>' + (c.id === 'putter' ? 'roll' : c.carry + 'y') + '</i>';
      b.addEventListener('click', function () {
        if (phase !== 'aim') return;
        selectedClub = c.id;
        updateClubBar();
      });
      bar.appendChild(b);
    });

    // swing button drives the whole meter flow
    $('btn-swing').addEventListener('click', onSwingTap);

    // aiming by dragging on the canvas
    var canvas = $('course');
    var aiming = false;
    canvas.addEventListener('pointerdown', function (e) {
      if (phase !== 'aim') return;
      aiming = true;
      setAimFromEvent(e);
    });
    window.addEventListener('pointermove', function (e) {
      if (aiming && phase === 'aim') setAimFromEvent(e);
    });
    window.addEventListener('pointerup', function () { aiming = false; });

    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); onSwingTap(); }
      if (phase === 'aim') {
        if (e.key === 'ArrowLeft') { aimAngle -= 0.03; }
        if (e.key === 'ArrowRight') { aimAngle += 0.03; }
      }
    });
  }

  function setStatus(msg) { $('home-status').textContent = msg || ''; }

  function setAimFromEvent(e) {
    var rect = $('course').getBoundingClientRect();
    var w = renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
    var b = myBall();
    aimAngle = Math.atan2(w.x - b.x, w.y - b.y);
  }

  // ---------- room lifecycle ----------

  function enterRoom(c, code) {
    conn = c;
    lastShotN = 0;
    pendingBalls = {};
    anim = null;
    course = null; courseKey = '';
    if (code) {
      $('lobby-code').textContent = code;
      showScreen('lobby');
      phase = 'lobby';
    }
    // watch last: the first room callback may immediately move us to the game
    conn.watch(onRoom);
  }

  function leaveGame() {
    if (conn) conn.close();
    conn = null; room = null; course = null;
    localStorage.removeItem('golf.room');
    clearTimeout(advanceTimer); advanceTimer = null;
    $('overlay-summary').classList.remove('show');
    $('overlay-final').classList.remove('show');
    $('overlay-scorecard').classList.remove('show');
    phase = 'home';
    showScreen('home');
    updateCreator();
  }

  function rematch() {
    conn.write({
      'meta/seed': RNG.newSeed(),
      'meta/status': 'playing',
      'game': null,
    });
    $('overlay-final').classList.remove('show');
  }

  function onRoom(data) {
    room = data;
    if (!room || !room.meta) { if (phase !== 'home') leaveGame(); return; }

    // (re)build course when seed changes (new game / rematch)
    var key = room.meta.seed + ':' + room.meta.holes;
    if (key !== courseKey) {
      course = Course.generate(room.meta.seed, room.meta.holes);
      courseKey = key;
      lastShotN = 0;
      pendingBalls = {};
      anim = null;
      lastHole = -1;
      $('overlay-summary').classList.remove('show');
      $('overlay-final').classList.remove('show');
    }

    if (room.meta.status === 'waiting') {
      renderLobby();
      return;
    }

    if (phase === 'lobby' || phase === 'home') {
      showScreen('game');
      phase = 'watch';
    }

    if (room.meta.status === 'done') {
      showFinal();
      return;
    }

    // react to a new shot from the other player
    var shot = game().shot;
    if (shot && shot.n > lastShotN && shot.hole === holeIndex()) {
      lastShotN = shot.n;
      if (shot.uid !== myUid) startAnimation(shot);
    } else if (shot) {
      lastShotN = Math.max(lastShotN, shot.n);
    }

    refreshTurn();
    updateHud();
    maybeAdvanceHole();
  }

  function game() { return (room && room.game) || {}; }
  function holeIndex() { return game().holeIndex || 0; }
  function hole() { return course ? course[holeIndex()] : null; }
  function playerIds() {
    var ids = Object.keys((room && room.players) || {});
    ids.sort(function (a, b) {
      var pa = room.players[a].joinedAt || 0, pb = room.players[b].joinedAt || 0;
      return pa === pb ? (a < b ? -1 : 1) : pa - pb;
    });
    return ids;
  }

  function ballOf(uid) {
    if (anim && anim.uid === uid) {
      // mid-animation: ball is "in flight", keep it at its origin
      return anim.fromBall;
    }
    if (pendingBalls[uid]) {
      var synced = game().balls && game().balls[uid];
      if (synced && synced.strokes >= pendingBalls[uid].strokes) delete pendingBalls[uid];
      else return pendingBalls[uid];
    }
    var b = game().balls && game().balls[uid];
    if (b) return b;
    var h = hole();
    return { x: h ? h.tee.x : 0, y: h ? h.tee.y : 0, lie: 'tee', strokes: 0, holed: false };
  }

  function myBall() { return ballOf(myUid); }

  function scoreOf(uid, hIdx) {
    var s = game().scores;
    return s && s[uid] && s[uid]['h' + hIdx] != null ? s[uid]['h' + hIdx] : null;
  }

  // Whose turn: players still teeing off go first (honors order), then the
  // player farthest from the pin. Returns null when the hole is finished.
  function whoseTurn() {
    var ids = playerIds();
    var h = hole();
    if (!h) return null;
    var active = ids.filter(function (id) { return !ballOf(id).holed; });
    if (!active.length) return null;
    var waiting = active.filter(function (id) { return ballOf(id).strokes === 0; });
    if (waiting.length) return honorsOrder(waiting)[0];
    active.sort(function (a, b) {
      return Course.dist(ballOf(b), h.pin) - Course.dist(ballOf(a), h.pin);
    });
    return active[0];
  }

  function honorsOrder(ids) {
    var hIdx = holeIndex();
    if (hIdx === 0) return ids.slice().sort(hostFirst);
    return ids.slice().sort(function (a, b) {
      var sa = scoreOf(a, hIdx - 1), sb = scoreOf(b, hIdx - 1);
      if (sa == null || sb == null || sa === sb) return hostFirst(a, b);
      return sa - sb;
    });
  }
  function hostFirst(a, b) {
    if (a === room.meta.hostUid) return -1;
    if (b === room.meta.hostUid) return 1;
    return a < b ? -1 : 1;
  }

  function refreshTurn() {
    if (anim || phase === 'power' || phase === 'accuracy' || phase === 'summary' || phase === 'final') return;
    var turn = whoseTurn();
    if (turn === myUid && phase !== 'aim') beginAim();
    else if (turn !== myUid && phase === 'aim') phase = 'watch';
    updateSwingUi();
  }

  function beginAim() {
    phase = 'aim';
    var h = hole();
    var b = myBall();
    selectedClub = suggestClub(b, h);
    aimAngle = defaultAim(b, h);
    updateClubBar();
    updateSwingUi();
  }

  // Aim down the fairway: target the centerline point closest to our club
  // reach (or the pin, if we can get there).
  function defaultAim(b, h) {
    var c = Physics.club(selectedClub);
    var reach = c.carry * Physics.lieFactor(b.lie, c.id);
    var toPin = Course.dist(b, h.pin);
    if (c.id === 'putter' || reach >= toPin * 0.95) {
      return Math.atan2(h.pin.x - b.x, h.pin.y - b.y);
    }
    var best = h.pin, bestErr = Infinity;
    for (var i = 0; i < h.line.length; i++) {
      var p = h.line[i];
      // only consider points that move us toward the green
      if (Course.dist(p, h.pin) >= toPin - 5) continue;
      var err = Math.abs(Course.dist(b, p) - reach);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    return Math.atan2(best.x - b.x, best.y - b.y);
  }

  function suggestClub(b, h) {
    if (b.lie === 'green') return 'putter';
    var d = Course.dist(b, h.pin);
    if (d < 30) return b.lie === 'sand' ? 'wedge' : 'putter';
    var lf = Physics.lieFactor(b.lie, 'iron5');
    var clubs = Physics.CLUBS;
    for (var i = clubs.length - 2; i >= 0; i--) {
      var reach = clubs[i].carry * Physics.lieFactor(b.lie, clubs[i].id) + clubs[i].roll * 0.6;
      if (reach >= d * 0.98) return clubs[i].id;
    }
    return 'driver';
  }

  // ---------- swing meter ----------

  function onSwingTap() {
    if (phase === 'aim') {
      meter = { value: 0, dir: 1, speed: 150 * Physics.club(selectedClub).meterSpeed, power: null, last: performance.now() };
      phase = 'power';
      updateSwingUi();
    } else if (phase === 'power') {
      meter.power = Math.max(0.08, meter.value / 100);
      phase = 'accuracy';
      meter.dir = -1;
      updateSwingUi();
    } else if (phase === 'accuracy') {
      fireShot(meter.value);
    }
  }

  function tickMeter(now) {
    if (!meter || (phase !== 'power' && phase !== 'accuracy')) return;
    var dt = Math.min(0.05, (now - meter.last) / 1000);
    meter.last = now;
    meter.value += meter.dir * meter.speed * dt;
    if (phase === 'power') {
      if (meter.value >= 100) { meter.value = 100; meter.dir = -1; }
      if (meter.value <= 0 && meter.dir === -1) { // swung back without committing
        meter = null;
        phase = 'aim';
        updateSwingUi();
        return;
      }
    } else if (phase === 'accuracy') {
      if (meter.value <= -26) fireShot(-26); // whiffed the timing → big slice
    }
    drawMeter();
  }

  function drawMeter() {
    var fill = $('meter-fill');
    var mark = $('meter-marker');
    var range = 130; // -30 .. 100
    var pct = function (v) { return (100 - v) / range * 100; };
    mark.style.top = pct(Math.max(-30, Math.min(100, meter ? meter.value : 0))) + '%';
    var p = meter && meter.power != null ? meter.power * 100 : (phase === 'power' && meter ? meter.value : 0);
    fill.style.top = pct(p) + '%';
    fill.style.bottom = (100 - pct(0)) + '%';
  }

  function fireShot(accValue) {
    var acc = (0 - accValue) / 20;
    acc = Math.max(-1, Math.min(1.3, acc));
    if (Math.abs(acc) <= 0.06) acc = 0;
    var b = myBall();
    var shot = {
      n: (game().shot ? game().shot.n : 0) + 1,
      uid: myUid,
      hole: holeIndex(),
      from: { x: b.x, y: b.y, lie: b.lie || 'fairway', strokes: b.strokes || 0 },
      club: selectedClub,
      aim: aimAngle,
      power: meter.power,
      acc: acc,
      ts: Date.now(),
    };
    meter = null;
    lastShotN = shot.n;
    conn.write({ 'game/shot': shot });
    startAnimation(shot);
  }

  // ---------- shot animation ----------

  function startAnimation(shot) {
    var h = course[shot.hole];
    var fromBall = { x: shot.from.x, y: shot.from.y, lie: shot.from.lie, strokes: shot.from.strokes };
    var result = Physics.simulate(h, fromBall, shot);
    var maxT = result.keys[result.keys.length - 1].t;
    var carryDist = result.carryPoint ? Course.dist(shot.from, result.carryPoint) : 30;
    var dur = shot.club === 'putter'
      ? 600 + maxT * 900
      : (700 + carryDist * 4.5) * (maxT / Math.max(maxT, 1)) + (maxT - 1) * 500;
    anim = {
      uid: shot.uid, shot: shot, keys: result.keys, result: result,
      fromBall: fromBall, start: performance.now(), dur: Math.max(500, dur), maxT: maxT,
    };
    phase = 'anim';
    updateSwingUi();
    $('overlay-scorecard').classList.remove('show');
  }

  function tickAnimation(now) {
    if (!anim) return;
    var t = ((now - anim.start) / anim.dur) * anim.maxT;
    if (t >= anim.maxT) { finishAnimation(); return; }
    // interpolate keys
    var keys = anim.keys;
    var pos = keys[keys.length - 1];
    for (var i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) {
        var span = keys[i + 1].t - keys[i].t || 1e-6;
        var f = (t - keys[i].t) / span;
        pos = {
          x: keys[i].x + (keys[i + 1].x - keys[i].x) * f,
          y: keys[i].y + (keys[i + 1].y - keys[i].y) * f,
          h: keys[i].h + (keys[i + 1].h - keys[i].h) * f,
        };
        break;
      }
    }
    anim.pos = pos;
  }

  function finishAnimation() {
    var a = anim;
    anim = null;
    var shot = a.shot, result = a.result;
    var newStrokes = shot.from.strokes + (result.water ? 2 : 1);
    var holed = result.holed;
    var ball;
    if (result.water) {
      splash = { x: a.keys[a.keys.length - 1].x, y: a.keys[a.keys.length - 1].y, t0: performance.now() };
      ball = { x: shot.from.x, y: shot.from.y, lie: shot.from.lie, strokes: newStrokes, holed: false };
    } else {
      ball = { x: result.rest.x, y: result.rest.y, lie: result.lie || 'green', strokes: newStrokes, holed: holed };
    }
    if (!holed && newStrokes >= STROKE_CAP) {
      ball.holed = true;
      holed = true;
      result.feedback = { text: 'Picked up (max ' + STROKE_CAP + ')', tone: 'bad' };
    }
    pendingBalls[shot.uid] = ball;

    if (result.feedback) showFeedback(result.feedback, shot.uid);

    // Only the player who hit the shot writes the outcome.
    if (shot.uid === myUid) {
      var updates = {};
      updates['game/balls/' + myUid] = ball;
      updates['game/holeIndex'] = holeIndex(); // ensure node exists
      if (ball.holed) updates['game/scores/' + myUid + '/h' + shot.hole] = ball.strokes;
      conn.write(updates);
    }

    phase = 'watch';
    refreshTurn();
    updateHud();
    maybeAdvanceHole();
  }

  // ---------- hole / game progression ----------

  function maybeAdvanceHole() {
    if (!room || room.meta.status !== 'playing' || anim) return;
    var ids = playerIds();
    var allHoled = ids.length > 0 && ids.every(function (id) { return ballOf(id).holed; });
    if (!allHoled) return;

    phase = 'summary';
    showSummary(); // re-render as late score writes sync in
    // host advances the game for everyone
    var isHost = conn.isLocal || room.meta.hostUid === myUid;
    if (isHost && !advanceTimer) {
      advanceTimer = setTimeout(function () {
        advanceTimer = null;
        var next = holeIndex() + 1;
        if (next >= room.meta.holes) {
          conn.write({ 'meta/status': 'done' });
        } else {
          conn.write({ 'game/holeIndex': next, 'game/balls': null, 'game/shot': null });
        }
      }, 4600);
    }
  }

  function onNewHole() {
    $('overlay-summary').classList.remove('show');
    pendingBalls = {};
    splash = null;
    phase = 'watch';
    var h = hole();
    banner('Hole ' + (holeIndex() + 1) + ' · Par ' + h.par + ' · ' + h.length + 'y');
    renderer.fitBounds(h.bounds, 4);
    renderer.snapCamera();
    refreshTurn();
  }

  function banner(text) {
    var el = $('banner');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function showFeedback(fb, uid) {
    var el = $('feedback');
    var who = uid === myUid ? '' : (playerNameOf(uid) + ': ');
    el.textContent = who + fb.text;
    el.className = 'feedback show tone-' + fb.tone;
    setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function playerNameOf(uid) {
    return (room.players[uid] && room.players[uid].name) || 'Player';
  }

  function showSummary() {
    renderScorecard('summary-body');
    var hIdx = holeIndex();
    var ids = playerIds();
    var msg = ids.map(function (id) {
      var s = scoreOf(id, hIdx);
      if (s == null) s = ballOf(id).strokes;
      return playerNameOf(id) + ': ' + s + ' (' + relToPar(s, hole().par) + ')';
    }).join('  ·  ');
    $('summary-title').textContent = 'Hole ' + (hIdx + 1) + ' complete';
    $('summary-line').textContent = msg;
    $('overlay-summary').classList.add('show');
  }

  function relToPar(strokes, par) {
    var d = strokes - par;
    if (d === 0) return 'Par';
    if (d === -1) return 'Birdie';
    if (d === -2) return 'Eagle';
    if (d === 1) return 'Bogey';
    if (d === 2) return 'Double';
    return d > 0 ? '+' + d : String(d);
  }

  function totals() {
    var ids = playerIds();
    var out = {};
    ids.forEach(function (id) {
      var tot = 0, played = 0;
      for (var i = 0; i < room.meta.holes; i++) {
        var s = scoreOf(id, i);
        if (s != null) { tot += s; played++; }
      }
      out[id] = { total: tot, played: played };
    });
    return out;
  }

  function showFinal() {
    if (phase === 'final') return;
    phase = 'final';
    clearTimeout(advanceTimer); advanceTimer = null;
    $('overlay-summary').classList.remove('show');
    renderScorecard('final-body');
    var t = totals();
    var ids = playerIds();
    var title = 'Round complete!';
    if (ids.length === 2) {
      var a = ids[0], b = ids[1];
      if (t[a].total !== t[b].total) {
        var w = t[a].total < t[b].total ? a : b;
        title = '🏆 ' + playerNameOf(w) + ' wins!';
      } else title = '🤝 All square!';
    }
    $('final-title').textContent = title;
    $('overlay-final').classList.add('show');
  }

  function renderScorecard(bodyId) {
    var el = $(bodyId);
    var ids = playerIds();
    var n = room.meta.holes;
    var html = '<table><tr><th>Hole</th>';
    for (var i = 0; i < n; i++) html += '<th>' + (i + 1) + '</th>';
    html += '<th>Tot</th></tr>';
    html += '<tr class="par-row"><td>Par</td>';
    var parTot = 0;
    for (i = 0; i < n; i++) { html += '<td>' + course[i].par + '</td>'; parTot += course[i].par; }
    html += '<td>' + parTot + '</td></tr>';
    ids.forEach(function (id) {
      html += '<tr><td>' + esc(playerNameOf(id)) + '</td>';
      var tot = 0;
      for (var i = 0; i < n; i++) {
        var s = scoreOf(id, i);
        var cls = '';
        if (s != null) {
          tot += s;
          cls = s < course[i].par ? ' class="under"' : (s > course[i].par ? ' class="over"' : '');
        }
        html += '<td' + cls + '>' + (s == null ? '–' : s) + '</td>';
      }
      html += '<td><b>' + (tot || '–') + '</b></td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- lobby ----------

  function renderLobby() {
    if (phase !== 'lobby') { showScreen('lobby'); phase = 'lobby'; }
    var ids = playerIds();
    var el = $('lobby-players');
    el.innerHTML = '';
    ids.forEach(function (id) {
      var d = document.createElement('div');
      d.className = 'lobby-player';
      var cv = document.createElement('canvas');
      cv.width = 60; cv.height = 70;
      Character.draw(cv.getContext('2d'), room.players[id].char || {}, 30, 62, 1.5);
      var nm = document.createElement('span');
      nm.textContent = room.players[id].name + (id === myUid ? ' (you)' : '');
      d.appendChild(cv); d.appendChild(nm);
      el.appendChild(d);
    });
    $('lobby-waiting').textContent = ids.length < 2 ? 'Waiting for your friend to join…' : 'Starting…';
  }

  // ---------- HUD ----------

  function updateHud() {
    var h = hole();
    if (!h || !room) return;
    $('hud-hole').textContent = 'Hole ' + (holeIndex() + 1) + '/' + room.meta.holes;
    $('hud-par').textContent = 'Par ' + h.par;
    var b = myBall();
    var d = Math.round(Course.dist(b, h.pin));
    $('hud-dist').textContent = b.holed ? '—' : d + 'y to pin';
    $('hud-lie').textContent = b.holed ? 'Holed!' : ('Lie: ' + (b.lie === 'tee' ? 'tee box' : b.lie));

    // wind
    var w = h.wind;
    $('wind-speed').textContent = w.mph < 1 ? 'calm' : w.mph + ' mph';
    $('wind-arrow').style.transform = 'rotate(' + (-(w.angle) + Math.PI) + 'rad)';
    $('wind-arrow').style.opacity = w.mph < 1 ? 0.25 : 1;

    // players strip
    var strip = $('players-strip');
    strip.innerHTML = '';
    var turn = whoseTurn();
    playerIds().forEach(function (id) {
      var bb = ballOf(id);
      var div = document.createElement('div');
      div.className = 'player-chip' + (turn === id && room.meta.status === 'playing' ? ' turn' : '');
      var t = totals()[id];
      div.innerHTML = '<span class="dot" style="background:' +
        Character.COLORS[(room.players[id].char || {}).shirt || 0] + '"></span>' +
        esc(playerNameOf(id)) + ' · ' + bb.strokes + (t.played ? ' (' + t.total + ' tot)' : '');
      strip.appendChild(div);
    });
  }

  function updateClubBar() {
    var btns = document.querySelectorAll('#clubbar .club');
    btns.forEach(function (b) {
      var sel = b.dataset.club === selectedClub;
      b.classList.toggle('sel', sel);
      if (sel && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function updateSwingUi() {
    var inSwing = phase === 'power' || phase === 'accuracy';
    $('meter-wrap').classList.toggle('show', inSwing);
    $('clubbar').classList.toggle('show', phase === 'aim');
    var btn = $('btn-swing');
    if (phase === 'aim') { btn.textContent = 'SWING'; btn.classList.add('show'); }
    else if (phase === 'power') { btn.textContent = 'POWER!'; btn.classList.add('show'); }
    else if (phase === 'accuracy') { btn.textContent = 'NOW!'; btn.classList.add('show'); }
    else btn.classList.remove('show');
    $('turn-hint').textContent =
      phase === 'aim' ? 'Drag on the course to aim, pick a club, then swing'
      : phase === 'watch' && room && room.meta.status === 'playing'
        ? (whoseTurn() && whoseTurn() !== myUid ? 'Waiting for ' + playerNameOf(whoseTurn()) + '…' : '')
        : '';
  }

  // ---------- camera ----------

  function updateCamera() {
    var h = hole();
    if (!h) return;
    var b = myBall();
    var puttingView = phase === 'aim' && !b.holed &&
      (b.lie === 'green' || (selectedClub === 'putter' && Course.dist(b, h.pin) < 45));
    if (anim && anim.pos) {
      // keep both the ball and the pin in frame during flight
      renderer.fitBounds(h.bounds, 4);
    } else if (puttingView) {
      var r = Math.max(h.greenR * 2.4, Course.dist(b, h.pin) * 1.4);
      renderer.fitBounds({
        minX: h.green.x - r, maxX: h.green.x + r,
        minY: h.green.y - r, maxY: h.green.y + r,
      }, 0);
    } else {
      renderer.fitBounds(h.bounds, 4);
    }
  }

  // ---------- main loop ----------

  var lastFrame = performance.now();
  var lastHole = -1;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(100, now - lastFrame);
    lastFrame = now;

    if (phase === 'home' || phase === 'lobby') return;
    if (!course || !room) return;

    if (holeIndex() !== lastHole) {
      lastHole = holeIndex();
      onNewHole();
    }

    tickMeter(now);
    tickAnimation(now);
    updateCamera();
    renderer.tickCamera(dt);

    var aimState = null;
    if (phase === 'aim') {
      var b = myBall();
      var c = Physics.club(selectedClub);
      var reach = c.id === 'putter'
        ? 42 * (b.lie === 'green' ? 1 : 0.5)
        : c.carry * Physics.lieFactor(b.lie, c.id) + c.roll * 0.5;
      aimState = {
        from: b,
        to: { x: b.x + Math.sin(aimAngle) * reach, y: b.y + Math.cos(aimAngle) * reach },
      };
    }

    var chars = {};
    if (room.players) {
      Object.keys(room.players).forEach(function (id) { chars[id] = room.players[id].char; });
    }

    var ballsView = {};
    playerIds().forEach(function (id) { ballsView[id] = ballOf(id); });

    renderer.draw({
      hole: hole(),
      time: now,
      balls: ballsView,
      chars: chars,
      myUid: myUid,
      aim: aimState,
      flying: anim && anim.pos ? { x: anim.pos.x, y: anim.pos.y, h: anim.pos.h, uid: anim.uid } : null,
      splash: splash,
    });
  }

  function showScreen(name) {
    ['home', 'lobby', 'game'].forEach(function (s) {
      $('screen-' + s).classList.toggle('active', s === name);
    });
  }

  // console debugging hook
  window.GolfDebug = {
    state: function () {
      return { phase: phase, holeIndex: holeIndex(), cam: renderer && renderer.cam, target: renderer && renderer.target, hole: hole() };
    },
  };

  boot();
})();
