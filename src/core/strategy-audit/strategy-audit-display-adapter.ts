import type { StrategyAuditSnapshot } from './strategy-audit-types';

export function summarizeStrategyAudit(snapshot: StrategyAuditSnapshot | null | undefined): string {
  if (!snapshot) return 'LEGACY / MISSING STRATEGY AUDIT';
  if (snapshot.finalExecutable) return `Executable: yes (${snapshot.strategySelected})`;
  if (snapshot.setupMissing.length === 0) return `Executable: no (${snapshot.strategySelected})`;
  return `Missing: ${snapshot.setupMissing.slice(0, 3).map((s) => s.label).join(', ')}`;
}

