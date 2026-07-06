// Character creation: options, localStorage persistence, and the little
// golfer sprite drawing used both in the creator preview and on the course.
(function () {
  'use strict';

  var SKINS = ['#f6d7b8', '#eab98d', '#c98d5f', '#9c6b43', '#6f4a2f'];
  var COLORS = ['#e05d4f', '#3f8fd2', '#3cb96a', '#f2c14e', '#9b6bd3', '#ef8a3c', '#2fbcaf', '#41516b', '#e778ae', '#f5f0e6'];
  var HATS = ['none', 'cap', 'bucket', 'visor', 'tophat'];

  var STORE_KEY = 'golf.character';

  function defaults() {
    return { name: '', skin: 0, shirt: 1, hat: 1, hatColor: 0 };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaults();
      var c = JSON.parse(raw);
      return {
        name: String(c.name || '').slice(0, 14),
        skin: clampIdx(c.skin, SKINS),
        shirt: clampIdx(c.shirt, COLORS),
        hat: clampIdx(c.hat, HATS),
        hatColor: clampIdx(c.hatColor, COLORS),
      };
    } catch (e) { return defaults(); }
  }

  function clampIdx(v, arr) {
    v = parseInt(v, 10);
    return (v >= 0 && v < arr.length) ? v : 0;
  }

  function save(c) {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  }

  // Draws a chibi golfer facing slightly right. (x, y) is the ground point
  // under their feet; s scales the whole sprite (s=1 → ~30px tall).
  function draw(ctx, c, x, y, s, opts) {
    opts = opts || {};
    var skin = SKINS[clampIdx(c.skin, SKINS)];
    var shirt = COLORS[clampIdx(c.shirt, COLORS)];
    var hatCol = COLORS[clampIdx(c.hatColor, COLORS)];
    var hat = HATS[clampIdx(c.hat, HATS)];

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // shadow
    if (!opts.noShadow) {
      ctx.fillStyle = 'rgba(50,80,40,0.25)';
      ctx.beginPath();
      ctx.ellipse(1, 1, 9, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // legs
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-2.5, -8); ctx.lineTo(-2.5, -1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2.5, -8); ctx.lineTo(2.5, -1); ctx.stroke();

    // body
    ctx.fillStyle = shirt;
    roundRect(ctx, -5.5, -19, 11, 12, 4.5);
    ctx.fill();
    // arm holding club
    ctx.strokeStyle = shirt;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(4.5, -15); ctx.lineTo(8.5, -9); ctx.stroke();
    // club
    ctx.strokeStyle = '#8a92a3';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(8.5, -9); ctx.lineTo(11.5, -0.5); ctx.stroke();
    ctx.fillStyle = '#6b7280';
    roundRect(ctx, 10.6, -1.4, 3.4, 2, 0.9);
    ctx.fill();

    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -24.5, 6.2, 0, Math.PI * 2);
    ctx.fill();

    // hat
    ctx.fillStyle = hatCol;
    if (hat === 'cap') {
      ctx.beginPath(); ctx.arc(0, -26, 6.2, Math.PI, 0); ctx.fill();
      roundRect(ctx, 0, -27.2, 9, 2.4, 1.2); ctx.fill();
    } else if (hat === 'bucket') {
      ctx.beginPath(); ctx.arc(0, -27, 5.4, Math.PI, 0); ctx.fill();
      roundRect(ctx, -8, -28.2, 16, 2.6, 1.3); ctx.fill();
    } else if (hat === 'visor') {
      roundRect(ctx, -6.4, -30, 12.8, 3, 1.5); ctx.fill();
      roundRect(ctx, 0, -28.6, 9.4, 2.2, 1.1); ctx.fill();
    } else if (hat === 'tophat') {
      roundRect(ctx, -7, -29.4, 14, 2.4, 1.2); ctx.fill();
      roundRect(ctx, -4.4, -37, 8.8, 8.4, 1.6); ctx.fill();
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.Character = {
    SKINS: SKINS,
    COLORS: COLORS,
    HATS: HATS,
    load: load,
    save: save,
    draw: draw,
  };
})();
