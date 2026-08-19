/**
 * The AI setup dialog, driven the way a user drives it — and the trace assertions that make the
 * secrets claim in `ai-setup-dialog.tsx` checkable rather than asserted in a comment.
 *
 * ── What "trace-clean" means here, mechanically ────────────────────────────────────────────
 *
 * The key typed into this dialog is recorded once, by the bridge double, so the test knows what the
 * secret is. Everything the app could plausibly have written it into is then searched for that exact
 * string: the TanStack query cache, the main-process `AppState` the renderer persists through
 * `app.setState`, `localStorage`, `sessionStorage`, the diagnostics/log sink, the toast text, the
 * `aiStore` snapshot, and the rendered DOM after the dialog closes. Every one of those is a real
 * mechanism this renderer has, and each has leaked a secret in some app at some point.
 *
 * The list is deliberately over-broad: a future edit that starts caching the key would have to defeat
 * eight assertions rather than remember one.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_AI_SETTINGS } from '@joinery/shared';
import type { AISettings, AIVendor } from '@joinery/shared';

import { TooltipProvider } from '../../ui';
import { aiStore } from '../../state/ai';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { createAppStateDouble, type AppStateDouble } from '../../test/app-state-double';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { AiSetupDialog } from './ai-setup-dialog';

const SECRET = 'sk-live-9f3a-do-not-log-me';

const GEMINI: AIVendor = {
  id: 'google',
  name: 'Google Gemini',
  requiresApiKey: true,
  models: [
    {
      id: 'flash',
      name: 'Gemini Flash',
      apiName: 'gemini-flash',
      powerRank: 8,
      costTier: 'economy',
      default: true,
    },
    { id: 'pro', name: 'Gemini Pro', apiName: 'gemini-pro', powerRank: 14, costTier: 'standard' },
  ],
};

const CEREBRAS: AIVendor = {
  id: 'cerebras',
  name: 'Cerebras',
  requiresApiKey: true,
  models: [
    {
      id: 'llama',
      name: 'Llama 3.3 70B',
      apiName: 'llama-3.3-70b',
      powerRank: 11,
      costTier: 'economy',
      default: true,
    },
  ],
};

/**
 * Stands in for the real OpenRouter vendor: one concrete model and one auto-router. The router's
 * `apiName` is what makes the cost-tier selector appear — the dialog reads the shared router table,
 * not the vendor id — so this double exercises the same predicate the app does.
 */
const OPENROUTER: AIVendor = {
  id: 'openrouter',
  name: 'OpenRouter',
  requiresApiKey: true,
  models: [
    {
      id: 'openrouter-sonnet',
      name: 'Claude Sonnet 4.5',
      apiName: 'anthropic/claude-sonnet-4.5',
      powerRank: 16,
      costTier: 'standard',
      default: true,
    },
    {
      id: 'openrouter-auto',
      name: 'Auto Router',
      apiName: 'openrouter/auto',
      powerRank: 17,
      costTier: 'premium',
      excludeFromAutoSelect: true,
    },
  ],
};

interface AiDouble {
  readonly setApiKeyCalls: () => readonly { vendorId: string; apiKey: string }[];
  readonly removeApiKeyCalls: () => readonly string[];
  readonly settings: () => AISettings;
}

interface DoubleOptions {
  /** What `validateApiKey` answers. `false` is the rejected-key path. */
  readonly keyValid?: boolean;
  readonly initialSettings?: AISettings;
  /** The catalogue `ai.getVendors()` answers with. Defaults to the two-vendor list. */
  readonly vendors?: readonly AIVendor[];
}

const teardowns: (() => void)[] = [];
/** Everything that reached the diagnostics sink and the toaster, for the trace assertions. */
let messages: string[] = [];
let appState: AppStateDouble;
let queryClient: QueryClient;

function installAiBridge(options: DoubleOptions = {}): AiDouble {
  const setCalls: { vendorId: string; apiKey: string }[] = [];
  const removeCalls: string[] = [];
  let settings: AISettings = options.initialSettings ?? { ...DEFAULT_AI_SETTINGS };

  appState = createAppStateDouble();
  teardowns.push(
    installJoineryMock({
      app: appState.app,
      ai: {
        getVendors: () => Promise.resolve([...(options.vendors ?? [GEMINI, CEREBRAS])]),
        getSettings: () => Promise.resolve(settings),
        // Parameters are annotated because `installJoineryMock` takes a `DeepPartial<JoineryAPI>`,
        // which recurses into function types and erases their signatures (`test/joinery-mock.ts`).
        setSettings: (partial: Partial<AISettings>) => {
          settings = { ...settings, ...partial };
          return Promise.resolve(settings);
        },
        validateApiKey: (_vendorId: string, _apiKey: string) =>
          Promise.resolve(options.keyValid !== false),
        setApiKey: (vendorId: string, apiKey: string) => {
          setCalls.push({ vendorId, apiKey });
          return Promise.resolve(true);
        },
        removeApiKey: (vendorId: string) => {
          removeCalls.push(vendorId);
          return Promise.resolve(true);
        },
      },
    })
  );

  return {
    setApiKeyCalls: () => setCalls,
    removeApiKeyCalls: () => removeCalls,
    settings: () => settings,
  };
}

