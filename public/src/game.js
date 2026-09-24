// Draw Roll Race — input, rendering and race flow.
(function () {
  'use strict';
  const D = window.DRR;
  const { CFG, FIG } = D;

  const VIEW_W = 560;       // world units visible across the screen (at most)
  // Solo CPUs; red is always you.
  const CPU_COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e'];
  const GHOST_COLOR = '#8d96a8';
  const GHOST_KEY = 'draw-roll-race-ghosts';
  const MAX_GHOSTS = 12;

  const $ = id => document.getElementById(id);
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COLORS = { ink: cssVar('--ink'), player: cssVar('--player'), cpu: cssVar('--cpu'), ground: cssVar('--ground') };

  // ---------------- Saved progress (best effort: storage may be unavailable) ----------------
  const SAVE_KEY = 'draw-roll-race';
  const DEFAULTS = {
    stage: 0, unlocked: 0, best: {},
    cpuCount: 1, cpuDifficulty: 'normal', sound: true, vibrate: true, ghost: true, pad: 'normal',
    seenTips: {}, tutorialDone: false, player: '',
  };
  let firstVisit = false;
  const save = (() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      firstVisit = !raw;
      return Object.assign({}, DEFAULTS, JSON.parse(raw || '{}'));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  })();
  if (!save.player) {
    // Anonymous id for the daily leaderboard.
    const bytes = crypto.getRandomValues(new Uint8Array(18));
    save.player = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, c => ({ '+': '-', '/': '_', '=': '' }[c]));
  }
  // New players start with the tutorial.
  if (firstVisit) save.stage = D.TUTORIAL;
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }
  persist();

  // ---------------- State ----------------
  const state = {
    stage: save.stage,
    course: D.buildCourse(save.stage),
    limbs: { arm: [], leg: [] },
    player: null,
    cpus: [],              // solo CPU drivers (cpu.js)
    cpuTime: null,         // when the first CPU finished
    ghost: null,           // best run on this course, replayed while racing
    trace: null,           // the run being recorded
    daily: null,           // { day } while playing the daily course
    tipsShown: {},
    racing: false, finished: false, time: 0,
    section: null,
    mode: 'solo',          // 'solo' or 'online' (online.js switches it)
    countdownEnd: 0,       // performance.now() when the countdown reaches GO, 0 if none
  };
  // online.js fills these in; the solo game never needs them.
  const hooks = {};

  // ---------------- Drawing pad ----------------
  const pad = $('pad');
  const pctx = pad.getContext('2d');
  let stroke = null;

  function padPoint(e) {
    const r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height };
  }
  function polyline(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  function renderPad() {
    pctx.clearRect(0, 0, pad.width, pad.height);
    pctx.lineCap = 'round'; pctx.lineJoin = 'round';
    // faint ghost of the mirrored copy so players understand the symmetry
    pctx.strokeStyle = 'rgba(239,90,60,0.18)'; pctx.lineWidth = 5;
    for (const [kind, j] of [['arm', FIG.shoulder], ['leg', FIG.hip]]) {
      for (const s of state.limbs[kind]) polyline(pctx, s.map(p => ({ x: 2 * j.x - p.x, y: 2 * j.y - p.y })));
    }
    // figure
    pctx.strokeStyle = COLORS.ink; pctx.lineWidth = 4;
    polyline(pctx, [FIG.neck, FIG.hip]);
    pctx.beginPath(); pctx.arc(FIG.head.x, FIG.head.y, FIG.head.r, 0, Math.PI * 2);
    pctx.fillStyle = '#fff'; pctx.fill(); pctx.stroke();
    // limbs
    pctx.strokeStyle = COLORS.player; pctx.lineWidth = 5;
    for (const s of [...state.limbs.arm, ...state.limbs.leg]) polyline(pctx, s);
    if (stroke && stroke.length > 1) { pctx.globalAlpha = 0.55; polyline(pctx, stroke); pctx.globalAlpha = 1; }
    // joints; while drawing, ring the one the stroke will attach to
    const target = stroke ? jointFor(stroke[0]) : null;
    for (const j of [FIG.shoulder, FIG.hip]) {
      if (j === target) {
        pctx.beginPath(); pctx.arc(j.x, j.y, 12, 0, Math.PI * 2);
        pctx.strokeStyle = COLORS.player; pctx.lineWidth = 2.5; pctx.stroke();
      }
      pctx.beginPath(); pctx.arc(j.x, j.y, 6, 0, Math.PI * 2);
      pctx.fillStyle = COLORS.player; pctx.fill();
    }
  }
  function jointFor(p) {
    const dS = Math.hypot(p.x - FIG.shoulder.x, p.y - FIG.shoulder.y);
    const dH = Math.hypot(p.x - FIG.hip.x, p.y - FIG.hip.y);
    return dS < dH ? FIG.shoulder : FIG.hip;
  }

  pad.addEventListener('pointerdown', e => {
    if (!$('result').hidden) return;
    stroke = [padPoint(e)];
    pad.setPointerCapture(e.pointerId);
    renderPad();
  });
  pad.addEventListener('pointermove', e => {
    if (!stroke) return;
    const p = padPoint(e);
    if (p.x < 0 || p.y < 0 || p.x > pad.width || p.y > pad.height) return;
    const last = stroke[stroke.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 4) { stroke.push(p); renderPad(); }
  });
  function endStroke() {
    if (!stroke) return;
    const s = stroke;
    stroke = null;
    if (s.length >= 3) {
      // Attach to whichever joint the stroke started closer to, shifting it so it starts there.
      const j = jointFor(s[0]);
      const kind = j === FIG.shoulder ? 'arm' : 'leg';
      const dx = j.x - s[0].x, dy = j.y - s[0].y;
      state.limbs[kind] = [s.map(p => ({ x: p.x + dx, y: p.y + dy }))];
      onLimbsChanged();
    } else {
      showHint('Drag to draw a line — a tap is too short');
    }
    renderPad();
  }
  pad.addEventListener('pointerup', endStroke);
  pad.addEventListener('pointercancel', endStroke);

  const HINT = $('pad-hint').textContent;
  let hintTimer = 0;
  function showHint(text, ms) {
    const el = $('pad-hint');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(hintTimer);
    if (ms !== 0) hintTimer = setTimeout(() => el.classList.add('hidden'), ms || 2200);
  }

  function onLimbsChanged() {
    clearTimeout(hintTimer);
    $('pad-hint').classList.add('hidden');
    if (hooks.onLimbs) hooks.onLimbs(state.limbs);
    sfx('swap');
    if (state.racing) {
      state.player = D.swapLimbs(state.course, state.player, state.limbs);
      recordLimbs();
    }
    else if (state.mode === 'online') {
      // In a room the host starts races; just show the new drawing at the start line.
      state.player = D.createRunner(state.limbs, COLORS.player, 1);
      D.settle(state.course, state.player, state.course.startX);
      render();
    } else if (!state.finished) startRace();
  }

  // ---------------- HUD ----------------
  const progress = $('progress');
  const dots = {};
  function buildProgress() {
    progress.innerHTML = '';
    const c = state.course, span = c.finishX - c.startX;
    for (const s of c.sections) {
      if (!D.SECTIONS[s.type].pose && s.type !== 'crawl') continue;
      const z = document.createElement('div');
      z.className = 'zone';
      z.style.left = ((s.from - c.startX) / span * 100) + '%';
      z.style.width = ((s.to - s.from) / span * 100) + '%';
      progress.appendChild(z);
    }
    dots.ghost = document.createElement('div');
    dots.ghost.className = 'dot ghost';
    progress.appendChild(dots.ghost);
    dots.cpus = [];
    dots.player = document.createElement('div');
    dots.player.className = 'dot player';
    progress.appendChild(dots.player);
    const flag = document.createElement('span');
    flag.className = 'flag'; flag.textContent = '🏁';
    progress.appendChild(flag);
    $('stage-label').textContent = stageName(state.stage);
    updateStageButton();
  }
  function stageName(n) {
    if (state.daily && n === D.dailyStage(state.daily.day)) return 'Daily course';
    if (n === D.TUTORIAL) return 'Tutorial';
    return D.TEST_STAGES[n] ? 'Test course' : n >= D.RANDOM_BASE ? 'Random course' : n < D.STAGES.length ? 'Stage ' + (n + 1) + ' / ' + D.STAGES.length : 'Endless ' + (n - D.STAGES.length + 1);
  }
  function updateHud() {
    const c = state.course, span = c.finishX - c.startX;
    const at = x => (Math.max(0, Math.min(1, (x - c.startX) / span)) * 100) + '%';
    dots.player.hidden = !state.player;
    if (state.player) dots.player.style.left = at(state.player.x);
    while (dots.cpus.length < state.cpus.length) {
      const d = document.createElement('div');
      d.className = 'dot cpu';
      progress.insertBefore(d, dots.player);
      dots.cpus.push(d);
    }
    dots.cpus.forEach((d, i) => {
      const drv = state.cpus[i];
      d.hidden = !drv;
      if (drv) { d.style.background = drv.runner.color; d.style.left = at(drv.runner.x); }
    });
    const g = state.racing && ghostAt(state.time);
    dots.ghost.hidden = !g;
    if (g) dots.ghost.style.left = at(g.x);
    if (hooks.onHud) hooks.onHud(progress, c.startX, span);
    $('timer').textContent = state.time.toFixed(2) + ' s';
    const px = state.player ? state.player.x : c.startX;
    const sec = c.sections.find(s => px >= s.from && px < s.to) || null;
    // Tips: always in the tutorial, otherwise the first time you meet each obstacle.
    if (state.racing && state.mode === 'solo') {
      const next = c.sections.find(s => s.from > px - 20 && s.from - px < 260);
      if (next && !state.tipsShown[next.type] && (state.stage === D.TUTORIAL || !save.seenTips[next.type])) {
        state.tipsShown[next.type] = true;
        showHint(D.TIPS[next.type], state.stage === D.TUTORIAL ? 6000 : 4500);
        if (state.stage !== D.TUTORIAL) { save.seenTips[next.type] = true; persist(); }
      }
    }
    if (sec !== state.section) {
      state.section = sec;
      $('section-label').textContent = sec ? sec.label : state.cpuTime !== null ? 'CPU finished' : '';
      if (sec && state.racing) toast(sec.label, 1100);
    }
  }
  let toastTimer = 0;
  function toast(text, ms) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------------- Race flow ----------------
  function resetStage() {
    state.course = D.buildCourse(state.stage);
    state.countdownEnd = 0;
    state.player = null; state.cpus = [];
    state.racing = false; state.finished = false; state.time = 0; state.cpuTime = null;
    state.section = null;
    buildProgress();
    // idle preview of the player's current drawing at the start line
    if (state.limbs.arm.length || state.limbs.leg.length) {
      state.player = D.createRunner(state.limbs, COLORS.player, 1);
      D.settle(state.course, state.player, state.course.startX);
    }
    updateHud();
    render();
  }

  // opts.cpu: race the CPU (default true). opts.countdownMs: hold everyone still for a 3-2-1 first.
  function startRace(opts) {
    opts = opts || {};
    const c = state.course;
    state.player = D.createRunner(state.limbs, COLORS.player, 1);
    D.settle(c, state.player, c.startX);
    state.cpus = [];
    if (opts.cpu !== false && state.stage !== D.TUTORIAL) {
      // New personalities every race, so CPUs never play the same way twice.
      for (let i = 0; i < save.cpuCount; i++) {
        const difficulty = save.cpuDifficulty === 'mixed' ? D.CPU_DIFFICULTIES[i % D.CPU_DIFFICULTIES.length] : save.cpuDifficulty;
        state.cpus.push(D.createCpu(c, {
          seed: (Math.random() * 1e9) | 0, difficulty, color: CPU_COLORS[i % CPU_COLORS.length],
          onSwap: (limbs, pose, lost, old) => { if (lost && old) spawnShards(old, lost); },
        }));
      }
    }
    state.cpuTime = null;
    state.tipsShown = {};
    state.ghost = state.mode === 'solo' && save.ghost ? loadGhost(ghostKey()) : null;
    state.trace = { samples: [[0, round1(state.player.x), round1(state.player.y), 0, 0]], limbs: [[0, D.encodeLimbs(state.limbs)]], lastT: 0 };
    state.time = 0; state.racing = true; state.finished = false;
    state.countdownEnd = opts.countdownMs ? performance.now() + opts.countdownMs : 0;
    countdownShown = null;
    updateStageButton();
    if (!state.countdownEnd) { toast('GO!', 700); sfx('go'); }
    lastTs = 0; acc = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stepCpus() {
    for (const drv of state.cpus) {
      if (drv.finishTime !== null) continue;
      drv.step(CFG.DT, state.time);
      if (drv.finishTime !== null && state.cpuTime === null) {
        state.cpuTime = drv.finishTime;
        toast('A CPU finished!', 1600);
        showHint('A CPU finished first. Keep going, or tap ↻ to restart.', 3500);
        $('section-label').textContent = 'CPU finished';
      }
    }
  }

  let lastTs = 0, acc = 0, rafId = 0, countdownShown = null;
  function frame(ts) {
    if (!state.racing) return;
    if (state.countdownEnd) {
      const left = state.countdownEnd - performance.now();
      if (left > 0) {
        const n = Math.min(3, Math.ceil(left / 1000));
        if (n !== countdownShown) { countdownShown = n; toast(String(n), 900); sfx('count'); }
        render();
        rafId = requestAnimationFrame(frame);
        return;
      }
      state.countdownEnd = 0;
      toast('GO!', 700);
      sfx('go');
      if (!state.limbs.arm.length && !state.limbs.leg.length) showHint('Draw legs to start moving', 3000);
      lastTs = 0;
    }
    if (!lastTs) lastTs = ts;
    acc += Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    while (acc >= CFG.DT) {
      acc -= CFG.DT;
      state.time += CFG.DT;
      D.step(state.course, state.player, CFG.DT);
      const broken = D.shatter(state.course, state.player, state.limbs);
      if (broken) onShatter(broken);
      stepCpus();
      recordSample();
      if (hooks.onStep) hooks.onStep(CFG.DT, state.time);
      if (state.player.x >= state.course.finishX) { finish(); break; }
      // Fell out of the world somehow: put the runner back on the ground.
      if (state.player.y > D.groundAt(state.course, state.player.x) + 400) {
        D.settle(state.course, state.player, state.player.x);
        state.player.vx = state.player.vy = 0;
      }
    }
    if (hooks.onFrame) hooks.onFrame();
    updateHud();
    render();
    if (state.racing) rafId = requestAnimationFrame(frame);
  }

  // Spikes broke one or both limbs: throw the pieces, clear them from the pad, ask for a redraw.
  const LIMB_NAMES = { arm: 'Arms', leg: 'Legs' };
  function onShatter(broken) {
    spawnShards(state.player, broken.lost);
    state.limbs = broken.limbs;
    state.player = broken.runner;
    recordLimbs();
    renderPad();
    const what = broken.lost.map(k => LIMB_NAMES[k]).join(' and ');
    toast(what + ' shattered!', 1200);
    showHint('Spikes broke your ' + what.toLowerCase() + '. Draw new ones.', 2600);
    sfx('shatter');
    if (hooks.onLimbs) hooks.onLimbs(state.limbs, broken.lost);
  }

  function finish() {
    state.racing = false; state.finished = true;
    updateStageButton();
    if (state.mode === 'online') {
      updateHud();
      render();
      if (hooks.onFinish) hooks.onFinish(state.time);
      return;
    }
    const place = 1 + state.cpus.filter(d => d.finishTime !== null && d.finishTime <= state.time).length;
    const win = place === 1;
    const tutorial = state.stage === D.TUTORIAL;
    const title = $('result-title');
    title.textContent = tutorial ? 'Tutorial complete!' : win ? (state.cpus.length ? 'You win!' : 'Finished!') : 'You finished ' + ordinal(place);
    title.className = win ? 'win' : 'lose';
    $('result-stage').textContent = stageName(state.stage);
    $('result-time').textContent = state.time.toFixed(2) + ' s';
    const firstCpu = state.cpus.filter(d => d.finishTime !== null).sort((a, b) => a.finishTime - b.finishTime)[0];
    $('result-cpu').textContent = !state.cpus.length ? '' : win
      ? (state.cpus.length === 1 ? 'The CPU was still racing' : 'All ' + state.cpus.length + ' CPUs were still racing')
      : 'Fastest CPU: ' + firstCpu.finishTime.toFixed(2) + ' s';
    const key = bestKey();
    const prev = save.best[key];
    const best = $('result-best');
    const newBest = prev === undefined || state.time < prev;
    if (newBest) {
      save.best[key] = +state.time.toFixed(2);
      best.textContent = prev === undefined ? 'First finish on this course!' : 'New best! (was ' + prev.toFixed(2) + ' s)';
      best.className = 'new';
      saveGhost(ghostKey(), state.trace, state.time);
    } else {
      best.textContent = 'Best: ' + prev.toFixed(2) + ' s';
      best.className = '';
    }
    let next;
    if (tutorial) { next = 'Start Stage 1'; save.tutorialDone = true; }
    else if (state.daily) next = 'Race again';
    else if (!win) next = 'Try again';
    else next = state.stage + 1 < D.STAGES.length ? 'Next stage' : state.stage + 1 === D.STAGES.length ? 'Endless mode' : 'Next course';
    $('next-btn').textContent = next;
    $('next-btn').dataset.action = tutorial ? 'stage1' : state.daily ? 'again' : win ? 'next' : 'again';
    // A second button to replay the same course, when the main one moves on.
    $('again-btn').hidden = $('next-btn').dataset.action === 'again';
    if (win && !tutorial && !state.daily && state.stage < D.RANDOM_BASE) {
      save.stage = state.stage + 1;
      save.unlocked = Math.max(save.unlocked || 0, save.stage);
    }
    persist();
    $('leaderboard').hidden = true;
    if (state.daily) submitDaily(state.time, state.trace);
    $('result').hidden = false;
    sfx(win ? 'win' : 'lose');
    updateHud();
    render();
    $('next-btn').focus();
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  const round1 = v => Math.round(v * 10) / 10;

  // ---------------- Best-run ghost ----------------
  function bestKey() { return state.daily ? 'daily:' + state.daily.day : String(state.stage); }
  function ghostKey() { return bestKey(); }

  function recordSample() {
    const tr = state.trace;
    if (!tr || state.time - tr.lastT < 0.1) return;
    tr.lastT = state.time;
    const b = state.player;
    tr.samples.push([round1(state.time), round1(b.x), round1(b.y), round1(b.joints[0].angle), round1(b.joints[1].angle)]);
  }
  function recordLimbs() {
    if (state.trace) state.trace.limbs.push([round1(state.time), D.encodeLimbs(state.limbs)]);
  }

  function loadGhosts() {
    try { return JSON.parse(localStorage.getItem(GHOST_KEY) || '{}'); } catch (e) { return {}; }
  }
  function loadGhost(key) {
    const g = loadGhosts()[key];
    return g && g.samples && g.samples.length > 1 ? Object.assign(g, { runner: null, limbsAt: -1 }) : null;
  }
  function saveGhost(key, trace, time) {
    if (!trace) return;
    const all = loadGhosts();
    trace.samples.push([round1(time), round1(state.player.x), round1(state.player.y), 0, 0]);
    all[key] = { time, samples: trace.samples, limbs: trace.limbs, savedAt: Date.now() };
    // Keep the most recent few courses so storage stays small.
    const keys = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
    for (const k of keys.slice(MAX_GHOSTS)) delete all[k];
    try { localStorage.setItem(GHOST_KEY, JSON.stringify(all)); } catch (e) { /* storage full or blocked */ }
  }

  // The ghost's position at time t (blended between samples), or null once it has finished.
  function ghostAt(t) {
    const g = state.ghost;
    if (!g) return null;
    const s = g.samples;
    if (t > s[s.length - 1][0]) return null;
    let i = g.cursor || 1;
    if (s[i - 1][0] > t) i = 1;
    while (i < s.length - 1 && s[i][0] < t) i++;
    g.cursor = i;
    const a = s[i - 1], b = s[i];
    const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 1;
    return { x: a[1] + (b[1] - a[1]) * k, y: a[2] + (b[2] - a[2]) * k, a: a[3] + (b[3] - a[3]) * k, b: a[4] + (b[4] - a[4]) * k };
  }
  function drawGhost(g) {
    const gh = state.ghost;
    const p = gh && state.racing && ghostAt(state.time);
    if (!p) return;
    // Use the limbs the ghost had at this moment.
    let li = 0;
    for (let i = 0; i < gh.limbs.length; i++) if (gh.limbs[i][0] <= state.time) li = i;
    if (li !== gh.limbsAt || !gh.runner) {
      gh.limbsAt = li;
      gh.runner = D.createRunner(D.decodeLimbs(gh.limbs[li][1]), GHOST_COLOR, 1);
    }
    const r = gh.runner;
    r.x = p.x; r.y = p.y;
    if (r.joints[0]) r.joints[0].angle = p.a;
    if (r.joints[1]) r.joints[1].angle = p.b;
    drawRunner(g, r, 0.4);
    g.save();
    g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillStyle = 'rgba(60,66,80,0.7)';
    g.fillText('Your best', r.x + r.head.x, r.y + r.head.y - r.head.r - 7);
    g.restore();
  }

  // ---------------- Daily course ----------------
  let serverOk = null; // does /api/daily exist here (served by the Worker)?
  function enterDaily() {
    const day = D.today();
    state.daily = { day };
    state.stage = D.dailyStage(day);
    closeOptions();
    $('result').hidden = true;
    resetStage();
    toast('Daily course', 1200);
    showHint('Today\u2019s course is the same for everyone. Draw to start.', 0);
  }
  function leaveDaily() {
    state.daily = null;
    state.stage = Math.min(save.stage, save.unlocked || 0);
  }

  async function submitDaily(time, trace) {
    const lb = $('leaderboard');
    lb.hidden = false;
    $('lb-title').textContent = 'Today\u2019s leaderboard';
    $('lb-list').textContent = '';
    $('lb-note').textContent = 'Sending your time…';
    const day = state.daily.day;
    try {
      const run = trace.samples.map(s => [s[0], s[1]]);
      const res = await fetch('/api/daily', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day, player: save.player, name: playerName(), time: +time.toFixed(2), trace: run }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { $('lb-note').textContent = out.error || 'The leaderboard is not available here.'; serverOk = res.status !== 404 && res.status !== 503; }
      await showLeaderboard(day, res.ok);
    } catch (e) {
      $('lb-note').textContent = 'The leaderboard needs the online version of the game.';
    }
  }
  async function showLeaderboard(day, sent) {
    const res = await fetch('/api/daily?day=' + day + '&player=' + encodeURIComponent(save.player), { cache: 'no-store' });
    if (!res.ok) { if (!sent) return; $('lb-note').textContent = 'Could not load the leaderboard.'; return; }
    const data = await res.json();
    const ol = $('lb-list');
    ol.textContent = '';
    data.top.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.you) li.className = 'you';
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = ordinal(i + 1);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.you ? r.name + ' (you)' : r.name;
      const tm = document.createElement('span'); tm.textContent = r.time.toFixed(2) + ' s';
      li.append(rk, nm, tm);
      ol.append(li);
    });
    if (sent) $('lb-note').textContent = data.you
      ? 'You are ' + ordinal(data.you.rank) + ' of ' + data.total + ' today (best ' + data.you.time.toFixed(2) + ' s).'
      : data.total + ' runners today.';
  }
  function playerName() {
    try { return localStorage.getItem('draw-roll-race-name') || 'Runner'; } catch (e) { return 'Runner'; }
  }

  // Before a race starts (or after it ends), tap the stage name to cycle through unlocked stages.
  function updateStageButton() {
    const btn = $('stage-label');
    const can = state.mode === 'solo' && !state.racing;
    btn.disabled = !can;
    btn.classList.toggle('switchable', can);
  }
  $('stage-label').addEventListener('click', () => {
    if (state.racing) return;
    // Cycle: Tutorial, Stage 1 .. the furthest unlocked stage. Leaving the daily course goes back to your stage.
    const order = [D.TUTORIAL];
    for (let i = 0; i <= (save.unlocked || 0); i++) order.push(i);
    if (state.daily) { leaveDaily(); }
    else {
      const k = order.indexOf(state.stage);
      state.stage = order[(k + 1) % order.length];
    }
    save.stage = state.stage; persist();
    $('result').hidden = true;
    resetStage();
    if (!state.limbs.arm.length && !state.limbs.leg.length) showHint(HINT, 0);
  });

  $('restart-btn').addEventListener('click', () => {
    if (state.mode === 'online') { if (hooks.onRestart) hooks.onRestart(); return; }
    $('result').hidden = true;
    const drawn = state.limbs.arm.length || state.limbs.leg.length;
    resetStage();
    if (drawn) startRace();
    else showHint(HINT, 0);
  });

  $('again-btn').addEventListener('click', () => {
    $('result').hidden = true;
    resetStage();
    startRace();
  });

  $('next-btn').addEventListener('click', () => {
    const action = $('next-btn').dataset.action;
    if (action === 'stage1') state.stage = 0;
    else if (action === 'next') state.stage++;
    $('result').hidden = true;
    resetStage();
    startRace();
  });

  // ---------------- Rendering ----------------
  const world = $('world');
  const ctx = world.getContext('2d');
  let dpr = 1;
  const cam = { x: 0, y: 0 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    world.width = Math.round(innerWidth * dpr);
    world.height = Math.round(innerHeight * dpr);
    render();
  }
  addEventListener('resize', resize);

  function drawRunner(g, b, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(b.x, b.y);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const line = pts => {
      g.strokeStyle = COLORS.ink; g.lineWidth = CFG.R * 2 + 3; polyline(g, pts);
      g.strokeStyle = b.color; g.lineWidth = CFG.R * 2; polyline(g, pts);
    };
    line(b.spine);
    g.beginPath(); g.arc(b.head.x, b.head.y, b.head.r, 0, Math.PI * 2);
    g.fillStyle = '#fff'; g.fill();
    g.strokeStyle = COLORS.ink; g.lineWidth = 2.5; g.stroke();
    g.beginPath(); g.arc(b.head.x + b.head.r * 0.4, b.head.y - b.head.r * 0.1, 1.7, 0, Math.PI * 2);
    g.fillStyle = COLORS.ink; g.fill();
    for (const j of b.joints) {
      g.save(); g.translate(j.ox, j.oy); g.rotate(j.angle);
      for (const ln of j.lines) if (ln.length > 1) line(ln);
      g.restore();
    }
    g.restore();
  }

  function groundPath(g, c, x0, x1, bottom) {
    const S = CFG.STEP;
    const i0 = Math.max(0, Math.floor(x0 / S)), i1 = Math.min(c.ground.length - 1, Math.ceil(x1 / S) + 1);
    g.beginPath();
    g.moveTo(i0 * S, bottom);
    for (let i = i0; i <= i1; i++) g.lineTo(i * S, c.ground[i]);
    g.lineTo(i1 * S, bottom);
    g.closePath();
  }

  // ---------------- Shattered limb pieces ----------------
  const shards = [];
  let lastShardTs = 0;
  function spawnShards(b, kinds) {
    for (const j of b.joints) {
      if (!kinds.includes(j.kind)) continue;
      const c = Math.cos(j.angle), s = Math.sin(j.angle);
      for (const ln of j.lines) {
        for (let i = 1; i < ln.length; i += 2) {
          const p = ln[i - 1], q = ln[i];
          const ax = b.x + j.ox + p.x * c - p.y * s, ay = b.y + j.oy + p.x * s + p.y * c;
          const bx = b.x + j.ox + q.x * c - q.y * s, by = b.y + j.oy + q.x * s + q.y * c;
          shards.push({
            x: (ax + bx) / 2, y: (ay + by) / 2, len: Math.hypot(bx - ax, by - ay),
            ang: Math.atan2(by - ay, bx - ax), va: (Math.random() - 0.5) * 16,
            vx: b.vx * 0.5 + (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 220,
            color: b.color, life: 1.1,
          });
        }
      }
    }
    if (shards.length > 400) shards.splice(0, shards.length - 400);
  }
  function drawShards(g) {
    const now = performance.now();
    const dt = lastShardTs ? Math.min(0.05, (now - lastShardTs) / 1000) : 0;
    lastShardTs = now;
    g.lineCap = 'round';
    for (let i = shards.length - 1; i >= 0; i--) {
      const p = shards[i];
      p.life -= dt;
      if (p.life <= 0) { shards.splice(i, 1); continue; }
      p.vy += CFG.G * 0.6 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.ang += p.va * dt;
      const dx = Math.cos(p.ang) * p.len / 2, dy = Math.sin(p.ang) * p.len / 2;
      g.globalAlpha = Math.min(1, p.life * 1.5);
      g.strokeStyle = COLORS.ink; g.lineWidth = CFG.R * 2 + 3;
      g.beginPath(); g.moveTo(p.x - dx, p.y - dy); g.lineTo(p.x + dx, p.y + dy); g.stroke();
      g.strokeStyle = p.color; g.lineWidth = CFG.R * 2;
      g.beginPath(); g.moveTo(p.x - dx, p.y - dy); g.lineTo(p.x + dx, p.y + dy); g.stroke();
    }
    g.globalAlpha = 1;
  }

  // Sound effects are filled in by sound.js when it is loaded.
  function sfx(name) { if (hooks.sfx) hooks.sfx(name); }

  function spikeRow(g, from, to, baseY, dir) {
    // dir -1: spikes point up from baseY(x); dir 1: spikes hang down from baseY(x)
    const w = 8, h = CFG.SPIKE_H;
    g.fillStyle = '#c9ced8'; g.strokeStyle = COLORS.ink; g.lineWidth = 1.5; g.lineJoin = 'miter';
    for (let x = from; x + w <= to + 0.1; x += w) {
      const y0 = baseY(x), y1 = baseY(x + w);
      g.beginPath();
      g.moveTo(x, y0); g.lineTo(x + w / 2, (y0 + y1) / 2 + dir * h); g.lineTo(x + w, y1);
      g.closePath(); g.fill(); g.stroke();
    }
    g.lineJoin = 'round';
  }

  function render() {
    const W = world.width, H = world.height;
    const c = state.course;
    const zoom = Math.min(W / VIEW_W, H / 480);
    const VW = W / zoom, VH = H / zoom;

    // camera follows the player, kept high enough that the drawing pad does not hide it
    const focus = state.player || (hooks.focus && hooks.focus()) || { x: c.startX, y: D.groundAt(c, c.startX) - 40 };
    const tx = Math.max(0, focus.x - VW * 0.3), ty = focus.y - VH * 0.36;
    if (state.racing) { cam.x += (tx - cam.x) * 0.2; cam.y += (ty - cam.y) * 0.12; }
    else { cam.x = tx; cam.y = ty; }

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(0.6, '#bfe3f5'); sky.addColorStop(1, '#fbe8d3');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    // parallax hills and clouds (screen space)
    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let k = 0; k < 7; k++) {
      const period = VW + 260;
      const cx = ((k * 211 - cam.x * 0.15) % period + period) % period - 130;
      const cy = 50 + (k * 53) % 90;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 34, 11, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 20, cy - 7, 20, 11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(80,140,120,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, VH);
    for (let sx = 0; sx <= VW + 10; sx += 10) {
      const wx = sx + cam.x * 0.35;
      ctx.lineTo(sx, VH * 0.62 - 26 * Math.sin(wx / 130) - 14 * Math.sin(wx / 57 + 1));
    }
    ctx.lineTo(VW, VH); ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-cam.x, -cam.y);
    const x0 = cam.x - 10, x1 = cam.x + VW + 10, bottom = cam.y + VH + 20;

    // ground with scrolling stripes so speed is readable
    groundPath(ctx, c, x0, x1, bottom);
    ctx.fillStyle = COLORS.ground; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let sx = Math.floor(x0 / 80) * 80; sx < x1; sx += 80) ctx.fillRect(sx, cam.y - 20, 40, VH + 40);
    ctx.restore();
    // grass edge
    ctx.strokeStyle = '#7cc46a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    {
      const S = CFG.STEP, i0 = Math.max(0, Math.floor(x0 / S)), i1 = Math.min(c.ground.length - 1, Math.ceil(x1 / S));
      ctx.beginPath();
      let pen = false;
      for (let i = i0; i <= i1; i++) {
        const special = c.surf[i] || c.fluid[i];
        const steep = i > 0 && Math.abs(c.ground[i] - c.ground[i - 1]) > 6;
        if (special || steep) { pen = false; continue; }
        if (!pen) { ctx.moveTo(i * S, c.ground[i] + 1); pen = true; } else ctx.lineTo(i * S, c.ground[i] + 1);
      }
      ctx.stroke();
    }

    for (const s of c.sections) {
      if (s.to < x0 || s.from > x1) continue;
      if (s.type === 'ice') {
        ctx.strokeStyle = '#cdeefe'; ctx.lineWidth = 6; ctx.lineCap = 'butt';
        ctx.beginPath();
        for (let x = s.from; x <= s.to; x += CFG.STEP) ctx.lineTo(x, D.groundAt(c, x) + 2);
        ctx.stroke();
      } else if (s.type === 'conveyor') {
        const gy = D.groundAt(c, s.from + 1);
        ctx.fillStyle = '#4a5160'; ctx.fillRect(s.from, gy, s.to - s.from, 8);
        ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const belt = D.surfAt(c, s.from + 1).belt;
        const off = ((state.time * -belt) % 22 + 22) % 22;
        for (let x = s.from + 22 - off; x < s.to - 4; x += 22) {
          ctx.beginPath(); ctx.moveTo(x + 4, gy + 1.5); ctx.lineTo(x, gy + 4); ctx.lineTo(x + 4, gy + 6.5); ctx.stroke();
        }
      } else if (s.type === 'spikepit') {
        // spikes along the pit floor
        const S = CFG.STEP;
        let i = Math.floor(s.from / S);
        while (i < c.surf.length && !(c.surf[i] && c.surf[i].spikes)) i++;
        const a = i * S;
        while (i < c.surf.length && c.surf[i] && c.surf[i].spikes) i++;
        spikeRow(ctx, a, i * S, x => D.groundAt(c, x), -1);
      } else if (s.type === 'wind') {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(s.from, cam.y - 20, s.to - s.from, VH + 40);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        const force = -D.zoneAt(c, s.from + 1).wind;
        for (let k = 0; k < 18; k++) {
          const span = s.to - s.from;
          const x = s.to - (((k * 97 + state.time * force * 0.9) % span) + span) % span;
          const y = D.groundAt(c, x) - 16 - ((k * 37) % 90);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 26, y); ctx.stroke();
        }
      } else if (s.type === 'lowgrav') {
        ctx.fillStyle = 'rgba(150,110,230,0.12)';
        ctx.fillRect(s.from, cam.y - 20, s.to - s.from, VH + 40);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        for (let k = 0; k < 20; k++) {
          const x = s.from + ((k * 131) % (s.to - s.from));
          const y = D.groundAt(c, x) - 20 - ((k * 53 + state.time * 12) % 140);
          ctx.fillRect(x, y, 2, 2);
        }
      } else if (s.type === 'bounce') {
        ctx.lineWidth = 5; ctx.lineCap = 'butt';
        for (let x = s.from; x < s.to; x += 12) {
          ctx.strokeStyle = (Math.floor((x - s.from) / 12) % 2) ? '#f2c14e' : COLORS.ink;
          ctx.beginPath(); ctx.moveTo(x, D.groundAt(c, x) + 2.5); ctx.lineTo(Math.min(s.to, x + 12), D.groundAt(c, Math.min(s.to, x + 12)) + 2.5); ctx.stroke();
        }
      } else if (s.type === 'tunnel' || s.type === 'crawl' || s.type === 'spikeroof') {
        const S = CFG.STEP;
        let i = Math.floor(s.from / S);
        while (i < c.ceil.length && c.ceil[i] === -Infinity) i++;
        const a = i * S;
        while (i < c.ceil.length && c.ceil[i] !== -Infinity) i++;
        const b = i * S, cy = D.ceilAt(c, a + 1);
        ctx.fillStyle = COLORS.ground;
        ctx.fillRect(a, cam.y - 20, b - a, cy - cam.y + 20);
        if (s.type === 'spikeroof') spikeRow(ctx, a, b, () => cy, 1);
        else {
          ctx.fillStyle = '#f2c14e';
          for (let x = a; x < b; x += 24) ctx.fillRect(x, cy - 5, 12, 5);
        }
      }
    }

    // start and finish posts
    for (const [gx, label] of [[c.startX, 'START'], [c.finishX, 'FINISH']]) {
      const gy = D.groundAt(c, gx);
      ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 120); ctx.stroke();
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) {
        ctx.fillStyle = (r + k) % 2 ? '#fff' : COLORS.ink;
        ctx.fillRect(gx + k * 7, gy - 120 + r * 7, 7, 7);
      }
      ctx.fillStyle = COLORS.ink; ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(label, gx + 34, gy - 106);
    }

    drawGhost(ctx);
    for (const drv of state.cpus) drawRunner(ctx, drv.runner, 0.85);
    if (hooks.drawWorld) hooks.drawWorld(ctx);
    if (state.player) drawRunner(ctx, state.player, 1);
    drawShards(ctx);

    // water and mud drawn over the runners
    for (const s of c.sections) {
      if ((s.type !== 'pool' && s.type !== 'mud') || s.to < x0 || s.from > x1) continue;
      const lvl = D.fluidAt(c, s.from + 1).level;
      ctx.beginPath();
      ctx.moveTo(s.from, lvl);
      for (let x = s.from; x <= s.to; x += CFG.STEP) ctx.lineTo(x, Math.max(lvl, D.groundAt(c, x)));
      ctx.lineTo(s.to, lvl);
      ctx.closePath();
      ctx.fillStyle = s.type === 'mud' ? 'rgba(115,78,44,0.85)' : 'rgba(60,150,230,0.5)';
      ctx.fill();
      ctx.strokeStyle = s.type === 'mud' ? 'rgba(160,120,80,0.9)' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = s.from; x <= s.to; x += 6) ctx.lineTo(x, lvl + Math.sin(x / 14 + state.time * 4) * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------------- Options ----------------
  function applySettings() {
    document.body.classList.toggle('pad-small', save.pad === 'small');
    document.body.classList.toggle('pad-large', save.pad === 'large');
  }
  function openOptions() {
    if (state.racing) return;
    $('opt-cpus').value = String(save.cpuCount);
    $('opt-difficulty').value = save.cpuDifficulty;
    $('opt-sound').checked = !!save.sound;
    $('opt-vibrate').checked = !!save.vibrate;
    $('opt-ghost').checked = !!save.ghost;
    $('opt-pad').value = save.pad;
    $('daily-btn').hidden = $('tutorial-btn').hidden = state.mode !== 'solo';
    $('options').hidden = false;
  }
  function closeOptions() { $('options').hidden = true; }
  $('menu-btn').addEventListener('click', () => ($('options').hidden ? openOptions() : closeOptions()));
  $('options-close').addEventListener('click', closeOptions);
  $('opt-cpus').addEventListener('change', e => { save.cpuCount = +e.target.value; persist(); });
  $('opt-difficulty').addEventListener('change', e => { save.cpuDifficulty = e.target.value; persist(); });
  $('opt-sound').addEventListener('change', e => { save.sound = e.target.checked; persist(); });
  $('opt-vibrate').addEventListener('change', e => { save.vibrate = e.target.checked; persist(); });
  $('opt-ghost').addEventListener('change', e => { save.ghost = e.target.checked; persist(); });
  $('opt-pad').addEventListener('change', e => { save.pad = e.target.value; persist(); applySettings(); resize(); });
  $('daily-btn').addEventListener('click', enterDaily);
  $('tutorial-btn').addEventListener('click', () => {
    state.daily = null;
    state.stage = D.TUTORIAL;
    closeOptions();
    $('result').hidden = true;
    resetStage();
    showHint(D.TIPS.bumps, 0);
  });

  // ---------------- API for online.js ----------------
  window.DRRGame = {
    state, hooks, COLORS,
    toast, showHint, render, renderPad, updateHud, drawRunner, stageName, spawnShards, sfx,
    resetStage, startRace, updateStageButton,
    setStage(n) { state.stage = n; },
    stopRace() { state.racing = false; state.countdownEnd = 0; cancelAnimationFrame(rafId); updateStageButton(); },
    save,
    closeOptions,
    hideResult() { $('result').hidden = true; },
    defaultHint: HINT,
  };

  // ---------------- Boot ----------------
  // ?stage=N opens a stage directly (handy for testing a course).
  const askedStage = parseInt(new URLSearchParams(location.search).get('stage'), 10);
  if (Number.isInteger(askedStage) && askedStage >= 0) { state.stage = askedStage; state.course = D.buildCourse(askedStage); }
  applySettings();
  buildProgress();
  renderPad();
  resize();
  updateHud();
  if (state.stage === D.TUTORIAL) showHint('Welcome! ' + D.TIPS.bumps, 0);
})();
