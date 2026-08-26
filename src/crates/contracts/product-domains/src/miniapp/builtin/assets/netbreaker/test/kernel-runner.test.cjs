'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
  DEFAULT_LISTEN_PORT,
  MAX_LOGS,
  normalizePort,
  createRunner,
  buildConfig,
  looksLikeKernelBinary,
} = require('../scripts/kernel-runner');

function scratch() {
  return mkdtempSync(join(tmpdir(), 'netbreaker-kernel-'));
}

test('normalizePort rejects out-of-range values', () => {
  assert.equal(normalizePort('10808'), 10808);
  assert.equal(normalizePort('0'), DEFAULT_LISTEN_PORT);
  assert.equal(normalizePort('70000'), DEFAULT_LISTEN_PORT);
  assert.equal(normalizePort('nope', 9050), 9050);
});

test('buildConfig writes a local SOCKS inbound', () => {
  const config = buildConfig(10808);
  assert.equal(config.inbounds[0].protocol, 'socks');
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.inbounds[0].port, 10808);
  assert.equal(config.outbounds[0].protocol, 'freedom');
});

test('locateKernel reports missing kernel honestly', () => {
  const dir = scratch();
  const located = createRunner(dir).locateKernel();
  assert.equal(located.ok, false);
  assert.match(located.error, /kernel not found/i);
});

test('locateKernel prefers scripts/v2ray and ignores js wrappers', () => {
  const dir = scratch();
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'v2ray.js'), 'console.log("wrapper")');
  assert.equal(looksLikeKernelBinary(join(dir, 'scripts', 'v2ray.js')), false);

  const missing = createRunner(dir).locateKernel();
  assert.equal(missing.ok, false);

  writeFileSync(join(dir, 'scripts', 'v2ray'), 'fake-kernel');
  const found = createRunner(dir).locateKernel();
  assert.equal(found.ok, true);
  assert.equal(found.source, 'app');
  assert.ok(found.path.endsWith(join('scripts', 'v2ray')));
});

test('writeConfig and log ring stay at last 10 entries', () => {
  const dir = scratch();
  const runner = createRunner(dir);
  runner.writeConfig(19090);
  const raw = JSON.parse(readFileSync(join(dir, 'runtime', 'config.json'), 'utf8'));
  assert.equal(raw.inbounds[0].port, 19090);

  for (let i = 0; i < 15; i += 1) {
    runner.appendLog('info', `line-${i}`);
  }
  const status = runner.status();
  assert.equal(status.logs.length, MAX_LOGS);
  assert.equal(status.logs[0].message, 'line-5');
  assert.equal(status.logs[9].message, 'line-14');
  assert.equal(status.port, DEFAULT_LISTEN_PORT);
  assert.equal(status.running, false);
});

test('ensureKernel without fetch does not invent a binary', async () => {
  const dir = scratch();
  const result = await createRunner(dir).ensureKernel({ fetch: false });
  assert.equal(result.kernelOk, false);
  assert.equal(result.fetched, false);
  assert.match(result.error || result.kernelError, /kernel not found/i);
});

function writeFakeKernel(dir) {
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const kernelPath = join(scriptsDir, 'v2ray');
  writeFileSync(kernelPath, '#!/usr/bin/env node\nsetInterval(() => {}, 1 << 30);\n');
  try {
    const { chmodSync } = require('node:fs');
    chmodSync(kernelPath, 0o755);
  } catch {
    /* ignore */
  }
  return kernelPath;
}

test('start() returns promptly while the detached kernel keeps running', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir);
  const startedAt = Date.now();
  const started = runner.start({ port: 18081 });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(started.ok, true);
  assert.equal(started.running, true);
  assert.ok(Number.isInteger(started.pid) && started.pid > 0);
  assert.ok(elapsedMs < 2000, `start() blocked for ${elapsedMs}ms`);
  assert.equal(runner.isRunning(), true);
  const stopped = runner.stop();
  assert.equal(stopped.running, false);
});

test('start.js named script exits while the kernel stays up', () => {
  const { spawnSync } = require('node:child_process');
  const dir = scratch();
  writeFakeKernel(dir);
  const startJs = join(__dirname, '..', 'scripts', 'start.js');
  const stopJs = join(__dirname, '..', 'scripts', 'stop.js');
  const env = { ...process.env, BITFUN_MINIAPP_DIR: dir };
  const startedAt = Date.now();
  const started = spawnSync(process.execPath, [startJs, '--port', '18082'], {
    env,
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(started.status, 0, started.stderr || started.stdout);
  assert.ok(elapsedMs < 3000, `start.js blocked for ${elapsedMs}ms`);
  const payload = JSON.parse(started.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.running, true);
  const stopped = spawnSync(process.execPath, [stopJs], {
    env,
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true,
  });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(JSON.parse(stopped.stdout).running, false);
});
