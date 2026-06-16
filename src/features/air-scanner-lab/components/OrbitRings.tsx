import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

export function OrbitRings() {
  const groupRef = useRef<Group>(null);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.16;
  });

  return (
    <group ref={groupRef} position={[0, 2.15, 0]}>
      {[1.25, 1.75, 2.35, 3.05].map((radius, index) => (
        <mesh key={radius} rotation={[Math.PI / 2 + index * 0.18, 0, index * 0.15]}>
          <torusGeometry args={[radius, 0.008, 8, 160]} />
          <meshBasicMaterial color={index % 2 === 0 ? '#12d6ff' : '#7a5cff'} transparent opacity={0.38 - index * 0.05} />
        </mesh>
      ))}
    </group>
  );
}
