/**
 * The explorer tree's node-id scheme, as data — the path from the root down to one object.
 *
 * `state/explorer.ts` mints these ids inline as it builds nodes (`server-${id}`,
 * `db-${id}-${name}`, …) and the sidebar's `revealServer` already hand-assembled one of them
 * (`sidebar.tsx:68`). Task 16's object search needs the whole chain: to show a table it has to expand
 * server → database → schema → folder before the row exists to scroll to. Writing that chain out at
 * the call site would put the id format in a second place, so it lives here, pure and tested, and the
 * store's own literals are checked against it by `explorer-path.spec.ts`.
 *
 * Pure on purpose: no store, no IPC. The *walking* of the path — awaiting each lazy expand — is a
 * side effect and belongs with the other explorer side effects (`shell/sidebar/node-actions.ts`).
 */

/** Which schema folder an object of a given type sits in. Keyed by the lower-cased server type. */
const FOLDER_FOR_OBJECT_TYPE: Record<string, string> = {
  table: 'tables',
  view: 'views',
  procedure: 'procedures',
  function: 'functions',
};

/** The object types the tree can reveal. Anything else has no folder to expand. */
export function isRevealableObjectType(objectType: string): boolean {
  return FOLDER_FOR_OBJECT_TYPE[objectType.toLowerCase()] !== undefined;
}

export interface ExplorerObjectTarget {
  readonly connectionId: string;
  readonly databaseName: string;
  readonly schema: string;
  readonly objectName: string;
  /** `table` / `view` / `procedure` / `function`, as `ObjectMetadata.type` spells it. */
  readonly objectType: string;
}

export function serverNodeId(connectionId: string): string {
  return `server-${connectionId}`;
}

export function databaseNodeId(connectionId: string, databaseName: string): string {
  return `db-${connectionId}-${databaseName}`;
}

export function schemaNodeId(connectionId: string, databaseName: string, schema: string): string {
  return `schema-${connectionId}-${databaseName}-${schema}`;
}

/** `folderType` is `schemaFolderDefs`' `type`: `tables`, `views`, `procedures`, `functions`. */
export function schemaFolderNodeId(
  connectionId: string,
  databaseName: string,
  schema: string,
  folderType: string
): string {
  return `folder-${connectionId}-${databaseName}-${schema}-${folderType}`;
}

export function objectNodeId(
  connectionId: string,
  databaseName: string,
  schema: string,
  objectName: string
): string {
  return `obj-${connectionId}-${databaseName}-${schema}.${objectName}`;
}

/**
 * The ids to expand, in order, ending with the object's own node.
 *
 * The last element is the node to select and scroll to; **every element before it is a node that has
 * to be expanded first**, because the tree loads children lazily and a row that has not been
 * fetched cannot be scrolled to. `null` when the object type has no folder in the tree, which is the
 * honest answer for a type the explorer does not group (rather than a path that expands three levels
 * and then finds nothing).
 */
export function explorerPathToObject(target: ExplorerObjectTarget): readonly string[] | null {
  const folderType = FOLDER_FOR_OBJECT_TYPE[target.objectType.toLowerCase()];
  if (folderType === undefined) return null;

  const { connectionId, databaseName, schema, objectName } = target;
  return [
    serverNodeId(connectionId),
    databaseNodeId(connectionId, databaseName),
    schemaNodeId(connectionId, databaseName, schema),
    schemaFolderNodeId(connectionId, databaseName, schema, folderType),
    objectNodeId(connectionId, databaseName, schema, objectName),
  ];
}
