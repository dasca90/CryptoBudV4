import { useState } from 'react';

const COMMON_COINS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'UNIUSDT'];

interface Props {
  onAdd: (coin: string) => void;
}

export function CoinSelector({ onAdd }: Props) {
  const [custom, setCustom] = useState('');

  const handleAdd = (coin: string) => {
    const c = coin.toUpperCase().trim();
    if (c && !c.endsWith('USDT')) {
      onAdd(c + 'USDT');
    } else if (c) {
      onAdd(c);
    }
    setCustom('');
  };

  return (
    <div>
      <div className="add-coin-row">
        <input
          placeholder="Add coin (e.g. BTC or BTCUSDT)"
          value={custom}
          onChange={e => setCustom(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleAdd(custom)}
        />
        <button className="btn btn-green btn-sm" onClick={() => handleAdd(custom)} disabled={!custom}>Add</button>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {COMMON_COINS.map(c => (
          <button key={c} className="btn btn-sm btn-outline" onClick={() => handleAdd(c)}>{c.replace('USDT', '')}</button>
        ))}
      </div>
    </div>
  );
}
