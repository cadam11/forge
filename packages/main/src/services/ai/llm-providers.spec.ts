/**
 * Unit tests for multi-provider LLM abstraction
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AI_VENDORS_CONFIG } from '@joinery/shared';
import {
  getLLMProvider,
  GeminiStreamProvider,
  AnthropicStreamProvider,
  OpenAICompatibleStreamProvider,
  OPENROUTER_BASE_URL,
  OPENROUTER_HEADERS,
  type ChatCompletionParams,
  type StreamCallbacks,
  type StreamToolCall,
} from './llm-providers';

describe('LLM Providers', () => {
  describe('getLLMProvider', () => {
    it('returns GeminiStreamProvider for google', () => {
      const provider = getLLMProvider('google');
      expect(provider).toBeInstanceOf(GeminiStreamProvider);
      expect(provider.vendorId).toBe('google');
    });

    it('returns AnthropicStreamProvider for anthropic', () => {
      const provider = getLLMProvider('anthropic');
      expect(provider).toBeInstanceOf(AnthropicStreamProvider);
      expect(provider.vendorId).toBe('anthropic');
    });

    it('returns OpenAICompatibleStreamProvider for openai', () => {
      const provider = getLLMProvider('openai');
      expect(provider).toBeInstanceOf(OpenAICompatibleStreamProvider);
      expect(provider.vendorId).toBe('openai');
    });

    it('returns OpenAICompatibleStreamProvider for groq', () => {
      const provider = getLLMProvider('groq');
      expect(provider).toBeInstanceOf(OpenAICompatibleStreamProvider);
      expect(provider.vendorId).toBe('groq');
    });

    it('returns OpenAICompatibleStreamProvider for cerebras', () => {
      const provider = getLLMProvider('cerebras');
      expect(provider).toBeInstanceOf(OpenAICompatibleStreamProvider);
      expect(provider.vendorId).toBe('cerebras');
    });

    it('returns OpenAICompatibleStreamProvider for openrouter', () => {
      const provider = getLLMProvider('openrouter');
      expect(provider).toBeInstanceOf(OpenAICompatibleStreamProvider);
      expect(provider.vendorId).toBe('openrouter');
    });

    it('throws for unknown vendor', () => {
      expect(() => getLLMProvider('unknown-vendor')).toThrow('Unknown vendor: unknown-vendor');
    });

    it('caches provider instances', () => {
      const first = getLLMProvider('google');
      const second = getLLMProvider('google');
      expect(first).toBe(second);
    });

    it('has a streaming provider for every vendor in the catalogue', () => {
      for (const vendor of AI_VENDORS_CONFIG.vendors) {
        expect(() => getLLMProvider(vendor.id)).not.toThrow();
      }
    });
  });

  describe('GeminiStreamProvider', () => {
    it('has correct vendorId', () => {
      const provider = new GeminiStreamProvider();
      expect(provider.vendorId).toBe('google');
    });
  });

  describe('AnthropicStreamProvider', () => {
    it('has correct vendorId', () => {
      const provider = new AnthropicStreamProvider();
      expect(provider.vendorId).toBe('anthropic');
    });
  });

  describe('OpenAICompatibleStreamProvider', () => {
    it('stores vendorId and baseUrl', () => {
      const provider = new OpenAICompatibleStreamProvider('test', 'https://test.api.com');
      expect(provider.vendorId).toBe('test');
    });
  });
});

// ---- OpenRouter (J-77) ----

/** Wraps SSE `data:` frames in the Response shape `streamChat` consumes. */
function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

interface StreamRecord {
  content: string[];
  toolCalls: StreamToolCall[];
  /** How many times `onComplete` fired. A counter, so it must not be spread-copied out. */
  completions: number;
  errors: Error[];
}

/**
 * Collects everything the provider emits so a test can assert on the whole stream.
 *
 * The record is returned by reference, not spread into the result: spreading copies the
 * `completions` primitive at construction time and the caller then watches a frozen zero.
 */
function recordingCallbacks(): { callbacks: StreamCallbacks; record: StreamRecord } {
  const record: StreamRecord = { content: [], toolCalls: [], completions: 0, errors: [] };
  const callbacks: StreamCallbacks = {
    onContent: text => record.content.push(text),
    onToolCall: call => record.toolCalls.push(call),
    onComplete: () => {
      record.completions += 1;
    },
    onError: error => record.errors.push(error),
  };
  return { callbacks, record };
}

function params(overrides: Partial<ChatCompletionParams> = {}): ChatCompletionParams {
  return {
    messages: [{ role: 'user', content: 'list the tables' }],
    model: 'anthropic/claude-sonnet-4.5',
    apiKey: 'sk-or-v1-test-key',
    ...overrides,
  };
}

