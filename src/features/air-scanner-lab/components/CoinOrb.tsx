import { useEffect, useMemo, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, Vector3, type Group, type Vector3Tuple } from 'three';
import type { CoinVisualState, MockScannerCoin } from '../state/airScannerVisualState';
import { auditOrbLabelOrientation, calculateFrontFacingLabelOffset, labelShouldRenderForState } from '../utils/orbLabelOrientation';
import { getCoinLogoMeta } from '../../../lib/ui/uiSymbolMapper';

interface CoinOrbProps {
  coin: MockScannerCoin;
  visualState: CoinVisualState;
  position: Vector3Tuple;
  opacity?: number;
  transferProgress?: number;
  scanPulseIntensity?: number;
  realisticMaterials: boolean;
  glowLayerScale?: number;
  cheapMaterial?: boolean;
  onSelect: (coin: MockScannerCoin) => void;
}

const palette: Record<CoinVisualState, { main: string; emissive: string; label: string; labelAccent: string }> = {
  scanning: { main: '#6f8fbf', emissive: '#0d73a6', label: '#e6f3ff', labelAccent: '#8fc9e8' },
  neutral: { main: '#71819e', emissive: '#174c8a', label: '#edf4ff', labelAccent: '#8fb0d8' },
  wait: { main: '#c98a32', emissive: '#b66c14', label: '#fff1cf', labelAccent: '#efb95c' },
  buy_ready: { main: '#21cfc7', emissive: '#00b9b0', label: '#e8fffb', labelAccent: '#74f4e8' },
  buy_pull_to_core: { main: '#ff32f2', emissive: '#ff00f5', label: '#fff3ff', labelAccent: '#ff9cff' },
  blocked_push_out: { main: '#c33d54', emissive: '#b6223b', label: '#fff0f2', labelAccent: '#f18a99' },
  open_position: { main: '#2598ba', emissive: '#0089b6', label: '#e9fbff', labelAccent: '#7ed8ef' },
  cooldown: { main: '#58677e', emissive: '#2b4665', label: '#d9e4f2', labelAccent: '#8799b0' },
};

const ORB_RADIUS = 0.31;
const ORB_AURA_RADIUS = 0.4;
const ORB_RING_RADIUS = 0.43;
const ORB_DIAGONAL_RING_RADIUS = 0.49;
const LABEL_RADIUS = 0.58;

function hashSymbol(symbol: string) {
  return symbol.split('').reduce((value, char) => value + char.charCodeAt(0), 0);
}

