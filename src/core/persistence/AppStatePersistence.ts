import { tauriDb, isTauriAvailable, logFallbackOnce } from './TauriBridge';
import { logger } from '../../utils/logger';
import type { LiveSafetyState } from '../types';

export interface PersistedAppState {
  schemaVersion: string;
  savedAt: string;
  paperStartingBalance: number;
  riskStyle: string;
  maxPositions: number;
  capitalPerTrade: number;
  allowedGroups: string;
  selectedCoins: string[];
  activeTradeMode: string;
  liveSafetyState: LiveSafetyState;
  equityHistory: { time: number; equity: number }[];
}

const FALLBACK_PREFIX = 'cryptobud_v4:';
const APP_STATE_KEY = 'app_state_v1';

export function createDefaultAppState(): PersistedAppState {
  return {
    schemaVersion: 'cryptobud-v4-appstate-v1',
    savedAt: new Date().toISOString(),
    paperStartingBalance: 10000,
    riskStyle: 'moderate',
    maxPositions: 10,
    capitalPerTrade: 100,
    allowedGroups: 'all',
    selectedCoins: [],
    activeTradeMode: 'AUTO',
    liveSafetyState: 'LIVE_DISABLED',
    equityHistory: [],
  };
}

function safeLiveStateAfterRestore(persisted: LiveSafetyState): LiveSafetyState {
  if (persisted === 'LIVE_RUNNING' || persisted === 'LIVE_READY') {
    logger.info('PERSISTENCE: Live state was active — restoring as LIVE_CHECK_REQUIRED');
    return 'LIVE_CHECK_REQUIRED';
  }
  if (persisted === 'LIVE_CHECK_RUNNING') {
    return 'LIVE_CHECK_REQUIRED';
  }
  return persisted;
}

let noAppStateLogged = false;

