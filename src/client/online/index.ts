// Online rooms: joining and leaving, the messages from the room, and the hooks that put other
// racers into the game. CPU racers are run by the room itself; browsers only draw them.
import { encodeLimbs, hasLimbs } from '../../shared/limbs';
import {
  CODE_RE, EMOTES, RANDOM_COURSE, SAME_COURSE,
} from '../../shared/protocol';
import type { RoomInfo, ServerMessage } from '../../shared/protocol';
import { byId, ordinal } from '../dom';
import {
  DEFAULT_HINT, showHint, stageName, toast, updateHud, updateStageButton,
} from '../hud';
import { resetStage, startRace, stopRace } from '../race';
import { drawBubble, labelSpot } from '../render/draw';
import { render } from '../render/scene';
import { spawnShards } from '../render/shards';
import { hooks, state } from '../state';
import { playerName, setPlayerName } from '../storage';
import RoomConnection from './connection';
import type { RoomSetup } from './connection';
import {
  renderLobby, setStatus, showLobby,
} from './lobby';
import {
  closeMenu, initMenu, openMenu,
} from './menu';
import {
  drawRacers, newRacer, posedRunner, pushSample, sample, updateDots, visibleRacers,
} from './remote';
import type { RemoteRacer } from './remote';

/** Positions sent per second (about 15). */
const SEND_EVERY_MS = 66;
/** How long an emote bubble stays up. */
const EMOTE_MS = 2500;
/** Matches the room's limit on how often one person can send an emote. */
const EMOTE_GAP_MS = 700;
const WATCHING = 'A race is under way. You can watch it and join the next one.';

const net = {
  conn: null as RoomConnection | null,
  you: null as string | null,
  room: null as RoomInfo | null,
  people: new Map<string, RemoteRacer>(),
  cpus: new Map<string, RemoteRacer>(),
  raceId: 0,
  /** Racing yourself in the current race. */
  racingIn: false,
  lastSend: 0,
  idleRaf: 0,
  /** Whom the camera follows while you watch (null: whoever is in front). */
  following: null as string | null,
  lastEmote: 0,
  /** Racer id → the emote they sent and when its bubble goes. */
  emotes: new Map<string, { text: string; until: number }>(),
};

const params = new URLSearchParams(window.location.search);
/** ?teststage=N starts short test courses (the server only allows them when configured to). */
const testStage = Number.parseInt(params.get('teststage') ?? '', 10);

const nameInput = () => byId<HTMLInputElement>('my-name');
const isHost = () => !!net.room && !!net.you && net.room.hostId === net.you;
const send: RoomConnection['send'] = (msg) => net.conn?.send(msg);

function courseName(stage: number | undefined): string {
  if (stage === RANDOM_COURSE) return 'Random course';
  if (stage === SAME_COURSE) return 'Same course again';
  return stageName(stage ?? 0).replace(/ \/ \d+$/, '');
}

function refreshLobby(): void {
  if (!net.conn) return;
  renderLobby({
    code: net.conn.code,
    room: net.room,
    you: net.you,
    yourName: nameInput().value.trim(),
    youDrew: hasLimbs(state.limbs),
    people: [...net.people.values()],
    cpus: [...net.cpus.values()],
    nextCourse: courseName(net.room?.nextStage),
    onRemoveCpu: (id) => send({ type: 'removeCpu', id }),
  });
}

/** Other racers with positions this race (none between races). */
function racing() {
  return net.conn && net.room?.phase === 'racing'
    ? visibleRacers([...net.people.values(), ...net.cpus.values()])
    : [];
}

/** While you watch a race, a button shows whom the camera follows and switches to the next. */
function updateFollowButton(): void {
  const button = byId('follow-btn');
  const others = racing();
  const watching = !net.racingIn && others.length > 0;
  button.hidden = !watching;
  if (!watching) return;
  const followed = others.find(({ racer }) => racer.id === net.following)?.racer;
  const label = `Watching ${followed ? followed.name : 'the leader'} · next ▸`;
  if (button.textContent !== label) button.textContent = label;
}

