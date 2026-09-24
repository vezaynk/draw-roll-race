# Draw Roll Race

A browser game in which you draw the arms and legs of a stick runner. Each limb
spins around its joint like a wheel. You race the clock, your own ghost or friends
across obstacle courses and can redraw your limbs at any time during a race.

Live at <https://draw-roll-race.k.workers.dev>.

Solo play needs no server: run `npm run build`, then open `public/index.html` in a browser.
Online rooms and the daily leaderboard need the Cloudflare Worker in this repo:

```sh
npm install
npm run dev        # http://localhost:8787
npm run deploy     # to your Cloudflare account (run `npx wrangler login` first)
npm test           # type check, unit tests, course simulation, browser tests
```

## How to play

- Start a stroke near the **hip** to draw legs or near the **shoulder** to draw
  arms. Each stroke is copied, rotated 180° around its joint, so a half circle
  becomes a full wheel and one straight line becomes a spinning bar. While you
  draw, a ring shows which joint the stroke will attach to.
- Your first stroke starts the race. Draw a new stroke at any time to swap that
  limb.
- Different obstacles need different shapes:
  - Big wheels are fast on hills, into headwinds and on the conveyor.
  - Long spokes get you over stairs, hurdles, trenches, water, mud and spike
    pits.
  - Small wheels fit through tunnels.
  - A long arm helps you climb walls, but it shatters on a spiked ceiling.
- **Hanging blocks** (prototype, test course only: open `?stage=992`) float
  above a spike pit too wide to vault. They are ordinary solid blocks: an arm
  long enough to reach them, or hooked at the end, catches their edges and
  carries you across. `npx tsx tools/blocks.ts` compares arm shapes.
- **Double-tap** (or double-click) the pad to clear the limb nearest your tap.
  Mid-race, your runner carries on without it.
- **Spikes** shatter any limb that touches them. Draw a new one: a fresh limb
  is safe from spikes for a second, so you can climb back out.
- The game opens on today's **daily course**, ready to race. The **tutorial**
  shows a tip before each obstacle (new players are pointed to it) and is the
  only place with a CPU to race against; elsewhere, a tip appears the first
  time you meet each obstacle.
- There are three fixed stages. After the last one, Endless mode generates new
  courses that get longer and harder.
- Before a race, buttons above the drawing pad open the **Daily course**, the
  **Tutorial** and **Play with friends** (online rooms). Tap the stage name to
  switch between the tutorial and the stages you have unlocked. Until a race
  starts, the selected course's name is shown large, with "Draw a limb to
  start" under it.
- **Exit** (top bar, and on the results card after any race) stops the race and goes back to
  the start screen.

The **Daily course** is the same generated course for everyone each day (UTC),
with a leaderboard of the fastest runs. The start screen names the day's
leader, but only your own best run comes back as a ghost: nobody's run is
shown to other players, so strategies stay private.

## Options (⚙)

