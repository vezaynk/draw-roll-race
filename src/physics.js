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
  // Section catalogue. `pose` is what the CPU switches to for that section.
  const SECTIONS = {
    rolling:   { label: 'Rolling Hills' },
    bumps:     { label: 'Bumpy Road' },
    stairs:    { label: 'Stairs', pose: 'stilts' },
    trenches:  { label: 'Trenches', pose: 'stilts' },
    chasm:     { label: 'Chasm', pose: 'stilts' },
    swell:     { label: 'Big Wave' },
    ramps:     { label: 'Sawtooth' },
    tunnel:    { label: 'Tunnel', pose: 'mini' },
    hurdles:   { label: 'Hurdles', pose: 'stilts' },
    drop:      { label: 'Drop' },
    incline:   { label: 'Steep Climb' },
    pool:      { label: 'Pool', pose: 'stilts' },
    ledge:     { label: 'Wall', pose: 'climber' },
    crawl:     { label: 'Crawl & Climb' },
    conveyor:  { label: 'Conveyor' },
    ice:       { label: 'Ice Slope' },
    mud:       { label: 'Mud Pit', pose: 'stilts' },
  };

  const STAGES = [
    ['rolling', 'bumps', 'stairs', 'swell', 'trenches', 'conveyor', 'ramps', 'rolling'],
    ['bumps', 'hurdles', 'pool', 'ice', 'ledge', 'stairs', 'chasm', 'drop', 'incline'],
    ['swell', 'tunnel', 'mud', 'ramps', 'crawl', 'trenches', 'pool', 'conveyor', 'stairs', 'hurdles', 'drop'],
  ];

  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Stages beyond the fixed ones are shuffled from the whole catalogue.
  function stageSections(n) {
    if (n < STAGES.length) return STAGES[n];
    const rand = rng(n * 7919 + 17);
    const keys = Object.keys(SECTIONS);
    const out = [];
    const count = 9 + Math.min(4, n - STAGES.length);
    while (out.length < count) {
      const k = keys[Math.floor(rand() * keys.length)];
      if (out[out.length - 1] !== k) out.push(k);
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
      rolling() {
        const y0 = y, L = 760;
        const h = t => 28 * Math.sin(t / 170) + 13 * Math.sin(t / 73 + 0.7) + 6 * Math.sin(t / 37 + 2.4);
        seg(L, t => y0 + Math.sin(Math.PI * t / L) * h(t));
      },
      bumps() { const y0 = y; seg(480, t => y0 - 12 * (1 - Math.cos(2 * Math.PI * t / 40)) / 2); },
      stairs() {
        for (let k = 0; k < 3; k++) { y -= 36; flat(96); }
        const y1 = y; seg(280, t => y1 + 108 * t / 280); y += 108;
      },
      trenches() {
        const y0 = y;
        for (let k = 0; k < 2; k++) { seg(110, () => y0); seg(64, () => y0 + 34); }
        seg(110, () => y0);
      },
      chasm() { const y0 = y; seg(80, () => y0); seg(92, () => y0 + 60); seg(80, () => y0); },
      swell() { const y0 = y, L = 620; seg(L, t => y0 - 100 * (1 - Math.cos(2 * Math.PI * t / L)) / 2); },
      ramps() { for (let k = 0; k < 4; k++) { const y0 = y; seg(100, t => y0 - 42 * t / 100); } },
      tunnel() {
        const y0 = y;
        flat(60);
        seg(380, () => y0, () => y0 - CFG.CLEARANCE);
        flat(60);
      },
      hurdles() {
        const y0 = y;
        for (let k = 0; k < 3; k++) { seg(96, () => y0); seg(12, () => y0 - 28); }
        seg(96, () => y0);
      },
      drop() { flat(40); y += 140; flat(40); },
      incline() { const y0 = y; seg(230, t => y0 - 115 * t / 230); y -= 115; },
      pool() {
        const y0 = y, d = 130;
        curFluid = { level: y0, kind: 'water' };
        seg(60, t => y0 + d * t / 60);
        seg(340, () => y0 + d);
        seg(300, t => y0 + d * (1 - t / 300));
        curFluid = null;
      },
      ledge() {
        flat(60); y -= 88; flat(170);
        const y1 = y; seg(300, t => y1 + 88 * t / 300); y += 88;
      },
      crawl(sec) {
        const y0 = y;
        flat(60);
        seg(260, () => y0, () => y0 - CFG.CLEARANCE);
        flat(180);
        sec.wallX = x;
        y -= 80; flat(170);
        const y1 = y; seg(300, t => y1 + 80 * t / 300); y += 80;
      },
      conveyor() { curSurf = { belt: -120 }; flat(440); curSurf = null; },
      ice() {
        const y0 = y; curSurf = { mu: 0.3 };
        seg(520, t => y0 - 100 * t / 520); curSurf = null; y -= 100;
      },
      mud() {
        const y0 = y, d = 60;
        curFluid = { level: y0, kind: 'mud' };
        seg(60, t => y0 + d * t / 60);
        seg(240, () => y0 + d);
        seg(120, t => y0 + d * (1 - t / 120));
        curFluid = null;
      },
    };

    flat(300);
    for (const type of stageSections(stageIndex)) {
      const sec = { type, label: SECTIONS[type].label, from: x, to: 0 };
      build[type](sec);
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
    CFG, FIG, PAD_W, PAD_H, SECTIONS, STAGES, POSES,
    buildCourse, stageSections, groundAt, ceilAt, fluidAt, surfAt,
    createRunner, swapLimbs, settle, step, eachPoint, planIndex, resample,
  };
})(typeof window !== 'undefined' ? window : globalThis);
