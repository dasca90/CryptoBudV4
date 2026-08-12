import { evaluatePostTradeReentry } from '../trading/PostTradeReentryGate';
import type { ScannerCandidate } from '../types';

export type SymbolExecutionBlockReason =
  | 'SYMBOL_REENTRY_COOLDOWN_ACTIVE'
  | 'SYMBOL_RECOVERY_REQUIRED'
  | 'SYMBOL_ALREADY_OPEN'
  | 'SYMBOL_PENDING_BUY';

export type SymbolReentryState = {
  closedAt: number;
  pnlPct: number;
  pnlUsd: number;
  exitReason: string;
  strategy: string;
  cooldownUntil: number;
};

export type CandidateExecutionEligibility = {
  buyReady: boolean;
  symbolEligible: boolean;
  symbolBlockReason: SymbolExecutionBlockReason | null;
  queueEligible: boolean;
  globalSubmitEligible: boolean;
  globalBlockReason: string | null;
  finalRevalidationPassed: boolean | null;
  rank: number | null;
  cooldownRemainingMs: number;
  recoveryRequired: boolean;
  recoverySatisfied: boolean;
};

export function evaluateSymbolExecutionEligibility(input: {
  candidate: ScannerCandidate;
  openSymbols: ReadonlySet<string>;
  pendingBuySymbols: ReadonlySet<string>;
  reentryState?: SymbolReentryState | null;
  now?: number;
  maxSpreadPct: number;
}): CandidateExecutionEligibility {
  const now = input.now ?? Date.now();
  const symbol = input.candidate.symbol.trim().toUpperCase();
  const buyReady = input.candidate.status === 'BUY'
    && input.candidate.entryGateDecision?.decision === 'ALLOW';
  const base = {
    buyReady,
    globalSubmitEligible: true,
    globalBlockReason: null,
    finalRevalidationPassed: null,
    rank: input.candidate.rank ?? null,
  } as const;

  if (input.openSymbols.has(symbol)) {
    return { ...base, symbolEligible: false, queueEligible: false, symbolBlockReason: 'SYMBOL_ALREADY_OPEN', cooldownRemainingMs: 0, recoveryRequired: false, recoverySatisfied: false };
  }
  if (input.pendingBuySymbols.has(symbol)) {
    return { ...base, symbolEligible: false, queueEligible: false, symbolBlockReason: 'SYMBOL_PENDING_BUY', cooldownRemainingMs: 0, recoveryRequired: false, recoverySatisfied: false };
  }

  const state = input.reentryState;
  if (state) {
    const recoveryRequired = state.pnlPct <= 0;
    const recovery = evaluatePostTradeReentry({
      symbol,
      hasLastTrade: true,
      lastCloseReason: state.exitReason,
      lastPnlPct: state.pnlPct,
      closedAtMs: state.closedAt,
      reboundConfirmed: input.candidate.reboundConfirmed === true,
      momentumConfirmed: input.candidate.momentumConfirmed === true,
      volumeRel: input.candidate.volumeRel,
      groupTrend: input.candidate.groupTrend ?? null,
      spreadPct: input.candidate.spreadPct,
      tpRoomOk: input.candidate.tpRoomOk !== false,
      priceFresh: input.candidate.priceFresh !== false,
      maxSpread: input.maxSpreadPct,
      minVolume: 1,
    });
    const recoverySatisfied = recovery.allowed;
    if (recoveryRequired && !recoverySatisfied) {
      return { ...base, symbolEligible: false, queueEligible: false, symbolBlockReason: 'SYMBOL_RECOVERY_REQUIRED', cooldownRemainingMs: Math.max(0, state.cooldownUntil - now), recoveryRequired, recoverySatisfied };
    }
    const cooldownRemainingMs = Math.max(0, state.cooldownUntil - now);
    if (cooldownRemainingMs > 0) {
      return { ...base, symbolEligible: false, queueEligible: false, symbolBlockReason: 'SYMBOL_REENTRY_COOLDOWN_ACTIVE', cooldownRemainingMs, recoveryRequired, recoverySatisfied };
    }
  }

  return { ...base, symbolEligible: buyReady, queueEligible: buyReady, symbolBlockReason: null, cooldownRemainingMs: 0, recoveryRequired: Boolean(state && state.pnlPct <= 0), recoverySatisfied: true };
}
