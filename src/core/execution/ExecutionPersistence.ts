import { logger } from '../../utils/logger';
import type { ExecutionRecord, LiveOrderState } from './ExecutionLifecycle';

export interface ExecutionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: ExecutionStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); },
};

function defaultStorage(): ExecutionStorage {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* use deterministic in-memory fallback */ }
  return memoryStorage;
}

export class ExecutionPersistence {
  private readonly key = 'cryptobud_v6:execution_records_v1';
  private readonly records = new Map<string, ExecutionRecord>();

  constructor(private readonly storage: ExecutionStorage = defaultStorage()) {
    this.load();
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(this.key);
      const rows = raw ? JSON.parse(raw) as ExecutionRecord[] : [];
      for (const row of rows) if (row?.clientOrderId) this.records.set(row.clientOrderId, row);
    } catch (error) {
      logger.error(`EXECUTION_PERSISTENCE_LOAD_FAILED severity=CRITICAL reconciliationRequired=true failureReason=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist(): void {
    this.storage.setItem(this.key, JSON.stringify([...this.records.values()]));
  }

  createIntent(input: Omit<ExecutionRecord, 'schemaVersion' | 'createdAt' | 'updatedAt' | 'status' | 'executedQty' | 'remainingQty' | 'avgFillPrice' | 'exchangeOrderId' | 'lastExchangeUpdateAt' | 'positionAccounted' | 'journalAccounted' | 'exitManagementAttached' | 'reconciliationRequired' | 'anomalyCodes' | 'processedEventKeys'>): ExecutionRecord {
    const existing = this.records.get(input.clientOrderId);
    if (existing) throw new Error(`DUPLICATE_CLIENT_ORDER_ID:${input.clientOrderId}`);
    const now = Date.now();
    const record: ExecutionRecord = {
      ...input,
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      status: 'LOCAL_INTENT_CREATED',
      executedQty: 0,
      remainingQty: input.requestedQty,
      avgFillPrice: 0,
      exchangeOrderId: null,
      lastExchangeUpdateAt: null,
      positionAccounted: false,
      journalAccounted: false,
      exitManagementAttached: false,
      reconciliationRequired: false,
      anomalyCodes: [],
      processedEventKeys: [],
    };
    this.records.set(record.clientOrderId, record);
    this.persist();
    logger.info(`LIVE_ORDER_INTENT_CREATED_AUDIT tradeId=${record.tradeId} symbol=${record.symbol} side=${record.side} executionMode=${record.executionMode} executionAdapter=${record.executionAdapter} clientOrderId=${record.clientOrderId} requestedQty=${record.requestedQty} executedQty=0 exchangeStatus=LOCAL_INTENT_CREATED reconciliationRequired=false invariantOk=true`);
    return structuredClone(record);
  }

  update(clientOrderId: string, patch: Partial<ExecutionRecord>, eventKey?: string): { record: ExecutionRecord; duplicate: boolean } {
    const current = this.records.get(clientOrderId);
    if (!current) throw new Error(`EXECUTION_RECORD_NOT_FOUND:${clientOrderId}`);
    if (eventKey && current.processedEventKeys.includes(eventKey)) return { record: structuredClone(current), duplicate: true };
    const next: ExecutionRecord = {
      ...current,
      ...patch,
      clientOrderId: current.clientOrderId,
      tradeId: current.tradeId,
      updatedAt: Date.now(),
      anomalyCodes: [...new Set([...(current.anomalyCodes ?? []), ...(patch.anomalyCodes ?? [])])],
      processedEventKeys: eventKey ? [...current.processedEventKeys, eventKey].slice(-200) : current.processedEventKeys,
    };
    this.records.set(clientOrderId, next);
    this.persist();
    return { record: structuredClone(next), duplicate: false };
  }

  transition(clientOrderId: string, status: LiveOrderState, patch: Partial<ExecutionRecord> = {}, eventKey?: string) {
    return this.update(clientOrderId, { ...patch, status }, eventKey);
  }

  get(clientOrderId: string): ExecutionRecord | undefined {
    const row = this.records.get(clientOrderId);
    return row ? structuredClone(row) : undefined;
  }

  getByTradeId(tradeId: string): ExecutionRecord | undefined {
    const row = [...this.records.values()].find(value => value.tradeId === tradeId);
    return row ? structuredClone(row) : undefined;
  }

  getByExchangeOrderId(exchangeOrderId: string): ExecutionRecord | undefined {
    const row = [...this.records.values()].find(value => value.exchangeOrderId === exchangeOrderId);
    return row ? structuredClone(row) : undefined;
  }

  getAll(): ExecutionRecord[] { return [...this.records.values()].map(row => structuredClone(row)); }

  getUnresolved(): ExecutionRecord[] {
    return this.getAll().filter(row => row.reconciliationRequired
      || row.status === 'SUBMITTING' || row.status === 'NEW' || row.status === 'PARTIALLY_FILLED' || row.status === 'UNKNOWN_AFTER_TIMEOUT'
      || (row.executedQty > 0 && (!row.positionAccounted || !row.journalAccounted || !row.exitManagementAttached)));
  }
}
