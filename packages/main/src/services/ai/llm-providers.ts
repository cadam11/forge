/**
 * Multi-provider LLM abstraction with streaming + tool calling
 *
 * Supports: Google Gemini, Anthropic, OpenAI, Groq, Cerebras
 * All providers stream responses via callbacks and support function calling.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('LLM');

// ---- Shared types ----

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** For tool result messages */
  toolCallId?: string;
  toolName?: string;
  /** Tool calls made by assistant (for multi-turn agentic loop) */
  toolCalls?: StreamToolCall[];
}

export interface ToolForAPI {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StreamToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini thought signature — must be preserved for multi-turn tool calling */
  thoughtSignature?: string;
}

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (call: StreamToolCall) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

export interface ChatCompletionParams {
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolForAPI[];
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  vendorId: string;
  streamChat(params: ChatCompletionParams, callbacks: StreamCallbacks): Promise<void>;
}

// ---- SSE parsing utility ----

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ')) {
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        yield data;
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim().startsWith('data: ')) {
    const data = buffer.trim().slice(6);
    if (data !== '[DONE]') yield data;
  }
}

// ---- Google Gemini Provider ----

export class GeminiStreamProvider implements LLMProvider {
  vendorId = 'google';

  async streamChat(params: ChatCompletionParams, callbacks: StreamCallbacks): Promise<void> {
    const contents = this.buildContents(params.messages);
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens || 4096,
        temperature: params.temperature ?? 0.7,
      },
    };

    if (params.systemPrompt) {
      body.systemInstruction = { parts: [{ text: params.systemPrompt }] };
    }

    if (params.tools?.length) {
      body.tools = [{ functionDeclarations: params.tools }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent?alt=sse&key=${params.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const reader = response.body!.getReader();
    try {
      for await (const data of parseSSEStream(reader, params.signal)) {
        try {
          const json = JSON.parse(data);
          const candidate = json.candidates?.[0];
          if (!candidate?.content?.parts) continue;

          for (const part of candidate.content.parts) {
            if (part.text && !part.thought) {
              callbacks.onContent(part.text);
            }
            if (part.functionCall) {
              callbacks.onToolCall({
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: part.functionCall.name,
                args: part.functionCall.args || {},
                thoughtSignature: part.thoughtSignature,
              });
            }
          }
        } catch {
          // Skip malformed chunks
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete();
  }

  private buildContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // Handled via systemInstruction

      if (msg.role === 'tool') {
        // Gemini expects functionResponse.response to be a plain object (not array)
        let parsed: unknown;
        try { parsed = JSON.parse(msg.content); } catch { parsed = msg.content; }
        // Wrap arrays and primitives in an object
        const responseObj = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          ? parsed as Record<string, unknown>
          : { result: parsed };
        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.toolName || 'unknown',
              response: responseObj,
            },
          }],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: Array<Record<string, unknown>> = [];
        // Gemini requires thoughtSignature at part level alongside functionCall
        if (msg.toolCalls?.length) {
          parts.push({ text: msg.content || 'Calling tools to help answer.', thought: true });
          for (const tc of msg.toolCalls) {
            const part: Record<string, unknown> = {
              functionCall: { name: tc.name, args: tc.args },
            };
            if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
            parts.push(part);
          }
        } else {
          parts.push({ text: msg.content || '(empty)' });
        }
        contents.push({ role: 'model', parts });
      } else {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content || '(empty)' }],
        });
      }
    }

    return contents;
  }
}

// ---- Anthropic Provider ----

export class AnthropicStreamProvider implements LLMProvider {
  vendorId = 'anthropic';

