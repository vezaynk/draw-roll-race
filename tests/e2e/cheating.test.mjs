// The room refuses finishes the player's positions don't back up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE } from './helpers.mjs';

function connect(code, name) {
  const ws = new WebSocket(BASE.replace('http', 'ws') + 'api/rooms/' + code + '/ws?name=' + name);
  const inbox = [];
  const waiters = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of waiters.splice(0)) w();
  });
  const next = async (type, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const i = inbox.findIndex(m => m.type === type);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise(r => {
        waiters.push(r);
        setTimeout(r, 200);
      });
    }
    throw new Error('no ' + type + ' message');
  };
  return new Promise(resolve => ws.addEventListener('open', () => resolve({ ws, next, send: m => ws.send(JSON.stringify(m)), inbox })));
}

test('a finish without the positions to back it up is refused', async () => {
  const { code } = await (await fetch(BASE + 'api/rooms', { method: 'POST' })).json();
  const a = await connect(code, 'Honest');
  const b = await connect(code, 'Sneaky');
  try {
    await a.next('welcome');
    await b.next('welcome');
    a.send({ type: 'start', stage: 990 });
    const cd = await b.next('countdown');

    // Sneaky claims a finish right after the countdown without ever moving.
    await new Promise(r => setTimeout(r, cd.ms + 2500));
    b.send({ type: 'finish', r: cd.raceId, time: 2.5 });
    const notice = await b.next('notice');
    assert.match(notice.message, /couldn.t confirm/);
    assert.ok(!b.inbox.some(m => m.type === 'result'), 'no result recorded');

    // Positions that jump straight to the line don't count either.
    b.send({ type: 'state', r: cd.raceId, x: 200, y: 380, a: 0, b: 0 });
    await new Promise(r => setTimeout(r, 100));
    b.send({ type: 'state', r: cd.raceId, x: 99999, y: 380, a: 0, b: 0 });
    b.send({ type: 'finish', r: cd.raceId, time: 3 });
    await b.next('notice');
    assert.ok(!b.inbox.some(m => m.type === 'result'), 'still no result recorded');
  } finally {
    a.ws.close();
    b.ws.close();
  }
});
