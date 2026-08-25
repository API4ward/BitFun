'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_LISTEN_PORT = 10808;
const MAX_LOGS = 10;
const STATE_REL = path.join('runtime', 'netbreaker-state.json');
const PID_REL = path.join('runtime', 'v2ray.pid');
const CONFIG_REL = path.join('runtime', 'config.json');
const KERNEL_LOG_REL = path.join('runtime', 'kernel.log');
const ARCHIVE_REL = path.join('runtime', 'v2ray-kernel.zip');
const V2FLY_LATEST = 'https://api.github.com/repos/v2fly/v2ray-core/releases/latest';
const INTERNET_PROBE = { host: '1.1.1.1', port: 443 };
const FETCH_TIMEOUT_MS = 45000;
const PING_TIMEOUT_MS = 4000;

function normalizePort(value, fallback = DEFAULT_LISTEN_PORT) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function resolveAppDir() {
  return process.env.BITFUN_MINIAPP_DIR || process.cwd();
}

function isJsFile(filePath) {
  return /\.(js|mjs|cjs)$/i.test(filePath);
}

function looksLikeKernelBinary(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || isJsFile(filePath)) return false;
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function whichKernel() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, ['v2ray'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (result.status !== 0) return '';
  const first = String(result.stdout || '').trim().split(/\r?\n/)[0];
  return first && looksLikeKernelBinary(first) ? first : '';
}

function buildConfig(port) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port,
        protocol: 'socks',
        settings: { udp: false, auth: 'noauth' },
      },
    ],
    outbounds: [{ protocol: 'freedom', tag: 'direct' }],
  };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message || String(error) });
    });
  });
}

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'BitFun-NetBreaker', Accept: 'application/json' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        httpsJson(response.headers.location).then(resolve, reject);
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`GitHub API HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('GitHub API timeout'));
    });
    request.on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'BitFun-NetBreaker' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download HTTP ${response.statusCode}`));
        return;
      }
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const out = fs.createWriteStream(destPath);
      response.pipe(out);
      out.on('finish', () => out.close(() => resolve(destPath)));
      out.on('error', reject);
    });
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error('Download timeout'));
    });
    request.on('error', reject);
  });
}

function releaseAssetName() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'linux' && arch === 'x64') return 'v2ray-linux-64.zip';
  if (platform === 'linux' && arch === 'arm64') return 'v2ray-linux-arm64-v8a.zip';
  if (platform === 'darwin' && arch === 'x64') return 'v2ray-macos-64.zip';
  if (platform === 'darwin' && arch === 'arm64') return 'v2ray-macos-arm64-v8a.zip';
  if (platform === 'win32' && arch === 'x64') return 'v2ray-windows-64.zip';
  if (platform === 'win32' && arch === 'arm64') return 'v2ray-windows-arm64-v8a.zip';
  return '';
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${destDir}"`],
      { windowsHide: true, encoding: 'utf8', timeout: 30000 },
    );
    return result.status === 0;
  }
  const result = spawnSync('unzip', ['-o', archivePath, '-d', destDir], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 30000,
  });
  return result.status === 0;
}

function findExtractedKernel(rootDir) {
  const wanted = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === wanted && looksLikeKernelBinary(full)) return full;
    }
  }
  return '';
}

