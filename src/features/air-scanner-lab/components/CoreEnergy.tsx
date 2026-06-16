import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

interface CoreEnergyProps {
  successPulse: boolean;
}

export function CoreEnergy({ successPulse }: CoreEnergyProps) {
  const coreRef = useRef<Mesh>(null);
  const beamRef = useRef<Mesh>(null);

  useFrame((state, delta) => {
    if (coreRef.current) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 4.4) * 0.06 + (successPulse ? 0.18 : 0);
      coreRef.current.scale.setScalar(pulse);
      coreRef.current.rotation.y += delta * 0.35;
    }
    if (beamRef.current) {
      beamRef.current.scale.y = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.05 + (successPulse ? 0.25 : 0);
    }
  });

  return (
    <group>
      <mesh ref={coreRef} position={[0, 0.92, 0]}>
        <sphereGeometry args={[0.38, 48, 48]} />
        <meshStandardMaterial color="#30ffe0" emissive="#00d6ff" emissiveIntensity={successPulse ? 2.4 : 1.25} roughness={0.18} metalness={0.28} transparent opacity={0.78} />
      </mesh>
      <mesh ref={beamRef} position={[0, 1.16, 0]}>
        <cylinderGeometry args={[0.05, 0.24, 2.4, 48, 1, true]} />
        <meshBasicMaterial color="#1eefff" transparent opacity={successPulse ? 0.5 : 0.28} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.38, 0.82, 96]} />
        <meshBasicMaterial color="#2cf7ff" transparent opacity={successPulse ? 0.7 : 0.38} />
      </mesh>
    </group>
  );
}