  async streamChat(params: ChatCompletionParams, callbacks: StreamCallbacks): Promise<void> {
    const messages = params.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user' as const,
            content: [{
              type: 'tool_result' as const,
              tool_use_id: m.toolCallId || 'unknown',
              content: m.content,
            }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          const content: Array<Record<string, unknown>> = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args });
          }
          return { role: 'assistant' as const, content };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      });

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens || 4096,
      stream: true,
      messages,
    };

    if (params.systemPrompt) {
      body.system = params.systemPrompt;
    }

    if (params.tools?.length) {
      body.tools = params.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
    }

    const reader = response.body!.getReader();
    let currentToolCall: { id: string; name: string; argsJson: string } | null = null;

    try {
      for await (const data of parseSSEStream(reader, params.signal)) {
        try {
          const event = JSON.parse(data);

          if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'tool_use') {
              currentToolCall = {
                id: event.content_block.id,
                name: event.content_block.name,
                argsJson: '',
              };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              callbacks.onContent(event.delta.text);
            } else if (event.delta?.type === 'input_json_delta' && currentToolCall) {
              currentToolCall.argsJson += event.delta.partial_json || '';
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolCall) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(currentToolCall.argsJson); } catch { /* empty */ }
              callbacks.onToolCall({
                id: currentToolCall.id,
                name: currentToolCall.name,
                args,
              });
              currentToolCall = null;
            }
          }
        } catch {
          // Skip malformed events
        }
      }
    } finally {
      reader.releaseLock();
    }

    callbacks.onComplete();
  }
}

// ---- OpenAI-compatible Provider (OpenAI, Groq, Cerebras) ----

export class OpenAICompatibleStreamProvider implements LLMProvider {
  vendorId: string;
  private baseUrl: string;

  constructor(vendorId: string, baseUrl: string) {
    this.vendorId = vendorId;
    this.baseUrl = baseUrl;
  }

  async streamChat(params: ChatCompletionParams, callbacks: StreamCallbacks): Promise<void> {
    const messages: Array<Record<string, unknown>> = [];

    if (params.systemPrompt) {
      messages.push({ role: 'system', content: params.systemPrompt });
    }

    for (const msg of params.messages) {
      if (msg.role === 'system') {
        messages.push({ role: 'system', content: msg.content });
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId || 'unknown',
        });
      } else if (msg.role === 'assistant' && msg.toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens || 4096,
      temperature: params.temperature ?? 0.7,
      stream: true,
    };

    if (params.tools?.length) {
      body.tools = params.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${this.vendorId} API error (${response.status}): ${errorText}`);
    }

    const reader = response.body!.getReader();
    // Track tool calls being accumulated across chunks
    const pendingToolCalls = new Map<number, { id: string; name: string; argsJson: string }>();

    try {
      for await (const data of parseSSEStream(reader, params.signal)) {
        try {
          const json = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            callbacks.onContent(delta.content);
          }

          // Tool calls
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (tc.id) {
                // Start of a new tool call
                pendingToolCalls.set(idx, {
                  id: tc.id,
                  name: tc.function?.name || '',
                  argsJson: tc.function?.arguments || '',
                });
              } else {
                // Continuation of existing tool call
                const existing = pendingToolCalls.get(idx);
                if (existing) {
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.argsJson += tc.function.arguments;
                }
              }
            }
          }

          // Finish reason
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            // Emit any accumulated tool calls
            for (const [, tc] of pendingToolCalls) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(tc.argsJson); } catch { /* empty */ }
              callbacks.onToolCall({
                id: tc.id,
                name: tc.name,
                args,
              });
            }
            pendingToolCalls.clear();
          }
        } catch {
          // Skip malformed chunks
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Emit any remaining tool calls that weren't flushed
    for (const [, tc] of pendingToolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.argsJson); } catch { /* empty */ }
      callbacks.onToolCall({ id: tc.id, name: tc.name, args });
    }

    callbacks.onComplete();
  }
}

// ---- Provider factory ----

const providerCache = new Map<string, LLMProvider>();

export function getLLMProvider(vendorId: string): LLMProvider {
  let provider = providerCache.get(vendorId);
  if (provider) return provider;

  switch (vendorId) {
    case 'google':
      provider = new GeminiStreamProvider();
      break;
    case 'anthropic':
      provider = new AnthropicStreamProvider();
      break;
    case 'openai':
      provider = new OpenAICompatibleStreamProvider('openai', 'https://api.openai.com');
      break;
    case 'groq':
      provider = new OpenAICompatibleStreamProvider('groq', 'https://api.groq.com/openai');
      break;
    case 'cerebras':
      provider = new OpenAICompatibleStreamProvider('cerebras', 'https://api.cerebras.ai');
      break;
    default:
      throw new Error(`Unknown vendor: ${vendorId}`);
  }

  providerCache.set(vendorId, provider);
  log.info(`Created LLM provider for ${vendorId}`);
  return provider;
}
