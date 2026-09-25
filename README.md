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
- **No room to turn:** a limb wedged between opposite surfaces, such as a
  tunnel roof and the floor or the underside of a block and the ground, that
  can barely turn shatters after a moment instead of grinding through the rock.
  A limb drawn too big for where you are breaks at once, so draw a smaller one
  (the rule is in `shared/physics.ts`).
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

**🎲 Random course** on the start screen picks one of a million generated
courses, ready to race when you draw. After the daily course or the tutorial,
the results card offers one too, raced straight away.

## Customize (🎨)

The 🎨 **Customize** button on the start screen dresses up your runner: a hair
style (spiky, bob, long, mohawk, afro, ponytail), a hat (cap, top hat, beanie,
crown, party hat), eyes (dot, big, sleepy, happy, angry, starry) and glasses
(round, square, shades, monocle, goggles), or tap **Shuffle**. Your look shows
on your runner, your ghost and the drawing pad, and other players see it in
rooms. It is purely cosmetic.

Choosing a look needs a player saved with a passkey (the modal offers **Save
with a passkey**). A chosen look is kept on the server with your player, so it
follows your passkey to other devices.

## Default name and look

Every player starts with a name and a look picked by their public player hash,
so they stay the same from round to round and on every device. The name is
"Adjective Noun" from 64 upbeat adjectives and 64 sports nouns (e.g. *Swift
Sprinter*, *Plucky Goalie*: `shared/names.ts`); the look picks each part from
the next bytes of the hash (`lookFromHash` in `shared/look.ts`). Both are only
fallbacks: once you type a name or choose a look, that is stored and shown
instead. The server fills in the same default name on leaderboards for players
who haven't chosen one.

## Your performance

Every run you finish, except in the tutorial, is sent to the server. This covers
solo stages, the daily course and room races. The server replays each run,
keeps the time the replay gives, and remembers **your best time on each
course**. Only these bests count for stats. Running a course again only
counts if you beat your best, though it still marks the course as recently
played.

Once you have finished 20 different courses, the results card and Options show
your **performance percentile**. It is the share of everyone's course bests that
your bests on your last 100 courses beat, on average. Mixing courses makes this
rough, but it still moves while each course has only a few players. Until then,
the results card counts the courses you still need.

**By section type:** the replay also times each section of the course. Options
lists your percentile for each section type in your course bests, such as Chasm
or Wind, and the results card names your strongest and weakest types.
Sections of one type come in different sizes, so they compare by **speed
through the section** (length ÷ time) against everyone's bests. Each type needs
20 passes first, and a type appears in about half of generated courses, so these
take longer to show than the overall number.

To keep this cheap, the server keeps counts of bests in each 0.1 s time bucket,
and of section passes in each 5 units/s speed bucket for each type. Working out
a percentile reads your bests plus at most a few thousand small rows
(`shared/stats.ts`, `worker/runs.ts`). When a best improves, its old counts are
taken out. Signing in with a passkey moves an unsaved device's bests over,
keeping the better one where both ran a course. Runs are rate limited to 60 a
minute for each network.

## Options (⚙)

- **Your player:** your name, your performance percentile, and passkeys to keep your player on any device (see
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
- There is one button, **Save with a passkey** (in Options → Your player, in Customize, and
  as **Save your score** after a daily run), with no separate "create account" and "sign in":
  - It first offers the browser's passkeys for the site. Using one makes this device that
    passkey's player: the server sends that player's ID to this browser only, and remaps the
    device's own anonymous player into it (its daily times and course bests move over, keeping
    the better one).
  - If none is used, it asks: **Make a new passkey** or **Try again**. Browsers report "you
    cancelled" and "you have no passkey" the same way, so the game never makes one without
    asking: a returning player who dismissed the sheet would otherwise end up with a second
    player. A new passkey claims the device's player: from then on, posting as that player
    needs a signed-in session (an HttpOnly cookie), not just the ID.
  - Returning players can also sign in by picking their passkey from the name field's
    autofill suggestions in Options (where the browser supports passkey autofill).
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
  for where it is, then the others. When spikes break a limb (or it's crushed), it redraws it.
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
  - `render/`: the scene and camera, obstacles, runners (with their looks: `look.ts`) and
    shattered pieces. `lookPicker.ts` is the Customize modal and `appearance.ts` picks the look each round; `shared/look.ts` lists the
    choices.
  - `online/`: the connection, the Online menu, the lobby, and other racers.
- `src/worker/`: the Cloudflare Worker.
  - `index.ts` (routes), `room.ts` (the `RaceRoom` Durable Object), `roomState.ts`,
    `directory.ts` (the public room list),
    `daily.ts` (the leaderboard), `runs.ts` (best runs per course, for stats), `auth.ts` (passkeys), `players.ts` (players and sessions),
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
