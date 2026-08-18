/**
 * Unit tests for chat's automatic model choice.
 *
 * J-79 made meta/router models (OpenRouter's auto routers) explicit-pick only. `AIService`'s
 * power-rank targeting was the obvious automatic path; this is the other one — chat picks a
 * model for the user whenever no model is pinned for the vendor. Four of the six shipping
 * vendors nominate no default, so the highest-power-rank fallback below is a live path, and
 * nothing but this test stops a router winning it.
 */
import { describe, it, expect } from 'vitest';
import type { AIModel, AIVendor } from '@joinery/shared';
import { AI_VENDORS_CONFIG } from '@joinery/shared';
import { autoSelectModel } from './chat-service';

function model(overrides: Partial<AIModel> & Pick<AIModel, 'id'>): AIModel {
  return {
    name: overrides.id,
    apiName: overrides.id,
    powerRank: 10,
    costTier: 'standard',
    ...overrides,
  };
}

function vendorWith(models: AIModel[]): AIVendor {
  return { id: 'test-vendor', name: 'Test Vendor', requiresApiKey: true, models };
}

describe('autoSelectModel', () => {
  it('skips a meta model in a vendor that nominates no default, however highly ranked', () => {
    const vendor = vendorWith([
      model({ id: 'router', powerRank: 19, excludeFromAutoSelect: true }),
      model({ id: 'concrete', powerRank: 12 }),
    ]);

    expect(autoSelectModel(vendor)?.id).toBe('concrete');
  });

  it('skips a meta model even when it is the vendor-nominated default', () => {
    const vendor = vendorWith([
      model({ id: 'router', powerRank: 19, default: true, excludeFromAutoSelect: true }),
      model({ id: 'concrete', powerRank: 12 }),
    ]);

    expect(autoSelectModel(vendor)?.id).toBe('concrete');
  });

  it('has no automatic choice for a vendor offering nothing but meta models', () => {
    const vendor = vendorWith([model({ id: 'router', excludeFromAutoSelect: true })]);

    expect(autoSelectModel(vendor)).toBeNull();
  });

  it('prefers the nominated default over a more capable sibling', () => {
    const vendor = vendorWith([
      model({ id: 'flagship', powerRank: 19 }),
      model({ id: 'workhorse', powerRank: 12, default: true }),
    ]);

    expect(autoSelectModel(vendor)?.id).toBe('workhorse');
  });

  it('falls back to the most capable stable model, passing over previews', () => {
    const vendor = vendorWith([
      model({ id: 'next', apiName: 'next-preview', powerRank: 19 }),
      model({ id: 'shipping', powerRank: 16 }),
      model({ id: 'small', powerRank: 8 }),
    ]);

    expect(autoSelectModel(vendor)?.id).toBe('shipping');
  });

  it('takes a preview only when the vendor ships nothing else', () => {
    const vendor = vendorWith([model({ id: 'next', apiName: 'next-preview', powerRank: 19 })]);

    expect(autoSelectModel(vendor)?.id).toBe('next');
  });

  it('picks an auto-selectable model for every vendor in the shipping catalogue', () => {
    for (const vendor of AI_VENDORS_CONFIG.vendors) {
      const chosen = autoSelectModel(vendor);
      expect(chosen, `no chat model for ${vendor.id}`).not.toBeNull();
      expect(
        chosen?.excludeFromAutoSelect,
        `${vendor.id} chose ${chosen?.apiName}`
      ).toBeUndefined();
    }
  });
});
