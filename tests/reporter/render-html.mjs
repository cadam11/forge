// HTML renderer for the regression-test report.
//
// Pure function module: takes a normalized report object, returns a self-
// contained HTML string with embedded CSS and JS. No I/O, no side effects.
//
// Aesthetic: "Vital Signs Telemetry" — a warm-dark mission-control cockpit
// in IBM Plex (Sans + Sans Condensed + Mono) with a phosphor-amber accent
// and engine-tinted indicators. Extends the Forge identity into its own
// dedicated dev-tool surface; deliberately distinct from the app's purple
// theme so the dashboard reads as instrument panel, not application chrome.

const STATUS_BADGE = {
  passed:  { label: 'PASS',    klass: 'badge-pass'    },
  failed:  { label: 'FAIL',    klass: 'badge-fail'    },
  skipped: { label: 'SKIP',    klass: 'badge-skip'    },
  pending: { label: 'PENDING', klass: 'badge-pending' },
  running: { label: 'RUN',     klass: 'badge-running' },
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTimestamp(epochMs) {
  return new Date(epochMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function fmtBytesMiB(bytes) {
  if (!bytes || bytes < 0) return '0';
  return (bytes / (1024 * 1024)).toFixed(0);
}

// Synopsis: short business-language paragraph derived from the run summary.
function buildSynopsis(report) {
  const totals = report.totals;
  if (totals.failed === 0 && totals.total > 0) {
    const tiers = report.tiers
      .filter((t) => t.status !== 'pending')
      .map((t) => t.label)
      .join(' and ');
    return `All ${totals.total} regression checks passed across the ${tiers} tier${
      report.tiers.filter((t) => t.status !== 'pending').length === 1 ? '' : 's'
    }. No regressions detected since the last run.`;
  }
  if (totals.failed > 0) {
    const failingTiers = report.tiers
      .filter((t) => t.totals?.failed > 0)
      .map((t) => `${t.label} (${t.totals.failed})`)
      .join(', ');
    return (
      `${totals.failed} of ${totals.total} regression checks failed. ` +
      `Failures concentrated in: ${failingTiers}. See engineering details below.`
    );
  }
  return 'No tests were executed in this run.';
}

// ---- Per-section "Copy for LLM" payloads ----

function copyPayloadForTier(report, tier) {
  const lines = [
    `# Forge regression / ${tier.label} tier`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `run: ${fmtTimestamp(report.startedAt)}`,
    `result: ${tier.totals.passed}/${tier.totals.total} passed (${fmtDuration(tier.durationMs)})`,
  ];
  const failures = tier.suites.flatMap((s) =>
    s.tests.filter((t) => t.status === 'failed').map((t) => ({ suite: s.name, test: t })),
  );
  if (failures.length) {
    lines.push('');
    lines.push('FAILED:');
    for (const { suite, test } of failures) {
      lines.push(`- ${suite} > ${test.fullName}`);
      const firstError = test.failureMessages?.[0]?.split('\n').slice(0, 6).join('\n');
      if (firstError) lines.push(`  ${firstError.replaceAll('\n', '\n  ')}`);
    }
  }
  return lines.join('\n');
}

function copyPayloadForSuite(report, tier, suite) {
  const lines = [
    `# Forge regression / ${tier.label} / ${suite.name}`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `result: ${suite.totals.passed}/${suite.totals.total} passed (${fmtDuration(suite.durationMs)})`,
  ];
  const failures = suite.tests.filter((t) => t.status === 'failed');
  if (failures.length) {
    lines.push('');
    lines.push('FAILED:');
    for (const t of failures) {
      lines.push(`- ${t.fullName}`);
      for (const msg of t.failureMessages ?? []) {
        const trimmed = msg.split('\n').slice(0, 8).join('\n');
        lines.push(`  ${trimmed.replaceAll('\n', '\n  ')}`);
      }
    }
  } else {
    lines.push('all passing');
  }
  return lines.join('\n');
}

function copyPayloadForFailure(report, tier, suite, test) {
  return [
    `# Forge regression failure`,
    `tier: ${tier.label}`,
    `suite: ${suite.name}`,
    `test: ${test.fullName}`,
    `git: ${report.git.branch}@${report.git.commit}${report.git.dirty ? ' (dirty)' : ''}`,
    `duration: ${fmtDuration(test.durationMs)}`,
    '',
    'error:',
    ...((test.failureMessages ?? []).map((m) => m)),
  ].join('\n');
}

// ---- HTML chunks ----

function renderHero(report) {
  const t = report.totals;
  return `
    <section class="hero">
      <div class="counter ${t.passed > 0 ? 'is-pass' : ''}">
        <div class="counter-num">${t.passed}</div>
        <div class="counter-label">passed</div>
      </div>
      <div class="counter ${t.failed > 0 ? 'is-fail' : ''}">
        <div class="counter-num">${t.failed}</div>
        <div class="counter-label">failed</div>
      </div>
      <div class="counter ${t.skipped > 0 ? 'is-skip' : ''}">
        <div class="counter-num">${t.skipped}</div>
        <div class="counter-label">skipped</div>
      </div>
      <div class="counter">
        <div class="counter-num">${fmtDuration(report.durationMs)}</div>
        <div class="counter-label">duration</div>
      </div>
    </section>
  `;
}

// ---- Infrastructure (Docker container) panel ----

export function renderInfrastructure(infra) {
  if (!infra) return '';
  if (infra.error) {
    return `
      <section class="infra">
        <div class="section-label"><span>Infrastructure</span></div>
        <div class="infra-error">${escapeHtml(infra.error)}</div>
      </section>
    `;
  }
  if (!infra.containers || infra.containers.length === 0) {
    return `
      <section class="infra">
        <div class="section-label">
          <span>Infrastructure</span>
          <span class="section-line"></span>
          ${renderHarnessControls(infra.harnessState)}
        </div>
        <div class="infra-empty">Awaiting Docker — run <span class="mono">pnpm run test:harness:up</span></div>
      </section>
    `;
  }
  const cards = infra.containers.map(renderInfraCard).join('');
  const intervalSec = Math.round((infra.pollIntervalMs ?? 2000) / 1000);
  const polled = `<span class="meta-readout">polled every ${intervalSec}s</span>`;
  return `
    <section class="infra">
      <div class="section-label">
        <span>Infrastructure</span>
        ${polled}
        <span class="section-line"></span>
        ${renderHarnessControls(infra.harnessState)}
      </div>
      <div class="infra-grid">${cards}</div>
    </section>
  `;
}

function renderHarnessControls(harnessState = 'partial') {
  const upDisabled = harnessState === 'up' ? 'disabled' : '';
  const downDisabled = harnessState === 'down' ? 'disabled' : '';
  const upTitle = harnessState === 'up' ? 'Already up' : 'Bring containers up (idempotent)';
  const downTitle = harnessState === 'down' ? 'Already down' : 'Stop containers (volumes preserved)';
  return `
    <span class="section-controls">
      <button type="button" class="ctrl-btn ctrl-up"    data-action="harness-up"    title="${upTitle}"   ${upDisabled}><span class="material-symbols-outlined ctrl-icon">power_settings_new</span><span class="ctrl-label">Up</span></button>
      <button type="button" class="ctrl-btn ctrl-down"  data-action="harness-down"  title="${downTitle}" ${downDisabled}><span class="material-symbols-outlined ctrl-icon">stop</span><span class="ctrl-label">Down</span></button>
      <button type="button" class="ctrl-btn ctrl-reset" data-action="harness-reset" title="Tear all containers down (with volumes) and bring them back up"><span class="material-symbols-outlined ctrl-icon">restart_alt</span><span class="ctrl-label">Reset</span></button>
    </span>
  `;
}

// Renders the per-tier / per-suite Run button.
//
// Three input states map to three visuals:
//
//   • running=false                  → enabled Run button
//   • running=true,  cancelable=true → red Cancel button (kills the in-flight
//                                       playwright child via cancel-tier)
//   • running=true,  cancelable=false→ disabled Run button (this entity isn't
//                                       what's actively running, OR the tier
//                                       has no abortable child — i.e. vitest)
//
// `cancelable` is asked separately from `running` because at the suite level
// the parent tier may be running while THIS suite isn't (already done, or
// queued). Showing Cancel on a non-running suite would suggest you can stop
// just that suite, which isn't true — playwright's process is per-tier.
function renderRunButton(action, payload, opts = {}) {
  const { label = 'Run', running = false, cancelable = false, tierKey } = opts;
  const dataAttrs = Object.entries(payload)
    .map(([k, v]) => `data-${k}="${escapeHtml(String(v))}"`)
    .join(' ');
  if (running && cancelable && tierKey && (tierKey === 'e2e' || tierKey === 'visual')) {
    return `<button type="button" class="ctrl-btn ctrl-cancel" data-action="cancel-tier" data-tier="${escapeHtml(tierKey)}" title="Stop the in-flight Playwright run"><span class="material-symbols-outlined ctrl-icon">close</span><span class="ctrl-label">Cancel</span></button>`;
  }
  if (running) {
    return `<button type="button" class="ctrl-btn ctrl-run" disabled title="Tier is mid-run — wait for the current run to finish"><span class="material-symbols-outlined ctrl-icon">play_arrow</span><span class="ctrl-label">${escapeHtml(label)}</span></button>`;
  }
  return `<button type="button" class="ctrl-btn ctrl-run" data-action="${escapeHtml(action)}" ${dataAttrs} title="Re-run via the live harness"><span class="material-symbols-outlined ctrl-icon">play_arrow</span><span class="ctrl-label">${escapeHtml(label)}</span></button>`;
}

// Map of engine kind → devicon class. Brand icons on cards make each container
// instantly identifiable at a glance.
const ENGINE_DEVICON = {
  mssql:              'devicon-microsoftsqlserver-plain',
  postgres:           'devicon-postgresql-plain',
  'postgres-private': 'devicon-postgresql-plain',
  mysql:              'devicon-mysql-plain',
  bastion:            'devicon-linux-plain',
};
function deviconClass(engine) {
  return ENGINE_DEVICON[engine] ?? 'devicon-docker-plain';
}

function renderInfraCard(c) {
  const cpu = Number.isFinite(c.cpuPct) ? c.cpuPct : 0;
  const memMB = fmtBytesMiB(c.memBytes);
  const memLimitMB = fmtBytesMiB(c.memLimit);
  const memPct = Number.isFinite(c.memPct) ? c.memPct : 0;
  const stateLabel = (c.state || 'unknown').toUpperCase();
  return `
    <article class="infra-card" data-id="${escapeHtml(c.name)}" data-engine="${escapeHtml(c.engine)}" data-state="${escapeHtml(c.state)}">
      <div class="infra-top">
        <i class="brand-icon ${escapeHtml(deviconClass(c.engine))}" aria-hidden="true"></i>
        <div class="infra-id">
          <span class="infra-name">${escapeHtml(c.name)}</span>
          <span class="infra-role">${escapeHtml(c.role)}</span>
        </div>
        <span class="infra-state-dot" title="${escapeHtml(stateLabel)}"></span>
      </div>
      <div class="infra-cpu">
        <div class="infra-cpu-num">${cpu.toFixed(1)}<span class="unit">%</span></div>
        ${renderSparkline(c.history)}
      </div>
      <div class="infra-mem">
        <div class="mem-row">
          <span class="mem-vals">${memMB} / ${memLimitMB} <span class="mem-unit">MiB</span></span>
          <span class="mem-pct">${memPct.toFixed(1)}%</span>
        </div>
        <div class="infra-mem-bar"><span style="--pct: ${memPct.toFixed(1)}%"></span></div>
      </div>
    </article>
  `;
}

function renderSparkline(history) {
  if (!history || history.length < 2) {
    return `<svg class="infra-spark" viewBox="0 0 100 28" preserveAspectRatio="none"></svg>`;
  }
  const w = 100;
  const h = 28;
  const max = Math.max(20, ...history); // baseline 20% so an idle line isn't pinned to the top
  const step = w / (history.length - 1);
  const pts = history.map((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `M 0,${h} L ${pts.join(' L ')} L ${w},${h} Z`;
  return `
    <svg class="infra-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path class="area" d="${areaPath}"/>
      <path d="${linePath}"/>
    </svg>
  `;
}

// ---- Test sections ----

function renderTest(test, opts = {}) {
  // While the parent suite is still running, a completed test's PASS or
  // FAIL badge fights the suite-level RUN badge visually. Force the row
  // to render as RUN until the suite settles — once the suite goes idle,
  // the real per-test status takes over. This is a display-only override;
  // the underlying test.status (and suite/tier totals) keep the truth.
  const effectiveStatus =
    opts.parentSuiteRunning && (test.status === 'passed' || test.status === 'failed')
      ? 'running'
      : test.status;
  const s = STATUS_BADGE[effectiveStatus] ?? STATUS_BADGE.skipped;
  const failureBlock =
    test.status === 'failed' && test.failureMessages?.length
      ? `<pre class="failure">${escapeHtml(test.failureMessages.join('\n\n'))}</pre>`
      : '';
  const visuals = test.screenshots ? renderVisualBlock(test.screenshots, test.status) : '';
  return `
    <li class="test test-${test.status}">
      <span class="badge ${s.klass}">${s.label}</span>
      <span class="test-name">${escapeHtml(test.fullName)}</span>
      <span class="test-duration mono">${fmtDuration(test.durationMs)}</span>
      ${failureBlock}
      ${visuals}
    </li>
  `;
}

// Visual-tier test row addendum: thumbnails of the captured baseline (always)
// plus actual + diff (only when the test failed). Click any thumbnail to
// open the lightbox.
function renderVisualBlock(screenshots, status) {
  if (!screenshots) return '';
  const thumbs = [];
  if (screenshots.baseline) thumbs.push({ label: 'Baseline', url: screenshots.baseline });
  if (status === 'failed' && screenshots.actual) thumbs.push({ label: 'Actual',   url: screenshots.actual,   tone: 'fail' });
  if (status === 'failed' && screenshots.diff)   thumbs.push({ label: 'Diff',     url: screenshots.diff,     tone: 'fail' });
  if (thumbs.length === 0) return '';
  return `
    <div class="visual-row">
      ${thumbs.map((t) => `
        <button type="button" class="visual-thumb visual-thumb-${escapeHtml(t.tone ?? 'ok')}" data-lightbox-src="${escapeHtml(t.url)}" data-lightbox-label="${escapeHtml(t.label)}" title="Click to enlarge">
          <img loading="lazy" src="${escapeHtml(t.url)}" alt="${escapeHtml(t.label)}" />
          <span class="visual-thumb-label">${escapeHtml(t.label)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderSuite(report, tier, suite) {
  const failed = suite.totals.failed;
  const passed = suite.totals.passed;
  const skipped = suite.totals.skipped;
  const running = suite.runState === 'running';
  const isOpen = failed > 0 || running;
  const summary =
    failed > 0
      ? `<span class="suite-summary text-error">${failed} failed</span>`
      : `<span class="suite-summary text-muted">${passed} passed</span>`;
  const skipNote = skipped > 0 ? `<span class="suite-summary text-muted"> · ${skipped} skipped</span>` : '';
  const runBadge = running ? `<span class="badge badge-running">RUN</span>` : '';
  // Mirrors the tier-level PASS rule: only show when every test in this
  // suite passed and the suite isn't currently running.
  const passBadge = !running && failed === 0 && passed > 0
    ? `<span class="badge badge-pass" title="All ${passed} tests in this suite passed">PASS</span>`
    : '';
  const payload = escapeHtml(copyPayloadForSuite(report, tier, suite));
  // Symmetry with single-suite Run: the suite shows Cancel only when the
  // active playwright child is running EXACTLY this one suite. In that case
  // cancelling it kills the right thing and nothing else. Tier-wide reruns
  // (runScope === 'all') don't get a per-suite Cancel — the only honest
  // Cancel for those lives on the tier header.
  const tierRunning = tier.runState === 'running';
  const runScope = tier.runScope;
  const onlyThisSuiteRunning =
    Array.isArray(runScope) && runScope.length === 1 && runScope[0] === suite.name;
  const runButton = tier.key
    ? renderRunButton('run-suite', { tier: tier.key, file: suite.name }, {
        label: 'Run',
        running: tierRunning,
        cancelable: onlyThisSuiteRunning,
        tierKey: tier.key,
      })
    : '';
  // Stable data-id so the dashboard's open-state preserver can re-open this
  // suite after a body refresh.
  const id = `suite:${tier.label}:${suite.name}`;
  return `
    <details class="suite ${running ? 'is-running' : ''}" data-id="${escapeHtml(id)}" ${isOpen ? 'open' : ''}>
      <summary>
        ${runBadge}
        ${passBadge}
        <span class="suite-name mono">${escapeHtml(suite.name)}</span>
        ${summary}${skipNote}
        <span class="suite-duration mono text-muted">${fmtDuration(suite.durationMs)}</span>
        ${runButton}
        <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy a token-efficient summary of this suite for pasting into an LLM">Copy for LLM</button>
      </summary>
      <ul class="test-list">
        ${suite.tests.map((t) => renderTest(t, { parentSuiteRunning: running })).join('')}
      </ul>
    </details>
  `;
}

// Switch control for the per-tier file-watch auto-rerun. Only e2e + visual
// have a server-side watcher worth opting out of (vitest reruns are nearly
// free). For tiers without the switch we still emit an empty .autorun-slot
// of the same width — that keeps the [counts][duration][Run][Copy] cluster
// horizontally aligned across all four tiers.
function renderAutorunToggle(tier, report) {
  if (!tier.key || (tier.key !== 'e2e' && tier.key !== 'visual')) {
    return '<span class="autorun-slot" aria-hidden="true"></span>';
  }
  const enabled = report?.autorun?.[tier.key] !== false; // default ON
  const title = enabled
    ? 'Watch is ON — file changes auto-rerun the suite after a 30s debounce. Click to disable (STALE badge will still appear on change).'
    : 'Watch is OFF — file changes still mark the suite STALE but won\'t auto-rerun. Click to enable.';
  return `<span class="autorun-slot"><button type="button" role="switch" aria-checked="${enabled}" class="autorun-toggle" data-action="toggle-autorun" data-tier="${escapeHtml(tier.key)}" data-enabled="${enabled}" title="${escapeHtml(title)}"><span class="autorun-label">Watch</span><span class="autorun-track"><span class="autorun-thumb"></span></span></button></span>`;
}

function renderTier(report, tier) {
  if (tier.status === 'pending') {
    // Pending tiers can't be running by definition, so no need to thread state.
    const runButton = tier.key ? renderRunButton('run-tier', { tier: tier.key }, { label: 'Run' }) : '';
    return `
      <section class="tier tier-pending">
        <div class="tier-header">
          <h2>${escapeHtml(tier.label)}</h2>
          <span class="badge badge-pending">PENDING</span>
          ${runButton}
        </div>
        <p class="tier-note">${escapeHtml(tier.note ?? '')}</p>
      </section>
    `;
  }
  const t = tier.totals;
  const running = tier.runState === 'running';
  const isOpen = t.failed > 0 || running;
  const payload = escapeHtml(copyPayloadForTier(report, tier));
  const runBadge = running
    ? `<span class="badge badge-running" title="Tests are running right now">RUN ${escapeHtml(String(tier.testsCompleted ?? 0))}</span>`
    : '';
  const staleBadge = tier.stale && !running
    ? `<span class="badge badge-stale" title="Specs or helpers changed since this run — result may be out of date">STALE</span>`
    : '';
  // PASS badge: only when every test in the tier passed, the tier isn't
  // currently running OR stale (those badges take precedence — STALE means
  // the green is potentially out of date, RUN means we're not done yet),
  // AND every suite in the tier has actually been run (totals.total > 0).
  // The last condition prevents a tier from claiming PASS when only some
  // of its suites have results — e.g. when you ran a single-suite rerun
  // and the others have never been touched.
  const allSuitesHaveResults =
    Array.isArray(tier.suites) &&
    tier.suites.length > 0 &&
    tier.suites.every((s) => (s.totals?.total ?? 0) > 0);
  const passBadge =
    !running && !tier.stale && t.failed === 0 && t.passed > 0 && allSuitesHaveResults
      ? `<span class="badge badge-pass" title="All ${t.passed} tests in this tier passed">PASS</span>`
      : '';
  const currentTest =
    running && tier.currentTest
      ? `<div class="tier-current mono">↳ ${escapeHtml(tier.currentTest)}</div>`
      : '';
  const id = `tier:${tier.label}`;
  // Tier-level button: when the tier is running, the cancellable thing IS
  // the tier (single playwright child per tier), so cancelable mirrors
  // running directly.
  const runButton = tier.key
    ? renderRunButton('run-tier', { tier: tier.key }, { label: 'Run', running, cancelable: running, tierKey: tier.key })
    : '';
  // Auto-rerun toggle is only meaningful for tiers that have a server-side
  // file watcher with debounced reruns. Vitest tiers (unit/integration) are
  // sub-second so always-on is fine; only render the toggle for e2e/visual.
  const autorunToggle = renderAutorunToggle(tier, report);
  return `
    <details class="tier ${running ? 'is-running' : ''} ${tier.stale && !running ? 'is-stale' : ''}" data-id="${escapeHtml(id)}" ${isOpen ? 'open' : ''}>
      <summary>
        ${runBadge}
        ${staleBadge}
        ${passBadge}
        <h2>${escapeHtml(tier.label)}</h2>
        ${autorunToggle}
        <span class="tier-counts">
          <span class="text-success">${t.passed} passed</span>
          ${t.failed > 0 ? `<span class="text-error"> · ${t.failed} failed</span>` : ''}
          ${t.skipped > 0 ? `<span class="text-muted"> · ${t.skipped} skipped</span>` : ''}
        </span>
        <span class="tier-duration mono">${fmtDuration(tier.durationMs)}</span>
        ${runButton}
        <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy a token-efficient summary of this tier for pasting into an LLM">Copy for LLM</button>
      </summary>
      ${currentTest}
      <div class="suite-list">
        ${tier.suites.map((s) => renderSuite(report, tier, s)).join('')}
      </div>
    </details>
  `;
}

function renderFailureFocusList(report) {
  const failures = [];
  for (const tier of report.tiers) {
    if (!tier.suites) continue;
    for (const suite of tier.suites) {
      for (const test of suite.tests) {
        if (test.status === 'failed') failures.push({ tier, suite, test });
      }
    }
  }
  if (failures.length === 0) return '';
  const items = failures
    .map(({ tier, suite, test }) => {
      const payload = escapeHtml(copyPayloadForFailure(report, tier, suite, test));
      return `
        <li class="focus-item">
          <div class="focus-head">
            <span class="badge badge-fail">FAIL</span>
            <span class="mono focus-suite">${escapeHtml(suite.name)}</span>
            <button type="button" class="copy-btn" data-copy-payload="${payload}" title="Copy this single failure for pasting into an LLM">Copy for LLM</button>
          </div>
          <div class="focus-test">${escapeHtml(test.fullName)}</div>
          <pre class="failure">${escapeHtml((test.failureMessages ?? []).join('\n\n'))}</pre>
        </li>
      `;
    })
    .join('');
  return `
    <section class="focus">
      <h2>Failures · ${failures.length}</h2>
      <ul class="focus-list">${items}</ul>
    </section>
  `;
}

// ---- Top-level template ----

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Condensed:wght@500;600;700&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400..700,0..1,-25..200" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.min.css" rel="stylesheet">
`;

const STYLES = /* css */ `
:root {
  --bg-base: #0d0d12;
  --bg-surface: #14141d;
  --bg-elevated: #1c1c28;
  --bg-deep: #07070b;

  --line: #2a2a3a;
  --line-soft: #1d1d28;

  --ink-primary: #e8e6df;
  --ink-secondary: #8a8aa0;
  --ink-muted: #54546a;
  --ink-faint: #36364a;

  /* Forge brand purple — matches packages/renderer/src/styles.scss --accent */
  --accent: #7c6ef6;
  --accent-light: #9b8ff8;
  --accent-soft: rgba(124, 110, 246, 0.12);
  --accent-line: rgba(124, 110, 246, 0.40);

  --pass: #7ed957;
  --fail: #ff5e5e;
  --warn: #f0b94a;
  --info: #5fb4d6;

  --engine-mssql: #5fb4d6;
  --engine-postgres: #52a3a8;
  --engine-postgres-private: #3d7a7e;
  --engine-mysql: #e2925b;
  --engine-bastion: #7ed957;
  --engine-other: #8a8aa0;

  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --font-condensed: 'IBM Plex Sans Condensed', 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'JetBrains Mono', ui-monospace, 'Menlo', monospace;

  --space-1: 2px;
  --space-2: 4px;
  --space-3: 8px;
  --space-4: 12px;
  --space-5: 16px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* Native <details> open/close animation. interpolate-size is what makes
   block-size: auto actually animate; ::details-content is the content
   slot Chromium exposes so we can animate it without JS. Both supported
   in Chromium 131+ (Electron 41 → Chromium ~134 — well covered). */
:root { interpolate-size: allow-keywords; }
::details-content {
  block-size: 0;
  overflow: clip;
  transition:
    block-size 220ms cubic-bezier(0.4, 0, 0.2, 1),
    content-visibility 220ms cubic-bezier(0.4, 0, 0.2, 1) allow-discrete;
}
details[open]::details-content { block-size: auto; }

html, body {
  background: var(--bg-base);
  color: var(--ink-primary);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'tnum' on, 'ss01' on;
}

body {
  min-height: 100vh;
  position: relative;
  background:
    radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(124, 110, 246, 0.06), transparent 60%),
    radial-gradient(ellipse 800px 600px at 50% 110%, rgba(95, 180, 214, 0.025), transparent 60%),
    var(--bg-base);
  padding: var(--space-7) var(--space-6);
}

/* CRT scanlines — subtle */
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 2px,
    rgba(0, 0, 0, 0.16) 2px,
    rgba(0, 0, 0, 0.16) 3px
  );
  opacity: 0.32;
  mix-blend-mode: multiply;
  z-index: 1;
}

/* Noise grain */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1, 0 0 0 0 1, 0 0 0 0 1, 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.5;
  z-index: 2;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  position: relative;
  z-index: 3;
  animation: fadeUp 0.5s ease-out both;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.mono { font-family: var(--font-mono); }
.text-muted { color: var(--ink-muted); }
.text-secondary { color: var(--ink-secondary); }
.text-success { color: var(--pass); }
.text-warning { color: var(--warn); }
.text-error { color: var(--fail); }

pre {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-deep);
  color: var(--ink-primary);
  padding: var(--space-3) var(--space-4);
  border-radius: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

/* HEADER ─────────────────────────────────────────────── */
.header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: end;
  gap: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--space-6);
}

.header h1 {
  font-family: var(--font-condensed);
  font-weight: 700;
  font-size: 30px;
  line-height: 1;
  letter-spacing: -0.015em;
  text-transform: uppercase;
  color: var(--ink-primary);
}

.header h1 .accent {
  color: var(--accent);
  position: relative;
}

.header h1 .accent::after {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  background: var(--accent);
  margin-left: 6px;
  vertical-align: 6px;
  animation: blink 1.4s steps(2) infinite;
}
@keyframes blink {
  50% { opacity: 0.25; }
}

.header-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  display: grid;
  grid-template-columns: auto auto;
  gap: var(--space-2) var(--space-4);
  align-items: center;
  color: var(--ink-secondary);
  text-align: right;
}

.header-meta .label {
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 9px;
  text-align: right;
}

.header-meta .value {
  color: var(--ink-primary);
  text-align: right;
  word-break: break-all;
}

.header-meta .value.dirty { color: var(--warn); }

/* LIVE BANNER ────────────────────────────────────────── */
.live-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--ink-secondary);
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: heartbeat 1.5s ease-in-out infinite;
}
.live-dot.disconnected {
  background: var(--fail);
  animation: none;
}
@keyframes heartbeat {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-line); opacity: 1; }
  50%      { box-shadow: 0 0 0 4px transparent; opacity: 0.4; }
}

