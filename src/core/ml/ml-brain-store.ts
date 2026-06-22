import type { MLBrainModel, MlRuntimeCounters, MlRuntimeEvent, MlRuntimeMode } from '../types';
import { logger } from '../../utils/logger';

const STORAGE_KEY = 'ml_brain';
const RUNTIME_MODE_KEY = 'ml_runtime_mode';
const RUNTIME_ML_EXITS_ENABLED_KEY = 'ml_runtime_ml_exits_enabled';
const RUNTIME_EVENTS_KEY = 'ml_runtime_events_v1';
const RUNTIME_EVENTS_MAX = 500;
const RUNTIME_EVENTS_MAX_BYTES = 240_000;
const RUNTIME_EVENTS_QUOTA_RETRY_MAX_EVENTS = 100;
const RUNTIME_EVENTS_DISABLE_MS = 60_000;

export interface MLRuntimeEventsSnapshot {
  version: 1;
  savedAt: string;
  counters: MlRuntimeCounters;
  events: MlRuntimeEvent[];
}

interface InMemoryStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let store: InMemoryStoreLike = createDefaultStore();
let runtimeEventsPersistenceDisabledUntil = 0;
let runtimeEventsLastStatus = {
  eventCount: 0,
  bytes: 0,
  storageBackend: 'unknown',
  saveOk: true,
  prunedCount: 0,
  quotaLimited: false,
};

function createDefaultStore(): InMemoryStoreLike {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        getItem(key: string): string | null { return localStorage.getItem(key); },
        setItem(key: string, value: string): void { localStorage.setItem(key, value); },
        removeItem(key: string): void { localStorage.removeItem(key); },
      };
    }
  } catch {
    // Fall back to memory storage when browser storage is unavailable or blocked.
  }
  return createMemoryStore();
}

function createMemoryStore(): InMemoryStoreLike {
  const data = new Map<string, string>();
  return {
    getItem(key: string): string | null { return data.get(key) ?? null; },
    setItem(key: string, value: string): void { data.set(key, value); },
    removeItem(key: string): void { data.delete(key); },
  };
}

function createUntrainedModel(): MLBrainModel {
  return {
    modelVersion: 'untrained',
    trainedAt: '',
    featureNames: [],
    trainingRowCount: 0,
    winRateTraining: 0,
    avgPnlTraining: 0,
    goodRowCount: 0,
    mediumRowCount: 0,
    badRowCount: 0,
    rules: [],
    importId: null,
    lastImportSummary: null,
    enabled: false,
  };
}

