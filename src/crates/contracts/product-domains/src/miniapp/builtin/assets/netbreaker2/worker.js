// NetBreaker2 worker — start/stop/ping a local Clash TUN kernel and emit logs.
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
    const elevate = params && params.elevate !== false;
    const stack = params && params.stack === 'gvisor' ? 'gvisor' : 'system';
    return snapshotFrom(runner().start({ port, elevate, stack }));
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

  async elevate() {
    return snapshotFrom(runner().elevate());
  },

  async logs() {
    const status = runner().status();
    return { logs: status.logs || [] };
  },

  kernelRunnerPath: path.join(__dirname, '..', 'scripts', 'kernel-runner.js'),
};
