import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_RUNS, bucketOf, percentile, sectionPercentile, speedBucket,
} from '../../src/shared/stats';
import type { TimeCounts } from '../../src/shared/stats';

const runs = (count: number, time: number) => Array.from({ length: count }, () => time);

/** Counts per bucket for a list of run times, like the server keeps. */
function countsOf(times: number[]): TimeCounts {
  const counts = new Map<number, number>();
  times.forEach((t) => counts.set(bucketOf(t), (counts.get(bucketOf(t)) ?? 0) + 1));
  return [...counts];
}

test('times fall in 0.1 s buckets', () => {
  assert.equal(bucketOf(12.34), 123);
  assert.equal(bucketOf(12.3), 123);
  assert.equal(bucketOf(0.05), 0);
});

test('no percentile below the minimum number of runs', () => {
  const mine = runs(MIN_RUNS - 1, 10);
  assert.equal(percentile(mine, countsOf([...mine, 20, 30])), null);
  assert.notEqual(percentile(runs(MIN_RUNS, 10), countsOf([...runs(MIN_RUNS, 10), 20])), null);
});

test('faster runs beat more of the others', () => {
  const others = [5, 8, 12, 15, 20, 25, 30, 40, 60, 90];
  const fast = runs(MIN_RUNS, 6);
  const slow = runs(MIN_RUNS, 50);
  const everyone = countsOf([...others, ...fast, ...slow]);
  const pFast = percentile(fast, everyone)!;
  const pSlow = percentile(slow, everyone)!;
  assert.ok(pFast > pSlow, `${pFast} > ${pSlow}`);
  // 6 s beats 9 of the others and all 20 slow runs, and ties its own 20: (29 + 20 / 2) / 50.
  assert.equal(Math.round(pFast * 100) / 100, 78);
});

test('your percentile averages your runs', () => {
  const others = runs(100, 20);
  // Half your runs beat everyone else, half lose to everyone else.
  const mine = [...runs(10, 10), ...runs(10, 30)];
  const p = percentile(mine, countsOf([...others, ...mine]))!;
  // Fast ones beat 100 + 10 slow and tie 10 fast: (110 + 5) / 120. Slow ones: (0 + 5) / 120.
  assert.equal(Math.round(p * 1000) / 1000, Math.round(((115 + 5) / 2 / 120) * 100 * 1000) / 1000);
});

test('everyone at the same time is the 50th percentile', () => {
  const all = runs(MIN_RUNS, 12.3);
  assert.equal(percentile(all, countsOf(all)), 50);
});

test('on sections, faster speeds beat more of the others', () => {
  const speedCounts = (speeds: number[]): TimeCounts => {
    const counts = new Map<number, number>();
    speeds.forEach((v) => counts.set(speedBucket(v), (counts.get(speedBucket(v)) ?? 0) + 1));
    return [...counts];
  };
  const others = [100, 120, 150, 180, 200, 220, 250, 280, 300, 350];
  const quick = runs(MIN_RUNS, 260);
  const slow = runs(MIN_RUNS, 110);
  const everyone = speedCounts([...others, ...quick, ...slow]);
  const pQuick = sectionPercentile(quick, everyone)!;
  const pSlow = sectionPercentile(slow, everyone)!;
  // 260 beats 7 of the others and all 20 slow passes, and ties its own 20: (27 + 10) / 50.
  assert.equal(Math.round(pQuick * 100) / 100, 74);
  // 110 beats 1 of the others and ties its own: (1 + 10) / 50.
  assert.equal(Math.round(pSlow * 100) / 100, 22);
  assert.equal(sectionPercentile(runs(MIN_RUNS - 1, 260), everyone), null);
});
