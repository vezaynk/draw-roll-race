// The daily course leaderboard (D1).
//
//   GET  /api/daily?day=YYYY-MM-DD&hash=<your hash>  the day's course, top 20, your best and rank
//   GET  /api/daily/leader?day=YYYY-MM-DD           who is fastest today (name, time, hash)
//   POST /api/daily { day, player, name, time, inputs }
//
// Players appear only as hashes of their IDs (shared/identity.ts): browsers find their own rows
// by hashing their own ID. A player saved with a passkey must be signed in to post (players.ts).
//
// A run is sent as what was drawn at which physics step. The server replays it on the day's
// course with the same physics the game uses (shared/replay.ts) and records the time the replay
// takes, not the time claimed.
import { dailyStage } from '../shared/course/stages';
import { HASH_RE } from '../shared/identity';
import { nameFromHash } from '../shared/names';
import { cleanInputs } from '../shared/replay';
import type { Env } from './env';
import ensureSchema from './db';
import { cleanText, json, logError } from './http';
import { moderateName } from './moderation';
import { posterFor, upsertPlayer } from './players';
import { recordRun } from './runs';
import verifyRun from './verify';
import type { Verdict } from './verify';

const TOP = 20;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
/** Longest daily run the server replays. */
const MAX_RUN_SECONDS = 240;
/** Largest run upload (bytes). */
const MAX_BODY = 256 * 1024;

/** Days a run may be for: today and yesterday (UTC), so a race across midnight still counts. */
function openDays(): string[] {
  const now = Date.now();
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return [dayOf(now), dayOf(now - DAY_MS)];
}

interface Row {
  name: string;
  time: number;
  hash: string;
  verify_ms: number | null;
}

async function leaderboard(db: D1Database, url: URL): Promise<Response> {
  const asked = url.searchParams.get('day') ?? '';
  const day = DAY_RE.test(asked) ? asked : openDays()[0];
  const hash = url.searchParams.get('hash') ?? '';
  const top = await db.prepare(`SELECT name, time, hash, verify_ms FROM daily_scores
    WHERE day = ?1 ORDER BY time, created_at LIMIT ?2`).bind(day, TOP).all<Row>();
  let you: { time: number; rank: number } | null = null;
  if (HASH_RE.test(hash)) {
    const mine = await db.prepare('SELECT time FROM daily_scores WHERE day = ?1 AND hash = ?2')
      .bind(day, hash).first<{ time: number }>();
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
      hash: r.hash,
      verifySeconds: r.verify_ms === null ? null : r.verify_ms / 1000,
    })),
    you,
    total: total?.n ?? 0,
  });
}

/**
 * The day's fastest player: name, time and hash only. Runs themselves are never sent out, since
 * they would give away the player's strategy.
 */
async function leader(db: D1Database, url: URL): Promise<Response> {
  const asked = url.searchParams.get('day') ?? '';
  const day = DAY_RE.test(asked) ? asked : openDays()[0];
  const row = await db.prepare(`SELECT name, time, hash FROM daily_scores
    WHERE day = ?1 ORDER BY time, created_at LIMIT 1`)
    .bind(day).first<{ name: string; time: number; hash: string }>();
  if (!row) return json({ day, leader: null });
  return json({ day, leader: { name: row.name, time: row.time, hash: row.hash } });
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
  if (!openDays().includes(day)) return json({ error: 'That daily course has closed.' }, 400);
  const who = await posterFor(db, request, body.player);
  if (!who.ok) return json({ error: who.error }, who.status);
  const { player } = who;
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
  // Players who haven't chosen a name are listed under their default one.
  const row = await upsertPlayer(db, player, moderateName(cleanText(body.name, 24), ''));
  const name = row.name || nameFromHash(row.hash);
  // Keep each player's best time for the day, with the run that set it.
  await db.prepare(`INSERT INTO daily_scores (day, player, name, time, created_at, run, verify_ms, hash)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT (day, player) DO UPDATE SET name = excluded.name,
      created_at = CASE WHEN excluded.time < daily_scores.time THEN excluded.created_at ELSE daily_scores.created_at END,
      run = CASE WHEN excluded.time <= daily_scores.time
        THEN excluded.run ELSE daily_scores.run END,
      verify_ms = CASE WHEN excluded.time <= daily_scores.time
        THEN excluded.verify_ms ELSE daily_scores.verify_ms END,
      time = MIN(daily_scores.time, excluded.time)`)
    .bind(day, player, name, time, Date.now(), JSON.stringify(inputs), verdict.ms, row.hash).run();
  // Every daily run also counts towards your stats, not just your best.
  await recordRun(db, player, `daily:${day}`, time, verdict.splits);
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
