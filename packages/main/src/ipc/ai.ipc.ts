/**
 * AI IPC Handlers
 */

import { IPC_CHANNELS } from '@forgedb/shared';
import type {
  AISettings,
  TabRenameRequest,
  AnalysisRequest,
  SQLGenerationRequest,
} from '@forgedb/shared';
import { AIService } from '../services/ai/ai-service';
import { safeHandle } from './safe-handle';

export function registerAIHandlers(): void {
  const aiService = AIService.getInstance();

  // Get available vendors
  safeHandle(IPC_CHANNELS.AI.GET_VENDORS, () => {
    return aiService.getVendors();
  });

  // Get current settings
  safeHandle(IPC_CHANNELS.AI.GET_SETTINGS, () => {
    return aiService.getSettings();
  });

  // Update settings
  safeHandle(IPC_CHANNELS.AI.SET_SETTINGS, async (_event, settings: Partial<AISettings>) => {
    await aiService.setSettings(settings);
    return aiService.getSettings();
  });

  // Set API key for a vendor
  safeHandle(IPC_CHANNELS.AI.SET_API_KEY, async (_event, vendorId: string, apiKey: string) => {
    await aiService.setApiKey(vendorId, apiKey);
    return true;
  });

  // Remove API key for a vendor
  safeHandle(IPC_CHANNELS.AI.REMOVE_API_KEY, async (_event, vendorId: string) => {
    await aiService.removeApiKey(vendorId);
    return true;
  });

  // Validate API key
  safeHandle(IPC_CHANNELS.AI.VALIDATE_API_KEY, async (_event, vendorId: string, apiKey: string) => {
    return aiService.validateApiKey(vendorId, apiKey);
  });

  // Generate tab name
  safeHandle(IPC_CHANNELS.AI.GENERATE_TAB_NAME, async (_event, request: TabRenameRequest) => {
    return aiService.generateTabName(request);
  });

  // Analyze results
  safeHandle(IPC_CHANNELS.AI.ANALYZE_RESULTS, async (_event, request: AnalysisRequest) => {
    return aiService.analyzeResults(request);
  });

  // Generate SQL
  safeHandle(IPC_CHANNELS.AI.GENERATE_SQL, async (_event, request: SQLGenerationRequest) => {
    return aiService.generateSQL(request);
  });

  // Cancel request
  safeHandle(IPC_CHANNELS.AI.CANCEL_REQUEST, (_event, requestId: string) => {
    aiService.cancelRequest(requestId);
    return true;
  });
}
