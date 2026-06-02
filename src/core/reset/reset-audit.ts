import { logger } from '../../utils/logger';
import type { ResetScope } from './reset-types';

export function logResetAudit(event: string, scope: ResetScope, details: Record<string, unknown>): void {
  logger.info(`${event}: resetScope=${scope} ${Object.entries(details).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}`);
}
