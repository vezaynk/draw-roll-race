// Draw Roll Race — one Durable Object per room.
//
// Each browser simulates its own runner and sends its position; the room relays positions
// and drawn limbs, runs the race (lobby -> countdown -> racing -> lobby) and checks finishes
// against the course it builds itself. The room also runs the CPU racers, with the same
// physics and CPU code the browser uses. Public rooms are listed in the Directory.
// Between races the room uses WebSocket hibernation, so a quiet room costs nothing.
import { DurableObject } from 'cloudflare:workers';
import '../public/src/physics.js';
import '../public/src/cpu.js';
import { moderateName } from './moderation.js';

const D = globalThis.DRR;

export const MAX_RACERS = 8;        // people + CPUs
const COUNTDOWN_MS = 3500;          // clients count down 3-2-1 from receipt
const RACE_LIMIT_MS = 4 * 60 * 1000; // a race ends after this even if someone is stuck
const CPU_GRACE_MS = 10 * 1000;     // once every person is done, CPUs get this long to finish
const CPU_TICK_MS = 66;             // how often the room advances CPUs and sends their positions
const REJOIN_MS = 60 * 1000;        // a dropped player can come back as themselves within this
const MAX_MESSAGE = 8 * 1024;
const STATE_RATE = 40;              // max position messages per second per sender
const MAX_SPEED = 1200;             // world units per second no runner can average
// Everyone sees themselves in red, so nobody else is ever red.
const COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e', '#5b6472'];
const CPU_NAMES = ['Bolt', 'Wobble', 'Spoke', 'Zippy', 'Noodle', 'Gizmo', 'Pogo', 'Rusty', 'Dash', 'Sprocket', 'Doodle', 'Tumble'];
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const FIXED_STAGES = D.STAGES.length;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').trim().slice(0, max);

