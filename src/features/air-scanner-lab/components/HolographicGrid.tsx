import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, type Group } from 'three';

export function HolographicGrid() {
  const groupRef = useRef<Group>(null);
  const rings = useMemo(() => Array.from({ length: 9 }, (_, index) => 1.1 + index * 0.7), []);
  const spokes = useMemo(() => Array.from({ length: 32 }, (_, index) => (index / 32) * Math.PI * 2), []);

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = state.clock.elapsedTime * 0.018;
    groupRef.current.position.y = -0.02 + Math.sin(state.clock.elapsedTime * 0.42) * 0.012;
  });

  return (
    <group ref={groupRef} position={[0, -0.02, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.6, 96]} />
        <meshBasicMaterial color="#041c33" transparent opacity={0.28} side={DoubleSide} />
      </mesh>
      {rings.map((radius) => (
        <mesh key={radius} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius, radius + 0.012, 128]} />
          <meshBasicMaterial color="#11b9ff" transparent opacity={radius < 2 ? 0.48 : 0.21} side={DoubleSide} />
        </mesh>
      ))}
      {spokes.map((angle) => (
        <mesh key={angle} position={[Math.cos(angle) * 3.2, 0.004, Math.sin(angle) * 3.2]} rotation={[0, -angle, 0]}>
          <boxGeometry args={[0.01, 0.01, 6.4]} />
          <meshBasicMaterial color="#0a8ed8" transparent opacity={0.18} />
        </mesh>
      ))}
    </group>
  );
}
