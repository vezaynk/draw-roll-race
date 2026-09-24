// The room checks each finish by replaying the run it was sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import buildCourse from '../../src/shared/course/build';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol';
import botRun from '../support/bot';
import { BASE, pause } from './helpers';

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

interface Client {
  ws: WebSocket;
  you: string;
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
  const client: Client = {
    ws, inbox, next, you: '', send: (m) => ws.send(JSON.stringify(m)),
  };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as ServerMessage;
    if (m.type === 'welcome') client.you = m.you;
  });
  return new Promise((resolve) => {
    ws.addEventListener('open', () => resolve(client));
  });
}

test('room finishes are checked by replaying the run', async () => {
  const run = botRun(buildCourse(990));
  const { code } = await (await fetch(`${BASE}api/rooms`, { method: 'POST' })).json() as { code: string };
  const honest = await connect(code, 'Honest');
  const early = await connect(code, 'Early');
  const junk = await connect(code, 'Junk');
  const everyone = [honest, early, junk];
  try {
    await Promise.all(everyone.map((c) => c.next('welcome')));
    honest.send({ type: 'start', stage: 990 });
    const countdown = await honest.next('countdown');
    const r = countdown.raceId;
    await pause(countdown.ms + 300);

    // A real run, but claimed long before it could have reached the line.
    early.send({
      type: 'finish', r, time: run.time, inputs: run.inputs,
    });
    // A run whose drawings never get it to the line.
    junk.send({
      type: 'finish', r, time: 1, inputs: [[0, { arm: [], leg: [[160, 120, 162, 121]] }]],
    });
    // The honest runner finishes when the run actually ends.
    await pause(run.time * 1000);
    honest.send({
      type: 'finish', r, time: run.time, inputs: run.inputs,
    });

    // Each finish is shown as pending at once, then checked.
    const pending = await honest.next('result');
    assert.equal(pending.result.verify, 'pending');
    const verdicts = new Map<string, Of<'verified'>>();
    const ids = new Map<string, string>();
    everyone.forEach((c, i) => ids.set(['Honest', 'Early', 'Junk'][i], c.you));
    for (let i = 0; i < 3; i += 1) {
      const v = await honest.next('verified', 20000);
      verdicts.set(v.id, v);
    }
    assert.equal(verdicts.get(ids.get('Honest') ?? '')?.ok, true);
    assert.equal(verdicts.get(ids.get('Honest') ?? '')?.time, Math.round(run.time * 100) / 100);
    assert.equal(verdicts.get(ids.get('Early') ?? '')?.ok, false, 'too early for the run it sent');
    assert.equal(verdicts.get(ids.get('Junk') ?? '')?.ok, false, 'never reaches the finish');

    const end = await honest.next('raceEnd', 20000);
    const byName = Object.fromEntries(end.results.map((x) => [x.name, x.verify]));
    assert.deepEqual(byName, { Honest: 'ok', Early: 'failed', Junk: 'failed' });
  } finally {
    everyone.forEach((c) => c.ws.close());
  }
});
