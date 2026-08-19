/**
 * Pure folder-definition helpers for the explorer tree. Which folders a schema/table node
 * shows depends on the connection's engine capabilities (e.g. Aurora DSQL has no stored
 * procedures, functions, or triggers).
 *
 * Ported near-verbatim from `packages/renderer/src/app/core/state/explorer-folders.ts`: it had
 * no Angular in it to begin with, which is exactly why PLAN.md §1.6 lists it as a move rather
 * than a rewrite. The only edits are `type` → `NodeType`-compatible string literals staying as
 * `string` (the explorer store narrows them) and the doc comment above.
 */

import type { EngineCapabilities } from '@joinery/shared';

export interface SchemaFolderDef {
  name: string;
  type: string;
  icon: string;
}

export interface TableSubFolderDef {
  name: string;
  type: string;
}

export function schemaFolderDefs(caps: EngineCapabilities): SchemaFolderDef[] {
  const folders: SchemaFolderDef[] = [
    { name: 'Tables', type: 'tables', icon: 'table_chart' },
    { name: 'Views', type: 'views', icon: 'view_list' },
  ];
  if (caps.supportsStoredProcedures) {
    folders.push({ name: 'Stored Procedures', type: 'procedures', icon: 'functions' });
    folders.push({ name: 'Functions', type: 'functions', icon: 'calculate' });
  }
  return folders;
}

export function tableSubFolderDefs(caps: EngineCapabilities): TableSubFolderDef[] {
  const folders: TableSubFolderDef[] = [
    { name: 'Columns', type: 'columns_folder' },
    { name: 'Indexes', type: 'indexes_folder' },
    { name: 'Keys', type: 'keys_folder' },
    { name: 'Constraints', type: 'constraints_folder' },
  ];
  if (caps.supportsTriggers) {
    folders.push({ name: 'Triggers', type: 'triggers_folder' });
  }
  return folders;
}
