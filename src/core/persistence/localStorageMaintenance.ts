import type { BuySnapshot, Position } from '../types';
import { logger } from '../../utils/logger';

export type OpenPositionPersistenceRow = {
  trade_id: string;
  symbol: string;
  position_json: string;
  buy_snapshot_json: string | null;
  saved_at?: string;
};

export interface StorageSizeEntry {
  key: string;
  bytes: number;
  category: string;
}

export interface StorageSizeAudit {
  entries: StorageSizeEntry[];
  totalBytes: number;
}

export interface QuotaPruneResult {
  removedKeys: string[];
  trimmedKeys: string[];
  bytesBefore: number;
  bytesAfter: number;
  freedBytes: number;
}

export interface RuntimeStorageCleanupResult extends QuotaPruneResult {
  appStateEquityPointsTrimmed: number;
}

export const OPEN_POSITIONS_MAX_PAYLOAD_BYTES = 128 * 1024;
export const OPEN_POSITION_MAX_ROW_BYTES = 24 * 1024;

const CRYPTOBUD_PREFIX = 'cryptobud_v4';
const APP_STATE_KEY = 'cryptobud_v4:app_state_v1';
const SAVED_REPORTS_KEY = 'cryptobud_v4:saved_bot_reports';
const ML_RUNTIME_EVENTS_KEY = 'ml_runtime_events_v1';
const NON_CRITICAL_KEY_PATTERN = /log|audit|scanner|snapshot|report|runtime_diag|runtime_events|training|backtest/i;
const CRITICAL_STORAGE_KEY_PATTERN = /open_positions|closed_trades|settings|api|credential|reset_meta|renderer_boot_state|last_crash_reason|last_boot_id|performance_settings/i;

function hasLocalStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

export function approximateBytes(value: string | null | undefined): number {
  if (!value) return 0;
  try {
    return new TextEncoder().encode(value).length;
  } catch {
    return value.length * 2;
  }
}

function classifyStorageKey(key: string): string {
  if (key.includes('open_positions_primary')) return 'open_positions_primary';
  if (key.includes('open_positions_backup')) return 'open_positions_backup';
  if (key.includes('open_positions_critical')) return 'open_positions_critical';
  if (key.includes('closed_trades')) return 'journal_closed_trades';
  if (key.includes('saved_bot_reports') || key.includes('report')) return 'old_reports';
  if (key.includes('scanner')) return 'scanner_events';
  if (key.includes('log') || key.includes('audit')) return 'log_audit_buffers';
  if (key.includes('ml_') || key.includes('training')) return 'ml_training_data';
  if (key.includes('app_state')) return 'app_state';
  return 'other_cryptobud';
}

function shouldIncludeStorageKey(key: string): boolean {
  return key.startsWith(CRYPTOBUD_PREFIX) || key === ML_RUNTIME_EVENTS_KEY || key === 'ml_brain' || key.startsWith('ml_');
}

export function getCryptoBudStorageSizeAudit(): StorageSizeAudit {
  if (!hasLocalStorage()) return { entries: [], totalBytes: 0 };
  const entries: StorageSizeEntry[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !shouldIncludeStorageKey(key)) continue;
    const value = localStorage.getItem(key);
    entries.push({ key, bytes: approximateBytes(value), category: classifyStorageKey(key) });
  }
  entries.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));
  return {
    entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

export function formatPersistenceStorageSizeAudit(input: {
  reason: string;
  targetKey: string;
  payloadBytes: number;
  failedKey?: string | null;
  storageAudit?: StorageSizeAudit;
}): string {
  const audit = input.storageAudit ?? getCryptoBudStorageSizeAudit();
  const keySizes = audit.entries
    .map((entry) => `${entry.key}:${entry.bytes}:${entry.category}`)
    .join('|') || 'none';
  return `PERSISTENCE_STORAGE_SIZE_AUDIT: reason=${input.reason} targetKey=${input.targetKey} payloadSizeBytes=${input.payloadBytes} failedKey=${input.failedKey ?? 'none'} totalCryptoBudLocalStorageBytes=${audit.totalBytes} keyCount=${audit.entries.length} keySizes=${keySizes}`;
}

export function isQuotaExceededError(err: unknown): boolean {
  const name = String((err as { name?: unknown })?.name ?? '');
  const message = err instanceof Error ? err.message : String(err);
  return /quota|exceeded|storage/i.test(`${name} ${message}`);
}

function trimJsonArrayKey(key: string, maxEntries: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return 0;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length <= maxEntries) return 0;
  const next = parsed.slice(-maxEntries);
  localStorage.setItem(key, JSON.stringify(next));
  return parsed.length - next.length;
}

