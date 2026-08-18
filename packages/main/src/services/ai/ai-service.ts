/**
 * AI Service - Orchestrates AI provider interactions
 */

import type {
  AISettings,
  AIVendor,
  AIModel,
  TabRenameRequest,
  TabRenameResponse,
  AnalysisRequest,
  AnalysisResponse,
  SQLGenerationRequest,
  SQLGenerationResponse,
} from '@joinery/shared';
import { DEFAULT_AI_SETTINGS, AI_VENDORS_CONFIG } from '@joinery/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { CredentialStore } from '../keychain/credential-store';
import { AppStateStore } from '../config/app-state';
import { OPENROUTER_BASE_URL, OPENROUTER_HEADERS } from './llm-providers';

const log = createLogger('AI');

// Provider interfaces
interface AIProvider {
  vendorId: string;
  validateApiKey(apiKey: string): Promise<boolean>;
  generateCompletion(
    prompt: string,
    model: AIModel,
    apiKey: string,
    options?: CompletionOptions
  ): Promise<string>;
}

interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

// Response types for API calls
interface AnthropicResponse {
  content?: Array<{ text?: string }>;
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface GoogleResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class AIService extends BaseSingleton {
  private vendors: AIVendor[] = [];
  private settings: AISettings = { ...DEFAULT_AI_SETTINGS };
  private providers: Map<string, AIProvider> = new Map();
  private activeRequests: Map<string, AbortController> = new Map();

  constructor() {
    super();
    this.loadVendors();
    this.loadSettings();
    this.initializeProviders();
  }

  private loadVendors(): void {
    this.vendors = AI_VENDORS_CONFIG.vendors;
  }

  private loadSettings(): void {
    const appState = AppStateStore.getInstance();
    const state = appState.getState();
    if (state.aiSettings) {
      this.settings = { ...DEFAULT_AI_SETTINGS, ...state.aiSettings };
    }
  }

  private initializeProviders(): void {
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('google', new GoogleProvider());
    for (const config of OPENAI_COMPATIBLE_VENDORS) {
      this.providers.set(config.vendorId, new OpenAICompatibleProvider(config));
    }
  }

  // Public API

  getVendors(): AIVendor[] {
    return this.vendors;
  }

  getSettings(): AISettings {
    return this.settings;
  }

  async setSettings(settings: Partial<AISettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    const appState = AppStateStore.getInstance();
    appState.setState({ aiSettings: this.settings });
  }

  async setApiKey(vendorId: string, apiKey: string): Promise<void> {
    const credential = CredentialStore.getInstance();
    await credential.set(`ai-${vendorId}`, apiKey);

    const vendorSettings = this.settings.vendorSettings.find(v => v.vendorId === vendorId);
    if (vendorSettings) {
      vendorSettings.apiKeyConfigured = true;
    } else {
      this.settings.vendorSettings.push({
        vendorId,
        enabled: true,
        apiKeyConfigured: true,
        priority: this.settings.vendorSettings.length,
      });
    }
    await this.setSettings({ vendorSettings: this.settings.vendorSettings });
  }

  async removeApiKey(vendorId: string): Promise<void> {
    const credential = CredentialStore.getInstance();
    await credential.delete(`ai-${vendorId}`);

    const vendorSettings = this.settings.vendorSettings.find(v => v.vendorId === vendorId);
    if (vendorSettings) {
      vendorSettings.apiKeyConfigured = false;
    }
    await this.setSettings({ vendorSettings: this.settings.vendorSettings });
  }

  async validateApiKey(vendorId: string, apiKey: string): Promise<boolean> {
    const provider = this.providers.get(vendorId);
    if (!provider) return false;
    return provider.validateApiKey(apiKey);
  }

  async generateTabName(request: TabRenameRequest): Promise<TabRenameResponse> {
    if (!this.settings.enabled || !this.settings.features.autoRenameEnabled) {
      return { suggestedName: 'Query', confidence: 0 };
    }

    const { model, provider, apiKey } = await this.selectModelForFeature('tabRename');
    if (!model || !provider || !apiKey) {
      return { suggestedName: 'Query', confidence: 0 };
    }

    const prompt = this.buildTabRenamePrompt(request);

    try {
      const response = await provider.generateCompletion(prompt, model, apiKey, {
        maxTokens: 50,
        temperature: 0.3,
        systemPrompt:
          'You are a SQL query naming assistant. Generate short, descriptive PascalCase names (max 25 chars) for SQL queries. Only output the name, nothing else.',
      });

      const suggestedName = this.cleanTabName(response);
      return {
        suggestedName,
        confidence: suggestedName.length > 0 ? 0.8 : 0,
      };
    } catch (error) {
      log.error('Failed to generate tab name:', error);
      return { suggestedName: 'Query', confidence: 0 };
    }
  }

  async analyzeResults(
    request: AnalysisRequest,
    _onChunk?: (response: AnalysisResponse) => void
  ): Promise<AnalysisResponse> {
    if (!this.settings.enabled || !this.settings.features.analysisEnabled) {
      return { content: 'AI analysis is disabled', isComplete: true };
    }

    const { model, provider, apiKey } = await this.selectModelForFeature('analysis');
    if (!model || !provider || !apiKey) {
      return { content: 'No AI provider configured', isComplete: true };
    }

    const prompt = this.buildAnalysisPrompt(request);
    const requestId = `analysis-${Date.now()}`;
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      const content = await provider.generateCompletion(prompt, model, apiKey, {
        maxTokens: 2000,
        temperature: 0.7,
        systemPrompt:
          'You are a SQL data analyst. Analyze query results and provide insights. Be concise and helpful.',
      });
      return { content, isComplete: true };
    } catch (error) {
      log.error('Failed to analyze results:', error);
      return { content: `Analysis failed: ${error}`, isComplete: true };
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse> {
    if (!this.settings.enabled || !this.settings.features.queryAssistEnabled) {
      return { sql: '', explanation: 'AI query assist is disabled' };
    }

    const { model, provider, apiKey } = await this.selectModelForFeature('queryAssist');
    if (!model || !provider || !apiKey) {
      return { sql: '', explanation: 'No AI provider configured' };
    }

    const prompt = this.buildSQLGenerationPrompt(request);

    try {
      const response = await provider.generateCompletion(prompt, model, apiKey, {
        maxTokens: 1000,
        temperature: 0.3,
        systemPrompt: `You are a ${request.dialect === 'postgresql' ? 'PostgreSQL' : request.dialect === 'mysql' ? 'MySQL' : 'T-SQL'} expert. Generate valid ${request.dialect === 'postgresql' ? 'PostgreSQL' : request.dialect === 'mysql' ? 'MySQL' : 'SQL Server'} queries based on user requests.
Output format:
SQL:
<your sql here>

EXPLANATION:
<brief explanation>`,
      });

      return this.parseSQLResponse(response);
    } catch (error) {
      log.error('Failed to generate SQL:', error);
      return { sql: '', explanation: `Generation failed: ${error}` };
    }
  }

  cancelRequest(requestId: string): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Abort all active AI requests (used during app shutdown)
   */
  abortAll(): void {
    for (const [id, controller] of this.activeRequests) {
      controller.abort();
      log.info(`Shutdown: aborted AI request ${id}`);
    }
    this.activeRequests.clear();
  }

  // Private helpers

  private async selectModelForFeature(
    feature: 'tabRename' | 'analysis' | 'queryAssist'
  ): Promise<{ model: AIModel | null; provider: AIProvider | null; apiKey: string | null }> {
    const modelId =
      feature === 'tabRename'
        ? this.settings.features.tabRenameModelId
        : feature === 'analysis'
          ? this.settings.features.analysisModelId
          : this.settings.features.queryAssistModelId;

    if (modelId) {
      return this.getModelAndProvider(modelId);
    }

    const targetPowerRank = feature === 'tabRename' ? 6 : 10;
    return this.selectBestAvailableModel(targetPowerRank);
  }

  private async getModelAndProvider(
    modelId: string
  ): Promise<{ model: AIModel | null; provider: AIProvider | null; apiKey: string | null }> {
    for (const vendor of this.vendors) {
      const model = vendor.models.find(m => m.id === modelId);
      if (model) {
        const vendorSettings = this.settings.vendorSettings.find(
          v => v.vendorId === vendor.id && v.enabled && v.apiKeyConfigured
        );
        if (vendorSettings) {
          const provider = this.providers.get(vendor.id) || null;
          const apiKey = await this.getApiKey(vendor.id);
          return { model, provider, apiKey };
        }
      }
    }
    return { model: null, provider: null, apiKey: null };
  }

  private async selectBestAvailableModel(
    targetPowerRank: number
  ): Promise<{ model: AIModel | null; provider: AIProvider | null; apiKey: string | null }> {
    const enabledVendors = this.settings.vendorSettings
      .filter(v => v.enabled && v.apiKeyConfigured)
      .sort((a, b) => a.priority - b.priority);

    for (const vendorSettings of enabledVendors) {
      const vendor = this.vendors.find(v => v.id === vendorSettings.vendorId);
      if (!vendor) continue;

      const models = [...vendor.models].sort(
        (a, b) => Math.abs(a.powerRank - targetPowerRank) - Math.abs(b.powerRank - targetPowerRank)
      );

      if (models.length > 0) {
        const provider = this.providers.get(vendor.id) || null;
        const apiKey = await this.getApiKey(vendor.id);
        if (provider && apiKey) {
          return { model: models[0], provider, apiKey };
        }
      }
    }

    return { model: null, provider: null, apiKey: null };
  }

  async getApiKeyForVendor(vendorId: string): Promise<string | null> {
    const credential = CredentialStore.getInstance();
    return credential.get(`ai-${vendorId}`);
  }

  private async getApiKey(vendorId: string): Promise<string | null> {
    return this.getApiKeyForVendor(vendorId);
  }

  private buildTabRenamePrompt(request: TabRenameRequest): string {
    return `Generate a short PascalCase name (max 25 characters) for this SQL query:

${request.sql}

${request.database ? `Database: ${request.database}` : ''}

Name:`;
  }

  private cleanTabName(name: string): string {
    let cleaned = name.trim().replace(/['"]/g, '').replace(/\n/g, '');
    cleaned = cleaned.replace(/[^a-zA-Z0-9_]/g, '');
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return cleaned.substring(0, 25) || 'Query';
  }

  private buildAnalysisPrompt(request: AnalysisRequest): string {
    const sampleData = request.resultSummary.sampleRows
      ? `\nSample data:\n${JSON.stringify(request.resultSummary.sampleRows.slice(0, 5), null, 2)}`
      : '';

    return `Analyze these SQL query results:

Query: ${request.sql}

Result summary:
- Columns: ${request.resultSummary.columns.map(c => `${c.name} (${c.type})`).join(', ')}
- Row count: ${request.resultSummary.rowCount}
${sampleData}

${request.prompt || 'Provide a brief analysis of these results, noting any patterns or insights.'}`;
  }

  private buildSQLGenerationPrompt(request: SQLGenerationRequest): string {
    let schemaContext = '';
    if (request.schema) {
      schemaContext =
        '\n\nAvailable tables:\n' +
        request.schema.tables
          .map(
            t =>
              `- ${t.schema}.${t.name}: ${t.columns.map(c => `${c.name} (${c.type})`).join(', ')}`
          )
          .join('\n');
    }

    const dialectName =
      request.dialect === 'postgresql'
        ? 'PostgreSQL'
        : request.dialect === 'mysql'
          ? 'MySQL'
          : 'T-SQL';
    return `Generate a ${dialectName} query for the following request:

${request.prompt}
${schemaContext}
${request.database ? `\nDatabase: ${request.database}` : ''}`;
  }

  private parseSQLResponse(response: string): SQLGenerationResponse {
    const sqlMatch = response.match(/SQL:\s*([\s\S]*?)(?:EXPLANATION:|$)/i);
    const explanationMatch = response.match(/EXPLANATION:\s*([\s\S]*?)$/i);

    return {
      sql: sqlMatch ? sqlMatch[1].trim() : response.trim(),
      explanation: explanationMatch ? explanationMatch[1].trim() : undefined,
    };
  }
}

// Provider implementations

class AnthropicProvider implements AIProvider {
  vendorId = 'anthropic';

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-3-5-haiku-20241022',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateCompletion(
    prompt: string,
    model: AIModel,
    apiKey: string,
    options?: CompletionOptions
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: model.apiName,
        max_tokens: options?.maxTokens || 1000,
        system: options?.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as AnthropicResponse;
    return data.content?.[0]?.text || '';
  }
}

/** What one OpenAI-compatible vendor needs beyond the shared request shape. */
export interface OpenAICompatibleConfig {
  vendorId: string;
  /** Root that `/v1/...` paths hang off, e.g. `https://api.groq.com/openai`. */
  baseUrl: string;
  /** Human-readable vendor name used in thrown error messages. */
  label: string;
  /** Vendor-specific headers merged into every request. */
  extraHeaders?: Record<string, string>;
  /**
   * Path (relative to `baseUrl`) hit to check a key. Defaults to the model catalogue, which
   * every OpenAI-compatible vendor here gates behind auth — except OpenRouter, whose catalogue
   * is public and would therefore accept any string as a valid key. See the table below.
   */
  validatePath?: string;
}

/**
 * OpenAI, Groq, Cerebras and OpenRouter all speak the same chat-completions dialect, so they
 * differ only in the root URL, the label in error messages, the key-check path, and (OpenRouter)
 * a pair of attribution headers. One parameterised class instead of four near-identical ones.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly vendorId: string;
  private readonly baseUrl: string;
  private readonly label: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly validatePath: string;

  constructor(config: OpenAICompatibleConfig) {
    this.vendorId = config.vendorId;
    this.baseUrl = config.baseUrl;
    this.label = config.label;
    this.extraHeaders = { ...config.extraHeaders };
    this.validatePath = config.validatePath ?? '/v1/models';
  }

  /**
   * Headers for the bodyless GET that checks a key. Deliberately carries no `Content-Type`:
   * that keeps the request byte-identical to the per-vendor implementations this class replaced.
   * The key is sent, never logged.
   */
  private validateHeaders(apiKey: string): Record<string, string> {
    return { ...this.extraHeaders, Authorization: `Bearer ${apiKey}` };
  }

  /** Headers for the JSON POST. The key is sent, never logged. */
  private completionHeaders(apiKey: string): Record<string, string> {
    return { ...this.validateHeaders(apiKey), 'Content-Type': 'application/json' };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}${this.validatePath}`, {
        headers: this.validateHeaders(apiKey),
      });
      return response.ok;
    } catch (error) {
      log.warn(`${this.label} API key validation request failed:`, error);
      return false;
    }
  }

  async generateCompletion(
    prompt: string,
    model: AIModel,
    apiKey: string,
    options?: CompletionOptions
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.completionHeaders(apiKey),
      body: JSON.stringify({
        model: model.apiName,
        messages,
        max_tokens: options?.maxTokens || 1000,
        temperature: options?.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`${this.label} API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    return data.choices?.[0]?.message?.content || '';
  }
}

class GoogleProvider implements AIProvider {
  vendorId = 'google';

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateCompletion(
    prompt: string,
    model: AIModel,
    apiKey: string,
    options?: CompletionOptions
  ): Promise<string> {
    const contents = [];
    if (options?.systemPrompt) {
      contents.push({ role: 'user', parts: [{ text: options.systemPrompt }] });
      contents.push({ role: 'model', parts: [{ text: 'Understood.' }] });
    }
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.apiName}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: options?.maxTokens || 1000,
            temperature: options?.temperature || 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google AI API error: ${response.status}`);
    }

    const data = (await response.json()) as GoogleResponse;
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
}

/**
 * The OpenAI-compatible vendors, keyed by the vendor id used in `ai-vendors.json`.
 *
 * OpenRouter's `/v1/models` catalogue is public, so its key check goes to `/v1/key` instead —
 * the documented "get current API key" endpoint, which 401s on a bad key. (`/v1/auth/key` is an
 * undocumented legacy alias for the same thing; the documented path is the one to depend on.)
 *
 * Exported for `ai-service.spec.ts`: these four rows are the whole behavioural difference
 * between the vendors, so pinning them is what stops a URL or label regressing silently.
 */
export const OPENAI_COMPATIBLE_VENDORS: readonly OpenAICompatibleConfig[] = [
  { vendorId: 'openai', baseUrl: 'https://api.openai.com', label: 'OpenAI' },
  { vendorId: 'groq', baseUrl: 'https://api.groq.com/openai', label: 'Groq' },
  { vendorId: 'cerebras', baseUrl: 'https://api.cerebras.ai', label: 'Cerebras' },
  {
    vendorId: 'openrouter',
    baseUrl: OPENROUTER_BASE_URL,
    label: 'OpenRouter',
    extraHeaders: { ...OPENROUTER_HEADERS },
    validatePath: '/v1/key',
  },
];
