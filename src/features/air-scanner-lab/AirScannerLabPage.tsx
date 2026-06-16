import { useEffect, useMemo, useState } from 'react';
import { AirScannerCanvas } from './AirScannerCanvas';
import { ScannerHUD } from './components/ScannerHUD';
import { StateControlPanel } from './components/StateControlPanel';
import { confirmedUniPosition, mockOpenPositions } from './state/mockScannerFeed';
import { DEFAULT_TOGGLES, type AirScannerQuality, type AnimationDebugState, type CoinVisualState, type ScannerToggles } from './state/airScannerVisualState';
import './air-scanner-lab.css';

const emptyDebug: AnimationDebugState = {
  fpsEstimate: 0,
  activeParticles: 0,
  activeLightningEffects: 0,
  activeAnimations: 0,
  renderedCoins: 0,
};

const demoSequence: CoinVisualState[] = ['scanning', 'wait', 'buy_pull_to_core', 'open_position', 'blocked_push_out'];

export function AirScannerLabPage() {
  const [visualState, setVisualState] = useState<CoinVisualState>('scanning');
  const [quality, setQuality] = useState<AirScannerQuality>('high');
  const [toggles, setToggles] = useState<ScannerToggles>(DEFAULT_TOGGLES);
  const [debug, setDebug] = useState<AnimationDebugState>(emptyDebug);
  const [lifecycleId, setLifecycleId] = useState(1);
  const [openPositionConfirmed, setOpenPositionConfirmed] = useState(false);

  const openPositions = useMemo(() => (openPositionConfirmed || visualState === 'open_position' ? [confirmedUniPosition, ...mockOpenPositions] : mockOpenPositions), [openPositionConfirmed, visualState]);

  useEffect(() => {
    if (!toggles.autoDemoLoop) return;
    const id = window.setInterval(() => {
      setVisualState((current) => {
        const next = demoSequence[(demoSequence.indexOf(current) + 1) % demoSequence.length] ?? 'scanning';
        setLifecycleId((value) => value + 1);
        if (next !== 'open_position') setOpenPositionConfirmed(false);
        return next;
      });
    }, visualState === 'buy_pull_to_core' ? 21_000 : 5_500);
    return () => window.clearInterval(id);
  }, [toggles.autoDemoLoop, visualState]);

  const handleStateChange = (state: CoinVisualState) => {
    setVisualState(state);
    setLifecycleId((value) => value + 1);
    setOpenPositionConfirmed(state === 'open_position');
  };

  const handleReset = () => {
    setVisualState('scanning');
    setLifecycleId((value) => value + 1);
    setOpenPositionConfirmed(false);
  };

  const handleToggleChange = (key: keyof ScannerToggles, value: boolean) => {
    setToggles((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="air-scanner-lab-page">
      <StateControlPanel
        visualState={visualState}
        quality={quality}
        toggles={toggles}
        onStateChange={handleStateChange}
        onQualityChange={setQuality}
        onToggleChange={handleToggleChange}
        onReset={handleReset}
      />
      <section className="air-lab-stage">
        <AirScannerCanvas
          visualState={visualState}
          quality={quality}
          toggles={toggles}
          lifecycleId={lifecycleId}
          onDebugUpdate={setDebug}
          onOpenPositionConfirmed={() => {
            setOpenPositionConfirmed(true);
            setVisualState('open_position');
          }}
        />
        <ScannerHUD visualState={visualState} debug={debug} openPositions={openPositions} />
      </section>
    </main>
  );
}

export default AirScannerLabPage;
