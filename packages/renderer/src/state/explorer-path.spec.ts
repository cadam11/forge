/**
 * The node-id scheme, and the proof that there is only one of it.
 *
 * The fixed strings below are the contract: the explorer store mints these ids and the object search's
 * reveal has to reassemble them from the outside, so a change to either half silently breaks the
 * reveal. Two things keep them honest:
 *
 * 1. the store IMPORTS these builders rather than interpolating its own — asserted by scanning
 *    `explorer.ts` for the literal patterns it used to contain;
 * 2. the ids the store actually produces are compared against the builders, through the real store with
 *    a mocked bridge, in the reveal tests of `shell/sidebar/sidebar.spec.tsx` and the object-search
 *    suite.
 */

import { describe, expect, it } from 'vitest';

import EXPLORER_SOURCE from './explorer.ts?raw';
import {
  databaseNodeId,
  explorerPathToObject,
  isRevealableObjectType,
  objectNodeId,
  schemaFolderNodeId,
  schemaNodeId,
  serverNodeId,
} from './explorer-path';

describe('the id builders', () => {
  it('spell each level the way the tree does', () => {
    expect(serverNodeId('c1')).toBe('server-c1');
    expect(databaseNodeId('c1', 'sales')).toBe('db-c1-sales');
    expect(schemaNodeId('c1', 'sales', 'public')).toBe('schema-c1-sales-public');
    expect(schemaFolderNodeId('c1', 'sales', 'public', 'tables')).toBe(
      'folder-c1-sales-public-tables'
    );
    expect(objectNodeId('c1', 'sales', 'public', 'orders')).toBe('obj-c1-sales-public.orders');
  });
});

describe('explorerPathToObject', () => {
  it('returns the four ancestors to expand plus the object itself', () => {
    expect(
      explorerPathToObject({
        connectionId: 'c1',
        databaseName: 'sales',
        schema: 'public',
        objectName: 'orders',
        objectType: 'table',
      })
    ).toEqual([
      'server-c1',
      'db-c1-sales',
      'schema-c1-sales-public',
      'folder-c1-sales-public-tables',
      'obj-c1-sales-public.orders',
    ]);
  });

  it('routes each object type to its own folder', () => {
    const folderOf = (objectType: string) =>
      explorerPathToObject({
        connectionId: 'c1',
        databaseName: 'sales',
        schema: 'public',
        objectName: 'thing',
        objectType,
      })?.[3];

    expect(folderOf('table')).toContain('-tables');
    expect(folderOf('view')).toContain('-views');
    expect(folderOf('procedure')).toContain('-procedures');
    expect(folderOf('function')).toContain('-functions');
  });

  it('is case-insensitive about the type, because the server is', () => {
    // `ObjectMetadata.type` arrives as whatever the metadata query returned; the explorer store
    // lower-cases it before using it as a `NodeType`, so this must too.
    expect(
      explorerPathToObject({
        connectionId: 'c1',
        databaseName: 'sales',
        schema: 'public',
        objectName: 'orders',
        objectType: 'TABLE',
      })
    ).not.toBeNull();
  });

  it('refuses a type the tree does not group', () => {
    expect(isRevealableObjectType('table')).toBe(true);
    expect(isRevealableObjectType('trigger')).toBe(false);
    expect(
      explorerPathToObject({
        connectionId: 'c1',
        databaseName: 'sales',
        schema: 'public',
        objectName: 'trg_audit',
        objectType: 'trigger',
      })
    ).toBeNull();
  });

  it('handles a MySQL object with no schema without inventing one', () => {
    // MySQL has no schema layer; `object-model.ts` leaves the slot empty and the tree's own ids do the
    // same, so the path is built from what is there rather than from `dbo`.
    const path = explorerPathToObject({
      connectionId: 'c1',
      databaseName: 'shop',
      schema: '',
      objectName: 'orders',
      objectType: 'table',
    });
    expect(path?.[2]).toBe('schema-c1-shop-');
    expect(path?.[4]).toBe('obj-c1-shop-.orders');
  });
});

describe('the explorer store has no second copy of the scheme', () => {
  it('imports the builders instead of interpolating ids', () => {
    // The literals this file replaced. Any of them coming back means two places mint ids, which is the
    // state that let the sidebar's own `revealServer` hand-assemble `server-${connectionId}`.
    for (const pattern of [
      /id: `server-\$\{/,
      /id: `db-\$\{/,
      /id: `schema-\$\{/,
      /id: `folder-\$\{/,
      /id: `obj-\$\{/,
    ]) {
      expect(
        EXPLORER_SOURCE,
        `explorer.ts still builds an id inline: ${pattern.source}`
      ).not.toMatch(pattern);
    }
    expect(EXPLORER_SOURCE).toContain("from './explorer-path'");
  });
});
