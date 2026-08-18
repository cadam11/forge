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

    it('nominates Claude Sonnet 4.5 as the default, since chat picks one unprompted', () => {
      const defaults = openrouter?.models.filter(model => model.default) ?? [];
      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.apiName).toBe('anthropic/claude-sonnet-4.5');
    });

    // J-79. The routers are deliberately selectable-only: a user may pick one in the model
    // picker, but nothing may pick one on the user's behalf, because a router's capability and
    // price are whatever it happens to route to.
    describe('meta / router models', () => {
      const routers = [
        { id: 'openrouter-auto-beta', apiName: 'openrouter/auto-beta', context: 2000000 },
        { id: 'openrouter-auto', apiName: 'openrouter/auto', context: 2000000 },
        { id: 'openrouter-free', apiName: 'openrouter/free', context: 200000 },
      ];

      for (const router of routers) {
        it(`offers ${router.apiName} under the vendor's id prefix`, () => {
          const model = openrouter?.models.find(m => m.apiName === router.apiName);
          expect(model).toBeDefined();
          expect(model?.id).toBe(router.id);
          expect(model?.id.startsWith('openrouter-')).toBe(true);
          expect(model?.maxContextTokens).toBe(router.context);
        });

        it(`keeps ${router.apiName} out of automatic selection and off the default slot`, () => {
          const model = openrouter?.models.find(m => m.apiName === router.apiName);
          expect(model?.default).toBeUndefined();
          expect(model?.excludeFromAutoSelect).toBe(true);
        });
      }

      it('excludes no concrete model from automatic selection', () => {
        const excluded = (openrouter?.models ?? [])
          .filter(model => model.excludeFromAutoSelect)
          .map(model => model.apiName);
        expect(excluded).toEqual(routers.map(router => router.apiName));
      });
    });

    it('offers Claude Opus 5 as its top-ranked flagship', () => {
      const opus = openrouter?.models.find(model => model.apiName === 'anthropic/claude-opus-5');
      expect(opus).toBeDefined();
      expect(opus?.costTier).toBe('premium');
      const others = (openrouter?.models ?? []).filter(model => model !== opus);
      expect(Math.max(...others.map(model => model.powerRank))).toBeLessThan(
        opus?.powerRank ?? -Infinity
      );
    });
  });
});
