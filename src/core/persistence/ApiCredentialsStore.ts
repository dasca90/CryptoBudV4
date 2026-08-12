import type { AppSettings } from '../types';
import { logger } from '../../utils/logger';
import { SettingsPersistence } from './SettingsPersistence';
import {
  SecureCredentialStore,
  normalizeSecureCredentialError,
  type CredentialSecurityStatus,
  type SecureCredentialBackend,
} from './SecureCredentialStore';

export interface ApiCredentialsStatus extends CredentialSecurityStatus {
  apiKeyConfigured: boolean;
  apiSecretConfigured: boolean;
  savedAt: string | null;
  storageMode: 'secure' | 'unavailable';
  error?: string;
}

export type CredentialLifecycleEvent = 'saved' | 'replaced' | 'deleted';

function nowISO(): string { return new Date().toISOString(); }

export class ApiCredentialsStore {
  private readonly secureStore: SecureCredentialStore;
  private readonly listeners = new Set<(event: CredentialLifecycleEvent) => void>();

  constructor(
    backend?: SecureCredentialBackend,
    private readonly settingsPersistence = new SettingsPersistence(),
  ) {
    this.secureStore = new SecureCredentialStore(backend);
  }

  subscribe(listener: (event: CredentialLifecycleEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CredentialLifecycleEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async saveApiCredentials({ apiKey, apiSecret }: { apiKey: string; apiSecret: string }): Promise<ApiCredentialsStatus> {
    if (!apiKey.trim() || !apiSecret) throw new Error('CREDENTIALS_NOT_CONFIGURED');
    const before = await this.loadApiCredentialsStatus();
    logger.info('SECURE_CREDENTIAL_SAVE_AUDIT secureWriteOk=pending legacyDeleted=pending');
    try {
      const native = await this.secureStore.saveBinanceCredentials(apiKey.trim(), apiSecret);
      if (!native.configured || !native.storageSecure) throw new Error('SECURE_STORE_WRITE_FAILED');

      await this.settingsPersistence.clearApiConfig();
      const legacyDeleted = !await this.settingsPersistence.hasLegacyPlaintextApiCredentials();
      if (!legacyDeleted) {
        await this.secureStore.deleteBinanceCredentials().catch(() => undefined);
        logger.error('SECURE_CREDENTIAL_MIGRATION_AUDIT legacySecretFound=true secureWriteOk=true legacySecretDeleted=false migrationOk=false');
        throw new Error('SECURE_STORE_DELETE_FAILED');
      }

      const savedAt = nowISO();
      const existing = await this.settingsPersistence.loadSettings();
      const settings: AppSettings = {
        ...existing,
        binanceApiConfigured: true,
        binanceApiKeyMasked: native.maskedApiKey,
        apiCredentialsSavedAt: savedAt,
        apiStorageMode: 'secure',
        updatedAt: savedAt,
      };
      await this.settingsPersistence.saveSettings(settings);
      logger.info('SECURE_CREDENTIAL_SAVE_AUDIT provider=os_keyring configured=true storageSecure=true secureWriteOk=true legacyDeleted=true');
      logger.info(`SECURE_CREDENTIAL_MIGRATION_AUDIT legacySecretFound=${String(before.legacyCredentialDetected)} secureWriteOk=true legacySecretDeleted=true migrationOk=true`);
      this.emit(before.configured ? 'replaced' : 'saved');
      return this.loadApiCredentialsStatus();
    } catch (error) {
      logger.error('SECURE_CREDENTIAL_SAVE_AUDIT configured=false storageSecure=false secureWriteOk=false');
      throw normalizeSecureCredentialError(error, 'SECURE_STORE_WRITE_FAILED');
    }
  }

  async loadApiCredentialsStatus(): Promise<ApiCredentialsStatus> {
    const [native, legacyCredentialDetected, settings] = await Promise.all([
      this.secureStore.getCredentialStatus(),
      this.settingsPersistence.hasLegacyPlaintextApiCredentials(),
      this.settingsPersistence.loadSettings(),
    ]);
    const migrationRequired = legacyCredentialDetected;
    const state = migrationRequired ? 'MIGRATION_REQUIRED' : native.state;
    const configured = native.configured && native.storageSecure && !migrationRequired;
    const result: ApiCredentialsStatus = {
      ...native,
      state,
      configured,
      legacyCredentialDetected,
      migrationRequired,
      apiKeyConfigured: configured,
      apiSecretConfigured: configured,
      savedAt: configured ? settings.apiCredentialsSavedAt ?? settings.updatedAt : null,
      storageMode: native.storageSecure ? 'secure' : 'unavailable',
      error: native.errorCode,
    };
    logger.info(`SECURE_CREDENTIAL_STORE_STATUS_AUDIT provider=${result.provider} platform=${result.platform} configured=${String(result.configured)} storageSecure=${String(result.storageSecure)} legacyCredentialDetected=${String(legacyCredentialDetected)} migrationRequired=${String(migrationRequired)}`);
    return result;
  }

  async clearApiCredentials(options: { hasOpenLiveExposure?: boolean } = {}): Promise<ApiCredentialsStatus> {
    if (options.hasOpenLiveExposure) {
      logger.warn('SECURE_CREDENTIAL_DELETE_AUDIT deleted=false reason=ACTIVE_LIVE_EXPOSURE');
      throw new Error('CREDENTIAL_DELETE_BLOCKED_ACTIVE_LIVE_EXPOSURE');
    }
    try {
      await this.secureStore.deleteBinanceCredentials();
      await this.settingsPersistence.clearApiConfig();
      const existing = await this.settingsPersistence.loadSettings();
      await this.settingsPersistence.saveSettings({
        ...existing,
        binanceApiConfigured: false,
        binanceApiKeyMasked: null,
        apiCredentialsSavedAt: null,
        apiStorageMode: 'secure',
        updatedAt: nowISO(),
      });
      logger.info('SECURE_CREDENTIAL_DELETE_AUDIT deleted=true activeLiveExposure=false');
      this.emit('deleted');
      return this.loadApiCredentialsStatus();
    } catch (error) {
      logger.error('SECURE_CREDENTIAL_DELETE_AUDIT deleted=false reason=SECURE_STORE_DELETE_FAILED');
      throw normalizeSecureCredentialError(error, 'SECURE_STORE_DELETE_FAILED');
    }
  }

  async assertLiveCredentialInvariant(): Promise<ApiCredentialsStatus> {
    const status = await this.loadApiCredentialsStatus();
    const invariantOk = status.configured && status.storageSecure && !status.legacyCredentialDetected && status.providerHealthy;
    logger.info(`BINANCE_CREDENTIAL_SECURITY_INVARIANT_AUDIT configured=${String(status.configured)} storageSecure=${String(status.storageSecure)} legacyCredentialDetected=${String(status.legacyCredentialDetected)} providerHealthy=${String(status.providerHealthy)} invariantOk=${String(invariantOk)}`);
    if (!invariantOk) throw new Error(status.migrationRequired ? 'CREDENTIAL_MIGRATION_REQUIRED' : 'LIVE_CREDENTIAL_STORAGE_NOT_SECURE');
    return status;
  }

  async signPayload(payload: string, includeApiKey = false): Promise<{ apiKey: string; signature: string }> {
    try { return await this.secureStore.signBinancePayload(payload, includeApiKey); }
    catch (error) { throw normalizeSecureCredentialError(error, 'SECURE_STORE_READ_FAILED'); }
  }

  async testApiCredentials(): Promise<{ ok: boolean; code: 'API_TEST_SUCCESS' | 'API_TEST_FAILED' | 'API_NOT_CONFIGURED'; message?: string }> {
    logger.info('API_TEST_STARTED');
    try {
      const status = await this.loadApiCredentialsStatus();
      if (!status.configured && status.state === 'NOT_CONFIGURED') {
        logger.warn('API_NOT_CONFIGURED');
        return { ok: false, code: 'API_NOT_CONFIGURED', message: 'CREDENTIALS_NOT_CONFIGURED' };
      }
      await this.assertLiveCredentialInvariant();
      const { LiveBinanceAdapter } = await import('../exchange/LiveBinanceAdapter');
      const adapter = new LiveBinanceAdapter(() => 'LIVE_READY', { startPrivateStream: false });
      await adapter.runReadinessProbe();
      logger.info('API_TEST_SUCCESS');
      return { ok: true, code: 'API_TEST_SUCCESS' };
    } catch (error) {
      const message = normalizeSecureCredentialError(error, 'API_TEST_FAILED').message;
      const code = message === 'CREDENTIALS_NOT_CONFIGURED' ? 'API_NOT_CONFIGURED' : 'API_TEST_FAILED';
      logger.warn(`API_TEST_FAILED code=${code}`);
      return { ok: false, code, message };
    }
  }

  async getMaskedApiKey(): Promise<string | null> { return (await this.loadApiCredentialsStatus()).maskedApiKey; }
  async hasApiCredentials(): Promise<boolean> { return (await this.loadApiCredentialsStatus()).configured; }
  async save(apiKey: string, apiSecret: string): Promise<ApiCredentialsStatus> { return this.saveApiCredentials({ apiKey, apiSecret }); }
  async loadStatus(): Promise<ApiCredentialsStatus> { return this.loadApiCredentialsStatus(); }
  async clear(options?: { hasOpenLiveExposure?: boolean }): Promise<ApiCredentialsStatus> { return this.clearApiCredentials(options); }
  async hasCredentials(): Promise<boolean> { return this.hasApiCredentials(); }
}

export const apiCredentialsStore = new ApiCredentialsStore();