- **Your player:** your name, and passkeys to keep your player on any device (see
  [Players and passkeys](#players-and-passkeys)).
- **Race your best run:** your fastest run on each course comes back as a
  see-through "ghost" to beat.
- Sound effects, vibration on phones, and a small, normal or large drawing
  pad. On a phone held sideways, the pad moves to a corner.

Progress, best times, ghosts and options are saved in your browser.

## Racing online

When the game is served by the Worker, a **Play with friends** button appears on the start
screen. You can:

- **Create a room.** Give it a name and choose **Public** (listed for anyone)
  or **Private** (joinable only with the invite link or the 5-character code).
  The host can switch between the two later.
- **Join with a code** that a friend gave you.
- **Browse public rooms** and join one.

A room holds up to 8 people. The host picks the course (Stage 1–3, a random generated course, or
the same course again). The host can start the race, or everyone can tap
**I'm ready**: when every person in the room is ready, the race starts by
itself. Everyone gets a 3-2-1 countdown. Other racers appear as see-through runners
with their names above them. When every person has finished or given up, the
results appear. Anyone
who joins mid-race watches and joins the next one; the camera follows the
leader, or tap **Watching … · next** to follow someone else. If your
connection drops, you rejoin within a minute as the same racer and keep racing.
**Exit** (in the top bar or on the room card) takes you back to the start screen; leaving during a
race gives it up.

Six quick emotes (👋 😂 😮 🔥 👏 😭) pop up as bubbles over your runner, or as a
message in the lobby.

## How it works

- Each browser runs the physics for its own runner and sends its position
  about 15 times a second. Other browsers draw everyone 120 ms behind real time
  so the motion can be smoothed. Runners don't collide with each other.
- Every finish is checked by replaying it, in rooms as on the daily course
  (below). A finish sends what the player drew at which physics step; the room
  lists it at once with a spinner, replays it, then marks it ✅ (the replay's
  time replaces the claimed one) or crosses the name out with ⚠️ if the replay
  doesn't reach the finish, or reaches it later than the room's clock allows.
  Hover a mark to see how long the check took. The daily leaderboard shows ✅
  on every run, since only replayed runs are saved.
- Daily runs are timed by the server. The game records what you drew at which
  physics step; the server replays those drawings on the day's course with the
  same physics and records the replay's time, not the time the browser claims.
  A run that doesn't reach the finish is refused. The replay runs in a
  `RunCheck` Durable Object, a slice at a time, so no single request uses much
  CPU time. Each player's best run is kept on the server, but runs are never
  sent to other players.
- For replays to match, the physics must give identical numbers in every
  browser and on the server. JavaScript rounds `+ − × ÷` and square roots the
  same everywhere, but `Math.sin`, `Math.cos` and `Math.hypot` may differ in
  the last bit between engines, so the shared code uses its own versions
  (`src/shared/fmath.ts`).
- Player and room names are checked against a list of blocked words. Creating
  rooms and sending daily runs are rate-limited per network.
- Race results, daily runs and replay checks (how long each took, and whether
  the run reached the finish) are recorded in Workers Analytics Engine, in the
  `draw_roll_race` dataset (`draw_roll_race_preview` for PR previews).

### Players and passkeys

- Every player has a secret random ID (a UUID) and a display name, both saved in the
  browser. The server never sends anyone's ID out: leaderboards carry a public hash of it
  (the first 128 bits of SHA-256), and each browser finds its own rows by hashing its own ID.
- There is one button, **Save with a passkey** (in Options → Your player, and as **Save
  your score** after a daily run), with no separate "create account" and "sign in":
  - If the browser has a passkey for the site, using it makes this device that passkey's
    player: the server sends that player's ID to this browser only, and remaps the device's
    own anonymous player into it (its daily times move over, keeping the better time per day).
  - Otherwise a new passkey is made for the device's player, which claims it: from then on,
    posting as that player needs a signed-in session (an HttpOnly cookie), not just the ID.
  - Some browsers show an empty passkey list first when there is none yet; dismissing it goes
    on to make one (or, if the browser needs a fresh tap for that, the next tap does).
- A player can have any number of passkeys; a saved device adds one with **Add another
  passkey**. **Log out** ends the session and forgets everything the game saved on that
  device, which then starts as a new player.
- Passkeys belong to the exact site address, so each PR preview has its own. Challenges are
  single-use and expire after five minutes; sessions are stored as hashes of their tokens.
- The player and their daily scores follow the passkey; other progress (best times,
  unlocked stages, ghosts) stays on each device.

### The tutorial CPU and generated courses

- The tutorial's CPU gets a personality from a random seed: how fast its limbs
  spin (slowly), how quickly it reacts, how far ahead it looks, and its own
  versions of each shape. When stuck for 3 seconds, it tries the right shape
  for where it is, then the others. When spikes break a limb, it redraws it.
- Generated courses vary each obstacle's sizes within ranges that
  `tools/sim.ts` checks a scripted player (the tests' `tests/support/bot.ts`)
  can finish.

## Deploys and previews

`.github/workflows/deploy.yml`:

- **Every pull request and push:** type check, unit tests, the course
  simulation, a Worker build, and the browser tests (`tests/e2e`, run against
  a local Worker).
- **Pull requests from this repository:** a `wrangler preview` deployment named
  `pr-<number>`, with its own rooms and a separate preview database. Its link is
  posted on the pull request and it is deleted when the pull request closes.
- **Pushes to `master`:** deploy to production once the checks pass.

It needs two repository secrets (**Settings → Secrets and variables →
Actions**): `CLOUDFLARE_API_TOKEN` (made from the **Edit Cloudflare Workers**
template) and `CLOUDFLARE_ACCOUNT_ID`.

The daily leaderboard uses the D1 databases `draw-roll-race` (production) and
`draw-roll-race-preview` (previews). The table is created on first use.

## Code

TypeScript throughout, written to the Airbnb style guide's principles (no linter), in three layers:

- `src/shared/`: everything the browser, the server and the simulation share, with no DOM or
  Worker dependencies.
  - `config.ts`, `types.ts`, `random.ts`, `fmath.ts`, `geometry.ts`, `limbs.ts`, `poses.ts`
  - `course/`: the obstacle catalogue (`sections.ts`), stages, the tutorial, the daily and
    generated courses (`stages.ts`), terrain building (`build.ts`), lookups (`queries.ts`) and
    obstacle tips (`tips.ts`).
  - `runner.ts` (the stick figure and its spinning limbs), `physics.ts` (the fixed-step
    physics), `replay.ts` (stepping a player's run, and replaying recorded runs), `cpu/` (the tutorial's CPU racer) and `protocol.ts` (messages between browsers and rooms).
- `src/client/`: the game in the browser, bundled by esbuild into `public/app.js`.
  - `main.ts` boots it. `state.ts` holds the game state and the hooks online play uses.
  - `race.ts` (the race loop), `pad.ts` (drawing), `hud.ts`, `results.ts`, `controls.ts`,
    `options.ts`, `ghost.ts`, `daily.ts`, `sound.ts`, `storage.ts`.
  - `render/`: the scene and camera, obstacles, runners and shattered pieces.
  - `online/`: the connection, the Online menu, the lobby, and other racers.
- `src/worker/`: the Cloudflare Worker.
  - `index.ts` (routes), `room.ts` (the `RaceRoom` Durable Object), `roomState.ts`,
    `directory.ts` (the public room list),
    `daily.ts` (the leaderboard), `auth.ts` (passkeys), `players.ts` (players and sessions),
    `db.ts` (the D1 tables), `verify.ts` (checks a run by replaying it), `runCheck.ts` (the `RunCheck` Durable Object that replays
    runs), `moderation.ts`, `http.ts`, `env.ts`.
- `tools/sim.ts`: checks that every kind of course can be finished, and that the tutorial CPU
  finishes the tutorial (`npm run sim -- [endless] [random] [days]`).
- `tests/unit/`: fast tests of the shared code (`npm run test:unit`): replays match exactly,
  course generation and the physics haven't changed by accident, limb encoding,
  moderation, the tutorial CPU.
- `tests/e2e/`: browser tests (`npm run test:e2e` starts a local Worker with the short test
  courses enabled).
- `tests/support/bot.ts`: a scripted player that records runs like the game does.

Wrangler runs `npm run build` before `dev` and `deploy`, so the browser bundle is always
current. `npm test` runs the type check, unit tests, simulation and browser tests.
