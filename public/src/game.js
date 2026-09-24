// Draw Roll Race — input, rendering and race flow.
(function () {
  'use strict';
  const D = window.DRR;
  const { CFG, FIG } = D;

  const SOLO_CPU = 'normal'; // difficulty of the solo CPU (see cpu.js)
  const VIEW_W = 560;       // world units visible across the screen (at most)

  const $ = id => document.getElementById(id);
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COLORS = { ink: cssVar('--ink'), player: cssVar('--player'), cpu: cssVar('--cpu'), ground: cssVar('--ground') };

  // ---------------- Saved progress (best effort: storage may be unavailable) ----------------
  const SAVE_KEY = 'draw-roll-race';
  const save = (() => {
    try { return Object.assign({ stage: 0, unlocked: 0, best: {} }, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); }
    catch (e) { return { stage: 0, unlocked: 0, best: {} }; }
  })();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  }

  // ---------------- State ----------------
  const state = {
    stage: save.stage,
    course: D.buildCourse(save.stage),
    limbs: { arm: [], leg: [] },
    player: null, cpu: null, cpuDriver: null,
    cpuTime: null,
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
    if (state.racing) state.player = D.swapLimbs(state.course, state.player, state.limbs);
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
    for (const who of ['cpu', 'player']) {
      dots[who] = document.createElement('div');
      dots[who].className = 'dot ' + who;
      progress.appendChild(dots[who]);
    }
    const flag = document.createElement('span');
    flag.className = 'flag'; flag.textContent = '🏁';
    progress.appendChild(flag);
    $('stage-label').textContent = stageName(state.stage);
    updateStageButton();
  }
  function stageName(n) { return D.TEST_STAGES[n] ? 'Test course' : n >= D.RANDOM_BASE ? 'Random course' : n < D.STAGES.length ? 'Stage ' + (n + 1) + ' / ' + D.STAGES.length : 'Endless ' + (n - D.STAGES.length + 1); }
  function updateHud() {
    const c = state.course, span = c.finishX - c.startX;
    for (const who of ['cpu', 'player']) {
      const b = state[who];
      const t = b ? Math.max(0, Math.min(1, (b.x - c.startX) / span)) : 0;
      dots[who].style.left = (t * 100) + '%';
      dots[who].hidden = !b;
    }
    if (hooks.onHud) hooks.onHud(progress, c.startX, span);
    $('timer').textContent = state.time.toFixed(2) + ' s';
    const px = state.player ? state.player.x : c.startX;
    const sec = c.sections.find(s => px >= s.from && px < s.to) || null;
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
    state.player = null; state.cpu = null;
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
    state.cpu = null; state.cpuDriver = null;
    if (opts.cpu !== false) {
      // A new personality every race, so the CPU never plays the same way twice.
      state.cpuDriver = D.createCpu(c, {
        seed: (Math.random() * 1e9) | 0, difficulty: SOLO_CPU, color: COLORS.cpu,
        onSwap: (limbs, pose, lost, old) => { if (lost && old) spawnShards(old, lost); },
      });
      state.cpu = state.cpuDriver.runner;
    }
    state.cpuTime = null;
    state.time = 0; state.racing = true; state.finished = false;
    state.countdownEnd = opts.countdownMs ? performance.now() + opts.countdownMs : 0;
    countdownShown = null;
    updateStageButton();
    if (!state.countdownEnd) toast('GO!', 700);
    lastTs = 0; acc = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stepCpu() {
    const drv = state.cpuDriver;
    if (!drv || state.cpuTime !== null) return;
    drv.step(CFG.DT, state.time);
    state.cpu = drv.runner;
    if (drv.finishTime !== null) {
      state.cpuTime = drv.finishTime;
      toast('CPU finished!', 1600);
      showHint('CPU finished — keep going, or tap ↻ to restart', 3500);
      $('section-label').textContent = 'CPU finished';
    }
  }

  let lastTs = 0, acc = 0, rafId = 0, countdownShown = null;
  function frame(ts) {
    if (!state.racing) return;
    if (state.countdownEnd) {
      const left = state.countdownEnd - performance.now();
      if (left > 0) {
        const n = Math.min(3, Math.ceil(left / 1000));
        if (n !== countdownShown) { countdownShown = n; toast(String(n), 900); }
        render();
        rafId = requestAnimationFrame(frame);
        return;
      }
      state.countdownEnd = 0;
      toast('GO!', 700);
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
      stepCpu();
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
    const win = state.cpuTime === null;
    const title = $('result-title');
    title.textContent = win ? 'You win!' : 'CPU wins…';
    title.className = win ? 'win' : 'lose';
    $('result-stage').textContent = stageName(state.stage);
    $('result-time').textContent = state.time.toFixed(2) + ' s';
    $('result-cpu').textContent = win ? 'CPU was still racing' : 'CPU finished in ' + state.cpuTime.toFixed(2) + ' s';
    $('next-btn').textContent = win ? (state.stage + 1 < D.STAGES.length ? 'Next stage' : state.stage + 1 === D.STAGES.length ? 'Endless mode' : 'Next course') : 'Try again';
    $('next-btn').dataset.win = win ? '1' : '';
    const prev = save.best[state.stage];
    const best = $('result-best');
    if (win && (prev === undefined || state.time < prev)) {
      save.best[state.stage] = +state.time.toFixed(2);
      best.textContent = prev === undefined ? 'First clear!' : 'New best! (was ' + prev.toFixed(2) + ' s)';
      best.className = 'new';
    } else {
      best.textContent = prev === undefined ? '' : 'Best: ' + prev.toFixed(2) + ' s';
      best.className = '';
    }
    if (win) { save.stage = state.stage + 1; save.unlocked = Math.max(save.unlocked || 0, save.stage); }
    persist();
    $('result').hidden = false;
    updateHud();
    render();
    $('next-btn').focus();
  }

  // Before a race starts (or after it ends), tap the stage name to cycle through unlocked stages.
  function updateStageButton() {
    const btn = $('stage-label');
    const can = state.mode === 'solo' && !state.racing && (save.unlocked || 0) > 0;
    btn.disabled = !can;
    btn.classList.toggle('switchable', can);
  }
  $('stage-label').addEventListener('click', () => {
    if (state.racing) return;
    state.stage = (state.stage + 1) % ((save.unlocked || 0) + 1);
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

  $('next-btn').addEventListener('click', () => {
    if ($('next-btn').dataset.win) state.stage++;
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

    if (state.cpu) drawRunner(ctx, state.cpu, 0.85);
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

  // ---------------- API for online.js ----------------
  window.DRRGame = {
    state, hooks, COLORS,
    toast, showHint, render, renderPad, updateHud, drawRunner, stageName, spawnShards, sfx,
    resetStage, startRace, updateStageButton,
    setStage(n) { state.stage = n; },
    stopRace() { state.racing = false; state.countdownEnd = 0; cancelAnimationFrame(rafId); updateStageButton(); },
    hideResult() { $('result').hidden = true; },
    defaultHint: HINT,
  };

  // ---------------- Boot ----------------
  // ?stage=N opens a stage directly (handy for testing a course).
  const askedStage = parseInt(new URLSearchParams(location.search).get('stage'), 10);
  if (Number.isInteger(askedStage) && askedStage >= 0) { state.stage = askedStage; state.course = D.buildCourse(askedStage); }
  buildProgress();
  renderPad();
  resize();
  updateHud();
})();
