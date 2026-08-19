/**
 * The server-side file browser: drives and directories on the **database server's** filesystem,
 * read through `xp_fixeddrives` / `xp_dirtree`.
 *
 * Replaces `shared/components/server-file-browser/server-file-browser.component.ts` (505 LOC).
 * Task 13's restore wizard consumes it, which is why it takes a `mode` and knows nothing about
 * backups.
 *
 * ── Why this is a step, not a second dialog ─────────────────────────────────────────────────
 *
 * The Angular version was a `MatDialog` opened from inside the already-open backup dialog. PLAN.md
 * §2.9's objection to stacking is concrete: two scrims, two focus traps, and a browser whose Escape
 * closes only the top one while the form behind it is still modal. So this component renders the
 * **body and action row of its host's dialog** — a `DialogBody` and a `DialogActions`, the same two
 * parts the form uses — and the host swaps them in. One dialog, one scrim, one focus trap, and the
 * form's `react-hook-form` state survives because `shouldUnregister` is false: the inputs unmount,
 * their values do not.
 *
 * The consequence for a host: the header's title has to change too, because the dialog is now
 * showing something else. `backup-dialog.tsx` does that, and Task 13 must as well.
 *
 * ── Two IPC reads, one at a time ────────────────────────────────────────────────────────────
 *
 * `''` means "show the drive list"; anything else is a directory listing. Exactly one of the two
 * queries is `enabled` at a time, so there is never a spinner for a request nobody is waiting on,
 * and both are cached per path — walking back up a tree is instant on the second visit. The
 * Angular original re-fetched on every navigation and held the result in a signal.
 */

