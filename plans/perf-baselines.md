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

Craig's live profile at `~/Library/Application Support/joinery/`:

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

## After Wave 2 (2026-07-25, feature/perf-tuning)

Cold-start medians statistically unchanged from Wave 1 (426 ms first window /
641 ms shell / 441 MB — within run-to-run noise). Wave 2's wins are not
measurable by this script by design:

- **Real-profile startup + per-query cost**: the 51 MB `query-results.json`
  is migrated to file-per-snapshot storage on first launch; startup then
  reads a small index, and each query writes one file asynchronously
  instead of re-serializing the whole history synchronously.
- **Typing**: Monaco runs outside the Angular zone; keystrokes no longer
  rebuild the global tabs array or trigger app-wide change detection
  (dirty-flag transitions still do, once).
- **Tree interactions**: single-node updates clone only their branch;
  sidebar renders with OnPush and O(1) per-node icon/color lookups.
- **Large results**: maxRowsToDisplay is enforced main-side, so oversized
  result sets never cross IPC ("showing first N of M" in the grid).

## After Wave 3 (zoneless)

_Not started — see PR description for the recommendation._

## React results grid, 100k rows (2026-08-16, renderer-rewrite Task 11)

The first grid numbers in this file. Everything above measures launch and memory;
PLAN.md's R2 ("a React port can accidentally re-render 10k rows per keystroke
through a badly-scoped store selector") asks about interaction cost at size, so
Task 11's gate established these and they are the budget from here on.

Method: `node .superpowers/sdd/PLAN/task-11-perf.mjs` — packaged main process,
**production React bundle** loaded over `file://`, live seeded PostgreSQL
(`generate_series(1, 100000)` × 5 columns: int, md5 text, int, numeric, timestamp),
1600×1000 window, `maxRowsToDisplay` raised to 150,000 through the same
localStorage migration an upgrading user's settings arrive by. Every duration is
`performance.now()` **inside the page**, not Playwright's clock; each scroll step
waits two animation frames, so a step is "AG Grid re-rendered the viewport and the
browser painted it". Darwin 25.5, M-series.

| Metric                                    | Measured           | Budget    |
| ----------------------------------------- | ------------------ | --------- |
| Execute → 100k rows on screen             | 528 ms             | —         |
| Row elements in the DOM (100k-row result) | 33 (53 mid-scroll) | ≤ 200     |
| Scroll step, median of 20 (whole result)  | 33.3 ms            | ≤ 50 ms   |
| Scroll step, worst of 20                  | 47.7 ms            | ≤ 120 ms  |
| Sort a 100k-value text column             | 132.1 ms           | ≤ 2500 ms |
| Quick filter, 100k → 1 row                | 86.3 ms            | ≤ 4000 ms |
| **Grid DOM mutations over 20 keystrokes** | **0**              | **0**     |
| Working set, before → with 100k rows      | 484 → 761 MB       | —         |

The last row of the table is the R2 assertion itself, measured with a
`MutationObserver` on the grid host rather than with any instrumentation in the
product: with 100,000 rows loaded, twenty keystrokes in the editor produce **zero**
mutations inside the grid. `render-isolation.spec.tsx` is the same claim at the
memo boundary in jsdom.

Two numbers worth keeping an eye on:

- **+277 MB for 100,000 × 5 columns.** The rows are held twice — once in the
  execution store, once in AG Grid's row model — and `maxRowsToDisplay` defaults
  to 10,000, so a default-settings user never reaches this. It is the reason the
  cap exists rather than an argument against the grid.
- **Startup CSS**: the vendor grid stylesheets are imported from
  `styles/theme.css`, which puts ~320 KB of CSS on the eager path (the entry
  stylesheet went 162 KB → 482 KB). Moving them into the lazily-loaded query-panel
  chunk is possible but would put our `--ag-*` override map after the vendor CSS
  only by luck of chunk order; the ordering argument lives in one file today. If
  launch regresses, this is the first thing to try.

## React chat streaming, 100 tokens/second for 30s (2026-08-16, renderer-rewrite Task 17)

PLAN.md's R3 — "`onStreamChunk` fires per token and the panel re-renders markdown →
highlight.js → sanitize on every chunk" — with the gate the risk register asks for:
"a measured benchmark, not a vibe". Task 11's grid numbers above are the same exercise
for R2; these are the budget for chat from here on.

