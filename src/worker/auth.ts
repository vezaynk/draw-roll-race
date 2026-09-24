// Passkeys (WebAuthn), via SimpleWebAuthn.
//
//   POST /api/auth/register/options { player, name }  start saving a player with a new passkey
//   POST /api/auth/register/verify  { response }       finish it: the player is claimed, signed in
//   POST /api/auth/login/options                       start signing in with a passkey
//   POST /api/auth/login/verify     { response, localPlayer }  finish it: sends back the player ID
//   GET  /api/auth/me                                  who is signed in (with their player ID)
//   POST /api/auth/look             { look }           save the signed-in player's look
//   POST /api/auth/logout
//
// The game offers one button, "Save with a passkey" (client/account.ts): it uses a passkey the
// browser already has if there is one (login), or else makes one for this device's player
// (register). A player's ID is only ever sent to a browser signed in as them. Challenges are
// single-use and expire after five minutes. Using an existing passkey on a device that had its
// own anonymous player remaps that player into the passkey's (see mergeScores).
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { PLAYER_RE, playerHash } from '../shared/identity';
import { sanitizeLook } from '../shared/look';
import ensureSchema from './db';
import type { Env } from './env';
import { allowed, cleanText, json, logError } from './http';
import { moderateName } from './moderation';
import {
  endSession, getPlayer, posterFor, randomToken, sessionPlayer, startSession, upsertPlayer,
} from './players';

const RP_NAME = 'Draw Roll Race';
const CHALLENGE_MS = 5 * 60 * 1000;

type Kind = 'register' | 'login';

interface Site {
  rpID: string;
  origin: string;
  secure: boolean;
}

/** Passkeys belong to the exact host the game is served from (so previews have their own). */
function siteOf(request: Request): Site {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin, secure: url.protocol === 'https:' };
}

async function saveChallenge(db: D1Database, challenge: string, kind: Kind, player: string | null) {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM challenges WHERE expires_at < ?1').bind(now),
    db.prepare('INSERT INTO challenges (challenge, kind, player, expires_at) VALUES (?1, ?2, ?3, ?4)')
      .bind(challenge, kind, player, now + CHALLENGE_MS),
  ]);
}

/** Takes (uses up) the challenge a response answers, if it is live and of the right kind. */
async function takeChallenge(db: D1Database, clientDataJSON: unknown, kind: Kind) {
  let challenge = '';
  try {
    const clientData = JSON.parse(isoBase64URL.toUTF8String(String(clientDataJSON)));
    challenge = String(clientData.challenge ?? '');
  } catch {
    return null;
  }
  return db.prepare(`DELETE FROM challenges WHERE challenge = ?1 AND kind = ?2 AND expires_at > ?3
    RETURNING challenge, player`).bind(challenge, kind, Date.now())
    .first<{ challenge: string; player: string | null }>();
}

function withCookie(response: Response, cookie: string): Response {
  response.headers.append('set-cookie', cookie);
  return response;
}

async function body<T>(request: Request): Promise<T | null> {
  try {
    return await request.json<T>();
  } catch {
    return null;
  }
}

// ---------------- registering a passkey ----------------

