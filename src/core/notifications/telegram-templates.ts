import type { ScannerCandidate, TradeRecord } from '../types';
import { getTradeSourcePresentation, logTradeSourceResolved } from './trade-source';
import { logger } from '../../utils/logger';

function sanitizeTelegramText(input: unknown): string {
  return String(input ?? 'N/A')
    .replace(/(api[_-]?key|api[_-]?secret|bot[_-]?token|token|secret)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/[<>{}`[\]]/g, '')
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\b(?:undefined|null|NaN)\b|\[object Object\]|\?\?/gi, 'N/A')
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
function formatTelegramMoney(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'N/A';
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function telegramHeaderOwner(source: ReturnType<typeof logTradeSourceResolved>, fallbackCompactLabel: string): string {
  if (source.label === 'AutoBots' || source.label === 'The Dipper / Scanner') return '🤖 AUTOBOTS';
  return fallbackCompactLabel;
}

function formatTelegramTp2(v: unknown): string {
  const value = finiteNumber(v);
  return value && value > 0 ? formatTelegramPct(value) : '0% / disabled';
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
  const sourcePresentation = getTradeSourcePresentation(source);
  const headerOwner = telegramHeaderOwner(source, sourcePresentation.compactLabel);
  const bs: any = trade.buySnapshot ?? {};
  logger.info(`TELEGRAM_SOURCE_AUDIT: event=BUY_OPENED symbol=${trade.coin} sourceLabel=${source.label} ownerType=${source.ownerType} ownerName=${source.ownerName} strategySource=${source.strategySource} candidateSource=${source.candidateSource} executionPath=${source.executionPath}`);

  if (source.label === 'Micro Scalping' && !String(bs?.ownerType ?? '').toLowerCase().includes('micro') && !String(bs?.strategySource ?? '').toLowerCase().includes('micro')) {
    logger.warn(`MICRO_NOTIFICATION_SOURCE_MISMATCH: symbol=${trade.coin} reason=telegram_buy_source_mismatch source=${source.label}`);
  }

  const risk = getEntryRiskSnapshot(trade, 'BUY_OPENED', source.label);
  const tp1 = risk.riskSnapshotPresent ? risk.tp1Pct : null;
  const tp2 = risk.riskSnapshotPresent ? risk.tp2Pct : null;
  const sl = risk.riskSnapshotPresent ? risk.slPct : null;
  const feeUsdEntry = finiteNumber((trade as any).feeUsdEntry) ?? finiteNumber(bs?.feeUsdEntry) ?? finiteNumber(bs?.paperExecutionReport?.fee) ?? 0;
  const operatorName = sanitizeTelegramText((trade as any).operatorName ?? bs?.operatorName ?? (trade.adapter === 'Paper' ? 'Paper exchange simulator' : trade.adapter));

  return [
    `🟦 ${headerOwner} BUY OPENED`,
    '',
    `📌 Symbol: ${sanitizeTelegramText(trade.coin)}`,
    `🧪 Mode: ${sanitizeTelegramText(trade.adapter === 'Paper' ? 'Demo' : trade.adapter)}`,
    '',
    '🧠 Strategy',
    `• Selected: ${setup.strategy}`,
    `• Entry rule: ${setup.entryRule}`,
    '',
    '🎯 Plan',
    `• Entry: ${formatTelegramPrice(trade.entryPrice)}`,
    `• Qty: ${formatTelegramNumber(trade.quantity, 4)}`,
    `• Used: ${formatTelegramNumber(trade.entryPrice * trade.quantity, 2)} USDT`,
    `• Entry fee paid: ${formatTelegramMoney(feeUsdEntry)}`,
    `• Operator/Exchange: ${operatorName}`,
    `• TP1: ${risk.riskSnapshotPresent ? formatTelegramPct(tp1) : 'SNAPSHOT_MISSING'}`,
    `• TP2: ${formatTelegramTp2(tp2)}`,
    `• SL: ${risk.riskSnapshotPresent ? `-${formatTelegramNumber(sl, 2)}%` : 'SNAPSHOT_MISSING'}`,
    '',
    '📍 Status',
    'Entry confirmed. Position monitoring.',
  ].map(sanitizeTelegramText).join('\n');
}

export function formatSellNotification(trade: TradeRecord): string {
  const setup = getSetup(trade);
  const source = logTradeSourceResolved('SELL_CLOSED', trade.coin, trade);
  const sourcePresentation = getTradeSourcePresentation(source);
  const headerOwner = telegramHeaderOwner(source, sourcePresentation.compactLabel);
  const close: any = trade.closeSnapshot ?? {};
  const bs: any = trade.buySnapshot ?? {};
  logger.info(`TELEGRAM_SOURCE_AUDIT: event=SELL_CLOSED symbol=${trade.coin} sourceLabel=${source.label} ownerType=${source.ownerType} ownerName=${source.ownerName} strategySource=${source.strategySource} candidateSource=${source.candidateSource} executionPath=${source.executionPath}`);

  if (source.label === 'Micro Scalping' && !String(bs?.ownerType ?? '').toLowerCase().includes('micro') && !String(bs?.strategySource ?? '').toLowerCase().includes('micro')) {
    logger.warn(`MICRO_NOTIFICATION_SOURCE_MISMATCH: symbol=${trade.coin} reason=telegram_sell_source_mismatch source=${source.label}`);
  }

  const grossPnlUsd = finiteNumber((trade as any).grossPnlUsd) ?? finiteNumber(close?.grossPnlUsd) ?? Number(trade.pnl ?? 0);
  const feeUsdEntry = finiteNumber((trade as any).feeUsdEntry) ?? finiteNumber(close?.feeUsdEntry) ?? finiteNumber(bs?.feeUsdEntry) ?? 0;
  const feeUsdExit = finiteNumber((trade as any).feeUsdExit) ?? finiteNumber(close?.feeUsdExit) ?? 0;
  const fees = finiteNumber((trade as any).feeUsdTotal) ?? finiteNumber(close?.feeUsdTotal) ?? Number(close?.fees ?? 0);
  const netPnl = finiteNumber((trade as any).netPnlUsd) ?? finiteNumber(close?.netPnlUsd) ?? (grossPnlUsd - fees);
  const operatorName = sanitizeTelegramText((trade as any).operatorName ?? close?.operatorName ?? bs?.operatorName ?? (trade.adapter === 'Paper' ? 'Paper exchange simulator' : trade.adapter));
  const pnlPct = Number(trade.pnlPercent ?? 0);
  const effectiveNetPnl = Number.isFinite(netPnl) ? netPnl : grossPnlUsd;
  const sellOutcome = effectiveNetPnl > 0.0001 ? 'profit' : effectiveNetPnl < -0.0001 ? 'loss' : 'breakeven';
  const sellIcon = sellOutcome === 'profit' ? '🟩' : sellOutcome === 'loss' ? '🔴' : '🟨';
  const sourceSellLabel = `SELL ${sellOutcome === 'profit' ? 'PROFIT' : sellOutcome === 'loss' ? 'LOSS' : 'BREAKEVEN'}`;
  logger.info(`TELEGRAM_SELL_STATUS_RESOLVED: symbol=${trade.coin} reason=${close?.exitReason ?? 'n/a'} grossPnlUsdt=${grossPnlUsd} feesUsdt=${fees} netPnlUsdt=${netPnl} pnlPct=${pnlPct} resolvedOutcome=${sellOutcome} resolvedIcon=${sellIcon} resolvedLabel=${sourceSellLabel}`);
  const risk = getEntryRiskSnapshot(trade, 'SELL_CLOSED', source.label);
  const tp1 = risk.tp1Pct ?? finiteNumber(close?.tp1Percent);
  const tp2 = risk.tp2Pct ?? finiteNumber(close?.tp2Percent);
  const sl = risk.slPct ?? finiteNumber(close?.stopLossPercent);

  return [
    `${sellIcon} ${headerOwner} ${sourceSellLabel}`,
    '',
    `📌 Symbol: ${sanitizeTelegramText(trade.coin)}`,
    `🧪 Mode: ${sanitizeTelegramText(trade.adapter === 'Paper' ? 'Demo' : trade.adapter)}`,
    '',
    '📉 Result',
    `• Reason: ${sanitizeTelegramText(close?.exitReason ?? 'UNKNOWN')}`,
    `• Strategy at entry: ${setup.strategy}`,
    '',
    `• Qty: ${formatTelegramNumber(trade.quantity, 4)}`,
    `• Used: ${formatTelegramNumber(trade.entryPrice * trade.quantity, 2)} USDT`,
    '',
    '📊 PnL',
    `• PnL: ${Number(trade.pnlPercent ?? 0) >= 0 ? '+' : ''}${formatTelegramPct(trade.pnlPercent ?? 0)}`,
    `• Gross PnL: ${formatTelegramMoney(grossPnlUsd)}`,
    `• Fees: ${formatTelegramMoney(fees)} (entry ${formatTelegramMoney(feeUsdEntry)}, exit ${formatTelegramMoney(feeUsdExit)})`,
    `• Net PnL: ${formatTelegramMoney(netPnl)}`,
    `• Operator/Exchange: ${operatorName}`,
    '',
    '🎯 Original plan',
    `• TP1: ${formatTelegramPct(tp1)}`,
    `• TP2: ${formatTelegramTp2(tp2)}`,
    `• SL: -${formatTelegramNumber(sl, 2)}%`,
    '',
    '📍 Status',
    sellOutcome === 'loss' ? 'Loss controlled by plan.' : 'Trade closed by plan.',
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
