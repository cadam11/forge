/**
 * The palette's entry list, **derived**.
 *
 * One function, `buildPaletteEntries`, and everything it returns comes from somewhere that already
 * exists: `COMMAND_CATALOGUE` for the commands (which is itself a `Record` over the registry's id
 * union), `PALETTE_ACTIONS` for the handful of local ones, and the query-history store for recent
 * queries. There is no hand-maintained list of palette copy anywhere in this package, which is the
 * point — PLAN.md 0.4's ten dead entries were a hand-maintained list that outlived its handlers.
 *
 * ── Every entry is live, or visibly not ─────────────────────────────────────────────────────
 *
 * A command entry carries a `state`, computed at build time from two live facts:
 *
 *  - **is its precondition met?** `requires: 'connection'` and friends, from the catalogue. When it is
 *    not, the row renders disabled with the reason — never hidden, because a palette that silently
 *    omits half its entries is why people stop trusting one.
 *  - **is anything subscribed?** `handlerCount(id) === 0` with the precondition satisfied means the
 *    surface that owns it has not shipped, so the row renders disabled and NAMES ITS OWNER from
 *    `COMMAND_CONSUMERS` — the J-44 treatment the settings panel gave its one unconsumed control. A
 *    user who types "history" deserves to learn that the feature is coming, not to wonder whether they
 *    imagined it.
 *
 * Anything else is `'ready'`, and a `'ready'` row dispatches a command that provably has a handler.
 * That is the whole "zero dead commands" property, and `command-palette.spec.tsx` walks every entry
 * to assert it.
 */

import type { LucideIcon } from 'lucide-react';
import { Clock } from 'lucide-react';
import type { QueryHistoryEntry } from '@joinery/shared';

import { handlerCount, type PayloadlessCommandId } from '../../commands';
import {
  COMMAND_CATALOGUE,
  COMMAND_GROUPS,
  commandAccelerator,
  type CommandGroup,
  type PaletteRequirement,
} from '../../commands/catalogue';
import { COMMAND_CONSUMERS, type CommandId } from '../../commands/registry';
import { PALETTE_ACTIONS, type PaletteAction, type PaletteActionId } from './palette-actions';

/** Why a row is not actionable, or that it is. */
export type PaletteEntryState =
  | { readonly kind: 'ready' }
  /** No handler is subscribed. `owner` is the consumer the registry names. */
  | { readonly kind: 'unowned'; readonly owner: string }
  /** Wired, but not applicable right now. `reason` is shown on the row. */
  | { readonly kind: 'unavailable'; readonly reason: string };

interface PaletteEntryBase {
  /** Stable across renders and unique across kinds — cmdk keys its rows on this. */
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly group: CommandGroup;
  readonly icon: LucideIcon;
  /** The keystroke hint, already formatted for the platform, or null. */
  readonly accelerator: string | null;
  /** Everything the fuzzy matcher should consider besides the label. */
  readonly keywords: readonly string[];
  readonly state: PaletteEntryState;
}

/** A row that dispatches a command. `commandId` is payload-free by type — see `commands/bus.ts`. */
export interface PaletteCommandEntry extends PaletteEntryBase {
  readonly kind: 'command';
  readonly commandId: PayloadlessCommandId;
}

/** A row that calls a local closure (`palette-actions.ts` explains why these exist). */
export interface PaletteActionEntry extends PaletteEntryBase {
  readonly kind: 'action';
  readonly actionId: PaletteActionId;
  readonly run: () => void;
}

/** A row that re-opens a query the user has already run. */
export interface PaletteRecentQueryEntry extends PaletteEntryBase {
  readonly kind: 'recent-query';
  readonly entry: QueryHistoryEntry;
}

export type PaletteEntry = PaletteCommandEntry | PaletteActionEntry | PaletteRecentQueryEntry;

/** The live facts the requirements are evaluated against. Supplied by the component. */
export interface PaletteContext {
  readonly hasConnection: boolean;
  readonly hasQueryTab: boolean;
  readonly hasResults: boolean;
  /** Most-recent-first. Already capped by the caller. */
  readonly recentQueries: readonly QueryHistoryEntry[];
}

/** What each requirement needs, and what the row says when it is missing. */
const REQUIREMENTS: Record<
  PaletteRequirement,
  { readonly met: (context: PaletteContext) => boolean; readonly reason: string }
> = {
  connection: {
    met: context => context.hasConnection,
    reason: 'Connect to a server first',
  },
  'query-tab': {
    met: context => context.hasQueryTab,
    reason: 'Open a query tab first',
  },
  results: {
    met: context => context.hasResults,
    reason: 'Run a query first',
  },
};

/**
 * The short form of a consumer string: everything up to the first full stop.
 *
 * `COMMAND_CONSUMERS` entries are paragraphs — they explain producers and resolution rules — and the
 * first clause is always the owner ("Task 19 query-history dialog"). Deriving the label rather than
 * restating it is what keeps the palette's disabled copy honest when a command changes hands.
 */
export function ownerSummary(id: CommandId): string {
  const consumer = COMMAND_CONSUMERS[id];
  const sentenceEnd = consumer.indexOf('. ');
  const summary = sentenceEnd === -1 ? consumer : consumer.slice(0, sentenceEnd);
  return summary.replace(/\.$/, '');
}

