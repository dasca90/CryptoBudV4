import type { TradeV4CandidateView, TradeV4NoBuyDisplay } from "./types";

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
}) {
  const buyCount = props.candidates.filter(c => c.status === 'BUY').length;
  const waitCount = props.candidates.filter(c => c.status === 'WAIT').length;
  const blockCount = props.candidates.filter(c => c.status === 'BLOCK').length;
  const avoidCount = props.candidates.filter(c => c.status === 'AVOID').length;
  const pool = props.noBuyDisplay;
  const hasPoolData = props.executionPoolSize != null;

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

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10, overflow: 'hidden auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
            <PoolBox label="Exec Pool" value={hasPoolData ? String(props.executionPoolSize) : 'n/a'} color="#58a6ff" />
            <PoolBox label="Watch Pool" value={hasPoolData ? String(props.watchPoolSize) : 'n/a'} color="#d29922" />
            <PoolBox label="Near Miss" value={hasPoolData ? String(props.nearMissPoolSize) : 'n/a'} color="#f0883e" />
            <PoolBox label="BUY" value={String(buyCount)} color="#3fb950" />
            <PoolBox label="WAIT" value={String(waitCount)} color="#d29922" />
            <PoolBox label="BLOCK" value={String(blockCount)} color="#f85149" />
            <PoolBox label="AVOID" value={String(avoidCount)} color="#8b949e" />
            <PoolBox label="Ref Period" value={props.referencePeriod ?? '1h'} color="#8b949e" />
          </div>

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

              {/* V3 market verdict summary */}
              {pool && pool.marketAction && (
                <div style={{ color: '#8b949e', marginBottom: 2, lineHeight: '14px', fontSize: 8 }}>
                  Market: <strong style={{ color: pool.marketAction === 'risk_off' ? '#f85149' : pool.marketAction === 'selective_entries' ? '#3fb950' : '#d29922' }}>{pool.marketAction.replace(/_/g, ' ')}</strong>
                  {' | '}
                  HTF: <strong style={{ color: '#8b949e' }}>{pool.htf?.toUpperCase()}</strong>
                  {' | Fit: '}<strong style={{ color: '#58a6ff' }}>{pool.bestFit}</strong>
                  {' | Conf: '}<strong style={{ color: (pool.marketConfidence ?? 0) >= 60 ? '#3fb950' : '#d29922' }}>{pool.marketConfidence ?? '?'}%</strong>
                  {pool.ltf === 'not_confirmed' && <span style={{ color: '#f85149' }}> LTF unconfirmed</span>}
                </div>
              )}

              {topCandidate && (
                <div style={{ marginBottom: 2 }}>
                  <span style={{ color: '#8b949e' }}>Closest: </span>
                  <span style={{ color: '#d8e6ff', fontWeight: 700 }}>{topCandidate.symbol.replace('USDT', '')}</span>
                  <span style={{ color: '#7a8ea8' }}> s{topCandidate.score?.toFixed(0) || '?'}</span>
                  <span style={{ color: topCandidate.confidence >= 60 ? '#3fb950' : '#d29922' }}>{topCandidate.confidence.toFixed(0)}%</span>
                  <span style={{ color: '#8b949e' }}> {topCandidate.strategy}</span>
                  <span style={{ color: topCandidate.status === 'WAIT' ? '#d29922' : '#f85149', fontWeight: 600 }}>{topCandidate.status}</span>
                </div>
              )}
              {topCandidate && (() => {
                const { hard, soft } = classifyBlockers(topCandidate.blockReasons || []);
                if (hard.length > 0 || soft.length > 0) {
                  return (
                    <>
                      {hard.length > 0 ? (
                        <div style={{ color: '#f85149', marginBottom: 1 }}>
                          Blocked: {hard.slice(0, 3).join(', ')}
                        </div>
                      ) : (
                        <div style={{ color: '#d29922', marginBottom: 1 }}>
                          Waiting: {soft.slice(0, 3).join(', ') || topCandidate.mainReason?.slice(0, 50)}
                        </div>
                      )}
                      <div style={{ color: '#484f58' }}>
                        {hard.length > 0 ? 'Hard safety gates blocking. Check Entry Quality settings.' : 'Soft confirmation needed. Wait for next scan or adjust Scanner Ref Period.'}
                      </div>
                    </>
                  );
                }
                return null;
              })()}

              {/* Required next condition for dip_and_rebound */}
              {pool && pool.requiredNextCondition && pool.requiredNextCondition.length > 0 && (
                <div style={{ color: '#58a6ff', marginTop: 1, fontSize: 8 }}>
                  Need: {pool.requiredNextCondition.join(', ')}
                </div>
              )}

              {/* Momentum pockets */}
              {pool && pool.momentumPockets && (
                <div style={{ color: pool.momentumPockets.detected ? '#58a6ff' : '#484f58', marginTop: 1, fontSize: 8 }}>
                  {pool.momentumPockets.detected
                    ? `Pockets: ${pool.momentumPockets.entries.slice(0, 2).map(e => `${e.symbol.replace('USDT', '')}+${e.momentum.toFixed(1)}%:${e.blocker ? e.blocker.slice(0, 18) : 'ok'}|V${e.volumeRel.toFixed(1)}|S${(e.spreadPct ?? 0).toFixed(1)}%|EG${e.entryGatePassed ? '✓' : '✗'}`).join(', ')}${pool.momentumPockets.count > 2 ? ` +${pool.momentumPockets.count - 2}` : ''}`
                    : 'Pockets: none'}
                </div>
              )}

              {/* Top momentum */}
              {pool && pool.topMomentum && pool.topMomentum.length > 0 && (
                <div style={{ color: '#8b949e', marginTop: 1, fontSize: 8 }}>
                  Movers: {pool.topMomentum.slice(0, 4).map((m, i) => `${m.symbol.replace('USDT', '')}+${m.momentum.toFixed(1)}%${m.entryGatePassed ? '✓' : '✗'}`).join(', ')}
                </div>
              )}

              {bestPumper.length > 0 && bestPumper[0].symbol !== topCandidate?.symbol && (
                <div style={{ marginTop: 2 }}>
                  <span style={{ color: '#8b949e' }}>Moving: </span>
                  <span style={{ color: '#3fb950', fontWeight: 600 }}>{bestPumper[0].symbol.replace('USDT', '')}</span>
                  <span style={{ color: '#58a6ff' }}> +{bestPumper[0].momentum?.toFixed(1)}%</span>
                </div>
              )}

              {bestVHR.length > 0 && bestVHR[0].symbol !== topCandidate?.symbol && (
                <div>
                  <span style={{ color: '#8b949e' }}>High Risk: </span>
                  <span style={{ color: '#f0883e', fontWeight: 600 }}>{bestVHR[0].symbol.replace('USDT', '')}</span>
                  <span style={{ color: '#7a8ea8' }}> s{bestVHR[0].score?.toFixed(0) || '?'}</span>
                  <span style={{ color: '#f85149' }}> {bestVHR[0].status}</span>
                </div>
              )}
            </div>
          )}

          {pool && pool.topReasons.length > 0 && (
            <div style={{ background: 'rgba(210,153,34,0.08)', borderRadius: 4, padding: '4px 6px', marginTop: 2 }}>
              <div style={{ color: '#d29922', fontSize: 9, fontWeight: 600, marginBottom: 2 }}>Main blockers:</div>
              {pool.topReasons.slice(0, 3).map((r, i) => (
                <div key={i} style={{ color: '#8b949e', fontSize: 9, lineHeight: '16px' }}>{i + 1}. {r}</div>
              ))}
            </div>
          )}

          {pool && pool.requiredNextActions.length > 0 && (
            <div style={{ color: '#58a6ff', fontSize: 9, marginTop: 2 }}>
              Next: {pool.requiredNextActions.join(', ')}
            </div>
          )}

          {(!pool || pool.topReasons.length === 0) && props.candidates.length > 0 && (
            <div style={{ color: '#8b949e', fontSize: 9, marginTop: 2 }}>
              Next action: {props.candidates[0]?.requiredNextAction || 'waiting for confirmation'}
            </div>
          )}
        </div>

        <div style={{ width: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

        <div style={{ flex: '0 0 auto', minWidth: 200, overflow: 'hidden auto' }}>
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
      <div style={{ fontSize: 13, fontWeight: 700, color: '#d8e6ff', lineHeight: 1.2 }}>{props.value}</div>
    </div>
  );
}
