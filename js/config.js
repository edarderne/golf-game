// Firebase web app config — Island Golf's OWN Firebase project (independent
// from the Mafia game). Safe to commit: these values are public by design,
// security comes from the database rules.
//
// Setup (one-time): create the project in the Firebase console, then paste
// your web app config values below — full steps in README.md.
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
          apiKey: 'PASTE_API_KEY',
          authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
          databaseURL: 'PASTE_DATABASE_URL',
          projectId: 'PASTE_PROJECT_ID',
        },
    useEmulators: emu,
    // dev/two.html loads the app twice in iframes; 'none' persistence gives
    // each frame its own anonymous user so one browser can play both sides.
    authPersistence: new URLSearchParams(location.search).get('persist') || 'local',
  };
})();
