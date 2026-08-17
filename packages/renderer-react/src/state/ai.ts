/**
 * AI vendors, keys, feature flags, and the three one-shot AI features (tab rename, result
 * analysis, SQL generation). Settings live in the main process — every write round-trips through
 * `ai.setSettings` and this store holds whatever came back, so the renderer never has a second
 * opinion about what is configured.
 *
 * Ported from `packages/renderer/src/app/core/state/ai.state.ts`. Conventions: `capabilities.ts`.
 * Consumers: Task 15 (settings panel), Task 17 (chat model picker), the AI-setup dialog.
 *
 * API keys pass through `setApiKey` / `validateApiKey` as arguments and are never stored here —
 * only the `apiKeyConfigured` boolean the main process reports.
 */

import { create } from 'zustand';
import { DEFAULT_AI_SETTINGS } from '@joinery/shared';
import type {
  AIVendor,
  AISettings,
  AIVendorSettings,
  AnalysisRequest,
  AnalysisResponse,
  SQLGenerationRequest,
  SQLGenerationResponse,
  TabRenameRequest,
  TabRenameResponse,
} from '@joinery/shared';
import { ipc, isIpcAvailable } from '../ipc';
import { diagnostics, notify } from './diagnostics';

export interface AIStoreState {
  readonly vendors: readonly AIVendor[];
  readonly settings: AISettings;
  readonly loading: boolean;
  readonly validatingKey: boolean;
  readonly generatingTabName: boolean;
  readonly analyzingResults: boolean;
  readonly generatingSQL: boolean;

  readonly initialize: () => Promise<void>;
  readonly setEnabled: (enabled: boolean) => Promise<void>;
  readonly updateSettings: (partial: Partial<AISettings>) => Promise<void>;
  readonly updateFeatureSettings: (features: Partial<AISettings['features']>) => Promise<void>;
  readonly setVendorEnabled: (vendorId: string, enabled: boolean) => Promise<void>;
  readonly setApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
  readonly removeApiKey: (vendorId: string) => Promise<boolean>;
  readonly validateApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
  readonly setPreferredModel: (vendorId: string, modelId: string) => Promise<void>;
  readonly setVendorPriority: (vendorId: string, priority: number) => Promise<void>;

  readonly generateTabName: (request: TabRenameRequest) => Promise<TabRenameResponse | null>;
  readonly analyzeResults: (request: AnalysisRequest) => Promise<AnalysisResponse | null>;
  readonly generateSQL: (request: SQLGenerationRequest) => Promise<SQLGenerationResponse | null>;
  readonly cancelCurrentRequest: () => Promise<void>;
}

export type AIStore = ReturnType<typeof createAIStore>;

