import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DynamicDrawUsage, Matrix4, Vector3, type Group, type InstancedMesh, type MeshBasicMaterial, type Vector3Tuple } from 'three';
import type { AirScannerQuality, CoinVisualState } from '../state/airScannerVisualState';

export type ScanPulseMode = 'low_ring' | 'balanced_volume' | 'high_volume';
export type ScanImpactState = 'scannedNeutral' | 'scannedWait' | 'scannedBuyReady' | 'scannedBlocked';

export interface ScanPulseFrame {
  active: boolean;
  pulseId: number;
  progress: number;
  radius: number;
  opacity: number;
  lift: number;
  wallHeight: number;
  wobble: number;
}

export interface PulseSphereFrame {
  symbol: string;
  state: CoinVisualState;
  position: Vector3Tuple;
  opacity?: number;
}

export interface SpherePulseImpact {
  pulseId: number;
  hitStartedAtMs: number;
  intensity: number;
  impactState: ScanImpactState;
}

export const SCAN_PULSE_DURATION_SECONDS = 3.4;
export const SCAN_PULSE_INTERVAL_SECONDS = 7.8;
export const SCAN_PULSE_MAX_RADIUS = 7.05;
export const SCAN_PULSE_IMPACT_DURATION_MS = 520;
const SCAN_PULSE_MIN_RADIUS = 0.38;

export function resolveScanPulseMode(quality: AirScannerQuality, fpsEstimate?: number): { mode: ScanPulseMode; degradedForPerformance: boolean } {
  const degradedForPerformance = typeof fpsEstimate === 'number' && fpsEstimate > 0 && fpsEstimate < 45 && quality !== 'low';
  if (quality === 'low' || (quality === 'balanced' && degradedForPerformance)) return { mode: 'low_ring', degradedForPerformance };
  if (quality === 'high' && !degradedForPerformance) return { mode: 'high_volume', degradedForPerformance };
  return { mode: 'balanced_volume', degradedForPerformance };
}

export function getVolumetricScanPulseFrame(elapsedSeconds: number, active = true): ScanPulseFrame {
  const cyclePosition = elapsedSeconds % SCAN_PULSE_INTERVAL_SECONDS;
  const pulseId = Math.floor(elapsedSeconds / SCAN_PULSE_INTERVAL_SECONDS);
  const progress = Math.min(1, cyclePosition / SCAN_PULSE_DURATION_SECONDS);
  const visible = active && cyclePosition <= SCAN_PULSE_DURATION_SECONDS;
  const eased = 1 - Math.pow(1 - progress, 2.35);
  const fadeIn = Math.min(1, progress / 0.18);
  const fadeOut = Math.max(0, 1 - Math.max(0, progress - 0.68) / 0.32);
  const opacity = visible ? Math.sin(progress * Math.PI) * fadeIn * fadeOut : 0;
  return {
    active: visible && opacity > 0.001,
    pulseId,
    progress,
    radius: SCAN_PULSE_MIN_RADIUS + eased * SCAN_PULSE_MAX_RADIUS,
    opacity,
    lift: Math.sin(progress * Math.PI) * 0.56,
    wallHeight: 0.42 + Math.sin(progress * Math.PI) * 1.18,
    wobble: Math.sin(progress * Math.PI * 5) * 0.035,
  };
}

export function getScanImpactState(state: CoinVisualState): ScanImpactState {
  if (state === 'buy_ready' || state === 'buy_pull_to_core' || state === 'open_position') return 'scannedBuyReady';
  if (state === 'wait') return 'scannedWait';
  if (state === 'blocked_push_out') return 'scannedBlocked';
  return 'scannedNeutral';
}

export function getScanImpactColor(impactState: ScanImpactState): string {
  if (impactState === 'scannedBuyReady') return '#ff62ff';
  if (impactState === 'scannedWait') return '#38bdf8';
  if (impactState === 'scannedBlocked') return '#ff7a35';
  return '#37e8ff';
}

