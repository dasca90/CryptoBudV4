import type { ScannerCandidate } from '../types';
import { logger } from '../../utils/logger';

export type CurrentFreshnessBlocker = 'PRICE_NOT_FRESH / BOOK_STALE' | 'PRICE_NOT_FRESH' | 'BOOK_STALE' | null;

export interface CanonicalSymbolMarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  priceTimestamp: number | null;
  bookTimestamp: number | null;
  priceAgeMs: number;
  bookAgeMs: number;
  priceValid: boolean;
  bookValid: boolean;
  priceFresh: boolean;
  bookFresh: boolean;
  spreadOk: boolean;
  filtersOk: boolean;
  quality: import('../types').MarketDataQualityLevel;
  source: 'MarketDataFeed.shared_bookTicker_cache';
  currentFreshnessBlocker: CurrentFreshnessBlocker;
}

export interface CandidateFreshnessAtEvaluation {
  evaluatedAt: string;
  priceFreshAtEvaluation: boolean;
  bookFreshAtEvaluation: boolean;
  priceAgeMsAtEvaluation: number;
  historicalFreshnessBlockers: string[];
}

const PRICE_CODES = new Set(['PRICE_NOT_FRESH', 'PRICE_STALE', 'BLOCK_PRICE_STALE']);
const BOOK_CODES = new Set(['BOOK_STALE', 'BLOCK_BOOK_STALE']);

function tokens(reason: unknown): string[] {
  return String(reason ?? '').toUpperCase().trim().split(/\s*\/\s*/).filter(Boolean);
}

export function isPriceMarketFreshnessBlocker(reason: unknown): boolean {
  return tokens(reason).some((token) => PRICE_CODES.has(token));
}

export function isBookMarketFreshnessBlocker(reason: unknown): boolean {
  return tokens(reason).some((token) => BOOK_CODES.has(token));
}

export function isMarketFreshnessBlocker(reason: unknown): boolean {
  return isPriceMarketFreshnessBlocker(reason) || isBookMarketFreshnessBlocker(reason);
}

function reconcileReasons(reasons: readonly string[] | undefined, current: CanonicalSymbolMarketData): string[] {
  const unrelated = (reasons ?? []).filter((reason) => !isMarketFreshnessBlocker(reason));
  if (!current.priceFresh) unrelated.push('PRICE_NOT_FRESH');
  if (!current.bookFresh) unrelated.push('BOOK_STALE');
  return Array.from(new Set(unrelated));
}

function reconcileOwnedReason(reason: string | null | undefined, current: CanonicalSymbolMarketData): string | undefined {
  if (!isMarketFreshnessBlocker(reason)) return reason ?? undefined;
  return current.currentFreshnessBlocker ?? undefined;
}

function precheckFailure(snapshot: NonNullable<ScannerCandidate['executionPrecheckSnapshot']>): string {
  if (!snapshot.priceFresh) return 'PRICE_STALE';
  if (!snapshot.bookFresh) return 'BOOK_STALE';
  if (snapshot.riskGroupResolved === false) return 'MISSING_RISK_GROUP';
  if (snapshot.entryContractResolved === false) return 'ENTRY_CONTRACT_UNRESOLVED';
  if (snapshot.entryContractValid === false) return 'ENTRY_CONTRACT_INVALID';
  if (snapshot.professionalGateResolved === false) return 'PROFESSIONAL_GATE_UNRESOLVED';
  if (snapshot.spreadOk === false) return 'SPREAD_TOO_HIGH';
  if (snapshot.tpRoomOk === false) return 'TP_ROOM_MISSING';
  if (snapshot.capitalAvailable === false) return 'CAPITAL_UNAVAILABLE';
  return 'none';
}

