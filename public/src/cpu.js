// Draw Roll Race — CPU racers.
// Each CPU gets a personality from its seed: how fast its limbs spin, how quickly it reacts,
// how far ahead it looks, how often it picks the wrong shape, and its own versions of each shape.
// Used by solo races, by the room host (who runs the room's CPUs) and by tools/sim.cjs.
(function (root) {
  'use strict';
  const D = root.DRR;
  const { FIG, halfRing } = D;

  const DIFFICULTY = {
    //         limb speed     reaction (s)   wrong shape  looks ahead (world units)
    easy:   { speed: [0.50, 0.58], react: [2.6, 4.2], mistake: 0.30, ahead: [20, 70] },
    normal: { speed: [0.60, 0.70], react: [1.4, 3.0], mistake: 0.12, ahead: [50, 110] },
    hard:   { speed: [0.74, 0.84], react: [0.4, 1.2], mistake: 0.04, ahead: [80, 140] },
  };
  const NAMES = ['Bolt', 'Wobble', 'Spoke', 'Zippy', 'Noodle', 'Gizmo', 'Pogo', 'Rusty', 'Dash',
    'Sprocket', 'Doodle', 'Tumble', 'Whirl', 'Clank', 'Scoot', 'Pip'];
  const STUCK_AFTER = 3;          // seconds without progress before trying another shape
  const RECOVERY = ['stilts', 'wheel', 'climber', 'mini'];

  const pick = (r, [a, b]) => a + (b - a) * r();

  function cross(len, tilt) {
    // One stroke hip -> tip -> hip -> tip; the mirror copy completes a four-spoke cross.
    const j = FIG.hip, c = Math.cos(tilt), s = Math.sin(tilt);
    return [j, { x: j.x - s * len, y: j.y + c * len }, j, { x: j.x + c * len, y: j.y + s * len }];
  }

  // Randomised shapes, kept inside the sizes that work (mini must fit the tunnel, and so on).
  function shapes(r) {
    const armless = r() < 0.2;
    return {
      wheel: { arm: armless ? [] : [halfRing(FIG.shoulder, Math.round(pick(r, [20, 30])))], leg: [halfRing(FIG.hip, Math.round(pick(r, [34, 44])))] },
      mini: { arm: [halfRing(FIG.shoulder, Math.round(pick(r, [14, 19])))], leg: [halfRing(FIG.hip, Math.round(pick(r, [20, 25])))] },
      stilts: { arm: [], leg: [cross(Math.round(pick(r, [70, 84])), pick(r, [-0.3, 0.3]))] },
      climber: { arm: [[FIG.shoulder, { x: FIG.shoulder.x + Math.round(pick(r, [92, 110])), y: FIG.shoulder.y }]], leg: [halfRing(FIG.hip, Math.round(pick(r, [20, 25])))] },
    };
  }

  function personality(seed, difficulty) {
    const d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    const r = D.rng(D.hashSeed('cpu' + seed));
    return {
      difficulty: DIFFICULTY[difficulty] ? difficulty : 'normal',
      name: NAMES[Math.floor(r() * NAMES.length)],
      speed: pick(r, d.speed),
      react: d.react, mistake: d.mistake,
      ahead: pick(r, d.ahead),
      shapes: shapes(r),
      rand: r,
    };
  }

  // opts: { seed, difficulty, color, onSwap(limbs) }
  function createCpu(course, opts) {
    const P = personality(opts.seed, opts.difficulty);
    const r = P.rand;
    const cpu = {
      name: P.name, difficulty: P.difficulty, speed: P.speed,
      pose: 'wheel', limbs: P.shapes.wheel,
      runner: D.createRunner(P.shapes.wheel, opts.color, P.speed),
      finishTime: null,
      planK: 0, pending: null, redrawAt: null, progressX: -Infinity, progressT: 0, recover: 0,
      step, setPose, placeAt,
    };
    D.settle(course, cpu.runner, course.startX);
    cpu.progressX = cpu.runner.x;

    function setPose(pose, force) {
      if (pose === cpu.pose && !force) return;
      cpu.pose = pose;
      cpu.limbs = P.shapes[pose];
      cpu.runner = D.swapLimbs(course, cpu.runner, cpu.limbs);
      if (opts.onSwap) opts.onSwap(cpu.limbs, pose);
    }

    // Resume from a known position (a new host taking over a CPU mid-race).
    function placeAt(x, y, a, b, pose) {
      if (pose && P.shapes[pose]) { cpu.pose = pose; cpu.limbs = P.shapes[pose]; cpu.runner = D.createRunner(cpu.limbs, opts.color, P.speed); }
      const rn = cpu.runner;
      rn.x = x; rn.y = y; rn.vx = 0; rn.vy = 0;
      if (rn.joints[0]) rn.joints[0].angle = a;
      if (rn.joints[1]) rn.joints[1].angle = b;
      cpu.planK = D.planIndex(course, x + P.ahead);
      cpu.progressX = x;
    }

    function step(dt, t) {
      if (cpu.finishTime !== null) return;
      D.step(course, cpu.runner, dt);

      // Spikes took a limb: carry on without it, then redraw the same shape after reacting.
      const broken = D.shatter(course, cpu.runner, cpu.limbs);
      if (broken) {
        const old = cpu.runner;
        cpu.limbs = broken.limbs;
        cpu.runner = broken.runner;
        if (opts.onSwap) opts.onSwap(cpu.limbs, cpu.pose, broken.lost, old);
        cpu.redrawAt = t + pick(r, P.react);
      }
      if (cpu.redrawAt !== null && t >= cpu.redrawAt) {
        cpu.redrawAt = null;
        setPose(cpu.pose, true);
      }
      const x = cpu.runner.x;

      // Notice the next section a little before reaching it, then react after a delay.
      const k = D.planIndex(course, x + P.ahead);
      if (k !== cpu.planK && (!cpu.pending || cpu.pending.k !== k)) {
        let pose = course.plan[k].pose;
        if (pose !== 'wheel' && r() < P.mistake) pose = r() < 0.5 ? 'wheel' : RECOVERY[Math.floor(r() * RECOVERY.length)];
        cpu.pending = { k, pose, at: t + pick(r, P.react) };
      }
      if (cpu.pending && t >= cpu.pending.at) {
        cpu.planK = cpu.pending.k;
        setPose(cpu.pending.pose);
        cpu.pending = null;
      }

      // Stuck? Try the right shape for here, then the others in turn.
      if (x > cpu.progressX + 25) { cpu.progressX = x; cpu.progressT = t; }
      else if (t - cpu.progressT > STUCK_AFTER && !cpu.pending) {
        const right = course.plan[D.planIndex(course, x + 40)].pose;
        let next = right;
        if (cpu.pose === right) next = RECOVERY.filter(p => p !== cpu.pose)[cpu.recover++ % (RECOVERY.length - 1)];
        setPose(next);
        cpu.progressT = t;
      }

      if (x >= course.finishX) cpu.finishTime = t;
    }

    return cpu;
  }

  root.DRR.createCpu = createCpu;
  root.DRR.CPU_DIFFICULTIES = Object.keys(DIFFICULTY);
})(typeof window !== 'undefined' ? window : globalThis);
