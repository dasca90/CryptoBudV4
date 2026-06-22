import type { ExitInput, ExitDecision, ExitReason, DynamicTrailInput } from '../types';
import { evaluateDynamicTrailFloor } from './dynamic-trailing';
import { logger } from '../../utils/logger';

export class ExitEngine {
  private timeBasedExitsThisCycle = 0;
  private currentCycleId = 0;

  startCycle(cycleId: number): void {
    this.currentCycleId = cycleId;
    this.timeBasedExitsThisCycle = 0;
  }

  evaluateExit(input: ExitInput): ExitDecision {
    const warnings: string[] = [];
    const audit: Record<string, unknown> = {};

    // 1. Invalid price guard
    if (input.currentPrice <= 0 || isNaN(input.currentPrice) || input.currentPrice === null) {
      warnings.push('Invalid current price');
      return {
        action: 'HOLD', exitReason: 'INVALID_PRICE', exitPrice: 0,
        pnlPercent: 0, pnlUsd: 0, shouldClosePosition: false,
        warnings, audit: { ...audit, invalidPrice: true },
      };
    }

    const pnlPercent = ((input.currentPrice - input.entryPrice) / input.entryPrice) * 100;
    const pnlUsd = (input.currentPrice - input.entryPrice) * input.quantity;

    // 2. Stop Loss — checked BEFORE trailing
    if (pnlPercent <= -input.stopLossPercent) {
      return {
        action: 'EXIT', exitReason: 'STOP_LOSS', exitPrice: input.currentPrice,
        pnlPercent, pnlUsd, shouldClosePosition: true, warnings,
        audit: { ...audit, stopLossHit: true, slPercent: input.stopLossPercent, pnlPercent },
      };
    }

    // 3. TP1 fixed
    if (!input.tp1Hit && input.currentPrice >= input.entryPrice * (1 + input.tp1Percent / 100)) {
      return {
        action: 'EXIT', exitReason: 'TP1_FIXED', exitPrice: input.currentPrice,
        pnlPercent, pnlUsd, shouldClosePosition: true, warnings,
        audit: { ...audit, tp1Hit: true, tp1Percent: input.tp1Percent, pnlPercent },
      };
    }

    // 4. TP2 fixed (tp1 must have been hit first)
    if (input.tp1Hit && !input.tp2Hit && input.currentPrice >= input.entryPrice * (1 + input.tp2Percent / 100)) {
      return {
        action: 'EXIT', exitReason: 'TP2_FIXED', exitPrice: input.currentPrice,
        pnlPercent, pnlUsd, shouldClosePosition: true, warnings,
        audit: { ...audit, tp2Hit: true, tp2Percent: input.tp2Percent, pnlPercent },
      };
    }

    // 5. Dynamic trailing (only if TP1 armed — price reached above entry)
    if (input.tpArmed && input.trailFromPeakPercent > 0) {
      const trailInput: DynamicTrailInput = {
        entryPrice: input.entryPrice,
        tp1Percent: input.tp1Percent,
        highestPriceSinceTp: Math.max(input.highestPriceSinceTp, input.currentPrice),
        trailFromPeakPercent: input.trailFromPeakPercent,
        currentMarketPrice: input.currentPrice,
      };
      const trailResult = evaluateDynamicTrailFloor(trailInput);
      audit.dynamicTrail = trailResult;

      if (trailResult.shouldExit) {
        const reason: ExitReason = trailResult.exitReason === 'dynamic_trail_floor_exit'
          ? 'DYNAMIC_TRAIL_FLOOR'
          : 'DYNAMIC_TRAIL';
        const trailPnlPercent = ((trailResult.exitPrice - input.entryPrice) / input.entryPrice) * 100;
        const trailPnlUsd = (trailResult.exitPrice - input.entryPrice) * input.quantity;
        return {
          action: 'EXIT', exitReason: reason, exitPrice: trailResult.exitPrice,
          pnlPercent: trailPnlPercent, pnlUsd: trailPnlUsd, shouldClosePosition: true, warnings,
          audit: { ...audit, dynamicTrailHit: true },
        };
      }
    }

    // 6. Armed trailing (retrace-based, placeholder)
    // Future: evaluate armed trail from high

    // 7. Time-based exit — only if enabled, resume guard inactive, and within batch limit
    if (input.maxHoldSec > 0) {
      const elapsedSec = (Date.now() - input.openedAt) / 1000;
      const holdHours = elapsedSec / 3600;
      const freshPriceOk = input.currentPrice > 0 && input.priceAgeMs <= 30000;
      const exitAllowed = input.timeBasedExitEnabled
        && !input.resumeGuardActive
        && freshPriceOk
        && this.timeBasedExitsThisCycle < input.maxTimeBasedExitsPerCycle
        && input.exitCyclesSinceHydration >= 6;
      let blockedReason = 'none';

      if (!input.timeBasedExitEnabled) blockedReason = 'time_based_exit_disabled';
      else if (input.resumeGuardActive) blockedReason = 'resume_guard_active';
      else if (input.exitCyclesSinceHydration < 6) blockedReason = 'too_few_cycles_since_hydration';
      else if (!freshPriceOk) blockedReason = 'stale_or_unknown_price';
      else if (this.timeBasedExitsThisCycle >= input.maxTimeBasedExitsPerCycle) blockedReason = 'batch_limit_reached';

      if (elapsedSec >= input.maxHoldSec) {
        logger.info(
          `TIME_BASED_EXIT_EVALUATION_AUDIT: ` +
          `symbol=${input.coin} ` +
          `positionId=${input.coin} ` +
          `openedAt=${new Date(input.openedAt).toISOString()} ` +
          `holdHours=${holdHours.toFixed(2)} ` +
          `maxHoldHours=${input.maxHoldSec / 3600} ` +
          `timeBasedExitEnabled=${String(input.timeBasedExitEnabled)} ` +
          `resumeGuardActive=${String(input.resumeGuardActive)} ` +
          `exitCyclesSinceHydration=${input.exitCyclesSinceHydration} ` +
          `freshPriceOk=${String(freshPriceOk)} ` +
          `priceAgeMs=${input.priceAgeMs} ` +
          `exitAllowed=${String(exitAllowed)} ` +
          `blockedReason=${blockedReason} ` +
          `batchExitsThisCycle=${this.timeBasedExitsThisCycle} ` +
          `maxExitsPerCycle=${input.maxTimeBasedExitsPerCycle} ` +
          `logCategory=INFO`
        );

        if (exitAllowed) {
          this.timeBasedExitsThisCycle++;
          logger.info(
            `TIME_BASED_EXIT_EXECUTED_AUDIT: ` +
            `symbol=${input.coin} ` +
            `entryPrice=${input.entryPrice} ` +
            `exitPrice=${input.currentPrice} ` +
            `pnlPct=${pnlPercent.toFixed(2)} ` +
            `pnlUsd=${pnlUsd.toFixed(2)} ` +
            `holdHours=${holdHours.toFixed(2)} ` +
            `reason=time_based_exit ` +
            `priceSource=exit_evaluation ` +
            `priceAgeMs=${input.priceAgeMs} ` +
            `logCategory=INFO`
          );
          return {
            action: 'EXIT', exitReason: 'TIME_BASED_EXIT', exitPrice: input.currentPrice,
            pnlPercent, pnlUsd, shouldClosePosition: true, warnings,
            audit: { ...audit, timeBasedExit: true, elapsedSec, maxHoldSec: input.maxHoldSec, blockedReason },
          };
        }
      }
    }

    return {
      action: 'HOLD', exitReason: null, exitPrice: input.currentPrice,
      pnlPercent, pnlUsd, shouldClosePosition: false, warnings, audit,
    };
  }
}
