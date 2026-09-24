// Customising your runner (🎨 on the start screen). Choosing a look needs a player saved with a
// passkey; unsaved players get a new random look every round. Rooms see everyone's look.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, CDPSession, Page } from 'playwright';
import type { ServerMessage } from '../../src/shared/protocol';
import {
  BASE, launch, newPlayer, createRoom, drawWheel, pause,
} from './helpers';

// Passkeys need a domain name, not an IP address.
const SITE = BASE.replace('127.0.0.1', 'localhost');

const browser = await launch();
after(() => browser.close());

const worn = (p: Page) => p.evaluate(() => JSON.stringify(window.drr.state.look));

/** A browser with a simulated passkey authenticator. */
async function device(b: Browser): Promise<{ page: Page; cdp: CDPSession; authenticatorId: string }> {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
  await page.goto(`${SITE}?stage=990`);
  await page.waitForFunction(() => !document.getElementById('account')?.hidden);
  return { page, cdp, authenticatorId };
}

test('unsaved players get a new random look each round, and can’t choose one', async () => {
  const p = await newPlayer(browser, 'Ray', { width: 1280, height: 800 });
  await p.goto(`${BASE}?stage=990`);
  await p.click('#start-look');
  assert.equal(await p.isVisible('#look-locked'), true, 'asks to save with a passkey');
  assert.equal(await p.isDisabled('[aria-label="Next hat"]'), true);
  await p.click('#look-close');
  assert.equal(await p.locator('#options #look-pickers').count(), 0, 'not in Options any more');

  // Three rounds: the look changes (all three alike would be a 1 in 2 million chance).
  const looks = [await worn(p)];
  for (let round = 0; round < 2; round += 1) {
    await drawWheel(p);
    await p.waitForFunction(() => window.drr.state.racing);
    looks.push(await worn(p));
    await p.click('#exit-btn');
  }
  assert.ok(new Set(looks).size > 1, `looks changed: ${looks.join(' ')}`);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('saving with a passkey unlocks your look, which is kept and follows the passkey', async () => {
  const a = await device(browser);
  await a.page.click('#start-look');
  const before = await worn(a.page);
  await a.page.click('#look-save');
  await a.page.waitForSelector('#look-locked', { state: 'hidden', timeout: 15000 });
  assert.equal(await worn(a.page), before, 'the look you had becomes yours');
  await a.page.click('[aria-label="Next hat"]');
  const chosen = await worn(a.page);
  assert.notEqual(chosen, before);

  // Reloading straight after a change still saves it on the server.
  await a.page.reload();
  await a.page.waitForFunction(() => !document.getElementById('account')?.hidden);
  assert.equal(await worn(a.page), chosen, 'kept across an immediate reload');
  await a.page.click('#start-look');
  assert.equal(await a.page.isVisible('#look-locked'), false, 'still unlocked after a reload');
  await a.page.click('#look-close');
  await drawWheel(a.page);
  await a.page.waitForFunction(() => window.drr.state.racing);
  assert.equal(await worn(a.page), chosen, 'saved players keep their look every round');
  const me = await a.page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).look);
  assert.equal(JSON.stringify(me), chosen, 'saved on the server');

  // The passkey syncs to another device: signing in there brings the look.
  const b = await device(browser);
  const { credentials } = await a.cdp.send('WebAuthn.getCredentials', { authenticatorId: a.authenticatorId });
  await b.cdp.send('WebAuthn.addCredential', { authenticatorId: b.authenticatorId, credential: credentials[0] });
  await b.page.click('#start-look');
  await b.page.click('#look-save');
  await b.page.waitForSelector('#look-locked', { state: 'hidden', timeout: 15000 });
  assert.equal(await worn(b.page), chosen, 'the look followed the passkey');
  await a.page.context().close();
  await b.page.context().close();
});

test('others in a room see your look', async () => {
  const p = await newPlayer(browser, 'Mo');
  const code = await createRoom(p, { isPublic: false });
  const mine = JSON.parse(await worn(p));

  // Someone joins: the room tells them how Mo looks.
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}api/rooms/${code}/ws?name=Watcher`);
  const inbox: ServerMessage[] = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(String(e.data))));
  let welcome: Extract<ServerMessage, { type: 'welcome' }> | undefined;
  for (let i = 0; i < 50 && !welcome; i += 1) {
    welcome = inbox.find((m) => m.type === 'welcome') as typeof welcome;
    await pause(100);
  }
  assert.deepEqual(welcome?.players.find((x) => x.name === 'Mo')?.look, mine);
  ws.close();
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
