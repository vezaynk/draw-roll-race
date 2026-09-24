// Draw Roll Race — online rooms (talks to the Durable Object in worker/room.js).
// Every browser runs its own runner's physics; other players are drawn from the
// positions they send, slightly in the past so their motion can be smoothed.
(function () {
  'use strict';
  const G = window.DRRGame;
  const D = window.DRR;
  const { state, hooks } = G;
  const $ = id => document.getElementById(id);

  const SEND_EVERY_MS = 66;   // ~15 position updates per second
  const RENDER_DELAY_MS = 120; // draw other players this far in the past, between two known positions
  const NAME_KEY = 'draw-roll-race-name';

  const net = {
    ws: null, code: null, you: null,
    room: null,              // latest room info from the server
    players: new Map(),      // id -> { id, name, color, limbs, runner, buf: [{t,x,y,a,b}] }
    raceId: 0, racingIn: false, spectating: false,
    lastSend: 0, retries: 0, leaving: false, idleRaf: 0,
  };

  // ---------------- entry points ----------------
  // Only offer rooms when the game is served by its Worker (not from a plain file or static host).
  fetch('/api/health', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j || !j.ok) return;
      $('online-btn').hidden = false;
      const code = new URLSearchParams(location.search).get('room');
      if (code) join(code.toUpperCase());
    })
    .catch(() => {});

  $('online-btn').addEventListener('click', async () => {
    if (net.code) return;
    $('online-btn').disabled = true;
    try {
      const r = await fetch('/api/rooms', { method: 'POST' });
      const { code } = await r.json();
      join(code);
    } catch (e) {
      G.toast('Could not create a room', 1800);
    } finally {
      $('online-btn').disabled = false;
    }
  });

  $('leave-btn').addEventListener('click', leave);

  $('copy-link').addEventListener('click', () => {
    const link = location.origin + location.pathname + '?room=' + net.code;
    const done = () => { $('copy-link').textContent = 'Copied'; setTimeout(() => { $('copy-link').textContent = 'Copy invite link'; }, 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => prompt('Invite link', link));
    else prompt('Invite link', link);
  });

  $('my-name').value = loadName();
  $('my-name').addEventListener('change', () => {
    const name = $('my-name').value.trim().slice(0, 16);
    if (!name) return;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignore */ }
    send({ type: 'name', name });
  });

  $('start-btn').addEventListener('click', () => {
    send({ type: 'start', stage: parseInt($('stage-select').value, 10) });
    $('start-btn').disabled = true;
  });

  function loadName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  // ---------------- connection ----------------
  function join(code) {
    if (!/^[A-HJKMNP-Z2-9]{5}$/.test(code)) { G.toast('That room code is not valid', 1800); return; }
    net.code = code;
    net.leaving = false;
    state.mode = 'online';
    G.stopRace();
    G.hideResult();
    history.replaceState(null, '', '?room=' + code);
    $('room-code').textContent = code;
    $('online-btn').hidden = true;
    $('restart-btn').title = 'Give up this race';
    $('restart-btn').setAttribute('aria-label', 'Give up this race');
    $('restart-btn').textContent = '✕';
    G.updateStageButton();
    G.setStage(0);
    G.resetStage();
    status('Connecting…');
    showLobby(true);
    connect();
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const name = encodeURIComponent($('my-name').value.trim() || loadName());
    const ws = new WebSocket(proto + '//' + location.host + '/api/rooms/' + net.code + '/ws?name=' + name);
    net.ws = ws;
    ws.onopen = () => { net.retries = 0; };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handle(m); };
    ws.onclose = () => {
      if (net.ws !== ws || net.leaving) return;
      net.ws = null;
      if (net.retries >= 5) { status('Lost connection to the room. Reload the page to try again.', true); return; }
      const wait = 500 * Math.pow(2, net.retries++);
      status('Reconnecting…', true);
      setTimeout(() => { if (!net.leaving && net.code) connect(); }, wait);
    };
  }

  function send(msg) {
    if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
  }

  function leave() {
    net.leaving = true;
    if (net.ws) net.ws.close(1000, 'leave');
    net.ws = null; net.code = null; net.you = null; net.room = null;
    net.players.clear();
    net.racingIn = false; net.spectating = false;
    cancelAnimationFrame(net.idleRaf);
    state.mode = 'solo';
    history.replaceState(null, '', location.pathname);
    $('online-btn').hidden = false;
    $('restart-btn').title = 'Restart stage';
    $('restart-btn').setAttribute('aria-label', 'Restart stage');
    $('restart-btn').textContent = '↻';
    showLobby(false);
    G.stopRace();
    G.resetStage();
    G.updateStageButton();
    G.showHint(G.defaultHint, 0);
  }

  // ---------------- messages ----------------
  function handle(m) {
    switch (m.type) {
      case 'welcome': {
        net.you = m.you;
        net.room = m.room;
        net.players.clear();
        for (const p of m.players) if (p.id !== m.you) addPlayer(p);
        const me = m.players.find(p => p.id === m.you);
        if (me && !$('my-name').value) $('my-name').value = me.name;
        if (state.limbs.arm.length || state.limbs.leg.length) send({ type: 'limbs', limbs: encodeLimbs(state.limbs) });
        if (m.room.phase === 'racing') {
          // A race is already running: watch it and join the next one.
          net.raceId = m.room.raceId;
          net.spectating = true; net.racingIn = false;
          G.setStage(m.room.stage);
          G.resetStage();
          state.player = null;
          startIdleLoop();
          status('A race is under way. You can watch it and join the next one.');
        } else {
          status('');
        }
        renderLobby();
        break;
      }
      case 'join': addPlayer(m.player); G.toast(m.player.name + ' joined', 1200); renderLobby(); break;
      case 'leave': {
        const p = net.players.get(m.id);
        net.players.delete(m.id);
        if (net.room) net.room.hostId = m.hostId;
        if (p) G.toast(p.name + ' left', 1200);
        renderLobby();
        break;
      }
      case 'name': {
        const p = net.players.get(m.id);
        if (p) p.name = m.name;
        renderLobby();
        break;
      }
      case 'limbs': {
        const p = net.players.get(m.id);
        if (p) { p.limbs = m.limbs; p.runner = null; }
        renderLobby();
        break;
      }
      case 'countdown': {
        net.room = Object.assign(net.room || {}, { phase: 'racing', stage: m.stage, raceId: m.raceId, participants: m.participants, results: [] });
        net.raceId = m.raceId;
        for (const p of net.players.values()) p.buf = [];
        G.setStage(m.stage);
        G.resetStage();
        if (m.participants.includes(net.you)) {
          net.racingIn = true; net.spectating = false;
          showLobby(false);
          G.startRace({ cpu: false, countdownMs: m.ms });
        } else {
          net.racingIn = false; net.spectating = true;
          state.player = null;
          status('A race is under way. You can watch it and join the next one.');
          startIdleLoop();
        }
        renderLobby();
        break;
      }
      case 'state': {
        const p = net.players.get(m.id);
        if (!p) return;
        p.buf.push({ t: performance.now(), x: m.x, y: m.y, a: m.a, b: m.b });
        if (p.buf.length > 40) p.buf.splice(0, p.buf.length - 40);
        break;
      }
      case 'result': {
        if (!net.room || m.raceId !== net.room.raceId) return;
        net.room.results = (net.room.results || []).concat(m.result);
        if (m.result.id !== net.you) {
          G.toast(m.result.time === null ? m.result.name + ' gave up' : m.result.name + ' finished ' + ordinal(m.place), 1400);
        }
        renderLobby();
        break;
      }
      case 'raceEnd': {
        if (net.room) {
          net.room.phase = 'lobby';
          net.room.lastResults = m.results;
          net.room.results = [];
          net.room.hostId = m.hostId;
        }
        if (state.racing) { G.stopRace(); state.finished = true; }
        net.racingIn = false; net.spectating = false;
        $('start-btn').disabled = false;
        status('');
        showLobby(true);
        startIdleLoop();
        renderLobby();
        break;
      }
      case 'error':
        status(m.message || 'The room refused the connection.', true);
        net.leaving = true;
        break;
    }
  }

  function addPlayer(p) {
    net.players.set(p.id, { id: p.id, name: p.name, color: p.color, limbs: p.limbs, runner: null, buf: [] });
  }

  // ---------------- game hooks ----------------
  hooks.onLimbs = limbs => {
    if (!net.code) return;
    send({ type: 'limbs', limbs: encodeLimbs(limbs) });
    renderLobby();
  };

  hooks.onFrame = () => {
    if (!net.racingIn || !state.player || state.countdownEnd) return;
    const now = performance.now();
    if (now - net.lastSend < SEND_EVERY_MS) return;
    net.lastSend = now;
    const b = state.player;
    send({ type: 'state', r: net.raceId, x: b.x, y: b.y, a: b.joints[0].angle, b: b.joints[1].angle });
  };

  hooks.onFinish = time => {
    if (!net.racingIn) return;
    send({ type: 'finish', r: net.raceId, time });
    net.racingIn = false;
    status('You finished in ' + time.toFixed(2) + ' s. Waiting for the others…');
    showLobby(true);
    startIdleLoop();
    renderLobby();
  };

  hooks.onRestart = () => {
    // In a room the button means "give up": you cannot restart a shared race.
    if (!net.racingIn) return;
    send({ type: 'giveup', r: net.raceId });
    net.racingIn = false;
    G.stopRace();
    state.finished = true;
    status('You gave up. Waiting for the others…');
    showLobby(true);
    startIdleLoop();
    renderLobby();
  };

  hooks.focus = () => {
    // Spectators follow whoever is in front.
    let best = null;
    for (const p of net.players.values()) {
      const s = sample(p);
      if (s && (!best || s.x > best.x)) best = s;
    }
    return best;
  };

  hooks.drawWorld = ctx => {
    if (!net.code) return;
    for (const p of net.players.values()) {
      const s = sample(p);
      if (!s) continue;
      const r = runnerFor(p);
      r.x = s.x; r.y = s.y;
      if (r.joints[0]) r.joints[0].angle = s.a;
      if (r.joints[1]) r.joints[1].angle = s.b;
      G.drawRunner(ctx, r, 0.8);
      ctx.save();
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      const ty = r.y + r.head.y - r.head.r - 7;
      ctx.strokeText(p.name, r.x + r.head.x, ty);
      ctx.fillStyle = p.color;
      ctx.fillText(p.name, r.x + r.head.x, ty);
      ctx.restore();
    }
  };

  const remoteDots = new Map();
  hooks.onHud = (progress, startX, span) => {
    const seen = new Set();
    if (net.code) {
      for (const p of net.players.values()) {
        const s = sample(p);
        if (!s) continue;
        seen.add(p.id);
        let dot = remoteDots.get(p.id);
        if (!dot || !dot.isConnected) {
          dot = document.createElement('div');
          dot.className = 'dot remote';
          dot.style.background = p.color;
          progress.appendChild(dot);
          remoteDots.set(p.id, dot);
        }
        dot.style.left = (Math.max(0, Math.min(1, (s.x - startX) / span)) * 100) + '%';
      }
    }
    for (const [id, dot] of remoteDots) if (!seen.has(id)) { dot.remove(); remoteDots.delete(id); }
  };

  // Keep drawing other players while you are not racing yourself (lobby, after finishing, spectating).
  function startIdleLoop() {
    cancelAnimationFrame(net.idleRaf);
    const tick = () => {
      if (!net.code || state.racing) return;
      G.updateHud();
      G.render();
      net.idleRaf = requestAnimationFrame(tick);
    };
    net.idleRaf = requestAnimationFrame(tick);
  }

  // Position of a remote player RENDER_DELAY_MS ago, blended between the two updates around it.
  function sample(p) {
    if (!net.room || net.room.phase !== 'racing' || !p.buf.length) return null;
    const t = performance.now() - RENDER_DELAY_MS;
    const buf = p.buf;
    if (t <= buf[0].t) return buf[0];
    for (let i = buf.length - 1; i > 0; i--) {
      const a = buf[i - 1], b = buf[i];
      if (t >= a.t && t <= b.t) {
        const k = (t - a.t) / (b.t - a.t || 1);
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: a.a + (b.a - a.a) * k, b: a.b + (b.b - a.b) * k };
      }
    }
    return buf[buf.length - 1];
  }

  function runnerFor(p) {
    if (!p.runner) p.runner = D.createRunner(decodeLimbs(p.limbs), p.color, 1);
    return p.runner;
  }

  // ---------------- limbs on the wire: one stroke per joint as a flat [x0,y0,x1,y1,...] ----------------
  function encodeLimbs(limbs) {
    const out = {};
    for (const k of ['arm', 'leg']) {
      out[k] = (limbs[k] || []).map(s => {
        const pts = D.resample(s, 6);
        const last = s[s.length - 1];
        pts.push(last);
        const flat = [];
        for (const p of pts.slice(0, 120)) flat.push(Math.round(p.x), Math.round(p.y));
        return flat;
      });
    }
    return out;
  }
  function decodeLimbs(limbs) {
    const out = { arm: [], leg: [] };
    if (!limbs) return out;
    for (const k of ['arm', 'leg']) {
      for (const flat of limbs[k] || []) {
        const s = [];
        for (let i = 0; i + 1 < flat.length; i += 2) s.push({ x: flat[i], y: flat[i + 1] });
        if (s.length > 1) out[k].push(s);
      }
    }
    return out;
  }

  // ---------------- lobby UI ----------------
  function showLobby(show) { $('lobby').hidden = !show; }

  function status(text, warn) {
    const el = $('lobby-status');
    el.textContent = text;
    el.classList.toggle('warn', !!warn);
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function renderLobby() {
    if (!net.code) return;
    const room = net.room || {};
    const isHost = room.hostId && room.hostId === net.you;
    const racing = room.phase === 'racing';

    // Players (you first)
    const list = $('player-list');
    list.textContent = '';
    const meDrawn = state.limbs.arm.length || state.limbs.leg.length;
    const rows = [{ id: net.you, name: ($('my-name').value.trim() || 'You'), color: G.COLORS.player, drawn: meDrawn, you: true }];
    for (const p of net.players.values()) {
      rows.push({ id: p.id, name: p.name, color: p.color, drawn: p.limbs && (p.limbs.arm.length || p.limbs.leg.length) });
    }
    for (const r of rows) {
      const li = document.createElement('li');
      const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = r.color;
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = r.name;
      li.append(sw, nm);
      if (r.you) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'you'; li.append(t); }
      if (r.id === room.hostId) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = 'host'; li.append(t); }
      const d = document.createElement('span'); d.className = 'drawn'; d.textContent = r.drawn ? 'ready to roll' : 'no limbs yet';
      li.append(d);
      list.append(li);
    }

    // Results: the race in progress, or the last one
    const results = racing ? (room.results || []) : (room.lastResults || []);
    $('results-box').hidden = !results.length;
    $('results-title').textContent = racing ? 'This race' : 'Last race';
    const ol = $('results-list');
    ol.textContent = '';
    let place = 0;
    for (const r of results) {
      const li = document.createElement('li');
      const pl = document.createElement('span'); pl.className = 'place'; pl.textContent = r.time === null ? '—' : ordinal(++place);
      const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = r.id === net.you ? G.COLORS.player : r.color;
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = r.id === net.you ? 'You' : r.name;
      const tm = document.createElement('span'); tm.className = 'rtime'; tm.textContent = r.time === null ? 'gave up' : r.time.toFixed(2) + ' s';
      li.append(pl, sw, nm, tm);
      ol.append(li);
    }

    // During a race the card shrinks to status and results so the course stays visible.
    $('lobby').classList.toggle('compact', racing);

    // Host controls
    $('host-controls').hidden = !isHost || racing;
    $('start-btn').disabled = racing;
    if (!racing && !$('lobby-status').classList.contains('warn')) {
      if (isHost) status(net.players.size ? 'Draw your runner, pick a course and start when everyone is here.' : 'Share the invite link, then start the race. You can also race alone.');
      else status('Draw your runner. The host starts the race.');
    }
  }
})();
