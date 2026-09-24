// Checks that a claimed finish is possible, from the live positions a player sends in a room.
// (Daily runs are checked by replaying them: see shared/replay.ts.)
import type { Course } from './types';

/** World units per second that no runner can average. */
export const MAX_SPEED = 1200;

/** How close to the line the last reported position must be for a finish to count. */
const FINISH_SLACK = 200;

/** The fastest possible time for a course. */
export function minimumTime(course: Course): number {
  return (course.finishX - course.startX) / MAX_SPEED;
}

/** Could a runner have moved from x0 at t0 to x1 at t1 (seconds)? */
export function possibleMove(
  x0: number,
  t0: number,
  x1: number,
  t1: number,
  slack: number,
): boolean {
  return x1 - x0 <= MAX_SPEED * (t1 - t0) + slack;
}

/** A live finish: the last position a player reported reached the line, at a possible time. */
export function finishIsPossible(
  course: Course,
  elapsed: number,
  claimed: number,
  lastX: number | undefined,
): boolean {
  const min = minimumTime(course);
  if (elapsed < min) return false;
  if (Number.isFinite(claimed) && claimed < min) return false;
  return lastX !== undefined && lastX >= course.finishX - FINISH_SLACK;
}