/* HERO ─────────────────────────────────────────────── */
.hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: var(--space-7);
}

.counter {
  position: relative;
  padding: var(--space-5) var(--space-4);
  text-align: center;
}

.counter + .counter::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--line);
}

.counter-num {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 46px;
  line-height: 0.95;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
}
.counter.is-pass .counter-num { color: var(--pass); }
.counter.is-fail .counter-num { color: var(--fail); }
.counter.is-skip .counter-num { color: var(--warn); }

.counter-label {
  margin-top: var(--space-3);
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

/* SYNOPSIS ───────────────────────────────────────────── */
.synopsis {
  font-family: var(--font-sans);
  font-style: italic;
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-primary);
  padding: 0 var(--space-7) var(--space-6);
  margin-bottom: var(--space-6);
  border-bottom: 1px dashed var(--line);
  text-align: center;
}
.synopsis::before { content: '“'; color: var(--accent); margin-right: 4px; font-size: 22px; vertical-align: -3px; font-style: normal; }
.synopsis::after  { content: '”'; color: var(--accent); margin-left: 4px;  font-size: 22px; vertical-align: -3px; font-style: normal; }

/* SECTION LABELS ─────────────────────────────────────── */
.section-label {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.24em;
  color: var(--ink-muted);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.section-label > span:first-child { color: var(--ink-secondary); }
.section-line {
  flex: 1;
  height: 1px;
  background: var(--line);
  align-self: center;
  /* Reset the section-label's mono ALL-CAPS treatment that would apply to plain spans. */
}
.section-label .meta-readout {
  font-family: var(--font-mono);
  font-weight: 400;
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ink-muted);
  text-transform: uppercase;
}
.section-controls {
  display: flex;
  gap: var(--space-2);
}

