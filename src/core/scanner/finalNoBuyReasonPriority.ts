export type HandoffIntegrityStatus = 'ok' | 'failed' | 'not_applicable';

export type FinalNoBuyReasonPriorityInput = {
  symbol?: string | null;
  rawStatus?: string | null;
  displayStatus?: string | null;
  finalExecutable?: boolean | null;
  buyAllowed?: boolean | null;
  primaryBlocker?: string | null;
  setupResult?: string | null;
  candidateWhy?: string | null;
  previousFinalNoBuyReason?: string | null;
  blockReasons?: Array<string | null | undefined>;
  entryGateBlocker?: string | null;
  strategyContractBlocker?: string | null;
  executionDecisionFinalNoBuyReason?: string | null;
  runtimeReason?: string | null;
  handoffMismatch?: boolean | null;
};

export type FinalNoBuyReasonPriorityResult = {
  resolvedFinalNoBuyReason: string;
  finalNoBuyReason: string;
  finalNoBuyReasonCode: string;
  finalNoBuyReasonLabel: string;
  actionableNoBuyReason: string;
  technicalNoBuyReason: string;
  secondaryDiagnosticReasons: string[];
  handoffIntegrityStatus: HandoffIntegrityStatus;
  prioritySource: string;
  renderedUserMessage: string;
  invariantOk: boolean;
  failureReason: string;
};

const NONE_RE = /^(?:none|n\/a|ok|allow|unknown|undefined|null)$/i;
const HANDOFF_REASON = 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
const TECHNICAL_ONLY_RE = /^(?:ENTRY_CONTRACT_INVALID|WAIT_ENTRY_CONTRACT|WAITING_EXECUTION_GATE)$/i;

function cleanReason(reason: unknown): string {
  const raw = String(reason ?? '').trim();
  if (!raw || NONE_RE.test(raw)) return 'none';
  return raw;
}

function isExplicit(reason: unknown): reason is string {
  return cleanReason(reason) !== 'none';
}

function isGeneric(reason: unknown): boolean {
  const value = cleanReason(reason);
  return /^(?:none|unknown|buy_ready|entrygate_allow|entry_gate_allow|finalExecutable_false|unknown_final_executable_bug|strategy_setup_not_met|external_gate_not_allow)$/i.test(value)
    || /entry\s*_?\s*gate\s*_?\s*allow/i.test(value)
    || /entrygate\s*_?\s*allow/i.test(value)
    || /ready\s*_?\s*to\s*_?\s*buy/i.test(value);
}

function isTechnicalOnly(reason: unknown): boolean {
  return TECHNICAL_ONLY_RE.test(cleanReason(reason));
}

function hasPriceFreshnessReason(reason: unknown): boolean {
  const value = cleanReason(reason).toLowerCase();
  return value.includes('price_stale') || value.includes('price not fresh') || value.includes('price_not_fresh') || value.includes('block_price_stale');
}

function hasBookFreshnessReason(reason: unknown): boolean {
  const value = cleanReason(reason).toLowerCase();
  return value.includes('book_stale') || value.includes('book stale') || value.includes('block_book_stale');
}

function hasReboundFreshnessReason(reason: unknown): boolean {
  const value = cleanReason(reason).toLowerCase();
  return value.includes('rebound_stale') || value.includes('rebound stale') || value.includes('wait_rebound_freshness');
}

function setupResultToBlocker(setupResult: unknown): string {
  const value = cleanReason(setupResult).toUpperCase();
  if (value === 'DP_NOT_CONFIRMED' || value === 'DIP_NOT_CONFIRMED') return 'DIP_NOT_CONFIRMED';
  if (value === 'WAITING_FOR_REBOUND') return 'rebound_not_confirmed';
  if (value === 'WAITING_FOR_DIP') return 'dip_not_confirmed';
  if (value === 'WAITING_CONFIRMATION' || value === 'WAITING_FOR_CONFIRMATION') return 'WAITING_CONFIRMATION';
  if (value === 'WAITING_FOR_SETUP') return 'WAITING_FOR_SETUP';
  if (value === 'WAITING_EXECUTION_GATE') return 'ENTRY_CONTRACT_INVALID';
  if (value === 'BLOCKED_BY_SPREAD') return 'spread_too_high';
  if (value === 'BLOCKED_BY_SLIPPAGE') return 'slippage_too_high';
  if (value === 'BLOCKED_BY_TP_ROOM') return 'tp_room_not_ok';
  if (value.endsWith('_OK') || value === 'SETUP_OK' || value === 'READY' || value === 'BUY_READY') return 'none';
  return isExplicit(value) ? value : 'none';
}

