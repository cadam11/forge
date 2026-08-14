import { describe, it, expect } from 'vitest';
import { FULL_CAPABILITIES } from '@forgedb/shared';
import { schemaFolderDefs, tableSubFolderDefs } from './explorer-folders';

const DSQL_CAPS = {
  ...FULL_CAPABILITIES,
  supportsStoredProcedures: false,
  supportsTriggers: false,
};

describe('schemaFolderDefs', () => {
  it('returns all four folders for a fully-capable engine', () => {
    expect(schemaFolderDefs(FULL_CAPABILITIES).map(f => f.name)).toEqual([
      'Tables',
      'Views',
      'Stored Procedures',
      'Functions',
    ]);
  });

  it('omits procedure/function folders when unsupported', () => {
    expect(schemaFolderDefs(DSQL_CAPS).map(f => f.name)).toEqual(['Tables', 'Views']);
  });
});

describe('tableSubFolderDefs', () => {
  it('returns all five sub-folders for a fully-capable engine', () => {
    expect(tableSubFolderDefs(FULL_CAPABILITIES).map(f => f.name)).toEqual([
      'Columns',
      'Indexes',
      'Keys',
      'Constraints',
      'Triggers',
    ]);
  });

  it('omits Triggers when unsupported', () => {
    expect(tableSubFolderDefs(DSQL_CAPS).map(f => f.name)).toEqual([
      'Columns',
      'Indexes',
      'Keys',
      'Constraints',
    ]);
  });
});
