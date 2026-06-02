import type { PlaybookInput, PlaybookResult, PlaybookSelection, PlaybookName } from '../types';

function evaluateMomentum(input: PlaybookInput): PlaybookResult {
  const reasons: string[] = [];
  const blockReasons: string[] = [];

  if (input.overextended) blockReasons.push('overextended');
  if (!input.momentumConfirmed) blockReasons.push('momentum_not_confirmed');
  if (!input.volumePass) blockReasons.push('volume_required_missing');
  if (!input.priceFresh) blockReasons.push('stale_price');
  if (!input.spreadOk) blockReasons.push('spread_too_high');
  if (!input.tpRoomOk) blockReasons.push('no_tp_room');
  if (input.btcDumping && input.isAlt) blockReasons.push('btc_dumping_alt_block');

  if (input.momentumConfirmed) reasons.push('momentum_confirmed');
  if (input.volumePass) reasons.push('volume_ok');
  if (input.tpRoomOk) reasons.push('tp_room_ok');
  if (input.marketRegime === 'uptrend') reasons.push('uptrend_support');
  if (input.relativeStrengthVsBtc > 0) reasons.push('relative_strength_vs_btc');

  const score = input.momentumConfirmed && input.volumePass && input.tpRoomOk ? 80 : 0;
  score - blockReasons.length * 15;

  return {
    eligible: blockReasons.length === 0,
    score: Math.max(0, score),
    reasons,
    blockReasons,
    requiresVolume: true,
    requiresMomentum: true,
    requiresRebound: false,
    requiresDip: false,
  };
}

function evaluateBalanced(input: PlaybookInput): PlaybookResult {
  const reasons: string[] = [];
  const blockReasons: string[] = [];

  if (input.overextended) blockReasons.push('overextended');
  if (!input.tpRoomOk) blockReasons.push('no_tp_room');
  if (!input.priceFresh) blockReasons.push('stale_price');
  if (!input.spreadOk) blockReasons.push('spread_too_high');
  if (input.btcDumping && input.isAlt) blockReasons.push('btc_dumping_alt_block');

  if (input.dipDetected && input.reboundConfirmed) {
    reasons.push('dip_and_rebound_confirmed');
  } else if (input.dipDetected && !input.reboundConfirmed) {
    blockReasons.push('dip_without_rebound');
  }

  if (input.reboundConfirmed) reasons.push('rebound_confirmed');
  if (input.dipDetected) reasons.push('dip_detected');
  if (input.tpRoomOk) reasons.push('tp_room_ok');
  if (input.volumePass) reasons.push('volume_ok');

  const score = (input.reboundConfirmed ? 40 : 0) + (input.dipDetected ? 20 : 0) + (input.volumePass ? 20 : 0);

  return {
    eligible: blockReasons.length === 0,
    score: Math.max(0, score),
    reasons,
    blockReasons,
    requiresVolume: false,
    requiresMomentum: false,
    requiresRebound: true,
    requiresDip: false,
  };
}

function evaluateDipAndRebound(input: PlaybookInput): PlaybookResult {
  const reasons: string[] = [];
  const blockReasons: string[] = [];

  if (!input.dipDetected) blockReasons.push('no_dip_detected');
  if (!input.reboundConfirmed) blockReasons.push('rebound_not_confirmed');
  if (!input.tpRoomOk) blockReasons.push('no_tp_room');
  if (!input.priceFresh) blockReasons.push('stale_price');
  if (!input.spreadOk) blockReasons.push('spread_too_high');
  if (input.overextended) blockReasons.push('overextended');
  if (input.btcDumping && input.isAlt) blockReasons.push('btc_dumping_alt_block');

  if (input.dipDetected) reasons.push('dip_detected');
  if (input.reboundConfirmed) reasons.push('rebound_confirmed');
  if (input.reboundPct > 1) reasons.push('strong_rebound');
  if (input.volumePass) reasons.push('volume_confirms_rebound');
  if (input.tpRoomOk) reasons.push('tp_room_ok');

  const score = (input.dipDetected ? 30 : 0) + (input.reboundConfirmed ? 50 : 0) + (input.volumePass ? 20 : 0);

  return {
    eligible: blockReasons.length === 0,
    score: Math.max(0, score),
    reasons,
    blockReasons,
    requiresVolume: false,
    requiresMomentum: false,
    requiresRebound: true,
    requiresDip: true,
  };
}

