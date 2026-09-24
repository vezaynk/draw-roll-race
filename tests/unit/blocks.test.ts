import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG, FIG } from '../../src/shared/config';
import buildCourse from '../../src/shared/course/build';
import { normalizeStroke, packLimbs } from '../../src/shared/limbs';
import step from '../../src/shared/physics';
import { POSES } from '../../src/shared/poses';
import { RunReplay } from '../../src/shared/replay';
import { createRunner } from '../../src/shared/runner';

const course = buildCourse(992);
const [block] = course.blocks;

test('a runner resting on a block stays on top of it', () => {
  const runner = createRunner({ arm: [], leg: [] }, '');
  runner.x = (block.x0 + block.x1) / 2;
  const lowest = Math.max(...runner.torso.map((p) => p.y));
  runner.y = block.y0 - CFG.R - lowest - 1;
  for (let i = 0; i < 240; i += 1) step(course, runner, CFG.DT);
  const bottom = runner.y + Math.max(...runner.torso.map((p) => p.y));
  assert.ok(bottom < block.y0 + 2, `resting on the block (bottom ${bottom}, top ${block.y0})`);
  assert.ok(Math.abs(runner.vy) < 5);
});

test('something falling from below the block is stopped by its underside', () => {
  const runner = createRunner({ arm: [], leg: [] }, '');
  runner.x = (block.x0 + block.x1) / 2;
  const highest = Math.min(...runner.torso.map((p) => p.y));
  runner.y = block.y1 + CFG.R - highest + 1;
  runner.vy = -600;
  step(course, runner, CFG.DT);
  step(course, runner, CFG.DT);
  assert.ok(runner.y + highest >= block.y1, 'did not pass through');
  assert.ok(runner.vy >= -60, 'upward speed absorbed');
});

const S = FIG.shoulder;
const run = (arm: { x: number; y: number }[][]) => {
  const limbs = { arm: arm.map(normalizeStroke), leg: POSES.wheel.leg.map(normalizeStroke) };
  const replay = new RunReplay(course, [[0, packLimbs(limbs)]], Math.ceil(30 / CFG.DT));
  replay.advance();
  return replay.finished;
};

test('a long arm crosses the pit by the blocks; without an arm you fall in', () => {
  assert.equal(run([[S, { x: S.x + 100, y: S.y }]]), true);
  assert.equal(run([]), false);
});
