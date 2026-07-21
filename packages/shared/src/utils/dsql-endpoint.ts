/**
 * Aurora DSQL cluster endpoints look like <id>.dsql.<region>.on.aws
 * (or .dsql-fips. in FIPS regions). Used by the connection dialog to
 * auto-suggest IAM auth and by DSQL detection short-circuits.
 */

const DSQL_ENDPOINT_RE = /^[a-z0-9-]+\.dsql(?:-fips)?\.([a-z0-9-]+)\.on\.aws$/i;

export function isDsqlEndpoint(host: string): boolean {
  return DSQL_ENDPOINT_RE.test(host.trim());
}

export function dsqlRegionFromEndpoint(host: string): string | undefined {
  const match = DSQL_ENDPOINT_RE.exec(host.trim());
  return match?.[1]?.toLowerCase();
}
