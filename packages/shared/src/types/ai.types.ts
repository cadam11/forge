/**
 * AI Integration Types
 * Types for AI vendor configuration, settings, and features
 */

// Cost tiers for models
export type CostTier = 'economy' | 'standard' | 'premium';

/**
 * OpenRouter's routing preference for its auto-routers (J-80).
 *
 * A band, not a ceiling: asking for `high` excludes models cheaper than the band as well as
 * dearer ones. Sending no preference at all routes roughly as if `low` had been asked for, which
 * is why "unset" is a real choice here and not a synonym for any of these five.
 *
 * The predecessor field `cost_quality_tradeoff` is deprecated; this replaces it.
 */
export type OpenRouterCostTier = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** The five bands, cheapest first — the order both settings UIs list them in. */
export const OPENROUTER_COST_TIERS: readonly OpenRouterCostTier[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/**
 * OpenRouter's auto-routers, keyed by `apiName`, mapped to the plugin id their routing-preference
 * block has to carry — `openrouter/auto` is served by the `auto-router` plugin, `openrouter/auto-beta`
 * by `auto-beta-router`.
 *
 * **This map is the rule.** The docs do not say whether a cost tier sent to a non-router model is
 * ignored or rejected, so the request builder looks the outgoing model up here and attaches nothing
 * when it misses, rather than pattern-matching the model name. Both renderers use the same map to
 * decide whether a vendor is entitled to the selector at all, so the three places agree by
 * construction. `openrouter/free` and `openrouter/fusion` are deliberately absent: neither takes a
 * cost tier.
 */
export const OPENROUTER_AUTO_ROUTERS: ReadonlyMap<string, string> = new Map([
  ['openrouter/auto', 'auto-router'],
  ['openrouter/auto-beta', 'auto-beta-router'],
]);

/**
 * AI Model definition
 */
export interface AIModel {
  id: string;
  name: string;
  apiName: string;
  /** Power rank from 1-20, higher = more capable */
  powerRank: number;
  costTier: CostTier;
  /** Whether this model supports streaming */
  supportsStreaming?: boolean;
  /** Max context window in tokens */
  maxContextTokens?: number;
  /** Max output tokens */
  maxOutputTokens?: number;
  /** Whether this is the vendor's default model */
  default?: boolean;
  /**
   * Selectable by hand, but never chosen on the user's behalf by power-rank auto-selection.
   * Set on meta/router models (OpenRouter's auto routers), whose capability and price are
   * whatever they route to — which is precisely what rank targeting exists to pin down.
   */
  excludeFromAutoSelect?: boolean;
}

/**
 * AI Vendor definition
 */
export interface AIVendor {
  id: string;
  name: string;
  /** Base URL for API calls (can be overridden in settings) */
  baseUrl?: string;
  /** Available models for this vendor */
  models: AIModel[];
  /** Whether this vendor requires an API key */
  requiresApiKey: boolean;
  /** Documentation URL */
  docsUrl?: string;
}

/**
 * AI Vendors configuration (loaded from JSON)
 */
export interface AIVendorsConfig {
  version: string;
  lastUpdated?: string;
  vendors: AIVendor[];
}

/**
 * Per-vendor settings (stored in app state)
 */
export interface AIVendorSettings {
  vendorId: string;
  enabled: boolean;
  apiKeyConfigured: boolean;
  /** Priority for auto-selection (lower = higher priority) */
  priority: number;
  /** Custom base URL override */
  customBaseUrl?: string;
  /** Preferred model ID for this vendor */
  preferredModelId?: string;
  /**
   * OpenRouter only: the cost band its auto-routers should route within. Undefined means "send no
   * routing preference", which is OpenRouter's own default and NOT the same as `'low'`.
   *
   * Per-vendor rather than per-model because it is a property of the account's routing preference,
   * and it reaches the wire only when the outgoing model is one of `OPENROUTER_AUTO_ROUTERS`.
   */
  autoRouterCostTier?: OpenRouterCostTier;
}

/**
 * AI feature settings
 */
export interface AIFeatureSettings {
  /** Enable auto tab renaming after query execution */
  autoRenameEnabled: boolean;
  /** Model ID to use for tab renaming (null = auto-select lowest power) */
  tabRenameModelId: string | null;
  /** Enable AI analysis panel in results */
  analysisEnabled: boolean;
  /** Model ID for analysis (null = auto-select) */
  analysisModelId: string | null;
  /** Enable SQL generation from natural language */
  queryAssistEnabled: boolean;
  /** Model ID for query assist (null = auto-select) */
  queryAssistModelId: string | null;
}

/**
 * Complete AI settings
 */
export interface AISettings {
  /** Master switch for all AI features */
  enabled: boolean;
  /** Per-vendor settings */
  vendorSettings: AIVendorSettings[];
  /** Feature-specific settings */
  features: AIFeatureSettings;
}

/**
 * Default AI settings
 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  vendorSettings: [],
  features: {
    autoRenameEnabled: true,
    tabRenameModelId: null,
    analysisEnabled: true,
    analysisModelId: null,
    queryAssistEnabled: true,
    queryAssistModelId: null,
  },
};

/**
 * Request for AI tab renaming
 */
export interface TabRenameRequest {
  sql: string;
  currentName?: string;
  database?: string;
}

/**
 * Response from AI tab renaming
 */
export interface TabRenameResponse {
  suggestedName: string;
  confidence: number;
}

/**
 * Request for AI analysis
 */
export interface AnalysisRequest {
  sql: string;
  resultSummary: {
    columnCount: number;
    rowCount: number;
    columns: Array<{ name: string; type: string }>;
    sampleRows?: Record<string, unknown>[];
  };
  prompt?: string;
}

/**
 * Response from AI analysis (streamed)
 */
export interface AnalysisResponse {
  content: string;
  isComplete: boolean;
}

/**
 * Request for SQL generation
 */
export interface SQLGenerationRequest {
  prompt: string;
  schema?: {
    tables: Array<{
      name: string;
      schema: string;
      columns: Array<{ name: string; type: string }>;
    }>;
  };
  database?: string;
  dialect?: 'tsql' | 'mysql' | 'postgresql';
}

/**
 * Response from SQL generation
 */
export interface SQLGenerationResponse {
  sql: string;
  explanation?: string;
}

/**
 * AI IPC channels
 */
export const AI_IPC_CHANNELS = {
  GET_VENDORS: 'ai:get-vendors',
  GET_SETTINGS: 'ai:get-settings',
  SET_SETTINGS: 'ai:set-settings',
  SET_API_KEY: 'ai:set-api-key',
  REMOVE_API_KEY: 'ai:remove-api-key',
  VALIDATE_API_KEY: 'ai:validate-api-key',
  GENERATE_TAB_NAME: 'ai:generate-tab-name',
  ANALYZE_RESULTS: 'ai:analyze-results',
  GENERATE_SQL: 'ai:generate-sql',
  CANCEL_REQUEST: 'ai:cancel-request',
} as const;
