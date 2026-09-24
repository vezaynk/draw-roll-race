import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODE_ALPHABET, CODE_RE } from '../../src/shared/protocol';

test('room codes use only the unambiguous alphabet', () => {
  assert.ok(!/[01OIL]/.test(CODE_ALPHABET));
  [...CODE_ALPHABET].forEach((c) => assert.ok(CODE_RE.test(c.repeat(5)), c));
  assert.equal(CODE_RE.test('K7Q2M'), true);
  assert.equal(CODE_RE.test('K7Q2'), false);
  assert.equal(CODE_RE.test('K0Q2M'), false);
});
