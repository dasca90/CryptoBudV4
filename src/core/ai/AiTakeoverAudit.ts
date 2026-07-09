import type { AiAuditEntry, AiAuditEvent, AiDecisionRecord, AiTakeoverConfig } from './AiTakeoverTypes';
import { AI_TAKEOVER_STORAGE_KEYS } from './AiTakeoverTypes';

export class AiTakeoverAudit {
  private records: AiDecisionRecord[] = [];
  private readonly maxRecords = 500;

  createRecord(
    id: string,
    symbol: string,
    config: AiTakeoverConfig,
  ): AiDecisionRecord {
    const record: AiDecisionRecord = {
      id,
      timestamp: Date.now(),
      symbol,
      input: null as any,
      rawResponse: '',
      parsedOutput: null,
      validationErrors: [],
      validationWarnings: [],
      riskVerdict: 'PENDING',
      retrospectiveVerdict: null,
      status: 'PENDING',
      mode: config.mode,
      executionMode: 'current_app_adapter',
      executionId: null,
      buyIntentCreated: false,
      submitAttempted: false,
      blockedReason: null,
      auditEntries: [],
    };
    this.records.unshift(record);
    this.trimRecords();
    return record;
  }

  addAuditEntry(record: AiDecisionRecord, event: AiAuditEvent, message: string, data: Record<string, unknown> = {}): void {
    const entry: AiAuditEntry = {
      timestamp: Date.now(),
      event,
      message,
      data,
    };
    record.auditEntries.push(entry);
    this.persistAudit();
  }

  updateStatus(record: AiDecisionRecord, status: AiDecisionRecord['status']): void {
    record.status = status;
    this.persistAudit();
  }

  getRecords(): readonly AiDecisionRecord[] {
    return this.records;
  }

  async loadPersisted(): Promise<void> {
    try {
      const raw = localStorage.getItem(AI_TAKEOVER_STORAGE_KEYS.audit);
      if (raw) {
        const parsed = JSON.parse(raw) as AiDecisionRecord[];
        this.records = parsed.slice(0, this.maxRecords);
      }
    } catch {
      this.records = [];
    }
  }

  private persistAudit(): void {
    try {
      const toSave = this.records.slice(0, this.maxRecords);
      localStorage.setItem(AI_TAKEOVER_STORAGE_KEYS.audit, JSON.stringify(toSave));
    } catch {
      /* storage full — silently ignore */
    }
  }

  private trimRecords(): void {
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(0, this.maxRecords);
    }
  }
}
