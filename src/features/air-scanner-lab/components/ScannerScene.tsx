import { useEffect, useMemo, useRef, useState } from 'react';
import { Environment, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Vector3Tuple } from 'three';
import { BUY_TRANSFER_HERO_POSITION, MAX_RENDERED_COINS, QUALITY_PARTICLE_BUDGET, getGraphicsQualityConfig, QUALITY_DPR, type AirScannerQuality, type AnimationDebugState, type CoinVisualState, type MockScannerCoin, type ScannerToggles, type ScreenPoint } from '../state/airScannerVisualState';
import { mockScannerCoins } from '../state/mockScannerFeed';
import { mapMockCoinToVisualState } from '../utils/visualStateMapper';
import { BUY_PULL_DURATION_MS, acquireBuyLightningLock, createAnimationId, getBlockedPushFrame, getBuyPullProgress, getQualityParticleMultiplier, releaseBuyLightningLock } from '../utils/animationTimelines';
import { CoinOrb } from './CoinOrb';
import { CoreEnergy, getScanPulseFrame } from './CoreEnergy';
import { HolographicGrid } from './HolographicGrid';
import { ParticleTrail } from './ParticleTrail';
import { AmbientScannerParticles } from './AmbientScannerParticles';
import { LightningArc } from './LightningArc';

interface ScannerSceneProps {
  visualState: CoinVisualState;
  quality: AirScannerQuality;
  toggles: ScannerToggles;
  lifecycleId: number;
  coins?: MockScannerCoin[];
  transferSymbol?: string;
  onDebugUpdate: (debug: AnimationDebugState) => void;
  onOpenPositionConfirmed: () => void;
  onTransferSourceUpdate: (point: ScreenPoint | null) => void;
  onCoinSelect: (coin: MockScannerCoin) => void;
}

interface CoinFrame {
  coin: MockScannerCoin;
  state: CoinVisualState;
  position: Vector3Tuple;
  opacity: number;
  transferProgress?: number;
  scanPulseIntensity?: number;
  focused?: boolean;
}

interface OrbVelocity {
  x: number;
  y: number;
  z: number;
}

const COLLISION_DAMPING = 0.62;
const COLLISION_RESPONSE = 0.055;
const COLLISION_VERTICAL_RESPONSE = 0.008;
const COLLISION_MAX_SPEED = 0.035;
const COLLISION_PERSONAL_SPACE = 0.42;
const COLLISION_ITERATIONS = 7;
const COLLISION_VERTICAL_WEIGHT = 0.58;
const SCREEN_SPACE_PERSONAL_SPACE = 0.2;
const SCREEN_SPACE_ITERATIONS = 8;
const CENTER_KEEP_OUT_RADIUS = 4.55;
const COLLISION_BUCKET_SIZE = 2.25;
const SCREEN_BUCKET_SIZE = 0.32;
const BUY_TRANSFER_VISIBLE_OPACITY_MIN = 0.9;
const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

export interface SpatialCollisionPoint {
  x: number;
  y: number;
  z: number;
  active?: boolean;
}

export function getSpatialCollisionPairs(points: SpatialCollisionPoint[], bucketSize = COLLISION_BUCKET_SIZE): Array<[number, number]> {
  const buckets = new Map<string, number[]>();
  const activePoints = points.map((point, index) => ({ point, index })).filter(({ point }) => point.active !== false);
  for (const { point, index } of activePoints) {
    const bx = Math.floor(point.x / bucketSize);
    const by = Math.floor(point.y / bucketSize);
    const bz = Math.floor(point.z / bucketSize);
    const key = `${bx}|${by}|${bz}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  }

  const seen = new Set<string>();
  const pairs: Array<[number, number]> = [];
  for (const { point, index } of activePoints) {
    const bx = Math.floor(point.x / bucketSize);
    const by = Math.floor(point.y / bucketSize);
    const bz = Math.floor(point.z / bucketSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = buckets.get(`${bx + dx}|${by + dy}|${bz + dz}`);
          if (!bucket) continue;
          for (const otherIndex of bucket) {
            if (otherIndex <= index) continue;
            const key = `${index}:${otherIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push([index, otherIndex]);
          }
        }
      }
    }
  }
  return pairs;
}

