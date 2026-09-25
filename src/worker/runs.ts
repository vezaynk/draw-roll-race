// Every finished run, for personal performance stats (shared/stats.ts).
//
//   POST /api/runs { player, stage, inputs }   a finished run on a stage (solo or in a room)
//   GET  /api/stats?hash=<your hash>           your runs and percentile
//
// Daily runs are recorded by the daily leaderboard (daily.ts). Like those, a run is sent as what
// was drawn at which physics step, and the server replays it: the time kept is the replay's.
// Besides each run, the server keeps how many runs finished in each 0.1 s bucket, so working
// out a percentile reads at most a few thousand small rows.
import { RANDOM_BASE, TUTORIAL, isTestStage } from '../shared/course/stages';
import { HASH_RE, playerHash } from '../shared/identity';
import { cleanInputs } from '../shared/replay';
import {
  MIN_RUNS, RECENT_RUNS, bucketOf, percentile,
} from '../shared/stats';
import type { Stats } from '../shared/stats';
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

/** Records a verified run: the run itself and its time bucket's count. */
export async function recordRun(db: D1Database, player: string, course: string, time: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO runs (player, hash, course, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(player, await playerHash(player), course, time, Date.now()),
    db.prepare(`INSERT INTO run_times (bucket, n) VALUES (?1, 1)
      ON CONFLICT (bucket) DO UPDATE SET n = n + 1`).bind(bucketOf(time)),
  ]);
}

/** Your runs and percentile. */
export async function statsFor(db: D1Database, hash: string): Promise<Stats> {
  const [count, recent, counts] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM runs WHERE hash = ?1').bind(hash),
    db.prepare('SELECT time FROM runs WHERE hash = ?1 ORDER BY id DESC LIMIT ?2').bind(hash, RECENT_RUNS),
    db.prepare('SELECT bucket, n FROM run_times'),
  ]);
  const runs = (count.results[0] as { n: number } | undefined)?.n ?? 0;
  const times = (recent.results as { time: number }[]).map((r) => r.time);
  const buckets = (counts.results as { bucket: number; n: number }[]).map((r) => [r.bucket, r.n] as const);
  return {
    runs,
    percentile: runs >= MIN_RUNS ? percentile(times, buckets) : null,
    everyone: buckets.reduce((sum, [, n]) => sum + n, 0),
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
  await recordRun(db, who.player, `stage:${stage}`, time);
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
