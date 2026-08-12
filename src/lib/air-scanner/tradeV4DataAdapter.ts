import type { CloseSnapshot, Position, ScannerCandidate, ScannerSnapshot, TradeRecord } from "../../core/types";
import type { TradeV4CandidateView, TradeV4ClosedPositionView, TradeV4OpenPositionView, TradeV4PageModel } from "../../components/trade-v4/types";
import { logger } from "../../utils/logger";
import { getTradeSourcePresentation, resolveTradeSourceLabel } from "../../core/notifications/trade-source";
import { computeAutoTp } from "../../core/scanner/AutoTpCalculator";
import { normalizeCandidateDisplayStatus } from "../../core/scanner/CandidateLifecycle";
import { buildStrategyAuditSnapshotFromCandidate } from "../../core/strategy-audit/strategy-audit-builder";
import { logStrategyAudit } from "../../core/strategy-audit/strategy-audit-logger";
import { getExecutionAdapterDisplay, getExecutionModeDisplay } from "../execution/executionDisplay";
import { getStalePriceAgeMs } from "../../core/market-data/market-data-quality";
import { buildClosedFeeAccounting, buildOpenFeeEstimate } from "../../core/accounting/feeAccounting";
import { MarketDataFeed } from "../../utils/MarketDataFeed";
import { isMarketFreshnessBlocker, rehydrateCandidateMarketFreshness } from "../../core/market-data/canonical-market-freshness";

function toDataQuality(v?: string): "GOOD" | "MEDIUM" | "BAD" | "UNKNOWN" {
  if (v === "GOOD" || v === "MEDIUM" || v === "BAD") return v;
  return "UNKNOWN";
}

function isUnicornCandidateMeta(candidate: ScannerCandidate): boolean {
  const c = candidate as any;
  return [
    c.source,
    c.sourceOwner,
    c.sourceLabel,
    c.ownerName,
    c.ownerType,
    c.candidateSource,
    c.executionSource,
    c.executionOwner,
    c.positionOwner,
    candidate.strategySource,
    candidate.runtimeSnapshot?.sourceOwner,
    c.scannerAutoEntryConfigSnapshot?.source,
    c.scannerAutoEntryConfigSnapshot?.ownerName,
    c.scannerAutoEntryConfigSnapshot?.strategySource,
  ].some((value) => String(value ?? '').toLowerCase().includes('unicorn'));
}

function includesSourceToken(values: unknown[], token: string): boolean {
  const expected = token.toLowerCase();
  return values.some((value) => String(value ?? '').toLowerCase().includes(expected));
}

function buildCandidateSourceMeta(candidate: ScannerCandidate): Record<string, unknown> {
  const c = candidate as any;
  const runtimeSourceOwner = candidate.runtimeSnapshot?.sourceOwner ?? c.sourceOwner;
  const strategySource = candidate.strategySource
    ?? c.autoStrategyDecision?.strategySource
    ?? candidate.runtimeSnapshot?.strategySourceResolved
    ?? c.scannerAutoEntryConfigSnapshot?.strategySource;
  const sourceHints = [
    c.source,
    c.candidateSource,
    c.executionSource,
    c.executionOwner,
    c.positionOwner,
    c.ownerName,
    c.ownerType,
    c.sourceOwner,
    runtimeSourceOwner,
    strategySource,
    candidate.strategySource,
    c.strategySourceDetail,
    c.autoStrategyDecision?.strategySource,
    c.scannerAutoEntryConfigSnapshot?.source,
    c.scannerAutoEntryConfigSnapshot?.ownerName,
    c.scannerAutoEntryConfigSnapshot?.strategySource,
  ];
  const isUnicorn = isUnicornCandidateMeta(candidate);
  const isMl = includesSourceToken(sourceHints, 'ml_predict') || includesSourceToken(sourceHints, 'ml predict');
  const isMicro = includesSourceToken(sourceHints, 'micro') || includesSourceToken(sourceHints, 'scalp');
  const isManual = includesSourceToken(sourceHints, 'manual');
  const isScannerAuto = !isUnicorn
    && !isMl
    && !isMicro
    && !isManual
    && (
      includesSourceToken(sourceHints, 'autobots')
      || includesSourceToken(sourceHints, 'scanner')
      || includesSourceToken(sourceHints, 'dipper')
      || String(runtimeSourceOwner ?? '').toLowerCase() === 'autobots'
      || String(c.candidateBirthSource ?? '').toLowerCase().includes('scanner')
    );
  const canonicalSource = isUnicorn
    ? 'unicorn_hunter'
    : isMl
      ? 'ML_PREDICT_BUY'
      : isMicro
        ? 'micro_scalper'
        : isManual
          ? 'manual'
          : isScannerAuto
            ? 'autobots'
            : c.source ?? c.candidateSource ?? strategySource;
  const canonicalOwnerName = isUnicorn
    ? 'UNICORN_HUNTER'
    : isMl
      ? 'ML Predict Buy'
      : isMicro
        ? 'Micro Scalping'
        : isManual
          ? 'Manual'
          : isScannerAuto
            ? 'AutoBots'
            : c.ownerName;
  const canonicalOwnerType = isUnicorn
    ? 'unicorn'
    : isManual
      ? 'manual'
      : isMicro
        ? 'micro_scalper'
        : 'scanner';
  const canonicalCandidateSource = isUnicorn
    ? 'unicorn_hunter'
    : isMl
      ? 'ML_PREDICT_BUY'
      : isMicro
        ? 'micro_scalper'
        : isScannerAuto
          ? 'scanner'
          : c.candidateSource;
  const canonicalStrategySource = isUnicorn ? 'unicorn_hunter' : canonicalSource ?? strategySource;
  return {
    source: canonicalSource,
    sourceOwner: runtimeSourceOwner,
    runtimeSnapshot: candidate.runtimeSnapshot,
    autoStrategyDecision: c.autoStrategyDecision,
    candidateSource: canonicalCandidateSource,
    ownerName: canonicalOwnerName,
    ownerType: canonicalOwnerType,
    strategySource: canonicalStrategySource,
    executionSource: c.executionSource ?? canonicalSource,
    scannerAutoEntryConfigSnapshot: c.scannerAutoEntryConfigSnapshot,
    buySnapshot: {
      source: canonicalSource,
      sourceOwner: runtimeSourceOwner,
      ownerName: canonicalOwnerName,
      ownerType: canonicalOwnerType,
      candidateSource: canonicalCandidateSource,
      strategySource: canonicalStrategySource,
      executionSource: c.executionSource ?? canonicalSource,
      entryConfigSnapshot: {
        source: c.scannerAutoEntryConfigSnapshot?.source ?? canonicalSource,
        strategySource: c.scannerAutoEntryConfigSnapshot?.strategySource ?? canonicalStrategySource,
      },
      settingsSnapshot: {
        strategySource: canonicalStrategySource,
      },
    },
  };
}

let _lastLoggedScanId: string | undefined;
let _lastOpenUiAuditSig = '';
let _lastOpenUiAuditAt = 0;
let _lastOpenDisplayAuditSig = '';
let _lastOpenDisplayAuditAt = 0;
let _lastOpenFieldFallbackSig = '';
let _lastOpenFieldFallbackAt = 0;
let _lastTopCandidatesAuditSig = '';
let _lastTopCandidatesAuditAt = 0;
let _lastTrendBySymbol = new Map<string, string>();
let _lastDipperCardAuditSig = '';
let _lastDipperCardAuditAt = 0;
const _legacyClosedSnapshotClassified = new Set<string>();
const SNAPSHOT_SCHEMA_CUTOFF_MS = Date.parse('2026-06-01T00:00:00.000Z');
type MetricRole = 'required' | 'optional' | 'advisory' | 'blocker' | 'unused';
type SetupMetricView = {
  actualValue: string | number | boolean | null;
  requiredValue: string | number | boolean | null;
  passed: boolean;
  usedByStrategy: boolean;
  role: MetricRole;
  sourceLayer: 'buy-rule-matrix' | 'autobots-selector' | 'auto-strategy-router' | 'trader-brain' | 'entry-gate' | 'legacy';
};
function toMetricPrimitive(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

function toPctLabel(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : 'N/A';
}
function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}
function passIcon(passed: boolean | undefined): string {
  return passed ? '✅' : '❌';
}
function setupReqLabel(actual: unknown, required: unknown, passed: boolean | undefined, role: MetricRole): string {
  if (role === 'advisory' || role === 'unused') {
    return `${toPctLabel(actual)} / ${toPctLabel(required)} entry snapshot`;
  }
  return `${toPctLabel(actual)} / ${toPctLabel(required)} ${passIcon(passed)} ${role}`;
}