function createRunner(appDir, options) {
  const root = path.resolve(appDir);
  const statePath = path.join(root, STATE_REL);
  const pidPath = path.join(root, PID_REL);
  const configPath = path.join(root, CONFIG_REL);
  const kernelLogPath = path.join(root, KERNEL_LOG_REL);
  const onLog = options && typeof options.onLog === 'function' ? options.onLog : null;

  function loadState() {
    const state = readJson(statePath, {});
    return {
      port: normalizePort(state.port),
      running: false,
      pid: Number.isInteger(state.pid) ? state.pid : null,
      logs: Array.isArray(state.logs) ? state.logs.slice(-MAX_LOGS) : [],
      kernelPath: typeof state.kernelPath === 'string' ? state.kernelPath : '',
    };
  }

  function saveState(state) {
    writeJson(statePath, {
      port: state.port,
      pid: state.pid,
      logs: state.logs.slice(-MAX_LOGS),
      kernelPath: state.kernelPath || '',
    });
  }

  function appendLog(level, message) {
    const state = loadState();
    const entry = {
      ts: Date.now(),
      level: level || 'info',
      message: String(message || '').slice(0, 500),
    };
    state.logs.push(entry);
    state.logs = state.logs.slice(-MAX_LOGS);
    saveState(state);
    if (onLog) onLog(entry);
    return entry;
  }

  function locateKernel() {
    const names = process.platform === 'win32'
      ? ['v2ray.exe', 'v2ray']
      : ['v2ray', 'v2ray.exe'];
    const dirs = [path.join(root, 'scripts'), path.join(root, 'bin')];
    for (const dir of dirs) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (looksLikeKernelBinary(candidate)) {
          return { ok: true, path: candidate, source: 'app' };
        }
      }
    }
    const fromPath = whichKernel();
    if (fromPath) return { ok: true, path: fromPath, source: 'path' };
    return {
      ok: false,
      error: 'v2ray kernel not found. Place v2ray or v2ray.exe in this app scripts/ directory, or run ensure-kernel.',
    };
  }

  function currentPid() {
    try {
      const raw = fs.readFileSync(pidPath, 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      return Number.isInteger(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  function isRunning() {
    const pid = currentPid();
    return pidAlive(pid);
  }

  function writeConfig(port) {
    const config = buildConfig(port);
    writeJson(configPath, config);
    return config;
  }

  function spawnKernel(kernelPath, port) {
    writeConfig(port);
    fs.mkdirSync(path.dirname(kernelLogPath), { recursive: true });
    const logFd = fs.openSync(kernelLogPath, 'a');
    const attempts = [
      ['run', '-c', configPath],
      ['-config', configPath],
    ];
    let lastError = 'failed to spawn v2ray';
    for (const args of attempts) {
      try {
        const child = spawn(kernelPath, args, {
          cwd: root,
          detached: true,
          stdio: ['ignore', logFd, logFd],
          windowsHide: true,
        });
        if (!child.pid) {
          lastError = 'v2ray spawned without a pid';
          continue;
        }
        fs.mkdirSync(path.dirname(pidPath), { recursive: true });
        fs.writeFileSync(pidPath, String(child.pid), 'utf8');
        child.unref();
        try { fs.closeSync(logFd); } catch { /* already inherited */ }
        return { ok: true, pid: child.pid };
      } catch (error) {
        lastError = error.message || String(error);
      }
    }
    try { fs.closeSync(logFd); } catch { /* ignore */ }
    return { ok: false, error: lastError };
  }

  function status() {
    const state = loadState();
    const located = locateKernel();
    const running = isRunning();
    const pid = running ? currentPid() : null;
    return {
      ok: true,
      running,
      pid,
      port: state.port,
      logs: state.logs.slice(-MAX_LOGS),
      kernelOk: located.ok,
      kernelPath: located.ok ? located.path : '',
      kernelError: located.ok ? '' : located.error,
      localProcessUnsupported: false,
    };
  }

  function start(params) {
    const port = normalizePort(params && params.port);
    const located = locateKernel();
    if (!located.ok) {
      appendLog('error', located.error);
      return { ...status(), ok: false, error: located.error };
    }
    if (isRunning()) {
      const state = loadState();
      state.port = port;
      state.kernelPath = located.path;
      saveState(state);
      appendLog('info', `Kernel already running on 127.0.0.1:${state.port}`);
      return status();
    }
    const spawned = spawnKernel(located.path, port);
    if (!spawned.ok) {
      const message = `Failed to start v2ray: ${spawned.error}. A local BitFun host must be able to spawn this process.`;
      appendLog('error', message);
      return { ...status(), ok: false, error: message, localProcessUnsupported: true };
    }
    const state = loadState();
    state.port = port;
    state.pid = spawned.pid;
    state.kernelPath = located.path;
    saveState(state);
    appendLog('ok', `Started v2ray pid ${spawned.pid} listening on 127.0.0.1:${port}`);
    return status();
  }

  function stop() {
    const pid = currentPid();
    if (!pid || !pidAlive(pid)) {
      try { fs.rmSync(pidPath, { force: true }); } catch { /* ignore */ }
      appendLog('info', 'No running kernel process');
      return status();
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      appendLog('error', `Failed to stop v2ray pid ${pid}: ${error.message || error}`);
      return { ...status(), ok: false, error: error.message || String(error) };
    }
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    } catch {
      /* ignore */
    }
    if (pidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
    }
    try { fs.rmSync(pidPath, { force: true }); } catch { /* ignore */ }
    appendLog('ok', `Stopped v2ray pid ${pid}`);
    return status();
  }

  async function ping(params) {
    const port = normalizePort(params && params.port, loadState().port);
    const inbound = await tcpProbe('127.0.0.1', port, PING_TIMEOUT_MS);
    const internet = await tcpProbe(INTERNET_PROBE.host, INTERNET_PROBE.port, PING_TIMEOUT_MS);
    if (inbound.ok) {
      appendLog('ok', `Ping inbound 127.0.0.1:${port} succeeded`);
    } else {
      appendLog('error', `Ping inbound 127.0.0.1:${port} failed: ${inbound.error}`);
    }
    if (internet.ok) {
      appendLog('ok', `Ping ${INTERNET_PROBE.host}:${INTERNET_PROBE.port} succeeded`);
    } else {
      appendLog('error', `Ping ${INTERNET_PROBE.host}:${INTERNET_PROBE.port} failed: ${internet.error}`);
    }
    return {
      ...status(),
      inbound,
      internet,
      ok: inbound.ok || internet.ok,
    };
  }

  async function ensureKernel(params) {
    const located = locateKernel();
    if (located.ok) {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(located.path, 0o755); } catch { /* ignore */ }
      }
      appendLog('ok', `Kernel ready at ${located.path} (${located.source})`);
      const state = loadState();
      state.kernelPath = located.path;
      saveState(state);
      return { ...status(), fetched: false };
    }
    if (!params || !params.fetch) {
      appendLog('error', located.error);
      return { ...status(), ok: false, error: located.error, fetched: false };
    }

    const assetName = releaseAssetName();
    if (!assetName) {
      const error = `No official v2fly asset mapping for ${process.platform}/${process.arch}`;
      appendLog('error', error);
      return { ...status(), ok: false, error, fetched: false };
    }

    try {
      appendLog('info', `Fetching official v2fly release asset ${assetName}`);
      const release = await httpsJson(V2FLY_LATEST);
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const asset = assets.find((item) => item && item.name === assetName);
      if (!asset || !asset.browser_download_url) {
        throw new Error(`Release does not include ${assetName}`);
      }
      const archivePath = path.join(root, ARCHIVE_REL);
      await downloadFile(asset.browser_download_url, archivePath);
      const extractDir = path.join(root, 'runtime', 'kernel-extract');
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (!extractArchive(archivePath, extractDir)) {
        const error = `Downloaded ${archivePath} but could not extract it. Unpack v2ray into scripts/ manually.`;
        appendLog('error', error);
        return { ...status(), ok: false, error, fetched: true };
      }
      const extracted = findExtractedKernel(extractDir);
      if (!extracted) {
        throw new Error('Archive extracted but v2ray binary was not found');
      }
      const destName = process.platform === 'win32' ? 'v2ray.exe' : 'v2ray';
      const dest = path.join(root, 'scripts', destName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(extracted, dest);
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
      appendLog('ok', `Installed kernel to ${dest}`);
      return { ...status(), fetched: true };
    } catch (error) {
      const message = `Kernel download failed: ${error.message || error}. Place v2ray in scripts/ manually.`;
      appendLog('error', message);
      return { ...status(), ok: false, error: message, fetched: false };
    }
  }

  return {
    DEFAULT_LISTEN_PORT,
    MAX_LOGS,
    normalizePort,
    locateKernel,
    writeConfig,
    start,
    stop,
    status,
    ping,
    ensureKernel,
    appendLog,
    isRunning,
    buildConfig,
  };
}

module.exports = {
  DEFAULT_LISTEN_PORT,
  MAX_LOGS,
  normalizePort,
  resolveAppDir,
  createRunner,
  buildConfig,
  looksLikeKernelBinary,
};
