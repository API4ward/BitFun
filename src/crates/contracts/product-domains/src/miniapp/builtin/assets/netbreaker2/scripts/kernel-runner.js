'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const DEFAULT_LISTEN_PORT = 7890;
const DEFAULT_CONTROLLER_PORT = 9090;
const MAX_LOGS = 10;
const TUN_DEVICE_LINUX = 'nb2tun';
const STATE_REL = path.join('runtime', 'netbreaker2-state.json');
const PID_REL = path.join('runtime', 'clash.pid');
const CONFIG_REL = path.join('runtime', 'config.yaml');
const KERNEL_LOG_REL = path.join('runtime', 'kernel.log');
const ARCHIVE_REL = path.join('runtime', 'mihomo-kernel.bin');
const MIHOMO_LATEST = 'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest';
const INTERNET_PROBE = { host: '1.1.1.1', port: 443 };
const FETCH_TIMEOUT_MS = 45000;
const PING_TIMEOUT_MS = 4000;
const CAP_NET_ADMIN = 12n;

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

function commandExists(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0 && Boolean(String(result.stdout || '').trim());
}

function whichKernelOnPath() {
  const names = process.platform === 'win32'
    ? ['mihomo.exe', 'clash.exe', 'clash-meta.exe', 'mihomo', 'clash']
    : ['mihomo', 'clash-meta', 'clash'];
  for (const name of names) {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(cmd, [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (result.status !== 0) continue;
    const first = String(result.stdout || '').trim().split(/\r?\n/)[0];
    if (first && looksLikeKernelBinary(first)) return first;
  }
  return '';
}

function hasCapNetAdmin() {
  if (process.platform !== 'linux') return false;
  try {
    const status = fs.readFileSync('/proc/self/status', 'utf8');
    const match = status.match(/^CapEff:\s*([0-9a-f]+)/mi);
    if (!match) return false;
    const cap = BigInt(`0x${match[1]}`);
    return (cap & (1n << CAP_NET_ADMIN)) !== 0n;
  } catch {
    return false;
  }
}

function isWindowsAdmin() {
  const result = spawnSync('net', ['session'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 4000,
  });
  return result.status === 0;
}

function defaultIsElevated() {
  if (process.env.BITFUN_NETBREAKER2_ELEVATED === '1') return true;
  if (process.env.BITFUN_NETBREAKER2_ELEVATED === '0') return false;
  if (process.platform === 'win32') return isWindowsAdmin();
  const uid = typeof process.geteuid === 'function' ? process.geteuid() : process.getuid?.();
  return uid === 0 || hasCapNetAdmin();
}

function defaultHasTunDevice() {
  if (process.env.BITFUN_NETBREAKER2_TUN === '0') return false;
  if (process.env.BITFUN_NETBREAKER2_TUN === '1') return true;
  if (process.platform === 'linux') return fs.existsSync('/dev/net/tun');
  return true;
}

function defaultFindHelper() {
  const forced = process.env.BITFUN_NETBREAKER2_HELPER;
  if (forced === 'none') return '';
  if (forced) return forced;
  if (process.platform === 'linux' && commandExists('pkexec')) return 'pkexec';
  if (process.platform === 'darwin' && commandExists('osascript')) return 'osascript';
  if (process.platform === 'win32') return 'uac';
  return '';
}

function defaultTunInterfaceExists(name) {
  if (!name) return false;
  if (process.platform === 'linux') {
    return fs.existsSync(path.join('/sys/class/net', name));
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const result = spawnSync('ifconfig', [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    if (result.status === 0) return true;
  }
  return false;
}

function remoteHostBlocked() {
  const keys = [
    'BITFUN_NETBREAKER2_UNSUPPORTED',
    'BITFUN_PEER_DEVICE_MODE',
    'BITFUN_REMOTE_WORKSPACE',
    'BITFUN_DETACHED_DISPATCH',
    'BITFUN_REMOTE_CONTROL',
    'BITFUN_MINIAPP_REMOTE_HOST',
  ];
  return keys.some((key) => {
    const value = String(process.env[key] || '').toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  });
}

function defaultUnsupportedHost() {
  if (remoteHostBlocked()) {
    return {
      unsupported: true,
      reason: 'NetBreaker2 is LocalOnly. Remote workspace, remote control, peer device, and detached dispatch cannot create a local TUN device. Use a local BitFun host.',
    };
  }
  if (defaultIsElevated()) return { unsupported: false, reason: '' };
  const helper = defaultFindHelper();
  if (!helper) {
    return {
      unsupported: true,
      reason: 'No elevation helper (pkexec on Linux, osascript on macOS, UAC on Windows). TUN requires an explicit administrator prompt.',
    };
  }
  const graphical = Boolean(
    process.env.DISPLAY
    || process.env.WAYLAND_DISPLAY
    || process.platform === 'darwin'
    || process.platform === 'win32',
  );
  if (process.platform === 'linux' && !graphical && (process.env.SSH_CONNECTION || process.env.SSH_CLIENT)) {
    return {
      unsupported: true,
      reason: 'Headless or SSH host cannot show a polkit elevation prompt. TUN is unsupported here.',
    };
  }
  return { unsupported: false, reason: '' };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function yamlScalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  if (/^[\w./:@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function renderYaml(value, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value.map((item) => {
      if (item !== null && typeof item === 'object') {
        const nested = renderYaml(item, indent + 1);
        return `${pad}-\n${nested}`;
      }
      return `${pad}- ${yamlScalar(item)}\n`;
    }).join('');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => {
      if (item !== null && typeof item === 'object') {
        const nested = renderYaml(item, indent + 1);
        if (!nested.trim()) return `${pad}${key}: {}\n`;
        return `${pad}${key}:\n${nested}`;
      }
      return `${pad}${key}: ${yamlScalar(item)}\n`;
    }).join('');
  }
  return `${pad}${yamlScalar(value)}\n`;
}

function defaultTunDevice() {
  if (process.platform === 'linux') return TUN_DEVICE_LINUX;
  if (process.platform === 'win32') return TUN_DEVICE_LINUX;
  return '';
}

function buildConfig(options) {
  const port = normalizePort(options && options.port);
  const controllerPort = normalizePort(options && options.controllerPort, DEFAULT_CONTROLLER_PORT);
  const stack = options && options.stack === 'gvisor' ? 'gvisor' : 'system';
  const tunDevice = options && typeof options.tunDevice === 'string'
    ? options.tunDevice
    : defaultTunDevice();
  const secret = options && options.secret ? String(options.secret) : '';
  const tun = {
    enable: true,
    stack,
    'auto-route': true,
    'auto-detect-interface': true,
    'strict-route': false,
    'dns-hijack': ['any:53'],
  };
  if (tunDevice) tun.device = tunDevice;
  return {
    'mixed-port': port,
    'allow-lan': false,
    'bind-address': '127.0.0.1',
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    'external-controller': `127.0.0.1:${controllerPort}`,
    secret,
    tun,
    dns: {
      enable: true,
      listen: '127.0.0.1:1053',
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '198.18.0.1/16',
      nameserver: ['1.1.1.1', '8.8.8.8'],
    },
    proxies: [],
    'proxy-groups': [],
    rules: ['MATCH,DIRECT'],
  };
}

function renderConfig(config) {
  return `# Generated by NetBreaker2. Local TUN client, DIRECT outbound only.\n${renderYaml(config, 0)}`;
}

function planElevationLaunch(input) {
  const platform = input.platform || process.platform;
  const helper = input.helper || '';
  if (!helper) {
    return {
      ok: false,
      error: 'Elevation helper unavailable. Install pkexec (Linux), use a macOS admin session, or allow UAC on Windows. Elevation is never silent.',
    };
  }
  const args = [
    input.wrapperPath,
    input.kernelPath,
    input.configPath,
    input.workDir,
    input.pidPath,
    input.logPath,
  ];
  if (helper === 'pkexec' || (platform === 'linux' && helper === 'pkexec')) {
    return {
      ok: true,
      helper: 'pkexec',
      prompt: true,
      command: 'pkexec',
      argv: ['--disable-internal-agent', ...args],
    };
  }
  if (helper === 'osascript' || platform === 'darwin') {
    const quoted = args.map(shellQuote).join(' ');
    return {
      ok: true,
      helper: 'osascript',
      prompt: true,
      command: 'osascript',
      argv: ['-e', `do shell script ${shellQuote(quoted)} with administrator privileges`],
    };
  }
  if (helper === 'uac' || platform === 'win32') {
    const psArgs = args.map(powershellQuote).join(',');
    return {
      ok: true,
      helper: 'uac',
      prompt: true,
      command: 'powershell',
      argv: [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process -FilePath ${powershellQuote(input.wrapperPath)} -ArgumentList @(${psArgs}) -Verb RunAs -WindowStyle Hidden`,
      ],
    };
  }
  return {
    ok: false,
    error: `Unsupported elevation helper ${helper} on ${platform}. TUN cannot start.`,
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
      headers: { 'User-Agent': 'BitFun-NetBreaker2', Accept: 'application/json' },
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
      headers: { 'User-Agent': 'BitFun-NetBreaker2' },
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

function releaseOsArch() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'linux' && arch === 'x64') return { os: 'linux', arch: 'amd64' };
  if (platform === 'linux' && arch === 'arm64') return { os: 'linux', arch: 'arm64' };
  if (platform === 'darwin' && arch === 'x64') return { os: 'darwin', arch: 'amd64' };
  if (platform === 'darwin' && arch === 'arm64') return { os: 'darwin', arch: 'arm64' };
  if (platform === 'win32' && arch === 'x64') return { os: 'windows', arch: 'amd64' };
  if (platform === 'win32' && arch === 'arm64') return { os: 'windows', arch: 'arm64' };
  return { os: '', arch: '' };
}

function pickReleaseAsset(assets) {
  const mapped = releaseOsArch();
  if (!mapped.os) return null;
  const ext = mapped.os === 'windows' ? '.zip' : '.gz';
  const prefix = `mihomo-${mapped.os}-${mapped.arch}`;
  const list = (Array.isArray(assets) ? assets : []).filter((item) => (
    item && typeof item.name === 'string'
    && item.browser_download_url
    && item.name.startsWith(prefix)
    && item.name.endsWith(ext)
    && !item.name.includes('-go')
  ));
  const score = (name) => {
    if (new RegExp(`^${prefix}-v\\d`).test(name)) return 0;
    if (name.includes('-compatible-')) return 1;
    if (/-v1-v/.test(name)) return 2;
    if (/-v2-v/.test(name)) return 3;
    if (/-v3-v/.test(name)) return 4;
    return 5;
  };
  list.sort((a, b) => score(a.name) - score(b.name) || a.name.length - b.name.length);
  return list[0] || null;
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archivePath.endsWith('.gz') && !archivePath.endsWith('.tar.gz')) {
    const dest = path.join(destDir, process.platform === 'win32' ? 'mihomo.exe' : 'mihomo');
    fs.writeFileSync(dest, zlib.gunzipSync(fs.readFileSync(archivePath)));
    return true;
  }
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${destDir}"`],
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
  const wanted = process.platform === 'win32'
    ? ['mihomo.exe', 'clash.exe', 'clash-meta.exe']
    : ['mihomo', 'clash-meta', 'clash'];
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
      else if (wanted.includes(entry.name) && looksLikeKernelBinary(full)) return full;
    }
  }
  return '';
}

function kernelDisplayName(filePath) {
  const base = path.basename(filePath || '').toLowerCase();
  if (base.startsWith('mihomo')) return 'mihomo';
  if (base.includes('clash')) return 'clash';
  return base || 'unknown';
}

function createRunner(appDir, options) {
  const root = path.resolve(appDir);
  const statePath = path.join(root, STATE_REL);
  const pidPath = path.join(root, PID_REL);
  const configPath = path.join(root, CONFIG_REL);
  const kernelLogPath = path.join(root, KERNEL_LOG_REL);
  const workDir = path.join(root, 'runtime');
  const wrapperSh = path.join(root, 'scripts', 'elevate-launch.sh');
  const wrapperCmd = path.join(root, 'scripts', 'elevate-launch.cmd');
  const onLog = options && typeof options.onLog === 'function' ? options.onLog : null;
  const probes = Object.assign({
    isElevated: defaultIsElevated,
    hasTunDevice: defaultHasTunDevice,
    findHelper: defaultFindHelper,
    unsupportedHost: defaultUnsupportedHost,
    tunInterfaceExists: defaultTunInterfaceExists,
  }, options && options.probes);

  function loadState() {
    const state = readJson(statePath, {});
    return {
      port: normalizePort(state.port),
      controllerPort: normalizePort(state.controllerPort, DEFAULT_CONTROLLER_PORT),
      running: false,
      pid: Number.isInteger(state.pid) ? state.pid : null,
      logs: Array.isArray(state.logs) ? state.logs.slice(-MAX_LOGS) : [],
      kernelPath: typeof state.kernelPath === 'string' ? state.kernelPath : '',
      tunName: typeof state.tunName === 'string' ? state.tunName : defaultTunDevice(),
      stack: state.stack === 'gvisor' ? 'gvisor' : 'system',
      elevated: Boolean(state.elevated),
      elevating: Boolean(state.elevating),
      secret: typeof state.secret === 'string' ? state.secret : '',
      uiState: typeof state.uiState === 'string' ? state.uiState : '',
    };
  }

  function saveState(state) {
    writeJson(statePath, {
      port: state.port,
      controllerPort: state.controllerPort,
      pid: state.pid,
      logs: state.logs.slice(-MAX_LOGS),
      kernelPath: state.kernelPath || '',
      tunName: state.tunName || '',
      stack: state.stack || 'system',
      elevated: Boolean(state.elevated),
      elevating: Boolean(state.elevating),
      secret: state.secret || '',
      uiState: state.uiState || '',
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
      ? ['mihomo.exe', 'clash.exe', 'clash-meta.exe', 'mihomo', 'clash']
      : ['mihomo', 'clash-meta', 'clash', 'mihomo.exe', 'clash.exe'];
    const dirs = [path.join(root, 'scripts'), path.join(root, 'bin')];
    for (const dir of dirs) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (looksLikeKernelBinary(candidate)) {
          return { ok: true, path: candidate, source: 'app', kernel: kernelDisplayName(candidate) };
        }
      }
    }
    const fromPath = whichKernelOnPath();
    if (fromPath) {
      return { ok: true, path: fromPath, source: 'path', kernel: kernelDisplayName(fromPath) };
    }
    return {
      ok: false,
      error: 'Clash/mihomo kernel not found. Place mihomo, clash, or clash-meta in this app scripts/ directory, or run ensure-kernel.',
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
    return pidAlive(currentPid());
  }

  function privilegeSnapshot() {
    const host = probes.unsupportedHost();
    const elevated = Boolean(probes.isElevated());
    const tunAvailable = Boolean(probes.hasTunDevice());
    const helper = probes.findHelper() || '';
    const needsElevation = !elevated;
    return {
      host,
      elevated,
      tunAvailable,
      helper,
      needsElevation,
    };
  }

  function writeConfig(params) {
    const state = loadState();
    const secret = state.secret || `nb2-${Date.now().toString(36)}`;
    const tunName = defaultTunDevice();
    const config = buildConfig({
      port: normalizePort(params && params.port, state.port),
      controllerPort: state.controllerPort,
      stack: (params && params.stack) || state.stack,
      tunDevice: tunName,
      secret,
    });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, renderConfig(config), 'utf8');
    state.port = config['mixed-port'];
    state.stack = config.tun.stack;
    state.tunName = config.tun.device || tunName || (process.platform === 'darwin' ? 'utun' : '');
    state.secret = secret;
    saveState(state);
    return config;
  }

  function spawnDirect(kernelPath) {
    fs.mkdirSync(path.dirname(kernelLogPath), { recursive: true });
    const logFd = fs.openSync(kernelLogPath, 'a');
    try {
      const child = spawn(kernelPath, ['-d', workDir, '-f', configPath], {
        cwd: root,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
      });
      child.on('error', () => { /* keep worker alive */ });
      if (!child.pid) {
        try { fs.closeSync(logFd); } catch { /* ignore */ }
        return { ok: false, error: 'Clash kernel spawned without a pid' };
      }
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, String(child.pid), 'utf8');
      child.unref();
      try { fs.closeSync(logFd); } catch { /* ignore */ }
      return { ok: true, pid: child.pid };
    } catch (error) {
      try { fs.closeSync(logFd); } catch { /* ignore */ }
      return { ok: false, error: error.message || String(error) };
    }
  }

  function spawnElevated(kernelPath, helper) {
    const wrapperPath = process.platform === 'win32' ? wrapperCmd : wrapperSh;
    if (!fs.existsSync(wrapperPath)) {
      return { ok: false, error: `Elevation wrapper missing at ${wrapperPath}` };
    }
    const plan = planElevationLaunch({
      platform: process.platform,
      helper,
      wrapperPath,
      kernelPath,
      configPath,
      workDir,
      pidPath,
      logPath: kernelLogPath,
    });
    if (!plan.ok) return plan;
    try {
      if (process.platform !== 'win32') {
        try { fs.chmodSync(wrapperPath, 0o755); } catch { /* ignore */ }
      }
      const child = spawn(plan.command, plan.argv, {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        windowsHide: true,
      });
      child.on('error', () => { /* keep worker alive */ });
      child.unref();
      return { ok: true, elevating: true, helper: plan.helper, prompt: true };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  }

  function status() {
    const state = loadState();
    const located = locateKernel();
    const priv = privilegeSnapshot();
    const pid = currentPid();
    const running = pidAlive(pid);
    if (state.elevating && running) {
      state.elevating = false;
      state.elevated = true;
      state.pid = pid;
      saveState(state);
    } else if (state.elevating && !running) {
      // Still waiting for the OS prompt, or the user denied it.
    }
    const tunName = state.tunName || defaultTunDevice() || (process.platform === 'darwin' ? 'utun' : '');
    const tunReady = running && Boolean(tunName) && probes.tunInterfaceExists(tunName);
    let uiState = 'ok';
    if (priv.host.unsupported) uiState = 'remoteUnsupported';
    else if (!located.ok) uiState = 'kernelMissing';
    else if (!priv.tunAvailable) uiState = 'tunUnavailable';
    else if (state.uiState === 'elevationDenied' && !running) uiState = 'elevationDenied';
    else if (priv.needsElevation && !running) uiState = 'elevationRequired';
    return {
      ok: uiState === 'ok' || running,
      running,
      pid: running ? pid : null,
      port: state.port,
      controllerPort: state.controllerPort,
      logs: state.logs.slice(-MAX_LOGS),
      kernelOk: located.ok,
      kernelPath: located.ok ? located.path : '',
      kernel: located.ok ? located.kernel : '',
      kernelError: located.ok ? '' : located.error,
      tunName,
      tunReady,
      tunEnabled: Boolean(running && tunReady),
      tunAvailable: priv.tunAvailable,
      elevated: running ? Boolean(state.elevated || priv.elevated) : priv.elevated,
      elevating: Boolean(state.elevating) && !running,
      needsElevation: priv.needsElevation,
      elevationHelper: priv.helper,
      privilegeState: uiState,
      uiState,
      localProcessUnsupported: uiState === 'remoteUnsupported',
      remoteUnsupported: uiState === 'remoteUnsupported',
      unsupportedReason: priv.host.reason || '',
    };
  }

  function start(params) {
    const priv = privilegeSnapshot();
    if (priv.host.unsupported) {
      appendLog('error', priv.host.reason);
      return { ...status(), ok: false, error: priv.host.reason, uiState: 'remoteUnsupported', privilegeState: 'remoteUnsupported', localProcessUnsupported: true };
    }
    if (!priv.tunAvailable) {
      const error = process.platform === 'linux'
        ? 'This host has no /dev/net/tun. A virtual NIC cannot be created. Do not treat a SOCKS listen as success.'
        : 'This host cannot create a TUN virtual NIC.';
      appendLog('error', error);
      return { ...status(), ok: false, error, tunAvailable: false, uiState: 'tunUnavailable', privilegeState: 'tunUnavailable' };
    }

    const located = locateKernel();
    if (!located.ok) {
      appendLog('error', located.error);
      return { ...status(), ok: false, error: located.error, uiState: 'kernelMissing', privilegeState: 'kernelMissing' };
    }

    writeConfig(params);
    if (isRunning()) {
      const state = loadState();
      state.kernelPath = located.path;
      saveState(state);
      appendLog('info', `Clash kernel already running (TUN ${state.tunName || 'pending'})`);
      return status();
    }

    if (priv.needsElevation) {
      const elevate = Boolean(params && params.elevate);
      if (!elevate) {
        const error = 'TUN requires elevated rights. Use Elevate or Start TUN to show the OS administrator / polkit prompt. Elevation is never silent and SOCKS-only is not a fallback.';
        appendLog('error', error);
        return { ...status(), ok: false, error, needsElevation: true, uiState: 'elevationRequired', privilegeState: 'elevationRequired' };
      }
      if (!priv.helper) {
        const error = 'Elevation denied or unsupported: no pkexec/osascript/UAC helper on this host. NetBreaker2 will not silently use sudo.';
        const persisted = loadState();
        persisted.uiState = 'elevationDenied';
        saveState(persisted);
        appendLog('error', error);
        return { ...status(), ok: false, error, uiState: 'elevationDenied', privilegeState: 'elevationDenied' };
      }
      const launched = spawnElevated(located.path, priv.helper);
      if (!launched.ok) {
        const persisted = loadState();
        persisted.uiState = 'elevationDenied';
        saveState(persisted);
        appendLog('error', `Elevation failed: ${launched.error}`);
        return { ...status(), ok: false, error: launched.error, uiState: 'elevationDenied', privilegeState: 'elevationDenied' };
      }
      const state = loadState();
      state.kernelPath = located.path;
      state.elevating = true;
      state.elevated = false;
      state.uiState = 'elevationRequired';
      saveState(state);
      appendLog('info', `Waiting for ${launched.helper} administrator prompt. Deny it and TUN will not start.`);
      return status();
    }

    const spawned = spawnDirect(located.path);
    if (!spawned.ok) {
      const message = `Failed to start Clash kernel: ${spawned.error}. A local BitFun host must be able to spawn this process.`;
      appendLog('error', message);
      return { ...status(), ok: false, error: message, localProcessUnsupported: true };
    }
    const state = loadState();
    state.pid = spawned.pid;
    state.kernelPath = located.path;
    state.elevated = true;
    state.elevating = false;
    saveState(state);
    appendLog('ok', `Started ${located.kernel} pid ${spawned.pid} TUN=${state.tunName || 'auto'} mixed-port=${state.port}`);
    return status();
  }

  function stopElevated(pid) {
    const helper = probes.findHelper();
    if (helper === 'pkexec') {
      spawn('pkexec', ['--disable-internal-agent', 'kill', String(pid)], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      return true;
    }
    if (helper === 'osascript') {
      spawn('osascript', ['-e', `do shell script ${shellQuote(`kill ${pid}`)} with administrator privileges`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      return true;
    }
    if (helper === 'uac') {
      spawn('powershell', [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process -FilePath taskkill -ArgumentList @('/PID','${pid}','/F') -Verb RunAs -WindowStyle Hidden`,
      ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      return true;
    }
    return false;
  }

  function stop() {
    const state = loadState();
    state.elevating = false;
    saveState(state);
    const pid = currentPid();
    if (!pid || !pidAlive(pid)) {
      try { fs.rmSync(pidPath, { force: true }); } catch { /* ignore */ }
      appendLog('info', 'No running Clash kernel process');
      return status();
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error && (error.code === 'EPERM' || /not permitted|access/i.test(error.message || ''))) {
        if (!stopElevated(pid)) {
          const message = `Failed to stop elevated pid ${pid}: ${error.message || error}. Deny/stop requires the same OS prompt.`;
          appendLog('error', message);
          return { ...status(), ok: false, error: message };
        }
        appendLog('info', `Requested elevated stop for pid ${pid}`);
        return status();
      }
      appendLog('error', `Failed to stop Clash pid ${pid}: ${error.message || error}`);
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
    appendLog('ok', `Stopped Clash pid ${pid}`);
    return status();
  }

  function controllerProbe(port, timeoutMs) {
    return new Promise((resolve) => {
      const request = http.get({
        host: '127.0.0.1',
        port,
        path: '/version',
        timeout: timeoutMs,
      }, (response) => {
        response.resume();
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 500 });
      });
      request.on('error', (error) => resolve({ ok: false, error: error.message || String(error) }));
      request.on('timeout', () => {
        request.destroy();
        resolve({ ok: false, error: `timeout after ${timeoutMs}ms` });
      });
    });
  }

  async function ping(params) {
    const state = loadState();
    const port = normalizePort(params && params.port, state.port);
    const inbound = await tcpProbe('127.0.0.1', port, PING_TIMEOUT_MS);
    const internet = await tcpProbe(INTERNET_PROBE.host, INTERNET_PROBE.port, PING_TIMEOUT_MS);
    const controller = await controllerProbe(state.controllerPort, PING_TIMEOUT_MS);
    if (inbound.ok) appendLog('ok', `Ping mixed inbound 127.0.0.1:${port} succeeded`);
    else appendLog('error', `Ping mixed inbound 127.0.0.1:${port} failed: ${inbound.error}`);
    if (controller.ok) appendLog('ok', `Clash controller 127.0.0.1:${state.controllerPort} responded`);
    if (internet.ok) appendLog('ok', `Ping ${INTERNET_PROBE.host}:${INTERNET_PROBE.port} succeeded`);
    else appendLog('error', `Ping ${INTERNET_PROBE.host}:${INTERNET_PROBE.port} failed: ${internet.error}`);
    return {
      ...status(),
      inbound,
      internet,
      controller,
      ok: inbound.ok || internet.ok || controller.ok,
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
    const mapped = releaseOsArch();
    if (!mapped.os) {
      const error = `No official MetaCubeX/mihomo asset mapping for ${process.platform}/${process.arch}`;
      appendLog('error', error);
      return { ...status(), ok: false, error, fetched: false };
    }
    try {
      appendLog('info', `Fetching official MetaCubeX/mihomo release for ${mapped.os}-${mapped.arch}`);
      const release = await httpsJson(MIHOMO_LATEST);
      const asset = pickReleaseAsset(release.assets);
      if (!asset) throw new Error(`Release does not include a mihomo ${mapped.os}-${mapped.arch} binary`);
      const archivePath = path.join(root, ARCHIVE_REL);
      await downloadFile(asset.browser_download_url, archivePath);
      const extractDir = path.join(root, 'runtime', 'kernel-extract');
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (!extractArchive(archivePath, extractDir)) {
        const error = `Downloaded ${asset.name} but could not extract it. Unpack mihomo into scripts/ manually.`;
        appendLog('error', error);
        return { ...status(), ok: false, error, fetched: true };
      }
      const extracted = findExtractedKernel(extractDir);
      if (!extracted) throw new Error('Archive extracted but mihomo/clash binary was not found');
      const destName = process.platform === 'win32' ? 'mihomo.exe' : 'mihomo';
      const dest = path.join(root, 'scripts', destName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(extracted, dest);
      if (process.platform !== 'win32') fs.chmodSync(dest, 0o755);
      appendLog('ok', `Installed kernel to ${dest}`);
      return { ...status(), fetched: true };
    } catch (error) {
      const message = `Kernel download failed: ${error.message || error}. Place mihomo in scripts/ manually.`;
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
    elevate() {
      return start({
        port: loadState().port,
        elevate: true,
        stack: loadState().stack,
      });
    },
    appendLog,
    isRunning,
    buildConfig,
    privilegeSnapshot,
  };
}

module.exports = {
  DEFAULT_LISTEN_PORT,
  DEFAULT_CONTROLLER_PORT,
  MAX_LOGS,
  TUN_DEVICE_LINUX,
  normalizePort,
  resolveAppDir,
  createRunner,
  buildConfig,
  renderConfig,
  planElevationLaunch,
  pickReleaseAsset,
  looksLikeKernelBinary,
  defaultTunDevice,
};
