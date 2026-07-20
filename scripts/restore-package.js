#!/usr/bin/env node
/**
 * Restores the @mj-forge/* workspace symlinks after packaging (or after a
 * manual `scripts/prepare-package.js` run). Idempotent — safe to run any time
 * node_modules has a real packaged copy where a workspace symlink belongs.
 */

const { restoreSymlinks } = require('./workspace-links');

console.log('Restoring workspace symlinks...');
restoreSymlinks();
console.log('Workspace symlinks restored.');
