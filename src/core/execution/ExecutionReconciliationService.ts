import type { ExchangeAdapter } from '../exchange/ExchangeAdapter';
import type { Journal } from '../persistence/Journal';
import type { PositionManager } from '../positions/PositionManager';
import { logger } from '../../utils/logger';
import { executionEventKey, normalizeExchangeOrderState, type ExecutionRecord } from './ExecutionLifecycle';
import type { ExecutionPersistence } from './ExecutionPersistence';
import type { TradingRuntimeHealth } from './TradingRuntimeHealth';
import type { OrderResult } from '../types';

export type ReconciliationClassification =
  | 'MATCHED' | 'EXCHANGE_ONLY_POSITION' | 'LOCAL_ONLY_POSITION' | 'QUANTITY_MISMATCH'
  | 'PRICE_MISMATCH' | 'PENDING_ORDER_UNKNOWN' | 'PARTIAL_FILL_PENDING' | 'JOURNAL_MISSING'
  | 'POSITION_MISSING' | 'DUPLICATE_LOCAL_POSITION' | 'DUPLICATE_JOURNAL_TRADE';

export interface ReconciliationIssue {
  classification: ReconciliationClassification;
  clientOrderId: string;
  tradeId: string;
  symbol: string;
  detail: string;
}

function nearlyEqual(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= Math.max(tolerance, Math.max(Math.abs(a), Math.abs(b)) * 1e-10);
}

export class ExecutionReconciliationService {
  private activeReconciliationCount = 0;
  private lastReconciliationDurationMs = 0;
  constructor(
    private readonly executions: ExecutionPersistence,
    private readonly positions: PositionManager,
    private readonly journal: Journal,
    private readonly adapter: ExchangeAdapter,
    private readonly health: TradingRuntimeHealth,
  ) {}

  async reconcilePendingOrders(): Promise<ReconciliationIssue[]> {
    const startedAt = Date.now();
    this.activeReconciliationCount++;
    const issues: ReconciliationIssue[] = [];
    for (const record of this.executions.getUnresolved()) {
      let resolved = record;
      if (this.adapter.getOrder) {
        try {
          const order = await this.adapter.getOrder(record.symbol, record.exchangeOrderId ?? undefined, record.clientOrderId);
          if (order) {
            const executedQty = Math.max(0, order.quantity);
            const status = normalizeExchangeOrderState(order.status, executedQty);
            const key = executionEventKey({ clientOrderId: record.clientOrderId, exchangeOrderId: order.orderId, status, executedQty, avgFillPrice: order.price });
            resolved = this.executions.transition(record.clientOrderId, status, {
              exchangeOrderId: order.orderId || record.exchangeOrderId,
              executedQty,
              remainingQty: Math.max(0, (order.requestedQuantity ?? record.requestedQty) - executedQty),
              avgFillPrice: order.price,
              lastExchangeUpdateAt: order.lastExchangeUpdateAt ?? order.timestamp,
              reconciliationRequired: status === 'UNKNOWN_AFTER_TIMEOUT',
            }, key).record;
          }
        } catch (error) {
          issues.push(this.issue('PENDING_ORDER_UNKNOWN', record, error instanceof Error ? error.message : String(error)));
          continue;
        }
      } else if (record.status === 'UNKNOWN_AFTER_TIMEOUT') {
        issues.push(this.issue('PENDING_ORDER_UNKNOWN', record, 'adapter_order_query_capability_missing'));
        continue;
      }
      resolved = await this.repairLocalAccounting(resolved);
      issues.push(...this.compareLocal(resolved));
    }
    if (issues.length > 0) this.health.requireReconciliation(issues.map(issue => issue.classification).join('|'));
    else if (this.executions.getUnresolved().length === 0) this.health.markHealthy();
    this.activeReconciliationCount = Math.max(0, this.activeReconciliationCount - 1);
    this.lastReconciliationDurationMs = Date.now() - startedAt;
    logger.info(`STARTUP_EXCHANGE_RECONCILIATION_AUDIT executionAdapter=${this.adapter.name} pendingRecords=${this.executions.getUnresolved().length} reconciliationIssues=${issues.length} classifications=${issues.map(i => i.classification).join('|') || 'MATCHED'} newBuysAllowed=${String(issues.length === 0)} exitEngineEnabled=true executionReconciliationDurationMs=${this.lastReconciliationDurationMs} activeReconciliationCount=${this.activeReconciliationCount} invariantOk=${String(issues.length === 0)}`);
    return issues;
  }

  getPerformanceMetrics() { return { executionReconciliationDurationMs: this.lastReconciliationDurationMs, activeReconciliationCount: this.activeReconciliationCount }; }

