/**
 * The command palette. Replaces `shared/components/command-palette/command-palette.component.ts`
 * (703) — and it is the surface PLAN.md 0.4 was written about.
 *
 * ── What was wrong with the original ────────────────────────────────────────────────────────
 *
 * It held a hand-written array of 26 command objects, each with its own `action` closure. Ten of
 * those closures were `window.dispatchEvent(new CustomEvent('joinery:…'))` against event names
 * **nothing in the app listened for** — `joinery:open-backup`, `joinery:open-restore`,
 * `joinery:save-snippet`, `joinery:toggle-results` and six more. Clicking them closed the palette and
 * did nothing, and no compiler, test or review step could have noticed: a `CustomEvent` with no
 * listener is indistinguishable from one with a listener.
 *
 * Nothing here is hand-written. The entries are DERIVED — `palette-model.ts` reads
 * `COMMAND_CATALOGUE`, which is a `Record` over the command registry's own id union — so:
 *
 *  - a command cannot be missing from the palette (adding one to the registry without deciding how
 *    the palette treats it does not compile);
 *  - a palette entry cannot name a command that does not exist (there is no string to typo);
 *  - a command whose consumer has not shipped renders **disabled, naming its owner**, because the
 *    model asks the bus `handlerCount(id)` at build time. So the ten dead entries are not "fixed" in
 *    the sense of having been re-pointed — the failure mode is gone.
 *
 * ── The keystrokes ─────────────────────────────────────────────────────────────────────────
 *
 * ⌘K and ⇧⌘P, both owned by this component's own listener. Neither is a menu accelerator, which is
 * the only reason a renderer `keydown` can see them at all (`commands/catalogue.ts` explains the
 * three accelerator sources). The Angular version also bound ⌘H here to open the query-history
 * dialog, which is not this component's business and collided with nothing only by luck — Query ▸
 * History is ⇧⌘H in `menu.ts` and reaches its own consumer through the menu bridge.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { COMMAND_GROUP_LABELS, dispatchCommand } from '../../commands';
import { ipc, isIpcAvailable } from '../../ipc';
import { diagnostics } from '../../state/diagnostics';
import { selectHasAnyConnection, useConnectionStore } from '../../state/connection';
import { selectResultFor, useQueryExecutionStore } from '../../state/query-execution';
import { selectActiveTab, tabStore, useTabStore } from '../../state/tab';
import {
  CommandOverlay,
  CommandOverlayEmpty,
  CommandOverlayGroup,
  CommandOverlayRow,
  CommandOverlayRowText,
  Icon,
} from '../../ui';
import { rankFuzzy } from '../../utils/fuzzy';
import type { QueryHistoryEntry } from '@joinery/shared';
import {
  buildPaletteEntries,
  type PaletteEntry,
  type PaletteRecentQueryEntry,
} from './palette-model';

/**
 * How many recent queries the palette offers, and how many rows it renders at once.
 *
 * Both are caps rather than preferences: the history call is unbounded server-side (its filter's
 * default limit is 100) and the palette must not become a history browser — that is
 * `open-query-history`'s job, and it is one of the entries. 60 rendered rows is more than a 52vh list
 * can show, so the cap is invisible until a query matches almost everything.
 */
