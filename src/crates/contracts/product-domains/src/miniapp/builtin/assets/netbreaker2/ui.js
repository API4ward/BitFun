// NetBreaker2 — built-in MiniApp UI.
// Start/stop a local Clash TUN, show kernel/TUN/elevation, ping, last 10 logs.

const DEFAULT_PORT = 7890;
const MAX_LOGS = 10;

const I18N = {
  'en-US': {
    title: 'NetBreaker2',
    subtitle: 'Local Clash / mihomo kernel · TUN virtual NIC',
    statusIdle: 'Idle',
    statusRunning: 'TUN connected',
    statusMissing: 'Kernel missing',
    statusError: 'Error',
    statusBusy: 'Working',
    statusElevating: 'Waiting for elevation',
    statusNeedsElevation: 'Needs elevation',
    kernelLabel: 'Kernel',
    listenLabel: 'Listen',
    tunLabel: 'TUN name',
    elevatedLabel: 'Elevated',
    elevatedYes: 'Yes',
    elevatedNo: 'No',
    listenPort: 'Mixed listen port',
    start: 'Start TUN',
    stop: 'Stop TUN',
    ping: 'Ping test',
    fetchKernel: 'Fetch Clash kernel',
    elevate: 'Elevate',
    tunUnavailableTitle: 'TUN unavailable',
    tunUnavailableBody: 'This host cannot create a virtual NIC. On Linux, /dev/net/tun is missing or not usable.',
    elevationDeniedTitle: 'Elevation denied',
    elevationDeniedBody: 'The privilege prompt was cancelled or unsupported. TUN was not started.',
    hint: 'Starts a Clash TUN virtual NIC with a DIRECT outbound. This is a local proxy client, not a remote attack tool.',
    logsTitle: 'Logs',
    logsHint: 'Last 10 entries',
    logsEmpty: 'No log entries yet.',
    kernelMissingTitle: 'Clash kernel missing',
    kernelMissingBody: 'Place mihomo, clash, or clash-meta in this app scripts/ directory, or use Fetch kernel.',
    elevateTitle: 'Administrator prompt required',
    elevateBody: 'Starting TUN shows a pkexec, macOS admin, or Windows UAC prompt. Elevation is never silent. Deny it and the TUN will not start.',
    remoteTitle: 'Local TUN host required',
    remoteBody: 'NetBreaker2 must create a TUN device on this BitFun host. Remote, peer, detached, or headless surfaces that cannot elevate should use a local host.',
    workerUnavailable: 'Worker unavailable. NetBreaker2 needs a local BitFun host with Node or Bun.',
  },
  'zh-CN': {
    title: 'NetBreaker2',
    subtitle: '本地 Clash / mihomo 内核 · TUN 虚拟网卡',
    statusIdle: '未连接',
    statusRunning: 'TUN 已连接',
    statusMissing: '缺少内核',
    statusError: '错误',
    statusBusy: '处理中',
    statusElevating: '等待提权',
    statusNeedsElevation: '需要提权',
    kernelLabel: '内核',
    listenLabel: '监听',
    tunLabel: 'TUN 名称',
    elevatedLabel: '已提权',
    elevatedYes: '是',
    elevatedNo: '否',
    listenPort: '混合监听端口',
    start: '启动 TUN',
    stop: '停止 TUN',
    ping: '连通性测试',
    fetchKernel: '获取 Clash 内核',
    elevate: '提权',
    tunUnavailableTitle: 'TUN 不可用',
    tunUnavailableBody: '此主机无法创建虚拟网卡。在 Linux 上，/dev/net/tun 缺失或不可用。',
    elevationDeniedTitle: '提权被拒绝',
    elevationDeniedBody: '提权提示被取消或不支持。未启动 TUN。',
    hint: '启动 Clash TUN 虚拟网卡与直连出站。这是本地代理客户端，不是攻击工具。',
    logsTitle: '日志',
    logsHint: '仅保留最近 10 条',
    logsEmpty: '暂无日志。',
    kernelMissingTitle: '未找到 Clash 内核',
    kernelMissingBody: '请将 mihomo、clash 或 clash-meta 放到本应用 scripts/ 目录，或使用“获取内核”。',
    elevateTitle: '需要管理员确认',
    elevateBody: '启动 TUN 会弹出 pkexec、macOS 管理员或 Windows UAC 提示。提权不会静默进行。拒绝后 TUN 不会启动。',
    remoteTitle: '需要本机 TUN',
    remoteBody: 'NetBreaker2 必须在当前 BitFun 主机上创建 TUN。无法提权的远程/对端/无头环境请改用本机。',
    workerUnavailable: 'Worker 不可用。NetBreaker2 需要带 Node 或 Bun 的本地 BitFun 主机。',
  },
  'zh-TW': {
    title: 'NetBreaker2',
    subtitle: '本機 Clash / mihomo 核心 · TUN 虛擬網卡',
    statusIdle: '未連線',
    statusRunning: 'TUN 已連線',
    statusMissing: '缺少核心',
    statusError: '錯誤',
    statusBusy: '處理中',
    statusElevating: '等待提權',
    statusNeedsElevation: '需要提權',
    kernelLabel: '核心',
    listenLabel: '監聽',
    tunLabel: 'TUN 名稱',
    elevatedLabel: '已提權',
    elevatedYes: '是',
    elevatedNo: '否',
    listenPort: '混合監聽埠',
    start: '啟動 TUN',
    stop: '停止 TUN',
    ping: '連通性測試',
    fetchKernel: '取得 Clash 核心',
    elevate: '提權',
    tunUnavailableTitle: 'TUN 不可用',
    tunUnavailableBody: '此主機無法建立虛擬網卡。在 Linux 上，/dev/net/tun 缺失或不可用。',
    elevationDeniedTitle: '提權被拒絕',
    elevationDeniedBody: '提權提示被取消或不支援。未啟動 TUN。',
    hint: '啟動 Clash TUN 虛擬網卡與直連出站。這是本機代理用戶端，不是攻擊工具。',
    logsTitle: '日誌',
    logsHint: '僅保留最近 10 筆',
    logsEmpty: '尚無日誌。',
    kernelMissingTitle: '找不到 Clash 核心',
    kernelMissingBody: '請將 mihomo、clash 或 clash-meta 放到本應用 scripts/ 目錄，或使用「取得核心」。',
    elevateTitle: '需要管理員確認',
    elevateBody: '啟動 TUN 會跳出 pkexec、macOS 管理員或 Windows UAC 提示。提權不會靜默進行。拒絕後 TUN 不會啟動。',
    remoteTitle: '需要本機 TUN',
    remoteBody: 'NetBreaker2 必須在目前 BitFun 主機上建立 TUN。無法提權的遠端/對端/無頭環境請改用本機。',
    workerUnavailable: 'Worker 不可用。NetBreaker2 需要帶 Node 或 Bun 的本機 BitFun 主機。',
  },
};

