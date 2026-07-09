import type { AiDecisionOutput, AiDecisionAction } from './AiTakeoverTypes';

export interface AiSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
  description: string;
}

export const AI_DECISION_SCHEMA_FIELDS: AiSchemaField[] = [
  {
    name: 'action',
    type: 'string',
    required: true,
    allowedValues: ['BUY', 'WAIT', 'AVOID'] as const,
    description: 'The trading decision: BUY to open position, WAIT to hold, AVOID to skip.',
  },
  {
    name: 'confidenceScore',
    type: 'number',
    required: true,
    min: 0,
    max: 100,
    description: 'Confidence in the decision from 0 (lowest) to 100 (highest).',
  },
  {
    name: 'reason',
    type: 'string',
    required: true,
    description: 'Human-readable explanation of why this decision was made.',
  },
  {
    name: 'suggestedEntryPrice',
    type: 'number',
    required: false,
    min: 0,
    description: 'Suggested entry price. Must be > 0 if provided.',
  },
  {
    name: 'suggestedStopLossPct',
    type: 'number',
    required: false,
    min: -100,
    max: 0,
    description: 'Suggested stop loss as a negative percentage.',
  },
  {
    name: 'suggestedTp1Pct',
    type: 'number',
    required: false,
    min: 0,
    description: 'Suggested take-profit 1 as a positive percentage.',
  },
  {
    name: 'tp2Pct',
    type: 'number',
    required: true,
    min: 0,
    max: 0,
    description: 'TP2 is always 0. AI must set this to 0.',
  },
  {
    name: 'maxHoldHours',
    type: 'number',
    required: true,
    min: 1,
    max: 168,
    description: 'Maximum hours to hold the position before forced exit.',
  },
  {
    name: 'metadata',
    type: 'object',
    required: false,
    description: 'Additional metadata from the AI provider.',
  },
];

export function getDefaultAiDecisionOutput(): AiDecisionOutput {
  return {
    action: 'WAIT',
    confidenceScore: 0,
    reason: 'Default fallback — AI decision not provided.',
    suggestedEntryPrice: null,
    suggestedStopLossPct: null,
    suggestedTp1Pct: null,
    tp2Pct: 0,
    maxHoldHours: 24,
    metadata: {},
  };
}

export function createAiSchemaSystemPrompt(): string {
  const fields = AI_DECISION_SCHEMA_FIELDS.map(f => {
    const required = f.required ? ' (required)' : ' (optional)';
    const constraints: string[] = [];
    if (f.allowedValues) constraints.push(`allowed values: ${f.allowedValues.join(', ')}`);
    if (f.min !== undefined) constraints.push(`min: ${f.min}`);
    if (f.max !== undefined) constraints.push(`max: ${f.max}`);
    const constraintStr = constraints.length > 0 ? ` [${constraints.join(', ')}]` : '';
    return `  - "${f.name}": ${f.type}${required}${constraintStr} — ${f.description}`;
  }).join('\n');

  return `You are a cryptocurrency trading AI. Respond with a valid JSON object following this schema exactly:\n\n{\n${fields}\n}\n\nIMPORTANT: tp2Pct MUST always be 0. You may NEVER set tp2Pct to a non-zero value.`;
}
