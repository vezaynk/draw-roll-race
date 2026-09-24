// Draw Roll Race — one Durable Object per room.
//
// Each browser simulates its own runner; the room relays positions and drawn limbs,
// runs the race lifecycle (lobby -> racing -> lobby) and checks finish times.
// CPU racers fill open slots: the room keeps their settings, the host's browser runs them.
// Public rooms are listed in the Directory. Uses WebSocket hibernation, so a quiet room costs nothing.
import { DurableObject } from 'cloudflare:workers';

export const MAX_RACERS = 8;        // people + CPUs
const COUNTDOWN_MS = 3500;          // clients count down 3-2-1 from receipt
const RACE_LIMIT_MS = 4 * 60 * 1000; // a race ends after this even if someone is stuck
const CPU_GRACE_MS = 10 * 1000;     // once every person is done, CPUs get this long to finish
const MAX_MESSAGE = 8 * 1024;
const STATE_RATE = 40;              // max position messages per second per sender
// Everyone sees themselves in red, so nobody else is ever red.
const COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e', '#5b6472'];
const CPU_NAMES = ['Bolt', 'Wobble', 'Spoke', 'Zippy', 'Noodle', 'Gizmo', 'Pogo', 'Rusty', 'Dash', 'Sprocket', 'Doodle', 'Tumble'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const FIXED_STAGES = 3;
const RANDOM_BASE = 1000;           // stage numbers from here up are generated courses (see physics.js)

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, max);