function renderedMessage(input: FinalNoBuyReasonPriorityInput, resolved: string): string {
  if (/duplicate.*open.*position|duplicate_open_position/i.test(resolved)) return 'Duplicate open position blocked - Already open position';
  if (/^(?:DP|DIP)_NOT_CONFIRMED$/i.test(resolved)) return 'DIP_NOT_CONFIRMED';
  const setup = cleanReason(input.setupResult);
  if (setup !== 'none' && !setup.endsWith('_OK')) return setup.toUpperCase();
  const why = cleanReason(input.candidateWhy);
  if (why !== 'none' && !isGeneric(why)) return why;
  return resolved;
}

function splitReasonCodeAndLabel(reason: string, combinedFreshnessReason: string | null): { code: string; label: string } {
  if (combinedFreshnessReason === 'PRICE_NOT_FRESH / BOOK_STALE') {
    return { code: 'BOOK_STALE', label: combinedFreshnessReason };
  }
  if (combinedFreshnessReason === 'PRICE_STALE / REBOUND_STALE') {
    return { code: 'REBOUND_STALE', label: combinedFreshnessReason };
  }
  const clean = cleanReason(reason);
  return { code: clean, label: clean };
}

export function resolveFinalNoBuyReasonPriority(input: FinalNoBuyReasonPriorityInput): FinalNoBuyReasonPriorityResult {
  const executableRuntimeReason = cleanReason(input.runtimeReason);
  const executableExecutionDecisionReason = cleanReason(input.executionDecisionFinalNoBuyReason);
  const executablePreviousReason = cleanReason(input.previousFinalNoBuyReason);
  const executableHasExplicitRuntimeBlock = [
    executableRuntimeReason,
    executableExecutionDecisionReason,
    executablePreviousReason,
  ].some((reason) => isExplicit(reason) && !isGeneric(reason) && !isTechnicalOnly(reason));
  if (input.finalExecutable === true && input.buyAllowed === true && !executableHasExplicitRuntimeBlock) {
    return {
      resolvedFinalNoBuyReason: 'none',
      finalNoBuyReason: 'none',
      finalNoBuyReasonCode: 'none',
      finalNoBuyReasonLabel: 'BUY_READY',
      actionableNoBuyReason: 'none',
      technicalNoBuyReason: 'none',
      secondaryDiagnosticReasons: [],
      handoffIntegrityStatus: input.handoffMismatch ? 'failed' : 'not_applicable',
      prioritySource: 'executable',
      renderedUserMessage: 'BUY_READY',
      invariantOk: true,
      failureReason: 'none',
    };
  }

  const runtimeReason = setupResultToBlocker(executableRuntimeReason);
  const primaryBlocker = setupResultToBlocker(input.primaryBlocker);
  const setupBlocker = setupResultToBlocker(input.setupResult);
  const candidateWhy = cleanReason(input.candidateWhy);
  const firstBlockReason = setupResultToBlocker((input.blockReasons ?? []).find(isExplicit));
  const entryGateBlocker = cleanReason(input.entryGateBlocker);
  const strategyContractBlocker = cleanReason(input.strategyContractBlocker);
  const executionDecisionReason = setupResultToBlocker(executableExecutionDecisionReason);
  const previousReason = setupResultToBlocker(executablePreviousReason);
  const handoffFailed = input.handoffMismatch === true
    || [previousReason, executionDecisionReason, ...(input.blockReasons ?? []).map(cleanReason)].includes(HANDOFF_REASON);

  const candidates: Array<[string, string]> = [
    ['runtime_precheck', runtimeReason],
    ['primaryBlocker', primaryBlocker],
    ['candidateWhy', candidateWhy],
    ['blockReasons[0]', firstBlockReason],
    ['entryGate', entryGateBlocker],
    ['setupResult', setupBlocker],
    ['strategyContract', strategyContractBlocker],
    ['executionDecision', executionDecisionReason],
  ];
  const allReasonsForFreshness = [
    runtimeReason,
    primaryBlocker,
    candidateWhy,
    firstBlockReason,
    entryGateBlocker,
    setupBlocker,
    strategyContractBlocker,
    executionDecisionReason,
    previousReason,
    ...(input.blockReasons ?? []).map(cleanReason),
  ];
  const hasPriceFreshness = allReasonsForFreshness.some(hasPriceFreshnessReason);
  const hasBookFreshness = allReasonsForFreshness.some(hasBookFreshnessReason);
  const hasReboundFreshness = allReasonsForFreshness.some(hasReboundFreshnessReason);
  const combinedFreshnessReason = hasPriceFreshness && hasBookFreshness
    ? 'PRICE_NOT_FRESH / BOOK_STALE'
    : hasPriceFreshness && hasReboundFreshness
      ? 'PRICE_STALE / REBOUND_STALE'
      : null;
  const actionable = candidates.find(([, reason]) => isExplicit(reason) && !isGeneric(reason) && !isTechnicalOnly(reason) && reason !== HANDOFF_REASON);
  const handoffOnly = !actionable && handoffFailed;
  const fallback = candidates.find(([, reason]) => isExplicit(reason) && !isGeneric(reason) && !isTechnicalOnly(reason));
  const picked = actionable ?? (handoffOnly ? ['handoffIntegrity', HANDOFF_REASON] as [string, string] : fallback);
  const resolved = cleanReason(picked?.[1] ?? previousReason);
  const technicalOnlyReasons = Array.from(new Set([
    setupBlocker,
    previousReason,
    executionDecisionReason,
    strategyContractBlocker,
  ].filter(isTechnicalOnly)));
  const finalReason = combinedFreshnessReason
    ?? (resolved !== 'none' && !isTechnicalOnly(resolved)
    ? resolved
    : technicalOnlyReasons.length > 0
      ? 'WAITING_CONFIRMATION'
      : 'UNKNOWN');
  const technicalReasons = [
    handoffFailed ? HANDOFF_REASON : null,
    ...technicalOnlyReasons,
    previousReason !== finalReason && previousReason !== 'none' ? previousReason : null,
    executionDecisionReason !== finalReason && executionDecisionReason !== 'none' ? executionDecisionReason : null,
  ].filter((reason): reason is string => Boolean(reason));
  const secondaryDiagnosticReasons = Array.from(new Set(technicalReasons));
  const technicalNoBuyReason = secondaryDiagnosticReasons[0] ?? 'none';
  const reasonPresentation = splitReasonCodeAndLabel(finalReason, combinedFreshnessReason);
  const actionableNoBuyReason = reasonPresentation.code === HANDOFF_REASON ? 'none' : reasonPresentation.code;
  const invariantOk = !(primaryBlocker !== 'none' && primaryBlocker !== HANDOFF_REASON && finalReason === HANDOFF_REASON);

  return {
    resolvedFinalNoBuyReason: reasonPresentation.code,
    finalNoBuyReason: reasonPresentation.code,
    finalNoBuyReasonCode: reasonPresentation.code,
    finalNoBuyReasonLabel: reasonPresentation.label,
    actionableNoBuyReason,
    technicalNoBuyReason,
    secondaryDiagnosticReasons,
    handoffIntegrityStatus: handoffFailed ? 'failed' : 'ok',
    prioritySource: combinedFreshnessReason ? 'freshness_combined' : picked?.[0] ?? (technicalOnlyReasons.length > 0 ? 'technical_reason_fallback' : finalReason === 'UNKNOWN' ? 'unknown' : 'previousFinalNoBuyReason'),
    renderedUserMessage: combinedFreshnessReason ?? renderedMessage(input, reasonPresentation.code),
    invariantOk,
    failureReason: invariantOk ? 'none' : 'PRIMARY_BLOCKER_MASKED_BY_HANDOFF_INTEGRITY',
  };
}

