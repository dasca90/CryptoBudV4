export type UnicornFinalBlockReason =
  | 'none'
  | 'UNICORN_BLOCK_DUPLICATE_POSITION'
  | 'UNICORN_BLOCK_OPEN_POSITION_LIMIT'
  | 'UNICORN_BLOCK_GROUP_LIMIT'
  | 'UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED'
  | 'UNICORN_BLOCK_COOLDOWN_ACTIVE'
  | 'UNICORN_BLOCK_DAILY_LIMIT'
  | 'UNICORN_BLOCK_STAGE_NOT_EXECUTABLE'
  | 'UNICORN_BLOCK_BREAKOUT_NOT_CONFIRMED'
  | 'UNICORN_BLOCK_MOMENTUM_NOT_CONFIRMED'
  | 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED'
  | 'UNICORN_COOLDOWN_ACTIVE'
  | 'UNICORN_MAX_OPEN_POSITIONS_REACHED'
  | 'UNICORN_MAX_TRADES_PER_DAY_REACHED'
  | 'GLOBAL_MAX_OPEN_POSITIONS_REACHED'
  | 'MAX_EXECUTION_QUEUE_REACHED'
  | 'MAX_CAPITAL_ALLOCATION_REACHED'
  | 'STAGE_NOT_EXECUTABLE'
  | 'STRATEGY_HANDOFF_INTEGRITY_FAILED'
  | 'DIP_NOT_CONFIRMED'
  | 'BREAKOUT_NOT_CONFIRMED'
  | 'MOMENTUM_NOT_CONFIRMED'
  | 'UNICORN_BLOCK_WAITING_CONFIRMATION'
  | 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE'
  | 'UNICORN_BLOCK_RISK';

