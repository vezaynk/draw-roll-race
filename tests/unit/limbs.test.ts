import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeLimbs, encodeLimbs, hasLimbs, normalizeStroke, packLimbs, sanitizeLimbs,
} from '../../src/shared/limbs';
import { POSES } from '../../src/shared/poses';

test('encoding keeps the shape of a stroke', () => {
  const limbs = decodeLimbs(encodeLimbs(POSES.wheel));
  assert.equal(limbs.arm.length, 1);
  assert.equal(limbs.leg.length, 1);
  const first = limbs.leg[0][0];
  assert.deepEqual(first, { x: Math.round(POSES.wheel.leg[0][0].x), y: Math.round(POSES.wheel.leg[0][0].y) });
});

test('normalized strokes are whole numbers in range, and pack without loss', () => {
  const wild = [{ x: 160.4, y: 120.6 }, { x: 900, y: 120 }, { x: 900, y: -900 }];
  const stroke = normalizeStroke(wild);
  assert.ok(stroke.every((p) => Number.isInteger(p.x) && Number.isInteger(p.y)));
  assert.ok(stroke.every((p) => p.x > -200 && p.x < 600 && p.y > -200 && p.y < 600));
  const limbs = { arm: [], leg: [stroke] };
  assert.deepEqual(decodeLimbs(packLimbs(limbs)), limbs);
  assert.ok(sanitizeLimbs(packLimbs(limbs)), 'the server accepts it');
});

test('sanitizeLimbs refuses what the pad cannot draw', () => {
  const ok = { arm: [], leg: [[160, 120, 170, 130]] };
  assert.deepEqual(sanitizeLimbs(ok), ok);
  assert.equal(sanitizeLimbs(null), null);
  assert.equal(sanitizeLimbs({ arm: [], leg: [[1, 2, 3]] }), null, 'odd number of values');
  assert.equal(sanitizeLimbs({ arm: [], leg: [[1, 2]] }), null, 'a single point');
  assert.equal(sanitizeLimbs({ arm: [], leg: [[1, 2, 3, 4], [1, 2, 3, 4]] }), null, 'two strokes');
  assert.equal(sanitizeLimbs({ arm: [], leg: [[1, 2, 3, 9999]] }), null, 'off the pad');
  assert.equal(sanitizeLimbs({ arm: [], leg: [[1, 2, 3, Number.NaN]] }), null);
  assert.equal(sanitizeLimbs({ arm: [], leg: [Array(242).fill(1)] }), null, 'too many points');
});

test('hasLimbs', () => {
  assert.equal(hasLimbs(null), false);
  assert.equal(hasLimbs({ arm: [], leg: [] }), false);
  assert.equal(hasLimbs(POSES.stilts), true);
});
