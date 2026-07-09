import type { AiDecisionInput, AiTakeoverConfig } from '../AiTakeoverTypes';
import { normalizeAiCloudApiUrl } from '../AiCloudApiSettings';
import { tryPostJsonFromRequestInit } from '../AiCloudHttpTransport';

export interface AiProviderResponse {
  ok: boolean;
  rawText: string;
  blockedReason?: string;
  audit: Record<string, unknown>;
}

export interface AiProvider {
  readonly name: string;
  isConfigured(config: AiTakeoverConfig): boolean;
  decide(input: AiDecisionInput, config: AiTakeoverConfig, prompt: string): Promise<AiProviderResponse>;
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const normalizedUrl = normalizeAiCloudApiUrl(url);
  const nativeResponse = await tryPostJsonFromRequestInit(normalizedUrl, init, timeoutMs);
  if (nativeResponse) return nativeResponse;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(normalizedUrl, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function readProviderSecret(envName: string): string {
  const env = (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined) ?? {};
  return String(env[envName] ?? '');
}
