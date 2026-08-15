// Custom Vitest 4 reporter that POSTs per-test events to a local SSE server.
//
// Activated by setting JOINERY_LIVE_REPORTER_URL and JOINERY_LIVE_REPORTER_TIER
// in the environment when invoking vitest. Used by tests/reporter/serve.mjs
// to drive the live dashboard test-by-test rather than only after each run
// completes.
//
// When the env vars aren't set, this reporter silently no-ops, so the same
// vitest invocation is safe to use in CI / one-shot scenarios.

const URL = process.env.JOINERY_LIVE_REPORTER_URL;
const TIER = process.env.JOINERY_LIVE_REPORTER_TIER;

async function post(event) {
  if (!URL || !TIER) return;
  try {
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tier: TIER, at: Date.now(), ...event }),
    });
  } catch (err) {
    // Server might not be up yet, or be in the middle of a restart. Don't
    // fail the test run — log to stderr so a sustained outage is visible.
    process.stderr.write(`[live-reporter] post failed: ${err?.message ?? err}\n`);
  }
}

function moduleIdOf(item) {
  return item?.module?.moduleId ?? item?.moduleId ?? '';
}

export default class JoineryLiveReporter {
  async onTestRunStart(specifications) {
    await post({
      type: 'run-start',
      files: specifications.map((s) => s.moduleId),
    });
  }

  async onTestModuleStart(testModule) {
    await post({ type: 'module-start', file: moduleIdOf(testModule) });
  }

  async onTestModuleEnd(testModule) {
    await post({ type: 'module-end', file: moduleIdOf(testModule) });
  }

  async onTestCaseResult(testCase) {
    const result = testCase.result?.();
    await post({
      type: 'test-result',
      file: moduleIdOf(testCase),
      fullName: testCase.fullName,
      status: result?.state ?? 'unknown',
      durationMs: result?.duration,
      failureMessages: (result?.errors ?? []).map((e) => e?.message ?? String(e)),
    });
  }

  async onTestRunEnd(_testModules, _unhandledErrors, reason) {
    await post({ type: 'run-end', reason });
  }
}
