#!/usr/bin/env node
// Live dashboard server for the Joinery regression harness.
//
// Brings the Docker harness up, then runs `vitest --watch` for both the unit
// and integration tiers and hosts a live HTML dashboard at http://127.0.0.1:5188.
// Each vitest watcher uses a custom reporter (vitest-live-reporter.mjs) that
// POSTs run-start / module-start / test-result / run-end events to this
// server, which mutates state and pushes Server-Sent Events to the dashboard.
//
// Per-test results stream into the dashboard test-by-test as vitest runs, so
// the UI reflects in-flight progress rather than only the final result.
//
// Lifecycle:
//   - Ctrl+C  → stop the vitest watchers and exit. Docker is left running
//               (use `pnpm run test:harness:down` when you're done).

import http from 'node:http';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, watch as fsWatch } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import Docker from 'dockerode';

import {
  renderReportBody,
  renderInfrastructure,
  STYLES, SCRIPT, FONT_LINKS,
  LIGHTBOX_HTML, LIGHTBOX_SCRIPT,
} from './render-html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const CACHE_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache');
const REPORTER_PATH = join(REPO_ROOT, 'tests', 'reporter', 'vitest-live-reporter.mjs');
const SNAPSHOTS_DIR = join(REPO_ROOT, 'tests', '__snapshots__', 'visual');
const ATTACHMENTS_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache', 'playwright-results');
const PERSISTED_STATE_FILE = join(REPO_ROOT, 'tests', 'reports', '.cache', 'dashboard-state.json');

const PORT = Number(process.env.JOINERY_DASHBOARD_PORT ?? 5188);
// Bind to all interfaces by default so the dashboard is reachable over LAN
// / Tailscale. Override with JOINERY_DASHBOARD_HOST=127.0.0.1 to restrict.
const HOST = process.env.JOINERY_DASHBOARD_HOST ?? '0.0.0.0';
// Reporters running locally always POST through 127.0.0.1 — no point
// going via the external interface.
const REPORTER_URL = `http://127.0.0.1:${PORT}/_event`;

// ---- state ----

const state = {
  startedAt: Date.now(),
  git: { branch: 'unknown', commit: 'unknown', dirty: false },
  tiers: {
    unit: makeTier('Unit', 'Initializing — first run in progress…'),
    integration: makeTier('Integration', 'Initializing — first run in progress…'),
    // E2E + Visual are passive — populated when the user fires the Run
    // button on the tier or runs the matching `pnpm run test:e2e:live` /
    // `test:visual:live` command in another terminal. Neither has a
    // dashboard-managed watcher (too heavy to rerun on every save).
    e2e:    makeTier('E2E (Playwright + Electron)', 'Run via the Run button (or `pnpm run test:e2e:live`).'),
    visual: makeTier('Visual regression',           'Run via the Run button (or `pnpm run test:visual:live`).'),
  },
  // Per-tier opt-out for the file-watch auto-rerun. Only the slow tiers
  // (e2e/visual) get a toggle — unit + integration are sub-second so the
  // overhead of an extra rerun is negligible. STALE badges still appear
  // either way; the flag only gates whether scheduleTierRerun spawns the
  // playwright child after the 30s debounce.
  autorun: { e2e: true, visual: true },
};

function makeTier(label, note) {
  return {
    label,
    status: 'initializing',
    runState: 'idle',
    note,
    suites: new Map(), // Map<file, suite>
    totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    durationMs: 0,
    runStartedAt: 0,
    currentTest: null,
    testsCompleted: 0,
    lastUpdatedAt: 0,
    // True when watched files have changed since the last run completed.
    // Visual indicator that the displayed pass/fail counts are out of date.
    // Cleared on run-start.
    stale: false,
  };
}

function makeSuite(file) {
  return {
    name: relative(REPO_ROOT, file),
    file,
    runState: 'idle',
    tests: new Map(), // Map<fullName, test>
    totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
    durationMs: 0,
  };
}

const sseClients = new Set();

// ---- infrastructure (Docker) ----

const docker = new Docker();
const INFRA_HISTORY = 30; // 30 samples × 2s = 60s sparkline window
const INFRA_POLL_MS = 2000;

const infra = {
  containers: new Map(), // Map<id, ContainerStat>
  lastPolledAt: 0,
  lastError: null,
  // 'up' | 'down' | 'reset' | null. Set when a harness control kicks off,
  // cleared in runHarness on completion (success or failure). The client uses
  // this to keep the matching button in a busy/disabled state for the full
  // duration of the operation rather than the arbitrary 1.5s ack flash.
  activeOp: null,
};
let infraTimer = null;

// ---- E2E + Visual file watchers ----
//
// Vitest tiers (unit + integration) get fast watch reruns built into vitest
// itself. Playwright has no equivalent, and Electron-based E2E is heavy
// enough (3-7s per test, full Electron launch each time) that auto-running
// on every keystroke would be miserable. Compromise: file-watch the spec
// directories and trigger a tier rerun after a long debounce — long enough
// that the user is clearly done editing before the run kicks off.
const E2E_WATCH_PATHS = [
  join(REPO_ROOT, 'tests', 'e2e'),
  join(REPO_ROOT, 'tests', 'helpers'),
];
const PLAYWRIGHT_WATCH_DEBOUNCE_MS = 30_000;
let e2eDebounceTimer = null;
let visualDebounceTimer = null;
const playwrightWatchers = [];

// In-flight one-shot Playwright children, keyed by tier. Tracked so the
// dashboard can SIGTERM them via the Cancel button. Vitest tiers run inside
// long-lived watch processes that don't expose a mid-run abort, so cancel is
// a Playwright-only affordance for now.
//
// Each entry's `files` records what the child is actually running:
//   - 'all'           : a tier-wide rerun (every spec for the project)
//   - string[]        : a one-shot single-suite rerun (relative paths)
//
// This lets the renderer show suite-level Cancel ONLY when the child is
// running exactly that one suite — so cancelling the suite is equivalent
// to cancelling the whole child (no silent collateral damage to siblings).
const playwrightChildren = { e2e: null, visual: null };
const CANCELABLE_TIERS = new Set(['e2e', 'visual']);

// ---- main ----

await main();

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  state.git = await getGit();

  // Rehydrate before any watchers/runs so existing tier state survives
  // restarts. Vitest watchers will overwrite unit/integration on first run;
  // e2e/visual stays valid until the user explicitly reruns.
  rehydrateStateFromDisk();

  await ensureHarnessUp();

  startInfrastructurePolling();
  startPlaywrightWatchers();

  const unitProc = spawnVitest('unit', []);
  const intProc = spawnVitest('integration', ['--config', 'vitest.integration.config.ts']);

  watchChildExit('unit', unitProc);
  watchChildExit('integration', intProc);

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    const localUrl = `http://localhost:${PORT}`;
    const lanUrls = listLanUrls(PORT);
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Joinery live dashboard:  ${localUrl}`);
    for (const u of lanUrls) console.log(`                         ${u}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Vitest is watching both tiers. Edit code, see live updates.');
    console.log('  Ctrl+C to stop watchers (Docker stays up).');
    console.log('');
  });

  const stop = () => {
    console.log('\n▶ Stopping vitest watchers (Docker harness stays up)…');
    persistStateNow(); // flush any pending debounced writes before exit
    if (infraTimer) clearInterval(infraTimer);
    stopPlaywrightWatchers();
    unitProc.kill('SIGTERM');
    intProc.kill('SIGTERM');
    server.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// ---- HTTP routing ----

function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderDashboardHtml());
    return;
  }
  if (req.method === 'GET' && req.url === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...serializeState(), infrastructure: serializeInfrastructure() }));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/body') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(renderReportBody(serializeState()));
    return;
  }
  if (req.method === 'GET' && req.url === '/api/infra') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(serializeInfrastructure()));
    return;
  }
  if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    pushTo(res, 'state', serializeState());
    pushTo(res, 'infra', serializeInfrastructure());
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method === 'POST' && req.url === '/_event') {
    return handleEventPost(req, res);
  }
  if (req.method === 'GET' && req.url.startsWith('/api/result/')) {
    return handleApiResult(req, res);
  }
  if (req.method === 'GET' && req.url.startsWith('/snapshots/')) {
    return serveStaticFile(req, res, SNAPSHOTS_DIR, '/snapshots/');
  }
  if (req.method === 'GET' && req.url.startsWith('/attachments/')) {
    return serveStaticFile(req, res, ATTACHMENTS_DIR, '/attachments/');
  }
  if (req.method === 'POST' && pathOf(req.url) === '/control/run-tier') {
    return handleControlRunTier(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/run-suite') {
    return handleControlRunSuite(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/harness-reset') {
    return handleControlHarnessReset(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/harness-up') {
    return handleControlHarnessUp(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/harness-down') {
    return handleControlHarnessDown(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/run-all') {
    return handleControlRunAll(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/cancel-tier') {
    return handleControlCancelTier(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/cancel-all') {
    return handleControlCancelAll(req, res);
  }
  if (req.method === 'POST' && req.url === '/control/set-autorun') {
    return handleControlSetAutorun(req, res);
  }
  res.writeHead(404);
  res.end('Not found');
}

// ---- control endpoints ----
//
// Trust model: the dashboard binds 0.0.0.0 on purpose so it's reachable over
// LAN / Tailscale, and controls are intentionally available to remote viewers
// — anyone who can see the dashboard can also re-run a suite or reset the
// harness. File-based control inputs are validated to prevent arbitrary path
// or command execution; only known tier keys and spec-file paths are allowed.

const ALLOWED_TIER_KEYS = new Set(['unit', 'integration', 'e2e', 'visual']);
const SPEC_FILE_RE = /\.(?:spec|test)\.ts$/;

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function ack(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function badRequest(res, message) {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: message }));
}

function isAllowedSpecPath(file) {
  if (typeof file !== 'string' || file.length === 0) return false;
  if (file.includes('..')) return false;
  if (!SPEC_FILE_RE.test(file)) return false;
  return /^(?:tests|packages)\//.test(file);
}

async function listSpecsUnder(...subdirs) {
  // Recursively walk one or more directories under REPO_ROOT and return all
  // files whose name matches *.{spec,test}.ts. Excludes node_modules / dist.
  const out = [];
  const stack = subdirs.map((d) => join(REPO_ROOT, d));
  let guard = 5000; // bounded loop — never traverse more than 5000 dirs
  const fs = await import('node:fs/promises');
  while (stack.length && guard-- > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.turbo') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && SPEC_FILE_RE.test(entry.name)) out.push(full);
    }
  }
  if (guard <= 0) console.warn('[control] listSpecsUnder hit traversal cap');
  return out;
}

async function touchFiles(absPaths) {
  const fs = await import('node:fs/promises');
  const now = new Date();
  let touched = 0;
  for (const p of absPaths) {
    try {
      await fs.utimes(p, now, now);
      touched += 1;
    } catch (err) {
      console.warn(`[control] failed to touch ${p}: ${err?.message ?? err}`);
    }
  }
  return touched;
}

function pathOf(url) {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

function searchOf(url) {
  const i = url.indexOf('?');
  return i === -1 ? '' : url.slice(i);
}

async function handleControlRunTier(req, res) {
  const body = await readJsonBody(req);
  if (body === null) return badRequest(res, 'invalid json');
  const tier = body?.tier;
  if (!ALLOWED_TIER_KEYS.has(tier)) return badRequest(res, 'unknown tier');
  // ?wait=true (or just ?wait): hold the response until run-end fires for
  // this tier, then return the summary directly. Caps at 5 minutes — long
  // enough for any plausible run, short enough that a stuck test won't tie
  // up the connection forever.
  const wait = new URLSearchParams(searchOf(req.url)).get('wait') !== null
    && new URLSearchParams(searchOf(req.url)).get('wait') !== 'false';

  triggerTierRun(tier);

  if (!wait) {
    return ack(res, { ok: true, tier, action: 'triggered' });
  }
  try {
    const summary = await waitForTierRunEnd(tier, 300_000);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, tier, ...summary }));
  } catch (err) {
    res.writeHead(504, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, tier, error: err?.message ?? String(err) }));
  }
}

