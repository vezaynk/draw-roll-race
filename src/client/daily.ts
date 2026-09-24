// Sending daily runs, showing the daily leaderboard on the results card, and the day's leader
// as a ghost to race against.
import buildCourse from '../shared/course/build';
import { dailyStage } from '../shared/course/stages';
import type { RunInput } from '../shared/replay';
import { replayGhost } from './ghost';
import type { Ghost, Recording } from './ghost';
import { byId, el, ordinal } from './dom';
import { playerName, save } from './storage';

interface Leaderboard {
  day: string;
  top: { name: string; time: number; you: boolean }[];
  you: { time: number; rank: number } | null;
  total: number;
}

interface Leader {
  name: string;
  time: number;
  you: boolean;
  inputs: RunInput[];
}

/** The day's leader as a ghost (null when you lead, or nobody has a replayable run yet). */
let leader: { day: string; ghost: Ghost | null } | null = null;

/**
 * Fetches the day's fastest run and rebuilds it as a ghost by replaying it. Returns a line
 * describing the leader, or null.
 */
export async function loadLeader(day: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/daily/leader?day=${day}&player=${encodeURIComponent(save.player)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json() as { leader: Leader | null };
    const top = data.leader;
    if (!top) {
      leader = { day, ghost: null };
      return null;
    }
    const ghost = top.you ? null : replayGhost(buildCourse(dailyStage(day)), top.inputs, `Leader: ${top.name}`);
    leader = { day, ghost };
    return top.you
      ? `You lead today (${top.time.toFixed(2)} s).`
      : `Race today’s leader, ${top.name} (${top.time.toFixed(2)} s).`;
  } catch {
    return null;
  }
}

/** A fresh copy of the day's leader ghost, if there is one. */
export function leaderGhost(day: string): Ghost | null {
  if (leader?.day !== day || !leader.ghost) return null;
  return {
    ...leader.ghost, runner: null, limbsAt: -1, cursor: 1,
  };
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

/** Sends a finished daily run (what was drawn when), then shows the leaderboard. */
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
        inputs: rec.inputs,
      }),
    });
    const out = await res.json().catch(() => ({})) as { error?: string; time?: number };
    if (!res.ok) note(out.error ?? 'The leaderboard is not available here.');
    await showLeaderboard(day, res.ok);
    // The server times runs by replaying them; say so if its time differs from ours.
    if (res.ok && out.time !== undefined && Math.abs(out.time - time) >= 0.01) {
      note(`${byId('lb-note').textContent} The server timed your run at ${out.time.toFixed(2)} s.`);
    }
    // You may have taken the lead (or someone else has since).
    if (res.ok) await loadLeader(day);
  } catch {
    note('The leaderboard needs the online version of the game.');
  }
}
