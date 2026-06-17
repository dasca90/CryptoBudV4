import type { MLBrainModel, MlRuntimeMode } from '../types';
import { logger } from '../../utils/logger';

const STORAGE_KEY = 'ml_brain';
const RUNTIME_MODE_KEY = 'ml_runtime_mode';

interface InMemoryStoreLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let store: InMemoryStoreLike = createMemoryStore();

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
