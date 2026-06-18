import type { AppSettings, ApiConfig, TelegramSettings, ResetResult, ResetType } from '../types';
import { createDefaultAppSettings, createDefaultApiConfig, createDefaultTelegramSettings } from '../types';
import { tauriDb, isTauriAvailable } from './TauriBridge';
import { logger } from '../../utils/logger';
import { resolveMaxSelectedPerScanConfig } from '../settings/max-selected-per-scan';
import { normalizeAutoPerformanceMode, normalizePerformanceSettings, savePerformanceSettings } from '../../lib/performance/performanceSettings';

const SETTINGS_KEY = 'app_settings';
const API_CONFIG_KEY = 'api_config';
const TELEGRAM_KEY = 'telegram_settings';
const FALLBACK_PREFIX = 'cryptobud_v4:';
const sharedFallbackStore: Map<string, string> = new Map();

export class SettingsPersistence {
  private store: Map<string, string> = sharedFallbackStore;
  private useTauri = false;
  private lastSaveTimestamps: Map<string, number> = new Map();
  private readonly SAVE_DEDUP_MS = 500;

  constructor() {
    this.init();
  }

  private isDupLog(key: string): boolean {
    const now = Date.now();
    const last = this.lastSaveTimestamps.get(key) ?? 0;
    if (now - last < this.SAVE_DEDUP_MS) return true;
    this.lastSaveTimestamps.set(key, now);
    return false;
  }

  private async init() {
    try {
      this.useTauri = await isTauriAvailable();
    } catch {
      this.useTauri = false;
    }
  }

