# Island Golf — Project Handoff

> Paste-ready context for continuing work in a new chat/session.
> State as of 2026-07-17. Everything below is committed to
> `github.com/edarderne/golf-game` (auto-deploys via Ed's Vercel).

## What this is

A 2-player online golf game, built for Ed (edarderne) to play with friends.
Static HTML/CSS/JS — **no build step, no framework, no server code**.
Procedurally generated island holes in a low-poly diorama style, classic
golf mechanics, plus a meta-game (handicaps, leaderboard, daily
tournaments, unlockable cosmetics).

- **Repo**: `edarderne/golf-game` (GitHub token in `~/.git-credentials`)
- **Local path**: `~/Documents/Claud Code Stuff/golf-game/`
- **Hosting**: Vercel, imported from the GitHub repo (plain static site)
- **Backend**: Firebase project `island-golf-fa3e2` (Ed's own — deliberately
  separate from his office-mafia project). Realtime Database
  (europe-west1) + anonymous auth. Config is public-by-design in
  `js/config.js`.

## Architecture — the one thing you must not break

**Deterministic lockstep sync.** Multiplayer sends only shot *inputs*
(club, aim angle, power, accuracy) through Firebase; each client replays
the identical deterministic simulation. Consequences:

- Courses generate entirely from the room seed (`js/course.js`) — every
  decorative tuft is seeded. Both clients must build byte-identical holes.
- `js/physics.js` must stay free of `Math.random` and anything
  non-deterministic.
- Visual-only randomness is allowed ONLY in `js/ambient.js` (wildlife) —
  it never touches game state.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | All screens (home/creator, lobby, game, tournament) + overlays (summary, scorecard, menu, leaderboard, final). Home has a dismissible "what's new" banner (inline script, localStorage key `golf-whatsnew` = version string). Local JS/CSS carry `?v=N` cache-busting params — bump them when those files change so returning players get the update |
| `js/config.js` | Firebase web config (live values) + `?emu` / `?persist=none` dev flags |
| `js/rng.js` | mulberry32 seeded RNG + mix/newSeed |
| `js/meta.js` | Handicap maths, profile fold-in, tournament day/week keys + standings |
| `js/character.js` | Character options + sprite; `crown` hat is trophy-locked |
| `js/course.js` | Seeded hole generation: terrain, fairway/island polygons, per-hole signature hazard (see below), varied green shapes (`greenPoly` + harmonics), green slope, ALL decor (pines/leafy/palms with facet params, boulders+capstones, moai, props, speckle, patches). Helpers: `ellipseBlob`, `arcPond`, `greenBlob`, `neckReduction`, `makeIsland` |
| `js/physics.js` | Clubs, deterministic shot/roll sim, green-slope break, hole capture (slow rolls only) |
| `js/ambient.js` | Visual wildlife: birds, shore fish, rare whale (~60-90s), pond ducks, beach turtle, wandering deer, ultra-rare sprinting yeti (~8-10 min). Sea spawns work across multi-island holes (`insideAnyIsland`) |
| `js/render.js` | Pseudo-3D renderer: camera {x,y,scale,rot,tilt,anchor} — overview vs third-person shot view; depth-sorted entities; one top-left sun, shaped down-right shadows; animated sea |
| `js/net.js` | Firebase glue: anon auth, rooms, profiles, tournaments (all guarded if config missing) |
| `js/devnet.js` | `?dev2` localStorage Net replacement for offline 2-player testing |
| `js/game.js` | Controller: screens, swing meter, turn flow, sync, stats recording, tournament mode, leaderboard UI, in-game menu |
| `database.rules.json` | Full ruleset (rooms; profiles owner-write; tournaments write-once/day) |
| `dev/two.html` | Two iframes vs each other via `?dev2` shim (no Firebase) |
| `dev/two-live.html` | Same but against the REAL Firebase (verifies auth+rules) |
| `dev/style-lab.html` | Style viewer over the production renderer |
| `dev/hazard-test.html` | Hunts seeds for one example of each signature hazard + renders it; `window.HAZARD_SET(feature, seed, idx)` jumps to a specific hole. Scripts carry `?v=N` (bump on JS change) |

## Key mechanics & decisions

- **Swing**: tap → vertical power bar (tap to lock) → horizontal bar
  sweeps; stop marker in centre. Left of centre = hook, right = slice,
  ±6% = dead straight. Meter speed scales with club.
- **Turn order**: honors on tee (host first on hole 1, best previous hole
  after), then farthest-from-pin. Derived purely from synced state — no
  turn field.
- **Sync details**: `game/shot` carries inputs + an incrementing `n`;
  shooter writes resulting ball/scores after its animation; host advances
  holes / sets `status done`. `pendingBalls` bridges remote animation vs
  synced writes. Stroke cap 8/hole (auto-pickup). Water = +1, replay spot.
- **Identity**: anonymous Firebase uid, device-bound. Profiles at
  `golf/profiles/$uid` (name, char, stats, last-20 history, rivals,
  trophies). Known trade-off: new device = new identity; upgrade path is
  Google sign-in.
- **Handicap**: strokes-over-par per 9 holes, avg of best half of last 20
  rounds (needs ≥2 rounds). Shown home/lobby/leaderboard with ▲▼ form.
- **Daily tournament**: 9 holes, seed = hash of UTC date (`Meta.daySeed`)
  → same course worldwide, no server. One attempt/day enforced by rules
  (`!data.exists()`). Week = Mon-Sun; missed day = +40; winner self-claims
  a crown trophy on next visit (client-side — honor-level, fine for
  friends). Crown unlocks the crown hat. Quitting mid-round via the menu
  forfeits: cards cap on unfinished holes and submits.
- **In-game menu (☰)**: practice → Restart/Quit; 1v1 → Abandon (writes
  `meta/status done` + `game/abandonedBy`, other player sees who left);
  tournament → forfeit-quit.
- **Tournament board is global** (everyone who played that day);
  **Rivals leaderboard** is only people you've finished a 1v1 with.
- **Signature hazards**: each hole gets at most one, so difficulty stays
  fair (`hole.feature`). `carry` = split across two islands with open sea
  (par-3s ~65% become a tight island green; par-4/5 keep a reachable
  landing strip, sometimes tightened); `narrow` = a long neck pinched from
  `left`/`right`/`both` sides (`hole.narrowSide`, held over 30-46% of the
  hole); `guard` = water at the green, either a round pond tangent OUTSIDE
  the surface or a crescent (`arcPond`) wrapping ¼-½ the edge — never over
  the putting surface; `lake` = a long pond (`ellipseBlob`) flanking the
  fairway. Carry gaps are tuned to stay reachable (par-3 30-48y, par-4/5
  44-66y). ALL of this is seeded RNG only — no `Math.random` in course.js,
  so both clients build byte-identical holes.
- **Greens**: `greenPoly` (not a circle) — a per-hole base size (bigger on
  par-5), aspect ratio + two shape harmonics via `greenBlob` give rounds,
  ovals and kidneys. Pin is placed near centre then pulled inward until
  `pointInPoly` passes (robust for concave greens); verified 0 pins off the
  green across 1000+ sampled holes. `terrainAt` uses `pointInPoly(greenPoly)`;
  render fills `greenPoly`/`fringePoly` via `blobPath` (projects under tilt).
  Physics is insulated — it only calls `Course.terrainAt`, so no physics
  changes were needed.

## Visual design (iterated with Ed over ~5 review rounds — he's specific)

Low-poly diorama per his reference images: tiered faceted pines (3-4
facets, NO plain 2-face), 3-5-lobe faceted deciduous, kite-frond palms,
triangulated boulders, moai with per-statue faces (NO topknots — removed
as "weird log"), stumps/logs/dead trees/mushrooms/pebbles, tall grass,
flowers (not colour dots), sand/bunker speckle, animated sea + island
depth ring, pond deep-centres (NO pond ripple arcs — Ed nixed), one
top-left sun, all shadows shaped + down-right. Palette in `PAL`
(render.js). Ed's taste: textured-but-clean, hates repetitive/flat
elements and inconsistent shadows. He asked twice for MORE variety in
green size/shape and hazard shape/length — bias toward bolder variation
(bigger greens, longer necks, larger lakes) rather than subtle.

## Verify / test workflows

- `python3 -m http.server 8641` in golf-game/, open `index.html`.
- Practice mode works with zero Firebase.
- `dev/hazard-test.html` = flip through one example of each signature
  hazard; `HAZARD_SET(feature, seed, idx)` jumps to a specific hole.
  NOTE: `python3 -m http.server` sends caching headers the browser
  honours, so edits to js/*.js can serve stale — the dev pages carry
  `?v=N` on their script tags; bump N (or hard-reload) after editing.
- `dev/two.html` = full 2-player round offline (iframes share
  localStorage; `?dev2&persist=none` handles identity).
- `window.GolfDebug.state()` → {phase, camera, hole}.
- Bot-play for testing (paste in console, adjust): lock power at ~90%,
  stop h-bar at centre: see git history commit messages for the snippet.
- Firebase status: config live in js/config.js; anonymous auth ON;
  **verify Ed pasted the LATEST database.rules.json** (needs profiles +
  tournaments sections — if leaderboard/tournament say "Permission
  denied", he still has the rooms-only version).

## Open ideas / known softness (none blocking)

- Sounds; opponent-online presence indicator; Google sign-in for
  cross-device identity; server-validated tournaments (current = honor
  system, replayable via practice-mode seed knowledge, trophy self-claim
  spoofable); birds are simple silhouettes (Ed called them fine);
  offscreen-canvas caching if older phones stutter; Nessie in deep water
  as a second legendary sighting; named tournament groups if strangers
  ever join.

## Working-with-Ed notes

Agency owner (The Brand Collective), builds via chat, non-dev but sharp
product eye. Iterates visually from screenshots/reference images. Prefers
being given a working thing + one clear manual step over instructions.
His only manual steps so far: Firebase console setup + pasting rules, and
the Vercel import.
