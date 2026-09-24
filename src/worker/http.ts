import type { RateLimiter } from './env';

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Control and invisible formatting characters, which have no place in names. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g;

/** Text from a player: hidden characters removed, trimmed, cut to max characters. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(HIDDEN, '').trim().slice(0, max);
}

/** Rate limit keyed by the caller's IP. Without the binding (local runs), everything is allowed. */
export async function allowed(
  limiter: RateLimiter | undefined,
  request: Request,
): Promise<boolean> {
  if (!limiter) return true;
  const key = request.headers.get('CF-Connecting-IP') || 'local';
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

/** Logs to Workers Observability. */
export function logError(what: string, error: unknown): void {
  // eslint-disable-next-line no-console -- console is how Workers logs reach Observability
  console.error(what, error);
}