export function normalizeUnicornFinalBlockReason(reason: unknown): UnicornFinalBlockReason {
  const raw = String(reason ?? '').trim();
  const lower = raw.toLowerCase();
  if (!lower || lower === 'none') return 'none';
  if (lower === 'scanner_cycle_started' || lower === 'evaluating' || lower === 'running') {
    return 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE';
  }
  if (lower.includes('duplicate') || lower.includes('already') || lower.includes('existing_position')) {
    return 'UNICORN_BLOCK_DUPLICATE_POSITION';
  }
  if (lower.includes('unicorn_block_max_new_buys_per_cycle_reached') || lower.includes('unicorn_max_buys_per_cycle') || lower.includes('unicorn_max_new_buys_per_cycle') || lower.includes('unicorn_cycle_budget')) {
    return 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
  }
  if (lower.includes('cooldown')) {
    return 'UNICORN_COOLDOWN_ACTIVE';
  }
  if (lower.includes('breakout_not_confirmed') || lower.includes('failed_breakout')) {
    return 'BREAKOUT_NOT_CONFIRMED';
  }
  if (lower.includes('momentum_not_confirmed') || lower.includes('waiting_momentum')) {
    return 'MOMENTUM_NOT_CONFIRMED';
  }
  if (lower.includes('dip_not_confirmed') || lower.includes('dp_not_confirmed')) {
    return 'DIP_NOT_CONFIRMED';
  }
  if (lower.includes('strategy_handoff_integrity_failed')) {
    return 'STRATEGY_HANDOFF_INTEGRITY_FAILED';
  }
  if (
    lower.includes('stage_not_executable')
    || lower.includes('momentum_building')
    || lower.includes('early_watch')
    || lower.includes('accumulating')
    || lower.includes('pullback_wait')
    || lower.includes('rebound_confirm')
    || lower.includes('radar_ready')
  ) {
    return 'STAGE_NOT_EXECUTABLE';
  }
  if (lower.includes('group') && (lower.includes('limit') || lower.includes('cap') || lower.includes('max') || lower.includes('disabled'))) {
    return 'UNICORN_BLOCK_GROUP_LIMIT';
  }
  if (lower.includes('daily') || lower.includes('trades_per_day')) {
    return 'UNICORN_MAX_TRADES_PER_DAY_REACHED';
  }
  if (
    lower.includes('max_execution_queue')
    || lower.includes('block_max_execution_queue')
    || (lower.includes('queue') && lower.includes('max'))
  ) {
    return 'MAX_EXECUTION_QUEUE_REACHED';
  }
  if (
    lower.includes('max_capital')
    || lower.includes('capital_limit')
    || lower.includes('capital_block')
    || lower.includes('capital_exhausted')
    || lower.includes('capital_allocation')
  ) {
    return 'MAX_CAPITAL_ALLOCATION_REACHED';
  }
  if (
    lower.includes('buy_budget')
    || lower.includes('max_new_buys_per_cycle')
    || (lower.includes('cycle') && lower.includes('max'))
  ) {
    return 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED';
  }
  if (lower.includes('global_max_open') || lower.includes('max_global_position') || lower.includes('max_global_positions')) {
    return 'GLOBAL_MAX_OPEN_POSITIONS_REACHED';
  }
  if (lower.includes('max_unicorn_position') || lower.includes('unicorn_open_position') || lower.includes('max_unicorn_open')) {
    return 'UNICORN_MAX_OPEN_POSITIONS_REACHED';
  }
  if (
    lower.includes('max_open')
    || lower.includes('max_positions')
    || lower.includes('open_position_limit')
    || lower.includes('position_limit')
  ) {
    return 'UNICORN_MAX_OPEN_POSITIONS_REACHED';
  }
  if (
    lower.includes('waiting')
    || lower.includes('wait')
    || lower.includes('confirmation')
    || lower.includes('pullback')
    || lower.includes('rebound')
    || lower.includes('watch')
    || lower.includes('score')
    || lower.includes('confidence')
    || lower.includes('mode_watch_only')
  ) {
    return 'UNICORN_BLOCK_WAITING_CONFIRMATION';
  }
  if (
    lower.includes('no_executable')
    || lower.includes('not_executable')
    || lower.includes('no_unicorn_ready')
    || lower.includes('no_ready')
    || lower.includes('no_candidate')
    || lower.includes('not_selected_by_planner')
    || lower.includes('filtered_before_planner')
    || lower.includes('selected_no_submit')
    || lower.includes('selected_but_skipped')
  ) {
    return 'UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE';
  }
  return 'UNICORN_BLOCK_RISK';
}

export function unicornStageForFinalBlockReason(reason: unknown): 'BLOCKED_BY_BUY_BUDGET' | 'BLOCKED_BY_OPEN_POSITION_LIMIT' | 'BLOCKED_BY_RISK' | 'READY_BLOCKED' {
  const canonical = normalizeUnicornFinalBlockReason(reason);
  if (canonical === 'UNICORN_BLOCK_MAX_NEW_BUYS_PER_CYCLE_REACHED' || canonical === 'UNICORN_MAX_BUYS_PER_CYCLE_REACHED' || canonical === 'UNICORN_BLOCK_COOLDOWN_ACTIVE' || canonical === 'UNICORN_COOLDOWN_ACTIVE') return 'BLOCKED_BY_BUY_BUDGET';
  if (canonical === 'UNICORN_BLOCK_DUPLICATE_POSITION' || canonical === 'UNICORN_BLOCK_OPEN_POSITION_LIMIT' || canonical === 'UNICORN_MAX_OPEN_POSITIONS_REACHED' || canonical === 'GLOBAL_MAX_OPEN_POSITIONS_REACHED') return 'BLOCKED_BY_OPEN_POSITION_LIMIT';
  if (canonical === 'UNICORN_BLOCK_GROUP_LIMIT' || canonical === 'UNICORN_BLOCK_DAILY_LIMIT' || canonical === 'UNICORN_MAX_TRADES_PER_DAY_REACHED' || canonical === 'UNICORN_BLOCK_RISK') return 'BLOCKED_BY_RISK';
  return 'READY_BLOCKED';
}
