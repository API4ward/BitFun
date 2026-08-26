'use strict';

const { createRunner, resolveAppDir } = require('./kernel-runner');

const result = createRunner(resolveAppDir()).stop();
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