  async reconcileOrderUpdate(order: OrderResult): Promise<ReconciliationIssue[]> {
    const record = (order.clientOrderId ? this.executions.get(order.clientOrderId) : undefined)
      ?? (order.orderId ? this.executions.getByExchangeOrderId(order.orderId) : undefined);
    if (!record) {
      if (!String(order.clientOrderId ?? '').startsWith('CB6-')) {
        logger.info(`LIVE_ORDER_RECONCILIATION_AUDIT source=private_stream symbol=${order.coin} clientOrderId=${order.clientOrderId ?? 'unknown'} exchangeOrderId=${order.orderId || 'unknown'} action=ignored_non_cryptobud_order runtimeHealthUnchanged=true`);
        return [];
      }
      this.health.requireReconciliation('EXCHANGE_EXECUTION_EVENT_WITHOUT_LOCAL_INTENT');
      logger.error(`LIVE_ORDER_RECONCILIATION_AUDIT severity=CRITICAL symbol=${order.coin} clientOrderId=${order.clientOrderId ?? 'unknown'} exchangeOrderId=${order.orderId || 'unknown'} exchangeStatus=${order.status} executedQty=${order.quantity} reconciliationRequired=true failureReason=EXCHANGE_EXECUTION_EVENT_WITHOUT_LOCAL_INTENT`);
      return [];
    }
    const executedQty = Math.max(0, order.quantity);
    const status = normalizeExchangeOrderState(order.status, executedQty);
    const key = executionEventKey({ clientOrderId: record.clientOrderId, exchangeOrderId: order.orderId, status, executedQty, avgFillPrice: order.price });
    const transitioned = this.executions.transition(record.clientOrderId, status, {
      exchangeOrderId: order.orderId || record.exchangeOrderId,
      executedQty,
      remainingQty: Math.max(0, (order.requestedQuantity ?? record.requestedQty) - executedQty),
      avgFillPrice: order.price,
      lastExchangeUpdateAt: order.lastExchangeUpdateAt ?? order.timestamp,
      reconciliationRequired: status === 'PARTIALLY_FILLED' || status === 'UNKNOWN_AFTER_TIMEOUT',
    }, key);
    const repaired = await this.repairLocalAccounting(transitioned.record);
    const issues = this.compareLocal(repaired);
    if (issues.length > 0) this.health.requireReconciliation(issues.map(issue => issue.classification).join('|'));
    else if (this.executions.getUnresolved().length === 0) this.health.markHealthy();
    logger.info(`LIVE_RECONCILIATION_AUDIT source=private_stream symbol=${order.coin} clientOrderId=${record.clientOrderId} exchangeOrderId=${order.orderId || 'unknown'} duplicateEventDetected=${String(transitioned.duplicate)} exchangeStatus=${status} executedQty=${executedQty} reconciliationIssues=${issues.length} invariantOk=${String(issues.length === 0)}`);
    return issues;
  }

  compareLocal(record: ExecutionRecord): ReconciliationIssue[] {
    const issues: ReconciliationIssue[] = [];
    const position = this.positions.getPositionBySymbol(record.symbol);
    const trades = this.journal.getTrades().filter(trade => trade.tradeId === record.tradeId);
    if (record.side === 'BUY') {
      if (record.executedQty > 0 && !position) issues.push(this.issue('POSITION_MISSING', record, 'exchange_executed_qty_without_local_position'));
      if (record.executedQty === 0 && position?.clientOrderId === record.clientOrderId) issues.push(this.issue('LOCAL_ONLY_POSITION', record, 'local_position_without_exchange_execution'));
      if (position && record.executedQty > 0 && !nearlyEqual(position.quantity, record.executedQty, 1e-12)) issues.push(this.issue('QUANTITY_MISMATCH', record, `exchange=${record.executedQty},local=${position.quantity}`));
      if (position && record.avgFillPrice > 0 && !nearlyEqual(position.avgEntryPrice, record.avgFillPrice, Math.max(1e-12, record.avgFillPrice * 1e-8))) issues.push(this.issue('PRICE_MISMATCH', record, `exchange=${record.avgFillPrice},local=${position.avgEntryPrice}`));
      if (record.executedQty > 0 && trades.length === 0) issues.push(this.issue('JOURNAL_MISSING', record, 'executed_exposure_without_journal_trade'));
    } else if (record.executedQty > 0 && !record.positionAccounted) {
      issues.push(this.issue(position ? 'QUANTITY_MISMATCH' : 'JOURNAL_MISSING', record, position ? `sell_execution_not_yet_applied_to_local_position exchangeSold=${record.executedQty} localRemaining=${position.quantity}` : 'sell_execution_without_close_journal_confirmation'));
    }
    if (trades.length > 1) issues.push(this.issue('DUPLICATE_JOURNAL_TRADE', record, `count=${trades.length}`));
    if (record.status === 'PARTIALLY_FILLED') issues.push(this.issue('PARTIAL_FILL_PENDING', record, `remainingQty=${record.remainingQty}`));
    return issues;
  }

