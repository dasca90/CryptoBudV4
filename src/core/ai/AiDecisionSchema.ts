import type { AiDecisionOutput } from './AiTakeoverTypes';

export const AI_ALLOWED_DECISIONS = ['BUY', 'WAIT', 'AVOID', 'BLOCK'] as const;

export const AI_DECISION_SCHEMA_DESCRIPTION = {
  decision: 'BUY | WAIT | AVOID | BLOCK',
  confidence: 'number from 0 to 1',
  professionalVerdict: 'string',
  strategy: 'ai_professional_dynamic',
  marketRead: {
    regime: 'string',
    btcEthAlignment: 'string',
    trendQuality: 'string',
    entryQuality: 'string',
    riskLevel: 'string',
  },
  retrospectiveSummary: {
    expectedUpsidePct: 'number',
    expectedDownsidePct: 'number',
    rangeClass: 'string',
    supportDistancePct: 'number',
    resistanceDistancePct: 'number',
    volatilityRisk: 'string',
  },
  tpPlan: {
    tp1Pct: 'number',
    tp1Reason: 'string',
    tp2Pct: '0',
  },
  riskPlan: {
    slPct: 'number',
    maxCapitalUsd: 'number',
    riskRewardRatio: 'number',
  },
  executionIntent: {
    wantsBuy: 'boolean',
    urgency: 'low | normal | high',
    rejectIf: 'string[]',
  },
  reason: 'string',
} as const;

export function getDefaultAiDecisionOutput(reason = 'AI decision not provided.'): AiDecisionOutput {
  return {
    decision: 'BLOCK',
    confidence: 0,
    professionalVerdict: 'BLOCKED',
    strategy: 'ai_professional_dynamic',
    marketRead: {
      regime: 'unknown',
      btcEthAlignment: 'unknown',
      trendQuality: 'unknown',
      entryQuality: 'unknown',
      riskLevel: 'high',
    },
    retrospectiveSummary: {
      expectedUpsidePct: 0,
      expectedDownsidePct: 0,
      rangeClass: 'unknown',
      supportDistancePct: 0,
      resistanceDistancePct: 0,
      volatilityRisk: 'unknown',
    },
    tpPlan: {
      tp1Pct: 0,
      tp1Reason: reason,
      tp2Pct: 0,
    },
    riskPlan: {
      slPct: 0,
      maxCapitalUsd: 0,
      riskRewardRatio: 0,
    },
    executionIntent: {
      wantsBuy: false,
      urgency: 'low',
      rejectIf: [],
    },
    reason,
  };
}

export function createAiSchemaSystemPrompt(): string {
  return [
    'Return strict JSON only. No markdown. No prose outside JSON.',
    'Allowed decision values are BUY, WAIT, AVOID, BLOCK.',
    'No free text can trigger execution. BUY only creates a BUY_INTENT.',
    'TP2 must always be 0.',
    'Use exactly this object shape:',
    JSON.stringify(AI_DECISION_SCHEMA_DESCRIPTION, null, 2),
  ].join('\n');
}
