// Firebase glue: anonymous auth + room create/join/watch under golf/rooms.
(function () {
  'use strict';

  var cfg = window.GOLF_CONFIG;
  var configured = cfg.firebase.apiKey.indexOf('PASTE_') !== 0;
  var auth = null, db = null, googleProvider = null;
  if (configured) {
    firebase.initializeApp(cfg.firebase);
    auth = firebase.auth();
    db = firebase.database();
    googleProvider = new firebase.auth.GoogleAuthProvider();
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
    return auth.setPersistence(persistence).then(completeRedirect).then(function () {
      return new Promise(function (resolve, reject) {
        auth.onAuthStateChanged(function (user) {
          if (user) { uid = user.uid; resolve(uid); }
          else auth.signInAnonymously().catch(reject);
        });
      });
    });
  }

  // Finish a Google sign-in that used the redirect flow (mobile). If linking
  // the anonymous account failed because the Google account already exists
  // (used on another device), sign into that existing account instead.
  function completeRedirect() {
    return auth.getRedirectResult().catch(function (e) {
      if ((e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') && e.credential) {
        return auth.signInWithCredential(e.credential);
      }
      return null; // no pending redirect, or a non-fatal error
    });
  }

  // Current signed-in identity for the UI.
  function account() {
    var u = auth && auth.currentUser;
    if (!u) return { uid: uid, anonymous: true, name: null, email: null };
    return { uid: u.uid, anonymous: !!u.isAnonymous, name: u.displayName, email: u.email };
  }

  // Upgrade the anonymous account to Google (keeping the same uid + all data),
  // or sign into an existing Google account. Tries a popup; falls back to a
  // full-page redirect where popups are blocked (most mobile browsers). On the
  // popup path it resolves with the account; on the redirect path the page
  // navigates away and init()/completeRedirect() finishes on return.
  function startGoogleSignIn() {
    if (!configured) return notReady();
    var u = auth.currentUser;
    var popup = (u && u.isAnonymous) ? u.linkWithPopup(googleProvider) : auth.signInWithPopup(googleProvider);
    return popup.then(function () {
      uid = auth.currentUser.uid;
      return account();
    }).catch(function (e) {
      if ((e.code === 'auth/credential-already-in-use' || e.code === 'auth/email-already-in-use') && e.credential) {
        return auth.signInWithCredential(e.credential).then(function () { uid = auth.currentUser.uid; return account(); });
      }
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment' || e.code === 'auth/cancelled-popup-request') {
        var u2 = auth.currentUser;
        return (u2 && u2.isAnonymous) ? u2.linkWithRedirect(googleProvider) : auth.signInWithRedirect(googleProvider);
      }
      throw e;
    });
  }

  // Sign out of Google and drop back to a fresh anonymous identity.
  function signOutToAnonymous() {
    if (!configured) return notReady();
    return auth.signOut()
      .then(function () { return auth.signInAnonymously(); })
      .then(function (res) { uid = res.user.uid; return account(); });
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

  // ---------- profiles & tournaments ----------

  function profileRef(id) { return db.ref('golf/profiles/' + id); }

  function notReady() {
    return Promise.reject(new Error('Multiplayer isn’t set up yet (see README)'));
  }

  function getProfile(id) {
    if (!configured) return notReady();
    return profileRef(id || uid).get().then(function (s) { return s.val(); });
  }

  function getProfiles(ids) {
    if (!configured) return notReady();
    return Promise.all(ids.map(function (id) {
      return profileRef(id).get().then(function (s) {
        var v = s.val();
        if (v) v.uid = id;
        return v;
      });
    })).then(function (list) { return list.filter(Boolean); });
  }

  function setProfile(profile) {
    if (!configured) return notReady();
    return profileRef(uid).set(profile);
  }

  function getTournamentDay(day) {
    if (!configured) return notReady();
    return db.ref('golf/tournaments/' + day).get().then(function (s) { return s.val() || {}; });
  }

  // Write-once per day per player (enforced by database rules).
  function submitTournament(day, entry) {
    if (!configured) return notReady();
    return db.ref('golf/tournaments/' + day + '/' + uid).set(entry);
  }

  window.Net = {
    init: init,
    available: function () { return configured; },
    createRoom: createRoom,
    joinRoom: joinRoom,
    watchRoom: watchRoom,
    unwatch: unwatch,
    write: write,
    uid: function () { return uid; },
    getProfile: getProfile,
    getProfiles: getProfiles,
    setProfile: setProfile,
    getTournamentDay: getTournamentDay,
    submitTournament: submitTournament,
    account: account,
    startGoogleSignIn: startGoogleSignIn,
    signOutToAnonymous: signOutToAnonymous,
  };
})();