const dom = {
  status: document.getElementById('status-pill'),
  portInput: document.getElementById('port-input'),
  listenPort: document.getElementById('listen-port'),
  kernel: document.getElementById('fact-kernel'),
  tun: document.getElementById('fact-tun'),
  elevated: document.getElementById('fact-elevated'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnPing: document.getElementById('btn-ping'),
  btnElevate: document.getElementById('btn-elevate'),
  btnFetch: document.getElementById('btn-fetch'),
  logs: document.getElementById('logs'),
  kernelBanner: document.getElementById('kernel-banner'),
  kernelBannerText: document.getElementById('kernel-banner-text'),
  elevateBanner: document.getElementById('elevate-banner'),
  tunBanner: document.getElementById('tun-banner'),
  tunBannerText: document.getElementById('tun-banner-text'),
  remoteBanner: document.getElementById('remote-banner'),
  remoteBannerText: document.getElementById('remote-banner-text'),
};

const state = {
  logs: [],
  running: false,
  kernelOk: false,
  busy: false,
  workerOk: true,
  elevating: false,
  needsElevation: false,
  elevated: false,
  localProcessUnsupported: false,
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
  if (!state.workerOk || state.localProcessUnsupported) {
    setStatus('err', ui('statusError'));
    return;
  }
  if (state.busy) {
    setStatus('warn', ui('statusBusy'));
    return;
  }
  if (state.elevating) {
    setStatus('warn', ui('statusElevating'));
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
  if (state.needsElevation) {
    setStatus('warn', ui('statusNeedsElevation'));
    return;
  }
  setStatus('idle', ui('statusIdle'));
}

function renderFacts(snapshot) {
  if (dom.kernel) {
    const label = snapshot && (snapshot.kernel || snapshot.kernelPath);
    dom.kernel.textContent = label ? String(label).split(/[/\\]/).pop() : '—';
  }
  if (dom.tun) {
    const name = snapshot && snapshot.tunName;
    const ready = snapshot && snapshot.tunReady ? ' · up' : '';
    dom.tun.textContent = name ? `${name}${ready}` : '—';
  }
  if (dom.elevated) {
    if (snapshot && snapshot.elevating) dom.elevated.textContent = ui('statusElevating');
    else dom.elevated.textContent = snapshot && snapshot.elevated ? ui('elevatedYes') : ui('elevatedNo');
  }
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
  if (typeof snapshot.elevating === 'boolean') state.elevating = snapshot.elevating;
  if (typeof snapshot.needsElevation === 'boolean') state.needsElevation = snapshot.needsElevation;
  if (typeof snapshot.elevated === 'boolean') state.elevated = snapshot.elevated;
  if (typeof snapshot.localProcessUnsupported === 'boolean') {
    state.localProcessUnsupported = snapshot.localProcessUnsupported;
  }
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
  if (dom.elevateBanner) {
    const denied = snapshot.uiState === 'elevationDenied';
    const needed = snapshot.uiState === 'elevationRequired' || snapshot.needsElevation || snapshot.elevating;
    dom.elevateBanner.hidden = !(denied || needed) || snapshot.localProcessUnsupported;
  }
  if (dom.tunBanner) {
    const unavailable = snapshot.uiState === 'tunUnavailable' || snapshot.tunAvailable === false;
    dom.tunBanner.hidden = !unavailable || snapshot.localProcessUnsupported;
    if (unavailable && snapshot.error && dom.tunBannerText) {
      dom.tunBannerText.textContent = snapshot.error;
    }
  }
  if (dom.remoteBanner) {
    const show = Boolean(snapshot.remoteUnsupported || snapshot.localProcessUnsupported || snapshot.uiState === 'remoteUnsupported');
    dom.remoteBanner.hidden = !show;
    if (show && snapshot.unsupportedReason && dom.remoteBannerText) {
      dom.remoteBannerText.textContent = snapshot.unsupportedReason;
    }
  }
  renderFacts(snapshot);
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
  for (const btn of [dom.btnStart, dom.btnStop, dom.btnPing, dom.btnElevate, dom.btnFetch]) {
    if (btn) btn.disabled = disabled;
  }
}

async function refreshStatus() {
  try {
    const snapshot = await callWorker('status');
    state.workerOk = true;
    applySnapshot(snapshot);
    if (window.app && window.app.storage) {
      window.app.storage.set('netbreaker2-port', normalizePort(dom.portInput && dom.portInput.value)).catch(() => {});
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
    const value = await window.app.storage.get('netbreaker2-port');
    saved = normalizePort(value);
  } catch (_e) { /* ignore */ }
  setListenPort(saved);
}

function bind() {
  if (dom.btnStart) {
    dom.btnStart.addEventListener('click', () => withBusy(async () => {
      const port = normalizePort(dom.portInput && dom.portInput.value);
      setListenPort(port);
      const result = await callWorker('start', { port, elevate: true });
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
  if (dom.btnElevate) {
    dom.btnElevate.addEventListener('click', () => withBusy(async () => {
      const result = await callWorker('elevate');
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
        window.app.storage.set('netbreaker2-port', port).catch(() => {});
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
