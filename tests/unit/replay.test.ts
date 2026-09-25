import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../../src/shared/config';
import buildCourse from '../../src/shared/course/build';
import { STAGES, TUTORIAL, dailyStage } from '../../src/shared/course/stages';
import { RunReplay, cleanInputs } from '../../src/shared/replay';
import botRun from '../support/bot';

const MAX = Math.ceil(240 / CFG.DT);

test('a recorded run replays to exactly the same time', () => {
  [0, 1, 2, TUTORIAL, 991, dailyStage('2026-03-14')].forEach((stage) => {
    const course = buildCourse(stage);
    const run = botRun(course);
    assert.ok(run.finished, `the test player finishes stage ${stage}`);
    // Through JSON, as the server receives it.
    const inputs = cleanInputs(JSON.parse(JSON.stringify(run.inputs)));
    assert.ok(inputs);
    const replay = new RunReplay(course, inputs, MAX);
    replay.advance();
    assert.equal(replay.finished, true);
    assert.equal(replay.time, run.time, `stage ${stage}`);
  });
});

test('replaying in slices gives the same result as all at once', () => {
  const course = buildCourse(1);
  const run = botRun(course);
  const whole = new RunReplay(course, run.inputs, MAX);
  whole.advance();
  const sliced = new RunReplay(course, run.inputs, MAX);
  let calls = 0;
  while (!sliced.advance(500)) calls += 1;
  assert.ok(calls > 5);
  assert.equal(sliced.time, whole.time);
  assert.equal(sliced.steps, whole.steps);
});

test('the replay times every section of the course, the same in slices', () => {
  const course = buildCourse(991);
  const run = botRun(course);
  const whole = new RunReplay(course, run.inputs, MAX);
  whole.advance();
  assert.deepEqual(whole.splits.map((s) => s.type), course.sections.map((s) => s.type));
  whole.splits.forEach((s, i) => {
    assert.ok(s.seconds > 0 && s.seconds < whole.time, `${s.type}: ${s.seconds}`);
    assert.equal(s.width, course.sections[i].to - course.sections[i].from);
  });
  assert.ok(whole.splits.reduce((sum, s) => sum + s.seconds, 0) < whole.time);
  const sliced = new RunReplay(course, run.inputs, MAX);
  while (!sliced.advance(100));
  assert.deepEqual(sliced.splits, whole.splits);
});

// The physics is part of every saved daily run: if it changes, runs recorded before the change
// replay differently. Update these only for an intended physics change.
test('the physics has not changed', () => {
  assert.equal(botRun(buildCourse(0)).time, 26.045833333332176);
  // Stage 2 and the tutorial changed when wedged limbs began to shatter: the test player draws
  // stilts in stage 2's tunnel, and the tutorial's long arm before its tunnel roof ends.
  assert.equal(botRun(buildCourse(2)).time, 39.80416666667138);
  assert.equal(botRun(buildCourse(TUTORIAL)).time, 22.80833333333236);
});

test('a run without working limbs does not finish', () => {
  const course = buildCourse(0);
  const replay = new RunReplay(course, [[0, { arm: [], leg: [[160, 120, 162, 121]] }]], Math.ceil(30 / CFG.DT));
  replay.advance();
  assert.equal(replay.finished, false);
  assert.equal(replay.steps, Math.ceil(30 / CFG.DT));
});

test('cleanInputs refuses malformed recordings', () => {
  const limbs = { arm: [], leg: [[160, 120, 170, 130]] };
  assert.ok(cleanInputs([[0, limbs], [10, limbs], [10, limbs]]));
  assert.equal(cleanInputs([]), null, 'empty');
  assert.equal(cleanInputs([[5, limbs]]), null, 'must start at step 0');
  assert.equal(cleanInputs([[0, limbs], [10, limbs], [9, limbs]]), null, 'out of order');
  assert.equal(cleanInputs([[0, limbs], [1.5, limbs]]), null, 'not a step number');
  assert.equal(cleanInputs([[0, { arm: [], leg: [[1, 2, 3]] }]]), null, 'bad limbs');
  assert.equal(cleanInputs('nope'), null);
  assert.equal(cleanInputs(Array.from({ length: 401 }, () => [0, limbs])), null, 'too many');
});

test('every fixed stage can be finished by a player', () => {
  STAGES.forEach((_, stage) => assert.ok(botRun(buildCourse(stage)).finished, `stage ${stage}`));
});