// Single source of truth for "kick off this tier" — used by both the
// non-blocking and ?wait=true paths.
async function triggerTierRun(tier) {
  if (tier === 'e2e') return spawnOneShotPlaywright('e2e');
  if (tier === 'visual') return spawnOneShotPlaywright('visual');
  const dirs = tier === 'unit'
    ? ['packages/main/src', 'packages/shared/src']
    : ['tests/integration'];
  const files = await listSpecsUnder(...dirs);
  await touchFiles(files);
}

async function handleControlRunSuite(req, res) {
  const body = await readJsonBody(req);
  if (body === null) return badRequest(res, 'invalid json');
  const tier = body?.tier;
  const file = body?.file;
  if (!ALLOWED_TIER_KEYS.has(tier)) return badRequest(res, 'unknown tier');
  if (!isAllowedSpecPath(file)) return badRequest(res, 'invalid file path');

  const abs = join(REPO_ROOT, file);

  if (tier === 'e2e' || tier === 'visual') {
    spawnOneShotPlaywright(tier, [abs]);
    return ack(res, { ok: true, tier, action: `one-shot playwright (${tier}) spawned for ${file}` });
  }

  const touched = await touchFiles([abs]);
  if (touched === 0) return badRequest(res, 'file not found');
  return ack(res, { ok: true, tier, touched });
}

async function handleControlSetAutorun(req, res) {
  const body = await readJsonBody(req);
  if (body === null) return badRequest(res, 'invalid json');
  const tier = body?.tier;
  const enabled = !!body?.enabled;
  if (!Object.prototype.hasOwnProperty.call(state.autorun, tier)) {
    return badRequest(res, `tier '${tier}' has no autorun toggle (only ${Object.keys(state.autorun).join(', ')})`);
  }
  state.autorun[tier] = enabled;
  // Cancel any pending debounce when turning OFF — otherwise a file change
  // from before the toggle could still fire a rerun moments later.
  if (!enabled) {
    if (tier === 'e2e' && e2eDebounceTimer)       { clearTimeout(e2eDebounceTimer);    e2eDebounceTimer = null; }
    if (tier === 'visual' && visualDebounceTimer) { clearTimeout(visualDebounceTimer); visualDebounceTimer = null; }
  }
  console.log(`[control] autorun for ${tier} → ${enabled ? 'ON' : 'OFF'}`);
  broadcastNow();
  return ack(res, { ok: true, tier, enabled });
}

async function handleControlCancelAll(_req, res) {
  // Sweeps every cancelable tier child (e2e + visual today). Vitest watch
  // processes are intentionally NOT killed here — their long-running state
  // is the normal mode, not a cancellable run.
  let count = 0;
  for (const tier of CANCELABLE_TIERS) {
    const entry = playwrightChildren[tier];
    if (!entry) continue;
    console.log(`▶ cancel-all: signaling ${tier} (pid ${entry.child.pid})`);
    entry.child.kill('SIGTERM');
    count += 1;
  }
  // SIGKILL fallback for any straggler — same 3s grace as cancel-tier.
  setTimeout(() => {
    for (const tier of CANCELABLE_TIERS) {
      const e = playwrightChildren[tier];
      if (e && !e.child.killed) {
        console.warn(`▶ ${tier} did not exit on SIGTERM; sending SIGKILL`);
        e.child.kill('SIGKILL');
      }
    }
  }, 3000);
  return ack(res, { ok: true, action: 'cancel-all signaled', count });
}

async function handleControlCancelTier(req, res) {
  const body = await readJsonBody(req);
  if (body === null) return badRequest(res, 'invalid json');
  const tier = body?.tier;
  if (!CANCELABLE_TIERS.has(tier)) {
    return badRequest(res, `tier '${tier}' is not cancelable (only ${[...CANCELABLE_TIERS].join(', ')})`);
  }
  const entry = playwrightChildren[tier];
  if (!entry) return ack(res, { ok: true, tier, action: 'no in-flight run' });
  console.log(`▶ cancel requested for ${tier} (pid ${entry.child.pid})`);
  entry.child.kill('SIGTERM');
  // Give Playwright ~3s to clean up; SIGKILL if it's still alive. Cap the wait
  // so the dashboard doesn't hang on a stuck process.
  setTimeout(() => {
    const cur = playwrightChildren[tier];
    if (cur === entry && !entry.child.killed) {
      console.warn(`▶ ${tier} did not exit on SIGTERM; sending SIGKILL`);
      entry.child.kill('SIGKILL');
    }
  }, 3000);
  return ack(res, { ok: true, tier, action: 'cancel signaled' });
}

async function handleControlRunAll(_req, res) {
  // Ack immediately; dispatch all four tier reruns in the background.
  ack(res, { ok: true, action: 'all tiers triggered' });
  console.log('▶ Run All requested via dashboard control');
  // Vitest tiers — touch every spec file so the watchers batch a rerun.
  const unitFiles = await listSpecsUnder('packages/main/src', 'packages/shared/src');
  const intFiles = await listSpecsUnder('tests/integration');
  await touchFiles(unitFiles);
  await touchFiles(intFiles);
  // Playwright tiers — one-shot each (e2e then visual; both are independent).
  spawnOneShotPlaywright('e2e');
  spawnOneShotPlaywright('visual');
}

async function handleControlHarnessReset(_req, res) {
  // Ack-immediately pattern (shared by all three harness controls): the
  // actual docker compose work runs in the background and surfaces via the
  // next infra poll. The dashboard's button busy state lasts ~1.5s; longer
  // operations (e.g., image pulls on first up) still complete asynchronously.
  ack(res, { ok: true, action: 'reset started' });
  console.log('▶ Harness reset requested via dashboard control');
  runHarness('down -v + up', 'reset')(async () => {
    await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'down', '-v']);
    await runOnce('node', ['tests/scripts/ensure-ssh-key.mjs']);
    await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait']);
  });
}

async function handleControlHarnessUp(_req, res) {
  ack(res, { ok: true, action: 'up started' });
  console.log('▶ Harness up requested via dashboard control');
  runHarness('up', 'up')(async () => {
    await runOnce('node', ['tests/scripts/ensure-ssh-key.mjs']);
    await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait']);
  });
}

async function handleControlHarnessDown(_req, res) {
  // No -v: stop containers but keep volumes so a subsequent up restores
  // existing state instantly (no re-pull, no init).
  ack(res, { ok: true, action: 'down started' });
  console.log('▶ Harness down requested via dashboard control');
  runHarness('down', 'down')(async () => {
    await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'down']);
  });
}

