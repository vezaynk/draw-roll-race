// The Worker: static files come from ./public (see wrangler.jsonc); this handles /api/*.
import { CODE_ALPHABET, CODE_RE } from '../shared/protocol';
import handleDaily from './daily';
import { Directory } from './directory';
import type { Env } from './env';
import { allowed, json } from './http';
import { RaceRoom } from './room';
import { RunCheck } from './runCheck';

export { Directory, RaceRoom, RunCheck };

function newCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(5))]
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('');
}

const roomStub = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

/** POST /api/rooms: a fresh, unused room code. */
async function createRoomCode(request: Request, env: Env): Promise<Response> {
  if (!(await allowed(env.CREATE_LIMITER, request))) {
    return json({ error: 'Too many new rooms from your network. Wait a minute and try again.' }, 429);
  }
  const codes = Array.from({ length: 5 }, newCode);
  const summaries = await Promise.all(codes.map((code) => roomStub(env, code).summary()));
  const free = codes.find((_candidate, i) => !summaries[i].exists);
  return free ? json({ code: free }) : json({ error: 'Could not find a free room code. Try again.' }, 503);
}

/** GET /api/rooms: public rooms. */
async function listRooms(env: Env): Promise<Response> {
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName('public-rooms'));
  return json({ rooms: await directory.list() });
}

/** /api/rooms/:code (does it exist, is there space) and /api/rooms/:code/ws (join). */
async function room(request: Request, env: Env, parts: string[]): Promise<Response> {
  const code = parts[2].toUpperCase();
  if (!CODE_RE.test(code)) return json({ error: 'Room codes are 5 letters or digits.' }, 400);
  if (parts.length === 3) return json(await roomStub(env, code).summary());
  if (parts[3] === 'ws' && parts.length === 4) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'Expected a WebSocket upgrade.' }, 426);
    }
    return roomStub(env, code).fetch(request);
  }
  return json({ error: 'Not found' }, 404);
}

async function daily(request: Request, env: Env): Promise<Response> {
  if (request.method === 'POST' && !(await allowed(env.SUBMIT_LIMITER, request))) {
    return json({ error: 'Too many runs sent from your network. Wait a minute and try again.' }, 429);
  }
  return handleDaily(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['api', ...]
    const [, what] = parts;
    if (what === 'health') return json({ ok: true, daily: !!env.DB });
    if (what === 'daily' && parts.length === 2) return daily(request, env);
    if (what === 'daily' && parts[2] === 'leader' && parts.length === 3) return handleDaily(request, env);
    if (what === 'rooms' && parts.length === 2) {
      return request.method === 'POST' ? createRoomCode(request, env) : listRooms(env);
    }
    if (what === 'rooms' && parts.length >= 3) return room(request, env, parts);
    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
