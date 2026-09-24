import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildCourse from '../../src/shared/course/build';
import {
  RANDOM_BASE, STAGES, TUTORIAL, dailyStage, isTestStage, stageSections,
} from '../../src/shared/course/stages';
import { groundAt, planIndex } from '../../src/shared/course/queries';
import { hashSeed } from '../../src/shared/random';

const fingerprint = (stage: number) => {
  const c = buildCourse(stage);
  return hashSeed(JSON.stringify([c.ground, c.ceilLine, c.finishX]));
};

test('courses are the same every time they are built', () => {
  [0, 1, 2, TUTORIAL, RANDOM_BASE + 5, dailyStage('2026-01-01')].forEach((stage) => {
    assert.equal(fingerprint(stage), fingerprint(stage), `stage ${stage}`);
  });
});

// Daily runs and rooms rely on every browser and the server building identical courses. If a
// change to course generation is intended, update these (and expect old daily runs to differ).
test('course generation has not changed', () => {
  assert.equal(fingerprint(0), 378354592);
  assert.equal(fingerprint(1), 2828702279);
  assert.equal(fingerprint(2), 1637008297);
  assert.equal(fingerprint(TUTORIAL), 2264336442);
  assert.equal(fingerprint(RANDOM_BASE + 5), 1212725101);
});

test('the daily course is picked from the date', () => {
  assert.equal(dailyStage('2026-01-01'), dailyStage('2026-01-01'));
  assert.notEqual(dailyStage('2026-01-01'), dailyStage('2026-01-02'));
  assert.ok(dailyStage('2026-01-01') >= RANDOM_BASE);
});

test('every course has a start, a finish, ground and a plan', () => {
  [...STAGES.keys(), TUTORIAL, RANDOM_BASE + 1, RANDOM_BASE + 99].forEach((stage) => {
    const c = buildCourse(stage);
    assert.ok(c.finishX > c.startX + 1000, `stage ${stage} is long enough`);
    assert.ok(Number.isFinite(groundAt(c, c.startX)));
    assert.ok(Number.isFinite(groundAt(c, c.finishX)));
    assert.ok(c.sections.length >= 3);
    assert.equal(c.plan[planIndex(c, c.startX)].pose, 'wheel');
    assert.equal(stageSections(stage).length, c.sections.length);
  });
});

test('test stages are only the reserved numbers', () => {
  assert.equal(isTestStage(990), true);
  assert.equal(isTestStage(0), false);
  assert.equal(isTestStage(RANDOM_BASE), false);
});
