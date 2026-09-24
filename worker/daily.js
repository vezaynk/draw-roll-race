// Draw Roll Race — the daily course leaderboard (D1).
//
// GET  /api/daily?player=<id>        today's course, the top 20, and your best and rank
// POST /api/daily {day, player, name, time, trace}
//
// Each run comes with a trace of the runner's position ([t, x] pairs, about 5 a second).
// The server rebuilds the day's course and only accepts runs whose trace starts at the start,
// moves at a possible speed, reaches the finish, and agrees with the claimed time.
import '../public/src/physics.js';
import { moderateName } from './moderation.js';

const D = globalThis.DRR;
const MAX_SPEED = 1200;   // world units per second no runner can average over a gap
const TOP = 20;
const PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

let schemaReady = null;
function ensureSchema(db) {
  schemaReady ||= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS daily_scores (
      day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
      time REAL NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (day, player))`),
    db.prepare('CREATE INDEX IF NOT EXISTS daily_by_time ON daily_scores (day, time)'),
  ]).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

// Days a run may be for: today and yesterday in UTC, so a race across midnight still counts.
function allowedDays() {
  const now = Date.now();
  return [new Date(now).toISOString().slice(0, 10), new Date(now - 86400000).toISOString().slice(0, 10)];
}

const courses = new Map(); // day -> course, per isolate
function courseFor(day) {
  if (!courses.has(day)) {
    if (courses.size > 4) courses.clear();
    courses.set(day, D.buildCourse(D.dailyStage(day)));
  }
  return courses.get(day);
}

// Returns an error message, or null if the run looks real.
export function checkRun(course, time, trace) {
  if (!Number.isFinite(time) || time <= 0 || time > 600) return 'That time is not possible.';
  if (!Array.isArray(trace) || trace.length < 3 || trace.length > 4000) return 'The run is missing its recording.';
  const minTime = (course.finishX - course.startX) / MAX_SPEED;
  if (time < minTime) return 'That time is faster than the course allows.';
  let [pt, px] = trace[0];
  if (!Number.isFinite(pt) || !Number.isFinite(px) || pt > 1 || Math.abs(px - course.startX) > 60) return 'The recording does not start at the start line.';
  for (let i = 1; i < trace.length; i++) {
    const [t, x] = trace[i];
    if (!Number.isFinite(t) || !Number.isFinite(x) || t < pt) return 'The recording is out of order.';
    if (t - pt > 1) return 'The recording has gaps.'; // the game records ten times a second
    if (x - px > MAX_SPEED * (t - pt) + 60) return 'The recording moves faster than any runner can.';
    pt = t; px = x;
  }
  if (px < course.finishX - 120) return 'The recording does not reach the finish.';
  if (Math.abs(pt - time) > 0.6) return 'The recording does not match the time.';
  return null;
}

export async function handleDaily(request, env) {
  if (!env.DB) return json({ error: 'The leaderboard is not set up on this server.' }, 503);
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const day = DAY_RE.test(url.searchParams.get('day') || '') ? url.searchParams.get('day') : allowedDays()[0];
    const player = url.searchParams.get('player') || '';
    const top = await env.DB.prepare('SELECT name, time, player = ?2 AS you FROM daily_scores WHERE day = ?1 ORDER BY time, created_at LIMIT ?3')
      .bind(day, player, TOP).all();
    let you = null;
    if (PLAYER_RE.test(player)) {
      const mine = await env.DB.prepare('SELECT time FROM daily_scores WHERE day = ?1 AND player = ?2').bind(day, player).first();
      if (mine) {
        const rank = await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ?1 AND time < ?2').bind(day, mine.time).first();
        you = { time: mine.time, rank: rank.n + 1 };
      }
    }
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_scores WHERE day = ?1').bind(day).first();
    return json({ day, stage: D.dailyStage(day), top: top.results.map(r => ({ name: r.name, time: r.time, you: !!r.you })), you, total: total.n });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Send the run as JSON.' }, 400); }
    const { day, player, trace } = body || {};
    const time = Math.round(Number(body && body.time) * 100) / 100;
    if (!allowedDays().includes(day)) return json({ error: 'That daily course has closed.' }, 400);
    if (!PLAYER_RE.test(player || '')) return json({ error: 'Missing player id.' }, 400);
    const problem = checkRun(courseFor(day), time, trace);
    if (problem) return json({ error: problem }, 422);
    const raw = String((body && body.name) || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, 16);
    const name = moderateName(raw, 'Runner');
    // Keep each player's best time for the day.
    await env.DB.prepare(`INSERT INTO daily_scores (day, player, name, time, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT (day, player) DO UPDATE SET name = excluded.name,
        created_at = CASE WHEN excluded.time < daily_scores.time THEN excluded.created_at ELSE daily_scores.created_at END,
        time = MIN(daily_scores.time, excluded.time)`)
      .bind(day, player, name, time, Date.now()).run();
    if (env.STATS) {
      try { env.STATS.writeDataPoint({ blobs: ['daily', day], doubles: [time], indexes: ['daily'] }); } catch { /* optional */ }
    }
    return json({ ok: true });
  }

  return json({ error: 'Use GET or POST.' }, 405);
}
