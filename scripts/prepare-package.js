#!/usr/bin/env node
/**
 * Prepares the workspace packages for electron-builder packaging by replacing
 * the @mj-forge/* workspace symlinks with real copies (asar can't follow
 * symlinks).
 *
 * NOTE: this leaves node_modules in a "packaged" state. Prefer `npm run package`
 * (which runs scripts/package.js and restores the symlinks afterward). If you run
 * this directly, restore with `node scripts/restore-package.js` when you're done,
 * or a later `npm run build` / e2e run will load a stale copy.
 */

const { swapToCopies } = require('./workspace-links');

console.log('Preparing workspace packages for packaging...');
swapToCopies();
console.log('Workspace packages prepared successfully!');