/** Hydrates the store the way `AiSetupHost` does, then mounts the dialog. */
async function mount(): Promise<void> {
  await aiStore.getState().initialize();
  // The app's own `IpcQueryProvider` builds its client internally; here the client is constructed by
  // the test so its cache can be searched for the secret afterwards.
  queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AiSetupDialog onDismiss={() => undefined} />
      </TooltipProvider>
    </QueryClientProvider>
  );
  await screen.findByTestId('ai-setup-dialog');
}

/** Types the secret into the key field and presses Save. */
async function saveKey(): Promise<void> {
  await userEvent.type(screen.getByTestId('ai-setup-key'), SECRET);
  await userEvent.click(screen.getByTestId('ai-setup-save-key'));
}

beforeEach(() => {
  messages = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  teardowns.push(
    setDiagnosticsSink({
      error: (context, cause) => messages.push(`${context} :: ${String(cause)}`),
      warn: (context, cause) => messages.push(`${context} :: ${String(cause)}`),
    }),
    setNotifier({
      success: text => messages.push(text),
      error: text => messages.push(text),
      info: text => messages.push(text),
      warning: text => messages.push(text),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  aiStore.setState(aiStore.getInitialState());
});

describe('the AI setup dialog', () => {
  it('lists every vendor the config file declares, not a hardcoded four', async () => {
    // The Angular dialog hardcoded google/openai/anthropic/groq, so Cerebras — which main supports —
    // was unreachable. The list is `ai.getVendors()` now, which is what makes that impossible.
    installAiBridge();
    await mount();

    await userEvent.click(screen.getByTestId('ai-setup-vendor'));
    const options = await screen.findAllByRole('option');
    expect(options.map(option => option.textContent)).toEqual(['Google Gemini', 'Cerebras']);
  });

  it('validates before it saves, and turns the master switch on afterwards', async () => {
    const double = installAiBridge();
    await mount();
    await saveKey();

    await waitFor(() => expect(double.setApiKeyCalls()).toHaveLength(1));
    expect(double.setApiKeyCalls()[0]?.vendorId).toBe('google');
    // The one place the key is legitimately seen: the call argument.
    expect(double.setApiKeyCalls()[0]?.apiKey).toBe(SECRET);

    // `apiKeyConfigured` came back through `ai.setSettings`, so the badge flipped.
    await waitFor(() =>
      expect(screen.getByTestId('ai-setup-key-state').getAttribute('data-state')).toBe('saved')
    );
    await waitFor(() => expect(double.settings().enabled).toBe(true));
  });

  it('says the key was rejected and never calls setApiKey', async () => {
    const double = installAiBridge({ keyValid: false });
    await mount();
    await saveKey();

    await waitFor(() =>
      expect(screen.getByTestId('ai-setup-key-state').getAttribute('data-state')).toBe('rejected')
    );
    // A typo must not reach the keychain — that is the whole reason the store validates first.
    expect(double.setApiKeyCalls()).toEqual([]);
    expect(double.settings().enabled).toBe(false);
  });

  it('clears the field on a successful save, so the secret is not left in the DOM', async () => {
    installAiBridge();
    await mount();
    await saveKey();

    const field = screen.getByTestId('ai-setup-key');
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('leaves the key in no cache, no persisted state, no storage and no log', async () => {
    const double = installAiBridge();
    await mount();
    await saveKey();
    await waitFor(() => expect(double.setApiKeyCalls()).toHaveLength(1));

    const contains = (value: unknown): boolean => JSON.stringify(value ?? null).includes(SECRET);

    // 1. the TanStack cache — keys AND data.
    expect(
      contains(
        queryClient
          .getQueryCache()
          .getAll()
          .map(entry => entry.queryKey)
      )
    ).toBe(false);
    expect(
      contains(
        queryClient
          .getQueryCache()
          .getAll()
          .map(entry => entry.state.data)
      )
    ).toBe(false);
    // 2. main-process `AppState`, which is what `app.setState` writes.
    expect(contains(appState.snapshot())).toBe(false);
    // 3. + 4. both web storages.
    expect(contains({ ...window.localStorage })).toBe(false);
    expect(contains({ ...window.sessionStorage })).toBe(false);
    // 5. diagnostics and toasts.
    expect(messages.join('\n')).not.toContain(SECRET);
    // 6. the store snapshot — only `apiKeyConfigured` may survive a save.
    expect(contains(aiStore.getState().settings)).toBe(false);
    expect(
      aiStore.getState().settings.vendorSettings.find(entry => entry.vendorId === 'google')
        ?.apiKeyConfigured
    ).toBe(true);
    // 7. the DOM.
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('removes a saved key and says so', async () => {
    const double = installAiBridge({
      initialSettings: {
        ...DEFAULT_AI_SETTINGS,
        vendorSettings: [
          { vendorId: 'google', enabled: true, apiKeyConfigured: true, priority: 1 },
        ],
      },
    });
    await mount();

    await userEvent.click(screen.getByTestId('ai-setup-remove-key'));
    await waitFor(() => expect(double.removeApiKeyCalls()).toEqual(['google']));
    await waitFor(() =>
      expect(screen.getByTestId('ai-setup-key-state').getAttribute('data-state')).toBe('none')
    );
  });

  it('forgets the typed key when the vendor changes', async () => {
    // Otherwise switching provider would offer Cerebras a Gemini key — and would keep the secret in
    // state for a vendor the user is no longer looking at.
    installAiBridge();
    await mount();
    await userEvent.type(screen.getByTestId('ai-setup-key'), SECRET);

    await userEvent.click(screen.getByTestId('ai-setup-vendor'));
    await userEvent.click(await screen.findByRole('option', { name: 'Cerebras' }));

    expect((screen.getByTestId('ai-setup-key') as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('writes the preferred model and the three feature switches through the store', async () => {
    const double = installAiBridge();
    await mount();

    await userEvent.click(screen.getByTestId('ai-setup-model'));
    await userEvent.click(await screen.findByRole('option', { name: 'Gemini Pro' }));
    await waitFor(() =>
      expect(
        double.settings().vendorSettings.find(entry => entry.vendorId === 'google')
          ?.preferredModelId
      ).toBe('pro')
    );

    // Defaults are all three on, so a click is what turns one off — and the write must round-trip.
    await userEvent.click(screen.getByTestId('ai-setup-analysis'));
    await waitFor(() => expect(double.settings().features.analysisEnabled).toBe(false));
  });

  /**
   * J-80. The cost tier is a routing preference for OpenRouter's auto-routers, so the control has
   * to be reachable next to the vendor's other settings — and absent for every vendor that has no
   * router to apply it to.
   */
  describe('the auto-router cost tier', () => {
    /** Switches the vendor picker to `name` and waits for the form to follow. */
    async function chooseVendor(name: string): Promise<void> {
      await userEvent.click(screen.getByTestId('ai-setup-vendor'));
      await userEvent.click(await screen.findByRole('option', { name }));
    }

    function savedTier(double: AiDouble): string | undefined {
      return double.settings().vendorSettings.find(entry => entry.vendorId === 'openrouter')
        ?.autoRouterCostTier;
    }

    it('is offered only for a vendor that has an auto-router', async () => {
      installAiBridge({ vendors: [GEMINI, OPENROUTER] });
      await mount();

      // Gemini is the seeded vendor and has no router.
      expect(screen.queryByTestId('ai-setup-cost-tier')).toBeNull();

      await chooseVendor('OpenRouter');
      expect(await screen.findByTestId('ai-setup-cost-tier')).not.toBeNull();
    });

    it('writes the chosen band through the store', async () => {
      const double = installAiBridge({ vendors: [GEMINI, OPENROUTER] });
      await mount();
      await chooseVendor('OpenRouter');

      await userEvent.click(screen.getByTestId('ai-setup-cost-tier'));
      await userEvent.click(await screen.findByRole('option', { name: /^High$/ }));

      await waitFor(() => expect(savedTier(double)).toBe('high'));
    });

    it('offers the five bands plus an unset row, and starts unset', async () => {
      installAiBridge({ vendors: [GEMINI, OPENROUTER] });
      await mount();
      await chooseVendor('OpenRouter');

      await userEvent.click(screen.getByTestId('ai-setup-cost-tier'));
      const options = await screen.findAllByRole('option');
      expect(options).toHaveLength(6);
      expect(options[0]?.textContent).toBe('Provider default');
      expect(options.map(option => option.getAttribute('data-state'))).toEqual([
        'checked',
        'unchecked',
        'unchecked',
        'unchecked',
        'unchecked',
        'unchecked',
      ]);
    });

    it('clears the preference back to undefined, not to the cheapest band', async () => {
      // Unset is a distinct instruction: OpenRouter then chooses the band itself. Writing `'low'`
      // here would silently pin the cheapest models forever.
      const double = installAiBridge({
        vendors: [GEMINI, OPENROUTER],
        initialSettings: {
          ...DEFAULT_AI_SETTINGS,
          vendorSettings: [
            {
              vendorId: 'openrouter',
              enabled: true,
              apiKeyConfigured: true,
              priority: 0,
              autoRouterCostTier: 'max',
            },
          ],
        },
      });
      await mount();
      await chooseVendor('OpenRouter');

      await userEvent.click(screen.getByTestId('ai-setup-cost-tier'));
      await userEvent.click(await screen.findByRole('option', { name: 'Provider default' }));

      await waitFor(() => expect(savedTier(double)).toBeUndefined());
    });
  });
});
