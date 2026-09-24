// Draw Roll Race — Worker entry point.
// Static files come from ./public (see wrangler.jsonc); this handles /api/*.
import { RaceRoom } from './room.js';

export { RaceRoom };

// No 0/O/1/I/L so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[1] === 'health') return json({ ok: true });

    if (parts[1] === 'rooms' && parts.length === 2 && request.method === 'POST') {
      return json({ code: newCode() });
    }

    // /api/rooms/:code/ws
    if (parts[1] === 'rooms' && parts[3] === 'ws' && parts.length === 4) {
      const code = parts[2].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: 'Room codes are 5 letters or digits.' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket upgrade.' }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    return json({ error: 'Not found' }, 404);
  },
};
