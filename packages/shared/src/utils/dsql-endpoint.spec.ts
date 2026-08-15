import { describe, it, expect } from 'vitest';
import { isDsqlEndpoint, dsqlRegionFromEndpoint } from './dsql-endpoint';

describe('isDsqlEndpoint', () => {
  it.each([
    ['abc123def.dsql.us-east-1.on.aws', true],
    ['abc123def.dsql-fips.ca-central-1.on.aws', true],
    ['ABC123.DSQL.US-EAST-1.ON.AWS', true],
    ['mydb.rds.amazonaws.com', false],
    ['localhost', false],
    ['dsql.us-east-1.on.aws', false],
    ['abc.dsql.on.aws', false],
    ['', false],
  ])('%s → %s', (host, expected) => {
    expect(isDsqlEndpoint(host)).toBe(expected);
  });
});

describe('dsqlRegionFromEndpoint', () => {
  it('extracts the region', () => {
    expect(dsqlRegionFromEndpoint('abc123.dsql.eu-west-2.on.aws')).toBe('eu-west-2');
    expect(dsqlRegionFromEndpoint('abc123.dsql-fips.us-east-2.on.aws')).toBe('us-east-2');
  });
  it('returns undefined for non-DSQL hosts', () => {
    expect(dsqlRegionFromEndpoint('mydb.rds.amazonaws.com')).toBeUndefined();
  });
});
