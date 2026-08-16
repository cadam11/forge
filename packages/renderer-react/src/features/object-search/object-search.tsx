/**
 * Fuzzy search over one database's tables, views, procedures and functions — ⌘P, or the palette's
 * "Find database object". Replaces `shared/components/object-search/object-search.component.ts` (488).
 *
 * ── Two things it does that the original could not ──────────────────────────────────────────
 *
 * 1. **Reveal in the explorer.** ⌘⏎ (or the row's Reveal button) expands the tree down to the object
 *    and scrolls to it, through `reveal-explorer-node` — Task 6 built the `TreeHandle` reveal API for
 *    exactly this, and the sidebar honours the request even if the pane is currently collapsed. The
 *    Angular version could only open a tab, so "where does this table live?" had no answer.
 * 2. **Per-engine SQL.** `object-model.ts` explains the T-SQL-everywhere bug it fixes.
 *
 * ── Loading ────────────────────────────────────────────────────────────────────────────────
 *
 * Four `explorer.getChildren` calls through `useIpcQuery`, one per folder, enabled only while the
 * overlay is open. TanStack caches them under the same keys the sidebar's own tree uses, so opening the
 * search after browsing the tree is usually instant, and a refresh invalidates both. The Angular
 * version kept its own `cachedDatabase` string and re-fetched all four whenever it changed, with an
 * `await` chain that made the second call wait for the first for no reason.
 *
 * The two engines without stored procedures or functions (Aurora DSQL) get two of the four queries
 * disabled rather than four failing calls — `state/capabilities.ts` is the same source the tree's
 * folder list reads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Locate, Table2 } from 'lucide-react';

import { dispatchCommand, useCommand } from '../../commands';
import { useIpcQuery } from '../../ipc';
import { selectCapabilitiesFor, useCapabilitiesStore } from '../../state/capabilities';
import { useMostRecentConnectionId } from '../../state/connection';
import {
  Button,
  CommandOverlay,
  CommandOverlayEmpty,
  CommandOverlayGroup,
  CommandOverlayRow,
  CommandOverlayRowText,
  Icon,
  Tooltip,
} from '../../ui';
import { rankFuzzy } from '../../utils/fuzzy';
import { engineFor, openQueryForDatabase } from '../../shell/sidebar/node-actions';
import { useResolvedDatabase } from '../../shell/sidebar/use-resolved-database';
import {
  OBJECT_FOLDERS,
  planObjectOpen,
  qualifiedName,
  toSearchableObject,
  type SearchableObject,
} from './object-model';

/** Rows rendered at once. A database with 4,000 tables must not mount 4,000 list items. */
const RENDERED_ROW_LIMIT = 50;

export function ObjectSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const connectionId = useMostRecentConnectionId();
  const database = useResolvedDatabase(connectionId);
  const capabilities = useCapabilitiesStore(selectCapabilitiesFor(connectionId ?? undefined));

  // The palette's "Find database object" and the ⌘P shortcut below are the two producers.
  useCommand('open-object-search', () => setOpen(true));

  // ⌘P. Not a menu accelerator (`commands/catalogue.ts`), so the renderer sees the keystroke.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      setOpen(current => !current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const index = useObjectIndex({
    connectionId,
    database,
    enabled: open,
    supportsRoutines: capabilities.supportsStoredProcedures,
  });

  const visible = useMemo(
    () =>
      rankFuzzy(
        query,
        index.objects.map(object => ({
          item: object,
          fields: [
            { text: qualifiedName(object) },
            // The bare name as well as the qualified one: a user typing "orders" means the table, and
            // scoring only `sales.orders` would rank a schema whose NAME matches above it.
            { text: object.name },
            { text: object.typeLabel, weight: 0.4 },
          ],
        })),
        { limit: RENDERED_ROW_LIMIT }
      ).map(result => result.item),
    [index.objects, query]
  );

  // Resolved at render, never pushed through an effect — see the same comment in the palette.
  const firstKey = visible[0] === undefined ? undefined : objectKey(visible[0]);
  const effectiveSelected =
    selected !== undefined && visible.some(object => objectKey(object) === selected)
      ? selected
      : firstKey;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  /** Open a query tab on the object. Executes only for the row-limited SELECT — see `planObjectOpen`. */
  const openObject = useCallback(
    (object: SearchableObject) => {
      close();
      const plan = planObjectOpen(object, engineFor(object.connectionId));
      openQueryForDatabase(object.connectionId, object.database, plan.sql, plan.autoExecute);
    },
    [close]
  );

  const revealObject = useCallback(
    (object: SearchableObject) => {
      close();
      dispatchCommand('reveal-explorer-node', {
        connectionId: object.connectionId,
        databaseName: object.database,
        schema: object.schema,
        objectName: object.name,
        objectType: object.type,
      });
    },
    [close]
  );

  const selectedObject = visible.find(object => objectKey(object) === effectiveSelected);

  return (
    <CommandOverlay
      open={open}
      onOpenChange={next => (next ? setOpen(true) : close())}
      label="Find a database object"
      placeholder="Search tables, views, procedures and functions…"
      value={query}
      onValueChange={setQuery}
      selected={effectiveSelected}
      onSelectedChange={setSelected}
      testIdPrefix="objsearch"
      loading={index.loading}
      // ⌘⏎ reveals rather than opens. Capture, and stopped: cmdk's own Enter handling does not check
      // modifiers, so without capturing this the chord would reveal AND open.
      onKeyDownCapture={event => {
        if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        if (selectedObject !== undefined) revealObject(selectedObject);
      }}
      footer={
        <>
          <span data-testid="objsearch-count" className="tabular-nums">
            {index.objects.length === 0
              ? 'No objects loaded'
              : `${visible.length} of ${index.objects.length} in ${database ?? 'no database'}`}
          </span>
          <span>⏎ to open · ⌘⏎ to reveal</span>
        </>
      }
    >
      {connectionId === null || database === null ? (
        <CommandOverlayEmpty testId="objsearch-disconnected">
          <span>Connect to a server and pick a database first</span>
        </CommandOverlayEmpty>
      ) : (
        <>
          <CommandOverlayEmpty testId="objsearch-empty">
            <span>
              {index.loading
                ? 'Loading objects…'
                : query.length === 0
                  ? 'This database has no objects to show'
                  : `Nothing matches “${query}”`}
            </span>
          </CommandOverlayEmpty>

          <CommandOverlayGroup heading={`${database} objects`}>
            {visible.map(object => (
              <ObjectRow
                key={objectKey(object)}
                object={object}
                onOpen={openObject}
                onReveal={revealObject}
              />
            ))}
          </CommandOverlayGroup>
        </>
      )}
    </CommandOverlay>
  );
}

