/**
 * **R3, asserted as a suite member: a streamed token cannot re-render a finished message, and
 * cannot reach the query surface at all.**
 *
 * PLAN.md's R3 says `onStreamChunk` fires per token and the panel re-renders markdown →
 * highlight.js → sanitize on every chunk, and that the gate is "a measured benchmark, not a vibe".
 * Task 17 wrote that benchmark and it produced good numbers — 3,000 chunks at ~92/s, 523 mutations
 * on the streaming message, **0** on the 50 prior messages, **0** on the grid, **0** on the editor,
 * zero long tasks, a 9ms worst frame gap, and a lossless 29k tail. But it lived in
 * `.superpowers/sdd/PLAN/task-17-perf.mjs`, which is **gitignored local scratch**: it is not in a
 * fresh clone, nothing runs it, and nothing fails when the property it measured stops holding.
 *
 * This is that benchmark as a durable spec. Same two mechanisms, because both are the real thing
 * rather than a stub of it:
 *
 * 1. **The conversation is seeded on disk.** `ChatService` persists one JSON file per conversation
 *    in `<userData>/chat-history/` and loads the directory in its constructor, so a file written
 *    into the launch's temp profile arrives in the renderer through the real `chat:get-conversation`
 *    IPC. Its last message carries `streaming: true`, which is what mounts the streaming tail. The
 *    `seedUserData` hook on `withJoinery` exists for exactly this and explains itself there.
 * 2. **The chunks come from the main process.** The injection loop runs inside `app.evaluate`,
 *    calling `webContents.send('chat:stream-chunk', …)` — the same channel `ChatService.sendChunk`
 *    uses — so every chunk goes through preload's real listener, the real store, the real coalescer
 *    and the real `<Markdown>`. Nothing in the renderer knows this is a test.
 *
 * **Deliberately harder than production**: `services/ai/stream-coalescer.ts` batches deltas on a
 * 40ms interval in the main process, so a real 100 token/second answer reaches the renderer as ~25
 * messages a second. This injects every chunk unbatched, which is the load the renderer would face
 * if that stage were bypassed, misconfigured, or outrun by a faster model.
 *
 * ── Shorter than the original, and here is what was traded ────────────────────────────────────
 *
 * 600 chunks rather than 3,000, so the spec costs ~6 seconds instead of ~33. The properties being
 * gated are all RATIOS and ZEROS — mutations on prior messages, on the grid, on the editor — and
 * none of them is a function of stream length. The one number that is (mutations on the streaming
 * message) is asserted as a bound derived from the coalescing window, which scales. The unit half
 * of the same gate, `packages/renderer-react/src/features/chat/stream-render-isolation.spec.tsx`,
 * measures the same three things at the memo boundary and runs on every unit run.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';

import {
  CONNECT_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  chatConversationRow,
  chatPanel,
  connectFromSidebar,
  createPostgresProfile,
  dismissToasts,
  ensureJoineryTestSeeded,
  executeQuery,
  gridRows,
  openChatPanel,
  selectDatabase,
  typeSql,
  waitForShell,
  withJoineryReact,
} from '../helpers/joinery-actions-react';
import { attachMeasurements, expect, test } from './fixtures';

const PROFILE = 'Perf Chat PG';
const DATABASE = 'joinery_test';
const CONVERSATION_ID = 'perf-conversation';
/** The seeded conversation's title — how the list row is found. */
const CONVERSATION_TITLE = 'Perf transcript';

/** Finished messages on screen before the stream starts. Task 17's number. */
const PRIOR_MESSAGES = 50;

/** Chunks injected, and the interval between them — 100 a second, as R3 describes. */
const CHUNKS = 600;
const CHUNK_INTERVAL_MS = 10;

/**
 * The renderer's coalescing window (`features/chat/use-stream-tail.ts` exports `STREAM_FLUSH_MS`).
 *
 * Restated rather than imported, because a Playwright spec and a Vite-bundled renderer do not share
 * a module graph — and `assertFlushWindowMatchesRenderer` below reads the renderer's source at run
 * time so the restatement cannot go stale in silence. It is load-bearing in both directions:
 *
 *  - **window ↑** (50 → 100): `MAX_TAIL_MUTATIONS` keeps deriving from 50, so the mutation budget
 *    doubles. The gate loosens and stays green — the dangerous direction.
 *  - **window ↓** (50 → 20): the real flush count overshoots the derivation and this spec goes red
 *    for a reason that is not a regression.
 */
