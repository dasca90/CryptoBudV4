export type CandidatePoolPacingState = {
  lastBuyAt?: number;
  minBuyIntervalMs?: number;
  cooldownUntil?: number | null;
  nextBuyAllowedAt?: number | null;
  msUntilNextBuyAllowed?: number | null;
  buyPacingActive?: boolean;
  buyCooldownActive?: boolean;
  buyPacingReason?: string;
};

export type CandidatePoolActionabilityInput = {
  buyCandidateSymbols: string[];
  submitEligibleSymbols: string[];
  submitAttemptedSymbols: string[];
  selectedButNotSubmittedSymbols: string[];
  skippedReasonsBySymbol: Record<string, string>;
  selectedButNotSubmittedReasons: string[];
  blockedByBudgetCount?: number;
  blockedByDuplicateCount?: number;
  blockedByRiskCount?: number;
  blockedByOpenPositionLimitCount?: number;
  pacingState?: CandidatePoolPacingState;
};

export type CandidatePoolActionabilityCounts = {
  buyCandidateCount: number;
  actionableBuyCountNow: number;
  blockedByPacingCount: number;
  blockedByCooldownCount: number;
  blockedByBudgetCount: number;
  blockedByDuplicateCount: number;
  blockedByRiskCount: number;
  blockedByOpenPositionLimitCount: number;
  selectedButNotSubmittedCount: number;
  submitAttemptedCount: number;
  selectedButNotSubmittedReasons: string[];
  lastBuyAt: number | null;
  minBuyIntervalMs: number | null;
  cooldownUntil: number | null;
  nextBuyAllowedAt: number | null;
  msUntilNextBuyAllowed: number | null;
  buyPacingActive: boolean;
  buyCooldownActive: boolean;
  buyPacingReason: string;
  invariantOk: boolean;
  sourceUsed: string;
};

const unique = (values: string[]): string[] => Array.from(new Set(
  values.map((value) => String(value ?? '').trim()).filter(Boolean),
));

const reasonIncludes = (reason: string, needles: string[]): boolean => {
  const normalized = reason.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
};

export function buildCandidatePoolActionabilityCounts(
  input: CandidatePoolActionabilityInput,
): CandidatePoolActionabilityCounts {
  const buyCandidateSymbols = unique(input.buyCandidateSymbols);
  const submitEligibleSymbols = unique(input.submitEligibleSymbols);
  const submitAttemptedSymbols = unique(input.submitAttemptedSymbols);
  const selectedButNotSubmittedSymbols = unique(input.selectedButNotSubmittedSymbols);
  const selectedButNotSubmittedReasons = unique(input.selectedButNotSubmittedReasons);
  const reasonEntries = Object.entries(input.skippedReasonsBySymbol)
    .map(([symbol, reason]) => [symbol, String(reason ?? '')] as const)
    .filter(([, reason]) => reason.length > 0);
  const pacingReasonSymbols = reasonEntries
    .filter(([, reason]) => reasonIncludes(reason, ['global_buy_pacing', 'rate_limit', 'spacing']))
    .map(([symbol]) => symbol);
  const cooldownReasonSymbols = reasonEntries
    .filter(([, reason]) => reasonIncludes(reason, ['symbol_reentry_cooldown']))
    .map(([symbol]) => symbol);
  const pacingState = input.pacingState ?? {};
  const buyPacingActive = Boolean(pacingState.buyPacingActive)
    || selectedButNotSubmittedReasons.some((reason) => reasonIncludes(reason, ['global_buy_pacing', 'rate_limit', 'spacing']))
    || pacingReasonSymbols.length > 0;
  const buyCooldownActive = Boolean(pacingState.buyCooldownActive)
    || selectedButNotSubmittedReasons.some((reason) => reasonIncludes(reason, ['symbol_reentry_cooldown']))
    || cooldownReasonSymbols.length > 0;
  const allDetectedBlockedByPacing = buyCandidateSymbols.length > 0
    && submitAttemptedSymbols.length === 0
    && submitEligibleSymbols.length === 0
    && buyPacingActive;
  const blockedByPacingCount = allDetectedBlockedByPacing
    ? buyCandidateSymbols.length
    : unique([...pacingReasonSymbols, ...(buyPacingActive ? selectedButNotSubmittedSymbols : [])]).length;
  const blockedByCooldownCount = unique(cooldownReasonSymbols).length;
  const actionableBuyCountNow = submitEligibleSymbols.length;
  const buyPacingReason = pacingState.buyPacingReason
    ?? (buyPacingActive ? 'GLOBAL_BUY_PACING_ACTIVE' : buyCooldownActive ? 'SYMBOL_REENTRY_COOLDOWN_ACTIVE' : 'none');
  const invariantOk = actionableBuyCountNow <= buyCandidateSymbols.length
    && (input.blockedByBudgetCount ?? 0) >= 0
    && (input.blockedByDuplicateCount ?? 0) >= 0
    && (input.blockedByRiskCount ?? 0) >= 0
    && (input.blockedByOpenPositionLimitCount ?? 0) >= 0;

  return {
    buyCandidateCount: buyCandidateSymbols.length,
    actionableBuyCountNow,
    blockedByPacingCount,
    blockedByCooldownCount,
    blockedByBudgetCount: Math.max(0, input.blockedByBudgetCount ?? 0),
    blockedByDuplicateCount: Math.max(0, input.blockedByDuplicateCount ?? 0),
    blockedByRiskCount: Math.max(0, input.blockedByRiskCount ?? 0),
    blockedByOpenPositionLimitCount: Math.max(0, input.blockedByOpenPositionLimitCount ?? 0),
    selectedButNotSubmittedCount: selectedButNotSubmittedSymbols.length,
    submitAttemptedCount: submitAttemptedSymbols.length,
    selectedButNotSubmittedReasons,
    lastBuyAt: Number.isFinite(pacingState.lastBuyAt) && pacingState.lastBuyAt ? Number(pacingState.lastBuyAt) : null,
    minBuyIntervalMs: Number.isFinite(pacingState.minBuyIntervalMs) ? Number(pacingState.minBuyIntervalMs) : null,
    cooldownUntil: Number.isFinite(pacingState.cooldownUntil) ? Number(pacingState.cooldownUntil) : null,
    nextBuyAllowedAt: Number.isFinite(pacingState.nextBuyAllowedAt) ? Number(pacingState.nextBuyAllowedAt) : null,
    msUntilNextBuyAllowed: Number.isFinite(pacingState.msUntilNextBuyAllowed) ? Math.max(0, Number(pacingState.msUntilNextBuyAllowed)) : null,
    buyPacingActive,
    buyCooldownActive,
    buyPacingReason,
    invariantOk,
    sourceUsed: 'MarketScanner.ExecutionPlanner.AutoBuyExecutionQueue',
  };
}
