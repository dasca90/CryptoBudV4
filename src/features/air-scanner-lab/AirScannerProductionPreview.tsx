import { useEffect, useMemo, useRef, useState } from 'react';
import type { TradeV4PageModel } from '../../components/trade-v4/types';
import { AirScannerCanvas } from './AirScannerCanvas';
import { ScannerHUD } from './components/ScannerHUD';
import { mapProductionModelToAirScannerLab } from './airScannerAdapter';
import { DEFAULT_GRAPHICS_QUALITY, DEFAULT_TOGGLES, GRAPHICS_QUALITY_STORAGE_KEY, normalizeGraphicsQuality, type AirScannerQuality, type AnimationDebugState, type MockScannerCoin, type ScreenPoint } from './state/airScannerVisualState';
import './air-scanner-lab.css';

const emptyDebug: AnimationDebugState = {
  fpsEstimate: 0,
  activeParticles: 0,
  activeLightningEffects: 0,
  activeAnimations: 0,
  renderedCoins: 0,
};

export function AirScannerProductionPreview(props: {
  model: TradeV4PageModel;
  quality?: AirScannerQuality;
  onSelectSymbol: (symbol: string) => void;
  onTransferSourceUpdate?: (point: ScreenPoint | null) => void;
}) {
  const view = useMemo(() => mapProductionModelToAirScannerLab(props.model), [props.model]);
  const embedRef = useRef<HTMLDivElement | null>(null);
  const [debug, setDebug] = useState<AnimationDebugState>(emptyDebug);
  const [transferSource, setTransferSource] = useState<ScreenPoint | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<MockScannerCoin | null>(view.selectedCoin);
  const [openPositionConfirmed, setOpenPositionConfirmed] = useState(false);
  const [lifecycleId, setLifecycleId] = useState(1);
  const [storedQuality, setStoredQuality] = useState<AirScannerQuality>(() => {
    if (typeof window === 'undefined') return DEFAULT_GRAPHICS_QUALITY;
    const resolved = normalizeGraphicsQuality(window.localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY));
    window.localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, resolved);
    return resolved;
  });
  const quality = normalizeGraphicsQuality(props.quality ?? storedQuality);
  const transferSymbol = props.model.paperAutoResult?.symbol ?? view.coins.find((coin) => coin.isSelectedBuy)?.symbol ?? 'UNIUSDT';
  const displayCoins = useMemo(
    () => view.coins.map((coin) => ({
      ...coin,
      isFocused: selectedCoin?.symbol === coin.symbol || coin.isFocused === true,
    })),
    [selectedCoin?.symbol, view.coins],
  );

  useEffect(() => {
    setSelectedCoin(view.selectedCoin);
  }, [view.selectedCoin]);

  useEffect(() => {
    setLifecycleId((current) => current + 1);
    setOpenPositionConfirmed(view.visualState === 'open_position');
  }, [transferSymbol, view.visualState]);

  useEffect(() => {
    if (!props.quality || props.quality === storedQuality) return;
    setStoredQuality(props.quality);
  }, [props.quality, storedQuality]);

  return (
    <div ref={embedRef} className="air-lab-production-embed" data-testid="air-scanner-lab-production-preview">
      <AirScannerCanvas
        visualState={view.visualState}
        quality={quality}
        toggles={{ ...DEFAULT_TOGGLES, autoDemoLoop: false }}
        lifecycleId={lifecycleId}
        coins={displayCoins}
        transferSymbol={transferSymbol}
        onDebugUpdate={setDebug}
        onTransferSourceUpdate={(point) => {
          const rect = embedRef.current?.getBoundingClientRect();
          const viewportPoint = point && rect
            ? { x: rect.left + point.x, y: rect.top + point.y }
            : point;
          setTransferSource(viewportPoint);
          props.onTransferSourceUpdate?.(viewportPoint);
        }}
        onOpenPositionConfirmed={() => setOpenPositionConfirmed(true)}
        onCoinSelect={(coin) => {
          setSelectedCoin(coin);
          props.onSelectSymbol(coin.symbol);
        }}
      />
      <ScannerHUD
        visualState={view.visualState}
        debug={debug}
        openPositions={view.openPositions}
        openPositionConfirmed={openPositionConfirmed}
        transferSource={transferSource}
        transferLifecycleId={lifecycleId}
        transferSymbol={transferSymbol}
        selectedCoin={selectedCoin}
        showOpenPositions={false}
        showDebug={false}
        showScanCard={false}
      />
    </div>
  );
}
