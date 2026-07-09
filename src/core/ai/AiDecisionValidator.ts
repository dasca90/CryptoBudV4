import type { AiDecisionOutput, AiTakeoverConfig } from './AiTakeoverTypes';
import { AI_ALLOWED_DECISIONS, getDefaultAiDecisionOutput } from './AiDecisionSchema';

export interface ValidationResult {
  valid: boolean;
  output: AiDecisionOutput;
  errors: string[];
  warnings: string[];
  blockedReason: string | null;
}

export function validateAiResponse(raw: string, config: AiTakeoverConfig): ValidationResult {
  if (!raw || raw.trim().length === 0) {
    return invalid('AI_SCHEMA_INVALID', 'Empty AI response.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return invalid('AI_SCHEMA_INVALID', 'Invalid JSON in AI response.');
  }

  if (!isRecord(parsed)) {
    return invalid('AI_SCHEMA_INVALID', 'AI response is not a JSON object.');
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  requireString(parsed, 'decision', errors);
  requireNumber(parsed, 'confidence', errors);
  requireString(parsed, 'professionalVerdict', errors);
  requireString(parsed, 'strategy', errors);
  requireObject(parsed, 'marketRead', errors);
  requireObject(parsed, 'retrospectiveSummary', errors);
  requireObject(parsed, 'tpPlan', errors);
  requireObject(parsed, 'riskPlan', errors);
  requireObject(parsed, 'executionIntent', errors);
  requireString(parsed, 'reason', errors);

  if (typeof parsed.decision === 'string' && !AI_ALLOWED_DECISIONS.includes(parsed.decision as any)) {
    errors.push('AI_DECISION_INVALID');
  }

  const retrospectiveSummary = isRecord(parsed.retrospectiveSummary) ? parsed.retrospectiveSummary : null;
  if (!retrospectiveSummary) {
    errors.push('RETROSPECTIVE_SUMMARY_MISSING');
  }

  const tpPlan = isRecord(parsed.tpPlan) ? parsed.tpPlan : null;
  if (!tpPlan || typeof tpPlan.tp1Pct !== 'number') {
    errors.push('AI_TP1_MISSING');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      output: getDefaultAiDecisionOutput(errors[0] ?? 'AI_SCHEMA_INVALID'),
      errors,
      warnings,
      blockedReason: errors.includes('AI_DECISION_INVALID') ? 'AI_DECISION_INVALID' : 'AI_SCHEMA_INVALID',
    };
  }

  const output = coerceOutput(parsed as Record<string, unknown>);
  if (output.confidence < config.minConfidence) {
    return {
      valid: false,
      output,
      errors: ['AI_CONFIDENCE_TOO_LOW'],
      warnings,
      blockedReason: 'AI_CONFIDENCE_TOO_LOW',
    };
  }

  if (output.tpPlan.tp1Pct < config.minTp1Pct || output.tpPlan.tp1Pct > config.maxTp1Pct) {
    return {
      valid: false,
      output,
      errors: ['AI_TP1_OUT_OF_BOUNDS'],
      warnings,
      blockedReason: 'AI_TP1_OUT_OF_BOUNDS',
    };
  }

  if (Number((parsed.tpPlan as Record<string, unknown>).tp2Pct) > 0) {
    warnings.push('AI_TP2_FORCED_ZERO_AUDIT');
    output.tpPlan.tp2Pct = 0;
  }

  return { valid: true, output, errors, warnings, blockedReason: null };
}

function invalid(blockedReason: string, message: string): ValidationResult {
  return {
    valid: false,
    output: getDefaultAiDecisionOutput(blockedReason),
    errors: [message, blockedReason],
    warnings: [],
    blockedReason,
  };
}

function coerceOutput(parsed: Record<string, unknown>): AiDecisionOutput {
  const marketRead = parsed.marketRead as Record<string, unknown>;
  const retrospectiveSummary = parsed.retrospectiveSummary as Record<string, unknown>;
  const tpPlan = parsed.tpPlan as Record<string, unknown>;
  const riskPlan = parsed.riskPlan as Record<string, unknown>;
  const executionIntent = parsed.executionIntent as Record<string, unknown>;
  return {
    decision: parsed.decision as AiDecisionOutput['decision'],
    confidence: clampNumber(parsed.confidence, 0, 1, 0),
    professionalVerdict: stringValue(parsed.professionalVerdict, 'UNKNOWN'),
    strategy: stringValue(parsed.strategy, 'ai_professional_dynamic'),
    marketRead: {
      regime: stringValue(marketRead.regime, 'unknown'),
      btcEthAlignment: stringValue(marketRead.btcEthAlignment, 'unknown'),
      trendQuality: stringValue(marketRead.trendQuality, 'unknown'),
      entryQuality: stringValue(marketRead.entryQuality, 'unknown'),
      riskLevel: stringValue(marketRead.riskLevel, 'high'),
    },
    retrospectiveSummary: {
      expectedUpsidePct: numberValue(retrospectiveSummary.expectedUpsidePct),
      expectedDownsidePct: numberValue(retrospectiveSummary.expectedDownsidePct),
      rangeClass: stringValue(retrospectiveSummary.rangeClass, 'unknown'),
      supportDistancePct: numberValue(retrospectiveSummary.supportDistancePct),
      resistanceDistancePct: numberValue(retrospectiveSummary.resistanceDistancePct),
      volatilityRisk: stringValue(retrospectiveSummary.volatilityRisk, 'unknown'),
    },
    tpPlan: {
      tp1Pct: numberValue(tpPlan.tp1Pct),
      tp1Reason: stringValue(tpPlan.tp1Reason, 'AI TP1 reason missing.'),
      tp2Pct: 0,
    },
    riskPlan: {
      slPct: numberValue(riskPlan.slPct),
      maxCapitalUsd: numberValue(riskPlan.maxCapitalUsd),
      riskRewardRatio: numberValue(riskPlan.riskRewardRatio),
    },
    executionIntent: {
      wantsBuy: executionIntent.wantsBuy === true,
      urgency: executionIntent.urgency === 'high' || executionIntent.urgency === 'normal' ? executionIntent.urgency : 'low',
      rejectIf: Array.isArray(executionIntent.rejectIf) ? executionIntent.rejectIf.map(String) : [],
    },
    reason: stringValue(parsed.reason, 'AI decision reason missing.'),
  };
}

function requireString(obj: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof obj[field] !== 'string') errors.push(`Missing or invalid field: ${field}`);
}

function requireNumber(obj: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof obj[field] !== 'number' || Number.isNaN(obj[field])) errors.push(`Missing or invalid field: ${field}`);
}

function requireObject(obj: Record<string, unknown>, field: string, errors: string[]): void {
  if (!isRecord(obj[field])) errors.push(`Missing or invalid field: ${field}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
