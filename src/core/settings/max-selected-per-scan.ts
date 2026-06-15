import { logger } from '../../utils/logger';

export type MaxSelectedPerScanSource = 'ui_setting' | 'persisted_setting' | 'default_10' | 'legacy_migrated';

export interface MaxSelectedPerScanResolutionInput {
  appBootId?: string;
  scanId?: string;
  uiValue?: unknown;
  persistedMaxSelectedPerScan?: unknown;
  persistedLegacyMaxEntriesPerCycle?: unknown;
  runtimeValue?: unknown;
  plannerInputValue?: unknown;
  scannerInputValue?: unknown;
  maxSelectedPerScan?: unknown;
  maxEntriesPerCycle?: unknown;
  userExplicit?: boolean;
  sourceHint?: MaxSelectedPerScanSource;
  reason?: string;
  emitAudit?: boolean;
}

export interface MaxSelectedPerScanResolution {
  value: number;
  source: MaxSelectedPerScanSource;
  migrationApplied: boolean;
  clamped: boolean;
  reason: string;
}

export const DEFAULT_MAX_SELECTED_PER_SCAN = 10;
export const MIN_MAX_SELECTED_PER_SCAN = 1;
export const MAX_MAX_SELECTED_PER_SCAN = 20;

function numeric(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

function clamp(v: number): { value: number; clamped: boolean } {
  const floored = Math.floor(v);
  const value = Math.max(MIN_MAX_SELECTED_PER_SCAN, Math.min(MAX_MAX_SELECTED_PER_SCAN, floored));
  return { value, clamped: value !== v };
}

function display(v: unknown): string {
  return v == null ? 'n/a' : String(v);
}

export function resolveMaxSelectedPerScanConfig(input: MaxSelectedPerScanResolutionInput): MaxSelectedPerScanResolution {
  const canonicalRaw =
    input.uiValue
    ?? input.runtimeValue
    ?? input.plannerInputValue
    ?? input.scannerInputValue
    ?? input.maxSelectedPerScan
    ?? input.persistedMaxSelectedPerScan;

  const canonicalNumber = numeric(canonicalRaw);
  const legacyNumber = numeric(input.maxEntriesPerCycle ?? input.persistedLegacyMaxEntriesPerCycle);
  const hasCanonical = canonicalNumber !== null;
  const legacyOnly = !hasCanonical && legacyNumber !== null;
  const persistedFourWithoutExplicitUserIntent =
    hasCanonical
    && canonicalNumber === 4
    && legacyNumber === 4
    && input.userExplicit !== true
    && input.uiValue == null;
  const source: MaxSelectedPerScanSource = persistedFourWithoutExplicitUserIntent
    ? 'legacy_migrated'
    : hasCanonical
    ? (input.sourceHint ?? (input.uiValue != null ? 'ui_setting' : 'persisted_setting'))
    : legacyOnly
      ? 'legacy_migrated'
      : 'default_10';
  const rawValue = (legacyOnly || persistedFourWithoutExplicitUserIntent) ? DEFAULT_MAX_SELECTED_PER_SCAN : hasCanonical ? canonicalNumber! : DEFAULT_MAX_SELECTED_PER_SCAN;
  const clamped = clamp(rawValue);
  const migrationApplied = legacyOnly || persistedFourWithoutExplicitUserIntent;
  const reason = persistedFourWithoutExplicitUserIntent
    ? 'persisted_4_without_user_marker_migrated_to_default_10'
    : input.reason
    ?? (legacyOnly
      ? 'legacy_maxEntriesPerCycle_ignored_new_default_10'
      : hasCanonical
        ? 'canonical_maxSelectedPerScan_used'
        : 'canonical_missing_default_10');

  const result = {
    value: clamped.value,
    source,
    migrationApplied,
    clamped: clamped.clamped,
    reason,
  };

  if (input.emitAudit !== false) {
    logger.info(
      `MAX_SELECTED_PER_SCAN_CONFIG_AUDIT: appBootId=${input.appBootId ?? 'n/a'} scanId=${input.scanId ?? 'n/a'} uiValue=${display(input.uiValue)} persistedMaxSelectedPerScan=${display(input.persistedMaxSelectedPerScan ?? input.maxSelectedPerScan)} persistedLegacyMaxEntriesPerCycle=${display(input.persistedLegacyMaxEntriesPerCycle ?? input.maxEntriesPerCycle)} hydratedRuntimeValue=${display(input.runtimeValue)} plannerInputValue=${display(input.plannerInputValue)} scannerInputValue=${display(input.scannerInputValue)} finalEffectiveMaxSelectedPerScan=${result.value} source=${result.source} migrationApplied=${String(result.migrationApplied)} clamped=${String(result.clamped)} userExplicit=${String(input.userExplicit === true)} reason=${result.reason}`
    );
  }

  return result;
}