/* INFRASTRUCTURE ─────────────────────────────────────── */
.infra {
  margin-bottom: var(--space-7);
}

.infra-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-3);
}

.infra-card {
  position: relative;
  padding: var(--space-4);
  background: linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-deep) 130%);
  border: 1px solid var(--line);
  border-top: 2px solid var(--engine, var(--ink-muted));
  display: grid;
  grid-template-rows: auto auto auto auto;
  gap: var(--space-3);
  font-family: var(--font-mono);
  overflow: hidden;
  /* Smooth ghost→live transition when a container starts during a session
     (data-state changes from "down" to "running"). */
  transition: opacity 0.4s ease, filter 0.4s ease, background 0.4s ease;
}

.infra-top {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
}

/* Brand icon — devicon glyph, sized prominently */
.infra-card .brand-icon {
  font-size: 22px;
  line-height: 1;
  color: var(--engine, var(--ink-secondary));
  flex-shrink: 0;
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
}
/* Devicon ships its own colors per .devicon-X-plain selector — override
   so we tint by our engine variable for visual coherence. */
.infra-card [class^="devicon-"]::before { color: inherit; }

.infra-id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.infra-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ink-muted);
  flex-shrink: 0;
}
.infra-card[data-state="running"] .infra-state-dot {
  background: var(--engine, var(--pass));
  animation: dotPulse 2s ease-in-out infinite;
}

