// Personal performance stats: every finished run (except the tutorial) is sent to the server,
// which replays it and keeps its time. Your percentile compares your last 100 runs with every
// run anyone has finished (see shared/stats.ts).
import { MIN_RUNS, RECENT_RUNS } from '../shared/stats';
import type { Stats } from '../shared/stats';
import type { Recording } from './ghost';
import { byId, el } from './dom';
import { myHash, save } from './storage';

/** The stats line: your percentile, or how many runs to go until there is one. */
export function statsLine(target: HTMLElement, stats: Stats): void {
  target.textContent = '';
  if (stats.percentile === null) {
    const left = MIN_RUNS - stats.runs;
    target.append(`${stats.runs} of ${MIN_RUNS} runs: finish ${left} more to get your performance percentile.`);
    return;
  }
  const recent = Math.min(stats.runs, RECENT_RUNS);
  target.append(
    'Your last ', String(recent), ' runs beat ',
    el('strong', '', `${Math.round(stats.percentile)}%`),
    ` of all ${stats.everyone} runs.`,
  );
}

/** Shows stats in Options (under Your player). */
function showInOptions(stats: Stats | null): void {
  const line = byId('account-stats');
  line.hidden = !stats;
  if (stats) statsLine(line, stats);
}

/** Your stats from the server (null offline). */
export async function loadStats(): Promise<Stats | null> {
  try {
    const res = await fetch(`/api/stats?hash=${await myHash()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const stats = await res.json() as Stats;
    showInOptions(stats);
    return stats;
  } catch {
    return null;
  }
}

/** Sends a finished run on a stage; the server replays it and answers with your stats. */
export async function sendRun(stage: number, rec: Recording): Promise<Stats | null> {
  try {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ player: save.player, stage, inputs: rec.inputs }),
    });
    if (!res.ok) return null;
    const { stats } = await res.json() as { stats: Stats };
    showInOptions(stats);
    return stats;
  } catch {
    return null;
  }
}

/** Which results card is showing (so a slow answer doesn't land on a later card). */
let card = 0;

/** The stats line on the results card, once the run is counted. */
export async function showResultStats(counted: Promise<Stats | null>): Promise<void> {
  card += 1;
  const mine = card;
  const line = byId('result-stats');
  line.hidden = true;
  const stats = await counted;
  if (!stats || mine !== card || byId('result').hidden) return;
  statsLine(line, stats);
  line.hidden = false;
}