export function formatFinalNoBuyReasonPriorityAudit(input: FinalNoBuyReasonPriorityInput, result: FinalNoBuyReasonPriorityResult): string {
  return `FINAL_NO_BUY_REASON_PRIORITY_AUDIT: symbol=${input.symbol ?? 'unknown'} rawStatus=${input.rawStatus ?? 'unknown'} displayStatus=${input.displayStatus ?? input.rawStatus ?? 'unknown'} finalExecutable=${String(input.finalExecutable ?? false)} buyAllowed=${String(input.buyAllowed ?? false)} primaryBlocker=${cleanReason(input.primaryBlocker)} setupResult=${cleanReason(input.setupResult)} candidateWhy=${cleanReason(input.candidateWhy)} previousFinalNoBuyReason=${cleanReason(input.previousFinalNoBuyReason)} finalNoBuyReasonCode=${result.finalNoBuyReasonCode} finalNoBuyReasonLabel=${result.finalNoBuyReasonLabel} resolvedFinalNoBuyReason=${result.resolvedFinalNoBuyReason} actionableNoBuyReason=${result.actionableNoBuyReason} technicalNoBuyReason=${result.technicalNoBuyReason} secondaryDiagnosticReasons=${result.secondaryDiagnosticReasons.join('|') || 'none'} handoffIntegrityStatus=${result.handoffIntegrityStatus} prioritySource=${result.prioritySource} renderedUserMessage=${result.renderedUserMessage} invariantOk=${String(result.invariantOk)} failureReason=${result.failureReason}`;
}
