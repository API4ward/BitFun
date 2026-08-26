'use strict';

const { createRunner, resolveAppDir } = require('../scripts/kernel-runner');

const status = createRunner(resolveAppDir()).status();
process.stdout.write(`${JSON.stringify(status)}\n`);
process.exit(0);
