// Personal performance: how your recent runs compare with every run anyone has finished. Each of
// your last RECENT_RUNS runs gets the share of all runs it beat, and your percentile is their
// average. All courses count together: a long course's runs are slower than a short one's, so
// it's rough, but it stays meaningful while each course has only a few players.

/** How many of your latest runs count. */
export const RECENT_RUNS = 100;
/** Runs needed before there's a percentile to show. */
export const MIN_RUNS = 20;
/** Run times are counted in buckets this many seconds wide (the server keeps a count per bucket). */
export const BUCKET_SECONDS = 0.1;

export const bucketOf = (time: number): number => Math.floor(time / BUCKET_SECONDS + 1e-9);

/** How many runs finished in each time bucket: [bucket, count]. */
export type TimeCounts = readonly (readonly [number, number])[];

/**
 * Your percentile (0-100): on average, the share of all runs that your recent runs beat. A run
 * beats the runs in slower buckets and half of those in its own. Null with fewer than MIN_RUNS.
 */
export function percentile(recent: readonly number[], counts: TimeCounts): number | null {
  if (recent.length < MIN_RUNS) return null;
  const sorted = [...counts].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, n]) => sum + n, 0);
  if (!total) return null;
  // slowerThan[i]: runs in buckets after sorted[i].
  const slowerThan: number[] = new Array(sorted.length);
  let slower = 0;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    slowerThan[i] = slower;
    slower += sorted[i][1];
  }
  const index = new Map(sorted.map(([bucket], i) => [bucket, i]));
  const shares = recent.map((time) => {
    const b = bucketOf(time);
    const i = index.get(b);
    if (i !== undefined) return (slowerThan[i] + sorted[i][1] / 2) / total;
    // Not counted yet (shouldn't happen): beats every run in a slower bucket.
    return sorted.filter(([bucket]) => bucket > b).reduce((sum, [, n]) => sum + n, 0) / total;
  });
  return (100 * shares.reduce((sum, s) => sum + s, 0)) / shares.length;
}

/** What the server sends about your runs. */
export interface Stats {
  /** Runs you have finished (all time). */
  runs: number;
  /** Your percentile over your last RECENT_RUNS runs, or null below MIN_RUNS. */
  percentile: number | null;
  /** Runs by everyone. */
  everyone: number;
}