// Wrapper that runs a docker compose action and refreshes the infra poll
// when it finishes (success or failure). Shape: `runHarness(label)(asyncFn)`.
// Map of opKind → the harnessState we should observe before declaring the op
// complete. Without this, `docker compose up --wait` can return before the
// daemon has transitioned every container to 'running' (we'd see 'partial'
// for a moment, the Up button would re-enable, then the 2s poll would
// finally catch up). Polling until the observed state matches keeps the
// button busy through that settling window.
const HARNESS_TARGET_STATE = { up: 'up', reset: 'up', down: 'down' };
const HARNESS_SETTLE_TIMEOUT_MS = 30_000;
const HARNESS_SETTLE_INTERVAL_MS = 750;

function runHarness(label, opKind) {
  // opKind: 'up' | 'down' | 'reset' (purely for the dashboard's busy
  // indicator). Always cleared on completion so a stuck error doesn't leave
  // the button frozen.
  return (fn) => {
    if (opKind) {
      infra.activeOp = opKind;
      infra.lastError = null;
      broadcastInfra();
    }
    const finish = () => {
      if (infra.activeOp === opKind) infra.activeOp = null;
      broadcastInfra();
    };
    fn()
      .then(() => waitForHarnessState(opKind))
      .catch((err) => {
        console.error(`[control] harness ${label} failed:`, err);
        infra.lastError = `${label} failed: ${err?.message ?? err}`;
      })
      .finally(finish);
  };
}

async function waitForHarnessState(opKind) {
  // No specific target → just one poll and we're done (legacy callers).
  const target = HARNESS_TARGET_STATE[opKind];
  if (!target) {
    await pollDockerOnce();
    return;
  }
  const deadline = Date.now() + HARNESS_SETTLE_TIMEOUT_MS;
  // Bound the loop with both a deadline AND an explicit max iteration count
  // so a bug in pollDockerOnce can't spin us forever.
  const maxIters = Math.ceil(HARNESS_SETTLE_TIMEOUT_MS / HARNESS_SETTLE_INTERVAL_MS) + 2;
  for (let i = 0; i < maxIters; i += 1) {
    await pollDockerOnce();
    if (currentHarnessState() === target) return;
    if (Date.now() >= deadline) {
      console.warn(`[control] harness ${opKind} did not settle to '${target}' within ${HARNESS_SETTLE_TIMEOUT_MS}ms (last: ${currentHarnessState()})`);
      return;
    }
    await delay(HARNESS_SETTLE_INTERVAL_MS);
  }
}

function currentHarnessState() {
  // Mirrors the calculation in serializeInfrastructure so the settle loop
  // and the wire payload always agree on what 'up'/'down'/'partial' means.
  const containers = Array.from(infra.containers.values());
  const total = containers.length;
  if (total === 0) return 'down';
  const running = containers.filter((c) => c.state === 'running').length;
  if (running === total) return 'up';
  return 'partial';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markTierStale(tier) {
  // Mark the tier so the dashboard shows that the displayed result is from
  // before the recent change. Cleared when the next run actually starts.
  const t = state.tiers[tier];
  if (t && !t.stale) {
    t.stale = true;
    broadcastNow();
  }
}

function scheduleTierRerun(tier) {
  // Always mark stale so the user sees that something changed even when the
  // auto-rerun is opted out — it's the user's signal to hit Run manually.
  markTierStale(tier);
  if (state.autorun[tier] === false) {
    console.log(`[watch] ${tier} change detected, but autorun is OFF — STALE only`);
    return;
  }
  if (tier === 'visual') {
    if (visualDebounceTimer) clearTimeout(visualDebounceTimer);
    visualDebounceTimer = setTimeout(() => {
      console.log('[watch] visual rerun fired (30s debounce)');
      spawnOneShotPlaywright('visual');
    }, PLAYWRIGHT_WATCH_DEBOUNCE_MS);
  } else {
    if (e2eDebounceTimer) clearTimeout(e2eDebounceTimer);
    e2eDebounceTimer = setTimeout(() => {
      console.log('[watch] e2e rerun fired (30s debounce)');
      spawnOneShotPlaywright('e2e');
    }, PLAYWRIGHT_WATCH_DEBOUNCE_MS);
  }
}

function startPlaywrightWatchers() {
  for (const dir of E2E_WATCH_PATHS) {
    let watcher;
    try {
      watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith('.ts')) return;
        // Treat tests/e2e/visual/** changes as visual; everything else under
        // tests/e2e or tests/helpers as e2e. Helpers are shared so a helper
        // change reruns BOTH (since either tier could be affected).
        const isVisualSpec = filename.includes('visual/') && filename.endsWith('.spec.ts');
        const isHelper = dir.endsWith('helpers');
        if (isVisualSpec || isHelper) scheduleTierRerun('visual');
        if (!isVisualSpec || isHelper) scheduleTierRerun('e2e');
      });
      playwrightWatchers.push(watcher);
      console.log(`▶ watching ${dir} for spec / helper changes (rerun on 30s quiet)`);
    } catch (err) {
      console.error(`[watch] failed to watch ${dir}:`, err?.message ?? err);
    }
  }
}

function stopPlaywrightWatchers() {
  for (const w of playwrightWatchers) {
    try { w.close(); } catch { /* swallow */ }
  }
  playwrightWatchers.length = 0;
  if (e2eDebounceTimer) clearTimeout(e2eDebounceTimer);
  if (visualDebounceTimer) clearTimeout(visualDebounceTimer);
}

function spawnOneShotPlaywright(tier, files = []) {
  // Refuse if a run for this tier is already in flight — the dashboard's UI
  // disables the Run button when running, so this is the safety net for
  // out-of-band callers (file-watch debounce, Run All).
  if (playwrightChildren[tier]) {
    console.log(`▶ skipping one-shot playwright (${tier}): already in flight (pid ${playwrightChildren[tier].child.pid})`);
    return;
  }
  const args = ['playwright', 'test', `--project=${tier}`, ...files];
  console.log(`▶ spawning one-shot playwright (${tier}): pnpm exec ${args.join(' ')}`);
  const child = spawn('pnpm', ['exec', ...args], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      JOINERY_LIVE_REPORTER_URL: REPORTER_URL,
      // Default tier is 'e2e' but the live reporter overrides per file path
      // so a visual file in a mixed run still lands in the right tier.
      JOINERY_LIVE_REPORTER_TIER: tier,
    },
  });
  // Track WHAT this child is running so the dashboard can decide whether
  // suite-level Cancel is honest. Files is 'all' for tier-wide reruns;
  // otherwise the relative paths the user asked for.
  playwrightChildren[tier] = {
    child,
    files: files.length === 0 ? 'all' : files.map((f) => relative(REPO_ROOT, f)),
  };
  child.once('exit', (_code, signal) => {
    const entry = playwrightChildren[tier];
    if (entry && entry.child === child) playwrightChildren[tier] = null;
    if (!signal) return; // clean exit — playwright already sent run-end
    console.log(`◾ playwright (${tier}) exited via ${signal}; synthesizing run-end`);
    // SIGTERM/SIGKILL means we cancelled the child (or it crashed) before
    // playwright could fire its onEnd hook — so the run-end event never
    // arrived from the reporter. Without this, the dashboard stays stuck
    // showing tier.runState='running' forever. Mark the tier idle, flip
    // any in-flight 'running' test rows to 'skipped' (honest about what
    // happened), recompute totals from whatever results landed before
    // the cancel, broadcast, and resolve any waiters.
    const t = state.tiers[tier];
    if (!t || t.runState !== 'running') return;
    t.runState = 'idle';
    t.currentTest = null;
    for (const suite of t.suites.values()) {
      suite.runState = 'idle';
      for (const test of suite.tests.values()) {
        if (test.status === 'running') test.status = 'skipped';
      }
      recomputeSuiteTotals(suite);
    }
    recomputeTierTotals(t);
    t.lastUpdatedAt = Date.now();
    // Don't overwrite t.status if results were already computed for this
    // partial run — leave whatever pass/fail state we got.
    broadcastNow();
    writeTierSummary(tier, t);
    resolveTierWaiters(tier, summarizeTier(tier, t));
  });
}

function pushTo(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---- static file serving (snapshots + attachments) ----
//
// Two routes serve PNGs to the dashboard:
//   - /snapshots/<spec>/<arg>.png   ← visual baselines (committed)
//   - /attachments/<rel-path>       ← Playwright failure outputs (gitignored)
//
// Both are sandboxed to their root dir via path.resolve + prefix check, so
// a request like /snapshots/../../etc/passwd resolves to outside the root
// and gets rejected.
async function serveStaticFile(req, res, rootDir, urlPrefix) {
  const { resolve, sep, extname } = await import('node:path');
  const { createReadStream } = await import('node:fs');
  const { stat } = await import('node:fs/promises');
  const subpath = decodeURIComponent(req.url.slice(urlPrefix.length).split('?')[0]);
  const abs = resolve(rootDir, subpath);
  if (!abs.startsWith(rootDir + sep) && abs !== rootDir) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  try {
    const s = await stat(abs);
    if (!s.isFile()) {
      res.writeHead(404);
      return res.end('not a file');
    }
  } catch {
    res.writeHead(404);
    return res.end('not found');
  }
  const ext = extname(abs).toLowerCase();
  const type = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webm' ? 'video/webm'
    : 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-cache',
  });
  createReadStream(abs).pipe(res);
}

