# Perf baselines — feature/perf-tuning

Method: `node tests/scripts/perf-baseline.mjs --runs=3` — built app via Playwright
`_electron.launch`, fresh isolated user-data dir per run, visible window,
3s settle before memory sampling. Memory = sum of `workingSetSize` across all
Electron processes (`app.getAppMetrics()`).

## Before (2026-07-25, main @ 7e45616, Darwin 25.5, M-series)

| Metric                        | Cold (run 1) | Warm (median of runs 2–3) |
| ----------------------------- | ------------ | ------------------------- |
| Launch → first window         | 2102 ms      | ~475 ms                   |
| Launch → DOMContentLoaded     | 2191 ms      | ~557 ms                   |
| Launch → `app-shell` attached | 2335 ms      | ~644 ms                   |
| Working set (4 processes)     | 411 MB       | ~548 MB                   |

## Real-profile amplifiers (not captured above — fresh profile floor only)

Craig's live profile at `~/Library/Application Support/mj-forge/`:

| Store                | Size      | Cost mechanism                                                                                                          |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `query-results.json` | **51 MB** | Parsed synchronously at startup before window creation; re-`JSON.stringify`d + written synchronously on **every query** |
| `query-history.json` | 2.0 MB    | Re-serialized + sync-written on every query                                                                             |
| `app-state.json`     | 64 KB     | Two full read-modify-write cycles per tab save                                                                          |
| `window-state.json`  | 101 B     | Sync-written per resize/move **event**                                                                                  |

Also not captured: Google Fonts render-blocking fetch (network-dependent) and
auto-reconnect of saved connections (profile-dependent).

## After Wave 1 (2026-07-25, feature/perf-tuning)

| Metric                        | Median of 3 | vs. before (warm)                            |
| ----------------------------- | ----------- | -------------------------------------------- |
| Launch → first window         | 383 ms      | ~475 ms → **-19%**                           |
| Launch → DOMContentLoaded     | 477 ms      | ~557 ms → -14%                               |
| Launch → `app-shell` attached | 572 ms      | ~644 ms → -11%                               |
| Working set (4 processes)     | 441 MB      | noise band; Wave 1 targeted latency, not RAM |

Notably the first-run spike (2102 ms → shell 2335 ms in the "before" table) did
not reproduce: window creation no longer waits for the keychain vault or any
store's synchronous file load, and first paint no longer blocks on a Google
Fonts fetch. Caveats: this script uses a fresh profile (so it cannot see the
51 MB `query-results.json` cost that task 12 removes), and today's cold run
still had warm OS file caches — a true cold-cache measurement needs a reboot
or cache purge.

## After Wave 2 / Wave 3

_To be filled in as waves land._
