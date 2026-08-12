import type { MarketEdgeSnapshot } from './types';

export class MarketEdgeSnapshotStore {
  private readonly snapshots = new Map<string, MarketEdgeSnapshot>();
  private cacheHits = 0;
  private cacheMisses = 0;
  constructor(private maxSymbols = 100) {}

  setMaxSymbols(value: number): void { this.maxSymbols = Math.max(1, Math.round(value)); this.prune(); }
  set(snapshot: MarketEdgeSnapshot): void {
    const current = this.snapshots.get(snapshot.symbol);
    if (current && current.calculatedAt >= snapshot.calculatedAt) return;
    this.snapshots.delete(snapshot.symbol);
    this.snapshots.set(snapshot.symbol, snapshot);
    this.prune();
  }
  get(symbol: string): Readonly<MarketEdgeSnapshot> | null {
    const snapshot = this.snapshots.get(symbol.toUpperCase()) ?? null;
    if (snapshot) this.cacheHits++; else this.cacheMisses++;
    return snapshot;
  }
  top(limit: number): ReadonlyArray<MarketEdgeSnapshot> { return [...this.snapshots.values()].sort((a, b) => b.edgeScore - a.edgeScore || b.calculatedAt - a.calculatedAt).slice(0, Math.max(0, limit)); }
  clear(): void { this.snapshots.clear(); }
  retainSymbols(symbols: ReadonlySet<string>): void { for (const symbol of this.snapshots.keys()) if (!symbols.has(symbol)) this.snapshots.delete(symbol); }
  getCacheStats(): { edgeCacheHits: number; edgeCacheMisses: number } { return { edgeCacheHits: this.cacheHits, edgeCacheMisses: this.cacheMisses }; }
  get size(): number { return this.snapshots.size; }
  private prune(): void { while (this.snapshots.size > this.maxSymbols) this.snapshots.delete(this.snapshots.keys().next().value as string); }
}