function strategySetupFromPosition(position: Position, bs: any): {
  sourceUsed: string;
  setupSummary: string;
  dipReqLabel: string;
  reboundReqLabel: string;
  momentumLabel: string;
  setupResult: string;
  why: string;
  metrics: Record<string, SetupMetricView>;
  missingFields: string[];
  rawSnapshot: Record<string, unknown> | null;
} {
  const entryConfig = (position as any)?.entryConfigSnapshot ?? (bs?.entryConfigSnapshot as any) ?? null;
  const riskParams = entryConfig?.riskParams ?? null;
  const directAudit = entryConfig?.strategyAuditSnapshot ?? (bs as any)?.strategyAuditSnapshot ?? null;
  const manualSetupSnap = entryConfig?.manualDipperSetupSnapshot ?? null;
  const directMetrics = directAudit?.setupMetrics;
  const requiredItems = Array.isArray(directAudit?.setupRequired) ? directAudit.setupRequired : [];
  const fallbackSignal = ((bs?.traderBrainDecision as any)?.ruleDecisionTrace?.unifiedSignal ?? {}) as Record<string, unknown>;
  const metrics: Record<string, SetupMetricView> = {};
  let sourceUsed = 'legacyDisplaySnapshot';
  const setMetric = (key: string, metric: SetupMetricView): void => {
    if (!metrics[key]) metrics[key] = metric;
  };
  if (Array.isArray(directMetrics) && directMetrics.length > 0) {
    sourceUsed = 'entryConfigSnapshot.strategyAuditSnapshot.setupMetrics';
    for (const m of directMetrics as any[]) {
      if (!m?.key) continue;
      setMetric(String(m.key), {
        actualValue: toMetricPrimitive(m.actualValue),
        requiredValue: toMetricPrimitive(m.requiredValue),
        passed: !!m.passed,
        usedByStrategy: !!m.usedByStrategy,
        role: (m.role ?? 'unused') as MetricRole,
        sourceLayer: (m.sourceLayer ?? 'legacy') as SetupMetricView['sourceLayer'],
      });
    }
  }
  if (requiredItems.length > 0) {
    sourceUsed = sourceUsed === 'legacyDisplaySnapshot' ? 'entryConfigSnapshot.strategyAuditSnapshot.setupRequired' : sourceUsed;
    for (const it of requiredItems as any[]) {
      const key = String(it?.key ?? '');
      if (!key) continue;
      if (key === 'dipConfirmed') {
        setMetric('actualDipPct', { actualValue: toMetricPrimitive(it.actualValue), requiredValue: toMetricPrimitive(it.requiredValue), passed: !!it.passed, usedByStrategy: !!it.required, role: it.required ? 'required' : 'advisory', sourceLayer: (it.sourceLayer ?? 'legacy') as SetupMetricView['sourceLayer'] });
      }
      if (key === 'reboundConfirmed') {
        setMetric('actualReboundPct', { actualValue: toMetricPrimitive(it.actualValue), requiredValue: toMetricPrimitive(it.requiredValue), passed: !!it.passed, usedByStrategy: !!it.required, role: it.required ? 'required' : 'advisory', sourceLayer: (it.sourceLayer ?? 'legacy') as SetupMetricView['sourceLayer'] });
      }
      if (key === 'momentumConfirmed') {
        setMetric('momentumConfirmed', { actualValue: true, requiredValue: true, passed: !!it.passed, usedByStrategy: !!it.required, role: it.required ? 'required' : 'optional', sourceLayer: (it.sourceLayer ?? 'legacy') as SetupMetricView['sourceLayer'] });
      }
      setMetric(key, {
        actualValue: toMetricPrimitive(it.actualValue),
        requiredValue: toMetricPrimitive(it.requiredValue),
        passed: !!it.passed,
        usedByStrategy: !!it.required,
        role: it.required ? 'required' : 'optional',
        sourceLayer: (it.sourceLayer ?? 'legacy') as SetupMetricView['sourceLayer'],
      });
    }
  }
  if (Object.keys(metrics).length === 0 && Object.keys(fallbackSignal).length > 0) {
    sourceUsed = entryConfig ? 'entryConfigSnapshot_unifiedSignal' : 'buySnapshot.traderBrainDecision.unifiedSignal';
    setMetric('actualDipPct', { actualValue: toMetricPrimitive(fallbackSignal.dipPercent), requiredValue: toMetricPrimitive(fallbackSignal.requiredDipPct), passed: !!fallbackSignal.dipPassed, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' });
    setMetric('actualReboundPct', { actualValue: toMetricPrimitive(fallbackSignal.reboundPct), requiredValue: toMetricPrimitive(fallbackSignal.requiredReboundPct), passed: !!fallbackSignal.reboundPassed, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' });
    setMetric('momentumConfirmed', { actualValue: toMetricPrimitive(fallbackSignal.momentumConfirmed), requiredValue: true, passed: !!fallbackSignal.momentumConfirmed, usedByStrategy: true, role: 'required', sourceLayer: 'trader-brain' });
  }
  if (Object.keys(metrics).length === 0 && entryConfig) {
    const setupSource = (entryConfig.unicornMetrics ?? entryConfig.setupMetrics ?? entryConfig) as Record<string, unknown>;
    const dipActual = firstFiniteNumber(setupSource.pullbackPct, setupSource.actualDipPct, setupSource.dipDepthPct, setupSource.dipPercent, (bs as any)?.unicornMetrics?.pullbackPct);
    const reboundActual = firstFiniteNumber(setupSource.reboundPct, setupSource.actualReboundPct, setupSource.reboundPercent, (bs as any)?.unicornMetrics?.reboundPct);
    const requiredDip = firstFiniteNumber(setupSource.requiredDipPct, setupSource.minPullbackPct, (bs as any)?.settingsSnapshot?.requiredDipPctAtEntry);
    const requiredRebound = firstFiniteNumber(setupSource.requiredReboundPct, setupSource.minReboundPct, (bs as any)?.settingsSnapshot?.requiredReboundPctAtEntry);
    const entryConfirmed = entryConfig.entryConfirmedAtEntry === true || entryConfig.buyAllowed === true || entryConfig.finalExecutable === true || directAudit?.finalExecutable === true || directAudit?.buyAllowed === true;
    sourceUsed = 'entryConfigSnapshot.canonicalSetup';
    if (dipActual != null || requiredDip != null) {
      setMetric('actualDipPct', { actualValue: dipActual, requiredValue: requiredDip, passed: dipActual != null && requiredDip != null ? dipActual >= requiredDip : entryConfirmed, usedByStrategy: true, role: 'advisory', sourceLayer: 'entry-gate' });
      if (requiredDip != null) setMetric('requiredDipPct', { actualValue: requiredDip, requiredValue: requiredDip, passed: true, usedByStrategy: true, role: 'advisory', sourceLayer: 'entry-gate' });
    }
    if (reboundActual != null || requiredRebound != null) {
      setMetric('actualReboundPct', { actualValue: reboundActual, requiredValue: requiredRebound, passed: reboundActual != null && requiredRebound != null ? reboundActual >= requiredRebound : entryConfirmed, usedByStrategy: true, role: 'advisory', sourceLayer: 'entry-gate' });
      if (requiredRebound != null) setMetric('requiredReboundPct', { actualValue: requiredRebound, requiredValue: requiredRebound, passed: true, usedByStrategy: true, role: 'advisory', sourceLayer: 'entry-gate' });
    }
    if (entryConfirmed || entryConfig.selectedStrategy || entryConfig.finalExecutionStrategy || entryConfig.finalEntryRule || directAudit?.finalEntryRule) {
      setMetric('momentumConfirmed', { actualValue: entryConfirmed, requiredValue: true, passed: entryConfirmed, usedByStrategy: true, role: 'advisory', sourceLayer: 'entry-gate' });
    }
    if (riskParams && Object.keys(metrics).length === 0) {
      setMetric('riskSnapshotBound', { actualValue: true, requiredValue: true, passed: true, usedByStrategy: false, role: 'advisory', sourceLayer: 'entry-gate' });
    }
  }
  const dipRaw = metrics.actualDipPct?.actualValue ?? metrics.dipDepthPct?.actualValue ?? metrics.dipPercent?.actualValue ?? null;
  const dip = typeof dipRaw === 'number' && Number.isFinite(dipRaw) ? Math.abs(dipRaw) : dipRaw;
  const dipReq = metrics.requiredDipPct?.requiredValue ?? metrics.requiredDipPct?.actualValue ?? null;
  const rebound = metrics.actualReboundPct?.actualValue ?? metrics.reboundPct?.actualValue ?? null;
  const reboundReq = metrics.requiredReboundPct?.requiredValue ?? metrics.requiredReboundPct?.actualValue ?? null;
  const momRaw = metrics.momentumConfirmed?.actualValue;
  const momentumLabel = momRaw === true ? 'OK' : momRaw === false ? 'MISS' : 'N/A';
  const dipRole = metrics.actualDipPct?.role ?? metrics.dipPercent?.role ?? 'advisory';
  const reboundRole = metrics.actualReboundPct?.role ?? metrics.reboundPct?.role ?? 'advisory';
  const setupSummary = `Dip ${toPctLabel(dip)} | Rebound ${toPctLabel(rebound)} | mom ${momentumLabel}`;
  const dipPassed = metrics.actualDipPct?.passed ?? metrics.dipPercent?.passed;
  const reboundPassed = metrics.actualReboundPct?.passed ?? metrics.reboundPct?.passed;
  const canonicalSetupPresent = !!entryConfig && !!riskParams && !!(entryConfig.selectedStrategy ?? entryConfig.finalExecutionStrategy ?? entryConfig.finalEntryRule ?? directAudit?.finalEntryRule ?? directAudit?.setupResult);
  const missingFields = Object.keys(metrics).length === 0 && !canonicalSetupPresent ? ['setupMetrics'] : [];
  if (Object.keys(metrics).length === 0 && manualSetupSnap) {
    const md = manualSetupSnap as any;
    const dipReq = typeof md?.dipRequired === 'number' ? md.dipRequired : null;
    const reboundReq = typeof md?.reboundRequired === 'number' ? md.reboundRequired : null;
    const dipActual = typeof md?.actualDip === 'number' ? md.actualDip : null;
    const reboundActual = typeof md?.actualRebound === 'number' ? md.actualRebound : null;
    return {
      sourceUsed: 'entryConfigSnapshot.manualDipperSetupSnapshot',
      setupSummary: `Manual setup | Dip ${toPctLabel(dipActual)} | Rebound ${toPctLabel(reboundActual)}`,
      dipReqLabel: `${toPctLabel(dipActual)} / ${toPctLabel(dipReq)} ${passIcon(undefined)} required`,
      reboundReqLabel: `${toPctLabel(reboundActual)} / ${toPctLabel(reboundReq)} ${passIcon(undefined)} required`,
      momentumLabel: 'N/A',
      setupResult: 'MANUAL_SETUP_SNAPSHOT',
      why: String(entryConfig?.entryReason ?? 'Manual The Dipper setup snapshot'),
      metrics: {},
      missingFields: ['setupMetrics_not_wired_to_final_gate_yet'],
      rawSnapshot: manualSetupSnap as Record<string, unknown>,
    };
  }
  return {
    sourceUsed,
    setupSummary,
    dipReqLabel: setupReqLabel(dip, dipReq, dipPassed, dipRole),
    reboundReqLabel: setupReqLabel(rebound, reboundReq, reboundPassed, reboundRole),
    momentumLabel,
    setupResult: String(directAudit?.setupResult ?? directAudit?.finalEntryRule ?? '').trim()
      || (String(directAudit?.finalExecutableAtEntry ?? directAudit?.finalExecutable ?? false).toLowerCase() === 'true'
        ? 'CONFIRMED'
        : ((directAudit?.blockReasons?.length ?? 0) > 0 ? 'BLOCKED' : 'WAITING')),
    why: String(directAudit?.entryReason ?? bs?.whySelectedOverOthers ?? 'n/a'),
    metrics,
    missingFields,
    rawSnapshot: (directAudit as Record<string, unknown>) ?? null,
  };
}

export type PriceFreshnessStatus =
  | "LIVE PRICE FRESH"
  | "LIVE PRICE STALE"
  | "CACHE PRICE STALE"
  | "SNAPSHOT FALLBACK"
  | "PRICE UNAVAILABLE";

export interface ResolvedLivePriceState {
  livePrice: number;
  priceQuality: TradeV4OpenPositionView["priceQuality"];
  livePriceSource: PriceFreshnessStatus;
  priceTimestamp: number | null;
  nowTimestamp: number;
  priceAgeMs: number;
  staleThresholdMs: number;
  isFresh: boolean;
  cacheSource: string;
  fallbackUsed: boolean;
  reason: string;
}

export function resolveLivePriceState(position: Position, nowTimestamp = Date.now(), staleThresholdMs = getStalePriceAgeMs()): ResolvedLivePriceState {
  const hasCurrent = Number.isFinite(position.currentPrice) && position.currentPrice > 0;
  const hasLast = Number.isFinite(position.lastPrice) && position.lastPrice > 0;
  const priceTimestamp = typeof position.priceTimestamp === 'number' && Number.isFinite(position.priceTimestamp)
    ? position.priceTimestamp
    : null;
  const priceAgeMs = priceTimestamp == null ? Number.POSITIVE_INFINITY : Math.max(0, nowTimestamp - priceTimestamp);
  const isFresh = hasCurrent && priceTimestamp != null && priceAgeMs <= staleThresholdMs;

  if (isFresh) {
    return {
      livePrice: position.currentPrice,
      priceQuality: "fresh",
      livePriceSource: "LIVE PRICE FRESH",
      priceTimestamp,
      nowTimestamp,
      priceAgeMs,
      staleThresholdMs,
      isFresh: true,
      cacheSource: "position.currentPrice",
      fallbackUsed: false,
      reason: "position_price_timestamp_within_threshold",
    };
  }

  if (hasCurrent && priceTimestamp != null) {
    return {
      livePrice: position.currentPrice,
      priceQuality: "stale",
      livePriceSource: "LIVE PRICE STALE",
      priceTimestamp,
      nowTimestamp,
      priceAgeMs,
      staleThresholdMs,
      isFresh: false,
      cacheSource: "position.currentPrice",
      fallbackUsed: false,
      reason: "position_price_timestamp_exceeds_threshold",
    };
  }

  if (hasCurrent) {
    return {
      livePrice: position.currentPrice,
      priceQuality: "stale",
      livePriceSource: "CACHE PRICE STALE",
      priceTimestamp,
      nowTimestamp,
      priceAgeMs,
      staleThresholdMs,
      isFresh: false,
      cacheSource: "position.currentPrice_legacy_no_timestamp",
      fallbackUsed: true,
      reason: "position_price_timestamp_missing",
    };
  }

  if (hasLast) {
    return {
      livePrice: position.lastPrice,
      priceQuality: "fallback",
      livePriceSource: "SNAPSHOT FALLBACK",
      priceTimestamp,
      nowTimestamp,
      priceAgeMs,
      staleThresholdMs,
      isFresh: false,
      cacheSource: "position.lastPrice",
      fallbackUsed: true,
      reason: "current_price_missing_using_last_snapshot_price",
    };
  }

  return {
    livePrice: 0,
    priceQuality: "unavailable",
    livePriceSource: "PRICE UNAVAILABLE",
    priceTimestamp,
    nowTimestamp,
    priceAgeMs,
    staleThresholdMs,
    isFresh: false,
    cacheSource: "none",
    fallbackUsed: true,
    reason: "no_current_or_snapshot_price_available",
  };
}

function splitSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
  const upper = (symbol || '').toUpperCase();
  if (upper.endsWith('USDT')) return { baseAsset: upper.slice(0, -4), quoteAsset: 'USDT' };
  return { baseAsset: upper, quoteAsset: 'N/A' };
}

type SnapshotStatus = "VALID_SNAPSHOT" | "LEGACY_MISSING_SNAPSHOT" | "BUG_MISSING_SNAPSHOT_NEW_POSITION" | "PARTIAL_SNAPSHOT";

function classifySnapshotStatus(position: Position): {
  snapshotStatus: SnapshotStatus;
  missingFields: string[];
  availableFields: string[];
} {
  const bs = position.buySnapshot as Record<string, unknown> | undefined;
  const isLegacy = (position.openedAt ?? 0) < SNAPSHOT_SCHEMA_CUTOFF_MS;
  if (!bs) {
    return {
      snapshotStatus: isLegacy ? "LEGACY_MISSING_SNAPSHOT" : "BUG_MISSING_SNAPSHOT_NEW_POSITION",
      missingFields: ['buySnapshot'],
      availableFields: [],
    };
  }
  const entryConfig = (position as any)?.entryConfigSnapshot ?? (bs as any)?.entryConfigSnapshot ?? null;
  const riskParams = entryConfig?.riskParams ?? null;
  const required = ['selectedStrategy', 'entryPriceSource', 'traderBrainDecision', 'settingsSnapshot', 'createdAt'];
  const availableFields = Object.keys(bs);
  const missingFields = [
    ...required.filter((k) => !(k in bs)),
    !entryConfig ? 'entryConfigSnapshot' : null,
    !riskParams ? 'entryConfigSnapshot.riskParams' : null,
  ].filter(Boolean) as string[];
  if (!entryConfig || !riskParams) {
    return {
      snapshotStatus: isLegacy ? "LEGACY_MISSING_SNAPSHOT" : "BUG_MISSING_SNAPSHOT_NEW_POSITION",
      missingFields,
      availableFields,
    };
  }
  return {
    snapshotStatus: missingFields.length > 0 ? "PARTIAL_SNAPSHOT" : "VALID_SNAPSHOT",
    missingFields,
    availableFields,
  };
}

function legacyRiskSnapshotLabel(openedAtOrEntryTime: number | string | undefined): "LEGACY_PRE_FIX" | "SNAPSHOT_MISSING" {
  const openedAtMs = typeof openedAtOrEntryTime === 'number'
    ? openedAtOrEntryTime
    : Date.parse(openedAtOrEntryTime || '');
  return Number.isFinite(openedAtMs) && openedAtMs < SNAPSHOT_SCHEMA_CUTOFF_MS
    ? "LEGACY_PRE_FIX"
    : "SNAPSHOT_MISSING";
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function setupMetricNumber(metrics: unknown, key: string): number | null {
  if (!Array.isArray(metrics)) return null;
  const row = metrics.find((m: any) => m?.key === key);
  return finiteNumber((row as any)?.actualValue);
}

function resolveExecutionDisplay(adapterOrMode?: string | null): { executionMode: "Demo" | "Live"; executionAdapter: string } {
  const executionMode = getExecutionModeDisplay(adapterOrMode) === 'live' ? 'Live' : 'Demo';
  return {
    executionMode,
    executionAdapter: getExecutionAdapterDisplay(adapterOrMode),
  };
}

function fallbackField(symbol: string, fieldName: string, sourceUsed: string, value: unknown, fallbackReason: string): void {
  const sig = `${symbol}|${fieldName}|${sourceUsed}|${String(value)}|${fallbackReason}`;
  const now = Date.now();
  if (sig === _lastOpenFieldFallbackSig && now - _lastOpenFieldFallbackAt < 10000) return;
  _lastOpenFieldFallbackSig = sig;
  _lastOpenFieldFallbackAt = now;
  logger.info(`OPEN_POSITION_DISPLAY_FIELD_FALLBACK_AUDIT: symbol=${symbol} fieldName=${fieldName} sourceUsed=${sourceUsed} value=${String(value)} fallbackReason=${fallbackReason}`);
}

function resolveTopCandidateTrend(candidate: ScannerCandidate): { displayedTrend: string; sourceUsed: string; fallbackUsed: boolean; fallbackReason: string } {
  const c = candidate as any;
  const rawSymbolTrend = c.symbolTrend ?? c.coinTrend ?? c.periodTrendDirection ?? null;
  const rawMarketTrend = c.marketTrendAtScan ?? c.periodTrend ?? null;
  const rawGroupTrend = c.autoStrategyDecision?.groupTrend ?? c.groupTrend ?? null;
  const rawMarketRegime = c.marketRegimeAtScan ?? c.periodRegime ?? null;
  const pick = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (s.toLowerCase() === 'n/a' || s.toLowerCase() === 'none' || s.toLowerCase() === 'unknown') return null;
    return s;
  };
  const symbolTrend = pick(rawSymbolTrend);
  const marketTrend = pick(rawMarketTrend);
  const groupTrend = pick(rawGroupTrend);
  const marketRegime = pick(rawMarketRegime);
  if (symbolTrend) return { displayedTrend: symbolTrend, sourceUsed: 'symbolTrend', fallbackUsed: false, fallbackReason: 'none' };
  if (marketTrend) return { displayedTrend: marketTrend, sourceUsed: 'marketTrendAtScan', fallbackUsed: true, fallbackReason: 'symbol_trend_missing' };
  if (groupTrend) return { displayedTrend: groupTrend, sourceUsed: 'groupTrend', fallbackUsed: true, fallbackReason: 'symbol_and_market_trend_missing' };
  if (marketRegime) return { displayedTrend: marketRegime, sourceUsed: 'marketRegime', fallbackUsed: true, fallbackReason: 'trend_fields_missing' };
  return { displayedTrend: 'UNKNOWN', sourceUsed: 'none', fallbackUsed: true, fallbackReason: 'all_trend_sources_missing' };
}

export function mapScannerCandidateToTradeV4View(candidate: ScannerCandidate, orderLockActive = false, auditDetail: 'summary' | 'full' = 'full', decisionsBySymbol?: ReadonlyMap<string, import('../../core/scanner/executionDecision').ExecutionDecision>): TradeV4CandidateView {
  candidate = rehydrateCandidateMarketFreshness({
    candidate,
    current: MarketDataFeed.getInstance().getCanonicalSymbolMarketData(candidate.symbol),
    consumer: 'TopCandidates.SelectedCoin',
  });
  candidate = normalizeCandidateDisplayStatus(candidate);
  const strategyAudit = buildStrategyAuditSnapshotFromCandidate(candidate);
  logStrategyAudit(strategyAudit, { detailLevel: auditDetail });
  const candidateSourceMeta = buildCandidateSourceMeta(candidate);
  const sourcePresentation = getTradeSourcePresentation(candidateSourceMeta);
  logger.info(`TOP_CANDIDATE_SOURCE_PRESENTATION_AUDIT: symbol=${candidate.symbol} sourceLabel=${sourcePresentation.canonicalLabel} badgeVariant=${sourcePresentation.badgeVariant} source=${String(candidateSourceMeta.source ?? 'missing')} sourceOwner=${String(candidateSourceMeta.sourceOwner ?? 'missing')} ownerType=${String(candidateSourceMeta.ownerType ?? 'missing')} ownerName=${String(candidateSourceMeta.ownerName ?? 'missing')} candidateSource=${String(candidateSourceMeta.candidateSource ?? 'missing')} strategySource=${String(candidateSourceMeta.strategySource ?? 'missing')} runtimeSourceOwner=${String(candidate.runtimeSnapshot?.sourceOwner ?? 'missing')} invariantOk=${String(sourcePresentation.badgeVariant !== 'unknown' || !candidate.runtimeSnapshot || String(candidate.runtimeSnapshot.sourceOwner ?? '').toLowerCase() === 'unknown')} failureReason=${sourcePresentation.badgeVariant === 'unknown' && candidate.runtimeSnapshot && String(candidate.runtimeSnapshot.sourceOwner ?? '').toLowerCase() !== 'unknown' ? 'SOURCE_PRESENTATION_RUNTIME_OWNER_UNMAPPED' : 'none'}`);
  const candidateUiSource = sourcePresentation.badgeVariant === 'unicorn'
    ? 'unicorn'
    : sourcePresentation.badgeVariant === 'micro'
      ? 'scalper'
      : sourcePresentation.badgeVariant === 'ml'
        ? 'ml'
        : 'dipper';
  const visualState: TradeV4CandidateView["engineState"] =
    candidate.status === "BUY" ? (orderLockActive ? "capturing" : "detected")
      : candidate.status === "BLOCK" ? "rejected"
        : candidate.status === "AVOID" ? "floating"
          : candidate.entryGateDecision?.decision === "ALLOW" ? "locked" : "detected";

  const rawConf = candidate.confidence ?? 0;
  const hasRealConfidence = rawConf > 0 || candidate.status === 'BUY';
  const scoreVal = candidate.rawScore != null && candidate.rawScore > 0 ? candidate.rawScore : null;

  const trendResolved = resolveTopCandidateTrend(candidate);
  const auditBuyReady = strategyAudit.finalExecutable === true && strategyAudit.buyAllowed === true;
  const canonicalBuyReady = candidate.status === 'BUY'
    && candidate.finalExecutable === true
    && candidate.buyAllowed === true
    && auditBuyReady
    && candidate.canonicalDisplayStatus?.canPromoteToBuy !== false;
  logger.info(`TOP_CANDIDATE_TREND_SOURCE_AUDIT: symbol=${candidate.symbol} displayedTrend=${trendResolved.displayedTrend} sourceUsed=${trendResolved.sourceUsed} rawSymbolTrend=${String((candidate as any).symbolTrend ?? (candidate as any).coinTrend ?? (candidate as any).periodTrendDirection ?? 'n/a')} rawGroupTrend=${String(candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend ?? 'n/a')} rawMarketTrend=${String((candidate as any).marketTrendAtScan ?? candidate.periodTrend ?? 'n/a')} rawMarketRegime=${String((candidate as any).marketRegimeAtScan ?? candidate.periodRegime ?? 'n/a')} fallbackUsed=${String(trendResolved.fallbackUsed)} fallbackReason=${trendResolved.fallbackReason} updatedAt=${new Date().toISOString()} scannerCycleId=${String((candidate as any).scanId ?? 'unknown')}`);
  return {
    candidateId: candidate.candidateId,
    symbol: candidate.symbol,
    price: Number.isFinite(candidate.price) && candidate.price > 0 ? candidate.price : null,
    rank: candidate.rank != null ? candidate.rank : null,
    score: scoreVal,
    confidenceSource: hasRealConfidence ? 'scanner_score_normalized' : 'missing',
    source: candidateUiSource,
    sourceLabel: sourcePresentation.fullLabel,
    sourcePresentation,
    riskGroup: candidate.riskGroup ?? "unknown",
    strategy: candidate.selectedStrategy,
    status: candidate.status,
    lifecycleStatus: candidate.lifecycleStatus ?? null,
    canonicalDisplayStatus: candidate.canonicalDisplayStatus
      ? {
        canonicalStatus: candidate.canonicalDisplayStatus.canonicalStatus,
        statusSource: candidate.canonicalDisplayStatus.statusSource,
        normalizedBy: candidate.canonicalDisplayStatus.normalizedBy,
      }
      : null,
    runtimeSnapshotPresent: Boolean(candidate.runtimeSnapshot) && candidate.runtimeSnapshot?.invariantOk !== false,
    strategyDecisionPresent: Boolean(candidate.strategyDecision) && candidate.strategyDecision?.invariantOk !== false,
    executionPrecheckSnapshotPresent: Boolean(candidate.executionPrecheckSnapshot) && candidate.executionPrecheckSnapshot?.invariantOk !== false,
    engineState: visualState,
    confidence: hasRealConfidence ? Math.round(rawConf * 100) : 0,
    spreadPct: Number.isFinite(candidate.spreadPct) ? candidate.spreadPct : null,
    volumeRel: Number.isFinite(candidate.volumeRel) ? candidate.volumeRel : null,
    dipPct: Number.isFinite(candidate.dipPercent) ? candidate.dipPercent : null,
    reboundPct: Number.isFinite(candidate.reboundPercent) ? candidate.reboundPercent : null,
    tpRoomPct: null,
    momentum: Number.isFinite(candidate.m5Change) ? candidate.m5Change : null,
    mainReason: candidate.mainReason,
    requiredNextAction: candidate.requiredNextActions?.[0] ?? null,
    blockReasons: candidate.blockReasons ?? [],
    mlBadEntryRisk: candidate.mlBadEntryRisk ? 1 : null,
    dataQuality: toDataQuality(candidate.dataQuality),
    isOrderLocked: orderLockActive,
    referencePeriod: candidate.referencePeriod,
    periodChangePct: candidate.periodChangePct ?? null,
    periodTrend: candidate.periodTrend ?? null,
    periodMomentum: candidate.periodMomentum ?? null,
    periodVolatility: candidate.periodVolatility ?? null,
    periodRegime: candidate.periodRegime ?? null,
    displayTrend: trendResolved.displayedTrend,
    displayTrendSource: trendResolved.sourceUsed,
    effectiveStrategy: candidate.autoStrategyDecision?.effectiveStrategy ?? candidate.effectiveStrategy,
    groupRecommendedStrategy: candidate.autoStrategyDecision?.groupRecommendedStrategy ?? candidate.groupRecommendedStrategy,
    groupTrend: candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend,
    strategySource: candidate.autoStrategyDecision?.strategySource ?? candidate.strategySource,
    autoStrategyReason: candidate.autoStrategyDecision?.reason,
    autoStrategyWarnings: candidate.autoStrategyDecision?.warnings,
    confidenceTier: candidate.autoStrategyDecision?.confidenceTier,
    autoTpDecision: computeAutoTp({
      riskGroup: candidate.riskGroup ?? 'unknown',
      confidence: Math.round((candidate.confidence ?? 0) * 100),
      confidenceTier: candidate.autoStrategyDecision?.confidenceTier,
      groupTrend: candidate.autoStrategyDecision?.groupTrend ?? candidate.groupTrend,
      dataQuality: candidate.dataQuality,
    }),
    strategyAudit,
    finalExecutable: canonicalBuyReady,
    buyAllowed: canonicalBuyReady && strategyAudit.buyAllowed,
    primaryBlocker: candidate.primaryBlocker
      ?? strategyAudit.dynamicSetupContext?.primaryBlocker
      ?? strategyAudit.blockReasons[0]
      ?? (strategyAudit.finalExecutable ? null : 'finalExecutable_false'),
    finalNoBuyReason: canonicalBuyReady
      ? null
      : candidate.finalNoBuyReason ?? strategyAudit.finalNoBuyReason ?? null,
    actionableNoBuyReason: strategyAudit.actionableNoBuyReason ?? candidate.actionableNoBuyReason ?? null,
    technicalNoBuyReason: strategyAudit.technicalNoBuyReason ?? candidate.technicalNoBuyReason ?? null,
    secondaryDiagnosticReasons: strategyAudit.secondaryDiagnosticReasons ?? candidate.secondaryDiagnosticReasons ?? [],
    handoffIntegrityStatus: strategyAudit.handoffIntegrityStatus ?? candidate.handoffIntegrityStatus,
    renderedUserMessage: strategyAudit.renderedUserMessage ?? null,
    unicornDp: (candidate as any).unicornDp ?? null,
    gateAudit: candidate.gateAudit,
    professionalScore: (candidate as any).professionalAnalysis?.professionalScore,
    professionalVerdict: (candidate as any).professionalAnalysis?.professionalVerdict,
    professionalReasons: (candidate as any).professionalAnalysis?.professionalReasons,
    professionalBlockers: (candidate as any).professionalAnalysis?.professionalBlockers,
    professionalRiskLabel: (candidate as any).professionalAnalysis?.riskLabel,
    anchorSettingEnabled: (candidate as any).professionalAnalysis?.anchorSettingEnabled,
    anchorDataAvailable: (candidate as any).professionalAnalysis?.anchorDataAvailable,
    btcFresh: (candidate as any).professionalAnalysis?.btcFresh,
    ethFresh: (candidate as any).professionalAnalysis?.ethFresh,
    anchorDecision: (candidate as any).professionalAnalysis?.anchorDecision,
    anchorBlockApplied: (candidate as any).professionalAnalysis?.anchorBlockApplied,
    executionDecision: (() => {
      const scanKey = `${(candidate as any).scanId ?? (candidate as any).scannerScanId ?? ''}:${candidate.symbol}`;
      const d = decisionsBySymbol?.get(scanKey) ?? decisionsBySymbol?.get(candidate.symbol);
      if (!d) return undefined;
      const currentDecisionReason = isMarketFreshnessBlocker(d.finalNoBuyReason)
        ? (candidate.currentMarketFreshness?.currentFreshnessBlocker ?? 'none')
        : d.finalNoBuyReason;
      return {
        scanId: d.scanId,
          candidateRank: d.candidateRank,
          selectedForExecution: d.selectedForExecution,
          finalNoBuyReason: currentDecisionReason,
          finalNoBuyReasonCode: isMarketFreshnessBlocker(d.finalNoBuyReasonCode) ? currentDecisionReason : d.finalNoBuyReasonCode,
          finalNoBuyReasonLabel: isMarketFreshnessBlocker(d.finalNoBuyReasonLabel) ? currentDecisionReason : d.finalNoBuyReasonLabel,
          actionableNoBuyReason: isMarketFreshnessBlocker(d.actionableNoBuyReason) ? currentDecisionReason : d.actionableNoBuyReason,
        technicalNoBuyReason: d.technicalNoBuyReason,
        secondaryDiagnosticReasons: d.secondaryDiagnosticReasons,
        renderedUserMessage: d.renderedUserMessage,
        finalNoBuyReasonSource: d.finalNoBuyReasonSource,
        finalDecision: d.finalDecision,
        submitAttempted: d.submitAttempted,
        adapterCalled: d.adapterCalled,
        adapterAccepted: d.adapterAccepted,
        adapterResult: d.adapterResult,
        orderFilled: d.orderFilled,
        positionCreated: d.positionCreated,
        journalPersisted: d.journalPersisted,
        telegramSent: d.telegramSent,
        reasonPriorityTrace: d.reasonPriorityTrace,
        invariantOk: d.invariantOk,
        finalExecutable: d.finalExecutable,
        buyAllowed: d.buyAllowed,
        priceFresh: d.priceFresh,
        bookFresh: d.bookFresh,
        spreadOk: d.spreadOk,
        tpRoomOk: d.tpRoomOk,
        capitalOk: d.capitalOk,
        maxOpenPositionsOk: d.maxOpenPositionsOk,
        maxGroupPositionsOk: d.maxGroupPositionsOk,
        maxGroupExposureOk: d.maxGroupExposureOk,
        duplicateOpenPosition: d.duplicateOpenPosition,
        pendingOrderExists: d.pendingOrderExists,
        banned: d.banned,
        runtimeExecutionEnabled: d.runtimeExecutionEnabled,
        setupResult: d.setupResult,
        finalExecutionStrategy: d.finalExecutionStrategy,
        riskGroup: d.riskGroup,
        groupName: d.groupName,
        groupOpenCount: d.groupOpenCount,
        groupMaxOpen: d.groupMaxOpen,
        groupExposure: d.groupExposure,
        groupMaxExposure: d.groupMaxExposure,
      };
    })(),
  };
}

export function mapPositionToOpenPositionView(position: Position): TradeV4OpenPositionView {
  const ageSec = Math.max(0, Math.floor((Date.now() - position.openedAt) / 1000));
  const ageLabel = ageSec >= 60 ? `${Math.floor(ageSec / 60)}m` : `${ageSec}s`;
  const trailState: TradeV4OpenPositionView["trailState"] = position.tpArmed ? (position.tp2Hit ? "active" : "armed") : "off";

  const bs = position.buySnapshot;
  const entryConfig = (position as any)?.entryConfigSnapshot ?? (bs as any)?.entryConfigSnapshot ?? null;
  const riskParams = entryConfig?.riskParams ?? null;
  const sourceResolved = resolveTradeSourceLabel(position);
  const sourcePresentation = getTradeSourcePresentation(sourceResolved);
  const snapshotAudit = classifySnapshotStatus(position);
  const settings = (bs?.settingsSnapshot ?? {}) as Record<string, unknown>;
  const unifiedSignal = ((bs?.traderBrainDecision as any)?.ruleDecisionTrace?.unifiedSignal ?? {}) as Record<string, unknown>;
  const setup = strategySetupFromPosition(position, bs);
  const entryRuleRaw = typeof entryConfig?.finalEntryRule === 'string'
    ? entryConfig.finalEntryRule
    : typeof setup.rawSnapshot?.finalEntryRule === 'string'
      ? setup.rawSnapshot.finalEntryRule
      : typeof unifiedSignal?.reasonCode === 'string'
    ? unifiedSignal.reasonCode
    : typeof (bs?.traderBrainDecision as any)?.selectedPlaybook === 'string'
      ? (bs?.traderBrainDecision as any).selectedPlaybook
      : typeof (bs?.selectedPlaybook) === 'string'
        ? bs.selectedPlaybook
      : null;
  const normalizedEntryRule = entryRuleRaw && String(entryRuleRaw).toUpperCase().includes('WAITING_FOR_SETUP')
    ? (bs?.whySelectedOverOthers ?? 'BUY_CONFIRMED')
    : entryRuleRaw;
  if (!normalizedEntryRule) fallbackField(position.coin, 'entryRule', 'fallback_default', 'UNKNOWN_RULE', 'missing_entry_rule_in_snapshot');
  const pnlPct = position.avgEntryPrice > 0 && position.currentPrice > 0 && position.currentPrice !== position.avgEntryPrice
    ? ((position.currentPrice - position.avgEntryPrice) / position.avgEntryPrice) * 100
    : (position.unrealizedPnlPercent ?? 0);
  const slPct = position.stopLossPercent;
  const exitStatus: TradeV4OpenPositionView["exitStatus"] =
    pnlPct <= -(slPct * 0.8) ? "sl_risk"
      : position.tp2Hit ? "trailing_active"
        : position.tpArmed ? "tp_armed"
          : "monitoring";
  const liveState = resolveLivePriceState(position);
  const { baseAsset, quoteAsset } = splitSymbol(position.coin);
  const usedCapital = position.quantity * position.avgEntryPrice;
  const grossPnlUsd = (liveState.livePrice > 0 ? (liveState.livePrice - position.avgEntryPrice) * position.quantity : 0);
  const grossPnlPct = position.avgEntryPrice > 0 && liveState.livePrice > 0 ? ((liveState.livePrice - position.avgEntryPrice) / position.avgEntryPrice) * 100 : 0;
  const feeEstimate = buildOpenFeeEstimate(position, liveState.livePrice, grossPnlUsd);
  const feesEstimated = feeEstimate.feeUsdTotalEstimated;
  const netPnlUsd = feeEstimate.netPnlUsd;
  const netPnlPct = usedCapital > 0 ? (netPnlUsd / usedCapital) * 100 : 0;
  const priceAgeMs = Number.isFinite(liveState.priceAgeMs) ? liveState.priceAgeMs : Number.MAX_SAFE_INTEGER;
  const formulaUsed = 'PnL $ = (Live Price - Entry Price) × Qty; PnL % = ((Live Price - Entry Price) / Entry Price) × 100';
  const fallbackUsed = liveState.fallbackUsed;
  const reasonIfPriceUnavailable = liveState.livePrice <= 0 ? liveState.reason : 'none';
  logger.info(`PRICE_FRESHNESS_SOURCE_AUDIT: symbol=${position.coin} livePrice=${liveState.livePrice} livePriceSource=${liveState.livePriceSource} priceTimestamp=${liveState.priceTimestamp ?? 'none'} nowTimestamp=${liveState.nowTimestamp} priceAgeMs=${priceAgeMs} staleThresholdMs=${liveState.staleThresholdMs} isFresh=${String(liveState.isFresh)} cacheSource=${liveState.cacheSource} fallbackUsed=${String(liveState.fallbackUsed)} reason=${liveState.reason}`);
  if (!liveState.isFresh && liveState.livePrice > 0) {
    logger.warn(`STALE_OPEN_POSITION_PRICE_WARNING: symbol=${position.coin} livePriceSource=${liveState.livePriceSource} priceAgeMs=${priceAgeMs} staleThresholdMs=${liveState.staleThresholdMs} cacheSource=${liveState.cacheSource} reason=${liveState.reason}`);
  }
  logger.info(`OPEN_POSITION_PNL_CALC_AUDIT: symbol=${position.coin} positionId=${position.tradeId ?? `${position.coin}-${position.openedAt}`} entryPrice=${position.avgEntryPrice} livePrice=${liveState.livePrice} livePriceSource=${liveState.livePriceSource} qty=${position.quantity} usedCapital=${usedCapital.toFixed(6)} grossPnlUsd=${grossPnlUsd.toFixed(6)} grossPnlPct=${grossPnlPct.toFixed(6)} feeUsdEntry=${feeEstimate.feeUsdEntry.toFixed(6)} feeUsdExitEstimated=${feeEstimate.feeUsdExitEstimated.toFixed(6)} feesEstimated=${feesEstimated.toFixed(6)} feeRate=${feeEstimate.feeRate} operatorName=${feeEstimate.operatorName} netPnlUsd=${netPnlUsd.toFixed(6)} netPnlPct=${netPnlPct.toFixed(6)} formulaUsed=netPnlUsd=grossPnlUsd-feeUsdEntry-feeUsdExitEstimated priceAgeMs=${priceAgeMs} fallbackUsed=${String(fallbackUsed)} reasonIfPriceUnavailable=${reasonIfPriceUnavailable}`);

  const marketRegimeAtEntry = bs?.marketRegime ?? null;
  const marketTrendAtEntry = bs?.groupTrend ?? bs?.groupRegime ?? null;
  const rawSelectedStrategy = bs?.selectedStrategy ?? null;
  const entryConfigSnapshotStrategy = (bs as any)?.entryConfigSnapshot?.selectedStrategy ?? null;
  const savedStrategyAtEntry = (entryConfig as any)?.strategyAtEntry ?? (bs as any)?.entryConfigSnapshot?.strategyAtEntry ?? null;
  const isValidExecutableStrategy = (s: string | null): boolean => !!s && !/^(?:wait|unknown|avoid|)$/i.test(s);
  const strategy = savedStrategyAtEntry && isValidExecutableStrategy(String(savedStrategyAtEntry))
    ? String(savedStrategyAtEntry)
    : entryConfigSnapshotStrategy && isValidExecutableStrategy(entryConfigSnapshotStrategy)
      ? entryConfigSnapshotStrategy
      : rawSelectedStrategy && isValidExecutableStrategy(rawSelectedStrategy)
        ? rawSelectedStrategy
        : rawSelectedStrategy
          ? (rawSelectedStrategy.toLowerCase() === 'wait' ? 'unknown_legacy' : rawSelectedStrategy)
          : (position.ownerType ? 'LEGACY UNKNOWN' : 'UNKNOWN');
  const candidateSelectedStrategySource = ((bs as any)?.traderBrainDecision?.ruleDecisionTrace as any)?.unifiedSignal?.reasonCode ?? null;
  const displayedStrategy = strategy;
  const marketBestFit = String((entryConfig as any)?.marketBestFit ?? (setup.rawSnapshot as any)?.marketRecommendedStrategy ?? (bs as any)?.marketBestFit ?? 'n/a');
  const groupRecommendedStrategy = String((entryConfig as any)?.groupRecommendedStrategy ?? (setup.rawSnapshot as any)?.groupRecommendedStrategy ?? bs?.groupRecommendedStrategy ?? 'n/a');
  const finalExecutionStrategy = String((entryConfig as any)?.finalExecutionStrategy ?? entryConfigSnapshotStrategy ?? displayedStrategy);
  const strategyAtEntry = String(savedStrategyAtEntry ?? rawSelectedStrategy ?? displayedStrategy);
  const strategyDecisionReason = String((entryConfig as any)?.strategyDecisionReason ?? (setup.rawSnapshot as any)?.strategyDecisionReason ?? (bs as any)?.entryReason ?? 'n/a');
  const overrideApplied = Boolean((entryConfig as any)?.overrideApplied ?? (setup.rawSnapshot as any)?.overrideApplied ?? false);
  const overrideReason = ((entryConfig as any)?.overrideReason ?? (setup.rawSnapshot as any)?.overrideReason ?? null) as string | null;
  const strategyMismatchWarning = (overrideApplied && !overrideReason) ? 'Strategy mismatch — missing reason' : null;
  const validExecutedStrategy = displayedStrategy !== 'wait' && displayedStrategy !== 'LEGACY UNKNOWN' && displayedStrategy !== 'unknown_legacy' && displayedStrategy !== 'UNKNOWN';
  const entryRuleAtEntry = String((bs as any)?.settingsSnapshot?.entryRule ?? (bs as any)?.entryConfigSnapshot?.finalEntryRule ?? bs?.selectedPlaybook ?? '').trim();
  const sourceOfDisplayedStrategy = savedStrategyAtEntry
    ? 'entryConfigSnapshot.strategyAtEntry'
    : entryConfigSnapshotStrategy
      ? 'entryConfigSnapshot.selectedStrategy'
      : rawSelectedStrategy
        ? 'buySnapshot.selectedStrategy'
        : position.ownerType
      ? 'position_ownerType_fallback_legacy'
      : 'fallback_UNKNOWN';
  const auditpid = position.tradeId ?? `${position.coin}-${position.openedAt}`;
  logger.info(`POSITION_STRATEGY_BINDING_AUDIT: symbol=${position.coin} positionId=${auditpid} displayedStrategy=${displayedStrategy} positionStrategyAtEntry=${rawSelectedStrategy ?? 'none'} entryConfigSnapshotStrategy=${entryConfigSnapshotStrategy ?? 'none'} candidateSelectedStrategy=${String(bs?.selectedPlaybook ?? 'none')} entryRuleAtEntry=${entryRuleAtEntry || 'none'} finalEntryRule=${String((bs as any)?.entryConfigSnapshot?.finalEntryRule ?? 'none')} sourceOfDisplayedStrategy=${sourceOfDisplayedStrategy} validExecutedStrategy=${String(validExecutedStrategy)} isOpenPosition=true isClosedPosition=false`);
  {
    const displayedDipPct = typeof setup.metrics.actualDipPct?.actualValue === 'number' ? (setup.metrics.actualDipPct.actualValue as number) : null;
    const displayedReboundPct = typeof setup.metrics.actualReboundPct?.actualValue === 'number' ? (setup.metrics.actualReboundPct.actualValue as number) : null;
    const dipDisplaySource = displayedDipPct !== null ? (setup.sourceUsed.includes('entryConfigSnapshot') ? 'entrySnapshot' : setup.sourceUsed.includes('unifiedSignal') ? 'currentScanner' : setup.sourceUsed.includes('setupRequired') ? 'entrySnapshotSetupMetrics' : setup.sourceUsed) : 'none';
    const reboundDisplaySource = displayedReboundPct !== null ? (setup.sourceUsed.includes('entryConfigSnapshot') ? 'entrySnapshot' : setup.sourceUsed.includes('unifiedSignal') ? 'currentScanner' : setup.sourceUsed.includes('setupRequired') ? 'entrySnapshotSetupMetrics' : setup.sourceUsed) : 'none';
    const entrySnapshotDipPct = typeof setup.metrics.actualDipPct?.actualValue === 'number' ? (setup.metrics.actualDipPct.actualValue as number) : null;
    const entrySnapshotReboundPct = typeof setup.metrics.actualReboundPct?.actualValue === 'number' ? (setup.metrics.actualReboundPct.actualValue as number) : null;
    const requiredDipPctAtEntry = typeof setup.metrics.requiredDipPct?.requiredValue === 'number' ? (setup.metrics.requiredDipPct.requiredValue as number) : null;
    const requiredReboundPctAtEntry = typeof setup.metrics.requiredReboundPct?.requiredValue === 'number' ? (setup.metrics.requiredReboundPct.requiredValue as number) : null;
    const dipSourceValid = displayedDipPct !== null && displayedDipPct === entrySnapshotDipPct;
    const reboundSourceValid = displayedReboundPct !== null && displayedReboundPct === entrySnapshotReboundPct;
    const sourceValid = (displayedDipPct == null || dipSourceValid) && (displayedReboundPct == null || reboundSourceValid);
    const mismatchDetected = !sourceValid;
    logger.info(`OPEN_POSITION_DIP_REBOUND_SOURCE_AUDIT: symbol=${position.coin} positionId=${auditpid} displayedDipPct=${displayedDipPct?.toFixed(2) ?? 'n/a'} displayedReboundPct=${displayedReboundPct?.toFixed(2) ?? 'n/a'} dipDisplaySource=${dipDisplaySource} reboundDisplaySource=${reboundDisplaySource} entrySnapshotDipPct=${entrySnapshotDipPct?.toFixed(2) ?? 'n/a'} entrySnapshotReboundPct=${entrySnapshotReboundPct?.toFixed(2) ?? 'n/a'} currentScannerDipPct=${String(unifiedSignal?.dipPercent ?? 'n/a')} currentScannerReboundPct=${String(unifiedSignal?.reboundPct ?? 'n/a')} requiredDipPctAtEntry=${requiredDipPctAtEntry?.toFixed(2) ?? 'n/a'} requiredReboundPctAtEntry=${requiredReboundPctAtEntry?.toFixed(2) ?? 'n/a'} sourceValid=${String(sourceValid)} mismatchDetected=${String(mismatchDetected)}`);
    if (displayedStrategy === 'dip_and_rebound') {
      const entrySnapshotActualDip = entrySnapshotDipPct;
      const entrySnapshotActualRebound = entrySnapshotReboundPct;
      const displayedDip = displayedDipPct;
      const displayedReb = displayedReboundPct;
      const finalExec = (setup.rawSnapshot as any)?.finalExecutableAtEntry ?? (setup.rawSnapshot as any)?.finalExecutable ?? entryConfig?.finalExecutableAtEntry ?? null;
      const entryConfirmed = (setup.rawSnapshot as any)?.entryConfirmedAtEntry ?? null;
      const violationDetected = (typeof entrySnapshotActualRebound === 'number' && entrySnapshotActualRebound <= 0)
        || (typeof displayedReb === 'number' && displayedReb <= 0)
        || (typeof finalExec === 'boolean' && !finalExec);
      logger.info(`DIP_REBOUND_POSITION_INTEGRITY_AUDIT: symbol=${position.coin} positionId=${auditpid} displayedStrategy=${displayedStrategy} entryStrategy=${displayedStrategy} finalEntryRule=${normalizedEntryRule ?? 'n/a'} entrySnapshotActualDipPct=${entrySnapshotActualDip?.toFixed(2) ?? 'n/a'} entrySnapshotRequiredDipPct=${requiredDipPctAtEntry?.toFixed(2) ?? 'n/a'} entrySnapshotDipConfirmed=${String(setup.metrics.actualDipPct?.passed ?? setup.metrics.dipConfirmed?.passed ?? 'n/a')} entrySnapshotActualReboundPct=${entrySnapshotActualRebound?.toFixed(2) ?? 'n/a'} entrySnapshotRequiredReboundPct=${requiredReboundPctAtEntry?.toFixed(2) ?? 'n/a'} entrySnapshotReboundConfirmed=${String(setup.metrics.actualReboundPct?.passed ?? setup.metrics.reboundConfirmed?.passed ?? 'n/a')} displayedDipPct=${displayedDip?.toFixed(2) ?? 'n/a'} displayedReboundPct=${displayedReb?.toFixed(2) ?? 'n/a'} displayedDipSource=${dipDisplaySource} displayedReboundSource=${reboundDisplaySource} currentScannerDipPct=${String(unifiedSignal?.dipPercent ?? 'n/a')} currentScannerReboundPct=${String(unifiedSignal?.reboundPct ?? 'n/a')} finalExecutableAtEntry=${String(finalExec ?? 'n/a')} contractValidAtEntry=${String(!violationDetected)} violationDetected=${String(violationDetected)}`);
      if (violationDetected) {
        logger.warn(`DIP_REBOUND_INVALID_OPEN_POSITION_DETECTED: symbol=${position.coin} positionId=${auditpid} strategy=dip_and_rebound entrySnapshotActualReboundPct=${entrySnapshotActualRebound?.toFixed(4) ?? 'n/a'} displayedReboundPct=${displayedReb?.toFixed(4) ?? 'n/a'} entrySnapshotActualDipPct=${entrySnapshotActualDip?.toFixed(4) ?? 'n/a'} finalExecutableAtEntry=${String(finalExec ?? 'n/a')} reason=rebound_missing_or_zero_or_display_mismatch`);
      }
    }
  }
  const displayTrend = marketTrendAtEntry ?? marketRegimeAtEntry ?? 'unknown';
  const riskTp1Pct = finiteNumber((riskParams as any)?.tp1Pct);
  const riskTp1TargetPrice = finiteNumber((riskParams as any)?.tp1TargetPrice);
  const riskTp2Pct = finiteNumber((riskParams as any)?.tp2Pct);
  const riskSlPct = finiteNumber((riskParams as any)?.slPct);
  const riskTp1Source = typeof (riskParams as any)?.tp1Source === 'string'
    ? (riskParams as any).tp1Source
    : typeof (riskParams as any)?.sourceTp1 === 'string'
      ? (riskParams as any).sourceTp1
      : null;
  const riskTp1Min = finiteNumber((riskParams as any)?.tp1Min);
  const riskTp1Max = finiteNumber((riskParams as any)?.tp1Max);
  const riskTp1Reason = typeof (riskParams as any)?.tp1Reason === 'string' ? (riskParams as any).tp1Reason : 'n/a';
  const riskTp2Source = typeof (riskParams as any)?.tp2Source === 'string'
    ? (riskParams as any).tp2Source
    : typeof (riskParams as any)?.sourceTp2 === 'string'
      ? (riskParams as any).sourceTp2
      : null;
  const riskSlSource = typeof (riskParams as any)?.slSource === 'string'
    ? (riskParams as any).slSource
    : typeof (riskParams as any)?.sourceSl === 'string'
      ? (riskParams as any).sourceSl
      : null;
  const autoManagedSnapshot = Boolean((riskParams as any)?.autoBotsOnAtEntry)
    || String((riskParams as any)?.tp1Source ?? (riskParams as any)?.sourceTp1 ?? '').toLowerCase().includes('autobots')
    || String(bs?.ownerName ?? bs?.source ?? bs?.strategySource ?? '').toLowerCase().includes('dipper')
    || String(bs?.ownerName ?? bs?.source ?? bs?.strategySource ?? '').toLowerCase().includes('autobots');
  const invalidAutoTp1 = !!riskParams && autoManagedSnapshot && (riskTp1Pct == null || riskTp1Pct <= 0 || riskTp1TargetPrice == null || riskTp1TargetPrice <= position.avgEntryPrice);
  const riskSnapshotStatus = invalidAutoTp1 ? "BUG_TP1_INVALID" : (riskParams ? "VALID_RISK_SNAPSHOT" : legacyRiskSnapshotLabel(position.openedAt));
  const displayedTp1Pct = invalidAutoTp1 ? null : (riskTp1Pct ?? null);
  const displayedTp1TargetPrice = invalidAutoTp1 ? null : (riskTp1TargetPrice ?? null);
  const calculatedTp1Target = displayedTp1Pct != null ? position.avgEntryPrice * (1 + (displayedTp1Pct / 100)) : null;
  const targetMatchesSnapshot = displayedTp1TargetPrice != null && calculatedTp1Target != null
    ? Math.abs(displayedTp1TargetPrice - calculatedTp1Target) <= Math.max(1e-10, Math.abs(calculatedTp1Target) * 1e-8)
    : false;
  const displayedTp2Pct = riskTp2Pct ?? (Number.isFinite(position.tp2Percent) ? position.tp2Percent : null);
  const displayedSlPct = riskSlPct ?? (Number.isFinite(position.stopLossPercent) ? position.stopLossPercent : null);
  const positionId = position.tradeId ?? `${position.coin}-${position.openedAt}`;
  const sourceUsed = 'PositionManager' as const;
  const snapshotPresent = !!bs;
  const riskSnapshotPresent = !!riskParams;
  const entrySnapshotPresent = !!entryConfig;
  const strategySnapshotPresent = !!setup.rawSnapshot;
  const isLegacyPosition = snapshotAudit.snapshotStatus === 'LEGACY_MISSING_SNAPSHOT' || riskSnapshotStatus === 'LEGACY_PRE_FIX';
  const isLivePosition = !isLegacyPosition;
  const rowUsesCandidateState = false;
  const rowUsesLegacyFallback = !riskSnapshotPresent || setup.sourceUsed === 'legacyDisplaySnapshot';
  const executionRaw = String((position as any)?.adapter ?? bs?.adapter ?? (bs as any)?.executionSource ?? '');
  const executionDisplay = resolveExecutionDisplay(executionRaw);
  const missingRiskFields = [
    riskTp1Pct == null ? 'tp1Pct' : null,
    riskTp1TargetPrice == null ? 'tp1TargetPrice' : null,
    riskTp1Source == null ? 'tp1Source' : null,
  ].filter(Boolean).join('|') || 'none';
  logger.info(`OPEN_POSITION_RISK_SNAPSHOT_AUDIT: symbol=${position.coin} positionId=${positionId} riskGroup=${bs?.riskGroup ?? 'unknown'} confidence=${bs?.confidence ?? 'n/a'} strategy=${strategy} entryRule=${normalizedEntryRule ?? 'UNKNOWN_RULE'} riskSnapshotStatus=${riskSnapshotStatus} tp1Pct=${displayedTp1Pct ?? 'n/a'} tp1TargetPrice=${displayedTp1TargetPrice ?? 'n/a'} tp1Source=${riskTp1Source ?? riskSnapshotStatus} tp1Reason=${riskTp1Reason} tp1Min=${riskTp1Min ?? 'n/a'} tp1Max=${riskTp1Max ?? 'n/a'} tp2Pct=${displayedTp2Pct ?? 'n/a'} slPct=${displayedSlPct ?? 'n/a'} entryPrice=${position.avgEntryPrice} snapshotPresent=${String(snapshotPresent)} riskSnapshotPresent=${String(riskSnapshotPresent)} sourceUsed=${riskParams ? 'entryConfigSnapshot.riskParams' : 'none'} missingFields=${missingRiskFields}`);
  logger.info(`OPEN_POSITION_CANONICAL_BINDING_AUDIT: symbol=${position.coin} positionId=${positionId} sourceUsed=${sourceUsed} snapshotPresent=${String(snapshotPresent)} riskSnapshotPresent=${String(riskSnapshotPresent)} strategySnapshotPresent=${String(strategySnapshotPresent)} tp1Pct=${displayedTp1Pct ?? 'n/a'} tp1TargetPrice=${displayedTp1TargetPrice ?? 'n/a'} tp1Source=${riskTp1Source ?? riskSnapshotStatus} tp2Pct=${displayedTp2Pct ?? 'n/a'} slPct=${displayedSlPct ?? 'n/a'} entryPrice=${position.avgEntryPrice} calculatedTp1Target=${calculatedTp1Target ?? 'n/a'} displayedTp1Target=${displayedTp1TargetPrice ?? 'n/a'} targetMatchesSnapshot=${String(targetMatchesSnapshot)} rowUsesCandidateState=${String(rowUsesCandidateState)} rowUsesLegacyFallback=${String(rowUsesLegacyFallback)}`);
  logger.info(`OPEN_POSITION_ENTRY_SNAPSHOT_AUDIT: symbol=${position.coin} positionId=${positionId} sourceUsed=${entrySnapshotPresent ? 'position.entryConfigSnapshot/buySnapshot.entryConfigSnapshot' : 'none'} snapshotPresent=${String(snapshotPresent)} entrySnapshotPresent=${String(entrySnapshotPresent)} strategySnapshotPresent=${String(strategySnapshotPresent)} strategy=${strategy} entryRule=${normalizedEntryRule ?? 'UNKNOWN_RULE'} dipAtEntry=${String(setup.metrics.actualDipPct?.actualValue ?? 'n/a')} reboundAtEntry=${String(setup.metrics.actualReboundPct?.actualValue ?? 'n/a')} momentumAtEntry=${String(setup.metrics.momentumConfirmed?.actualValue ?? 'n/a')} setupResultAtEntry=${setup.setupResult} finalExecutableAtEntry=${String((setup.rawSnapshot as any)?.finalExecutableAtEntry ?? (setup.rawSnapshot as any)?.finalExecutable ?? entryConfig?.finalExecutableAtEntry ?? 'n/a')} whyAtEntry=${setup.why}`);
  logger.info(`OPEN_POSITION_PRICE_TARGET_AUDIT: symbol=${position.coin} positionId=${positionId} entryPrice=${position.avgEntryPrice} tp1Pct=${displayedTp1Pct ?? 'n/a'} calculatedTp1Target=${calculatedTp1Target ?? 'n/a'} displayedTp1Target=${displayedTp1TargetPrice ?? 'n/a'} targetMatchesSnapshot=${String(targetMatchesSnapshot)} targetGreaterThanEntry=${String(displayedTp1TargetPrice != null && displayedTp1TargetPrice > position.avgEntryPrice)} precision=full_snapshot_number sourceUsed=${riskParams ? 'entryConfigSnapshot.riskParams' : 'none'}`);
  logger.info(`OPEN_POSITION_ROW_SOURCE_AUDIT: symbol=${position.coin} sourceUsed=${sourceUsed} positionId=${positionId} isLive=${String(isLivePosition)} isLegacy=${String(isLegacyPosition)} snapshotPresent=${String(snapshotPresent)} riskSnapshotPresent=${String(riskSnapshotPresent)} entrySnapshotPresent=${String(entrySnapshotPresent)} snapshotStatus=${snapshotAudit.snapshotStatus} riskSnapshotStatus=${riskSnapshotStatus} canonicalSource=PositionManager rowSourceMismatch=false`);
  logger.info(`OPEN_POSITION_RENDER_ROW_AUDIT: symbol=${position.coin} positionId=${positionId} sourceUsed=${sourceUsed} snapshotPresent=${String(snapshotPresent)} riskSnapshotPresent=${String(riskSnapshotPresent)} rawSnapshotTp1Pct=${riskTp1Pct ?? 'n/a'} rawSnapshotTp1TargetPrice=${riskTp1TargetPrice ?? 'n/a'} rawSnapshotTp1Source=${riskTp1Source ?? 'n/a'} displayedTp1Pct=${displayedTp1Pct ?? 'BUG_TP1_INVALID_OR_MISSING'} displayedTp1Target=${displayedTp1TargetPrice ?? 'BUG_TP1_INVALID_OR_MISSING'} displayedTp1Source=${invalidAutoTp1 ? 'BUG_TP1_INVALID' : (riskTp1Source ?? riskSnapshotStatus)} tp2Pct=${displayedTp2Pct ?? 'n/a'} slPct=${displayedSlPct ?? 'n/a'} rowUsesLegacyFallback=${String(rowUsesLegacyFallback)} rowUsesCandidateState=${String(rowUsesCandidateState)} rowUsesSettingsFallback=false`);
  if (invalidAutoTp1) {
    logger.warn(`UI_TP1_BINDING_BUG: symbol=${position.coin} positionId=${positionId} rawSnapshotTp1Pct=${riskTp1Pct ?? 'n/a'} rawSnapshotTp1TargetPrice=${riskTp1TargetPrice ?? 'n/a'} entryPrice=${position.avgEntryPrice} reason=auto_managed_position_invalid_tp1_snapshot`);
  }
  if (!riskParams) {
    logger.warn(`OPEN_POSITION_LEGACY_SNAPSHOT_WARNING: symbol=${position.coin} positionId=${positionId} riskSnapshotStatus=${riskSnapshotStatus} message=TP1 risk snapshot missing; display marked as ${riskSnapshotStatus}`);
  }
  if (!bs?.selectedStrategy) fallbackField(position.coin, 'strategy', 'fallback_position_legacy', strategy, 'missing_selectedStrategy_in_snapshot');
  if (!marketTrendAtEntry && !marketRegimeAtEntry) fallbackField(position.coin, 'market', 'fallback_unknown', displayTrend, 'missing_market_trend_and_regime');

  if (snapshotAudit.snapshotStatus !== 'VALID_SNAPSHOT') {
    logger.info(`POSITION_SNAPSHOT_STATUS_AUDIT: symbol=${position.coin} positionId=${position.tradeId ?? `${position.coin}-${position.openedAt}`} createdAt=${new Date(position.openedAt).toISOString()} snapshotStatus=${snapshotAudit.snapshotStatus} hasEntryConfigSnapshot=${String(!!entryConfig)} hasStrategyAuditSnapshot=${String(!!setup.rawSnapshot)} missingFields=${snapshotAudit.missingFields.join('|') || 'none'} availableFields=${snapshotAudit.availableFields.join('|') || 'none'} source=${position.ownerType ?? 'unknown'} mode=${position.mode}`);
    if (snapshotAudit.snapshotStatus === 'BUG_MISSING_SNAPSHOT_NEW_POSITION') {
      logger.warn(`POSITION_ENTRY_SNAPSHOT_MISSING_BUG: symbol=${position.coin} positionId=${position.tradeId ?? `${position.coin}-${position.openedAt}`} createdAt=${new Date(position.openedAt).toISOString()} mode=${position.mode}`);
    }
    if (snapshotAudit.snapshotStatus === 'PARTIAL_SNAPSHOT') {
      logger.warn(`POSITION_ENTRY_SNAPSHOT_PARTIAL_FIELDS: symbol=${position.coin} positionId=${position.tradeId ?? `${position.coin}-${position.openedAt}`} missingFields=${snapshotAudit.missingFields.join('|') || 'none'}`);
    }
  }
  logger.info(`POSITION_STRATEGY_SETUP_DISPLAY_AUDIT: symbol=${position.coin} strategy=${strategy} hasStrategyAuditSnapshot=${String(!!setup.rawSnapshot)} hasSetupMetrics=${String(Object.keys(setup.metrics).length > 0)} dipActual=${String(setup.metrics.actualDipPct?.actualValue ?? 'n/a')} dipRequired=${String(setup.metrics.requiredDipPct?.requiredValue ?? 'n/a')} reboundActual=${String(setup.metrics.actualReboundPct?.actualValue ?? 'n/a')} reboundRequired=${String(setup.metrics.requiredReboundPct?.requiredValue ?? 'n/a')} momentumConfirmed=${String(setup.metrics.momentumConfirmed?.actualValue ?? 'n/a')} setupResult=${setup.setupResult} finalExecutableAtEntry=${String((setup.rawSnapshot as any)?.finalExecutableAtEntry ?? (setup.rawSnapshot as any)?.finalExecutable ?? entryConfig?.finalExecutableAtEntry ?? 'n/a')} missingFields=${setup.missingFields.join('|') || 'none'} sourceUsed=${setup.sourceUsed}`);
  if (snapshotAudit.snapshotStatus !== 'LEGACY_MISSING_SNAPSHOT' && Object.keys(setup.metrics).length === 0 && setup.missingFields.includes('setupMetrics')) {
    logger.warn(`POSITION_STRATEGY_SETUP_MISSING_BUG: symbol=${position.coin} strategy=${strategy} snapshotStatus=${snapshotAudit.snapshotStatus}`);
  }

  return {
    id: positionId,
    symbol: position.coin,
    entryPrice: position.avgEntryPrice,
    refPrice: Number.isFinite((bs as any)?.realMarketPriceAtBuy) ? Number((bs as any).realMarketPriceAtBuy) : (Number.isFinite(position.lastPrice) ? position.lastPrice : null),
    livePrice: liveState.livePrice,
    pnlPct,
    pnlUsd: netPnlUsd,
    tp1Pct: displayedTp1Pct,
    tp1TargetPrice: displayedTp1TargetPrice,
    tp1Source: riskTp1Source ?? riskSnapshotStatus,
    riskSnapshotStatus,
    sourceUsed,
    isLivePosition,
    isLegacyPosition,
    snapshotPresent,
    riskSnapshotPresent,
    entrySnapshotPresent,
    tp2Pct: displayedTp2Pct,
    slPct: displayedSlPct,
    tp2Source: riskTp2Source ?? riskSnapshotStatus,
    slSource: riskSlSource ?? riskSnapshotStatus,
    trailStartPct: Number.isFinite((riskParams as any)?.trailStartPct) ? Number((riskParams as any).trailStartPct) : null,
    trailPullbackPct: Number.isFinite((riskParams as any)?.trailPullbackPct) ? Number((riskParams as any).trailPullbackPct) : (position.trailFromPeakPercent ?? null),
    trailState,
    ageLabel,
    status: "open",
    strategy,
    marketBestFit,
    groupRecommendedStrategy,
    finalExecutionStrategy,
    strategyAtEntry,
    strategyDecisionReason,
    overrideApplied,
    overrideReason,
    strategyMismatchWarning,
    riskGroup: bs?.riskGroup ?? 'n/a',
    groupTrend: displayTrend,
    exitStatus,
    priceQuality: liveState.priceQuality,
    ownerType: position.ownerType ?? 'unknown',
    sourceLabel: sourceResolved.label,
    sourcePresentation,
    mode: bs?.mode ?? position.mode ?? 'unknown',
    executionMode: executionDisplay.executionMode,
    executionAdapter: executionDisplay.executionAdapter,
    entryRule: normalizedEntryRule ?? 'UNKNOWN_RULE',
    entryReason: bs?.whySelectedOverOthers ?? null,
    entryPriceSource: bs?.entryPriceSource ?? null,
    entryPriceAgeMs: Number.isFinite(bs?.entryPriceAgeMs) ? bs?.entryPriceAgeMs : null,
    livePriceSource: liveState.livePriceSource,
    livePriceAgeMs: priceAgeMs,
    priceFreshnessStatus: liveState.livePriceSource,
    isPriceFresh: liveState.isFresh,
    priceTimestamp: liveState.priceTimestamp,
    priceStaleThresholdMs: liveState.staleThresholdMs,
    priceFreshnessReason: liveState.reason,
    exitPriceUnavailable: position.exitPriceUnavailable === true,
    exitPriceUnavailableAt: typeof position.exitPriceUnavailableAt === 'number' ? position.exitPriceUnavailableAt : null,
    exitPriceUnavailableReason: position.exitPriceUnavailableReason ?? null,
    spreadPct: Number.isFinite(bs?.spreadPct) ? bs?.spreadPct : null,
    quantity: position.quantity,
    usedCapitalUsd: position.quantity * position.avgEntryPrice,
    feeUsdEntry: feeEstimate.feeUsdEntry,
    feeUsdExitEstimated: feeEstimate.feeUsdExitEstimated,
    feeUsdTotalEstimated: feeEstimate.feeUsdTotalEstimated,
    feeUsdTotalSoFar: feeEstimate.feeUsdTotalSoFar,
    feeRate: feeEstimate.feeRate,
    feeSource: feeEstimate.feeSource,
    operatorName: feeEstimate.operatorName,
    confidence: bs && Number.isFinite(bs.confidence) ? Math.round(bs.confidence * 100) : null,
    score: bs && Number.isFinite(bs.candidateRank) ? bs.candidateRank ?? null : null,
    scannerPeriod: bs?.referencePeriod ?? null,
    candidateSource: bs?.scannerSnapshotId ? 'scanner' : 'position_manager',
    trailingEnabled: !!settings?.dynamicTrailingEnabled || (position.trailFromPeakPercent ?? 0) > 0,
    dynamicTrailingEnabled: !!settings?.dynamicTrailingEnabled,
    trailStart: typeof settings?.trailTriggerPct === 'number' ? (settings.trailTriggerPct as number) : null,
    trailPullback: Number.isFinite(position.trailFromPeakPercent) ? position.trailFromPeakPercent : null,
    maxSlippagePct: typeof settings?.maxSlippagePct === 'number' ? (settings.maxSlippagePct as number) : null,
    maxTotalCostPct: typeof settings?.maxTotalEntryCostPct === 'number' ? (settings.maxTotalEntryCostPct as number) : null,
    entryConfirmation: typeof settings?.entryConfirmationMode === 'string' ? (settings.entryConfirmationMode as string) : null,
    dipPct: typeof setup.metrics.actualDipPct?.actualValue === 'number' ? (setup.metrics.actualDipPct.actualValue as number) : (typeof unifiedSignal?.dipPercent === 'number' ? (unifiedSignal.dipPercent as number) : null),
    requiredDipPct: typeof setup.metrics.requiredDipPct?.requiredValue === 'number' ? (setup.metrics.requiredDipPct.requiredValue as number) : null,
    reboundPct: typeof setup.metrics.actualReboundPct?.actualValue === 'number' ? (setup.metrics.actualReboundPct.actualValue as number) : (typeof unifiedSignal?.reboundPct === 'number' ? (unifiedSignal.reboundPct as number) : null),
    requiredReboundPct: typeof setup.metrics.requiredReboundPct?.requiredValue === 'number' ? (setup.metrics.requiredReboundPct.requiredValue as number) : null,
    reboundConfirmed: typeof setup.metrics.actualReboundPct?.passed === 'boolean' ? setup.metrics.actualReboundPct.passed : (typeof unifiedSignal?.reboundPassed === 'boolean' ? (unifiedSignal.reboundPassed as boolean) : null),
    momentumConfirmed: typeof setup.metrics.momentumConfirmed?.actualValue === 'boolean' ? (setup.metrics.momentumConfirmed.actualValue as boolean) : (typeof unifiedSignal?.momentumConfirmed === 'boolean' ? (unifiedSignal.momentumConfirmed as boolean) : null),
    strategySetupSummary: setup.setupSummary,
    strategySetupDipReqLabel: setup.dipReqLabel,
    strategySetupReboundReqLabel: setup.reboundReqLabel,
    strategySetupMomLabel: setup.momentumLabel,
    strategySetupResult: setup.setupResult,
    strategySetupWhy: setup.why,
    strategySetupSource: setup.sourceUsed,
    strategySetupMissingFields: setup.missingFields,
    strategySetupMetrics: setup.metrics,
    hasSnapshot: !!bs,
    baseAsset,
    quoteAsset,
    openedAtLabel: new Date(position.openedAt).toISOString(),
    strategySource: typeof bs?.settingsSnapshot?.strategySource === 'string' ? (bs.settingsSnapshot.strategySource as string) : null,
    marketRegimeAtEntry,
    btcContextAtEntry: bs?.btcRegime ?? null,
    dataQuality: bs?.marketDataQuality ?? null,
    snapshotStatus: snapshotAudit.snapshotStatus,
    snapshotMissingFields: snapshotAudit.missingFields,
    pnlBreakdown: {
      entryPrice: position.avgEntryPrice,
      livePrice: liveState.livePrice,
      livePriceSource: liveState.livePriceSource,
      qty: position.quantity,
      usedCapital,
      grossPnlUsd,
      grossPnlPct,
      feesEstimated,
      feeUsdEntry: feeEstimate.feeUsdEntry,
      feeUsdExitEstimated: feeEstimate.feeUsdExitEstimated,
      feeUsdTotalEstimated: feeEstimate.feeUsdTotalEstimated,
      feeUsdTotalSoFar: feeEstimate.feeUsdTotalSoFar,
      feeRate: feeEstimate.feeRate,
      feeSource: feeEstimate.feeSource,
      operatorName: feeEstimate.operatorName,
      netPnlUsd,
      netPnlPct,
      formulaUsed,
      priceAgeMs,
      priceTimestamp: liveState.priceTimestamp,
      staleThresholdMs: liveState.staleThresholdMs,
      isFresh: liveState.isFresh,
      cacheSource: liveState.cacheSource,
      priceFreshnessStatus: liveState.livePriceSource,
      priceFreshness: liveState.priceQuality,
      fallbackUsed,
      reasonIfPriceUnavailable,
    },
    diagnostic: {
      positionId: position.tradeId ?? `${position.coin}-${position.openedAt}`,
      createdAt: new Date(position.openedAt).toISOString(),
      source: position.ownerType ?? 'unknown',
      mode: bs?.mode ?? position.mode ?? 'unknown',
      strategy,
      entryRule: normalizedEntryRule ?? 'UNKNOWN_RULE',
      autoBotsOnAtEntry: String((bs?.settingsSnapshot as any)?.strategySource ?? '').toLowerCase() === 'autobots',
      userSettingsSnapshotAtEntry: (bs?.settingsSnapshot as Record<string, unknown>) ?? null,
      entryConfigSnapshot: (entryConfig as Record<string, unknown>) ?? null,
      strategyAuditSnapshot: (setup.rawSnapshot as Record<string, unknown>) ?? ((bs as any)?.strategyAuditSnapshot as Record<string, unknown>) ?? null,
      strategySetupSnapshot: setup.rawSnapshot,
      pnlCalcSummary: `gross=${grossPnlUsd.toFixed(6)} net=${netPnlUsd.toFixed(6)} used=${usedCapital.toFixed(6)} source=${liveState.livePriceSource}`,
      warnings: [
        snapshotAudit.snapshotStatus !== 'VALID_SNAPSHOT' ? snapshotAudit.snapshotStatus : '',
        liveState.priceQuality === 'unavailable' ? 'PNL_UNAVAILABLE_LIVE_PRICE_MISSING' : '',
        position.exitPriceUnavailable === true ? 'EXIT_CHECK_SKIPPED_NO_FRESH_CLOSE_PRICE' : '',
        liveState.priceQuality === 'fallback' ? 'FALLBACK_PRICE_USED' : '',
        liveState.priceQuality === 'stale' ? 'PNL_BASED_ON_STALE_PRICE' : '',
      ].filter(Boolean),
    },
  };
}

export function buildExitReasonDisplay(input: {
  exitReason: string;
  tp1Pct?: number | null;
  slPct?: number | null;
  trailStartPct?: number | null;
  trailPullbackPct?: number | null;
  cs?: CloseSnapshot;
  snapshotAvailable?: boolean;
}): string {
  const r = String(input.exitReason ?? '').toUpperCase();
  const tp1 = Number.isFinite(input.tp1Pct) ? input.tp1Pct! : null;
  const sl = Number.isFinite(input.slPct) ? input.slPct! : null;
  const trailStart = Number.isFinite(input.trailStartPct) ? input.trailStartPct! : null;
  const trailPullback = Number.isFinite(input.trailPullbackPct) ? input.trailPullbackPct! : null;
  const snapshotMissing = input.snapshotAvailable === false;
  const missTag = snapshotMissing ? ' (snapshot missing)' : '';
  if (r.includes('TP1_FIXED') || r.includes('TP1_HIT')) {
    return tp1 != null ? `TP1 Hit (+${tp1.toFixed(2)}%)` : `TP1 Hit${missTag}`;
  }
  if (r.includes('TP2_FIXED') || r.includes('TP2_HIT')) {
    const tp2 = Number.isFinite((input.cs as any)?.tp2Percent) ? (input.cs as any).tp2Percent : null;
    return tp2 != null ? `TP2 Hit (+${tp2.toFixed(2)}%)` : `TP2 Hit${missTag}`;
  }
  if (r.includes('STOP_LOSS') || r.includes('SL')) {
    return sl != null ? `Stop Loss (-${sl.toFixed(2)}%)` : `Stop Loss${missTag}`;
  }
  if (r.includes('DYNAMIC_TRAIL') || r.includes('TRAIL')) {
    if (trailStart != null && trailPullback != null) {
      return `Trailing Stop (+${trailStart.toFixed(2)}% / pullback ${trailPullback.toFixed(2)}%)`;
    }
    if (trailStart != null) return `Trailing Stop (+${trailStart.toFixed(2)}%)${missTag}`;
    return `Trailing Stop${missTag}`;
  }
  if (r.includes('MANUAL') || r.includes('MANUAL_EXIT')) {
    return 'Manual Close';
  }
  if (r.includes('INVALID_PRICE') || r.includes('EMERGENCY')) {
    return 'Emergency Close';
  }
  if (r.includes('TIME_BASED')) {
    return 'Time-Based Exit';
  }
  if (r === 'CLOSED') {
    return 'Closed' + missTag;
  }
  return input.exitReason ?? 'Unknown';
}

export function mapTradeRecordToClosedPositionView(trade: TradeRecord): TradeV4ClosedPositionView {
  const sourceResolved = resolveTradeSourceLabel(trade);
  const sourcePresentation = getTradeSourcePresentation(sourceResolved);
  const quality = trade.mlQuality?.dataQuality ?? "UNKNOWN";
  const eligibility = trade.mlQuality?.trainingEligible
    ? "eligible"
    : trade.mlQuality?.mlUse === "advisory_only"
      ? "analysis_only"
      : "not_eligible";

  const cs = trade.closeSnapshot;
  const bs = trade.buySnapshot;
  const riskParams = (bs as any)?.entryConfigSnapshot?.riskParams ?? null;
  const durationMs = cs ? cs.durationMs : 0;
  const durationLabel = durationMs >= 3600000
    ? `${(durationMs / 3600000).toFixed(1)}h`
    : durationMs >= 60000
      ? `${Math.floor(durationMs / 60000)}m`
      : `${Math.floor(durationMs / 1000)}s`;

  const closedSnapshotStatus: SnapshotStatus = bs
    ? 'VALID_SNAPSHOT'
    : (Date.parse(trade.entryTime || new Date().toISOString()) < SNAPSHOT_SCHEMA_CUTOFF_MS ? 'LEGACY_MISSING_SNAPSHOT' : 'BUG_MISSING_SNAPSHOT_NEW_POSITION');
  const rawSelectedStrategy = bs?.selectedStrategy ?? null;
  const closedEntryConfigSnapshotStrategy = (bs as any)?.entryConfigSnapshot?.selectedStrategy ?? null;
  const isValidClosedExecutableStrategy = (s: string | null): boolean => !!s && !/^(?:wait|unknown|avoid|)$/i.test(s);
  const strategy = rawSelectedStrategy && isValidClosedExecutableStrategy(rawSelectedStrategy)
    ? rawSelectedStrategy
    : closedEntryConfigSnapshotStrategy && isValidClosedExecutableStrategy(closedEntryConfigSnapshotStrategy)
      ? closedEntryConfigSnapshotStrategy
      : rawSelectedStrategy
        ? (rawSelectedStrategy.toLowerCase() === 'wait' ? 'unknown_legacy' : rawSelectedStrategy)
        : (trade.strategy ?? (closedSnapshotStatus === 'LEGACY_MISSING_SNAPSHOT' ? 'LEGACY UNKNOWN' : 'UNKNOWN'));
  const displayedStrategy = strategy;
  const validExecutedStrategy = displayedStrategy !== 'wait' && displayedStrategy !== 'LEGACY UNKNOWN' && displayedStrategy !== 'unknown_legacy' && displayedStrategy !== 'UNKNOWN';
  const sourceOfDisplayedStrategy = rawSelectedStrategy
    ? 'buySnapshot.selectedStrategy'
    : (trade.strategy ? 'trade.strategy' : 'fallback');
  logger.info(`POSITION_STRATEGY_BINDING_AUDIT: symbol=${trade.coin} positionId=${trade.tradeId} displayedStrategy=${displayedStrategy} positionStrategyAtEntry=${rawSelectedStrategy ?? 'none'} entryConfigSnapshotStrategy=${String((bs as any)?.entryConfigSnapshot?.selectedStrategy ?? 'none')} candidateSelectedStrategy=${String(bs?.selectedPlaybook ?? 'none')} entryRuleAtEntry=${String((bs as any)?.settingsSnapshot?.entryRule ?? (bs as any)?.entryConfigSnapshot?.finalEntryRule ?? 'none')} finalEntryRule=${String((bs as any)?.entryConfigSnapshot?.finalEntryRule ?? 'none')} sourceOfDisplayedStrategy=${sourceOfDisplayedStrategy} validExecutedStrategy=${String(validExecutedStrategy)} isOpenPosition=false isClosedPosition=true`);
  const marketTrendAtEntry = bs?.groupTrend ?? bs?.groupRegime ?? null;
  const marketRegimeAtEntry = bs?.marketRegime ?? null;
  const qty = trade.quantity ?? 0;
  const entryPrice = trade.entryPrice ?? 0;
  const exitPrice = trade.exitPrice ?? entryPrice;
  const usedCapital = qty * entryPrice;
  const grossPnlUsd = (exitPrice - entryPrice) * qty;
  const grossPnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  const closedFeeAccounting = buildClosedFeeAccounting({
    adapterName: trade.adapter,
    buySnapshot: bs ?? null,
    closeSnapshot: cs ?? null,
    grossPnlUsd,
  });
  const fees = closedFeeAccounting.feeUsdTotal;
  const netPnlUsd = closedFeeAccounting.netPnlUsd;
  const netPnlPct = usedCapital > 0 ? (netPnlUsd / usedCapital) * 100 : 0;
  const formulaUsed = 'Closed PnL $ = (Exit Price - Entry Price) × Qty; Closed PnL % = ((Exit Price - Entry Price) / Entry Price) × 100';
  logger.info(`CLOSED_TRADE_PNL_CALC_AUDIT: symbol=${trade.coin} tradeId=${trade.tradeId} entryPrice=${entryPrice} exitPrice=${exitPrice} realMarketPriceAtClose=${cs?.realMarketPriceAtClose ?? 0} closePriceSource=${cs?.closePriceSource ?? 'unavailable'} qty=${qty} usedCapital=${usedCapital.toFixed(6)} grossPnlUsd=${grossPnlUsd.toFixed(6)} grossPnlPct=${grossPnlPct.toFixed(6)} fees=${fees.toFixed(6)} netPnlUsd=${netPnlUsd.toFixed(6)} netPnlPct=${netPnlPct.toFixed(6)} closeReason=${cs?.exitReason ?? trade.status} formulaUsed=long_spot_gross((exit-entry)*qty)_net(gross-fee) priceQuality=${cs?.executionQuality ?? 'unknown'}`);
  const riskSnapshotStatus = riskParams ? "VALID_RISK_SNAPSHOT" : legacyRiskSnapshotLabel(trade.entryTime);
  const riskTp1Pct = finiteNumber((riskParams as any)?.tp1Pct);
  const riskTp1TargetPrice = finiteNumber((riskParams as any)?.tp1TargetPrice);
  const riskTp2Pct = finiteNumber((riskParams as any)?.tp2Pct);
  const riskSlPct = finiteNumber((riskParams as any)?.slPct);
  const riskTrailStartPct = finiteNumber((riskParams as any)?.trailStartPct);
  const riskTrailPullbackPct = finiteNumber((riskParams as any)?.trailPullbackPct);
  const riskSnapshotPresentForDisplay = !!riskParams;
  const exitReasonRaw = cs?.exitReason ?? trade.status;
  const resolvedExitReasonDisplay = buildExitReasonDisplay({
    exitReason: exitReasonRaw,
    tp1Pct: riskTp1Pct,
    slPct: riskSlPct,
    trailStartPct: riskTrailStartPct,
    trailPullbackPct: riskTrailPullbackPct,
    cs: cs ?? undefined,
    snapshotAvailable: riskSnapshotPresentForDisplay,
  });
  logger.info(`CLOSED_POSITION_EXIT_REASON_DISPLAY_AUDIT: symbol=${trade.coin} tradeId=${trade.tradeId} closeReason=${exitReasonRaw} displayedExitReason=${resolvedExitReasonDisplay} tp1Pct=${riskTp1Pct ?? 'n/a'} tp2Pct=${riskTp2Pct ?? 'n/a'} slPct=${riskSlPct ?? 'n/a'} trailStartPct=${riskTrailStartPct ?? 'n/a'} trailPullbackPct=${riskTrailPullbackPct ?? 'n/a'} realizedPnlPct=${trade.pnlPercent ?? 0} realizedPnlUsd=${trade.pnl ?? 0} riskSnapshotPresent=${String(riskSnapshotPresentForDisplay)} sourceUsed=${riskSnapshotPresentForDisplay ? 'buySnapshot.entryConfigSnapshot.riskParams' : (cs ? 'closeSnapshot_fallback' : 'none')}`);
  const riskTp1Source = typeof (riskParams as any)?.tp1Source === 'string'
    ? (riskParams as any).tp1Source
    : typeof (riskParams as any)?.sourceTp1 === 'string'
      ? (riskParams as any).sourceTp1
      : null;
  const riskTp1Min = finiteNumber((riskParams as any)?.tp1Min);
  const riskTp1Max = finiteNumber((riskParams as any)?.tp1Max);
  const riskTp1Reason = typeof (riskParams as any)?.tp1Reason === 'string' ? (riskParams as any).tp1Reason : 'n/a';
  const executionRaw = String(trade.adapter ?? bs?.adapter ?? (cs as any)?.adapter ?? (bs as any)?.executionSource ?? '');
  const executionDisplay = resolveExecutionDisplay(executionRaw);
  const entryConfig = (bs as any)?.entryConfigSnapshot ?? null;
  const strategyAuditSnapshot = entryConfig?.strategyAuditSnapshot ?? (bs as any)?.strategyAuditSnapshot ?? null;
  const setupMetrics = strategyAuditSnapshot?.setupMetrics ?? [];
  const unifiedSignal = ((bs?.traderBrainDecision as any)?.ruleDecisionTrace?.unifiedSignal ?? {}) as Record<string, unknown>;
  const refPriceAtEntry = finiteNumber((bs as any)?.realMarketPriceAtBuy) ?? finiteNumber((bs as any)?.refPriceAtEntry) ?? entryPrice;
  const dipAtEntry = setupMetricNumber(setupMetrics, 'actualDipPct')
    ?? setupMetricNumber(setupMetrics, 'dipDepthPct')
    ?? finiteNumber(unifiedSignal.dipPercent);
  const reboundAtEntry = setupMetricNumber(setupMetrics, 'actualReboundPct')
    ?? finiteNumber(unifiedSignal.reboundPct);
  const trendAtEntry = bs?.groupTrend ?? bs?.groupRegime ?? marketTrendAtEntry ?? marketRegimeAtEntry ?? null;
  logger.info(`CLOSED_POSITION_ENTRY_SNAPSHOT_AUDIT: symbol=${trade.coin} tradeId=${trade.tradeId} sourceUsed=${bs ? 'buySnapshot.entryConfigSnapshot' : 'none'} rowSource=Journal/closedTrades snapshotPresent=${String(!!bs)} riskSnapshotPresent=${String(!!riskParams)} strategySnapshotPresent=${String(!!strategyAuditSnapshot)} entryPrice=${entryPrice} refPrice=${refPriceAtEntry ?? 'n/a'} lastPrice=${exitPrice} dipAtEntry=${dipAtEntry ?? 'n/a'} trendAtEntry=${trendAtEntry ?? 'n/a'} tp1Pct=${riskTp1Pct ?? 'n/a'} tp1TargetPrice=${riskTp1TargetPrice ?? 'n/a'} calculatedTp1Target=${riskTp1Pct != null ? entryPrice * (1 + riskTp1Pct / 100) : 'n/a'} displayedTp1Target=${riskTp1TargetPrice ?? 'n/a'} tp1Source=${riskTp1Source ?? riskSnapshotStatus} tp2Pct=${riskTp2Pct ?? 'n/a'} slPct=${riskSlPct ?? 'n/a'} owner=${sourceResolved.label} openedAt=${trade.entryTime ?? 'n/a'} hold=${durationLabel} rowUsesCandidateState=false rowUsesLegacyFallback=${String(!riskParams)} targetMatchesSnapshot=${String(riskTp1Pct != null && riskTp1TargetPrice != null ? Math.abs(riskTp1TargetPrice - (entryPrice * (1 + riskTp1Pct / 100))) <= Math.max(1e-10, Math.abs(riskTp1TargetPrice) * 1e-8) : false)}`);
  logger.info(`CLOSED_POSITION_RISK_SNAPSHOT_AUDIT: symbol=${trade.coin} tradeId=${trade.tradeId} riskGroup=${bs?.riskGroup ?? 'unknown'} confidence=${bs?.confidence ?? 'n/a'} strategy=${strategy} entryRule=${((bs?.traderBrainDecision as any)?.ruleDecisionTrace?.unifiedSignal?.reasonCode as string | undefined) ?? ((bs?.traderBrainDecision as any)?.selectedPlaybook as string | undefined) ?? (bs?.selectedPlaybook as string | undefined) ?? 'UNKNOWN_RULE'} entryPrice=${entryPrice} tp1Pct=${riskTp1Pct ?? 'n/a'} tp1TargetPrice=${riskTp1TargetPrice ?? 'n/a'} tp1Source=${riskTp1Source ?? riskSnapshotStatus} tp1Reason=${riskTp1Reason} tp1Min=${riskTp1Min ?? 'n/a'} tp1Max=${riskTp1Max ?? 'n/a'} tp2Pct=${riskTp2Pct ?? 'n/a'} slPct=${riskSlPct ?? 'n/a'} snapshotPresent=${String(!!bs)} riskSnapshotPresent=${String(!!riskParams)}`);
  if (!riskParams) {
    const legacyClosedSnapshot = closedSnapshotStatus === 'LEGACY_MISSING_SNAPSHOT' || riskSnapshotStatus === 'LEGACY_PRE_FIX';
    const legacyKey = `${trade.tradeId ?? trade.coin}:${trade.entryTime ?? 'unknown'}`;
    if (legacyClosedSnapshot) {
      const firstClassification = !_legacyClosedSnapshotClassified.has(legacyKey);
      _legacyClosedSnapshotClassified.add(legacyKey);
      logger.info(`LEGACY_TP1_SNAPSHOT_MISSING: symbol=${trade.coin} tradeId=${trade.tradeId} note=${riskSnapshotStatus} legacySnapshotStatus=LEGACY_INCOMPLETE_PRE_SNAPSHOT_SCHEMA firstClassification=${String(firstClassification)} / TP1 SNAPSHOT MISSING`);
    } else {
      logger.warn(`LEGACY_TP1_SNAPSHOT_MISSING: symbol=${trade.coin} tradeId=${trade.tradeId} note=${riskSnapshotStatus} legacySnapshotStatus=BUG_MISSING_SNAPSHOT_NEW_POSITION / TP1 SNAPSHOT MISSING`);
    }
  }
  return {
    id: trade.tradeId,
    symbol: trade.coin,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice ?? trade.entryPrice,
    pnlPct: trade.pnlPercent ?? 0,
    pnlUsd: trade.pnl ?? 0,
    closeReason: exitReasonRaw,
    exitReasonDisplay: resolvedExitReasonDisplay,
    dataQuality: toDataQuality(quality),
    mlEligibility: eligibility,
    strategy,
    openedAtLabel: trade.entryTime ?? 'n/a',
    closedAtLabel: trade.exitTime ?? trade.entryTime ?? 'n/a',
    durationLabel,
    closePriceQuality: cs?.executionQuality ?? 'PRICE_UNAVAILABLE',
    trainingEligible: trade.trainingEligible ?? false,
    ownerType: cs?.ownerType ?? 'unknown',
    sourceLabel: sourceResolved.label,
    sourcePresentation,
    modeLabel: bs?.mode ?? trade.mode ?? 'unknown',
    executionMode: executionDisplay.executionMode,
    executionAdapter: executionDisplay.executionAdapter,
    entryRule: ((bs?.traderBrainDecision as any)?.ruleDecisionTrace?.unifiedSignal?.reasonCode as string | undefined)
      ?? ((bs?.traderBrainDecision as any)?.selectedPlaybook as string | undefined)
      ?? (bs?.selectedPlaybook as string | undefined)
      ?? 'UNKNOWN_RULE',
    riskGroup: bs?.riskGroup ?? null,
    fees,
    feeUsdEntry: closedFeeAccounting.feeUsdEntry,
    feeUsdExit: closedFeeAccounting.feeUsdExit,
    feeUsdTotal: closedFeeAccounting.feeUsdTotal,
    feeRate: closedFeeAccounting.feeRate,
    feeSource: closedFeeAccounting.feeSource,
    operatorName: closedFeeAccounting.operatorName,
    grossPnlUsd: closedFeeAccounting.grossPnlUsd,
    netPnlUsd,
    closePriceSource: cs?.closePriceSource ?? null,
    closePriceAgeMs: Number.isFinite(cs?.closePriceAgeMs) ? cs?.closePriceAgeMs : null,
    realMarketPriceAtClose: Number.isFinite(cs?.realMarketPriceAtClose) ? cs?.realMarketPriceAtClose : null,
    refPriceAtEntry,
    tp1Pct: riskTp1Pct ?? (Number.isFinite(cs?.tp1Percent) && riskParams ? cs?.tp1Percent : null),
    tp1TargetPrice: riskTp1TargetPrice ?? (Number.isFinite((cs as any)?.tp1TargetPrice) && riskParams ? Number((cs as any).tp1TargetPrice) : null),
    tp1HitPrice: Number.isFinite((cs as any)?.tp1HitPrice) ? Number((cs as any).tp1HitPrice) : (cs?.exitReason === 'TP1_FIXED' ? exitPrice : null),
    tp1Source: riskTp1Source ?? (typeof (cs as any)?.tp1Source === 'string' && riskParams ? (cs as any).tp1Source : riskSnapshotStatus),
    riskSnapshotStatus,
    tp2Pct: riskTp2Pct ?? (Number.isFinite(cs?.tp2Percent) ? cs?.tp2Percent : null),
    slPct: riskSlPct ?? (Number.isFinite(cs?.stopLossPercent) ? cs?.stopLossPercent : null),
    trailStartPct: riskTrailStartPct ?? null,
    trailPullbackPct: riskTrailPullbackPct ?? (Number.isFinite(cs?.dynamicTrailAudit?.trailFromPeakPercent) ? cs?.dynamicTrailAudit?.trailFromPeakPercent : null),
    dipPct: dipAtEntry,
    reboundPct: reboundAtEntry,
    score: Number.isFinite(bs?.candidateRank) ? bs?.candidateRank ?? null : null,
    confidence: Number.isFinite(bs?.confidence) ? Math.round((bs?.confidence ?? 0) * 100) : null,
    hasSnapshot: !!bs || !!cs,
    marketTrendAtEntry,
    groupTrendAtEntry: trendAtEntry,
    marketRegimeAtEntry,
    btcContextAtEntry: bs?.btcRegime ?? null,
    dipReboundLabel: `${dipAtEntry != null ? `${dipAtEntry >= 0 ? '+' : ''}${dipAtEntry.toFixed(2)}%` : '--'} / ${reboundAtEntry != null ? `${reboundAtEntry >= 0 ? '+' : ''}${reboundAtEntry.toFixed(2)}%` : '--'}`,
    snapshotStatus: closedSnapshotStatus,
    snapshotMissingFields: bs ? [] : ['buySnapshot'],
    pnlBreakdown: {
      entryPrice,
      exitPrice,
      realMarketPriceAtClose: Number.isFinite(cs?.realMarketPriceAtClose) ? (cs?.realMarketPriceAtClose as number) : 0,
      closePriceSource: cs?.closePriceSource ?? 'unavailable',
      qty,
      usedCapital,
      grossPnlUsd,
      grossPnlPct,
      fees,
      feeUsdEntry: closedFeeAccounting.feeUsdEntry,
      feeUsdExit: closedFeeAccounting.feeUsdExit,
      feeUsdTotal: closedFeeAccounting.feeUsdTotal,
      feeRate: closedFeeAccounting.feeRate,
      feeSource: closedFeeAccounting.feeSource,
      operatorName: closedFeeAccounting.operatorName,
      netPnlUsd,
      netPnlPct,
      closeReason: cs?.exitReason ?? trade.status,
      priceQuality: cs?.executionQuality ?? 'unknown',
      formulaUsed,
    },
  };
}

export function buildTradeV4PageModel(input: {
  scannerSnapshot: ScannerSnapshot | null;
  positions: Position[];
  closedTrades: TradeRecord[];
  selectedSymbol: string | null;
  scannerRunning: boolean;
  engineOnline: boolean;
  mode: "PAPER" | "LIVE_LOCKED";
  capital: number;
  usedCapital: number;
  pnlToday: number;
  publicDataReady?: boolean;
  publicDataRefreshing?: boolean;
  dataQuality: "GOOD" | "MEDIUM" | "BAD" | "UNKNOWN";
  isOrderLocked?: (symbol: string) => boolean;
  btcAnchorEnabled?: boolean;
  ethAnchorEnabled?: boolean;
  paperAutoEnabled?: boolean;
  storeOpenPositionsCount?: number;
  positionManagerOpenCount?: number;
  headerPositionsCount?: number;
  openPanelRowsCount?: number;
  activeMode?: string;
  restoringOpenPositions?: boolean;
}): TradeV4PageModel {
  const rawCandidates = input.scannerSnapshot?.candidates ?? [];
  if (input.scannerSnapshot && rawCandidates.length > 0) {
    const finishedAtMs = Date.parse(input.scannerSnapshot.finishedAt ?? input.scannerSnapshot.startedAt ?? '');
    const scannerSnapshotAgeMs = Number.isFinite(finishedAtMs) ? Math.max(0, Date.now() - finishedAtMs) : 0;
    const sample = MarketDataFeed.getInstance().getCanonicalSymbolMarketData(rawCandidates[0].symbol);
    logger.throttled('INFO', `SCANNER_SNAPSHOT_VS_MARKET_FRESHNESS_AUDIT: scanId=${input.scannerSnapshot.scanId} scannerSnapshotAgeMs=${scannerSnapshotAgeMs} scannerSnapshotStale=${String(scannerSnapshotAgeMs > 60000)} canonicalPriceAgeMs=${sample.priceAgeMs} canonicalBookAgeMs=${sample.bookAgeMs} priceFresh=${String(sample.priceFresh)} bookFresh=${String(sample.bookFresh)} marketDataStale=${String(!sample.priceFresh || !sample.bookFresh)}`, `snapshot_vs_market_${input.scannerSnapshot.scanId}`, 10000);
  }
  const planDecisions = input.scannerSnapshot?.executionPlan?.decisions;
  const decisionsBySymbol: ReadonlyMap<string, import('../../core/scanner/executionDecision').ExecutionDecision> | undefined = planDecisions
    ? new Map(planDecisions.flatMap(d => {
        const decision = d as import('../../core/scanner/executionDecision').ExecutionDecision;
        return [[decision.symbol, decision], [`${decision.scanId}:${decision.symbol}`, decision]] as const;
      }))
    : undefined;
  const candidates = rawCandidates.map((c, index) =>
    mapScannerCandidateToTradeV4View(
      c,
      input.isOrderLocked ? input.isOrderLocked(c.symbol) : false,
      index < 10 || c.status === 'BUY' || (c.warnings ?? []).length > 0 ? 'full' : 'summary',
      decisionsBySymbol,
    ),
  );
  if (input.scannerSnapshot?.scanId) {
    let changedTrendCount = 0;
    let flatCount = 0;
    let bullishCount = 0;
    let bearishCount = 0;
    let unknownCount = 0;
    let fallbackFlatCount = 0;
    for (const c of candidates) {
      const prev = _lastTrendBySymbol.get(c.symbol);
      const curr = String(c.displayTrend ?? c.groupTrend ?? 'UNKNOWN');
      if (prev != null && prev !== curr) changedTrendCount++;
      _lastTrendBySymbol.set(c.symbol, curr);
      const t = curr.toLowerCase();
      if (t.includes('bull') || t.includes('up') || t.includes('rebound')) bullishCount++;
      else if (t.includes('bear') || t.includes('down')) bearishCount++;
      else if (t.includes('flat') || t.includes('sideways') || t.includes('range')) flatCount++;
      else if (t.includes('unknown') || t.includes('n/a')) unknownCount++;
      if ((t.includes('flat') || t.includes('sideways')) && c.displayTrendSource !== 'symbolTrend') fallbackFlatCount++;
    }
    logger.info(`TOP_CANDIDATE_TREND_REFRESH_AUDIT: scannerCycleId=${input.scannerSnapshot.scanId} candidateCount=${candidates.length} changedTrendCount=${changedTrendCount} flatCount=${flatCount} bullishCount=${bullishCount} bearishCount=${bearishCount} unknownCount=${unknownCount} lastUpdatedAt=${new Date().toISOString()}`);
    if (candidates.length > 0 && fallbackFlatCount === candidates.length) {
      logger.warn(`TOP_CANDIDATE_TREND_FLAT_FALLBACK_WARNING: scannerCycleId=${input.scannerSnapshot.scanId} candidateCount=${candidates.length} reason=all_rows_flat_from_fallback`);
    }
  }

  const openPositions = input.positions.map(mapPositionToOpenPositionView);
  const recentLogs = logger.getRecentLogs(2000);
  const storeOpenPositionsCount = input.storeOpenPositionsCount ?? openPositions.length;
  const positionManagerOpenCount = input.positionManagerOpenCount ?? openPositions.length;
  const headerPositionsCount = input.headerPositionsCount ?? openPositions.length;
  const openPanelRowsCount = input.openPanelRowsCount ?? openPositions.length;
  const filteredOutCount = Math.max(0, positionManagerOpenCount - openPositions.length);
  const rowSymbols = openPositions.map((p) => p.symbol).join('|') || 'none';
  const filterReasonCounts = filteredOutCount > 0 ? `unknown=${filteredOutCount}` : 'none';
  const executionMode = input.mode === 'PAPER' ? 'demo' : 'live';
  const auditSig = `${storeOpenPositionsCount}|${positionManagerOpenCount}|${headerPositionsCount}|${openPanelRowsCount}|${filteredOutCount}|${input.activeMode ?? 'AUTO'}|${executionMode}|${rowSymbols}|${filterReasonCounts}`;
  const now = Date.now();
  if (auditSig !== _lastOpenUiAuditSig || now - _lastOpenUiAuditAt >= 15000) {
    _lastOpenUiAuditSig = auditSig;
    _lastOpenUiAuditAt = now;
    logger.info(`OPEN_POSITIONS_UI_BINDING_AUDIT: storeOpenPositionsCount=${storeOpenPositionsCount} positionManagerOpenCount=${positionManagerOpenCount} headerPositionsCount=${headerPositionsCount} openPanelRowsCount=${openPanelRowsCount} filteredOutCount=${filteredOutCount} activeMode=${input.activeMode ?? 'AUTO'} executionMode=${executionMode} rowSymbols=${rowSymbols} filterReasonCounts=${filterReasonCounts}`);
    const rowsWithLivePrice = openPositions.filter(p => p.livePrice > 0 && p.livePrice !== p.entryPrice).length;
    const rowsWithPnlComputed = openPositions.filter(p => Math.abs(p.pnlPct) > 0.001 || p.livePrice !== p.entryPrice).length;
    const rowsWithStalePrice = openPositions.filter(p => p.livePrice <= 0 || p.livePrice === p.entryPrice).length;
    const rowsWithStrategyWait = openPositions.filter(p => (p.strategy ?? '').toLowerCase() === 'wait').length;
    logger.info(`OPEN_POSITIONS_UI_LIVE_BINDING_AUDIT: positionManagerOpenCount=${positionManagerOpenCount} uiRowCount=${openPositions.length} rowsWithLivePrice=${rowsWithLivePrice} rowsWithPnlComputed=${rowsWithPnlComputed} rowsWithStalePrice=${rowsWithStalePrice} rowsWithStrategyWait=${rowsWithStrategyWait} source=PositionManager refreshAgeMs=${now - (input.positions[0]?.openedAt ?? now)}`);
    const rowsWithZeroPnlButPriceMoved = openPositions.filter(p => {
      const livePrice = p.livePrice;
      const entryPrice = p.entryPrice ?? 0;
      const pnlPct = Math.abs(p.pnlPct ?? 0);
      const priceDiff = Math.abs(livePrice - entryPrice);
      return priceDiff > 0.0001 && pnlPct < 0.001 && entryPrice > 0 && livePrice > 0;
    });
    const symbolsWithZeroPnlButPriceMoved = rowsWithZeroPnlButPriceMoved.map(p => `${p.symbol}:entry=${p.entryPrice?.toFixed(6) ?? 'na'}:last=${p.livePrice?.toFixed(6) ?? 'na'}:pnl=${p.pnlPct?.toFixed(2) ?? 'na'}`).join('|') || 'none';
    if (rowsWithZeroPnlButPriceMoved.length > 0) {
      logger.warn(`OPEN_POSITIONS_UI_PNL_BINDING_AUDIT: positionManagerOpenCount=${positionManagerOpenCount} uiRowCount=${openPositions.length} rowsWithLivePrice=${rowsWithLivePrice} rowsWithPnlComputed=${rowsWithPnlComputed} rowsWithZeroPnlButPriceMoved=${rowsWithZeroPnlButPriceMoved.length} symbolsWithZeroPnlButPriceMoved=${symbolsWithZeroPnlButPriceMoved} source=PositionManager rowUsesStaticEntrySnapshot=${String(rowsWithStalePrice > 0)} rowUsesCandidateState=false`);
    }
  }
  const rowBindingMismatch = positionManagerOpenCount !== openPositions.length
    || storeOpenPositionsCount !== positionManagerOpenCount
    || headerPositionsCount !== openPositions.length
    || openPanelRowsCount !== openPositions.length;
  logger.info(`OPEN_POSITIONS_CANONICAL_SOURCE_AUDIT: canonicalSource=PositionManager positionsInputCount=${input.positions.length} mappedRowCount=${openPositions.length} storeOpenPositionsCount=${storeOpenPositionsCount} positionManagerOpenCount=${positionManagerOpenCount} headerPositionsCount=${headerPositionsCount} openPanelRowsCount=${openPanelRowsCount} rowBindingMismatch=${String(rowBindingMismatch)} rowSymbols=${rowSymbols}`);
  if (rowBindingMismatch) {
    logger.warn(`OPEN_POSITIONS_SOURCE_MISMATCH_WARNING: canonicalSource=PositionManager positionsInputCount=${input.positions.length} mappedRowCount=${openPositions.length} storeOpenPositionsCount=${storeOpenPositionsCount} positionManagerOpenCount=${positionManagerOpenCount} headerPositionsCount=${headerPositionsCount} openPanelRowsCount=${openPanelRowsCount} reason=open_positions_ui_binding_desync`);
  }
  const closedPositions = input.closedTrades.map(mapTradeRecordToClosedPositionView).slice(0, 100);
  const openMappedFields = ['symbol','state','strategy','qty','entryValue','entryPrice','refPrice','livePrice','dip','rebound','trend','pnlPct','unrealizedPnlUsd','tp1Pct','tp2Pct','slPct','stopTrigger','decision','owner','openedAt','hold'];
  const closedMappedFields = ['symbol','owner','strategy','mode','qty','entryValue','entryPrice','exitPrice','exitValue','realizedPnlPct','realizedPnlUsd','grossResult','openedAt','closedAt','hold','exitReason','refAtEntry','dipAtEntry','reboundAtEntry','trendAtEntry','notes'];
  if (openPositions.length > 0) {
    const sample = openPositions[0] as Record<string, unknown>;
    const missingOpen = openMappedFields.filter((f) => sample[f] == null && !['dip','rebound'].includes(f));
    logger.info(`OPEN_POSITIONS_V4_MAPPING_AUDIT: availableFields=${Object.keys(sample).join('|')} missingFields=${missingOpen.join('|') || 'none'} mappedFields=${openMappedFields.join('|')} legacyFallbackCount=${openPositions.filter((p) => p.snapshotStatus === 'LEGACY_MISSING_SNAPSHOT').length}`);
  }
  if (closedPositions.length > 0) {
    const sample = closedPositions[0] as Record<string, unknown>;
    const missingClosed = closedMappedFields.filter((f) => sample[f] == null);
    logger.info(`CLOSED_POSITIONS_V4_MAPPING_AUDIT: availableFields=${Object.keys(sample).join('|')} missingFields=${missingClosed.join('|') || 'none'} mappedFields=${closedMappedFields.join('|')} legacyFallbackCount=${closedPositions.filter((p) => p.snapshotStatus === 'LEGACY_MISSING_SNAPSHOT').length}`);
  }
  for (const o of openPositions) {
    const closed = closedPositions.find((c) => c.symbol === o.symbol);
    const closedSrc = closed?.sourceLabel ?? 'n/a';
    const mismatch = !!closed && closedSrc !== (o.sourceLabel ?? 'Unknown / Legacy');
    logger.info(`POSITION_SOURCE_DISPLAY_AUDIT: symbol=${o.symbol} openRowSource=${o.sourceLabel ?? 'Unknown / Legacy'} closedRowSource=${closedSrc} telegramSource=${o.sourceLabel ?? 'Unknown / Legacy'} entrySnapshotSource=${(o.diagnostic?.entryConfigSnapshot as any)?.source ?? 'unknown'} ownerType=${o.ownerType ?? 'unknown'} ownerName=${(o.diagnostic as any)?.source ?? 'unknown'} mismatch=${String(mismatch)}`);
    if (mismatch) {
      logger.warn(`POSITION_SOURCE_MISMATCH: symbol=${o.symbol} openRowSource=${o.sourceLabel ?? 'Unknown / Legacy'} closedRowSource=${closedSrc}`);
    }
  }
  if (input.selectedSymbol) {
    const selected = openPositions.find((p) => p.symbol === input.selectedSymbol);
    if (selected) {
      logger.info(`POSITION_DIAGNOSTIC_AUDIT: symbol=${selected.symbol} positionId=${selected.id} createdAt=${selected.openedAtLabel} source=${selected.ownerType} mode=${selected.mode} entryPrice=${selected.entryPrice} livePrice=${selected.livePrice} qty=${selected.quantity} usedCapital=${selected.usedCapitalUsd} strategy=${selected.strategy} entryRule=${selected.entryRule} tp1=${selected.tp1Pct ?? 'n/a'} tp2=${selected.tp2Pct ?? 'n/a'} sl=${selected.slPct ?? 'n/a'} autoBotsOnAtEntry=${String((selected.strategySource ?? '').toLowerCase() === 'autobots')} userSettingsSnapshotAtEntry=${selected.hasSnapshot ? 'present' : 'missing'} entryConfigSnapshot=${selected.hasSnapshot ? 'present' : 'missing'} strategyAuditSnapshot=${selected.hasSnapshot ? 'present_or_partial' : 'missing'} pnlCalc=pnlUsd=(live-entry)*qty;net=gross-fees priceSource=${selected.livePriceSource} warnings=${selected.snapshotStatus !== 'VALID_SNAPSHOT' ? selected.snapshotStatus : 'none'}`);
    }
  }
  const missingSnapshot = openPositions.filter((p) => !p.hasSnapshot);
  const missingTpSl = openPositions.filter((p) => p.tp1Pct == null || p.slPct == null);
  const withTpSl = openPositions.length - missingTpSl.length;
  const withDipReboundCount = openPositions.filter((p) => p.dipPct != null || p.reboundPct != null).length;
  const withLivePrice = openPositions.filter((p) => p.livePrice > 0);
  const pendingPrice = openPositions.filter((p) => p.priceQuality === 'pending');
  const unavailablePrice = openPositions.filter((p) => p.priceQuality === 'unavailable');
  const staleOpenPositionPrice = openPositions.filter((p) => p.priceQuality === 'stale' || p.priceQuality === 'fallback' || p.priceQuality === 'unavailable');
  const displayAuditSig = `${openPositions.length}|${missingSnapshot.length}|${withTpSl}|${missingTpSl.length}|${withDipReboundCount}|${withLivePrice.length}|${pendingPrice.length}|${unavailablePrice.length}|${missingSnapshot.map((p) => p.symbol).join('|')}|${missingTpSl.map((p) => p.symbol).join('|')}|${unavailablePrice.map((p) => p.symbol).join('|')}`;
  if (displayAuditSig !== _lastOpenDisplayAuditSig || now - _lastOpenDisplayAuditAt >= 15000) {
    _lastOpenDisplayAuditSig = displayAuditSig;
    _lastOpenDisplayAuditAt = now;
    logger.info(`OPEN_POSITION_DISPLAY_DATA_AUDIT: openCount=${openPositions.length} withEntrySnapshotCount=${openPositions.length - missingSnapshot.length} missingSnapshotCount=${missingSnapshot.length} withTpSlCount=${withTpSl} missingTpSlCount=${missingTpSl.length} withDipReboundCount=${withDipReboundCount} withLivePriceCount=${withLivePrice.length} pricePendingCount=${pendingPrice.length} priceUnavailableCount=${unavailablePrice.length} legacyFallbackCount=${missingSnapshot.length} symbolsMissingSnapshot=${missingSnapshot.map((p) => p.symbol).join('|') || 'none'} symbolsMissingTpSl=${missingTpSl.map((p) => p.symbol).join('|') || 'none'} symbolsPriceUnavailable=${unavailablePrice.map((p) => p.symbol).join('|') || 'none'}`);
  }
  const statusCounts = openPositions.reduce<Record<string, number>>((acc, p) => {
    const k = p.snapshotStatus ?? 'VALID_SNAPSHOT';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  logger.info(`POSITION_SNAPSHOT_STATUS_AUDIT: openCount=${openPositions.length} VALID_SNAPSHOT=${statusCounts.VALID_SNAPSHOT ?? 0} LEGACY_MISSING_SNAPSHOT=${statusCounts.LEGACY_MISSING_SNAPSHOT ?? 0} BUG_MISSING_SNAPSHOT_NEW_POSITION=${statusCounts.BUG_MISSING_SNAPSHOT_NEW_POSITION ?? 0} PARTIAL_SNAPSHOT=${statusCounts.PARTIAL_SNAPSHOT ?? 0}`);
  const runtimeHealth: NonNullable<TradeV4PageModel["runtimeHealth"]> = {
    dbOk: !recentLogs.some((log) => /database health check failed|PERSISTENCE_LOAD_TRADES_FAILED|POSITION_PERSISTENCE_WRITE_AUDIT.*writeSuccess=false/i.test(log.message)),
    scannerRunning: input.scannerRunning,
    binanceRequestFailCount: recentLogs.filter((log) => /BINANCE|PUBLIC_DATA|MarketDataFeed/i.test(log.message) && /fail|error|offline/i.test(log.message)).length,
    stalePriceCount: openPositions.filter((p) => p.priceQuality === 'stale' || p.priceQuality === 'fallback').length,
    staleOpenPositionPriceCount: staleOpenPositionPrice.length,
    missingSnapshotCount: missingSnapshot.length,
    persistenceErrorCount: recentLogs.filter((log) => /PERSISTENCE|POSITION_PERSISTENCE|storage|localStorage|database/i.test(log.message) && /fail|error|writeSuccess=false/i.test(log.message)).length,
    telegramFailureCount: recentLogs.filter((log) => /TELEGRAM/i.test(log.message) && /FAIL|ERROR|NOT_CONFIGURED/i.test(log.message)).length,
    fallbackPriceCount: openPositions.filter((p) => p.priceQuality === 'fallback').length,
    unavailablePriceCount: unavailablePrice.length,
  };
  logger.info(`RUNTIME_HEALTH_SUMMARY_AUDIT: dbOk=${String(runtimeHealth.dbOk)} scannerRunning=${String(runtimeHealth.scannerRunning)} binanceRequestFailCount=${runtimeHealth.binanceRequestFailCount} stalePriceCount=${runtimeHealth.stalePriceCount} staleOpenPositionPriceCount=${runtimeHealth.staleOpenPositionPriceCount} missingSnapshotCount=${runtimeHealth.missingSnapshotCount} persistenceErrorCount=${runtimeHealth.persistenceErrorCount} telegramFailureCount=${runtimeHealth.telegramFailureCount}`);

  const snap = input.scannerSnapshot;
  if (snap && snap.scanId !== _lastLoggedScanId) {
    _lastLoggedScanId = snap.scanId;
    const hasConfidence = candidates.filter(c => c.confidence > 0).length;
    const hasScore = candidates.filter(c => c.score != null && c.score > 0).length;
    const hasStrategy = candidates.filter(c => c.strategy && c.strategy !== 'none').length;
    const hasGroupTrend = candidates.filter(c => c.groupTrend && c.groupTrend !== 'n/a').length;
    const hasExecutionPlan = Boolean(snap.executionPlan);
    const confSources = new Map<string, number>();
    for (const c of candidates) {
      confSources.set(c.confidenceSource, (confSources.get(c.confidenceSource) || 0) + 1);
    }
    const sourceSummary = Array.from(confSources.entries()).map(([k, v]) => `${k}=${v}`).join(' ');
    logger.info(`AIR_SCANNER_DATA_ADAPTER_SUMMARY: candidates=${candidates.length} hasConfidence=${hasConfidence} missingConfidence=${candidates.length - hasConfidence} hasScore=${hasScore} missingScore=${candidates.length - hasScore} hasStrategy=${hasStrategy} hasGroupTrend=${hasGroupTrend} hasExecutionPlan=${hasExecutionPlan} confidenceSource=${sourceSummary}`);
  }
  const rawCandidateCount = input.scannerSnapshot?.candidates?.length ?? 0;
  const displayedTopCandidatesCount = candidates.slice(0, 15).length;
  const scannerStateHydrated = rawCandidateCount > 0 || !!input.scannerSnapshot;
  const filterReasons = rawCandidateCount > 0 && candidates.length === 0 ? 'adapter_filtering_removed_all' : 'none';
  const activeFilters = 'none';
  const topAuditSig = `${input.scannerRunning}|${rawCandidateCount}|${candidates.length}|${displayedTopCandidatesCount}|${filterReasons}|${activeFilters}|${input.scannerSnapshot?.scanId ?? 'none'}`;
  if (topAuditSig !== _lastTopCandidatesAuditSig || now - _lastTopCandidatesAuditAt >= 15000) {
    _lastTopCandidatesAuditSig = topAuditSig;
    _lastTopCandidatesAuditAt = now;
    logger.info(`TOP_CANDIDATES_DISPLAY_AUDIT: scannerRunning=${String(input.scannerRunning)} scannerCandidateCount=${rawCandidateCount} rawCandidateCount=${rawCandidateCount} filteredCandidateCount=${candidates.length} displayedTopCandidatesCount=${displayedTopCandidatesCount} filterReasons=${filterReasons} activeFilters=${activeFilters} source=tradeV4DataAdapter lastScanAt=${input.scannerSnapshot?.finishedAt ?? 'none'} scannerStateHydrated=${String(scannerStateHydrated)}`);
  }
  const lastScanAt = snap?.finishedAt ?? null;
  const engineReviewCount = snap?.executionPoolSize
    ?? candidates.filter((c) => c.finalExecutable === true || c.buyAllowed === true).length;
  const canonicalScannerStatus: "RUNNING" | "WAITING" | "STOPPED" = input.scannerRunning
    ? "RUNNING"
    : (lastScanAt ? "WAITING" : "STOPPED");
  const capitalUsedPct = input.capital > 0 ? Math.round((input.usedCapital / input.capital) * 100) : 0;
  const dipperCardState = {
    sourceUsed: snap ? "scanner_snapshot+runtime_store" : "runtime_store_fallback",
    lastCanonicalUpdateAt: lastScanAt,
    scannerStatus: canonicalScannerStatus,
    candidateCount: candidates.length,
    engineReviewCount,
    openPositionsCount: openPositions.length,
    closedTodayCount: closedPositions.length,
    marketTrend: snap?.marketPeriodTrend ?? null,
    btcContext: snap?.btcPeriodTrend ?? null,
    ethContext: snap?.ethPeriodTrend ?? null,
    strategyRef: snap?.autoStrategySummary?.referencePeriod ?? snap?.referencePeriod ?? "1h",
    capitalUsedPct,
    availableCapital: input.capital - input.usedCapital,
  } satisfies NonNullable<TradeV4PageModel["dipperCardState"]>;
  const dipperAuditSig = `${dipperCardState.sourceUsed}|${dipperCardState.lastCanonicalUpdateAt ?? 'none'}|${dipperCardState.scannerStatus}|${dipperCardState.candidateCount}|${dipperCardState.engineReviewCount}|${dipperCardState.openPositionsCount}|${dipperCardState.closedTodayCount}|${dipperCardState.marketTrend ?? 'n/a'}|${dipperCardState.btcContext ?? 'n/a'}|${dipperCardState.ethContext ?? 'n/a'}|${dipperCardState.strategyRef}|${dipperCardState.capitalUsedPct}|${dipperCardState.availableCapital.toFixed(2)}`;
  if (dipperAuditSig !== _lastDipperCardAuditSig || now - _lastDipperCardAuditAt >= 10000) {
    _lastDipperCardAuditSig = dipperAuditSig;
    _lastDipperCardAuditAt = now;
    logger.info(`DIPPER_CARD_DATA_SOURCE_AUDIT: sourceUsed=${dipperCardState.sourceUsed} scannerStatus=${dipperCardState.scannerStatus} lastCanonicalUpdateAt=${dipperCardState.lastCanonicalUpdateAt ?? 'none'} candidateCount=${dipperCardState.candidateCount} engineReviewCount=${dipperCardState.engineReviewCount} openPositionsCount=${dipperCardState.openPositionsCount} closedTodayCount=${dipperCardState.closedTodayCount} marketTrend=${dipperCardState.marketTrend ?? 'n/a'} btcContext=${dipperCardState.btcContext ?? 'n/a'} ethContext=${dipperCardState.ethContext ?? 'n/a'} strategyRef=${dipperCardState.strategyRef} capitalUsedPct=${dipperCardState.capitalUsedPct} available=${dipperCardState.availableCapital.toFixed(2)}`);
    const lastCanonicalTs = dipperCardState.lastCanonicalUpdateAt ? Date.parse(dipperCardState.lastCanonicalUpdateAt) : NaN;
    const staleDurationMs = Number.isFinite(lastCanonicalTs) ? Math.max(0, now - lastCanonicalTs) : -1;
    logger.info(`DIPPER_CARD_STALE_DATA_AUDIT: uiValue=pending_render canonicalValue=${dipperAuditSig} sourceUsed=${dipperCardState.sourceUsed} lastUiUpdateAt=pending_render lastCanonicalUpdateAt=${dipperCardState.lastCanonicalUpdateAt ?? 'none'} staleDurationMs=${staleDurationMs} changedFields=adapter_snapshot renderReason=model_refresh`);
  }
  return {
    candidates,
    openPositions,
    restoringOpenPositions: input.restoringOpenPositions ?? false,
    closedPositions,
    selectedSymbol: input.selectedSymbol,
    scannerRunning: input.scannerRunning,
    engineOnline: input.engineOnline,
    mode: input.mode,
    capital: input.capital,
    usedCapital: input.usedCapital,
    pnlToday: input.pnlToday,
    dataQuality: input.dataQuality,
    runtimeHealth,
    publicDataReady: input.publicDataReady ?? false,
    publicDataRefreshing: input.publicDataRefreshing ?? false,
    lastScanAt,
    dipperCardState,
    referencePeriod: snap?.referencePeriod,
    marketPeriodTrend: snap?.marketPeriodTrend ?? null,
    marketPeriodChangePct: snap?.marketPeriodChangePct ?? null,
    marketPeriodVolatility: snap?.marketPeriodVolatility ?? null,
    btcPeriodTrend: snap?.btcPeriodTrend ?? null,
    ethPeriodTrend: snap?.ethPeriodTrend ?? null,
    executionPoolSize: snap?.executionPoolSize,
    watchPoolSize: snap?.watchPoolSize,
    nearMissPoolSize: snap?.nearMissPoolSize,
    topExecutionCandidates: snap?.topExecutionCandidates,
    topWatchCandidates: snap?.topWatchCandidates,
    emptyUniverseReason: snap?.emptyUniverseReason,
    paperAutoEnabled: input.paperAutoEnabled ?? snap?.paperAutoEnabled,
    paperAutoResult: snap?.paperAutoResult,
    autoStrategySummary: snap?.autoStrategySummary,
    executionPlan: snap?.executionPlan,
    btcAnchorEnabled: input.btcAnchorEnabled,
    ethAnchorEnabled: input.ethAnchorEnabled,
    noBuyDisplay: snap?.noBuySummary ? {
      executionPoolSize: snap.noBuySummary.executionPoolSize,
      watchPoolSize: snap.noBuySummary.watchPoolSize,
      nearMissPoolSize: snap.noBuySummary.nearMissPoolSize,
      topReasons: snap.noBuySummary.topReasons,
      nearestCandidates: snap.noBuySummary.nearestCandidates,
      requiredNextActions: snap.noBuySummary.requiredNextActions,
      marketAction: snap.noBuySummary.marketAction,
      bestFit: snap.noBuySummary.bestFit,
      htf: snap.noBuySummary.htf,
      primary: snap.noBuySummary.primary,
      ltf: snap.noBuySummary.ltf,
      marketConfidence: snap.noBuySummary.marketConfidence,
      marketBias: snap.noBuySummary.marketBias,
      topBlockers: snap.noBuySummary.topBlockers,
      requiredNextCondition: snap.noBuySummary.requiredNextCondition,
      momentumPockets: snap.noBuySummary.momentumPockets,
      topMomentum: snap.noBuySummary.topMomentum,
      topHighRiskMomentum: snap.noBuySummary.topHighRiskMomentum,
      topVeryHighRiskMomentum: snap.noBuySummary.topVeryHighRiskMomentum,
      buyReadyCount: snap.noBuySummary.buyReadyCount,
      buyCandidateCount: snap.noBuySummary.buyCandidateCount,
      actionableBuyCountNow: snap.noBuySummary.actionableBuyCountNow,
      blockedByPacingCount: snap.noBuySummary.blockedByPacingCount,
      blockedByCooldownCount: snap.noBuySummary.blockedByCooldownCount,
      blockedByBudgetCount: snap.noBuySummary.blockedByBudgetCount,
      blockedByDuplicateCount: snap.noBuySummary.blockedByDuplicateCount,
      blockedByRiskCount: snap.noBuySummary.blockedByRiskCount,
      blockedByOpenPositionLimitCount: snap.noBuySummary.blockedByOpenPositionLimitCount,
      maxExecutionQueuePerScan: snap.noBuySummary.maxExecutionQueuePerScan,
      executionQueueAcceptedCount: snap.noBuySummary.executionQueueAcceptedCount,
      deferredByQueueLimitCount: snap.noBuySummary.deferredByQueueLimitCount,
      queueRejectedCount: snap.noBuySummary.queueRejectedCount,
      queueAcceptedSymbols: snap.noBuySummary.queueAcceptedSymbols,
      deferredByQueueLimitSymbols: snap.noBuySummary.deferredByQueueLimitSymbols,
      queueRejectedReasons: snap.noBuySummary.queueRejectedReasons,
      nextQueueRetry: snap.noBuySummary.nextQueueRetry,
      selectedButNotSubmittedCount: snap.noBuySummary.selectedButNotSubmittedCount,
      submitAttemptedCount: snap.noBuySummary.submitAttemptedCount,
      selectedButNotSubmittedReasons: snap.noBuySummary.selectedButNotSubmittedReasons,
      lastBuyAt: snap.noBuySummary.lastBuyAt,
      minBuyIntervalMs: snap.noBuySummary.minBuyIntervalMs,
      cooldownUntil: snap.noBuySummary.cooldownUntil,
      nextBuyAllowedAt: snap.noBuySummary.nextBuyAllowedAt,
      msUntilNextBuyAllowed: snap.noBuySummary.msUntilNextBuyAllowed,
      buyPacingActive: snap.noBuySummary.buyPacingActive,
      buyCooldownActive: snap.noBuySummary.buyCooldownActive,
      buyPacingReason: snap.noBuySummary.buyPacingReason,
      countSourceUsed: snap.noBuySummary.countSourceUsed,
      blockedCount: snap.noBuySummary.blockedCount,
      blockedBySpread: snap.noBuySummary.blockedBySpread,
      blockedBySlippage: snap.noBuySummary.blockedBySlippage,
      blockedByDip: snap.noBuySummary.blockedByDip,
      blockedByRebound: snap.noBuySummary.blockedByRebound,
      blockedByMomentum: snap.noBuySummary.blockedByMomentum,
      blockedByTpRoom: snap.noBuySummary.blockedByTpRoom,
      blockedByTp1Invalid: snap.noBuySummary.blockedByTp1Invalid,
      blockedByFinalExecutableFalse: snap.noBuySummary.blockedByFinalExecutableFalse,
      selectedForExecutionCount: snap.noBuySummary.selectedForExecutionCount,
      finalNoBuyReason: snap.noBuySummary.finalNoBuyReason,
    } : undefined,
  };
}
