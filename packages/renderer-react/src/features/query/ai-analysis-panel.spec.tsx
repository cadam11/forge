/**
 * The analysis panel: the three degrades, the request it actually sends, and the one seam the answer
 * reaches the DOM through.
 *
 * The provider is the bridge double, so "what left the machine" is inspectable — which is what makes the
 * sample cap in `analysis-request.ts` a test rather than a comment.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@joinery/shared';
import type { AnalysisRequest, AnalysisResponse, ResultSet } from '@joinery/shared';

import { subscribeCommand } from '../../commands';
import { aiStore } from '../../state/ai';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { TooltipProvider } from '../../ui';
import { AiAnalysisPanel } from './ai-analysis-panel';
import { SAMPLE_ROW_LIMIT, SAMPLE_VALUE_LIMIT } from './analysis-request';

const teardowns: (() => void)[] = [];

const noop = (): void => undefined;

const RESULT_SET: ResultSet = {
  columns: [
    { name: 'id', type: 'int' },
    { name: 'note', type: 'text' },
  ],
  rows: Array.from({ length: 40 }, (_, index) => ({ id: index, note: `note ${index}` })),
  rowCount: 2_000_000,
};

let analyzeResults: ReturnType<typeof vi.fn>;

function configureAi(overrides: { enabled?: boolean; configured?: boolean } = {}) {
  const { enabled = true, configured = true } = overrides;
  aiStore.setState({
    settings: {
      ...DEFAULT_AI_SETTINGS,
      enabled,
      vendorSettings: configured
        ? [{ vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 }]
        : [],
    },
  });
}

function draw(props: Partial<Parameters<typeof AiAnalysisPanel>[0]> = {}) {
  return render(
    <TooltipProvider>
      <AiAnalysisPanel sql="SELECT id, note FROM notes" resultSet={RESULT_SET} {...props} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  analyzeResults = vi.fn(async (): Promise<AnalysisResponse> => ({
    content: '## Findings\n\n- one',
    isComplete: true,
  }));
  teardowns.push(installJoineryMock({ ai: { analyzeResults } }));
  // Real sinks, captured: the refusal path logs its cause and a null sink would throw out of it.
  teardowns.push(setNotifier({ success: noop, error: noop, info: noop, warning: noop }));
  teardowns.push(setDiagnosticsSink({ error: noop, warn: noop }));
  configureAi();
});

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  removeJoineryMock();
  aiStore.setState({ settings: { ...DEFAULT_AI_SETTINGS }, analyzingResults: false });
});

describe('AiAnalysisPanel — the degrades', () => {
  it('offers the AI setup dialog when there is no provider', async () => {
    configureAi({ configured: false });
    draw();

    expect(screen.queryByTestId('analysis-no-provider')).not.toBeNull();
    // Not a ticket number and not "go to Settings": the surface exists, so the button opens it.
    const opened = vi.fn();
    teardowns.push(subscribeCommand('open-ai-setup', opened));
    await userEvent.click(screen.getByRole('button', { name: 'Set up AI' }));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('distinguishes "no key" from "the master switch is off"', async () => {
    configureAi({ enabled: false, configured: true });
    draw();

    // The key is fine; sending the user back to re-enter one would be wrong.
    expect(screen.queryByTestId('analysis-no-provider')).toBeNull();
    expect(screen.queryByTestId('analysis-ai-off')).not.toBeNull();

    const opened = vi.fn();
    teardowns.push(subscribeCommand('open-ai-setup', opened));
    await userEvent.click(screen.getByRole('button', { name: 'Turn AI on' }));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it('says there is nothing to analyse when nothing has run', () => {
    draw({ sql: null, resultSet: null });
    expect(screen.queryByTestId('analysis-no-results')).not.toBeNull();
    expect(screen.queryByTestId('analysis-quick-summarize')).toBeNull();
  });
});

describe('AiAnalysisPanel — asking', () => {
  it('sends the quick action’s own prompt', async () => {
    draw();
    await userEvent.click(screen.getByTestId('analysis-quick-patterns'));

    await waitFor(() => expect(analyzeResults).toHaveBeenCalledTimes(1));
    const request = analyzeResults.mock.calls[0]?.[0] as AnalysisRequest;
    expect(request.prompt).toContain('patterns, trends, or anomalies');
    expect(request.sql).toBe('SELECT id, note FROM notes');
  });

  it('caps the sample and reports the TRUE row count', async () => {
    draw();
    await userEvent.click(screen.getByTestId('analysis-quick-summarize'));

    await waitFor(() => expect(analyzeResults).toHaveBeenCalledTimes(1));
    const request = analyzeResults.mock.calls[0]?.[0] as AnalysisRequest;
    expect(request.resultSummary.sampleRows).toHaveLength(SAMPLE_ROW_LIMIT);
    // 40 rows on screen, two million behind them: a summary of "these results" must not be a summary of
    // the first page.
    expect(request.resultSummary.rowCount).toBe(2_000_000);
    expect(request.resultSummary.columnCount).toBe(2);
  });

  it('sends a typed question and clears the field', async () => {
    draw();
    await userEvent.type(screen.getByTestId('analysis-question'), 'why are ids sparse?');
    await userEvent.click(screen.getByTestId('analysis-ask'));

    await waitFor(() => expect(analyzeResults).toHaveBeenCalledTimes(1));
    expect((analyzeResults.mock.calls[0]?.[0] as AnalysisRequest).prompt).toBe(
      'why are ids sparse?'
    );
    expect((screen.getByTestId('analysis-question') as HTMLInputElement).value).toBe('');
  });

  it('refuses an empty question rather than sending one', async () => {
    draw();
    expect((screen.getByTestId('analysis-ask') as HTMLButtonElement).disabled).toBe(true);
    expect(analyzeResults).not.toHaveBeenCalled();
  });

  it('renders the answer through the markdown seam', async () => {
    draw();
    await userEvent.click(screen.getByTestId('analysis-quick-summarize'));

    await waitFor(() => expect(screen.queryByTestId('analysis-answer')).not.toBeNull());
    const markdown = screen.getByTestId('analysis-markdown');
    // Parsed, not printed: the `##` became a heading. That is only true if it went through
    // `renderMarkdown`, which is the only place `dangerouslySetInnerHTML` is permitted.
    expect(markdown.querySelector('h2')?.textContent).toBe('Findings');
    expect(markdown.querySelector('li')?.textContent).toBe('one');
  });

  it('reports a refusal instead of showing an empty answer', async () => {
    // `analyzeResults` resolving null is what the store does on a rejection, having logged the cause.
    analyzeResults.mockRejectedValueOnce(new Error('rate limited'));
    draw();
    await userEvent.click(screen.getByTestId('analysis-quick-summarize'));

    await waitFor(() => expect(screen.queryByTestId('analysis-error')).not.toBeNull());
    expect(screen.getByTestId('analysis-error').textContent).toContain('Output panel');
    expect(screen.queryByTestId('analysis-answer')).toBeNull();
  });

  it('truncates a long value rather than shipping the whole document', async () => {
    const long = 'x'.repeat(SAMPLE_VALUE_LIMIT * 3);
    draw({
      resultSet: {
        columns: [{ name: 'blob', type: 'text' }],
        rows: [{ blob: long }],
      },
    });
    await userEvent.click(screen.getByTestId('analysis-quick-summarize'));

    await waitFor(() => expect(analyzeResults).toHaveBeenCalledTimes(1));
    const sent = (analyzeResults.mock.calls[0]?.[0] as AnalysisRequest).resultSummary
      .sampleRows?.[0];
    expect(String(sent?.['blob']).length).toBeLessThan(long.length);
    expect(String(sent?.['blob'])).toContain('truncated');
  });
});
