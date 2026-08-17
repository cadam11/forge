/**
 * The explorer object tab: what a table, view, procedure or function is made of.
 *
 * Replaces `features/explorer/explorer.component.ts` (447) and the placeholder that stood in for it in
 * `shell/workspace/tab-panels.tsx`.
 *
 * ── Four differences from the Angular tab, each a fix rather than a restyle ──────────────────
 *
 *  1. **It reads the enriched columns.** Angular's five-column table came from `getTableColumns`, which
 *     carries no identity flag and no foreign key, so the tab could not answer "is this the identity?"
 *     or "where does this point?". `object-rows.ts` has the whole argument.
 *  2. **Foreign keys have a tab of their own.** A constraint can span several columns and carry
 *     referential actions; per-column FK badges cannot show either.
 *  3. **It loads by TAB, not by ACTIVE tab.** The Angular component was a singleton watching
 *     `tabState.activeTab()` with a `loadedTabId` field as its cache, so two object tabs shared one set
 *     of columns and switching between them refetched. Dockview mounts one of these per tab with
 *     `params.tabId`, and every read is a keyed TanStack query — so two tabs hold two results, and
 *     coming back to one is a cache hit rather than a reload.
 *  4. **A failure is on screen.** Angular's loader caught per-call (`.catch(() => [])`) and then
 *     `catch`-ed the whole thing into a toast, so a failed metadata read was an empty table that looked
 *     like an object with no columns. Each table says whether it is empty or broken.
 *
 * ── The definition tab, and when it exists ──────────────────────────────────────────────────
 *
 * `explorer.getDefinition` answers for views, procedures and functions. For a table there is nothing to
 * fetch — the definition IS the columns — so the tab is absent rather than present-and-empty, and
 * "Script as CREATE" is the affordance that produces a table's DDL instead. Angular rendered the tab for
 * every object type with a paragraph explaining that tables do not have one.
 */

import { useState } from 'react';
import {
  Code,
  FileCode,
  KeyRound,
  Network,
  RefreshCw,
  Sigma,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { IDockviewPanelProps } from 'dockview-react';

import {
  EmptyState,
  Icon,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toolbar,
  ToolbarButton,
  ToolbarSpacer,
  Tooltip,
  cn,
} from '../../ui';
import { useInvalidateIpc, useIpcQuery } from '../../ipc';
import { useTabStore, type Tab } from '../../state/tab';
import { engineFor, openTableScript } from '../../shell/sidebar/node-actions';
import { columnRows, indexRows, keyRows } from './object-rows';

/** What the panel needs out of its tab. `null` when the tab is gone or is not an object tab. */
interface ObjectTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  readonly schema: string;
  readonly name: string;
  readonly objectType: string;
}

/**
 * The five fields, out of the tab's `metadata` — the same shape `openObjectTab` writes
 * (`state/tab.ts`). A tab missing any of them cannot be loaded, and says so rather than fetching with
 * an empty string.
 */
function targetOf(tab: Tab | undefined): ObjectTarget | null {
  if (tab === undefined || tab.type !== 'object') return null;
  const metadata = tab.metadata ?? {};
  const objectName = typeof metadata['objectName'] === 'string' ? metadata['objectName'] : null;
  const objectType = typeof metadata['objectType'] === 'string' ? metadata['objectType'] : null;
  const schema = typeof metadata['schema'] === 'string' ? metadata['schema'] : null;
  if (
    tab.connectionId === undefined ||
    tab.databaseName === undefined ||
    objectName === null ||
    objectType === null ||
    schema === null
  ) {
    return null;
  }
  return {
    connectionId: tab.connectionId,
    databaseName: tab.databaseName,
    schema,
    name: objectName,
    objectType,
  };
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  table: Table2,
  view: Network,
  procedure: Code,
  function: Sigma,
};

/** Columns and indexes only exist for the two object types that have storage. */
function hasColumns(objectType: string): boolean {
  const type = objectType.toLowerCase();
  return type === 'table' || type === 'view';
}

/** Everything except a table has a body the server can hand back. */
function hasDefinition(objectType: string): boolean {
  return objectType.toLowerCase() !== 'table';
}

export function ObjectPanel(props: IDockviewPanelProps) {
  const tabId = typeof props.params['tabId'] === 'string' ? props.params['tabId'] : props.api.id;
  const tab = useTabStore(state => state.tabs.find(candidate => candidate.id === tabId));
  const target = targetOf(tab);

  if (target === null) {
    return (
      <div
        className="flex h-full items-center justify-center bg-canvas p-6"
        data-testid="panel-object"
      >
        <EmptyState
          icon={Table2}
          title="No object"
          description="This tab has lost the object it was opened on. Pick one from the explorer."
        />
      </div>
    );
  }

  // Keyed so a tab whose target changes gets fresh state rather than the previous object's open tab.
  return (
    <ObjectDetail key={`${target.databaseName}.${target.schema}.${target.name}`} target={target} />
  );
}

