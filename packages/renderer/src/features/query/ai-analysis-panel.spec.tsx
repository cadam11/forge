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
import type {
  AIVendor,
  AIVendorSettings,
  AnalysisRequest,
  AnalysisResponse,
  ResultSet,
} from '@joinery/shared';

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

/**
 * Two vendors, so "which one is named in the disclosure" is a real question rather than the only answer.
 * `anthropic` has the better (lower) priority, which is the order `ai-service.ts` picks in.
 */
const VENDORS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    requiresApiKey: true,
    models: [{ id: 'claude-x', name: 'Claude X', powerRank: 10 }],
  },
  {
    id: 'google',
    name: 'Google AI',
    requiresApiKey: true,
    models: [{ id: 'gemini-x', name: 'Gemini X', powerRank: 10 }],
  },
] as unknown as AIVendor[];

function configureAi(
  overrides: {
    enabled?: boolean;
    configured?: boolean;
    vendorSettings?: AIVendorSettings[];
    analysisModelId?: string | null;
  } = {}
) {
  const { enabled = true, configured = true, analysisModelId = null } = overrides;
  aiStore.setState({
    vendors: VENDORS,
    settings: {
      ...DEFAULT_AI_SETTINGS,
      enabled,
      features: { ...DEFAULT_AI_SETTINGS.features, analysisModelId },
      vendorSettings:
        overrides.vendorSettings ??
        (configured
          ? [{ vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 }]
          : []),
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
  aiStore.setState({ settings: { ...DEFAULT_AI_SETTINGS }, vendors: [], analyzingResults: false });
});

/*
 * What leaves the machine, said on the surface that sends it.
 *
 * `analysis-request.ts` decides the payload and caps it; until this sentence existed, the only place a user
 * could find out that their rows go to a third party was the source code. It names the REAL vendor, resolved
 * the same way `ai-service.ts` resolves it — "an AI provider" would be a disclosure that discloses nothing.
 */
describe('AiAnalysisPanel — the disclosure', () => {
  it('names the payload, the cap and the configured vendor', () => {
    draw();

    const disclosure = screen.getByTestId('analysis-disclosure').textContent ?? '';
    expect(disclosure).toContain('this query');
    expect(disclosure).toContain('column names and types');
    expect(disclosure).toContain(`up to ${SAMPLE_ROW_LIMIT} result rows`);
    expect(disclosure).toContain('Google AI');
  });

  it('names the highest-priority vendor when two are configured', () => {
    configureAi({
      vendorSettings: [
        { vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 2 },
        { vendorId: 'anthropic', enabled: true, apiKeyConfigured: true, priority: 1 },
      ],
    });
    draw();

    // Lower `priority` wins, which is `selectBestAvailableModel`'s own sort.
    expect(screen.getByTestId('analysis-disclosure').textContent).toContain('Anthropic');
  });

  it('follows an explicitly chosen analysis model to its vendor', () => {
    configureAi({
      analysisModelId: 'claude-x',
      vendorSettings: [
        { vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 },
        { vendorId: 'anthropic', enabled: true, apiKeyConfigured: true, priority: 2 },
      ],
    });
    draw();

    // `features.analysisModelId` overrides the priority order in main, so it overrides it here too.
    expect(screen.getByTestId('analysis-disclosure').textContent).toContain('Anthropic');
  });

  it('names NOBODY when the explicitly chosen model’s vendor has been switched off', () => {
    // Reachable state: nothing clears `features.analysisModelId` when a vendor is disabled or its key is
    // removed. Main's `getModelAndProvider` returns `{ model: null }` for exactly this, and `analyzeResults`
    // answers "No AI provider configured" — so the request goes to nobody. Falling through to the other
    // enabled vendor here would name Google AI on a surface that is not going to send Google AI anything.
    configureAi({
      analysisModelId: 'claude-x',
      vendorSettings: [
        { vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 },
        { vendorId: 'anthropic', enabled: false, apiKeyConfigured: true, priority: 2 },
      ],
    });
    draw();

    const disclosure = screen.getByTestId('analysis-disclosure').textContent ?? '';
    expect(disclosure).toContain('your configured AI provider');
    expect(disclosure).not.toContain('Google AI');
    expect(disclosure).not.toContain('Anthropic');
  });

  it('names nobody when the chosen model’s vendor has lost its key, either', () => {
    configureAi({
      analysisModelId: 'claude-x',
      vendorSettings: [
        { vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 },
        { vendorId: 'anthropic', enabled: true, apiKeyConfigured: false, priority: 2 },
      ],
    });
    draw();

    expect(screen.getByTestId('analysis-disclosure').textContent).not.toContain('Google AI');
  });

  it('falls back to a truthful generality when the vendor list has not loaded', () => {
    // The keychain says a provider is configured but `ai.getVendors` has not answered yet. Naming nothing
    // is honest; naming the wrong provider would not be.
    aiStore.setState({ vendors: [] });
    draw();

    expect(screen.getByTestId('analysis-disclosure').textContent).toContain(
      'your configured AI provider'
    );
  });

  it('is absent from the degrades, which send nothing', () => {
    configureAi({ configured: false });
    draw();
    expect(screen.queryByTestId('analysis-disclosure')).toBeNull();
  });
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
