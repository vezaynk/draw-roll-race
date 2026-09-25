// "Your player" in Options (and "Save your score" after a daily run, and the Customize window): a
// display name, and one button, "Save with a passkey". There is no separate "create account"
// and "sign in":
//  - the button first offers the passkeys the browser has for this site. Using one makes this
//    device that passkey's player, and the device's own anonymous player is remapped into it;
//  - if none is used, it asks: make a new passkey (which claims this device's player), or try
//    again. Browsers report "you cancelled" and "you have no passkey" the same way, so it never
//    makes one without asking: a returning player who dismissed the sheet would get a second
//    player instead of theirs.
// Returning players can also pick their passkey from the autofill list on the name field in
// Options. Signed in, the button adds another passkey. Logging out forgets everything on this
// device. See worker/auth.ts.
import {
  browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, startRegistration,
} from '@simplewebauthn/browser';
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { lookAfterSignIn } from './appearance';
import { byId, el } from './dom';
import { loadStats } from './stats';
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
/** A passkey sign-in is waiting on the name field's autofill list. */
let autofilling = false;
const listeners: (() => void)[] = [];

/** Called after this device saves or changes its player. */
export function onAccountChange(listener: () => void): void {
  listeners.push(listener);
}

/** Whether "Save with a passkey" can be offered here (online, passkeys supported, not saved). */
export function canSave(): boolean {
  return online && browserSupportsWebAuthn() && !save.signedIn;
}

/** Shows a message under a passkey button (by default, the one in Options). */
function say(text: string, warning = false, target = byId('account-note')): void {
  target.textContent = text;
  target.classList.toggle('warn', warning);
}

const note = (text: string, warning = false) => say(text, warning);

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

/** The passkey prompt was dismissed (or there was nothing to pick): not an error worth showing. */
const cancelled = (e: unknown) => e instanceof Error && e.name === 'NotAllowedError';

type Outcome = 'done' | 'dismissed' | 'failed';

/** Runs one passkey action, showing its message (or error) in `target`. */
async function run(task: () => Promise<string>, target: HTMLElement): Promise<Outcome> {
  if (busy) return 'failed';
  busy = true;
  say('', false, target);
  try {
    say(await task(), false, target);
    listeners.forEach((listener) => listener());
    return 'done';
  } catch (e) {
    if (cancelled(e)) return 'dismissed';
    say(e instanceof Error ? e.message : String(e), true, target);
    return 'failed';
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
  return adding ? 'Added another passkey for your player.' : 'Saved. Your player now has a passkey.';
}

/** Signs in with a passkey the browser gave us: this device becomes its player. */
async function signIn(response: AuthenticationResponseJSON): Promise<string> {
  const out = await post<{ player: string; hash: string; name: string; look: unknown }>(
    'login/verify',
    { response, localPlayer: save.player },
  );
  becomePlayer(out.player, out.hash, out.name);
  lookAfterSignIn(out.look);
  return `Saved. You’re playing as ${displayName()} again.`;
}

type LoginOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

/** Offers the passkeys the browser has for this site (a sheet the player picks from). */
async function useExistingPasskey(): Promise<string> {
  const optionsJSON = await post<LoginOptions>('login/options');
  return signIn(await startAuthentication({ optionsJSON }));
}

/** After a dismissed sheet: make a new passkey, or try again? Waits for a tap on one of them. */
function ask(target: HTMLElement): Promise<'create' | 'retry'> {
  say('No passkey used. New here? Make one for this player. Have one? Try again.', false, target);
  const make = el('button', 'primary', 'Make a new passkey');
  const again = el('button', 'quiet', 'Try again');
  make.dataset.choice = 'create';
  again.dataset.choice = 'retry';
  [make, again].forEach((b) => b.setAttribute('type', 'button'));
  const row = el('span', 'passkey-choice');
  row.append(make, again);
  target.append(row);
  return new Promise((resolve) => {
    make.addEventListener('click', () => resolve('create'), { once: true });
    again.addEventListener('click', () => resolve('retry'), { once: true });
  });
}

/**
 * "Save with a passkey", showing what happens in `target`. Signed in, it adds a passkey.
 * Otherwise it offers the browser's passkeys for this site; if none is used, it asks whether
 * to make a new one or try again (each choice is its own tap, as browsers want for a passkey
 * prompt). Resolves true once the player is saved (or signed in), false if not.
 */
export async function saveWithPasskey(target = byId('account-note')): Promise<boolean> {
  if (save.signedIn) return (await run(createPasskey, target)) === 'done';
  for (;;) {
    const tried = await run(useExistingPasskey, target);
    if (tried !== 'dismissed') return tried === 'done';
    if ((await ask(target)) === 'create') {
      const made = await run(createPasskey, target);
      if (made === 'dismissed') say('No passkey was made.', false, target);
      return made === 'done';
    }
  }
}

/**
 * Passkey autofill: while "Your player" is open, the name field's suggestions include this
 * site's passkeys, so a returning player can sign in by picking theirs. Starting another passkey
 * prompt (the button) cancels this one.
 */
export async function offerPasskeyAutofill(): Promise<void> {
  if (autofilling || !canSave() || !(await browserSupportsWebAuthnAutofill())) return;
  autofilling = true;
  try {
    const optionsJSON = await post<LoginOptions>('login/options');
    const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
    if (busy) return;
    await run(() => signIn(response), byId('account-note'));
  } catch {
    // cancelled by another prompt, or the challenge ran out: nothing to show
  } finally {
    autofilling = false;
  }
}

/** Logs out and forgets everything on this device; the next visit starts as a new player. */
function logOut(): Promise<void> {
  return run(async () => {
    await post('logout');
    forgetEverything();
    window.location.reload();
    return '';
  }, byId('account-note')).then(() => {});
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
  loadStats();
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
