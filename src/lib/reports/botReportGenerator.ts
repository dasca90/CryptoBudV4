import type { TradeRecord } from '../../core/types';
import type { LogEntry } from '../../utils/logger';

export type BotReportWindowHours = 12 | 24;
export type ReportValue = number | string | null;

export interface ReportBreakdownRow {
  key: string;
  label: string;
  buys: number;
  sells: number;
  wins: number;
  losses: number;
  pnlUsd: number | null;
  avgPnlUsd: number | null;
  bestTrade: string | null;
  worstTrade: string | null;
  avgHoldMs: number | null;
  avgScore?: number | null;
}

export interface BotReport {
  windowHours: BotReportWindowHours;
  startTime: string;
  endTime: string;
  generatedAt: string;
  mode: 'PAPER' | 'LIVE' | 'mixed' | 'Unavailable';
  summary: {
    autobotsStatus: string;
    microScalperStatus: string;
    entryConfirmationMode: string;
    anchorStatus: string;
  };
  performance: {
    tradesOpened: number;
    tradesClosed: number;
    currentlyOpen: number;
    winningClosedTrades: number;
    losingClosedTrades: number;
    winRatePct: number | null;
    realizedPnlUsd: number | null;
    realizedGrossPnlUsd: number | null;
    realizedNetPnlUsd: number | null;
    realizedPnlPct: number | null;
    openUnrealizedPnlUsd: number | null;
    bestTrade: string | null;
    worstTrade: string | null;
    avgHoldMs: number | null;
    fastestSellMs: number | null;
    longestTradeMs: number | null;
    feesUsd: number | null;
  };
  strategyBreakdown: ReportBreakdownRow[];
  riskGroupBreakdown: ReportBreakdownRow[];
  professionalAnalysis: {
    candidatesAnalyzed: number | null;
    strongBuyCount: number | null;
    waitCount: number | null;
    avoidCount: number | null;
    averageProfessionalScore: number | null;
    blockedByScoreThreshold: number | null;
    blockedByProfessionalVerdict: number | null;
    blockedByAnchor: number | null;
    blockedByStalePrice: number | null;
    blockedBySpread: number | null;
    blockedByNoTpRoom: number | null;
    topApprovalReasons: Array<{ reason: string; count: number }>;
    topBlockers: Array<{ reason: string; count: number }>;
  };
  scannerPipeline: {
    scanCycles: number | null;
    candidatesScanned: number | null;
    candidatesPromoted: number | null;
    candidatesBlocked: number | null;
    entryApprovedCount: number | null;
    buyApprovedCount: number | null;
    buyBlockedCount: number | null;
    commonBlockers: Array<{ reason: string; count: number }>;
  };
  appHealth: {
    uptime: string;
    warningsCount: number;
    errorsCount: number;
    stalePriceEvents: number;
    missingSnapshotEvents: number;
    persistenceErrors: number;
    rejectedOrders: number;
    failedTelegramNotifications: number;
    performanceWarnings: number;
    staleOpenPositionPriceEvents: number;
    fallbackPriceEvents: number;
    unavailablePriceEvents: number;
  };
  dataAudit: {
    tradesFound: number;
    closedTradesFound: number;
    logsFound: number;
    scannerEventsFound: number;
    missingDataSources: string[];
  };
  conclusion: string;
  notEnoughData: boolean;
}

interface GenerateBotReportInput {
  windowHours: BotReportWindowHours;
  trades: TradeRecord[];
  logs: LogEntry[];
  generatedAt?: string;
}

const STRATEGY_KEYS = ['momentum', 'balanced', 'dip_and_rebound', 'conservative', 'micro_scalper', 'unknown'] as const;
const RISK_GROUP_KEYS = ['top_caps', 'large_caps', 'mid_caps', 'high_risk', 'very_high_risk', 'unknown'] as const;