// Rewrite absolute on-disk attachment paths into URLs that the dashboard
// can fetch through the /attachments/ route. Baseline paths come through
// already as a relative subpath (spec/<arg>.png) and become /snapshots/...
function rewriteScreenshotPaths(s) {
  if (!s) return undefined;
  const out = {};
  if (s.baseline) out.baseline = '/snapshots/' + s.baseline;
  for (const k of ['actual', 'diff', 'expectedSnapshot']) {
    if (typeof s[k] === 'string' && s[k].startsWith(ATTACHMENTS_DIR)) {
      out[k] = '/attachments/' + s[k].slice(ATTACHMENTS_DIR.length + 1).split('\\').join('/');
    }
  }
  return out;
}

// Throttled broadcast: coalesces bursts of test-result events into one SSE
// message ~every 80ms so the browser doesn't get hammered when 200+ unit
// tests finish in the same second.
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastNow();
  }, 80);
}
function broadcastNow() {
  if (broadcastTimer) {
    clearTimeout(broadcastTimer);
    broadcastTimer = null;
  }
  const snapshot = serializeState();
  for (const res of sseClients) {
    try {
      pushTo(res, 'state', snapshot);
    } catch (err) {
      console.error('SSE broadcast failed for one client:', err);
      sseClients.delete(res);
    }
  }
  schedulePersist();
}

// ---- State persistence (across server restarts) ----
//
// Without this, e2e + visual would reset to "pending" every time the
// dashboard server restarts (since they're passive — no startup auto-run
// like the vitest tiers have). Persists serialized state to disk on every
// broadcast (debounced 500ms) and rehydrates on startup so all four tiers
// look continuous across restarts.

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistStateNow, 500);
}
function persistStateNow() {
  if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
  try {
    writeFileSync(PERSISTED_STATE_FILE, JSON.stringify(serializeState()));
  } catch (err) {
    console.error('[persist] failed to write state:', err?.message ?? err);
  }
}

function rehydrateStateFromDisk() {
  if (!existsSync(PERSISTED_STATE_FILE)) return;
  let saved;
  try {
    saved = JSON.parse(readFileSync(PERSISTED_STATE_FILE, 'utf8'));
  } catch (err) {
    console.warn('[persist] could not parse saved state — starting fresh:', err?.message ?? err);
    return;
  }
  if (!saved || !Array.isArray(saved.tiers)) return;

  // Rehydrate per-tier autorun preferences. Only honor keys we know about
  // (defends against a stale/edited snapshot adding bogus tiers).
  if (saved.autorun && typeof saved.autorun === 'object') {
    for (const k of Object.keys(state.autorun)) {
      if (typeof saved.autorun[k] === 'boolean') state.autorun[k] = saved.autorun[k];
    }
  }

  for (const savedTier of saved.tiers) {
    if (!savedTier?.key || !state.tiers[savedTier.key]) continue;
    const t = state.tiers[savedTier.key];
    // Only rehydrate tiers that actually had results (skip pending stubs).
    if (savedTier.status !== 'ok' && savedTier.status !== 'failed') continue;
    t.status = savedTier.status;
    // Anything that was running when the server died is now stale; mark
    // 'idle' rather than restoring 'running' (which would lie to the UI).
    t.runState = 'idle';
    t.note = undefined;
    t.totals = savedTier.totals ?? t.totals;
    t.durationMs = savedTier.durationMs ?? 0;
    t.testsCompleted = savedTier.testsCompleted ?? 0;
    t.lastUpdatedAt = savedTier.lastUpdatedAt ?? 0;
    // We deliberately DO NOT mark e2e/visual stale on rehydrate. STALE is
    // meant to flag "a file change happened that didn't get re-run yet" — and
    // the file watcher will set it correctly the next time anything actually
    // changes. Marking it stale unconditionally on every restart was just
    // noise: there was no pending debounce timer to back it up, so the badge
    // sat forever with no work happening.
    t.stale = !!savedTier.stale;
    // Reconstruct the suites Map. Live events key suites by absolute file
    // path (event.file), so we must do the same on rehydrate. We use the
    // saved relative name to compute the *current* absolute path — that way
    // moving the repo doesn't leave orphan entries with stale paths. If a
    // saved spec no longer exists, drop the entry rather than carry it.
    t.suites = new Map();
    for (const s of savedTier.suites ?? []) {
      if (!s?.name) continue;
      const absFile = join(REPO_ROOT, s.name);
      if (!existsSync(absFile)) continue;
      const tests = new Map();
      for (const test of s.tests ?? []) tests.set(test.fullName, test);
      t.suites.set(absFile, {
        name: s.name,
        file: absFile,
        runState: 'idle',
        totals: s.totals ?? { passed: 0, failed: 0, skipped: 0, total: 0 },
        durationMs: s.durationMs ?? 0,
        tests,
      });
    }
  }
  console.log('[persist] rehydrated tier state from disk');
}

function broadcastInfra() {
  const snapshot = serializeInfrastructure();
  for (const res of sseClients) {
    try {
      pushTo(res, 'infra', snapshot);
    } catch (err) {
      console.error('SSE infra broadcast failed for one client:', err);
      sseClients.delete(res);
    }
  }
}

// ---- event ingestion (custom Vitest reporter posts here) ----

function handleEventPost(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let event;
    try {
      event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (err) {
      res.writeHead(400);
      res.end('bad json');
      return;
    }
    handleEvent(event);
    res.writeHead(204);
    res.end();
  });
}

function handleEvent(event) {
  const tier = state.tiers[event.tier];
  if (!tier) return;
  const at = event.at ?? Date.now();

  if (event.type === 'run-start') {
    tier.runState = 'running';
    tier.runStartedAt = at;
    tier.currentTest = null;
    tier.testsCompleted = 0;
    tier.note = undefined;
    tier.stale = false;
    // Mark every file in this run as 'running' AND clear its tests Map so
    // results from a prior run (especially deleted/renamed tests) don't
    // hang around forever. New test-result events from this run will
    // repopulate. Without this clear the dashboard would show ghost PASS
    // / FAIL rows for tests that no longer exist in the spec file.
    for (const file of event.files ?? []) {
      const suite = tier.suites.get(file) ?? makeSuite(file);
      suite.runState = 'running';
      suite.tests = new Map();
      suite.totals = { passed: 0, failed: 0, skipped: 0, total: 0 };
      tier.suites.set(file, suite);
    }
    if (tier.status === 'initializing') tier.status = 'ok';
    scheduleBroadcast();
    return;
  }

  if (event.type === 'module-start') {
    const suite = tier.suites.get(event.file) ?? makeSuite(event.file);
    suite.runState = 'running';
    tier.suites.set(event.file, suite);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'module-end') {
    const suite = tier.suites.get(event.file);
    if (suite) {
      suite.runState = 'idle';
      recomputeSuiteTotals(suite);
    }
    recomputeTierTotals(tier);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'test-result') {
    const suite = tier.suites.get(event.file) ?? makeSuite(event.file);
    suite.tests.set(event.fullName, {
      fullName: event.fullName,
      status: normalizeStatus(event.status),
      durationMs: event.durationMs,
      failureMessages: (event.failureMessages ?? []).map(stripAnsi),
      screenshots: event.screenshots,
    });
    tier.suites.set(event.file, suite);
    tier.currentTest = event.fullName;
    tier.testsCompleted += 1;
    tier.lastUpdatedAt = at;
    recomputeSuiteTotals(suite);
    recomputeTierTotals(tier);
    scheduleBroadcast();
    return;
  }

  if (event.type === 'run-end') {
    tier.runState = 'idle';
    tier.currentTest = null;
    for (const suite of tier.suites.values()) {
      suite.runState = 'idle';
      recomputeSuiteTotals(suite);
    }
    recomputeTierTotals(tier);
    tier.status = tier.totals.failed > 0 ? 'failed' : 'ok';
    tier.lastUpdatedAt = at;
    broadcastNow(); // flush coalesced events promptly on completion
    // Write the compact summary file for Claude/CLI consumers, and wake any
    // waiters parked on POST /control/run-tier?wait=true. Both happen here
    // because run-end is the single point where a tier's results stabilize.
    writeTierSummary(event.tier, tier);
    resolveTierWaiters(event.tier, summarizeTier(event.tier, tier));
    return;
  }
}

function normalizeStatus(s) {
  if (s === 'passed' || s === 'failed' || s === 'skipped' || s === 'running') return s;
  if (s === 'pending' || s === 'todo' || s === 'unknown') return 'skipped';
  return 'skipped';
}