function trimAppStateEquityHistory(maxPoints: number): number {
  const raw = localStorage.getItem(APP_STATE_KEY);
  if (!raw) return 0;
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.equityHistory) || parsed.equityHistory.length <= maxPoints) return 0;
  const before = parsed.equityHistory.length;
  parsed.equityHistory = parsed.equityHistory.slice(-maxPoints);
  parsed.savedAt = new Date().toISOString();
  localStorage.setItem(APP_STATE_KEY, JSON.stringify(parsed));
  return before - parsed.equityHistory.length;
}

function isPrunableLargeKey(key: string): boolean {
  if (CRITICAL_STORAGE_KEY_PATTERN.test(key)) return false;
  return NON_CRITICAL_KEY_PATTERN.test(key);
}

export function pruneNonCriticalLocalStorageForQuota(reason: string): QuotaPruneResult {
  const before = getCryptoBudStorageSizeAudit();
  const removedKeys: string[] = [];
  const trimmedKeys: string[] = [];
  if (!hasLocalStorage()) {
    return { removedKeys, trimmedKeys, bytesBefore: 0, bytesAfter: 0, freedBytes: 0 };
  }

  try {
    const trimmedReports = trimJsonArrayKey(SAVED_REPORTS_KEY, 10);
    if (trimmedReports > 0) trimmedKeys.push(`${SAVED_REPORTS_KEY}:${trimmedReports}`);
  } catch {
    try {
      localStorage.removeItem(SAVED_REPORTS_KEY);
      removedKeys.push(SAVED_REPORTS_KEY);
    } catch {
      // best effort
    }
  }

  try {
    const trimmedEvents = trimJsonArrayKey(ML_RUNTIME_EVENTS_KEY, 100);
    if (trimmedEvents > 0) trimmedKeys.push(`${ML_RUNTIME_EVENTS_KEY}:${trimmedEvents}`);
  } catch {
    try {
      localStorage.removeItem(ML_RUNTIME_EVENTS_KEY);
      removedKeys.push(ML_RUNTIME_EVENTS_KEY);
    } catch {
      // best effort
    }
  }

  for (const entry of before.entries) {
    if (!isPrunableLargeKey(entry.key)) continue;
    if (removedKeys.includes(entry.key) || trimmedKeys.some((key) => key.startsWith(`${entry.key}:`))) continue;
    try {
      localStorage.removeItem(entry.key);
      removedKeys.push(entry.key);
    } catch {
      // best effort
    }
  }

  const after = getCryptoBudStorageSizeAudit();
  const result = {
    removedKeys,
    trimmedKeys,
    bytesBefore: before.totalBytes,
    bytesAfter: after.totalBytes,
    freedBytes: Math.max(0, before.totalBytes - after.totalBytes),
  };
  logger.warn(`PERSISTENCE_QUOTA_RECOVERY_AUDIT: reason=${reason} phase=prune_non_critical removedKeys=${removedKeys.join('|') || 'none'} trimmedKeys=${trimmedKeys.join('|') || 'none'} bytesBefore=${result.bytesBefore} bytesAfter=${result.bytesAfter} freedBytes=${result.freedBytes}`);
  return result;
}

export function runRuntimeStorageCleanup(now = Date.now()): RuntimeStorageCleanupResult {
  const before = getCryptoBudStorageSizeAudit();
  const removedKeys: string[] = [];
  const trimmedKeys: string[] = [];
  let appStateEquityPointsTrimmed = 0;

  if (hasLocalStorage()) {
    try {
      const trimmedReports = trimJsonArrayKey(SAVED_REPORTS_KEY, 25);
      if (trimmedReports > 0) trimmedKeys.push(`${SAVED_REPORTS_KEY}:${trimmedReports}`);
    } catch {
      // keep reports recoverable if parsing fails elsewhere
    }
    try {
      const trimmedEvents = trimJsonArrayKey(ML_RUNTIME_EVENTS_KEY, 250);
      if (trimmedEvents > 0) trimmedKeys.push(`${ML_RUNTIME_EVENTS_KEY}:${trimmedEvents}`);
    } catch {
      // best effort
    }
    try {
      appStateEquityPointsTrimmed = trimAppStateEquityHistory(1500);
      if (appStateEquityPointsTrimmed > 0) trimmedKeys.push(`${APP_STATE_KEY}:equityHistory:${appStateEquityPointsTrimmed}`);
    } catch {
      // best effort
    }

    for (const entry of before.entries) {
      const ageMarkedTemp = /temp|runtime_diag|probe/i.test(entry.key);
      if (!ageMarkedTemp || CRITICAL_STORAGE_KEY_PATTERN.test(entry.key)) continue;
      try {
        localStorage.removeItem(entry.key);
        removedKeys.push(entry.key);
      } catch {
        // best effort
      }
    }
  }

  const after = getCryptoBudStorageSizeAudit();
  return {
    removedKeys,
    trimmedKeys,
    appStateEquityPointsTrimmed,
    bytesBefore: before.totalBytes,
    bytesAfter: after.totalBytes,
    freedBytes: Math.max(0, before.totalBytes - after.totalBytes),
  };
}

function finiteNumberOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function objectValue(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' ? input as Record<string, unknown> : null;
}

function includesText(value: unknown, needle: string): boolean {
  return String(value ?? '').toLowerCase().includes(needle);
}

function isUnicornSnapshotLike(...values: unknown[]): boolean {
  return values.some((value) => includesText(value, 'unicorn'));
}

function minimalRiskParams(input: unknown, fallback: { tradeId: string; symbol: string }, positionRaw?: Record<string, unknown>, buySnapshotInput?: Record<string, unknown>): Record<string, unknown> | null {
  const raw = objectValue(input) ?? {};
  const buySnapshotRaw = buySnapshotInput ?? objectValue(positionRaw?.buySnapshot);
  const rawOwnership = objectValue(raw.tradingTargetOwnership);
  const isUnicornOwned = isUnicornSnapshotLike(
    raw.source,
    raw.strategySource,
    raw.ownerName,
    raw.candidateSource,
    rawOwnership?.strategySource,
    rawOwnership?.tp1Source,
    positionRaw?.source,
    positionRaw?.strategySource,
    positionRaw?.ownerName,
    positionRaw?.candidateSource,
    buySnapshotRaw?.source,
    buySnapshotRaw?.strategySource,
    buySnapshotRaw?.ownerName,
    buySnapshotRaw?.candidateSource,
  );
  const entryPrice = finiteNumberOrNull(raw.entryPrice) ?? finiteNumberOrNull(positionRaw?.avgEntryPrice) ?? finiteNumberOrNull(positionRaw?.entryPrice);
  const tp1Pct = finiteNumberOrNull(raw.tp1Pct) ?? finiteNumberOrNull(raw.tp1Percent) ?? finiteNumberOrNull(positionRaw?.tp1Percent);
  const tp2Pct = finiteNumberOrNull(raw.tp2Pct) ?? finiteNumberOrNull(raw.tp2Percent) ?? finiteNumberOrNull(positionRaw?.tp2Percent) ?? 0;
  const slPct = finiteNumberOrNull(raw.slPct) ?? finiteNumberOrNull(raw.stopLossPercent) ?? finiteNumberOrNull(positionRaw?.stopLossPercent);
  if (entryPrice == null || entryPrice <= 0 || tp1Pct == null || tp1Pct <= 0 || slPct == null || slPct <= 0) return null;

  const rawTp1Target = finiteNumberOrNull(raw.tp1TargetPrice);
  const tp1TargetPrice = rawTp1Target != null && rawTp1Target > entryPrice
    ? rawTp1Target
    : Number(entryPrice * (1 + (tp1Pct / 100)));
  const sourceTp1 = String(raw.tp1Source ?? raw.sourceTp1 ?? (isUnicornOwned ? 'Unicorn dynamic per coin' : 'AutoBots dynamic per coin'));
  const sourceTp2 = String(raw.tp2Source ?? raw.sourceTp2 ?? 'autobots_enforced_zero');
  const sourceSl = String(raw.slSource ?? raw.sourceSl ?? 'user');
  return {
    schemaVersion: String(raw.schemaVersion ?? 'cryptobud-v4-risk-snapshot-minimal-v1'),
    positionId: String(raw.positionId ?? fallback.tradeId),
    symbol: String(raw.symbol ?? fallback.symbol),
    entryPrice,
    tp1Pct,
    tp1TargetPrice,
    tp1Source: sourceTp1,
    sourceTp1,
    tp1Min: finiteNumberOrNull(raw.tp1Min) ?? (isUnicornOwned ? 5 : null),
    tp1Max: finiteNumberOrNull(raw.tp1Max) ?? (isUnicornOwned ? 10 : null),
    tp1Reason: String(raw.tp1Reason ?? 'restored_minimal_risk_snapshot'),
    tp2Pct,
    tp2Source: sourceTp2,
    sourceTp2,
    slPct,
    slSource: sourceSl,
    sourceSl,
    dynamicTrailingEnabled: raw.dynamicTrailingEnabled === true,
    trailStartPct: raw.trailStartPct ?? raw.trailStart ?? null,
    trailPullbackPct: finiteNumberOrNull(raw.trailPullbackPct) ?? finiteNumberOrNull(positionRaw?.trailFromPeakPercent) ?? 0,
    sourceTrailPullback: String(raw.sourceTrailPullback ?? 'user'),
    autoBotsOnAtEntry: raw.autoBotsOnAtEntry !== false,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };
}

