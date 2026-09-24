import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildCourse from '../../src/shared/course/build';
import {
  MAX_SPEED, finishIsPossible, minimumTime, possibleMove,
} from '../../src/shared/validation';

const course = buildCourse(0);

test('minimum time is the course length at the top speed', () => {
  assert.equal(minimumTime(course), (course.finishX - course.startX) / MAX_SPEED);
});

test('possibleMove allows up to the top speed plus slack', () => {
  assert.equal(possibleMove(0, 0, MAX_SPEED, 1, 0), true);
  assert.equal(possibleMove(0, 0, MAX_SPEED + 1, 1, 0), false);
  assert.equal(possibleMove(0, 0, MAX_SPEED + 50, 1, 60), true);
  assert.equal(possibleMove(100, 0, 0, 1, 0), true, 'moving back is always possible');
});

test('a live finish needs a possible time and a last position near the line', () => {
  const min = minimumTime(course);
  assert.equal(finishIsPossible(course, min + 5, min + 5, course.finishX), true);
  assert.equal(finishIsPossible(course, min / 2, min / 2, course.finishX), false, 'too soon');
  assert.equal(finishIsPossible(course, min + 5, min / 2, course.finishX), false, 'claims too fast');
  assert.equal(finishIsPossible(course, min + 5, min + 5, course.startX), false, 'never got there');
  assert.equal(finishIsPossible(course, min + 5, min + 5, undefined), false, 'sent no positions');
});
