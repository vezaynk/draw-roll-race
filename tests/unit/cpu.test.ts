import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../../src/shared/config';
import buildCourse from '../../src/shared/course/build';
import { TUTORIAL } from '../../src/shared/course/stages';
import personality from '../../src/shared/cpu/personality';
import CpuRacer from '../../src/shared/cpu/racer';

// The only CPU left is the one that races with you in the tutorial.

test('the tutorial CPU’s personality comes from its seed', () => {
  const a = personality(99);
  const b = personality(99);
  assert.equal(a.name, b.name);
  assert.equal(a.speed, b.speed);
  assert.deepEqual(a.shapes, b.shapes);
  assert.ok(a.speed >= 0.5 && a.speed < 0.58, 'slow enough for a new player to beat');
});

test('the same tutorial CPU finishes at the same time, and it can finish', () => {
  const course = buildCourse(TUTORIAL);
  const time = () => {
    const cpu = new CpuRacer(course, { seed: 5, color: '#000' });
    for (let t = 0; t < 240 && cpu.finishTime === null; t += CFG.DT) cpu.step(CFG.DT, t);
    return cpu.finishTime;
  };
  const first = time();
  assert.ok(first !== null);
  assert.equal(time(), first);
});
