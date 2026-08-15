#!/usr/bin/env node
/**
 * Packaging orchestrator: swap workspace symlinks → real copies, run
 * electron-builder, then ALWAYS restore the symlinks — on success and on
 * failure alike. Restoring in a `finally` is what keeps a failed (or even a
 * successful) package run from leaving a stale @forgedb/* copy behind that a
 * later `pnpm run build` / e2e run would load and crash on.
 *
 * Usage: node scripts/package.js [electron-builder args...]
 *   e.g. node scripts/package.js --mac   |   node scripts/package.js --dir
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { swapToCopies, restoreSymlinks } = require('./workspace-links');

const rootDir = path.join(__dirname, '..');
const builderArgs = process.argv.slice(2);

// Resolve the binary explicitly rather than trusting PATH. Only a package-manager
// run script puts node_modules/.bin on PATH, so the documented direct invocation
// (`node scripts/package.js --dir`) used to die with a bare "command not found"
// AFTER the symlinks had already been swapped for copies.
const builderBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

if (!fs.existsSync(builderBin)) {
  console.error(`electron-builder not found at ${builderBin} — run "pnpm install" first.`);
  process.exit(1);
}

console.log('Packaging: preparing workspace copies, then running electron-builder...');
swapToCopies();

let status = 1;
try {
  const result = spawnSync(builderBin, [...builderArgs, '--config', 'electron-builder.yml'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: rootDir,
  });
  if (result.error) {
    console.error('Failed to launch electron-builder:', result.error.message);
  } else {
    status = result.status ?? 1;
  }
} finally {
  restoreSymlinks();
}

process.exit(status);
