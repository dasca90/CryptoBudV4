import type { Position, TradeRecord } from '../types';
import { logger } from '../../utils/logger';

type SourceResolved = {
  label: 'AutoBots' | 'The Dipper / Scanner' | 'Unicorn' | 'ML Predict Buy' | 'Micro Scalping' | 'Manual' | 'Unknown / Legacy';
  executionPath: string;
  ownerType: string;
  ownerName: string;
  strategySource: string;
  candidateSource: string;
};

export type TradeSourceBadgeVariant = 'autobots' | 'unicorn' | 'ml' | 'manual' | 'micro' | 'unknown';

export type TradeSourcePresentation = {
  icon: string;
  shortLabel: string;
  fullLabel: string;
  compactLabel: string;
  badgeVariant: TradeSourceBadgeVariant;
  canonicalLabel: SourceResolved['label'];
  executionPath: string;
};

const fallbackAuditKeys = new Set<string>();

function normalize(v: unknown): string {
  return String(v ?? '').trim();
}

function mapSourceToLabel(source: string): SourceResolved['label'] | null {
  const s = source.toLowerCase();
  if (!s) return null;
  // V6 retired the former parallel scanner. Historical rows are presented as
  // AutoBots so old journals and restored positions stay readable without
  // reintroducing a retired owner in the UI.
  if (s.includes('unicorn')) return 'AutoBots';
  if (s === 'ml' || s.includes('ml_predict_buy') || s.includes('ml predict') || s.includes('ml-buy')) return 'ML Predict Buy';
  if (s.includes('manual')) return 'Manual';
  if (s.includes('micro') || s.includes('scalp')) return 'Micro Scalping';
  if (s.includes('autobots')) return 'AutoBots';
  if (s.includes('scanner') || s.includes('dipper')) return 'The Dipper / Scanner';
  return null;
}

function firstMapped(values: string[]): SourceResolved['label'] | null {
  for (const v of values) {
    const m = mapSourceToLabel(v);
    if (m) return m;
  }
  return null;
}

function nested(row: any, path: string): unknown {
  return path.split('.').reduce((current, key) => current == null ? undefined : current[key], row);
}

export function resolveTradeSourceLabel(input: Position | TradeRecord | Record<string, unknown> | null | undefined): SourceResolved {
  const row: any = input ?? {};
  const bs: any = row.buySnapshot ?? {};
  const close: any = row.closeSnapshot ?? {};
  const entryConfig = bs?.entryConfigSnapshot ?? {};
  const settings = bs?.settingsSnapshot ?? {};
  const scannerEntryConfig = row.scannerAutoEntryConfigSnapshot ?? {};
  const runtimeSnapshot = row.runtimeSnapshot ?? {};
  const autoStrategyDecision = row.autoStrategyDecision ?? {};
  let chosen: SourceResolved['label'] = 'Unknown / Legacy';
  let executionPath = 'unknown_runtime_source';
  // Strict ownership-first classification:
  // 1) Explicit owner/source from entry snapshot and position row
  // 2) Candidate/execution hints
  // 3) Settings fallback only for true legacy gaps
  const ownershipCandidates = [
    normalize(bs.source),
    normalize(row.source),
    normalize(close.source),
    normalize(bs.sourceOwner),
    normalize(row.sourceOwner),
    normalize(close.sourceOwner),
    normalize(runtimeSnapshot.sourceOwner),
    normalize(bs.ownerName),
    normalize(row.ownerName),
    normalize(close.ownerName),
    normalize(bs.ownerType),
    normalize(row.ownerType),
    normalize(close.ownerType),
  ].filter(Boolean);
  const ownershipMapped = firstMapped(ownershipCandidates);
  if (ownershipMapped) {
    chosen = ownershipMapped;
    executionPath = ownershipCandidates.find((s) => mapSourceToLabel(s) === ownershipMapped) ?? executionPath;
  } else {
    const executionCandidates = [
      normalize(bs.candidateSource),
      normalize(row.candidateSource),
      normalize(close.candidateSource),
      normalize(bs.executionSource),
      normalize(row.executionSource),
      normalize(close.executionSource),
      normalize(entryConfig.source),
      normalize(entryConfig.strategySource),
      normalize(scannerEntryConfig.source),
      normalize(scannerEntryConfig.candidateSource),
      normalize(scannerEntryConfig.strategySource),
      normalize(row.strategySource),
      normalize(bs.strategySource),
      normalize(close.strategySource),
      normalize(autoStrategyDecision.strategySource),
      normalize(nested(row, 'strategyDecision.source')),
      normalize(nested(row, 'strategyDecision.strategySource')),
    ].filter(Boolean);
    const executionMapped = firstMapped(executionCandidates);
    if (executionMapped) {
      chosen = executionMapped;
      executionPath = executionCandidates.find((s) => mapSourceToLabel(s) === executionMapped) ?? executionPath;
    } else {
      const settingsCandidates = [
        normalize(settings.source),
        normalize(settings.strategySource),
      ].filter(Boolean);
      const settingsMapped = firstMapped(settingsCandidates);
      if (settingsMapped) {
        chosen = settingsMapped;
        executionPath = settingsCandidates.find((s) => mapSourceToLabel(s) === settingsMapped) ?? executionPath;
      }
    }
  }

  const resolved: SourceResolved = {
    label: chosen,
    executionPath,
    ownerType: normalize(row.ownerType || bs.ownerType || close.ownerType) || 'unknown',
    ownerName: normalize(row.ownerName || bs.ownerName || close.ownerName) || 'unknown',
    strategySource: normalize(row.strategySource || autoStrategyDecision.strategySource || scannerEntryConfig.strategySource || settings.strategySource || entryConfig.strategySource || bs.strategySource || close.strategySource) || 'unknown',
    candidateSource: normalize(row.candidateSource || bs.candidateSource || close.candidateSource || scannerEntryConfig.candidateSource || row.source || bs.source) || 'unknown',
  };

  return resolved;
}

