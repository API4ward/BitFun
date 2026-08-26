// NetBreaker — built-in MiniApp UI.
// Start/stop a local v2ray kernel, show the listen port, ping, last 10 logs.

const DEFAULT_PORT = 10808;
const MAX_LOGS = 10;

const I18N = {
  'en-US': {
    title: 'NetBreaker',
    subtitle: 'Local v2ray kernel · SOCKS inbound',
    statusIdle: 'Idle',
    statusRunning: 'Connected',
    statusMissing: 'Kernel missing',
    statusError: 'Error',
    statusBusy: 'Working',
    listenPort: 'Local listen port',
    currentPort: 'Current port',
    start: 'Start connection',
    stop: 'Stop connection',
    ping: 'Ping test',
    fetchKernel: 'Fetch kernel',
    hint: 'Starts a local SOCKS inbound with a direct outbound. This is a local proxy client, not a remote attack tool.',
    logsTitle: 'Logs',
    logsHint: 'Last 10 entries',
    logsEmpty: 'No log entries yet.',
    kernelMissingTitle: 'v2ray kernel missing',
    kernelMissingBody: 'Place a v2ray or v2ray.exe binary in this app scripts/ directory, or use Fetch kernel.',
    remoteTitle: 'Local process required',
    remoteBody: 'NetBreaker must spawn a v2ray process on this BitFun host. Remote or peer surfaces that cannot run a local kernel should use a host that can.',
    workerUnavailable: 'Worker unavailable. NetBreaker needs a local BitFun host with Node or Bun.',
  },
  'zh-CN': {
    title: 'NetBreaker',
    subtitle: '本地 v2ray 内核 · SOCKS 入站',
    statusIdle: '未连接',
    statusRunning: '已连接',
    statusMissing: '缺少内核',
    statusError: '错误',
    statusBusy: '处理中',
    listenPort: '本地监听端口',
    currentPort: '当前端口',
    start: '启动连接',
    stop: '停止连接',
    ping: '连通性测试',
    fetchKernel: '获取内核',
    hint: '启动本地 SOCKS 入站与直连出站。这是本地代理客户端，不是攻击工具。',
    logsTitle: '日志',
    logsHint: '仅保留最近 10 条',
    logsEmpty: '暂无日志。',
    kernelMissingTitle: '未找到 v2ray 内核',
    kernelMissingBody: '请将 v2ray 或 v2ray.exe 放到本应用 scripts/ 目录，或使用“获取内核”。',
    remoteTitle: '需要本机进程',
    remoteBody: 'NetBreaker 必须在当前 BitFun 主机上启动 v2ray。无法运行本地内核的远程/对端环境请改用可以运行的主机。',
    workerUnavailable: 'Worker 不可用。NetBreaker 需要带 Node 或 Bun 的本地 BitFun 主机。',
  },
  'zh-TW': {
    title: 'NetBreaker',
    subtitle: '本機 v2ray 核心 · SOCKS 入站',
    statusIdle: '未連線',
    statusRunning: '已連線',
    statusMissing: '缺少核心',
    statusError: '錯誤',
    statusBusy: '處理中',
    listenPort: '本機監聽埠',
    currentPort: '目前埠',
    start: '啟動連線',
    stop: '停止連線',
    ping: '連通性測試',
    fetchKernel: '取得核心',
    hint: '啟動本機 SOCKS 入站與直連出站。這是本機代理用戶端，不是攻擊工具。',
    logsTitle: '日誌',
    logsHint: '僅保留最近 10 筆',
    logsEmpty: '尚無日誌。',
    kernelMissingTitle: '找不到 v2ray 核心',
    kernelMissingBody: '請將 v2ray 或 v2ray.exe 放到本應用 scripts/ 目錄，或使用「取得核心」。',
    remoteTitle: '需要本機程序',
    remoteBody: 'NetBreaker 必須在目前 BitFun 主機上啟動 v2ray。無法執行本機核心的遠端/對端環境請改用可以執行的主機。',
    workerUnavailable: 'Worker 不可用。NetBreaker 需要帶 Node 或 Bun 的本機 BitFun 主機。',
  },
};

const dom = {
  status: document.getElementById('status-pill'),
  portInput: document.getElementById('port-input'),
  listenPort: document.getElementById('listen-port'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnPing: document.getElementById('btn-ping'),
  btnFetch: document.getElementById('btn-fetch'),
  logs: document.getElementById('logs'),
  kernelBanner: document.getElementById('kernel-banner'),
  kernelBannerText: document.getElementById('kernel-banner-text'),
  remoteBanner: document.getElementById('remote-banner'),
};

const state = {
  logs: [],
  running: false,
  kernelOk: false,
  busy: false,
  workerOk: true,
};

function currentLocale() {
  return (window.app && window.app.locale) || 'en-US';
}

function ui(key) {
  const table = I18N[currentLocale()] || I18N['en-US'];
  return table[key] || I18N['en-US'][key] || key;
}

function applyStaticI18n() {
  document.documentElement.setAttribute('lang', currentLocale());
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const value = ui(node.getAttribute('data-i18n'));
    if (typeof value === 'string') node.textContent = value;
  });
}

function normalizePort(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return DEFAULT_PORT;
  return n;
}

function setListenPort(port) {
  const next = normalizePort(port);
  if (dom.listenPort) dom.listenPort.textContent = String(next);
  if (dom.portInput && document.activeElement !== dom.portInput) {
    dom.portInput.value = String(next);
  }
}

function setStatus(kind, label) {
  if (!dom.status) return;
  dom.status.className = `status status--${kind}`;
  dom.status.textContent = label;
}

