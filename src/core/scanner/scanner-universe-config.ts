export const DEFAULT_SCANNER_UNIVERSE_SIZE = 100;
export const MIN_SCANNER_UNIVERSE_SIZE = 1;

export function parseScannerUniverseSize(value: unknown): number | null {
  if (typeof value === 'string' && value.trim() === '') return null;
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= MIN_SCANNER_UNIVERSE_SIZE ? candidate : null;
}

export function resolveScannerUniverseSizeDraft(raw: string): { draft: string; value: number | null; valid: boolean } {
  const value = parseScannerUniverseSize(raw);
  return { draft: raw, value, valid: value != null };
}

export function normalizeScannerUniverseSize(value: unknown, legacyValue?: unknown): number {
  return parseScannerUniverseSize(value) ?? parseScannerUniverseSize(legacyValue) ?? DEFAULT_SCANNER_UNIVERSE_SIZE;
}

export function getEffectiveScannerUniverseSize(configuredUniverseSize: unknown, eligibleUniverseAvailable: number): number {
  return Math.min(normalizeScannerUniverseSize(configuredUniverseSize), Math.max(0, Math.floor(eligibleUniverseAvailable)));
}

export function getFullScanCooldownMs(universeSize: number): number {
  const size = normalizeScannerUniverseSize(universeSize);
  if (size <= 20) return 15_000;
  if (size <= 50) return 20_000;
  if (size <= 100) return 30_000;
  return 60_000;
}
