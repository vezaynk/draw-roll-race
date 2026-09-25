// "Your player" in Options (and "Save your score" after a daily run): a display name, and one
// button, "Save with a passkey". There is no separate "create account" and "sign in":
//  - if the browser has a passkey for this site, using it makes this device that passkey's
//    player, and the device's own anonymous player is remapped into it;
//  - otherwise a new passkey is made for this device's player, which claims it.
// Signed in, the button adds another passkey. Logging out forgets everything on this device.
// See worker/auth.ts.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { lookAfterSignIn } from './appearance';
import { byId } from './dom';
import {
  becomePlayer, displayName, forgetEverything, persist, playerName, save, setPlayerName,
} from './storage';

interface Me {
  signedIn: boolean;
  player?: string;
  hash?: string;
  name?: string;
  passkeys?: number;
  look?: unknown;
}

let online = false;
let busy = false;
/** Using an existing passkey was just tried and none was picked: the next tap makes one. */
let noExistingPasskey = false;
const listeners: (() => void)[] = [];

/** Called after this device saves or changes its player. */
export function onAccountChange(listener: () => void): void {
  listeners.push(listener);
}

/** Whether "Save with a passkey" can be offered here (online, passkeys supported, not saved). */
export function canSave(): boolean {
  return online && browserSupportsWebAuthn() && !save.signedIn;
}

function note(text: string, warning = false): void {
  const el = byId('account-note');
  el.textContent = text;
  el.classList.toggle('warn', warning);
}

function render(): void {
  byId('account').hidden = !online;
  if (!online) return;
  const supported = browserSupportsWebAuthn();
  byId<HTMLInputElement>('account-name').value = playerName();
  byId<HTMLInputElement>('account-name').placeholder = displayName();
  byId('account-status').textContent = save.signedIn
    ? 'Your player is saved with a passkey. Use it on any device to race as you.'
    : 'Save with a passkey to keep your name and daily times on any device. Already have one? Use it the same way.';
  byId('passkey-save').hidden = save.signedIn || !supported;
  byId('passkey-add').hidden = !save.signedIn || !supported;
  byId('logout-btn').hidden = !save.signedIn;
  if (!supported) note('This browser doesn’t support passkeys.');
}

async function post<T>(path: string, data: unknown = {}): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  const out = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(out.error ?? 'Something went wrong. Try again.');
  return out;
}

/** The passkey prompt was dismissed: not an error worth showing. */
const cancelled = (e: unknown) => e instanceof Error && e.name === 'NotAllowedError';

/** Runs one passkey action. Returns the message to show, or throws. */
async function run(task: () => Promise<string>, show = note): Promise<boolean> {
  if (busy) return false;
  busy = true;
  note('');
  try {
    show(await task());
    listeners.forEach((listener) => listener());
    return true;
  } catch (e) {
    if (!cancelled(e)) show(e instanceof Error ? e.message : String(e), true);
    else if (noExistingPasskey) show('No passkey was saved. Tap again to make one.');
    return false;
  } finally {
    busy = false;
    render();
  }
}

/** Makes a new passkey for this device's player (claiming it, or adding one when signed in). */
async function createPasskey(): Promise<string> {
  const adding = save.signedIn;
  // Empty if you haven't chosen one: the server then uses your default name.
  const name = playerName();
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
    'register/options',
    { player: save.player, name },
  );
  const response = await startRegistration({ optionsJSON });
  const out = await post<{ hash: string; name: string }>('register/verify', { response });
  becomePlayer(save.player, out.hash, out.name || name);
  noExistingPasskey = false;
  return adding ? 'Added another passkey for your player.' : 'Saved. Your player now has a passkey.';
}

/** Uses a passkey the browser already has: this device becomes its player. */
async function useExistingPasskey(): Promise<string> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('login/options');
  const response = await startAuthentication({ optionsJSON });
  const out = await post<{ player: string; hash: string; name: string; look: unknown }>(
    'login/verify',
    { response, localPlayer: save.player },
  );
  becomePlayer(out.player, out.hash, out.name);
  lookAfterSignIn(out.look);
  return `Saved. You’re playing as ${displayName()} again.`;
}

/**
 * "Save with a passkey": first offers the passkeys this browser has for the site; if none is
 * used, makes a new one. (Browsers may drop the second prompt if too long passes after the tap;
 * then the next tap goes straight to making one.)
 */
export function saveWithPasskey(show = note): Promise<boolean> {
  return run(async () => {
    if (save.signedIn || noExistingPasskey) return createPasskey();
    try {
      return await useExistingPasskey();
    } catch (e) {
      if (!cancelled(e)) throw e;
      noExistingPasskey = true;
      return createPasskey();
    }
  }, show);
}

/** Logs out and forgets everything on this device; the next visit starts as a new player. */
function logOut(): Promise<void> {
  return run(async () => {
    await post('logout');
    forgetEverything();
    window.location.reload();
    return '';
  }).then(() => {});
}

/** Checks the session with the server (it may have been ended on another device). */
async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    const me = await res.json() as Me;
    if (me.signedIn && me.player && me.hash) {
      becomePlayer(me.player, me.hash, playerName() ? '' : me.name ?? '');
      lookAfterSignIn(me.look);
    } else if (save.signedIn) {
      save.signedIn = false;
      persist();
    }
  } catch {
    // offline: keep what we have
  }
}

/** Shows the account section once the game is known to be served by its Worker. */
export async function enableAccount(): Promise<void> {
  online = true;
  await refresh();
  render();
}

export default function initAccount(): void {
  byId('account-name').addEventListener('change', (e) => {
    const name = (e.target as HTMLInputElement).value.trim().slice(0, 24);
    if (name) setPlayerName(name);
  });
  byId('passkey-save').addEventListener('click', () => saveWithPasskey());
  byId('passkey-add').addEventListener('click', () => saveWithPasskey());
  byId('logout-btn').addEventListener('click', logOut);
  render();
}
