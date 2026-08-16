/**
 * What the object search searches, and what opening a result means. Pure — no stores, no IPC, no
 * React, so the ranking and the SQL are testable on fixtures.
 *
 * Ported from `shared/components/object-search/object-search.component.ts` (488) with two behavioural
 * fixes, both of the same family as the one Task 14 found in `fetchFkRecord`:
 *
 * 1. **The SQL is per-engine.** The Angular version emitted `SELECT TOP 1000 * FROM [schema].[name]`
 *    and `EXEC [schema].[name]` unconditionally (`:477,483`) — T-SQL brackets and T-SQL syntax on
 *    PostgreSQL and MySQL, where they are a syntax error. Every statement here comes from
 *    `shell/sidebar/sql-text.ts`, which is the app's one per-engine SQL generator and is what the
 *    sidebar's identical context-menu items already use.
 * 2. **A MySQL schema is not a schema.** `mapToSearchable` defaulted a missing schema to `'dbo'`
 *    (`:426`), so a MySQL object with no schema was addressed as `dbo.orders`. `defaultSchema(engine)`
 *    answers per engine, and `qualifiedTable` drops the qualifier entirely on MySQL.
 */

import type { DatabaseEngine, ObjectMetadata } from '@joinery/shared';

import {
  defaultSchema,
  executeProcedure,
  qualifiedTable,
  selectWithLimit,
} from '../../shell/sidebar/sql-text';

/** The object kinds the explorer groups, and therefore the ones this can search and reveal. */
export const SEARCHABLE_OBJECT_TYPES = ['table', 'view', 'procedure', 'function'] as const;

export type SearchableObjectType = (typeof SEARCHABLE_OBJECT_TYPES)[number];

/**
 * One folder of a schema, as both the explorer path to fetch and the type its contents are.
 *
 * The `path` values are exactly the ones `state/explorer-folders.ts` gives the tree's folder nodes,
 * because they are the same IPC call with the same argument — `explorer.getChildren(connectionId,
 * database, path)`. Keeping them equal is what makes a reveal land on the folder the search read from.
 */
export const OBJECT_FOLDERS: readonly {
  readonly path: string;
  readonly type: SearchableObjectType;
  readonly label: string;
}[] = [
  { path: 'tables', type: 'table', label: 'Table' },
  { path: 'views', type: 'view', label: 'View' },
  { path: 'procedures', type: 'procedure', label: 'Stored procedure' },
  { path: 'functions', type: 'function', label: 'Function' },
];

export interface SearchableObject {
  readonly connectionId: string;
  readonly database: string;
  readonly schema: string;
  readonly name: string;
  readonly type: SearchableObjectType;
  /** "Table", "Stored procedure" — the label the row shows. */
  readonly typeLabel: string;
}

/** `schema.name`, unquoted — the string the user searches and the row shows. */
export function qualifiedName(object: SearchableObject): string {
  return object.schema.length === 0 ? object.name : `${object.schema}.${object.name}`;
}

/**
 * One metadata record as a searchable object.
 *
 * The server's own schema wins; `defaultSchema(engine)` fills in only when it said nothing, which on
 * MySQL is the empty string — MySQL has no schema layer between database and table, so inventing one
 * would produce a two-part name that names nothing.
 */
export function toSearchableObject(
  metadata: ObjectMetadata,
  folder: { readonly type: SearchableObjectType; readonly label: string },
  context: {
    readonly connectionId: string;
    readonly database: string;
    readonly engine: DatabaseEngine;
  }
): SearchableObject {
  return {
    connectionId: context.connectionId,
    database: context.database,
    schema: metadata.schema || defaultSchema(context.engine),
    name: metadata.name,
    type: folder.type,
    typeLabel: folder.label,
  };
}

/** Rows a table or view opens with. The sidebar's "Select Top 1000 Rows" limit, deliberately equal. */
export const OBJECT_SEARCH_ROW_LIMIT = 1000;

export interface ObjectOpenPlan {
  readonly sql: string;
  /**
   * Whether opening runs it.
   *
   * `true` only for the row-limited SELECT of a table or view, which is the same rule the sidebar
   * applies to the same affordance: an action executes on open **only when its label promises it**
   * (Ruling 13, and `shell/sidebar/node-actions.ts`'s header). A `CALL` with unknown arguments must
   * never run itself, so procedures and functions open as text.
   */
  readonly autoExecute: boolean;
  /** What the row's trailing hint says will happen, so the promise is visible before Enter. */
  readonly promise: string;
}

/**
 * The statement opening an object produces, per engine.
 *
 * A function is `SELECT schema.fn()`, which is valid on all three engines for a scalar function and
 * is what the Angular version emitted (minus its T-SQL quoting). It is not executed, so a
 * table-valued function that needs `FROM` is a one-word edit rather than an error toast.
 */
export function planObjectOpen(object: SearchableObject, engine: DatabaseEngine): ObjectOpenPlan {
  const reference = qualifiedTable(object.schema, object.name, engine);

  switch (object.type) {
    case 'table':
    case 'view':
      return {
        sql: selectWithLimit(reference, OBJECT_SEARCH_ROW_LIMIT, engine),
        autoExecute: true,
        promise: `Top ${OBJECT_SEARCH_ROW_LIMIT}`,
      };
    case 'procedure':
      return {
        sql: executeProcedure(reference, engine),
        autoExecute: false,
        promise: 'Call',
      };
    case 'function':
      return { sql: `SELECT ${reference}()`, autoExecute: false, promise: 'Select' };
  }
}