/**
 * A command's state: **its precondition first**, then whether anything is subscribed.
 *
 * The order is the whole difference between useful copy and misleading copy, and the browser gate is
 * what showed it. Twelve commands are handled by the query editor, which only exists while a query tab
 * is open — so with no tab open they have no subscriber, and asking the handler question first labelled
 * them "Not wired yet — Task 10 query editor". Task 10 HAS shipped; the honest and actionable answer is
 * "Open a query tab first".
 *
 * Asking the precondition first also cannot hide a genuinely unowned command: a precondition that is
 * MET falls straight through to the handler check, so `open-query-history` still reads as unowned the
 * moment a connection exists, which is when a user would look for it.
 */
function commandState(id: CommandId, context: PaletteContext): PaletteEntryState {
  const visibility = COMMAND_CATALOGUE[id].palette;
  const requirement = visibility.show ? visibility.requires : undefined;
  if (requirement !== undefined) {
    const check = REQUIREMENTS[requirement];
    if (!check.met(context)) return { kind: 'unavailable', reason: check.reason };
  }

  if (handlerCount(id) === 0) return { kind: 'unowned', owner: ownerSummary(id) };
  return { kind: 'ready' };
}

/**
 * The formatted accelerator per command, computed once at module load.
 *
 * `commandAccelerator` reads `IS_MAC`, which is fixed for the life of the renderer, so recomputing it
 * for every row on every keystroke would be waste in the one place in this app where keystroke
 * latency is visible.
 */
const ACCELERATOR_HINTS: Partial<Record<CommandId, string | null>> = Object.fromEntries(
  (Object.keys(COMMAND_CATALOGUE) as CommandId[]).map(id => [id, commandAccelerator(id)])
);

/** Group order, then catalogue order inside a group — so the resting list reads as a menu. */
function byGroup<T extends { readonly group: CommandGroup }>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (left, right) => COMMAND_GROUPS.indexOf(left.group) - COMMAND_GROUPS.indexOf(right.group)
  );
}

function commandEntries(context: PaletteContext): PaletteCommandEntry[] {
  const entries: PaletteCommandEntry[] = [];

  for (const id of Object.keys(COMMAND_CATALOGUE) as CommandId[]) {
    const display = COMMAND_CATALOGUE[id];
    if (!display.palette.show) continue;
    entries.push({
      kind: 'command',
      key: `command:${id}`,
      // The cast is the one the catalogue's own shape justifies: `palette.show` is only ever true for
      // an id with no payload — `catalogue.spec.ts` asserts exactly that, because the type system
      // cannot say "this Record key is in that subset". `dispatchCommand` would refuse a bare
      // `CommandId` (`commands/bus.ts`'s overloads), which is what makes the assertion load-bearing.
      commandId: id as PayloadlessCommandId,
      label: display.label,
      hint: display.hint,
      group: display.group,
      icon: display.icon,
      accelerator: ACCELERATOR_HINTS[id] ?? null,
      keywords: [id, ...(display.keywords ?? [])],
      state: commandState(id, context),
    });
  }

  return byGroup(entries);
}

function actionEntries(actions: readonly PaletteAction[]): PaletteActionEntry[] {
  return byGroup(
    actions.map(action => ({
      kind: 'action' as const,
      key: `action:${action.id}`,
      actionId: action.id,
      run: action.run,
      label: action.label,
      hint: action.hint,
      group: action.group,
      icon: action.icon,
      accelerator: null,
      keywords: [action.id],
      // A closure cannot be unsubscribed, and a local action has no precondition of its own: closing
      // no tabs is a no-op, not a broken row. See `palette-actions.ts`.
      state: { kind: 'ready' as const },
    }))
  );
}

/** One line of SQL, whitespace collapsed, for a history row's label. */
export function summarizeSql(sql: string, maxLength = 80): string {
  const collapsed = sql.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}

function recentQueryEntries(context: PaletteContext): PaletteRecentQueryEntry[] {
  return context.recentQueries.map(entry => ({
    kind: 'recent-query' as const,
    entry,
    key: `recent:${entry.id}`,
    label: summarizeSql(entry.sql),
    hint: `${entry.database ?? 'unknown database'} · ${entry.success ? 'succeeded' : 'failed'}`,
    group: 'query' as const,
    icon: Clock,
    accelerator: null,
    keywords: ['recent', 'history', entry.database ?? ''],
    // Opening a recent query needs a live connection to run against, and the entry names the
    // connection it came from — a row pointing at a disconnected server would open a tab that cannot
    // execute. Reported as unavailable rather than hidden, like everything else here.
    state: context.hasConnection
      ? { kind: 'ready' as const }
      : { kind: 'unavailable' as const, reason: 'Connect to a server first' },
  }));
}

export interface BuildOptions {
  /** Injectable for the spec; production passes nothing and gets the real table. */
  readonly actions?: readonly PaletteAction[];
}

/**
 * Every palette entry, in resting order: commands, then local actions, then recent queries.
 *
 * Recent queries last on purpose. They are the only unbounded, user-data-shaped source in the list,
 * and a palette whose resting state is twenty SELECTs hides the commands it exists to expose.
 */
export function buildPaletteEntries(
  context: PaletteContext,
  options: BuildOptions = {}
): readonly PaletteEntry[] {
  return [
    ...commandEntries(context),
    ...actionEntries(options.actions ?? PALETTE_ACTIONS),
    ...recentQueryEntries(context),
  ];
}
