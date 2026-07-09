import type { AiDecisionInput, AiTakeoverConfig } from '../AiTakeoverTypes';
import type { AiProvider, AiProviderResponse } from './AiProvider';
import { callAiProviderGateway } from './AiProviderGateway';

export class OllamaProvider implements AiProvider {
  readonly name = 'Ollama Local';

  isConfigured(config: AiTakeoverConfig): boolean {
    return config.provider === 'Ollama Local';
  }

  async decide(_input: AiDecisionInput, config: AiTakeoverConfig, prompt: string): Promise<AiProviderResponse> {
    const result = await callAiProviderGateway({
      provider: 'Ollama Local',
      model: config.model || 'llama3.1',
      apiKey: 'local',
      apiUrl: 'http://127.0.0.1:11434/v1/chat/completions',
      requestKind: 'decision',
      timeoutMs: config.timeoutMs,
      messages: [{ role: 'user', content: prompt }],
      validateJson: (json) => json && typeof json === 'object' ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_PARSE_FAILED' },
    });
    return { ok: result.ok, rawText: result.rawText, blockedReason: result.failureReason ?? undefined, audit: { ...result, provider: this.name, model: config.model } };
  }
}