const BLOCKER_PATTERNS: Array<{ reason: string; patterns: RegExp[] }> = [
  { reason: 'spread too high', patterns: [/spread.*too high/i, /BLOCK_SPREAD_TOO_HIGH/i] },
  { reason: 'no TP room', patterns: [/no tp room/i, /BLOCK_NO_TP_ROOM/i] },
  { reason: 'stale price', patterns: [/stale price/i, /BLOCK_PRICE_STALE/i, /price.*stale/i] },
  { reason: 'momentum not confirmed', patterns: [/momentum.*not confirmed/i, /BLOCK_MOMENTUM_NOT_CONFIRMED/i] },
  { reason: 'waiting for safe pullback', patterns: [/safe pullback/i, /pullback/i] },
  { reason: 'BTC/ETH anchor block', patterns: [/anchor.*block/i, /btc.*dump/i, /eth.*dump/i, /BLOCK_BTC_DUMP/i] },
  { reason: 'duplicate/open-position block', patterns: [/duplicate/i, /open.position/i, /BLOCK_DUPLICATE_POSITION/i] },
  { reason: 'capital/max-position block', patterns: [/max positions/i, /capital/i, /BLOCK_MAX_POSITIONS/i, /BLOCK_CAPITAL_LIMIT/i] },
  { reason: 'risk-group cap block', patterns: [/risk.group.*cap/i, /group exposure/i, /RISK_GROUP_EXPOSURE_LIMIT/i] },
];

function parseTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isInsideWindow(timestamp: string | undefined, startMs: number, endMs: number): boolean {
  const time = parseTime(timestamp);
  return Number.isFinite(time) && time >= startMs && time <= endMs;
}

function sum(values: Array<number | undefined | null>): number | null {
  const real = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (real.length === 0) return null;
  return real.reduce((total, value) => total + value, 0);
}

function avg(values: Array<number | undefined | null>): number | null {
  const total = sum(values);
  const count = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).length;
  return total === null || count === 0 ? null : total / count;
}

function getHoldMs(trade: TradeRecord): number | null {
  if (typeof trade.closeSnapshot?.durationMs === 'number' && Number.isFinite(trade.closeSnapshot.durationMs)) {
    return trade.closeSnapshot.durationMs;
  }
  const entry = parseTime(trade.entryTime);
  const exit = parseTime(trade.exitTime);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry) return null;
  return exit - entry;
}

