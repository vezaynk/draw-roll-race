// Player identity. Each player has a secret random ID (kept in their browser, and tied to their
// passkeys once they save their player) and a public hash of it. The server never sends IDs out,
// only hashes; a browser recognises its own entries by hashing its own ID.

/** Player IDs: UUIDs, or the older random IDs (URL-safe base64). */
export const PLAYER_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Public player hashes: the first 128 bits of SHA-256, in hex. */
export const HASH_RE = /^[0-9a-f]{32}$/;

/** The public hash of a player ID. */
export async function playerHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
