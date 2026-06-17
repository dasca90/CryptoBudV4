import { Canvas } from '@react-three/fiber';
import type { AirScannerQuality, AnimationDebugState, CoinVisualState, MockScannerCoin, ScannerToggles, ScreenPoint } from './state/airScannerVisualState';
import { QUALITY_DPR } from './state/airScannerVisualState';
import { ScannerScene } from './components/ScannerScene';

interface AirScannerCanvasProps {
  visualState: CoinVisualState;
  quality: AirScannerQuality;
  toggles: ScannerToggles;
  lifecycleId: number;
  onDebugUpdate: (debug: AnimationDebugState) => void;
  onOpenPositionConfirmed: () => void;
  onTransferSourceUpdate: (point: ScreenPoint | null) => void;
  onCoinSelect: (coin: MockScannerCoin) => void;
}

export function AirScannerCanvas(props: AirScannerCanvasProps) {
  return (
    <Canvas
      className="air-scanner-lab-canvas"
      dpr={QUALITY_DPR[props.quality]}
      camera={{ position: [0, 5.35, 10.7], fov: 54, near: 0.1, far: 100 }}
      gl={{ antialias: props.quality !== 'low', powerPreference: 'high-performance', alpha: false }}
    >
      <ScannerScene {...props} />
    </Canvas>
  );
}