/* Ghost / down state — container is expected (per docker-compose) but not
   currently running. Card stays in the grid as a desaturated outline so the
   user can see WHAT will be there once docker is up, not just empty space.
   When the real container appears, data-state changes off "down" and the
   ghost styling drops away — surgical update path handles the promotion in
   place via matching data-id. */
.infra-card[data-state="down"] {
  opacity: 0.42;
  filter: grayscale(0.85);
  background: rgba(255, 255, 255, 0.015);
  box-shadow: none;
}
.infra-card[data-state="down"] .infra-state-dot {
  background: var(--ink-muted);
  animation: none;
  box-shadow: none;
}
.infra-card[data-state="down"]:hover {
  opacity: 0.6;
  filter: grayscale(0.6);
}
@keyframes dotPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--engine, var(--pass)); }
  50%      { box-shadow: 0 0 0 4px transparent; }
}

.infra-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-primary);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.infra-role {
  font-size: 9px;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.infra-cpu {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: end;
  gap: var(--space-3);
}

.infra-cpu-num {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 30px;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
  letter-spacing: -0.02em;
}

.infra-cpu-num .unit {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-muted);
  margin-left: 2px;
  font-weight: 400;
}

.infra-spark {
  width: 100%;
  height: 28px;
  display: block;
  align-self: end;
}
.infra-spark path {
  fill: none;
  stroke: var(--engine, var(--accent));
  stroke-width: 1.25;
  stroke-linejoin: round;
  stroke-linecap: round;
  opacity: 0.85;
}
.infra-spark .area {
  fill: var(--engine, var(--accent));
  opacity: 0.10;
  stroke: none;
}

