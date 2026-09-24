// Headless check that CPUs of every difficulty can finish every kind of course: the fixed
// stages, the tutorial, today's daily course, Endless stages and random courses.
// Usage: npm run sim -- [endless=25] [random=25] [cpusPerDifficulty=3]
import { CFG } from '../src/shared/config';
import buildCourse from '../src/shared/course/build';
import {
  RANDOM_BASE, STAGES, TUTORIAL, dailyStage, stageSections, today,
} from '../src/shared/course/stages';
import { DIFFICULTIES } from '../src/shared/cpu/personality';
import type { Difficulty } from '../src/shared/cpu/personality';
import CpuRacer from '../src/shared/cpu/racer';

/** Seconds: the room's race limit. */
const LIMIT = 240;

type Outcome = { ok: true; time: number } | { ok: false; why: string };

function race(stage: number, difficulty: Difficulty, seed: number): Outcome {
  const course = buildCourse(stage);
  const cpu = new CpuRacer(course, { seed, difficulty, color: '#000' });
  for (let t = 0; t < LIMIT && cpu.finishTime === null; t += CFG.DT) {
    cpu.step(CFG.DT, t);
    if (!Number.isFinite(cpu.runner.x) || !Number.isFinite(cpu.runner.y)) return { ok: false, why: 'NaN' };
  }
  if (cpu.finishTime !== null) return { ok: true, time: cpu.finishTime };
  const { x } = cpu.runner;
  const at = course.sections.find((s) => x >= s.from - 60 && x <= s.to + 60);
  return { ok: false, why: `stuck at ${at ? at.label : `x=${Math.round(x)}`}` };
}

const [endless = 25, random = 25, perDifficulty = 3] = process.argv.slice(2).map(Number);
const stages = [
  ...STAGES.map((_, i) => i),
  TUTORIAL,
  dailyStage(today()),
  ...Array.from({ length: endless }, (_, i) => STAGES.length + i),
  ...Array.from({ length: random }, (_, i) => RANDOM_BASE + 7919 * i + 13),
];

let failures = 0;
let runs = 0;
const times: Record<string, (number | null)[]> = {};
stages.forEach((stage) => {
  const problems: string[] = [];
  DIFFICULTIES.forEach((difficulty) => {
    for (let k = 0; k < perDifficulty; k += 1) {
      const outcome = race(stage, difficulty, stage * 31 + k);
      runs += 1;
      times[difficulty] = [...(times[difficulty] ?? []), outcome.ok ? outcome.time : null];
      if (!outcome.ok) {
        failures += 1;
        problems.push(`${difficulty}#${k} ${outcome.why}`);
      }
    }
  });
  if (problems.length) {
    console.log(`stage ${stage} FAIL ${problems.join('; ')}\n    ${stageSections(stage).map((s) => s.type).join(',')}`);
  }
});
Object.entries(times).forEach(([difficulty, list]) => {
  const ok = list.filter((t): t is number => t !== null);
  const mean = ok.reduce((a, t) => a + t, 0) / ok.length;
  console.log(`${difficulty.padEnd(7)} finished ${ok.length}/${list.length} mean ${mean.toFixed(1)}s`);
});
console.log(failures ? `${failures} of ${runs} runs failed` : `all ${runs} runs finished`);
process.exitCode = failures ? 1 : 0;
