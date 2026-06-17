import { useEffect, useMemo, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, Vector3, type Group, type Vector3Tuple } from 'three';
import type { CoinVisualState, MockScannerCoin } from '../state/airScannerVisualState';
import { auditOrbLabelOrientation, calculateFrontFacingLabelOffset, labelShouldRenderForState } from '../utils/orbLabelOrientation';

interface CoinOrbProps {
  coin: MockScannerCoin;
  visualState: CoinVisualState;
  position: Vector3Tuple;
  opacity?: number;
  transferProgress?: number;
  scanPulseIntensity?: number;
  realisticMaterials: boolean;
  onSelect: (coin: MockScannerCoin) => void;
}

const palette: Record<CoinVisualState, { main: string; emissive: string; label: string }> = {
  scanning: { main: '#8fb7ff', emissive: '#16bfff', label: '#dff5ff' },
  neutral: { main: '#a9c5ef', emissive: '#1f6cff', label: '#edf7ff' },
  wait: { main: '#ffb83e', emissive: '#ff9f18', label: '#fff4d2' },
  buy_ready: { main: '#23f7c7', emissive: '#00ffc2', label: '#dcfff7' },
  buy_pull_to_core: { main: '#25ffe3', emissive: '#00ffd0', label: '#e3fffa' },
  blocked_push_out: { main: '#ff4864', emissive: '#ff214b', label: '#fff0f2' },
  open_position: { main: '#2effb8', emissive: '#00ffbf', label: '#e6fff8' },
  cooldown: { main: '#637590', emissive: '#325277', label: '#d3deef' },
};

const ORB_RADIUS = 0.31;
const ORB_AURA_RADIUS = 0.4;
const ORB_RING_RADIUS = 0.43;
const ORB_DIAGONAL_RING_RADIUS = 0.49;
const LABEL_RADIUS = 0.52;

const coinSymbolMarks: Record<string, string> = {
  UNI: 'UNI',
  MATIC: 'POL',
  SUI: 'SUI',
  TRX: 'TRX',
  BNB: 'BNB',
  NEAR: 'NEAR',
  POL: 'POL',
  INJ: 'INJ',
  DYDX: 'DYDX',
  SPX: 'SPX',
  AVAX: 'AVAX',
  SOL: 'SOL',
  LINK: 'LINK',
  ADA: 'ADA',
  DOGE: 'DOGE',
  XRP: 'XRP',
  FET: 'FET',
  ETC: 'ETC',
};

function hashSymbol(symbol: string) {
  return symbol.split('').reduce((value, char) => value + char.charCodeAt(0), 0);
}

