/**
 * The query tab. Replaces the 2,689-line `query.component.ts` — or rather, replaces the ~250 lines of it
 * that are this surface's own job, the rest having gone to `src/editor/`, `state/query-execution.ts`,
 * two dialogs, a toolbar, a results pane and a command table.
 *
 * What this file owns and nothing else does:
 *
 *  - the **geometry**: toolbar / editor / divider / results, and the persisted split between the last two;
 *  - the **bindings** between the tab and the editor: initial content, content → `setTabContent`, caret →
 *    the status bar, engine → the tokenizer;
 *  - the **⌃E confirm gate**, which is a keystroke's gate and not the menu item's;
 *  - **auto-execute**, for a tab opened from the explorer or an FK link with SQL already in it;
 *  - the **`layout()` on re-activation** that PLAN.md R5 finding 4 requires.
 *
 * ── Reading the tab, and why nothing is prop-drilled ───────────────────────────────────────
 *
 * Dockview mounts this with `params.tabId` and that is the only input (`shell/workspace/tab-panels.tsx`).
 * Every other value — the tab, its connection, its database, the engine, the settings — is read from a
 * store through a selector, so an inactive panel whose DOM is detached still re-renders correctly when
 * its tab's connection changes, and no ancestor has to know a query tab exists.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { DatabaseEngine } from '@joinery/shared';

import { dispatchCommand } from '../../commands';
import {
  SqlEditor,
  formatSql,
  monacoLanguageFor,
  sqlIntellisense,
  type SqlEditorHandle,
} from '../../editor';
import { ResizeHandle } from '../../shell/resize-handle';
import { notify } from '../../state/diagnostics';
import { selectProfileFor, useConnectionStore } from '../../state/connection';
import {
  queryExecutionStore,
  selectIsExecuting,
  selectResultFor,
  useQueryExecutionStore,
} from '../../state/query-execution';
import { selectEditorSettings, selectEffectiveTheme, useSettingsStore } from '../../state/settings';
import { tabStore, useTabStore } from '../../state/tab';
import {
  EDITOR_HEIGHT_MAX_PERCENT,
  EDITOR_HEIGHT_MIN_PERCENT,
  useWorkbenchStore,
  workbenchStore,
} from '../../state/workbench';
import { cn } from '../../ui';
import { ConfirmExecuteDialog } from './confirm-execute-dialog';
import { PlaceholderDialog } from './placeholder-dialog';
import { QueryCommands } from './query-commands';
import { QueryResults } from './query-results';
import { QueryToolbar } from './query-toolbar';
import { editorPrefsStore, useEditorPrefsStore } from '../../state/editor-prefs';
import { adoptOpenedFile, openQueryFile, rememberedFilePath, saveQueryToFile } from './query-files';
import { useRunQuery } from './use-run-query';

/** Arrow-key step for the split divider, in percent. 2% is ~12px in a 600px pane. */
const SPLIT_STEP_PERCENT = 2;

