/**
 * Unit tests for multi-provider LLM abstraction
 */
import { describe, it, expect } from 'vitest';
import { getLLMProvider, GeminiStreamProvider, AnthropicStreamProvider, OpenAICompatibleStreamProvider } from './llm-providers';

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

    it('throws for unknown vendor', () => {
      expect(() => getLLMProvider('unknown-vendor')).toThrow('Unknown vendor: unknown-vendor');
    });

    it('caches provider instances', () => {
      const first = getLLMProvider('google');
      const second = getLLMProvider('google');
      expect(first).toBe(second);
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
