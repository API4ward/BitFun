'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, chmodSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const {
  DEFAULT_LISTEN_PORT,
  MAX_LOGS,
  TUN_DEVICE_LINUX,
  normalizePort,
  createRunner,
  buildConfig,
  renderConfig,
  planElevationLaunch,
  pickReleaseAsset,
  looksLikeKernelBinary,
} = require('../scripts/kernel-runner');

function scratch() {
  return mkdtempSync(join(tmpdir(), 'netbreaker2-kernel-'));
}

function writeFakeKernel(dir, name = 'mihomo') {
  const scriptsDir = join(dir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  const kernelPath = join(scriptsDir, name);
  writeFileSync(kernelPath, '#!/usr/bin/env node\nsetInterval(() => {}, 1 << 30);\n');
  try { chmodSync(kernelPath, 0o755); } catch { /* ignore */ }
  return kernelPath;
}

function elevatedProbes(overrides) {
  return Object.assign({
    isElevated: () => true,
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

test('buildConfig enables TUN with auto-route and a local mixed inbound', () => {
  const config = buildConfig({ port: 7890, tunDevice: TUN_DEVICE_LINUX, stack: 'system' });
  assert.equal(config['mixed-port'], 7890);
  assert.equal(config.tun.enable, true);
  assert.equal(config.tun.stack, 'system');
  assert.equal(config.tun['auto-route'], true);
  assert.equal(config.tun.device, TUN_DEVICE_LINUX);
  assert.equal(config.rules[0], 'MATCH,DIRECT');
  const yaml = renderConfig(config);
  assert.match(yaml, /enable: true/);
  assert.match(yaml, /auto-route: true/);
  assert.doesNotMatch(yaml, /socks-in/);
});

test('locateKernel reports missing kernel honestly and ignores js wrappers', () => {
  const dir = scratch();
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'clash.js'), 'console.log("wrapper")');
  assert.equal(looksLikeKernelBinary(join(dir, 'scripts', 'clash.js')), false);

  const missing = createRunner(dir).locateKernel();
  assert.equal(missing.ok, false);
  assert.match(missing.error, /kernel not found/i);

  writeFileSync(join(dir, 'scripts', 'mihomo'), 'fake-kernel');
  const found = createRunner(dir).locateKernel();
  assert.equal(found.ok, true);
  assert.equal(found.kernel, 'mihomo');
  assert.ok(found.path.endsWith(join('scripts', 'mihomo')));
});

test('writeConfig and log ring stay at last 10 entries', () => {
  const dir = scratch();
  const runner = createRunner(dir);
  runner.writeConfig({ port: 19090 });
  const raw = readFileSync(join(dir, 'runtime', 'config.yaml'), 'utf8');
  assert.match(raw, /mixed-port: 19090/);
  assert.match(raw, /enable: true/);

  for (let i = 0; i < 15; i += 1) {
    runner.appendLog('info', `line-${i}`);
  }
  const status = runner.status();
  assert.equal(status.logs.length, MAX_LOGS);
  assert.equal(status.logs[0].message, 'line-5');
  assert.equal(status.logs[9].message, 'line-14');
  assert.equal(status.running, false);
});

test('planElevationLaunch never returns a silent helper', () => {
  const missing = planElevationLaunch({
    platform: 'linux',
    helper: '',
    wrapperPath: '/tmp/w.sh',
    kernelPath: '/tmp/mihomo',
    configPath: '/tmp/c.yaml',
    workDir: '/tmp',
    pidPath: '/tmp/p',
    logPath: '/tmp/l',
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /never silent|unavailable/i);

  const linux = planElevationLaunch({
    platform: 'linux',
    helper: 'pkexec',
    wrapperPath: '/tmp/w.sh',
    kernelPath: '/tmp/mihomo',
    configPath: '/tmp/c.yaml',
    workDir: '/tmp',
    pidPath: '/tmp/p',
    logPath: '/tmp/l',
  });
  assert.equal(linux.ok, true);
  assert.equal(linux.prompt, true);
  assert.equal(linux.command, 'pkexec');
  assert.ok(linux.argv.includes('--disable-internal-agent'));

  const mac = planElevationLaunch({
    platform: 'darwin',
    helper: 'osascript',
    wrapperPath: '/tmp/w.sh',
    kernelPath: '/tmp/mihomo',
    configPath: '/tmp/c.yaml',
    workDir: '/tmp',
    pidPath: '/tmp/p',
    logPath: '/tmp/l',
  });
  assert.equal(mac.prompt, true);
  assert.match(mac.argv.join(' '), /administrator privileges/);

  const win = planElevationLaunch({
    platform: 'win32',
    helper: 'uac',
    wrapperPath: 'C:\\w.cmd',
    kernelPath: 'C:\\mihomo.exe',
    configPath: 'C:\\c.yaml',
    workDir: 'C:\\w',
    pidPath: 'C:\\p',
    logPath: 'C:\\l',
  });
  assert.equal(win.prompt, true);
  assert.match(win.argv.join(' '), /RunAs/);
});

test('remote or tun-less hosts fail loudly and do not fake success', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const remote = createRunner(dir, {
    probes: elevatedProbes({
      unsupportedHost: () => ({
        unsupported: true,
        reason: 'Remote, peer, or detached host cannot create a local TUN device. Use a local BitFun host.',
      }),
    }),
  }).start({ port: 18081, elevate: true });
  assert.equal(remote.ok, false);
  assert.equal(remote.running, false);
  assert.equal(remote.localProcessUnsupported, true);
  assert.match(remote.error, /Remote, peer, or detached/);

  const noTun = createRunner(dir, {
    probes: elevatedProbes({ hasTunDevice: () => false }),
  }).start({ port: 18081, elevate: true });
  assert.equal(noTun.ok, false);
  assert.equal(noTun.running, false);
  assert.match(noTun.error, /tun|virtual NIC/i);
});

test('start without elevate refuses when privileges are missing', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const result = createRunner(dir, {
    probes: elevatedProbes({ isElevated: () => false }),
  }).start({ port: 18081, elevate: false });
  assert.equal(result.ok, false);
  assert.equal(result.needsElevation, true);
  assert.equal(result.running, false);
  assert.match(result.error, /never silent|elevated/i);
});

test('ensureKernel without fetch does not invent a binary', async () => {
  const dir = scratch();
  const result = await createRunner(dir).ensureKernel({ fetch: false });
  assert.equal(result.kernelOk, false);
  assert.equal(result.fetched, false);
  assert.match(result.error || result.kernelError, /kernel not found/i);
});

test('pickReleaseAsset prefers the default mihomo gzip', () => {
  const original = { platform: process.platform, arch: process.arch };
  if (original.platform !== 'linux' || original.arch !== 'x64') {
    return;
  }
  const asset = pickReleaseAsset([
    { name: 'mihomo-linux-amd64-v1-v1.19.29.gz', browser_download_url: 'https://example.test/v1' },
    { name: 'mihomo-linux-amd64-compatible-v1.19.29.gz', browser_download_url: 'https://example.test/compat' },
    { name: 'mihomo-linux-amd64-v1.19.29.gz', browser_download_url: 'https://example.test/default' },
    { name: 'mihomo-linux-amd64-v1.19.29.rpm', browser_download_url: 'https://example.test/rpm' },
  ]);
  assert.equal(asset.name, 'mihomo-linux-amd64-v1.19.29.gz');
});

test('start() returns promptly while the detached kernel keeps running', () => {
  const dir = scratch();
  writeFakeKernel(dir);
  const runner = createRunner(dir, { probes: elevatedProbes() });
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

test('start.js named script exits while the kernel stays up', () => {
  const { spawnSync } = require('node:child_process');
  const dir = scratch();
  writeFakeKernel(dir);
  const startJs = join(__dirname, '..', 'scripts', 'start.js');
  const stopJs = join(__dirname, '..', 'scripts', 'stop.js');
  const env = {
    ...process.env,
    BITFUN_MINIAPP_DIR: dir,
    BITFUN_NETBREAKER2_ELEVATED: '1',
    BITFUN_NETBREAKER2_TUN: '1',
    BITFUN_NETBREAKER2_UNSUPPORTED: '0',
  };
  const startedAt = Date.now();
  const started = spawnSync(process.execPath, [startJs, '--port', '18082', '--no-elevate'], {
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
