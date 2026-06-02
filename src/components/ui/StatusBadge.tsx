interface Props {
  variant: 'PAPER' | 'LIVE_LOCKED' | 'LIVE_READY' | 'LIVE_RUNNING'
    | 'AUTO' | 'MANUAL' | 'SCALPER'
    | 'BUY' | 'WAIT' | 'BLOCK' | 'AVOID'
    | 'GOOD' | 'MEDIUM' | 'BAD'
    | 'TRAINING' | 'ADVISORY' | 'EXCLUDED'
    | 'OPEN' | 'CLOSED'
    | 'LIVE' | 'STALE' | 'DEAD' | 'OFFLINE'
    | 'RUNNING' | 'STOPPED' | 'IDLE';
  size?: 'sm' | 'md';
  glow?: boolean;
}

const COLORS: Record<string, string> = {
  PAPER: '#d29922',
  LIVE_LOCKED: '#da3633',
  LIVE_READY: '#238636',
  LIVE_RUNNING: '#f85149',
  AUTO: '#58a6ff',
  MANUAL: '#bc8cff',
  SCALPER: '#f0883e',
  BUY: '#3fb950',
  WAIT: '#d29922',
  BLOCK: '#f85149',
  AVOID: '#8b949e',
  GOOD: '#3fb950',
  MEDIUM: '#d29922',
  BAD: '#f85149',
  TRAINING: '#3fb950',
  ADVISORY: '#d29922',
  EXCLUDED: '#8b949e',
  OPEN: '#58a6ff',
  CLOSED: '#8b949e',
  LIVE: '#3fb950',
  STALE: '#d29922',
  DEAD: '#f85149',
  OFFLINE: '#f85149',
  RUNNING: '#3fb950',
  STOPPED: '#8b949e',
  IDLE: '#8b949e',
};

const LABEL_MAP: Record<string, string> = {
  PAPER: 'DEMO',
  LIVE_LOCKED: 'LIVE LOCKED',
  LIVE_READY: 'LIVE READY',
  LIVE_RUNNING: 'LIVE RUNNING',
};

export function StatusBadge({ variant, size = 'sm', glow }: Props) {
  const color = COLORS[variant] || '#8b949e';
  const label = LABEL_MAP[variant] || variant;
  const fontSize = size === 'sm' ? '9px' : '11px';
  const padding = size === 'sm' ? '1px 5px' : '2px 8px';

  return (
    <span
      className={glow ? `status-${variant === 'RUNNING' || variant === 'BUY' || variant === 'LIVE' ? 'running' : variant === 'WAIT' || variant === 'STALE' || variant === 'PAPER' ? 'waiting' : 'loss'}-glow` : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: `${color}18`,
        color,
        border: `1px solid ${color}30`,
        borderRadius: 999,
        padding,
        fontSize,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      <span
        style={{
          width: size === 'sm' ? 5 : 7,
          height: size === 'sm' ? 5 : 7,
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
