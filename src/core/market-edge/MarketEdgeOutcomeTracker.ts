export interface EdgeOutcomeSignal {
  id: string;
  symbol: string;
  signaledAt: number;
  signalPrice: number;
  edgeScore: number;
  scoreBucket: '60-69' | '70-79' | '80-89' | '90+';
}

export interface EdgeOutcome extends EdgeOutcomeSignal {
  return30s: number | null;
  return1m: number | null;
  return3m: number | null;
  return5m: number | null;
  return15m: number | null;
  maxFutureExcursionPct: number;
  maxAdverseExcursionPct: number;
  completedAt: number | null;
  hit1PctBeforeMinus1Pct: boolean;
  hit2PctBeforeMinus1Pct: boolean;
  hit3PctBeforeMinus1Pct: boolean;
}

interface PendingOutcome extends EdgeOutcome { prices: Array<{ at: number; value: number }>; }

export interface EdgeOutcomeBucketSummary {
  scoreBucket: EdgeOutcomeSignal['scoreBucket'];
  completed: number;
  averageReturn30s: number | null;
  averageReturn1m: number | null;
  averageReturn3m: number | null;
  averageReturn5m: number | null;
  averageReturn15m: number | null;
  positive5mRate: number | null;
  positive1mRate: number | null;
  positive3mRate: number | null;
  hit1PctBeforeMinus1PctRate: number | null;
  hit2PctBeforeMinus1PctRate: number | null;
  hit3PctBeforeMinus1PctRate: number | null;
  averageMfePct: number | null;
  averageMaePct: number | null;
}

export interface EdgeOutcomeSummary {
  pending: number;
  completed: number;
  buckets: EdgeOutcomeBucketSummary[];
}

function bucket(score: number): EdgeOutcomeSignal['scoreBucket'] {
  if (score >= 90) return '90+';
  if (score >= 80) return '80-89';
  if (score >= 70) return '70-79';
  return '60-69';
}

export class MarketEdgeOutcomeTracker {
  private pending = new Map<string, PendingOutcome>();
  private completed: EdgeOutcome[] = [];
  private lastSignalAtBySymbol = new Map<string, number>();
  constructor(private readonly maxSignals = 1_000, private readonly signalCooldownMs = 60_000) {}

  recordSignal(symbol: string, signaledAt: number, signalPrice: number, edgeScore: number): EdgeOutcomeSignal | null {
    if (!(signalPrice > 0) || edgeScore < 60) return null;
    if (signaledAt - (this.lastSignalAtBySymbol.get(symbol) ?? -Infinity) < this.signalCooldownMs) return null;
    const id = `${symbol}:${signaledAt}`;
    if (this.pending.has(id) || this.completed.some(row => row.id === id)) return null;
    const signal: PendingOutcome = { id, symbol, signaledAt, signalPrice, edgeScore, scoreBucket: bucket(edgeScore), return30s: null, return1m: null, return3m: null, return5m: null, return15m: null, maxFutureExcursionPct: 0, maxAdverseExcursionPct: 0, completedAt: null, hit1PctBeforeMinus1Pct: false, hit2PctBeforeMinus1Pct: false, hit3PctBeforeMinus1Pct: false, prices: [] };
    this.pending.set(id, signal);
    this.lastSignalAtBySymbol.set(symbol, signaledAt);
    this.prune();
    return signal;
  }

  ingestFuturePrice(symbol: string, at: number, value: number): void {
    if (!(value > 0)) return;
    for (const outcome of [...this.pending.values()]) {
      if (outcome.symbol !== symbol || at <= outcome.signaledAt) continue;
      const elapsed = at - outcome.signaledAt;
      if (elapsed > 15 * 60_000 + 5_000) { this.finish(outcome, at); continue; }
      const ret = ((value - outcome.signalPrice) / outcome.signalPrice) * 100;
      outcome.prices.push({ at, value });
      outcome.maxFutureExcursionPct = Math.max(outcome.maxFutureExcursionPct, ret);
      outcome.maxAdverseExcursionPct = Math.min(outcome.maxAdverseExcursionPct, ret);
      this.assignHorizon(outcome, elapsed, ret);
      if (elapsed >= 15 * 60_000) this.finish(outcome, at);
    }
  }

