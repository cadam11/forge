#!/usr/bin/env node
// Orchestrator: runs the unit and integration tiers end-to-end, captures their
// JSON output, normalizes the results, and writes a self-contained HTML report
// to tests/reports/.
//
// Usage:
//   node tests/reporter/build-report.mjs            # default: brings harness up, runs every tier, leaves harness running
//   node tests/reporter/build-report.mjs --teardown # tear down harness when done
//   node tests/reporter/build-report.mjs --no-harness  # skip integration tier
//   node tests/reporter/build-report.mjs --no-e2e      # skip every Playwright tier
//   node tests/reporter/build-report.mjs --no-perf     # skip the slow performance tier only
//
// Exit code is 0 only if every executed tier passed.

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderReportHtml } from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const REPORTS_DIR = join(REPO_ROOT, 'tests', 'reports');
const CACHE_DIR = join(REPORTS_DIR, '.cache');

const ARGS = parseArgs(process.argv.slice(2));

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });

  const startedAt = Date.now();
  const git = await getGitContext();

  console.log('▶ Joinery regression run starting');
  console.log(`  git: ${git.branch}@${git.commit}${git.dirty ? ' (dirty)' : ''}`);

  const tiers = [];

  // Tier 1: unit
  const unitResult = await runVitestTier({
    label: 'Unit',
    configFlag: [],
    cacheFile: join(CACHE_DIR, 'unit.json'),
  });
  tiers.push(unitResult);

  // Tier 2: integration (skippable via --no-harness)
  if (ARGS.harness) {
    await ensureHarnessUp();
    const integrationResult = await runVitestTier({
      label: 'Integration',
      configFlag: ['--config', 'vitest.integration.config.ts'],
      cacheFile: join(CACHE_DIR, 'integration.json'),
    });
    tiers.push(integrationResult);
  } else {
    tiers.push({
      label: 'Integration',
      status: 'pending',
      note: 'Skipped via --no-harness (Docker network not started).',
    });
  }

  // Tiers 3-5: the Playwright projects, in ascending order of how long they take.
  //
  // These named the Angular projects (`e2e`, `visual`) until Task 24 deleted them, which made
  // `test:full` a report on two tiers that no longer existed. They are the survivors, and the perf
  // tier — which had never been wired in here at all — joins them.
  const playwrightTiers = [
    { label: 'E2E (Playwright + Electron)', project: 'e2e-react', cacheName: 'e2e.json', slow: false },
    { label: 'Visual regression', project: 'visual-react', cacheName: 'visual.json', slow: false },
    // Slow by construction: a 100k-row grid, a 200-table schema built from scratch, and a
    // 600-chunk stream injected in real time. `--no-perf` is for the runs that cannot pay for it.
    { label: 'Performance', project: 'perf-react', cacheName: 'perf.json', slow: true },
  ];
  for (const tier of playwrightTiers) {
    if (!ARGS.e2e) {
      tiers.push({ label: tier.label, status: 'pending', note: 'Skipped via --no-e2e.' });
      continue;
    }
    if (tier.slow && !ARGS.perf) {
      tiers.push({ label: tier.label, status: 'pending', note: 'Skipped via --no-perf.' });
      continue;
    }
    tiers.push(await runPlaywrightTier(tier));
  }

  const durationMs = Date.now() - startedAt;
  const totals = aggregateTotals(tiers);

  const report = { startedAt, durationMs, git, totals, tiers };
  const html = renderReportHtml(report);
  const reportPath = await writeReport(html, startedAt);

  console.log('');
  console.log(`▶ Result: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${formatMs(durationMs)})`);
  console.log(`▶ Report: ${reportPath}`);
  console.log(`         file://${reportPath}`);

  if (ARGS.teardown) {
    await tearDownHarness();
  }

  process.exit(totals.failed > 0 ? 1 : 0);
}

// ---- args ----

