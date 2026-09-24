// Which sections make up each stage: fixed stages, the tutorial, test courses, and courses
// generated from a seed (Endless mode, online "Random course", the daily course).
import { hashSeed, rng } from '../random';
import type { SectionParams, SectionType } from '../types';
import { SECTIONS, SECTION_TYPES, needsShapeChange } from './sections';

export const STAGES: readonly (readonly SectionType[])[] = [
  ['rolling', 'bumps', 'stairs', 'swell', 'trenches', 'conveyor', 'ramps', 'rolling'],
  ['bumps', 'hurdles', 'pool', 'ice', 'ledge', 'stairs', 'chasm', 'drop', 'incline'],
  ['swell', 'tunnel', 'mud', 'ramps', 'crawl', 'trenches', 'pool', 'conveyor', 'stairs', 'hurdles',
    'drop'],
];

/** The tutorial: one of each basic obstacle, with a tip before each. */
export const TUTORIAL = 900;
const TUTORIAL_SECTIONS: readonly SectionType[] = ['bumps', 'stairs', 'tunnel', 'ledge', 'spikepit', 'pool'];

/** Short fixed courses for automated tests (rooms accept them only when the server allows it). */
export const TEST_STAGES: Readonly<Record<number, readonly SectionType[]>> = {
  990: ['bumps'],
  991: ['spikepit', 'spikeroof', 'wind', 'lowgrav', 'bounce'],
};

/** Stage numbers from here up are single generated courses. */
export const RANDOM_BASE = 1000;
const DAILY_OFFSET = 2000000;

export interface StageSection {
  type: SectionType;
  p: SectionParams;
}

/** Today's date in UTC, like "2026-09-24". */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Everyone gets the same course on a given UTC day. */
export function dailyStage(day: string): number {
  return RANDOM_BASE + DAILY_OFFSET + (hashSeed(`daily${day}`) % 1000000);
}

export function isTestStage(n: number): boolean {
  return TEST_STAGES[n] !== undefined;
}

/** Difficulty (0..1) of a generated stage: Endless ramps up; random courses are mid-to-hard. */
export function stageLevel(n: number): number {
  if (n >= RANDOM_BASE) return 0.4 + 0.5 * rng(hashSeed(`level${n}`))();
  return Math.max(0.15, Math.min(1, (n - STAGES.length) / 10));
}

const withDefaults = (types: readonly SectionType[]): StageSection[] => types
  .map((type) => ({ type, p: SECTIONS[type].def }));

function generatedSections(n: number): StageSection[] {
  const rand = rng(hashSeed(`course${n}`));
  const level = stageLevel(n);
  const count = 7 + Math.round(level * 5 + rand() * 2);
  const out: StageSection[] = [];
  let specials = 0;
  while (out.length < count) {
    const type = SECTION_TYPES[Math.floor(rand() * SECTION_TYPES.length)];
    const prev = out[out.length - 1];
    const special = needsShapeChange(type);
    // No repeats in a row, and at least a third of the course stays rollable.
    const repeat = !!prev && prev.type === type;
    const tooManySpecials = special && specials >= Math.ceil(count * 0.66);
    const allowed = !repeat && !tooManySpecials;
    if (allowed) {
      if (special) specials += 1;
      out.push({ type, p: SECTIONS[type].gen(rand, level) });
    }
  }
  return out;
}

/** The sections of stage n, each with its sizes. */
export function stageSections(n: number): StageSection[] {
  if (n < STAGES.length) return withDefaults(STAGES[n]);
  if (isTestStage(n)) return withDefaults(TEST_STAGES[n]);
  if (n === TUTORIAL) return withDefaults(TUTORIAL_SECTIONS);
  return generatedSections(n);
}