/** cmdk's row identity. Unique per object within a database. */
function objectKey(object: SearchableObject): string {
  return `${object.type}:${object.schema}.${object.name}`;
}

function ObjectRow({
  object,
  onOpen,
  onReveal,
}: {
  readonly object: SearchableObject;
  readonly onOpen: (object: SearchableObject) => void;
  readonly onReveal: (object: SearchableObject) => void;
}) {
  const plan = planObjectOpen(object, engineFor(object.connectionId));

  return (
    <CommandOverlayRow
      value={objectKey(object)}
      onSelect={() => onOpen(object)}
      testId="objsearch-row"
      trailing={
        <>
          {/* The promise, stated before Enter: a table row runs a capped SELECT, a procedure row does
              not run anything. */}
          <span
            data-testid="objsearch-row-promise"
            className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase"
          >
            {plan.promise}
          </span>
          <Tooltip content="Reveal in the explorer (⌘⏎)">
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              leadingIcon={Locate}
              aria-label={`Reveal ${qualifiedName(object)} in the explorer`}
              data-testid="objsearch-row-reveal"
              // The row is a cmdk item, and a click anywhere in it selects. This button has its own
              // job, so it must not also open the object.
              onClick={event => {
                event.stopPropagation();
                onReveal(object);
              }}
            />
          </Tooltip>
        </>
      }
    >
      <Icon icon={Table2} size="sm" className="stroke-fg-muted" />
      <CommandOverlayRowText
        label={<span data-testid="objsearch-row-name">{qualifiedName(object)}</span>}
        hint={object.typeLabel}
      />
    </CommandOverlayRow>
  );
}

interface ObjectIndexOptions {
  readonly connectionId: string | null;
  readonly database: string | null;
  readonly enabled: boolean;
  readonly supportsRoutines: boolean;
}

interface ObjectIndex {
  readonly objects: readonly SearchableObject[];
  readonly loading: boolean;
}

/**
 * The four folder reads, as four cached queries.
 *
 * Four explicit `useIpcQuery` calls rather than a loop, because they are hooks: the count and order
 * must be fixed for the life of the component, and `OBJECT_FOLDERS` is what keeps the four in step
 * with the paths the tree uses. Procedures and functions are disabled on engines that have neither,
 * which is the same condition `schemaFolderDefs` applies to the tree's folder list.
 */
function useObjectIndex(options: ObjectIndexOptions): ObjectIndex {
  const { connectionId, database, enabled, supportsRoutines } = options;
  const ready = enabled && connectionId !== null && database !== null;
  const id = connectionId ?? '';
  const db = database ?? '';

  const tables = useIpcQuery({
    namespace: 'explorer',
    operation: 'getChildren',
    args: [id, db, 'tables'],
    keyArgs: [id, db, 'tables'],
    enabled: ready,
  });
  const views = useIpcQuery({
    namespace: 'explorer',
    operation: 'getChildren',
    args: [id, db, 'views'],
    keyArgs: [id, db, 'views'],
    enabled: ready,
  });
  const procedures = useIpcQuery({
    namespace: 'explorer',
    operation: 'getChildren',
    args: [id, db, 'procedures'],
    keyArgs: [id, db, 'procedures'],
    enabled: ready && supportsRoutines,
  });
  const functions = useIpcQuery({
    namespace: 'explorer',
    operation: 'getChildren',
    args: [id, db, 'functions'],
    keyArgs: [id, db, 'functions'],
    enabled: ready && supportsRoutines,
  });

  const engine = engineFor(connectionId ?? undefined);

  const objects = useMemo(() => {
    if (connectionId === null || database === null) return [];
    const results = [tables.data, views.data, procedures.data, functions.data];
    const collected: SearchableObject[] = [];
    for (const [index, folder] of OBJECT_FOLDERS.entries()) {
      for (const metadata of results[index] ?? []) {
        collected.push(toSearchableObject(metadata, folder, { connectionId, database, engine }));
      }
    }
    return collected;
  }, [connectionId, database, engine, tables.data, views.data, procedures.data, functions.data]);

  return {
    objects,
    loading: tables.isFetching || views.isFetching || procedures.isFetching || functions.isFetching,
  };
}
