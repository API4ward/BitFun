'use strict';

const { createRunner, resolveAppDir } = require('../scripts/kernel-runner');

const status = createRunner(resolveAppDir()).status();
process.stdout.write(`${JSON.stringify({
  ok: true,
  running: status.running,
  note: 'Connection left running; use Stop connection or the stop named script to terminate v2ray.',
})}\n`);
process.exit(0);
