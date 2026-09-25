// A limb wedged between opposite surfaces (a tunnel roof and the floor, or under a floating
// block) with no room to turn shatters, instead of grinding into the rock and popping through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, FIG } from '../../src/shared/config';
import buildCourse from '../../src/shared/course/build';
import { ceilAt } from '../../src/shared/course/queries';
import { normalizeStroke } from '../../src/shared/limbs';
import { POSES, bar, halfRing } from '../../src/shared/poses';
import { stepPlayer } from '../../src/shared/replay';
import {
  createRunner, forEachPoint, settle, swapLimbs,
} from '../../src/shared/runner';
import type { Course, Limbs, Runner } from '../../src/shared/types';

const shape = (l: Limbs): Limbs => ({ arm: l.arm.map(normalizeStroke), leg: l.leg.map(normalizeStroke) });
const BIG_WHEEL = shape({ arm: [halfRing(FIG.shoulder, 45)], leg: [halfRing(FIG.hip, 60)] });

/** A mini wheel standing at x, then redrawn as `limbs` there (as a player would). */
function drawnAt(course: Course, x: number, limbs: Limbs): Runner {
  const runner = createRunner(shape(POSES.mini), '');
  settle(course, runner, x);
  return swapLimbs(course, runner, limbs);
}

/** Steps until a limb breaks (or `seconds` pass); answers when, and which limbs. */
function untilBroken(course: Course, start: Runner, limbs: Limbs, seconds: number) {
  const runner = start;
  for (let i = 1; i <= seconds / CFG.DT; i += 1) {
    const broken = stepPlayer(course, runner, limbs);
    if (broken) return { after: i * CFG.DT, lost: broken.lost, crushed: broken.crushed };
  }
  return null;
}

test('a wheel too big for the tunnel it is drawn in shatters at once', () => {
  const course = buildCourse(2);
  const tunnel = course.sections.find((s) => s.type === 'tunnel')!;
  const runner = drawnAt(course, (tunnel.from + tunnel.to) / 2, BIG_WHEEL);
  const broke = untilBroken(course, runner, BIG_WHEEL, 1);
  assert.ok(broke, 'a limb broke');
  assert.ok(broke.after <= CFG.CRUSH_TIME + 0.05, `after ${broke.after} s`);
  // The arm is against the roof (the leg stands on the floor): the arm goes.
  assert.ok(broke.lost.includes('arm'));
  assert.equal(broke.crushed, true, 'crushed, not spikes');
});

test('before this, it would sit inside the roof; now no limb stays in the rock', () => {
  const course = buildCourse(2);
  const tunnel = course.sections.find((s) => s.type === 'tunnel')!;
  let limbs = BIG_WHEEL;
  let runner = drawnAt(course, (tunnel.from + tunnel.to) / 2, limbs);
  let inRock = 0;
  for (let i = 0; i < 2 / CFG.DT; i += 1) {
    const broken = stepPlayer(course, runner, limbs);
    if (broken) ({ runner, limbs } = broken);
    forEachPoint(runner, (px, py, joint) => {
      const roof = ceilAt(course, px);
      if (joint && roof !== -Infinity && py < roof - 2 * CFG.R) inRock += 1;
    });
  }
  // Only the few steps before the break (it used to be thousands).
  assert.ok(inRock < 1000, `${inRock} limb points inside the roof`);
});

test('a bar wedged under a floating block shatters instead of passing through it', () => {
  const course = buildCourse(992);
  const block = course.blocks[0];
  const limbs = shape({ arm: [], leg: [bar(FIG.hip, 120)] });
  let runner = drawnAt(course, (block.x0 + block.x1) / 2, limbs);
  let current = limbs;
  let broke = false;
  let inside = 0;
  for (let i = 0; i < 5 / CFG.DT; i += 1) {
    const broken = stepPlayer(course, runner, current);
    if (broken) {
      broke = true;
      ({ runner, limbs: current } = broken);
    }
    forEachPoint(runner, (px, py, joint) => {
      const deep = course.blocks.some((b) => px > b.x0 + CFG.R && px < b.x1 - CFG.R
        && py > b.y0 + CFG.R && py < b.y1 - CFG.R);
      if (joint && deep) inside += 1;
    });
  }
  assert.ok(broke, 'the bar broke');
  assert.equal(inside, 0, 'no limb point went through a block');
});

test('limbs that still turn are never crushed: the usual shapes finish every fixed stage', () => {
  // A wheel rolling under a low roof, or scraping a wall, keeps turning: nothing breaks.
  const course = buildCourse(0);
  const limbs = shape(POSES.wheel);
  const runner = drawnAt(course, course.startX, limbs);
  const broke = untilBroken(course, runner, limbs, 20);
  assert.equal(broke, null);
});
