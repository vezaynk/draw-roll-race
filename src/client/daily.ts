// Sending daily runs and showing the daily leaderboard on the results card.
import type { Recording } from './ghost';
import { byId, el, ordinal } from './dom';
import { playerName, save } from './storage';

interface Leaderboard {
  day: string;
  top: { name: string; time: number; you: boolean }[];
  you: { time: number; rank: number } | null;
  total: number;
}

function note(text: string): void {
  byId('lb-note').textContent = text;
}

function renderBoard(data: Leaderboard): void {
  const list = byId('lb-list');
  list.textContent = '';
  data.top.forEach((r, i) => {
    const item = el('li', r.you ? 'you' : '');
    item.append(
      el('span', 'rk', ordinal(i + 1)),
      el('span', 'nm', r.you ? `${r.name} (you)` : r.name),
      el('span', '', `${r.time.toFixed(2)} s`),
    );
    list.append(item);
  });
}

async function showLeaderboard(day: string, sent: boolean): Promise<void> {
  const res = await fetch(`/api/daily?day=${day}&player=${encodeURIComponent(save.player)}`, { cache: 'no-store' });
  if (!res.ok) {
    if (sent) note('Could not load the leaderboard.');
    return;
  }
  const data = await res.json() as Leaderboard;
  renderBoard(data);
  if (!sent) return;
  note(data.you
    ? `You are ${ordinal(data.you.rank)} of ${data.total} today (best ${data.you.time.toFixed(2)} s).`
    : `${data.total} runners today.`);
}

/** Sends a finished daily run with its recording, then shows the leaderboard. */
export default async function submitDaily(
  day: string,
  time: number,
  rec: Recording,
): Promise<void> {
  byId('leaderboard').hidden = false;
  byId('lb-title').textContent = 'Today’s leaderboard';
  byId('lb-list').textContent = '';
  note('Sending your time…');
  try {
    const res = await fetch('/api/daily', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        day,
        player: save.player,
        name: playerName() || 'Runner',
        time: Number(time.toFixed(2)),
        trace: rec.samples.map(([t, x]) => [t, x]),
      }),
    });
    const out = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) note(out.error ?? 'The leaderboard is not available here.');
    await showLeaderboard(day, res.ok);
  } catch {
    note('The leaderboard needs the online version of the game.');
  }
}
