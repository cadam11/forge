/**
 * Schema metadata → ERD nodes. The port of `core/services/erd-adapter.service.ts` (259 LOC).
 *
 * Two structural changes, and both are the same change: **the IO is a parameter.**
 *
 * The Angular service injected `IpcService` and also reached past it to `window.joinery.explorer`
 * directly for the one call it had no wrapper for (`erd-adapter.service.ts:237`). Here every read
 * goes through a `SchemaReader` the caller supplies — `erd-schema-reader.ts` builds the real one out
 * of `ipc().explorer`. That is what makes the port parity cases in `erd-adapter.spec.ts` possible at
 * all: they are assertions about the transform, driven by recorded metadata, with no bridge and no
 * jsdom involved. It is also the house rule about surfacing side effects: a function that takes a
 * reader cannot hide a network call inside an innocent-looking helper, because it has nothing to
 * hide it in.
 *
 * ── One fixed bug, and it is the reason the database-level ERD never worked ─────────────────────
 *
 * `buildERDForDatabase` asked for `explorer.getChildren(connectionId, database, 'Tables')`.
 * `packages/main/src/ipc/explorer.ipc.ts:53` matches `parentPath === 'tables'`, lowercase, and its
 * final line is `return []`. So the whole-database ERD resolved zero tables, every time, on every
 * engine — a silent empty diagram with no error anywhere. `'Tables'` is the tree's *label*
 * (`state/explorer-folders.ts:27` pairs it with `type: 'tables'`); `'tables'` is the path. Fixed
 * here, and `erd-adapter.spec.ts` pins the literal so it cannot regress.
 *
 * That bug is also why nobody noticed the ERD had no theme: the only reachable ERD was the
 * sidebar's "Show Relationships", which is table-focused.
 */

import type { ColumnInfo, ForeignKeyInfo } from '@joinery/shared';

import type { ErdField, ErdNode } from './erd-model';

/** A table, as `listTables` names one. */
export interface TableRef {
  readonly schema: string;
  readonly name: string;
}

/**
 * The three metadata reads an ERD is built from. Deliberately narrower than the explorer bridge
 * namespace: this is the whole of what the ERD may ask the database for.
 */
export interface SchemaReader {
  /** Every table in the database, across schemas. */
  readonly listTables: (connectionId: string, databaseName: string) => Promise<readonly TableRef[]>;
  readonly columns: (
    connectionId: string,
    databaseName: string,
    schema: string,
    table: string
  ) => Promise<readonly ColumnInfo[]>;
  readonly foreignKeys: (
    connectionId: string,
    databaseName: string,
    schema: string,
    table: string
  ) => Promise<readonly ForeignKeyInfo[]>;
}

/** Where an ERD starts: a whole database, or one table and its relationships. */
export interface ErdRequest {
  readonly connectionId: string;
  readonly databaseName: string;
  /** Absent for a database-wide diagram. */
  readonly tableName?: string;
  /** Only read when `tableName` is set. */
  readonly schema?: string;
  /** FK hops to follow out from `tableName`. Only read when `tableName` is set. */
  readonly depth?: number;
}

/**
 * Concurrency for the whole-database build, ported verbatim (`erd-adapter.service.ts:245`).
 *
 * Each table costs two round trips, so a 200-table schema is 400 calls. Five at a time is 80
 * sequential rounds, which is what the Angular value bought: a bound on how hard the ERD leans on a
 * shared server, at the cost of latency it can afford because the diagram is not on the critical
 * path of anything.
 */
const BUILD_BATCH_SIZE = 5;

/**
 * The ceiling on a single diagram.
 *
 * The Angular version had none: `buildERDForTableWithRelations` was bounded only by the visited set
 * and `buildERDForDatabase` by the table count, so a 4,000-table warehouse would have issued 8,000
 * IPC calls to draw something unreadable. Hitting the cap is reported to the caller rather than
 * silently truncated — `ErdBuildResult.truncated` is what the panel turns into a visible notice.
 */
export const MAX_ERD_TABLES = 400;

export interface ErdBuildResult {
  readonly nodes: readonly ErdNode[];
  /** True when `MAX_ERD_TABLES` stopped the build before the schema ran out. */
  readonly truncated: boolean;
}

