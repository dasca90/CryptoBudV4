export class AiProviderRateLimiter {
  private nextAllowedAt = 0;

  constructor(private readonly minIntervalMs = 250) {}

  async wait(): Promise<void> {
    const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.nextAllowedAt = Date.now() + this.minIntervalMs;
  }

  backoff(ms: number): void {
    this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + Math.max(0, ms));
  }
}
