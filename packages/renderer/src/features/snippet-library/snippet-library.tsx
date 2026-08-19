/**
 * The snippet library: search, insert, create, edit, delete. Replaces
 * `shared/components/snippet-library/snippet-library.component.ts` (710).
 *
 * ── The data ────────────────────────────────────────────────────────────────────────────────
 *
 * `state/snippets.ts`, which reads what Task 5's migration lifted out of the legacy `joinery-snippets`
 * browser-storage key and writes through `rendererStatePersistence`. **This component
 * never touches `localStorage`** — the Angular original was its only reader and writer
 * (`:684-701`, with a silent `catch {}` on a full quota), and
 * `persistence/no-local-storage-writes.spec.ts` allows exactly one `setItem` in this package, which
 * belongs to the theme mirror.
 *
 * ── Insert goes through the bus ─────────────────────────────────────────────────────────────
 *
 * `insert-snippet` is one of the six channels that had a live producer AND consumer in Angular, and
 * Task 10's query editor already handles it (`features/query/query-commands.tsx`, guarded on the tab
 * being active). So inserting is one `dispatchCommand`, and — the part that matters here — a row is
 * **disabled with a reason** when there is no active query tab to insert into, rather than firing a
 * command that lands nowhere. `handlerCount` is what makes that checkable rather than assumed.
 *
 * ── Two modes, not one ─────────────────────────────────────────────────────────────────────
 *
 * The Angular version put its save form inside the search overlay, under the input. Here the form is
 * its own dialog, for a concrete reason rather than a taste one: cmdk's root owns Enter and the arrow
 * keys for the whole subtree, so a name field inside it would activate a list row on Enter. Two modes
 * also give the form a real action row, which a palette has nowhere to put.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Pencil, Plus, Trash2 } from 'lucide-react';

import { dispatchCommand, handlerCount, useCommand } from '../../commands';
import {
  Button,
  CommandOverlay,
  CommandOverlayEmpty,
  CommandOverlayGroup,
  CommandOverlayRow,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Textarea,
  Tooltip,
} from '../../ui';
import { notify } from '../../state/diagnostics';
import { snippetsStore, useSnippetsStore, type SqlSnippet } from '../../state/snippets';
import { selectActiveTab, tabStore, useTabStore } from '../../state/tab';
import { rankFuzzy } from '../../utils/fuzzy';
import {
  formatSnippetDate,
  formatTags,
  parseTags,
  previewSql,
  ROW_PREVIEW_LENGTH,
  snippetName,
} from './snippet-model';

/** Rows rendered at once. A library of thousands is unlikely; a cap is still a cap. */
const RENDERED_ROW_LIMIT = 60;

/** What the form is editing: a new snippet seeded with some SQL, or an existing one. */
type SnippetFormState =
  | { readonly mode: 'create'; readonly name: string; readonly tags: string; readonly sql: string }
  | {
      readonly mode: 'edit';
      readonly id: string;
      readonly name: string;
      readonly tags: string;
      readonly sql: string;
    };