async function registerOptions(request: Request, db: D1Database): Promise<Response> {
  const input = await body<{ player?: unknown; name?: unknown }>(request);
  const who = await posterFor(db, request, input?.player);
  if (!who.ok) return json({ error: who.error }, who.status);
  const name = moderateName(cleanText(input?.name, 16), '');
  let player = await upsertPlayer(db, who.player, name);
  if (!player.user_handle) {
    await db.prepare('UPDATE players SET user_handle = ?1 WHERE id = ?2 AND user_handle IS NULL')
      .bind(randomToken(16), player.id).run();
    player = (await getPlayer(db, player.id)) ?? player;
  }
  const existing = await db.prepare('SELECT id, transports FROM passkeys WHERE player = ?1')
    .bind(player.id).all<{ id: string; transports: string | null }>();
  const shown = player.name || 'Runner';
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: siteOf(request).rpID,
    userName: shown,
    userDisplayName: shown,
    userID: isoBase64URL.toBuffer(player.user_handle ?? ''),
    attestationType: 'none',
    excludeCredentials: existing.results.map((c) => ({
      id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  await saveChallenge(db, options.challenge, 'register', player.id);
  return json(options);
}

async function registerVerify(request: Request, db: D1Database): Promise<Response> {
  const input = await body<{ response?: RegistrationResponseJSON }>(request);
  const response = input?.response;
  if (!response?.response) return json({ error: 'Missing passkey response.' }, 400);
  const pending = await takeChallenge(db, response.response.clientDataJSON, 'register');
  if (!pending?.player) return json({ error: 'That request expired. Try again.' }, 400);
  const site = siteOf(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    logError('passkey registration failed', e);
    return json({ error: 'The passkey could not be checked.' }, 400);
  }
  if (!verification.verified) return json({ error: 'The passkey could not be checked.' }, 400);
  const { credential } = verification.registrationInfo;
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO passkeys (id, player, public_key, counter, transports, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
      credential.id,
      pending.player,
      isoBase64URL.fromBuffer(credential.publicKey),
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      now,
    ),
    db.prepare('UPDATE players SET claimed = 1 WHERE id = ?1').bind(pending.player),
  ]);
  const player = await getPlayer(db, pending.player);
  const cookie = await startSession(db, pending.player, site.secure);
  return withCookie(json({ ok: true, hash: player?.hash, name: player?.name ?? '' }), cookie);
}

// ---------------- signing in ----------------

async function loginOptions(request: Request, db: D1Database): Promise<Response> {
  // No allowCredentials: the browser offers whichever passkeys it has for this site.
  const options = await generateAuthenticationOptions({
    rpID: siteOf(request).rpID, userVerification: 'preferred',
  });
  await saveChallenge(db, options.challenge, 'login', null);
  return json(options);
}

/**
 * Remaps an anonymous player to another: their daily scores move over (keeping the better time
 * per day), a missing name is filled in, and the anonymous player is removed.
 */
async function mergeScores(db: D1Database, from: string, to: string): Promise<void> {
  const target = await getPlayer(db, to);
  const theirs = await db.prepare('SELECT day, time FROM daily_scores WHERE player = ?1')
    .bind(from).all<{ day: string; time: number }>();
  const mine = await db.prepare('SELECT day, time FROM daily_scores WHERE player = ?1')
    .bind(to).all<{ day: string; time: number }>();
  const best = new Map(mine.results.map((r) => [r.day, r.time]));
  const statements = theirs.results.flatMap((r) => {
    const kept = best.get(r.day);
    if (kept !== undefined && kept <= r.time) return [];
    return [
      db.prepare('DELETE FROM daily_scores WHERE day = ?1 AND player = ?2').bind(r.day, to),
      db.prepare('UPDATE daily_scores SET player = ?1, hash = ?2, name = ?3 WHERE day = ?4 AND player = ?5')
        .bind(to, target?.hash ?? '', target?.name || 'Runner', r.day, from),
    ];
  });
  statements.push(
    db.prepare('DELETE FROM daily_scores WHERE player = ?1').bind(from),
    // A player without a name takes the anonymous player's.
    db.prepare(`UPDATE players SET name = (SELECT name FROM players WHERE id = ?1)
      WHERE id = ?2 AND name = ''`).bind(from, to),
    db.prepare('DELETE FROM players WHERE id = ?1 AND claimed = 0').bind(from),
  );
  await db.batch(statements);
}

async function loginVerify(request: Request, db: D1Database): Promise<Response> {
  const input = await body<{ response?: AuthenticationResponseJSON; localPlayer?: unknown }>(request);
  const response = input?.response;
  if (!response?.response) return json({ error: 'Missing passkey response.' }, 400);
  const pending = await takeChallenge(db, response.response.clientDataJSON, 'login');
  if (!pending) return json({ error: 'That request expired. Try again.' }, 400);
  const passkey = await db.prepare('SELECT id, player, public_key, counter, transports FROM passkeys WHERE id = ?1')
    .bind(response.id).first<{ id: string; player: string; public_key: string; counter: number; transports: string | null }>();
  if (!passkey) return json({ error: 'That passkey isn’t saved for any player here.' }, 401);
  const site = siteOf(request);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: site.origin,
      expectedRPID: site.rpID,
      credential: {
        id: passkey.id,
        publicKey: isoBase64URL.toBuffer(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
      },
      requireUserVerification: false,
    });
  } catch (e) {
    logError('passkey sign-in failed', e);
    return json({ error: 'The passkey could not be checked.' }, 401);
  }
  if (!verification.verified) return json({ error: 'The passkey could not be checked.' }, 401);
  await db.prepare('UPDATE passkeys SET counter = ?1, used_at = ?2 WHERE id = ?3')
    .bind(verification.authenticationInfo.newCounter, Date.now(), passkey.id).run();

  const local = String(input?.localPlayer ?? '');
  if (PLAYER_RE.test(local) && local !== passkey.player) {
    const localRow = await getPlayer(db, local);
    if (!localRow?.claimed) await mergeScores(db, local, passkey.player);
  }
  const player = await getPlayer(db, passkey.player);
  const cookie = await startSession(db, passkey.player, site.secure);
  return withCookie(json({
    player: passkey.player,
    hash: player?.hash ?? await playerHash(passkey.player),
    name: player?.name ?? '',
    look: savedLook(player?.look ?? null),
  }), cookie);
}

