import { logger } from '../../utils/logger';

export type QueueItemStatus = 'queued' | 'revalidating' | 'blocked' | 'executed' | 'expired';
export type AutoBuyExecutionModule = 'autobots' | 'unicorn_hunter' | 'ml_predict_buy' | 'global';

export interface AutoBuyQueueItem {
  id: string;
  symbol: string;
  candidateId: string;
  createdAt: number;
  scanCycleId: string;
  score: number;
  confidence: number;
  selectedStrategy: string;
  status: QueueItemStatus;
}

export interface AutoBuyQueueState {
  items: AutoBuyQueueItem[];
  lastBuyAt: number;
  lastBuyAtByModule: Partial<Record<AutoBuyExecutionModule, number>>;
  cooldownMs: number;
  cooldownMsByModule: Partial<Record<AutoBuyExecutionModule, number>>;
  maxQueuedAgeMs: number;
  buysInLast30s: string[];
}

const DEFAULT_COOLDOWN_MS = 30000;
const DEFAULT_MAX_QUEUED_AGE_MS = 15000; // candidates expire after 15s in queue
const RATE_LIMIT_WINDOW_MS = 30000;

let state: AutoBuyQueueState = {
  items: [],
  lastBuyAt: 0,
  lastBuyAtByModule: {},
  cooldownMs: DEFAULT_COOLDOWN_MS,
  cooldownMsByModule: {},
  maxQueuedAgeMs: DEFAULT_MAX_QUEUED_AGE_MS,
  buysInLast30s: [],
};

function cooldownMsForModule(module: AutoBuyExecutionModule): number {
  return Math.max(0, state.cooldownMsByModule[module] ?? state.cooldownMs);
}

function pruneExpired(): void {
  const now = Date.now();
  const before = state.items.length;
  state.items = state.items.filter(item => {
    const ageMs = now - item.createdAt;
    if (ageMs > state.maxQueuedAgeMs) {
      item.status = 'expired';
      logger.info(`BUY_QUEUE_CANDIDATE_EXPIRED symbol=${item.symbol} candidateId=${item.candidateId} queuedAt=${item.createdAt} ageMs=${ageMs} maxQueuedAgeMs=${state.maxQueuedAgeMs} action=expired`);
      return false;
    }
    return true;
  });
  if (state.items.length < before) {
    logger.info(`BUY_QUEUE_PRUNE_EXPIRED removed=${before - state.items.length} remaining=${state.items.length}`);
  }
}

function pruneRateWindow(): void {
  const now = Date.now();
  state.buysInLast30s = state.buysInLast30s.filter(buyId => {
    const ts = Number(buyId.split('_').pop() ?? '0');
    return (now - ts) < RATE_LIMIT_WINDOW_MS;
  });
}

