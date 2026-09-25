// Finished runs, for personal performance stats (shared/stats.ts). Only each player's best run on
// each course counts.
//
//   POST /api/runs { player, stage, inputs }   a finished run on a stage (solo or in a room)
//   GET  /api/stats?hash=<your hash>           your runs and percentile
//
// Daily runs are recorded by the daily leaderboard (daily.ts). Like those, a run is sent as what
// was drawn at which physics step, and the server replays it: the time kept is the replay's.
// Besides each best, the server keeps how many bests are in each 0.1 s bucket, so working out a
// percentile reads at most a few thousand small rows. The replay also times each section of the
// course; speeds through sections (of best runs) are kept the same way, by section type.
import { RANDOM_BASE, TUTORIAL, isTestStage } from '../shared/course/stages';
import { HASH_RE, playerHash } from '../shared/identity';
import { cleanInputs } from '../shared/replay';
import type { SectionSplit } from '../shared/replay';
import {
  MIN_RUNS, RECENT_RUNS, bucketOf, percentile, sectionPercentile, sectionSpeed, speedBucket,
} from '../shared/stats';
import type { SectionStats, Stats, TimeCounts } from '../shared/stats';
import type { SectionType } from '../shared/types';
import ensureSchema from './db';
import type { Env } from './env';
import { allowed, json, logError } from './http';
import { posterFor } from './players';
import verifyRun from './verify';
import type { Verdict } from './verify';

/** Longest run the server replays. */
const MAX_RUN_SECONDS = 240;
/** Largest run upload (bytes). */
const MAX_BODY = 256 * 1024;
/** Stage numbers go up to RANDOM_BASE plus a generated course's number (below this). */
const MAX_STAGE = RANDOM_BASE + 100000000;

const speedOf = (split: SectionSplit) => Math.round(sectionSpeed(split.width, split.seconds) * 10) / 10;

/** Statements that take a player's best on a course out of the stats (to replace or drop it). */
async function forgetBest(db: D1Database, hash: string, course: string, time: number): Promise<D1PreparedStatement[]> {
  const sections = await db.prepare('SELECT type, speed FROM best_sections WHERE hash = ?1 AND course = ?2')
    .bind(hash, course).all<{ type: string; speed: number }>();
  return [
    db.prepare('UPDATE best_times SET n = n - 1 WHERE bucket = ?1').bind(bucketOf(time)),
    ...sections.results.map(({ type, speed }) => db.prepare('UPDATE best_speeds SET n = n - 1 WHERE type = ?1 AND bucket = ?2')
      .bind(type, speedBucket(speed))),
    db.prepare('DELETE FROM best_sections WHERE hash = ?1 AND course = ?2').bind(hash, course),
  ];
}

/**
 * Records a verified run. Only your best run on each course counts: a slower run just marks the
 * course as played now (your latest courses are the ones that count).
 */
export async function recordRun(
  db: D1Database,
  player: string,
  course: string,
  time: number,
  splits: SectionSplit[],
): Promise<void> {
  const hash = await playerHash(player);
  const now = Date.now();
  const old = await db.prepare('SELECT time FROM course_bests WHERE player = ?1 AND course = ?2')
    .bind(player, course).first<{ time: number }>();
  if (old && old.time <= time) {
    await db.prepare('UPDATE course_bests SET played_at = ?1 WHERE player = ?2 AND course = ?3')
      .bind(now, player, course).run();
    return;
  }
  await db.batch([
    ...(old ? await forgetBest(db, hash, course, old.time) : []),
    db.prepare(`INSERT INTO course_bests (player, hash, course, time, played_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (player, course) DO UPDATE SET time = excluded.time, played_at = excluded.played_at`)
      .bind(player, hash, course, time, now),
    db.prepare(`INSERT INTO best_times (bucket, n) VALUES (?1, 1)
      ON CONFLICT (bucket) DO UPDATE SET n = n + 1`).bind(bucketOf(time)),
    ...splits.flatMap((split) => {
      const speed = speedOf(split);
      return [
        db.prepare('INSERT INTO best_sections (hash, course, type, speed) VALUES (?1, ?2, ?3, ?4)')
          .bind(hash, course, split.type, speed),
        db.prepare(`INSERT INTO best_speeds (type, bucket, n) VALUES (?1, ?2, 1)
          ON CONFLICT (type, bucket) DO UPDATE SET n = n + 1`).bind(split.type, speedBucket(speed)),
      ];
    }),
  ]);
}

/**
 * Statements that move an anonymous player's bests to another player (signing in with a
 * passkey): on a course both have run, the better best stays and the other leaves the stats.
 */
export async function mergeBests(db: D1Database, from: string, to: string): Promise<D1PreparedStatement[]> {
  const [fromHash, toHash] = await Promise.all([playerHash(from), playerHash(to)]);
  const [theirs, mine] = await Promise.all([from, to].map((player) => db
    .prepare('SELECT course, time FROM course_bests WHERE player = ?1').bind(player)
    .all<{ course: string; time: number }>()));
  const kept = new Map(mine.results.map((r) => [r.course, r.time]));
  const statements = await Promise.all(theirs.results.map(async ({ course, time }) => {
    const other = kept.get(course);
    if (other !== undefined && other <= time) {
      return [
        ...await forgetBest(db, fromHash, course, time),
        db.prepare('DELETE FROM course_bests WHERE player = ?1 AND course = ?2').bind(from, course),
      ];
    }
    return [
      ...(other === undefined ? [] : [
        ...await forgetBest(db, toHash, course, other),
        db.prepare('DELETE FROM course_bests WHERE player = ?1 AND course = ?2').bind(to, course),
      ]),
      db.prepare('UPDATE course_bests SET player = ?1, hash = ?2 WHERE player = ?3 AND course = ?4')
        .bind(to, toHash, from, course),
      db.prepare('UPDATE best_sections SET hash = ?1 WHERE hash = ?2 AND course = ?3').bind(toHash, fromHash, course),
    ];
  }));
  return statements.flat();
}

