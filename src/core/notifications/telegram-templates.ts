import type { ScannerCandidate, TradeRecord } from '../types';
import { logTradeSourceResolved } from './trade-source';
import { logger } from '../../utils/logger';

function sanitizeTelegramText(input: unknown): string {
  return String(input ?? 'N/A')
    .replace(/(api[_-]?key|api[_-]?secret|bot[_-]?token|token|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[<>{}`[\]]/g, '')
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/undefined|null|NaN|\[object Object\]|\?\?/gi, 'N/A')
    .trim();
}

function formatTelegramNumber(v: unknown, digits = 2): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : 'N/A';
}
function formatTelegramPct(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)}%` : 'N/A';
}
function formatTelegramPrice(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : 'N/A';
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function getEntryRiskSnapshot(trade: TradeRecord, event: 'BUY_OPENED' | 'SELL_CLOSED', sourceLabel: string) {
  const bs: any = trade.buySnapshot ?? {};
  const riskParams = bs?.entryConfigSnapshot?.riskParams ?? bs?.settingsSnapshot?.entryConfigSnapshot?.riskParams ?? null;
  const riskSnapshotPresent = !!riskParams;
  const tp1Pct = finiteNumber(riskParams?.tp1Pct);
  const tp1TargetPrice = finiteNumber(riskParams?.tp1TargetPrice);
  const tp2Pct = finiteNumber(riskParams?.tp2Pct);
  const slPct = finiteNumber(riskParams?.slPct);
  const tp1Min = finiteNumber(riskParams?.tp1Min);
  const tp1Max = finiteNumber(riskParams?.tp1Max);
  const tp1Reason = typeof riskParams?.tp1Reason === 'string' ? riskParams.tp1Reason : 'n/a';
  const tp1Source = typeof riskParams?.tp1Source === 'string'
    ? riskParams.tp1Source
    : typeof riskParams?.sourceTp1 === 'string'
      ? riskParams.sourceTp1
      : null;
  const slSource = typeof riskParams?.slSource === 'string'
    ? riskParams.slSource
    : typeof riskParams?.sourceSl === 'string'
      ? riskParams.sourceSl
      : null;
  const sourceUsed = riskSnapshotPresent ? 'entryConfigSnapshot.riskParams' : 'SNAPSHOT_MISSING';
  logger.info(`TELEGRAM_${event}_RISK_SNAPSHOT_AUDIT: symbol=${trade.coin} riskGroup=${bs?.riskGroup ?? 'unknown'} confidence=${bs?.confidence ?? 'n/a'} strategy=${bs?.selectedStrategy ?? trade.strategy ?? 'unknown'} entryRule=${bs?.selectedPlaybook ?? bs?.settingsSnapshot?.entryRule ?? 'unknown'} owner=${sanitizeTelegramText(bs?.ownerName ?? bs?.ownerType ?? sourceLabel)} source=${sanitizeTelegramText(bs?.source ?? bs?.strategySource ?? sourceLabel)} entryPrice=${trade.entryPrice} tp1Pct=${tp1Pct ?? 'n/a'} tp1TargetPrice=${tp1TargetPrice ?? 'n/a'} tp1Source=${tp1Source ?? 'n/a'} tp1Reason=${sanitizeTelegramText(tp1Reason)} tp1Min=${tp1Min ?? 'n/a'} tp1Max=${tp1Max ?? 'n/a'} tp2Pct=${tp2Pct ?? 'n/a'} slPct=${slPct ?? 'n/a'} slSource=${slSource ?? 'n/a'} snapshotPresent=${String(!!bs)} riskSnapshotPresent=${String(riskSnapshotPresent)} sourceUsed=${sourceUsed}`);
  if (!riskSnapshotPresent) {
    logger.warn(`TELEGRAM_RISK_SNAPSHOT_MISSING_WARNING: event=${event} symbol=${trade.coin} sourceUsed=SNAPSHOT_MISSING message=Telegram will not silently display TP1=0`);
  }
  return {
    riskSnapshotPresent,
    sourceUsed,
    tp1Pct,
    tp1TargetPrice,
    tp1Source,
    tp2Pct,
    slPct,
    slSource,
  };
}

function getSetup(trade: TradeRecord) {
  const bs: any = trade.buySnapshot ?? {};
  const audit = bs?.entryConfigSnapshot?.strategyAuditSnapshot ?? bs?.strategyAuditSnapshot ?? null;
  const manualSetup = bs?.entryConfigSnapshot?.manualDipperSetupSnapshot ?? null;
  const metrics = Array.isArray(audit?.setupMetrics) ? audit.setupMetrics : [];
  const requiredItems = Array.isArray(audit?.setupRequired) ? audit.setupRequired : [];
  const byKey = new Map<string, any>(metrics.map((m: any) => [String(m.key), m]));
  const reqByKey = new Map<string, any>(requiredItems.map((m: any) => [String(m.key), m]));

  const dip = byKey.get('actualDipPct')?.actualValue ?? reqByKey.get('dipConfirmed')?.actualValue ?? null;
  const dipReq = byKey.get('requiredDipPct')?.requiredValue ?? reqByKey.get('dipConfirmed')?.requiredValue ?? null;
  const dipRole = byKey.get('actualDipPct')?.role ?? (reqByKey.get('dipConfirmed')?.required ? 'required' : 'advisory');

  const rebound = byKey.get('actualReboundPct')?.actualValue ?? reqByKey.get('reboundConfirmed')?.actualValue ?? null;
  const reboundReq = byKey.get('requiredReboundPct')?.requiredValue ?? reqByKey.get('reboundConfirmed')?.requiredValue ?? null;
  const reboundRole = byKey.get('actualReboundPct')?.role ?? (reqByKey.get('reboundConfirmed')?.required ? 'required' : 'advisory');

  const momentumConfirmed = byKey.get('momentumConfirmed')?.actualValue
    ?? (typeof reqByKey.get('momentumConfirmed')?.passed === 'boolean' ? reqByKey.get('momentumConfirmed').passed : null);

  const momentum5m = byKey.get('momentum5m')?.actualValue ?? null;
  const momentum15m = byKey.get('momentum15m')?.actualValue ?? null;
  const momentum1h = byKey.get('momentum1h')?.actualValue ?? null;

  const rawEntryRule = sanitizeTelegramText(audit?.finalEntryRule ?? bs?.selectedPlaybook ?? 'legacy_unknown');
  const entryRule = rawEntryRule.toUpperCase().includes('WAITING_FOR_SETUP') ? 'legacy_unknown' : rawEntryRule;

  const setupResultFromAudit = sanitizeTelegramText(audit?.setupResult ?? '');
  const setupResult = setupResultFromAudit
    || (Array.isArray(audit?.setupMissing) && audit.setupMissing.length > 0
      ? `MISSING: ${audit.setupMissing.map((s: any) => String(s?.key ?? s)).join(', ')}`
      : 'SETUP_OK');

  const fallbackDipLine = manualSetup
    ? `${formatTelegramPct((manualSetup as any)?.actualDip)} / required: ${formatTelegramPct((manualSetup as any)?.dipRequired)} (required)`
    : 'N/A / required: N/A (advisory)';
  const fallbackReboundLine = manualSetup
    ? `${formatTelegramPct((manualSetup as any)?.actualRebound)} / required: ${formatTelegramPct((manualSetup as any)?.reboundRequired)} (required)`
    : 'N/A / required: N/A (advisory)';

  return {
    strategy: sanitizeTelegramText(bs?.selectedStrategy ?? trade.strategy ?? 'UNKNOWN'),
    entryRule,
    why: sanitizeTelegramText(audit?.entryReason ?? bs?.whySelectedOverOthers ?? 'n/a'),
    dipLine: (dip != null || dipReq != null) ? `${formatTelegramPct(dip)} / required: ${formatTelegramPct(dipReq)} (${sanitizeTelegramText(dipRole)})` : fallbackDipLine,
    reboundLine: (rebound != null || reboundReq != null) ? `${formatTelegramPct(rebound)} / required: ${formatTelegramPct(reboundReq)} (${sanitizeTelegramText(reboundRole)})` : fallbackReboundLine,
    momentum: momentumConfirmed === true ? 'OK ✅' : momentumConfirmed === false ? 'MISS ❌' : 'N/A',
    momentumTf: `${formatTelegramPct(momentum5m)} / ${formatTelegramPct(momentum15m)} / ${formatTelegramPct(momentum1h)}`,
    setupResult,
    finalExecutable: String(audit?.finalExecutableAtEntry ?? audit?.finalExecutable ?? 'N/A'),
  };
}

export function formatBuyNotification(trade: TradeRecord): string {
  const setup = getSetup(trade);
  const source = logTradeSourceResolved('BUY_OPENED', trade.coin, trade);
  const bs: any = trade.buySnapshot ?? {};
  logger.info(`TELEGRAM_SOURCE_AUDIT: event=BUY_OPENED symbol=${trade.coin} sourceLabel=${source.label} ownerType=${source.ownerType} ownerName=${source.ownerName} strategySource=${source.strategySource} candidateSource=${source.candidateSource} executionPath=${source.executionPath}`);

  if (source.label === 'Micro Scalping' && !String(bs?.ownerType ?? '').toLowerCase().includes('micro') && !String(bs?.strategySource ?? '').toLowerCase().includes('micro')) {
    logger.warn(`MICRO_NOTIFICATION_SOURCE_MISMATCH: symbol=${trade.coin} reason=telegram_buy_source_mismatch source=${source.label}`);
  }

  const risk = getEntryRiskSnapshot(trade, 'BUY_OPENED', source.label);
  const tp1 = risk.riskSnapshotPresent ? risk.tp1Pct : null;
  const tp2 = risk.riskSnapshotPresent ? risk.tp2Pct : null;
  const sl = risk.riskSnapshotPresent ? risk.slPct : null;

  return [
    '🟢 BUY OPENED',
    `📌 Symbol: ${sanitizeTelegramText(trade.coin)}`,
    `🧪 Mode: ${sanitizeTelegramText(trade.adapter === 'Paper' ? 'Demo' : trade.adapter)}`,
    `🤖 Source: ${source.label}`,
    '',
    '🧠 Strategy',
    `• Selected: ${setup.strategy}`,
    `• Entry rule: ${setup.entryRule}`,
    `• Why: ${setup.why}`,
    '',
    '📊 Setup',
    `• Dip: ${setup.dipLine}`,
    `• Rebound: ${setup.reboundLine}`,
    `• Momentum: ${setup.momentum}`,
    `• Momentum TF (5m/15m/1h): ${setup.momentumTf}`,
    `• Setup result: ${setup.setupResult}`,
    `• Final executable: ${setup.finalExecutable}`,
    '',
    '🎯 Plan',
    `• Entry: ${formatTelegramPrice(trade.entryPrice)}`,
    `• Qty: ${formatTelegramNumber(trade.quantity, 4)}`,
    `• Used: ${formatTelegramNumber(trade.entryPrice * trade.quantity, 2)} USDT`,
    `• TP1: ${risk.riskSnapshotPresent ? formatTelegramPct(tp1) : 'SNAPSHOT_MISSING'}`,
    `• TP1 target: ${risk.riskSnapshotPresent ? formatTelegramPrice(risk.tp1TargetPrice) : 'SNAPSHOT_MISSING'}`,
    `• TP1 source: ${risk.riskSnapshotPresent ? sanitizeTelegramText(risk.tp1Source) : 'SNAPSHOT_MISSING'}`,
    `• TP2: ${tp2 ? formatTelegramPct(tp2) : '0% / disabled'}`,
    `• SL: ${risk.riskSnapshotPresent ? `-${formatTelegramNumber(sl, 2)}%` : 'SNAPSHOT_MISSING'}`,
    '',
    '📍 Status',
    'Entry confirmed. Position monitoring.',
  ].map(sanitizeTelegramText).join('\n');
}

export function formatSellNotification(trade: TradeRecord): string {
  const setup = getSetup(trade);
  const source = logTradeSourceResolved('SELL_CLOSED', trade.coin, trade);
  const close: any = trade.closeSnapshot ?? {};
  const bs: any = trade.buySnapshot ?? {};
  logger.info(`TELEGRAM_SOURCE_AUDIT: event=SELL_CLOSED symbol=${trade.coin} sourceLabel=${source.label} ownerType=${source.ownerType} ownerName=${source.ownerName} strategySource=${source.strategySource} candidateSource=${source.candidateSource} executionPath=${source.executionPath}`);

  if (source.label === 'Micro Scalping' && !String(bs?.ownerType ?? '').toLowerCase().includes('micro') && !String(bs?.strategySource ?? '').toLowerCase().includes('micro')) {
    logger.warn(`MICRO_NOTIFICATION_SOURCE_MISMATCH: symbol=${trade.coin} reason=telegram_sell_source_mismatch source=${source.label}`);
  }

  const exitPrice = trade.exitPrice ?? close?.exitPrice ?? 0;
  const pnlUsd = Number(trade.pnl ?? 0);
  const fees = Number(close?.fees ?? 0);
  const netPnl = pnlUsd - fees;
  const pnlPct = Number(trade.pnlPercent ?? 0);
  const effectiveNetPnl = Number.isFinite(netPnl) ? netPnl : pnlUsd;
  const effectivePnlPct = Number.isFinite(netPnl) ? (netPnl / (Math.abs(trade.entryPrice * trade.quantity) || 1)) * 100 : pnlPct;
  const sellOutcome = effectiveNetPnl > 0.0001 ? 'profit' : effectiveNetPnl < -0.0001 ? 'loss' : 'breakeven';
  const sellIcon = sellOutcome === 'profit' ? '🟩' : sellOutcome === 'loss' ? '🔴' : '🟨';
  const sellLabel = `SELL CLOSED ${sellOutcome === 'profit' ? 'PROFIT' : sellOutcome === 'loss' ? 'LOSS' : 'BREAKEVEN'}`;
  logger.info(`TELEGRAM_SELL_STATUS_RESOLVED: symbol=${trade.coin} reason=${close?.exitReason ?? 'n/a'} netPnlUsdt=${netPnl} pnlUsdt=${pnlUsd} pnlPct=${pnlPct} resolvedOutcome=${sellOutcome} resolvedIcon=${sellIcon} resolvedLabel=${sellLabel}`);
  const risk = getEntryRiskSnapshot(trade, 'SELL_CLOSED', source.label);
  const tp1 = risk.tp1Pct ?? finiteNumber(close?.tp1Percent);
  const tp2 = risk.tp2Pct ?? finiteNumber(close?.tp2Percent);
  const sl = risk.slPct ?? finiteNumber(close?.stopLossPercent);
  const tp1TargetPrice = risk.tp1TargetPrice ?? finiteNumber(close?.tp1TargetPrice);
  const tp1HitPrice = close?.tp1HitPrice ?? (close?.exitReason === 'TP1_FIXED' ? exitPrice : null);
  const durationSec = typeof close?.durationMs === 'number' ? Math.max(0, Math.floor(close.durationMs / 1000)) : null;

  return [
    `${sellIcon} ${sellLabel}`,
    `📌 Symbol: ${sanitizeTelegramText(trade.coin)}`,
    `🧪 Mode: ${sanitizeTelegramText(trade.adapter === 'Paper' ? 'Demo' : trade.adapter)}`,
    `🤖 Source: ${source.label}`,
    '',
    '📉 Result',
    `• Reason: ${sanitizeTelegramText(close?.exitReason ?? 'UNKNOWN')}`,
    `• Strategy at entry: ${setup.strategy}`,
    `• Entry rule: ${setup.entryRule}`,
    '',
    '💰 Prices',
    `• Entry: ${formatTelegramPrice(trade.entryPrice)}`,
    `• Exit: ${formatTelegramPrice(exitPrice)}`,
    `• Qty: ${formatTelegramNumber(trade.quantity, 4)}`,
    `• Used: ${formatTelegramNumber(trade.entryPrice * trade.quantity, 2)} USDT`,
    '',
    '📊 PnL',
    `• PnL: ${Number(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${formatTelegramPct(trade.pnlPercent ?? 0)}`,
    `• PnL USDT: ${formatTelegramNumber(pnlUsd, 2)}`,
    `• Fees: ${formatTelegramNumber(fees, 2)}`,
    `• Net: ${formatTelegramNumber(netPnl, 2)}`,
    '• Formula: (exit - entry) × qty',
    '',
    '🎯 TP1 Audit',
    `• TP1 used: ${formatTelegramPct(tp1)}`,
    `• TP1 target: ${formatTelegramPrice(tp1TargetPrice)}`,
    `• Hit price: ${formatTelegramPrice(tp1HitPrice)}`,
    `• Duration: ${durationSec != null ? `${durationSec}s` : 'N/A'}`,
    `• Source: ${sanitizeTelegramText(close?.closePriceSource ?? 'N/A')}`,
    '',
    '🧠 Setup at entry',
    `• Dip: ${setup.dipLine}`,
    `• Rebound: ${setup.reboundLine}`,
    `• Momentum: ${setup.momentum}`,
    `• Setup result: ${setup.setupResult}`,
    `• Final executable: ${setup.finalExecutable}`,
    '',
    '🎯 Original plan',
    `• TP1: ${formatTelegramPct(tp1)}`,
    `• TP2: ${tp2 ? formatTelegramPct(tp2) : '0% / disabled'}`,
    `• SL: -${formatTelegramNumber(sl, 2)}%`,
    '',
    '📍 Status',
    Number(trade.pnlPercent ?? 0) < 0 ? 'Loss controlled by plan.' : 'Trade closed by plan.',
  ].map(sanitizeTelegramText).join('\n');
}

export function formatWaitBlockNotification(candidateOrDecision: Pick<ScannerCandidate, 'symbol' | 'selectedStrategy' | 'confidence' | 'mainReason' | 'requiredNextActions'>): string {
  const needs = (candidateOrDecision.requiredNextActions ?? []).slice(0, 5);
  return [
    'WAIT',
    `Symbol: ${sanitizeTelegramText(candidateOrDecision.symbol)}`,
    `Strategy: ${sanitizeTelegramText(candidateOrDecision.selectedStrategy)}`,
    `Confidence: ${Math.round((candidateOrDecision.confidence ?? 0) * 100)}%`,
    `Reason: ${sanitizeTelegramText(candidateOrDecision.mainReason)}`,
    `Needs: ${(needs.length > 0 ? needs.map(sanitizeTelegramText).join(', ') : 'wait for confirmation')}`,
  ].join('\n');
}

export function formatErrorNotification(error: { module?: string; message?: string; time?: string | number | Date }): string {
  const time = error.time ? new Date(error.time).toISOString() : new Date().toISOString();
  return ['ERROR', `Module: ${sanitizeTelegramText(error.module)}`, `Message: ${sanitizeTelegramText(error.message)}`, `Time: ${time}`].join('\n');
}

export function sanitizeTelegramMessage(text: string): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => sanitizeTelegramText(line))
    .join('\n');
}
