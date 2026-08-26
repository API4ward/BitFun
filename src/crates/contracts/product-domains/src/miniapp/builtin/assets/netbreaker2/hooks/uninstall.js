'use strict';

const { createRunner, resolveAppDir } = require('../scripts/kernel-runner');

const result = createRunner(resolveAppDir()).stop();
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(0);
