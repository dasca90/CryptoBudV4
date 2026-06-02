import { useMemo } from 'react';

interface Props {
  data: { time: number; price: number }[];
  entryPrice?: number;
  tp1Price?: number;
  tp2Price?: number;
  slPrice?: number;
  height?: number;
}

export function PriceChart({ data, entryPrice, tp1Price, tp2Price, slPrice, height = 200 }: Props) {
  const svgContent = useMemo(() => {
    if (data.length < 2) return null;

    const prices = data.map(d => d.price);
    const min = Math.min(...prices, entryPrice ?? Infinity, tp1Price ?? Infinity, slPrice ?? Infinity);
    const max = Math.max(...prices, entryPrice ?? -Infinity, tp1Price ?? -Infinity, slPrice ?? -Infinity);
    const range = max - min || 1;
    const width = 400;
    const step = width / (data.length - 1);

    const points = data.map((d, i) => `${(i * step).toFixed(1)},${(height - ((d.price - min) / range) * (height - 20) - 10).toFixed(1)}`).join(' ');

    const lines: JSX.Element[] = [];
    const addLine = (y: number, color: string, label: string, price: number) => {
      if (!isFinite(y)) return;
      lines.push(
        <line key={label} x1={0} y1={y} x2={width} y2={y} stroke={color} strokeWidth={1} strokeDasharray="4 2" opacity={0.6} />,
      );
      lines.push(
        <text key={`${label}_lbl`} x={width - 4} y={y - 3} fill={color} fontSize={10} textAnchor="end">{label} ${price.toFixed(1)}</text>,
      );
    };

    if (entryPrice) addLine(height - ((entryPrice - min) / range) * (height - 20) - 10, '#58a6ff', 'Entry', entryPrice);
    if (tp1Price) addLine(height - ((tp1Price - min) / range) * (height - 20) - 10, '#3fb950', 'TP1', tp1Price);
    if (tp2Price) addLine(height - ((tp2Price - min) / range) * (height - 20) - 10, '#2ea043', 'TP2', tp2Price);
    if (slPrice) addLine(height - ((slPrice - min) / range) * (height - 20) - 10, '#f85149', 'SL', slPrice);

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="#58a6ff" strokeWidth={1.5} />
        {lines}
        <text x={4} y={height - 2} fill="#8b949e" fontSize={9}>${prices[prices.length - 1].toFixed(2)}</text>
      </svg>
    );
  }, [data, entryPrice, tp1Price, tp2Price, slPrice, height]);

  if (data.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 13 }}>No chart data yet.</div>;
  }

  return <div style={{ width: '100%', height }}>{svgContent}</div>;
}
