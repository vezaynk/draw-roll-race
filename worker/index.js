// Draw Roll Race — Worker entry point.
// Static files come from ./public (see wrangler.jsonc); this handles /api/*.
import { RaceRoom } from './room.js';
import { Directory } from './directory.js';
import { handleDaily } from './daily.js';

export { RaceRoom, Directory };

// No 0/O/1/I/L so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const room = (env, code) => env.ROOMS.get(env.ROOMS.idFromName(code));

// Workers Rate Limiting binding, keyed by the caller's IP. Without the binding, everything is allowed.
async function allowed(limiter, request) {
  if (!limiter) return true;
  const key = request.headers.get('CF-Connecting-IP') || 'local';
  try { return (await limiter.limit({ key })).success; } catch { return true; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[1] === 'health') return json({ ok: true, daily: !!env.DB });

    if (parts[1] === 'daily' && parts.length === 2) {
      if (request.method === 'POST' && !(await allowed(env.SUBMIT_LIMITER, request))) {
        return json({ error: 'Too many runs sent from your network. Wait a minute and try again.' }, 429);
      }
      return handleDaily(request, env);
    }

    if (parts[1] === 'rooms' && parts.length === 2) {
      // POST: a fresh, unused code for a new room. GET: public rooms.
      if (request.method === 'POST') {
        if (!(await allowed(env.CREATE_LIMITER, request))) {
          return json({ error: 'Too many new rooms from your network. Wait a minute and try again.' }, 429);
        }
        for (let tries = 0; tries < 5; tries++) {
          const code = newCode();
          if (!(await room(env, code).summary()).exists) return json({ code });
        }
        return json({ error: 'Could not find a free room code. Try again.' }, 503);
      }
      const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('public-rooms'));
      return json({ rooms: await dir.list() });
    }

    if (parts[1] === 'rooms' && parts.length >= 3) {
      const code = parts[2].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'Room codes are 5 letters or digits.' }, 400);

      // /api/rooms/:code -> does it exist, is there space
      if (parts.length === 3) return json(await room(env, code).summary());

      // /api/rooms/:code/ws -> join
      if (parts[3] === 'ws' && parts.length === 4) {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade.' }, 426);
        return room(env, code).fetch(request);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