export function CoinOrb({ coin, visualState, position, opacity = 1, transferProgress = 0, scanPulseIntensity = 0, realisticMaterials, onSelect }: CoinOrbProps) {
  const groupRef = useRef<Group>(null);
  const shellRef = useRef<Group>(null);
  const stateRingsRef = useRef<Group>(null);
  const labelAnchorRef = useRef<Group>(null);
  const worldPositionRef = useRef(new Vector3());
  const smoothPositionRef = useRef(new Vector3(...position));
  const targetPositionRef = useRef(new Vector3(...position));
  const colors = palette[visualState];
  const isWait = visualState === 'wait';
  const isScanning = visualState === 'scanning';
  const isBlocked = visualState === 'blocked_push_out';
  const isOpen = visualState === 'open_position';
  const isBuy = visualState === 'buy_pull_to_core' || visualState === 'buy_ready' || isOpen;
  const isBuyingTransfer = visualState === 'buy_pull_to_core';
  const coinMark = coinSymbolMarks[coin.base] ?? coin.base.slice(0, 4);

  const motionSeed = useMemo(() => hashSymbol(coin.symbol), [coin.symbol]);
  const subtlePulse = useMemo(() => 0.35 + (motionSeed % 50) / 100, [motionSeed]);
  const floatProfile = useMemo(
    () => ({
      x: ((motionSeed % 7) - 3) * 0.018,
      y: 0.08 + (motionSeed % 5) * 0.018,
      z: (((motionSeed >> 2) % 7) - 3) * 0.015,
      speed: 0.65 + (motionSeed % 9) * 0.055,
      phase: motionSeed * 0.17,
    }),
    [motionSeed],
  );

  useEffect(() => {
    const audit = auditOrbLabelOrientation({
      symbol: coin.symbol,
      usesCameraBillboard: true,
      labelRotatesWithOrb: false,
      positiveScale: true,
    });
    console.info('ORB_LABEL_ORIENTATION_AUDIT', {
      ...audit,
      timestamp: new Date().toISOString(),
    });
  }, [coin.symbol]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const pulse = isWait ? 1 + Math.sin(state.clock.elapsedTime * 2 + subtlePulse) * 0.018 : 1 + Math.sin(state.clock.elapsedTime * 2.5 + subtlePulse) * 0.024;
    const motionScale = visualState === 'buy_pull_to_core' ? 0 : visualState === 'blocked_push_out' ? 0.35 : 1;
    const time = state.clock.elapsedTime;
    targetPositionRef.current.set(
      position[0] + Math.sin(time * floatProfile.speed + floatProfile.phase) * floatProfile.x * motionScale,
      position[1] + Math.sin(time * (floatProfile.speed + 0.38) + floatProfile.phase) * floatProfile.y * motionScale,
      position[2] + Math.cos(time * (floatProfile.speed + 0.22) + floatProfile.phase) * floatProfile.z * motionScale,
    );
    smoothPositionRef.current.lerp(targetPositionRef.current, visualState === 'blocked_push_out' ? 0.26 : 0.18);
    groupRef.current.position.copy(smoothPositionRef.current);
    const transferFadeProgress = Math.min(1, Math.max(0, (transferProgress - 0.88) / 0.12));
    const transferScale = visualState === 'buy_pull_to_core'
      ? Math.max(0.08, 2.75 - transferProgress * 0.45 - transferFadeProgress * 2.25)
      : 1;
    groupRef.current.scale.setScalar(pulse * transferScale);
    if (shellRef.current) {
      shellRef.current.rotation.y += delta * (isBlocked ? 0.12 : 0.2);
      shellRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.8 + subtlePulse) * 0.025;
    }
    if (stateRingsRef.current) {
      stateRingsRef.current.rotation.y += delta * (isWait ? 0.18 : isBuy ? 0.46 : 0.28);
      stateRingsRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2 + subtlePulse) * 0.16;
    }
    if (labelAnchorRef.current) {
      groupRef.current.getWorldPosition(worldPositionRef.current);
      const offset = calculateFrontFacingLabelOffset({
        cameraPosition: state.camera.position.toArray() as Vector3Tuple,
        orbPosition: worldPositionRef.current.toArray() as Vector3Tuple,
        radius: LABEL_RADIUS,
      });
      labelAnchorRef.current.position.set(offset[0], offset[1], offset[2]);
      labelAnchorRef.current.quaternion.copy(state.camera.quaternion);
    }
  });

  const handleSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(coin);
    console.info('AIR_SCANNER_LAB_COIN_SELECTED', {
      symbol: coin.symbol,
      state: visualState,
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <group ref={groupRef} position={position} onClick={handleSelect} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <group ref={shellRef}>
        <mesh>
        <sphereGeometry args={[ORB_RADIUS, 48, 48]} />
        <meshStandardMaterial
          color={colors.main}
          emissive={colors.emissive}
          emissiveIntensity={(isBlocked ? 1.55 : isBuyingTransfer ? 3.8 : isBuy ? 1.65 : isWait ? 1.05 : 0.7) + scanPulseIntensity * 3.1}
          roughness={isBuyingTransfer ? 0.04 : realisticMaterials ? 0.12 : 0.4}
          metalness={isBuyingTransfer ? 0.82 : realisticMaterials ? 0.62 : 0.1}
          transparent
          opacity={(isBuyingTransfer ? 0.88 : 0.7) * opacity}
        />
        </mesh>
        <mesh>
          <sphereGeometry args={[ORB_AURA_RADIUS, 48, 48]} />
          <meshBasicMaterial color={scanPulseIntensity > 0.05 ? '#42ffc8' : colors.emissive} transparent opacity={((isBlocked ? 0.2 : isBuyingTransfer ? 0.52 : isOpen ? 0.24 : 0.13) + scanPulseIntensity * 0.46) * opacity} blending={(isBuyingTransfer || scanPulseIntensity > 0.02) ? AdditiveBlending : undefined} depthWrite={!isBuyingTransfer && scanPulseIntensity <= 0.02} />
        </mesh>
        {scanPulseIntensity > 0.02 && (
          <mesh>
            <sphereGeometry args={[ORB_AURA_RADIUS * 1.52, 48, 48]} />
            <meshBasicMaterial color="#22d7ff" transparent opacity={scanPulseIntensity * 0.22 * opacity} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        )}
        {isBuyingTransfer && (
          <>
            <mesh>
              <sphereGeometry args={[ORB_AURA_RADIUS * 1.32, 48, 48]} />
              <meshBasicMaterial color="#5dffea" transparent opacity={0.24 * opacity} blending={AdditiveBlending} depthWrite={false} />
            </mesh>
            <mesh>
              <sphereGeometry args={[ORB_AURA_RADIUS * 1.7, 48, 48]} />
              <meshBasicMaterial color="#0dffba" transparent opacity={0.11 * opacity} blending={AdditiveBlending} depthWrite={false} />
            </mesh>
          </>
        )}
      </group>
      {(isWait || isScanning) && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORB_RING_RADIUS, 0.009, 8, 96]} />
          <meshBasicMaterial color={colors.emissive} transparent opacity={0.72 * opacity} />
        </mesh>
      )}
      <group ref={stateRingsRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORB_RING_RADIUS, 0.007, 8, 96]} />
          <meshBasicMaterial color={colors.emissive} transparent opacity={(isBuyingTransfer ? 0.95 : isBuy ? 0.72 : isBlocked ? 0.48 : 0.3) * opacity} blending={isBuyingTransfer ? AdditiveBlending : undefined} />
        </mesh>
        {(isBuy || isBlocked || isWait) && (
          <mesh rotation={[Math.PI / 2.35, 0, Math.PI / 5]}>
            <torusGeometry args={[ORB_DIAGONAL_RING_RADIUS, 0.008, 8, 96]} />
            <meshBasicMaterial color={colors.emissive} transparent opacity={(isBuyingTransfer ? 0.78 : isBuy ? 0.52 : 0.38) * opacity} blending={isBuyingTransfer ? AdditiveBlending : undefined} />
          </mesh>
        )}
      </group>
      {labelShouldRenderForState(visualState) && (
        <group ref={labelAnchorRef}>
          <mesh position={[0, 0.2, -0.01]} renderOrder={20}>
            <circleGeometry args={[0.12, 48]} />
            <meshBasicMaterial color={colors.emissive} transparent opacity={0.34 * opacity} depthWrite={false} depthTest={false} blending={AdditiveBlending} />
          </mesh>
          <Text position={[0, 0.2, 0.002]} fontSize={coinMark.length > 3 ? 0.05 : 0.062} anchorX="center" anchorY="middle" color="#ffffff" outlineColor="#00101a" outlineWidth={0.008} renderOrder={22}>
            {coinMark}
          </Text>
          <Text position={[0, 0.055, 0]} fontSize={coin.base.length > 4 ? 0.118 : 0.136} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#01050c" outlineWidth={0.016} renderOrder={21}>
            {coin.base}
          </Text>
          <Text position={[0, -0.078, 0]} fontSize={0.074} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#01050c" outlineWidth={0.01} renderOrder={21}>
            {coin.price}
          </Text>
          {coin.badge && visualState !== 'neutral' && visualState !== 'scanning' && (
            <>
              <mesh position={[0, -0.19, -0.006]} renderOrder={20}>
                <planeGeometry args={[0.42, 0.09]} />
                <meshBasicMaterial color={colors.emissive} transparent opacity={0.22} depthWrite={false} depthTest={false} />
              </mesh>
              <Text position={[0, -0.19, 0]} fontSize={0.052} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#01050c" outlineWidth={0.008} renderOrder={21}>
                {coin.badge}
              </Text>
            </>
          )}
        </group>
      )}
    </group>
  );
}
