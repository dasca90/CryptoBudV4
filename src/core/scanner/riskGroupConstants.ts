export const RISK_GROUPS = [
  { key: 'top_caps', label: 'Top Caps' },
  { key: 'large_caps', label: 'Large Caps' },
  { key: 'mid_caps', label: 'Mid Caps' },
  { key: 'high_risk', label: 'High Risk' },
  { key: 'very_high_risk', label: 'Very High Risk' },
] as const;

export const SCALPER_RISK_GROUPS = [
  { key: 'high_risk', label: 'High Risk' },
  { key: 'very_high_risk', label: 'Very High Risk' },
] as const;

export interface DipperRiskGroups {
  top_caps: boolean;
  large_caps: boolean;
  mid_caps: boolean;
  high_risk: boolean;
  very_high_risk: boolean;
}

const LEGACY_RISK_GROUP_KEY_TO_V4: Record<string, string> = {
  topMajors: 'top_caps',
  largeCaps: 'large_caps',
  midCaps: 'mid_caps',
  highRisk: 'high_risk',
  veryHighRisk: 'very_high_risk',
};

const ALL_KEYS = RISK_GROUPS.map(g => g.key);

export function normalizeDipperRiskGroups(input: Record<string, unknown> | null | undefined): DipperRiskGroups {
  const raw = input ?? {};

  function getKey(rk: string): string { return LEGACY_RISK_GROUP_KEY_TO_V4[rk] || rk; }
  function getBool(rk: string): boolean {
    const k = getKey(rk);
    const v = raw[k] ?? raw[rk];
    return typeof v === 'boolean' ? v : true;
  }

  const result: DipperRiskGroups = {
    top_caps: getBool('top_caps'),
    large_caps: getBool('large_caps'),
    mid_caps: getBool('mid_caps'),
    high_risk: getBool('high_risk'),
    very_high_risk: getBool('very_high_risk'),
  };

  const hadLegacyKeys = Object.keys(raw).some(k => k in LEGACY_RISK_GROUP_KEY_TO_V4);
  const missingKeys = ALL_KEYS.filter(k => !(k in raw) && !Object.keys(raw).some(rk => LEGACY_RISK_GROUP_KEY_TO_V4[rk] === k));

  if (hadLegacyKeys) {
    console.log(`DIPPER_RISK_GROUPS_LEGACY_MIGRATED: src=legacy_risk_group_migration groups=${ALL_KEYS.map(k => `${k}=${result[k]}`).join(',')}`);
  }
  if (missingKeys.length > 0) {
    console.log(`DIPPER_RISK_GROUPS_BACKFILLED: missing=${missingKeys.join(',')} defaults=${missingKeys.map(k => `${k}=true`).join(',')}`);
  }

  return result;
}
