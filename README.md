# Draw Roll Race

A browser game in which you draw the arms and legs of a stick runner. Each limb
spins around its joint like a wheel. You race CPUs or friends across obstacle
courses and can redraw your limbs at any time during a race.

Live at <https://draw-roll-race.k.workers.dev>.

Solo play needs no server: run `npm run build`, then open `public/index.html` in a browser.
Online rooms and the daily leaderboard need the Cloudflare Worker in this repo:

```sh
npm install
npm run dev        # http://localhost:8787
npm run deploy     # to your Cloudflare account (run `npx wrangler login` first)
npm test           # type check, unit tests, CPU course simulation, browser tests
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
- **Spikes** shatter any limb that touches them. Draw a new one: a fresh limb
  is safe from spikes for a second, so you can climb back out.
- New players start with a **tutorial** that shows a tip before each obstacle.
  Elsewhere, a tip appears the first time you meet each obstacle.
- There are three fixed stages. After the last one, Endless mode generates new
  courses that get longer and harder.
- **↻** restarts the current course. When no race is running, tap the stage
  name to switch between the tutorial and the stages you have unlocked.

## Options (⚙)

- **Today's daily course:** the same generated course for everyone each day
  (UTC), with a leaderboard of the fastest runs. The day's leader races with
  you as a gold ghost.
- **Solo opponents:** 0–7 CPUs at easy, normal, hard or mixed difficulty.
- **Race your best run:** your fastest run on each course comes back as a
  see-through "ghost" to beat.
- Sound effects, vibration on phones, and a small, normal or large drawing
  pad. On a phone held sideways, the pad moves to a corner.

Progress, best times, ghosts and options are saved in your browser.

## Racing online

When the game is served by the Worker, an **Online** button appears. You can:

- **Create a room.** Give it a name and choose **Public** (listed for anyone)
  or **Private** (joinable only with the invite link or the 5-character code).
  The host can switch between the two later.
- **Join with a code** that a friend gave you.
- **Browse public rooms** and join one.

A room holds up to 8 racers, people and CPUs combined. The host fills open
slots with CPUs and picks the course (Stage 1–3, a random generated course, or
the same course again). The host can start the race, or everyone can tap
**I'm ready**: when every person in the room is ready, the race starts by
itself. Everyone gets a 3-2-1 countdown. Other racers appear as see-through runners
with their names above them. When every person has finished or given up (✕),
CPUs still racing get up to 10 more seconds, then the results appear. Anyone
who joins mid-race watches and joins the next one; the camera follows the
leader, or tap **Watching … · next** to follow someone else. If your
connection drops, you rejoin within a minute as the same racer and keep racing.

Six quick emotes (👋 😂 😮 🔥 👏 😭) pop up as bubbles over your runner, or as a
message in the lobby.

## How it works

- Each browser runs the physics for its own runner and sends its position
  about 15 times a second. Other browsers draw everyone 120 ms behind real time
  so the motion can be smoothed. Runners don't collide with each other.
- The room (a Durable Object) runs the CPUs with the same physics and CPU code
  the browser uses, so they keep racing whoever is watching.
- The room builds the course too, and only counts a finish if the player's
  reported positions reached the line at a speed a runner can reach.
- Daily runs are timed by the server. The game records what you drew at which
  physics step; the server replays those drawings on the day's course with the
  same physics and records the replay's time, not the time the browser claims.
  A run that doesn't reach the finish is refused. The replay runs in a
  `RunCheck` Durable Object, a slice at a time, so no single request uses much
  CPU time. Each player's best run is kept, and the day's fastest is sent to
  other players, who rebuild it as the leader ghost by replaying it too.
- For replays to match, the physics must give identical numbers in every
  browser and on the server. JavaScript rounds `+ − × ÷` and square roots the
  same everywhere, but `Math.sin`, `Math.cos` and `Math.hypot` may differ in
  the last bit between engines, so the shared code uses its own versions
  (`src/shared/fmath.ts`).
- Player and room names are checked against a list of blocked words. Creating
  rooms and sending daily runs are rate-limited per network.
- Race and daily-run numbers can go to Workers Analytics Engine: enable it on
  the account, then add a `STATS` binding in `wrangler.jsonc`.

### CPUs and generated courses

- Every CPU gets a personality from its seed: how fast its limbs spin, how
  quickly it reacts, how far ahead it looks, how often it picks the wrong
  shape, and its own versions of each shape. When stuck for 3 seconds, it tries
  the right shape for where it is, then the others. When spikes break a limb,
  it redraws it after its reaction time.
- Generated courses vary each obstacle's sizes within ranges that
  `tools/sim.ts` checks CPUs of every difficulty can finish.

## Deploys and previews

`.github/workflows/deploy.yml`:

- **Every pull request and push:** type check, unit tests, the CPU course
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
    physics), `replay.ts` (stepping a player's run, and replaying recorded runs), `cpu/` (CPU personalities and the `CpuRacer`), `validation.ts` (checks that runs
    are possible) and `protocol.ts` (messages between browsers and rooms).
- `src/client/`: the game in the browser, bundled by esbuild into `public/app.js`.
  - `main.ts` boots it. `state.ts` holds the game state and the hooks online play uses.
  - `race.ts` (the race loop), `pad.ts` (drawing), `hud.ts`, `results.ts`, `controls.ts`,
    `options.ts`, `ghost.ts`, `daily.ts`, `sound.ts`, `storage.ts`.
  - `render/`: the scene and camera, obstacles, runners and shattered pieces.
  - `online/`: the connection, the Online menu, the lobby, and other racers.
- `src/worker/`: the Cloudflare Worker.
  - `index.ts` (routes), `room.ts` (the `RaceRoom` Durable Object), `roomState.ts`,
    `cpuSimulation.ts` (runs a room's CPUs), `directory.ts` (the public room list),
    `daily.ts` (the leaderboard), `runCheck.ts` (the `RunCheck` Durable Object that replays
    daily runs), `moderation.ts`, `http.ts`, `env.ts`.
- `tools/sim.ts`: checks that CPUs finish every kind of course
  (`npm run sim -- [endless] [random] [cpusPerDifficulty]`).
- `tests/unit/`: fast tests of the shared code (`npm run test:unit`): replays match exactly,
  course generation and the physics haven't changed by accident, limb encoding, validation,
  moderation, CPU personalities.
- `tests/e2e/`: browser tests (`npm run test:e2e` starts a local Worker with the short test
  courses enabled).
- `tests/support/bot.ts`: a scripted player that records runs like the game does.

Wrangler runs `npm run build` before `dev` and `deploy`, so the browser bundle is always
current. `npm test` runs the type check, unit tests, simulation and browser tests.
