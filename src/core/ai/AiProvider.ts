import type { AiDecisionInput, AiDecisionOutput, AiTakeoverConfig } from './AiTakeoverTypes';
import type { ValidationResult } from './AiDecisionValidator';

export interface AiProvider {
  readonly name: string;
  isConfigured(config: AiTakeoverConfig): boolean;
  decide(input: AiDecisionInput, config: AiTakeoverConfig): Promise<ValidationResult>;
}

export function getProviderConfig(config: AiTakeoverConfig): { apiKey: string; model: string } {
  return {
    apiKey: config.apiKey || '',
    model: config.model || 'default',
  };
}
