import type { ScannerCandidate, PlannedCandidate } from '../types';
import { logger } from '../../utils/logger';
import { getExecutionAdapterDisplay } from '../../lib/execution/executionDisplay';

export interface PaperAutoExecutionInput {
  candidate: ScannerCandidate;
  planEntry: PlannedCandidate;
  openSymbols: string[];
  pendingLockSymbols: string[];
  capital: number;
  usedCapital: number;
  maxPositions: number;
  executionAdapter: 'paper_simulated' | 'binance_live';
  paperAutoEnabled: boolean;
  scannerRunning: boolean;
  groupEnabled: boolean;
}

export interface PaperAutoExecutionResult {
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

export function revalidateCandidate(input: PaperAutoExecutionInput): PaperAutoExecutionResult {
  const { candidate, planEntry, paperAutoEnabled, scannerRunning } = input;
  const symbol = candidate.symbol;
  const gateResults: string[] = [];
  const adapter = input.executionAdapter;
  const snapshot = planEntry.gateSnapshot;
  const snapshotValid = !!snapshot && (snapshot.decision === 'ALLOW' || snapshot.decision === 'BLOCK') && Array.isArray(snapshot.blockReasons);

  const audit = (allowed: boolean, failClosed: boolean, reason: string) => {
    logger.info(
      `ENTRY_GATE_SNAPSHOT_CONSUMPTION_AUDIT: symbol=${symbol} adapter=${getExecutionAdapterDisplay(adapter)} snapshotPresent=${String(!!snapshot)} snapshotDecision=${snapshot?.decision ?? 'none'} primaryReason=${snapshot?.primaryReason ?? 'none'} blockReasons=${snapshot?.blockReasons?.join('|') ?? 'none'} consumedBy=DemoExecutionController allowed=${String(allowed)} failClosed=${String(failClosed)} reason=${reason}`
    );
  };

  if (!paperAutoEnabled) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Demo execution disabled', gateResults: ['DEMO_AUTO_DISABLED'] };
  }

  if (planEntry.plannedAction !== 'BUY') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Planned action is ${planEntry.plannedAction}, not BUY`, gateResults: ['WRONG_PLANNED_ACTION'] };
  }

  if (!planEntry.entryPlan) {
    logger.warn(`ENTRY_PLAN_MISSING: symbol=${symbol} source=DemoExecutionController adapterCalled=false`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Missing canonical entry plan', gateResults: ['ENTRY_PLAN_MISSING'], stage: 'ExecutionFailed', adapterCalled: false, adapterResult: 'NOT_SUBMITTED', positionCreateAttempted: false, positionCreated: false };
  }

  if (input.executionAdapter !== 'paper_simulated') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Execution adapter is not demo_simulated', gateResults: ['WRONG_EXECUTION_ADAPTER'] };
  }

  if (!scannerRunning) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Scanner not running', gateResults: ['SCANNER_NOT_RUNNING'] };
  }

  if (candidate.status !== 'BUY') {
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Candidate status is ${candidate.status}, not BUY`, gateResults: ['STATUS_NOT_BUY'] };
  }

  if (input.openSymbols.includes(symbol)) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Duplicate open position', gateResults: ['DUPLICATE_OPEN_POSITION'] };
  }

  if (input.pendingLockSymbols.includes(symbol)) {
    return { attempted: false, executed: false, blocked: true, symbol, reason: 'Duplicate pending order lock', gateResults: ['DUPLICATE_PENDING_LOCK'] };
  }

  if (input.openSymbols.length >= input.maxPositions) {
    logger.warn(`BUY_BLOCKED_MAX_OPEN_POSITIONS: symbol=${symbol} openCount=${input.openSymbols.length} maxOpenPositions=${input.maxPositions} mode=demo`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: `Max open positions reached (${input.openSymbols.length}/${input.maxPositions})`, gateResults: ['MAX_OPEN_POSITIONS_REACHED'] };
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

  if (candidate.riskDecision && candidate.riskDecision.verdict !== 'ALLOW') {
    const riskReason = candidate.riskDecision.explanation ?? 'RiskEngine BLOCK';
    gateResults.push(`RISKENGINE_BLOCK:${riskReason}`);
    return { attempted: false, executed: false, blocked: true, symbol, reason: `RiskEngine blocked: ${riskReason}`, gateResults };
  }

  gateResults.push('RISKENGINE_ALLOW');
  gateResults.push('ADAPTER_READINESS_OK');
  logger.info(`ENTRY_PLAN_CONSUMED_BY_DEMO_EXECUTION: symbol=${symbol} side=${planEntry.entryPlan.side} price=${planEntry.entryPlan.price} quantity=${planEntry.entryPlan.quantity}`);

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