const FLUSH_MS = 50;

/** Where the renderer keeps the value `FLUSH_MS` mirrors. Read as text; see the constant's note. */
const STREAM_TAIL_SOURCE = 'packages/renderer-react/src/features/chat/use-stream-tail.ts';

/**
 * Ceiling on DOM mutations under the STREAMING message.
 *
 * Derived from the coalescing window rather than pinned to a measurement, which is what lets it
 * survive a change of chunk count. The tail is flushed at most once per `FLUSH_MS`, so the stream is
 * `CHUNKS * CHUNK_INTERVAL_MS / FLUSH_MS` flushes — 120 for the numbers above.
 *
 * **Measured: 108 mutations for those 120 flushes**, i.e. 0.90 per flush; Task 17 measured 523 for
 * 656, i.e. 0.80. Three per flush is the allowance — over three times the observed rate, and still
 * well under what losing the coalescer costs: one flush per CHUNK would be 600 flushes here, five
 * times the bound before a single extra mutation is counted.
 */
const MAX_TAIL_MUTATIONS = Math.ceil((CHUNKS * CHUNK_INTERVAL_MS) / FLUSH_MS) * 3;

test.beforeAll(ensureJoineryTestSeeded);

/**
 * Fails if the renderer's `STREAM_FLUSH_MS` and this file's `FLUSH_MS` have drifted apart.
 *
 * Reading the source is the only channel available — see `FLUSH_MS`. The same read-the-source
 * pattern `ui/contract.spec.tsx` uses, and for the same reason: two files have to agree on a number
 * with no type connecting them. It cannot live on the renderer side, because that package compiles
 * with no `@types/node` on purpose and a vitest spec there cannot open a file.
 */
function assertFlushWindowMatchesRenderer(): void {
  const source = readFileSync(STREAM_TAIL_SOURCE, 'utf8');
  const declared = /export const STREAM_FLUSH_MS = (\d+);/.exec(source);
  // Guards the assertion below: a renamed constant would otherwise make it vacuous rather than red.
  expect(
    declared,
    `no \`export const STREAM_FLUSH_MS = <n>;\` in ${STREAM_TAIL_SOURCE}`
  ).not.toBeNull();
  expect(
    Number(declared?.[1]),
    `the renderer's coalescing window moved; this spec still derives its budget from ${FLUSH_MS}ms`
  ).toBe(FLUSH_MS);
}

test.describe('chat streaming', () => {
  test('a streamed token touches the tail and nothing else', async () => {
    assertFlushWindowMatchesRenderer();

    await withJoineryReact({ seedUserData: seedStreamingConversation }, async ({ app, window }) => {
      await waitForShell(window);
      await createPostgresProfile(window, PROFILE);
      await connectFromSidebar(window, PROFILE);
      await selectDatabase(window, DATABASE);

      // A real result set beside the chat, so "the grid did not move" is a claim about a grid that
      // exists. Without this the grid probe would watch nothing and report a comfortable zero.
      await typeSql(window, 'SELECT id, email FROM customers ORDER BY id LIMIT 20');
      await executeQuery(window);
      await expect(gridRows(window).first()).toBeVisible({ timeout: CONNECT_TIMEOUT_MS });
      await dismissToasts(window);

      await openChatPanel(window);
      await openSeededConversation(window);

      const probes = await installProbes(window);
      expect(probes.priorWatched, 'the seeded transcript did not render').toBe(PRIOR_MESSAGES);
      expect(probes.tailWatched, 'no streaming message to watch').toBe(true);
      expect(probes.gridWatched, 'no results grid to watch, so its zero would be meaningless').toBe(
        true
      );
      expect(probes.editorWatched, 'no editor to watch').toBe(true);

      const startedAt = Date.now();
      await injectChunks(app);
      const streamMs = Date.now() - startedAt;

      // ── Wait for the final flush BEFORE reading the probes ──────────────────────────────────
      //
      // `injectChunks` returns when the main process has SENT the last chunk and the `done: true`
      // that follows it. Neither is ordered against the renderer's coalescer, which is holding up
      // to `FLUSH_MS` of text, nor against the React commit that paints it. Reading the counters
      // first therefore undercounted `tail` by whatever the last flush was about to do, and the
      // lossless check below raced the same commit — it was a plain `textContent()` compared with a
      // non-retrying `toContain`, so a late final flush would fail it for the wrong reason.
      //
      // A bounded Playwright assertion, not a sleep: the last token appearing IS the flush landing.
      await expect(
        chatPanel(window),
        'the last streamed token never reached the transcript'
      ).toContainText(tokenMarker(CHUNKS - 1), { timeout: UI_TIMEOUT_MS });

      const counts = await readProbes(window);

      // ── The three zeros: R3, stated ────────────────────────────────────────────────────────
      expect(
        counts.prior,
        'a streamed token re-rendered a finished message — the per-message memo is gone'
      ).toBe(0);
      expect(counts.grid, 'a streamed token reached the results grid').toBe(0);
      expect(counts.editor, 'a streamed token reached the query editor').toBe(0);

      // ── And the one number that is allowed to move ─────────────────────────────────────────
      expect(
        counts.tail,
        'the streaming message never changed, so nothing was measured'
      ).toBeGreaterThan(0);
      expect(
        counts.tail,
        'the streaming tail mutated far more than its coalescing window allows'
      ).toBeLessThan(MAX_TAIL_MUTATIONS);

      // Lossless: the FIRST token is still there too, so coalescing dropped nothing at either end.
      // (The last one was asserted above, as the gate that says the stream had finished landing.) A
      // window that swallowed chunks would still produce a clean mutation count, which is why this
      // check exists at all.
      await expect(chatPanel(window), 'the first streamed token is missing').toContainText(
        tokenMarker(0),
        { timeout: UI_TIMEOUT_MS }
      );

      await attachMeasurements('chat-stream.json', {
        chunks: CHUNKS,
        chunkIntervalMs: CHUNK_INTERVAL_MS,
        streamMs,
        chunksPerSecond: Math.round((CHUNKS / streamMs) * 1000),
        flushWindowMs: FLUSH_MS,
        expectedFlushes: Math.ceil((CHUNKS * CHUNK_INTERVAL_MS) / FLUSH_MS),
        priorMessages: PRIOR_MESSAGES,
        mutations: counts,
        maxTailMutationsAllowed: MAX_TAIL_MUTATIONS,
      });
    });
  });
});

