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
          apiKey: 'AIzaSyDcE0CMVSanNjTloWJECl1UaHVQ99kdABI',
          authDomain: 'island-golf-fa3e2.firebaseapp.com',
          databaseURL: 'https://island-golf-fa3e2-default-rtdb.europe-west1.firebasedatabase.app',
          projectId: 'island-golf-fa3e2',
        },
    useEmulators: emu,
    // dev/two.html loads the app twice in iframes; 'none' persistence gives
    // each frame its own anonymous user so one browser can play both sides.
    authPersistence: new URLSearchParams(location.search).get('persist') || 'local',
  };
})();
