import type { TradeRecord } from '../types';
import { logger } from '../../utils/logger';

export type DbStatus = 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING';
let tauriAvailabilityChecked = false;
let tauriAvailable = false;
let tauriUnavailableLogged = false;
let fallbackActive = false;

// ── Runtime detection helpers ──────────────────────

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function hasTauriInternals(): boolean {
  return hasWindow() && !!((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
}

function hasTauriGlobal(): boolean {
  return hasWindow() && !!((window as unknown as Record<string, unknown>).__TAURI__);
}

async function importInvoke(): Promise<((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null> {
  try {
    const mod = await import('@tauri-apps/api/core');
    return typeof mod.invoke === 'function' ? mod.invoke : null;
  } catch {
    return null;
  }
}

// ── Thin wrapper around Tauri invoke ────────────────
// In Tauri mode, lets real errors propagate with original messages.
// In browser mode, returns a descriptive error.

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const fn = await importInvoke();
  if (!fn) throw new Error('Tauri runtime not available');
  try {
    return await fn(cmd, args) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(msg);
  }
}

function toTauriTrade(t: TradeRecord): Record<string, unknown> {
  const trainingEligibleNumeric =
    typeof t.trainingEligible === 'boolean'
      ? (t.trainingEligible ? 1 : 0)
      : (typeof t.trainingEligible === 'number' ? t.trainingEligible : null);
  return {
    id: t.id ?? null,
    trade_id: t.tradeId,
    coin: t.coin,
    mode: t.mode,
    side: t.side,
    adapter: t.adapter,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice ?? null,
    quantity: t.quantity,
    pnl: t.pnl ?? null,
    pnl_percent: t.pnlPercent ?? null,
    pnl_usd: t.pnl ?? null,
    entry_time: t.entryTime,
    exit_time: t.exitTime ?? null,
    status: t.status,
    ml_confidence: t.mlConfidence ?? null,
    prediction: t.prediction ?? null,
    strategy: t.strategy,
    buy_snapshot_json: t.buySnapshot ? JSON.stringify(t.buySnapshot) : null,
    close_snapshot_json: t.closeSnapshot ? JSON.stringify(t.closeSnapshot) : null,
    ml_label_json: t.mlLabel ? JSON.stringify(t.mlLabel) : null,
    ml_quality_json: t.mlQuality ? JSON.stringify(t.mlQuality) : null,
    training_eligible: trainingEligibleNumeric,
    data_quality: t.mlQuality?.dataQuality ?? null,
    ml_use: t.mlQuality?.mlUse ?? null,
  };
}

function fromTauriTrade(r: Record<string, unknown>): TradeRecord {
  const result: TradeRecord = {
    id: r.id as number,
    tradeId: (r.trade_id as string) ?? `trade_legacy_${r.id}`,
    coin: r.coin as string,
    mode: r.mode as TradeRecord['mode'],
    side: r.side as TradeRecord['side'],
    adapter: (r.adapter as string) ?? 'unknown',
    entryPrice: r.entry_price as number,
    exitPrice: r.exit_price as number | undefined,
    quantity: r.quantity as number,
    pnl: r.pnl as number | undefined,
    pnlPercent: r.pnl_percent as number | undefined,
    entryTime: r.entry_time as string,
    exitTime: r.exit_time as string | undefined,
    status: r.status as TradeRecord['status'],
    mlConfidence: r.ml_confidence as number | undefined,
    prediction: r.prediction as string | undefined,
    strategy: r.strategy as string,
  };

  if (r.buy_snapshot_json) {
    try { result.buySnapshot = JSON.parse(r.buy_snapshot_json as string); } catch { /* ignore */ }
  }
  if (r.close_snapshot_json) {
    try { result.closeSnapshot = JSON.parse(r.close_snapshot_json as string); } catch { /* ignore */ }
  }
  if (r.ml_label_json) {
    try { result.mlLabel = JSON.parse(r.ml_label_json as string); } catch { /* ignore */ }
  }
  if (r.ml_quality_json) {
    try { result.mlQuality = JSON.parse(r.ml_quality_json as string); } catch { /* ignore */ }
  }
  result.trainingEligible = typeof r.training_eligible === 'number'
    ? (r.training_eligible as number) > 0
    : undefined;

  return result;
}

// ── Detection with retry ────────────────────────────
//
// Tauri v2 may not have __TAURI_INTERNALS__ ready immediately.
// We retry invoke twice before deciding it's truly unavailable.

let detectionDone = false;
let detectionResult = false;

async function runDetection(): Promise<boolean> {
  // First, try a real invoke
  const fn = await importInvoke();
  if (fn) {
      try {
        await (fn('get_db_path') as Promise<string>);
        return true;
      } catch (invokeErr) {
        // invoke works but command failed — Tauri IS present
        if (hasTauriInternals() || hasTauriGlobal()) return true;
        // Tauri globals may not be available in v2; check if error suggests IPC exists
        const errMsg = invokeErr instanceof Error ? invokeErr.message : String(invokeErr);
        if (errMsg.includes('command') || errMsg.includes('permission') || errMsg.includes('not found')) return true;
        // Fall through to retry
      }
  }

  // Check for Tauri globals as backup signal
  if (hasTauriInternals() || hasTauriGlobal()) return true;

  // No Tauri detected
  return false;
}

async function detectRuntime(): Promise<boolean> {
  if (detectionDone) return detectionResult;

  const first = await runDetection();
  if (first) {
    detectionDone = true;
    detectionResult = true;
    return true;
  }

  // Retry after 500ms — Tauri IPC may not be ready
  await new Promise(r => setTimeout(r, 500));
  const second = await runDetection();
  if (second) {
    detectionDone = true;
    detectionResult = true;
    return true;
  }

  // Retry after 1500ms (cumulative ~2s)
  await new Promise(r => setTimeout(r, 1000));
  const third = await runDetection();
  detectionDone = true;
  detectionResult = third;
  return third;
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await (invoke('get_trade_count') as Promise<number>);
    return true;
  } catch {
    return false;
  }
}

export { detectRuntime };

async function isTauriAvailable(): Promise<boolean> {
  if (tauriAvailabilityChecked) return tauriAvailable;
  try {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    if (typeof tauriInvoke !== 'function') throw new Error('invoke not available');
    await (tauriInvoke('get_db_path') as Promise<string>);
    tauriAvailable = true;
  } catch {
    tauriAvailable = false;
  } finally {
    tauriAvailabilityChecked = true;
  }
  return tauriAvailable;
}

export async function getPersistenceRuntimeState(): Promise<{ tauriAvailabilityChecked: boolean; tauriUnavailableLogged: boolean; fallbackActive: boolean; tauriAvailable: boolean }> {
  await isTauriAvailable();
  return { tauriAvailabilityChecked, tauriUnavailableLogged, fallbackActive, tauriAvailable };
}

export function logFallbackOnce(log: (msg: string) => void): void {
  fallbackActive = true;
  if (!tauriUnavailableLogged) {
    log('PERSISTENCE_FALLBACK_ACTIVE: Tauri runtime unavailable; using in-memory fallback');
    tauriUnavailableLogged = true;
  }
}

export { isTauriAvailable };

export const tauriDb = {
  async saveTrade(trade: TradeRecord): Promise<number> {
    return invoke<number>('save_trade', { trade: toTauriTrade(trade) });
  },

  async saveTradeInsight(payload: {
    symbol: string;
    eventTs: number;
    confidenceBps: number;
    score: number;
    diagnosticTest: boolean;
  }): Promise<void> {
    const fieldTypes = {
      symbol: typeof payload.symbol,
      eventTs: typeof payload.eventTs,
      confidenceBps: typeof payload.confidenceBps,
      score: typeof payload.score,
      diagnosticTest: typeof payload.diagnosticTest,
    };
    const payloadKeys = Object.keys(payload).join('|');
    const timestampFields = 'eventTs';
    const numericFields = 'eventTs|confidenceBps|score';
    const booleanFields = 'diagnosticTest';
    logger.info(`SAVE_TRADE_INSIGHT_PAYLOAD_AUDIT: commandName=save_trade_insight payloadKeys=${payloadKeys} fieldTypes=${JSON.stringify(fieldTypes)} timestampFields=${timestampFields} numericFields=${numericFields} booleanFields=${booleanFields} testMode=${String(payload.diagnosticTest)}`);
    const valid =
      typeof payload.symbol === 'string' &&
      Number.isInteger(payload.eventTs) &&
      Number.isInteger(payload.confidenceBps) &&
      Number.isFinite(payload.score) &&
      typeof payload.diagnosticTest === 'boolean';
    if (!valid) {
      logger.warn(`SAVE_TRADE_INSIGHT_PAYLOAD_VALIDATION_FAILED: commandName=save_trade_insight payloadKeys=${payloadKeys} fieldTypes=${JSON.stringify(fieldTypes)} reason=invalid_payload_shape`);
      throw new Error('save_trade_insight payload type mismatch');
    }
    return invoke<void>('save_trade_insight', {
      insight: {
        symbol: payload.symbol,
        event_ts: payload.eventTs,
        confidence_bps: payload.confidenceBps,
        score: payload.score,
        diagnostic_test: payload.diagnosticTest,
      },
    });
  },

  async getTrades(coin?: string): Promise<TradeRecord[]> {
    const rows = await invoke<Record<string, unknown>[]>('get_trades', coin ? { coin } : {});
    return rows.map(fromTauriTrade);
  },

  async getTradeCount(): Promise<number> {
    return invoke<number>('get_trade_count');
  },

  async clearTrades(): Promise<void> {
    return invoke<void>('clear_trades');
  },

  async updateTrade(trade: TradeRecord): Promise<void> {
    return invoke<void>('update_trade', { trade: toTauriTrade(trade) });
  },

  async getDbPath(): Promise<string> {
    return invoke<string>('get_db_path');
  },

  async saveOpenPosition(tradeId: string, symbol: string, positionJson: string, buySnapshotJson?: string): Promise<void> {
    return invoke<void>('save_open_position', {
      position: {
        trade_id: tradeId,
        symbol,
        position_json: positionJson,
        buy_snapshot_json: buySnapshotJson ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  },

  async getOpenPositions(): Promise<Array<{ trade_id: string; symbol: string; position_json: string; buy_snapshot_json: string | null }>> {
    return invoke<Array<Record<string, unknown>>>('get_open_positions').then(rows =>
      rows.map(r => ({
        trade_id: r.trade_id as string,
        symbol: r.symbol as string,
        position_json: r.position_json as string,
        buy_snapshot_json: r.buy_snapshot_json as string | null,
      }))
    );
  },

  async getOpenPositionCount(): Promise<number> {
    return invoke<number>('get_open_position_count');
  },

  async deleteOpenPosition(tradeId: string): Promise<void> {
    return invoke<void>('delete_open_position', { trade_id: tradeId });
  },

  async clearOpenPositions(): Promise<void> {
    return invoke<void>('clear_open_positions');
  },

  async saveAppState(key: string, valueJson: string): Promise<void> {
    return invoke<void>('save_app_state_entry', { key, valueJson });
  },

  async getAppState(key: string): Promise<string | null> {
    return invoke<string | null>('get_app_state_entry', { key });
  },

  async getAllAppState(): Promise<Array<{ key: string; value_json: string }>> {
    return invoke<Array<Record<string, unknown>>>('get_all_app_state').then(rows =>
      rows.map(r => ({
        key: r.key as string,
        value_json: r.value_json as string,
      }))
    );
  },

  async clearAppStatePrefix(prefix: string): Promise<number> {
    return invoke<number>('clear_app_state_prefix', { prefix });
  },
};

export class InMemoryStore {
  private trades: TradeRecord[] = [];

  async saveTrade(trade: TradeRecord): Promise<void> {
    const idx = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    if (idx >= 0) {
      this.trades[idx] = trade;
    } else {
      this.trades.push(trade);
    }
  }

  async getTrades(coin?: string): Promise<TradeRecord[]> {
    return coin ? this.trades.filter(t => t.coin === coin) : [...this.trades];
  }

  async getTradeCount(): Promise<number> {
    return this.trades.length;
  }

  updateTrade(trade: TradeRecord): void {
    const idx = this.trades.findIndex(t => t.tradeId === trade.tradeId);
    if (idx >= 0) this.trades[idx] = trade;
  }

  clear(): void {
    this.trades = [];
  }
}
