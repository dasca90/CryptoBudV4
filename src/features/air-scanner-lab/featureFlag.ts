const FEATURE_KEY = 'enable3DScannerLabPreview';
const LEGACY_FALLBACK_KEY = 'useLegacyAirScanner3D';

export function is3DScannerLabPreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get(FEATURE_KEY);
    if (queryValue === '1' || queryValue === 'true') return true;
    if (queryValue === '0' || queryValue === 'false') return false;
    const legacyQueryValue = params.get(LEGACY_FALLBACK_KEY);
    if (legacyQueryValue === '1' || legacyQueryValue === 'true') return false;
    const storedValue = window.localStorage.getItem(FEATURE_KEY);
    if (storedValue === '1' || storedValue === 'true') return true;
    const legacyStoredValue = window.localStorage.getItem(LEGACY_FALLBACK_KEY);
    if (legacyStoredValue === '1' || legacyStoredValue === 'true') return false;
    return true;
  } catch {
    return false;
  }
}

export function get3DScannerLabPreviewFlagKey(): string {
  return FEATURE_KEY;
}

export function getLegacyAirScannerFallbackFlagKey(): string {
  return LEGACY_FALLBACK_KEY;
}
