import { useEffect } from "react";
import type { TradeV4CandidateView, TradeV4NoBuyDisplay } from "./types";
import { logger } from "../../utils/logger";

export function CandidatePoolSummaryPanel(props: {
  candidates: TradeV4CandidateView[];
  executionPoolSize?: number;
  watchPoolSize?: number;
  nearMissPoolSize?: number;
  noBuyDisplay?: TradeV4NoBuyDisplay;
  referencePeriod?: string;
  paperAutoEnabled?: boolean;
  manualStrategy?: string | null;
  marketGroupSummary?: React.ReactNode;
  scannerTelemetry?: {
    active: boolean;
    label: string;
    checks: Array<{ label: string; complete: boolean }>;
  } | null;
  executionPlan?: {
    selectedCandidates?: Array<{ symbol: string }>;
    skippedCandidates?: Array<{ symbol: string; reason: string; finalNoBuyReason?: string }>;
    noBuyReasons?: string[];
    canExecute?: boolean;
    decisionMode?: string;
    maxExecutionQueuePerScan?: number;
    queueAcceptedCount?: number;
    deferredByQueueLimitCount?: number;
    queueRejectedCount?: number;
    queueAcceptedSymbols?: string[];
    deferredByQueueLimitSymbols?: string[];
    queueRejectedReasons?: string[];
    symbolEligibleCount?: number;
    symbolCooldownBlockedCount?: number;
    recoveryBlockedCount?: number;
    alreadyOpenBlockedCount?: number;
    pendingBuyBlockedCount?: number;
    autoBotsSubmitAttemptedThisCycle?: number;
    unicornSubmitAttemptedThisCycle?: number;
    globalSubmitAttemptedThisCycle?: number;
    maxAutoBotsBuysPerCycle?: number;
    maxUnicornBuysPerCycle?: number;
    unicornSelectedThisCycle?: number;
    unicornSelectedExecutableCount?: number;
    unicornSelectedButNotSubmittedReason?: string;
  } | null;
}) {
  const buyCount = props.candidates.filter(c => c.status === 'BUY').length;
  const waitCount = props.candidates.filter(c => c.status === 'WAIT').length;
  const blockCount = props.candidates.filter(c => c.status === 'BLOCK').length;
  const avoidCount = props.candidates.filter(c => c.status === 'AVOID').length;
  const pool = props.noBuyDisplay;
  const hasPoolData = props.executionPoolSize != null;
  const detectedBuyCandidateCount = pool?.buyCandidateCount ?? buyCount;
  const actionableBuyCountNow = pool?.actionableBuyCountNow ?? props.candidates.filter(c => c.status === 'BUY' && c.finalExecutable === true && c.buyAllowed === true).length;
  const blockedByPacingCount = pool?.blockedByPacingCount ?? 0;
  const blockedByCooldownCount = pool?.blockedByCooldownCount ?? 0;
  const maxExecutionQueuePerScan = pool?.maxExecutionQueuePerScan ?? props.executionPlan?.maxExecutionQueuePerScan ?? 10;
  const deferredByQueueLimitCount = pool?.deferredByQueueLimitCount
    ?? props.executionPlan?.deferredByQueueLimitCount
    ?? props.executionPlan?.skippedCandidates?.filter((candidate) => (candidate.finalNoBuyReason ?? candidate.reason) === 'MAX_EXECUTION_QUEUE_REACHED').length
    ?? 0;
  const executionQueueAcceptedCount = pool?.executionQueueAcceptedCount
    ?? props.executionPlan?.queueAcceptedCount
    ?? Math.min(maxExecutionQueuePerScan, detectedBuyCandidateCount);
  const symbolEligibleCount = pool?.symbolEligibleCount ?? props.executionPlan?.symbolEligibleCount ?? executionQueueAcceptedCount;
  const recoveryBlockedCount = pool?.recoveryBlockedCount ?? props.executionPlan?.recoveryBlockedCount ?? 0;
  const alreadyOpenBlockedCount = pool?.alreadyOpenBlockedCount ?? props.executionPlan?.alreadyOpenBlockedCount ?? 0;
  const pendingBuyBlockedCount = pool?.pendingBuyBlockedCount ?? props.executionPlan?.pendingBuyBlockedCount ?? 0;
  const submittedThisCycleCount = pool?.submitAttemptedCount ?? 0;
  const nextQueueRetry = deferredByQueueLimitCount > 0 ? (pool?.nextQueueRetry ?? 'next scan') : 'none';
  const buyPacingActive = pool?.buyPacingActive === true || (pool?.selectedButNotSubmittedReasons ?? []).includes('GLOBAL_BUY_PACING_ACTIVE');
  const nextBuyAllowedLabel = (() => {
    const ms = pool?.msUntilNextBuyAllowed;
    if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return `${Math.ceil(ms / 1000)}s`;
    const nextAt = pool?.nextBuyAllowedAt;
    if (typeof nextAt === 'number' && Number.isFinite(nextAt) && nextAt > Date.now()) {
      return new Date(nextAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return buyPacingActive ? 'waiting for pacing release' : 'now';
  })();
  const candidatePoolInvariantOk = actionableBuyCountNow <= detectedBuyCandidateCount
    && executionQueueAcceptedCount <= maxExecutionQueuePerScan
    && symbolEligibleCount <= detectedBuyCandidateCount;
  const pipelineQueueAccepted = props.executionPlan?.queueAcceptedCount ?? executionQueueAcceptedCount;
  const pipelineDeferredCount = props.executionPlan?.deferredByQueueLimitCount ?? deferredByQueueLimitCount;
  const queueParityMismatch = pipelineQueueAccepted !== executionQueueAcceptedCount || pipelineDeferredCount !== deferredByQueueLimitCount;
  const isUnicornCandidate = (candidate: TradeV4CandidateView) => [
    (candidate as any).source,
    (candidate as any).candidateSource,
    (candidate as any).sourceOwner,
    (candidate as any).ownerType,
    (candidate as any).sourcePresentation,
  ].some((value) => String(value ?? '').toLowerCase().includes('unicorn'));
  const unicornCandidateCount = props.candidates.filter(isUnicornCandidate).length;
  const unicornReadyCount = props.candidates.filter((candidate) => isUnicornCandidate(candidate) && candidate.status === 'BUY').length;
  const unicornExecutableCount = props.executionPlan?.unicornSelectedExecutableCount
    ?? props.candidates.filter((candidate) => isUnicornCandidate(candidate) && candidate.status === 'BUY' && candidate.finalExecutable === true && candidate.buyAllowed === true).length;
  const autoBotsReadyCount = Math.max(0, buyCount - unicornReadyCount);
  const autoBotsSubmitted = props.executionPlan?.autoBotsSubmitAttemptedThisCycle ?? Math.max(0, submittedThisCycleCount - (props.executionPlan?.unicornSubmitAttemptedThisCycle ?? 0));
  const unicornSubmitted = props.executionPlan?.unicornSubmitAttemptedThisCycle ?? 0;
  const globalSubmitted = props.executionPlan?.globalSubmitAttemptedThisCycle ?? submittedThisCycleCount;
  const maxAutoBotsBuysPerCycle = props.executionPlan?.maxAutoBotsBuysPerCycle ?? Math.max(1, actionableBuyCountNow);
  const maxUnicornBuysPerCycle = props.executionPlan?.maxUnicornBuysPerCycle ?? 1;
  const unicornBlockedReason = props.executionPlan?.unicornSelectedButNotSubmittedReason ?? 'none';

  useEffect(() => {
    logger.info(
      `CANDIDATE_POOL_UI_BINDING_AUDIT: ` +
      `rawBuyCandidateCount=${detectedBuyCandidateCount} ` +
      `uiBuyReadyCount=${actionableBuyCountNow} ` +
      `finalActionableBuyCount=${actionableBuyCountNow} ` +
      `executionQueueAccepted=${executionQueueAcceptedCount} ` +
      `maxExecutionQueuePerScan=${maxExecutionQueuePerScan} ` +
      `deferredByQueueLimit=${deferredByQueueLimitCount} ` +
      `nextQueueRetry=${nextQueueRetry} ` +
      `blockedByPacingCount=${blockedByPacingCount} ` +
      `blockedByCooldownCount=${blockedByCooldownCount} ` +
      `selectedButNotSubmittedReasons=${pool?.selectedButNotSubmittedReasons?.join('|') || 'none'} ` +
      `nextBuyAllowedAt=${pool?.nextBuyAllowedAt ?? 'none'} ` +
      `msUntilNextBuyAllowed=${pool?.msUntilNextBuyAllowed ?? 'n/a'} ` +
      `sourceUsed=${pool?.countSourceUsed ?? 'ui_fallback_no_canonical_summary'} ` +
      `invariantOk=${String(candidatePoolInvariantOk)}`
    );
    logger.info(
      `EXECUTION_QUEUE_PARITY_AUDIT: ` +
      `uiQueueAccepted=${executionQueueAcceptedCount} ` +
      `pipelineQueueAccepted=${pipelineQueueAccepted} ` +
      `maxExecutionQueuePerScan=${maxExecutionQueuePerScan} ` +
      `uiDeferredCount=${deferredByQueueLimitCount} ` +
      `pipelineDeferredCount=${pipelineDeferredCount} ` +
      `mismatchDetected=${String(queueParityMismatch)} ` +
      `invariantOk=${String(!queueParityMismatch)} ` +
      `failureReason=${queueParityMismatch ? 'execution_queue_ui_pipeline_mismatch' : 'none'}`
    );
  }, [
    detectedBuyCandidateCount,
    actionableBuyCountNow,
    executionQueueAcceptedCount,
    maxExecutionQueuePerScan,
    deferredByQueueLimitCount,
    nextQueueRetry,
    blockedByPacingCount,
    blockedByCooldownCount,
    pool?.selectedButNotSubmittedReasons,
    pool?.nextBuyAllowedAt,
    pool?.msUntilNextBuyAllowed,
    pool?.countSourceUsed,
    candidatePoolInvariantOk,
    pipelineQueueAccepted,
    pipelineDeferredCount,
    queueParityMismatch,
  ]);

  // Find closest-to-BUY candidate: highest score WAIT or BLOCK (not AVOID)
  const closestBuyCandidates = props.candidates
    .filter(c => c.status === 'WAIT' || c.status === 'BLOCK')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3);
  const bestPumper = props.candidates
    .filter(c => (c.momentum ?? 0) > 0)
    .sort((a, b) => (b.momentum ?? 0) - (a.momentum ?? 0))
    .slice(0, 1);

  // Classify block reasons as hard (always blocks) vs soft (needs confirmation)
  const HARD_BLOCKERS = new Set(['spread', 'stale', 'price_stale', 'tp', 'no_tp', 'disabled', 'banned', 'max_positions', 'capital', 'emergency', 'offline', 'data_quality', 'not_tradable']);
  const classifyBlockers = (reasons: string[]): { hard: string[]; soft: string[] } => {
    const hard: string[] = [];
    const soft: string[] = [];
    for (const r of reasons) {
      const rl = r.toLowerCase();
      if (Array.from(HARD_BLOCKERS).some(h => rl.includes(h))) hard.push(r);
      else if (r && r.length > 0) soft.push(r);
    }
    return { hard, soft };
  };

  // Best very_high_risk candidate
  const bestVHR = props.candidates
    .filter(c => c.riskGroup === 'very_high_risk')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 1);
  const topCandidate = closestBuyCandidates[0];

  return (
    <section className="panel panel-fill" style={{ padding: '8px 10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-title" style={{ fontSize: 10 }}>CANDIDATE POOL / ENTRY PIPELINE</div>
      <div className="muted" data-testid="candidate-pool-source-legend" style={{ fontSize: 8, marginTop: 3 }}>
        Source: AutoBots · ML Predict
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, overflow: 'hidden auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4 }}>
            <PoolBox label="BUY candidates" value={String(detectedBuyCandidateCount)} color="#58a6ff" />
            <PoolBox label="Symbol eligible" value={String(symbolEligibleCount)} color={symbolEligibleCount > 0 ? "#3fb950" : "#8b949e"} />
            <PoolBox label="Execution queue" value={`${executionQueueAcceptedCount} / ${maxExecutionQueuePerScan}`} color={executionQueueAcceptedCount >= maxExecutionQueuePerScan ? "#d29922" : "#3fb950"} />
            <PoolBox label="Actionable now" value={String(actionableBuyCountNow)} color={actionableBuyCountNow > 0 ? "#3fb950" : "#f85149"} />
            <PoolBox label="Submitted" value={`${submittedThisCycleCount}/${Math.max(1, actionableBuyCountNow)}`} color={submittedThisCycleCount > 0 ? "#3fb950" : "#8b949e"} />
            <PoolBox label="AutoBots ready" value={String(autoBotsReadyCount)} color={autoBotsReadyCount > 0 ? "#58a6ff" : "#8b949e"} />
            <PoolBox label="AutoBots submit" value={`${autoBotsSubmitted}/${maxAutoBotsBuysPerCycle}`} color={autoBotsSubmitted > 0 ? "#3fb950" : "#8b949e"} />
            <PoolBox label="Unicorn pool" value={String(unicornCandidateCount)} color={unicornCandidateCount > 0 ? "#b985ff" : "#8b949e"} />
            <PoolBox label="Unicorn submit" value={`${unicornSubmitted}/${maxUnicornBuysPerCycle}`} color={unicornSubmitted > 0 ? "#3fb950" : unicornReadyCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Unicorn READY" value={`${unicornReadyCount}/${unicornExecutableCount}`} color={unicornExecutableCount > 0 ? "#3fb950" : unicornReadyCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Unicorn block" value={unicornBlockedReason} color={unicornBlockedReason !== 'none' ? "#d29922" : "#8b949e"} />
            <PoolBox label="Global submit" value={String(globalSubmitted)} color={globalSubmitted > 0 ? "#3fb950" : "#8b949e"} />
            <PoolBox label="Global queue" value={`${executionQueueAcceptedCount}/${maxExecutionQueuePerScan}`} color={executionQueueAcceptedCount >= maxExecutionQueuePerScan ? "#d29922" : "#58a6ff"} />
            <PoolBox label="Deferred queue" value={String(deferredByQueueLimitCount)} color={deferredByQueueLimitCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Next retry" value={nextQueueRetry} color={deferredByQueueLimitCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Global pacing" value={buyPacingActive ? 'ACTIVE' : 'READY'} color={buyPacingActive ? "#d29922" : "#3fb950"} />
            <PoolBox label="Re-entry cooldown" value={String(blockedByCooldownCount)} color={blockedByCooldownCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Recovery required" value={String(recoveryBlockedCount)} color={recoveryBlockedCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Already open" value={String(alreadyOpenBlockedCount)} color={alreadyOpenBlockedCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Pending BUY" value={String(pendingBuyBlockedCount)} color={pendingBuyBlockedCount > 0 ? "#d29922" : "#8b949e"} />
            <PoolBox label="Next buy" value={nextBuyAllowedLabel} color={buyPacingActive ? "#d29922" : "#3fb950"} />
            <PoolBox label="Exec Pool" value={hasPoolData ? String(props.executionPoolSize) : 'n/a'} color="#58a6ff" />
            <PoolBox label="Watch Pool" value={hasPoolData ? String(props.watchPoolSize) : 'n/a'} color="#d29922" />
            <PoolBox label="Near Miss" value={hasPoolData ? String(props.nearMissPoolSize) : 'n/a'} color="#f0883e" />
            <PoolBox label="WAIT" value={String(waitCount)} color="#d29922" />
            <PoolBox label="BLOCK" value={String(blockCount)} color="#f85149" />
            <PoolBox label="AVOID" value={String(avoidCount)} color="#8b949e" />
            <PoolBox label="Ref Period" value={props.referencePeriod ?? '1h'} color="#8b949e" />
          </div>

          {buyPacingActive && detectedBuyCandidateCount > 0 && actionableBuyCountNow === 0 && (
            <div style={{ background: 'rgba(210,153,34,0.10)', border: '1px solid rgba(210,153,34,0.24)', borderRadius: 4, padding: '4px 6px', marginTop: 2, fontSize: 8, color: '#d29922', lineHeight: '12px' }}>
              GLOBAL_BUY_PACING_ACTIVE: queue remains ranked. Next BUY allowed: {nextBuyAllowedLabel}.
            </div>
          )}

          {props.executionPlan && (
            <div style={{ background: 'rgba(0,234,255,0.04)', borderRadius: 4, padding: '3px 6px', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', fontSize: 8 }}>
              <span style={{ color: '#8b949e' }}>Exec:</span>
              <span style={{ color: (props.executionPlan.selectedCandidates?.length ?? 0) > 0 ? '#3fb950' : '#f85149', fontWeight: 700 }}>
                {executionQueueAcceptedCount}/{maxExecutionQueuePerScan} queued
              </span>
              <span style={{ color: '#d29922' }}>
                {deferredByQueueLimitCount} deferred
              </span>
              {(props.executionPlan.noBuyReasons?.length ?? 0) > 0 && (
                <span style={{ color: '#f85149', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {props.executionPlan.noBuyReasons!.slice(0, 3).join(' | ')}
                </span>
              )}
            </div>
          )}

          {(pool?.buyReadyCount ?? buyCount) > 0 && props.executionPoolSize === 0 && (props.executionPlan?.selectedCandidates?.length ?? 0) === 0 && (
            <div style={{ color: '#f85149', fontSize: 8, marginTop: 2 }}>
              ⚠ Scanner found BUY signals, but 0 made it to execution pool. Check ENTRYGATE_TO_EXECUTION_DROPPED_AUDIT in logs.
            </div>
          )}

          {buyCount === 0 && (
            <div style={{ background: 'rgba(0,234,255,0.04)', borderRadius: 4, padding: '5px 6px', marginTop: 2, fontSize: 8 }}>
              <div style={{ color: '#00eaff', fontWeight: 700, fontSize: 9, marginBottom: 3 }}>Why no BUY?</div>
              {!props.paperAutoEnabled && !props.manualStrategy ? (
                <div style={{ color: '#d29922', marginBottom: 2 }}>
                  No strategy active — select a strategy or enable AutoBots.
                </div>
              ) : !props.paperAutoEnabled && props.manualStrategy ? (
                <div style={{ color: '#58a6ff', marginBottom: 2 }}>
                  Manual strategy: <span style={{ fontWeight: 700 }}>{props.manualStrategy.toUpperCase()}</span>. Waiting for gates to pass.
                </div>
              ) : (
                <div style={{ color: '#d29922', marginBottom: 2 }}>
                  AutoBots active — candidates must pass EntryGate + Safety gates.
                </div>
              )}

              {pool && pool.marketAction && (
                <div style={{ color: '#8b949e', marginBottom: 2, lineHeight: '14px', fontSize: 8 }}>
                  Market: <strong style={{ color: pool.marketAction === 'risk_off' ? '#f85149' : pool.marketAction === 'selective_entries' ? '#3fb950' : '#d29922' }}>{pool.marketAction.replace(/_/g, ' ')}</strong>
                  {' | Fit: '}<strong style={{ color: '#58a6ff' }}>{pool.bestFit}</strong>
                  {' | Conf: '}<strong style={{ color: (pool.marketConfidence ?? 0) >= 60 ? '#3fb950' : '#d29922' }}>{pool.marketConfidence ?? '?'}%</strong>
                </div>
              )}

              {topCandidate && (() => {
                const { hard, soft } = classifyBlockers(topCandidate.blockReasons || []);
                if (hard.length > 0 || soft.length > 0) {
                  return (
                    <div style={{ marginBottom: 2 }}>
                      {hard.length > 0 ? (
                        <div style={{ color: '#f85149', marginBottom: 1 }}>
                          Blocked: {hard.slice(0, 3).join(', ')}
                        </div>
                      ) : (
                        <div style={{ color: '#d29922', marginBottom: 1 }}>
                          Waiting: {soft.slice(0, 3).join(', ') || topCandidate.mainReason?.slice(0, 50)}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

              {pool && pool.requiredNextCondition && pool.requiredNextCondition.length > 0 && (
                <div style={{ color: '#58a6ff', marginTop: 1, fontSize: 8 }}>
                  Need: {pool.requiredNextCondition.join(', ')}
                </div>
              )}
            </div>
          )}

          {(!pool || pool.topReasons.length === 0) && props.candidates.length > 0 && (
            <div style={{ color: '#8b949e', fontSize: 9, marginTop: 2 }}>
              Next action: {props.candidates[0]?.requiredNextAction || 'waiting for confirmation'}
            </div>
          )}
        </div>

        <div style={{ width: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

        <div style={{ flex: '0 0 auto', minWidth: 200, overflow: 'hidden auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {props.scannerTelemetry && (
            <div
              data-testid="candidate-pool-scanner-telemetry"
              style={{
                border: '1px solid rgba(0,234,255,0.18)',
                background: 'linear-gradient(180deg, rgba(0,234,255,0.08), rgba(0,0,0,0.12))',
                borderRadius: 4,
                padding: '6px 8px',
                color: '#b8d7ff',
                boxShadow: '0 0 18px rgba(0,234,255,0.06) inset',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                <strong style={{ color: '#d8e6ff', fontSize: 10 }}>{props.scannerTelemetry.label}</strong>
                <span style={{ color: props.scannerTelemetry.active ? '#00eaff' : '#8b949e', fontSize: 8, fontWeight: 700 }}>
                  {props.scannerTelemetry.active ? 'ACTIVE' : 'IDLE'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 8px', fontSize: 8, lineHeight: '12px' }}>
                {props.scannerTelemetry.checks.map((check) => (
                  <span key={check.label} style={{ display: 'contents' }}>
                    <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.label}</span>
                    <b style={{ color: check.complete ? '#3fb950' : '#00eaff', fontSize: 9 }}>{check.complete ? 'OK' : 'SCAN'}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          {props.marketGroupSummary}
        </div>
      </div>
    </section>
  );
}

function PoolBox(props: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '3px 6px', textAlign: 'center' }}>
      <div style={{ fontSize: 8, color: props.color }}>{props.label}</div>
      <div style={{ fontSize: props.value.length > 9 ? 10 : 13, fontWeight: 700, color: '#d8e6ff', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{props.value}</div>
    </div>
  );
}
