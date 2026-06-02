interface Props {
  status: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING';
}

export function PersistenceBadge({ status }: Props) {
  const label = status === 'OK' ? 'DB OK' : status === 'FALLBACK' ? 'DB FALLBACK' : status === 'ERROR' ? 'DB ERROR' : 'DB CHECKING';
  const color = status === 'OK' ? '#3fb950' : status === 'FALLBACK' ? '#d29922' : status === 'ERROR' ? '#f85149' : '#8b949e';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 9,
        fontWeight: 600,
        color,
        border: `1px solid ${color}30`,
        padding: '1px 6px',
        borderRadius: 999,
        background: `${color}18`,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