export function createAIStore() {
  // The id of the in-flight one-shot request. Not state: nothing renders it, and the three
  // `generating*` booleans are what the UI actually watches.
  let currentRequestId: string | null = null;

  return create<AIStoreState>()((set, get) => {
    /**
     * Upsert one vendor's settings entry and push the result to the main process. Every vendor
     * mutator below is this shape; the insert branch matters because a vendor the user has never
     * touched has no entry yet.
     */
    const upsertVendorSettings = async (
      vendorId: string,
      updates: Partial<AIVendorSettings>,
      insert: (priority: number) => AIVendorSettings
    ): Promise<void> => {
      const vendorSettings = [...get().settings.vendorSettings];
      const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);
      const existing = vendorSettings[index];
      if (existing) {
        vendorSettings[index] = { ...existing, ...updates };
      } else {
        vendorSettings.push(insert(vendorSettings.length + 1));
      }
      await get().updateSettings({ vendorSettings });
    };

    return {
      vendors: [],
      settings: { ...DEFAULT_AI_SETTINGS },
      loading: false,
      validatingKey: false,
      generatingTabName: false,
      analyzingResults: false,
      generatingSQL: false,

      initialize: async () => {
        if (!isIpcAvailable()) return;
        try {
          set({ loading: true });
          const [vendors, settings] = await Promise.all([
            ipc().ai.getVendors(),
            ipc().ai.getSettings(),
          ]);
          set({ vendors, settings });
        } catch (error) {
          diagnostics.error('failed to initialize AI state', error);
        } finally {
          set({ loading: false });
        }
      },

      setEnabled: enabled => get().updateSettings({ enabled }),

      updateSettings: async partial => {
        if (!isIpcAvailable()) return;
        try {
          set({ settings: await ipc().ai.setSettings(partial) });
        } catch (error) {
          notify.error('Failed to update AI settings');
          diagnostics.error('failed to update AI settings', error);
        }
      },

      updateFeatureSettings: features =>
        get().updateSettings({ features: { ...get().settings.features, ...features } }),

      setVendorEnabled: (vendorId, enabled) =>
        upsertVendorSettings(vendorId, { enabled }, priority => ({
          vendorId,
          enabled,
          apiKeyConfigured: false,
          priority,
        })),

      setApiKey: async (vendorId, apiKey) => {
        if (!isIpcAvailable()) return false;
        try {
          set({ validatingKey: true });

          // Validate before saving, so a typo never lands in the keychain.
          if (!(await ipc().ai.validateApiKey(vendorId, apiKey))) {
            notify.error('Invalid API key');
            return false;
          }
          await ipc().ai.setApiKey(vendorId, apiKey);

          await upsertVendorSettings(vendorId, { apiKeyConfigured: true }, priority => ({
            vendorId,
            enabled: true,
            apiKeyConfigured: true,
            priority,
          }));
          notify.success('API key saved');
          return true;
        } catch (error) {
          notify.error('Failed to save API key');
          diagnostics.error('failed to set API key', error);
          return false;
        } finally {
          set({ validatingKey: false });
        }
      },

      removeApiKey: async vendorId => {
        if (!isIpcAvailable()) return false;
        try {
          await ipc().ai.removeApiKey(vendorId);
          // No insert branch: a vendor with no settings entry has no key to forget.
          const vendorSettings = [...get().settings.vendorSettings];
          const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);
          const existing = vendorSettings[index];
          if (existing) {
            vendorSettings[index] = { ...existing, apiKeyConfigured: false };
            await get().updateSettings({ vendorSettings });
          }
          notify.success('API key removed');
          return true;
        } catch (error) {
          notify.error('Failed to remove API key');
          diagnostics.error('failed to remove API key', error);
          return false;
        }
      },

      validateApiKey: async (vendorId, apiKey) => {
        if (!isIpcAvailable()) return false;
        try {
          set({ validatingKey: true });
          return await ipc().ai.validateApiKey(vendorId, apiKey);
        } catch (error) {
          diagnostics.error('failed to validate API key', error);
          return false;
        } finally {
          set({ validatingKey: false });
        }
      },

      setPreferredModel: (vendorId, modelId) =>
        upsertVendorSettings(vendorId, { preferredModelId: modelId }, priority => ({
          vendorId,
          enabled: false,
          apiKeyConfigured: false,
          priority,
          preferredModelId: modelId,
        })),

      setVendorPriority: async (vendorId, priority) => {
        // No insert branch: reordering a vendor that has no entry is meaningless.
        const vendorSettings = [...get().settings.vendorSettings];
        const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);
        const existing = vendorSettings[index];
        if (!existing) return;
        vendorSettings[index] = { ...existing, priority };
        await get().updateSettings({ vendorSettings });
      },

      generateTabName: async request => {
        if (!isIpcAvailable() || !selectHasConfiguredVendors(get())) return null;
        try {
          set({ generatingTabName: true });
          currentRequestId = `tab-rename-${Date.now()}`;
          return await ipc().ai.generateTabName(request);
        } catch (error) {
          diagnostics.error('failed to generate tab name', error);
          return null;
        } finally {
          set({ generatingTabName: false });
          currentRequestId = null;
        }
      },

      analyzeResults: async request => {
        if (!isIpcAvailable() || !selectHasConfiguredVendors(get())) return null;
        try {
          set({ analyzingResults: true });
          currentRequestId = `analysis-${Date.now()}`;
          return await ipc().ai.analyzeResults(request);
        } catch (error) {
          diagnostics.error('failed to analyze results', error);
          return null;
        } finally {
          set({ analyzingResults: false });
          currentRequestId = null;
        }
      },

      generateSQL: async request => {
        if (!isIpcAvailable() || !selectHasConfiguredVendors(get())) return null;
        try {
          set({ generatingSQL: true });
          currentRequestId = `sql-gen-${Date.now()}`;
          return await ipc().ai.generateSQL(request);
        } catch (error) {
          diagnostics.error('failed to generate SQL', error);
          return null;
        } finally {
          set({ generatingSQL: false });
          currentRequestId = null;
        }
      },

      cancelCurrentRequest: async () => {
        const requestId = currentRequestId;
        if (!requestId || !isIpcAvailable()) return;
        try {
          await ipc().ai.cancelRequest(requestId);
        } catch (error) {
          diagnostics.error('failed to cancel AI request', error);
        } finally {
          currentRequestId = null;
          set({ generatingTabName: false, analyzingResults: false, generatingSQL: false });
        }
      },
    };
  });
}

