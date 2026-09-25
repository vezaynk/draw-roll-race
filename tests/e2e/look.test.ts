// Customising your runner (🎨 on the start screen). Choosing a look needs a player saved with a
// passkey; until then players wear a default look (and name) picked by their hash. Rooms see
// everyone's look.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, CDPSession, Page } from 'playwright';
import type { ServerMessage } from '../../src/shared/protocol';
import { lookFromHash } from '../../src/shared/look';
import { nameFromHash } from '../../src/shared/names';
import {
  BASE, launch, createRoom, drawWheel, pause,
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

test('unsaved players keep a default look and name picked by their hash, and can’t choose a look', async () => {
  // No name set: a brand-new player.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}?stage=990`);
  await p.waitForFunction(() => !document.getElementById('account')?.hidden);
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').playerHash);
  const hash: string = await p.evaluate(() => JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').playerHash);
  const mine = JSON.stringify(lookFromHash(hash));
  assert.equal(await worn(p), mine, 'wears the default look for the hash');
  assert.equal(await p.getAttribute('#account-name', 'placeholder'), nameFromHash(hash), 'shows the default name');

  await p.click('#start-look');
  assert.equal(await p.isVisible('#look-locked'), true, 'asks to save with a passkey');
  assert.equal(await p.isDisabled('[aria-label="Next hat"]'), true);
  await p.click('#look-close');
  assert.equal(await p.locator('#options #look-pickers').count(), 0, 'not in Options any more');

  // The look stays the same round after round, and after a reload.
  for (let round = 0; round < 2; round += 1) {
    await drawWheel(p);
    await p.waitForFunction(() => window.drr.state.racing);
    assert.equal(await worn(p), mine, `round ${round + 1}`);
    await p.click('#exit-btn');
  }
  await p.reload();
  await p.waitForFunction(() => !document.getElementById('account')?.hidden);
  assert.equal(await worn(p), mine, 'after a reload');

  assert.deepEqual(errors, []);
  await ctx.close();
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

test('others in a room see your look, and your default name if you haven’t chosen one', async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const code = await createRoom(p, { isPublic: false });
  const mine = JSON.parse(await worn(p));
  const hash: string = await p.evaluate(() => JSON.parse(localStorage.getItem('draw-roll-race') ?? '{}').playerHash);

  const ws = new WebSocket(`${BASE.replace('http', 'ws')}api/rooms/${code}/ws?name=Watcher`);
  const inbox: ServerMessage[] = [];
  ws.addEventListener('message', (e) => inbox.push(JSON.parse(String(e.data))));
  let welcome: Extract<ServerMessage, { type: 'welcome' }> | undefined;
  for (let i = 0; i < 50 && !welcome; i += 1) {
    welcome = inbox.find((m) => m.type === 'welcome') as typeof welcome;
    await pause(100);
  }
  // Someone joins: the room tells them how the host looks, under the host's default name.
  const host = welcome?.players.find((x) => x.name === nameFromHash(hash));
  assert.ok(host, `host named ${nameFromHash(hash)}: ${welcome?.players.map((x) => x.name).join(', ')}`);
  assert.deepEqual(host.look, mine);
  ws.close();
  assert.deepEqual(errors, []);
  await ctx.close();
});
