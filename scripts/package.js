#!/usr/bin/env node
/**
 * Packaging orchestrator: swap workspace symlinks → real copies, run
 * electron-builder, then ALWAYS restore the symlinks — on success and on
 * failure alike. Restoring in a `finally` is what keeps a failed (or even a
 * successful) package run from leaving a stale @mj-forge/* copy behind that a
 * later `npm run build` / e2e run would load and crash on.
 *
 * Usage: node scripts/package.js [electron-builder args...]
 *   e.g. node scripts/package.js --mac   |   node scripts/package.js --dir
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { swapToCopies, restoreSymlinks } = require('./workspace-links');

const rootDir = path.join(__dirname, '..');
const builderArgs = process.argv.slice(2);

console.log('Packaging: preparing workspace copies, then running electron-builder...');
swapToCopies();

let status = 1;
try {
  const result = spawnSync('electron-builder', [...builderArgs, '--config', 'electron-builder.yml'], {
    stdio: 'inherit',
    shell: true,
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