.infra-mem {
  display: grid;
  gap: 4px;
  font-size: 10px;
  color: var(--ink-secondary);
}
.infra-mem .mem-row {
  display: flex;
  justify-content: space-between;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.infra-mem .mem-unit { color: var(--ink-muted); }
.infra-mem-bar {
  height: 3px;
  background: var(--line-soft);
  position: relative;
  overflow: hidden;
}
.infra-mem-bar > span {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--engine, var(--info));
  width: var(--pct, 0%);
  transition: width 0.6s ease;
}

.infra-empty, .infra-error {
  padding: var(--space-5);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-secondary);
  border: 1px dashed var(--line);
  text-align: center;
  letter-spacing: 0.06em;
}
.infra-error { color: var(--fail); border-color: var(--fail); }

[data-engine="mssql"]            { --engine: var(--engine-mssql); }
[data-engine="postgres"]         { --engine: var(--engine-postgres); }
[data-engine="postgres-private"] { --engine: var(--engine-postgres-private); }
[data-engine="mysql"]            { --engine: var(--engine-mysql); }
[data-engine="bastion"]          { --engine: var(--engine-bastion); }

/* TIER SECTIONS ──────────────────────────────────────── */
.tier {
  background: var(--bg-surface);
  border: 1px solid var(--line);
  margin-bottom: var(--space-3);
}
.tier > summary {
  list-style: none;
  cursor: pointer;
  padding: var(--space-4) var(--space-5);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.tier > summary::-webkit-details-marker { display: none; }
.tier > summary::before {
  content: '+';
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: 16px;
  width: 14px;
  text-align: center;
}
.tier[open] > summary::before { content: '−'; color: var(--accent); }
.tier:hover > summary { background: rgba(124, 110, 246, 0.04); }

.tier h2 {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
  color: var(--ink-primary);
}

.tier.is-running { border-left: 2px solid var(--accent); }
.tier-counts { font-family: var(--font-mono); font-size: 11px; }
.tier-counts .text-success { color: var(--pass); }
.tier-counts .text-error { color: var(--fail); }
.tier-counts .text-muted { color: var(--ink-muted); }
.tier-duration { font-family: var(--font-mono); font-size: 10px; color: var(--ink-muted); }

.tier-pending {
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  border: 1px solid var(--line);
  margin-bottom: var(--space-3);
  opacity: 0.65;
}
.tier-pending .tier-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.tier-pending h2 {
  font-family: var(--font-condensed);
  font-weight: 600;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  flex: 1;
  color: var(--ink-secondary);
}
.tier-note {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-muted);
  letter-spacing: 0.02em;
}

.tier-current {
  padding: 0 var(--space-5) var(--space-3);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-secondary);
  word-break: break-word;
}

.suite-list {
  padding: 0 var(--space-5) var(--space-4);
}

