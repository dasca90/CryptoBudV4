import { useMemo, useRef, useState } from 'react';
import type { AiCloudTestStatus } from '../../core/ai/AiCloudTestTypes';
import type { AiProviderName, AiTakeoverMode } from '../../core/ai/AiTakeoverTypes';
import type { AiMission, AiMissionType } from '../../core/ai/command/AiCommandCenterTypes';
import type { AiMissionResult } from '../../core/ai/command/AiMissionResult';
import { parseAiMission, updateAiMission } from '../../core/ai/command/AiMissionParser';
import { logger } from '../../utils/logger';

interface Props {
  mode: AiTakeoverMode;
  onModeChange: (mode: AiTakeoverMode) => void;
  providerConfigured: boolean;
  activePositionCount: number;
  provider?: AiProviderName;
  model?: string;
  cloudTestStatus?: AiCloudTestStatus;
  executionMode?: string;
  candidateCount?: number;
  onRunMission?: (command: string, mission: AiMission) => Promise<AiMissionResult>;
}

const MODE_OPTIONS: { key: AiTakeoverMode; label: string }[] = [
  { key: 'OFF', label: 'OFF' },
  { key: 'ON', label: 'ON' },
];

const MISSION_TYPES: AiMissionType[] = ['FIND_UNICORNS', 'FIND_COINS_WITH_UPSIDE', 'ANALYZE_SYMBOL', 'RANK_CANDIDATES'];

