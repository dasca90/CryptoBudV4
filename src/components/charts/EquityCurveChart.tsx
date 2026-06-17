import { useMemo } from 'react';

interface TradePnLPoint {
  tradeNumber: number;
  cumulativePnl: number;
  tradePnl: number;
  symbol: string;
}

interface Props {
  data: { time: number; equity: number }[];
  tradePnL?: TradePnLPoint[];
  height?: number;
  width?: number;
  winRate?: number;
  totalTrades?: number;
  totalPnl?: number;
}

export function EquityCurveChart({
  data,
  tradePnL,
  height = 140,
  width = 520,
  winRate,
  totalTrades,
  totalPnl,
}: Props) {
  const chartData = tradePnL && tradePnL.length > 0
    ? tradePnL.map((p, i) => ({ x: i, y: p.cumulativePnl }))
    : data.map((d, i) => ({ x: i, y: d.equity }));

  const svgContent = useMemo(() => {
    if (chartData.length < 2) return null;

    const values = chartData.map(d => d.y);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    const range = max - min || 1;
    const padTop = 16;
    const padBottom = 20;
    const padLeft = 2;
    const padRight = 2;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const step = chartData.length > 1 ? plotW / (chartData.length - 1) : plotW;
    const yScale = (v: number) => padTop + plotH - ((v - min) / range) * plotH;

    const points = chartData.map((d, i) => `${(padLeft + i * step).toFixed(1)},${yScale(d.y).toFixed(1)}`).join(' ');
    const fillPoints = `${padLeft},${height} ${points} ${padLeft + (chartData.length - 1) * step},${height}`;

    const lastValue = values[values.length - 1];
    const isPositive = lastValue >= 0;
    const stroke = isPositive ? '#3fb950' : '#f85149';
    const fillTop = isPositive ? '#3fb950' : '#f85149';
    const fillId = isPositive ? 'equity-fill-green' : 'equity-fill-red';

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillTop} stopOpacity={0.18} />
            <stop offset="100%" stopColor={fillTop} stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={padLeft} y1={yScale(0)} x2={padLeft + plotW} y2={yScale(0)} stroke="#30363d" strokeWidth={0.5} strokeDasharray="3,3" />
        <polygon points={fillPoints} fill={`url(#${fillId})`} />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    );
  }, [chartData, height, width]);

  const netPnl = tradePnL && tradePnL.length > 0
    ? tradePnL[tradePnL.length - 1].cumulativePnl
    : (totalPnl ?? (data.length > 0 ? data[data.length - 1].equity : 0));
  const isPositive = netPnl >= 0;

  if (chartData.length < 2) {
    return (
      <div className="ml-equity-card">
        <div className="panel-section-title">EQUITY CURVE</div>
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 11 }}>
          No closed trades yet.
        </div>
      </div>
    );
  }

  return (
    <div className="ml-equity-card">
      <div className="panel-section-title">EQUITY CURVE</div>
      <div className="ml-equity-stats">
        <div className="ml-equity-stat">
          <span className="ml-equity-stat-label">Trades</span>
          <span className="ml-equity-stat-value">{tradePnL?.length ?? totalTrades ?? chartData.length}</span>
        </div>
        <div className="ml-equity-stat">
          <span className="ml-equity-stat-label">Win Rate</span>
          <span className="ml-equity-stat-value" style={{ color: (winRate ?? 0) >= 50 ? '#3fb950' : '#f85149' }}>
            {winRate != null ? `${winRate}%` : '—'}
          </span>
        </div>
        <div className="ml-equity-stat">
          <span className="ml-equity-stat-label">Net PnL</span>
          <span className="ml-equity-stat-value" style={{ color: isPositive ? '#3fb950' : '#f85149' }}>
            {netPnl >= 0 ? '+' : ''}{netPnl.toFixed(2)}{netPnl >= 0 ? '$' : '$'}
          </span>
        </div>
        {tradePnL && tradePnL.length > 0 && (
          <div className="ml-equity-stat">
            <span className="ml-equity-stat-label">Best</span>
            <span className="ml-equity-stat-value" style={{ color: '#3fb950' }}>
              +{Math.max(...tradePnL.map(p => p.tradePnl)).toFixed(2)}$
            </span>
          </div>
        )}
        {tradePnL && tradePnL.length > 0 && (
          <div className="ml-equity-stat">
            <span className="ml-equity-stat-label">Worst</span>
            <span className="ml-equity-stat-value" style={{ color: '#f85149' }}>
              {Math.min(...tradePnL.map(p => p.tradePnl)).toFixed(2)}$
            </span>
          </div>
        )}
      </div>
      <div style={{ width: '100%', height }}>
        {svgContent}
      </div>
    </div>
  );
}
