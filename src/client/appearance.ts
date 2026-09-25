// Which look your runner wears: the one you chose, or until you choose one, your default look
// picked by your player hash (the same on every device). Choosing needs a player saved with a
// passkey; the chosen look is kept on the server with your player, so it follows your passkey.
import { lookFromHash, sanitizeLook } from '../shared/look';
import type { Look } from '../shared/look';
import { renderPad } from './pad';
import { hooks, state } from './state';
import { persist, save } from './storage';

/** Wait this long after the last change before saving the look to the server. */
const SAVE_DELAY_MS = 800;
let saveTimer = 0;
/** A chosen look not sent to the server yet. */
let unsent = false;

/** Shows `look` on your runner and the pad, and tells your room. */
function wear(look: Look): void {
  state.look = look;
  renderPad();
  hooks.onLook?.();
}

/** Your look: the one you chose, or else your default one. */
export function myLook(): Look {
  return save.look ?? lookFromHash(save.playerHash);
}

/** Puts on your look (at start, once your hash is known, and after changing player). */
export function wearMyLook(): void {
  wear(myLook());
}

function sendLook(): void {
  window.clearTimeout(saveTimer);
  unsent = false;
  // keepalive: the request still goes out if the page is closing.
  fetch('/api/auth/look', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ look: save.look }),
    keepalive: true,
  }).catch(() => {
    // offline: it is saved in the browser and sent again next time
  });
}

// Leaving (or reloading) right after a change: send it now rather than lose it.
window.addEventListener('pagehide', () => {
  if (unsent) sendLook();
});

/** Chooses a look (saved players only): kept in the browser and, shortly after, on the server. */
export function chooseLook(look: Look): void {
  if (!save.signedIn) return;
  save.look = look;
  persist();
  wear(look);
  window.clearTimeout(saveTimer);
  unsent = true;
  saveTimer = window.setTimeout(sendLook, SAVE_DELAY_MS);
}

/**
 * After signing in or saving with a passkey: use the look the server has for the player. If it
 * has none, a look chosen here is sent to it; with none chosen either, the default look stays.
 */
export function lookAfterSignIn(stored: unknown): void {
  if (stored) {
    save.look = sanitizeLook(stored);
    persist();
  } else if (save.look) {
    sendLook();
  }
  wearMyLook();
}
