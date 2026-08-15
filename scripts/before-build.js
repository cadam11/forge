/**
 * electron-builder beforeBuild hook.
 * Removes cpu-features native module before @electron/rebuild runs,
 * since it's incompatible with Electron's V8 and is optional (try/catch in ssh2).
 *
 * IMPORTANT: Do NOT return false here. Returning false tells electron-builder
 * that node_modules are handled externally, causing it to exclude all
 * dependencies from the asar.
 */
const fs = require('fs');
const path = require('path');

module.exports = async function (context) {
  const cpuFeaturesPath = path.join(context.appDir, 'node_modules', 'cpu-features');
  if (fs.existsSync(cpuFeaturesPath)) {
    fs.rmSync(cpuFeaturesPath, { recursive: true, force: true });
    console.log('  • Removed cpu-features (incompatible native module, optional for ssh2)');
  }
  // Return true to let electron-builder proceed with default dependency install + native rebuild
  return true;
};