function renderStatus() {
  if (!state.workerOk) {
    setStatus('err', ui('statusError'));
    return;
  }
  if (state.busy) {
    setStatus('warn', ui('statusBusy'));
    return;
  }
  if (!state.kernelOk) {
    setStatus('warn', ui('statusMissing'));
    return;
  }
  if (state.running) {
    setStatus('ok', ui('statusRunning'));
    return;
  }
  setStatus('idle', ui('statusIdle'));
}

function renderLogs() {
  if (!dom.logs) return;
  const entries = state.logs.slice(-MAX_LOGS);
  if (entries.length === 0) {
    dom.logs.innerHTML = `<li class="logs__empty">${escapeHtml(ui('logsEmpty'))}</li>`;
    return;
  }
  dom.logs.innerHTML = entries.map((entry) => {
    const level = entry.level === 'error' ? 'lvl-error' : entry.level === 'ok' ? 'lvl-ok' : '';
    const time = entry.ts ? formatTs(entry.ts) : '';
    return `<li class="${level}">${escapeHtml(time)} ${escapeHtml(entry.message || '')}</li>`;
  }).join('');
  dom.logs.scrollTop = dom.logs.scrollHeight;
}

function formatTs(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
  }[c]));
}

function pushLog(entry) {
  if (!entry || typeof entry.message !== 'string') return;
  state.logs.push({
    ts: entry.ts || Date.now(),
    level: entry.level || 'info',
    message: entry.message,
  });
  if (state.logs.length > MAX_LOGS) state.logs = state.logs.slice(-MAX_LOGS);
  renderLogs();
}

function applySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (typeof snapshot.port === 'number') setListenPort(snapshot.port);
  if (typeof snapshot.running === 'boolean') state.running = snapshot.running;
  if (typeof snapshot.kernelOk === 'boolean') state.kernelOk = snapshot.kernelOk;
  if (Array.isArray(snapshot.logs)) {
    state.logs = snapshot.logs.slice(-MAX_LOGS).map((item) => ({
      ts: item.ts || Date.now(),
      level: item.level || 'info',
      message: String(item.message || ''),
    }));
  }
  if (dom.kernelBanner) {
    const missing = snapshot.kernelOk === false;
    dom.kernelBanner.hidden = !missing;
    if (missing && snapshot.kernelError && dom.kernelBannerText) {
      dom.kernelBannerText.textContent = snapshot.kernelError;
    }
  }
  if (dom.remoteBanner && snapshot.localProcessUnsupported) {
    dom.remoteBanner.hidden = false;
  }
  renderLogs();
  renderStatus();
}

async function callWorker(method, params) {
  if (!window.app || typeof window.app.call !== 'function') {
    throw new Error(ui('workerUnavailable'));
  }
  return window.app.call(method, params || {});
}

async function withBusy(fn) {
  state.busy = true;
  renderStatus();
  setButtonsDisabled(true);
  try {
    return await fn();
  } finally {
    state.busy = false;
    setButtonsDisabled(false);
    renderStatus();
  }
}

function setButtonsDisabled(disabled) {
  for (const btn of [dom.btnStart, dom.btnStop, dom.btnPing, dom.btnFetch]) {
    if (btn) btn.disabled = disabled;
  }
}

async function refreshStatus() {
  try {
    const snapshot = await callWorker('status');
    state.workerOk = true;
    applySnapshot(snapshot);
    if (window.app && window.app.storage) {
      window.app.storage.set('netbreaker-port', normalizePort(dom.portInput && dom.portInput.value)).catch(() => {});
    }
  } catch (error) {
    state.workerOk = false;
    if (dom.remoteBanner) dom.remoteBanner.hidden = false;
    pushLog({ level: 'error', message: error.message || ui('workerUnavailable') });
    renderStatus();
  }
}

async function restorePort() {
  let saved = DEFAULT_PORT;
  try {
    const value = await window.app.storage.get('netbreaker-port');
    saved = normalizePort(value);
  } catch (_e) { /* ignore */ }
  setListenPort(saved);
}

function bind() {
  if (dom.btnStart) {
    dom.btnStart.addEventListener('click', () => withBusy(async () => {
      const port = normalizePort(dom.portInput && dom.portInput.value);
      setListenPort(port);
      const result = await callWorker('start', { port });
      applySnapshot(result);
    }));
  }
  if (dom.btnStop) {
    dom.btnStop.addEventListener('click', () => withBusy(async () => {
      const result = await callWorker('stop');
      applySnapshot(result);
    }));
  }
  if (dom.btnPing) {
    dom.btnPing.addEventListener('click', () => withBusy(async () => {
      const port = normalizePort(dom.portInput && dom.portInput.value);
      const result = await callWorker('ping', { port });
      applySnapshot(result);
    }));
  }
  if (dom.btnFetch) {
    dom.btnFetch.addEventListener('click', () => withBusy(async () => {
      const result = await callWorker('ensureKernel', { fetch: true });
      applySnapshot(result);
    }));
  }
  if (dom.portInput) {
    dom.portInput.addEventListener('change', () => {
      const port = normalizePort(dom.portInput.value);
      setListenPort(port);
      if (window.app && window.app.storage) {
        window.app.storage.set('netbreaker-port', port).catch(() => {});
      }
    });
  }
}

async function init() {
  applyStaticI18n();
  await restorePort();
  bind();
  if (window.app && typeof window.app.on === 'function') {
    window.app.on('worker:log', (data) => {
      if (data && data.message) pushLog(data);
    });
  }
  if (window.app && typeof window.app.onLocaleChange === 'function') {
    window.app.onLocaleChange(() => {
      applyStaticI18n();
      renderStatus();
      renderLogs();
    });
  }
  await refreshStatus();
}

init();
