// Personal performance stats: every finished run (except the tutorial) is sent to the server,
// which replays it and keeps your best time on each course. Your percentile compares your bests
// on your last 100 courses with everyone's bests (see shared/stats.ts).
import { SECTIONS } from '../shared/course/sections';
import { MIN_RUNS, RECENT_RUNS } from '../shared/stats';
import type { SectionStats, Stats } from '../shared/stats';
import type { Recording } from './ghost';
import { byId, el } from './dom';
import { myHash, save } from './storage';

/** The stats line: your percentile, or how many courses to go until there is one. */
export function statsLine(target: HTMLElement, stats: Stats): void {
  target.textContent = '';
  if (stats.percentile === null) {
    const left = MIN_RUNS - stats.courses;
    target.append(`${stats.courses} of ${MIN_RUNS} courses: finish ${left} more to get your performance percentile (your best time on each course counts).`);
    return;
  }
  const recent = Math.min(stats.courses, RECENT_RUNS);
  target.append(
    `Your bests on your last ${recent} courses beat `,
    el('strong', '', `${Math.round(stats.percentile)}%`),
    ` of all ${stats.everyone} course bests.`,
  );
}

const pct = (s: SectionStats) => `${Math.round(s.percentile ?? 0)}%`;

/**
 * Your strongest and weakest section types, for the results card (null until two are ranked and
 * they differ).
 */
function sectionsLine(stats: Stats): string | null {
  const ranked = stats.sections.filter((s) => s.percentile !== null);
  if (ranked.length < 2) return null;
  // Weakest first (the server sorts them).
  const weakest = ranked[0];
  const strongest = ranked[ranked.length - 1];
  if (pct(strongest) === pct(weakest)) return null;
  return `Strongest: ${SECTIONS[strongest.type].label} (${pct(strongest)}) · Weakest: ${SECTIONS[weakest.type].label} (${pct(weakest)})`;
}

/** Every section type you've been through: your percentile by speed, or passes so far. */
function sectionsList(stats: Stats): HTMLElement {
  const list = el('ul', 'section-stats');
  [...stats.sections].reverse().forEach((s) => {
    const row = el('li');
    row.append(
      el('span', '', SECTIONS[s.type].label),
      s.percentile === null
        ? el('span', 'pending', `${s.passes} of ${MIN_RUNS}`)
        : el('strong', '', pct(s)),
    );
    list.append(row);
  });
  return list;
}

/** Shows stats in Options (under Your player). */
function showInOptions(stats: Stats | null): void {
  const box = byId('account-stats');
  box.hidden = !stats;
  if (!stats) return;
  const line = el('p');
  statsLine(line, stats);
  box.replaceChildren(line);
  if (stats.sections.length) {
    box.append(
      el('p', 'menu-note', 'By section type (speed through it, against everyone’s):'),
      sectionsList(stats),
    );
  }
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
  const sections = sectionsLine(stats);
  if (sections) line.append(el('br'), el('span', 'sections-line', sections));
  line.hidden = false;
}
