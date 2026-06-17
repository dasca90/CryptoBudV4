import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import type { AnimationDebugState, CoinVisualState, MockScannerCoin, OpenPositionVisualRow, ScreenPoint } from '../state/airScannerVisualState';
import { scanChecklist } from '../state/mockScannerFeed';
import { createOpenPositionTransferAudit, createOscillatingTransferBeamPath, createTransferBeamPath, getOpenPositionRowAnchor, shouldStartOpenPositionTransfer } from '../utils/openPositionTransfer';
import { getVisualStateLabel } from '../utils/visualStateMapper';

interface ScannerHUDProps {
  visualState: CoinVisualState;
  debug: AnimationDebugState;
  openPositions: OpenPositionVisualRow[];
  openPositionConfirmed: boolean;
  transferSource: ScreenPoint | null;
  transferLifecycleId: number;
  selectedCoin: MockScannerCoin | null;
}

interface TransferBeamState {
  path: string;
  wavePathA: string;
  wavePathB: string;
  source: ScreenPoint;
  target: ScreenPoint;
  startedAt: string;
  lifecycleId: number;
}

const TRANSFER_VISUAL_DURATION_MS = 30_000;

const transferAtoms = Array.from({ length: 72 }, (_, index) => ({
  delay: index * 0.245,
  radius: 0.9 + (index % 5) * 0.24,
  duration: 1.85 + (index % 6) * 0.075,
  opacity: 0.9 - (index % 7) * 0.05,
}));

const transferStreamParticles = Array.from({ length: 34 }, (_, index) => ({
  delay: index * 0.13,
  radius: 1.15 + (index % 4) * 0.26,
  duration: 1.08 + (index % 5) * 0.08,
  opacity: 0.86 - (index % 6) * 0.055,
  path: index % 2 === 0 ? 'wavePathA' : 'wavePathB',
}));

