import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const runnerPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'kernel-runner.js');
const {
  DEFAULT_LISTEN_PORT,
  MAX_LOGS,
  normalizePort,
  createRunner,
  buildConfig,
  looksLikeKernelBinary,
} = require(runnerPath);

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
  assert.ok(found.path.endsWith(`${join('scripts', 'v2ray')}`) || found.path.endsWith('/scripts/v2ray'));
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