function getCollisionRadius(frame: Pick<CoinFrame, 'state' | 'focused'>): number {
  if (frame.focused) return 1.24;
  if (frame.state === 'buy_pull_to_core') return 1.18;
  if (frame.state === 'blocked_push_out') return 0.78;
  if (frame.state === 'wait') return 0.7;
  if (frame.state === 'buy_ready') return 0.74;
  if (frame.state === 'open_position') return 0.72;
  return 0.66;
}

function clampScannerRange(value: number): number {
  return Math.max(-7.4, Math.min(7.4, value));
}

function clampVelocity(value: number): number {
  return Math.max(-COLLISION_MAX_SPEED, Math.min(COLLISION_MAX_SPEED, value));
}

function resolveOrbCollisions(frames: CoinFrame[], velocities: Map<string, OrbVelocity>, metrics?: { collisionChecks: number }): CoinFrame[] {
  const resolved = frames.map((frame) => ({
    ...frame,
    position: [...frame.position] as Vector3Tuple,
  }));

  for (const frame of resolved) {
    const velocity = velocities.get(frame.coin.symbol) ?? { x: 0, y: 0, z: 0 };
    const locked = frame.state === 'buy_pull_to_core' || frame.focused === true;
    if (locked) {
      velocities.set(frame.coin.symbol, { x: 0, y: 0, z: 0 });
      continue;
    }
    velocity.x *= COLLISION_DAMPING;
    velocity.y *= 0.54;
    velocity.z *= COLLISION_DAMPING;
    frame.position[0] = clampScannerRange(frame.position[0] + velocity.x);
    frame.position[1] = Math.max(0.72, Math.min(1.82, frame.position[1] + velocity.y));
    frame.position[2] = clampScannerRange(frame.position[2] + velocity.z);
    velocities.set(frame.coin.symbol, velocity);
  }

  for (let iteration = 0; iteration < COLLISION_ITERATIONS; iteration += 1) {
    const pairs = getSpatialCollisionPairs(resolved.map((frame) => ({
      x: frame.position[0],
      y: frame.position[1] * COLLISION_VERTICAL_WEIGHT,
      z: frame.position[2],
      active: frame.opacity > 0.04,
    })));
    metrics && (metrics.collisionChecks += pairs.length);
    for (const [i, j] of pairs) {
        const first = resolved[i];
        const second = resolved[j];
        if (first.opacity <= 0.04 || second.opacity <= 0.04) continue;

        const dx = second.position[0] - first.position[0];
        const dy = (second.position[1] - first.position[1]) * COLLISION_VERTICAL_WEIGHT;
        const dz = second.position[2] - first.position[2];
        const distance = Math.hypot(dx, dy, dz) || 0.0001;
        const minimumDistance = getCollisionRadius(first) + getCollisionRadius(second) + COLLISION_PERSONAL_SPACE;
        if (distance >= minimumDistance) continue;

        const overlap = minimumDistance - distance;
        const nx = dx / distance;
        const ny = dy / distance;
        const nz = dz / distance;
        const firstLocked = first.state === 'buy_pull_to_core' || first.focused === true;
        const secondLocked = second.state === 'buy_pull_to_core' || second.focused === true;
        const firstPush = secondLocked ? overlap * 0.36 : overlap * 0.18;
        const secondPush = firstLocked ? overlap * 0.36 : overlap * 0.18;
        const firstVelocity = velocities.get(first.coin.symbol) ?? { x: 0, y: 0, z: 0 };
        const secondVelocity = velocities.get(second.coin.symbol) ?? { x: 0, y: 0, z: 0 };

        if (!firstLocked) {
          first.position[0] = clampScannerRange(first.position[0] - nx * firstPush);
          first.position[2] = clampScannerRange(first.position[2] - nz * firstPush);
          first.position[1] = Math.max(0.72, Math.min(1.78, first.position[1] - ny * firstPush * 0.22 + overlap * 0.006));
          firstVelocity.x = clampVelocity(firstVelocity.x - nx * overlap * COLLISION_RESPONSE);
          firstVelocity.y = clampVelocity(firstVelocity.y - ny * overlap * COLLISION_VERTICAL_RESPONSE + overlap * 0.002);
          firstVelocity.z = clampVelocity(firstVelocity.z - nz * overlap * COLLISION_RESPONSE);
          velocities.set(first.coin.symbol, firstVelocity);
        }
        if (!secondLocked) {
          second.position[0] = clampScannerRange(second.position[0] + nx * secondPush);
          second.position[2] = clampScannerRange(second.position[2] + nz * secondPush);
          second.position[1] = Math.max(0.72, Math.min(1.78, second.position[1] + ny * secondPush * 0.22 + overlap * 0.006));
          secondVelocity.x = clampVelocity(secondVelocity.x + nx * overlap * COLLISION_RESPONSE);
          secondVelocity.y = clampVelocity(secondVelocity.y + ny * overlap * COLLISION_VERTICAL_RESPONSE + overlap * 0.002);
          secondVelocity.z = clampVelocity(secondVelocity.z + nz * overlap * COLLISION_RESPONSE);
          velocities.set(second.coin.symbol, secondVelocity);
        }
    }
  }

  return resolved;
}

