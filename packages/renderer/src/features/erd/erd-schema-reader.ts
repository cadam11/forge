/**
 * The one impure line of the ERD: a `SchemaReader` over the explorer bridge.
 *
 * Separate from `erd-adapter.ts` on purpose. The adapter is a transform with a reader-shaped hole in
 * it, and this is the ten lines that fill the hole with IPC — so "where does the ERD touch the
 * database?" has a one-file answer, and the adapter's spec never has to stub a bridge.
 *
 * `'tables'`, lowercase, is load-bearing: see the bug note in `erd-adapter.ts`.
 */

import { ipc } from '../../ipc';
import type { SchemaReader, TableRef } from './erd-adapter';

/** The explorer `getChildren` path that lists a database's tables. Not the tree's `'Tables'` label. */
export const TABLES_PATH = 'tables';

export function ipcSchemaReader(): SchemaReader {
  return {
    listTables: async (connectionId, databaseName): Promise<readonly TableRef[]> => {
      const objects = await ipc().explorer.getChildren(connectionId, databaseName, TABLES_PATH);
      return objects.map(object => ({ schema: object.schema, name: object.name }));
    },
    columns: (connectionId, databaseName, schema, table) =>
      ipc().explorer.getTableColumns(connectionId, databaseName, schema, table),
    foreignKeys: (connectionId, databaseName, schema, table) =>
      ipc().explorer.getTableKeys(connectionId, databaseName, schema, table),
  };
}
