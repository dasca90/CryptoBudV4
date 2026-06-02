import type { ExitInput, ExitDecision, ExitReason, DynamicTrailInput } from '../types';
import { evaluateDynamicTrailFloor } from './dynamic-trailing';

export class ExitEngine {
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

    // 7. Time-based exit
    if (input.maxHoldSec > 0) {
      const elapsedSec = (Date.now() - input.openedAt) / 1000;
      if (elapsedSec >= input.maxHoldSec) {
        return {
          action: 'EXIT', exitReason: 'TIME_BASED_EXIT', exitPrice: input.currentPrice,
          pnlPercent, pnlUsd, shouldClosePosition: true, warnings,
          audit: { ...audit, timeBasedExit: true, elapsedSec, maxHoldSec: input.maxHoldSec },
        };
      }
    }

    return {
      action: 'HOLD', exitReason: null, exitPrice: input.currentPrice,
      pnlPercent, pnlUsd, shouldClosePosition: false, warnings, audit,
    };
  }
}
