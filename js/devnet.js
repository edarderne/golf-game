// Dev-only network shim (?dev2): replaces Net with a localStorage-backed
// implementation so two iframes on the same page can play a full online
// round without Firebase. Used by dev/two.html; inert in production.
(function () {
  'use strict';
  if (!new URLSearchParams(location.search).has('dev2')) return;

  var uid = 'dev-' + Math.random().toString(36).slice(2, 8);
  var watchKey = null, watchCb = null;

  function key(code) { return 'golfdev.room.' + code; }
  function read(code) {
    var raw = localStorage.getItem(key(code));
    return raw ? JSON.parse(raw) : null;
  }
  function save(code, room) {
    localStorage.setItem(key(code), JSON.stringify(room));
    if (watchKey === key(code) && watchCb) {
      var cb = watchCb;
      setTimeout(function () { if (watchCb === cb) cb(read(code)); }, 0);
    }
  }

  function applyUpdates(room, updates) {
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
  }

  window.addEventListener('storage', function (e) {
    if (e.key === watchKey && watchCb) watchCb(e.newValue ? JSON.parse(e.newValue) : null);
  });

  window.Net = {
    init: function () { return Promise.resolve(uid); },
    uid: function () { return uid; },
    createRoom: function (opts) {
      var code = 'DV' + Math.random().toString(36).slice(2, 4).toUpperCase();
      var room = {
        meta: { createdAt: Date.now(), holes: opts.holes, seed: RNG.newSeed(), hostUid: uid, status: 'waiting' },
        players: {},
      };
      room.players[uid] = { name: opts.name, char: opts.char, joinedAt: Date.now() };
      save(code, room);
      return Promise.resolve(code);
    },
    joinRoom: function (code, opts) {
      code = code.toUpperCase().trim();
      var room = read(code);
      if (!room) return Promise.reject(new Error('No game found with code ' + code));
      var players = room.players || {};
      var isMember = !!players[uid];
      if (!isMember && Object.keys(players).length >= 2) return Promise.reject(new Error('That game is already full'));
      players[uid] = players[uid] || { name: opts.name, char: opts.char, joinedAt: Date.now() };
      room.players = players;
      if (Object.keys(players).length === 2) room.meta.status = room.meta.status === 'waiting' ? 'playing' : room.meta.status;
      save(code, room);
      return Promise.resolve(code);
    },
    watchRoom: function (code, cb) {
      watchKey = key(code); watchCb = cb;
      // async like Firebase so callers finish setting up first
      setTimeout(function () {
        var room = read(code);
        if (room && watchCb === cb) cb(room);
      }, 0);
    },
    unwatch: function () { watchKey = null; watchCb = null; },
    write: function (code, updates) {
      var room = read(code) || {};
      applyUpdates(room, updates);
      save(code, room);
      return Promise.resolve();
    },
  };
})();
