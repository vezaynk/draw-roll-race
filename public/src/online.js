// Draw Roll Race — online rooms (talks to the Durable Objects in worker/).
// Every browser runs its own runner's physics; other players are drawn from the
// positions they send, slightly in the past so their motion can be smoothed.
// The host's browser also runs the room's CPU racers and sends their positions.
(function () {
  'use strict';
  const G = window.DRRGame;
  const D = window.DRR;
  const { state, hooks } = G;
  const $ = id => document.getElementById(id);

  const MAX_RACERS = 8;
  const SEND_EVERY_MS = 66;    // ~15 position updates per second
  const RENDER_DELAY_MS = 120; // draw others this far in the past, between two known positions
  const NAME_KEY = 'draw-roll-race-name';
  const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

  const net = {
    ws: null, code: null, you: null,
    room: null,              // latest room info from the server
    players: new Map(),      // other people: id -> { id, name, color, limbs, runner, buf }
    cpus: new Map(),         // CPUs: id -> { id, name, color, difficulty, seed, pose, limbs, runner, buf }
    raceId: 0, racingIn: false, spectating: false,
    lastSend: 0, retries: 0, leaving: false, idleRaf: 0,
    // CPU simulation (host only)
    drivers: new Map(), goAt: 0, cpuT: 0, cpuRaf: 0, lastCpuSend: 0,
  };

  // ---------------- entry points ----------------
  // Online play is only offered when the game is served by its Worker.
  fetch('/api/health', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      if (!j || !j.ok) return;
      $('online-btn').hidden = false;
      const code = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
      if (CODE_RE.test(code)) join(code);
    })
    .catch(() => {});

  $('online-btn').addEventListener('click', openMenu);
  $('menu-close').addEventListener('click', closeMenu);
  $('refresh-rooms').addEventListener('click', loadPublicRooms);
  $('leave-btn').addEventListener('click', leave);

  $('create-btn').addEventListener('click', async () => {
    $('create-btn').disabled = true;
    try {
      const r = await fetch('/api/rooms', { method: 'POST' });
      const { code } = await r.json();
      const isPublic = document.querySelector('input[name="visibility"]:checked').value === 'public';
      join(code, { isPublic, roomName: $('new-room-name').value.trim() });
    } catch (e) {
      $('join-error').textContent = 'Could not create a room. Check your connection and try again.';
    } finally {
      $('create-btn').disabled = false;
    }
  });

  $('join-form').addEventListener('submit', e => {
    e.preventDefault();
    tryJoin($('join-code').value.trim().toUpperCase());
  });

  async function tryJoin(code) {
    $('join-error').textContent = '';
    if (!CODE_RE.test(code)) { $('join-error').textContent = 'Room codes are 5 letters or digits, like K7Q2M.'; return; }
    try {
      const info = await (await fetch('/api/rooms/' + code, { cache: 'no-store' })).json();
      if (!info.exists) { $('join-error').textContent = 'No room is open with code ' + code + '. Check the code, or create a room.'; return; }
      if (info.full) { $('join-error').textContent = 'That room is full (8 racers).'; return; }
    } catch (e) {
      $('join-error').textContent = 'Could not reach the room. Check your connection and try again.';
      return;
    }
    join(code);
  }

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
    renderLobby();
  });

  $('start-btn').addEventListener('click', () => {
    send({ type: 'start', stage: parseInt($('stage-select').value, 10) });
    $('start-btn').disabled = true;
  });
  $('add-cpu').addEventListener('click', () => send({ type: 'addCpu', difficulty: $('cpu-difficulty').value }));
  $('visibility-btn').addEventListener('click', () => {
    if (net.room) send({ type: 'settings', isPublic: !net.room.isPublic });
  });

  function loadName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  // ---------------- online menu ----------------
  let menuTimer = 0;
  function openMenu() {
    if (net.code) return;
    G.stopRace();
    G.hideResult();
    $('join-error').textContent = '';
    const me = loadName();
    $('new-room-name').placeholder = (me || 'My') + "'s room";
    $('online-menu').hidden = false;
    loadPublicRooms();
    clearInterval(menuTimer);
    menuTimer = setInterval(loadPublicRooms, 5000);
  }
  function closeMenu() {
    $('online-menu').hidden = true;
    clearInterval(menuTimer);
  }

  async function loadPublicRooms() {
    const ul = $('public-rooms');
    let rooms;
    try { rooms = (await (await fetch('/api/rooms', { cache: 'no-store' })).json()).rooms || []; }
    catch (e) { rooms = null; }
    ul.textContent = '';
    if (!rooms || !rooms.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = rooms ? 'No public rooms right now. Create one and others can join it.' : 'Could not load public rooms.';
      ul.append(li);
      return;
    }
    for (const r of rooms) {
      const li = document.createElement('li');
      const info = document.createElement('div'); info.className = 'rinfo';
      const nm = document.createElement('span'); nm.className = 'rname'; nm.textContent = r.name;
      const meta = document.createElement('span'); meta.className = 'rmeta';
      meta.textContent = plural(r.players, 'player') + (r.cpus ? ' + ' + plural(r.cpus, 'CPU') : '') + ' · ' +
        (r.phase === 'racing' ? 'racing now' : 'in the lobby');
      info.append(nm, meta);
      const btn = document.createElement('button'); btn.type = 'button';
      btn.textContent = r.players >= MAX_RACERS ? 'Full' : 'Join';
      btn.disabled = r.players >= MAX_RACERS;
      btn.addEventListener('click', () => tryJoin(r.code));
      li.append(info, btn);
      ul.append(li);
    }
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // ---------------- connection ----------------
  // `create` ({ isPublic, roomName }) is only given by the person creating the room.
  function join(code, create) {
    closeMenu();
    net.code = code;
    net.leaving = false;
    net.retries = 0;
    state.mode = 'online';
    G.stopRace();
    G.hideResult();
    history.replaceState(null, '', '?room=' + code);
    $('room-code').textContent = code;
    $('room-name').textContent = 'Room ' + code;
    $('online-btn').hidden = true;
    $('restart-btn').title = 'Give up this race';
    $('restart-btn').setAttribute('aria-label', 'Give up this race');
    $('restart-btn').textContent = '✕';
    G.updateStageButton();
    G.setStage(0);
    G.resetStage();
    status('Connecting…');
    showLobby(true);
    connect(create);
  }

  function connect(create) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ name: $('my-name').value.trim() || loadName() });
    if (create) { q.set('public', create.isPublic ? '1' : '0'); if (create.roomName) q.set('room_name', create.roomName); }
    const ws = new WebSocket(proto + '//' + location.host + '/api/rooms/' + net.code + '/ws?' + q);
    net.ws = ws;
    ws.onopen = () => { net.retries = 0; };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } handle(m); };
    ws.onclose = () => {
      if (net.ws !== ws || net.leaving) return;
      net.ws = null;
      stopCpus();
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
    stopCpus();
    net.ws = null; net.code = null; net.you = null; net.room = null;
    net.players.clear(); net.cpus.clear();
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
        setCpus(m.room.cpus || []);
        for (const [id, limbs] of Object.entries(m.cpuLimbs || {})) { const c = net.cpus.get(id); if (c) { c.limbs = limbs; c.runner = null; } }
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
        const wasHost = isHost();
        if (net.room) net.room.hostId = m.hostId;
        if (p) G.toast(p.name + ' left', 1200);
        if (!wasHost && isHost()) {
          G.toast('You are the host now', 1600);
          if (net.room.phase === 'racing') adoptCpus();
        }
        renderLobby();
        break;
      }
      case 'name': {
        const p = net.players.get(m.id);
        if (p) p.name = m.name;
        renderLobby();
        break;
      }
      case 'settings': {
        if (net.room) { net.room.isPublic = m.isPublic; net.room.name = m.name; }
        renderLobby();
        break;
      }
      case 'cpus': setCpus(m.cpus); renderLobby(); break;
      case 'limbs': {
        const p = net.players.get(m.id) || net.cpus.get(m.id);
        if (p) { p.limbs = m.limbs; p.runner = null; if (m.pose) p.pose = m.pose; }
        renderLobby();
        break;
      }
      case 'countdown': {
        net.room = Object.assign(net.room || {}, { phase: 'racing', stage: m.stage, raceId: m.raceId, participants: m.participants, results: [] });
        net.raceId = m.raceId;
        setCpus(m.cpus || []);
        for (const c of net.cpus.values()) { c.buf = []; c.limbs = null; c.runner = null; c.pose = 'wheel'; }
        for (const p of net.players.values()) p.buf = [];
        G.setStage(m.stage);
        G.resetStage();
        net.goAt = performance.now() + m.ms;
        if (isHost()) startCpus(m.ms);
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
        if (p) pushSample(p, m.x, m.y, m.a, m.b);
        break;
      }
      case 'cpuStates': {
        for (const [id, x, y, a, b] of m.s) {
          const c = net.cpus.get(id);
          if (c) pushSample(c, x, y, a, b);
        }
        break;
      }
      case 'result': {
        if (!net.room || m.raceId !== net.room.raceId) return;
        net.room.results = (net.room.results || []).concat(m.result);
        if (m.result.id !== net.you) {
          G.toast(m.result.time === null ? m.result.name + ' gave up' : m.result.name + ' finished ' + ordinal(m.place), 1400);
        } else if (m.result.time !== null) {
          const cpusLeft = (net.room.participants || []).some(id => id.startsWith('cpu-') && !net.room.results.some(r => r.id === id));
          if (cpusLeft) status('You finished ' + ordinal(m.place) + ' in ' + m.result.time.toFixed(2) + ' s. CPUs still racing get up to 10 s more.');
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
        stopCpus();
        setCpus(m.cpus || []);
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

  function isHost() { return !!(net.room && net.you && net.room.hostId === net.you); }

  function addPlayer(p) {
    net.players.set(p.id, { id: p.id, name: p.name, color: p.color, limbs: p.limbs, runner: null, buf: [] });
  }

  // Keep what we know about each CPU (limbs, recent positions) across updates to the list.
  function setCpus(list) {
    const next = new Map();
    for (const c of list) {
      const old = net.cpus.get(c.id);
      next.set(c.id, Object.assign(old || { runner: null, buf: [], limbs: null }, c));
    }
    net.cpus = next;
  }

  function pushSample(p, x, y, a, b) {
    p.buf.push({ t: performance.now(), x, y, a, b });
    if (p.buf.length > 40) p.buf.splice(0, p.buf.length - 40);
  }

  // ---------------- CPUs (run by the host) ----------------
  function makeDriver(c) {
    return D.createCpu(state.course, {
      seed: c.seed, difficulty: c.difficulty, color: c.color,
      onSwap: (limbs, pose) => { c.pose = pose; send({ type: 'cpuLimbs', id: c.id, pose, limbs: encodeLimbs(limbs) }); },
    });
  }

  function startCpus(countdownMs) {
    stopCpus();
    for (const c of net.cpus.values()) net.drivers.set(c.id, makeDriver(c));
    net.cpuT = 0;
    net.goAt = performance.now() + countdownMs;
    runCpus();
  }

  // A new host takes over the CPUs from where they were last seen.
  function adoptCpus() {
    stopCpus();
    const done = new Set((net.room.results || []).map(r => r.id));
    for (const c of net.cpus.values()) {
      if (done.has(c.id) || !(net.room.participants || []).includes(c.id)) continue;
      const drv = makeDriver(c);
      const s = c.buf[c.buf.length - 1];
      if (s) drv.placeAt(s.x, s.y, s.a, s.b, c.pose);
      net.drivers.set(c.id, drv);
    }
    net.cpuT = Math.max(0, (performance.now() - net.goAt) / 1000);
    runCpus();
  }

  // CPUs run on their own clock, so they keep going after the host finishes or gives up.
  function runCpus() {
    cancelAnimationFrame(net.cpuRaf);
    const tick = () => {
      if (!net.drivers.size || !net.room || net.room.phase !== 'racing') return;
      const now = performance.now();
      if (now >= net.goAt) {
        const target = Math.min((now - net.goAt) / 1000, net.cpuT + 0.25); // catch up at most 0.25 s per frame
        while (net.cpuT < target) {
          net.cpuT += D.CFG.DT;
          for (const [id, drv] of net.drivers) {
            drv.step(D.CFG.DT, net.cpuT);
            if (drv.finishTime !== null && !drv.reported) {
              drv.reported = true;
              send({ type: 'cpuFinish', r: net.raceId, id, time: drv.finishTime });
            }
          }
        }
        if (now - net.lastCpuSend >= SEND_EVERY_MS) {
          net.lastCpuSend = now;
          const s = [];
          for (const [id, drv] of net.drivers) {
            const rn = drv.runner;
            s.push([id, rn.x, rn.y, rn.joints[0] ? rn.joints[0].angle : 0, rn.joints[1] ? rn.joints[1].angle : 0]);
          }
          send({ type: 'cpuStates', r: net.raceId, s });
        }
      }
      net.cpuRaf = requestAnimationFrame(tick);
    };
    net.cpuRaf = requestAnimationFrame(tick);
  }

  function stopCpus() {
    cancelAnimationFrame(net.cpuRaf);
    net.drivers.clear();
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

  // Everyone else in the race: [{ p, s: {x, y, a, b}, runner, live }]
  function others() {
    const out = [];
    if (!net.room || net.room.phase !== 'racing') return out;
    for (const p of net.players.values()) {
      const s = sample(p);
      if (s) out.push({ p, s, runner: runnerFor(p) });
    }
    for (const c of net.cpus.values()) {
      const drv = net.drivers.get(c.id);
      if (drv) {
        const rn = drv.runner; // the host draws its own CPUs directly
        out.push({ p: c, s: { x: rn.x, y: rn.y }, runner: rn, live: true });
      } else {
        const s = sample(c);
        if (s) out.push({ p: c, s, runner: runnerFor(c) });
      }
    }
    return out;
  }

  hooks.focus = () => {
    // Spectators follow whoever is in front.
    let best = null;
    for (const o of others()) if (!best || o.s.x > best.x) best = o.s;
    return best;
  };

  hooks.drawWorld = ctx => {
    if (!net.code) return;
    const labels = [];
    for (const { p, s, runner: r, live } of others()) {
      if (!live) {
        r.x = s.x; r.y = s.y;
        if (r.joints[0]) r.joints[0].angle = s.a;
        if (r.joints[1]) r.joints[1].angle = s.b;
      }
      G.drawRunner(ctx, r, 0.8);
      labels.push({ text: p.name, color: p.color, x: r.x + r.head.x, y: r.y + r.head.y - r.head.r - 7 });
    }
    // Name labels on top of all runners; when racers bunch up, stack the labels instead of overlapping them.
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    const placed = [];
    labels.sort((a, b) => a.x - b.x);
    for (const l of labels) {
      const w = ctx.measureText(l.text).width + 6;
      let y = l.y;
      for (let tries = 0; tries < 8 && placed.some(q => Math.abs(q.x - l.x) < (q.w + w) / 2 && Math.abs(q.y - y) < 12); tries++) y -= 12;
      placed.push({ x: l.x, y, w });
      ctx.strokeText(l.text, l.x, y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, y);
    }
    ctx.restore();
  };

  const remoteDots = new Map();
  hooks.onHud = (progress, startX, span) => {
    const seen = new Set();
    if (net.code) {
      for (const { p, s } of others()) {
        seen.add(p.id);
        let dot = remoteDots.get(p.id);
        if (!dot || !dot.isConnected) {
          dot = document.createElement('div');
          dot.className = 'dot remote';
          progress.appendChild(dot);
          remoteDots.set(p.id, dot);
        }
        dot.style.background = p.color;
        dot.style.left = (Math.max(0, Math.min(1, (s.x - startX) / span)) * 100) + '%';
      }
    }
    for (const [id, dot] of remoteDots) if (!seen.has(id)) { dot.remove(); remoteDots.delete(id); }
  };

  // Keep drawing others while you are not racing yourself (lobby, after finishing, spectating).
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

  // Position of a remote racer RENDER_DELAY_MS ago, blended between the two updates around it.
  function sample(p) {
    if (!p.buf.length) return null;
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
    if (!p.runner) p.runner = D.createRunner(p.limbs ? decodeLimbs(p.limbs) : D.POSES.wheel, p.color, 1);
    return p.runner;
  }

  // ---------------- limbs on the wire: one stroke per joint as a flat [x0,y0,x1,y1,...] ----------------
  function encodeLimbs(limbs) {
    const out = {};
    for (const k of ['arm', 'leg']) {
      out[k] = (limbs[k] || []).map(s => {
        const pts = D.resample(s, 6);
        pts.push(s[s.length - 1]);
        const flat = [];
        for (const p of pts.slice(0, 120)) flat.push(Math.round(p.x), Math.round(p.y));
        return flat;
      });
    }
    return out;
  }
  function decodeLimbs(limbs) {
    const out = { arm: [], leg: [] };
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

  function tag(text) { const t = document.createElement('span'); t.className = 'tag'; t.textContent = text; return t; }
  function swatch(color) { const s = document.createElement('span'); s.className = 'swatch'; s.style.background = color; return s; }

  function renderLobby() {
    if (!net.code) return;
    const room = net.room || {};
    const host = isHost();
    const racing = room.phase === 'racing';
    const racers = 1 + net.players.size + net.cpus.size;

    $('room-name').textContent = room.name || 'Room ' + net.code;
    const vis = $('room-visibility');
    vis.textContent = room.isPublic ? 'Public' : 'Private';
    vis.classList.toggle('public', !!room.isPublic);
    $('racer-count').textContent = racers + ' / ' + MAX_RACERS + ' racers';

    // Racers: you, other people, then CPUs
    const list = $('player-list');
    list.textContent = '';
    const meDrawn = state.limbs.arm.length || state.limbs.leg.length;
    const addRow = (color, name, tags, note, extra) => {
      const li = document.createElement('li');
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = name;
      li.append(swatch(color), nm, ...tags);
      const d = document.createElement('span'); d.className = 'drawn'; d.textContent = note;
      li.append(d);
      if (extra) li.append(extra);
      list.append(li);
    };
    addRow(G.COLORS.player, $('my-name').value.trim() || 'You', [tag('you')].concat(room.hostId === net.you ? [tag('host')] : []),
      meDrawn ? 'ready to roll' : 'no limbs yet');
    for (const p of net.players.values()) {
      const drawn = p.limbs && (p.limbs.arm.length || p.limbs.leg.length);
      addRow(p.color, p.name, p.id === room.hostId ? [tag('host')] : [], drawn ? 'ready to roll' : 'no limbs yet');
    }
    for (const c of net.cpus.values()) {
      let remove = null;
      if (host && !racing) {
        remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'remove-cpu'; remove.textContent = '✕';
        remove.setAttribute('aria-label', 'Remove ' + c.name);
        remove.addEventListener('click', () => send({ type: 'removeCpu', id: c.id }));
      }
      addRow(c.color, c.name, [tag('cpu')], c.difficulty, remove);
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
      const nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = r.id === net.you ? 'You' : r.name;
      const tm = document.createElement('span'); tm.className = 'rtime';
      tm.textContent = r.time !== null ? r.time.toFixed(2) + ' s' : r.dnf ? 'did not finish' : 'gave up';
      li.append(pl, swatch(r.id === net.you ? G.COLORS.player : r.color), nm);
      if (r.cpu) li.append(tag('cpu'));
      li.append(tm);
      ol.append(li);
    }

    // Host controls
    $('lobby').classList.toggle('compact', racing);
    $('host-controls').hidden = !host || racing;
    $('cpu-controls').hidden = !host || racing;
    $('add-cpu').disabled = racers >= MAX_RACERS;
    $('add-cpu').title = racers >= MAX_RACERS ? 'The room is full' : '';
    $('visibility-btn').textContent = room.isPublic ? 'Make private' : 'Make public';
    $('start-btn').disabled = racing;
    if (!racing && !$('lobby-status').classList.contains('warn')) {
      if (host) status(racers > 1 ? 'Draw your runner, pick a course and start when everyone is here.' : 'Invite friends with the link, or add CPUs to fill the open slots.');
      else status('Draw your runner. The host starts the race.');
    }
  }
})();