function followNext(): void {
  const ids = racing().map(({ racer }) => racer.id);
  const i = net.following ? ids.indexOf(net.following) : -1;
  // After the last racer comes "the leader" again (null).
  net.following = i + 1 < ids.length ? ids[i + 1] : null;
  updateFollowButton();
}

function emoteOf(id: string): string | null {
  const emote = net.emotes.get(id);
  if (!emote || emote.until < performance.now()) return null;
  return emote.text;
}

/** Shows an emote: a bubble over the racer if they are on screen, otherwise a toast. */
function showEmote(id: string, e: number): void {
  const text = EMOTES[e];
  if (!text) return;
  net.emotes.set(id, { text, until: performance.now() + EMOTE_MS });
  const onScreen = id === net.you ? !!state.player : racing().some(({ racer }) => racer.id === id);
  if (!onScreen) {
    const who = id === net.you ? 'You' : (net.people.get(id)?.name ?? 'Someone');
    toast(`${who} ${text}`, 1400);
  }
  render();
}

/** Keeps drawing others while you are not racing yourself (lobby, finished, watching). */
function startIdleLoop(): void {
  cancelAnimationFrame(net.idleRaf);
  const loop = () => {
    if (!net.conn || state.racing) return;
    updateFollowButton();
    updateHud();
    render();
    net.idleRaf = requestAnimationFrame(loop);
  };
  net.idleRaf = requestAnimationFrame(loop);
}

/** Keeps what we know about each CPU (limbs, recent positions) across list updates. */
function setCpus(list: RoomInfo['cpus']): void {
  const next = new Map<string, RemoteRacer>();
  list.forEach((c) => {
    const known = net.cpus.get(c.id) ?? newRacer(c);
    next.set(c.id, { ...known, ...c, difficulty: c.difficulty });
  });
  net.cpus = next;
}

function watchRace(stage: number): void {
  if (state.racing) {
    stopRace();
    state.finished = true;
  }
  net.racingIn = false;
  state.stage = stage;
  resetStage();
  state.player = null;
  setStatus(WATCHING);
  startIdleLoop();
}

function onWelcome(m: Extract<ServerMessage, { type: 'welcome' }>): void {
  net.you = m.you;
  net.room = m.room;
  net.people.clear();
  m.players.filter((p) => p.id !== m.you).forEach((p) => net.people.set(p.id, newRacer(p)));
  setCpus(m.room.cpus);
  Object.entries(m.cpuLimbs).forEach(([id, limbs]) => {
    const cpu = net.cpus.get(id);
    if (cpu) Object.assign(cpu, { limbs, runner: null });
  });
  // Show the name the room uses (it replaces names that aren't allowed).
  const me = m.players.find((p) => p.id === m.you);
  if (me) nameInput().value = me.name;
  syncStageSelect();
  // Test runs pick the short test course for ready-up races too.
  if (isHost() && Number.isInteger(testStage)) send({ type: 'settings', nextStage: testStage });
  if (hasLimbs(state.limbs)) send({ type: 'limbs', limbs: encodeLimbs(state.limbs) });
  const stillRacing = m.resumed && m.room.phase === 'racing' && net.racingIn && net.raceId === m.room.raceId
    && m.room.participants.includes(m.you) && !m.room.results.some((r) => r.id === m.you);
  if (stillRacing) {
    setStatus('');
    toast('Reconnected', 1000);
  } else if (m.room.phase === 'racing') {
    net.raceId = m.room.raceId;
    watchRace(m.room.stage);
  } else {
    setStatus('');
  }
  refreshLobby();
}

