import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

interface CoreEnergyProps {
  successPulse: boolean;
}

export function CoreEnergy({ successPulse }: CoreEnergyProps) {
  const blackHoleRef = useRef<Group>(null);
  const accretionRef = useRef<Group>(null);

  useFrame((state, delta) => {
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.4) * 0.035 + (successPulse ? 0.1 : 0);
    if (blackHoleRef.current) {
      blackHoleRef.current.scale.setScalar(pulse);
      blackHoleRef.current.rotation.y -= delta * 0.28;
    }
    if (accretionRef.current) {
      accretionRef.current.rotation.y += delta * (successPulse ? 1.85 : 0.95);
      accretionRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 1.2) * 0.08;
    }
  });

  return (
    <group>
      <group ref={blackHoleRef} position={[0, 0.07, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.54, 128]} />
          <meshBasicMaterial color="#000106" />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.18, 0.56, 128]} />
          <meshBasicMaterial color="#02040c" transparent opacity={0.96} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.58, 0.72, 128]} />
          <meshBasicMaterial color="#ff4df7" transparent opacity={successPulse ? 0.72 : 0.48} />
        </mesh>
      </group>
      <group ref={accretionRef} position={[0, 0.1, 0]}>
        <mesh rotation={[-Math.PI / 2.05, 0, 0.22]}>
          <torusGeometry args={[0.62, 0.014, 8, 128]} />
          <meshBasicMaterial color="#ff52f7" transparent opacity={successPulse ? 0.82 : 0.54} />
        </mesh>
        <mesh rotation={[-Math.PI / 2.28, 0, -0.38]}>
          <torusGeometry args={[0.74, 0.009, 8, 128]} />
          <meshBasicMaterial color="#20f7ff" transparent opacity={successPulse ? 0.55 : 0.34} />
        </mesh>
      </group>
      <pointLight position={[0, 0.68, 0]} intensity={successPulse ? 3.4 : 1.8} color="#ff52f7" />
    </group>
  );
}
