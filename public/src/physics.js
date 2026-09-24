// Draw Roll Race — course generation and physics.
// Runs in the browser (window.DRR) and in Node (globalThis.DRR) so it can be simulated headlessly.
(function (root) {
  'use strict';

  const CFG = {
    STEP: 2,            // horizontal spacing of terrain samples (world units)
    R: 4,               // collision radius of every drawn line
    G: 1300,            // gravity
    DT: 1 / 240,        // fixed physics step
    MOTOR: 2.6,         // limb torque = MOTOR * body weight * limb reach
    WMAX: 12,           // max limb spin (rad/s)
    REST: 0.1,          // restitution
    MU: 0.9,            // friction
    AIR: 0.03,          // horizontal air damping (1/s)
    WATER_LIFT: 1.8, WATER_DRAG: 4,
    MUD_LIFT: 0.6, MUD_DRAG: 9,
    SCALE: 0.55,        // pad units -> world units
    SPACING: 9,         // sample spacing along strokes (pad units)
    START_X: 120,
    CLEARANCE: 76,      // tunnel height
  };

  // ---------------- Figure template (pad coordinates, 320x200) ----------------
  const PAD_W = 320, PAD_H = 200;
  const FIG = {
    head: { x: 160, y: 44, r: 15 },
    neck: { x: 160, y: 60 },
    shoulder: { x: 160, y: 68 },
    hip: { x: 160, y: 120 },
  };

  // ---------------- Course ----------------
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  // Integer seed from anything (numbers, strings).
  function hashSeed(v) {
    const str = String(v);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Section catalogue.
  //   pose: what a CPU should switch to for this section (none = keep the wheel)
  //   def:  the sizes used by the fixed stages
  //   gen:  sizes for generated courses; `L` (0..1) is the difficulty level.
  //         Every range here was checked with tools/sim.cjs: a CPU can always finish.
  const SECTIONS = {
    rolling:  { label: 'Rolling Hills', def: { len: 760, amp: 1 },
      gen: (r, L) => ({ len: rint(r, 500, 900), amp: rnum(r, 0.6, 0.9 + 0.4 * L) }) },
    bumps:    { label: 'Bumpy Road', def: { len: 480, amp: 12, period: 40 },
      gen: (r, L) => ({ len: rint(r, 300, 600), amp: rnum(r, 8, 10 + 4 * L), period: rint(r, 32, 48) }) },
    stairs:   { label: 'Stairs', pose: 'stilts', def: { n: 3, h: 36, tread: 96 },
      gen: (r, L) => ({ n: rint(r, 2, 3 + Math.round(L)), h: rint(r, 28, 32 + 8 * L), tread: rint(r, 84, 110) }) },
    trenches: { label: 'Trenches', pose: 'stilts', def: { n: 2, w: 64, d: 34, gap: 110 },
      gen: (r, L) => ({ n: rint(r, 1, 2 + Math.round(L)), w: rint(r, 50, 58 + 12 * L), d: rint(r, 26, 30 + 8 * L), gap: rint(r, 90, 130) }) },
    chasm:    { label: 'Chasm', pose: 'stilts', def: { w: 92, d: 60 },
      gen: (r, L) => ({ w: rint(r, 70, 80 + 14 * L), d: rint(r, 45, 50 + 12 * L) }) },
    swell:    { label: 'Big Wave', def: { len: 620, dh: 100 },
      gen: (r, L) => ({ len: rint(r, 520, 700), dh: rint(r, 70, 85 + 25 * L) }) },
    ramps:    { label: 'Sawtooth', def: { n: 4, len: 100, h: 42 },
      gen: (r, L) => ({ n: rint(r, 3, 4 + Math.round(L)), len: rint(r, 84, 110), h: rint(r, 30, 34 + 10 * L) }) },
    tunnel:   { label: 'Tunnel', pose: 'mini', def: { len: 380 },
      gen: (r, L) => ({ len: rint(r, 240, 300 + 120 * L) }) },
    hurdles:  { label: 'Hurdles', pose: 'stilts', def: { n: 3, h: 28, gap: 96 },
      gen: (r, L) => ({ n: rint(r, 2, 3 + Math.round(L)), h: rint(r, 22, 24 + 6 * L), gap: rint(r, 84, 110) }) },
    drop:     { label: 'Drop', def: { dh: 140 },
      gen: (r) => ({ dh: rint(r, 80, 150) }) },
    incline:  { label: 'Steep Climb', def: { len: 230, rise: 115 },
      gen: (r, L) => { const len = rint(r, 200, 260); return { len, rise: Math.round(len * rnum(r, 0.35, 0.4 + 0.1 * L)) }; } },
    pool:     { label: 'Pool', pose: 'stilts', def: { len: 700, d: 130 },
      gen: (r, L) => ({ len: rint(r, 520, 620 + 140 * L), d: rint(r, 100, 110 + 30 * L) }) },
    ledge:    { label: 'Wall', pose: 'climber', def: { h: 88 },
      gen: (r, L) => ({ h: rint(r, 60, 70 + 20 * L) }) },
    crawl:    { label: 'Crawl & Climb', def: { tunnel: 260, h: 80 },
      gen: (r, L) => ({ tunnel: rint(r, 200, 240 + 40 * L), h: rint(r, 60, 66 + 16 * L) }) },
    conveyor: { label: 'Conveyor', def: { len: 440, belt: 120 },
      gen: (r, L) => ({ len: rint(r, 300, 360 + 120 * L), belt: rint(r, 90, 100 + 25 * L) }) },
    ice:      { label: 'Ice Slope', def: { len: 520, rise: 100 },
      gen: (r, L) => { const len = rint(r, 420, 560); return { len, rise: Math.round(len * rnum(r, 0.13, 0.15 + 0.04 * L)) }; } },
    mud:      { label: 'Mud Pit', pose: 'stilts', def: { len: 420, d: 60 },
      gen: (r, L) => ({ len: rint(r, 300, 360 + 100 * L), d: rint(r, 45, 50 + 12 * L) }) },
  };
  function rnum(r, a, b) { return a + (b - a) * r(); }
  function rint(r, a, b) { return Math.round(rnum(r, a, b)); }

  const STAGES = [
    ['rolling', 'bumps', 'stairs', 'swell', 'trenches', 'conveyor', 'ramps', 'rolling'],
    ['bumps', 'hurdles', 'pool', 'ice', 'ledge', 'stairs', 'chasm', 'drop', 'incline'],
    ['swell', 'tunnel', 'mud', 'ramps', 'crawl', 'trenches', 'pool', 'conveyor', 'stairs', 'hurdles', 'drop'],
  ];
  // Stage numbers from here up are single random courses (online "Random course").
  const RANDOM_BASE = 1000;

  // Difficulty level of a generated stage: endless mode ramps up; random courses are mid-to-hard.
  function stageLevel(n) {
    if (n >= RANDOM_BASE) return 0.4 + 0.5 * rng(hashSeed('level' + n))();
    return Math.max(0.15, Math.min(1, (n - STAGES.length) / 10));
  }

  // The sections of stage n, each { type, p } with its sizes.
  function stageSections(n) {
    if (n < STAGES.length) return STAGES[n].map(type => ({ type, p: SECTIONS[type].def }));
    const rand = rng(hashSeed('course' + n));
    const L = stageLevel(n);
    const keys = Object.keys(SECTIONS);
    const count = 7 + Math.round(L * 5 + rand() * 2);
    const out = [];
    let specials = 0;
    while (out.length < count) {
      const type = keys[Math.floor(rand() * keys.length)];
      const prev = out[out.length - 1];
      if (prev && prev.type === type) continue;
      // Keep at least a third of the course rollable so it never becomes a long slog.
      const special = !!SECTIONS[type].pose || type === 'crawl';
      if (special && specials >= Math.ceil(count * 0.66)) continue;
      if (special) specials++;
      out.push({ type, p: SECTIONS[type].gen(rand, L) });
    }
    return out;
  }

  function buildCourse(stageIndex) {
    const S = CFG.STEP;
    const ground = [], ceil = [], fluid = [], surf = [];
    const sections = [], plan = [{ x: -Infinity, pose: 'wheel' }];
    let x = 0, y = 400;
    let curSurf = null, curFluid = null;

    // Append `len` world units of terrain; f(t) gives ground height at local offset t.
    function seg(len, f, c) {
      const n = Math.round(len / S);
      for (let i = 0; i < n; i++) {
        const t = i * S;
        ground.push(f(t));
        ceil.push(c ? c(t) : -Infinity);
        fluid.push(curFluid);
        surf.push(curSurf);
      }
      x += n * S;
    }
    const flat = len => { const y0 = y; seg(len, () => y0); };

    const build = {
      rolling(p) {
        const y0 = y, L = p.len;
        const h = t => p.amp * (28 * Math.sin(t / 170) + 13 * Math.sin(t / 73 + 0.7) + 6 * Math.sin(t / 37 + 2.4));
        seg(L, t => y0 + Math.sin(Math.PI * t / L) * h(t));
      },
      bumps(p) { const y0 = y; seg(p.len, t => y0 - p.amp * (1 - Math.cos(2 * Math.PI * t / p.period)) / 2); },
      stairs(p) {
        for (let k = 0; k < p.n; k++) { y -= p.h; flat(p.tread); }
        const down = p.n * p.h, y1 = y, L = Math.max(200, down * 2.6);
        seg(L, t => y1 + down * t / L); y += down;
      },
      trenches(p) {
        const y0 = y;
        for (let k = 0; k < p.n; k++) { seg(p.gap, () => y0); seg(p.w, () => y0 + p.d); }
        seg(p.gap, () => y0);
      },
      chasm(p) { const y0 = y; seg(80, () => y0); seg(p.w, () => y0 + p.d); seg(80, () => y0); },
      swell(p) { const y0 = y, L = p.len; seg(L, t => y0 - p.dh * (1 - Math.cos(2 * Math.PI * t / L)) / 2); },
      ramps(p) { for (let k = 0; k < p.n; k++) { const y0 = y; seg(p.len, t => y0 - p.h * t / p.len); } },
      tunnel(p) {
        const y0 = y;
        flat(60);
        seg(p.len, () => y0, () => y0 - CFG.CLEARANCE);
        flat(60);
      },
      hurdles(p) {
        const y0 = y;
        for (let k = 0; k < p.n; k++) { seg(p.gap, () => y0); seg(12, () => y0 - p.h); }
        seg(p.gap, () => y0);
      },
      drop(p) { flat(40); y += p.dh; flat(40); },
      incline(p) { const y0 = y; seg(p.len, t => y0 - p.rise * t / p.len); y -= p.rise; },
      pool(p) {
        const y0 = y, d = p.d;
        curFluid = { level: y0, kind: 'water' };
        seg(60, t => y0 + d * t / 60);
        seg(p.len - 360, () => y0 + d);
        seg(300, t => y0 + d * (1 - t / 300));
        curFluid = null;
      },
      ledge(p) {
        flat(60); y -= p.h; flat(170);
        const y1 = y, L = Math.max(240, p.h * 3.4); seg(L, t => y1 + p.h * t / L); y += p.h;
      },
      crawl(p, sec) {
        const y0 = y;
        flat(60);
        seg(p.tunnel, () => y0, () => y0 - CFG.CLEARANCE);
        flat(180);
        sec.wallX = x;
        y -= p.h; flat(170);
        const y1 = y, L = Math.max(240, p.h * 3.75); seg(L, t => y1 + p.h * t / L); y += p.h;
      },
      conveyor(p) { curSurf = { belt: -p.belt }; flat(p.len); curSurf = null; },
      ice(p) {
        const y0 = y; curSurf = { mu: 0.3 };
        seg(p.len, t => y0 - p.rise * t / p.len); curSurf = null; y -= p.rise;
      },
      mud(p) {
        const y0 = y, d = p.d;
        curFluid = { level: y0, kind: 'mud' };
        seg(60, t => y0 + d * t / 60);
        seg(p.len - 180, () => y0 + d);
        seg(120, t => y0 + d * (1 - t / 120));
        curFluid = null;
      },
    };

    flat(300);
    for (const { type, p } of stageSections(stageIndex)) {
      const sec = { type, label: SECTIONS[type].label, from: x, to: 0 };
      build[type](p, sec);
      sec.to = x;
      sections.push(sec);
      if (type === 'crawl') {
        plan.push({ x: sec.from - 70, pose: 'mini' });
        plan.push({ x: sec.wallX - 110, pose: 'climber' });
        plan.push({ x: sec.to + 20, pose: 'wheel' });
      } else if (SECTIONS[type].pose) {
        plan.push({ x: sec.from - 70, pose: SECTIONS[type].pose });
        plan.push({ x: sec.to + 20, pose: 'wheel' });
      }
      flat(90);
    }
    flat(60);
    const finishX = x;
    flat(1000);

    const ceilLine = ceil.map(v => (v === -Infinity ? -5000 : v));
    return { ground, ceil, ceilLine, fluid, surf, sections, plan, finishX, startX: CFG.START_X, length: x };
  }

  // ---------------- Course queries ----------------
  const idx = (c, x) => Math.max(0, Math.min(c.ground.length - 1, Math.floor(x / CFG.STEP)));
  const groundAt = (c, x) => c.ground[idx(c, x)];
  const ceilAt = (c, x) => c.ceil[idx(c, x)];
  const fluidAt = (c, x) => c.fluid[idx(c, x)];
  const surfAt = (c, x) => c.surf[idx(c, x)];

  // Nearest point on the polyline through heights h[] (x = i*STEP) around px.
  function nearest(h, px, py) {
    const S = CFG.STEP;
    const i0 = Math.max(0, Math.min(h.length - 2, Math.floor(px / S)));
    let best = Infinity, bx = px, by = py;
    const lo = Math.max(0, i0 - 10), hi = Math.min(h.length - 2, i0 + 10);
    for (let i = lo; i <= hi; i++) {
      const ax = i * S, ay = h[i], dx = S, dy = h[i + 1] - ay;
      let u = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const qx = ax + dx * u, qy = ay + dy * u;
      const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (d2 < best) { best = d2; bx = qx; by = qy; }
    }
    return { x: bx, y: by, d: Math.sqrt(best) };
  }

  function ceilingNearby(c, px) {
    const i0 = idx(c, px);
    for (let i = Math.max(0, i0 - 10); i <= Math.min(c.ceil.length - 1, i0 + 10); i++) {
      if (c.ceil[i] !== -Infinity) return true;
    }
    return false;
  }

  // ---------------- Runner (stick figure + spinning limbs) ----------------
  function resample(stroke, spacing) {
    const out = [{ x: stroke[0].x, y: stroke[0].y }];
    let need = spacing;
    for (let i = 1; i < stroke.length; i++) {
      let ax = stroke[i - 1].x, ay = stroke[i - 1].y;
      const bx = stroke[i].x, by = stroke[i].y;
      let segLen = Math.hypot(bx - ax, by - ay);
      while (segLen >= need) {
        const k = need / segLen;
        ax += (bx - ax) * k; ay += (by - ay) * k;
        out.push({ x: ax, y: ay });
        segLen -= need; need = spacing;
      }
      need -= segLen;
    }
    return out;
  }

  // Each stroke is also copied rotated 180° about its joint, so a half circle becomes a wheel.
  function withMirror(strokes, j) {
    return strokes.concat(strokes.map(s => s.map(p => ({ x: 2 * j.x - p.x, y: 2 * j.y - p.y }))));
  }

  function createRunner(limbs, color, speed) {
    const S = CFG.SCALE;
    const torsoPad = resample([FIG.neck, FIG.hip], CFG.SPACING);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      torsoPad.push({ x: FIG.head.x + Math.cos(a) * FIG.head.r, y: FIG.head.y + Math.sin(a) * FIG.head.r });
    }
    let cx = 0, cy = 0;
    for (const p of torsoPad) { cx += p.x; cy += p.y; }
    cx /= torsoPad.length; cy /= torsoPad.length;
    const toBody = p => ({ x: (p.x - cx) * S, y: (p.y - cy) * S });

    const torso = torsoPad.map(toBody);
    let mass = torso.length;
    const joints = [];
    for (const [kind, jp] of [['arm', FIG.shoulder], ['leg', FIG.hip]]) {
      const strokes = withMirror(limbs[kind] || [], jp);
      const rel = p => ({ x: (p.x - jp.x) * S, y: (p.y - jp.y) * S });
      const lines = strokes.map(s => s.map(rel));
      const pts = [];
      for (const s of strokes) for (const p of resample(s, CFG.SPACING)) pts.push(rel(p));
      let I = 0, reach = 0;
      for (const p of pts) { const r2 = p.x * p.x + p.y * p.y; I += r2; reach = Math.max(reach, Math.sqrt(r2)); }
      I += pts.length * CFG.R * CFG.R * 0.5;
      mass += pts.length;
      const o = toBody(jp);
      joints.push({ kind, ox: o.x, oy: o.y, pts, lines, angle: 0, w: 0,
        invI: pts.length ? 1 / I : 0, reach: reach + CFG.R, active: pts.length > 0 });
    }
    return {
      color, speed: speed || 1,
      torso, spine: [FIG.neck, FIG.shoulder, FIG.hip].map(toBody),
      head: Object.assign(toBody(FIG.head), { r: FIG.head.r * S }),
      joints, mass, invM: 1 / mass, nPts: mass,
      x: 0, y: 0, vx: 0, vy: 0,
    };
  }

  // Calls fn(worldX, worldY, joint|null) for every collision point.
  function eachPoint(b, fn) {
    for (const p of b.torso) fn(b.x + p.x, b.y + p.y, null);
    for (const j of b.joints) {
      if (!j.active) continue;
      const c = Math.cos(j.angle), s = Math.sin(j.angle);
      const ox = b.x + j.ox, oy = b.y + j.oy;
      for (const p of j.pts) fn(ox + p.x * c - p.y * s, oy + p.x * s + p.y * c, j);
    }
  }

  // Put the runner at x, resting on the ground (never lower than maxY if given).
  function settle(course, b, x, maxY) {
    b.x = x;
    let y = Infinity;
    const save = b.y; b.y = 0;
    eachPoint(b, (px, py) => { y = Math.min(y, groundAt(course, px) - CFG.R - py - 1); });
    b.y = maxY === undefined ? y : Math.min(maxY, y);
    if (!isFinite(b.y)) b.y = save;
  }

  function swapLimbs(course, old, limbs) {
    const b = createRunner(limbs, old.color, old.speed);
    b.vx = old.vx; b.vy = old.vy;
    b.joints.forEach((j, i) => { j.angle = old.joints[i].angle; j.w = old.joints[i].w; });
    settle(course, b, old.x, old.y);
    return b;
  }

  // ---------------- Dynamics ----------------
  function impulse(b, j, px, py, nx, ny, pen, s) {
    const rx = j ? px - (b.x + j.ox) : 0, ry = j ? py - (b.y + j.oy) : 0;
    const invI = j ? j.invI : 0;
    let w = j ? j.w : 0;
    let ux = b.vx - w * ry, uy = b.vy + w * rx;
    const vn = ux * nx + uy * ny;
    if (vn < 0) {
      const rn = rx * ny - ry * nx;
      const jn = -(1 + CFG.REST) * vn / (b.invM + rn * rn * invI);
      b.vx += jn * nx * b.invM; b.vy += jn * ny * b.invM;
      if (j) j.w += rn * jn * invI;

      const tx = -ny, ty = nx;
      w = j ? j.w : 0;
      ux = b.vx - w * ry; uy = b.vy + w * rx;
      const belt = s && s.belt ? s.belt : 0;
      const vt = (ux - belt) * tx + uy * ty;
      const rt = rx * ty - ry * tx;
      const lim = CFG.MU * (s && s.mu ? s.mu : 1) * jn;
      let jt = -vt / (b.invM + rt * rt * invI);
      jt = jt < -lim ? -lim : jt > lim ? lim : jt;
      b.vx += jt * tx * b.invM; b.vy += jt * ty * b.invM;
      if (j) j.w += rt * jt * invI;
    }
    const push = Math.min(pen, 6) * 0.4;
    b.x += nx * push; b.y += ny * push;
  }

  function collide(course, b, px, py, j) {
    const R = CFG.R;
    // Ceilings (tunnels). The ceiling polyline jumps far up where there is none,
    // which gives the blocks solid side faces.
    const cy = ceilAt(course, px);
    if (py - R - 4 < cy || ceilingNearby(course, px)) {
      const inside = py < cy;
      const q = nearest(course.ceilLine, px, py);
      const pen = inside ? q.d + R : R - q.d;
      if (pen > 0) {
        let nx = 0, ny = 1;
        if (q.d > 1e-6) {
          nx = (px - q.x) / q.d; ny = (py - q.y) / q.d;
          if (inside) { nx = -nx; ny = -ny; }
        }
        impulse(b, j, px, py, nx, ny, pen, null);
      }
    }
    // Ground
    const gy = groundAt(course, px);
    if (py + R + 4 < gy) return;
    const inside = py > gy;
    const q = nearest(course.ground, px, py);
    const pen = inside ? q.d + R : R - q.d;
    if (pen <= 0) return;
    let nx = 0, ny = -1;
    if (q.d > 1e-6) {
      nx = (px - q.x) / q.d; ny = (py - q.y) / q.d;
      if (inside) { nx = -nx; ny = -ny; }
    }
    impulse(b, j, px, py, nx, ny, pen, surfAt(course, px));
  }

  function step(course, b, dt) {
    b.vy += CFG.G * dt;
    b.vx *= 1 - CFG.AIR * dt;
    const wmax = CFG.WMAX * b.speed;
    for (const j of b.joints) {
      if (!j.active) continue;
      if (j.w < wmax) j.w = Math.min(wmax, j.w + CFG.MOTOR * CFG.G * b.mass * j.reach * j.invI * dt);
      j.angle += j.w * dt;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;

    // Fluids: per-point buoyancy and drag. Spinning limbs paddle through them.
    eachPoint(b, (px, py, j) => {
      const f = fluidAt(course, px);
      if (!f || py < f.level) return;
      const mud = f.kind === 'mud';
      b.vy -= CFG.G * (mud ? CFG.MUD_LIFT : CFG.WATER_LIFT) / b.nPts * dt;
      const rx = j ? px - (b.x + j.ox) : 0, ry = j ? py - (b.y + j.oy) : 0;
      const w = j ? j.w : 0;
      const k = (mud ? CFG.MUD_DRAG : CFG.WATER_DRAG) * dt;
      const fx = -k * (b.vx - w * ry), fy = -k * (b.vy + w * rx);
      b.vx += fx * b.invM; b.vy += fy * b.invM;
      if (j) j.w += (rx * fy - ry * fx) * j.invI;
    });

    eachPoint(b, (px, py, j) => collide(course, b, px, py, j));
  }

  // ---------------- CPU poses (pad coordinates, strokes start at the joint) ----------------
  // Half circle through the joint's horizontal line: from (j.x + r, j.y) around the bottom to (j.x - r, j.y).
  function halfRing(j, r) {
    const pts = [{ x: j.x, y: j.y }];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI;
      pts.push({ x: j.x + Math.cos(a) * r, y: j.y + Math.sin(a) * r });
    }
    return pts;
  }
  const POSES = {
    wheel:   { arm: [halfRing(FIG.shoulder, 27)], leg: [halfRing(FIG.hip, 40)] },
    mini:    { arm: [halfRing(FIG.shoulder, 18)], leg: [halfRing(FIG.hip, 24)] },
    stilts:  { arm: [], leg: [[FIG.hip, { x: FIG.hip.x, y: FIG.hip.y + 76 }, FIG.hip, { x: FIG.hip.x + 76, y: FIG.hip.y }]] },
    climber: { arm: [[FIG.shoulder, { x: FIG.shoulder.x + 100, y: FIG.shoulder.y }]], leg: [halfRing(FIG.hip, 24)] },
  };

  function planIndex(course, x) {
    let k = 0;
    for (let i = 0; i < course.plan.length; i++) if (x >= course.plan[i].x) k = i;
    return k;
  }

  root.DRR = {
    CFG, FIG, PAD_W, PAD_H, SECTIONS, STAGES, POSES, RANDOM_BASE,
    rng, hashSeed, halfRing,
    buildCourse, stageSections, stageLevel, groundAt, ceilAt, fluidAt, surfAt,
    createRunner, swapLimbs, settle, step, eachPoint, planIndex, resample,
  };
})(typeof window !== 'undefined' ? window : globalThis);
