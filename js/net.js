// Firebase glue: anonymous auth + room create/join/watch under golf/rooms.
(function () {
  'use strict';

  var cfg = window.GOLF_CONFIG;
  var configured = cfg.firebase.apiKey.indexOf('PASTE_') !== 0;
  var auth = null, db = null;
  if (configured) {
    firebase.initializeApp(cfg.firebase);
    auth = firebase.auth();
    db = firebase.database();
    if (cfg.useEmulators) {
      auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
      db.useEmulator('127.0.0.1', 9000);
    }
  }

  var uid = null;
  var roomRef = null;
  var roomCb = null;

  function init() {
    if (!configured) {
      return Promise.reject(new Error('Multiplayer isn’t set up yet (Firebase config missing — see README). Practice rounds still work!'));
    }
    var persistence = cfg.authPersistence === 'none'
      ? firebase.auth.Auth.Persistence.NONE
      : firebase.auth.Auth.Persistence.LOCAL;
    return auth.setPersistence(persistence).then(function () {
      return new Promise(function (resolve, reject) {
        auth.onAuthStateChanged(function (user) {
          if (user) { uid = user.uid; resolve(uid); }
          else auth.signInAnonymously().catch(reject);
        });
      });
    });
  }

  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function genCode() {
    var s = '';
    for (var i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }

  function ref(code) { return db.ref('golf/rooms/' + code); }

  function createRoom(opts) {
    var code = genCode();
    var r = ref(code);
    return r.get().then(function (snap) {
      if (snap.exists()) return createRoom(opts); // rare collision, roll again
      var data = {
        meta: {
          createdAt: firebase.database.ServerValue.TIMESTAMP,
          holes: opts.holes,
          seed: RNG.newSeed(),
          hostUid: uid,
          status: 'waiting',
        },
        players: {},
      };
      data.players[uid] = { name: opts.name, char: opts.char, joinedAt: firebase.database.ServerValue.TIMESTAMP };
      return r.set(data).then(function () { return code; });
    });
  }

  function joinRoom(code, opts) {
    code = code.toUpperCase().trim();
    var r = ref(code);
    return r.get().then(function (snap) {
      var room = snap.val();
      if (!room || !room.meta) throw new Error('No game found with code ' + code);
      var players = room.players || {};
      var isMember = !!players[uid];
      var count = Object.keys(players).length;
      if (!isMember && count >= 2) throw new Error('That game is already full');
      if (!isMember && room.meta.status !== 'waiting') throw new Error('That game has already started');
      var updates = {};
      updates['players/' + uid] = {
        name: opts.name, char: opts.char,
        joinedAt: players[uid] ? players[uid].joinedAt : firebase.database.ServerValue.TIMESTAMP,
      };
      if (!isMember && count === 1) updates['meta/status'] = 'playing';
      return r.update(updates).then(function () { return code; });
    });
  }

  function watchRoom(code, cb) {
    unwatch();
    roomRef = ref(code);
    roomCb = function (snap) { cb(snap.val()); };
    roomRef.on('value', roomCb);
  }

  function unwatch() {
    if (roomRef && roomCb) roomRef.off('value', roomCb);
    roomRef = null; roomCb = null;
  }

  function write(code, updates) {
    return ref(code).update(updates);
  }

  window.Net = {
    init: init,
    createRoom: createRoom,
    joinRoom: joinRoom,
    watchRoom: watchRoom,
    unwatch: unwatch,
    write: write,
    uid: function () { return uid; },
  };
})();
