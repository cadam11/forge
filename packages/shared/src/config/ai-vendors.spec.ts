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
import {
  OPENROUTER_AUTO_ROUTERS,
  OPENROUTER_COST_TIER_LABELS,
  OPENROUTER_COST_TIERS,
} from '../types/ai.types';

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

  // The `excludeFromAutoSelect` filter runs for every vendor, in chat's fallback as well as in
  // the power-rank targeting, so this sweep has to cover every vendor too: the flag landing on a
  // concrete model anywhere would silently drop it out of both automatic choices. The three
  // OpenRouter routers (J-79) plus Fusion (J-80) are the only models entitled to it.
  it('excludes only the OpenRouter meta models from automatic selection', () => {
    const excluded = vendors
      .flatMap(vendor => vendor.models)
      .filter(model => model.excludeFromAutoSelect)
      .map(model => model.apiName);
    expect(excluded).toEqual([
      'openrouter/auto-beta',
      'openrouter/auto',
      'openrouter/fusion',
      'openrouter/free',
    ]);
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
    });

    /**
     * J-80. Fusion is not a router: it puts a panel of models on the same prompt and has an
     * analyst fuse their answers. That makes it the same *kind* of thing for selection purposes —
     * capability and price are whatever the panel turns out to be — so it carries the same
     * selectable-only flag, and it must NOT be entitled to a cost tier, which is a router-only
     * routing preference.
     */
    describe('fusion (meta model)', () => {
      const fusion = () => openrouter?.models.find(model => model.apiName === 'openrouter/fusion');

      it('is offered under the vendor id prefix, and is selectable-only', () => {
        expect(fusion()).toBeDefined();
        expect(fusion()?.id).toBe('openrouter-fusion');
        expect(fusion()?.excludeFromAutoSelect).toBe(true);
        expect(fusion()?.default).toBeUndefined();
      });

      it('is priced premium, because a call costs the panel plus the analyst', () => {
        expect(fusion()?.costTier).toBe('premium');
      });

      it('names the tradeoff in the label the pickers render', () => {
        // Both model pickers show `name` and nothing else, so if the cost and latency story is
        // not in there the user cannot see it anywhere in the app.
        const name = fusion()?.name ?? '';
        expect(name).toMatch(/fusion/i);
        expect(name).toMatch(/slower/i);
        expect(name).toMatch(/panel/i);
      });

      it('claims a context floor, not a ceiling', () => {
        // OpenRouter publishes no fixed context for fusion — it depends on the panel — and the
        // usable window is the SMALLEST member's, not the largest. 200k is the documented window
        // of the mainstream models this catalogue already re-exports through OpenRouter.
        expect(fusion()?.maxContextTokens).toBe(200000);
      });

      it('takes no cost tier: the routing preference is a router feature', () => {
        expect(OPENROUTER_AUTO_ROUTERS.has('openrouter/fusion')).toBe(false);
      });
    });

    // The request builder attaches a cost tier only to models in this table, so a key that names
    // no real model would silently make the setting a no-op.
    it('backs every entry of the auto-router table with a real model', () => {
      const apiNames = openrouter?.models.map(model => model.apiName) ?? [];
      for (const routerApiName of OPENROUTER_AUTO_ROUTERS.keys()) {
        expect(apiNames).toContain(routerApiName);
      }
      expect([...OPENROUTER_AUTO_ROUTERS.entries()]).toEqual([
        ['openrouter/auto', 'auto-router'],
        ['openrouter/auto-beta', 'auto-beta-router'],
      ]);
    });

    it('lists the five cost bands cheapest first', () => {
      expect(OPENROUTER_COST_TIERS).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('gives every band a label, so no UI ever renders a raw enum value', () => {
      for (const tier of OPENROUTER_COST_TIERS) {
        expect(OPENROUTER_COST_TIER_LABELS[tier]).toBeTruthy();
      }
      expect(Object.keys(OPENROUTER_COST_TIER_LABELS)).toHaveLength(OPENROUTER_COST_TIERS.length);
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
