import type { AiDecisionInput, AiTakeoverConfig } from './AiTakeoverTypes';
import { createAiSchemaSystemPrompt } from './AiDecisionSchema';
import { buildProfessionalRulesPrompt } from './AiProfessionalRules';

export function buildAiTakeoverPrompt(input: AiDecisionInput, config: AiTakeoverConfig): string {
  return [
    'You are CryptoBud V5 AI Takeover professional decision brain.',
    'CryptoBud is the data engine, safety governor, execution planner, trading engine, adapter, and position manager.',
    'You do not execute orders. You can only produce structured decisions.',
    '',
    'Professional rules:',
    buildProfessionalRulesPrompt(),
    '',
    'Schema:',
    createAiSchemaSystemPrompt(),
    '',
    `Mission constraints: minCleanUpsidePct=${config.minCleanUpsidePct}, minConfidence=${config.minConfidence}, minTp1Pct=${config.minTp1Pct}, maxTp1Pct=${config.maxTp1Pct}.`,
    '',
    'Structured CryptoBud context:',
    JSON.stringify(input, null, 2),
  ].join('\n');
}
