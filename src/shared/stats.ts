// Personal performance. Only each player's best run on each course counts: your bests on the
// last RECENT_RUNS courses you finished each get the share of everyone's bests they beat, and
// your percentile is their average. All courses count together: a long course's times are
// slower than a short one's, so it's rough, but it stays meaningful while each course has only
// a few players.
import type { SectionType } from './types';

/** How many of your latest courses count. */
export const RECENT_RUNS = 100;
/** Courses (or section passes) needed before there's a percentile to show. */
export const MIN_RUNS = 20;
/** Run times are counted in buckets this many seconds wide (the server keeps a count per bucket). */
export const BUCKET_SECONDS = 0.1;

export const bucketOf = (time: number): number => Math.floor(time / BUCKET_SECONDS + 1e-9);

/** How many runs finished in each time bucket: [bucket, count]. */
export type TimeCounts = readonly (readonly [number, number])[];

/**
 * The average share (0-100) of all counted values that each of yours beats: those in worse
 * buckets, plus half of those in its own. `higherWins`: bigger buckets are better (speeds).
 */
function beatenShare(mine: readonly number[], counts: TimeCounts, higherWins: boolean): number | null {
  // Order the buckets from best to worst.
  const sorted = [...counts].sort((a, b) => (higherWins ? b[0] - a[0] : a[0] - b[0]));
  const total = sorted.reduce((sum, [, n]) => sum + n, 0);
  if (!total || !mine.length) return null;
  // worseThan[i]: counted values in buckets after sorted[i].
  const worseThan: number[] = new Array(sorted.length);
  let worse = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    worseThan[i] = worse;
    worse += sorted[i][1];
  }
  const index = new Map(sorted.map(([bucket], i) => [bucket, i]));
  const isWorse = (bucket: number, than: number) => (higherWins ? bucket < than : bucket > than);
  const shares = mine.map((b) => {
    const i = index.get(b);
    if (i !== undefined) return (worseThan[i] + sorted[i][1] / 2) / total;
    // Not counted yet (shouldn't happen): beats every value in a worse bucket.
    return sorted.filter(([bucket]) => isWorse(bucket, b)).reduce((sum, [, n]) => sum + n, 0) / total;
  });
  return (100 * shares.reduce((sum, v) => sum + v, 0)) / shares.length;
}

/**
 * Your percentile (0-100): on average, the share of everyone's bests that your recent bests beat.
 * A time beats those in slower buckets and half of those in its own. Null below MIN_RUNS.
 */
export function percentile(recent: readonly number[], counts: TimeCounts): number | null {
  if (recent.length < MIN_RUNS) return null;
  return beatenShare(recent.map(bucketOf), counts, false);
}

// ---------------- by section type ----------------
//
// Sections of one type come in different sizes (generated courses vary them), so they compare by
// speed through the section (length / time) rather than by time.

/** Speeds through sections are counted in buckets this many world units per second wide. */
export const SPEED_BUCKET = 5;

export const speedBucket = (speed: number): number => Math.floor(speed / SPEED_BUCKET + 1e-9);

/** Speed through a section (world units per second). */
export const sectionSpeed = (width: number, seconds: number): number => width / Math.max(seconds, 1 / 240);

/**
 * Your percentile on one section type (0-100): how your last RECENT_RUNS passes through that
 * type (in your course bests) compare with everyone's, by speed. Null below MIN_RUNS passes.
 */
export function sectionPercentile(speeds: readonly number[], counts: TimeCounts): number | null {
  if (speeds.length < MIN_RUNS) return null;
  return beatenShare(speeds.map(speedBucket), counts, true);
}

/** Your standing on one section type. */
export interface SectionStats {
  type: SectionType;
  /** Sections of this type in your course bests. */
  passes: number;
  percentile: number | null;
}

/** What the server sends about your runs. */
export interface Stats {
  /** Courses you have finished (all time). */
  courses: number;
  /** Your percentile over your bests on your last RECENT_RUNS courses, or null below MIN_RUNS. */
  percentile: number | null;
  /** Course bests by everyone. */
  everyone: number;
  /** By section type, for the types you have been through. */
  sections: SectionStats[];
}