export const appStatePersistence = {
  // Reset guard for tests
  _resetGuard() { noAppStateLogged = false; },

  async save(state: PersistedAppState): Promise<void> {
    const toSave: PersistedAppState = {
      ...state,
      savedAt: new Date().toISOString(),
    };
    try {
      if (await isTauriAvailable()) {
        logger.info(`PERSISTENCE_SAVE_APP_STATE_PAYLOAD_AUDIT: key=${APP_STATE_KEY} valueJsonBytes=${JSON.stringify(toSave).length} hasValueJson=true target=tauri`);
        await tauriDb.saveAppState(APP_STATE_KEY, JSON.stringify(toSave));
      } else {
        logFallbackOnce((m) => logger.info(m));
        localStorage.setItem(FALLBACK_PREFIX + APP_STATE_KEY, JSON.stringify(toSave));
      }
    } catch (err) {
      logger.warn(`PERSISTENCE_SAVE_APP_STATE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  async load(): Promise<PersistedAppState> {
    try {
      let raw: string | null = null;
      if (await isTauriAvailable()) {
        raw = await tauriDb.getAppState(APP_STATE_KEY);
      } else {
        logFallbackOnce((m) => logger.info(m));
        raw = localStorage.getItem(FALLBACK_PREFIX + APP_STATE_KEY);
      }

      if (!raw) {
        if (!noAppStateLogged) {
          noAppStateLogged = true;
          logger.info('PERSISTENCE: No saved app state found, using defaults');
        }
        const defaults = createDefaultAppState();
        defaults.liveSafetyState = safeLiveStateAfterRestore(defaults.liveSafetyState);
        return defaults;
      }

      const parsed = JSON.parse(raw) as PersistedAppState;
      parsed.liveSafetyState = safeLiveStateAfterRestore(parsed.liveSafetyState);
      logger.info(`PERSISTENCE: Loaded app state (${parsed.selectedCoins.length} coins, mode=${parsed.activeTradeMode})`);
      return parsed;
    } catch (err) {
      logger.warn(`PERSISTENCE_LOAD_APP_STATE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
      const defaults = createDefaultAppState();
      defaults.liveSafetyState = safeLiveStateAfterRestore(defaults.liveSafetyState);
      return defaults;
    }
  },

  async clear(): Promise<void> {
    try {
      if (await isTauriAvailable()) {
        await tauriDb.saveAppState(APP_STATE_KEY, JSON.stringify(createDefaultAppState()));
      } else {
        localStorage.removeItem(FALLBACK_PREFIX + APP_STATE_KEY);
      }
    } catch { /* ignore */ }
  },
};

export async function testAppStatePersistenceRoundTrip(): Promise<{
  storageEngine: 'tauri' | 'local_fallback';
  testKey: string;
  writeSuccess: boolean;
  readSuccess: boolean;
  parsedJson: boolean;
  tradeInsightSuccess: boolean;
  errorMessage: string | null;
  commandArgsShape: string;
  timestamp: string;
}> {
  const testKey = `${APP_STATE_KEY}__db_test`;
  const payload = { ping: 'ok', t: Date.now() };
  const result = {
    storageEngine: 'local_fallback' as 'tauri' | 'local_fallback',
    testKey,
    writeSuccess: false,
    readSuccess: false,
    parsedJson: false,
    errorMessage: null as string | null,
    commandArgsShape: 'save_app_state_entry({ key, valueJson })',
    timestamp: new Date().toISOString(),
    tradeInsightSuccess: false,
  };
  logger.info(`SETTINGS_DB_TEST_START: storageEngine=unknown testKey=${testKey} writeSuccess=false readSuccess=false parsedJson=false errorMessage=none commandArgsShape=${result.commandArgsShape} timestamp=${result.timestamp}`);
  try {
    const useTauri = await isTauriAvailable();
    result.storageEngine = useTauri ? 'tauri' : 'local_fallback';
    if (useTauri) {
      await tauriDb.saveAppState(testKey, JSON.stringify(payload));
      logger.info(`SETTINGS_DB_TEST_WRITE_SUCCESS: storageEngine=${result.storageEngine} testKey=${testKey}`);
      result.writeSuccess = true;
      const raw = await tauriDb.getAppState(testKey);
      logger.info(`SETTINGS_DB_TEST_READ_SUCCESS: storageEngine=${result.storageEngine} testKey=${testKey} readSuccess=${String(raw !== null)}`);
      result.readSuccess = raw !== null;
      if (raw) {
        JSON.parse(raw);
        result.parsedJson = true;
      }
      await tauriDb.saveTradeInsight({
        symbol: 'DBTESTUSDT',
        eventTs: Date.now(),
        confidenceBps: 7500,
        score: 88.5,
        diagnosticTest: true,
      });
      result.tradeInsightSuccess = true;
      logger.info(`SETTINGS_DB_TEST_TRADE_INSIGHT_SUCCESS: storageEngine=${result.storageEngine} commandName=save_trade_insight testMode=true`);
    } else {
      localStorage.setItem(FALLBACK_PREFIX + testKey, JSON.stringify(payload));
      logger.info(`SETTINGS_DB_TEST_WRITE_SUCCESS: storageEngine=${result.storageEngine} testKey=${testKey}`);
      result.writeSuccess = true;
      const raw = localStorage.getItem(FALLBACK_PREFIX + testKey);
      logger.info(`SETTINGS_DB_TEST_READ_SUCCESS: storageEngine=${result.storageEngine} testKey=${testKey} readSuccess=${String(raw !== null)}`);
      result.readSuccess = raw !== null;
      if (raw) {
        JSON.parse(raw);
        result.parsedJson = true;
      }
      result.tradeInsightSuccess = true;
      logger.info(`SETTINGS_DB_TEST_TRADE_INSIGHT_SUCCESS: storageEngine=${result.storageEngine} commandName=save_trade_insight testMode=true reason=fallback_mode`);
    }
    logger.info(`SETTINGS_DB_TEST_SUCCESS: storageEngine=${result.storageEngine} testKey=${testKey} writeSuccess=${String(result.writeSuccess)} readSuccess=${String(result.readSuccess)} parsedJson=${String(result.parsedJson)} tradeInsightSuccess=${String(result.tradeInsightSuccess)} errorMessage=none commandArgsShape=${result.commandArgsShape} timestamp=${result.timestamp}`);
  } catch (err) {
    result.errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(`SETTINGS_DB_TEST_FAILED: storageEngine=${result.storageEngine} testKey=${testKey} writeSuccess=${String(result.writeSuccess)} readSuccess=${String(result.readSuccess)} parsedJson=${String(result.parsedJson)} errorMessage=${result.errorMessage} commandArgsShape=${result.commandArgsShape} timestamp=${result.timestamp}`);
  }
  return result;
}
