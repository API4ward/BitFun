'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync } = require('node:fs');
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
  pickReleaseAsset,
  planElevationLaunch,
} = require('../scripts/kernel-runner');

function scratch() {
  return mkdtempSync(join(tmpdir(), 'netbreaker2-kernel-'));
}

function writeFakeKernel(dir) {
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const kernelPath = join(scriptsDir, 'mihomo');
  writeFileSync(kernelPath, '#!/usr/bin/env node\nsetInterval(() => {}, 1 << 30);\n');
  try { chmodSync(kernelPath, 0o755); } catch { /* ignore */ }
  return kernelPath;
}

function probes(overrides) {
  return Object.assign({
    isElevated: () => false,
    hasTunDevice: () => true,
    findHelper: () => 'pkexec',
    unsupportedHost: () => ({ unsupported: false, reason: '' }),
    tunInterfaceExists: () => false,
  }, overrides);
}

test('normalizePort rejects out-of-range values', () => {
  assert.equal(normalizePort('7890'), 7890);
  assert.equal(normalizePort('0'), DEFAULT_LISTEN_PORT);
  assert.equal(normalizePort('70000'), DEFAULT_LISTEN_PORT);
  assert.equal(normalizePort('nope', 9050), 9050);
});

test('buildConfig writes mixed-port, TUN, and DIRECT outbound', () => {
  const config = buildConfig({ port: 7890 });
  assert.equal(config['mixed-port'], 7890);
  assert.equal(config.tun.enable, true);
  assert.ok(config.tun.stack === 'system' || config.tun.stack === 'gvisor');
  assert.deepEqual(config.proxies, []);
  assert.equal(config.rules[0], 'MATCH,DIRECT');
});

test('planElevationLaunch never invents a silent sudo path', () => {
  const missing = planElevationLaunch({
    helper: '',
    wrapperPath: '/tmp/elevate-launch.sh',
    kernelPath: '/tmp/mihomo',
    configPath: '/tmp/config.yaml',
    workDir: '/tmp',
    pidPath: '/tmp/clash.pid',
    logPath: '/tmp/kernel.log',
    platform: 'linux',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /never silent|unavailable/i);

  const pkexec = planElevationLaunch({
    helper: 'pkexec',
    wrapperPath: '/tmp/elevate-launch.sh',
    kernelPath: '/tmp/mihomo',
    configPath: '/tmp/config.yaml',
    workDir: '/tmp',
    pidPath: '/tmp/clash.pid',
    logPath: '/tmp/kernel.log',
    platform: 'linux',
  });
  assert.equal(pkexec.ok, true);
  assert.equal(pkexec.command, 'pkexec');
  assert.equal(pkexec.prompt, true);
});

test('pickReleaseAsset prefers official mihomo OS/arch archives', () => {
  const asset = pickReleaseAsset([
    { name: 'mihomo-linux-amd64-compatible-v1.19.12.gz', browser_download_url: 'https://example.invalid/compat' },
    { name: 'mihomo-linux-amd64-v1.19.12.gz', browser_download_url: 'https://example.invalid/ok' },
    { name: 'mihomo-windows-amd64-v1.19.12.zip', browser_download_url: 'https://example.invalid/win' },
  ]);
  if (process.platform === 'linux' && process.arch === 'x64') {
    assert.equal(asset.browser_download_url, 'https://example.invalid/ok');
  }
});

test('locateKernel reports missing kernel honestly', () => {
  const dir = scratch();
  const located = createRunner(dir).locateKernel();
  assert.equal(located.ok, false);
  assert.match(located.error, /kernel not found/i);
});

test('locateKernel prefers scripts/mihomo and ignores js wrappers', () => {
  const dir = scratch();
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'clash.js'), 'console.log("wrapper")');
  assert.equal(looksLikeKernelBinary(join(dir, 'scripts', 'clash.js')), false);

  const missing = createRunner(dir).locateKernel();
  assert.equal(missing.ok, false);

  writeFileSync(join(dir, 'scripts', 'mihomo'), 'fake-kernel');
  const found = createRunner(dir).locateKernel();
  assert.equal(found.ok, true);
  assert.equal(found.source, 'app');
  assert.ok(found.path.endsWith(join('scripts', 'mihomo')));
});

