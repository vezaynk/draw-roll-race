// Sending daily runs, showing the daily leaderboard on the results card, and naming the day's
// leader.
import { canSave, saveWithPasskey } from './account';
import type { Recording } from './ghost';
import { byId, el, ordinal } from './dom';
import { myHash, playerName, save } from './storage';

interface Leaderboard {
  day: string;
  /** Players appear as hashes of their IDs; ours is the one matching myHash(). */
  top: { name: string; time: number; hash: string; verifySeconds: number | null }[];
  you: { time: number; rank: number } | null;
  total: number;
}

interface Leader {
  name: string;
  time: number;
  hash: string;
}

/**
 * Names the day's fastest runner. Their run itself is never sent (it would give away their
 * strategy), so the daily course only ever shows your own ghost. Returns a line to show, or null.
 */
export async function loadLeader(day: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/daily/leader?day=${day}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const { leader } = await res.json() as { leader: Leader | null };
    if (!leader) return null;
    return leader.hash === await myHash()
      ? `You lead today (${leader.time.toFixed(2)} s).`
      : `Today’s leader: ${leader.name} (${leader.time.toFixed(2)} s).`;
  } catch {
    return null;
  }
}

function note(text: string, warning = false): void {
  const el = byId('lb-note');
  el.textContent = text;
  el.classList.toggle('warn', warning);
}

/** A spinner before the note while the server checks your run. */
function checking(on: boolean): void {
  byId('lb-note').classList.toggle('checking', on);
}

/** Every run on the board was replayed by the server before it was saved. */
function verifiedMark(seconds: number | null): HTMLElement {
  const mark = el('span', 'verify ok', '✅');
  mark.title = seconds === null ? 'Server-validated' : `Server-validated in ${seconds.toFixed(2)} seconds`;
  return mark;
}

function renderBoard(data: Leaderboard, mine: string): void {
  const list = byId('lb-list');
  list.textContent = '';
  data.top.forEach((r, i) => {
    const you = r.hash === mine;
    const item = el('li', you ? 'you' : '');
    item.append(
      el('span', 'rk', ordinal(i + 1)),
      el('span', 'nm', you ? `${r.name} (you)` : r.name),
      verifiedMark(r.verifySeconds),
      el('span', '', `${r.time.toFixed(2)} s`),
    );
    list.append(item);
  });
}

async function showLeaderboard(day: string, sent: boolean): Promise<void> {
  const mine = await myHash();
  const res = await fetch(`/api/daily?day=${day}&hash=${mine}`, { cache: 'no-store' });
  if (!res.ok) {
    if (sent) note('Could not load the leaderboard.');
    return;
  }
  const data = await res.json() as Leaderboard;
  renderBoard(data, mine);
  if (!sent) return;
  note(data.you
    ? `You are ${ordinal(data.you.rank)} of ${data.total} today (best ${data.you.time.toFixed(2)} s).`
    : `${data.total} runners today.`);
}

/** Sends a finished daily run (what was drawn when), then shows the leaderboard. */
export default async function submitDaily(
  day: string,
  time: number,
  rec: Recording,
): Promise<void> {
  byId('leaderboard').hidden = false;
  byId('lb-title').textContent = 'Today’s leaderboard';
  byId('lb-list').textContent = '';
  note('Checking your run on the server…');
  checking(true);
  try {
    const res = await fetch('/api/daily', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        day,
        player: save.player,
        name: playerName() || 'Runner',
        time: Number(time.toFixed(2)),
        inputs: rec.inputs,
      }),
    });
    const out = await res.json().catch(() => ({})) as {
      error?: string; time?: number; verifySeconds?: number;
    };
    checking(false);
    if (!res.ok) {
      const failed = out.verifySeconds === undefined ? '' : `⚠️ Failed verify run in ${out.verifySeconds.toFixed(2)} seconds. `;
      note(`${failed}${out.error ?? 'The leaderboard is not available here.'}`);
    }
    await showLeaderboard(day, res.ok);
    if (res.ok && out.verifySeconds !== undefined) {
      note(`✅ ${byId('lb-note').textContent} Server-validated in ${out.verifySeconds.toFixed(2)} seconds.`);
    }
    // The server times runs by replaying them; say so if its time differs from ours.
    if (res.ok && out.time !== undefined && Math.abs(out.time - time) >= 0.01) {
      note(`${byId('lb-note').textContent} The server timed your run at ${out.time.toFixed(2)} s.`);
    }
    // You may have taken the lead (or someone else has since).
    if (res.ok) await loadLeader(day);
    // Not saved yet: offer to keep this score with a passkey.
    if (res.ok && canSave()) {
      const button = byId('save-score');
      button.hidden = false;
      button.dataset.day = day;
    }
  } catch {
    checking(false);
    note('The leaderboard needs the online version of the game.');
  }
}

/** "Save your score": saves (or finds) this player's passkey, then shows the board as that player. */
export function initSaveScore(): void {
  const button = byId<HTMLButtonElement>('save-score');
  button.addEventListener('click', async () => {
    const { day } = button.dataset;
    if (!day) return;
    button.disabled = true;
    const saved = await saveWithPasskey((text, warning) => note(text, warning));
    button.disabled = false;
    if (!saved) return;
    button.hidden = true;
    const message = byId('lb-note').textContent ?? '';
    await showLeaderboard(day, true);
    note(`${message} ${byId('lb-note').textContent}`.trim());
  });
}
