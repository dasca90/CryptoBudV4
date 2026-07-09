import type { ScannerCandidate } from '../types';
import { buildStrategyAuditSnapshotFromCandidate } from '../strategy-audit/strategy-audit-builder';
import { logger } from '../../utils/logger';
import { resolveFinalNoBuyReasonPriority } from './finalNoBuyReasonPriority';

export type FinalNoBuyReason =
  | 'PRICE_STALE'
  | 'BOOK_STALE'
  | 'REBOUND_STALE'
  | 'SPREAD_TOO_HIGH'
  | 'TP_ROOM_NOT_OK'
  | 'CAPITAL_LIMIT'
  | 'MAX_OPEN_POSITIONS_REACHED'
  | 'MAX_GROUP_POSITIONS_REACHED'
  | 'MAX_GROUP_EXPOSURE_REACHED'
  | 'DUPLICATE_OPEN_POSITION'
  | 'PENDING_ORDER_EXISTS'
  | 'BANNED_SYMBOL'
  | 'BUY_SPACING_30S_ACTIVE'
  | 'AUTO_EXECUTION_DISABLED'
  | 'MISSING_RISK_GROUP'
  | 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
  | 'DIP_NOT_CONFIRMED'
  | 'LOWER_RANK_THAN_SELECTED'
  | 'NOT_SELECTED_THIS_CYCLE'
  | 'ADAPTER_REJECTED'
  | 'POSITION_PERSISTENCE_FAILED'
  | 'UNKNOWN_EXECUTION_SELECTION_BUG'
  | 'none';

export type FinalDecision = 'EXECUTE' | 'SKIP' | 'BLOCKED' | 'PENDING';

export interface ReasonPriorityTrace {
  reason: string;
  passed: boolean;
  detail: string;
}

export interface ExecutionDecisionParams {
  symbol: string;
  scanId: string;
  candidateRank: number;
  status: string;
  finalExecutable: boolean;
  buyAllowed: boolean;
  setupResult: string;
  finalExecutionStrategy: string;
  riskGroup: string;
  groupName: string;
  groupRecommendedStrategy: string;
  groupOpenCount: number;
  groupMaxOpen: number;
  groupExposure: number;
  groupMaxExposure: number;
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  capitalOk: boolean;
  maxOpenPositionsOk: boolean;
  maxGroupPositionsOk: boolean;
  maxGroupExposureOk: boolean;
  duplicateOpenPosition: boolean;
  pendingOrderExists: boolean;
  banned: boolean;
  buySpacingOk: boolean;
  runtimeExecutionEnabled: boolean;
  primaryBlocker?: string | null;
  blockReasons?: string[];
  candidateWhy?: string | null;
  previousFinalNoBuyReason?: string | null;
  entryGateBlocker?: string | null;
  strategyContractBlocker?: string | null;
  runtimeReason?: string | null;
  handoffMismatch?: boolean | null;
}

export interface ExecutionDecision {
  symbol: string;
  scanId: string;
  candidateRank: number;
  finalExecutable: boolean;
  buyAllowed: boolean;
  setupResult: string;
  finalExecutionStrategy: string;
  riskGroup: string;
  groupName: string;
  groupRecommendedStrategy: string;
  groupOpenCount: number;
  groupMaxOpen: number;
  groupExposure: number;
  groupMaxExposure: number;
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  tpRoomOk: boolean;
  capitalOk: boolean;
  maxOpenPositionsOk: boolean;
  maxGroupPositionsOk: boolean;
  maxGroupExposureOk: boolean;
  duplicateOpenPosition: boolean;
  pendingOrderExists: boolean;
  banned: boolean;
  buySpacingOk: boolean;
  runtimeExecutionEnabled: boolean;
  selectedForExecution: boolean;
  submitAttempted: boolean;
  adapterCalled: boolean;
  adapterAccepted: boolean;
  adapterResult: string;
  orderFilled: boolean;
  positionCreated: boolean;
  journalPersisted: boolean;
  telegramSent: boolean;
  finalDecision: FinalDecision;
  finalNoBuyReason: string;
  finalNoBuyReasonCode: string;
  finalNoBuyReasonLabel: string;
  actionableNoBuyReason: string;
  technicalNoBuyReason: string;
  secondaryDiagnosticReasons: string[];
  renderedUserMessage: string;
  finalNoBuyReasonSource: string;
  reasonPriorityTrace: ReasonPriorityTrace[];
  invariantOk: boolean;
}

