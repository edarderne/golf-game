# ⛳ Island Golf

Two-player online golf in the browser. Create a game, send the 4-letter code
to a friend, and play a 3/6/9-hole round on procedurally generated island
holes — pick a club, aim, and hit the classic 3-tap swing meter (mistime it
and you'll slice, hook, or come up short). Greens have slopes that break
your putts; taking a shot drops you into a third-person isometric view
behind your golfer.

Fully independent from the other projects: its own GitHub repo, its own
Vercel project, and its own Firebase project.

## One-time setup: create the Firebase project (~5 minutes, no CLI needed)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   → **Add project** → name it `island-golf` (analytics off is fine).
2. **Build → Realtime Database → Create database** → pick `europe-west1`
   → start in **locked mode**.
3. On the database's **Rules** tab, paste the entire contents of
   [database.rules.json](database.rules.json) and **Publish**.
4. **Build → Authentication → Get started** → **Anonymous** → Enable.
5. **Project settings (gear icon) → General → Your apps → Web (</>)** →
   register an app (no hosting) and copy the config values —
   `apiKey`, `projectId`, `databaseURL` — into
   [js/config.js](js/config.js) replacing the `PASTE_...` placeholders.
   (`databaseURL` also appears at the top of the Realtime Database page,
   e.g. `https://island-golf-default-rtdb.europe-west1.firebasedatabase.app`.)
6. Commit + push — Vercel redeploys and online games work.

Until then the home screen says multiplayer isn't set up yet, but
**practice rounds work immediately**.

## How it works

- **Static site** — no build step. Plain HTML/CSS/JS.
- **Multiplayer** — Firebase Realtime Database rooms under `golf/rooms/*`
  with anonymous auth. Turn-based sync: only the shot *inputs* (club, aim,
  power, accuracy) are sent; both clients replay the same deterministic
  physics, so the result is identical on both screens.
- **Courses** — generated from the room seed (`js/course.js`), so both
  players build the exact same holes locally. Greens get a random slope
  that bends rolling balls.
- **Camera** — high overview of the hole normally; when it's your shot,
  a tilted third-person view from behind your ball facing the aim line.
- **Characters** — built on the home screen, saved in `localStorage`,
  re-used every game.

## Local development

```bash
python3 -m http.server 8641
# open http://localhost:8641
```

- **Practice round** on the home screen plays offline (no Firebase).
- **Two-player testing**: open `http://localhost:8641/dev/two.html` — two
  iframes play against each other through a localStorage sync shim
  (`?dev2`), no Firebase needed.
- `window.GolfDebug.state()` in the console shows phase/camera/hole.

## Profiles, handicap & the daily tournament

- Every player gets a **profile** in the database keyed by their anonymous
  Firebase identity (no login — but it's per-browser/device: clearing site
  data or switching devices starts a fresh identity).
- Completed rounds are recorded automatically. **Handicap** = strokes over
  par per 9 holes, averaged over the best half of your last 20 rounds. It
  shows on the home screen, in the 1v1 lobby, and on the **📊 Rivals**
  leaderboard (everyone you've played online, with ▲/▼ form arrows).
- **🏆 Daily tournament**: a new 9-hole course drops at 00:00 UTC every
  day, generated from the date so every player in the world gets the same
  holes. One attempt per day (enforced by database rules — write-once).
  Scores accumulate Monday–Sunday; missed days cost +40. The weekly winner
  unlocks the **golden crown** hat, and wins collect in the **trophy
  cabinet** on the Rivals screen.

## Gameplay notes

- Swing meter: tap once to start, tap to lock **power** on the rising bar,
  then a horizontal bar sweeps left↔right — tap to stop the marker in the
  centre. Left of centre → hook (curves left), right → slice, inside the
  green zone → dead straight.
- Wind (top right) drifts airborne shots; high-lofted clubs drift more.
  Putts ignore wind.
- Greens slope: white arrows point downhill (stronger slope = brighter
  arrows); the putt preview line shows the expected break.
- Lies: rough −28% distance, sand −50% (wedge only −20%), water = +1
  penalty and replay from the same spot. Fast rolls skip over the cup;
  slow ones drop.
- Turn order follows golf: honors on the tee (host first on hole 1, best
  previous hole after), then farthest from the pin plays.
- Max 8 strokes per hole (auto-pickup).

## Files

| File | Purpose |
| --- | --- |
| `js/course.js` | Seeded procedural hole generation + terrain lookup |
| `js/physics.js` | Clubs, deterministic shot/roll simulation, green slopes |
| `js/render.js` | Pseudo-3D canvas renderer (rotating/tilting camera, depth-sorted low-poly world) |
| `js/game.js` | Screens, swing meter, turn flow, sync logic |
| `js/net.js` | Firebase auth + room create/join/watch |
| `js/devnet.js` | `?dev2` localStorage net shim for local 2-player testing |
| `js/character.js` | Character options, persistence, sprite drawing |
| `database.rules.json` | Realtime Database ruleset (golf only) |