test('writeConfig and log ring stay at last 10 entries', () => {
  const dir = scratch();
  const runner = createRunner(dir);
  runner.writeConfig({ port: 19090 });
  const raw = readFileSync(join(dir, 'runtime', 'config.yaml'), 'utf8');
  assert.match(raw, /mixed-port:\s*19090/);
  assert.match(raw, /enable:\s*true/);
  assert.match(raw, /MATCH,DIRECT/);

  for (let i = 0; i < 15; i += 1) {
    runner.appendLog('info', `line-${i}`);
  }
  const status = runner.status();
  assert.equal(status.logs.length, MAX_LOGS);
  assert.equal(status.logs[0].message, 'line-5');
  assert.equal(status.logs[9].message, 'line-14');
  assert.equal(status.port, 19090);
  assert.equal(status.running, false);
});

test('ensureKernel without fetch does not invent a binary', async () => {
  const dir = scratch();
  const result = await createRunner(dir, { probes: probes() }).ensureKernel({ fetch: false });
  assert.equal(result.kernelOk, false);
  assert.equal(result.fetched, false);
  assert.equal(result.uiState, 'kernelMissing');
  assert.match(result.error || result.kernelError, /kernel not found/i);
});

test('start without privilege fails closed and does not spawn TUN', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir, { probes: probes() });
  const started = runner.start({ port: 18091, elevate: false });
  assert.equal(started.ok, false);
  assert.equal(started.running, false);
  assert.equal(started.uiState, 'elevationRequired');
  assert.equal(existsSync(join(dir, 'runtime', 'clash.pid')), false);
});

test('start with tunUnavailable fails closed', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir, {
    probes: probes({
      hasTunDevice: () => false,
    }),
  });
  const started = runner.start({ port: 18092, elevate: true });
  assert.equal(started.ok, false);
  assert.equal(started.running, false);
  assert.equal(started.uiState, 'tunUnavailable');
  assert.equal(existsSync(join(dir, 'runtime', 'clash.pid')), false);
});

test('remote host is rejected loudly and never starts TUN', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir, {
    probes: probes({
      isElevated: () => true,
      unsupportedHost: () => ({
        unsupported: true,
        reason: 'NetBreaker2 is LocalOnly. Remote workspace cannot create a local TUN device.',
      }),
    }),
  });
  const started = runner.start({ port: 18093, elevate: true });
  assert.equal(started.ok, false);
  assert.equal(started.uiState, 'remoteUnsupported');
  assert.equal(started.running, false);
  assert.match(started.error, /LocalOnly/i);
});

test('start() returns promptly while the detached kernel keeps running', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir, {
    probes: probes({ isElevated: () => true }),
  });
  const startedAt = Date.now();
  const started = runner.start({ port: 18081, elevate: false });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(started.ok, true);
  assert.equal(started.running, true);
  assert.ok(Number.isInteger(started.pid) && started.pid > 0);
  assert.ok(elapsedMs < 2000, `start() blocked for ${elapsedMs}ms`);
  assert.equal(runner.isRunning(), true);
  const stopped = runner.stop();
  assert.equal(stopped.running, false);
});

test('bundled sources do not contain credentials or committed kernel binaries', () => {
  const { readdirSync } = require('node:fs');
  const root = join(__dirname, '..');
  const forbidden = /sk-[A-Za-z0-9]{10,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY/;
  const binaryNames = new Set(['clash', 'clash.exe', 'mihomo', 'mihomo.exe', 'clash-meta', 'clash-meta.exe']);
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'runtime' || entry.name === 'test') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      assert.equal(binaryNames.has(entry.name), false, `committed kernel binary ${full}`);
      if (/\.(js|cjs|json|md|html|css)$/i.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        assert.equal(forbidden.test(text), false, `credential-like text in ${full}`);
      }
    }
  }
  walk(root);
});
