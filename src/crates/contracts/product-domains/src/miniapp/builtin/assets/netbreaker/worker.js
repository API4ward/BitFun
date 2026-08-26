// NetBreaker worker — start/stop/ping the local v2ray kernel and emit logs.
'use strict';

const path = require('path');
const { createRunner, resolveAppDir, normalizePort } = require('../scripts/kernel-runner');

function emit(event, data) {
  if (typeof global.rpcEmit === 'function') {
    global.rpcEmit(event, data);
  }
}

function runner() {
  return createRunner(resolveAppDir(), {
    onLog: (entry) => emit('log', entry),
  });
}

function snapshotFrom(result) {
  return result && typeof result === 'object' ? result : runner().status();
}

module.exports = {
  async status() {
    return runner().status();
  },

  async start(params) {
    const port = normalizePort(params && params.port);
    return snapshotFrom(runner().start({ port }));
  },

  async stop() {
    return snapshotFrom(runner().stop());
  },

  async ping(params) {
    const port = normalizePort(params && params.port);
    return snapshotFrom(await runner().ping({ port }));
  },

  async ensureKernel(params) {
    const fetch = Boolean(params && params.fetch);
    return snapshotFrom(await runner().ensureKernel({ fetch }));
  },

  async logs() {
    const status = runner().status();
    return { logs: status.logs || [] };
  },

  // Keep a stable require path for tests and seed identity.
  kernelRunnerPath: path.join(__dirname, '..', 'scripts', 'kernel-runner.js'),
};
