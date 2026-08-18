/**
 * Unit tests for the OpenAI-compatible provider used by the simple AI features
 * (tab rename, analysis, query assist).
 *
 * J-77 collapsed three near-identical per-vendor classes (OpenAI, Groq, Cerebras) into one
 * parameterised class plus a table, so that OpenRouter could join without a fourth copy. That
 * refactor rewired three shipping vendors, and nothing pinned their request shape. These tests
 * are that pin: composed URLs, error labels, and — the part the refactor got wrong once — the
 * exact headers on each of the two calls.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { AIModel, AISettings } from '@joinery/shared';
import { DEFAULT_AI_SETTINGS } from '@joinery/shared';
import { AIService, OPENAI_COMPATIBLE_VENDORS, OpenAICompatibleProvider } from './ai-service';
import { CredentialStore } from '../keychain/credential-store';

// AIService reads its settings from electron-store on construction, which has no home in a node
// test process. The keychain is left real: `keytar` is already aliased to an in-memory mock.
const appState = vi.hoisted(() => ({ aiSettings: undefined as AISettings | undefined }));
vi.mock('../config/app-state', () => ({
  AppStateStore: {
    getInstance: () => ({
      getState: () => ({ aiSettings: appState.aiSettings }),
      // Persisted writes are discarded: nothing here reads settings back off disk.
      setState: vi.fn(),
    }),
  },
}));

const MODEL: AIModel = {
  id: 'test-model',
  name: 'Test Model',
  apiName: 'vendor/test-model',
  powerRank: 10,
  costTier: 'standard',
};

function configFor(vendorId: string) {
  const config = OPENAI_COMPATIBLE_VENDORS.find(entry => entry.vendorId === vendorId);
  if (!config) throw new Error(`No OpenAI-compatible config for ${vendorId}`);
  return config;
}

/** The single fetch call the provider made, decoded. */
function lastCall(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
} {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
  return {
    url,
    method: init?.method,
    headers: (init?.headers ?? {}) as Record<string, string>,
  };
}

function stubFetch(response: Partial<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OpenAI-compatible vendor table', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('covers exactly the four vendors that speak this dialect', () => {
    expect(OPENAI_COMPATIBLE_VENDORS.map(entry => entry.vendorId)).toEqual([
      'openai',
      'groq',
      'cerebras',
      'openrouter',
    ]);
  });

  // The pre-existing three must keep the endpoints and labels they shipped with; OpenRouter's
  // are the new ones J-77 introduces. A regression in any cell is a user-visible bug.
  const expectations = [
    {
      vendorId: 'openai',
      validateUrl: 'https://api.openai.com/v1/models',
      completionUrl: 'https://api.openai.com/v1/chat/completions',
      label: 'OpenAI',
    },
    {
      vendorId: 'groq',
      validateUrl: 'https://api.groq.com/openai/v1/models',
      completionUrl: 'https://api.groq.com/openai/v1/chat/completions',
      label: 'Groq',
    },
    {
      vendorId: 'cerebras',
      validateUrl: 'https://api.cerebras.ai/v1/models',
      completionUrl: 'https://api.cerebras.ai/v1/chat/completions',
      label: 'Cerebras',
    },
    {
      vendorId: 'openrouter',
      // Not /v1/models: OpenRouter's catalogue is public and would accept any key.
      validateUrl: 'https://openrouter.ai/api/v1/key',
      completionUrl: 'https://openrouter.ai/api/v1/chat/completions',
      label: 'OpenRouter',
    },
  ];

  for (const expected of expectations) {
    describe(expected.vendorId, () => {
      it('validates a key against the expected URL, with an auth-only bodyless GET', async () => {
        const fetchMock = stubFetch({ ok: true, status: 200 });
        const provider = new OpenAICompatibleProvider(configFor(expected.vendorId));

        await expect(provider.validateApiKey('test-key')).resolves.toBe(true);

        const call = lastCall(fetchMock);
        expect(call.url).toBe(expected.validateUrl);
        expect(call.method).toBeUndefined();
        // No Content-Type on a request with no body — this is the shape the three
        // pre-existing vendors shipped with, and OpenRouter adds only its attribution.
        expect(call.headers['Content-Type']).toBeUndefined();
        expect(call.headers.Authorization).toBe('Bearer test-key');
      });

      it('reports a rejected key as invalid rather than throwing', async () => {
        stubFetch({ ok: false, status: 401 });
        const provider = new OpenAICompatibleProvider(configFor(expected.vendorId));

        await expect(provider.validateApiKey('bad-key')).resolves.toBe(false);
      });

      it('posts completions to the expected URL as JSON', async () => {
        const fetchMock = stubFetch({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ choices: [{ message: { content: 'Hi' } }] }),
        });
        const provider = new OpenAICompatibleProvider(configFor(expected.vendorId));

        await expect(provider.generateCompletion('prompt', MODEL, 'test-key')).resolves.toBe('Hi');

        const call = lastCall(fetchMock);
        expect(call.url).toBe(expected.completionUrl);
        expect(call.method).toBe('POST');
        expect(call.headers['Content-Type']).toBe('application/json');
        expect(call.headers.Authorization).toBe('Bearer test-key');
      });

      it('labels a failed completion with the vendor name, not the key', async () => {
        stubFetch({ ok: false, status: 500 });
        const provider = new OpenAICompatibleProvider(configFor(expected.vendorId));

        const caught = await provider.generateCompletion('prompt', MODEL, 'test-key').then(
          () => null,
          (error: unknown) => error as Error
        );

        expect(caught?.message).toBe(`${expected.label} API error: 500`);
        expect(caught?.message).not.toContain('test-key');
      });
    });
  }

  it('sends OpenRouter attribution headers on both calls, and only for OpenRouter', async () => {
    const attribution = {
      'HTTP-Referer': 'https://github.com/cadam11/joinery',
      'X-Title': 'Joinery',
    };

    const validateMock = stubFetch({ ok: true, status: 200 });
    await new OpenAICompatibleProvider(configFor('openrouter')).validateApiKey('test-key');
    expect(lastCall(validateMock).headers).toMatchObject(attribution);
    vi.unstubAllGlobals();

    const completionMock = stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content: 'Hi' } }] }),
    });
    await new OpenAICompatibleProvider(configFor('openrouter')).generateCompletion(
      'prompt',
      MODEL,
      'test-key'
    );
    expect(lastCall(completionMock).headers).toMatchObject(attribution);
    vi.unstubAllGlobals();

    const groqMock = stubFetch({ ok: true, status: 200 });
    await new OpenAICompatibleProvider(configFor('groq')).validateApiKey('test-key');
    const groqHeaders = lastCall(groqMock).headers;
    expect(groqHeaders['HTTP-Referer']).toBeUndefined();
    expect(groqHeaders['X-Title']).toBeUndefined();
  });

  it('returns false — and does not throw — when the key check cannot reach the network', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAICompatibleProvider(configFor('openrouter'));
    await expect(provider.validateApiKey('test-key')).resolves.toBe(false);
  });
});