function OpenPositionTransferOverlay({
  source,
  openPositionConfirmed,
  lifecycleId,
  stageRef,
  rowRefs,
}: {
  source: ScreenPoint | null;
  openPositionConfirmed: boolean;
  lifecycleId: number;
  stageRef: RefObject<HTMLDivElement>;
  rowRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  const completedLifecyclesRef = useRef(new Set<number>());
  const skippedLifecycleRef = useRef<number | null>(null);
  const [beam, setBeam] = useState<TransferBeamState | null>(null);

  useEffect(() => {
    if (!openPositionConfirmed) {
      setBeam(null);
      return;
    }
    if (completedLifecyclesRef.current.has(lifecycleId)) return;

    const stage = stageRef.current;
    const row = rowRefs.current.UNIUSDT;
    const decision = shouldStartOpenPositionTransfer({
      symbol: 'UNIUSDT',
      expectedSymbol: 'UNIUSDT',
      openPositionConfirmed,
      rowFound: Boolean(row),
      targetPanelMounted: Boolean(stage),
      lifecycleId,
      completedLifecycles: completedLifecyclesRef.current,
    });

    if (!source || !decision.start) {
      if (skippedLifecycleRef.current !== lifecycleId && decision.reason) {
        skippedLifecycleRef.current = lifecycleId;
        console.info('OPEN_POSITION_TRANSFER_SKIPPED', {
          symbol: 'UNIUSDT',
          reason: !source ? 'open position not confirmed' : decision.reason,
          timestamp: new Date().toISOString(),
        });
      }
      return;
    }

    if (!stage || !row) return;
    completedLifecyclesRef.current.add(lifecycleId);
    const startedAt = new Date().toISOString();
    const target = getOpenPositionRowAnchor(stage.getBoundingClientRect(), row.getBoundingClientRect());
    const nextBeam = {
      path: createTransferBeamPath(source, target),
      wavePathA: createOscillatingTransferBeamPath(source, target, 0.2),
      wavePathB: createOscillatingTransferBeamPath(source, target, Math.PI * 0.92),
      source,
      target,
      startedAt,
      lifecycleId,
    };

    setBeam(nextBeam);
    console.info('OPEN_POSITION_TRANSFER_AUDIT', createOpenPositionTransferAudit({
      symbol: 'UNIUSDT',
      rowFound: true,
      rowHighlighted: true,
      beamStartedAt: startedAt,
    }));

    const completeId = window.setTimeout(() => {
      console.info('OPEN_POSITION_TRANSFER_AUDIT', createOpenPositionTransferAudit({
        symbol: 'UNIUSDT',
        rowFound: true,
        rowHighlighted: true,
        beamStartedAt: startedAt,
        beamCompletedAt: new Date().toISOString(),
      }));
      setBeam(null);
    }, TRANSFER_VISUAL_DURATION_MS);

    return () => window.clearTimeout(completeId);
  }, [source, openPositionConfirmed, lifecycleId, rowRefs, stageRef]);

  if (!beam) return null;

  return (
    <svg className="air-lab-transfer-overlay" aria-hidden="true">
      <defs>
        <filter id="air-lab-transfer-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="air-lab-transfer-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2dffe1" stopOpacity="0.15" />
          <stop offset="42%" stopColor="#6dffd7" stopOpacity="1" />
          <stop offset="100%" stopColor="#18ff9c" stopOpacity="0.92" />
        </linearGradient>
      </defs>
      <path className="air-lab-transfer-path-glow" d={beam.path} />
      <path className="air-lab-transfer-path-core" d={beam.path}>
        <animate attributeName="d" values={`${beam.path};${beam.wavePathA};${beam.wavePathB};${beam.path}`} dur="3.2s" repeatCount="indefinite" />
      </path>
      {transferStreamParticles.map((orb, index) => {
        const particlePath = orb.path === 'wavePathA' ? beam.wavePathA : beam.wavePathB;
        return (
          <circle
            key={`stream-${orb.delay}-${index}`}
            className="air-lab-transfer-stream-particle"
            r={orb.radius}
            style={{ '--orb-opacity': orb.opacity } as CSSProperties}
          >
            <animateMotion dur={`${orb.duration}s`} begin={`${orb.delay}s`} repeatCount="indefinite" path={particlePath} />
            <animate attributeName="opacity" values={`0;${orb.opacity};${orb.opacity};0`} keyTimes="0;0.18;0.78;1" dur={`${orb.duration}s`} begin={`${orb.delay}s`} repeatCount="indefinite" />
          </circle>
        );
      })}
      {transferAtoms.map((orb, index) => (
        <circle
          key={`${orb.delay}-${index}`}
          className="air-lab-transfer-atom"
          r={orb.radius}
          style={{ '--orb-opacity': orb.opacity } as CSSProperties}
        >
          <animateMotion dur={`${orb.duration}s`} begin={`${orb.delay}s`} repeatCount="1" fill="freeze" path={beam.path} />
          <animate attributeName="r" values={`${orb.radius};${Math.max(0.45, orb.radius * 0.46)}`} dur={`${orb.duration}s`} begin={`${orb.delay}s`} fill="freeze" />
          <animate attributeName="opacity" values={`${orb.opacity};${orb.opacity};0`} keyTimes="0;0.72;1" dur={`${orb.duration}s`} begin={`${orb.delay}s`} fill="freeze" />
        </circle>
      ))}
    </svg>
  );
}

export function ScannerHUD({ visualState, debug, openPositions, openPositionConfirmed, transferSource, transferLifecycleId, selectedCoin }: ScannerHUDProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const showScanPanel = visualState === 'scanning';
  const showWaitPanel = visualState === 'wait';
  const showBlockedPanel = visualState === 'blocked_push_out';

  return (
    <div ref={stageRef} className="air-lab-hud" aria-label="Scanner visual telemetry">
      <OpenPositionTransferOverlay
        source={transferSource}
        openPositionConfirmed={openPositionConfirmed}
        lifecycleId={transferLifecycleId}
        stageRef={stageRef}
        rowRefs={rowRefs}
      />
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

      {selectedCoin && (
        <section className="air-lab-selected-card">
          <header>
            <b>{selectedCoin.base}</b>
            <span>{selectedCoin.symbol}</span>
          </header>
          <strong>{selectedCoin.price}</strong>
          <p>Score {selectedCoin.score} / 100</p>
          <div>
            <span>{selectedCoin.group}</span>
            <span>Risk {selectedCoin.risk}</span>
          </div>
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
          <div
            key={row.symbol}
            ref={(node) => {
              rowRefs.current[row.symbol] = node;
            }}
            data-symbol={row.symbol}
            className={`air-lab-position-grid ${row.highlighted ? 'is-highlighted' : ''}`}
          >
            <span className="air-lab-symbol-cell">
              {row.symbol}
              {row.highlighted && <em>NEW</em>}
            </span>
            <span>{row.state}</span>
            <span>{row.entry}</span>
            <span>{row.value}</span>
            <span>{row.pnlPct}</span>
            <span>{row.pnlUsd}</span>
            <span>{row.risk}</span>
            {row.highlighted && <i className="air-lab-ecg-line" aria-hidden="true" />}
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
