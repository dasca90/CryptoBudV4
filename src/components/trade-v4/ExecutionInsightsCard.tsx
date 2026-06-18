import { memo } from "react";
import type { TradeV4NoBuyDisplay } from "./types";
import type { TradeV4CandidateView } from "./types";

export const ExecutionInsightsCard = memo(function ExecutionInsightsCard(props: {
  noBuyDisplay?: TradeV4NoBuyDisplay | null;
  candidates?: TradeV4CandidateView[];
  executionPlan?: {
    selectedCandidates?: Array<{ symbol: string }>;
    skippedCandidates?: Array<{ symbol: string; reason: string }>;
    noBuyReasons?: string[];
    canExecute?: boolean;
    executionPoolSize?: number;
    plannerInputCount?: number;
  } | null;
}) {
  const nd = props.noBuyDisplay;
  const cs = props.candidates ?? [];
  const hasScannerData = cs.length > 0 || nd != null;  

  return (
    <section className="panel panel-fill panel-shell" style={{ padding: 0, overflow: 'hidden auto', height: '100%', minHeight: 80, display: 'flex', flexDirection: 'column' }} data-testid="execution-insights-card">
      <div className="panel-header-v4" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(9,15,32,0.95)', flexShrink: 0 }}>
        <div className="panel-title panel-title-v4" style={{ fontSize: 11 }}>EXECUTION INSIGHTS / WHY NO BUY</div>
      </div>
      <div className="panel-body-v4" style={{ padding: '4px 8px', fontSize: 9, overflow: 'hidden auto', flex: 1 }}>
        {!hasScannerData ? (
          <div style={{ color: '#8b949e', fontSize: 10, textAlign: 'center', padding: 12 }}>No scan data yet.</div>
        ) : !nd ? (
          <div style={{ fontSize: 10, color: '#58a6ff', fontWeight: 600, marginBottom: 6 }}>
            Scanner active — {cs.length} candidates. Execution count: {props.executionPlan?.selectedCandidates?.length ?? 0} selected.
            {cs.filter(c => c.status === 'BUY').length > 0 && (props.executionPlan?.selectedCandidates?.length ?? 0) === 0 && (
              <span style={{ color: '#f85149' }}> Check ENTRYGATE_TO_EXECUTION_DROPPED_AUDIT in logs.</span>
            )}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: '#58a6ff', fontWeight: 600, marginBottom: 6 }}>
              Scanner active — {cs.length} candidates. Execution-ready: {props.executionPlan?.executionPoolSize ?? (props.executionPlan as any)?.plannerInputCount ?? 0}, selected: {props.executionPlan?.selectedCandidates?.length ?? 0}.
              {cs.filter(c => c.status === 'BUY').length > 0 && (props.executionPlan?.selectedCandidates?.length ?? 0) === 0 && (
                <span style={{ color: '#f85149' }}> Check ENTRYGATE_TO_EXECUTION_DROPPED_AUDIT and FINAL_SELECTION_BLOCKER_VALUES_AUDIT in logs.</span>
              )}
            </div>

            <div style={{ background: 'rgba(210,153,34,0.06)', borderRadius: 4, padding: '6px 8px', marginBottom: 6, fontSize: 9 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
                {nd.marketAction && <span><span style={{ color: '#8b949e' }}>Market Action:</span> <strong style={{ color: '#d29922' }}>{nd.marketAction.replace(/_/g, ' ').toUpperCase()}</strong></span>}
                {nd.bestFit && <span><span style={{ color: '#8b949e' }}>Best Fit:</span> <strong style={{ color: '#58a6ff' }}>{nd.bestFit.replace(/_/g, ' ')}</strong></span>}
                {nd.htf && <span><span style={{ color: '#8b949e' }}>HTF:</span> <strong style={{ color: nd.htf === 'bearish' ? '#f85149' : nd.htf === 'bullish' ? '#3fb950' : '#d29922' }}>{nd.htf.toUpperCase()}</strong></span>}
                {nd.primary && <span><span style={{ color: '#8b949e' }}>Primary:</span> <strong>{nd.primary.replace(/_/g, ' ')}</strong></span>}
                {nd.ltf && <span><span style={{ color: '#8b949e' }}>LTF:</span> <strong style={{ color: nd.ltf === 'confirmed' ? '#3fb950' : nd.ltf === 'not_confirmed' ? '#f85149' : '#d29922' }}>{nd.ltf.replace(/_/g, ' ')}</strong></span>}
                {nd.marketConfidence != null && <span><span style={{ color: '#8b949e' }}>Confidence:</span> <strong style={{ color: nd.marketConfidence >= 60 ? '#3fb950' : '#d29922' }}>{nd.marketConfidence}%</strong></span>}
                {nd.marketBias && <span><span style={{ color: '#8b949e' }}>Bias:</span> <strong>{nd.marketBias.replace(/_/g, ' ')}</strong></span>}
                <span><span style={{ color: '#8b949e' }}>Executable:</span> <strong style={{ color: '#3fb950' }}>{nd.buyReadyCount ?? 0}</strong></span>
                <span><span style={{ color: '#8b949e' }}>Waiting:</span> <strong style={{ color: '#d29922' }}>{nd.watchPoolSize ?? 0}</strong></span>
                <span><span style={{ color: '#8b949e' }}>Block spread:</span> <strong style={{ color: '#f85149' }}>{(nd.blockedBySpread ?? 0) + (nd.blockedBySlippage ?? 0)}</strong></span>
                <span><span style={{ color: '#8b949e' }}>Block dip/reb:</span> <strong style={{ color: '#f85149' }}>{(nd.blockedByDip ?? 0) + (nd.blockedByRebound ?? 0)}</strong></span>
                <span><span style={{ color: '#8b949e' }}>Block TP:</span> <strong style={{ color: '#f85149' }}>{(nd.blockedByTp1Invalid ?? 0) + (nd.blockedByTpRoom ?? 0)}</strong></span>
              </div>
            </div>

            {nd.topBlockers && nd.topBlockers.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <span style={{ color: '#f85149', fontWeight: 600 }}>Top block: </span>
                <span style={{ color: '#f85149' }}>{nd.topBlockers[0]}</span>
                {nd.topBlockers.length > 1 && <span style={{ color: '#8b949e' }}> | Also: {nd.topBlockers.slice(1).join(', ')}</span>}
              </div>
            )}

            {nd.requiredNextCondition && nd.requiredNextCondition.length > 0 && (
              <div style={{ background: 'rgba(88,166,255,0.08)', borderRadius: 4, padding: '4px 6px', marginBottom: 4 }}>
                <div style={{ fontSize: 9, color: '#58a6ff', fontWeight: 600, marginBottom: 2 }}>Required next:</div>
                <div style={{ fontSize: 8, color: '#8b949e', display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
                  {nd.requiredNextCondition.map((cond, i) => (
                    <span key={i} style={{ color: i === 0 ? '#d29922' : '#8b949e' }}>{cond}{i < nd.requiredNextCondition!.length - 1 ? ',' : ''}</span>
                  ))}
                </div>
              </div>
            )}

            {nd.nearestCandidates.length > 0 && (
              <div style={{ fontSize: 9, color: '#8b949e', marginBottom: 4 }}>
                Nearest: {nd.nearestCandidates.slice(0, 4).join(', ')}
              </div>
            )}

            {nd.momentumPockets && (
              <div style={{ background: nd.momentumPockets.detected ? 'rgba(88,166,255,0.08)' : 'rgba(139,148,158,0.05)', borderRadius: 4, padding: '4px 6px', marginBottom: 4 }}>
                <div style={{ fontSize: 9, color: nd.momentumPockets.detected ? '#58a6ff' : '#8b949e', fontWeight: 600, marginBottom: 2 }}>
                  Momentum pockets: {nd.momentumPockets.detected ? `found (${nd.momentumPockets.count})` : 'none found'}
                  {nd.momentumPockets.detected && <span style={{ color: '#8b949e', fontWeight: 400 }}> — local setups, not BUY-ready. Needs fresh book, spread OK, TP room, no overextension.</span>}
                </div>
                {nd.momentumPockets.detected && nd.momentumPockets.entries.slice(0, 3).map((entry, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#8b949e', marginTop: 1 }}>
                    <span style={{ color: '#c9d1d9' }}>{entry.symbol.replace('USDT', '')}</span>
                    <span>+{entry.momentum.toFixed(1)}% <span style={{ color: entry.entryGatePassed ? '#3fb950' : '#da3633' }}>{entry.entryGatePassed ? 'EG✓' : 'EG✗'}</span> {entry.blocker ? (<span style={{ color: '#da3633' }}>✗{entry.blocker.slice(0, 14)}</span>) : (<span style={{ color: '#3fb950' }}>✓ok</span>)}</span>
                  </div>
                ))}
                {nd.momentumPockets.count > 3 && (
                  <div style={{ fontSize: 8, color: '#484f58', marginTop: 1 }}>+{nd.momentumPockets.count - 3} more</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
});