export function QueryPanel(props: IDockviewPanelProps) {
  const tabId = typeof props.params['tabId'] === 'string' ? props.params['tabId'] : props.api.id;
  const tab = useTabStore(state => state.tabs.find(candidate => candidate.id === tabId));

  const profile = useConnectionStore(selectProfileFor(tab?.connectionId ?? null));
  const engine: DatabaseEngine | undefined = profile?.engine;

  const editorSettings = useSettingsStore(selectEditorSettings);
  const theme = useSettingsStore(selectEffectiveTheme);

  const executing = useQueryExecutionStore(selectIsExecuting(tabId));
  const result = useQueryExecutionStore(selectResultFor(tabId));

  const editorHeightPercent = useWorkbenchStore(state => state.editorHeightPercent);
  // Only the placeholder values are SUBSCRIBED to: they are rendered (as the prompt's pre-filled
  // fields), whereas the ⌃E flag is read at the moment the keystroke arrives (`executeWithGate`) and a
  // subscription to it would re-render every open query tab when one of them ticks the box.
  const rememberedPlaceholders = useEditorPrefsStore(state => state.flywayPlaceholderValues);

  const editor = useRef<SqlEditorHandle | null>(null);
  /** The split container, measured at drag start so a percentage divider knows what 1px is worth. */
  const splitPane = useRef<HTMLDivElement | null>(null);
  const [resultsHidden, setResultsHidden] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const runQuery = useRunQuery();

  /**
   * The context every run needs, read fresh from the stores.
   *
   * A function rather than a memo: it is called from Monaco keybindings and command handlers that were
   * installed once, and a memo captured in one of those closures would hand them the tab's connection as
   * it was when the editor mounted. This is the same reason `isActive` is a function.
   */
  const runContext = useCallback(
    (sql: string) => {
      const current = tabStore.getState().tabs.find(candidate => candidate.id === tabId);
      return {
        tabId,
        tabTitle: current?.title ?? 'Query',
        connectionId: current?.connectionId,
        database: current?.databaseName,
        querySettings: useSettingsStore.getState().settings.query,
        sql,
      };
    },
    [tabId]
  );

  /** Execute what the caret, the selection and the `executeScope` setting select. */
  const execute = useCallback((): void => {
    const sql = editor.current?.textToExecute(
      useSettingsStore.getState().settings.query.executeScope
    );
    void runQuery.run(runContext(sql ?? ''));
  }, [runContext, runQuery]);

  /**
   * Query ▸ Execute Selection (⇧⌘↩).
   *
   * The Angular menu bound this to the SAME method as Execute (`query.component.ts:1095` subscribes
   * `executeSelection$` to `this.executeQuery()`), so "Execute Selection" with nothing selected ran the
   * whole buffer and the menu item was a duplicate. Here it means what it says: the selection, and a
   * refusal when there is none. `'all'` is passed as the scope so a selection-less invocation cannot fall
   * through to the current statement either — `hasSelection()` is the only thing that decides.
   *
   * **`hasSelection()`, not "the selected text differs from the buffer".** That was the first version of
   * this function and it refused the most obvious way to use the command: ⌘A, then Execute Selection.
   * Selecting everything IS a selection, the user said so, and the answer "select some SQL to execute"
   * is nonsense. It was also wrong for a one-line document, where selecting the line equals the buffer.
   * Monaco already knows — `getSelection().isEmpty()` is a zero-width check — so the question is asked
   * of the editor instead of inferred from a string comparison.
   */
  const executeSelection = useCallback((): void => {
    const instance = editor.current;
    if (instance === null || !instance.hasSelection()) {
      notify.warning('Select some SQL to execute');
      return;
    }
    const selection = instance.textToExecute('all');
    // A selection of nothing but whitespace is a real selection to Monaco (see `statements.ts`), and
    // there is nothing to run in it. Same wording, because it is the same instruction to the user.
    if (selection.trim() === '') {
      notify.warning('Select some SQL to execute');
      return;
    }
    void runQuery.run(runContext(selection));
  }, [runContext, runQuery]);

  /** ⌃E / ⌘E: the one-time gate, then execute. Ported from `handleCtrlEExecute` (`:1545-1553`). */
  const executeWithGate = useCallback((): void => {
    if (editorPrefsStore.getState().confirmedCtrlEExecute) {
      execute();
      return;
    }
    setConfirmOpen(true);
  }, [execute]);

  const format = useCallback((): void => {
    const sql = editor.current?.getValue() ?? '';
    if (sql.trim() === '') {
      notify.warning('No SQL to format');
      return;
    }
    try {
      editor.current?.setValue(formatSql(sql, engine));
      notify.success('SQL formatted');
    } catch (error) {
      // The parse error is the useful part — `sql-formatter` says which token it choked on — so it goes
      // in the toast rather than into a console the user does not have open.
      notify.error(
        `Could not format this SQL: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [engine]);

  const save = useCallback(
    (promptForPath: boolean): void => {
      void saveQueryToFile({
        tabId,
        sql: editor.current?.getValue() ?? '',
        promptForPath,
        rememberedPath: rememberedFilePath(
          tabStore.getState().tabs.find(candidate => candidate.id === tabId)?.metadata
        ),
      });
    },
    [tabId]
  );

  const openFile = useCallback((): void => {
    void openQueryFile().then(opened => {
      if (opened === null) return;
      editor.current?.setValue(opened.content);
      // The path, the store's copy of the text, and the clean baseline — see `adoptOpenedFile`. It runs
      // after the editor write because `markClean` reads the tab's content back.
      adoptOpenedFile({ tabId, path: opened.path, content: opened.content });
    });
  }, [tabId]);

  /**
   * Auto-execute, for a tab opened with SQL already in it (the explorer's "select top 1000", an FK link).
   *
   * The Angular version polled for the editor to be ready — `executeWhenEditorReady`, twenty attempts at
   * 50ms (`:2195-2218`) — because the effect that noticed the flag could fire before Monaco had loaded.
   * Here the effect runs after the editor's own mount effect has installed the handle, so there is nothing
   * to wait for: the flag is cleared and the run starts on the same commit. The clear happens FIRST, which
   * is what stops a re-render from running it twice.
   */
  useEffect(() => {
    if (tab?.autoExecute !== true || tab.type !== 'query') return;
    tabStore.getState().clearAutoExecute(tabId);
    const sql = tabStore.getState().getTabContent(tabId);
    if (sql.trim() === '') return;
    void runQuery.run(runContext(sql));
    // `runQuery` and `runContext` are stable for the tab's lifetime; the trigger is the flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.autoExecute, tabId]);

  /**
   * Prefetch the completions' metadata for THIS tab's target.
   *
   * Without this the provider is registered and answers with keywords and snippets only — which is what
   * the first e2e run showed, and it is the same call the Angular component made from `createEditor`
   * (`loadAutoCompleteObjects`, `:1493`). The target is passed explicitly rather than left to the
   * provider's active-tab default: this effect belongs to a tab that may not be the active one.
   *
   * Fire-and-forget: completions are optional, the service reports its own failures, and nothing here
   * should wait on up to 51 IPC round trips.
   */
  useEffect(() => {
    if (tab?.connectionId === undefined || tab.databaseName === undefined) return;
    void sqlIntellisense.loadMetadata({
      connectionId: tab.connectionId,
      database: tab.databaseName,
    });
  }, [tab?.connectionId, tab?.databaseName]);

  /**
   * PLAN.md R5 finding 4: an inactive Dockview panel's DOM subtree is detached from the document, and the
   * Task 10 spike measured what that does to Monaco — an editor whose host was detached when it was
   * created comes up at Monaco's 5×5 minimum. `automaticLayout`'s ResizeObserver repairs it on re-attach,
   * but only on its own schedule, so the first frame after a tab switch can be a collapsed editor. This
   * makes the re-measure synchronous with the activation, and takes focus with it so the caret is where a
   * user who just clicked a tab expects to type.
   */
  useEffect(() => {
    const subscription = props.api.onDidActiveChange(({ isActive }) => {
      if (!isActive) return;
      editor.current?.layout();
      editor.current?.focus();
    });
    return () => subscription.dispose();
  }, [props.api]);

  /** Forget the tab's result when the panel goes away for good, so the store does not grow forever. */
  useEffect(
    () => () => {
      if (tabStore.getState().tabs.some(candidate => candidate.id === tabId)) return;
      queryExecutionStore.getState().forgetTab(tabId);
    },
    [tabId]
  );

  // Read once, for the editor's uncontrolled initial value. The tab store is the source of truth for the
  // text from then on; see `<SqlEditor>`'s header for why the editor is not a controlled component.
  const initialValue = useMemo(() => tabStore.getState().getTabContent(tabId), [tabId]);

  /**
   * The handlers the toolbar and the command table SHARE, named once.
   *
   * Both surfaces drive the same five actions, and writing the arrow twice would let them drift — a
   * toolbar Find that focused the editor and a ⌘F that did not is exactly the kind of difference nobody
   * notices until a user reports it. The toolbar additionally owns Go to Line (no menu item has it) and
   * the command table additionally owns save/open/comment/snippet.
   */
  const runEditorAction = useCallback(
    (actionId: Parameters<SqlEditorHandle['runAction']>[0]) => () =>
      editor.current?.runAction(actionId),
    []
  );
  const cancel = useCallback(() => void queryExecutionStore.getState().cancel(tabId), [tabId]);
  const toggleResults = useCallback(() => setResultsHidden(hidden => !hidden), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-testid="query-panel">
      <QueryCommands
        isActive={() => tabStore.getState().activeTabId === tabId}
        onExecute={execute}
        onExecuteSelection={executeSelection}
        onCancel={cancel}
        onFormat={format}
        onFind={runEditorAction('actions.find')}
        onReplace={runEditorAction('editor.action.startFindReplaceAction')}
        onToggleComment={runEditorAction('editor.action.commentLine')}
        onSave={() => save(false)}
        onSaveAs={() => save(true)}
        onOpenFile={openFile}
        onToggleResults={toggleResults}
        onInsertSnippet={sql => editor.current?.insertSnippet(sql)}
      />

      <QueryToolbar
        executing={executing}
        resultsHidden={resultsHidden}
        connectionName={profile?.name ?? null}
        databaseName={tab?.databaseName ?? null}
        onExecute={execute}
        onCancel={cancel}
        onFormat={format}
        onFind={runEditorAction('actions.find')}
        onReplace={runEditorAction('editor.action.startFindReplaceAction')}
        onGoToLine={runEditorAction('editor.action.gotoLine')}
        onToggleResults={toggleResults}
      />

      <div ref={splitPane} className="flex min-h-0 grow flex-col">
        <div
          // The editor takes the whole pane when the results are hidden, which is the Angular
          // behaviour (`:378`). A custom property rather than an inline height, per `general.md`.
          style={
            {
              '--editor-height': `${resultsHidden ? 100 : editorHeightPercent}%`,
            } as CSSProperties
          }
          className="h-(--editor-height) min-h-0 shrink-0"
        >
          <SqlEditor
            handleRef={editor}
            data-testid="query-editor"
            defaultValue={initialValue}
            language={monacoLanguageFor(engine)}
            editorSettings={editorSettings}
            theme={theme}
            onChange={value => tabStore.getState().setTabContent(tabId, value)}
            onCursorPositionChange={position => {
              // Only the focused tab may move the status bar's readout. Two visible panels in a split
              // group would otherwise fight over it on every keystroke.
              if (tabStore.getState().activeTabId === tabId) {
                dispatchCommand('cursor-position', position);
              }
            }}
            onExecuteShortcut={executeWithGate}
            onExecute={execute}
          />
        </div>

        {resultsHidden ? null : (
          <>
            <ResizeHandle
              label="Editor height"
              testId="query-split-handle"
              orientation="horizontal"
              edge="leading"
              value={editorHeightPercent}
              min={EDITOR_HEIGHT_MIN_PERCENT}
              max={EDITOR_HEIGHT_MAX_PERCENT}
              step={SPLIT_STEP_PERCENT}
              // The value is a percentage of this pane, so a pixel of drag is worth `100 / height` of
              // it. Measured at drag start — see `unitsPerPixel`.
              unitsPerPixel={() => 100 / (splitPane.current?.clientHeight ?? 600)}
              onChange={percent => workbenchStore.getState().setEditorHeightPercent(percent)}
              onReset={() => workbenchStore.getState().resetEditorHeightPercent()}
            />
            <div className={cn('flex min-h-0 grow flex-col')}>
              {/* Three props, all of them stable across a panel re-render: `<QueryResults>` is
                  memoised and that is the R2 boundary — see its header. Nothing built in this render
                  body may be passed here. */}
              <QueryResults result={result} executing={executing} tabId={tabId} />
            </div>
          </>
        )}
      </div>

      <ConfirmExecuteDialog
        open={confirmOpen}
        // Focus goes back to the editor either way — see `onReturnFocus`. It has to be Radix's
        // close-autofocus hook rather than a `focus()` inside these handlers: Radix moves focus AFTER
        // they run, so an earlier call is simply overridden.
        onReturnFocus={() => editor.current?.focus()}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={remember => {
          setConfirmOpen(false);
          if (remember) editorPrefsStore.getState().confirmCtrlEExecute();
          execute();
        }}
      />

      {runQuery.prompting.length === 0 ? null : (
        <PlaceholderDialog
          // Remounts per prompt, which is what resets the form to the remembered values rather than the
          // previous prompt's answers. See `PlaceholderDialog`'s state comment.
          key={runQuery.prompting.join('|')}
          placeholders={runQuery.prompting}
          // A second Execute while this is open is refused; the counter is what makes the refusal
          // visible instead of silent. See `useRunQuery`'s `promptAttention`.
          attention={runQuery.promptAttention}
          remembered={rememberedPlaceholders}
          onCancel={runQuery.cancelPlaceholders}
          onSubmit={runQuery.submitPlaceholders}
          onReturnFocus={() => editor.current?.focus()}
        />
      )}
    </div>
  );
}