import { useRef, useState, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowRight,
  ArrowUp,
  File as FileIcon,
  Folder,
  FolderOpen,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import type { ServerDrive, ServerFileEntry } from '@joinery/shared';

import {
  Button,
  DialogActions,
  DialogBody,
  EmptyState,
  Icon,
  Input,
  Spinner,
  Tooltip,
  cn,
} from '../../ui';
import { useIpcQuery } from '../../ipc';
import { FormNote } from '../forms';
import { formatBytes } from './backup-model';
import {
  directoryOf,
  driveRootPath,
  fileNameOf,
  filterEntries,
  joinServerPath,
  parentServerPath,
  sortEntries,
} from './server-path';

/**
 * A dynamic pixel value reaches CSS through a custom property and a utility reads it, per
 * `general.md` — the same shape `ui/tree.tsx` uses, and for the same reason: the class list stays the
 * styling surface. The cast is unavoidable; `CSSProperties` has no index signature for custom props.
 */
function cssVars(vars: Readonly<Record<string, string>>): CSSProperties {
  return vars as unknown as CSSProperties;
}

/** 24px rows, `text-sm` — the dense rung HOUSE-RULES §2 assigns to lists of this kind. */
const ROW_HEIGHT = 24;
/** Two screenfuls of overscan at this row height. */
const OVERSCAN = 12;
/** The rect assumed before the scroll element is measured, so the first paint fills the list. */
const INITIAL_VISIBLE_ROWS = 12;

export interface ServerFilePick {
  /** The full path the host should use. In `save` mode this is directory + typed file name. */
  readonly path: string;
  readonly fileName: string;
}

export interface ServerFileBrowserProps {
  readonly connectionId: string;
  /** `save` adds a file-name box and allows a name that does not exist yet. */
  readonly mode: 'open' | 'save';
  /** A full **file** path to open beside — its directory is where browsing starts. */
  readonly initialPath?: string;
  /** Extension to narrow the listing to, without the dot. Directories are always shown. */
  readonly extension?: string;
  readonly defaultFileName?: string;
  readonly onCancel: () => void;
  readonly onPick: (pick: ServerFilePick) => void;
}

export function ServerFileBrowser({
  connectionId,
  mode,
  initialPath,
  extension,
  defaultFileName,
  onCancel,
  onPick,
}: ServerFileBrowserProps) {
  /** `''` is the drive list. Initialised from the caller's path, so the browser opens where they are. */
  const [currentPath, setCurrentPath] = useState<string>(() =>
    initialPath === undefined ? '' : directoryOf(initialPath)
  );
  /** What the path box holds. Separate from `currentPath` so typing does not fetch per keystroke. */
  const [pathDraft, setPathDraft] = useState<string>(currentPath);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>(
    () => defaultFileName ?? (initialPath === undefined ? '' : fileNameOf(initialPath))
  );

  const showingDrives = currentPath === '';

  const drives = useIpcQuery({
    namespace: 'serverFs',
    operation: 'getDrives',
    args: [connectionId],
    keyArgs: [connectionId],
    enabled: showingDrives,
    retry: false,
  });

  const listing = useIpcQuery({
    namespace: 'serverFs',
    operation: 'listDirectory',
    args: [connectionId, currentPath, true],
    keyArgs: [connectionId, currentPath],
    enabled: !showingDrives,
    retry: false,
  });

  const active = showingDrives ? drives : listing;
  // The extension narrows an OPEN, never a save — see `filterEntries` for the two reasons, the second
  // of which is a live main-process bug this must not compound.
  const narrowTo = mode === 'open' ? extension : undefined;
  const entries = sortEntries(filterEntries(listing.data ?? [], narrowTo));

  const navigate = (path: string): void => {
    setCurrentPath(path);
    setPathDraft(path);
    setSelectedPath(null);
  };

  const openEntry = (entry: ServerFileEntry): void => {
    if (entry.isDirectory) {
      navigate(entry.path);
      return;
    }
    // A double-click on a file is a pick in both modes — in `save` it means "overwrite this one",
    // which the name box already shows because selecting it wrote the name.
    onPick({ path: entry.path, fileName: entry.name });
  };

  const selectEntry = (entry: ServerFileEntry): void => {
    setSelectedPath(entry.path);
    if (!entry.isDirectory && mode === 'save') setFileName(entry.name);
  };

  const parent = parentServerPath(currentPath);
  const selectedEntry = entries.find(entry => entry.path === selectedPath) ?? null;

  /**
   * Whether the action row's primary is usable, and it differs by mode for a real reason: a save
   * needs a directory plus a name, an open needs an existing file. A directory selected in `open`
   * mode is a navigation target, not an answer.
   */
  const pick: ServerFilePick | null =
    mode === 'save'
      ? currentPath !== '' && fileName.trim() !== ''
        ? { path: joinServerPath(currentPath, fileName.trim()), fileName: fileName.trim() }
        : null
      : selectedEntry !== null && !selectedEntry.isDirectory
        ? { path: selectedEntry.path, fileName: selectedEntry.name }
        : null;

  return (
    <>
      <DialogBody className="flex flex-col gap-3" data-testid="backup-file-browser">
        <div className="flex items-end gap-1">
          <Tooltip content="Up one level">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              leadingIcon={ArrowUp}
              aria-label="Up one level"
              data-testid="backup-file-browser-up"
              disabled={currentPath === ''}
              onClick={() => navigate(parent ?? '')}
            />
          </Tooltip>
          <Tooltip content="Refresh">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              leadingIcon={RefreshCw}
              aria-label="Refresh"
              data-testid="backup-file-browser-refresh"
              disabled={active.isFetching}
              onClick={() => void active.refetch()}
            />
          </Tooltip>
          <Input
            label="Path"
            name="serverPath"
            fieldClassName="flex-1"
            className="font-mono"
            placeholder="C:\Backups"
            value={pathDraft}
            data-testid="backup-file-browser-path"
            onChange={event => setPathDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              // Enter in the path box navigates; it must not reach the host form and submit it.
              event.preventDefault();
              navigate(pathDraft.trim());
            }}
          />
          <Tooltip content="Go to this path">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              leadingIcon={ArrowRight}
              aria-label="Go to this path"
              data-testid="backup-file-browser-go"
              onClick={() => navigate(pathDraft.trim())}
            />
          </Tooltip>
        </div>

        {active.error !== null ? (
          <EmptyState
            size="sm"
            icon={FolderOpen}
            title="That location could not be read"
            description={active.error.message}
            data-testid="backup-file-browser-error"
            action={
              <Button variant="outline" size="sm" onClick={() => void active.refetch()}>
                Try again
              </Button>
            }
          />
        ) : active.isPending ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner label={showingDrives ? 'Reading drives…' : 'Reading the folder…'} />
          </div>
        ) : showingDrives ? (
          <DriveGrid drives={drives.data ?? []} onOpen={drive => navigate(driveRootPath(drive))} />
        ) : (
          <EntryList
            entries={entries}
            selectedPath={selectedPath}
            onSelect={selectEntry}
            onOpen={openEntry}
          />
        )}

        {mode === 'save' ? (
          <Input
            label="File name"
            name="serverFileName"
            className="font-mono"
            placeholder={defaultFileName ?? 'backup.bak'}
            value={fileName}
            data-testid="backup-file-browser-filename"
            onChange={event => setFileName(event.target.value)}
          />
        ) : null}

        {/* Only when something is actually being hidden. A note claiming a filter that is not applied
            is worse than no note — it makes an empty folder look like the filter's doing. */}
        {narrowTo === undefined ? null : (
          <FormNote data-testid="backup-file-browser-filter">
            Showing folders and .{narrowTo} files.
          </FormNote>
        )}
      </DialogBody>

      <DialogActions>
        <Button variant="ghost" data-testid="backup-file-browser-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={pick === null}
          data-testid="backup-file-browser-confirm"
          onClick={() => {
            if (pick !== null) onPick(pick);
          }}
        >
          {mode === 'save' ? 'Use this path' : 'Select'}
        </Button>
      </DialogActions>
    </>
  );
}

