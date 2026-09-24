# Draw Roll Race

A browser game in which you draw the arms and legs of a stick runner. Each limb
spins around its joint like a wheel. You race a CPU across obstacle courses and
can redraw your limbs at any time during a race.

Open `index.html` in a browser. There is no build step and no dependencies.

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
- **Share my runner** opens the share sheet on phones. On desktop it copies
  the image and opens a post on X.

## Code

- `src/physics.js`: course generation, the runner model and the fixed-step
  impulse physics (ground and ceiling contacts, friction, conveyor belts, ice,
  water and mud).
- `src/game.js`: the drawing pad, camera and rendering, the HUD, the CPU and
  race flow, and sharing.
- `tools/sim.js`: headless check that the CPU can finish every stage. Run it
  with `node tools/sim.js [stages]`.
