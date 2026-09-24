import { CFG } from '../config';
import type {
  Course, Fluid, Surface, Zone,
} from '../types';

/** Index of the terrain sample at x (clamped to the course). */
export function sampleIndex(course: Course, x: number): number {
  return Math.max(0, Math.min(course.ground.length - 1, Math.floor(x / CFG.STEP)));
}

export const groundAt = (c: Course, x: number): number => c.ground[sampleIndex(c, x)];
export const ceilAt = (c: Course, x: number): number => c.ceil[sampleIndex(c, x)];
export const fluidAt = (c: Course, x: number): Fluid | null => c.fluid[sampleIndex(c, x)];
export const surfAt = (c: Course, x: number): Surface | null => c.surf[sampleIndex(c, x)];
export const zoneAt = (c: Course, x: number): Zone | null => c.zone[sampleIndex(c, x)];

/** Is there a ceiling within ten samples of x? */
export function ceilingNearby(course: Course, x: number): boolean {
  const i0 = sampleIndex(course, x);
  const lo = Math.max(0, i0 - 10);
  const hi = Math.min(course.ceil.length - 1, i0 + 10);
  for (let i = lo; i <= hi; i += 1) {
    if (course.ceil[i] !== -Infinity) return true;
  }
  return false;
}

/** Index of the plan step (which shape to use) in force at x. */
export function planIndex(course: Course, x: number): number {
  let k = 0;
  course.plan.forEach((step, i) => {
    if (x >= step.x) k = i;
  });
  return k;
}

/** The [from, to) range of samples from `start` where test(i) holds. */
export function sampleRun(
  course: Course,
  fromX: number,
  test: (i: number) => boolean,
): [number, number] {
  let i = Math.floor(fromX / CFG.STEP);
  while (i < course.ground.length && !test(i)) i += 1;
  const a = i;
  while (i < course.ground.length && test(i)) i += 1;
  return [a * CFG.STEP, i * CFG.STEP];
}
