export interface ScreenPoint {
  x: number;
  y: number;
}

export interface DomRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OpenPositionTransferAudit {
  symbol: string;
  sourceState: 'open_position';
  targetPanel: 'open_positions';
  rowFound: boolean;
  rowHighlighted: boolean;
  beamStartedAt: string;
  beamCompletedAt?: string;
  timestamp: string;
}

export type OpenPositionTransferSkipReason =
  | 'row not found'
  | 'open position not confirmed'
  | 'duplicate lifecycle event'
  | 'target panel unmounted'
  | 'symbol mismatch';

export function getOpenPositionRowAnchor(stageRect: DomRectLike, rowRect: DomRectLike): ScreenPoint {
  return {
    x: rowRect.left - stageRect.left,
    y: rowRect.top - stageRect.top + rowRect.height / 2,
  };
}

export function createTransferBeamPath(source: ScreenPoint, target: ScreenPoint): string {
  const dx = target.x - source.x;
  const lift = Math.min(120, Math.max(46, Math.abs(dx) * 0.12));
  const c1 = { x: source.x + dx * 0.36, y: source.y - lift };
  const c2 = { x: target.x - dx * 0.26, y: target.y - lift * 0.4 };
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
}

export function createOscillatingTransferBeamPath(source: ScreenPoint, target: ScreenPoint, phase: number): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  const lift = Math.min(128, Math.max(52, Math.abs(dx) * 0.14));
  const wave = Math.sin(phase) * 26;
  const counterWave = Math.cos(phase * 0.78) * 18;
  const c1 = {
    x: source.x + dx * 0.28 + normal.x * wave,
    y: source.y - lift + normal.y * wave,
  };
  const c2 = {
    x: source.x + dx * 0.68 - normal.x * counterWave,
    y: target.y - lift * 0.52 - normal.y * counterWave,
  };
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`;
}

export function shouldStartOpenPositionTransfer(input: {
  symbol: string;
  expectedSymbol: string;
  openPositionConfirmed: boolean;
  rowFound: boolean;
  targetPanelMounted: boolean;
  lifecycleId: number;
  completedLifecycles: Set<number>;
}): { start: boolean; reason?: OpenPositionTransferSkipReason } {
  if (input.symbol !== input.expectedSymbol) return { start: false, reason: 'symbol mismatch' };
  if (!input.openPositionConfirmed) return { start: false, reason: 'open position not confirmed' };
  if (!input.targetPanelMounted) return { start: false, reason: 'target panel unmounted' };
  if (!input.rowFound) return { start: false, reason: 'row not found' };
  if (input.completedLifecycles.has(input.lifecycleId)) return { start: false, reason: 'duplicate lifecycle event' };
  return { start: true };
}

export function createOpenPositionTransferAudit(input: {
  symbol: string;
  rowFound: boolean;
  rowHighlighted: boolean;
  beamStartedAt: string;
  beamCompletedAt?: string;
}): OpenPositionTransferAudit {
  return {
    symbol: input.symbol,
    sourceState: 'open_position',
    targetPanel: 'open_positions',
    rowFound: input.rowFound,
    rowHighlighted: input.rowHighlighted,
    beamStartedAt: input.beamStartedAt,
    beamCompletedAt: input.beamCompletedAt,
    timestamp: new Date().toISOString(),
  };
}
