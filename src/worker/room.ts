// One Durable Object per room. Each browser simulates its own runner and sends its position;
// the room relays positions and drawn limbs, runs the race (lobby → countdown → racing → lobby),
// checks finishes against the course it builds itself, and runs the CPU racers. Public rooms are
// listed in the Directory. Between races the room hibernates, so a quiet room costs nothing.
import { DurableObject } from 'cloudflare:workers';
import buildCourse from '../shared/course/build';
import {
  RANDOM_BASE, STAGES, isTestStage,
} from '../shared/course/stages';
import { isDifficulty } from '../shared/cpu/personality';
import { sanitizeLimbs } from '../shared/limbs';
import {
  EMOTES, MAX_RACERS, RANDOM_COURSE, SAME_COURSE,
} from '../shared/protocol';
import type {
  PlayerInfo, RaceResult, RoomInfo, ServerMessage,
} from '../shared/protocol';
import type { Course, LimbKind } from '../shared/types';
import { finishIsPossible, possibleMove } from '../shared/validation';
import CpuSimulation from './cpuSimulation';
import type { Env } from './env';
import { cleanText, logError } from './http';
import { moderateName } from './moderation';
import {
  freshRoom, hasFinished, isCpuId, isPlayer, wireNumber,
} from './roomState';
import type { Attachment, Player, RoomState } from './roomState';

const COUNTDOWN_MS = 3500;
/** A race ends after this even if someone is stuck. */
const RACE_LIMIT_MS = 4 * 60 * 1000;
/** Once every person is done, CPUs get this long to finish. */
const CPU_GRACE_MS = 10 * 1000;
/** A dropped player can come back as themselves within this. */
const REJOIN_MS = 60 * 1000;
const MAX_MESSAGE = 8 * 1024;
/** Position messages per second per sender. */
const STATE_RATE = 40;
/** Shortest gap between one person's emotes. */
const EMOTE_GAP_MS = 700;
/** Everyone sees themselves in red, so nobody else is ever red. */
const COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e', '#5b6472'];
const CPU_NAMES = ['Bolt', 'Wobble', 'Spoke', 'Zippy', 'Noodle', 'Gizmo', 'Pogo', 'Rusty', 'Dash',
  'Sprocket', 'Doodle', 'Tumble'];
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

type Message = Record<string, unknown> & { type: string };
type Handler = (ws: WebSocket, me: Player, msg: Message) => Promise<void> | void;

/** The player on a connection, or null if it was replaced or is leaving. */
function info(ws: WebSocket): Player | null {
  try {
    const a = ws.deserializeAttachment() as Attachment | null;
    return isPlayer(a) ? a : null;
  } catch {
    return null;
  }
}