export function getTradeSourcePresentation(input: Position | TradeRecord | Record<string, unknown> | SourceResolved | null | undefined): TradeSourcePresentation {
  const resolved = input && typeof input === 'object' && 'label' in input && 'executionPath' in input
    ? input as SourceResolved
    : resolveTradeSourceLabel(input as Position | TradeRecord | Record<string, unknown> | null | undefined);
  const label = resolved.label;
  let presentation: Omit<TradeSourcePresentation, 'canonicalLabel' | 'executionPath'>;
  if (label === 'ML Predict Buy') {
    presentation = { icon: 'ML', shortLabel: 'ML BUY', fullLabel: 'ML Predict Buy', compactLabel: 'ML BUY', badgeVariant: 'ml' };
  } else if (label === 'AutoBots' || label === 'The Dipper / Scanner' || label === 'Unicorn') {
    presentation = { icon: '\uD83E\uDD16', shortLabel: 'AUTOBOTS', fullLabel: '\uD83E\uDD16 AutoBots', compactLabel: '\uD83E\uDD16 AUTOBOTS', badgeVariant: 'autobots' };
  } else if (label === 'Manual') {
    presentation = { icon: '\u270B', shortLabel: 'MANUAL', fullLabel: '\u270B Manual', compactLabel: '\u270B MANUAL', badgeVariant: 'manual' };
  } else if (label === 'Micro Scalping') {
    presentation = { icon: '\u26A1', shortLabel: 'MICRO', fullLabel: '\u26A1 Micro Scalping', compactLabel: '\u26A1 MICRO', badgeVariant: 'micro' };
  } else {
    presentation = { icon: '?', shortLabel: 'UNKNOWN', fullLabel: 'Unknown / Legacy', compactLabel: 'UNKNOWN', badgeVariant: 'unknown' };
    const key = `${resolved.executionPath}|${resolved.ownerType}|${resolved.ownerName}|${resolved.strategySource}|${resolved.candidateSource}`;
    if (!fallbackAuditKeys.has(key)) {
      fallbackAuditKeys.add(key);
      logger.warn(`SOURCE_PRESENTATION_FALLBACK_AUDIT sourceLabel=${resolved.label} executionPath=${resolved.executionPath} ownerType=${resolved.ownerType} ownerName=${resolved.ownerName} strategySource=${resolved.strategySource} candidateSource=${resolved.candidateSource}`);
    }
  }
  return { ...presentation, canonicalLabel: label, executionPath: resolved.executionPath };
}

export function logTradeSourceResolved(event: string, symbol: string, input: Position | TradeRecord | Record<string, unknown> | null | undefined): SourceResolved {
  const r = resolveTradeSourceLabel(input);
  logger.info(
    `TRADE_SOURCE_LABEL_RESOLVED: event=${event} symbol=${symbol} telegramSourceLabel=${r.label} ownerType=${r.ownerType} ownerName=${r.ownerName} strategySource=${r.strategySource} candidateSource=${r.candidateSource} executionPath=${r.executionPath}`
  );
  return r;
}
