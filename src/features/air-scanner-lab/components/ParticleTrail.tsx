import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Vector3Tuple } from 'three';

interface ParticleTrailProps {
  position: Vector3Tuple;
  color: string;
  count: number;
  active: boolean;
}

export function ParticleTrail({ position, color, count, active }: ParticleTrailProps) {
  const groupRef = useRef<Group>(null);
  const offsets = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        x: (Math.random() - 0.5) * 0.72,
        y: (Math.random() - 0.5) * 0.5,
        z: (Math.random() - 0.5) * 0.72,
        phase: index * 0.31,
      })),
    [count],
  );

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, index) => {
      const offset = offsets[index];
      child.position.set(
        position[0] + offset.x - Math.sin(state.clock.elapsedTime * 2 + offset.phase) * 0.3,
        position[1] + offset.y - index * 0.008,
        position[2] + offset.z,
      );
      child.scale.setScalar(0.55 + Math.sin(state.clock.elapsedTime * 4 + offset.phase) * 0.18);
    });
  });

  if (!active || count <= 0) return null;

  return (
    <group ref={groupRef}>
      {offsets.map((offset, index) => (
        <mesh key={`${offset.phase}-${index}`}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.42} />
        </mesh>
      ))}
    </group>
  );
}
