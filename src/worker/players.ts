// Players and sessions. A player is a secret ID with a public hash and a display name. Until a
// player saves themselves with a passkey, knowing the ID is enough to post as them; after that,
// posting as them needs a session, which a passkey sign-in starts (an HttpOnly cookie).
import { PLAYER_RE, playerHash } from '../shared/identity';

const COOKIE = 'drr_session';
const SESSION_DAYS = 365;
const DAY_MS = 86400000;

export interface PlayerRow {
  id: string;
  hash: string;
  name: string;
  user_handle: string | null;
  claimed: number;
}

/** URL-safe base64 of random bytes. */
export function randomToken(bytes = 32): string {
  const raw = String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)));
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getPlayer(db: D1Database, id: string): Promise<PlayerRow | null> {
  return db.prepare('SELECT id, hash, name, user_handle, claimed FROM players WHERE id = ?1')
    .bind(id).first<PlayerRow>();
}

/** The player's row, created if new. A non-empty name replaces the stored one. */
export async function upsertPlayer(db: D1Database, id: string, name: string): Promise<PlayerRow> {
  const hash = await playerHash(id);
  await db.prepare(`INSERT INTO players (id, hash, name, created_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (id) DO UPDATE SET name = CASE WHEN ?3 = '' THEN players.name ELSE ?3 END`)
    .bind(id, hash, name, Date.now()).run();
  return (await getPlayer(db, id)) as PlayerRow;
}

// ---------------- sessions ----------------

async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function cookieToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : null;
}

/** The player signed in on this request, or null. */
export async function sessionPlayer(db: D1Database, request: Request): Promise<string | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await db.prepare('SELECT player FROM sessions WHERE token_hash = ?1 AND expires_at > ?2')
    .bind(await tokenHash(token), Date.now()).first<{ player: string }>();
  return row?.player ?? null;
}

/** Starts a session for the player. Returns the Set-Cookie header value. */
export async function startSession(db: D1Database, player: string, secure: boolean): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db.prepare('INSERT INTO sessions (token_hash, player, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await tokenHash(token), player, now, now + SESSION_DAYS * DAY_MS).run();
  const flags = `Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
  return `${COOKIE}=${token}; ${flags}`;
}

/** Ends this request's session. Returns the Set-Cookie header value that clears the cookie. */
export async function endSession(db: D1Database, request: Request): Promise<string> {
  const token = cookieToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await tokenHash(token)).run();
  return `${COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export type Poster = { ok: true; player: string } | { ok: false; status: number; error: string };

/**
 * Who a write (like a daily run) is from: the signed-in player, or else the player ID sent with
 * it, as long as that player hasn't been saved with a passkey.
 */
export async function posterFor(db: D1Database, request: Request, sent: unknown): Promise<Poster> {
  const signedIn = await sessionPlayer(db, request);
  if (signedIn) return { ok: true, player: signedIn };
  const id = String(sent ?? '');
  if (!PLAYER_RE.test(id)) return { ok: false, status: 400, error: 'Missing player id.' };
  const row = await getPlayer(db, id);
  if (row?.claimed) {
    return { ok: false, status: 401, error: 'This player is saved with a passkey. Sign in to post as them.' };
  }
  return { ok: true, player: id };
}
