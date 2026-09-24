# Draw Roll Race

A browser game in which you draw the arms and legs of a stick runner. Each limb
spins around its joint like a wheel. You race a CPU across obstacle courses and
can redraw your limbs at any time during a race.

Solo play needs no server: open `public/index.html` in a browser.

Races with friends need the Cloudflare Worker in this repo:

```sh
npm install
npm run dev      # http://localhost:8787
npm run deploy   # to your Cloudflare account (run `npx wrangler login` first)
```

### Automatic deploys

`.github/workflows/deploy.yml` runs checks on every pull request and push:
a syntax check, the CPU course simulation, and a Worker build. Each push to
`master` that passes them is deployed to Cloudflare Workers. It needs two
repository secrets (**Settings → Secrets and variables → Actions**):

- `CLOUDFLARE_API_TOKEN`: an API token made from the **Edit Cloudflare
  Workers** template.
- `CLOUDFLARE_ACCOUNT_ID`: your account ID, shown in the Cloudflare dashboard.

To deploy without a push, run the workflow from the **Actions** tab.

## How to play

- Start a stroke near the **hip** to draw legs or near the **shoulder** to draw
  arms. Each stroke is copied, rotated 180° around its joint, so a half circle
  becomes a full wheel and one straight line becomes a spinning bar.
- Your first stroke starts the race. Draw a new stroke at any time to swap that
  limb.
- Different obstacles need different shapes:
  - Big wheels are fast on hills and on the conveyor.
  - Long spokes get you over stairs, hurdles, trenches, water and mud.
  - Small wheels fit through tunnels.
  - A long arm helps you climb walls.
- The CPU also switches shapes, but it waits a few seconds before each switch
  and its limbs spin slower than yours.
- While you draw, a ring shows which joint the stroke will attach to.
- There are three fixed stages. After the last one, Endless mode generates new
  courses.
- **↻** restarts the current stage at any time. You get a message when the
  CPU crosses the finish line.
- Progress and best times are saved in your browser. When no race is running,
  tap the stage name to replay any stage you've unlocked.

## Racing online

When the game is served by the Worker, an **Online** button appears. It opens
a menu where you can:

- **Create a room.** Give it a name and choose **Public** (listed for anyone)
  or **Private** (joinable only with the invite link or the 5-character code).
  The host can switch between the two later.
- **Join with a code** that a friend gave you.
- **Browse public rooms** and join one. The list refreshes every few seconds.

A room holds up to 8 racers, people and CPUs combined. The host can fill
open slots with CPUs at easy, normal or hard, and remove them again. If
someone joins a room that is full because of CPUs, a CPU makes way for them.

The host picks the course (Stage 1–3 or a random generated course) and starts
the race. Everyone gets a 3-2-1 countdown. You see the other racers as
see-through runners with their names above them. When every person has
finished or given up (✕), CPUs still racing get up to 10 more seconds, then
the results appear. Anyone who joins mid-race watches and joins the next race.
A race ends after 4 minutes even if someone is stuck.

Each browser runs the physics for its own runner and sends its position
about 15 times a second. The host's browser also runs the room's CPUs. If the
host leaves, the player who has been there longest becomes host and takes
over the CPUs from where they were. Other browsers draw everyone 120 ms
behind real time so they can smooth the motion. Runners don't collide with
each other.

## CPUs and generated courses

- **CPU personalities:** every CPU gets a random personality from its seed:
  - how fast its limbs spin;
  - how quickly it reacts to the next obstacle, and how far ahead it looks;
  - how often it picks the wrong shape;
  - its own versions of the wheel, stilts, tunnel and climbing shapes.

  When it's stuck for 3 seconds, it tries the right shape for where it is,
  then the other shapes in turn. Difficulty sets the ranges these are drawn
  from. The solo CPU is a new normal-difficulty personality every race.
- **Generated courses:** Endless mode and the online "Random course" build
  courses from a seed. Each obstacle's sizes vary within ranges that a CPU has
  been checked to handle. Endless courses get longer and harder as you go.
  Stages 1–3 keep their fixed layouts.

## Code

- `public/src/physics.js`: course generation, the runner model and the fixed-step
  impulse physics (ground and ceiling contacts, friction, conveyor belts, ice,
  water and mud).
- `public/src/game.js`: the drawing pad, camera and rendering, the HUD, the CPU and
  race flow.
- `public/src/cpu.js`: CPU racers (difficulty, personality, reacting and
  recovering).
- `public/src/online.js`: the online menu, room lobby, drawing other racers,
  and running the room's CPUs when you are host.
- `worker/index.js`: the Worker. It serves the game files and the `/api`
  routes: new room codes, the public room list, room lookup, and the room
  connection.
- `worker/room.js`: the `RaceRoom` Durable Object, one per room. It keeps the
  room's settings and CPU slots, relays positions and drawings, runs the race
  (lobby, countdown, results) and checks finish times against its own clock.
  It uses WebSocket hibernation, so an idle room costs nothing.
- `worker/directory.js`: the `Directory` Durable Object, which lists public
  rooms.
- `tools/sim.cjs`: headless check that CPUs of every difficulty can finish
  the fixed stages, Endless stages and random courses. Run it with
  `node tools/sim.cjs [endless] [random] [cpusPerDifficulty]`.
