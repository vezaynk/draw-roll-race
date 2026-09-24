// Customising your runner: the Look pickers in Options, saved in the browser, and shown to others
// in a room.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerMessage } from '../../src/shared/protocol';
import {
  BASE, launch, newPlayer, createRoom, pause, text,
} from './helpers';

const browser = await launch();
after(() => browser.close());

const savedLook = (p: import('playwright').Page) => p.evaluate(
  () => JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').look,
);

test('the Look pickers change your runner, and the look is kept', async () => {
  const p = await newPlayer(browser, 'Lou');
  await p.goto(BASE);
  await p.click('#menu-btn');
  assert.equal(await text(p, '#look-hair'), 'None');
  await p.click('[aria-label="Next hair"]');
  await p.click('[aria-label="Next hat"]');
  await p.click('[aria-label="Next hat"]');
  await p.click('[aria-label="Previous glasses"]');
  assert.equal(await text(p, '#look-hair'), 'Spiky');
  assert.equal(await text(p, '#look-hat'), 'Top hat');
  assert.equal(await text(p, '#look-glasses'), 'Goggles');
  // Kept across a reload.
  await p.reload();
  assert.deepEqual(await savedLook(p), {
    hair: 'spiky', hat: 'tophat', eyes: 'dot', glasses: 'goggles',
  });
  await p.click('#menu-btn');
  await p.click('#look-shuffle');
  assert.ok(await savedLook(p));
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('others in a room see your look', async () => {
  const p = await newPlayer(browser, 'Mo');
  await p.goto(BASE);
  await p.click('#menu-btn');
  await p.click('[aria-label="Next hat"]'); // cap
  await p.click('#options-close');
  const code = await createRoom(p, { isPublic: false });

  // Someone joins: the room tells them how Mo looks.
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}api/rooms/${code}/ws?name=Watcher`);
  const inbox: ServerMessage[] = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(String(e.data))));
  const find = async <T extends ServerMessage['type']>(type: T) => {
    for (let i = 0; i < 50; i += 1) {
      const m = inbox.find((x) => x.type === type);
      if (m) return m as Extract<ServerMessage, { type: T }>;
      await pause(100);
    }
    throw new Error(`no ${type}`);
  };
  const welcome = await find('welcome');
  assert.equal(welcome.players.find((x) => x.name === 'Mo')?.look?.hat, 'cap');

  // And changes arrive as they happen.
  await p.click('#menu-btn');
  await p.click('[aria-label="Next hat"]'); // top hat
  const change = await find('look');
  assert.equal(change.look.hat, 'tophat');
  ws.close();
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
