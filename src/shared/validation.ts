// Checks that a claimed run is possible. Used by rooms (live positions) and by the daily
// leaderboard (a recording of the run).
import type { Course } from './types';

/** World units per second that no runner can average. */
export const MAX_SPEED = 1200;

/** How close to the line the last reported position must be for a finish to count. */
const FINISH_SLACK = 200;
const TRACE_FINISH_SLACK = 120;
/** The game records ten samples a second; a longer gap could hide a jump. */
const MAX_TRACE_GAP = 1;

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

/** One sample of a recorded run: [seconds since the start, x position]. */
export type TraceSample = [number, number];

/**
 * Checks a recorded run. Returns what is wrong with it, or null if it looks real: it starts at the
 * start line, has no gaps, never moves faster than a runner can, reaches the finish, and ends at
 * the claimed time.
 */
export function traceProblem(course: Course, time: number, trace: unknown): string | null {
  if (!Number.isFinite(time) || time <= 0 || time > 600) return 'That time is not possible.';
  if (!Array.isArray(trace) || trace.length < 3 || trace.length > 4000) return 'The run is missing its recording.';
  if (time < minimumTime(course)) return 'That time is faster than the course allows.';
  const samples = trace as TraceSample[];
  const [t0, x0] = samples[0] ?? [];
  if (!Number.isFinite(t0) || !Number.isFinite(x0) || t0 > 1 || Math.abs(x0 - course.startX) > 60) {
    return 'The recording does not start at the start line.';
  }
  let problem: string | null = null;
  samples.slice(1).some(([t, x], i) => {
    const [pt, px] = samples[i];
    if (!Number.isFinite(t) || !Number.isFinite(x) || t < pt) problem = 'The recording is out of order.';
    else if (t - pt > MAX_TRACE_GAP) problem = 'The recording has gaps.';
    else if (!possibleMove(px, pt, x, t, 60)) problem = 'The recording moves faster than any runner can.';
    return problem !== null;
  });
  if (problem) return problem;
  const [lastT, lastX] = samples[samples.length - 1];
  if (lastX < course.finishX - TRACE_FINISH_SLACK) return 'The recording does not reach the finish.';
  if (Math.abs(lastT - time) > 0.6) return 'The recording does not match the time.';
  return null;
}
