export type ResetScope = 'reset_trading' | 'full_demo_reset' | 'reset_ml';

export interface ResetSummary {
  ok: boolean;
  resetScope: ResetScope;
  resetAt: string;
  affectedStorageKeys: string[];
  preservedStorageKeys: string[];
  remainingOpenCount: number;
  remainingClosedCount: number;
  remainingJournalCount: number;
  remainingMlRecordCount: number;
  message: string;
}