function minimalSetupMetric(input: unknown): Record<string, unknown> | null {
  const raw = objectValue(input);
  if (!raw) return null;
  const key = String(raw.key ?? '');
  if (!key) return null;
  return {
    key,
    actualValue: raw.actualValue ?? null,
    requiredValue: raw.requiredValue ?? null,
    passed: raw.passed === true,
    usedByStrategy: raw.usedByStrategy === true,
    role: String(raw.role ?? 'unknown'),
    sourceLayer: String(raw.sourceLayer ?? 'unknown'),
  };
}

function minimalStrategyAuditSnapshot(input: unknown): Record<string, unknown> | null {
  const raw = objectValue(input);
  if (!raw) return null;
  const setupMetrics = Array.isArray(raw.setupMetrics)
    ? raw.setupMetrics.map(minimalSetupMetric).filter(Boolean).slice(0, 32)
    : [];
  return {
    finalEntryRule: String(raw.finalEntryRule ?? raw.entryReason ?? raw.setupResult ?? 'restored_entry'),
    entryReason: String(raw.entryReason ?? raw.finalEntryRule ?? raw.setupResult ?? 'restored_entry'),
    setupResult: String(raw.setupResult ?? raw.finalEntryRule ?? 'SETUP_RESTORED'),
    strategySelected: String(raw.strategySelected ?? raw.selectedStrategy ?? 'unknown'),
    selectedStrategy: String(raw.selectedStrategy ?? raw.strategySelected ?? 'unknown'),
    finalExecutable: raw.finalExecutable !== false,
    finalExecutableAtEntry: raw.finalExecutableAtEntry !== false,
    buyAllowed: raw.buyAllowed !== false,
    entryConfirmedAtEntry: raw.entryConfirmedAtEntry !== false,
    setupMissing: raw.setupMissing === true,
    setupPassed: raw.setupPassed !== false,
    marketRecommendedStrategy: raw.marketRecommendedStrategy ?? null,
    groupRecommendedStrategy: raw.groupRecommendedStrategy ?? null,
    finalExecutionStrategy: raw.finalExecutionStrategy ?? raw.strategySelected ?? raw.selectedStrategy ?? null,
    strategyAtEntry: raw.strategyAtEntry ?? raw.strategySelected ?? raw.selectedStrategy ?? null,
    strategyDecisionReason: raw.strategyDecisionReason ?? null,
    setupMetrics,
  };
}

function minimalEntryPlan(input: unknown): Record<string, unknown> | null {
  const raw = objectValue(input);
  if (!raw) return null;
  const side = String(raw.side ?? '').toUpperCase();
  const price = finiteNumberOrNull(raw.price);
  const quantity = finiteNumberOrNull(raw.quantity);
  if ((side !== 'BUY' && side !== 'SELL') || price == null || quantity == null) return null;
  return {
    side,
    price,
    quantity,
    reason: String(raw.reason ?? 'restored_entry_plan'),
  };
}

function minimalRuleDecisionTrace(input: unknown): Record<string, unknown> {
  const raw = objectValue(input) ?? {};
  const unifiedSignal = objectValue(raw.unifiedSignal);
  return {
    unifiedSignal: unifiedSignal ? {
      signal: unifiedSignal.signal ?? null,
      reasonCode: unifiedSignal.reasonCode ?? null,
      reason: unifiedSignal.reason ?? null,
      dipPercent: unifiedSignal.dipPercent ?? null,
      requiredDipPct: unifiedSignal.requiredDipPct ?? null,
      dipPassed: unifiedSignal.dipPassed ?? null,
      reboundPct: unifiedSignal.reboundPct ?? null,
      requiredReboundPct: unifiedSignal.requiredReboundPct ?? null,
      reboundPassed: unifiedSignal.reboundPassed ?? null,
      momentumConfirmed: unifiedSignal.momentumConfirmed ?? null,
      definition: objectValue(unifiedSignal.definition) ? {
        buyRule: (unifiedSignal.definition as Record<string, unknown>).buyRule ?? null,
      } : null,
    } : null,
    playbookResult: null,
    autobotsResult: null,
  };
}

