#!/usr/bin/env node
/**
 * Acceptance check for a packaged app.asar.
 *
 * electron-builder decides what goes into the asar by walking the package
 * manager's reported dependency tree. When that walk under-reports — as it did
 * with electron-builder 26.4.0 against pnpm 11, which reported `pg` as having
 * zero dependencies — packaging still exits 0 and the app still signs, but the
 * shipped app crashes on the first `require` of a missing transitive package.
 *
 * So: extract the archive and actually require() each module the main process
 * depends on, from inside the extracted tree. require() executes a module's own
 * transitive requires; require.resolve() does not, and would have passed against
 * the broken build.
 *
 * Any file resolving OUTSIDE the extract directory is a leak: the module only
 * loaded because this machine has it elsewhere, and it would be absent for a user.
 *
 * That covers the MAIN process. `checkRendererBundle` covers the other half — the static bundle
 * `window.ts` loads over `file://` — which nothing checked until Task 24 replaced the renderer.
 *
 * Usage: node scripts/verify-package.js [path/to/app.asar]
 *   defaults to release/mac-arm64/Joinery.app/Contents/Resources/app.asar
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ASAR = path.join(
  ROOT_DIR,
  'release/mac-arm64/Joinery.app/Contents/Resources/app.asar'
);

/** Modules loaded for real — require() runs their transitive requires too. */
const JS_MODULES = [
  'pg',
  'mysql2',
  'mysql2/promise',
  'mssql',
  'dockerode',
  'electron-store',
  'ssh2',
  'uuid',
  '@joinery/shared',
  '@azure/msal-node',
  '@aws-sdk/dsql-signer',
  '@aws-sdk/credential-providers',
  '@aws/aurora-dsql-node-postgres-connector',
];

/** Native modules are built against Electron's ABI, so plain Node can only resolve them. */
const NATIVE_MODULES = ['keytar'];

/**
 * Files that legitimately resolve outside the bundle. Only supports-color:
 * debug/src/node.js requires it inside a try/catch and works without it, and it
 * is absent from npm-built asars too.
 */
const ALLOWED_OUTSIDE = [/[/\\]node_modules[/\\]supports-color[/\\]/];

/**
 * `require('electron')` is satisfied by the Electron runtime, never by a packaged
 * module, so plain Node cannot resolve it. Drop a stub inside the extract so
 * modules that require it (electron-store) load without reaching outside.
 */
function writeElectronStub(extractDir) {
  const stubDir = path.join(extractDir, 'node_modules', 'electron');
  fs.mkdirSync(stubDir, { recursive: true });
  fs.writeFileSync(
    path.join(stubDir, 'package.json'),
    JSON.stringify({ name: 'electron', version: '0.0.0-stub', main: 'index.js' })
  );
  fs.writeFileSync(
    path.join(stubDir, 'index.js'),
    'module.exports = { app: { getPath: () => process.cwd(), getName: () => "Joinery", getVersion: () => "0.0.0" }, ipcMain: { on() {}, handle() {} }, shell: {} };\n'
  );
}

function buildProbeSource(extractDir) {
  return `
    const EXTRACT = ${JSON.stringify(extractDir)};
    const ALLOWED = ${JSON.stringify(ALLOWED_OUTSIDE.map(String))}.map(s => {
      const body = s.slice(1, s.lastIndexOf('/'));
      return new RegExp(body, s.slice(s.lastIndexOf('/') + 1));
    });
    const results = [];
    for (const name of ${JSON.stringify(JS_MODULES)}) {
      try {
        require(name);
        const outside = Object.keys(require.cache)
          .filter(f => !f.startsWith(EXTRACT))
          .filter(f => !ALLOWED.some(re => re.test(f)));
        results.push({ name, ok: true, outside: outside.slice(0, 3), outsideCount: outside.length });
      } catch (err) {
        results.push({ name, ok: false, err: String(err.message).split('\\n')[0] });
      }
      for (const key of Object.keys(require.cache)) delete require.cache[key];
    }
    for (const name of ${JSON.stringify(NATIVE_MODULES)}) {
      try {
        require.resolve(name);
        results.push({ name, ok: true, resolveOnly: true, outsideCount: 0 });
      } catch {
        results.push({ name, ok: false, err: 'unresolvable' });
      }
    }
    console.log(JSON.stringify(results));
  `;
}

/**
 * The sqlglot server is spawned as an external python3 process, so it must live
 * OUTSIDE app.asar. An in-asar copy passes Node's existsSync through Electron's
 * shim but python3 cannot open it, and the failure surfaces as the misleading
 * "Python 3 is required". Checked here because only a packaged build can show it.
 */
function checkExternalResources(asarPath, asarEntries) {
  const resourcesDir = path.dirname(asarPath);
  const serverScript = path.join(resourcesDir, 'resources', 'python', 'sqlglot-server.py');
  let failures = 0;

  if (fs.existsSync(serverScript)) {
    console.log(`  ok    ${'sqlglot-server.py (outside asar)'.padEnd(44)}`);
  } else {
    console.log(`  FAIL  ${'sqlglot-server.py'.padEnd(44)} not found at ${serverScript}`);
    failures++;
  }

  const inAsar = asarEntries.filter(f => f.endsWith('sqlglot-server.py'));
  if (inAsar.length > 0) {
    console.log(
      `  FAIL  ${'sqlglot-server.py'.padEnd(44)} also packed INSIDE the asar: ${inAsar[0]}`
    );
    failures++;
  }

  return failures;
}

