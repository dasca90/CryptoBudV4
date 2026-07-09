import type { AiDecisionOutput, AiTakeoverConfig, AiTakeoverMode } from './AiTakeoverTypes';

export interface RiskGuardResult {
  allowed: boolean;
  reason: string;
  blockedBy: string[];
  adjustedOutput: AiDecisionOutput;
}

export class AiTakeoverRiskGuard {
  private dailyTradeCount = 0;
  private activePositionCount = 0;
  private lastResetDay = new Date().getDate();

  setActivePositionCount(count: number): void {
    this.activePositionCount = count;
  }

  async evaluate(
    output: AiDecisionOutput,
    config: AiTakeoverConfig,
    mode: AiTakeoverMode,
  ): Promise<RiskGuardResult> {
    const blockedBy: string[] = [];
    this.checkDailyReset();

    if (mode === 'OFF') {
      return {
        allowed: false,
        reason: 'AI Takeover is OFF.',
        blockedBy: ['AI_TAKEOVER_OFF'],
        adjustedOutput: output,
      };
    }

    if (output.action !== 'BUY') {
      return {
        allowed: false,
        reason: `AI decision is ${output.action}, not BUY.`,
        blockedBy: ['NOT_BUY_DECISION'],
        adjustedOutput: output,
      };
    }

    if (output.confidenceScore < config.minConfidenceScore) {
      blockedBy.push('LOW_CONFIDENCE');
    }

    if (this.activePositionCount >= config.maxConcurrentAiPositions) {
      blockedBy.push('MAX_CONCURRENT_POSITIONS');
    }

    if (this.dailyTradeCount >= config.maxAiTradesPerDay) {
      blockedBy.push('DAILY_TRADE_LIMIT');
    }

    if (mode === 'LIVE_LOCKED') {
      blockedBy.push('LIVE_LOCKED_MODE');
    }

    if (output.tp2Pct !== undefined && output.tp2Pct > 0) {
      output.tp2Pct = 0;
    }

    if (blockedBy.length > 0) {
      return {
        allowed: false,
        reason: `Blocked by: ${blockedBy.join(', ')}`,
        blockedBy,
        adjustedOutput: output,
      };
    }

    return {
      allowed: true,
      reason: 'All risk checks passed.',
      blockedBy: [],
      adjustedOutput: output,
    };
  }

  recordTradeExecuted(): void {
    this.dailyTradeCount++;
  }

  recordPositionOpened(): void {
    this.activePositionCount++;
  }

  recordPositionClosed(): void {
    this.activePositionCount = Math.max(0, this.activePositionCount - 1);
  }

  private checkDailyReset(): void {
    const today = new Date().getDate();
    if (today !== this.lastResetDay) {
      this.dailyTradeCount = 0;
      this.lastResetDay = today;
    }
  }
}
