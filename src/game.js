// Draw Roll Race — input, rendering and race flow.
(function () {
  'use strict';
  const D = window.DRR;
  const { CFG, FIG } = D;

  const CPU_SPEED = 0.65;   // CPU limbs spin slower than yours
  const CPU_REACTION = 3;   // seconds the CPU takes to redraw before a tricky section
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
    player: null, cpu: null,
    cpuPlan: 0, cpuWaitFrom: -1, cpuTime: null,
    racing: false, finished: false, time: 0,
    section: null,
  };

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
    if (state.racing) state.player = D.swapLimbs(state.course, state.player, state.limbs);
    else if (!state.finished) startRace();
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
  function stageName(n) { return n < D.STAGES.length ? 'Stage ' + (n + 1) + ' / ' + D.STAGES.length : 'Endless ' + (n - D.STAGES.length + 1); }
  function updateHud() {
    const c = state.course, span = c.finishX - c.startX;
    for (const who of ['cpu', 'player']) {
      const b = state[who];
      const t = b ? Math.max(0, Math.min(1, (b.x - c.startX) / span)) : 0;
      dots[who].style.left = (t * 100) + '%';
    }
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

  function startRace() {
    const c = state.course;
    state.player = D.createRunner(state.limbs, COLORS.player, 1);
    state.cpu = D.createRunner(D.POSES.wheel, COLORS.cpu, CPU_SPEED);
    D.settle(c, state.player, c.startX);
    D.settle(c, state.cpu, c.startX);
    state.cpuPlan = 0; state.cpuWaitFrom = -1; state.cpuTime = null;
    state.time = 0; state.racing = true; state.finished = false;
    updateStageButton();
    toast('GO!', 700);
    lastTs = 0; acc = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stepCpu() {
    if (state.cpuTime !== null) return;
    const c = state.course;
    D.step(c, state.cpu, CFG.DT);
    const k = D.planIndex(c, state.cpu.x);
    if (k !== state.cpuPlan) {
      if (state.cpuWaitFrom < 0) state.cpuWaitFrom = state.time;
      if (state.time - state.cpuWaitFrom >= CPU_REACTION) {
        state.cpuPlan = k; state.cpuWaitFrom = -1;
        state.cpu = D.swapLimbs(c, state.cpu, D.POSES[c.plan[k].pose]);
      }
    }
    if (state.cpu.x >= c.finishX) {
      state.cpuTime = state.time;
      toast('CPU finished!', 1600);
      showHint('CPU finished — keep going, or tap ↻ to restart', 3500);
      $('section-label').textContent = 'CPU finished';
    }
  }

  let lastTs = 0, acc = 0, rafId = 0;
  function frame(ts) {
    if (!state.racing) return;
    if (!lastTs) lastTs = ts;
    acc += Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    while (acc >= CFG.DT) {
      acc -= CFG.DT;
      state.time += CFG.DT;
      D.step(state.course, state.player, CFG.DT);
      stepCpu();
      if (state.player.x >= state.course.finishX) { finish(); break; }
      // Fell out of the world somehow: put the runner back on the ground.
      if (state.player.y > D.groundAt(state.course, state.player.x) + 400) {
        D.settle(state.course, state.player, state.player.x);
        state.player.vx = state.player.vy = 0;
      }
    }
    updateHud();
    render();
    if (state.racing) rafId = requestAnimationFrame(frame);
  }

  function finish() {
    state.racing = false; state.finished = true;
    updateStageButton();
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
    const can = !state.racing && (save.unlocked || 0) > 0;
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

  function render() {
    const W = world.width, H = world.height;
    const c = state.course;
    const zoom = Math.min(W / VIEW_W, H / 480);
    const VW = W / zoom, VH = H / zoom;

    // camera follows the player, kept high enough that the drawing pad does not hide it
    const focus = state.player || { x: c.startX, y: D.groundAt(c, c.startX) - 40 };
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
      } else if (s.type === 'tunnel' || s.type === 'crawl') {
        const S = CFG.STEP;
        let i = Math.floor(s.from / S);
        while (i < c.ceil.length && c.ceil[i] === -Infinity) i++;
        const a = i * S;
        while (i < c.ceil.length && c.ceil[i] !== -Infinity) i++;
        const b = i * S, cy = D.ceilAt(c, a + 1);
        ctx.fillStyle = COLORS.ground;
        ctx.fillRect(a, cam.y - 20, b - a, cy - cam.y + 20);
        ctx.fillStyle = '#f2c14e';
        for (let x = a; x < b; x += 24) ctx.fillRect(x, cy - 5, 12, 5);
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
    if (state.player) drawRunner(ctx, state.player, 1);

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

  // ---------------- Share ----------------
  function runnerImage() {
    const cv = document.createElement('canvas');
    cv.width = 720; cv.height = 900;
    const g = cv.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, cv.height);
    sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(0.6, '#bfe3f5'); sky.addColorStop(1, '#fbe8d3');
    g.fillStyle = sky; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = COLORS.ground; g.fillRect(0, cv.height * 0.8, cv.width, cv.height * 0.2);
    const b = Object.assign({}, state.player, { x: 0, y: 0 });
    let r = 20;
    D.eachPoint(b, (px, py) => { r = Math.max(r, Math.hypot(px, py)); });
    const k = Math.min(5, 300 / r);
    g.save(); g.translate(cv.width / 2, cv.height * 0.8 - (r + CFG.R) * k); g.scale(k, k);
    drawRunner(g, b, 1);
    g.restore();
    g.fillStyle = '#fff'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText(stageName(state.stage) + ' · ' + state.time.toFixed(2) + ' s', cv.width / 2, 80);
    return cv;
  }

  // Phones: the OS share sheet with the image attached (pick X there).
  // Desktop: copy the image to the clipboard and open X's composer so it can be pasted.
  // Anything that fails falls back to an overlay with the image, a download link and a post link.
  let sharing = false;
  $('share-btn').addEventListener('click', () => {
    if (!state.player || sharing) return;
    const cv = runnerImage();
    const dataUrl = cv.toDataURL('image/png');
    const bin = atob(dataUrl.split(',')[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    const file = new File([blob], 'draw-roll-race.png', { type: 'image/png' });
    const won = $('next-btn').dataset.win;
    const text = (won ? 'Cleared ' : 'Raced ') + stageName(state.stage) + ' in ' + state.time.toFixed(2) + ' s!\n\n' +
      location.href.split(/[?#]/)[0] + '\n#DrawRollRace';
    const postUrl = 'https://x.com/intent/post?text=' + encodeURIComponent(text);

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      sharing = true;
      navigator.share({ files: [file], text })
        .catch(err => { if (!err || err.name !== 'AbortError') showImage(dataUrl, postUrl, false); })
        .finally(() => { sharing = false; });
      return;
    }
    const openX = copied => {
      const w = window.open(postUrl, '_blank', 'noopener');
      if (copied) toast('Image copied — paste it into your post', 2200);
      if (!copied || !w) showImage(dataUrl, postUrl, copied);
    };
    if (navigator.clipboard && window.ClipboardItem) {
      sharing = true;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => openX(true), () => openX(false))
        .finally(() => { sharing = false; });
    } else {
      openX(false);
    }
  });

  function showImage(dataUrl, postUrl, copied) {
    const old = $('share-box'); if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'share-box';
    const img = new Image(); img.src = dataUrl; img.alt = 'Your runner';
    const note = document.createElement('p');
    note.textContent = copied ? 'Image copied to your clipboard. Tap outside to close.' : 'Save the image, then attach it to your post. Tap outside to close.';
    const links = document.createElement('div');
    links.className = 'links';
    const dl = document.createElement('a');
    dl.href = dataUrl; dl.download = 'draw-roll-race.png'; dl.textContent = 'Download';
    const post = document.createElement('a');
    post.href = postUrl; post.target = '_blank'; post.rel = 'noopener'; post.textContent = 'Post on X';
    links.append(dl, post);
    box.append(img, note, links);
    box.addEventListener('pointerdown', e => { if (e.target === box) box.remove(); });
    document.body.appendChild(box);
  }

  // ---------------- Boot ----------------
  buildProgress();
  renderPad();
  resize();
  updateHud();
})();
