// Custom Playwright reporter that POSTs per-test events to the Joinery live
// dashboard server. Uses the same /_event protocol as the Vitest reporter
// so the server treats Playwright runs uniformly with the Vitest tiers.
//
// Activated by setting JOINERY_LIVE_REPORTER_URL in the environment when
// invoking Playwright. When the env var is missing this reporter no-ops,
// so the same playwright.config.ts is safe in CI / one-shot scenarios.
//
// Tier defaults to 'e2e' but can be overridden with JOINERY_LIVE_REPORTER_TIER
// for future sub-tier splits (e.g., 'visual').

const URL = process.env.JOINERY_LIVE_REPORTER_URL;
const DEFAULT_TIER = process.env.JOINERY_LIVE_REPORTER_TIER || 'e2e';

// Visual baselines live under tests/e2e-react-visual/ — route them to the
// dedicated 'visual' tier so the dashboard shows them as a distinct row.
function tierForFile(file) {
  if (typeof file === 'string' && file.includes('/tests/e2e-react-visual/')) return 'visual';
  return DEFAULT_TIER;
}

async function post(tier, event) {
  if (!URL) return;
  try {
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier, at: Date.now(), ...event }),
    });
  } catch (err) {
    process.stderr.write(`[playwright-live-reporter] post failed: ${err?.message ?? err}\n`);
  }
}

function fullNameOf(test) {
  return test.titlePath().slice(1).filter(Boolean).join(' > ') || test.title;
}

export default class JoineryPlaywrightLiveReporter {
  constructor() {
    // Tracks which tiers actually started in this run, so onEnd only flushes
    // run-end events for tiers that had a run-start. Avoids flipping an idle
    // tier (e.g., 'visual' when only e2e ran) to 'ok'/'failed'.
    this._activeTiers = new Set();
    // file -> Set<fullName>. Lets us emit module-end the moment a file's
    // last test finishes, instead of waiting for the whole project's onEnd
    // to flip every suite back to 'idle' at once. Without this, every suite
    // shows the RUN badge for the entire duration of the playwright run.
    this._pendingByFile = new Map();
  }

  async onBegin(_config, suite) {
    const filesByTier = new Map();
    for (const test of suite.allTests()) {
      const file = test.location?.file ?? '';
      if (!file) continue;
      const tier = tierForFile(file);
      if (!filesByTier.has(tier)) filesByTier.set(tier, new Set());
      filesByTier.get(tier).add(file);
      const fullName = fullNameOf(test);
      let pending = this._pendingByFile.get(file);
      if (!pending) { pending = new Set(); this._pendingByFile.set(file, pending); }
      pending.add(fullName);
    }
    for (const [tier, files] of filesByTier) {
      this._activeTiers.add(tier);
      await post(tier, { type: 'run-start', files: Array.from(files) });
    }
  }

  async onTestBegin(test) {
    const file = test.location?.file ?? '';
    const tier = tierForFile(file);
    await post(tier, { type: 'module-start', file });
    // Also emit a 'running' placeholder so the dashboard renders this test
    // as a RUN row immediately, instead of it being invisible until
    // onTestEnd fires. Makes it clear what's currently being executed.
    // The test-result event fired by onTestEnd will overwrite this entry
    // with the real status by fullName.
    await post(tier, {
      type: 'test-result',
      file,
      fullName: fullNameOf(test),
      status: 'running',
      durationMs: 0,
      failureMessages: [],
    });
  }

  async onTestEnd(test, result) {
    const file = test.location?.file ?? '';
    const tier = tierForFile(file);
    const status = normalizeStatus(result.status);
    const failureMessages = (result.errors ?? []).map((e) => e?.message ?? String(e));
    // For visual tests: baseline + (on failure) actual/diff attachments.
    // The server exposes these via /snapshots/* and /attachments/* so the
    // dashboard can render thumbnails without bloating SSE payloads.
    const screenshots = tier === 'visual'
      ? collectVisualScreenshots(test, result)
      : undefined;
    await post(tier, {
      type: 'test-result',
      file,
      fullName: fullNameOf(test),
      status,
      durationMs: result.duration,
      failureMessages,
      screenshots,
    });
    // Mark this test as done; if it was the last pending one for this file,
    // emit module-end so the suite header flips from RUN to its outcome
    // immediately. Skips when the test is being retried (more attempts to
    // come) — Playwright fires onTestEnd per attempt, so we wait for the
    // final one before declaring the file done.
    const moreRetries = result.retry < (test.retries ?? 0) && status !== 'passed';
    if (!moreRetries) {
      const pending = this._pendingByFile.get(file);
      if (pending) {
        pending.delete(fullNameOf(test));
        if (pending.size === 0) {
          this._pendingByFile.delete(file);
          await post(tier, { type: 'module-end', file });
        }
      }
    }
  }

  async onEnd(result) {
    await Promise.all(
      Array.from(this._activeTiers).map((tier) =>
        post(tier, { type: 'run-end', reason: result.status }),
      ),
    );
    this._activeTiers.clear();
  }
}

// Convention: snapshot file = test title, kebab-cased + .png. Lets the
// reporter point at the right baseline without parsing the test source.
function snapshotNameFromTitle(title) {
  return String(title).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
}

function collectVisualScreenshots(test, result) {
  const file = test.location?.file ?? '';
  const specName = file.split('/').pop() || 'spec';
  const snapshotName = snapshotNameFromTitle(test.title);
  // Server resolves these relative to tests/__snapshots__/visual.
  const baseline = `${specName}/${snapshotName}`;
  // Failure attachments are absolute paths under
  // tests/reports/.cache/playwright-results/. Server's /attachments/ route
  // validates and serves them.
  const byName = new Map();
  for (const a of result.attachments ?? []) {
    if (!a?.path || !a?.name) continue;
    byName.set(a.name, a.path);
  }
  const result_ = { baseline };
  // Playwright attachment names look like "<arg>-actual" / "<arg>-diff".
  for (const name of byName.keys()) {
    if (name.endsWith('-actual')) result_.actual = byName.get(name);
    else if (name.endsWith('-diff')) result_.diff = byName.get(name);
    else if (name.endsWith('-expected')) result_.expectedSnapshot = byName.get(name);
  }
  return result_;
}

function normalizeStatus(s) {
  if (s === 'passed' || s === 'failed' || s === 'skipped') return s;
  // Playwright also emits 'timedOut', 'interrupted'. Treat as failed.
  return 'failed';
}