/** The single fetch call the provider made, decoded. */
function lastRequest(fetchMock: ReturnType<typeof vi.fn>): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
} {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string) as Record<string, unknown>,
  };
}

describe('OpenRouter provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to OpenRouter's chat-completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('openrouter').streamChat(params(), recordingCallbacks().callbacks);

    expect(lastRequest(fetchMock).url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api');
  });

  it('sends the attribution headers alongside the bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('openrouter').streamChat(params(), recordingCallbacks().callbacks);

    expect(lastRequest(fetchMock).headers).toEqual({
      'HTTP-Referer': 'https://github.com/cadam11/joinery',
      'X-Title': 'Joinery',
      Authorization: 'Bearer sk-or-v1-test-key',
      'Content-Type': 'application/json',
    });
    expect(OPENROUTER_HEADERS['X-Title']).toBe('Joinery');
  });

  it('leaves the other OpenAI-compatible vendors free of those headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('groq').streamChat(params(), recordingCallbacks().callbacks);

    const request = lastRequest(fetchMock);
    expect(request.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(request.headers['HTTP-Referer']).toBeUndefined();
    expect(request.headers['X-Title']).toBeUndefined();
  });

  it('passes the namespaced model id through untouched and streams', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('openrouter').streamChat(
      params({ model: 'meta-llama/llama-3.3-70b-instruct' }),
      recordingCallbacks().callbacks
    );

    const { body } = lastRequest(fetchMock);
    expect(body.model).toBe('meta-llama/llama-3.3-70b-instruct');
    expect(body.stream).toBe(true);
  });

  it('converts tools to the OpenAI function schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('openrouter').streamChat(
      params({
        systemPrompt: 'You are a SQL assistant.',
        tools: [
          {
            name: 'list_tables',
            description: 'List tables in a database',
            parameters: { type: 'object', properties: { database: { type: 'string' } } },
          },
        ],
      }),
      recordingCallbacks().callbacks
    );

    const { body } = lastRequest(fetchMock);
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'list_tables',
          description: 'List tables in a database',
          parameters: { type: 'object', properties: { database: { type: 'string' } } },
        },
      },
    ]);
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a SQL assistant.' },
      { role: 'user', content: 'list the tables' },
    ]);
  });

  it('emits content deltas in order and completes once', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse([
          JSON.stringify({ choices: [{ delta: { content: 'Two ' } }] }),
          JSON.stringify({ choices: [{ delta: { content: 'tables' } }] }),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    const recorder = recordingCallbacks();
    await getLLMProvider('openrouter').streamChat(params(), recorder.callbacks);

    expect(recorder.record.content.join('')).toBe('Two tables');
    // `onComplete` is part of the mandatory StreamCallbacks contract: chat-service ends the
    // turn on it, so a provider that never fires it would hang the UI.
    expect(recorder.record.completions).toBe(1);
    expect(recorder.record.errors).toHaveLength(0);
  });

  it('reassembles a tool call whose arguments arrive across chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', function: { name: 'list_tables', arguments: '' } },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"data' } }] } }],
        }),
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'base":"app"}' } }] } },
          ],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      ])
    );
    vi.stubGlobal('fetch', fetchMock);

    const recorder = recordingCallbacks();
    await getLLMProvider('openrouter').streamChat(params(), recorder.callbacks);

    expect(recorder.record.toolCalls).toEqual([
      { id: 'call_1', name: 'list_tables', args: { database: 'app' } },
    ]);
    expect(recorder.record.completions).toBe(1);
  });

  it('sends prior tool results back in the OpenAI tool-message shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await getLLMProvider('openrouter').streamChat(
      params({
        messages: [
          { role: 'user', content: 'list the tables' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'list_tables', args: { database: 'app' } }],
          },
          { role: 'tool', content: '["users"]', toolCallId: 'call_1', toolName: 'list_tables' },
        ],
      }),
      recordingCallbacks().callbacks
    );

    expect(lastRequest(fetchMock).body.messages).toEqual([
      { role: 'user', content: 'list the tables' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'list_tables', arguments: '{"database":"app"}' },
          },
        ],
      },
      { role: 'tool', content: '["users"]', tool_call_id: 'call_1' },
    ]);
  });

  it('raises the HTTP failure instead of swallowing it — without echoing the key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"error":{"message":"No auth credentials found"}}'),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const recorder = recordingCallbacks();
    const caught = await getLLMProvider('openrouter')
      .streamChat(params(), recorder.callbacks)
      .then(
        () => null,
        (error: unknown) => error as Error
      );

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain('openrouter API error (401)');
    expect(caught?.message).not.toContain('sk-or-v1-test-key');
    // A failed turn must not look like a finished one to chat-service.
    expect(recorder.record.completions).toBe(0);
  });
});
