// The daily course leaderboard (D1).
//
//   GET  /api/daily?day=YYYY-MM-DD&player=<id>   the day's course, top 20, your best and rank
//   GET  /api/daily/leader?day=YYYY-MM-DD        the fastest run of the day, to race as a ghost
//   POST /api/daily { day, player, name, time, inputs }
//
// A run is sent as what was drawn at which physics step. The server replays it on the day's
// course with the same physics the game uses (shared/replay.ts) and records the time the replay
// takes, not the time claimed.
import { dailyStage } from '../shared/course/stages';
import { cleanInputs } from '../shared/replay';
import type { Env } from './env';
import { cleanText, json, logError } from './http';
import { moderateName } from './moderation';
import verifyRun from './verify';
import type { Verdict } from './verify';

const TOP = 20;
const PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
/** Longest daily run the server replays. */
const MAX_RUN_SECONDS = 240;
/** Largest run upload (bytes). */
const MAX_BODY = 256 * 1024;

let schemaReady: Promise<unknown> | null = null;

/** Columns added after the table was first made: each best run's inputs, and how long its check took. */
const LATER_COLUMNS: [string, string][] = [['run', 'TEXT'], ['verify_ms', 'INTEGER']];

async function addLaterColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(daily_scores)').all<{ name: string }>();
  const missing = LATER_COLUMNS.filter(([name]) => !columns.results.some((c) => c.name === name));
  await Promise.all(missing.map(([name, type]) => db.prepare(`ALTER TABLE daily_scores ADD COLUMN ${name} ${type}`).run()));
}

/** The table is created on first use, so production, previews and local runs need no setup. */
function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_scores (
      day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
      time REAL NOT NULL, created_at INTEGER NOT NULL, run TEXT, verify_ms INTEGER,
      PRIMARY KEY (day, player))`),
    db.prepare('CREATE INDEX IF NOT EXISTS daily_by_time ON daily_scores (day, time)'),
  ]).then(() => addLaterColumns(db)).catch((e) => {
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

/** Days a run may be for: today and yesterday (UTC), so a race across midnight still counts. */
function openDays(): string[] {
  const now = Date.now();
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [dayOf(now), dayOf(now - DAY_MS)];
}

interface Row {
  name: string;
  time: number;
  you: number;
  verify_ms: number | null;
}

async function leaderboard(db: D1Database, url: URL): Promise<Response> {
  const asked = url.searchParams.get('day') ?? '';
  const day = DAY_RE.test(asked) ? asked : openDays()[0];
  const player = url.searchParams.get('player') ?? '';
  const top = await db.prepare(`SELECT name, time, player = ?2 AS you, verify_ms FROM daily_scores
    WHERE day = ?1 ORDER BY time, created_at LIMIT ?3`).bind(day, player, TOP).all<Row>();
  let you: { time: number; rank: number } | null = null;
  if (PLAYER_RE.test(player)) {
    const mine = await db.prepare('SELECT time FROM daily_scores WHERE day = ?1 AND player = ?2')
      .bind(day, player).first<{ time: number }>();
    if (mine) {
      const faster = await db.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ?1 AND time < ?2')
        .bind(day, mine.time).first<{ n: number }>();
      you = { time: mine.time, rank: (faster?.n ?? 0) + 1 };
    }
  }
  const total = await db.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ?1')
    .bind(day).first<{ n: number }>();
  return json({
    day,
    stage: dailyStage(day),
    top: top.results.map((r) => ({
      name: r.name,
      time: r.time,
      you: !!r.you,
      verifySeconds: r.verify_ms === null ? null : r.verify_ms / 1000,
    })),
    you,
    total: total?.n ?? 0,
  });
}

/** The day's fastest run that has inputs saved, for racing against as a ghost. */
async function leader(db: D1Database, url: URL): Promise<Response> {
  const asked = url.searchParams.get('day') ?? '';
  const day = DAY_RE.test(asked) ? asked : openDays()[0];
  const row = await db.prepare(`SELECT name, time, player, run FROM daily_scores
    WHERE day = ?1 AND run IS NOT NULL ORDER BY time, created_at LIMIT 1`)
    .bind(day).first<{ name: string; time: number; player: string; run: string }>();
  if (!row) return json({ day, leader: null });
  const player = url.searchParams.get('player') ?? '';
  return json({
    day,
    leader: {
      name: row.name, time: row.time, you: row.player === player, inputs: JSON.parse(row.run),
    },
  });
}

interface Submission {
  day?: unknown;
  player?: unknown;
  name?: unknown;
  time?: unknown;
  inputs?: unknown;
}

async function submit(env: Env, db: D1Database, request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'That run is too big to send.' }, 413);
  let body: Submission;
  try {
    body = JSON.parse(text) as Submission;
  } catch {
    return json({ error: 'Send the run as JSON.' }, 400);
  }
  const day = String(body.day ?? '');
  const player = String(body.player ?? '');
  if (!openDays().includes(day)) return json({ error: 'That daily course has closed.' }, 400);
  if (!PLAYER_RE.test(player)) return json({ error: 'Missing player id.' }, 400);
  const inputs = cleanInputs(body.inputs);
  if (!inputs) return json({ error: 'The run is missing its recording.' }, 422);
  let verdict: Verdict;
  try {
    verdict = await verifyRun(env, 'daily', dailyStage(day), inputs, MAX_RUN_SECONDS);
  } catch (e) {
    logError('daily replay failed', e);
    return json({ error: 'The server could not check your run. Try again.' }, 503);
  }
  const seconds = Math.round(verdict.ms) / 1000;
  if (!verdict.finished) {
    return json({ error: 'The server replayed your run and it did not reach the finish.', verifySeconds: seconds }, 422);
  }
  const time = Math.round(verdict.time * 100) / 100;
  const name = moderateName(cleanText(body.name, 16), 'Runner');
  // Keep each player's best time for the day, with the run that set it.
  await db.prepare(`INSERT INTO daily_scores (day, player, name, time, created_at, run, verify_ms)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (day, player) DO UPDATE SET name = excluded.name,
      created_at = CASE WHEN excluded.time < daily_scores.time THEN excluded.created_at ELSE daily_scores.created_at END,
      run = CASE WHEN excluded.time <= daily_scores.time
        THEN excluded.run ELSE daily_scores.run END,
      verify_ms = CASE WHEN excluded.time <= daily_scores.time
        THEN excluded.verify_ms ELSE daily_scores.verify_ms END,
      time = MIN(daily_scores.time, excluded.time)`)
    .bind(day, player, name, time, Date.now(), JSON.stringify(inputs), verdict.ms).run();
  env.STATS?.writeDataPoint({ blobs: ['daily', day], doubles: [time], indexes: ['daily'] });
  return json({
    ok: true, time, claimed: Number(body.time) || null, verifySeconds: seconds,
  });
}

export default async function handleDaily(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: 'The leaderboard is not set up on this server.' }, 503);
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname.endsWith('/leader')) return leader(env.DB, url);
  if (request.method === 'GET') return leaderboard(env.DB, url);
  if (request.method === 'POST') return submit(env, env.DB, request);
  return json({ error: 'Use GET or POST.' }, 405);
}
