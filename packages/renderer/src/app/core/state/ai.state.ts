/**
 * AI State Service
 * Manages AI settings, vendors, and feature state
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AIVendor,
  AISettings,
  AIVendorSettings,
  TabRenameRequest,
  TabRenameResponse,
  AnalysisRequest,
  AnalysisResponse,
  SQLGenerationRequest,
  SQLGenerationResponse,
} from '@forgedb/shared';
import { DEFAULT_AI_SETTINGS } from '@forgedb/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { firstValueFrom } from 'rxjs';

export interface AIState {
  vendors: AIVendor[];
  settings: AISettings;
  loading: boolean;
  validatingKey: boolean;
  generatingTabName: boolean;
  analyzingResults: boolean;
  generatingSQL: boolean;
}

@Injectable({ providedIn: 'root' })
export class AIStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  // State signals
  private readonly _vendors = signal<AIVendor[]>([]);
  private readonly _settings = signal<AISettings>({ ...DEFAULT_AI_SETTINGS });
  private readonly _loading = signal(false);
  private readonly _validatingKey = signal(false);
  private readonly _generatingTabName = signal(false);
  private readonly _analyzingResults = signal(false);
  private readonly _generatingSQL = signal(false);
  private readonly _currentRequestId = signal<string | null>(null);

  // Public readonly signals
  readonly vendors = this._vendors.asReadonly();
  readonly settings = this._settings.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly validatingKey = this._validatingKey.asReadonly();
  readonly generatingTabName = this._generatingTabName.asReadonly();
  readonly analyzingResults = this._analyzingResults.asReadonly();
  readonly generatingSQL = this._generatingSQL.asReadonly();

  // Computed signals
  readonly isEnabled = computed(() => this._settings().enabled);
  readonly hasConfiguredVendors = computed(() => {
    const settings = this._settings();
    return settings.vendorSettings.some(v => v.enabled && v.apiKeyConfigured);
  });
  readonly enabledVendors = computed(() => {
    const settings = this._settings();
    const vendorMap = new Map(this._vendors().map(v => [v.id, v]));
    return settings.vendorSettings
      .filter(vs => vs.enabled && vs.apiKeyConfigured)
      .map(vs => vendorMap.get(vs.vendorId))
      .filter((v): v is AIVendor => v !== undefined);
  });
  readonly autoRenameEnabled = computed(
    () => this._settings().enabled && this._settings().features.autoRenameEnabled
  );
  readonly analysisEnabled = computed(
    () => this._settings().enabled && this._settings().features.analysisEnabled
  );
  readonly queryAssistEnabled = computed(
    () => this._settings().enabled && this._settings().features.queryAssistEnabled
  );

  /**
   * Initialize - load vendors and settings
   */
  async initialize(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      this._loading.set(true);
      const [vendors, settings] = await Promise.all([
        firstValueFrom(this.ipc.getAIVendors()),
        firstValueFrom(this.ipc.getAISettings()),
      ]);
      this._vendors.set(vendors);
      this._settings.set(settings);
    } catch (error) {
      console.error('Failed to initialize AI state:', error);
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Get a vendor by ID
   */
  getVendor(vendorId: string): AIVendor | undefined {
    return this._vendors().find(v => v.id === vendorId);
  }

  /**
   * Get vendor settings by vendor ID
   */
  getVendorSettings(vendorId: string): AIVendorSettings | undefined {
    return this._settings().vendorSettings.find(vs => vs.vendorId === vendorId);
  }

  /**
   * Enable/disable AI globally
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.updateSettings({ enabled });
  }

  /**
   * Update AI settings
   */
  async updateSettings(partial: Partial<AISettings>): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const updated = await firstValueFrom(this.ipc.setAISettings(partial));
      this._settings.set(updated);
    } catch (error) {
      this.notification.error('Failed to update AI settings');
      console.error('Failed to update AI settings:', error);
    }
  }

  /**
   * Enable/disable a vendor
   */
  async setVendorEnabled(vendorId: string, enabled: boolean): Promise<void> {
    const settings = this._settings();
    const vendorSettings = [...settings.vendorSettings];
    const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);

    if (index >= 0) {
      vendorSettings[index] = { ...vendorSettings[index], enabled };
    } else {
      vendorSettings.push({
        vendorId,
        enabled,
        apiKeyConfigured: false,
        priority: vendorSettings.length + 1,
      });
    }

    await this.updateSettings({ vendorSettings });
  }

  /**
   * Set API key for a vendor
   */
  async setApiKey(vendorId: string, apiKey: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      this._validatingKey.set(true);

      // Validate the key first
      const isValid = await firstValueFrom(this.ipc.validateAIApiKey(vendorId, apiKey));
      if (!isValid) {
        this.notification.error('Invalid API key');
        return false;
      }

      // Save the key
      await firstValueFrom(this.ipc.setAIApiKey(vendorId, apiKey));

      // Update vendor settings
      const settings = this._settings();
      const vendorSettings = [...settings.vendorSettings];
      const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);

      if (index >= 0) {
        vendorSettings[index] = { ...vendorSettings[index], apiKeyConfigured: true };
      } else {
        vendorSettings.push({
          vendorId,
          enabled: true,
          apiKeyConfigured: true,
          priority: vendorSettings.length + 1,
        });
      }

      await this.updateSettings({ vendorSettings });
      this.notification.success('API key saved');
      return true;
    } catch (error) {
      this.notification.error('Failed to save API key');
      console.error('Failed to set API key:', error);
      return false;
    } finally {
      this._validatingKey.set(false);
    }
  }

  /**
   * Remove API key for a vendor
   */
  async removeApiKey(vendorId: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      await firstValueFrom(this.ipc.removeAIApiKey(vendorId));

      // Update vendor settings
      const settings = this._settings();
      const vendorSettings = [...settings.vendorSettings];
      const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);

      if (index >= 0) {
        vendorSettings[index] = { ...vendorSettings[index], apiKeyConfigured: false };
        await this.updateSettings({ vendorSettings });
      }

      this.notification.success('API key removed');
      return true;
    } catch (error) {
      this.notification.error('Failed to remove API key');
      console.error('Failed to remove API key:', error);
      return false;
    }
  }

  /**
   * Validate an API key without saving
   */
  async validateApiKey(vendorId: string, apiKey: string): Promise<boolean> {
    if (!this.ipc.isAvailable) return false;

    try {
      this._validatingKey.set(true);
      return await firstValueFrom(this.ipc.validateAIApiKey(vendorId, apiKey));
    } catch (error) {
      console.error('Failed to validate API key:', error);
      return false;
    } finally {
      this._validatingKey.set(false);
    }
  }

  /**
   * Set preferred model for a vendor
   */
  async setPreferredModel(vendorId: string, modelId: string): Promise<void> {
    const settings = this._settings();
    const vendorSettings = [...settings.vendorSettings];
    const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);

    if (index >= 0) {
      vendorSettings[index] = { ...vendorSettings[index], preferredModelId: modelId };
    } else {
      vendorSettings.push({
        vendorId,
        enabled: false,
        apiKeyConfigured: false,
        priority: vendorSettings.length + 1,
        preferredModelId: modelId,
      });
    }

    await this.updateSettings({ vendorSettings });
  }

  /**
   * Update vendor priority
   */
  async setVendorPriority(vendorId: string, priority: number): Promise<void> {
    const settings = this._settings();
    const vendorSettings = [...settings.vendorSettings];
    const index = vendorSettings.findIndex(vs => vs.vendorId === vendorId);

    if (index >= 0) {
      vendorSettings[index] = { ...vendorSettings[index], priority };
      await this.updateSettings({ vendorSettings });
    }
  }

  /**
   * Update feature settings
   */
  async updateFeatureSettings(features: Partial<AISettings['features']>): Promise<void> {
    const current = this._settings();
    await this.updateSettings({
      features: { ...current.features, ...features },
    });
  }

  /**
   * Generate a tab name from SQL
   */
  async generateTabName(request: TabRenameRequest): Promise<TabRenameResponse | null> {
    if (!this.ipc.isAvailable || !this.hasConfiguredVendors()) return null;

    try {
      this._generatingTabName.set(true);
      this._currentRequestId.set(`tab-rename-${Date.now()}`);
      return await firstValueFrom(this.ipc.generateTabName(request));
    } catch (error) {
      console.error('Failed to generate tab name:', error);
      return null;
    } finally {
      this._generatingTabName.set(false);
      this._currentRequestId.set(null);
    }
  }

  /**
   * Analyze query results
   */
  async analyzeResults(request: AnalysisRequest): Promise<AnalysisResponse | null> {
    if (!this.ipc.isAvailable || !this.hasConfiguredVendors()) return null;

    try {
      this._analyzingResults.set(true);
      this._currentRequestId.set(`analysis-${Date.now()}`);
      return await firstValueFrom(this.ipc.analyzeResults(request));
    } catch (error) {
      console.error('Failed to analyze results:', error);
      return null;
    } finally {
      this._analyzingResults.set(false);
      this._currentRequestId.set(null);
    }
  }

  /**
   * Generate SQL from natural language
   */
  async generateSQL(request: SQLGenerationRequest): Promise<SQLGenerationResponse | null> {
    if (!this.ipc.isAvailable || !this.hasConfiguredVendors()) return null;

    try {
      this._generatingSQL.set(true);
      this._currentRequestId.set(`sql-gen-${Date.now()}`);
      return await firstValueFrom(this.ipc.generateSQL(request));
    } catch (error) {
      console.error('Failed to generate SQL:', error);
      return null;
    } finally {
      this._generatingSQL.set(false);
      this._currentRequestId.set(null);
    }
  }

  /**
   * Cancel current AI request
   */
  async cancelCurrentRequest(): Promise<void> {
    const requestId = this._currentRequestId();
    if (!requestId || !this.ipc.isAvailable) return;

    try {
      await firstValueFrom(this.ipc.cancelAIRequest(requestId));
    } catch (error) {
      console.error('Failed to cancel request:', error);
    } finally {
      this._currentRequestId.set(null);
      this._generatingTabName.set(false);
      this._analyzingResults.set(false);
      this._generatingSQL.set(false);
    }
  }
}