function minimalTraderBrainDecision(input: unknown, fallback: { tradeId: string; symbol: string }, buySnapshotRaw?: Record<string, unknown>): Record<string, unknown> | null {
  const raw = objectValue(input);
  if (!raw) return null;
  return {
    symbol: String(raw.symbol ?? fallback.symbol),
    mode: raw.mode ?? buySnapshotRaw?.mode ?? 'AUTO',
    selectedStrategy: String(raw.selectedStrategy ?? buySnapshotRaw?.selectedStrategy ?? 'unknown'),
    selectedPlaybook: raw.selectedPlaybook ?? buySnapshotRaw?.selectedPlaybook ?? null,
    confidence: finiteNumberOrNull(raw.confidence) ?? finiteNumberOrNull(buySnapshotRaw?.confidence) ?? 0,
    status: raw.status ?? 'BUY',
    entryPlan: minimalEntryPlan(raw.entryPlan),
    exitPlan: raw.exitPlan ?? null,
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map(String).slice(0, 12) : [],
    blockReasons: Array.isArray(raw.blockReasons) ? raw.blockReasons.map(String).slice(0, 12) : [],
    warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).slice(0, 12) : [],
    requiredNextActions: Array.isArray(raw.requiredNextActions) ? raw.requiredNextActions.map(String).slice(0, 12) : [],
    ruleDecisionTrace: minimalRuleDecisionTrace(raw.ruleDecisionTrace),
    mlAdjustedConfidence: finiteNumberOrNull(raw.mlAdjustedConfidence),
    mlWarnings: Array.isArray(raw.mlWarnings) ? raw.mlWarnings.map(String).slice(0, 12) : [],
    scannerBrainSource: raw.scannerBrainSource ?? null,
  };
}

function minimalEntryConfigSnapshot(input: unknown, fallback: { tradeId: string; symbol: string }, positionRaw?: Record<string, unknown>, buySnapshotRaw?: Record<string, unknown>): Record<string, unknown> | null {
  const raw = objectValue(input) ?? {};
  const riskParams = minimalRiskParams(raw.riskParams, fallback, positionRaw, buySnapshotRaw);
  if (!riskParams) return null;
  const strategyAuditSnapshot = minimalStrategyAuditSnapshot(raw.strategyAuditSnapshot);
  const selectedStrategy = String(raw.selectedStrategy ?? strategyAuditSnapshot?.strategySelected ?? buySnapshotRaw?.selectedStrategy ?? 'unknown');
  return {
    schemaVersion: String(raw.schemaVersion ?? 'cryptobud-v4-scanner-auto-entry-config-minimal-v1'),
    symbol: String(raw.symbol ?? fallback.symbol),
    scanId: raw.scanId ?? null,
    sourceCandidateId: raw.sourceCandidateId ?? buySnapshotRaw?.candidateId ?? null,
    selectedStrategy,
    finalEntryRule: String(raw.finalEntryRule ?? strategyAuditSnapshot?.finalEntryRule ?? buySnapshotRaw?.selectedPlaybook ?? 'restored_entry'),
    setupResult: String(raw.setupResult ?? strategyAuditSnapshot?.setupResult ?? 'SETUP_RESTORED'),
    finalExecutable: raw.finalExecutable !== false,
    finalExecutableAtEntry: raw.finalExecutableAtEntry !== false,
    buyAllowed: raw.buyAllowed !== false,
    entryConfirmedAtEntry: raw.entryConfirmedAtEntry !== false,
    entryStatus: String(raw.entryStatus ?? 'BUY'),
    entryGateDecision: String(raw.entryGateDecision ?? 'ALLOW'),
    confidence: finiteNumberOrNull(raw.confidence) ?? finiteNumberOrNull(buySnapshotRaw?.confidence) ?? 0,
    executionPath: String(raw.executionPath ?? 'scanner_auto'),
    ownerType: String(raw.ownerType ?? buySnapshotRaw?.ownerType ?? 'scanner'),
    ownerName: String(raw.ownerName ?? buySnapshotRaw?.ownerName ?? 'AUTOBOTS'),
    source: String(raw.source ?? buySnapshotRaw?.source ?? 'AutoBots'),
    strategySource: String(raw.strategySource ?? buySnapshotRaw?.strategySource ?? 'autobots'),
    strategySourceDetail: raw.strategySourceDetail ?? null,
    strategyReason: raw.strategyReason ?? null,
    marketBestFit: raw.marketBestFit ?? null,
    groupRecommendedStrategy: raw.groupRecommendedStrategy ?? buySnapshotRaw?.groupRecommendedStrategy ?? null,
    finalExecutionStrategy: raw.finalExecutionStrategy ?? selectedStrategy,
    strategyAtEntry: raw.strategyAtEntry ?? selectedStrategy,
    strategyDecisionReason: raw.strategyDecisionReason ?? null,
    entryPrice: riskParams.entryPrice,
    quantity: finiteNumberOrNull(raw.quantity) ?? finiteNumberOrNull(positionRaw?.quantity) ?? 0,
    capitalAllocated: finiteNumberOrNull(raw.capitalAllocated) ?? ((finiteNumberOrNull(positionRaw?.quantity) ?? 0) * Number(riskParams.entryPrice)),
    tp1Pct: riskParams.tp1Pct,
    tp1Source: riskParams.tp1Source,
    tp2Pct: riskParams.tp2Pct,
    tp2Source: riskParams.tp2Source,
    slPct: riskParams.slPct,
    slSource: riskParams.slSource,
    dynamicTrailingEnabled: riskParams.dynamicTrailingEnabled,
    trailStart: raw.trailStart ?? riskParams.trailStartPct ?? 'TP1',
    trailPullbackPct: riskParams.trailPullbackPct,
    riskParams,
    strategyAuditSnapshot,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };
}

