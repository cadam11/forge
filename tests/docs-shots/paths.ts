/**
 * Where the documentation shots and their per-capture records live, and what a record is.
 *
 * Split out of `fixtures.ts` so the manifest project (`tests/docs-shots-manifest/`) can import the
 * two paths and the record shape without pulling in the Electron launcher and the whole
 * `tests/helpers/react/` barrel — `pg`, `mysql2` and `mssql` among them — to write a JSON file.
 */

import { join } from 'node:path';

import type { DocsTheme } from './catalogue';

// Playwright's TS loader emits CJS, so `__dirname` is available natively — the same reason
// `electron-app.ts` avoids `import.meta.url`.
const REPO_ROOT = join(__dirname, '..', '..');

/** Where the committed PNGs live. Consumed by the docs site, not by any assertion. */
export const SHOTS_DIR = join(REPO_ROOT, 'docs-site', 'src', 'assets', 'screenshots');

/**
 * Where each capture drops its record for the manifest step to collect.
 *
 * Under `.cache/`, which the root `.gitignore` excludes: these are scratch, and the only thing that
 * survives a run is the manifest assembled from them. The manifest step deletes them once it has,
 * so a later partial run cannot be completed by a previous run's leftovers.
 */
export const RECORDS_DIR = join(REPO_ROOT, 'tests', 'reports', '.cache', 'docs-shots-records');

/** One capture, as written to `RECORDS_DIR` and then folded into the manifest. */
export interface ShotRecord {
  readonly file: string;
  readonly name: string;
  readonly theme: DocsTheme;
  readonly surface: string;
  /** Repo-relative path of the spec that produced it. */
  readonly spec: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
  readonly bytes: number;
}
