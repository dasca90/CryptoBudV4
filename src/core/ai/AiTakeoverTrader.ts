import type { AiDecisionInput, AiDecisionOutput, AiDecisionRecord, AiTakeoverConfig, AiTakeoverMode, AiPositionRecord } from './AiTakeoverTypes';
import { AI_TAKEOVER_STORAGE_KEYS, AI_TAKEOVER_DEFAULT_CONFIG, isAiTakeoverActive, canAiExecutePaper, canAiExecuteLive, canAiCreateBuyIntent } from './AiTakeoverTypes';
import type { ValidationResult } from './AiDecisionValidator';
import { AiTakeoverRiskGuard } from './AiTakeoverRiskGuard';
import { AiTakeoverAudit } from './AiTakeoverAudit';
import { RetrospectiveCoinAnalyzer } from './retrospective/RetrospectiveCoinAnalyzer';
import { OpenAiProvider } from './providers/OpenAiProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';

export class AiTakeoverTrader {
  private config: AiTakeoverConfig = { ...AI_TAKEOVER_DEFAULT_CONFIG };
  private riskGuard: AiTakeoverRiskGuard;
  private audit: AiTakeoverAudit;
  private retrospective: RetrospectiveCoinAnalyzer;
  private openAiProvider: OpenAiProvider;
  private deepSeekProvider: DeepSeekProvider;
  private positions: AiPositionRecord[] = [];
  private decisions: AiDecisionRecord[] = [];
  private initialized = false;

  constructor() {
    this.riskGuard = new AiTakeoverRiskGuard();
    this.audit = new AiTakeoverAudit();
    this.retrospective = new RetrospectiveCoinAnalyzer();
    this.openAiProvider = new OpenAiProvider();
    this.deepSeekProvider = new DeepSeekProvider();
  }

  getConfig(): AiTakeoverConfig {
    return { ...this.config };
  }

  getAudit(): AiTakeoverAudit {
    return this.audit;
  }

  getRiskGuard(): AiTakeoverRiskGuard {
    return this.riskGuard;
  }

  getPositions(): readonly AiPositionRecord[] {
    return this.positions;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadConfig();
    await this.audit.loadPersisted();
    this.initialized = true;
  }

  async updateConfig(partial: Partial<AiTakeoverConfig>): Promise<void> {
    this.config = { ...this.config, ...partial };
    await this.persistConfig();
  }

  setMode(mode: AiTakeoverMode): void {
    this.config.mode = mode;
    this.persistConfig();
  }

  getMode(): AiTakeoverMode {
    return this.config.mode;
  }

  isActive(): boolean {
    return isAiTakeoverActive(this.config);
  }

  canPaper(): boolean {
    return canAiExecutePaper(this.config);
  }

  canLive(): boolean {
    return canAiExecuteLive(this.config);
  }

  canCreateBuyIntent(): boolean {
    return canAiCreateBuyIntent(this.config);
  }

  async evaluate(input: AiDecisionInput): Promise<AiDecisionRecord> {
    const record = this.audit.createRecord(
      `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      input.symbol,
      this.config,
    );
    record.input = input;

    if (!isAiTakeoverActive(this.config)) {
      this.audit.addAuditEntry(record, 'GUARD', 'AI Takeover is OFF. Skipping all AI execution.');
      this.audit.updateStatus(record, 'REJECTED');
      this.decisions.unshift(record);
      return record;
    }

    this.audit.addAuditEntry(record, 'PROVIDER', `Calling AI provider: ${this.config.provider}`);
    const validationResult = await this.callProvider(input);

    record.rawResponse = validationResult.valid ? JSON.stringify(validationResult.output) : '';
    record.parsedOutput = validationResult.output;
    record.validationErrors = validationResult.errors;

    this.audit.addAuditEntry(record, 'SCHEMA', `Schema validation: ${validationResult.valid ? 'PASSED' : 'FAILED'}`, { errors: validationResult.errors, warnings: validationResult.warnings });

    if (!validationResult.valid) {
      this.audit.updateStatus(record, 'REJECTED');
      this.decisions.unshift(record);
      return record;
    }

    const riskResult = await this.riskGuard.evaluate(
      validationResult.output,
      this.config,
      this.config.mode,
    );
    record.riskVerdict = riskResult.allowed ? 'ALLOWED' : 'BLOCKED';
    this.audit.addAuditEntry(record, 'RISK_GUARD', riskResult.reason, { blockedBy: riskResult.blockedBy });

    if (!riskResult.allowed) {
      this.audit.updateStatus(record, 'REJECTED');
      this.decisions.unshift(record);
      return record;
    }

    const retroResult = this.retrospective.analyze(input, riskResult.adjustedOutput);
    record.retrospectiveVerdict = retroResult.verdict;
    this.audit.addAuditEntry(record, 'RETROSPECTIVE', retroResult.reason, { verdict: retroResult.verdict, warnings: retroResult.warnings });

    if (retroResult.verdict === 'BLOCK') {
      this.audit.updateStatus(record, 'REJECTED');
      this.decisions.unshift(record);
      return record;
    }

    const finalOutput: AiDecisionOutput = {
      ...riskResult.adjustedOutput,
      confidenceScore: retroResult.adjustedConfidenceScore,
    };

    record.parsedOutput = finalOutput;
    this.audit.addAuditEntry(record, 'FINAL', `Decision: ${finalOutput.action} confidence=${finalOutput.confidenceScore}`, { finalOutput });
    this.audit.updateStatus(record, 'APPROVED');

    this.decisions.unshift(record);
    return record;
  }

  private async callProvider(input: AiDecisionInput): Promise<ValidationResult> {
    const provider = this.config.provider === 'openai'
      ? this.openAiProvider : this.deepSeekProvider;

    if (!provider.isConfigured(this.config)) {
      return {
        valid: false,
        output: {
          action: 'WAIT',
          confidenceScore: 0,
          reason: `${provider.name} not configured.`,
          suggestedEntryPrice: null,
          suggestedStopLossPct: null,
          suggestedTp1Pct: null,
          tp2Pct: 0,
          maxHoldHours: 24,
          metadata: {},
        },
        errors: [`${provider.name} provider is not configured. Set API key first.`],
        warnings: [],
      };
    }

    return provider.decide(input, this.config);
  }

  private async loadConfig(): Promise<void> {
    try {
      const raw = localStorage.getItem(AI_TAKEOVER_STORAGE_KEYS.settings);
      if (raw) {
        const parsed = JSON.parse(raw) as AiTakeoverConfig;
        this.config = { ...AI_TAKEOVER_DEFAULT_CONFIG, ...parsed };
      }
    } catch {
      this.config = { ...AI_TAKEOVER_DEFAULT_CONFIG };
    }
  }

  private async persistConfig(): Promise<void> {
    try {
      localStorage.setItem(AI_TAKEOVER_STORAGE_KEYS.settings, JSON.stringify(this.config));
    } catch {
      /* storage full — silently ignore */
    }
  }
}
