interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function MiniSparkline({ data, width = 80, height = 24, color = '#58a6ff' }: Props) {
  if (data.length < 2) return <span style={{ color: '#484f58', fontSize: 10 }}>no data</span>;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * (height - 4) - 2).toFixed(1)}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