const RECENT_QUERY_LIMIT = 6;
const RENDERED_ROW_LIMIT = 60;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [recentQueries, setRecentQueries] = useState<readonly QueryHistoryEntry[]>([]);

  const hasConnection = useConnectionStore(selectHasAnyConnection);
  const activeTab = useTabStore(selectActiveTab);
  const hasQueryTab = activeTab?.type === 'query';
  const activeResult = useQueryExecutionStore(selectResultFor(activeTab?.id));

  // ⌘K / ⇧⌘P. `event.key` rather than `code`, so a non-QWERTY layout still works, and the modifier
  // test excludes Alt so ⌥⌘K (whatever that may become) is not swallowed here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const isPaletteKey = (key === 'k' && !event.shiftKey) || (key === 'p' && event.shiftKey);
      if (!isPaletteKey) return;
      event.preventDefault();
      setOpen(current => !current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Recent queries are read when the palette opens, not subscribed to: the list is a snapshot of what
  // the user has run, and re-ranking rows underneath their cursor because a background execute
  // finished would be worse than being one query stale. Failures are the store's to report; here they
  // just mean no recent rows.
  useEffect(() => {
    if (!open) return;
    if (!isIpcAvailable()) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await ipc().query.getHistory({
          limit: RECENT_QUERY_LIMIT,
          successOnly: true,
        });
        if (!cancelled) setRecentQueries(entries ?? []);
      } catch (error) {
        diagnostics.error('failed to read recent queries for the palette', error);
        if (!cancelled) setRecentQueries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const entries = useMemo(
    () =>
      buildPaletteEntries({
        hasConnection,
        hasQueryTab,
        // "Results are on screen" is the grid's own condition: a result with at least one result set
        // that has rows. `rowsAffected`-only results (an UPDATE) have nothing to export or inspect.
        hasResults: (activeResult?.resultSets ?? []).some(set => set.rows.length > 0),
        recentQueries,
      }),
    // `open` is in the list on purpose: `handlerCount` is module state the model reads, and a surface
    // that mounted since the last open (a query tab, a dialog) changes which entries are live. Every
    // other dependency is store-derived and re-renders on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasConnection, hasQueryTab, activeResult, recentQueries, open]
  );

  const visible = useMemo(() => {
    const ranked = rankFuzzy(
      query,
      entries.map(entry => ({
        item: entry,
        fields: [
          { text: entry.label },
          { text: entry.hint, weight: 0.6 },
          ...entry.keywords.map(keyword => ({ text: keyword, weight: 0.5 })),
        ],
      })),
      { limit: RENDERED_ROW_LIMIT }
    );
    return ranked.map(result => result.item);
  }, [entries, query]);

  /*
   * cmdk's selection, resolved rather than synchronised.
   *
   * With `shouldFilter={false}` cmdk cannot re-derive its own selection: it keeps the value it was
   * last given, and after a re-rank that value may name a row that is no longer rendered — Enter
   * would then do nothing at all, which is the exact class of bug this surface exists to eliminate.
   *
   * So `selected` holds only what the user has moved to, and the value handed to cmdk is that value
   * *if it is still a live row*, else the first ready one. Derived at render on purpose: an effect
   * that pushed the fallback into state would re-render for a value nothing had asked to change.
   */
  const firstReady = visible.find(entry => entry.state.kind === 'ready')?.key;
  const selectedIsLive = visible.some(
    entry => entry.key === selected && entry.state.kind === 'ready'
  );
  const effectiveSelected = selectedIsLive ? selected : firstReady;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const run = useCallback(
    (entry: PaletteEntry) => {
      if (entry.state.kind !== 'ready') return;
      // Closed BEFORE the action: an entry that opens another overlay (the snippet library, the
      // object search, the cheatsheet) would otherwise open it behind this one, and Radix would put
      // focus back into a palette that is on its way out.
      close();
      switch (entry.kind) {
        case 'command':
          dispatchCommand(entry.commandId);
          return;
        case 'action':
          entry.run();
          return;
        case 'recent-query':
          openRecentQuery(entry);
          return;
      }
    },
    [close]
  );

  const groups = useMemo(() => groupEntries(visible), [visible]);

  return (
    <CommandOverlay
      open={open}
      onOpenChange={next => (next ? setOpen(true) : close())}
      label="Command palette"
      placeholder="Type a command or search recent queries…"
      value={query}
      onValueChange={setQuery}
      selected={effectiveSelected}
      onSelectedChange={setSelected}
      testIdPrefix="palette"
      footer={
        <>
          <span data-testid="palette-count" className="tabular-nums">
            {visible.length} of {entries.length}
          </span>
          <span>↑↓ to move · ⏎ to run · esc to close</span>
        </>
      }
    >
      <CommandOverlayEmpty testId="palette-empty">
        <span>No command matches “{query}”</span>
      </CommandOverlayEmpty>

      {groups.map(([group, groupEntries]) => (
        <CommandOverlayGroup key={group} heading={COMMAND_GROUP_LABELS[group]}>
          {groupEntries.map(entry => (
            <PaletteRow key={entry.key} entry={entry} onRun={run} />
          ))}
        </CommandOverlayGroup>
      ))}
    </CommandOverlay>
  );
}

/**
 * One row.
 *
 * The disabled copy is the load-bearing part: an `unowned` row says WHO owns the missing handler,
 * derived from `COMMAND_CONSUMERS`, and an `unavailable` row says what is missing right now. Neither
 * is hidden. `data-palette-state` carries the same fact to the suites, so the both-theme gate can
 * walk every row and check that a disabled one explains itself.
 */
function PaletteRow({
  entry,
  onRun,
}: {
  readonly entry: PaletteEntry;
  readonly onRun: (entry: PaletteEntry) => void;
}) {
  const disabled = entry.state.kind !== 'ready';
  const explanation =
    entry.state.kind === 'unowned'
      ? `Not wired yet — ${entry.state.owner}`
      : entry.state.kind === 'unavailable'
        ? entry.state.reason
        : undefined;

  return (
    <CommandOverlayRow
      value={entry.key}
      disabled={disabled}
      onSelect={() => onRun(entry)}
      testId="palette-row"
      trailing={
        entry.accelerator === null ? undefined : (
          <kbd
            data-testid="palette-row-keys"
            className="rounded-xs border border-rule bg-surface px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
          >
            {entry.accelerator}
          </kbd>
        )
      }
    >
      <Icon icon={entry.icon} size="sm" className="stroke-fg-muted" />
      <CommandOverlayRowText
        // The hint carries the disabled explanation when there is one, and it is measured by the
        // both-theme gate — hence a testid of its own rather than "the second span in the row".
        hint={<span data-testid="palette-row-hint">{explanation ?? entry.hint}</span>}
        label={
          // The state and the entry key are on the DOM so the suites can join a rendered row back to
          // the model that produced it: `command-palette.spec.tsx`'s zero-dead-commands walk reads
          // both, and so does the both-theme browser gate.
          <span
            data-testid="palette-row-label"
            data-palette-state={entry.state.kind}
            data-palette-key={entry.key}
          >
            {entry.label}
          </span>
        }
      />
    </CommandOverlayRow>
  );
}

/** Entries bucketed by group, keeping the order the model put them in. */
function groupEntries(
  entries: readonly PaletteEntry[]
): readonly [PaletteEntry['group'], readonly PaletteEntry[]][] {
  const buckets = new Map<PaletteEntry['group'], PaletteEntry[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.group);
    if (bucket === undefined) buckets.set(entry.group, [entry]);
    else bucket.push(entry);
  }
  return [...buckets.entries()];
}

/**
 * Re-open a query the user has already run, in a tab against the connection and database it came
 * from — and **do not execute it**.
 *
 * That last part is the Task 8 / Ruling 13 line: only an affordance whose label promises a run
 * ("Select Top 1000 Rows") executes on open. A palette row that said "SELECT …" and silently ran it
 * against production would be the sidebar's auto-executing CREATE scripts all over again.
 *
 * The entry's own `connectionId` is used rather than the focused one, because that is what the row
 * says it is; when that connection is gone the tab still opens with the SQL in it, which is strictly
 * better than discarding what the user asked for (the same call `hydrateWorkspace` makes).
 */
function openRecentQuery(entry: PaletteRecentQueryEntry): void {
  const { connectionId, database, sql } = entry.entry;
  tabStore.getState().openQueryTab(connectionId, database, sql, false);
}