Method: `node .superpowers/sdd/PLAN/task-17-perf.mjs` — packaged main process,
**production React bundle** over `file://`, live seeded PostgreSQL, 1600×1000 window.
A conversation of **50 prior messages** (25 of them assistant markdown with a fenced
SQL block and a table each) is seeded as JSON in `<userData>/chat-history/`, which is
where `ChatService` reads conversations from, and its last message carries
`streaming: true` — the state that mounts the streaming tail. **3,000 chunks** are then
sent from the MAIN process on the real `chat:stream-chunk` channel, one every 10ms, so
they arrive through preload's real listener, the real store and the real `<Markdown>`.
Every token carries markdown (a code fence every 50, then a table), because a tail of
plain prose would give highlight.js nothing to do and understate the cost.

A query tab with a live Monaco and an AG Grid full of rows is open beside the panel
throughout — that is what makes the grid/editor zeroes mean anything. Every number is
measured in-page by `MutationObserver` and by a `requestAnimationFrame` clock, with no
instrumentation in the product. Darwin 25.5, M-series, 120Hz display.

**Deliberately harder than production.** The main process already coalesces deltas on a
40ms interval (`services/ai/stream-coalescer.ts`), so a real 100-token/second answer
reaches the renderer as ~25 messages a second. This bypasses that stage.

| Metric                                             | Measured                                          | Budget                |
| -------------------------------------------------- | ------------------------------------------------- | --------------------- |
| Chunks delivered / elapsed                         | 3,000 in 32.8s (91/s)                             | —                     |
| **DOM mutations in the streaming message**         | **520**                                           | ≤ 1,971 (3/window)    |
| **DOM mutations in the 50 prior messages**         | **0**                                             | **0**                 |
| **DOM mutations in the results grid**              | **0**                                             | **0**                 |
| **DOM mutations in the Monaco editor**             | **0**                                             | **0**                 |
| DOM mutations in chat over 20 editor keystrokes    | 0                                                 | 0                     |
| Frame gap during the stream (median / p95 / worst) | 8 / 9 / 9 ms                                      | ≤ 34 p95, ≤ 120 worst |
| Frames over 50ms in 30s                            | 0                                                 | ≤ 5                   |
| Long tasks during the stream                       | 0 (0ms blocking)                                  | ≤ 120ms longest       |
| Tail text after the stream                         | 29,026 chars, first/middle/last token all present | lossless              |
| Completed bodies after `done`                      | 26 (25 prior + the finished one)                  | 26                    |
| Working set, before the panel → after the stream   | 569 → 629 MB                                      | —                     |

**The number the mitigation is for is the second row.** 3,000 chunks re-rendered 25
completed markdown bodies **zero** times — the 75,000 `marked` + highlight.js + DOMPurify
passes that a naive `useStore(store, s => s.streamingContent)` in the surface would have
performed. The streaming message updated 520 times instead of 3,000, which is one update
per ~63ms against a 50ms coalescing window (`features/chat/use-stream-tail.ts`).

**The zeroes are instrument-verified.** A benchmark whose main-thread numbers can only
ever be zero is not a measurement, so the same clock is read again while the page blocks
itself for 200ms on purpose: it reports a 200ms frame gap and a 200ms long task. The
zeroes above are therefore absences, not blindness. (Chromium's `longtask` observer
reported nothing during the stream _or_ while opening the 50-message transcript, which is
why the frame clock is the number that carries the argument.)

Two things worth watching:

- **+60 MB across a 30-second stream.** The transcript holds every message twice while
  streaming (the store's `messages`, plus the tail's parsed DOM), and the 29 KB tail is
  re-parsed on each flush. It settles after `done`, but a very long session in one
  conversation is the case to re-measure if memory becomes a complaint.
- **The eager bundle grew 28 KB** (1,421.02 → 1,449.05 kB; +7.8 kB gzip), which is the
  chat feature's own code: `marked`, `highlight.js/lib/common` and DOMPurify were already
  in the entry chunk before this task, because `markdown/render-markdown.ts` has top-level
  side effects (`new Marked(...)`, `DOMPurify.addHook(...)`) and so survives tree-shaking
  wherever it is reachable. Mermaid adds ~3.5 MB of **lazily-loaded** chunks, fetched from
  the asar the first time a diagram appears.