function evaluateConservative(input: PlaybookInput): PlaybookResult {
  const reasons: string[] = [];
  const blockReasons: string[] = [];

  if (input.marketRegime === 'downtrend') blockReasons.push('downtrend_block');
  if (input.btcRegime === 'downtrend' && input.isAlt) blockReasons.push('btc_downtrend_alt_block');
  if (input.btcDumping) blockReasons.push('btc_dumping');
  if (!input.tpRoomOk) blockReasons.push('no_tp_room');
  if (!input.priceFresh) blockReasons.push('stale_price');
  if (!input.spreadOk) blockReasons.push('spread_too_high');
  if (input.overextended) blockReasons.push('overextended');
  if (!input.volumePass) blockReasons.push('volume_too_low');
  if (input.isAlt && input.relativeStrengthVsBtc < -2) blockReasons.push('alt_weak_vs_btc');

  if (input.marketRegime === 'uptrend') reasons.push('uptrend');
  if (input.tpRoomOk) reasons.push('tp_room_ok');
  if (input.volumePass) reasons.push('volume_ok');
  if (input.reboundConfirmed) reasons.push('rebound_confirmed');
  if (input.dipDetected && input.reboundConfirmed) reasons.push('dip_and_rebound');
  if (input.momentumConfirmed) reasons.push('momentum_confirmed');

  const score = (input.marketRegime === 'uptrend' ? 30 : 0) + (input.reboundConfirmed ? 30 : 0) + (input.volumePass ? 20 : 0) + (input.tpRoomOk ? 20 : 0);

  return {
    eligible: blockReasons.length === 0,
    score: Math.max(0, score),
    reasons,
    blockReasons,
    requiresVolume: true,
    requiresMomentum: false,
    requiresRebound: false,
    requiresDip: false,
  };
}

const PLAYBOOK_EVALUATORS: Record<PlaybookName, (input: PlaybookInput) => PlaybookResult> = {
  momentum: evaluateMomentum,
  balanced: evaluateBalanced,
  dipAndRebound: evaluateDipAndRebound,
  conservative: evaluateConservative,
};

export function evaluatePlaybook(name: PlaybookName, input: PlaybookInput): PlaybookResult {
  const evaluator = PLAYBOOK_EVALUATORS[name];
  if (!evaluator) {
    return {
      eligible: false, score: 0, reasons: [], blockReasons: ['unknown_playbook'],
      requiresVolume: false, requiresMomentum: false, requiresRebound: false, requiresDip: false,
    };
  }
  return evaluator(input);
}

export function selectPlaybook(input: PlaybookInput): PlaybookSelection {
  const results: { name: PlaybookName; result: PlaybookResult }[] = [];

  for (const name of Object.keys(PLAYBOOK_EVALUATORS) as PlaybookName[]) {
    results.push({ name, result: evaluatePlaybook(name, input) });
  }

  const eligible = results.filter(r => r.result.eligible);

  if (eligible.length === 0) {
    const noTradeReason = input.marketRegime === 'downtrend'
      ? 'bearish_market_no_valid_playbook'
      : input.marketRegime === 'choppy'
        ? 'choppy_market_no_valid_playbook'
        : 'no_valid_playbook_for_current_setup';

    return { selectedStrategy: 'wait', selectedPlaybook: null, noTradeReason };
  }

  eligible.sort((a, b) => b.result.score - a.result.score);
  const best = eligible[0];

  return { selectedStrategy: best.name, selectedPlaybook: best.result, noTradeReason: null };
}