export function repairOpenPositionRiskSnapshot(position: Position, reason = 'unknown'): Position {
  const raw = position as Position & { entryConfigSnapshot?: Record<string, unknown> };
  const fallback = { tradeId: raw.tradeId ?? `${raw.coin}-${raw.openedAt ?? Date.now()}`, symbol: raw.coin };
  const buySnapshot = objectValue(raw.buySnapshot);
  const existingEntryConfig = objectValue(raw.entryConfigSnapshot)
    ?? objectValue((raw.buySnapshot as any)?.entryConfigSnapshot)
    ?? objectValue((raw.buySnapshot as any)?.settingsSnapshot?.entryConfigSnapshot);
  const existingRisk = objectValue(existingEntryConfig?.riskParams);
  if (existingRisk && finiteNumberOrNull(existingRisk.tp1Pct) != null && finiteNumberOrNull(existingRisk.tp1TargetPrice) != null) {
    if (raw.buySnapshot && !(raw.buySnapshot as any).entryConfigSnapshot) (raw.buySnapshot as any).entryConfigSnapshot = existingEntryConfig;
    if (!raw.entryConfigSnapshot && existingEntryConfig) raw.entryConfigSnapshot = existingEntryConfig;
    return raw;
  }
  const repairedEntryConfig = minimalEntryConfigSnapshot(existingEntryConfig, fallback, raw as unknown as Record<string, unknown>, buySnapshot ?? undefined);
  if (!repairedEntryConfig) return raw;
  if (!raw.buySnapshot) {
    raw.buySnapshot = minimalBuySnapshot({
      tradeId: fallback.tradeId,
      symbol: fallback.symbol,
      mode: raw.mode,
      adapter: raw.adapter,
      selectedStrategy: 'unknown',
      source: raw.ownerType ?? 'restored_position',
      ownerType: raw.ownerType ?? 'unknown',
      entryPrice: raw.avgEntryPrice,
      realMarketPriceAtBuy: raw.avgEntryPrice,
      entryConfigSnapshot: repairedEntryConfig,
    }, fallback, raw as unknown as Record<string, unknown>) as BuySnapshot;
  } else {
    (raw.buySnapshot as any).entryConfigSnapshot = repairedEntryConfig;
  }
  raw.entryConfigSnapshot = repairedEntryConfig;
  logger.warn(`POSITION_RISK_SNAPSHOT_REPAIRED_FROM_POSITION_FIELDS: symbol=${raw.coin} positionId=${fallback.tradeId} reason=${reason} tp1Pct=${(repairedEntryConfig.riskParams as any).tp1Pct} tp1TargetPrice=${(repairedEntryConfig.riskParams as any).tp1TargetPrice} tp1Source=${(repairedEntryConfig.riskParams as any).tp1Source} tp2Pct=${(repairedEntryConfig.riskParams as any).tp2Pct} slPct=${(repairedEntryConfig.riskParams as any).slPct} source=persistence_restore canonicalRepair=true`);
  return raw;
}

