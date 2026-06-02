import { useMemo } from 'react';

interface Props {
  data: { time: number; equity: number }[];
  height?: number;
}

export function EquityCurveChart({ data, height = 120 }: Props) {
  const svgContent = useMemo(() => {
    if (data.length < 2) return null;

    const equities = data.map(d => d.equity);
    const min = Math.min(...equities);
    const max = Math.max(...equities);
    const range = max - min || 1;
    const width = 300;
    const step = width / (data.length - 1);

    const points = data.map((d, i) => `${(i * step).toFixed(1)},${(height - ((d.equity - min) / range) * (height - 20) - 10).toFixed(1)}`).join(' ');
    const fillPoints = `${points} ${width},${height} 0,${height}`;

    return (
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3fb950" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#3fb950" stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#equity-fill)" />
        <polyline points={points} fill="none" stroke="#3fb950" strokeWidth={1.5} />
        <text x={4} y={height - 2} fill="#8b949e" fontSize={9}>${equities[equities.length - 1].toFixed(0)}</text>
      </svg>
    );
  }, [data, height]);

  if (data.length < 2) {
    return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#484f58', fontSize: 11 }}>No equity data yet.</div>;
  }

  return <div style={{ width: '100%', height }}>{svgContent}</div>;
}