/**
 * The renderer itself, which nothing checked until the cutover (Task 24).
 *
 * Everything above probes the MAIN process's dependency tree. The renderer is a directory of static
 * files, so it has no `require` graph to walk — and the consequence was that a packaged app with an
 * empty, absolute-URL'd or worker-less renderer passed `verify:package` cleanly and only failed when
 * a human double-clicked it. Since the cutover replaced that renderer wholesale, "the bundle landed
 * and can load itself over file://" is exactly the claim that needed evidence.
 *
 * Four assertions, each one a way the bundle has actually been able to break:
 *
 *  1. `index.html` is in the asar at the path `window.ts` loads.
 *  2. Every asset it references is RELATIVE. `base: './'` (vite.config.ts) is a non-negotiable of
 *     §3.1: an absolute `/assets/…` resolves against the filesystem root under `file://` and the
 *     window comes up blank.
 *  3. Every asset it references is actually IN the asar.
 *  4. Monaco's web workers are in there too (`asar: true`, electron-builder.yml). They are loaded at
 *     runtime rather than imported, so nothing else in the pipeline would notice their absence.
 */
function checkRendererBundle(asarEntries, extractDir) {
  const INDEX_REL = path.join('packages', 'renderer', 'dist', 'browser', 'index.html');
  const label = name => `  ${name.padEnd(46)}`;
  const indexOnDisk = path.join(extractDir, INDEX_REL);
  let failures = 0;

  if (!fs.existsSync(indexOnDisk)) {
    console.log(`  FAIL${label('renderer index.html')} not in the asar at ${INDEX_REL}`);
    return 1;
  }
  console.log(`  ok  ${label('renderer index.html')}`);

  const html = fs.readFileSync(indexOnDisk, 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
  const local = referenced.filter(url => !/^(https?:)?\/\//.test(url) && !url.startsWith('data:'));

  const absolute = local.filter(url => url.startsWith('/'));
  if (absolute.length > 0) {
    console.log(`  FAIL${label('renderer asset URLs are relative')} absolute: ${absolute[0]}`);
    failures++;
  } else if (local.length === 0) {
    // A parse that found nothing would make the two checks above vacuous.
    console.log(
      `  FAIL${label('renderer asset URLs are relative')} index.html references no assets`
    );
    failures++;
  } else {
    console.log(`  ok  ${label(`renderer asset URLs are relative (${local.length})`)}`);
  }

  const browserDir = path.dirname(indexOnDisk);
  const missing = local.filter(url => !fs.existsSync(path.join(browserDir, url)));
  if (missing.length > 0) {
    console.log(
      `  FAIL${label('renderer assets present')} ${missing.length} missing, e.g. ${missing[0]}`
    );
    failures++;
  } else {
    console.log(`  ok  ${label('renderer assets present')}`);
  }

  const workers = asarEntries.filter(f =>
    /renderer[/\\]dist[/\\]browser[/\\].*worker.*\.js$/i.test(f)
  );
  if (workers.length === 0) {
    console.log(`  FAIL${label('monaco workers inside the asar')} none found`);
    failures++;
  } else {
    console.log(`  ok  ${label(`monaco workers inside the asar (${workers.length})`)}`);
  }

  return failures;
}

function report(results) {
  let failures = 0;
  for (const r of results) {
    if (!r.ok) {
      console.log(`  FAIL  ${r.name.padEnd(44)} ${r.err}`);
      failures++;
    } else if (r.outsideCount > 0) {
      console.log(
        `  LEAK  ${r.name.padEnd(44)} ${r.outsideCount} file(s) outside bundle: ${r.outside[0]}`
      );
      failures++;
    } else {
      console.log(`  ok    ${r.name.padEnd(44)}${r.resolveOnly ? '(resolve-only, native)' : ''}`);
    }
  }
  return failures;
}

const asarPath = path.resolve(process.argv[2] || DEFAULT_ASAR);
if (!fs.existsSync(asarPath)) {
  console.error(`No asar at ${asarPath} — run "pnpm run package:dir" first.`);
  process.exit(1);
}

const asar = require('@electron/asar');
// realpath: on macOS os.tmpdir() is /var/... while resolved module paths report
// /private/var/..., so an unresolved prefix would mark every file as "outside".
const extractDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'joinery-verify-')));

let failures = 1;
try {
  console.log(`Verifying ${path.relative(ROOT_DIR, asarPath)}`);
  const asarEntries = asar.listPackage(asarPath, { isPack: false });
  asar.extractAll(asarPath, extractDir);
  writeElectronStub(extractDir);

  const stdout = execFileSync(process.execPath, ['-e', buildProbeSource(extractDir)], {
    cwd: path.join(extractDir, 'packages', 'main', 'dist'),
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
  failures = report(JSON.parse(stdout.trim().split('\n').pop()));
  failures += checkExternalResources(asarPath, asarEntries);
  failures += checkRendererBundle(asarEntries, extractDir);
} finally {
  fs.rmSync(extractDir, { recursive: true, force: true });
}

console.log(
  failures
    ? `\n${failures} problem(s) — the packaged app is missing dependencies.`
    : '\nAll modules load entirely from within the bundle.'
);
process.exit(failures ? 1 : 0);
