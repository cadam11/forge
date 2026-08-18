/**
 * Integrity guards for the AI vendor catalogue.
 *
 * `AIService.getModelAndProvider` resolves a saved model id by scanning every vendor's models,
 * so a duplicate id across vendors would silently route a request to the wrong vendor. That is
 * the failure this file exists to catch — OpenRouter (J-77) is the first vendor whose models
 * are re-exports of other vendors' models, which makes the collision easy to reintroduce.
 */
import { describe, it, expect } from 'vitest';
import { AI_VENDORS_CONFIG } from './index';

describe('ai-vendors.json', () => {
  const vendors = AI_VENDORS_CONFIG.vendors;

  it('gives every model a globally unique id', () => {
    const ids = vendors.flatMap(vendor => vendor.models.map(model => model.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every vendor a unique id and at least one model', () => {
    const ids = vendors.map(vendor => vendor.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const vendor of vendors) {
      expect(vendor.models.length).toBeGreaterThan(0);
    }
  });

  it('marks at most one default model per vendor', () => {
    for (const vendor of vendors) {
      expect(vendor.models.filter(model => model.default).length).toBeLessThanOrEqual(1);
    }
  });

  describe('openrouter', () => {
    const openrouter = vendors.find(vendor => vendor.id === 'openrouter');

    it('is in the catalogue and needs a key', () => {
      expect(openrouter).toBeDefined();
      expect(openrouter?.requiresApiKey).toBe(true);
      expect(openrouter?.docsUrl).toBe('https://openrouter.ai/keys');
    });

    it('uses namespaced upstream model ids', () => {
      expect(openrouter?.models.length).toBeGreaterThan(0);
      for (const model of openrouter?.models ?? []) {
        expect(model.apiName).toMatch(/^[a-z0-9-]+\/.+/);
        expect(model.supportsStreaming).toBe(true);
      }
    });

    it('nominates a default model, since chat picks one unprompted', () => {
      expect(openrouter?.models.filter(model => model.default)).toHaveLength(1);
    });
  });
});
