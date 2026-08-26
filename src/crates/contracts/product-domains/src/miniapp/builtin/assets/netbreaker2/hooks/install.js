'use strict';

const { createRunner, resolveAppDir } = require('../scripts/kernel-runner');

(async () => {
  const result = await createRunner(resolveAppDir()).ensureKernel({ fetch: false });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
})();
