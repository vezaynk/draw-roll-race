// The D1 database: daily scores, every run (for stats), players, their passkeys, sign-in challenges and sessions.
// Tables are created on first use, so production, previews and local runs need no setup.
import { playerHash } from '../shared/identity';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS daily_scores (
    day TEXT NOT NULL, player TEXT NOT NULL, name TEXT NOT NULL,
    time REAL NOT NULL, created_at INTEGER NOT NULL, run TEXT, verify_ms INTEGER, hash TEXT,
    PRIMARY KEY (day, player))`,
  'CREATE INDEX IF NOT EXISTS daily_by_time ON daily_scores (day, time)',
  // user_handle: the random ID passkeys store for the player (never the player ID itself).
  // claimed: 1 once the player has a passkey; from then on posting as them needs a session.
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
    user_handle TEXT UNIQUE, claimed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY, player TEXT NOT NULL, public_key TEXT NOT NULL,
    counter INTEGER NOT NULL, transports TEXT, created_at INTEGER NOT NULL, used_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS passkeys_by_player ON passkeys (player)',
  `CREATE TABLE IF NOT EXISTS challenges (
    challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, player TEXT, expires_at INTEGER NOT NULL)`,
  // Sessions are looked up by a hash of the cookie's token, so the table holds no usable tokens.
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, player TEXT NOT NULL, created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL)`,
  // Every finished run (for stats), and how many runs finished in each 0.1 s bucket.
  `CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player TEXT NOT NULL, hash TEXT NOT NULL,
    course TEXT NOT NULL, time REAL NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS runs_by_hash ON runs (hash, id)',
  'CREATE INDEX IF NOT EXISTS runs_by_player ON runs (player)',
  'CREATE TABLE IF NOT EXISTS run_times (bucket INTEGER PRIMARY KEY, n INTEGER NOT NULL)',
  // Speed through every section of every run, and how many passes of each type were how fast.
  `CREATE TABLE IF NOT EXISTS run_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, type TEXT NOT NULL, speed REAL NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS run_sections_by_hash ON run_sections (hash, type, id)',
  `CREATE TABLE IF NOT EXISTS section_speeds (
    type TEXT NOT NULL, bucket INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (type, bucket))`,
];

/** Columns added to tables after they were first made: [table, column, type]. */
const LATER_COLUMNS: [string, string, string][] = [
  ['daily_scores', 'run', 'TEXT'],
  ['daily_scores', 'verify_ms', 'INTEGER'],
  ['daily_scores', 'hash', 'TEXT'],
  // A signed-in player's chosen look (JSON; see shared/look.ts).
  ['players', 'look', 'TEXT'],
];

async function addLaterColumns(db: D1Database): Promise<void> {
  const tables = [...new Set(LATER_COLUMNS.map(([table]) => table))];
  const existing = await Promise.all(tables.map(async (table) => {
    const columns = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    return columns.results.map((c) => `${table}.${c.name}`);
  }));
  const have = new Set(existing.flat());
  const missing = LATER_COLUMNS.filter(([table, name]) => !have.has(`${table}.${name}`));
  await Promise.all(missing.map(([table, name, type]) => db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run()));
}

/** Fills in hashes for scores saved before hashes existed. */
async function backfillHashes(db: D1Database): Promise<void> {
  const rows = await db.prepare('SELECT DISTINCT player FROM daily_scores WHERE hash IS NULL')
    .all<{ player: string }>();
  if (!rows.results.length) return;
  const updates = await Promise.all(rows.results.map(async ({ player }) => db
    .prepare('UPDATE daily_scores SET hash = ?1 WHERE player = ?2')
    .bind(await playerHash(player), player)));
  await db.batch(updates);
}

let ready: Promise<unknown> | null = null;

export default function ensureSchema(db: D1Database): Promise<unknown> {
  ready ??= db.batch(TABLES.map((sql) => db.prepare(sql)))
    .then(() => addLaterColumns(db))
    .then(() => db.prepare('CREATE INDEX IF NOT EXISTS daily_by_hash ON daily_scores (day, hash)').run())
    .then(() => backfillHashes(db))
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
