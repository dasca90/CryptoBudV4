export class BoundedTimeSeries<T extends { eventTime: number }> {
  private values: T[] = [];
  private lastEventTime = -Infinity;

  constructor(private readonly maxSamples: number, private readonly maxAgeMs: number) {}

  push(value: T, now = value.eventTime): boolean {
    if (!Number.isFinite(value.eventTime) || value.eventTime <= this.lastEventTime) return false;
    this.lastEventTime = value.eventTime;
    this.values.push(value);
    this.prune(now);
    return true;
  }

  prune(now: number): void {
    const cutoff = now - this.maxAgeMs;
    let remove = 0;
    while (remove < this.values.length && this.values[remove].eventTime < cutoff) remove++;
    if (remove > 0) this.values.splice(0, remove);
    if (this.values.length > this.maxSamples) this.values.splice(0, this.values.length - this.maxSamples);
  }

  snapshot(): readonly T[] { return this.values; }
  latest(): T | null { return this.values[this.values.length - 1] ?? null; }
  get size(): number { return this.values.length; }
  clear(): void { this.values = []; this.lastEventTime = -Infinity; }
}
