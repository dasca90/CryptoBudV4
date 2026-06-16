import type { CoinVisualState } from '../state/airScannerVisualState';
import type { Vector3Tuple } from 'three';

export type OrbLabelMode = 'camera_billboard_front_decal';

export interface OrbLabelOrientationAudit {
  symbol: string;
  labelMode: OrbLabelMode;
  facingCamera: boolean;
  mirroredDetected: boolean;
}

export function auditOrbLabelOrientation(input: {
  symbol: string;
  labelMode?: OrbLabelMode;
  usesCameraBillboard: boolean;
  labelRotatesWithOrb: boolean;
  positiveScale: boolean;
}): OrbLabelOrientationAudit {
  const labelMode = input.labelMode ?? 'camera_billboard_front_decal';
  const facingCamera = input.usesCameraBillboard && !input.labelRotatesWithOrb;
  return {
    symbol: input.symbol,
    labelMode,
    facingCamera,
    mirroredDetected: !input.positiveScale || input.labelRotatesWithOrb,
  };
}

export function labelShouldRenderForState(state: CoinVisualState): boolean {
  return state !== 'cooldown';
}

export function badgeLabelIsMirrored(input: { usesCameraBillboard: boolean; labelRotatesWithOrb: boolean; positiveScale: boolean }): boolean {
  return auditOrbLabelOrientation({
    symbol: 'BADGE',
    usesCameraBillboard: input.usesCameraBillboard,
    labelRotatesWithOrb: input.labelRotatesWithOrb,
    positiveScale: input.positiveScale,
  }).mirroredDetected;
}

export function calculateFrontFacingLabelOffset(input: {
  cameraPosition: Vector3Tuple;
  orbPosition: Vector3Tuple;
  radius: number;
}): Vector3Tuple {
  const dx = input.cameraPosition[0] - input.orbPosition[0];
  const dy = input.cameraPosition[1] - input.orbPosition[1];
  const dz = input.cameraPosition[2] - input.orbPosition[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  return [
    (dx / length) * input.radius,
    (dy / length) * input.radius,
    (dz / length) * input.radius,
  ];
}