/** The text one chunk carries. `tok<N>` is the marker the lossless check looks for. */
function tokenMarker(index: number): string {
  return `tok${index}`;
}

/**
 * Writes a 50-message conversation plus a streaming placeholder where `ChatService` will read it.
 *
 * The assistant messages carry real markdown — a fenced SQL block, a table, inline code — because
 * the cost R3 is about is RE-PARSING them, and a transcript of bare sentences would understate it by
 * an order of magnitude.
 */
function seedStreamingConversation(userDataDir: string): void {
  const messages = [];
  for (let index = 0; index < PRIOR_MESSAGES; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 7, 16, 9, index)).toISOString();
    messages.push(
      index % 2 === 0
        ? {
            id: `msg-${index}`,
            role: 'user',
            content: `Question ${index}: which tables are largest?`,
            timestamp,
          }
        : {
            id: `msg-${index}`,
            role: 'assistant',
            content: [
              `Answer ${index}. \`orders\` grows fastest because every line item writes a row.`,
              '',
              '```sql',
              'SELECT relname, n_live_tup',
              'FROM pg_stat_user_tables',
              'ORDER BY n_live_tup DESC',
              'LIMIT 10;',
              '```',
              '',
              '| table | rows |',
              '| ----- | ---- |',
              '| orders | 120000 |',
              '',
            ].join('\n'),
            timestamp,
          }
    );
  }

  // `streaming: true` is what mounts the streaming tail — the state the UI is in mid-answer.
  messages.push({
    id: 'msg-streaming',
    role: 'assistant',
    content: '',
    timestamp: new Date(Date.UTC(2026, 7, 16, 10, 0)).toISOString(),
    streaming: true,
    toolCalls: [],
  });

  const directory = join(userDataDir, 'chat-history');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${CONVERSATION_ID}.json`),
    JSON.stringify(
      {
        id: CONVERSATION_ID,
        title: CONVERSATION_TITLE,
        messages,
        createdAt: new Date(Date.UTC(2026, 7, 16, 9, 0)).toISOString(),
        updatedAt: new Date(Date.UTC(2026, 7, 16, 10, 0)).toISOString(),
      },
      null,
      2
    ),
    'utf-8'
  );
}

/** Opens the seeded conversation from the chat panel's conversation list. */
async function openSeededConversation(window: Page): Promise<void> {
  const panel = chatPanel(window);
  await panel.getByTestId('chat-conversations-toggle').click();
  await chatConversationRow(panel, CONVERSATION_TITLE)
    .getByTestId('chat-conversation-select')
    .click();
  await expect(window.getByTestId('chat-message').first()).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await expect(window.getByTestId('chat-message')).toHaveCount(PRIOR_MESSAGES + 1, {
    timeout: UI_TIMEOUT_MS,
  });
}

interface ProbeReport {
  readonly priorWatched: number;
  readonly tailWatched: boolean;
  readonly gridWatched: boolean;
  readonly editorWatched: boolean;
}

/**
 * Installs one `MutationObserver` per watched subtree: the streaming message, each prior message,
 * the results grid, the query editor.
 *
 * Nothing in the product is instrumented — the numbers have to describe the app a user runs. The
 * report says what each observer actually attached to, so a zero can never come from an observer
 * that found nothing; the caller asserts all four.
 */
async function installProbes(window: Page): Promise<ProbeReport> {
  return window.evaluate(() => {
    const counts = { tail: 0, prior: 0, grid: 0, editor: 0 };
    const watchers: MutationObserver[] = [];
    const options: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    };
    const watch = (node: Element | null, key: 'tail' | 'prior' | 'grid' | 'editor'): boolean => {
      if (node === null) return false;
      const observer = new MutationObserver(records => {
        counts[key] += records.length;
      });
      observer.observe(node, options);
      watchers.push(observer);
      return true;
    };

    const messages = Array.from(document.querySelectorAll('[data-testid="chat-message"]'));
    const streaming = messages[messages.length - 1] ?? null;
    const prior = messages.slice(0, -1);

    (window as unknown as Record<string, unknown>).__joineryStreamProbes = { counts, watchers };

    return {
      tailWatched: watch(streaming, 'tail'),
      priorWatched: prior.filter(element => watch(element, 'prior')).length,
      gridWatched: watch(document.querySelector('[data-testid="results-grid"]'), 'grid'),
      editorWatched: watch(document.querySelector('.monaco-editor'), 'editor'),
    };
  });
}

/** Stops the observers and returns their counts. */
async function readProbes(
  window: Page
): Promise<{ tail: number; prior: number; grid: number; editor: number }> {
  return window.evaluate(() => {
    const probes = (window as unknown as Record<string, unknown>).__joineryStreamProbes as {
      counts: { tail: number; prior: number; grid: number; editor: number };
      watchers: MutationObserver[];
    };
    for (const watcher of probes.watchers) watcher.disconnect();
    delete (window as unknown as Record<string, unknown>).__joineryStreamProbes;
    return probes.counts;
  });
}

/**
 * Sends `CHUNKS` stream chunks from the MAIN process, `CHUNK_INTERVAL_MS` apart.
 *
 * In the main process rather than the renderer so the spacing is real wall-clock spacing and every
 * chunk crosses the IPC boundary the way a model's tokens do. The delta text is built from `index`
 * with arithmetic only — no function is serialized across the boundary — because a `new Function`
 * shim would be both the forbidden pattern in CLAUDE.md and a second thing to get wrong.
 */
async function injectChunks(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    async ({ BrowserWindow }, options) => {
      const [win] = BrowserWindow.getAllWindows();
      if (win === undefined) throw new Error('no BrowserWindow to stream chunks into');

      for (let index = 0; index < options.chunks; index += 1) {
        // Real markdown, so every flush re-parses and re-highlights everything emitted so far —
        // which is the cost R3 is about. The shape repeats every 50 tokens.
        const marker = `tok${index} `;
        const phase = index % 50;
        let delta = marker;
        if (phase === 40) delta = `\n\n\`\`\`sql\n-- ${marker}\nSELECT id, email\n`;
        else if (phase === 44) delta = `FROM customers WHERE id = ${index}; -- ${marker}\n`;
        else if (phase === 48) delta = `-- ${marker}\n\`\`\`\n\n`;
        else if (phase === 49)
          delta = `| column | ${marker} |\n| --- | --- |\n| ${index} | rows |\n\n`;
        else if (phase % 12 === 0) delta = `**${marker}**`;

        win.webContents.send('chat:stream-chunk', {
          conversationId: options.conversationId,
          delta,
          done: false,
        });
        await new Promise(resolve => setTimeout(resolve, options.intervalMs));
      }

      win.webContents.send('chat:stream-chunk', {
        conversationId: options.conversationId,
        done: true,
      });
    },
    { conversationId: CONVERSATION_ID, chunks: CHUNKS, intervalMs: CHUNK_INTERVAL_MS }
  );
}
