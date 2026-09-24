// The D1 database: daily scores, players, their passkeys, sign-in challenges and sessions.
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
];

/** Columns added to daily_scores after it was first made. */
const LATER_COLUMNS: [string, string][] = [['run', 'TEXT'], ['verify_ms', 'INTEGER'], ['hash', 'TEXT']];

async function addLaterColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(daily_scores)').all<{ name: string }>();
  const missing = LATER_COLUMNS.filter(([name]) => !columns.results.some((c) => c.name === name));
  await Promise.all(missing.map(([name, type]) => db.prepare(`ALTER TABLE daily_scores ADD COLUMN ${name} ${type}`).run()));
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
