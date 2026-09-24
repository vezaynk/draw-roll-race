import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cos, hypot, sin } from '../../src/shared/fmath';

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

test('sin and cos match Math to within a few units in the last place', () => {
  for (let x = -50; x <= 50; x += 0.0137) {
    assert.ok(close(sin(x), Math.sin(x), 1e-15 * Math.max(1, Math.abs(x))), `sin(${x})`);
    assert.ok(close(cos(x), Math.cos(x), 1e-15 * Math.max(1, Math.abs(x))), `cos(${x})`);
  }
});

test('sin and cos stay accurate for the large angles a long race produces', () => {
  [720.5, 3000.25, 7200.125, -4321.9].forEach((x) => {
    assert.ok(close(sin(x), Math.sin(x), 1e-12), `sin(${x})`);
    assert.ok(close(cos(x), Math.cos(x), 1e-12), `cos(${x})`);
  });
});

test('exact values at the quadrant boundaries', () => {
  assert.equal(sin(0), 0);
  assert.equal(cos(0), 1);
  assert.ok(close(sin(Math.PI / 2), 1, 1e-16));
  assert.ok(close(cos(Math.PI), -1, 1e-16));
  assert.ok(close(sin(-Math.PI / 2), -1, 1e-16));
});

test('hypot', () => {
  assert.equal(hypot(3, 4), 5);
  assert.equal(hypot(0, 0), 0);
  assert.equal(hypot(-6, 8), 10);
});
