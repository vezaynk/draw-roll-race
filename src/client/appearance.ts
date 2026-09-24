// Which look your runner wears. Customising it needs a player saved with a passkey: then it is
// the look you chose, kept on the server with your player (so it follows your passkey). Until
// then, you get a new random look every round.
import { randomLook, sanitizeLook } from '../shared/look';
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

/** The look for a new round: yours if you're saved, otherwise a fresh random one. */
export function lookForRound(): void {
  wear(save.signedIn ? save.look : randomLook());
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
 * After signing in or saving with a passkey: use the look the server has for the player, or,
 * if it has none yet, keep the look worn now as the player's own.
 */
export function lookAfterSignIn(stored: unknown): void {
  if (stored) {
    save.look = sanitizeLook(stored);
    persist();
    wear(save.look);
  } else {
    save.look = state.look;
    persist();
    sendLook();
  }
}
