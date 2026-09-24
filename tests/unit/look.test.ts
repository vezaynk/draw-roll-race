import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOOK, LOOK_NAMES, LOOK_OPTIONS, sanitizeLook,
} from '../../src/shared/look';

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
