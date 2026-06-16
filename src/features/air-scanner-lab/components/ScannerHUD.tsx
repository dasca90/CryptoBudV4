import type { AnimationDebugState, CoinVisualState, OpenPositionVisualRow } from '../state/airScannerVisualState';
import { scanChecklist } from '../state/mockScannerFeed';
import { getVisualStateLabel } from '../utils/visualStateMapper';

interface ScannerHUDProps {
  visualState: CoinVisualState;
  debug: AnimationDebugState;
  openPositions: OpenPositionVisualRow[];
}

export function ScannerHUD({ visualState, debug, openPositions }: ScannerHUDProps) {
  const showScanPanel = visualState === 'scanning';
  const showWaitPanel = visualState === 'wait';
  const showBlockedPanel = visualState === 'blocked_push_out';

  return (
    <div className="air-lab-hud" aria-label="Scanner visual telemetry">
      <div className="air-lab-title">
        <span>3D Air Scanner Lab</span>
        <strong>{getVisualStateLabel(visualState)}</strong>
      </div>

      {showScanPanel && (
        <section className="air-lab-floating air-lab-scan-card">
          <b>Scanning</b>
          {scanChecklist.map((item, index) => (
            <span key={item}>
              {item}
              <em>{index < 3 ? '✓' : '○'}</em>
            </span>
          ))}
        </section>
      )}

      {showWaitPanel && (
        <section className="air-lab-floating air-lab-wait-card">
          <b>MATIC / USDT</b>
          <strong>STATE 02 - WAIT</strong>
          <p>Waiting for confirmation</p>
          <span>Rebound pending</span>
          <span>Momentum building</span>
          <span>Breakout confirmation pending</span>
        </section>
      )}

      {showBlockedPanel && (
        <section className="air-lab-floating air-lab-block-card">
          <b>SUI / USDT</b>
          <strong>STATE 04 - BLOCKED</strong>
          {['No take profit room', 'Spread too high', 'Duplicate lock', 'Risk block'].map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </section>
      )}

      <section className="air-lab-positions">
        <header>
          <b>Open Positions</b>
          <span>{openPositions.length}/50</span>
        </header>
        <div className="air-lab-position-grid air-lab-position-head">
          <span>Symbol</span>
          <span>State</span>
          <span>Entry</span>
          <span>Value</span>
          <span>P/L %</span>
          <span>P/L $</span>
          <span>Risk</span>
        </div>
        {openPositions.map((row) => (
          <div key={row.symbol} className={`air-lab-position-grid ${row.highlighted ? 'is-highlighted' : ''}`}>
            <span>{row.symbol}</span>
            <span>{row.state}</span>
            <span>{row.entry}</span>
            <span>{row.value}</span>
            <span>{row.pnlPct}</span>
            <span>{row.pnlUsd}</span>
            <span>{row.risk}</span>
          </div>
        ))}
      </section>

      <section className="air-lab-debug">
        <header>Visual Debug</header>
        <span>FPS <b>{debug.fpsEstimate}</b></span>
        <span>Particles <b>{debug.activeParticles}</b></span>
        <span>Lightning <b>{debug.activeLightningEffects}</b></span>
        <span>Animations <b>{debug.activeAnimations}</b></span>
        <span>Coins <b>{debug.renderedCoins}</b></span>
      </section>
    </div>
  );
}
