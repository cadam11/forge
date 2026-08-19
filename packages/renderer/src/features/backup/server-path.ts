/**
 * Server path arithmetic, for the server file browser and for the suggested backup destination.
 *
 * ── Why the separator is inferred rather than fixed ─────────────────────────────────────────
 *
 * SQL Server's own spelling is Windows: `xp_fixeddrives` reports `C:`, `xp_dirtree` walks `C:\…`, and
 * `packages/main/src/services/sql/server-filesystem.ts` validates against that shape. So `\` is the
 * default and the fallback.
 *
 * But **SQL Server on Linux reports POSIX paths for its own directories**. Measured, not assumed: on
 * the `joinery-test-mssql` container, `serverFs.getDefaultPaths` answers `/var/opt/mssql/data` while
 * `xp_dirtree 'C:\'` happily lists the same filesystem under a drive letter. Hard-coding `\` therefore
 * produced `/var/opt/mssql/data\master_….bak` as the suggested destination — a path with two
 * separators in it, which `BACKUP DATABASE TO DISK` would take literally. The Task 12 browser gate
 * caught exactly that.
 *
 * So every function here reads the separator off the path it is given, and only falls back to `\` when
 * the path says nothing (a bare name, or the empty drive-list path).
 *
 * Pure, and separated from the component for the reason the Angular original argues against itself:
 * `server-file-browser.component.ts:442-457` inlined its `goUp` as nine lines of index arithmetic with
 * a magic `lastSlash <= 2` for "we are at a drive root", and there was no test in the repo that could
 * tell whether `C:\` went up to the drive list or to a folder called `C`.
 */

import type { ServerFileEntry } from '@joinery/shared';

export type PathSeparator = '\\' | '/';

const WINDOWS: PathSeparator = '\\';
const POSIX: PathSeparator = '/';

/**
 * The separator a path is written with.
 *
 * Windows wins when both appear, because the only way a path holds both is a POSIX directory that
 * something already appended a backslash to — the bug this function exists to stop — and treating that
 * as Windows keeps the arithmetic on the character that was actually inserted.
 */
export function separatorOf(path: string): PathSeparator {
  if (path.includes(WINDOWS)) return WINDOWS;
  if (path.includes(POSIX)) return POSIX;
  return WINDOWS;
}

/** True for either separator. */
function isSeparator(character: string): boolean {
  return character === WINDOWS || character === POSIX;
}

/** The last separator of either kind, or -1. */
function lastSeparatorIndex(path: string): number {
  return Math.max(path.lastIndexOf(WINDOWS), path.lastIndexOf(POSIX));
}

/**
 * The top of one filesystem: a drive (`C:` / `C:\`) or the POSIX root (`/`). Its parent is the drive
 * list rather than a folder, and its own separator is part of its name.
 */
export function isDriveRoot(path: string): boolean {
  return path === POSIX || /^[A-Za-z]:[\\/]?$/.test(path);
}

/**
 * The path with any trailing separator removed — except on a drive root, where the separator is part of
 * the name. `C:\` stays `C:\` and `/` stays `/`; `C:\Backups\` becomes `C:\Backups`.
 */
export function trimTrailingSeparator(path: string): string {
  if (isDriveRoot(path)) return path;
  const last = path.slice(-1);
  return isSeparator(last) ? path.slice(0, -1) : path;
}

/**
 * `directory` + `name`, with exactly one separator between them and it the directory's own.
 *
 * A drive letter with no separator (`C:`) gains one, because `C:name` is a relative path on Windows and
 * means something else entirely.
 */
export function joinServerPath(directory: string, name: string): string {
  const separator = separatorOf(directory);
  const base = trimTrailingSeparator(directory);
  if (base === '') return name;
  if (isSeparator(base.slice(-1))) return `${base}${name}`;
  return `${base}${separator}${name}`;
}

/**
 * The containing directory, or `null` when the path is a drive root — which the browser renders as the
 * drive list, not as an empty folder. `''` also answers `null`: there is nothing above the list.
 */
export function parentServerPath(path: string): string | null {
  const trimmed = trimTrailingSeparator(path);
  if (trimmed === '' || isDriveRoot(trimmed)) return null;

  const index = lastSeparatorIndex(trimmed);
  if (index < 0) return null;
  // `/var` → `/`, not `''`: the POSIX root is a real directory, and `''` means the drive list.
  if (index === 0) return POSIX;

  const parent = trimmed.slice(0, index);
  // `C:\Backups` → `C:`, which has to come back as the browsable `C:\`.
  return isDriveRoot(parent) ? `${parent}${separatorOf(trimmed)}` : parent;
}

/**
 * The directory part of a full file path, for opening the browser where the user already is.
 * `C:\Backups\sales.bak` → `C:\Backups`. A bare directory answers itself.
 */
export function directoryOf(path: string): string {
  const trimmed = trimTrailingSeparator(path);
  if (trimmed === '' || isDriveRoot(trimmed)) return trimmed;
  return parentServerPath(trimmed) ?? '';
}

/** The leaf name of a path. `C:\Backups\sales.bak` → `sales.bak`. */
export function fileNameOf(path: string): string {
  const trimmed = trimTrailingSeparator(path);
  const index = lastSeparatorIndex(trimmed);
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/**
 * A drive letter's browsable root. Always Windows-spelled: drives come from `xp_fixeddrives`, which
 * reports `C:` whatever the host OS underneath is.
 */
export function driveRootPath(drive: string): string {
  return drive.endsWith(WINDOWS) ? drive : `${drive}${WINDOWS}`;
}

/**
 * Directories first, then names in locale order — and a **new array**, because the entries arrive from
 * a TanStack Query cache and `Array.prototype.sort` mutates in place. The Angular original sorted the
 * cached array itself.
 */
export function sortEntries(entries: readonly ServerFileEntry[]): ServerFileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/**
 * Entries narrowed to one extension, directories always kept so the user can still navigate.
 *
 * An extension of `undefined` keeps everything, and that is what `save` mode passes — the same split
 * the Angular original had (`server-file-browser.component.ts:390`), kept after trying the other way.
 * Filtering a save browser was the first version here, on the argument that a directory full of `.mdf`
 * and `.ldf` is noise. Two things make it wrong:
 *
 *  1. **A save browser is choosing a location, not a file.** What is already in the folder is context —
 *     including the files you would be sitting next to, and the one you would overwrite.
 *  2. **It compounds a main-process bug into a dead end.** `server-filesystem.ts:112` maps a `BIT`
 *     column with `row.isfile === 0`, and node-mssql returns a BIT as a **boolean** — so every entry
 *     comes back `isDirectory: false`, on both renderers. With the filter on, a folder whose contents
 *     are all misreported as non-matching files renders as "This folder is empty" and the browser
 *     cannot be navigated at all. The Task 12 browser gate hit exactly that against the live container.
 *     The bug is a main-process follow-up; not multiplying it is this module's part.
 */
export function filterEntries(
  entries: readonly ServerFileEntry[],
  extension: string | undefined
): ServerFileEntry[] {
  if (extension === undefined) return [...entries];
  const suffix = extension.startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`;
  return entries.filter(entry => entry.isDirectory || entry.name.toLowerCase().endsWith(suffix));
}
