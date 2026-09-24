// Headless check that CPUs can finish courses: the fixed stages, endless stages and random courses.
// Usage: node tools/sim.cjs [endlessCount=25] [randomCount=25] [cpusPerDifficulty=3]
require('../public/src/physics.js');
require('../public/src/cpu.js');
const D = globalThis.DRR;

const LIMIT = 240; // seconds: the room's race limit

function race(stage, difficulty, seed) {
  const course = D.buildCourse(stage);
  const cpu = D.createCpu(course, { seed, difficulty, color: '#000' });
  let t = 0;
  while (t < LIMIT && cpu.finishTime === null) {
    cpu.step(D.CFG.DT, t);
    t += D.CFG.DT;
    if (!isFinite(cpu.runner.x) || !isFinite(cpu.runner.y)) return { ok: false, why: 'NaN' };
  }
  if (cpu.finishTime !== null) return { ok: true, time: cpu.finishTime };
  const at = course.sections.find(s => cpu.runner.x >= s.from - 60 && cpu.runner.x <= s.to + 60);
  return { ok: false, why: 'stuck at ' + (at ? at.label : 'x=' + Math.round(cpu.runner.x)) };
}

const endless = +(process.argv[2] || 25), random = +(process.argv[3] || 25), per = +(process.argv[4] || 3);
const stages = [0, 1, 2];
for (let i = 0; i < endless; i++) stages.push(D.STAGES.length + i);
for (let i = 0; i < random; i++) stages.push(D.RANDOM_BASE + 7919 * i + 13);

let fails = 0, runs = 0;
const byDiff = {};
for (const stage of stages) {
  const row = [];
  for (const diff of D.CPU_DIFFICULTIES) {
    for (let k = 0; k < per; k++) {
      const res = race(stage, diff, stage * 31 + k);
      runs++;
      (byDiff[diff] = byDiff[diff] || []).push(res.ok ? res.time : null);
      if (!res.ok) { fails++; row.push(diff + '#' + k + ' ' + res.why); }
    }
  }
  const names = D.stageSections(stage).map(s => s.type).join(',');
  if (row.length) console.log('stage', stage, 'FAIL', row.join('; '), '\n   ', names);
}
for (const [d, ts] of Object.entries(byDiff)) {
  const ok = ts.filter(x => x !== null);
  console.log(d.padEnd(7), 'finished', ok.length + '/' + ts.length, 'mean', (ok.reduce((a, b) => a + b, 0) / ok.length).toFixed(1) + 's');
}
console.log(fails ? fails + ' of ' + runs + ' runs failed' : 'all ' + runs + ' runs finished');
process.exitCode = fails ? 1 : 0;