export function rehydrateCandidateMarketFreshness(input: {
  candidate: ScannerCandidate;
  current: CanonicalSymbolMarketData;
  consumer: string;
  scanId?: string;
}): ScannerCandidate {
  const { candidate, current } = input;
  const previousReasons = candidate.blockReasons ?? [];
  const historical = candidate.freshnessAtEvaluation ?? {
    evaluatedAt: candidate.updatedAt || candidate.createdAt,
    priceFreshAtEvaluation: candidate.priceFresh !== false,
    bookFreshAtEvaluation: candidate.bookFresh !== false,
    priceAgeMsAtEvaluation: candidate.priceAgeMs,
    historicalFreshnessBlockers: previousReasons.filter(isMarketFreshnessBlocker),
  };
  const blockReasons = reconcileReasons(previousReasons, current);
  const reconciledGateReasons = reconcileReasons(candidate.entryGateDecision?.blockReasons, current);
  const entryGateDecision = candidate.entryGateDecision ? {
    ...candidate.entryGateDecision,
    decision: reconciledGateReasons.length === 0 ? 'ALLOW' as const : 'BLOCK' as const,
    blockReasons: reconciledGateReasons,
    primaryReason: reconciledGateReasons[0] ?? null,
    requiredNextActions: (candidate.entryGateDecision.requiredNextActions ?? []).filter((action) => {
      const normalized = action.toLowerCase();
      if (current.priceFresh && normalized.includes('fresh price')) return false;
      if (current.bookFresh && normalized.includes('fresh book')) return false;
      return true;
    }),
    snapshot: candidate.entryGateDecision.snapshot ? {
      ...candidate.entryGateDecision.snapshot,
      blockReasons: reconcileReasons(candidate.entryGateDecision.snapshot.blockReasons, current),
      primaryReason: reconcileOwnedReason(candidate.entryGateDecision.snapshot.primaryReason, current) ?? null,
      priceFreshnessResult: current.priceFresh && current.bookFresh
        ? { status: 'PASS' as const, reason: null }
        : { status: 'BLOCK' as const, reason: current.bookFresh ? 'BLOCK_PRICE_STALE' : 'BLOCK_BOOK_STALE' },
    } : candidate.entryGateDecision.snapshot,
  } : null;
  let executionPrecheckSnapshot = candidate.executionPrecheckSnapshot ? {
    ...candidate.executionPrecheckSnapshot,
    priceFresh: current.priceFresh,
    bookFresh: current.bookFresh,
    marketSnapshotFresh: current.priceFresh && current.bookFresh,
    referencePriceFresh: current.priceFresh,
    candleDataFresh: current.priceFresh,
  } : undefined;
  if (executionPrecheckSnapshot) {
    const failureReason = precheckFailure(executionPrecheckSnapshot);
    executionPrecheckSnapshot = { ...executionPrecheckSnapshot, failureReason, invariantOk: failureReason === 'none' };
  }
  const removed = previousReasons.filter((reason) => isMarketFreshnessBlocker(reason) && !blockReasons.includes(reason));
  const result = {
    ...candidate,
    price: current.priceValid ? current.price : candidate.price,
    priceAgeMs: current.priceAgeMs,
    priceFresh: current.priceFresh,
    bookFresh: current.bookFresh,
    filtersOk: current.filtersOk,
    dataQuality: current.quality,
    blockReasons,
    entryGateDecision,
    executionPrecheckSnapshot,
    primaryBlocker: reconcileOwnedReason(candidate.primaryBlocker, current),
    finalNoBuyReason: reconcileOwnedReason(candidate.finalNoBuyReason, current),
    mainReason: reconcileOwnedReason(candidate.mainReason, current) ?? (current.currentFreshnessBlocker ?? 'market_freshness_revalidated'),
    freshnessAtEvaluation: historical,
    currentMarketFreshness: current,
    lastMarketFreshnessRevalidatedAt: new Date().toISOString(),
  } as ScannerCandidate;
  const invariantOk = (!current.priceFresh || !blockReasons.some(isPriceMarketFreshnessBlocker))
    && (!current.bookFresh || !blockReasons.some(isBookMarketFreshnessBlocker));
  const scanId = input.scanId ?? candidate.runtimeSnapshot?.scanId ?? 'unknown';
  logger.throttled('INFO', `CANONICAL_MARKET_DATA_CONSUMER_AUDIT: symbol=${candidate.symbol} consumer=${input.consumer} scanId=${scanId} candidateId=${candidate.candidateId} price=${current.price} bid=${current.bid} ask=${current.ask} priceAgeMs=${current.priceAgeMs} bookAgeMs=${current.bookAgeMs} priceFresh=${String(current.priceFresh)} bookFresh=${String(current.bookFresh)} source=${current.source}`, `canonical_consumer_${input.consumer}_${candidate.symbol}`, 10000);
  logger.throttled('INFO', `CANDIDATE_FRESHNESS_STATE_SEPARATION_AUDIT: symbol=${candidate.symbol} evaluatedAt=${historical.evaluatedAt} priceFreshAtEvaluation=${String(historical.priceFreshAtEvaluation)} bookFreshAtEvaluation=${String(historical.bookFreshAtEvaluation)} currentPriceFresh=${String(current.priceFresh)} currentBookFresh=${String(current.bookFresh)} historicalBlocker=${historical.historicalFreshnessBlockers.join('|') || 'none'} currentFreshnessBlocker=${current.currentFreshnessBlocker ?? 'none'} invariantOk=${String(invariantOk)}`, `freshness_separation_${input.consumer}_${candidate.symbol}`, 10000);
  if (removed.length > 0) logger.throttled('INFO', `RESOLVED_FRESHNESS_BLOCKER_AUDIT: symbol=${candidate.symbol} previousBlocker=${removed.join('|')} currentPriceFresh=${String(current.priceFresh)} currentBookFresh=${String(current.bookFresh)} blockerRemoved=true`, `resolved_freshness_${input.consumer}_${candidate.symbol}`, 10000);
  if (!invariantOk) logger.error(`CURRENT_MARKET_FRESHNESS_BLOCKER_INVARIANT: symbol=${candidate.symbol} consumer=${input.consumer} currentPriceFresh=${String(current.priceFresh)} currentBookFresh=${String(current.bookFresh)} currentBlockers=${blockReasons.join('|') || 'none'} severity=ERROR invariantOk=false`);
  logger.throttled('INFO', `PRICE_FRESHNESS_CONSUMER_PARITY_AUDIT: symbol=${candidate.symbol} consumer=${input.consumer} candidatePriceFresh=${String(result.priceFresh)} candidateBookFresh=${String(result.bookFresh)} canonicalPriceFresh=${String(current.priceFresh)} canonicalBookFresh=${String(current.bookFresh)} mismatchDetected=${String(!invariantOk)} invariantOk=${String(invariantOk)}`, `freshness_parity_${input.consumer}_${candidate.symbol}`, 10000);
  if (input.consumer.includes('TopCandidates')) {
    logger.throttled('INFO', `SELECTED_COIN_FRESHNESS_DISPLAY_INVARIANT: symbol=${candidate.symbol} priceFresh=${String(current.priceFresh)} bookFresh=${String(current.bookFresh)} displayedCurrentBlockers=${blockReasons.join('|') || 'none'} contradictionDetected=${String(!invariantOk)} invariantOk=${String(invariantOk)}`, `selected_coin_freshness_${candidate.symbol}`, 10000);
    logger.throttled('INFO', `TOP_CANDIDATE_FRESHNESS_INVARIANT: symbol=${candidate.symbol} currentPriceFresh=${String(current.priceFresh)} currentBookFresh=${String(current.bookFresh)} currentReason=${current.currentFreshnessBlocker ?? 'none'} mismatchDetected=${String(!invariantOk)} invariantOk=${String(invariantOk)}`, `top_candidate_freshness_${candidate.symbol}`, 10000);
  }
  return result;
}
