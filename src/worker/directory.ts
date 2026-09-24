// The list of public rooms (a single Durable Object). Rooms add, update and remove their own
// entry; the Worker reads the list for the room browser.
import { DurableObject } from 'cloudflare:workers';
import type { ListedRoom } from '../shared/protocol';
import type { Env } from './env';

/** Entries a room hasn't refreshed in this long are dropped. */
const STALE_MS = 15 * 60 * 1000;
const MAX_LISTED = 50;

type Entry = ListedRoom & { updatedAt: number };

export class Directory extends DurableObject<Env> {
  private rooms: Record<string, Entry> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get<Record<string, Entry>>('rooms')) ?? {};
    });
  }

  async update(entry: ListedRoom): Promise<void> {
    this.rooms[entry.code] = { ...entry, updatedAt: Date.now() };
    await this.ctx.storage.put('rooms', this.rooms);
  }

  async remove(code: string): Promise<void> {
    if (!this.rooms[code]) return;
    delete this.rooms[code];
    await this.ctx.storage.put('rooms', this.rooms);
  }

  /** Rooms waiting in the lobby first, then the fullest. */
  async list(): Promise<ListedRoom[]> {
    const now = Date.now();
    const stale = Object.values(this.rooms).filter((r) => now - r.updatedAt > STALE_MS);
    if (stale.length) {
      stale.forEach((r) => delete this.rooms[r.code]);
      await this.ctx.storage.put('rooms', this.rooms);
    }
    const lobbyFirst = (r: Entry) => (r.phase === 'lobby' ? 0 : 1);
    return Object.values(this.rooms)
      .sort((a, b) => lobbyFirst(a) - lobbyFirst(b)
        || b.players - a.players
        || b.updatedAt - a.updatedAt)
      .slice(0, MAX_LISTED)
      .map(({
        code, name, host, players, phase,
      }) => ({
        code, name, host, players, phase,
      }));
  }
}

export default Directory;
