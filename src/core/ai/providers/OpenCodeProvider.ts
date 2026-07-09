import type { AiDecisionInput, AiTakeoverConfig } from '../AiTakeoverTypes';
import type { AiProviderName } from '../AiTakeoverTypes';
import { getAiCloudProviderSecret, getDefaultAiCloudApiUrl, normalizeAiCloudApiUrl } from '../AiCloudApiSettings';
import type { AiProvider, AiProviderResponse } from './AiProvider';
import { readProviderSecret } from './AiProvider';
import { callAiProviderGateway } from './AiProviderGateway';

export class OpenCodeProvider implements AiProvider {
  readonly name: string;

  constructor(private readonly providerName: Extract<AiProviderName, 'OpenCode' | 'OpenCode Go'> = 'OpenCode') {
    this.name = providerName === 'OpenCode Go' ? 'OpenCode Go' : 'OpenCode Zen';
  }

  isConfigured(config: AiTakeoverConfig): boolean {
    const saved = getAiCloudProviderSecret(this.providerName);
    return config.provider === this.providerName && (this.readApiKey(saved.apiKey).length > 0);
  }

  async decide(_input: AiDecisionInput, config: AiTakeoverConfig, prompt: string): Promise<AiProviderResponse> {
    if (!this.isConfigured(config)) return { ok: false, rawText: '', blockedReason: 'AI_PROVIDER_NOT_CONFIGURED', audit: { provider: this.name } };
    const saved = getAiCloudProviderSecret(this.providerName);
    const result = await callAiProviderGateway({
      provider: this.providerName,
      model: config.model || 'deepseek-v4-flash',
      apiKey: this.readApiKey(saved.apiKey),
      apiUrl: normalizeAiCloudApiUrl(this.readApiUrl(saved.apiUrl), this.providerName),
      requestKind: 'decision',
      timeoutMs: config.timeoutMs,
      includeResponseFormat: true,
      messages: [{ role: 'user', content: prompt }],
      validateJson: (json) => json && typeof json === 'object' ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_PARSE_FAILED' },
    });
    return { ok: result.ok, rawText: result.rawText, blockedReason: result.failureReason ?? undefined, audit: { ...result, provider: this.name, model: config.model } };
  }

  private readApiKey(savedApiKey: string): string {
    if (this.providerName === 'OpenCode Go') {
      return readProviderSecret('VITE_OPENCODE_GO_API_KEY') || readProviderSecret('VITE_OPENCODE_API_KEY') || savedApiKey;
    }
    return readProviderSecret('VITE_OPENCODE_API_KEY') || savedApiKey;
  }

  private readApiUrl(savedApiUrl: string): string {
    if (this.providerName === 'OpenCode Go') {
      return readProviderSecret('VITE_OPENCODE_GO_API_URL') || savedApiUrl || getDefaultAiCloudApiUrl('OpenCode Go');
    }
    return readProviderSecret('VITE_OPENCODE_API_URL') || savedApiUrl || getDefaultAiCloudApiUrl('OpenCode');
  }
}
