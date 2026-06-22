export type EquityDisplayAuditInput = {
  configuredCapital: number;
  availableCapital: number;
  usedCapital: number;
  openPositionExposure: number;
  realizedPnL: number;
  unrealizedPnL: number;
  equityDisplayValue: number;
  equitySource: string;
  persistenceHydrated: boolean;
  positionManagerOpenCount: number;
  storeOpenCount: number;
  mode: "PAPER" | "LIVE_LOCKED" | string;
};

export type EquityDisplayAudit = EquityDisplayAuditInput & {
  mismatchDetected: boolean;
  zeroWithActiveRuntime: boolean;
};

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

export function buildEquityDisplayAudit(input: EquityDisplayAuditInput): EquityDisplayAudit {
  const configuredCapital = finite(input.configuredCapital);
  const availableCapital = finite(input.availableCapital);
  const usedCapital = finite(input.usedCapital);
  const openPositionExposure = finite(input.openPositionExposure);
  const realizedPnL = finite(input.realizedPnL);
  const unrealizedPnL = finite(input.unrealizedPnL);
  const equityDisplayValue = finite(input.equityDisplayValue);
  const activeDemoRuntime = input.mode === "PAPER" && (configuredCapital > 0 || input.positionManagerOpenCount > 0 || input.storeOpenCount > 0);
  const zeroWithActiveRuntime = equityDisplayValue <= 0 && activeDemoRuntime;
  const openCountMismatch = input.positionManagerOpenCount !== input.storeOpenCount;
  const exposureMismatch = input.positionManagerOpenCount > 0 && openPositionExposure <= 0;

  return {
    ...input,
    configuredCapital,
    availableCapital,
    usedCapital,
    openPositionExposure,
    realizedPnL,
    unrealizedPnL,
    equityDisplayValue,
    mismatchDetected: zeroWithActiveRuntime || openCountMismatch || exposureMismatch,
    zeroWithActiveRuntime,
  };
}

export function formatEquityDisplaySourceAudit(audit: EquityDisplayAudit): string {
  return `EQUITY_DISPLAY_SOURCE_AUDIT: configuredCapital=${audit.configuredCapital.toFixed(2)} availableCapital=${audit.availableCapital.toFixed(2)} usedCapital=${audit.usedCapital.toFixed(4)} openPositionExposure=${audit.openPositionExposure.toFixed(4)} realizedPnL=${audit.realizedPnL.toFixed(2)} unrealizedPnL=${audit.unrealizedPnL.toFixed(2)} equityDisplayValue=${audit.equityDisplayValue.toFixed(2)} equitySource=${audit.equitySource} persistenceHydrated=${String(audit.persistenceHydrated)} positionManagerOpenCount=${audit.positionManagerOpenCount} storeOpenCount=${audit.storeOpenCount} mismatchDetected=${String(audit.mismatchDetected)}`;
}

export function formatEquityZeroWithActiveRuntimeWarning(audit: EquityDisplayAudit): string {
  return `EQUITY_ZERO_WITH_ACTIVE_RUNTIME_WARNING: configuredCapital=${audit.configuredCapital.toFixed(2)} openPositionExposure=${audit.openPositionExposure.toFixed(4)} positionManagerOpenCount=${audit.positionManagerOpenCount} storeOpenCount=${audit.storeOpenCount} equityDisplayValue=${audit.equityDisplayValue.toFixed(2)} equitySource=${audit.equitySource} persistenceHydrated=${String(audit.persistenceHydrated)} reason=zero_equity_with_configured_capital_or_open_positions`;
}

export type PaperBalancePositionIntegrityInput = {
  executionMode: 'DEMO' | 'LIVE' | string;
  dbStatus: string;
  uiHeaderEquity: number;
  paperCashBalance: number;
  paperEquity: number;
  configuredDemoStartingCapital: number;
  configuredTradingCapital: number;
  openPositionsCount: number;
  openPositionsMarketValue: number;
  positionManagerEquity: number;
  persistenceBalanceLoaded: boolean;
  persistenceSource: string;
  resetStateActive: boolean;
  resetVersion: string | number;
  resetAt: string;
  balanceInitializedFromConfig: boolean;
  intentionalZeroBalance?: boolean;
};

