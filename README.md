# Draw Roll Race

A browser game in which you draw the arms and legs of a stick runner. Each limb
spins around its joint like a wheel. You race CPUs or friends across obstacle
courses and can redraw your limbs at any time during a race.

Live at <https://draw-roll-race.k.workers.dev>.

Solo play needs no server: open `public/index.html` in a browser. Online
rooms and the daily leaderboard need the Cloudflare Worker in this repo:

```sh
npm install
npm run dev        # http://localhost:8787
npm run deploy     # to your Cloudflare account (run `npx wrangler login` first)
npm test           # CPU course simulation + browser tests
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
  (UTC), with a leaderboard of the fastest runs.
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
slots with CPUs and picks the course (Stage 1–3 or a random generated course).
Everyone gets a 3-2-1 countdown. Other racers appear as see-through runners
with their names above them. When every person has finished or given up (✕),
CPUs still racing get up to 10 more seconds, then the results appear. Anyone
who joins mid-race watches and joins the next one. If your connection drops,
you rejoin within a minute as the same racer and keep racing.

## How it works

- Each browser runs the physics for its own runner and sends its position
  about 15 times a second. Other browsers draw everyone 120 ms behind real time
  so the motion can be smoothed. Runners don't collide with each other.
- The room (a Durable Object) runs the CPUs with the same physics and CPU code
  the browser uses, so they keep racing whoever is watching.
- The room builds the course too, and only counts a finish if the player's
  reported positions reached the line at a speed a runner can reach.
- Daily runs are sent with a recording of the runner's position (ten samples a
  second). The server rebuilds the day's course and refuses runs that don't
  start at the start, move impossibly fast, have gaps, miss the finish, or
  don't match the claimed time.
- Player and room names are checked against a list of blocked words. Creating
  rooms and sending daily runs are rate-limited per network.
- Race and daily-run numbers go to Workers Analytics Engine (dataset
  `draw_roll_race`).

### CPUs and generated courses

- Every CPU gets a personality from its seed: how fast its limbs spin, how
  quickly it reacts, how far ahead it looks, how often it picks the wrong
  shape, and its own versions of each shape. When stuck for 3 seconds, it tries
  the right shape for where it is, then the others. When spikes break a limb,
  it redraws it after its reaction time.
- Generated courses vary each obstacle's sizes within ranges that
  `tools/sim.cjs` checks CPUs of every difficulty can finish.

## Deploys and previews

`.github/workflows/deploy.yml`:

- **Every pull request and push:** a syntax check, the CPU course simulation,
  a Worker build, and the browser tests (`tests/e2e`, run against a local
  Worker).
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

- `public/src/physics.js`: courses (fixed stages, tutorial, daily and
  generated), the runner model and the fixed-step physics (ground and ceiling
  contacts, friction, belts, ice, water, mud, spikes, wind, low gravity, bounce
  pads).
- `public/src/cpu.js`: CPU racers.
- `public/src/game.js`: drawing pad, rendering, HUD, solo races, ghosts, daily
  course, tutorial and options.
- `public/src/online.js`: the online menu, room lobby and drawing other racers.
- `public/src/sound.js`: synthesised sound effects and vibration.
- `worker/index.js`: the Worker's `/api` routes.
- `worker/room.js`: the `RaceRoom` Durable Object, one per room.
- `worker/directory.js`: the `Directory` Durable Object that lists public rooms.
- `worker/daily.js`: the daily leaderboard (D1) and run checks.
- `worker/moderation.js`: the name filter.
- `tools/sim.cjs`: headless check that CPUs finish every kind of course
  (`node tools/sim.cjs [endless] [random] [cpusPerDifficulty]`).
- `tests/e2e/`: browser tests (`npm run test:e2e` starts a local Worker with
  the short test courses enabled).
