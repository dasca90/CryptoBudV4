import type { MarketEdgeRuntimeState } from '../../core/market-edge/MarketEdgeRuntime';
import type { EdgeOutcomeSummary } from '../../core/market-edge/MarketEdgeOutcomeTracker';
import type { MarketEdgeSnapshot } from '../../core/market-edge/types';

export function MarketEdgePanel({ state, top, selected, outcomes }: { state: MarketEdgeRuntimeState; top: ReadonlyArray<MarketEdgeSnapshot>; selected?: Readonly<MarketEdgeSnapshot> | null; outcomes: EdgeOutcomeSummary }) {
  return (
    <div className="panel panel-shell" data-testid="market-edge-panel" style={{ padding: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 800 }}>MARKET EDGE</div>
        <span style={{ fontSize: 9, color: state.mode === 'PRIORITY' ? '#d29922' : state.mode === 'MONITOR' ? '#00eaff' : '#8b949e' }}>{state.mode}</span>
      </div>
      <div className="muted" style={{ fontSize: 9, marginTop: 3 }}>
        {state.health} · {state.perpetualSymbols}/{state.mappedSymbols} perpetual · High {state.highEdgeCount}
      </div>
      <div className="muted" style={{ fontSize: 8, marginTop: 2 }}>
        Groups: {state.selectedRiskGroups.map(group => group.replaceAll('_', ' ')).join(' · ')} · universe {state.mappedSymbols}/{state.sourceUniverseSize}
      </div>
      {(state.health === 'EDGE_WARMING_UP' || state.health === 'EDGE_DEGRADED' || state.health === 'EDGE_OFFLINE') && (
        <div className="muted" style={{ fontSize: 8, marginTop: 2 }} data-testid="market-edge-diagnostics">
          Spot {state.spotWarmSymbols}/{state.spotInputSymbols} warm · Futures {state.futuresWarmSymbols}/{state.futuresInputSymbols} warm · paired {state.synchronizedSymbols}
          {state.primaryBlocker ? ` · ${state.primaryBlocker.replaceAll('_', ' ')}` : ''}
        </div>
      )}
      <div style={{ display: 'grid', gap: 3, marginTop: 6 }}>
        {top.length === 0 && <div className="muted" style={{ fontSize: 9 }}>Waiting for synchronized Spot/Futures windows.</div>}
        {top.slice(0, 4).map(snapshot => (
          <div key={snapshot.symbol} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6, fontSize: 9 }} title={`Lead60 ${snapshot.perpLead60s?.toFixed(3) ?? 'n/a'}% · OI5m ${snapshot.oiChange5m?.toFixed(2) ?? 'n/a'}% · Flow ${snapshot.futuresTakerBuyRatio != null ? (snapshot.futuresTakerBuyRatio * 100).toFixed(0) : 'n/a'}% · ${snapshot.dataQuality}`}>
            <span>{snapshot.symbol.replace('USDT', '')} <span className="muted">{snapshot.edgeSignals[0] ?? snapshot.edgeClass}</span></span>
            <strong style={{ color: snapshot.dataQuality === 'GOOD' ? '#3fb950' : '#d29922' }}>{snapshot.dataQuality === 'UNAVAILABLE' ? '—' : snapshot.edgeScore.toFixed(0)}</strong>
          </div>
        ))}
      </div>
      <div className="muted" style={{ fontSize: 8, marginTop: 5 }}>Futures are public data only. Execution remains Spot via canonical gates.</div>
      <div className="muted" style={{ fontSize: 8, marginTop: 3 }}>
        Monitor outcomes: {outcomes.completed} complete / {outcomes.pending} pending
      </div>
      {outcomes.completed > 0 && (
        <details style={{ marginTop: 4, fontSize: 8 }}>
          <summary>Outcome validation by score</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '2px 6px', marginTop: 3 }}>
            <span className="muted">Bucket</span><span className="muted">N</span><span className="muted">5m+</span><span className="muted">MFE</span>
            {outcomes.buckets.filter(bucket => bucket.completed > 0).map(bucket => (
              <div key={bucket.scoreBucket} style={{ display: 'contents' }}>
                <span>{bucket.scoreBucket}</span><span>{bucket.completed}</span><span>{bucket.positive5mRate == null ? 'n/a' : `${(bucket.positive5mRate * 100).toFixed(0)}%`}</span><span>{bucket.averageMfePct?.toFixed(2) ?? 'n/a'}%</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {selected && (
        <details style={{ marginTop: 6, fontSize: 9 }}>
          <summary>{selected.symbol.replace('USDT', '')} details · {selected.edgeScore.toFixed(0)} {selected.edgeClass}</summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, marginTop: 4 }}>
            <span className="muted">Perp Lead 60s</span><span>{selected.perpLead60s?.toFixed(3) ?? 'n/a'}%</span>
            <span className="muted">Order Flow</span><span>{selected.futuresOFI?.toFixed(2) ?? 'n/a'}</span>
            <span className="muted">OI 5m</span><span>{selected.oiChange5m?.toFixed(2) ?? 'n/a'}%</span>
            <span className="muted">Taker Buy</span><span>{selected.futuresTakerBuyRatio != null ? `${(selected.futuresTakerBuyRatio * 100).toFixed(0)}%` : 'n/a'}</span>
            <span className="muted">Spot Extension</span><span>{selected.spotExtensionPct?.toFixed(2) ?? 'n/a'}%</span>
            <span className="muted">Data</span><span>{selected.dataQuality}</span>
          </div>
        </details>
      )}
    </div>
  );
}
