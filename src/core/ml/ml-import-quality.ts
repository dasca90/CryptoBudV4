import type { ImportedMLRow, ImportQuality, MLUse, MLRowSource } from '../types';

export interface ImportQualityResult {
  dataQuality: ImportQuality;
  mlUse: MLUse;
  trainingWeight: number;
  trainingEligible: boolean;
  reasons: string[];
  warnings: string[];
}

export function evaluateImportedRowQuality(row: Partial<ImportedMLRow>): ImportQualityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const isStrict = row.source === 'v3_report';

  if (!row.symbol) reasons.push('missing_symbol');
  if (!row.strategy || row.strategy === 'default' || row.strategy === '') reasons.push('missing_strategy');
  if (row.pnlPercent === undefined || row.pnlPercent === null || isNaN(Number(row.pnlPercent))) reasons.push('invalid_pnl');
  if (!row.exitReason) reasons.push('missing_exit_reason');
  if (row.realMarketPriceAtClose === undefined || row.realMarketPriceAtClose === null || row.realMarketPriceAtClose <= 0) {
    reasons.push('missing_close_price');
  }
  if (!row.isRealMarketPriceAtClose) {
    reasons.push('unavailable_close_price');
  }
  if (row.exitReason === 'INVALID_PRICE') reasons.push('invalid_price_exit');

  if (isStrict && !row.isRealMarketPriceAtClose) {
    reasons.push('v3_fallback_close_not_real');
  }
  if (isStrict && (row.realMarketPriceAtClose === undefined || row.realMarketPriceAtClose <= 0)) {
    reasons.push('v3_missing_close_price');
  }

  if (row.hitStopLoss === undefined && row.hitTp1 === undefined && row.hitTp2 === undefined) {
    reasons.push('no_outcome');
  }

  if (row.hitTp1 && row.hitStopLoss) {
    warnings.push('contradictory_hit_tp1_and_stop_loss');
  }

  if (row.hitTp2 && row.hitStopLoss) {
    warnings.push('contradictory_hit_tp2_and_stop_loss');
  }

  if (row.pnlPercent !== undefined && !isNaN(Number(row.pnlPercent))) {
    const pnl = Number(row.pnlPercent);
    if (row.hitStopLoss && pnl > -0.5) {
      warnings.push('stop_loss_hit_but_pnl_not_negative');
    }
    if (row.hitTp1 && pnl < 0) {
      warnings.push('tp1_hit_but_pnl_negative');
    }
  }

  const hasRealPrice = row.isRealMarketPriceAtClose && row.realMarketPriceAtClose !== undefined && row.realMarketPriceAtClose > 0;
  const hasSymbol = !!row.symbol;
  const hasStrategy = !!row.strategy && row.strategy !== 'default' && row.strategy !== '';
  const hasValidPnl = row.pnlPercent !== undefined && row.pnlPercent !== null && !isNaN(Number(row.pnlPercent));
  const hasExitReason = !!row.exitReason && row.exitReason !== 'INVALID_PRICE';
  const hasOutcome = row.hitStopLoss !== undefined || row.hitTp1 !== undefined || row.hitTp2 !== undefined;

  const hardBlockReasons = ['missing_symbol', 'missing_strategy', 'missing_close_price', 'unavailable_close_price', 'invalid_price_exit', 'invalid_pnl', 'missing_exit_reason', 'no_outcome'];
  const hasHardBlock = reasons.some(r => hardBlockReasons.includes(r));
  const hasMediumIssues = reasons.some(r => r === 'v3_fallback_close_not_real' || r === 'v3_missing_close_price');
  const hasContradictions = warnings.length > 0;

  let dataQuality: ImportQuality;
  let mlUse: MLUse;
  let trainingWeight: number;
  let trainingEligible: boolean;

  if (hasHardBlock) {
    dataQuality = 'BAD';
    mlUse = 'excluded';
    trainingWeight = 0;
    trainingEligible = false;
  } else if (hasMediumIssues || hasContradictions || !hasRealPrice || !hasOutcome) {
    dataQuality = 'MEDIUM';
    mlUse = 'advisory_only';
    trainingWeight = 0.25;
    trainingEligible = false;
  } else if (hasRealPrice && hasSymbol && hasStrategy && hasValidPnl && hasExitReason && hasOutcome) {
    dataQuality = 'GOOD';
    mlUse = 'training';
    trainingWeight = row.source === 'v4_dataset' ? 0.8 : 0.5;
    trainingEligible = true;
  } else {
    dataQuality = 'MEDIUM';
    mlUse = 'advisory_only';
    trainingWeight = 0.25;
    trainingEligible = false;
  }

  if (dataQuality === 'GOOD' && reasons.length > 0) {
    warnings.push('GOOD quality with minor reasons: ' + reasons.join(', '));
  }

  return {
    dataQuality,
    mlUse,
    trainingWeight,
    trainingEligible,
    reasons,
    warnings,
  };
}