  private assignHorizon(outcome: PendingOutcome, elapsed: number, ret: number): void {
    const fields: Array<[number, keyof Pick<EdgeOutcome, 'return30s' | 'return1m' | 'return3m' | 'return5m' | 'return15m'>]> = [[30_000, 'return30s'], [60_000, 'return1m'], [180_000, 'return3m'], [300_000, 'return5m'], [900_000, 'return15m']];
    for (const [target, field] of fields) if (outcome[field] == null && elapsed >= target) outcome[field] = ret;
  }

  private finish(outcome: PendingOutcome, at: number): void {
    outcome.completedAt = at;
    const futureReturns = outcome.prices.map(point => ((point.value - outcome.signalPrice) / outcome.signalPrice) * 100);
    const hitBeforeStop = (target: number): boolean => {
      for (const value of futureReturns) { if (value <= -1) return false; if (value >= target) return true; }
      return false;
    };
    outcome.hit1PctBeforeMinus1Pct = hitBeforeStop(1);
    outcome.hit2PctBeforeMinus1Pct = hitBeforeStop(2);
    outcome.hit3PctBeforeMinus1Pct = hitBeforeStop(3);
    const { prices: _prices, ...result } = outcome;
    this.pending.delete(outcome.id);
    this.completed.push(result);
    this.prune();
  }

  private prune(): void {
    while (this.pending.size + this.completed.length > this.maxSignals) {
      if (this.completed.length) this.completed.shift();
      else this.pending.delete(this.pending.keys().next().value as string);
    }
    if (this.lastSignalAtBySymbol.size > this.maxSignals) {
      const activeSymbols = new Set([...this.pending.values()].map(row => row.symbol));
      for (const symbol of this.lastSignalAtBySymbol.keys()) {
        if (!activeSymbols.has(symbol)) this.lastSignalAtBySymbol.delete(symbol);
        if (this.lastSignalAtBySymbol.size <= this.maxSignals) break;
      }
    }
  }

  getOutcomes(): ReadonlyArray<EdgeOutcome> { return this.completed; }
  getSummary(): EdgeOutcomeSummary {
    const average = (values: Array<number | null>): number | null => {
      const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
      return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
    };
    const buckets: EdgeOutcomeSignal['scoreBucket'][] = ['60-69', '70-79', '80-89', '90+'];
    return {
      pending: this.pending.size,
      completed: this.completed.length,
      buckets: buckets.map(scoreBucket => {
        const rows = this.completed.filter(row => row.scoreBucket === scoreBucket);
        const returns1m = rows.map(row => row.return1m).filter((value): value is number => value != null && Number.isFinite(value));
        const returns3m = rows.map(row => row.return3m).filter((value): value is number => value != null && Number.isFinite(value));
        const returns5m = rows.map(row => row.return5m).filter((value): value is number => value != null && Number.isFinite(value));
        return {
          scoreBucket,
          completed: rows.length,
          averageReturn30s: average(rows.map(row => row.return30s)),
          averageReturn1m: average(rows.map(row => row.return1m)),
          averageReturn3m: average(rows.map(row => row.return3m)),
          averageReturn5m: average(rows.map(row => row.return5m)),
          averageReturn15m: average(rows.map(row => row.return15m)),
          positive1mRate: returns1m.length ? returns1m.filter(value => value > 0).length / returns1m.length : null,
          positive3mRate: returns3m.length ? returns3m.filter(value => value > 0).length / returns3m.length : null,
          positive5mRate: returns5m.length ? returns5m.filter(value => value > 0).length / returns5m.length : null,
          hit1PctBeforeMinus1PctRate: rows.length ? rows.filter(row => row.hit1PctBeforeMinus1Pct).length / rows.length : null,
          hit2PctBeforeMinus1PctRate: rows.length ? rows.filter(row => row.hit2PctBeforeMinus1Pct).length / rows.length : null,
          hit3PctBeforeMinus1PctRate: rows.length ? rows.filter(row => row.hit3PctBeforeMinus1Pct).length / rows.length : null,
          averageMfePct: average(rows.map(row => row.maxFutureExcursionPct)),
          averageMaePct: average(rows.map(row => row.maxAdverseExcursionPct)),
        };
      }),
    };
  }
  getStats(): { pending: number; completed: number; bounded: boolean } { return { pending: this.pending.size, completed: this.completed.length, bounded: this.pending.size + this.completed.length <= this.maxSignals }; }
}
