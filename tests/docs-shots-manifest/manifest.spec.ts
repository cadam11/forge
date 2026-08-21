/**
 * Assemble `docs-site/src/assets/screenshots/screenshots.manifest.json` from the run that just
 * finished, and refuse to write a partial one.
 *
 * ── Why this is a Playwright project rather than a script ────────────────────────────────────
 *
 * `plans/docs-site/PROPOSAL.md` §6.3 accepts that screenshots rot silently and buys one cheap guard
 * against it: a sidecar recording the app version and the git SHA of the capture run. The sidecar is
 * only worth anything if it describes the *whole* set, so it is written by the `docs-shots`
 * project's `teardown` — one `playwright test` invocation captures and then records, and a run that
 * lost a shot fails here instead of quietly shrinking the manifest.
 *
 * It also keeps the toolchain to one: the catalogue is TypeScript (it is imported by `capture()`),
 * and a `.mjs` build script could not read it without a second compiler in the loop.
 *
 * ── What is in the file, and what is deliberately not ─────────────────────────────────────────
 *
 * In: the app version, the git SHA and whether the tree was dirty, the geometry every shot shares,
 * and one entry per file naming the surface, the theme, the spec that produced it and the pages it
 * was captured for. That is the "re-capture is a command, not archaeology" contract.
 *
 * **Not in: a capture timestamp.** It would churn the file on every run and it would make two
 * identical capture runs produce two different manifests — which is exactly the property the
 * determinism gate for this harness is checking. The git SHA already says when.
 */

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { DOCS_SHOTS, declaredFiles } from '../docs-shots/catalogue';
import { RECORDS_DIR, SHOTS_DIR, type ShotRecord } from '../docs-shots/paths';

const REPO_ROOT = join(__dirname, '..', '..');
const MANIFEST_PATH = join(SHOTS_DIR, 'screenshots.manifest.json');

/** What `git` says about the tree the capture ran against. */
interface GitState {
  readonly sha: string;
  readonly dirty: boolean;
}

function gitState(): GitState {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const status = execFileSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  // The screenshots and the manifest are themselves written by this run, so they are always in
  // `status` by the time it is read. "Dirty" here means anything ELSE was uncommitted — which is
  // what a reader of the manifest wants to know when the SHA does not explain a shot.
  const shotsPrefix = `${relative(REPO_ROOT, SHOTS_DIR)}/`;
  const otherChanges = status
    .split('\n')
    .filter(line => line.trim().length > 0)
    .filter(line => !line.slice(3).startsWith(shotsPrefix));
  return { sha: sha.trim(), dirty: otherChanges.length > 0 };
}

/** The version the app reports, read from the same `package.json` Electron reports it from. */
function appVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
  const version =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== 'string') {
    throw new Error('[docs-shots] the root package.json has no string `version`');
  }
  return version;
}

/** Every record the capture run dropped, keyed by file name. */
function collectRecords(): Map<string, ShotRecord> {
  if (!existsSync(RECORDS_DIR)) return new Map();
  const records = new Map<string, ShotRecord>();
  for (const entry of readdirSync(RECORDS_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(join(RECORDS_DIR, entry), 'utf8')) as ShotRecord;
    records.set(parsed.file, parsed);
  }
  return records;
}

test.describe('docs shots — manifest', () => {
  test('every declared shot was captured, and the sidecar records the set', () => {
    const declared = declaredFiles();
    const records = collectRecords();

    // Both directions, because both are real failures. A declared file with no record means a spec
    // stopped capturing; a record with no declaration means a spec captured something the set does
    // not contain — though `capture()` refuses that at source, so this is the belt to its braces.
    const missing = declared.filter(file => !records.has(file));
    expect(
      missing,
      'the capture run did not produce every shot tests/docs-shots/catalogue.ts declares — ' +
        'run `pnpm run docs:shots` again rather than committing a partial set'
    ).toEqual([]);
    const undeclared = [...records.keys()].filter(file => !declared.includes(file));
    expect(undeclared, 'a record exists for a file the catalogue does not declare').toEqual([]);

    // The PNGs themselves, not just the records: a record is written after the file, so a missing
    // file here means something removed it between the capture and now.
    const absent = declared.filter(file => !existsSync(join(SHOTS_DIR, file)));
    expect(absent, 'a recorded screenshot is not on disk').toEqual([]);

    const pagesByShot = new Map(DOCS_SHOTS.map(shot => [shot.name, shot.pages]));
    const shots = declared.map(file => {
      const record = records.get(file);
      if (record === undefined) throw new Error(`[docs-shots] no record for ${file}`);
      return {
        file: record.file,
        shot: record.name,
        surface: record.surface,
        theme: record.theme,
        spec: record.spec,
        pages: pagesByShot.get(record.name) ?? [],
        viewport: record.viewport,
        deviceScaleFactor: record.deviceScaleFactor,
        bytes: record.bytes,
      };
    });

    // One geometry for the whole set, asserted rather than assumed: a manifest that stated a
    // viewport some of its shots were not captured at would be worse than one that stated none.
    const geometries = new Set(
      shots.map(shot => `${shot.viewport.width}x${shot.viewport.height}@${shot.deviceScaleFactor}`)
    );
    expect(
      [...geometries],
      'the set was captured at more than one geometry — every shot in it shares one'
    ).toHaveLength(1);

    const git = gitState();
    const manifest = {
      $comment:
        'Generated by `pnpm run docs:shots` (Playwright project docs-shots). Do not hand-edit — ' +
        'add a shot to tests/docs-shots/catalogue.ts and capture it from a spec.',
      appVersion: appVersion(),
      gitSha: git.sha,
      gitDirty: git.dirty,
      viewport: shots[0]?.viewport,
      deviceScaleFactor: shots[0]?.deviceScaleFactor,
      shots: shots.map(({ viewport: _viewport, deviceScaleFactor: _dpr, ...rest }) => rest),
    };

    mkdirSync(SHOTS_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    // Consume the records now that they are in the manifest, so a later run that captures only some
    // of the set cannot be completed by this run's leftovers and pass the check above.
    rmSync(RECORDS_DIR, { recursive: true, force: true });
  });
});