export const aiStore = createAIStore();
export const useAIStore = aiStore;

type SettingsSlice = Pick<AIStoreState, 'settings'>;

export function selectAIEnabled(state: SettingsSlice): boolean {
  return state.settings.enabled;
}

export function selectHasConfiguredVendors(state: SettingsSlice): boolean {
  return state.settings.vendorSettings.some(v => v.enabled && v.apiKeyConfigured);
}

/** Fresh array — subscribe with `useShallow`. */
export function selectEnabledVendors(
  state: Pick<AIStoreState, 'settings' | 'vendors'>
): readonly AIVendor[] {
  const byId = new Map(state.vendors.map(v => [v.id, v]));
  return state.settings.vendorSettings
    .filter(vs => vs.enabled && vs.apiKeyConfigured)
    .map(vs => byId.get(vs.vendorId))
    .filter((v): v is AIVendor => v !== undefined);
}

export function selectAutoRenameEnabled(state: SettingsSlice): boolean {
  return state.settings.enabled && state.settings.features.autoRenameEnabled;
}

export function selectAnalysisEnabled(state: SettingsSlice): boolean {
  return state.settings.enabled && state.settings.features.analysisEnabled;
}

/**
 * The vendor an analysis request will actually reach, so a surface can NAME it before sending anything.
 *
 * Mirrors `ai-service.ts`'s `selectModelForFeature('analysis')`: an explicitly chosen `analysisModelId`
 * decides it when that model's vendor is enabled and keyed, and otherwise it is the highest-priority
 * (lowest `priority`) enabled, keyed vendor. `null` when the vendor list has not loaded or nothing is
 * usable — a caller must then say "your configured provider" rather than invent a name.
 *
 * Duplicating main's rule is the cost of telling the user where their rows are going without a round trip
 * to ask. It is one selector, it is tested against the same cases, and the alternative is a disclosure
 * that names a provider main would not have used.
 */
export function selectAnalysisVendor(
  state: Pick<AIStoreState, 'settings' | 'vendors'>
): AIVendor | null {
  const usable = (vendorId: string): boolean =>
    state.settings.vendorSettings.some(
      vs => vs.vendorId === vendorId && vs.enabled && vs.apiKeyConfigured
    );

  const modelId = state.settings.features.analysisModelId;
  if (modelId !== null && modelId !== '') {
    const owner = state.vendors.find(
      vendor => vendor.models.some(model => model.id === modelId) && usable(vendor.id)
    );
    if (owner !== undefined) return owner;
  }

  // A copy before the sort: `vendorSettings` is store state, and `sort` mutates in place.
  const byPriority = [...state.settings.vendorSettings]
    .filter(vs => vs.enabled && vs.apiKeyConfigured)
    .sort((a, b) => a.priority - b.priority);
  for (const vendorSettings of byPriority) {
    const vendor = state.vendors.find(candidate => candidate.id === vendorSettings.vendorId);
    if (vendor !== undefined) return vendor;
  }
  return null;
}

export function selectQueryAssistEnabled(state: SettingsSlice): boolean {
  return state.settings.enabled && state.settings.features.queryAssistEnabled;
}

export function selectVendor(vendorId: string) {
  return (state: Pick<AIStoreState, 'vendors'>): AIVendor | undefined =>
    state.vendors.find(v => v.id === vendorId);
}

export function selectVendorSettings(vendorId: string) {
  return (state: SettingsSlice): AIVendorSettings | undefined =>
    state.settings.vendorSettings.find(vs => vs.vendorId === vendorId);
}