function resolveProjectedOverlaps(frames: CoinFrame[], camera: { position: Vector3 }, metrics?: { collisionChecks: number }): CoinFrame[] {
  const resolved = frames.map((frame) => ({
    ...frame,
    position: [...frame.position] as Vector3Tuple,
  }));
  const firstProjected = new Vector3();
  const secondProjected = new Vector3();
  const projectedPoints = resolved.map((frame) => {
    const projected = new Vector3(...frame.position).project(camera as never);
    return { x: projected.x, y: projected.y, z: 0, active: frame.opacity > 0.04 };
  });

  for (let iteration = 0; iteration < SCREEN_SPACE_ITERATIONS; iteration += 1) {
    const pairs = getSpatialCollisionPairs(projectedPoints, SCREEN_BUCKET_SIZE);
    metrics && (metrics.collisionChecks += pairs.length);
    for (const [i, j] of pairs) {
        const first = resolved[i];
        const second = resolved[j];
        if (first.opacity <= 0.04 || second.opacity <= 0.04) continue;

        firstProjected.set(...first.position).project(camera as never);
        secondProjected.set(...second.position).project(camera as never);

        const dx = secondProjected.x - firstProjected.x;
        const dy = secondProjected.y - firstProjected.y;
        const distance = Math.hypot(dx, dy) || 0.0001;
        const heroInPair = first.state === 'buy_pull_to_core' || second.state === 'buy_pull_to_core' || first.focused === true || second.focused === true;
        const minimumDistance = heroInPair ? SCREEN_SPACE_PERSONAL_SPACE * 1.45 : SCREEN_SPACE_PERSONAL_SPACE;
        if (distance >= minimumDistance) continue;

        const overlap = minimumDistance - distance;
        const firstLocked = first.state === 'buy_pull_to_core' || first.focused === true;
        const secondLocked = second.state === 'buy_pull_to_core' || second.focused === true;

        const worldDx = second.position[0] - first.position[0];
        const worldDz = second.position[2] - first.position[2];
        const worldDistance = Math.hypot(worldDx, worldDz) || 0.0001;
        let nx = worldDx / worldDistance;
        let nz = worldDz / worldDistance;
        if (Math.abs(nx) < 0.05 && Math.abs(nz) < 0.05) {
          nx = dx >= 0 ? 1 : -1;
          nz = dy >= 0 ? -0.4 : 0.4;
        }

        const worldPush = overlap * 1.22;
        if (!firstLocked) {
          first.position[0] = clampScannerRange(first.position[0] - nx * worldPush);
          first.position[2] = clampScannerRange(first.position[2] - nz * worldPush);
          first.position[1] = Math.max(0.72, Math.min(1.82, first.position[1] + overlap * 0.045));
        }
        if (!secondLocked) {
          second.position[0] = clampScannerRange(second.position[0] + nx * worldPush);
          second.position[2] = clampScannerRange(second.position[2] + nz * worldPush);
          second.position[1] = Math.max(0.72, Math.min(1.82, second.position[1] + overlap * 0.045));
        }
    }
  }

  return resolved;
}

