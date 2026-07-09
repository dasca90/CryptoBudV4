import type { AiDecisionInput, AiDecisionRecord, AiPositionRecord, AiProviderName, AiTakeoverConfig, AiTakeoverMode } from './AiTakeoverTypes';
import { AI_TAKEOVER_DEFAULT_CONFIG, AI_TAKEOVER_STORAGE_KEYS, canAiCreateBuyIntent, isAiTakeoverActive } from './AiTakeoverTypes';
import { validateAiResponse } from './AiDecisionValidator';
import { AiTakeoverRiskGuard } from './AiTakeoverRiskGuard';
import { AiTakeoverAudit } from './AiTakeoverAudit';
import { RetrospectiveCoinAnalyzer } from './retrospective/RetrospectiveCoinAnalyzer';
import { buildAiTakeoverPrompt } from './AiPromptBuilder';
import type { AiProvider } from './providers/AiProvider';
import { OpenCodeProvider } from './providers/OpenCodeProvider';
import { OpenAiProvider } from './providers/OpenAiProvider';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { OllamaProvider } from './providers/OllamaProvider';
import { DEFAULT_AI_ANTI_FOMO_SETTINGS, runAiAntiFomoGuard } from './guards/AiAntiFomoGuard';
import { runAiManipulationGuard } from './guards/AiManipulationGuard';
import { runAiNewListingGuard } from './guards/AiNewListingGuard';

export interface AiEvaluateOptions {
  executionMode?: string;
  providerOverride?: AiProvider;
  submitBuyIntent?: (record: AiDecisionRecord) => Promise<{ submitted: boolean; executionId?: string; blockedReason?: string }>;
}