/** Your standing on each section type, from your bests on your latest courses, weakest first. */
async function sectionStats(db: D1Database, hash: string): Promise<SectionStats[]> {
  const [passes, recent, counts] = await db.batch([
    db.prepare('SELECT type, COUNT(*) AS n FROM best_sections WHERE hash = ?1 GROUP BY type').bind(hash),
    db.prepare(`SELECT type, speed FROM (
        SELECT s.type, s.speed, ROW_NUMBER() OVER (PARTITION BY s.type ORDER BY b.played_at DESC) AS latest
        FROM best_sections s JOIN course_bests b ON b.hash = s.hash AND b.course = s.course
        WHERE s.hash = ?1)
      WHERE latest <= ?2`).bind(hash, RECENT_RUNS),
    db.prepare('SELECT type, bucket, n FROM best_speeds WHERE n > 0'),
  ]);
  const speeds = new Map<string, number[]>();
  (recent.results as { type: string; speed: number }[]).forEach(({ type, speed }) => {
    speeds.set(type, [...(speeds.get(type) ?? []), speed]);
  });
  const everyone = new Map<string, [number, number][]>();
  (counts.results as { type: string; bucket: number; n: number }[]).forEach(({ type, bucket, n }) => {
    everyone.set(type, [...(everyone.get(type) ?? []), [bucket, n]]);
  });
  return (passes.results as { type: SectionType; n: number }[])
    .map(({ type, n }) => ({
      type,
      passes: n,
      percentile: n >= MIN_RUNS
        ? sectionPercentile(speeds.get(type) ?? [], (everyone.get(type) ?? []) as TimeCounts)
        : null,
    }))
    .sort((a, b) => (a.percentile ?? Infinity) - (b.percentile ?? Infinity) || b.passes - a.passes);
}

/** Your courses and percentile (your bests on your latest courses against everyone's bests). */
export async function statsFor(db: D1Database, hash: string): Promise<Stats> {
  const [count, recent, counts] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM course_bests WHERE hash = ?1').bind(hash),
    db.prepare('SELECT time FROM course_bests WHERE hash = ?1 ORDER BY played_at DESC LIMIT ?2').bind(hash, RECENT_RUNS),
    db.prepare('SELECT bucket, n FROM best_times WHERE n > 0'),
  ]);
  const courses = (count.results[0] as { n: number } | undefined)?.n ?? 0;
  const times = (recent.results as { time: number }[]).map((r) => r.time);
  const buckets = (counts.results as { bucket: number; n: number }[]).map((r) => [r.bucket, r.n] as const);
  return {
    courses,
    percentile: courses >= MIN_RUNS ? percentile(times, buckets) : null,
    everyone: buckets.reduce((sum, [, n]) => sum + n, 0),
    sections: await sectionStats(db, hash),
  };
}

/** Stages whose runs count: all but the tutorial (and test stages, outside tests). */
function countedStage(env: Env, value: unknown): number | null {
  const stage = Number(value);
  if (!Number.isInteger(stage) || stage < 0 || stage >= MAX_STAGE || stage === TUTORIAL) return null;
  if (isTestStage(stage) && env.ALLOW_TEST_STAGES !== '1') return null;
  return stage;
}

async function submit(env: Env, db: D1Database, request: Request): Promise<Response> {
  if (!(await allowed(env.RUNS_LIMITER, request))) {
    return json({ error: 'Too many runs sent from your network. Wait a minute and try again.' }, 429);
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'That run is too big to send.' }, 413);
  let body: { player?: unknown; stage?: unknown; inputs?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send the run as JSON.' }, 400);
  }
  const stage = countedStage(env, body?.stage);
  if (stage === null) return json({ error: 'Runs on that course don’t count.' }, 400);
  const inputs = cleanInputs(body.inputs);
  if (!inputs) return json({ error: 'The run is missing its recording.' }, 422);
  const who = await posterFor(db, request, body.player);
  if (!who.ok) return json({ error: who.error }, who.status);
  let verdict: Verdict;
  try {
    verdict = await verifyRun(env, 'run', stage, inputs, MAX_RUN_SECONDS);
  } catch (e) {
    logError('run replay failed', e);
    return json({ error: 'The server could not check your run. Try again.' }, 503);
  }
  if (!verdict.finished) return json({ error: 'The server replayed your run and it did not reach the finish.' }, 422);
  const time = Math.round(verdict.time * 100) / 100;
  await recordRun(db, who.player, `stage:${stage}`, time, verdict.splits);
  return json({ ok: true, time, stats: await statsFor(db, await playerHash(who.player)) });
}

export default async function handleRuns(request: Request, env: Env, what: string): Promise<Response> {
  const db = env.DB;
  if (!db) return json({ error: 'Stats are not set up here.' }, 503);
  await ensureSchema(db);
  if (what === 'runs' && request.method === 'POST') return submit(env, db, request);
  if (what === 'stats' && request.method === 'GET') {
    const hash = new URL(request.url).searchParams.get('hash') ?? '';
    if (!HASH_RE.test(hash)) return json({ error: 'Missing player hash.' }, 400);
    return json(await statsFor(db, hash));
  }
  return json({ error: 'Not found' }, 404);
}
