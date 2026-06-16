import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CatmullRomCurve3, Vector3 } from 'three';
import type { Group, Vector3Tuple } from 'three';

interface LightningArcProps {
  start: Vector3Tuple;
  end: Vector3Tuple;
  enabled: boolean;
}

export function LightningArc({ start, end, enabled }: LightningArcProps) {
  const groupRef = useRef<Group>(null);
  const points = useMemo(() => {
    const startVector = new Vector3(...start);
    const endVector = new Vector3(...end);
    return Array.from({ length: 9 }, (_, index) => {
      const t = index / 8;
      const base = startVector.clone().lerp(endVector, t);
      const wobble = Math.sin(t * Math.PI * 5) * 0.18;
      base.y += Math.sin(t * Math.PI) * 0.32;
      base.x += wobble;
      base.z += Math.cos(t * Math.PI * 3) * 0.08;
      return base;
    });
  }, [start, end]);
  const curve = useMemo(() => new CatmullRomCurve3(points), [points]);

  useFrame((state) => {
    if (!groupRef.current) return;
    const pulse = 0.72 + Math.sin(state.clock.elapsedTime * 18) * 0.16;
    groupRef.current.children.forEach((child) => {
      child.scale.setScalar(pulse);
    });
  });

  if (!enabled) return null;

  return (
    <group ref={groupRef}>
      <mesh>
        <tubeGeometry args={[curve, 84, 0.025, 8, false]} />
        <meshBasicMaterial color="#ff4df7" transparent opacity={0.78} />
      </mesh>
      <mesh>
        <tubeGeometry args={[curve, 84, 0.07, 8, false]} />
        <meshBasicMaterial color="#8d4dff" transparent opacity={0.2} />
      </mesh>
      {points.slice(1, -1).map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial color="#ff8bff" transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}
