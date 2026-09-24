// Headless check that every kind of course can be finished: the fixed stages, the tutorial, the
// test courses, daily courses, Endless stages and random courses, each played by the scripted
// player the tests use (tests/support/bot.ts). Also checks the tutorial's CPU finishes it.
// Usage: npm run sim -- [endless=25] [random=25] [days=10]
import { CFG } from '../src/shared/config';
import buildCourse from '../src/shared/course/build';
import {
  RANDOM_BASE, STAGES, TEST_STAGES, TUTORIAL, dailyStage, stageSections, today,
} from '../src/shared/course/stages';
import CpuRacer from '../src/shared/cpu/racer';
import botRun from '../tests/support/bot';

/** Seconds: the room's race limit. */
const LIMIT = 240;
const DAY_MS = 86400000;
const TUTORIAL_CPUS = 20;

const [endless = 25, random = 25, days = 10] = process.argv.slice(2).map(Number);
const firstDay = Date.parse(`${today()}T00:00:00Z`);
const stages = [
  ...STAGES.map((_, i) => i),
  TUTORIAL,
  ...Object.keys(TEST_STAGES).map(Number),
  ...Array.from({ length: days }, (_, i) => dailyStage(new Date(firstDay + i * DAY_MS).toISOString().slice(0, 10))),
  ...Array.from({ length: endless }, (_, i) => STAGES.length + i),
  ...Array.from({ length: random }, (_, i) => RANDOM_BASE + 7919 * i + 13),
];

/** Where on the course a run stopped, for the report. */
function whereStuck(stage: number, x: number): string {
  const at = buildCourse(stage).sections.find((s) => x >= s.from - 60 && x <= s.to + 60);
  return at ? at.label : `x=${Math.round(x)}`;
}

let failures = 0;
const times: number[] = [];
stages.forEach((stage) => {
  const run = botRun(buildCourse(stage), LIMIT);
  if (run.finished) {
    times.push(run.time);
    return;
  }
  failures += 1;
  console.log(`stage ${stage} FAIL: not finished in ${LIMIT} s\n    ${stageSections(stage).map((s) => s.type).join(',')}`);
});
const mean = times.reduce((a, t) => a + t, 0) / (times.length || 1);
console.log(`player finished ${times.length}/${stages.length} courses, mean ${mean.toFixed(1)}s`);

// The tutorial's CPU (a new personality each race) must be able to finish it too.
const tutorial = buildCourse(TUTORIAL);
let cpuFinished = 0;
for (let seed = 1; seed <= TUTORIAL_CPUS; seed += 1) {
  const cpu = new CpuRacer(tutorial, { seed, color: '#000' });
  for (let t = 0; t < LIMIT && cpu.finishTime === null; t += CFG.DT) cpu.step(CFG.DT, t);
  if (cpu.finishTime !== null) cpuFinished += 1;
  else console.log(`tutorial CPU seed ${seed} FAIL: stuck at ${whereStuck(TUTORIAL, cpu.runner.x)}`);
}
console.log(`tutorial CPU finished ${cpuFinished}/${TUTORIAL_CPUS}`);
failures += TUTORIAL_CPUS - cpuFinished;

console.log(failures ? `${failures} failed` : 'all finished');
process.exitCode = failures ? 1 : 0;
