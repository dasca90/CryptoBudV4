import type { AiDecisionInput, AiTakeoverConfig } from '../AiTakeoverTypes';
import { getAiCloudProviderSecret } from '../AiCloudApiSettings';
import type { AiProvider, AiProviderResponse } from './AiProvider';
import { readProviderSecret } from './AiProvider';
import { callAiProviderGateway } from './AiProviderGateway';

export class DeepSeekProvider implements AiProvider {
  readonly name = 'DeepSeek';

  isConfigured(config: AiTakeoverConfig): boolean {
    const saved = getAiCloudProviderSecret('DeepSeek');
    return config.provider === 'DeepSeek' && (readProviderSecret('VITE_DEEPSEEK_API_KEY').length > 0 || saved.apiKey.length > 0);
  }

  async decide(_input: AiDecisionInput, config: AiTakeoverConfig, prompt: string): Promise<AiProviderResponse> {
    if (!this.isConfigured(config)) return { ok: false, rawText: '', blockedReason: 'AI_PROVIDER_NOT_CONFIGURED', audit: { provider: this.name } };
    const saved = getAiCloudProviderSecret('DeepSeek');
    const result = await callAiProviderGateway({
      provider: 'DeepSeek',
      model: config.model || 'deepseek-chat',
      apiKey: readProviderSecret('VITE_DEEPSEEK_API_KEY') || saved.apiKey,
      apiUrl: saved.apiUrl,
      requestKind: 'decision',
      timeoutMs: config.timeoutMs,
      messages: [{ role: 'user', content: prompt }],
      validateJson: (json) => json && typeof json === 'object' ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_PARSE_FAILED' },
    });
    return { ok: result.ok, rawText: result.rawText, blockedReason: result.failureReason ?? undefined, audit: { ...result, provider: this.name, model: config.model } };
  }
}
