// Firebase web app config — same project as Office Mafia (safe to commit;
// these values are public by design, security comes from database rules).
// Golf data lives under its own top-level `golf/` path in the database.
(function () {
  var emu = new URLSearchParams(location.search).has('emu');
  window.GOLF_CONFIG = {
    firebase: emu
      ? {
          apiKey: 'demo-key',
          authDomain: 'demo-golf.firebaseapp.com',
          databaseURL: 'https://demo-golf-default-rtdb.firebaseio.com',
          projectId: 'demo-golf',
        }
      : {
          apiKey: 'AIzaSyCZF4_vZ5CaGBRmGvId5-_nNbRBUe6TIt4',
          authDomain: 'office-mafia.firebaseapp.com',
          databaseURL: 'https://office-mafia-default-rtdb.europe-west1.firebasedatabase.app',
          projectId: 'office-mafia',
        },
    useEmulators: emu,
    // dev/two.html loads the app twice in iframes; 'none' persistence gives
    // each frame its own anonymous user so one browser can play both sides.
    authPersistence: new URLSearchParams(location.search).get('persist') || 'local',
  };
})();
