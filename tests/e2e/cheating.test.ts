// The room refuses finishes the player's positions don't back up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol';
import { BASE, pause } from './helpers';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

interface Client {
  ws: WebSocket;
  inbox: ServerMessage[];
  send(msg: ClientMessage): void;
  next<T extends ServerMessage['type']>(type: T, timeout?: number): Promise<Of<T>>;
}

function connect(code: string, name: string): Promise<Client> {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}api/rooms/${code}/ws?name=${name}`);
  const inbox: ServerMessage[] = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(String(e.data))));
  const next = async <T extends ServerMessage['type']>(type: T, timeout = 10000): Promise<Of<T>> => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const i = inbox.findIndex((m) => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0] as Of<T>;
      // Polling the inbox until the message arrives.
      await pause(100);
    }
    throw new Error(`no ${type} message`);
  };
  return new Promise((resolve) => {
    ws.addEventListener('open', () => resolve({
      ws, inbox, next, send: (m) => ws.send(JSON.stringify(m)),
    }));
  });
}

test('a finish without the positions to back it up is refused', async () => {
  const { code } = await (await fetch(`${BASE}api/rooms`, { method: 'POST' })).json() as { code: string };
  const honest = await connect(code, 'Honest');
  const sneaky = await connect(code, 'Sneaky');
  try {
    await honest.next('welcome');
    await sneaky.next('welcome');
    honest.send({ type: 'start', stage: 990 });
    const countdown = await sneaky.next('countdown');

    // Sneaky claims a finish right after the countdown without ever moving.
    await pause(countdown.ms + 2500);
    sneaky.send({ type: 'finish', r: countdown.raceId, time: 2.5 });
    const notice = await sneaky.next('notice');
    assert.match(notice.message, /couldn.t confirm/);
    assert.ok(!sneaky.inbox.some((m) => m.type === 'result'), 'no result recorded');

    // Positions that jump straight to the line don't count either.
    sneaky.send({
      type: 'state', r: countdown.raceId, x: 200, y: 380, a: 0, b: 0,
    });
    await pause(100);
    sneaky.send({
      type: 'state', r: countdown.raceId, x: 99999, y: 380, a: 0, b: 0,
    });
    sneaky.send({ type: 'finish', r: countdown.raceId, time: 3 });
    await sneaky.next('notice');
    assert.ok(!sneaky.inbox.some((m) => m.type === 'result'), 'still no result recorded');
  } finally {
    honest.ws.close();
    sneaky.ws.close();
  }
});
