import { useState, useEffect } from 'react';
import type { TradeRecord } from '../core/types';
import { Journal } from '../core/persistence/Journal';

interface Props {
  journal: Journal;
}

export function TradeHistory({ journal }: Props) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);

  useEffect(() => {
    setTrades(journal.getTrades());
    const interval = setInterval(() => setTrades(journal.getTrades()), 2000);
    return () => clearInterval(interval);
  }, [journal]);

  return (
    <div className="trade-list">
      <div className="trade-row trade-header">
        <span>Coin</span><span>Side</span><span>Mode</span><span>Entry</span><span>Exit</span><span>P&L</span><span>Status</span>
      </div>
      {trades.slice(-50).reverse().map((t, i) => (
        <div key={i} className="trade-row" style={{ color: t.pnl && t.pnl > 0 ? '#3fb950' : t.pnl && t.pnl < 0 ? '#f85149' : '#c9d1d9' }}>
          <span>{t.coin}</span>
          <span>{t.side}</span>
          <span>{t.mode}</span>
          <span>{t.entryPrice.toFixed(2)}</span>
          <span>{t.exitPrice?.toFixed(2) ?? '-'}</span>
          <span>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '-'}</span>
          <span>{t.status}</span>
        </div>
      ))}
    </div>
  );
}