function onCountdown(m: Extract<ServerMessage, { type: 'countdown' }>): void {
  net.room = {
    ...(net.room as RoomInfo), phase: 'racing', stage: m.stage, raceId: m.raceId, participants: m.participants, results: [],
  };
  net.raceId = m.raceId;
  net.room.ready = [];
  net.following = null;
  setCpus(m.cpus);
  net.cpus.forEach((c) => Object.assign(c, { samples: [], limbs: null, runner: null }));
  net.people.forEach((p) => Object.assign(p, { samples: [] }));
  if (m.participants.includes(net.you ?? '')) {
    state.stage = m.stage;
    resetStage();
    net.racingIn = true;
    showLobby(false);
    startRace({ cpus: false, countdownMs: m.ms });
  } else {
    watchRace(m.stage);
  }
  refreshLobby();
}

function onResult(m: Extract<ServerMessage, { type: 'result' }>): void {
  if (!net.room || m.raceId !== net.room.raceId) return;
  net.room.results = [...net.room.results, m.result];
  if (m.result.id !== net.you) {
    toast(m.result.time === null ? `${m.result.name} gave up` : `${m.result.name} finished ${ordinal(m.place ?? 0)}`, 1400);
  } else if (m.result.time !== null) {
    const { results } = net.room;
    const cpusLeft = net.room.participants.some((id) => id.startsWith('cpu-') && !results.some((r) => r.id === id));
    if (cpusLeft) {
      setStatus(`You finished ${ordinal(m.place ?? 0)} in ${m.result.time.toFixed(2)} s. CPUs still racing get up to 10 s more.`);
    }
  }
  refreshLobby();
}

function onRaceEnd(m: Extract<ServerMessage, { type: 'raceEnd' }>): void {
  if (net.room) {
    Object.assign(net.room, {
      phase: 'lobby', lastResults: m.results, results: [], hostId: m.hostId,
    });
  }
  setCpus(m.cpus);
  if (state.racing) {
    stopRace();
    state.finished = true;
  }
  net.racingIn = false;
  byId<HTMLButtonElement>('start-btn').disabled = false;
  setStatus('');
  showLobby(true);
  startIdleLoop();
  refreshLobby();
}

function onLimbs(m: Extract<ServerMessage, { type: 'limbs' }>): void {
  const racer = net.people.get(m.id) ?? net.cpus.get(m.id);
  if (!racer) return;
  if (m.lost?.length && racer.runner) {
    const pose = sample(racer);
    if (pose) spawnShards(posedRunner(racer, pose), m.lost);
  }
  Object.assign(racer, { limbs: m.limbs, runner: null });
  refreshLobby();
}

function handle(m: ServerMessage): void {
  switch (m.type) {
    case 'welcome': onWelcome(m); break;
    case 'countdown': onCountdown(m); break;
    case 'result': onResult(m); break;
    case 'raceEnd': onRaceEnd(m); break;
    case 'limbs': onLimbs(m); break;
    case 'state': {
      const racer = net.people.get(m.id);
      if (racer) pushSample(racer, m.x, m.y, m.a, m.b);
      break;
    }
    case 'cpuStates':
      m.s.forEach(([id, x, y, a, b]) => {
        const cpu = net.cpus.get(id);
        if (cpu) pushSample(cpu, x, y, a, b);
      });
      break;
    case 'join':
      net.people.set(m.player.id, newRacer(m.player));
      toast(`${m.player.name} joined`, 1200);
      refreshLobby();
      break;
    case 'leave': {
      const who = net.people.get(m.id);
      net.people.delete(m.id);
      const wasHost = isHost();
      if (net.room) net.room.hostId = m.hostId;
      if (who) toast(`${who.name} left`, 1200);
      if (!wasHost && isHost()) toast('You are the host now', 1600);
      refreshLobby();
      break;
    }
    case 'name': {
      const who = net.people.get(m.id);
      if (who) who.name = m.name;
      if (m.id === net.you) nameInput().value = m.name;
      refreshLobby();
      break;
    }
    case 'settings':
      if (net.room) Object.assign(net.room, { isPublic: m.isPublic, name: m.name, nextStage: m.nextStage });
      syncStageSelect();
      refreshLobby();
      break;
    case 'ready':
      if (net.room) net.room.ready = m.ids;
      refreshLobby();
      break;
    case 'emote':
      showEmote(m.id, m.e);
      break;
    case 'cpus':
      setCpus(m.cpus);
      refreshLobby();
      break;
    case 'notice':
      toast(m.message, 2600);
      setStatus(m.message, true);
      break;
    case 'error':
      setStatus(m.message || 'The room refused the connection.', true);
      break;
    default:
      break;
  }
}

