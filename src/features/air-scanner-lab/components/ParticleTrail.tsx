import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Vector3 } from 'three';
import type { Group, Vector3Tuple } from 'three';

interface ParticleTrailProps {
  position: Vector3Tuple;
  color: string;
  count: number;
  active: boolean;
}

export function ParticleTrail({ position, color, count, active }: ParticleTrailProps) {
  const groupRef = useRef<Group>(null);
  const smoothPositionRef = useRef(new Vector3(...position));
  const targetPositionRef = useRef(new Vector3(...position));
  const offsets = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        x: (Math.sin(index * 12.9898) * 43758.5453 % 1 - 0.5) * 0.95,
        y: (Math.sin(index * 78.233) * 12731.171 % 1 - 0.5) * 0.7,
        z: (Math.sin(index * 39.425) * 9182.91 % 1 - 0.5) * 0.95,
        phase: index * 0.31,
        drift: 0.16 + (index % 7) * 0.018,
      })),
    [count],
  );

  useFrame((state) => {
    if (!groupRef.current) return;
    targetPositionRef.current.set(...position);
    smoothPositionRef.current.lerp(targetPositionRef.current, 0.2);
    groupRef.current.children.forEach((child, index) => {
      const offset = offsets[index];
      const shimmer = Math.sin(state.clock.elapsedTime * 4.8 + offset.phase);
      child.position.set(
        smoothPositionRef.current.x + offset.x - Math.sin(state.clock.elapsedTime * 2 + offset.phase) * offset.drift,
        smoothPositionRef.current.y + offset.y - (index % 18) * 0.01 + shimmer * 0.035,
        smoothPositionRef.current.z + offset.z + Math.cos(state.clock.elapsedTime * 1.6 + offset.phase) * offset.drift,
      );
      child.scale.setScalar(0.75 + shimmer * 0.22);
    });
  });

  if (!active || count <= 0) return null;

  return (
    <group ref={groupRef}>
      {offsets.map((offset, index) => (
        <mesh key={`${offset.phase}-${index}`}>
          <sphereGeometry args={[0.036, 10, 10]} />
          <meshBasicMaterial color={color} transparent opacity={0.68} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