function minimalBuySnapshot(input: unknown, fallback: { tradeId: string; symbol: string }, positionRaw?: Record<string, unknown>): Partial<BuySnapshot> | null {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : null;
  if (!raw) return null;
  const get = (key: string) => raw[key];
  const rawSettings = objectValue(get('settingsSnapshot')) ?? {};
  const entryConfigSnapshot = minimalEntryConfigSnapshot(
    get('entryConfigSnapshot') ?? objectValue(rawSettings.entryConfigSnapshot),
    fallback,
    positionRaw,
    raw,
  );
  return {
    schemaVersion: String(get('schemaVersion') ?? 'cryptobud-v4-buy-snapshot-minimal-v1'),
    tradeId: String(get('tradeId') ?? fallback.tradeId),
    createdAt: String(get('createdAt') ?? new Date().toISOString()),
    symbol: String(get('symbol') ?? fallback.symbol),
    mode: (get('mode') as BuySnapshot['mode']) ?? 'AUTO',
    adapter: String(get('adapter') ?? 'paper'),
    riskGroup: (get('riskGroup') as string | null) ?? null,
    selectedStrategy: String(get('selectedStrategy') ?? 'unknown'),
    selectedPlaybook: (get('selectedPlaybook') as string | null) ?? null,
    marketRegime: (get('marketRegime') as string | null) ?? null,
    btcRegime: (get('btcRegime') as string | null) ?? null,
    groupRegime: (get('groupRegime') as string | null) ?? null,
    entryPrice: Number(get('entryPrice') ?? 0),
    realMarketPriceAtBuy: Number(get('realMarketPriceAtBuy') ?? get('entryPrice') ?? 0),
    entryPriceSource: String(get('entryPriceSource') ?? 'unknown'),
    entryPriceAgeMs: Number(get('entryPriceAgeMs') ?? 0),
    isRealMarketPriceAtBuy: get('isRealMarketPriceAtBuy') !== false,
    spreadPct: Number(get('spreadPct') ?? 0),
    volumeRel: Number(get('volumeRel') ?? 0),
    confidence: Number(get('confidence') ?? 0),
    candidateRank: typeof get('candidateRank') === 'number' ? get('candidateRank') as number : null,
    traderBrainDecision: minimalTraderBrainDecision(get('traderBrainDecision'), fallback, raw),
    ruleDecisionTrace: minimalRuleDecisionTrace(get('ruleDecisionTrace') ?? objectValue(get('traderBrainDecision'))?.ruleDecisionTrace),
    mlPredictionAtEntry: get('mlPredictionAtEntry') ?? null,
    entryGateDecision: get('entryGateDecision') ?? null,
    riskDecision: get('riskDecision') ?? null,
    scannerSnapshotId: get('scannerSnapshotId') as string | undefined,
    candidateId: get('candidateId') as string | undefined,
    candidatePoolSize: typeof get('candidatePoolSize') === 'number' ? get('candidatePoolSize') as number : null,
    groupTrend: (get('groupTrend') as string | null) ?? null,
    groupRecommendedStrategy: (get('groupRecommendedStrategy') as string | null) ?? null,
    referencePeriod: get('referencePeriod') as string | undefined,
    universeMode: get('universeMode') as BuySnapshot['universeMode'],
    source: get('source') as string | undefined,
    ownerType: get('ownerType') as string | undefined,
    ownerName: get('ownerName') as string | undefined,
    strategySource: get('strategySource') as BuySnapshot['strategySource'],
    candidateSource: get('candidateSource') as string | undefined,
    executionSource: get('executionSource') as string | undefined,
    settingsSnapshot: {
      strategySource: rawSettings.strategySource ?? get('strategySource') ?? null,
      entryRule: rawSettings.entryRule ?? entryConfigSnapshot?.finalEntryRule ?? null,
    },
    entryConfigSnapshot: entryConfigSnapshot ?? undefined,
  } as Partial<BuySnapshot> & { entryConfigSnapshot?: Record<string, unknown> };
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function createMinimalPositionSnapshot(positionLike: unknown, fallback: { tradeId: string; symbol: string }): Position {
  const raw = positionLike && typeof positionLike === 'object' ? positionLike as Record<string, unknown> : {};
  const buySnapshot = minimalBuySnapshot(raw.buySnapshot, fallback, raw);
  const entryPrice = finiteNumber(raw.avgEntryPrice, finiteNumber(raw.entryPrice, 0));
  const currentPrice = finiteNumber(raw.currentPrice, finiteNumber(raw.lastPrice, entryPrice));
  const openedAt = finiteNumber(raw.openedAt, Date.now());
  const position = {
    coin: String(raw.coin ?? fallback.symbol),
    quantity: finiteNumber(raw.quantity, 0),
    avgEntryPrice: entryPrice,
    currentPrice,
    pnl: finiteNumber(raw.pnl, 0),
    pnlPercent: finiteNumber(raw.pnlPercent, 0),
    mode: (raw.mode as Position['mode']) ?? 'AUTO',
    openedAt,
    tradeId: String(raw.tradeId ?? fallback.tradeId),
    buySnapshot: buySnapshot as BuySnapshot | undefined,
    highestPrice: finiteNumber(raw.highestPrice, Math.max(entryPrice, currentPrice)),
    highestPriceSinceTp: finiteNumber(raw.highestPriceSinceTp, Math.max(entryPrice, currentPrice)),
    tpArmed: raw.tpArmed === true,
    tpArmedAt: finiteNumber(raw.tpArmedAt, 0),
    tp1Hit: raw.tp1Hit === true,
    tp2Hit: raw.tp2Hit === true,
    stopLossPercent: finiteNumber(raw.stopLossPercent, 2),
    tp1Percent: finiteNumber(raw.tp1Percent, 0),
    tp2Percent: finiteNumber(raw.tp2Percent, 0),
    tpMode: String(raw.tpMode ?? 'dynamic'),
    tpTriggerType: String(raw.tpTriggerType ?? 'mark_price'),
    trailFromPeakPercent: finiteNumber(raw.trailFromPeakPercent, 0),
    maxHoldSec: finiteNumber(raw.maxHoldSec, 0),
    lastPrice: finiteNumber(raw.lastPrice, currentPrice),
    priceTimestamp: finiteNumber(raw.priceTimestamp, Date.now()),
    exitPriceUnavailable: raw.exitPriceUnavailable === true,
    exitPriceUnavailableAt: finiteNumber(raw.exitPriceUnavailableAt, 0),
    exitPriceUnavailableReason: String(raw.exitPriceUnavailableReason ?? 'none'),
    unrealizedPnlPercent: finiteNumber(raw.unrealizedPnlPercent, 0),
    ownerType: String(raw.ownerType ?? buySnapshot?.ownerType ?? 'unknown'),
    ownerName: String(raw.ownerName ?? buySnapshot?.ownerName ?? ''),
    source: String(raw.source ?? buySnapshot?.source ?? ''),
    strategySource: String(raw.strategySource ?? buySnapshot?.strategySource ?? ''),
    candidateSource: String(raw.candidateSource ?? buySnapshot?.candidateSource ?? ''),
    executionSource: String(raw.executionSource ?? buySnapshot?.executionSource ?? ''),
    adapter: String(raw.adapter ?? buySnapshot?.adapter ?? 'paper'),
  } as Position;
  const repaired = repairOpenPositionRiskSnapshot(position, 'create_minimal_position_snapshot');
  delete (repaired as Position & { entryConfigSnapshot?: Record<string, unknown> }).entryConfigSnapshot;
  return repaired;
}

export function sanitizeOpenPositionRow(row: OpenPositionPersistenceRow, savedAt = new Date().toISOString()): OpenPositionPersistenceRow {
  const parsedPosition = parseJsonObject(row.position_json);
  const parsedSnapshot = parseJsonObject(row.buy_snapshot_json);
  if (!parsedPosition.buySnapshot && Object.keys(parsedSnapshot).length > 0) {
    parsedPosition.buySnapshot = parsedSnapshot;
  }
  const fallback = { tradeId: row.trade_id, symbol: row.symbol };
  const minimalPosition = createMinimalPositionSnapshot(parsedPosition, fallback);
  const snapshot = minimalBuySnapshot(minimalPosition.buySnapshot, fallback, minimalPosition as unknown as Record<string, unknown>);
  const positionForJson = { ...minimalPosition } as Partial<Position>;
  delete positionForJson.buySnapshot;
  return {
    trade_id: String(row.trade_id),
    symbol: String(row.symbol),
    position_json: JSON.stringify(positionForJson),
    buy_snapshot_json: snapshot ? JSON.stringify(snapshot) : null,
    saved_at: row.saved_at ?? savedAt,
  };
}

export function buildOpenPositionPersistenceRows(positions: Position[], savedAt = new Date().toISOString()): OpenPositionPersistenceRow[] {
  return positions.map((position) => {
    const tradeId = position.tradeId ?? position.buySnapshot?.tradeId ?? `${position.coin}-${position.openedAt}`;
    return sanitizeOpenPositionRow({
      trade_id: tradeId,
      symbol: position.coin,
      position_json: JSON.stringify(position),
      buy_snapshot_json: position.buySnapshot ? JSON.stringify(position.buySnapshot) : null,
      saved_at: savedAt,
    }, savedAt);
  });
}

export function emergencyOpenPositionRows(rows: OpenPositionPersistenceRow[], savedAt = new Date().toISOString()): OpenPositionPersistenceRow[] {
  return rows.map((row) => {
    const sanitized = sanitizeOpenPositionRow(row, savedAt);
    const position = createMinimalPositionSnapshot(parseJsonObject(sanitized.position_json), {
      tradeId: sanitized.trade_id,
      symbol: sanitized.symbol,
    });
    delete (position as Partial<Position>).buySnapshot;
    return {
      trade_id: sanitized.trade_id,
      symbol: sanitized.symbol,
      position_json: JSON.stringify(position),
      buy_snapshot_json: null,
      saved_at: savedAt,
    };
  });
}
