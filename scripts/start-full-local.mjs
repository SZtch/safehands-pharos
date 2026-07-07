#!/usr/bin/env node
// Start API + x402 + worker together for local smoke testing.
// MCP/Anvita tools are packaged separately and started by the MCP/Skill host;
// use `npm run start:mcp` when you need a stdio MCP process.

import { spawn } from 'node:child_process';

const services = [
  ['api', ['run', 'start:api']],
  ['x402', ['run', 'start:x402']],
  ['worker', ['run', 'start:worker']],
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = services.map(([name, args]) => {
  const child = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.error(`[${name}] exited with code ${code}`);
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
});

function stop() {
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });
