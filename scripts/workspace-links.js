#!/usr/bin/env node
/**
 * Workspace-symlink management for @mj-forge/* packages.
 *
 * electron-builder's asar cannot follow symlinks, so before packaging we
 * replace the node_modules/@mj-forge/<pkg> workspace symlinks with real copies
 * (`swapToCopies`). After packaging we put the symlinks back (`restoreSymlinks`)
 * so a later `npm run build` / e2e run doesn't load a stale packaged copy — that
 * staleness has previously crashed the built app on startup.
 *
 * Both functions are parameterised on their target dirs so the round-trip can be
 * exercised against a temp directory without touching the real node_modules.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_SCOPE_DIR = path.join(ROOT_DIR, 'node_modules', '@mj-forge');
const DEFAULT_PACKAGES_ROOT = path.join(ROOT_DIR, 'packages');
const WORKSPACE_PACKAGES = ['shared'];

/** lstat that returns null for a missing path and rethrows anything else. */
function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Recursively copy a directory tree (bounded by the filesystem tree). */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** Replace each workspace symlink with a real copy of its dist + package.json. */
function swapToCopies(options = {}) {
  const { scopeDir = DEFAULT_SCOPE_DIR, packagesRoot = DEFAULT_PACKAGES_ROOT, packages = WORKSPACE_PACKAGES } = options;

  for (const pkg of packages) {
    const srcDir = path.join(packagesRoot, pkg);
    const destDir = path.join(scopeDir, pkg);

    const existing = lstatOrNull(destDir);
    if (existing) {
      console.log(`Removing existing ${existing.isSymbolicLink() ? 'symlink' : 'directory'}: ${destDir}`);
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    console.log(`Copying ${pkg} to node_modules/@mj-forge/${pkg}`);
    fs.mkdirSync(destDir, { recursive: true });

    const distSrc = path.join(srcDir, 'dist');
    if (fs.existsSync(distSrc)) {
      copyDir(distSrc, path.join(destDir, 'dist'));
    }
    const pkgJsonSrc = path.join(srcDir, 'package.json');
    if (fs.existsSync(pkgJsonSrc)) {
      fs.copyFileSync(pkgJsonSrc, path.join(destDir, 'package.json'));
    }
  }
}

/** Restore each workspace symlink the way npm would. Idempotent. */
function restoreSymlinks(options = {}) {
  const { scopeDir = DEFAULT_SCOPE_DIR, packagesRoot = DEFAULT_PACKAGES_ROOT, packages = WORKSPACE_PACKAGES } = options;

  for (const pkg of packages) {
    const destDir = path.join(scopeDir, pkg);
    const target = path.join(packagesRoot, pkg);

    const existing = lstatOrNull(destDir);
    if (existing && existing.isSymbolicLink()) {
      console.log(`Symlink already present: ${destDir}`);
      continue;
    }
    if (existing) {
      console.log(`Removing packaged copy: ${destDir}`);
      fs.rmSync(destDir, { recursive: true, force: true });
    }

    fs.mkdirSync(path.dirname(destDir), { recursive: true });
    // Windows junctions need an absolute target and no admin rights; POSIX uses
    // a relative symlink, matching how npm links workspaces (../../packages/<pkg>).
    if (process.platform === 'win32') {
      fs.symlinkSync(target, destDir, 'junction');
    } else {
      fs.symlinkSync(path.relative(path.dirname(destDir), target), destDir, 'dir');
    }
    console.log(`Restored symlink: ${destDir} -> ${target}`);
  }
}

module.exports = { swapToCopies, restoreSymlinks, copyDir, lstatOrNull, WORKSPACE_PACKAGES };
