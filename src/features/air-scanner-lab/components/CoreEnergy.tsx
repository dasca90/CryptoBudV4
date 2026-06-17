import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial } from 'three';

interface CoreEnergyProps {
  successPulse: boolean;
  scanningPulse: boolean;
}

interface ScanSupernovaPulseProps {
  active: boolean;
  maxRadius: number;
  thickness: number;
}

export const SCAN_PULSE_INTERVAL_SECONDS = 10;
export const SCAN_PULSE_MAX_RADIUS = 5.9;
const scanPulseCore = '#22d7ff';
const scanPulseGlow = '#00f0d5';
const scanPulsePink = '#ff5fd7';
const scanPulseParticleColors = ['#22d7ff', '#00f0d5', '#37a8ff', '#42ffc8', '#6ddcff', '#ff5fd7'];

export function getScanPulseFrame(elapsedSeconds: number) {
  const progress = (elapsedSeconds % SCAN_PULSE_INTERVAL_SECONDS) / SCAN_PULSE_INTERVAL_SECONDS;
  const eased = 1 - Math.pow(1 - progress, 2.7);
  return {
    progress,
    radius: 0.32 + eased * SCAN_PULSE_MAX_RADIUS,
    opacity: progress < 0.72 ? Math.sin((progress / 0.72) * Math.PI) * Math.pow(1 - progress, 0.5) : 0,
    lift: Math.sin(progress * Math.PI) * 1.45,
    stretch: 1 + Math.sin(progress * Math.PI) * 0.32,
  };
}

function ScanSupernovaPulse({ active, maxRadius, thickness }: ScanSupernovaPulseProps) {
  const shellRef = useRef<Group>(null);
  const particleRef = useRef<Group>(null);
  const planeMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const domeMaterialRef = useRef<MeshBasicMaterial>(null);
  const domeShellMaterialRef = useRef<MeshBasicMaterial>(null);
  const verticalMaterialRef = useRef<MeshBasicMaterial>(null);
  const verticalCrossMaterialRef = useRef<MeshBasicMaterial>(null);
  const particles = useMemo(
    () =>
      Array.from({ length: 82 }, (_, index) => ({
        angle: index * 2.399963,
        radiusJitter: 0.82 + ((index * 17) % 31) / 100,
        delay: (index % 9) * 0.018,
        size: 0.018 + (index % 5) * 0.006,
        lift: 0.26 + ((index * 13) % 37) / 18,
        color: scanPulseParticleColors[index % scanPulseParticleColors.length],
      })),
    [],
  );

  useFrame((state) => {
    if (!shellRef.current || !particleRef.current || !planeMaterialRef.current || !glowMaterialRef.current || !domeMaterialRef.current || !domeShellMaterialRef.current || !verticalMaterialRef.current || !verticalCrossMaterialRef.current) return;
    if (!active) {
      shellRef.current.visible = false;
      particleRef.current.visible = false;
      return;
    }

    const { progress, radius, opacity, lift: shellLift, stretch: shellStretch } = getScanPulseFrame(state.clock.elapsedTime);
    const scale = radius * (maxRadius / SCAN_PULSE_MAX_RADIUS);

    shellRef.current.visible = true;
    shellRef.current.scale.set(scale, shellStretch, scale);
    shellRef.current.position.y = 0.16 + shellLift;
    particleRef.current.visible = true;
    planeMaterialRef.current.opacity = Math.max(0, opacity * 0.92);
    glowMaterialRef.current.opacity = Math.max(0, opacity * 0.22);
    domeMaterialRef.current.opacity = Math.max(0, opacity * 0.28);
    domeShellMaterialRef.current.opacity = Math.max(0, opacity * 0.08);
    verticalMaterialRef.current.opacity = Math.max(0, opacity * 0.36);
    verticalCrossMaterialRef.current.opacity = Math.max(0, opacity * 0.24);

    particleRef.current.children.forEach((child, index) => {
      const particle = particles[index];
      const mesh = child as Mesh;
      const material = mesh.material as MeshBasicMaterial;
      const particleProgress = Math.min(1, Math.max(0, (progress - particle.delay) / 0.64));
      const particleEase = 1 - Math.pow(1 - particleProgress, 2.2);
      const radius = (0.34 + particleEase * maxRadius) * particle.radiusJitter;
      const shimmer = 0.72 + Math.sin(state.clock.elapsedTime * 10 + particle.angle) * 0.28;
      const lift = Math.sin(particleProgress * Math.PI) * particle.lift + particleEase * 0.72;

      mesh.position.set(Math.cos(particle.angle) * radius, 0.18 + lift, Math.sin(particle.angle) * radius);
      mesh.scale.setScalar(shimmer * (1.15 - particleProgress * 0.35));
      material.opacity = Math.max(0, Math.sin(particleProgress * Math.PI) * Math.pow(1 - progress, 0.45) * 0.86);
    });
  });

  return (
    <group>
      <group ref={shellRef}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, thickness, 10, 224]} />
          <meshBasicMaterial ref={planeMaterialRef} color={scanPulseCore} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, thickness * 4.8, 10, 192]} />
          <meshBasicMaterial ref={glowMaterialRef} color={scanPulseGlow} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2.55, 0, 0]}>
          <torusGeometry args={[0.92, thickness * 1.55, 10, 192]} />
          <meshBasicMaterial ref={domeMaterialRef} color="#37a8ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial ref={domeShellMaterialRef} color={scanPulseCore} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} wireframe />
        </mesh>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[0.86, thickness * 1.15, 10, 192]} />
          <meshBasicMaterial ref={verticalMaterialRef} color="#42ffc8" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.74, thickness * 0.95, 10, 192]} />
          <meshBasicMaterial ref={verticalCrossMaterialRef} color={scanPulsePink} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <group ref={particleRef}>
        {particles.map((particle, index) => (
          <mesh key={`${particle.angle}-${index}`}>
            <sphereGeometry args={[particle.size, 10, 10]} />
            <meshBasicMaterial color={particle.color} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function CoreEnergy({ successPulse, scanningPulse }: CoreEnergyProps) {
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
      <ScanSupernovaPulse active={scanningPulse} maxRadius={5.9} thickness={0.018} />
      <pointLight position={[0, 0.68, 0]} intensity={scanningPulse ? 4.2 : successPulse ? 3.4 : 1.8} color={scanningPulse ? scanPulseCore : '#ff52f7'} />
    </group>
  );
}
