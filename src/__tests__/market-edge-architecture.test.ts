import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'src/core/market-edge';
const files: string[] = [];
const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.ts$/.test(path)) files.push(path); } };
walk(root);
const source = files.map(path => readFileSync(path, 'utf8')).join('\n');

assert.ok(source.includes("'OFF' | 'MONITOR' | 'PRIORITY'"), 'Market Edge owns distinct OFF/MONITOR/PRIORITY modes');
assert.ok(!/advisory_only|shadow_only|active_guarded/.test(source), 'Market Edge does not reuse ML runtime modes');
assert.ok(!/TradingEngine|ExecutionPlanner|EntryGate|RiskEngine|LiveBinanceAdapter|PaperExchangeAdapter|BinancePrivateClient/.test(source), 'Market Edge kernel has no canonical execution dependency');
assert.ok(!/placeOrder|submitOrder|executeBuy|executePlannedScannerBuy|setLiveBuyFn|setPaperAutoBuyFn/.test(source), 'Market Edge exposes no direct BUY/order path');
assert.ok(!/apiKey|apiSecret|signature|leverage/i.test(source), 'Market Edge kernel requires no private credentials or leverage');
const scanner = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const autoRuntime = readFileSync('src/core/trading/AutoRuntime.ts', 'utf8');
const settingsTypes = readFileSync('src/core/types/index.ts', 'utf8');
const settingsPersistence = readFileSync('src/core/persistence/SettingsPersistence.ts', 'utf8');
const settingsUi = readFileSync('src/components/trade-v4/TradingParametersCard.tsx', 'utf8');
assert.ok(scanner.includes('scanPrioritySymbols') && scanner.includes("await this.scan('CUSTOM')"), 'PRIORITY delegates to a bounded canonical mini-scan');
assert.ok(autoRuntime.includes('this.prioritySymbols.size >= 3') && autoRuntime.includes('scanner.scanPrioritySymbols'), 'PRIORITY queue is bounded to three and owned by AutoRuntime');
assert.ok(!source.includes('ScannerCandidate'), 'MONITOR snapshots do not mutate ScannerCandidate');
assert.ok(settingsTypes.includes("marketEdgeMode: 'MONITOR'") && settingsTypes.includes('scannerUniverseSize: 100'), 'safe Market Edge and universe defaults are canonical');
assert.ok(settingsPersistence.includes('normalizeScannerUniverseSize(settings.scannerUniverseSize, settings.maxSymbolsScanned)'), 'legacy scanner size migrates into the canonical bounded setting');
assert.ok(settingsUi.includes('<option value="OFF">') && settingsUi.includes('<option value="MONITOR">') && settingsUi.includes('<option value="PRIORITY">'), 'Market Edge UI exposes modes distinct from ML advisory modes');
console.log(`market-edge-architecture: ${files.length} isolated files verified`);
