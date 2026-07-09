import type { AiProviderName, AiTakeoverConfig } from './AiTakeoverTypes';
import { AI_TAKEOVER_DEFAULT_CONFIG, AI_TAKEOVER_STORAGE_KEYS } from './AiTakeoverTypes';

export const AI_CLOUD_API_STORAGE_KEY = 'cryptobud_v5_ai_cloud_api';

export interface AiCloudApiSettings {
  provider: AiProviderName;
  model: string;
  apiKey: string;
  apiUrl: string;
}

export function createDefaultAiCloudApiSettings(): AiCloudApiSettings {
  return {
    provider: 'OFF',
    model: '',
    apiKey: '',
    apiUrl: '',
  };
}

export function maskAiApiKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function loadAiCloudApiSettings(): AiCloudApiSettings {
  try {
    const raw = localStorage.getItem(AI_CLOUD_API_STORAGE_KEY);
    if (!raw) return createDefaultAiCloudApiSettings();
    return { ...createDefaultAiCloudApiSettings(), ...JSON.parse(raw) };
  } catch {
    return createDefaultAiCloudApiSettings();
  }
}

export function saveAiCloudApiSettings(settings: AiCloudApiSettings): void {
  const normalized: AiCloudApiSettings = {
    provider: settings.provider,
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    apiUrl: normalizeAiCloudApiUrl(settings.apiUrl, settings.provider),
  };
  localStorage.setItem(AI_CLOUD_API_STORAGE_KEY, JSON.stringify(normalized));

  const rawConfig = localStorage.getItem(AI_TAKEOVER_STORAGE_KEYS.settings);
  const currentConfig = rawConfig
    ? { ...AI_TAKEOVER_DEFAULT_CONFIG, ...JSON.parse(rawConfig) } as AiTakeoverConfig
    : { ...AI_TAKEOVER_DEFAULT_CONFIG };
  const nextConfig: AiTakeoverConfig = {
    ...currentConfig,
    provider: normalized.provider,
    model: normalized.model,
  };
  localStorage.setItem(AI_TAKEOVER_STORAGE_KEYS.settings, JSON.stringify(nextConfig));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cryptobud_v5_ai_cloud_api_updated', { detail: normalized }));
  }
}

export function clearAiCloudApiSettings(): void {
  localStorage.removeItem(AI_CLOUD_API_STORAGE_KEY);
  const rawConfig = localStorage.getItem(AI_TAKEOVER_STORAGE_KEYS.settings);
  const currentConfig = rawConfig
    ? { ...AI_TAKEOVER_DEFAULT_CONFIG, ...JSON.parse(rawConfig) } as AiTakeoverConfig
    : { ...AI_TAKEOVER_DEFAULT_CONFIG };
  localStorage.setItem(AI_TAKEOVER_STORAGE_KEYS.settings, JSON.stringify({
    ...currentConfig,
    provider: 'OFF',
    model: '',
  }));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cryptobud_v5_ai_cloud_api_updated', { detail: createDefaultAiCloudApiSettings() }));
  }
}

export function getAiCloudProviderSecret(provider: AiProviderName): { apiKey: string; apiUrl: string } {
  const settings = loadAiCloudApiSettings();
  if (settings.provider !== provider) return { apiKey: '', apiUrl: '' };
  return {
    apiKey: settings.apiKey,
    apiUrl: normalizeAiCloudApiUrl(settings.apiUrl, provider),
  };
}

export function getDefaultAiCloudApiUrl(provider: AiProviderName): string {
  if (provider === 'OpenCode') return 'https://opencode.ai/zen/v1/chat/completions';
  if (provider === 'OpenCode Go') return 'https://opencode.ai/zen/go/v1/chat/completions';
  if (provider === 'OpenAI') return 'https://api.openai.com/v1/chat/completions';
  if (provider === 'DeepSeek') return 'https://api.deepseek.com/v1/chat/completions';
  return '';
}

export function normalizeAiCloudApiUrl(apiUrl: string, provider: AiProviderName = 'OFF'): string {
  const trimmed = apiUrl.trim();
  if (!trimmed) return getDefaultAiCloudApiUrl(provider);
  try {
    const url = new URL(trimmed);
    url.pathname = normalizeAiCloudApiPath(url, provider);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function normalizeAiCloudApiPath(url: URL, provider: AiProviderName): string {
  let pathname = url.pathname.replace(/\/chat\/completion$/i, '/chat/completions');
  if (url.hostname === 'opencode.ai' && provider === 'OpenCode Go') {
    pathname = pathname.replace(/^\/zen(?:\/go)?\/v1\/chat\/completions$/i, '/zen/go/v1/chat/completions');
  }
  if (url.hostname === 'opencode.ai' && provider === 'OpenCode') {
    pathname = pathname.replace(/^\/zen\/go\/v1\/chat\/completions$/i, '/zen/v1/chat/completions');
  }
  return pathname;
}
