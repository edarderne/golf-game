// Deterministic seeded RNG (mulberry32). Both players generate identical
// courses and shot results from the shared room seed.
(function () {
  'use strict';

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mix a base seed with a stream id (e.g. hole index) into a new 32-bit seed.
  function mix(seed, n) {
    var h = (seed ^ 0x9E3779B9) >>> 0;
    h = Math.imul(h ^ n, 0x85EBCA6B) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  window.RNG = {
    make: function (seed) {
      var next = mulberry32(seed);
      return {
        next: next,
        range: function (min, max) { return min + next() * (max - min); },
        int: function (min, max) { return Math.floor(min + next() * (max - min + 1)); },
        pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
        chance: function (p) { return next() < p; },
      };
    },
    mix: mix,
    newSeed: function () { return (Math.random() * 0xFFFFFFFF) >>> 0; },
  };
})();
