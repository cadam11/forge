/**
 * "Explain these results" — the results pane's Analysis tab.
 *
 * Replaces `shared/components/ai-analysis-panel/ai-analysis-panel.component.ts` (540). The `collapsed`
 * half of that component is gone with the thing that needed it: it rendered both as a collapsible
 * accordion AND as an `[embedded]` tab, and only the embedded path was ever mounted
 * (`query.component.ts:501`), so the header, the collapse button, the `.collapsed` rules and the
 * `embedded` input were 120 lines serving nothing.
 *
 * ── Three honest degrades instead of one message ─────────────────────────────────────────────
 *
 * The Angular panel had a single "Configure an AI provider in Settings to enable analysis" line — and at
 * the time there was no AI surface in the renderer to configure one in (J-55). There are three distinct
 * states and they need three different things done about them:
 *
 *  1. **no provider configured** → the AI setup dialog exists now, so the panel offers it as a button;
 *  2. **a provider is configured but AI is switched off** → the master switch is the fix, and it is in
 *     the same dialog, so the copy says which of the two is wrong;
 *  3. **nothing has run in this tab** → not an AI problem at all.
 *
 * The fourth state — `features.analysisEnabled` off — is handled by the tab being ABSENT
 * (`query-results.tsx`), which is the first real consumer of that setting: it was one of the switches
 * the Angular AI panel wrote and nothing read.
 *
 * ── The answer goes through the Markdown seam and nowhere else ───────────────────────────────
 *
 * `<Markdown>` from `src/markdown/`, which parses with `marked` and sanitizes with DOMPurify.
 * `eslint.config.js` bans `dangerouslySetInnerHTML` outside that directory, so there is no second route
 * for model-authored text to reach the DOM. Mermaid is off: an analysis of a result set has no diagrams
 * in it, and enabling the renderer would mean a second sanitizer profile on this surface for nothing.
 */