.suite {
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  margin-top: var(--space-3);
}
.suite > summary {
  list-style: none;
  cursor: pointer;
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.suite > summary::-webkit-details-marker { display: none; }
.suite > summary::before {
  content: '›';
  color: var(--ink-muted);
  font-family: var(--font-mono);
  width: 10px;
  font-size: 14px;
  transition: transform 0.18s ease;
}
.suite[open] > summary::before { transform: rotate(90deg); color: var(--accent); }
.suite:hover > summary { background: rgba(124, 110, 246, 0.04); }
.suite.is-running { border-left: 2px solid var(--accent); }

.suite-name { font-family: var(--font-mono); font-size: 11px; flex: 1; word-break: break-all; color: var(--ink-primary); }
.suite-summary { font-family: var(--font-mono); font-size: 10px; }
.suite-summary.text-error { color: var(--fail); }
.suite-summary.text-muted { color: var(--ink-muted); }
.suite-duration { font-family: var(--font-mono); font-size: 10px; color: var(--ink-muted); }

.test-list { list-style: none; padding: var(--space-3) var(--space-5); }
.test {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  font-size: 12px;
  font-family: var(--font-mono);
}
.test-name { word-break: break-word; color: var(--ink-secondary); }
.test-failed .test-name { color: var(--fail); font-weight: 600; }
.test-skipped .test-name { color: var(--ink-muted); }
.test-duration { color: var(--ink-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.test .failure {
  grid-column: 1 / -1;
  margin-top: var(--space-2);
  border-left: 2px solid var(--fail);
  padding: var(--space-3);
  font-size: 11px;
  background: rgba(255, 94, 94, 0.04);
  color: var(--ink-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* FAILURE FOCUS ──────────────────────────────────────── */
.focus {
  background: linear-gradient(180deg, rgba(255, 94, 94, 0.07), rgba(255, 94, 94, 0.01));
  border: 1px solid var(--fail);
  padding: var(--space-5);
  margin-bottom: var(--space-6);
  position: relative;
}
.focus::before {
  content: 'CRIT';
  position: absolute;
  top: -8px;
  left: 16px;
  background: var(--bg-base);
  color: var(--fail);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  padding: 0 var(--space-2);
}
.focus h2 {
  font-family: var(--font-condensed);
  font-weight: 700;
  color: var(--fail);
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: var(--space-4);
}
.focus-list { list-style: none; }
.focus-item + .focus-item { margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--line); }
.focus-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.focus-suite { font-size: 11px; color: var(--ink-secondary); }
.focus-test { font-weight: 600; font-family: var(--font-mono); font-size: 12px; margin: var(--space-2) 0; color: var(--ink-primary); word-break: break-word; }
.focus .failure {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-deep);
  border-left: 2px solid var(--fail);
  padding: var(--space-3);
  color: var(--ink-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* BADGES ─────────────────────────────────────────────── */
.badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  padding: 3px 7px;
  text-transform: uppercase;
  line-height: 1.4;
  display: inline-block;
}
.badge-pass    { background: rgba(126, 217, 87, 0.13);  color: var(--pass); }
.badge-fail    { background: rgba(255, 94, 94, 0.16);   color: var(--fail); }
.badge-skip    { background: rgba(240, 185, 74, 0.14);  color: var(--warn); }
.badge-pending { background: rgba(95, 180, 214, 0.12);  color: var(--info); }
.badge-running {
  background: rgba(124, 110, 246, 0.18);
  color: var(--accent-light, var(--accent));
  animation: phosphorPulse 1.6s ease-in-out infinite;
}
@keyframes phosphorPulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.5; }
}

/* STALE — files changed since the last run, displayed result may be out of
   date. Diagonal-stripe amber fill so it reads as "marked for re-verification"
   without screaming "fail". */
.badge-stale {
  background: repeating-linear-gradient(
    45deg,
    rgba(240, 185, 74, 0.18) 0,
    rgba(240, 185, 74, 0.18) 4px,
    rgba(240, 185, 74, 0.06) 4px,
    rgba(240, 185, 74, 0.06) 8px
  );
  color: var(--warn);
  border: 1px solid rgba(240, 185, 74, 0.5);
  padding: 2px 5px;
}
.tier.is-stale .tier-counts,
.tier.is-stale .tier-duration { opacity: 0.55; }
.tier.is-stale > summary::before { color: var(--warn); }

/* Run All — sits in the live banner, pushed to the right. */
.ctrl-run-all { margin-left: auto; }

/* CONTROL BUTTONS ────────────────────────────────────── */

/* Copy-for-LLM — secondary, ghost-treatment so it doesn't compete with Run */
.copy-btn {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  padding: 4px 10px;
  background: transparent;
  color: var(--ink-secondary);
  border: 1px solid var(--line);
  cursor: pointer;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  transition: color 0.15s ease, border-color 0.15s ease, background-color 0.15s ease;
}
.copy-btn:hover {
  color: var(--ink-primary);
  border-color: var(--ink-secondary);
}
.copy-btn.copied {
  color: var(--pass);
  border-color: var(--pass);
}
.copy-btn:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }

/* Material Symbols Outlined — base setup */
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined', sans-serif;
  font-weight: normal;
  font-style: normal;
  font-size: 18px;
  line-height: 1;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings: 'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24;
}

/* Run / Reset — primary controls. Real instrument-panel buttons. */
.ctrl-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  border: 1px solid transparent;
  transition:
    background 0.18s ease,
    color 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.18s ease,
    transform 0.08s ease;
}
.ctrl-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.ctrl-btn .ctrl-label { display: inline-block; }
.ctrl-btn .ctrl-icon { font-size: 16px; }
/* The native [hidden] attribute is meant to hide the element, but our
   .ctrl-btn rule sets display:inline-flex at the same specificity as the
   UA's [hidden]{display:none}, so the custom rule wins and the button
   stays visible. Force it explicitly. */
.ctrl-btn[hidden] { display: none !important; }

/* Run — Forge brand purple, primary action. Material play_arrow icon. */
.ctrl-run {
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 12px 5px 8px;
  background: var(--accent);
  color: #ffffff;
  border-color: var(--accent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.20),
    0 1px 2px rgba(0, 0, 0, 0.45);
}
.ctrl-run:hover {
  background: var(--accent-light, #9b8ff8);
  border-color: var(--accent-light, #9b8ff8);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 1px 2px rgba(0, 0, 0, 0.45),
    0 0 18px rgba(124, 110, 246, 0.55);
}
.ctrl-run:active {
  transform: translateY(1px);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.30),
    0 0 0 transparent;
}

/* Slot wrapper — always rendered (even on tiers without a switch) so the
   downstream [counts][duration][Run][Copy] cluster sits at the same x-offset
   across all four tiers. Width chosen to fit "Watch ◯" comfortably without
   wrapping; right-aligned so the switch hugs the counts column. */
.autorun-slot {
  display: inline-flex;
  justify-content: flex-end;
  align-items: center;
  min-width: 64px;
}

/* Auto-rerun switch — physical-feeling toggle with a sliding thumb. The
   track + thumb communicate state; the label just says what it controls.
   ON = accent-purple track + thumb on the right; OFF = muted track + thumb
   on the left. Cushioned 0.18s spring so the flick reads as deliberate. */
.autorun-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 2px 6px;
  background: transparent;
  border: 0;
  cursor: pointer;
  /* Sized to match the .copy-btn sibling so the row reads as a balanced
     cluster of secondary controls — not Watch shouting alongside a quiet
     Copy. Same font family/size/weight/case as Copy for LLM. */
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--ink-muted);
  transition: color 0.15s;
}
.autorun-toggle:hover { color: var(--ink-secondary); }
.autorun-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 3px; }
.autorun-toggle:disabled { cursor: progress; opacity: 0.6; }
.autorun-label { white-space: nowrap; }

.autorun-track {
  position: relative;
  display: inline-block;
  width: 28px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--line);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.40);
  transition: background 0.18s, border-color 0.18s, box-shadow 0.18s;
}
.autorun-thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--ink-muted);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.18s;
}
.autorun-toggle[aria-checked="true"] .autorun-track {
  background: rgba(124, 110, 246, 0.55);
  border-color: var(--accent);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.30),
    0 0 8px rgba(124, 110, 246, 0.35);
}
.autorun-toggle[aria-checked="true"] .autorun-thumb {
  background: #ffffff;
  transform: translateX(12px);
}
.autorun-toggle[aria-checked="true"] { color: var(--accent); }
.autorun-toggle[aria-checked="true"]:hover .autorun-track {
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.30),
    0 0 12px rgba(124, 110, 246, 0.55);
}
.autorun-toggle:active .autorun-thumb { transform: scale(0.92) translateX(0); }
.autorun-toggle[aria-checked="true"]:active .autorun-thumb { transform: scale(0.92) translateX(12px); }

/* Disabled Run — when a run is in flight for a non-cancelable tier
   (vitest's watcher doesn't expose mid-run abort). Receded but still
   readable so it's clear *which* button is the Run for that suite. */
.ctrl-run:disabled {
  cursor: not-allowed;
  opacity: 0.32;
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: none;
}
.ctrl-run:disabled:hover { background: var(--accent); border-color: var(--accent); box-shadow: none; }

/* Cancel — replaces Run for cancelable tiers (e2e/visual) while their
   one-shot Playwright child is alive. Outline-only red instead of a solid
   block: the action is destructive but it shouldn't shout — it's not an
   alert, it's an option. Filled treatment is reserved for hover/active. */
.ctrl-cancel {
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 12px 5px 8px;
  background: transparent;
  color: var(--fail);
  border-color: var(--fail);
  box-shadow: none;
}
.ctrl-cancel:hover {
  background: rgba(255, 94, 94, 0.10);
  color: #ff7575;
  border-color: #ff7575;
  box-shadow: 0 0 10px rgba(255, 94, 94, 0.28);
}
.ctrl-cancel:active {
  transform: translateY(1px);
  background: rgba(255, 94, 94, 0.16);
  box-shadow: 0 0 0 transparent;
}

/* Harness controls (Up / Down / Reset) — ghost buttons with role-tinted
   hover. They share size + typography so they read as a control cluster. */
