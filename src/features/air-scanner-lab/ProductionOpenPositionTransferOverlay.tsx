import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ScreenPoint } from './state/airScannerVisualState';
import { createOscillatingTransferBeamPath, createTransferBeamPath } from './utils/openPositionTransfer';

interface FixedBeamState {
  path: string;
  wavePathA: string;
  wavePathB: string;
  source: ScreenPoint;
  target: ScreenPoint;
  rowFound: boolean;
  startedAt: number;
}

const TRANSFER_DURATION_MS = 30_000;
const streamParticles = Array.from({ length: 28 }, (_, index) => ({
  delay: index * 0.14,
  radius: 1 + (index % 4) * 0.22,
  duration: 1.18 + (index % 5) * 0.08,
  opacity: 0.82 - (index % 5) * 0.055,
  path: index % 2 === 0 ? 'wavePathA' : 'wavePathB',
}));

function cssEscapeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

function resolveOpenPositionsAnchor(symbol?: string | null): { point: ScreenPoint; rowFound: boolean } | null {
  if (typeof document === 'undefined') return null;
  const panel = document.querySelector('[data-testid="open-positions-panel"]');
  if (!panel) return null;
  const normalizedSymbol = symbol?.toUpperCase().trim();
  if (normalizedSymbol) {
    const row = panel.querySelector(`[data-open-position-symbol="${cssEscapeValue(normalizedSymbol)}"]`);
    const rowRect = row?.getBoundingClientRect();
    if (rowRect && rowRect.width > 0 && rowRect.height > 0) {
      return {
        point: {
          x: rowRect.left + Math.min(22, Math.max(10, rowRect.width * 0.035)),
          y: rowRect.top + rowRect.height / 2,
        },
        rowFound: true,
      };
    }
  }
  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    point: {
      x: rect.left,
      y: rect.top + Math.min(72, Math.max(44, rect.height * 0.22)),
    },
    rowFound: false,
  };
}

export function ProductionOpenPositionTransferOverlay(props: {
  active: boolean;
  source: ScreenPoint | null;
  symbol?: string | null;
}) {
  const [beam, setBeam] = useState<FixedBeamState | null>(null);
  const cycleKeyRef = useRef('');
  const sourceRef = useRef<ScreenPoint | null>(null);
  const symbolRef = useRef<string | null | undefined>(null);
  const hasSource = props.source !== null;

  useEffect(() => {
    sourceRef.current = props.source;
    symbolRef.current = props.symbol;
  }, [props.source, props.symbol]);

  useEffect(() => {
    const source = sourceRef.current;
    if (!props.active || !source || !props.symbol) {
      cycleKeyRef.current = '';
      setBeam(null);
      return;
    }

    const nextCycleKey = props.symbol;
    if (cycleKeyRef.current === nextCycleKey) return;

    const targetAnchor = resolveOpenPositionsAnchor(props.symbol);
    if (!targetAnchor) return;

    cycleKeyRef.current = nextCycleKey;
    setBeam({
      path: createTransferBeamPath(source, targetAnchor.point),
      wavePathA: createOscillatingTransferBeamPath(source, targetAnchor.point, 0.2),
      wavePathB: createOscillatingTransferBeamPath(source, targetAnchor.point, Math.PI * 0.92),
      source,
      target: targetAnchor.point,
      rowFound: targetAnchor.rowFound,
      startedAt: Date.now(),
    });

    const timeout = window.setTimeout(() => setBeam(null), TRANSFER_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [hasSource, props.active, props.symbol]);

  useEffect(() => {
    if (!props.active) return;

    let rafId = 0;
    const updateLiveTarget = () => {
      const source = sourceRef.current;
      const symbol = symbolRef.current;
      const targetAnchor = resolveOpenPositionsAnchor(symbol);
      if (source && symbol && targetAnchor) {
        setBeam((current) => {
          const path = createTransferBeamPath(source, targetAnchor.point);
          if (!current) {
            return {
              path,
              wavePathA: createOscillatingTransferBeamPath(source, targetAnchor.point, 0.2),
              wavePathB: createOscillatingTransferBeamPath(source, targetAnchor.point, Math.PI * 0.92),
              source,
              target: targetAnchor.point,
              rowFound: targetAnchor.rowFound,
              startedAt: Date.now(),
            };
          }
          return {
            ...current,
            path,
            wavePathA: createOscillatingTransferBeamPath(source, targetAnchor.point, 0.2),
            wavePathB: createOscillatingTransferBeamPath(source, targetAnchor.point, Math.PI * 0.92),
            source,
            target: targetAnchor.point,
            rowFound: targetAnchor.rowFound,
          };
        });
      }
      rafId = window.requestAnimationFrame(updateLiveTarget);
    };

    rafId = window.requestAnimationFrame(updateLiveTarget);
    return () => window.cancelAnimationFrame(rafId);
  }, [props.active]);

  const visible = useMemo(() => {
    if (!beam) return false;
    return Date.now() - beam.startedAt < TRANSFER_DURATION_MS;
  }, [beam]);

  if (!beam || !visible) return null;

  return (
    <svg className="air-lab-production-transfer-overlay" aria-hidden="true">
      <defs>
        <filter id="air-lab-production-transfer-glow" x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="air-lab-production-transfer-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#28ffe6" stopOpacity="0.22" />
          <stop offset="48%" stopColor="#58ffd1" stopOpacity="0.96" />
          <stop offset="100%" stopColor="#22ffb8" stopOpacity="0.72" />
        </linearGradient>
      </defs>
      <path className="air-lab-production-transfer-glow" d={beam.path} />
      <path className="air-lab-production-transfer-core" d={beam.path}>
        <animate attributeName="d" values={`${beam.path};${beam.wavePathA};${beam.wavePathB};${beam.path}`} dur="3.2s" repeatCount="indefinite" />
      </path>
      {streamParticles.map((particle, index) => {
        const path = particle.path === 'wavePathA' ? beam.wavePathA : beam.wavePathB;
        return (
          <circle
            key={`${particle.delay}-${index}`}
            className="air-lab-production-transfer-particle"
            r={particle.radius}
            style={{ '--orb-opacity': particle.opacity } as CSSProperties}
          >
            <animateMotion dur={`${particle.duration}s`} begin={`${particle.delay}s`} repeatCount="indefinite" path={path} />
            <animate attributeName="opacity" values={`0;${particle.opacity};${particle.opacity};0`} keyTimes="0;0.16;0.78;1" dur={`${particle.duration}s`} begin={`${particle.delay}s`} repeatCount="indefinite" />
          </circle>
        );
      })}
      <circle className={beam.rowFound ? 'air-lab-production-transfer-target-lock' : 'air-lab-production-transfer-target-fallback'} cx={beam.target.x} cy={beam.target.y} r={beam.rowFound ? 8 : 5} />
    </svg>
  );
}