export type PaperBalancePositionIntegrityAudit = PaperBalancePositionIntegrityInput & {
  invariantOk: boolean;
  failureReason: string;
  intentionalZeroBalance: boolean;
};

export function buildPaperBalancePositionIntegrityAudit(input: PaperBalancePositionIntegrityInput): PaperBalancePositionIntegrityAudit {
  const configuredDemoStartingCapital = finite(input.configuredDemoStartingCapital);
  const configuredTradingCapital = finite(input.configuredTradingCapital);
  const uiHeaderEquity = finite(input.uiHeaderEquity);
  const paperCashBalance = finite(input.paperCashBalance);
  const paperEquity = finite(input.paperEquity);
  const openPositionsMarketValue = finite(input.openPositionsMarketValue);
  const positionManagerEquity = finite(input.positionManagerEquity);
  const intentionalZeroBalance = input.intentionalZeroBalance === true
    || (configuredDemoStartingCapital === 0 && configuredTradingCapital === 0 && paperCashBalance === 0 && paperEquity === 0 && input.openPositionsCount === 0);
  const demoDbOk = String(input.executionMode).toUpperCase() === 'DEMO' && String(input.dbStatus).toUpperCase() === 'OK';
  const zeroWithConfiguredCapital = demoDbOk
    && input.openPositionsCount === 0
    && uiHeaderEquity === 0
    && configuredDemoStartingCapital > 0
    && !input.balanceInitializedFromConfig;
  const equityMismatch = demoDbOk
    && input.openPositionsCount === 0
    && Math.abs(uiHeaderEquity - paperEquity) > 0.0001;
  const invariantOk = intentionalZeroBalance || (!zeroWithConfiguredCapital && !equityMismatch);
  const failureReason = invariantOk
    ? 'none'
    : zeroWithConfiguredCapital
      ? 'DEMO_EQUITY_ZERO_WITH_CONFIGURED_CAPITAL'
      : 'UI_HEADER_EQUITY_MISMATCHES_PAPER_EQUITY';

  return {
    ...input,
    configuredDemoStartingCapital,
    configuredTradingCapital,
    uiHeaderEquity,
    paperCashBalance,
    paperEquity,
    openPositionsMarketValue,
    positionManagerEquity,
    intentionalZeroBalance,
    invariantOk,
    failureReason,
  };
}

export function formatPaperBalancePositionIntegrityAudit(audit: PaperBalancePositionIntegrityAudit): string {
  return `PAPER_BALANCE_POSITION_INTEGRITY_AUDIT: executionMode=${audit.executionMode} dbStatus=${audit.dbStatus} uiHeaderEquity=${audit.uiHeaderEquity} paperCashBalance=${audit.paperCashBalance} paperEquity=${audit.paperEquity} configuredDemoStartingCapital=${audit.configuredDemoStartingCapital} configuredTradingCapital=${audit.configuredTradingCapital} openPositionsCount=${audit.openPositionsCount} openPositionsMarketValue=${audit.openPositionsMarketValue} positionManagerEquity=${audit.positionManagerEquity} persistenceBalanceLoaded=${String(audit.persistenceBalanceLoaded)} persistenceSource=${audit.persistenceSource} resetStateActive=${String(audit.resetStateActive)} resetVersion=${audit.resetVersion} resetAt=${audit.resetAt} balanceInitializedFromConfig=${String(audit.balanceInitializedFromConfig)} intentionalZeroBalance=${String(audit.intentionalZeroBalance)} invariantOk=${String(audit.invariantOk)} failureReason=${audit.failureReason}`;
}
