export const DEFAULT_SCANNER_UNIVERSE_SIZE = 100;
export const MIN_SCANNER_UNIVERSE_SIZE = 20;
export const MAX_SCANNER_UNIVERSE_SIZE = 250;

export function normalizeScannerUniverseSize(value: unknown, legacyValue?: unknown): number {
  const candidate = Number(value ?? legacyValue ?? DEFAULT_SCANNER_UNIVERSE_SIZE);
  if (!Number.isFinite(candidate)) return DEFAULT_SCANNER_UNIVERSE_SIZE;
  return Math.min(MAX_SCANNER_UNIVERSE_SIZE, Math.max(MIN_SCANNER_UNIVERSE_SIZE, Math.round(candidate)));
}

export function getFullScanCooldownMs(universeSize: number): number {
  const size = normalizeScannerUniverseSize(universeSize);
  if (size <= 20) return 15_000;
  if (size <= 50) return 20_000;
  if (size <= 100) return 30_000;
  return 60_000;
}