function hashSymbol(symbol: string): number {
  return symbol.split('').reduce((value, char) => value + char.charCodeAt(0), 0);
}

function enforceCenterKeepOut(frame: CoinFrame): CoinFrame {
  if (frame.state === 'buy_pull_to_core') return frame;
  const radialDistance = Math.hypot(frame.position[0], frame.position[2]);
  if (radialDistance >= CENTER_KEEP_OUT_RADIUS) return frame;
  const angle = radialDistance > 0.0001 ? Math.atan2(frame.position[2], frame.position[0]) : hashSymbol(frame.coin.symbol) * 0.917;
  return {
    ...frame,
    position: [
      Math.cos(angle) * CENTER_KEEP_OUT_RADIUS,
      frame.position[1],
      Math.sin(angle) * CENTER_KEEP_OUT_RADIUS,
    ],
  };
}

function getRoamingCoinPosition(position: Vector3Tuple, coin: MockScannerCoin, index: number, time: number): Vector3Tuple {
  const radius = Math.hypot(position[0], position[2]);
  if (radius < 0.01) return position;
  const seed = hashSymbol(coin.symbol);
  const direction = seed % 2 === 0 ? 1 : -1;
  const speed = (0.0035 + (seed % 9) * 0.0009) * direction;
  const angle = Math.atan2(position[2], position[0]) + time * speed + Math.sin(time * 0.035 + seed) * 0.012;
  const radiusDrift = Math.sin(time * (0.045 + (index % 5) * 0.006) + seed * 0.07) * (0.1 + (index % 4) * 0.02);
  const targetRadius = Math.max(CENTER_KEEP_OUT_RADIUS + 0.22, radius + radiusDrift);
  const heightDrift = Math.sin(time * (0.07 + (seed % 7) * 0.004) + index) * 0.055;
  return [
    Math.cos(angle) * targetRadius,
    Math.max(0.72, Math.min(1.92, position[1] + heightDrift)),
    Math.sin(angle) * targetRadius,
  ];
}

function getBuyTransferClearancePosition(position: Vector3Tuple, index: number): Vector3Tuple {
  const radialDistance = Math.hypot(position[0], position[2]);
  const minimumRadius = 4.05 + (index % 4) * 0.24;
  const heroDistance = Math.hypot(position[0] - BUY_TRANSFER_HERO_POSITION[0], position[2] - BUY_TRANSFER_HERO_POSITION[2]);
  if (radialDistance >= minimumRadius && heroDistance >= 2.65) return position;

  const fallbackAngle = index * 1.618;
  let directionX = radialDistance > 0.01 ? position[0] / radialDistance : Math.cos(fallbackAngle);
  let directionZ = radialDistance > 0.01 ? position[2] / radialDistance : Math.sin(fallbackAngle);
  if (heroDistance < 2.65) {
    const awayX = position[0] - BUY_TRANSFER_HERO_POSITION[0];
    const awayZ = position[2] - BUY_TRANSFER_HERO_POSITION[2];
    const awayLength = Math.hypot(awayX, awayZ) || 1;
    directionX = awayX / awayLength;
    directionZ = awayZ / awayLength;
  }
  const targetRadius = heroDistance < 2.65 ? Math.max(minimumRadius, radialDistance + 1.45) : minimumRadius;
  return [
    directionX * targetRadius,
    Math.max(0.72, position[1] - 0.14),
    directionZ * targetRadius,
  ];
}

