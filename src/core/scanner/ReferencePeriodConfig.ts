export interface ReferencePeriodConfig {
  referenceWindow: number;
  label: string;
  interval: string;
  limit: number;
  scannerReferenceCandles: number;
}

export const REFERENCE_PERIOD_CONFIGS: ReferencePeriodConfig[] = [
  { referenceWindow: 0.04, label: 'Last Hour',     interval: '1m',  limit: 60, scannerReferenceCandles: 30 },
  { referenceWindow: 1,    label: 'Last Day',      interval: '1h',  limit: 24, scannerReferenceCandles: 24 },
  { referenceWindow: 3,    label: 'Last 3 Days',   interval: '1h',  limit: 72, scannerReferenceCandles: 48 },
  { referenceWindow: 7,    label: 'Last Week',     interval: '4h',  limit: 42, scannerReferenceCandles: 32 },
  { referenceWindow: 21,   label: 'Last 3 Weeks',  interval: '1d',  limit: 21, scannerReferenceCandles: 21 },
  { referenceWindow: 30,   label: 'Last Month',    interval: '1d',  limit: 30, scannerReferenceCandles: 30 },
  { referenceWindow: 90,   label: 'Last 3 Months', interval: '1d',  limit: 90, scannerReferenceCandles: 60 },
];

const DEFAULT_REFERENCE_WINDOW = 21;
const AUTOBOTS_DEFAULT_REF_WINDOW = 7;

export function getReferencePeriodConfig(referenceWindow: number): ReferencePeriodConfig | null {
  return REFERENCE_PERIOD_CONFIGS.find(c => c.referenceWindow === referenceWindow) ?? null;
}

export function getDefaultReferencePeriodConfig(): ReferencePeriodConfig {
  return getReferencePeriodConfig(DEFAULT_REFERENCE_WINDOW)!;
}

export function getAutoBotsDefaultConfig(): ReferencePeriodConfig {
  return getReferencePeriodConfig(AUTOBOTS_DEFAULT_REF_WINDOW)!;
}

export function mapLegacyScannerPeriodToReferenceWindow(period: '1h' | '4h' | '1d' | '1w'): number {
  if (period === '1h') return 0.04;
  if (period === '4h') return 0.167;
  if (period === '1d') return 1;
  return 7; // 1w
}

export type RefWindowString = 'AUTO' | 'LAST_HOUR' | 'LAST_DAY' | 'LAST_3_DAYS' | 'LAST_WEEK' | 'LAST_3_WEEKS';

export function mapRefWindowStringToNumeric(refWindow: RefWindowString | string): number | null {
  switch (refWindow) {
    case 'LAST_HOUR': return 0.04;
    case 'LAST_DAY': return 1;
    case 'LAST_3_DAYS': return 3;
    case 'LAST_WEEK': return 7;
    case 'LAST_3_WEEKS': return 21;
    case 'AUTO': return null; // use default
    default: return null;
  }
}

export function checkReferenceSettingsConsistency(
  uiRefWindow: string | undefined,
  scannerReferencePeriod: '1h' | '4h' | '1d' | '1w',
): { consistent: boolean; expectedFromRefWindow: number | null; actualFromScannerPeriod: number; warning: string | null } {
  const actualFromScannerPeriod = mapLegacyScannerPeriodToReferenceWindow(scannerReferencePeriod);
  const expectedFromRefWindow = uiRefWindow ? mapRefWindowStringToNumeric(uiRefWindow) : null;

  if (expectedFromRefWindow === null) {
    return { consistent: true, expectedFromRefWindow: null, actualFromScannerPeriod, warning: null };
  }

  const consistent = Math.abs(expectedFromRefWindow - actualFromScannerPeriod) < 0.01;
  const warning = consistent ? null : `refWindow=${uiRefWindow} maps to ${expectedFromRefWindow}d but scannerReferencePeriod=${scannerReferencePeriod} maps to ${actualFromScannerPeriod}d`;
  return { consistent, expectedFromRefWindow, actualFromScannerPeriod, warning };
}
