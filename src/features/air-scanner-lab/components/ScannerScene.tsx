import { useEffect, useMemo, useRef, useState } from 'react';
import { Environment, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Vector3Tuple } from 'three';
import { MAX_RENDERED_COINS, QUALITY_PARTICLE_BUDGET, type AirScannerQuality, type AnimationDebugState, type CoinVisualState, type MockScannerCoin, type ScannerToggles, type ScreenPoint } from '../state/airScannerVisualState';
import { mockScannerCoins } from '../state/mockScannerFeed';
import { mapMockCoinToVisualState } from '../utils/visualStateMapper';
import { BUY_PULL_DURATION_MS, acquireBuyLightningLock, createAnimationId, getBlockedPushFrame, getBuyPullProgress, getQualityParticleMultiplier, releaseBuyLightningLock } from '../utils/animationTimelines';
import { CoinOrb } from './CoinOrb';
import { CoreEnergy } from './CoreEnergy';
import { HolographicGrid } from './HolographicGrid';
import { ParticleTrail } from './ParticleTrail';

interface ScannerSceneProps {
  visualState: CoinVisualState;
  quality: AirScannerQuality;
  toggles: ScannerToggles;
  lifecycleId: number;
  onDebugUpdate: (debug: AnimationDebugState) => void;
  onOpenPositionConfirmed: () => void;
  onTransferSourceUpdate: (point: ScreenPoint | null) => void;
  onCoinSelect: (coin: MockScannerCoin) => void;
}

interface CoinFrame {
  coin: MockScannerCoin;
  state: CoinVisualState;
  position: Vector3Tuple;
  opacity: number;
  transferProgress?: number;
}

function getSceneCoinState(coin: MockScannerCoin, selectedState: CoinVisualState): CoinVisualState {
  if (selectedState === 'scanning') return coin.base === 'UNI' ? 'scanning' : coin.rawState === 'wait_candidate' || coin.rawState === 'blocked_candidate' ? 'neutral' : mapMockCoinToVisualState(coin);
  if (selectedState === 'wait') return coin.base === 'MATIC' ? 'wait' : coin.base === 'UNI' ? 'neutral' : mapMockCoinToVisualState({ ...coin, rawState: coin.rawState === 'blocked_candidate' ? 'neutral' : coin.rawState });
  if (selectedState === 'buy_pull_to_core') return coin.base === 'UNI' ? 'buy_pull_to_core' : mapMockCoinToVisualState(coin);
  if (selectedState === 'blocked_push_out') return coin.base === 'SUI' ? 'blocked_push_out' : mapMockCoinToVisualState(coin);
  if (selectedState === 'open_position') return coin.base === 'UNI' ? 'open_position' : mapMockCoinToVisualState(coin);
  return mapMockCoinToVisualState(coin);
}

