import { useMemo } from 'react';
import type { TradeV4PageModel } from './types';
import type { TradeV4CandidateView } from './types';

export function ExecutionInsightsPanel(props: {
  model: TradeV4PageModel;
}) {
  const ins = useMemo(() => {
    const c = props.model.candidates ?? [];
    const buyCandidates = c.filter(x => x.status === 'BUY');
    const ep = props.model.executionPlan;
    const nd = props.model.noBuyDisplay;
    return {
      scannerBuyCount: buyCandidates.length,
      entryGatePassed: buyCandidates.filter(x => (x as any).gateAudit?.decision === 'ALLOW' || x.status === 'BUY' && x.finalExecutable !== false).length,
      executionPool: ep?.executionPoolSize ?? props.model.executionPoolSize ?? 0,
      selected: ep?.selectedCandidates?.length ?? 0,
      skipped: ep?.skippedCandidates?.length ?? 0,
      topBlockers: ep?.noBuyReasons ?? nd?.topReasons ?? [],
      momentumPockets: nd?.momentumPockets?.count ?? 0,
      momentumPocketsDetected: nd?.momentumPockets?.detected ?? false,
    };
  }, [props.model]);

  return (
    <section className="panel panel-fill panel-shell" style={{ padding: 0, overflow: 'auto', maxHeight: 220, display: 'flex', flexDirection: 'column' }} data-testid="execution-insights-panel">
      <div className="panel-header-v4" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'rgba(9,15,32,0.95)' }}>
        <div className="panel-title panel-title-v4" style={{ fontSize: 11 }}>EXECUTION INSIGHTS</div>
      </div>
      <div className="panel-body-v4" style={{ padding: '4px 8px', fontSize: 9 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, marginBottom: 6 }}>
          <Metric label="Scanner BUY" value={ins.scannerBuyCount} color="#58a6ff" />
          <Metric label="EntryGate OK" value={ins.entryGatePassed} color="#3fb950" />
          <Metric label="Exec-ready" value={ins.executionPool} color="#d29922" />
          <Metric label="Selected" value={ins.selected} color={ins.selected > 0 ? '#3fb950' : '#f85149'} />
          <Metric label="Skipped" value={ins.skipped} color={ins.skipped > 0 ? '#d29922' : '#8b949e'} />
          <Metric label="Adapter" value={ins.selected > 0 ? 'demo' : '—'} color={ins.selected > 0 ? '#3fb950' : '#8b949e'} />
        </div>

        {ins.topBlockers.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#f85149', fontWeight: 600 }}>Blockers: </span>
            <span style={{ color: '#f85149' }}>{ins.topBlockers.slice(0, 5).join(' | ')}</span>
          </div>
        )}

        {ins.momentumPocketsDetected && (
          <div style={{ marginBottom: 4, color: '#d29922', fontSize: 8 }}>
            Momentum pockets: {ins.momentumPockets} local momentum setups found.
            <br />
            <span style={{ color: '#8b949e' }}>Note: momentum pocket does not mean BUY. Candidate still needs fresh book, spread OK, TP room, no overextension, and market safety.</span>
          </div>
        )}

        {ins.executionPool === 0 && ins.scannerBuyCount > 0 && (
          <div style={{ color: '#f85149', fontSize: 8, marginBottom: 4 }}>
            ⚠ Scanner found {ins.scannerBuyCount} BUY signals, but 0 made it to execution pool.
            Check ENTRYGATE_TO_EXECUTION_DROPPED_AUDIT in logs for per-symbol reasons.
          </div>
        )}
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: '#8b949e', fontSize: 7, marginBottom: 1 }}>{props.label}</div>
      <div style={{ color: props.color, fontWeight: 700, fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}>{props.value}</div>
    </div>
  );
}