/**
 * The drive tiles. A grid of buttons rather than a list, because a drive letter is a short label and
 * the free-space figure belongs beside it — and `@container`, not a viewport breakpoint, per
 * HOUSE-RULES §1: this sits inside a dialog whose width is fixed by its size class, not by the window.
 */
function DriveGrid({
  drives,
  onOpen,
}: {
  readonly drives: readonly ServerDrive[];
  readonly onOpen: (drive: string) => void;
}) {
  if (drives.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={HardDrive}
        title="No drives reported"
        description="The server returned no fixed drives. Type a path above to browse it directly."
        data-testid="backup-file-browser-empty"
      />
    );
  }

  return (
    <div className="@container">
      <ul
        className="grid grid-cols-2 gap-2 @md:grid-cols-3"
        data-testid="backup-file-browser-drives"
      >
        {drives.map(drive => (
          <li key={drive.drive}>
            <button
              type="button"
              data-testid="backup-file-browser-drive"
              className={cn(
                'flex w-full items-center gap-2 rounded-sm border border-rule bg-surface px-2 py-1.5 text-left',
                'hover:bg-hover',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
              )}
              onClick={() => onOpen(drive.drive)}
            >
              <Icon icon={HardDrive} size="md" className="shrink-0 stroke-fg-muted" />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-base text-fg">{drive.drive}</span>
                <span className="block text-sm text-fg-muted tabular-nums">
                  {formatBytes(drive.freeSpaceMB * 1024 * 1024)} free
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The directory listing, virtualized.
 *
 * Virtualized from the start rather than as later perf debt (PLAN.md §2's trees row): a SQL Server
 * data directory routinely holds thousands of `.mdf`/`.ldf` files, and the Angular list rendered
 * every one of them into a 400px box.
 */
function EntryList({
  entries,
  selectedPath,
  onSelect,
  onOpen,
}: {
  readonly entries: readonly ServerFileEntry[];
  readonly selectedPath: string | null;
  readonly onSelect: (entry: ServerFileEntry) => void;
  readonly onOpen: (entry: ServerFileEntry) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The React Compiler is not enabled in this build (see vite.config.ts and `ui/tree.tsx`'s copy of
  // this note), so the memoization this rule protects is not happening either way.
  // eslint-disable-next-line react-hooks/incompatible-library -- see above
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: { width: 0, height: ROW_HEIGHT * INITIAL_VISIBLE_ROWS },
  });

  if (entries.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={FolderOpen}
        title="This folder is empty"
        data-testid="backup-file-browser-empty"
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-48 overflow-y-auto rounded-sm border border-rule bg-surface"
      data-testid="backup-file-browser-list"
    >
      <div
        role="presentation"
        className="relative h-(--entries-height) w-full"
        style={cssVars({ '--entries-height': `${virtualizer.getTotalSize()}px` })}
      >
        {virtualizer.getVirtualItems().map(item => {
          const entry = entries[item.index];
          if (entry === undefined) return null;
          const selected = entry.path === selectedPath;
          return (
            <button
              key={entry.path}
              type="button"
              data-testid="backup-file-browser-entry"
              aria-current={selected ? 'true' : undefined}
              style={cssVars({
                '--entry-height': `${item.size}px`,
                '--entry-start': `${item.start}px`,
              })}
              className={cn(
                'absolute inset-x-0 top-0 flex h-(--entry-height) translate-y-(--entry-start)',
                'items-center gap-2 px-2 text-left text-sm',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                selected ? 'bg-active text-fg' : 'text-fg hover:bg-hover'
              )}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onOpen(entry)}
            >
              <Icon
                icon={entry.isDirectory ? Folder : FileIcon}
                size="sm"
                className={cn('shrink-0', entry.isDirectory ? 'stroke-accent' : 'stroke-fg-muted')}
              />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