export class AiTakeoverTrader {
  private config: AiTakeoverConfig = { ...AI_TAKEOVER_DEFAULT_CONFIG };
  private riskGuard = new AiTakeoverRiskGuard();
  private audit = new AiTakeoverAudit();
  private retrospective = new RetrospectiveCoinAnalyzer();
  private providers: Record<Exclude<AiProviderName, 'OFF'>, AiProvider> = {
    OpenCode: new OpenCodeProvider('OpenCode'),
    'OpenCode Go': new OpenCodeProvider('OpenCode Go'),
    OpenAI: new OpenAiProvider(),
    DeepSeek: new DeepSeekProvider(),
    'Ollama Local': new OllamaProvider(),
  };
  private positions: AiPositionRecord[] = [];
  private initialized = false;

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
    const next = { ...this.config, ...partial };
    this.config = normalizeConfig(next);
    await this.persistConfig();
  }

  setMode(mode: AiTakeoverMode): void {
    this.config.mode = mode;
    void this.persistConfig();
  }

  getMode(): AiTakeoverMode {
    return this.config.mode;
  }

  isActive(): boolean {
    return isAiTakeoverActive(this.config);
  }

  canCreateBuyIntent(): boolean {
    return canAiCreateBuyIntent(this.config);
  }

  isProviderConfigured(): boolean {
    if (this.config.provider === 'OFF') return false;
    return this.providers[this.config.provider].isConfigured(this.config);
  }

  async evaluate(input: AiDecisionInput, options: AiEvaluateOptions = {}): Promise<AiDecisionRecord> {
    const executionMode = options.executionMode ?? 'current_app_adapter';
    const record = this.audit.createRecord(`ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, input.symbol, this.config);
    record.input = input;
    record.executionMode = executionMode;

    this.audit.addAuditEntry(record, 'AI_TAKEOVER_MODE_AUDIT', `AI Takeover mode is ${this.config.mode}.`, {
      aiTakeoverMode: this.config.mode,
      executionMode,
      provider: this.config.provider,
      model: this.config.model,
    });

    if (!isAiTakeoverActive(this.config)) {
      record.status = 'SKIPPED_OFF';
      record.blockedReason = 'AI_TAKEOVER_OFF';
      this.audit.addAuditEntry(record, 'AI_BUY_BLOCKED_AUDIT', 'AI Takeover is OFF; no provider call and no BUY_INTENT.', {
        buyIntentCreated: false,
        submitAttempted: false,
        executionBlocked: true,
        blockedReason: record.blockedReason,
      });
      return record;
    }

    const retro = this.retrospective.analyze(input);
    if (!retro.present || !retro.metrics) {
      record.status = 'BLOCKED';
      record.blockedReason = 'RETROSPECTIVE_ANALYSIS_MISSING';
      this.audit.addAuditEntry(record, 'AI_RETROSPECTIVE_ANALYSIS_AUDIT', 'Retrospective analysis missing.', { blockedReason: record.blockedReason });
      return record;
    }
    const enrichedInput = { ...input, retrospective: retro.metrics };
    record.input = enrichedInput;
    record.retrospectiveVerdict = retro.verdict;
    this.audit.addAuditEntry(record, 'AI_RETROSPECTIVE_ANALYSIS_AUDIT', retro.reason, { ...retro.metrics, warnings: retro.warnings });

    if (this.config.provider === 'OFF') {
      record.status = 'BLOCKED';
      record.blockedReason = 'AI_PROVIDER_OFF';
      this.audit.addAuditEntry(record, 'AI_BUY_BLOCKED_AUDIT', 'AI provider is OFF.', { blockedReason: record.blockedReason });
      return record;
    }

    const provider = options.providerOverride ?? this.providers[this.config.provider];
    if (!provider.isConfigured(this.config)) {
      record.status = 'BLOCKED';
      record.blockedReason = 'AI_PROVIDER_NOT_CONFIGURED';
      this.audit.addAuditEntry(record, 'AI_BUY_BLOCKED_AUDIT', 'Provider is not configured in backend/env.', { provider: provider.name, blockedReason: record.blockedReason });
      return record;
    }

    const prompt = buildAiTakeoverPrompt(enrichedInput, this.config);
    this.audit.addAuditEntry(record, 'AI_CONTEXT_BUILD_AUDIT', 'Structured AI context built from CryptoBud data.', { symbol: input.symbol });
    this.audit.addAuditEntry(record, 'AI_PROFESSIONAL_RULES_AUDIT', 'Professional trader rules attached to provider request.', { invariantOk: true });
    this.audit.addAuditEntry(record, 'AI_DECISION_REQUEST_AUDIT', `Calling provider ${provider.name}.`, { timeoutMs: this.config.timeoutMs });

    const providerResponse = await provider.decide(enrichedInput, this.config, prompt);
    record.rawResponse = providerResponse.rawText;
    this.audit.addAuditEntry(record, 'AI_DECISION_RESPONSE_AUDIT', providerResponse.ok ? 'Provider returned response.' : 'Provider failed or timed out.', providerResponse.audit);
    if (!providerResponse.ok) {
      record.status = 'BLOCKED';
      record.blockedReason = providerResponse.blockedReason ?? 'AI_PROVIDER_FAILURE';
      return record;
    }

    const validation = validateAiResponse(providerResponse.rawText, this.config);
    record.parsedOutput = validation.output;
    record.validationErrors = validation.errors;
    record.validationWarnings = validation.warnings;
    this.audit.addAuditEntry(record, 'AI_SCHEMA_VALIDATION_AUDIT', validation.valid ? 'Schema validation passed.' : 'Schema validation failed.', {
      errors: validation.errors,
      warnings: validation.warnings,
      blockedReason: validation.blockedReason,
    });
    if (validation.warnings.includes('AI_TP2_FORCED_ZERO_AUDIT')) {
      this.audit.addAuditEntry(record, 'AI_TP2_FORCED_ZERO_AUDIT', 'AI returned TP2 > 0; final TP2 forced to 0.', { tp2Pct: 0 });
    }
    if (!validation.valid) {
      record.status = 'BLOCKED';
      record.blockedReason = validation.blockedReason;
      return record;
    }

    const antiFomo = runAiAntiFomoGuard(enrichedInput, { ...DEFAULT_AI_ANTI_FOMO_SETTINGS, minCleanUpsidePct: this.config.minCleanUpsidePct });
    const manipulation = runAiManipulationGuard(enrichedInput);
    const newListing = runAiNewListingGuard(enrichedInput);
    this.audit.addAuditEntry(record, 'AI_ANTI_FOMO_GUARD_AUDIT', antiFomo.reason, { antiFomoResult: antiFomo.status, blockedReason: antiFomo.blockedReason });
    this.audit.addAuditEntry(record, 'AI_ANTI_RUGPULL_GUARD_AUDIT', manipulation.reason, { antiManipulationResult: manipulation.status, blockedReason: manipulation.blockedReason });
    this.audit.addAuditEntry(record, 'AI_NEW_LISTING_GUARD_AUDIT', newListing.reason, { newListingResult: newListing.status, blockedReason: newListing.blockedReason });
    const guardBlock = [antiFomo, manipulation, newListing].find((guard) => guard.status === 'FAIL');
    if (guardBlock) {
      record.status = 'BLOCKED';
      record.blockedReason = guardBlock.blockedReason;
      this.audit.addAuditEntry(record, 'AI_BUY_BLOCKED_AUDIT', `AI wanted ${validation.output.decision}; CryptoBud blocked: ${record.blockedReason}.`, { executionBlocked: true, blockedReason: record.blockedReason });
      return record;
    }

    const risk = this.riskGuard.evaluate(validation.output, this.config, enrichedInput);
    record.riskVerdict = risk.allowed ? 'ALLOWED' : 'BLOCKED';
    this.audit.addAuditEntry(record, 'AI_RISK_GUARD_AUDIT', risk.reason, {
      hardGuardsPassed: risk.allowed,
      hardGuardsFailed: risk.blockedBy,
    });
    if (!risk.allowed) {
      record.status = 'BLOCKED';
      record.blockedReason = risk.blockedBy[0] ?? 'AI_RISK_GUARD_BLOCKED';
      this.audit.addAuditEntry(record, 'AI_BUY_BLOCKED_AUDIT', `AI wanted BUY; CryptoBud blocked execution because: ${record.blockedReason}`, {
        executionBlocked: true,
        blockedReason: record.blockedReason,
      });
      return record;
    }

    record.status = 'BUY_INTENT_CREATED';
    record.buyIntentCreated = true;
    this.audit.addAuditEntry(record, 'AI_BUY_INTENT_AUDIT', 'AI BUY_INTENT created; execution remains in current CryptoBud pipeline.', {
      buyIntentCreated: true,
      submitAttempted: false,
      executionMode,
      tp1Pct: risk.adjustedOutput.tpPlan.tp1Pct,
      tp2Pct: 0,
    });

    if (options.submitBuyIntent) {
      record.submitAttempted = true;
      const submit = await options.submitBuyIntent(record);
      record.executionId = submit.executionId ?? null;
      record.status = submit.submitted ? 'SUBMITTED' : 'BLOCKED';
      record.blockedReason = submit.blockedReason ?? null;
      this.audit.addAuditEntry(record, submit.submitted ? 'AI_BUY_SUBMIT_AUDIT' : 'AI_BUY_BLOCKED_AUDIT', submit.submitted ? 'BUY_INTENT submitted to current CryptoBud execution pipeline.' : 'Current CryptoBud execution pipeline blocked BUY_INTENT.', {
        submitAttempted: true,
        executionMode,
        executionId: record.executionId,
        blockedReason: record.blockedReason,
      });
    }

    return record;
  }

  private async loadConfig(): Promise<void> {
    try {
      const raw = localStorage.getItem(AI_TAKEOVER_STORAGE_KEYS.settings);
      this.config = raw ? normalizeConfig({ ...AI_TAKEOVER_DEFAULT_CONFIG, ...JSON.parse(raw) }) : { ...AI_TAKEOVER_DEFAULT_CONFIG };
    } catch {
      this.config = { ...AI_TAKEOVER_DEFAULT_CONFIG };
    }
  }

  private async persistConfig(): Promise<void> {
    try {
      localStorage.setItem(AI_TAKEOVER_STORAGE_KEYS.settings, JSON.stringify(this.config));
    } catch {
      /* storage can be unavailable in tests */
    }
  }
}

function normalizeConfig(config: AiTakeoverConfig): AiTakeoverConfig {
  const mode: AiTakeoverMode = config.mode === 'ON' ? 'ON' : 'OFF';
  const provider: AiProviderName = ['OFF', 'OpenCode', 'OpenCode Go', 'OpenAI', 'DeepSeek', 'Ollama Local'].includes(config.provider)
    ? config.provider
    : 'OFF';
  return {
    ...AI_TAKEOVER_DEFAULT_CONFIG,
    ...config,
    mode,
    provider,
    timeoutMs: Math.max(1000, Number(config.timeoutMs) || AI_TAKEOVER_DEFAULT_CONFIG.timeoutMs),
    maxCandidatesPerScan: Math.max(1, Number(config.maxCandidatesPerScan) || AI_TAKEOVER_DEFAULT_CONFIG.maxCandidatesPerScan),
    maxResultsPerMission: Math.max(1, Number(config.maxResultsPerMission) || AI_TAKEOVER_DEFAULT_CONFIG.maxResultsPerMission),
    minConfidence: Math.min(1, Math.max(0, Number(config.minConfidence) || AI_TAKEOVER_DEFAULT_CONFIG.minConfidence)),
  };
}
