// The Online menu: create a room (public or private), join with a code, or browse public rooms.
import { CODE_RE, MAX_RACERS } from '../../shared/protocol';
import type { ListedRoom } from '../../shared/protocol';
import {
  byId, el, plural,
} from '../dom';
import { playerName } from '../storage';
import type { RoomSetup } from './connection';

export interface MenuActions {
  /** Called with a code that exists (or was just created, with its setup). */
  join(code: string, setup?: RoomSetup): void;
  /** Leaves the menu without joining. */
  cancel(): void;
}

let refreshTimer = 0;

function joinError(text: string): void {
  byId('join-error').textContent = text;
}

async function checkAndJoin(code: string, actions: MenuActions): Promise<void> {
  joinError('');
  if (!CODE_RE.test(code)) {
    joinError('Room codes are 5 letters or digits, like K7Q2M.');
    return;
  }
  try {
    const info = await (await fetch(`/api/rooms/${code}`, { cache: 'no-store' })).json() as { exists: boolean; full: boolean };
    if (!info.exists) {
      joinError(`No room is open with code ${code}. Check the code, or create a room.`);
      return;
    }
    if (info.full) {
      joinError('That room is full (8 racers).');
      return;
    }
  } catch {
    joinError('Could not reach the room. Check your connection and try again.');
    return;
  }
  actions.join(code);
}

function roomRow(room: ListedRoom, actions: MenuActions): HTMLElement {
  const row = el('li');
  const info = el('div', 'rinfo');
  const phase = room.phase === 'racing' ? 'racing now' : 'in the lobby';
  info.append(el('span', 'rname', room.name), el('span', 'rmeta', `${plural(room.players, 'player')} · ${phase}`));
  const full = room.players >= MAX_RACERS;
  const button = el('button', '', full ? 'Full' : 'Join');
  button.setAttribute('type', 'button');
  button.disabled = full;
  button.addEventListener('click', () => checkAndJoin(room.code, actions));
  row.append(info, button);
  return row;
}

async function loadPublicRooms(actions: MenuActions): Promise<void> {
  const list = byId('public-rooms');
  let rooms: ListedRoom[] | null;
  try {
    rooms = ((await (await fetch('/api/rooms', { cache: 'no-store' })).json()) as { rooms?: ListedRoom[] }).rooms ?? [];
  } catch {
    rooms = null;
  }
  if (!rooms || !rooms.length) {
    const text = rooms ? 'No public rooms right now. Create one and others can join it.' : 'Could not load public rooms.';
    list.replaceChildren(el('li', 'empty', text));
    return;
  }
  list.replaceChildren(...rooms.map((room) => roomRow(room, actions)));
}

export function closeMenu(): void {
  byId('online-menu').hidden = true;
  window.clearInterval(refreshTimer);
}

export function openMenu(actions: MenuActions): void {
  joinError('');
  byId<HTMLInputElement>('new-room-name').placeholder = `${playerName() || 'My'}'s room`;
  byId('online-menu').hidden = false;
  loadPublicRooms(actions);
  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => loadPublicRooms(actions), 5000);
}

export function initMenu(actions: MenuActions): void {
  byId('menu-close').addEventListener('click', () => {
    closeMenu();
    actions.cancel();
  });
  byId('refresh-rooms').addEventListener('click', () => loadPublicRooms(actions));

  byId<HTMLButtonElement>('create-btn').addEventListener('click', async (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      const out = await res.json() as { code?: string; error?: string };
      if (!out.code) throw new Error(out.error ?? 'no code');
      const checked = document.querySelector<HTMLInputElement>('input[name="visibility"]:checked');
      actions.join(out.code, {
        isPublic: checked?.value !== 'private',
        roomName: byId<HTMLInputElement>('new-room-name').value.trim(),
      });
    } catch {
      joinError('Could not create a room. Check your connection and try again.');
    } finally {
      button.disabled = false;
    }
  });

  byId('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    checkAndJoin(byId<HTMLInputElement>('join-code').value.trim().toUpperCase(), actions);
  });
}