export function resolveExecutionDecision(params: ExecutionDecisionParams): ExecutionDecision {
  const trace: ReasonPriorityTrace[] = [];
  let finalNoBuyReason: FinalNoBuyReason = 'none';
  let finalNoBuyReasonSource = '';

  const addTrace = (reason: string, passed: boolean, detail: string) => {
    trace.push({ reason, passed, detail });
  };

  if (!params.runtimeExecutionEnabled) {
    finalNoBuyReason = 'AUTO_EXECUTION_DISABLED';
    finalNoBuyReasonSource = 'runtimeExecutionEnabled=false';
    addTrace('AUTO_EXECUTION_DISABLED', false, 'Runtime execution disabled');
  } else if (!params.riskGroup || params.riskGroup === 'unknown' || params.riskGroup === 'n/a') {
    finalNoBuyReason = 'MISSING_RISK_GROUP';
    finalNoBuyReasonSource = 'riskGroup missing';
    addTrace('MISSING_RISK_GROUP', false, `riskGroup=${params.riskGroup}`);
  } else if (params.banned) {
    finalNoBuyReason = 'BANNED_SYMBOL';
    finalNoBuyReasonSource = 'banned=true';
    addTrace('BANNED_SYMBOL', false, 'Symbol is banned');
  } else if (params.duplicateOpenPosition) {
    finalNoBuyReason = 'DUPLICATE_OPEN_POSITION';
    finalNoBuyReasonSource = 'duplicateOpenPosition=true';
    addTrace('DUPLICATE_OPEN_POSITION', false, 'Duplicate open position');
  } else if (params.pendingOrderExists) {
    finalNoBuyReason = 'PENDING_ORDER_EXISTS';
    finalNoBuyReasonSource = 'pendingOrderExists=true';
    addTrace('PENDING_ORDER_EXISTS', false, 'Pending order exists');
  } else if (!params.maxOpenPositionsOk) {
    finalNoBuyReason = 'MAX_OPEN_POSITIONS_REACHED';
    finalNoBuyReasonSource = 'maxOpenPositionsOk=false';
    addTrace('MAX_OPEN_POSITIONS_REACHED', false, `maxOpenPositionsOk=false openCount=${params.groupOpenCount} maxOpen=${params.groupMaxOpen}`);
  } else if (!params.maxGroupPositionsOk) {
    finalNoBuyReason = 'MAX_GROUP_POSITIONS_REACHED';
    finalNoBuyReasonSource = 'maxGroupPositionsOk=false';
    addTrace('MAX_GROUP_POSITIONS_REACHED', false, `groupOpenCount=${params.groupOpenCount} groupMaxOpen=${params.groupMaxOpen}`);
  } else if (!params.maxGroupExposureOk) {
    finalNoBuyReason = 'MAX_GROUP_EXPOSURE_REACHED';
    finalNoBuyReasonSource = 'maxGroupExposureOk=false';
    addTrace('MAX_GROUP_EXPOSURE_REACHED', false, `groupExposure=${params.groupExposure} groupMaxExposure=${params.groupMaxExposure}`);
  } else if (!params.capitalOk) {
    finalNoBuyReason = 'CAPITAL_LIMIT';
    finalNoBuyReasonSource = 'capitalOk=false';
    addTrace('CAPITAL_LIMIT', false, 'Capital limit reached');
  } else if (!params.buySpacingOk) {
    finalNoBuyReason = 'BUY_SPACING_30S_ACTIVE';
    finalNoBuyReasonSource = 'buySpacingOk=false';
    addTrace('BUY_SPACING_30S_ACTIVE', false, 'Buy spacing 30s active');
  } else if (!params.priceFresh && params.bookFresh === false) {
    finalNoBuyReason = 'BOOK_STALE';
    finalNoBuyReasonSource = 'priceFresh=false;bookFresh=false';
    addTrace('PRICE_NOT_FRESH / BOOK_STALE', false, 'Price and book are stale');
  } else if (!params.priceFresh) {
    finalNoBuyReason = 'PRICE_STALE';
    finalNoBuyReasonSource = 'priceFresh=false';
    addTrace('PRICE_STALE', false, 'Price is stale');
  } else if (params.bookFresh === false) {
    finalNoBuyReason = 'BOOK_STALE';
    finalNoBuyReasonSource = 'bookFresh=false';
    addTrace('BOOK_STALE', false, 'Book is stale');
  } else if (!params.spreadOk) {
    finalNoBuyReason = 'SPREAD_TOO_HIGH';
    finalNoBuyReasonSource = 'spreadOk=false';
    addTrace('SPREAD_TOO_HIGH', false, 'Spread too high');
  } else if (!params.tpRoomOk) {
    finalNoBuyReason = 'TP_ROOM_NOT_OK';
    finalNoBuyReasonSource = 'tpRoomOk=false';
    addTrace('TP_ROOM_NOT_OK', false, 'TP room not OK');
  } else if (!params.finalExecutable || !params.buyAllowed) {
    finalNoBuyReason = 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
    finalNoBuyReasonSource = 'finalExecutable/buyAllowed false';
    addTrace('STRATEGY_HANDOFF_INTEGRITY_FAILED', false, `finalExecutable=${params.finalExecutable} buyAllowed=${params.buyAllowed}`);
  } else {
    finalNoBuyReason = 'none';
    finalNoBuyReasonSource = 'all_checks_passed';
    addTrace('ALL_CHECKS_PASSED', true, 'All execution gates passed');
  }

  const previousExecutionDecisionFinalNoBuyReason = finalNoBuyReason;
  const canonicalExecutableForReasonPriority = params.finalExecutable && params.buyAllowed && previousExecutionDecisionFinalNoBuyReason === 'none';
  const previousFinalNoBuyReasonForPriority = canonicalExecutableForReasonPriority
    ? 'none'
    : params.previousFinalNoBuyReason ?? previousExecutionDecisionFinalNoBuyReason;
  const priority = resolveFinalNoBuyReasonPriority({
    symbol: params.symbol,
    rawStatus: params.status,
    displayStatus: params.status,
    finalExecutable: canonicalExecutableForReasonPriority,
    buyAllowed: canonicalExecutableForReasonPriority,
    primaryBlocker: params.primaryBlocker,
    setupResult: params.setupResult,
    candidateWhy: params.candidateWhy,
    previousFinalNoBuyReason: previousFinalNoBuyReasonForPriority,
    blockReasons: params.blockReasons,
    entryGateBlocker: params.entryGateBlocker,
    strategyContractBlocker: params.strategyContractBlocker,
    executionDecisionFinalNoBuyReason: previousExecutionDecisionFinalNoBuyReason,
    runtimeReason: params.runtimeReason,
    handoffMismatch: params.handoffMismatch,
  });
  finalNoBuyReason = priority.finalNoBuyReasonCode as FinalNoBuyReason;
  finalNoBuyReasonSource = priority.prioritySource;
  const finalNoBuyReasonCode = priority.finalNoBuyReasonCode;
  const finalNoBuyReasonLabel = !params.priceFresh && params.bookFresh === false && finalNoBuyReasonCode === 'BOOK_STALE'
    ? 'PRICE_NOT_FRESH / BOOK_STALE'
    : priority.finalNoBuyReasonLabel;
  const reasonPriorityInvariantOk = finalNoBuyReason === finalNoBuyReasonCode;
  logger.info(
    `EXECUTION_DECISION_REASON_PRIORITY_AUDIT: ` +
    `symbol=${params.symbol} ` +
    `scanId=${params.scanId} ` +
    `candidateStatus=${params.status} ` +
    `displayStatus=${params.status} ` +
    `finalExecutable=${String(params.finalExecutable)} ` +
    `buyAllowed=${String(params.buyAllowed)} ` +
    `primaryBlocker=${params.primaryBlocker ?? 'none'} ` +
    `setupResult=${params.setupResult ?? 'none'} ` +
    `previousExecutionDecisionFinalNoBuyReason=${previousExecutionDecisionFinalNoBuyReason} ` +
    `finalNoBuyReasonCode=${finalNoBuyReasonCode} ` +
    `finalNoBuyReasonLabel=${finalNoBuyReasonLabel} ` +
    `resolvedFinalNoBuyReason=${priority.resolvedFinalNoBuyReason} ` +
    `actionableNoBuyReason=${priority.actionableNoBuyReason} ` +
    `technicalNoBuyReason=${priority.technicalNoBuyReason} ` +
    `secondaryDiagnosticReasons=${priority.secondaryDiagnosticReasons.join('|') || 'none'} ` +
    `prioritySource=${priority.prioritySource} ` +
    `executionDecisionFinalNoBuyReason=${finalNoBuyReasonCode} ` +
    `invariantOk=${String(reasonPriorityInvariantOk && priority.invariantOk)} ` +
    `failureReason=${reasonPriorityInvariantOk ? priority.failureReason : 'EXECUTION_DECISION_REASON_NOT_CANONICAL'}`
  );

  const generateFinalDecision = (): FinalDecision => {
    if (finalNoBuyReason === 'none') return 'EXECUTE';
    return 'SKIP';
  };

  const finalDecision = generateFinalDecision();

  const invariantOk = (() => {
    if (finalNoBuyReason === 'MAX_OPEN_POSITIONS_REACHED' && params.maxOpenPositionsOk) {
      logger.error(`EXECUTION_REASON_INTEGRITY_FAILED: symbol=${params.symbol} finalNoBuyReason=MAX_OPEN_POSITIONS_REACHED maxOpenPositionsOk=true openCount=${params.groupOpenCount} maxOpen=${params.groupMaxOpen} — invariant violation, using real blocker`);
      return false;
    }
    if (finalNoBuyReason !== 'none' && finalDecision === 'EXECUTE') {
      logger.error(`EXECUTION_REASON_INTEGRITY_FAILED: symbol=${params.symbol} finalNoBuyReason=${finalNoBuyReason} but finalDecision=EXECUTE — contradiction`);
      return false;
    }
    return true;
  })();

  if (!invariantOk && finalNoBuyReason === 'MAX_OPEN_POSITIONS_REACHED' && params.maxOpenPositionsOk) {
    const fallbackReason = !params.priceFresh && params.bookFresh === false ? 'BOOK_STALE'
      : !params.priceFresh ? 'PRICE_STALE'
      : params.bookFresh === false ? 'BOOK_STALE'
      : !params.spreadOk ? 'SPREAD_TOO_HIGH'
      : !params.tpRoomOk ? 'TP_ROOM_NOT_OK'
      : !params.capitalOk ? 'CAPITAL_LIMIT'
      : 'UNKNOWN_EXECUTION_SELECTION_BUG';
    finalNoBuyReason = fallbackReason;
    finalNoBuyReasonSource = `invariant_fallback_from_MAX_OPEN_POSITIONS_REACHED:${fallbackReason}`;
  }

  const selfConsistencyFailure = finalNoBuyReason !== 'none' && canonicalExecutableForReasonPriority
    ? 'FINAL_NO_BUY_WITH_EXECUTABLE_TRUE'
    : 'none';
  const selfConsistentFinalExecutable = finalNoBuyReason === 'none' ? params.finalExecutable : false;
  const selfConsistentBuyAllowed = finalNoBuyReason === 'none' ? params.buyAllowed : false;
  const selfConsistencyOk = selfConsistencyFailure === 'none';
  logger.info(`EXECUTION_DECISION_SELF_CONSISTENCY_AUDIT: symbol=${params.symbol} scanId=${params.scanId} finalExecutable=${String(selfConsistentFinalExecutable)} buyAllowed=${String(selfConsistentBuyAllowed)} finalNoBuyReasonCode=${finalNoBuyReasonCode} finalNoBuyReasonLabel=${finalNoBuyReasonLabel} finalNoBuyReason=${finalNoBuyReason} selectedForExecution=false submitAttempted=false adapterCalled=false invariantOk=${String(selfConsistencyOk)} failureReason=${selfConsistencyFailure}`);

  return {
    symbol: params.symbol,
    scanId: params.scanId,
    candidateRank: params.candidateRank,
    finalExecutable: selfConsistentFinalExecutable,
    buyAllowed: selfConsistentBuyAllowed,
    setupResult: params.setupResult,
    finalExecutionStrategy: params.finalExecutionStrategy,
    riskGroup: params.riskGroup,
    groupName: params.groupName,
    groupRecommendedStrategy: params.groupRecommendedStrategy,
    groupOpenCount: params.groupOpenCount,
    groupMaxOpen: params.groupMaxOpen,
    groupExposure: params.groupExposure,
    groupMaxExposure: params.groupMaxExposure,
    priceFresh: params.priceFresh,
    bookFresh: params.bookFresh,
    spreadOk: params.spreadOk,
    tpRoomOk: params.tpRoomOk,
    capitalOk: params.capitalOk,
    maxOpenPositionsOk: params.maxOpenPositionsOk,
    maxGroupPositionsOk: params.maxGroupPositionsOk,
    maxGroupExposureOk: params.maxGroupExposureOk,
    duplicateOpenPosition: params.duplicateOpenPosition,
    pendingOrderExists: params.pendingOrderExists,
    banned: params.banned,
    buySpacingOk: params.buySpacingOk,
    runtimeExecutionEnabled: params.runtimeExecutionEnabled,
    selectedForExecution: false,
    submitAttempted: false,
    adapterCalled: false,
    adapterAccepted: false,
    adapterResult: '',
    orderFilled: false,
    positionCreated: false,
    journalPersisted: false,
    telegramSent: false,
    finalDecision,
    finalNoBuyReason,
    finalNoBuyReasonCode,
    finalNoBuyReasonLabel,
    actionableNoBuyReason: priority.actionableNoBuyReason,
    technicalNoBuyReason: priority.technicalNoBuyReason,
    secondaryDiagnosticReasons: priority.secondaryDiagnosticReasons,
    renderedUserMessage: priority.renderedUserMessage,
    finalNoBuyReasonSource,
    reasonPriorityTrace: trace,
    invariantOk: invariantOk && reasonPriorityInvariantOk && priority.invariantOk,
  };
}