export function AiTakeoverCard({
  mode,
  onModeChange,
  providerConfigured,
  activePositionCount,
  provider = 'OFF',
  model = '',
  cloudTestStatus = 'NOT_TESTED',
  executionMode = 'Current CryptoBud adapter',
  candidateCount = 0,
  onRunMission,
}: Props) {
  const [command, setCommand] = useState('Cauta maxim 3 unicorni cu potential peste 3%');
  const parsedMission = useMemo(() => parseAiMission(command), [command]);
  const [missionPatch, setMissionPatch] = useState<Partial<AiMission>>({});
  const mission = updateAiMission(parsedMission, missionPatch);
  const [result, setResult] = useState<AiMissionResult | null>(null);
  const [running, setRunning] = useState(false);
  const latestMissionRunRef = useRef(0);
  const active = mode === 'ON';
  const statusText = active ? (providerConfigured ? 'ACTIVE' : 'BLOCKED_PROVIDER') : 'DISABLED';
  const decisionOwner = active ? 'AI' : 'CryptoBud V4 logic';
  const cloudStatusText = cloudTestStatus === 'SUCCESS'
    ? 'TESTED OK'
    : cloudTestStatus === 'FAILED'
      ? 'FAILED'
      : cloudTestStatus === 'TESTING'
        ? 'TESTING'
        : 'NOT TESTED';
  const cloudStatusTone = cloudTestStatus === 'SUCCESS'
    ? 'positive'
    : cloudTestStatus === 'FAILED'
      ? 'warning'
      : cloudTestStatus === 'TESTING'
        ? 'info'
        : 'muted';

  const runMission = async () => {
    if (!onRunMission) return;
    const runId = latestMissionRunRef.current + 1;
    latestMissionRunRef.current = runId;
    setResult(null);
    setRunning(true);
    try {
      const nextResult = await onRunMission(command, mission);
      if (latestMissionRunRef.current === runId) {
        setResult(nextResult);
      } else {
        logger.warn(`AI_MISSION_STALE_RESULT_IGNORED_AUDIT: staleRunId=${runId} latestMissionId=${latestMissionRunRef.current} uiUpdated=false invariantOk=true failureReason=stale_async_result`);
      }
    } finally {
      if (latestMissionRunRef.current === runId) setRunning(false);
    }
  };

  return (
    <div className="v5-ai-takeover-card">
      <div className="v5-ai-takeover-header">
        <span className="v5-ai-takeover-title">AI TAKEOVER TRADER</span>
        <span className="v5-ai-takeover-badge">V5 Experimental</span>
      </div>

      <div className="v5-ai-takeover-modes">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            className={`v5-ai-mode-btn v5-ai-mode-btn--${opt.key.toLowerCase()}${mode === opt.key ? ' v5-ai-mode-btn--active' : ''}`}
            onClick={() => onModeChange(opt.key)}
            type="button"
            aria-pressed={mode === opt.key}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="v5-ai-takeover-info">
        <AiStatusBadge label="Provider" value={provider} tone={provider === 'OFF' ? 'muted' : 'info'} />
        <AiStatusBadge label="Model" value={model || 'not selected'} tone={model ? 'info' : 'muted'} />
        <AiStatusBadge label="Cloud" value={cloudStatusText} tone={cloudStatusTone} strong={cloudTestStatus === 'SUCCESS'} />
        <AiStatusBadge label="Status" value={statusText} tone={statusText === 'ACTIVE' ? 'positive' : statusText === 'DISABLED' ? 'muted' : 'warning'} />
        <AiStatusBadge label="Execution Mode" value={executionMode} tone="info" strong />
        <AiStatusBadge label="Decision Owner" value={decisionOwner} tone={active ? 'positive' : 'info'} strong />
        <AiStatusBadge label="Candidates" value={String(candidateCount)} tone="count" strong />
        <AiStatusBadge label="Positions" value={String(activePositionCount)} tone="count" strong />
      </div>

      <div className="v5-ai-command-center" data-testid="ai-command-center">
        <div className="v5-ai-command-title">AI Command Center</div>
        <textarea value={command} onChange={(event) => setCommand(event.target.value)} aria-label="AI mission command" />

        <div className="v5-ai-command-controls">
          <label>
            Mission
            <select value={mission.missionType} onChange={(event) => setMissionPatch((prev) => ({ ...prev, missionType: event.target.value as AiMissionType }))}>
              {MISSION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Max
            <input type="number" min={1} max={3} value={mission.maxResults} onChange={(event) => setMissionPatch((prev) => ({ ...prev, maxResults: Number(event.target.value) }))} />
          </label>
          <label>
            Min upside %
            <input type="number" min={0} max={100} step={0.1} value={mission.minCleanUpsidePct} onChange={(event) => setMissionPatch((prev) => ({ ...prev, minCleanUpsidePct: Number(event.target.value) }))} />
          </label>
          <label><input type="checkbox" checked={mission.antiFomo} onChange={(event) => setMissionPatch((prev) => ({ ...prev, antiFomo: event.target.checked }))} /> Anti-FOMO</label>
          <label><input type="checkbox" checked={mission.antiRugpull || mission.antiManipulation} onChange={(event) => setMissionPatch((prev) => ({ ...prev, antiRugpull: event.target.checked, antiManipulation: event.target.checked }))} /> Anti-rugpull/manipulation</label>
          <label><input type="checkbox" checked={mission.newListingGuard} onChange={(event) => setMissionPatch((prev) => ({ ...prev, newListingGuard: event.target.checked }))} /> New listing guard</label>
          <label><input type="checkbox" checked={mission.allowBuyIntent} onChange={(event) => setMissionPatch((prev) => ({ ...prev, allowBuyIntent: event.target.checked }))} /> Allow BUY_INTENT</label>
        </div>

        <button className="v5-ai-run-btn" type="button" onClick={runMission} disabled={running}>
          {running ? 'Running mission' : 'Run Mission'}
        </button>

        <div className="v5-ai-command-status">
          Parsed: {mission.missionType} / max {mission.maxResults} / upside {mission.minCleanUpsidePct}% / execution via {executionMode}
        </div>

        {result && (
          <div className="v5-ai-result-list">
            {result.diagnostics && (
              <div className="v5-ai-result-card v5-ai-mission-diagnostics">
                <strong>AI Provider Diagnostics</strong>
                <span>Status: {result.diagnostics.providerStatus}</span>
                <span>Candidates sent: {result.diagnostics.candidatesSent} / topK {result.diagnostics.topK}</span>
                <span>Calls: {result.providerCallCount ?? 0} batch</span>
                <span>Prompt: {result.diagnostics.promptSizeChars} chars</span>
                <span>Timeout: {result.diagnostics.timeoutMs}ms / Latency: {result.diagnostics.latencyMs}ms</span>
                <span>Retry: {result.diagnostics.retryCount}</span>
                <span>Response parsed: {result.diagnostics.responseParsed ? 'yes' : 'no'} / Schema valid: {result.diagnostics.schemaValid ? 'yes' : 'no'}</span>
                <span>Shape: {result.diagnostics.responseShape ?? 'n/a'} / Source: {result.diagnostics.contentSource ?? 'n/a'}</span>
                {result.diagnostics.marketSnapshotStatus && (
                  <span>Market snapshot: {result.diagnostics.marketSnapshotStatus} / {result.diagnostics.marketSnapshotFreshness ?? 'n/a'}</span>
                )}
                {typeof result.diagnostics.scannerCandidatesCount === 'number' && (
                  <span>Scanner candidates: {result.diagnostics.scannerCandidatesCount} / Source: {result.diagnostics.marketSnapshotSource ?? 'n/a'}</span>
                )}
                {typeof result.diagnostics.usablePreRankCount === 'number' && (
                  <span>Usable pre-rank: {result.diagnostics.usablePreRankCount} / decision-ready: {result.diagnostics.usableDecisionCount ?? 0}</span>
                )}
                {(typeof result.diagnostics.bookTickerCacheAgeMs === 'number' || typeof result.diagnostics.priceCacheAgeMs === 'number') && (
                  <span>
                    Cache age: book {formatCacheAge(result.diagnostics.bookTickerCacheAgeMs)} / price {formatCacheAge(result.diagnostics.priceCacheAgeMs)} / 24h {formatCacheAge(result.diagnostics.ticker24hrCacheAgeMs)}
                  </span>
                )}
                {typeof result.diagnostics.retrospectiveCacheAgeMs === 'number' && (
                  <span>Retrospective: {result.diagnostics.retrospectiveFresh ? 'fresh' : 'partial/missing'} / age {formatCacheAge(result.diagnostics.retrospectiveCacheAgeMs)}</span>
                )}
                {(typeof result.diagnostics.bookTickerFresh === 'boolean' || typeof result.diagnostics.priceFresh === 'boolean') && (
                  <span>Freshness: book {result.diagnostics.bookTickerFresh ? 'fresh' : 'stale/missing'} / price {result.diagnostics.priceFresh ? 'fresh' : 'stale/missing'}</span>
                )}
                {result.diagnostics.missingFields && result.diagnostics.missingFields.length > 0 && (
                  <span>Missing: {result.diagnostics.missingFields.join(', ')}</span>
                )}
                {result.diagnostics.staleFields && result.diagnostics.staleFields.length > 0 && (
                  <span>Stale: {result.diagnostics.staleFields.join(', ')}</span>
                )}
                {typeof result.diagnostics.nextRetryInMs === 'number' && result.diagnostics.nextRetryInMs > 0 && (
                  <span>Next retry: {Math.ceil(result.diagnostics.nextRetryInMs / 1000)}s</span>
                )}
                {result.diagnostics.refreshAttempted && (
                  <span>Action: {result.diagnostics.marketDataAction ?? 'refreshing market data'} / Endpoint: {result.diagnostics.refreshEndpoint ?? 'n/a'} / Success: {result.diagnostics.refreshSuccess ? 'yes' : 'no'}</span>
                )}
                {result.diagnostics.contentPreviewSafe && result.diagnostics.contentPreviewSafe !== 'none' && (
                  <span>Preview: {result.diagnostics.contentPreviewSafe}</span>
                )}
                <span>Reason: {result.diagnostics.failureReason ?? 'none'}</span>
              </div>
            )}
            {result.cards.length === 0 ? (
              <div className="v5-ai-result-card">
                <strong>{result.blockedReason ? 'Mission blocked' : 'No candidates'}</strong>
                <span>Execution: BLOCKED</span>
                <span>Blocked reason: {result.blockedReason ?? 'NO_CANDIDATE_WITH_REQUIRED_RETROSPECTIVE_OR_UPSIDE'}</span>
              </div>
            ) : result.cards.map((card) => (
              <div className="v5-ai-result-card" key={card.symbol}>
                <div className="v5-ai-result-card-head">
                  <strong>{card.symbol}</strong>
                  <span>{card.decision}</span>
                  <span>{Math.round(card.confidence * 100)}%</span>
                </div>
                <span>Expected upside: {card.expectedUpsidePct.toFixed(2)}%</span>
                <span>Expected downside: {card.expectedDownsidePct.toFixed(2)}%</span>
                <span>Risk/reward: {card.riskRewardRatio.toFixed(2)}</span>
                <span>TP1: {card.tp1SuggestedPct.toFixed(2)}% / TP2: 0 forced / SL: {card.slPct.toFixed(2)}%</span>
                <span>Anti-FOMO: {card.antiFomo} / Manipulation: {card.antiRugpullManipulation} / New listing: {card.newListingGuard}</span>
                <span>Execution: {card.executionStatus}</span>
                <span>Blocked: {card.blockedReason ?? 'none'}</span>
                <p>{card.aiReason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatCacheAge(ageMs?: number): string {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return 'n/a';
  if (ageMs < 1000) return `${Math.round(ageMs)}ms`;
  return `${Math.ceil(ageMs / 1000)}s`;
}

function AiStatusBadge({
  label,
  value,
  tone,
  strong = false,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'warning' | 'muted' | 'info' | 'count';
  strong?: boolean;
}) {
  return (
    <span className={`v5-ai-status-badge v5-ai-status-badge--${tone}${strong ? ' v5-ai-status-badge--strong' : ''}`}>
      <span className="v5-ai-status-label">{label}</span>
      <span className="v5-ai-status-value">{value}</span>
    </span>
  );
}
