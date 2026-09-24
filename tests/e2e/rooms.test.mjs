// Rooms: public listing, joining, CPUs run by the room, host handover, private rooms, bad codes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, launch, newPlayer, drawWheel, text, waitForText, createRoom } from './helpers.mjs';

const browser = await launch();
after(() => browser.close());

test('public room with CPUs: listing, race, results, host handover, private join by code', async () => {
  const step = m => console.log('# step: ' + m);
  const ana = await newPlayer(browser, 'Ana');
  const code = await createRoom(ana, { name: 'Sunday Sprint', isPublic: true, testStage: 990 });
  await drawWheel(ana);
  step('room created');

  // Ben finds the room in the public list.
  const ben = await newPlayer(browser, 'Ben', { width: 1280, height: 800 });
  await ben.goto(BASE + '?teststage=990');
  await ben.click('#online-btn');
  await ben.waitForSelector('#public-rooms li button');
  assert.match(await text(ben, '#public-rooms'), /Sunday Sprint/);
  await ben.click('#public-rooms li button');
  await waitForText(ben, '#room-name', /Sunday Sprint/);
  await drawWheel(ben);
  step('ben joined');

  // The host fills slots with CPUs.
  for (const d of ['easy', 'normal', 'hard']) {
    await ana.selectOption('#cpu-difficulty', d);
    await ana.click('#add-cpu');
    await ana.waitForTimeout(150);
  }
  await waitForText(ben, '#racer-count', /5 \/ 8 racers/);
  step('cpus added');

  // Race: Ben sees the CPUs move even though nobody's browser runs them.
  await ana.click('#start-btn');
  await ben.waitForTimeout(4500);
  const dots = await ben.evaluate(() => document.querySelectorAll('#progress .dot.remote').length);
  assert.equal(dots, 4, 'Ben should see Ana and three CPUs');
  step('race seen');

  // The host leaves mid-race; the CPUs keep racing and finish.
  await ana.click('#leave-btn');
  await waitForText(ben, '#results-box', /Last race/i, 60000);
  step('race ended');
  const results = await text(ben, '#results-list');
  assert.match(results, /You/);
  assert.equal((results.match(/CPU/g) || []).length, 3, 'all three CPUs appear in the results: ' + results);
  assert.match(await text(ben, '#player-list'), /HOST/i);

  // Private rooms leave the public list but can be joined by code.
  await ben.click('#visibility-btn');
  await ben.waitForTimeout(400);
  const listed = await (await fetch(BASE + 'api/rooms')).json();
  assert.ok(!listed.rooms.some(r => r.code === code), 'private room is not listed');
  const cy = await newPlayer(browser, 'Cy');
  await cy.goto(BASE);
  await cy.click('#online-btn');
  await cy.fill('#join-code', code);
  await cy.click('#join-form button');
  await waitForText(cy, '#room-visibility', /private/i);

  for (const p of [ana, ben, cy]) assert.deepEqual(p.errors, []);
  await ben.context().close(); await cy.context().close(); await ana.context().close();
});

test('joining a code with no room shows a clear error', async () => {
  const p = await newPlayer(browser, 'Dee');
  await p.goto(BASE);
  await p.click('#online-btn');
  await p.fill('#join-code', 'K7Q2M');
  await p.click('#join-form button');
  await waitForText(p, '#join-error', /No room is open with code K7Q2M/);
  await p.fill('#join-code', 'hi');
  await p.click('#join-form button');
  await waitForText(p, '#join-error', /5 letters or digits/);
  await p.context().close();
});

test('new room codes are unique and names are moderated', async () => {
  const codes = new Set();
  for (let i = 0; i < 5; i++) codes.add((await (await fetch(BASE + 'api/rooms', { method: 'POST' })).json()).code);
  assert.equal(codes.size, 5);

  const p = await newPlayer(browser, 'sh1t head');
  await createRoom(p, { name: 'fuuuck room', isPublic: false });
  assert.doesNotMatch(await text(p, '#room-name'), /fu+ck/i);
  assert.match(await text(p, '#room-name'), /room/i);
  assert.doesNotMatch(await text(p, '#player-list'), /sh1t/i);
  await p.context().close();
});