function formatMoney(value: number | null): string {
  if (value === null) return 'Unavailable';
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return 'Unavailable';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatReportDuration(ms: number | null): string {
  if (ms === null) return 'Unavailable';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function labelTrade(trade: TradeRecord | null): string | null {
  if (!trade) return null;
  const pnlValue = tradeNetPnlUsd(trade);
  const pnl = typeof pnlValue === 'number' ? ` ${formatMoney(pnlValue)}` : '';
  return `${trade.coin}${pnl}`;
}

function normalizeStrategy(trade: TradeRecord): typeof STRATEGY_KEYS[number] {
  if (trade.buySnapshot?.scalperCandidateId || trade.mode === 'SCALPER') return 'micro_scalper';
  const raw = [
    trade.strategy,
    trade.buySnapshot?.selectedStrategy,
    trade.closeSnapshot?.effectiveStrategy,
    trade.closeSnapshot?.entryStrategy,
  ].find(Boolean)?.toLowerCase() ?? '';
  if (raw.includes('momentum')) return 'momentum';
  if (raw.includes('balanced')) return 'balanced';
  if (raw.includes('dip') || raw.includes('rebound')) return 'dip_and_rebound';
  if (raw.includes('conservative')) return 'conservative';
  if (raw.includes('scalp')) return 'micro_scalper';
  return 'unknown';
}

function normalizeRiskGroup(trade: TradeRecord): typeof RISK_GROUP_KEYS[number] {
  const raw = (trade.buySnapshot?.riskGroup ?? trade.closeSnapshot?.riskGroup ?? '').toLowerCase();
  if (raw.includes('top')) return 'top_caps';
  if (raw.includes('large')) return 'large_caps';
  if (raw.includes('mid')) return 'mid_caps';
  if (raw.includes('very') && raw.includes('high')) return 'very_high_risk';
  if (raw.includes('high')) return 'high_risk';
  return 'unknown';
}

function detectMode(trades: TradeRecord[]): BotReport['mode'] {
  const adapters = new Set(trades.map((trade) => trade.adapter.toLowerCase()));
  const hasPaper = [...adapters].some((adapter) => adapter.includes('paper') || adapter.includes('demo'));
  const hasLive = [...adapters].some((adapter) => adapter.includes('live') || adapter.includes('binance'));
  if (hasPaper && hasLive) return 'mixed';
  if (hasLive) return 'LIVE';
  if (hasPaper) return 'PAPER';
  return trades.length > 0 ? 'Unavailable' : 'Unavailable';
}

function latestMatchingLog(logs: LogEntry[], patterns: RegExp[]): string {
  for (let index = logs.length - 1; index >= 0; index--) {
    const message = logs[index]?.message ?? '';
    if (patterns.some((pattern) => pattern.test(message))) return message;
  }
  return 'Unavailable';
}

function countLogs(logs: LogEntry[], patterns: RegExp[]): number {
  return logs.reduce((count, log) => count + (patterns.some((pattern) => pattern.test(log.message)) ? 1 : 0), 0);
}

function getMaxNumberFromLogs(logs: LogEntry[], patterns: RegExp[]): number | null {
  let result: number | null = null;
  for (const log of logs) {
    for (const pattern of patterns) {
      const match = log.message.match(pattern);
      if (!match?.[1]) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) result = Math.max(result ?? value, value);
    }
  }
  return result;
}

function collectBlockers(logs: LogEntry[]): Array<{ reason: string; count: number }> {
  return BLOCKER_PATTERNS
    .map(({ reason, patterns }) => ({ reason, count: countLogs(logs, patterns) }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

function tradeGrossPnlUsd(trade: TradeRecord): number | null {
  return trade.grossPnlUsd ?? trade.closeSnapshot?.grossPnlUsd ?? trade.pnl ?? null;
}

function tradeFeeUsd(trade: TradeRecord): number | null {
  return trade.feeUsdTotal ?? trade.closeSnapshot?.feeUsdTotal ?? trade.closeSnapshot?.fees ?? null;
}

function tradeNetPnlUsd(trade: TradeRecord): number | null {
  const explicit = trade.netPnlUsd ?? trade.closeSnapshot?.netPnlUsd;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const gross = tradeGrossPnlUsd(trade);
  const fees = tradeFeeUsd(trade);
  return gross == null ? null : gross - (fees ?? 0);
}

function buildBreakdown(
  keys: readonly string[],
  labelByKey: Record<string, string>,
  openedTrades: TradeRecord[],
  closedTrades: TradeRecord[],
  getKey: (trade: TradeRecord) => string,
  getScore?: (trade: TradeRecord) => number | null,
): ReportBreakdownRow[] {
  return keys.map((key) => {
    const opened = openedTrades.filter((trade) => getKey(trade) === key);
    const closed = closedTrades.filter((trade) => getKey(trade) === key);
    const closedWithPnl = closed.filter((trade) => typeof tradeNetPnlUsd(trade) === 'number');
    const best = closedWithPnl.reduce<TradeRecord | null>((winner, trade) => {
      if (!winner || (tradeNetPnlUsd(trade) ?? 0) > (tradeNetPnlUsd(winner) ?? 0)) return trade;
      return winner;
    }, null);
    const worst = closedWithPnl.reduce<TradeRecord | null>((loser, trade) => {
      if (!loser || (tradeNetPnlUsd(trade) ?? 0) < (tradeNetPnlUsd(loser) ?? 0)) return trade;
      return loser;
    }, null);

    return {
      key,
      label: labelByKey[key] ?? key,
      buys: opened.length,
      sells: closed.length,
      wins: closed.filter((trade) => (tradeNetPnlUsd(trade) ?? 0) > 0).length,
      losses: closed.filter((trade) => (tradeNetPnlUsd(trade) ?? 0) < 0).length,
      pnlUsd: sum(closed.map(tradeNetPnlUsd)),
      avgPnlUsd: avg(closed.map(tradeNetPnlUsd)),
      bestTrade: labelTrade(best),
      worstTrade: labelTrade(worst),
      avgHoldMs: avg(closed.map(getHoldMs)),
      avgScore: getScore ? avg([...opened, ...closed].map(getScore)) : undefined,
    };
  });
}

function getScore(trade: TradeRecord): number | null {
  const scoreValues = [
    trade.buySnapshot?.scalpScore,
    trade.buySnapshot?.confidence,
    trade.mlConfidence,
    trade.buySnapshot?.scoreBreakdown?.total,
    trade.buySnapshot?.scoreBreakdown?.score,
  ];
  return scoreValues.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? null;
}

export function generateBotReport(input: GenerateBotReportInput): BotReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const endMs = parseTime(generatedAt);
  const startMs = endMs - input.windowHours * 60 * 60 * 1000;
  const startTime = new Date(startMs).toISOString();
  const endTime = new Date(endMs).toISOString();

  const logsInWindow = input.logs.filter((log) => isInsideWindow(log.timestamp, startMs, endMs));
  const openedTrades = input.trades.filter((trade) => isInsideWindow(trade.entryTime, startMs, endMs));
  const closedTrades = input.trades.filter((trade) => isInsideWindow(trade.exitTime, startMs, endMs));
  const activeOpenTrades = input.trades.filter((trade) => trade.status === 'open' && parseTime(trade.entryTime) <= endMs);
  const relatedTrades = [...new Map([...openedTrades, ...closedTrades, ...activeOpenTrades].map((trade) => [trade.tradeId, trade])).values()];
  const scannerEvents = logsInWindow.filter((log) => /SCANNER|CANDIDATE|ENTRY|BUY|BLOCK|RANKING|PROFESSIONAL|ANCHOR/i.test(log.message));
  const closedWithPnl = closedTrades.filter((trade) => typeof tradeNetPnlUsd(trade) === 'number');
  const bestTrade = closedWithPnl.reduce<TradeRecord | null>((best, trade) => (!best || (tradeNetPnlUsd(trade) ?? 0) > (tradeNetPnlUsd(best) ?? 0) ? trade : best), null);
  const worstTrade = closedWithPnl.reduce<TradeRecord | null>((worst, trade) => (!worst || (tradeNetPnlUsd(trade) ?? 0) < (tradeNetPnlUsd(worst) ?? 0) ? trade : worst), null);
  const holdTimes = closedTrades.map(getHoldMs);
  const blockers = collectBlockers(logsInWindow);
  const professionalLogs = logsInWindow.filter((log) => /PROFESSIONAL|professionalScore|STRONG_BUY|AVOID|WAIT/i.test(log.message));
  const scoreMatches = professionalLogs.flatMap((log) =>
    [...log.message.matchAll(/professionalScore[=:]\s*(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1])),
  );

  const missingDataSources = [
    input.trades.length === 0 ? 'journal unavailable' : null,
    scannerEvents.length === 0 ? 'scanner logs unavailable' : null,
    logsInWindow.length === 0 ? 'app health logs unavailable' : null,
    professionalLogs.length === 0 ? 'professional analysis logs unavailable' : null,
  ].filter((value): value is string => Boolean(value));

  const performanceWarnings = countLogs(logsInWindow, [/PERFORMANCE/i, /RENDER_FREQUENCY/i, /THROTTLE_AUDIT/i]);
  const realizedGrossPnlUsd = sum(closedTrades.map(tradeGrossPnlUsd));
  const feesUsd = sum(closedTrades.map(tradeFeeUsd));
  const realizedNetPnlUsd = sum(closedTrades.map(tradeNetPnlUsd));
  const realizedPnlUsd = realizedNetPnlUsd;
  const winRatePct = closedTrades.length > 0
    ? (closedTrades.filter((trade) => (tradeNetPnlUsd(trade) ?? 0) > 0).length / closedTrades.length) * 100
    : null;
  const conclusion = buildConclusion({
    closedTrades: closedTrades.length,
    realizedPnlUsd,
    winRatePct,
    blockers,
    warnings: countLogs(logsInWindow, [/warn/i]),
    errors: logsInWindow.filter((log) => log.level === 'ERROR').length,
  });

  return {
    windowHours: input.windowHours,
    startTime,
    endTime,
    generatedAt,
    mode: detectMode(relatedTrades),
    summary: {
      autobotsStatus: latestMatchingLog(logsInWindow, [/AUTOBOTS/i]),
      microScalperStatus: latestMatchingLog(logsInWindow, [/SCALPER/i, /MICRO/i]),
      entryConfirmationMode: latestMatchingLog(logsInWindow, [/ENTRY_CONFIRMATION/i, /confirmation mode/i]),
      anchorStatus: latestMatchingLog(logsInWindow, [/BTC.*ANCHOR/i, /ETH.*ANCHOR/i, /ANCHOR/i]),
    },
    performance: {
      tradesOpened: openedTrades.length,
      tradesClosed: closedTrades.length,
      currentlyOpen: activeOpenTrades.length,
      winningClosedTrades: closedTrades.filter((trade) => (tradeNetPnlUsd(trade) ?? 0) > 0).length,
      losingClosedTrades: closedTrades.filter((trade) => (tradeNetPnlUsd(trade) ?? 0) < 0).length,
      winRatePct,
      realizedPnlUsd,
      realizedGrossPnlUsd,
      realizedNetPnlUsd,
      realizedPnlPct: avg(closedTrades.map((trade) => trade.pnlPercent ?? trade.closeSnapshot?.pnlPercent)),
      openUnrealizedPnlUsd: null,
      bestTrade: labelTrade(bestTrade),
      worstTrade: labelTrade(worstTrade),
      avgHoldMs: avg(holdTimes),
      fastestSellMs: holdTimes.filter((value): value is number => value !== null).reduce<number | null>((fastest, value) => fastest === null || value < fastest ? value : fastest, null),
      longestTradeMs: holdTimes.filter((value): value is number => value !== null).reduce<number | null>((longest, value) => longest === null || value > longest ? value : longest, null),
      feesUsd,
    },
    strategyBreakdown: buildBreakdown(STRATEGY_KEYS, {
      momentum: 'Momentum',
      balanced: 'Balanced',
      dip_and_rebound: 'Dip and Rebound',
      conservative: 'Conservative',
      micro_scalper: 'Micro Scalper',
      unknown: 'Unknown',
    }, openedTrades, closedTrades, normalizeStrategy),
    riskGroupBreakdown: buildBreakdown(RISK_GROUP_KEYS, {
      top_caps: 'top_caps',
      large_caps: 'large_caps',
      mid_caps: 'mid_caps',
      high_risk: 'high_risk',
      very_high_risk: 'very_high_risk',
      unknown: 'unknown',
    }, openedTrades, closedTrades, normalizeRiskGroup, getScore),
    professionalAnalysis: {
      candidatesAnalyzed: professionalLogs.length > 0 ? professionalLogs.length : null,
      strongBuyCount: professionalLogs.length > 0 ? countLogs(professionalLogs, [/STRONG_BUY/i]) : null,
      waitCount: professionalLogs.length > 0 ? countLogs(professionalLogs, [/\bWAIT\b/i]) : null,
      avoidCount: professionalLogs.length > 0 ? countLogs(professionalLogs, [/AVOID/i]) : null,
      averageProfessionalScore: scoreMatches.length > 0 ? avg(scoreMatches) : null,
      blockedByScoreThreshold: professionalLogs.length > 0 ? countLogs(professionalLogs, [/score.*threshold/i, /below.*score/i]) : null,
      blockedByProfessionalVerdict: professionalLogs.length > 0 ? countLogs(professionalLogs, [/professional.*block/i, /verdict.*block/i]) : null,
      blockedByAnchor: professionalLogs.length > 0 ? countLogs(professionalLogs, [/anchor/i]) : null,
      blockedByStalePrice: professionalLogs.length > 0 ? countLogs(professionalLogs, [/stale price/i]) : null,
      blockedBySpread: professionalLogs.length > 0 ? countLogs(professionalLogs, [/spread/i]) : null,
      blockedByNoTpRoom: professionalLogs.length > 0 ? countLogs(professionalLogs, [/no tp room/i]) : null,
      topApprovalReasons: professionalLogs.length > 0 ? [{ reason: 'STRONG_BUY', count: countLogs(professionalLogs, [/STRONG_BUY/i]) }].filter((item) => item.count > 0) : [],
      topBlockers: blockers,
    },
    scannerPipeline: {
      scanCycles: scannerEvents.length > 0 ? countLogs(scannerEvents, [/SCAN/i, /SCANNER/i]) : null,
      candidatesScanned: scannerEvents.length > 0 ? getMaxNumberFromLogs(scannerEvents, [/candidatesScanned[=:]\s*(\d+)/i, /scanned[=:]\s*(\d+)/i]) : null,
      candidatesPromoted: scannerEvents.length > 0 ? countLogs(scannerEvents, [/promoted/i, /BUY_READY/i]) : null,
      candidatesBlocked: scannerEvents.length > 0 ? countLogs(scannerEvents, [/BLOCK/i, /blocked/i]) : null,
      entryApprovedCount: scannerEvents.length > 0 ? countLogs(scannerEvents, [/ENTRY.*APPROVED/i, /ENTRY.*ALLOW/i]) : null,
      buyApprovedCount: scannerEvents.length > 0 ? countLogs(scannerEvents, [/BUY.*APPROVED/i, /BUY.*ALLOW/i, /BUY_READY/i]) : null,
      buyBlockedCount: scannerEvents.length > 0 ? countLogs(scannerEvents, [/BUY.*BLOCK/i, /BLOCK.*BUY/i]) : null,
      commonBlockers: blockers,
    },
    appHealth: {
      uptime: 'Unavailable',
      warningsCount: logsInWindow.filter((log) => log.level === 'WARN').length,
      errorsCount: logsInWindow.filter((log) => log.level === 'ERROR').length,
      stalePriceEvents: countLogs(logsInWindow, [/stale price/i, /PRICE_STALE/i]),
      missingSnapshotEvents: countLogs(logsInWindow, [/missing snapshot/i, /snapshot.*missing/i]),
      persistenceErrors: countLogs(logsInWindow, [/persistence/i, /storage/i, /localStorage/i]),
      rejectedOrders: countLogs(logsInWindow, [/rejected order/i, /ORDER.*REJECT/i, /REJECTED/i]),
      failedTelegramNotifications: countLogs(logsInWindow, [/telegram.*fail/i, /failed telegram/i]),
      performanceWarnings,
      staleOpenPositionPriceEvents: countLogs(logsInWindow, [/STALE_OPEN_POSITION_PRICE_WARNING/i, /livePriceSource=LIVE PRICE STALE/i, /livePriceSource=CACHE PRICE STALE/i]),
      fallbackPriceEvents: countLogs(logsInWindow, [/livePriceSource=SNAPSHOT FALLBACK/i, /FALLBACK_PRICE_USED/i]),
      unavailablePriceEvents: countLogs(logsInWindow, [/livePriceSource=PRICE UNAVAILABLE/i, /PNL_UNAVAILABLE_LIVE_PRICE_MISSING/i]),
    },
    dataAudit: {
      tradesFound: relatedTrades.length,
      closedTradesFound: closedTrades.length,
      logsFound: logsInWindow.length,
      scannerEventsFound: scannerEvents.length,
      missingDataSources,
    },
    conclusion,
    notEnoughData: relatedTrades.length === 0 && logsInWindow.length === 0,
  };
}

function buildConclusion(input: {
  closedTrades: number;
  realizedPnlUsd: number | null;
  winRatePct: number | null;
  blockers: Array<{ reason: string; count: number }>;
  warnings: number;
  errors: number;
}): string {
  if (input.closedTrades === 0 && input.blockers.length === 0 && input.warnings === 0 && input.errors === 0) {
    return 'Not enough data to evaluate bot performance for this window.';
  }
  const topBlocker = input.blockers[0];
  const improvement = buildImprovementAdvice(topBlocker?.reason, input);
  if (topBlocker && input.closedTrades === 0) {
    return `Bot was defensive in this window. Main blocker: ${topBlocker.reason}. Improve: ${improvement}`;
  }
  if (input.realizedPnlUsd !== null && input.realizedPnlUsd > 0 && (input.winRatePct ?? 0) >= 50) {
    return `Bot performed well. Win rate was ${input.winRatePct?.toFixed(0)}%, and realized PnL was positive. Improve: keep the current filters, then review the weakest losing strategy before increasing exposure.`;
  }
  if (input.realizedPnlUsd !== null && input.realizedPnlUsd < 0) {
    return topBlocker
      ? `Bot struggled in this window. Realized PnL was negative, and the main issue was ${topBlocker.reason}. Improve: ${improvement}`
      : 'Bot struggled in this window. Realized PnL was negative. Improve: review losing symbols, reduce capital per trade temporarily, and wait for a cleaner win-rate sample before scaling.';
  }
  if (input.errors > 0) return 'App health needs attention. Errors were logged during this report window. Improve: fix runtime errors first, then trust trading metrics after a clean run.';
  return topBlocker
    ? `Bot activity was limited or neutral. Main friction was ${topBlocker.reason}. Improve: ${improvement}`
    : 'Bot activity was limited or neutral. Improve: collect more closed trades and compare strategy/risk-group PnL before changing trading parameters.';
}

function buildImprovementAdvice(reason: string | undefined, input: {
  winRatePct: number | null;
  warnings: number;
  errors: number;
}): string {
  const normalized = (reason ?? '').toLowerCase();
  if (normalized.includes('stale price')) {
    return 'check market-data freshness/websocket stability, avoid BUY decisions when price age is high, and only judge strategy after stale-price blocks drop.';
  }
  if (normalized.includes('spread')) {
    return 'tighten symbol selection toward more liquid coins, keep max spread strict, and avoid entries when the spread cost eats TP room.';
  }
  if (normalized.includes('tp room')) {
    return 'avoid late entries, require cleaner distance to TP1, and review TP settings for low-volatility coins.';
  }
  if (normalized.includes('anchor')) {
    return 'wait for BTC/ETH anchor alignment, or keep risky alt buys reduced until anchor blocks decrease.';
  }
  if (normalized.includes('pullback')) {
    return 'let pullbacks complete before entry, reduce chasing after fast pumps, and prefer setups with confirmed rebound plus momentum.';
  }
  if (normalized.includes('momentum')) {
    return 'require stronger short-term confirmation, compare losing trades by momentum score, and avoid weak continuation setups.';
  }
  if (normalized.includes('duplicate') || normalized.includes('position')) {
    return 'review max positions and duplicate-position handling, then free slots before expecting new buys.';
  }
  if (input.errors > 0 || input.warnings > 0) {
    return 'clear app health warnings/errors first, because noisy runtime data can distort scanner and report conclusions.';
  }
  if ((input.winRatePct ?? 100) < 50) {
    return 'reduce aggressiveness, review losing strategies, and wait for a better win-rate sample before raising capital.';
  }
  return 'review the top blockers and weakest strategy/risk group, then adjust one parameter at a time and compare the next saved report.';
}

export function botReportToMarkdown(report: BotReport): string {
  const rows = (items: ReportBreakdownRow[]) => items
    .map((item) => `| ${item.label} | ${item.buys} | ${item.sells} | ${item.wins}/${item.losses} | ${formatMoney(item.pnlUsd)} | ${formatMoney(item.avgPnlUsd)} | ${item.bestTrade ?? 'Unavailable'} | ${item.worstTrade ?? 'Unavailable'} | ${formatReportDuration(item.avgHoldMs)} |`)
    .join('\n');

  return [
    `# Bot/App Report - Last ${report.windowHours}h`,
    '',
    `Generated: ${report.generatedAt}`,
    `Window: ${report.startTime} -> ${report.endTime}`,
    `Mode: ${report.mode}`,
    '',
    '## Summary',
    `- AutoBots: ${report.summary.autobotsStatus}`,
    `- Micro Scalper: ${report.summary.microScalperStatus}`,
    `- Entry Confirmation: ${report.summary.entryConfirmationMode}`,
    `- BTC/ETH Anchor: ${report.summary.anchorStatus}`,
    '',
    '## Trading Performance',
    `- Trades opened: ${report.performance.tradesOpened}`,
    `- Trades closed: ${report.performance.tradesClosed}`,
    `- Currently open: ${report.performance.currentlyOpen}`,
    `- Wins/Losses: ${report.performance.winningClosedTrades}/${report.performance.losingClosedTrades}`,
    `- Win rate: ${formatPercent(report.performance.winRatePct)}`,
    `- Realized Gross: ${formatMoney(report.performance.realizedGrossPnlUsd)}`,
    `- Fees Paid: ${formatMoney(report.performance.feesUsd)}`,
    `- Realized Net: ${formatMoney(report.performance.realizedNetPnlUsd ?? report.performance.realizedPnlUsd)}`,
    `- Average realized PnL %: ${formatPercent(report.performance.realizedPnlPct)}`,
    `- Best trade: ${report.performance.bestTrade ?? 'Unavailable'}`,
    `- Worst trade: ${report.performance.worstTrade ?? 'Unavailable'}`,
    `- Average hold: ${formatReportDuration(report.performance.avgHoldMs)}`,
    `- Fastest sell: ${formatReportDuration(report.performance.fastestSellMs)}`,
    `- Longest trade: ${formatReportDuration(report.performance.longestTradeMs)}`,
    '',
    '## Strategy Breakdown',
    '| Strategy | Buys | Sells | Wins/Losses | PnL | Avg PnL | Best | Worst | Avg Hold |',
    '|---|---:|---:|---:|---:|---:|---|---|---:|',
    rows(report.strategyBreakdown),
    '',
    '## Risk Group Breakdown',
    '| Risk Group | Buys | Sells | Wins/Losses | PnL | Avg PnL | Best | Worst | Avg Hold |',
    '|---|---:|---:|---:|---:|---:|---|---|---:|',
    rows(report.riskGroupBreakdown),
    '',
    '## Scanner / Pipeline',
    `- Scan cycles: ${report.scannerPipeline.scanCycles ?? 'Unavailable'}`,
    `- Candidates scanned: ${report.scannerPipeline.candidatesScanned ?? 'Unavailable'}`,
    `- Candidates promoted: ${report.scannerPipeline.candidatesPromoted ?? 'Unavailable'}`,
    `- Candidates blocked: ${report.scannerPipeline.candidatesBlocked ?? 'Unavailable'}`,
    `- ENTRY approved: ${report.scannerPipeline.entryApprovedCount ?? 'Unavailable'}`,
    `- BUY approved: ${report.scannerPipeline.buyApprovedCount ?? 'Unavailable'}`,
    `- BUY blocked: ${report.scannerPipeline.buyBlockedCount ?? 'Unavailable'}`,
    '',
    '## App Health',
    `- Warnings: ${report.appHealth.warningsCount}`,
    `- Errors: ${report.appHealth.errorsCount}`,
    `- Stale price events: ${report.appHealth.stalePriceEvents}`,
    `- Stale open-position price events: ${report.appHealth.staleOpenPositionPriceEvents}`,
    `- Fallback price events: ${report.appHealth.fallbackPriceEvents}`,
    `- Unavailable price events: ${report.appHealth.unavailablePriceEvents}`,
    `- Missing snapshot events: ${report.appHealth.missingSnapshotEvents}`,
    `- Persistence errors: ${report.appHealth.persistenceErrors}`,
    `- Rejected orders: ${report.appHealth.rejectedOrders}`,
    `- Failed Telegram notifications: ${report.appHealth.failedTelegramNotifications}`,
    `- Performance warnings: ${report.appHealth.performanceWarnings}`,
    '',
    '## Data Audit',
    `- Trades found: ${report.dataAudit.tradesFound}`,
    `- Closed trades found: ${report.dataAudit.closedTradesFound}`,
    `- Logs found: ${report.dataAudit.logsFound}`,
    `- Scanner events found: ${report.dataAudit.scannerEventsFound}`,
    `- Missing sources: ${report.dataAudit.missingDataSources.join(', ') || 'none'}`,
    '',
    '## Conclusion',
    report.conclusion,
  ].join('\n');
}

export function botReportToJson(report: BotReport): string {
  return JSON.stringify(report, null, 2);
}

export const reportFormatters = {
  money: formatMoney,
  percent: formatPercent,
  duration: formatReportDuration,
};