/** The host's course picker shows the room's next course. */
function syncStageSelect(): void {
  const select = byId<HTMLSelectElement>('stage-select');
  const value = String(net.room?.nextStage ?? 0);
  if ([...select.options].some((o) => o.value === value)) select.value = value;
}

function setRestartButton(online: boolean): void {
  const button = byId('restart-btn');
  const label = online ? 'Give up this race' : 'Restart stage';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = online ? '✕' : '↻';
}

function join(code: string, setup?: RoomSetup): void {
  closeMenu();
  net.conn?.close();
  net.conn = new RoomConnection(code, () => nameInput().value.trim() || playerName(), {
    message: handle,
    lost: (retrying) => setStatus(retrying ? 'Reconnecting…' : 'Lost connection to the room. Reload the page to try again.', true),
  });
  state.mode = 'online';
  stopRace();
  byId('result').hidden = true;
  const suffix = Number.isInteger(testStage) ? `&teststage=${testStage}` : '';
  window.history.replaceState(null, '', `?room=${code}${suffix}`);
  byId('room-code').textContent = code;
  byId('room-name').textContent = `Room ${code}`;
  byId('online-btn').hidden = true;
  setRestartButton(true);
  updateStageButton();
  state.stage = 0;
  resetStage();
  setStatus('Connecting…');
  showLobby(true);
  net.conn.open(setup);
}

function leave(): void {
  net.conn?.close();
  net.conn = null;
  net.you = null;
  net.room = null;
  net.people.clear();
  net.cpus.clear();
  net.racingIn = false;
  net.following = null;
  net.emotes.clear();
  cancelAnimationFrame(net.idleRaf);
  state.mode = 'solo';
  window.history.replaceState(null, '', window.location.pathname);
  byId('online-btn').hidden = false;
  setRestartButton(false);
  showLobby(false);
  stopRace();
  resetStage();
  updateStageButton();
  showHint(DEFAULT_HINT, 0);
}

function installHooks(): void {
  hooks.onLimbs = (limbs, lost) => {
    if (!net.conn) return;
    send({ type: 'limbs', limbs: encodeLimbs(limbs), lost });
    refreshLobby();
  };
  hooks.onFrame = () => {
    const now = performance.now();
    const due = now - net.lastSend >= SEND_EVERY_MS;
    if (!net.racingIn || !state.player || state.countdownEnd || !due) return;
    net.lastSend = now;
    const { x, y, joints } = state.player;
    send({
      type: 'state', r: net.raceId, x, y, a: joints[0].angle, b: joints[1].angle,
    });
  };
  hooks.onFinish = (time) => {
    if (!net.racingIn) return;
    send({ type: 'finish', r: net.raceId, time });
    net.racingIn = false;
    setStatus(`You finished in ${time.toFixed(2)} s. Waiting for the others…`);
    showLobby(true);
    startIdleLoop();
    refreshLobby();
  };
  // In a room, ✕ means "give up": a shared race cannot be restarted.
  hooks.onRestart = () => {
    if (!net.racingIn) return;
    send({ type: 'giveup', r: net.raceId });
    net.racingIn = false;
    stopRace();
    state.finished = true;
    setStatus('You gave up. Waiting for the others…');
    showLobby(true);
    startIdleLoop();
    refreshLobby();
  };
  // Watching: the camera follows the racer you picked, or whoever is in front.
  hooks.focus = () => {
    const others = racing();
    const followed = others.find(({ racer }) => racer.id === net.following);
    if (followed) return followed.pose;
    return others.reduce<{ x: number; y: number } | null>(
      (best, { pose }) => (!best || pose.x > best.x ? pose : best),
      null,
    );
  };
  hooks.drawWorld = (ctx) => {
    drawRacers(ctx, racing(), emoteOf);
    const mine = net.you ? emoteOf(net.you) : null;
    if (mine && state.player) drawBubble(ctx, labelSpot(state.player), mine);
  };
  hooks.onHud = (progress, startX, span) => {
    const at = (x: number) => `${Math.max(0, Math.min(1, (x - startX) / span)) * 100}%`;
    updateDots(progress, racing(), at);
  };
}