export function updateSpherePulseImpacts(input: {
  frames: PulseSphereFrame[];
  pulse: ScanPulseFrame;
  previous: Map<string, SpherePulseImpact>;
  nowMs: number;
  tolerance?: number;
}): { impacts: Map<string, SpherePulseImpact>; hitCount: number; activeImpactCount: number } {
  const tolerance = input.tolerance ?? 0.34;
  const impacts = new Map<string, SpherePulseImpact>();
  let hitCount = 0;

  for (const [symbol, impact] of input.previous) {
    const age = input.nowMs - impact.hitStartedAtMs;
    if (age > SCAN_PULSE_IMPACT_DURATION_MS) continue;
    impacts.set(symbol, {
      ...impact,
      intensity: Math.max(0, 1 - age / SCAN_PULSE_IMPACT_DURATION_MS),
    });
  }

  if (input.pulse.active) {
    for (const frame of input.frames) {
      if ((frame.opacity ?? 1) <= 0.04) continue;
      const previous = impacts.get(frame.symbol);
      if (previous?.pulseId === input.pulse.pulseId) continue;
      const sphereRadius = Math.hypot(frame.position[0], frame.position[2]);
      if (Math.abs(sphereRadius - input.pulse.radius) > tolerance) continue;
      impacts.set(frame.symbol, {
        pulseId: input.pulse.pulseId,
        hitStartedAtMs: input.nowMs,
        intensity: 1,
        impactState: getScanImpactState(frame.state),
      });
      hitCount += 1;
    }
  }

  return { impacts, hitCount, activeImpactCount: impacts.size };
}

export function getPulseDrawCallEstimate(mode: ScanPulseMode, impactCount: number): number {
  const base = mode === 'low_ring' ? 2 : mode === 'balanced_volume' ? 4 : 6;
  return base + Math.min(impactCount, 40);
}

