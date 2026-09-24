import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashSeed, pick, randInt, rng,
} from '../../src/shared/random';

test('the same seed gives the same numbers', () => {
  const a = rng(42);
  const b = rng(42);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, rng(43)));
});

test('a zero seed still produces numbers', () => {
  const r = rng(0);
  assert.notEqual(r(), r());
});

test('hashSeed is FNV-1a and stable', () => {
  assert.equal(hashSeed(''), 2166136261);
  assert.equal(hashSeed('a'), 0xe40c292c);
  assert.equal(hashSeed(12), hashSeed('12'));
});

test('randInt and pick stay in range', () => {
  const r = rng(7);
  for (let i = 0; i < 500; i += 1) {
    const n = randInt(r, 3, 9);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 9);
    const x = pick(r, [0.5, 0.75]);
    assert.ok(x >= 0.5 && x < 0.75);
  }
});
