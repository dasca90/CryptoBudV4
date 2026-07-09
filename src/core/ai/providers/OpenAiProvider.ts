import type { AiDecisionInput, AiTakeoverConfig } from '../AiTakeoverTypes';
import type { ValidationResult } from '../AiDecisionValidator';
import type { AiProvider } from '../AiProvider';
import { validateAiResponse } from '../AiDecisionValidator';
import { createAiSchemaSystemPrompt } from '../AiDecisionSchema';

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  isConfigured(config: AiTakeoverConfig): boolean {
    return config.provider === 'openai' && config.apiKey.length > 0;
  }

  async decide(input: AiDecisionInput, config: AiTakeoverConfig): Promise<ValidationResult> {
    if (!this.isConfigured(config)) {
      return {
        valid: false,
        output: {
          action: 'WAIT',
          confidenceScore: 0,
          reason: 'OpenAI provider not configured.',
          suggestedEntryPrice: null,
          suggestedStopLossPct: null,
          suggestedTp1Pct: null,
          tp2Pct: 0,
          maxHoldHours: 24,
          metadata: {},
        },
        errors: ['OpenAI API key not configured.'],
        warnings: [],
      };
    }

    try {
      const prompt = this.buildPrompt(input);
      const response = await this.callApi(prompt, config);

      if (!response || response.trim().length === 0) {
        return {
          valid: false,
          output: {
            action: 'WAIT',
            confidenceScore: 0,
            reason: 'Empty response from OpenAI.',
            suggestedEntryPrice: null,
            suggestedStopLossPct: null,
            suggestedTp1Pct: null,
            tp2Pct: 0,
            maxHoldHours: 24,
            metadata: {},
          },
          errors: ['OpenAI returned empty response.'],
          warnings: [],
        };
      }

      return validateAiResponse(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        valid: false,
        output: {
          action: 'WAIT',
          confidenceScore: 0,
          reason: `OpenAI call failed: ${msg}`,
          suggestedEntryPrice: null,
          suggestedStopLossPct: null,
          suggestedTp1Pct: null,
          tp2Pct: 0,
          maxHoldHours: 24,
          metadata: {},
        },
        errors: [msg],
        warnings: [],
      };
    }
  }

  private buildPrompt(input: AiDecisionInput): string {
    const systemPrompt = createAiSchemaSystemPrompt();
    const marketData = JSON.stringify(input, null, 2);
    return `${systemPrompt}\n\nMarket Data:\n${marketData}`;
  }

  private async callApi(prompt: string, config: AiTakeoverConfig): Promise<string> {
    const apiKey = config.apiKey;
    const model = config.model || 'gpt-4o-mini';
    const endpoint = 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as any;
    const content: string | undefined = json?.choices?.[0]?.message?.content;
    return content ?? '';
  }
}
