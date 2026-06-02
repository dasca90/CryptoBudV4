import { useMemo, useEffect } from 'react';
import type { TradingParametersView } from './types';
import type { TradeV4CandidateView } from './types';
import { computeMarketGroupSummary, type GroupSummaryRow } from '../../core/scanner/MarketGroupSummary';
import { getTrendColor, getTrendClassName } from '../../lib/ui/trendColorHelper';

const TREND_LABELS: Record<string, string> = {
  bullish: 'Bullish',
  waiting_for_rebound: 'Waiting Rebound',
  caution: 'Caution',
  bearish: 'Bearish',
  bearish_or_unsafe: 'Bearish/Unsafe',
  sideways: 'Sideways',
};

export function MarketGroupSummaryCard(props: {
  candidates: TradeV4CandidateView[];
  parameters: TradingParametersView;
}) {
  const summary = useMemo(
    () => computeMarketGroupSummary(props.candidates, props.parameters.scannerRiskGroups, props.parameters.scannerReferencePeriod),
    [props.candidates, props.parameters.scannerRiskGroups, props.parameters.scannerReferencePeriod],
  );

  useEffect(() => {
    const enabled = summary.rows.filter(r => r.enabled);
    const disabled = summary.rows.filter(r => !r.enabled);
    const groupLabels = summary.rows.map(r => `${r.group}=${r.enabled ? 'ON' : 'OFF'}:${r.totalCandidates}cand:${r.groupTrend}:${r.recommendedStrategy}`).join('|');
    console.log(`MARKET_GROUP_RENDER_AUDIT: totalGroups=${summary.rows.length} enabledGroups=${enabled.length} disabledGroups=${disabled.length} totalCandidates=${summary.totalCandidates} refPeriod=${summary.referencePeriod} groups=${groupLabels}`);
  }, [summary]);

  return (
    <section style={{ overflow: 'hidden auto', display: 'flex', flexDirection: 'column', padding: '6px 8px', maxHeight: '100%' }}>
      <div style={{ fontSize: 10, color: '#b0c8e8', fontWeight: 700, marginBottom: 4 }}>MARKET GROUPS</div>
      {summary.rows.length === 0 ? (
        <div style={{ fontSize: 9, color: '#8b949e' }}>No candidates.</div>
      ) : (
        <>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>
            Ref: {summary.referencePeriod} &middot; {summary.totalCandidates} cand &middot; {summary.totalEnabled} active
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
              {summary.rows.map(row => (
                <GroupRow key={row.group} row={row} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function GroupRow({ row }: { row: GroupSummaryRow }) {
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
      <td style={{ color: getTrendColor(row.groupTrend), padding: '2px 2px', fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 64 }}>
        {TREND_LABELS[row.groupTrend] || row.groupTrend}
      </td>
      <td style={{ color: '#d29922', padding: '2px 2px', fontSize: 8 }}>{row.recommendedStrategy}</td>
      <td style={{ textAlign: 'right', padding: '2px 2px', fontSize: 9 }}>{row.totalCandidates}</td>
      <td style={{ textAlign: 'right', color: '#3fb950', padding: '2px 2px', fontSize: 9 }}>{row.buyCount}</td>
      <td style={{ textAlign: 'right', color: '#d29922', padding: '2px 2px', fontSize: 9 }}>{row.waitCount}</td>
      <td style={{ textAlign: 'right', color: '#f85149', padding: '2px 2px', fontSize: 9 }}>{row.blockCount}</td>
      <td style={{ textAlign: 'right', padding: '2px 2px', fontSize: 9 }}>{row.avgConfidence > 0 ? `${row.avgConfidence.toFixed(0)}%` : '-'}</td>
    </tr>
  );
}
