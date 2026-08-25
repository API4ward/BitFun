'use strict';

const { createRunner, resolveAppDir } = require('./kernel-runner');

const fetch = process.argv.slice(2).includes('--fetch');

(async () => {
  const result = await createRunner(resolveAppDir()).ensureKernel({ fetch });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.kernelOk ? 0 : 1);
})();
