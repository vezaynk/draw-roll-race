import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../../src/shared/config';
import buildCourse from '../../src/shared/course/build';
import personality, { DIFFICULTIES, isDifficulty } from '../../src/shared/cpu/personality';
import CpuRacer from '../../src/shared/cpu/racer';
import { CODE_ALPHABET, CODE_RE } from '../../src/shared/protocol';

test('a CPU personality comes from its seed', () => {
  const a = personality(99, 'hard');
  const b = personality(99, 'hard');
  assert.equal(a.name, b.name);
  assert.equal(a.speed, b.speed);
  assert.deepEqual(a.shapes, b.shapes);
  assert.ok(a.speed >= 0.74 && a.speed < 0.84);
  assert.ok(personality(99, 'easy').speed < 0.6);
});

test('difficulties', () => {
  assert.deepEqual(DIFFICULTIES, ['easy', 'normal', 'hard']);
  assert.equal(isDifficulty('hard'), true);
  assert.equal(isDifficulty('insane'), false);
  assert.equal(isDifficulty(3), false);
});

test('the same CPU on the same course finishes at the same time', () => {
  const course = buildCourse(1);
  const time = () => {
    const cpu = new CpuRacer(course, { seed: 5, difficulty: 'normal', color: '#000' });
    for (let t = 0; t < 240 && cpu.finishTime === null; t += CFG.DT) cpu.step(CFG.DT, t);
    return cpu.finishTime;
  };
  const first = time();
  assert.ok(first !== null);
  assert.equal(time(), first);
});

test('room codes use only the unambiguous alphabet', () => {
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  [...CODE_ALPHABET].forEach((c) => assert.ok(CODE_RE.test(c.repeat(5)), c));
  assert.equal(CODE_RE.test('K7Q2M'), true);
  assert.equal(CODE_RE.test('K7Q2'), false);
  assert.equal(CODE_RE.test('K0Q2M'), false);
});