  private async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
    if (typeof window !== 'undefined' && window.localStorage) {
      try { window.localStorage.setItem(FALLBACK_PREFIX + key, value); } catch { /* fallback */ }
    }
    if (this.useTauri) {
      try { await tauriDb.saveAppState(key, value); } catch { /* fallback ok */ }
    }
  }

  private async getItem(key: string): Promise<string | null> {
    if (this.useTauri) {
      try {
        const tauriValue = await tauriDb.getAppState(key);
        if (tauriValue !== null && tauriValue !== '') return tauriValue;
      } catch {
        /* fallback */
      }
    }
    const mem = this.store.get(key);
    if (mem !== undefined) return mem;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(FALLBACK_PREFIX + key);
        if (raw !== null) this.store.set(key, raw);
        return raw;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async removeItem(key: string): Promise<void> {
    this.store.delete(key);
    if (typeof window !== 'undefined' && window.localStorage) {
      try { window.localStorage.removeItem(FALLBACK_PREFIX + key); } catch { /* fallback */ }
    }
    if (this.useTauri) {
      try { await tauriDb.saveAppState(key, ''); } catch { /* fallback */ }
    }
  }

  // ── App Settings ──────────────────────────────────────

  async saveSettings(settings: AppSettings): Promise<void> {
    const resolvedMaxSelected = resolveMaxSelectedPerScanConfig({
      uiValue: (settings as any).maxSelectedPerScan,
      persistedLegacyMaxEntriesPerCycle: (settings as any).maxEntriesPerCycle,
      userExplicit: (settings as any).maxSelectedPerScanUserSet === true,
      sourceHint: 'ui_setting',
      reason: 'settings_save_canonicalized',
    });
    const maxSelectedPerScan = resolvedMaxSelected.value;
    const updated = {
      ...settings,
      maxSelectedPerScan,
      maxEntriesPerCycle: maxSelectedPerScan,
      maxSelectedPerScanUserSet: (settings as any).maxSelectedPerScanUserSet === true,
      graphicsQuality: normalizePerformanceSettings(settings).graphicsQuality,
      autoPerformanceMode: normalizeAutoPerformanceMode((settings as any).autoPerformanceMode) === 'on',
      updatedAt: new Date().toISOString(),
    };
    logger.info(`USER_SETTINGS_SAVE_REQUESTED: tradingCapital=${(updated as any).autoTradingCapital ?? 1000} capitalPerCoin=${(updated as any).capitalPerCoin ?? updated.capitalPerTrade ?? 100} maxOpenPositions=${updated.maxPositions ?? 10} bannedCoinsCount=${(updated.scannerBanlist ?? []).length} source=persistence storageKey=${SETTINGS_KEY} hydrationComplete=true`);
    await this.setItem(SETTINGS_KEY, JSON.stringify(updated));
    savePerformanceSettings({
      graphicsQuality: updated.graphicsQuality,
      autoPerformanceMode: updated.autoPerformanceMode ? 'on' : 'off',
    });
    logger.info(`USER_SETTINGS_SAVE_SUCCESS: tradingCapital=${(updated as any).autoTradingCapital ?? 1000} capitalPerCoin=${(updated as any).capitalPerCoin ?? updated.capitalPerTrade ?? 100} maxOpenPositions=${updated.maxPositions ?? 10} bannedCoinsCount=${(updated.scannerBanlist ?? []).length} source=persistence storageKey=${SETTINGS_KEY}`);
    logger.info(`TRADING_SETTINGS_PERSISTENCE_AUDIT: reason=settings_save savedRefPeriod=${updated.scannerReferencePeriod ?? 'n/a'} savedRefMode=${(updated as any).refMode ?? 'n/a'} savedRefWindow=${(updated as any).refWindow ?? 'n/a'} writeSuccess=true sourceUsed=${typeof (typeof window !== 'undefined' ? (window as any).__TAURI_INTERNALS__ : undefined) !== 'undefined' ? 'tauri_sqlite' : 'localStorage'}`);
    if (!this.isDupLog('SETTINGS_SAVED')) logger.info('SETTINGS_SAVED');
  }

  async loadSettings(): Promise<AppSettings> {
    logger.info(`USER_SETTINGS_PERSISTENCE_BOOT_START: storageKey=${SETTINGS_KEY}`);
    const raw = await this.getItem(SETTINGS_KEY);
    if (!raw) {
      logger.info(`USER_SETTINGS_STORAGE_EMPTY: storageKey=${SETTINGS_KEY}`);
      resolveMaxSelectedPerScanConfig({
        reason: 'settings_storage_empty_default_10',
      });
      return createDefaultAppSettings();
    }
    try {
      const parsed = JSON.parse(raw) as AppSettings;
      const defaults = createDefaultAppSettings();
      const hasCanonical = Object.prototype.hasOwnProperty.call(parsed as any, 'maxSelectedPerScan');
      const resolvedMaxSelected = resolveMaxSelectedPerScanConfig({
        persistedMaxSelectedPerScan: hasCanonical ? (parsed as any).maxSelectedPerScan : undefined,
        persistedLegacyMaxEntriesPerCycle: (parsed as any).maxEntriesPerCycle,
        maxSelectedPerScan: hasCanonical ? (parsed as any).maxSelectedPerScan : undefined,
        userExplicit: (parsed as any).maxSelectedPerScanUserSet === true,
        sourceHint: hasCanonical ? 'persisted_setting' : undefined,
        reason: hasCanonical ? 'settings_load_persisted_canonical' : ((parsed as any).maxEntriesPerCycle != null ? 'settings_load_legacy_migrated_to_default_10' : 'settings_load_default_10'),
      });
      const maxSelectedPerScan = resolvedMaxSelected.value;
      const normalized = {
        ...defaults,
        ...parsed,
        maxSelectedPerScan,
        maxEntriesPerCycle: maxSelectedPerScan,
        maxSelectedPerScanUserSet: (parsed as any).maxSelectedPerScanUserSet === true,
        graphicsQuality: normalizePerformanceSettings(parsed).graphicsQuality,
        autoPerformanceMode: normalizeAutoPerformanceMode((parsed as any).autoPerformanceMode) === 'on',
      };
      savePerformanceSettings({
        graphicsQuality: normalized.graphicsQuality,
        autoPerformanceMode: normalized.autoPerformanceMode ? 'on' : 'off',
      });
      logger.info(`USER_SETTINGS_STORAGE_FOUND: storageKey=${SETTINGS_KEY} tradingCapital=${(parsed as any).autoTradingCapital ?? 1000} capitalPerCoin=${(parsed as any).capitalPerCoin ?? parsed.capitalPerTrade ?? 100} maxOpenPositions=${parsed.maxPositions ?? 10} bannedCoinsCount=${(parsed.scannerBanlist ?? []).length}`);
      return normalized;
    } catch {
      return createDefaultAppSettings();
    }
  }

  // ── API Config ────────────────────────────────────────

  async saveApiConfig(config: ApiConfig): Promise<void> {
    const safe: ApiConfig = {
      ...config,
      apiKey: config.apiKey || '',
      apiSecret: config.apiSecret || '',
    };
    await this.setItem(API_CONFIG_KEY, JSON.stringify(safe));
  }

  async loadApiConfig(): Promise<ApiConfig> {
    const rawConfig = await this.loadApiConfigRaw();
    return {
      ...rawConfig,
      apiSecret: '',
    };
  }

  async loadApiConfigRaw(): Promise<ApiConfig> {
    const raw = await this.getItem(API_CONFIG_KEY);
    if (!raw) return createDefaultApiConfig();
    try {
      return JSON.parse(raw) as ApiConfig;
    } catch {
      return createDefaultApiConfig();
    }
  }

  async getApiStorageMode(): Promise<'secure' | 'tauri_app_state' | 'local_fallback'> {
    return this.useTauri ? 'tauri_app_state' : 'local_fallback';
  }

  async clearApiConfig(): Promise<void> {
    await this.removeItem(API_CONFIG_KEY);
    logger.info('API_KEYS_CLEARED');
  }

  // ── Telegram Settings ─────────────────────────────────

  async saveTelegramSettings(settings: TelegramSettings): Promise<void> {
    const safe: TelegramSettings = {
      ...settings,
      botToken: settings.botToken || '',
      chatId: settings.chatId || '',
    };
    await this.setItem(TELEGRAM_KEY, JSON.stringify(safe));
    if (!this.isDupLog('TELEGRAM_SETTINGS_SAVED')) logger.info('TELEGRAM_SETTINGS_SAVED');
  }

  async loadTelegramSettings(): Promise<TelegramSettings> {
    const raw = await this.getItem(TELEGRAM_KEY);
    if (!raw) return createDefaultTelegramSettings();
    try {
      return JSON.parse(raw) as TelegramSettings;
    } catch {
      return createDefaultTelegramSettings();
    }
  }

  // ── Reset Methods ─────────────────────────────────────

  async resetDemoBalance(): Promise<ResetResult> {
    const result: ResetResult = {
      success: true,
      resetType: 'reset_balance',
      resetAt: new Date().toISOString(),
      clearedItems: ['paper_balance'],
      preservedItems: ['app_settings', 'api_config', 'telegram_settings', 'journal_trades', 'ml_brain'],
      warnings: [],
      errors: [],
    };
    logger.info('DEMO_TRADING_RESET_REQUESTED');
    await this.setItem('demo_balance_reset', JSON.stringify({ resetAt: result.resetAt }));
    logger.info('DEMO_TRADING_RESET_COMPLETED');
    return result;
  }

  async resetDemoPositions(): Promise<ResetResult> {
    const result: ResetResult = {
      success: true,
      resetType: 'reset_positions',
      resetAt: new Date().toISOString(),
      clearedItems: ['paper_positions', 'order_locks'],
      preservedItems: ['app_settings', 'api_config', 'telegram_settings', 'journal_trades', 'ml_brain', 'paper_balance'],
      warnings: [],
      errors: [],
    };
    logger.info('DEMO_TRADING_RESET_REQUESTED');
    await this.setItem('demo_positions_reset', JSON.stringify({ resetAt: result.resetAt }));
    logger.info('DEMO_TRADING_RESET_COMPLETED');
    return result;
  }

  async fullDemoReset(): Promise<ResetResult> {
    const result: ResetResult = {
      success: true,
      resetType: 'full_demo_reset',
      resetAt: new Date().toISOString(),
      clearedItems: ['paper_balance', 'paper_positions', 'order_locks', 'demo_runtime_state', 'demo_pnl_stats'],
      preservedItems: ['app_settings', 'api_config', 'telegram_settings', 'journal_trades', 'ml_brain'],
      warnings: ['Demo trading fully reset. Settings and API config preserved.'],
      errors: [],
    };
    logger.info('DEMO_TRADING_RESET_REQUESTED');
    await this.setItem('full_demo_reset', JSON.stringify({ resetAt: result.resetAt }));
    logger.info('DEMO_TRADING_RESET_COMPLETED');
    return result;
  }

  async resetMLBrain(): Promise<ResetResult> {
    const result: ResetResult = {
      success: true,
      resetType: 'reset_ml',
      resetAt: new Date().toISOString(),
      clearedItems: ['ml_predictions', 'ml_weights', 'ml_memory', 'ml_regime_memory', 'ml_advisory_counters'],
      preservedItems: ['journal_trades', 'app_settings', 'api_config', 'telegram_settings'],
      warnings: ['ML brain reset. Journal trades preserved.'],
      errors: [],
    };
    logger.info('ML_BRAIN_RESET_REQUESTED');
    await this.setItem('ml_brain_reset', JSON.stringify({ resetAt: result.resetAt }));
    logger.info('ML_BRAIN_RESET_COMPLETED');
    return result;
  }
}