export function emitCanonicalExecutionDecisionAudit(decision: ExecutionDecision): void {
  logger.info(
    `CANONICAL_EXECUTION_DECISION_AUDIT: ` +
    `symbol=${decision.symbol} ` +
    `scanId=${decision.scanId} ` +
    `rank=${decision.candidateRank} ` +
    `finalExecutable=${String(decision.finalExecutable)} ` +
    `buyAllowed=${String(decision.buyAllowed)} ` +
    `setupResult=${decision.setupResult} ` +
    `finalExecutionStrategy=${decision.finalExecutionStrategy} ` +
    `riskGroup=${decision.riskGroup} ` +
    `groupName=${decision.groupName} ` +
    `groupOpenCount=${decision.groupOpenCount} ` +
    `groupMaxOpen=${decision.groupMaxOpen} ` +
    `groupExposure=${decision.groupExposure} ` +
    `groupMaxExposure=${decision.groupMaxExposure} ` +
    `priceFresh=${String(decision.priceFresh)} ` +
    `bookFresh=${String(decision.bookFresh)} ` +
    `spreadOk=${String(decision.spreadOk)} ` +
    `tpRoomOk=${String(decision.tpRoomOk)} ` +
    `capitalOk=${String(decision.capitalOk)} ` +
    `maxOpenPositionsOk=${String(decision.maxOpenPositionsOk)} ` +
    `maxGroupPositionsOk=${String(decision.maxGroupPositionsOk)} ` +
    `maxGroupExposureOk=${String(decision.maxGroupExposureOk)} ` +
    `duplicateOpenPosition=${String(decision.duplicateOpenPosition)} ` +
    `pendingOrderExists=${String(decision.pendingOrderExists)} ` +
    `buySpacingOk=${String(decision.buySpacingOk)} ` +
    `runtimeExecutionEnabled=${String(decision.runtimeExecutionEnabled)} ` +
    `selectedForExecution=${String(decision.selectedForExecution)} ` +
    `submitAttempted=${String(decision.submitAttempted)} ` +
    `adapterCalled=${String(decision.adapterCalled)} ` +
    `adapterAccepted=${String(decision.adapterAccepted)} ` +
    `orderFilled=${String(decision.orderFilled)} ` +
    `positionCreated=${String(decision.positionCreated)} ` +
    `journalPersisted=${String(decision.journalPersisted)} ` +
    `telegramSent=${String(decision.telegramSent)} ` +
    `finalDecision=${decision.finalDecision} ` +
    `finalNoBuyReasonCode=${decision.finalNoBuyReasonCode} ` +
    `finalNoBuyReasonLabel=${decision.finalNoBuyReasonLabel} ` +
    `finalNoBuyReason=${decision.finalNoBuyReason} ` +
    `actionableNoBuyReason=${decision.actionableNoBuyReason} ` +
    `technicalNoBuyReason=${decision.technicalNoBuyReason} ` +
    `secondaryDiagnosticReasons=${decision.secondaryDiagnosticReasons.join('|') || 'none'} ` +
    `renderedUserMessage=${decision.renderedUserMessage} ` +
    `finalNoBuyReasonSource=${decision.finalNoBuyReasonSource} ` +
    `reasonPriorityTrace=${decision.reasonPriorityTrace.map(t => `${t.reason}:${t.passed}`).join('|')} ` +
    `invariantOk=${String(decision.invariantOk)}`
  );
}

export function emitExecutionPipelineStageAudit(decision: ExecutionDecision): void {
  logger.info(
    `EXECUTION_PIPELINE_STAGE_AUDIT: ` +
    `symbol=${decision.symbol} ` +
    `selectedForExecution=${String(decision.selectedForExecution)} ` +
    `submitAttempted=${String(decision.submitAttempted)} ` +
    `adapterCalled=${String(decision.adapterCalled)} ` +
    `adapterAccepted=${String(decision.adapterAccepted)} ` +
    `adapterResult=${decision.adapterResult || 'none'} ` +
    `orderFilled=${String(decision.orderFilled)} ` +
    `positionCreated=${String(decision.positionCreated)} ` +
    `journalPersisted=${String(decision.journalPersisted)} ` +
    `telegramSent=${String(decision.telegramSent)} ` +
    `finalStatus=${decision.finalDecision} ` +
    `failureReason=${decision.finalNoBuyReason !== 'none' ? decision.finalNoBuyReason : 'none'}`
  );
}