function ObjectDetail({ target }: { readonly target: ObjectTarget }) {
  const showsColumns = hasColumns(target.objectType);
  const showsDefinition = hasDefinition(target.objectType);
  const [section, setSection] = useState(showsColumns ? 'columns' : 'definition');
  const invalidate = useInvalidateIpc();

  const args = [target.connectionId, target.databaseName, target.schema, target.name] as const;
  const keyArgs = [...args];

  const columns = useIpcQuery({
    namespace: 'explorer',
    operation: 'getEnrichedColumns',
    args: [...args],
    keyArgs,
    enabled: showsColumns,
  });
  const indexes = useIpcQuery({
    namespace: 'explorer',
    operation: 'getTableIndexes',
    args: [...args],
    keyArgs,
    enabled: showsColumns,
  });
  const keys = useIpcQuery({
    namespace: 'explorer',
    operation: 'getTableKeys',
    args: [...args],
    keyArgs,
    enabled: showsColumns,
  });
  const definition = useIpcQuery({
    namespace: 'explorer',
    operation: 'getDefinition',
    // NOTE the argument order: preload takes `(connectionId, database, schema, name, objectType)`.
    // The Angular `IpcService` wrapper took `(…, objectType, name, schema)` and the explorer component
    // called it that way, which is why this is spelled out rather than spread.
    args: [target.connectionId, target.databaseName, target.schema, target.name, target.objectType],
    keyArgs: [...keyArgs, target.objectType],
    enabled: showsDefinition,
  });

  const refresh = (): void => {
    // The whole operation for this object, not the namespace: another object tab's columns are still
    // correct, and re-reading them would cost a round trip per open tab.
    void invalidate.operation('explorer', 'getEnrichedColumns', ...keyArgs);
    void invalidate.operation('explorer', 'getTableIndexes', ...keyArgs);
    void invalidate.operation('explorer', 'getTableKeys', ...keyArgs);
    void invalidate.operation('explorer', 'getDefinition', ...keyArgs, target.objectType);
  };

  const TypeIcon = TYPE_ICONS[target.objectType.toLowerCase()] ?? FileCode;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-testid="panel-object">
      <Toolbar aria-label="Object actions" className="border-b border-rule">
        <Icon icon={TypeIcon} size="md" className="stroke-fg-muted" />
        <span className="flex min-w-0 items-baseline gap-2">
          <span data-testid="object-title" className="truncate font-mono text-base text-fg">
            {target.schema === '' ? target.name : `${target.schema}.${target.name}`}
          </span>
          <span
            data-testid="object-type"
            className="shrink-0 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase"
          >
            {target.objectType}
          </span>
        </span>

        <ToolbarSpacer />

        {showsColumns ? (
          <Tooltip content="Open a CREATE script in a new query tab">
            <ToolbarButton
              aria-label="Script as CREATE"
              data-testid="object-script-create"
              leadingIcon={FileCode}
              iconOnly
              onClick={() =>
                void openTableScript(
                  {
                    connectionId: target.connectionId,
                    databaseName: target.databaseName,
                    schema: target.schema,
                    name: target.name,
                    // The script generator is main's, so the engine is only carried because
                    // `ObjectTarget` declares it; `engineFor` is the same resolution the sidebar uses.
                    engine: engineFor(target.connectionId),
                  },
                  'create'
                )
              }
            />
          </Tooltip>
        ) : null}
        <Tooltip content="Re-read this object from the server">
          <ToolbarButton
            aria-label="Refresh"
            data-testid="object-refresh"
            leadingIcon={RefreshCw}
            iconOnly
            onClick={refresh}
          />
        </Tooltip>
      </Toolbar>

      <Tabs
        value={section}
        onValueChange={setSection}
        className="flex min-h-0 grow flex-col"
        data-testid="object-sections"
      >
        <TabsList className="px-2">
          {showsColumns ? (
            <>
              <TabsTrigger value="columns" data-testid="object-tab-columns">
                Columns
                <Count value={columns.data?.length} />
              </TabsTrigger>
              <TabsTrigger value="indexes" data-testid="object-tab-indexes">
                Indexes
                <Count value={indexes.data?.length} />
              </TabsTrigger>
              <TabsTrigger value="keys" data-testid="object-tab-keys">
                Keys
                <Count value={keys.data?.length} />
              </TabsTrigger>
            </>
          ) : null}
          {showsDefinition ? (
            <TabsTrigger value="definition" data-testid="object-tab-definition">
              Definition
            </TabsTrigger>
          ) : null}
        </TabsList>

        {showsColumns ? (
          <>
            <TabsContent value="columns" className="grow overflow-auto">
              <Section
                query={columns}
                emptyTitle="No columns"
                emptyDescription="The catalogue reports no columns for this object."
                testId="object-columns"
              >
                {data => (
                  <DetailTable
                    headers={['Name', 'Type', 'Null', 'Key', 'Default', 'References']}
                    rows={columnRows(data).map(row => ({
                      id: row.name,
                      cells: [
                        row.name,
                        row.type,
                        row.nullable ? 'yes' : 'no',
                        [row.isPrimaryKey ? 'PK' : null, row.isIdentity ? 'identity' : null]
                          .filter(part => part !== null)
                          .join(' · '),
                        row.defaultValue ?? '',
                        row.references ?? '',
                      ],
                    }))}
                  />
                )}
              </Section>
            </TabsContent>

            <TabsContent value="indexes" className="grow overflow-auto">
              <Section
                query={indexes}
                emptyTitle="No indexes"
                emptyDescription="Nothing on this object is indexed."
                testId="object-indexes"
              >
                {data => (
                  <DetailTable
                    headers={['Name', 'Type', 'Columns', 'Unique']}
                    rows={indexRows(data).map(row => ({
                      id: row.name,
                      cells: [
                        row.name,
                        row.isPrimaryKey ? `${row.type} · primary` : row.type,
                        row.columns,
                        row.isUnique ? 'yes' : 'no',
                      ],
                    }))}
                  />
                )}
              </Section>
            </TabsContent>

            <TabsContent value="keys" className="grow overflow-auto">
              <Section
                query={keys}
                emptyIcon={KeyRound}
                emptyTitle="No foreign keys"
                emptyDescription="This object references nothing."
                testId="object-keys"
              >
                {data => (
                  <DetailTable
                    headers={['Constraint', 'Columns', 'References', 'Rules']}
                    rows={keyRows(data).map(row => ({
                      id: row.name,
                      cells: [row.name, row.columns, row.references, row.rules ?? ''],
                    }))}
                  />
                )}
              </Section>
            </TabsContent>
          </>
        ) : null}

        {showsDefinition ? (
          <TabsContent value="definition" className="grow overflow-auto">
            <Section
              query={definition}
              emptyIcon={Code}
              emptyTitle="No definition"
              emptyDescription="The server returned no body for this object."
              testId="object-definition"
              isEmpty={data => data.definition.trim() === ''}
            >
              {data => (
                <pre
                  data-testid="object-definition-sql"
                  className="p-4 font-mono text-sm whitespace-pre-wrap text-fg"
                >
                  {data.definition}
                </pre>
              )}
            </Section>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

/** The row count beside a tab label. Absent until the data lands, rather than a flickering zero. */
function Count({ value }: { readonly value: number | undefined }) {
  if (value === undefined) return null;
  return <span className="text-xs text-fg-subtle tabular-nums">{value}</span>;
}

interface SectionProps<TData> {
  readonly query: {
    readonly data: TData | undefined;
    readonly isPending: boolean;
    readonly error: Error | null;
  };
  readonly emptyIcon?: LucideIcon;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly testId: string;
  /** Defaults to "an empty array". Override for a payload that is empty in some other way. */
  readonly isEmpty?: (data: TData) => boolean;
  readonly children: (data: TData) => React.ReactNode;
}

/**
 * Loading / failed / empty / loaded, in one place for all four sections.
 *
 * **Failed is not empty**, which is the point: the Angular loader turned a rejected metadata call into
 * `[]` and rendered "No columns found", so a permissions error and a column-less object looked
 * identical. The error's own message is shown, because the server's wording is the useful part.
 */
function Section<TData>({
  query,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  testId,
  isEmpty,
  children,
}: SectionProps<TData>) {
  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Spinner label="Reading the catalogue…" />
      </div>
    );
  }

  if (query.error !== null) {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid={`${testId}-error`}>
        <EmptyState
          icon={emptyIcon ?? Table2}
          title="Could not read this"
          description={query.error.message}
        />
      </div>
    );
  }

  const data = query.data;
  const empty = data === undefined || (isEmpty === undefined ? isEmptyArray(data) : isEmpty(data));
  if (empty) {
    return (
      <div className="flex h-full items-center justify-center p-6" data-testid={`${testId}-empty`}>
        <EmptyState icon={emptyIcon ?? Table2} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div data-testid={testId} className="min-w-0">
      {children(data)}
    </div>
  );
}

function isEmptyArray(data: unknown): boolean {
  return Array.isArray(data) && data.length === 0;
}

interface DetailRow {
  readonly id: string;
  readonly cells: readonly string[];
}

/**
 * A real `<table>`, so `tables.md` applies as written (HOUSE-RULES §4 says the AG Grid carve-out is for
 * the virtualized grid only): horizontal rules, no vertical lines, no outer border, sentence-case headers
 * that never wrap.
 *
 * It scrolls inside its own container rather than widening the panel — the References column can be long,
 * and a dock panel at the 800px window floor has no room to spare.
 */
function DetailTable({
  headers,
  rows,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly DetailRow[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr>
            {headers.map(header => (
              <th
                key={header}
                scope="col"
                className="border-b border-rule px-3 py-2 text-sm whitespace-nowrap text-fg-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id} data-testid="object-detail-row">
              {row.cells.map((cell, index) => (
                <td
                  key={headers[index] ?? String(index)}
                  className={cn(
                    'border-b border-rule px-3 py-1.5 align-top font-mono text-sm text-fg',
                    // The first cell is the identifier and must stay readable; everything after it may
                    // wrap rather than push the table wider.
                    index === 0 ? 'whitespace-nowrap' : 'break-words'
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
