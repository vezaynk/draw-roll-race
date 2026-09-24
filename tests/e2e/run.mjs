// Starts the Worker locally (with test courses allowed), waits for it, runs the e2e tests, stops it.
// Usage: npm run test:e2e   (or node tests/e2e/run.mjs [test files...])
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PORT = process.env.E2E_PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}/`;

// Own process group, so stopping it also stops wrangler's workerd child.
const server = spawn('npx', ['wrangler', 'dev', '--port', PORT, '--ip', '127.0.0.1', '--inspector-port', String(Number(PORT) + 1),
  '--var', 'ALLOW_TEST_STAGES:1', '--persist-to', path.join(root, '.wrangler/e2e-state')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  env: { ...process.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
});
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ } };
process.on('SIGINT', () => { stopServer(); process.exit(130); });
process.on('SIGTERM', () => { stopServer(); process.exit(143); });
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

async function waitForServer() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(BASE + 'api/health');
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('wrangler dev did not start:\n' + log);
}

let code = 1;
try {
  await waitForServer();
  const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : readdirSync(here).filter(f => f.endsWith('.test.mjs')).map(f => path.join(here, f));
  code = await new Promise(resolve => {
    const t = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
      stdio: 'inherit', env: { ...process.env, E2E_BASE: BASE, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    });
    t.on('exit', c => resolve(c ?? 1));
  });
} catch (e) {
  console.error(e.message);
} finally {
  stopServer();
  if (code !== 0 && process.env.E2E_SHOW_SERVER_LOG) console.error(log);
}
process.exit(code);
