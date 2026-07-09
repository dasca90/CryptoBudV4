import { readFileSync } from 'fs';
import { strict as assert } from 'assert';

const read = (path: string) => readFileSync(path, 'utf8');

const scanner = read('src/core/scanner/MarketScanner.ts');
const types = read('src/core/unicorn/UnicornHunterTypes.ts');
const scoreEngine = read('src/core/unicorn/UnicornScoreEngine.ts');
const tradePage = read('src/ui/pages/TradePage.tsx');
const tradeV4Page = read('src/components/trade-v4/TradeV4Page.tsx');
const topStatus = read('src/components/trade-v4/TopStatusBar.tsx');
const candidatePool = read('src/components/trade-v4/CandidatePoolSummaryPanel.tsx');
const adapter = read('src/lib/air-scanner/tradeV4DataAdapter.ts');
const settingsPersistence = read('src/core/persistence/SettingsPersistence.ts');
const tradingParams = read('src/components/trade-v4/TradingParametersCard.tsx');
const telegramSource = read('src/core/notifications/trade-source.ts');

assert.ok(types.includes('export interface UnicornHunterSettings'), 'UnicornHunterTypes exposes runtime settings');
assert.ok(types.includes('enabled: false'), 'Unicorn Hunter default is safe/off');
assert.ok(scoreEngine.includes('export function scoreUnicornCandidate'), 'UnicornScoreEngine exposes scoring');
assert.ok(scoreEngine.includes('export function evaluateUnicornEntryGate'), 'UnicornScoreEngine exposes entry gate evaluation');

assert.ok(scanner.includes('setUnicornHunterSettings(settings'), 'MarketScanner accepts Unicorn Hunter runtime settings');
assert.ok(scanner.includes('normalizeUnicornHunterSettings(settings)'), 'MarketScanner normalizes Unicorn Hunter settings');
assert.ok(scanner.includes('getUnicornHunterRuntimeStatus()'), 'MarketScanner exposes real Unicorn Hunter runtime status');
assert.ok(scanner.includes('await this.buildUnicornCandidates({'), 'Scanner loop invokes Unicorn Hunter builder during scan cycle');
assert.ok(scanner.includes('candidates: rankedCandidatesToAnnotate'), 'Unicorn Hunter receives scanner candidate/market snapshots');

assert.ok(scanner.includes('UNICORN_HUNTER_RUNTIME_AUDIT'), 'Runtime audit exists');
assert.ok(scanner.includes('symbolsSeen=') && scanner.includes('symbolsEvaluated=') && scanner.includes('candidatesProduced='), 'Runtime audit includes required counters');
assert.ok(scanner.includes('buyAllowed=') && scanner.includes('reasonIfSkipped='), 'Runtime audit includes buyAllowed and reasonIfSkipped');
assert.ok(scanner.includes('lastUnicornCandidateSymbol') && scanner.includes('lastUnicornStage') && scanner.includes('lastUnicornBlockReason'), 'Runtime status exposes last Unicorn candidate/stage/blocker');
assert.ok(scanner.includes('lastUnicornConfirmationReason') && scanner.includes('lastUnicornExecutionDecision') && scanner.includes('lastUnicornSubmitAttempted') && scanner.includes('lastUnicornAdapterCalled'), 'Runtime status exposes Unicorn confirmation/execution/submit/adapter decision');
assert.ok(scanner.includes('UNICORN_PIPELINE_AUDIT') && scanner.includes('UNICORN_EXECUTION_SELECTION_AUDIT') && scanner.includes('UNICORN_NO_SUBMIT_REASON_AUDIT') && scanner.includes('UNICORN_SUBMIT_ATTEMPT_AUDIT') && scanner.includes('UNICORN_BUY_OPENED_AUDIT'), 'Unicorn pipeline/selection/no-submit/submit/opened audits exist');
assert.ok(scanner.includes('UNICORN_BUDGET_STATE_AUDIT') && scanner.includes('EXECUTION_BUDGET_PARITY_AUDIT'), 'Separate Unicorn execution budget audits exist');
assert.equal(scanner.includes('UNICORN_BLOCK_GLOBAL_BUY_BUDGET_TAKEN_BY_AUTOBOTS'), false, 'Unicorn is not blocked by AutoBots slot ownership');
assert.ok(scanner.includes('UNICORN_HUNTER_SCAN_CYCLE_AUDIT'), 'Per-cycle audit exists');
assert.ok(scanner.includes('cycleStarted=true') && scanner.includes('cycleCompleted='), 'Per-cycle audit records cycle start and completion');
assert.ok(scanner.includes('logger.throttled') && scanner.includes('UNICORN_HUNTER_DISABLED_AUDIT'), 'Disabled audit is throttled');
assert.ok(scanner.includes("!settings.enabled || settings.mode === 'off'"), 'Disabled path avoids symbol evaluation');
assert.ok(scanner.includes('evaluatedCount: 0') && scanner.includes('symbolsEvaluated=0'), 'Disabled path records zero evaluated symbols');
assert.ok(scanner.includes('emitUnicornScanCycleAudit({ scanId: input.scanId'), 'Every builder path emits a scan-cycle audit');
assert.ok(scanner.includes('UNICORN_HUNTER_NOT_WIRED_AUDIT'), 'Not-wired audit exists for enabled-but-not-invoked scan cycles');
assert.ok(scanner.includes('emitUnicornNotWiredAuditIfNeeded(scanId, rankedCandidatesToAnnotate.length, unicornBuilderInvoked)'), 'Scanner verifies builder invocation after the intended callsite');
assert.ok(scanner.includes("status: settings.enabled && settings.mode !== 'off' ? 'SCANNING' : 'OFF'"), 'Runtime status moves from OFF to SCANNING when enabled during builder execution');
assert.ok(scanner.includes('UNICORN_BLOCK_NO_EXECUTABLE_CANDIDATE'), 'No-candidate cycles explain why no Unicorn candidate was produced');