export function saveMLBrain(model: MLBrainModel): void {
  try {
    const json = JSON.stringify(model);
    store.setItem(STORAGE_KEY, json);
    logger.info(`ML_BRAIN_SAVED: version ${model.modelVersion}, ${model.trainingRowCount} rows, ${model.rules.length} rules`);
  } catch (err) {
    logger.error(`ML_BRAIN_SAVE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadMLBrain(): MLBrainModel {
  try {
    const json = store.getItem(STORAGE_KEY);
    if (!json) {
      logger.info('ML_BRAIN_UNTRAINED_FALLBACK: no brain found');
      return createUntrainedModel();
    }
    const model = JSON.parse(json) as MLBrainModel;
    logger.info(`ML_BRAIN_LOADED: version ${model.modelVersion}, ${model.trainingRowCount} rows, trained at ${model.trainedAt}`);
    return model;
  } catch (err) {
    logger.warn(`ML_BRAIN_LOAD_FAILED: ${err instanceof Error ? err.message : String(err)}, using untrained`);
    return createUntrainedModel();
  }
}

export function resetMLBrain(): void {
  try {
    store.removeItem(STORAGE_KEY);
    logger.info('ML_BRAIN_RESET: brain cleared');
  } catch (err) {
    logger.error(`ML_BRAIN_RESET_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function setMLStore(newStore: InMemoryStoreLike): void {
  store = newStore;
  runtimeEventsPersistenceDisabledUntil = 0;
  runtimeEventsLastStatus = {
    eventCount: 0,
    bytes: 0,
    storageBackend: getRuntimeEventsStorageBackend(),
    saveOk: true,
    prunedCount: 0,
    quotaLimited: false,
  };
}

export function getUntrainedModel(): MLBrainModel {
  return createUntrainedModel();
}

export function saveMLRuntimeMode(mode: MlRuntimeMode): void {
  try {
    store.setItem(RUNTIME_MODE_KEY, mode);
    logger.info(`ML_RUNTIME_MODE_SAVED: ${mode}`);
  } catch (err) {
    logger.error(`ML_RUNTIME_MODE_SAVE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadMLRuntimeMode(): MlRuntimeMode | null {
  try {
    const value = store.getItem(RUNTIME_MODE_KEY);
    if (!value) return null;
    return value as MlRuntimeMode;
  } catch {
    return null;
  }
}

export function saveMLRuntimeMlExitsEnabled(enabled: boolean): void {
  try {
    store.setItem(RUNTIME_ML_EXITS_ENABLED_KEY, enabled ? 'true' : 'false');
    logger.info(`ML_RUNTIME_ML_EXITS_SETTING_SAVED: enabled=${String(enabled)}`);
  } catch (err) {
    logger.error(`ML_RUNTIME_ML_EXITS_SETTING_SAVE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadMLRuntimeMlExitsEnabled(): boolean {
  try {
    return store.getItem(RUNTIME_ML_EXITS_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveMLRuntimeEventsSnapshot(snapshot: MLRuntimeEventsSnapshot): void {
  const storageBackend = getRuntimeEventsStorageBackend();
  const eventCountBefore = snapshot.events.length;
  const initialPayload = JSON.stringify(snapshot);
  const bytesBefore = estimateBytes(initialPayload);
  const disabled = Date.now() < runtimeEventsPersistenceDisabledUntil;
  if (disabled) {
    runtimeEventsLastStatus = {
      ...runtimeEventsLastStatus,
      storageBackend,
      saveOk: false,
      quotaLimited: true,
    };
    logger.throttled('WARN', `ML_RUNTIME_EVENTS_QUOTA_RECOVERY_AUDIT: quotaError=false prunedCount=0 retryOk=false persistenceTemporarilyDisabled=true storageBackend=${storageBackend}`, 'ml_runtime_events_quota_disabled', RUNTIME_EVENTS_DISABLE_MS);
    return;
  }

  const bounded = pruneRuntimeEventsSnapshot(snapshot, RUNTIME_EVENTS_MAX, RUNTIME_EVENTS_MAX_BYTES);
  const boundedPayload = JSON.stringify(bounded.snapshot);
  const bytesAfter = estimateBytes(boundedPayload);
  try {
    store.setItem(RUNTIME_EVENTS_KEY, boundedPayload);
    runtimeEventsLastStatus = {
      eventCount: bounded.snapshot.events.length,
      bytes: bytesAfter,
      storageBackend,
      saveOk: true,
      prunedCount: bounded.prunedCount,
      quotaLimited: false,
    };
    logRuntimeEventsStorageAudit({
      eventCountBefore,
      eventCountAfter: bounded.snapshot.events.length,
      bytesBefore,
      bytesAfter,
      prunedCount: bounded.prunedCount,
      storageBackend,
      saveOk: true,
    });
  } catch (err) {
    const quotaError = isQuotaError(err);
    if (!quotaError) {
      logger.throttled('WARN', `ML_RUNTIME_EVENTS_SAVE_FAILED: ${err instanceof Error ? err.message : String(err)}`, 'ml_runtime_events_save_failed_non_quota', 60_000);
      runtimeEventsLastStatus = {
        eventCount: bounded.snapshot.events.length,
        bytes: bytesAfter,
        storageBackend,
        saveOk: false,
        prunedCount: bounded.prunedCount,
        quotaLimited: false,
      };
      return;
    }

    const retryBounded = pruneRuntimeEventsSnapshot(
      bounded.snapshot,
      Math.min(RUNTIME_EVENTS_QUOTA_RETRY_MAX_EVENTS, bounded.snapshot.events.length),
      Math.floor(RUNTIME_EVENTS_MAX_BYTES / 4),
    );
    const retryPayload = JSON.stringify(retryBounded.snapshot);
    const retryBytes = estimateBytes(retryPayload);
    const totalPrunedCount = bounded.prunedCount + retryBounded.prunedCount;
    try {
      store.setItem(RUNTIME_EVENTS_KEY, retryPayload);
      runtimeEventsLastStatus = {
        eventCount: retryBounded.snapshot.events.length,
        bytes: retryBytes,
        storageBackend,
        saveOk: true,
        prunedCount: totalPrunedCount,
        quotaLimited: true,
      };
      logger.throttled('WARN', `ML_RUNTIME_EVENTS_QUOTA_RECOVERY_AUDIT: quotaError=true prunedCount=${totalPrunedCount} retryOk=true persistenceTemporarilyDisabled=false storageBackend=${storageBackend}`, 'ml_runtime_events_quota_recovered', 60_000);
      logRuntimeEventsStorageAudit({
        eventCountBefore,
        eventCountAfter: retryBounded.snapshot.events.length,
        bytesBefore,
        bytesAfter: retryBytes,
        prunedCount: totalPrunedCount,
        storageBackend,
        saveOk: true,
      });
    } catch {
      runtimeEventsPersistenceDisabledUntil = Date.now() + RUNTIME_EVENTS_DISABLE_MS;
      runtimeEventsLastStatus = {
        eventCount: retryBounded.snapshot.events.length,
        bytes: retryBytes,
        storageBackend,
        saveOk: false,
        prunedCount: totalPrunedCount,
        quotaLimited: true,
      };
      logger.throttled('WARN', `ML_RUNTIME_EVENTS_QUOTA_RECOVERY_AUDIT: quotaError=true prunedCount=${totalPrunedCount} retryOk=false persistenceTemporarilyDisabled=true storageBackend=${storageBackend}`, 'ml_runtime_events_quota_disabled', RUNTIME_EVENTS_DISABLE_MS);
      logRuntimeEventsStorageAudit({
        eventCountBefore,
        eventCountAfter: retryBounded.snapshot.events.length,
        bytesBefore,
        bytesAfter: retryBytes,
        prunedCount: totalPrunedCount,
        storageBackend,
        saveOk: false,
      });
    }
  }
}

export function loadMLRuntimeEventsSnapshot(): MLRuntimeEventsSnapshot | null {
  try {
    const json = store.getItem(RUNTIME_EVENTS_KEY);
    if (!json) return null;
    const parsed = JSON.parse(json) as Partial<MLRuntimeEventsSnapshot>;
    if (parsed.version !== 1 || !parsed.counters || !Array.isArray(parsed.events)) {
      logger.warn('ML_RUNTIME_EVENTS_LOAD_FAILED: invalid persisted runtime snapshot');
      return null;
    }
    return {
      version: 1,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      counters: parsed.counters,
      events: pruneRuntimeEventsSnapshot({
        version: 1,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
        counters: parsed.counters,
        events: parsed.events,
      }, RUNTIME_EVENTS_MAX, RUNTIME_EVENTS_MAX_BYTES).snapshot.events,
    };
  } catch (err) {
    logger.warn(`ML_RUNTIME_EVENTS_LOAD_FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function getMLRuntimeEventsStorageStatus() {
  return { ...runtimeEventsLastStatus, maxBytes: RUNTIME_EVENTS_MAX_BYTES, maxEvents: RUNTIME_EVENTS_MAX };
}

export function clearMLRuntimeEventsSnapshot(): void {
  try {
    store.removeItem(RUNTIME_EVENTS_KEY);
    runtimeEventsPersistenceDisabledUntil = 0;
    runtimeEventsLastStatus = {
      eventCount: 0,
      bytes: 0,
      storageBackend: getRuntimeEventsStorageBackend(),
      saveOk: true,
      prunedCount: 0,
      quotaLimited: false,
    };
  } catch (err) {
    logger.warn(`ML_RUNTIME_EVENTS_CLEAR_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pruneRuntimeEventsSnapshot(snapshot: MLRuntimeEventsSnapshot, maxEvents: number, maxBytes: number): { snapshot: MLRuntimeEventsSnapshot; prunedCount: number } {
  const normalized: MLRuntimeEventsSnapshot = {
    ...snapshot,
    events: snapshot.events.slice(-maxEvents),
  };
  let prunedCount = Math.max(0, snapshot.events.length - normalized.events.length);
  let payload = JSON.stringify(normalized);
  while (normalized.events.length > 0 && estimateBytes(payload) > maxBytes) {
    const removeIndex = normalized.events.findIndex(event => !isCriticalRuntimeEvent(event));
    normalized.events.splice(removeIndex >= 0 ? removeIndex : 0, 1);
    prunedCount++;
    payload = JSON.stringify(normalized);
  }
  return { snapshot: normalized, prunedCount };
}

function isCriticalRuntimeEvent(event: MlRuntimeEvent): boolean {
  return event.mode === 'active_guarded' || event.exitTriggered || event.actualDecisionApplied === 'EXIT';
}

function estimateBytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return value.length * 2;
}

function isQuotaError(err: unknown): boolean {
  const anyErr = err as { name?: string; code?: number; message?: string };
  const name = String(anyErr?.name ?? '');
  const message = String(anyErr?.message ?? '');
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || anyErr?.code === 22
    || anyErr?.code === 1014
    || /quota|exceeded/i.test(message);
}

function getRuntimeEventsStorageBackend(): string {
  try {
    if (typeof localStorage !== 'undefined') return 'localStorage';
  } catch {
    // ignored
  }
  return 'memory';
}

function logRuntimeEventsStorageAudit(input: {
  eventCountBefore: number;
  eventCountAfter: number;
  bytesBefore: number;
  bytesAfter: number;
  prunedCount: number;
  storageBackend: string;
  saveOk: boolean;
}): void {
  if (input.prunedCount > 0 || !input.saveOk || input.bytesAfter > Math.floor(RUNTIME_EVENTS_MAX_BYTES * 0.8)) {
    logger.throttled('INFO', `ML_RUNTIME_EVENTS_STORAGE_AUDIT: eventCountBefore=${input.eventCountBefore} eventCountAfter=${input.eventCountAfter} bytesBefore=${input.bytesBefore} bytesAfter=${input.bytesAfter} maxBytes=${RUNTIME_EVENTS_MAX_BYTES} prunedCount=${input.prunedCount} storageBackend=${input.storageBackend} saveOk=${String(input.saveOk)}`, 'ml_runtime_events_storage_audit', 60_000);
  }
}
