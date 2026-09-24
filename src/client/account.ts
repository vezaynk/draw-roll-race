// "Your player" in Options: a display name, and passkeys. Saving the player with a passkey
// claims it on the server; signing in with a passkey on another device brings the same player
// there. Logging out forgets everything on this device. See worker/auth.ts.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { byId } from './dom';
import {
  becomePlayer, forgetEverything, persist, playerName, save, setPlayerName,
} from './storage';

interface Me {
  signedIn: boolean;
  player?: string;
  hash?: string;
  name?: string;
  passkeys?: number;
}

let online = false;
let busy = false;

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
  byId('account-status').textContent = save.signedIn
    ? 'Your player is saved with a passkey. Sign in with it on any device to race as you.'
    : 'Save your player with a passkey to keep your name and daily times on any device.';
  byId('passkey-save').hidden = save.signedIn || !supported;
  byId('passkey-signin').hidden = save.signedIn || !supported;
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

async function run(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  note('');
  try {
    await task();
  } catch (e) {
    if (!cancelled(e)) note(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    render();
  }
}

/** Creates a passkey for this player (or adds another one when signed in). */
function savePasskey(): Promise<void> {
  return run(async () => {
    const adding = save.signedIn;
    const name = playerName() || 'Runner';
    const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
      'register/options',
      { player: save.player, name },
    );
    const response = await startRegistration({ optionsJSON });
    const out = await post<{ hash: string; name: string }>('register/verify', { response });
    becomePlayer(save.player, out.hash, out.name || name);
    note(adding ? 'Added another passkey for your player.' : 'Saved. Your player now has a passkey.');
  });
}

/** Signs in with a passkey: this device becomes that player. */
function signIn(): Promise<void> {
  return run(async () => {
    const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('login/options');
    const response = await startAuthentication({ optionsJSON });
    const out = await post<{ player: string; hash: string; name: string }>(
      'login/verify',
      { response, localPlayer: save.player },
    );
    becomePlayer(out.player, out.hash, out.name);
    note(`Signed in as ${out.name || 'your player'}.`);
  });
}

/** Logs out and forgets everything on this device; the next visit starts as a new player. */
function logOut(): Promise<void> {
  return run(async () => {
    await post('logout');
    forgetEverything();
    window.location.reload();
  });
}

/** Checks the session with the server (it may have been ended on another device). */
async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    const me = await res.json() as Me;
    if (me.signedIn && me.player && me.hash) {
      becomePlayer(me.player, me.hash, playerName() ? '' : me.name ?? '');
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
    const name = (e.target as HTMLInputElement).value.trim().slice(0, 16);
    if (name) setPlayerName(name);
  });
  byId('passkey-save').addEventListener('click', savePasskey);
  byId('passkey-add').addEventListener('click', savePasskey);
  byId('passkey-signin').addEventListener('click', signIn);
  byId('logout-btn').addEventListener('click', logOut);
  render();
}
