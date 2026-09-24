// Headless check: can the CPU (and fixed poses) finish every stage?
// Usage: node tools/sim.cjs [stageCount]
require('../public/src/physics.js');
const D = globalThis.DRR;

function run(stage, mode, speed, delay) {
  const course = D.buildCourse(stage);
  let pose = mode === 'cpu' ? 'wheel' : mode;
  let b = D.createRunner(D.POSES[pose], '#000', speed);
  D.settle(course, b, course.startX);
  let t = 0, planK = 0, wait = -1, stuckAt = null, lastX = b.x, lastCheck = 0;
  while (t < 120) {
    D.step(course, b, D.CFG.DT); t += D.CFG.DT;
    if (mode === 'cpu') {
      const k = D.planIndex(course, b.x);
      if (k !== planK) {
        if (wait < 0) wait = t;
        if (t - wait >= delay) { planK = k; wait = -1; b = D.swapLimbs(course, b, D.POSES[course.plan[k].pose]); }
      }
    }
    if (!isFinite(b.x) || !isFinite(b.y)) return { stage, mode, fail: 'NaN' };
    if (b.x >= course.finishX) return { stage, mode, time: +t.toFixed(2) };
    if (t - lastCheck > 8) {
      if (b.x - lastX < 20) { stuckAt = course.sections.find(s => b.x >= s.from - 60 && b.x <= s.to + 60); break; }
      lastX = b.x; lastCheck = t;
    }
  }
  return { stage, mode, fail: 'stuck', x: Math.round(b.x), at: stuckAt && stuckAt.label };
}

const n = +(process.argv[2] || 4);
for (let s = +(process.env.FROM || 0); s < n; s++) {
  console.log('stage', s + 1, D.stageSections(s).join(','));
  console.log('  ', JSON.stringify(run(s, 'cpu', 1, 0)));
  console.log('  ', JSON.stringify(run(s, "cpu", +(process.env.CPUS||0.65), 3)));
  for (const p of ['wheel', 'stilts']) console.log('  ', JSON.stringify(run(s, p, 1, 0)));
}