export function CoinOrb({ coin, visualState, position, opacity = 1, transferProgress = 0, scanPulseIntensity = 0, realisticMaterials, glowLayerScale = 1, cheapMaterial = false, onSelect }: CoinOrbProps) {
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
  const isBuyReady = visualState === 'buy_ready';
  const isBuy = visualState === 'buy_pull_to_core' || visualState === 'buy_ready' || isOpen;
  const isBuyingTransfer = visualState === 'buy_pull_to_core';
  const isFocused = coin.isFocused === true && !isBuyingTransfer;
  const usePhongMaterial = cheapMaterial && !isBuyingTransfer;
  const coinLogo = useMemo(() => getCoinLogoMeta(coin.symbol), [coin.symbol]);
  const coinMark = coinLogo.mark;
  const labelScale = coin.base.length > 7 ? 0.82 : coin.base.length > 5 ? 0.9 : 1;
  const transferAuraColor = '#3a8fd4';

  const motionSeed = useMemo(() => hashSymbol(coin.symbol), [coin.symbol]);
  const subtlePulse = useMemo(() => 0.35 + (motionSeed % 50) / 100, [motionSeed]);
  const floatProfile = useMemo(
    () => ({
      x: ((motionSeed % 7) - 3) * 0.01,
      y: 0.038 + (motionSeed % 5) * 0.009,
      z: (((motionSeed >> 2) % 7) - 3) * 0.008,
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
    const motionScale = visualState === 'buy_pull_to_core' ? 0 : isFocused ? 0.025 : visualState === 'blocked_push_out' ? 0.08 : 0.18;
    const time = state.clock.elapsedTime;
    targetPositionRef.current.set(
      position[0] + Math.sin(time * floatProfile.speed + floatProfile.phase) * floatProfile.x * motionScale,
      position[1] + Math.sin(time * (floatProfile.speed + 0.38) + floatProfile.phase) * floatProfile.y * motionScale,
      position[2] + Math.cos(time * (floatProfile.speed + 0.22) + floatProfile.phase) * floatProfile.z * motionScale,
    );
    smoothPositionRef.current.lerp(targetPositionRef.current, visualState === 'blocked_push_out' ? 0.12 : 0.055);
    groupRef.current.position.copy(smoothPositionRef.current);
    const transferFadeProgress = Math.min(1, Math.max(0, (transferProgress - 0.88) / 0.12));
    const transferScale = visualState === 'buy_pull_to_core'
      ? Math.max(1.48, 1.72 - transferProgress * 0.08 - transferFadeProgress * 0.1)
      : isFocused ? 2 : 1;
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
    <group ref={groupRef} position={position} renderOrder={isBuyingTransfer ? 40 : 0} onClick={handleSelect} onPointerOver={() => { document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
      <group ref={shellRef}>
        <mesh>
        <sphereGeometry args={[ORB_RADIUS, 48, 48]} />
        {usePhongMaterial ? (
          <meshPhongMaterial
            color={isFocused ? '#173244' : colors.main}
            emissive={isFocused ? '#071c2b' : colors.emissive}
            emissiveIntensity={(isFocused ? 0.2 : isBlocked ? 0.48 : isBuyReady ? 0.42 : isBuy ? 0.62 : isWait ? 0.48 : 0.34) + scanPulseIntensity * 0.9}
            shininess={realisticMaterials ? 36 : 18}
            transparent
            opacity={(isFocused ? 0.86 : isBuyReady ? 0.5 : 0.66) * opacity}
          />
        ) : (
          <meshStandardMaterial
            color={isFocused ? '#173244' : colors.main}
            emissive={isFocused ? '#071c2b' : colors.emissive}
            emissiveIntensity={(isFocused ? 0.28 : isBlocked ? 0.72 : isBuyingTransfer ? 4.2 : isBuyReady ? 0.58 : isBuy ? 0.82 : isWait ? 0.68 : 0.48) + scanPulseIntensity * (isBuyingTransfer ? 2.15 : 1.35)}
            roughness={isBuyingTransfer ? 0.055 : realisticMaterials ? 0.24 : 0.48}
            metalness={isFocused ? 0.24 : isBuyingTransfer ? 0.72 : realisticMaterials ? 0.42 : 0.1}
            transparent
            opacity={(isFocused ? 0.86 : isBuyingTransfer ? 1 : isBuyReady ? 0.48 : 0.64) * opacity}
          />
        )}
        </mesh>
        <mesh>
          <sphereGeometry args={[ORB_AURA_RADIUS, 48, 48]} />
          <meshBasicMaterial color={isFocused ? '#24506a' : isBuyingTransfer ? transferAuraColor : scanPulseIntensity > 0.05 ? '#5adfc2' : colors.emissive} transparent opacity={((isFocused ? 0.2 : isBlocked ? 0.1 : isBuyingTransfer ? 0.62 : isBuyReady ? 0.052 : isOpen ? 0.12 : 0.075) + scanPulseIntensity * (isBuyingTransfer ? 0.32 : 0.18)) * opacity * glowLayerScale} blending={(isBuyingTransfer || scanPulseIntensity > 0.02) ? AdditiveBlending : undefined} depthWrite={!isBuyingTransfer && scanPulseIntensity <= 0.02} />
        </mesh>
        {scanPulseIntensity > 0.02 && glowLayerScale > 0.7 && (
          <mesh>
            <sphereGeometry args={[ORB_AURA_RADIUS * 1.52, 48, 48]} />
            <meshBasicMaterial color="#3e9fbd" transparent opacity={scanPulseIntensity * 0.12 * opacity * glowLayerScale} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        )}
        {isBuyingTransfer && (
          <>
            <mesh>
              <sphereGeometry args={[ORB_AURA_RADIUS * 1.32, 48, 48]} />
              <meshBasicMaterial color="#cc00cc" transparent opacity={0.22 * opacity * glowLayerScale} blending={AdditiveBlending} depthWrite={false} />
            </mesh>
            {glowLayerScale > 0.7 && <mesh>
              <sphereGeometry args={[ORB_AURA_RADIUS * 1.7, 48, 48]} />
              <meshBasicMaterial color="#7dfff1" transparent opacity={0.12 * opacity * glowLayerScale} blending={AdditiveBlending} depthWrite={false} />
            </mesh>}
          </>
        )}
      </group>
      {(isWait || isScanning) && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORB_RING_RADIUS, 0.009, 8, 96]} />
          <meshBasicMaterial color={colors.emissive} transparent opacity={0.42 * opacity * glowLayerScale} />
        </mesh>
      )}
      <group ref={stateRingsRef}>
        {!isBuyingTransfer && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[ORB_RING_RADIUS, 0.007, 8, 96]} />
            <meshBasicMaterial color={isFocused ? '#315f78' : colors.emissive} transparent opacity={(isFocused ? 0.62 : isBuyReady ? 0.32 : isBuy ? 0.44 : isBlocked ? 0.34 : 0.2) * opacity * glowLayerScale} />
          </mesh>
        )}
        {(isBuy || isBlocked || isWait) && (
          <mesh rotation={[Math.PI / 2.35, 0, Math.PI / 5]}>
            <torusGeometry args={[ORB_DIAGONAL_RING_RADIUS, 0.008, 8, 96]} />
            <meshBasicMaterial color={isFocused ? '#173244' : isBuyingTransfer ? '#8cfff2' : colors.emissive} transparent opacity={(isFocused ? 0.5 : isBuyingTransfer ? 0.82 : isBuyReady ? 0.24 : isBuy ? 0.34 : 0.25) * opacity * glowLayerScale} blending={isBuyingTransfer ? AdditiveBlending : undefined} />
          </mesh>
        )}
      </group>
      {labelShouldRenderForState(visualState) && (
        <group ref={labelAnchorRef}>
          <mesh position={[0, 0.152, -0.012]} renderOrder={20}>
            <circleGeometry args={[0.07, 40]} />
            <meshBasicMaterial color={coinLogo.ring} transparent opacity={0.24 * opacity} depthWrite={false} depthTest={false} blending={AdditiveBlending} />
          </mesh>
          <Text position={[0, 0.152, 0.002]} fontSize={(coinMark.length > 3 ? 0.031 : 0.041) * labelScale} anchorX="center" anchorY="middle" color={coinLogo.fg} outlineColor="#00070d" outlineWidth={0.012} renderOrder={22}>
            {coinMark}
          </Text>
          <Text position={[0, 0.035, 0]} fontSize={(coin.base.length > 4 ? 0.082 : 0.092) * labelScale} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#00070d" outlineWidth={0.018} renderOrder={21}>
            {coin.base}
          </Text>
          <Text position={[0, -0.065, 0]} fontSize={0.052 * labelScale} anchorX="center" anchorY="middle" color="#c9d8e8" outlineColor="#00070d" outlineWidth={0.012} renderOrder={21}>
            {coin.price}
          </Text>
          {coin.badge && visualState !== 'neutral' && visualState !== 'scanning' && (
            <Text position={[0, -0.15, 0]} fontSize={0.036} anchorX="center" anchorY="middle" color={colors.labelAccent} outlineColor="#00070d" outlineWidth={0.012} renderOrder={21}>
              {coin.badge}
            </Text>
          )}
        </group>
      )}
    </group>
  );
}