assert.ok(settingsPersistence.includes('unicornHunter: normalizeUnicornHunterSettings'), 'Persisted settings restore Unicorn Hunter config');
assert.ok(tradingParams.includes('v.unicornHunter.enabled') && tradingParams.includes('patch("unicornHunter"'), 'UI toggle updates Unicorn Hunter config');
assert.ok(tradePage.includes('getUnicornHunterRuntimeStatus?.()') && tradePage.includes('unicornHunterRuntime'), 'Trade page passes scanner-owned Unicorn runtime into the UI model');
assert.ok(topStatus.includes('\uD83E\uDD84 UNICORN') && topStatus.includes('unicornHunterStatus'), 'Top status bar shows real Unicorn runtime status');
assert.ok(tradeV4Page.includes('\uD83E\uDD84 Unicorn Hunter: {unicornHunterStatus}') && tradeV4Page.includes('unicorn reason'), 'Scanner/AutoBots area shows Unicorn Hunter status and reason');
assert.ok(tradeV4Page.includes('unicorn stage') && tradeV4Page.includes('unicorn submit') && tradeV4Page.includes('unicorn candidate') && tradeV4Page.includes('unicorn adapter'), 'Scanner/AutoBots area shows Unicorn execution stage/candidate/submit/adapter state');
assert.ok(candidatePool.includes('Source: AutoBots \u00B7 \uD83E\uDD84 Unicorn Hunter \u00B7 ML Predict'), 'Candidate Pool source legend distinguishes AutoBots, Unicorn Hunter, and ML Predict');
assert.ok(adapter.includes("sourcePresentation.badgeVariant === 'unicorn'"), 'Candidate rows preserve Unicorn source identity');
assert.ok(telegramSource.includes("s.includes('unicorn')") && telegramSource.includes('Unicorn Hunter'), 'Telegram source formatting preserves Unicorn identity');

assert.ok(scanner.includes('buildExecutionPlan({'), 'AutoBots execution planner remains present');
assert.ok(scanner.includes('evaluateMLPredictBuy({'), 'ML Guard/ML Predict evaluation remains present');
assert.ok(scanner.includes('resolveProfessionalGateDecision'), 'Professional analysis gate remains present');
assert.ok(scanner.includes('btcAnchorEnabled') && scanner.includes('ethAnchorEnabled'), 'BTC/ETH anchor wiring remains present');

console.log('unicorn-runtime-wiring regression checks passed');