function sendTo(ws: WebSocket, msg: ServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function randomInt(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export class RaceRoom extends DurableObject<Env> {
  private room: RoomState = freshRoom();

  /** Sender → { windowStart, count } for rate limiting. */
  private readonly rate = new Map<string, { windowStart: number; count: number }>();

  /** Player id → when they last sent an emote. */
  private readonly lastEmote = new Map<string, number>();

  /** Player id → last position they reported this race. */
  private readonly positions = new Map<string, { x: number; t: number }>();

  private course: Course | null = null;

  private cpus: CpuSimulation | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomState>('room');
      this.room = { ...freshRoom(), ...stored };
      // CPUs live in memory; if the room restarted mid-race they are gone, so end that race.
      if (this.room.phase === 'racing') {
        this.room.phase = 'lobby';
        this.room.results = [];
      }
    });
  }

  // ---------------- RPC from the Worker ----------------

  /** Does the room exist (has people), and is there space? */
  async summary() {
    const people = this.people().length;
    return {
      exists: people > 0,
      name: this.room.name,
      isPublic: this.room.isPublic,
      players: people,
      cpus: this.room.cpus.length,
      phase: this.room.phase,
      full: people >= MAX_RACERS,
    };
  }

  // ---------------- connections ----------------

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const [client, server] = Object.values(new WebSocketPair());
    const tokenParam = url.searchParams.get('token') ?? '';
    const token = TOKEN_RE.test(tokenParam) ? tokenParam : null;
    const { resumed, others } = this.takeOverReconnect(token);

    if (!resumed && others.length >= MAX_RACERS) {
      this.ctx.acceptWebSocket(server);
      sendTo(server, { type: 'error', code: 'full', message: 'This room is full (8 racers).' });
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const player = this.admit(url, token, resumed, others);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player satisfies Attachment);

    sendTo(server, {
      type: 'welcome',
      you: player.id,
      resumed: !!resumed,
      room: this.publicRoom(),
      players: await this.playerList(),
      cpuLimbs: Object.fromEntries(this.cpus?.limbs ?? []),
    });
    const { token: omitted, ...shown } = player;
    this.broadcast({ type: 'join', player: { ...shown, limbs: null }, resumed: !!resumed }, server);
    await this.publish();
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A reconnect with a known token takes over the player's old connection (still open) or their
   * place from when they dropped. Returns that player, and the other people in the room.
   */
  private takeOverReconnect(token: string | null) {
    let others = this.people();
    let resumed: Omit<Player, 'token'> | null = null;
    const now = Date.now();
    if (token) {
      const old = others.find((ws) => info(ws)?.token === token);
      if (old) {
        resumed = info(old);
        old.serializeAttachment({ replaced: true } satisfies Attachment);
        try {
          old.close(4001, 'replaced');
        } catch {
          // already closing
        }
        others = others.filter((ws) => ws !== old);
      } else if (this.room.away[token]?.until > now) {
        resumed = this.room.away[token];
      }
      delete this.room.away[token];
    }
    Object.entries(this.room.away).forEach(([t, away]) => {
      if (away.until <= now) delete this.room.away[t];
    });
    return { resumed, others };
  }

  /** Creates (or restores) the player joining, and the room itself if they are the first. */
  private admit(url: URL, token: string | null, resumed: Omit<Player, 'token'> | null, others: WebSocket[]): Player {
    const { room } = this;
    const player: Player = resumed ? { ...resumed, token } : {
      id: crypto.randomUUID().slice(0, 8),
      name: moderateName(cleanText(url.searchParams.get('name'), 16), `Runner ${room.joins + 1}`),
      color: this.freeColor(),
      joinedAt: Date.now(),
      token,
    };
    if (!resumed) room.joins += 1;
    if (!others.length) {
      // The first one in creates the room and its settings.
      room.code = cleanText(url.pathname.split('/')[3], 5).toUpperCase();
      room.isPublic = url.searchParams.get('public') === '1';
      const roomName = cleanText(url.searchParams.get('room_name'), 24);
      room.name = moderateName(roomName, `${player.name}'s room`);
      room.hostId = player.id;
      room.cpus = [];
    } else if (!others.some((ws) => info(ws)?.id === room.hostId)) {
      room.hostId = player.id;
    }
    if (room.phase === 'lobby' && this.trimCpus(others.length + 1)) {
      this.broadcast({ type: 'cpus', cpus: room.cpus });
    }
    this.save();
    return player;
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg: Message;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = info(ws);
    if (!me || !msg || typeof msg.type !== 'string') return;
    const handler = this.handlers[msg.type];
    if (handler) await handler(ws, me, msg);
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async alarm(): Promise<void> {
    const { room } = this;
    if (room.phase !== 'racing') return;
    const now = Date.now();
    const timeUp = now >= room.startsAt + RACE_LIMIT_MS - 1000;
    const graceOver = room.graceUntil > 0 && now >= room.graceUntil - 50;
    if (timeUp || graceOver) await this.endRace();
  }

  // ---------------- messages ----------------

  private readonly handlers: Record<string, Handler> = {
    state: (ws, me, msg) => {
      // Hot path: relay only. Remember the position so finishes can be checked.
      const { room } = this;
      if (room.phase !== 'racing' || msg.r !== room.raceId || !this.allow(me.id)) return;
      const x = wireNumber(msg.x);
      this.trackPosition(me.id, x);
      this.broadcast({
        type: 'state', id: me.id, x, y: wireNumber(msg.y), a: wireNumber(msg.a), b: wireNumber(msg.b),
      }, ws);
    },

    limbs: async (ws, me, msg) => {
      const limbs = sanitizeLimbs(msg.limbs);
      if (!limbs) return;
      const lost = Array.isArray(msg.lost)
        ? msg.lost.filter((k): k is LimbKind => k === 'arm' || k === 'leg')
        : undefined;
      await this.ctx.storage.put(`limbs:${me.id}`, limbs);
      this.broadcast({
        type: 'limbs', id: me.id, limbs, lost,
      }, ws);
    },

    name: async (ws, me, msg) => {
      const name = moderateName(cleanText(msg.name, 16), null);
      if (!name) {
        sendTo(ws, { type: 'notice', message: 'That name isn’t allowed. Try another one.' });
        return;
      }
      ws.serializeAttachment({ ...me, name } satisfies Attachment);
      this.broadcast({ type: 'name', id: me.id, name });
      await this.publish();
    },

    settings: async (_ws, me, msg) => {
      const { room } = this;
      if (me.id !== room.hostId) return;
      if (typeof msg.isPublic === 'boolean') room.isPublic = msg.isPublic;
      const name = moderateName(cleanText(msg.name, 24), null);
      if (name) room.name = name;
      if (Number.isInteger(msg.nextStage)) room.nextStage = Number(msg.nextStage);
      this.save();
      this.broadcast({
        type: 'settings', isPublic: room.isPublic, name: room.name, nextStage: room.nextStage,
      });
      await this.publish();
    },

    addCpu: async (_ws, me, msg) => {
      const { room } = this;
      if (me.id !== room.hostId || room.phase !== 'lobby') return;
      if (this.people().length + room.cpus.length >= MAX_RACERS) return;
      const used = new Set(room.cpus.map((c) => c.name));
      const free = CPU_NAMES.filter((n) => !used.has(n));
      room.cpuSerial += 1;
      room.cpus.push({
        id: `cpu-${room.cpuSerial}`,
        name: free.length ? free[randomInt() % free.length] : `CPU ${room.cpuSerial}`,
        color: this.freeColor(),
        difficulty: isDifficulty(msg.difficulty) ? msg.difficulty : 'normal',
        seed: randomInt(),
      });
      this.save();
      this.broadcast({ type: 'cpus', cpus: room.cpus });
      await this.publish();
    },

    removeCpu: async (_ws, me, msg) => {
      const { room } = this;
      if (me.id !== room.hostId || room.phase !== 'lobby') return;
      const before = room.cpus.length;
      room.cpus = room.cpus.filter((c) => c.id !== msg.id);
      if (room.cpus.length === before) return;
      this.save();
      this.broadcast({ type: 'cpus', cpus: room.cpus });
      await this.publish();
    },

    start: async (_ws, me, msg) => {
      if (me.id !== this.room.hostId || this.room.phase !== 'lobby') return;
      await this.startRace(msg.stage);
    },

    ready: async (_ws, me, msg) => {
      const { room } = this;
      if (room.phase !== 'lobby') return;
      const others = room.ready.filter((id) => id !== me.id);
      room.ready = msg.ready === true ? [...others, me.id] : others;
      this.save();
      this.broadcast({ type: 'ready', ids: room.ready });
      await this.startIfAllReady();
    },

    emote: (ws, me, msg) => {
      const e = Number(msg.e);
      const now = Date.now();
      if (!Number.isInteger(e) || e < 0 || e >= EMOTES.length) return;
      if (now - (this.lastEmote.get(me.id) ?? 0) < EMOTE_GAP_MS) return;
      this.lastEmote.set(me.id, now);
      this.broadcast({ type: 'emote', id: me.id, e }, ws);
    },

    finish: async (ws, me, msg) => {
      const { room } = this;
      if (room.phase !== 'racing' || msg.r !== room.raceId) return;
      const course = this.course ?? buildCourse(room.stage);
      const elapsed = (Date.now() - room.startsAt) / 1000;
      if (!finishIsPossible(course, elapsed, Number(msg.time), this.positions.get(me.id)?.x)) {
        sendTo(ws, { type: 'notice', message: 'The room couldn’t confirm that finish, so it wasn’t counted.' });
        return;
      }
      await this.record(me, Number(msg.time));
    },

    giveup: async (_ws, me, msg) => {
      if (this.room.phase !== 'racing' || msg.r !== this.room.raceId) return;
      await this.record(me, null);
    },
  };

  // ---------------- leaving ----------------

  private async leave(ws: WebSocket): Promise<void> {
    const me = info(ws);
    if (!me) return; // replaced by a reconnect of the same tab
    ws.serializeAttachment({ left: true } satisfies Attachment);
    try {
      ws.close(1000, 'bye');
    } catch {
      // already closed
    }
    this.rate.delete(me.id);
    this.lastEmote.delete(me.id);
    const rest = this.people().filter((s) => s !== ws);
    if (!rest.length) {
      await this.closeRoom();
      return;
    }
    // Keep their place for a while in case they come back (a dropped connection, a reload).
    if (me.token) {
      this.room.away[me.token] = {
        id: me.id,
        name: me.name,
        color: me.color,
        joinedAt: me.joinedAt,
        until: Date.now() + REJOIN_MS,
      };
    }
    if (this.room.hostId === me.id) {
      const [longest] = rest.map((s) => info(s)).filter(isPlayer)
        .sort((a, b) => a.joinedAt - b.joinedAt);
      this.room.hostId = longest.id;
    }
    const wasReady = this.room.ready.includes(me.id);
    this.room.ready = this.room.ready.filter((id) => id !== me.id);
    this.save();
    this.broadcast({ type: 'leave', id: me.id, hostId: this.room.hostId }, ws);
    if (wasReady) this.broadcast({ type: 'ready', ids: this.room.ready }, ws);
    await this.publish(ws);
    await this.maybeEndRace(ws);
    await this.startIfAllReady(ws);
  }

  /** The last person left: forget everything and leave the directory. */
  private async closeRoom(): Promise<void> {
    const { code } = this.room;
    this.stopCpus();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.room = freshRoom();
    if (code) {
      try {
        await this.directory().remove(code);
      } catch (e) {
        logError('directory remove failed', e);
      }
    }
  }

  // ---------------- race ----------------

  private pickStage(asked: unknown): number {
    const stage = Number.isInteger(asked) ? Number(asked) : 0;
    if (stage === SAME_COURSE) return this.room.raceId > 0 ? this.room.stage : 0;
    if (stage === RANDOM_COURSE || stage < 0) return RANDOM_BASE + (randomInt() % 1000000);
    if (isTestStage(stage)) return this.env.ALLOW_TEST_STAGES === '1' ? stage : 0;
    if (stage >= STAGES.length && stage < RANDOM_BASE) return 0;
    return stage;
  }

  /** Counts down to a race on the asked course, with everyone here. */
  private async startRace(asked: unknown): Promise<void> {
    const { room } = this;
    room.stage = this.pickStage(asked);
    const people = this.people();
    this.trimCpus(people.length);
    room.phase = 'racing';
    room.raceId += 1;
    room.startsAt = Date.now() + COUNTDOWN_MS;
    room.results = [];
    room.graceUntil = 0;
    room.ready = [];
    room.participants = people.map((s) => info(s)?.id ?? '').filter(Boolean)
      .concat(room.cpus.map((c) => c.id));
    this.save();
    await this.ctx.storage.setAlarm(room.startsAt + RACE_LIMIT_MS);
    this.positions.clear();
    this.startCpus();
    this.broadcast({
      type: 'countdown',
      raceId: room.raceId,
      stage: room.stage,
      ms: COUNTDOWN_MS,
      participants: room.participants,
      cpus: room.cpus,
    });
    await this.publish();
  }

  /** Everyone in the lobby said they are ready: start the next race on the host's course. */
  private async startIfAllReady(gone?: WebSocket): Promise<void> {
    const { room } = this;
    if (room.phase !== 'lobby' || !room.ready.length) return;
    const here = this.people().filter((s) => s !== gone).map((s) => info(s)?.id);
    if (here.length && here.every((id) => id && room.ready.includes(id))) {
      await this.startRace(room.nextStage);
    }
  }

  private startCpus(): void {
    this.stopCpus();
    this.course = buildCourse(this.room.stage);
    this.cpus = new CpuSimulation(this.course, this.room.cpus, this.room.startsAt, {
      limbs: (id, limbs, pose, lost) => this.broadcast({
        type: 'limbs', id, limbs, pose, lost,
      }),
      positions: (s) => this.broadcast({ type: 'cpuStates', s }),
      finished: (id, time) => {
        const cpu = this.room.cpus.find((c) => c.id === id);
        if (cpu) this.record(cpu, time).catch((e) => logError('cpu finish failed', e));
      },
    });
    this.cpus.start();
  }

  private stopCpus(): void {
    this.cpus?.stop();
  }

  /** Ignores positions that jump faster than any runner can move, so they can't reach the line. */
  private trackPosition(id: string, x: number): void {
    const t = Date.now();
    const last = this.positions.get(id);
    if (last && !possibleMove(last.x, last.t / 1000, x, t / 1000, 150)) return;
    this.positions.set(id, { x, t });
  }

  private async record(
    racer: { id: string; name: string; color: string },
    claimed: number | null,
  ): Promise<void> {
    const { room } = this;
    if (!room.participants.includes(racer.id) || hasFinished(room, racer.id)) return;
    let time: number | null = null;
    if (claimed !== null) {
      // The sender's clock says how long it raced; the room's clock bounds it.
      const elapsed = (Date.now() - room.startsAt) / 1000;
      const believable = Number.isFinite(claimed) && Math.abs(claimed - elapsed) <= 2;
      time = believable ? claimed : Math.max(0, elapsed);
      time = Math.round(time * 100) / 100;
    }
    const result: RaceResult = {
      id: racer.id, name: racer.name, color: racer.color, time, cpu: isCpuId(racer.id),
    };
    room.results.push(result);
    this.save();
    const place = time === null ? null : room.results.filter((r) => r.time !== null).length;
    this.broadcast({
      type: 'result', raceId: room.raceId, result, place,
    });
    await this.maybeEndRace();
  }

  /**
   * The race ends when every person in it has finished or given up. CPUs still running then get
   * CPU_GRACE_MS to finish, so a room of fast people doesn't wait on a stuck CPU.
   */
  private async maybeEndRace(gone?: WebSocket): Promise<void> {
    const { room } = this;
    if (room.phase !== 'racing') return;
    const here = new Set(this.people().filter((s) => s !== gone).map((s) => info(s)?.id));
    const peopleRacing = room.participants.filter((id) => here.has(id) && !hasFinished(room, id));
    if (peopleRacing.length) return;
    const cpusRacing = room.participants.filter((id) => isCpuId(id) && !hasFinished(room, id));
    if (!cpusRacing.length || !here.size || !this.cpus?.running) {
      await this.endRace();
      return;
    }
    if (!room.graceUntil) {
      room.graceUntil = Date.now() + CPU_GRACE_MS;
      this.save();
      await this.ctx.storage.setAlarm(room.graceUntil);
    }
  }

  private async endRace(): Promise<void> {
    const { room } = this;
    this.stopCpus();
    room.phase = 'lobby';
    room.graceUntil = 0;
    // CPUs that never finished are listed as such.
    room.participants.forEach((id) => {
      const cpu = room.cpus.find((c) => c.id === id);
      if (cpu && !hasFinished(room, id)) {
        room.results.push({
          id, name: cpu.name, color: cpu.color, time: null, cpu: true, dnf: true,
        });
      }
    });
    room.lastResults = room.results;
    room.results = [];
    this.trimCpus(this.people().length);
    this.save();
    await this.ctx.storage.deleteAlarm();
    this.broadcast({
      type: 'raceEnd', raceId: room.raceId, results: room.lastResults, hostId: room.hostId, cpus: room.cpus,
    });
    this.writeStats();
    await this.publish();
  }

  /** Race numbers for Workers Analytics Engine (only when the binding exists). */
  private writeStats(): void {
    const { room } = this;
    const people = room.lastResults.filter((r) => !r.cpu);
    const times = people.map((r) => r.time).filter((t): t is number => t !== null);
    const mean = times.length ? times.reduce((a, t) => a + t, 0) / times.length : 0;
    this.env.STATS?.writeDataPoint({
      blobs: ['race', room.stage >= RANDOM_BASE ? 'random' : String(room.stage)],
      doubles: [people.length, room.lastResults.length - people.length, times.length, mean],
      indexes: ['race'],
    });
  }

  // ---------------- directory ----------------

  private directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('public-rooms'));
  }

  private async publish(gone?: WebSocket): Promise<void> {
    const { room } = this;
    if (!room.code) return;
    const people = this.people().filter((s) => s !== gone);
    try {
      if (room.isPublic && people.length) {
        const host = people.map((s) => info(s)).find((p) => p?.id === room.hostId);
        await this.directory().update({
          code: room.code,
          name: room.name,
          host: host?.name ?? '',
          players: people.length,
          cpus: room.cpus.length,
          phase: room.phase,
        });
      } else {
        await this.directory().remove(room.code);
      }
    } catch (e) {
      // The listing is best effort; the room works without it.
      logError('directory update failed', e);
    }
  }

  // ---------------- helpers ----------------

  /** Open connections that belong to a player (not replaced, not leaving). */
  private people(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => info(ws));
  }

  /** Drops CPUs (newest first) until people and CPUs fit. Returns true if any were dropped. */
  private trimCpus(people: number): boolean {
    const keep = Math.max(0, MAX_RACERS - people);
    if (this.room.cpus.length <= keep) return false;
    this.room.cpus = this.room.cpus.slice(0, keep);
    return true;
  }

  private freeColor(): string {
    const used = new Set(this.people().map((ws) => info(ws)?.color)
      .concat(this.room.cpus.map((c) => c.color)));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[this.room.joins % COLORS.length];
  }

  private publicRoom(): RoomInfo {
    const {
      code, name, isPublic, phase, stage, raceId, hostId, participants, results, lastResults, cpus,
      ready, nextStage,
    } = this.room;
    return {
      code, name, isPublic, phase, stage, raceId, hostId, participants, results, lastResults, cpus,
      ready, nextStage,
    };
  }

  private async playerList(): Promise<PlayerInfo[]> {
    const players = this.people().map((ws) => info(ws)).filter(isPlayer);
    return Promise.all(players.map(async ({ token, ...p }) => ({
      ...p,
      limbs: (await this.ctx.storage.get(`limbs:${p.id}`)) ?? null,
    })));
  }

  private allow(key: string): boolean {
    const now = Date.now();
    let r = this.rate.get(key);
    if (!r || now - r.windowStart >= 1000) {
      r = { windowStart: now, count: 0 };
      this.rate.set(key, r);
    }
    r.count += 1;
    return r.count <= STATE_RATE;
  }

  private broadcast(msg: ServerMessage, except?: WebSocket): void {
    const text = JSON.stringify(msg);
    this.people().forEach((ws) => {
      if (ws === except) return;
      try {
        ws.send(text);
      } catch {
        // closing
      }
    });
  }

  private save(): void {
    this.ctx.storage.put('room', this.room).catch((e) => logError('room save failed', e));
  }
}

export default RaceRoom;
