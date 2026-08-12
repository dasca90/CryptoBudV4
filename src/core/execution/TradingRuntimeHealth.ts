import { logger } from '../../utils/logger';

export type TradingRuntimeHealthState = 'HEALTHY' | 'DEGRADED' | 'RECONCILIATION_REQUIRED' | 'EXIT_ONLY' | 'HALTED';

export interface TradingRuntimeHealthSnapshot {
  state: TradingRuntimeHealthState;
  newBuysAllowed: boolean;
  exitEngineEnabled: boolean;
  positionMonitoringEnabled: boolean;
  manualCloseAllowed: boolean;
  reasons: string[];
  updatedAt: number;
}

export class TradingRuntimeHealth {
  private snapshot: TradingRuntimeHealthSnapshot = {
    state: 'HEALTHY', newBuysAllowed: true, exitEngineEnabled: true,
    positionMonitoringEnabled: true, manualCloseAllowed: true, reasons: [], updatedAt: Date.now(),
  };

  getSnapshot(): TradingRuntimeHealthSnapshot { return { ...this.snapshot, reasons: [...this.snapshot.reasons] }; }
  canOpenNewBuy(): boolean { return this.snapshot.newBuysAllowed; }

  requireReconciliation(reason: string): void {
    this.snapshot = {
      state: 'RECONCILIATION_REQUIRED', newBuysAllowed: false, exitEngineEnabled: true,
      positionMonitoringEnabled: true, manualCloseAllowed: true,
      reasons: [...new Set([...this.snapshot.reasons, reason])], updatedAt: Date.now(),
    };
    logger.error(`TRADING_RUNTIME_HEALTH_AUDIT severity=CRITICAL runtimeHealth=${this.snapshot.state} newBuysAllowed=false exitEngineEnabled=true positionMonitoringEnabled=true manualCloseAllowed=true reconciliationRequired=true failureReason=${reason}`);
    logger.warn(`NEW_BUYS_SUPPRESSED_RECONCILIATION_AUDIT runtimeHealth=${this.snapshot.state} newBuysAllowed=false exitEngineEnabled=true reason=${reason}`);
    logger.info(`EXIT_ONLY_MODE_AUDIT runtimeHealth=${this.snapshot.state} exitEngineEnabled=true positionMonitoringEnabled=true manualCloseAllowed=true invariantOk=true`);
  }

  markHealthy(): void {
    this.snapshot = {
      state: 'HEALTHY', newBuysAllowed: true, exitEngineEnabled: true,
      positionMonitoringEnabled: true, manualCloseAllowed: true, reasons: [], updatedAt: Date.now(),
    };
    logger.info('TRADING_RUNTIME_HEALTH_AUDIT runtimeHealth=HEALTHY newBuysAllowed=true exitEngineEnabled=true positionMonitoringEnabled=true reconciliationRequired=false invariantOk=true');
  }
}

