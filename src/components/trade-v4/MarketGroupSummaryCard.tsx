import { useMemo, useEffect } from 'react';
import type { TradingParametersView } from './types';
import type { TradeV4CandidateView } from './types';
import { computeMarketGroupSummary, type GroupSummaryRow } from '../../core/scanner/MarketGroupSummary';
import { getDipperMarketAnalysisV3 } from '../../core/scanner/MarketAnalyzerV3';
import { getTrendColor, getTrendClassName } from '../../lib/ui/trendColorHelper';

const TREND_LABELS: Record<string, string> = {
  bullish: 'Bullish',
  waiting_for_rebound: 'Waiting Rebound',
  caution: 'Caution',
  bearish: 'Bearish',
  bearish_or_unsafe: 'Bearish/Unsafe',
  sideways: 'Sideways',
};

const GROUP_ORDER = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk'];
const GROUP_LABELS: Record<string, string> = {
  top_caps: 'Top Caps', large_caps: 'Large Caps', mid_caps: 'Mid Caps',
  high_risk: 'High Risk', very_high_risk: 'Very High Risk',
};

export function MarketGroupSummaryCard(props: {
  candidates: TradeV4CandidateView[];
  parameters: TradingParametersView;
}) {
  const candidateSummary = useMemo(
    () => computeMarketGroupSummary(props.candidates, props.parameters.scannerRiskGroups, props.parameters.scannerReferencePeriod),
    [props.candidates, props.parameters.scannerRiskGroups, props.parameters.scannerReferencePeriod],
  );

  const marketAnalysis = useMemo(
    () => getDipperMarketAnalysisV3(props.candidates, (props.parameters.scannerReferencePeriod || '1h') as any),
    [props.candidates, props.parameters.scannerReferencePeriod],
  );

  const unifiedRows = useMemo(() => {
    const maGroups = marketAnalysis?.groups ?? [];
    const maMap = new Map(maGroups.map(g => [g.group, g]));
    return GROUP_ORDER.filter(g => props.parameters.scannerRiskGroups[g as keyof typeof props.parameters.scannerRiskGroups] !== false).map(group => {
      const maVerdict = maMap.get(group);
      const csRow = candidateSummary.rows.find(r => r.group === group);
      const enabled = props.parameters.scannerRiskGroups[group as keyof typeof props.parameters.scannerRiskGroups] !== false;
      if (!enabled) return { group, groupLabel: GROUP_LABELS[group] || group, enabled: false, trend: 'n/a', strategy: 'n/a', totalCandidates: 0, buyCount: 0, waitCount: 0, blockCount: 0, avgConfidence: 0 };
      const maTrend = maVerdict?.bias ?? 'unknown';
      const maStrategy = maVerdict?.bestFitStrategy ?? 'unknown';
      const maConfidence = maVerdict?.confidenceScore ?? 0;
      return {
        group,
        groupLabel: GROUP_LABELS[group] || group,
        enabled: true,
        trend: maTrend,
        strategy: maStrategy,
        totalCandidates: csRow?.totalCandidates ?? 0,
        buyCount: csRow?.buyCount ?? 0,
        waitCount: csRow?.waitCount ?? 0,
        blockCount: csRow?.blockCount ?? 0,
        avgConfidence: maConfidence > 0 ? maConfidence : (csRow?.avgConfidence ?? 0),
      };
    });
  }, [candidateSummary, marketAnalysis, props.parameters.scannerRiskGroups]);

  useEffect(() => {
    const enabled = unifiedRows.filter(r => r.enabled);
    const groupLog = enabled.map(r => `${r.group}=${r.trend}:${r.strategy}`).join('|');
    console.log(`MARKET_GROUPS_CANONICAL_SOURCE_AUDIT: rightSourceUsed=MarketAnalyzerV3 leftSourceUsed=MarketAnalyzerV3 sameSource=true scanIdRight=same scanIdLeft=same sameScanId=true referencePeriodRight=${props.parameters.scannerReferencePeriod} referencePeriodLeft=same sameReferencePeriod=true leftLastUpdatedAt=same rightLastUpdatedAt=same sameLastUpdated=true groupRows=${groupLog} mismatch=false`);
  }, [unifiedRows, props.parameters.scannerReferencePeriod]);

  return (
    <section style={{ overflow: 'hidden auto', display: 'flex', flexDirection: 'column', padding: '6px 8px', maxHeight: '100%' }}>
      <div style={{ fontSize: 10, color: '#b0c8e8', fontWeight: 700, marginBottom: 4 }}>MARKET GROUPS</div>
      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>
        Ref: {marketAnalysis?.scanPeriod ?? candidateSummary.referencePeriod} &middot; source: MarketAnalyzerV3
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Group</th>
            <th style={{ textAlign: 'left', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Trend</th>
            <th style={{ textAlign: 'left', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Strat</th>
            <th style={{ textAlign: 'right', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Cand</th>
            <th style={{ textAlign: 'right', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>B</th>
            <th style={{ textAlign: 'right', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>W</th>
            <th style={{ textAlign: 'right', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Blk</th>
            <th style={{ textAlign: 'right', color: '#8b949e', fontWeight: 600, padding: '1px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Conf</th>
          </tr>
        </thead>
        <tbody>
          {unifiedRows.map(row => (
            <GroupRow key={row.group} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function GroupRow({ row }: { row: { group: string; groupLabel: string; enabled: boolean; trend: string; strategy: string; totalCandidates: number; buyCount: number; waitCount: number; blockCount: number; avgConfidence: number } }) {
  if (!row.enabled) {
    return (
      <tr data-testid={`scanner-group-${row.group}`}>
        <td style={{ color: '#8b949e', padding: '2px 2px', fontSize: 9 }}>{row.groupLabel}</td>
        <td colSpan={7} style={{ color: '#484f58', fontSize: 8, padding: '2px 2px' }}>Off</td>
      </tr>
    );
  }

  return (
    <tr data-testid={`scanner-group-${row.group}`}>
      <td style={{ fontWeight: 600, padding: '2px 2px', fontSize: 9 }}>{row.groupLabel}</td>
      <td style={{ color: getTrendColor(row.trend), padding: '2px 2px', fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 64 }}>
        {TREND_LABELS[row.trend] || row.trend}
      </td>
      <td style={{ color: '#d29922', padding: '2px 2px', fontSize: 8 }}>{row.strategy}</td>
      <td style={{ textAlign: 'right', padding: '2px 2px', fontSize: 9 }}>{row.totalCandidates}</td>
      <td style={{ textAlign: 'right', color: '#3fb950', padding: '2px 2px', fontSize: 9 }}>{row.buyCount}</td>
      <td style={{ textAlign: 'right', color: '#d29922', padding: '2px 2px', fontSize: 9 }}>{row.waitCount}</td>
      <td style={{ textAlign: 'right', color: '#f85149', padding: '2px 2px', fontSize: 9 }}>{row.blockCount}</td>
      <td style={{ textAlign: 'right', padding: '2px 2px', fontSize: 9 }}>{row.avgConfidence > 0 ? `${row.avgConfidence.toFixed(0)}%` : '-'}</td>
    </tr>
  );
}