import { useCallback, useState, type FormEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import type { ResultSet } from '@joinery/shared';

import { dispatchCommand } from '../../commands';
import { Markdown } from '../../markdown';
import { aiStore, selectAIEnabled, selectHasConfiguredVendors, useAIStore } from '../../state/ai';
import { notify } from '../../state/diagnostics';
import { selectEffectiveTheme, useSettingsStore } from '../../state/settings';
import { Button, EmptyState, Icon, Input, Spinner, Tooltip, cn } from '../../ui';
import { QUICK_ANALYSES, buildAnalysisRequest } from './analysis-request';

export interface AiAnalysisPanelProps {
  /** The statement that produced the result on screen — not the editor's live text. */
  readonly sql: string | null;
  /** The result set the visible tab is showing, or `null` when the batch returned no rows. */
  readonly resultSet: ResultSet | null;
}

export function AiAnalysisPanel({ sql, resultSet }: AiAnalysisPanelProps) {
  const configured = useAIStore(selectHasConfiguredVendors);
  const aiEnabled = useAIStore(selectAIEnabled);
  const analyzing = useAIStore(state => state.analyzingResults);
  const theme = useSettingsStore(selectEffectiveTheme);

  const [answer, setAnswer] = useState('');
  const [failure, setFailure] = useState('');
  const [question, setQuestion] = useState('');

  /**
   * Ask. The request is built by `buildAnalysisRequest` — which is what caps the sample — and the store
   * owns the `analyzingResults` flag, so two clicks cannot produce two spinners.
   *
   * `aiStore.getState()` rather than a subscription to the action: the action is stable, and this
   * callback is handed to three buttons and a form.
   */
  const ask = useCallback(
    (prompt: string): void => {
      if (sql === null || resultSet === null || analyzing) return;
      setFailure('');
      setAnswer('');
      void aiStore
        .getState()
        .analyzeResults(buildAnalysisRequest({ sql, resultSet, prompt }))
        .then(response => {
          // `analyzeResults` resolves null on a refusal or a rejection and has already reported the
          // cause to the diagnostics sink; what is missing is a reason on screen.
          if (response === null) {
            setFailure('The provider did not answer. The Output panel has the reason.');
            return;
          }
          setAnswer(response.content);
        });
    },
    [analyzing, resultSet, sql]
  );

  if (!configured) {
    return (
      <EmptyState
        data-testid="analysis-no-provider"
        icon={Sparkles}
        size="sm"
        title="No AI provider yet"
        description="Analysis needs a provider and an API key. The key is stored in the system keychain."
        action={
          <Button variant="primary" onClick={() => dispatchCommand('open-ai-setup')}>
            Set up AI
          </Button>
        }
      />
    );
  }

  if (!aiEnabled) {
    return (
      <EmptyState
        data-testid="analysis-ai-off"
        icon={Sparkles}
        size="sm"
        title="AI features are switched off"
        // The distinction that matters: the key is fine, the master switch is not — so the copy does not
        // send a user back to re-enter a key that is already in the keychain.
        description="A provider is configured, but the master AI switch is off."
        action={
          <Button variant="primary" onClick={() => dispatchCommand('open-ai-setup')}>
            Turn AI on
          </Button>
        }
      />
    );
  }

  if (sql === null || resultSet === null) {
    return (
      <EmptyState
        data-testid="analysis-no-results"
        icon={Sparkles}
        size="sm"
        title="Nothing to analyse yet"
        description="Run a query that returns rows, then come back."
      />
    );
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const prompt = question.trim();
    if (prompt === '') return;
    // Cleared BEFORE the round trip, as the Angular version did: the field is a question that has been
    // asked, and leaving it filled invites a second identical ask.
    setQuestion('');
    ask(prompt);
  };

  return (
    <div className="flex min-h-0 grow flex-col gap-3 overflow-auto p-3" data-testid="ai-analysis">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK_ANALYSES.map(action => (
          <Button
            key={action.id}
            variant="outline"
            size="sm"
            disabled={analyzing}
            data-testid={`analysis-quick-${action.id}`}
            onClick={() => ask(action.prompt)}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <form onSubmit={submit} className="flex items-end gap-2">
        <Input
          name="analysis-question"
          label="Ask about these results"
          data-testid="analysis-question"
          fieldClassName="grow"
          value={question}
          disabled={analyzing}
          autoComplete="off"
          onChange={event => setQuestion(event.target.value)}
        />
        <Tooltip content="Ask">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            aria-label="Ask"
            data-testid="analysis-ask"
            disabled={analyzing || question.trim() === ''}
          >
            <Icon icon={Send} size="sm" />
          </Button>
        </Tooltip>
      </form>

      {analyzing ? (
        <div className="flex items-center justify-center p-6" data-testid="analysis-working">
          <Spinner label="Reading the results…" />
        </div>
      ) : null}

      {failure === '' || analyzing ? null : (
        <p
          data-testid="analysis-error"
          className="border-l-2 border-danger bg-surface px-3 py-2 text-md text-fg"
        >
          {failure}
        </p>
      )}

      {answer === '' || analyzing ? null : (
        <section className="flex min-h-0 flex-col gap-2" data-testid="analysis-answer">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-2xs tracking-eyebrow uppercase text-fg-subtle">
              Analysis
            </h3>
            <Button
              variant="ghost"
              size="sm"
              data-testid="analysis-copy"
              onClick={() => {
                // The failure is reported rather than swallowed: the Angular version called
                // `navigator.clipboard.writeText` and ignored the promise entirely, so a denied
                // clipboard permission looked like a successful copy.
                void navigator.clipboard
                  .writeText(answer)
                  .then(() => notify.success('Analysis copied'))
                  .catch(() => notify.error('Could not copy the analysis'));
              }}
            >
              Copy
            </Button>
          </div>
          {/* The one seam. `enableCodeCopy` because an analysis routinely answers with SQL. */}
          <Markdown
            data={answer}
            enableCodeCopy
            mermaidTheme={theme === 'light' ? 'neutral' : 'dark'}
            data-testid="analysis-markdown"
            className={cn('min-h-0')}
          />
        </section>
      )}
    </div>
  );
}