export function VolumetricScanPulse(props: {
  active: boolean;
  quality: AirScannerQuality;
  fpsEstimate?: number;
  onPulseAudit?: (audit: {
    scanCycleId: number;
    graphicsQuality: AirScannerQuality;
    pulseMode: ScanPulseMode;
    pulseDurationMs: number;
    estimatedDrawCalls: number;
    degradedForPerformance: boolean;
  }) => void;
}) {
  const shellRef = useRef<Group>(null);
  const upperRef = useRef<Group>(null);
  const particleRef = useRef<InstancedMesh>(null);
  const rimMaterialRef = useRef<MeshBasicMaterial>(null);
  const glowMaterialRef = useRef<MeshBasicMaterial>(null);
  const upperMaterialRef = useRef<MeshBasicMaterial>(null);
  const wallMaterialRef = useRef<MeshBasicMaterial>(null);
  const domeMaterialRef = useRef<MeshBasicMaterial>(null);
  const lastAuditPulseIdRef = useRef(-1);
  const frameCostStartRef = useRef(0);
  const matrix = useMemo(() => new Matrix4(), []);
  const particlePosition = useMemo(() => new Vector3(), []);
  const particleScale = useMemo(() => new Vector3(1, 1, 1), []);
  const particles = useMemo(
    () => Array.from({ length: 34 }, (_, index) => ({
      angle: index * 2.399963,
      delay: (index % 8) * 0.018,
      lift: 0.18 + (index % 7) * 0.05,
      size: 0.32 + (index % 5) * 0.07,
    })),
    [],
  );

  useFrame((state) => {
    frameCostStartRef.current = performance.now();
    const { mode, degradedForPerformance } = resolveScanPulseMode(props.quality, props.fpsEstimate);
    const pulse = getVolumetricScanPulseFrame(state.clock.elapsedTime, props.active);
    const shell = shellRef.current;
    const upper = upperRef.current;
    if (!shell || !upper || !rimMaterialRef.current || !glowMaterialRef.current || !upperMaterialRef.current || !wallMaterialRef.current || !domeMaterialRef.current) return;

    shell.visible = pulse.active;
    upper.visible = pulse.active && mode !== 'low_ring';
    if (particleRef.current) particleRef.current.visible = pulse.active && mode === 'high_volume';
    if (!pulse.active) return;

    const radius = pulse.radius + pulse.wobble;
    shell.scale.set(radius, 1, radius);
    shell.position.y = 0.18 + pulse.lift * 0.18;
    upper.scale.set(radius * 0.985, pulse.wallHeight, radius * 0.985);
    upper.position.y = 0.36 + pulse.wallHeight * 0.32;

    rimMaterialRef.current.opacity = pulse.opacity * (mode === 'low_ring' ? 0.72 : 0.92);
    glowMaterialRef.current.opacity = pulse.opacity * (mode === 'low_ring' ? 0.16 : 0.28);
    upperMaterialRef.current.opacity = mode === 'low_ring' ? 0 : pulse.opacity * 0.32;
    wallMaterialRef.current.opacity = mode === 'high_volume' ? pulse.opacity * 0.22 : mode === 'balanced_volume' ? pulse.opacity * 0.14 : 0;
    domeMaterialRef.current.opacity = mode === 'high_volume' ? pulse.opacity * 0.08 : 0;

    if (particleRef.current && mode === 'high_volume') {
      for (let index = 0; index < particles.length; index += 1) {
        const p = particles[index];
        const particleProgress = Math.min(1, Math.max(0, (pulse.progress - p.delay) / 0.72));
        const particleRadius = pulse.radius * (0.88 + (index % 6) * 0.018);
        const shimmer = 0.72 + Math.sin(state.clock.elapsedTime * 8 + p.angle) * 0.28;
        particlePosition.set(
          Math.cos(p.angle) * particleRadius,
          0.28 + Math.sin(particleProgress * Math.PI) * p.lift + pulse.lift * 0.35,
          Math.sin(p.angle) * particleRadius,
        );
        particleScale.setScalar(Math.max(0.1, p.size * shimmer * Math.sin(particleProgress * Math.PI)));
        matrix.compose(particlePosition, particleRef.current.quaternion, particleScale);
        particleRef.current.setMatrixAt(index, matrix);
      }
      particleRef.current.instanceMatrix.needsUpdate = true;
      particleRef.current.instanceMatrix.setUsage(DynamicDrawUsage);
    }

    if (props.onPulseAudit && lastAuditPulseIdRef.current !== pulse.pulseId && pulse.progress > 0.96) {
      lastAuditPulseIdRef.current = pulse.pulseId;
      props.onPulseAudit({
        scanCycleId: pulse.pulseId,
        graphicsQuality: props.quality,
        pulseMode: mode,
        pulseDurationMs: SCAN_PULSE_DURATION_SECONDS * 1000,
        estimatedDrawCalls: getPulseDrawCallEstimate(mode, 0),
        degradedForPerformance,
      });
    }
  });

  return (
    <group>
      <group ref={shellRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.018, 10, 160]} />
          <meshBasicMaterial ref={rimMaterialRef} color="#35e8ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.088, 10, 144]} />
          <meshBasicMaterial ref={glowMaterialRef} color="#0ef6cf" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
      </group>
      <group ref={upperRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.014, 8, 144]} />
          <meshBasicMaterial ref={upperMaterialRef} color="#8fefff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[1, 1, 1, 112, 1, true]} />
          <meshBasicMaterial ref={wallMaterialRef} color="#42ffc8" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} wireframe />
        </mesh>
        <mesh>
          <sphereGeometry args={[1, 56, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshBasicMaterial ref={domeMaterialRef} color="#37a8ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} wireframe />
        </mesh>
      </group>
      <instancedMesh ref={particleRef} args={[undefined, undefined, particles.length]} visible={false} frustumCulled={false}>
        <sphereGeometry args={[0.024, 8, 8]} />
        <meshBasicMaterial color="#ff62ff" transparent opacity={0.52} blending={AdditiveBlending} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}