export const autoBuyQueue = {
  getState(): Readonly<AutoBuyQueueState> {
    return { ...state, items: [...state.items], lastBuyAtByModule: { ...state.lastBuyAtByModule }, cooldownMsByModule: { ...state.cooldownMsByModule } };
  },

  setModuleCooldownMs(module: AutoBuyExecutionModule, cooldownMs: number): void {
    const resolved = Math.max(0, Math.floor(Number(cooldownMs) || 0));
    state.cooldownMsByModule[module] = resolved;
    logger.info(`AUTO_BUY_MODULE_COOLDOWN_CONFIGURED module=${module} cooldownMs=${resolved}`);
  },

  canSubmitBuy(module: AutoBuyExecutionModule = 'global'): boolean {
    const now = Date.now();
    const lastBuyAt = module === 'global' ? state.lastBuyAt : state.lastBuyAtByModule[module] ?? 0;
    const elapsed = now - lastBuyAt;
    return lastBuyAt === 0 || elapsed >= cooldownMsForModule(module);
  },

  cooldownRemainingMs(module: AutoBuyExecutionModule = 'global'): number {
    const now = Date.now();
    const lastBuyAt = module === 'global' ? state.lastBuyAt : state.lastBuyAtByModule[module] ?? 0;
    if (lastBuyAt === 0) return 0;
    const elapsed = now - lastBuyAt;
    return Math.max(0, cooldownMsForModule(module) - elapsed);
  },

  enqueue(params: {
    symbol: string;
    candidateId: string;
    scanCycleId: string;
    score: number;
    confidence: number;
    selectedStrategy: string;
  }): AutoBuyQueueItem {
    pruneExpired();
    const item: AutoBuyQueueItem = {
      id: `buy_q_${Date.now()}_${state.items.length}`,
      symbol: params.symbol,
      candidateId: params.candidateId,
      createdAt: Date.now(),
      scanCycleId: params.scanCycleId,
      score: params.score,
      confidence: params.confidence,
      selectedStrategy: params.selectedStrategy,
      status: 'queued',
    };
    state.items.push(item);
    logger.info(`BUY_QUEUE_ENQUEUED symbol=${params.symbol} candidateId=${params.candidateId} queuePosition=${state.items.length} itemsInQueue=${state.items.length}`);
    return item;
  },

  startRevalidation(symbol: string): AutoBuyQueueItem | null {
    pruneExpired();
    const item = state.items.find(i => i.symbol === symbol && i.status === 'queued');
    if (!item) return null;

    const ageMs = Date.now() - item.createdAt;
    if (ageMs > state.maxQueuedAgeMs) {
      item.status = 'expired';
      state.items = state.items.filter(i => i.id !== item.id);
      logger.info(`BUY_REVALIDATION_EXPIRED symbol=${symbol} queuedAt=${item.createdAt} ageMs=${ageMs} maxQueuedAgeMs=${state.maxQueuedAgeMs} action=expired_requires_rescan`);
      return null;
    }

    item.status = 'revalidating';
    logger.info(`BUY_REVALIDATION_STARTED symbol=${symbol} queuedAt=${item.createdAt} ageMs=${ageMs} scanCycleId=${item.scanCycleId} previousStrategy=${item.selectedStrategy} reason=pre_buy_revalidation`);
    return item;
  },

  markRevalidationResult(params: {
    symbol: string;
    passed: boolean;
    oldPrice?: number;
    freshPrice?: number;
    priceChangePct?: number;
    spreadOk: boolean;
    tpRoomOk: boolean;
    priceFresh: boolean;
    finalExecutable: boolean;
    buyAllowed: boolean;
    duplicateOpenPosition: boolean;
    pendingOrder: boolean;
    banned: boolean;
    blockReasons: string[];
  }): void {
    const item = state.items.find(i => i.symbol === params.symbol && i.status === 'revalidating');

    logger.info(`BUY_REVALIDATION_RESULT symbol=${params.symbol} passed=${params.passed} oldPrice=${params.oldPrice ?? 'n/a'} freshPrice=${params.freshPrice ?? 'n/a'} priceChangePct=${params.priceChangePct?.toFixed(2) ?? 'n/a'} spreadOk=${params.spreadOk} tpRoomOk=${params.tpRoomOk} priceFresh=${params.priceFresh} finalExecutable=${params.finalExecutable} buyAllowed=${params.buyAllowed} duplicateOpenPosition=${params.duplicateOpenPosition} pendingOrder=${params.pendingOrder} banned=${params.banned} blockReasons=${params.blockReasons.join('|') || 'none'} finalDecision=${params.passed ? 'ALLOW' : 'BLOCK'}`);

    if (!params.passed) {
      if (item) {
        item.status = 'blocked';
        state.items = state.items.filter(i => i.id !== item.id);
      }
    }
  },

  recordBuySubmitted(symbol: string, module: AutoBuyExecutionModule = 'global'): void {
    const now = Date.now();
    state.lastBuyAt = now;
    state.lastBuyAtByModule[module] = now;
    state.buysInLast30s.push(`${module}|${symbol}_${now}`);
    pruneRateWindow();

    // Mark matched queue items as executed
    const item = state.items.find(i => i.symbol === symbol);
    if (item) {
      item.status = 'executed';
      state.items = state.items.filter(i => i.id !== item.id);
    }

    // Log rate-limit invariant
    const moduleWindow = state.buysInLast30s.filter((buyId) => buyId.startsWith(`${module}|`));
    const moduleSymbols = moduleWindow.map(s => s.split('|')[1]?.split('_')[0] ?? s.split('_')[0]);
    const violation = moduleWindow.length > 1;
    logger.info(`AUTO_BUY_RATE_LIMIT_INVARIANT windowMs=${RATE_LIMIT_WINDOW_MS} module=${module} buysInWindow=${moduleWindow.length} symbolsInWindow=${moduleSymbols.join(',')} violation=${violation} blockedSymbols=${violation ? moduleSymbols.slice(1).join(',') : 'none'}`);

    if (violation) {
      logger.warn(`AUTO_BUY_RATE_LIMIT_VIOLATION: module=${module} ${moduleWindow.length} buys in last ${RATE_LIMIT_WINDOW_MS}ms. Symbols: ${moduleSymbols.join(',')}`);
    }
  },

  blockIfCooldownActive(symbol: string, module: AutoBuyExecutionModule = 'global'): { blocked: boolean; remainingMs: number } {
    const remaining = this.cooldownRemainingMs(module);
    const lastBuyAt = module === 'global' ? state.lastBuyAt : state.lastBuyAtByModule[module] ?? 0;
    const requiredCooldownMs = cooldownMsForModule(module);
    if (remaining > 0) {
      logger.info(`AUTO_BUY_COOLDOWN_BLOCKED symbol=${symbol} module=${module} lastAutoBuyAt=${lastBuyAt} elapsedMs=${Date.now() - lastBuyAt} requiredCooldownMs=${requiredCooldownMs} nextAllowedBuyAt=${new Date(Date.now() + remaining).toISOString()} reason=min_seconds_between_auto_buys`);
      return { blocked: true, remainingMs: remaining };
    }
    return { blocked: false, remainingMs: 0 };
  },

  isQueueEmpty(): boolean {
    pruneExpired();
    return state.items.filter(i => i.status === 'queued').length === 0;
  },

  getNextQueued(): AutoBuyQueueItem | null {
    pruneExpired();
    const queued = state.items
      .filter(i => i.status === 'queued')
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence);
    return queued[0] ?? null;
  },

  reset(): void {
    state = {
      items: [],
      lastBuyAt: 0,
      lastBuyAtByModule: {},
      cooldownMs: DEFAULT_COOLDOWN_MS,
      cooldownMsByModule: {},
      maxQueuedAgeMs: DEFAULT_MAX_QUEUED_AGE_MS,
      buysInLast30s: [],
    };
    logger.info('AUTO_BUY_QUEUE_RESET');
  },
};
