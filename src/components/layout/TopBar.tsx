import { StatusBadge } from '../ui/StatusBadge';
import { PersistenceBadge } from '../ui/PersistenceBadge';
import type { LiveSafetyState, LiveSafetyCheckResult } from '../../core/types';

interface Props {
  liveState: LiveSafetyState;
  liveCheckResult: LiveSafetyCheckResult | null;
  isRunning: boolean;
  totalEquity: number;
  openPositionCount: number;
  adapterName: string;
  persistenceStatus: 'OK' | 'FALLBACK' | 'ERROR' | 'CHECKING';
  onStart: () => void;
  onStop: () => void;
  onEmergencyStop: () => void;
  onRunLiveCheck: () => void;
  onExportTrades: () => void;
  onExportML: () => void;
  onExportTraining: () => void;
}

function liveBadgeVariant(state: LiveSafetyState) {
  switch (state) {
    case 'LIVE_DISABLED': case 'LIVE_BLOCKED': case 'LIVE_STOPPED': return 'PAPER' as const;
    case 'LIVE_READY': return 'LIVE_READY' as const;
    case 'LIVE_RUNNING': return 'LIVE_RUNNING' as const;
    default: return 'LIVE_LOCKED' as const;
  }
}

function renderLiveButton(state: LiveSafetyState, onCheck: () => void) {
  switch (state) {
    case 'LIVE_DISABLED': case 'LIVE_STOPPED':
      return <button className="btn btn-sm btn-outline" onClick={onCheck}>Run Live Check</button>;
    case 'LIVE_CHECK_REQUIRED':
      return <button className="btn btn-sm btn-yellow" onClick={onCheck}>Run Live Check</button>;
    case 'LIVE_CHECK_RUNNING':
      return <button className="btn btn-sm" disabled>Checking...</button>;
    case 'LIVE_READY':
      return <button className="btn btn-sm btn-green glow-button" onClick={onCheck}>Ready — Start Live</button>;
    case 'LIVE_RUNNING':
      return <button className="btn btn-sm btn-red" onClick={onCheck}>Stop Live</button>;
    case 'LIVE_BLOCKED':
      return <button className="btn btn-sm btn-red" onClick={onCheck}>Live Blocked</button>;
    case 'LIVE_ERROR':
      return <button className="btn btn-sm btn-red" onClick={onCheck}>Error — Retry</button>;
    default:
      return null;
  }
}

export function TopBar({
  liveState, isRunning, totalEquity, openPositionCount, adapterName, persistenceStatus,
  onStart, onStop, onEmergencyStop, onRunLiveCheck,
  onExportTrades, onExportML, onExportTraining,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">⟠ CryptoBud V4</h1>
        <StatusBadge variant={liveBadgeVariant(liveState)} />
        <PersistenceBadge status={persistenceStatus} />
        <span className="topbar-stat">
          Equity: <strong>${totalEquity.toFixed(2)}</strong>
        </span>
        <span className="topbar-stat">
          Positions: <strong>{openPositionCount}</strong>
        </span>
        {isRunning && <span className="topbar-running">RUNNING</span>}
      </div>
      <div className="topbar-right">
        <button className="btn btn-sm" onClick={onExportTrades}>Export Journal</button>
        <button className="btn btn-sm" onClick={onExportML}>Export ML</button>
        <button className="btn btn-sm" onClick={onExportTraining}>Export Training</button>
        {renderLiveButton(liveState, onRunLiveCheck)}
        <button
          className={`btn btn-sm ${isRunning ? 'btn-red btn-glow-sell' : 'btn-green btn-glow-buy'}`}
          onClick={isRunning ? onStop : onStart}
        >
          {isRunning ? 'STOP' : 'START'}
        </button>
        {isRunning && (
          <button
            className="btn btn-sm btn-red btn-glow-sell"
            style={{ fontWeight: 700 }}
            onClick={onEmergencyStop}
          >
            ⚠ EMERGENCY STOP
          </button>
        )}
      </div>
    </header>
  );
}