export function ScannerScene({ visualState, quality, toggles, lifecycleId, onDebugUpdate, onOpenPositionConfirmed, onTransferSourceUpdate, onCoinSelect }: ScannerSceneProps) {
  const { camera, size } = useThree();
  const startTimeRef = useRef(performance.now());
  const animationIdRef = useRef('');
  const lightningLockedRef = useRef(false);
  const performanceAuditRef = useRef(0);
  const framesRef = useRef(0);
  const fpsStartedRef = useRef(performance.now());
  const sourceProjectRef = useRef(0);
  const frameStateUpdateRef = useRef(0);
  const [coinFrames, setCoinFrames] = useState<CoinFrame[]>([]);
  const particleCount = Math.round(QUALITY_PARTICLE_BUDGET[quality] * getQualityParticleMultiplier(quality));

  useEffect(() => {
    const previousState = animationIdRef.current ? visualState : 'initial';
    startTimeRef.current = performance.now();
    animationIdRef.current = createAnimationId('LAB', visualState);
    lightningLockedRef.current = false;
    console.info('AIR_SCANNER_LAB_STATE_CHANGE', {
      symbol: visualState === 'wait' ? 'MATICUSDT' : visualState === 'blocked_push_out' ? 'SUIUSDT' : 'UNIUSDT',
      previousState,
      nextState: visualState,
      animationId: animationIdRef.current,
      timestamp: new Date().toISOString(),
    });
    if (visualState === 'buy_pull_to_core') {
      lightningLockedRef.current = acquireBuyLightningLock('UNIUSDT', String(lifecycleId));
      console.info('AIR_SCANNER_LAB_BUY_PULL_START', {
        symbol: 'UNIUSDT',
        durationMs: BUY_PULL_DURATION_MS,
        lightningEnabled: toggles.buyLightning && lightningLockedRef.current,
        startPosition: mockScannerCoins[0].position,
        targetPanel: 'open_positions',
      });
    }
    if (visualState === 'blocked_push_out') {
      console.info('AIR_SCANNER_LAB_BLOCKED_PUSH_OUT', {
        symbol: 'SUIUSDT',
        reasons: mockScannerCoins[2].reasons,
        fadeEnabled: true,
        pushedOutDirection: 'away_from_core',
      });
    }
    return () => {
      releaseBuyLightningLock('UNIUSDT', String(lifecycleId));
    };
  }, [visualState, lifecycleId, toggles.buyLightning]);

  useFrame(() => {
    const now = performance.now();
    const elapsed = now - startTimeRef.current;
    const nextFrames = mockScannerCoins.slice(0, MAX_RENDERED_COINS).map((coin) => {
      const state = getSceneCoinState(coin, visualState);
      let position = coin.position;
      let opacity = 1;
      if (state === 'buy_pull_to_core') {
        const progress = getBuyPullProgress(elapsed);
        const fadeProgress = Math.min(1, Math.max(0, (progress - 0.88) / 0.12));
        position = [0, 2.2, 0];
        opacity = Math.max(0.02, 1 - fadeProgress);
        if (progress >= 1 && lightningLockedRef.current) {
          releaseBuyLightningLock('UNIUSDT', String(lifecycleId));
          lightningLockedRef.current = false;
          onOpenPositionConfirmed();
          console.info('AIR_SCANNER_LAB_BUY_PULL_COMPLETE', {
            symbol: 'UNIUSDT',
            durationMs: BUY_PULL_DURATION_MS,
            openPositionVisualConfirmed: true,
          });
        }
      }
      if (state === 'open_position' && coin.base === 'UNI') {
        opacity = 0;
      }
      if (state === 'blocked_push_out') {
        const frame = getBlockedPushFrame(coin.position, elapsed);
        position = frame.position;
        opacity = frame.opacity;
      }
      return { coin, state, position, opacity, transferProgress: state === 'buy_pull_to_core' ? getBuyPullProgress(elapsed) : undefined };
    });
    if (now - frameStateUpdateRef.current > 33 || coinFrames.length === 0) {
      frameStateUpdateRef.current = now;
      setCoinFrames(nextFrames);
    }
    const uniFrame = nextFrames.find((frame) => frame.coin.base === 'UNI');
    if (uniFrame && (visualState === 'buy_pull_to_core' || uniFrame.state === 'buy_pull_to_core') && now - sourceProjectRef.current > 50) {
      sourceProjectRef.current = now;
      const projected = new Vector3(...uniFrame.position).project(camera);
      onTransferSourceUpdate({
        x: (projected.x * 0.5 + 0.5) * size.width,
        y: (-projected.y * 0.5 + 0.5) * size.height,
      });
    } else if (visualState !== 'buy_pull_to_core' && now - sourceProjectRef.current > 250) {
      onTransferSourceUpdate(null);
    }

    framesRef.current += 1;
    const fpsElapsed = now - fpsStartedRef.current;
    if (fpsElapsed > 600) {
      const fpsEstimate = Math.round((framesRef.current / fpsElapsed) * 1000);
      framesRef.current = 0;
      fpsStartedRef.current = now;
      const activeLightningEffects = visualState === 'buy_pull_to_core' && toggles.buyLightning && lightningLockedRef.current ? 1 : 0;
      const activeAnimations = ['buy_pull_to_core', 'blocked_push_out', 'wait', 'scanning'].includes(visualState) ? 1 : 0;
      const activeParticles = toggles.particles ? (visualState === 'buy_pull_to_core' || visualState === 'blocked_push_out' ? particleCount : Math.floor(particleCount * 0.28)) : 0;
      const debug = { fpsEstimate, renderedCoins: nextFrames.length, activeParticles, activeLightningEffects, activeAnimations };
      onDebugUpdate(debug);
      if (now - performanceAuditRef.current > 7000) {
        performanceAuditRef.current = now;
        console.info('AIR_SCANNER_LAB_PERFORMANCE_AUDIT', {
          ...debug,
          qualityMode: quality,
        });
      }
    }
  });

  const buyCoinFrame = useMemo(() => coinFrames.find((frame) => frame.coin.base === 'UNI'), [coinFrames]);
  const blockedCoinFrame = useMemo(() => coinFrames.find((frame) => frame.coin.base === 'SUI'), [coinFrames]);
  const blockedCoinFrames = useMemo(() => coinFrames.filter((frame) => frame.state === 'blocked_push_out'), [coinFrames]);
  const successPulse = visualState === 'open_position' || (visualState === 'buy_pull_to_core' && buyCoinFrame ? buyCoinFrame.opacity < 0.25 : false);

  return (
    <>
      <color attach="background" args={['#020913']} />
      <fog attach="fog" args={['#031326', 4.8, 11]} />
      <ambientLight intensity={0.45} />
      <pointLight position={[0, 3.8, 1.5]} intensity={3.1} color="#19ccff" />
      <pointLight position={[3.5, 2.4, 0.8]} intensity={1.6} color="#ff41f4" />
      <pointLight position={[-3.6, 2.2, 1.5]} intensity={1.2} color="#ffc04d" />
      <Stars radius={42} depth={18} count={quality === 'low' ? 800 : 1400} factor={2.2} saturation={0} fade speed={0.25} />
      {toggles.backgroundGrid && <HolographicGrid />}
      <CoreEnergy successPulse={successPulse} scanningPulse={visualState === 'scanning'} />
      {coinFrames.filter((frame) => frame.opacity > 0.04).map((frame) => (
        <CoinOrb key={frame.coin.symbol} coin={frame.coin} visualState={frame.state} position={frame.position} opacity={frame.opacity} transferProgress={frame.transferProgress} realisticMaterials={toggles.realisticMaterials} onSelect={onCoinSelect} />
      ))}
      {buyCoinFrame && visualState === 'buy_pull_to_core' && (
        <ParticleTrail
          position={buyCoinFrame.position}
          color="#42ffe0"
          count={toggles.particles ? Math.floor(particleCount * 0.95) : 0}
          active={toggles.particles}
          spread={0.62}
          radius={0.026}
          opacity={0.86 * buyCoinFrame.opacity}
        />
      )}
      {blockedCoinFrames.map((frame) => (
        <ParticleTrail
          key={`blocked-particles-${frame.coin.symbol}`}
          position={frame.position}
          color="#ff3158"
          count={toggles.particles ? Math.floor(particleCount * (frame.coin.symbol === blockedCoinFrame?.coin.symbol && visualState === 'blocked_push_out' ? 0.72 : 0.18)) : 0}
          active={toggles.particles}
        />
      ))}
      <Environment preset="night" />
      {toggles.bloom && (
        <EffectComposer multisampling={quality === 'low' ? 0 : 2}>
          <Bloom intensity={quality === 'ultra' ? 1.45 : 1.05} luminanceThreshold={0.12} luminanceSmoothing={0.34} />
        </EffectComposer>
      )}
    </>
  );
}
