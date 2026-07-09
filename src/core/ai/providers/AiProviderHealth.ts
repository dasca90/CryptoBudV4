import { logger } from '../../../utils/logger';

export type AiProviderHealthStatus = 'NOT_CONFIGURED' | 'TESTED_OK' | 'OK' | 'DEGRADED' | 'RATE_LIMITED' | 'TIMEOUT' | 'FAILED';

export interface AiProviderHealthSnapshot {
  status: AiProviderHealthStatus;
  provider: string;
  model: string;
  failureReason: string | null;
  updatedAt: number;
}

let health: AiProviderHealthSnapshot = {
  status: 'NOT_CONFIGURED',
  provider: 'OFF',
  model: '',
  failureReason: null,
  updatedAt: 0,
};

export function getAiProviderHealth(): AiProviderHealthSnapshot {
  return { ...health };
}

export function setAiProviderHealth(next: Omit<AiProviderHealthSnapshot, 'updatedAt'>): AiProviderHealthSnapshot {
  health = { ...next, updatedAt: Date.now() };
  logger.info(`AI_PROVIDER_HEALTH_AUDIT: provider=${sanitize(next.provider)} model=${sanitize(next.model || 'none')} providerHealth=${next.status} failureReason=${sanitize(next.failureReason ?? 'none')} invariantOk=true`);
  return getAiProviderHealth();
}

function sanitize(value: string): string {
  return value.replace(/\s+/g, '_').replace(/[^\w./:-]+/g, '_').slice(0, 160) || 'none';
}
