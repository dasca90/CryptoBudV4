import { logger } from '../../utils/logger';

export type ScannerState =
  | 'floating'
  | 'locked_for_buy'
  | 'execution_submitted'
  | 'position_opened_hold'
  | 'pull_to_center'
  | 'detected'
  | 'locked'
  | 'approved'
  | 'capturing'
  | 'removed_from_scanner'
  | 'closed'
  | 'open'
  | 'rejected';

export interface VisualToken {
  state: ScannerState;
  label: string;
  dotColor: string;
  bubbleBorderColor: string;
  bubbleGlowColor: string;
  bubbleGlowSpread: string;
  bubbleInsetGlow: string;
  legendDotGlow: string;
  opacity: string;
}

const SCANNER_VISUAL_THEME: Record<string, VisualToken> = {
  floating: {
    state: 'floating',
    label: 'floating',
    dotColor: '#4dc9f6',
    bubbleBorderColor: 'rgba(77,201,246,0.25)',
    bubbleGlowColor: 'rgba(77,201,246,0.15)',
    bubbleGlowSpread: '0 0 14px',
    bubbleInsetGlow: 'inset 0 0 6px rgba(77,201,246,0.05)',
    legendDotGlow: '0 0 6px rgba(77,201,246,0.4)',
    opacity: '0.65',
  },
  locked_for_buy: {
    state: 'locked_for_buy',
    label: 'locked_for_buy',
    dotColor: '#f0b90b',
    bubbleBorderColor: '#f0b90b',
    bubbleGlowColor: 'rgba(240,185,11,0.55)',
    bubbleGlowSpread: '0 0 34px',
    bubbleInsetGlow: 'inset 0 0 14px rgba(240,185,11,0.12)',
    legendDotGlow: '0 0 10px rgba(240,185,11,0.7)',
    opacity: '1',
  },
  execution_submitted: {
    state: 'execution_submitted',
    label: 'execution_submitted',
    dotColor: '#f0883e',
    bubbleBorderColor: '#f0883e',
    bubbleGlowColor: 'rgba(240,136,62,0.48)',
    bubbleGlowSpread: '0 0 34px',
    bubbleInsetGlow: 'inset 0 0 14px rgba(240,136,62,0.12)',
    legendDotGlow: '0 0 10px rgba(240,136,62,0.65)',
    opacity: '1',
  },
  position_opened_hold: {
    state: 'position_opened_hold',
    label: 'position_open_hold',
    dotColor: '#3fb950',
    bubbleBorderColor: '#3fb950',
    bubbleGlowColor: 'rgba(63,185,80,0.58)',
    bubbleGlowSpread: '0 0 42px',
    bubbleInsetGlow: 'inset 0 0 16px rgba(63,185,80,0.12)',
    legendDotGlow: '0 0 12px rgba(63,185,80,0.7)',
    opacity: '1',
  },
  pull_to_center: {
    state: 'pull_to_center',
    label: 'pull_to_center',
    dotColor: '#bc8cff',
    bubbleBorderColor: '#bc8cff',
    bubbleGlowColor: 'rgba(188,140,255,0.58)',
    bubbleGlowSpread: '0 0 40px',
    bubbleInsetGlow: 'inset 0 0 18px rgba(188,140,255,0.14)',
    legendDotGlow: '0 0 12px rgba(188,140,255,0.7)',
    opacity: '1',
  },
  detected: {
    state: 'detected',
    label: 'detected',
    dotColor: '#4dc9f6',
    bubbleBorderColor: 'rgba(77,201,246,0.40)',
    bubbleGlowColor: 'rgba(77,201,246,0.25)',
    bubbleGlowSpread: '0 0 20px',
    bubbleInsetGlow: 'inset 0 0 0px transparent',
    legendDotGlow: '0 0 8px rgba(77,201,246,0.5)',
    opacity: '1',
  },
  locked: {
    state: 'locked',
    label: 'locked',
    dotColor: '#f0b90b',
    bubbleBorderColor: '#f0b90b',
    bubbleGlowColor: 'rgba(240,185,11,0.40)',
    bubbleGlowSpread: '0 0 30px',
    bubbleInsetGlow: 'inset 0 0 12px rgba(240,185,11,0.08)',
    legendDotGlow: '0 0 8px rgba(240,185,11,0.5)',
    opacity: '1',
  },
  approved: {
    state: 'approved',
    label: 'approved',
    dotColor: '#3fb950',
    bubbleBorderColor: '#3fb950',
    bubbleGlowColor: 'rgba(63,185,80,0.45)',
    bubbleGlowSpread: '0 0 36px',
    bubbleInsetGlow: 'inset 0 0 14px rgba(63,185,80,0.08)',
    legendDotGlow: '0 0 8px rgba(63,185,80,0.5)',
    opacity: '1',
  },
  capturing: {
    state: 'capturing',
    label: 'capturing',
    dotColor: '#bc8cff',
    bubbleBorderColor: '#bc8cff',
    bubbleGlowColor: 'rgba(188,140,255,0.45)',
    bubbleGlowSpread: '0 0 36px',
    bubbleInsetGlow: 'inset 0 0 14px rgba(188,140,255,0.08)',
    legendDotGlow: '0 0 8px rgba(188,140,255,0.5)',
    opacity: '1',
  },
  open: {
    state: 'open',
    label: 'open',
    dotColor: '#3fb950',
    bubbleBorderColor: '#3fb950',
    bubbleGlowColor: 'rgba(63,185,80,0.55)',
    bubbleGlowSpread: '0 0 40px',
    bubbleInsetGlow: 'inset 0 0 16px rgba(63,185,80,0.10)',
    legendDotGlow: '0 0 10px rgba(63,185,80,0.6)',
    opacity: '1',
  },
  rejected: {
    state: 'rejected',
    label: 'rejected',
    dotColor: '#f85149',
    bubbleBorderColor: 'rgba(248,81,73,0.35)',
    bubbleGlowColor: 'rgba(248,81,73,0.15)',
    bubbleGlowSpread: '0 0 8px',
    bubbleInsetGlow: 'inset 0 0 0px transparent',
    legendDotGlow: '0 0 4px rgba(248,81,73,0.3)',
    opacity: '0.45',
  },
};

export function getVisualToken(state: string): VisualToken | undefined {
  const token = SCANNER_VISUAL_THEME[state];
  if (!token) {
    logger.warn(`AIR_SCANNER_VISUAL_STATE_BINDING_AUDIT: logicalScannerState=${state} resolvedVisualState=unknown legendTokenUsed=none bubbleTokenUsed=none baseColor=none glowColor=none fallbackUsed=true fallbackReason=state_not_in_theme positionOpen=false executionSubmitted=false candidateStatus=n/a`);
    return undefined;
  }
  return token;
}

export function getAllVisualTokens(): VisualToken[] {
  return Object.values(SCANNER_VISUAL_THEME);
}

export function getLegendCssForState(state: string): string {
  const t = getVisualToken(state);
  if (!t) return '';
  return `background: ${t.dotColor}; box-shadow: ${t.legendDotGlow};`;
}

export function getBubbleCssForState(state: string): string {
  const t = getVisualToken(state);
  if (!t) return '';
  return `border-color: ${t.bubbleBorderColor}; box-shadow: ${t.bubbleGlowSpread} ${t.bubbleGlowColor}, ${t.bubbleInsetGlow}; opacity: ${t.opacity};`;
}