// Vitest + Playwright output failure messages with ANSI color codes for
// terminal rendering. Those codes show up as literal "[2m[31m…" garbage in
// the HTML dashboard. Strip them before storing.
const ANSI_PATTERN = /?\[\d+(?:;\d+)*[A-Za-z]/g;
function stripAnsi(s) {
  if (typeof s !== 'string') return s;
  return s.replace(ANSI_PATTERN, '');
}

function recomputeSuiteTotals(suite) {
  const tests = Array.from(suite.tests.values());
  const t = { passed: 0, failed: 0, skipped: 0, total: tests.length };
  let dur = 0;
  for (const x of tests) {
    // Tests with status='running' are in-flight rows the user sees as RUN
    // badges. Don't roll them into passed/failed/skipped — that would
    // misreport the real outcome. They still count toward total so the
    // tier-level "X tests" reflects what's been observed so far.
    if (x.status === 'passed') t.passed += 1;
    else if (x.status === 'failed') t.failed += 1;
    else if (x.status === 'running') { /* in flight — skip */ }
    else t.skipped += 1;
    dur += x.durationMs ?? 0;
  }
  suite.totals = t;
  suite.durationMs = dur;
}

function recomputeTierTotals(tier) {
  const t = { passed: 0, failed: 0, skipped: 0, total: 0 };
  let dur = 0;
  for (const s of tier.suites.values()) {
    t.passed += s.totals.passed;
    t.failed += s.totals.failed;
    t.skipped += s.totals.skipped;
    t.total += s.totals.total;
    dur += s.durationMs;
  }
  tier.totals = t;
  tier.durationMs = dur;
}

// ---- Docker polling ----

const ROLE_ORDER = ['bastion', 'postgres-private', 'postgres', 'mssql', 'mysql'];

function classifyContainer(name) {
  // Map container name → engine kind + display role.
  const stripped = name.replace(/^\//, '').replace(/^joinery-test-/, '');
  if (stripped === 'bastion')           return { engine: 'bastion',          role: 'SSH bastion' };
  if (stripped === 'postgres-private')  return { engine: 'postgres-private', role: 'tunneled pg' };
  if (stripped === 'postgres')          return { engine: 'postgres',         role: 'PostgreSQL 16' };
  if (stripped === 'mssql')             return { engine: 'mssql',            role: 'SQL Server 2022' };
  if (stripped === 'mysql')             return { engine: 'mysql',            role: 'MySQL 8' };
  return { engine: 'other', role: stripped };
}

function computeCpuPct(stats) {
  const cpu = stats?.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const pre = stats?.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const sys = stats?.cpu_stats?.system_cpu_usage ?? 0;
  const preSys = stats?.precpu_stats?.system_cpu_usage ?? 0;
  const cores = stats?.cpu_stats?.online_cpus ?? 1;
  const cpuDelta = cpu - pre;
  const sysDelta = sys - preSys;
  if (cpuDelta > 0 && sysDelta > 0) {
    return (cpuDelta / sysDelta) * cores * 100;
  }
  return 0;
}

async function pollDockerOnce() {
  let list;
  try {
    list = await docker.listContainers({ all: true });
  } catch (err) {
    infra.lastError = `docker daemon unreachable: ${err?.message ?? err}`;
    broadcastInfra();
    return;
  }
  infra.lastError = null;

  const ours = list.filter((info) => (info.Names ?? []).some((n) => n.includes('/joinery-test-')));
  const seen = new Set();

  for (const info of ours) {
    const id = info.Id;
    seen.add(id);
    const name = (info.Names?.[0] ?? '').replace(/^\//, '');
    const { engine, role } = classifyContainer(name);
    const state = info.State; // 'running' | 'exited' | …
    const status = info.Status; // human-readable

    let cpuPct = 0;
    let memBytes = 0;
    let memLimit = 0;

    if (state === 'running') {
      try {
        const stats = await docker.getContainer(id).stats({ stream: false });
        cpuPct = computeCpuPct(stats);
        memBytes = stats?.memory_stats?.usage ?? 0;
        memLimit = stats?.memory_stats?.limit ?? 0;
      } catch {
        // Container could have stopped between list + stats. Leave zeros.
      }
    }

    const prior = infra.containers.get(id);
    const history = prior?.history ?? [];
    history.push(Number.isFinite(cpuPct) ? cpuPct : 0);
    while (history.length > INFRA_HISTORY) history.shift();

    infra.containers.set(id, {
      id,
      name,
      engine,
      role,
      state,
      status,
      cpuPct,
      memBytes,
      memLimit,
      memPct: memLimit > 0 ? (memBytes / memLimit) * 100 : 0,
      history,
    });
  }

  // Drop containers that vanished (compose down, manual rm, etc.)
  for (const id of Array.from(infra.containers.keys())) {
    if (!seen.has(id)) infra.containers.delete(id);
  }

  infra.lastPolledAt = Date.now();
  broadcastInfra();
}

function startInfrastructurePolling() {
  pollDockerOnce().catch((err) => console.error('[infra] poll error:', err));
  infraTimer = setInterval(() => {
    pollDockerOnce().catch((err) => console.error('[infra] poll error:', err));
  }, INFRA_POLL_MS);
}

// Source of truth for "what containers should exist when the harness is up".
// Drives ghost-card rendering when docker is down (or partially down) so the
// dashboard always shows the same 5-card grid — clearer than empty space.
// Names + engine + role mirror tests/docker-compose.test.yml.
const KNOWN_CONTAINERS = [
  { name: 'joinery-test-mssql',            engine: 'mssql',            role: 'SQL Server 2022' },
  { name: 'joinery-test-postgres',         engine: 'postgres',         role: 'PostgreSQL 16' },
  { name: 'joinery-test-mysql',            engine: 'mysql',            role: 'MySQL 8' },
  { name: 'joinery-test-postgres-private', engine: 'postgres-private', role: 'tunneled pg' },
  { name: 'joinery-test-bastion',          engine: 'bastion',          role: 'SSH bastion' },
];

function ghostContainerFor(known) {
  return {
    id: 'ghost:' + known.name,
    name: known.name,
    engine: known.engine,
    role: known.role,
    state: 'down',
    status: 'not running',
    cpuPct: 0,
    memBytes: 0,
    memLimit: 0,
    memPct: 0,
    history: [],
  };
}

function serializeInfrastructure() {
  const realContainers = Array.from(infra.containers.values());
  // Merge: real containers first; for any KNOWN_CONTAINER missing from the
  // docker poll, splice in a ghost. Lets the surgical client-side update
  // path "promote" a ghost in place when its real counterpart appears
  // (data-id matches; only the data-state attribute and inner numbers
  // change, no DOM remount).
  const realByName = new Map(realContainers.map((c) => [c.name, c]));
  const merged = [];
  for (const known of KNOWN_CONTAINERS) {
    merged.push(realByName.get(known.name) ?? ghostContainerFor(known));
  }
  // Anything outside KNOWN_CONTAINERS (shouldn't happen — we filter to
  // joinery-test-* — but defensive against future compose additions) appended
  // verbatim so it still shows up.
  for (const c of realContainers) {
    if (!KNOWN_CONTAINERS.some((k) => k.name === c.name)) merged.push(c);
  }
  const containers = merged.sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.engine);
    const bi = ROLE_ORDER.indexOf(b.engine);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });
  // Derive overall harness state from REAL containers only — ghosts shouldn't
  // count toward "all up" or skew the partial detection. Otherwise the Up
  // button would never enable since ghosts always look 'down'.
  const realTotal = realContainers.length;
  const realRunning = realContainers.filter((c) => c.state === 'running').length;
  let harnessState = 'partial';
  if (realTotal === 0) harnessState = 'down';
  else if (realRunning === realTotal) harnessState = 'up';
  return {
    lastPolledAt: infra.lastPolledAt,
    pollIntervalMs: INFRA_POLL_MS,
    error: infra.lastError,
    harnessState,
    activeOp: infra.activeOp,
    containers,
  };
}

// ---- vitest watch supervision ----

function spawnVitest(tier, extraArgs) {
  // `--watch` forces watch mode. Vitest's default is "watch if stdin is a TTY"
  // but when invoked through `pnpm run` + child_process.spawn the TTY detection
  // is unreliable, so we make it explicit.
  const args = [
    'vitest',
    '--watch',
    ...extraArgs,
    '--reporter=default',
    `--reporter=${REPORTER_PATH}`,
    '--reporter=json',
    `--outputFile=${join(CACHE_DIR, `${tier}.json`)}`,
  ];
  console.log(`▶ spawning vitest watch for ${tier}`);
  const child = spawn('pnpm', ['exec', ...args], {
    stdio: 'inherit',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      JOINERY_LIVE_REPORTER_URL: REPORTER_URL,
      JOINERY_LIVE_REPORTER_TIER: tier,
    },
  });
  return child;
}

function watchChildExit(tier, child) {
  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return; // we asked it to stop
    if (code === null || code === 0) return;
    console.error(`▶ vitest ${tier} exited unexpectedly (code ${code})`);
    const t = state.tiers[tier];
    if (t) {
      t.runState = 'idle';
      t.status = 'failed';
      t.note = `vitest ${tier} crashed (exit code ${code}). Check the terminal output.`;
      broadcastNow();
    }
  });
}

// ---- Compact run summaries (CLI/HTTP/markdown) ----
//
// Three consumers want the same shape:
//   - tests/reports/.cache/{tier}.summary.md  (human + Claude can Read it)
//   - GET /api/result/{tier}                  (HTTP-only callers)
//   - POST /control/run-tier?wait=true        (synchronous run + result)
//
// summarizeTier() produces the JSON form; markdownForSummary() formats it
// for the .md file. Failures only — passing tests are noise for this view.