export function SnippetLibrary() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [form, setForm] = useState<SnippetFormState | null>(null);

  const snippets = useSnippetsStore(state => state.snippets);
  const activeTab = useTabStore(selectActiveTab);
  const hasQueryTab = activeTab?.type === 'query';

  // The palette's "Snippet library" and the ⌥⌘S shortcut below are the two producers.
  useCommand('open-snippets', () => setOpen(true));

  // ⌥⌘S. NOT ⇧⌘S, which the Angular library used: File ▸ Save Query As registers that accelerator, so
  // Electron fired the menu item and this listener never ran (`commands/catalogue.ts`).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      setOpen(current => !current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const visible = useMemo(
    () =>
      rankFuzzy(
        query,
        snippets.map(snippet => ({
          item: snippet,
          fields: [
            { text: snippetName(snippet) },
            ...(snippet.tags ?? []).map(tag => ({ text: tag, weight: 0.8 })),
            { text: snippet.sql, weight: 0.5 },
          ],
        })),
        { limit: RENDERED_ROW_LIMIT }
      ).map(result => result.item),
    [snippets, query]
  );

  // Resolved at render, never pushed through an effect — see the same comment in the palette.
  const firstId = visible[0]?.id;
  const effectiveSelected =
    selected !== undefined && visible.some(snippet => snippet.id === selected) ? selected : firstId;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  /**
   * Why a row can be inert, or `null` when it cannot.
   *
   * Two reasons, and both are the J-44 treatment rather than a hidden row: nothing is subscribed to
   * `insert-snippet` (no query tab has mounted, so the editor cannot be reached), or the active tab is
   * not a query tab (Task 10's handler guards on exactly that, so the dispatch would be swallowed).
   */
  const insertBlockedBecause = ((): string | null => {
    if (handlerCount('insert-snippet') === 0) return 'Open a query tab to insert into';
    if (!hasQueryTab) return 'Bring a query tab to the front to insert';
    return null;
  })();

  const insert = useCallback(
    (snippet: SqlSnippet) => {
      close();
      dispatchCommand('insert-snippet', { sql: snippet.sql });
    },
    [close]
  );

  /** "New snippet": seeded with the active editor's SQL when there is one, empty otherwise. */
  const beginCreate = useCallback(() => {
    const active = selectActiveTab(tabStore.getState());
    const sql =
      active !== null && active.type === 'query'
        ? tabStore.getState().getTabContent(active.id)
        : '';
    setForm({ mode: 'create', name: '', tags: '', sql });
  }, []);

  const beginEdit = useCallback((snippet: SqlSnippet) => {
    setForm({
      mode: 'edit',
      id: snippet.id,
      name: snippetName(snippet) === 'Untitled snippet' ? '' : (snippet.name ?? ''),
      tags: formatTags(snippet.tags),
      sql: snippet.sql,
    });
  }, []);

  const saveForm = useCallback((state: SnippetFormState) => {
    const name = state.name.trim();
    const sql = state.sql.trim();
    // Both are refused by the disabled Save button; re-checked here because a form can also be
    // submitted with Enter, and "the button was disabled" is not a guarantee about the keyboard.
    if (name.length === 0 || sql.length === 0) return;

    const tags = parseTags(state.tags);
    if (state.mode === 'create') {
      snippetsStore.getState().createSnippet({ name, sql, tags });
      notify.success(`Saved “${name}”`);
    } else {
      snippetsStore.getState().updateSnippet(state.id, { name, sql, tags });
      notify.success(`Updated “${name}”`);
    }
    setForm(null);
  }, []);

  const remove = useCallback((snippet: SqlSnippet) => {
    snippetsStore.getState().deleteSnippet(snippet.id);
    notify.info(`Deleted “${snippetName(snippet)}”`);
  }, []);

  return (
    <>
      <CommandOverlay
        open={open && form === null}
        onOpenChange={next => (next ? setOpen(true) : close())}
        label="Snippet library"
        placeholder="Search snippets by name, tag or SQL…"
        value={query}
        onValueChange={setQuery}
        selected={effectiveSelected}
        onSelectedChange={setSelected}
        testIdPrefix="snippets"
        toolbar={
          <Tooltip content="Save a new snippet">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={Plus}
              data-testid="snippets-new"
              onClick={beginCreate}
            >
              New
            </Button>
          </Tooltip>
        }
        footer={
          <>
            <span data-testid="snippets-count" className="tabular-nums">
              {visible.length} of {snippets.length}
            </span>
            <span>{insertBlockedBecause ?? '⏎ to insert into the editor'}</span>
          </>
        }
      >
        <CommandOverlayEmpty testId="snippets-empty">
          <span>
            {snippets.length === 0
              ? 'No snippets yet — “New” saves the SQL in the active tab'
              : `Nothing matches “${query}”`}
          </span>
        </CommandOverlayEmpty>

        <CommandOverlayGroup heading="Snippets">
          {visible.map(snippet => (
            <SnippetRow
              key={snippet.id}
              snippet={snippet}
              blockedBecause={insertBlockedBecause}
              onInsert={insert}
              onEdit={beginEdit}
              onDelete={remove}
            />
          ))}
        </CommandOverlayGroup>
      </CommandOverlay>

      {form === null ? null : (
        <SnippetForm
          state={form}
          onChange={setForm}
          onCancel={() => setForm(null)}
          onSave={saveForm}
        />
      )}
    </>
  );
}

