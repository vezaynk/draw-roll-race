// The room lobby card: room name and code, racers, CPU slots, results and host controls.
import { MAX_RACERS } from '../../shared/protocol';
import type { RaceResult, RoomInfo } from '../../shared/protocol';
import { hasLimbs } from '../../shared/limbs';
import type { EncodedLimbs } from '../../shared/types';
import { COLORS } from '../colors';
import { byId, el, ordinal } from '../dom';

export interface LobbyRacer {
  id: string;
  name: string;
  color: string;
  limbs: EncodedLimbs | null;
  difficulty?: string;
}

export interface LobbyView {
  code: string;
  room: RoomInfo | null;
  you: string | null;
  yourName: string;
  youDrew: boolean;
  people: LobbyRacer[];
  cpus: LobbyRacer[];
  /** Name of the course the next race uses. */
  nextCourse: string;
  onRemoveCpu: (id: string) => void;
}

export function showLobby(show: boolean): void {
  byId('lobby').hidden = !show;
}

let statusIsWarning = false;

export function setStatus(text: string, warning = false): void {
  const status = byId('lobby-status');
  status.textContent = text;
  status.classList.toggle('warn', warning);
  statusIsWarning = warning;
}

const tag = (text: string) => el('span', 'tag', text);

function swatch(color: string): HTMLElement {
  const s = el('span', 'swatch');
  s.style.background = color;
  return s;
}

function racerRow(
  color: string,
  name: string,
  tags: HTMLElement[],
  note: string,
  extra?: HTMLElement | null,
) {
  const row = el('li');
  row.append(swatch(color), el('span', 'pname', name), ...tags, el('span', 'drawn', note));
  if (extra) row.append(extra);
  return row;
}

function renderRacers(v: LobbyView, isHost: boolean, racing: boolean): void {
  const hostId = v.room?.hostId;
  const readyIds = v.room?.ready ?? [];
  const drawn = (drew: boolean) => (drew ? 'ready to roll' : 'no limbs yet');
  const tags = (id: string | null) => [
    ...(id === hostId ? [tag('host')] : []),
    ...(id && readyIds.includes(id) && !racing ? [el('span', 'tag ready', 'ready')] : []),
  ];
  const rows = [
    racerRow(COLORS.player, v.yourName || 'You', [tag('you'), ...tags(v.you)], drawn(v.youDrew)),
    ...v.people.map((p) => racerRow(p.color, p.name, tags(p.id), drawn(hasLimbs(p.limbs)))),
    ...v.cpus.map((c) => {
      let remove: HTMLElement | null = null;
      if (isHost && !racing) {
        remove = el('button', 'remove-cpu', '✕');
        remove.setAttribute('type', 'button');
        remove.setAttribute('aria-label', `Remove ${c.name}`);
        remove.addEventListener('click', () => v.onRemoveCpu(c.id));
      }
      return racerRow(c.color, c.name, [tag('cpu')], c.difficulty ?? '', remove);
    }),
  ];
  byId('player-list').replaceChildren(...rows);
}

function resultTime(r: RaceResult): string {
  if (r.time !== null) return `${r.time.toFixed(2)} s`;
  return r.dnf ? 'did not finish' : 'gave up';
}

function renderResults(v: LobbyView, racing: boolean): void {
  const results = (racing ? v.room?.results : v.room?.lastResults) ?? [];
  byId('results-box').hidden = !results.length;
  byId('results-title').textContent = racing ? 'This race' : 'Last race';
  let place = 0;
  const rows = results.map((r) => {
    const row = el('li');
    if (r.time !== null) place += 1;
    const mine = r.id === v.you;
    row.append(
      el('span', 'place', r.time === null ? '—' : ordinal(place)),
      swatch(mine ? COLORS.player : r.color),
      el('span', 'pname', mine ? 'You' : r.name),
    );
    if (r.cpu) row.append(tag('cpu'));
    row.append(el('span', 'rtime', resultTime(r)));
    return row;
  });
  byId('results-list').replaceChildren(...rows);
}

export function renderLobby(v: LobbyView): void {
  const { room } = v;
  const isHost = !!room?.hostId && room.hostId === v.you;
  const racing = room?.phase === 'racing';
  const racers = 1 + v.people.length + v.cpus.length;
  const full = racers >= MAX_RACERS;

  byId('room-name').textContent = room?.name || `Room ${v.code}`;
  const badge = byId('room-visibility');
  badge.textContent = room?.isPublic ? 'Public' : 'Private';
  badge.classList.toggle('public', !!room?.isPublic);
  byId('racer-count').textContent = `${racers} / ${MAX_RACERS} racers`;

  renderRacers(v, isHost, racing);
  renderResults(v, racing);

  // During a race the card shrinks to status and results, so the course stays visible.
  byId('lobby').classList.toggle('compact', racing);
  byId('host-controls').hidden = !isHost || racing;
  byId('cpu-controls').hidden = !isHost || racing;
  const addCpu = byId<HTMLButtonElement>('add-cpu');
  addCpu.disabled = full;
  addCpu.title = full ? 'The room is full' : '';
  byId('visibility-btn').textContent = room?.isPublic ? 'Make private' : 'Make public';
  byId<HTMLButtonElement>('start-btn').disabled = racing;

  // Ready-up: when every person here is ready, the next race starts by itself.
  const people = 1 + v.people.length;
  const readyCount = room?.ready.length ?? 0;
  const youReady = !!v.you && !!room?.ready.includes(v.you);
  byId('ready-row').hidden = racing;
  byId('next-course').textContent = `Next: ${v.nextCourse}`;
  const readyBtn = byId('ready-btn');
  readyBtn.textContent = youReady ? 'Ready ✓' : 'I’m ready';
  readyBtn.classList.toggle('on', youReady);
  readyBtn.setAttribute('aria-pressed', String(youReady));

  if (!racing && !statusIsWarning) {
    if (readyCount && people > 1) setStatus(`${readyCount} of ${people} ready. The race starts when everyone is.`);
    else if (!isHost) setStatus('Draw your runner and tap “I’m ready”. The host can also start the race.');
    else if (racers > 1) setStatus('Draw your runner, pick a course, then start or wait until everyone is ready.');
    else setStatus('Invite friends with the link, or add CPUs to fill the open slots.');
  }
}
