/**
 * The composer's model strip, and the auto-router cost tier that J-92 put in it.
 *
 * ── What this file is responsible for ──────────────────────────────────────────────────────
 *
 * The composer is a **dumb** component: it holds the typed text and nothing else, and the cost tier
 * arrives and leaves as props. So the two things worth proving here are the two things that can go
 * wrong in the component itself:
 *
 * 1. **the visibility predicate**, which decides whether a routing band is offered at all. It has to
 *    agree with the shared `OPENROUTER_AUTO_ROUTERS` map, because that is the map the main process's
 *    request builder looks the outgoing model up in — a UI that offered a band for a model the wire
 *    silently drops it for would be worse than offering none;
 * 2. **the six states are all reachable and mutually exclusive**, and choosing "Provider default"
 *    emits `undefined` rather than the cheapest band — `undefined` is a distinct instruction to
 *    OpenRouter, not a synonym for `'low'`.
 *
 * The store round-trip — that the band this picker writes is the same `AIVendorSettings` field the
 * AI setup dialog edits — is `chat-surface.spec.tsx`'s, because the surface is what owns the wiring.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AIVendor, OpenRouterCostTier } from '@joinery/shared';
import { OPENROUTER_AUTO_ROUTERS, OPENROUTER_COST_TIERS } from '@joinery/shared';

import { TooltipProvider } from '../../ui';
import { ChatComposer, offersCostTier, type SelectedModel } from './chat-composer';

/**
 * A vendor with one concrete model and one auto-router, the shape OpenRouter actually has. The
 * router's `apiName` is what the predicate keys on — not the vendor id — so this exercises the same
 * rule the app does.
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
      id: 'openrouter-auto-beta',
      name: 'Auto Router (Beta)',
      apiName: 'openrouter/auto-beta',
      powerRank: 17,
      costTier: 'premium',
      excludeFromAutoSelect: true,
    },
  ],
};

const AUTO_ROUTER: SelectedModel = {
  vendorId: 'openrouter',
  modelApiName: 'openrouter/auto-beta',
  label: 'Auto Router (Beta)',
};

const PLAIN_MODEL: SelectedModel = {
  vendorId: 'openrouter',
  modelApiName: 'anthropic/claude-sonnet-4.5',
  label: 'Claude Sonnet 4.5',
};

interface MountOptions {
  readonly model?: SelectedModel | null;
  readonly costTier?: OpenRouterCostTier | undefined;
}

function mount(options: MountOptions = {}): {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly costTierChanges: (OpenRouterCostTier | undefined)[];
  readonly unmount: () => void;
} {
  const costTierChanges: (OpenRouterCostTier | undefined)[] = [];
  const user = userEvent.setup();

  const view = render(
    <TooltipProvider>
      <ChatComposer
        streaming={false}
        awaitingConfirmation={false}
        providerConfigured
        vendors={[OPENROUTER]}
        model={options.model === undefined ? AUTO_ROUTER : options.model}
        onModelChange={vi.fn()}
        costTier={options.costTier}
        onCostTierChange={next => costTierChanges.push(next)}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />
    </TooltipProvider>
  );

  return { user, costTierChanges, unmount: view.unmount };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('offersCostTier', () => {
  it('is true for exactly the models the shared router map names', () => {
    for (const apiName of OPENROUTER_AUTO_ROUTERS.keys()) {
      expect(
        offersCostTier({ vendorId: 'openrouter', modelApiName: apiName, label: apiName })
      ).toBe(true);
    }
  });

  it('is false for a concrete model, whatever vendor it belongs to', () => {
    expect(offersCostTier(PLAIN_MODEL)).toBe(false);
    expect(
      offersCostTier({ vendorId: 'anthropic', modelApiName: 'claude-opus', label: 'Claude Opus' })
    ).toBe(false);
  });

  it('is false for Auto, because the model has not been chosen yet', () => {
    // The main process picks the model on this path and may not pick a router at all. A band shown
    // here would be a claim about a decision nobody has made.
    expect(offersCostTier(null)).toBe(false);
  });

  it('keys on the api name rather than on the model id or the vendor', () => {
    // `openrouter/fusion` and `openrouter/free` are deliberately absent from the shared map: neither
    // takes a routing preference, and a `startsWith('openrouter/')` test would wrongly offer them one.
    expect(
      offersCostTier({ vendorId: 'openrouter', modelApiName: 'openrouter/fusion', label: 'Fusion' })
    ).toBe(false);
    expect(
      offersCostTier({ vendorId: 'openrouter', modelApiName: 'openrouter/free', label: 'Free' })
    ).toBe(false);
  });
});

describe('the cost-tier picker in the model strip', () => {
  it('appears beside a pinned auto-router', () => {
    mount({ model: AUTO_ROUTER });
    expect(screen.queryByTestId('chat-cost-tier-trigger')).not.toBeNull();
  });

  it('is absent for a concrete model', () => {
    mount({ model: PLAIN_MODEL });
    expect(screen.queryByTestId('chat-cost-tier-trigger')).toBeNull();
  });

  it('is absent for Auto', () => {
    mount({ model: null });
    expect(screen.queryByTestId('chat-cost-tier-trigger')).toBeNull();
  });

  it('reads "Default" when no band is pinned, and the band name when one is', () => {
    const { unmount } = mount({ costTier: undefined });
    expect(screen.getByTestId('chat-cost-tier-label').textContent).toBe('Default');
    unmount();

    mount({ costTier: 'xhigh' });
    // The head of the shared label, not a second table: `OPENROUTER_COST_TIER_LABELS.xhigh` is
    // "Very high" with no em-dash tail, and `'xhigh'` is never shown to a user.
    expect(screen.getByTestId('chat-cost-tier-label').textContent).toBe('Very high');
  });

  it('offers the five bands plus an unset row, with exactly the current one checked', async () => {
    const { user } = mount({ costTier: 'high' });

    await user.click(screen.getByTestId('chat-cost-tier-trigger'));

    const rows = await screen.findAllByRole('menuitemcheckbox');
    expect(rows).toHaveLength(OPENROUTER_COST_TIERS.length + 1);
    expect(rows.filter(row => row.getAttribute('data-state') === 'checked')).toHaveLength(1);
    expect(
      rows.find(row => row.getAttribute('data-state') === 'checked')?.getAttribute('data-tier')
    ).toBe('high');
  });

  it('emits the chosen band', async () => {
    const { user, costTierChanges } = mount({ costTier: undefined });

    await user.click(screen.getByTestId('chat-cost-tier-trigger'));
    const rows = await screen.findAllByRole('menuitemcheckbox');
    const max = rows.find(row => row.getAttribute('data-tier') === 'max');
    expect(max).toBeTruthy();
    await user.click(max as HTMLElement);

    await waitFor(() => expect(costTierChanges).toEqual(['max']));
  });

  it('emits undefined for "Provider default", not the cheapest band', async () => {
    // Unset is a distinct instruction — OpenRouter then chooses the band itself. Writing `'low'`
    // here would silently pin the cheapest models forever.
    const { user, costTierChanges } = mount({ costTier: 'max' });

    await user.click(screen.getByTestId('chat-cost-tier-trigger'));
    await user.click(await screen.findByTestId('chat-cost-tier-unset'));

    await waitFor(() => expect(costTierChanges).toEqual([undefined]));
  });
});
