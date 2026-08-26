'use strict';

const { createRunner, resolveAppDir, normalizePort } = require('./kernel-runner');

function readPort(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) return normalizePort(argv[i + 1]);
    if (arg.startsWith('--port=')) return normalizePort(arg.slice('--port='.length));
  }
  return normalizePort(argv[0]);
}

const result = createRunner(resolveAppDir()).start({ port: readPort(process.argv.slice(2)) });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(result.ok && result.running ? 0 : 1);
