import { TradingEngine } from '../core/trading/TradingEngine';
import { MLPredictor } from '../core/ml/MLPredictor';
import { Journal } from '../core/persistence/Journal';
import { PaperExchangeAdapter } from '../core/exchange/PaperExchangeAdapter';
import { logger } from '../utils/logger';
import type { TraderBrainDecision } from '../core/types';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

async function main() {
  logger.clear();

  const symbol = 'XLMUSDT';
  const engine = new TradingEngine(new PaperExchangeAdapter(), new MLPredictor(), new Journal());
  const scanner = engine.getAutoRuntime().getScanner();
  scanner.setPaperAutoEnabled(true);
  scanner.setManualStrategy(null);

  const decision: TraderBrainDecision = {
    symbol,
    mode: 'AUTO',
    selectedStrategy: 'momentum',
    selectedPlaybook: 'momentum',
    confidence: 0.88,
    status: 'BUY',
    entryPlan: { side: 'BUY', price: 0.12, quantity: 1000, reason: 'legacy brain auto entry regression' },
    exitPlan: null,
    reasons: ['legacy brain auto entry regression'],
    blockReasons: [],
    warnings: [],
    requiredNextActions: [],
    ruleDecisionTrace: { unifiedSignal: { reasonCode: 'MOMENTUM_READY', reason: 'ready' } as any, playbookResult: null, autobotsResult: null },
  };

  const rogueBrain: any = {
    coin: symbol,
    mode: 'AUTO',
    position: null,
    config: { takeProfitPercent: 2, stopLossPercent: 1.5 },
    decide: async () => decision,
  };

  await (engine as any).processEntry(rogueBrain);

  const messages = logger.getLogs().map((l) => l.message);
  const suppressionAudit = messages.find((m) => m.includes('LEGACY_AUTO_BUY_PATH_BLOCKED') && m.includes(`symbol=${symbol}`));
  const canonicalAudit = messages.find((m) => m.includes('AUTO_EXECUTION_CONTEXT_CANONICAL_AUDIT') && m.includes(`symbol=${symbol}`) && m.includes('stage=pre_entry_gate'));
  const ownershipBlocked = messages.find((m) => m.includes('AUTO_TARGET_OWNERSHIP_CONTEXT_MISSING_BLOCKED') && m.includes(`symbol=${symbol}`) && m.includes('stage=pre_entry_gate'));

  ok(!!suppressionAudit, 'legacy brain auto entry is suppressed when scanner auto is enabled');
  ok(suppressionAudit?.includes('reason=legacy_auto_path_disabled_in_v4') ?? false, 'suppression audit exposes canonical V4-disabled reason');
  ok(suppressionAudit?.includes('scannerAutoEnabled=true') ?? false, 'suppression audit records scanner auto enabled');
  ok(suppressionAudit?.includes('autoBotsEnabled=true') ?? false, 'suppression audit records AutoBots enabled');
  ok(suppressionAudit?.includes('hasScannerCandidate=false') ?? false, 'suppression audit records missing scanner candidate context');
  ok(suppressionAudit?.includes('oldExecutionPath=brain_auto_entry') ?? false, 'suppression audit records blocked legacy execution path');
  ok(suppressionAudit?.includes('canonicalReplacement=scanner_auto') ?? false, 'suppression audit points to canonical scanner_auto replacement');
  ok(!canonicalAudit, 'suppressed legacy path does not continue into pre-entry canonical ownership audit');
  ok(!ownershipBlocked, 'suppressed legacy path is blocked before unknown ownership fallback audit');
  ok(messages.some((m) => m.includes('BUY_BLOCKED_FINAL_EXECUTABLE_FALSE') && m.includes('reason=legacy_brain_auto_entry_suppressed')), 'suppressed legacy path emits final executable false reason');

  if (failed > 0) {
    console.error(`legacy-brain-auto-entry-suppressed: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`legacy-brain-auto-entry-suppressed: ${passed} passed, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