function copyInviteLink(): void {
  if (!net.conn) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${net.conn.code}`;
  const button = byId('copy-link');
  const done = () => {
    button.textContent = 'Copied';
    window.setTimeout(() => {
      button.textContent = 'Copy invite link';
    }, 1500);
  };
  const showLink = () => setStatus(`Invite link: ${link}`);
  if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, showLink);
  else showLink();
}

function bindLobbyButtons(): void {
  byId('leave-btn').addEventListener('click', leave);
  byId('copy-link').addEventListener('click', copyInviteLink);
  nameInput().value = playerName();
  nameInput().addEventListener('change', () => {
    const name = nameInput().value.trim().slice(0, 16);
    if (!name) return;
    setPlayerName(name);
    send({ type: 'name', name });
    refreshLobby();
  });
  byId<HTMLButtonElement>('start-btn').addEventListener('click', (e) => {
    const stage = Number.isInteger(testStage) ? testStage : Number(byId<HTMLSelectElement>('stage-select').value);
    send({ type: 'start', stage });
    (e.currentTarget as HTMLButtonElement).disabled = true;
  });
  byId<HTMLSelectElement>('stage-select').addEventListener('change', (e) => {
    const nextStage = Number((e.currentTarget as HTMLSelectElement).value);
    if (isHost()) send({ type: 'settings', nextStage });
  });
  byId('ready-btn').addEventListener('click', () => {
    if (!net.room || !net.you || net.room.phase !== 'lobby') return;
    send({ type: 'ready', ready: !net.room.ready.includes(net.you) });
  });
  byId('follow-btn').addEventListener('click', followNext);
  const bar = byId('emote-bar');
  EMOTES.forEach((text, e) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('aria-label', `Send ${text}`);
    button.addEventListener('click', () => {
      // The room drops emotes sent faster than this, so don't show them either.
      const now = performance.now();
      if (!net.you || now - net.lastEmote < EMOTE_GAP_MS) return;
      net.lastEmote = now;
      send({ type: 'emote', e });
      showEmote(net.you, e);
    });
    bar.append(button);
  });
  byId('add-cpu').addEventListener('click', () => {
    const difficulty = byId<HTMLSelectElement>('cpu-difficulty').value as 'easy' | 'normal' | 'hard';
    send({ type: 'addCpu', difficulty });
  });
  byId('visibility-btn').addEventListener('click', () => {
    if (net.room) send({ type: 'settings', isPublic: !net.room.isPublic });
  });
}

/** Online play is offered only when the game is served by its Worker. */
export default async function initOnline(): Promise<void> {
  installHooks();
  bindLobbyButtons();
  initMenu({ join, cancel: () => {} });
  byId('online-btn').addEventListener('click', () => {
    if (net.conn) return;
    stopRace();
    byId('result').hidden = true;
    openMenu({ join, cancel: () => {} });
  });
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const health = res.ok ? await res.json() as { ok?: boolean } : null;
    if (!health?.ok) return;
  } catch {
    return;
  }
  byId('online-btn').hidden = false;
  const code = (params.get('room') ?? '').toUpperCase();
  if (CODE_RE.test(code)) join(code);
}
