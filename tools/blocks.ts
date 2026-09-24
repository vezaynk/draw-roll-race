// Prototype check for hanging blocks (test course 992): which arm shapes get a runner across a
// spike pit by catching the blocks above it, compared with the same pit without blocks.
// Usage: npx tsx tools/blocks.ts
import { CFG, FIG } from '../src/shared/config';
import buildCourse from '../src/shared/course/build';
import { normalizeStroke } from '../src/shared/limbs';
import { POSES } from '../src/shared/poses';
import { runnerAtStart, stepPlayer } from '../src/shared/replay';
import { swapLimbs } from '../src/shared/runner';
import type { Course, Limbs, Stroke } from '../src/shared/types';

const STAGE = 992;
const S = FIG.shoulder;

const bar = (len: number): Stroke => [S, { x: S.x + len, y: S.y }];

/** Straight out from the shoulder for `len`, then a half turn of radius curl × len. */
function hook(len: number, curl: number, down: boolean): Stroke {
  const pts: Stroke = [{ ...S }];
  for (let i = 1; i <= 8; i += 1) pts.push({ x: S.x + (len * i) / 8, y: S.y });
  const r = curl * len;
  const side = down ? 1 : -1;
  for (let i = 1; i <= 8; i += 1) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    pts.push({ x: S.x + len + Math.cos(a) * r, y: S.y + side * (r + Math.sin(a) * r) });
  }
  return pts;
}

/** Rolls up on a wheel, draws `arm` just before the pit, and reports whether it got across. */
function cross(course: Course, arm: Stroke): string {
  const sec = course.sections[0];
  let limbs: Limbs = { arm: [normalizeStroke(arm)], leg: POSES.wheel.leg.map(normalizeStroke) };
  let runner = runnerAtStart(course, POSES.wheel);
  let drawn = false;
  for (let t = 0; t < 30; t += CFG.DT) {
    if (!drawn && runner.x > sec.from - 40) {
      runner = swapLimbs(course, runner, limbs);
      drawn = true;
    }
    const broken = stepPlayer(course, runner, limbs);
    if (broken) ({ runner, limbs } = broken);
    if (runner.x > sec.to + 30) return `across in ${t.toFixed(1)} s`;
  }
  return 'stuck';
}

const withBlocks = buildCourse(STAGE);
const noBlocks = { ...withBlocks, blocks: [] };
const shapes: [string, Stroke][] = [
  ['bar 60', bar(60)], ['bar 80', bar(80)], ['bar 100', bar(100)],
  ...[60, 80, 100].flatMap((len) => [0.15, 0.25, 0.35].flatMap((curl): [string, Stroke][] => [
    [`hook ${len}/${curl} down`, hook(len, curl, true)],
    [`hook ${len}/${curl} up`, hook(len, curl, false)],
  ])),
];
console.log('arm shape'.padEnd(22), 'with blocks'.padEnd(18), 'without blocks');
shapes.forEach(([name, arm]) => {
  console.log(name.padEnd(22), cross(withBlocks, arm).padEnd(18), cross(noBlocks, arm));
});

