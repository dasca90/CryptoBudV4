import { memo, useMemo } from 'react';
import type { TradeV4CandidateView, TradingParametersView } from './types';
import { computeMarketGroupSummary, type SuggestedAction, type GroupSummaryRow } from '../../core/scanner/MarketGroupSummary';
import { getDipperMarketAnalysisV3, type GroupRegimeVerdict, type RegimeVerdict } from '../../core/scanner/MarketAnalyzerV3';
import { getTrendColor } from '../../lib/ui/trendColorHelper';
import { formatLocalTime } from '../../utils/timeFormatter';

const GROUP_ORDER = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];

const ACTION_COLORS: Record<SuggestedAction, string> = {
  TRADE_ALLOWED: '#3fb950',
  WAIT_ONLY: '#d29922',
  BLOCK_GROUP: '#f85149',
  MICRO_ONLY: '#58a6ff',
  REDUCE_RISK: '#f0883e',
};

const ACTION_LABELS: Record<SuggestedAction, string> = {
  TRADE_ALLOWED: 'TRADE',
  WAIT_ONLY: 'WAIT',
  BLOCK_GROUP: 'BLOCK',
  MICRO_ONLY: 'MICRO',
  REDUCE_RISK: 'REDUCE',
};

export const LeftControlSidebar = memo(function LeftControlSidebar(props: {
  candidates: TradeV4CandidateView[];
  parameters: TradingParametersView;
  scannerRunning: boolean;
  referencePeriod?: string;
  lastScanAt?: string | null;
  onChangeRiskGroups: (groups: Record<string, boolean>) => void;
  onScanNow: () => void;
  onAnalyzeOnly: () => void;
}) {
  const summary = useMemo(
    () => computeMarketGroupSummary(props.candidates, props.parameters.scannerRiskGroups as { top_caps: boolean; large_caps: boolean; mid_caps: boolean; high_risk: boolean; very_high_risk: boolean; }, props.parameters.scannerReferencePeriod),
    [props.candidates, props.parameters.scannerRiskGroups, props.parameters.scannerReferencePeriod],
  );

  const marketAnalysis = useMemo(
    () => getDipperMarketAnalysisV3(props.candidates, (props.parameters.scannerReferencePeriod || '1h') as any),
    [props.candidates, props.parameters.scannerReferencePeriod],
  );

  const toggleGroup = (group: string, currentEnabled: boolean) => {
    const next = { ...props.parameters.scannerRiskGroups, [group]: !currentEnabled };
    props.onChangeRiskGroups(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 4px', minWidth: 220, flexShrink: 0 }}>
      {/* ── Manual Scan Controls ── */}
      <section className="panel" style={{ padding: 8, flexShrink: 0 }}>
        <div className="panel-title" style={{ fontSize: 11, marginBottom: 6 }}>MANUAL SCAN</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 9, color: '#8b949e' }}>
            Period: <span style={{ color: '#58a6ff' }}>{props.parameters.scannerReferencePeriod}</span>
            &middot; Status: <span style={{ color: props.scannerRunning ? '#3fb950' : '#d29922' }}>{props.scannerRunning ? 'Running' : 'Idle'}</span>
          </div>
          {props.lastScanAt && (
            <div style={{ fontSize: 8, color: '#484f58' }}>
              Last: {formatLocalTime(props.lastScanAt, { format: 'time' })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-primary"
              disabled={props.scannerRunning}
              onClick={props.onScanNow}
              style={{ flex: 1, fontSize: 9, padding: '3px 6px' }}
              title="Run full scanner cycle with normal execution path"
            >
              Scan Now
            </button>
            <button
              className="btn btn-sm"
              disabled={props.scannerRunning}
              onClick={props.onAnalyzeOnly}
              style={{ flex: 1, fontSize: 9, padding: '3px 6px', background: 'rgba(88,166,255,0.15)', border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff' }}
              title="Market analysis only — no orders created"
            >
              Analyze Only
            </button>
          </div>
          {props.scannerRunning && (
            <div style={{ fontSize: 8, color: '#3fb950', textAlign: 'center' }}>Scanner active — wait for cycle</div>
          )}
          </div>
        </section>

        {/* ── AutoBots Status Card ── */}
        {marketAnalysis && (
          <section className="panel" style={{ padding: 6, flexShrink: 0, borderLeft: `4px solid ${props.scannerRunning ? '#3fb950' : '#484f58'}` }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#d8e6ff', marginBottom: 2 }}>AUTOBOTS</div>
            <div style={{ display: 'flex', gap: 6, fontSize: 9, flexWrap: 'wrap' }}>
              <span style={{ color: props.scannerRunning ? '#3fb950' : '#484f58', fontWeight: 600 }}>
                {props.scannerRunning ? 'RUNNING' : 'STOPPED'}
              </span>
              <span style={{ color: '#7a8ea8' }}>
                Market Best Fit: <span style={{ color: '#58a6ff' }}>{marketAnalysis.overall.bestFitStrategy}</span>
                &middot; <span style={{ color: '#7a8ea8' }}>Mode: <span style={{ color: '#bc8cff' }}>dynamic per coin</span></span>
              </span>
            </div>
            <div style={{ fontSize: 8, color: '#8b949e', marginTop: 2 }}>
              Confidence: <span style={{ color: marketAnalysis.overall.confidenceScore >= 60 ? '#3fb950' : '#d29922' }}>{marketAnalysis.overall.confidenceLabel} ({marketAnalysis.overall.confidenceScore}%)</span>
              &middot; Scan: {marketAnalysis.scanPeriod}
              &middot; {marketAnalysis.sampleSize} coins
            </div>
            {marketAnalysis.overall.action === 'risk_off' && (
              <div style={{ fontSize: 8, color: '#f85149', marginTop: 1 }}>Risk-off — no entries allowed.</div>
            )}
            {marketAnalysis.overall.action === 'wait_for_confirmation' && (
              <div style={{ fontSize: 8, color: '#d29922', marginTop: 1 }}>Waiting for market confirmation.</div>
            )}
            {marketAnalysis.overall.action === 'selective_entries' && (
              <div style={{ fontSize: 8, color: '#3fb950', marginTop: 1 }}>Selective entries allowed.</div>
            )}
          </section>
        )}

        {/* ── V3 Market Analyzer ── */}
      {marketAnalysis && (
        <>
          <div style={{ fontSize: 11, color: '#b0c8e8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>OVERALL MARKET</div>
          <OverallMarketCard verdict={marketAnalysis.overall} scanPeriod={marketAnalysis.scanPeriod} sampleSize={marketAnalysis.sampleSize} />
        </>
      )}

      {/* ── V3 Per-Group Market Verdicts ── */}
      <div style={{ fontSize: 11, color: '#b0c8e8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2, marginTop: 4 }}>GROUP VERDICTS</div>
      {marketAnalysis ? marketAnalysis.groups.map(g => (
        <GroupVerdictCard key={g.group} verdict={g} onToggle={() => toggleGroup(g.group, summary.rows.find(r => r.group === g.group)?.enabled ?? true)} enabled={summary.rows.find(r => r.group === g.group)?.enabled ?? true} />
      )) : GROUP_ORDER.map(group => {
        const row = summary.rows.find(r => r.group === group);
        if (!row) return null;
        return (
          <GroupHealthCard
            key={group}
            row={row}
            onToggle={() => toggleGroup(group, row.enabled)}
          />
        );
      })}
    </div>
  );
});

function GroupHealthCard(props: {
  row: GroupSummaryRow;
  onToggle: () => void;
}) {
  const { row, onToggle } = props;
  const trendColor = getTrendColor(row.groupTrend);
  const actionColor = ACTION_COLORS[row.suggestedAction];
  const actionLabel = ACTION_LABELS[row.suggestedAction];

  const STATE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
    BULL:      { icon: '\u2191', color: '#22c55e', label: 'BULL' },
    BEAR:      { icon: '\u2193', color: '#ef4444', label: 'BEAR' },
    SIDEWAYS:  { icon: '\u2194', color: '#f59e0b', label: 'SIDE' },
    VOLATILE:  { icon: '\u26A0', color: '#f0883e', label: 'VOL' },
    HOT:       { icon: '\uD83D\uDD25', color: '#00eaff', label: 'HOT' },
    WEAK:      { icon: '\u2744', color: '#64748b', label: 'WEAK' },
    OFF:       { icon: '\u23F8', color: '#484f58', label: 'OFF' },
  };
  const DIR_CONFIG: Record<string, string> = {
    UP: '\u2191', DOWN: '\u2193', SIDEWAYS: '\u2192', NONE: '\u00B7',
  };

  const state = STATE_CONFIG[row.marketState] || STATE_CONFIG.SIDEWAYS;
  const dirIcon = DIR_CONFIG[row.trendDirection] || '';

  return (
    <section
      className="panel"
      style={{
        padding: '8px 8px 6px',
        borderLeft: `4px solid ${row.enabled ? state.color : '#484f58'}`,
        opacity: row.enabled ? 1 : 0.55,
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 11, color: row.enabled ? '#d8e6ff' : '#484f58' }}>{row.groupLabel}</span>
        <label title={row.enabled ? 'Disable group' : 'Enable group'} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={row.enabled} onChange={onToggle} style={{ cursor: 'pointer' }} />
          {row.enabled ? 'ON' : 'OFF'}
        </label>
      </div>

      {/* State + Trend + Action badges */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: state.color, background: `${state.color}18`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
          {state.icon} {state.label}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, color: trendColor, background: `${trendColor}15`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
          {dirIcon} {row.trendDirection}
        </span>
        <span style={{ fontSize: 9, fontWeight: 700, color: actionColor, background: `${actionColor}15`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
          {actionLabel}
        </span>
      </div>

      {/* Counts */}
      <div style={{ display: 'flex', gap: 6, fontSize: 10, marginBottom: 3 }}>
        <span style={{ color: '#3fb950', fontWeight: 600 }}>{row.buyCount}B</span>
        <span style={{ color: '#d29922', fontWeight: 600 }}>{row.waitCount}W</span>
        <span style={{ color: '#f85149', fontWeight: 600 }}>{row.blockCount}K</span>
        <span style={{ color: '#8b949e' }}>{row.avoidCount}A</span>
        <span style={{ color: '#58a6ff', marginLeft: 4 }}>{row.recommendedStrategy}</span>
      </div>

      {/* Best symbols or blockers */}
      {row.bestSymbols.length > 0 ? (
        <div style={{ fontSize: 9, color: '#3fb950', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.bestSymbols.join(' ')}
        </div>
      ) : row.topBlockers.length > 0 ? (
        <div style={{ fontSize: 9, color: '#f85149', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.topBlockers.slice(0, 2).join('\u00B7')}
        </div>
      ) : null}
    </section>
  );
}

// ── V3 Overall Market Card ──
function OverallMarketCard(props: { verdict: RegimeVerdict; scanPeriod: string; sampleSize: number }) {
  const biasColor = { bullish: '#22c55e', bullish_with_caution: '#58a6ff', neutral: '#f59e0b', bearish: '#ef4444', bearish_oversold: '#f0883e' }[props.verdict.bias] || '#8b949e';
  const confColor = { high: '#22c55e', good: '#58a6ff', cautious: '#d29922', low: '#ef4444' }[props.verdict.confidenceLabel] || '#8b949e';
  const readyColor = { high: '#22c55e', medium: '#d29922', low: '#ef4444' }[props.verdict.marketReadiness] || '#8b949e';

  return (
    <section className="panel" style={{ padding: 8, borderLeft: `4px solid ${biasColor}`, flexShrink: 0, marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: '#8b949e', fontWeight: 600 }}>Scan: {props.scanPeriod}</span>
        <span style={{ fontSize: 8, color: '#484f58' }}>{props.sampleSize} coins</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, fontSize: 9, marginBottom: 4 }}>
        <VerdictRow label="HTF" value={props.verdict.htfState} color={props.verdict.htfState === 'bullish' ? '#22c55e' : props.verdict.htfState === 'bearish' ? '#ef4444' : '#f59e0b'} />
        <VerdictRow label="Primary" value={props.verdict.primaryState.replace(/_/g, ' ')} color={props.verdict.primaryState.includes('bullish') ? '#22c55e' : props.verdict.primaryState.includes('bearish') ? '#ef4444' : '#f59e0b'} />
        <VerdictRow label="LTF" value={props.verdict.ltfConfirmation.replace(/_/g, ' ')} color={props.verdict.ltfConfirmation === 'confirmed' ? '#22c55e' : props.verdict.ltfConfirmation === 'weak' ? '#ef4444' : '#f59e0b'} />
        <VerdictRow label="Readiness" value={props.verdict.marketReadiness} color={readyColor} />
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 3, fontSize: 9 }}>
        <Badge label="Bias" value={props.verdict.bias.replace(/_/g, ' ')} color={biasColor} />
        <Badge label="Conf" value={`${props.verdict.confidenceLabel} ${props.verdict.confidenceScore}%`} color={confColor} />
        <Badge label="Action" value={props.verdict.action.replace(/_/g, ' ')} color={props.verdict.action === 'selective_entries' ? '#22c55e' : '#d29922'} />
        <Badge label="Best Fit" value={props.verdict.bestFitStrategy} color="#58a6ff" />
      </div>
      <div style={{ fontSize: 8, color: '#7a8ea8', lineHeight: '13px' }}>{props.verdict.explanation}</div>
    </section>
  );
}

// ── V3 Group Verdict Card ──
function GroupVerdictCard(props: { verdict: GroupRegimeVerdict; onToggle: () => void; enabled: boolean }) {
  const v = props.verdict;
  const biasColor = { bullish: '#22c55e', bullish_with_caution: '#58a6ff', neutral: '#f59e0b', bearish: '#ef4444', bearish_oversold: '#f0883e' }[v.bias] || '#8b949e';
  const confColor = { high: '#22c55e', good: '#58a6ff', cautious: '#d29922', low: '#ef4444' }[v.confidenceLabel] || '#8b949e';
  const readyColor = { high: '#22c55e', medium: '#d29922', low: '#ef4444' }[v.readyStatus] || '#8b949e';

  return (
    <section className="panel" style={{ padding: '6px 7px', borderLeft: `4px solid ${props.enabled ? biasColor : '#484f58'}`, opacity: props.enabled ? 1 : 0.55, flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontWeight: 700, fontSize: 10, color: props.enabled ? '#d8e6ff' : '#484f58' }}>{v.groupLabel}</span>
        <label title={props.enabled ? 'Disable' : 'Enable'} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, cursor: 'pointer' }}>
          <input type="checkbox" checked={props.enabled} onChange={props.onToggle} style={{ cursor: 'pointer' }} />
          {props.enabled ? 'ON' : 'OFF'}
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, fontSize: 8, marginBottom: 2 }}>
        <VerdictRow label="HTF" value={v.htfState} color={v.htfState === 'bullish' ? '#22c55e' : v.htfState === 'bearish' ? '#ef4444' : '#f59e0b'} />
        <VerdictRow label="Primary" value={v.primaryState.replace(/_/g, ' ').slice(0, 12)} color={v.primaryState.includes('bullish') ? '#22c55e' : v.primaryState.includes('bearish') ? '#ef4444' : '#f59e0b'} />
        <VerdictRow label="LTF" value={v.ltfConfirmation.replace(/_/g, ' ').slice(0, 10)} color={v.ltfConfirmation === 'confirmed' ? '#22c55e' : v.ltfConfirmation === 'weak' ? '#ef4444' : '#f59e0b'} />
      </div>
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', fontSize: 8 }}>
        <Badge label="" value={v.bias.replace(/_/g, ' ')} color={biasColor} />
        <Badge label="" value={`${v.confidenceLabel} ${v.confidenceScore}`} color={confColor} />
        <Badge label="" value={v.bestFitStrategy} color="#58a6ff" />
        <Badge label="" value={v.readyStatus} color={readyColor} />
      </div>
    </section>
  );
}

function VerdictRow(props: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <span style={{ color: '#484f58', fontSize: 7 }}>{props.label}</span>
      <span style={{ color: props.color, fontWeight: 600, fontSize: 9, textAlign: 'center', textTransform: 'capitalize' }}>{props.value}</span>
    </div>
  );
}

function Badge(props: { label: string; value: string; color: string }) {
  return (
    <span style={{ color: props.color, background: `${props.color}15`, borderRadius: 3, padding: '1px 4px', fontWeight: 600, fontSize: 8, whiteSpace: 'nowrap' }}>
      {props.label ? `${props.label}: ` : ''}{props.value}
    </span>
  );
}
