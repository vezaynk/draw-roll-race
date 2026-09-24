// Draw Roll Race — one Durable Object per room.
//
// Each browser simulates its own runner; the room relays positions and drawn limbs,
// runs the race lifecycle (lobby -> racing -> lobby) and checks finish times.
// Uses the WebSocket hibernation API, so a quiet room costs nothing.
import { DurableObject } from 'cloudflare:workers';

const MAX_PLAYERS = 8;
const COUNTDOWN_MS = 3500;          // clients count down 3-2-1 from receipt
const RACE_LIMIT_MS = 4 * 60 * 1000; // a race ends after this even if someone is stuck
const MAX_MESSAGE = 8 * 1024;
const STATE_RATE = 40;              // max position updates per second per player
// Everyone sees themselves in red, so other players never get red.
const COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e', '#5b6472'];
const FIXED_STAGES = 3;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').trim().slice(0, max);

export class RaceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map(); // player id -> { windowStart, count }; fine to lose on hibernation
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || freshRoom();
    });
  }

  // ---------------- connections ----------------
  async fetch(request) {
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_PLAYERS) {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'error', code: 'full', message: 'This room is full (8 players).' }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const used = new Set(sockets.map(ws => this.info(ws)?.color));
    const player = {
      id: crypto.randomUUID().slice(0, 8),
      name: clean(url.searchParams.get('name'), 16) || 'Runner ' + (this.room.joins + 1),
      color: COLORS.find(c => !used.has(c)) || COLORS[this.room.joins % COLORS.length],
      joinedAt: Date.now(),
    };
    this.room.joins++;
    if (!this.room.hostId || !sockets.some(ws => this.info(ws)?.id === this.room.hostId)) this.room.hostId = player.id;
    await this.save();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player);

    server.send(JSON.stringify({
      type: 'welcome',
      you: player.id,
      room: this.publicRoom(),
      players: await this.playerList(),
    }));
    this.broadcast({ type: 'join', player: { ...player, limbs: null } }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = this.info(ws);
    if (!me || !msg || typeof msg.type !== 'string') return;
    const room = this.room;

    switch (msg.type) {
      case 'state': {
        // Hot path: relay only, never stored.
        if (room.phase !== 'racing' || msg.r !== room.raceId || !this.allow(me.id)) return;
        const num = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
        this.broadcast({ type: 'state', id: me.id, x: num(msg.x), y: num(msg.y), a: num(msg.a), b: num(msg.b) }, ws);
        return;
      }
      case 'limbs': {
        const limbs = cleanLimbs(msg.limbs);
        if (!limbs) return;
        await this.ctx.storage.put('limbs:' + me.id, limbs);
        this.broadcast({ type: 'limbs', id: me.id, limbs }, ws);
        return;
      }
      case 'name': {
        const name = clean(msg.name, 16);
        if (!name) return;
        me.name = name;
        ws.serializeAttachment(me);
        this.broadcast({ type: 'name', id: me.id, name });
        return;
      }
      case 'start': {
        if (me.id !== room.hostId || room.phase !== 'lobby') return;
        let stage = Number.isInteger(msg.stage) ? msg.stage : 0;
        if (stage < 0) stage = FIXED_STAGES + Math.floor(Math.random() * 60); // random course
        stage = Math.max(0, Math.min(FIXED_STAGES + 60, stage));
        room.phase = 'racing';
        room.raceId++;
        room.stage = stage;
        room.startsAt = Date.now() + COUNTDOWN_MS;
        room.results = [];
        room.participants = this.ctx.getWebSockets().map(s => this.info(s)?.id).filter(Boolean);
        await this.save();
        await this.ctx.storage.setAlarm(room.startsAt + RACE_LIMIT_MS);
        this.broadcast({ type: 'countdown', raceId: room.raceId, stage, ms: COUNTDOWN_MS, participants: room.participants });
        return;
      }
      case 'finish':
      case 'giveup': {
        if (room.phase !== 'racing' || msg.r !== room.raceId) return;
        if (!room.participants.includes(me.id) || room.results.some(r => r.id === me.id)) return;
        let time = null;
        if (msg.type === 'finish') {
          // The client's clock says how long it raced; the room's clock bounds it.
          const elapsed = (Date.now() - room.startsAt) / 1000;
          time = Number(msg.time);
          if (!Number.isFinite(time) || time < elapsed - 2 || time > elapsed + 2) time = Math.max(0, elapsed);
          time = Math.round(time * 100) / 100;
        }
        const result = { id: me.id, name: me.name, color: me.color, time };
        room.results.push(result);
        await this.save();
        this.broadcast({ type: 'result', raceId: room.raceId, result, place: time === null ? null : room.results.filter(r => r.time !== null).length });
        await this.maybeEndRace();
        return;
      }
    }
  }

  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }

  async leave(ws) {
    const me = this.info(ws);
    if (!me) return;
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    this.rate.delete(me.id);
    await this.ctx.storage.delete('limbs:' + me.id);
    const rest = this.ctx.getWebSockets().filter(s => s !== ws && this.info(s));
    if (!rest.length) {
      // Empty room: forget everything.
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.room = freshRoom();
      return;
    }
    if (this.room.hostId === me.id) {
      const next = rest.map(s => this.info(s)).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.room.hostId = next.id;
    }
    await this.save();
    this.broadcast({ type: 'leave', id: me.id, hostId: this.room.hostId }, ws);
    await this.maybeEndRace(ws);
  }

  async alarm() {
    if (this.room.phase === 'racing' && Date.now() >= this.room.startsAt + RACE_LIMIT_MS - 1000) await this.endRace();
  }

  // ---------------- race lifecycle ----------------
  // `gone` is a socket that is closing but may still be listed.
  async maybeEndRace(gone) {
    const room = this.room;
    if (room.phase !== 'racing') return;
    const here = new Set(this.ctx.getWebSockets().filter(s => s !== gone).map(s => this.info(s)?.id));
    const waiting = room.participants.filter(id => here.has(id) && !room.results.some(r => r.id === id));
    if (!waiting.length) await this.endRace();
  }

  async endRace() {
    const room = this.room;
    room.phase = 'lobby';
    room.lastResults = room.results;
    room.results = [];
    await this.save();
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ type: 'raceEnd', raceId: room.raceId, results: room.lastResults, hostId: room.hostId });
  }

  // ---------------- helpers ----------------
  info(ws) {
    try { return ws.deserializeAttachment(); } catch { return null; }
  }

  publicRoom() {
    const r = this.room;
    return {
      phase: r.phase, stage: r.stage, raceId: r.raceId, hostId: r.hostId,
      participants: r.participants, results: r.results, lastResults: r.lastResults,
      msIntoRace: r.phase === 'racing' ? Date.now() - r.startsAt : null,
    };
  }

  async playerList() {
    const out = [];
    for (const ws of this.ctx.getWebSockets()) {
      const p = this.info(ws);
      if (!p) continue;
      out.push({ ...p, limbs: (await this.ctx.storage.get('limbs:' + p.id)) || null });
    }
    return out;
  }

  allow(id) {
    const now = Date.now();
    let r = this.rate.get(id);
    if (!r || now - r.windowStart >= 1000) { r = { windowStart: now, count: 0 }; this.rate.set(id, r); }
    return ++r.count <= STATE_RATE;
  }

  broadcast(msg, except) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(text); } catch { /* closing */ }
    }
  }

  save() { return this.ctx.storage.put('room', this.room); }
}

function freshRoom() {
  return { phase: 'lobby', stage: 0, raceId: 0, startsAt: 0, hostId: null, joins: 0, participants: [], results: [], lastResults: [] };
}

// Limbs arrive as { arm: [flat xy array] | [], leg: [...] } in pad coordinates.
function cleanLimbs(limbs) {
  if (!limbs || typeof limbs !== 'object') return null;
  const out = {};
  for (const k of ['arm', 'leg']) {
    const v = limbs[k];
    if (!Array.isArray(v) || v.length > 1) return null;
    out[k] = [];
    for (const flat of v) {
      if (!Array.isArray(flat) || flat.length < 4 || flat.length > 240 || flat.length % 2) return null;
      if (!flat.every(n => Number.isFinite(n) && n > -200 && n < 600)) return null;
      out[k].push(flat.map(n => Math.round(n)));
    }
  }
  return out;
}
