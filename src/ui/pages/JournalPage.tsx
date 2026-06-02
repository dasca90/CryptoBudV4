import { useState, useEffect } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { Journal } from '../../core/persistence/Journal';
import type { TradeRecord, DataQuality } from '../../core/types';
import type { JournalFilter } from '../../state/ui-store';

interface Props {
  journal: Journal;
}

const FILTERS: { key: JournalFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'WINNERS', label: 'Winners' },
  { key: 'LOSERS', label: 'Losers' },
  { key: 'GOOD', label: 'GOOD only' },
  { key: 'MEDIUM', label: 'MEDIUM' },
  { key: 'BAD', label: 'BAD' },
  { key: 'training', label: 'Training eligible' },
  { key: 'excluded', label: 'Excluded' },
];

export function JournalPage({ journal }: Props) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [filter, setFilter] = useState<JournalFilter>('ALL');

  useEffect(() => {
    setTrades(journal.getTrades());
    const interval = setInterval(() => setTrades(journal.getTrades()), 2000);
    return () => clearInterval(interval);
  }, [journal]);

  const filtered = trades.filter(t => {
    if (filter === 'ALL') return true;
    if (filter === 'WINNERS') return (t.pnl ?? 0) > 0;
    if (filter === 'LOSERS') return (t.pnl ?? 0) < 0;
    if (filter === 'GOOD') return t.mlQuality?.dataQuality === 'GOOD';
    if (filter === 'MEDIUM') return t.mlQuality?.dataQuality === 'MEDIUM';
    if (filter === 'BAD') return t.mlQuality?.dataQuality === 'BAD';
    if (filter === 'training') return t.trainingEligible === true;
    if (filter === 'excluded') return t.mlQuality?.mlUse === 'excluded';
    return true;
  });

  const qualityVariant = (q: DataQuality | undefined) => {
    if (q === 'GOOD') return 'GOOD' as const;
    if (q === 'MEDIUM') return 'MEDIUM' as const;
    return 'BAD' as const;
  };

  return (
    <div className="page-panel">
      <div className="panel-section-title">Trade Journal</div>

      <div className="filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-green' : 'btn-outline'}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b949e' }}>
          {filtered.length} of {trades.length} trades
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">No trades yet.</div>
      ) : (
        <div className="journal-table-wrapper">
          <div className="journal-table">
            <div className="journal-row journal-header">
              <span>Symbol</span><span>Mode</span><span>Adapter</span><span>Strategy</span>
              <span>Entry</span><span>Exit</span><span>PnL</span><span>Exit Reason</span>
              <span>Quality</span><span>ML Use</span><span>Training</span>
            </div>
            {filtered.slice().reverse().map((t, i) => (
              <div key={i} className="journal-row" style={{ color: t.pnl && t.pnl > 0 ? '#3fb950' : t.pnl && t.pnl < 0 ? '#f85149' : '#c9d1d9' }}>
                <span style={{ fontWeight: 600 }}>{t.coin.replace('USDT', '')}</span>
                <span>{t.mode}</span>
                <span>{t.adapter}</span>
                <span style={{ fontSize: 10 }}>{t.strategy}</span>
                <span>${t.entryPrice.toFixed(2)}</span>
                <span>{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '-'}</span>
                <span>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '-'}</span>
                <span style={{ fontSize: 10 }}>{t.closeSnapshot?.exitReason ?? '-'}</span>
                <span><StatusBadge variant={qualityVariant(t.mlQuality?.dataQuality)} size="sm" /></span>
                <span style={{ fontSize: 10 }}>{t.mlQuality?.mlUse ?? '-'}</span>
                <span>{t.trainingEligible ? '✓' : '-'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