function SnippetRow({
  snippet,
  blockedBecause,
  onInsert,
  onEdit,
  onDelete,
}: {
  readonly snippet: SqlSnippet;
  readonly blockedBecause: string | null;
  readonly onInsert: (snippet: SqlSnippet) => void;
  readonly onEdit: (snippet: SqlSnippet) => void;
  readonly onDelete: (snippet: SqlSnippet) => void;
}) {
  const tags = snippet.tags ?? [];

  return (
    <CommandOverlayRow
      value={snippet.id}
      disabled={blockedBecause !== null}
      onSelect={() => onInsert(snippet)}
      testId="snippets-row"
      className="items-start"
      trailing={
        <>
          <span className="text-xs text-fg-subtle tabular-nums">
            {formatSnippetDate(snippet.createdAt)}
          </span>
          {/* Both buttons work on a row that cannot be INSERTED into: editing and deleting a snippet
              has nothing to do with there being an editor to paste it in. The row's own
              `pointer-events-none` when disabled would swallow them, so the buttons re-enable
              themselves. */}
          <span className="pointer-events-auto flex items-center gap-1">
            <Tooltip content="Edit this snippet">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                leadingIcon={Pencil}
                aria-label={`Edit ${snippetName(snippet)}`}
                data-testid="snippets-edit"
                onClick={event => {
                  event.stopPropagation();
                  onEdit(snippet);
                }}
              />
            </Tooltip>
            <Tooltip content="Delete this snippet">
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                leadingIcon={Trash2}
                aria-label={`Delete ${snippetName(snippet)}`}
                data-testid="snippets-delete"
                onClick={event => {
                  event.stopPropagation();
                  onDelete(snippet);
                }}
              />
            </Tooltip>
          </span>
        </>
      }
    >
      <Icon icon={Bookmark} size="sm" className="mt-0.5 stroke-fg-muted" />
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span data-testid="snippets-row-name" className="truncate">
          {snippetName(snippet)}
        </span>
        {tags.length === 0 ? null : (
          <span className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span
                key={tag}
                data-testid="snippets-row-tag"
                className="rounded-full border border-rule px-1.5 text-2xs text-fg-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
        <span data-testid="snippets-row-sql" className="truncate font-mono text-sm text-fg-muted">
          {previewSql(snippet.sql, ROW_PREVIEW_LENGTH)}
        </span>
        {blockedBecause === null ? null : (
          <span data-testid="snippets-row-blocked" className="text-sm text-fg-muted">
            {blockedBecause}
          </span>
        )}
      </span>
    </CommandOverlayRow>
  );
}

/**
 * The create/edit form. A dialog of its own — see the header for why it is not inside the overlay.
 *
 * Deliberately not a `react-hook-form` surface: three fields, one of which is required-and-trimmed,
 * and no async validation. `features/forms` exists for dialogs with a submit that can fail.
 */
function SnippetForm({
  state,
  onChange,
  onCancel,
  onSave,
}: {
  readonly state: SnippetFormState;
  readonly onChange: (next: SnippetFormState) => void;
  readonly onCancel: () => void;
  readonly onSave: (state: SnippetFormState) => void;
}) {
  const canSave = state.name.trim().length > 0 && state.sql.trim().length > 0;

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onCancel())}>
      <DialogContent size="md" data-testid="snippets-form">
        <DialogHeader>
          <DialogTitle>{state.mode === 'create' ? 'New snippet' : 'Edit snippet'}</DialogTitle>
          <DialogDescription>
            {state.mode === 'create'
              ? 'Saved snippets are searchable by name, tag and SQL, and insert into the editor.'
              : 'Changes apply to every future insert; SQL already pasted is untouched.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <Input
            name="snippet-name"
            label="Name"
            value={state.name}
            data-testid="snippets-form-name"
            onChange={event => onChange({ ...state, name: event.target.value })}
          />
          <Input
            name="snippet-tags"
            label="Tags"
            hint="Comma separated."
            value={state.tags}
            data-testid="snippets-form-tags"
            onChange={event => onChange({ ...state, tags: event.target.value })}
          />
          <Textarea
            name="snippet-sql"
            label="SQL"
            rows={8}
            value={state.sql}
            data-testid="snippets-form-sql"
            className="font-mono text-sm"
            onChange={event => onChange({ ...state, sql: event.target.value })}
          />
        </DialogBody>

        <DialogActions>
          <Button variant="ghost" data-testid="snippets-form-cancel" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            data-testid="snippets-form-save"
            onClick={() => onSave(state)}
          >
            {state.mode === 'create' ? 'Save snippet' : 'Save changes'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
