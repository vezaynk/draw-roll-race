// Draw Roll Race — the list of public rooms (a single Durable Object).
// Rooms add, update and remove their own entry; the Worker reads the list for the room browser.
import { DurableObject } from 'cloudflare:workers';

const STALE_MS = 15 * 60 * 1000; // drop entries a room hasn't refreshed in this long
const MAX_LISTED = 50;

export class Directory extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.rooms = (await ctx.storage.get('rooms')) || {};
    });
  }

  async update(entry) {
    this.rooms[entry.code] = { ...entry, updatedAt: Date.now() };
    await this.ctx.storage.put('rooms', this.rooms);
  }

  async remove(code) {
    if (!this.rooms[code]) return;
    delete this.rooms[code];
    await this.ctx.storage.put('rooms', this.rooms);
  }

  async list() {
    const now = Date.now();
    let pruned = false;
    for (const [code, r] of Object.entries(this.rooms)) {
      if (now - r.updatedAt > STALE_MS) { delete this.rooms[code]; pruned = true; }
    }
    if (pruned) await this.ctx.storage.put('rooms', this.rooms);
    // Rooms waiting in the lobby with space first, then fullest first.
    return Object.values(this.rooms)
      .sort((a, b) => (a.phase === 'lobby' ? 0 : 1) - (b.phase === 'lobby' ? 0 : 1) || b.players - a.players || b.updatedAt - a.updatedAt)
      .slice(0, MAX_LISTED)
      .map(({ code, name, host, players, cpus, phase }) => ({ code, name, host, players, cpus, phase }));
  }
}