function getSceneCoinState(params: {
  coin: MockScannerCoin;
  selectedState: CoinVisualState;
  transferSymbol: string;
  waitSymbol: string;
  blockedSymbol: string;
}): CoinVisualState {
  const { coin, selectedState, transferSymbol, waitSymbol, blockedSymbol } = params;
  if (selectedState === 'scanning') return mapMockCoinToVisualState(coin);
  if (selectedState === 'wait') return coin.symbol === waitSymbol ? 'wait' : coin.symbol === transferSymbol ? 'neutral' : mapMockCoinToVisualState({ ...coin, rawState: coin.rawState === 'blocked_candidate' ? 'neutral' : coin.rawState });
  if (selectedState === 'buy_pull_to_core') return coin.symbol === transferSymbol ? 'buy_pull_to_core' : mapMockCoinToVisualState(coin);
  if (selectedState === 'blocked_push_out') return coin.symbol === blockedSymbol ? 'blocked_push_out' : mapMockCoinToVisualState(coin);
  if (selectedState === 'open_position') return coin.symbol === transferSymbol ? 'open_position' : mapMockCoinToVisualState(coin);
  return mapMockCoinToVisualState(coin);
}

export function ScannerScene({ visualState, quality, toggles, lifecycleId, coins = mockScannerCoins, transferSymbol, onDebugUpdate, onOpenPositionConfirmed, onTransferSourceUpdate, onCoinSelect }: ScannerSceneProps) {
  const { camera, size } = useThree();
  const qualityConfig = getGraphicsQualityConfig(quality);
  const renderedCoins = useMemo(() => coins.slice(0, MAX_RENDERED_COINS), [coins]);
  const activeTransferSymbol = transferSymbol
    ?? renderedCoins.find((coin) => coin.isSelectedBuy)?.symbol
    ?? renderedCoins.find((coin) => coin.rawState === 'buy_candidate')?.symbol
    ?? renderedCoins[0]?.symbol
    ?? 'UNIUSDT';
  const waitSymbol = renderedCoins.find((coin) => coin.rawState === 'wait_candidate')?.symbol ?? activeTransferSymbol;
  const blockedSymbol = renderedCoins.find((coin) => coin.rawState === 'blocked_candidate')?.symbol ?? activeTransferSymbol;
  const hiddenRef = useRef(false);
  useEffect(() => {
    const onVisibility = () => { hiddenRef.current = document.hidden; };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const startTimeRef = useRef(performance.now());
  const animationIdRef = useRef('');
  const lightningLockedRef = useRef(false);
  const performanceAuditRef = useRef(0);
  const framesRef = useRef(0);
  const frameTimeTotalRef = useRef(0);
  const fpsStartedRef = useRef(performance.now());
  const sourceProjectRef = useRef(0);
  const frameStateUpdateRef = useRef(0);
  const velocityRef = useRef<Map<string, OrbVelocity>>(new Map());
  const [coinFrames, setCoinFrames] = useState<CoinFrame[]>([]);
  const particleCount = Math.round(QUALITY_PARTICLE_BUDGET[qualityConfig.quality] * qualityConfig.particleMultiplier);

  useEffect(() => {
    const previousState = animationIdRef.current ? visualState : 'initial';
    startTimeRef.current = performance.now();
    animationIdRef.current = createAnimationId('LAB', visualState);
    lightningLockedRef.current = false;
    velocityRef.current.clear();
    console.info('AIR_SCANNER_LAB_STATE_CHANGE', {
      symbol: visualState === 'wait' ? 'MATICUSDT' : visualState === 'blocked_push_out' ? 'SUIUSDT' : 'UNIUSDT',
      previousState,
      nextState: visualState,
      animationId: animationIdRef.current,
      timestamp: new Date().toISOString(),
    });
    if (visualState === 'buy_pull_to_core') {
      lightningLockedRef.current = acquireBuyLightningLock(activeTransferSymbol, String(lifecycleId));
      console.info('AIR_SCANNER_LAB_BUY_PULL_START', {
        symbol: activeTransferSymbol,
        durationMs: BUY_PULL_DURATION_MS,
        lightningEnabled: toggles.buyLightning && lightningLockedRef.current,
        startPosition: renderedCoins.find((coin) => coin.symbol === activeTransferSymbol)?.position,
        targetPanel: 'open_positions',
      });
    }
    if (visualState === 'blocked_push_out') {
      console.info('AIR_SCANNER_LAB_BLOCKED_PUSH_OUT', {
        symbol: blockedSymbol,
        reasons: renderedCoins.find((coin) => coin.symbol === blockedSymbol)?.reasons,
        fadeEnabled: true,
        pushedOutDirection: 'away_from_core',
      });
    }
    return () => {
      releaseBuyLightningLock(activeTransferSymbol, String(lifecycleId));
    };
  }, [activeTransferSymbol, blockedSymbol, lifecycleId, renderedCoins, toggles.buyLightning, visualState]);

  useFrame((stateFrame) => {
    if (hiddenRef.current) return;
    const now = performance.now();
    const frameStart = performance.now();
    const elapsed = now - startTimeRef.current;
    const collisionMetrics = { collisionChecks: 0 };
    const scanFrame = getScanPulseFrame(stateFrame.clock.elapsedTime);
    const baseFrames = renderedCoins.map((coin, index) => {
      const state = getSceneCoinState({ coin, selectedState: visualState, transferSymbol: activeTransferSymbol, waitSymbol, blockedSymbol });
      let position = coin.position;
      let opacity = 1;
      if (state === 'buy_pull_to_core') {
        const progress = getBuyPullProgress(elapsed);
        const fadeProgress = Math.min(1, Math.max(0, (progress - 0.88) / 0.12));
        position = BUY_TRANSFER_HERO_POSITION;
        opacity = Math.max(BUY_TRANSFER_VISIBLE_OPACITY_MIN, 1 - fadeProgress * 0.08);
        if (progress >= 1 && lightningLockedRef.current) {
          releaseBuyLightningLock(activeTransferSymbol, String(lifecycleId));
          lightningLockedRef.current = false;
          onOpenPositionConfirmed();
          console.info('AIR_SCANNER_LAB_BUY_PULL_COMPLETE', {
            symbol: activeTransferSymbol,
            durationMs: BUY_PULL_DURATION_MS,
            openPositionVisualConfirmed: true,
          });
        }
      } else if (visualState === 'buy_pull_to_core') {
        position = getBuyTransferClearancePosition(position, index);
      }
      if (state !== 'buy_pull_to_core' && state !== 'blocked_push_out' && coin.isFocused !== true) {
        position = getRoamingCoinPosition(position, coin, index, stateFrame.clock.elapsedTime);
      }
      if (state === 'open_position' && coin.base === 'UNI') {
        opacity = 0;
      }
      if (state === 'blocked_push_out') {
        const frame = getBlockedPushFrame(coin.position, elapsed);
        position = frame.position;
        opacity = frame.opacity;
      }
      const shellDistance = Math.hypot(position[0], position[2], position[1] * 0.78);
      const shellDelta = Math.abs(shellDistance - scanFrame.radius);
      const scanPulseIntensity = visualState === 'scanning'
        ? Math.min(1, Math.exp(-(shellDelta * shellDelta) / 0.18) * scanFrame.opacity * 1.45)
        : 0;
      return {
        coin,
        state,
        position,
        opacity,
        transferProgress: state === 'buy_pull_to_core' ? getBuyPullProgress(elapsed) : undefined,
        scanPulseIntensity,
        focused: coin.isFocused === true && state !== 'buy_pull_to_core',
      };
    });
    const collisionResolvedFrames = resolveOrbCollisions(baseFrames, velocityRef.current, collisionMetrics);
    const projectedResolvedFrames = resolveProjectedOverlaps(collisionResolvedFrames, camera, collisionMetrics);
    const nextFrames = projectedResolvedFrames.map(enforceCenterKeepOut);
    if (now - frameStateUpdateRef.current > 33 || coinFrames.length === 0) {
      frameStateUpdateRef.current = now;
      setCoinFrames(nextFrames);
    }
    const transferFrame = nextFrames.find((frame) => frame.coin.symbol === activeTransferSymbol);
    if (transferFrame && (visualState === 'buy_pull_to_core' || transferFrame.state === 'buy_pull_to_core') && now - sourceProjectRef.current > 50) {
      sourceProjectRef.current = now;
      const projected = new Vector3(...transferFrame.position).project(camera);
      onTransferSourceUpdate({
        x: (projected.x * 0.5 + 0.5) * size.width,
        y: (-projected.y * 0.5 + 0.5) * size.height,
      });
    } else if (visualState !== 'buy_pull_to_core' && now - sourceProjectRef.current > 250) {
      onTransferSourceUpdate(null);
    }

    framesRef.current += 1;
    frameTimeTotalRef.current += performance.now() - frameStart;
    const fpsElapsed = now - fpsStartedRef.current;
    if (fpsElapsed > 600) {
      const fpsEstimate = Math.round((framesRef.current / fpsElapsed) * 1000);
      const avgFrameTimeMs = frameTimeTotalRef.current / Math.max(1, framesRef.current);
      const drawCallEstimate = nextFrames.filter((frame) => frame.opacity > 0.04).length * (qualityConfig.glowLayerScale > 0.7 ? 4 : 3)
        + (toggles.particles && (visualState === 'buy_pull_to_core' || visualState === 'blocked_push_out') ? 1 + blockedCoinFrames.length : 0)
        + (qualityConfig.bloom && toggles.bloom ? 2 : 0);
      framesRef.current = 0;
      frameTimeTotalRef.current = 0;
      fpsStartedRef.current = now;
      const activeLightningEffects = visualState === 'buy_pull_to_core' && toggles.buyLightning && lightningLockedRef.current ? 1 : 0;
      const activeAnimations = ['buy_pull_to_core', 'blocked_push_out', 'wait', 'scanning'].includes(visualState) ? 1 : 0;
      const activeParticles = toggles.particles ? (visualState === 'buy_pull_to_core' || visualState === 'blocked_push_out' ? particleCount : Math.floor(particleCount * 0.28)) : 0;
      const debug = {
        fpsEstimate,
        avgFrameTimeMs,
        renderedCoins: nextFrames.length,
        activeParticles,
        activeLightningEffects,
        activeAnimations,
        collisionChecks: collisionMetrics.collisionChecks,
        drawCallEstimate,
        qualityMode: qualityConfig.quality,
        bloomEnabled: qualityConfig.bloom && toggles.bloom,
        dpr: QUALITY_DPR[qualityConfig.quality],
      };
      onDebugUpdate(debug);
      if (IS_DEV && now - performanceAuditRef.current > 7000) {
        performanceAuditRef.current = now;
        console.info('GRAPHICS_PERFORMANCE_AUDIT', debug);
        console.info(`THREE_D_RENDER_LOOP_AUDIT: fps=${fpsEstimate} avgFrameTimeMs=${avgFrameTimeMs.toFixed(2)} renderedCoins=${nextFrames.length} quality=${qualityConfig.quality}`);
        console.info(`GRAPHICS_EFFECT_COST_AUDIT: particles=${activeParticles} drawCallEstimate=${drawCallEstimate} collisionChecks=${collisionMetrics.collisionChecks} bloom=${String(qualityConfig.bloom && toggles.bloom)} dpr=${QUALITY_DPR[qualityConfig.quality].join('-')}`);
        if (fpsEstimate < 45 && qualityConfig.quality !== 'low') {
          console.info(`PERFORMANCE_MODE_RECOMMENDATION: current=${qualityConfig.quality} recommended=low reason=fps_below_45`);
        }
      }
    }
  });

  const buyCoinFrame = useMemo(() => coinFrames.find((frame) => frame.coin.symbol === activeTransferSymbol), [activeTransferSymbol, coinFrames]);
  const blockedCoinFrame = useMemo(() => coinFrames.find((frame) => frame.coin.symbol === blockedSymbol), [blockedSymbol, coinFrames]);
  const blockedCoinFrames = useMemo(() => coinFrames.filter((frame) => frame.state === 'blocked_push_out'), [coinFrames]);
  const buyPullSource = useMemo(() => {
    const sourceIndex = renderedCoins.findIndex((coin) => coin.symbol === activeTransferSymbol);
    if (sourceIndex < 0) return null;
    return getBuyTransferClearancePosition(renderedCoins[sourceIndex].position, sourceIndex);
  }, [activeTransferSymbol, renderedCoins]);
  const successPulse = visualState === 'open_position' || (visualState === 'buy_pull_to_core' && buyCoinFrame ? (buyCoinFrame.transferProgress ?? 0) >= 1 : false);

  return (
    <>
      <color attach="background" args={['#020913']} />
      <fog attach="fog" args={['#031326', 4.8, 11]} />
      <ambientLight intensity={0.45} />
      <pointLight position={[0, 3.8, 1.5]} intensity={3.1} color="#19ccff" />
      <pointLight position={[3.5, 2.4, 0.8]} intensity={1.6} color="#ff41f4" />
      <pointLight position={[-3.6, 2.2, 1.5]} intensity={1.2} color="#ffc04d" />
      <Stars radius={42} depth={18} count={quality === 'low' ? 800 : 1400} factor={2.2} saturation={0} fade speed={0.25} />
      {toggles.particles && <AmbientScannerParticles count={qualityConfig.ambientParticleCount} />}
      {toggles.backgroundGrid && <HolographicGrid />}
      <CoreEnergy successPulse={successPulse} scanningPulse={visualState === 'scanning'} />
      {coinFrames.filter((frame) => frame.opacity > 0.04).map((frame) => (
        <CoinOrb key={frame.coin.symbol} coin={frame.coin} visualState={frame.state} position={frame.position} opacity={frame.opacity} transferProgress={frame.transferProgress} scanPulseIntensity={frame.scanPulseIntensity} realisticMaterials={toggles.realisticMaterials} glowLayerScale={qualityConfig.glowLayerScale} cheapMaterial={qualityConfig.useCheapOrbMaterial} onSelect={onCoinSelect} />
      ))}
      {buyCoinFrame && visualState === 'buy_pull_to_core' && (
        <ParticleTrail
          position={buyCoinFrame.position}
          color="#ff62ff"
          count={toggles.particles ? Math.floor(particleCount * 0.95) : 0}
          active={toggles.particles}
          spread={0.62}
          radius={0.026}
          opacity={0.92 * buyCoinFrame.opacity}
        />
      )}
      {buyPullSource && visualState === 'buy_pull_to_core' && toggles.buyLightning && (
        <LightningArc start={buyPullSource} end={BUY_TRANSFER_HERO_POSITION} enabled />
      )}
      {blockedCoinFrames.map((frame) => (
        <ParticleTrail
          key={`blocked-particles-${frame.coin.symbol}`}
          position={frame.position}
          color="#ff3158"
          count={toggles.particles ? Math.floor(particleCount * (frame.coin.symbol === blockedCoinFrame?.coin.symbol && visualState === 'blocked_push_out' ? 0.72 : 0.18)) : 0}
          active={toggles.particles}
        />
      ))}
      <Environment preset="night" />
      {toggles.bloom && qualityConfig.bloom && (
        <EffectComposer multisampling={qualityConfig.effectComposerMultisampling}>
          <Bloom intensity={qualityConfig.bloomIntensity} luminanceThreshold={0.12} luminanceSmoothing={0.34} />
        </EffectComposer>
      )}
    </>
  );
}
