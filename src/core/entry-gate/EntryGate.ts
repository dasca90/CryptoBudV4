import type {
  EntryGateInput,
  EntryGateOutput,
  EntryGateBlockReason,
  EntryGateVerdict,
  EntryGateDecisionSnapshot,
  EntryGateSnapshotContext,
  ScannerCandidate,
} from '../types';

function asBlocked(reason: string, extra?: { pass?: boolean; input?: number; required?: number; source?: string }) {
  return { status: 'BLOCK' as const, reason, ...extra };
}

function asPass(extra?: { pass?: boolean; input?: number; required?: number; source?: string }) {
  return { status: 'PASS' as const, reason: null, ...extra };
}

function pickFirstReason(reasons: string[], token: string): string | null {
  return reasons.find(r => r.toLowerCase().includes(token)) ?? null;
}

function isValidConfidence(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function resolveConfidenceInput(input: EntryGateInput): { value: number | null; source: string } {
  if (isValidConfidence(input.mlConfidence)) {
    return { value: input.mlConfidence, source: input.confidenceSource ?? 'EntryGate.mlConfidence' };
  }
  const fallbackAllowed = input.allowStrategyConfidenceFallback !== false;
  if (fallbackAllowed && isValidConfidence(input.strategyConfidence)) {
    return { value: input.strategyConfidence, source: 'strategy_confidence_fallback' };
  }
  return { value: null, source: fallbackAllowed ? 'confidence_unavailable' : 'fallback_disabled_missing_ml' };
}

export function buildCanonicalEntryGateSnapshot(
  candidate: ScannerCandidate,
  context: EntryGateSnapshotContext,
): EntryGateDecisionSnapshot {
  const blockReasons = candidate.entryGateDecision?.blockReasons ?? [];
  const requiredNextActions = candidate.entryGateDecision?.requiredNextActions ?? [];
  const gateSnapshot = candidate.entryGateDecision?.snapshot;
  const hasBlock = (token: string) => blockReasons.some(r => r.toLowerCase().includes(token));

  const duplicateSymbolResult = context.openSymbols.includes(candidate.symbol) || context.pendingOrderSymbols.includes(candidate.symbol)
    ? asBlocked(context.openSymbols.includes(candidate.symbol) ? 'BLOCK_DUPLICATE_POSITION' : 'BLOCK_PENDING_BUY_EXISTS')
    : asPass();

  const exposureCapitalResult = context.currentPositions >= context.maxPositions
    ? asBlocked('BLOCK_MAX_POSITIONS')
    : context.capitalAvailable <= 0
      ? asBlocked('BLOCK_CAPITAL_LIMIT')
      : asPass();

  const confidenceInput = gateSnapshot?.confidenceResult.input ?? candidate.confidence;
  const confidenceRequired = gateSnapshot?.confidenceResult.required ?? context.minConfidence;
  const confidenceSource = gateSnapshot?.confidenceResult.source ?? 'planner.candidate.confidence';
  const confidenceUnavailable = hasBlock('confidence_unavailable') || confidenceInput === null || confidenceInput === undefined;
  const confidenceBlocked = hasBlock('confidence') || confidenceUnavailable || confidenceInput < confidenceRequired;
  const confidenceResult = confidenceBlocked
    ? asBlocked(
      confidenceUnavailable ? 'BLOCK_CONFIDENCE_UNAVAILABLE' : (pickFirstReason(blockReasons, 'confidence') ?? 'BLOCK_CONFIDENCE_TOO_LOW'),
      { pass: false, input: confidenceInput, required: confidenceRequired, source: confidenceSource },
    )
    : asPass({ pass: true, input: confidenceInput, required: confidenceRequired, source: confidenceSource });

  const spreadSlippageResult = candidate.spreadPct >= context.maxSpreadPct || hasBlock('spread')
    ? asBlocked(pickFirstReason(blockReasons, 'spread') ?? 'BLOCK_SPREAD_TOO_HIGH')
    : asPass();

  const priceFreshnessResult = candidate.priceFresh === false || candidate.bookFresh === false
    ? asBlocked(candidate.bookFresh === false ? 'BLOCK_BOOK_STALE' : 'BLOCK_PRICE_STALE')
    : asPass();

  const tpRoomResult = !candidate.tpRoomOk || hasBlock('tp')
    ? asBlocked(pickFirstReason(blockReasons, 'tp') ?? 'BLOCK_NO_TP_ROOM')
    : asPass();

  const marketSafetyReason = hasBlock('btc_dump') || hasBlock('market_regime') || hasBlock('very_high_risk_live') || hasBlock('recent_loss') || hasBlock('market_data_offline')
    ? blockReasons.find(r => ['btc_dump', 'market_regime', 'very_high_risk_live', 'recent_loss', 'market_data_offline'].some(token => r.toLowerCase().includes(token))) ?? 'BLOCK_MARKET_REGIME_UNSAFE'
    : !context.groupEnabled
      ? 'GROUP_DISABLED'
      : null;
  const marketSafetyResult = marketSafetyReason ? asBlocked(marketSafetyReason) : asPass();

  const allResults = [duplicateSymbolResult, exposureCapitalResult, confidenceResult, spreadSlippageResult, priceFreshnessResult, tpRoomResult, marketSafetyResult];
  const decision = allResults.some(r => r.status === 'BLOCK') ? 'BLOCK' : 'ALLOW';
  const snapshotBlockReasons = allResults.filter(r => r.status === 'BLOCK').map(r => r.reason!).filter(Boolean);

  return {
    decision,
    primaryReason: snapshotBlockReasons[0] ?? null,
    blockReasons: snapshotBlockReasons,
    requiredNextActions,
    confidenceResult,
    spreadSlippageResult,
    priceFreshnessResult,
    tpRoomResult,
    marketSafetyResult,
    exposureCapitalResult,
    duplicateSymbolResult,
    timestamp: new Date().toISOString(),
    source: 'entry_gate_canonical',
  };
}

export class EntryGate {
  evaluate(input: EntryGateInput): EntryGateOutput {
    const blockReasons: EntryGateBlockReason[] = [];
    const warnings: string[] = [];
    const requiredNextActions: string[] = [];

    if (input.marketDataOnline === false) {
      blockReasons.push('BLOCK_MARKET_DATA_OFFLINE');
      requiredNextActions.push('Wait for market data to come online');
    }

    if (!input.priceFresh) {
      blockReasons.push('BLOCK_PRICE_STALE');
      requiredNextActions.push('Wait for fresh price tick');
    }

    if (input.bookFresh === false) {
      blockReasons.push('BLOCK_BOOK_STALE');
      requiredNextActions.push('Wait for fresh book ticker');
    }

    if (!input.spreadOk && input.spreadOk !== undefined) {
      blockReasons.push('BLOCK_SPREAD_TOO_HIGH');
      requiredNextActions.push('Wait for spread to narrow');
    }

    if (!input.volumePass && input.volumePass !== undefined) {
      blockReasons.push('BLOCK_VOLUME_TOO_LOW');
      requiredNextActions.push('Wait for higher volume');
    }

    if (input.btcDumping) {
      blockReasons.push('BLOCK_BTC_DUMP');
      requiredNextActions.push('Wait for BTC to stabilise');
    }

    if (input.marketRegimeUnsafe) {
      blockReasons.push('BLOCK_MARKET_REGIME_UNSAFE');
      requiredNextActions.push('Wait for safer market regime');
    }

    if (input.breakoutConfirmed === false) {
      blockReasons.push('BLOCK_BREAKOUT_NOT_CONFIRMED');
      requiredNextActions.push('Wait for breakout confirmation');
    } else if (!input.reboundConfirmed && input.reboundConfirmed !== undefined) {
      blockReasons.push('BLOCK_REBOUND_NOT_CONFIRMED');
      requiredNextActions.push('Wait for rebound confirmation');
    }

    if (!input.momentumConfirmed && input.momentumConfirmed !== undefined) {
      blockReasons.push('BLOCK_MOMENTUM_NOT_CONFIRMED');
      requiredNextActions.push('Wait for momentum confirmation');
    }

    if (!input.tpRoomOk) {
      blockReasons.push('BLOCK_NO_TP_ROOM');
      requiredNextActions.push('Adjust TP or wait for better entry');
    }

    const requiredConfidence = input.requiredConfidence ?? 0.3;
    const resolvedConfidence = resolveConfidenceInput(input);
    if (resolvedConfidence.value === null) {
      blockReasons.push('BLOCK_CONFIDENCE_UNAVAILABLE');
      requiredNextActions.push('Wait for valid confidence source');
    } else if (resolvedConfidence.value < requiredConfidence) {
      blockReasons.push('BLOCK_CONFIDENCE_TOO_LOW');
      requiredNextActions.push('Wait for higher confidence');
    }

    if (input.isVeryHighRisk && input.isLive) {
      blockReasons.push('BLOCK_VERY_HIGH_RISK_LIVE');
      requiredNextActions.push('Switch to paper or reduce risk');
    }

    if (input.currentPositions >= input.maxPositions) {
      blockReasons.push('BLOCK_MAX_POSITIONS');
      requiredNextActions.push('Close existing positions first');
    }

    if (input.recentLoss) {
      blockReasons.push('BLOCK_RECENT_LOSS_COOLDOWN');
      requiredNextActions.push('Wait for cooldown after loss');
    }

    // Symbol filter checks (Phase 12)
    if (input.symbolTradable === false) {
      blockReasons.push('BLOCK_SYMBOL_NOT_TRADABLE');
      requiredNextActions.push('Symbol not tradable on Binance');
    }

    if (input.minNotionalOk === false) {
      blockReasons.push('BLOCK_MIN_NOTIONAL');
      requiredNextActions.push('Increase order size to meet minimum notional');
    }

    if (input.lotSizeOk === false) {
      blockReasons.push('BLOCK_LOT_SIZE');
      requiredNextActions.push('Adjust quantity to valid lot size');
    }

    if (input.tickSizeOk === false) {
      blockReasons.push('BLOCK_TICK_SIZE');
      requiredNextActions.push('Adjust price to valid tick size');
    }

    // SCALPER-specific checks
    if (input.mode === 'SCALPER') {
      if (input.isLive) {
        blockReasons.push('BLOCK_SCALPER_LIVE_DISABLED');
        requiredNextActions.push('Switch to paper mode for scalper');
      }
      // SCALPER always checks very high risk live
      if (input.isVeryHighRisk && input.isLive) {
        blockReasons.push('BLOCK_VERY_HIGH_RISK_LIVE');
        requiredNextActions.push('Switch to paper or reduce risk');
      }
    }

    if (blockReasons.length > 0) {
      const verdict: EntryGateVerdict = 'BLOCK';
      const decision: EntryGateOutput = {
        decision: verdict,
        primaryReason: blockReasons[0],
        blockReasons,
        warnings,
        explanation: `Blocked by ${blockReasons.length} reason(s): ${blockReasons.join(', ')}`,
        requiredNextActions,
      };
      return {
        ...decision,
        snapshot: {
          decision: 'BLOCK',
          primaryReason: blockReasons[0],
          blockReasons: [...blockReasons],
          requiredNextActions: [...requiredNextActions],
          confidenceResult: blockReasons.includes('BLOCK_CONFIDENCE_UNAVAILABLE')
            ? asBlocked('BLOCK_CONFIDENCE_UNAVAILABLE', { pass: false, input: resolvedConfidence.value ?? undefined, required: requiredConfidence, source: resolvedConfidence.source })
            : blockReasons.includes('BLOCK_CONFIDENCE_TOO_LOW')
              ? asBlocked('BLOCK_CONFIDENCE_TOO_LOW', { pass: false, input: resolvedConfidence.value ?? undefined, required: requiredConfidence, source: resolvedConfidence.source })
              : asPass({ pass: true, input: resolvedConfidence.value ?? undefined, required: requiredConfidence, source: resolvedConfidence.source }),
          spreadSlippageResult: blockReasons.includes('BLOCK_SPREAD_TOO_HIGH') ? asBlocked('BLOCK_SPREAD_TOO_HIGH') : asPass(),
          priceFreshnessResult: blockReasons.some(r => r === 'BLOCK_PRICE_STALE' || r === 'BLOCK_BOOK_STALE') ? asBlocked(blockReasons.includes('BLOCK_PRICE_STALE') ? 'BLOCK_PRICE_STALE' : 'BLOCK_BOOK_STALE') : asPass(),
          tpRoomResult: blockReasons.includes('BLOCK_NO_TP_ROOM') ? asBlocked('BLOCK_NO_TP_ROOM') : asPass(),
          marketSafetyResult: blockReasons.some(r => ['BLOCK_BTC_DUMP', 'BLOCK_MARKET_REGIME_UNSAFE', 'BLOCK_RECENT_LOSS_COOLDOWN', 'BLOCK_VERY_HIGH_RISK_LIVE', 'BLOCK_MARKET_DATA_OFFLINE'].includes(r))
            ? asBlocked(blockReasons.find(r => ['BLOCK_BTC_DUMP', 'BLOCK_MARKET_REGIME_UNSAFE', 'BLOCK_RECENT_LOSS_COOLDOWN', 'BLOCK_VERY_HIGH_RISK_LIVE', 'BLOCK_MARKET_DATA_OFFLINE'].includes(r)) ?? 'BLOCK_MARKET_REGIME_UNSAFE')
            : asPass(),
          exposureCapitalResult: blockReasons.some(r => ['BLOCK_MAX_POSITIONS', 'BLOCK_CAPITAL_LIMIT'].includes(r))
            ? asBlocked(blockReasons.find(r => ['BLOCK_MAX_POSITIONS', 'BLOCK_CAPITAL_LIMIT'].includes(r)) ?? 'BLOCK_MAX_POSITIONS')
            : asPass(),
          duplicateSymbolResult: blockReasons.some(r => ['BLOCK_DUPLICATE_POSITION', 'BLOCK_PENDING_BUY_EXISTS'].includes(r))
            ? asBlocked(blockReasons.find(r => ['BLOCK_DUPLICATE_POSITION', 'BLOCK_PENDING_BUY_EXISTS'].includes(r)) ?? 'BLOCK_DUPLICATE_POSITION')
            : asPass(),
          timestamp: new Date().toISOString(),
          source: 'entry_gate_canonical',
        },
      };
    }

    return {
      decision: 'ALLOW',
      primaryReason: null,
      blockReasons: [],
      warnings,
      explanation: 'All checks passed',
      requiredNextActions: [],
      snapshot: {
        decision: 'ALLOW',
        primaryReason: null,
        blockReasons: [],
        requiredNextActions: [],
        confidenceResult: asPass({ pass: true, input: resolvedConfidence.value ?? undefined, required: requiredConfidence, source: resolvedConfidence.source }),
        spreadSlippageResult: asPass(),
        priceFreshnessResult: asPass(),
        tpRoomResult: asPass(),
        marketSafetyResult: asPass(),
        exposureCapitalResult: asPass(),
        duplicateSymbolResult: asPass(),
        timestamp: new Date().toISOString(),
        source: 'entry_gate_canonical',
      },
    };
  }
}