function parseArgs(argv) {
  const args = { harness: true, teardown: false, e2e: true, perf: true };
  for (const a of argv) {
    if (a === '--no-harness') args.harness = false;
    else if (a === '--no-e2e') args.e2e = false;
    else if (a === '--no-perf') args.perf = false;
    else if (a === '--teardown') args.teardown = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tests/reporter/build-report.mjs [--no-harness] [--no-e2e] [--no-perf] [--teardown]');
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

// ---- git ----

async function getGitContext() {
  const branch = (await runCapture('git', ['rev-parse', '--abbrev-ref', 'HEAD'], REPO_ROOT)).stdout.trim();
  const commit = (await runCapture('git', ['rev-parse', '--short', 'HEAD'], REPO_ROOT)).stdout.trim();
  const dirty = (await runCapture('git', ['status', '--porcelain'], REPO_ROOT)).stdout.trim().length > 0;
  return { branch, commit, dirty };
}

// ---- harness ----

async function ensureHarnessUp() {
  console.log('▶ Bringing test harness up (idempotent)…');
  const ensureKey = await run('node', ['tests/scripts/ensure-ssh-key.mjs'], REPO_ROOT);
  if (ensureKey.code !== 0) throw new Error('ensure-ssh-key.mjs failed');

  const up = await run(
    'docker',
    ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait'],
    REPO_ROOT,
  );
  if (up.code !== 0) throw new Error('docker compose up --wait failed');
}

async function tearDownHarness() {
  console.log('▶ Tearing harness down…');
  const down = await run(
    'docker',
    ['compose', '-f', 'tests/docker-compose.test.yml', 'down', '-v'],
    REPO_ROOT,
  );
  if (down.code !== 0) console.error('docker compose down -v failed (continuing)');
}

// ---- vitest tier runner ----

async function runVitestTier({ label, configFlag, cacheFile }) {
  console.log(`▶ Running ${label} tests…`);
  const startedAt = Date.now();
  const args = [
    'vitest', 'run',
    ...configFlag,
    '--reporter=verbose',
    '--reporter=json',
    `--outputFile=${cacheFile}`,
  ];
  const { code } = await run('pnpm', ['exec', ...args], REPO_ROOT);
  const durationMs = Date.now() - startedAt;

  if (!existsSync(cacheFile)) {
    return {
      label,
      status: 'failed',
      durationMs,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      suites: [{
        name: '<no JSON output>',
        durationMs,
        totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
        tests: [{
          fullName: 'vitest produced no JSON output',
          status: 'failed',
          durationMs,
          failureMessages: [`Expected JSON at ${cacheFile} but it was not written. Check stdout above.`],
        }],
      }],
    };
  }

  const json = JSON.parse(await readFile(cacheFile, 'utf8'));
  const tier = normalizeVitestJson(label, json);
  // If vitest itself failed but reported zero failures (e.g. crash), surface as failure.
  if (code !== 0 && tier.totals.failed === 0) {
    tier.status = 'failed';
    tier.totals.failed = 1;
    tier.totals.total += 1;
    tier.suites.unshift({
      name: '<runner exit>',
      durationMs: 0,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      tests: [{
        fullName: 'vitest exited with non-zero status',
        status: 'failed',
        durationMs: 0,
        failureMessages: [`vitest exited with code ${code} despite reporting no test failures.`],
      }],
    });
  }
  return tier;
}

// ---- playwright tier ----

// The tier gate: no built app, no Playwright run. The path survived the cutover unchanged, because
// the React renderer reproduces the Angular artifact contract exactly (`dist/browser`, PLAN.md §3.1).
const RENDERER_INDEX = join(REPO_ROOT, 'packages', 'renderer', 'dist', 'browser', 'index.html');
const MAIN_ENTRY = join(REPO_ROOT, 'packages', 'main', 'dist', 'index.js');

async function runPlaywrightTier({ label, project, cacheName }) {
  if (!existsSync(RENDERER_INDEX) || !existsSync(MAIN_ENTRY)) {
    return {
      label,
      status: 'pending',
      note: 'Skipped — packages/{main,renderer}/dist not built. Run `pnpm run build` first.',
    };
  }
  const cacheFile = join(CACHE_DIR, cacheName);
  console.log(`▶ Running ${label}…`);
  const startedAt = Date.now();
  const { code } = await run(
    'pnpm',
    [
      'exec', 'playwright', 'test',
      `--project=${project}`,
      `--reporter=list,json`,
      `--output=${join(CACHE_DIR, 'playwright-' + project)}`,
    ],
    REPO_ROOT,
    { PLAYWRIGHT_JSON_OUTPUT_FILE: cacheFile },
  );
  const durationMs = Date.now() - startedAt;

  if (!existsSync(cacheFile)) {
    return {
      label,
      status: 'failed',
      durationMs,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      suites: [{
        name: '<no JSON output>',
        durationMs,
        totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
        tests: [{
          fullName: 'playwright produced no JSON output',
          status: 'failed',
          durationMs,
          failureMessages: [`Expected JSON at ${cacheFile} but it was not written.`],
        }],
      }],
    };
  }
  const json = JSON.parse(await readFile(cacheFile, 'utf8'));
  const tier = normalizePlaywrightJson(label, json);
  if (code !== 0 && tier.totals.failed === 0) {
    tier.status = 'failed';
    tier.totals.failed = 1;
    tier.totals.total += 1;
    tier.suites.unshift({
      name: '<runner exit>',
      durationMs: 0,
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      tests: [{
        fullName: 'playwright exited with non-zero status',
        status: 'failed',
        durationMs: 0,
        failureMessages: [`playwright exited with code ${code} despite reporting no test failures.`],
      }],
    });
  }
  return tier;
}

function normalizePlaywrightJson(label, json) {
  // Playwright JSON nests: suites[file].(suites[describe])*.specs[spec].tests[].results[]
  // Walk recursively and collect a flat list of (file, fullTitle, result).
  const flat = [];
  walkSuites(json.suites ?? [], [], flat);
  // Group by file.
  const byFile = new Map();
  for (const item of flat) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  const suites = [];
  let tierDuration = 0;
  for (const [file, items] of byFile) {
    let suiteDuration = 0;
    const tests = items.map((it) => {
      suiteDuration += it.durationMs;
      return {
        fullName: it.fullName,
        status: it.status,
        durationMs: it.durationMs,
        failureMessages: it.failureMessages,
        screenshots: it.screenshots,
      };
    });
    tierDuration += suiteDuration;
    suites.push({
      name: relative(REPO_ROOT, file),
      durationMs: suiteDuration,
      totals: countByStatus(tests),
      tests,
    });
  }
  const totals = {
    passed: json.stats?.expected ?? 0,
    failed: json.stats?.unexpected ?? 0,
    skipped: json.stats?.skipped ?? 0,
    total: 0,
  };
  totals.total = totals.passed + totals.failed + totals.skipped;
  return {
    label,
    status: totals.failed > 0 ? 'failed' : 'ok',
    durationMs: json.stats?.duration ?? tierDuration,
    totals,
    suites,
  };
}

function walkSuites(suites, ancestors, out) {
  for (const s of suites) {
    const trail = s.title ? [...ancestors, s.title] : ancestors;
    for (const spec of s.specs ?? []) {
      const fullName = [...trail, spec.title].filter(Boolean).join(' > ');
      // Each spec.tests[i] is a parameterized variant (we have one each).
      const test = spec.tests?.[0];
      const result = test?.results?.[0];
      const status = normalizePwStatus(result?.status);
      const file = spec.file ?? s.file ?? '';
      out.push({
        file,
        fullName,
        status,
        durationMs: result?.duration ?? 0,
        failureMessages: (result?.errors ?? []).map((e) => e?.message ?? String(e)),
        // For visual specs, embed the relevant PNGs as base64 so the static
        // HTML report stays self-contained (no /snapshots route to fetch from).
        // Playwright JSON file paths are relative to testDir (tests/e2e), so
        // visual specs arrive as "visual/<spec>.spec.ts" — match accordingly.
        screenshots: /^visual\//.test(file)
          ? collectStaticScreenshots(file, spec.title, result)
          : undefined,
      });
    }
    if (s.suites?.length) walkSuites(s.suites, trail, out);
  }
}

const SNAPSHOT_ROOT = join(REPO_ROOT, 'tests', '__snapshots__', 'visual');

function snapshotNameFromTitle(title) {
  return String(title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
}

function fileToDataUrl(absPath) {
  if (!absPath || !existsSync(absPath)) return null;
  try {
    return 'data:image/png;base64,' + readFileSync(absPath).toString('base64');
  } catch (err) {
    console.warn(`[build-report] failed to inline ${absPath}: ${err?.message ?? err}`);
    return null;
  }
}

function collectStaticScreenshots(specFile, title, result) {
  const out = {};
  const specName = specFile.split('/').pop() || 'spec';
  const baselineAbs = join(SNAPSHOT_ROOT, specName, snapshotNameFromTitle(title));
  const baseline = fileToDataUrl(baselineAbs);
  if (baseline) out.baseline = baseline;
  for (const a of result?.attachments ?? []) {
    if (!a?.path || !a?.name) continue;
    if (a.name.endsWith('-actual')) {
      const url = fileToDataUrl(a.path);
      if (url) out.actual = url;
    } else if (a.name.endsWith('-diff')) {
      const url = fileToDataUrl(a.path);
      if (url) out.diff = url;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizePwStatus(s) {
  if (s === 'passed') return 'passed';
  if (s === 'failed' || s === 'timedOut' || s === 'interrupted') return 'failed';
  if (s === 'skipped') return 'skipped';
  return 'failed';
}

// ---- normalizers ----

function normalizeVitestJson(label, json) {
  const suites = (json.testResults ?? []).map((file) => {
    const tests = (file.assertionResults ?? []).map((t) => ({
      fullName: t.fullName,
      status: t.status === 'pending' ? 'skipped' : t.status,
      durationMs: t.duration,
      failureMessages: t.failureMessages ?? [],
    }));
    const totals = countByStatus(tests);
    return {
      name: relative(REPO_ROOT, file.name),
      durationMs: file.endTime - file.startTime,
      totals,
      tests,
    };
  });
  const totals = {
    passed: json.numPassedTests ?? 0,
    failed: json.numFailedTests ?? 0,
    skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
    total: json.numTotalTests ?? 0,
  };
  return {
    label,
    status: totals.failed > 0 ? 'failed' : 'ok',
    durationMs: suites.reduce((acc, s) => acc + (s.durationMs || 0), 0),
    totals,
    suites,
  };
}

function countByStatus(tests) {
  const totals = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  for (const t of tests) {
    if (t.status === 'passed') totals.passed += 1;
    else if (t.status === 'failed') totals.failed += 1;
    else totals.skipped += 1;
  }
  return totals;
}

function aggregateTotals(tiers) {
  const totals = { passed: 0, failed: 0, skipped: 0, total: 0 };
  for (const t of tiers) {
    if (!t.totals) continue;
    totals.passed += t.totals.passed;
    totals.failed += t.totals.failed;
    totals.skipped += t.totals.skipped;
    totals.total += t.totals.total;
  }
  return totals;
}

// ---- write ----

async function writeReport(html, startedAt) {
  await mkdir(REPORTS_DIR, { recursive: true });
  const ts = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const versioned = join(REPORTS_DIR, `report-${ts}.html`);
  const latest = join(REPORTS_DIR, 'latest.html');
  await writeFile(versioned, html, 'utf8');
  await copyFile(versioned, latest);
  return versioned;
}

// ---- shell helpers ----

function run(cmd, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd,
      env: { ...process.env, ...env },
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1 }));
  });
}

function runCapture(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

main().catch((err) => {
  console.error('▶ build-report.mjs crashed:', err);
  process.exit(2);
});