function summarizeTier(key, tier) {
  const failures = [];
  for (const suite of tier.suites.values()) {
    for (const test of suite.tests.values()) {
      if (test.status !== 'failed') continue;
      failures.push({
        suite: suite.name,
        test: test.fullName,
        durationMs: test.durationMs,
        message: (test.failureMessages ?? []).join('\n\n'),
      });
    }
  }
  return {
    tier: key,
    label: tier.label,
    status: tier.status,
    ranAt: tier.lastUpdatedAt || null,
    durationMs: tier.durationMs || 0,
    totals: { ...tier.totals },
    failures,
  };
}

function markdownForSummary(summary) {
  const lines = [];
  lines.push(`# ${summary.label} — ${summary.status.toUpperCase()}`);
  lines.push('');
  const t = summary.totals;
  const ts = summary.ranAt ? new Date(summary.ranAt).toISOString() : 'n/a';
  const sec = (summary.durationMs / 1000).toFixed(2);
  lines.push(`Ran at ${ts} · ${sec}s`);
  lines.push('');
  lines.push(`**${t.total} tests · ${t.passed} passed · ${t.failed} failed · ${t.skipped} skipped**`);
  lines.push('');
  if (summary.failures.length === 0) {
    lines.push('No failures. ✓');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`## Failures (${summary.failures.length})`);
  lines.push('');
  for (const f of summary.failures) {
    lines.push(`### ${f.suite} — ${f.test}`);
    lines.push('');
    if (f.message) {
      lines.push('```');
      lines.push(f.message);
      lines.push('```');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function writeTierSummary(key, tier) {
  try {
    const summary = summarizeTier(key, tier);
    const md = markdownForSummary(summary);
    writeFileSync(join(CACHE_DIR, `${key}.summary.md`), md);
    writeFileSync(join(CACHE_DIR, `${key}.summary.json`), JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error(`[summary] failed to write ${key} summary:`, err?.message ?? err);
  }
}

function handleApiResult(req, res) {
  const tier = req.url.replace(/^\/api\/result\//, '').replace(/\/$/, '');
  if (!ALLOWED_TIER_KEYS.has(tier)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `unknown tier '${tier}'` }));
    return;
  }
  const t = state.tiers[tier];
  if (!t || (t.status === 'initializing' && t.suites.size === 0)) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, tier, error: 'no run results yet' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...summarizeTier(tier, t) }, null, 2));
}

// ---- Waiters for ?wait=true ----
//
// Multiple ?wait=true requests can be in flight for the same tier (e.g.
// human triggered Run All, plus Claude waiting for e2e). Each parks a
// resolver here; run-end fires them all at once with the same summary.
// Timeout (set per-request) cleans up if the run never completes.
const tierWaiters = { unit: [], integration: [], e2e: [], visual: [] };

function waitForTierRunEnd(tier, timeoutMs) {
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject, timer: null };
    entry.timer = setTimeout(() => {
      const list = tierWaiters[tier];
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
      reject(new Error(`run-end for tier '${tier}' did not arrive within ${timeoutMs}ms`));
    }, timeoutMs);
    tierWaiters[tier].push(entry);
  });
}

function resolveTierWaiters(tier, summary) {
  const list = tierWaiters[tier];
  if (!list || list.length === 0) return;
  const pending = list.splice(0); // claim & clear
  for (const entry of pending) {
    clearTimeout(entry.timer);
    entry.resolve(summary);
  }
}

// ---- serialization ----

function serializeState() {
  const tiers = [];
  for (const key of ['unit', 'integration', 'e2e', 'visual']) {
    const t = state.tiers[key];
    if (t.status === 'initializing' && t.suites.size === 0) {
      tiers.push({
        key, // signals "runnable" to the dashboard so it shows Run buttons even on the pending row
        label: t.label,
        status: 'pending',
        runState: t.runState,
        note: t.note ?? 'Initializing…',
      });
      continue;
    }
    // For PW tiers, expose what the running child is actually running so the
    // renderer can decide if suite-level Cancel is honest. 'all' = tier-wide
    // rerun → only tier-level Cancel makes sense; an array of relative
    // paths = single-suite rerun → suite-level Cancel is meaningful and
    // bounded to those files.
    const pwEntry = playwrightChildren[key];
    const runScope = pwEntry ? pwEntry.files : null;
    tiers.push({
      key,
      label: t.label,
      status: t.status,
      runState: t.runState,
      stale: t.stale,
      durationMs: t.durationMs,
      totals: t.totals,
      currentTest: t.currentTest,
      testsCompleted: t.testsCompleted,
      runScope,
      suites: Array.from(t.suites.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({
          name: s.name,
          runState: s.runState,
          durationMs: s.durationMs,
          totals: s.totals,
          tests: Array.from(s.tests.values()).map((t) => ({
        ...t,
        // Rewrite absolute attachment paths into server-relative URLs the
        // browser can fetch. Baseline comes through as already-relative.
        screenshots: t.screenshots ? rewriteScreenshotPaths(t.screenshots) : undefined,
      })),
        })),
    });
  }
  // (No more pending placeholder rows — visual is now a real tier above.)

  // Aggregate totals across active tiers.
  const totals = { passed: 0, failed: 0, skipped: 0, total: 0 };
  let durationMs = 0;
  for (const t of tiers) {
    if (!t.totals) continue;
    totals.passed += t.totals.passed;
    totals.failed += t.totals.failed;
    totals.skipped += t.totals.skipped;
    totals.total += t.totals.total;
    durationMs += t.durationMs ?? 0;
  }

  // Note: infrastructure is intentionally NOT included in the state payload.
  // It travels on a separate SSE channel (event: infra) so its 2s polls don't
  // trigger a full body refresh that would collapse <details> and reset
  // animations. Direct callers that want both can use /api/state.
  return { startedAt: state.startedAt, durationMs, git: state.git, totals, tiers, autorun: { ...state.autorun } };
}

// ---- dashboard HTML ----

function renderDashboardHtml() {
  const dirtyMark = state.git.dirty ? '<span class="value dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Joinery · Regression Harness</title>
${FONT_LINKS}
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">Joinery</span> Regression Harness</h1>
    <div class="header-meta">
      <span class="label">Repo</span>
      <span class="value">${escapeHtml(state.git.branch)}@${escapeHtml(state.git.commit)} ${dirtyMark}</span>
      <span class="label">Bind</span>
      <span class="value">${escapeHtml(HOST)}:${PORT}</span>
      <span class="label">UTC</span>
      <span class="value" id="now">--:--:--</span>
    </div>
  </header>

  <div class="live-banner">
    <span class="live-dot" id="live-dot"></span>
    <span id="live-status">Connecting…</span>
    <button type="button" class="ctrl-btn ctrl-run ctrl-run-all" data-action="run-all" title="Re-run every tier (unit + integration + e2e + visual)">
      <span class="material-symbols-outlined ctrl-icon">play_arrow</span>
      <span class="ctrl-label">Run All</span>
    </button>
    <button type="button" class="ctrl-btn ctrl-cancel ctrl-cancel-all" data-action="cancel-all" hidden title="Cancel every in-flight Playwright run (e2e + visual)">
      <span class="material-symbols-outlined ctrl-icon">close</span>
      <span class="ctrl-label">Cancel All</span>
    </button>
  </div>

  <div id="infra-host">
    ${renderInfrastructure(serializeInfrastructure())}
  </div>

  <div id="report-body">
    ${renderReportBody(serializeState())}
  </div>

  <footer class="footer">
    Live server · port <span class="mono">${PORT}</span>
  </footer>
</main>

${LIGHTBOX_HTML}

<!-- One global confirm modal. joineryConfirm() rebinds its content + handlers
     each time it's invoked, returning a Promise<boolean>. -->
<div id="joinery-modal" class="modal" hidden role="dialog" aria-modal="true" aria-hidden="true">
  <div class="modal-backdrop"></div>
  <div class="modal-card">
    <h3 class="modal-title">
      <span class="material-symbols-outlined modal-icon">help</span>
      <span class="modal-title-text">Confirm</span>
    </h3>
    <p class="modal-body"></p>
    <div class="modal-actions">
      <button type="button" class="ctrl-modal-cancel">Cancel</button>
      <button type="button" class="ctrl-modal-confirm">Confirm</button>
    </div>
  </div>
</div>
<script>
${SCRIPT}

const reportBody = document.getElementById('report-body');
const infraHost = document.getElementById('infra-host');
const liveDot = document.getElementById('live-dot');
const liveStatus = document.getElementById('live-status');
const nowEl = document.getElementById('now');

function setStatus(text, connected) {
  liveStatus.textContent = text;
  liveDot.classList.toggle('disconnected', !connected);
}

function tickClock() {
  const d = new Date();
  nowEl.textContent = d.toISOString().replace('T', ' ').replace(/\\..+$/, '');
}
tickClock();
setInterval(tickClock, 1000);

// ---- Body refresh with user-intent-aware open/close preservation ----
//
// innerHTML swap nukes the open/closed state of every <details>. Naively
// re-applying the previous open set fights the renderer's auto-behaviour
// (e.g., after a tier's run completes successfully, isOpen=false in the new
// HTML so it should auto-collapse — but preserving the prior open state
// would re-open it). Instead, track the USER'S explicit intent on each
// detail and only override the server-rendered open state when the user
// has actually clicked to toggle.
const userIntent = new Map(); // data-id → 'open' | 'closed'

reportBody.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  if (!summary) return;
  const details = summary.parentElement;
  if (!details || details.tagName !== 'DETAILS' || !details.dataset.id) return;
  // The [open] attribute toggles AFTER the click event runs, so defer
  // the read to the next microtask.
  setTimeout(() => {
    userIntent.set(details.dataset.id, details.open ? 'open' : 'closed');
  }, 0);
});

