'use strict';

const { spawnSync } = require('child_process');
const { createRunner, resolveAppDir } = require('./kernel-runner');

const runner = createRunner(resolveAppDir());
const located = runner.locateKernel();
const args = process.argv.slice(2);

if (!located.ok) {
  process.stderr.write(`${located.error}\n`);
  process.stdout.write(`${JSON.stringify({ ok: false, error: located.error })}\n`);
  process.exit(1);
}

if (args.length === 0) {
  process.stdout.write(`${JSON.stringify({ ok: true, path: located.path, source: located.source, kernel: located.kernel })}\n`);
  process.exit(0);
}

const result = spawnSync(located.path, args, {
  cwd: resolveAppDir(),
  encoding: 'utf8',
  windowsHide: true,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status == null ? 1 : result.status);
