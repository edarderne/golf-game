// Meta-game logic: player profiles, handicap, and daily-tournament keys.
// Pure functions — storage happens through Net in game.js.
(function () {
  'use strict';

  // ---------- handicap ----------
  // Differential = strokes-over-par normalised to 9 holes. Handicap = the
  // average of your best half (max 8) of the last 20 rounds, so it rewards
  // your potential like a real handicap and drops as you improve.

  function differential(entry) {
    return ((entry.s - entry.p) / entry.h) * 9;
  }

  function handicap(history) {
    if (!history || history.length < 2) return null;
    var diffs = history.map(differential).sort(function (a, b) { return a - b; });
    var n = Math.min(8, Math.ceil(diffs.length / 2));
    var sum = 0;
    for (var i = 0; i < n; i++) sum += diffs[i];
    return Math.round((sum / n) * 10) / 10;
  }

  function fmtHandicap(h) {
    if (h == null) return '–';
    if (h <= 0) return String(h.toFixed(1));
    return '+' + h.toFixed(1);
  }

  // Trend: recent form vs earlier form. Returns 'up' | 'down' | null.
  function trend(history) {
    if (!history || history.length < 6) return null;
    var diffs = history.map(differential);
    var recent = diffs.slice(-3), before = diffs.slice(-6, -3);
    var ra = avg(recent), ba = avg(before);
    if (ra < ba - 0.4) return 'up';    // scoring lower = improving
    if (ra > ba + 0.4) return 'down';
    return null;
  }

  function avg(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

  // ---------- profile ----------

  function emptyProfile(name, char) {
    return {
      name: name, char: char,
      stats: { rounds: 0, holes: 0, strokes: 0, par: 0, best: null },
      history: [],
      rivals: {},
      trophies: {},
      updatedAt: Date.now(),
    };
  }

  // Fold a completed round into the profile (mutates + returns it).
  function recordRound(profile, round) { // round: {h, s, p, t}
    var st = profile.stats = profile.stats || { rounds: 0, holes: 0, strokes: 0, par: 0, best: null };
    st.rounds += 1;
    st.holes += round.h;
    st.strokes += round.s;
    st.par += round.p;
    var vsPar = round.s - round.p;
    if (st.best == null || vsPar < st.best) st.best = vsPar;
    profile.history = (profile.history || []).concat([round]).slice(-20);
    profile.updatedAt = Date.now();
    return profile;
  }

  // ---------- daily tournament ----------
  // The course is derived from the UTC date, so every player in the world
  // builds the identical holes with no server involved.

  function dayKey(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function daySeed(day) {
    var h = 5381;
    var s = 'island-golf-tournament-' + day;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Monday-anchored week: returns the 7 day-keys of the week containing
  // `anchor` (a dayKey string).
  function weekDays(anchor) {
    var d = new Date(anchor + 'T00:00:00Z');
    var dow = (d.getUTCDay() + 6) % 7; // Mon=0
    d.setUTCDate(d.getUTCDate() - dow);
    var days = [];
    for (var i = 0; i < 7; i++) {
      days.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return days;
  }

  // Over-par charged for a skipped day. Must exceed the worst realistic
  // 9-hole round (pickup cap ≈ +4/hole) so playing always beats skipping.
  var MISSED_DAY_PENALTY = 40;

  // dayResults: {day: {uid: {name, strokes, par}}}. Returns sorted standings.
  function weekStandings(dayResults) {
    var players = {};
    var days = Object.keys(dayResults);
    days.forEach(function (day) {
      var entries = dayResults[day] || {};
      Object.keys(entries).forEach(function (uid) {
        if (!players[uid]) players[uid] = { uid: uid, name: entries[uid].name, played: 0, overPar: 0 };
        players[uid].played += 1;
        players[uid].overPar += entries[uid].strokes - entries[uid].par;
        players[uid].name = entries[uid].name; // latest name wins
      });
    });
    var playedDayCount = days.filter(function (d) { return Object.keys(dayResults[d] || {}).length > 0; }).length;
    var list = Object.keys(players).map(function (uid) {
      var p = players[uid];
      p.total = p.overPar + (playedDayCount - p.played) * MISSED_DAY_PENALTY;
      return p;
    });
    list.sort(function (a, b) { return a.total - b.total || b.played - a.played; });
    return list;
  }

  window.Meta = {
    handicap: handicap,
    fmtHandicap: fmtHandicap,
    trend: trend,
    emptyProfile: emptyProfile,
    recordRound: recordRound,
    dayKey: dayKey,
    daySeed: daySeed,
    weekDays: weekDays,
    weekStandings: weekStandings,
    MISSED_DAY_PENALTY: MISSED_DAY_PENALTY,
    TOURNEY_HOLES: 9,
  };
})();