function applyUserIntent() {
  for (const [id, state] of userIntent) {
    const d = reportBody.querySelector('details[data-id="' + cssEscape(id) + '"]');
    if (d) d.open = state === 'open';
  }
}

let pendingRefresh = false;
async function refreshBody() {
  if (pendingRefresh) return;
  pendingRefresh = true;
  try {
    const html = await (await fetch('/api/body')).text();
    reportBody.innerHTML = html;
    // Server's renderTier decides isOpen based on running/failing state
    // (auto-open on either, auto-collapse on idle+all-pass). Then we
    // override with explicit user toggles so a manually-closed running
    // tier stays closed and a manually-opened passing tier stays open.
    applyUserIntent();
  } finally {
    pendingRefresh = false;
  }
}

// ---- Surgical infra updates ----
//
// Updating cards in place (rather than replacing the grid's innerHTML) keeps
// the heartbeat dot animation continuous and avoids the every-2s flash that
// remounting caused. The card skeleton matches what renderInfraCard emits
// server-side; new containers get a skeleton appended, departed ones removed.

const ENGINE_DEVICON_MAP = {
  mssql:              'devicon-microsoftsqlserver-plain',
  postgres:           'devicon-postgresql-plain',
  'postgres-private': 'devicon-postgresql-plain',
  mysql:              'devicon-mysql-plain',
  bastion:            'devicon-linux-plain',
};
function deviconFor(engine) {
  return ENGINE_DEVICON_MAP[engine] || 'devicon-docker-plain';
}

const INFRA_CARD_SKELETON =
  '<div class="infra-top">' +
    '<i class="brand-icon" aria-hidden="true"></i>' +
    '<div class="infra-id">' +
      '<span class="infra-name"></span>' +
      '<span class="infra-role"></span>' +
    '</div>' +
    '<span class="infra-state-dot"></span>' +
  '</div>' +
  '<div class="infra-cpu">' +
    '<div class="infra-cpu-num">0.0<span class="unit">%</span></div>' +
    '<svg class="infra-spark" viewBox="0 0 100 28" preserveAspectRatio="none"></svg>' +
  '</div>' +
  '<div class="infra-mem">' +
    '<div class="mem-row">' +
      '<span class="mem-vals"></span>' +
      '<span class="mem-pct"></span>' +
    '</div>' +
    '<div class="infra-mem-bar"><span></span></div>' +
  '</div>';

function cssEscape(s) {
  return (window.CSS && window.CSS.escape) ? window.CSS.escape(String(s)) : String(s).replace(/["\\\\]/g, '\\\\$&');
}

function sparkPaths(history) {
  if (!history || history.length < 2) return '';
  const w = 100, h = 28;
  const max = Math.max(20, ...history);
  const step = w / (history.length - 1);
  const pts = history.map((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  const linePath = 'M ' + pts.join(' L ');
  const areaPath = 'M 0,' + h + ' L ' + pts.join(' L ') + ' L ' + w + ',' + h + ' Z';
  return '<path class="area" d="' + areaPath + '"/><path d="' + linePath + '"/>';
}

function setText(node, sel, value) {
  const el = node.querySelector(sel);
  if (el && el.textContent !== String(value)) el.textContent = String(value);
}

function ensureInfraScaffold() {
  let grid = infraHost.querySelector('.infra-grid');
  if (grid) return grid;
  // Server may have rendered an empty / error placeholder; replace with grid.
  infraHost.innerHTML =
    '<section class="infra">' +
      '<div class="section-label"><span>Infrastructure</span><span class="meta-readout"></span></div>' +
      '<div class="infra-grid"></div>' +
    '</section>';
  return infraHost.querySelector('.infra-grid');
}

function applyInfra(payload) {
  if (!payload) return;
  if (payload.error) {
    infraHost.innerHTML =
      '<section class="infra">' +
        '<div class="section-label"><span>Infrastructure</span></div>' +
        '<div class="infra-error">' + payload.error.replace(/[<>&]/g, (m) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;'}[m])) + '</div>' +
      '</section>';
    return;
  }
  const grid = ensureInfraScaffold();
  const seen = new Set();
  for (const c of payload.containers || []) {
    seen.add(c.name);
    let card = grid.querySelector('[data-id="' + cssEscape(c.name) + '"]');
    if (!card) {
      card = document.createElement('article');
      card.className = 'infra-card';
      card.dataset.id = c.name;
      card.innerHTML = INFRA_CARD_SKELETON;
      grid.appendChild(card);
    }
    if (card.dataset.engine !== c.engine) card.dataset.engine = c.engine;
    if (card.dataset.state !== c.state) card.dataset.state = c.state;

    // Brand icon — set the devicon class based on engine
    const brand = card.querySelector('.brand-icon');
    if (brand) {
      const wantClass = 'brand-icon ' + deviconFor(c.engine);
      if (brand.className !== wantClass) brand.className = wantClass;
    }

    setText(card, '.infra-name', c.name);
    setText(card, '.infra-role', c.role);
    const cpuEl = card.querySelector('.infra-cpu-num');
    if (cpuEl && cpuEl.firstChild) cpuEl.firstChild.nodeValue = (c.cpuPct ?? 0).toFixed(1);

    const spark = card.querySelector('.infra-spark');
    if (spark) spark.innerHTML = sparkPaths(c.history);

    const memMB = Math.round((c.memBytes || 0) / 1048576);
    const limitMB = Math.round((c.memLimit || 0) / 1048576);
    const memPct = (c.memPct || 0).toFixed(1);
    const valEl = card.querySelector('.mem-vals');
    if (valEl) valEl.innerHTML = memMB + ' / ' + limitMB + ' <span class="mem-unit">MiB</span>';
    setText(card, '.mem-pct', memPct + '%');
    const bar = card.querySelector('.infra-mem-bar > span');
    if (bar) bar.style.setProperty('--pct', memPct + '%');
  }
  // Remove cards no longer present
  for (const card of Array.from(grid.children)) {
    if (!seen.has(card.dataset.id)) card.remove();
  }
  // Polled-time readout — show the static interval, not a live-changing timestamp
  const meta = infraHost.querySelector('.meta-readout');
  if (meta && payload.pollIntervalMs) {
    const sec = Math.round(payload.pollIntervalMs / 1000);
    meta.textContent = 'polled every ' + sec + 's';
  }

  // Toggle Up/Down/Reset state based on harness state and any in-flight op.
  // Active op wins: while a long-running docker compose action is happening
  // we mark the running button as busy and disable all three so the user
  // can't fire conflicting commands. The op is cleared server-side when the
  // promise settles (success or failure), so a stuck error won't freeze the
  // UI — it'll re-enable on the next infra broadcast after the catch.
  const upBtn = infraHost.querySelector('.ctrl-up');
  const downBtn = infraHost.querySelector('.ctrl-down');
  const resetBtn = infraHost.querySelector('.ctrl-reset');
  const harnessState = payload.harnessState;
  const activeOp = payload.activeOp;

  applyHarnessButton(upBtn, {
    op: 'up',
    activeOp,
    busyTitle: 'Bringing containers up…',
    idleDisabled: harnessState === 'up',
    idleDisabledTitle: 'Already up',
    enabledTitle: 'Bring containers up (idempotent)',
  });
  applyHarnessButton(downBtn, {
    op: 'down',
    activeOp,
    busyTitle: 'Stopping containers…',
    idleDisabled: harnessState === 'down',
    idleDisabledTitle: 'Already down',
    enabledTitle: 'Stop containers (volumes preserved)',
  });
  applyHarnessButton(resetBtn, {
    op: 'reset',
    activeOp,
    busyTitle: 'Resetting (down -v + up)…',
    idleDisabled: false,
    idleDisabledTitle: '',
    enabledTitle: 'Tear all containers down (with volumes) and bring them back up',
  });
}

function applyHarnessButton(btn, opts) {
  if (!btn) return;
  const { op, activeOp, busyTitle, idleDisabled, idleDisabledTitle, enabledTitle } = opts;
  // Any active op disables every button — they share the docker compose lock.
  // The button matching the active op also gets the visual busy treatment.
  if (activeOp) {
    btn.disabled = true;
    if (op === activeOp) {
      btn.classList.add('is-working');
      btn.title = busyTitle;
    } else {
      btn.classList.remove('is-working');
      btn.title = 'Waiting for ' + activeOp + '…';
    }
    return;
  }
  btn.classList.remove('is-working');
  btn.disabled = idleDisabled;
  btn.title = idleDisabled ? idleDisabledTitle : enabledTitle;
}

function connect() {
  const es = new EventSource('/events');
  es.onopen = () => setStatus('Live', true);
  es.addEventListener('state', (evt) => {
    try {
      const data = JSON.parse(evt.data);
      updateRunAllAvailability(data);
    } catch (err) {
      console.warn('[state] could not parse SSE payload', err);
    }
    refreshBody();
  });

  // Run All sits in the static dashboard shell (not re-rendered by /api/body),
  // so we toggle its enabled state in place from the SSE state event. Disabled
  // whenever any tier is mid-run — kicking off another Run All while a tier is
  // still running would just bounce off the per-tier in-flight guards anyway.
  function updateRunAllAvailability(stateSnapshot) {
    const runBtn = document.querySelector('.ctrl-run-all');
    const cancelBtn = document.querySelector('.ctrl-cancel-all');
    if (!runBtn || !cancelBtn) return;
    // Cancel All only matters for cancelable tiers (e2e/visual). Vitest tiers
    // can't be aborted mid-run, so a running unit/integration tier shouldn't
    // surface a Cancel All button — would imply more power than we have.
    const tiers = Array.isArray(stateSnapshot?.tiers) ? stateSnapshot.tiers : [];
    const cancelableRunning = tiers.some(
      (t) => t.runState === 'running' && (t.key === 'e2e' || t.key === 'visual')
    );
    const anyRunning = tiers.some((t) => t.runState === 'running');
    runBtn.disabled = anyRunning;
    runBtn.title = anyRunning
      ? 'A tier is already running — wait for it to finish'
      : 'Re-run every tier (unit + integration + e2e + visual)';
    cancelBtn.hidden = !cancelableRunning;
  }
  es.addEventListener('infra', (event) => {
    try { applyInfra(JSON.parse(event.data)); }
    catch (err) { console.error('bad infra payload', err); }
  });
  es.onerror = () => {
    setStatus('Disconnected — retrying', false);
    es.close();
    setTimeout(connect, 2000);
  };
}
connect();

// ---- Control buttons (Run / Reset) ----
//
// Buttons emit a POST to the matching /control/* endpoint. The server
// triggers vitest watcher reruns by touching files (so the existing live
// reporter pipeline updates the dashboard normally), spawns a one-shot
// Playwright run for E2E, or runs docker-compose down -v then up for the
// harness reset. Per Craig's call: controls are remote-accessible; no
// localhost gate.

// ---- Custom confirm modal (replaces native window.confirm) ----
//
// The native confirm dialog clashes with the dashboard aesthetic and can't be
// styled. joineryConfirm builds on the existing modal markup, returns a Promise,
// and supports a 'tone' (info / warn / danger) that picks the accent color.

const modal = document.getElementById('joinery-modal');
const modalCard = modal.querySelector('.modal-card');
const modalTitle = modal.querySelector('.modal-title-text');
const modalIcon = modal.querySelector('.modal-icon');
const modalBody = modal.querySelector('.modal-body');
const modalCancel = modal.querySelector('.ctrl-modal-cancel');
const modalConfirm = modal.querySelector('.ctrl-modal-confirm');

const TONE_ICON = { info: 'help', warn: 'warning', danger: 'dangerous' };

let modalActiveResolve = null;
function closeModal(result) {
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', modalKeydown, true);
  if (modalActiveResolve) { modalActiveResolve(result); modalActiveResolve = null; }
}
function modalKeydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); closeModal(false); }
  else if (event.key === 'Enter') { event.preventDefault(); closeModal(true); }
}

function joineryConfirm({ title = 'Confirm', body = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'info' } = {}) {
  return new Promise((resolve) => {
    if (modalActiveResolve) { modalActiveResolve(false); }
    modalActiveResolve = resolve;
    modalCard.dataset.tone = tone;
    modalTitle.textContent = title;
    modalIcon.textContent = TONE_ICON[tone] || 'help';
    modalBody.textContent = body;
    modalConfirm.textContent = confirmLabel;
    modalCancel.textContent = cancelLabel;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => modalConfirm.focus(), 0);
  });
}

modalCancel.addEventListener('click', () => closeModal(false));
modalConfirm.addEventListener('click', () => closeModal(true));
modal.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(false));
// Bind ESC/Enter only while modal is shown — re-bound each open via joineryConfirm.
modal.addEventListener('toggle-listen', () => document.addEventListener('keydown', modalKeydown, true));
const modalObserver = new MutationObserver(() => {
  if (modal.hidden) document.removeEventListener('keydown', modalKeydown, true);
  else document.addEventListener('keydown', modalKeydown, true);
});
modalObserver.observe(modal, { attributes: true, attributeFilter: ['hidden'] });

