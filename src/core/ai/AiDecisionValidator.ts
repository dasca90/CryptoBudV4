import type { AiDecisionOutput } from './AiTakeoverTypes';
import { AI_DECISION_SCHEMA_FIELDS, getDefaultAiDecisionOutput } from './AiDecisionSchema';

export interface ValidationResult {
  valid: boolean;
  output: AiDecisionOutput;
  errors: string[];
  warnings: string[];
}

export function validateAiResponse(raw: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw || raw.trim().length === 0) {
    return {
      valid: false,
      output: getDefaultAiDecisionOutput(),
      errors: ['Empty AI response.'],
      warnings: [],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return {
      valid: false,
      output: getDefaultAiDecisionOutput(),
      errors: ['Invalid JSON in AI response.'],
      warnings: [],
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      valid: false,
      output: getDefaultAiDecisionOutput(),
      errors: ['AI response is not a JSON object.'],
      warnings: [],
    };
  }

  for (const field of AI_DECISION_SCHEMA_FIELDS) {
    const value = parsed[field.name];
    const isPresent = value !== undefined && value !== null;

    if (field.required && !isPresent) {
      errors.push(`Missing required field: "${field.name}".`);
      continue;
    }

    if (!isPresent) continue;

    if (field.type === 'string' && typeof value !== 'string') {
      errors.push(`Field "${field.name}" must be a string, got ${typeof value}.`);
      continue;
    }

    if (field.type === 'number' && typeof value !== 'number') {
      errors.push(`Field "${field.name}" must be a number, got ${typeof value}.`);
      continue;
    }

    if (field.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Field "${field.name}" must be a boolean, got ${typeof value}.`);
      continue;
    }

    if (field.type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      errors.push(`Field "${field.name}" must be an object, got ${typeof value}.`);
      continue;
    }

    if (field.allowedValues && typeof value === 'string' && !field.allowedValues.includes(value)) {
      errors.push(`Field "${field.name}" has invalid value "${value}". Allowed: ${field.allowedValues.join(', ')}.`);
    }

    if (field.min !== undefined && typeof value === 'number' && value < field.min) {
      errors.push(`Field "${field.name}" value ${value} is below minimum ${field.min}.`);
    }

    if (field.max !== undefined && typeof value === 'number' && value > field.max) {
      if (field.name === 'tp2Pct' && value > 0) {
        errors.push('TP2 must be 0. AI Takeover does not support TP2. Forcing tp2Pct to 0.');
      } else {
        errors.push(`Field "${field.name}" value ${value} exceeds maximum ${field.max}.`);
      }
    }
  }

  const action = (['BUY', 'WAIT', 'AVOID'] as const).includes(parsed.action as any)
    ? (parsed.action as 'BUY' | 'WAIT' | 'AVOID')
    : 'WAIT';

  const output: AiDecisionOutput = {
    action,
    confidenceScore: clampNumber(parsed.confidenceScore as number, 0, 100, 0),
    reason: typeof parsed.reason === 'string' ? parsed.reason : 'AI decision — no reason provided.',
    suggestedEntryPrice: typeof parsed.suggestedEntryPrice === 'number' && parsed.suggestedEntryPrice > 0
      ? parsed.suggestedEntryPrice as number : null,
    suggestedStopLossPct: typeof parsed.suggestedStopLossPct === 'number'
      ? clampNumber(parsed.suggestedStopLossPct as number, -100, 0, null as any) : null,
    suggestedTp1Pct: typeof parsed.suggestedTp1Pct === 'number' && parsed.suggestedTp1Pct > 0
      ? parsed.suggestedTp1Pct as number : null,
    tp2Pct: 0,
    maxHoldHours: clampNumber(parsed.maxHoldHours as number, 1, 168, 24),
    metadata: typeof parsed.metadata === 'object' && parsed.metadata !== null && !Array.isArray(parsed.metadata)
      ? parsed.metadata as Record<string, unknown> : {},
  };

  if (parsed.tp2Pct !== undefined && parsed.tp2Pct !== 0) {
    warnings.push('AI attempted to set non-zero TP2. It has been forced to 0.');
  }

  const valid = errors.length === 0;
  return { valid, output, errors, warnings };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
