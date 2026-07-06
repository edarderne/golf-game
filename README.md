# ⛳ Island Golf

Two-player online golf in the browser. Create a game, send the 4-letter code
to a friend, and play a 3/6/9-hole round on procedurally generated island
holes — pick a club, aim, and hit the classic 3-tap swing meter (mistime it
and you'll slice, hook, or come up short).

## How it works

- **Static site** — no build step. Plain HTML/CSS/JS, deploys anywhere
  (Vercel, like the other projects).
- **Multiplayer** — Firebase Realtime Database (the same `office-mafia`
  Firebase project as the Mafia game) under its own `golf/rooms/*` path,
  with anonymous auth. Turn-based sync: only the shot *inputs* (club, aim,
  power, accuracy) are sent; both clients replay the same deterministic
  physics, so the result is identical on both screens.
- **Courses** — generated from the room seed (`js/course.js`), so both
  players build the exact same holes locally.
- **Characters** — built on the home screen, saved in `localStorage`,
  re-used every game.

## One-time setup: deploy the database rules

The `office-mafia` database rules must include the `golf` section in
[database.rules.json](database.rules.json) (this file also contains the
existing Mafia rules — deploying it replaces the whole ruleset, so both are
kept together). From this folder:

```bash
npx firebase-tools login
npx firebase-tools deploy --only database --project office-mafia
```

Until the rules are deployed, online games fail with a permission error
(practice rounds still work).

## Local development

```bash
python3 -m http.server 8641
# open http://localhost:8641
```

- **Practice round** on the home screen plays offline (no Firebase).
- **Two-player testing**: open `http://localhost:8641/dev/two.html` — two
  iframes play against each other through a localStorage sync shim
  (`?dev2`), no Firebase or emulator needed.

## Gameplay notes

- Swing meter: tap once to start, tap to lock **power** on the rising bar,
  tap again when the marker returns to the line for **accuracy**. Early →
  hook (curves left), late → slice (curves right), inside the small green
  zone → dead straight. Perfect power + perfect timing = "PERFECT strike!".
- Wind (top right) drifts airborne shots; high-lofted clubs drift more.
  Putts ignore wind.
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
| `js/physics.js` | Clubs, deterministic shot/roll simulation |
| `js/render.js` | Canvas island renderer (sea, beach, trees, rocks, pin) |
| `js/game.js` | Screens, swing meter, turn flow, sync logic |
| `js/net.js` | Firebase auth + room create/join/watch |
| `js/devnet.js` | `?dev2` localStorage net shim for local 2-player testing |
| `js/character.js` | Character options, persistence, sprite drawing |
| `database.rules.json` | Full RTDB ruleset (Mafia rules + golf rules) |
