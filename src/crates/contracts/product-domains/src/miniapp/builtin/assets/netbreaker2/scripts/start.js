'use strict';

const { createRunner, resolveAppDir, normalizePort } = require('./kernel-runner');

function readFlag(argv, name) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === `--${name}` && argv[i + 1]) return argv[i + 1];
    if (arg.startsWith(`--${name}=`)) return arg.slice(`--${name}=`.length);
  }
  return '';
}

const argv = process.argv.slice(2);
const elevate = !argv.includes('--no-elevate');
const result = createRunner(resolveAppDir()).start({
  port: normalizePort(readFlag(argv, 'port') || argv[0]),
  elevate,
  stack: readFlag(argv, 'stack') || 'system',
});
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
