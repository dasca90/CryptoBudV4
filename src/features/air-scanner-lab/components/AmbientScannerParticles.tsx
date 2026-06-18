import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DynamicDrawUsage, Matrix4, Vector3 } from 'three';
import type { InstancedMesh } from 'three';

interface AmbientParticle {
  angle: number;
  radius: number;
  height: number;
  size: number;
  speed: number;
  drift: number;
  opacity: number;
}

function createAmbientParticle(index: number): AmbientParticle {
  const seed = Math.sin(index * 12.9898) * 43758.5453;
  const unit = seed - Math.floor(seed);
  const secondary = Math.sin((index + 19) * 78.233) * 12451.517;
  const unitB = secondary - Math.floor(secondary);
  return {
    angle: unit * Math.PI * 2,
    radius: 4.6 + unitB * 5.1,
    height: 1.45 + ((index % 9) / 8) * 1.75,
    size: 0.014 + (index % 5) * 0.004,
    speed: 0.018 + unit * 0.035,
    drift: unitB * Math.PI * 2,
    opacity: 0.18 + (index % 6) * 0.025,
  };
}

export function AmbientScannerParticles({ count = 72 }: { count?: number }) {
  const meshRef = useRef<InstancedMesh>(null);
  const matrix = useMemo(() => new Matrix4(), []);
  const position = useMemo(() => new Vector3(), []);
  const scale = useMemo(() => new Vector3(1, 1, 1), []);
  const particles = useMemo(() => Array.from({ length: count }, (_, index) => createAmbientParticle(index)), [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.elapsedTime;
    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      if (!particle) return;
      const angle = particle.angle + time * particle.speed;
      const radius = particle.radius + Math.sin(time * 0.27 + particle.drift) * 0.24;
      position.set(
        Math.cos(angle) * radius,
        particle.height + Math.sin(time * 0.44 + particle.drift) * 0.26,
        Math.sin(angle) * radius * 0.68,
      );
      scale.setScalar(0.72 + Math.sin(time * 1.8 + particle.drift) * 0.24);
      matrix.compose(position, meshRef.current.quaternion, scale);
      meshRef.current.setMatrixAt(index, matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    meshRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, particles.length]} frustumCulled={false}>
      <sphereGeometry args={[0.024, 8, 8]} />
      <meshBasicMaterial color="#2ad9ff" transparent opacity={0.24} blending={AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}
