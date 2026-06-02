import type { Position, TradeRecord } from '../types';
import { logger } from '../../utils/logger';

type SourceResolved = {
  label: 'AutoBots' | 'The Dipper / Scanner' | 'Micro Scalping' | 'Manual' | 'Unknown / Legacy';
  executionPath: string;
  ownerType: string;
  ownerName: string;
  strategySource: string;
  candidateSource: string;
};

function normalize(v: unknown): string {
  return String(v ?? '').trim();
}

function mapSourceToLabel(source: string): SourceResolved['label'] | null {
  const s = source.toLowerCase();
  if (!s) return null;
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

export function resolveTradeSourceLabel(input: Position | TradeRecord | Record<string, unknown> | null | undefined): SourceResolved {
  const row: any = input ?? {};
  const bs: any = row.buySnapshot ?? {};
  const close: any = row.closeSnapshot ?? {};
  const entryConfig = bs?.entryConfigSnapshot ?? {};
  const settings = bs?.settingsSnapshot ?? {};
  let chosen: SourceResolved['label'] = 'Unknown / Legacy';
  let executionPath = 'legacy_fallback';
  // Strict ownership-first classification:
  // 1) Explicit owner/source from entry snapshot and position row
  // 2) Candidate/execution hints
  // 3) Settings fallback only for true legacy gaps
  const ownershipCandidates = [
    normalize(bs.source),
    normalize(row.source),
    normalize(close.source),
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
      normalize(bs.executionSource),
      normalize(entryConfig.source),
      normalize(entryConfig.strategySource),
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
    strategySource: normalize(settings.strategySource || entryConfig.strategySource || bs.strategySource) || 'unknown',
    candidateSource: normalize(bs.candidateSource || row.candidateSource || bs.source) || 'unknown',
  };

  return resolved;
}

export function logTradeSourceResolved(event: string, symbol: string, input: Position | TradeRecord | Record<string, unknown> | null | undefined): SourceResolved {
  const r = resolveTradeSourceLabel(input);
  logger.info(
    `TRADE_SOURCE_LABEL_RESOLVED: event=${event} symbol=${symbol} telegramSourceLabel=${r.label} ownerType=${r.ownerType} ownerName=${r.ownerName} strategySource=${r.strategySource} candidateSource=${r.candidateSource} executionPath=${r.executionPath}`
  );
  return r;
}
