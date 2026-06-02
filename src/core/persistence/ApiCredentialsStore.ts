import { SettingsPersistence } from './SettingsPersistence';
import type { ApiConfig, AppSettings } from '../types';
import { logger } from '../../utils/logger';

export interface ApiCredentialsStatus {
  configured: boolean;
  apiKeyConfigured: boolean;
  apiSecretConfigured: boolean;
  maskedApiKey: string | null;
  savedAt: string | null;
  storageMode: 'secure' | 'tauri_app_state' | 'local_fallback';
  error?: string;
}

const settingsPersistence = new SettingsPersistence();

function maskApiKey(key: string): string | null {
  if (key.length <= 8) return null;
  return key.slice(0, 4) + '...' + key.slice(-4);
}

function nowISO(): string {
  return new Date().toISOString();
}

export const apiCredentialsStore = {
  async saveApiCredentials({ apiKey, apiSecret }: { apiKey: string; apiSecret: string }): Promise<ApiCredentialsStatus> {
    logger.info('API_CREDENTIALS_SAVE_STARTED');

    if (!apiKey || !apiSecret) {
      logger.warn('API_CREDENTIALS_SAVE_BLOCKED_MISSING_FIELDS');
      return {
        configured: false,
        apiKeyConfigured: false,
        apiSecretConfigured: false,
        maskedApiKey: null,
        savedAt: null,
        storageMode: await settingsPersistence.getApiStorageMode(),
        error: 'API key and secret are both required.',
      };
    }

    const storageMode = await settingsPersistence.getApiStorageMode();
    const masked = maskApiKey(apiKey);
    const config: ApiConfig = {
      apiKey,
      apiSecret,
      status: 'CONFIGURED',
      lastTestedAt: null,
      lastTestError: null,
    };
    await settingsPersistence.saveApiConfig(config);

    const existing = await settingsPersistence.loadSettings();
    const settings: AppSettings = {
      ...existing,
      binanceApiConfigured: true,
      binanceApiKeyMasked: masked,
      apiCredentialsSavedAt: nowISO(),
      apiStorageMode: storageMode,
      updatedAt: nowISO(),
    };
    await settingsPersistence.saveSettings(settings);

    logger.info('API_CREDENTIALS_SAVED');
    if (storageMode !== 'secure') {
      logger.warn('API keys saved in app storage for development. Secure storage required before live trading.');
    }
    return {
      configured: true,
      apiKeyConfigured: true,
      apiSecretConfigured: true,
      maskedApiKey: masked,
      savedAt: settings.apiCredentialsSavedAt,
      storageMode,
    };
  },

  async loadApiCredentialsStatus(): Promise<ApiCredentialsStatus> {
    const settings = await settingsPersistence.loadSettings();
    const storageMode = settings.apiStorageMode ?? await settingsPersistence.getApiStorageMode();
    if (!settings.binanceApiConfigured) {
      logger.info('API_CREDENTIALS_STATUS_LOADED');
      return {
        configured: false,
        apiKeyConfigured: false,
        apiSecretConfigured: false,
        maskedApiKey: null,
        savedAt: null,
        storageMode,
      };
    }
    logger.info('API_CREDENTIALS_STATUS_LOADED');
    return {
      configured: true,
      apiKeyConfigured: true,
      apiSecretConfigured: true,
      maskedApiKey: settings.binanceApiKeyMasked,
      savedAt: settings.apiCredentialsSavedAt ?? settings.updatedAt,
      storageMode,
    };
  },

  async clearApiCredentials(): Promise<ApiCredentialsStatus> {
    await settingsPersistence.clearApiConfig();
    const existing = await settingsPersistence.loadSettings();
    const storageMode = existing.apiStorageMode ?? await settingsPersistence.getApiStorageMode();
    const settings: AppSettings = {
      ...existing,
      binanceApiConfigured: false,
      binanceApiKeyMasked: null,
      apiCredentialsSavedAt: null,
      updatedAt: nowISO(),
    };
    await settingsPersistence.saveSettings(settings);
    logger.info('API_CREDENTIALS_CLEARED');
    return {
      configured: false,
      apiKeyConfigured: false,
      apiSecretConfigured: false,
      maskedApiKey: null,
      savedAt: null,
      storageMode,
    };
  },

  async testApiCredentials(credentials?: { apiKey: string; apiSecret: string } | null): Promise<{ ok: boolean; code: 'API_TEST_SUCCESS' | 'API_TEST_FAILED' | 'API_NOT_CONFIGURED'; message?: string }> {
    logger.info('API_TEST_STARTED');
    const resolved = credentials ?? await this.getCredentialsForTest();
    if (!resolved) {
      logger.warn('API_NOT_CONFIGURED');
      return { ok: false, code: 'API_NOT_CONFIGURED', message: 'API credentials are not configured.' };
    }
    try {
      const res = await fetch('https://api.binance.com/api/v3/ping', { method: 'GET' });
      if (!res.ok) {
        logger.info(`API_TEST_FAILED: HTTP ${res.status}`);
        return { ok: false, code: 'API_TEST_FAILED', message: `HTTP ${res.status}` };
      }
      logger.info('API_TEST_SUCCESS');
      return { ok: true, code: 'API_TEST_SUCCESS' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.info(`API_TEST_FAILED: ${msg}`);
      return { ok: false, code: 'API_TEST_FAILED', message: msg };
    }
  },

  async getMaskedApiKey(): Promise<string | null> {
    const status = await this.loadApiCredentialsStatus();
    return status.maskedApiKey;
  },

  async getCredentialsForTest(): Promise<{ apiKey: string; apiSecret: string } | null> {
    const config = await settingsPersistence.loadApiConfigRaw();
    if (!config.apiKey || !config.apiSecret) return null;
    return { apiKey: config.apiKey, apiSecret: config.apiSecret };
  },

  async hasApiCredentials(): Promise<boolean> {
    const status = await this.loadApiCredentialsStatus();
    return status.configured;
  },

  async save(apiKey: string, apiSecret: string): Promise<ApiCredentialsStatus> {
    return this.saveApiCredentials({ apiKey, apiSecret });
  },
  async loadStatus(): Promise<ApiCredentialsStatus> {
    return this.loadApiCredentialsStatus();
  },
  async clear(): Promise<ApiCredentialsStatus> {
    return this.clearApiCredentials();
  },
  async hasCredentials(): Promise<boolean> {
    return this.hasApiCredentials();
  },
};
