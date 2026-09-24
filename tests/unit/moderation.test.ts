import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedName, moderateName } from '../../src/worker/moderation';

test('ordinary names pass', () => {
  ['Ana', 'Speedy Gonzales', 'Runner 7', 'Dash'].forEach((name) => {
    assert.equal(isAllowedName(name), true, name);
  });
});

test('the filter is simple: a blocked word inside a longer name blocks it too', () => {
  assert.equal(isAllowedName('Scunthorpe fan'), false);
});

test('profanity is caught through spacing, l33t and repeated letters', () => {
  ['fuck', 'f u c k', 'f.u.c.k', 'fuuuuck', 'sh1t', '$hit', 'b1tch'].forEach((name) => {
    assert.equal(isAllowedName(name), false, name);
  });
});

test('moderateName falls back to the given name', () => {
  assert.equal(moderateName('Ana', 'Runner'), 'Ana');
  assert.equal(moderateName('shit', 'Runner'), 'Runner');
  assert.equal(moderateName('', null), null);
});