export class RaceRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rate = new Map();      // sender -> { windowStart, count }
    this.pos = new Map();       // player id -> { x, t } last position they reported this race
    this.course = null;         // the course of the race in progress
    this.drivers = new Map();   // CPU id -> CPU driver (cpu.js)
    this.cpuLimbs = new Map();  // CPU id -> encoded limbs, for people joining mid-race
    this.cpuT = 0;
    this.timer = null;
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) || freshRoom();
      // CPUs live in memory; if the room restarted mid-race they are gone, so end that race.
      if (this.room.phase === 'racing') { this.room.phase = 'lobby'; this.room.results = []; }
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
    const now = Date.now();

    const token = TOKEN_RE.test(url.searchParams.get('token') || '') ? url.searchParams.get('token') : null;
    let sockets = this.humans();

    // Same browser tab reconnecting while its old connection hasn't closed yet: take it over.
    let resumed = null;
    if (token) {
      const old = sockets.find(ws => this.info(ws).token === token);
      if (old) {
        resumed = this.info(old);
        old.serializeAttachment({ replaced: true });
        try { old.close(4001, 'replaced'); } catch { /* already closing */ }
        sockets = sockets.filter(ws => ws !== old);
      } else if (room.away[token] && room.away[token].until > now) {
        resumed = room.away[token];
      }
      delete room.away[token];
    }
    for (const [t, a] of Object.entries(room.away)) if (a.until <= now) delete room.away[t];

    if (!resumed && sockets.length >= MAX_RACERS) {
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'error', code: 'full', message: 'This room is full (8 racers).' }));
      server.close(4000, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }

    const typed = clean(url.searchParams.get('name'), 16);
    const player = resumed
      ? { id: resumed.id, name: resumed.name, color: resumed.color, joinedAt: resumed.joinedAt, token }
      : {
          id: crypto.randomUUID().slice(0, 8),
          name: moderateName(typed, 'Runner ' + (room.joins + 1)),
          color: this.freeColor(),
          joinedAt: now,
          token,
        };
    if (!resumed) room.joins++;
    if (!sockets.length) {
      // First one in creates the room and its settings.
      room.code = clean(url.pathname.split('/')[3], 5).toUpperCase();
      room.isPublic = url.searchParams.get('public') === '1';
      room.name = moderateName(clean(url.searchParams.get('room_name'), 24), player.name + "'s room");
      room.hostId = player.id;
      room.cpus = [];
    } else if (!sockets.some(ws => this.info(ws).id === room.hostId)) {
      room.hostId = player.id;
    }
    const trimmed = room.phase === 'lobby' && this.trimCpus(sockets.length + 1);
    await this.save();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player);

    server.send(JSON.stringify({
      type: 'welcome', you: player.id, resumed: !!resumed,
      room: this.publicRoom(), players: await this.playerList(),
      cpuLimbs: Object.fromEntries(this.cpuLimbs),
    }));
    const { token: _t, ...shown } = player;
    this.broadcast({ type: 'join', player: { ...shown, limbs: null }, resumed: !!resumed }, server);
    if (trimmed) this.broadcast({ type: 'cpus', cpus: room.cpus }, server);
    await this.publish();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const me = this.info(ws);
    if (!me || !me.id || !msg || typeof msg.type !== 'string') return;
    const room = this.room;
    const isHost = me.id === room.hostId;

    switch (msg.type) {
      case 'state': {
        // Hot path: relay only. Remember the position so finishes can be checked.
        if (room.phase !== 'racing' || msg.r !== room.raceId || !this.allow(me.id)) return;
        const x = num(msg.x), y = num(msg.y);
        this.trackPosition(me.id, x);
        this.broadcast({ type: 'state', id: me.id, x, y, a: num(msg.a), b: num(msg.b) }, ws);
        return;
      }
      case 'limbs': {
        const limbs = cleanLimbs(msg.limbs);
        if (!limbs) return;
        const lost = Array.isArray(msg.lost) ? msg.lost.filter(k => k === 'arm' || k === 'leg') : undefined;
        await this.ctx.storage.put('limbs:' + me.id, limbs);
        this.broadcast({ type: 'limbs', id: me.id, limbs, lost }, ws);
        return;
      }
      case 'name': {
        const name = moderateName(clean(msg.name, 16), null);
        if (!name) { ws.send(JSON.stringify({ type: 'notice', message: 'That name isn’t allowed. Try another one.' })); return; }
        me.name = name;
        ws.serializeAttachment(me);
        this.broadcast({ type: 'name', id: me.id, name });
        await this.publish();
        return;
      }
      case 'settings': {
        if (!isHost) return;
        if (typeof msg.isPublic === 'boolean') room.isPublic = msg.isPublic;
        const name = moderateName(clean(msg.name, 24), null);
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
        await this.save();
        this.broadcast({ type: 'cpus', cpus: room.cpus });
        await this.publish();
        return;
      }
      case 'start': {
        if (!isHost || room.phase !== 'lobby') return;
        room.stage = this.pickStage(msg.stage);
        const humans = this.humans();
        this.trimCpus(humans.length);
        room.phase = 'racing';
        room.raceId++;
        room.startsAt = Date.now() + COUNTDOWN_MS;
        room.results = [];
        room.graceUntil = 0;
        room.participants = humans.map(s => this.info(s).id).concat(room.cpus.map(c => c.id));
        await this.save();
        await this.ctx.storage.setAlarm(room.startsAt + RACE_LIMIT_MS);
        this.pos.clear();
        this.startCpus();
        this.broadcast({ type: 'countdown', raceId: room.raceId, stage: room.stage, ms: COUNTDOWN_MS, participants: room.participants, cpus: room.cpus });
        await this.publish();
        return;
      }
      case 'finish':
      case 'giveup': {
        if (room.phase !== 'racing' || msg.r !== room.raceId) return;
        if (msg.type === 'finish' && !this.finishLooksReal(me.id, msg.time)) {
          ws.send(JSON.stringify({ type: 'notice', message: 'The room couldn’t confirm that finish, so it wasn’t counted.' }));
          return;
        }
        await this.record(me, msg.type === 'finish' ? msg.time : null);
        return;
      }
    }
  }

  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }

  async leave(ws) {
    const me = this.info(ws);
    if (!me || !me.id) return; // replaced by a reconnect of the same tab
    ws.serializeAttachment({ left: true });
    try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    this.rate.delete(me.id);
    const rest = this.humans().filter(s => s !== ws);
    if (!rest.length) {
      // Empty room: forget everything and leave the directory.
      const code = this.room.code;
      this.stopCpus();
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.room = freshRoom();
      this.cpuLimbs.clear();
      if (code) {
        try { await this.directory().remove(code); } catch (e) { console.error('directory remove failed', e); }
      }
      return;
    }
    // Keep their place for a while in case they come back (a dropped connection, a reload).
    if (me.token) this.room.away[me.token] = { id: me.id, name: me.name, color: me.color, joinedAt: me.joinedAt, until: Date.now() + REJOIN_MS };
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

  // ---------------- CPUs ----------------
  startCpus() {
    this.stopCpus();
    this.course = D.buildCourse(this.room.stage);
    this.cpuLimbs.clear();
    for (const c of this.room.cpus) {
      const drv = D.createCpu(this.course, {
        seed: c.seed, difficulty: c.difficulty, color: c.color,
        onSwap: (limbs, pose, lost) => {
          const enc = D.encodeLimbs(limbs);
          this.cpuLimbs.set(c.id, enc);
          this.broadcast({ type: 'limbs', id: c.id, limbs: enc, pose, lost });
        },
      });
      this.cpuLimbs.set(c.id, D.encodeLimbs(drv.limbs));
      this.drivers.set(c.id, drv);
    }
    this.cpuT = 0;
    if (this.drivers.size) this.timer = setInterval(() => { this.tickCpus().catch(e => console.error('cpu tick failed', e)); }, CPU_TICK_MS);
  }

  stopCpus() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.drivers.clear();
  }

  async tickCpus() {
    const room = this.room;
    if (room.phase !== 'racing' || !this.drivers.size) { this.stopCpus(); return; }
    const now = (Date.now() - room.startsAt) / 1000;
    if (now <= 0) return;
    const target = Math.min(now, this.cpuT + 1); // catch up at most 1 s per tick
    const finished = [];
    while (this.cpuT < target) {
      this.cpuT += D.CFG.DT;
      for (const [id, drv] of this.drivers) {
        if (drv.finishTime !== null) continue;
        drv.step(D.CFG.DT, this.cpuT);
        if (drv.finishTime !== null) finished.push(id);
      }
    }
    const s = [];
    for (const [id, drv] of this.drivers) {
      const rn = drv.runner;
      s.push([id, num(rn.x), num(rn.y), num(rn.joints[0] ? rn.joints[0].angle : 0), num(rn.joints[1] ? rn.joints[1].angle : 0)]);
    }
    this.broadcast({ type: 'cpuStates', s });
    for (const id of finished) {
      const cpu = room.cpus.find(c => c.id === id);
      if (cpu) await this.record(cpu, this.drivers.get(id)?.finishTime ?? this.cpuT);
    }
    if ([...this.drivers.values()].every(d => d.finishTime !== null)) this.stopCpus();
  }

  // ---------------- race lifecycle ----------------
  pickStage(asked) {
    let stage = Number.isInteger(asked) ? asked : 0;
    if (stage < 0) return D.RANDOM_BASE + (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000);
    if (D.TEST_STAGES[stage]) return this.env.ALLOW_TEST_STAGES === '1' ? stage : 0;
    if (stage >= FIXED_STAGES && stage < D.RANDOM_BASE) return 0;
    return stage;
  }

  trackPosition(id, x) {
    const t = Date.now();
    const last = this.pos.get(id);
    // A jump faster than any runner can move is ignored, so it can't count toward a finish.
    if (last && x - last.x > MAX_SPEED * (t - last.t) / 1000 + 150) return;
    this.pos.set(id, { x, t });
  }

  // A finish counts only if the player's reported positions reached the line and the time is possible.
  finishLooksReal(id, claimed) {
    const room = this.room;
    const course = this.course || D.buildCourse(room.stage);
    const elapsed = (Date.now() - room.startsAt) / 1000;
    const minTime = (course.finishX - course.startX) / MAX_SPEED;
    if (elapsed < minTime) return false;
    const time = Number(claimed);
    if (Number.isFinite(time) && time < minTime) return false;
    const last = this.pos.get(id);
    return !!last && last.x >= course.finishX - 200;
  }

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
    if (!cpus.length || !here.size || !this.drivers.size) { await this.endRace(); return; }
    if (!room.graceUntil) {
      room.graceUntil = Date.now() + CPU_GRACE_MS;
      await this.save();
      await this.ctx.storage.setAlarm(room.graceUntil);
    }
  }

  async endRace() {
    const room = this.room;
    this.stopCpus();
    room.phase = 'lobby';
    room.graceUntil = 0;
    // CPUs that never finished are listed as such.
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
    this.stats(room);
    await this.publish();
  }

  // Race numbers for Workers Analytics Engine (only when the binding exists).
  stats(room) {
    if (!this.env.STATS) return;
    const res = room.lastResults || [];
    const people = res.filter(r => !r.cpu);
    const finished = people.filter(r => r.time !== null);
    try {
      this.env.STATS.writeDataPoint({
        blobs: ['race', String(room.stage >= D.RANDOM_BASE ? 'random' : room.stage)],
        doubles: [people.length, res.length - people.length, finished.length,
          finished.length ? finished.reduce((a, r) => a + r.time, 0) / finished.length : 0],
        indexes: ['race'],
      });
    } catch (e) { console.error('stats failed', e); }
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
    try { return ws.deserializeAttachment() || {}; } catch { return {}; }
  }

  // Open connections that belong to a player (not replaced, not already leaving).
  humans() {
    return this.ctx.getWebSockets().filter(ws => this.info(ws).id);
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
    const used = new Set(this.humans().map(ws => this.info(ws).color).concat(this.room.cpus.map(c => c.color)));
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
      const { token, ...p } = this.info(ws);
      out.push({ ...p, limbs: (await this.ctx.storage.get('limbs:' + p.id)) || null });
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
    for (const ws of this.humans()) {
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
    participants: [], results: [], lastResults: [], cpus: [], cpuSerial: 0, away: {},
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
