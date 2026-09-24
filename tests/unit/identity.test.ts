import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HASH_RE, PLAYER_RE, playerHash } from '../../src/shared/identity';

test('player hashes are the first 128 bits of SHA-256, in hex', async () => {
  // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  assert.equal(await playerHash('abc'), 'ba7816bf8f01cfea414140de5dae2223');
  const hash = await playerHash('0b8e7c9a-2f4d-4c1e-9a3b-5d6e7f8a9b0c');
  assert.match(hash, HASH_RE);
  assert.equal(await playerHash('0b8e7c9a-2f4d-4c1e-9a3b-5d6e7f8a9b0c'), hash);
});

test('player IDs: UUIDs and the older random IDs', () => {
  assert.ok(PLAYER_RE.test('0b8e7c9a-2f4d-4c1e-9a3b-5d6e7f8a9b0c'));
  assert.ok(PLAYER_RE.test('Qm9vZ2xlIHdhbnRzIHRoaXM'));
  assert.ok(!PLAYER_RE.test('short'));
  assert.ok(!PLAYER_RE.test('has spaces in it, not an id'));
});
