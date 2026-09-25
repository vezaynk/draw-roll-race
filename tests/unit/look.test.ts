import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOOK, LOOK_NAMES, LOOK_OPTIONS, lookFromHash, sanitizeLook,
} from '../../src/shared/look';
import { ADJECTIVES, NOUNS, nameFromHash } from '../../src/shared/names';

const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('').padEnd(32, '0');

test('every look choice has a name for the pickers', () => {
  Object.values(LOOK_OPTIONS).flat().forEach((choice) => assert.ok(LOOK_NAMES[choice], choice));
});

test('looks from other players are checked part by part', () => {
  assert.deepEqual(sanitizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(sanitizeLook({
    hair: 'afro', hat: 'crown', eyes: 'star', glasses: 'monocle',
  }), {
    hair: 'afro', hat: 'crown', eyes: 'star', glasses: 'monocle',
  });
  assert.deepEqual(sanitizeLook({ hair: 'afro', hat: '<script>', eyes: 7 }), {
    ...DEFAULT_LOOK, hair: 'afro',
  });
});

test('default names: 64 different adjectives and 64 different nouns', () => {
  assert.equal(new Set(ADJECTIVES).size, 64);
  assert.equal(new Set(NOUNS).size, 64);
  // Every name fits the 24-character limit on names.
  assert.ok([...ADJECTIVES].every((a) => [...NOUNS].every((n) => `${a} ${n}`.length <= 24)));
});

test('a hash always gives the same default name, and every pair can come up', () => {
  assert.equal(nameFromHash(hex([0, 0])), 'Agile Runner');
  assert.equal(nameFromHash(hex([63, 63])), `${ADJECTIVES[63]} ${NOUNS[63]}`);
  assert.equal(nameFromHash(hex([64 + 5, 128 + 7])), `${ADJECTIVES[5]} ${NOUNS[7]}`);
  const hash = 'c0ffee00112233445566778899aabbcc';
  assert.equal(nameFromHash(hash), nameFromHash(hash));
});

test('a hash always gives the same default look, and every choice can come up', () => {
  const hash = 'c0ffee00112233445566778899aabbcc';
  assert.deepEqual(lookFromHash(hash), lookFromHash(hash));
  assert.deepEqual(sanitizeLook(lookFromHash(hash)), lookFromHash(hash));
  const seen = { hair: new Set(), hat: new Set(), eyes: new Set(), glasses: new Set() };
  for (let b = 0; b < 256; b += 1) {
    const look = lookFromHash(hex([0, 0, b, b, b, b]));
    (Object.keys(seen) as (keyof typeof seen)[]).forEach((part) => seen[part].add(look[part]));
  }
  (Object.keys(seen) as (keyof typeof seen)[]).forEach((part) => {
    assert.equal(seen[part].size, LOOK_OPTIONS[part].length, part);
  });
});
