// A scripted player for tests: plays a course the way a person would (a wheel, then the shape
// each section needs, redrawing limbs that spikes broke) and records its inputs like the game
// does, so the run can be replayed and sent to the daily leaderboard.
import { CFG } from '../../src/shared/config';
import { planIndex } from '../../src/shared/course/queries';
import { normalizeStroke, packLimbs } from '../../src/shared/limbs';
import { POSES } from '../../src/shared/poses';
import { runnerAtStart, stepPlayer } from '../../src/shared/replay';
import type { RunInput } from '../../src/shared/replay';
import { swapLimbs } from '../../src/shared/runner';
import type { Course, Limbs, Pose } from '../../src/shared/types';

const LOOK_AHEAD = 90;
const RECOVERY: readonly Pose[] = ['stilts', 'wheel', 'climber', 'mini'];

/** The ready-made shapes as the pad would store them. */
const SHAPES = Object.fromEntries(Object.entries(POSES).map(([pose, limbs]) => [pose, {
  arm: limbs.arm.map(normalizeStroke),
  leg: limbs.leg.map(normalizeStroke),
}])) as Record<Pose, Limbs>;

export interface BotRun {
  inputs: RunInput[];
  finished: boolean;
  time: number;
}

export default function botRun(course: Course, maxSeconds = 240): BotRun {
  let pose: Pose = 'wheel';
  let limbs = SHAPES.wheel;
  let runner = runnerAtStart(course, limbs);
  const inputs: RunInput[] = [[0, packLimbs(limbs)]];
  let steps = 0;
  let time = 0;
  let bestX = runner.x;
  let bestAt = 0;
  let tries = 0;
  const draw = (next: Pose) => {
    pose = next;
    limbs = SHAPES[next];
    runner = swapLimbs(course, runner, limbs);
    inputs.push([steps, packLimbs(limbs)]);
  };
  while (time < maxSeconds) {
    const want = course.plan[planIndex(course, runner.x + LOOK_AHEAD)].pose;
    const broken = limbs.arm.length < SHAPES[pose].arm.length || limbs.leg.length < SHAPES[pose].leg.length;
    if (want !== pose || broken) draw(want);
    if (runner.x > bestX + 25) {
      bestX = runner.x;
      bestAt = time;
    } else if (time - bestAt > 3) {
      // Stuck: try the other shapes in turn.
      tries += 1;
      draw(RECOVERY.filter((p) => p !== pose)[tries % 3]);
      bestAt = time;
    }
    time += CFG.DT;
    steps += 1;
    const shattered = stepPlayer(course, runner, limbs);
    if (shattered) ({ runner, limbs } = shattered);
    if (runner.x >= course.finishX) return { inputs, finished: true, time };
  }
  return { inputs, finished: false, time };
}