/**
 * J-79. The simple AI features fall back to power-rank targeting when the user has pinned no
 * model: rank 6 for a tab rename, rank 10 for analysis. OpenRouter's meta models (auto routers)
 * are the first catalogue entries whose capability and price are not their own — they are
 * whatever the router picks — so rank targeting cannot reason about them and must never land on
 * one. These tests drive the real selection path and read the model off the wire.
 */
describe('power-rank auto-selection', () => {
  // Hard-coded, not derived from the config: a test that read the exclusion flag back out of the
  // catalogue would pass vacuously the moment someone dropped the flag.
  const ROUTER_API_NAMES = ['openrouter/auto-beta', 'openrouter/auto', 'openrouter/free'];

  afterEach(() => {
    vi.unstubAllGlobals();
    appState.aiSettings = undefined;
  });

  /** An AIService whose only enabled vendor is OpenRouter, with a key in the mock keychain. */
  async function serviceWithOnlyOpenRouter(
    features: Partial<AISettings['features']> = {}
  ): Promise<AIService> {
    appState.aiSettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      vendorSettings: [
        { vendorId: 'openrouter', enabled: true, apiKeyConfigured: true, priority: 0 },
      ],
      features: { ...DEFAULT_AI_SETTINGS.features, ...features },
    };
    await CredentialStore.getInstance().set('ai-openrouter', 'test-key');
    return new AIService();
  }

  /** The `model` field of the single chat-completions request the service made. */
  function modelSentTo(fetchMock: ReturnType<typeof vi.fn>): string {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return (JSON.parse(init.body as string) as { model: string }).model;
  }

  function stubCompletion(content: string): ReturnType<typeof vi.fn> {
    return stubFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    });
  }

  it('renames a tab with a concrete model, never a router', async () => {
    const fetchMock = stubCompletion('ActiveUsers');
    const service = await serviceWithOnlyOpenRouter();

    const result = await service.generateTabName({ sql: 'SELECT * FROM users' });

    expect(result.suggestedName).toBe('ActiveUsers');
    expect(ROUTER_API_NAMES).not.toContain(modelSentTo(fetchMock));
  });

  it('analyses results with a concrete model, never a router', async () => {
    const fetchMock = stubCompletion('Looks fine.');
    const service = await serviceWithOnlyOpenRouter();

    const result = await service.analyzeResults({
      sql: 'SELECT * FROM users',
      resultSummary: { rowCount: 1, columnCount: 1, columns: [] },
    });

    expect(result.content).toBe('Looks fine.');
    expect(ROUTER_API_NAMES).not.toContain(modelSentTo(fetchMock));
  });

  it('still uses a router when the user pins one to a feature', async () => {
    const fetchMock = stubCompletion('Routed');
    const service = await serviceWithOnlyOpenRouter({ tabRenameModelId: 'openrouter-auto-beta' });

    await service.generateTabName({ sql: 'SELECT * FROM users' });

    expect(modelSentTo(fetchMock)).toBe('openrouter/auto-beta');
  });
});