.ctrl-up, .ctrl-down, .ctrl-reset {
  font-size: 10px;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  padding: 5px 11px 5px 8px;
  background: transparent;
  color: var(--ink-muted);
  border-color: var(--line);
}
.ctrl-up .ctrl-icon, .ctrl-down .ctrl-icon, .ctrl-reset .ctrl-icon {
  font-size: 14px;
  transition: transform 0.5s ease;
}

.ctrl-up:hover {
  color: var(--pass);
  border-color: var(--pass);
  background: rgba(126, 217, 87, 0.10);
  box-shadow: 0 0 10px rgba(126, 217, 87, 0.28);
}
.ctrl-down:hover {
  color: var(--fail);
  border-color: var(--fail);
  background: rgba(255, 94, 94, 0.10);
  box-shadow: 0 0 10px rgba(255, 94, 94, 0.30);
}
.ctrl-reset:hover {
  color: var(--warn);
  border-color: var(--warn);
  background: rgba(240, 185, 74, 0.10);
  box-shadow: 0 0 10px rgba(240, 185, 74, 0.28);
}
.ctrl-reset:hover .ctrl-icon { transform: rotate(360deg); }

.ctrl-up:active, .ctrl-down:active, .ctrl-reset:active { transform: translateY(1px); }

/* In-flight state for harness controls — applied by applyHarnessButton when
   the SSE infra payload reports activeOp matching this button's role. The
   button stays disabled (so the user can't double-click) but visibly *busy*
   via a slow pulsing accent border + role-tinted icon. Distinct from the
   plain disabled state below (no-op buttons), which just recedes. */
.ctrl-up.is-working, .ctrl-down.is-working, .ctrl-reset.is-working {
  cursor: progress;
  opacity: 1;
  pointer-events: none;
}
.ctrl-up.is-working { color: var(--pass); border-color: var(--pass); }
.ctrl-down.is-working { color: var(--fail); border-color: var(--fail); }
.ctrl-reset.is-working { color: var(--warn); border-color: var(--warn); }
.ctrl-up.is-working,
.ctrl-down.is-working,
.ctrl-reset.is-working {
  animation: ctrl-working-pulse 1.4s ease-in-out infinite;
}
.ctrl-up.is-working .ctrl-icon,
.ctrl-down.is-working .ctrl-icon,
.ctrl-reset.is-working .ctrl-icon {
  animation: ctrl-working-spin 1.4s linear infinite;
  transform-origin: 50% 50%;
}
@keyframes ctrl-working-pulse {
  0%, 100% { box-shadow: 0 0 0 transparent; }
  50%      { box-shadow: 0 0 14px currentColor; }
}
@keyframes ctrl-working-spin {
  to { transform: rotate(360deg); }
}

/* Disabled state for harness controls — when the action would be a no-op
   (Up while already up, Down while nothing is running) the button visually
   recedes and stops responding to hover. is-working overrides this: a busy
   button is *also* disabled but should not look greyed out. */
.ctrl-up[disabled]:not(.is-working),
.ctrl-down[disabled]:not(.is-working),
.ctrl-reset[disabled]:not(.is-working) {
  cursor: not-allowed;
  opacity: 0.35;
  pointer-events: none;
  background: transparent;
  border-color: var(--line-soft);
  color: var(--ink-faint);
  box-shadow: none;
  transform: none;
}

/* Busy state — replaces the icon with a spinning ring + pulses the button */
.ctrl-btn.is-busy {
  cursor: progress;
  animation: ctrlPulse 1.4s ease-in-out infinite;
}
.ctrl-btn.is-busy .ctrl-icon { display: none; }
.ctrl-btn.is-busy::before {
  content: '';
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 1.6px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ctrlSpin 0.9s linear infinite;
}
.ctrl-btn[disabled] { pointer-events: none; }
.ctrl-btn.is-error {
  color: var(--fail);
  border-color: var(--fail);
  background: rgba(255, 94, 94, 0.10);
  box-shadow: none;
  animation: none;
}
.ctrl-run.is-error { background: rgba(255, 94, 94, 0.18); }
@keyframes ctrlSpin  { to { transform: rotate(360deg); } }
@keyframes ctrlPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }

/* FOOTER ─────────────────────────────────────────────── */
.footer {
  margin-top: var(--space-7);
  padding-top: var(--space-5);
  border-top: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ink-muted);
  text-transform: uppercase;
  text-align: center;
}

/* VISUAL THUMBNAILS ──────────────────────────────────── */
.visual-row {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: 1px dashed var(--line);
}
.visual-thumb {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  background: var(--bg-deep);
  border: 1px solid var(--line);
  cursor: zoom-in;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
  overflow: hidden;
  min-width: 0;
}
.visual-thumb img {
  display: block;
  width: 200px;
  max-height: 130px;
  object-fit: cover;
  object-position: top center;
  background: var(--bg-deep);
}
.visual-thumb-label {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 4px 8px 6px;
  text-align: left;
}
.visual-thumb:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}
.visual-thumb:hover .visual-thumb-label { color: var(--accent); }
.visual-thumb-fail { border-color: rgba(255, 94, 94, 0.4); }
.visual-thumb-fail .visual-thumb-label { color: var(--fail); }
.visual-thumb-fail:hover { border-color: var(--fail); }
.visual-thumb-fail:hover .visual-thumb-label { color: var(--fail); }

/* LIGHTBOX ───────────────────────────────────────────── */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  cursor: zoom-out;
  animation: modalFadeIn 0.18s ease;
}
.lightbox[hidden] { display: none !important; }
.lightbox-frame {
  position: relative;
  max-width: 92vw;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}
.lightbox-img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  border: 1px solid var(--line);
  background: var(--bg-deep);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}
.lightbox-caption {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-secondary);
}
.lightbox-close {
  position: absolute;
  top: -38px;
  right: 0;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--ink-muted);
  color: var(--ink-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 16px;
  line-height: 1;
  transition: all 0.15s ease;
}
.lightbox-close:hover { color: var(--accent); border-color: var(--accent); }

/* MODAL ──────────────────────────────────────────────── */
.modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: modalFadeIn 0.18s ease;
}
.modal[hidden] { display: none !important; }
.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}
.modal-card {
  position: relative;
  z-index: 1;
  background: var(--bg-elevated);
  border: 1px solid var(--line);
  border-top: 2px solid var(--accent);
  padding: var(--space-6) var(--space-6) var(--space-5);
  min-width: 360px;
  max-width: 540px;
  margin: var(--space-5);
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
  animation: modalSlideIn 0.22s ease;
}
.modal-card[data-tone="danger"] { border-top-color: var(--fail); }
.modal-card[data-tone="warn"]   { border-top-color: var(--warn); }
.modal-title {
  font-family: var(--font-condensed);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-primary);
  margin-bottom: var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.modal-card[data-tone="danger"] .modal-title { color: var(--fail); }
.modal-card[data-tone="warn"]   .modal-title { color: var(--warn); }
.modal-title .material-symbols-outlined {
  font-size: 20px;
  font-variation-settings: 'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24;
}
.modal-body {
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-primary);
  margin-bottom: var(--space-5);
}
.modal-actions {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
}
.ctrl-modal-cancel,
.ctrl-modal-confirm {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 11px;
  padding: 6px 16px;
  border: 1px solid var(--line);
  background: transparent;
  cursor: pointer;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  transition: all 0.15s ease;
}
.ctrl-modal-cancel { color: var(--ink-secondary); }
.ctrl-modal-cancel:hover { color: var(--ink-primary); border-color: var(--ink-secondary); }
.ctrl-modal-confirm {
  background: var(--accent);
  color: var(--bg-deep);
  border-color: var(--accent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.modal-card[data-tone="danger"] .ctrl-modal-confirm {
  background: var(--fail);
  border-color: var(--fail);
}
.modal-card[data-tone="warn"] .ctrl-modal-confirm {
  background: var(--warn);
  border-color: var(--warn);
}
.ctrl-modal-confirm:hover {
  filter: brightness(1.10);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.28),
    0 0 14px var(--accent-line);
}
.modal-card[data-tone="danger"] .ctrl-modal-confirm:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 14px rgba(255, 94, 94, 0.45); }
.modal-card[data-tone="warn"]   .ctrl-modal-confirm:hover { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 0 14px rgba(240, 185, 74, 0.45); }
.ctrl-modal-confirm:active, .ctrl-modal-cancel:active { transform: translateY(1px); }

@keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes modalSlideIn { from { opacity: 0; transform: translateY(-12px) scale(0.985); } to { opacity: 1; transform: none; } }

/* LIGHT THEME ────────────────────────────────────────── */
@media (prefers-color-scheme: light) {
  :root {
    --bg-base: #faf8f1;
    --bg-surface: #f1eee2;
    --bg-elevated: #ffffff;
    --bg-deep: #ece8d9;

    --line: #d6d1bf;
    --line-soft: #e6e2d2;

    --ink-primary: #1a1a24;
    --ink-secondary: #555570;
    --ink-muted: #8a8aa0;
    --ink-faint: #c0c0c8;

    --accent: #6356e0;
    --accent-light: #7c6ef6;
    --accent-soft: rgba(99, 86, 224, 0.10);
    --accent-line: rgba(99, 86, 224, 0.35);

    --pass: #16a34a;
    --fail: #dc2626;
    --warn: #d97706;
    --info: #2563eb;

    --engine-mssql: #2563eb;
    --engine-postgres: #0f766e;
    --engine-postgres-private: #0c5358;
    --engine-mysql: #c2410c;
    --engine-bastion: #15803d;
    --engine-other: #555570;
  }

  body {
    background:
      radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(99, 86, 224, 0.06), transparent 60%),
      radial-gradient(ellipse 800px 600px at 50% 110%, rgba(37, 99, 235, 0.03), transparent 60%),
      var(--bg-base);
  }
  /* Tone scanlines + grain way down on light bg — they read as dirt instead of CRT */
  body::before { opacity: 0.08; mix-blend-mode: multiply; }
  body::after  { opacity: 0.18; }

  pre { background: var(--bg-deep); }

  .focus { background: linear-gradient(180deg, rgba(220, 38, 38, 0.05), rgba(220, 38, 38, 0.005)); }
  .focus::before { background: var(--bg-base); }
  .focus .failure { background: var(--bg-deep); }
}

/* RESPONSIVE ─────────────────────────────────────────── */
@media (max-width: 760px) {
  body { padding: var(--space-5) var(--space-4); }
  .header { grid-template-columns: 1fr; gap: var(--space-3); }
  .header h1 { font-size: 22px; }
  .header-meta { text-align: left; grid-template-columns: auto 1fr; gap: 2px var(--space-3); }
  .header-meta .label, .header-meta .value { text-align: left; }
  .hero { grid-template-columns: repeat(2, 1fr); }
  .counter-num { font-size: 32px; }
  .counter + .counter:nth-child(3)::before { display: none; }
  .synopsis { padding: 0 0 var(--space-5); font-size: 14px; }
  .copy-btn { flex-basis: 100%; margin-left: 0; margin-top: var(--space-2); text-align: center; }
  .infra-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 420px) {
  .counter-num { font-size: 26px; }
  .header h1 { font-size: 18px; }
  .infra-grid { grid-template-columns: 1fr; }
}
`;

// Lightbox markup + JS — used by both the live dashboard and the static
// report. Click any .visual-thumb to open it; ESC or backdrop-click to close.
const LIGHTBOX_HTML = `
<div id="lightbox" class="lightbox" hidden role="dialog" aria-modal="true" aria-hidden="true">
  <div class="lightbox-frame">
    <button type="button" class="lightbox-close" aria-label="Close">×</button>
    <img class="lightbox-img" alt="" />
    <span class="lightbox-caption"></span>
  </div>
</div>`;

const LIGHTBOX_SCRIPT = /* javascript */ `
(() => {
  const lightbox = document.getElementById('lightbox');
  if (!lightbox) return;
  const lightboxImg = lightbox.querySelector('.lightbox-img');
  const lightboxCaption = lightbox.querySelector('.lightbox-caption');
  const lightboxClose = lightbox.querySelector('.lightbox-close');
  function openLightbox(src, label) {
    lightboxImg.src = src;
    lightboxImg.alt = label || '';
    lightboxCaption.textContent = label || '';
    lightbox.hidden = false;
    lightbox.setAttribute('aria-hidden', 'false');
    document.addEventListener('keydown', lightboxKeydown, true);
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lightbox.setAttribute('aria-hidden', 'true');
    lightboxImg.removeAttribute('src');
    document.removeEventListener('keydown', lightboxKeydown, true);
  }
  function lightboxKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
  }
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightboxImg) return;
    closeLightbox();
  });
  lightboxClose.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
  document.addEventListener('click', (event) => {
    const thumb = event.target.closest('.visual-thumb');
    if (!thumb) return;
    event.preventDefault();
    event.stopPropagation();
    openLightbox(thumb.dataset.lightboxSrc, thumb.dataset.lightboxLabel);
  });
  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('.visual-thumb')) event.stopPropagation();
  }, true);
})();
`;

const SCRIPT = /* javascript */ `
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); resolve(); }
    catch (err) { reject(err); }
    finally { document.body.removeChild(ta); }
  });
}

document.addEventListener('click', (event) => {
  const btn = event.target.closest('.copy-btn');
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();
  const payload = btn.dataset.copyPayload || '';
  copyToClipboard(payload).then(() => {
    const original = btn.textContent;
    btn.classList.add('copied');
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = original; }, 1500);
  }).catch((err) => {
    btn.textContent = 'Copy failed';
    console.error('clipboard copy failed:', err);
  });
});

document.addEventListener('mousedown', (event) => {
  if (event.target.closest('.copy-btn')) event.stopPropagation();
}, true);
`;

export function renderReportBody(report) {
  // Note: infrastructure is intentionally rendered separately by the live
  // dashboard so its 2s polls don't trigger a full body remount (which would
  // collapse open <details> and reset CSS animations). Static reports don't
  // include infra at all.
  return `
    ${renderHero(report)}
    <p class="synopsis">${escapeHtml(buildSynopsis(report))}</p>
    ${renderFailureFocusList(report)}
    ${report.tiers.map((t) => renderTier(report, t)).join('')}
  `;
}

export function renderReportHtml(report) {
  const dirtyMark = report.git.dirty ? '<span class="value dirty">·dirty</span>' : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Forge — regression report (${escapeHtml(fmtTimestamp(report.startedAt))})</title>
${FONT_LINKS}
<style>${STYLES}</style>
</head>
<body>
<main>
  <header class="header">
    <h1><span class="accent">Forge</span> Regression Report</h1>
    <div class="header-meta">
      <span class="label">Repo</span>
      <span class="value">${escapeHtml(report.git.branch)}@${escapeHtml(report.git.commit)} ${dirtyMark}</span>
      <span class="label">Run</span>
      <span class="value">${escapeHtml(fmtTimestamp(report.startedAt))}</span>
    </div>
  </header>

  ${renderReportBody(report)}

  <footer class="footer">
    Generated by tests/reporter/build-report.mjs
  </footer>
</main>
${LIGHTBOX_HTML}
<script>${SCRIPT}</script>
<script>${LIGHTBOX_SCRIPT}</script>
</body>
</html>`;
}

export { STYLES, SCRIPT, FONT_LINKS, LIGHTBOX_HTML, LIGHTBOX_SCRIPT };