async function me(request: Request, db: D1Database): Promise<Response> {
  const id = await sessionPlayer(db, request);
  const player = id ? await getPlayer(db, id) : null;
  if (!player) return json({ signedIn: false });
  const count = await db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE player = ?1')
    .bind(player.id).first<{ n: number }>();
  return json({
    signedIn: true,
    player: player.id,
    hash: player.hash,
    name: player.name,
    passkeys: count?.n ?? 0,
    look: savedLook(player.look),
  });
}

/** A stored look, checked (null if none is saved yet). */
function savedLook(stored: string | null) {
  if (!stored) return null;
  try {
    return sanitizeLook(JSON.parse(stored));
  } catch {
    return null;
  }
}

/** Saves the signed-in player's look (customising your runner needs a saved player). */
async function saveLook(request: Request, db: D1Database): Promise<Response> {
  const id = await sessionPlayer(db, request);
  if (!id) return json({ error: 'Save your player with a passkey to customise your runner.' }, 401);
  const input = await body<{ look?: unknown }>(request);
  const look = sanitizeLook(input?.look);
  await db.prepare('UPDATE players SET look = ?1 WHERE id = ?2').bind(JSON.stringify(look), id).run();
  return json({ ok: true, look });
}

async function logout(request: Request, db: D1Database): Promise<Response> {
  return withCookie(json({ ok: true }), await endSession(db, request));
}

type Route = (request: Request, db: D1Database) => Promise<Response>;
const ROUTES: Record<string, Route> = {
  'POST register/options': registerOptions,
  'POST register/verify': registerVerify,
  'POST login/options': loginOptions,
  'POST login/verify': loginVerify,
  'GET me': me,
  'POST look': saveLook,
  'POST logout': logout,
};

export default async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.DB) return json({ error: 'Accounts are not set up on this server.' }, 503);
  const route = ROUTES[`${request.method} ${path}`];
  if (!route) return json({ error: 'Not found' }, 404);
  if (request.method === 'POST' && !(await allowed(env.AUTH_LIMITER, request))) {
    return json({ error: 'Too many attempts from your network. Wait a minute and try again.' }, 429);
  }
  await ensureSchema(env.DB);
  return route(request, env.DB);
}
