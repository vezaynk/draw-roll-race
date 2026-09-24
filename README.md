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

## Racing friends

When the game is served by the Worker, a **Race friends** button appears.
It creates a room and gives you an invite link to share. Everyone in the room
draws a runner, and the host picks a course and starts the race. You see the
other players as see-through runners with their names above them. When
everyone has finished (or given up with ✕), the results appear and the host
can start another race. Anyone who joins mid-race watches and joins the next
race. A room holds up to 8 players, and a race ends after 4 minutes even if
someone is stuck.

Each browser runs the physics for its own runner and sends its position
about 15 times a second. The other browsers draw that runner 120 ms behind
real time so they can smooth its motion. Runners don't collide with each
other.

## Code

- `public/src/physics.js`: course generation, the runner model and the fixed-step
  impulse physics (ground and ceiling contacts, friction, conveyor belts, ice,
  water and mud).
- `public/src/game.js`: the drawing pad, camera and rendering, the HUD, the CPU and
  race flow.
- `public/src/online.js`: rooms, the lobby, and drawing other players.
- `worker/index.js`: the Worker. It serves the game files and the `/api`
  routes (room codes, the room connection).
- `worker/room.js`: the `RaceRoom` Durable Object, one per room. It relays
  positions and drawings, runs the race (lobby, countdown, results) and checks
  finish times against its own clock. It uses WebSocket hibernation, so an
  idle room costs nothing.
- `tools/sim.cjs`: headless check that the CPU can finish every stage. Run it
  with `node tools/sim.cjs [stages]`.
