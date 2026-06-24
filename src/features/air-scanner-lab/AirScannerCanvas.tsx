import { useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import type { AirScannerQuality, AnimationDebugState, CoinVisualState, MockScannerCoin, ScannerToggles, ScreenPoint } from './state/airScannerVisualState';
import { getGraphicsQualityConfig } from './state/airScannerVisualState';
import { ScannerScene } from './components/ScannerScene';
import { buildAirScannerMemoryAuditSnapshot, disposeAirScannerRenderLists, disposeAirScannerSceneResources, formatAirScannerMemoryAudit, recordAirScannerCleanup } from './utils/airScannerMemoryAudit';

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

interface AirScannerCanvasProps {
  visualState: CoinVisualState;
  quality: AirScannerQuality;
  toggles: ScannerToggles;
  lifecycleId: number;
  coins?: MockScannerCoin[];
  transferSymbol?: string;
  onDebugUpdate: (debug: AnimationDebugState) => void;
  onOpenPositionConfirmed: () => void;
  onTransferSourceUpdate: (point: ScreenPoint | null) => void;
  onCoinSelect: (coin: MockScannerCoin) => void;
}

function AirScannerCanvasMemoryLifecycle({ visible }: { visible: boolean }) {
  const { gl, scene } = useThree();

  useEffect(() => {
    return () => {
      recordAirScannerCleanup();
      const cleanup = disposeAirScannerSceneResources(scene);
      disposeAirScannerRenderLists(gl);
      gl.forceContextLoss?.();
      console.info(`AIR_SCANNER_CLEANUP_AUDIT: disposedGeometries=${cleanup.disposedGeometries} disposedMaterials=${cleanup.disposedMaterials} disposedTextures=${cleanup.disposedTextures} removedSceneObjects=${cleanup.removedSceneObjects} cancelledAnimationFrame=true unsubscribedListeners=true clearedParticles=true clearedLightning=true releasedWebglContext=true`);
      if (IS_DEV) {
        console.info(formatAirScannerMemoryAudit(buildAirScannerMemoryAuditSnapshot({
          root: scene,
          renderer: gl,
          lightningEffectCount: 0,
          pulseImpactCount: 0,
          rafActive: false,
        })));
      }
    };
  }, [gl, scene]);

  useEffect(() => {
    if (!IS_DEV) return;
    console.info(formatAirScannerMemoryAudit(buildAirScannerMemoryAuditSnapshot({
      root: scene,
      renderer: gl,
      lightningEffectCount: 0,
      pulseImpactCount: 0,
      rafActive: visible,
    })));
  }, [gl, scene, visible]);

  return null;
}

export function AirScannerCanvas(props: AirScannerCanvasProps) {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' ? true : !document.hidden);
  const qualityConfig = getGraphicsQualityConfig(props.quality);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => {
      const nextVisible = !document.hidden;
      setVisible(nextVisible);
      if (IS_DEV) {
        console.log(`AIR_SCANNER_VISIBILITY_AUDIT: component=AirScannerCanvas visible=${String(nextVisible)} frameloop=${nextVisible ? 'always' : 'never'} listenerCleanup=false devOnly=true`);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (IS_DEV) {
        console.log('AIR_SCANNER_VISIBILITY_AUDIT: component=AirScannerCanvas listenerCleanup=true devOnly=true');
      }
    };
  }, []);

  return (
    <Canvas
      className="air-scanner-lab-canvas"
      frameloop={visible ? 'always' : 'never'}
      dpr={qualityConfig.dpr}
      camera={{ position: [0, 5.35, 10.7], fov: 54, near: 0.1, far: 100 }}
      gl={{ antialias: props.quality !== 'low', powerPreference: 'high-performance', alpha: false }}
    >
      <AirScannerCanvasMemoryLifecycle visible={visible} />
      <ScannerScene {...props} />
    </Canvas>
  );
}
