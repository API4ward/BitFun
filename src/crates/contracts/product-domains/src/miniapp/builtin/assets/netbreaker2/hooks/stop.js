'use strict';

const { createRunner, resolveAppDir } = require('../scripts/kernel-runner');

const status = createRunner(resolveAppDir()).status();
process.stdout.write(`${JSON.stringify({
  ok: true,
  running: status.running,
  note: 'TUN left running; use Stop TUN or the stop named script to terminate the Clash kernel.',
})}\n`);
process.exit(0);