export class RaceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map(); // sender -> { windowStart, count }; fine to lose on hibernation
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || freshRoom();
    });
  }

  // ---------------- RPC from the Worker ----------------
  async summary() {
    const humans = this.humans();
    return {
      exists: humans.length > 0,
      name: this.room.name, isPublic: this.room.isPublic,
      players: humans.length, cpus: this.room.cpus.length, phase: this.room.phase,
      full: humans.length >= MAX_RACERS,
    };
  }

  // ---------------- connections ----------------
  async fetch(request) {
    const url = new URL(request.url);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const room = this.room;

    const sockets = this.humans();
    if (sockets.length >= MAX_RACERS) {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'error', code: 'full', message: 'This room is full (8 racers).' }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const player = {
      id: crypto.randomUUID().slice(0, 8),
      name: clean(url.searchParams.get('name'), 16) || 'Runner ' + (room.joins + 1),
      color: this.freeColor(),
      joinedAt: Date.now(),
    };
    room.joins++;
    if (!sockets.length) {
      // First one in creates the room and its settings.
      room.code = clean(url.pathname.split('/')[3], 5).toUpperCase();
      room.isPublic = url.searchParams.get('public') === '1';
      room.name = clean(url.searchParams.get('room_name'), 24) || player.name + "'s room";
      room.hostId = player.id;
      room.cpus = [];
    } else if (!sockets.some(ws => this.info(ws)?.id === room.hostId)) {
      room.hostId = player.id;
    }
    const trimmed = room.phase === 'lobby' && this.trimCpus(sockets.length + 1);
    await this.save();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player);

    server.send(JSON.stringify({ type: 'welcome', you: player.id, room: this.publicRoom(), players: await this.playerList(), cpuLimbs: await this.cpuLimbs() }));
    this.broadcast({ type: 'join', player: { ...player, limbs: null } }, server);
    if (trimmed) this.broadcast({ type: 'cpus', cpus: room.cpus }, server);
    await this.publish();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = this.info(ws);
    if (!me || !msg || typeof msg.type !== 'string') return;
    const room = this.room;
    const isHost = me.id === room.hostId;

    switch (msg.type) {
      case 'state': {
        // Hot path: relay only, never stored.
        if (room.phase !== 'racing' || msg.r !== room.raceId || !this.allow(me.id)) return;
        this.broadcast({ type: 'state', id: me.id, x: num(msg.x), y: num(msg.y), a: num(msg.a), b: num(msg.b) }, ws);
        return;
      }
      case 'cpuStates': {
        // The host runs the CPUs and sends all their positions in one message.
        if (!isHost || room.phase !== 'racing' || msg.r !== room.raceId || !Array.isArray(msg.s) || !this.allow('cpus')) return;
        const ids = new Set(room.cpus.map(c => c.id));
        const s = msg.s.filter(e => Array.isArray(e) && ids.has(e[0])).slice(0, MAX_RACERS)
          .map(e => [e[0], num(e[1]), num(e[2]), num(e[3]), num(e[4])]);
        this.broadcast({ type: 'cpuStates', s }, ws);
        return;
      }
      case 'limbs': {
        const limbs = cleanLimbs(msg.limbs);
        if (!limbs) return;
        await this.ctx.storage.put('limbs:' + me.id, limbs);
        this.broadcast({ type: 'limbs', id: me.id, limbs }, ws);
        return;
      }
      case 'cpuLimbs': {
        const cpu = room.cpus.find(c => c.id === msg.id);
        const limbs = cleanLimbs(msg.limbs);
        if (!isHost || !cpu || !limbs) return;
        cpu.pose = clean(msg.pose, 12);
        await this.ctx.storage.put('limbs:' + cpu.id, limbs);
        await this.save();
        this.broadcast({ type: 'limbs', id: cpu.id, limbs, pose: cpu.pose }, ws);
        return;
      }
      case 'name': {
        const name = clean(msg.name, 16);
        if (!name) return;
        me.name = name;
        ws.serializeAttachment(me);
        this.broadcast({ type: 'name', id: me.id, name });
        await this.publish();
        return;
      }
      case 'settings': {
        if (!isHost) return;
        if (typeof msg.isPublic === 'boolean') room.isPublic = msg.isPublic;
        const name = clean(msg.name, 24);
        if (name) room.name = name;
        await this.save();
        this.broadcast({ type: 'settings', isPublic: room.isPublic, name: room.name });
        await this.publish();
        return;
      }
      case 'addCpu': {
        if (!isHost || room.phase !== 'lobby') return;
        if (this.humans().length + room.cpus.length >= MAX_RACERS) return;
        const used = new Set(room.cpus.map(c => c.name));
        const [a, b] = crypto.getRandomValues(new Uint32Array(2));
        const free = CPU_NAMES.filter(n => !used.has(n));
        room.cpuSerial = (room.cpuSerial || 0) + 1;
        room.cpus.push({
          id: 'cpu-' + room.cpuSerial,
          name: free.length ? free[a % free.length] : 'CPU ' + room.cpuSerial,
          color: this.freeColor(),
          difficulty: DIFFICULTIES.includes(msg.difficulty) ? msg.difficulty : 'normal',
          seed: b,
          pose: 'wheel',
        });
        await this.save();
        this.broadcast({ type: 'cpus', cpus: room.cpus });
        await this.publish();
        return;
      }
      case 'removeCpu': {
        if (!isHost || room.phase !== 'lobby') return;
        const before = room.cpus.length;
        room.cpus = room.cpus.filter(c => c.id !== msg.id);
        if (room.cpus.length === before) return;
        await this.ctx.storage.delete('limbs:' + msg.id);
        await this.save();
        this.broadcast({ type: 'cpus', cpus: room.cpus });
        await this.publish();
        return;
      }
      case 'start': {
        if (!isHost || room.phase !== 'lobby') return;
        let stage = Number.isInteger(msg.stage) ? msg.stage : 0;
        if (stage < 0) stage = RANDOM_BASE + (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000);
        if (stage >= FIXED_STAGES && stage < RANDOM_BASE) stage = 0;
        const humans = this.humans();
        this.trimCpus(humans.length);
        for (const c of room.cpus) { c.pose = 'wheel'; await this.ctx.storage.delete('limbs:' + c.id); }
        room.phase = 'racing';
        room.raceId++;
        room.stage = stage;
        room.startsAt = Date.now() + COUNTDOWN_MS;
        room.results = [];
        room.graceUntil = 0;
        room.participants = humans.map(s => this.info(s).id).concat(room.cpus.map(c => c.id));
        await this.save();
        await this.ctx.storage.setAlarm(room.startsAt + RACE_LIMIT_MS);
        this.broadcast({ type: 'countdown', raceId: room.raceId, stage, ms: COUNTDOWN_MS, participants: room.participants, cpus: room.cpus });
        await this.publish();
        return;
      }
      case 'finish':
      case 'giveup': {
        if (room.phase !== 'racing' || msg.r !== room.raceId) return;
        await this.record(me, msg.type === 'finish' ? msg.time : null);
        return;
      }
      case 'cpuFinish': {
        const cpu = room.cpus.find(c => c.id === msg.id);
        if (!isHost || !cpu || room.phase !== 'racing' || msg.r !== room.raceId) return;
        await this.record(cpu, msg.time);
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
    const rest = this.humans().filter(s => s !== ws);
    if (!rest.length) {
      // Empty room: forget everything and leave the directory.
      const code = this.room.code;
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.room = freshRoom();
      if (code) {
        try { await this.directory().remove(code); } catch (e) { console.error('directory remove failed', e); }
      }
      return;
    }
    if (this.room.hostId === me.id) {
      this.room.hostId = rest.map(s => this.info(s)).sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
    }
    await this.save();
    this.broadcast({ type: 'leave', id: me.id, hostId: this.room.hostId }, ws);
    await this.publish(ws);
    await this.maybeEndRace(ws);
  }

  async alarm() {
    const room = this.room;
    if (room.phase !== 'racing') return;
    const now = Date.now();
    if (now >= room.startsAt + RACE_LIMIT_MS - 1000 || (room.graceUntil && now >= room.graceUntil - 50)) await this.endRace();
  }

  // ---------------- race lifecycle ----------------
  async record(racer, claimed) {
    const room = this.room;
    if (!room.participants.includes(racer.id) || room.results.some(r => r.id === racer.id)) return;
    let time = null;
    if (claimed !== null) {
      // The sender's clock says how long it raced; the room's clock bounds it.
      const elapsed = (Date.now() - room.startsAt) / 1000;
      time = Number(claimed);
      if (!Number.isFinite(time) || time < elapsed - 2 || time > elapsed + 2) time = Math.max(0, elapsed);
      time = Math.round(time * 100) / 100;
    }
    const result = { id: racer.id, name: racer.name, color: racer.color, time, cpu: racer.id.startsWith('cpu-') };
    room.results.push(result);
    await this.save();
    const place = time === null ? null : room.results.filter(r => r.time !== null).length;
    this.broadcast({ type: 'result', raceId: room.raceId, result, place });
    await this.maybeEndRace();
  }

  // The race ends when every person in it has finished or given up. CPUs still running then
  // get CPU_GRACE_MS to finish, so a room of fast people doesn't wait on a stuck CPU.
  async maybeEndRace(gone) {
    const room = this.room;
    if (room.phase !== 'racing') return;
    const done = id => room.results.some(r => r.id === id);
    const here = new Set(this.humans().filter(s => s !== gone).map(s => this.info(s).id));
    const people = room.participants.filter(id => here.has(id) && !done(id));
    if (people.length) return;
    const cpus = room.participants.filter(id => id.startsWith('cpu-') && !done(id));
    // With nobody left to run them, CPUs cannot finish.
    if (!cpus.length || !here.size) { await this.endRace(); return; }
    if (!room.graceUntil) {
      room.graceUntil = Date.now() + CPU_GRACE_MS;
      await this.save();
      await this.ctx.storage.setAlarm(room.graceUntil);
    }
  }

  async endRace() {
    const room = this.room;
    room.phase = 'lobby';
    room.graceUntil = 0;
    // Anyone who neither finished nor gave up: CPUs still running, people who left.
    for (const id of room.participants) {
      if (room.results.some(r => r.id === id)) continue;
      const cpu = room.cpus.find(c => c.id === id);
      if (cpu) room.results.push({ id, name: cpu.name, color: cpu.color, time: null, cpu: true, dnf: true });
    }
    room.lastResults = room.results;
    room.results = [];
    this.trimCpus(this.humans().length);
    await this.save();
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ type: 'raceEnd', raceId: room.raceId, results: room.lastResults, hostId: room.hostId, cpus: room.cpus });
    await this.publish();
  }

  // ---------------- directory ----------------
  directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('public-rooms'));
  }

  async publish(gone) {
    const room = this.room;
    if (!room.code) return;
    const humans = this.humans().filter(s => s !== gone);
    try {
      if (room.isPublic && humans.length) {
        const host = humans.map(s => this.info(s)).find(p => p.id === room.hostId);
        await this.directory().update({
          code: room.code, name: room.name, host: host ? host.name : '',
          players: humans.length, cpus: room.cpus.length, phase: room.phase,
        });
      } else {
        await this.directory().remove(room.code);
      }
    } catch (e) {
      // The listing is best effort; the room works without it.
      console.error('directory update failed', e);
    }
  }

  // ---------------- helpers ----------------
  info(ws) {
    try { return ws.deserializeAttachment(); } catch { return null; }
  }

  humans() {
    return this.ctx.getWebSockets().filter(ws => this.info(ws));
  }

  // Drop CPUs (newest first) until people + CPUs fit. Returns true if any were dropped.
  trimCpus(humanCount) {
    const room = this.room;
    const keep = Math.max(0, MAX_RACERS - humanCount);
    if (room.cpus.length <= keep) return false;
    room.cpus = room.cpus.slice(0, keep);
    return true;
  }

  freeColor() {
    const used = new Set(this.humans().map(ws => this.info(ws)?.color).concat(this.room.cpus.map(c => c.color)));
    return COLORS.find(c => !used.has(c)) || COLORS[this.room.joins % COLORS.length];
  }

  publicRoom() {
    const r = this.room;
    return {
      code: r.code, name: r.name, isPublic: r.isPublic,
      phase: r.phase, stage: r.stage, raceId: r.raceId, hostId: r.hostId,
      participants: r.participants, results: r.results, lastResults: r.lastResults, cpus: r.cpus,
      msIntoRace: r.phase === 'racing' ? Date.now() - r.startsAt : null,
    };
  }

  async playerList() {
    const out = [];
    for (const ws of this.humans()) {
      const p = this.info(ws);
      out.push({ ...p, limbs: (await this.ctx.storage.get('limbs:' + p.id)) || null });
    }
    return out;
  }

  // Limbs the CPUs are currently using (for someone joining mid-race).
  async cpuLimbs() {
    const out = {};
    for (const c of this.room.cpus) {
      const limbs = await this.ctx.storage.get('limbs:' + c.id);
      if (limbs) out[c.id] = limbs;
    }
    return out;
  }

  allow(key) {
    const now = Date.now();
    let r = this.rate.get(key);
    if (!r || now - r.windowStart >= 1000) { r = { windowStart: now, count: 0 }; this.rate.set(key, r); }
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
  return {
    code: null, name: '', isPublic: false,
    phase: 'lobby', stage: 0, raceId: 0, startsAt: 0, hostId: null, joins: 0,
    participants: [], results: [], lastResults: [], cpus: [], cpuSerial: 0,
  };
}

function num(v) { return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0; }

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
