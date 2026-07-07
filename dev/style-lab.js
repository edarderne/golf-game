// Style lab: quick viewer for the production renderer — the diorama look
// now lives in js/render.js + js/course.js + js/ambient.js, so this page
// just generates holes and shows them with the real drawing code.
(function () {
  'use strict';

  var canvas = document.getElementById('course');
  var renderer = new Renderer(canvas);
  var view = 'overview';
  var seed = 20260707;
  var holes = null, holeIdx = 0;

  function rebuild() {
    holes = Course.generate(seed, 3);
    holeIdx = 0;
    Ambient.reset(hole());
    fitView(true);
  }

  function hole() { return holes[holeIdx]; }

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
    Ambient.update(dt, h, renderer);
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
    // cycles through the 3 holes of the current seed instead of old/new now
    holeIdx = (holeIdx + 1) % holes.length;
    Ambient.reset(hole());
    this.textContent = 'Hole: ' + (holeIdx + 1);
    fitView(true);
  });

  rebuild();
  requestAnimationFrame(frame);
})();
