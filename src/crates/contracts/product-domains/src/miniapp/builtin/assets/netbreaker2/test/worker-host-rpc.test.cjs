'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, copyFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const test = require('node:test');

function findRepoRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 16; i += 1) {
    if (existsSync(join(current, 'src', 'apps', 'desktop', 'resources', 'worker_host.js'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

function findWorkerHost() {
  const root = findRepoRoot(__dirname);
  return root ? join(root, 'src', 'apps', 'desktop', 'resources', 'worker_host.js') : '';
}

function writeFakeKernel(dir) {
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const kernelPath = join(scriptsDir, 'mihomo');
  writeFileSync(kernelPath, '#!/usr/bin/env node\nsetInterval(() => {}, 1 << 30);\n');
  try { chmodSync(kernelPath, 0o755); } catch { /* ignore */ }
}

function seedWorkerApp() {
  const dir = mkdtempSync(join(tmpdir(), 'netbreaker2-worker-host-'));
  mkdirSync(join(dir, 'source'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }));
  writeFileSync(
    join(dir, 'source', 'worker.js'),
    readFileSync(join(__dirname, '..', 'worker.js'), 'utf8'),
  );
  writeFileSync(
    join(dir, 'scripts', 'kernel-runner.js'),
    readFileSync(join(__dirname, '..', 'scripts', 'kernel-runner.js'), 'utf8'),
  );
  copyFileSync(
    join(__dirname, '..', 'scripts', 'elevate-launch.sh'),
    join(dir, 'scripts', 'elevate-launch.sh'),
  );
  writeFakeKernel(dir);
  return dir;
}

function readJsonLine(child, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for worker_host RPC`));
    }, timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (predicate(msg)) {
          cleanup();
          resolve(msg);
          return;
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`worker_host.js exited (${code}) before answering: ${buffer}`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };
    child.stderr.on('data', onData);
    child.on('exit', onExit);
  });
}

async function callWorker(child, method, params, timeoutMs) {
  const id = `rpc-${method}-${Date.now()}`;
  const startedAt = Date.now();
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })}\n`);
  const msg = await readJsonLine(child, (item) => item && item.id === id, timeoutMs);
  return { elapsedMs: Date.now() - startedAt, msg };
}

test('worker_host.js stays CommonJS under the repo type:module ancestor', async (t) => {
  const workerHost = findWorkerHost();
  if (!workerHost) {
    t.skip('desktop worker_host.js is not in this checkout');
    return;
  }

  const appDir = seedWorkerApp();
  const child = spawn(process.execPath, [workerHost, '{}'], {
    cwd: appDir,
    env: {
      ...process.env,
      BITFUN_MINIAPP_DIR: appDir,
      BITFUN_NETBREAKER2_ELEVATED: '1',
      BITFUN_NETBREAKER2_TUN: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => {
    try { child.stdin.end(); } catch { /* ignore */ }
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  });

  const ready = await readJsonLine(child, (msg) => msg && msg.id === '__ready', 4000);
  assert.ok(ready.result && ready.result.pid);

  const status = await callWorker(child, 'status', {}, 4000);
  assert.ok(status.elapsedMs < 3000, `status blocked for ${status.elapsedMs}ms`);
  assert.equal(status.msg.error, undefined, JSON.stringify(status.msg));
  assert.equal(status.msg.result.kernelOk, true);

  const started = await callWorker(child, 'start', { port: 18093, elevate: false }, 4000);
  assert.ok(started.elapsedMs < 3000, `start blocked for ${started.elapsedMs}ms`);
  assert.equal(started.msg.error, undefined, JSON.stringify(started.msg));
  assert.equal(started.msg.result.ok, true);
  assert.equal(started.msg.result.running, true);
  assert.ok(started.msg.result.tunName);

  const ping = await callWorker(child, 'ping', { port: 18093 }, 8000);
  assert.ok(ping.elapsedMs < 7000, `ping blocked for ${ping.elapsedMs}ms`);
  assert.equal(ping.msg.error, undefined, JSON.stringify(ping.msg));

  const stopped = await callWorker(child, 'stop', {}, 4000);
  assert.ok(stopped.elapsedMs < 3000, `stop blocked for ${stopped.elapsedMs}ms`);
  assert.equal(stopped.msg.result.running, false);
});