/**
 * Display type for one column, ported verbatim from `formatColumnType`
 * (`erd-adapter.service.ts:212-230`) including the two behaviours that look like bugs and are not:
 *
 *  - `maxLength === -1` → `(MAX)`. That is how SQL Server reports `varchar(max)`.
 *  - the `n`-prefixed types halve `maxLength`, because SQL Server reports `nvarchar` length in
 *    BYTES and the declared length is characters.
 *
 * Both are MSSQL facts applied to every engine, which is safe only because PostgreSQL and MySQL
 * report a character count that no `n`-prefixed type name is paired with. The one exception is
 * `numeric`, which starts with `n` — it is caught by the precision branch first, and the spec pins
 * that ordering.
 *
 * ONE deviation, chosen rather than ported: **an absent modifier omits the parentheses.** Angular
 * interpolated it, so a column whose `maxLength` the bridge does not report rendered as the literal
 * `nvarchar(undefined)` on the diagram and in the details rail (and `decimal(undefined, undefined)`
 * for the precision arm). `nvarchar` alone is honest — the length is unknown, not zero — and there is
 * no reading under which the word "undefined" in a type name is information. `-1` still wins over
 * this, so `varchar(MAX)` is unaffected.
 */
export function formatColumnType(column: ColumnInfo): string {
  const type = column.dataType.toLowerCase();

  if (type === 'decimal' || type === 'numeric') {
    if (column.precision === undefined || column.scale === undefined) return column.dataType;
    return `${column.dataType}(${column.precision}, ${column.scale})`;
  }

  if (LENGTH_TYPES.has(type)) {
    if (column.maxLength === -1) return `${column.dataType}(MAX)`;
    // The one deliberate divergence: an absent modifier drops the parens instead of interpolating
    // `undefined` into them. See the header.
    if (column.maxLength === undefined) return column.dataType;
    const declared =
      type.startsWith('n') && column.maxLength !== 0 ? column.maxLength / 2 : column.maxLength;
    return `${column.dataType}(${declared})`;
  }

  return column.dataType;
}

const LENGTH_TYPES = new Set(['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary']);

/**
 * Columns + foreign keys → the node's fields. The pure heart of the port
 * (`erd-adapter.service.ts:109-134` and `183-206`, which were split across two methods only because
 * one of them awaited).
 *
 * The FK lookup is by column name and **last writer wins**, exactly as the Angular original built
 * it (`fkMap.set(col, fk)` inside a loop over every constraint's every column). A column that
 * participates in two constraints therefore reports the second one; that is rare, it is what
 * shipped, and changing it silently would change which edges a diagram draws.
 *
 * `isIdentity` was hard-coded `false` with the comment "Not available in basic column info", and
 * still is — `ColumnInfo` carries no identity flag. `autoIncrement` is kept in the model because
 * the details panel would show it the moment the bridge grows one.
 */
export function erdFieldsFor(
  nodeId: string,
  columns: readonly ColumnInfo[],
  foreignKeys: readonly ForeignKeyInfo[]
): readonly ErdField[] {
  const byColumn = new Map<string, ForeignKeyInfo>();
  for (const key of foreignKeys) {
    for (const column of key.columns) byColumn.set(column, key);
  }

  return columns.map(column => {
    const key = byColumn.get(column.name);
    const field: ErdField = {
      id: `${nodeId}.${column.name}`,
      name: column.name,
      type: formatColumnType(column),
      isPrimaryKey: column.isPrimaryKey ?? false,
      allowsNull: column.isNullable,
      autoIncrement: false,
      ...(column.defaultValue === undefined ? {} : { defaultValue: column.defaultValue }),
    };

    if (key === undefined) return field;

    // Position-matched: a composite FK's third column references the third referenced column. The
    // `?? [0]` fallback is the Angular `||` and covers a server that reported fewer referenced
    // columns than referencing ones.
    const position = key.columns.indexOf(column.name);
    const referenced = key.referencedColumns[position] ?? key.referencedColumns[0];

    return {
      ...field,
      relatedNodeId: `${key.referencedSchema}.${key.referencedTable}`,
      relatedNodeName: key.referencedTable,
      ...(referenced === undefined ? {} : { relatedFieldName: referenced }),
      constraintName: key.name,
    };
  });
}

/** One table's node: two reads in parallel, then the pure transform above. */
export async function buildErdNode(
  reader: SchemaReader,
  connectionId: string,
  databaseName: string,
  schema: string,
  tableName: string
): Promise<ErdNode> {
  const nodeId = `${schema}.${tableName}`;
  const [columns, foreignKeys] = await Promise.all([
    reader.columns(connectionId, databaseName, schema, tableName),
    reader.foreignKeys(connectionId, databaseName, schema, tableName),
  ]);

  return {
    id: nodeId,
    name: tableName,
    schemaName: schema,
    fields: erdFieldsFor(nodeId, columns, foreignKeys),
  };
}

