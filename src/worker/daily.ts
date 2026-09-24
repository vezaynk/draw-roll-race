// The daily course leaderboard (D1).
//
//   GET  /api/daily?day=YYYY-MM-DD&player=<id>   the day's course, top 20, your best and rank
//   POST /api/daily { day, player, name, time, trace }
//
// Each run comes with a recording of the runner's position ([t, x] pairs). The server rebuilds
// the day's course and only accepts runs the recording backs up (see shared/validation.ts).
import buildCourse from '../shared/course/build';
import { dailyStage } from '../shared/course/stages';
import type { Course } from '../shared/types';
import { traceProblem } from '../shared/validation';
import type { Env } from './env';
import { cleanText, json } from './http';
import { moderateName } from './moderation';

const TOP = 20;
const PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

let schemaReady: Promise<unknown> | null = null;

/** The table is created on first use, so production, previews and local runs need no setup. */
function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_scores (
      day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
      time REAL NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (day, player))`),
    db.prepare('CREATE INDEX IF NOT EXISTS daily_by_time ON daily_scores (day, time)'),
  ]).catch((e) => {
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

const courses = new Map<string, Course>();
function courseFor(day: string): Course {
  let course = courses.get(day);
  if (!course) {
    if (courses.size > 4) courses.clear();
    course = buildCourse(dailyStage(day));
    courses.set(day, course);
  }
  return course;
}

interface Row {
  name: string;
  time: number;
  you: number;
}

async function leaderboard(db: D1Database, url: URL): Promise<Response> {
  const asked = url.searchParams.get('day') ?? '';
  const day = DAY_RE.test(asked) ? asked : openDays()[0];
  const player = url.searchParams.get('player') ?? '';
  const top = await db.prepare(`SELECT name, time, player = ?2 AS you FROM daily_scores
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
    top: top.results.map((r) => ({ name: r.name, time: r.time, you: !!r.you })),
    you,
    total: total?.n ?? 0,
  });
}

interface Submission {
  day?: unknown;
  player?: unknown;
  name?: unknown;
  time?: unknown;
  trace?: unknown;
}

async function submit(env: Env, db: D1Database, request: Request): Promise<Response> {
  let body: Submission;
  try {
    body = await request.json<Submission>();
  } catch {
    return json({ error: 'Send the run as JSON.' }, 400);
  }
  const day = String(body.day ?? '');
  const player = String(body.player ?? '');
  const time = Math.round(Number(body.time) * 100) / 100;
  if (!openDays().includes(day)) return json({ error: 'That daily course has closed.' }, 400);
  if (!PLAYER_RE.test(player)) return json({ error: 'Missing player id.' }, 400);
  const problem = traceProblem(courseFor(day), time, body.trace);
  if (problem) return json({ error: problem }, 422);
  const name = moderateName(cleanText(body.name, 16), 'Runner');
  // Keep each player's best time for the day.
  await db.prepare(`INSERT INTO daily_scores (day, player, name, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (day, player) DO UPDATE SET name = excluded.name,
      created_at = CASE WHEN excluded.time < daily_scores.time THEN excluded.created_at ELSE daily_scores.created_at END,
      time = MIN(daily_scores.time, excluded.time)`)
    .bind(day, player, name, time, Date.now()).run();
  env.STATS?.writeDataPoint({ blobs: ['daily', day], doubles: [time], indexes: ['daily'] });
  return json({ ok: true });
}

export default async function handleDaily(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return json({ error: 'The leaderboard is not set up on this server.' }, 503);
  await ensureSchema(env.DB);
  if (request.method === 'GET') return leaderboard(env.DB, new URL(request.url));
  if (request.method === 'POST') return submit(env, env.DB, request);
  return json({ error: 'Use GET or POST.' }, 405);
}
