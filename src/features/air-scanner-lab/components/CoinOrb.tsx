import { useMemo, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Group, Vector3Tuple } from 'three';
import type { CoinVisualState, MockScannerCoin } from '../state/airScannerVisualState';

interface CoinOrbProps {
  coin: MockScannerCoin;
  visualState: CoinVisualState;
  position: Vector3Tuple;
  opacity?: number;
  realisticMaterials: boolean;
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

export function CoinOrb({ coin, visualState, position, opacity = 1, realisticMaterials }: CoinOrbProps) {
  const groupRef = useRef<Group>(null);
  const colors = palette[visualState];
  const isWait = visualState === 'wait';
  const isScanning = visualState === 'scanning';
  const isBlocked = visualState === 'blocked_push_out';

  const subtlePulse = useMemo(() => 0.35 + Math.random() * 0.5, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const pulse = isWait ? 1 + Math.sin(state.clock.elapsedTime * 2 + subtlePulse) * 0.03 : 1 + Math.sin(state.clock.elapsedTime * 2.5 + subtlePulse) * 0.045;
    groupRef.current.scale.setScalar(pulse);
    groupRef.current.rotation.y += delta * (isBlocked ? 0.12 : 0.2);
  });

  return (
    <group ref={groupRef} position={position}>
      <mesh>
        <sphereGeometry args={[0.48, 48, 48]} />
        <meshStandardMaterial
          color={colors.main}
          emissive={colors.emissive}
          emissiveIntensity={isBlocked ? 1.55 : visualState.includes('buy') ? 1.45 : isWait ? 1.05 : 0.7}
          roughness={realisticMaterials ? 0.16 : 0.4}
          metalness={realisticMaterials ? 0.52 : 0.1}
          transparent
          opacity={0.72 * opacity}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.58, 48, 48]} />
        <meshBasicMaterial color={colors.emissive} transparent opacity={(isBlocked ? 0.22 : 0.16) * opacity} />
      </mesh>
      {(isWait || isScanning) && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.66, 0.012, 8, 88]} />
          <meshBasicMaterial color={colors.emissive} transparent opacity={0.72 * opacity} />
        </mesh>
      )}
      <Text position={[0, 0.12, 0.52]} fontSize={0.24} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#061525" outlineWidth={0.012}>
        {coin.base}
      </Text>
      <Text position={[0, -0.14, 0.53]} fontSize={0.105} anchorX="center" anchorY="middle" color={colors.label} outlineColor="#061525" outlineWidth={0.006}>
        {coin.price}
      </Text>
      {coin.badge && visualState !== 'neutral' && visualState !== 'scanning' && (
        <Text position={[0, -0.7, 0.42]} fontSize={0.11} anchorX="center" anchorY="middle" color={colors.label} outlineColor={colors.emissive} outlineWidth={0.012}>
          {coin.badge}
        </Text>
      )}
    </group>
  );
}