/**
 * One table and everything within `depth` FK hops of it.
 *
 * Ported from `buildERDForTableWithRelations` (`erd-adapter.service.ts:41-91`), including the shape
 * that matters: it follows only **outgoing** foreign keys. A table nobody points at shows its
 * parents; a lookup table opened this way shows itself alone, because finding its children would
 * need a reverse-FK query the bridge does not have. That asymmetry is why the sidebar opens these
 * with `focusDepth: 2` (`state/tab.ts`) — two hops of parents is usually the interesting shape.
 *
 * Rewritten from a `while (queue.length)` with an `await` inside — which serialised every table —
 * into a level-at-a-time walk that builds each hop's nodes concurrently. Same nodes, same set, one
 * round trip per LEVEL instead of one per table. The loop is bounded by `depth` (itself clamped) and
 * by `MAX_ERD_TABLES`.
 */
export async function buildErdForTable(
  reader: SchemaReader,
  request: ErdRequest & { readonly tableName: string }
): Promise<ErdBuildResult> {
  const { connectionId, databaseName, tableName } = request;
  const schema = request.schema ?? '';
  const depth = Math.max(0, Math.min(Math.trunc(request.depth ?? 1), MAX_ERD_DEPTH));

  const visited = new Set<string>();
  const nodes: ErdNode[] = [];
  let frontier: readonly TableRef[] = [{ schema, name: tableName }];
  let truncated = false;

  for (let hop = 0; hop <= depth && frontier.length > 0; hop += 1) {
    const wanted = frontier.filter(table => {
      const key = `${table.schema}.${table.name}`;
      if (visited.has(key)) return false;
      visited.add(key);
      return true;
    });

    const room = MAX_ERD_TABLES - nodes.length;
    if (wanted.length > room) truncated = true;
    const admitted = wanted.slice(0, Math.max(0, room));
    if (admitted.length === 0) break;

    const level = await Promise.all(
      admitted.map(table =>
        buildErdNode(reader, connectionId, databaseName, table.schema, table.name)
      )
    );
    nodes.push(...level);

    // The next hop is every table this level's foreign keys point AT. Already-visited targets are
    // filtered on the way in rather than here, so a diamond costs one entry, not two.
    frontier =
      hop === depth
        ? []
        : level.flatMap(node =>
            node.fields
              .filter(field => field.relatedNodeId !== undefined)
              .map(field => splitNodeId(field.relatedNodeId ?? ''))
          );
  }

  return { nodes, truncated };
}

/** The clamp on `ErdRequest.depth`, for the same reason `MAX_RELATED_DEPTH` exists. */
export const MAX_ERD_DEPTH = 6;

/**
 * Every table in the database.
 *
 * Ported from `buildERDForDatabase` (`erd-adapter.service.ts:235-258`) with the `'Tables'` →
 * `'tables'` fix in `erd-schema-reader.ts` and the `MAX_ERD_TABLES` ceiling added. The batching is
 * unchanged: `BUILD_BATCH_SIZE` tables at a time, awaited, so at most ten calls are in flight.
 */
export async function buildErdForDatabase(
  reader: SchemaReader,
  connectionId: string,
  databaseName: string
): Promise<ErdBuildResult> {
  const all = await reader.listTables(connectionId, databaseName);
  const tables = all.slice(0, MAX_ERD_TABLES);
  const nodes: ErdNode[] = [];

  for (let start = 0; start < tables.length; start += BUILD_BATCH_SIZE) {
    const batch = tables.slice(start, start + BUILD_BATCH_SIZE);
    const built = await Promise.all(
      batch.map(table => buildErdNode(reader, connectionId, databaseName, table.schema, table.name))
    );
    nodes.push(...built);
  }

  return { nodes, truncated: all.length > tables.length };
}

/** Either build, chosen by whether the request names a table. */
export function buildErd(reader: SchemaReader, request: ErdRequest): Promise<ErdBuildResult> {
  const { tableName } = request;
  return tableName === undefined
    ? buildErdForDatabase(reader, request.connectionId, request.databaseName)
    : buildErdForTable(reader, { ...request, tableName });
}

/**
 * `schema.table` back into its parts, splitting on the FIRST dot.
 *
 * Node ids are assembled as `${schema}.${table}`, and a table name may contain a dot while a schema
 * name reaching us from `referencedSchema` does not. MySQL has no schema layer, so its ids are
 * `.table` and the schema half is empty — which is exactly what `defaultSchema('mysql')` returns.
 */
export function splitNodeId(nodeId: string): TableRef {
  const dot = nodeId.indexOf('.');
  if (dot === -1) return { schema: '', name: nodeId };
  return { schema: nodeId.slice(0, dot), name: nodeId.slice(dot + 1) };
}
