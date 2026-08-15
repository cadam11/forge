/**
 * Pure folder-definition helpers for the explorer tree. Which folders a
 * schema/table node shows depends on the connection's engine capabilities
 * (e.g. Aurora DSQL has no stored procedures, functions, or triggers).
 * Kept free of Angular/IPC dependencies so they are trivially testable.
 */

import type { EngineCapabilities } from '@forgedb/shared';

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
