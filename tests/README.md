# Forge Regression Test Harness

Three-tier test pyramid for catching regressions across all supported engines and the full Electron app.

| Tier           | Runner                  | Scope                             | Lives in                             |
| -------------- | ----------------------- | --------------------------------- | ------------------------------------ |
| 1. Unit        | Vitest                  | Pure logic, no I/O                | `packages/*/src/**/*.{test,spec}.ts` |
| 2. Integration | Vitest + Docker Compose | Real DBs, SSH tunnel, AI plumbing | `tests/integration/**`               |
| 3. E2E         | Playwright + Electron   | Functional E2E specs              | `tests/e2e/*.spec.ts`                |
| 4. Visual      | Playwright + Electron   | Pixel-diff baselines, macOS-only  | `tests/e2e/visual/**`                |

## Quick start

Two ways to run the suite. Pick by workflow:

### Live dashboard (for active dev)

```bash
pnpm run test:dashboard      # opens http://127.0.0.1:5188
```

Brings the harness up, runs `vitest --watch` for both tiers, and serves a live-updating dashboard. Edit code → vitest reruns affected tests → dashboard updates via Server-Sent Events. Per-file state is merged across runs so a single-file rerun doesn't blank out the rest of the suite.

Pair with `pnpm run dev` in another terminal so you have the app running and the test dashboard updating side-by-side. Ctrl+C to stop the watchers; Docker stays up.

### One-shot static report (for CI / agents / pre-release)

```bash
pnpm run test:full           # runs everything once, writes HTML, exits
```

Self-contained HTML report at `tests/reports/latest.html` (timestamped copy alongside). Reports are gitignored — local-only.

### Piecewise (manual)

```bash
pnpm run test                  # unit tier only (no infrastructure)
pnpm run test:harness:up       # start the Docker network
pnpm run test:integration      # run integration tier once
pnpm run test:harness:down     # tear down when done
```

## The report

`pnpm run test:full` produces a single self-contained HTML file styled to match Forge's purple-tinted theme.

- **Hero counters** — passed / failed / skipped / duration
- **Synopsis** — one-line business-language summary
- **Failure focus list** — every failed test surfaced at the top with full error + stack
- **Tier sections** — collapsible per-tier (Unit, Integration, E2E placeholder, Visual placeholder)
- **Suite sections** — collapsible per-spec-file with pass/fail counts
- **Copy for LLM** — every section has its own button. Click it on a failed test to grab a token-efficient markdown summary (file path, test name, git context, error + truncated stack) ready to paste into a Claude session along with your fix request.

## Available scripts

| Script                            | What it does                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `pnpm run test`                   | Unit tier only (no infrastructure required)                              |
| `pnpm run test:integration`       | Integration tier — requires harness up                                   |
| `pnpm run test:integration:watch` | Integration in watch mode for active dev                                 |
| `pnpm run test:full`              | All tiers + HTML report. Brings harness up automatically.                |
| `pnpm run test:dashboard`         | Live HTML dashboard at http://127.0.0.1:5188, vitest watch on both tiers |
| `pnpm run test:visual`            | Capture/compare visual regression baselines (one-shot)                   |
| `pnpm run test:visual:live`       | Same, but stream events to the dashboard                                 |
| `pnpm run test:visual:update`     | Re-capture all visual baselines (use after intentional UI changes)       |
| `pnpm run test:harness:up`        | Start docker-compose network, generate SSH keypair if needed             |
| `pnpm run test:harness:down`      | Stop network and remove volumes                                          |
| `pnpm run test:harness:status`    | Show compose service health                                              |

`test:full` accepts flags via `pnpm run test:full -- <flag>`:

- `--no-harness` skip the integration tier (unit-only run)
- `--teardown` tear the harness down at the end

## What's running in the test network

Defined in [`docker-compose.test.yml`](./docker-compose.test.yml). Host ports are deliberately non-standard so they don't clash with anything you already have running.

| Service            | Image                                                    | Host port | Default DB      | Notes                                    |
| ------------------ | -------------------------------------------------------- | --------- | --------------- | ---------------------------------------- |
| `mssql`            | `mcr.microsoft.com/mssql/server:2022-latest` (Developer) | `11433`   | `master`        | sa / `ForgeTest!Pa55`                    |
| `postgres`         | `postgres:16-alpine`                                     | `15432`   | `forge_test`    | forge / forge                            |
| `mysql`            | `mysql:8`                                                | `13306`   | `forge_test`    | forge / forge                            |
| `postgres-private` | `postgres:16-alpine`                                     | _(none)_  | `forge_private` | Reachable **only** through bastion       |
| `bastion`          | `linuxserver/openssh-server`                             | `12222`   | n/a             | Public-key auth via `tests/.ssh/id_test` |

## Synthetic fixture

Identical schema across all three SQL engines (lives in `fixtures/{mssql,postgres,mysql}/`). E-commerce shape — products, customers, orders, order_items.

Seed data: 10 products, 5 customers, 8 orders, 15 order items. Deterministic and identical across engines so cross-engine result comparisons work.

## Writing a new integration test

```ts
import { describe, it, expect } from 'vitest';
import { withFreshDatabase, applyFixture } from '../helpers/db-fixtures.js';
import { Client as PgClient } from 'pg';

describe('orders feature on postgres', () => {
  it('returns delivered orders', async () => {
    await withFreshDatabase('postgres', async db => {
      await applyFixture('postgres', db.databaseName, 'seed');

      const client = new PgClient({ ...db.config });
      await client.connect();
      try {
        const r = await client.query(`SELECT id FROM orders WHERE status = 'delivered'`);
        expect(r.rowCount).toBe(3);
      } finally {
        await client.end();
      }
    });
  });
});
```

`withFreshDatabase` creates a uniquely-named database, applies `schema.sql`, hands you connection config, and drops the database on exit. Pair it with `applyFixture(..., 'seed')` if you want the synthetic dataset.

## SSH tunnel testing (Phase 2)

The bastion sits on two networks: the public test network and a private one shared with `postgres-private`. SSH tunnel tests connect to `localhost:12222` with the keypair at `tests/.ssh/id_test`, forward `5432` on `postgres-private`, and exercise tunneled connections end-to-end.

Helper for this is coming in Phase 2.

## What's next (planned phases)

- **Phase 2** — Real integration specs: dialect smoke per engine, query-executor across engines, SSH tunnel happy path.
- **Phase 3** — LLM mock + cassette replay for deterministic AI tests.
- **Phase 4** — Playwright E2E suite covering everything from `regression-suite.md` (the legacy MSSQL audit) plus PG, MySQL, AI chat.
- **Phase 5** ✓ — Visual regression baselines under `tests/__snapshots__/visual/` (macOS-only by design — re-capture with `test:visual:update` if the host machine changes).
- **Phase 6** — `pnpm run test:full` (one-shot CI-style) ✓ and `pnpm run test:smoke` (fast subset for the agent loop) — pending.

## Troubleshooting

**`test:harness:up` fails on macOS** — Docker Desktop must be running. The MSSQL image needs ~2GB RAM allocated to Docker.

**`Connection refused` on first integration run** — `--wait` should gate on health checks but MSSQL can take ~20s after "healthy" to actually accept logins. If it fails, retry once or `pnpm run test:harness:status` to confirm all services are healthy.

**SSH key generation fails** — `ssh-keygen` is required (ships with macOS). If missing, install OpenSSH via Homebrew.

**Port already in use** — Edit `docker-compose.test.yml` and `tests/helpers/db-fixtures.ts` together to change the port mapping.