  private async repairLocalAccounting(record: ExecutionRecord): Promise<ExecutionRecord> {
    if (record.executedQty <= 0) return record;
    if (record.side === 'SELL') return record;
    const existingPosition = this.positions.getPositionBySymbol(record.symbol);
    const existingTrade = this.journal.getTrades().find(trade => trade.tradeId === record.tradeId);
    let positionAccounted = !!existingPosition;
    let journalAccounted = !!existingTrade;
    try {
      const positionNeedsCumulativeUpdate = !!existingPosition && (!nearlyEqual(existingPosition.quantity, record.executedQty, 1e-12) || !nearlyEqual(existingPosition.avgEntryPrice, record.avgFillPrice, Math.max(1e-12, record.avgFillPrice * 1e-8)));
      if ((!positionAccounted || positionNeedsCumulativeUpdate) && record.positionSnapshot) {
        this.positions.upsertExecutionPosition(record.symbol, {
          ...record.positionSnapshot,
          quantity: record.executedQty,
          avgEntryPrice: record.avgFillPrice || record.positionSnapshot.avgEntryPrice,
          remainingQuantity: record.remainingQty,
          fillState: record.status === 'FILLED' ? 'FILLED' : 'PARTIALLY_FILLED',
          reconciliationRequired: true,
        });
        positionAccounted = true;
        logger.warn(`EXCHANGE_ONLY_POSITION_AUDIT tradeId=${record.tradeId} symbol=${record.symbol} clientOrderId=${record.clientOrderId} exchangeOrderId=${record.exchangeOrderId ?? 'unknown'} executedQty=${record.executedQty} action=recovered_local_managed_position exitManagementAttached=true invariantOk=true`);
      }
      const journalNeedsCumulativeUpdate = !!existingTrade && (!nearlyEqual(existingTrade.quantity, record.executedQty, 1e-12) || !nearlyEqual(existingTrade.entryPrice, record.avgFillPrice, Math.max(1e-12, record.avgFillPrice * 1e-8)));
      if ((!journalAccounted || journalNeedsCumulativeUpdate) && record.journalTradeSnapshot && typeof (this.journal as any).recordTrade === 'function') {
        await (this.journal as any).recordTrade({ ...record.journalTradeSnapshot, quantity: record.executedQty, entryPrice: record.avgFillPrice || record.journalTradeSnapshot.entryPrice });
        journalAccounted = true;
      }
      if (positionAccounted && journalAccounted) {
        return this.executions.update(record.clientOrderId, {
          positionAccounted: true, journalAccounted: true, exitManagementAttached: true,
          reconciliationRequired: record.status === 'PARTIALLY_FILLED' || record.status === 'UNKNOWN_AFTER_TIMEOUT',
        }).record;
      }
    } catch (error) {
      logger.error(`LIVE_ORDER_RECONCILIATION_AUDIT severity=CRITICAL tradeId=${record.tradeId} symbol=${record.symbol} clientOrderId=${record.clientOrderId} reconciliationRequired=true invariantOk=false failureReason=${error instanceof Error ? error.message : String(error)}`);
    }
    return record;
  }

  private issue(classification: ReconciliationClassification, record: ExecutionRecord, detail: string): ReconciliationIssue {
    const auditName: Partial<Record<ReconciliationClassification, string>> = {
      EXCHANGE_ONLY_POSITION: 'EXCHANGE_ONLY_POSITION_AUDIT', LOCAL_ONLY_POSITION: 'LOCAL_ONLY_POSITION_AUDIT',
      QUANTITY_MISMATCH: 'POSITION_QUANTITY_MISMATCH_AUDIT', PENDING_ORDER_UNKNOWN: 'PENDING_ORDER_RECOVERY_AUDIT',
      POSITION_MISSING: 'EXCHANGE_FILL_POSITION_PERSISTENCE_AUDIT', JOURNAL_MISSING: 'EXCHANGE_FILL_JOURNAL_PERSISTENCE_AUDIT',
    };
    logger.error(`${auditName[classification] ?? 'LIVE_ORDER_RECONCILIATION_AUDIT'} severity=CRITICAL tradeId=${record.tradeId} symbol=${record.symbol} side=${record.side} executionAdapter=${record.executionAdapter} clientOrderId=${record.clientOrderId} exchangeOrderId=${record.exchangeOrderId ?? 'unknown'} requestedQty=${record.requestedQty} executedQty=${record.executedQty} remainingQty=${record.remainingQty} exchangeAvgFillPrice=${record.avgFillPrice} exchangeStatus=${record.status} localPositionExists=${String(!!this.positions.getPositionBySymbol(record.symbol))} journalTradeExists=${String(this.journal.getTrades().some(t => t.tradeId === record.tradeId))} reconciliationRequired=true runtimeHealth=RECONCILIATION_REQUIRED newBuysAllowed=false exitEngineEnabled=true invariantOk=false failureReason=${classification}:${detail}`);
    return { classification, clientOrderId: record.clientOrderId, tradeId: record.tradeId, symbol: record.symbol, detail };
  }
}
