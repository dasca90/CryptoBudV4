import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTradeSourcePresentation, resolveTradeSourceLabel } from '../core/notifications/trade-source';

const root = process.cwd();
const scanner = readFileSync(resolve(root, 'src/core/scanner/MarketScanner.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const tradePage = readFileSync(resolve(root, 'src/ui/pages/TradePage.tsx'), 'utf8');
const tradeV4Page = readFileSync(resolve(root, 'src/components/trade-v4/TradeV4Page.tsx'), 'utf8');
const parameters = readFileSync(resolve(root, 'src/components/trade-v4/TradingParametersCard.tsx'), 'utf8');
const candidatePool = readFileSync(resolve(root, 'src/components/trade-v4/CandidatePoolSummaryPanel.tsx'), 'utf8');
const topCandidates = readFileSync(resolve(root, 'src/components/trade-v4/TopCandidatesPanel.tsx'), 'utf8');
const selectedInspector = readFileSync(resolve(root, 'src/components/trade-v4/SelectedCoinInspector.tsx'), 'utf8');

assert.equal(scanner.includes('buildUnicornCandidates'), false, 'scanner must not build Unicorn candidates');
assert.equal(scanner.includes('setUnicornHunterSettings'), false, 'scanner must not expose Unicorn settings');
assert.equal(scanner.includes('revalidateUnicornWatchlist'), false, 'scanner must not run a Unicorn watch loop');
assert.equal(app.includes('setUnicornHunterSettings'), false, 'app must not wire Unicorn settings');
assert.equal(tradePage.includes('setUnicornHunterSettings'), false, 'trade page must not wire Unicorn settings');
assert.equal(tradeV4Page.includes('UnicornRadarCard'), false, 'trade UI must not render Unicorn Radar');
assert.equal(parameters.includes('Unicorn Hunter'), false, 'trade settings must not expose Unicorn controls');
assert.equal(candidatePool.includes('Unicorn pool'), false, 'candidate pipeline must not render a retired pool');
assert.equal(candidatePool.includes('Unicorn submit'), false, 'candidate pipeline must not render retired submit accounting');
assert.equal(candidatePool.includes('Unicorn READY'), false, 'candidate pipeline must not render retired readiness accounting');
assert.equal(topCandidates.includes('<option value="Unicorn">'), false, 'candidate filters must not expose a retired source');
assert.equal(topCandidates.includes('No Unicorn BUY'), false, 'candidate status must not render a retired no-buy diagnostic');
assert.equal(selectedInspector.includes('Unicorn no-submit reason'), false, 'selected coin must not render a retired owner diagnostic');
assert.equal(existsSync(resolve(root, 'src/core/unicorn/UnicornScoreEngine.ts')), false, 'Unicorn score engine must be removed');

const migratedLegacySource = resolveTradeSourceLabel({ source: 'unicorn_hunter', ownerName: 'UNICORN_HUNTER' });
const migratedLegacyPresentation = getTradeSourcePresentation(migratedLegacySource);
assert.equal(migratedLegacySource.label, 'AutoBots', 'legacy source rows must migrate to the canonical AutoBots presentation');
assert.equal(migratedLegacyPresentation.canonicalLabel, 'AutoBots', 'legacy source badge must be canonical AutoBots');
assert.equal(migratedLegacyPresentation.badgeVariant, 'autobots', 'legacy source badge must use the AutoBots style');
assert.equal(migratedLegacyPresentation.fullLabel.includes('Unicorn'), false, 'legacy rows must not reintroduce the retired name in UI');

console.log('V6 Unicorn retirement tests passed');
