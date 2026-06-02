import { useState } from 'react';
import type { TraderBrain } from '../core/trading/TraderBrain';
import type { TradingMode } from '../core/types';

interface Props {
  brain: TraderBrain;
  onClosePosition: (coin: string) => void;
}

export function BrainCard({ brain, onClosePosition }: Props) {
  const [price, setPrice] = useState(0);
  const pos = brain.position;

  const handleModeChange = (mode: TradingMode) => {
    (brain.config as { mode: TradingMode }).mode = mode;
  };

  const handleToggle = () => {
    brain.config.enabled = !brain.config.enabled;
  };

  return (
    <div className={`brain-card ${brain.config.enabled ? 'active' : ''} ${pos ? 'in-position' : ''}`}>
      <div className="brain-info">
        <span className="coin">{brain.coin}</span>
        <span className="mode">{brain.mode}</span>
        <span className="price">${price.toFixed(2)}</span>
        {pos && (
          <span className={`pnl ${pos.pnlPercent >= 0 ? 'pos' : 'neg'}`}>
            {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="brain-controls">
        <select className="btn btn-sm" value={brain.mode} onChange={e => handleModeChange(e.target.value as TradingMode)}>
          <option value="AUTO">AUTO</option>
          <option value="MANUAL">MANUAL</option>
          <option value="SCALPER">SCALPER</option>
        </select>
        <button className={`btn btn-sm ${pos ? 'btn-red' : 'btn-outline'}`} onClick={() => onClosePosition(brain.coin)} disabled={!pos}>
          Close
        </button>
        <div className="toggle">
          <div className={`toggle-track ${brain.config.enabled ? 'active' : ''}`} onClick={handleToggle}>
            <div className="toggle-knob" />
          </div>
        </div>
      </div>
    </div>
  );
}
