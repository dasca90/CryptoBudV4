import type { ScannerCandidate, PlannedCandidate } from '../types';
import { logger } from '../../utils/logger';

export interface BinanceLiveExecutionInput {
  candidate: ScannerCandidate;
  planEntry: PlannedCandidate;
  openSymbols: string[];
  pendingLockSymbols: string[];
  capital: number;
  usedCapital: number;
  maxPositions: number;
  executionAdapter: 'paper_simulated' | 'binance_live';
  apiKeysConfigured: boolean;
  binanceConnected: boolean;
  liveSafetyPassed?: boolean;
  emergencyStopActive?: boolean;
  scannerRunning: boolean;
  groupEnabled: boolean;
}

export interface BinanceLiveExecutionResult {
  attempted: boolean;
  executed: boolean;
  blocked: boolean;
  symbol: string;
  reason: string;
  gateResults: string[];
  stage?: 'PreCheckPassed' | 'ExecutionSubmitted' | 'DemoFillCreated' | 'PaperFillCreated' | 'PositionOpened' | 'ExecutionFailed';
  adapterCalled?: boolean;
  adapterResult?: string;
  positionCreateAttempted?: boolean;
  positionCreated?: boolean;
  openPositionsBefore?: number;
  openPositionsAfter?: number;
}

export function revalidateLiveCandidate(input: BinanceLiveExecutionInput): BinanceLiveExecutionResult {
  const { candidate, planEntry, apiKeysConfigured, binanceConnected, scannerRunning } = input;
  const symbol = candidate.symbol;
  const gateResults: string[] = [];
  const adapter = input.executionAdapter;
  const snapshot = planEntry.gateSnapshot;
  const snapshotValid = !!snapshot && (snapshot.decision === 'ALLOW' || snapshot.decision === 'BLOCK') && Array.isArray(snapshot.blockReasons);
  const audit = (allowed: boolean, failClosed: boolean, reason: string) => {
    logger.info(
      `ENTRY_GATE_SNAPSHOT_CONSUMPTION_AUDIT: symbol=${symbol} adapter=${adapter} snapshotPresent=${String(!!snapshot)} snapshotDecision=${snapshot?.decision ?? 'none'} primaryReason=${snapshot?.primaryReason ?? 'none'} blockReasons=${snapshot?.blockReasons?.join('|') ?? 'none'} consumedBy=BinanceLiveExecutionController allowed=${String(allowed)} failClosed=${String(failClosed)} reason=${reason}`
    );
  };

  if (planEntry.plannedAction !== 'BUY') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Planned action is ${planEntry.plannedAction}, not BUY`, gateResults: ['WRONG_PLANNED_ACTION'] };
  }

  if (!planEntry.entryPlan) {
    logger.warn(`ENTRY_PLAN_MISSING: symbol=${symbol} source=BinanceLiveExecutionController adapterCalled=false`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Missing canonical entry plan', gateResults: ['ENTRY_PLAN_MISSING'], stage: 'ExecutionFailed', adapterCalled: false, adapterResult: 'NOT_SUBMITTED', positionCreateAttempted: false, positionCreated: false };
  }

  if (input.executionAdapter !== 'binance_live') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Execution adapter is not binance_live', gateResults: ['WRONG_EXECUTION_ADAPTER'] };
  }

  if (!apiKeysConfigured) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Binance API keys not configured', gateResults: ['LIVE_API_KEYS_MISSING'] };
  }

  if (!binanceConnected) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Binance connection not established', gateResults: ['LIVE_BINANCE_DISCONNECTED'] };
  }

  if (!scannerRunning) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Scanner not running', gateResults: ['SCANNER_NOT_RUNNING'] };
  }

  if (input.liveSafetyPassed === false) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Live safety check failed', gateResults: ['LIVE_SAFETY_BLOCKED'] };
  }

  if (input.emergencyStopActive === true) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Emergency stop active', gateResults: ['EMERGENCY_STOP_ACTIVE'] };
  }

  if (candidate.status !== 'BUY') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Candidate status is ${candidate.status}, not BUY`, gateResults: ['STATUS_NOT_BUY'] };
  }

  if (!snapshot) {
    audit(false, true, 'ENTRYGATE_SNAPSHOT_MISSING');
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Missing canonical EntryGate snapshot', gateResults: ['ENTRYGATE_SNAPSHOT_MISSING'] };
  }

  if (!snapshotValid) {
    audit(false, true, 'ENTRYGATE_SNAPSHOT_INVALID');
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Invalid canonical EntryGate snapshot', gateResults: ['ENTRYGATE_SNAPSHOT_INVALID'] };
  }

  if (snapshot.decision !== 'ALLOW') {
    const blockReason = snapshot.primaryReason ?? snapshot.blockReasons[0] ?? 'EntryGate BLOCK';
    gateResults.push(`ENTRYGATE_BLOCK:${blockReason}`);
    audit(false, true, `ENTRYGATE_BLOCK:${blockReason}`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: `EntryGate blocked: ${blockReason}`, gateResults };
  }

  gateResults.push('ENTRYGATE_ALLOW');
  audit(true, false, 'ENTRYGATE_ALLOW');

  if (input.openSymbols.includes(symbol)) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Duplicate open position', gateResults: ['DUPLICATE_OPEN_POSITION'] };
  }

  if (input.pendingLockSymbols.includes(symbol)) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Duplicate pending order lock', gateResults: ['DUPLICATE_PENDING_LOCK'] };
  }

  if (input.openSymbols.length >= input.maxPositions) {
    logger.warn(`BUY_BLOCKED_MAX_OPEN_POSITIONS: symbol=${symbol} openCount=${input.openSymbols.length} maxOpenPositions=${input.maxPositions} mode=live`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Max open positions reached (${input.openSymbols.length}/${input.maxPositions})`, gateResults: ['MAX_OPEN_POSITIONS_REACHED'] };
  }

  if (candidate.riskDecision && candidate.riskDecision.verdict !== 'ALLOW') {
    const riskReason = candidate.riskDecision.explanation ?? 'RiskEngine BLOCK';
    gateResults.push(`RISKENGINE_BLOCK:${riskReason}`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: `RiskEngine blocked: ${riskReason}`, gateResults };
  }

  gateResults.push('RISKENGINE_ALLOW');
  gateResults.push('ADAPTER_READINESS_OK');

  return {
    attempted: true,
    executed: false,
    blocked: false,
    symbol,
    reason: 'Pre-check passed',
    gateResults,
    stage: 'PreCheckPassed',
    adapterCalled: false,
    adapterResult: 'NOT_SUBMITTED',
    positionCreateAttempted: false,
    positionCreated: false,
    openPositionsBefore: input.openSymbols.length,
    openPositionsAfter: input.openSymbols.length,
  };
}
