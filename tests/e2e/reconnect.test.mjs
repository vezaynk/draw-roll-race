// A dropped connection mid-race rejoins as the same racer and the finish still counts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, newPlayer, drawWheel, text, waitForText, createRoom, joinByLink } from './helpers.mjs';

const browser = await launch();
after(() => browser.close());

test('reconnecting mid-race keeps your place', async () => {
  const host = await newPlayer(browser, 'Host');
  const code = await createRoom(host, { isPublic: false, testStage: 990 });
  await drawWheel(host);
  const eve = await newPlayer(browser, 'Eve');
  await joinByLink(eve, code, 990);
  await drawWheel(eve);

  await host.click('#start-btn');
  await eve.waitForTimeout(3800); // countdown

  // Eve's network drops for a moment.
  await eve.context().setOffline(true);
  await eve.waitForTimeout(1200);
  await eve.context().setOffline(false);

  await waitForText(host, '#results-box', /Last race/i, 60000);
  const results = await text(host, '#results-list');
  assert.match(results, /Eve/, 'Eve finished as herself: ' + results);
  assert.doesNotMatch(results, /Runner/, 'no duplicate racer: ' + results);
  const racers = await text(host, '#racer-count');
  assert.match(racers, /2 \/ 8/, 'still two racers: ' + racers);
  assert.deepEqual(eve.errors.filter(e => !/ERR_INTERNET_DISCONNECTED|WebSocket/.test(e)), []);
  await host.context().close(); await eve.context().close();
});