async function dispatchControl(btn) {
  const action = btn.dataset.action;
  if (!action) return;

  if (action === 'harness-reset') {
    const ok = await joineryConfirm({
      title: 'Reset harness',
      body: 'This stops every test container, removes their volumes, and brings them back up. Any in-progress test runs will be interrupted and seeded data will be wiped. The first run after reset may be slower while databases re-initialize.',
      confirmLabel: 'Reset',
      tone: 'danger',
    });
    if (!ok) return;
  } else if (action === 'harness-down') {
    const ok = await joineryConfirm({
      title: 'Stop containers',
      body: 'Stops all test containers. Volumes are preserved — the next Up restores existing state immediately.',
      confirmLabel: 'Shutdown',
      tone: 'warn',
    });
    if (!ok) return;
  }

  const labelEl = btn.querySelector('.ctrl-label');
  const original = labelEl ? labelEl.textContent : btn.textContent;
  const setLabel = (text) => {
    if (labelEl) labelEl.textContent = text;
    else btn.textContent = text;
  };
  // Harness ops (up/down/reset) take 5–60s. Their busy state is owned by the
  // SSE-driven applyHarnessButton path (uses infra.activeOp) so we deliberately
  // skip the auto-clear here — the button stays disabled + 'is-working' until
  // the server reports the op finished. Other actions get the original 1.5s
  // ack flash.
  const isLongRunning = action === 'harness-up' || action === 'harness-down' || action === 'harness-reset';
  btn.disabled = true;
  btn.classList.add('is-busy');
  btn.classList.remove('is-error');
  setLabel('starting');
  let payload = {};
  if (action === 'run-tier')    payload = { tier: btn.dataset.tier };
  if (action === 'run-suite')   payload = { tier: btn.dataset.tier, file: btn.dataset.file };
  if (action === 'cancel-tier') payload = { tier: btn.dataset.tier };
  if (action === 'cancel-all')  payload = {};
  try {
    const resp = await fetch('/control/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('control failed: ' + resp.status + ' ' + txt);
    }
    if (isLongRunning) {
      // SSE will own the rest of the lifecycle. Restore the original label
      // so the button reads 'Up' / 'Down' / 'Reset' (paired with the spinner)
      // for the duration, not 'starting' frozen in place.
      setLabel(original);
      btn.classList.remove('is-busy');
      // Leave btn.disabled = true; applyHarnessButton will re-enable when the
      // op clears server-side.
    } else {
      setLabel('queued');
      setTimeout(() => {
        setLabel(original);
        btn.classList.remove('is-busy');
        btn.disabled = false;
      }, 1500);
    }
  } catch (err) {
    console.error('[control] ' + action, err);
    btn.classList.remove('is-busy');
    btn.classList.add('is-error');
    setLabel('failed');
    setTimeout(() => {
      setLabel(original);
      btn.classList.remove('is-error');
      btn.disabled = false;
    }, 1800);
  }
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('.ctrl-btn');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  dispatchControl(btn);
});

// Auto-rerun toggle pill — separate from the .ctrl-btn dispatcher because it
// has different semantics (no "starting" flash, no error reset, just flip the
// server flag and let the next state event re-render the button). The server
// flips state.autorun and broadcasts; refreshBody picks it up.
document.addEventListener('click', async (event) => {
  const btn = event.target.closest('.autorun-toggle');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  const tier = btn.dataset.tier;
  const next = btn.dataset.enabled !== 'true'; // current → inverted
  btn.disabled = true;
  try {
    const resp = await fetch('/control/set-autorun', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, enabled: next }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error('set-autorun failed: ' + resp.status + ' ' + txt);
    }
  } catch (err) {
    console.error('[autorun]', err);
    btn.disabled = false; // re-enable so the user can retry
  }
});

// Same belt-and-suspenders mousedown stop as the copy button — keeps the
// surrounding <details> from toggling when you click a Run/Reset/toggle button.
document.addEventListener('mousedown', (event) => {
  if (event.target.closest('.ctrl-btn, .autorun-toggle')) event.stopPropagation();
}, true);

// Lightbox bound by LIGHTBOX_SCRIPT, included from render-html.mjs below.
</script>
<script>${LIGHTBOX_SCRIPT}</script>
</body>
</html>`;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// ---- harness + git helpers ----

async function ensureHarnessUp() {
  console.log('▶ Bringing test harness up (idempotent)…');
  await runOnce('node', ['tests/scripts/ensure-ssh-key.mjs']);
  await runOnce('docker', ['compose', '-f', 'tests/docker-compose.test.yml', 'up', '-d', '--wait']);
}

function listLanUrls(port) {
  const urls = [];
  const seen = new Set();
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] ?? []) {
      if (addr.internal) continue;
      if (addr.family !== 'IPv4') continue;
      if (seen.has(addr.address)) continue;
      seen.add(addr.address);
      urls.push(`http://${addr.address}:${port}    [${name}]`);
    }
  }
  return urls;
}

async function getGit() {
  const branch = (await capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const commit = (await capture('git', ['rev-parse', '--short', 'HEAD'])).trim();
  const dirty = (await capture('git', ['status', '--porcelain'])).trim().length > 0;
  return { branch, commit, dirty };
}

function runOnce(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

function capture(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO_ROOT });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}`))));
  });
}
